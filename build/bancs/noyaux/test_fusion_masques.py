"""Tests du noyau partage scripts/fusion_masques.py (= modal_app/fusion_masques.py) : UNION des masques de detourage u2net + Lucida
(2026-10-03).

Aucun torch, aucun poids, aucun reseau : numpy seul (PIL n'est importe que pour verifier qu'une image PIL est refusee).

Ce que les tests prouvent :
  - fusionner_alphas : alpha = max(Lucida, u2net la ou u2net >= seuil, sinon 0) ; seuil 127 INCLUS ; Lucida garde son alpha doux ;
    resultat neuf, uint8, meme forme ; entrees intactes (meme en lecture seule) ; entrees invalides -> ValueError claire ;
    formes minuscules (1x1, 3x7) et vides ; proprietes sur des tirages aleatoires ;
  - diagnostic_masques : les 7 cles, des valeurs Python natives ; les trois cas de la MESURE du 2026-10-03 (orc, ane, mille-pattes)
    reconstruits au pixel pres a partir des chiffres du banc Modal (l'union vaut 1,03 x Lucida sur l'orc, 5,4 x Lucida = 1,00 x u2net
    sur l'ane) ; bornes exactes (< strict) des deux « defaillant » ; roles symetriques ; images vides ;
  - mode_detourage : la table complete, jamais d'exception ;
  - contrat du module : uniquement numpy, copie identique, pas de lettre accentuee (style du depot).

Lancer :  <python de l'appli> build/bancs/noyaux/test_fusion_masques.py -v
Autre copie du noyau (preuve d'echec sur un mutant ou l'ancien code) : variable NOYAU_FUSION_MASQUES.
Numpy 1.26 (celui de Modal) : <python-rig de l'appli> build/bancs/noyaux/test_fusion_masques.py -v
"""
import ast
import importlib.util
import json
import os
import sys
import unittest

import numpy as np

RACINE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
SOURCE = os.environ.get('NOYAU_FUSION_MASQUES') or os.path.join(RACINE, 'scripts', 'fusion_masques.py')
COPIE = os.path.join(RACINE, 'modal_app', 'fusion_masques.py')


def lire(chemin, **options):
    with open(chemin, encoding='utf-8', **options) as f:
        return f.read()


def charger(chemin, nom='fusion_masques_sous_test'):
    spec = importlib.util.spec_from_file_location(nom, chemin)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


F = charger(SOURCE)


def u8(*lignes):
    return np.array(lignes, dtype=np.uint8)


def depuis_comptes(h, w, n_u2, n_lucida, n_commun):
    """Deux masques 0 / 255 de h x w pixels avec EXACTEMENT ces comptes : u2net = les n_u2 premiers pixels, Lucida = n_commun
    pixels pris dans u2net + (n_lucida - n_commun) pixels hors de u2net."""
    assert n_commun <= min(n_u2, n_lucida) and n_u2 + n_lucida - n_commun <= h * w
    u2 = np.zeros(h * w, dtype=np.uint8)
    lu = np.zeros(h * w, dtype=np.uint8)
    u2[:n_u2] = 255
    lu[:n_commun] = 255
    lu[n_u2:n_u2 + n_lucida - n_commun] = 255
    return u2.reshape(h, w), lu.reshape(h, w)


