# -*- coding: utf-8 -*-
"""Mesures de TOPOLOGIE d'un maillage triangule (numpy + scipy), pour le banc de diagnostic de matiere (20/10/2026).

Tout part d'une SOUDURE PAR POSITION : un GLB texture duplique les sommets le long de chaque couture d'UV, donc chaque
couture est une arete de bord pour qui compte les indices bruts. Les « vraies » boucles de bord sont celles qui restent
apres soudure (meme definition que la garde 1 de modal_app/_mesh_op.py::fill_holes, mais avec une tolerance en
fraction de la DIAGONALE de la boite englobante et plusieurs tolerances testees).
"""
import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components


def souder(V, rel):
    """(indice de soudure par sommet, positions des sommets soudes, rayon de soudure). Tolerance = rel x diagonale.
    Soudure par DISTANCE (arbre kd + composantes connexes), pas par arrondi sur une grille : un arrondi coupe en deux deux
    sommets confondus que la grille separe (a 1e-6 pres, 5 % des paires pour un bruit de 1e-6 sur un pas de 2e-5)."""
    from scipy.spatial import cKDTree
    V = np.asarray(V, np.float64)
    lo = V.min(0)
    diag = float(np.linalg.norm(V.max(0) - lo)) or 1.0
    pas = max(diag * rel, 1e-12)
    n = len(V)
    paires = cKDTree(V).query_pairs(pas, output_type='ndarray')
    if len(paires) == 0:
        return np.arange(n, dtype=np.int64), V, pas
    g = coo_matrix((np.ones(len(paires)), (paires[:, 0], paires[:, 1])), shape=(n, n))
    _, lab = connected_components(g, directed=False)
    _, premier = np.unique(lab, return_index=True)
    return lab.astype(np.int64), V[premier], pas


def souder_arrondi_produit(V, F, rel=1e-5):
    """Ce que fait la garde 1 de modal_app/_mesh_op.py::fill_holes (arrondi sur une grille de pas = rel x plus grande
    etendue) : nombre d'aretes de bord apres cette soudure-la. Sert a mesurer l'ecart avec la soudure par distance."""
    V = np.asarray(V, np.float64)
    pas = max(float(np.ptp(V, axis=0).max()) * rel, 1e-12)
    q = np.round(V / pas).astype(np.int64)
    q -= q.min(0)
    m = q.max(0) + 1
    if float(m[0]) * float(m[1]) * float(m[2]) < 9.0e18:
        _, inv = np.unique((q[:, 0] * m[1] + q[:, 1]) * m[2] + q[:, 2], return_inverse=True)
    else:
        _, inv = np.unique(q, axis=0, return_inverse=True)
    inv = inv.reshape(-1)
    Fw = inv[F]
    ok = (Fw[:, 0] != Fw[:, 1]) & (Fw[:, 1] != Fw[:, 2]) & (Fw[:, 0] != Fw[:, 2])
    Fw = Fw[ok]
    nV = int(inv.max()) + 1
    e = np.concatenate([Fw[:, [0, 1]], Fw[:, [1, 2]], Fw[:, [2, 0]]])
    cle = np.minimum(e[:, 0], e[:, 1]) * nV + np.maximum(e[:, 0], e[:, 1])
    _, n = np.unique(cle, return_counts=True)
    return int((n == 1).sum())


def normales_faces(V, F):
    """(normales non normalisees (n,3), aires (n,), normales unitaires (n,3) ; zero pour les faces degenerees)."""
    a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    n = np.cross(b - a, c - a)
    l = np.linalg.norm(n, axis=1)
    aire = 0.5 * l
    un = np.zeros_like(n)
    ok = l > 0
    un[ok] = n[ok] / l[ok][:, None]
    return n, aire, un


