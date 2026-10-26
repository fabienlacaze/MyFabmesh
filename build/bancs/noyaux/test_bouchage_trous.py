# -*- coding: utf-8 -*-
"""Tests du bouchage de trous NON DESTRUCTIF (2026-10-21) : scripts/bouchage_trous.py (= modal_app/bouchage_trous.py), l'exemplaire Modal
(modal_app/_mesh_op.py::fill_holes) et l'exemplaire du bureau (scripts/mesh_tools.py::fill_holes).

Contexte : mesure du 20/10 sur de VRAIS maillages (orc de 512 000 faces) : l'ancien exemplaire Modal supprimait 11,9 % des faces, reecrivait 38 %
des UV et creait 204 boucles ouvertes ; cinq detecteurs sans tolerance commune ; aucun test de comportement. Ici : des maillages SYNTHETIQUES de
toutes les categories (a verite connue) et les invariants du noyau — 0 face d'entree supprimee, 0 UV modifiee, 0 sommet deplace, aretes coherentes,
rustines sans triangle retourne, boucles degenerees ignorees, diagnostic d'un maillage ferme.

Lancer :  <python de l'appli> -I build/bancs/noyaux/test_bouchage_trous.py -v
          ... --ecrire   : regrave build/bouchage_attendus.json (cas + sorties du noyau, lus par le test JavaScript de parite)
Preuve sur l'ancien code : FH_RACINE=<copie de release-1.0.45> (les tests d'integration Modal / bureau echouent : sommets fusionnes, faces supprimees).
"""
import io
import json
import os
import sys
import unittest

import numpy as np

ICI = os.path.dirname(os.path.abspath(__file__))
RACINE_DEPOT = os.path.abspath(os.path.join(ICI, '..', '..', '..'))
RACINE = os.path.abspath(os.environ.get('FH_RACINE') or RACINE_DEPOT)
for chemin in (os.path.join(RACINE_DEPOT, 'scripts'), RACINE_DEPOT):
    if chemin not in sys.path:
        sys.path.insert(0, chemin)

import trimesh  # noqa: E402

import bouchage_trous as B  # noqa: E402

ATTENDUS = os.path.join(RACINE_DEPOT, 'build', 'bouchage_attendus.json')


# ---------------------------------------------------------------------------------------------------------------------------------------
# Constructeurs de maillages a verite connue
# ---------------------------------------------------------------------------------------------------------------------------------------
def sphere(sub=2):
    m = trimesh.creation.icosphere(subdivisions=sub)
    return np.asarray(m.vertices, dtype=np.float64), np.asarray(m.faces, dtype=np.int64)


def retirer(F, indices):
    garde = np.ones(len(F), dtype=bool)
    garde[list(indices)] = False
    return F[garde]


def plus_proches(V, F, centre, k):
    """Les k faces dont le centre est le plus proche de `centre`."""
    c = V[F].mean(axis=1)
    return list(np.argsort(np.linalg.norm(c - np.asarray(centre, dtype=np.float64), axis=1), kind='stable')[:k])


def region(F, depart, k):
    """k faces CONNEXES (par arete) en partant de la face `depart`, ordre de parcours deterministe."""
    par_arete = {}
    for f, (a, b, c) in enumerate(F):
        for u, v in ((a, b), (b, c), (c, a)):
            par_arete.setdefault((min(u, v), max(u, v)), []).append(f)
    vus = [depart]
    marque = {depart}
    i = 0
    while i < len(vus) and len(vus) < k:
        a, b, c = F[vus[i]]
        for u, v in ((a, b), (b, c), (c, a)):
            for g in par_arete[(min(u, v), max(u, v))]:
                if g not in marque and len(vus) < k:
                    marque.add(g)
                    vus.append(g)
        i += 1
    return vus


def face_pres(V, F, point):
    c = V[F].mean(axis=1)
    return int(np.argmin(np.linalg.norm(c - np.asarray(point, dtype=np.float64), axis=1)))


def plan(n):
    """Grille n x n de carres de cote 1 dans z = 0, triangles CCW vus de +z (normale +z). Cellule (i, j) -> faces 2c et 2c + 1, c = j n + i."""
    V = np.array([[i, j, 0.0] for j in range(n + 1) for i in range(n + 1)], dtype=np.float64)
    F = []
    for j in range(n):
        for i in range(n):
            a = j * (n + 1) + i
            b = a + 1
            c = a + n + 2
            d = a + n + 1
            F.append([a, b, c])
            F.append([a, c, d])
    return V, np.array(F, dtype=np.int64)


def plan_sans(n, cellules):
    V, F = plan(n)
    ret = []
    for (i, j) in cellules:
        ret += [2 * (j * n + i), 2 * (j * n + i) + 1]
    return V, retirer(F, ret)


def carre(i0, j0, k):
    return [(i0 + i, j0 + j) for j in range(k) for i in range(k)]


def forme_L():
    return [(i, j) for j in range(10, 16) for i in range(4, 7)] + [(i, j) for j in range(10, 12) for i in range(7, 12)]


def forme_croix():
    # bras de 3 de large, enveloppe de 14 x 14 : 56 aretes de pourtour (> 48 : decoupe par oreilles)
    return [(i, j) for j in range(3, 17) for i in range(9, 12)] + [(i, j) for j in range(9, 12) for i in range(3, 9)] \
        + [(i, j) for j in range(9, 12) for i in range(12, 17)]


