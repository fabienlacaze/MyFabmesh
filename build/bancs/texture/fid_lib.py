"""Bibliotheque du banc de fidelite (plan texture du 03/10/2026, essai #2) : camera ajustee (reprise de projeter_source8.py), rendu sans eclairage, metriques relatives.
Aucun poids telecharge ; DINOv2-large lu dans le cache hors ligne de l'application. Lecture seule sur les maillages et les images des projets."""
import importlib.util, json, math, os, time
import numpy as np, cv2, trimesh, moderngl
from PIL import Image
from skimage.color import rgb2lab, deltaE_ciede2000

Image.MAX_IMAGE_PIXELS = None
APPDATA = os.environ['APPDATA']
REPO = 'C:/Users/Utilisateur/Desktop/FabWare/MeshyMyself'
MESHES = APPDATA + '/myfabmesh-ai/meshes/'
IMAGES = APPDATA + '/myfabmesh-ai/images/'
SUJETS = {   # nom -> (glb, photo : la source reelle consignee dans le .meta.json du GLB)
    'chevalier': ('chevalier_medieval_trellis2_native_1790901989157.glb', 'chevalier_medieval/ref_0_brightness_1790860633727.png'),
    'bus': ('bus_trellis2_native_1790909121082.glb', 'bus/ref_0.png'),
    'alien': ('alien_form_another_time_trellis2_native_1790909122082.glb', 'alien_form_another_time/ref_0_texvar_1790854618929_97565.png'),
    'cochon': ('cochon_volant_trellis2_native_1790909123082.glb', 'cochon_volant/ref_0.png'),
    'portail': ('star_portail_trellis2_native_1790878796257.glb', 'star_portail_1790795624364/fabmesh_rectified_1790845243783_ref_0.png'),
    'voiture': ('voiture_trellis2_native_1790878171303.glb', 'voiture/ref_0.png'),
}
_DET = None


def masque_u2net(src_pil):
    global _DET
    if _DET is None:
        spec = importlib.util.spec_from_file_location('detourage', REPO + '/modal_app/_detourage.py')
        _DET = importlib.util.module_from_spec(spec)
        os.environ['U2NET_HOME'] = APPDATA + '/myfabmesh-ai/ai-cache/u2net'
        spec.loader.exec_module(_DET)
        _DET.POIDS_U2NET = os.environ['U2NET_HOME'] + '/u2net.onnx'
    return np.asarray(_DET.masque(src_pil)) > 127


def structure(img_rgb, flou=1.5, loc=8):
    g = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
    g = cv2.GaussianBlur(g, (0, 0), flou)
    mu = cv2.GaussianBlur(g, (0, 0), loc); var = cv2.GaussianBlur((g - mu) ** 2, (0, 0), loc)
    return (g - mu) / np.sqrt(var + 1e-3)


def ncc(a, b, m):
    x = a[m]; y = b[m]; x = x - x.mean(); y = y - y.mean()
    return float((x * y).mean() / (x.std() * y.std() + 1e-6))


def mat_pose(az, pitch):
    a = math.radians(az); p = math.radians(pitch)
    Ry = np.array([[math.cos(a), 0, math.sin(a)], [0, 1, 0], [-math.sin(a), 0, math.cos(a)]]); Rx = np.array([[1, 0, 0], [0, math.cos(p), -math.sin(p)], [0, math.sin(p), math.cos(p)]])
    return (Rx @ Ry).astype(np.float32)


