"""Banc de l'outil « Symmetrize mesh » (scripts/symmetrize_mesh.py = noyau de modal_app/_symetrie.py).
Maillages reels (icosphere deformee, sphere a UV), aucun GPU. Lancer : python build/bancs/noyaux/test_symetrie_maillage.py"""
import io, json, os, struct, sys, unittest
import numpy as np
import trimesh

RACINE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
sys.path.insert(0, os.path.join(RACINE, 'scripts'))
import symmetrize_mesh as S


def blob(sub=3):
    """Sphere asymetrique : etiree, une bosse d'un cote, decalee (rien ne tombe sur le plan x=0.1 par hasard)."""
    m = trimesh.creation.icosphere(subdivisions=sub, radius=1.0)
    v = m.vertices.copy()
    v[:, 0] *= 1.4
    v[:, 1] *= 0.8
    bosse = np.exp(-(((v - np.array([1.0, 0.3, 0.2])) ** 2).sum(axis=1)) / 0.08)
    v += (v / np.linalg.norm(v, axis=1, keepdims=True)) * bosse[:, None] * 0.5
    v += np.array([0.3, 0.1, -0.2])
    return trimesh.Trimesh(vertices=v, faces=m.faces, process=False)


def souder(V, F):
    m = trimesh.Trimesh(vertices=np.asarray(V), faces=np.asarray(F), process=False)
    m.merge_vertices(digits_vertex=6)
    m.update_faces(m.nondegenerate_faces())
    return m


def aretes_de_bord(m):
    e = np.sort(m.edges, axis=1)
    _, c = np.unique(e, axis=0, return_counts=True)
    return int((c == 1).sum()), int((c > 2).sum())


def symetrique(V, point, nn, tol=1e-5):
    """Nombre de sommets dont l'image miroir n'existe pas dans le maillage (a tol pres)."""
    R = V - 2.0 * ((V - point) @ nn)[:, None] * nn
    cle = lambda P: set(map(tuple, np.round(P / tol).astype(np.int64)))
    a = cle(V)
    voisins = [(dx, dy, dz) for dx in (-1, 0, 1) for dy in (-1, 0, 1) for dz in (-1, 0, 1)]
    manque = 0
    for p in R:
        k = tuple(np.round(p / tol).astype(np.int64))
        if k not in a and not any((k[0] + d[0], k[1] + d[1], k[2] + d[2]) in a for d in voisins):
            manque += 1
    return manque


