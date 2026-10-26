# -*- coding: utf-8 -*-
"""Trous de PEAU (2026-10-26) : une coque percee dont AUCUNE arete n'est ouverte.

POURQUOI. Un maillage TRELLIS n'est pas une surface fermee unique : c'est un empilement de feuilles quasi sans epaisseur (peau exterieure, peau
interieure, panneaux), collees par des aretes a 3 ou 4 faces. Mesure sur un bateau de 497 616 faces : 0 arete de bord apres soudure, 25 801 aretes
partagees par plus de deux faces, et pourtant une quinzaine de taches orange sous la coque : la peau exterieure s'interrompt, on voit la feuille du
dessous (son pourtour est REPLIE sur elle-meme, jamais ouvert : le detecteur d'aretes de bord ne voit rien). Les pourtours de ces trous ne sont meme
pas des boucles d'aretes (les panneaux voisins ne se touchent pas) : aucune methode TOPOLOGIQUE ne les trouve (essayees et mesurees : separation des
feuilles aux plis, aretes non manifold, fermeture volumetrique).

METHODE (geometrique, par la VUE). Un trou de peau, c'est un endroit ou, vu de l'exterieur, la surface qui s'etend autour d'une tache n'y passe pas :
la tache montre une surface BEAUCOUP plus profonde, entierement entouree par une surface plus proche. On le mesure sur des cartes de profondeur :
  1. Rendu en profondeur (projection orthographique, z-buffer en numpy pur) depuis 26 directions.
  2. Segmentation de chaque carte en plages CONTINUES (deux pixels voisins sont de la meme plage si leur profondeur differe de moins de `delta`).
  3. Un TROU est une plage petite, qui ne touche ni le fond ni le bord de l'image, dont le pourtour est (a 80 % au moins) une marche vers une plage
     PLUS PROCHE. Une tache ordinaire (symbole, texture) ne change pas la profondeur : jamais detectee. Un jour entre deux jambes touche le fond :
     jamais detecte.
  4. Pourtour : le contour de la tache, repris sur les pixels de la plage proche voisine, converti en SOMMETS DU MAILLAGE (sommet de la face vue le
     plus proche du point). Orientation : le bouchon regarde l'observateur. Un meme trou vu de plusieurs directions n'est garde que dans la vue ou il
     est le plus grand (la plus de face).
  5. Le bouchon est celui de bouchage_lisse.py (plan / Liepa / ellipse, couleurs du voisinage). Le collier (voisins qui tiennent la tangente) est
     restreint a la peau EXTERIEURE autour du trou : sinon les voisins du fond du puits tireraient le bouchon vers l'interieur.

NON DESTRUCTIF : meme garantie que le bouchon lisse (aucune face retiree, aucun sommet deplace, aucune UV reecrite). Derriere le bouchon, la feuille
du dessous reste en place : on ne supprime pas de matiere.

LIMITES (dites a l'utilisateur) : un trou ne se detecte que s'il est visible de l'exterieur depuis une des 26 directions ; un trou plus large que
`TAILLE_MAX` (12 % de la diagonale) n'est pas pris pour un trou ; un creux a bords francs (narine, oeil) est un trou pour ce detecteur : la plage de
tailles du pourtour (min / max aretes) reste le garde-fou de l'utilisateur.

Dependances : numpy, scipy.
"""
import math
import time

import numpy as np

VERSION = 1

RESOLUTION_BALAYAGE = 1024    # pixels de cote d'une carte de balayage (grossiere)
RESOLUTION_REPRISE = 256      # pixels de cote de la carte fine centree sur un trou
NB_VUES = 48                  # directions du balayage
ESSAIS_PAR_TROU = 4            # vues essayees, au plus, pour reprendre un meme trou
RAYON_MIN_ARETES = 2.0        # un trou a moins de 2 aretes moyennes de rayon est un grain de la carte, pas un trou
DELTA = 0.006                # marche de profondeur (fraction de la diagonale) qui separe deux plages
TAILLE_MAX = 0.12            # un trou ne depasse pas 12 % de la diagonale (au-dela : ce n'est pas un trou de peau)
AIRE_MIN_PX = 8              # plus petite tache retenue (pixels)
FRACTION_PROCHE = 0.8        # part du pourtour d'une tache qui doit border une plage plus proche
PAS_ECHANTILLON = 0.7        # espacement des echantillons de surface (pixels) : aucun pixel d'un triangle ne reste vide
TROUS_MAX = 400              # garde-fou : au-dela, les plus grands seulement
ECHANTILLONS_MAX = 40_000_000
K_RESEAU_MAX = 64             # au-dela, un triangle est rendu par test de couverture de sa boite englobante


try:                                   # accelerateur facultatif (meme demarche que texture_project.py) : sans numba, le rendu numpy ci-dessous fait le meme travail
    import numba as _numba
    _AVEC_NUMBA = True
except Exception:                      # pragma: no cover
    _numba = None
    _AVEC_NUMBA = False


