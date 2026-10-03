"""Marquage « genere par IA » des GLB derives cote Modal (2026-10-03, AI Act art. 50, reglement UE 2024/1689).

Defaut mesure : la generation marque son GLB (asset.generator + asset.extras.aiGenerated...), mais tout
fichier DERIVE le perdait (trimesh, three.js et Blender remplacent le generateur et jettent les extras).
Ce test fabrique de vrais GLB (sphere texturee a coutures UV, comme build/bancs/noyaux/test_smooth.py) et
exige :
  * modal_app/_marquage_ia.py : memes valeurs que scripts/add_ai_metadata.py, octets identiques pour un
    fichier non marque ; idempotent ; chunk binaire intact octet pour octet ; entrees invalides rendues
    telles quelles ; autres cles de extras conservees ;
  * _mesh._patch_ai_act_metadata (generation) : resultat IDENTIQUE a celui de l'ancienne version (HEAD) ;
  * _mesh_op : TOUTES les operations de maillage ressortent marquees, geometrie / texture chargeables ;
  * _face_fix.apply_face_fix et _retexture.retexturer (pipeline simule) : sortie marquee ;
  * app.py et _skintokens_rig.py : les points de sortie appellent bien le marquage (controle de l'arbre
    syntaxique : ces fonctions exigent un GPU / Modal, on verifie le cablage, pas l'inference).

Lancer :  <python de l'appli> build/bancs/noyaux/test_marquage_modal.py -v
Pour prouver l'echec sur l'ancien code (git show HEAD:<fichier> vers un fichier temporaire) :
NOYAU_MESH_OP, NOYAU_FACE_FIX, NOYAU_RETEXTURE, NOYAU_MESH (+ NOYAU_APP, NOYAU_RIG pour le cablage).
"""
import ast
import importlib.util
import io
import json
import os
import struct
import subprocess
import sys
import tempfile
import unittest

import numpy as np

for _flux in (sys.stdout, sys.stderr):      # les journaux des operations contiennent des fleches : cp1252 sous Windows
    try:
        _flux.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

ICI = os.path.dirname(os.path.abspath(__file__))
RACINE = os.path.abspath(os.path.join(ICI, '..', '..', '..'))
sys.path.insert(0, ICI)
sys.path.insert(0, RACINE)
import _maillages as M  # noqa: E402

CHEMINS = {
    'mesh_op': os.environ.get('NOYAU_MESH_OP') or os.path.join(RACINE, 'modal_app', '_mesh_op.py'),
    'face_fix': os.environ.get('NOYAU_FACE_FIX') or os.path.join(RACINE, 'modal_app', '_face_fix.py'),
    'retexture': os.environ.get('NOYAU_RETEXTURE') or os.path.join(RACINE, 'modal_app', '_retexture.py'),
    'mesh': os.environ.get('NOYAU_MESH') or os.path.join(RACINE, 'modal_app', '_mesh.py'),
    'app': os.environ.get('NOYAU_APP') or os.path.join(RACINE, 'modal_app', 'app.py'),
    'rig': os.environ.get('NOYAU_RIG') or os.path.join(RACINE, 'modal_app', '_skintokens_rig.py'),
}
HEAD_MESH = os.path.join(RACINE, 'modal_app', '_mesh.py')


def charger(chemin, nom):
    spec = importlib.util.spec_from_file_location(nom, chemin)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def decouper(glb):
    """(json dict, octets du chunk JSON, tout ce qui suit le chunk JSON)."""
    n = struct.unpack('<I', glb[12:16])[0]
    assert glb[16:20] == b'JSON'
    return json.loads(glb[20:20 + n].decode('utf-8')), glb[20:20 + n], glb[20 + n:]


def est_marque(glb):
    if not (glb[:4] == b'glTF'):
        return False
    j, _, _ = decouper(glb)
    a = j.get('asset', {})
    e = a.get('extras') or {}
    return (a.get('generator') == 'FabMesh 1.0.0 (AI-generated)'
            and e.get('aiGenerated') is True and e.get('aiSystem') == 'FabMesh'
            and e.get('aiActArticle50') is True)


def coherent(glb):
    """En-tete GLB coherent : longueur declaree = taille reelle, chunks bien alignes sur 4 octets."""
    assert struct.unpack('<I', glb[8:12])[0] == len(glb)
    pos = 12
    while pos < len(glb):
        n = struct.unpack('<I', glb[pos:pos + 4])[0]
        assert n % 4 == 0, 'chunk non aligne'
        pos += 8 + n
    assert pos == len(glb)
    return True


