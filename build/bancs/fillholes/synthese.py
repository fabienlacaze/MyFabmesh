# -*- coding: utf-8 -*-
"""Tableau de synthese des resultats du diagnostic de matiere (lit <sortie>/resultats/*.json).

Usage : python synthese.py <dossier_sortie> [--md fichier.md] [--famille xxx]
"""
import argparse
import glob
import json
import os

COLS = [
    ('nom', 'maillage', '%s'),
    ('faces', 'faces', '%d'),
    ('bord_brut', 'bord brut', '%d'),
    ('bord_produit', 'bord garde 1', '%d'),
    ('bord_soude', 'bord soude', '%d'),
    ('boucles', 'boucles', '%d'),
    ('nonmanifold', 'non-manif.', '%d'),
    ('pince', 'pinces', '%d'),
    ('composantes', 'compos.', '%d'),
    ('opp', 'normale opp. %', '%.2f'),
    ('retourne', 'feuilles ret. %', '%.2f'),
    ('arriere', 'arriere %', '%.3f'),
    ('visuel', 'trou visuel %', '%.3f'),
    ('c_bord', 'bord', '%.1f'),
    ('c_ret', 'retourne', '%.1f'),
    ('c_dbl', 'double', '%.1f'),
    ('c_mnc', 'mince', '%.1f'),
    ('c_auc', 'AUCUNE', '%.1f'),
    ('v_bord', 'trou visuel : bord %', '%.1f'),
    ('v_ret', 'retourne %', '%.1f'),
    ('v_dbl', 'double %', '%.1f'),
    ('v_mnc', 'mince %', '%.1f'),
    ('v_auc', 'AUCUNE %', '%.1f'),
    ('noir', 'texture noire visible %', '%.2f'),
    ('fen', 'fenetres %', '%.3f'),
    ('fen_pli', 'fenetres bordees par un pli %', '%.1f'),
]


def ligne(r):
    t = r['topologie']
    c = r['carte_zones']
    v = r['visibilite']
    tv = c.get('trou_visuel', {})
    nv = tv.get('pixels', 0)
    return {
        'nom': r['nom'], 'faces': r['faces'], 'bord_brut': t['aretes_bord_brutes'],
        'bord_produit': t.get('aretes_bord_garde1_produit', -1),
        'bord_soude': t['aretes_bord_soudees'], 'boucles': t['boucles']['n'], 'nonmanifold': t['aretes_non_manifold'],
        'pince': t['sommets_pince'], 'composantes': t['composantes']['n'],
        'opp': t['orientation']['aire_normale_opposee_a_un_voisin_pct'],
        'retourne': t['orientation']['aire_feuilles_retournees_pct'],
        'arriere': v['arriere_pct_global'], 'visuel': v.get('trou_visuel_pct_global', 0.0),
        'c_bord': c['bord']['pct_des_arriere'], 'c_ret': c['retourne']['pct_des_arriere'],
        'c_dbl': c['double_peau']['pct_des_arriere'], 'c_mnc': c['mince']['pct_des_arriere'],
        'c_auc': c['aucune']['pct_des_arriere'],
        'v_bord': (100.0 * tv.get('bord', 0) / nv) if nv else 0.0,
        'v_ret': (100.0 * tv.get('retourne', 0) / nv) if nv else 0.0,
        'v_dbl': (100.0 * tv.get('double_peau', 0) / nv) if nv else 0.0,
        'v_mnc': (100.0 * tv.get('mince', 0) / nv) if nv else 0.0,
        'v_auc': (100.0 * tv.get('aucune', 0) / nv) if nv else 0.0,
        'noir': v.get('texture_noire_visible_pct_global', 0.0),
        'fen': r.get('fenetres', {}).get('pct_global', 0.0),
        'fen_pli': r.get('fenetres', {}).get('part_bordee_par_pli_pct', 0.0),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('sortie')
    ap.add_argument('--md')
    ap.add_argument('--famille')
    a = ap.parse_args()
    lignes = []
    for p in sorted(glob.glob(os.path.join(a.sortie, 'resultats', '*.json'))):
        r = json.load(open(p, encoding='utf-8'))
        if a.famille and r.get('corpus', {}).get('famille') != a.famille:
            continue
        l = ligne(r)
        l['famille'] = r.get('corpus', {}).get('famille', '')
        lignes.append(l)
    ent = [c[1] for c in COLS]
    out = ['| ' + ' | '.join(ent) + ' |', '|' + '|'.join(['---'] * len(ent)) + '|']
    for l in lignes:
        out.append('| ' + ' | '.join((c[2] % l[c[0]]) if not isinstance(l[c[0]], str) or c[2] != '%d' else l[c[0]] for c in COLS) + ' |')
    txt = '\n'.join(out)
    print(txt)
    if a.md:
        open(a.md, 'w', encoding='utf-8').write(txt + '\n')


if __name__ == '__main__':
    main()
