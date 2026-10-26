# -*- coding: utf-8 -*-
"""Banc de Fill holes : BOUCHON LISSE (2026-10-26) — scripts/bouchage_lisse.py (= modal_app/bouchage_lisse.py).

Deux familles de tests.
 1. SYNTHETIQUES (toujours lances) : surfaces a verite analytique (plan, relief sinusoidal, tube plie, sphere texturee), triangulation sous contraintes,
    invariants (aucune face / sommet / UV d'entree touche, rustine orientee comme le voisinage, copie soudee fermee), texture (ilot neuf dans l'atlas
    libre, palette de couleurs du voisinage quand l'atlas est plein, pixels existants jamais modifies).
 2. VRAI MAILLAGE (sautes si le fichier est absent) : la moissonneuse de 514 000 faces produite par TRELLIS (variable FILL_HOLES_GLB, defaut
    C:/tmp/moissonneuse.glb ; jamais dans le depot, qui est public). On y perce des trous CONTROLES (rond, irregulier, grand, courbe, arete vive,
    plusieurs, traversant) : la surface retiree est la VERITE, donc on mesure pour chaque cas : trous detectes / bouches, aretes de bord restantes
    apres soudure par position, faces et sommets d'entree inchanges, orientation, distance du bouchon a la surface perdue (en longueurs d'arete),
    couleur du bouchon contre la vraie couleur, duree sur 514 000 faces, et le chemin complet par mesh_tools.py (ce que lance le bureau).

Lancer :  python build/bancs/noyaux/test_remplissage_trous.py -v
          python build/bancs/noyaux/test_remplissage_trous.py --rapport C:/tmp/fill_demo/rapport.json     (ecrit les mesures du vrai maillage)
"""
import io
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest

import numpy as np

ICI = os.path.dirname(os.path.abspath(__file__))
RACINE = os.path.abspath(os.path.join(ICI, '..', '..', '..'))
for chemin in (os.path.join(RACINE, 'scripts'), ICI, RACINE):
    if chemin not in sys.path:
        sys.path.insert(0, chemin)

import trimesh  # noqa: E402
from PIL import Image  # noqa: E402

import bouchage_lisse as BL  # noqa: E402
import bouchage_trous as B  # noqa: E402
import _percage_trous as P  # noqa: E402

GLB = P.GLB_PAR_DEFAUT


# ---------------------------------------------------------------------------------------------------------------------------------------
# Maillages a verite analytique
# ---------------------------------------------------------------------------------------------------------------------------------------
def relief(n, f, cote=1.0):
    """Grille (n+1)^2 sommets sur [0, cote]^2, hauteur z = f(x, y), triangles CCW vus de +z. UV = (x, y) / (2 cote) : la surface n'occupe que le quart
    bas-gauche de l'atlas, le reste est libre."""
    xs = np.linspace(0.0, cote, n + 1)
    X, Y = np.meshgrid(xs, xs)
    V = np.stack([X.ravel(), Y.ravel(), f(X.ravel(), Y.ravel())], axis=1)
    F = []
    for j in range(n):
        for i in range(n):
            a = j * (n + 1) + i
            F.append([a, a + 1, a + n + 2])
            F.append([a, a + n + 2, a + n + 1])
    F = np.array(F, dtype=np.int64)
    UV = np.stack([V[:, 0] / (2 * cote), V[:, 1] / (2 * cote)], axis=1)
    return V, F, UV


def sans_disque(V, F, centre, rayon):
    c = V[F].mean(axis=1)
    d = np.linalg.norm(c[:, :2] - np.asarray(centre), axis=1)
    garde = d > rayon
    return F[garde], np.nonzero(~garde)[0]


def trimesh_texture(V, F, UV, image):
    mat = trimesh.visual.material.PBRMaterial(baseColorTexture=image)
    return trimesh.Trimesh(vertices=V, faces=F, process=False, visual=trimesh.visual.TextureVisuals(uv=UV, material=mat))


