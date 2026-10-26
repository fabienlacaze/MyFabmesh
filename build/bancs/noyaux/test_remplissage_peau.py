# -*- coding: utf-8 -*-
"""Banc de Fill holes : TROUS DE PEAU (2026-10-26) — scripts/bouchage_peau.py (= modal_app/bouchage_peau.py).

POURQUOI. Un maillage TRELLIS est une pile de feuilles minces, sans arete de bord apres soudure (le detecteur d'aretes ne voit rien : « Nothing to
fill ») mais percee : on voit la feuille du dessous par des trous de la peau exterieure. Le noyau les cherche sur des cartes de profondeur.

Trois familles de tests.
 1. SYNTHETIQUES (toujours lances) : un trou rond dans un plan au-dessus d'un second plan (detecte, bouche, bouchon oriente vers l'observateur,
    rien d'autre touche) ; ce qui n'est PAS un trou (plan plein, creux de moins de 0,6 % de la diagonale, sphere fermee, creux a parois epaisses sans
    pli) ; la mesure du pli.
 2. BATEAU TRELLIS DE 497 616 FACES (saute si le fichier est absent ; variable FILL_PEAU_BATEAU, defaut C:/tmp/benchy/e6dc04bd64284e7aaeda9876331cbee8.glb ;
    jamais dans le depot, qui est public) : 0 arete de bord apres soudure, 25 801 aretes non manifold, une cinquantaine de trous de peau detectes et
    bouches, rien retire ni deplace, duree, et le BILAN CHIFFRE ecrit en JSON (variable FILL_PEAU_RAPPORT).
 3. PIKACHU TRELLIS DE 509 597 FACES (saute si absent ; FILL_PEAU_PIKACHU, defaut C:/tmp/pikachu.glb) : meme defaut de depart (0 arete de bord, 4 699
    non manifold, « Nothing to fill ») ; limite DOCUMENTEE : l'ouverture du ventre n'est pas un trou de peau (voir AGENT_LOG 2026-10-26), le banc
    verifie seulement ce que l'outil fait vraiment.

Lancer :  python build/bancs/noyaux/test_remplissage_peau.py -v
"""
import json
import os
import sys
import time
import unittest

import numpy as np

ICI = os.path.dirname(os.path.abspath(__file__))
RACINE = os.path.abspath(os.path.join(ICI, '..', '..', '..'))
for chemin in (os.path.join(RACINE, 'scripts'), ICI, RACINE):
    if chemin not in sys.path:
        sys.path.insert(0, chemin)

import trimesh  # noqa: E402

import bouchage_lisse as BL  # noqa: E402
import bouchage_peau as PE  # noqa: E402
import bouchage_trous as B  # noqa: E402

BATEAU = os.environ.get('FILL_PEAU_BATEAU', 'C:/tmp/benchy/e6dc04bd64284e7aaeda9876331cbee8.glb')
PIKACHU = os.environ.get('FILL_PEAU_PIKACHU', 'C:/tmp/pikachu.glb')
RAPPORT = os.environ.get('FILL_PEAU_RAPPORT', '')
MESURES = {}


# ---------------------------------------------------------------------------------------------------------------------------------------
# Maillages synthetiques
# ---------------------------------------------------------------------------------------------------------------------------------------
def grille(n, cote, z, centre=(0.0, 0.0), inverse=False, relief=None, trou=None):
    """Grille (n+1)^2 sommets sur [centre +- cote/2], hauteur z (ou relief(x, y) si donne), triangles CCW vus de +z (inverse : CW).
    trou = (cx, cy, r) : les faces dont le centre est dans le disque sont retirees."""
    xs = np.linspace(-cote / 2.0, cote / 2.0, n + 1)
    X, Y = np.meshgrid(xs + centre[0], xs + centre[1])
    Z = np.full(X.shape, float(z)) if relief is None else relief(X, Y)
    V = np.stack([X.ravel(), Y.ravel(), Z.ravel()], axis=1)
    F = []
    for j in range(n):
        for i in range(n):
            a = j * (n + 1) + i
            F.append([a, a + 1, a + n + 2])
            F.append([a, a + n + 2, a + n + 1])
    F = np.array(F, dtype=np.int64)
    if inverse:
        F = F[:, ::-1]
    if trou is not None:
        c = V[F].mean(axis=1)
        garde = (c[:, 0] - trou[0]) ** 2 + (c[:, 1] - trou[1]) ** 2 > trou[2] ** 2
        F = F[garde]
    return V, F


