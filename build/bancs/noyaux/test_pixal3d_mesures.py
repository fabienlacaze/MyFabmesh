"""Test des mesures objectives de GLB du banc Pixal3D (modal_app/exp_pixal3d_mesures.py, 2026-10-15).

Les mesures servent a COMPARER des moteurs d'image vers 3D sur des nombres et pas sur une impression : un defaut de la regle
fausserait la comparaison sans que rien ne le signale. Chaque test cible donc un piege deja rencontre au projet (CLAUDE.md, section 5) :

  - sans soudure par position, un maillage a coutures d'UV parait en plusieurs morceaux (composantes), et en soudant on retrouve UN corps ;
  - une couverture d'atlas calculee sur toute l'image dilue la mesure dans le vide noir : les statistiques de texture sont restreintes aux texels couverts ;
  - les trous, les fragments, les triangles retournes (normales adjacentes opposees) sont comptes ;
  - l'alignement de silhouette retient le bon repere (un objet decale a droite dans le GLB doit se retrouver a gauche de l'image : x_w = -x') ;
  - le recadrage de l'entree reproduit celui du modele (carre x 1,1 autour du sujet).

Lancer :  <python de l'appli> build/bancs/noyaux/test_pixal3d_mesures.py -v
Pour prouver l'echec sur une version fautive : NOYAU_MESURES=<copie modifiee de exp_pixal3d_mesures.py>.
"""
import importlib.util
import io
import math
import os
import struct
import sys
import unittest

import numpy as np

ICI = os.path.dirname(os.path.abspath(__file__))
RACINE = os.path.abspath(os.path.join(ICI, '..', '..', '..'))
sys.path.insert(0, ICI)
import _maillages as M  # noqa: E402

CHEMIN = os.environ.get('NOYAU_MESURES') or os.path.join(RACINE, 'modal_app', 'exp_pixal3d_mesures.py')


def charger():
    spec = importlib.util.spec_from_file_location('exp_pixal3d_mesures_sous_test', CHEMIN)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


MES = charger()


def sphere(sub=4, ilots=4, taille=256):
    g = M.sphere_texturee(subdivisions=sub, taille_texture=taille, ilots=ilots)
    return np.asarray(g.vertices, np.float64), np.asarray(g.faces, np.int64), g


class TestTopologie(unittest.TestCase):
    def test_soudure_par_position_coutures_uv(self):
        """Sphere fermee dont les sommets sont dupliques aux coutures d'UV : 1 seul corps, 0 arete de bord, une fois soudee."""
        V, F, _ = sphere()
        brut = MES.topologie(V, F, souder_avant=False)
        soude = MES.topologie(V, F)
        self.assertGreater(brut['composantes'], 1, 'le piege des coutures n existe plus dans le maillage de test')
        self.assertEqual(soude['composantes'], 1, 'sans soudure par position, un corps unique parait en %d morceaux' % brut['composantes'])
        self.assertEqual(soude['aretes_de_bord'], 0)
        self.assertEqual(soude['boucles_de_bord'], 0)
        self.assertLess(soude['sommets_soudes'], soude['sommets_fichier'])
        self.assertEqual(soude['euler'], 2, 'sphere fermee : caracteristique d Euler 2')
        self.assertAlmostEqual(soude['plus_grande_composante_part_faces'], 1.0)

    def test_trou_compte(self):
        V, F, _ = sphere()
        # retire les faces autour du premier sommet (un trou polygonal)
        Vw, Fw, diag = MES.souder(V, F)
        centre = Vw[Fw[0, 0]]
        d = np.linalg.norm(Vw[Fw].mean(axis=1) - centre, axis=1)
        garde = d > np.sort(d)[6]
        res = MES.topologie(Vw, Fw[garde])
        self.assertEqual(res['boucles_de_bord'], 1)
        self.assertGreaterEqual(res['aretes_de_bord'], 3)
        self.assertEqual(res['composantes'], 1)

    def test_fragments(self):
        V, F, _ = sphere(sub=3)
        V2 = np.concatenate([V, V * 0.1 + 5.0])
        F2 = np.concatenate([F, F + len(V)])
        res = MES.topologie(V2, F2)
        self.assertEqual(res['composantes'], 2)
        self.assertAlmostEqual(res['plus_grande_composante_part_faces'], 0.5, places=3)
        # un fragment minuscule (un eventail de 5 faces) est signale comme miette
        n0 = len(V)
        eventail = np.array([[n0, n0 + 1 + i, n0 + 2 + i] for i in range(5)])
        V3 = np.concatenate([V, np.random.default_rng(1).random((7, 3)) + 9.0])
        F3 = np.concatenate([F, eventail])
        res3 = MES.topologie(V3, F3)
        self.assertEqual(res3['composantes'], 2)
        self.assertEqual(res3['composantes_moins_de_100_faces'], 1)

    def test_normales_opposees(self):
        V, F, _ = sphere()
        sain = MES.topologie(V, F)
        self.assertEqual(sain['pct_aire_normales_opposees'], 0.0)
        F2 = F.copy()
        F2[:40] = F2[:40][:, ::-1]                      # 40 triangles retournes
        faux = MES.topologie(V, F2)
        self.assertGreater(faux['pct_aire_normales_opposees'], 1.0)

    def test_arete_etiree(self):
        V, F, _ = sphere(sub=3)
        V2 = V.copy()
        V2[0] += np.array([10.0, 0, 0])                 # un sommet tire tres loin : aretes etirees
        res = MES.topologie(V2, F)
        self.assertGreaterEqual(res['aretes_sup_5pct_diag'], 3)
        self.assertGreater(res['arete_max_rel_diag'], 0.5)