class Noyau(unittest.TestCase):
    def verifier(self, point, normal, garder='pos'):
        m = blob()
        V, F, A, N, st = S.symetriser_tableaux(m.vertices, m.faces, None, None, point, normal, garder)
        nn = np.array(normal, float)
        nn /= np.linalg.norm(nn)
        w = souder(V, F)
        bord, multi = aretes_de_bord(w)
        self.assertEqual(bord, 0, 'aretes de bord sur un maillage ferme')
        self.assertEqual(multi, 0)
        self.assertTrue(w.is_winding_consistent, 'normales coherentes')
        self.assertTrue(w.is_watertight)
        self.assertGreater(w.volume, 0, 'volume positif = normales vers l exterieur')
        self.assertEqual(symetrique(V, np.array(point, float), nn), 0, 'symetrie a 1e-5')
        self.assertEqual(len(F), st['gardees'] + st['miroir'])
        return V, F, w

    def test_plan_x(self):
        self.verifier((0.1, 0, 0), (1, 0, 0))

    def test_plan_x_cote_negatif(self):
        V, F, w = self.verifier((0.1, 0, 0), (1, 0, 0), 'neg')
        self.assertGreater(V[:, 0].max(), 0.1)      # le miroir du cote x < 0.1 est a x > 0.1

    def test_plan_y_z(self):
        self.verifier((0, 0.05, 0), (0, 1, 0))
        self.verifier((0, 0, -0.1), (0, 0, 1))

    def test_plan_incline(self):
        self.verifier((0.2, 0.0, 0.0), (1, 0.4, -0.3))

    def test_plan_par_des_sommets(self):
        # le plan passe EXACTEMENT par des sommets (y = 0 d'une icosphere) : pas de trou, pas de doublon
        m = trimesh.creation.icosphere(subdivisions=2)
        V, F, A, N, st = S.symetriser_tableaux(m.vertices, m.faces, None, None, (0, 0, 0), (0, 1, 0))
        w = souder(V, F)
        self.assertEqual(aretes_de_bord(w), (0, 0))
        self.assertTrue(w.is_watertight and w.is_winding_consistent)

    def test_uv_et_normales(self):
        m = blob(2)
        uv = np.stack([(m.vertices[:, 0] + 2) / 4, (m.vertices[:, 1] + 2) / 4], axis=1)
        N = np.asarray(m.vertex_normals).copy()
        V, F, A, N2, st = S.symetriser_tableaux(m.vertices, m.faces, uv, N, (0.1, 0, 0), (1, 0, 0))
        self.assertEqual(A.shape, (len(V), 2))
        cote = (V[:, 0] - 0.1) > 1e-4
        miroir = (V[:, 0] - 0.1) < -1e-4
        R = V[cote].copy()
        R[:, 0] = 0.2 - R[:, 0]
        arr = {tuple(np.round(p, 5)): i for i, p in zip(np.nonzero(miroir)[0], V[miroir])}
        n_ok = 0
        for j, p in zip(np.nonzero(cote)[0], R):
            i = arr.get(tuple(np.round(p, 5)))
            if i is None:
                continue
            n_ok += 1
            self.assertTrue(np.allclose(A[i], A[j]), 'UV reprises du cote source')
            self.assertTrue(np.allclose(N2[i], N2[j] * np.array([-1, 1, 1]), atol=1e-6), 'normale reflechie')
        self.assertGreater(n_ok, 50)
        self.assertTrue(np.allclose(np.linalg.norm(N2, axis=1), 1.0, atol=1e-6))

    def test_rien_a_recopier(self):
        m = blob(1)
        with self.assertRaises(ValueError):
            S.symetriser_tableaux(m.vertices, m.faces, None, None, (50, 0, 0), (1, 0, 0), 'pos')

    def test_zone(self):
        m = blob(3)
        stamps = [[1.0, 0.3, 0.2, 0.5, 1]]       # zone peinte du cote x > 0.1
        V, F, A, N, st = S.symetriser_tableaux(m.vertices, m.faces, None, None, (0.1, 0, 0), (1, 0, 0), 'pos', 'mask', stamps)
        self.assertGreater(st['miroir'], 0)
        self.assertGreater(st['retirees'], 0)
        self.assertEqual(len(F), st['gardees'] + st['miroir'] + st['ponts'])
        self.assertEqual(len(m.faces) - st['retirees'], st['gardees'])
        self.assertLess(V[len(V) - 1][0], 0.1 + 1e-9)       # la copie est de l'autre cote
        with self.assertRaises(ValueError):
            S.symetriser_tableaux(m.vertices, m.faces, None, None, (0.1, 0, 0), (1, 0, 0), 'pos', 'mask', [])

    def test_gomme(self):
        c = np.array([[0.0, 0, 0], [1.0, 0, 0], [2.0, 0, 0]])
        sel = S.region_faces(c, [[1, 0, 0, 5, 1], [1, 0, 0, 0.2, 0]])
        self.assertEqual(sel.tolist(), [True, False, True])

    def test_refus_anime(self):
        def glb(doc):
            j = json.dumps(doc).encode()
            j += b' ' * ((4 - len(j) % 4) % 4)
            return b'glTF' + struct.pack('<II', 2, 20 + len(j)) + struct.pack('<I', len(j)) + b'JSON' + j
        self.assertIsNone(S.refus_glb(glb({'asset': {'version': '2.0'}, 'meshes': [{'primitives': [{'attributes': {'POSITION': 0}}]}]})))
        self.assertIn('rigged', S.refus_glb(glb({'skins': [{'joints': [0]}]})))
        self.assertIn('rigged', S.refus_glb(glb({'meshes': [{'primitives': [{'attributes': {'JOINTS_0': 1}}]}]})))
        self.assertIn('rigged', S.refus_glb(glb({'animations': [{}]})))


