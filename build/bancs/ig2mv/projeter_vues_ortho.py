"""Reporte les vues generees par MV-Adapter « image + forme » (cameras orthographiques CONNUES, voir ig2mv_sans_nvdiffrast.py) sur l'atlas, texel par texel.
Meme principe que projeter_source7.py (visibilite par profondeur et angle, recalage local par flot optique sur les images de structure), mais avec les cameras exactes.
Enregistre, pour chaque vue, nouveau.npy (couleurs) et poids.npy (poids 0-255), a combiner avec combiner_vues.py.
Usage : python projeter_vues_ortho.py <maillage.glb> <dossier_ig2mv> <sortie> [--vues 1,2,3,4,5] [--source-vue vue_{i}.png] [--tol 0.006] [--cos-min 0.35] [--sans-flot]"""
import argparse, json, math, os, sys, time
import numpy as np
import cv2
import torch
import trimesh
import moderngl
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument('glb'); ap.add_argument('dossier'); ap.add_argument('sortie')
ap.add_argument('--vues', default='1,2,3,4,5')
ap.add_argument('--modele', default='vue_%d.png')       # nom du fichier de chaque vue dans le dossier (ex. vue_sr_%d.png pour des vues agrandies)
ap.add_argument('--tol', type=float, default=0.006)
ap.add_argument('--cos-min', type=float, default=0.35)
ap.add_argument('--sans-flot', action='store_true')
ap.add_argument('--tuile', type=int, default=4096)
ap.add_argument('--debug-facteurs', action='store_true')   # enregistre (2048 px) les trois facteurs du poids : profondeur, angle, masque
ap.add_argument('--normales-sommets', action='store_true')   # ancien comportement : normales par sommet de TRELLIS (incoherentes sur les grandes faces)
args = ap.parse_args()
os.makedirs(args.sortie, exist_ok=True)
Image.MAX_IMAGE_PIXELS = None
T0 = time.time()


def log(*a):
    print('[%5.1fs]' % (time.time() - T0), *a, flush=True)


vj = json.load(open(os.path.join(args.dossier, 'vues.json')))
nj = json.load(open(os.path.join(args.dossier, 'normalisation.json')))
EL, AZ, DIST, CADRE = vj['elevations'], vj['azimuts'], vj['distance'], vj['cadre']
centre = np.array(nj['centre']); echelle = nj['echelle']

sc = trimesh.load(args.glb, force='scene', process=False)
mesh = list(sc.geometry.values())[0]
V = np.asarray(mesh.vertices, dtype=np.float64); F = np.asarray(mesh.faces, dtype=np.int32)
UV = np.asarray(mesh.visual.uv, dtype=np.float32); NRM = np.asarray(mesh.vertex_normals, dtype=np.float32)
mat = mesh.visual.material
ATLAS = np.asarray((getattr(mat, 'baseColorTexture', None) or getattr(mat, 'image', None)).convert('RGB')); AH = ATLAS.shape[0]
M2S = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], dtype=np.float64)
Vstd = (M2S @ ((V - centre) / echelle * 0.5).T).T.astype(np.float32)
Nstd = (M2S @ NRM.T.astype(np.float64)).T.astype(np.float32)
Nstd /= np.maximum(np.linalg.norm(Nstd, axis=1, keepdims=True), 1e-8)
log('maillage', len(V), 'sommets ; atlas', ATLAS.shape)


def camera(el, az):
    e, a = math.radians(el), math.radians(az)
    p = np.array([DIST * math.cos(e) * math.cos(a), DIST * math.cos(e) * math.sin(a), DIST * math.sin(e)])
    look = -p / np.linalg.norm(p)
    droite = np.cross(look, [0, 0, 1.0]); droite /= np.linalg.norm(droite)
    haut = np.cross(droite, look); haut /= np.linalg.norm(haut)
    return p, look, droite, haut


ctx = moderngl.create_standalone_context()
prog = ctx.program(vertex_shader="""#version 330
uniform vec3 cp; uniform vec3 look; uniform vec3 droite; uniform vec3 haut; uniform float cadre;
in vec3 in_pos; in vec2 in_uv; out vec2 uv; out float prof;
void main(){
  vec3 d = in_pos - cp; float xc = dot(droite, d), yc = dot(haut, d); prof = dot(look, d);
  gl_Position = vec4(xc / cadre, -yc / cadre, (prof - 0.1) / 99.9 * 2.0 - 1.0, 1.0); uv = in_uv;
}""", fragment_shader="""#version 330
uniform sampler2D tex; in vec2 uv; in float prof; layout(location=0) out vec4 o0; layout(location=1) out vec4 o1;
void main(){ o0 = vec4(texture(tex, uv).rgb, 1.0); o1 = vec4(prof, 0.0, 0.0, 1.0); }""")
vbo = ctx.buffer(np.hstack([Vstd, UV]).astype('f4').tobytes()); ibo = ctx.buffer(F.astype('i4').tobytes())
vao = ctx.vertex_array(prog, [(vbo, '3f 2f', 'in_pos', 'in_uv')], ibo)
tex = ctx.texture((AH, AH), 3, np.ascontiguousarray(np.flipud(ATLAS)).tobytes()); tex.build_mipmaps(); tex.filter = (moderngl.LINEAR_MIPMAP_LINEAR, moderngl.LINEAR); tex.anisotropy = 8.0
tex.use(0); prog['tex'].value = 0


