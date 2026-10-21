# -*- coding: utf-8 -*-
"""Bouchage de trous NON DESTRUCTIF (2026-10-21) : UN noyau pour le bureau, Modal et les apercus.

POURQUOI UN NOYAU. Avant, le projet avait CINQ detecteurs de trous qui ne partageaient ni tolerance, ni regle de boucle, ni sens des curseurs
(mesh_tools.py, _mesh_op.py, l'apercu du bureau, l'apercu du site, le bouchage du site « sur l'appareil »), et AUCUN test de comportement.
Mesure du 2026-10-20 sur de VRAIS maillages (orc de 512 000 faces) : l'exemplaire Modal SUPPRIMAIT 11,9 % des faces, reecrivait 38 % des UV et
creait 204 boucles ouvertes (ou refusait a 17 % apres 74 a 160 s), alors que l'exemplaire du bureau ne cassait rien.

CE QUE FAIT LE NOYAU (et SEULEMENT cela) : il LIT les sommets et les faces, et rend des FACES A AJOUTER. Invariants, testes :
  - aucune face d'entree n'est supprimee, aucune UV n'est modifiee, aucun sommet n'est deplace ni ajoute (les rustines reutilisent les sommets
    existants, donc la coordonnee de texture de chaque coin vient des faces voisines) ;
  - la detection se fait sur une COPIE D'ANALYSE soudee par position, avec UNE tolerance relative a l'arete moyenne (2 %) ; le maillage livre,
    lui, n'est jamais soude ;
  - une rustine est orientee a l'INVERSE des faces de rive (les aretes de la rustine sont celles de la rive, parcourues en sens contraire) ;
  - aucun triangle de rustine n'est retourne (produit scalaire avec la normale de Newell du pourtour toujours > 0) ; sinon la boucle n'est PAS
    bouchee et le rapport le dit ;
  - les boucles degenerees (aire nulle : sommets alignes, ex. 13 boucles de 3 sommets sur l'orc) sont ignorees : « rien a boucher » honnete.

MODES DE REMPLISSAGE : 3 aretes = un triangle ; 4 = deux triangles (meilleure diagonale) ; jusqu'a 48 = triangulation optimale (programmation
dynamique, pire triangle d'abord puis aire) ; au-dela = decoupe par oreilles dans le plan du pourtour, par qualite decroissante.

DIAGNOSTIC D'UN MAILLAGE FERME : quand il n'y a rien a boucher, diagnostiquer() cherche pourquoi la surface parait percee (faces retournees,
aretes partagees par plus de deux faces, miettes flottantes) au lieu du message trompeur « triangles retournes ».

UNE SEULE LOGIQUE, DEUX LANGAGES. Ce fichier est copie tel quel dans modal_app/ (build/check-noyaux-partages.mjs, --sync) ; son jumeau JavaScript
est src/renderer/lib/bouchage-trous.js (= cloud/public/app/lib/bouchage-trous.js). build/bancs/noyaux/test_bouchage_trous.py ecrit des cas et leurs
sorties attendues (build/bouchage_attendus.json), tests/bureau-interface/bouchage-trous.test.mjs exige les MEMES sorties du JavaScript. Les
formules sont donc ecrites dans le meme ordre des deux cotes (pas de numpy dans la triangulation).

Dependances : numpy et scipy seulement (deja presents partout).
"""
import heapq
import math

import numpy as np

VERSION = 1

TOL_ARETE = 0.02            # tolerance de soudure = 2 % de l'arete moyenne
SEUIL_PLAT = 0.05           # une boucle est plate si 2 x aire / perimetre < SEUIL_PLAT x tolerance (ou sous le bruit flottant)
BRUIT_FLOAT32 = 8 * 1.2e-7  # 8 x l'epsilon d'un flottant 32 bits, relatif a la plus grande coordonnee
TAILLE_OPTIMALE_MAX = 48    # jusqu'ici : triangulation optimale (O(n^3)) ; au-dela : oreilles
TAILLE_MAX = 5000           # plafond du noyau : un pourtour plus long n'est jamais bouche (les curseurs montent a 5000)
# BUDGET DE TRAVAIL (determinisme : calcule sur les TAILLES, jamais sur l'horloge, donc identique en Python et en JavaScript). Unite = 0,1 microseconde
# de Python mesurees le 2026-10-21 : triangulation optimale (n - 2)(n - 1)n, oreilles 7 n^2 (5000 aretes ~ 17 s). Au-dela de 25 s de travail
# cumule, les pourtours restants ne sont PAS bouches (ils comptent comme « impossibles a remplir ») : le delai du worker est de 120 s.
BUDGET_TRAVAIL = 250_000_000
EPS_QUALITE = 1e-9
SQRT3 = math.sqrt(3.0)