class Scene(unittest.TestCase):
    def test_glb_aller_retour(self):
        m = blob(3)
        uv = np.stack([(m.vertices[:, 0] + 2) / 4, (m.vertices[:, 1] + 2) / 4], axis=1)
        from PIL import Image
        img = Image.fromarray((np.random.rand(16, 16, 3) * 255).astype(np.uint8))
        m.visual = trimesh.visual.TextureVisuals(uv=uv, material=trimesh.visual.material.PBRMaterial(baseColorTexture=img))
        sc = trimesh.Scene()
        sc.add_geometry(m, node_name='corps')
        T = np.eye(4)
        T[0, 3] = 0.5                      # un noeud translate : doit etre cuit
        sc.graph.update(frame_to='corps', matrix=T)
        brut = sc.export(file_type='glb')
        self.assertIsNone(S.refus_glb(brut))
        sc2 = trimesh.load(io.BytesIO(brut), file_type='glb', force='scene')
        res, st = S.symetriser_scene(sc2, {'point': [0.8, 0, 0], 'normal': [1, 0, 0], 'keep': 'pos'})
        back = trimesh.load(io.BytesIO(res.export(file_type='glb')), file_type='glb', force='scene')
        g = list(back.geometry.values())[0]
        self.assertEqual(g.visual.kind, 'texture')
        self.assertIsNotNone(g.visual.material.baseColorTexture)
        w = souder(g.vertices, g.faces)
        self.assertEqual(aretes_de_bord(w), (0, 0))
        self.assertEqual(symetrique(np.asarray(g.vertices), np.array([0.8, 0, 0]), np.array([1.0, 0, 0]), 1e-4), 0)

    def test_plusieurs_pieces(self):
        a = blob(2)
        b = blob(2)
        b.apply_translation([0, 3, 0])
        sc = trimesh.Scene()
        sc.add_geometry(a, node_name='a')
        sc.add_geometry(b, node_name='b')
        res, st = S.symetriser_scene(sc, {'point': [0.1, 0, 0], 'normal': [1, 0, 0]})
        self.assertEqual(len(res.geometry), 2)


    def test_zone_sur_une_seule_piece(self):
        a = blob(2)
        b = trimesh.creation.box(extents=[0.5, 0.5, 0.5])
        b.apply_translation([0.3, 0, 0])
        sc = trimesh.Scene()
        sc.add_geometry(a, node_name='a')
        sc.add_geometry(b, node_name='b')
        C = a.vertices[np.argmin(a.vertices[:, 0])]
        res, st = S.symetriser_scene(sc, {'point': [0.1, 0, 0], 'normal': [1, 0, 0], 'keep': 'neg', 'mode': 'mask',
                                          'stamps': [[C[0], C[1], C[2], 0.5, 1]]})
        self.assertEqual(len(res.geometry), 2)
        self.assertGreater(st['miroir'], 0)
        self.assertTrue(any(len(g.vertices) == len(b.vertices) and np.allclose(g.vertices, b.vertices) for g in res.geometry.values()))   # la piece non peinte reste intacte
        with self.assertRaises(ValueError):
            S.symetriser_scene(sc, {'point': [0.1, 0, 0], 'normal': [1, 0, 0], 'keep': 'neg', 'mode': 'mask', 'stamps': [[50, 50, 50, 0.1, 1]]})

    def test_face_plate_sur_le_plan(self):
        cube = trimesh.creation.box(extents=[1, 1, 1])
        cube.apply_translation([0.5, 0, 0])      # faces x=0 et x=1
        for garder, ok in (('pos', True), ('neg', False)):
            if ok:
                V, F, A, N, st = S.symetriser_tableaux(cube.vertices, cube.faces, None, None, (0, 0, 0), (1, 0, 0), garder)
                w = souder(V, F)
                self.assertEqual(aretes_de_bord(w), (0, 0))
                self.assertAlmostEqual(abs(w.volume), 2.0, places=5)
            else:
                with self.assertRaises(ValueError):
                    S.symetriser_tableaux(cube.vertices, cube.faces, None, None, (0, 0, 0), (1, 0, 0), garder)
        V, F, A, N, st = S.symetriser_tableaux(cube.vertices, cube.faces, None, None, (1, 0, 0), (1, 0, 0), 'neg')
        w = souder(V, F)
        self.assertEqual(aretes_de_bord(w), (0, 0))
        self.assertAlmostEqual(abs(w.volume), 2.0, places=5)

    def test_zone_tranche_equivaut_au_balayage_complet(self):
        rng = np.random.default_rng(1)
        C = rng.random((5000, 3))
        st = [[0.5, 0.5, 0.5, 0.3, 1], [0.5, 0.5, 0.5, 0.1, 0], [0.9, 0.1, 0.2, 0.2, 1]]
        ref = np.zeros(len(C), bool)
        for x, y, z, r, s in st:
            ref[((C - [x, y, z]) ** 2).sum(axis=1) <= r * r] = s >= 0.5
        self.assertTrue((S.region_faces(C, st) == ref).all())


def sphere_bosse(sub, bosse, k=0.25, w=0.1, seed=0):
    """Sphere de rayon 1 centree sur le plan x=0 (quasi symetrique, sommets bruites pour que rien ne coincide), avec une
    bosse locale : copier la bosse de l'autre cote est le cas d'usage de l'outil."""
    m = trimesh.creation.icosphere(subdivisions=sub)
    v = m.vertices.copy()
    v += np.random.default_rng(seed).normal(0, 0.004, v.shape)
    b = np.exp(-(((v - np.array(bosse)) ** 2).sum(axis=1)) / w)
    v += v / np.linalg.norm(v, axis=1, keepdims=True) * b[:, None] * k
    return trimesh.Trimesh(vertices=v, faces=m.faces, process=False)


