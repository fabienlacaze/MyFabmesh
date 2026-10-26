# -*- coding: utf-8 -*-
"""Detecteur de trous par NOMBRE D'ENROULEMENT GENERALISE (2026-10-26, branche fill-winding-2610).

PRINCIPE (Jacobson, Kavan, Sorkine-Hornung 2013). Pour une surface FERMEE, w(q) = somme des angles solides signes des triangles / 4 pi vaut un
ENTIER partout hors de la surface (0 dehors, 1 dedans, 2 si deux couches, -1 si orientation inversee...). Un TROU rend w FRACTIONNAIRE a son voisinage :
la lumiere « sort » par le trou, w passe continument de 1 a 0 en le traversant. Le detecteur echantillonne des points juste au-dessus et juste
au-dessous de la surface, calcule w EXACTEMENT (formule de Van Oosterom-Strackee) pour les triangles proches et par un DIPOLE pour les groupes
lointains (Barill et al. 2018 : arbre binaire sur l'ordre de Morton, critere beta = 3), puis regroupe les points fractionnaires en composantes
connexes : chaque composante est un trou.

LIMITE MESUREE (a dire a l'utilisateur). La methode ne voit QUE les trous qui laissent le maillage topologiquement OUVERT (peau simple percee,
peau exterieure d'une double peau percee). Sur les maillages TRELLIS reels du depot (bateau 497 616 faces, Pikachu, moissonneuse) w est ENTIER en
tout point echantillonne (0 point fractionnaire sur 400 000) : ces maillages sont des coques minces FERMEES (le pourtour des « trous de peau » est
replie), aucune methode d'enroulement ni de parite de rayons ne les distingue d'un creux. Voir AGENT_LOG 2026-10-26.

Dependances : numpy, scipy, numba.
"""
import math
import time

import numpy as np
from scipy.spatial import cKDTree

try:
    import numba as _nb
    from numba import njit, prange
    _AVEC_NUMBA = True
except Exception:                                  # pragma: no cover - repli lent, meme resultat
    _AVEC_NUMBA = False

    def njit(*a, **k):
        if a and callable(a[0]):
            return a[0]
        return lambda f: f
    prange = range

SOUDER = True
VERSION = 1

# Reglages -----------------------------------------------------------------------------------------------------------------------------------
FEUILLE = 8                    # triangles par feuille de l'arbre
BETA = 3.0                     # un groupe est remplace par son dipole quand distance > BETA x rayon
PAS_REL = 0.003                # une graine par cellule de PAS_REL x diagonale (echantillonnage uniforme de la surface)
DECALAGES_REL = (0.0025, 0.008)    # decalages (fraction de la diagonale) des points au-dessus / au-dessous de la surface
SEUIL_FRAC = 0.2               # un point est « fractionnaire » si |w - arrondi(w)| depasse ce seuil
MIN_POINTS = 4                 # un trou compte au moins ce nombre de points fractionnaires (anti-bruit)
MAX_TROU_REL = 0.10            # diametre maximal (fraction de la diagonale) d'un trou a boucher ; au-dela : ouverture voulue
MIN_TROU_REL = 0.0             # diametre minimal
LIEN_REL = 2.5                 # deux points fractionnaires a moins de LIEN_REL x pas sont de la meme composante
POINTS_MAX = 600_000


# ---------------------------------------------------------------------------------------------------------------------------------------
# Angle solide, arbre de dipoles
# ---------------------------------------------------------------------------------------------------------------------------------------
@njit
def _solide(a0, a1, a2, b0, b1, b2, c0, c1, c2):
    la = math.sqrt(a0 * a0 + a1 * a1 + a2 * a2)
    lb = math.sqrt(b0 * b0 + b1 * b1 + b2 * b2)
    lc = math.sqrt(c0 * c0 + c1 * c1 + c2 * c2)
    det = a0 * (b1 * c2 - b2 * c1) - a1 * (b0 * c2 - b2 * c0) + a2 * (b0 * c1 - b1 * c0)
    den = la * lb * lc + (a0 * b0 + a1 * b1 + a2 * b2) * lc + (b0 * c0 + b1 * c1 + b2 * c2) * la + (c0 * a0 + c1 * a1 + c2 * a2) * lb
    return 2.0 * math.atan2(det, den)


def _ecarter(x):
    x = (x | (x << np.uint64(16))) & np.uint64(0x030000FF)
    x = (x | (x << np.uint64(8))) & np.uint64(0x0300F00F)
    x = (x | (x << np.uint64(4))) & np.uint64(0x030C30C3)
    x = (x | (x << np.uint64(2))) & np.uint64(0x09249249)
    return x


