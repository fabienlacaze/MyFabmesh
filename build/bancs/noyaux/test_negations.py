"""Tests de extraire_negations / assainir_negatifs (scripts/composeur_intention.py), 2026-10-03.

« an orc, no helmet, holding a club » : le modele d'image dessine ce qu'on lui demande d'eviter, la negation doit donc quitter le positif et rejoindre le negatif.
Ce fichier fixe le COMPORTEMENT (formes reconnues, faux positifs refuses, plafonds, temps lineaire) ; la PARITE avec le jumeau JavaScript est gardee par
build/check_intention.py + build/check-intention.mjs (cas ecrits a la main + balayage genere), les mutations du lexique par test_mutations_negations.py.

Lancer :  <python de l'appli> build/bancs/noyaux/test_negations.py -v
Contre un ANCIEN module (les tests doivent echouer) :  COMPOSEUR_PY=<chemin> <python de l'appli> build/bancs/noyaux/test_negations.py
"""
import importlib.util
import io
import json
import os
import random
import re
import time
import unittest

RACINE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
CHEMIN = os.environ.get('COMPOSEUR_PY') or os.path.join(RACINE, 'scripts', 'composeur_intention.py')
CAS = os.path.join(RACINE, 'build', 'intention_cas.json')


def charger():
    spec = importlib.util.spec_from_file_location('composeur_negations_sous_test', CHEMIN)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