class TestAtlas(unittest.TestCase):
    def test_couverture(self):
        # deux triangles couvrant le quart superieur gauche de l'atlas : couverture ~ 0,25
        uv = np.array([[0.0, 1.0], [0.5, 1.0], [0.5, 0.5], [0.0, 0.5]])
        f = np.array([[0, 1, 2], [0, 2, 3]])
        c = MES.couverture_atlas(uv, f, 512)
        self.assertAlmostEqual(float(c.mean()), 0.25, delta=0.01)
        self.assertTrue(c[:250, :250].all() and not c[300:, 300:].any())

    def test_stats_restreintes_aux_texels_couverts(self):
        """Une texture blanche sur les texels couverts et noire ailleurs : la luminance mesuree est ~255, pas ~64."""
        from PIL import Image
        uv = np.array([[0.0, 1.0], [0.5, 1.0], [0.5, 0.5], [0.0, 0.5]])
        f = np.array([[0, 1, 2], [0, 2, 3]])
        c = MES.couverture_atlas(uv, f, 256)
        img = np.zeros((256, 256, 4), np.uint8)
        img[:128, :128] = 255
        res = MES.stats_texture(Image.fromarray(img), None, c)
        self.assertGreater(res['luminance_moyenne'], 240.0, 'statistique diluee par le vide noir de l atlas')
        self.assertLess(res['part_texels_quasi_noirs'], 0.05)

    def test_metal_degenere(self):
        from PIL import Image
        m = np.ones((64, 64), bool)
        mr = np.zeros((64, 64, 3), np.uint8)
        mr[..., 1] = 230                                 # rugosite 0,9
        mr[..., 2] = 240                                 # metal 0,94
        res = MES.stats_texture(None, Image.fromarray(mr), m)
        self.assertAlmostEqual(res['part_metal_et_rugosite_sup_80pct'], 1.0)
        self.assertAlmostEqual(res['metal_moyen'], 240 / 255, places=3)


