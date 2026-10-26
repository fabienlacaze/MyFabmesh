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
import detect_vues_gap as gp
import bouchage_trous as bt


def detect(V, F, uv=None, nb_vues=96, resolution=None, max_trou_relatif=0.10, min_trou_relatif=0.0, min_aretes=3, max_aretes=2000,
           budget_s=None, delta=0.006, avec_bord=True, avec_profondeur=True, avec_ecart=False, **_):
    V = np.asarray(V, dtype=np.float64)
    F = np.asarray(F, dtype=np.int64)
    if len(F) == 0:
        return []
    bp.TAILLE_MAX = float(max_trou_relatif)
    bp.DELTA = float(delta)
    os.environ.setdefault('FABMESH_PEAU_FILS', str(max(1, min(16, (os.cpu_count() or 4) // 2))))
    prep = bt.preparer(V, F)
    bp.NB_VUES = int(nb_vues)
    kw = {}
    if resolution:
        kw['resolution'] = int(resolution)
    trous = []
    if avec_profondeur:
        trous, _ = bp.detecter(V, F, prep, min_aretes=min_aretes, max_aretes=max_aretes, budget_s=budget_s, **kw)
    diag = float(np.linalg.norm(V.max(0) - V.min(0)))
    sortie = []
    if avec_bord:                                   # trous a bord ouvert : boucles d'aretes (rapide, exact)
        for b in bt.analyser(V, F, prep=prep)['boucles']:
            if b['categorie'] == 'degeneree':
                continue
            P = V[list(b['debut'])]
            c = P.mean(axis=0)
            r = float(np.linalg.norm(P - c, axis=1).max())
            if 2 * r <= max_trou_relatif * diag and r >= min_trou_relatif * diag:
                sortie.append({'centre': [float(x) for x in c], 'rayon': r, 'contour': P.tolist(), 'source': 'bord'})
    if avec_ecart:                                  # double peau : ilots d'ecart entre couches anormalement grand
        pool = bp._fils()
        try:
            for g in gp.candidats(V, F, int(nb_vues), int(resolution or 1024), pool, float(max_trou_relatif) ** 2):
                if g['r'] < min_trou_relatif * diag or 2 * g['r'] > max_trou_relatif * diag:
                    continue
                if any(np.linalg.norm(np.asarray(g['c']) - np.asarray(e['centre'])) <= max(g['r'], e['rayon']) for e in sortie):
                    continue
                sortie.append({'centre': [float(x) for x in g['c']], 'rayon': float(g['r']), 'contour': g['contour'], 'source': 'ecart'})
        finally:
            pool.shutdown()
    for h in trous:
        if h['rayon'] < min_trou_relatif * diag or 2 * h['rayon'] > max_trou_relatif * diag:
            continue
        if any(np.linalg.norm(np.asarray(h['centre']) - np.asarray(e['centre'])) <= max(h['rayon'], e['rayon']) for e in sortie):
            continue
        sortie.append({'centre': [float(x) for x in h['centre']], 'rayon': float(h['rayon']),
                       'contour': [[float(x) for x in V[v]] for v in h['debut']], 'source': 'vues'})
    return sortie
