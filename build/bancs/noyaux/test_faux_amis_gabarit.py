"""Faux amis du choix de gabarit (2026-10-13, lot 2 de l'audit de la langue : SERVEUR-06, MANQUE-SERV-04).

modal_app/_prompts.py mode_depuis_texte choisit le gabarit SANS PATTES (serpent : corps etire, « (legs:1.7) » au negatif, image-vers-image
depuis une silhouette de serpent) ou POISSON d'apres des listes de mots. Mesure de l'audit : « un chat noir qui court VERS la maison »,
« un gato negro que quiere VER el mar », « a parrot on a wooden PERCH », « a cat with a BASS guitar », « a rabbit with a feather BOA »
recevaient le mauvais gabarit. Prouve :
  - les faux amis et mots a double sens ne declenchent plus le gabarit dans ces phrases ;
  - les vrais poissons / serpents / vers le declenchent toujours (temoins) ;
  - les listes Python sont EXACTEMENT celles du moteur de marche JS (src/renderer/lib/locomotion-procedurale.js), qui applique la meme
    regle (une seule definition par langage, comparees ici).

Lancer :  python build/bancs/noyaux/test_faux_amis_gabarit.py -v
"""
import io
import os
import re
import sys
import unittest

RACINE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
sys.path.insert(0, RACINE)

from modal_app import _prompts as P  # noqa: E402

JS = os.environ.get('LOCOMOTION_JS') or os.path.join(RACINE, 'src', 'renderer', 'lib', 'locomotion-procedurale.js')


def _mots_js(nom):
    """Mots d'un `const NOM = new Set((' ... ' + ' ... ').split(' '))` du fichier JS."""
    with io.open(JS, encoding='utf-8') as f:
        src = f.read()
    i = src.index('const ' + nom + ' = new Set(')
    j = src.index(".split(' ')", i)
    morceaux = re.findall(r"'([^']*)'", src[i:j])
    return set(' '.join(morceaux).split())


def _especes_js():
    with io.open(JS, encoding='utf-8') as f:
        src = f.read()
    i = src.index('const MOTS_ESPECES = {')
    j = src.index('};', i)
    return set(' '.join(re.findall(r"'([^']*)'", src[i:j])).split())


class FauxAmis(unittest.TestCase):
    def test_faux_amis_ne_declenchent_plus(self):
        for t in ['un chat noir qui court vers la maison', 'une créature qui regarde vers le ciel', 'un loup qui marche vers les arbres',
                  'un gato negro que quiere ver el mar', 'um gato preto que quer ver o mar',
                  'a green parrot sitting on a wooden perch', 'a tabby cat with a bass guitar',
                  "a medieval knight's horse carrying a pike", 'a fluffy white rabbit with a pink feather boa',
                  'a cow wearing a python skin pattern', 'a fox in a ray of light', 'hai un gatto nero']:
            self.assertIsNone(P.mode_depuis_texte(t), t)

    def test_vrais_poissons_et_serpents(self):
        attendus = {'a pike': 'nage', 'a big bass fish': 'nage', 'a koi carp': 'nage', 'a great white shark': 'nage',
                    'a giant python': 'reptation', 'a red boa': 'reptation', 'un ver de terre': 'reptation',
                    'des vers de terre': 'reptation', 'a cobra': 'reptation', 'a python snake': 'reptation',
                    'un poisson rouge': 'nage', 'une baleine': 'nage', 'a pink earthworm': 'reptation', 'ein Fisch': 'nage'}
        for t, m in attendus.items():
            self.assertEqual(P.mode_depuis_texte(t), m, t)

    def test_gabarit_complet_du_chat(self):
        p = P.build_enriched_prompt('un chat noir qui court vers la maison', 'animal', 'realistic')
        self.assertNotIn('body stretched out straight', p)
        p2 = P.build_enriched_prompt('a red python', 'animal', 'realistic')
        self.assertIn('body stretched out straight', p2)

    def test_listes_identiques_au_moteur_de_marche_js(self):
        self.assertEqual(P._MOTS_NAGE, _mots_js('MOTS_NAGE'))
        self.assertEqual(P._MOTS_REPTATION, _mots_js('MOTS_REPTATION'))
        self.assertEqual(P._MOTS_AMBIGUS, _mots_js('MOTS_AMBIGUS'))
        self.assertEqual(P._DETERMINANTS, _mots_js('DETERMINANTS'))
        self.assertEqual(P._MOTS_AUTRES_ESPECES, _especes_js() | _mots_js('AUTRES_ANIMAUX'))
        self.assertNotIn('hai', P._MOTS_NAGE)
        self.assertNotIn('wal', P._MOTS_NAGE)


if __name__ == '__main__':
    unittest.main()
