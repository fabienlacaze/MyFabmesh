"""Carte de normales a travers les OUTILS DU BUREAU (scripts/mesh_tools.py, scripts/mesh_material_adjust.py), 2026-10-14. CPU seul.

Correctif de la revue de la branche carte-normales (bloquant 2) : la generation du bureau pose desormais une carte de normales
(commit fe02eca4), mais les outils qui DEFORMENT la forme la gardaient : le relief efface par le lissage revenait a l'eclairage
(cote site, modal_app/_mesh_op.py la retire pour ces memes operations). Les outils sont executes pour de vrai sur un GLB qui porte
une carte, comme la generation l'ecrit (WebP, carte SANS PERTE), avec les deux presets (desktop : export PNG ; cloud_parity :
export WebP par webp_rapide) :
  - RETIREE : smooth, subdivide de Loop, decimate (recuisson ET repli au plus proche sommet, qui gardait l'ANCIEN materiau sur des
    UV approchees), watertight (coque neuve) ;
  - GARDEE, identique au texel pres et sans perte : center, set_pivot, fix_normals, fill_holes, subdivide au milieu des aretes
    (surface et UV inchangees), decimate deja sous la cible (rien n'est reduit), watertight « seal » (maillage d'origine intact) ;
  - material adjust : la carte suit le nouveau materiau (parite avec le site ; avant, elle etait perdue).
Lancer :  python build/bancs/noyaux/test_carte_normales_outils_bureau.py -v
SCRIPTS_BUREAU : dossier scripts/ a tester (defaut : celui du depot). Preuve d'echec : extraire scripts/ du commit d'avant le
correctif (git archive d32cf240 scripts) et lancer avec SCRIPTS_BUREAU=<ce dossier>/scripts.
"""
import contextlib
import io
import json
import os
import shutil
import struct
import sys
import tempfile
import unittest

import numpy as np
import trimesh
from PIL import Image

RACINE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
SCRIPTS = os.path.abspath(os.environ.get('SCRIPTS_BUREAU') or os.path.join(RACINE, 'scripts'))
if SCRIPTS not in sys.path:
    sys.path.insert(0, SCRIPTS)
os.environ.pop('FABMESH_MESH_PRESET', None)

import acceleration_glb as AG          # noqa: E402
import mesh_material_adjust as MA      # noqa: E402
import mesh_tools as MT                # noqa: E402
import normal_bake as NB               # noqa: E402

COULEUR = 64


# ------------------------------------------------------------------------------------------------- lecture d'un GLB
def lire_glb(octets):
    lj = struct.unpack('<I', octets[12:16])[0]
    j = json.loads(octets[20:20 + lj].decode('utf-8'))
    reste = octets[20 + lj:]
    lb = struct.unpack('<I', reste[:4])[0]
    return j, reste[8:8 + lb]


def webp_sans_perte(donnees):
    """True : WebP SANS perte (bloc VP8L) ; False : avec perte (bloc VP8) ; None : pas un WebP."""
    if donnees[:4] != b'RIFF' or donnees[8:12] != b'WEBP':
        return None
    pos = 12
    while pos + 8 <= len(donnees):
        code, taille = donnees[pos:pos + 4], struct.unpack('<I', donnees[pos + 4:pos + 8])[0]
        if code == b'VP8L':
            return True
        if code == b'VP8 ':
            return False
        pos += 8 + taille + (taille & 1)
    return None


def cartes(chemin):
    """[(mimeType, rgb, sans_perte)] des images normalTexture distinctes du GLB."""
    with open(chemin, 'rb') as f:
        j, blob = lire_glb(f.read())
    vues, sortie = set(), []
    for mat in j.get('materials', []):
        nt = mat.get('normalTexture')
        if not nt:
            continue
        t = j['textures'][nt['index']]
        for ii in [t.get('source')] + [e.get('source') for e in (t.get('extensions') or {}).values() if isinstance(e, dict)]:
            if ii is None or ii in vues:
                continue
            vues.add(ii)
            vue = j['bufferViews'][j['images'][ii]['bufferView']]
            donnees = blob[vue.get('byteOffset', 0):vue.get('byteOffset', 0) + vue['byteLength']]
            sortie.append((j['images'][ii].get('mimeType'), np.asarray(Image.open(io.BytesIO(donnees)).convert('RGB')),
                           webp_sans_perte(donnees)))
    return sortie


