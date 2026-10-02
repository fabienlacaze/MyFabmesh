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
ap.add_argument('--cos-min', type=float, default=0.30)
ap.add_argument('--tuile', type=int, default=4096)
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

def rendre(cam, taille, az=0.0, mode=0):
    """(rgb uint8, masque bool, profondeur w float32) depuis la camera cam = (D, F, cx, cy) mise a l'echelle de `taille` ; az : rotation du modele autour de Y (degres)."""
    D, Fo, cx, cy = cam; k = taille / S
    a = math.radians(az); Rm = np.array([[math.cos(a), 0, math.sin(a)], [0, 1, 0], [-math.sin(a), 0, math.cos(a)]], dtype=np.float32)
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

# ───────────── camera : D, F, cx, cy ajustes sur la silhouette de l'image
def camera_analytique(D):
    w = D - V0[:, 2]; x = V0[:, 0] / w; y = V0[:, 1] / w
    Fx = (bx1 - bx0) / (x.max() - x.min()); Fy = (by1 - by0) / (y.max() - y.min()); Fo = (Fx + Fy) / 2
    cx = (bx0 + bx1) / 2 - Fo * (x.max() + x.min()) / 2; cy = (by0 + by1) / 2 + Fo * (y.max() + y.min()) / 2
    return (D, Fo, cx, cy)
def iou(cam):
    m = rendre(cam, 512, mode=1)[1]; ms = cv2.resize(MS.astype(np.uint8), (512, 512), interpolation=cv2.INTER_AREA) > 0
    return float((m & ms).sum() / max((m | ms).sum(), 1))
meilleur, mcam = -1, None
for k in (1.3, 1.6, 2, 2.5, 3, 4, 5, 6.5, 8, 10, 14, 20):
    cam = camera_analytique(R * k * 1.0 + float(V0[:, 2].max()) * 0)   # D > z max assure par k >= 1.3
    sc = iou(cam)
    if sc > meilleur: meilleur, mcam = sc, cam
cam = list(mcam)
pas = [0.08, 0.02, 8.0, 8.0]
for ronde in range(4):
    for i in range(4):
        for sgn in (-1, 1):
            c2 = list(cam); c2[i] = cam[i] * (1 + sgn * pas[i]) if i < 2 else cam[i] + sgn * pas[i]
            if c2[0] <= float(V0[:, 2].max()) + 0.05: continue
            sc = iou(tuple(c2))
            if sc > meilleur: meilleur, cam = sc, c2
    pas = [p * 0.5 for p in pas]
cam = tuple(cam)
log('camera D=%.3f F=%.1f cx=%.1f cy=%.1f IoU=%.3f D/R=%.2f' % (cam[0], cam[1], cam[2], cam[3], meilleur, cam[0] / R))
json.dump({'cam': cam, 'iou': meilleur, 'R': R}, open(os.path.join(args.sortie, 'camera.json'), 'w'))

