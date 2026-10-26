# -*- coding: utf-8 -*-
"""Percage CONTROLE de trous dans un vrai maillage + mesures de fidelite du bouchage (banc de Fill holes, 2026-10-26).

On connait la verite : les faces retirees SONT la surface qui manque. On peut donc mesurer la distance entre le bouchon et cette surface, le sens
des normales et la couleur de texture. Aucun maillage dans le depot (public) : le banc lit un GLB local (variable FILL_HOLES_GLB, defaut
C:/tmp/moissonneuse.glb) et se saute proprement s'il est absent.
"""
import heapq
import os

import numpy as np

GLB_PAR_DEFAUT = os.environ.get('FILL_HOLES_GLB', 'C:/tmp/moissonneuse.glb')


def charger(chemin=None):
    import trimesh
    sc = trimesh.load(chemin or GLB_PAR_DEFAUT, process=False)
    g = list(sc.geometry.values())[0] if hasattr(sc, 'geometry') else sc
    return g


def adjacence_faces(F, tol_rel=0.02, V=None):
    """Adjacence des faces par aretes SOUDEES par position (les coutures UV dedoublent les sommets). Rend (csr faces x faces, groupe)."""
    from scipy.sparse import coo_matrix
    import bouchage_trous as B
    prep = B.preparer(V, F)
    Fw, idxF, ea, eb, inv, cnt = prep['Fw'], prep['idxF'], prep['ea'], prep['eb'], prep['inv'], prep['cnt']
    occ = np.nonzero(cnt[inv] == 2)[0]
    ordre = np.argsort(inv[occ], kind='stable')
    occ = occ[ordre]
    fa, fb = idxF[occ[0::2] // 3], idxF[occ[1::2] // 3]
    n = len(F)
    m = coo_matrix((np.ones(len(fa), dtype=np.int8), (fa, fb)), shape=(n, n))
    return (m + m.T).tocsr(), prep


def region_surface(adj, centres, graine, n_faces, rng, bruit=0.0, interdit=None):
    """Region connexe de ~n_faces faces autour de `graine`, par croissance sur la surface (priorite = distance a la graine x (1 + bruit aleatoire)).
    bruit = 0 : trou rond ; bruit > 0 : bord irregulier."""
    interdit = set() if interdit is None else interdit
    c0 = centres[graine]
    pris = {int(graine)}
    tas = []
    vu = {int(graine)}
    amp = {}

    def pousser(f):
        if f in vu or f in interdit:
            return
        vu.add(f)
        b = 1.0 + bruit * rng.random()
        heapq.heappush(tas, (float(np.linalg.norm(centres[f] - c0)) * b, f))
    for f in adj.indices[adj.indptr[graine]:adj.indptr[graine + 1]]:
        pousser(int(f))
    while tas and len(pris) < n_faces:
        _, f = heapq.heappop(tas)
        pris.add(f)
        for g in adj.indices[adj.indptr[f]:adj.indptr[f + 1]]:
            pousser(int(g))
    return np.array(sorted(pris), dtype=np.int64)


def centres_des_faces(V, F):
    return V[F].mean(axis=1)


def proprement_percable(g, retirees):
    """Vrai si le trou perce n'a que des pourtours FERMES (aucune chaine ouverte : l'arete a plus de deux faces d'un maillage TRELLIS qui touche
    le trou le rendrait indecidable). Les cas « non manifold » ont leur propre test."""
    import bouchage_trous as B
    h, _ = percer(g, retirees)
    a = B.analyser(h.vertices, h.faces)
    return a['chaines_ouvertes'] == 0 and a['aretes_de_bord'] > 0


def fabriquer_cas(g, graine=20261026):
    """Les cas de percage : liste de dict {nom, retirees (indices de faces), trous (nombre de pourtours attendus)}."""
    V = np.asarray(g.vertices, dtype=np.float64)
    F = np.asarray(g.faces, dtype=np.int64)
    adj, prep = adjacence_faces(F, V=V)
    rng = np.random.default_rng(graine)
    C = centres_des_faces(V, F)
    aire = 0.5 * np.linalg.norm(np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]), axis=1)
    deg = np.diff(adj.indptr)
    # graines : faces de taille courante, entourees de 3 voisines (surface ordinaire), reparties dans tout le volume
    ok = np.nonzero((deg == 3) & (aire > np.median(aire) * 0.5) & (aire < np.median(aire) * 2))[0]
    ordre = rng.permutation(ok)
    cas = []
    utilises = set()

    curseur = [0]

    def prendre_graine(rayon_min):
        while curseur[0] < len(ordre):
            f = int(ordre[curseur[0]])
            curseur[0] += 1
            if all(np.linalg.norm(C[f] - C[u]) > rayon_min for u in utilises):
                return f
        raise RuntimeError('plus de graine')

    arete = prep['arete_moyenne']
    NF = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])

    def coherence(r):
        """Longueur de la normale moyenne ponderee par l'aire : 1 = region plane, ~0 = region qui se replie (arete vive, tige)."""
        return float(np.linalg.norm(NF[r].sum(axis=0)) / max(1e-300, np.linalg.norm(NF[r], axis=1).sum()))

    def region_avec(n_faces, bruit, coh_min, coh_max, essais=300):
        for _ in range(essais):
            f = prendre_graine(0.25)
            r = region_surface(adj, C, f, n_faces, rng, bruit)
            if coh_min <= coherence(r) <= coh_max and proprement_percable(g, r):
                utilises.add(f)
                return f, r
        raise RuntimeError('aucune region assez ' + str((coh_min, coh_max)))
    # 1. rond ~60 faces ; 2. irregulier ~150 ; 3. grand ~2500 ; 4. courbe (tige / bombe) ; 5. arete vive (cas difficile) ; 6. plusieurs petits
    f, r = region_avec(60, 0.0, 0.85, 1.0)
    cas.append({'nom': 'rond', 'retirees': r, 'graine': f, 'coherence': coherence(r)})
    f, r = region_avec(150, 0.9, 0.7, 1.0)
    cas.append({'nom': 'irregulier', 'retirees': r, 'graine': f, 'coherence': coherence(r)})
    f, r = region_avec(2500, 0.15, 0.1, 1.0)
    cas.append({'nom': 'grand', 'retirees': r, 'graine': f, 'coherence': coherence(r)})
    f, r = region_avec(120, 0.2, 0.4, 0.7)
    cas.append({'nom': 'courbe', 'retirees': r, 'graine': f, 'coherence': coherence(r)})
    f, r = region_avec(60, 0.0, 0.0, 0.2)
    cas.append({'nom': 'arete_vive', 'retirees': r, 'graine': f, 'coherence': coherence(r)})
    multi = []
    for _ in range(5):
        f, r = region_avec(25, 0.3, 0.8, 1.0)
        multi.append(r)
    cas.append({'nom': 'plusieurs', 'retirees': np.unique(np.concatenate(multi)), 'graine': None, 'nombre': 5})
    return cas, prep


