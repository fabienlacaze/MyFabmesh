"""Pour la vue de cote : rend le GLB final avec, par pixel, les coordonnees UV lues ; marque les pixels « plaque » (ecart avec la vue RealVisXL lissee) et lit le poids du texel correspondant."""
import json, math, sys, numpy as np, trimesh, moderngl, cv2
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
glb, dossier, vue_png, poids_dossiers = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:]
vj = json.load(open(dossier + '/vues.json')); nj = json.load(open(dossier + '/normalisation.json'))
EL, AZ, DIST, CADRE = vj['elevations'], vj['azimuts'], vj['distance'], vj['cadre']; centre = np.array(nj['centre']); echelle = nj['echelle']
sc = trimesh.load(glb, force='scene', process=False); mesh = list(sc.geometry.values())[0]
V = np.asarray(mesh.vertices, dtype=np.float64); F = np.asarray(mesh.faces, dtype=np.int32); UV = np.asarray(mesh.visual.uv, dtype=np.float32)
mat = mesh.visual.material; ATLAS = np.asarray((getattr(mat, 'baseColorTexture', None) or getattr(mat, 'image', None)).convert('RGB')); AH = ATLAS.shape[0]
M2S = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], dtype=np.float64); Vstd = (M2S @ ((V - centre) / echelle * 0.5).T).T.astype(np.float32)
k = 1; S = 1024
e, a = math.radians(EL[k]), math.radians(AZ[k]); p = np.array([DIST*math.cos(e)*math.cos(a), DIST*math.cos(e)*math.sin(a), DIST*math.sin(e)]); look = -p/np.linalg.norm(p)
droite = np.cross(look, [0, 0, 1.0]); droite /= np.linalg.norm(droite); haut = np.cross(droite, look); haut /= np.linalg.norm(haut)
ctx = moderngl.create_standalone_context()
prog = ctx.program(vertex_shader="""#version 330
uniform vec3 cp; uniform vec3 look; uniform vec3 droite; uniform vec3 haut; uniform float cadre; in vec3 in_pos; in vec2 in_uv; out vec2 uv;
void main(){ vec3 d = in_pos - cp; gl_Position = vec4(dot(droite,d)/cadre, -dot(haut,d)/cadre, (dot(look,d)-0.1)/99.9*2.0-1.0, 1.0); uv = in_uv; }""",
 fragment_shader="""#version 330
uniform sampler2D tex; in vec2 uv; layout(location=0) out vec4 o0; layout(location=1) out vec4 o1; void main(){ o0 = vec4(texture(tex, uv).rgb, 1.0); o1 = vec4(uv, 0.0, 1.0); }""")
vbo = ctx.buffer(np.hstack([Vstd, UV]).astype('f4').tobytes()); ibo = ctx.buffer(F.astype('i4').tobytes()); vao = ctx.vertex_array(prog, [(vbo, '3f 2f', 'in_pos', 'in_uv')], ibo)
tex = ctx.texture((AH, AH), 3, np.ascontiguousarray(np.flipud(ATLAS)).tobytes()); tex.build_mipmaps(); tex.filter = (moderngl.LINEAR_MIPMAP_LINEAR, moderngl.LINEAR); tex.use(0); prog['tex'].value = 0
c0 = ctx.texture((S, S), 4, dtype='f1'); c1 = ctx.texture((S, S), 4, dtype='f4'); dp = ctx.depth_renderbuffer((S, S)); fbo = ctx.framebuffer(color_attachments=[c0, c1], depth_attachment=dp); fbo.use()
ctx.enable(moderngl.DEPTH_TEST); ctx.disable(moderngl.CULL_FACE)
prog['cp'].value = tuple(p); prog['look'].value = tuple(look); prog['droite'].value = tuple(droite); prog['haut'].value = tuple(haut); prog['cadre'].value = CADRE
fbo.clear(0.5, 0.5, 0.5, 0.0, depth=1.0); vao.render(moderngl.TRIANGLES)
rgba = np.frombuffer(fbo.read(attachment=0, components=4), np.uint8).reshape(S, S, 4); uvim = np.frombuffer(fbo.read(attachment=1, components=4, dtype='f4'), np.float32).reshape(S, S, 4)
Image.fromarray(rgba[..., :3]).save('diag_rendu_final.png')
rv = np.asarray(Image.open(vue_png).convert('RGB')).astype(np.float32)
mask = rgba[..., 3] > 0
# zone de la caisse (comme dans les captures)
box = np.zeros((S, S), bool); box[170:520, 520:760] = True; sel = mask & box
d = np.abs(cv2.GaussianBlur(rgba[..., :3].astype(np.float32), (0, 0), 3) - cv2.GaussianBlur(rv, (0, 0), 3)).mean(-1)
print('ecart rendu final / vue lissee sur la caisse : moyenne %.1f ; 90e centile %.1f' % (d[sel].mean(), np.quantile(d[sel], 0.9)))
plaque = sel & (d > np.quantile(d[sel], 0.9)); hors = sel & ~plaque
ui = np.clip((uvim[..., 0] * AH).astype(int), 0, AH - 1); vi = np.clip(((1 - uvim[..., 1]) * AH).astype(int), 0, AH - 1)
for pd in poids_dossiers:
    W = np.zeros((S, S), np.float32)
    for kk in range(1, 6):
        w = np.load('%s/vue_%d/poids.npy' % (pd, kk), mmap_mode='r'); W += w[vi, ui].astype(np.float32) / 255
    print(pd, ': poids moyen (somme des 5 vues) texels « plaque » %.2f | autres %.2f | part de plaque avec poids < 0,3 : %.0f %%' % (W[plaque].mean(), W[hors].mean(), 100 * (W[plaque] < 0.3).mean()))
