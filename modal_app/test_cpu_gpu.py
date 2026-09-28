"""Banc « CPU d'un conteneur GPU » (2026-09-29) — ~0,02 $ par configuration.

L'export du maillage (depliage UV, cuisson, inpaint de l'atlas) est surtout du calcul CPU
et varie de 43 a 136 s pour la meme cible de 500 K faces. MyFabmeshMesh ne reserve aucun
coeur (`cpu=` absent). On mesure ici, sur un L40S configure comme lui, le quota CPU reel
(cgroup) et un calcul multi-fil representatif (cv2.inpaint sur un atlas 4096, qui est
l'etape « Finalizing » de o_voxel.postprocess.to_glb), avec et sans reservation.

Usage :
    PYTHONUTF8=1 python -m modal run modal_app/test_cpu_gpu.py
"""
import modal

app = modal.App("myfabmesh-test-cpu")
image = modal.Image.debian_slim(python_version="3.11").pip_install("numpy", "opencv-python-headless")


def _mesurer(etiquette: str) -> dict:
    import os
    import time

    import cv2
    import numpy as np

    r = {"config": etiquette, "cpu_count": os.cpu_count()}
    try:
        r["cgroup cpu.max"] = open("/sys/fs/cgroup/cpu.max").read().strip()
    except Exception as e:
        r["cgroup cpu.max"] = f"illisible ({type(e).__name__})"
    r["affinite"] = len(os.sched_getaffinity(0))
    rng = np.random.default_rng(0)
    img = rng.integers(0, 255, (4096, 4096, 3), dtype=np.uint8)
    masque = np.zeros((4096, 4096), np.uint8)
    for _ in range(400):                                   # ~40 % de l'atlas a combler, en ilots
        x, y = rng.integers(0, 3900, 2)
        masque[y:y + 180, x:x + 180] = 1
    t0 = time.time()
    cv2.inpaint(img, masque, 3, cv2.INPAINT_TELEA)
    r["inpaint TELEA 4096 (s)"] = round(time.time() - t0, 1)
    a = rng.random((3000, 3000)).astype(np.float32)
    t0 = time.time()
    for _ in range(5):
        a @ a
    r["5 produits matriciels 3000 (s)"] = round(time.time() - t0, 1)
    return r


@app.function(image=image, gpu="L40S", timeout=600)
def sans_reservation() -> dict:
    return _mesurer("L40S, cpu= absent (comme MyFabmeshMesh)")


@app.function(image=image, gpu="L40S", cpu=8.0, timeout=600)
def huit_coeurs() -> dict:
    return _mesurer("L40S, cpu=8")


@app.local_entrypoint()
def main():
    for r in (sans_reservation.remote(), huit_coeurs.remote()):
        print("----")
        for k, v in r.items():
            print(f"{k:32s} {v}")
