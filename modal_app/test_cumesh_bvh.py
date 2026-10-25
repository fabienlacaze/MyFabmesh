"""Banc GPU : le BVH MIT de cubvh (ashawkey de1badf, compile dans l'image Modal du maillage) rend-il les BONNES reponses ?

POURQUOI (2026-10-15). Le BVH d'instant-ngp (licence NVIDIA non commerciale) est remplace par une reecriture MIT
(ashawkey/cubvh c7379c0). Son auteur l'a ecrite et testee sur du materiel AMD ; son message de commit dit qu'une compilation
et un essai sur NVIDIA seraient « bienvenus ». Nous l'appelons en production : o_voxel.postprocess.to_glb (distances au
plus proche triangle : remaillage + cuisson de la texture), modal_app/_mesh.py::densifier (lancers de rayons).

LA REFERENCE N'EST PAS L'ANCIEN BVH (on ne recompile pas du code sous licence non commerciale pour comparer) : c'est un
calcul EXHAUSTIF en numpy float64, independant (Ericson, « Real-Time Collision Detection », 5.1.5, pour le plus proche
point ; Moller-Trumbore pour les rayons). Les contrats mesures sont ceux dont dependent nos appels :
  - unsigned_distance : distance juste, et poids barycentriques `uvw` qui redonnent bien le point le plus proche
    (to_glb recompose la position d'origine avec uvw) ; aucune valeur non finie, y compris avec des triangles degeneres ;
  - ray_trace : memes touches/rates que la reference (hors rasants), memes profondeurs ; un rate rend face_id = -1 ;
  - plusieurs BVH successifs dans un meme processus (un conteneur chaud enchaine les generations) : reponses stables.
Et, pour information, les durees de construction (cote hote) et de requetes sur un maillage de 327 680 triangles.

PROTOCOLE (un lancement, ~0,05-0,10 $ ; ne deploie rien) :
    PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python -m modal run modal_app/test_cumesh_bvh.py
Premier lancement apres le changement : Modal CONSTRUIT la couche CuMesh de mesh_image (~10-15 min, gardes de licence
comprises) ; les lancements suivants et le deploiement reutilisent l'image. Verdict dans la cle « verdict » du JSON :
`banc_valide` doit etre vrai. Les fonctions de calcul (numpy) sont testees sur CPU par
build/bancs/noyaux/test_banc_bvh_cumesh.py (FABMESH_BANC_SANS_MODAL=1 : le module se charge alors sans Modal).
"""
import json
import os
import time

SANS_MODAL = os.environ.get('FABMESH_BANC_SANS_MODAL') == '1'
NIVEAUX_PETIT = 4               # 5 120 triangles (reference exhaustive)
NIVEAUX_GRAND = 7               # 327 680 triangles (durees)
RAYON = 0.4
N_POINTS = 1500
N_RAYONS = 1500
N_DEGENERES = 60
SEUIL_DISTANCE = 1e-5           # float32 : coordonnees ~0,5 -> erreurs ~1e-7 attendues
SEUIL_RECOMPOSITION = 1e-5
SEUIL_BARYCENTRIQUE = 1e-4
SEUIL_PROFONDEUR = 1e-4
FRACTION_DESACCORD_RAYONS = 0.002     # touche/rate differents, tolere pour les rayons rasants


# ---------------------------------------------------------------------------------------------------------
# Calculs sur CPU (numpy) : maillage, references exhaustives, comparaisons, verdict
# ---------------------------------------------------------------------------------------------------------
def icosphere(niveaux, rayon=RAYON):
    """Sphere fermee : icosaedre subdivise. Rend (sommets float32, faces int32)."""
    import numpy as np
    p = (1.0 + 5 ** 0.5) / 2.0
    v = np.array([[-1, p, 0], [1, p, 0], [-1, -p, 0], [1, -p, 0], [0, -1, p], [0, 1, p],
                  [0, -1, -p], [0, 1, -p], [p, 0, -1], [p, 0, 1], [-p, 0, -1], [-p, 0, 1]], dtype=np.float64)
    f = np.array([[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4],
                  [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8],
                  [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]], dtype=np.int64)
    v /= np.linalg.norm(v, axis=1, keepdims=True)
    for _ in range(niveaux):
        a, b, c = f[:, 0], f[:, 1], f[:, 2]
        aretes = np.sort(np.concatenate([np.stack([a, b], 1), np.stack([b, c], 1), np.stack([c, a], 1)]), axis=1)
        uniques, inv = np.unique(aretes, axis=0, return_inverse=True)
        milieux = (v[uniques[:, 0]] + v[uniques[:, 1]]) / 2.0
        ab, bc, ca = (len(v) + np.asarray(inv).reshape(-1)).reshape(3, -1)
        f = np.concatenate([np.stack([a, ab, ca], 1), np.stack([ab, b, bc], 1),
                            np.stack([ca, bc, c], 1), np.stack([ab, bc, ca], 1)])
        v = np.concatenate([v, milieux])
        v /= np.linalg.norm(v, axis=1, keepdims=True)
    return (v * rayon).astype(np.float32), f.astype(np.int32)


