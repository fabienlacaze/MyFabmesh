"""Banc : reporter les PIXELS de l'image de base sur la texture d'un maillage TRELLIS, texel par texel (aucun sommet, aucune ile d'atlas supposee).
Usage : python projeter_source.py <maillage.glb> <image_source.png> <dossier_sortie> [--sans-flot] [--tol 0.0025]
Etapes : (1) masque de l'image (u2net) ; (2) camera en perspective ajustee sur la silhouette ; (3) flot optique du rendu vers l'image (alignement local) ;
(4) position 3D de chaque texel de l'atlas (rendu dans l'espace UV) ; (5) visibilite (profondeur + normale) ; (6) couleur de l'image, calee sur la couleur basse frequence de l'atlas ;
(7) rendus avant / apres depuis la camera ajustee et depuis d'autres angles."""
import argparse, importlib.util, json, math, os, sys, time
import numpy as np
import cv2
import torch
import trimesh
import moderngl
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument('glb'); ap.add_argument('image'); ap.add_argument('sortie')
ap.add_argument('--sans-flot', action='store_true')
ap.add_argument('--tol', type=float, default=0.0025)
ap.add_argument('--cos-min', type=float, default=0.40)
ap.add_argument('--tuile', type=int, default=4096)
ap.add_argument('--exporter', action='store_true')
ap.add_argument('--sauver', action='store_true')        # n'applique pas le melange : enregistre les couleurs projetees et leurs poids (combinaison de plusieurs vues ensuite)
ap.add_argument('--sans-ton', action='store_true')
ap.add_argument('--ton-canal', action='store_true')       # ancien etalonnage canal par canal (peut deriver en teinte)       # pas d'etalonnage global des couleurs de l'atlas sur la photo
ap.add_argument('--gain-max', type=float, default=1.4)    # ecart maximal du calage local de couleur
ap.add_argument('--tau', type=float, default=45.0)       # tolerance de couleur du garde-fou (niveaux, echelle moyenne)
ap.add_argument('--flot-max', type=float, default=14.0)  # deplacement maximal accepte par le recalage local (pixels)
args = ap.parse_args()
os.makedirs(args.sortie, exist_ok=True)
Image.MAX_IMAGE_PIXELS = None
T0 = time.time()
def log(*a): print('[%5.1fs]' % (time.time() - T0), *a, flush=True)

# ───────────── chargement
scene = trimesh.load(args.glb, force='scene', process=False)
mesh = list(scene.geometry.values())[0]
V = np.asarray(mesh.vertices, dtype=np.float64); F = np.asarray(mesh.faces, dtype=np.int32)
UV = np.asarray(mesh.visual.uv, dtype=np.float32); NRM = np.asarray(mesh.vertex_normals, dtype=np.float32)
mat = mesh.visual.material
ATLAS = np.asarray((getattr(mat, 'baseColorTexture', None) or getattr(mat, 'image', None)).convert('RGB'))
AH = ATLAS.shape[0]
centre = (V.min(0) + V.max(0)) / 2
V0 = (V - centre).astype(np.float32)
R = float(np.linalg.norm(V0, axis=1).max())
log('maillage', len(V), 'sommets', len(F), 'faces ; atlas', ATLAS.shape, '; rayon', round(R, 3))

src = Image.open(args.image).convert('RGB')
S = src.size[0]
SRC = np.asarray(src)

# ───────────── masque de l'image
spec = importlib.util.spec_from_file_location('detourage', 'C:/Users/Utilisateur/Desktop/FabWare/MeshyMyself/modal_app/_detourage.py')
det = importlib.util.module_from_spec(spec)
os.environ['U2NET_HOME'] = os.path.join(os.environ['APPDATA'], 'myfabmesh-ai', 'ai-cache', 'u2net')
spec.loader.exec_module(det)
det.POIDS_U2NET = os.path.join(os.environ['U2NET_HOME'], 'u2net.onnx')
MS = np.asarray(det.masque(src)) > 127
Image.fromarray((MS * 255).astype(np.uint8)).save(os.path.join(args.sortie, 'masque_source.png'))
ys, xs = np.where(MS)
bx0, bx1, by0, by1 = xs.min(), xs.max(), ys.min(), ys.max()
log('masque source : boite', bx0, bx1, by0, by1)

