"""BANC (2026-10-03) : Lucida (BiRefNet affine) contre u2net sur de VRAIES images du produit, dans l'image Modal du maillage (L40S, ~0,1 $, aucun
traitement sur le PC de l'utilisateur).

Pourquoi : l'audit de fidelite a mesure sur l'orc que le detourage u2net de la preparation d'image (`_mesh.prep_image`, `_tpose.remove_bg_and_center`,
`_rectify`) ne garde que 10 % des pixels des armes et 27 % de ceux des bras sur un fond gris, alors que Lucida (egeorcun/lucida, MIT) en garde 99,99 %.
Cote cloud, le meme u2net (modal_app/_detourage.py) decoupe l'image de la T-pose posee sur fond BLANC (le sujet detoure est recolle sur un canevas blanc :
ce qui n'est pas dans le masque disparait de l'image livree). Avant de brancher Lucida en production, ce banc mesure l'ecart sur 35 images reelles.

Ce que le banc mesure, par image : surface des deux masques, part du masque Lucida absente du masque u2net (« u2net manque »), part du masque u2net absente
du masque Lucida, IoU, nombre de morceaux, temps ; et rend des planches [original | u2net sur blanc | Lucida sur blanc | difference] a regarder.
Il verifie aussi que le code distant de Lucida se charge dans l'image Modal (timm, kornia, einops, transformers) et releve la VRAM utilisee.

Usage :  PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python -m modal run modal_app/test_lucida_vs_u2net.py
Sortie : C:/tmp/fidelite/lucida_vs_u2net/{metriques.json, planche_*.png}
"""
import modal

from modal_app.app import mesh_image

app = modal.App("myfabmesh-test-lucida-matte", image=mesh_image)