def sphere_uv(sub=2):
    """Sphere avec UV et COUTURE : les sommets de la couture sont dupliques (comme dans un vrai atlas), donc la couture est une arete de bord
    pour qui ne soude pas par position."""
    V, F = sphere(sub)
    u = 0.5 + np.arctan2(V[:, 1], V[:, 0]) / (2 * np.pi)
    v = 0.5 + np.arcsin(np.clip(V[:, 2], -1, 1)) / np.pi
    sommets = [tuple(p) for p in V]
    uvs = [(float(a), float(b)) for a, b in zip(u, v)]
    copie = {}
    nouvelles = []
    for f in F:
        us = u[f]
        if us.max() - us.min() > 0.5:
            g = []
            for s in f:
                if u[s] < 0.5:
                    if s not in copie:
                        copie[s] = len(sommets)
                        sommets.append(tuple(V[s]))
                        uvs.append((float(u[s]) + 1.0, float(v[s])))
                    g.append(copie[s])
                else:
                    g.append(int(s))
            nouvelles.append(g)
        else:
            nouvelles.append([int(s) for s in f])
    return np.array(sommets, dtype=np.float64), np.array(nouvelles, dtype=np.int64), np.array(uvs, dtype=np.float64)


def t_jonction(V, F):
    """Ajoute un sommet au milieu de l'arete (a, b) d'UNE seule des deux faces qui la partagent : T-jonction. Boucle de bord de 3 sommets
    ALIGNES (aire nulle) : le motif des 13 boucles degenerees de l'orc."""
    f1 = 0
    a, b, c = F[f1]
    m = len(V)
    V2 = np.vstack([V, (V[a] + V[b]) / 2.0])
    F2 = np.vstack([retirer(F, [f1]), [[a, m, c], [m, b, c]]])
    return V2, F2


def boucles_en_indices(F):
    """Nombre d'aretes de bord par INDICE (sans souder) : une couture d'UV en compte autant."""
    e = np.sort(np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]]), axis=1)
    _, n = np.unique(e, axis=0, return_counts=True)
    return int((n == 1).sum())


def en_glb(V, F, UV=None):
    """GLB en octets (avec une petite texture si UV)."""
    from PIL import Image
    visuel = None
    if UV is not None:
        img = Image.fromarray((np.random.RandomState(1).rand(16, 16, 3) * 255).astype(np.uint8))
        visuel = trimesh.visual.TextureVisuals(uv=UV, material=trimesh.visual.material.PBRMaterial(baseColorTexture=img))
    m = trimesh.Trimesh(vertices=V, faces=F, visual=visuel, process=False)
    return trimesh.Scene(m).export(file_type='glb')


def lire_glb(octets):
    sc = trimesh.load(io.BytesIO(octets), file_type='glb', force='scene', process=False)
    g = [x for x in sc.geometry.values() if hasattr(x, 'faces')][0]
    uv = None
    try:
        uv = np.asarray(g.visual.uv, dtype=np.float64)
    except Exception:
        pass
    return np.asarray(g.vertices, dtype=np.float64), np.asarray(g.faces, dtype=np.int64), uv


# ---------------------------------------------------------------------------------------------------------------------------------------
# Verifications independantes du noyau
# ---------------------------------------------------------------------------------------------------------------------------------------
def aretes_dirigees_en_double(V, F):
    """Aretes SOUDEES (par position) parcourues deux fois dans le meme sens : signe d'une rustine (ou d'une face) a l'envers."""
    prep = B.preparer(V, F)
    ea, eb = prep['ea'], prep['eb']
    cle = ea.astype(np.int64) * max(prep['nG'], 1) + eb
    _, n = np.unique(cle, return_counts=True)
    return int((n > 1).sum())


def souder(V, F):
    prep = B.preparer(V, F)
    return trimesh.Trimesh(vertices=np.zeros((prep['nG'], 3)), faces=prep['groupe'][F], process=False), prep


def ferme_et_orientee(V, F):
    """Apres soudure par position : sans bord, sans arete a plus de deux faces, orientation coherente."""
    prep = B.preparer(V, F)
    G = prep['groupe'][F]
    G = G[(G[:, 0] != G[:, 1]) & (G[:, 1] != G[:, 2]) & (G[:, 0] != G[:, 2])]
    m = trimesh.Trimesh(vertices=np.zeros((prep['nG'], 3)), faces=G, process=False)
    return bool(m.is_watertight and m.is_winding_consistent)


def volume_positif(V, F):
    prep = B.preparer(V, F)
    pts = np.zeros((prep['nG'], 3))
    pts[prep['groupe']] = V
    G = prep['groupe'][F]
    G = G[(G[:, 0] != G[:, 1]) & (G[:, 1] != G[:, 2]) & (G[:, 0] != G[:, 2])]
    return trimesh.Trimesh(vertices=pts, faces=G, process=False).volume > 0


def trois_trous(V, F):
    """Trois trous disjoints de 1, 6 et 14 faces (pourtours de 3, 6 et ~12 aretes) : aux extremites des trois axes."""
    return region(F, face_pres(V, F, [1, 0, 0]), 1) + region(F, face_pres(V, F, [-1, 0, 0]), 6) + region(F, face_pres(V, F, [0, 0, 1]), 14)


class OutilsTest(unittest.TestCase):
    def boucher_plan(self, V, F):
        """Sur la grille de 20, le BORD EXTERIEUR (80 aretes) est un pourtour comme un autre : max = 79 le laisse de cote."""
        return self.boucher(V, F, 3, 79)

    def boucher(self, V, F, mn=3, mx=2000):
        a = B.analyser(V, F, mn, mx)
        return a, B.faces_ajoutees(a)

    def ajouter(self, F, ajout):
        return np.vstack([F, ajout]) if len(ajout) else F


