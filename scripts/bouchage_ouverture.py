# -*- coding: utf-8 -*-
"""GRANDES OUVERTURES vers la cavite interieure (2026-10-26) : un ventre, un socle, une base dont la peau manque sur une large surface.

POURQUOI. Un maillage TRELLIS est un empilement de feuilles quasi sans epaisseur. Quand l'image montre un personnage sans socle, le modele laisse parfois
une GRANDE ouverture d'anatomie (bas du ventre, dessous) : on voit l'interieur du corps, borde par des parties du corps (pattes, bas du torse) a des
profondeurs differentes, SANS peau continue autour. Ce n'est ni un trou a bord ouvert (0 arete de bord apres soudure), ni un trou de peau (bouchage_peau.py :
cartes de profondeur, un trou ENTOURE d'une peau continue). Les mesures anterieures (AGENT_LOG, entrees fill-* du 26/10) : l'enroulement (winding) et la
lumiere sont aveugles aux coques minces fermees ; le voxel est inutilisable ; la profondeur voit les creux mais pas une ouverture dont le pourtour est fait
de pieces disjointes.

METHODE (par la FUITE de rayons depuis la cavite).
  1. CAVITE : on echantillonne une grille de points dans la boite du maillage, on lance depuis chacun quelques dizaines de rayons (grille uniforme + numba) ;
     la part de rayons qui s'echappent sans rien toucher (`fuite`) vaut ~0 dans une cavite FERMEE, ~1 loin de l'objet, et 4-40 % dans une cavite a grande
     ouverture. Les points de fuite intermediaire, connexes entre eux, forment la cavite ; on en garde les plus grandes composantes ; leur centre est
     le point de la composante le plus proche du centroide.
  2. OUVERTURE : depuis ce centre, une grille de rayons en latitude / longitude (axe polaire choisi hors de l'ouverture). Les rayons qui s'echappent forment
     des composantes CONNEXES sur la sphere : chacune est une ouverture (un cone de fuite).
  3. POURTOUR : le contour de la composante, pris sur les rayons voisins QUI TOUCHENT la surface (la plus proche des deux faces voisines en profondeur),
     converti en sommets reels du maillage (le sommet de la face touchee le plus proche du point d'impact), ordonne le long du contour. C'est une boucle
     fermee de sommets reels : un trou a bord OUVERT virtuel, que bouchage_lisse.py ferme (plan / Liepa, couleurs du voisinage, UV du voisinage).
  4. GARDE-FOUS : taille du pourtour (fraction de la diagonale) entre `OUVERTURE_MIN` et `max_trou_relatif`, nombre d'aretes <= max_aretes, cone assez
     large pour ne pas etre une fissure, pourtour sans SAUTS (les cordes entre sommets consecutifs restent du meme ordre : sur une moissonneuse, les
     pourtours qui passent d'une piece a une autre en profondeur donnaient des voiles diagonaux ; refuses).

NON DESTRUCTIF : meme garantie que le bouchon lisse (aucune face retiree, aucun sommet deplace, aucune UV reecrite).

LIMITES (dites a l'utilisateur) : une ouverture n'est detectee que si la cavite a au moins un point de fuite intermediaire ; une cavite dont les parois ne
se voient pas d'un meme point (tres tortueuse) ne donne que la part visible du pourtour ; une ouverture VOULUE (fenetre, cockpit, bol) est une ouverture
pour ce detecteur : d'ou la case explicite, decochee par defaut.

Dependances : numpy, scipy ; numba (sinon la detection est desactivee et le dit).
"""
import math
import time

import numpy as np

VERSION = 1