def fonction_de_source(source, nom):
    """Extrait la fonction `nom` d'un texte Python (sans importer le module entier) et la compile."""
    arbre = ast.parse(source)
    for noeud in ast.walk(arbre):
        if isinstance(noeud, ast.FunctionDef) and noeud.name == nom:
            espace = {}
            exec(compile(ast.Module(body=[noeud], type_ignores=[]), '<extrait>', 'exec'), espace)
            return espace[nom]
    raise AssertionError(f'fonction {nom} introuvable')


def appelle(noeud_fonction, nom):
    """True si le corps de la fonction contient un appel a `nom` (ou a un attribut de ce nom)."""
    for n in ast.walk(noeud_fonction):
        if isinstance(n, ast.Call):
            f = n.func
            if (isinstance(f, ast.Name) and f.id == nom) or (isinstance(f, ast.Attribute) and f.attr == nom):
                return True
    return False


def fonctions(source):
    return {n.name: n for n in ast.walk(ast.parse(source))
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}


class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import trimesh
        cls.trimesh = trimesh
        cls.sphere = M.sphere_texturee(subdivisions=3)
        buf = io.BytesIO()
        cls.sphere.export(buf, file_type='glb')
        cls.glb = buf.getvalue()           # sortie typique d'un export trimesh : NON marquee
        cls.marquage = charger(os.path.join(RACINE, 'modal_app', '_marquage_ia.py'), 'marquage_ia_sous_test')


