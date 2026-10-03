"""Essai #5 (version reduite : les dossiers vue_k par variante ont ete effaces, seuls les GLB finaux des combinaisons du 02/10 subsistent) : test de la CAUSE supposee des contours polygonaux.
Hypothese du plan : les plaques viennent du gain basse frequence par cellule de 8 texels. Prediction : un gain par cellule de 64 / 256 texels ou un gain GLOBAL les fait disparaitre.
Mesure : rendu de la vue de cote (k=1 de bus_realvis, meme camera que diag_polygones.py) de chaque GLB final ; 'contours fantomes' = contours du rendu (Canny) a plus de 3 px de tout contour de la vue
RealVisXL lissee de reference, dans la zone de la caisse, + composantes connexes >= 15 px (proxy des plaques polygonales). Les variantes A (gain par ilot), B, C (ajustement differentiable) n'ont PAS ete construites.
Usage : python essai5_plaques.py"""
import json, math, os, sys
import numpy as np, trimesh, moderngl, cv2
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
BASE = 'C:/tmp/bench_tex/ig2mv'
vj = json.load(open(BASE + '/bus_realvis/vues.json')); nj = json.load(open(BASE + '/bus_realvis/normalisation.json'))
EL, AZ, DIST, CADRE = vj['elevations'], vj['azimuts'], vj['distance'], vj['cadre']; centre = np.array(nj['centre']); echelle = nj['echelle']
M2S = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], dtype=np.float64)
k = 1; S = 1024
e, a = math.radians(EL[k]), math.radians(AZ[k]); p = np.array([DIST * math.cos(e) * math.cos(a), DIST * math.cos(e) * math.sin(a), DIST * math.sin(e)]); look = -p / np.linalg.norm(p)
droite = np.cross(look, [0, 0, 1.0]); droite /= np.linalg.norm(droite); haut = np.cross(droite, look); haut /= np.linalg.norm(haut)
ctx = moderngl.create_standalone_context()
prog = ctx.program(vertex_shader="""#version 330
uniform vec3 cp; uniform vec3 look; uniform vec3 droite; uniform vec3 haut; uniform float cadre; in vec3 in_pos; in vec2 in_uv; out vec2 uv;
void main(){ vec3 d = in_pos - cp; gl_Position = vec4(dot(droite,d)/cadre, -dot(haut,d)/cadre, (dot(look,d)-0.1)/99.9*2.0-1.0, 1.0); uv = in_uv; }""", fragment_shader="""#version 330
uniform sampler2D tex; in vec2 uv; out vec4 o0; void main(){ o0 = vec4(texture(tex, uv).rgb, 1.0); }""")
fbo = ctx.framebuffer(ctx.texture((S, S), 4, dtype='f1'), ctx.depth_renderbuffer((S, S)))


def rendre(glb):
    sc = trimesh.load(glb, force='scene', process=False); mesh = list(sc.geometry.values())[0]
    V = np.asarray(mesh.vertices, dtype=np.float64); F = np.asarray(mesh.faces, dtype=np.int32); UV = np.asarray(mesh.visual.uv, dtype=np.float32)
    mat = mesh.visual.material; A = np.asarray((getattr(mat, 'baseColorTexture', None) or getattr(mat, 'image', None)).convert('RGB')); AH = A.shape[0]
    Vs = (M2S @ ((V - centre) / echelle * 0.5).T).T.astype(np.float32)
    vbo = ctx.buffer(np.hstack([Vs, UV]).astype('f4').tobytes()); ibo = ctx.buffer(F.astype('i4').tobytes()); vao = ctx.vertex_array(prog, [(vbo, '3f 2f', 'in_pos', 'in_uv')], ibo)
    tex = ctx.texture((AH, AH), 3, np.ascontiguousarray(np.flipud(A)).tobytes()); tex.build_mipmaps(); tex.filter = (moderngl.LINEAR_MIPMAP_LINEAR, moderngl.LINEAR); tex.use(0); prog['tex'].value = 0
    fbo.use(); ctx.enable(moderngl.DEPTH_TEST); ctx.disable(moderngl.CULL_FACE)
    prog['cp'].value = tuple(p); prog['look'].value = tuple(look); prog['droite'].value = tuple(droite); prog['haut'].value = tuple(haut); prog['cadre'].value = CADRE
    fbo.clear(0.5, 0.5, 0.5, 0.0, depth=1.0); vao.render(moderngl.TRIANGLES)
    rgba = np.frombuffer(fbo.read(components=4), np.uint8).reshape(S, S, 4).copy()
    for o in (vbo, ibo, vao, tex): o.release()
    return rgba[..., :3], rgba[..., 3] > 0


