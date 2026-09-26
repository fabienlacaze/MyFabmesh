"""Banc « unites sans armes » : genere des images RealVisXL avec des couples
(positif, negatif) EXACTS, sur la vraie image Modal, pour comparer des
variantes de prompt a graines fixes. Aucune ecriture en production.

Pourquoi un banc : un changement de prompt ne se juge pas a la lecture. Le
2026-09-26, l'utilisateur voulait des unites sans armes et obtenait un ouvrier
de chantier moderne pour « prehistoric worker » ; on mesure ici l'effet reel
de chaque correction (negatif, mains vides, ordre du prompt) avant de livrer.

Memes reglages que la production (_realvis.generate, moteur « Balanced ») :
RealVisXL V4.0 fp16, VAE en fp32, 30 pas, guidage 9,5, 1024 x 1024, encodeur
long avec ponderations (_sdxl_prompt_utils).

Usage (cout ~0,20 $ : un L40S quelques minutes) :
    PYTHONUTF8=1 python -m modal run modal_app/test_prompts_unites.py \\
        --cas cas.json --sortie dossier/
"""
import modal

from modal_app.app import image

app = modal.App("myfabmesh-test-unites", image=image)


@app.function(gpu="L40S", timeout=1800)
def essai(cas: list) -> list:
    import io
    import time

    import torch
    from diffusers import StableDiffusionXLPipeline
    from modal_app._sdxl_prompt_utils import encode_sdxl_long_prompt

    t0 = time.time()
    pipe = StableDiffusionXLPipeline.from_pretrained(
        "SG161222/RealVisXL_V4.0", torch_dtype=torch.float16,
        variant="fp16", use_safetensors=True)
    try:
        pipe.upcast_vae()
    except Exception:
        pipe.vae.to(torch.float32)
    pipe.to("cuda")
    try:
        pipe.enable_xformers_memory_efficient_attention()
    except Exception:
        pass
    print(f"[banc] pipeline pret en {time.time() - t0:.0f} s", flush=True)

    sorties = []
    for c in cas:
        t1 = time.time()
        embeds = encode_sdxl_long_prompt(pipe, c["prompt"], c["negative"])
        img = pipe(**embeds, num_inference_steps=30, guidance_scale=9.5,
                   height=1024, width=1024,
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
