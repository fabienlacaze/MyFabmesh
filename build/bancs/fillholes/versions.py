# -*- coding: utf-8 -*-
"""Liste les maillages du corpus dont le resultat manque ou a ete produit par une AUTRE version de l'outil
(diagnostic_matiere.VERSION_OUTIL). Un nom par ligne.

Usage : python versions.py <dossier_sortie> <corpus.json> [--tout]
        --tout : liste aussi les maillages a jour (avec leur version)
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from diagnostic_matiere import VERSION_OUTIL  # noqa: E402


def main():
    sortie, corpus = sys.argv[1], sys.argv[2]
    tout = '--tout' in sys.argv
    for ent in json.load(open(corpus, encoding='utf-8'))['maillages']:
        p = os.path.join(sortie, 'resultats', ent['nom'] + '.json')
        v = None
        if os.path.exists(p):
            try:
                v = json.load(open(p, encoding='utf-8')).get('version_outil')
            except Exception:
                v = None
        if tout:
            print('%s version=%s%s' % (ent['nom'], v, '' if v == VERSION_OUTIL else '  PERIME'))
        elif v != VERSION_OUTIL:
            print(ent['nom'])


if __name__ == '__main__':
    main()
