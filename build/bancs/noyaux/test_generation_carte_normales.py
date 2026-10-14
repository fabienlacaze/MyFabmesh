"""Branchement de la carte de normales dans modal_app/_mesh.py generate() (2026-10-13). CPU seul : aucun GPU, aucun modele, aucun reseau.

generate() tourne EN ENTIER (preparation de l'image, retouches de couleur, metal, alpha, serialisation WebP, marquage IA) avec :
  - un FAUX pipeline TRELLIS dont run() rend un maillage fin connu (plan bossele, repere de la grille Z haut, tenseurs torch comme o_voxel) ;
  - un FAUX o_voxel dont to_glb rend, comme le vrai, un maillage final texture en repere Y haut (UV de trimesh, normales de sommet,
    materiau PBR couleur RGBA + metal/rugosite, OPAQUE).
Verifie :
  - FABMESH_NORMAL_MAP=0 : GLB IDENTIQUE A L'OCTET a celui du _mesh.py d'avant (commit REFERENCE_AVANT, lu par git show), memes lignes de
    journal (chiffres mis a part) ;
  - defaut : normalTexture (EXT_texture_webp) SANS PERTE et egale a une cuisson directe, attribut NORMAL, couleur et metal/rugosite
    identiques au GLB sans carte, carte a la taille de l'atlas de couleur, journal [mesh] ;
  - cuisson qui leve : GLB identique au GLB sans carte, ligne « ABANDONNEE » ;
  - Ultra 8K (agrandissement simule) : couleur x2, carte a la taille de l'atlas d'origine ;
  - le GLB relu puis re-exporte par un outil (affinage, face fix, Ultra 8K apres coup : trimesh.load + webp_rapide + export) garde
    la carte SANS PERTE et l'attribut NORMAL ; le marquage IA reste intact.
Lancer :  python build/bancs/noyaux/test_generation_carte_normales.py -v
RACINE_MODAL : dossier contenant le paquet modal_app a tester (defaut : la racine du depot). Preuve d'echec sur le code d'avant :
  copier modal_app/ du commit REFERENCE_AVANT dans un dossier temporaire et lancer avec RACINE_MODAL=<ce dossier>.
"""
import contextlib
import importlib
import importlib.util
import io
import json
import os
import re
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
REFERENCE_AVANT = 'f86208c04923bdc92b45d1869357e0d08cbfd945'      # tete de feat/r2-signed-urls avant la carte de normales
if RACINE_MODAL not in sys.path:
    sys.path.insert(0, RACINE_MODAL)

import modal_app._mesh as MESH  # noqa: E402

TAILLE = 64            # atlas de couleur du faux to_glb (texture_size)
N_FIN = 97             # sommets par cote de la grille fine


def lire_glb(octets):
    lj = struct.unpack('<I', octets[12:16])[0]
    j = json.loads(octets[20:20 + lj].decode('utf-8'))
    reste = octets[20 + lj:]
    lb = struct.unpack('<I', reste[:4])[0]
    return j, reste[8:8 + lb]


def image(j, blob, index_texture):
    t = j['textures'][index_texture]
    src = t['source'] if 'source' in t else t['extensions']['EXT_texture_webp']['source']
    vue = j['bufferViews'][j['images'][src]['bufferView']]
    debut = vue.get('byteOffset', 0)
    octets = blob[debut:debut + vue['byteLength']]
    return Image.open(io.BytesIO(octets)), octets, j['images'][src]['mimeType']


# ------------------------------------------------------------------------------------------------- faux TRELLIS et faux o_voxel
def maillage_fin():
    """Plan bossele z = h(x, y) sur [-0,4 ; 0,4]^2, repere de la grille (Z haut), comme les sommets / faces d'o_voxel (torch CPU)."""
    import torch
    xs = np.linspace(-0.4, 0.4, N_FIN)
    X, Y = np.meshgrid(xs, xs)
    Z = 0.015 * np.sin(2 * np.pi * 4 * X) * np.sin(2 * np.pi * 3 * Y)
    V = np.stack([X.ravel(), Y.ravel(), Z.ravel()], 1).astype(np.float32)
    idx = np.arange(N_FIN * N_FIN).reshape(N_FIN, N_FIN)
    a, b, c, d = idx[:-1, :-1].ravel(), idx[:-1, 1:].ravel(), idx[1:, 1:].ravel(), idx[1:, :-1].ravel()
    F = np.concatenate([np.stack([a, b, c], 1), np.stack([a, c, d], 1)]).astype(np.int32)
    rng = np.random.default_rng(1)
    retourner = rng.random(len(F)) < 0.3                       # comme o_voxel : une partie des faces est retournee
    F[retourner] = F[retourner][:, ::-1]
    return torch.from_numpy(V), torch.from_numpy(F)


