"""Banc « serpent etire » (2026-09-28) : image-vers-image depuis une SILHOUETTE deja etiree.

Le banc de prompts (test_prompts_unites.py, 36 images) a montre que les mots ne suffisent pas :
0/36 serpent etire, toutes les images ont une boucle (meme « earthworm »). On teste ici la
composition IMPOSEE : une silhouette synthetique (tube effile le long d'un S tres ouvert, de gauche
a droite) sert d'image de depart ; le modele (RealVisXL, meme pipeline que la production, AUCUN
modele nouveau) ne fait que la « peindre ». Plusieurs forces de debruitage sont comparees.

Usage (~0,20 $) :
    PYTHONUTF8=1 python -m modal run modal_app/test_serpent_layout.py --cas cas.json --sortie dossier/
"""
import modal

from modal_app.app import image

app = modal.App("myfabmesh-test-serpent", image=image)


from modal_app.serpent_etire import silhouette  # meme silhouette que la production


@app.function(gpu="L40S", timeout=1800)
def essai(cas: list) -> list:
    import io
    import time

    import torch
    from diffusers import StableDiffusionXLImg2ImgPipeline, StableDiffusionXLPipeline
    from modal_app._sdxl_prompt_utils import encode_sdxl_long_prompt

    t0 = time.time()
    base = StableDiffusionXLPipeline.from_pretrained(
        "SG161222/RealVisXL_V4.0", torch_dtype=torch.float16, variant="fp16", use_safetensors=True)
    try:
        base.upcast_vae()
    except Exception:
        base.vae.to(torch.float32)
    base.to("cuda")
    pipe = StableDiffusionXLImg2ImgPipeline(**base.components)   # memes poids, aucun telechargement
    print(f"[banc] pipeline pret en {time.time() - t0:.0f} s", flush=True)

    sorties = []
    for c in cas:
        t1 = time.time()
        depart = silhouette(graine=int(c["graine"]))
        embeds = encode_sdxl_long_prompt(pipe, c["prompt"], c["negative"])
        img = pipe(**embeds, image=depart, strength=float(c["force"]), num_inference_steps=30,
                   guidance_scale=9.5,
                   generator=torch.Generator("cuda").manual_seed(int(c["graine"]))).images[0]
        img = img.resize((448, 448))
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=90)
        sorties.append({k: c[k] for k in ("variante", "sujet", "graine")} | {"jpg": buf.getvalue()})
        print(f"[banc] {c['variante']} | {c['sujet']} | {c['graine']} : {time.time() - t1:.1f} s", flush=True)
    return sorties


@app.local_entrypoint()
def main(cas: str, sortie: str):
    import json
    import os

    liste = json.load(open(cas, encoding="utf-8"))
    os.makedirs(sortie, exist_ok=True)
    for r in essai.remote(liste):
        nom = f"{r['variante']}_{r['sujet'].replace(' ', '-')}_{r['graine']}.jpg"
        with open(os.path.join(sortie, nom), "wb") as fh:
            fh.write(r["jpg"])
    print(f"{len(liste)} images ecrites dans {sortie}")