# ---------------------------------------------------------------------------------------------------------------------------------------
# Le noyau
# ---------------------------------------------------------------------------------------------------------------------------------------
class TestModes(OutilsTest):
    def test_trou_triangulaire_un_triangle(self):
        V, F = sphere(2)
        F2 = retirer(F, [10])
        a, ajout = self.boucher(V, F2)
        self.assertEqual([(b['n'], b['categorie'], b['mode']) for b in a['boucles']], [(3, 'a_boucher', 'triangle')])
        self.assertEqual(len(ajout), 1)
        G = self.ajouter(F2, ajout)
        self.assertTrue(ferme_et_orientee(V, G))
        self.assertTrue(volume_positif(V, G))

    def test_trou_de_quatre_aretes_deux_triangles(self):
        V, F = sphere(2)
        # deux faces voisines partageant une arete : pourtour de 4 aretes
        f0 = 0
        voisin = [k for k in range(len(F)) if k != f0 and len(set(F[k]) & set(F[f0])) == 2][0]
        F2 = retirer(F, [f0, voisin])
        a, ajout = self.boucher(V, F2)
        self.assertEqual([(b['n'], b['mode']) for b in a['boucles']], [(4, 'quad')])
        self.assertEqual(len(ajout), 2)
        G = self.ajouter(F2, ajout)
        self.assertTrue(ferme_et_orientee(V, G))

    def test_trou_moyen_triangulation_optimale(self):
        V, F = sphere(3)
        F2 = retirer(F, region(F, face_pres(V, F, V[0]), 7))
        a, ajout = self.boucher(V, F2)
        self.assertEqual(len(a['boucles']), 1)
        self.assertEqual(a['boucles'][0]['mode'], 'optimal')
        n = a['boucles'][0]['n']
        self.assertEqual(len(ajout), n - 2)
        G = self.ajouter(F2, ajout)
        self.assertTrue(ferme_et_orientee(V, G))
        self.assertTrue(volume_positif(V, G))

    def test_grand_trou_oreilles(self):
        V, F = sphere(5)
        F2 = retirer(F, region(F, face_pres(V, F, [0, 0, 1]), 700))
        a, ajout = self.boucher(V, F2)
        self.assertEqual(len(a['boucles']), 1)
        self.assertGreater(a['boucles'][0]['n'], B.TAILLE_OPTIMALE_MAX)
        self.assertEqual(a['boucles'][0]['mode'], 'oreilles')
        self.assertEqual(len(ajout), a['boucles'][0]['n'] - 2)
        G = self.ajouter(F2, ajout)
        self.assertTrue(ferme_et_orientee(V, G))
        self.assertTrue(volume_positif(V, G))

    def test_trou_en_L_rustine_orientee_et_exacte(self):
        """Pourtour concave : aucun triangle retourne, la rustine recouvre EXACTEMENT les cellules retirees (aire = nombre de cellules)."""
        cellules = forme_L()
        V, F2 = plan_sans(20, cellules)
        a, ajout = self.boucher_plan(V, F2)
        self.assertEqual(sorted(b['categorie'] for b in a['boucles']), ['a_boucher', 'trop_grande'])
        normales = np.cross(V[ajout[:, 1]] - V[ajout[:, 0]], V[ajout[:, 2]] - V[ajout[:, 0]])
        self.assertTrue((normales[:, 2] > 0).all(), 'un triangle de rustine est retourne')
        self.assertAlmostEqual(float(np.linalg.norm(normales, axis=1).sum() / 2), float(len(cellules)), places=9)
        self.assertEqual(aretes_dirigees_en_double(V, self.ajouter(F2, ajout)), 0)

    def test_trou_en_croix_oreilles_exact(self):
        cellules = forme_croix()
        V, F2 = plan_sans(20, cellules)
        a, ajout = self.boucher_plan(V, F2)
        mienne = [b for b in a['boucles'] if b['categorie'] == 'a_boucher']
        self.assertEqual(len(mienne), 1)
        self.assertEqual(mienne[0]['n'], 56)
        self.assertEqual(mienne[0]['mode'], 'oreilles', mienne[0])
        normales = np.cross(V[ajout[:, 1]] - V[ajout[:, 0]], V[ajout[:, 2]] - V[ajout[:, 0]])
        self.assertTrue((normales[:, 2] > 0).all())
        self.assertAlmostEqual(float(np.linalg.norm(normales, axis=1).sum() / 2), float(len(cellules)), places=9)
        self.assertEqual(aretes_dirigees_en_double(V, self.ajouter(F2, ajout)), 0)

    def test_carre_de_trente_deux_aretes(self):
        V, F2 = plan_sans(20, carre(3, 3, 8))
        a, ajout = self.boucher_plan(V, F2)
        mienne = [b for b in a['boucles'] if b['categorie'] == 'a_boucher']
        self.assertEqual((mienne[0]['n'], mienne[0]['mode']), (32, 'optimal'))
        normales = np.cross(V[ajout[:, 1]] - V[ajout[:, 0]], V[ajout[:, 2]] - V[ajout[:, 0]])
        self.assertTrue((normales[:, 2] > 0).all())
        self.assertAlmostEqual(float(np.linalg.norm(normales, axis=1).sum() / 2), 64.0, places=9)

    def test_polygone_croise_non_triangulable(self):
        """Un pourtour en « huit » a une aire signee nulle : ni triangle ni oreille ne peut le remplir sans retourner un triangle."""
        noeud = [(0, 0, 0), (1, 1, 0), (1, 0, 0), (0, 1, 0)]
        self.assertIsNone(B.trianguler([(float(x), float(y), float(z)) for x, y, z in noeud]))


