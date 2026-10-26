# -*- coding: utf-8 -*-
"""Fabrique une COPIE REDUITE (forme seule, sans texture) d'un GLB, comme la production le fait aux petites cibles
(20/10/2026). Deux moteurs :

  meshopt  : celui de la production (acceleration_glb._reduire_meshopt, version WebAssembly executee par node :
             scripts/meshopt/meshopt_reduire.mjs). Sommets soudes par position exacte, comme _reduire_sans_plis.
  fast     : fast_simplification (quadriques, MIT ; refuse une contraction qui retourne un triangle), agg = 7 comme la
             production. Necessite un Python ou la DLL n'est pas bloquee par Smart App Control (pas celui de l'appli).

Usage :  python reduire_copie.py <glb> <cible_faces> <sortie.glb> [--moteur meshopt|fast] [--sans-souder]
Sortie : un GLB sans texture + une ligne JSON (faces avant / apres, sommets, duree).
"""
import argparse
import json
import os
import struct
import subprocess
import sys
import tempfile
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from glb_lecture import Glb, ecrire_glb, fusionner  # noqa: E402

RACINE = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
AGRESSIVITE = 7


def souder_exact(V, F):
    vn, inv = np.unique(V.astype(np.float32), axis=0, return_inverse=True)
    fn = inv.reshape(-1)[F]
    fn = fn[(fn[:, 0] != fn[:, 1]) & (fn[:, 1] != fn[:, 2]) & (fn[:, 0] != fn[:, 2])]
    return vn, fn


def reduire_meshopt(vn, fn, cible):
    script = os.path.join(RACINE, 'scripts', 'meshopt', 'meshopt_reduire.mjs')
    pos = np.ascontiguousarray(vn, dtype=np.float32)
    idx = np.ascontiguousarray(fn, dtype=np.uint32)
    with tempfile.TemporaryDirectory(prefix='meshopt_') as d:
        e, s = os.path.join(d, 'in.bin'), os.path.join(d, 'out.bin')
        with open(e, 'wb') as fh:
            fh.write(struct.pack('<ii', len(pos), len(idx)) + pos.tobytes() + idx.tobytes())
        subprocess.run(['node', script, e, s, str(int(cible))], check=True, capture_output=True, timeout=900)
        b = open(s, 'rb').read()
    n = struct.unpack('<i', b[:4])[0]
    f = np.frombuffer(b[4:4 + n * 12], dtype=np.uint32).reshape(-1, 3).astype(np.int64)
    utiles, inv = np.unique(f.reshape(-1), return_inverse=True)
    return pos[utiles], inv.reshape(-1, 3)


def reduire_fast(vn, fn, cible):
    import fast_simplification
    v2, f2 = fast_simplification.simplify(vn, fn, target_reduction=1.0 - cible / len(fn), agg=AGRESSIVITE)
    return np.asarray(v2, np.float32), np.asarray(f2, np.int64)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('glb')
    ap.add_argument('cible', type=int)
    ap.add_argument('sortie')
    ap.add_argument('--moteur', default='meshopt', choices=['meshopt', 'fast'])
    a = ap.parse_args()
    t = time.time()
    V, F, _, _, _ = fusionner(Glb(a.glb).primitives())
    vn, fn = souder_exact(V, F)
    if len(fn) <= a.cible:
        v2, f2 = vn, fn
    elif a.moteur == 'meshopt':
        v2, f2 = reduire_meshopt(vn, fn, a.cible)
    else:
        v2, f2 = reduire_fast(vn, fn, a.cible)
    os.makedirs(os.path.dirname(os.path.abspath(a.sortie)), exist_ok=True)
    ecrire_glb(a.sortie, v2, f2)
    print(json.dumps({'source': a.glb.replace('\\', '/'), 'moteur': a.moteur, 'cible': a.cible, 'faces_avant': int(len(F)),
                      'faces_soudees': int(len(fn)), 'faces_apres': int(len(f2)), 'sommets_apres': int(len(v2)),
                      'duree_s': round(time.time() - t, 1)}))


if __name__ == '__main__':
    main()