@njit
def _remplir(T, LS, P, NN, C, R, A):
    n = T.shape[0]
    for i in range(P):
        lo = i * LS
        hi = min(lo + LS, n)
        if lo >= n:
            continue
        at = 0.0
        c = np.zeros(3)
        nv = np.zeros(3)
        for k in range(lo, hi):
            u = T[k, 1] - T[k, 0]
            v = T[k, 2] - T[k, 0]
            cr = np.cross(u, v) * 0.5
            a = math.sqrt(cr[0] ** 2 + cr[1] ** 2 + cr[2] ** 2)
            nv += cr
            at += a
            c += a * (T[k, 0] + T[k, 1] + T[k, 2]) / 3.0
        if at <= 0:
            c = T[lo, 0].copy()
            at = 1e-30
        else:
            c /= at
        r = 0.0
        for k in range(lo, hi):
            for j in range(3):
                dd = math.sqrt(((T[k, j] - c) ** 2).sum())
                if dd > r:
                    r = dd
        NN[P + i] = nv
        C[P + i] = c
        R[P + i] = r
        A[P + i] = at
    for i in range(P - 1, 0, -1):
        l = 2 * i
        rr = 2 * i + 1
        if R[l] < 0 and R[rr] < 0:
            continue
        if R[rr] < 0:
            NN[i] = NN[l]
            C[i] = C[l]
            R[i] = R[l]
            A[i] = A[l]
            continue
        if R[l] < 0:
            NN[i] = NN[rr]
            C[i] = C[rr]
            R[i] = R[rr]
            A[i] = A[rr]
            continue
        a = A[l] + A[rr]
        c = (A[l] * C[l] + A[rr] * C[rr]) / a
        NN[i] = NN[l] + NN[rr]
        C[i] = c
        A[i] = a
        R[i] = max(math.sqrt(((C[l] - c) ** 2).sum()) + R[l], math.sqrt(((C[rr] - c) ** 2).sum()) + R[rr])


def construire_arbre(V, F, feuille=FEUILLE):
    """Arbre binaire complet sur les triangles classes en ordre de Morton. Rend un dictionnaire a passer a enroulement()."""
    n = len(F)
    T = V[F]
    cen = T.mean(1)
    lo = cen.min(0)
    hi = cen.max(0)
    q = ((cen - lo) / np.maximum(hi - lo, 1e-30) * 1023).astype(np.uint64)
    code = _ecarter(q[:, 0]) | (_ecarter(q[:, 1]) << np.uint64(1)) | (_ecarter(q[:, 2]) << np.uint64(2))
    ordre = np.argsort(code, kind='stable')
    T = np.ascontiguousarray(T[ordre])
    nl = (n + feuille - 1) // feuille
    P = 1
    while P < nl:
        P *= 2
    NN = np.zeros((2 * P, 3))
    C = np.zeros((2 * P, 3))
    R = np.full(2 * P, -1.0)
    A = np.zeros(2 * P)
    _remplir(T, feuille, P, NN, C, R, A)
    return {'T': T, 'LS': feuille, 'P': P, 'NN': NN, 'C': C, 'R': R}


@njit(parallel=True)
def _enroulement(Q, T, LS, P, NN, C, R, beta):
    m = Q.shape[0]
    n = T.shape[0]
    out = np.zeros(m)
    for qi in prange(m):
        q0 = Q[qi, 0]
        q1 = Q[qi, 1]
        q2 = Q[qi, 2]
        pile = np.empty(64, np.int64)
        pile[0] = 1
        sp = 1
        w = 0.0
        while sp > 0:
            sp -= 1
            nd = pile[sp]
            if R[nd] < 0:
                continue
            d0 = C[nd, 0] - q0
            d1 = C[nd, 1] - q1
            d2 = C[nd, 2] - q2
            d2s = d0 * d0 + d1 * d1 + d2 * d2
            r = R[nd]
            if d2s > beta * beta * r * r:
                dd = math.sqrt(d2s)
                w += (NN[nd, 0] * d0 + NN[nd, 1] * d1 + NN[nd, 2] * d2) / (dd * d2s)
            elif nd >= P:
                lo = (nd - P) * LS
                hi = min(lo + LS, n)
                for k in range(lo, hi):
                    w += _solide(T[k, 0, 0] - q0, T[k, 0, 1] - q1, T[k, 0, 2] - q2, T[k, 1, 0] - q0, T[k, 1, 1] - q1, T[k, 1, 2] - q2,
                                 T[k, 2, 0] - q0, T[k, 2, 1] - q1, T[k, 2, 2] - q2)
            else:
                pile[sp] = 2 * nd
                pile[sp + 1] = 2 * nd + 1
                sp += 2
        out[qi] = w / (4.0 * math.pi)
    return out


def enroulement(Q, arbre, beta=BETA):
    """Nombre d'enroulement generalise aux points Q (m, 3)."""
    return _enroulement(np.ascontiguousarray(Q, dtype=np.float64), arbre['T'], arbre['LS'], arbre['P'], arbre['NN'], arbre['C'], arbre['R'],
                        float(beta))