class TestInvariants(OutilsTest):
    def test_aucune_entree_modifiee(self):
        """Le noyau ne rend que des faces a ajouter, avec des indices d'ORIGINE ; il ne modifie ni V ni F."""
        V, F = sphere(3)
        F2 = retirer(F, region(F, face_pres(V, F, V[5]), 9))
        V0, F0 = V.copy(), F2.copy()
        a = B.analyser(V, F2)
        self.assertTrue(np.array_equal(V, V0) and np.array_equal(F2, F0))
        ajout = B.faces_ajoutees(a)
        self.assertTrue(len(ajout) > 0 and ajout.max() < len(V) and ajout.min() >= 0)

    def test_pas_de_fusion_des_sommets_livres(self):
        """Une couture d'UV (sommets dupliques) n'est PAS un trou : zero boucle, et le noyau ne propose aucune fusion."""
        V, F, UV = sphere_uv(2)
        self.assertGreater(boucles_en_indices(F), 10, 'le cas doit avoir une couture visible par indice')
        a = B.analyser(V, F)
        self.assertEqual(a['aretes_de_bord'], 0)
        self.assertEqual(a['faces_ajoutees'], 0)

    def test_trou_a_cheval_sur_la_couture(self):
        V, F, UV = sphere_uv(3)
        # faces proches de la couture (u = 0 / 1), du cote x < 0, y ~ 0
        F2 = retirer(F, region(F, face_pres(V, F, [-1, 0, 0]), 6))
        a, ajout = self.boucher(V, F2)
        self.assertEqual([b['categorie'] for b in a['boucles']], ['a_boucher'])
        G = self.ajouter(F2, ajout)
        self.assertTrue(ferme_et_orientee(V, G))
        self.assertTrue(ajout.max() < len(V))

    def test_tolerance_relative_bruit_float32(self):
        """Doublons de couture decales de 1e-7 (bruit de flottant) : toujours soudes ; un vrai trou reste trouve."""
        V, F, UV = sphere_uv(3)
        rng = np.random.RandomState(7)
        V = V + rng.uniform(-1e-7, 1e-7, V.shape)
        a = B.analyser(V, F)
        self.assertEqual(a['aretes_de_bord'], 0)
        F2 = retirer(F, region(F, face_pres(V, F, [0, 1, 0]), 4))
        a = B.analyser(V, F2)
        self.assertEqual(a['a_boucher'], 1)

    def test_pincement_deux_trous_se_touchant(self):
        V, F = sphere(2)
        autour = [k for k in range(len(F)) if 0 in F[k]]
        f1 = autour[0]
        opposee = [k for k in autour if len(set(F[k]) & set(F[f1])) == 1][0]
        F2 = retirer(F, [f1, opposee])
        a, ajout = self.boucher(V, F2)
        self.assertEqual(sorted(b['n'] for b in a['boucles']), [3, 3])
        self.assertTrue(ferme_et_orientee(V, self.ajouter(F2, ajout)))

    def test_deux_trous_independants(self):
        V, F = sphere(3)
        F2 = retirer(F, region(F, face_pres(V, F, V[0]), 3) + region(F, face_pres(V, F, -V[0]), 5))
        a, ajout = self.boucher(V, F2)
        self.assertEqual(a['a_boucher'], 2)
        self.assertEqual(a['modes']['optimal'] + a['modes']['quad'] + a['modes']['triangle'], 2)
        self.assertTrue(ferme_et_orientee(V, self.ajouter(F2, ajout)))

    def test_curseurs_min_max_en_aretes(self):
        V, F = sphere(3)
        F2 = retirer(F, trois_trous(V, F))
        tailles = sorted(b['n'] for b in B.analyser(V, F2)['boucles'])
        self.assertEqual(len(tailles), 3)
        petit, milieu, grand = tailles
        a = B.analyser(V, F2, petit + 1, grand - 1)
        self.assertEqual((a['a_boucher'], a['trop_petites'], a['trop_grandes']), (1, 1, 1))
        self.assertEqual(a['boucles'][[b['n'] for b in a['boucles']].index(milieu)]['categorie'], 'a_boucher')
        self.assertEqual(a['verdict'], 'OPEN_HOLES')
        a = B.analyser(V, F2, 3, 5000)
        self.assertEqual((a['a_boucher'], a['verdict']), (3, 'CLOSED_OK'))

    def test_budget_de_travail_deterministe(self):
        """Le travail est compte sur les TAILLES (jamais sur l'horloge) : un budget epuise laisse le pourtour ouvert, sans rien casser."""
        V, F = sphere(2)
        F2 = retirer(F, trois_trous(V, F))
        tailles = sorted((b['n'] for b in B.analyser(V, F2)['boucles']), reverse=True)
        self.assertEqual(tailles, [12, 8, 3])
        a = B.analyser(V, F2, 3, 2000, budget=B.cout_travail(12) + 10)
        self.assertEqual([(b['n'], b['categorie']) for b in a['boucles']], [(12, 'a_boucher'), (8, 'non_triangulable'), (3, 'a_boucher')])
        self.assertEqual(a['verdict'], 'OPEN_HOLES')
        self.assertEqual(a['non_triangulables'], 1)
        ajout = B.faces_ajoutees(a)
        self.assertEqual(len(ajout), (12 - 2) + (3 - 2))
        self.assertEqual(aretes_dirigees_en_double(V, self.ajouter(F2, ajout)), 0)
        # budget nul : rien n'est bouche, et le refus le dit
        a = B.analyser(V, F2, 3, 2000, budget=0)
        self.assertEqual((a['faces_ajoutees'], a['non_triangulables']), (0, 3))
        code, texte = B.message_refus(a, None, 3, 2000)
        self.assertEqual(code, 'fill_holes_unfillable')
        self.assertIn('too complex or folds over itself', texte)
        # le budget par defaut couvre un pourtour de 5000 aretes (~17 s) mais pas deux
        self.assertLessEqual(B.cout_travail(B.TAILLE_MAX), B.BUDGET_TRAVAIL)
        self.assertGreater(2 * B.cout_travail(B.TAILLE_MAX), B.BUDGET_TRAVAIL)

    def test_plafond_du_noyau(self):
        V, F = sphere(5)
        F2 = retirer(F, region(F, face_pres(V, F, [0, 0, 1]), 700))
        ancien = B.TAILLE_MAX
        B.TAILLE_MAX = 60
        try:
            a = B.analyser(V, F2, 3, 5000)
        finally:
            B.TAILLE_MAX = ancien
        self.assertEqual(a['trop_grandes'], 1)
        self.assertEqual(a['faces_ajoutees'], 0)
        self.assertGreater(a['boucles'][0]['n'], 60)

    def test_boucle_degeneree_t_jonction_ignoree(self):
        """T-jonction : boucle de bord de 3 sommets alignes, aire nulle. Ignoree (pas comptee dans trop_petite), jamais bouchee."""
        V, F = sphere(2)
        V2, F2 = t_jonction(V, F)
        a, ajout = self.boucher(V2, F2)
        self.assertEqual(a['degenerees'], 1)
        self.assertEqual(a['a_boucher'] + a['trop_petites'] + a['trop_grandes'], 0)
        self.assertEqual(len(ajout), 0)
        self.assertEqual(a['verdict'], 'CLOSED_OK')
        # et un VRAI trou a cote est bouche malgre elle
        F3 = retirer(F2, region(F2, face_pres(V2, F2, -V2[0]), 4))
        a, ajout = self.boucher(V2, F3)
        self.assertEqual((a['degenerees'], a['a_boucher']), (1, 1))

    def test_rien_a_boucher_diagnostic_t_jonction(self):
        V, F = sphere(2)
        V2, F2 = t_jonction(V, F)
        a = B.analyser(V2, F2)
        d = B.diagnostiquer(B.preparer(V2, F2), a)
        self.assertEqual(d['cause'], 'aucune')
        code, texte = B.message_refus(a, d, 3, 2000)
        self.assertEqual(code, 'fill_holes_closed')
        self.assertIn('Nothing to fill', texte)
        self.assertNotIn('triangle', texte.lower().replace('triangulat', ''))


