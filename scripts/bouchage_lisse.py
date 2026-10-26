# -*- coding: utf-8 -*-
"""Bouchon LISSE d'un trou de maillage (2026-10-26) : la rustine suit la courbure, ses UV et sa texture sont celles du voisinage.

POURQUOI. Le noyau de detection (bouchage_trous.py) ne savait qu'asseoir des triangles SUR les sommets du pourtour : un trou sur une surface courbe
donnait une rustine plate, des triangles retournes (refus « impossible a remplir » des qu'un pourtour de 28 aretes n'etait pas plan), jamais de
sommet interieur, donc ni courbure, ni texture propre. Mesure sur la moissonneuse (514 000 faces) percee de trous controles : le trou rond de
60 faces n'etait pas bouche, le trou de 2 500 faces l'etait a 8 % ; 43 % des normales d'une rustine pointaient a l'envers de la surface perdue.

METHODE (algorithmes publics ; on s'est inspire de la demarche des bouche-trous de moteurs de jeu — pourtour, triangulation, raffinement, lissage —
sans reprendre aucun code) :
  1. PARAMETRAGE. Le pourtour (n sommets, ordre de la rustine) est pose sur une ELLIPSE du plan, a abscisse curviligne proportionnelle a la longueur
     reelle des aretes ; les proportions de l'ellipse sont celles du pourtour dans son plan moyen. Tous les points d'un pourtour sont ainsi en
     position convexe : toute arete du pourtour est une arete de l'enveloppe convexe, donc de la triangulation de Delaunay (scipy, Qhull).
  2. MAILLAGE. Semis hexagonal d'espacement = longueur moyenne des aretes du pourtour (donc la densite du voisinage), borne par FACES_MAX_PAR_TROU,
     puis triangulation de Delaunay du plan. Aucun echec possible : un disque triangule n'a pas de triangle retourne dans le plan.
  3. LISSAGE (Liepa 2003, « Filling holes in meshes » ; Kobbelt et al. 1998, surfaces minimisant la courbure). Les sommets interieurs sont les
     solutions des moindres carres  min SOMME |L x|^2  (L = laplacien ombrelle) ou le pourtour ET les sommets voisins du maillage existant (le
     « collier ») sont fixes : la rustine est tangente a la surface qui l'entoure, sans pli au raccord.
  4. UV. Interpolation HARMONIQUE des UV du pourtour (laplacien, bord impose). Si le pourtour franchit une couture d'UV (saut), ou si l'interpolation
     se replie, ou recouvre les UV d'autres faces : UV CONSTANTES (une couleur du voisinage), jamais d'etirement a travers l'atlas.
  5. TEXTURE. Les texels que couvrent les UV de la rustine ET qu'aucune face existante n'utilise sont repeints par diffusion de la couleur des texels
     voisins (aucun bloc gris) ; un texel utilise par une face existante n'est JAMAIS modifie.
  6. NORMALES. Pourtour : normales du voisinage (pas de ligne de ruban au raccord) ; interieur : moyenne des faces de la rustine.

INVARIANTS (testes par build/bancs/noyaux/test_remplissage_trous.py) : aucune face d'entree n'est supprimee ni modifiee, aucun sommet d'entree n'est
deplace, aucune UV d'entree n'est reecrite ; les sommets du pourtour sont COPIES (memes positions : la copie soudee par position est fermee) ;
les triangles de la rustine sont orientes dans le sens du voisinage.

Dependances : numpy, scipy (+ PIL deja present pour les textures). Aucun module non commercial.
"""
import math
import time

import numpy as np

VERSION = 1

FACES_MAX_PAR_TROU = 6000      # au-dela, l'espacement du semis grossit (un grand trou est bouche plus grossierement, jamais refuse)
MARGE_SEMIS = 0.75             # les points du semis restent a 0,75 espacement du pourtour (pas de triangle sliver contre le pourtour)


# --------------------------------------------------------------------------------------------------------------------------------------------
# Voisinage du maillage existant (collier)
# --------------------------------------------------------------------------------------------------------------------------------------------
class Collier:
    """Graphe des sommets SOUDES (groupes) du maillage existant : pour chaque groupe, ses voisins et leur position."""

    def __init__(self, V, prep):
        from scipy.sparse import coo_matrix
        nG = prep['nG']
        self.groupe = prep['groupe']
        pos = np.zeros((nG, 3))
        pos[self.groupe] = V
        self.pos = pos
        ea, eb = prep['ea'], prep['eb']
        m = coo_matrix((np.ones(len(ea), dtype=np.int8), (ea, eb)), shape=(nG, nG))
        m = (m + m.T).tocsr()
        m.data[:] = 1
        self.indptr, self.indices = m.indptr, m.indices

    def voisins(self, g):
        return self.indices[self.indptr[g]:self.indptr[g + 1]]


# --------------------------------------------------------------------------------------------------------------------------------------------
# Parametrage elliptique et semis
# --------------------------------------------------------------------------------------------------------------------------------------------
def _perimetre_ellipse(a, b):
    h = ((a - b) / (a + b)) ** 2
    return math.pi * (a + b) * (1.0 + 3.0 * h / (10.0 + math.sqrt(4.0 - 3.0 * h)))


def _ellipse(R):
    """Pose les points R (n, 3), dans l'ordre, sur une ellipse du plan. Rend (points2d (n, 2), a, b)."""
    n = len(R)
    suivant = np.roll(R, -1, axis=0)
    cordes = np.linalg.norm(suivant - R, axis=1)
    L = float(cordes.sum())
    centre = R.mean(axis=0)
    _, _, vt = np.linalg.svd(R - centre, full_matrices=False)
    P = (R - centre) @ vt[:2].T
    w1 = float(P[:, 0].max() - P[:, 0].min())
    w2 = float(P[:, 1].max() - P[:, 1].min())
    rho = min(1.0, max(0.12, w2 / w1)) if w1 > 0 else 1.0
    # demi-axes : perimetre de l'ellipse = perimetre reel du pourtour
    a = L / _perimetre_ellipse(1.0, rho)
    b = rho * a
    # abscisse curviligne sur l'ellipse (table), puis inversion pour les fractions de longueur du pourtour
    N = 4096
    t = np.linspace(0.0, 2.0 * math.pi, N + 1)
    dx = -a * np.sin(t)
    dy = b * np.cos(t)
    ds = np.sqrt(dx * dx + dy * dy)
    s = np.concatenate([[0.0], np.cumsum(0.5 * (ds[1:] + ds[:-1]) * (t[1] - t[0]))])
    s /= s[-1]
    frac = np.concatenate([[0.0], np.cumsum(cordes)])[:n] / L
    theta = np.interp(frac, s, t)
    return np.stack([a * np.cos(theta), b * np.sin(theta)], axis=1), a, b, L