def ajouter_degeneres(f, n=N_DEGENERES, graine=1):
    """Ajoute n triangles d'aire nulle (un sommet repete : (i, i, j)) faits de VRAIS sommets du maillage : ils ne
    changent aucune distance ni aucun rayon, mais piegent un BVH qui les laisserait gagner (NaN, distance fausse).
    Rend (faces avec degeneres, indices des degeneres)."""
    import numpy as np
    rng = np.random.default_rng(graine)
    nv = int(np.max(f)) + 1
    i = rng.integers(0, nv, n)
    j = rng.integers(0, nv, n)
    deg = np.stack([i, i, j], axis=1).astype(f.dtype)
    ordre = rng.permutation(len(f) + n)           # melanges aux vrais triangles
    toutes = np.concatenate([f, deg])[ordre]
    return toutes, np.flatnonzero(ordre >= len(f))


def distances_reference(p, v, f):
    """Plus proche triangle de p (3,) parmi f : (distance, indice, poids barycentriques (a, b, c)), numpy float64,
    Ericson 5.1.5. Les triangles d'aire nulle sont ignores (comme le BVH MIT). Vectorise sur les triangles."""
    import numpy as np
    v = np.asarray(v, dtype=np.float64)
    a, b, c = v[f[:, 0]], v[f[:, 1]], v[f[:, 2]]
    p = np.asarray(p, dtype=np.float64)
    ab, ac, ap = b - a, c - a, p - a
    aire2 = np.einsum('ij,ij->i', np.cross(ab, ac), np.cross(ab, ac))
    ok = aire2 > 0
    d1, d2 = np.einsum('ij,ij->i', ab, ap), np.einsum('ij,ij->i', ac, ap)
    bp = p - b
    d3, d4 = np.einsum('ij,ij->i', ab, bp), np.einsum('ij,ij->i', ac, bp)
    cp = p - c
    d5, d6 = np.einsum('ij,ij->i', ab, cp), np.einsum('ij,ij->i', ac, cp)
    vc, vb, va = d1 * d4 - d3 * d2, d5 * d2 - d1 * d6, d3 * d6 - d5 * d4
    n = len(f)
    q = np.zeros((n, 3))
    w = np.zeros((n, 3))                         # poids (a, b, c)
    fait = np.zeros(n, dtype=bool)

    def poser(masque, point, poids):
        nonlocal fait
        m = masque & ~fait
        q[m] = point[m]
        w[m] = poids[m]
        fait |= m

    un, zero = np.ones(n), np.zeros(n)
    poser((d1 <= 0) & (d2 <= 0), a, np.stack([un, zero, zero], 1))                       # sommet a
    poser((d3 >= 0) & (d4 <= d3), b, np.stack([zero, un, zero], 1))                      # sommet b
    poser((d6 >= 0) & (d5 <= d6), c, np.stack([zero, zero, un], 1))                      # sommet c
    with np.errstate(divide='ignore', invalid='ignore'):
        t = d1 / (d1 - d3)
        poser((vc <= 0) & (d1 >= 0) & (d3 <= 0), a + t[:, None] * ab, np.stack([1 - t, t, zero], 1))        # arete ab
        t = d2 / (d2 - d6)
        poser((vb <= 0) & (d2 >= 0) & (d6 <= 0), a + t[:, None] * ac, np.stack([1 - t, zero, t], 1))       # arete ac
        t = (d4 - d3) / ((d4 - d3) + (d5 - d6))
        poser((va <= 0) & ((d4 - d3) >= 0) & ((d5 - d6) >= 0), b + t[:, None] * (c - b),
              np.stack([zero, 1 - t, t], 1))                                                                  # arete bc
        denom = 1.0 / (va + vb + vc)
        vv, ww = vb * denom, vc * denom
        poser(np.ones(n, dtype=bool), a + ab * vv[:, None] + ac * ww[:, None], np.stack([1 - vv - ww, vv, ww], 1))   # interieur
    d = np.linalg.norm(q - p, axis=1)
    d = np.where(ok, d, np.inf)
    i = int(np.argmin(d))
    return float(d[i]), i, w[i]