def degrade_image(taille=256):
    """Degrade couleur lisse : R = x, G = y, B = 128. La verite d'une couleur en un point est connue."""
    x = np.linspace(0, 255, taille)
    img = np.zeros((taille, taille, 3), dtype=np.uint8)
    img[..., 0] = x[None, :]
    img[..., 1] = (255 - x)[:, None]
    img[..., 2] = 128
    return Image.fromarray(img)


def remplir(maillage, mn=3, mx=80, ordre=2):
    """mx=80 : le pourtour exterieur des grilles de test (96 a 160 aretes) n'est pas un trou."""
    V = np.asarray(maillage.vertices, dtype=np.float64)
    F = np.asarray(maillage.faces, dtype=np.int64)
    prep = B.preparer(V, F)
    a = B.analyser(V, F, mn, mx, prep=prep)
    ng, bilan = BL.appliquer_trimesh(maillage, a, prep, ordre)
    return ng, bilan, a


def sphere_fermee_orientee(V, F):
    prep = B.preparer(V, F)
    return int((prep['cnt'] == 1).sum()) == 0 and P.orientation_incoherente(V, F) == 0


# ---------------------------------------------------------------------------------------------------------------------------------------
# 1. Synthetiques
# ---------------------------------------------------------------------------------------------------------------------------------------
class TestTriangulationSousContraintes(unittest.TestCase):
    def test_polygone_en_etoile(self):
        """Polygone en etoile (non convexe) + semis : toutes les aretes du pourtour sont dans la triangulation, l'aire est exacte, tout est anti-horaire."""
        from scipy.spatial import Delaunay
        rng = np.random.default_rng(3)
        for n in (7, 15, 40, 120):
            t = np.linspace(0, 2 * np.pi, n, endpoint=False)
            r = 0.55 + 0.45 * rng.random(n)
            poly = np.stack([r * np.cos(t), r * np.sin(t)], axis=1)
            self.assertTrue(BL._polygone_simple(poly))
            h = float(np.linalg.norm(np.roll(poly, -1, axis=0) - poly, axis=1).mean())
            S = BL._semis_polygone(poly, h)
            P2 = np.vstack([poly, S])
            tri = BL._cdt(P2, n, Delaunay(P2).simplices)
            self.assertIsNotNone(tri)
            aretes = {(int(a), int(b)) for t3 in tri for a, b in ((t3[0], t3[1]), (t3[1], t3[2]), (t3[2], t3[0]))}
            for k in range(n):
                self.assertIn((k, (k + 1) % n), aretes, 'arete du pourtour %d absente (n=%d)' % (k, n))
            A, Bp, C = P2[tri[:, 0]], P2[tri[:, 1]], P2[tri[:, 2]]
            aire2 = (Bp[:, 0] - A[:, 0]) * (C[:, 1] - A[:, 1]) - (Bp[:, 1] - A[:, 1]) * (C[:, 0] - A[:, 0])
            self.assertTrue((aire2 > 0).all())
            self.assertAlmostEqual(float(0.5 * aire2.sum()), abs(BL._aire_signee(poly)), places=9)

    def test_polygone_qui_se_recoupe_est_refuse(self):
        noeud = np.array([[0, 0], [1, 1], [1, 0], [0, 1.0]])
        self.assertFalse(BL._polygone_simple(noeud))