class TestModuleMarquage(Base):
    def test_le_fichier_de_depart_n_est_pas_marque(self):
        self.assertFalse(est_marque(self.glb))
        self.assertIn('trimesh', decouper(self.glb)[0]['asset']['generator'])

    def test_marque_et_reste_valide(self):
        sortie = self.marquage.marquer_glb_octets(self.glb)
        self.assertTrue(est_marque(sortie))
        self.assertTrue(coherent(sortie))
        scene = self.trimesh.load(io.BytesIO(sortie), file_type='glb')
        g = list(scene.geometry.values())[0]
        self.assertEqual(len(g.faces), len(self.sphere.faces))
        self.assertIsNotNone(g.visual.material.baseColorTexture)

    def test_chunk_binaire_intact_octet_pour_octet(self):
        sortie = self.marquage.marquer_glb_octets(self.glb)
        self.assertEqual(decouper(sortie)[2], decouper(self.glb)[2])

    def test_autres_donnees_du_json_conservees(self):
        j0 = decouper(self.glb)[0]
        j1 = decouper(self.marquage.marquer_glb_octets(self.glb))[0]
        j0['asset'].pop('generator', None)
        j0['asset'].pop('extras', None)
        j1['asset'].pop('generator', None)
        j1['asset'].pop('extras', None)
        self.assertEqual(j0, j1)

    def test_idempotent(self):
        une = self.marquage.marquer_glb_octets(self.glb)
        deux = self.marquage.marquer_glb_octets(une)
        self.assertIs(une, deux, 'un fichier deja marque ne doit pas etre reecrit')
        self.assertEqual(une, deux)

    def test_les_autres_extras_sont_conserves(self):
        j, brut, reste = decouper(self.glb)
        j.setdefault('asset', {})['extras'] = {'auteur': 'moi'}
        nouveau = json.dumps(j, separators=(',', ':')).encode()
        nouveau += b' ' * ((4 - len(nouveau) % 4) % 4)
        glb = (b'glTF' + struct.pack('<II', 2, 20 + len(nouveau) + len(reste))
               + struct.pack('<I', len(nouveau)) + b'JSON' + nouveau + reste)
        sortie = self.marquage.marquer_glb_octets(glb)
        extras = decouper(sortie)[0]['asset']['extras']
        self.assertEqual(extras['auteur'], 'moi')
        self.assertTrue(est_marque(sortie))

    def test_entrees_invalides_rendues_telles_quelles(self):
        m = self.marquage.marquer_glb_octets
        # taille declaree incoherente (fichier tronque)
        tronque = self.glb[:len(self.glb) - 100]
        # chunk JSON qui deborde
        deborde = self.glb[:12] + struct.pack('<I', len(self.glb) * 2) + self.glb[16:]
        # JSON invalide
        mauvais = b'{pas du json!!'
        mauvais += b' ' * ((4 - len(mauvais) % 4) % 4)
        invalide = (b'glTF' + struct.pack('<II', 2, 20 + len(mauvais)) + struct.pack('<I', len(mauvais))
                    + b'JSON' + mauvais)
        # JSON qui n'est pas un objet
        liste = b'[1,2]  '
        pas_objet = b'glTF' + struct.pack('<II', 2, 20 + 8) + struct.pack('<I', 8) + b'JSON' + liste + b' '
        # asset qui n'est pas un objet
        asset_texte = b'{"asset":"x"}   '
        pas_asset = (b'glTF' + struct.pack('<II', 2, 20 + len(asset_texte)) + struct.pack('<I', len(asset_texte))
                     + b'JSON' + asset_texte)
        # premier chunk pas JSON, mauvaise version, trop court, vide, None, texte
        pas_json = self.glb[:16] + b'BIN\x00' + self.glb[20:]
        version1 = self.glb[:4] + struct.pack('<I', 1) + self.glb[8:]
        for nom, x in [('tronque', tronque), ('deborde', deborde), ('invalide', invalide),
                       ('pas_objet', pas_objet), ('pas_asset', pas_asset), ('pas_json', pas_json),
                       ('version1', version1), ('court', b'glTF'), ('vide', b''), ('texte', b'hello world, not a glb'),
                       ('fbx', b'Kaydara FBX Binary  \x00\x1a\x00')]:
            with self.subTest(nom):
                self.assertIs(m(x), x)
        self.assertIsNone(m(None))
        self.assertEqual(m(bytearray(b'abc')), bytearray(b'abc'))

    def test_parite_des_valeurs_avec_le_bureau(self):
        """Memes cles, memes valeurs, memes octets que scripts/add_ai_metadata.py::patch_glb."""
        bureau = charger(os.path.join(RACINE, 'scripts', 'add_ai_metadata.py'), 'add_ai_metadata_sous_test')
        self.assertEqual(self.marquage.FABMESH_VERSION, bureau.FABMESH_VERSION)
        with tempfile.TemporaryDirectory() as d:
            entree = os.path.join(d, 'e.glb')
            sortie = os.path.join(d, 's.glb')
            with open(entree, 'wb') as f:
                f.write(self.glb)
            self.assertTrue(bureau.patch_glb(entree, sortie))
            with open(sortie, 'rb') as f:
                octets_bureau = f.read()
        octets_modal = self.marquage.marquer_glb_octets(self.glb)
        self.assertEqual(octets_modal, octets_bureau)
        a = decouper(octets_modal)[0]['asset']
        self.assertEqual(a['generator'], 'FabMesh 1.0.0 (AI-generated)')
        self.assertEqual(a['extras'], {'aiGenerated': True, 'aiSystem': 'FabMesh', 'aiActArticle50': True})


class TestGenerationInchangee(Base):
    """La factorisation de _mesh._patch_ai_act_metadata ne change rien pour la generation."""

    @staticmethod
    def _source_head():
        try:
            return subprocess.run(['git', 'show', 'HEAD:modal_app/_mesh.py'], cwd=RACINE, capture_output=True,
                                  check=True, timeout=60).stdout.decode('utf-8')
        except Exception:
            return None

    def test_meme_resultat_que_l_ancienne_version(self):
        ancienne_src = self._source_head()
        if ancienne_src is None:
            self.skipTest('git indisponible')
        ancienne = fonction_de_source(ancienne_src, '_patch_ai_act_metadata')
        with open(CHEMINS['mesh'], encoding='utf-8') as f:
            nouvelle = fonction_de_source(f.read(), '_patch_ai_act_metadata')
        self.assertEqual(nouvelle(self.glb), ancienne(self.glb))
        for x in (b'', b'glTF', b'pas un glb', self.glb[:30]):
            self.assertEqual(nouvelle(x), ancienne(x))