class Sujet:
    def __init__(self, nom, S=1024, atlas_fit=2048):
        self.nom = nom; self.S = S
        glb, photo = SUJETS[nom] if nom in SUJETS else nom.split('|')       # un sujet libre = 'chemin_glb|chemin_photo' (absolus)
        scene = trimesh.load(glb if os.path.isabs(glb) else MESHES + glb, force='scene', process=False)
        mesh = list(scene.geometry.values())[0]
        V = np.asarray(mesh.vertices, dtype=np.float64); self.F = np.asarray(mesh.faces, dtype=np.int32)
        self.UV = np.asarray(mesh.visual.uv, dtype=np.float32); self.NRM = np.asarray(mesh.vertex_normals, dtype=np.float32)
        mat = mesh.visual.material
        self.ATLAS = np.asarray((getattr(mat, 'baseColorTexture', None) or getattr(mat, 'image', None)).convert('RGB'))
        self.AH = self.ATLAS.shape[0]
        centre = (V.min(0) + V.max(0)) / 2
        self.V0 = (V - centre).astype(np.float32); self.R = float(np.linalg.norm(self.V0, axis=1).max())
        src = Image.open(photo if os.path.isabs(photo) else IMAGES + photo).convert('RGB')
        self.photo_taille_origine = src.size
        self.PHOTO = np.asarray(src.resize((S, S), Image.LANCZOS))
        self.MS = masque_u2net(Image.fromarray(self.PHOTO))
        ys, xs = np.where(self.MS); self.box = (xs.min(), xs.max(), ys.min(), ys.max())
        self.ctx = moderngl.create_standalone_context()
        self.prog = self.ctx.program(vertex_shader="""#version 330
uniform float D; uniform float Fo; uniform float cx; uniform float cy; uniform float S; uniform mat3 Rm;
in vec3 in_pos; in vec2 in_uv; out vec2 uv; out float wv;
void main(){ vec3 p = Rm * in_pos; float w = D - p.z;
  float x = (cx + Fo * p.x / w) / S * 2.0 - 1.0; float y = 1.0 - (cy - Fo * p.y / w) / S * 2.0;
  float zn = (w - 0.01) / (D * 4.0) * 2.0 - 1.0; gl_Position = vec4(x * w, y * w, zn * w, w); uv = in_uv; wv = w; }""", fragment_shader="""#version 330
uniform sampler2D tex; uniform int mode; in vec2 uv; in float wv;
layout(location=0) out vec4 o0; layout(location=1) out vec4 o1;
void main(){ o0 = (mode == 0) ? vec4(texture(tex, uv).rgb, 1.0) : vec4(1.0); o1 = vec4(wv, 0.0, 0.0, 1.0); }""")
        self.vbo = self.ctx.buffer(np.hstack([self.V0, self.UV]).astype('f4').tobytes()); self.ibo = self.ctx.buffer(self.F.astype('i4').tobytes())
        self.vao = self.ctx.vertex_array(self.prog, [(self.vbo, '3f 2f', 'in_pos', 'in_uv')], self.ibo)
        self.TEX = None; self.POSE = [0.0, 0.0]
        a = self.ATLAS if self.AH <= atlas_fit else cv2.resize(self.ATLAS, (atlas_fit, atlas_fit), interpolation=cv2.INTER_AREA)
        self.poser_texture(a)
        self.S512 = 512
        self.SP512 = structure(cv2.resize(self.PHOTO, (512, 512), interpolation=cv2.INTER_AREA), 1.0)
        self.MP512 = cv2.erode(cv2.resize(self.MS.astype(np.uint8), (512, 512), interpolation=cv2.INTER_AREA), np.ones((9, 9), np.uint8)) > 0

    def poser_texture(self, arr):
        if self.TEX is not None: self.TEX.release()
        self.TEX = self.ctx.texture((arr.shape[1], arr.shape[0]), 3, np.ascontiguousarray(np.flipud(arr)).tobytes())
        self.TEX.build_mipmaps(); self.TEX.filter = (moderngl.LINEAR_MIPMAP_LINEAR, moderngl.LINEAR); self.TEX.anisotropy = 8.0

    def rendre(self, cam, taille, daz=0.0, mode=0):
        D, Fo, cx, cy = cam; k = taille / self.S; p = self.prog
        p['D'].value = D; p['Fo'].value = Fo * k; p['cx'].value = cx * k; p['cy'].value = cy * k; p['S'].value = float(taille)
        p['Rm'].write(mat_pose(self.POSE[0] + daz, self.POSE[1]).T.tobytes()); p['mode'].value = mode
        if self.TEX is not None: self.TEX.use(0); p['tex'].value = 0
        c0 = self.ctx.texture((taille, taille), 4, dtype='f1'); c1 = self.ctx.texture((taille, taille), 4, dtype='f4'); dp = self.ctx.depth_renderbuffer((taille, taille))
        fbo = self.ctx.framebuffer(color_attachments=[c0, c1], depth_attachment=dp); fbo.use()
        self.ctx.enable(moderngl.DEPTH_TEST); self.ctx.disable(moderngl.CULL_FACE); fbo.clear(1.0, 1.0, 1.0, 0.0, depth=1.0)
        self.vao.render(moderngl.TRIANGLES)
        rgba = np.frombuffer(fbo.read(attachment=0, components=4), dtype=np.uint8).reshape(taille, taille, 4)[::-1]
        w = np.frombuffer(fbo.read(attachment=1, components=4, dtype='f4'), dtype=np.float32).reshape(taille, taille, 4)[::-1, :, 0].copy()
        for o in (c0, c1, dp, fbo): o.release()
        return rgba[:, :, :3].copy(), rgba[:, :, 3] > 0, w

    def camera_analytique(self, D):
        bx0, bx1, by0, by1 = self.box
        Vr = self.V0 @ mat_pose(*self.POSE).T
        w = D - Vr[:, 2]; x = Vr[:, 0] / w; y = Vr[:, 1] / w
        Fx = (bx1 - bx0) / (x.max() - x.min()); Fy = (by1 - by0) / (y.max() - y.min()); Fo = (Fx + Fy) / 2
        return (D, Fo, (bx0 + bx1) / 2 - Fo * (x.max() + x.min()) / 2, (by0 + by1) / 2 + Fo * (y.max() + y.min()) / 2)

    def iou(self, cam, taille=512):
        m = self.rendre(cam, taille, mode=1)[1]; ms = cv2.resize(self.MS.astype(np.uint8), (taille, taille), interpolation=cv2.INTER_AREA) > 0
        return float((m & ms).sum() / max((m | ms).sum(), 1))

    def score_photo(self, c):
        r, m, _ = self.rendre(c, 512); mm = m & self.MP512
        if mm.sum() < 2000: return -1.0
        return ncc(structure(r, 1.5), self.SP512, mm) + 0.6 * self.iou(c)

    def raffiner(self, cam, rondes_sil=4, rondes_photo=5):
        best = self.iou(cam); cam = list(cam); pas = [0.08, 0.02, 8.0, 8.0]
        for _ in range(rondes_sil):
            for i in range(4):
                for sgn in (-1, 1):
                    c2 = list(cam); c2[i] = cam[i] * (1 + sgn * pas[i]) if i < 2 else cam[i] + sgn * pas[i]
                    if c2[0] <= self.R * 1.05: continue
                    sc = self.iou(tuple(c2))
                    if sc > best: best, cam = sc, c2
            pas = [p * 0.5 for p in pas]
        sc0 = self.score_photo(tuple(cam)); pas = [0.04, 0.015, 6.0, 6.0]
        for _ in range(rondes_photo):
            for i in range(4):
                for sgn in (-1, 1):
                    c2 = list(cam); c2[i] = cam[i] * (1 + sgn * pas[i]) if i < 2 else cam[i] + sgn * pas[i]
                    if c2[0] <= self.R * 1.05: continue
                    sc = self.score_photo(tuple(c2))
                    if sc > sc0: sc0, cam = sc, c2
            pas = [p * 0.6 for p in pas]
        return tuple(cam), sc0

    def ajuster_camera(self, az_decalage=0.0, pitchs=(-10, 0, 10, 20, 30), pas_az=15):
        """Recherche de pose complete (reprise de projeter_source8) ; az_decalage / pitchs : une SECONDE recherche independante pour mesurer la repetabilite."""
        cand = []
        for az in np.arange(-180 + az_decalage, 180 + az_decalage, pas_az):
            for pitch in pitchs:
                self.POSE[:] = [float(az), float(pitch)]
                top = max(((self.iou(self.camera_analytique(self.R * k), 256), k) for k in (1.6, 2.5, 4.0, 7.0)))
                cand.append((top[0], float(az), float(pitch), top[1]))
        cand.sort(reverse=True)
        mp = None
        for sil, az, pitch, k in cand[:5]:
            self.POSE[:] = [az, pitch]
            cam_c, sc_c = self.raffiner(self.camera_analytique(self.R * k), 3, 3)
            if mp is None or sc_c > mp[0]: mp = (sc_c, az, pitch, cam_c)
        sc0, az0, pitch0, cam = mp; self.POSE[:] = [az0, pitch0]
        for pas_p in (6.0, 3.0):
            for dz, dp in ((pas_p, 0), (-pas_p, 0), (0, pas_p), (0, -pas_p)):
                self.POSE[:] = [az0 + dz, pitch0 + dp]
                c2, s2 = self.raffiner(cam, 1, 3)
                if s2 > sc0: sc0, cam, az0, pitch0 = s2, c2, az0 + dz, pitch0 + dp
        self.POSE[:] = [az0, pitch0]
        cam, sc0 = self.raffiner(cam, 2, 4)
        return dict(cam=list(cam), pose=list(self.POSE), iou=self.iou(cam), score=sc0, D_sur_R=cam[0] / self.R)

    def polir(self, cam, pose, rondes=4):
        """Descente de coordonnees fine sur (azimut, tangage, D, F, cx, cy) avec le meme score que raffiner : apres la recherche de pose, ramene deux ajustements independants vers le meme optimum."""
        cam = list(cam); self.POSE[:] = list(pose); best = self.score_photo(tuple(cam))
        pas_ang = [2.0, 1.0, 0.5, 0.25][:rondes]; pas_cam = [0.02, 0.01, 0.005, 0.0025][:rondes]; pas_px = [6.0, 3.0, 1.5, 0.75][:rondes]
        for r in range(rondes):
            amelioration = True
            while amelioration:
                amelioration = False
                for i in range(2):
                    for sgn in (-1, 1):
                        p0 = list(self.POSE); self.POSE[i] = p0[i] + sgn * pas_ang[r]; sc = self.score_photo(tuple(cam))
                        if sc > best + 1e-5: best = sc; amelioration = True
                        else: self.POSE[:] = p0
                for i in range(4):
                    for sgn in (-1, 1):
                        c2 = list(cam); c2[i] = cam[i] * (1 + sgn * pas_cam[r]) if i < 2 else cam[i] + sgn * pas_px[r]
                        if c2[0] <= self.R * 1.05: continue
                        sc = self.score_photo(tuple(c2))
                        if sc > best + 1e-5: best, cam = sc, c2; amelioration = True
        return dict(cam=list(cam), pose=list(self.POSE), iou=self.iou(tuple(cam)), score=best, D_sur_R=cam[0] / self.R)


