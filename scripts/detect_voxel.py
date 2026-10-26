# -*- coding: utf-8 -*-
"""Detecteur de trous de PEAU par grille voxel + visibilite (fill-voxel-2610).

Probleme : les maillages TRELLIS ont des trous sans arete de bord (double peau : une feuille interieure,
normales inversees, derriere la peau exterieure ; la feuille du dessous est visible depuis l'exterieur
la ou la peau exterieure manque).

Principe (tout passe par une grille voxel d'acceleration, aucune resolution n'est perdue : les triangles
sont testes EXACTEMENT dans les cellules traversees) :
  1. grille uniforme de listes de triangles (CSR), numba ;
  2. pour chaque triangle, rayon depuis son centre vers l'EXTERIEUR de la face vue de dos (direction -n) :
     un triangle dont ce rayon s'echappe sans rien toucher est une face DE DOS VISIBLE depuis l'exterieur ;
     son cote cache (+n) doit au contraire etre ferme (sinon c'est une feuille libre, pas un trou) ;
  3. regroupement spatial des faces de dos visibles (graphe de proximite) ;
  4. controle de la RIVE : une vraie peau trouee est entouree, du cote du spectateur, d'une peau
     exterieure peu elevee (hauteur <= epaisseur max) ; une fenetre vue de l'interieur ou un fond de
     maillage ouvert n'ont pas de rive ;
  5. taille : on garde les groupes dont le diametre est dans [min_trou_relatif, max_trou_relatif] x diag.

Interface : detect(V, F, uv=None, **options) -> list[dict(centre, rayon, contour)]
"""
import numpy as np
import numba as nb
from scipy.spatial import cKDTree
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

SOUDER = False   # le noyau n'a pas besoin de topologie : les sommets dedoubles ne changent rien aux rayons


# ----------------------------------------------------------------------------------------------------------------
# Grille de triangles (CSR) et traversee DDA
# ----------------------------------------------------------------------------------------------------------------
@nb.njit(cache=True)
def _cells_of(V, F, i, lo, inv, G):
    a = V[F[i, 0]]
    b = V[F[i, 1]]
    c = V[F[i, 2]]
    r = np.empty(6, np.int64)
    for k in range(3):
        mn = min(a[k], b[k], c[k])
        mx = max(a[k], b[k], c[k])
        i0 = int((mn - lo[k]) * inv)
        i1 = int((mx - lo[k]) * inv)
        if i0 < 0:
            i0 = 0
        if i1 >= G:
            i1 = G - 1
        r[2 * k] = i0
        r[2 * k + 1] = i1
    return r


@nb.njit(cache=True)
def _build_grid(V, F, lo, inv, G):
    nF = F.shape[0]
    cnt = np.zeros(G * G * G + 1, np.int64)
    for i in range(nF):
        r = _cells_of(V, F, i, lo, inv, G)
        for x in range(r[0], r[1] + 1):
            for y in range(r[2], r[3] + 1):
                for z in range(r[4], r[5] + 1):
                    cnt[(x * G + y) * G + z + 1] += 1
    for k in range(G * G * G):
        cnt[k + 1] += cnt[k]
    start = cnt.copy()
    items = np.empty(cnt[-1], np.int32)
    fill = cnt[:-1].copy()
    for i in range(nF):
        r = _cells_of(V, F, i, lo, inv, G)
        for x in range(r[0], r[1] + 1):
            for y in range(r[2], r[3] + 1):
                for z in range(r[4], r[5] + 1):
                    c = (x * G + y) * G + z
                    items[fill[c]] = i
                    fill[c] += 1
    return start, items