def _semis(a, b, h):
    """Semis hexagonal d'espacement h a l'interieur de l'ellipse reduite de MARGE_SEMIS x h. Rend (q, 2)."""
    ap, bp = a - MARGE_SEMIS * h, b - MARGE_SEMIS * h
    if ap <= 0 or bp <= 0:
        return np.zeros((0, 2))
    nj = int(bp / (h * math.sqrt(3.0) / 2.0)) + 1
    ni = int(ap / h) + 2
    pts = []
    for j in range(-nj, nj + 1):
        y = j * h * math.sqrt(3.0) / 2.0
        decal = 0.5 * h if (j % 2) else 0.0
        xs = np.arange(-ni, ni + 1) * h + decal
        pts.append(np.stack([xs, np.full_like(xs, y)], axis=1))
    P = np.vstack(pts)
    garde = (P[:, 0] / ap) ** 2 + (P[:, 1] / bp) ** 2 <= 1.0
    return P[garde]


def _trianguler_plan(P2, n):
    """Delaunay des points du plan (les n premiers = pourtour, dans l'ordre). Rend des triangles (m, 3) orientes anti-horaire."""
    from scipy.spatial import Delaunay
    tri = Delaunay(P2, qhull_options='Qbb Qc Qz Q12').simplices
    A, B, C = P2[tri[:, 0]], P2[tri[:, 1]], P2[tri[:, 2]]
    aire2 = (B[:, 0] - A[:, 0]) * (C[:, 1] - A[:, 1]) - (B[:, 1] - A[:, 1]) * (C[:, 0] - A[:, 0])
    tri = np.where((aire2 < 0)[:, None], tri[:, [0, 2, 1]], tri)
    return tri[np.abs(aire2) > 0]


# --------------------------------------------------------------------------------------------------------------------------------------------
# Lissage
# --------------------------------------------------------------------------------------------------------------------------------------------
def _adjacence(tri, nloc):
    from scipy.sparse import coo_matrix
    e = np.concatenate([tri[:, [0, 1]], tri[:, [1, 2]], tri[:, [2, 0]]])
    e = np.unique(np.sort(e, axis=1), axis=0)
    i = np.concatenate([e[:, 0], e[:, 1]])
    j = np.concatenate([e[:, 1], e[:, 0]])
    return coo_matrix((np.ones(len(i)), (i, j)), shape=(nloc, nloc)).tocsr()


def _lisser(tri, n, X_ring, collier_somme, collier_nb, q, ordre=2):
    """Positions des q sommets interieurs. Minimise la courbure (ordre 2) ou l'aire (ordre 1) avec le pourtour et le collier fixes."""
    from scipy.sparse import diags, identity
    from scipy.sparse.linalg import spsolve
    nloc = n + q
    A = _adjacence(tri, nloc)
    deg = np.asarray(A.sum(axis=1)).ravel() + collier_nb
    Dinv = diags(1.0 / deg)
    L = (identity(nloc, format='csr') - Dinv @ A).tocsr()
    k = X_ring.shape[1]
    c = np.zeros((nloc, k))
    c[:n] = collier_somme
    b_const = Dinv @ c
    LR = L[:, :n]
    LI = L[:, n:]
    b = b_const - LR @ X_ring
    if ordre >= 2:
        M = (LI.T @ LI).tocsc()
        rhs = LI.T @ b
    else:
        LII = L[n:, n:]
        M = LII.tocsc()
        rhs = b[n:]
    M = M + diags(np.full(q, 1e-12)).tocsc()
    X = spsolve(M, rhs)
    return np.asarray(X).reshape(q, -1)


def _harmonique(tri, n, valeurs_ring, q):
    """Interpolation harmonique (laplacien ombrelle, bord impose) de valeurs (n, k) sur les q sommets interieurs."""
    from scipy.sparse import diags, identity
    from scipy.sparse.linalg import spsolve
    nloc = n + q
    A = _adjacence(tri, nloc)
    deg = np.asarray(A.sum(axis=1)).ravel()
    L = (identity(nloc, format='csr') - diags(1.0 / deg) @ A).tocsr()
    LII = L[n:, n:].tocsc()
    rhs = -(L[n:, :n] @ valeurs_ring)
    X = spsolve(LII, rhs)
    return np.asarray(X).reshape(q, -1)


# --------------------------------------------------------------------------------------------------------------------------------------------
# Methode principale : maillage du pourtour DANS SON PLAN MOYEN (triangulation de Delaunay sous contraintes), puis hauteurs lissees
# --------------------------------------------------------------------------------------------------------------------------------------------
def _orient2(P, a, b, c):
    return (P[b, 0] - P[a, 0]) * (P[c, 1] - P[a, 1]) - (P[b, 1] - P[a, 1]) * (P[c, 0] - P[a, 0])


def _aire_signee(P2):
    x, y = P2[:, 0], P2[:, 1]
    return 0.5 * float((x * np.roll(y, -1) - np.roll(x, -1) * y).sum())