# ───────────── rendu actuel, flot optique, image alignee
poser_texture(ATLAS)
r0, m0, w0 = rendre(cam, S)
Image.fromarray(np.where(m0[..., None], r0, 255).astype(np.uint8)).save(os.path.join(args.sortie, 'rendu_avant.png'))
ALIGN = SRC.copy()
if not args.sans_flot:
    g0 = cv2.cvtColor(np.where(m0[..., None], r0, 128).astype(np.uint8), cv2.COLOR_RGB2GRAY); g1 = cv2.cvtColor(SRC, cv2.COLOR_RGB2GRAY)
    g0 = cv2.createCLAHE(2.0, (8, 8)).apply(g0); g1 = cv2.createCLAHE(2.0, (8, 8)).apply(g1)
    dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    flow = dis.calc(g0, g1, None)
    zone = cv2.dilate(m0.astype(np.uint8), np.ones((9, 9), np.uint8)).astype(np.float32)
    flow = cv2.GaussianBlur(flow, (0, 0), 3) * zone[..., None]
    gx, gy = np.meshgrid(np.arange(S, dtype=np.float32), np.arange(S, dtype=np.float32))
    ALIGN = cv2.remap(SRC, gx + flow[..., 0], gy + flow[..., 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    log('flot optique : deplacement moyen %.2f px, max %.1f px (dans la silhouette)' % (np.linalg.norm(flow[m0], axis=1).mean(), np.linalg.norm(flow[m0], axis=1).max()))
Image.fromarray(ALIGN).save(os.path.join(args.sortie, 'source_alignee.png'))

# ───────────── profondeur de la camera (2 x la taille de l'image) pour la visibilite
SD = 2 * S
_, _, WD = rendre(cam, SD)
MSK = cv2.erode(MS.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(np.float32)
MSKb = cv2.GaussianBlur(MSK, (0, 0), 2.0)

# ───────────── position et normale de chaque texel (rendu dans l'espace UV, par tuiles)
PROG_UV = ctx.program(vertex_shader="""#version 330
uniform vec2 tile; uniform float N; in vec3 in_pos; in vec2 in_uv; in vec3 in_nrm; out vec3 p; out vec3 n;
void main(){ gl_Position = vec4((in_uv * N - tile) * 2.0 - 1.0, 0.0, 1.0); p = in_pos; n = in_nrm; }""", fragment_shader="""#version 330
in vec3 p; in vec3 n; layout(location=0) out vec4 o0; layout(location=1) out vec4 o1;
void main(){ o0 = vec4(p, 1.0); o1 = vec4(n, 1.0); }""")
VBO2 = ctx.buffer(np.hstack([V0, UV, NRM]).astype('f4').tobytes())
VAO2 = ctx.vertex_array(PROG_UV, [(VBO2, '3f 2f 3f', 'in_pos', 'in_uv', 'in_nrm')], IBO)
Tl = args.tuile; N = AH // Tl
dev = torch.device('cuda')
NOUVEAU = np.empty_like(ATLAS)            # couleur de l'image projetee (sera calee ensuite)
POIDS = np.zeros((AH, AH), dtype=np.uint8)
SRCT = torch.from_numpy(ALIGN).to(dev).permute(2, 0, 1)[None].float()          # 1,3,S,S
WDT = torch.from_numpy(WD).to(dev)
MSKT = torch.from_numpy(MSKb).to(dev)[None, None]
D, Fo, cx, cy = cam
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
        w = D - pos[..., 2]
        u = cx + Fo * pos[..., 0] / w; v = cy - Fo * pos[..., 1] / w
        # visibilite : profondeur de la camera au pixel (u, v)
        ud = (u / S * SD).long().clamp(0, SD - 1); vd = (v / S * SD).long().clamp(0, SD - 1)
        prof = WDT[vd, ud]
        vu = (w - prof).abs() < args.tol * D
        # angle : normale contre direction de la camera
        vdir = torch.stack([-pos[..., 0], -pos[..., 1], D - pos[..., 2]], dim=-1); vdir = torch.nn.functional.normalize(vdir, dim=-1)
        cs = (nrm * vdir).sum(-1)
        wang = ((cs - args.cos_min) / 0.35).clamp(0, 1)
        gx_ = (u / (S - 1) * 2 - 1); gy_ = (v / (S - 1) * 2 - 1)
        grille = torch.stack([gx_, gy_], dim=-1)[None]
        dans = (u >= 0) & (u <= S - 1) & (v >= 0) & (v <= S - 1)
        mk = torch.nn.functional.grid_sample(MSKT, grille, mode='bilinear', padding_mode='zeros', align_corners=True)[0, 0]
        col = torch.nn.functional.grid_sample(SRCT, grille, mode='bilinear', padding_mode='border', align_corners=True)[0]  # 3,T,T
        a = (valide & vu & dans).float() * wang * mk
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

# ───────────── calage des couleurs (basse frequence de l'atlas) puis melange
K = 8; Lr = AH // K
w_f = POIDS.astype(np.float32) / 255.0
def aire(x): return cv2.resize(x, (Lr, Lr), interpolation=cv2.INTER_AREA)
den = aire(w_f)
gains = []
for c in range(3):
    n_old = aire(ATLAS[..., c].astype(np.float32) * w_f); n_new = aire(NOUVEAU[..., c].astype(np.float32) * w_f)
    g = (n_old + 1.0) / (n_new + 1.0)
    # lissage normalise par le poids (aucun melange avec les texels non projetes)
    gs = cv2.GaussianBlur(g * den, (0, 0), 2.0) / np.maximum(cv2.GaussianBlur(den, (0, 0), 2.0), 1e-4)
    gs = np.where(cv2.GaussianBlur(den, (0, 0), 2.0) > 1e-3, gs, 1.0)
    gains.append(np.clip(gs, 0.5, 2.0).astype(np.float32))
FINAL = ATLAS.copy()
bande = 1024
for r0_ in range(0, AH, bande):
    sl = slice(r0_, r0_ + bande)
    wb = w_f[sl][..., None]
    g_full = np.stack([cv2.resize(g[r0_ // K:(r0_ + bande) // K], (AH, bande), interpolation=cv2.INTER_LINEAR) for g in gains], axis=-1)
    new = np.clip(NOUVEAU[sl].astype(np.float32) * g_full, 0, 255)
    FINAL[sl] = np.clip(ATLAS[sl].astype(np.float32) * (1 - wb) + new * wb, 0, 255).astype(np.uint8)
log('melange fait')
Image.fromarray(FINAL).resize((2048, 2048), Image.LANCZOS).save(os.path.join(args.sortie, 'atlas_apres_2k.png'))
Image.fromarray(ATLAS).resize((2048, 2048), Image.LANCZOS).save(os.path.join(args.sortie, 'atlas_avant_2k.png'))

# ───────────── rendus apres, depuis la camera ajustee et d'autres angles
poser_texture(FINAL)
ra, ma, _ = rendre(cam, S)
Image.fromarray(np.where(ma[..., None], ra, 255).astype(np.uint8)).save(os.path.join(args.sortie, 'rendu_apres.png'))
for az in (25, -25, 60):
    poser_texture(ATLAS); rb, mb, _ = rendre(cam, S, az=az)
    poser_texture(FINAL); rc, mc, _ = rendre(cam, S, az=az)
    P = np.concatenate([np.where(mb[..., None], rb, 255), np.where(mc[..., None], rc, 255)], axis=1).astype(np.uint8)
    Image.fromarray(P).save(os.path.join(args.sortie, 'angle_%+d_avant_apres.png' % az))
log('termine')