def to_glb(vertices, faces, attr_volume, coords, attr_layout, voxel_size, aabb, decimation_target, texture_size, remesh, verbose=False):
    """Faux o_voxel.postprocess.to_glb : plan LISSE de 2 x 8 x 8 triangles en DEUX ilots d'UV, repere Y haut (x, z, -y), comme le vrai."""
    n = 9
    xs = np.linspace(-0.4, 0.4, n)
    X, Y = np.meshgrid(xs, xs)
    P = np.stack([X.ravel(), Y.ravel(), np.zeros(n * n)], 1)
    Vg = np.stack([P[:, 0], P[:, 2], -P[:, 1]], 1)               # conversion de to_glb
    idx = np.arange(n * n).reshape(n, n)
    Vs, UVs, Fs = [], [], []
    for moitie, (c0, c1) in enumerate(((0, 4), (4, 8))):          # deux ilots : colonnes 0-4 et 4-8 (sommets de la couture dupliques)
        sous = idx[:, c0:c1 + 1]
        base = sum(len(v) for v in Vs)
        Vs.append(Vg[sous.ravel()])
        xn = (np.arange(c1 - c0 + 1) / float(c1 - c0))[None, :] * np.ones((n, 1))
        yn = (np.arange(n) / float(n - 1))[:, None] * np.ones((1, c1 - c0 + 1))
        UVs.append(np.stack([0.05 + 0.4 * xn.ravel() + 0.5 * moitie, 0.1 + 0.8 * yn.ravel()], 1))
        k = np.arange(n * (c1 - c0 + 1)).reshape(n, c1 - c0 + 1)
        a, b, c, d = k[:-1, :-1].ravel(), k[:-1, 1:].ravel(), k[1:, 1:].ravel(), k[1:, :-1].ravel()
        Fs.append(np.concatenate([np.stack([a, b, c], 1), np.stack([a, c, d], 1)]) + base)
    V = np.concatenate(Vs)
    F = np.concatenate(Fs)
    # orientation : normales vers +Y (le haut du plan apres conversion)
    nf = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    F[nf[:, 1] < 0] = F[nf[:, 1] < 0][:, ::-1]
    rng = np.random.default_rng(7)
    couleur = np.concatenate([rng.integers(40, 220, (texture_size, texture_size, 3)), np.full((texture_size, texture_size, 1), 255)],
                             2).astype(np.uint8)
    mr = np.zeros((texture_size, texture_size, 3), np.uint8)
    mr[..., 1] = 160
    mr[..., 2] = 30
    mat = trimesh.visual.material.PBRMaterial(
        baseColorTexture=Image.fromarray(couleur), baseColorFactor=np.array([255, 255, 255, 255], np.uint8),
        metallicRoughnessTexture=Image.fromarray(mr), metallicFactor=1.0, roughnessFactor=1.0, alphaMode='OPAQUE',
        doubleSided=False)
    return trimesh.Trimesh(vertices=V, faces=F, vertex_normals=np.tile([0.0, 1.0, 0.0], (len(V), 1)), process=False,
                           visual=trimesh.visual.TextureVisuals(uv=np.concatenate(UVs), material=mat))


class FauxPipeline:
    def __init__(self):
        self.tex_slat_sampler_params = {}
        V, F = maillage_fin()
        self.ov = types.SimpleNamespace(vertices=V, faces=F, attrs=None, coords=None, layout=None, voxel_size=1.0 / 256)

    def run(self, img, num_samples=1, seed=42, pipeline_type='1024', preprocess_image=False):
        return [self.ov]


FAUX_O_VOXEL = types.SimpleNamespace(postprocess=types.SimpleNamespace(to_glb=to_glb))


def image_source():
    """Image RGBA a alpha partiel (le detourage est saute, comme une image deja detouree)."""
    rng = np.random.default_rng(3)
    a = np.zeros((96, 96, 4), np.uint8)
    a[..., :3] = rng.integers(30, 230, (96, 96, 3))
    a[16:80, 16:80, 3] = 255
    return Image.fromarray(a, 'RGBA')