# ───────────── GL
ctx = moderngl.create_standalone_context()
PROG_CAM = ctx.program(vertex_shader="""#version 330
uniform float D; uniform float Fo; uniform float cx; uniform float cy; uniform float S; uniform mat3 Rm;
in vec3 in_pos; in vec2 in_uv; out vec2 uv; out float wv;
void main(){
  vec3 p = Rm * in_pos;
  float w = D - p.z;
  float x = (cx + Fo * p.x / w) / S * 2.0 - 1.0;
  float y = 1.0 - (cy - Fo * p.y / w) / S * 2.0;
  float zn = (w - 0.01) / (D * 4.0) * 2.0 - 1.0;
  gl_Position = vec4(x * w, y * w, zn * w, w);
  uv = in_uv; wv = w;
}""", fragment_shader="""#version 330
uniform sampler2D tex; uniform int mode; in vec2 uv; in float wv;
layout(location=0) out vec4 o0; layout(location=1) out vec4 o1;
void main(){ o0 = (mode == 0) ? vec4(texture(tex, uv).rgb, 1.0) : vec4(1.0); o1 = vec4(wv, 0.0, 0.0, 1.0); }""")
VBO = ctx.buffer(np.hstack([V0, UV]).astype('f4').tobytes()); IBO = ctx.buffer(F.astype('i4').tobytes())
VAO = ctx.vertex_array(PROG_CAM, [(VBO, '3f 2f', 'in_pos', 'in_uv')], IBO)
TEX = None
def poser_texture(arr):
    global TEX
    if TEX is not None: TEX.release()
    TEX = ctx.texture((arr.shape[1], arr.shape[0]), 3, np.ascontiguousarray(np.flipud(arr)).tobytes())
    TEX.build_mipmaps(); TEX.filter = (moderngl.LINEAR_MIPMAP_LINEAR, moderngl.LINEAR); TEX.anisotropy = 8.0

POSE = [0.0, 0.0]          # azimut (autour de Y) puis tangage (autour de X), en degres : orientation du maillage vue par la camera de l'image
def mat_pose(az, pitch):
    a = math.radians(az); p = math.radians(pitch)
    Ry = np.array([[math.cos(a), 0, math.sin(a)], [0, 1, 0], [-math.sin(a), 0, math.cos(a)]]); Rx = np.array([[1, 0, 0], [0, math.cos(p), -math.sin(p)], [0, math.sin(p), math.cos(p)]])
    return (Rx @ Ry).astype(np.float32)
def rendre(cam, taille, daz=0.0, mode=0):
    """(rgb uint8, masque bool, profondeur w float32) depuis la camera cam = (D, F, cx, cy) mise a l'echelle de `taille` ; POSE = orientation du modele ; daz : azimut en plus (vues de controle)."""
    D, Fo, cx, cy = cam; k = taille / S
    Rm = mat_pose(POSE[0] + daz, POSE[1])
    PROG_CAM['D'].value = D; PROG_CAM['Fo'].value = Fo * k; PROG_CAM['cx'].value = cx * k; PROG_CAM['cy'].value = cy * k; PROG_CAM['S'].value = float(taille)
    PROG_CAM['Rm'].write(Rm.T.tobytes()); PROG_CAM['mode'].value = mode
    if TEX is not None: TEX.use(0); PROG_CAM['tex'].value = 0
    c0 = ctx.texture((taille, taille), 4, dtype='f1'); c1 = ctx.texture((taille, taille), 4, dtype='f4'); dp = ctx.depth_renderbuffer((taille, taille))
    fbo = ctx.framebuffer(color_attachments=[c0, c1], depth_attachment=dp); fbo.use()
    ctx.enable(moderngl.DEPTH_TEST); ctx.disable(moderngl.CULL_FACE); fbo.clear(1.0, 1.0, 1.0, 0.0, depth=1.0)
    VAO.render(moderngl.TRIANGLES)
    rgba = np.frombuffer(fbo.read(attachment=0, components=4), dtype=np.uint8).reshape(taille, taille, 4)[::-1]
    w = np.frombuffer(fbo.read(attachment=1, components=4, dtype='f4'), dtype=np.float32).reshape(taille, taille, 4)[::-1, :, 0].copy()
    for o in (c0, c1, dp, fbo): o.release()
    return rgba[:, :, :3].copy(), rgba[:, :, 3] > 0, w

