"""Rend quelques vues orthographiques (sans eclairage : la couleur de la texture telle quelle) d'un GLB texture, pour le banc SeedVR2 « vues rendues ».
Usage : python rendre_vues.py <glb> <dossier_sortie> [taille]   ->  <nom>.png (RGB sur fond clair) + <nom>_masque.png + <nom>.json (camera, pour reprojeter plus tard)."""
import json, os, sys
import numpy as np
import trimesh
import moderngl
from PIL import Image

glb, sortie = sys.argv[1], sys.argv[2]
S = int(sys.argv[3]) if len(sys.argv) > 3 else 1024
os.makedirs(sortie, exist_ok=True)

scene = trimesh.load(glb, force='scene', process=False)
mesh = list(scene.geometry.values())[0]
v = np.asarray(mesh.vertices, dtype=np.float64)
f = np.asarray(mesh.faces, dtype=np.int32)
uv = np.asarray(mesh.visual.uv, dtype=np.float32)
mat = mesh.visual.material
img = getattr(mat, 'baseColorTexture', None) or getattr(mat, 'image', None)
img = img.convert('RGB')
print('sommets', len(v), 'faces', len(f), 'texture', img.size)
assert len(uv) == len(v)

lo, hi = v.min(0), v.max(0)
centre = (lo + hi) / 2
haut = hi[1] - lo[1]
rayon = np.linalg.norm(v - centre, axis=1).max()

ctx = moderngl.create_standalone_context()
prog = ctx.program(vertex_shader="""#version 330
uniform mat4 mvp; in vec3 in_pos; in vec2 in_uv; out vec2 uv;
void main(){ gl_Position = mvp * vec4(in_pos, 1.0); uv = in_uv; }""", fragment_shader="""#version 330
uniform sampler2D tex; in vec2 uv; out vec4 col;
void main(){ col = vec4(texture(tex, uv).rgb, 1.0); }""")
tex = ctx.texture(img.size, 3, np.flipud(np.asarray(img)).tobytes())
tex.build_mipmaps(); tex.filter = (moderngl.LINEAR_MIPMAP_LINEAR, moderngl.LINEAR); tex.anisotropy = 8.0
tex.use(0); prog['tex'].value = 0
fbo = ctx.framebuffer(ctx.texture((S, S), 4), ctx.depth_renderbuffer((S, S)))
fbo.use(); ctx.enable(moderngl.DEPTH_TEST); ctx.disable(moderngl.CULL_FACE)


def vue(nom, az, cadre_h, cy):
    """az : rotation autour de Y en degres ; cadre_h : hauteur du cadre (unites du modele) ; cy : centre vertical du cadre (fraction de la hauteur du modele)."""
    a = np.radians(az)
    R = np.array([[np.cos(a), 0, np.sin(a)], [0, 1, 0], [-np.sin(a), 0, np.cos(a)]])
    p = (v - centre) @ R.T
    cy_m = (lo[1] - centre[1]) + cy * haut
    hw = hh = cadre_h / 2
    M = np.eye(4)
    M[0, 0] = 1 / hw; M[1, 1] = 1 / hh; M[1, 3] = -cy_m / hh; M[2, 2] = -1 / (rayon * 1.05)
    data = np.hstack([p.astype(np.float32), uv]).astype('f4')
    vbo = ctx.buffer(data.tobytes()); ibo = ctx.buffer(f.astype('i4').tobytes())
    vao = ctx.vertex_array(prog, [(vbo, '3f 2f', 'in_pos', 'in_uv')], ibo)
    prog['mvp'].write(M.T.astype('f4').tobytes())
    fbo.clear(1.0, 1.0, 1.0, 0.0, depth=1.0)
    vao.render(moderngl.TRIANGLES)
    raw = np.frombuffer(fbo.read(components=4), dtype=np.uint8).reshape(S, S, 4)[::-1]
    rgb = raw[:, :, :3].copy(); masque = raw[:, :, 3]
    Image.fromarray(rgb).save(os.path.join(sortie, nom + '.png'))
    Image.fromarray(masque).save(os.path.join(sortie, nom + '_masque.png'))
    json.dump({'az': az, 'cadre_h': cadre_h, 'cy_m': float(cy_m), 'centre': centre.tolist(), 'rayon': float(rayon), 'taille': S}, open(os.path.join(sortie, nom + '.json'), 'w'))
    print(nom, 'ok', 'pixels objet', int((masque > 0).sum()))


cadre = haut * 1.08
vue('face', 0, cadre, 0.5)
vue('dos', 180, cadre, 0.5)
vue('trois_quarts', 35, cadre, 0.5)
vue('gros_plan_haut', 0, haut * 0.42, 0.74)