# ---------------------------------------------------------------------------------------------------------------------------------------
# Detection
# ---------------------------------------------------------------------------------------------------------------------------------------
def _graines(V, F, diag, pas_rel, rng):
    """Une face par cellule de pas_rel x diag : (centres, normales unitaires), faces degenerees ecartees."""
    T = V[F]
    cr = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0])
    ln = np.linalg.norm(cr, axis=1)
    bon = ln > (1e-9 * diag) ** 2
    idx = np.nonzero(bon)[0]
    idx = idx[rng.permutation(len(idx))]
    cen = T[idx].mean(1)
    cle = np.floor(cen / (pas_rel * diag)).astype(np.int64)
    cle -= cle.min(0)
    m = cle.max(0) + 1
    plat = (cle[:, 0] * m[1] + cle[:, 1]) * m[2] + cle[:, 2]
    _, premier = np.unique(plat, return_index=True)
    sel = idx[premier]
    return cen[premier], cr[sel] / ln[sel, None]


def detect(V, F, uv=None, max_trou_relatif=MAX_TROU_REL, min_trou_relatif=MIN_TROU_REL, seuil=SEUIL_FRAC, pas_rel=PAS_REL,
           decalages_rel=DECALAGES_REL, min_points=MIN_POINTS, journal=None, debug=None, graine=0):
    """Trous d'un maillage par enroulement fractionnaire. Rend une liste de {centre, rayon, contour, n_points, fraction}.

    V (n, 3) sommets, F (m, 3) faces (idealement soudees par position), uv ignore. Un trou dont le DIAMETRE depasse max_trou_relatif x diagonale
    est une ouverture voulue : non rendu."""
    t0 = time.time()
    V = np.asarray(V, dtype=np.float64)
    F = np.asarray(F, dtype=np.int64)
    if len(F) == 0:
        return []
    lo, hi = V.min(0), V.max(0)
    diag = float(np.linalg.norm(hi - lo))
    rng = np.random.default_rng(graine)
    arbre = construire_arbre(V, F)
    cen, nrm = _graines(V, F, diag, pas_rel, rng)
    if len(cen) > POINTS_MAX // (2 * len(decalages_rel)):
        sel = rng.choice(len(cen), POINTS_MAX // (2 * len(decalages_rel)), replace=False)
        cen, nrm = cen[sel], nrm[sel]
    pts, ech = [], []
    for k, dr in enumerate(decalages_rel):
        Q = np.concatenate([cen + dr * diag * nrm, cen - dr * diag * nrm])
        w = enroulement(Q, arbre)
        frac = np.abs(w - np.round(w))
        mauvais = frac > seuil
        pts.append(Q[mauvais])
        ech.append(np.full(int(mauvais.sum()), k))
        if journal:
            journal('decalage %g : %d / %d points fractionnaires (%.1f s)' % (dr, int(mauvais.sum()), len(Q), time.time() - t0))
    P = np.concatenate(pts)
    E = np.concatenate(ech)
    if debug is not None:
        debug['points'] = P
    if len(P) < min_points:
        return []
    lien = LIEN_REL * pas_rel * diag + max(decalages_rel) * diag * 0.5
    arbre_kd = cKDTree(P)
    paires = arbre_kd.query_pairs(lien, output_type='ndarray')
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components
    g = coo_matrix((np.ones(len(paires)), (paires[:, 0], paires[:, 1])), shape=(len(P), len(P)))
    nc, lab = connected_components(g, directed=False)
    trous = []
    for c in range(nc):
        m = np.nonzero(lab == c)[0]
        if len(m) < min_points:
            continue
        X = P[m]
        centre = X.mean(0)
        # rayon : distance au centre qui contient 90 % des points du plus petit decalage (le plus fidele au trou), sinon de tous
        proche = X[E[m] == 0]
        ref = proche if len(proche) >= min_points else X
        d = np.linalg.norm(ref - centre, axis=1)
        rayon = float(np.percentile(d, 95))
        diam = 2.0 * rayon
        if diam > max_trou_relatif * diag or diam < min_trou_relatif * diag:
            continue
        trous.append({'centre': [float(x) for x in centre], 'rayon': rayon, 'contour': _contour(ref, centre, rayon), 'n_points': int(len(m))})
    trous.sort(key=lambda h: -h['n_points'])
    if journal:
        journal('%d trous (%.1f s)' % (len(trous), time.time() - t0))
    return trous


def _contour(X, centre, rayon, n=16):
    """Polygone de n points (plan principal des points fractionnaires, rayon le plus eloigne par secteur angulaire)."""
    if len(X) < 4:
        return []
    Y = X - centre
    u, s, vt = np.linalg.svd(Y, full_matrices=False)
    a, b = vt[0], vt[1]
    x, y = Y @ a, Y @ b
    ang = np.arctan2(y, x)
    rad = np.hypot(x, y)
    sect = ((ang + np.pi) / (2 * np.pi) * n).astype(int) % n
    out = []
    for k in range(n):
        m = sect == k
        r = float(rad[m].max()) if m.any() else rayon
        t = (k + 0.5) / n * 2 * np.pi - np.pi
        out.append([float(v) for v in centre + r * math.cos(t) * a + r * math.sin(t) * b])
    return out