if _AVEC_NUMBA:
    @_numba.njit(cache=False, nogil=True)
    def _raster_numba(X, Y, Z, F, R, fid, zb):
        for f in range(F.shape[0]):
            ia, ib, ic = F[f, 0], F[f, 1], F[f, 2]
            xa, xb, xc = X[ia], X[ib], X[ic]
            ya, yb, yc = Y[ia], Y[ib], Y[ic]
            x0 = int(np.floor(min(xa, xb, xc)))
            x1 = int(np.floor(max(xa, xb, xc)))
            y0 = int(np.floor(min(ya, yb, yc)))
            y1 = int(np.floor(max(ya, yb, yc)))
            if x1 < 0 or y1 < 0 or x0 >= R or y0 >= R:
                continue
            den = (yb - yc) * (xa - xc) + (xc - xb) * (ya - yc)
            if x0 < 0:
                x0 = 0
            if y0 < 0:
                y0 = 0
            if x1 > R - 1:
                x1 = R - 1
            if y1 > R - 1:
                y1 = R - 1
            couvert = False
            if abs(den) > 1e-12:
                for y in range(y0, y1 + 1):
                    for x in range(x0, x1 + 1):
                        px = x + 0.5
                        py = y + 0.5
                        l1 = ((yb - yc) * (px - xc) + (xc - xb) * (py - yc)) / den
                        l2 = ((yc - ya) * (px - xc) + (xa - xc) * (py - yc)) / den
                        l3 = 1.0 - l1 - l2
                        if l1 >= -1e-9 and l2 >= -1e-9 and l3 >= -1e-9:
                            z = l1 * Z[ia] + l2 * Z[ib] + l3 * Z[ic]
                            couvert = True
                            if z < zb[y, x]:
                                zb[y, x] = z
                                fid[y, x] = f
            if not couvert:                    # triangle plus petit qu'un pixel : son pixel est quand meme marque (aucune fissure dans la carte)
                cx = int(np.floor((xa + xb + xc) / 3.0))
                cy = int(np.floor((ya + yb + yc) / 3.0))
                if 0 <= cx < R and 0 <= cy < R:
                    z = (Z[ia] + Z[ib] + Z[ic]) / 3.0
                    if z < zb[cy, cx]:
                        zb[cy, cx] = z
                        fid[cy, cx] = f


def directions():
    """26 directions d'observation (axes, diagonales de plan, coins de cube), unitaires, de l'observateur vers l'objet (rayon)."""
    out = []
    for x in (-1, 0, 1):
        for y in (-1, 0, 1):
            for z in (-1, 0, 1):
                if x or y or z:
                    v = np.array([x, y, z], dtype=np.float64)
                    out.append(v / np.linalg.norm(v))
    return out


# --------------------------------------------------------------------------------------------------------------------------------------------
# Rendu en profondeur (numpy pur)
# --------------------------------------------------------------------------------------------------------------------------------------------
def _base(d):
    """Axes ecran (a vers la droite, b vers le haut) pour un rayon d."""
    haut = np.array([0.0, 1.0, 0.0])
    if abs(float(d @ haut)) > 0.99:
        haut = np.array([0.0, 0.0, 1.0])
    a = np.cross(d, haut)
    a /= np.linalg.norm(a)
    b = np.cross(a, d)
    b /= np.linalg.norm(b)
    return a, b