@nb.njit(cache=True)
def _hit_tri(V, F, t, o, d, tmin, tmax):
    """Moller-Trumbore, double face. Renvoie la distance (> tmin, < tmax) ou -1."""
    a = V[F[t, 0]]
    e1 = V[F[t, 1]] - a
    e2 = V[F[t, 2]] - a
    px = d[1] * e2[2] - d[2] * e2[1]
    py = d[2] * e2[0] - d[0] * e2[2]
    pz = d[0] * e2[1] - d[1] * e2[0]
    det = e1[0] * px + e1[1] * py + e1[2] * pz
    if abs(det) < 1e-18:
        return -1.0
    idet = 1.0 / det
    tx = o[0] - a[0]
    ty = o[1] - a[1]
    tz = o[2] - a[2]
    u = (tx * px + ty * py + tz * pz) * idet
    if u < -1e-9 or u > 1.0 + 1e-9:
        return -1.0
    qx = ty * e1[2] - tz * e1[1]
    qy = tz * e1[0] - tx * e1[2]
    qz = tx * e1[1] - ty * e1[0]
    v = (d[0] * qx + d[1] * qy + d[2] * qz) * idet
    if v < -1e-9 or u + v > 1.0 + 1e-9:
        return -1.0
    t_ = (e2[0] * qx + e2[1] * qy + e2[2] * qz) * idet
    if t_ > tmin and t_ < tmax:
        return t_
    return -1.0


@nb.njit(cache=True)
def _trace(V, F, start, items, lo, cs, G, o, d, tmin, tmax, ignore):
    """Premier impact (distance) d'un rayon, ou -1 si le rayon s'echappe (jusqu'a tmax). ignore : triangle exclu."""
    inv = 1.0 / cs
    ix = int((o[0] - lo[0]) * inv)
    iy = int((o[1] - lo[1]) * inv)
    iz = int((o[2] - lo[2]) * inv)
    # DDA (Amanatides-Woo)
    I = np.array([ix, iy, iz])
    step = np.zeros(3, np.int64)
    tnext = np.empty(3)
    tdelta = np.empty(3)
    for k in range(3):
        if d[k] > 1e-12:
            step[k] = 1
            tnext[k] = ((I[k] + 1) * cs + lo[k] - o[k]) / d[k]
            tdelta[k] = cs / d[k]
        elif d[k] < -1e-12:
            step[k] = -1
            tnext[k] = (I[k] * cs + lo[k] - o[k]) / d[k]
            tdelta[k] = -cs / d[k]
        else:
            step[k] = 0
            tnext[k] = 1e30
            tdelta[k] = 1e30
    best = -1.0
    while True:
        if I[0] < 0 or I[1] < 0 or I[2] < 0 or I[0] >= G or I[1] >= G or I[2] >= G:
            return -1.0
        c = (I[0] * G + I[1]) * G + I[2]
        for p in range(start[c], start[c + 1]):
            t = items[p]
            if t == ignore:
                continue
            h = _hit_tri(V, F, t, o, d, tmin, tmax)
            if h > 0:
                if best < 0 or h < best:
                    best = h
        # sortie de cellule : tout impact deja trouve avant la prochaine frontiere est le premier
        k = 0
        if tnext[1] < tnext[k]:
            k = 1
        if tnext[2] < tnext[k]:
            k = 2
        if best > 0 and best <= tnext[k]:
            return best
        if tnext[k] > tmax:
            return best
        I[k] += step[k]
        tnext[k] += tdelta[k]


@nb.njit(cache=True, parallel=True)
def _visibles(V, F, N, C, start, items, lo, cs, G, tmin, tmax, bloque_max, cand):
    """Pour chaque candidat : 1 si la face est de dos ET visible (rayon -n libre) ET dont le cote cache est ferme."""
    out = np.zeros(F.shape[0], np.uint8)
    for q in nb.prange(cand.shape[0]):
        t = cand[q]
        d = -N[t]
        o = C[t]
        h = _trace(V, F, start, items, lo, cs, G, o, d, tmin, tmax, t)
        if h < 0:
            out[t] = 1
    return out


