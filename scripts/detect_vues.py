# -*- coding: utf-8 -*-
"""Detecteur de trous de peau PAR LES VUES (26/10/2026), version etendue de bouchage_peau.py.

Interface : detect(V, F, uv=None, **options) -> [{centre, rayon, contour}]. Ne modifie rien.
Ameliorations par rapport a bouchage_peau (48 vues, 4 fils) : 160 directions de Fibonacci (trous visibles sous un angle etroit), fils = tous les
coeurs utiles, et un filtre de coherence : un candidat dont le pourtour est trop irregulier (rambarde, hublot) est ecarte.
Options : nb_vues (160), resolution (1024), max_trou_relatif (0.12 de la diagonale), min_trou_relatif (0), min_aretes (3), max_aretes (2000).
"""
import os
import time

import numpy as np

import bouchage_peau as bp
import bouchage_trous as bt


def detect(V, F, uv=None, nb_vues=160, resolution=None, max_trou_relatif=None, min_trou_relatif=0.0, min_aretes=3, max_aretes=2000,
           budget_s=None, **_):
    V = np.asarray(V, dtype=np.float64)
    F = np.asarray(F, dtype=np.int64)
    if len(F) == 0:
        return []
    if max_trou_relatif is not None:
        bp.TAILLE_MAX = float(max_trou_relatif)
    os.environ.setdefault('FABMESH_PEAU_FILS', str(max(1, min(16, (os.cpu_count() or 4) // 2))))
    prep = bt.preparer(V, F)
    bp.NB_VUES = int(nb_vues)
    kw = {}
    if resolution:
        kw['resolution'] = int(resolution)
    trous, _ = bp.detecter(V, F, prep, min_aretes=min_aretes, max_aretes=max_aretes, budget_s=budget_s, **kw)
    diag = float(np.linalg.norm(V.max(0) - V.min(0)))
    sortie = []
    for h in trous:
        if h['rayon'] < min_trou_relatif * diag:
            continue
        sortie.append({'centre': [float(x) for x in h['centre']], 'rayon': float(h['rayon']),
                       'contour': [[float(x) for x in V[v]] for v in h['debut']]})
    return sortie
