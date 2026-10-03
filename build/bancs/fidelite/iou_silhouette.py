"""Banc de fidelite de FORME (03/10/2026) -- compare la silhouette de face d'un GLB au masque de l'image de reference.

`comparer(masque_ref, masque_3d)` : metriques sur deux masques ; `evaluer(image, glb)` : chaine complete (masque de reference, orientation, rendu, metriques,
panneau de diff). Definitions exactes : README.md. Rien n'est ecrit hors du dossier de sortie demande.
"""
import argparse
import json
import math
import os
import sys

import numpy as np
import cv2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rendre_silhouette as RS          # noqa: E402
import masque_reference as MR           # noqa: E402

NOMS_COL = {3: ('gauche', 'centre', 'droit'), 2: ('gauche', 'droit'), 1: ('tout',)}
NOMS_LIG = {2: ('haut', 'bas'), 3: ('haut', 'milieu', 'bas'), 1: ('tout',)}
POIDS_SCORE = {'iou': 0.45, 'f_contour': 0.25, 'hausdorff': 0.15, 'fines': 0.15}
HAUSDORFF_NUL = 0.05          # une distance moyenne de contour >= 5 % de la hauteur donne 0 a ce terme du score


# ------------------------------------------------------------------ normalisation
def normaliser(m, S=512, marge=0.05, image=None):
    """Boite englobante du masque -> canevas (S,S) : echelle ISOTROPE (le plus grand cote de la boite = (1-2*marge)*S), boite centree.
    Retourne (masque bool (S,S), transfo) ; transfo = (echelle, tx, ty) tel que x_canevas = echelle*x_image + tx. Avec `image` (h,w[,3]) : l'image
    est ramenee dans le meme canevas (retournee en 3e element)."""
    ys, xs = np.where(m)
    if len(xs) == 0:
        z = np.zeros((S, S), bool)
        return (z, (1.0, 0.0, 0.0)) if image is None else (z, (1.0, 0.0, 0.0), np.zeros((S, S, 3), np.uint8))
    x0, x1, y0, y1 = int(xs.min()), int(xs.max()) + 1, int(ys.min()), int(ys.max()) + 1
    e = S * (1 - 2 * marge) / max(x1 - x0, y1 - y0)
    tx, ty = S / 2 - e * (x0 + x1) / 2, S / 2 - e * (y0 + y1) / 2
    M = np.array([[e, 0, tx], [0, e, ty]], np.float64)
    sortie = _warp(m.astype(np.float32), M, S, e) > 0.5
    if image is None:
        return sortie, (float(e), float(tx), float(ty))
    img = _warp(image, M, S, e)
    return sortie, (float(e), float(tx), float(ty)), img


def _warp(a, M, S, e):
    """Reechantillonnage : INTER_AREA par cv2.resize puis collage si on reduit (warpAffine ne fait pas d'aire), lineaire si on agrandit."""
    if e >= 1.0:
        return cv2.warpAffine(a, M, (S, S), flags=cv2.INTER_LINEAR)
    h, w = a.shape[:2]
    nw, nh = max(1, int(round(w * e))), max(1, int(round(h * e)))
    r = cv2.resize(a, (nw, nh), interpolation=cv2.INTER_AREA)
    # apres le resize, un point x_image devient (nw/w)*x : on corrige l'arrondi de taille par un petit facteur residuel
    M2 = np.array([[M[0, 0] / (nw / w), 0, M[0, 2]], [0, M[1, 1] / (nh / h), M[1, 2]]], np.float64)
    return cv2.warpAffine(r, M2, (S, S), flags=cv2.INTER_LINEAR)


def _boite(m):
    ys, xs = np.where(m)
    if len(xs) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


# ------------------------------------------------------------------ metriques
def _contour(m):
    u = m.astype(np.uint8)
    return (u > 0) & (cv2.erode(u, np.ones((3, 3), np.uint8), borderType=cv2.BORDER_CONSTANT, borderValue=0) == 0)


def _dist_a(contour):
    """Distance (px) de chaque pixel au contour le plus proche."""
    return cv2.distanceTransform((~contour).astype(np.uint8), cv2.DIST_L2, 5)


