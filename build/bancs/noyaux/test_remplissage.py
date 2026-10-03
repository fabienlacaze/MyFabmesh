"""Test du remplissage des vides d'atlas par le bord le plus proche (constat E-1, 2026-10-03).

Lancer :  <python de l'appli> -m unittest build/bancs/noyaux/test_remplissage.py -v
Variable NOYAU_ACCEL : chemin d'une AUTRE copie de acceleration_glb.py (pour prouver que le test echoue
sur l'ancien code : git show HEAD:scripts/acceleration_glb.py > fichier_temporaire).

Critere principal : les texels COUVERTS ressortent identiques octet pour octet. Les texels vides
prennent la valeur du texel couvert le plus proche (verifie avec une distance exacte scipy). Aucun
appel reseau.
"""
import importlib.util
import os
import tempfile
import textwrap
import unittest

import cv2
import numpy as np

RACINE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
CHEMIN = os.environ.get('NOYAU_ACCEL') or os.path.join(RACINE, 'scripts', 'acceleration_glb.py')


def charger_module(chemin=CHEMIN):
    spec = importlib.util.spec_from_file_location('acceleration_glb_sous_test', chemin)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


# Faux o_voxel.postprocess.to_glb : meme texte que la vraie fonction autour des 4 inpaint.
FAUX_POSTPROCESS = textwrap.dedent('''
    import cv2
    import numpy as np

    def to_glb(couleur, metal, rugosite, alpha_in, mask):
        base_color = couleur
        metallic = metal
        roughness = rugosite
        alpha = alpha_in
        mask_inv = (~mask).astype(np.uint8)
        base_color = cv2.inpaint(base_color, mask_inv, 3, cv2.INPAINT_TELEA)
        metallic = cv2.inpaint(metallic, mask_inv, 1, cv2.INPAINT_TELEA)[..., None]
        roughness = cv2.inpaint(roughness, mask_inv, 1, cv2.INPAINT_TELEA)[..., None]
        alpha = cv2.inpaint(alpha, mask_inv, 1, cv2.INPAINT_TELEA)[..., None]
        return base_color, metallic, roughness, alpha
''')


class FauxOVoxel:
    pass


def installer_faux_ovoxel(dossier, texte=FAUX_POSTPROCESS):
    chemin = os.path.join(dossier, 'faux_postprocess.py')
    with open(chemin, 'w', encoding='utf-8') as f:
        f.write(texte)
    spec = importlib.util.spec_from_file_location('faux_postprocess', chemin)
    pp = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(pp)
    ov = FauxOVoxel()
    ov.postprocess = pp
    return ov


def atlas_synthetique(n=256, graine=0):
    """Atlas dont chaque texel couvert porte un identifiant UNIQUE (3 octets) : on retrouve la source."""
    rng = np.random.default_rng(graine)
    masque_u8 = np.zeros((n, n), np.uint8)
    masque_u8[20:90, 30:110] = 1
    masque_u8[120:200, 150:230] = 1
    cv2.circle(masque_u8, (60, 190), 25, 1, -1)
    masque_u8[rng.integers(0, n, 40), rng.integers(0, n, 40)] = 1
    masque = masque_u8.astype(bool)
    ident = np.arange(n * n, dtype=np.uint32).reshape(n, n)
    couleur = np.stack([(ident >> 16) & 255, (ident >> 8) & 255, ident & 255], -1).astype(np.uint8)
    couleur[~masque] = 0
    metal = (ident % 251).astype(np.uint8)
    metal[~masque] = 0
    rug = ((ident * 7) % 253).astype(np.uint8)
    rug[~masque] = 0
    alpha = np.full((n, n), 255, np.uint8)
    alpha[~masque] = 0
    return masque, couleur, metal, rug, alpha


def id_depuis_couleur(c):
    return (c[..., 0].astype(np.uint32) << 16) | (c[..., 1].astype(np.uint32) << 8) | c[..., 2].astype(np.uint32)


def controler_remplissage(testcase, masque, couleur_in, sortie_couleur):
    """Texels couverts identiques ; texels vides = valeur d'un texel couvert a distance minimale."""
    from scipy import ndimage
    testcase.assertTrue(np.array_equal(sortie_couleur[masque], couleur_in[masque]),
                        'un texel COUVERT a ete modifie par le remplissage')
    dist = ndimage.distance_transform_edt(~masque)
    vides = ~masque
    ident = id_depuis_couleur(sortie_couleur)[vides]
    n = masque.shape[1]
    sy, sx = np.divmod(ident, n)
    testcase.assertTrue(masque[sy, sx].all(), 'un texel vide ne copie pas un texel couvert')
    ys, xs = np.nonzero(vides)
    d_pris = np.hypot(ys - sy, xs - sx)
    d_min = dist[vides]
    # tolerance : DIST_MASK_5 est une approximation de la distance euclidienne
    testcase.assertTrue((d_pris <= d_min * 1.06 + 1.5).all(),
                        'un texel vide ne prend pas le bord le plus proche (ecart max %.2f px)' % float((d_pris - d_min).max()))


