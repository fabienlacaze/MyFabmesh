# -*- coding: utf-8 -*-
"""AVANT / APRES de Fill holes sur les MEMES trous perces dans la moissonneuse (2026-10-26).

AVANT = ce qui est livre (branche de reference, defaut integration-2510 = version 1.0.67) :
    - bureau : scripts/mesh_tools.py::fill_holes de cette branche, lance en ligne de commande (ce que fait l'appli) ;
    - Modal  : modal_app/_mesh_op.py::fill_holes de cette branche, appelee en processus (ce que fait le site), si --modal.
APRES = le depot courant (bouchon lisse), appele par le meme chemin que le bureau.

Pour chaque cas perce : aretes de bord restantes (apres soudure par position), faces d'entree conservees (prefixe identique), faces supprimees, duree,
distance du bouchon a la surface perdue.

Lancer :  python build/bancs/noyaux/avant_apres_remplissage.py --sortie C:/tmp/fill_demo/avant_apres.json [--ref integration-2510] [--modal]
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
import time

import numpy as np

ICI = os.path.dirname(os.path.abspath(__file__))
RACINE = os.path.abspath(os.path.join(ICI, '..', '..', '..'))
for chemin in (os.path.join(RACINE, 'scripts'), ICI, RACINE):
    if chemin not in sys.path:
        sys.path.insert(0, chemin)

import trimesh  # noqa: E402

import _percage_trous as P  # noqa: E402


def extraire(ref, dossier):
    """Copie `scripts/` et `modal_app/` tels qu'ils sont dans la branche `ref` (git archive), sans toucher a l'arbre de travail."""
    p = subprocess.run(['git', 'archive', ref, 'scripts', 'modal_app'], cwd=RACINE, capture_output=True)
    if p.returncode:
        raise RuntimeError(p.stderr.decode('utf-8', 'replace'))
    subprocess.run(['tar', '-x', '-C', dossier], input=p.stdout, check=True)


def mesurer(g, ng, nF_in, nV_in, retirees, h, V0, F0, arete, cle):
    Vn, Fn = np.asarray(ng.vertices), np.asarray(ng.faces)
    bord, nm = P.aretes_de_bord_soudees(Vn, Fn)
    Fh = np.asarray(h.faces)
    prefixe = len(Fn) >= nF_in and np.array_equal(Fn[:nF_in], Fh)
    # faces d'entree retrouvees (multiensemble de triplets de POSITIONS arrondies) : detecte aussi les reordonnees / fusionnees
    sortie = {'aretes_de_bord_apres': bord, 'faces_apres': int(len(Fn)), 'faces_entree_prefixe_identique': bool(prefixe),
              'faces_ajoutees': int(len(Fn) - nF_in), 'non_manifold': nm}
    if prefixe and len(Fn) > nF_in:
        d = P.distance_au_manquant(Vn, Fn[nF_in:], V0, F0[retirees])
        if d:
            sortie['b2v_moy'] = round(d['b2v_moy'] / arete, 3)
            sortie['v2b_moy'] = round(d['v2b_moy'] / arete, 3)
            sortie['normales_inversees_pct'] = round(d['normales_inversees_pct'], 1)
    return sortie


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--ref', default='integration-2510')
    ap.add_argument('--sortie', required=True)
    ap.add_argument('--modal', action='store_true')
    ap.add_argument('--cas', default='')
    a = ap.parse_args()
    g = P.charger()
    V0, F0 = np.asarray(g.vertices, dtype=np.float64), np.asarray(g.faces, dtype=np.int64)
    cas, prep0 = P.fabriquer_cas(g)
    tr = P.trou_traversant(g)
    if tr:
        cas.append(tr)
    if a.cas:
        cas = [c for c in cas if c['nom'] in a.cas.split(',')]
    arete = prep0['arete_moyenne']
    res = []
    with tempfile.TemporaryDirectory() as tmp:
        ancien = os.path.join(tmp, 'ancien')
        os.makedirs(ancien)
        extraire(a.ref, ancien)
        env = {**os.environ, 'PYTHONUTF8': '1', 'PYTHONIOENCODING': 'utf-8'}
        for c in cas:
            h, _ = P.percer(g, c['retirees'])
            e = os.path.join(tmp, c['nom'] + '.glb')
            h.export(e)
            nF, nV = len(h.faces), len(h.vertices)
            ligne = {'cas': c['nom'], 'faces_retirees': int(len(c['retirees'])), 'aretes_de_bord_avant': P.aretes_de_bord_soudees(h.vertices, h.faces)[0]}
            for nom, racine in (('avant_bureau', ancien), ('apres_bureau', RACINE)):
                s = os.path.join(tmp, '%s_%s.glb' % (c['nom'], nom))
                t = time.time()
                r = subprocess.run([sys.executable, os.path.join(racine, 'scripts', 'mesh_tools.py'), 'fill_holes', e, s, '3', '2000'],
                                   capture_output=True, text=True, env=env)
                duree = time.time() - t
                if r.returncode or not os.path.exists(s):
                    ligne[nom] = {'echec': (r.stdout + r.stderr)[-300:], 'code': r.returncode, 'duree_s': round(duree, 1)}
                    continue
                sc = trimesh.load(s, process=False)
                ng = list(sc.geometry.values())[0]
                m = mesurer(g, ng, nF, nV, c['retirees'], h, V0, F0, arete, nom)
                m['duree_s'] = round(duree, 1)
                ligne[nom] = m
            if a.modal:
                # le fichier d'entree doit etre un GLB en octets ; l'ancien module est importe depuis la copie extraite
                t = time.time()
                code = ("import sys; sys.path.insert(0, %r); sys.path.insert(0, %r); from modal_app import _mesh_op as M; "
                        "b = open(%r, 'rb').read(); out, st = M.fill_holes(b, 3, 2000); open(%r, 'wb').write(out); print('STATS', st)"
                        % (ancien, os.path.join(ancien, 'scripts'), e, os.path.join(tmp, c['nom'] + '_modal.glb')))
                try:
                    r = subprocess.run([sys.executable, '-c', code], capture_output=True, text=True, env=env, timeout=400)
                    s = os.path.join(tmp, c['nom'] + '_modal.glb')
                    if r.returncode or not os.path.exists(s):
                        ligne['avant_modal'] = {'echec': (r.stdout + r.stderr)[-400:], 'duree_s': round(time.time() - t, 1)}
                    else:
                        ng = list(trimesh.load(s, process=False).geometry.values())[0]
                        m = mesurer(g, ng, nF, nV, c['retirees'], h, V0, F0, arete, 'modal')
                        m['duree_s'] = round(time.time() - t, 1)
                        ligne['avant_modal'] = m
                except subprocess.TimeoutExpired:
                    ligne['avant_modal'] = {'echec': 'delai de 400 s depasse', 'duree_s': 400}
            res.append(ligne)
            print(json.dumps(ligne, ensure_ascii=False), flush=True)
    with open(a.sortie, 'w', encoding='utf-8') as f:
        json.dump(res, f, indent=1, ensure_ascii=False)
    print('ecrit', a.sortie)


if __name__ == '__main__':
    main()
