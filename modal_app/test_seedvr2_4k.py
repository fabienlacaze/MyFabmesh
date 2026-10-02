"""Banc SeedVR2 sur le cloud, L40S (2026-10-02) — quelques centimes.

Questions du user : « SeedVR2 en 8k ? », « tu peux tester 4096 sur cloud ? », puis « refait seed a 2048 par cloud, que l'on voie le temps que ca met ».
Premier essai (4096 px) : 26 s de calcul mais 5 min 16 d'attente cote utilisateur, parce que les poids (3,7 Go) etaient telecharges a chaque lancement (rodage a 512 px : 262 s).
Ici : les poids vivent sur un VOLUME Modal (telecharges une fois, sur un conteneur SANS GPU), et le point d'entree chronometre, cote client, ce que l'utilisateur attend :
un appel « a froid » (nouveau conteneur : demarrage, chargement des poids, calcul, retour de l'image) puis un appel « a chaud » (le conteneur est encore la).

Application SEPAREE de la production (aucun deploiement). GPU : L40S, celui du projet pour les images et le maillage (decision du user : pas la H100, deux fois plus chere).

Usage :
    PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python -m modal run modal_app/test_seedvr2_4k.py                       (2048 px, a froid puis a chaud)
    PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python -m modal run modal_app/test_seedvr2_4k.py --resolution 4096
"""
import modal

DEPOT = "C:/tmp/bench_tex/seedvr2"            # copie locale du depot numz/ComfyUI-SeedVR2_VideoUpscaler (sans models/)
PHOTO = "C:/tmp/bench_tex/photo_chev/photo.png"  # photo du chevalier, 1024 x 1024
DOSSIER_POIDS = "/root/seedvr2/models"
POIDS = ["seedvr2_ema_3b_fp8_e4m3fn.safetensors", "ema_vae_fp16.safetensors"]   # depot Hugging Face numz/SeedVR2_comfyUI

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("libgl1", "libglib2.0-0")
    .pip_install("torch", "torchvision", "safetensors", "numpy", "tqdm", "psutil", "einops", "omegaconf>=2.3.0", "diffusers>=0.33.1",
                 "peft>=0.17.0", "rotary_embedding_torch>=0.5.3", "opencv-python-headless", "gguf", "matplotlib", "pillow", "huggingface_hub")
    .add_local_dir(DEPOT, "/root/seedvr2", ignore=["models/**", "**/__pycache__/**", ".git/**"])
    .add_local_file(PHOTO, "/root/in/chevalier/photo.png")
    .add_local_file("C:/tmp/bench_tex/photos/bus/photo.png", "/root/in/bus/photo.png")
    .add_local_file("C:/tmp/bench_tex/photos/alien/photo.png", "/root/in/alien/photo.png")
)
poids = modal.Volume.from_name("myfabmesh-bench-seedvr2-poids", create_if_missing=True)
app = modal.App("myfabmesh-test-seedvr2-4k", image=image)


@app.function(timeout=900, volumes={DOSSIER_POIDS: poids})
def telecharger() -> dict:
    """Conteneur SANS GPU : telecharge les poids sur le volume (une seule fois)."""
    import os
    import time

    from huggingface_hub import hf_hub_download

    t0 = time.time()
    dossier = os.path.join(DOSSIER_POIDS, "SEEDVR2")
    os.makedirs(dossier, exist_ok=True)
    deja = []
    for f in POIDS:
        if os.path.exists(os.path.join(dossier, f)):
            deja.append(f)
            continue
        hf_hub_download(repo_id="numz/SeedVR2_comfyUI", filename=f, local_dir=dossier)
    poids.commit()
    return {"deja_presents": deja, "duree_s": round(time.time() - t0, 1),
            "fichiers_mo": {f: round(os.path.getsize(os.path.join(dossier, f)) / 2 ** 20) for f in POIDS}}