def rendre(i, taille):
    p, look, droite, haut = camera(EL[i], AZ[i])
    prog['cp'].value = tuple(p); prog['look'].value = tuple(look); prog['droite'].value = tuple(droite); prog['haut'].value = tuple(haut); prog['cadre'].value = CADRE
    c0 = ctx.texture((taille, taille), 4, dtype='f1'); c1 = ctx.texture((taille, taille), 4, dtype='f4'); dp = ctx.depth_renderbuffer((taille, taille))
    fbo = ctx.framebuffer(color_attachments=[c0, c1], depth_attachment=dp); fbo.use()
    ctx.enable(moderngl.DEPTH_TEST); ctx.disable(moderngl.CULL_FACE); fbo.clear(0.5, 0.5, 0.5, 0.0, depth=1.0)
    vao.render(moderngl.TRIANGLES)
    rgba = np.frombuffer(fbo.read(attachment=0, components=4), np.uint8).reshape(taille, taille, 4)
    prof = np.frombuffer(fbo.read(attachment=1, components=4, dtype='f4'), np.float32).reshape(taille, taille, 4)[..., 0].copy()
    for o in (c0, c1, dp, fbo):
        o.release()
    return rgba[..., :3].copy(), rgba[..., 3] > 0, prof


def structure(img_rgb, flou=1.5, loc=8):
    g = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
    g = cv2.GaussianBlur(g, (0, 0), flou)
    mu = cv2.GaussianBlur(g, (0, 0), loc); var = cv2.GaussianBlur((g - mu) ** 2, (0, 0), loc)
    return (g - mu) / np.sqrt(var + 1e-3)


# positions et normales des texels (rendu dans l'espace UV), en coordonnees du MAILLAGE d'origine
prog_uv = ctx.program(vertex_shader="""#version 330
uniform vec2 tile; uniform float N; in vec3 in_pos; in vec2 in_uv; in vec3 in_nrm; out vec3 p; out vec3 n;
void main(){ gl_Position = vec4((in_uv * N - tile) * 2.0 - 1.0, 0.0, 1.0); p = in_pos; n = in_nrm; }""", fragment_shader="""#version 330
in vec3 p; in vec3 n; layout(location=0) out vec4 o0; layout(location=1) out vec4 o1;
void main(){ o0 = vec4(p, 1.0); o1 = vec4(n, 1.0); }""")
if args.normales_sommets:
    vbo2 = ctx.buffer(np.hstack([Vstd, UV, Nstd]).astype('f4').tobytes())     # coordonnees STD directement (meme repere que les cameras)
    vao2 = ctx.vertex_array(prog_uv, [(vbo2, '3f 2f 3f', 'in_pos', 'in_uv', 'in_nrm')], ibo)
else:
    # normales GEOMETRIQUES de chaque triangle (sommets dupliques par face) : celles de TRELLIS sont aberrantes sur les grandes faces planes et faisaient des plaques
    P3 = Vstd[F]; nf = np.cross(P3[:, 1] - P3[:, 0], P3[:, 2] - P3[:, 0]); nf /= np.maximum(np.linalg.norm(nf, axis=1, keepdims=True), 1e-12)
    donnees = np.concatenate([P3, UV[F], np.repeat(nf[:, None, :], 3, axis=1)], axis=2).reshape(-1, 8).astype('f4')
    vbo2 = ctx.buffer(donnees.tobytes()); vao2 = ctx.vertex_array(prog_uv, [(vbo2, '3f 2f 3f', 'in_pos', 'in_uv', 'in_nrm')])
    log('normales geometriques par face : %d triangles' % len(F))
