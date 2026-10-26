# -*- coding: utf-8 -*-
"""Adaptateurs des detecteurs EXISTANTS (ligne de base du banc fillbench) :
    detect_bord  : scripts/bouchage_trous.py   (boucles d'aretes de bord)
    detect_peau  : scripts/bouchage_peau.py    (cartes de profondeur, 48 directions)
    detect_tout  : les deux, doublons fusionnes (c'est ce que fait l'outil aujourd'hui)
Usage :  python score.py fillbench_adapt_existants.py:detect_tout --rapide
"""
import os
import sys

import numpy as np

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(ICI, '..', '..', '..', 'scripts'))

import bouchage_peau as PE  # noqa: E402
import bouchage_trous as B  # noqa: E402

SOUDER = False        # les deux noyaux soudent eux-memes


def _filtre(dets, V, mtr):
    if not mtr:
        return dets
    diag = float(np.linalg.norm(V.max(0) - V.min(0)))
    return [d for d in dets if 2 * d['rayon'] <= mtr * diag]


def detect_bord(V, F, uv=None, max_trou_relatif=0.10, **kw):
    prep = B.preparer(V, F)
    a = B.analyser(V, F, prep=prep)
    out = []
    for b in a['boucles']:
        if b['categorie'] in ('degeneree',):
            continue
        P = np.asarray(V)[list(b['debut'])]
        c = P.mean(axis=0)
        out.append({'centre': c, 'rayon': float(np.linalg.norm(P - c, axis=1).max()), 'contour': P, 'source': 'bord'})
    return _filtre(out, np.asarray(V), max_trou_relatif)


def detect_peau(V, F, uv=None, max_trou_relatif=0.10, **kw):
    prep = B.preparer(V, F)
    trous, _ = PE.detecter(V, F, prep)
    out = [{'centre': np.asarray(h['centre'], dtype=float), 'rayon': float(h['rayon']),
            'contour': np.asarray(V)[list(h['debut'])], 'source': 'peau'} for h in trous]
    return _filtre(out, np.asarray(V), max_trou_relatif)


def detect_tout(V, F, uv=None, max_trou_relatif=0.10, **kw):
    out = detect_bord(V, F, uv, max_trou_relatif)
    for d in detect_peau(V, F, uv, max_trou_relatif):
        if all(np.linalg.norm(d['centre'] - e['centre']) > max(d['rayon'], e['rayon']) for e in out):
            out.append(d)
    return out