def sphere_ailette_et_trou():
    """Sphere dont la face 0 est RETIREE et dont la voisine f1 (a travers l'arete (a, b)) est DOUBLEE par une copie de sens inverse : double peau, comme
    en font les maillages TRELLIS (94 000 aretes a plus de deux faces sur l'orc). L'arete (a, b) garde deux faces (f1 et sa copie) : le trou n'est donc plus
    qu'une CHAINE a -> c -> b dont les bouts sont relies par une arete toujours presente. Rend (V, F, (a, b, c))."""
    V, F = sphere(2)
    a, b, c = (int(x) for x in F[0])
    f1 = [k for k in range(1, len(F)) if a in F[k] and b in F[k]][0]
    copie = F[f1][::-1]
    F2 = np.vstack([retirer(F, [0]), [copie]])
    return V, F2, (a, b, c)


class TestChaines(OutilsTest):
    def test_trou_contre_une_arete_a_trois_faces_est_ferme_par_cette_arete(self):
        V, F2, (a, b, c) = sphere_ailette_et_trou()
        a_ = B.analyser(V, F2)
        self.assertEqual(a_['chaines_fermees'], 1)
        self.assertEqual(a_['chaines_ouvertes'], 0)
        self.assertEqual([(x['n'], x['categorie'], x['chaine']) for x in a_['boucles']], [(3, 'a_boucher', True)])
        self.assertEqual(a_['aretes_de_bord'], 2)
        ajout = B.faces_ajoutees(a_)
        self.assertEqual(len(ajout), 1)
        # la rustine RETROUVE la face retiree : memes sommets, meme sens de parcours (a, b, c)
        t = list(ajout[0])
        k = t.index(a)
        self.assertEqual(t[k:] + t[:k], [a, b, c])

    def test_ailette_seule_n_est_pas_un_trou(self):
        """Un triangle accroche a une arete : sa chaine se referme sur une face qui existe deja ; la « boucher » ne ferait que la doubler."""
        V, F = sphere(2)
        a_, b_ = F[0][0], F[0][1]
        V2 = np.vstack([V, V[a_] * 1.3 + V[b_] * 0.4])
        F2 = np.vstack([F, [[a_, b_, len(V)]]])
        r = B.analyser(V2, F2)
        self.assertEqual((r['faces_ajoutees'], r['degenerees'], r['chaines_fermees']), (0, 1, 1))

    def test_chaine_sans_arete_pour_la_fermer_reste_ouverte(self):
        """Trou d'une face dont une voisine de rive est RETOURNEE : les aretes de bord ne se suivent plus (a -> b et a -> c -> b) et l'arete qui
        relierait leurs bouts, (a, b), n'a plus qu'UNE face. Aucune corde : les deux chaines restent ouvertes, rien n'est invente ni facture."""
        V, F = sphere(2)
        a, b = int(F[0][0]), int(F[0][1])
        f1 = [k for k in range(1, len(F)) if a in F[k] and b in F[k]][0]
        F2 = F.copy()
        F2[f1] = F2[f1][::-1]
        F2 = retirer(F2, [0])
        r = B.analyser(V, F2)
        self.assertEqual((r['aretes_de_bord'], r['chaines_ouvertes'], r['chaines_fermees']), (3, 2, 0))
        self.assertEqual((r['a_boucher'], r['faces_ajoutees']), (0, 0))