Tl = min(args.tuile, AH); N = AH // Tl
dev = torch.device('cuda')
POS = np.zeros((AH, AH, 3), np.float16); NR = np.zeros((AH, AH, 3), np.float16); VALIDE = np.zeros((AH, AH), bool)
for tj in range(N):
    for ti in range(N):
        c0 = ctx.texture((Tl, Tl), 4, dtype='f4'); c1 = ctx.texture((Tl, Tl), 4, dtype='f4'); fbo = ctx.framebuffer(color_attachments=[c0, c1]); fbo.use()
        ctx.disable(moderngl.DEPTH_TEST); fbo.clear(0.0, 0.0, 0.0, 0.0)
        prog_uv['tile'].value = (float(ti), float(tj)); prog_uv['N'].value = float(N)
        vao2.render(moderngl.TRIANGLES)
        P = np.frombuffer(fbo.read(attachment=0, components=4, dtype='f4'), np.float32).reshape(Tl, Tl, 4)[::-1]
        Nn = np.frombuffer(fbo.read(attachment=1, components=4, dtype='f4'), np.float32).reshape(Tl, Tl, 4)[::-1]
        r0_, r1_ = (N - 1 - tj) * Tl, (N - tj) * Tl
        POS[r0_:r1_, ti * Tl:(ti + 1) * Tl] = P[..., :3]; NR[r0_:r1_, ti * Tl:(ti + 1) * Tl] = Nn[..., :3]; VALIDE[r0_:r1_, ti * Tl:(ti + 1) * Tl] = P[..., 3] > 0.5
        c0.release(); c1.release(); fbo.release()
log('positions des texels calculees : %.1f %% valides' % (100.0 * VALIDE.mean()))

