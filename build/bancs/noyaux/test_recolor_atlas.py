"""Noyau de recoloration de la texture 3D (scripts/recolor_atlas.py = modal_app/recolor_atlas.py)."""
import os
import sys
import unittest

import numpy as np
from PIL import Image

RACINE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
sys.path.insert(0, os.path.join(RACINE, 'scripts'))
import recolor_atlas as R  # noqa: E402


def _image():
    a = np.zeros((16, 16, 4), np.uint8)
    a[..., 3] = 255
    a[:, :8, :3] = (200, 60, 60)       # moitie gauche rouge
    a[:, 8:, :3] = (40, 40, 160)       # moitie droite bleue, plus sombre
    return Image.fromarray(a, 'RGBA')


def _lum(px):
    return 0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2]


class TestRecolor(unittest.TestCase):
    def test_intensite_zero_ne_change_rien(self):
        im = _image()
        self.assertTrue(np.array_equal(np.asarray(R.recolorer_image(im, '#00ff00', 0.0)), np.asarray(im)))

    def test_toute_l_image_prend_la_couleur_et_garde_la_lumiere(self):
        im = _image()
        out = R.recolorer_image(im, '#22c55e', 1.0)
        g_l, g_r = np.asarray(out)[0, 0], np.asarray(out)[0, 12]
        self.assertGreater(g_l[1], g_l[0])             # dominante verte
        self.assertGreater(g_r[1], g_r[0])
        # la moitie qui etait la plus claire le reste
        self.assertEqual(_lum(np.asarray(im)[0, 0]) > _lum(np.asarray(im)[0, 12]), _lum(g_l) > _lum(g_r))

    def test_masque_limite_l_effet(self):
        im = _image()
        m = np.zeros((16, 16), np.uint8); m[:, 12:] = 255
        out = np.asarray(R.recolorer_image(im, '#ffffff', 1.0, masque=m, adoucir=0))
        self.assertTrue(np.array_equal(out[:, :8], np.asarray(im)[:, :8]))     # hors masque : intact
        self.assertFalse(np.array_equal(out[:, 12:], np.asarray(im)[:, 12:]))

    def test_alpha_et_taille_conserves(self):
        im = _image(); a = np.asarray(im).copy(); a[0, 0, 3] = 17; im = Image.fromarray(a, 'RGBA')
        out = R.recolorer_image(im, '#ff8800', 0.6)
        self.assertEqual(out.size, im.size)
        self.assertEqual(np.asarray(out)[0, 0, 3], 17)

    def test_rgb_reste_rgb(self):
        out = R.recolorer_image(_image().convert('RGB'), '#3b82f6', 1.0)
        self.assertEqual(out.mode, 'RGB')

    def test_couleur_sombre_ne_divise_pas_par_zero(self):
        out = np.asarray(R.recolorer_image(_image(), '#000000', 1.0))
        self.assertTrue(np.isfinite(out).all())

    def test_couleur_invalide(self):
        for mauvais in ('', 'zz', '#12', '#gg0000', None):
            with self.assertRaises(ValueError):
                R.recolorer_image(_image(), mauvais, 1.0)

    def test_hex_court(self):
        self.assertEqual(R.couleur_depuis_hex('#f80'), (255, 136, 0))


if __name__ == '__main__':
    unittest.main()