vis = np.where(plaque[..., None], np.array([255, 0, 0], np.uint8), rgba[..., :3]); Image.fromarray(vis).save('diag_plaques.png')
# --- couleurs lues aux memes texels : atlas final, atlas etape 1 (ancien), couleurs neuves des 5 vues
et1 = np.asarray(Image.open('bus_etape1/atlas_final_8k.jpg').convert('RGB'))
acc = np.zeros((S, S, 3), np.float32); Ws = np.zeros((S, S), np.float32)
for kk in range(1, 6):
    n = np.load('%s/vue_%d/nouveau.npy' % (poids_dossiers[0], kk), mmap_mode='r'); w = np.load('%s/vue_%d/poids.npy' % (poids_dossiers[0], kk), mmap_mode='r')[vi, ui].astype(np.float32) / 255
    acc += n[vi, ui].astype(np.float32) * w[..., None]; Ws += w
nou = acc / np.maximum(Ws, 1e-4)[..., None]
fin = ATLAS[vi, ui].astype(np.float32); anc = et1[vi, ui].astype(np.float32)
for nom, im in (('final (atlas lu)', fin), ('ancien (etape 1)', anc), ('couleur neuve reportee', nou), ('vue RealVisXL', rv)):
    print('%-26s plaque %s | hors %s' % (nom, np.round(im[plaque].mean(0)), np.round(im[hors].mean(0))))
print('--- par vue : poids moyen et couleur moyenne (plaque | hors)')
for kk in range(1, 6):
    n = np.load('%s/vue_%d/nouveau.npy' % (poids_dossiers[0], kk), mmap_mode='r'); w = np.load('%s/vue_%d/poids.npy' % (poids_dossiers[0], kk), mmap_mode='r')[vi, ui].astype(np.float32) / 255
    c = n[vi, ui].astype(np.float32)
    print('vue %d : poids %.2f | %.2f ; couleur %s | %s' % (kk, w[plaque].mean(), w[hors].mean(), np.round(c[plaque].mean(0)), np.round(c[hors].mean(0))))
# --- recouvrement des triangles dans l'espace UV : combien de triangles couvrent chaque texel ?
prog_c = ctx.program(vertex_shader="""#version 330
uniform vec2 tile; uniform float N; in vec2 in_uv; void main(){ gl_Position = vec4((in_uv * N - tile) * 2.0 - 1.0, 0.0, 1.0); }""",
 fragment_shader="""#version 330
layout(location=0) out vec4 o0; void main(){ o0 = vec4(1.0, 0.0, 0.0, 0.0); }""")
vbo_c = ctx.buffer(UV[F].reshape(-1, 2).astype('f4').tobytes()); vao_c = ctx.vertex_array(prog_c, [(vbo_c, '2f', 'in_uv')])
Nn = AH // 4096; CNT = np.zeros((AH, AH), np.uint8)
for tj in range(Nn):
    for ti in range(Nn):
        ct = ctx.texture((4096, 4096), 4, dtype='f4'); fb = ctx.framebuffer(color_attachments=[ct]); fb.use(); ctx.disable(moderngl.DEPTH_TEST)
        ctx.enable(moderngl.BLEND); ctx.blend_func = moderngl.ONE, moderngl.ONE; fb.clear(0, 0, 0, 0)
        prog_c['tile'].value = (float(ti), float(tj)); prog_c['N'].value = float(Nn); vao_c.render(moderngl.TRIANGLES)
        a_ = np.frombuffer(fb.read(components=4, dtype='f4'), np.float32).reshape(4096, 4096, 4)[::-1, :, 0]
        r0_, r1_ = (Nn - 1 - tj) * 4096, (Nn - tj) * 4096
        CNT[r0_:r1_, ti * 4096:(ti + 1) * 4096] = np.clip(a_, 0, 255).astype(np.uint8); ct.release(); fb.release()
