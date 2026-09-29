"""A lancer JUSTE APRES chaque `python -m modal deploy modal_app/app.py` (2026-09-29).

Un deploiement invalide les instantanes de TOUTES les classes. Sans ce script, c'est
la premiere generation d'un utilisateur qui paie leur reconstruction : mesure le
2026-09-29, 4 Husky lances 3 min apres un deploiement ont attendu 3 a 5 min de plus
(maillage : chargement complet 162 s ; conteneur image : 262 s + passage sur la carte).

Le script demarre un conteneur de chaque classe (methode `rechauffer`, qui ne fait
rien) et attend qu'il reponde : l'instantane est alors cree. Cout : un demarrage a
froid par classe (~0,05-0,10 $ chacune).

    PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python build/rechauffer_apres_deploy.py
"""
import time
from concurrent.futures import ThreadPoolExecutor

import modal

APP = "myfabmesh-cloud"
CLASSES = ("MyFabmeshPredictor", "MyFabmeshBackview", "MyFabmeshMesh")


def rechauffer(nom: str) -> str:
    t0 = time.time()
    try:
        modal.Cls.from_name(APP, nom)().rechauffer.remote()
        return f"{nom:20s} pret en {time.time() - t0:5.0f} s"
    except Exception as e:
        return f"{nom:20s} ECHEC apres {time.time() - t0:5.0f} s : {type(e).__name__}: {e}"


if __name__ == "__main__":
    with ThreadPoolExecutor(len(CLASSES)) as fils:
        for ligne in fils.map(rechauffer, CLASSES):
            print(ligne, flush=True)
