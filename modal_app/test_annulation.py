"""Banc « coupure a 100 s » (2026-09-29) — CPU seul, quelques centimes.

Verifie sur Modal ce que le test local ne peut pas montrer : quand le client coupe
(Cloudflare a 100 s -> 524), Modal annule la requete. Avant _calcul_protege, la boucle
bloquee ne repondait pas et Modal TUAIT le conteneur (« failed to respond to
cancellation for too long ») ; le rejeu repartait a froid.

MESURE (29/09) : la coupure n'annule PAS le calcul, il va au bout ; sans cle de rejeu,
le rejeu attendait derriere lui puis RECALCULAIT tout (deux « calcul debut »).
Attendu avec `_cle_rejeu` : un seul « calcul debut », le rejeu « rattache au calcul deja
lance », et /healthz repond pendant le calcul.

Usage :
    PYTHONUTF8=1 python -m modal deploy modal_app/test_annulation.py
    curl --max-time 100 -X POST <url>/lent -d '{"seed":1,"duree":150,"_cle_rejeu":"k1"}' -H 'content-type: application/json'
    ... puis le meme curl sans --max-time ; journal : modal app logs myfabmesh-test-annulation
    python -m modal app stop myfabmesh-test-annulation
"""
import modal

app = modal.App("myfabmesh-test-annulation")
image = (modal.Image.debian_slim(python_version="3.11")
         .pip_install("fastapi[standard]")
         .add_local_python_source("modal_app"))


@app.function(image=image, max_containers=1, scaledown_window=60)
@modal.concurrent(max_inputs=4, target_inputs=1)
@modal.asgi_app()
def routeur():
    import os
    import time

    from fastapi import FastAPI, Request

    from modal_app.app import _calcul_protege, _read_json

    api = FastAPI()
    conteneur = os.environ.get("MODAL_TASK_ID", "?")

    def lent(p):
        print(f"[test] calcul debut seed={p['seed']} conteneur={conteneur}", flush=True)
        time.sleep(float(p["duree"]))
        print(f"[test] calcul fin seed={p['seed']} conteneur={conteneur}", flush=True)
        return {"seed": p["seed"], "conteneur": conteneur, "fini_a": time.time()}

    @api.post("/lent")
    async def route(request: Request):
        return await _calcul_protege("lent", await _read_json(request), lent)

    @api.get("/healthz")
    async def healthz():
        return {"ok": True, "conteneur": conteneur}

    return api