def rayon_reference(o, direction, v, f):
    """Premiere touche (t >= 0, double face) du rayon parmi f : (t, indice) ou (inf, -1). Moller-Trumbore, float64,
    triangles d'aire nulle ignores."""
    import numpy as np
    v = np.asarray(v, dtype=np.float64)
    a, b, c = v[f[:, 0]], v[f[:, 1]], v[f[:, 2]]
    o = np.asarray(o, dtype=np.float64)
    d = np.asarray(direction, dtype=np.float64)
    e1, e2 = b - a, c - a
    h = np.cross(d, e2)
    det = np.einsum('ij,ij->i', e1, h)
    with np.errstate(divide='ignore', invalid='ignore'):
        inv = 1.0 / det
        s = o - a
        u = np.einsum('ij,ij->i', s, h) * inv
        q = np.cross(s, e1)
        w = (q @ d) * inv
        t = np.einsum('ij,ij->i', e2, q) * inv
    with np.errstate(invalid='ignore'):
        ok = (np.abs(det) > 1e-14) & (u >= 0) & (u <= 1) & (w >= 0) & (u + w <= 1) & (t >= 0)
    if not ok.any():
        return float('inf'), -1
    tt = np.where(ok, t, np.inf)
    i = int(np.argmin(tt))
    return float(tt[i]), i


def points_et_rayons(n_points=N_POINTS, n_rayons=N_RAYONS, graine=7):
    """Points (dedans, dehors, tout pres de la surface) et rayons tires vers le maillage depuis l'exterieur."""
    import numpy as np
    rng = np.random.default_rng(graine)
    n3 = n_points // 3
    alea = rng.uniform(-0.6, 0.6, (n_points - 2 * n3, 3))
    sur = rng.normal(size=(n3, 3))
    sur = sur / np.linalg.norm(sur, axis=1, keepdims=True) * (RAYON + rng.normal(0, 0.003, (n3, 1)))
    dedans = rng.normal(size=(n3, 3))
    dedans = dedans / np.linalg.norm(dedans, axis=1, keepdims=True) * rng.uniform(0.0, RAYON * 0.95, (n3, 1))
    pts = np.concatenate([alea, sur, dedans]).astype(np.float32)
    dep = rng.normal(size=(n_rayons, 3))
    dep = dep / np.linalg.norm(dep, axis=1, keepdims=True) * 0.9
    cible = rng.normal(0, 0.25, (n_rayons, 3))
    direc = cible - dep
    direc = direc / np.linalg.norm(direc, axis=1, keepdims=True)
    return pts, dep.astype(np.float32), direc.astype(np.float32)