class Environnement:
    def __init__(self, **valeurs):
        self.valeurs, self.avant = valeurs, {}

    def __enter__(self):
        for k, v in self.valeurs.items():
            self.avant[k] = os.environ.get(k)
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def __exit__(self, *a):
        for k, v in self.avant.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


def generer(module=MESH, carte=None, **kw):
    """(octets du GLB, lignes de journal) ; carte = valeur de FABMESH_NORMAL_MAP (None = absente)."""
    import modal_app.acceleration_glb as AG
    AG._TO_GLB_ACCELERE = False             # chaque appel journalise la meme chose (accelerer_to_glb n'ecrit qu'au premier appel)
    sortie = io.StringIO()
    with Environnement(FABMESH_NORMAL_MAP=carte), contextlib.redirect_stdout(sortie):
        octets = module.generate(FauxPipeline(), FAUX_O_VOXEL, image_source(), mode='1024', seed=5,
                                 decimation_target=500_000, texture_size=TAILLE, **kw)
    return octets, sortie.getvalue().splitlines()


def sans_chiffres(lignes):
    return [re.sub(r'\d+(\.\d+)?', '#', l) for l in lignes]


def charger_mesh_avant():
    """modal_app/_mesh.py du commit REFERENCE_AVANT, charge sous un autre nom (ses imports modal_app.* restent ceux du depot teste)."""
    try:
        texte = subprocess.run(['git', '-C', RACINE, 'show', REFERENCE_AVANT + ':modal_app/_mesh.py'], capture_output=True,
                               check=True).stdout
    except Exception as e:
        raise unittest.SkipTest('git show indisponible : %s' % e)
    dossier = tempfile.mkdtemp(prefix='mesh_avant_')
    chemin = os.path.join(dossier, 'mesh_avant.py')
    with open(chemin, 'wb') as f:
        f.write(texte)
    spec = importlib.util.spec_from_file_location('mesh_avant', chemin)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