class Aretes:
    """Table des aretes d'un jeu de faces (indices de sommets deja soudes). Demi-arete h = 3 * face + k, de
    a[h] = F[face, k] vers b[h] = F[face, (k + 1) % 3]."""

    def __init__(self, F, nV):
        nF = len(F)
        self.nF, self.nV = nF, nV
        self.a = F.reshape(-1).astype(np.int64)
        self.b = F[:, [1, 2, 0]].reshape(-1).astype(np.int64)
        lo = np.minimum(self.a, self.b)
        hi = np.maximum(self.a, self.b)
        cle = lo * nV + hi
        self.ordre = np.argsort(cle, kind='stable')
        ks = cle[self.ordre]
        neuf = np.empty(len(ks), bool)
        if len(ks):
            neuf[0] = True
            neuf[1:] = ks[1:] != ks[:-1]
        self.debut = np.nonzero(neuf)[0]
        self.cnt = np.diff(np.append(self.debut, len(ks)))
        self.lo = lo[self.ordre[self.debut]]
        self.hi = hi[self.ordre[self.debut]]
        # paires de demi-aretes CONSECUTIVES de meme cle (relie tous les membres d'une arete a >= 2 faces)
        self.paire_h1 = self.ordre[:-1][~neuf[1:]] if len(ks) > 1 else np.zeros(0, np.int64)
        self.paire_h2 = self.ordre[1:][~neuf[1:]] if len(ks) > 1 else np.zeros(0, np.int64)

    def bord(self):
        """Demi-aretes (une par arete) des aretes de bord (une seule face)."""
        return self.ordre[self.debut[self.cnt == 1]]

    def manifold(self):
        d = self.debut[self.cnt == 2]
        return self.ordre[d], self.ordre[d + 1]

    def nonmanifold_count(self):
        return int((self.cnt > 2).sum())


def boucles_de_bord(Vw, F, nV, ar=None):
    """Composantes connexes des aretes de bord. Rend un dict de tableaux par boucle (composante) :
    n_aretes, perimetre, simple (tous les sommets de degre 2), centre, aire_ouverture (aire du polygone par la somme
    des produits vectoriels des aretes ORIENTEES comme dans leur face), bbox_diag, et par arete son numero de boucle."""
    ar = ar or Aretes(F, nV)
    h = ar.bord()
    if len(h) == 0:
        return {'n': 0, 'n_aretes': np.zeros(0, int), 'perimetre': np.zeros(0), 'simple': np.zeros(0, bool),
                'centre': np.zeros((0, 3)), 'aire_ouverture': np.zeros(0), 'bbox_diag': np.zeros(0),
                'arete_boucle': np.zeros(0, int), 'a': h, 'ha': np.zeros(0, int), 'hb': np.zeros(0, int)}
    ha, hb = ar.a[h], ar.b[h]
    util, inv = np.unique(np.concatenate([ha, hb]), return_inverse=True)
    ia, ib = inv[:len(ha)], inv[len(ha):]
    g = coo_matrix((np.ones(len(ia)), (ia, ib)), shape=(len(util), len(util)))
    nb, lab = connected_components(g, directed=False)
    arete_boucle = lab[ia]
    n_aretes = np.bincount(arete_boucle, minlength=nb)
    L = np.linalg.norm(Vw[ha] - Vw[hb], axis=1)
    perim = np.bincount(arete_boucle, weights=L, minlength=nb)
    deg = np.bincount(inv, minlength=len(util))
    deg_max = np.zeros(nb, int)
    np.maximum.at(deg_max, lab, deg)
    deg_min = np.full(nb, 99, int)
    np.minimum.at(deg_min, lab, deg)
    simple = (deg_max == 2) & (deg_min == 2)
    centre = np.zeros((nb, 3))
    nbs = np.bincount(lab, minlength=nb).astype(float)
    for k in range(3):
        centre[:, k] = np.bincount(lab, weights=Vw[util][:, k], minlength=nb) / np.maximum(nbs, 1)
    c = centre[arete_boucle]
    cr = np.cross(Vw[ha] - c, Vw[hb] - c)
    va = np.stack([np.bincount(arete_boucle, weights=cr[:, k], minlength=nb) for k in range(3)], 1)
    aire = 0.5 * np.linalg.norm(va, axis=1)
    mn = np.full((nb, 3), np.inf)
    mx = np.full((nb, 3), -np.inf)
    for k in range(3):
        np.minimum.at(mn[:, k], lab, Vw[util][:, k])
        np.maximum.at(mx[:, k], lab, Vw[util][:, k])
    return {'n': nb, 'n_aretes': n_aretes, 'perimetre': perim, 'simple': simple, 'centre': centre,
            'aire_ouverture': aire, 'bbox_diag': np.linalg.norm(mx - mn, axis=1), 'arete_boucle': arete_boucle,
            'a': h, 'ha': ha, 'hb': hb}