def comparer_distances(v, f, pts, distances, face_id, uvw, f_vrais=None, degeneres=()):
    """Compare les reponses du BVH aux references exhaustives. `f` = faces donnees au BVH (degeneres compris) ;
    `f_vrais` = faces de reference (sans degeneres) ; si None, f. Les indices de face_id sont ceux de `f` ;
    `degeneres` = indices (dans f) des triangles d'aire nulle, qui ne doivent JAMAIS etre rendus."""
    import numpy as np
    vv = np.asarray(v, dtype=np.float64)
    fr = f if f_vrais is None else f_vrais
    distances, face_id, uvw = (np.asarray(x, dtype=np.float64) if x is not None else None for x in (distances, face_id, uvw))
    erreurs, recomp, bary = [], [], []
    non_finis = int((~np.isfinite(distances)).sum()) + (int((~np.isfinite(uvw)).sum()) if uvw is not None else 0)
    hors = int(((face_id < 0) | (face_id >= len(f))).sum())
    degeneres_rendus = int(np.isin(face_id, np.asarray(list(degeneres), dtype=np.float64)).sum()) if len(degeneres) else 0
    for k in range(len(pts)):
        dref, _, _ = distances_reference(pts[k], vv, fr)
        erreurs.append(abs(float(distances[k]) - dref))
        if uvw is not None and 0 <= int(face_id[k]) < len(f):
            tri = f[int(face_id[k])]
            q = uvw[k, 0] * vv[tri[0]] + uvw[k, 1] * vv[tri[1]] + uvw[k, 2] * vv[tri[2]]
            recomp.append(abs(float(np.linalg.norm(q - pts[k].astype(np.float64))) - float(distances[k])))
            bary.append(abs(float(uvw[k].sum()) - 1.0))
    return {'points': int(len(pts)), 'non_finis': non_finis, 'face_id_hors_borne': hors,
            'degeneres_rendus': degeneres_rendus,
            'erreur_distance_max': max(erreurs) if erreurs else 0.0,
            'recomposition_max': max(recomp) if recomp else 0.0, 'somme_barycentrique_max': max(bary) if bary else 0.0}


def comparer_rayons(v, f, o, d, depth, face_id, f_vrais=None):
    import numpy as np
    vv = np.asarray(v, dtype=np.float64)
    fr = f if f_vrais is None else f_vrais
    depth, face_id = np.asarray(depth, dtype=np.float64), np.asarray(face_id)
    desaccords, err = 0, 0.0
    manques_mal_signales = 0
    for k in range(len(o)):
        tref, _ = rayon_reference(o[k], d[k], vv, fr)
        touche = int(face_id[k]) >= 0
        if touche != np.isfinite(tref):
            desaccords += 1
            continue
        if touche:
            err = max(err, abs(float(depth[k]) - tref) / (1.0 + tref))
        elif int(face_id[k]) != -1:
            manques_mal_signales += 1
    return {'rayons': int(len(o)), 'desaccords_touche_rate': desaccords,
            'fraction_desaccord': desaccords / max(1, len(o)), 'erreur_profondeur_rel_max': err,
            'rate_sans_face_id_moins_un': manques_mal_signales}


def verdict(res):
    """res = sortie de mesurer_dans_ce_processus."""
    pb = []
    for nom, r in res.get('distances', {}).items():
        if r['non_finis'] or r['face_id_hors_borne']:
            pb.append(f'{nom} : {r["non_finis"]} valeur(s) non finie(s), {r["face_id_hors_borne"]} face_id hors borne')
        if r['degeneres_rendus']:
            pb.append(f'{nom} : {r["degeneres_rendus"]} triangle(s) d\'aire nulle rendu(s) comme plus proche')
        if r['somme_barycentrique_max'] > SEUIL_BARYCENTRIQUE:
            pb.append(f'{nom} : somme des poids uvw != 1 ({r["somme_barycentrique_max"]:.2e})')
        if r['erreur_distance_max'] > SEUIL_DISTANCE:
            pb.append(f'{nom} : erreur de distance {r["erreur_distance_max"]:.2e} > {SEUIL_DISTANCE:.0e}')
        if r['recomposition_max'] > SEUIL_RECOMPOSITION:
            pb.append(f'{nom} : uvw ne redonne pas le point le plus proche ({r["recomposition_max"]:.2e})')
    for nom, r in res.get('rayons', {}).items():
        if r['fraction_desaccord'] > FRACTION_DESACCORD_RAYONS:
            pb.append(f'{nom} : {r["desaccords_touche_rate"]} rayon(s) en desaccord touche/rate sur {r["rayons"]}')
        if r['erreur_profondeur_rel_max'] > SEUIL_PROFONDEUR:
            pb.append(f'{nom} : profondeur erronee ({r["erreur_profondeur_rel_max"]:.2e})')
        if r['rate_sans_face_id_moins_un']:
            pb.append(f'{nom} : {r["rate_sans_face_id_moins_un"]} rate(s) sans face_id = -1')
    if not res.get('distances') or not res.get('rayons'):
        pb.append('aucune mesure')
    if res.get('repetitions_identiques') is False:
        pb.append('deux BVH successifs sur le meme maillage ne donnent pas les memes reponses')
    return {'banc_valide': not pb, 'problemes': pb}