class FusionnerAlphas(unittest.TestCase):

    def test_union_simple(self):
        u2 = u8([0, 255, 255, 0],
                [0, 255, 255, 0])
        lu = u8([255, 255, 0, 0],
                [255, 0, 0, 255])
        attendu = u8([255, 255, 255, 0],
                     [255, 255, 255, 255])
        res = F.fusionner_alphas(u2, lu)
        self.assertEqual(res.dtype, np.uint8)
        self.assertTrue(np.array_equal(res, attendu), res)

    def test_seuil_127_est_inclus_par_defaut(self):
        u2 = u8([0, 1, 126, 127, 128, 200, 255])
        lu = np.zeros_like(u2)
        res = F.fusionner_alphas(u2, lu)
        self.assertEqual(res.tolist(), [[0, 0, 0, 127, 128, 200, 255]])      # 126 ignore, 127 garde : comparaison >=

    def test_lucida_garde_son_alpha_doux(self):
        lu = u8([0, 10, 126, 127, 200, 255])
        u2 = np.zeros_like(lu)
        self.assertTrue(np.array_equal(F.fusionner_alphas(u2, lu), lu))        # bords doux de Lucida conserves tels quels

    def test_maximum_des_deux(self):
        #        u2 sur et fort   u2 sur et faible   u2 PAS sur (ignore)   u2 PAS sur, Lucida nul   les deux forts
        u2 = u8([200,              130,               100,                  100,                     255])
        lu = u8([100,              20,                50,                   0,                       200])
        self.assertEqual(F.fusionner_alphas(u2, lu).tolist(), [[200, 130, 50, 0, 255]])

    def test_seuil_personnalise(self):
        u2 = u8([0, 100, 199, 200, 255])
        lu = np.zeros_like(u2)
        self.assertEqual(F.fusionner_alphas(u2, lu, seuil_u2=200).tolist(), [[0, 0, 0, 200, 255]])
        self.assertEqual(F.fusionner_alphas(u2, lu, 0).tolist(), [[0, 100, 199, 200, 255]])      # 0 : tout u2net est sur
        self.assertEqual(F.fusionner_alphas(u2, lu, 255).tolist(), [[0, 0, 0, 0, 255]])
        self.assertEqual(F.fusionner_alphas(u2, lu, seuil_u2=np.uint8(200)).tolist(), [[0, 0, 0, 200, 255]])
        self.assertEqual(F.fusionner_alphas(u2, lu, seuil_u2=np.int64(200)).tolist(), [[0, 0, 0, 200, 255]])

    def test_resultat_neuf_uint8_de_meme_forme(self):
        u2 = np.full((5, 7), 255, dtype=np.uint8)
        lu = np.zeros((5, 7), dtype=np.uint8)
        for res in (F.fusionner_alphas(u2, lu), F.fusionner_alphas(lu, u2), F.fusionner_alphas(u2, u2)):
            self.assertEqual(res.dtype, np.uint8)
            self.assertEqual(res.shape, (5, 7))
            self.assertTrue(res.flags.writeable)
            self.assertFalse(np.shares_memory(res, u2))
            self.assertFalse(np.shares_memory(res, lu))
        res = F.fusionner_alphas(u2, lu)
        res[0, 0] = 0                       # ecrire dans le resultat ne doit jamais toucher une entree
        self.assertEqual(int(u2[0, 0]), 255)

    def test_entrees_non_modifiees_meme_en_lecture_seule(self):
        rng = np.random.default_rng(3)
        u2 = rng.integers(0, 256, (16, 24), dtype=np.uint8)
        lu = rng.integers(0, 256, (16, 24), dtype=np.uint8)
        u2_avant, lu_avant = u2.copy(), lu.copy()
        F.fusionner_alphas(u2, lu)
        F.diagnostic_masques(u2, lu)
        self.assertTrue(np.array_equal(u2, u2_avant) and np.array_equal(lu, lu_avant))
        u2.setflags(write=False)            # np.asarray(image PIL) rend des tableaux en lecture seule
        lu.setflags(write=False)
        self.assertTrue(np.array_equal(F.fusionner_alphas(u2, lu), F.fusionner_alphas(u2_avant, lu_avant)))
        self.assertEqual(F.diagnostic_masques(u2, lu), F.diagnostic_masques(u2_avant, lu_avant))

    def test_entrees_non_contigues_ou_fortran(self):
        rng = np.random.default_rng(4)
        gros_u2 = rng.integers(0, 256, (20, 30), dtype=np.uint8)
        gros_lu = rng.integers(0, 256, (20, 30), dtype=np.uint8)
        u2, lu = gros_u2[::2, ::3], gros_lu[::2, ::3]                       # tranches non contigues
        ref = F.fusionner_alphas(np.ascontiguousarray(u2), np.ascontiguousarray(lu))
        self.assertTrue(np.array_equal(F.fusionner_alphas(u2, lu), ref))
        self.assertTrue(np.array_equal(F.fusionner_alphas(np.asfortranarray(u2), np.asfortranarray(lu)), ref))
        self.assertEqual(F.diagnostic_masques(u2, lu), F.diagnostic_masques(np.ascontiguousarray(u2), np.ascontiguousarray(lu)))

    def test_formes_minuscules_et_vides(self):
        for forme in ((1, 1), (1, 7), (7, 1), (3, 7)):
            u2 = np.full(forme, 200, dtype=np.uint8)
            lu = np.zeros(forme, dtype=np.uint8)
            res = F.fusionner_alphas(u2, lu)
            self.assertEqual(res.shape, forme)
            self.assertTrue((res == 200).all())
            d = F.diagnostic_masques(u2, lu)
            self.assertEqual(d['aire_u2'], 1.0)
            self.assertTrue(d['lucida_defaillant'])
        for forme in ((0, 5), (5, 0), (0, 0)):
            vide = np.zeros(forme, dtype=np.uint8)
            res = F.fusionner_alphas(vide, vide)
            self.assertEqual((res.shape, res.dtype), (forme, np.uint8))
            d = F.diagnostic_masques(vide, vide)                            # aucune division par zero
            self.assertEqual((d['aire_u2'], d['aire_lucida'], d['aire_union']), (0.0, 0.0, 0.0))
            self.assertFalse(d['lucida_defaillant'] or d['u2net_defaillant'])

    def test_proprietes_sur_tirages_aleatoires(self):
        rng = np.random.default_rng(12345)
        for k in range(120):
            forme = (int(rng.integers(1, 40)), int(rng.integers(1, 40)))
            u2 = rng.integers(0, 256, forme, dtype=np.uint8)
            lu = rng.integers(0, 256, forme, dtype=np.uint8)
            if k % 3 == 0:
                lu[rng.random(forme) < 0.7] = 0              # beaucoup de fond, comme un vrai masque
            seuil = int(rng.integers(0, 256)) if k % 2 else 127
            res = F.fusionner_alphas(u2, lu, seuil)
            self.assertTrue((res >= lu).all())                                   # jamais moins que Lucida
            self.assertTrue((res[u2 >= seuil] >= u2[u2 >= seuil]).all())         # jamais moins que u2net quand il est sur
            self.assertTrue((res <= np.maximum(u2, lu)).all())                   # rien d'invente
            self.assertTrue((res[(u2 < seuil)] == lu[(u2 < seuil)]).all())       # u2net ignore la ou il n'est pas sur
            # le masque binaire de l'union = union des masques binaires (ce que mesure le diagnostic au seuil 127)
            if seuil == 127:
                self.assertTrue(np.array_equal(res >= 127, (u2 >= 127) | (lu >= 127)))
                d = F.diagnostic_masques(u2, lu)
                self.assertAlmostEqual(d['aire_union'], float(np.mean(res >= 127)), places=12)

    def test_refuse_proprement_les_masques_invalides(self):
        bon = np.zeros((4, 4), dtype=np.uint8)
        mauvais = [
            ('liste', [[0] * 4] * 4), ('tuple', ((0,) * 4,) * 4), ('None', None), ('entier', 7), ('chaine', 'masque'),
            ('float32', np.zeros((4, 4), dtype=np.float32)), ('float64', np.zeros((4, 4))),
            ('int32', np.zeros((4, 4), dtype=np.int32)), ('int64', np.zeros((4, 4), dtype=np.int64)),
            ('bool', np.zeros((4, 4), dtype=bool)), ('uint16', np.zeros((4, 4), dtype=np.uint16)),
            ('1D', np.zeros(16, dtype=np.uint8)), ('3D (h, w, 1)', np.zeros((4, 4, 1), dtype=np.uint8)),
            ('3D (h, w, 3)', np.zeros((4, 4, 3), dtype=np.uint8)), ('0D', np.zeros((), dtype=np.uint8)),
        ]
        try:
            from PIL import Image
            mauvais.append(('image PIL', Image.new('L', (4, 4))))
        except ImportError:
            pass
        for nom, valeur in mauvais:
            with self.subTest(nom=nom, place='a_u2'):
                with self.assertRaises(ValueError) as c:
                    F.fusionner_alphas(valeur, bon)
                self.assertIn('a_u2', str(c.exception))
                with self.assertRaises(ValueError):
                    F.diagnostic_masques(valeur, bon)
            with self.subTest(nom=nom, place='a_lucida'):
                with self.assertRaises(ValueError) as c:
                    F.fusionner_alphas(bon, valeur)
                self.assertIn('a_lucida', str(c.exception))
                with self.assertRaises(ValueError):
                    F.diagnostic_masques(bon, valeur)

    def test_refuse_les_masques_qui_ne_sont_pas_2d_meme_quand_les_deux_se_ressemblent(self):
        # deux tableaux de MEME forme mais pas (hauteur, largeur) : seul le controle des dimensions les refuse (pas celui des formes)
        for forme in ((16,), (4, 4, 1), (2, 2, 3), (), (2, 3, 4, 5)):
            a = np.zeros(forme, dtype=np.uint8)
            for fonction in (F.fusionner_alphas, F.diagnostic_masques):
                with self.subTest(forme=forme, fonction=fonction.__name__):
                    with self.assertRaises(ValueError) as c:
                        fonction(a, a.copy())
                    self.assertIn('2 dimensions', str(c.exception))

    def test_refuse_les_formes_differentes(self):
        for forme_a, forme_b in (((4, 4), (4, 5)), ((4, 4), (5, 4)), ((4, 6), (6, 4)), ((1, 1), (1, 2))):
            a, b = np.zeros(forme_a, dtype=np.uint8), np.zeros(forme_b, dtype=np.uint8)
            for fonction in (F.fusionner_alphas, F.diagnostic_masques):
                with self.subTest(formes=(forme_a, forme_b), fonction=fonction.__name__):
                    with self.assertRaises(ValueError) as c:
                        fonction(a, b)
                    self.assertIn('forme', str(c.exception))

    def test_refuse_un_seuil_invalide(self):
        a = np.zeros((2, 2), dtype=np.uint8)
        for seuil in (-1, 256, 1000, 127.0, 1.5, '127', None, True, False, [127], np.float32(127)):
            with self.subTest(seuil=seuil):
                with self.assertRaises(ValueError) as c:
                    F.fusionner_alphas(a, a, seuil)
                self.assertIn('seuil_u2', str(c.exception))