class TestDiagnostic(OutilsTest):
    def test_faces_retournees(self):
        V, F = sphere(3)
        F2 = F.copy()
        F2[[3, 40, 200, 201]] = F2[[3, 40, 200, 201]][:, ::-1]
        a = B.analyser(V, F2)
        self.assertEqual(a['faces_ajoutees'], 0)
        d = B.diagnostiquer(B.preparer(V, F2), a)
        self.assertEqual(d['cause'], 'retournees')
        self.assertEqual(d['faces_retournees'], 4)
        code, texte = B.message_refus(a, d, 3, 2000)
        self.assertEqual(code, 'fill_holes_closed_flipped')
        self.assertIn('4 faces point the wrong way', texte)

    def test_aretes_a_plus_de_deux_faces(self):
        V, F = sphere(2)
        a_, b_ = F[0][0], F[0][1]
        V2 = np.vstack([V, V[a_] * 1.3 + V[b_] * 0.4])
        F2 = np.vstack([F, [[a_, b_, len(V)]]])
        a = B.analyser(V2, F2)
        d = B.diagnostiquer(B.preparer(V2, F2), a)
        self.assertEqual(d['cause'], 'non_manifold')
        self.assertGreaterEqual(d['aretes_non_manifold'], 1)
        self.assertEqual(B.message_refus(a, d, 3, 2000)[0], 'fill_holes_closed_nonmanifold')

    def test_miettes_flottantes(self):
        V, F = sphere(3)
        tetra_v = np.array([[5, 5, 5], [5.1, 5, 5], [5, 5.1, 5], [5, 5, 5.1]], dtype=np.float64)
        tetra_f = np.array([[0, 2, 1], [0, 1, 3], [1, 2, 3], [0, 3, 2]]) + len(V)
        V2 = np.vstack([V, tetra_v])
        F2 = np.vstack([F, tetra_f])
        a = B.analyser(V2, F2)
        self.assertEqual(a['aretes_de_bord'], 0)
        d = B.diagnostiquer(B.preparer(V2, F2), a)
        self.assertEqual((d['cause'], d['miettes'], d['faces_miettes']), ('miettes', 1, 4))
        self.assertEqual(B.message_refus(a, d, 3, 2000)[0], 'fill_holes_closed_debris')

    def test_maillage_sain_ferme(self):
        V, F = sphere(3)
        a = B.analyser(V, F)
        d = B.diagnostiquer(B.preparer(V, F), a)
        self.assertEqual(d['cause'], 'aucune')
        self.assertEqual(B.message_refus(a, d, 3, 2000)[0], 'fill_holes_closed')

    def test_hors_plage(self):
        V, F = sphere(3)
        F2 = retirer(F, region(F, face_pres(V, F, V[0]), 6))
        n = B.analyser(V, F2)['boucles'][0]['n']
        a = B.analyser(V, F2, n + 1, n + 10)
        self.assertEqual(a['faces_ajoutees'], 0)
        code, texte = B.message_refus(a, None, n + 1, n + 10)
        self.assertEqual(code, 'fill_holes_range')
        self.assertIn('between %d and %d edges' % (n + 1, n + 10), texte)

    def test_agreger_plusieurs_maillages(self):
        V, F = sphere(3)
        F2 = F.copy()
        F2[[1, 2]] = F2[[1, 2]][:, ::-1]
        a1 = B.analyser(V, F)
        a2 = B.analyser(V, F2)
        d1 = B.diagnostiquer(B.preparer(V, F), a1)
        d2 = B.diagnostiquer(B.preparer(V, F2), a2)
        somme, diag = B.agreger([a1, a2], [d1, d2])
        self.assertEqual(diag['cause'], 'retournees')
        self.assertEqual(B.message_refus(somme, diag, 3, 2000)[0], 'fill_holes_closed_flipped')


# ---------------------------------------------------------------------------------------------------------------------------------------
# Integration : les DEUX exemplaires de production (echouent sur l'ancien code)
# ---------------------------------------------------------------------------------------------------------------------------------------
def modal_fill_holes():
    if RACINE not in sys.path:
        sys.path.insert(0, RACINE)
    for nom in [n for n in sys.modules if n == 'modal_app' or n.startswith('modal_app.')]:
        del sys.modules[nom]
    from modal_app import _mesh_op
    return _mesh_op.fill_holes


def cas_texture_avec_trou():
    V, F, UV = sphere_uv(3)
    F2 = retirer(F, region(F, face_pres(V, F, [-1, 0, 0]), 6) + region(F, face_pres(V, F, [0.3, 0.9, 0.2]), 3))
    return V, F2, UV


class TestModal(unittest.TestCase):
    def test_rien_supprime_rien_deplace_uv_intactes(self):
        V, F2, UV = cas_texture_avec_trou()
        entree = en_glb(V, F2, UV)
        V0, F0, UV0 = lire_glb(entree)
        sortie, stats = modal_fill_holes()(entree, 3, 1_000_000)
        V1, F1, UV1 = lire_glb(sortie)
        self.assertEqual(len(V1), len(V0), 'des sommets ont ete fusionnes ou ajoutes')
        self.assertTrue(np.array_equal(V1, V0), 'un sommet a ete deplace')
        self.assertTrue(np.array_equal(UV1, UV0), 'une UV a ete modifiee')
        self.assertTrue(np.array_equal(F1[:len(F0)], F0), 'une face d entree a ete supprimee ou modifiee')
        self.assertGreater(len(F1), len(F0))
        self.assertEqual(stats['holes_filled_delta_faces'], len(F1) - len(F0))
        self.assertEqual(stats['verdict'], 'CLOSED_OK')
        self.assertTrue(ferme_et_orientee(V1, F1))
        self.assertEqual(aretes_dirigees_en_double(V1, F1), 0)

    def test_curseurs_transmis(self):
        V, F2, UV = cas_texture_avec_trou()
        entree = en_glb(V, F2, UV)
        petit = min(b['n'] for b in B.analyser(V, F2)['boucles'])
        sortie, stats = modal_fill_holes()(entree, petit + 1, 1_000_000)
        self.assertEqual(stats['verdict'], 'OPEN_HOLES')
        self.assertEqual(stats['meshes'][0]['skipped_too_small'], 1)

    def test_maillage_ferme_refus_explique(self):
        V, F, UV = sphere_uv(3)
        with self.assertRaises(RuntimeError) as cm:
            modal_fill_holes()(en_glb(V, F, UV), 3, 1_000_000)
        self.assertIn('Nothing to fill', str(cm.exception))

    def test_faces_retournees_refus_explique(self):
        V, F, UV = sphere_uv(3)
        F2 = F.copy()
        F2[[5, 80]] = F2[[5, 80]][:, ::-1]
        with self.assertRaises(RuntimeError) as cm:
            modal_fill_holes()(en_glb(V, F2, UV), 3, 1_000_000)
        self.assertIn('2 faces point the wrong way', str(cm.exception))

    def test_perte_de_matiere_impossible_sur_pourtour_sale(self):
        """Pourtour avec T-jonction + doublons de couture : l'ancien code supprimait des faces « cassees » ; le nouveau n'en supprime aucune."""
        V, F, UV = sphere_uv(3)
        f1 = 0
        a, b, c = F[f1]
        m = len(V)
        V2 = np.vstack([V, (V[a] + V[b]) / 2.0])
        UV2 = np.vstack([UV, (UV[a] + UV[b]) / 2.0])
        F2 = np.vstack([retirer(F, [f1] + region(F, face_pres(V, F, [0, -1, 0.2]), 5)), [[a, m, c], [m, b, c]]])
        entree = en_glb(V2, F2, UV2)
        V0, F0, UV0 = lire_glb(entree)
        sortie, stats = modal_fill_holes()(entree, 3, 1_000_000)
        V1, F1, UV1 = lire_glb(sortie)
        self.assertTrue(np.array_equal(F1[:len(F0)], F0))
        self.assertTrue(np.array_equal(UV1, UV0) and np.array_equal(V1, V0))


