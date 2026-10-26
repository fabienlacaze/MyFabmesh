# -*- coding: utf-8 -*-
"""Rappel d'un DETECTEUR de zones sans matiere, mesure contre les zones de reference du diagnostic (20/10/2026).

Un detecteur (celui de Fill holes d'aujourd'hui, ou un futur) rend, pour chaque maillage, l'ensemble des FACES qu'il juge
« a boucher ou a corriger ». Les indices sont ceux du GLB tel que lu par glb_lecture.fusionner (primitives mises bout a bout).
Deux references, au choix (--reference) :
  visuel    (defaut) cle reference_visuel : les faces A CORRIGER pour les pixels de TROU VISUEL (rendu a faces simples : on voit
            une nappe qui n'est pas la bonne) ;
  fenetres  cle reference_fenetres : les faces qui portent les PLIS A ~180 DEGRES (levres fermees) bordant une fenetre, c'est-a-dire
            un trou TRAVERSANT sans arete de bord (on voit le fond a travers l'objet).

    rappel_faces      = |detecte ∩ reference| / |reference|
    rappel_pixels     = somme des pixels de reference portes par les faces detectees / pixels de reference (les grandes
                        zones comptent plus que les miettes)
    precision_faces   = |detecte ∩ reference| / |detecte|   (un detecteur qui rend tout le maillage a un rappel de 1)
    par cause         = meme rappel restreint aux faces dont la cause est bord / retourne / double_peau / mince / aucune

Usage :
  python rappel.py <dossier_zones> <detection.json> [--reference visuel|fenetres] [--md fichier.md]
    detection.json : {"nom_du_maillage": [indices de faces], ...}  (un maillage absent compte comme « rien detecte »)
"""
import argparse
import base64
import json
import os
import sys
import zlib

import numpy as np


def decompresser_ids(txt):
    delta = np.frombuffer(zlib.decompress(base64.b64decode(txt)), dtype='<i4')
    return np.cumsum(delta.astype(np.int64))


def charger_reference(chemin_zone, cle='reference_visuel'):
    z = json.load(open(chemin_zone, encoding='utf-8'))
    r = z[cle]
    ids = decompresser_ids(r['faces_b64']) if r['n_faces'] else np.zeros(0, np.int64)
    pix = np.asarray(r['pixels_par_face'], np.float64)
    par_cat = {}
    for nm, d in r['par_categorie'].items():
        par_cat[nm] = decompresser_ids(d['faces_b64']) if d['n_faces'] else np.zeros(0, np.int64)
    return {'ids': ids, 'pixels': pix, 'par_categorie': par_cat, 'nombre_faces': z.get('nombre_faces')}


def evaluer(reference, detecte):
    """Rend un dict de mesures pour UN maillage."""
    det = np.unique(np.asarray(detecte, np.int64)) if len(detecte) else np.zeros(0, np.int64)
    ref = reference['ids']
    dans = np.isin(ref, det)
    out = {'faces_reference': int(len(ref)), 'faces_detectees': int(len(det)), 'faces_trouvees': int(dans.sum())}
    out['rappel_faces'] = float(dans.mean()) if len(ref) else None
    tot = float(reference['pixels'].sum())
    out['rappel_pixels'] = float(reference['pixels'][dans].sum() / tot) if tot else None
    out['precision_faces'] = float(dans.sum() / len(det)) if len(det) else None
    par = {}
    for nm, ids in reference['par_categorie'].items():
        par[nm] = {'faces': int(len(ids)), 'rappel': float(np.isin(ids, det).mean()) if len(ids) else None}
    out['par_categorie'] = par
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('zones')
    ap.add_argument('detection')
    ap.add_argument('--md')
    ap.add_argument('--reference', default='visuel', choices=['visuel', 'fenetres'])
    a = ap.parse_args()
    det = json.load(open(a.detection, encoding='utf-8'))
    lignes = ['| maillage | faces ref. | detectees | rappel faces | rappel pixels | precision |', '|---|---|---|---|---|---|']
    tout = {}
    for f in sorted(os.listdir(a.zones)):
        if not f.endswith('.json'):
            continue
        nom = f[:-5]
        r = evaluer(charger_reference(os.path.join(a.zones, f), 'reference_' + a.reference), det.get(nom, []))
        tout[nom] = r
        fm = lambda x: '-' if x is None else '%.1f %%' % (100 * x)
        lignes.append('| %s | %d | %d | %s | %s | %s |' % (nom, r['faces_reference'], r['faces_detectees'], fm(r['rappel_faces']),
                                                         fm(r['rappel_pixels']), fm(r['precision_faces'])))
    txt = '\n'.join(lignes)
    print(txt)
    if a.md:
        open(a.md, 'w', encoding='utf-8').write(txt + '\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