ctx.disable(moderngl.BLEND)
c_ = CNT[vi, ui]
print('--- triangles par texel : atlas entier : >=2 triangles sur %.2f %% des texels couverts' % (100.0 * (CNT >= 2).sum() / max((CNT >= 1).sum(), 1)))
print('texels lus par les pixels « plaque » : >=2 triangles : %.0f %% | hors plaque : %.0f %%' % (100 * (c_[plaque] >= 2).mean(), 100 * (c_[hors] >= 2).mean()))
# --- plaques reperees par contraste LOCAL du rendu final (ecart a un flou median), dans l'interieur de la caisse
g = cv2.cvtColor(rgba[..., :3], cv2.COLOR_RGB2GRAY).astype(np.float32)
med = cv2.medianBlur(rgba[..., :3], 41); gm = cv2.cvtColor(med, cv2.COLOR_RGB2GRAY).astype(np.float32)
inner = np.zeros((S, S), bool); inner[260:480, 580:740] = True; inner &= mask
dev = g - gm
pl = inner & (np.abs(dev) > 4); ho = inner & (np.abs(dev) <= 1.5)
print('--- plaques par contraste local : %d pixels (hors %d)' % (pl.sum(), ho.sum()))
Image.fromarray(np.where(pl[..., None], np.array([255, 0, 0], np.uint8), rgba[..., :3])).crop((480, 120, 800, 560)).resize((640, 880)).save('diag_plaques2.png')
def stats(nom, arr):
    print('%-34s plaque %s | hors %s' % (nom, np.round(arr[pl].mean(0), 1), np.round(arr[ho].mean(0), 1)))
stats('final (atlas lu)', fin); stats('ancien (etape 1)', anc); stats('neuve reportee (5 vues)', nou); stats('vue RealVisXL', rv)
n1 = np.load('%s/vue_1/nouveau.npy' % poids_dossiers[0], mmap_mode='r'); w1 = np.load('%s/vue_1/poids.npy' % poids_dossiers[0], mmap_mode='r')
print('poids vue 1 : plaque %.2f | hors %.2f' % ((w1[vi, ui][pl] / 255).mean(), (w1[vi, ui][ho] / 255).mean()))
# la position lue par le projecteur est-elle la bonne ? rendu de la position 3D par pixel
prog_p = ctx.program(vertex_shader="""#version 330
uniform vec3 cp; uniform vec3 look; uniform vec3 droite; uniform vec3 haut; uniform float cadre; in vec3 in_pos; out vec3 pw;
void main(){ vec3 d = in_pos - cp; gl_Position = vec4(dot(droite,d)/cadre, -dot(haut,d)/cadre, (dot(look,d)-0.1)/99.9*2.0-1.0, 1.0); pw = in_pos; }""",
 fragment_shader="""#version 330
in vec3 pw; layout(location=0) out vec4 o0; void main(){ o0 = vec4(pw, 1.0); }""")
vbo_p = ctx.buffer(Vstd.astype('f4').tobytes()); vao_p = ctx.vertex_array(prog_p, [(vbo_p, '3f', 'in_pos')], ibo)
c2 = ctx.texture((S, S), 4, dtype='f4'); dp2 = ctx.depth_renderbuffer((S, S)); fb2 = ctx.framebuffer(color_attachments=[c2], depth_attachment=dp2); fb2.use(); ctx.enable(moderngl.DEPTH_TEST)
for nm_, vv_ in (('cp', p), ('look', look), ('droite', droite), ('haut', haut)): prog_p[nm_].value = tuple(vv_)
prog_p['cadre'].value = CADRE; fb2.clear(0, 0, 0, 0, depth=1.0); vao_p.render(moderngl.TRIANGLES)
PW = np.frombuffer(fb2.read(components=4, dtype='f4'), np.float32).reshape(S, S, 4)[..., :3]
# position du texel (POS) calculee comme le projecteur : rendu dans l'espace UV
prog_u = ctx.program(vertex_shader="""#version 330
uniform vec2 tile; uniform float N; in vec3 in_pos; in vec2 in_uv; out vec3 pw; void main(){ gl_Position = vec4((in_uv * N - tile) * 2.0 - 1.0, 0.0, 1.0); pw = in_pos; }""",
 fragment_shader="""#version 330
in vec3 pw; layout(location=0) out vec4 o0; void main(){ o0 = vec4(pw, 1.0); }""")
vbo_u = ctx.buffer(np.hstack([Vstd, UV]).astype('f4').tobytes()); vao_u = ctx.vertex_array(prog_u, [(vbo_u, '3f 2f', 'in_pos', 'in_uv')], ibo)
POSD = np.zeros((S, S, 3), np.float32); rows = np.unique(vi[pl | ho]); 
Tl = 4096
cache = {}
for tj in range(Nn):
    for ti in range(Nn):
        ct = ctx.texture((Tl, Tl), 4, dtype='f4'); fb = ctx.framebuffer(color_attachments=[ct]); fb.use(); ctx.disable(moderngl.DEPTH_TEST); fb.clear(0, 0, 0, 0)
        prog_u['tile'].value = (float(ti), float(tj)); prog_u['N'].value = float(Nn); vao_u.render(moderngl.TRIANGLES)
        P_ = np.frombuffer(fb.read(components=4, dtype='f4'), np.float32).reshape(Tl, Tl, 4)[::-1]
        r0_, r1_ = (Nn - 1 - tj) * Tl, (Nn - tj) * Tl
        dans_ = (vi >= r0_) & (vi < r1_) & (ui >= ti * Tl) & (ui < (ti + 1) * Tl)
        POSD[dans_] = P_[vi[dans_] - r0_, ui[dans_] - ti * Tl, :3]; ct.release(); fb.release()
