"""BANC (2026-09-29) : duree du CHARGEMENT COMPLET du conteneur 3D (celui que paie chaque creation
d'instantane), sur une application EPHEMERE : Modal n'y prend jamais d'instantane, le chargement
complet s'execute donc a chaque demarrage. Sert a comparer « poids telecharges depuis HuggingFace »
et « poids dans l'image » sans toucher a la production.

    PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python modal_app/test_chargement_3d.py
"""
import time

import modal

from modal_app.app import MyFabmeshMesh, app

if __name__ == "__main__":
    with modal.enable_output():
        with app.run():
            t = time.time()
            MyFabmeshMesh().rechauffer.remote()
            print(f"conteneur 3D pret (chargement complet + mise en route) en {time.time() - t:.0f} s")
