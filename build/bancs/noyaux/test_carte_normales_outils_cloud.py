"""Carte de normales a travers les OPERATIONS du site (modal_app/_mesh_op.py), 2026-10-14. CPU seul : aucun GPU, aucun reseau.

Correctif de la revue de la branche carte-normales (bloquant 1) : l'operation `apercu` (copie de demonstration de la Marketplace)
reduisait la carte de normales par LANCZOS sur les OCTETS (normales raccourcies, debordements aux bords des ilots) puis l'encodait
en WebP AVEC PERTE (qualite 82). Desormais :
  - carte qui tient dans max_px : octets d'ORIGINE, au bit pres (ni filigrane ni re-encodage) ;
  - carte plus grande : moyenne des VECTEURS (filtre boite) puis renormalisation, encodee SANS PERTE (WebP VP8L ; PNG ; une carte
    JPEG devient PNG et son mimeType suit) ;
  - les autres images (couleur filigranee, metal / rugosite) et le JSON sont IDENTIQUES a ceux du code d'avant.
Garde de non-regression des autres operations : carte gardee identique et sans perte (center, fix_normals, fill_holes, material,
material_adjust, retex_swap, resize), retiree (smooth, decimate, subdivide, watertight), perdue avec le materiau neuf (explode).

Lancer :  python build/bancs/noyaux/test_carte_normales_outils_cloud.py -v
RACINE_MODAL : dossier contenant le paquet modal_app a tester (defaut : la racine du depot). Preuve d'echec : extraire modal_app/
du commit d'avant le correctif (git archive d32cf240 modal_app) dans un dossier et lancer avec RACINE_MODAL=<ce dossier>.
"""
import contextlib
import importlib.util
import io
import json
import os
import struct
import subprocess
import sys
import tempfile
import types
import unittest

import numpy as np
import trimesh
from PIL import Image

RACINE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
RACINE_MODAL = os.environ.get('RACINE_MODAL') or RACINE
REFERENCE_AVANT = 'f86208c04923bdc92b45d1869357e0d08cbfd945'      # _textures_apercu d'avant la carte de normales (inchange depuis)
if RACINE_MODAL not in sys.path:
    sys.path.insert(0, RACINE_MODAL)

import modal_app._mesh_op as OP                                                  # noqa: E402
import modal_app.normal_bake as NB                                               # noqa: E402
from modal_app.acceleration_glb import preencoder_couleur, preencoder_normales   # noqa: E402

COULEUR = 128          # cote de l'atlas de couleur du maillage d'essai
PLAT = np.array([128, 128, 255])


# ------------------------------------------------------------------------------------------------- lecture d'un GLB
def lire_glb(octets):
    lj = struct.unpack('<I', octets[12:16])[0]
    j = json.loads(octets[20:20 + lj].decode('utf-8'))
    reste = octets[20 + lj:]
    lb = struct.unpack('<I', reste[:4])[0]
    return j, reste[8:8 + lb]


def sources(j, index_texture):
    t = j['textures'][index_texture]
    return {s for s in [t.get('source')] + [e.get('source') for e in (t.get('extensions') or {}).values() if isinstance(e, dict)]
            if s is not None}


def octets_image(j, blob, ii):
    vue = j['bufferViews'][j['images'][ii]['bufferView']]
    debut = vue.get('byteOffset', 0)
    return blob[debut:debut + vue['byteLength']]


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


def cartes(octets):
    """[{mime, octets, rgb, taille, sans_perte, image}] des normalTexture du GLB (une par image distincte) + attribut NORMAL partout."""
    j, blob = lire_glb(octets)
    vues, sortie = set(), []
    for mat in j.get('materials', []):
        nt = mat.get('normalTexture')
        if not nt:
            continue
        for ii in sorted(sources(j, nt['index'])):
            if ii in vues:
                continue
            vues.add(ii)
            donnees = octets_image(j, blob, ii)
            img = Image.open(io.BytesIO(donnees))
            sortie.append({'mime': j['images'][ii].get('mimeType'), 'octets': donnees, 'rgb': np.asarray(img.convert('RGB')),
                           'taille': img.size, 'sans_perte': webp_sans_perte(donnees), 'image': ii})
    normal = all('NORMAL' in p.get('attributes', {}) for m in j.get('meshes', []) for p in m.get('primitives', []))
    return sortie, normal