# ---------------------------------------------------------------------------------------------------------
# GPU
# ---------------------------------------------------------------------------------------------------------
def mesurer_dans_ce_processus(repetitions=3, cumesh_module=None, device='cuda', niveaux_grand=NIVEAUX_GRAND,
                              n_requetes=1_000_000, n_points=N_POINTS, n_rayons=N_RAYONS):
    """Dans l'image Modal du maillage (cumesh installe = celui de la construction). Rend un dict JSON-isable.
    `cumesh_module`, `device` et les tailles ne servent qu'aux tests CPU (un faux cumesh exact, sans GPU)."""
    import numpy as np
    import torch
    if cumesh_module is None:
        import cumesh as cumesh_module
    cumesh = cumesh_module

    def attendre():
        if device == 'cuda':
            torch.cuda.synchronize()

    sortie = {'cumesh': getattr(cumesh, '__file__', '?'), 'distances': {}, 'rayons': {}, 'durees': {}}
    v, f = icosphere(NIVEAUX_PETIT)
    fd, idx_deg = ajouter_degeneres(f)
    pts, ro, rd = points_et_rayons(n_points, n_rayons)
    reponses = []
    for nom, faces in (('sphere', f), ('sphere_avec_degeneres', fd)):
        for rep in range(int(repetitions)):
            bvh = cumesh.cuBVH(v, torch.from_numpy(faces.astype(np.int32)))
            dist, fid, uvw = bvh.unsigned_distance(torch.from_numpy(pts).to(device), return_uvw=True)
            _, rfid, rdep = bvh.ray_trace(torch.from_numpy(ro).to(device), torch.from_numpy(rd).to(device))
            attendre()
            dist, fid, uvw, rfid, rdep = (x.cpu().numpy() for x in (dist, fid, uvw, rfid, rdep))
            if rep == 0:
                # references sur les VRAIS triangles ; face_id est un indice de `faces` (degeneres compris)
                sortie['distances'][nom] = comparer_distances(v, faces, pts, dist, fid, uvw, f_vrais=f,
                                                              degeneres=idx_deg if faces is fd else ())
                sortie['rayons'][nom] = comparer_rayons(v, faces, ro, rd, rdep, rfid, f_vrais=f)
            reponses.append((nom, rep, dist.copy(), rdep.copy()))
    identiques = True
    for nom in ('sphere', 'sphere_avec_degeneres'):
        r = [x for x in reponses if x[0] == nom]
        identiques &= all(np.array_equal(r[0][2], x[2]) and np.array_equal(r[0][3], x[3]) for x in r[1:])
    sortie['repetitions_identiques'] = bool(identiques)
    # durees (information) sur un grand maillage
    vg, fg = icosphere(niveaux_grand)
    t0 = time.time()
    bvh = cumesh.cuBVH(vg, torch.from_numpy(fg))
    t_build = time.time() - t0
    q = torch.from_numpy(np.random.default_rng(3).uniform(-0.6, 0.6, (n_requetes, 3)).astype(np.float32)).to(device)
    bvh.unsigned_distance(q[:min(1000, n_requetes)])
    attendre()
    t0 = time.time()
    d, _, _ = bvh.unsigned_distance(q)
    attendre()
    t_dist = time.time() - t0
    sortie['durees'] = {'triangles': int(len(fg)), 'construction_hote_s': round(t_build, 3), 'requetes': int(n_requetes),
                        'distance_s': round(t_dist, 3), 'distance_non_finie': int((~torch.isfinite(d)).sum())}
    sortie['verdict'] = verdict(sortie)
    return sortie


if not SANS_MODAL:
    import modal

    from modal_app.app import mesh_image

    app = modal.App('myfabmesh-test-cumesh-bvh', image=mesh_image)

    @app.function(gpu='L40S', timeout=1800)
    def mesurer(repetitions: int = 3):
        return mesurer_dans_ce_processus(repetitions)

    @app.local_entrypoint()
    def main(repetitions: int = 3):
        print(json.dumps(mesurer.remote(repetitions), indent=1, ensure_ascii=False))
