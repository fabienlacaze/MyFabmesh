"""Banc « Ultra 8K » (2026-09-29) — L40S, ~0,05 $.

L'agrandissement x2 de l'atlas (4096 -> 8192) prend 40-45 s dans le calcul du maillage.
On chronometre chaque partie sur un atlas synthetique de 4096 : reseau (tuiles de 512
puis de 1024), passage GPU -> CPU, reduction x4 -> x2, encodage WebP 8192 (ce que fait
l'export GLB), et on verifie que la version rapide rend les MEMES pixels.

Usage :
    PYTHONUTF8=1 python -m modal run modal_app/test_esrgan.py
"""
import modal

from modal_app.app import image

app = modal.App("myfabmesh-test-esrgan", image=image)


@app.function(gpu="L40S", timeout=900)
def mesurer() -> dict:
    import io
    import time

    import numpy as np
    import torch
    from PIL import Image

    import modal_app._esrgan as E

    r = {}
    rng = np.random.default_rng(0)
    y, x = np.mgrid[0:4096, 0:4096]
    base = np.stack([(x // 7) % 255, (y // 5) % 255, ((x + y) // 11) % 255], -1).astype(np.float32)
    atlas = Image.fromarray(np.clip(base + rng.normal(0, 12, base.shape), 0, 255).astype(np.uint8))

    t0 = time.time(); E.charger(); r["chargement modele (s)"] = round(time.time() - t0, 1)
    E.affuter_atlas(atlas.resize((512, 512)))                          # rodage CUDA
    torch.cuda.synchronize()

    t0 = time.time(); ref = E.affuter_atlas(atlas); torch.cuda.synchronize()
    r["affuter_atlas actuel, total (s)"] = round(time.time() - t0, 1)

    # decomposition du chemin actuel
    reseau = E.charger()
    rgb = np.asarray(atlas, dtype=np.float32) / 255.0
    h, w = rgb.shape[:2]
    entree = torch.from_numpy(np.transpose(rgb, (2, 0, 1))).unsqueeze(0).to('cuda').half()
    for tuile_px in (512, 1024):
        sortie = entree.new_zeros((1, 3, h * 4, w * 4))
        torch.cuda.synchronize(); t0 = time.time()
        with torch.inference_mode():
            for ty in range((h + tuile_px - 1) // tuile_px):
                for tx in range((w + tuile_px - 1) // tuile_px):
                    x0, y0 = tx * tuile_px, ty * tuile_px
                    x1, y1 = min(x0 + tuile_px, w), min(y0 + tuile_px, h)
                    x0p, x1p = max(x0 - E.MARGE, 0), min(x1 + E.MARGE, w)
                    y0p, y1p = max(y0 - E.MARGE, 0), min(y1 + E.MARGE, h)
                    t = reseau(entree[:, :, y0p:y1p, x0p:x1p])
                    ox, oy = (x0 - x0p) * 4, (y0 - y0p) * 4
                    sortie[:, :, y0 * 4:y1 * 4, x0 * 4:x1 * 4] = t[:, :, oy:oy + (y1 - y0) * 4, ox:ox + (x1 - x0) * 4]
        torch.cuda.synchronize()
        r[f"reseau, tuiles {tuile_px} (s)"] = round(time.time() - t0, 1)

    t0 = time.time()
    out = sortie.squeeze(0).float().cpu().clamp_(0, 1).numpy()
    out = (np.transpose(out, (1, 2, 0)) * 255.0).round().astype(np.uint8)
    r["GPU->CPU + conversion actuelle (s)"] = round(time.time() - t0, 1)
    t0 = time.time()
    out_gpu = (sortie.squeeze(0).float().clamp_(0, 1) * 255.0).round().to(torch.uint8).permute(1, 2, 0).contiguous().cpu().numpy()
    r["conversion sur GPU puis transfert (s)"] = round(time.time() - t0, 1)
    r["conversion GPU identique"] = bool(np.array_equal(out, out_gpu))

    import cv2
    t0 = time.time()
    red = cv2.resize(out, (8192, 8192), interpolation=cv2.INTER_LANCZOS4)
    r["reduction x4->x2 LANCZOS CPU (s)"] = round(time.time() - t0, 1)
    cv2.setNumThreads(8)
    t0 = time.time()
    cv2.resize(out, (8192, 8192), interpolation=cv2.INTER_LANCZOS4)
    r["idem, 8 fils (s)"] = round(time.time() - t0, 1)
    r["resultat identique au chemin actuel"] = bool(np.array_equal(red, np.asarray(ref)))

    t0 = time.time()
    buf = io.BytesIO(); Image.fromarray(red).save(buf, "WEBP", quality=80)
    r["encodage WebP 8192 (s)"] = round(time.time() - t0, 1)
    return r


@app.local_entrypoint()
def main():
    for k, v in mesurer.remote().items():
        print(f"{k:42s} {v}")
