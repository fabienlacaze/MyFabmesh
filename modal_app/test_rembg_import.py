"""Banc « preparation de l'image lente » (2026-09-28) — CPU seul, < 0,01 $.

Dans le journal, « [mesh] image prepared in 71.9s » alors que le telechargement de
u2net ne dure que ~5 s. Mesure du 28/09 : `import pymatting` (tire par `import rembg`)
= 87,7 s, `new_session` 2,6 s, un detourage 1,5 s. D'ou modal_app/_detourage.py.

Ce banc mesure les deux chemins ET verifie que _detourage.detourer rend EXACTEMENT les
memes pixels que rembg.remove (u2net) sur des images passees en argument.

Usage :
    PYTHONUTF8=1 python -m modal run modal_app/test_rembg_import.py --dossier <images>
"""
import modal

from modal_app.app import mesh_image

app = modal.App("myfabmesh-test-rembg", image=mesh_image)


@app.function(timeout=900)
def mesurer(images: list) -> dict:
    import io
    import os
    import time

    import numpy as np
    from PIL import Image

    t = {"u2net deja dans l'image": os.path.exists("/root/.u2net/u2net.onnx"), "cpu": os.cpu_count()}
    t0 = time.time()
    from modal_app._detourage import detourer
    imgs = [Image.open(io.BytesIO(b)) for b in images]
    detourer(imgs[0])
    t["_detourage : import + 1er detourage"] = time.time() - t0
    t0 = time.time()
    nouveaux = [(detourer(i.convert("RGBA")), detourer(i.convert("RGB"))) for i in imgs]
    t["_detourage : detourage moyen"] = (time.time() - t0) / (2 * len(imgs))

    t0 = time.time()
    import rembg
    t["import rembg"] = time.time() - t0
    session = rembg.new_session("u2net")
    ecarts = []
    for i, (a, b) in zip(imgs, nouveaux):
        ra = rembg.remove(i.convert("RGBA"), session=session)       # chemin de _mesh.prep_image
        rb = rembg.remove(i.convert("RGB"))                          # chemin de _retexture (sans session)
        for x, y in ((a, ra), (b, rb)):
            assert x.mode == y.mode and x.size == y.size, (x.mode, y.mode, x.size, y.size)
            ecarts.append(int(np.abs(np.asarray(x, np.int16) - np.asarray(y, np.int16)).max()))
    t["ecart max (pixels, 0 = identique)"] = max(ecarts)
    t["comparaisons"] = len(ecarts)
    return t


@app.local_entrypoint()
def main(dossier: str):
    import os

    images = [open(os.path.join(dossier, f), "rb").read() for f in sorted(os.listdir(dossier))]
    for k, v in mesurer.remote(images).items():
        print(f"{k:38s} {v:.1f} s" if isinstance(v, float) else f"{k:38s} {v}")