# ------------------------------------------------------------------------------------------------- GLB d'essai
def maillage_texture():
    """Plan de 2 x 16 x 16 quadrangles en DEUX ilots d'UV (comme to_glb), repere Y haut, normales de sommet, materiau PBR complet."""
    n = 17
    xs = np.linspace(-0.4, 0.4, n)
    X, Z = np.meshgrid(xs, xs)
    P = np.stack([X.ravel(), 0.03 * np.sin(6 * X.ravel()) * np.cos(5 * Z.ravel()), Z.ravel()], 1)   # legerement ondule
    idx = np.arange(n * n).reshape(n, n)
    Vs, UVs, Fs = [], [], []
    for moitie, (c0, c1) in enumerate(((0, 8), (8, 16))):
        sous = idx[:, c0:c1 + 1]
        base = sum(len(v) for v in Vs)
        Vs.append(P[sous.ravel()])
        xn = (np.arange(c1 - c0 + 1) / float(c1 - c0))[None, :] * np.ones((n, 1))
        yn = (np.arange(n) / float(n - 1))[:, None] * np.ones((1, c1 - c0 + 1))
        UVs.append(np.stack([0.05 + 0.4 * xn.ravel() + 0.5 * moitie, 0.1 + 0.8 * yn.ravel()], 1))
        k = np.arange(n * (c1 - c0 + 1)).reshape(n, c1 - c0 + 1)
        a, b, c, d = k[:-1, :-1].ravel(), k[:-1, 1:].ravel(), k[1:, 1:].ravel(), k[1:, :-1].ravel()
        Fs.append(np.concatenate([np.stack([a, b, c], 1), np.stack([a, c, d], 1)]) + base)
    V = np.concatenate(Vs)
    F = np.concatenate(Fs)
    nf = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    F[nf[:, 1] < 0] = F[nf[:, 1] < 0][:, ::-1]
    rng = np.random.default_rng(7)
    couleur = rng.integers(40, 220, (COULEUR, COULEUR, 3)).astype(np.uint8)
    mr = np.zeros((COULEUR, COULEUR, 3), np.uint8)
    mr[..., 1] = 160
    mr[..., 2] = 30
    mat = trimesh.visual.material.PBRMaterial(baseColorTexture=Image.fromarray(couleur), metallicRoughnessTexture=Image.fromarray(mr),
                                              metallicFactor=1.0, roughnessFactor=1.0, alphaMode='OPAQUE', doubleSided=True)
    m = trimesh.Trimesh(vertices=V, faces=F, process=False, visual=trimesh.visual.TextureVisuals(uv=np.concatenate(UVs), material=mat))
    return m


def carte_bosselee(taille, graine=3):
    rng = np.random.default_rng(graine)
    th = np.radians(35.0) * np.sqrt(rng.random((taille, taille)))
    ph = 2 * np.pi * rng.random((taille, taille))
    n = np.stack([np.sin(th) * np.cos(ph), np.sin(th) * np.sin(ph), np.cos(th)], -1)
    return np.clip(np.floor((n * 0.5 + 0.5) * 255.0 + 0.5), 0, 255).astype(np.uint8)


def ecrire_glb_genere(chemin, carte):
    """Comme scripts/trellis2_native_full_pipeline.py : carte posee (normal_bake), couleur et carte pre-encodees, export WebP."""
    m = maillage_texture()
    assert NB.appliquer_carte_normales(m, carte, log=None) == 1
    AG.preencoder_couleur(m, log=lambda *_: None)
    AG.preencoder_normales(m, log=lambda *_: None)
    m.export(chemin, extension_webp=True)


@contextlib.contextmanager
def preset(nom):
    avant = MT.ACTIVE_PRESET
    MT.ACTIVE_PRESET = nom
    try:
        yield
    finally:
        MT.ACTIVE_PRESET = avant


