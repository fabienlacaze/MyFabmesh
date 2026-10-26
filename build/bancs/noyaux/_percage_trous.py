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

    def prendre_graine(rayon_min):
        for f in ordre:
            if all(np.linalg.norm(C[f] - C[u]) > rayon_min for u in utilises):
                utilises.add(int(f))
                return int(f)
        raise RuntimeError('plus de graine')

    arete = prep['arete_moyenne']
    # 1. rond ~60 faces ; 2. irregulier ~150 ; 3. grand ~2500 ; 4. plusieurs petits (5 x ~25)
    for nom, n, bruit in (('rond', 60, 0.0), ('irregulier', 150, 0.9), ('grand', 2500, 0.15)):
        f = prendre_graine(0.25)
        r = region_surface(adj, C, f, n, rng, bruit)
        cas.append({'nom': nom, 'retirees': r, 'graine': f})
    multi = []
    for _ in range(5):
        f = prendre_graine(0.25)
        multi.append(region_surface(adj, C, f, 25, rng, 0.3))
    cas.append({'nom': 'plusieurs', 'retirees': np.unique(np.concatenate(multi)), 'graine': None, 'nombre': 5})
    return cas, prep


def trou_traversant(g, rng_graine=7, rayon_aretes=6.0, epaisseur_max_aretes=40.0, essais=400):
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
    best = None
    for loc, ir, it in zip(locs, idx_ray, idx_tri):
        f = int(cand[ir])
        ep = float(np.linalg.norm(loc - C[f]))
        if ep < 1.0 * arete or ep > epaisseur_max_aretes * arete:
            continue
        if float(np.dot(N[f], N[it])) > -0.9:        # il faut que l'autre paroi soit parallele (tole)
            continue
        if best is None or ep < best[0]:
            best = (ep, f, loc)
    if best is None:
        return None
    ep, f, loc = best
    axe = N[f]
    rel = C - C[f]
    t = rel @ axe
    r = np.linalg.norm(rel - np.outer(t, axe), axis=1)
    rayon = rayon_aretes * arete
    dans = (r < rayon) & (t < arete * 0.5) & (t > -ep - arete * 0.5) & (np.abs(N @ axe) > 0.5)
    return {'nom': 'traversant', 'retirees': np.nonzero(dans)[0], 'graine': f, 'epaisseur': ep}


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
