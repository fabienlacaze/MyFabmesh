# -*- coding: utf-8 -*-
"""Que dit le NOUVEAU noyau (scripts/bouchage_trous.py) des VRAIS maillages du corpus ? (21/10/2026)

Pour chaque maillage du corpus qui existe sur cette machine, par primitive (comme la production : un maillage trimesh par primitive) : nombre de
faces, aretes de bord (copie soudee), pourtours par categorie, aretes a plus de deux faces, faces d'orientation minoritaire, miettes flottantes, CAUSE
du diagnostic, duree. Lecture par glb_lecture.py (numpy seul, textures non decodees). Ecrit resultats/noyau_corpus.json et un tableau Markdown.

Usage (sous lourd.sh : plusieurs maillages de 500 000 faces) :
  bash /c/tmp/lourd.sh --max-sec 600 <python de l'appli> -X utf8 -I build/bancs/fillholes/diagnostic_noyau.py --json build/bancs/fillholes/resultats/noyau_corpus.json
"""
import argparse
import json
import os
import sys
import time

ICI = os.path.dirname(os.path.abspath(__file__))
RACINE = os.path.abspath(os.path.join(ICI, '..', '..', '..'))
sys.path.insert(0, ICI)
sys.path.insert(0, os.path.join(RACINE, 'scripts'))

import numpy as np  # noqa: E402

import bouchage_trous as B  # noqa: E402
from glb_lecture import Glb  # noqa: E402


def analyser_maillage(nom, chemin):
    lignes = []
    glb = Glb(chemin)
    for p in glb.primitives():
        V = np.asarray(p.V, dtype=np.float32).astype(np.float64)      # ce que lit le serveur : les flottants 32 bits du GLB
        F = np.asarray(p.F, dtype=np.int64)
        if len(F) == 0:
            continue
        t = time.time()
        prep = B.preparer(V, F)
        a = B.analyser(V, F, 3, 2000, prep=prep)
        d = B.diagnostiquer(prep, a)
        dt = time.time() - t
        code, texte = B.message_refus(a, d, 3, 2000) if a['faces_ajoutees'] == 0 else ('', '')
        lignes.append({
            'maillage': nom, 'primitive': p.nom, 'faces': int(len(F)), 'sommets': int(len(V)), 'aretes_de_bord': a['aretes_de_bord'],
            'boucles_a_boucher': a['a_boucher'], 'trop_petites': a['trop_petites'], 'trop_grandes': a['trop_grandes'],
            'degenerees': a['degenerees'], 'non_triangulables': a['non_triangulables'], 'chaines_ouvertes': a['chaines_ouvertes'],
            'faces_a_ajouter': a['faces_ajoutees'], 'aretes_non_manifold': d['aretes_non_manifold'], 'aretes_incoherentes': d['aretes_incoherentes'],
            'faces_retournees': d['faces_retournees'], 'composantes': d['composantes'], 'miettes': d['miettes'], 'faces_miettes': d['faces_miettes'],
            'cause': d['cause'], 'refus': code, 'duree_s': round(dt, 2)})
    return lignes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--corpus', default=os.path.join(ICI, 'corpus.json'))
    ap.add_argument('--json')
    ap.add_argument('--familles', default='generation,petite_cible,projet_appli,pixal3d,banc')
    a = ap.parse_args()
    familles = set(a.familles.split(','))
    corpus = json.load(open(a.corpus, encoding='utf-8'))['maillages']
    sortie = []
    for m in corpus:
        if m['famille'] not in familles or not os.path.exists(m['chemin']):
            continue
        try:
            sortie += analyser_maillage(m['nom'], m['chemin'])
        except Exception as e:      # un GLB illisible ne doit pas arreter le banc
            sortie.append({'maillage': m['nom'], 'erreur': '%s: %s' % (type(e).__name__, e)})
        print(json.dumps(sortie[-1], ensure_ascii=False), flush=True)
    if a.json:
        os.makedirs(os.path.dirname(os.path.abspath(a.json)), exist_ok=True)
        with open(a.json, 'w', encoding='utf-8', newline='\n') as f:
            json.dump(sortie, f, ensure_ascii=False, indent=1)
    print('\n| maillage | faces | bord | boucles a boucher | degenerees | non-manifold | retournees | miettes | cause | s |')
    print('|---|---:|---:|---:|---:|---:|---:|---:|---|---:|')
    for r in sortie:
        if 'erreur' in r:
            print('| %s | erreur : %s |' % (r['maillage'], r['erreur']))
            continue
        print('| %s | %d | %d | %d | %d | %d | %d | %d | %s | %.1f |' % (
            r['maillage'], r['faces'], r['aretes_de_bord'], r['boucles_a_boucher'], r['degenerees'], r['aretes_non_manifold'],
            r['faces_retournees'], r['miettes'], r['cause'], r['duree_s']))
    return 0


if __name__ == '__main__':
    sys.exit(main())