def tampons_sur(m, bosse, r, n=12, etalement=0.15, seed=0):
    rng = np.random.default_rng(seed + 1)
    c = np.array(bosse, float)
    pts = c / np.linalg.norm(c) + rng.normal(0, etalement, (n, 3))
    v = m.vertices
    return [[*v[int(np.argmin(((v - p) ** 2).sum(axis=1)))], r, 1] for p in pts]


CAS_COUTURE = [
    ('bosse +x', (1, 0, 0), 0.25, 'pos'),
    ('bosse oblique', (0.8, 0.5, 0.3), 0.25, 'pos'),
    ('bosse a cheval sur le plan', (0.15, 0.9, 0.1), 0.3, 'pos'),
    ('bosse centree sur le plan', (0.0, 0.0, 1.0), 0.3, 'pos'),
    ('grande zone', (0.7, 0.0, 0.7), 0.6, 'pos'),
    ('cote negatif', (-1, 0.2, 0), 0.25, 'neg'),
]


class Couture(unittest.TestCase):
    """Mode zone : la copie miroir est soudee au reste du maillage (aucune arete de bord sur un maillage ferme)."""

    def lancer(self, sub, bosse, r, garder, nst=12, etalement=0.15):
        m = sphere_bosse(sub, bosse)
        st = tampons_sur(m, bosse, r, nst, etalement)
        V, F, A, N, stats = S.symetriser_tableaux(m.vertices, m.faces, None, None, (0, 0, 0), (1, 0, 0), garder, 'mask', st)
        return m, V, F, stats

    def verifier(self, nom, sub, bosse, r, garder, **kw):
        m, V, F, stats = self.lancer(sub, bosse, r, garder, **kw)
        w = souder(V, F)
        self.assertEqual(aretes_de_bord(w), (0, 0), nom + ' : aretes de bord / non manifold apres soudure par position')
        self.assertTrue(w.is_watertight and w.is_winding_consistent, nom)
        self.assertGreater(w.volume, 0, nom)
        self.assertEqual(stats['ouvert'], 0, nom + ' : le noyau annonce une couture ouverte')
        self.assertGreater(stats['ponts'], 0, nom)
        self.assertEqual(S._bord_dirige(F, len(V)).shape[0], 0, nom + ' : bord ouvert dans les indices memes (sans fusion)')
        self.assertEqual(len(F), stats['gardees'] + stats['miroir'] + stats['ponts'])
        return stats

    def test_couture_fermee(self):
        for sub in (4, 5):
            for nom, bosse, r, garder in CAS_COUTURE:
                self.verifier('%s (sub %d)' % (nom, sub), sub, bosse, r, garder)

    def test_disque_a_cheval_sur_le_plan(self):
        # la zone touche le plan : les sommets de la copie tombent SUR des aretes du maillage (jonction en T)
        for sub in (3, 4):
            m = blob(sub)
            for cible in ([0.3, 0.3, 0.2], [0.2, 0.0, 0.0]):
                v = m.vertices
                c = v[int(np.argmin(((v - np.array(cible)) ** 2).sum(axis=1)))]
                V, F, A, N, st = S.symetriser_tableaux(v, m.faces, None, None, (0.1, 0, 0), (1, 0, 0), 'pos', 'mask', [[*c, 0.5, 1]])
                w = souder(V, F)
                self.assertEqual(aretes_de_bord(w), (0, 0))
                self.assertTrue(w.is_watertight and w.is_winding_consistent)
                self.assertEqual(st['ouvert'], 0)

    def test_uv_et_normales_de_la_couture(self):
        m = sphere_bosse(4, (1, 0, 0))
        uv = np.stack([(m.vertices[:, 0] + 2) / 4, (m.vertices[:, 1] + 2) / 4], axis=1)
        N = np.asarray(m.vertex_normals).copy()
        V, F, A, N2, st = S.symetriser_tableaux(m.vertices, m.faces, uv, N, (0, 0, 0), (1, 0, 0), 'pos', 'mask',
                                                tampons_sur(m, (1, 0, 0), 0.25))
        self.assertEqual(A.shape, (len(V), 2))
        self.assertEqual(N2.shape, (len(V), 3))
        self.assertTrue(np.isfinite(A).all() and np.isfinite(N2).all())
        self.assertTrue(F.max() < len(V) and F.min() >= 0)

    def test_chaque_etage_est_necessaire(self):
        """Sans la bande, sans la regularisation (ilots, sommets pinces) ou sans la resorption des jonctions en T, au moins
        un des cas ci-dessus reste ouvert : aucun etage n'est decoratif."""
        import unittest.mock as mock
        cas = [(sub, b, r, g) for sub in (3, 4, 5) for _, b, r, g in CAS_COUTURE]

        def defauts():
            n = 0
            for sub, b, r, g in cas:
                try:
                    m, V, F, stats = self.lancer(sub, b, r, g)
                except ValueError:
                    continue
                n += sum(aretes_de_bord(souder(V, F)))
            return n

        self.assertEqual(defauts(), 0)
        with mock.patch.object(S, 'relier_trou_et_copie', lambda V, A, C: np.zeros((0, 3), dtype=np.int64)):
            self.assertGreater(defauts(), 0, 'sans la bande de couture')
        with mock.patch.object(S, 'combler_ilots', lambda F, region, M, permis, limite=40: region):
            self.assertGreater(defauts(), 0, 'sans la regularisation de la zone')
        with mock.patch.object(S, 'resorber_colineaires', lambda V, corps, ponts: (corps, ponts)):
            self.assertGreater(defauts(), 0, 'sans la resorption des jonctions en T')

    def test_copie_dans_le_vide_reste_ouverte_et_le_dit(self):
        # la zone peinte tombe de l'autre cote dans le vide (maillage tres asymetrique) : pas de vis-a-vis, rien d'invente
        m = blob(3)
        V, F, A, N, st = S.symetriser_tableaux(m.vertices, m.faces, None, None, (-3.0, 0, 0), (1, 0, 0), 'pos', 'mask',
                                               [[*m.vertices[int(np.argmax(m.vertices[:, 0]))], 0.4, 1]])
        self.assertEqual(st['retirees'], 0)
        self.assertEqual(st['ponts'], 0)
        self.assertGreater(st['ouvert'], 0)


