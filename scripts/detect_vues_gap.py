# -*- coding: utf-8 -*-
"""Source « ecart entre couches » de detect_vues : sur un objet a DOUBLE PEAU, l'ecart z2 - z1 (peau exterieure -> peau interieure) est petit
partout ; un trou de la peau exterieure est un ilot ou l'ecart est GRAND (on voit la peau interieure, puis le vide). Ne depend pas de l'epaisseur."""
import math
import numpy as np
from scipy import ndimage as ndi

import bouchage_peau as bp
import peel_vues


def vue(V, F, N, d, R, c, diag, amax_rel):
    fid, z1, z2, (a, b, dd, cc, s) = peel_vues.peel(V, F, d, R, c, diag)
    h = fid >= 0
    if h.sum() < 100:
        return []
    face = np.zeros(h.shape, bool)
    cosv = np.zeros(h.shape)
    cosv[h] = np.abs(N[fid[h]] @ dd)
    face = cosv > 0.4
    proche = h & ~ndi.binary_erosion(h, iterations=3)
    G = (z2 - z1) / diag
    G[~np.isfinite(G)] = 1.0
    G = np.minimum(G, 1.0) * cosv        # ecart PERPENDICULAIRE a la peau : l'epaisseur de la double peau, quelle que soit l'inclinaison
    ok = h & face & ~proche
    if ok.sum() < 100:
        return []
    med = float(np.median(G[ok]))
    if med > 0.03:
        return []                                  # pas une double peau dans cette vue
    seuil = max(6.0 * med, 0.008)
    big = ok & (G > seuil)
    big = ndi.binary_closing(ndi.binary_opening(big, iterations=1), iterations=1)
    lab, n = ndi.label(big)
    out = []
    if n == 0:
        return out
    aire = np.bincount(lab.ravel())
    objs = ndi.find_objects(lab)
    amax = int(amax_rel * R * R)
    for k in range(1, n + 1):
        if aire[k] < 10 or aire[k] > amax:
            continue
        sl = objs[k - 1]
        y0, y1 = max(sl[0].start - 8, 0), min(sl[0].stop + 8, R)
        x0, x1 = max(sl[1].start - 8, 0), min(sl[1].stop + 8, R)
        reg = lab[y0:y1, x0:x1] == k
        ring = ndi.binary_dilation(reg, iterations=5) & ~ndi.binary_dilation(reg, iterations=2)
        if not ring.any():
            continue
        norm = (ok & (G <= 3 * med + 0.004))[y0:y1, x0:x1]
        if float(norm[ring].mean()) < 0.8:
            continue
        ys, xs = np.nonzero(reg)
        cy, cx = ys.mean() + y0, xs.mean() + x0
        zr = z1[y0:y1, x0:x1][ring & h[y0:y1, x0:x1]]
        zc = float(np.median(zr))
        ctr = cc + ((cx + 0.5 - R / 2.0) * a + (cy + 0.5 - R / 2.0) * b) / s + zc * dd
        r = max(math.sqrt(aire[k] / math.pi), 0.5 * math.hypot(np.ptp(ys) + 1.0, np.ptp(xs) + 1.0)) / s
        frontal = float(np.mean(np.abs(N[fid[y0:y1, x0:x1][ring & h[y0:y1, x0:x1]]] @ dd)))
        if frontal < 0.6:
            continue                                # vue trop oblique : le bord du trou cache une partie de l'ilot, le centre est decale
        pts = _contour3d(reg, y0, x0, z1, h, a, b, dd, cc, s, R)
        out.append({'c': ctr, 'r': r, 'aire': aire[k] * frontal, 'contour': pts})
    return out


def _contour3d(reg, y0, x0, z1, h, a, b, dd, cc, s, R):
    pts = bp.contour(ndi.binary_fill_holes(reg))
    if len(pts) < 3:
        return []
    step = max(1, len(pts) // 64)
    res = []
    for (y, x) in pts[::step]:
        yy, xx = y + y0, x + x0
        zz = z1[yy, xx]
        if not np.isfinite(zz):
            continue
        res.append((cc + ((xx + 0.5 - R / 2.0) * a + (yy + 0.5 - R / 2.0) * b) / s + zz * dd).tolist())
    return res


def candidats(V, F, nb_vues, R, pool, amax_rel):
    P = V[F]
    N = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0])
    N /= np.maximum(np.linalg.norm(N, axis=1), 1e-30)[:, None]
    lo, hi = V.min(0), V.max(0)
    diag = float(np.linalg.norm(hi - lo))
    c = (lo + hi) / 2.0
    dirs = bp.directions_fibonacci(nb_vues)
    res = list(pool.map(lambda d: vue(V, F, N, d, R, c, diag, amax_rel), dirs))
    cands = [h for l in res for h in l]
    cands.sort(key=lambda h: -h['aire'])
    groupes = []
    for h in cands:
        for g in groupes:
            if np.linalg.norm(h['c'] - g['c']) < 1.0 * max(h['r'], g['r']):
                break
        else:
            groupes.append(h)
    return groupes
