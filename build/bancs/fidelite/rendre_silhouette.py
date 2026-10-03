"""Banc de fidelite de FORME (03/10/2026) -- rendu CPU de la silhouette d'un GLB, sans OpenGL.

Repere canonique du banc : x vers la droite de l'image, y vers le HAUT, z vers l'observateur (la camera est en +z et regarde vers -z).
Un GLB glTF est en Y haut, la face avant d'un modele regarde +Z (convention glTF) : `orienter(V, haut='+y', yaw=0)` ne change rien.

Ce module :
  - charge un GLB (fusion de toutes les geometries, transformations du graphe de scene appliquees) ;
  - le met dans le repere canonique (`orienter` : axe du haut, lacet de 0/90/180/270 degres, miroir) ;
  - rasterise la silhouette (union des triangles projetes, cv2.fillPoly en un seul appel : ~0,5 s pour 500 K faces) ;
  - en option, un RELIEF (ombrage + profondeur, algorithme du peintre) et une couleur par face (atlas echantillonne au centre du triangle) ;
  - cherche l'orientation du modele qui recouvre le mieux un masque de reference (`chercher_orientation`).
Aucun calcul GPU, rien n'est ecrit dans les projets. Utilisable en bibliotheque ou en ligne de commande (voir README.md).
"""
import argparse
import math
import os
import sys

import numpy as np
import cv2

AXES_HAUT = ('+y', '-y', '+z', '-z', '+x', '-x')
LACETS = (0, 90, 180, 270)


# ---------------------------------------------------------------- chargement
def charger_glb(chemin, couleurs=False):
    """Retourne (V float64 (N,3), F int32 (M,3)) -- et, avec couleurs=True, un troisieme element :
    couleur uint8 (M,3) par face, echantillonnee dans la texture de base au centre du triangle (gris moyen si pas de texture).
    Toutes les geometries de la scene sont fusionnees, avec leur transformation de noeud."""
    import trimesh
    scene = trimesh.load(chemin, force='scene', process=False)
    Vs, Fs, Cs = [], [], []
    deca = 0
    if isinstance(scene, trimesh.Trimesh):
        paires = [(scene, np.eye(4))]
    else:
        paires = []
        for nom_noeud in scene.graph.nodes_geometry:
            T, nom_geo = scene.graph[nom_noeud]
            paires.append((scene.geometry[nom_geo], T))
    for g, T in paires:
        if not hasattr(g, 'faces') or len(getattr(g, 'faces', [])) == 0:
            continue
        v = np.asarray(g.vertices, dtype=np.float64)
        v = v @ np.asarray(T)[:3, :3].T + np.asarray(T)[:3, 3]
        f = np.asarray(g.faces, dtype=np.int64)
        Vs.append(v)
        Fs.append(f + deca)
        deca += len(v)
        if couleurs:
            Cs.append(_couleurs_faces(g))
    if not Vs:
        raise ValueError('GLB sans triangle : ' + str(chemin))
    V = np.concatenate(Vs)
    F = np.concatenate(Fs).astype(np.int32)
    if couleurs:
        return V, F, np.concatenate(Cs)
    return V, F


def _couleurs_faces(g):
    """Couleur uint8 par face : atlas de base echantillonne (au plus proche) au barycentre UV du triangle."""
    nf = len(g.faces)
    gris = np.full((nf, 3), 128, np.uint8)
    try:
        vis = g.visual
        uv = getattr(vis, 'uv', None)
        mat = getattr(vis, 'material', None)
        img = None
        if mat is not None:
            img = getattr(mat, 'baseColorTexture', None) or getattr(mat, 'image', None)
        if uv is None or img is None:
            fac = getattr(mat, 'baseColorFactor', None) if mat is not None else None
            if fac is not None:
                gris[:] = np.asarray(fac[:3], dtype=np.uint8)
            return gris
        tex = np.asarray(img.convert('RGB'))
        H, W = tex.shape[:2]
        uv = np.asarray(uv, dtype=np.float64)
        c = uv[np.asarray(g.faces)].mean(axis=1)              # (nf,2) barycentre
        col = np.clip((c[:, 0] % 1.0) * W, 0, W - 1).astype(np.int64)
        row = np.clip((1.0 - (c[:, 1] % 1.0)) * H, 0, H - 1).astype(np.int64)   # trimesh : v vers le haut
        return tex[row, col]
    except Exception:
        return gris