class OutilsDuBureau(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.dossier = tempfile.mkdtemp(prefix='carte_outils_bureau_')
        cls.carte = carte_bosselee(COULEUR)
        cls.entree = os.path.join(cls.dossier, 'genere.glb')
        ecrire_glb_genere(cls.entree, cls.carte)
        trouvees = cartes(cls.entree)
        assert len(trouvees) == 1 and trouvees[0][2] is True and np.array_equal(trouvees[0][1], cls.carte), 'GLB d essai invalide'

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.dossier, ignore_errors=True)

    def lancer(self, nom, appel):
        sortie = os.path.join(self.dossier, nom + '.glb')
        if os.path.exists(sortie):
            os.remove(sortie)
        with contextlib.redirect_stdout(io.StringIO()):
            appel(self.entree, sortie)
        self.assertTrue(os.path.exists(sortie), '%s : aucun fichier ecrit' % nom)
        return sortie

    def verifier_retiree(self, nom, appel):
        trouvees = cartes(self.lancer(nom, appel))
        self.assertEqual(trouvees, [], '%s : la forme ou les UV ont change, la carte de normales devait etre retiree' % nom)

    def verifier_gardee(self, nom, appel):
        trouvees = cartes(self.lancer(nom, appel))
        self.assertEqual(len(trouvees), 1, '%s : carte de normales perdue' % nom)
        mime, rgb, sans_perte = trouvees[0]
        self.assertIn(mime, ('image/png', 'image/webp'))
        if mime == 'image/webp':
            self.assertTrue(sans_perte, '%s : carte re-encodee en WebP AVEC PERTE' % nom)
        self.assertTrue(np.array_equal(rgb, self.carte), '%s : carte alteree (ecart max %d)'
                        % (nom, int(np.abs(rgb.astype(int) - self.carte.astype(int)).max())))

    # ------------------------------------------------------------------ outils qui deforment : carte retiree
    def test_lissage_retire_la_carte(self):
        for p in ('desktop', 'cloud_parity'):
            with self.subTest(preset=p), preset(p):
                self.verifier_retiree('smooth_' + p, lambda e, s: MT.smooth(e, s))

    def test_subdivision_de_loop_retire_la_carte(self):
        for p in ('desktop', 'cloud_parity'):
            with self.subTest(preset=p), preset(p):
                self.verifier_retiree('loop_' + p, lambda e, s: MT.subdivide_mesh(e, s, levels=1, mode='loop'))

    def test_reduction_retire_la_carte(self):
        with preset('desktop'):
            self.verifier_retiree('decimate', lambda e, s: MT.decimate(e, s, target_faces=100))

    def test_reduction_par_le_repli_retire_la_carte(self):
        """Recuisson indisponible (xatlas, cv2 ou meshoptimizer absents) : le repli garde l'ANCIEN materiau sur des UV approchees."""
        origine = AG.reduire_et_recuire

        def indisponible(*a, **k):
            raise ImportError('recuisson indisponible (essai)')
        AG.reduire_et_recuire = indisponible
        try:
            for p in ('desktop', 'cloud_parity'):
                with self.subTest(preset=p), preset(p):
                    self.verifier_retiree('decimate_repli_' + p, lambda e, s: MT.decimate(e, s, target_faces=100))
        finally:
            AG.reduire_et_recuire = origine

    def test_watertight_coque_sans_carte(self):
        with preset('desktop'):
            self.verifier_retiree('watertight', lambda e, s: MT.watertight(e, s, resolution=32))

    # ------------------------------------------------------------------ outils qui gardent la forme et les UV : carte gardee
    def test_outils_qui_gardent_la_forme_gardent_la_carte_sans_perte(self):
        outils = {
            'center': lambda e, s: MT.center(e, s),
            'set_pivot': lambda e, s: MT.set_pivot(e, s, 'bottom'),
            'fix_normals': lambda e, s: MT.fix_normals(e, s),
            'fill_holes': lambda e, s: MT.fill_holes(e, s),
            'decimate_deja_sous_la_cible': lambda e, s: MT.decimate(e, s, target_faces=1_000_000),
        }
        for p in ('desktop', 'cloud_parity'):
            for nom, appel in outils.items():
                with self.subTest(preset=p, outil=nom), preset(p):
                    self.verifier_gardee(nom + '_' + p, appel)

    def test_subdivision_au_milieu_des_aretes_garde_la_carte(self):
        self.verifier_gardee('milieu', lambda e, s: self.assertTrue(MT.subdivide_mesh(e, s, levels=1, mode='midpoint')))

    def test_watertight_seal_garde_la_carte_du_maillage_d_origine(self):
        self.verifier_gardee('seal', lambda e, s: MT.watertight(e, s, resolution=32, mode='seal'))

    def test_material_adjust_garde_la_carte(self):
        self.verifier_gardee('material_adjust', lambda e, s: MA.adjust(e, s, brightness=1.3, hue_shift=20.0))


if __name__ == '__main__':
    for flux in (sys.stdout, sys.stderr):
        try:
            flux.reconfigure(encoding='utf-8', errors='replace')
        except Exception:
            pass
    unittest.main()