class TestOperationsDeMaillage(Base):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.mo = charger(CHEMINS['mesh_op'], 'mesh_op_marquage_sous_test')

    def _verifier(self, nom, sortie):
        self.assertTrue(est_marque(sortie), f'{nom} : sortie NON marquee ({decouper(sortie)[0]["asset"]})')
        self.assertTrue(coherent(sortie))
        scene = self.trimesh.load(io.BytesIO(sortie), file_type='glb')
        self.assertTrue(len(scene.geometry) >= 1)

    def test_chaque_operation_de_maillage_sort_marquee(self):
        cas = [
            ('smooth', {'iterations': 2}),
            ('decimate', {'target_faces': 500}),
            ('subdivide', {'iterations': 1}),
            ('watertight', {'resolution': 48}),
            ('center', {}),
            ('fix_normals', {}),
            ('material', {}),
            ('material_adjust', {'brightness': 1.1}),
            ('resize', {'sx': 1.2, 'sy': 1.0, 'sz': 0.8}),
            ('explode', {'fragments': 4}),
        ]
        for op, params in cas:
            with self.subTest(op):
                sortie, _stats = self.mo.run(op, self.glb, params)
                self._verifier(op, sortie)

    def test_fill_holes_marque(self):
        # sphere percee de quelques triangles (sinon l'operation refuse : « rien a boucher »)
        m = M.sphere_texturee(subdivisions=3)
        m.update_faces(np.arange(len(m.faces)) % 40 != 0)
        buf = io.BytesIO()
        m.export(buf, file_type='glb')
        sortie, stats = self.mo.run('fill_holes', buf.getvalue(), {})
        self._verifier('fill_holes', sortie)

    def test_export_direct_marque(self):
        scene = self.trimesh.load(io.BytesIO(self.glb), file_type='glb', force='scene')
        self._verifier('_export', self.mo._export(scene))

    def test_sorties_hors_export_marquees_par_run(self):
        """align_texture et retex_swap rendent un fichier qui ne passe pas toujours par _export (reseau
        et sous-processus necessaires) : on simule l'operation et on exige le marquage par run()."""
        if not hasattr(self.mo, '_executer'):
            self.fail('run() ne marque pas les operations hors _export (pas de point d entree unique)')
        for op in ('align_texture', 'retex_swap'):
            with self.subTest(op):
                original = self.mo._executer
                self.mo._executer = lambda t, g, p=None: (self.glb, None)
                try:
                    sortie, _ = self.mo.run(op, self.glb, {'image_url': 'https://exemple.invalide/x.png'})
                finally:
                    self.mo._executer = original
                self._verifier(op, sortie)

    def test_apercu_image_inchange(self):
        png = b'\x89PNG\r\n\x1a\n' + b'0' * 40
        original = self.mo._executer if hasattr(self.mo, '_executer') else None
        if original is None:
            self.skipTest('ancien code')
        self.mo._executer = lambda t, g, p=None: (png, None)
        try:
            sortie, _ = self.mo.run('apercu', png, {})
        finally:
            self.mo._executer = original
        self.assertIs(sortie, png)

    def test_non_regression_geometrie_smooth(self):
        """Le marquage ne change ni les faces ni les UV."""
        sortie, _ = self.mo.run('center', self.glb, {})
        g0 = list(self.trimesh.load(io.BytesIO(self.glb), file_type='glb').geometry.values())[0]
        g1 = list(self.trimesh.load(io.BytesIO(sortie), file_type='glb').geometry.values())[0]
        self.assertEqual(len(g0.faces), len(g1.faces))
        self.assertTrue(np.allclose(np.asarray(g0.visual.uv), np.asarray(g1.visual.uv), atol=1e-5))


class TestFaceFixEtRetexture(Base):
    def test_face_fix_sort_marque(self):
        from PIL import Image
        ff = charger(CHEMINS['face_fix'], 'face_fix_sous_test')
        ff.detect_face_bbox = lambda img, expand=0.30: (0, 0, 1024, 1024)
        ff.inpaint_atlas = lambda pipe, tex, masque, prompt, force, *a, **k: tex.copy()
        front = Image.new('RGB', (512, 512), (200, 180, 160))
        sortie = ff.apply_face_fix(self.glb, front, object(), strength=0.4)
        self.assertTrue(est_marque(sortie), 'face fix : sortie NON marquee')
        self.assertTrue(coherent(sortie))

    def test_retexture_sort_marque(self):
        rt = charger(CHEMINS['retexture'], 'retexture_sous_test')
        sphere2 = M.sphere_texturee(subdivisions=3, graine=1)

        class FauxModele:
            image_size = 0

        class FauxPipeline:
            image_cond_model = FauxModele()

            def run(self, mesh, ref, seed=0, texture_size=0, tex_slat_sampler_params=None):
                return self_scene

        import trimesh
        self_scene = trimesh.Scene(sphere2)
        from PIL import Image
        sortie = rt.retexturer(FauxPipeline(), self.glb, [Image.new('RGB', (256, 256), (120, 90, 60))],
                               preset='fast', seed=1)
        self.assertTrue(est_marque(sortie), 'retexture : sortie NON marquee')
        self.assertTrue(coherent(sortie))