def assembler(*parties):
    V, F, base = [], [], 0
    for v, f in parties:
        V.append(v)
        F.append(f + base)
        base += len(v)
    return np.vstack(V), np.vstack(F)


def plan_perce(rayon=0.15, profondeur=0.15):
    """Une peau (plan z = 0, trou rond) au-dessus d'une seconde feuille (z = -profondeur) : on voit la seconde feuille par le trou."""
    haut = grille(60, 1.0, 0.0, trou=(0.0, 0.0, rayon))
    bas = grille(48, 1.6, -profondeur)
    return assembler(haut, bas)


def zone_de_mesures(V, F):
    prep = B.preparer(V, F)
    return prep


class Synthetiques(unittest.TestCase):
    def setUp(self):
        self._pli = PE.PLI_MIN
        PE.PLI_MIN = 0.0       # ces maillages de test n'ont pas de pli : la mesure du pli est testee a part

    def tearDown(self):
        PE.PLI_MIN = self._pli

    def test_trou_rond_detecte_et_bouche(self):
        V, F = plan_perce()
        prep = B.preparer(V, F)
        a = PE.analyse_peau(V, F, prep)
        self.assertEqual(a['a_boucher'], 1, 'un seul trou de peau attendu')
        b = a['boucles'][0]
        ring = V[np.asarray(b['debut'])]
        r = np.linalg.norm(ring[:, :2], axis=1)
        self.assertLess(abs(float(np.median(r)) - 0.15), 0.03, 'le pourtour doit etre le cercle du trou')
        res = BL.boucher(V, F, a, prep)
        Vn = np.vstack([V, res['sommets']])
        Fn = res['faces']
        aire = 0.5 * np.linalg.norm(np.cross(Vn[Fn[:, 1]] - Vn[Fn[:, 0]], Vn[Fn[:, 2]] - Vn[Fn[:, 0]]), axis=1)
        self.assertLess(abs(float(aire.sum()) - np.pi * 0.15 ** 2), 0.3 * np.pi * 0.15 ** 2, 'aire du bouchon ~ aire du disque')
        n = np.cross(Vn[Fn[:, 1]] - Vn[Fn[:, 0]], Vn[Fn[:, 2]] - Vn[Fn[:, 0]])
        n = n[np.linalg.norm(n, axis=1) > 1e-12]
        n /= np.linalg.norm(n, axis=1)[:, None]
        self.assertGreater(float(np.abs(n[:, 2]).min()), 0.5, 'bouchon quasi plan')
        self.assertTrue((n[:, 2] > 0).all() or (n[:, 2] < 0).all(), 'tous les triangles du bouchon ont la meme orientation')
        # le bouchon regarde l'observateur : comme la peau voisine (CCW vu de +z, donc normale +z)
        self.assertGreater(float(n[:, 2].mean()), 0.0, 'le bouchon doit etre oriente comme la peau (vers +z)')

    def test_sans_numba_meme_resultat(self):
        """Le rendu numpy (sans numba, cas du Python embarque s'il n'a pas numba) trouve le meme trou que le noyau numba."""
        V, F = plan_perce()
        prep = B.preparer(V, F)
        avec = PE.analyse_peau(V, F, prep)['a_boucher']
        ancien = PE._AVEC_NUMBA
        PE._AVEC_NUMBA = False
        try:
            fid1, zb1, _ = PE.zbuffer(V, F, np.array([0.0, 0.0, -1.0]), 256)
            sans = PE.analyse_peau(V, F, prep)['a_boucher']
        finally:
            PE._AVEC_NUMBA = ancien
        fid2, zb2, _ = PE.zbuffer(V, F, np.array([0.0, 0.0, -1.0]), 256)
        self.assertEqual(sans, avec)
        self.assertGreater(float(((fid1 >= 0) == (fid2 >= 0)).mean()), 0.995)

    def test_non_destructif(self):
        V, F = plan_perce()
        prep = B.preparer(V, F)
        a = PE.analyse_peau(V, F, prep)
        res = BL.boucher(V, F, a, prep)
        self.assertEqual(len(res['faces']) > 0, True)
        self.assertTrue((res['faces'] >= len(V)).all(), 'le bouchon ne reference que ses propres sommets (le pourtour est copie)')

    def test_plan_plein_pas_de_trou(self):
        V, F = assembler(grille(60, 1.0, 0.0), grille(48, 1.6, -0.15))
        a = PE.analyse_peau(V, F, B.preparer(V, F))
        self.assertEqual(a['a_boucher'], 0)

    def test_creux_trop_peu_profond(self):
        # trou de 0,15 de rayon mais la feuille du dessous est a 0,004 : moins de 0,6 % de la diagonale, ce n'est pas un trou
        V, F = plan_perce(profondeur=0.004)
        a = PE.analyse_peau(V, F, B.preparer(V, F))
        self.assertEqual(a['a_boucher'], 0)

    def test_sphere_fermee(self):
        m = trimesh.creation.icosphere(subdivisions=4)
        a = PE.analyse_peau(np.asarray(m.vertices), np.asarray(m.faces), B.preparer(np.asarray(m.vertices), np.asarray(m.faces)))
        self.assertEqual(a['a_boucher'], 0)

    def test_sans_pli_pas_un_trou_de_peau(self):
        """Un creux dont le pourtour n'est PAS un pli (parois epaisses : fenetre, hublot ; ici le bord franc d'un plan perce) n'est pas un trou de peau
        quand le critere du pli est actif ; sans ce critere le meme maillage donne un trou. C'est ce critere qui epargne fenetres et rambardes."""
        V, F = plan_perce()
        PE.PLI_MIN = 0.0
        avec = PE.analyse_peau(V, F, B.preparer(V, F))['a_boucher']
        PE.PLI_MIN = self._pli
        sans = PE.analyse_peau(V, F, B.preparer(V, F))['a_boucher']
        self.assertEqual(avec, 1)
        self.assertEqual(sans, 0)

    def test_mesure_du_pli(self):
        # deux triangles replies l'un sur l'autre (feuille sans epaisseur) : les sommets de l'arete commune sont a pli ; un plan : aucun
        V = np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]], dtype=float)
        V2 = V.copy()
        V2[3] = [0.5, 0.5, 0.0]
        prep = B.preparer(V2, np.array([[0, 1, 2], [1, 0, 3]]))
        flag = PE._sommets_a_pli(prep)
        self.assertTrue(bool(flag.any()), 'une arete a deux faces de normales opposees est un pli')
        plat = B.preparer(V, np.array([[0, 1, 2], [1, 3, 2]]))
        self.assertFalse(bool(PE._sommets_a_pli(plat).any()), 'un plan n a aucun pli')

    def test_cycle_sans_repetition(self):
        self.assertEqual([g for g, _ in PE._cycle_simple([(1, 10), (2, 20), (1, 11), (3, 30), (2, 21)])], [1, 2, 3])

    def test_contour(self):
        m = np.zeros((10, 10), dtype=bool)
        m[3:7, 3:7] = True
        pts = PE.contour(m)
        self.assertEqual(len(pts), 12, 'contour d un carre 4x4 : 12 pixels de bord')
        self.assertEqual(len(set(pts)), 12)