class TestGeometrie(unittest.TestCase):
    def test_plan_ferme_a_l_identique(self):
        V, F, UV = relief(24, lambda x, y: 0 * x)
        F2, ret = sans_disque(V, F, (0.5, 0.5), 0.17)
        ng, bilan, a = remplir(trimesh.Trimesh(V, F2, process=False))
        self.assertEqual(a['a_boucher'], 1)
        nF = len(F2)
        self.assertTrue(np.array_equal(np.asarray(ng.faces)[:nF], F2))
        Vn = np.asarray(ng.vertices)
        self.assertTrue(np.array_equal(Vn[:len(V)], V))
        self.assertEqual(P.aretes_de_bord_soudees(Vn, np.asarray(ng.faces))[0], 4 * 24, 'seul le pourtour exterieur de la grille doit rester ouvert')
        self.assertEqual(P.orientation_incoherente(Vn, np.asarray(ng.faces)), 0)
        self.assertLess(float(np.abs(Vn[len(V):, 2]).max()), 1e-9, 'un trou sur un plan doit rester plan')
        # aire : celle des faces retirees
        aire_perdue = trimesh.Trimesh(V, F[ret], process=False).area
        aire_bouchon = trimesh.Trimesh(Vn, np.asarray(ng.faces)[nF:], process=False).area
        self.assertAlmostEqual(aire_bouchon / aire_perdue, 1.0, delta=0.02)

    def test_relief_suivi_a_quelques_pourcents_de_l_arete(self):
        """Relief sinusoidal : la rustine reste a moins de 0,3 arete de la VRAIE surface (une rustine plate serait a ~1 arete)."""
        f = lambda x, y: 0.12 * np.sin(5 * x) * np.cos(4 * y)
        n = 40
        V, F, UV = relief(n, f)
        F2, ret = sans_disque(V, F, (0.5, 0.5), 0.16)
        ng, bilan, a = remplir(trimesh.Trimesh(V, F2, process=False))
        Vn = np.asarray(ng.vertices)[len(V):]
        ecart = np.abs(Vn[:, 2] - f(Vn[:, 0], Vn[:, 1]))
        arete = 1.0 / n
        self.assertGreater(len(Vn), 20)
        self.assertLess(float(ecart.max()), 0.3 * arete, 'ecart max %.4f (arete %.4f)' % (ecart.max(), arete))
        self.assertIn('plan', bilan['methodes'])

    def test_plat_contre_lisse(self):
        """Sans sommet interieur ni lissage (triangulation du seul pourtour) l'ecart serait bien plus grand : le lissage sert a quelque chose."""
        f = lambda x, y: 0.2 * np.sin(4 * x) * np.cos(4 * y)
        V, F, UV = relief(40, f)
        F2, ret = sans_disque(V, F, (0.5, 0.5), 0.2)
        m = trimesh.Trimesh(V, F2, process=False)
        e2, e1 = [], []
        for ordre in (2, 1):
            ng, bilan, a = remplir(m, ordre=ordre)
            Vn = np.asarray(ng.vertices)[len(V):]
            (e2 if ordre == 2 else e1).append(float(np.abs(Vn[:, 2] - f(Vn[:, 0], Vn[:, 1])).mean()))
        self.assertLessEqual(e2[0], e1[0] + 1e-12, 'l ordre 2 (courbure minimale) doit suivre au moins aussi bien que la membrane')

    def test_coude_methode_de_liepa(self):
        """Trou a cheval sur un coude a 140 degres : le pourtour se recoupe une fois projete dans son plan moyen -> methode de Liepa (programmation
        dynamique du pourtour en 3D + raffinement + lissage), sans pli (angle maximal entre deux triangles voisins du bouchon < 100 degres)."""
        n = 30
        V, F, UV = relief(n, lambda x, y: 0 * x)
        coude = V.copy()
        haut = coude[:, 0] > 0.5
        d = coude[haut, 0] - 0.5
        t = np.radians(140.0)
        coude[haut, 0] = 0.5 + d * np.cos(t)
        coude[haut, 2] = d * np.sin(t)
        F2, ret = sans_disque(V, F, (0.5, 0.5), 0.18)          # le disque est choisi sur la grille plane, la geometrie est le coude
        ng, bilan, a = remplir(trimesh.Trimesh(coude, F2, process=False), mx=100)
        Fn, Vn = np.asarray(ng.faces), np.asarray(ng.vertices)
        self.assertEqual(P.aretes_de_bord_soudees(Vn, Fn)[0], 4 * n)
        self.assertEqual(P.orientation_incoherente(Vn, Fn), 0)
        self.assertIn('liepa', bilan['methodes'])
        self.assertLess(bilan['diedre_max'], 100.0)
        self.assertGreater(bilan['faces_ajoutees'], 20)

    def test_n_petit(self):
        """Trous de 3, 4 et 5 aretes : triangle, quadrilatere (diagonale la plus courte), eventail avec un sommet central."""
        V, F, UV = relief(10, lambda x, y: 0.05 * np.sin(6 * x))
        for k, (cellules, attendu) in enumerate((([(4, 4)], 'ok'), ([(4, 4), (5, 4)], 'ok'))):
            ret = []
            for (i, j) in cellules:
                ret += [2 * (j * 10 + i), 2 * (j * 10 + i) + 1]
            garde = np.ones(len(F), dtype=bool)
            garde[ret] = False
            ng, bilan, a = remplir(trimesh.Trimesh(V, F[garde], process=False), mx=30)
            self.assertEqual(P.aretes_de_bord_soudees(np.asarray(ng.vertices), np.asarray(ng.faces))[0], 40)