class TestBureau(unittest.TestCase):
    def lancer(self, octets, mn=3, mx=2000):
        import tempfile
        if os.path.join(RACINE, 'scripts') not in sys.path:
            sys.path.insert(0, os.path.join(RACINE, 'scripts'))
        for nom in ('mesh_tools',):
            sys.modules.pop(nom, None)
        import mesh_tools
        with tempfile.TemporaryDirectory() as d:
            entree = os.path.join(d, 'entree.glb')
            sortie = os.path.join(d, 'sortie.glb')
            with open(entree, 'wb') as f:
                f.write(octets)
            mesh_tools.fill_holes(entree, sortie, mn, mx)
            with open(sortie, 'rb') as f:
                return f.read(), mesh_tools

    def test_rien_supprime_rien_deplace_uv_intactes(self):
        V, F2, UV = cas_texture_avec_trou()
        entree = en_glb(V, F2, UV)
        V0, F0, UV0 = lire_glb(entree)
        sortie, _ = self.lancer(entree)
        V1, F1, UV1 = lire_glb(sortie)
        self.assertEqual(len(V1), len(V0))
        self.assertTrue(np.array_equal(V1, V0))
        self.assertTrue(np.array_equal(UV1, UV0))
        self.assertTrue(np.array_equal(F1[:len(F0)], F0))
        self.assertGreater(len(F1), len(F0))
        self.assertTrue(ferme_et_orientee(V1, F1))
        self.assertEqual(aretes_dirigees_en_double(V1, F1), 0, 'rustine a l envers')

    def test_ferme_refus_explique_sans_fichier(self):
        V, F, UV = sphere_uv(3)
        import tempfile
        if os.path.join(RACINE, 'scripts') not in sys.path:
            sys.path.insert(0, os.path.join(RACINE, 'scripts'))
        sys.modules.pop('mesh_tools', None)
        import mesh_tools
        with tempfile.TemporaryDirectory() as d:
            entree = os.path.join(d, 'e.glb')
            sortie = os.path.join(d, 's.glb')
            with open(entree, 'wb') as f:
                f.write(en_glb(V, F, UV))
            with self.assertRaises(mesh_tools.Refus) as cm:
                mesh_tools.fill_holes(entree, sortie, 3, 2000)
            self.assertIn('Nothing to fill', str(cm.exception))
            self.assertFalse(os.path.exists(sortie))


# ---------------------------------------------------------------------------------------------------------------------------------------
# Parite Python / JavaScript : cas ecrits ici, sorties attendues gravees (build/bouchage_attendus.json)
# ---------------------------------------------------------------------------------------------------------------------------------------
CLES_RESUME = ('sommets', 'faces', 'aretes_de_bord', 'aretes_non_manifold', 'chaines_ouvertes', 'a_boucher', 'trop_petites', 'trop_grandes',
               'degenerees', 'non_triangulables', 'plus_petite', 'plus_grande', 'modes', 'faces_ajoutees', 'restantes', 'verdict',
               'min_aretes', 'max_aretes', 'plafond')