# ---------------------------------------------------------------- orientation
def orienter(V, haut='+y', yaw=0, miroir=False, pitch=0.0):
    """Rotation propre (det = +1) qui amene l'axe `haut` du modele sur +y, puis lacet (degres, autour de y), puis miroir x optionnel.
    Pour yaw=0 la camera (en +z) voit la face qui regarde +z ; yaw=180 equivaut a regarder depuis -z. yaw et pitch (degres) peuvent etre quelconques ;
    pitch > 0 fait basculer le haut du modele vers la camera (on le voit un peu PAR DESSUS)."""
    x, y, z = V[:, 0], V[:, 1], V[:, 2]
    tab = {'+y': (x, y, z), '-y': (-x, -y, z), '+z': (x, z, -y), '-z': (x, -z, y), '+x': (-y, x, z), '-x': (y, -x, z)}
    if haut not in tab:
        raise ValueError('haut doit etre dans %s' % (AXES_HAUT,))
    x, y, z = tab[haut]
    a = math.radians(yaw)
    c, s = math.cos(a), math.sin(a)
    xn = x * c + z * s
    zn = -x * s + z * c
    if miroir:
        xn = -xn
    if pitch:
        p = math.radians(pitch)
        cp, sp = math.cos(p), math.sin(p)
        y, zn = y * cp - zn * sp, y * sp + zn * cp
    return np.stack([xn, y, zn], axis=1)


def _norm_haut(h):
    h = h.lower()
    return h if h[0] in '+-' else '+' + h


# ---------------------------------------------------------------- projection et cadrage
def projeter(Vc, persp=None):
    """(X, Y, Z) en coordonnees ecran (X droite, Y haut) + profondeur Z (grand = proche de la camera).
    persp=None : orthographique. persp=k : perspective, camera a k fois le rayon de la boite englobante en avant du centre."""
    if persp is None:
        return Vc[:, 0], Vc[:, 1], Vc[:, 2]
    rayon = float(np.linalg.norm(Vc.max(0) - Vc.min(0))) / 2
    D = persp * rayon
    w = np.maximum(D - Vc[:, 2], 1e-6 * rayon)
    return Vc[:, 0] / w * D, Vc[:, 1] / w * D, Vc[:, 2]


def cadrage(X, Y, taille, marge=0.03, cadre=None):
    """Cadrage isotrope : retourne (echelle, cx, cy) tel que px = cx + echelle*X, py = cy - echelle*Y.
    Sans `cadre`, la boite englobante projetee remplit (1 - 2*marge) du cote de l'image, centree. `cadre` = (echelle, cx, cy) force."""
    if cadre is not None:
        return cadre
    x0, x1, y0, y1 = X.min(), X.max(), Y.min(), Y.max()
    w, h = max(x1 - x0, 1e-9), max(y1 - y0, 1e-9)
    e = taille * (1 - 2 * marge) / max(w, h)
    return (float(e), float(taille / 2 - e * (x0 + x1) / 2), float(taille / 2 + e * (y0 + y1) / 2))


def _pixels(X, Y, cadre):
    e, cx, cy = cadre
    return cx + e * X, cy - e * Y


# ---------------------------------------------------------------- rendus
def _sous_echantillon(F, taille, max_faces):
    n = int(3 * taille * taille) if max_faces == 'auto' else max_faces
    if n is None or len(F) <= n:
        return F
    return F[np.random.default_rng(12345).choice(len(F), n, replace=False)]