_DINO = None


def dino():
    global _DINO
    if _DINO is None:
        os.environ['HF_HUB_OFFLINE'] = '1'
        import torch
        from transformers import AutoModel, AutoImageProcessor
        nm = 'facebook/dinov2-large'
        _DINO = (AutoImageProcessor.from_pretrained(nm), AutoModel.from_pretrained(nm).eval().cuda().half())
    return _DINO


def dino_patchs(photo, rendu, masque_photo, masque_rendu, zone):
    """Cosinus DINOv2-large patch a patch (sur les patchs dont >50 % des pixels sont dans la zone) et CLS ; images 224 sur fond gris."""
    import torch
    proc, mod = dino()
    res = {}
    def prep(rgb, m):
        o = rgb.copy(); o[~m] = 127
        return cv2.resize(o, (224, 224), interpolation=cv2.INTER_AREA)
    ia = prep(photo, masque_photo); ib = prep(rendu, masque_rendu)
    mean = np.array([0.485, 0.456, 0.406], np.float32); std = np.array([0.229, 0.224, 0.225], np.float32)
    x = torch.from_numpy(np.stack([(ia / 255.0 - mean) / std, (ib / 255.0 - mean) / std]).astype(np.float32)).permute(0, 3, 1, 2).cuda().half()
    with torch.no_grad(): h = mod(pixel_values=x).last_hidden_state.float()
    cls = torch.nn.functional.cosine_similarity(h[0:1, 0], h[1:2, 0]).item()
    pa, pb = h[0, 1:], h[1, 1:]
    cs = torch.nn.functional.cosine_similarity(pa, pb, dim=-1).cpu().numpy().reshape(16, 16)
    zm = cv2.resize(zone.astype(np.uint8), (16, 16), interpolation=cv2.INTER_AREA) > 0.5
    return float(cls), float(cs[zm].mean()) if zm.any() else float('nan')


