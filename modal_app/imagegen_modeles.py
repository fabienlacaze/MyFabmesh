"""Generation d'image « Rapide » (Z-Image Turbo) et « Meilleur » (Qwen-Image-2512) — application Modal SEPAREE (2026-10-25).

Pourquoi une application a part : `myfabmesh-cloud` cree 2-3 instantanes par type de GPU a CHAQUE deploiement (3-4 min payees par la
premiere generation qui tombe dessus). Ces deux modeles n'ont pas d'instantane : les ajouter la-bas n'apporterait rien et obligerait a
redeployer toute l'application. Deploiement independant :
    PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python -m modal deploy modal_app/imagegen_modeles.py
Les URL affichees vont dans le worker : MODAL_ZIMAGE_URL, MODAL_QWEN_URL (secret du worker, jamais commite).

Contrat IDENTIQUE a `MyFabmeshPredictor` /text2image : POST JSON {_auth, prompt, asset_type, asset_style, seed, pose_libre,
negative_extra, unrestricted, _cle_rejeu} -> PNG brut. Le worker garde donc sa logique (524, rejeu, remboursement).

Licences : Z-Image (Tongyi-MAI) et Qwen-Image (QwenLM) sont Apache-2.0 (LICENSE lus sur GitHub le 2026-10-24).
Mesures (banc du 2026-10-24, 1024x1024) : Z-Image Turbo 3,9 s/image sur L40S, 23 Go de VRAM ; Qwen 44 s/image sur A100 80 Go, 205 s de
chargement a froid. Z-Image Turbo n'a PAS de prompt negatif : une negation ne passe que par la reformulation positive du texte.
"""
import asyncio
import io
import os
import re
import threading
import time

import modal

app = modal.App("myfabmesh-imagegen")
poids = modal.Volume.from_name("myfabmesh-imagegen-poids", create_if_missing=True)
HF = {"HF_HOME": "/poids/hf", "HF_HUB_ENABLE_HF_TRANSFER": "1", "PYTHONUNBUFFERED": "1"}
SECRETS = [modal.Secret.from_name("myfabmesh-shared", required_keys=["SHARED_SECRET"])]

image = (modal.Image.debian_slim(python_version="3.11").apt_install("git")
         .pip_install("torch==2.8.0", "torchvision==0.23.0", "transformers>=4.57", "accelerate", "safetensors",
                      "sentencepiece", "protobuf", "pillow", "hf_transfer", "huggingface_hub", "fastapi[standard]")
         # ZImagePipeline et QwenImagePipeline exigent un diffusers recent (installe depuis les sources au banc du 24/10)
         .pip_install("git+https://github.com/huggingface/diffusers")
         .env(HF)
         .add_local_python_source("modal_app"))

# Termes ajoutes au negatif de Qwen (vrai prompt negatif, true_cfg_scale) : fond propre, pas de texte.
NEGATIF_QWEN = "blurry, low quality, deformed, extra limbs, extra fingers, cropped, cut off, shadow, ground, floor, text, watermark, logo"


# Animaux SANS PATTES (le texte est deja en anglais : le site le traduit avant l'envoi)
_SANS_PATTES = re.compile(r"\b(snakes?|serpents?|cobras?|pythons?|vipers?|anacondas?|boas?|mambas?|rattlesnakes?|adders?|eels?|worms?|slugs?|leeches|serpentine)\b", re.IGNORECASE)


