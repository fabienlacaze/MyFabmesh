"""Banc SeedVR2 a 4096 px sur L40S (2026-10-02) — environ 0,8 $ au plus (plafond de la fonction : 25 min a ~1,95 $/h).

Question du user : « SeedVR2 en 8k ? » puis « tu peux tester 4096 sur cloud ? ». En local (RTX 5080, 16 Go) : 1024 -> 2048 prend 32 s ; 1024 -> 4096 n'a pas fini en 420 s
(15,5 Go de VRAM sur 16, probablement du decharge vers la RAM). Ici : meme depot (numz/ComfyUI-SeedVR2_VideoUpscaler), memes poids (3B fp8), meme photo, meme commande.

GPU : L40S (48 Go), celui du projet pour les images et le maillage ; la H100 coute environ le double (decision du user : prendre la carte habituelle).
Application SEPAREE de la production (aucun deploiement, rien ne touche aux instantanes) : `modal run`, qui s'arrete a la fin.
Les poids se telechargent au premier lancement (resolution 512 de rodage, mesuree a part) puis on mesure le 4096.

Usage :
    PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python -m modal run modal_app/test_seedvr2_4k.py
    ... --resolution 8192      (apres le 4096 seulement)
"""
import modal

DEPOT = "C:/tmp/bench_tex/seedvr2"            # copie locale du depot (sans models/)
PHOTO = "C:/tmp/bench_tex/photo_chev/photo.png"  # photo du chevalier, 1024 x 1024

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("libgl1", "libglib2.0-0")
    .pip_install("torch", "torchvision", "safetensors", "numpy", "tqdm", "psutil", "einops", "omegaconf>=2.3.0", "diffusers>=0.33.1",
                 "peft>=0.17.0", "rotary_embedding_torch>=0.5.3", "opencv-python-headless", "gguf", "matplotlib", "pillow", "huggingface_hub")
    .add_local_dir(DEPOT, "/root/seedvr2", ignore=["models/**", "**/__pycache__/**", ".git/**"])
    .add_local_file(PHOTO, "/root/in/photo.png")
)
app = modal.App("myfabmesh-test-seedvr2-4k", image=image)


@app.function(gpu="L40S", timeout=1500)
def mesurer(resolution: int = 4096) -> dict:
    import os
    import re
    import subprocess
    import sys
    import threading
    import time

    from PIL import Image

    Image.MAX_IMAGE_PIXELS = None
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
            time.sleep(1.5)
    threading.Thread(target=surveiller, daemon=True).start()

    base = [sys.executable, "inference_cli.py", "/root/in", "--output_format", "png", "--batch_size", "1", "--attention_mode", "sdpa",
            "--dit_model", "seedvr2_ema_3b_fp8_e4m3fn.safetensors", "--vae_encode_tiled", "--vae_decode_tiled", "--color_correction", "lab", "--seed", "42"]
    env = dict(os.environ, PYTHONUNBUFFERED="1")

    def lancer(res, sortie, limite):
        t0 = time.time()
        try:
            p = subprocess.run(base + ["--output", sortie, "--resolution", str(res)], cwd="/root/seedvr2", capture_output=True, text=True, timeout=limite, env=env)
            code, sortie_txt = p.returncode, (p.stdout or "") + (p.stderr or "")
        except subprocess.TimeoutExpired as e:
            code, sortie_txt = "timeout", (e.stdout.decode() if isinstance(e.stdout, bytes) else (e.stdout or "")) + (e.stderr.decode() if isinstance(e.stderr, bytes) else (e.stderr or ""))
        return code, round(time.time() - t0, 1), sortie_txt

    # 1. rodage : telecharge les poids et chauffe le GPU, mesure a part
    code, duree, txt = lancer(512, "/root/out512", 420)
    r["rodage 512 px"] = {"code": code, "duree_s": duree}
    pic["mo"] = 0
    # 2. la mesure
    code, duree, txt = lancer(resolution, "/root/out", 900)
    r[f"{resolution} px"] = {"code": code, "duree_totale_s": duree, "pic_vram_mo": pic["mo"]}
    m = re.search(r"completed successfully in ([\d.]+)s", txt)
    if m:
        r[f"{resolution} px"]["duree_cli_s"] = float(m.group(1))
    r["fin_du_journal"] = [l[:160] for l in txt.strip().splitlines()[-8:]]
    stop.set()
    sortie = "/root/out/photo.png"
    if os.path.exists(sortie):
        im = Image.open(sortie).convert("RGB")
        r["taille_sortie"] = im.size
        import io
        b = io.BytesIO(); im.save(b, "JPEG", quality=93); r["jpeg"] = b.getvalue()
    return r


@app.local_entrypoint()
def main(resolution: int = 4096):
    r = mesurer.remote(resolution)
    jpeg = r.pop("jpeg", None)
    for k, v in r.items():
        print(f"{k}: {v}")
    if jpeg:
        with open(f"C:/tmp/bench_tex/seedvr2_cloud_{resolution}.jpg", "wb") as f:
            f.write(jpeg)
        print(f"image enregistree : C:/tmp/bench_tex/seedvr2_cloud_{resolution}.jpg ({len(jpeg) // 1024} Ko)")