class Negations(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.C = charger()

    def ext(self, texte):
        r = self.C.extraire_negations(texte)
        return r['positif'], r['negatifs']

    # ------------------------------------------------------------------------------------------------------------ formes reconnues
    def test_cas_ecrits_a_la_main(self):
        """Les attendus de build/intention_cas.json (rediges d'apres la specification) : 46 cas de negations + 45 faux positifs."""
        with io.open(CAS, 'r', encoding='utf-8') as fichier:
            cas = [c for c in json.load(fichier) if 'negations' in c['attendu']]
        self.assertGreaterEqual(len(cas), 90)
        for c in cas:
            with self.subTest(id=c['id'], texte=c['texte'][:60]):
                positif, negatifs = self.ext(c['texte'])
                self.assertEqual(positif, c['attendu']['negations']['positif'])
                self.assertEqual(negatifs, c['attendu']['negations']['negatifs'])

    def test_les_formes_de_la_specification(self):
        formes = [
            ('An orc, no helmet, holding a club', 'An orc, holding a club', ['helmet']),            # segment « no X »
            ('A knight, not a helmet', 'A knight', ['helmet']),                                      # segment « not X »
            ('A knight, never a helmet', 'A knight', ['helmet']),                                    # segment « never X »
            ('An orc without a beard', 'An orc', ['beard']),                                         # « without a X »
            ('An orc without an axe', 'An orc', ['axe']),                                            # « without an X »
            ('An orc without any weapons', 'An orc', ['weapons']),                                   # « without any X »
            ('An orc without the helmet', 'An orc', ['helmet']),                                     # « without the X »
            ('An orc with no helmet', 'An orc', ['helmet']),                                         # « with no X »
            ('no helmet and no beard', '', ['helmet', 'beard']),                                     # « no X and no Y »
            ('a knight without a helmet and holding a sword', 'a knight holding a sword', ['helmet']),   # en milieu de segment
        ]
        for texte, positif, negatifs in formes:
            with self.subTest(texte=texte):
                self.assertEqual(self.ext(texte), (positif, negatifs))

    def test_groupes_nominaux_de_un_a_trois_mots_nettoyes(self):
        self.assertEqual(self.ext('A man, no hat')[1], ['hat'])
        self.assertEqual(self.ext('A man, no top hat')[1], [], 'garde-robe : « top » reste dans le positif (voir plus bas)')
        self.assertEqual(self.ext('A man, no metal helmet')[1], ['metal helmet'])
        self.assertEqual(self.ext('A man, no long white beard')[1], ['long white beard'])
        self.assertEqual(self.ext('A man, no very long white beard')[1], ['long white beard'], 'plus de 3 mots : les 3 derniers (la tete du groupe est a droite)')
        self.assertEqual(self.ext('A man, NO The Helmet')[1], ['helmet'], 'minuscules, articles retires')
        self.assertEqual(self.ext('A man, no t-shirt logo')[1], ['t-shirt logo'], 'tirets conserves')

    def test_unarmed_et_empty_handed_restent_au_composeur_existant(self):
        for texte in ('A monk, unarmed', 'A monk, empty-handed', 'A monk, bare-handed'):
            self.assertEqual(self.ext(texte), (texte, []))
            self.assertTrue(self.C.analyser(texte, 'character', '')['sans_arme'], texte)

    # ------------------------------------------------------------------------------------------------------------ faux positifs
    def test_faux_positifs_de_la_specification(self):
        for texte in ('no one', 'no one around', 'nobody', 'A man, nobody else', 'none', 'nothing', 'nothing special',
                      'not only fast but also strong', 'A car, not only red but also shiny', 'no longer needed', 'no more',
                      'cannot be seen', 'not too bright', 'notably red', 'A nose', 'a north wind', 'Nonstop', 'a nosey neighbour',
                      'a poster titled Without Remorse', 'The film Without a Trace'):
            with self.subTest(texte=texte):
                self.assertEqual(self.ext(texte), (texte, []))

    def test_garde_robe_et_nudite_restent_dans_le_positif(self):
        """Le filtre de moderation lit ces phrases dans le texte (« without clothes », « no shirt »...) : elles ne doivent pas passer au negatif."""
        for texte in ('A man without clothes', 'A woman, no shirt', 'A man without a shirt', 'A person, not naked', 'A man, no underwear',
                      'A woman, wearing no clothes', 'A man without pants', 'A woman, without a top', 'no nudity'):
            with self.subTest(texte=texte):
                self.assertEqual(self.ext(texte), (texte, []))

    def test_listes_de_mots_du_module(self):
        faux = self.C._NEG_FAUX
        for w in ('one', 'longer', 'more', 'matter'):
            self.assertIn(w, faux['no'])
        for w in ('only', 'too', 'very', 'even', 'at'):
            self.assertIn(w, faux['not'])
        for w in ('clothes', 'clothing', 'shirt', 'top', 'pants', 'underwear', 'naked', 'nude'):
            self.assertIn(w, self.C._NEG_SENSIBLES)

    # ------------------------------------------------------------------------------------------------------------ plafonds
    def test_huit_termes_au_plus_le_reste_reste_dans_le_positif(self):
        noms = ['hat', 'coat', 'boots', 'gloves', 'scarf', 'belt', 'cape', 'mask', 'ring', 'sock', 'vest', 'cloak']
        positif, negatifs = self.ext(', '.join('no ' + n for n in noms))
        self.assertEqual(negatifs, noms[:8])
        self.assertEqual(positif, 'no ring, no sock, no vest, no cloak', 'les phrases au-dela du plafond ne sont pas supprimees')
        self.assertEqual(self.C.MAX_TERMES_NEGATIFS, 8)

    def test_quarante_caracteres_au_plus(self):
        long = 'a' * 30 + ' ' + 'b' * 9                      # 40 caracteres : accepte
        self.assertEqual(self.ext('A man, no ' + long)[1], [long])
        trop = 'a' * 30 + ' ' + 'b' * 10                      # 41 : refuse, le texte reste
        self.assertEqual(self.ext('A man, no ' + trop), ('A man, no ' + trop, []))
        self.assertEqual(self.C.MAX_CARS_TERME, 40)

    def test_texte_tronque_a_deux_mille_caracteres(self):
        t = 'a' * 3000
        self.assertEqual(self.ext(t), ('a' * 2000, []))
        self.assertEqual(self.C.MAX_TEXTE_NEGATIONS, 2000)
        # une negation au-dela de 2 000 caracteres n'est pas vue
        self.assertEqual(self.ext('a' * 2005 + ', no helmet'), ('a' * 2000, []))
        # une negation avant : vue, et le positif ne depasse pas 2 000 caracteres
        positif, negatifs = self.ext('An orc, no helmet, ' + 'b ' * 2000)
        self.assertEqual(negatifs, ['helmet'])
        self.assertLessEqual(len(positif), 2000)

    def test_texte_sans_negation_ressort_octet_pour_octet(self):
        for texte in ('', 'An orc', 'An  orc ,  warrior', ' \t leading and trailing  ', 'a,b ,c , d', 'x\r\ny', 'café éléphant', 'A knight. Standing.',
                      'one, two; three | four - five', ',,,', '...', 'T-pose, 3D, 1.5'):
            self.assertEqual(self.ext(texte), (texte, []), repr(texte))

    def test_entrees_non_textuelles(self):
        self.assertEqual(self.ext(None), ('', []))
        self.assertEqual(self.ext(12), ('12', []))

    def test_interrupteur_regles(self):
        self.assertIn('negations', self.C.REGLES_ACTIVES)
        self.assertIn('negations', self.C.TOUTES_REGLES)
        self.assertEqual(self.C.extraire_negations('An orc, no helmet', []), {'positif': 'An orc, no helmet', 'negatifs': []})
        self.assertEqual(self.C.extraire_negations('An orc, no helmet', ['objets']), {'positif': 'An orc, no helmet', 'negatifs': []})
        self.assertEqual(self.C.extraire_negations('An orc, no helmet', 'toutes')['negatifs'], ['helmet'])

    # ------------------------------------------------------------------------------------------------------------ robustesse
    def test_cent_mille_caracteres_en_moins_d_une_seconde(self):
        N = 100000
        entrees = [' ' * N + 'x', ',' * N + 'x', ', ' * (N // 2) + 'x', 'no x, ' * (N // 6), 'no ' * (N // 3), 'without ' * (N // 8), 'no helmet and ' * (N // 14),
                   'not wearing ' * (N // 12), '(' * N, 'no ' + 'x ' * (N // 2), 'no x or ' * (N // 8), 'a' * N, '\U0001F600' * (N // 2), '- ' * (N // 2) + 'no helmet',
                   'with no ' * (N // 8), 'and no ' * (N // 7), ('no ' * 50 + ', ') * (N // 160)]
        for e in entrees:
            t0 = time.time()
            self.C.extraire_negations(e)
            self.assertLess(time.time() - t0, 1.0, repr(e[:30]))
            t0 = time.time()
            self.C.assainir_negatifs([e])
            self.assertLess(time.time() - t0, 1.0)

    def test_proprietes_sur_textes_aleatoires(self):
        rnd = random.Random(20261003)
        decl = ['no', 'No', 'NO', 'not', 'never', 'without', 'Without', 'with no', 'and no', 'wearing no', 'not wearing', 'with', 'and', 'or', 'but']
        noms = ['helmet', 'beard', 'hat', 'wings', 'shadows', 'text', 'long white curly beard', 'red', 'flying', 't-shirt', 'x', 'clothes', 'one', 'more', 'anything',
                '12', "knight's helmet", 'café']
        autres = ['An orc', 'holding', 'a club', 'covered in blood', 'only', 'too', 'longer', '(', ')', '"', '-', '|', '.', '!', '\U0001F600', 'T-pose']
        seps = [', ', ' ', ' ', ' ', '; ', '. ', ' - ', ' | ', '\n', ',', '  ']
        mots = re.compile(r"[A-Za-z0-9À-￿'-]+")
        for _ in range(3000):
            t = ''.join(rnd.choice([rnd.choice(decl), rnd.choice(noms), rnd.choice(autres), 'a', 'the']) + rnd.choice(seps) for _ in range(rnd.randint(0, 20)))
            positif, negatifs = self.ext(t)
            tt = t[:2000]
            if not negatifs:
                self.assertEqual(positif, tt, repr(t))
            self.assertLessEqual(len(negatifs), 8, repr(t))
            self.assertEqual(len(set(negatifs)), len(negatifs), 'doublon : ' + repr(t))
            for n in negatifs:
                self.assertTrue(re.fullmatch(r"[a-z]+(?:[ -][a-z]+)*", n) and len(n) <= 40 and len(n.split()) <= 3, repr(n) + ' <- ' + repr(t))
            reste = {}
            for m in mots.findall(tt):
                reste[m] = reste.get(m, 0) + 1
            for m in mots.findall(positif):
                self.assertGreater(reste.get(m, 0), 0, 'mot invente %r dans le positif de %r' % (m, t))
                reste[m] -= 1
            if not re.search(r"(?i)\b(no|not|never|without)\b", tt):
                self.assertEqual((positif, negatifs), (tt, []), 'aucun declencheur : rien ne change : ' + repr(t))

    # ------------------------------------------------------------------------------------------------------------ assainir_negatifs
    def test_assainir_negatifs(self):
        a = self.C.assainir_negatifs
        self.assertEqual(a(['helmet', 'beard']), ['helmet', 'beard'])
        self.assertEqual(a(['Helmet', 'BEARD', 'helmet']), ['helmet', 'beard'], 'minuscules, sans doublon')
        self.assertEqual(a(['  white   curly  beard ']), ['white curly beard'], 'blancs normalises')
        self.assertEqual(a(['t-shirt', '-x', 'x-', 'a--b', 'ok-ok']), ['t-shirt', 'ok-ok'], 'tirets seulement a l\'interieur d\'un mot')
        self.assertEqual(a(['x' * 40, 'x' * 41]), ['x' * 40])
        self.assertEqual(a(['café', 'helmet2', "knight's", 'no, helmet', '']), [], 'lettres ASCII, espaces, tirets : le reste est ecarte, jamais corrige')
        self.assertEqual(a([1, None, True, ['helmet'], {'a': 1}, 'ok']), ['ok'])
        self.assertEqual(len(a([chr(97 + i) for i in range(20)])), 8, '8 termes au plus')
        for pas_une_liste in ('helmet', None, 7, {'a': 'b'}):
            self.assertEqual(a(pas_une_liste), [])
        self.assertEqual(a(('helmet', 'beard')), ['helmet', 'beard'], 'un tuple est accepte')

    def test_idempotence_sur_les_termes_extraits(self):
        for texte in ('An orc, no helmet, no beard', 'A man, no long white curly beard', 'a car, not red'):
            negs = self.C.extraire_negations(texte)['negatifs']
            self.assertEqual(self.C.assainir_negatifs(negs), negs)


if __name__ == '__main__':
    unittest.main()