def rendre_masque(V, F, taille=1024, haut='+y', yaw=0, miroir=False, persp=None, marge=0.03, cadre=None, ouvrir='auto', max_faces='auto', pitch=0.0):
    """Silhouette binaire (bool (taille, taille)) + dict d'infos (cadre, boite en pixels). Triangles grands : cv2.fillConvexPoly un par un ; triangles petits :
    aretes en un appel groupe (cv2.polylines). Jamais cv2.fillPoly sur le maillage : il remplit en parite et annule les recouvrements (voir plus bas).
    Virgule fixe 1/16 px. Biais : tout pixel touche par un triangle est rempli (~0,5 px plus gras qu'un echantillonnage au centre du pixel).
    ouvrir : ouverture morphologique k x k (k impair) qui retire les traits fins, typiquement un plan mince (sol) vu EXACTEMENT par la tranche : il n'a
    pas de surface visible mais etirerait la boite englobante (cas mesure : dalle de 1 m x 1 m a 2 mm d'epaisseur sous un orc). 'auto' = 0,5 % du cote
    de l'image (5 px a 1024, 3 px a 512), 0 = silhouette brute.
    max_faces : 'auto' = 3 triangles par pixel de l'image (3 M a 1024, 0,8 M a 512) ; au-dela, sous-echantillon aleatoire reproductible des triangles
    (un maillage de 10 M de faces passe de 6 s a 2 s par rendu, sans trou mesurable : plusieurs couches de triangles couvrent chaque pixel). None = tout."""
    if ouvrir == 'auto':
        ouvrir = max(3, int(round(0.005 * taille)) | 1)
    Vc = orienter(V, _norm_haut(haut), yaw, miroir, pitch)
    X, Y, _ = projeter(Vc, persp)
    cad = cadrage(X, Y, taille, marge, cadre)
    px, py = _pixels(X, Y, cad)
    img = np.zeros((taille, taille), np.uint8)
    pts = np.stack([px, py], axis=1)
    F = _sous_echantillon(F, taille, max_faces)
    tri = np.rint(pts[F] * 16).astype(np.int32)           # (M,3,2)
    tri = tri[np.abs(tri).max(axis=(1, 2)) < (1 << 28)]
    # PIEGE MESURE (03/10/2026) : cv2.fillPoly remplit en PARITE (pair-impair) : deux triangles qui se recouvrent s'ANNULENT (un cube vu de face, dont la
    # face avant et la face arriere se superposent, sort vide ; un bras devant un torse laisse un trou). On ne l'emploie donc jamais sur le maillage.
    # Les triangles de plus de 1 px sont remplis un par un (fillConvexPoly = union) ; les plus petits (sur un maillage de 10 M de faces) sont traces par
    # leurs aretes (cv2.polylines = union), ce qui les couvre entierement a cette taille. (Seuil 2,5 px essaye : un maillage de 82 K faces sur un disque
    # de 230 px ne ressortait rempli qu'a 50 % -- l'interieur des triangles de 2 px reste vide.)
    etendue = (tri.max(axis=1) - tri.min(axis=1)).max(axis=1)          # en 1/16 px
    grand = etendue > 16
    petits = tri[~grand]
    if len(petits):
        for k in range(0, len(petits), 2_000_000):
            cv2.polylines(img, petits[k:k + 2_000_000], True, 1, thickness=1, lineType=cv2.LINE_8, shift=4)
    for t in tri[grand]:
        cv2.fillConvexPoly(img, t, 1, cv2.LINE_8, 4)
    ix, iy = np.clip(np.rint(px).astype(np.int64), 0, taille - 1), np.clip(np.rint(py).astype(np.int64), 0, taille - 1)
    img[iy, ix] = 1                                       # sommets isoles : jamais perdus
    if ouvrir and ouvrir > 1:
        img = cv2.morphologyEx(img, cv2.MORPH_OPEN, np.ones((ouvrir, ouvrir), np.uint8))
    m = img > 0
    ys, xs = np.where(m)
    info = {'cadre': cad, 'boite_px': (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())) if len(xs) else None,
            'haut': _norm_haut(haut), 'yaw': yaw, 'pitch': pitch, 'miroir': bool(miroir), 'persp': persp, 'taille': taille}
    return m, info


