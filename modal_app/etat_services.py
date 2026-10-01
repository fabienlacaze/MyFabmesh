"""Etat REEL des conteneurs Modal, pour le panneau « Cloud services » du site (2026-09-29).

APPLICATION A PART (`myfabmesh-etat`) : la deployer ne touche pas `myfabmesh-cloud`, donc
ne force pas la reconstruction de ses instantanes (3-4 min et ~0,30 $ a chaque deploiement).

    PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python -m modal deploy modal_app/etat_services.py

Le worker l'appelle depuis /api/modal-status (URL deduite de celle du routeur maillage, ou
MODAL_ETAT_URL) avec la cle partagee.
"""
import os
import time

import modal

app = modal.App("myfabmesh-etat")


def _check_auth(payload: dict) -> None:
    from fastapi import HTTPException
    attendu = os.environ.get("SHARED_SECRET", "")
    if not attendu or (payload.get("_auth") or "").strip() != attendu:
        raise HTTPException(status_code=401, detail="auth")


# ---------------------------------------------------------------------------
# ETAT REEL DES CONTENEURS (2026-09-29, demande du user : « c'est vraiment important »).
#
# Le panneau « Cloud services » du site ESTIMAIT l'etat de chaque service (heure du dernier
# appel) : il annoncait « warm » un conteneur qui mettait encore 3 min a demarrer, et le
# gardait « warm » 9 min alors que le conteneur s'eteint apres 5. Ici on lit les compteurs
# de Modal lui-meme (get_current_stats) : conteneurs, requetes en cours, en attente, place
# libre. MESURE sur un vrai demarrage du conteneur image : pendant le boot, attente=1 et
# place=0 ; une fois pret, attente=0 et place=1. D'ou quatre etats :
#   busy     : au moins une requete en cours de calcul ;
#   warm     : un conteneur pret, avec de la place ;
#   starting : un conteneur existe (ou une requete attend) mais aucun n'est pret ;
#   cold     : rien ;
#   absent   : l'application n'est pas deployee (service indisponible).
# Fonction CPU legere (aucune image lourde), cle partagee exigee ; reponse gardee 3 s.
_SERVICES_ETAT = {
    # cle : (application Modal, classe ou None, methode de la classe ou fonction)
    "text2image":   ("myfabmesh-cloud", "MyFabmeshPredictor", "rechauffer"),
    "image":        ("myfabmesh-cloud", "MyFabmeshBackview", "rechauffer"),
    "mesh":         ("myfabmesh-cloud", "MyFabmeshMesh", "rechauffer"),
    "mvadapter":    ("myfabmesh-mvadapter", "MyFabmeshMVAdapter", "generate"),
    "mesh_segment": ("myfabmesh-partsam", None, "segment_mesh"),
    "rig":          ("myfabmesh-skintokens", None, "rig_mesh"),
    "anim":         ("myfabmesh-unimate", None, "animer_unimate"),
    "fbx_retarget": ("myfabmesh-fbx-retarget", None, "retarget"),
}
_ETAT_CACHE: dict = {"t": 0.0, "v": None}
_ETAT_FONCTIONS: dict = {}


def _etat_service(cle: str) -> dict:
    app_nom, classe, nom = _SERVICES_ETAT[cle]
    fn = _ETAT_FONCTIONS.get(cle)
    if fn is None:
        fn = (getattr(modal.Cls.from_name(app_nom, classe)(), nom) if classe
              else modal.Function.from_name(app_nom, nom))
        _ETAT_FONCTIONS[cle] = fn
    s = fn.get_current_stats()
    if s.num_running_inputs > 0:
        etat = "busy"
    elif s.num_total_runners > 0 and s.input_headroom > 0:
        etat = "warm"
    elif s.num_total_runners > 0 or s.backlog > 0:
        etat = "starting"
    else:
        etat = "cold"
    return {"etat": etat, "conteneurs": s.num_total_runners,
            "en_cours": s.num_running_inputs, "attente": s.backlog}


@app.function(
    image=modal.Image.debian_slim(python_version="3.11").pip_install("fastapi[standard]"),
    cpu=0.25, memory=512, timeout=30, scaledown_window=300,
    secrets=[modal.Secret.from_name("myfabmesh-shared", required_keys=["SHARED_SECRET"])],
)
@modal.concurrent(max_inputs=16)
@modal.fastapi_endpoint(method="POST")
def etat_services(payload: dict):
    _check_auth(payload)
    maintenant = time.time()
    if _ETAT_CACHE["v"] is not None and maintenant - _ETAT_CACHE["t"] < 3:
        return _ETAT_CACHE["v"]
    from concurrent.futures import ThreadPoolExecutor

    def un(cle):
        try:
            return cle, _etat_service(cle)
        except modal.exception.NotFoundError:       # application non deployee (multi-vues au 29/09)
            return cle, {"etat": "absent"}
        except Exception as e:                      # API indisponible...
            return cle, {"etat": "inconnu", "erreur": type(e).__name__}
    with ThreadPoolExecutor(len(_SERVICES_ETAT)) as fils:
        v = dict(fils.map(un, _SERVICES_ETAT))
    _ETAT_CACHE.update(t=maintenant, v=v)
    return v


# ---------------------------------------------------------------------------
# GARDE AU CHAUD (2026-10-01, user : « je veux un switch pour basculer entre cold et warm, pour chaque container et pour le general »).
# `update_autoscaler(min_containers=1)` garde UN conteneur allume en permanence (mesure sur le conteneur FBX : chaud en 6 s) ;
# `min_containers=0` le relache (mesure : froid en 11 s, sans rien forcer). Le reglage vit chez Modal jusqu'au prochain deploiement de
# l'application visee ; le worker le rejoue a chaque passage du cron tant que l'interrupteur est allume (voir worker.ts, _gardeChaudCron).
# Un travail en cours n'est jamais coupe : abaisser le minimum laisse le conteneur finir, puis il s'eteint.
_OBJETS_GARDE: dict = {}


def _objet_garde(cle: str):
    o = _OBJETS_GARDE.get(cle)
    if o is None:
        app_nom, classe, nom = _SERVICES_ETAT[cle]
        o = modal.Cls.from_name(app_nom, classe)() if classe else modal.Function.from_name(app_nom, nom)
        _OBJETS_GARDE[cle] = o
    return o


@app.function(
    image=modal.Image.debian_slim(python_version="3.11").pip_install("fastapi[standard]"),
    cpu=0.25, memory=512, timeout=60, scaledown_window=60,
    secrets=[modal.Secret.from_name("myfabmesh-shared", required_keys=["SHARED_SECRET"])],
)
@modal.fastapi_endpoint(method="POST")
def garde_chaud(payload: dict):
    """payload : { _auth, cibles: { cle: true | false } } -> { resultats: { cle: "ok" | "absent" | "erreur:..." } }."""
    _check_auth(payload)
    demandes = payload.get("cibles") or {}
    from concurrent.futures import ThreadPoolExecutor

    def un(item):
        cle, allume = item
        if cle not in _SERVICES_ETAT or cle == "mvadapter":
            return cle, "inconnu"
        try:
            _objet_garde(cle).update_autoscaler(min_containers=1 if allume else 0)
            return cle, "ok"
        except modal.exception.NotFoundError:
            return cle, "absent"
        except Exception as e:
            return cle, "erreur:" + type(e).__name__
    with ThreadPoolExecutor(max(1, len(demandes))) as fils:
        res = dict(fils.map(un, list(demandes.items())))
    _ETAT_CACHE.update(t=0.0, v=None)               # l'etat affiche doit refleter le changement tout de suite
    return {"resultats": res}
