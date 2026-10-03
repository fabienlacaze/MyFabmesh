"""Banc de fidelite de FORME (03/10/2026) -- masque du sujet dans l'image de reference.

Ordre de repli (methode='auto') :
  1. 'alpha' : canal alpha de l'image s'il existe ET n'est pas uniforme (au moins 1 % de pixels transparents et 1 % opaques) ;
  2. 'fond'  : fond uni -- couleur mediane du cadre de l'image ; le fond est la region CONNECTEE AU BORD dont tous les pixels sont a moins de `tol`
               (ecart max sur un canal, niveaux 0-255) de cette couleur. Un blanc a l'interieur du sujet (dent, oeil, fourrure) n'est donc pas pris
               pour du fond tant qu'il ne rejoint pas le bord par une zone de meme couleur. Condition : au moins 85 % du cadre de couleur homogene ;
  3. 'degrade' : fond NON uni mais lisse (degrade de studio, vignettage, sol) : le fond est estime par convolution normalisee (moyenne gaussienne
               anisotrope des seuls pixels deja reconnus comme fond : large en x, etroite en y pour suivre l'horizon du sol), puis reclasse ; 10 passes,
               tolerance = 3 ecarts-types du residu du fond (plancher 12 niveaux). Les pixels de fond sont ceux, relies au bord, proches de l'estimation.
               Mesure : sur l'orc du 03/10 (fond gris degrade + sol), u2net retire les bras et les armes (16 % de l'image) alors que cette methode garde
               tout le sujet (28 %). Echec declare (renvoie None) si le modele n'explique pas 90 % de l'amorce, ou si l'amorce couvre moins de 60 % du cadre ;
  4. 'u2net' : detourage onnxruntime CPU avec u2net.onnx deja present sur le poste (jamais telecharge). Cherche dans, dans l'ordre :
               $U2NET_HOME, %APPDATA%/myfabmesh-ai/ai-cache/u2net, ~/.u2net. Si aucun poids : MasqueIntrouvable (pas de repli invente).
Le masque 'fond' garde un SOCLE ou une OMBRE portee (ils different du fond) : c'est voulu, c'est ce que voit l'utilisateur. Le masque u2net, lui,
approche ce que le pipeline a reellement donne au modele 3D (le detourage u2net est applique avant TRELLIS) : la campagne rapporte les deux.
"""
import argparse
import os
import sys

import numpy as np
import cv2
from PIL import Image

Image.MAX_IMAGE_PIXELS = None


class MasqueIntrouvable(RuntimeError):
    pass


def charger_image(chemin):
    """PIL RGBA, orientation EXIF appliquee."""
    from PIL import ImageOps
    im = Image.open(chemin)
    im = ImageOps.exif_transpose(im)
    return im.convert('RGBA')


def trouver_u2net():
    cands = []
    if os.environ.get('U2NET_HOME'):
        cands.append(os.path.join(os.environ['U2NET_HOME'], 'u2net.onnx'))
    if os.environ.get('APPDATA'):
        cands.append(os.path.join(os.environ['APPDATA'], 'myfabmesh-ai', 'ai-cache', 'u2net', 'u2net.onnx'))
    cands.append(os.path.join(os.path.expanduser('~'), '.u2net', 'u2net.onnx'))
    for c in cands:
        if os.path.isfile(c):
            return c
    return None


_SESSION = {}


def masque_u2net(rgb, poids=None):
    """Probabilite u2net (float 0-1, taille de l'image). Pretraitement identique a modal_app/_detourage.py (rembg) : 320 x 320 LANCZOS, normalisation ImageNet."""
    poids = poids or trouver_u2net()
    if poids is None:
        raise MasqueIntrouvable("u2net.onnx introuvable (U2NET_HOME, %APPDATA%/myfabmesh-ai/ai-cache/u2net, ~/.u2net) : pas de telechargement.")
    if poids not in _SESSION:
        import onnxruntime as ort
        _SESSION[poids] = ort.InferenceSession(poids, providers=['CPUExecutionProvider'])
    s = _SESSION[poids]
    img = Image.fromarray(rgb)
    im = np.array(img.resize((320, 320), Image.Resampling.LANCZOS))
    im = im / max(np.max(im), 1e-6)
    t = np.zeros((320, 320, 3))
    for c, (m, e) in enumerate(zip((0.485, 0.456, 0.406), (0.229, 0.224, 0.225))):
        t[:, :, c] = (im[:, :, c] - m) / e
    pred = s.run(None, {s.get_inputs()[0].name: np.expand_dims(t.transpose((2, 0, 1)), 0).astype(np.float32)})[0][:, 0, :, :]
    ma, mi = np.max(pred), np.min(pred)
    pred = np.squeeze((pred - mi) / max(ma - mi, 1e-9))
    return np.asarray(Image.fromarray((pred.clip(0, 1) * 255).astype('uint8'), mode='L').resize(img.size, Image.Resampling.LANCZOS), np.float32) / 255.0