def gabarit(prompt: str, asset_type: str, asset_style: str, pose_libre: bool) -> str:
    """Cadrage du produit en langage naturel (ces modeles n'ont pas la limite de 77 jetons de CLIP).
    Personnage : plein pied, de face, T-pose sauf case decochee. Le gabarit a donne 4/4 T-pose propres sur le banc du 24/10."""
    texte = (prompt or "").strip().rstrip(".")
    style = (asset_style or "realistic").strip().lower()
    habillage = "" if style in ("", "realistic", "photorealistic") else f", {style} style"
    fond = "isolated on a plain pure white background, centered, no shadow, studio photograph, sharp details"
    t = (asset_type or "character").lower()
    if t in ("character", "unit", "humanoid"):
        pose = ("standing upright, facing the camera, arms down" if pose_libre else
                "standing in a T-pose with both arms stretched out horizontally, feet apart, facing the camera")
        return f"Full-body front view of {texte}{habillage}, {pose}, {fond}."
    if t in ("animal", "creature", "beast"):
        # 25/10 (user : « le snake a des pattes et il n'est pas allonge, impossible de l'animer proprement ») : « all feet on the ground » faisait pousser des pattes
        # a un serpent ; un animal SANS PATTES est demande etire, tete a queue, sans membres (meme idee que le gabarit « sans_pattes » du moteur d'image classique).
        if _SANS_PATTES.search(texte):
            return (f"Full-body view of {texte}{habillage}, a long slender body stretched out nearly straight along the ground from head to tail tip, "
                    f"the whole length visible, no legs, no limbs, no feet, seen from slightly above, {fond}.")
        return f"Full-body side view of {texte}{habillage}, all feet on the ground, {fond}."
    if t in ("avion", "aircraft"):
        # 25/10 (user : « j'aimerais plutot cette orientation ») : vue de trois quarts HAUTE, nez vers le bas a gauche, ailes et derive visibles.
        # 25/10 : « seen from above at 45 degrees » donnait une vue de DESSUS pure (Z-Image, 14:25) : on decrit la perspective, pas l'angle.
        return (f"Three-quarter perspective view of {texte}{habillage}, the aircraft seen from its front left side with the camera only slightly above it, "
                f"the nose pointing toward the lower left corner of the image, wings spread, the whole aircraft visible from nose to tail with both wings and the tail fin, {fond}.")
    if t in ("avion", "bateau", "vehicle", "other_vehicle", "aircraft", "boat", "ship", "car"):
        # 25/10 : un vehicule de FACE cache sa longueur et son envergure (3D mediocre) : trois quarts avant, un peu au-dessus.
        return (f"Three-quarter front view of {texte}{habillage}, seen from the front left and slightly above, "
                f"the whole vehicle visible from end to end, {fond}.")
    if t == "icon":
        return f"Front view of {texte}{habillage}, the whole object visible, {fond}."
    # 25/10 (user : « tout ce qui n'est pas vivant oriente comme les avions ») : trois quarts HAUTE, avant gauche.
    # 25/10 : un bateau / un vehicule sortait en MAQUETTE posee sur un socle d'exposition : on demande l'objet reel, grandeur nature.
    reel = "a real full-size " if t in ("bateau", "boat", "ship", "vehicle", "other_vehicle", "car") else ""
    return (f"High three-quarter view of {reel}{texte}{habillage}, seen from the front left and about 45 degrees above, "
            f"the whole object visible with nothing underneath it, {fond}.")


def _nettoyer_negations(brut):
    if not isinstance(brut, list):
        return []
    sortie = []
    for t in brut:
        if isinstance(t, str) and 0 < len(t.strip()) <= 60 and len(sortie) < 20:
            sortie.append(t.strip())
    return sortie


class _Base:
    """Corps commun. Les sous-classes fixent REPO / PIPE / pas / guidance."""
    REPO = ""
    PIPE = ""
    PAS = 9
    GUIDANCE = 0.0
    CFG_KW = "guidance_scale"
    NEGATIF = False

    @modal.enter()
    def charger(self):
        import diffusers
        import torch
        from transformers import pipeline as hfpipeline
        t = time.time()
        self.torch = torch
        self.pipe = getattr(diffusers, self.PIPE).from_pretrained(self.REPO, torch_dtype=torch.bfloat16)
        self.pipe.to("cuda")
        # Memes classifieurs que MyFabmeshPredictor (controle parental identique), sur CPU.
        self.clf1 = hfpipeline("image-classification", model="Falconsai/nsfw_image_detection", device="cpu")
        self.clf2 = hfpipeline("image-classification", model="AdamCodd/vit-base-nsfw-detector", device="cpu")
        poids.commit()
        self.verrou = threading.Lock()
        self.verrou_cle = threading.Lock()
        self.en_cours = {}   # cle de rejeu -> (horodatage, Future) : un rejeu apres 524 se rattache au calcul deja lance
        print(f"[imagegen/ready] {self.REPO} en {time.time() - t:.1f}s", flush=True)

    def _generer(self, prompt, asset_type, asset_style, seed, pose_libre, negs, unrestricted):
        from modal_app._nsfw import is_safe, make_blocked_placeholder
        texte = gabarit(prompt, asset_type, asset_style, pose_libre)
        kw = dict(prompt=texte, width=1024, height=1024, num_inference_steps=self.PAS,
                  generator=self.torch.Generator("cuda").manual_seed(int(seed)))
        kw[self.CFG_KW] = self.GUIDANCE
        if self.NEGATIF:
            kw["negative_prompt"] = ", ".join([NEGATIF_QWEN] + negs)
        t = time.time()
        with self.verrou:   # un calcul a la fois sur la carte
            img = self.pipe(**kw).images[0]
        print(f"[imagegen] {self.REPO} {time.time() - t:.1f}s seed={seed} negs={len(negs)}", flush=True)
        if not unrestricted and os.environ.get("FABMESH_UNRESTRICTED") != "1":
            sur, score = is_safe(img, self.clf1, self.clf2, asset_type=asset_type)
            if not sur:
                print(f"[imagegen] BLOQUE nsfw={score:.2f}", flush=True)
                img = make_blocked_placeholder(img.size)
        b = io.BytesIO()
        img.save(b, "PNG")
        return b.getvalue()