CATEGORIES = ('a_boucher', 'trop_petite', 'trop_grande', 'degeneree', 'non_triangulable')


# --------------------------------------------------------------------------------------------------------------------------------------------
# Preparation : soudure par position, aretes de la copie d'analyse
# --------------------------------------------------------------------------------------------------------------------------------------------
def arete_moyenne(V, F):
    """Longueur moyenne des aretes (par face, aretes nulles ignorees)."""
    if len(F) == 0:
        return 0.0
    A = V[F[:, 0]]
    B = V[F[:, 1]]
    C = V[F[:, 2]]
    longueurs = np.concatenate([np.linalg.norm(B - A, axis=1), np.linalg.norm(C - B, axis=1), np.linalg.norm(A - C, axis=1)])
    longueurs = longueurs[longueurs > 0]
    return float(longueurs.mean()) if len(longueurs) else 0.0


def souder_par_position(V, tol):
    """Numero de groupe par sommet : deux sommets a moins de `tol` l'un de l'autre sont dans le meme groupe (fermeture transitive).
    Les groupes sont numerotes dans l'ordre de leur premier sommet."""
    n = len(V)
    if n == 0:
        return np.zeros(0, dtype=np.int64)
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components
    from scipy.spatial import cKDTree
    paires = cKDTree(V).query_pairs(tol, output_type='ndarray')
    if len(paires) == 0:
        return np.arange(n, dtype=np.int64)
    graphe = coo_matrix((np.ones(len(paires), dtype=np.int32), (paires[:, 0], paires[:, 1])), shape=(n, n))
    _, etiquettes = connected_components(graphe, directed=False)
    _, premier = np.unique(etiquettes, return_index=True)
    ordre = np.argsort(premier, kind='stable')
    renum = np.empty(len(ordre), dtype=np.int64)
    renum[ordre] = np.arange(len(ordre), dtype=np.int64)
    return renum[etiquettes]


def preparer(V, F, tol=None):
    """Copie d'analyse : groupes de sommets, faces soudees non degenerees, aretes comptees. Ne modifie jamais V ni F."""
    V = np.asarray(V, dtype=np.float64).reshape(-1, 3)
    F = np.asarray(F, dtype=np.int64).reshape(-1, 3)
    arete = arete_moyenne(V, F)
    if tol is None:
        tol = TOL_ARETE * arete
    tol = float(tol)
    groupe = souder_par_position(V, tol) if tol > 0 else np.arange(len(V), dtype=np.int64)
    nG = int(groupe.max()) + 1 if len(groupe) else 0
    Fw = groupe[F] if len(F) else np.zeros((0, 3), dtype=np.int64)
    gardee = (Fw[:, 0] != Fw[:, 1]) & (Fw[:, 1] != Fw[:, 2]) & (Fw[:, 0] != Fw[:, 2])
    idxF = np.nonzero(gardee)[0]
    Fw = Fw[idxF]
    ea = Fw.reshape(-1)
    eb = Fw[:, [1, 2, 0]].reshape(-1)
    cle = np.minimum(ea, eb) * max(nG, 1) + np.maximum(ea, eb)
    uniques, inv, cnt = np.unique(cle, return_inverse=True, return_counts=True)
    inv = inv.reshape(-1)
    return {'V': V, 'F': F, 'tol': tol, 'arete_moyenne': arete, 'groupe': groupe, 'nG': nG, 'idxF': idxF, 'Fw': Fw,
            'ea': ea, 'eb': eb, 'inv': inv, 'cnt': cnt, 'uniques': uniques}