class Vitesse(unittest.TestCase):
    def test_region_faces_egale_le_balayage_complet_avec_beaucoup_de_tampons(self):
        rng = np.random.default_rng(7)
        C = rng.random((20000, 3)) * [3.0, 1.0, 0.5]
        st = [[*(rng.random(3) * [3.4, 1.2, 0.7] - 0.1), float(rng.choice([0.03, 0.1, 0.3, 0.8])), int(rng.random() > 0.2)] for _ in range(400)]
        for refl in (None, (np.array([1.5, 0.2, 0.1]), np.array([0.6, 0.8, 0.0]))):
            ref = np.zeros(len(C), bool)
            for x, y, z, r, v in st:
                c = np.array([x, y, z])
                if refl is not None:
                    c = c - 2.0 * float(np.dot(c - refl[0], refl[1])) * refl[1]
                ref[((C - c) ** 2).sum(axis=1) <= r * r] = v >= 0.5
            self.assertTrue((S.region_faces(C, st, refl) == ref).all())

    def test_327680_faces_1200_tampons_moins_d_une_seconde(self):
        import time
        m = trimesh.creation.icosphere(subdivisions=7)
        self.assertEqual(len(m.faces), 327680)
        C = m.triangles_center
        rng = np.random.default_rng(0)
        st = [[*m.vertices[i], 0.15, 1 if j % 7 else 0] for j, i in enumerate(rng.choice(len(m.vertices), 1200))]
        t = time.time()
        S.region_faces(C, st)
        S.region_faces(C, st, (np.array([0.1, 0, 0]), np.array([1.0, 0, 0])))
        duree = time.time() - t
        self.assertLess(duree, 1.0, 'les deux balayages de la zone : %.2f s' % duree)

    def test_symetrie_de_zone_complete_a_327680_faces(self):
        import time
        m = trimesh.creation.icosphere(subdivisions=7)
        v = m.vertices.copy()
        v[:, 0] *= 1.4
        v += np.array([0.3, 0.1, -0.2]) + np.random.default_rng(3).normal(0, 0.0005, v.shape)
        rng = np.random.default_rng(0)
        cand = np.nonzero(v[:, 0] > 1.0)[0]
        st = [[*v[i], 0.06, 1] for i in rng.choice(cand, 1200)]
        t = time.time()
        V, F, A, N, stats = S.symetriser_tableaux(v, m.faces, None, None, (0.3, 0, 0), (1, 0, 0), 'pos', 'mask', st)
        duree = time.time() - t
        self.assertLess(duree, 3.0, 'symetrie de zone complete : %.2f s (13 s avant)' % duree)
        self.assertGreater(stats['miroir'], 10000)


if __name__ == '__main__':
    unittest.main(verbosity=2)
