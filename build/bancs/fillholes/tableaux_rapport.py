# -*- coding: utf-8 -*-
"""Tableaux Markdown du rapport de diagnostic de matiere, generes a partir de <sortie>/resultats/*.json (20/10/2026).

Usage : python tableaux_rapport.py <dossier_sortie> <corpus.json> <sortie.md>
Aucun chiffre n'est tape a la main dans le rapport : tout vient de ces tableaux.
"""
import json
import os
import sys


def charger(sortie, corpus):
    lignes = []
    for ent in json.load(open(corpus, encoding='utf-8'))['maillages']:
        p = os.path.join(sortie, 'resultats', ent['nom'] + '.json')
        if os.path.exists(p):
            r = json.load(open(p, encoding='utf-8'))
            r['_famille'] = ent['famille']
            lignes.append(r)
    return lignes


def f(x, nd=2):
    if x is None:
        return '-'
    return ('%.' + str(nd) + 'f') % x


def tableau(entetes, lignes):
    out = ['| ' + ' | '.join(entetes) + ' |', '|' + '|'.join(['---'] * len(entetes)) + '|']
    for l in lignes:
        out.append('| ' + ' | '.join(str(c) for c in l) + ' |')
    return '\n'.join(out)


def main():
    sortie, corpus, md = sys.argv[1], sys.argv[2], sys.argv[3]
    R = charger(sortie, corpus)
    out = []
    # ---- A topologie
    L = []
    for r in R:
        t = r['topologie']
        o = t['orientation']
        L.append([r['nom'], r['_famille'], r['faces'], t['aretes_bord_brutes'], t.get('aretes_bord_garde1_produit', '-'),
                  t['aretes_bord_soudees'], t['boucles']['n'], t['aretes_non_manifold'], t['sommets_pince'],
                  t['composantes']['n'], f(o['aire_normale_opposee_a_un_voisin_pct']), f(o['aire_feuilles_retournees_pct']),
                  '%d / %d' % (o.get('composantes_fermees', 0), o.get('composantes_fermees_inversees', 0))])
    out.append('### A. Topologie (soudure par position : distance 1e-5 de la diagonale)\n')
    out.append(tableau(['maillage', 'famille', 'faces', 'bord brut', 'bord garde 1 du produit', 'bord soude', 'boucles',
                        'aretes non-manifold', 'sommets pinces', 'composantes', 'aire normale opposee a un voisin %',
                        'aire feuilles retournees %', 'compos. fermees / inversees'], L))
    # ---- B visibilite
    L = []
    for r in R:
        v = r['visibilite']
        c = r['carte_zones']
        tv = c['trou_visuel']
        nv = tv['pixels']
        sh = lambda k: f(100.0 * tv.get(k, 0) / nv, 1) if nv else '-'
        sg = v.get('trou_visuel_pct_par_seuil_ecart', {})
        L.append([r['nom'], f(v['arriere_pct_global'], 3), f(v['trou_visuel_pct_global'], 3), f(sg.get('0.002'), 3),
                  f(sg.get('0.01'), 3), f(sg.get('0.02'), 3), sh('bord'), sh('retourne'), sh('double_peau'), sh('mince'),
                  sh('aucune'), f(v.get('texture_noire_visible_pct_global'), 2)])
    out.append('\n### B. Visibilite (26 directions, 768 px) : pixels dont le premier impact est une face vue par DERRIERE\n')
    out.append(tableau(['maillage', 'arriere % des pixels', 'TROU VISUEL % (ecart 0,5 %)', 'ecart 0,2 %', 'ecart 1 %', 'ecart 2 %',
                        'trou visuel : bord %', 'retourne %', 'double peau %', 'paroi mince %', 'AUCUNE %',
                        'texture noire visible %'], L))
    # ---- C carte de zones complete (pixels arriere)
    L = []
    for r in R:
        c = r['carte_zones']
        d = c.get('aucune_detail', {})
        n = c['pixels_arriere_total']
        L.append([r['nom'], n, f(c['bord']['pct_des_arriere'], 1), f(c['retourne']['pct_des_arriere'], 1),
                  f(c['double_peau']['pct_des_arriere'], 1), f(c['mince']['pct_des_arriere'], 1),
                  f(c['aucune']['pct_des_arriere'], 1), d.get('sur_face_a_arete_non_manifold', '-'), c['aucune']['pixels']])
    out.append('\n### C. Carte des zones : a quoi s\'expliquent les pixels « arriere visible » (classement exclusif, par priorite)\n')
    out.append(tableau(['maillage', 'pixels arriere', 'bord %', 'retourne %', 'double peau %', 'paroi mince %', 'AUCUNE %',
                        'dont AUCUNE sur face a arete non-manifold (px)', 'AUCUNE (px)'], L))
    # ---- D structures
    L = []
    for r in R:
        s = r.get('structures', {})
        e = s.get('epaisseur_rayon', {})
        ci = s.get('coques_internes', {})
        L.append([r['nom'], f(s.get('double_peau_surface_pct'), 1), f(s.get('paroi_mince_1pct_surface_pct'), 1),
                  f(e.get('mediane_rel_diag'), 5), f(e.get('lt_0_2pct_pct'), 1), f(e.get('lt_1pct_pct'), 1),
                  f(e.get('sans_impact_pct'), 1), '%s / %s %%' % (ci.get('n'), f(ci.get('aire_pct'), 3)),
                  f(ci.get('vide_enferme_pct_boite'), 2)])
    out.append('\n### D. Structures internes\n')
    out.append(tableau(['maillage', 'surface avec une face opposee a < 0,2 % %', 'idem a < 1 %', 'epaisseur mediane (x diag)',
                        'rayons < 0,2 %', 'rayons < 1 %', 'rayons sans impact %', 'coques internes (n / aire)',
                        'vide enferme % de la boite'], L))
    # ---- G fenetres et plis
    L = []
    for r in R:
        fe = r.get('fenetres')
        pl = r['topologie'].get('plis_levres')
        if fe is None or pl is None:
            continue
        L.append([r['nom'], pl['aretes'], f(pl['pct_des_aretes_manifold'], 2), pl['composantes'], pl['composantes_ge_20_aretes'],
                  f(fe['pct_global'], 3), f(fe['pct_max_vue'], 3), fe['composantes_total'], f(fe['part_bordee_par_pli_pct'], 1)])
    out.append('
### G. Fenetres (fond cerne par du maillage = on voit a travers) et plis a 180 degres (levres)
')
    out.append(tableau(['maillage', 'aretes de pli (dot < -0,8)', '% des aretes manifold', 'composantes de plis', 'dont >= 20 aretes',
                        'fenetres % de la silhouette (26 vues)', 'max sur une vue %', 'composantes de fenetre (26 vues)',
                        'part bordee par un pli %'], L))
    # ---- E soudure
    L = []
    for r in R:
        s = r['topologie']['sensibilite_soudure']
        L.append([r['nom']] + ['%s / %s / %s' % (s[k]['aretes_bord'], s[k]['faces_degenerees'], s[k]['aretes_non_manifold'])
                               for k in ('1e-06', '1e-05', '0.0001', '0.001')])
    out.append('\n### E. Sensibilite a la tolerance de soudure : aretes de bord / faces degenerees / aretes non-manifold\n')
    out.append(tableau(['maillage', '1e-6', '1e-5', '1e-4', '1e-3'], L))
    # ---- F cout
    L = [[r['nom'], r['faces'], f(r.get('duree_s'), 1), r.get('pic_ram_mo', '-')] for r in R]
    out.append('\n### F. Cout de la mesure\n')
    out.append(tableau(['maillage', 'faces', 'duree (s)', 'pic de memoire (Mo)'], L))
    open(md, 'w', encoding='utf-8').write('\n'.join(out) + '\n')
    print(md)


if __name__ == '__main__':
    main()
