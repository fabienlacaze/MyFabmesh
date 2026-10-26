"""Banc Modal (CPU, SANS deploiement) de la reparation de PEAU de Fill holes sur la VRAIE image de production (2026-10-26).

Pourquoi : mesurer la duree REELLE de modal_app._mesh_op.fill_holes(skin_repair=True) et de la detection seule sur un maillage TRELLIS de 500 000 faces
(le worker coupe a 120 s et Cloudflare a 100 s : 524) ; verifier que l'image fournit numba (sinon le rendu numpy, plus lent, est utilise).
Le conteneur de production (mesh_router) n'a pas de `cpu=` : il recoit le defaut de Modal ; on mesure ce defaut ET 2 coeurs.

Usage (quelques centimes, CPU) :
    PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python -m modal run modal_app/test_remplissage_peau.py --glb C:/tmp/benchy/e6dc04bd64284e7aaeda9876331cbee8.glb
"""
import modal

from modal_app.app import image

app = modal.App("myfabmesh-test-remplissage-peau", image=image)


def _mesurer(glb: bytes):
    import io
    import time

    import numpy as np
    import trimesh

    from modal_app import _mesh_op
    from modal_app import bouchage_ouverture
    from modal_app import bouchage_peau

    rapport = {'numba': bool(bouchage_peau._AVEC_NUMBA), 'numba_ouvertures': bool(bouchage_ouverture._AVEC_NUMBA), 'octets_entree': len(glb)}
    t = time.time()
    _, det = _mesh_op.fill_holes(glb, 3, 2000, detect_only=True)
    rapport['detection_seule'] = {'duree_s': round(time.time() - t, 1), 'trous': det['nombre']}
    t = time.time()
    sortie, stats = _mesh_op.fill_holes(glb, 3, 2000, skin_repair=True)
    rapport['reparation'] = {'duree_s': round(time.time() - t, 1), 'trous_de_peau': stats.get('skin_holes_filled'),
                             'faces_ajoutees': stats.get('holes_filled_delta_faces'), 'verdict': stats.get('verdict')}
    # GRANDES OUVERTURES (case « Also close large openings », 26/10) : a mesurer sur le Pikachu (--glb C:/tmp/pikachu.glb), la limite de Cloudflare est 100 s
    t = time.time()
    try:
        so, st_o = _mesh_op.fill_holes(glb, 3, 2000, large_openings=True)
        rapport['grandes_ouvertures'] = {'duree_s': round(time.time() - t, 1), 'ouvertures_bouchees': st_o.get('large_openings_filled'),
                                         'faces_ajoutees': st_o.get('holes_filled_delta_faces'), 'verdict': st_o.get('verdict')}
    except RuntimeError as e:
        rapport['grandes_ouvertures'] = {'duree_s': round(time.time() - t, 1), 'refus': str(e)[:160]}
    g0 = list(trimesh.load(io.BytesIO(glb), file_type='glb', force='scene', process=False).geometry.values())[0]
    g1 = list(trimesh.load(io.BytesIO(sortie), file_type='glb', force='scene', process=False).geometry.values())[0]
    rapport['prefixe_intact'] = bool(np.array_equal(np.asarray(g1.faces)[:len(g0.faces)], np.asarray(g0.faces)))
    # sans la case : refus « Nothing to fill » comme avant, en quelques secondes
    t = time.time()
    try:
        _mesh_op.fill_holes(glb, 3, 2000)
        rapport['sans_option'] = 'A BOUCHE QUELQUE CHOSE (anormal)'
    except RuntimeError as e:
        rapport['sans_option'] = {'duree_s': round(time.time() - t, 1), 'refus': str(e)[:160]}
    return rapport


@app.function(timeout=900)
def essai_defaut(glb: bytes):
    return _mesurer(glb)


@app.function(cpu=2.0, timeout=900)
def essai_2_coeurs(glb: bytes):
    return _mesurer(glb)


@app.function(cpu=4.0, timeout=900)
def essai_4_coeurs(glb: bytes):
    return _mesurer(glb)


@app.local_entrypoint()
def main(glb: str = 'C:/tmp/benchy/e6dc04bd64284e7aaeda9876331cbee8.glb'):
    import json
    with open(glb, 'rb') as f:
        donnees = f.read()
    print('defaut :', json.dumps(essai_defaut.remote(donnees), indent=1))
    print('2 coeurs :', json.dumps(essai_2_coeurs.remote(donnees), indent=1))
    print('4 coeurs :', json.dumps(essai_4_coeurs.remote(donnees), indent=1))