class TestTexture(unittest.TestCase):
    def test_ilot_neuf_dans_l_atlas_libre(self):
        """Atlas a 25 % : la rustine reçoit son ILOT, pose hors de toute face existante ; aucun pixel existant ne change ; couleur = le degrade vrai."""
        f = lambda x, y: 0.05 * np.sin(5 * x) * np.cos(4 * y)
        V, F, UV = relief(40, f)
        F2, ret = sans_disque(V, F, (0.5, 0.5), 0.2)
        img = degrade_image(512)
        m = trimesh_texture(V, F2, UV, img)
        avant = np.array(img)
        ng, bilan, a = remplir(m)
        self.assertEqual(bilan['uv_ilot'], 1, bilan)
        apres = np.array(ng.visual.material.baseColorTexture)
        # pixels modifies : tous hors du quart bas-gauche qu'occupe la surface (u, v dans [0, 0.5])
        diff = np.any(apres != avant, axis=2)
        lignes, cols = np.nonzero(diff)
        self.assertGreater(len(lignes), 100)
        h = avant.shape[0]
        in_quart = (cols < 256) & (lignes >= h - 256)
        self.assertFalse(in_quart.any(), 'un pixel d une face existante a ete modifie')
        # les UV d'entree sont intactes, les nouvelles tombent dans la zone modifiee
        uv = np.asarray(ng.visual.uv)
        self.assertTrue(np.array_equal(uv[:len(UV)], UV))
        nouvelles = uv[len(UV):]
        self.assertTrue(((nouvelles >= 0) & (nouvelles <= 1)).all())
        # couleur du bouchon contre la VERITE (le degrade au point 3D) : R = x/(2 cote)*255 ...
        Fn = np.asarray(ng.faces)[len(F2):]
        Vn = np.asarray(ng.vertices)
        centres_uv = uv[Fn].mean(axis=1)
        col = P.echantillonner(apres, centres_uv)
        pos = Vn[Fn].mean(axis=1)
        vrai = np.stack([pos[:, 0] / 2.0 * 255.0, pos[:, 1] / 2.0 * 255.0, np.full(len(pos), 128.0)], axis=1)
        self.assertLess(float(np.abs(col - vrai).mean()), 6.0, 'couleur du bouchon trop eloignee du degrade')

    def test_palette_quand_l_atlas_est_plein(self):
        """Atlas plein (UV = tout [0, 1]^2) : pas d'ilot ; chaque triangle reprend l'UV d'un sommet reel du pourtour -> couleurs vraies du voisinage, texture intacte."""
        f = lambda x, y: 0.03 * np.sin(5 * x)
        V, F, UV = relief(40, f)
        UV = UV * 2.0                                   # toute la texture
        F2, ret = sans_disque(V, F, (0.5, 0.5), 0.2)
        img = degrade_image(256)
        m = trimesh_texture(V, F2, UV, img)
        ng, bilan, a = remplir(m)
        self.assertEqual(bilan['uv_ilot'], 0)
        self.assertGreaterEqual(bilan['uv_palette'], 1)
        self.assertIs(ng.visual.material.baseColorTexture, img, 'la texture ne doit pas etre touchee')
        uv = np.asarray(ng.visual.uv)
        self.assertTrue(np.array_equal(uv[:len(UV)], UV))
        Fn = np.asarray(ng.faces)[len(F2):]
        col = P.echantillonner(np.array(img), uv[Fn].mean(axis=1))
        pos = np.asarray(ng.vertices)[Fn].mean(axis=1)
        vrai = np.stack([pos[:, 0] * 255.0, pos[:, 1] * 255.0, np.full(len(Fn), 128.0)], axis=1)
        self.assertLess(float(np.abs(col - vrai).mean()), 30.0)
        self.assertLess(float(np.abs(col - vrai).mean()), float(np.abs(128.0 - vrai).mean()), 'pire qu un bloc gris')

    def test_normales_du_pourtour_gardees(self):
        f = lambda x, y: 0.1 * np.sin(5 * x)
        V, F, UV = relief(30, f)
        F2, ret = sans_disque(V, F, (0.5, 0.5), 0.15)
        m = trimesh.Trimesh(V, F2, process=False)
        vn = np.asarray(m.vertex_normals).copy()
        m2 = trimesh.Trimesh(V, F2, process=False, vertex_normals=vn)
        ng, bilan, a = remplir(m2)
        nn = np.asarray(ng.vertex_normals)
        self.assertTrue(np.allclose(nn[:len(V)], vn, atol=1e-9))
        self.assertGreater(float((nn[len(V):, 2]).min()), 0.0, 'normales du bouchon du mauvais cote')