# --------------------------------------------------------------------------------------------------------------------------------------------
# Pourtours (boucles d'aretes de bord)
# --------------------------------------------------------------------------------------------------------------------------------------------
def _pourtours(prep):
    """Cycles d'aretes de bord. Rend (cycles, chaines_ouvertes, chaines_fermees, nombre d'aretes de bord) ; un cycle est une liste d'aretes (numeros dans
    ea / eb, face-majeur) ; -1 marque l'arete VIRTUELLE qui ferme une chaine (voir plus bas). Un pourtour qui repasse par un sommet (pincement) est coupe
    en sous-cycles.

    CHAINES : sur un vrai maillage (TRELLIS : 94 000 aretes partagees par plus de deux faces sur l'orc), un trou touche souvent une arete a trois faces :
    le pourtour n'est alors qu'une CHAINE dont les deux bouts sont des sommets desequilibres (une arete de plus ou de moins). Les marches partent
    d'abord de ces sommets ; une chaine dont les deux bouts sont relies par une arete EXISTANTE du maillage est fermee par cette arete (arete
    virtuelle) : la rustine la retrouve exactement comme avant la perte de la face. Sinon elle reste ouverte et compte comme telle."""
    ea, eb, inv, cnt = prep['ea'], prep['eb'], prep['inv'], prep['cnt']
    bord = np.nonzero(cnt[inv] == 1)[0]
    nb = len(bord)
    if nb == 0:
        return [], 0, 0, 0
    A = ea[bord].tolist()
    B = eb[bord].tolist()
    sortants = {}
    sortie = {}
    entree = {}
    for k in range(nb):
        sortants.setdefault(A[k], []).append(k)
        sortie[A[k]] = sortie.get(A[k], 0) + 1
        entree[B[k]] = entree.get(B[k], 0) + 1
    utilise = [False] * nb
    suivant_libre = {}
    cycles = []
    bilan = {'ouvertes': 0, 'fermees': 0}
    uniques, nG = prep['uniques'], max(prep['nG'], 1)

    def corde(u, w):
        cle = min(u, w) * nG + max(u, w)
        i = int(np.searchsorted(uniques, cle))
        return i < len(uniques) and int(uniques[i]) == cle and int(cnt[i]) >= 2

    def marcher(k0):
        aretes = []
        sommets = [A[k0]]
        position = {A[k0]: 0}
        k = k0
        while True:
            utilise[k] = True
            sortie[A[k]] -= 1
            entree[B[k]] -= 1
            aretes.append(k)
            v = B[k]
            if v in position:
                p = position[v]
                cycles.append(aretes[p:])
                del aretes[p:]
                for s in sommets[p + 1:]:
                    del position[s]
                del sommets[p + 1:]
            else:
                position[v] = len(sommets)
                sommets.append(v)
            courant = sommets[-1]
            liste = sortants.get(courant, [])
            i = suivant_libre.get(courant, 0)
            while i < len(liste) and utilise[liste[i]]:
                i += 1
            suivant_libre[courant] = i
            if i >= len(liste):
                if aretes:
                    if corde(B[aretes[-1]], A[aretes[0]]):
                        cycles.append(aretes + [-1])
                        bilan['fermees'] += 1
                    else:
                        bilan['ouvertes'] += 1
                return
            k = liste[i]

    for k0 in range(nb):                       # 1. depuis les sommets qui ont plus d'aretes sortantes qu'entrantes : les chaines
        if not utilise[k0] and sortie[A[k0]] > entree.get(A[k0], 0):
            marcher(k0)
    for k0 in range(nb):                       # 2. le reste : des cycles
        if not utilise[k0]:
            marcher(k0)
    return [[int(bord[k]) if k >= 0 else -1 for k in c] for c in cycles], bilan['ouvertes'], bilan['fermees'], nb


# --------------------------------------------------------------------------------------------------------------------------------------------
# Triangulation d'un pourtour (listes Python : meme code que le jumeau JavaScript)
# --------------------------------------------------------------------------------------------------------------------------------------------
def _newell(P):
    nx = ny = nz = 0.0
    n = len(P)
    for i in range(n):
        x1, y1, z1 = P[i]
        x2, y2, z2 = P[(i + 1) % n]
        nx += (y1 - y2) * (z1 + z2)
        ny += (z1 - z2) * (x1 + x2)
        nz += (x1 - x2) * (y1 + y2)
    return nx, ny, nz


def _tri(P, N, i, k, j):
    """(mauvais, aire) du triangle (P[i], P[k], P[j]) : mauvais = 1 - qualite (0 = equilateral) ; 2 si le triangle est retourne
    par rapport a la normale N du pourtour."""
    ax, ay, az = P[i]
    bx, by, bz = P[k]
    cx, cy, cz = P[j]
    ux, uy, uz = bx - ax, by - ay, bz - az
    vx, vy, vz = cx - ax, cy - ay, cz - az
    qx = uy * vz - uz * vy
    qy = uz * vx - ux * vz
    qz = ux * vy - uy * vx
    a2 = math.sqrt(qx * qx + qy * qy + qz * qz)
    wx, wy, wz = cx - bx, cy - by, cz - bz
    s = ux * ux + uy * uy + uz * uz
    s += wx * wx + wy * wy + wz * wz
    s += vx * vx + vy * vy + vz * vz
    q = (2.0 * SQRT3 * a2) / s if s > 0 else 0.0
    d = qx * N[0] + qy * N[1] + qz * N[2]
    mauvais = 2.0 if d <= 0 else 1.0 - q
    return mauvais, 0.5 * a2