def rendre_relief(V, F, taille=768, haut='+y', yaw=0, miroir=False, persp=None, marge=0.03, cadre=None, couleurs=None, lumiere=(-0.4, 0.6, 0.7), max_faces=400000):
    """Rendu 'peintre' (triangles tries du plus loin au plus proche, ombrage plat) : dict(masque, ombrage uint8, profondeur float32 (nan hors sujet),
    couleur uint8 (taille,taille,3) si `couleurs` (couleur par face) est fourni, info). ~2-4 s pour 500 K faces. Au-dela de `max_faces`, sous-echantillon
    aleatoire (le rendu devient troue : a n'utiliser que pour des correlations floues ; la couleur est alors donnee par couleur[masque])."""
    if max_faces is not None and len(F) > max_faces:
        sel = np.random.default_rng(12345).choice(len(F), max_faces, replace=False)
        F = F[sel]
        if couleurs is not None:
            couleurs = couleurs[sel]
    Vc = orienter(V, _norm_haut(haut), yaw, miroir)
    X, Y, Z = projeter(Vc, persp)
    cad = cadrage(X, Y, taille, marge, cadre)
    px, py = _pixels(X, Y, cad)
    tri = np.rint(np.stack([px, py], axis=1)[F] * 16).astype(np.int32)
    P0, P1, P2 = Vc[F[:, 0]], Vc[F[:, 1]], Vc[F[:, 2]]
    n = np.cross(P1 - P0, P2 - P0)
    n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
    L = np.asarray(lumiere, float)
    L /= np.linalg.norm(L)
    lam = np.abs(n @ L)                                   # |n.L| : indifferent au sens d'enroulement des triangles
    gris = (40 + 215 * lam).clip(0, 255).astype(np.uint8)
    zf = Z[F].mean(axis=1)
    ordre = np.argsort(zf, kind='stable')                  # le plus loin d'abord
    zmin, zmax = float(Z.min()), float(Z.max())
    zn = ((zf - zmin) / max(zmax - zmin, 1e-12)).astype(np.float32)
    omb = np.zeros((taille, taille), np.uint8)
    prof = np.full((taille, taille), np.nan, np.float32)
    msk = np.zeros((taille, taille), np.uint8)
    col = np.zeros((taille, taille, 3), np.uint8) if couleurs is not None else None
    for i in ordre.tolist():
        t = tri[i]
        cv2.fillConvexPoly(omb, t, int(gris[i]), cv2.LINE_8, 4)
        cv2.fillConvexPoly(prof, t, float(zn[i]), cv2.LINE_8, 4)
        cv2.fillConvexPoly(msk, t, 1, cv2.LINE_8, 4)
        if col is not None:
            c = couleurs[i]
            cv2.fillConvexPoly(col, t, (int(c[0]), int(c[1]), int(c[2])), cv2.LINE_8, 4)
    info = {'cadre': cad, 'haut': _norm_haut(haut), 'yaw': yaw, 'miroir': bool(miroir), 'persp': persp, 'taille': taille}
    return {'masque': msk > 0, 'ombrage': omb, 'profondeur': prof, 'couleur': col, 'info': info}


# ---------------------------------------------------------------- orientation
def normaliser_masque(m, S=256, marge=0.05):
    """Boite englobante -> (S,S), echelle isotrope (le plus grand cote = 1 - 2*marge), centree. Renvoie un masque bool.
    La boite est decoupee, reduite par moyenne de surface (cv2.INTER_AREA : pas de crenelage des parties fines), puis centree."""
    ys, xs = np.where(m)
    if len(xs) == 0:
        return np.zeros((S, S), bool)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    w, h = x1 - x0, y1 - y0
    e = S * (1 - 2 * marge) / max(w, h)
    nw, nh = max(1, int(round(w * e))), max(1, int(round(h * e)))
    r = cv2.resize(m[y0:y1, x0:x1].astype(np.float32), (nw, nh), interpolation=cv2.INTER_AREA if e < 1 else cv2.INTER_LINEAR) > 0.5
    out = np.zeros((S, S), bool)
    ox, oy = (S - nw) // 2, (S - nh) // 2
    out[oy:oy + nh, ox:ox + nw] = r
    return out