def camera_analytique(D):
    Vr = V0 @ mat_pose(*POSE).T
    w = D - Vr[:, 2]; x = Vr[:, 0] / w; y = Vr[:, 1] / w
    Fx = (bx1 - bx0) / (x.max() - x.min()); Fy = (by1 - by0) / (y.max() - y.min()); Fo = (Fx + Fy) / 2
    cx = (bx0 + bx1) / 2 - Fo * (x.max() + x.min()) / 2; cy = (by0 + by1) / 2 + Fo * (y.max() + y.min()) / 2
    return (D, Fo, cx, cy)
def iou(cam, taille=512):
    m = rendre(cam, taille, mode=1)[1]; ms = cv2.resize(MS.astype(np.uint8), (taille, taille), interpolation=cv2.INTER_AREA) > 0
    return float((m & ms).sum() / max((m | ms).sum(), 1))
def structure(img_rgb, flou=1.5):
    """Image de « structure » : gris flou, contraste normalise localement (insensible aux ecarts d'exposition et de couleur entre le rendu et la photo)."""
    g = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
    g = cv2.GaussianBlur(g, (0, 0), flou)
    mu = cv2.GaussianBlur(g, (0, 0), 8); var = cv2.GaussianBlur((g - mu) ** 2, (0, 0), 8)
    return (g - mu) / np.sqrt(var + 1e-3)
def ncc(a, b, m):
    x = a[m]; y = b[m]; x = x - x.mean(); y = y - y.mean()
    return float((x * y).mean() / (x.std() * y.std() + 1e-6))
poser_texture(ATLAS)
S512 = 512
SP512 = structure(cv2.resize(SRC, (S512, S512), interpolation=cv2.INTER_AREA), 1.0)
MP512 = cv2.erode(cv2.resize(MS.astype(np.uint8), (S512, S512), interpolation=cv2.INTER_AREA), np.ones((9, 9), np.uint8)) > 0
def score_photo(c):
    r, m, _ = rendre(c, S512)
    mm = m & MP512
    if mm.sum() < 2000: return -1.0
    return ncc(structure(r, 1.5), SP512, mm) + 0.6 * iou(c)
def raffiner(cam, rondes_sil=4, rondes_photo=5):
    """Silhouette puis correlation de structure, par descente de coordonnees sur (D, F, cx, cy)."""
    best = iou(cam); cam = list(cam); pas = [0.08, 0.02, 8.0, 8.0]
    for _ in range(rondes_sil):
        for i in range(4):
            for sgn in (-1, 1):
                c2 = list(cam); c2[i] = cam[i] * (1 + sgn * pas[i]) if i < 2 else cam[i] + sgn * pas[i]
                if c2[0] <= R * 1.05: continue
                sc = iou(tuple(c2))
                if sc > best: best, cam = sc, c2
        pas = [p * 0.5 for p in pas]
    sc0 = score_photo(tuple(cam)); pas = [0.04, 0.015, 6.0, 6.0]
    for _ in range(rondes_photo):
        for i in range(4):
            for sgn in (-1, 1):
                c2 = list(cam); c2[i] = cam[i] * (1 + sgn * pas[i]) if i < 2 else cam[i] + sgn * pas[i]
                if c2[0] <= R * 1.05: continue
                sc = score_photo(tuple(c2))
                if sc > sc0: sc0, cam = sc, c2
        pas = [p * 0.6 for p in pas]
    return tuple(cam), sc0