for k in [int(x) for x in args.vues.split(',') if x]:
    t1 = time.time()
    chemin = os.path.join(args.dossier, args.modele % k)
    gen = np.asarray(Image.open(chemin).convert('RGB'))
    S = gen.shape[0]
    p, look, droite, haut = camera(EL[k], AZ[k])
    rr, mr, prof = rendre(k, S)
    KS = S / 1024.0
    ALIGN = gen
    if not args.sans_flot:
        sr = structure(np.where(mr[..., None], rr, 128).astype(np.uint8), 1.5 * KS, 8 * KS); sp = structure(gen, 2.0 * KS, 8 * KS)
        mm = mr & (cv2.erode(mr.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0)
        u8 = lambda x: np.clip(x * 40 + 128, 0, 255).astype(np.uint8)
        flow = cv2.calcOpticalFlowFarneback(u8(sr), u8(sp), None, 0.5, 5, max(int(31 * KS) | 1, 15), 6, 7, 1.5, 0)
        zone = cv2.dilate(mr.astype(np.uint8), np.ones((9, 9), np.uint8)).astype(np.float32)
        flow = cv2.GaussianBlur(flow, (0, 0), 6 * KS) * zone[..., None]
        mag = np.linalg.norm(flow, axis=2); flow *= np.minimum(1.0, 14 * KS / np.maximum(mag, 1e-6))[..., None]
        gx, gy = np.meshgrid(np.arange(S, dtype=np.float32), np.arange(S, dtype=np.float32))
        ALIGN = cv2.remap(gen, gx + flow[..., 0], gy + flow[..., 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        spw = cv2.remap(sp, gx + flow[..., 0], gy + flow[..., 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        def ncc(a, b, m):
            x = a[m]; y = b[m]; x = x - x.mean(); y = y - y.mean()
            return float((x * y).mean() / (x.std() * y.std() + 1e-6))
        log('vue %d : flot %.1f px en moyenne ; correlation de structure %.3f -> %.3f' % (k, np.linalg.norm(flow[mr], axis=1).mean(), ncc(sr, sp, mm), ncc(sr, spw, mm)))
    # sauts de profondeur (bords d'occlusion) et fond de l'image generee
    pn = np.where(mr, prof, 0).astype(np.float32)
    saut = (cv2.dilate(pn, np.ones((5, 5), np.uint8)) - cv2.erode(pn, np.ones((5, 5), np.uint8))) > 0.02
    bord = cv2.dilate(saut.astype(np.uint8), np.ones((5, 5), np.uint8)) == 0
    objet = (np.linalg.norm(ALIGN.astype(np.float32) - 128, axis=2) > 12) & (cv2.erode(mr.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0)
    masque = cv2.GaussianBlur((objet & bord).astype(np.float32), (0, 0), 1.5)
    MT = torch.from_numpy(masque).to(dev)[None, None]; PT = torch.from_numpy(prof).to(dev)
    GT = torch.from_numpy(ALIGN).to(dev).permute(2, 0, 1)[None].float()
    dr = torch.tensor(droite, dtype=torch.float32, device=dev); hh = torch.tensor(haut, dtype=torch.float32, device=dev); lk = torch.tensor(look, dtype=torch.float32, device=dev); pp = torch.tensor(p, dtype=torch.float32, device=dev)
    NOUV = np.empty_like(ATLAS); POIDS = np.zeros((AH, AH), np.uint8); couvert = 0; total = int(VALIDE.sum()); diag = []
    if args.debug_facteurs:
        D_VIS = np.zeros((AH, AH), np.uint8); D_ANG = np.zeros((AH, AH), np.uint8); D_MK = np.zeros((AH, AH), np.uint8)
    for r0_ in range(0, AH, 2048):
        pos = torch.from_numpy(POS[r0_:r0_ + 2048].astype(np.float32)).to(dev); nrm = torch.from_numpy(NR[r0_:r0_ + 2048].astype(np.float32)).to(dev)
        val = torch.from_numpy(VALIDE[r0_:r0_ + 2048]).to(dev)
        d = pos - pp
        xc = (d * dr).sum(-1); yc = (d * hh).sum(-1); pr = (d * lk).sum(-1)
        u = (xc / CADRE + 1) / 2 * S; v = (-yc / CADRE + 1) / 2 * S
        dans = (u >= 0) & (u <= S - 1) & (v >= 0) & (v <= S - 1)
        ui = u.long().clamp(0, S - 1); vi = v.long().clamp(0, S - 1)
        vis = (pr - PT[vi, ui]).abs() < args.tol
        nn = torch.nn.functional.normalize(nrm, dim=-1)
        cs = (-(nn * lk).sum(-1)).abs()     # la visibilite est deja assuree par le test de profondeur : une normale retournee ne doit pas ecarter un texel visible
        wang = ((cs - args.cos_min) / 0.3).clamp(0, 1)
        grille = torch.stack([u / (S - 1) * 2 - 1, v / (S - 1) * 2 - 1], dim=-1)[None]
        mk = torch.nn.functional.grid_sample(MT, grille, mode='bilinear', padding_mode='zeros', align_corners=True)[0, 0]
        col = torch.nn.functional.grid_sample(GT, grille, mode='bilinear', padding_mode='border', align_corners=True)[0]
        a = (val & vis & dans).float() * wang * mk
        if args.debug_facteurs:
            D_VIS[r0_:r0_ + 2048] = ((val & vis & dans).float() * 255).byte().cpu().numpy(); D_ANG[r0_:r0_ + 2048] = (wang * val.float() * 255).byte().cpu().numpy(); D_MK[r0_:r0_ + 2048] = (mk * val.float() * 255).byte().cpu().numpy()
        NOUV[r0_:r0_ + 2048] = col.permute(1, 2, 0).clamp(0, 255).byte().cpu().numpy(); POIDS[r0_:r0_ + 2048] = (a * 255).byte().cpu().numpy()
        couvert += int((a > 0.5).sum())
        if r0_ == 0 or True:
            nv = max(int(val.sum()), 1)
            diag.append((nv, int((val & dans).sum()), int((val & dans & vis).sum()), int((val & (cs > args.cos_min)).sum()), int((val & dans & (mk > 0.5)).sum()), int((val & dans & vis & (cs > args.cos_min) & (mk > 0.5)).sum()), int((val & vis & (cs > args.cos_min)).sum()), int((val & vis & (mk > 0.5)).sum())))
        del pos, nrm, val, d, xc, yc, pr, u, v, col, a
        torch.cuda.empty_cache()
    dg = np.array(diag).sum(0); log('   diag vue %d : valides %d | dans image %.1f %% | visibles(prof) %.1f %% | cos>min %.1f %% | masque>0,5 %.1f %% | tout %.1f %% | vis&cos %.1f %% | vis&masque %.1f %%' % (k, dg[0], 100 * dg[1] / dg[0], 100 * dg[2] / dg[0], 100 * dg[3] / dg[0], 100 * dg[4] / dg[0], 100 * dg[5] / dg[0], 100 * dg[6] / dg[0], 100 * dg[7] / dg[0]))
    dossier_v = os.path.join(args.sortie, 'vue_%d' % k); os.makedirs(dossier_v, exist_ok=True)
    if args.debug_facteurs:
        for nom_, arr_ in (('vis', D_VIS), ('ang', D_ANG), ('mask', D_MK), ('poids', POIDS)):
            Image.fromarray(cv2.resize(arr_, (2048, 2048), interpolation=cv2.INTER_AREA)).save(os.path.join(dossier_v, 'facteur_%s.png' % nom_))
    np.save(os.path.join(dossier_v, 'nouveau.npy'), NOUV); np.save(os.path.join(dossier_v, 'poids.npy'), POIDS)
    log('vue %d (az %s, el %s) : %.2f %% des texels utiles projetes (%.1f s)' % (k, AZ[k], EL[k], 100.0 * couvert / max(total, 1), time.time() - t1))
log('termine')