def zbuffer(V, F, d, R=RESOLUTION_BALAYAGE, centre=None, diag=None):
    """Carte de profondeur orthographique. Rend (fid (R, R) int32 : face visible ou -1, zb (R, R) float64 : profondeur le long de d,
    projection (a, b, d, centre, echelle)). La profondeur croit en s'eloignant de l'observateur.
    Les surfaces sont echantillonnees (espacement PAS_ECHANTILLON pixel : aucun pixel d'un triangle ne reste vide) ; chaque echantillon est range dans
    un entier 64 bits [pixel | profondeur quantifiee | face] : un seul tri donne, par pixel, la face la plus proche."""
    d = np.asarray(d, dtype=np.float64)
    d = d / np.linalg.norm(d)
    a, b = _base(d)
    lo, hi = V.min(axis=0), V.max(axis=0)
    c = (lo + hi) / 2.0 if centre is None else centre
    dg = float(np.linalg.norm(hi - lo)) if diag is None else diag
    s = R / (dg * 1.02)
    X = (V - c) @ a * s + R / 2.0
    Y = (V - c) @ b * s + R / 2.0
    Z = (V - c) @ d
    if _AVEC_NUMBA:
        fid = np.full((R, R), -1, dtype=np.int32)
        zbn = np.full((R, R), np.inf)
        _raster_numba(X, Y, Z, np.ascontiguousarray(F), R, fid, zbn)
        return fid, np.where(fid >= 0, zbn, 0.0), (a, b, d, c, s)
    A, B, C = F[:, 0], F[:, 1], F[:, 2]
    xa, xb, xc = X[A], X[B], X[C]
    ya, yb, yc = Y[A], Y[B], Y[C]
    ex = np.maximum.reduce([np.abs(xb - xa), np.abs(xc - xb), np.abs(xa - xc)])
    ey = np.maximum.reduce([np.abs(yb - ya), np.abs(yc - yb), np.abs(ya - yc)])
    k = np.maximum(1, np.ceil(np.maximum(ex, ey) / PAS_ECHANTILLON)).astype(np.int64)
    dedans = (np.maximum.reduce([xa, xb, xc]) >= 0) & (np.minimum.reduce([xa, xb, xc]) < R) &              (np.maximum.reduce([ya, yb, yc]) >= 0) & (np.minimum.reduce([ya, yb, yc]) < R)
    nf = len(F)
    bits_f = max(1, int(nf - 1).bit_length())
    bits_p = int(R * R - 1).bit_length()
    bits_z = 62 - bits_f - bits_p
    zlo, zhi = float(Z.min()), float(Z.max())
    zq = (2.0 ** bits_z - 1.0) / max(zhi - zlo, 1e-30)
    best = np.full(R * R, np.iinfo(np.int64).max, dtype=np.int64)
    budget = 3_000_000
    grandes = np.nonzero(dedans & (k > K_RESEAU_MAX))[0]
    for kk in np.unique(k[dedans & (k <= K_RESEAU_MAX)]):
        kk = int(kk)
        fk = np.nonzero(dedans & (k == kk))[0]
        ij = np.array([(i, j) for i in range(kk + 1) for j in range(kk + 1 - i)], dtype=np.float64) / kk
        u = ij[:, 0][None, :]
        v = ij[:, 1][None, :]
        w = 1.0 - u - v
        pas = max(1, budget // len(ij))
        for p0 in range(0, len(fk), pas):
            fb = fk[p0:p0 + pas]
            px = np.floor(xa[fb][:, None] * w + xb[fb][:, None] * u + xc[fb][:, None] * v).astype(np.int64)
            py = np.floor(ya[fb][:, None] * w + yb[fb][:, None] * u + yc[fb][:, None] * v).astype(np.int64)
            z = Z[A[fb]][:, None] * w + Z[B[fb]][:, None] * u + Z[C[fb]][:, None] * v
            ok = (px >= 0) & (px < R) & (py >= 0) & (py < R)
            face = np.broadcast_to(fb[:, None], px.shape)[ok].astype(np.int64)
            key = ((py[ok] * R + px[ok]) << (bits_z + bits_f)) | (((z[ok] - zlo) * zq).astype(np.int64) << bits_f) | face
            key.sort()
            pix = key >> (bits_z + bits_f)
            premier = np.ones(len(key), dtype=bool)
            premier[1:] = pix[1:] != pix[:-1]
            key, pix = key[premier], pix[premier]
            best[pix] = np.minimum(best[pix], key)
    for f in grandes:              # grands triangles : test de couverture des pixels de leur boite englobante (l'echantillonnage couterait k^2 points)
        x0 = max(int(math.floor(min(xa[f], xb[f], xc[f]))), 0)
        x1 = min(int(math.floor(max(xa[f], xb[f], xc[f]))), R - 1)
        y0 = max(int(math.floor(min(ya[f], yb[f], yc[f]))), 0)
        y1 = min(int(math.floor(max(ya[f], yb[f], yc[f]))), R - 1)
        if x1 < x0 or y1 < y0:
            continue
        den = (yb[f] - yc[f]) * (xa[f] - xc[f]) + (xc[f] - xb[f]) * (ya[f] - yc[f])
        if abs(den) < 1e-12:
            continue
        XX, YY = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        l1 = ((yb[f] - yc[f]) * (XX - xc[f]) + (xc[f] - xb[f]) * (YY - yc[f])) / den
        l2 = ((yc[f] - ya[f]) * (XX - xc[f]) + (xa[f] - xc[f]) * (YY - yc[f])) / den
        l3 = 1.0 - l1 - l2
        m = (l1 >= -1e-9) & (l2 >= -1e-9) & (l3 >= -1e-9)
        if not m.any():
            continue
        z = (l1 * Z[A[f]] + l2 * Z[B[f]] + l3 * Z[C[f]])[m]
        pix = (YY[m].astype(np.int64) - 0) * 0 + (np.floor(YY[m]).astype(np.int64) * R + np.floor(XX[m]).astype(np.int64))
        key = (pix << (bits_z + bits_f)) | (((z - zlo) * zq).astype(np.int64) << bits_f) | int(f)
        best[pix] = np.minimum(best[pix], key)
    vu = best != np.iinfo(np.int64).max
    fid = np.full(R * R, -1, dtype=np.int32)
    zb = np.zeros(R * R)
    fid[vu] = (best[vu] & ((1 << bits_f) - 1)).astype(np.int32)
    zb[vu] = ((best[vu] >> bits_f) & ((1 << bits_z) - 1)) / zq + zlo
    return fid.reshape(R, R), zb.reshape(R, R), (a, b, d, c, s)


# --------------------------------------------------------------------------------------------------------------------------------------------
# Segmentation en plages continues, taches enfoncees
# --------------------------------------------------------------------------------------------------------------------------------------------
def segmenter(zb, hit, delta):
    """Etiquette les plages continues. Rend (etiquettes (R, R) -1 hors objet, paires profond/proche des marches (indices plats))."""
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components
    R = zb.shape[0]
    idx = np.arange(R * R).reshape(R, R)
    lignes, colonnes, pa_l, pb_l = [], [], [], []
    for dy, dx in ((0, 1), (1, 0)):
        a = idx[:R - dy, :R - dx]
        b = idx[dy:, dx:]
        deux = hit[:R - dy, :R - dx] & hit[dy:, dx:]
        dz = zb[dy:, dx:] - zb[:R - dy, :R - dx]
        cont = deux & (np.abs(dz) <= delta)
        lignes.append(a[cont])
        colonnes.append(b[cont])
        marche = deux & (np.abs(dz) > delta)
        profond_b = dz[marche] > 0
        pa_l.append(np.where(profond_b, b[marche], a[marche]))
        pb_l.append(np.where(profond_b, a[marche], b[marche]))
    lignes = np.concatenate(lignes)
    colonnes = np.concatenate(colonnes)
    g = coo_matrix((np.ones(len(lignes), dtype=np.int8), (lignes, colonnes)), shape=(R * R, R * R))
    _, lab = connected_components(g, directed=False)
    lab = lab.reshape(R, R).astype(np.int64)
    lab[~hit] = -1
    return lab, np.concatenate(pa_l), np.concatenate(pb_l)


def taches_enfoncees(zb, hit, delta, aire_max, aire_min=AIRE_MIN_PX, fraction=FRACTION_PROCHE, rejets=None):
    """Taches enfoncees entourees. Le fond compte comme une plage tres profonde (un jour qui traverse la coque est un trou comme un autre) ; une plage
    qui touche le BORD DE L'IMAGE n'est jamais un trou (le fond exterieur, une jambe qui sort du cadre).
    Pour chaque plage-graine petite bordee surtout par une plage plus proche T, on cherche la tache entiere : la zone connexe autour de la graine qui
    est plus profonde que le PLAN local de T de plus de `delta` (elle reunit donc les plages voisines du puits : fond, parois, feuille du dessous).
    Rend ([{'y0','x0','masque','proche','aire'}], carte d'etiquettes)."""
    from scipy import ndimage as ndi
    R = zb.shape[0]
    zmax = float(zb[hit].max()) if hit.any() else 0.0
    zfull = np.where(hit, zb, zmax + 100.0 * delta)
    lab, jd, jn = segmenter(zfull, np.ones_like(hit), delta)
    L = lab.reshape(-1)
    n = int(L.max()) + 1
    aire = np.bincount(L, minlength=n)
    bord = np.zeros((R, R), dtype=bool)
    bord[0] = bord[-1] = True
    bord[:, 0] = bord[:, -1] = True
    touche = np.zeros(n, dtype=bool)
    touche[L[bord.reshape(-1)]] = True
    fond = np.zeros(n, dtype=bool)
    fond[L[(~hit).reshape(-1)]] = True
    sd, sn = L[jd], L[jn]
    profond = np.bincount(sd, minlength=n)
    cand = np.nonzero((aire >= aire_min) & (aire <= aire_max) & (~touche) & (profond > 0))[0]
    res = []
    if len(cand) == 0:
        return res, lab
    ordre = np.argsort(sd, kind='stable')
    sd_tri, sn_tri = sd[ordre], sn[ordre]
    debut = np.searchsorted(sd_tri, cand, side='left')
    fin = np.searchsorted(sd_tri, cand, side='right')
    pris = np.zeros((R, R), dtype=bool)
    objets = ndi.find_objects(lab + 1)
    voisines = {}
    for a_, b_ in np.unique(np.stack([sd, sn], axis=1), axis=0):
        voisines.setdefault(int(a_), set()).add(int(b_))
        voisines.setdefault(int(b_), set()).add(int(a_))

    def region_par_plages(sg, T_l):
        """Repli : la graine et les petites plages qui la touchent (3 sauts au plus), hors plages proches, fond exterieur et gros morceaux."""
        dedans = {sg}
        front = [sg]
        for _ in range(3):
            nxt = []
            for u in front:
                for v in voisines.get(u, ()):
                    if v in dedans or v in T_l or touche[v] or aire[v] > aire_max:
                        continue
                    dedans.add(v)
                    nxt.append(v)
            front = nxt
        return dedans
    for sgraine, i0, i1 in sorted(zip(cand, debut, fin), key=lambda t: -aire[t[0]]):
        sl = objets[sgraine]
        if sl is None:
            continue
        gy, gx = sl
        c = np.bincount(sn_tri[i0:i1])
        # les plages PLUS PROCHES qui bordent la graine : une fente entre deux panneaux en a deux (une de chaque cote)
        T_liste = [int(k) for k in np.nonzero(c >= max(3, 0.12 * (i1 - i0)))[0] if not fond[k] and aire[k] > aire[sgraine]]
        if not T_liste or sum(int(c[k]) for k in T_liste) < 0.7 * (i1 - i0):
            if rejets is not None:
                rejets.append(('proche', (gy.start, gx.start), int(aire[sgraine])))
            continue
        T = T_liste[0]
        h, w = gy.stop - gy.start, gx.stop - gx.start
        marge = max(12, int(max(h, w)))
        y0, y1 = max(gy.start - marge, 0), min(gy.stop + marge, R)
        x0, x1 = max(gx.start - marge, 0), min(gx.stop + marge, R)
        sous = lab[y0:y1, x0:x1]
        graine = sous == sgraine
        if pris[y0:y1, x0:x1][graine].any():
            continue
        dans_T = np.isin(sous, T_liste)
        Tm = dans_T & ndi.binary_dilation(graine, iterations=marge)
        ys, xs = np.nonzero(Tm)
        if len(ys) < 20:
            if rejets is not None:
                rejets.append(('peu_de_proche', (gy.start, gx.start), int(aire[sgraine])))
            continue
        A = np.c_[xs, ys, np.ones(len(xs))].astype(np.float64)
        zt = zfull[y0:y1, x0:x1][ys, xs]
        coef, *_ = np.linalg.lstsq(A, zt, rcond=None)
        if float(np.std(zt - A @ coef)) > 4.0 * delta:
            if rejets is not None:
                rejets.append(('plan', (gy.start, gx.start), int(aire[sgraine]), float(np.std(zt - A @ coef) / delta)))
            continue
        yy, xx = np.mgrid[0:y1 - y0, 0:x1 - x0]
        plan = coef[0] * (xx + 0.5) + coef[1] * (yy + 0.5) + coef[2]
        # les pixels de T eux-memes ne font jamais partie du trou
        profonds = (zfull[y0:y1, x0:x1] - plan > delta) & ~dans_T
        zones, _ = ndi.label(profonds)
        ks = zones[graine & (zones > 0)]
        reg = zones == int(np.bincount(ks).argmax()) if len(ks) else None
        fuite = reg is None or reg[0].any() or reg[-1].any() or reg[:, 0].any() or reg[:, -1].any()
        if fuite:
            # la zone « plus profonde que le plan » deborde (fente qui se prolonge, creux voisin) : repli sur les petites plages voisines
            dedans = region_par_plages(sgraine, set(T_liste))
            reg = np.isin(sous, list(dedans))
            if reg[0].any() or reg[-1].any() or reg[:, 0].any() or reg[:, -1].any():
                if rejets is not None:
                    rejets.append(('cadre', (gy.start, gx.start), int(aire[sgraine])))
                continue
        a_reg = int(reg.sum())
        if a_reg > aire_max:
            if rejets is not None:
                rejets.append(('trop_grand', (gy.start, gx.start), a_reg))
            continue
        ring = ndi.binary_dilation(reg, structure=ndi.generate_binary_structure(2, 1)) & ~reg
        if not ring.any() or float(dans_T[ring].mean()) < fraction:
            if rejets is not None:
                rejets.append(('entoure', (gy.start, gx.start), a_reg, float(dans_T[ring].mean())))
            continue
        pris[y0:y1, x0:x1] |= reg
        ry, rx = np.nonzero(reg)
        cyl, cxl = float(ry.mean()), float(rx.mean())
        res.append({'y0': y0, 'x0': x0, 'masque': reg, 'proche': T_liste, 'aire': a_reg, 'cy': y0 + cyl, 'cx': x0 + cxl,
                    'etendue': 0.5 * math.hypot(float(np.ptp(ry)) + 1.0, float(np.ptp(rx)) + 1.0), 'pente': (float(coef[0]), float(coef[1])),
                    'zc': float(coef[0] * (cxl + 0.5) + coef[1] * (cyl + 0.5) + coef[2])})
    return res, lab


# --------------------------------------------------------------------------------------------------------------------------------------------
# Contour d'une tache -> pourtour en sommets du maillage
# --------------------------------------------------------------------------------------------------------------------------------------------
_VOISINS8 = [(-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1)]      # sens horaire, (dy, dx)
_HORAIRE = [(0, -1), (-1, -1), (-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1)]       # idem a partir de l'ouest (suivi de contour)


def contour(masque):
    """Contour exterieur (suivi de Moore, arret de Jacob) d'une tache : liste ordonnee de (y, x), pixels de la tache. masque : booleen (h, w)."""
    ys, xs = np.nonzero(masque)
    if len(ys) == 0:
        return []
    h, w = masque.shape
    k0 = int(np.argmin(ys * w + xs))
    depart = (int(ys[k0]), int(xs[k0]))
    if len(ys) == 1:
        return [depart]

    def plein(y, x):
        return 0 <= y < h and 0 <= x < w and bool(masque[y, x])
    pts = [depart]
    c = depart
    b_idx = 0                                   # le voisin de l'ouest du premier pixel (en ordre raster) est vide
    b0 = b_idx
    for _ in range(8 * len(ys) + 16):
        trouve = False
        for t in range(1, 9):
            idx = (b_idx + t) % 8
            ny, nx = c[0] + _HORAIRE[idx][0], c[1] + _HORAIRE[idx][1]
            if plein(ny, nx):
                trouve = True
                prec = (idx - 1) % 8
                py, px = c[0] + _HORAIRE[prec][0], c[1] + _HORAIRE[prec][1]
                rel = (py - ny, px - nx)
                b_idx = _HORAIRE.index(rel) if rel in _HORAIRE else (prec + 4) % 8
                c = (ny, nx)
                break
        if not trouve:
            break
        if c == depart and b_idx == b0:
            break
        pts.append(c)
    if len(pts) > 1 and pts[-1] == depart:
        pts.pop()
    return pts


def _normale_newell(P):
    n = np.zeros(3)
    for i in range(len(P)):
        a, b = P[i], P[(i + 1) % len(P)]
        n[0] += (a[1] - b[1]) * (a[2] + b[2])
        n[1] += (a[2] - b[2]) * (a[0] + b[0])
        n[2] += (a[0] - b[0]) * (a[1] + b[1])
    return n


def _cycle_simple(seq):
    """seq : liste de (groupe, sommet) formant un cycle. Rend un cycle SANS repetition de groupe : on garde la PREMIERE apparition de chaque groupe (le
    pourtour tourne une seule fois ; un groupe qui revient est le meme sommet vu de pixels voisins, jamais un nouveau tour). Lineaire."""
    vu = set()
    sortie = []
    for g, v in seq:
        if g not in vu:
            vu.add(g)
            sortie.append((g, v))
    return sortie


def _pourtour_de_tache(t, lab, fid, zb, proj, V, F, groupe, dmax=None):
    """Pourtour (indices de sommets, dans l'ordre) de la tache `t` (voir taches_enfoncees). Rend None si inexploitable, sinon
    (sommets du pourtour, faces vues de la peau proche autour du trou : pour restreindre le collier)."""
    from scipy import ndimage as ndi
    a, b, d, c, s = proj
    R = lab.shape[0]
    y0, x0 = t['y0'], t['x0']
    tache = ndi.binary_fill_holes(t['masque'])                # les ilots enfermes dans la tache font partie du trou
    sous = lab[y0:y0 + tache.shape[0], x0:x0 + tache.shape[1]]
    proche = np.isin(sous, t['proche'])
    pts = contour(tache)
    if len(pts) < 3:
        return None
    ring_px = []
    for (y, x) in pts:
        meilleur = None
        for dy, dx in _VOISINS8:
            ny, nx = y + dy, x + dx
            if 0 <= ny < sous.shape[0] and 0 <= nx < sous.shape[1] and proche[ny, nx] and not tache[ny, nx]:
                if dy == 0 or dx == 0:
                    meilleur = (ny, nx)
                    break
                if meilleur is None:
                    meilleur = (ny, nx)
        if meilleur is not None:
            ring_px.append(meilleur)
    if len(ring_px) < 3:
        return None
    # pixels -> sommets : le sommet de la face vue le plus proche du point 3D du pixel
    sommets = []
    for (y, x) in ring_px:
        yy, xx = y + y0, x + x0
        f = int(fid[yy, xx])
        if f < 0:
            continue
        P = c + ((xx + 0.5 - R / 2.0) * a + (yy + 0.5 - R / 2.0) * b) / s + zb[yy, xx] * d
        vs = F[f]
        dist = np.linalg.norm(V[vs] - P, axis=1)
        k = int(np.argmin(dist))
        if dmax is not None and dist[k] > dmax:
            continue                                  # grand triangle : aucun de ses sommets n'est pres de ce point du pourtour
        g = int(groupe[vs[k]])
        if not sommets or sommets[-1][0] != g:
            sommets.append((g, int(vs[k])))
    while len(sommets) > 1 and sommets[0][0] == sommets[-1][0]:
        sommets.pop()
    cycle = _cycle_simple(sommets)
    if len(cycle) < 3:
        return None
    anneau = ndi.binary_dilation(tache, iterations=10) & proche
    faces = np.unique(fid[y0:y0 + tache.shape[0], x0:x0 + tache.shape[1]][anneau])
    return [v for _, v in cycle], faces[faces >= 0]


# --------------------------------------------------------------------------------------------------------------------------------------------
# Detection : balayage grossier (toutes les directions) puis reprise locale de chaque trou, de face
# --------------------------------------------------------------------------------------------------------------------------------------------
def directions_fibonacci(n):
    """n directions reparties sur la sphere (spirale de Fibonacci), unitaires."""
    i = np.arange(n) + 0.5
    phi = np.arccos(1.0 - 2.0 * i / n)
    theta = math.pi * (1.0 + 5.0 ** 0.5) * i
    return [np.array([math.cos(t) * math.sin(p), math.sin(t) * math.sin(p), math.cos(p)]) for t, p in zip(theta, phi)]


def _centre_trou(t, proj, R):
    """Point 3D (sur le plan de la peau) du centre d'une tache et son rayon (unites du maillage)."""
    a, b, d, c, s = proj
    return c + ((t['cx'] + 0.5 - R / 2.0) * a + (t['cy'] + 0.5 - R / 2.0) * b) / s + t['zc'] * d, max(math.sqrt(t['aire'] / math.pi), t['etendue']) / s


def detecter(V, F, prep, min_aretes=3, max_aretes=2000, vues=None, resolution=RESOLUTION_BALAYAGE, journal=None, budget_s=None, debug=None):
    """Trous de peau du maillage. Rend (liste de trous, rapport). Un trou : {'debut': sommets du pourtour (ordre du pourtour), 'n', 'centre', 'rayon',
    'voisins_ok': groupes de la peau exterieure voisine, 'vue': indice, 'aire_px'}. Ne modifie rien.
    1. BALAYAGE : cartes de profondeur grossieres depuis NB_VUES directions ; chaque tache enfoncee entouree donne un candidat (centre 3D, rayon, vue).
       Les candidats voisins sont regroupes : un trou est vu sous plusieurs angles, on garde la vue ou il est le plus grand (la plus de face).
    2. REPRISE : pour chaque trou, une petite carte tres fine, de cette vue, centree sur lui (seules les faces de la fenetre sont rendues) : c'est elle
       qui donne le pourtour."""
    t0 = time.time()
    V = np.asarray(V, dtype=np.float64)
    F = np.asarray(F, dtype=np.int64)
    groupe = prep['groupe']
    lo, hi = V.min(axis=0), V.max(axis=0)
    diag = float(np.linalg.norm(hi - lo))
    if diag <= 0 or len(F) == 0:
        return [], {'vues': 0, 'candidats': 0, 'trous': 0, 'duree': 0.0}
    dirs = directions_fibonacci(NB_VUES) if vues is None else [np.asarray(v, dtype=np.float64) / np.linalg.norm(v) for v in vues]
    centre = (lo + hi) / 2.0
    arete = float(prep.get('arete_moyenne') or 0.0)
    delta = DELTA * diag
    cands = []
    for iv, d in enumerate(dirs):
        if budget_s is not None and time.time() - t0 > budget_s:
            break
        fid, zb, proj = zbuffer(V, F, d, resolution, centre, diag)
        res, _ = taches_enfoncees(zb, fid >= 0, delta, int((TAILLE_MAX * diag * proj[4]) ** 2))
        for t in res:
            c3, r = _centre_trou(t, proj, resolution)
            frontal = 1.0 / math.sqrt(1.0 + (t['pente'][0] * proj[4]) ** 2 + (t['pente'][1] * proj[4]) ** 2)       # 1 = la peau est de face, 0 = rasante
            cands.append({'c': c3, 'r': r, 'iv': iv, 'aire': t['aire'] * frontal, 'rg': math.sqrt(t['aire'] / math.pi) / proj[4]})
    # regroupement : les plus grands (les plus de face) d'abord
    n_cands = len(cands)
    cands = [h for h in cands if h['rg'] >= RAYON_MIN_ARETES * arete or h['r'] >= 4.0 * arete]        # les grains de la carte ne valent pas une reprise
    cands.sort(key=lambda h: -h['aire'])
    cF = V[F].mean(axis=1)                                         # pour ne rendre dans une fenetre que les faces qui la touchent
    rF = np.linalg.norm(V[F] - cF[:, None, :], axis=2).max(axis=1)
    groupes = []
    for h in cands:
        for membres in groupes:
            g = membres[0]
            if np.linalg.norm(h['c'] - g['c']) < 0.9 * max(h['rg'], g['rg']) + 0.5 * arete:
                membres.append(h)
                break
        else:
            groupes.append([h])
    trouves = []

    def essayer(g):
        d = dirs[g['iv']]
        demi = max(3.0 * g['r'], 8.0 * arete, 0.01 * diag)
        a_, b_ = _base(d / np.linalg.norm(d))
        px_, py_ = (cF - g['c']) @ a_, (cF - g['c']) @ b_
        sel = np.nonzero((np.abs(px_) < demi + rF) & (np.abs(py_) < demi + rF))[0]
        fsel = F[sel]
        fid, zb, proj = zbuffer(V, fsel, d, RESOLUTION_REPRISE, g['c'], 2.0 * demi / 1.02)
        fid = np.where(fid >= 0, sel[np.maximum(fid, 0)], -1).astype(np.int32)
        s = proj[4]
        res, lab = taches_enfoncees(zb, fid >= 0, delta, int((TAILLE_MAX * diag * s) ** 2))
        meilleur = None
        for t in res:
            dist = math.hypot(t['cx'] - RESOLUTION_REPRISE / 2.0, t['cy'] - RESOLUTION_REPRISE / 2.0)
            if dist < 0.35 * RESOLUTION_REPRISE and (meilleur is None or t['aire'] > meilleur['aire']):
                meilleur = t
        if meilleur is None:
            if debug is not None:
                debug.append(('fenetre_sans_tache', g['c'], g['r'], len(res)))
            return None
        out = _pourtour_de_tache(meilleur, lab, fid, zb, proj, V, F, groupe, dmax=3.0 * arete if arete > 0 else None)
        if out is None:
            if debug is not None:
                debug.append(('pourtour', g['c'], g['r']))
            return None
        ring, faces_vues = out
        Pr = V[ring]
        dc = np.linalg.norm(Pr - np.median(Pr, axis=0), axis=1)
        garde = dc <= 2.5 * np.median(dc) + 2.0 * arete + 1e-12          # un sommet loin des autres (grand triangle voisin) deformerait tout le bouchon
        ring = [v for v, k in zip(ring, garde) if k]
        n = len(ring)
        if n < max(3, int(min_aretes)) or n > int(max_aretes):
            if debug is not None:
                debug.append(('n', g['c'], g['r'], n))
            return None
        P = V[ring]
        ctr = P.mean(axis=0)
        rayon = float(np.linalg.norm(P - ctr, axis=1).max())
        if rayon < RAYON_MIN_ARETES * arete:
            if debug is not None:
                debug.append(('rayon', g['c'], g['r'], rayon))
            return None                                  # trop petit pour etre autre chose qu'un grain de la carte
        ordre_rustine = list(ring)
        if float(_normale_newell(P) @ proj[2]) > 0:     # le bouchon regarde l'observateur
            ordre_rustine = ordre_rustine[::-1]
        return {'debut': ordre_rustine[::-1], 'n': n, 'centre': ctr, 'rayon': rayon, 'faces_vues': faces_vues, 'vue': g['iv'], 'aire_px': meilleur['aire']}

    for membres in groupes:
        for g in membres[:ESSAIS_PAR_TROU]:             # la meilleure vue d'abord ; si la reprise echoue, la suivante
            h = essayer(g)
            if h is not None:
                trouves.append(h)
                break
    # deux groupes qui retombent sur le meme trou
    trouves.sort(key=lambda h: -h['rayon'])
    gardes = []
    for h in trouves:
        ens = set(int(groupe[v]) for v in h['debut'])
        h['_ens'] = ens
        doublon = False
        for g in gardes:
            commun = len(ens & g['_ens']) / float(max(1, min(len(ens), len(g['_ens']))))
            if commun >= 0.3 or np.linalg.norm(h['centre'] - g['centre']) < 0.25 * min(h['rayon'], g['rayon']):
                doublon = True                         # meme trou vu d'une autre direction : les pourtours partagent leurs sommets
                break
        if not doublon:
            gardes.append(h)
    gardes = gardes[:TROUS_MAX]
    for h in gardes:
        h['voisins_ok'] = set(int(g) for g in np.unique(groupe[F[h['faces_vues']].reshape(-1)]))
    rapport = {'vues': len(dirs), 'candidats': n_cands, 'trous': len(gardes), 'duree': time.time() - t0}
    if journal:
        journal(f'skin holes: {len(gardes)} found ({n_cands} candidates over {len(dirs)} views, {rapport["duree"]:.1f} s)')
    return gardes, rapport


def analyse_peau(V, F, prep, min_aretes=3, max_aretes=2000, **kw):
    """Une 'analyse' au format de bouchage_trous.analyser (pour bouchage_lisse.boucher), faite des trous de peau. Les pourtours ne sont PAS des aretes
    de bord : le bouchon copie les sommets du pourtour (comme pour un trou ordinaire)."""
    trous, rapport = detecter(V, F, prep, min_aretes, max_aretes, **kw)
    boucles = []
    for h in trous:
        boucles.append({'n': h['n'], 'debut': list(h['debut']), 'aire': 0.0, 'perimetre': 0.0, 'categorie': 'a_boucher', 'mode': 'lisse',
                        'triangles': [], 'chaine': False, 'voisins_ok': h['voisins_ok'], 'peau': True})
    return {
        'version': VERSION, 'sommets': int(len(V)), 'faces': int(len(F)), 'tolerance': prep['tol'], 'arete_moyenne': prep['arete_moyenne'],
        'aretes_de_bord': 0, 'aretes_non_manifold': int((prep['cnt'] > 2).sum()), 'boucles': boucles,
        'chaines_ouvertes': 0, 'chaines_fermees': 0, 'a_boucher': len(boucles), 'trop_petites': 0, 'trop_grandes': 0, 'degenerees': 0,
        'non_triangulables': 0, 'plus_petite': min([b['n'] for b in boucles] or [0]), 'plus_grande': max([b['n'] for b in boucles] or [0]),
        'modes': {'lisse': len(boucles)}, 'ajout': [], 'faces_ajoutees': 0, 'restantes': 0, 'verdict': 'CLOSED_OK',
        'min_aretes': max(3, int(min_aretes)), 'max_aretes': int(max_aretes), 'plafond': int(max_aretes), 'peau': rapport,
    }
