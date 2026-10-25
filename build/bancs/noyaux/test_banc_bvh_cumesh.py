"""Fonctions de calcul du banc GPU du BVH MIT (modal_app/test_cumesh_bvh.py) — CPU seulement (2026-10-15).

Le banc compare un BVH GPU a des references EXHAUSTIVES en numpy. Ces references sont le seul juge : elles doivent donc
etre justes ELLES-MEMES, et les comparaisons doivent detecter les fautes qu'on veut attraper. Verifie ici :
  1. distances_reference : cas analytiques (au-dessus de la face, au-dela d'une arete, d'un sommet, sur le triangle) ;
     triangles d'aire nulle ignores ; poids barycentriques qui redonnent le point ;
  2. rayon_reference : touche, rate, derriere l'origine, double face, rasant ;
  3. un « faux BVH » exact (la reference elle-meme) donne zero erreur ; un faux BVH qui se trompe est ATTRAPE
     (distance decalee, uvw faux, valeur non finie, triangle degenere rendu, profondeur fausse, rate sans -1) ;
  4. la sphere de test : fermee, rayons qui la touchent, degeneres sans effet sur les references ;
  5. verdict : chaque probleme est signale, un banc propre est valide.

Lancer :  python build/bancs/noyaux/test_banc_bvh_cumesh.py -v
"""
import importlib.util
import os
import sys
import unittest

RACINE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
os.environ['FABMESH_BANC_SANS_MODAL'] = '1'
spec = importlib.util.spec_from_file_location('banc_bvh_sous_test', os.environ.get('NOYAU_BANC_BVH')
                                              or os.path.join(RACINE, 'modal_app', 'test_cumesh_bvh.py'))
B = importlib.util.module_from_spec(spec)
sys.modules['banc_bvh_sous_test'] = B
spec.loader.exec_module(B)

import numpy as np  # noqa: E402

TRI_V = np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0]], dtype=np.float64)
TRI_F = np.array([[0, 1, 2]])


class TestReferences(unittest.TestCase):

    def dist(self, p, v=TRI_V, f=TRI_F):
        return B.distances_reference(np.array(p, dtype=np.float64), v, f)

    def test_au_dessus_de_la_face(self):
        d, i, w = self.dist([0.25, 0.25, 0.7])
        self.assertAlmostEqual(d, 0.7)
        self.assertEqual(i, 0)
        self.assertTrue(np.allclose(w, [0.5, 0.25, 0.25]))

    def test_au_dela_d_une_arete(self):
        d, _, w = self.dist([0.5, -0.3, 0.0])                       # arete ab, milieu
        self.assertAlmostEqual(d, 0.3)
        self.assertTrue(np.allclose(w, [0.5, 0.5, 0.0]))
        d, _, w = self.dist([1.0, 1.0, 0.0])                        # arete bc (hypotenuse), milieu
        self.assertAlmostEqual(d, 2 ** 0.5 / 2)
        self.assertTrue(np.allclose(w, [0.0, 0.5, 0.5]))
        d, _, w = self.dist([-0.4, 0.5, 0.0])                       # arete ac
        self.assertAlmostEqual(d, 0.4)
        self.assertTrue(np.allclose(w, [0.5, 0.0, 0.5]))

    def test_au_dela_d_un_sommet(self):
        for p, attendu, poids in (([-1, -1, 0], 2 ** 0.5, [1, 0, 0]), ([2, -0.5, 0], (1 + 0.25) ** 0.5, [0, 1, 0]),
                                  ([-0.3, 2, 0], (0.09 + 1) ** 0.5, [0, 0, 1])):
            with self.subTest(p):
                d, _, w = self.dist(p)
                self.assertAlmostEqual(d, attendu)
                self.assertTrue(np.allclose(w, poids))

    def test_sur_le_triangle(self):
        d, _, _ = self.dist([0.2, 0.2, 0.0])
        self.assertAlmostEqual(d, 0.0)

    def test_poids_redonnent_le_point_le_plus_proche_sur_une_sphere(self):
        v, f = B.icosphere(3)
        rng = np.random.default_rng(0)
        for p in rng.uniform(-0.7, 0.7, (25, 3)):
            d, i, w = B.distances_reference(p, v, f)
            q = w @ v.astype(np.float64)[f[i]]
            self.assertAlmostEqual(float(np.linalg.norm(q - p)), d, places=9)
            self.assertAlmostEqual(float(w.sum()), 1.0, places=9)
            self.assertTrue((w >= -1e-12).all())

    def test_plus_proche_trouve_par_force_brute_independante(self):
        # echantillonnage dense des points des triangles : la distance minimale ne peut pas etre inferieure a la reference
        v, f = B.icosphere(2)
        vv = v.astype(np.float64)
        rng = np.random.default_rng(5)
        for p in rng.uniform(-0.7, 0.7, (6, 3)):
            d, _, _ = B.distances_reference(p, vv, f)
            u = rng.random((40000, 2))
            u = np.where(u.sum(1, keepdims=True) > 1, 1 - u, u)
            tri = rng.integers(0, len(f), 40000)
            a, b, c = vv[f[tri, 0]], vv[f[tri, 1]], vv[f[tri, 2]]
            pts = a + u[:, :1] * (b - a) + u[:, 1:] * (c - a)
            echantillon = np.linalg.norm(pts - p, axis=1).min()
            self.assertLessEqual(d, echantillon + 1e-12)
            self.assertLess(echantillon - d, 0.02)

    def test_triangle_d_aire_nulle_ignore(self):
        v = np.vstack([TRI_V, [[5.0, 5.0, 5.0]]])
        f = np.array([[0, 1, 2], [3, 3, 3], [0, 0, 1]])
        d, i, _ = B.distances_reference(np.array([5.0, 5.0, 5.1]), v, f)
        self.assertEqual(i, 0)
        self.assertGreater(d, 5.0)

    def test_aucun_triangle_valide(self):
        d, i, _ = B.distances_reference(np.zeros(3), TRI_V, np.array([[0, 0, 1]]))
        self.assertEqual(d, float('inf'))