class GenerationAvecCarte(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.sans, cls.journal_sans = generer(carte='0')
        cls.avec, cls.journal_avec = generer(carte=None)

    def test_desactivee_identique_a_l_octet_au_code_d_avant(self):
        avant = charger_mesh_avant()
        octets, journal = generer(module=avant, carte='0')
        self.assertEqual(octets, self.sans, 'FABMESH_NORMAL_MAP=0 doit rendre le GLB d avant, a l octet')
        self.assertEqual(sans_chiffres(journal), sans_chiffres(self.journal_sans))
        j, _ = lire_glb(self.sans)
        self.assertNotIn('normalTexture', j['materials'][0])
        # et le code d'avant, sans la variable, rend lui aussi ce GLB : la variable a 0 ne change rien d'autre
        self.assertEqual(generer(module=avant, carte=None)[0], self.sans)

    def test_carte_posee_sans_perte(self):
        j, blob = lire_glb(self.avec)
        mat = j['materials'][0]
        self.assertIn('normalTexture', mat, 'aucune carte de normales dans le GLB')
        self.assertNotIn('scale', mat['normalTexture'])
        img, octets, mime = image(j, blob, mat['normalTexture']['index'])
        self.assertEqual(mime, 'image/webp')
        self.assertEqual(img.size, (TAILLE, TAILLE))                                  # taille de l'atlas de couleur
        carte = np.asarray(img.convert('RGB'))
        # meme carte qu'une cuisson directe sur le maillage final (geometrie et UV inchanges par les retouches de couleur)
        from modal_app.normal_bake import bake_normal_map
        V, F = maillage_fin()
        attendu = bake_normal_map(to_glb(None, None, None, None, None, None, None, 0, TAILLE, True), V, F, TAILLE, log=None)
        self.assertTrue(np.array_equal(carte, attendu), 'carte alteree (ecart max %d)' % int(np.abs(carte.astype(int) - attendu).max()))
        self.assertGreater(int(np.abs(carte.astype(int) - np.array([128, 128, 255])).max()), 20)   # elle porte bien le relief
        attrs = j['meshes'][0]['primitives'][0]['attributes']
        self.assertIn('NORMAL', attrs)
        self.assertNotIn('TANGENT', attrs)
        # couleur et metal / rugosite : octets identiques au GLB sans carte
        j0, blob0 = lire_glb(self.sans)
        m0 = j0['materials'][0]
        for cle in ('baseColorTexture', 'metallicRoughnessTexture'):
            self.assertEqual(image(j, blob, mat['pbrMetallicRoughness'][cle]['index'])[1],
                             image(j0, blob0, m0['pbrMetallicRoughness'][cle]['index'])[1], cle)
        self.assertEqual({k: v for k, v in mat.items() if k != 'normalTexture'} | {'pbrMetallicRoughness': None},
                         {k: v for k, v in m0.items()} | {'pbrMetallicRoughness': None})
        self.assertEqual(j['asset'], j0['asset'])                                       # marquage IA intact
        self.assertTrue(j['asset'].get('extras', {}).get('aiGenerated'))

    def test_journal(self):
        lignes = [l for l in self.journal_avec if 'normales' in l]
        self.assertTrue(any(l.startswith('[mesh] [normales] carte de normales %dx%d posee' % (TAILLE, TAILLE)) for l in lignes), lignes)
        self.assertTrue(any('finitions' in l and 'carte de normales' in l and 'encodage sans perte' in l for l in self.journal_avec))
        self.assertFalse([l for l in self.journal_sans if 'normales' in l])

    def test_cuisson_qui_leve_rend_le_glb_sans_carte(self):
        import modal_app.normal_bake as NBM
        origine = NBM.bake_normal_map

        def casse(*a, **k):
            raise RuntimeError('panne simulee')
        try:
            NBM.bake_normal_map = casse
            octets, journal = generer(carte=None)
        finally:
            NBM.bake_normal_map = origine
        self.assertEqual(octets, self.sans)
        self.assertTrue(any('ABANDONNEE' in l and 'panne simulee' in l for l in journal), journal)

    def test_ultra_8k_n_agrandit_que_la_couleur(self):
        faux = types.ModuleType('modal_app._esrgan')
        faux.affuter_atlas = lambda tex, echelle_sortie=2: tex.resize((tex.size[0] * echelle_sortie, tex.size[1] * echelle_sortie))
        ancien = sys.modules.get('modal_app._esrgan')
        sys.modules['modal_app._esrgan'] = faux
        try:
            octets, journal = generer(carte=None, ultra_hd=True)
        finally:
            if ancien is None:
                sys.modules.pop('modal_app._esrgan', None)
            else:
                sys.modules['modal_app._esrgan'] = ancien
        j, blob = lire_glb(octets)
        mat = j['materials'][0]
        self.assertEqual(image(j, blob, mat['pbrMetallicRoughness']['baseColorTexture']['index'])[0].size, (2 * TAILLE, 2 * TAILLE))
        img, octets_carte, _ = image(j, blob, mat['normalTexture']['index'])
        self.assertEqual(img.size, (TAILLE, TAILLE))
        ja, blob_a = lire_glb(self.avec)
        self.assertEqual(octets_carte, image(ja, blob_a, ja['materials'][0]['normalTexture']['index'])[1])

    def test_survit_a_un_outil_qui_relit_le_glb(self):
        """Affinage, face fix, Ultra 8K apres coup, variantes, operations : trimesh.load, modification de la couleur, webp_rapide, export."""
        from modal_app.acceleration_glb import webp_rapide
        j0, blob0 = lire_glb(self.avec)
        carte0 = np.asarray(image(j0, blob0, j0['materials'][0]['normalTexture']['index'])[0].convert('RGB'))
        scene = trimesh.load(io.BytesIO(self.avec), file_type='glb')
        for g in scene.geometry.values():
            g.visual.material.baseColorTexture = g.visual.material.baseColorTexture.transpose(Image.FLIP_LEFT_RIGHT)
        webp_rapide(scene)
        buf = io.BytesIO()
        scene.export(buf, file_type='glb', extension_webp=True)
        j, blob = lire_glb(buf.getvalue())
        mat = j['materials'][0]
        self.assertIn('normalTexture', mat)
        carte = np.asarray(image(j, blob, mat['normalTexture']['index'])[0].convert('RGB'))
        self.assertTrue(np.array_equal(carte, carte0), 'carte re-encodee avec perte par l outil (ecart max %d)'
                        % int(np.abs(carte.astype(int) - carte0.astype(int)).max()))
        self.assertIn('NORMAL', j['meshes'][0]['primitives'][0]['attributes'])


if __name__ == '__main__':
    for flux in (sys.stdout, sys.stderr):
        try:
            flux.reconfigure(encoding='utf-8', errors='replace')
        except Exception:
            pass
    unittest.main()