@app.function(gpu="L40S", timeout=1500)
def comparer(images: list, noms: list) -> dict:
    import io
    import time

    import cv2
    import numpy as np
    import torch
    from PIL import Image, ImageDraw, ImageOps

    sortie = {"versions": {}, "images": [], "planches": []}
    for m in ("torch", "torchvision", "transformers", "timm", "kornia", "einops", "onnxruntime", "cv2"):
        try:
            mod = __import__(m)
            sortie["versions"][m] = getattr(mod, "__version__", "?")
        except Exception as e:  # noqa: BLE001
            sortie["versions"][m] = "ABSENT (%s)" % type(e).__name__
    print("versions :", sortie["versions"], flush=True)

    t0 = time.time()
    from huggingface_hub import snapshot_download
    snapshot_download("egeorcun/lucida")
    sortie["telechargement_lucida_s"] = round(time.time() - t0, 1)

    from transformers import AutoModelForImageSegmentation
    t0 = time.time()
    modele = AutoModelForImageSegmentation.from_pretrained("egeorcun/lucida", trust_remote_code=True)
    modele.to("cuda").eval()
    torch.cuda.synchronize()
    sortie["chargement_lucida_s"] = round(time.time() - t0, 1)
    sortie["vram_apres_chargement_mo"] = int(torch.cuda.memory_allocated() // 2 ** 20)

    from torchvision import transforms
    pretraitement = transforms.Compose([
        transforms.Resize((1024, 1024)),
        transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    ])

    def masque_lucida(img):
        with torch.no_grad():
            p = modele(pretraitement(img.convert("RGB")).unsqueeze(0).to("cuda"))[-1].sigmoid().cpu()
        a = transforms.functional.resize(p[0], img.size[::-1]).squeeze(0)
        return (a.numpy().clip(0, 1) * 255).astype("uint8")

    from modal_app._detourage import masque as masque_u2net

    def morceaux(bin_, seuil_frac=0.0005):
        n, _, stats, _ = cv2.connectedComponentsWithStats(bin_.astype("uint8"), connectivity=8)
        return int(sum(1 for k in range(1, n) if stats[k, cv2.CC_STAT_AREA] >= seuil_frac * bin_.size))

    def sur_blanc(img, alpha):
        base = Image.new("RGB", img.size, (255, 255, 255))
        base.paste(img.convert("RGB"), (0, 0), Image.fromarray(alpha, mode="L"))
        return base

    # echauffement (compilation des noyaux) hors mesure
    masque_lucida(Image.new("RGB", (256, 256), (128, 128, 128)))
    torch.cuda.synchronize()

    T = 256
    lignes = []
    for octets, nom in zip(images, noms):
        img = ImageOps.exif_transpose(Image.open(io.BytesIO(octets))).convert("RGB")
        t0 = time.time()
        u2 = np.asarray(masque_u2net(img))
        t_u2 = time.time() - t0
        torch.cuda.synchronize()
        t0 = time.time()
        lu = masque_lucida(img)
        torch.cuda.synchronize()
        t_lu = time.time() - t0
        bu, bl = u2 > 127, lu > 127
        inter, union = int((bu & bl).sum()), int((bu | bl).sum())
        sortie["images"].append({
            "nom": nom, "taille": list(img.size),
            "aire_u2net": round(float(bu.mean()), 4), "aire_lucida": round(float(bl.mean()), 4),
            "u2net_manque": round(float((bl & ~bu).sum() / max(bl.sum(), 1)), 4),
            "lucida_manque": round(float((bu & ~bl).sum() / max(bu.sum(), 1)), 4),
            "iou": round(inter / max(union, 1), 4),
            "morceaux_u2net": morceaux(bu), "morceaux_lucida": morceaux(bl),
            "t_u2net_ms": int(t_u2 * 1000), "t_lucida_ms": int(t_lu * 1000),
        })
        diff = np.full(img.size[::-1] + (3,), 90, np.uint8)
        diff[bl & ~bu] = (230, 40, 40)      # rouge : Lucida garde, u2net perd
        diff[bu & ~bl] = (40, 90, 230)      # bleu : u2net garde, Lucida perd
        diff[bu & bl] = (235, 235, 235)
        panneaux = [img, sur_blanc(img, u2), sur_blanc(img, lu), Image.fromarray(diff)]
        ligne = Image.new("RGB", (T * 4, T + 14), (20, 20, 28))
        for k, p in enumerate(panneaux):
            ligne.paste(p.resize((T, T), Image.LANCZOS), (k * T, 14))
        ImageDraw.Draw(ligne).text((4, 1), "%s | u2net manque %.1f %% | Lucida manque %.1f %% | IoU %.2f" % (
            nom[:34], 100 * sortie["images"][-1]["u2net_manque"], 100 * sortie["images"][-1]["lucida_manque"], sortie["images"][-1]["iou"]),
            fill=(235, 235, 240))
        lignes.append(ligne)
    sortie["vram_pic_mo"] = int(torch.cuda.max_memory_allocated() // 2 ** 20)

    par_planche = 8
    for d in range(0, len(lignes), par_planche):
        bloc = lignes[d:d + par_planche]
        feuille = Image.new("RGB", (T * 4, (T + 14) * len(bloc)), (20, 20, 28))
        for k, lg in enumerate(bloc):
            feuille.paste(lg, (0, k * (T + 14)))
        buf = io.BytesIO()
        feuille.save(buf, format="PNG")
        sortie["planches"].append(buf.getvalue())
    return sortie


@app.local_entrypoint()
def main():
    import json
    import os
    import statistics

    racine_p = "C:/tmp/fidelite/paires_r2"
    fichiers = [("orc_verif_t80", "images/verif_t80_orc/ref_0.png")]
    for bras in ("A_avant", "B_apres", "C_libre"):
        d = "C:/tmp/fidelite/ab/orc1/" + bras
        for f in sorted(os.listdir(d)):
            if f.startswith("ref_") and f.endswith(".png"):
                fichiers.append(("ab_%s_%s" % (bras, f[4:-4]), d + "/" + f))
    from PIL import Image
    for nom in sorted(os.listdir(racine_p)):
        p = os.path.join(racine_p, nom, "ref.png")
        if os.path.exists(p) and Image.open(p).mode == "RGB":      # les RGBA sont deja detoures : la preparation d'image ne les remasque pas
            fichiers.append(("paire_" + nom, p))
    noms = [n for n, _ in fichiers]
    images = [open(p, "rb").read() for _, p in fichiers]
    print("%d images, %.1f Mo" % (len(images), sum(len(b) for b in images) / 1e6))
    r = comparer.remote(images, noms)

    dest = "C:/tmp/fidelite/lucida_vs_u2net"
    os.makedirs(dest, exist_ok=True)
    for k, png in enumerate(r.pop("planches")):
        open("%s/planche_%d.png" % (dest, k + 1), "wb").write(png)
    json.dump(r, open(dest + "/metriques.json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)

    print("versions :", r["versions"])
    print("telechargement %.1f s | chargement %.1f s | VRAM apres chargement %d Mo | pic %d Mo" % (
        r["telechargement_lucida_s"], r["chargement_lucida_s"], r["vram_apres_chargement_mo"], r["vram_pic_mo"]))
    print("%-34s %6s %6s %7s %7s %5s %4s %4s" % ("image", "aireU", "aireL", "u2miss", "lumiss", "IoU", "cU", "cL"))
    for e in r["images"]:
        print("%-34s %6.3f %6.3f %6.1f%% %6.1f%% %5.2f %4d %4d" % (
            e["nom"][:34], e["aire_u2net"], e["aire_lucida"], 100 * e["u2net_manque"], 100 * e["lucida_manque"], e["iou"],
            e["morceaux_u2net"], e["morceaux_lucida"]))
    groupes = {"fond gris (generation brute : orc + A/B)": [e for e in r["images"] if e["nom"].startswith(("orc_", "ab_"))],
               "paires RGB du produit": [e for e in r["images"] if e["nom"].startswith("paire_")]}
    for g, es in groupes.items():
        if es:
            print("== %s : %d images | u2net manque (mediane / max) %.1f %% / %.1f %% | Lucida manque (mediane) %.1f %% | IoU median %.3f | temps u2net %d ms, Lucida %d ms" % (
                g, len(es), 100 * statistics.median(e["u2net_manque"] for e in es), 100 * max(e["u2net_manque"] for e in es),
                100 * statistics.median(e["lucida_manque"] for e in es), statistics.median(e["iou"] for e in es),
                statistics.median(e["t_u2net_ms"] for e in es), statistics.median(e["t_lucida_ms"] for e in es)))
    print("planches et metriques dans", dest)
