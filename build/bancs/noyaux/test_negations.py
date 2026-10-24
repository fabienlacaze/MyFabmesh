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
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

RACINE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
CHEMIN = os.environ.get('COMPOSEUR_PY') or os.path.join(RACINE, 'scripts', 'composeur_intention.py')
CAS = os.path.join(RACINE, 'build', 'intention_cas.json')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import negations_constructions as K  # noqa: E402
JS_LIB = os.path.join(RACINE, 'src', 'renderer', 'lib', 'composeur-intention.js')
JS_SORTIE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'negations_js_sortie.mjs')


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
            ('A knight, not wielding a sword', 'A knight', ['sword']),                               # « wielding » est un verbe leger comme « wearing »
            ('A knight WITHOUT a helmet', 'A knight', ['helmet']),                                   # capitales = emphase, pas un titre
            ('a knight, not without a helmet', 'a knight, not without a helmet', []),                # double negation : elle dit l'inverse, on n'y touche pas
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
        self.assertEqual(self.ext('A man, no full-plate helmet')[1], ['full-plate helmet'], 'tirets conserves')
        # un morceau a tiret sensible est refuse comme le mot entier (le serveur applique la meme regle) : le texte reste, le filtre de moderation le voit
        self.assertEqual(self.ext('A man, no t-shirt logo'), ('A man, no t-shirt logo', []), 't-shirt : garde-robe, comme « shirt »')
        self.assertEqual(self.ext("A knight, no knight's helmet"), ('A knight', ['helmet']), 'le possesseur n est pas ce qu on nie')

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
    def test_huit_termes_au_plus_les_negations_suivantes_quittent_quand_meme_le_positif(self):
        """Au-dela de 8 termes il n'y a plus de place dans le negatif : les locutions en trop QUITTENT quand meme le positif (restees dedans, elles font dessiner l'objet) et sont consignees dans `perdus` pour l'avertissement."""
        noms = ['hat', 'coat', 'boots', 'gloves', 'scarf', 'belt', 'cape', 'mask', 'ring', 'sock', 'vest', 'cloak']
        positif, negatifs = self.ext(', '.join('no ' + n for n in noms))
        self.assertEqual(negatifs, noms[:8])
        self.assertEqual(positif, '', 'plus aucune locution negative dans le positif')
        self.assertEqual(self.C.negations_perdues(', '.join('no ' + n for n in noms)), noms[8:])
        positif, negatifs = self.ext('A knight, ' + ', '.join('no ' + n for n in noms) + ', holding a sword')
        self.assertEqual((positif, negatifs), ('A knight, holding a sword', noms[:8]))
        positif, negatifs = self.ext('A knight without ' + ' and '.join(noms))
        self.assertEqual((positif, negatifs), ('A knight', noms[:8]))
        self.assertEqual(self.C.MAX_TERMES_NEGATIFS, 8)
        self.assertEqual((self.C.NEG_MAX_DIRECT, self.C.NEG_MAX_LONG), (8, 20))

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
                if m.lower() == 'with':
                    continue        # le seul mot que le module AJOUTE : le lien d'une conjonction remplacee (« without X but Y » -> « with Y »), voir test_conjonction_apres_la_locution
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
        self.assertEqual(a(['full-plate', '-x', 'x-', 'a--b', 'ok-ok']), ['full-plate', 'ok-ok'], 'tirets seulement a l\'interieur d\'un mot')
        # 2026-10-14 : la garde-robe est refusee ici aussi (meme regle que l'extraction et que le serveur), morceaux a tiret compris
        self.assertEqual(a(['t-shirt', 'clothes', 'red shorts', 'jeans', 'helmet']), ['helmet'], 'garde-robe jamais au negatif')
        self.assertEqual(a(sorted(self.C._NEG_SENSIBLES)), [], 'toute la liste')
        self.assertEqual(a(['K', 'hatK']), [], 'signe Kelvin : pas une lettre ASCII, meme si lower() en fait un « k »')
        self.assertEqual(a(['x' * 40, 'x' * 41]), ['x' * 40])
        self.assertEqual(a(['café', 'helmet2', "knight's", 'no, helmet', '']), [], 'lettres ASCII, espaces, tirets : le reste est ecarte, jamais corrige')
        self.assertEqual(a([1, None, True, ['helmet'], {'a': 1}, 'ok']), ['ok'])
        self.assertEqual(len(a([chr(97 + i) for i in range(20)])), 8, '8 termes au plus (plafond absent : le plus prudent)')
        self.assertEqual(len(a([chr(97 + i) for i in range(25)], self.C.NEG_MAX_LONG)), 20, '20 termes au plus sur une route longue')
        self.assertEqual(len(a([chr(97 + i) for i in range(25)], self.C.NEG_MAX_DIRECT)), 8)
        self.assertEqual(len(a([chr(97 + i) for i in range(25)], 99)), 8, 'plafond invalide : le plus prudent')
        self.assertEqual(len(a([chr(97 + i) for i in range(25)], 0)), 8)
        self.assertEqual(len(a([chr(97 + i) for i in range(25)], True)), 8)
        for pas_une_liste in ('helmet', None, 7, {'a': 'b'}):
            self.assertEqual(a(pas_une_liste), [])
        self.assertEqual(a(('helmet', 'beard')), ['helmet', 'beard'], 'un tuple est accepte')

    # ------------------------------------------------------------------------------------------------------------ relecture du 2026-10-14
    def test_complement_porte_par_l_objet_nie_part_avec_lui(self):
        """« a knight without a helmet on his head » donnait « a knight on his head » (positif corrompu, revue 1 B2)."""
        cas = [
            ('a knight without a helmet on his head', 'a knight', ['helmet']),
            ('a knight without a helmet on his head, holding a sword', 'a knight, holding a sword', ['helmet']),
            ('a knight without a helmet on his head holding a sword', 'a knight holding a sword', ['helmet']),
            ('a warrior with no ring on her finger', 'a warrior', ['ring']),
            # le complement decrit le SUJET (pas une partie du corps) : il reste
            ('an orc without armor in a dark forest', 'an orc in a dark forest', ['armor']),
            ('an orc without a helmet in his castle', 'an orc in his castle', ['helmet']),
            ('a knight without a shield on his horse', 'a knight on his horse', ['shield']),
        ]
        for texte, positif, negatifs in cas:
            with self.subTest(texte=texte):
                self.assertEqual(self.ext(texte), (positif, negatifs))

    def test_titre_capitalise_suivi_d_un_nom(self):
        """« Without Remorse hero » : « hero » partait au negatif et le positif restait vide."""
        self.assertEqual(self.ext('Without Remorse hero'), ('Without Remorse hero', []))
        self.assertEqual(self.ext('Without helmet, a knight'), ('a knight', ['helmet']), 'un declencheur capitalise en tete de phrase reste une negation')

    def test_garde_robe_complete(self):
        for texte in ('a man, no shorts', 'a man without jeans and boots', 'a woman, no blouse', 'a man, no briefs', 'a man without a loincloth'):
            with self.subTest(texte=texte):
                self.assertEqual(self.ext(texte), (texte, []))
        self.assertEqual(self.ext('a man, no jacket'), ('a man', ['jacket']), 'une veste absente ne denude pas')

    def test_enveloppe_negations_et_positif(self):
        """Jumelle de negationsEtPositif (JS) : texte trop long jamais coupe, texte entierement negatif garde comme positif (ses termes partent quand meme)."""
        e = self.C.negations_et_positif
        self.assertEqual(e('An orc, no helmet'), {'positif': 'An orc', 'negatifs': ['helmet']})
        self.assertEqual(e('NO HELMET'), {'positif': 'NO HELMET', 'negatifs': ['helmet']})
        long = 'An orc, ' + 'very ' * 500 + 'tall'
        self.assertEqual(e(long), {'positif': long, 'negatifs': []}, 'plus de 2 000 caracteres : rendu tel quel, jamais tronque')
        self.assertEqual(e('An orc'), {'positif': 'An orc', 'negatifs': []})

    def test_idempotence_sur_les_termes_extraits(self):
        for texte in ('An orc, no helmet, no beard', 'A man, no long white curly beard', 'a car, not red'):
            negs = self.C.extraire_negations(texte)['negatifs']
            self.assertEqual(self.C.assainir_negatifs(negs), negs)

    # ------------------------------------------------------------------------------------------------------------ relecture du 2026-10-18
    def test_participe_du_sujet_apres_la_locution_reste_dans_le_positif(self):
        """« an orc with no helmet standing » envoyait « helmet standing » au NEGATIF (le modele evitait donc un orc debout) et perdait « standing » du positif."""
        cas = [
            ('an orc with no helmet standing', 'an orc standing', ['helmet']),
            ('a man with no hat smiling', 'a man smiling', ['hat']),
            ('a woman with no makeup smiling at the camera', 'a woman smiling at the camera', ['makeup']),
            ('a boxer without gloves punching', 'a boxer punching', ['gloves']),
            ('a warrior with no weapon raising his fists', 'a warrior raising his fists', ['weapon']),
            ('a ghost with no legs floating', 'a ghost floating', ['legs']),
            ('a girl, with no shoes sitting', 'a girl, sitting', ['shoes']),                       # segment qui commence par une liaison : il se rattache au sujet
            ('an orc without a helmet and smiling', 'an orc smiling', ['helmet']),                  # « smiling » n'est pas un element de la liste nie
            ('a knight without a helmet on his head smiling', 'a knight smiling', ['helmet']),     # le complement porte part, le participe reste
        ]
        for texte, positif, negatifs in cas:
            with self.subTest(texte=texte):
                self.assertEqual(self.ext(texte), (positif, negatifs))

    def test_participe_apres_une_negation_en_tete_de_segment_reste_dans_le_groupe_nie(self):
        """« a street, no birds flying » : rien dans ce segment pour porter le participe, il appartient au groupe nie (cas n66). Quelque chose derriere lui : il ouvre une proposition."""
        self.assertEqual(self.ext('a street, no birds flying'), ('a street', ['birds flying']))
        self.assertEqual(self.ext('a street, no people walking'), ('a street', ['people walking']))
        self.assertEqual(self.ext('a woman, no makeup smiling at the camera'), ('a woman, smiling at the camera', ['makeup']))
        self.assertEqual(self.ext('a king, no crown sitting on a throne'), ('a king, sitting on a throne', ['crown']))

    def test_conjonction_apres_la_locution(self):
        """« a man with no beard but a mustache » donnait « a man but a mustache » (conjonction pendante) ; elle reprend maintenant le mot qui liait la locution."""
        cas = [
            ('a man with no beard but a mustache', 'a man with a mustache', ['beard']),
            ('an orc with no weapons and armor', 'an orc with armor', ['weapons']),
            ('a fireman with no helmet and a mask', 'a fireman with a mask', ['helmet']),
            ('an orc without weapons but with armor', 'an orc with armor', ['weapons']),             # une preposition suit : la conjonction part, « with » n'est pas double
            ('a viking not wearing a helmet but a hood', 'a viking wearing a hood', ['helmet']),    # le verbe leger de « not wearing »
            ('an orc has no helmet but a hood', 'an orc has a hood', ['helmet']),                   # le mot qui precedait « no » est garde
            ('a knight with a sword and no shield but a lance', 'a knight with a sword and a lance', ['shield']),
            ('a knight with no helmet but wearing a hood', 'a knight wearing a hood', ['helmet']),  # un verbe suit
            ('an orc with no helmet and', 'an orc', ['helmet']),                                    # conjonction pendante en fin de texte
            ('an orc with no helmet but no beard', 'an orc', ['helmet', 'beard']),                  # une autre negation suit : elle s'en occupe
        ]
        for texte, positif, negatifs in cas:
            with self.subTest(texte=texte):
                self.assertEqual(self.ext(texte), (positif, negatifs))
        # pas de negation : « but » et « and » ne bougent pas
        for texte in ('a knight, but a squire', 'a knight but a squire', 'a knight and a squire'):
            self.assertEqual(self.ext(texte), (texte, []))

    def test_second_declencheur_repete_avec_un_verbe_leger(self):
        """« a knight, no helmet and not wearing a scarf » n'extrayait RIEN : « wearing » devenait un terme et la locution entiere etait refusee."""
        cas = [
            ('a knight, no helmet and not wearing a scarf', 'a knight', ['helmet', 'scarf']),
            ('an orc with no helmet and not wearing a scarf', 'an orc', ['helmet', 'scarf']),
            ('an orc without a helmet and not wearing a scarf', 'an orc', ['helmet', 'scarf']),
            ('an orc not wearing a helmet and not wearing a scarf', 'an orc', ['helmet', 'scarf']),
        ]
        for texte, positif, negatifs in cas:
            with self.subTest(texte=texte):
                self.assertEqual(self.ext(texte), (positif, negatifs))

    def test_liste_nie_qui_continue_apres_une_virgule(self):
        """Tour 2 (24/10, bloquant C) : « a knight with no helmet, sword or shield » laissait « sword or shield » dans le POSITIF (le modele dessinait l'epee et le
        bouclier interdits). Une liste qui continue apres une virgule se ferme par une conjonction, ou compte au moins deux elements d'un mot."""
        oui = [
            ('a knight with no helmet, sword or shield', 'a knight', ['helmet', 'sword', 'shield']),
            ('a knight without a helmet, a sword or a shield', 'a knight', ['helmet', 'sword', 'shield']),
            ('a knight without helmet, sword, shield', 'a knight', ['helmet', 'sword', 'shield']),
            ('an orc with no hat, cape or boots', 'an orc', ['hat', 'cape', 'boots']),
            ('a knight with no helmet, sword or shield, castle', 'a knight, castle', ['helmet', 'sword', 'shield']),
        ]
        for texte, positif, negatifs in oui:
            with self.subTest(texte=texte):
                self.assertEqual(self.ext(texte), (positif, negatifs))
        # temoins : une suite qui n'est pas une liste nie (verbe, preposition, un seul mot, etiquettes) reste dans le positif
        non = [
            ('an orc without helmet, dark forest', 'an orc, dark forest', ['helmet']),
            ('a knight with no helmet, red cape, castle', 'a knight, red cape, castle', ['helmet']),
            ('a knight with no helmet, holding a sword', 'a knight, holding a sword', ['helmet']),
            ('a knight with no helmet, sword or shield, standing in a field', 'a knight, standing in a field', ['helmet', 'sword', 'shield']),
            ('a knight, no helmet, a sword or a shield', 'a knight, a sword or a shield', ['helmet']),
        ]
        for texte, positif, negatifs in non:
            with self.subTest(texte=texte):
                self.assertEqual(self.ext(texte), (positif, negatifs))

    def test_cas_construits(self):
        """Chaque FORME de phrase (build/bancs/noyaux/negations_constructions.py) devient ce qu'elle doit devenir, pour des centaines de sujets / groupes nies / complements
        (le texte et la sortie attendue sortent du meme gabarit). Sur l'ancien module : plusieurs milliers d'ecarts (participes, conjonctions, second declencheur)."""
        cas = K.construire(2028, 300)
        self.assertGreater(len(cas), 10000)
        echecs = []
        for c in cas:
            positif, negatifs = self.ext(c['texte'])
            if positif != c['positif'] or negatifs != c['negatifs']:
                echecs.append((c['nom'], c['texte'], (positif, negatifs), (c['positif'], c['negatifs'])))
        self.assertEqual(echecs[:6], [], '%d ecart(s) sur %d cas construits' % (len(echecs), len(cas)))

    def test_parite_javascript_sur_les_cas_construits(self):
        """Le jumeau JavaScript donne les memes sorties sur les cas construits (ceux de la garde sont graves, ceux-ci sont d'une autre graine et bien plus nombreux)."""
        node = shutil.which('node')
        if not node:
            self.skipTest('node absent')
        textes = [c['texte'] for c in K.construire(2029, 120)]
        rep = tempfile.mkdtemp(prefix='negations-parite-')
        try:
            entrees, sorties = os.path.join(rep, 'in.json'), os.path.join(rep, 'out.json')
            with io.open(entrees, 'w', encoding='utf-8') as f:
                json.dump(textes, f)
            r = subprocess.run([node, JS_SORTIE, JS_LIB, entrees, sorties], capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=120)
            self.assertEqual(r.returncode, 0, r.stderr[:500])
            with io.open(sorties, 'r', encoding='utf-8') as f:
                js = json.load(f)
        finally:
            shutil.rmtree(rep, ignore_errors=True)
        self.assertEqual(len(js), len(textes))
        ecarts = [(t, list(self.ext(t)), j) for t, j in zip(textes, js) if list(self.ext(t)) != j]
        self.assertEqual(ecarts[:5], [], '%d ecart(s) Python / JavaScript sur %d textes' % (len(ecarts), len(textes)))