def _polygone_simple(P2):
    """Vrai si le polygone (sommets dans l'ordre) ne se recoupe pas lui-meme et n'a pas deux sommets confondus."""
    n = len(P2)
    A = P2
    B = np.roll(P2, -1, axis=0)
    echelle = float(np.abs(P2 - P2.mean(axis=0)).max()) or 1.0
    from scipy.spatial import cKDTree
    if len(cKDTree(P2).query_pairs(1e-9 * echelle)):
        return False
    pas = max(1, 4_000_000 // max(n, 1))
    idx = np.arange(n)

    def o(p, q, r):
        return (q[..., 0] - p[..., 0]) * (r[..., 1] - p[..., 1]) - (q[..., 1] - p[..., 1]) * (r[..., 0] - p[..., 0])
    for d in range(0, n, pas):
        i = idx[d:d + pas]
        a1, b1 = A[i][:, None, :], B[i][:, None, :]
        a2, b2 = A[None, :, :], B[None, :, :]
        o1, o2 = o(a1, b1, a2), o(a1, b1, b2)
        o3, o4 = o(a2, b2, a1), o(a2, b2, b1)
        croise = (o1 * o2 < 0) & (o3 * o4 < 0)
        if croise.any():
            return False
    return True


def _dans_polygone(P2, pts):
    """Booleen par point : a l'interieur du polygone (nombre de croisements)."""
    sortie = np.zeros(len(pts), dtype=bool)
    n = len(P2)
    x1, y1 = P2[:, 0][None, :], P2[:, 1][None, :]
    x2, y2 = np.roll(P2[:, 0], -1)[None, :], np.roll(P2[:, 1], -1)[None, :]
    pas = max(1, 4_000_000 // max(n, 1))
    for k in range(0, len(pts), pas):
        x, y = pts[k:k + pas, 0][:, None], pts[k:k + pas, 1][:, None]
        cond = (y1 > y) != (y2 > y)
        with np.errstate(divide='ignore', invalid='ignore'):
            xi = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
        sortie[k:k + pas] = (cond & (x < xi)).sum(axis=1) % 2 == 1
    return sortie


def _distance_au_bord(P2, pts):
    n = len(P2)
    A = P2
    d_ = np.roll(P2, -1, axis=0) - P2
    l2 = np.maximum((d_ * d_).sum(axis=1), 1e-300)
    sortie = np.full(len(pts), np.inf)
    pas = max(1, 4_000_000 // max(n, 1))
    for k in range(0, len(pts), pas):
        p = pts[k:k + pas][:, None, :]
        t = np.clip(((p - A[None]) * d_[None]).sum(axis=2) / l2[None], 0.0, 1.0)
        proj = A[None] + t[..., None] * d_[None]
        sortie[k:k + pas] = np.sqrt(((p - proj) ** 2).sum(axis=2)).min(axis=1)
    return sortie


def _semis_polygone(P2, h):
    lo, hi = P2.min(axis=0), P2.max(axis=0)
    dy = h * math.sqrt(3.0) / 2.0
    ys = np.arange(lo[1] + 0.5 * dy, hi[1], dy)
    pts = []
    for j, y in enumerate(ys):
        xs = np.arange(lo[0] + 0.25 * h + (0.5 * h if (j % 2) else 0.0), hi[0], h)
        pts.append(np.stack([xs, np.full_like(xs, y)], axis=1))
    if not pts:
        return np.zeros((0, 2))
    C = np.vstack(pts)
    if not len(C):
        return C
    C = C[_dans_polygone(P2, C)]
    if not len(C):
        return C
    return C[_distance_au_bord(P2, C) >= MARGE_SEMIS * h]


def _cdt(P, n, tri0):
    """Triangulation de Delaunay SOUS CONTRAINTES (aretes du pourtour 0..n-1 cycliques) par retournement d'aretes (Sloan 1993), puis on ne garde que
    les triangles interieurs. P : points du plan (les n premiers = pourtour). Rend (m, 3) anti-horaire, ou None si une contrainte ne se retablit pas."""
    T = []
    for a, b, c in tri0.tolist():
        if _orient2(P, a, b, c) < 0:
            b, c = c, b
        T.append([a, b, c])
    he = {}
    for t, (a, b, c) in enumerate(T):
        he[(a, b)] = t
        he[(b, c)] = t
        he[(c, a)] = t

    def croise(a, b, u, v):
        return _orient2(P, a, b, u) * _orient2(P, a, b, v) < 0 and _orient2(P, u, v, a) * _orient2(P, u, v, b) < 0

    def tiers(t, u, v):
        for x in T[t]:
            if x != u and x != v:
                return x

    def o(p, q, r):
        return (P[q, 0] - P[p, 0]) * (P[r, 1] - P[p, 1]) - (P[q, 1] - P[p, 1]) * (P[r, 0] - P[p, 0])

    for k in range(n):
        a, b = k, (k + 1) % n
        if (a, b) in he or (b, a) in he:
            continue
        aretes = np.array([e for e in he if e[0] < e[1]], dtype=np.int64)
        U, W = aretes[:, 0], aretes[:, 1]
        A_ = np.full_like(U, a)
        B_ = np.full_like(U, b)
        c1 = o(A_, B_, U) * o(A_, B_, W) < 0
        c2 = o(U, W, A_) * o(U, W, B_) < 0
        file = [(int(u), int(v)) for u, v in aretes[c1 & c2]]
        garde = 0
        while file:
            garde += 1
            if garde > 20000:
                return None
            u, v = file.pop(0)
            t1, t2 = he.get((u, v)), he.get((v, u))
            if t1 is None or t2 is None:
                continue
            c, d = tiers(t1, u, v), tiers(t2, u, v)
            if croise(c, d, u, v):
                for e in ((u, v), (v, c), (c, u), (v, u), (u, d), (d, v)):
                    he.pop(e, None)
                T[t1] = [u, d, c]
                T[t2] = [d, v, c]
                for t in (t1, t2):
                    x, y, z = T[t]
                    he[(x, y)] = t
                    he[(y, z)] = t
                    he[(z, x)] = t
                if croise(a, b, c, d):
                    file.append((c, d))
            else:
                file.append((u, v))
        if (a, b) not in he and (b, a) not in he:
            return None
    T = np.array(T, dtype=np.int64)
    centres = P[T].mean(axis=1)
    dedans = _dans_polygone(P[:n], centres)
    return T[dedans]


def _remplir_plan(R, collier, groupes_ring, ordre, faces_max):
    """Rustine par maillage du plan moyen. Rend (X, tri, q, details) ou None (pourtour qui se recoupe une fois projete : voir _remplir_ellipse)."""
    n = len(R)
    c = R.mean(axis=0)
    _, _, vt = np.linalg.svd(R - c, full_matrices=False)
    e1, e2 = vt[0], vt[1]
    e3 = np.cross(e1, e2)
    base = np.stack([e1, e2, e3])
    loc = (R - c) @ base.T                       # (n, 3) : u, v, hauteur
    uv = loc[:, :2]
    if not _polygone_simple(uv):
        return None
    L = float(np.linalg.norm(np.roll(R, -1, axis=0) - R, axis=1).sum())
    h = L / n
    aire = abs(_aire_signee(uv))
    m_est = aire / (0.866 * h * h)
    if m_est > faces_max / 2.0:
        h *= math.sqrt(m_est / (faces_max / 2.0))
    S = _semis_polygone(uv, h)
    q = len(S)
    P2 = np.vstack([uv, S]) if q else uv
    from scipy.spatial import Delaunay
    try:
        tri0 = Delaunay(P2, qhull_options='Qbb Qc Qz Q12').simplices
        tri = _cdt(P2, n, tri0)
    except Exception:
        return None
    if tri is None or len(tri) == 0:
        return None
    if _aire_signee(uv) < 0:
        tri = tri[:, [0, 2, 1]]
    ordre_eff = ordre
    if q:
        # hauteurs : moindres carres sur le laplacien (ordre 2 : tangent au voisinage ; ordre 1 : membrane), le collier fixe
        ring_set = set(int(g) for g in groupes_ring)
        c_somme = np.zeros((n, 1))
        c_nb = np.zeros(n)
        pentes = []
        for k in range(n):
            vs = [int(v) for v in collier.voisins(int(groupes_ring[k])) if int(v) not in ring_set]
            if vs:
                pv = collier.pos[vs]
                wv = (pv - c) @ e3
                c_somme[k, 0] = wv.sum()
                c_nb[k] = len(vs)
                dh = np.linalg.norm((pv - c) @ np.stack([e1, e2]).T - uv[k], axis=1)
                pentes.extend((np.abs(wv - loc[k, 2]) / np.maximum(dh, 1e-12)).tolist())
        if pentes and float(np.median(pentes)) > 1.2:          # surface presque verticale dans ce plan (bout de tube) : membrane sans collier
            ordre_eff = 1
            c_somme[:] = 0.0
            c_nb[:] = 0.0
        w = _lisser(tri, n, loc[:, 2:3], c_somme, np.concatenate([c_nb, np.zeros(q)]), q, ordre_eff)
        Xi = c + S[:, 0:1] * e1 + S[:, 1:2] * e2 + w * e3
    else:
        Xi = np.zeros((0, 3))
    X = np.vstack([R, Xi])
    return X, tri, q, {'methode': 'plan', 'ordre': ordre_eff, 'p2': P2}


# --------------------------------------------------------------------------------------------------------------------------------------------
# Methode generale (Liepa 2003) : triangulation de poids minimal du pourtour EN 3D, raffinement, retournements, lissage
# --------------------------------------------------------------------------------------------------------------------------------------------
PENALITE_DIEDRE = 6.0          # poids du pli entre deux triangles voisins dans la programmation dynamique
LIEPA_N_MAX = 400              # au-dela, la programmation dynamique (n^3) coute trop : repli elliptique


def _dp_liepa(P, rimN):
    """Triangulation de poids minimal du polygone P (dans l'ordre de la rustine) : somme des aires, majoree par le pli entre triangles voisins
    (et avec la face du voisinage sur les aretes du pourtour : rimN[m] = normale de la face existante qui porte l'arete P[m] -> P[m+1]).
    Rend la liste des (i, k, j), i < k < j, orientes comme P."""
    n = len(P)
    W = np.zeros((n, n))
    K = np.full((n, n), -1, dtype=np.int64)
    NT = np.zeros((n, n, 3))
    for m in range(n - 1):
        NT[m, m + 1] = rimN[m]
    for longueur in range(2, n):
        for i in range(0, n - longueur):
            j = i + longueur
            ks = np.arange(i + 1, j)
            nrm = np.cross(P[ks] - P[i], P[j] - P[i])
            n2 = np.linalg.norm(nrm, axis=1)
            nn = nrm / np.maximum(n2[:, None], 1e-300)
            gauche = NT[i, ks]
            droite = NT[ks, j]
            cg = np.where(np.linalg.norm(gauche, axis=1) > 0, (nn * gauche).sum(axis=1), 1.0)
            cd = np.where(np.linalg.norm(droite, axis=1) > 0, (nn * droite).sum(axis=1), 1.0)
            cout = W[i, ks] + W[ks, j] + 0.5 * n2 * (1.0 + PENALITE_DIEDRE * (np.clip(1.0 - cg, 0, 2) + np.clip(1.0 - cd, 0, 2)))
            kb = int(np.argmin(cout))
            W[i, j] = cout[kb]
            K[i, j] = ks[kb]
            NT[i, j] = nn[kb]
    sortie = []
    pile = [(0, n - 1)]
    while pile:
        i, j = pile.pop()
        if j - i < 2:
            continue
        k = int(K[i, j])
        sortie.append((i, k, j))
        pile.append((k, j))
        pile.append((i, k))
    return sortie


def _remplir_liepa(R, rimN, collier, groupes_ring, ordre, faces_max):
    """Rustine par la methode de Liepa. Rend (X, tri, q, details) ; jamais d'echec."""
    n = len(R)
    tri0 = _dp_liepa(R, rimN)
    cap = int(faces_max // 2)
    cordes = np.linalg.norm(np.roll(R, -1, axis=0) - R, axis=1)
    sigma = [float((cordes[k] + cordes[k - 1]) / 2.0) for k in range(n)]
    X = [R[k].copy() for k in range(n)]
    T = [[a, b, c] for a, b, c in tri0]
    he = {}
    for t, (a, b, c) in enumerate(T):
        he[(a, b)] = t
        he[(b, c)] = t
        he[(c, a)] = t

    def pose(t):
        a, b, c = T[t]
        he[(a, b)] = t
        he[(b, c)] = t
        he[(c, a)] = t

    def normale(a, b, c):
        return np.cross(X[b] - X[a], X[c] - X[a])

    def angle(c, u, v):
        x, y = X[u] - X[c], X[v] - X[c]
        d = float(np.linalg.norm(x) * np.linalg.norm(y))
        return math.acos(max(-1.0, min(1.0, float(x @ y) / d))) if d > 0 else 0.0

    def retourner(passes=8):
        for _ in range(passes):
            change = 0
            for (u, v) in [e for e in list(he) if e[0] < e[1]]:
                t1, t2 = he.get((u, v)), he.get((v, u))
                if t1 is None or t2 is None:
                    continue
                c = next(x for x in T[t1] if x != u and x != v)
                d = next(x for x in T[t2] if x != u and x != v)
                if c == d or (c, d) in he or (d, c) in he:
                    continue
                if angle(c, u, v) + angle(d, u, v) <= math.pi + 1e-9:
                    continue
                n1, n2 = normale(u, d, c), normale(d, v, c)
                ancien = normale(u, v, c) + normale(v, u, d)
                if float(n1 @ ancien) <= 0 or float(n2 @ ancien) <= 0:
                    continue
                for e in ((u, v), (v, c), (c, u), (v, u), (u, d), (d, v)):
                    he.pop(e, None)
                T[t1] = [u, d, c]
                T[t2] = [d, v, c]
                pose(t1)
                pose(t2)
                change += 1
            if not change:
                break

    alpha = math.sqrt(2.0)
    for cycle in range(3):
        for _ in range(30):
            nt = len(T)
            coupe = 0
            for t in range(nt):
                if len(X) - n >= cap:
                    break
                a, b, c = T[t]
                p = (X[a] + X[b] + X[c]) / 3.0
                sp = (sigma[a] + sigma[b] + sigma[c]) / 3.0
                ok = True
                for v in (a, b, c):
                    dv = alpha * float(np.linalg.norm(p - X[v]))
                    if not (dv > sp and dv > sigma[v]):
                        ok = False
                        break
                if not ok:
                    continue
                ip = len(X)
                X.append(p)
                sigma.append(sp)
                T[t] = [a, b, ip]
                T.append([b, c, ip])
                T.append([c, a, ip])
                pose(t)
                pose(len(T) - 2)
                pose(len(T) - 1)
                coupe += 1
            retourner()
            if not coupe:
                break
        q = len(X) - n
        if q == 0:
            break
        # lissage de toutes les positions interieures (le pourtour et le collier fixes)
        tri = np.array(T, dtype=np.int64)
        ring_set = set(int(g) for g in groupes_ring)
        c_somme = np.zeros((n, 3))
        c_nb = np.zeros(n)
        for k in range(n):
            vs = [int(v) for v in collier.voisins(int(groupes_ring[k])) if int(v) not in ring_set]
            if vs:
                c_somme[k] = collier.pos[vs].sum(axis=0)
                c_nb[k] = len(vs)
        nb = np.concatenate([c_nb, np.zeros(q)])
        Xi = _lisser(tri, n, R, c_somme, nb, q, ordre)
        if not np.isfinite(Xi).all():
            Xi = _lisser(tri, n, R, c_somme, nb, q, 1)
        for k in range(q):
            X[n + k] = Xi[k]
        retourner()
    q = len(X) - n
    return np.array(X), np.array(T, dtype=np.int64), q, {'methode': 'liepa', 'ordre': ordre}


# --------------------------------------------------------------------------------------------------------------------------------------------
# Un trou
# --------------------------------------------------------------------------------------------------------------------------------------------
def _qualite(Xloc, tri):
    """(aire minimale relative, plus grand angle diedre entre triangles voisins en degres, proportion de triangles d'aire quasi nulle)."""
    A, B, C = Xloc[tri[:, 0]], Xloc[tri[:, 1]], Xloc[tri[:, 2]]
    N = np.cross(B - A, C - A)
    aire = 0.5 * np.linalg.norm(N, axis=1)
    moy = float(aire.mean()) if len(aire) else 0.0
    Nn = N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-300)
    # triangles voisins par arete
    e = np.concatenate([tri[:, [0, 1]], tri[:, [1, 2]], tri[:, [2, 0]]])
    f = np.tile(np.arange(len(tri)), 3)
    cle = np.minimum(e[:, 0], e[:, 1]).astype(np.int64) * (int(tri.max()) + 1) + np.maximum(e[:, 0], e[:, 1])
    ordre = np.argsort(cle, kind='stable')
    cle_o, f_o = cle[ordre], f[ordre]
    doubles = np.nonzero(cle_o[1:] == cle_o[:-1])[0]
    if len(doubles):
        d = np.einsum('ij,ij->i', Nn[f_o[doubles]], Nn[f_o[doubles + 1]])
        pire = float(np.degrees(np.arccos(np.clip(d.min(), -1.0, 1.0))))
    else:
        pire = 0.0
    return (float(aire.min() / moy) if moy > 0 else 0.0), pire, float((aire < 1e-3 * moy).mean()) if moy > 0 else 1.0


def _remplir_ellipse(R, collier, groupes_ring, ordre, faces_max):
    """Repli quand le pourtour se recoupe une fois projete dans son plan : parametrage elliptique (voir l'en-tete). Peut plisser sur un pourtour tres
    irregulier ; le rapport de qualite le dit."""
    n = len(R)
    P2, a, b, L = _ellipse(R)
    h = L / n
    m_est = math.pi * a * b / (0.866 * h * h)
    if m_est > faces_max / 2.0:
        h *= math.sqrt(m_est / (faces_max / 2.0))
    S = _semis(a, b, h)
    q = len(S)
    tri = _trianguler_plan(np.vstack([P2, S]) if q else P2, n)
    ordre_eff = ordre
    if not q:
        return R.copy(), tri, 0, {'methode': 'ellipse', 'ordre': ordre_eff}
    ring_set = set(int(g) for g in groupes_ring)
    c_somme = np.zeros((n, 3))
    c_nb = np.zeros(n)
    for k in range(n):
        vs = [int(v) for v in collier.voisins(int(groupes_ring[k])) if int(v) not in ring_set]
        if vs:
            c_somme[k] = collier.pos[vs].sum(axis=0)
            c_nb[k] = len(vs)
    nb = np.concatenate([c_nb, np.zeros(q)])
    best = None
    for o in ((ordre, 1) if ordre >= 2 else (1,)):
        Xi = _lisser(tri, n, R, c_somme, nb, q, o)
        X = np.vstack([R, Xi])
        amin, diedre, nul = _qualite(X, tri)
        if np.isfinite(X).all() and (best is None or diedre < best[1]):
            best = (X, diedre, o)
        if diedre <= 100.0 and nul <= 0.02:
            break
    return best[0], tri, q, {'methode': 'ellipse', 'ordre': best[2]}


def _normales_de_groupe(V, F, prep):
    """Normale (unitaire, ponderee par l'aire) de chaque groupe de sommets soudes."""
    N = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    acc = np.zeros((prep['nG'], 3))
    g = prep['groupe']
    for k in range(3):
        np.add.at(acc, g[F[:, k]], N)
    ln = np.linalg.norm(acc, axis=1, keepdims=True)
    return acc / np.maximum(ln, 1e-300)


def boucher_un(R, Nr, collier, groupes_ring, ordre=2, faces_max=FACES_MAX_PAR_TROU, Ng_ring=None):
    """Geometrie de la rustine d'UN trou.
    R : (n, 3) sommets du pourtour dans l'ordre de la RUSTINE ; Nr (n, 3) normales des copies du pourtour ou None ; groupes_ring : groupes soudes du
    pourtour ; Ng_ring : normales du voisinage (pour la programmation dynamique).
    Rend un dict : X (n+q, 3, pourtour d'abord), tri (m, 3), q, methode, ordre, qualite, p2 (coordonnees planes de chaque sommet, ou None), normales."""
    n = len(R)
    p2 = None
    if n == 3:
        tri = np.array([[0, 1, 2]])
        X, q, meta = R.copy(), 0, {'methode': 'triangle', 'ordre': 0}
    elif n == 4:
        d02 = np.linalg.norm(R[0] - R[2])
        d13 = np.linalg.norm(R[1] - R[3])
        tri = np.array([[0, 1, 2], [0, 2, 3]]) if d02 <= d13 else np.array([[0, 1, 3], [1, 2, 3]])
        X, q, meta = R.copy(), 0, {'methode': 'quad', 'ordre': 0}
    else:
        res = _remplir_plan(R, collier, groupes_ring, ordre, faces_max)
        if res is None and n <= LIEPA_N_MAX:
            if Ng_ring is not None:
                rn = Ng_ring + np.roll(Ng_ring, -1, axis=0)
                ln = np.linalg.norm(rn, axis=1, keepdims=True)
                rimN = np.where(ln > 0, rn / np.maximum(ln, 1e-300), 0.0)
            else:
                rimN = np.zeros((n, 3))
            res = _remplir_liepa(R, rimN, collier, groupes_ring, ordre, faces_max)
        if res is None:
            res = _remplir_ellipse(R, collier, groupes_ring, ordre, faces_max)
        X, tri, q, meta = res
        p2 = meta.get('p2')
    sortie = {'n': n, 'q': q, 'X': X, 'tri': tri, 'methode': meta['methode'], 'ordre': meta['ordre'], 'p2': p2, 'uv_mode': None, 'dedouble': False}
    if len(tri) > 1:
        amin, diedre, nul = _qualite(X, tri)
        sortie['qualite'] = {'aire_min': amin, 'diedre_max': diedre, 'nuls': nul}
    # normales : pourtour = celles du voisinage (pas de ligne au raccord) ; interieur = moyenne des faces de la rustine
    A, B, C = X[tri[:, 0]], X[tri[:, 1]], X[tri[:, 2]]
    fn = np.cross(B - A, C - A)
    acc = np.zeros((len(X), 3))
    for k in range(3):
        np.add.at(acc, tri[:, k], fn)
    ln = np.linalg.norm(acc, axis=1, keepdims=True)
    ln[ln == 0] = 1.0
    Nn = acc / ln
    if Nr is not None:
        Nn[:n] = Nr
    sortie['normales'] = Nn
    return sortie


def _dedoubler_constante(r, UVr, R):
    """Repli sans texte neuf : chaque triangle prend l'UV du sommet du pourtour le plus proche de son centre (une couleur reelle du voisinage), ses
    sommets sont dedoubles (UV constante par triangle)."""
    from scipy.spatial import cKDTree
    X, tri, Nn = r['X'], r['tri'], r['normales']
    _, proche = cKDTree(R).query(X[tri].mean(axis=1))
    r['X'] = X[tri.ravel()]
    r['normales'] = Nn[tri.ravel()]
    r['tri'] = np.arange(3 * len(tri), dtype=np.int64).reshape(-1, 3)
    r['uv'] = np.repeat(UVr[proche], 3, axis=0)
    r['q'] = len(r['X']) - r['n']
    r['uv_mode'] = 'constante'
    r['dedouble'] = True
    r['sommet_source'] = None


# --------------------------------------------------------------------------------------------------------------------------------------------
# Texture : un ILOT NEUF par rustine, pose dans un espace libre de l'atlas
# --------------------------------------------------------------------------------------------------------------------------------------------
# POURQUOI. Sur un atlas produit par la generation (TRELLIS : 460 000 sommets, ilots de quelques triangles), le pourtour d'un trou de 30 aretes
# traverse CHAQUE FOIS plusieurs ilots a des milliers de pixels les uns des autres (mesure sur 14 trous : saut d'UV de 300 a 2 000 fois la normale,
# 14 trous sur 14). Interpoler des UV a travers ces sauts etire la texture sur tout l'atlas. La rustine recoit donc SON ilot : UV planes (les
# coordonnees du plan moyen, a la densite de texels du maillage), couleur = interpolation harmonique des couleurs reelles du pourtour, ecrite dans
# une zone de l'atlas qu'AUCUNE face existante n'occupe (grille d'occupation conservatrice + marge d'une cellule).
GRILLE = 1024                  # l'atlas est decoupe en GRILLE x GRILLE cellules pour chercher de la place
ILOT_PAD = 3                   # pixels de debordement de l'ilot (evite les franges des mipmaps)
ILOT_MAX_PX = 384              # cote maximal d'un ilot en pixels (la densite baisse au-dela)
ILOTS_MAX = 600                # au-dela, les rustines suivantes prennent le repli « UV constante par triangle »
CELLULES_MARGE = 1


class Occupation:
    """Grille conservatrice des cellules de l'atlas utilisees par au moins une face existante (dilatee d'une cellule)."""

    def __init__(self, UV, F, N=GRILLE):
        self.N = N
        tri = np.asarray(UV, dtype=np.float64)[F]                    # (m, 3, 2)
        u = np.mod(tri[..., 0], 1.0)
        v = np.mod(tri[..., 1], 1.0)
        # un triangle qui franchit le bord de l'atlas (UV hors de [0, 1]) : on le recoupe a l'emballage, on marque aussi les deux cotes
        col = np.minimum((u * N).astype(np.int64), N - 1)
        row = np.minimum(((1.0 - v) * N).astype(np.int64), N - 1)
        occ = np.zeros((N, N), dtype=bool)
        c0, c1 = col.min(axis=1), col.max(axis=1)
        r0, r1 = row.min(axis=1), row.max(axis=1)
        span = np.maximum(c1 - c0, r1 - r0)
        petit = span <= 3
        idx = np.nonzero(petit)[0]
        for dy in range(4):
            for dx in range(4):
                ok = (c0[idx] + dx <= c1[idx]) & (r0[idx] + dy <= r1[idx])
                occ[r0[idx][ok] + dy, c0[idx][ok] + dx] = True
        for t in np.nonzero(~petit)[0]:
            if (tri[t, :, 0].max() - tri[t, :, 0].min() > 0.5) or (tri[t, :, 1].max() - tri[t, :, 1].min() > 0.5):
                occ[:, :] = True                                      # triangle qui enjambe l'atlas : on ne pose rien, par prudence
                break
            occ[r0[t]:r1[t] + 1, c0[t]:c1[t] + 1] = True
        d = occ.copy()
        d[1:, :] |= occ[:-1, :]
        d[:-1, :] |= occ[1:, :]
        e = d.copy()
        e[:, 1:] |= d[:, :-1]
        e[:, :-1] |= d[:, 1:]
        self.occ = e
        self.compte = int(e.sum())

    def allouer(self, wc, hc):
        """Premiere zone libre de wc x hc cellules (bords de l'atlas exclus). Rend (colonne, ligne) ou None, et la marque occupee."""
        N = self.N
        if wc >= N - 2 or hc >= N - 2:
            return None
        I = np.zeros((N + 1, N + 1), dtype=np.int32)
        I[1:, 1:] = np.cumsum(np.cumsum(self.occ, axis=0, dtype=np.int32), axis=1, dtype=np.int32)
        S = I[hc:, wc:] - I[:-hc, wc:] - I[hc:, :-wc] + I[:-hc, :-wc]       # (N - hc + 1, N - wc + 1)
        S[0, :] = 1
        S[:, 0] = 1
        S[-1, :] = 1
        S[:, -1] = 1
        libres = np.flatnonzero(S == 0)
        if not len(libres):
            return None
        r, c = divmod(int(libres[0]), S.shape[1])
        self.occ[r:r + hc, c:c + wc] = True
        return c, r


def _param_ilot(r, R, uv_plan=None):
    """Coordonnees 2D (n+q, 2) d'une rustine pour son ilot : coordonnees planes si la rustine en a (isometrique), sinon parametrage de Tutte sur une
    ellipse (convexe : injectif quel que soit le maillage), mis a l'echelle de l'aire reelle."""
    n, q, X, tri = r['n'], r['q'], r['X'], r['tri']
    if r['p2'] is not None:
        P = np.asarray(r['p2'], dtype=np.float64)
    else:
        P2, a, b, L = _ellipse(R)
        P = np.vstack([P2, _harmonique(tri, n, P2, q)]) if q else P2
        A3 = 0.5 * np.linalg.norm(np.cross(X[tri[:, 1]] - X[tri[:, 0]], X[tri[:, 2]] - X[tri[:, 0]]), axis=1).sum()
        A2 = 0.5 * np.abs((P[tri[:, 1], 0] - P[tri[:, 0], 0]) * (P[tri[:, 2], 1] - P[tri[:, 0], 1])
                          - (P[tri[:, 1], 1] - P[tri[:, 0], 1]) * (P[tri[:, 2], 0] - P[tri[:, 0], 0])).sum()
        if A2 > 0:
            P = P * math.sqrt(A3 / A2)
    return P


def _peindre_ilot(tex, uv_tri, cols, rect):
    """Peint dans `tex` (h, w, c) les triangles uv_tri (m, 3, 2) (UV) avec les couleurs par sommet cols (m, 3, c), DANS le rectangle rect = (x0, y0, x1, y1)
    de pixels seulement ; les pixels du rectangle hors des triangles prennent la couleur du plus proche pixel peint (debordement)."""
    from scipy import ndimage
    h, w = tex.shape[:2]
    x0, y0, x1, y1 = rect
    rw, rh = x1 - x0, y1 - y0
    acc = np.zeros((rh, rw, tex.shape[2]))
    cov = np.zeros((rh, rw), dtype=bool)
    px = uv_tri[..., 0] * w - x0
    py = (1.0 - uv_tri[..., 1]) * h - y0
    for t in range(len(uv_tri)):
        xs, ys = px[t], py[t]
        ax, ay, bx, by, cx, cy = xs[0], ys[0], xs[1], ys[1], xs[2], ys[2]
        den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(den) < 1e-12:
            continue
        i0, i1 = max(0, int(math.floor(min(ax, bx, cx))) - 1), min(rw, int(math.ceil(max(ax, bx, cx))) + 1)
        j0, j1 = max(0, int(math.floor(min(ay, by, cy))) - 1), min(rh, int(math.ceil(max(ay, by, cy))) + 1)
        if i1 <= i0 or j1 <= j0:
            continue
        gx, gy = np.meshgrid(np.arange(i0, i1) + 0.5, np.arange(j0, j1) + 0.5)
        l1 = ((by - cy) * (gx - cx) + (cx - bx) * (gy - cy)) / den
        l2 = ((cy - ay) * (gx - cx) + (ax - cx) * (gy - cy)) / den
        l3 = 1.0 - l1 - l2
        m = (l1 >= -0.08) & (l2 >= -0.08) & (l3 >= -0.08)
        if not m.any():
            continue
        col = l1[..., None] * cols[t, 0] + l2[..., None] * cols[t, 1] + l3[..., None] * cols[t, 2]
        sub = acc[j0:j1, i0:i1]
        sub[m] = col[m]
        cov[j0:j1, i0:i1] |= m
    if not cov.any():
        return False
    idx = ndimage.distance_transform_edt(~cov, return_distances=False, return_indices=True)
    plein = acc[idx[0], idx[1]]
    if np.issubdtype(tex.dtype, np.integer):
        plein = np.clip(plein + 0.5, 0, np.iinfo(tex.dtype).max)
    tex[y0:y1, x0:x1] = plein.astype(tex.dtype)
    return True


def _echantillon(tex, UVr):
    h, w = tex.shape[:2]
    x = np.clip((np.mod(UVr[:, 0], 1.0) * w).astype(np.int64), 0, w - 1)
    y = np.clip(((1.0 - np.mod(UVr[:, 1], 1.0)) * h).astype(np.int64), 0, h - 1)
    return tex[y, x].astype(np.float64)


def poser_ilot(r, R, UVr, textures, occupation, densite):
    """Pose l'ilot de la rustine r : calcule ses UV, peint les textures. Rend True si l'ilot est pose (sinon la rustine garde le repli)."""
    n, q = r['n'], r['q']
    if not q:
        return False                       # un triangle ou un quadrilatere sans sommet interieur : le repli par triangle suffit
    P = _param_ilot(r, R)
    mini, maxi = P.min(axis=0), P.max(axis=0)
    etendue = maxi - mini
    if not (etendue > 0).all():
        return False
    ref = textures.get('baseColorTexture')
    if ref is None:
        ref = next(iter(textures.values()))
    H, W = ref.shape[:2]
    rho = densite
    cote = max(etendue) * rho
    if cote > ILOT_MAX_PX:
        rho *= ILOT_MAX_PX / cote
    px = (P - mini) * rho + ILOT_PAD                    # pixels de la texture de reference
    wpx = int(math.ceil(etendue[0] * rho)) + 2 * ILOT_PAD
    hpx = int(math.ceil(etendue[1] * rho)) + 2 * ILOT_PAD
    cell = W / occupation.N
    cellv = H / occupation.N
    wc = int(math.ceil(wpx / cell)) + 2 * CELLULES_MARGE
    hc = int(math.ceil(hpx / cellv)) + 2 * CELLULES_MARGE
    pos = occupation.allouer(wc, hc)
    if pos is None:
        return False
    x0 = (pos[0] + CELLULES_MARGE) * cell
    y0 = (pos[1] + CELLULES_MARGE) * cellv
    uv = np.empty((len(P), 2))
    uv[:, 0] = (x0 + px[:, 0]) / W
    uv[:, 1] = 1.0 - (y0 + px[:, 1]) / H
    tri = r['tri']
    uv_tri = uv[tri]
    for nom, tex in textures.items():
        th, tw = tex.shape[:2]
        rect = (int(math.floor(x0 * tw / W)), int(math.floor(y0 * th / H)),
                int(math.ceil((x0 + wpx) * tw / W)), int(math.ceil((y0 + hpx) * th / H)))
        rect = (max(0, rect[0]), max(0, rect[1]), min(tw, rect[2]), min(th, rect[3]))
        if rect[2] - rect[0] < 1 or rect[3] - rect[1] < 1:
            continue
        c = tex.shape[2]
        if nom == 'normalTexture':
            flat = np.array([128, 128, 255, 255][:c], dtype=np.float64)
            colsv = np.tile(flat, (len(P), 1))
        else:
            ring = _echantillon(tex, UVr)
            colsv = np.vstack([ring, _harmonique(tri, n, ring, q)])
        _peindre_ilot(tex, uv_tri, colsv[tri], rect)
    r['uv'] = uv
    r['uv_mode'] = 'ilot'
    r['ilot'] = (float(x0 / W), float(y0 / H), float(wpx / W), float(hpx / H))
    return True


def densite_de_texels(UV, F, V, W, echantillon=20000):
    """Pixels (de la texture de largeur W) par unite de longueur 3D : mediane sur un echantillon d'aretes."""
    rng = np.random.default_rng(12345)
    idx = rng.choice(len(F), size=min(echantillon, len(F)), replace=False)
    f = F[idx]
    d3 = np.linalg.norm(V[f[:, 1]] - V[f[:, 0]], axis=1)
    du = np.linalg.norm(UV[f[:, 1]] - UV[f[:, 0]], axis=1)
    ok = (d3 > 0) & (du > 0)
    if not ok.any():
        return None
    return float(np.median(du[ok] / d3[ok])) * W


# --------------------------------------------------------------------------------------------------------------------------------------------
# Tout le maillage
# --------------------------------------------------------------------------------------------------------------------------------------------
def boucher(V, F, analyse, prep, UV=None, normales=None, couleurs_sommets=None, ordre=2, textures=None):
    """Bouche tous les pourtours 'a_boucher' de l'analyse (bouchage_trous.analyser). Ne modifie ni V, ni F, ni UV, ni normales.
    `textures` : dict nom -> tableau numpy (h, w, c) ECRITURE AUTORISEE : les ilots neufs y sont peints (zones qu'aucune face n'occupe).
    Rend un dict : sommets (k, 3), uv (k, 2) | None, normales (k, 3) | None, couleurs (k, c) | None, faces (m, 3) (indices GLOBAUX), rustines, duree."""
    t0 = time.time()
    V = np.asarray(V, dtype=np.float64)
    F = np.asarray(F, dtype=np.int64)
    aBoucher = [b for b in analyse['boucles'] if b['categorie'] == 'a_boucher']
    base = len(V)
    sommets, uvs, nors, cols, faces, rustines = [], [], [], [], [], []
    if aBoucher:
        collier = Collier(V, prep)
        groupe = prep['groupe']
        Ng = _normales_de_groupe(V, F, prep)
        UVa = np.asarray(UV, dtype=np.float64) if UV is not None else None
        occupation, densite, nilots = None, None, 0
        if UVa is not None and textures:
            ref = textures.get('baseColorTexture')
            if ref is None:
                ref = next(iter(textures.values()))
            densite = densite_de_texels(UVa, F, V, ref.shape[1])
            if densite:
                occupation = Occupation(UVa, F)
        # les grandes rustines d'abord : elles ont le plus besoin de place
        ordre_traitement = sorted(range(len(aBoucher)), key=lambda k: -aBoucher[k]['n'])
        resultats = {}
        for k in ordre_traitement:
            item = aBoucher[k]
            debut = np.asarray(item['debut'], dtype=np.int64)[::-1]      # ordre de la rustine
            R = V[debut]
            Nr = np.asarray(normales, dtype=np.float64)[debut] if normales is not None else None
            r = boucher_un(R, Nr, collier, groupe[debut], ordre, Ng_ring=Ng[groupe[debut]])
            if UVa is not None:
                UVr = UVa[debut]
                if occupation is not None and nilots < ILOTS_MAX and poser_ilot(r, R, UVr, textures, occupation, densite):
                    nilots += 1
                else:
                    _dedoubler_constante(r, UVr, R)
            r['debut'] = debut
            resultats[k] = r
        for k in range(len(aBoucher)):
            r = resultats[k]
            n = r['n']
            sommets.append(r['X'])
            if r.get('uv') is not None:
                uvs.append(r['uv'])
            if normales is not None:
                nors.append(r['normales'])
            if couleurs_sommets is not None:
                cr = np.asarray(couleurs_sommets, dtype=np.float64)[r['debut']]
                cols.append(np.vstack([cr, _harmonique(r['tri'], n, cr, r['q'])]) if r['q'] else cr)
            faces.append(r['tri'] + base)
            rustines.append({'n': n, 'q': r['q'], 'faces': int(len(r['tri'])), 'uv_mode': r['uv_mode'], 'methode': r['methode'], 'ordre': r['ordre'],
                             'qualite': r.get('qualite'), 'ilot': r.get('ilot'), 'dedouble': r['dedouble']})
            base += len(r['X'])
    out = {
        'sommets': np.vstack(sommets) if sommets else np.zeros((0, 3)),
        'uv': np.vstack(uvs) if uvs else None,
        'normales': np.vstack(nors) if nors else None,
        'couleurs': np.vstack(cols) if cols else None,
        'faces': np.vstack(faces).astype(np.int64) if faces else np.zeros((0, 3), dtype=np.int64),
        'rustines': rustines,
    }
    out['duree'] = time.time() - t0
    return out


# --------------------------------------------------------------------------------------------------------------------------------------------
# Application a une geometrie trimesh
# --------------------------------------------------------------------------------------------------------------------------------------------
NOMS_TEXTURES = ('baseColorTexture', 'metallicRoughnessTexture', 'normalTexture', 'occlusionTexture', 'emissiveTexture')


def appliquer_trimesh(g, analyse, prep, ordre=2):
    """Rend (nouvelle geometrie trimesh, bilan) : g + les rustines. g n'est pas modifie. Aucune face d'entree n'est retiree, aucune UV reecrite,
    aucun sommet deplace ; les textures ne sont ecrites que dans des zones d'atlas qu'aucune face n'occupe."""
    import trimesh
    from PIL import Image
    V = np.asarray(g.vertices, dtype=np.float64)
    F = np.asarray(g.faces, dtype=np.int64)
    vis = g.visual
    UV, mat, couleurs = None, None, None
    if isinstance(vis, trimesh.visual.TextureVisuals):
        if getattr(vis, 'uv', None) is not None and len(vis.uv) == len(V):
            UV = np.asarray(vis.uv, dtype=np.float64)
        mat = vis.material
    elif getattr(vis, 'kind', None) == 'vertex':
        couleurs = np.asarray(vis.vertex_colors, dtype=np.float64)
    normales = g._cache.cache.get('vertex_normals') if hasattr(g, '_cache') else None
    if normales is not None and len(normales) != len(V):
        normales = None
    images = {}
    if mat is not None and UV is not None:
        for nom in NOMS_TEXTURES:
            img = getattr(mat, nom, None)
            if img is not None:
                images[nom] = img
    ecriture = {nom: np.array(img if img.mode in ('RGB', 'RGBA', 'L') else img.convert('RGBA')) for nom, img in images.items()}
    r = boucher(V, F, analyse, prep, UV=UV, normales=normales, couleurs_sommets=couleurs, ordre=ordre, textures=ecriture or None)
    modes = [x['uv_mode'] for x in r['rustines']]
    bilan = {'rustines': len(r['rustines']), 'sommets_ajoutes': int(len(r['sommets'])), 'faces_ajoutees': int(len(r['faces'])),
             'uv_ilot': modes.count('ilot'), 'uv_constante': modes.count('constante'), 'duree_geometrie': r['duree'],
             'methodes': {m: [x['methode'] for x in r['rustines']].count(m) for m in set(x['methode'] for x in r['rustines'])}}
    if not len(r['faces']):
        return g, bilan
    nouvelles = None
    if ecriture and bilan['uv_ilot']:
        nouvelles = {nom: Image.fromarray(a) for nom, a in ecriture.items()}
    allV = np.vstack([V, r['sommets']])
    allF = np.vstack([F, r['faces']])
    kw = {}
    if normales is not None and r['normales'] is not None:
        kw['vertex_normals'] = np.vstack([np.asarray(normales, dtype=np.float64), r['normales']])
    ng = trimesh.Trimesh(vertices=allV, faces=allF, process=False, **kw)
    if UV is not None and r['uv'] is not None:
        if nouvelles:
            import copy
            mat = copy.copy(mat)
            for nom, img in nouvelles.items():
                setattr(mat, nom, img)
        ng.visual = trimesh.visual.TextureVisuals(uv=np.vstack([UV, r['uv']]), material=mat)
    elif couleurs is not None and r['couleurs'] is not None:
        ng.visual = trimesh.visual.ColorVisuals(ng, vertex_colors=np.clip(np.vstack([couleurs, r['couleurs']]), 0, 255).astype(np.uint8))
    try:
        ng.metadata = dict(g.metadata)
        ng.name = g.name
    except Exception:
        pass
    return ng, bilan