class DiagnosticMasques(unittest.TestCase):
    CLES = {'aire_u2', 'aire_lucida', 'aire_union', 'u2net_manque', 'lucida_manque', 'lucida_defaillant', 'u2net_defaillant'}

    def test_cles_et_types_natifs(self):
        u2, lu = depuis_comptes(10, 10, 30, 40, 10)
        d = F.diagnostic_masques(u2, lu)
        self.assertEqual(set(d), self.CLES)
        for cle in ('aire_u2', 'aire_lucida', 'aire_union', 'u2net_manque', 'lucida_manque'):
            self.assertIs(type(d[cle]), float, cle)
        for cle in ('lucida_defaillant', 'u2net_defaillant'):
            self.assertIs(type(d[cle]), bool, cle)
        json.dumps(d)                                                            # serialisable tel quel (journaux, banc Modal)
        self.assertEqual((d['aire_u2'], d['aire_lucida'], d['aire_union']), (0.30, 0.40, 0.60))
        self.assertAlmostEqual(d['u2net_manque'], 30 / 40.0)                      # 30 pixels de Lucida hors u2net sur 40
        self.assertAlmostEqual(d['lucida_manque'], 20 / 30.0)                     # 20 pixels de u2net hors Lucida sur 30

    def test_cas_orc_la_mesure_du_banc(self):
        # orc_verif_t80 : u2net 16,3 % de l'image, Lucida 24,4 %, u2net manque 36,1 %, Lucida manque 4,5 % (planche_1.png)
        # image de 100 x 100 : u2net 1630 px, Lucida 2440 px, dont 1557 communs (donc 73 px que Lucida perd = 4,5 % de u2net)
        u2, lu = depuis_comptes(100, 100, 1630, 2440, 1557)
        d = F.diagnostic_masques(u2, lu)
        self.assertAlmostEqual(d['aire_u2'], 0.163)
        self.assertAlmostEqual(d['aire_lucida'], 0.244)
        self.assertAlmostEqual(d['u2net_manque'], 0.361, delta=0.002)
        self.assertAlmostEqual(d['lucida_manque'], 0.045, delta=0.002)
        self.assertTrue(d['u2net_defaillant'])                                    # 0,163 < 0,8 x 0,244 = 0,195
        self.assertFalse(d['lucida_defaillant'])
        self.assertAlmostEqual(d['aire_union'] / d['aire_lucida'], 1.03, places=2)  # « l'union vaut 1,03 x Lucida »
        res = F.fusionner_alphas(u2, lu)
        self.assertEqual(int((res >= 127).sum()), 2513)
        self.assertTrue((res[lu >= 127] == 255).all() and (res[u2 >= 127] == 255).all())   # l'arme (Lucida) ET le corps (u2net)

    def test_cas_ane_la_mesure_du_banc(self):
        # paire_04_ne : u2net 31,7 %, Lucida 5,9 %, Lucida manque 81,4 %, u2net manque ~0 (planche_3.png, ligne 1)
        u2, lu = depuis_comptes(100, 100, 3170, 590, 590)
        d = F.diagnostic_masques(u2, lu)
        self.assertAlmostEqual(d['lucida_manque'], 0.814, delta=0.002)
        self.assertEqual(d['u2net_manque'], 0.0)
        self.assertTrue(d['lucida_defaillant'])                                   # 0,059 < 0,5 x 0,317
        self.assertFalse(d['u2net_defaillant'])
        self.assertAlmostEqual(d['aire_union'] / d['aire_u2'], 1.00)              # « 1,00 x u2net »
        self.assertAlmostEqual(d['aire_union'] / d['aire_lucida'], 5.4, places=1)  # « 5,4 x Lucida »
        res = F.fusionner_alphas(u2, lu)
        self.assertTrue(np.array_equal(res >= 127, u2 >= 127))                    # le corps de l'ane est COMPLET : u2net seul

    def test_cas_mille_pattes_la_mesure_du_banc(self):
        # paire_27_centipade : u2net 16,7 %, Lucida 13,9 %, Lucida manque 16,5 % (un bout du corps)
        u2, lu = depuis_comptes(100, 100, 1670, 1395, 1395)
        d = F.diagnostic_masques(u2, lu)
        self.assertAlmostEqual(d['lucida_manque'], 0.165, delta=0.002)
        self.assertFalse(d['lucida_defaillant'])                                  # 0,1395 > 0,5 x 0,167 : pas « defaillant »
        self.assertFalse(d['u2net_defaillant'])
        self.assertAlmostEqual(d['aire_union'] / d['aire_u2'], 1.00)
        self.assertTrue(np.array_equal(F.fusionner_alphas(u2, lu) >= 127, u2 >= 127))   # le bout du corps vient de u2net

    def test_drapeaux_sur_les_aires_mesurees(self):
        # (nom, aire u2net, aire Lucida, u2net defaillant ?, Lucida defaillant ?) : chiffres de metriques.json du 03/10/2026
        mesures = [
            ('orc_verif_t80', 0.163, 0.244, True, False), ('ab_A_avant_2', 0.158, 0.249, True, False),
            # u2net y perd 21,7 % de ce que Lucida garde mais son AIRE reste a 81 % de celle de Lucida : pas « defaillant »
            # (le drapeau ne sert qu'au journal ; l'union, elle, recupere tout)
            ('ab_A_avant_1', 0.176, 0.217, False, False), ('ab_B_apres_0', 0.279, 0.291, False, False),
            ('ab_C_libre_0', 0.386, 0.383, False, False), ('paire_00_cochon', 0.306, 0.307, False, False),
            ('paire_02_truck', 0.555, 0.551, False, False), ('paire_04_ne', 0.317, 0.059, False, True),
            ('paire_27_centipade', 0.167, 0.139, False, False), ('paire_14_Rat', 0.123, 0.122, False, False),
        ]
        for nom, a_u2, a_lu, u2_def, lu_def in mesures:
            with self.subTest(image=nom):
                n_u2, n_lu = int(round(a_u2 * 10000)), int(round(a_lu * 10000))
                commun = min(n_u2, n_lu) // 2
                u2, lu = depuis_comptes(100, 100, n_u2, n_lu, commun)
                d = F.diagnostic_masques(u2, lu)
                self.assertEqual(d['u2net_defaillant'], u2_def)
                self.assertEqual(d['lucida_defaillant'], lu_def)

    def test_bornes_exactes_inegalite_stricte(self):
        # Lucida exactement a la moitie de u2net : PAS defaillant ; un pixel de moins : defaillant
        d = F.diagnostic_masques(*depuis_comptes(10, 10, 40, 20, 20))
        self.assertFalse(d['lucida_defaillant'])
        d = F.diagnostic_masques(*depuis_comptes(10, 10, 40, 19, 19))
        self.assertTrue(d['lucida_defaillant'])
        d = F.diagnostic_masques(*depuis_comptes(10, 10, 40, 21, 21))
        self.assertFalse(d['lucida_defaillant'])
        # u2net exactement a 80 % de Lucida : PAS defaillant ; un pixel de moins : defaillant
        d = F.diagnostic_masques(*depuis_comptes(10, 10, 40, 50, 40))
        self.assertFalse(d['u2net_defaillant'])
        d = F.diagnostic_masques(*depuis_comptes(10, 10, 39, 50, 39))
        self.assertTrue(d['u2net_defaillant'])
        d = F.diagnostic_masques(*depuis_comptes(10, 10, 41, 50, 41))
        self.assertFalse(d['u2net_defaillant'])

    def test_roles_symetriques(self):
        u2, lu = depuis_comptes(100, 100, 1630, 2440, 1557)
        d, inv = F.diagnostic_masques(u2, lu), F.diagnostic_masques(lu, u2)
        self.assertEqual(d['aire_u2'], inv['aire_lucida'])
        self.assertEqual(d['aire_lucida'], inv['aire_u2'])
        self.assertEqual(d['aire_union'], inv['aire_union'])
        self.assertEqual(d['u2net_manque'], inv['lucida_manque'])
        self.assertEqual(d['lucida_manque'], inv['u2net_manque'])

    def test_masques_identiques_ou_vides(self):
        u2, _ = depuis_comptes(10, 10, 30, 30, 30)
        d = F.diagnostic_masques(u2, u2.copy())
        self.assertEqual((d['u2net_manque'], d['lucida_manque']), (0.0, 0.0))
        self.assertFalse(d['lucida_defaillant'] or d['u2net_defaillant'])
        vide = np.zeros((10, 10), dtype=np.uint8)
        d = F.diagnostic_masques(vide, vide)
        self.assertEqual((d['aire_union'], d['u2net_manque'], d['lucida_manque']), (0.0, 0.0, 0.0))
        self.assertFalse(d['lucida_defaillant'] or d['u2net_defaillant'])
        d = F.diagnostic_masques(u2, vide)                                        # Lucida ne voit rien
        self.assertTrue(d['lucida_defaillant'])
        self.assertFalse(d['u2net_defaillant'])
        self.assertEqual((d['lucida_manque'], d['u2net_manque']), (1.0, 0.0))
        d = F.diagnostic_masques(vide, u2)                                        # u2net ne voit rien
        self.assertTrue(d['u2net_defaillant'])
        self.assertFalse(d['lucida_defaillant'])
        self.assertEqual((d['u2net_manque'], d['lucida_manque']), (1.0, 0.0))

    def test_le_seuil_de_mesure_est_127_inclus(self):
        u2 = np.full((2, 5), 126, dtype=np.uint8)
        lu = np.full((2, 5), 127, dtype=np.uint8)
        d = F.diagnostic_masques(u2, lu)
        self.assertEqual((d['aire_u2'], d['aire_lucida'], d['aire_union']), (0.0, 1.0, 1.0))
        self.assertEqual(F.SEUIL_SUJET, 127)
        self.assertEqual(F.SEUIL_U2_DEFAUT, 127)


