# -*- coding: utf-8 -*-
"""Non-regression de scripts/detect_voxel.py (detecteur de trous de peau par grille + visibilite).

1. Cas synthetique : deux spheres concentriques (peau exterieure percee, peau interieure en retrait) -> 1 trou attendu
   au bon endroit ; sphere saine -> aucun trou.
2. Cas reels (sautes si les GLB sont absents) : moissonneuse saine (peu de detections attendues).
"""
import os
import sys

import numpy as np

RACINE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
sys.path.insert(0, os.path.join(RACINE, 'scripts'))
import detect_voxel as DV  # noqa: E402


def _sphere(n_lat=120, n_lon=240, r=1.0):
    lat = np.linspace(0, np.pi, n_lat)
    lon = np.linspace(0, 2 * np.pi, n_lon, endpoint=False)
    V = [[0, 0, r], [0, 0, -r]]
    for a in lat[1:-1]:
        for b in lon:
            V.append([r * np.sin(a) * np.cos(b), r * np.sin(a) * np.sin(b), r * np.cos(a)])
    V = np.array(V, float)
    F = []
    idx = lambda i, j: 2 + (i - 1) * n_lon + (j % n_lon)
    for j in range(n_lon):
        F.append([0, idx(1, j), idx(1, j + 1)])
        F.append([1, idx(n_lat - 2, j + 1), idx(n_lat - 2, j)])
    for i in range(1, n_lat - 2):
        for j in range(n_lon):
            F.append([idx(i, j), idx(i + 1, j), idx(i, j + 1)])
            F.append([idx(i, j + 1), idx(i + 1, j), idx(i + 1, j + 1)])
    return V, np.array(F)


def _double_peau(trou):
    Ve, Fe = _sphere(r=1.0)
    Vi, Fi = _sphere(r=0.93)
    if trou:
        c = Ve[Fe].mean(1)
        d = np.linalg.norm(c - np.array([1.0, 0, 0]), axis=1)
        Fe = Fe[d > 0.14]
    V = np.concatenate([Ve, Vi])
    F = np.concatenate([Fe, Fi + len(Ve)])
    return V, F


def test_synthetique():
    V, F = _double_peau(True)
    res = DV.detect(V, F)
    proches = [r for r in res if np.linalg.norm(np.array(r['centre']) - np.array([0.96, 0, 0])) < 0.25]
    assert proches, 'le trou de la peau exterieure doit etre detecte (detections : %s)' % [r['centre'] for r in res]
    V, F = _double_peau(False)
    assert DV.detect(V, F) == [], 'une double peau saine ne doit rien detecter'


def test_reel_sain():
    p = 'C:/tmp/moissonneuse.glb'
    if not os.path.exists(p):
        print('SAUTE : %s absent' % p)
        return
    import trimesh
    m = trimesh.load(p, force='mesh')
    res = DV.detect(np.asarray(m.vertices), np.asarray(m.faces), min_faces=20)
    print('moissonneuse saine : %d detections (information)' % len(res))


if __name__ == '__main__':
    test_synthetique()
    test_reel_sain()
    print('OK')