def mesures(photo, rendu, m_rendu, MS, fenetre=None, avec_dino=True):
    """Metriques RELATIVES (meme maillage, memes camera et photo). fenetre : masque booleen (zone cachee) pour restreindre la mesure."""
    inter = cv2.erode((m_rendu & MS).astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool)
    if fenetre is not None: inter = inter & fenetre
    out = {'pixels_zone': int(inter.sum())}
    if inter.sum() < 500: out['erreur'] = 'zone trop petite'; return out
    la = rgb2lab(photo.astype(np.float32) / 255.0); lb = rgb2lab(rendu.astype(np.float32) / 255.0)
    de = deltaE_ciede2000(la, lb)[inter]
    out['dE2000_median'] = round(float(np.median(de)), 3); out['dE2000_p90'] = round(float(np.percentile(de, 90)), 3); out['dE2000_moyen'] = round(float(de.mean()), 3)
    # basse frequence : PSNR de la couleur lissee (sigma 8 px)
    ba = cv2.GaussianBlur(photo.astype(np.float32), (0, 0), 8); bb = cv2.GaussianBlur(rendu.astype(np.float32), (0, 0), 8)
    mse = ((ba - bb) ** 2)[inter].mean(); out['psnr_basse_freq_dB'] = round(float(10 * np.log10(255 ** 2 / max(mse, 1e-9))), 2)
    ga = cv2.cvtColor(photo, cv2.COLOR_RGB2GRAY).astype(np.float32); gb = cv2.cvtColor(rendu, cv2.COLOR_RGB2GRAY).astype(np.float32)
    la_ = cv2.Laplacian(ga, cv2.CV_32F)[inter].var(); lb_ = cv2.Laplacian(gb, cv2.CV_32F)[inter].var()
    out['ratio_laplacien'] = round(float(lb_ / la_), 3)
    # surcontraste : rapport des ecarts-types de la haute frequence (sigma 2) et part de pixels sature en plus
    hfa = ga - cv2.GaussianBlur(ga, (0, 0), 2); hfb = gb - cv2.GaussianBlur(gb, (0, 0), 2)
    out['ratio_HF_ecart_type'] = round(float(hfb[inter].std() / max(hfa[inter].std(), 1e-6)), 3)
    out['surcontraste_pct'] = round(100.0 * float(((np.abs(hfb) > 2 * max(hfa[inter].std(), 1e-6)) & inter).sum() / inter.sum()) - 100.0 * float(((np.abs(hfa) > 2 * max(hfa[inter].std(), 1e-6)) & inter).sum() / inter.sum()), 3)
    # correlation haute frequence (structure fine) apres normalisation locale
    sa = structure(photo, 1.0, 6); sb = structure(rendu, 1.0, 6)
    out['correlation_structure'] = round(ncc(sa, sb, inter), 4)
    ha = hfa / (hfa[inter].std() + 1e-6); hb = hfb / (hfb[inter].std() + 1e-6)
    out['correlation_HF'] = round(float(((ha - ha[inter].mean()) * (hb - hb[inter].mean()))[inter].mean() / (ha[inter].std() * hb[inter].std() + 1e-6)), 4)
    # luminance / saturation
    hsa = cv2.cvtColor(photo, cv2.COLOR_RGB2HSV); hsb = cv2.cvtColor(rendu, cv2.COLOR_RGB2HSV)
    out['ecart_luminance_V'] = round(float(hsb[..., 2][inter].mean() - hsa[..., 2][inter].mean()), 2); out['ecart_saturation_S'] = round(float(hsb[..., 1][inter].mean() - hsa[..., 1][inter].mean()), 2)
    if avec_dino:
        try:
            c, p = dino_patchs(photo, rendu, MS, m_rendu, inter); out['dinov2_cls'] = round(c, 4); out['dinov2_patchs'] = round(p, 4)
        except Exception as e:
            out['dino_erreur'] = str(e)[:120]
    return out


def degrader(atlas, cible):
    """Variante degradee connue : atlas reduit (moyenne de surface) puis remis a la taille d'origine (memes UV)."""
    h = atlas.shape[0]
    if cible >= h: return atlas
    p = cv2.resize(atlas, (cible, cible), interpolation=cv2.INTER_AREA)
    return cv2.resize(p, (h, h), interpolation=cv2.INTER_CUBIC)