def _optimale(P, N):
    """Triangulation du polygone P (ordre du pourtour) minimisant le PIRE triangle, puis l'aire. Rend la liste des (i, k, j), i < k < j."""
    n = len(P)
    mb = [[0.0] * n for _ in range(n)]
    ar = [[0.0] * n for _ in range(n)]
    kk = [[0] * n for _ in range(n)]
    for longueur in range(2, n):
        for i in range(0, n - longueur):
            j = i + longueur
            bmx = 0.0
            bar = 0.0
            bk = -1
            for k in range(i + 1, j):
                m, a = _tri(P, N, i, k, j)
                mx = m
                if mb[i][k] > mx:
                    mx = mb[i][k]
                if mb[k][j] > mx:
                    mx = mb[k][j]
                ai = a + ar[i][k] + ar[k][j]
                if bk < 0:
                    prendre = True
                elif mx < bmx - EPS_QUALITE:
                    prendre = True
                elif mx <= bmx + EPS_QUALITE and ai < bar - 1e-12 * bar:
                    prendre = True
                else:
                    prendre = False
                if prendre:
                    bmx, bar, bk = mx, ai, k
            mb[i][j], ar[i][j], kk[i][j] = bmx, bar, bk
    triangles = []
    pile = [(0, n - 1)]
    while pile:
        i, j = pile.pop()
        if j - i < 2:
            continue
        k = kk[i][j]
        triangles.append((i, k, j))
        pile.append((k, j))
        pile.append((i, k))
    return triangles


def _oreilles(P, N):
    """Decoupe par oreilles dans le plan du pourtour, meilleure qualite d'abord. Rend la liste des (p, i, q) ou None."""
    n = len(P)
    nl = math.sqrt(N[0] * N[0] + N[1] * N[1] + N[2] * N[2])
    if not nl > 0:
        return None
    nx, ny, nz = N[0] / nl, N[1] / nl, N[2] / nl
    ax_, ay_, az_ = abs(nx), abs(ny), abs(nz)
    if ax_ <= ay_ and ax_ <= az_:
        ex, ey, ez = 1.0, 0.0, 0.0
    elif ay_ <= az_:
        ex, ey, ez = 0.0, 1.0, 0.0
    else:
        ex, ey, ez = 0.0, 0.0, 1.0
    ux, uy, uz = ny * ez - nz * ey, nz * ex - nx * ez, nx * ey - ny * ex
    ul = math.sqrt(ux * ux + uy * uy + uz * uz)
    ux, uy, uz = ux / ul, uy / ul, uz / ul
    vx, vy, vz = ny * uz - nz * uy, nz * ux - nx * uz, nx * uy - ny * ux
    X = [p[0] * ux + p[1] * uy + p[2] * uz for p in P]
    Y = [p[0] * vx + p[1] * vy + p[2] * vz for p in P]
    echelle = max(max(X) - min(X), max(Y) - min(Y))
    eps = 1e-12 * echelle * echelle
    prec = [(i - 1) % n for i in range(n)]
    suiv = [(i + 1) % n for i in range(n)]
    vivant = [True] * n
    stamp = [0] * n

    def croix(a, b, c):
        return (X[b] - X[a]) * (Y[c] - Y[a]) - (Y[b] - Y[a]) * (X[c] - X[a])

    def convexe(i):
        return croix(prec[i], i, suiv[i]) > eps

    reflexes = set(i for i in range(n) if not convexe(i))

    def proche(a, b):
        dx = X[a] - X[b]
        dy = Y[a] - Y[b]
        return dx * dx + dy * dy <= eps

    def est_oreille(i):
        if not convexe(i):
            return False
        p, q = prec[i], suiv[i]
        for r in reflexes:
            if r == p or r == q or r == i:
                continue
            if (X[r] - X[p]) ** 2 + (Y[r] - Y[p]) ** 2 <= eps or (X[r] - X[i]) ** 2 + (Y[r] - Y[i]) ** 2 <= eps \
                    or (X[r] - X[q]) ** 2 + (Y[r] - Y[q]) ** 2 <= eps:
                continue
            if croix(p, i, r) >= -eps and croix(i, q, r) >= -eps and croix(q, p, r) >= -eps:
                return False
        return True

    tas = []

    def pousser(i):
        if est_oreille(i):
            mauvais, _ = _tri(P, N, prec[i], i, suiv[i])
            heapq.heappush(tas, (mauvais, i, stamp[i]))

    for i in range(n):
        pousser(i)
    triangles = []
    restant = n
    while restant > 3:
        if not tas:
            for i in range(n):
                if vivant[i]:
                    pousser(i)
            if not tas:
                return None
        _, i, st = heapq.heappop(tas)
        if not vivant[i] or st != stamp[i] or not est_oreille(i):
            continue
        p, q = prec[i], suiv[i]
        triangles.append((p, i, q))
        vivant[i] = False
        reflexes.discard(i)
        suiv[p] = q
        prec[q] = p
        restant -= 1
        stamp[p] += 1
        stamp[q] += 1
        for s in (p, q):
            if convexe(s):
                reflexes.discard(s)
            else:
                reflexes.add(s)
        pousser(p)
        pousser(q)
    v = 0
    while not vivant[v]:
        v += 1
    triangles.append((v, suiv[v], suiv[suiv[v]]))
    return triangles