def metriques_contour(ref, sil, hauteur, tol=0.02):
    cr, cs = _contour(ref), _contour(sil)
    if cr.sum() == 0 or cs.sum() == 0:
        return {'precision': 0.0, 'rappel': 0.0, 'f_contour': 0.0, 'f_contour_demi_tol': 0.0, 'hausdorff_moyen': 1.0, 'hausdorff_95': 1.0}
    dr, ds = _dist_a(cr), _dist_a(cs)
    d_sil_ref = dr[cs]          # chaque point du contour 3D -> contour reference
    d_ref_sil = ds[cr]
    t = tol * hauteur
    p, r = float((d_sil_ref <= t).mean()), float((d_ref_sil <= t).mean())
    f = 0.0 if p + r == 0 else 2 * p * r / (p + r)
    t2 = 0.5 * t
    p2, r2 = float((d_sil_ref <= t2).mean()), float((d_ref_sil <= t2).mean())
    return {'precision': p, 'rappel': r, 'f_contour': f, 'f_contour_demi_tol': 0.0 if p2 + r2 == 0 else 2 * p2 * r2 / (p2 + r2),
            'hausdorff_moyen': float(0.5 * (d_sil_ref.mean() + d_ref_sil.mean()) / hauteur),
            'hausdorff_95': float(max(np.percentile(d_sil_ref, 95), np.percentile(d_ref_sil, 95)) / hauteur)}


def regions(ref, sil, cadre, grille=(3, 2)):
    """Erreurs par cellule d'une grille (colonnes x lignes) sur la boite `cadre` = (x0, y0, x1, y1). Pourcentages de l'AIRE TOTALE de la reference
    (leur somme sur toutes les cellules redonne le manquant / l'exces globaux)."""
    nc, nl = grille
    x0, y0, x1, y1 = cadre
    xs = np.linspace(x0, x1, nc + 1).round().astype(int)
    ys = np.linspace(y0, y1, nl + 1).round().astype(int)
    total = max(int(ref.sum()), 1)
    cells = []
    for j in range(nl):
        for i in range(nc):
            r = ref[ys[j]:ys[j + 1], xs[i]:xs[i + 1]]
            s = sil[ys[j]:ys[j + 1], xs[i]:xs[i + 1]]
            inter, uni = int((r & s).sum()), int((r | s).sum())
            cells.append({'zone': '%s-%s' % (NOMS_LIG[nl][j], NOMS_COL[nc][i]),
                          'aire_ref_pct': 100.0 * r.sum() / total,
                          'manquant_pct': 100.0 * (r & ~s).sum() / total,
                          'en_trop_pct': 100.0 * (s & ~r).sum() / total,
                          'iou_cellule': (inter / uni) if uni else None})
    return cells


def _zone_de(cx, cy, cadre, grille=(3, 2)):
    nc, nl = grille
    x0, y0, x1, y1 = cadre
    i = min(nc - 1, max(0, int((cx - x0) / max(x1 - x0, 1) * nc)))
    j = min(nl - 1, max(0, int((cy - y0) / max(y1 - y0, 1) * nl)))
    return '%s-%s' % (NOMS_LIG[nl][j], NOMS_COL[nc][i])