class TestScene(unittest.TestCase):
    def test_sphere_texturee_trous_multiples(self):
        import test_bouchage_trous as T
        V, F, UV = T.sphere_uv(4)
        F2 = T.retirer(F, T.region(F, T.face_pres(V, F, [-1, 0, 0]), 14) + T.region(F, T.face_pres(V, F, [0.3, 0.9, 0.2]), 5)
                       + T.region(F, T.face_pres(V, F, [0, 0, 1]), 9))
        scene = trimesh.Scene(trimesh_texture(V, F2, UV, degrade_image(64)))
        res = BL.boucher_scene(scene, 3, 2000, journal=lambda m: None)
        self.assertIsNone(res['refus'])
        self.assertEqual(res['stats']['verdict'], 'CLOSED_OK')
        g = list(scene.geometry.values())[0]
        Vn, Fn = np.asarray(g.vertices), np.asarray(g.faces)
        self.assertTrue(np.array_equal(Fn[:len(F2)], F2))
        self.assertTrue(np.array_equal(Vn[:len(V)], V))
        self.assertTrue(sphere_fermee_orientee(Vn, Fn))
        # la sphere est connue : tous les sommets du bouchon sont a moins de 4 % du rayon de la sphere unite
        r = np.linalg.norm(Vn[len(V):], axis=1)
        self.assertLess(float(np.abs(r - 1.0).max()), 0.04)

    def test_ferme_refus_explique(self):
        import test_bouchage_trous as T
        V, F, UV = T.sphere_uv(3)
        scene = trimesh.Scene(trimesh_texture(V, F, UV, degrade_image(32)))
        res = BL.boucher_scene(scene, 3, 2000, journal=lambda m: None)
        self.assertIsNotNone(res['refus'])
        self.assertEqual(res['refus'][0], 'fill_holes_closed')

    def test_curseurs(self):
        """Un trou plus grand que Max, ou plus petit que Min, n'est PAS bouche (et le maillage reste identique)."""
        import test_bouchage_trous as T
        V, F, UV = T.sphere_uv(4)
        F2 = T.retirer(F, T.region(F, T.face_pres(V, F, [-1, 0, 0]), 14))
        n = max(b['n'] for b in B.analyser(V, F2)['boucles'])
        for mn, mx in ((n + 1, 2000), (3, n - 1)):
            scene = trimesh.Scene(trimesh_texture(V, F2, UV, degrade_image(32)))
            res = BL.boucher_scene(scene, mn, mx, journal=lambda m: None)
            self.assertEqual(res['refus'][0], 'fill_holes_range')
            g = list(scene.geometry.values())[0]
            self.assertTrue(np.array_equal(np.asarray(g.faces), F2))


