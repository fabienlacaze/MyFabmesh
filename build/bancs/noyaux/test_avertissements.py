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

    def test_neuvieme_negation_annoncee(self):
        """B2 de la relecture du 24/10 : la 9e negation quitte le positif et l'utilisateur en est prevenu AVANT la depense."""
        t = 'a knight, no helmet, no shield, no cape, no sword, no bow, no axe, no spear, no mace, no dagger'
        self.assertEqual(C.detecter_avertissements(t, t, 'prop'), ['negations-en-trop'])
        self.assertEqual(C.negations_perdues(t), ['dagger'])
        self.assertNotIn('dagger', C.negations_et_positif(t)['positif'])
        self.assertEqual(C.detecter_avertissements(t.replace(', no dagger', ''), t.replace(', no dagger', ''), 'prop'), [])

    def test_vingt_et_unieme_negation_annoncee_sur_une_route_longue(self):
        """Plafond 20 (24/10) : la generation d'image passe NEG_MAX_LONG ; 9 a 20 negations ne sont plus annoncees, la 21e l'est."""
        mots = ['helmet', 'cape', 'sword', 'shield', 'crown', 'boots', 'belt', 'ring', 'staff', 'horns', 'wings', 'tail', 'beard', 'scarf', 'gloves', 'amulet', 'spear',
                'quiver', 'hood', 'mask', 'banner']
        t = 'a knight, ' + ', '.join('no ' + m for m in mots[:20])
        self.assertEqual(C.detecter_avertissements(t, t, 'prop', True, C.NEG_MAX_LONG), [])
        self.assertEqual(C.detecter_avertissements(t, t, 'prop'), ['negations-en-trop'], 'sans plafond passe : le plus prudent (8)')
        t21 = t + ', no ' + mots[20]
        self.assertEqual(C.detecter_avertissements(t21, t21, 'prop', True, C.NEG_MAX_LONG), ['negations-en-trop'])
        self.assertEqual(C.negations_perdues(t21, None, C.NEG_MAX_LONG), ['banner'])

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
