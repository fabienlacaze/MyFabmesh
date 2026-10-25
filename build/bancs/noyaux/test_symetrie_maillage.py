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
        self.assertEqual(len(F), st['gardees'] + st['miroir'])
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


if __name__ == '__main__':
    unittest.main(verbosity=2)