# ───────────── RECHERCHE DE LA POSE : l'image de base n'est pas toujours de face (voiture, portail, cochon en 3/4)
cand = []
for az in range(-180, 180, 15):
    for pitch in (-10, 0, 10, 20, 30):
        POSE[:] = [az, pitch]
        top = max(((iou(camera_analytique(R * k), 256), k) for k in (1.6, 2.5, 4.0, 7.0)))
        cand.append((top[0], az, pitch, top[1]))
cand.sort(reverse=True)
log('pose : meilleurs candidats par silhouette :', ['az %d tangage %d IoU %.2f' % (c[1], c[2], c[0]) for c in cand[:5]])
meilleur_pose = None
for sil, az, pitch, k in cand[:5]:
    POSE[:] = [az, pitch]
    cam_c, sc_c = raffiner(camera_analytique(R * k), 3, 3)
    if meilleur_pose is None or sc_c > meilleur_pose[0]: meilleur_pose = (sc_c, az, pitch, cam_c)
sc0, az0, pitch0, cam = meilleur_pose
POSE[:] = [az0, pitch0]
for pas_p in (6.0, 3.0):                      # affinage fin de l'orientation
    for dz, dp in ((pas_p, 0), (-pas_p, 0), (0, pas_p), (0, -pas_p)):
        POSE[:] = [az0 + dz, pitch0 + dp]
        c2, s2 = raffiner(cam, 1, 3)
        if s2 > sc0: sc0, cam, az0, pitch0 = s2, c2, az0 + dz, pitch0 + dp
POSE[:] = [az0, pitch0]
cam, sc0 = raffiner(cam, 2, 4)
meilleur = iou(cam)
log('POSE retenue : azimut %.1f tangage %.1f ; camera D=%.3f F=%.1f cx=%.1f cy=%.1f ; score photo=%.3f IoU=%.3f D/R=%.2f' % (az0, pitch0, cam[0], cam[1], cam[2], cam[3], sc0, meilleur, cam[0] / R))
json.dump({'cam': cam, 'pose': POSE, 'iou': meilleur, 'score': sc0, 'R': R}, open(os.path.join(args.sortie, 'camera.json'), 'w'))