# ------------------------------------------------------------------------------------------------- GLB d'essai
def maillage_texture():
    """Plan de 2 x 16 x 16 quadrangles en DEUX ilots d'UV (comme to_glb), repere Y haut, normales de sommet, materiau PBR complet."""
    n = 17
    xs = np.linspace(-0.4, 0.4, n)
    X, Z = np.meshgrid(xs, xs)
    P = np.stack([X.ravel(), np.zeros(n * n), Z.ravel()], 1)
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
    return trimesh.Trimesh(vertices=V, faces=F, vertex_normals=np.tile([0.0, 1.0, 0.0], (len(V), 1)), process=False,
                           visual=trimesh.visual.TextureVisuals(uv=np.concatenate(UVs), material=mat))


def carte_bosselee(taille, graine=3, inclinaison_max_deg=35.0):
    """Carte (taille, taille, 3) uint8 a fort relief : inclinaisons ALEATOIRES par texel (jusqu'a 35 degres), comme un relief fin.
    Moyennee sans renormalisation, une telle carte rend des normales nettement plus courtes que 1."""
    rng = np.random.default_rng(graine)
    th = np.radians(inclinaison_max_deg) * np.sqrt(rng.random((taille, taille)))
    ph = 2 * np.pi * rng.random((taille, taille))
    n = np.stack([np.sin(th) * np.cos(ph), np.sin(th) * np.sin(ph), np.cos(th)], -1)
    return np.clip(np.floor((n * 0.5 + 0.5) * 255.0 + 0.5), 0, 255).astype(np.uint8)


def glb_avec_carte(carte, format_carte='webp'):
    """GLB comme la generation : carte posee par normal_bake.appliquer_carte_normales (+ NORMAL), puis
    'webp' : pre-encodage couleur + carte SANS PERTE et export extension_webp (chemin de modal_app/_mesh.py) ;
    'png'  : export glTF de base (images PNG) ; 'jpeg' : la carte est une image JPEG (trimesh garde le JPEG)."""
    m = maillage_texture()
    assert NB.appliquer_carte_normales(m, carte, log=None) == 1
    buf = io.BytesIO()
    if format_carte == 'webp':
        preencoder_couleur(m, log=lambda *_: None)
        preencoder_normales(m, log=lambda *_: None)
        m.export(buf, file_type='glb', extension_webp=True)
    else:
        if format_carte == 'jpeg':
            tampon = io.BytesIO()
            Image.fromarray(carte).save(tampon, 'JPEG', quality=95)
            jpeg = Image.open(io.BytesIO(tampon.getvalue()))
            jpeg.load()
            m.visual.material.normalTexture = jpeg
        m.export(buf, file_type='glb')
    return buf.getvalue()


def decoder(rgb):
    n = rgb.astype(np.float64) / 127.5 - 1.0
    return n / np.linalg.norm(n, axis=-1, keepdims=True)


def reduction_reference(carte, cote):
    """Reduction EXACTE attendue : moyenne des vecteurs decodes par blocs (facteur entier), renormalisee."""
    f = carte.shape[0] // cote
    n = (carte.astype(np.float64) / 127.5 - 1.0).reshape(cote, f, cote, f, 3).mean(axis=(1, 3))
    return n / np.linalg.norm(n, axis=-1, keepdims=True)


def angles_deg(a, b):
    return np.degrees(np.arccos(np.clip((a * b).sum(-1), -1.0, 1.0)))


def apercu(glb, max_px, filigrane=True):
    with contextlib.redirect_stdout(io.StringIO()):
        return OP.run('apercu', glb, {'max_px': max_px, 'faces': 0, 'filigrane': filigrane})[0]


def charger_mesh_op_avant():
    """modal_app/_mesh_op.py du commit REFERENCE_AVANT, charge sous un autre nom (ses imports modal_app.* restent ceux du depot teste)."""
    try:
        texte = subprocess.run(['git', '-C', RACINE, 'show', REFERENCE_AVANT + ':modal_app/_mesh_op.py'], capture_output=True,
                               check=True).stdout
    except Exception as e:
        raise unittest.SkipTest('git show indisponible : %s' % e)
    chemin = os.path.join(tempfile.mkdtemp(prefix='mesh_op_avant_'), 'mesh_op_avant.py')
    with open(chemin, 'wb') as f:
        f.write(texte)
    spec = importlib.util.spec_from_file_location('mesh_op_avant', chemin)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# ------------------------------------------------------------------------------------------------- apercu