def _sans_retourne(P, N, triangles):
    for (a, b, c) in triangles:
        if _tri(P, N, a, b, c)[0] >= 2.0:
            return False
    return True


def trianguler(P):
    """Triangule le polygone P (liste de (x, y, z), dans l'ordre de la RUSTINE). Rend (mode, triangles) ou None.
    Les triangles sont des triplets d'indices de P, orientes comme P."""
    n = len(P)
    cx = cy = cz = 0.0
    for (x, y, z) in P:
        cx += x
        cy += y
        cz += z
    cx, cy, cz = cx / n, cy / n, cz / n
    Q = [(x - cx, y - cy, z - cz) for (x, y, z) in P]
    N = _newell(Q)
    if not (N[0] * N[0] + N[1] * N[1] + N[2] * N[2]) > 0:
        return None
    if n <= TAILLE_OPTIMALE_MAX:
        triangles = _optimale(Q, N)
        if _sans_retourne(Q, N, triangles):
            return ('triangle' if n == 3 else 'quad' if n == 4 else 'optimal'), triangles
    triangles = _oreilles(Q, N)
    if triangles is not None and _sans_retourne(Q, N, triangles):
        return 'oreilles', triangles
    return None


# --------------------------------------------------------------------------------------------------------------------------------------------
# Analyse complete
# --------------------------------------------------------------------------------------------------------------------------------------------
def _sommets_rustine(n, rive_debut, rive_fin, triangle):
    """Sommets d'origine des trois coins d'un triangle (indices de P ; P[m] = pourtour[n - 1 - m])."""
    t = list(triangle)
    arete = set()
    for s in range(3):
        u, v = t[s], t[(s + 1) % 3]
        if v == (u + 1) % n:
            arete.add(u)
    sortie = []
    for x in t:
        entrante = ((x - 1) % n) in arete          # arete (x - 1 -> x) de la rustine : rive j = n - 1 - x, son debut est le coin x
        sortante = x in arete                        # arete (x -> x + 1) : rive j' = n - 1 - ((x + 1) % n), sa fin est le coin x
        if sortante and not entrante:
            sortie.append(rive_fin[n - 1 - ((x + 1) % n)])
        else:
            sortie.append(rive_debut[n - 1 - x])
    return sortie


def _est_une_face(prep, sommets):
    """Vrai si ces trois sommets (indices d'origine) forment, une fois soudes, une face DEJA presente : fermer le pourtour d'une ailette
    (un triangle accroche a une arete partagee par d'autres faces) ne ferait que la doubler."""
    if '_triples' not in prep:
        prep['_triples'] = set(map(tuple, np.sort(prep['Fw'], axis=1).tolist()))
    g = prep['groupe']
    return tuple(sorted(int(g[v]) for v in sommets)) in prep['_triples']


def cout_travail(n):
    """Travail prevu pour trianguler un pourtour de n aretes (unites de 0,1 microseconde, voir BUDGET_TRAVAIL)."""
    return (n - 2) * (n - 1) * n if n <= TAILLE_OPTIMALE_MAX else 7 * n * n


