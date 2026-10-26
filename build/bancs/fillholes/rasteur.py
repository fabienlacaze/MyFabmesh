# -*- coding: utf-8 -*-
"""Rasteriseur a tampon de profondeur + tampon d'identifiants, en numpy pur (20/10/2026).

But : savoir, pour une direction de vue, quelle face est touchee EN PREMIER par chaque pixel, et si elle est vue par devant
ou par DERRIERE (face dont la normale d'enroulement s'eloigne de la camera). C'est la definition visuelle d'un manque de
matiere : on voit l'interieur du maillage. Camera orthographique (les maillages sont normalises, la perspective n'apporte rien
a la mesure). Echantillonnage au centre du pixel, regle d'inclusion large (les aretes partagees ecrivent des deux cotes ;
le minimum de profondeur tranche).

Deux tampons separes, un pour les faces vues par devant (zF, idF), un pour les faces vues par derriere (zB, idB) : on en
tire a la fois le premier impact (le plus proche des deux), les pixels « a l'avant ET a l'arriere a la meme profondeur »
(deux nappes confondues = double peau) et ce qu'un visualiseur a faces simples (culling) montrerait (zF seul).
"""
import numpy as np

_CAPS = (1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384, 512)


def base_vue(d):
    """Repere orthonormal (u, v, w) avec w = direction de visee (la camera regarde vers +w)."""
    w = np.asarray(d, np.float64)
    w = w / np.linalg.norm(w)
    ref = np.array([0.0, 1.0, 0.0]) if abs(w[1]) < 0.9 else np.array([1.0, 0.0, 0.0])
    u = np.cross(ref, w)
    u /= np.linalg.norm(u)
    v = np.cross(w, u)
    return u, v, w


class Camera:
    def __init__(self, centre, rayon, d, S, marge=1.04):
        self.u, self.v, self.w = base_vue(d)
        self.c = np.asarray(centre, np.float64)
        self.R = float(rayon) * marge
        self.S = int(S)
        self.d = self.w

    def projeter(self, P):
        """P (n,3) -> (px, py, z) : px/py en pixels (origine en haut a gauche), z = distance le long de la visee."""
        Q = np.asarray(P, np.float64) - self.c
        x = Q @ self.u
        y = Q @ self.v
        z = Q @ self.w
        s = self.S / (2.0 * self.R)
        return x * s + self.S / 2.0, self.S / 2.0 - y * s, z