class TestRayons(unittest.TestCase):

    def ray(self, o, d, v=TRI_V, f=TRI_F):
        return B.rayon_reference(np.array(o, dtype=np.float64), np.array(d, dtype=np.float64), v, f)

    def test_touche_de_face_et_de_dos(self):
        t, i = self.ray([0.2, 0.2, 1.0], [0, 0, -1])
        self.assertAlmostEqual(t, 1.0)
        self.assertEqual(i, 0)
        t, _ = self.ray([0.2, 0.2, -2.0], [0, 0, 1])
        self.assertAlmostEqual(t, 2.0)

    def test_rate_et_derriere_l_origine(self):
        self.assertEqual(self.ray([2, 2, 1], [0, 0, -1]), (float('inf'), -1))
        self.assertEqual(self.ray([0.2, 0.2, 1.0], [0, 0, 1]), (float('inf'), -1))
        self.assertEqual(self.ray([0.2, 0.2, 1.0], [1, 0, 0]), (float('inf'), -1))        # parallele au plan

    def test_premiere_touche_d_une_sphere(self):
        v, f = B.icosphere(3)
        t, i = B.rayon_reference(np.array([0.0, 0.0, 2.0]), np.array([0.0, 0.0, -1.0]), v.astype(np.float64), f)
        self.assertAlmostEqual(t, 2.0 - B.RAYON, delta=0.01)