def chercher_orientation(V, F, masque_ref, hauts=('+y',), lacets=LACETS, taille=512, persp=None, couleurs_faces=None, image_ref_rgb=None, choisir_parmi=None):
    """Teste chaque (haut, lacet) et le miroir, garde le meilleur recouvrement (IoU apres normalisation de boite) avec `masque_ref` (bool, image de reference).
    `choisir_parmi` : lacets autorises pour le CHOIX (tous sont toutefois mesures et rapportes) -- une reference de face ne se compare qu'a une vue de
    face ou de dos (0 et 180) ; les vues de cote (90/270) d'un mauvais modele peuvent recouvrir mieux « par hasard » (cas de l'orc, 03/10/2026).
    Rend dict(meilleur, candidats). IMPORTANT : une silhouette orthographique vue de +z est le MIROIR de celle vue de -z, donc (yaw=180) == (yaw=0, miroir)
    pour la silhouette : on ne peut pas distinguer 'devant' de 'derriere' par le contour seul. Les candidats equivalents sont fusionnes (le sens physique,
    sans miroir, est prefere) et, si deux sens opposes sont a moins de `tol_egalite` d'IoU, la couleur (si fournie) departage."""
    ref = normaliser_masque(masque_ref, 256)
    cands = []
    for h in hauts:
        h = _norm_haut(h)
        for yaw in lacets:
            m, _ = rendre_masque(V, F, taille, h, yaw, False, persp)
            n = normaliser_masque(m, 256)
            iou = float((n & ref).sum() / max((n | ref).sum(), 1))
            cands.append({'haut': h, 'yaw': yaw, 'miroir': False, 'iou': iou})
            nm = n[:, ::-1]                                # miroir de la silhouette = lacet + 180 (resultat identique, calcule sans nouveau rendu)
            iou_m = float((nm & ref).sum() / max((nm | ref).sum(), 1))
            cands.append({'haut': h, 'yaw': yaw, 'miroir': True, 'iou': iou_m, 'equivalent_a': 'yaw=%d' % ((yaw + 180) % 360)})
    physiques = [c for c in cands if not c['miroir']]
    eligibles = [c for c in physiques if choisir_parmi is None or c['yaw'] in choisir_parmi]
    meilleur = max(eligibles, key=lambda c: c['iou'])
    miroir_mieux = max((c for c in cands if c['miroir']), key=lambda c: c['iou'])
    res = {'meilleur': dict(meilleur), 'candidats': cands,
           'miroir_diagnostic': {'iou': miroir_mieux['iou'], 'gain_sur_physique': miroir_mieux['iou'] - meilleur['iou']}}
    # departage avant/arriere par la couleur si les deux sens opposes sont proches
    if couleurs_faces is not None and image_ref_rgb is not None:
        oppose = next((c for c in physiques if c['haut'] == meilleur['haut'] and c['yaw'] == (meilleur['yaw'] + 180) % 360), None)
        if oppose is not None and abs(oppose['iou'] - meilleur['iou']) < 0.02:
            sc = {}
            for c in (meilleur, oppose):
                sc[c['yaw']] = _score_couleur(V, F, couleurs_faces, masque_ref, image_ref_rgb, c['haut'], c['yaw'], persp)
            res['departage_couleur'] = {'scores': sc, 'raison': 'silhouettes quasi miroirs : avant/arriere departages par la couleur'}
            best_yaw = max(sc, key=sc.get)
            if best_yaw != meilleur['yaw']:
                res['meilleur'] = dict(oppose)
                res['meilleur']['par_couleur'] = True
    return res


def _iou_norm(m, ref256):
    n = normaliser_masque(m, 256)
    return float((n & ref256).sum() / max((n | ref256).sum(), 1))


def chercher_pose(V, F, masque_ref, hauts=AXES_HAUT, taille=256, pas_az=30, persp=None, garder=3):
    """POSE LIBRE : meilleur (haut, lacet, tangage) -- camera orthographique -- pour recouvrir `masque_ref` (IoU apres normalisation de boite).
    Pourquoi : une image de reference n'est pas toujours une vue de face du modele (vehicule en 3/4, insecte vu de dessus...). La silhouette de face
    stricte (lacet 0/180) mesure alors la pose, pas la forme ; la pose libre donne la MEILLEURE ressemblance possible (borne haute de la fidelite de forme).
    Methode : grille grossiere (`hauts` x lacets de `pas_az` degres, tangage 0), puis descente par coordonnees (lacet, tangage) a pas decroissants
    (15 -> 7,5 -> 3,8 degres) sur les `garder` meilleurs candidats. Rendus a `taille` px sur un sous-echantillon de triangles (~0,2 s chacun).
    Rend dict(haut, yaw, pitch, iou, nb_rendus)."""
    ref = normaliser_masque(masque_ref, 256)
    n = [0]
    F = _sous_echantillon(F, taille, 'auto')        # une seule fois (le tirage aleatoire d'un maillage de 10 M de faces coute 0,3 s)

    def score(h, az, pi):
        n[0] += 1
        m, _ = rendre_masque(V, F, taille, h, az, False, persp, pitch=pi, max_faces=None)
        return _iou_norm(m, ref) if m.any() else 0.0

    grille = []
    for h in hauts:
        h = _norm_haut(h)
        for az in np.arange(0, 360, pas_az):
            grille.append((score(h, float(az), 0.0), h, float(az), 0.0))
    grille.sort(key=lambda t: -t[0])
    finaux = []
    for sc, h, az, pi in grille[:garder]:
        pas = pas_az / 2
        best = (sc, az, pi)
        while pas >= 3.0:
            ameliore = True
            while ameliore:
                ameliore = False
                for daz, dpi in ((pas, 0), (-pas, 0), (0, pas), (0, -pas)):
                    a2, p2 = best[1] + daz, max(-80.0, min(80.0, best[2] + dpi))
                    v = score(h, a2, p2)
                    if v > best[0] + 1e-4:
                        best, ameliore = (v, a2, p2), True
            pas /= 2
        finaux.append((best[0], h, best[1] % 360, best[2]))
    finaux.sort(key=lambda t: -t[0])
    sc, h, az, pi = finaux[0]
    return {'haut': h, 'yaw': float(az), 'pitch': float(pi), 'iou': float(sc), 'nb_rendus': n[0], 'grille_meilleur': float(grille[0][0])}


