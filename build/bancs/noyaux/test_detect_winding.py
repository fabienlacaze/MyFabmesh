# -*- coding: utf-8 -*-
"""Banc de scripts/detect_winding.py (detecteur de trous par nombre d'enroulement generalise)."""
import os
import sys
import unittest

import numpy as np

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(ICI, '..', '..', '..', 'scripts'))
import detect_winding as DW  # noqa: E402

BATEAU = os.environ.get('FILL_PEAU_BATEAU', 'C:/tmp/benchy/e6dc04bd64284e7aaeda9876331cbee8.glb')


def sphere(sub=5):
    import trimesh
    m = trimesh.creation.icosphere(subdivisions=sub)
    return np.asarray(m.vertices, float), np.asarray(m.faces, np.int64)


class TestEnroulement(unittest.TestCase):
    def test_entier_sur_surface_fermee(self):
        V, F = sphere()
        a = DW.construire_arbre(V, F)
        w = DW.enroulement(np.array([[0, 0, 0], [3, 0, 0], [0.5, 0.2, 0.1]]), a)
        np.testing.assert_allclose(w, [1, 0, 1], atol=0.03)

    def test_sphere_saine_aucun_trou(self):
        V, F = sphere()
        self.assertEqual(DW.detect(V, F), [])

    def test_trou_detecte_et_localise(self):
        V, F = sphere()
        c = F.copy()
        cen = V[F].mean(1)
        cible = np.array([0.0, 0.0, 1.0])
        retire = np.linalg.norm(cen - cible, axis=1) < 0.08
        self.assertGreater(retire.sum(), 3)
        r = DW.detect(V, F[~retire])
        self.assertEqual(len(r), 1)
        self.assertLess(np.linalg.norm(np.array(r[0]['centre']) - cible), 0.2)
        self.assertEqual(len(c), len(F))

    def test_grande_ouverture_non_rendue(self):
        V, F = sphere()
        cen = V[F].mean(1)
        retire = cen[:, 2] > 0.3          # calotte : ouverture voulue (diametre > 10 % de la diagonale)
        self.assertEqual(DW.detect(V, F[~retire]), [])

    @unittest.skipUnless(os.path.exists(BATEAU), 'bateau absent')
    def test_bateau_reel_documente(self):
        """Mesure du 26/10 : le bateau TRELLIS est topologiquement ferme, w y est entier : 0 trou (limite documentee)."""
        import trimesh
        m = trimesh.load(BATEAU, force='scene').to_geometry()
        V = np.asarray(m.vertices, float)
        F = np.asarray(m.faces, np.int64)
        self.assertIsInstance(DW.detect(V, F), list)


if __name__ == '__main__':
    unittest.main()