class FauxBVH:
    """Reponses d'un BVH, faites a partir de la reference exhaustive, avec des fautes injectables."""

    def __init__(self, v, f, faute=None, f_vrais=None):
        self.v, self.f, self.faute = v, f, faute
        self.fr = f if f_vrais is None else f_vrais
        self.vrais_dans_f = None if f_vrais is None else {tuple(t): i for i, t in enumerate(map(tuple, f.tolist()))}

    def indice(self, i):
        return i if self.vrais_dans_f is None else self.vrais_dans_f[tuple(self.fr[i].tolist())]

    def distances(self, pts):
        n = len(pts)
        d, fid, uvw = np.zeros(n), np.zeros(n), np.zeros((n, 3))
        for k in range(n):
            dist, i, w = B.distances_reference(pts[k], self.v, self.fr)
            d[k], fid[k], uvw[k] = dist, self.indice(i), w
        if self.faute == 'decalage':
            d += 3e-5
        elif self.faute == 'uvw':
            uvw = uvw[:, [1, 2, 0]]
        elif self.faute == 'nan':
            d[3] = np.nan
        elif self.faute == 'hors_borne':
            fid[2] = len(self.f) + 5
        elif self.faute == 'degenere':
            fid[:] = self.degenere
        elif self.faute == 'somme':
            uvw = uvw * 1.01
        return d, fid, uvw

    def rayons(self, o, dr):
        n = len(o)
        depth, fid = np.zeros(n), np.zeros(n)
        for k in range(n):
            t, i = B.rayon_reference(o[k], dr[k], self.v, self.fr)
            depth[k] = t if np.isfinite(t) else 1000.0
            fid[k] = self.indice(i) if i >= 0 else -1
        if self.faute == 'profondeur':
            depth = depth * 1.01
        elif self.faute == 'rate_sans_moins_un':
            fid = np.where(fid < 0, -7, fid)          # un rate qui ne rend pas -1
        elif self.faute == 'rate_manque':
            fid[np.flatnonzero(fid >= 0)[:10]] = -1
        return depth, fid