# ───────────── rendu actuel, flot optique, image alignee
poser_texture(ATLAS)
r0, m0, w0 = rendre(cam, S)
Image.fromarray(np.where(m0[..., None], r0, 255).astype(np.uint8)).save(os.path.join(args.sortie, 'rendu_avant.png'))
ALIGN = SRC.copy()
SRC_S = cv2.resize(SRC, (S, S))
sr = structure(np.where(m0[..., None], r0, 128).astype(np.uint8), 1.5)
sp = structure(SRC_S, 2.0)
mm0 = m0 & (cv2.erode(MS.astype(np.uint8), np.ones((9, 9), np.uint8)) > 0)
ncc_avant = ncc(sr, sp, mm0)
log('correlation de structure rendu / photo avant recalage : %.3f' % ncc_avant)
if not args.sans_flot:
    u8 = lambda x: np.clip(x * 40 + 128, 0, 255).astype(np.uint8)
    flow = cv2.calcOpticalFlowFarneback(u8(sr), u8(sp), None, 0.5, 6, 31, 6, 7, 1.5, 0)
    zone = cv2.dilate(m0.astype(np.uint8), np.ones((9, 9), np.uint8)).astype(np.float32)
    flow = cv2.GaussianBlur(flow, (0, 0), 6) * zone[..., None]
    mag = np.linalg.norm(flow, axis=2); flow *= np.minimum(1.0, args.flot_max / np.maximum(mag, 1e-6))[..., None]
    gx, gy = np.meshgrid(np.arange(S, dtype=np.float32), np.arange(S, dtype=np.float32))
    warp = lambda img, interp: cv2.remap(img, gx + flow[..., 0], gy + flow[..., 1], interp, borderMode=cv2.BORDER_REPLICATE)
    sp_w = warp(sp, cv2.INTER_LINEAR)
    ncc_apres = ncc(sr, sp_w, mm0)
    # confiance locale : le recalage ne vaut que la ou la correlation locale s'ameliore
    k = 21
    def ncc_loc(a, b):
        ma = cv2.blur(a, (k, k)); mb = cv2.blur(b, (k, k)); va = cv2.blur(a * a, (k, k)) - ma * ma; vb = cv2.blur(b * b, (k, k)) - mb * mb
        return (cv2.blur(a * b, (k, k)) - ma * mb) / np.sqrt(np.maximum(va * vb, 1e-6))
    c_av = ncc_loc(sr, sp); c_ap = ncc_loc(sr, sp_w)
    mieux = (c_ap > c_av + 0.02).astype(np.float32)
    mieux = cv2.GaussianBlur(mieux, (0, 0), 8)
    flow *= mieux[..., None]
    ALIGN = cv2.remap(SRC_S, gx + flow[..., 0], gy + flow[..., 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    sp_w2 = cv2.remap(sp, gx + flow[..., 0], gy + flow[..., 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    log('flot optique : deplacement moyen %.2f px (max %.1f) ; correlation de structure %.3f -> %.3f' % (np.linalg.norm(flow[m0], axis=1).mean(), np.linalg.norm(flow[m0], axis=1).max(), ncc_avant, ncc(sr, sp_w2, mm0)))
    # carte de recalage pour l'oeil
    Image.fromarray(np.clip(np.linalg.norm(flow, axis=2) * 12, 0, 255).astype(np.uint8)).save(os.path.join(args.sortie, 'flot_amplitude.png'))
Image.fromarray(ALIGN).save(os.path.join(args.sortie, 'source_alignee.png'))

# ───────────── profondeur de la camera (2 x la taille de l'image) pour la visibilite
SD = 2 * S
_, _, WD = rendre(cam, SD)
MSK = cv2.erode(MS.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(np.float32)
WDn = WD.copy(); WDn[WDn > 1e5] = 0
saut = (cv2.dilate(WDn, np.ones((5, 5), np.uint8)) - cv2.erode(WDn, np.ones((5, 5), np.uint8))) > 0.012 * cam[0]
BORD = cv2.dilate(saut.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(np.float32)
BORDT = torch.from_numpy(1.0 - BORD).to(torch.device('cuda'))
MSKb = cv2.GaussianBlur(MSK, (0, 0), 2.0)

# ───────────── position et normale de chaque texel (rendu dans l'espace UV, par tuiles)
PROG_UV = ctx.program(vertex_shader="""#version 330
uniform vec2 tile; uniform float N; in vec3 in_pos; in vec2 in_uv; in vec3 in_nrm; out vec3 p; out vec3 n;
void main(){ gl_Position = vec4((in_uv * N - tile) * 2.0 - 1.0, 0.0, 1.0); p = in_pos; n = in_nrm; }""", fragment_shader="""#version 330
in vec3 p; in vec3 n; layout(location=0) out vec4 o0; layout(location=1) out vec4 o1;
void main(){ o0 = vec4(p, 1.0); o1 = vec4(n, 1.0); }""")
VBO2 = ctx.buffer(np.hstack([V0, UV, NRM]).astype('f4').tobytes())
VAO2 = ctx.vertex_array(PROG_UV, [(VBO2, '3f 2f 3f', 'in_pos', 'in_uv', 'in_nrm')], IBO)
Tl = min(args.tuile, AH); N = AH // Tl
dev = torch.device('cuda')
NOUVEAU = np.empty_like(ATLAS)            # couleur de l'image projetee (sera calee ensuite)
POIDS = np.zeros((AH, AH), dtype=np.uint8)
SRCT = torch.from_numpy(ALIGN).to(dev).permute(2, 0, 1)[None].float()          # 1,3,S,S
WDT = torch.from_numpy(WD).to(dev)
MSKT = torch.from_numpy(MSKb).to(dev)[None, None]
D, Fo, cx, cy = cam
RT = torch.from_numpy(mat_pose(*POSE)).to(dev)
couvert = 0; total = 0
for tj in range(N):
    for ti in range(N):
        c0 = ctx.texture((Tl, Tl), 4, dtype='f4'); c1 = ctx.texture((Tl, Tl), 4, dtype='f4'); fbo = ctx.framebuffer(color_attachments=[c0, c1]); fbo.use()
        ctx.disable(moderngl.DEPTH_TEST); fbo.clear(0.0, 0.0, 0.0, 0.0)
        PROG_UV['tile'].value = (float(ti), float(tj)); PROG_UV['N'].value = float(N)
        VAO2.render(moderngl.TRIANGLES)
        P = np.frombuffer(fbo.read(attachment=0, components=4, dtype='f4'), dtype=np.float32).reshape(Tl, Tl, 4)[::-1]
        Nn = np.frombuffer(fbo.read(attachment=1, components=4, dtype='f4'), dtype=np.float32).reshape(Tl, Tl, 4)[::-1]
        c0.release(); c1.release(); fbo.release()
        Pt = torch.from_numpy(P.copy()).to(dev); Nt = torch.from_numpy(Nn.copy()).to(dev)
        valide = Pt[..., 3] > 0.5
        pos = Pt[..., :3]; nrm = torch.nn.functional.normalize(Nt[..., :3], dim=-1)
        pos = pos @ RT.T; nrm = nrm @ RT.T
        w = D - pos[..., 2]
        u = cx + Fo * pos[..., 0] / w; v = cy - Fo * pos[..., 1] / w
        # visibilite : profondeur de la camera au pixel (u, v)
        ud = (u / S * SD).long().clamp(0, SD - 1); vd = (v / S * SD).long().clamp(0, SD - 1)
        prof = WDT[vd, ud]
        vu = (w - prof).abs() < args.tol * D
        # angle : normale contre direction de la camera
        vdir = torch.stack([-pos[..., 0], -pos[..., 1], D - pos[..., 2]], dim=-1); vdir = torch.nn.functional.normalize(vdir, dim=-1)
        cs = (nrm * vdir).sum(-1)
        wang = ((cs - args.cos_min) / 0.30).clamp(0, 1)
        gx_ = (u / (S - 1) * 2 - 1); gy_ = (v / (S - 1) * 2 - 1)
        grille = torch.stack([gx_, gy_], dim=-1)[None]
        dans = (u >= 0) & (u <= S - 1) & (v >= 0) & (v <= S - 1)
        mk = torch.nn.functional.grid_sample(MSKT, grille, mode='bilinear', padding_mode='zeros', align_corners=True)[0, 0]
        col = torch.nn.functional.grid_sample(SRCT, grille, mode='bilinear', padding_mode='border', align_corners=True)[0]  # 3,T,T
        bord = BORDT[vd, ud]
        a = (valide & vu & dans).float() * wang * mk * bord
        NOUVEAU[(N - 1 - tj) * Tl:(N - tj) * Tl, ti * Tl:(ti + 1) * Tl] = col.permute(1, 2, 0).clamp(0, 255).byte().cpu().numpy()
        POIDS[(N - 1 - tj) * Tl:(N - tj) * Tl, ti * Tl:(ti + 1) * Tl] = (a * 255).byte().cpu().numpy()
        couvert += int((a > 0.5).sum()); total += int(valide.sum())
        nv = max(int(valide.sum()), 1)
        log('   diag tuile %d,%d : valides %d | visibles(prof) %.1f %% | cos>min %.1f %% | cos<-min %.1f %% | dans masque %.1f %% | dans image %.1f %%' % (ti, tj, nv,
            100 * int((valide & vu).sum()) / nv, 100 * int((valide & (cs > args.cos_min)).sum()) / nv, 100 * int((valide & (cs < -args.cos_min)).sum()) / nv,
            100 * int((valide & (mk > 0.5)).sum()) / nv, 100 * int((valide & dans).sum()) / nv))
        del Pt, Nt, pos, nrm, w, u, v, col, a
        torch.cuda.empty_cache()
        log('tuile', ti, tj, 'ok')
log('texels projetes (poids > 0,5) : %.1f %% des texels utiles' % (100.0 * couvert / max(total, 1)))
if args.sauver:
    np.save(os.path.join(args.sortie, 'nouveau.npy'), NOUVEAU); np.save(os.path.join(args.sortie, 'poids.npy'), POIDS)
    json.dump({'pose': POSE, 'cam': cam}, open(os.path.join(args.sortie, 'vue.json'), 'w'))
    log('vue sauvee'); sys.exit(0)

# ───────────── calage des couleurs (basse frequence de l'atlas) puis melange
K = 8; Lr = AH // K
w_f = POIDS.astype(np.float32) / 255.0
def aire(x): return cv2.resize(x, (Lr, Lr), interpolation=cv2.INTER_AREA)
den = aire(w_f)
ATLAST = ATLAS
if not args.sans_ton:
    # ETALONNAGE GLOBAL DES TONS (luminance seulement) : l'atlas TRELLIS est plus pale que la photo. On apprend, sur les zones ou la photo a ete reportee, la courbe de LUMINANCE
    # ancienne texture -> photo (appariement de quantiles des moyennes locales) et on l'applique a TOUT l'atlas comme un facteur commun aux trois canaux : la teinte de chaque texel
    # ne bouge pas (l'appariement canal par canal faisait virer le cochon au vert). Le calage local de couleur traite ensuite la teinte la ou la photo est reportee.
    sel = den > 0.5
    Lum = lambda c: 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]
    oL = Lum([aire(ATLAS[..., c].astype(np.float32) * w_f) / np.maximum(den, 1e-6) for c in range(3)]); nL = Lum([aire(NOUVEAU[..., c].astype(np.float32) * w_f) / np.maximum(den, 1e-6) for c in range(3)])
    qs = np.linspace(0.01, 0.99, 50); oq = np.quantile(oL[sel], qs); nq = np.maximum.accumulate(np.quantile(nL[sel], qs))
    x = np.arange(256, dtype=np.float32); l = np.interp(x, oq, nq); l[x < oq[0]] = x[x < oq[0]] + (nq[0] - oq[0]); l[x > oq[-1]] = x[x > oq[-1]] + (nq[-1] - oq[-1])
    lutL = np.clip(l, 0, 255).astype(np.float32)
    fac = np.clip(lutL / np.maximum(x, 10.0), 0.6, 1.6).astype(np.float32); fac[x < 10] = 1.0
    log('ton (luminance) : mediane %.0f -> %.0f ; haut %.0f -> %.0f ; facteurs %.2f a %.2f' % (oq[len(qs) // 2], nq[len(qs) // 2], oq[-1], nq[-1], fac.min(), fac.max()))
    if args.ton_canal:
        raise SystemExit('--ton-canal : voir projeter_source4.py')
    ATLAST = np.empty_like(ATLAS)
    for r_ in range(0, AH, 1024):
        blk = ATLAS[r_:r_ + 1024].astype(np.float32); Li = np.clip(Lum([blk[..., 0], blk[..., 1], blk[..., 2]]), 0, 255).astype(np.uint8)
        ATLAST[r_:r_ + 1024] = np.clip(blk * fac[Li][..., None], 0, 255).astype(np.uint8)
gains = []
for c in range(3):
    n_old = aire(ATLAST[..., c].astype(np.float32) * w_f); n_new = aire(NOUVEAU[..., c].astype(np.float32) * w_f)
    g = (n_old + 12.0 * den + 1e-3) / (n_new + 12.0 * den + 1e-3)
    # lissage normalise par le poids (aucun melange avec les texels non projetes)
    gs = cv2.GaussianBlur(g * den, (0, 0), 2.0) / np.maximum(cv2.GaussianBlur(den, (0, 0), 2.0), 1e-4)
    gs = np.where(cv2.GaussianBlur(den, (0, 0), 2.0) > 1e-3, gs, 1.0)
    gains.append(np.clip(gs, 1.0 / args.gain_max, args.gain_max).astype(np.float32))
# GARDE-FOU : la photo et l'ancienne texture doivent s'accorder a l'echelle moyenne (une tache jaune sur une barre sombre = decalage)
K2 = 4; L2 = AH // K2
def aire2(x): return cv2.resize(x, (L2, L2), interpolation=cv2.INTER_AREA)
den2 = aire2(w_f)
g_up = [cv2.resize(g, (L2, L2), interpolation=cv2.INTER_LINEAR) for g in gains]
delta = np.zeros((L2, L2), np.float32)
for c in range(3):
    o = cv2.GaussianBlur(aire2(ATLAST[..., c].astype(np.float32) * w_f), (0, 0), 1.5); n = cv2.GaussianBlur(aire2(NOUVEAU[..., c].astype(np.float32) * w_f), (0, 0), 1.5)
    d_ = cv2.GaussianBlur(den2, (0, 0), 1.5)
    delta += np.abs(n * g_up[c] - o) / np.maximum(d_, 1e-3)
delta /= 3.0
garde = np.exp(-(delta / args.tau) ** 2).astype(np.float32)
garde[den2 < 1e-3] = 1.0
log('garde-fou de couleur : poids moyen %.2f sur les texels projetes' % (float((garde * den2).sum() / max(den2.sum(), 1e-6))))
GARDE = cv2.resize(garde, (AH, AH), interpolation=cv2.INTER_LINEAR)
w_f = w_f * GARDE
FINAL = ATLAST.copy()
bande = 1024
for r0_ in range(0, AH, bande):
    sl = slice(r0_, r0_ + bande)
    wb = w_f[sl][..., None]
    g_full = np.stack([cv2.resize(g[r0_ // K:(r0_ + bande) // K], (AH, bande), interpolation=cv2.INTER_LINEAR) for g in gains], axis=-1)
    new = np.clip(NOUVEAU[sl].astype(np.float32) * g_full, 0, 255)
    FINAL[sl] = np.clip(ATLAST[sl].astype(np.float32) * (1 - wb) + new * wb, 0, 255).astype(np.uint8)
log('melange fait')
Image.fromarray(FINAL).resize((2048, 2048), Image.LANCZOS).save(os.path.join(args.sortie, 'atlas_apres_2k.png'))
Image.fromarray(ATLAS).resize((2048, 2048), Image.LANCZOS).save(os.path.join(args.sortie, 'atlas_avant_2k.png'))

if args.exporter:
    Image.fromarray(FINAL).resize((4096, 4096), Image.LANCZOS).save(os.path.join(args.sortie, 'atlas_apres_4k.png'))
    Image.fromarray(ATLAS).resize((4096, 4096), Image.LANCZOS).save(os.path.join(args.sortie, 'atlas_avant_4k.png'))
    Image.fromarray(FINAL).save(os.path.join(args.sortie, 'atlas_apres_8k.jpg'), quality=93)
    Image.fromarray(ATLAS).save(os.path.join(args.sortie, 'atlas_avant_8k.jpg'), quality=93)
    log('atlas 4096 et 8192 enregistres')
# ───────────── rendus apres, depuis la camera ajustee et d'autres angles
poser_texture(FINAL)
ra, ma, _ = rendre(cam, S)
Image.fromarray(np.where(ma[..., None], ra, 255).astype(np.uint8)).save(os.path.join(args.sortie, 'rendu_apres.png'))
for az in (25, -25, 60):
    poser_texture(ATLAS); rb, mb, _ = rendre(cam, S, daz=az)
    poser_texture(FINAL); rc, mc, _ = rendre(cam, S, daz=az)
    P = np.concatenate([np.where(mb[..., None], rb, 255), np.where(mc[..., None], rc, 255)], axis=1).astype(np.uint8)
    Image.fromarray(P).save(os.path.join(args.sortie, 'angle_%+d_avant_apres.png' % az))
log('termine')
