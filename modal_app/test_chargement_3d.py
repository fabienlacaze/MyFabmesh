"""BANC (2026-09-29) : duree du CHARGEMENT COMPLET des conteneurs GPU (celui que paie chaque creation
d'instantane), sur une application EPHEMERE : Modal n'y prend jamais d'instantane, le chargement
complet s'execute donc a chaque demarrage. Sert a comparer « poids telecharges depuis HuggingFace »
et « poids dans l'image » sans toucher a la production.

    PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python -m modal_app.test_chargement_3d [Classe ...]
"""
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import modal

from modal_app import app as A

if __name__ == "__main__":
    classes = sys.argv[1:] or ["MyFabmeshMesh"]

    def un(nom):
        t = time.time()
        getattr(A, nom)().rechauffer.remote()
        return f"{nom} pret (chargement complet + mise en route) en {time.time() - t:.0f} s"

    with modal.enable_output():
        with A.app.run():
            with ThreadPoolExecutor(len(classes)) as fils:
                for ligne in fils.map(un, classes):
                    print(ligne, flush=True)