# ---------------------------------------------------------------------------------------------------------------------------------------
# Vrais maillages
# ---------------------------------------------------------------------------------------------------------------------------------------
def charger(chemin):
    sc = trimesh.load(chemin, process=False)
    if not hasattr(sc, 'geometry'):
        sc = trimesh.Scene(sc)
    return sc


def etat(g):
    V = np.asarray(g.vertices, dtype=np.float64)
    F = np.asarray(g.faces, dtype=np.int64)
    prep = B.preparer(V, F)
    c = prep['cnt']
    return {'faces': int(len(F)), 'aretes_de_bord': int((c == 1).sum()), 'aretes_non_manifold': int((c > 2).sum())}


def faire_tourner(chemin, peau=True):
    sc = charger(chemin)
    g0 = list(sc.geometry.values())[0]
    V0, F0 = np.asarray(g0.vertices).copy(), np.asarray(g0.faces).copy()
    UV0 = np.asarray(g0.visual.uv).copy() if hasattr(g0.visual, 'uv') and g0.visual.uv is not None else None
    avant = etat(g0)
    t = time.time()
    res = BL.boucher_scene(sc, 3, 2000, journal=lambda m: None, peau=peau)
    duree = time.time() - t
    return sc, res, avant, duree, V0, F0, UV0


