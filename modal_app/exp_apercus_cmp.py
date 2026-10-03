"""Rendus Blender (Modal, CPU) de deux GLB de comparaison : orc_T1_1536 (grille 1536 normale) et orc_T8_1792 (8 tuiles).
Lancer : PYTHONUTF8=1 python -m modal run modal_app/exp_apercus_cmp.py   -> C:/tmp/trellis_cloud/apercus/"""
import os

import modal

from modal_app.exp_trellis_cloud import app, apercus, vol, SORTIE

NOMS = ["cmp_G1536_T1", "cmp_G1792_T1", "cmp_G1792_T2"]


@app.local_entrypoint()
def cmp():
    with vol.batch_upload(force=True) as b:
        for n in NOMS:
            b.put_file(os.path.join(SORTIE, "glb", n + ".glb"), "/exp_cmp_%s.glb" % n)
    os.makedirs(os.path.join(SORTIE, "apercus"), exist_ok=True)
    res = apercus.map(["exp_cmp_" + n for n in NOMS], return_exceptions=True)
    for n, r in zip(NOMS, res):
        if isinstance(r, Exception):
            print(n, "ECHEC", repr(r)[:300])
            continue
        for vue, o in r["png"].items():
            open(os.path.join(SORTIE, "apercus", "%s_%s.png" % (n, vue)), "wb").write(o)
        print(n, "faces", r["faces"], "temps", r["temps_s"])
    for n in NOMS:
        try:
            vol.remove_file("/exp_cmp_%s.glb" % n)
        except Exception:
            pass
