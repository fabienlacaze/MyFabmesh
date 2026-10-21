# -*- coding: utf-8 -*-
"""Que fait AUJOURD'HUI le Fill holes du produit sur un maillage reel ? (20/10/2026)

Lance modal_app/_mesh_op.py::fill_holes (le meme code que le site, hors Modal) sur un GLB et rend : verdict, exception eventuelle
(garde 1 « aucun trou », garde 2 « plus de 5 % des faces perdues »), nombre de faces avant / apres, et la sensibilite de sa
fusion de sommets (merge_vertices a 3 decimales) : part des faces qui deviennent degenerees.

Usage : python produit_fill_holes.py <glb> [--min 3] [--max 1000000]
A lancer sous lourd.sh pour un maillage de 500 000 faces (trimesh charge la texture en memoire).
"""
import argparse
import io
import json
import os
import sys
import time

RACINE = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
sys.path.insert(0, RACINE)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('glb')
    ap.add_argument('--min', type=int, default=3)
    ap.add_argument('--max', type=int, default=1_000_000)
    ap.add_argument('--sortie', help='ecrit le GLB rendu par fill_holes (pour le mesurer ensuite avec diagnostic_matiere.py)')
    a = ap.parse_args()
    import numpy as np
    import trimesh
    from modal_app import _mesh_op
    octets = open(a.glb, 'rb').read()
    sc = trimesh.load(io.BytesIO(octets), file_type='glb', force='scene')
    faces_avant = sum(len(g.faces) for g in sc.geometry.values() if hasattr(g, 'faces'))
    # sensibilite de la fusion de sommets du produit : digits = round(-log10(clip(diag x 1e-3)))
    g = [x for x in sc.geometry.values() if hasattr(x, 'faces')][0]
    diag = float(np.linalg.norm(g.bounds[1] - g.bounds[0]))
    tol = float(np.clip(diag * 1e-3, 1e-6, diag * 1e-2))
    digits = max(1, int(round(-np.log10(tol))))
    q = np.round(np.asarray(g.vertices) * 10 ** digits).astype(np.int64)
    _, inv = np.unique(q, axis=0, return_inverse=True)
    inv = inv.reshape(-1)
    Fm = inv[np.asarray(g.faces)]
    deg = int(((Fm[:, 0] == Fm[:, 1]) | (Fm[:, 1] == Fm[:, 2]) | (Fm[:, 0] == Fm[:, 2])).sum())
    out = {'glb': a.glb.replace('\\', '/'), 'faces_avant': faces_avant, 'diag': round(diag, 4), 'tol_produit': tol, 'decimales_fusion': digits,
           'faces_degenerees_apres_fusion_produit': deg,
           'pct_faces_degenerees_apres_fusion_produit': round(100.0 * deg / max(len(g.faces), 1), 2)}
    del sc, g
    t = time.time()
    try:
        octets_sortie, stats = _mesh_op.fill_holes(octets, a.min, a.max)
        out['resultat'] = 'ok'
        if a.sortie:
            open(a.sortie, 'wb').write(octets_sortie)
            out['sortie'] = a.sortie.replace('\\', '/')
        out['verdict'] = stats.get('verdict')
        out['faces_ajoutees'] = stats.get('holes_filled_delta_faces')
        out['meshes'] = [{k: m.get(k) for k in ('boundary_edges', 'faces_before', 'faces_after', 'holes_filled', 'skipped_too_small',
                                                'skipped_too_big', 'degenerate_loops', 'unfillable')}
                         for m in stats.get('meshes', [])]
    except Exception as e:  # rien a boucher -> RuntimeError EXPLIQUEE (noyau bouchage_trous)
        out['resultat'] = 'refus'
        out['message'] = '%s: %s' % (type(e).__name__, e)
    out['duree_s'] = round(time.time() - t, 1)
    print(json.dumps(out, ensure_ascii=False))


if __name__ == '__main__':
    main()
