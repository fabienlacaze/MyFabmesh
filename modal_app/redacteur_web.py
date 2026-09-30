"""Redacteur de la fenetre « New project » pour le SITE (2026-09-30).

MEME modele et MEME script que le bureau : modal_app/redacteur/redacteur.py est une copie EXACTE de scripts/redacteur.py
(surveillee par build/check-noyaux-partages.mjs). Qwen3-4B quantifie en 4 bits (onnx-community/Qwen3-4B-ONNX, Apache-2.0)
sur le PROCESSEUR avec ONNX Runtime GenAI (MIT) : aucun GPU, aucun service tiers (exigence du user : « local gratuit et
commercialisable comme tout le reste » — le web tourne sur NOTRE Modal, avec le meme modele open source).

APPLICATION A PART (`myfabmesh-redacteur`) : la deployer ne touche pas `myfabmesh-cloud`, donc ne reconstruit pas ses
instantanes GPU.

    PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python -m modal deploy modal_app/redacteur_web.py

Le worker l'appelle depuis /api/describe-asset (URL : MODAL_REDACTEUR_URL, sinon deduite de celle du routeur maillage)
avec la cle partagee. {"prechauffer": true} demarre le conteneur sans rien rediger (ouverture de la fenetre).
"""
import os
import threading

import modal

app = modal.App("myfabmesh-redacteur")

_DEPOT = "onnx-community/Qwen3-4B-ONNX"
_SOUS_DOSSIER = "onnxruntime/cpu_and_mobile/cpu-int4-kld-block-128"

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("onnxruntime-genai>=0.17,<0.18", "huggingface_hub>=0.36,<1", "fastapi[standard]")
    .env({"HF_HOME": "/root/hf"})
    # Poids DANS l'image (2,9 Go) : un conteneur froid ne telecharge rien.
    .run_commands(
        "python -c \"from huggingface_hub import snapshot_download; "
        f"snapshot_download('{_DEPOT}', allow_patterns=['{_SOUS_DOSSIER}/*'])\""
    )
    .env({"HF_HUB_OFFLINE": "1"})
    .add_local_file("modal_app/redacteur/redacteur.py", remote_path="/opt/redacteur/redacteur.py")
)


def _check_auth(payload: dict) -> None:
    from fastapi import HTTPException
    attendu = os.environ.get("SHARED_SECRET", "")
    if not attendu or (payload.get("_auth") or "").strip() != attendu:
        raise HTTPException(status_code=401, detail="auth")


@app.cls(
    image=image, cpu=4.0, memory=6144, timeout=120, scaledown_window=180,
    secrets=[modal.Secret.from_name("myfabmesh-shared", required_keys=["SHARED_SECRET"])],
)
@modal.concurrent(max_inputs=4)
class Redacteur:
    @modal.enter()
    def charger(self):
        import sys
        sys.path.insert(0, "/opt/redacteur")
        import redacteur
        redacteur.charger()
        self.r = redacteur
        self.verrou = threading.Lock()          # une redaction a la fois (le processeur est partage)

    @modal.fastapi_endpoint(method="POST")
    def decrire(self, payload: dict):
        _check_auth(payload)
        if payload.get("prechauffer"):
            return {"ok": True, "pret": True}
        with self.verrou:
            return self.r.decrire(payload.get("name", ""), payload.get("notes", ""),
                                  payload.get("lang", "en"), payload.get("type"))