def parties_fines(ref, sil, hauteur, rayon_fin=0.02, tol=0.02, cadre=None, couverture_min=0.5):
    """Parties de la reference qui n'ont plus d'equivalent dans la silhouette 3D.
    (a) PARTIES FINES : residu de ref apres ouverture par un disque de rayon `rayon_fin`*hauteur (= tout ce qui est plus etroit que 2*rayon_fin*hauteur :
        arme, queue, corne, antenne, doigt, patte fine), prive d'un liseré de 2 px (coins des formes epaisses). Chaque composante connexe de ce residu
        (aire >= 0,02 % du canevas) est « perdue » si moins de `couverture_min` de sa surface tombe dans la silhouette 3D dilatee de `tol`*hauteur.
    (b) COMPOSANTES ENTIERES : composantes connexes du masque de reference (aire >= 0,05 % du canevas) sans equivalent (meme critere).
    Rend dict(fines=[...], fraction_fines_perdue, composantes_perdues=[...], aire_fines_ref_pct)."""
    S = ref.shape[0]
    r = max(1, int(round(rayon_fin * hauteur)))
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    u = ref.astype(np.uint8)
    corps = cv2.morphologyEx(u, cv2.MORPH_OPEN, k)
    corps = cv2.dilate(corps, np.ones((5, 5), np.uint8))
    fin = (u > 0) & (corps == 0)
    t = max(1, int(round(tol * hauteur)))
    sil_d = cv2.dilate(sil.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * t + 1, 2 * t + 1))) > 0
    amin = 0.0002 * S * S
    totref = max(int(ref.sum()), 1)
    fines, perdu, tot = [], 0, 0
    n, lab, st, cen = cv2.connectedComponentsWithStats(fin.astype(np.uint8), connectivity=8)
    for i in range(1, n):
        a = int(st[i, cv2.CC_STAT_AREA])
        if a < amin:
            continue
        comp = lab == i
        cov = float((comp & sil_d).sum() / a)
        tot += a
        d = {'aire_pct_ref': 100.0 * a / totref, 'couverture_3d': cov, 'perdue': cov < couverture_min,
             'boite': [int(st[i, 0]), int(st[i, 1]), int(st[i, 0] + st[i, 2]), int(st[i, 1] + st[i, 3])],
             'zone': _zone_de(cen[i][0], cen[i][1], cadre or (0, 0, S, S)),
             'longueur_pct_hauteur': 100.0 * max(st[i, 2], st[i, 3]) / hauteur}
        if d['perdue']:
            perdu += a
        fines.append(d)
    fines.sort(key=lambda d: -d['aire_pct_ref'])
    entieres = []
    n, lab, st, cen = cv2.connectedComponentsWithStats(u, connectivity=8)
    amin2 = 0.0005 * S * S
    for i in range(1, n):
        a = int(st[i, cv2.CC_STAT_AREA])
        if a < amin2:
            continue
        comp = lab == i
        cov = float((comp & sil_d).sum() / a)
        if cov < couverture_min:
            entieres.append({'aire_pct_ref': 100.0 * a / totref, 'couverture_3d': cov,
                             'zone': _zone_de(cen[i][0], cen[i][1], cadre or (0, 0, S, S)),
                             'boite': [int(st[i, 0]), int(st[i, 1]), int(st[i, 0] + st[i, 2]), int(st[i, 1] + st[i, 3])]})
    return {'fines': fines, 'fraction_fines_perdue': (perdu / tot) if tot else 0.0, 'aire_fines_ref_pct': 100.0 * tot / totref,
            'nb_fines': len(fines), 'nb_fines_perdues': sum(1 for d in fines if d['perdue']), 'composantes_perdues': entieres}


def recaler(ref, sil, S=256, iterations=7):
    """Meilleur IoU de `sil` sur `ref` sous une similitude (echelle, dx, dy) : descente par coordonnees a pas decroissants, a S px. Sert de DIAGNOSTIC (cadrage
    ou proportions differents) : il ne remplace pas l'IoU de boite, qui est la mesure officielle."""
    if sil.shape[0] != S:
        ref = cv2.resize(ref.astype(np.uint8), (S, S), interpolation=cv2.INTER_NEAREST) > 0
        sil = cv2.resize(sil.astype(np.uint8), (S, S), interpolation=cv2.INTER_NEAREST) > 0
    sf = sil.astype(np.float32)

    def iou(p):
        e, dx, dy = p
        M = np.array([[e, 0, S / 2 * (1 - e) + dx * S], [0, e, S / 2 * (1 - e) + dy * S]], np.float32)
        w = cv2.warpAffine(sf, M, (S, S), flags=cv2.INTER_LINEAR) > 0.5
        return (w & ref).sum() / max((w | ref).sum(), 1)

    p = [1.0, 0.0, 0.0]
    best = iou(p)
    pas = [0.06, 0.03, 0.03]
    for _ in range(iterations):
        for i in range(3):
            for sg in (-1, 1):
                q = list(p)
                q[i] += sg * pas[i]
                if q[0] < 0.5 or q[0] > 2.0:
                    continue
                v = iou(q)
                if v > best + 1e-6:
                    best, p = v, q
        pas = [x * 0.6 for x in pas]
    return float(best), {'echelle': float(p[0]), 'dx_pct': float(100 * p[1]), 'dy_pct': float(100 * p[2])}


