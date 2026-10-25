"""Operation `recolor` de Modal (modal_app/_mesh_op.py) et script bureau scripts/mesh_recolor.py, sur un vrai GLB texture de test."""
import base64
import io
import os
import subprocess
import sys
import tempfile
import unittest

import numpy as np
import trimesh
from PIL import Image

RACINE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
sys.path.insert(0, RACINE)
sys.path.insert(0, os.path.join(RACINE, 'scripts'))


def _glb():
    cube = trimesh.creation.box(extents=(1, 1, 1))
    uv = np.array([[0, 0], [1, 0], [1, 1], [0, 1]] * 2, dtype=np.float32)[: len(cube.vertices)]
    if len(uv) < len(cube.vertices):
        uv = np.vstack([uv, np.zeros((len(cube.vertices) - len(uv), 2), np.float32)])
    tex = np.zeros((32, 32, 3), np.uint8)
    tex[:, :16] = (200, 60, 60)
    tex[:, 16:] = (60, 60, 200)
    mat = trimesh.visual.material.PBRMaterial(baseColorTexture=Image.fromarray(tex, 'RGB'))
    cube.visual = trimesh.visual.TextureVisuals(uv=uv, material=mat)
    sc = trimesh.Scene(cube)
    return sc.export(file_type='glb')


def _texture(glb):
    sc = trimesh.load(io.BytesIO(glb), file_type='glb', force='scene')
    g = list(sc.geometry.values())[0]
    return np.asarray(g.visual.material.baseColorTexture.convert('RGB'))


class TestRecolorOp(unittest.TestCase):
    def test_modal_tout_le_modele(self):
        from modal_app import _mesh_op
        sortie, stats = _mesh_op._executer('recolor', _glb(), {'color': '#22c55e', 'intensity': 1.0})
        t = _texture(sortie)
        self.assertGreater(int(t[5, 5, 1]), int(t[5, 5, 0]))
        self.assertGreater(int(t[5, 25, 1]), int(t[5, 25, 2]))

    def test_modal_zone(self):
        from modal_app import _mesh_op
        masque = np.zeros((32, 32), np.uint8); masque[:, 16:] = 255
        buf = io.BytesIO(); Image.fromarray(masque, 'L').save(buf, 'PNG')
        url = 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()
        avant = _texture(_glb())
        sortie, _ = _mesh_op._executer('recolor', _glb(), {'color': '#ffffff', 'intensity': 1.0, 'uv_mask': url})
        t = _texture(sortie)
        self.assertTrue(np.abs(t[:, :10].astype(int) - avant[:, :10].astype(int)).max() <= 3)   # hors zone (bord adouci exclu)
        self.assertNotEqual(tuple(t[5, 28]), tuple(avant[5, 28]))

    def test_modal_couleur_invalide(self):
        from modal_app import _mesh_op
        with self.assertRaises(ValueError):
            _mesh_op._executer('recolor', _glb(), {'color': 'rouge', 'intensity': 1.0})

    def test_bureau_script(self):
        with tempfile.TemporaryDirectory() as d:
            entree, sortie = os.path.join(d, 'a.glb'), os.path.join(d, 'b.glb')
            open(entree, 'wb').write(_glb())
            r = subprocess.run([sys.executable, '-I', os.path.join(RACINE, 'scripts', 'mesh_recolor.py'), entree, sortie, '--color', '#f08a23', '--intensity', '1'],
                               capture_output=True, text=True, timeout=120)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            t = _texture(open(sortie, 'rb').read())
            self.assertGreater(int(t[5, 5, 0]), int(t[5, 5, 2]))

    def test_bureau_couleur_invalide(self):
        with tempfile.TemporaryDirectory() as d:
            entree, sortie = os.path.join(d, 'a.glb'), os.path.join(d, 'b.glb')
            open(entree, 'wb').write(_glb())
            r = subprocess.run([sys.executable, '-I', os.path.join(RACINE, 'scripts', 'mesh_recolor.py'), entree, sortie, '--color', 'zz'],
                               capture_output=True, text=True, timeout=120)
            self.assertEqual(r.returncode, 3)


if __name__ == '__main__':
    unittest.main()