class ModeDetourage(unittest.TestCase):

    def test_table_complete(self):
        table = [
            (None, 'union'), ('', 'union'), ('   ', 'union'), ('auto', 'union'), ('AUTO', 'union'), ('union', 'union'),
            ('Union', 'union'), (' union ', 'union'),
            ('u2net', 'u2net'), ('U2NET', 'u2net'), ('  U2Net ', 'u2net'), ('u2net\n', 'u2net'),
            ('lucida', 'lucida'), ('Lucida', 'lucida'), ('\tlucida ', 'lucida'),
            ('rembg', 'union'), ('u2', 'union'), ('lucida,u2net', 'union'), ('u2net lucida', 'union'), ('0', 'union'),
            ('1', 'union'), ('false', 'union'), ('none', 'union'), ('bizarre', 'union'),
        ]
        for valeur, attendu in table:
            with self.subTest(valeur=valeur):
                self.assertEqual(F.mode_detourage(valeur), attendu)

    def test_jamais_d_exception_et_toujours_un_mode_connu(self):
        class Piege(object):
            def __str__(self):
                raise RuntimeError('ne pas appeler')
            __repr__ = __str__

            def strip(self):
                raise RuntimeError('ne pas appeler')

        class ChaineHostile(str):
            def strip(self, *a):
                raise RuntimeError('strip hostile')

        for valeur in (3, 0, 1.5, True, False, b'u2net', bytearray(b'lucida'), ['u2net'], ('lucida',), {'u2net': 1}, object(),
                       Piege(), ChaineHostile('u2net'), float('nan'), np.uint8(3), np.array(['u2net'])):
            with self.subTest(valeur=type(valeur).__name__):
                r = F.mode_detourage(valeur)
                self.assertEqual(r, 'union')                                      # pas une chaine : le mode sur
                self.assertIn(r, F.MODES)

    def test_le_resultat_est_toujours_dans_modes(self):
        self.assertEqual(F.MODES, ('union', 'u2net', 'lucida'))
        for valeur in (None, '', 'auto', 'union', 'u2net', 'lucida', 'x', 'U2NET'):
            self.assertIn(F.mode_detourage(valeur), F.MODES)
            self.assertIs(type(F.mode_detourage(valeur)), str)