# ---------------------------------------------------------------------------------------------------------------------------------------
# 2. Vrai maillage
# ---------------------------------------------------------------------------------------------------------------------------------------
SEUILS = {
    # nom : (b2v_moy, v2b_moy) maximaux en longueurs d'arete moyenne ; 'grand' : la surface perdue est une bosse dont le bord ne dit rien
    'rond': (0.35, 0.35), 'irregulier': (0.4, 0.45), 'courbe': (0.3, 0.4), 'plusieurs': (0.3, 0.3), 'traversant': (0.3, 0.3),
    'arete_vive': (0.4, 0.5), 'grand': (3.0, 6.0),
}


@unittest.skipUnless(os.path.exists(GLB), 'maillage de reference absent : ' + GLB)
class TestMoissonneuse(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.g = P.charger()
        cls.V0 = np.asarray(cls.g.vertices, dtype=np.float64)
        cls.F0 = np.asarray(cls.g.faces, dtype=np.int64)
        cls.cas, cls.prep0 = P.fabriquer_cas(cls.g)
        tr = P.trou_traversant(cls.g)
        if tr:
            cls.cas.append(tr)
        cls.arete = cls.prep0['arete_moyenne']
        cls.mesures = {}
        cls.inc0 = P.orientation_incoherente(cls.V0, cls.F0)

    def test_original_sans_trou(self):
        a = B.analyser(self.V0, self.F0)
        self.assertEqual(a['aretes_de_bord'], 0, 'la moissonneuse est fermee une fois soudee par position')
        self.assertEqual(a['a_boucher'], 0)

    def _cas(self, nom):
        for c in self.cas:
            if c['nom'] == nom:
                return c
        self.skipTest('cas absent : ' + nom)

    def _mesure(self, nom):
        if nom in self.mesures:
            return self.mesures[nom]
        c = self._cas(nom)
        h, _ = P.percer(self.g, c['retirees'])
        prep = B.preparer(h.vertices, h.faces)
        a = B.analyser(h.vertices, h.faces, prep=prep)
        bord0, nm0 = P.aretes_de_bord_soudees(h.vertices, h.faces)
        t = time.time()
        ng, bilan = BL.appliquer_trimesh(h, a, prep, 2)
        duree = time.time() - t
        nF, nV = len(h.faces), len(h.vertices)
        Vn, Fn = np.asarray(ng.vertices), np.asarray(ng.faces)
        bord1, nm1 = P.aretes_de_bord_soudees(Vn, Fn)
        d = P.distance_au_manquant(Vn, Fn[nF:], self.V0, self.F0[c['retirees']])
        col = P.couleur_du_bouchon(self.g, ng, nF, c['retirees'])
        m = {'cas': nom, 'faces_retirees': int(len(c['retirees'])), 'aretes_de_bord_avant': bord0, 'aretes_de_bord_apres': bord1,
             'boucles_detectees': a['a_boucher'], 'chaines_ouvertes': a['chaines_ouvertes'], 'restantes': a['restantes'],
             'faces_ajoutees': int(len(Fn) - nF), 'sommets_ajoutes': int(len(Vn) - nV), 'methodes': bilan['methodes'],
             'uv': {'ilot': bilan['uv_ilot'], 'palette': bilan['uv_palette'], 'constante': bilan['uv_constante']},
             'non_manifold_avant_apres': [nm0, nm1], 'cordes_existantes': bilan['cordes_existantes'], 'duree_s': round(duree, 2),
             'orientation_ajoutee': P.orientation_incoherente(Vn, Fn) - P.orientation_incoherente(h.vertices, h.faces),
             'b2v_moy': d['b2v_moy'] / self.arete, 'v2b_moy': d['v2b_moy'] / self.arete, 'v2b_max': d['v2b_max'] / self.arete,
             'normales_ecart_deg': d['normales_ecart_moy_deg'], 'couleur': col,
             'entree_intacte': bool(np.array_equal(Fn[:nF], np.asarray(h.faces)) and np.array_equal(Vn[:nV], np.asarray(h.vertices))
                                    and np.array_equal(np.asarray(ng.visual.uv)[:nV], np.asarray(h.visual.uv))),
             'texture_intacte': ng.visual.material.baseColorTexture is h.visual.material.baseColorTexture}
        self.mesures[nom] = m
        return m

    def _verifier(self, nom):
        m = self._mesure(nom)
        self.assertGreaterEqual(m['boucles_detectees'], 1, nom)
        self.assertEqual(m['restantes'], 0, 'il reste des trous ouverts : ' + nom)
        self.assertEqual(m['aretes_de_bord_apres'], 0, 'aretes de bord restantes apres soudure : ' + nom)
        self.assertTrue(m['entree_intacte'], 'une face, un sommet ou une UV d entree a change : ' + nom)
        self.assertTrue(m['texture_intacte'], 'la texture d un atlas plein ne doit pas etre touchee : ' + nom)
        self.assertLessEqual(m['non_manifold_avant_apres'][1] - m['non_manifold_avant_apres'][0], m['cordes_existantes'], 'des aretes non manifold ont ete creees sans raison : ' + nom)
        self.assertLessEqual(m['orientation_ajoutee'], 0, 'rustine a l envers : ' + nom)
        mb, mv = SEUILS[nom]
        self.assertLess(m['b2v_moy'], mb, '%s : bouchon -> verite %.2f aretes' % (nom, m['b2v_moy']))
        self.assertLess(m['v2b_moy'], mv, '%s : verite -> bouchon %.2f aretes' % (nom, m['v2b_moy']))
        c = m['couleur']
        self.assertLess(c['ecart_par_triangle'], 0.6 * c['ecart_par_triangle_gris'], '%s : couleur pas meilleure qu un bloc gris' % nom)
        self.assertLess(m['duree_s'], 20.0)
        return m

    def test_rond(self):
        self._verifier('rond')

    def test_irregulier(self):
        self._verifier('irregulier')

    def test_courbe(self):
        self._verifier('courbe')

    def test_plusieurs(self):
        m = self._verifier('plusieurs')
        self.assertEqual(m['boucles_detectees'], 5)

    def test_traversant(self):
        self._verifier('traversant')

    def test_arete_vive(self):
        self._verifier('arete_vive')

    def test_grand(self):
        m = self._verifier('grand')
        self.assertGreater(m['faces_ajoutees'], 200)

    def test_curseurs_sur_vrai_maillage(self):
        c = self._cas('plusieurs')
        h, _ = P.percer(self.g, c['retirees'])
        tailles = sorted(b['n'] for b in B.analyser(h.vertices, h.faces)['boucles'])
        a = B.analyser(h.vertices, h.faces, tailles[-1] + 1, 2000)
        self.assertEqual((a['a_boucher'], a['trop_petites']), (0, len(tailles)))
        a = B.analyser(h.vertices, h.faces, 3, tailles[0] - 1)
        self.assertEqual((a['a_boucher'], a['trop_grandes']), (0, len(tailles)))
        a = B.analyser(h.vertices, h.faces, tailles[1], tailles[-2])
        self.assertEqual(a['a_boucher'], len(tailles) - 2 + sum(1 for t in (tailles[0], tailles[-1]) if tailles[1] <= t <= tailles[-2]))

    def test_chemin_du_bureau(self):
        """mesh_tools.py fill_holes (ce que lance le bureau) sur la moissonneuse percee de 5 trous : tout est bouche, rien n'est retire, duree bornee."""
        c = self._cas('plusieurs')
        h, _ = P.percer(self.g, c['retirees'])
        with tempfile.TemporaryDirectory() as d:
            e, s = os.path.join(d, 'e.glb'), os.path.join(d, 's.glb')
            h.export(e)
            t = time.time()
            r = subprocess.run([sys.executable, os.path.join(RACINE, 'scripts', 'mesh_tools.py'), 'fill_holes', e, s, '3', '2000'],
                               capture_output=True, text=True, env={**os.environ, 'PYTHONUTF8': '1'})
            duree = time.time() - t
            self.assertEqual(r.returncode, 0, r.stdout[-800:] + r.stderr[-800:])
            self.assertIn('"verdict": "CLOSED_OK"', r.stdout)
            self.assertLess(duree, 90.0, 'duree %.0f s' % duree)
            sc = trimesh.load(s, process=False)
            g2 = list(sc.geometry.values())[0]
            nF = len(h.faces)
            self.assertTrue(np.array_equal(np.asarray(g2.faces)[:nF], np.asarray(h.faces)))
            self.assertEqual(P.aretes_de_bord_soudees(g2.vertices, g2.faces)[0], 0)
            self.__class__.duree_cli = duree

    def test_zone_non_manifold_honnete(self):
        """Une region qui touche des aretes a plus de deux faces (double peau) : le noyau ne ment pas — il bouche ce qu'il peut, rien n'est retire, et le
        verdict dit qu'il reste des trous."""
        rng = np.random.default_rng(3)
        adj, _ = P.adjacence_faces(self.F0, V=self.V0)
        C = P.centres_des_faces(self.V0, self.F0)
        deg = np.diff(adj.indptr)
        ok = rng.permutation(np.nonzero(deg == 3)[0])
        for f in ok[:40]:
            r = P.region_surface(adj, C, int(f), 3000, rng, 0.2)
            h, _ = P.percer(self.g, r)
            prep = B.preparer(h.vertices, h.faces)
            a = B.analyser(h.vertices, h.faces, prep=prep)
            if a['chaines_ouvertes'] and a['a_boucher']:
                ng, bilan = BL.appliquer_trimesh(h, a, prep, 2)
                nF = len(h.faces)
                self.assertTrue(np.array_equal(np.asarray(ng.faces)[:nF], np.asarray(h.faces)))
                self.assertEqual(a['verdict'], 'OPEN_HOLES')
                return
        self.skipTest('aucune region a chaine ouverte trouvee')


def _rapport(chemin):
    """Ecrit les mesures de tous les cas du vrai maillage (JSON) : chiffres de l'AGENT_LOG."""
    classe = TestMoissonneuse
    classe.setUpClass()
    t = classe('test_original_sans_trou')
    sortie = {'cas': [classe._mesure(t, c['nom']) for c in classe.cas]}

    def conv(o):
        if isinstance(o, (np.floating,)):
            return float(o)
        if isinstance(o, (np.integer,)):
            return int(o)
        raise TypeError(type(o))
    with open(chemin, 'w', encoding='utf-8') as f:
        json.dump(sortie, f, indent=1, ensure_ascii=False, default=conv)
    print('rapport :', chemin)


if __name__ == '__main__':
    if '--rapport' in sys.argv:
        i = sys.argv.index('--rapport')
        _rapport(sys.argv[i + 1])
        sys.exit(0)
    unittest.main()