class TestRemplissage(unittest.TestCase):
    def setUp(self):
        self.acc = charger_module()

    def test_fonction_directe(self):
        if not hasattr(self.acc, 'remplir_bord_proche'):
            self.fail('remplir_bord_proche absent : ancien code (TELEA)')
        masque, c, m, r, a = atlas_synthetique()
        mask_inv = (~masque).astype(np.uint8)
        c2, m2, r2, a2 = self.acc.remplir_bord_proche(mask_inv, c, m, r, a)
        controler_remplissage(self, masque, c, c2)
        for avant, apres in ((m, m2), (r, r2), (a, a2)):
            self.assertTrue(np.array_equal(apres[masque], avant[masque]))
        self.assertEqual(c2.shape, c.shape)
        self.assertEqual(m2.shape, m.shape)

    def test_entrees_non_modifiees(self):
        if not hasattr(self.acc, 'remplir_bord_proche'):
            self.fail('remplir_bord_proche absent')
        masque, c, m, r, a = atlas_synthetique()
        copie = c.copy()
        self.acc.remplir_bord_proche((~masque).astype(np.uint8), c)
        self.assertTrue(np.array_equal(c, copie))

    def test_cas_limites(self):
        if not hasattr(self.acc, 'remplir_bord_proche'):
            self.fail('remplir_bord_proche absent')
        img = np.full((16, 16, 3), 7, np.uint8)
        tout_vide = np.ones((16, 16), np.uint8)
        tout_couvert = np.zeros((16, 16), np.uint8)
        self.assertTrue(np.array_equal(self.acc.remplir_bord_proche(tout_vide, img)[0], img))
        self.assertTrue(np.array_equal(self.acc.remplir_bord_proche(tout_couvert, img)[0], img))

    def test_dans_to_glb_injecte(self):
        """Chemin de production : accelerer_to_glb remplace le texte de to_glb, qui appelle le nouveau remplissage."""
        masque, c, m, r, a = atlas_synthetique()
        with tempfile.TemporaryDirectory() as d:
            ov = installer_faux_ovoxel(d)
            journal = []
            self.acc._TO_GLB_ACCELERE = False
            self.acc.accelerer_to_glb(ov, log=journal.append)
            c2, m2, r2, a2 = ov.postprocess.to_glb(c, m, r, a, masque)
        self.assertEqual(m2.shape, (*masque.shape, 1))
        controler_remplissage(self, masque, c, c2)
        self.assertTrue(np.array_equal(m2[..., 0][masque], m[masque]))
        self.assertTrue(np.array_equal(r2[..., 0][masque], r[masque]))
        self.assertTrue(np.array_equal(a2[..., 0][masque], a[masque]))
        self.assertTrue(any('bord le plus proche' in x for x in journal), journal)

    def test_texte_inattendu_version_origine(self):
        """Regle conservee : motif absent -> to_glb d'origine, rien n'est touche, un message est journalise."""
        texte = FAUX_POSTPROCESS.replace('cv2.inpaint(base_color, mask_inv, 3', 'cv2.inpaint(base_color, mask_inv, 5')
        with tempfile.TemporaryDirectory() as d:
            ov = installer_faux_ovoxel(d, texte)
            avant = ov.postprocess.to_glb
            journal = []
            self.acc._TO_GLB_ACCELERE = False
            self.acc.accelerer_to_glb(ov, log=journal.append)
            self.assertIs(ov.postprocess.to_glb, avant)
            self.assertTrue(any('inattendu' in x for x in journal), journal)

    def test_le_controle_detecte_une_alteration(self):
        """Preuve que le critere d'identite echoue si un texel couvert est altere."""
        masque, c, m, r, a = atlas_synthetique()
        faux = c.copy()
        ys, xs = np.nonzero(masque)
        faux[ys[0], xs[0]] = faux[ys[0], xs[0]] ^ 1
        with self.assertRaises(AssertionError):
            controler_remplissage(self, masque, c, faux)