def trou_traversant(g, rng_graine=7, rayon_aretes=6.0, epaisseur_max_aretes=40.0, essais=1500):
    """Trou traversant une tole mince : cylindre le long de la normale d'une face, retire les faces dont le centre est dans le cylindre ET
    dans la tranche entre la face de depart et celle qu'un rayon trouve de l'autre cote. Rend un dict de cas ou None."""
    import trimesh
    V = np.asarray(g.vertices, dtype=np.float64)
    F = np.asarray(g.faces, dtype=np.int64)
    import bouchage_trous as B
    arete = B.arete_moyenne(V, F)
    C = centres_des_faces(V, F)
    N = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-30)
    rng = np.random.default_rng(rng_graine)
    cand = rng.choice(len(F), size=essais, replace=False)
    mesh = trimesh.Trimesh(V, F, process=False)
    origines = C[cand] - N[cand] * arete * 0.05
    rayons = -N[cand]
    locs, idx_ray, idx_tri = mesh.ray.intersects_location(origines, rayons, multiple_hits=False)
    cands = []
    for loc, ir, it in zip(locs, idx_ray, idx_tri):
        f = int(cand[ir])
        ep = float(np.linalg.norm(loc - C[f]))
        if ep < 1.0 * arete or ep > epaisseur_max_aretes * arete:
            continue
        if float(np.dot(N[f], N[it])) > -0.9:        # il faut que l'autre paroi soit parallele (tole)
            continue
        cands.append((ep, f))
    cands.sort()
    for ep, f in cands[:40]:
        axe = N[f]
        rel = C - C[f]
        t = rel @ axe
        r = np.linalg.norm(rel - np.outer(t, axe), axis=1)
        for rayon_a in (rayon_aretes, 4.0, 3.0, 2.0):
            rayon = rayon_a * arete
            dans = (r < rayon) & (t < arete * 0.5) & (t > -ep - arete * 0.5) & (np.abs(N @ axe) > 0.5)
            ret = np.nonzero(dans)[0]
            if len(ret) > 12 and proprement_percable(g, ret):
                return {'nom': 'traversant', 'retirees': ret, 'graine': f, 'epaisseur': ep, 'rayon_aretes': rayon_a}
    return None


def percer(g, retirees):
    """Copie du maillage SANS les faces `retirees` (sommets conserves, UV conservees)."""
    import trimesh
    F = np.asarray(g.faces)
    garde = np.ones(len(F), dtype=bool)
    garde[retirees] = False
    h = trimesh.Trimesh(vertices=np.asarray(g.vertices).copy(), faces=F[garde].copy(), process=False)
    h.visual = trimesh.visual.TextureVisuals(uv=np.asarray(g.visual.uv).copy(), material=g.visual.material)
    return h, garde


# --------------------------------------------------------------------------------------------------------------------------------------------
# Mesures
# --------------------------------------------------------------------------------------------------------------------------------------------
def aretes_de_bord_soudees(V, F):
    """Nombre d'aretes de bord et d'aretes non manifold sur la copie soudee par position."""
    import bouchage_trous as B
    prep = B.preparer(V, F)
    return int((prep['cnt'] == 1).sum()), int((prep['cnt'] > 2).sum())


