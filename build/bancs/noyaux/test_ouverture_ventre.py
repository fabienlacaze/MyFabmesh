# -*- coding: utf-8 -*-
"""Banc de Fill holes : GRANDES OUVERTURES vers la cavite (2026-10-26) — scripts/bouchage_ouverture.py (= modal_app/bouchage_ouverture.py).

POURQUOI. Le Pikachu TRELLIS de l'utilisateur (509 597 faces) a le bas du ventre OUVERT : on voit l'interieur du corps par une grande ouverture, sans
peau continue autour. Aucune arete de bord apres soudure (« Nothing to fill »), et ce n'est pas un trou de peau (bouchage_peau.py : un trou ENTOURE d'une
peau continue). Le noyau lance des rayons depuis la cavite : ceux qui s'echappent dessinent l'ouverture.

Trois familles.
 1. SYNTHETIQUES (toujours lances) : une coque a DEUX feuilles (comme TRELLIS : peau exterieure + peau interieure, reliees au pourtour) percee d'une
    calotte : detectee, pourtour ferme, bouchee (taux de fuite ~0, bouchon vers l'exterieur, prefixe des faces intact) ; une coque fermee : rien ;
    sans la case (`ouverture=False`) rien n'est cherche.
 2. PIKACHU (saute si absent ; FILL_OUVERTURE_PIKACHU, defaut C:/tmp/pikachu.glb ; jamais dans le depot, qui est public) : l'ouverture du ventre est
    detectee (boucle fermee de sommets reels), bouchee, plus aucun rayon ne s'echappe dans le cone du ventre, prefixe des faces et sommets intact, moins
    de 60 s. LIMITE DOCUMENTEE : une seconde ouverture (le bas du dos, au pied de la queue) reste : son pourtour saute d'une piece a l'autre, refusee.
 3. NON-REGRESSION (sautee si absente) : le bateau (FILL_PEAU_BATEAU) ne donne AUCUNE ouverture et ses 30 trous de peau restent bouches ; la
    moissonneuse (FILL_OUVERTURE_MOISSON, defaut C:/tmp/benchy/moiss_avant.glb) ne recoit aucun voile diagonal (pourtours a sauts refuses).

Lancer :  python build/bancs/noyaux/test_ouverture_ventre.py -v
"""
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
import bouchage_ouverture as OU  # noqa: E402
import bouchage_trous as B  # noqa: E402

PIKACHU = os.environ.get('FILL_OUVERTURE_PIKACHU', 'C:/tmp/pikachu.glb')
BATEAU = os.environ.get('FILL_PEAU_BATEAU', 'C:/tmp/benchy/e6dc04bd64284e7aaeda9876331cbee8.glb')
MOISSON = os.environ.get('FILL_OUVERTURE_MOISSON', 'C:/tmp/benchy/moiss_avant.glb')