def masque_fond_uni(rgb, tol=22, cadre_px=3, homogene_min=0.85):
    """Retourne (masque bool, info) ou (None, info) si le cadre n'est pas de couleur homogene."""
    h, w = rgb.shape[:2]
    k = max(1, min(cadre_px, h // 4, w // 4))
    bord = np.concatenate([rgb[:k].reshape(-1, 3), rgb[-k:].reshape(-1, 3), rgb[:, :k].reshape(-1, 3), rgb[:, -k:].reshape(-1, 3)]).astype(np.int16)
    med = np.median(bord, axis=0)
    proche_bord = (np.abs(bord - med).max(axis=1) <= tol).mean()
    info = {'couleur_fond': [int(x) for x in med], 'cadre_homogene': float(proche_bord)}
    if proche_bord < homogene_min:
        return None, info
    candidat = (np.abs(rgb.astype(np.int16) - med).max(axis=2) <= tol).astype(np.uint8)
    n, lab = cv2.connectedComponents(candidat, connectivity=4)
    # region(s) de fond = composantes qui touchent le cadre
    touche = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    fond = np.isin(lab, [t for t in touche if t != 0]) & (candidat > 0)
    masque = ~fond
    # nettoyage : ouverture legere (retire les poussieres isolees du fond JPEG), puis remplissage des petits trous
    masque = _nettoyer(masque, w, h)
    return masque, info


def masque_fond_degrade(rgb, travail=640, passes=10, tol_min=12.0):
    """Retourne (masque bool pleine resolution, info) ou (None, info). Voir la docstring du module (methode 3)."""
    h, w = rgb.shape[:2]
    e = min(1.0, travail / max(h, w))
    sm = cv2.resize(rgb, (max(8, int(round(w * e))), max(8, int(round(h * e)))), interpolation=cv2.INTER_AREA).astype(np.float32) if e < 1 else rgb.astype(np.float32)
    hh, ww = sm.shape[:2]
    k = max(2, int(round(0.012 * max(hh, ww))))
    anneau = np.zeros((hh, ww), np.float32)
    anneau[:k] = anneau[-k:] = 1
    anneau[:, :k] = anneau[:, -k:] = 1
    sx, sy = 0.10 * ww, 0.02 * hh
    # amorce robuste : l'anneau moins ses pixels trop eloignes de sa couleur mediane (une arme ou une cape qui sort du cadre)
    med = np.median(sm[anneau > 0], axis=0)
    anneau_ok = anneau * (np.abs(sm - med).max(axis=2) < 45).astype(np.float32)
    m = anneau_ok.copy()
    bg = np.zeros((hh, ww), bool)
    gl = cv2.GaussianBlur(sm, (0, 0), 1.5)
    gx, gy = cv2.Sobel(gl, cv2.CV_32F, 1, 0, ksize=3) / 8.0, cv2.Sobel(gl, cv2.CV_32F, 0, 1, ksize=3) / 8.0
    grad = np.sqrt(gx ** 2 + gy ** 2).max(axis=2)             # niveaux par pixel, max des canaux
    seuil_grad = 3.0
    tol = tol_min
    for _ in range(passes):
        num = cv2.GaussianBlur(sm * m[..., None], (0, 0), sigmaX=sx, sigmaY=sy)
        den = cv2.GaussianBlur(m, (0, 0), sigmaX=sx, sigmaY=sy)[..., None]
        est = num / np.maximum(den, 1e-4)
        d = np.abs(sm - est).max(axis=2)
        tol = max(tol_min, 3.0 * float(d[m > 0.5].std()))
        # hysteresis : fond sur (d < tol) ; ou fond probable (d < 2,2 tol) en zone SANS contour, s'il est relie au fond sur
        cand = ((d < tol) | ((d < 2.2 * tol) & (grad < seuil_grad))).astype(np.uint8)
        n, lab = cv2.connectedComponents(cand, connectivity=4)
        t = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
        bg = np.isin(lab, [x for x in t if x != 0]) & (cand > 0)
        m = np.maximum(anneau_ok, cv2.erode(bg.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(np.float32))
    expliquee = float(bg[anneau_ok > 0].mean())
    info = {'tolerance_fond': tol, 'cadre_explique': expliquee, 'cadre_retenu': float(anneau_ok.sum() / anneau.sum())}
    if expliquee < 0.90 or info['cadre_retenu'] < 0.60:
        return None, info
    sujet = (~bg).astype(np.float32)
    if e < 1:
        sujet = cv2.resize(sujet, (w, h), interpolation=cv2.INTER_LINEAR)
    return _nettoyer(sujet > 0.5, w, h), info


def _nettoyer(m, w, h):
    u = m.astype(np.uint8)
    u = cv2.morphologyEx(u, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(u, connectivity=8)
    seuil = max(20, 0.00005 * w * h)
    for i in range(1, n):
        if st[i, cv2.CC_STAT_AREA] < seuil:
            u[lab == i] = 0
    inv = (1 - u).astype(np.uint8)                          # trous internes minuscules
    n, lab, st, _ = cv2.connectedComponentsWithStats(inv, connectivity=4)
    for i in range(1, n):
        if st[i, cv2.CC_STAT_AREA] < seuil:
            u[lab == i] = 1
    return u > 0


def masque_reference(source, methode='auto', tol=22):
    """source : chemin ou tableau RGB/RGBA. Retourne dict(masque bool (h,w), methode, info, rgb uint8 (h,w,3), coupe_bords).
    `coupe_bords` : part du perimetre de l'image occupee par le sujet (le sujet est coupe par le cadre si > 0)."""
    if isinstance(source, (str, os.PathLike)):
        rgba = np.asarray(charger_image(source))
    else:
        a = np.asarray(source)
        rgba = a if a.shape[2] == 4 else np.dstack([a, np.full(a.shape[:2], 255, np.uint8)])
    rgb = np.ascontiguousarray(rgba[..., :3])
    alpha = rgba[..., 3]
    info = {}
    masque, utilise = None, None
    ordre = ['alpha', 'fond', 'degrade', 'u2net'] if methode == 'auto' else [methode]
    for m in ordre:
        if m == 'alpha':
            transp, opaque = (alpha < 128).mean(), (alpha >= 128).mean()
            if transp >= 0.01 and opaque >= 0.01:
                masque, utilise = alpha >= 128, 'alpha'
                info = {'transparent_pct': float(100 * transp)}
            elif methode == 'alpha':
                raise MasqueIntrouvable("pas de canal alpha exploitable")
        elif m == 'fond':
            mk, inf = masque_fond_uni(rgb, tol)
            info = inf
            if mk is not None and 0.002 < mk.mean() < 0.98:
                masque, utilise = mk, 'fond'
            elif methode == 'fond':
                raise MasqueIntrouvable("fond non uni (cadre homogene : %.0f %%)" % (100 * inf.get('cadre_homogene', 0)))
        elif m == 'degrade':
            mk, inf = masque_fond_degrade(rgb)
            info = inf
            if mk is not None and 0.002 < mk.mean() < 0.98:
                masque, utilise = mk, 'degrade'
            elif methode == 'degrade':
                raise MasqueIntrouvable("fond degrade non explique par le modele (cadre explique : %.0f %%)" % (100 * inf.get('cadre_explique', 0)))
        elif m == 'u2net':
            p = masque_u2net(rgb)
            masque, utilise = _nettoyer(p > 0.5, rgb.shape[1], rgb.shape[0]), 'u2net'
            info = {'poids': trouver_u2net()}
        if masque is not None:
            break
    if masque is None:
        raise MasqueIntrouvable("aucune methode n'a donne de masque")
    per = np.concatenate([masque[0], masque[-1], masque[:, 0], masque[:, -1]])
    return {'masque': masque, 'methode': utilise, 'info': info, 'rgb': rgb, 'coupe_bords': float(per.mean())}


def main(argv=None):
    ap = argparse.ArgumentParser(description="Masque du sujet d'une image de reference.")
    ap.add_argument('image')
    ap.add_argument('--methode', default='auto', choices=['auto', 'alpha', 'fond', 'degrade', 'u2net'])
    ap.add_argument('--tol', type=int, default=22)
    ap.add_argument('--sortie', default=None)
    a = ap.parse_args(argv)
    r = masque_reference(a.image, a.methode, a.tol)
    out = a.sortie or os.path.join('C:/tmp/fidelite', os.path.splitext(os.path.basename(a.image))[0] + '_masque.png')
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    cv2.imwrite(out, r['masque'].astype(np.uint8) * 255)
    print('methode=%s | surface %.1f %% | sujet touche le bord sur %.1f %% du perimetre | %s -> %s' % (r['methode'], 100 * r['masque'].mean(), 100 * r['coupe_bords'], r['info'], out))
    return 0


if __name__ == '__main__':
    sys.exit(main())
