"""Banc de fidelite de FORME -- quelle face d'un GLB TRELLIS.2 regarde la camera de reference ? (03/10/2026)

Pour chaque paire de la campagne, compare les lacets 0 et 180 (haut = +y) de deux facons INDEPENDANTES :
  - IoU de silhouette (ambigu : la silhouette orthographique de +z est le miroir de celle de -z) ;
  - correlation de COULEUR entre le rendu colore du GLB et l'image de reference (non ambigue : un visage ne ressemble pas a une nuque).
Sortie : C:/tmp/fidelite/orientation.json et un resume. Utilise les memes paires que campagne_existante.py (cache non utilise : calcul a 256 px, rapide).
Usage : python analyse_orientation.py [--limite N]
"""
import argparse
import json
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rendre_silhouette as RS      # noqa: E402
import masque_reference as MR       # noqa: E402
import campagne_existante as CE     # noqa: E402


def analyser(p):
    r = {'id': p['id'], 'origine': p['origine']}
    try:
        mr = MR.masque_reference(p['image'], 'auto')
        V, F, C = RS.charger_glb(p['glb'], couleurs=True)
        ref = RS.normaliser_masque(mr['masque'], 256)
        for yaw in (0, 180):
            m, _ = RS.rendre_masque(V, F, 384, '+y', yaw)
            r['iou_%d' % yaw] = RS._iou_norm(m, ref)
            r['couleur_%d' % yaw] = RS._score_couleur(V, F, C, mr['masque'], mr['rgb'], '+y', yaw, None)
        r['face_par_couleur'] = 0 if r['couleur_0'] > r['couleur_180'] else 180
        r['face_par_iou'] = 0 if r['iou_0'] > r['iou_180'] else 180
        r['ecart_couleur'] = abs(r['couleur_0'] - r['couleur_180'])
    except Exception as e:   # noqa: BLE001
        r['erreur'] = '%s: %s' % (type(e).__name__, e)
    return r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--limite', type=int, default=0)
    a = ap.parse_args()
    paires = [p for p in CE.lister_paires_r2() + CE.lister_paires_locales() if not p.get('ignore')]
    if a.limite:
        paires = paires[:a.limite]
    res = []
    for i, p in enumerate(paires, 1):
        t = time.time()
        r = analyser(p)
        res.append(r)
        print('[%2d/%d] %-42s %s (%.0f s)' % (i, len(paires), p['id'][:42], ('couleur 0/180 : %.2f / %.2f -> %s | IoU %.2f / %.2f' % (r['couleur_0'], r['couleur_180'], r['face_par_couleur'], r['iou_0'], r['iou_180'])) if 'erreur' not in r else r['erreur'], time.time() - t), flush=True)
    ok = [r for r in res if 'erreur' not in r]
    n0 = sum(1 for r in ok if r['face_par_couleur'] == 0)
    n180 = len(ok) - n0
    print('\nface avant par la couleur : lacet 0 = %d paires, lacet 180 = %d paires' % (n0, n180))
    json.dump(res, open('C:/tmp/fidelite/orientation.json', 'w', encoding='utf-8'), indent=1)
    return 0


if __name__ == '__main__':
    sys.exit(main())