@app.function(gpu="L40S", timeout=900, volumes={DOSSIER_POIDS: poids})
def mesurer(resolution: int = 2048, sujet: str = "chevalier") -> dict:
    import io
    import os
    import re
    import subprocess
    import sys
    import threading
    import time

    from PIL import Image

    Image.MAX_IMAGE_PIXELS = None
    t_debut = time.time()
    r = {"gpu": subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"], capture_output=True, text=True).stdout.strip()}
    pic = {"mo": 0}
    stop = threading.Event()

    def surveiller():
        while not stop.is_set():
            try:
                v = int(subprocess.run(["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"], capture_output=True, text=True).stdout.split()[0])
                pic["mo"] = max(pic["mo"], v)
            except Exception:
                pass
            time.sleep(1.0)
    threading.Thread(target=surveiller, daemon=True).start()

    sortie_dir = f"/root/out_{sujet}_{resolution}"
    cmd = [sys.executable, "inference_cli.py", f"/root/in/{sujet}", "--output", sortie_dir, "--output_format", "png", "--resolution", str(resolution), "--batch_size", "1",
           "--attention_mode", "sdpa", "--dit_model", "seedvr2_ema_3b_fp8_e4m3fn.safetensors", "--vae_encode_tiled", "--vae_decode_tiled",
           "--color_correction", "lab", "--seed", "42"]
    t0 = time.time()
    try:
        p = subprocess.run(cmd, cwd="/root/seedvr2", capture_output=True, text=True, timeout=700, env=dict(os.environ, PYTHONUNBUFFERED="1"))
        code, txt = p.returncode, (p.stdout or "") + (p.stderr or "")
    except subprocess.TimeoutExpired as e:
        code, txt = "timeout", ""
    r["code"] = code
    r["cli_total_s"] = round(time.time() - t0, 1)
    m = re.search(r"completed successfully in ([\d.]+)s", txt)
    if m:
        r["calcul_seul_s"] = float(m.group(1))
    r["pic_vram_mo"] = pic["mo"]
    stop.set()
    sortie = os.path.join(sortie_dir, "photo.png")
    if os.path.exists(sortie):
        im = Image.open(sortie).convert("RGB")
        r["taille_sortie"] = im.size
        b = io.BytesIO()
        im.save(b, "PNG")
        r["png"] = b.getvalue()
    r["dans_le_conteneur_s"] = round(time.time() - t_debut, 1)
    if code != 0:
        r["fin_du_journal"] = [l[:160] for l in txt.strip().splitlines()[-6:]]
    return r


@app.local_entrypoint()
def main(sujets: str = "bus,alien", resolution: int = 2048):
    """Lance TOUS les sujets EN MEME TEMPS (un conteneur L40S chacun) et enregistre chaque image agrandie (PNG)."""
    import time

    liste = [x for x in sujets.split(",") if x]
    t0 = time.time()
    print(f"[0 s] {len(liste)} appels envoyes en meme temps : {', '.join(liste)} (SeedVR2 {resolution} px, L40S)", flush=True)
    appels = {n: mesurer.spawn(resolution, n) for n in liste}
    for n, a in appels.items():
        r = a.get()
        attente = time.time() - t0
        png = r.pop("png", None)
        print(f"[{attente:.0f} s] {n} : termine | code {r.get('code')} | calcul seul {r.get('calcul_seul_s')} s | dans le conteneur {r.get('dans_le_conteneur_s')} s | pic VRAM {r.get('pic_vram_mo')} Mo", flush=True)
        if png:
            chemin = f"C:/tmp/bench_tex/sr_cloud_{n}_{resolution}.png"
            with open(chemin, "wb") as f:
                f.write(png)
            print(f"        image enregistree : {chemin} ({len(png) // 1024} Ko)", flush=True)
    print(f"[{time.time() - t0:.0f} s] TOUT EST FINI (attente cote utilisateur pour le lot)", flush=True)