class ContratDuModule(unittest.TestCase):

    def test_uniquement_numpy(self):
        arbre = ast.parse(lire(SOURCE))
        modules = set()
        for n in ast.walk(arbre):
            if isinstance(n, ast.Import):
                modules |= {a.name.split('.')[0] for a in n.names}
            elif isinstance(n, ast.ImportFrom):
                modules.add((n.module or '').split('.')[0])
        self.assertEqual(modules, {'numpy'}, 'le noyau partage ne doit dependre que de numpy : %s' % sorted(modules))

    def test_pas_d_etat_global_modifiable(self):
        # aucune affectation `global` : le module est une bibliotheque de fonctions pures
        arbre = ast.parse(lire(SOURCE))
        self.assertFalse([n for n in ast.walk(arbre) if isinstance(n, ast.Global)])

    def test_api_publique(self):
        self.assertEqual(set(F.__all__), {'SEUIL_SUJET', 'SEUIL_U2_DEFAUT', 'MODES', 'fusionner_alphas', 'diagnostic_masques',
                                          'mode_detourage'})
        for nom in F.__all__:
            self.assertTrue(hasattr(F, nom), nom)

    def test_les_deux_copies_sont_identiques(self):
        # le garde build/check-noyaux-partages.mjs le verifie aussi ; ce test donne le message le plus direct
        a = lire(os.path.join(RACINE, 'scripts', 'fusion_masques.py'), newline='').replace('\r\n', '\n')
        b = lire(COPIE, newline='').replace('\r\n', '\n')
        self.assertEqual(a, b, 'modal_app/fusion_masques.py a diverge de scripts/fusion_masques.py : '
                               'node build/check-noyaux-partages.mjs --sync')

    def test_aucune_lettre_accentuee_dans_le_code(self):
        # style du depot : commentaires en francais SANS accents dans les .py
        for chemin in (SOURCE, COPIE):
            texte = lire(chemin)
            accentuees = sorted({c for c in texte if 0xC0 <= ord(c) <= 0xFF and ord(c) not in (0xD7, 0xF7)})   # hors signes multiplier / diviser
            self.assertEqual(accentuees, [], chemin)


if __name__ == '__main__':
    for flux in (sys.stdout, sys.stderr):
        try:
            flux.reconfigure(encoding='utf-8', errors='replace')
        except Exception:
            pass
    unittest.main()