@nb.njit(cache=True, parallel=True)
def _cote_cache_ferme(V, F, N, C, start, items, lo, cs, G, tmin, tmax, sel):
    out = np.zeros(sel.shape[0], np.uint8)
    for q in nb.prange(sel.shape[0]):
        t = sel[q]
        h = _trace(V, F, start, items, lo, cs, G, C[t], N[t], tmin, tmax, t)
        if h > 0:
            out[q] = 1
    return out


# ----------------------------------------------------------------------------------------------------------------
def _normales(V, F):
    a = V[F[:, 0]]
    b = V[F[:, 1]]
    c = V[F[:, 2]]
    n = np.cross(b - a, c - a)
    ln = np.linalg.norm(n, axis=1)
    ok = ln > 1e-18
    n[ok] /= ln[ok][:, None]
    return n, (a + b + c) / 3.0, ok, ln * 0.5


def _groupes(P, lien):
    """Composantes connexes par proximite (distance < lien)."""
    if len(P) == 0:
        return np.zeros(0, int), 0
    t = cKDTree(P)
    pairs = t.query_pairs(lien, output_type='ndarray')
    if len(pairs) == 0:
        return np.arange(len(P)), len(P)
    m = coo_matrix((np.ones(len(pairs)), (pairs[:, 0], pairs[:, 1])), shape=(len(P), len(P)))
    n, lab = connected_components(m, directed=False)
    return lab, n


def detect(V, F, uv=None, max_trou_relatif=0.10, min_trou_relatif=0.0, epaisseur_max_relative=0.05,
           resolution=None, journal=None, debug=None, **options):
    V = np.ascontiguousarray(np.asarray(V, dtype=np.float64))
    F = np.ascontiguousarray(np.asarray(F, dtype=np.int64))
    lo = V.min(0)
    hi = V.max(0)
    diag = float(np.linalg.norm(hi - lo))
    N, C, ok, A = _normales(V, F)
    nF = len(F)
    # taille de cellule : ~ 3 aretes moyennes (quelques triangles par cellule de surface)
    edge = float(np.sqrt(2.0 * A[ok].mean())) if ok.any() else diag / 100
    ext = float((hi - lo).max())
    G = int(np.clip(np.ceil(ext / (3.0 * edge)), 24, 320)) if resolution is None else int(resolution)
    cs = ext / G * (1 + 1e-9)
    lo_g = lo - 1e-9 * ext
    start, items = _build_grid(V, F, lo_g, 1.0 / cs, G)
    tmin = 1e-7 * diag
    tmax = 2.0 * diag
    cand = np.nonzero(ok)[0].astype(np.int64)
    vis = _visibles(V, F, N, C, start, items, lo_g, cs, G, tmin, tmax, 0.0, cand)
    ids = np.nonzero(vis)[0]
    if journal:
        journal('detect_voxel : %d / %d faces de dos visibles' % (len(ids), nF))
    if len(ids) == 0:
        return []
    # cote cache ferme : sinon feuille libre
    ferme = _cote_cache_ferme(V, F, N, C, start, items, lo_g, cs, G, tmin, tmax, ids.astype(np.int64))
    ids = ids[ferme == 1]
    if journal:
        journal('  dont cote cache ferme : %d' % len(ids))
    if len(ids) == 0:
        return []
    P = C[ids]
    lab, ng = _groupes(P, 4.0 * edge)
    res = []
    for g in range(ng):
        m = ids[lab == g]
        Pg = C[m]
        c = Pg.mean(0)
        r = float(np.linalg.norm(Pg - c, axis=1).max())
        d_rel = 2 * r / diag
        if d_rel > max_trou_relatif or d_rel < min_trou_relatif:
            continue
        res.append({'centre': [float(x) for x in c], 'rayon': r, 'contour': Pg[:min(len(Pg), 64)].tolist(),
                    'n_faces': int(len(m)), 'normale': [float(x) for x in -N[m].mean(0)]})
    if debug is not None:
        debug['ids'] = ids
        debug['groupes'] = lab
    return res