def appliquer_recalage(sil, p):
    """Applique la similitude trouvee par `recaler` (echelle autour du centre du canevas, puis translation en fraction du cote) a un masque."""
    S = sil.shape[0]
    e = p['echelle']
    M = np.array([[e, 0, S / 2 * (1 - e) + p['dx_pct'] / 100 * S], [0, e, S / 2 * (1 - e) + p['dy_pct'] / 100 * S]], np.float32)
    return cv2.warpAffine(sil.astype(np.float32), M, (S, S), flags=cv2.INTER_LINEAR) > 0.5


def score_global(iou, f_contour, hausdorff_moyen, fraction_fines_perdue):
    """Score 0-100 (voir README). 100 = silhouettes identiques ; 0 = rien en commun."""
    w = POIDS_SCORE
    terme_h = max(0.0, 1.0 - min(1.0, hausdorff_moyen / HAUSDORFF_NUL))
    return 100.0 * (w['iou'] * iou + w['f_contour'] * f_contour + w['hausdorff'] * terme_h + w['fines'] * (1.0 - fraction_fines_perdue))


def comparer(masque_ref, masque_3d, S=512, marge=0.05, tol=0.02, rayon_fin=0.02, grille=(3, 2), image_ref=None, avec_recalage=True):
    """Compare deux masques bool de tailles quelconques. Les deux sont normalises par leur boite englobante (cf. `normaliser`).
    Retourne un dict de metriques (et, sous la cle '_images', les masques normalises et le diff BGR)."""
    if image_ref is not None:
        ref, tr_ref, img_n = normaliser(masque_ref, S, marge, image_ref)
    else:
        ref, tr_ref = normaliser(masque_ref, S, marge)
        img_n = None
    sil, tr_sil = normaliser(masque_3d, S, marge)
    br, bs = _boite(masque_ref), _boite(masque_3d)
    bn = _boite(ref)
    H = (bn[3] - bn[1]) if bn else S
    inter = int((ref & sil).sum())
    uni = int((ref | sil).sum())
    iou = inter / uni if uni else 0.0
    dice = 2 * inter / max(int(ref.sum()) + int(sil.sum()), 1)
    mc = metriques_contour(ref, sil, H, tol)
    cadre_u = _boite(ref | sil)
    reg = regions(ref, sil, cadre_u, grille) if cadre_u else []
    pf = parties_fines(ref, sil, H, rayon_fin, tol, cadre_u)
    res = {
        'iou': iou, 'dice': dice, **mc,
        'manquant_pct': 100.0 * (ref & ~sil).sum() / max(int(ref.sum()), 1),
        'en_trop_pct': 100.0 * (sil & ~ref).sum() / max(int(ref.sum()), 1),
        'regions': reg,
        'parties_fines': pf,
        'boite_ref': {'largeur': (br[2] - br[0]) if br else 0, 'hauteur': (br[3] - br[1]) if br else 0},
        'boite_3d': {'largeur': (bs[2] - bs[0]) if bs else 0, 'hauteur': (bs[3] - bs[1]) if bs else 0},
    }
    if br and bs:
        res['aspect_ref'] = (br[2] - br[0]) / (br[3] - br[1])
        res['aspect_3d'] = (bs[2] - bs[0]) / (bs[3] - bs[1])
        res['aspect_rapport'] = res['aspect_3d'] / res['aspect_ref']     # < 1 : le 3D est plus etroit (membres perdus), > 1 : plus large
    res['score'] = score_global(iou, mc['f_contour'], mc['hausdorff_moyen'], pf['fraction_fines_perdue'])
    if avec_recalage:
        iou_r, p = recaler(ref, sil)
        sil_r = appliquer_recalage(sil, p)
        inter_r, uni_r = int((ref & sil_r).sum()), int((ref | sil_r).sum())
        mc_r = metriques_contour(ref, sil_r, H, tol)
        pf_r = parties_fines(ref, sil_r, H, rayon_fin, tol, cadre_u)
        res['recale'] = {'iou': inter_r / uni_r if uni_r else 0.0, 'dice': 2 * inter_r / max(int(ref.sum()) + int(sil_r.sum()), 1), **mc_r,
                         'fraction_fines_perdue': pf_r['fraction_fines_perdue'], 'nb_fines_perdues': pf_r['nb_fines_perdues'],
                         'manquant_pct': 100.0 * (ref & ~sil_r).sum() / max(int(ref.sum()), 1), 'en_trop_pct': 100.0 * (sil_r & ~ref).sum() / max(int(ref.sum()), 1),
                         'transformation': p}
        res['recale']['score'] = score_global(res['recale']['iou'], mc_r['f_contour'], mc_r['hausdorff_moyen'], pf_r['fraction_fines_perdue'])
        res['iou_recale'] = res['recale']['iou']
    diff = np.zeros((S, S, 3), np.uint8)
    diff[:] = (28, 28, 28)
    diff[ref & sil] = (60, 190, 60)            # BGR : vert = commun
    diff[ref & ~sil] = (40, 40, 235)           # rouge = manquant dans le 3D
    diff[~ref & sil] = (235, 120, 40)          # bleu = en trop dans le 3D
    res['_images'] = {'ref': ref, 'sil': sil, 'diff': diff, 'image_ref': img_n}
    return res