def coque_double(angle_calotte_deg=None, rayon=1.0, epaisseur=0.03, sub=4):
    """Deux icospheres (normales vers l'exterieur / vers l'interieur) ; si un angle est donne, la calotte polaire (+z) est retiree des DEUX feuilles
    et leurs pourtours sont reunis par une bande (0 arete de bord : une coque percee, comme les maillages TRELLIS)."""
    ext = trimesh.creation.icosphere(subdivisions=sub, radius=rayon)
    V = np.vstack([ext.vertices, ext.vertices * (rayon - epaisseur) / rayon])
    n = len(ext.vertices)
    F = np.vstack([ext.faces, ext.faces[:, ::-1] + n])
    if angle_calotte_deg is None:
        return V, F
    seuil = rayon * np.cos(np.radians(angle_calotte_deg))
    garde = V[F].mean(axis=1)[:, 2] / np.linalg.norm(V[F].mean(axis=1), axis=1) * rayon < seuil
    F = F[garde]
    # aretes de bord de chaque feuille -> bande
    e = np.vstack([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    cle = np.sort(e, axis=1)
    u, inv, cnt = np.unique(cle, axis=0, return_inverse=True, return_counts=True)
    bord = e[cnt[inv.reshape(-1)] == 1]
    bande = []
    for a, b in bord:
        if a < n and b < n:                       # arete de la feuille exterieure
            bande.append([a, b, b + n])
            bande.append([a, b + n, a + n])
    F = np.vstack([F, np.array(bande, dtype=np.int64)])
    return V, F


def fuite(V, F, c, nb=8000):
    gr = OU.grille(V, F)
    D = OU._fibonacci(nb)
    t, f = OU.lancer(gr, np.tile(c, (nb, 1)), D)
    return float((f < 0).mean()), D[f < 0]


class TestSynthetique(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not OU._AVEC_NUMBA:
            raise unittest.SkipTest('numba absent')
        cls.V, cls.F = coque_double(35.0)
        cls.prep = B.preparer(cls.V, cls.F)

    def test_pas_d_arete_de_bord(self):
        self.assertEqual(int((self.prep['cnt'] == 1).sum()), 0)

    def test_ouverture_detectee_pourtour_ferme(self):
        trous, rap = OU.detecter(self.V, self.F, self.prep, 3, 5000)
        self.assertEqual(len(trous), 1, rap)
        h = trous[0]
        ring = np.asarray(h['debut'])
        self.assertGreaterEqual(h['n'], 40)
        self.assertEqual(len(set(int(self.prep['groupe'][v]) for v in ring)), len(ring), 'boucle sans sommet repete')
        P = self.V[ring]
        ang = np.degrees(np.arccos(np.clip(P[:, 2] / np.linalg.norm(P, axis=1), -1, 1)))
        self.assertTrue(np.all(np.abs(ang - 35.0) < 6.0), 'le pourtour borde la calotte retiree (35 degres) : %s' % np.round([ang.min(), ang.max()], 1))
        # boucle FERMEE : deux voisins consecutifs ne sont jamais a plus de quelques aretes l'un de l'autre
        cordes = np.linalg.norm(P - np.roll(P, -1, axis=0), axis=1)
        self.assertLess(cordes.max(), 6 * self.prep['arete_moyenne'] + 1e-9)
        # le cone regarde vers +z (l'exterieur de l'ouverture)
        self.assertGreater(float(h['direction'] @ np.array([0, 0, 1.0])), 0.95)

    def test_bouchage_ferme_la_fuite(self):
        avant, _ = fuite(self.V, self.F, np.zeros(3))
        self.assertGreater(avant, 0.05)
        scene = trimesh.Scene(trimesh.Trimesh(self.V.copy(), self.F.copy(), process=False))
        res = BL.boucher_scene(scene, 3, 5000, journal=lambda m: None, ouverture=True)
        self.assertIsNone(res['refus'])
        self.assertEqual(res['stats']['large_openings_filled'], 1)
        self.assertEqual(res['stats']['skin_holes_filled'], 0)
        g = list(scene.geometry.values())[0]
        V1, F1 = np.asarray(g.vertices), np.asarray(g.faces)
        self.assertTrue(np.array_equal(F1[:len(self.F)], self.F), 'aucune face d\'entree touchee')
        self.assertTrue(np.array_equal(V1[:len(self.V)], self.V), 'aucun sommet deplace')
        apres, _ = fuite(V1, F1, np.zeros(3))
        self.assertLess(apres, 0.01, 'taux de fuite avant %.3f apres %.3f' % (avant, apres))
        # le bouchon regarde l'exterieur et reste sur la sphere (pas de pic)
        neuf = F1[len(self.F):]
        N = np.cross(V1[neuf[:, 1]] - V1[neuf[:, 0]], V1[neuf[:, 2]] - V1[neuf[:, 0]])
        C = V1[neuf].mean(axis=1)
        self.assertGreater(float(((N * C).sum(axis=1) > 0).mean()), 0.9)
        r = np.linalg.norm(V1[len(self.V):], axis=1)
        self.assertTrue(np.all(r < 1.05) and np.all(r > 0.9), (r.min(), r.max()))

    def test_sans_la_case_rien_n_est_cherche(self):
        scene = trimesh.Scene(trimesh.Trimesh(self.V.copy(), self.F.copy(), process=False))
        res = BL.boucher_scene(scene, 3, 5000, journal=lambda m: None, ouverture=False)
        self.assertIsNotNone(res['refus'])
        self.assertEqual(len(list(scene.geometry.values())[0].faces), len(self.F))

    def test_coque_fermee_aucune_ouverture(self):
        V, F = coque_double(None)
        trous, rap = OU.detecter(V, F, B.preparer(V, F), 3, 5000)
        self.assertEqual(len(trous), 0, rap)

    def test_petit_trou_n_est_pas_une_grande_ouverture(self):
        V, F = coque_double(8.0)             # calotte de 8 degres : un petit jour, pas une ouverture d'anatomie
        trous, _ = OU.detecter(V, F, B.preparer(V, F), 3, 5000)
        self.assertEqual(len(trous), 0)

    def test_taille_maximale_relative(self):
        trous, _ = OU.detecter(self.V, self.F, self.prep, 3, 5000, max_relatif=0.10)
        self.assertEqual(len(trous), 0, 'au-dela de max_relatif de la diagonale : pas une ouverture proposee')


def _charger(chemin):
    s = trimesh.load(chemin, force='scene', process=False)
    return s, list(s.geometry.values())[0]


@unittest.skipUnless(os.path.exists(PIKACHU), 'pikachu.glb absent (jamais dans le depot public)')
class TestPikachu(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not OU._AVEC_NUMBA:
            raise unittest.SkipTest('numba absent')

    def test_ventre_detecte_bouche(self):
        scene, g = _charger(PIKACHU)
        V0, F0 = np.asarray(g.vertices, dtype=np.float64), np.asarray(g.faces, dtype=np.int64)
        prep = B.preparer(V0, F0)
        self.assertEqual(int((prep['cnt'] == 1).sum()), 0, 'aucune arete de bord apres soudure (le cas de depart)')
        trous, rap = OU.detecter(V0, F0, prep, 3, 5000)
        self.assertEqual(len(trous), 1, rap)
        h = trous[0]
        ring = np.asarray(h['debut'])
        P = V0[ring]
        self.assertGreaterEqual(h['n'], 100)
        self.assertEqual(len(set(int(prep['groupe'][v]) for v in ring)), len(ring))
        diag = float(np.linalg.norm(V0.max(0) - V0.min(0)))
        self.assertTrue(0.2 < h['etendue'] < 0.4, h['etendue'])
        self.assertLess(float(np.linalg.norm(P.mean(0) - np.array([-0.075, -0.216, 0.22]))), 0.1 * diag, 'ouverture a l\'avant du bas du ventre')
        self.assertGreater(float(h['direction'][2]), 0.5, 'le cone regarde vers l\'avant (+z)')
        t0 = time.time()
        res = BL.boucher_scene(scene, 3, 2000, journal=lambda m: None, ouverture=True)
        duree = time.time() - t0
        self.assertIsNone(res['refus'])
        self.assertEqual(res['stats']['large_openings_filled'], 1)
        g1 = list(scene.geometry.values())[0]
        V1, F1 = np.asarray(g1.vertices), np.asarray(g1.faces)
        self.assertTrue(np.array_equal(F1[:len(F0)], F0), 'prefixe des faces intact')
        self.assertTrue(np.array_equal(V1[:len(V0)], V0), 'sommets intacts')
        self.assertLess(duree, 60.0)
        # plus aucun rayon ne s'echappe dans le cone du ventre
        c = np.array([-0.0388, -0.2189, 0.0751])
        gr0, gr1 = OU.grille(V0, F0), OU.grille(V1, F1)
        D = OU._fibonacci(20000)
        dans = D @ h['direction'] > np.cos(np.radians(25))
        e0 = (OU.lancer(gr0, np.tile(c, (len(D), 1)), D)[1] < 0) & dans
        e1 = (OU.lancer(gr1, np.tile(c, (len(D), 1)), D)[1] < 0) & dans
        self.assertGreater(int(e0.sum()), 500)
        self.assertLess(int(e1.sum()), 0.02 * int(e0.sum()), 'le cone du ventre est ferme (%d -> %d rayons)' % (e0.sum(), e1.sum()))
        # pas de pic : le bouchon reste dans la boite de l'original
        neuf = V1[len(V0):]
        self.assertTrue(np.all(neuf > V0.min(0) - 0.02 * diag) and np.all(neuf < V0.max(0) + 0.02 * diag))


@unittest.skipUnless(os.path.exists(BATEAU), 'bateau absent')
class TestBateau(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not OU._AVEC_NUMBA:
            raise unittest.SkipTest('numba absent')

    def test_aucune_ouverture(self):
        _, g = _charger(BATEAU)
        V, F = np.asarray(g.vertices, dtype=np.float64), np.asarray(g.faces, dtype=np.int64)
        trous, rap = OU.detecter(V, F, B.preparer(V, F), 3, 2000)
        self.assertEqual(len(trous), 0, rap)


@unittest.skipUnless(os.path.exists(MOISSON), 'moissonneuse absente')
class TestMoissonneuse(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not OU._AVEC_NUMBA:
            raise unittest.SkipTest('numba absent')

    def test_pas_de_voile_diagonal(self):
        _, g = _charger(MOISSON)
        V, F = np.asarray(g.vertices, dtype=np.float64), np.asarray(g.faces, dtype=np.int64)
        trous, rap = OU.detecter(V, F, B.preparer(V, F), 3, 2000)
        for h in trous:
            P = V[h['debut']]
            ch = np.linalg.norm(P - np.roll(P, -1, axis=0), axis=1)
            self.assertLessEqual(float(ch.max()), OU.SAUT_CORDE_MAX * float(np.median(ch)) + 1e-9)
            self.assertLessEqual(float((ch > 5 * np.median(ch)).mean()), OU.SAUT_PART_MAX + 1e-9)


if __name__ == '__main__':
    unittest.main()
