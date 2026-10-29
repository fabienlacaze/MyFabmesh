"""Reglage des parametres d'animation par Qwen3.6-35B-A3B sur GPU (ESSAI du 28/10/2026, decision du user : « on va tester sur Modal d'abord »).

Modele : Qwen/Qwen3.6-35B-A3B-FP8 (open weights, Apache-2.0 annonce ; 35 Md de parametres dont ~3 Md actifs par jeton, mixture-of-experts),
servi par vLLM (>= 0.17 d'apres la recette vLLM du modele). Poids DANS l'image : un conteneur froid ne telecharge rien.
APPLICATION A PART (`myfabmesh-reglage-gpu`) : la deployer ne touche pas `myfabmesh-cloud` (ni ses instantanes GPU).

    PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python -m modal deploy modal_app/reglage_anim_gpu.py

Meme contrat que modal_app/reglage_anim.py (Qwen3-4B CPU) : regler(utilisateur, max_jetons, systeme) -> {"texte": ..., temps}.
Essai : mesurer (1) le demarrage a froid, (2) la duree d'une reponse a chaud, (3) la qualite sur le prompt « liste des 52 os -> concevoir la course ».
"""
import os
import threading
import time

import modal

app = modal.App("myfabmesh-reglage-gpu")

_MODELE = "Qwen/Qwen3.6-35B-A3B-FP8"
_GPU = os.environ.get("REGLAGE_GPU", "L40S")

image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install("vllm>=0.17,<1", "huggingface_hub>=0.36,<2", "hf_transfer", "fastapi[standard]")
    .env({"HF_HOME": "/root/hf", "HF_HUB_ENABLE_HF_TRANSFER": "1"})
    .run_commands(
        f"python -c \"from huggingface_hub import snapshot_download; snapshot_download('{_MODELE}')\""
    )
    .env({"HF_HUB_OFFLINE": "1"})
)


def _check_auth(payload: dict) -> None:
    from fastapi import HTTPException
    attendu = os.environ.get("SHARED_SECRET", "")
    if not attendu or (payload.get("_auth") or "").strip() != attendu:
        raise HTTPException(status_code=401, detail="auth")


# INSTANTANE GPU (demande du user : « lancer Qwen 3.6 le plus vite possible ») : le modele est charge sur la carte PENDANT la prise
# d'instantane, puis RESTAURE au demarrage d'un conteneur froid, comme `MyFabmeshMesh` (modal_app/app.py). Meme regle que les autres classes :
# un instantane est propre au type de machine (2-3 par type de GPU, crees aux premiers demarrages apres un deploiement).
@app.cls(
    image=image, gpu=_GPU, timeout=900, scaledown_window=30,   # 29/10 (user) : le conteneur s'eteint 30 s apres le dernier appel ; redemarrage a froid mesure : 20 s (snapshot GPU)
     enable_memory_snapshot=True,
    experimental_options={"enable_gpu_snapshot": True},
    secrets=[modal.Secret.from_name("myfabmesh-shared", required_keys=["SHARED_SECRET"])],
)
class ReglageGpu:
    @modal.enter(snap=True)
    def charger(self):
        from vllm import LLM
        t0 = time.time()
        self.llm = LLM(model=_MODELE, max_model_len=12288, gpu_memory_utilization=0.88, enforce_eager=True, limit_mm_per_prompt={"image": 4})
        self.s_chargement = round(time.time() - t0, 1)

    @modal.enter(snap=False)
    def apres_restauration(self):
        self.verrou = threading.Lock()

    @modal.method()
    def rechauffer(self):
        """Methode vide : la lancer cree l'instantane tout de suite (comme build/rechauffer_apres_deploy.py)."""
        return {"ok": True, "s_chargement_pris_dans_l_instantane": self.s_chargement}

    def _generer(self, utilisateur: str, max_jetons: int = 1100, systeme: str = None):
        from vllm import SamplingParams
        messages = []
        if systeme:
            messages.append({"role": "system", "content": systeme})
        messages.append({"role": "user", "content": utilisateur})
        t0 = time.time()
        sortie = self.llm.chat(
            messages, SamplingParams(temperature=0.0, max_tokens=max_jetons),
            chat_template_kwargs={"enable_thinking": False},
        )[0]
        texte = sortie.outputs[0].text
        return {"texte": texte, "jetons_entree": len(sortie.prompt_token_ids), "jetons_sortie": len(sortie.outputs[0].token_ids),
                "s_generation": round(time.time() - t0, 1), "s_chargement_conteneur": self.s_chargement}

    def _voir(self, utilisateur: str, images_b64: list, max_jetons: int = 900, systeme: str = None):
        """Le modele regarde des images (JPEG en base64) et repond a la question : juge visuel des planches d'animation."""
        from vllm import SamplingParams
        contenu = [{"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + b}} for b in images_b64[:4]]
        contenu.append({"type": "text", "text": utilisateur})
        messages = ([{"role": "system", "content": systeme}] if systeme else []) + [{"role": "user", "content": contenu}]
        t0 = time.time()
        sortie = self.llm.chat(messages, SamplingParams(temperature=0.0, max_tokens=max_jetons),
                               chat_template_kwargs={"enable_thinking": False})[0]
        return {"texte": sortie.outputs[0].text, "jetons_entree": len(sortie.prompt_token_ids),
                "jetons_sortie": len(sortie.outputs[0].token_ids), "s_generation": round(time.time() - t0, 1)}

    @modal.method()
    def voir(self, utilisateur: str, images_b64: list, max_jetons: int = 900, systeme: str = None):
        with self.verrou:
            return self._voir(utilisateur, images_b64, max_jetons, systeme)

    @modal.method()
    def regler(self, utilisateur: str, max_jetons: int = 1100, systeme: str = None):
        """Appel direct par le SDK Modal (essais) : protege par les identifiants Modal."""
        with self.verrou:
            return self._generer(utilisateur, max_jetons, systeme)

    @modal.fastapi_endpoint(method="POST")
    def ajuster(self, payload: dict):
        _check_auth(payload)
        if payload.get("prechauffer"):
            return {"ok": True, "pret": True}
        with self.verrou:
            return self._generer(str(payload.get("texte", ""))[:12000], int(payload.get("max_jetons", 1100)), payload.get("systeme"))
