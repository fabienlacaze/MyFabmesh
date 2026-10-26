"""Banc Modal (CPU, SANS deploiement) du bouchon lisse de Fill holes sur la VRAIE image de production (2026-10-26).

Pourquoi : un test local passe avec les paquets du poste ; ici on verifie que l'image Modal fournit tout ce que modal_app/bouchage_lisse.py importe
(scipy.spatial.Delaunay / Qhull, scipy.sparse.linalg, PIL, trimesh) et que modal_app._mesh_op.fill_holes ferme des trous reels : sphere texturee
percee de trois trous, GLB en entree, GLB en sortie, aucune face / sommet / UV d'entree touche.

Usage (quelques centimes, CPU) :
    PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python -m modal run modal_app/test_remplissage_trous.py
"""
import modal

from modal_app.app import image

app = modal.App("myfabmesh-test-remplissage-trous", image=image)


@app.function(cpu=2.0, timeout=600)
def essai():
    import io
    import time

    import numpy as np
    import trimesh
    from PIL import Image

    from modal_app import _mesh_op
    from modal_app.bouchage_trous import preparer

    m = trimesh.creation.icosphere(subdivisions=4)
    V = np.asarray(m.vertices, dtype=np.float64)
    F = np.asarray(m.faces, dtype=np.int64)
    u = 0.5 + np.arctan2(V[:, 1], V[:, 0]) / (2 * np.pi)
    v = 0.5 + np.arcsin(np.clip(V[:, 2], -1, 1)) / np.pi
    UV = np.stack([u, v], axis=1)
    c = V[F].mean(axis=1)
    retirer = np.zeros(len(F), dtype=bool)
    for centre, k in (([-1, 0, 0], 14), ([0.3, 0.9, 0.2], 6), ([0, 0, 1], 22)):
        retirer[np.argsort(np.linalg.norm(c - np.asarray(centre, dtype=np.float64), axis=1))[:k]] = True
    F2 = F[~retirer]
    img = Image.fromarray((np.random.RandomState(1).rand(128, 128, 3) * 255).astype(np.uint8))
    mat = trimesh.visual.material.PBRMaterial(baseColorTexture=img)
    perce = trimesh.Trimesh(vertices=V, faces=F2, process=False, visual=trimesh.visual.TextureVisuals(uv=UV, material=mat))
    entree = trimesh.Scene(perce).export(file_type='glb')

    t = time.time()
    sortie, stats = _mesh_op.fill_holes(entree, 3, 1_000_000)
    duree = time.time() - t
    sc = trimesh.load(io.BytesIO(sortie), file_type='glb', force='scene', process=False)
    g = list(sc.geometry.values())[0]
    Vn, Fn = np.asarray(g.vertices), np.asarray(g.faces)
    sc0 = trimesh.load(io.BytesIO(entree), file_type='glb', force='scene', process=False)
    g0 = list(sc0.geometry.values())[0]
    nF, nV = len(g0.faces), len(g0.vertices)
    prep = preparer(Vn, Fn)
    rapport = {
        'duree_s': round(duree, 2), 'stats': {k: stats[k] for k in ('verdict', 'holes_filled', 'holes_remaining', 'holes_filled_delta_faces')},
        'aretes_de_bord_apres_soudure': int((prep['cnt'] == 1).sum()),
        'faces_entree_intactes': bool(np.array_equal(Fn[:nF], np.asarray(g0.faces))),
        'sommets_entree_intacts': bool(np.array_equal(Vn[:nV], np.asarray(g0.vertices))),
        'uv_entree_intactes': bool(np.array_equal(np.asarray(g.visual.uv)[:nV], np.asarray(g0.visual.uv))),
        'sommets_ajoutes': int(len(Vn) - nV), 'faces_ajoutees': int(len(Fn) - nF),
    }
    assert rapport['aretes_de_bord_apres_soudure'] == 0, rapport
    assert rapport['faces_entree_intactes'] and rapport['sommets_entree_intacts'] and rapport['uv_entree_intactes'], rapport
    assert stats['holes_filled'] == 3 and stats['verdict'] == 'CLOSED_OK', rapport
    return rapport


@app.local_entrypoint()
def main():
    import json
    print(json.dumps(essai.remote(), indent=1))