@unittest.skipUnless(os.path.exists(BATEAU), 'bateau TRELLIS absent (%s)' % BATEAU)
class Bateau(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sc, cls.res, cls.avant, cls.duree, cls.V0, cls.F0, cls.UV0 = faire_tourner(BATEAU)
        cls.g1 = list(cls.sc.geometry.values())[0]
        cls.apres = etat(cls.g1)
        MESURES['bateau'] = {'avant': cls.avant, 'apres': cls.apres, 'duree_s': round(cls.duree, 1),
                             'stats': (cls.res.get('stats') or {}), 'refus': cls.res.get('refus')}

    def test_defaut_de_depart(self):
        self.assertEqual(self.avant['aretes_de_bord'], 0, 'aucune arete de bord apres soudure : le detecteur d aretes ne voit rien')
        self.assertGreater(self.avant['aretes_non_manifold'], 20000, 'double peau : des dizaines de milliers d aretes a plus de deux faces')

    def test_l_outil_ne_refuse_plus(self):
        self.assertIsNone(self.res['refus'], 'avant : « Nothing to fill » ; maintenant les trous de peau sont bouches')

    def test_trous_de_peau_bouches(self):
        n = self.res['stats']['skin_holes_filled']
        MESURES['bateau']['trous'] = n
        self.assertTrue(30 <= n <= 90, 'une cinquantaine de trous de peau attendus, %d trouves' % n)

    def test_ajout_borne(self):
        ajoutees = self.apres['faces'] - self.avant['faces']
        MESURES['bateau']['faces_ajoutees'] = ajoutees
        self.assertTrue(1000 < ajoutees < 0.06 * self.avant['faces'], 'les bouchons ajoutent peu : %d faces' % ajoutees)

    def test_rien_retire_ni_deplace(self):
        g = self.g1
        self.assertTrue(np.array_equal(np.asarray(g.faces)[:len(self.F0)], self.F0), 'faces hors trous inchangees')
        self.assertTrue(np.array_equal(np.asarray(g.vertices)[:len(self.V0)], self.V0), 'sommets inchanges')
        if self.UV0 is not None:
            self.assertTrue(np.array_equal(np.asarray(g.visual.uv)[:len(self.UV0)], self.UV0), 'UV inchangees')

    def test_aretes_non_manifold_et_de_bord(self):
        # le bouchon se soude sur les aretes du pli : ces aretes, deja a 2 faces, en portent 3 (la signature de la double peau, deja partout)
        avant, apres = self.avant['aretes_non_manifold'], self.apres['aretes_non_manifold']
        MESURES['bateau']['nm_avant_apres'] = [avant, apres]
        self.assertLess(apres, avant * 1.2, 'les aretes non manifold ne doivent pas exploser : %d -> %d' % (avant, apres))
        MESURES['bateau']['bord_apres'] = self.apres['aretes_de_bord']
        self.assertLess(self.apres['aretes_de_bord'], 1500, 'fissures residuelles (pourtour non route sur des aretes) : %d' % self.apres['aretes_de_bord'])

    def test_duree(self):
        self.assertLess(self.duree, 90.0, 'cible : moins de 60 s sur 500 000 faces ; garde-fou du banc 90 s (machine chargee) : %.0f s' % self.duree)


MOISSONNEUSE = os.environ.get('FILL_HOLES_GLB', 'C:/tmp/moissonneuse.glb')


class SansLOption(unittest.TestCase):
    """DECISION DU USER : la reparation de peau est une OPTION decochee par defaut. Sans elle, Fill holes ne change RIEN pour un maillage sain ou en
    double peau : « Nothing to fill » comme avant, aucune recherche (donc rien de lent), le maillage n'est pas touche."""

    def _sans(self, chemin):
        sc = charger(chemin)
        t = time.time()
        res = BL.boucher_scene(sc, 3, 2000, journal=lambda m: None)           # peau=False par defaut
        return sc, res, time.time() - t

    def test_defaut_faux(self):
        import inspect
        self.assertIs(inspect.signature(BL.boucher_scene).parameters['peau'].default, False)

    @unittest.skipUnless(os.path.exists(BATEAU), 'bateau absent')
    def test_bateau_refus_qui_propose_la_case(self):
        sc, res, duree = self._sans(BATEAU)
        self.assertIsNotNone(res['refus'])
        code, texte = res['refus']
        self.assertEqual(code, 'fill_holes_closed_nonmanifold')
        self.assertIn('Also repair holes in the outer skin', texte)
        self.assertLess(duree, 15.0, 'aucune recherche de peau : quelques secondes')
        MESURES.setdefault('sans_option', {})['bateau_s'] = round(duree, 1)

    @unittest.skipUnless(os.path.exists(MOISSONNEUSE), 'moissonneuse absente')
    def test_moissonneuse_saine_inchangee(self):
        sc, res, duree = self._sans(MOISSONNEUSE)
        self.assertIsNotNone(res['refus'], 'plus aucun bouchon sur la moissonneuse saine')
        self.assertIsNone(res['stats'])
        self.assertLess(duree, 15.0)
        MESURES.setdefault('sans_option', {})['moissonneuse_s'] = round(duree, 1)
        MESURES['sans_option']['moissonneuse_refus'] = res['refus'][0]

    @unittest.skipUnless(os.path.exists(BATEAU), 'bateau absent')
    def test_detection_seule(self):
        sc = charger(BATEAU)
        g0 = list(sc.geometry.values())[0]
        F0 = np.asarray(g0.faces).copy()
        t = time.time()
        d = BL.detecter_peau_scene(sc, 3, 5000, journal=lambda m: None)
        duree = time.time() - t
        MESURES.setdefault('detection_seule', {})['bateau'] = {'trous': d['nombre'], 'duree_s': round(duree, 1)}
        self.assertTrue(30 <= d['nombre'] <= 90)
        self.assertEqual(d['nombre'], len(d['trous']))
        h = d['trous'][0]
        for cle in ('n', 'centre', 'normale', 'rayon', 'points', 'maillage'):
            self.assertIn(cle, h)
        self.assertEqual(len(h['points']), h['n'])
        self.assertAlmostEqual(sum(x * x for x in h['normale']), 1.0, places=3)
        json.dumps(d)                                                        # exportable tel quel
        self.assertTrue(np.array_equal(np.asarray(list(sc.geometry.values())[0].faces), F0), 'la detection ne modifie rien')

    def test_cli_cinquieme_argument(self):
        """mesh_tools.py fill_holes <in> <out> 3 2000 0 : le 5e argument existe, l'appel a 4 arguments reste valide."""
        import inspect
        sys.path.insert(0, os.path.join(RACINE, 'scripts'))
        import mesh_tools
        params = inspect.signature(mesh_tools.fill_holes).parameters
        self.assertIn('skin_repair', params)
        self.assertEqual(params['skin_repair'].default, 0)
        self.assertEqual(list(params)[:4], ['input_path', 'output_path', 'min_hole_size', 'max_hole_size'])
        self.assertIn('detect_skin', open(os.path.join(RACINE, 'scripts', 'mesh_tools.py'), encoding='utf-8').read())


@unittest.skipUnless(os.path.exists(PIKACHU), 'Pikachu TRELLIS absent (%s)' % PIKACHU)
class Pikachu(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sc, cls.res, cls.avant, cls.duree, cls.V0, cls.F0, cls.UV0 = faire_tourner(PIKACHU)
        cls.g1 = list(cls.sc.geometry.values())[0]
        cls.apres = etat(cls.g1)
        MESURES['pikachu'] = {'avant': cls.avant, 'apres': cls.apres, 'duree_s': round(cls.duree, 1),
                              'stats': (cls.res.get('stats') or {}), 'refus': cls.res.get('refus')}

    def test_defaut_de_depart(self):
        self.assertEqual(self.avant['aretes_de_bord'], 0)
        self.assertGreater(self.avant['aretes_non_manifold'], 4000)

    def test_ce_que_l_outil_fait(self):
        # Limite documentee : l'ouverture du ventre n'est pas un trou de peau (bordee par des parties du corps a des profondeurs differentes, sans
        # peau continue autour) ; l'outil bouche les quelques vrais trous de peau et le dit, sans rien retirer.
        self.assertIsNone(self.res['refus'])
        n = self.res['stats']['skin_holes_filled']
        self.assertTrue(1 <= n <= 30, '%d trous de peau' % n)
        self.assertLess(self.apres['faces'] - self.avant['faces'], 0.01 * self.avant['faces'])
        self.assertTrue(np.array_equal(np.asarray(self.g1.faces)[:len(self.F0)], self.F0))
        self.assertTrue(np.array_equal(np.asarray(self.g1.vertices)[:len(self.V0)], self.V0))
        self.assertLess(self.duree, 90.0)


def ecrire_rapport(_=None):
    if RAPPORT and MESURES:
        os.makedirs(os.path.dirname(RAPPORT) or '.', exist_ok=True)
        with open(RAPPORT, 'w', encoding='utf-8') as f:
            json.dump(MESURES, f, indent=1, ensure_ascii=False, default=str)


if __name__ == '__main__':
    try:
        unittest.main(exit=False)
    finally:
        ecrire_rapport()