def _score_couleur(V, F, couleurs_faces, masque_ref, image_ref_rgb, haut, yaw, persp, S=160):
    """Correlation des couleurs (a basse resolution) entre le rendu colore du modele et la reference, dans l'intersection des masques normalises.
    Le rendu colore peut avoir des trous (sous-echantillon des triangles d'un gros maillage) : on normalise par la validite (convolution normalisee)."""
    r = rendre_relief(V, F, 512, haut, yaw, False, persp, couleurs=couleurs_faces)
    valide = cv2.morphologyEx(r['masque'].astype(np.uint8), cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8)) > 0
    a = _normaliser_image(r['couleur'].astype(np.float32), valide, S)
    w = _normaliser_image(r['masque'].astype(np.float32), valide, S)
    a = cv2.GaussianBlur(a, (0, 0), 2) / np.maximum(cv2.GaussianBlur(w, (0, 0), 2)[..., None], 1e-3)
    b = _normaliser_image(image_ref_rgb.astype(np.float32), masque_ref, S)
    inter = normaliser_masque(valide, S) & normaliser_masque(masque_ref, S)
    if inter.sum() < 50:
        return -1.0
    x = a[inter].reshape(-1)
    y = cv2.GaussianBlur(b, (0, 0), 2)[inter].reshape(-1)
    x, y = x - x.mean(), y - y.mean()
    return float((x * y).sum() / (np.sqrt((x * x).sum() * (y * y).sum()) + 1e-9))


def _normaliser_image(img, m, S):
    ys, xs = np.where(m)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    e = S * 0.9 / max(x1 - x0, y1 - y0)
    M = np.array([[e, 0, S / 2 - e * (x0 + x1) / 2], [0, e, S / 2 - e * (y0 + y1) / 2]], np.float32)
    return cv2.warpAffine(img, M, (S, S), flags=cv2.INTER_AREA if e < 1 else cv2.INTER_LINEAR)


# ---------------------------------------------------------------- ligne de commande
def main(argv=None):
    ap = argparse.ArgumentParser(description="Rend la silhouette (et option : relief) d'un GLB sans OpenGL.")
    ap.add_argument('glb')
    ap.add_argument('--sortie', default=None, help="PNG de la silhouette (defaut : <glb>_sil.png dans C:/tmp/fidelite/)")
    ap.add_argument('--haut', default='+y', help='axe du haut du modele : ' + ' '.join(AXES_HAUT))
    ap.add_argument('--yaw', type=int, default=0, choices=LACETS)
    ap.add_argument('--miroir', action='store_true')
    ap.add_argument('--persp', type=float, default=None, help='perspective : distance camera en rayons de boite (ex. 3) ; absent = orthographique')
    ap.add_argument('--taille', type=int, default=1024)
    ap.add_argument('--relief', action='store_true', help="ecrit aussi ombrage + couleur (peintre, quelques secondes)")
    a = ap.parse_args(argv)
    V, F, C = charger_glb(a.glb, couleurs=True)
    base = a.sortie or os.path.join('C:/tmp/fidelite', os.path.splitext(os.path.basename(a.glb))[0])
    os.makedirs(os.path.dirname(os.path.abspath(base)), exist_ok=True)
    m, info = rendre_masque(V, F, a.taille, a.haut, a.yaw, a.miroir, a.persp)
    cv2.imwrite(base + '_sil.png', m.astype(np.uint8) * 255)
    print('silhouette :', base + '_sil.png', '| faces', len(F), '| boite px', info['boite_px'], '| surface %.1f %%' % (100 * m.mean()))
    if a.relief:
        r = rendre_relief(V, F, min(a.taille, 768), a.haut, a.yaw, a.miroir, a.persp, couleurs=C)
        cv2.imwrite(base + '_ombrage.png', r['ombrage'])
        cv2.imwrite(base + '_couleur.png', cv2.cvtColor(r['couleur'], cv2.COLOR_RGB2BGR))
        print('relief :', base + '_ombrage.png', base + '_couleur.png')
    return 0


if __name__ == '__main__':
    sys.exit(main())