@unittest.skipUnless(os.path.isdir('C:/tmp/texture_essais/gen'), 'atlas reels absents')
class TestAtlasReels(unittest.TestCase):
    """2 atlas reels (GLB generes le 03/10) : masque = triangles UV rasterises."""
    GLBS = ['alien_m1024_atlas2048.glb', 'chevalier_m1024_atlas2048.glb']

    def setUp(self):
        self.acc = charger_module()

    @staticmethod
    def charger(nom):
        import trimesh
        chemin = os.path.join('C:/tmp/texture_essais/gen', nom)
        if not os.path.exists(chemin):
            return None
        sc = trimesh.load(chemin)
        g = list(sc.geometry.values())[0]
        img = np.asarray(g.visual.material.baseColorTexture.convert('RGB'))
        h = img.shape[0]
        uv = np.asarray(g.visual.uv, np.float64)
        pts = np.stack([uv[:, 0] * (h - 1), (1.0 - uv[:, 1]) * (h - 1)], 1)
        masque = np.zeros((h, h), np.uint8)
        for f in np.asarray(g.faces):
            cv2.fillConvexPoly(masque, np.round(pts[f]).astype(np.int32), 1)
        return img, masque.astype(bool)

    def test_atlas_reels(self):
        if not hasattr(self.acc, 'remplir_bord_proche'):
            self.fail('remplir_bord_proche absent : ancien code (TELEA)')
        vus = 0
        for nom in self.GLBS:
            r = self.charger(nom)
            if r is None:
                continue
            vus += 1
            img, masque = r
            base = img.copy()
            base[~masque] = 0
            mask_inv = (~masque).astype(np.uint8)
            proche = self.acc.remplir_bord_proche(mask_inv, base)[0]
            telea = cv2.inpaint(base, mask_inv, 3, cv2.INPAINT_TELEA)
            # critere : texels couverts identiques octet pour octet
            self.assertTrue(np.array_equal(proche[masque], base[masque]), nom)

            # couture : erreur du mip 4x sur les blocs mixtes (couvert + vide) par rapport a la moyenne
            # des seuls texels couverts du bloc ; le bord proche ne doit pas etre pire que TELEA (+5 %)
            def erreur(rempli):
                h = rempli.shape[0] // 4 * 4
                mf = masque[:h, :h].astype(np.float32)
                somme_c = cv2.resize(base[:h, :h].astype(np.float32) * mf[..., None], (h // 4, h // 4), interpolation=cv2.INTER_AREA)
                part = cv2.resize(mf, (h // 4, h // 4), interpolation=cv2.INTER_AREA)
                mixte = (part > 0.05) & (part < 0.95)
                ref = somme_c[mixte] / part[mixte][:, None]
                mip = cv2.resize(rempli[:h, :h].astype(np.float32), (h // 4, h // 4), interpolation=cv2.INTER_AREA)[mixte]
                return float(np.abs(mip - ref).mean())
            e_p, e_t = erreur(proche), erreur(telea)
            print('%s : erreur mip2 bord proche %.3f / telea %.3f' % (nom, e_p, e_t))
            self.assertLessEqual(e_p, e_t * 1.05 + 0.05, nom)
        if vus == 0:
            self.skipTest('GLB reels introuvables')


class TestGardeNumerotation(unittest.TestCase):
    """Relecture independante (2026-10-03) : l'hypothese « l'etiquette k designe le k-ieme texel couvert » est verifiee a chaque
    appel ; une autre numerotation (autre version d'OpenCV dans l'image Modal) doit LEVER, et _remplir_atlas doit retomber sur TELEA."""

    def setUp(self):
        self.acc = charger_module()
        if not hasattr(self.acc, 'remplir_bord_proche'):
            self.fail('remplir_bord_proche absent : ancien code (TELEA)')

    def _atlas(self):
        rng = np.random.default_rng(1)
        img = rng.integers(0, 255, (64, 64, 3), dtype=np.uint8)
        masque = np.zeros((64, 64), np.uint8)
        masque[8:40, 8:40] = 1                      # zone couverte au centre
        vide = (1 - masque).astype(np.uint8)
        return img, vide

    def test_numerotation_inattendue_leve(self):
        img, vide = self._atlas()
        reel = cv2.distanceTransformWithLabels

        def faux(*a, **k):
            d, lab = reel(*a, **k)
            return d, lab[::-1].copy()              # numerotation inversee : plus du tout l'ordre de balayage
        cv2.distanceTransformWithLabels = faux
        try:
            with self.assertRaises(ValueError):
                self.acc.remplir_bord_proche(vide, img)
        finally:
            cv2.distanceTransformWithLabels = reel

    def test_repli_telea_quand_la_garde_leve(self):
        img, vide = self._atlas()
        reel = cv2.distanceTransformWithLabels
        cv2.distanceTransformWithLabels = lambda *a, **k: (lambda d, lab: (d, lab[::-1].copy()))(*reel(*a, **k))
        journal = []
        try:
            m = np.full(img.shape[:2], 100, np.uint8)
            c, mt, ro, al = self.acc._remplir_atlas(vide, img, m, m, m, log=journal.append)
        finally:
            cv2.distanceTransformWithLabels = reel
        self.assertTrue(any('TELEA' in ligne for ligne in journal), journal)
        self.assertEqual(c.shape, img.shape)
        couvert = vide == 0
        self.assertTrue(np.array_equal(c[couvert], img[couvert]), 'texels couverts intacts meme en repli')

    def test_numerotation_normale_passe(self):
        img, vide = self._atlas()
        sortie = self.acc.remplir_bord_proche(vide, img)[0]
        couvert = vide == 0
        self.assertTrue(np.array_equal(sortie[couvert], img[couvert]))


if __name__ == '__main__':
    unittest.main()