def composantes_faces(F, ar):
    """Composantes connexes des faces par aretes partagees (toutes multiplicites). (n, etiquette par face)."""
    nF = len(F)
    f1 = ar.paire_h1 // 3
    f2 = ar.paire_h2 // 3
    g = coo_matrix((np.ones(len(f1)), (f1, f2)), shape=(nF, nF))
    return connected_components(g, directed=False)


def sommets_singuliers(F, ar):
    """Sommets (soudes) dont les faces forment PLUSIEURS eventails (noeud papillon / pincement) : indices uniques."""
    nF = len(F)
    if nF == 0:
        return np.zeros(0, np.int64)
    h1, h2 = ar.paire_h1, ar.paire_h2
    a_all = ar.a
    b_all = ar.b

    def coin(h, x):
        # indice de coin (3 * face + k) de la face de h au sommet x (x est a[h] ou b[h])
        f = h // 3
        k = h % 3
        return np.where(a_all[h] == x, h, f * 3 + (k + 1) % 3)

    # les deux sommets de l'arete de chaque paire : ceux de la demi-arete h1
    xa = a_all[h1]
    xb = b_all[h1]
    src = np.concatenate([coin(h1, xa), coin(h1, xb)])
    dst = np.concatenate([coin(h2, xa), coin(h2, xb)])
    g = coo_matrix((np.ones(len(src)), (src, dst)), shape=(3 * nF, 3 * nF))
    nc, lab = connected_components(g, directed=False)
    sommet_du_coin = F.reshape(-1)
    cles = np.unique(sommet_du_coin.astype(np.int64) * int(nc) + lab)
    cnt = np.bincount(cles // int(nc), minlength=int(sommet_du_coin.max()) + 1)
    return np.nonzero(cnt > 1)[0]


def feuilles_orientation(F, un, aire, ar, comp):
    """Decoupe le maillage en FEUILLES (faces reliees par des aretes manifold, coherentes en enroulement et sans pli
    plus aigu que 120 deg : produit scalaire des normales >= -0,5). Les aretes qui separent deux feuilles sont des
    CONFLITS d'orientation : 'W' = enroulement incoherent (meme sens des deux cotes de l'arete), 'G' = enroulement
    coherent mais normales opposees (triangle replie par-dessus ses voisins, ou pli aigu).

    Rend un dict : feuille (par face), aire par feuille, conflits W/G (nombre), et le drapeau 'retournee' par face : la
    feuille est PLUS PETITE que celle qui lui fait face de l'autre cote d'un conflit (rapport <= 0,9 pour W, <= 0,6
    pour G : deux moities de meme taille, comme les deux faces d'une plaque, ne sont pas un retournement)."""
    h1, h2 = ar.manifold()
    nF = len(F)
    f1, f2 = h1 // 3, h2 // 3
    coherent = ar.a[h1] != ar.a[h2]
    dot = (un[f1] * un[f2]).sum(1)
    lisse = coherent & (dot >= -0.5)
    g = coo_matrix((np.ones(lisse.sum()), (f1[lisse], f2[lisse])), shape=(nF, nF))
    ns, feuille = connected_components(g, directed=False)
    aire_f = np.bincount(feuille, weights=aire, minlength=ns)
    nf_f = np.bincount(feuille, minlength=ns)
    W = ~coherent
    G = coherent & (dot < -0.5)
    sep = W | G
    retournee_f = np.zeros(ns, bool)
    if sep.any():
        sa, sb = feuille[f1[sep]], feuille[f2[sep]]
        seuil = np.where(W[sep], 0.9, 0.6)
        pa, pb = aire_f[sa], aire_f[sb]
        # la feuille la plus petite d'un conflit est suspecte
        petit = np.where(pa <= pb, sa, sb)
        grand_aire = np.maximum(pa, pb)
        petit_aire = np.minimum(pa, pb)
        suspect = petit_aire <= seuil * grand_aire
        retournee_f[petit[suspect]] = True
    # aire % dont la normale s'oppose a celle d'un voisin (mesure historique du projet)
    oppose = np.zeros(nF, bool)
    op = dot < -0.5
    oppose[f1[op]] = True
    oppose[f2[op]] = True
    # conflits d'orientation par face : au moins une arete W ou G
    conflit_face = np.zeros(nF, bool)
    conflit_face[f1[sep]] = True
    conflit_face[f2[sep]] = True
    return {'feuille': feuille, 'n_feuilles': ns, 'aire_feuille': aire_f, 'nf_feuille': nf_f,
            'aretes_W': int(W.sum()), 'aretes_G': int(G.sum()), 'aretes_manifold': int(len(h1)),
            'retournee_feuille': retournee_f, 'retournee_face': retournee_f[feuille],
            'oppose_voisin_face': oppose, 'conflit_face': conflit_face, 'f1': f1, 'f2': f2, 'sep': sep, 'W': W,
            'G': G}


def volume_signe(V, F):
    a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    return float((a * np.cross(b, c)).sum() / 6.0)


def histogramme_boucles(n_aretes, perim_rel):
    """Repartition des boucles par taille (en aretes) et par perimetre relatif a la diagonale."""
    bornes_a = [3, 4, 6, 11, 31, 101, 301, 1001, 10 ** 9]
    noms_a = ['3', '4-5', '6-10', '11-30', '31-100', '101-300', '301-1000', '>1000']
    ha = np.histogram(n_aretes, bins=bornes_a)[0].tolist() if len(n_aretes) else [0] * 8
    bornes_p = [0, 0.001, 0.003, 0.01, 0.03, 0.1, 0.3, 1e9]
    noms_p = ['<0.1%', '0.1-0.3%', '0.3-1%', '1-3%', '3-10%', '10-30%', '>30%']
    hp = np.histogram(perim_rel, bins=bornes_p)[0].tolist() if len(perim_rel) else [0] * 7
    return {'par_aretes': dict(zip(noms_a, ha)), 'par_perimetre_rel': dict(zip(noms_p, hp))}


def plis_levres(Vw, Fs, un, ar, seuil=-0.8):
    """PLIS A ~180 DEGRES (« levres ») : aretes manifold dont les deux faces, d'enroulement coherent, ont des normales presque
    opposees (produit scalaire < seuil). Dans une nappe mince fermee (deux coques collees a 0,01 % de la diagonale), le
    pourtour d'une OUVERTURE n'est pas un bord ouvert : les deux coques se rejoignent en une levre, et l'arete de la levre
    a deux faces, l'une de chaque coque, repliees l'une sur l'autre. Un trou traversant a levre fermee n'a donc AUCUNE arete
    de bord : Fill holes ne peut pas le voir, le pli a 180 degres si.
    Rend un dict : a, b (sommets soudes des aretes), faces (les deux faces de chaque arete), comp (composante connexe par
    sommet partage), n_aretes par composante, perimetre par composante, centre par composante."""
    h1, h2 = ar.manifold()
    f1, f2 = h1 // 3, h2 // 3
    coh = ar.a[h1] != ar.a[h2]
    dot = (un[f1] * un[f2]).sum(1)
    pli = coh & (dot < seuil)
    ea, eb = ar.a[h1][pli], ar.b[h1][pli]
    n = int(len(ea))
    if n == 0:
        return {'n': 0, 'a': ea, 'b': eb, 'faces': np.zeros((0, 2), np.int64), 'comp': np.zeros(0, np.int64), 'n_comp': 0,
                'n_aretes': np.zeros(0, int), 'perimetre': np.zeros(0), 'centre': np.zeros((0, 3)),
                'aretes_manifold': int(len(h1))}
    util, inv = np.unique(np.concatenate([ea, eb]), return_inverse=True)
    ia, ib = inv[:n], inv[n:]
    g = coo_matrix((np.ones(n), (ia, ib)), shape=(len(util), len(util)))
    nc, lab = connected_components(g, directed=False)
    comp = lab[ia]
    L = np.linalg.norm(Vw[ea] - Vw[eb], axis=1)
    ne = np.bincount(comp, minlength=nc)
    per = np.bincount(comp, weights=L, minlength=nc)
    mid = (Vw[ea] + Vw[eb]) / 2.0
    centre = np.stack([np.bincount(comp, weights=mid[:, k], minlength=nc) / np.maximum(ne, 1) for k in range(3)], 1)
    return {'n': n, 'a': ea, 'b': eb, 'faces': np.stack([f1[pli], f2[pli]], 1), 'comp': comp, 'n_comp': int(nc),
            'n_aretes': ne, 'perimetre': per, 'centre': centre, 'aretes_manifold': int(len(h1))}