# ------------------------------------------------------------------ panneau visuel
def panneau(res, titre='', relief_gris=None, S=512):
    """Image BGR : [reference normalisee (contour 3D en jaune) | diff | 3D (ombrage)]. `relief_gris` : ombrage du rendu (deja normalise ou non)."""
    im = res['_images']
    ref_img = im['image_ref']
    if ref_img is None:
        ref_img = np.dstack([im['ref'].astype(np.uint8) * 200] * 3)
    ref_img = cv2.cvtColor(np.ascontiguousarray(ref_img.astype(np.uint8)), cv2.COLOR_RGB2BGR) if im['image_ref'] is not None else ref_img
    ref_img = ref_img.copy()
    cs, _ = cv2.findContours(im['sil'].astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    cv2.drawContours(ref_img, cs, -1, (0, 230, 255), 1)
    d = im['diff'].copy()
    if relief_gris is not None:
        m = relief_gris[1]
        g, _t = _normaliser_gris(relief_gris[0], m, S)
        tro = cv2.cvtColor(g, cv2.COLOR_GRAY2BGR)
    else:
        tro = np.dstack([im['sil'].astype(np.uint8) * 220] * 3)
    ligne = np.hstack([ref_img, d, tro])
    bandeau = np.full((44, ligne.shape[1], 3), 20, np.uint8)
    txt = '%s | score %.1f | IoU %.3f | F-contour %.3f | manque %.1f %% | en trop %.1f %%' % (titre, res['score'], res['iou'], res['f_contour'], res['manquant_pct'], res['en_trop_pct'])
    cv2.putText(bandeau, txt[:150], (8, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (240, 240, 240), 1, cv2.LINE_AA)
    leg = np.full((22, ligne.shape[1], 3), 20, np.uint8)
    cv2.putText(leg, 'gauche : reference + contour 3D (jaune) | milieu : vert = commun, rouge = manque dans le 3D, bleu = en trop | droite : 3D', (8, 15), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (200, 200, 200), 1, cv2.LINE_AA)
    return np.vstack([bandeau, ligne, leg])


def _normaliser_gris(g, m, S):
    ys, xs = np.where(m)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    e = S * 0.9 / max(x1 - x0, y1 - y0)
    M = np.array([[e, 0, S / 2 - e * (x0 + x1) / 2], [0, e, S / 2 - e * (y0 + y1) / 2]], np.float32)
    return cv2.warpAffine(g, M, (S, S), flags=cv2.INTER_AREA if e < 1 else cv2.INTER_LINEAR), M


# ------------------------------------------------------------------ chaine complete
def evaluer(image, glb, haut='+y', yaw='auto', methode='auto', persp=None, S=512, taille_rendu=1024, panneau_png=None, relief=False, aussi_u2net=True, pose_libre=True, **kw):
    """Image de reference + GLB -> dict de metriques (JSON-izable, sans '_images').
    haut : axe du haut du GLB ('+y' glTF) ou 'auto' (essaie les 6 axes) ; yaw : 'auto' (choisit entre 0 et 180 : une reference de face se compare a une vue de
    face ou de dos ; departage par la couleur si les deux sont a 0,02 d'IoU), 'auto4' (choisit parmi 0/90/180/270) ou un entier. Les 4 lacets sont toujours
    mesures et rapportes (`orientation.iou_par_lacet`).
    aussi_u2net : calcule aussi l'IoU contre le masque u2net (ce que le pipeline donne au modele 3D) quand le masque principal n'est pas deja u2net.
    panneau_png : si donne, ecrit le panneau [reference | diff | 3D]. relief=True : le panneau montre l'ombrage 3D plutot que la silhouette."""
    mr = MR.masque_reference(image, methode)
    V, F, C = RS.charger_glb(glb, couleurs=True)
    hauts = list(RS.AXES_HAUT) if haut == 'auto' else [haut]
    if yaw in ('auto', 'auto4'):
        lacets, parmi = RS.LACETS, ((0, 180) if yaw == 'auto' else None)
    else:
        lacets, parmi = (int(yaw),), None
    orient = RS.chercher_orientation(V, F, mr['masque'], hauts, lacets, 512, persp, C, mr['rgb'], choisir_parmi=parmi)
    b = orient['meilleur']
    m3d, info = RS.rendre_masque(V, F, taille_rendu, b['haut'], b['yaw'], False, persp)
    res = comparer(mr['masque'], m3d, S=S, image_ref=mr['rgb'], **kw)
    res['orientation'] = {'haut': b['haut'], 'yaw': b['yaw'], 'iou_orientation': b['iou'],
                          'iou_sens_oppose': next((c['iou'] for c in orient['candidats'] if not c['miroir'] and c['haut'] == b['haut'] and c['yaw'] == (b['yaw'] + 180) % 360), None),
                          'par_couleur': bool(b.get('par_couleur', False)),
                          'iou_par_lacet': {str(c['yaw']): round(c['iou'], 4) for c in orient['candidats'] if not c['miroir'] and c['haut'] == b['haut']},
                          'miroir_diagnostic': orient['miroir_diagnostic']}
    if 'departage_couleur' in orient:
        res['orientation']['departage_couleur'] = orient['departage_couleur']
    res['masque_reference'] = {'methode': mr['methode'], 'surface_pct': 100.0 * mr['masque'].mean(), 'coupe_bords_pct': 100.0 * mr['coupe_bords'], 'taille_image': list(mr['masque'].shape[::-1])}
    res['modele'] = {'faces': int(len(F)), 'sommets': int(len(V)), 'etendue': [float(x) for x in (V.max(0) - V.min(0))]}
    if aussi_u2net and mr['methode'] != 'u2net':
        try:
            mu = MR.masque_reference(image, 'u2net')
            ru = comparer(mu['masque'], m3d, S=S, avec_recalage=False, **kw)
            res['contre_u2net'] = {'iou': ru['iou'], 'score': ru['score'], 'f_contour': ru['f_contour'], 'surface_pct': 100.0 * mu['masque'].mean(),
                                   'iou_masques': float((mu['masque'] & mr['masque']).sum() / max((mu['masque'] | mr['masque']).sum(), 1))}
        except MR.MasqueIntrouvable as e:
            res['contre_u2net'] = {'indisponible': str(e)}
    if pose_libre:
        pl = RS.chercher_pose(V, F, mr['masque'], persp=persp)
        ml, _ = RS.rendre_masque(V, F, taille_rendu, pl['haut'], pl['yaw'], False, persp, pitch=pl['pitch'])
        rl = comparer(mr['masque'], ml, S=S, image_ref=mr['rgb'], avec_recalage=False, **kw)
        res['pose_libre'] = {'pose': pl, 'score': rl['score'], 'iou': rl['iou'], 'dice': rl['dice'], 'f_contour': rl['f_contour'], 'hausdorff_moyen': rl['hausdorff_moyen'],
                             'manquant_pct': rl['manquant_pct'], 'en_trop_pct': rl['en_trop_pct'], 'nb_fines_perdues': rl['parties_fines']['nb_fines_perdues'],
                             'nb_fines': rl['parties_fines']['nb_fines'], 'fraction_fines_perdue': rl['parties_fines']['fraction_fines_perdue'],
                             'regions': rl['regions']}
        if panneau_png:
            cv2.imwrite(os.path.splitext(panneau_png)[0] + '_libre.png', panneau(rl, 'POSE LIBRE %s az %.0f pitch %.0f' % (pl['haut'], pl['yaw'], pl['pitch']), None, S))
    rel = None
    if relief:
        r = RS.rendre_relief(V, F, 768, b['haut'], b['yaw'], False, persp, cadre=None)
        rel = (r['ombrage'], r['masque'])
    if panneau_png:
        os.makedirs(os.path.dirname(os.path.abspath(panneau_png)), exist_ok=True)
        cv2.imwrite(panneau_png, panneau(res, os.path.basename(str(glb))[:40], rel, S))
    res.pop('_images', None)
    return res


def nettoyer_json(o):
    if isinstance(o, dict):
        return {k: nettoyer_json(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [nettoyer_json(v) for v in o]
    if isinstance(o, (np.floating,)):
        return float(o)
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, np.bool_):
        return bool(o)
    return o


def main(argv=None):
    ap = argparse.ArgumentParser(description="IoU / contour / parties fines : silhouette de face d'un GLB contre l'image de reference.")
    ap.add_argument('image')
    ap.add_argument('glb')
    ap.add_argument('--haut', default='+y', help="axe du haut du GLB (+y pour glTF) ou auto")
    ap.add_argument('--yaw', default='auto', help="auto (0 ou 180), auto4 (0/90/180/270) ou un entier")
    ap.add_argument('--methode', default='auto', choices=['auto', 'alpha', 'fond', 'u2net'])
    ap.add_argument('--persp', type=float, default=None)
    ap.add_argument('--rayon-fin', type=float, default=0.02, help="une partie est « fine » si plus etroite que 2 x ce rayon (fraction de la hauteur)")
    ap.add_argument('--tol', type=float, default=0.02)
    ap.add_argument('--sortie', default=None, help="dossier de sortie (defaut C:/tmp/fidelite/iou)")
    ap.add_argument('--relief', action='store_true', help="panneau avec l'ombrage 3D (rendu peintre, quelques secondes)")
    a = ap.parse_args(argv)
    out = a.sortie or 'C:/tmp/fidelite/iou'
    os.makedirs(out, exist_ok=True)
    nom = os.path.splitext(os.path.basename(a.glb))[0]
    res = evaluer(a.image, a.glb, a.haut, a.yaw, a.methode, a.persp, panneau_png=os.path.join(out, nom + '_diff.png'), relief=a.relief,
                  rayon_fin=a.rayon_fin, tol=a.tol)
    res = nettoyer_json(res)
    with open(os.path.join(out, nom + '.json'), 'w', encoding='utf-8') as f:
        json.dump(res, f, indent=1, ensure_ascii=False)
    o = res['orientation']
    print('score %.1f/100 | IoU %.3f | Dice %.3f | F-contour(%.0f%%) %.3f | Hausdorff moyen %.2f %% H | manquant %.1f %% | en trop %.1f %% | apres recalage : IoU %.3f, score %.1f'
          % (res['score'], res['iou'], res['dice'], 100 * a.tol, res['f_contour'], 100 * res['hausdorff_moyen'], res['manquant_pct'], res['en_trop_pct'], res['recale']['iou'], res['recale']['score']))
    print('orientation : haut %s, lacet %d (IoU %.3f ; sens oppose %.3f) | masque ref : %s' % (o['haut'], o['yaw'], o['iou_orientation'], o['iou_sens_oppose'] or float('nan'), res['masque_reference']['methode']))
    pf = res['parties_fines']
    print('parties fines : %d, dont %d perdues (%.0f %% de leur aire) ; composantes entieres perdues : %d' % (pf['nb_fines'], pf['nb_fines_perdues'], 100 * pf['fraction_fines_perdue'], len(pf['composantes_perdues'])))
    for c in res['regions']:
        print('  %-12s ref %.1f %% | manque %.1f %% | en trop %.1f %%' % (c['zone'], c['aire_ref_pct'], c['manquant_pct'], c['en_trop_pct']))
    print('->', os.path.join(out, nom + '_diff.png'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