GRILLE_RES = 96                  # cellules de la grille d'acceleration (par axe)
POINTS_CAVITE = 22               # points de sondage par axe
RAYONS_SONDAGE = 64              # rayons par point de sondage
FUITE_MIN = 0.02                 # sous cette part de fuite : cavite fermee (aucune ouverture), ou piece pleine
FUITE_MAX = 0.30                 # au-dela : l'espace ouvert voisin du maillage, pas une cavite
CAVITES_MAX = 3                  # composantes de cavite essayees (les plus grandes)
CAVITE_MIN_POINTS = 4            # une composante de moins de 4 points de sondage est une alcove, pas une cavite
SPHERE_H = 150                   # rayons en latitude
SPHERE_W = 300                   # rayons en longitude
OUVERTURE_MIN_SR = 0.02          # angle solide minimal (fraction de la sphere) d'un cone de fuite ; en dessous : fissure ou jour entre deux pieces
OUVERTURE_MIN = 0.12             # taille minimale du pourtour (diagonale de sa boite, fraction de la diagonale du maillage) : en dessous, un petit jour, pas une GRANDE ouverture
MAX_TROU_RELATIF = 0.40          # taille maximale du pourtour (fraction de la diagonale) par defaut
OUVERTURES_MAX = 6
SAUT_PART_MAX = 0.02             # part des cordes du pourtour plus longues que 5 fois la corde mediane : un pourtour qui SAUTE d'une piece a une autre
SAUT_CORDE_MAX = 20.0            # (rambarde, cabine, pieces separees en profondeur) n'est pas le bord d'UNE ouverture : le bouchon ferait des voiles diagonaux

try:
    import numba as _numba
    _AVEC_NUMBA = True
except Exception:                      # pragma: no cover
    _numba = None
    _AVEC_NUMBA = False