err = np.linalg.norm(POSD - PW, axis=-1)
print('ecart position texel (UV) / position du pixel (rendu) : plaque %.4f | hors %.4f   (pixel de rendu = %.4f)' % (err[pl].mean(), err[ho].mean(), CADRE / S))
nul = (np.abs(POSD).sum(-1) == 0)
print('texel sans position (non couvert par un triangle au centre du texel) : plaque %.1f %% | hors %.1f %%' % (100 * nul[pl].mean(), 100 * nul[ho].mean()))
bad = err > 0.002
print('ecart > 0,002 (4 pixels de rendu) : plaque %.1f %% | hors %.1f %%' % (100 * bad[pl].mean(), 100 * bad[ho].mean()))
ok_ = pl & ~nul & ~bad
print('plaques avec position JUSTE : %.1f %%' % (100 * ok_.sum() / pl.sum()))
# distance moyenne parmi les positions fausses mais couvertes
pb = pl & bad & ~nul
if pb.any(): print('positions fausses mais couvertes : ecart moyen %.4f, mediane %.4f (%d px)' % (err[pb].mean(), np.median(err[pb]), pb.sum()))
# --- recalcule la couleur reportee depuis la position du texel (float32), a la main, et compare a nouveau.npy (float16 + grid_sample)
n1 = np.load('%s/vue_1/nouveau.npy' % poids_dossiers[0], mmap_mode='r')
rvv = rv  # vue RealVisXL (non recalee : --sans-flot)
d_ = POSD - p[None, None, :]
xc_ = (d_ * droite).sum(-1); yc_ = (d_ * haut).sum(-1)
u_ = (xc_ / CADRE + 1) / 2 * S - 0.5; v_ = (-yc_ / CADRE + 1) / 2 * S - 0.5       # indices de pixel (centre a l'entier)
mapx = u_.astype(np.float32); mapy = v_.astype(np.float32)
mine = cv2.remap(rvv, mapx, mapy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
proj = n1[vi, ui].astype(np.float32)
for nom, sel_ in (('plaque', pl), ('hors', ho)):
    print('%-7s recalcul main %s | nouveau.npy %s | vue au pixel %s | ecart moyen main/npy %.1f' % (nom, np.round(mine[sel_].mean(0), 1), np.round(proj[sel_].mean(0), 1), np.round(rvv[sel_].mean(0), 1), np.abs(mine[sel_] - proj[sel_]).mean()))
dev2 = g - gm
pl2 = inner & (np.abs(dev2) > 9)
print('--- plaques FORTES (|ecart| > 9) : %d pixels' % pl2.sum())
if pl2.sum():
    def st(nom, arr): print('%-26s plaque forte %s | hors %s' % (nom, np.round(arr[pl2].mean(0), 1), np.round(arr[ho].mean(0), 1)))
    st('final (atlas lu)', fin); st('ancien (etape 1)', anc); st('neuve (5 vues)', nou); st('vue RealVisXL', rv); st('recalcul main', mine)
    w1_ = np.load('%s/vue_1/poids.npy' % poids_dossiers[0], mmap_mode='r')[vi, ui].astype(np.float32) / 255
    print('poids vue 1 : plaque forte %.2f | hors %.2f ; texel sans position : %.1f %%' % (w1_[pl2].mean(), w1_[ho].mean(), 100 * nul[pl2].mean()))
    print('ecart position : %.4f' % err[pl2].mean())
