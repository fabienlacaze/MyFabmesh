"""Rend un GLB (couleur de base + ombrage plat) hors fenetre, sans passer par l'appli (utile quand l'ecran est verrouille : le visualiseur de l'appli ne se peint plus).
Usage : python rendre_glb.py <sortie.png> <az_deg> <glb1> [<glb2> ...]  -> une planche horizontale, une vue par maillage."""
import math, os, sys
import numpy as np
import trimesh, moderngl
from PIL import Image, ImageDraw, ImageFont
Image.MAX_IMAGE_PIXELS = None

sortie, az = sys.argv[1], float(sys.argv[2])
chemins = sys.argv[3:]
ctx = moderngl.create_standalone_context()
prog = ctx.program(vertex_shader="""#version 330
uniform mat4 mvp; uniform mat4 mv; in vec3 p; in vec2 uv; out vec2 u; out vec3 vp;
void main(){ u = uv; vp = (mv * vec4(p,1.0)).xyz; gl_Position = mvp * vec4(p,1.0); }""", fragment_shader="""#version 330
uniform sampler2D tex; uniform int avec_tex; uniform vec3 couleur; in vec2 u; in vec3 vp; out vec4 o;
void main(){
  vec3 n = normalize(cross(dFdx(vp), dFdy(vp))); if (n.z < 0.0) n = -n;
  vec3 l = normalize(vec3(0.4, 0.6, 0.7));
  float d = 0.45 + 0.55 * max(dot(n, l), 0.0);
  vec3 c = avec_tex == 1 ? texture(tex, u).rgb : couleur;
  o = vec4(c * d, 1.0);
}""")


def rendre(chemin, S=480):
    sc = trimesh.load(chemin, force='scene', process=False)
    gs = list(sc.geometry.values())
    allv = np.vstack([np.asarray(g.vertices, dtype=np.float64) for g in gs])
    c = (allv.min(0) + allv.max(0)) / 2; r = np.linalg.norm(allv.max(0) - allv.min(0)) / 2
    az_r = math.radians(az); el = math.radians(8)
    cam = np.array([math.sin(az_r) * math.cos(el), math.sin(el), math.cos(az_r) * math.cos(el)]) * 3.2
    f = -cam / np.linalg.norm(cam); s_ = np.cross(f, [0, 1, 0]); s_ /= np.linalg.norm(s_); u_ = np.cross(s_, f)
    view = np.eye(4); view[0, :3] = s_; view[1, :3] = u_; view[2, :3] = -f; view[:3, 3] = -view[:3, :3] @ cam
    fov = math.radians(32); n_, f_ = 0.5, 10.0; t = 1 / math.tan(fov / 2)
    proj = np.array([[t, 0, 0, 0], [0, t, 0, 0], [0, 0, -(f_ + n_) / (f_ - n_), -2 * f_ * n_ / (f_ - n_)], [0, 0, -1, 0]])
    prog['mv'].write(np.ascontiguousarray(view.T.astype('f4'))); prog['mvp'].write(np.ascontiguousarray((proj @ view).T.astype('f4')))
    col = ctx.texture((S, S), 4, dtype='f1'); dp = ctx.depth_renderbuffer((S, S)); fbo = ctx.framebuffer(color_attachments=[col], depth_attachment=dp); fbo.use()
    ctx.enable(moderngl.DEPTH_TEST); ctx.disable(moderngl.CULL_FACE); fbo.clear(0.10, 0.10, 0.15, 1.0, depth=1.0)
    nf_tot = 0; tx0 = None
    for g in gs:
        V = np.asarray(g.vertices, dtype=np.float64); F = np.asarray(g.faces, dtype=np.int32); nf_tot += len(F)
        uv = getattr(g.visual, 'uv', None)
        mat = getattr(g.visual, 'material', None)
        im = (getattr(mat, 'baseColorTexture', None) or getattr(mat, 'image', None)) if mat is not None else None
        avec = im is not None and uv is not None and len(uv) == len(V)
        tex = None
        if avec:
            a = np.asarray(im.convert('RGB').resize((min(im.size[0], 2048), min(im.size[1], 2048)), Image.LANCZOS))
            tex = ctx.texture((a.shape[1], a.shape[0]), 3, np.ascontiguousarray(np.flipud(a)).tobytes()); tex.build_mipmaps(); tex.filter = (moderngl.LINEAR_MIPMAP_LINEAR, moderngl.LINEAR); tex.use(0); prog['tex'].value = 0
            UV = np.asarray(uv, dtype=np.float32)
            if tx0 is None: tx0 = list(im.size)
        else:
            UV = np.zeros((len(V), 2), np.float32)
        prog['avec_tex'].value = 1 if avec else 0; prog['couleur'].value = (0.75, 0.75, 0.78)
        P = ((V - c) / r).astype(np.float32)
        vbo = ctx.buffer(np.hstack([P, UV]).astype('f4').tobytes()); ibo = ctx.buffer(F.astype('i4').tobytes())
        vao = ctx.vertex_array(prog, [(vbo, '3f 2f', 'p', 'uv')], ibo)
        vao.render(moderngl.TRIANGLES)
        for o in (vbo, ibo, vao): o.release()
        if tex is not None: tex.release()
    img = np.frombuffer(fbo.read(components=4), np.uint8).reshape(S, S, 4)[::-1, :, :3]
    for o in (col, dp, fbo): o.release()
    return Image.fromarray(img.copy()), nf_tot, tx0


try:
    fnt = ImageFont.truetype('arial.ttf', 14)
except Exception:
    fnt = ImageFont.load_default()
S = 480; cols = min(4, len(chemins)); rows = (len(chemins) + cols - 1) // cols
planche = Image.new('RGB', (cols * S, rows * (S + 24)), (24, 24, 34)); d = ImageDraw.Draw(planche)
for k, ch in enumerate(chemins):
    try:
        im, nf, tx = rendre(ch, S)
        x, y = (k % cols) * S, (k // cols) * (S + 24)
        planche.paste(im, (x, y + 24))
        nom = os.path.basename(ch).replace('chevalier_medieval_trellis2_native_1790901989157', 'v4').replace('.glb', '')[:60]
        d.text((x + 4, y + 4), '%s | %s faces | tex %s' % (nom, format(nf, ','), tx), fill=(230, 230, 230), font=fnt)
        print('ok', nom)
    except Exception as e:
        print('ERREUR', ch, repr(e)[:160])
planche.save(sortie); print('planche', sortie, planche.size)