if _AVEC_NUMBA:
    @_numba.njit(cache=False, nogil=True)
    def _bornes(V, F, f, lo, inv, G):
        a, b, c = V[F[f, 0]], V[F[f, 1]], V[F[f, 2]]
        r = np.empty(6, dtype=np.int64)
        for k in range(3):
            mn = min(a[k], b[k], c[k])
            mx = max(a[k], b[k], c[k])
            r[2 * k] = min(G - 1, max(0, int((mn - lo[k]) * inv)))
            r[2 * k + 1] = min(G - 1, max(0, int((mx - lo[k]) * inv)))
        return r

    @_numba.njit(cache=False, nogil=True)
    def _compter(V, F, lo, inv, G, cnt):
        for f in range(F.shape[0]):
            r = _bornes(V, F, f, lo, inv, G)
            for i in range(r[0], r[1] + 1):
                for j in range(r[2], r[3] + 1):
                    for k in range(r[4], r[5] + 1):
                        cnt[(i * G + j) * G + k] += 1

    @_numba.njit(cache=False, nogil=True)
    def _remplir(V, F, lo, inv, G, start, pos, liste):
        for f in range(F.shape[0]):
            r = _bornes(V, F, f, lo, inv, G)
            for i in range(r[0], r[1] + 1):
                for j in range(r[2], r[3] + 1):
                    for k in range(r[4], r[5] + 1):
                        c_ = (i * G + j) * G + k
                        liste[start[c_] + pos[c_]] = f
                        pos[c_] += 1

    @_numba.njit(cache=False, nogil=True)
    def _tri(ox, oy, oz, dx, dy, dz, a, b, c):
        e1x, e1y, e1z = b[0] - a[0], b[1] - a[1], b[2] - a[2]
        e2x, e2y, e2z = c[0] - a[0], c[1] - a[1], c[2] - a[2]
        px, py, pz = dy * e2z - dz * e2y, dz * e2x - dx * e2z, dx * e2y - dy * e2x
        det = e1x * px + e1y * py + e1z * pz
        if abs(det) < 1e-18:
            return -1.0
        iv = 1.0 / det
        tx, ty, tz = ox - a[0], oy - a[1], oz - a[2]
        u = (tx * px + ty * py + tz * pz) * iv
        if u < 0.0 or u > 1.0:
            return -1.0
        qx, qy, qz = ty * e1z - tz * e1y, tz * e1x - tx * e1z, tx * e1y - ty * e1x
        v = (dx * qx + dy * qy + dz * qz) * iv
        if v < 0.0 or u + v > 1.0:
            return -1.0
        return (e2x * qx + e2y * qy + e2z * qz) * iv

    @_numba.njit(cache=False, nogil=True)
    def _lancer(V, F, lo, inv, G, start, liste, O, D, tmin, sortie_t, sortie_f):
        cell = 1.0 / inv
        for r in range(O.shape[0]):
            ox, oy, oz = O[r, 0], O[r, 1], O[r, 2]
            dx, dy, dz = D[r, 0], D[r, 1], D[r, 2]
            o = (ox, oy, oz)
            d = (dx, dy, dz)
            sortie_t[r] = -1.0
            sortie_f[r] = -1
            t0 = 0.0
            t1 = 1e30
            ok = True
            for k in range(3):
                if abs(d[k]) < 1e-15:
                    if o[k] < lo[k] or o[k] > lo[k] + G * cell:
                        ok = False
                else:
                    ta = (lo[k] - o[k]) / d[k]
                    tb = (lo[k] + G * cell - o[k]) / d[k]
                    if ta > tb:
                        ta, tb = tb, ta
                    t0 = max(t0, ta)
                    t1 = min(t1, tb)
            if not ok or t0 > t1:
                continue
            px, py, pz = ox + dx * (t0 + 1e-9), oy + dy * (t0 + 1e-9), oz + dz * (t0 + 1e-9)
            p = (px, py, pz)
            idx = np.empty(3, dtype=np.int64)
            step = np.empty(3, dtype=np.int64)
            tmax = np.empty(3)
            tdel = np.empty(3)
            for k in range(3):
                idx[k] = min(G - 1, max(0, int((p[k] - lo[k]) * inv)))
                if d[k] > 0:
                    step[k] = 1
                    tmax[k] = (lo[k] + (idx[k] + 1) * cell - o[k]) / d[k]
                    tdel[k] = cell / d[k]
                elif d[k] < 0:
                    step[k] = -1
                    tmax[k] = (lo[k] + idx[k] * cell - o[k]) / d[k]
                    tdel[k] = -cell / d[k]
                else:
                    step[k] = 0
                    tmax[k] = 1e30
                    tdel[k] = 1e30
            best = 1e30
            bf = -1
            while True:
                c_ = (idx[0] * G + idx[1]) * G + idx[2]
                for s in range(start[c_], start[c_ + 1]):
                    f = liste[s]
                    t = _tri(ox, oy, oz, dx, dy, dz, V[F[f, 0]], V[F[f, 1]], V[F[f, 2]])
                    if t > tmin and t < best:
                        best = t
                        bf = f
                kk = 0
                if tmax[1] < tmax[kk]:
                    kk = 1
                if tmax[2] < tmax[kk]:
                    kk = 2
                if bf >= 0 and best <= tmax[kk]:
                    break
                idx[kk] += step[kk]
                if idx[kk] < 0 or idx[kk] >= G:
                    break
                tmax[kk] += tdel[kk]
            if bf >= 0:
                sortie_t[r] = best
                sortie_f[r] = bf


def grille(V, F, G=GRILLE_RES):
    """Grille uniforme d'acceleration des triangles (CSR)."""
    lo = V.min(axis=0)
    hi = V.max(axis=0)
    cote = float((hi - lo).max()) * 1.0001
    inv = G / max(cote, 1e-30)
    cnt = np.zeros(G ** 3, dtype=np.int64)
    Vc = np.ascontiguousarray(V, dtype=np.float64)
    Fc = np.ascontiguousarray(F, dtype=np.int64)
    _compter(Vc, Fc, lo, inv, G, cnt)
    start = np.zeros(G ** 3 + 1, dtype=np.int64)
    np.cumsum(cnt, out=start[1:])
    liste = np.empty(int(start[-1]), dtype=np.int32)
    _remplir(Vc, Fc, lo, inv, G, start, np.zeros(G ** 3, dtype=np.int64), liste)
    return {'V': Vc, 'F': Fc, 'lo': lo, 'inv': inv, 'G': G, 'start': start, 'liste': liste}


