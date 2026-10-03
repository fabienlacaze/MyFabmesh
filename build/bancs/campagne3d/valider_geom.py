"""Qualite GEOMETRIQUE d'un GLB apres un outil (reduction, remaillage, selection...) : sommets soudes par position, composantes, aretes de bord, aretes non-manifold,
faces degenerees, faces voisines RETOURNEES (normales opposees, produit scalaire < -0,5, en % d'aire : mesure de CLAUDE.md section 13).
Usage : python valider_geom.py <fichier.glb>  -> une ligne JSON."""
import json, os, sys
import numpy as np
import trimesh
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

chemin = sys.argv[1]
r = {'fichier': os.path.basename(chemin)}
try:
    sc = trimesh.load(chemin, force='scene', process=False)
    V = []; F = []; off = 0
    for g in sc.geometry.values():
        if not len(g.faces): continue
        V.append(np.asarray(g.vertices, dtype=np.float64)); F.append(np.asarray(g.faces) + off); off += len(g.vertices)
    V = np.vstack(V); F = np.vstack(F)
    size = float(np.linalg.norm(V.max(0) - V.min(0)))
    q = np.round(V / (size * 1e-6)).astype(np.int64)
    _, idx, inv = np.unique(q, axis=0, return_index=True, return_inverse=True)
    Vw = V[idx]; Fw = inv.reshape(-1)[F]
    r['faces'] = int(len(Fw)); r['sommets_soudes'] = int(len(Vw))
    # faces degenerees (deux sommets confondus)
    deg = (Fw[:, 0] == Fw[:, 1]) | (Fw[:, 1] == Fw[:, 2]) | (Fw[:, 0] == Fw[:, 2])
    Fw = Fw[~deg]; r['faces_degenerees'] = int(deg.sum())
    m = trimesh.Trimesh(Vw, Fw, process=False)
    area = m.area_faces; r['aire'] = round(float(area.sum()), 4)
    # aretes
    E = np.sort(np.vstack([Fw[:, [0, 1]], Fw[:, [1, 2]], Fw[:, [2, 0]]]), axis=1)
    _, cnt = np.unique(E, axis=0, return_counts=True)
    r['aretes_bord'] = int((cnt == 1).sum()); r['aretes_non_manifold'] = int((cnt > 2).sum()); r['aretes'] = int(len(cnt))
    # composantes
    n = len(Vw)
    A = coo_matrix((np.ones(len(E)), (E[:, 0], E[:, 1])), shape=(n, n))
    nc, lab = connected_components(A, directed=False)
    used = np.zeros(n, bool); used[Fw.ravel()] = True
    sizes = np.bincount(lab[Fw[:, 0]])
    sizes = sizes[sizes > 0]
    r['composantes'] = int(len(sizes)); r['composantes_petites_pct'] = round(float(100 * (sizes < 0.001 * len(Fw)).sum() / max(1, len(sizes))), 1)
    # faces voisines retournees
    adj = m.face_adjacency
    nrm = m.face_normals
    dots = np.einsum('ij,ij->i', nrm[adj[:, 0]], nrm[adj[:, 1]])
    aire_pair = area[adj[:, 0]] + area[adj[:, 1]]
    r['retournees_pct_aire'] = round(float(100 * aire_pair[dots < -0.5].sum() / max(aire_pair.sum(), 1e-12)), 2)
    # distribution des angles de faces : fraction d'aretes tres aigues (> 120 degres entre normales)
    r['aretes_vives_pct'] = round(float(100 * (dots < -0.5).mean()), 2)
    # qualite des triangles : rapport d'aspect (1 = equilateral)
    p0, p1, p2 = Vw[Fw[:, 0]], Vw[Fw[:, 1]], Vw[Fw[:, 2]]
    l0 = np.linalg.norm(p1 - p2, axis=1); l1 = np.linalg.norm(p0 - p2, axis=1); l2 = np.linalg.norm(p0 - p1, axis=1)
    ar = 4 * np.sqrt(3) * area / np.maximum(l0 ** 2 + l1 ** 2 + l2 ** 2, 1e-18)
    r['qualite_triangle_moy'] = round(float(ar.mean()), 3); r['triangles_minces_pct'] = round(float(100 * (ar < 0.1).mean()), 1)
    r['boite'] = [round(float(x), 3) for x in (Vw.max(0) - Vw.min(0))]
except Exception as e:  # noqa
    r['erreur'] = repr(e)[:200]
print(json.dumps(r, ensure_ascii=False))