class ApercuCarteDeNormales(unittest.TestCase):

    def test_carte_qui_tient_dans_max_px_garde_ses_octets(self):
        """Carte 64 < max_px 1024 : AUCUNE reduction, la carte sort a l'octet (avant : WebP avec perte qualite 82)."""
        carte = carte_bosselee(64)
        for format_carte in ('webp', 'png'):
            with self.subTest(format=format_carte):
                glb = glb_avec_carte(carte, format_carte)
                entree, _ = cartes(glb)
                for filigrane in (True, False):
                    sortie, normal = cartes(apercu(glb, 1024, filigrane))
                    self.assertEqual(len(sortie), 1, 'carte de normales absente de l apercu')
                    etat = {True: 'WebP sans perte', False: 'WebP AVEC PERTE'}.get(sortie[0]['sans_perte'], sortie[0]['mime'])
                    self.assertEqual(sortie[0]['octets'], entree[0]['octets'],
                                     'carte re-encodee (%s) : ecart max %d / 255' % (
                                         etat, int(np.abs(sortie[0]['rgb'].astype(int) - carte.astype(int)).max())))
                    self.assertTrue(np.array_equal(sortie[0]['rgb'], carte))
                    self.assertTrue(normal, 'attribut NORMAL perdu')

    def test_carte_reduite_en_vecteurs_renormalises_et_sans_perte(self):
        """Carte 256, max_px 64 : 64 x 64, WebP SANS PERTE, normales unitaires egales a la moyenne exacte des vecteurs (a la
        quantification pres). Avant : LANCZOS sur les octets (normales raccourcies) puis WebP avec perte."""
        carte = carte_bosselee(256, graine=5)
        attendu = reduction_reference(carte, 64)
        glb = glb_avec_carte(carte, 'webp')
        sortie, _ = cartes(apercu(glb, 64))
        self.assertEqual(len(sortie), 1)
        s = sortie[0]
        self.assertEqual(s['mime'], 'image/webp')
        self.assertTrue(s['sans_perte'], 'carte de l apercu encodee en WebP AVEC PERTE (bloc VP8)')
        self.assertEqual(s['taille'], (64, 64))
        brut = s['rgb'].astype(np.float64) / 127.5 - 1.0
        longueur = np.linalg.norm(brut, axis=-1)
        self.assertLess(float(np.abs(longueur - 1.0).max()), 0.012,
                        'normales non renormalisees (longueur %.3f a %.3f)' % (float(longueur.min()), float(longueur.max())))
        ecart = angles_deg(decoder(s['rgb']), attendu)
        self.assertLess(float(ecart.max()), 0.6, 'ecart a la moyenne des vecteurs : %.2f degres' % float(ecart.max()))

    def test_carte_png_et_jpeg_reduites_restent_sans_perte(self):
        """max_px est borne a 64 par apercu() : carte 256 -> 64."""
        carte = carte_bosselee(256, graine=9)
        for format_carte, mime in (('png', 'image/png'), ('jpeg', 'image/png')):
            with self.subTest(format=format_carte):
                glb = glb_avec_carte(carte, format_carte)
                entree, _ = cartes(glb)
                self.assertEqual(entree[0]['mime'], 'image/' + format_carte)
                sortie, _ = cartes(apercu(glb, 64))
                s = sortie[0]
                self.assertEqual(s['mime'], mime)
                self.assertEqual(s['octets'][:8], b'\x89PNG\r\n\x1a\n', 'carte reduite qui n est pas un PNG')
                self.assertEqual(s['taille'], (64, 64))
                # reference = reduction de l'image REELLEMENT lue dans le GLB (le JPEG d'entree a deja perdu un peu)
                ecart = angles_deg(decoder(s['rgb']), reduction_reference(entree[0]['rgb'], 64))
                self.assertLess(float(ecart.max()), 0.6, 'ecart a la moyenne des vecteurs : %.2f degres' % float(ecart.max()))

    def test_autres_images_et_json_identiques_au_code_d_avant(self):
        """Le correctif ne touche QUE la carte : couleur filigranee, metal / rugosite, materiaux et maillages a l'octet pres."""
        avant = charger_mesh_op_avant()
        carte = carte_bosselee(256, graine=11)
        for format_carte, max_px in (('webp', 64), ('webp', 1024), ('png', 64)):
            with self.subTest(format=format_carte, max_px=max_px):
                glb = glb_avec_carte(carte, format_carte)
                with contextlib.redirect_stdout(io.StringIO()):
                    nouveau = OP._textures_apercu(glb, max_px, True)
                    ancien = avant._textures_apercu(glb, max_px, True)
                jn, bn = lire_glb(nouveau)
                ja, ba = lire_glb(ancien)
                carte_ii = {c['image'] for c in cartes(nouveau)[0]}
                self.assertEqual(len(carte_ii), 1)
                for ii in range(len(ja['images'])):
                    if ii not in carte_ii:
                        self.assertEqual(octets_image(jn, bn, ii), octets_image(ja, ba, ii), 'image %d modifiee' % ii)
                for cle in set(ja) | set(jn):
                    if cle not in ('bufferViews', 'buffers'):
                        self.assertEqual(jn.get(cle), ja.get(cle), cle)
                self.assertEqual(len(jn['bufferViews']), len(ja['bufferViews']))
                # et la couleur est bien filigranee (le correctif n'a pas desactive le reste de l'apercu)
                ic = sorted(sources(jn, jn['materials'][0]['pbrMetallicRoughness']['baseColorTexture']['index']))[0]
                self.assertNotEqual(octets_image(jn, bn, ic), octets_image(*lire_glb(glb), ic))