class TestEntree(unittest.TestCase):
    def test_recadrage_carre_x_1_1(self):
        from PIL import Image
        a = np.zeros((400, 400, 4), np.uint8)
        a[100:300, 150:250, :3] = 200                    # sujet 100 de large x 200 de haut
        a[100:300, 150:250, 3] = 255
        m = MES.masque_entree(Image.fromarray(a), 512)
        ys, xs = np.nonzero(m)
        self.assertAlmostEqual((ys.max() - ys.min() + 1) / 512.0, 200 / 220.0, delta=0.02)     # carre = 200 x 1,1 = 220
        self.assertAlmostEqual((xs.max() - xs.min() + 1) / 512.0, 100 / 220.0, delta=0.02)
        self.assertAlmostEqual((ys.max() + ys.min()) / 2.0 / 512.0, 0.5, delta=0.02)           # centre

    def test_entete_glb_webp(self):
        _, _, g = sphere(sub=2)
        brut = g.export(file_type='glb')
        webp = g.export(file_type='glb', extension_webp=True)
        self.assertNotIn('EXT_texture_webp', MES.entete_glb(brut)['extensions_utilisees'])
        e = MES.entete_glb(webp)
        self.assertIn('EXT_texture_webp', e['extensions_utilisees'])
        self.assertEqual(e['n_materiaux'], 1)


class TestAlignement(unittest.TestCase):
    CAM = {'camera_angle_x': 0.35, 'distance': 3.2, 'mesh_scale': 1.0}

    def _disque(self, x_w, z_w, r, taille=512):
        d, fov = self.CAM['distance'], self.CAM['camera_angle_x']
        f = (16.0 / math.tan(fov / 2.0)) * taille / 32.0
        cx = f * x_w / d + taille / 2.0
        cy = -f * z_w / d + taille / 2.0
        rr = f * r / d
        yy, xx = np.mgrid[0:taille, 0:taille]
        return (xx + 0.5 - cx) ** 2 + (yy + 0.5 - cy) ** 2 <= rr ** 2

    def test_repere_primaire_confirme(self):
        """Une sphere decalee de +0,2 en x' dans le GLB est a x_w = -0,2 : a GAUCHE du centre de l'image."""
        import trimesh
        s = trimesh.creation.icosphere(subdivisions=3, radius=0.15)
        V = np.asarray(s.vertices, np.float64) + np.array([0.2, 0.1, 0.0])       # (x', y', z') du GLB
        F = np.asarray(s.faces, np.int64)
        masque = self._disque(-0.2, 0.1, 0.15)
        res = MES.alignement(V, F, self.CAM, masque)
        self.assertGreater(res['iou_repere_primaire'], 0.9)
        self.assertTrue(res['derivation_confirmee'])
        self.assertLess(res['candidats']["miroir x (x', z', y')"]['iou'], 0.1, 'le miroir doit etre rejete')
        self.assertLess(res['boite_projetee'][2], 256, 'objet attendu a gauche de l image')

    def test_repere_inverse_detecte(self):
        """Si l'entree est a DROITE alors que le GLB est decale en +x', la derivation primaire n'est plus la meilleure : signale."""
        import trimesh
        s = trimesh.creation.icosphere(subdivisions=3, radius=0.15)
        V = np.asarray(s.vertices, np.float64) + np.array([0.2, 0.1, 0.0])
        F = np.asarray(s.faces, np.int64)
        masque = self._disque(+0.2, 0.1, 0.15)
        res = MES.alignement(V, F, self.CAM, masque)
        self.assertFalse(res['derivation_confirmee'])
        self.assertEqual(res['repere_retenu'], "miroir x (x', z', y')")


class TestBoutEnBout(unittest.TestCase):
    def test_mesurer_glb(self):
        _, _, g = sphere(sub=4, taille=512)
        octets = g.export(file_type='glb', extension_webp=True)
        r = MES.mesurer_glb(octets)
        self.assertEqual(r['topologie']['composantes'], 1)
        self.assertEqual(r['topologie']['aretes_de_bord'], 0)
        self.assertEqual(r['materiau']['taille_base_couleur'], [512, 512])
        self.assertTrue(0.2 < r['atlas']['couverture'] <= 1.0)
        self.assertIn('luminance_moyenne', r['texture'])
        self.assertNotIn('alignement_entree', r)
        self.assertEqual(r['octets'], len(octets))
        import json
        json.dumps(r)                                   # tout est serialisable


if __name__ == '__main__':
    unittest.main()