class TestCablage(unittest.TestCase):
    """Les sorties qui exigent un GPU ou Modal : on verifie que le marquage est bien appele."""

    @classmethod
    def setUpClass(cls):
        with open(CHEMINS['app'], encoding='utf-8') as f:
            cls.app_src = f.read()
        with open(CHEMINS['rig'], encoding='utf-8') as f:
            cls.rig_src = f.read()
        cls.app_fn = fonctions(cls.app_src)

    def test_app_helper_marque(self):
        self.assertIn('_marquer_ia', self.app_fn, 'app.py n a pas de _marquer_ia')
        helper = fonction_de_source(self.app_src, '_marquer_ia')
        # le helper renvoie l'entree si le module est introuvable ou si l'entree n'est pas un GLB
        self.assertEqual(helper(b'pas un glb'), b'pas un glb')
        sys.path.insert(0, RACINE)
        glb = M.sphere_texturee(subdivisions=2)
        buf = io.BytesIO()
        glb.export(buf, file_type='glb')
        self.assertTrue(est_marque(helper(buf.getvalue())))

    def test_app_points_de_sortie(self):
        attendus = {
            '_route_mesh_texvar': 'variantes de texture',
            '_route_mesh_enhance_tex': 'nettete x2',
            '_route_mesh_region_retex': 're-texture de zone',
            'mesh_start': 'construction 3D / convert',
            'generate_to_volume': 'generation + refine + face fix + 8K',
            'reshape_to_volume': 'reshape',
            'mesh_convert': 'export glb via Blender',
        }
        for nom, role in attendus.items():
            with self.subTest(nom):
                self.assertTrue(nom in self.app_fn, f'{nom} introuvable dans app.py')
                self.assertTrue(appelle(self.app_fn[nom], '_marquer_ia'), f'{nom} ({role}) ne marque pas sa sortie')

    def test_rig_marque_avant_ecriture(self):
        fn = fonctions(self.rig_src)['rig_mesh']
        self.assertTrue(appelle(fn, 'marquer_glb_octets'), 'rig_mesh ne marque pas sa sortie')
        # et AVANT l'ecriture sur le volume
        src = self.rig_src
        self.assertLess(src.index('marquer_glb_octets(data)'), src.index('/rig_data/{job_id}.glb", "wb"'))


class TestLodEtPartsam(Base):
    """Relecture 2026-10-03 : les deux dernieres sorties GLB de Modal : modal_app/_lod.py (version legere, rig pleine resolution, textures
    peintes reportees) et modal_app/_partsam.py (maillage segmente)."""

    def test_lod_helper_et_sorties(self):
        with open(os.path.join(RACINE, 'modal_app', '_lod.py'), encoding='utf-8') as f:
            src = f.read()
        helper = fonction_de_source(src, '_marquer')
        self.assertTrue(est_marque(helper(self.glb)))
        self.assertEqual(helper(b'pas un glb'), b'pas un glb')
        fn = fonctions(src)
        for nom in ('faire_leger', 'reporter_peau', 'reporter_texture'):
            self.assertTrue(appelle(fn[nom], '_marquer'), nom + ' ne marque pas sa sortie')

    def test_partsam_helper_et_sortie(self):
        with open(os.path.join(RACINE, 'modal_app', '_partsam.py'), encoding='utf-8') as f:
            src = f.read()
        helper = fonction_de_source(src, '_marquer')
        self.assertTrue(est_marque(helper(self.glb)))
        self.assertTrue(appelle(fonctions(src)['_run_segment_pipeline'], '_marquer'), 'le maillage segmente n est pas marque')
        self.assertIn('.add_local_python_source("modal_app")', src, "l'image de partsam doit embarquer le paquet modal_app")


if __name__ == '__main__':
    unittest.main()
