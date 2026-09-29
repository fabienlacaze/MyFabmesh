"""Garde les services GPU ALLUMES le temps d'une demo, puis les eteint tout seul (2026-09-29).

User : « je vais faire une demo, est-ce qu'on peut allumer les conteneurs pour les images, la 3D et le
rig ? ». Un conteneur froid fait attendre 1 a 4 min (restauration d'instantane, chargement du rig) ; une
demo ne doit jamais attendre. On impose donc `min_containers=1` a chaque service le temps voulu, puis on
revient a 0 (le fonctionnement normal : Modal eteint apres `scaledown_window`).

Services : image (MyFabmeshPredictor), rectification / T-pose / vue de dos (MyFabmeshBackview), 3D
(MyFabmeshMesh), rig (myfabmesh-skintokens / rig_mesh).

COUT tant que c'est allume, calcul ou pas : 3 L40S (~1,95 $/h chacune) + 1 A10G (~1,10 $/h) = ~7 $/h.
Le retour a 0 est fait par CE processus : s'il est tue, les conteneurs restent allumes jusqu'au prochain
`modal deploy` ou jusqu'a `--arreter`. Un `modal deploy` remet aussi tout a la configuration du code.

    PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python build/demo_a_chaud.py --minutes 60
    PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python build/demo_a_chaud.py --arreter
    Arret anticipe d'une demo en cours : creer le fichier C:/tmp/demo_a_chaud.STOP
"""
import argparse
import json
import os
import subprocess
import sys
import time

import modal

CLASSES = [("myfabmesh-cloud", "MyFabmeshPredictor"), ("myfabmesh-cloud", "MyFabmeshBackview"),
           ("myfabmesh-cloud", "MyFabmeshMesh")]
FONCTIONS = [("myfabmesh-skintokens", "rig_mesh")]
STOP = "C:/tmp/demo_a_chaud.STOP"


def regler(n: int) -> None:
    for app, cls in CLASSES:
        modal.Cls.from_name(app, cls)().update_autoscaler(min_containers=n)
        print(f"  {cls:22s} min_containers={n}", flush=True)
    for app, fn in FONCTIONS:
        modal.Function.from_name(app, fn).update_autoscaler(min_containers=n)
        print(f"  {app}/{fn:10s} min_containers={n}", flush=True)


def conteneurs() -> dict:
    env = dict(os.environ, PYTHONUTF8="1", PYTHONIOENCODING="utf-8")
    sortie = subprocess.run([sys.executable, "-m", "modal", "container", "list", "--json"],
                            capture_output=True, text=True, env=env).stdout or "[]"
    compte = {}
    for c in json.loads(sortie):
        compte[c.get("App Name")] = compte.get(c.get("App Name"), 0) + 1
    return compte


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--minutes", type=float, default=60)
    ap.add_argument("--arreter", action="store_true")
    a = ap.parse_args()
    if a.arreter:
        print("retour au fonctionnement normal :", flush=True)
        regler(0)
        return
    try:
        os.remove(STOP)
    except OSError:
        pass
    fin = time.time() + a.minutes * 60
    print(f"allumage pour {a.minutes:g} min (arret auto a {time.strftime('%H:%M', time.localtime(fin))}) :",
          flush=True)
    regler(1)
    try:
        dernier = None
        while time.time() < fin and not os.path.exists(STOP):
            c = conteneurs()
            etat = f"cloud={c.get('myfabmesh-cloud', 0)}/3  rig={c.get('myfabmesh-skintokens', 0)}/1"
            if etat != dernier:
                print(time.strftime("%H:%M:%S"), "conteneurs allumes :", etat, flush=True)
                dernier = etat
            time.sleep(30)
    finally:
        print("extinction :", flush=True)
        regler(0)


if __name__ == "__main__":
    main()
