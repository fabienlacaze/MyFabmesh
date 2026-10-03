"""Rend un GLB rigge / anime DANS UNE POSE, hors fenetre (moderngl), pour juger la peau aux articulations.
Usage : python rendre_pose.py <sortie.png> <glb> <anim|-1> <t1,t2,...> <az1,az2,...> [flexion:<nom_os>:<deg>]
  anim = indice de l'animation du fichier (-1 : pose de repos) ; t = fractions de la duree (0..1) ; az = azimuts en degres (une ligne par azimut).
  flexion:<nom_os>:<deg> : en plus, plie l'os (axe perpendiculaire a l'os) de <deg> degres (pose de repos si anim = -1).
Une colonne par instant, une ligne par azimut. Aucune ecriture hors du PNG de sortie."""
import math, os, sys
import numpy as np
import trimesh, moderngl
from PIL import Image, ImageDraw, ImageFont
Image.MAX_IMAGE_PIXELS = None
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rig_lib import Rig

sortie, chemin, anim = sys.argv[1], sys.argv[2], int(sys.argv[3])
temps = [float(x) for x in sys.argv[4].split(',')]
azs = [float(x) for x in sys.argv[5].split(',')]
flex = None
for a in sys.argv[6:]:
    if a.startswith('flexion:'): _, nom, deg = a.split(':'); flex = (nom, float(deg))

g = Rig(chemin)
prims = g.prims()
scene = trimesh.load(chemin, force='scene', process=False)
geoms = list(scene.geometry.values())
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


def qmul(a, b):
    x1, y1, z1, w1 = a; x2, y2, z2, w2 = b
    return np.array([w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2, w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2, w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2, w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2])


def pose_at(frac):
    if anim >= 0:
        dur, _ = g.anim_info(anim); pose = g.anim_pose(anim, frac * dur)
    else:
        pose = {}
    if flex:
        nom, deg = flex
        n = [i for i, x in enumerate(g.names) if x == nom][0]
        W0 = g.world(pose)
        kids = [c for c in range(g.n) if g.parent[c] == n]
        d = (W0[kids[0]][:3, 3] - W0[n][:3, 3]) if kids else np.array([0, 1.0, 0])
        d = d / (np.linalg.norm(d) or 1.0)
        a0 = np.cross(d, [0, 0, 1.0])
        if np.linalg.norm(a0) < 0.3: a0 = np.cross(d, [1.0, 0, 0])
        Rn = W0[n][:3, :3] / (np.linalg.norm(W0[n][:3, :3], axis=0)[None, :] + 1e-12)
        al = Rn.T @ (a0 / np.linalg.norm(a0)); s_ = math.sin(math.radians(deg) / 2)
        t_, q_, sc_ = pose.get(n) or g.local_trs(n)
        pose = dict(pose); pose[n] = (t_, qmul(q_, np.array([al[0] * s_, al[1] * s_, al[2] * s_, math.cos(math.radians(deg) / 2)])), sc_)
    return g.world(pose)


# posees par instant ; echelle commune
frames = []
for t in temps:
    Wt = pose_at(t); Vs = []
    for pr in prims: Vs.append(g.skinned(pr, Wt))
    frames.append(Vs)
allp = np.vstack([v for fr in frames for v in fr]); ext = allp.max(0) - allp.min(0); R = float(np.linalg.norm(ext)) / 2


def rendre(Vs, az, S=420):
    allv = np.vstack(Vs); c = (allv.min(0) + allv.max(0)) / 2
    az_r = math.radians(az); el = math.radians(8)
    cam = np.array([math.sin(az_r) * math.cos(el), math.sin(el), math.cos(az_r) * math.cos(el)]) * 3.2
    f = -cam / np.linalg.norm(cam); s_ = np.cross(f, [0, 1, 0]); s_ /= np.linalg.norm(s_); u_ = np.cross(s_, f)
    view = np.eye(4); view[0, :3] = s_; view[1, :3] = u_; view[2, :3] = -f; view[:3, 3] = -view[:3, :3] @ cam
    fov = math.radians(32); n_, f_ = 0.5, 10.0; t = 1 / math.tan(fov / 2)
    proj = np.array([[t, 0, 0, 0], [0, t, 0, 0], [0, 0, -(f_ + n_) / (f_ - n_), -2 * f_ * n_ / (f_ - n_)], [0, 0, -1, 0]])
    prog['mv'].write(np.ascontiguousarray(view.T.astype('f4'))); prog['mvp'].write(np.ascontiguousarray((proj @ view).T.astype('f4')))
    col = ctx.texture((S, S), 4, dtype='f1'); dp = ctx.depth_renderbuffer((S, S)); fbo = ctx.framebuffer(color_attachments=[col], depth_attachment=dp); fbo.use()
    ctx.enable(moderngl.DEPTH_TEST); ctx.disable(moderngl.CULL_FACE); fbo.clear(0.10, 0.10, 0.15, 1.0, depth=1.0)
    for k, pr in enumerate(prims):
        V = Vs[k]; F = pr['F'].astype(np.int32)
        gm = geoms[k] if k < len(geoms) else None
        uv = getattr(gm.visual, 'uv', None) if gm is not None else None
        mat = getattr(gm.visual, 'material', None) if gm is not None else None
        im = (getattr(mat, 'baseColorTexture', None) or getattr(mat, 'image', None)) if mat is not None else None
        avec = im is not None and uv is not None and len(uv) == len(V)
        tex = None
        if avec:
            a = np.asarray(im.convert('RGB').resize((min(im.size[0], 1024), min(im.size[1], 1024)), Image.LANCZOS))
            tex = ctx.texture((a.shape[1], a.shape[0]), 3, np.ascontiguousarray(np.flipud(a)).tobytes()); tex.build_mipmaps(); tex.filter = (moderngl.LINEAR_MIPMAP_LINEAR, moderngl.LINEAR); tex.use(0); prog['tex'].value = 0
            UV = np.asarray(uv, dtype=np.float32)
        else:
            UV = np.zeros((len(V), 2), np.float32)
        prog['avec_tex'].value = 1 if avec else 0; prog['couleur'].value = (0.75, 0.75, 0.78)
        P = ((V - c) / R).astype(np.float32)
        vbo = ctx.buffer(np.hstack([P, UV]).astype('f4').tobytes()); ibo = ctx.buffer(F.astype('i4').tobytes())
        vao = ctx.vertex_array(prog, [(vbo, '3f 2f', 'p', 'uv')], ibo); vao.render(moderngl.TRIANGLES)
        for o in (vbo, ibo, vao): o.release()
        if tex is not None: tex.release()
    img = np.frombuffer(fbo.read(components=4), np.uint8).reshape(S, S, 4)[::-1, :, :3]
    for o in (col, dp, fbo): o.release()
    return Image.fromarray(img.copy())


try: fnt = ImageFont.truetype('arial.ttf', 14)
except Exception: fnt = ImageFont.load_default()
S = 420; cols = len(temps); rows = len(azs)
planche = Image.new('RGB', (cols * S, rows * (S + 22)), (24, 24, 34)); d = ImageDraw.Draw(planche)
for j, az in enumerate(azs):
    for i, t in enumerate(temps):
        im = rendre(frames[i], az, S); x, y = i * S, j * (S + 22)
        planche.paste(im, (x, y + 22)); d.text((x + 4, y + 3), '%s t=%.2f az=%d%s' % (os.path.basename(chemin)[:34], t, az, (' flex ' + flex[0] + ' ' + str(flex[1])) if flex else ''), fill=(230, 230, 230), font=fnt)
planche.save(sortie); print('planche', sortie, planche.size)