def analyser(V, F, min_aretes=3, max_aretes=2000, tol=None, prep=None, budget=None):
    """Trouve les pourtours, les classe et calcule les faces a ajouter. Rend un dictionnaire (voir la fin) ; ne modifie rien.
    min_aretes / max_aretes : bornes (incluses) du nombre d'aretes du pourtour a boucher. budget : travail maximal (BUDGET_TRAVAIL par defaut)."""
    if prep is None:
        prep = preparer(V, F, tol)
    reste = BUDGET_TRAVAIL if budget is None else int(budget)
    V, F = prep['V'], prep['F']
    min_aretes = max(3, int(min_aretes))
    max_aretes = max(min_aretes, int(max_aretes))
    plafond = min(max_aretes, TAILLE_MAX)
    cycles, ouvertes, fermees, nb_bord = _pourtours(prep)
    ea, idxF = prep['ea'], prep['idxF']
    tol = prep['tol']
    maxabs = float(np.abs(V).max()) if len(V) else 0.0
    seuil_plat = max(SEUIL_PLAT * tol, BRUIT_FLOAT32 * maxabs)

    boucles = []
    ajout = []
    modes = {'triangle': 0, 'quad': 0, 'optimal': 0, 'oreilles': 0}
    for cycle in cycles:
        n = len(cycle)
        reels = [e for e in cycle if e >= 0]
        faces = [int(idxF[e // 3]) for e in reels]
        coins = [e % 3 for e in reels]
        debut = [int(F[f, c]) for f, c in zip(faces, coins)]
        fin = [int(F[f, (c + 1) % 3]) for f, c in zip(faces, coins)]
        if len(reels) < n:                       # chaine fermee par une arete existante : l'arete virtuelle va du bout de la chaine a son debut
            debut.append(fin[-1])
            fin.append(debut[0])
        pts = [(float(V[v, 0]), float(V[v, 1]), float(V[v, 2])) for v in debut]
        # aire de l'eventail depuis le barycentre, perimetre
        cx = cy = cz = 0.0
        for p in pts:
            cx += p[0]
            cy += p[1]
            cz += p[2]
        cx, cy, cz = cx / n, cy / n, cz / n
        aire = 0.0
        perimetre = 0.0
        for j in range(n):
            a = pts[j]
            b = pts[(j + 1) % n]
            ux, uy, uz = a[0] - cx, a[1] - cy, a[2] - cz
            vx, vy, vz = b[0] - cx, b[1] - cy, b[2] - cz
            qx = uy * vz - uz * vy
            qy = uz * vx - ux * vz
            qz = ux * vy - uy * vx
            aire += 0.5 * math.sqrt(qx * qx + qy * qy + qz * qz)
            dx, dy, dz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
            perimetre += math.sqrt(dx * dx + dy * dy + dz * dz)
        item = {'n': n, 'debut': debut, 'aire': aire, 'perimetre': perimetre, 'categorie': None, 'mode': None, 'triangles': [],
                'chaine': len(reels) < n}
        if not perimetre > 0 or (2.0 * aire) / perimetre < seuil_plat or (item['chaine'] and n == 3 and _est_une_face(prep, debut)):
            item['categorie'] = 'degeneree'     # (dernier cas : l'ailette d'un triangle, dont le « trou » est le pourtour d'une face qui existe deja)
        elif n < min_aretes:
            item['categorie'] = 'trop_petite'
        elif n > plafond:
            item['categorie'] = 'trop_grande'
        elif cout_travail(n) > reste:
            item['categorie'] = 'non_triangulable'        # budget de travail epuise : ce pourtour reste ouvert
        else:
            reste -= cout_travail(n)
            P = pts[::-1]
            res = trianguler(P)
            if res is None:
                item['categorie'] = 'non_triangulable'
            else:
                mode, triangles = res
                item['categorie'] = 'a_boucher'
                item['mode'] = mode
                modes[mode] += 1
                for t in triangles:
                    s = _sommets_rustine(n, debut, fin, t)
                    item['triangles'].append(s)
                    ajout.append(s)
        boucles.append(item)

    compte = {c: 0 for c in CATEGORIES}
    for b in boucles:
        compte[b['categorie']] += 1
    vraies = [b['n'] for b in boucles if b['categorie'] != 'degeneree']
    restantes = compte['trop_petite'] + compte['trop_grande'] + compte['non_triangulable'] + ouvertes
    return {
        'version': VERSION,
        'sommets': int(len(V)), 'faces': int(len(F)),
        'tolerance': tol, 'arete_moyenne': prep['arete_moyenne'],
        'aretes_de_bord': int(nb_bord),
        'aretes_non_manifold': int((prep['cnt'] > 2).sum()),
        'boucles': boucles,
        'chaines_ouvertes': int(ouvertes), 'chaines_fermees': int(fermees),
        'a_boucher': compte['a_boucher'], 'trop_petites': compte['trop_petite'], 'trop_grandes': compte['trop_grande'],
        'degenerees': compte['degeneree'], 'non_triangulables': compte['non_triangulable'],
        'plus_petite': min(vraies) if vraies else 0, 'plus_grande': max(vraies) if vraies else 0,
        'modes': modes,
        'ajout': ajout,
        'faces_ajoutees': len(ajout),
        'restantes': restantes,
        'verdict': 'OPEN_HOLES' if restantes > 0 else 'CLOSED_OK',
        'min_aretes': min_aretes, 'max_aretes': max_aretes, 'plafond': TAILLE_MAX,
    }


def faces_ajoutees(analyse):
    """Les faces a ajouter, en tableau (k, 3) d'entiers (indices dans le tableau de sommets d'ORIGINE)."""
    return np.asarray(analyse['ajout'], dtype=np.int64).reshape(-1, 3)


def rapport_compact(analyse):
    """Le rapport sans les listes de sommets (pour les journaux, la reponse du serveur et les tests)."""
    r = {k: v for k, v in analyse.items() if k not in ('boucles', 'ajout')}
    r['boucles'] = [{'n': b['n'], 'categorie': b['categorie'], 'mode': b['mode']} for b in analyse['boucles']]
    return r


# --------------------------------------------------------------------------------------------------------------------------------------------
# Diagnostic d'un maillage ferme
# --------------------------------------------------------------------------------------------------------------------------------------------
def diagnostiquer(prep, analyse=None):
    """Pourquoi la surface parait-elle percee alors qu'aucun trou ne s'ouvre ? Rend les nombres et la cause principale :
    'retournees' (feuilles d'orientation opposee), 'non_manifold' (aretes a plus de deux faces), 'miettes' (morceaux flottants),
    'aucune' (rien d'anormal dans la topologie : la matiere manquante n'est pas un trou)."""
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components
    Fw, ea, eb, inv, cnt = prep['Fw'], prep['ea'], prep['eb'], prep['inv'], prep['cnt']
    m = len(Fw)
    sortie = {'faces_analysees': int(m), 'aretes_non_manifold': int((cnt > 2).sum()), 'aretes_incoherentes': 0,
              'feuilles': 0, 'faces_retournees': 0, 'composantes': 0, 'miettes': 0, 'faces_miettes': 0,
              'boucles_degenerees': int(analyse['degenerees']) if analyse else 0, 'cause': 'aucune'}
    if m == 0:
        return sortie
    sgn = np.where(ea < eb, 1, -1)
    somme = np.bincount(inv, weights=sgn, minlength=len(cnt))
    sortie['aretes_incoherentes'] = int(((cnt == 2) & (np.abs(somme) == 2)).sum())
    occ = np.nonzero(cnt[inv] == 2)[0]
    if len(occ):
        ordre = np.argsort(inv[occ], kind='stable')
        occ = occ[ordre]
        oa, ob = occ[0::2], occ[1::2]
        fa, fb = oa // 3, ob // 3
        coherent = (sgn[oa] + sgn[ob]) == 0
        un = np.ones(len(fa), dtype=np.int32)
        n_reg, region = connected_components(coo_matrix((un, (fa, fb)), shape=(m, m)), directed=False)
        n_feu, feuille = connected_components(
            coo_matrix((np.ones(int(coherent.sum()), dtype=np.int32), (fa[coherent], fb[coherent])), shape=(m, m)), directed=False)
    else:
        n_reg, region = m, np.arange(m)
        n_feu, feuille = m, np.arange(m)
    taille_feuille = np.bincount(feuille, minlength=n_feu)
    taille_region = np.bincount(region, minlength=n_reg)
    plus_grande = np.zeros(n_reg, dtype=np.int64)
    np.maximum.at(plus_grande, region, taille_feuille[feuille])
    sortie['feuilles'] = int(n_feu - n_reg)
    sortie['faces_retournees'] = int((taille_region - plus_grande).sum())
    # morceaux flottants : composantes par sommets partages
    nG = prep['nG']
    graphe = coo_matrix((np.ones(len(ea), dtype=np.int32), (ea, eb)), shape=(nG, nG))
    n_comp, comp = connected_components(graphe, directed=False)
    faces_par_comp = np.bincount(comp[Fw[:, 0]], minlength=n_comp)
    faces_par_comp = faces_par_comp[faces_par_comp > 0]
    plus_gros = int(faces_par_comp.max())
    petites = faces_par_comp[(faces_par_comp < 0.01 * plus_gros) & (faces_par_comp < plus_gros)]
    sortie['composantes'] = int(len(faces_par_comp))
    sortie['miettes'] = int(len(petites))
    sortie['faces_miettes'] = int(petites.sum())
    if sortie['faces_retournees'] > 0:
        sortie['cause'] = 'retournees'
    elif sortie['aretes_non_manifold'] > 0:
        sortie['cause'] = 'non_manifold'
    elif sortie['miettes'] > 0:
        sortie['cause'] = 'miettes'
    return sortie


# --------------------------------------------------------------------------------------------------------------------------------------------
# Refus expliques (textes anglais : l'interface les traduit par leur code, lib/textes-serveur.js)
# --------------------------------------------------------------------------------------------------------------------------------------------
def agreger(analyses, diagnostics):
    """Une analyse et un diagnostic UNIQUES pour un fichier a plusieurs maillages (le message de refus n'en nomme qu'un).
    `diagnostics` peut etre vide (aucun diagnostic calcule) ; la cause retenue est la plus grave : retournees > non_manifold > miettes."""
    somme = {}
    for k in ('a_boucher', 'trop_petites', 'trop_grandes', 'non_triangulables'):
        somme[k] = 0
        for a in analyses:
            somme[k] += int(a[k])
    petites = [a['plus_petite'] for a in analyses if a['plus_petite']]
    somme['plus_petite'] = min(petites) if petites else 0
    somme['plus_grande'] = 0
    for a in analyses:
        if a['plus_grande'] > somme['plus_grande']:
            somme['plus_grande'] = a['plus_grande']
    ordre = ('retournees', 'non_manifold', 'miettes', 'aucune')
    diag = {'cause': 'aucune', 'faces_retournees': 0, 'aretes_non_manifold': 0, 'miettes': 0}
    for d in diagnostics:
        for k in ('faces_retournees', 'aretes_non_manifold', 'miettes'):
            diag[k] += int(d.get(k, 0))
        if ordre.index(d.get('cause', 'aucune')) < ordre.index(diag['cause']):
            diag['cause'] = d['cause']
    return somme, diag


def message_refus(analyse, diagnostic, min_aretes, max_aretes):
    """(code, texte) quand rien ne peut etre bouche. Le maillage reste inchange et rien n'est facture."""
    if analyse['trop_petites'] + analyse['trop_grandes'] > 0 and analyse['a_boucher'] == 0:
        return ('fill_holes_range',
                'No hole between %d and %d edges: the mesh has %d open hole(s) outside this range (smallest %d edges, largest %d). '
                'Widen the range. The mesh was left unchanged.' % (
                    max(3, int(min_aretes)), int(max_aretes), analyse['trop_petites'] + analyse['trop_grandes'],
                    analyse['plus_petite'], analyse['plus_grande']))
    if analyse['non_triangulables'] > 0 and analyse['a_boucher'] == 0:
        return ('fill_holes_unfillable',
                'Could not fill the %d open hole(s): their outline is too complex or folds over itself. The mesh was left unchanged.'
                % analyse['non_triangulables'])
    d = diagnostic or {}
    cause = d.get('cause', 'aucune')
    if cause == 'retournees':
        return ('fill_holes_closed_flipped',
                'Nothing to fill: the mesh has no open hole, but %d faces point the wrong way (dark or see-through patches). '
                'Use Fix normals instead. The mesh was left unchanged.' % d['faces_retournees'])
    if cause == 'non_manifold':
        return ('fill_holes_closed_nonmanifold',
                'Nothing to fill: the mesh has no open hole, but %d edges are shared by more than two faces (double skin or glued parts). '
                'The mesh was left unchanged.' % d['aretes_non_manifold'])
    if cause == 'miettes':
        return ('fill_holes_closed_debris',
                'Nothing to fill: the mesh has no open hole, but %d small loose pieces float apart from the main body. '
                'The mesh was left unchanged.' % d['miettes'])
    return ('fill_holes_closed',
            'Nothing to fill: the mesh has no open hole. Missing or thin areas are not holes in the surface, so this tool cannot '
            'fix them. The mesh was left unchanged.')