class TestComparaisons(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.v, cls.f = B.icosphere(2)                                 # 320 triangles : references rapides
        cls.fd, cls.idx_deg = B.ajouter_degeneres(cls.f, n=12)
        cls.pts, cls.ro, cls.rd = B.points_et_rayons(120, 120)

    def distances(self, faute=None, degeneres=False):
        faces = self.fd if degeneres else self.f
        bvh = FauxBVH(self.v, faces, faute, f_vrais=self.f if degeneres else None)
        if faute == 'degenere':
            bvh.degenere = int(self.idx_deg[0])
        d, fid, uvw = bvh.distances(self.pts)
        return B.comparer_distances(self.v, faces, self.pts, d, fid, uvw, f_vrais=self.f,
                                    degeneres=self.idx_deg if degeneres else ())

    def rayons(self, faute=None):
        d, fid = FauxBVH(self.v, self.f, faute).rayons(self.ro, self.rd)
        return B.comparer_rayons(self.v, self.f, self.ro, self.rd, d, fid)

    def test_reponses_exactes_zero_erreur(self):
        r = self.distances()
        self.assertEqual((r['non_finis'], r['face_id_hors_borne'], r['degeneres_rendus']), (0, 0, 0))
        self.assertLess(r['erreur_distance_max'], 1e-12)
        self.assertLess(r['recomposition_max'], 1e-9)
        self.assertLess(r['somme_barycentrique_max'], 1e-9)
        r = self.rayons()
        self.assertEqual(r['desaccords_touche_rate'], 0)
        self.assertLess(r['erreur_profondeur_rel_max'], 1e-12)

    def test_rayons_du_banc_touchent_la_sphere_en_majorite(self):
        _, fid = FauxBVH(self.v, self.f).rayons(self.ro, self.rd)
        self.assertGreater(int((fid >= 0).sum()), 20)
        self.assertGreater(int((fid < 0).sum()), 3, 'il faut aussi des rates pour verifier face_id = -1')

    def test_degeneres_sans_effet_quand_ils_ne_gagnent_pas(self):
        r = self.distances(degeneres=True)
        self.assertEqual(r['degeneres_rendus'], 0)
        self.assertLess(r['erreur_distance_max'], 1e-12)

    def test_chaque_faute_est_attrapee(self):
        cas = {
            'decalage': (self.distances('decalage'), 'erreur_distance_max', B.SEUIL_DISTANCE),
            'uvw': (self.distances('uvw'), 'recomposition_max', B.SEUIL_RECOMPOSITION),
            'somme': (self.distances('somme'), 'somme_barycentrique_max', B.SEUIL_BARYCENTRIQUE),
        }
        for nom, (r, cle, seuil) in cas.items():
            with self.subTest(nom):
                self.assertGreater(r[cle], seuil)
        self.assertGreaterEqual(self.distances('nan')['non_finis'], 1)
        self.assertGreaterEqual(self.distances('hors_borne')['face_id_hors_borne'], 1)
        self.assertGreaterEqual(self.distances('degenere', degeneres=True)['degeneres_rendus'], 1)
        self.assertGreater(self.rayons('profondeur')['erreur_profondeur_rel_max'], B.SEUIL_PROFONDEUR)
        self.assertGreater(self.rayons('rate_sans_moins_un')['rate_sans_face_id_moins_un'], 0)
        self.assertGreaterEqual(self.rayons('rate_manque')['desaccords_touche_rate'], 10)


@unittest.skipIf(importlib.util.find_spec('torch') is None, 'torch absent')
class TestOrchestration(unittest.TestCase):
    """mesurer_dans_ce_processus de bout en bout, SUR LE CPU, avec un faux module cumesh exact (la reference elle-meme).
    Verifie la plomberie que le GPU n'exercera qu'une fois : conversions torch/numpy, indices de face_id, degeneres,
    repetitions, structure du verdict. Aucune carte graphique n'est touchee (device='cpu')."""

    def faux_cumesh(self, faute=None):
        import torch
        construits = {'n': 0}

        class FauxCuBVH:
            def __init__(self, v, tri):
                self.v = np.asarray(v, dtype=np.float64)
                self.f = tri.numpy().astype(np.int64)
                construits['n'] += 1
                self.rang = construits['n']
                # le BVH garde tous les triangles mais ignore ceux d'aire nulle (comme le BVH MIT)

            def unsigned_distance(self, positions, return_uvw=False):
                p = positions.numpy().astype(np.float64)
                n = len(p)
                d, fid, uvw = np.zeros(n, np.float32), np.zeros(n, np.int64), np.zeros((n, 3), np.float32)
                for k in range(n):
                    dist, i, w = B.distances_reference(p[k], self.v, self.f)
                    d[k], fid[k], uvw[k] = dist, i, w
                if faute == 'decalage':
                    d += np.float32(1e-3)
                elif faute == 'instable':
                    d += np.float32(1e-7) * self.rang          # chaque nouveau BVH repond un peu autrement
                return torch.from_numpy(d), torch.from_numpy(fid), (torch.from_numpy(uvw) if return_uvw else None)

            def ray_trace(self, o, dr):
                o, dr = o.numpy().astype(np.float64), dr.numpy().astype(np.float64)
                n = len(o)
                pos, fid, dep = np.zeros((n, 3), np.float32), np.zeros(n, np.int64), np.zeros(n, np.float32)
                for k in range(n):
                    t, i = B.rayon_reference(o[k], dr[k], self.v, self.f)
                    fid[k], dep[k] = i, (t if np.isfinite(t) else 1000.0)
                return torch.from_numpy(pos), torch.from_numpy(fid), torch.from_numpy(dep)

        class Module:
            __file__ = '<faux cumesh exact>'
            cuBVH = FauxCuBVH
        return Module

    def lancer(self, faute=None):
        return B.mesurer_dans_ce_processus(repetitions=2, cumesh_module=self.faux_cumesh(faute), device='cpu',
                                           niveaux_grand=1, n_requetes=300, n_points=90, n_rayons=90)

    def test_bout_en_bout_banc_valide(self):
        r = self.lancer()
        self.assertTrue(r['verdict']['banc_valide'], r['verdict'])
        self.assertEqual(set(r['distances']), {'sphere', 'sphere_avec_degeneres'})
        self.assertEqual(set(r['rayons']), {'sphere', 'sphere_avec_degeneres'})
        self.assertTrue(r['repetitions_identiques'])
        self.assertEqual(r['durees']['triangles'], 80)
        self.assertEqual(r['durees']['distance_non_finie'], 0)
        self.assertEqual(r['distances']['sphere_avec_degeneres']['degeneres_rendus'], 0)

    def test_deux_bvh_successifs_differents_invalident_le_banc(self):
        r = self.lancer('instable')
        self.assertFalse(r['repetitions_identiques'])
        self.assertFalse(r['verdict']['banc_valide'])
        self.assertTrue(any('successifs' in p for p in r['verdict']['problemes']), r['verdict'])
        self.assertFalse(any('erreur de distance' in p for p in r['verdict']['problemes']),
                         'seule la repetition doit etre en cause')

    def test_un_bvh_faux_invalide_le_banc(self):
        r = self.lancer('decalage')
        self.assertFalse(r['verdict']['banc_valide'])
        self.assertTrue(any('erreur de distance' in p for p in r['verdict']['problemes']), r['verdict'])


class TestVerdict(unittest.TestCase):

    BON_D = {'points': 10, 'non_finis': 0, 'face_id_hors_borne': 0, 'degeneres_rendus': 0, 'erreur_distance_max': 1e-7,
             'recomposition_max': 1e-7, 'somme_barycentrique_max': 1e-7}
    BON_R = {'rayons': 10, 'desaccords_touche_rate': 0, 'fraction_desaccord': 0.0, 'erreur_profondeur_rel_max': 1e-7,
             'rate_sans_face_id_moins_un': 0}

    def res(self, d=None, r=None, identiques=True):
        return {'distances': {'s': dict(self.BON_D, **(d or {}))}, 'rayons': {'s': dict(self.BON_R, **(r or {}))},
                'repetitions_identiques': identiques}

    def test_banc_propre(self):
        v = B.verdict(self.res())
        self.assertTrue(v['banc_valide'], v)

    def test_chaque_probleme_invalide(self):
        for nom, res in {
            'non fini': self.res(d={'non_finis': 1}),
            'hors borne': self.res(d={'face_id_hors_borne': 1}),
            'degenere': self.res(d={'degeneres_rendus': 1}),
            'distance': self.res(d={'erreur_distance_max': 1e-3}),
            'recomposition': self.res(d={'recomposition_max': 1e-3}),
            'barycentrique': self.res(d={'somme_barycentrique_max': 1e-2}),
            'desaccord': self.res(r={'desaccords_touche_rate': 5, 'fraction_desaccord': 0.5}),
            'profondeur': self.res(r={'erreur_profondeur_rel_max': 1e-2}),
            'rate': self.res(r={'rate_sans_face_id_moins_un': 2}),
            'repetition': self.res(identiques=False),
            'rien': {},
        }.items():
            with self.subTest(nom):
                v = B.verdict(res)
                self.assertFalse(v['banc_valide'])
                self.assertTrue(v['problemes'])

    def test_rayons_rasants_toleres(self):
        v = B.verdict(self.res(r={'desaccords_touche_rate': 1, 'fraction_desaccord': 1 / 1500}))
        self.assertTrue(v['banc_valide'], v)


class TestMaillage(unittest.TestCase):

    def test_sphere_fermee_et_rayon(self):
        v, f = B.icosphere(3)
        aretes = np.concatenate([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]]).tolist()
        orientees = set(map(tuple, aretes))
        self.assertEqual(len(orientees), len(aretes))
        self.assertTrue(all((b, a) in orientees for a, b in orientees))
        self.assertTrue(np.allclose(np.linalg.norm(v, axis=1), B.RAYON, atol=1e-6))
        self.assertEqual(len(f), 20 * 4 ** 3)

    def test_degeneres_sont_degeneres_et_faits_de_vrais_sommets(self):
        v, f = B.icosphere(2)
        fd, idx = B.ajouter_degeneres(f, n=15)
        self.assertEqual(len(fd), len(f) + 15)
        self.assertEqual(len(idx), 15)
        vv = v.astype(np.float64)
        aire = np.linalg.norm(np.cross(vv[fd[:, 1]] - vv[fd[:, 0]], vv[fd[:, 2]] - vv[fd[:, 0]]), axis=1)
        self.assertTrue((aire[idx] == 0).all())
        self.assertTrue((np.delete(aire, idx) > 0).all())
        self.assertLess(int(fd.max()), len(v))

    def test_points_et_rayons_reproductibles(self):
        a = B.points_et_rayons(60, 60)
        b = B.points_et_rayons(60, 60)
        for x, y in zip(a, b):
            self.assertTrue(np.array_equal(x, y))
        self.assertTrue(np.allclose(np.linalg.norm(a[2], axis=1), 1.0, atol=1e-5))


if __name__ == '__main__':
    unittest.main()
