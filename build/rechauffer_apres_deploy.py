"""A lancer JUSTE APRES chaque `python -m modal deploy modal_app/app.py` (2026-09-29).

Un deploiement invalide les instantanes de TOUTES les classes, et la doc Modal precise qu'une
fonction GPU en demande 2 a 3 PAR TYPE DE GPU (un par type de machine). Sans ce script, ce sont les
premiers utilisateurs qui paient leur creation : mesure le 29/09, 18 chargements complets pour 27
demarrages du conteneur 3D en une matinee, 150 a 230 s d'attente chacun.

Le script demarre des conteneurs (methode `rechauffer`, qui ne fait rien) par MANCHES : a chaque
manche, plusieurs conteneurs en parallele pour les classes sans plafond (machines differentes =
instantanes differents), un seul pour MyFabmeshBackview (plafonne a 1) ; puis tous les conteneurs
de l'application sont arretes pour que la manche suivante retombe sur de nouvelles machines. Un
demarrage long (> 60 s) = un instantane cree. Cout : ~0,5-1 $ de GPU, ~10 min.

REFUSE de tourner si un travail est en cours (arreter les conteneurs le couperait).

    PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python build/rechauffer_apres_deploy.py [--manches 3]
"""
import argparse
import io
import json
import os
import subprocess
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import modal

APP = "myfabmesh-cloud"
# classe : conteneurs en parallele par manche
CLASSES = {"MyFabmeshPredictor": 2, "MyFabmeshBackview": 1, "MyFabmeshMesh": 2}
RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def travaux_en_cours() -> list:
    cfg = {}
    try:
        for l in io.open(os.path.join(RACINE, 'cloud', '.env.local'), encoding='utf-8'):
            l = l.strip()
            if l and not l.startswith('#') and '=' in l:
                k, v = l.split('=', 1)
                cfg[k.strip()] = v.strip().strip('"').strip("'")
        url = cfg.get('SUPABASE_URL') or cfg.get('NEXT_PUBLIC_SUPABASE_URL')
        cle = cfg['SUPABASE_SERVICE_ROLE_KEY']
    except Exception:
        return []                                   # pas d'acces a la base : on ne bloque pas
    depuis = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() - 3 * 3600))
    q = (url + '/rest/v1/jobs?select=type,status&status=in.(processing,pending,queued,running,starting)'
         f'&created_at=gte.{depuis}')
    return json.load(urllib.request.urlopen(urllib.request.Request(
        q, headers={'apikey': cle, 'Authorization': 'Bearer ' + cle})))


def arreter_conteneurs() -> int:
    env = dict(os.environ, PYTHONUTF8='1', PYTHONIOENCODING='utf-8')
    lst = json.loads(subprocess.run([sys.executable, '-m', 'modal', 'container', 'list', '--json'],
                                    capture_output=True, text=True, env=env).stdout or '[]')
    ids = [c['Container ID'] for c in lst if c.get('App Name') == APP]
    for cid in ids:
        subprocess.run([sys.executable, '-m', 'modal', 'container', 'stop', '-y', cid],
                       capture_output=True, env=env)
    return len(ids)


def rechauffer(nom: str) -> tuple:
    t0 = time.time()
    try:
        modal.Cls.from_name(APP, nom)().rechauffer.remote()
        return nom, time.time() - t0, None
    except Exception as e:
        return nom, time.time() - t0, f"{type(e).__name__}: {e}"


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument('--manches', type=int, default=3)
    a = ap.parse_args()
    en_cours = travaux_en_cours()
    if en_cours:
        sys.exit(f"ARRET : {len(en_cours)} travail(aux) en cours {en_cours} — relancer quand ils sont finis")
    for m in range(1, a.manches + 1):
        appels = [nom for nom, n in CLASSES.items() for _ in range(n)]
        with ThreadPoolExecutor(len(appels)) as fils:
            res = list(fils.map(rechauffer, appels))
        for nom, dt, err in res:
            etat = f"ECHEC {err}" if err else ("instantane CREE" if dt > 60 else "restaure")
            print(f"manche {m}  {nom:20s} {dt:5.0f} s  {etat}", flush=True)
        if m < a.manches:
            # CONTROLE AVANT CHAQUE ARRET (2026-09-29) : le script ne verifiait qu'au depart. Un user
            # a lance un ane PENDANT la 1re manche ; l'arret de fin de manche a tue le conteneur qui le
            # calculait (reprise sur un conteneur neuf, ~3 min perdues). Travail en cours = on s'arrete
            # la, sans rien couper.
            en_cours = travaux_en_cours()
            if en_cours:
                print(f"manche {m} : {len(en_cours)} travail(aux) en cours, manches suivantes annulees "
                      "(aucun conteneur arrete)", flush=True)
                break
            print(f"manche {m} : {arreter_conteneurs()} conteneur(s) arrete(s)", flush=True)
            time.sleep(15)