def lancer(gr, O, D, tmin=1e-7):
    """Premier impact de chaque rayon. Rend (t (n,) -1 si le rayon s'echappe, face (n,) -1 si il s'echappe)."""
    O = np.ascontiguousarray(O, dtype=np.float64)
    D = np.ascontiguousarray(D, dtype=np.float64)
    t = np.empty(len(O))
    f = np.empty(len(O), dtype=np.int64)
    _lancer(gr['V'], gr['F'], gr['lo'], gr['inv'], gr['G'], gr['start'], gr['liste'], O, D, tmin, t, f)
    return t, f


def _fibonacci(n):
    i = np.arange(n) + 0.5
    z = 1.0 - 2.0 * i / n
    r = np.sqrt(np.maximum(0.0, 1.0 - z * z))
    ph = i * math.pi * (3.0 - math.sqrt(5.0))
    return np.stack([r * np.cos(ph), r * np.sin(ph), z], axis=1)


# --------------------------------------------------------------------------------------------------------------------------------------------
# 1. Cavite
# --------------------------------------------------------------------------------------------------------------------------------------------
def centres_cavite(gr, lo, hi, journal=None):
    """Centres des cavites a fuite partielle. Rend (liste de points, carte de fuite (N, N, N))."""
    from scipy import ndimage as ndi
    N = POINTS_CAVITE
    ax = [np.linspace(lo[k], hi[k], N + 2)[1:-1] for k in range(3)]
    P = np.stack(np.meshgrid(*ax, indexing='ij'), -1).reshape(-1, 3)
    D0 = _fibonacci(RAYONS_SONDAGE)
    O = np.repeat(P, len(D0), axis=0)
    D = np.tile(D0, (len(P), 1))
    _, f = lancer(gr, O, D)
    fuite = (f < 0).reshape(len(P), -1).mean(axis=1).reshape(N, N, N)
    cand = (fuite > FUITE_MIN) & (fuite < FUITE_MAX)
    lab, n = ndi.label(cand)
    if n == 0:
        return [], fuite
    tailles = ndi.sum(cand, lab, range(1, n + 1))
    Pg = P.reshape(N, N, N, 3)
    out = []
    for l in np.argsort(-tailles)[:CAVITES_MAX] + 1:
        if tailles[l - 1] < CAVITE_MIN_POINTS:
            continue
        sel = lab == l
        Pc = Pg[sel]
        Fc = fuite[sel]
        c0 = Pc.mean(axis=0)
        # centre : le point le plus ENFERME (moins de fuite) parmi ceux qui ne sont pas loin du centroide de la cavite
        ecart = np.linalg.norm(Pc - c0, axis=1)
        proches = ecart <= np.percentile(ecart, 50)
        k = int(np.argmin(np.where(proches, Fc, 9.0)))
        out.append(Pc[k].copy())
    return out, fuite


# --------------------------------------------------------------------------------------------------------------------------------------------
# 2-3. Cones de fuite et pourtours
# --------------------------------------------------------------------------------------------------------------------------------------------
def _repere(D0, fuit):
    """Repere (x, y, z) dont l'axe polaire z est le plus PERPENDICULAIRE a toutes les directions de fuite (les deux poles tombent loin de toute ouverture).
    D0 : directions d'essai (n, 3) ; fuit : masque booleen des directions qui s'echappent."""
    E = D0[fuit]
    if len(E) == 0:
        z = np.array([0.0, 1.0, 0.0])
    else:
        score = np.abs(D0 @ E.T).max(axis=1)
        z = D0[int(np.argmin(score))]
    h = np.array([1.0, 0.0, 0.0]) if abs(z[0]) < 0.9 else np.array([0.0, 1.0, 0.0])
    x = np.cross(h, z)
    x /= np.linalg.norm(x)
    y = np.cross(z, x)
    return x, y, z