def rasteriser_triangles(X, Y, Z, ids, S, zbuf=None, idbuf=None, max_echant=2_000_000):
    """X, Y, Z : (n,3) en pixels / profondeur ; ids : (n,) identifiant ecrit dans idbuf.
    Rend (zbuf (S*S) float32, idbuf (S*S) int32) ; creees si absentes (permet de cumuler plusieurs appels)."""
    if zbuf is None:
        zbuf = np.full(S * S, np.inf, np.float32)
        idbuf = np.full(S * S, -1, np.int32)
    n = len(X)
    if n == 0:
        return zbuf, idbuf
    xmin, xmax = X.min(1), X.max(1)
    ymin, ymax = Y.min(1), Y.max(1)
    i0 = np.maximum(np.ceil(xmin - 0.5), 0).astype(np.int64)
    i1 = np.minimum(np.floor(xmax - 0.5), S - 1).astype(np.int64)
    j0 = np.maximum(np.ceil(ymin - 0.5), 0).astype(np.int64)
    j1 = np.minimum(np.floor(ymax - 0.5), S - 1).astype(np.int64)
    w = i1 - i0 + 1
    h = j1 - j0 + 1
    aire2 = (Y[:, 1] - Y[:, 2]) * (X[:, 0] - X[:, 2]) + (X[:, 2] - X[:, 1]) * (Y[:, 0] - Y[:, 2])
    ok = (w > 0) & (h > 0) & (np.abs(aire2) > 1e-12)
    idx = np.nonzero(ok)[0]
    if len(idx) == 0:
        return zbuf, idbuf
    # grands triangles (boite > 64 x 64, ex. eventails de comblement : fines lamelles aussi longues que l'objet) : balayage par
    # lignes, cout ~ hauteur + pixels couverts, au lieu de boite^2 echantillons
    grand = (w[idx] * h[idx] > SEUIL_GRAND)
    for a in range(0, int(grand.sum()), 20000):
        _spans(X, Y, Z, ids, aire2, j0, h, idx[grand][a:a + 20000], S, zbuf, idbuf)
    idx = idx[~grand]
    if len(idx) == 0:
        return zbuf, idbuf
    m = np.maximum(w[idx], h[idx])
    prec = 0
    for cap in _CAPS + (10 ** 9,):
        sel = idx[(m > prec) & (m <= cap)]
        prec = cap
        if len(sel) == 0:
            continue
        K = min(cap, S)
        pas = max(1, max_echant // (K * K))
        for a in range(0, len(sel), pas):
            _chunk(X, Y, Z, ids, aire2, i0, j0, w, h, sel[a:a + pas], K, S, zbuf, idbuf)
    return zbuf, idbuf


SEUIL_GRAND = 4096          # surface de la boite englobante (pixels) au-dela de laquelle on balaie par lignes


def _spans(X, Y, Z, ids, aire2, j0, h, sel, S, zbuf, idbuf, max_lignes=1_500_000):
    """Rasterisation par BALAYAGE de lignes des triangles `sel` : pour chaque ligne de pixels, intervalle [xg, xd] coupe par
    les trois aretes au centre de la ligne, puis profondeur par coordonnees barycentriques. Meme regle d'inclusion que _chunk
    (centre de pixel dans le triangle, bords inclus)."""
    if len(sel) == 0:
        return
    hh = h[sel]
    debut = 0
    n = len(sel)
    while debut < n:
        cum = np.cumsum(hh[debut:])
        fin = debut + max(1, int(np.searchsorted(cum, max_lignes, side='right')))
        part = sel[debut:fin]
        _spans_bloc(X, Y, Z, ids, aire2, j0, h, part, S, zbuf, idbuf)
        debut = fin


def _spans_bloc(X, Y, Z, ids, aire2, j0, h, sel, S, zbuf, idbuf):
    nl = h[sel]
    tot = int(nl.sum())
    if tot == 0:
        return
    tri = np.repeat(np.arange(len(sel)), nl)
    dec = np.cumsum(nl) - nl
    ligne = j0[sel][tri] + (np.arange(tot) - np.repeat(dec, nl))
    yc = ligne + 0.5
    xg = np.full(tot, np.inf)
    xd = np.full(tot, -np.inf)
    for (p, q) in ((0, 1), (1, 2), (2, 0)):
        ya, yb = Y[sel, p][tri], Y[sel, q][tri]
        xa, xb = X[sel, p][tri], X[sel, q][tri]
        m = (yc >= np.minimum(ya, yb)) & (yc <= np.maximum(ya, yb)) & (ya != yb)
        t = np.divide(yc - ya, yb - ya, out=np.zeros(tot), where=m)
        xx = xa + t * (xb - xa)
        xg = np.where(m, np.minimum(xg, xx), xg)
        xd = np.where(m, np.maximum(xd, xx), xd)
    vu = np.isfinite(xg) & np.isfinite(xd)
    il = np.where(vu, np.maximum(np.ceil(np.where(vu, xg, 0) - 0.5), 0), 0).astype(np.int64)
    ir = np.where(vu, np.minimum(np.floor(np.where(vu, xd, 0) - 0.5), S - 1), -1).astype(np.int64)
    L = np.maximum(ir - il + 1, 0)
    tp = int(L.sum())
    if tp == 0:
        return
    ptri = np.repeat(tri, L)
    pl = np.repeat(ligne, L)
    decp = np.cumsum(L) - L
    pi = np.repeat(il, L) + (np.arange(tp) - np.repeat(decp, L))
    t = sel[ptri]
    px = pi + 0.5
    py = pl + 0.5
    x0, x1, x2 = X[t, 0], X[t, 1], X[t, 2]
    y0, y1, y2 = Y[t, 0], Y[t, 1], Y[t, 2]
    d = aire2[t]
    l0 = ((y1 - y2) * (px - x2) + (x2 - x1) * (py - y2)) / d
    l1 = ((y2 - y0) * (px - x2) + (x0 - x2) * (py - y2)) / d
    l2 = 1.0 - l0 - l1
    z = (l0 * Z[t, 0] + l1 * Z[t, 1] + l2 * Z[t, 2]).astype(np.float32)
    p = pl * S + pi
    np.minimum.at(zbuf, p, z)
    garde = z <= zbuf[p]
    idbuf[p[garde]] = ids[t[garde]]


def _chunk(X, Y, Z, ids, aire2, i0, j0, w, h, sel, K, S, zbuf, idbuf):
    di = np.arange(K)
    ii = i0[sel][:, None, None] + di[None, :, None]
    jj = j0[sel][:, None, None] + di[None, None, :]
    valide = (di[None, :, None] < w[sel][:, None, None]) & (di[None, None, :] < h[sel][:, None, None])
    ti = np.broadcast_to(np.arange(len(sel))[:, None, None], valide.shape)[valide]
    ii = np.broadcast_to(ii, valide.shape)[valide]
    jj = np.broadcast_to(jj, valide.shape)[valide]
    t = sel[ti]
    px = ii + 0.5
    py = jj + 0.5
    x0, x1, x2 = X[t, 0], X[t, 1], X[t, 2]
    y0, y1, y2 = Y[t, 0], Y[t, 1], Y[t, 2]
    d = aire2[t]
    l0 = ((y1 - y2) * (px - x2) + (x2 - x1) * (py - y2)) / d
    l1 = ((y2 - y0) * (px - x2) + (x0 - x2) * (py - y2)) / d
    l2 = 1.0 - l0 - l1
    e = -1e-9
    dedans = (l0 >= e) & (l1 >= e) & (l2 >= e)
    if not dedans.any():
        return
    l0, l1, l2, t = l0[dedans], l1[dedans], l2[dedans], t[dedans]
    z = (l0 * Z[t, 0] + l1 * Z[t, 1] + l2 * Z[t, 2]).astype(np.float32)
    p = jj[dedans] * S + ii[dedans]
    np.minimum.at(zbuf, p, z)
    garde = z <= zbuf[p]
    idbuf[p[garde]] = ids[t[garde]]


def rasteriser_segments(X, Y, Z, etiq, S, zref, eps, pas_min=1.0):
    """Trace des segments (X, Y, Z : (n,2)) ; ne garde que les echantillons dont la profondeur est <= zref[pixel] + eps
    (segment visible : il n'est pas cache derriere une surface). Rend un tampon d'etiquettes (S*S) int32, -1 = vide."""
    out = np.full(S * S, -1, np.int32)
    if len(X) == 0:
        return out
    L = np.maximum(np.abs(X[:, 1] - X[:, 0]), np.abs(Y[:, 1] - Y[:, 0]))
    cnt = np.maximum(np.ceil(L / pas_min).astype(np.int64) + 1, 2)
    tot = int(cnt.sum())
    seg = np.repeat(np.arange(len(X)), cnt)
    debut = np.cumsum(cnt) - cnt
    k = np.arange(tot) - np.repeat(debut, cnt)
    t = k / (np.repeat(cnt, cnt) - 1.0)
    x = X[seg, 0] + t * (X[seg, 1] - X[seg, 0])
    y = Y[seg, 0] + t * (Y[seg, 1] - Y[seg, 0])
    z = Z[seg, 0] + t * (Z[seg, 1] - Z[seg, 0])
    i = np.floor(x).astype(np.int64)
    j = np.floor(y).astype(np.int64)
    dans = (i >= 0) & (i < S) & (j >= 0) & (j < S)
    i, j, z, seg = i[dans], j[dans], z[dans], seg[dans]
    p = j * S + i
    vis = z <= zref[p] + eps
    out[p[vis]] = etiq[seg[vis]]
    return out


def directions_26():
    """Les 26 directions du cube 3x3x3 (6 faces, 12 aretes, 8 coins), normalisees."""
    out = []
    for a in (-1, 0, 1):
        for b in (-1, 0, 1):
            for c in (-1, 0, 1):
                if a == b == c == 0:
                    continue
                v = np.array([a, b, c], float)
                out.append(v / np.linalg.norm(v))
    return np.array(out)


def directions_icosphere(sub=1):
    """Directions des sommets d'une icosphere (sub=1 : 42 ; sub=2 : 162). Inclut un sur-ensemble des 26 usuelles par
    la couverture, pas les memes axes : utile en complement des 26 pour verifier qu'une zone n'echappe pas au maillage
    de directions."""
    t = (1.0 + 5 ** 0.5) / 2.0
    V = np.array([[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
                  [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]], float)
    F = np.array([[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2],
                  [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11],
                  [6, 2, 10], [8, 6, 7], [9, 8, 1]])
    V = V / np.linalg.norm(V, axis=1, keepdims=True)
    for _ in range(sub):
        cache = {}
        nv = list(V)
        nf = []

        def milieu(a, b):
            k = (min(a, b), max(a, b))
            if k not in cache:
                m = nv[a] + nv[b]
                nv.append(m / np.linalg.norm(m))
                cache[k] = len(nv) - 1
            return cache[k]

        for a, b, c in F:
            ab, bc, ca = milieu(a, b), milieu(b, c), milieu(c, a)
            nf += [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]]
        V = np.array(nv)
        F = np.array(nf)
    return V
