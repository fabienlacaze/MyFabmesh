"""Avertissements avant depense (24/10, audit des prompts m5 / M12) : detecter_avertissements du composeur, sans GPU.

Pur et SANS effet sur le prompt : le client montre la liste avant toute requete payante. Le jumeau JavaScript (detecterAvertissements) est compare par
build/check-intention.mjs sur tous les cas gravés ; ici : les cas limites, l'etat de la case T-pose et l'octet pres du prompt.

Lancer :  python build/bancs/noyaux/test_avertissements.py -v
"""
import json
import os
import sys
import unittest

RACINE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
sys.path.insert(0, RACINE)
sys.path.insert(0, os.path.join(RACINE, 'scripts'))
import composeur_intention as C  # noqa: E402

CORPUS = 'C:/Users/Utilisateur/Documents/MyFabmesh_corrections_prompts_2026-10-24/corpus.json'


class Avertissements(unittest.TestCase):
    def test_pose_seulement_avec_la_case_cochee(self):
        t = 'a knight sitting with his arms crossed'
        self.assertEqual(C.detecter_avertissements(t, t, 'character', True), ['pose-incompatible-avec-tpose'])
        self.assertEqual(C.detecter_avertissements(t, t, 'character', False), [])

    def test_quantite_vue_buste(self):
        self.assertEqual(C.detecter_avertissements('two men fighting', 'two men fighting'), ['quantite-deux-personnages-gabarit-un-seul'])
        self.assertEqual(C.detecter_avertissements('a crowd of soldiers', 'a crowd of soldiers'), ['quantite-deux-personnages-gabarit-un-seul'])
        self.assertEqual(C.detecter_avertissements('a man in profile view', 'a man in profile view'), ['vue-demandee-gabarit-de-face'])
        self.assertEqual(C.detecter_avertissements('a bust of a king', 'a bust of a king'), ['buste-gabarit-corps-entier'])

    def test_rien_pour_les_demandes_ordinaires(self):
        for t in ('a knight', 'an orc holding a massive spiked club', 'a samurai holding two swords', 'a two-headed ogre', 'a knight, not sitting'):
            self.assertEqual(C.detecter_avertissements(t, t), [], t)

    def test_autres_types_d_asset(self):
        self.assertEqual(C.detecter_avertissements('two men fighting', 'two men fighting', 'vehicle'), [])
        self.assertEqual(C.detecter_avertissements('a sitting cat', 'a sitting cat', 'other_living'), [])

    def test_longueur_sur_le_texte_saisi_ou_traduit(self):
        n = C.SEUIL_MOTS_LONG
        self.assertEqual(C.detecter_avertissements(' '.join(['mot'] * n), 'a cat', 'prop'), ['texte-long'])
        self.assertEqual(C.detecter_avertissements('chat', ' '.join(['word'] * n), 'prop'), ['texte-long'])
        self.assertEqual(C.detecter_avertissements(' '.join(['mot'] * (n - 1)), 'a cat', 'prop'), [])
        self.assertEqual(C.detecter_avertissements('一个疲惫的老骑士' * 15, 'a tired old knight', 'prop'), ['texte-long'])
        self.assertEqual(C.detecter_avertissements('x' * 2001, 'x', 'prop'), ['texte-trop-long'])
        self.assertEqual(C.detecter_avertissements('x' * 2000, 'x', 'prop'), [])

    def test_le_prompt_envoye_ne_change_pas(self):
        # aucune regle eteinte n'est allumee : le gabarit d'un texte « a conflit » reste a l'octet
        import modal_app._prompts as P  # noqa: F401
        gab = P.ASSET_TYPE_PROMPTS['character']
        for t in ('two men fighting', 'a knight sitting with arms crossed', 'a bust of a king'):
            it = C.analyser(t, 'character', 'realistic')
            self.assertEqual(C.composer_gabarit(gab, 'character', it), (gab, []), t)

    @unittest.skipUnless(os.path.exists(CORPUS), 'corpus du proprietaire absent')
    def test_corpus_de_longueur(self):
        with open(CORPUS, encoding='utf-8') as f:
            corpus = json.load(f)
        vus = 0
        for e in corpus['entrees']:
            att = e.get('attendu', {}).get('avertissement')
            if e['famille'] != 'longueur' or e['id'] == 'long_demesure_2500':
                continue
            codes = C.detecter_avertissements(e['texte'], e['reference_en'], e['type'])
            if att is None:
                self.assertNotIn('texte-long', codes, e['id'])
            else:
                self.assertIn('texte-long', codes, e['id'])
            vus += 1
        self.assertGreaterEqual(vus, 5)
        long_ = [e for e in corpus['entrees'] if e['id'] == 'long_demesure_2500'][0]
        self.assertEqual(C.detecter_avertissements(long_['texte'], long_['reference_en'], long_['type']), ['texte-trop-long'])


if __name__ == '__main__':
    unittest.main()