def _grille_sphere(R):
    H, W = SPHERE_H, SPHERE_W
    th = (np.arange(H) + 0.5) / H * math.pi
    ph = (np.arange(W) + 0.5) / W * 2.0 * math.pi
    TH, PH = np.meshgrid(th, ph, indexing='ij')
    D = np.stack([np.sin(TH) * np.cos(PH), np.sin(TH) * np.sin(PH), np.cos(TH)], -1)
    return D @ np.stack(R, axis=0), TH


def _cycle_de_bord(masque):
    """Plus long cycle ordonne des pixels EXTERIEURS voisins (4-voisinage) d'une composante : liste de (pixel interieur, pixel exterieur) le long du
    contour, par suivi des aretes de pixel orientees."""
    H, W = masque.shape
    aretes = {}
    pad = np.pad(masque, 1)
    ys, xs = np.nonzero(masque)
    for y, x in zip(ys.tolist(), xs.tolist()):
        # coins : (y, x) haut-gauche ; sens horaire autour du pixel interieur
        if not pad[y, x + 1]:          # voisin haut
            aretes.setdefault((y, x), []).append(((y, x + 1), (y - 1, x), (y, x)))
        if not pad[y + 1, x + 2]:      # voisin droite
            aretes.setdefault((y, x + 1), []).append(((y + 1, x + 1), (y, x + 1), (y, x)))
        if not pad[y + 2, x + 1]:      # voisin bas
            aretes.setdefault((y + 1, x + 1), []).append(((y + 1, x), (y + 1, x), (y, x)))
        if not pad[y + 1, x]:          # voisin gauche
            aretes.setdefault((y + 1, x), []).append(((y, x), (y, x - 1), (y, x)))
    cycles = []
    while aretes:
        depart = next(iter(aretes))
        courant = depart
        cyc = []
        while True:
            lst = aretes.get(courant)
            if not lst:
                break
            arr = lst.pop()
            if not lst:
                del aretes[courant]
            cyc.append((arr[2], arr[1]))
            courant = arr[0]
            if courant == depart:
                break
        if len(cyc) > 2:
            cycles.append(cyc)
    if not cycles:
        return []
    return max(cycles, key=len)


def _sommet_proche(V, F, f, p):
    tri = F[f]
    k = int(np.argmin(np.linalg.norm(V[tri] - p, axis=1)))
    return int(tri[k])


def _newell(P):
    n = np.zeros(3)
    q = np.roll(P, -1, axis=0)
    n[0] = ((P[:, 1] - q[:, 1]) * (P[:, 2] + q[:, 2])).sum()
    n[1] = ((P[:, 2] - q[:, 2]) * (P[:, 0] + q[:, 0])).sum()
    n[2] = ((P[:, 0] - q[:, 0]) * (P[:, 1] + q[:, 1])).sum()
    return n


