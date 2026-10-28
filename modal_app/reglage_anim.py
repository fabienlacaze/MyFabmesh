"""Reglage des parametres d'animation par Qwen3-4B (ESSAI du 28/10/2026, decision du user : « Modal, notre propre modele »).

MEME modele que le redacteur (Qwen3-4B quantifie 4 bits, Apache-2.0, ONNX Runtime GenAI sur CPU) : aucun LLM tiers.
APPLICATION A PART (`myfabmesh-reglage`) : la deployer ne touche pas `myfabmesh-cloud` (ni ses instantanes GPU).

    PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python -m modal deploy modal_app/reglage_anim.py

Contrat : le moteur d'animation envoie un texte (proportions du rig + mesures + leviers et leurs bornes) ; le modele repond UN objet JSON
{"leviers": {nom: valeur}, "raison": "..."} ; le moteur borne chaque valeur, applique, remesure et ne garde que ce qui ameliore.
Ce fichier ne fait que la generation de texte : la validation du JSON et des bornes est cote moteur / worker.
"""
import os
import threading
import time

import modal

app = modal.App("myfabmesh-reglage")

_DEPOT = "onnx-community/Qwen3-4B-ONNX"
_SOUS_DOSSIER = "onnxruntime/cpu_and_mobile/cpu-int4-kld-block-128"

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("onnxruntime-genai>=0.17,<0.18", "huggingface_hub>=0.36,<1", "fastapi[standard]")
    .env({"HF_HOME": "/root/hf"})
    .run_commands(
        "python -c \"from huggingface_hub import snapshot_download; "
        f"snapshot_download('{_DEPOT}', allow_patterns=['{_SOUS_DOSSIER}/*'])\""
    )
    .env({"HF_HUB_OFFLINE": "1"})
)

SYSTEME = (
    "You tune a procedural character animation engine. You receive the measurements of a generated animation on one specific rig "
    "and a list of numeric levers with their allowed ranges. Reply with ONE JSON object only: "
    '{"leviers": {"<name>": <number>, ...}, "raison": "<one short sentence>"}. '
    "Change only the levers that explain the measured defects, by moderate steps, and stay inside the ranges. "
    "If nothing is wrong, reply {\"leviers\": {}, \"raison\": \"ok\"}."
)


def _check_auth(payload: dict) -> None:
    from fastapi import HTTPException
    attendu = os.environ.get("SHARED_SECRET", "")
    if not attendu or (payload.get("_auth") or "").strip() != attendu:
        raise HTTPException(status_code=401, detail="auth")


def _dossier_modele():
    import glob
    cand = glob.glob(f"/root/hf/hub/models--{_DEPOT.replace('/', '--')}/snapshots/*/{_SOUS_DOSSIER}")
    if not cand:
        raise RuntimeError("modele absent de l'image")
    return cand[0]


@app.cls(
    image=image, cpu=4.0, memory=6144, timeout=300, scaledown_window=180, enable_memory_snapshot=True,
    secrets=[modal.Secret.from_name("myfabmesh-shared", required_keys=["SHARED_SECRET"])],
)
class Reglage:
    @modal.enter(snap=True)
    def charger(self):
        import onnxruntime_genai as og
        self.og = og
        self.modele = og.Model(_dossier_modele())
        self.tok = og.Tokenizer(self.modele)

    @modal.enter(snap=False)
    def apres_restauration(self):
        self.verrou = threading.Lock()

    @staticmethod
    def _json_complet(texte: str) -> bool:
        import json
        try:
            json.loads(texte.strip())
            return True
        except Exception:
            return False

    def _generer(self, utilisateur: str, max_jetons: int = 220, systeme: str = None):
        og = self.og
        invite = (f"<|im_start|>system\n{systeme or SYSTEME}<|im_end|>\n<|im_start|>user\n{utilisateur}<|im_end|>\n"
                  "<|im_start|>assistant\n<think>\n\n</think>\n\n")
        jetons = self.tok.encode(invite)
        params = og.GeneratorParams(self.modele)
        params.set_search_options(max_length=len(jetons) + max_jetons, do_sample=False)
        gen = og.Generator(self.modele, params)
        t0 = time.time()
        gen.append_tokens(jetons)
        t1 = time.time()
        sortie = []
        while not gen.is_done():
            gen.generate_next_token()
            sortie.append(gen.get_next_tokens()[0])
            if len(sortie) > 8 and len(sortie) % 16 == 0 and self._json_complet(self.tok.decode(sortie)):
                break
        return {"texte": self.tok.decode(sortie), "jetons_entree": len(jetons), "jetons_sortie": len(sortie),
                "s_lecture": round(t1 - t0, 1), "s_ecriture": round(time.time() - t1, 1)}

    @modal.method()
    def regler(self, utilisateur: str, max_jetons: int = 220, systeme: str = None):
        """Appel direct par le SDK Modal (essais) : protege par les identifiants Modal."""
        with self.verrou:
            return self._generer(utilisateur, max_jetons, systeme)

    @modal.fastapi_endpoint(method="POST")
    def ajuster(self, payload: dict):
        _check_auth(payload)
        if payload.get("prechauffer"):
            return {"ok": True, "pret": True}
        with self.verrou:
            return self._generer(str(payload.get("texte", ""))[:6000])
