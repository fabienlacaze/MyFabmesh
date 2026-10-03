"""Test de Smooth sur un maillage a COUTURES UV (constat E-3a/E-3c, 2026-10-03).

Defaut mesure par la campagne des outils 3D : sur un maillage texture, merge_vertices ne soude rien (UV
differents le long des coutures), donc chaque ilot etait lisse comme une surface ouverte et le maillage
se dechirait (33 composantes -> 3 279 ; aretes de bord 0 -> 19 379). Ce test fabrique une sphere
texturee a coutures, la lisse par le BUREAU (scripts/mesh_tools.py::smooth) et par le WEB
(modal_app/_mesh_op.py::smooth), et exige : composantes et aretes de bord (maillage soude par position)
INCHANGEES, doubles de couture restes confondus, UV intactes, vraie action du lissage.

Lancer :  <python de l'appli> build/bancs/noyaux/test_smooth.py -v
Autres copies pour prouver l'echec sur l'ancien code : NOYAU_MESH_TOOLS, NOYAU_MESH_OP (git show HEAD:...).
"""
import importlib.util
import io
import os
import sys
import tempfile
import unittest

import numpy as np

ICI = os.path.dirname(os.path.abspath(__file__))
RACINE = os.path.abspath(os.path.join(ICI, '..', '..', '..'))
sys.path.insert(0, ICI)
sys.path.insert(0, RACINE)
import _maillages as M  # noqa: E402

MESH_TOOLS = os.environ.get('NOYAU_MESH_TOOLS') or os.path.join(RACINE, 'scripts', 'mesh_tools.py')
MESH_OP = os.environ.get('NOYAU_MESH_OP') or os.path.join(RACINE, 'modal_app', '_mesh_op.py')


def charger(chemin, nom):
    spec = importlib.util.spec_from_file_location(nom, chemin)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def doubles_de_couture(g):
    """Paires de sommets confondus a l'origine : retourne les groupes d'indices (taille >= 2)."""
    _, _, inv = M.souder(g)
    ordre = np.argsort(inv, kind='stable')
    tri = inv[ordre]
    debuts = np.flatnonzero(np.r_[True, tri[1:] != tri[:-1]])
    fins = np.r_[debuts[1:], len(tri)]
    return [ordre[d:f] for d, f in zip(debuts, fins) if f - d >= 2]


def ecart_max_coutures(g, groupes):
    V = np.asarray(g.vertices, np.float64)
    ecart = 0.0
    for idx in groupes:
        p = V[idx]
        ecart = max(ecart, float(np.abs(p - p[0]).max()))
    return ecart


class TestSmoothCoutures(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import trimesh
        cls.trimesh = trimesh
        cls.sphere = M.sphere_texturee(subdivisions=4)
        cls.tmp = tempfile.TemporaryDirectory()
        cls.entree = os.path.join(cls.tmp.name, 'entree.glb')
        cls.sphere.export(cls.entree)
        scene = trimesh.load(cls.entree)
        cls.g0 = list(scene.geometry.values())[0]
        cls.comp0, cls.bord0 = M.topologie(cls.g0)
        cls.groupes0 = doubles_de_couture(cls.g0)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_le_maillage_de_depart_a_bien_des_coutures(self):
        self.assertGreater(len(self.groupes0), 50, 'le banc doit contenir des sommets dupliques')
        self.assertEqual((self.comp0, self.bord0), (1, 0))
        self.assertEqual(len(self.g0.vertices) > len(M.souder(self.g0)[0]), True)

    def _verifier(self, g1):
        comp1, bord1 = M.topologie(g1)
        self.assertEqual(comp1, self.comp0, 'le lissage a fragmente le maillage (composantes)')
        self.assertEqual(bord1, self.bord0, 'le lissage a ouvert des aretes de bord')
        self.assertLess(ecart_max_coutures(g1, self.groupes0), 1e-6, 'les doubles de couture se sont separes')
        # le lissage agit vraiment (la sphere se resserre) et sans valeurs aberrantes
        V0 = np.asarray(self.g0.vertices)
        V1 = np.asarray(g1.vertices)
        self.assertTrue(np.isfinite(V1).all())
        self.assertGreater(float(np.abs(V1 - V0).max()), 0.0)
        self.assertLess(float(np.abs(V1 - V0).max()), 0.2)
        # UV et texture intactes
        self.assertTrue(np.allclose(np.asarray(g1.visual.uv), np.asarray(self.g0.visual.uv)))
        self.assertIsNotNone(g1.visual.material.baseColorTexture)

    def test_bureau(self):
        mt = charger(MESH_TOOLS, 'mesh_tools_sous_test')
        sortie = os.path.join(self.tmp.name, 'sortie_bureau.glb')
        mt.smooth(self.entree, sortie, 3, 0.5)
        g1 = list(self.trimesh.load(sortie).geometry.values())[0]
        self._verifier(g1)

    def test_web(self):
        mo = charger(MESH_OP, 'mesh_op_sous_test')
        with open(self.entree, 'rb') as f:
            octets = f.read()
        res = mo.smooth(octets, iterations=3, lamb=0.5)
        g1 = list(self.trimesh.load(io.BytesIO(res), file_type='glb').geometry.values())[0]
        self._verifier(g1)


if __name__ == '__main__':
    unittest.main()
