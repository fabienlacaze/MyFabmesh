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
        """Metal 0,94 partout ; moitie haute rugueuse (0,9) = degenere ; moitie basse polie (0,16) = vrai metal, a epargner.
        Une regle « metal OU rugueux » compterait 100 % au lieu de 50 % et condamnerait les objets reellement metalliques."""
        from PIL import Image
        m = np.ones((64, 64), bool)
        mr = np.zeros((64, 64, 3), np.uint8)
        mr[..., 2] = 240                                 # metal 0,94 partout
        mr[:32, :, 1] = 230                              # rugosite 0,9 (moitie haute)
        mr[32:, :, 1] = 40                               # rugosite 0,16 (moitie basse)
        res = MES.stats_texture(None, Image.fromarray(mr), m)
        self.assertAlmostEqual(res['part_metal_sup_80pct'], 1.0)
        self.assertAlmostEqual(res['part_metal_et_rugosite_sup_80pct'], 0.5, msg='la regle exige metal ET rugosite eleves simultanement')
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


class TestOrientation(unittest.TestCase):
    """Vers quel cote regarde un GLB ? Le comparateur cote a cote n'a de sens que si les deux modeles regardent du meme cote (camera synchronisee) ;
    la mesure compare le masque d'entree a la silhouette orthographique ajustee dans les deux sens du miroir."""

    @staticmethod
    def masque_asymetrique():
        """Disque (rayon 120) + « bras » a DROITE et AU-DESSUS du centre de l'image 512 x 512 (asymetrique dans les deux axes)."""
        import cv2
        m = np.zeros((512, 512), np.uint8)
        cv2.circle(m, (256, 256), 120, 255, -1)
        cv2.rectangle(m, (330, 196), (470, 246), 255, -1)
        return m > 0

    @staticmethod
    def maillage_asymetrique(face_a_moins_z=True):
        """Sphere (rayon 120) + boite. Image a droite = -x' quand on regarde depuis -Z : le bras est donc a x' dans [-214, -74] (y' dans [10, 60]).
        face_a_moins_z=False : le meme modele reflete en x' (il regarde alors vers +Z)."""
        import trimesh
        s = trimesh.creation.icosphere(subdivisions=3, radius=120.0)
        b = trimesh.creation.box(extents=[140.0, 50.0, 50.0])
        b.apply_translation([-144.0, 35.0, 0.0])
        m = trimesh.util.concatenate([s, b])
        V = np.asarray(m.vertices, np.float64).copy()
        if not face_a_moins_z:
            V[:, 0] = -V[:, 0]
        return V, np.asarray(m.faces, np.int64)

    def test_modele_qui_regarde_vers_moins_z(self):
        V, F = self.maillage_asymetrique(True)
        r = MES.orientation(V, F, self.masque_asymetrique())
        self.assertEqual(r['regarde'], '-Z')
        self.assertGreater(r['iou_droite_moins_x'], 0.93, 'la silhouette ajustee doit recouvrir le masque')
        self.assertLess(r['iou_droite_plus_x'], r['iou_droite_moins_x'] - 0.05)
        self.assertAlmostEqual(r['iou_silhouette_ajustee'], r['iou_droite_moins_x'])

    def test_modele_qui_regarde_vers_plus_z(self):
        V, F = self.maillage_asymetrique(False)
        r = MES.orientation(V, F, self.masque_asymetrique())
        self.assertEqual(r['regarde'], '+Z')
        self.assertGreater(r['iou_droite_plus_x'], 0.93)
        self.assertLess(r['iou_droite_moins_x'], r['iou_droite_plus_x'] - 0.05)

    def test_silhouette_symetrique_est_indeterminee(self):
        import cv2
        import trimesh
        m = np.zeros((512, 512), np.uint8)
        cv2.circle(m, (256, 256), 120, 255, -1)
        s = trimesh.creation.icosphere(subdivisions=3, radius=120.0)
        r = MES.orientation(np.asarray(s.vertices, np.float64), np.asarray(s.faces, np.int64), m > 0)
        self.assertEqual(r['regarde'], 'indetermine', 'un disque est identique dans son miroir : aucun verdict ne doit etre rendu')
        self.assertLess(r['ecart'], 0.02)

    def test_la_boite_de_la_silhouette_est_ajustee_a_celle_du_masque(self):
        # le meme modele deux fois plus grand et decale donne la meme silhouette : l'ajustement est uniforme et centre
        V, F = self.maillage_asymetrique(True)
        masque = self.masque_asymetrique()
        a = MES.silhouette_orthographique(V, F, -1.0, masque)
        b = MES.silhouette_orthographique(V * 2.0 + np.array([30.0, -10.0, 5.0]), F, -1.0, masque)
        ys, xs = np.nonzero(masque)
        for m in (a, b):
            yy, xx = np.nonzero(m)
            self.assertLessEqual(abs(int(xx.min()) - int(xs.min())), 2)
            self.assertLessEqual(abs(int(xx.max()) - int(xs.max())), 2)
            self.assertLessEqual(abs(int(yy.min()) - int(ys.min())), 2)
            self.assertLessEqual(abs(int(yy.max()) - int(ys.max())), 2)
        self.assertGreater(float((a & b).sum()) / float((a | b).sum()), 0.98)

    @staticmethod
    def decaler_et_mettre_a_l_echelle(masque, echelle, dx, dy):
        import cv2
        m = np.array([[echelle, 0.0, 256.0 - echelle * 256.0 + dx], [0.0, echelle, 256.0 - echelle * 256.0 + dy]], np.float32)
        return cv2.warpAffine(masque.astype(np.uint8), m, (masque.shape[1], masque.shape[0]), flags=cv2.INTER_NEAREST) > 0

    def test_iou_optimise_retrouve_un_decalage_et_une_echelle(self):
        a = self.masque_asymetrique()
        self.assertAlmostEqual(MES.iou_optimise(a, a), 1.0, places=3)
        b = self.decaler_et_mettre_a_l_echelle(a, 1.0, 11, -9)
        self.assertLess(MES._iou(a, b), 0.9, 'le decalage de test doit etre sensible')
        self.assertGreater(MES.iou_optimise(a, b), 0.99, 'un decalage de 11 x 9 px est dans la plage de recherche (12 px)')
        c = self.decaler_et_mettre_a_l_echelle(a, 1.03, 0, 0)
        self.assertGreater(MES.iou_optimise(a, c), 0.97, 'une echelle de 1,03 est dans la plage essayee')

    def test_iou_optimise_ne_corrige_pas_un_decalage_hors_plage(self):
        a = self.masque_asymetrique()
        loin = self.decaler_et_mettre_a_l_echelle(a, 1.0, 40, 0)
        self.assertLess(MES.iou_optimise(a, loin), 0.8, 'au-dela de 12 px, la recherche ne doit pas inventer une correspondance')

    def test_iou_optimise_entrees_vides(self):
        vide = np.zeros((512, 512), bool)
        self.assertEqual(MES.iou_optimise(vide, self.masque_asymetrique()), 0.0)
        self.assertEqual(MES.iou_optimise(self.masque_asymetrique(), vide), 0.0)

    def test_verdict_stable_quand_la_boite_du_masque_est_faussee(self):
        """Un point parasite a 28 px du disque elargit la boite du masque : l'ajustement de boite seul retrecit la silhouette de ~8 %. La recherche d'echelle et de
        decalage rattrape l'essentiel (IoU 0,87 -> 0,98) sans changer le verdict ; le sens inverse reste loin derriere."""
        V, F = self.maillage_asymetrique(True)
        parasite = self.masque_asymetrique()
        parasite[253:260, 108:114] = True
        r = MES.orientation(V, F, parasite)
        self.assertEqual(r['regarde'], '-Z')
        simple = MES._iou(MES.silhouette_orthographique(V, F, -1.0, parasite), parasite)
        self.assertGreater(r['iou_droite_moins_x'], simple + 0.05, 'la recherche doit apporter quelque chose quand la boite est faussee')
        self.assertGreater(r['iou_droite_moins_x'], 0.95)
        self.assertLess(r['iou_droite_plus_x'], 0.7)
        V2, F2 = self.maillage_asymetrique(False)
        self.assertEqual(MES.orientation(V2, F2, parasite)['regarde'], '+Z')

    def test_bout_en_bout_dans_mesurer_glb(self):
        """Avec une entree et SANS camera : orientation mesuree, pas d'alignement perspectif ; avec camera : les deux."""
        from PIL import Image
        import trimesh
        V, F = self.maillage_asymetrique(True)
        octets = trimesh.Trimesh(vertices=V, faces=F, process=False).export(file_type='glb')
        rgba = np.zeros((512, 512, 4), np.uint8)
        rgba[..., :3] = 180
        rgba[..., 3] = self.masque_asymetrique().astype(np.uint8) * 255
        entree = Image.fromarray(rgba)
        sans_camera = MES.mesurer_glb(octets, entree)
        self.assertEqual(sans_camera['orientation']['regarde'], '-Z')
        self.assertNotIn('alignement_entree', sans_camera)
        avec_camera = MES.mesurer_glb(octets, entree, {'camera_angle_x': 0.35, 'distance': 900.0, 'mesh_scale': 1.0})
        self.assertEqual(avec_camera['orientation']['regarde'], '-Z')
        self.assertIn('alignement_entree', avec_camera)
        self.assertNotIn('orientation', MES.mesurer_glb(octets), 'sans entree, aucune mesure liee a l entree')
        import json
        json.dumps(avec_camera)


if __name__ == '__main__':
    unittest.main()