rv = np.asarray(Image.open(BASE + '/bus_realvis/vue_1.png').convert('RGB'))
box = np.zeros((S, S), bool); box[170:520, 520:760] = True


def contours(rgb):
    g = cv2.GaussianBlur(cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY), (0, 0), 1.0); return cv2.Canny(g, 30, 80) > 0


ERV = contours(rv)
dRV = cv2.distanceTransform((~ERV).astype(np.uint8), cv2.DIST_L2, 3)
out = {}
cands = [('etape1_avant_projection', None), ('final_rv (cellule 8, reference du plan)', BASE + '/bus_final_rv/modele.glb'), ('g64 (cellule 64)', BASE + '/bus_final_rv_g64/modele.glb'),
         ('g256 (cellule 256)', BASE + '/bus_final_rv_g256/modele.glb'), ('gg (gain global)', BASE + '/bus_final_rv_gg/modele.glb'), ('k32', BASE + '/bus_final_rv_k32/modele.glb'), ('k64', BASE + '/bus_final_rv_k64/modele.glb'),
         ('sf', BASE + '/bus_final_rv_sf/modele.glb'), ('t0.015', BASE + '/bus_final_rv_t0.015/modele.glb'), ('t0.04', BASE + '/bus_final_rv_t0.04/modele.glb')]
os.makedirs('C:/tmp/texture_essais/essai5', exist_ok=True)
ref_glb = BASE + '/bus_final_rv/modele.glb'
for nom, glb in cands:
    if glb is None:
        glb = ref_glb
        # etape 1 = atlas avant projection : meme maillage que bus_final_rv avec atlas_avant_8k
        sc = trimesh.load(glb, force='scene', process=False); m = list(sc.geometry.values())[0]
        img = Image.open(BASE + '/bus_final_rv/atlas_avant_8k.jpg'); img.load(); m.visual.material.baseColorTexture = img
        tmp = 'C:/tmp/texture_essais/essai5/_avant.glb'; sc.export(tmp); glb = tmp
    if not os.path.exists(glb): out[nom] = 'absent'; continue
    r, m = rendre(glb)
    er = contours(r) & box & m; ghost = er & (dRV > 3.0)
    n, lab, st, _ = cv2.connectedComponentsWithStats(ghost.astype(np.uint8), connectivity=8)
    seg = int(sum(1 for i in range(1, n) if st[i, cv2.CC_STAT_AREA] >= 15))
    lr = cv2.cvtColor(r, cv2.COLOR_RGB2GRAY).astype(np.float32); lv = cv2.cvtColor(rv, cv2.COLOR_RGB2GRAY).astype(np.float32)
    b = cv2.GaussianBlur(lr, (0, 0), 3) - cv2.GaussianBlur(lv, (0, 0), 3)
    out[nom] = {'contours_rendu_px': int(er.sum()), 'contours_fantomes_px': int(ghost.sum()), 'segments_fantomes': seg, 'ecart_lisse_moyen_niveaux': round(float(np.abs(b)[box & m].mean()), 2),
                'gradient_moyen_zone': round(float(np.hypot(cv2.Sobel(cv2.GaussianBlur(lr, (0, 0), 2), cv2.CV_32F, 1, 0), cv2.Sobel(cv2.GaussianBlur(lr, (0, 0), 2), cv2.CV_32F, 0, 1))[box & m].mean()), 2)}
    Image.fromarray(r[170:520, 520:760]).save('C:/tmp/texture_essais/essai5/%s.png' % nom.split(' ')[0])
    print(nom, out[nom], flush=True)
json.dump(out, open('C:/tmp/texture_essais/essai5/plaques.json', 'w'), indent=1, ensure_ascii=False)