def ouvertures_depuis(gr, c, diag, groupe, max_relatif=MAX_TROU_RELATIF, max_aretes=2000, min_aretes=3, debug=None):
    """Ouvertures vues depuis le point c : liste de dicts {'debut', 'n', 'centre', 'rayon', 'voisins_ok', 'fuite', 'angle'} et le taux de fuite (sphere
    entiere, pondere par l'angle solide)."""
    from scipy import ndimage as ndi
    V, F = gr['V'], gr['F']
    # 1er passage : directions quelconques pour trouver l'axe polaire
    D0 = _fibonacci(2000)
    _, f0 = lancer(gr, np.tile(c, (len(D0), 1)), D0)
    rep = _repere(D0, f0 < 0)
    D, TH = _grille_sphere(rep)
    H, W = TH.shape
    t, f = lancer(gr, np.tile(c, (H * W, 1)), D.reshape(-1, 3))
    t = t.reshape(H, W)
    f = f.reshape(H, W)
    esc = f < 0
    poids = np.sin(TH)
    taux = float((esc * poids).sum() / poids.sum())
    # etiquetage avec la couture (8 colonnes recopiees) : un cone qui traverse la longitude 0 est UNE composante
    ext = np.concatenate([esc, esc[:, :8]], axis=1)
    lab_e, ne = ndi.label(ext, structure=np.ones((3, 3)))
    for y in range(H):
        for k in range(8):
            a, b = lab_e[y, k], lab_e[y, W + k]
            if a and b and a != b:
                lab_e[lab_e == b] = a
    sortie = []
    comps = [l for l in np.unique(lab_e[:, :W]) if l]
    for l in comps:
        m_e = lab_e == l
        m = m_e[:, :W].copy()
        m[:, :m_e.shape[1] - W] |= m_e[:, W:]
        angle = float((m * poids).sum() / poids.sum())
        if angle < OUVERTURE_MIN_SR:
            if debug is not None:
                debug.append(('cone_petit', angle))
            continue
        cols = np.nonzero(m.any(axis=0))[0]
        if m[0].any() or m[-1].any():
            if debug is not None:
                debug.append(('pole', angle))
            continue
        # decaler pour que la composante ne traverse pas la couture
        vide = np.nonzero(~m.any(axis=0))[0]
        if len(vide) == 0:
            continue
        dec = int(vide[0])
        m2 = np.roll(m, -dec, axis=1)
        m2 = ndi.binary_fill_holes(m2)
        cyc = _cycle_de_bord(m2)
        if len(cyc) < 8:
            continue
        ring = []
        for (yi, xi), (yo, xo) in cyc:
            xo_orig = (xo + dec) % W
            if yo < 0 or yo >= H:
                ring = []
                break
            ff = f[yo, xo_orig]
            if ff < 0:
                # voisin exterieur qui s'echappe aussi (trou dans le masque rempli) : on l'ignore
                continue
            p = c + t[yo, xo_orig] * D[yo, xo_orig]
            ring.append(_sommet_proche(V, F, int(ff), p))
        if len(ring) < max(3, min_aretes):
            continue
        # cycle SANS repetition de groupe soude (premiere apparition) et sans doublon consecutif
        vu = set()
        r2 = []
        for v in ring:
            g = int(groupe[v])
            if g not in vu:
                vu.add(g)
                r2.append(v)
        ring = r2
        n_ring = len(ring)
        if n_ring < max(3, min_aretes) or n_ring > int(max_aretes):
            if debug is not None:
                debug.append(('n', n_ring))
            continue
        P = V[np.asarray(ring)]
        ctr = P.mean(axis=0)
        ext_ = float(np.linalg.norm(P.max(axis=0) - P.min(axis=0)))
        if ext_ < OUVERTURE_MIN * diag or ext_ > max_relatif * diag:
            if debug is not None:
                debug.append(('taille', ext_ / diag))
            continue
        cordes = np.linalg.norm(P - np.roll(P, -1, axis=0), axis=1)
        med = float(np.median(cordes))
        if med > 0 and (float((cordes > 5.0 * med).mean()) > SAUT_PART_MAX or float(cordes.max()) > SAUT_CORDE_MAX * med):
            if debug is not None:
                debug.append(('sauts', float((cordes > 5.0 * med).mean()), float(cordes.max() / med)))
            continue
        # direction moyenne de fuite du cone = vers l'exterieur ; le bouchon regarde l'exterieur
        dm = D[m].sum(axis=0)
        dm /= max(np.linalg.norm(dm), 1e-30)
        ordre = list(ring)
        if float(_newell(P) @ dm) < 0:
            ordre = ordre[::-1]
        # peau voisine : groupes des faces touchees par les rayons de la couronne (3 pixels) autour du cone
        couronne = ndi.binary_dilation(m, structure=np.ones((3, 3)), iterations=3) & ~m
        fc = f[couronne]
        fc = fc[fc >= 0]
        voisins = set(int(g) for g in np.unique(groupe[F[fc].reshape(-1)])) if len(fc) else set()
        sortie.append({'debut': ordre[::-1], 'n': n_ring, 'centre': ctr, 'rayon': float(np.linalg.norm(P - ctr, axis=1).max()),
                       'voisins_ok': voisins, 'fuite': angle, 'etendue': ext_ / diag, 'direction': dm})
    return sortie, taux


