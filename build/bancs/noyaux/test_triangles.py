"""Test de l'outil Triangle count (constat E-3b, 2026-10-03).

Defauts mesures par la campagne des outils 3D :
  - plancher silencieux de 1 % (ratio = max(0.01, ...)) : viser 1 000 faces sur ~496 000 donnait 4 960 ;
  - la texture de 4096 ou 8192 etait ramenee a 2048 sans prevenir.
Ce test lance l'outil du BUREAU (scripts/mesh_tools.py::decimate) et celui du WEB
(modal_app/_mesh_op.py::decimate) sur une sphere texturee a coutures UV de ~82 000 faces et une
texture 4096, avec des cibles inferieures a 1 % (500 = 0,6 %, 400 = 0,5 %). Exige : cible atteinte a 5 %
pres et taille de texture conservee.

Lancer :  <python de l'appli> build/bancs/noyaux/test_triangles.py -v
Autres copies pour prouver l'echec sur l'ancien code : NOYAU_MESH_TOOLS, NOYAU_MESH_OP.
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
sys.path.insert(0, os.path.join(RACINE, "scripts"))

MESH_TOOLS = os.environ.get('NOYAU_MESH_TOOLS') or os.path.join(RACINE, 'scripts', 'mesh_tools.py')
MESH_OP = os.environ.get('NOYAU_MESH_OP') or os.path.join(RACINE, 'modal_app', '_mesh_op.py')
TEXTURE = 4096
CIBLES = (500, 400)


def charger(chemin, nom):
    spec = importlib.util.spec_from_file_location(nom, chemin)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


class TestTriangleCount(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import trimesh
        cls.trimesh = trimesh
        cls.tmp = tempfile.TemporaryDirectory()
        cls.sphere = M.sphere_texturee(subdivisions=6, taille_texture=TEXTURE)
        cls.entree = os.path.join(cls.tmp.name, 'entree.glb')
        cls.sphere.export(cls.entree)
        cls.faces0 = len(cls.sphere.faces)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def _verifier(self, g, cible, etiquette):
        n = len(g.faces)
        self.assertLessEqual(abs(n - cible) / cible, 0.05,
                             '%s : %d faces pour une cible de %d (plancher silencieux ?)' % (etiquette, n, cible))
        tex = g.visual.material.baseColorTexture
        self.assertIsNotNone(tex, etiquette + ' : texture perdue')
        self.assertEqual(max(tex.size), TEXTURE, '%s : texture %s au lieu de %d' % (etiquette, tex.size, TEXTURE))

    def test_bureau(self):
        mt = charger(MESH_TOOLS, 'mesh_tools_sous_test')
        for cible in CIBLES:
            sortie = os.path.join(self.tmp.name, 'sortie_bureau_%d.glb' % cible)
            mt.decimate(self.entree, sortie, cible)
            g = list(self.trimesh.load(sortie).geometry.values())[0]
            self._verifier(g, cible, 'bureau')

    def test_web(self):
        mo = charger(MESH_OP, 'mesh_op_sous_test')
        with open(self.entree, 'rb') as f:
            octets = f.read()
        for cible in CIBLES:
            res = mo.decimate(octets, target_faces=cible)
            g = list(self.trimesh.load(io.BytesIO(res), file_type='glb').geometry.values())[0]
            self._verifier(g, cible, 'web')

    def test_web_demande_la_taille_d_origine(self):
        """Le web n'a pas toujours meshoptimizer dans l'environnement de test : on verifie donc aussi, avec un
        enregistreur, que la reduction + recuisson est appelee SANS imposer 2048 (taille=None = d'origine)."""
        import modal_app.acceleration_glb as acc
        appels = []
        reel = acc.reduire_et_recuire

        def enregistreur(m, cible, taille=2048, log=print):
            appels.append(taille)
            return m
        acc.reduire_et_recuire = enregistreur
        try:
            mo = charger(MESH_OP, 'mesh_op_sous_test2')
            with open(self.entree, 'rb') as f:
                octets = f.read()
            mo.decimate(octets, target_faces=500)
        finally:
            acc.reduire_et_recuire = reel
        self.assertEqual(len(appels), 1)
        self.assertIsNone(appels[0], 'taille imposee : %r' % (appels[0],))

    def test_bureau_demande_la_taille_d_origine(self):
        import acceleration_glb as acc
        appels = []
        reel = acc.reduire_et_recuire

        def enregistreur(m, cible, taille=2048, log=print):
            appels.append((cible, taille))
            return m
        acc.reduire_et_recuire = enregistreur
        try:
            mt = charger(MESH_TOOLS, 'mesh_tools_sous_test2')
            acc = sys.modules['acceleration_glb']
            acc.reduire_et_recuire = enregistreur
            mt.decimate(self.entree, os.path.join(self.tmp.name, 'sortie_enreg.glb'), 500)
        finally:
            acc.reduire_et_recuire = reel
        self.assertEqual(len(appels), 1)
        self.assertEqual(appels[0][0], 500)
        self.assertIsNone(appels[0][1], 'taille imposee : %r' % (appels[0][1],))


if __name__ == '__main__':
    unittest.main()