# Fonction de module (pas methode) : partagee par les deux classes ; evite aussi que la garde check_modal_deps cherche une methode heritee.
def construire_api(self):
    from fastapi import FastAPI, HTTPException, Request
    from fastapi.responses import Response
    from modal_app._moderation_texte import prompt_hard_floor as _prompt_hard_floor   # meme plancher illegal que la route d'origine (jamais contourne)
    from modal_app._prompts import texte_pour_plancher
    api = FastAPI(title="myfabmesh-imagegen")

    @api.post("/text2image")
    async def text2image(request: Request):
        try:
            payload = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="bad json")
        attendu = os.environ.get("SHARED_SECRET", "")
        if not attendu or (payload.get("_auth") or "").strip() != attendu:
            raise HTTPException(status_code=401, detail="auth")
        prompt = (payload.get("prompt") or "").strip()
        if not prompt:
            raise HTTPException(status_code=400, detail="prompt required")
        negs = _nettoyer_negations(payload.get("negative_extra"))
        raison = _prompt_hard_floor(texte_pour_plancher(prompt, negs))
        if raison:
            raise HTTPException(status_code=403, detail=raison)
        cle = str(payload.get("_cle_rejeu") or "")
        boucle = asyncio.get_running_loop()
        with self.verrou_cle:
            for k in [k for k, (h, _) in self.en_cours.items() if time.time() - h > 600]:
                del self.en_cours[k]
            existant = self.en_cours.get(cle) if cle else None
            if existant is None:
                futur = boucle.run_in_executor(None, lambda: self._generer(
                    prompt, payload.get("asset_type") or "character", payload.get("asset_style") or "realistic",
                    int(payload.get("seed") or 0), bool(payload.get("pose_libre")), negs, bool(payload.get("unrestricted"))))
                if cle:
                    self.en_cours[cle] = (time.time(), futur)
            else:
                futur = existant[1]
        png = await asyncio.shield(futur)   # un 524 n'annule pas le calcul : le rejeu s'y rattache
        return Response(content=png, media_type="image/png")

    @api.get("/healthz")
    async def healthz():
        return {"ok": True, "modele": self.REPO}
    return api


_COMMUN = dict(image=image, volumes={"/poids": poids}, secrets=SECRETS, timeout=1800, max_containers=2, cpu=4.0)


@app.cls(gpu="L40S", scaledown_window=300, memory=32768, **_COMMUN)
@modal.concurrent(max_inputs=4, target_inputs=1)
class ZImageTurbo(_Base):
    """« Rapide » : 9 pas, aucune guidance, aucun negatif."""
    REPO = "Tongyi-MAI/Z-Image-Turbo"
    PIPE = "ZImagePipeline"
    PAS = 9
    GUIDANCE = 0.0
    CFG_KW = "guidance_scale"
    NEGATIF = False

    @modal.asgi_app()
    def web(self):
        return construire_api(self)


@app.cls(gpu="A100-80GB", scaledown_window=300, memory=65536, **_COMMUN)
@modal.concurrent(max_inputs=4, target_inputs=1)
class QwenImage(_Base):
    """« Meilleur » : 50 pas, vrai prompt negatif (true_cfg_scale 4). Sans negatif la guidance vraie est ignoree : " " au minimum."""
    REPO = "Qwen/Qwen-Image-2512"
    PIPE = "QwenImagePipeline"
    PAS = 50
    GUIDANCE = 4.0
    CFG_KW = "true_cfg_scale"
    NEGATIF = True

    @modal.asgi_app()
    def web(self):
        return construire_api(self)