def cas_de_parite():
    cas = []

    def ajouter(nom, V, F, mn=3, mx=2000, budget=None):
        # positions ARRONDIES A 32 BITS : ce que porte un GLB, donc ce que lisent le serveur ET three.js (les apercus) — les triangulations
        # a quasi-egalite sont alors identiques partout.
        cas.append({'nom': nom, 'positions': [float(x) for x in np.asarray(V, dtype=np.float32).astype(np.float64).reshape(-1)], 'indices': [int(x) for x in np.asarray(F).reshape(-1)],
                    'min': mn, 'max': mx, 'budget': budget})

    V, F = sphere(2)
    ajouter('sphere_fermee', V, F)
    ajouter('sphere_trou_3', V, retirer(F, [10]))
    f0 = 0
    voisin = [k for k in range(len(F)) if k != f0 and len(set(F[k]) & set(F[f0])) == 2][0]
    ajouter('sphere_trou_4', V, retirer(F, [f0, voisin]))
    V3, F3 = sphere(2)
    ajouter('sphere_trou_moyen', V3, retirer(F3, region(F3, face_pres(V3, F3, V3[0]), 7)))
    ajouter('sphere_trois_trous_plage', V3, retirer(F3, trois_trous(V3, F3)), 5, 12)
    autour = [k for k in range(len(F)) if 0 in F[k]]
    opposee = [k for k in autour if len(set(F[k]) & set(F[autour[0]])) == 1][0]
    ajouter('sphere_pincement', V, retirer(F, [autour[0], opposee]))
    V5, F5 = sphere(3)
    ajouter('sphere_grand_trou', V5, retirer(F5, region(F5, face_pres(V5, F5, [0, 0, 1]), 260)))
    Vu, Fu, _ = sphere_uv(2)
    ajouter('sphere_couture', Vu, Fu)
    ajouter('sphere_couture_trou', Vu, retirer(Fu, region(Fu, face_pres(Vu, Fu, [-1, 0, 0]), 5)))
    Vp, Fp = plan_sans(20, forme_L())
    ajouter('plan_trou_L', Vp, Fp)
    Vp, Fp = plan_sans(20, forme_croix())
    ajouter('plan_trou_croix', Vp, Fp)
    Vp, Fp = plan_sans(20, carre(3, 3, 8))
    ajouter('plan_trou_carre_32', Vp, Fp)
    Vp, Fp = plan_sans(20, carre(2, 2, 14))
    ajouter('plan_trou_carre_56', Vp, Fp)
    Vt, Ft = t_jonction(V, F)
    ajouter('sphere_t_jonction', Vt, Ft)
    Fr = F3.copy()
    Fr[[3, 40, 200, 201]] = Fr[[3, 40, 200, 201]][:, ::-1]
    ajouter('sphere_faces_retournees', V3, Fr)
    a_, b_ = F[0][0], F[0][1]
    ajouter('sphere_non_manifold', np.vstack([V, V[a_] * 1.3 + V[b_] * 0.4]), np.vstack([F, [[a_, b_, len(V)]]]))
    tetra_v = np.array([[5, 5, 5], [5.1, 5, 5], [5, 5.1, 5], [5, 5, 5.1]], dtype=np.float64)
    Vm, Fm = sphere(3)
    tetra_f = np.array([[0, 2, 1], [0, 1, 3], [1, 2, 3], [0, 3, 2]]) + len(Vm)
    ajouter('sphere_miettes', np.vstack([Vm, tetra_v]), np.vstack([Fm, tetra_f]))
    ajouter('sphere_budget_epuise', V3, retirer(F3, trois_trous(V3, F3)), 3, 2000, B.cout_travail(12) + 10)
    Va, Fa, _ = sphere_ailette_et_trou()
    ajouter('sphere_ailette_et_trou', Va, Fa)
    ajouter('sphere_hors_plage', V3, retirer(F3, region(F3, face_pres(V3, F3, V3[0]), 6)), 40, 60)
    return cas


def sortie_de_reference(cas):
    V = np.array(cas['positions'], dtype=np.float64).reshape(-1, 3)
    F = np.array(cas['indices'], dtype=np.int64).reshape(-1, 3)
    prep = B.preparer(V, F)
    a = B.analyser(V, F, cas['min'], cas['max'], prep=prep, budget=cas.get('budget'))
    d = B.diagnostiquer(prep, a)
    r = {k: a[k] for k in CLES_RESUME}
    r['tolerance'] = a['tolerance']
    r['arete_moyenne'] = a['arete_moyenne']
    r['boucles'] = [{'n': b['n'], 'categorie': b['categorie'], 'mode': b['mode'], 'debut': b['debut'], 'triangles': b['triangles']}
                    for b in a['boucles']]
    r['ajout'] = a['ajout']
    r['diagnostic'] = d
    r['refus'] = list(B.message_refus(a, d, cas['min'], cas['max'])) if a['faces_ajoutees'] == 0 else None
    return r


def graver():
    sortie = []
    for c in cas_de_parite():
        c = dict(c)
        c['attendu'] = sortie_de_reference(c)
        sortie.append(c)
    with open(ATTENDUS, 'w', encoding='utf-8', newline='\r\n') as f:
        json.dump({'description': 'Cas de parite du bouchage de trous (build/bancs/noyaux/test_bouchage_trous.py --ecrire). Le JavaScript '
                                  '(src/renderer/lib/bouchage-trous.js) doit donner les MEMES sorties.', 'cas': sortie}, f, ensure_ascii=False)
        f.write('\n')
    print('grave : %d cas dans %s' % (len(sortie), ATTENDUS))


class TestParite(unittest.TestCase):
    def test_sorties_gravees_a_jour(self):
        with open(ATTENDUS, 'r', encoding='utf-8') as f:
            gravees = json.load(f)['cas']
        self.assertEqual([c['nom'] for c in gravees], [c['nom'] for c in cas_de_parite()])
        for c, ref in zip(gravees, cas_de_parite()):
            self.assertEqual(c['positions'], ref['positions'], c['nom'])
            self.assertEqual(c['indices'], ref['indices'], c['nom'])
            attendu = sortie_de_reference(c)
            self.assertEqual(json.loads(json.dumps(attendu)), json.loads(json.dumps(c['attendu'])), c['nom'])

    def test_exemplaire_modal_identique(self):
        with open(os.path.join(RACINE_DEPOT, 'scripts', 'bouchage_trous.py'), 'rb') as f:
            a = f.read().replace(b'\r\n', b'\n')
        with open(os.path.join(RACINE_DEPOT, 'modal_app', 'bouchage_trous.py'), 'rb') as f:
            b = f.read().replace(b'\r\n', b'\n')
        self.assertEqual(a, b)


if __name__ == '__main__':
    if '--ecrire' in sys.argv:
        graver()
        sys.exit(0)
    unittest.main()