def detecter(V, F, prep, min_aretes=3, max_aretes=2000, max_relatif=MAX_TROU_RELATIF, journal=None, debug=None):
    """Grandes ouvertures vers la cavite. Rend (liste, rapport). Ne modifie rien."""
    t0 = time.time()
    V = np.asarray(V, dtype=np.float64)
    F = np.asarray(F, dtype=np.int64)
    rapport = {'cavites': 0, 'ouvertures': 0, 'fuite': [], 'duree': 0.0, 'numba': _AVEC_NUMBA}
    if not _AVEC_NUMBA or len(F) == 0:
        if journal:
            journal('large openings: unavailable (no numba)' if not _AVEC_NUMBA else 'large openings: empty mesh')
        return [], rapport
    lo, hi = V.min(axis=0), V.max(axis=0)
    diag = float(np.linalg.norm(hi - lo))
    if diag <= 0:
        return [], rapport
    gr = grille(V, F)
    centres, _ = centres_cavite(gr, lo, hi)
    rapport['cavites'] = len(centres)
    groupe = prep['groupe']
    trouves = []
    for c in centres:
        liste, taux = ouvertures_depuis(gr, c, diag, groupe, max_relatif, max_aretes, min_aretes, debug)
        rapport['fuite'].append(round(taux, 3))
        for h in liste:
            ens = set(int(groupe[v]) for v in h['debut'])
            doublon = False
            for g in trouves:
                commun = len(ens & g['_ens']) / float(max(1, min(len(ens), len(g['_ens']))))
                if commun >= 0.3 or np.linalg.norm(h['centre'] - g['centre']) < 0.5 * min(h['rayon'], g['rayon']):
                    doublon = True
                    break
            if not doublon:
                h['_ens'] = ens
                trouves.append(h)
    trouves.sort(key=lambda h: -h['rayon'])
    trouves = trouves[:OUVERTURES_MAX]
    rapport['ouvertures'] = len(trouves)
    rapport['duree'] = time.time() - t0
    if journal:
        journal(f'large openings: {len(trouves)} found ({len(centres)} cavities, leak {rapport["fuite"]}, {rapport["duree"]:.1f} s)')
    return trouves, rapport


def analyse_ouverture(V, F, prep, min_aretes=3, max_aretes=2000, **kw):
    """Une 'analyse' au format de bouchage_trous.analyser (pour bouchage_lisse.boucher), faite des grandes ouvertures."""
    trous, rapport = detecter(V, F, prep, min_aretes, max_aretes, **kw)
    boucles = []
    for h in trous:
        boucles.append({'n': h['n'], 'debut': list(h['debut']), 'aire': 0.0, 'perimetre': 0.0, 'categorie': 'a_boucher', 'mode': 'lisse',
                        'triangles': [], 'chaine': False, 'voisins_ok': h['voisins_ok'], 'peau': True, 'ouverture': True})
    return {
        'version': VERSION, 'sommets': int(len(V)), 'faces': int(len(F)), 'tolerance': prep['tol'], 'arete_moyenne': prep['arete_moyenne'],
        'aretes_de_bord': 0, 'aretes_non_manifold': int((prep['cnt'] > 2).sum()), 'boucles': boucles,
        'chaines_ouvertes': 0, 'chaines_fermees': 0, 'a_boucher': len(boucles), 'trop_petites': 0, 'trop_grandes': 0, 'degenerees': 0,
        'non_triangulables': 0, 'plus_petite': min([b['n'] for b in boucles] or [0]), 'plus_grande': max([b['n'] for b in boucles] or [0]),
        'modes': {'lisse': len(boucles)}, 'ajout': [], 'faces_ajoutees': 0, 'restantes': 0, 'verdict': 'CLOSED_OK',
        'min_aretes': max(3, int(min_aretes)), 'max_aretes': int(max_aretes), 'plafond': int(max_aretes), 'ouvertures': rapport,
    }