def distance_au_manquant(V_nouv, F_nouv, V_orig, F_orig_retirees, echantillons=20000, graine=1):
    """Distance entre le bouchon (faces F_nouv) et la surface qui a ete retiree (verite). Rend un dict en unites du maillage :
    moyenne / max du bouchon vers la verite, et de la verite vers le bouchon (Hausdorff dans les deux sens)."""
    import trimesh
    if len(F_nouv) == 0 or len(F_orig_retirees) == 0:
        return {}
    bouchon = trimesh.Trimesh(V_nouv, F_nouv, process=False)
    verite = trimesh.Trimesh(V_orig, F_orig_retirees, process=False)
    pb, fb = trimesh.sample.sample_surface(bouchon, min(echantillons, 40 * len(F_nouv)), seed=graine)
    pv, fv = trimesh.sample.sample_surface(verite, min(echantillons, 40 * len(F_orig_retirees)), seed=graine)
    from trimesh.proximity import closest_point
    _, d1, t1 = closest_point(verite, pb)
    _, d2, t2 = closest_point(bouchon, pv)
    # sens des normales : normale du bouchon contre celle de la verite au point le plus proche
    nb = bouchon.face_normals[fb]
    nv = verite.face_normals[t1]
    ok = (nb * nv).sum(1)
    aire_b = bouchon.area_faces[fb] * 0 + 1.0
    return {'b2v_moy': float(d1.mean()), 'b2v_max': float(d1.max()), 'v2b_moy': float(d2.mean()), 'v2b_max': float(d2.max()),
            'normales_inversees_pct': float(100.0 * (ok < 0).mean()), 'normales_ecart_moy_deg': float(np.degrees(np.arccos(np.clip(ok, -1, 1))).mean())}


def texture_numpy(g):
    mat = g.visual.material
    img = getattr(mat, 'baseColorTexture', None)
    if img is None:
        return None
    return np.asarray(img.convert('RGB'))


def echantillonner(tex, uv):
    """Couleur (n, 3) de la texture aux coordonnees uv (glTF : v vers le bas)."""
    h, w = tex.shape[:2]
    x = np.clip((uv[:, 0] * w).astype(np.int64), 0, w - 1)
    y = np.clip(((1.0 - uv[:, 1]) * h).astype(np.int64), 0, h - 1)
    return tex[y, x].astype(np.float64)


def orientation_incoherente(V, F):
    """Nombre d'aretes (copie soudee par position) partagees par exactement deux faces qui les parcourent dans le MEME sens (faces voisines
    d'orientations opposees). Un bouchon bien oriente n'en ajoute aucune."""
    import bouchage_trous as B
    prep = B.preparer(V, F)
    ea, eb, inv, cnt = prep['ea'], prep['eb'], prep['inv'], prep['cnt']
    sgn = np.where(ea < eb, 1, -1)
    somme = np.bincount(inv, weights=sgn, minlength=len(cnt))
    return int(((cnt == 2) & (np.abs(somme) == 2)).sum())


def couleur_du_bouchon(g_avant, g_apres, nF_entree, retirees, nF_original_total=None):
    """Compare la couleur du bouchon (texture du maillage rempli, a l'UV du centre de chaque triangle de la rustine) a la couleur VRAIE de la surface
    retiree (texture d'origine). Rend {'ecart_moyen': |moyenne bouchon - moyenne verite| (0..255), 'ecart_gris': meme chose pour un gris 128 (reference
    « bloc gris »), 'ecart_par_triangle': moyenne des |couleur du triangle - couleur du triangle vrai le plus proche|}."""
    import trimesh
    tex0 = texture_numpy(g_avant)
    tex1 = texture_numpy(g_apres)
    if tex0 is None or tex1 is None:
        return {}
    F0 = np.asarray(g_avant.faces)
    uv0 = np.asarray(g_avant.visual.uv)
    verite_uv = uv0[F0[retirees]].mean(axis=1)
    cv = echantillonner(tex0, verite_uv)
    F1 = np.asarray(g_apres.faces)[nF_entree:]
    uv1 = np.asarray(g_apres.visual.uv)
    nouvelle_uv = uv1[F1].mean(axis=1)
    cb = echantillonner(tex1, nouvelle_uv)
    mv, mb = cv.mean(axis=0), cb.mean(axis=0)
    V0 = np.asarray(g_avant.vertices)
    truth = trimesh.Trimesh(V0, F0[retirees], process=False)
    cen = np.asarray(g_apres.vertices)[F1].mean(axis=1)
    _, _, tid = trimesh.proximity.closest_point(truth, cen)
    par_tri = np.abs(cb - cv[tid]).mean()
    return {'ecart_moyen': float(np.abs(mb - mv).mean()), 'ecart_gris': float(np.abs(128.0 - mv).mean()), 'ecart_par_triangle': float(par_tri),
            'ecart_par_triangle_gris': float(np.abs(128.0 - cv[tid]).mean())}