MOTS20 = ['helmet', 'cape', 'sword', 'shield', 'crown', 'boots', 'belt', 'ring', 'staff', 'horns', 'wings', 'tail', 'beard', 'scarf', 'gloves', 'amulet', 'spear',
          'quiver', 'hood', 'mask', 'banner', 'chain']


class PlafondParRoute(unittest.TestCase):
    """24/10, plafond de negations par route : 20 sur les routes a encodeur long (generation d'image), 8 sur les outils a appel direct (budget de 77 jetons).
    Chaque assertion ECHOUE si le plafond est ignore, mal transmis ou mal borne (voir test_mutations_negations.py)."""

    @classmethod
    def setUpClass(cls):
        cls.C = charger()

    def virgules(self, n):
        if not n:
            return 'An orc warrior, holding an axe'
        return 'An orc warrior, ' + ', '.join('no ' + m for m in MOTS20[:n]) + ', holding an axe'

    def test_constantes(self):
        self.assertEqual((self.C.NEG_MAX_DIRECT, self.C.NEG_MAX_LONG), (8, 20))
        self.assertEqual(self.C.MAX_TERMES_NEGATIFS, 8, 'ancien nom : le plafond prudent')

    def test_douze_vingt_et_vingt_et_une_negations_sur_une_route_longue(self):
        for n, gardes, perdus in ((12, 12, []), (20, 20, []), (21, 20, ['banner'])):
            t = self.virgules(n)
            r = self.C.negations_et_positif(t, None, self.C.NEG_MAX_LONG)
            self.assertEqual(r['negatifs'], MOTS20[:gardes], n)
            self.assertEqual(r.get('perdus', []), perdus, n)
            self.assertEqual(r['positif'], 'An orc warrior, holding an axe', 'les %d locutions quittent le positif, la 21e aussi' % n)
            self.assertEqual(self.C.negations_perdues(t, None, self.C.NEG_MAX_LONG), perdus)
            codes = self.C.detecter_avertissements(t, t, 'prop', True, self.C.NEG_MAX_LONG)
            self.assertEqual('negations-en-trop' in codes, bool(perdus), n)

    def test_neuf_negations_sur_un_outil_direct_la_neuvieme_est_annoncee(self):
        t = self.virgules(9)
        for plafond in (None, self.C.NEG_MAX_DIRECT):
            r = self.C.negations_et_positif(t, None, plafond)
            self.assertEqual(r['negatifs'], MOTS20[:8])
            self.assertEqual(r['perdus'], [MOTS20[8]])
            self.assertEqual(r['positif'], 'An orc warrior, holding an axe')
            self.assertIn('negations-en-trop', self.C.detecter_avertissements(t, t, 'prop', True, plafond))
        # la meme phrase sur une route longue : rien a annoncer
        self.assertNotIn('negations-en-trop', self.C.detecter_avertissements(t, t, 'prop', True, self.C.NEG_MAX_LONG))

    def test_outil_direct_separer_negations_outil_reste_a_huit(self):
        positif, termes = self.C.separer_negations_outil(self.virgules(12))
        self.assertEqual(termes, MOTS20[:8])
        self.assertEqual(positif, 'An orc warrior, holding an axe')

    def test_les_trois_formes_de_liste(self):
        for n, perdus in ((12, []), (20, []), (22, MOTS20[20:22])):
            mots = MOTS20[:n]
            formes = [
                'An orc with no ' + ', '.join(mots[:-1]) + ' or ' + mots[-1] + ', holding an axe',
                'An orc without ' + ' and '.join(mots) + ', holding an axe',
                'An orc, ' + ', '.join('no ' + m for m in mots) + ', holding an axe',
            ]
            for f in formes:
                r = self.C.negations_et_positif(f, None, self.C.NEG_MAX_LONG)
                self.assertEqual(r['negatifs'], mots[:20], f[:50])
                self.assertEqual(r.get('perdus', []), perdus, f[:50])
                self.assertIn('holding an axe', r['positif'])
                for m in mots:
                    self.assertNotIn(m, r['positif'].split(), 'la locution ' + m + ' est restee dans le positif')

    def test_zero_a_huit_negations_donnent_le_meme_resultat_a_l_octet_pour_tout_plafond(self):
        for n in range(0, 9):
            t = self.virgules(n) if n else 'An orc warrior, holding an axe'
            avant = self.C.extraire_negations(t)
            for plafond in (None, 8, 20):
                self.assertEqual(self.C.extraire_negations(t, None, plafond), avant, (n, plafond))
                self.assertEqual(self.C.negations_et_positif(t, None, plafond), self.C.negations_et_positif(t), (n, plafond))
            if n == 0:
                self.assertEqual(avant['positif'], t, 'sans negation : le texte a l\'octet')

    def test_plafond_invalide_prend_le_plus_prudent(self):
        t = self.virgules(12)
        for p in (0, -1, 21, 99, True, False, 8.0, '20', [20]):
            self.assertEqual(len(self.C.extraire_negations(t, None, p)['negatifs']), 8, repr(p))

    def test_assainir_a_chaque_plafond(self):
        liste = [m for m in MOTS20]
        self.assertEqual(self.C.assainir_negatifs(liste), liste[:8])
        self.assertEqual(self.C.assainir_negatifs(liste, 8), liste[:8])
        self.assertEqual(self.C.assainir_negatifs(liste, 20), liste[:20])
        self.assertEqual(self.C.assainir_negatifs(liste, 12), liste[:12])

    def test_python_et_javascript_donnent_les_memes_negations_a_chaque_plafond(self):
        textes = [self.virgules(n) for n in (0, 8, 9, 12, 20, 21)]
        rep = tempfile.mkdtemp(prefix='plafond-js-')
        try:
            script = os.path.join(rep, 'sortie.mjs')
            with io.open(script, 'w', encoding='utf-8') as f:
                f.write("import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import { pathToFileURL } from 'node:url';\n"
                        "const [, , lib, entrees, sorties] = process.argv;\n"
                        "const copie = path.join(path.dirname(sorties), 'lib.mjs'); fs.writeFileSync(copie, fs.readFileSync(lib, 'utf8'));\n"
                        "const m = await import(pathToFileURL(copie).href);\n"
                        "const textes = JSON.parse(fs.readFileSync(entrees, 'utf8')); const out = [];\n"
                        "for (const t of textes) for (const p of [undefined, 8, 20]) { const r = m.negationsEtPositif(t, undefined, p); out.push([r.positif, r.negatifs, r.perdus || []]); }\n"
                        "fs.writeFileSync(sorties, JSON.stringify(out), 'utf8');\n")
            entrees, sorties = os.path.join(rep, 'in.json'), os.path.join(rep, 'out.json')
            with io.open(entrees, 'w', encoding='utf-8') as f:
                json.dump(textes, f)
            r = subprocess.run(['node', script, JS_LIB, entrees, sorties], stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True)
            self.assertEqual(r.returncode, 0, r.stderr[:500])
            with io.open(sorties, 'r', encoding='utf-8') as f:
                js = json.load(f)
        finally:
            shutil.rmtree(rep, ignore_errors=True)
        attendu = []
        for t in textes:
            for p in (None, 8, 20):
                r = self.C.negations_et_positif(t, None, p)
                attendu.append([r['positif'], r['negatifs'], r.get('perdus', [])])
        self.assertEqual(js, attendu)


if __name__ == '__main__':
    unittest.main()