# ------------------------------------------------------------------------------------------------- autres operations
class FausseReponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


OPERATIONS = {   # operation : (parametres, attendu)
    'center': ({}, 'gardee'), 'fix_normals': ({}, 'gardee'), 'fill_holes': ({}, 'gardee'), 'material': ({}, 'gardee'),
    'material_adjust': ({'brightness': 1.2, 'hue_shift': 30}, 'gardee'),
    'retex_swap': ({'image_url': 'https://exemple.invalid/x.png'}, 'gardee'),
    'resize': ({'sx': 1.5, 'sy': 1.5, 'sz': 1.5, 'qx': 0.0, 'qy': 0.38268343, 'qz': 0.0, 'qw': 0.92387953}, 'gardee'),
    'smooth': ({}, 'retiree'), 'decimate': ({'target_faces': 100}, 'retiree'), 'subdivide': ({}, 'retiree'),
    'watertight': ({'resolution': 32}, 'retiree'), 'explode': ({'fragments': 6}, 'retiree'),
}


class AutresOperations(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.carte = carte_bosselee(COULEUR, graine=13)
        cls.glb = glb_avec_carte(cls.carte, 'webp')
        png = io.BytesIO()
        Image.fromarray(np.full((64, 64, 3), 90, np.uint8)).save(png, 'PNG')
        faux = types.ModuleType('modal_app._url_sure')
        faux.ouvrir_https = lambda req, timeout=30: FausseReponse(png.getvalue())
        cls.url_sure = sys.modules.get('modal_app._url_sure')
        sys.modules['modal_app._url_sure'] = faux

    @classmethod
    def tearDownClass(cls):
        if cls.url_sure is None:
            sys.modules.pop('modal_app._url_sure', None)
        else:
            sys.modules['modal_app._url_sure'] = cls.url_sure

    def test_carte_gardee_sans_perte_ou_retiree(self):
        for op, (params, attendu) in OPERATIONS.items():
            with self.subTest(operation=op):
                with contextlib.redirect_stdout(io.StringIO()):
                    sortie, _ = OP.run(op, self.glb, dict(params))
                trouvees, _ = cartes(sortie)
                if attendu == 'retiree':
                    self.assertEqual(trouvees, [], '%s : la carte de normales devait etre retiree' % op)
                    continue
                self.assertEqual(len(trouvees), 1, '%s : carte de normales perdue' % op)
                self.assertEqual(trouvees[0]['mime'], 'image/webp')
                self.assertTrue(trouvees[0]['sans_perte'], '%s : carte re-encodee AVEC PERTE' % op)
                self.assertTrue(np.array_equal(trouvees[0]['rgb'], self.carte), '%s : carte alteree' % op)


if __name__ == '__main__':
    for flux in (sys.stdout, sys.stderr):
        try:
            flux.reconfigure(encoding='utf-8', errors='replace')
        except Exception:
            pass
    unittest.main()
