"""Rend la texture ACTUELLE d'un maillage sous les 6 cameras orthographiques de MV-Adapter (memes cameras que ig2mv_sans_nvdiffrast.py), sans rien inventer.
Les images sortent a 1024 px, fond gris 128, pretes a etre agrandies par SeedVR2 puis reportees par projeter_vues_ortho.py (--modele vue_sr_%d.png).
Usage : python rendre_vues_ortho.py <maillage.glb> <dossier_ig2mv_du_meme_maillage> <sortie> [--taille 1024]"""
import argparse, json, math, os, shutil
import numpy as np
import trimesh, moderngl
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument('glb'); ap.add_argument('dossier'); ap.add_argument('sortie')
ap.add_argument('--taille', type=int, default=1024)
args = ap.parse_args()
os.makedirs(args.sortie, exist_ok=True)
for f in ('vues.json', 'normalisation.json'):
    shutil.copy(os.path.join(args.dossier, f), os.path.join(args.sortie, f))
vj = json.load(open(os.path.join(args.dossier, 'vues.json'))); nj = json.load(open(os.path.join(args.dossier, 'normalisation.json')))
EL, AZ, DIST, CADRE = vj['elevations'], vj['azimuts'], vj['distance'], vj['cadre']
centre = np.array(nj['centre']); echelle = nj['echelle']
sc = trimesh.load(args.glb, force='scene', process=False); mesh = list(sc.geometry.values())[0]
V = np.asarray(mesh.vertices, dtype=np.float64); F = np.asarray(mesh.faces, dtype=np.int32); UV = np.asarray(mesh.visual.uv, dtype=np.float32)
mat = mesh.visual.material
ATLAS = np.asarray((getattr(mat, 'baseColorTexture', None) or getattr(mat, 'image', None)).convert('RGB')); AH = ATLAS.shape[0]
M2S = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], dtype=np.float64)
Vstd = (M2S @ ((V - centre) / echelle * 0.5).T).T.astype(np.float32)


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
in vec3 in_pos; in vec2 in_uv; out vec2 uv;
void main(){
  vec3 d = in_pos - cp; float xc = dot(droite, d), yc = dot(haut, d), prof = dot(look, d);
  gl_Position = vec4(xc / cadre, -yc / cadre, (prof - 0.1) / 99.9 * 2.0 - 1.0, 1.0); uv = in_uv;
}""", fragment_shader="""#version 330
uniform sampler2D tex; in vec2 uv; layout(location=0) out vec4 o0;
void main(){ o0 = vec4(texture(tex, uv).rgb, 1.0); }""")
vbo = ctx.buffer(np.hstack([Vstd, UV]).astype('f4').tobytes()); ibo = ctx.buffer(F.astype('i4').tobytes())
vao = ctx.vertex_array(prog, [(vbo, '3f 2f', 'in_pos', 'in_uv')], ibo)
tex = ctx.texture((AH, AH), 3, np.ascontiguousarray(np.flipud(ATLAS)).tobytes()); tex.build_mipmaps(); tex.filter = (moderngl.LINEAR_MIPMAP_LINEAR, moderngl.LINEAR); tex.anisotropy = 8.0
tex.use(0); prog['tex'].value = 0
S = args.taille
c0 = ctx.texture((S, S), 4, dtype='f1'); dp = ctx.depth_renderbuffer((S, S)); fbo = ctx.framebuffer(color_attachments=[c0], depth_attachment=dp); fbo.use()
ctx.enable(moderngl.DEPTH_TEST); ctx.disable(moderngl.CULL_FACE)
for i in range(6):
    p, look, droite, haut = camera(EL[i], AZ[i])
    prog['cp'].value = tuple(p); prog['look'].value = tuple(look); prog['droite'].value = tuple(droite); prog['haut'].value = tuple(haut); prog['cadre'].value = CADRE
    fbo.clear(0.5, 0.5, 0.5, 0.0, depth=1.0)
    vao.render(moderngl.TRIANGLES)
    rgba = np.frombuffer(fbo.read(components=4), np.uint8).reshape(S, S, 4)
    img = np.where(rgba[..., 3:4] > 0, rgba[..., :3], 128).astype(np.uint8)
    Image.fromarray(img).save(os.path.join(args.sortie, 'vue_%d.png' % i))
    print('vue', i, 'ok', flush=True)
