"""Applique les regles du noyau partage (scripts/fusion_masques.py) aux 36 images MESUREES sur Modal le 03/10/2026 (aucun modele, aucune carte, aucune image) :
ce que l'UNION de Lucida et de u2net aurait donne, et ce que la regle de refus d'un masque Lucida aberrant (aires) aurait ecarte.

    <python de l'appli> build/bancs/fidelite/union_sur_mesure_modal.py [metriques.json]

Entree : C:/tmp/fidelite/lucida_vs_u2net/metriques.json, ecrit par modal_app/test_lucida_vs_u2net.py (aire de chaque masque, part de l'un absente de l'autre).
Reconstruction : union = aire_u2net + u2net_manque * aire_lucida (la part de Lucida absente de u2net s'ajoute a u2net). La regle des composantes
(confettis) exige les masques eux-memes : elle n'est pas evaluable ici (le banc GPU modal_app/test_lucida_union.py la couvre). Les seuils viennent du noyau.
Code de sortie 1 si le fichier de mesure est absent.
"""
import json
import os
import sys

RACINE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
sys.path.insert(0, os.path.join(RACINE, 'scripts'))
import fusion_masques as FM  # noqa: E402

CHEMIN = 'C:/tmp/fidelite/lucida_vs_u2net/metriques.json'


def analyser(donnees):
    """Une ligne par image (dict) : aires, union reconstruite, rapports, refus par les aires, drapeaux « defaillant » du noyau (memes inegalites strictes)."""
    lignes = []
    for e in donnees['images']:
        u, l = e['aire_u2net'], e['aire_lucida']
        union = u + e['u2net_manque'] * l
        if l < FM.PART_MIN_LUCIDA:
            refus = 'sujet trop petit'
        elif l > FM.PART_MAX_LUCIDA:
            refus = 'sujet = presque toute l\'image'
        else:
            refus = None
        lignes.append({'nom': e['nom'], 'aire_u2net': u, 'aire_lucida': l, 'aire_union': union,
                       'union_sur_u2net': union / u if u else 0.0, 'union_sur_lucida': union / l if l else 0.0,
                       'u2net_manque': e['u2net_manque'], 'lucida_manque': e['lucida_manque'], 'refus_aire': refus,
                       'lucida_defaillant': 2 * l < u, 'u2net_defaillant': 5 * u < 4 * l})
    return lignes


def mediane(valeurs):
    v = sorted(valeurs)
    return v[len(v) // 2] if v else None


def main(argv):
    chemin = argv[1] if len(argv) > 1 else CHEMIN
    if not os.path.isfile(chemin):
        print('mesure introuvable : %s (la produit modal_app/test_lucida_vs_u2net.py)' % chemin, file=sys.stderr)
        return 1
    with open(chemin, encoding='utf-8') as f:
        donnees = json.load(f)
    lignes = analyser(donnees)
    print('%-32s %6s %6s %6s %6s %6s %7s %7s  %s' % ('image', 'aireU', 'aireL', 'union', 'U/L', 'Un/U', 'u2miss', 'lumiss', 'drapeaux'))
    for x in lignes:
        drapeaux = ' '.join(d for d, v in (('REFUS:' + str(x['refus_aire']), x['refus_aire']), ('lucida_defaillant', x['lucida_defaillant']),
                                           ('u2net_defaillant', x['u2net_defaillant'])) if v)
        print('%-32s %6.3f %6.3f %6.3f %6.2f %6.2f %6.1f%% %6.1f%%  %s' % (
            x['nom'][:32], x['aire_u2net'], x['aire_lucida'], x['aire_union'], x['aire_u2net'] / x['aire_lucida'] if x['aire_lucida'] else 0,
            x['union_sur_u2net'], 100 * x['u2net_manque'], 100 * x['lucida_manque'], drapeaux))
    tpose = [x for x in lignes if x['nom'].startswith(('orc_', 'ab_A_', 'ab_B_'))]
    produits = [x for x in lignes if x['nom'].startswith('paire_')]
    print()
    print('images : %d ; aires de Lucida de %.3f a %.3f ; refusees par les regles d\'aire : %d'
          % (len(lignes), min(x['aire_lucida'] for x in lignes), max(x['aire_lucida'] for x in lignes), sum(1 for x in lignes if x['refus_aire'])))
    print('Lucida defaillant (< 0,5 x u2net) : %s' % [x['nom'] for x in lignes if x['lucida_defaillant']])
    print('u2net defaillant (< 0,8 x Lucida) : %d image(s)' % sum(1 for x in lignes if x['u2net_defaillant']))
    if tpose:
        print('T-pose fond gris (%d) : union / u2net median %.2f ; union / Lucida median %.2f'
              % (len(tpose), mediane([x['union_sur_u2net'] for x in tpose]), mediane([x['union_sur_lucida'] for x in tpose])))
    if produits:
        print('produits fond blanc (%d) : union / u2net max %.2f, median %.2f'
              % (len(produits), max(x['union_sur_u2net'] for x in produits), mediane([x['union_sur_u2net'] for x in produits])))
    for x in lignes:
        if x['nom'].startswith(('paire_04_', 'paire_27_')):
            print('%s : union / Lucida %.2f, union / u2net %.2f' % (x['nom'], x['union_sur_lucida'], x['union_sur_u2net']))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
