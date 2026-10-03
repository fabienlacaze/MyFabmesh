"""Marquage « genere par IA » des GLB derives (AI Act, reglement UE 2024/1689 art. 50) — constat du 2026-10-03.

Defaut mesure sur de vrais fichiers : le GLB sorti du generateur porte asset.generator = « FabMesh ... (AI-generated) »
et asset.extras.aiGenerated, mais tout fichier DERIVE (Smooth / Triangle count / Watertight / Fix normals via trimesh,
editeur et Paint Mesh via THREE.GLTFExporter, rig via Blender) perdait ce marquage.

Ce banc verifie :
  (a) scripts/add_ai_metadata.py::patch_glb : marquage, idempotence, preservation exacte du binaire, ecriture atomique,
      fichiers invalides laisses intacts ;
  (b) scripts/mesh_tools.py::_export (et la CLI) : un GLB exporte par trimesh sort MARQUE ;
  (c) sur des COPIES des vrais fichiers meshes/verif_t80* (outils, editeur, Paint Mesh, rig) : apres marquage, trimesh
      charge la meme geometrie et les memes dimensions de texture qu'avant, le JSON ne differe que dans `asset`, le
      binaire est identique, et les trois cles sont la — par le Python ET par le module JavaScript du bureau.

Lancer :  C:/Users/Utilisateur/AppData/Roaming/myfabmesh-ai/python/python.exe build/bancs/noyaux/test_marquage_ia.py -v
Autres copies pour prouver l'echec sur l'ancien code : NOYAU_MESH_TOOLS, NOYAU_ADD_AI_METADATA (git show HEAD:...).
"""
import importlib.util
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest

import numpy as np

ICI = os.path.dirname(os.path.abspath(__file__))
RACINE = os.path.abspath(os.path.join(ICI, '..', '..', '..'))
SCRIPTS = os.path.join(RACINE, 'scripts')
MESH_TOOLS = os.environ.get('NOYAU_MESH_TOOLS') or os.path.join(SCRIPTS, 'mesh_tools.py')
ADD_AI = os.environ.get('NOYAU_ADD_AI_METADATA') or os.path.join(SCRIPTS, 'add_ai_metadata.py')
MODULE_JS = os.environ.get('MARQUAGE_IA_JS') or os.path.join(RACINE, 'src', 'main', 'marquage_ia.js')
COPIES = os.path.join('C:\\', 'tmp', 'vague3', 'marquage-bureau', 'copies')
sys.path.insert(0, ICI)


def charger(chemin, nom):
    """Charge un script par son chemin. Le dossier du script est mis en tete de sys.path : mesh_tools importe
    add_ai_metadata depuis son propre dossier (comme dans l'appli), donc l'ancien code charge l'ancien module."""
    dossier = os.path.dirname(os.path.abspath(chemin))
    if dossier in sys.path:
        sys.path.remove(dossier)
    sys.path.insert(0, dossier)
    sys.modules.pop('add_ai_metadata', None)
    spec = importlib.util.spec_from_file_location(nom, chemin)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def lire_glb(chemin):
    with open(chemin, 'rb') as f:
        d = f.read()
    assert d[:4] == b'glTF', chemin
    total = struct.unpack('<I', d[8:12])[0]
    jl = struct.unpack('<I', d[12:16])[0]
    return {'octets': d, 'total': total, 'jl': jl,
            'json': json.loads(d[20:20 + jl].decode('utf-8').rstrip('\x00 ')), 'reste': d[20 + jl:]}


def porte_le_marquage(gltf):
    a = gltf.get('asset', {})
    e = a.get('extras') if isinstance(a.get('extras'), dict) else {}
    return (e.get('aiGenerated') is True and e.get('aiSystem') == 'FabMesh' and e.get('aiActArticle50') is True
            and '(AI-generated)' in str(a.get('generator', '')))


def fabriquer(json_obj, binaire, pad=b' '):
    j = json.dumps(json_obj, separators=(',', ':')).encode()
    j += pad * ((4 - len(j) % 4) % 4)
    corps = struct.pack('<I', len(j)) + b'JSON' + j + struct.pack('<I', len(binaire)) + b'BIN\0' + binaire
    return b'glTF' + struct.pack('<II', 2, 12 + len(corps)) + corps


def autre_outil():
    return {'asset': {'version': '2.0', 'generator': 'https://github.com/mikedh/trimesh'},
            'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0}], 'buffers': [{'byteLength': 1000}]}


class AddAiMetadata(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mod = charger(ADD_AI, 'add_ai_metadata_sous_test')

    def setUp(self):
        self.dossier = tempfile.mkdtemp(prefix='marquage_ia_')
        self.addCleanup(shutil.rmtree, self.dossier, True)

    def ecrire(self, nom, contenu):
        p = os.path.join(self.dossier, nom)
        with open(p, 'wb') as f:
            f.write(contenu)
        return p

    def test_marque_et_preserve_le_binaire_exactement(self):
        binaire = bytes((i * 31 + 7) & 255 for i in range(1000))
        p = self.ecrire('a.glb', fabriquer(autre_outil(), binaire))
        avant = lire_glb(p)
        self.assertFalse(porte_le_marquage(avant['json']))
        self.assertTrue(self.mod.patch_glb(p))
        apres = lire_glb(p)
        self.assertTrue(porte_le_marquage(apres['json']))
        self.assertEqual(apres['reste'], avant['reste'], 'chunk binaire identique octet pour octet')
        self.assertEqual(apres['total'], len(apres['octets']))
        self.assertEqual(apres['jl'] % 4, 0)
        self.assertEqual(apres['json']['scenes'], [{'nodes': [0]}])
        self.assertEqual([f for f in os.listdir(self.dossier) if f.endswith('.tmp')], [])

    def test_idempotent_un_fichier_deja_marque_nest_pas_reecrit(self):
        p = self.ecrire('a.glb', fabriquer(autre_outil(), b'\x01' * 64))
        self.assertTrue(self.mod.patch_glb(p))
        avant = open(p, 'rb').read()
        m = os.stat(p).st_mtime_ns
        self.assertTrue(self.mod.patch_glb(p))
        self.assertEqual(open(p, 'rb').read(), avant)
        self.assertEqual(os.stat(p).st_mtime_ns, m, 'aucune reecriture')

    def test_fichiers_invalides_laisses_intacts(self):
        bon = fabriquer(autre_outil(), b'\x02' * 500)
        cas = {
            'tronque': bon[:-100],
            'magic': b'XXXX' + bon[4:],
            'longueur': bon[:8] + struct.pack('<I', len(bon) + 5) + bon[12:],
            'pas_json': bon[:16] + b'BIN\0' + bon[20:],
            'json_illisible': fabriquer({}, b'\x00' * 8).replace(b'{}', b'{ '),
            'vide': b'',
        }
        for nom, contenu in cas.items():
            with self.subTest(nom):
                p = self.ecrire(nom + '.glb', contenu)
                self.assertFalse(self.mod.patch_glb(p))
                self.assertEqual(open(p, 'rb').read(), contenu)
        self.assertEqual([f for f in os.listdir(self.dossier) if f.endswith('.tmp')], [])

    def test_json_rempli_par_des_zeros(self):
        for extra in range(4):
            j = autre_outil()
            j['asset']['c'] = 'x' * extra
            p = self.ecrire(f'z{extra}.glb', fabriquer(j, b'\x03' * 40, pad=b'\x00'))
            self.assertTrue(self.mod.patch_glb(p), extra)
            self.assertTrue(porte_le_marquage(lire_glb(p)['json']))

    def test_sortie_distincte_laisse_lentree_intacte(self):
        p = self.ecrire('in.glb', fabriquer(autre_outil(), b'\x04' * 80))
        o = os.path.join(self.dossier, 'out.glb')
        original = open(p, 'rb').read()
        self.assertTrue(self.mod.patch_glb(p, o))
        self.assertEqual(open(p, 'rb').read(), original)
        self.assertTrue(porte_le_marquage(lire_glb(o)['json']))

    def test_gros_fichier_ecrit_en_flux(self):
        """100 Mo : le binaire est recopie par blocs, jamais charge en entier (pic de memoire Python mesure)."""
        import tracemalloc
        taille = 100 * 1024 * 1024
        j = autre_outil()
        j['buffers'][0]['byteLength'] = taille
        jb = json.dumps(j, separators=(',', ':')).encode()
        jb += b' ' * ((4 - len(jb) % 4) % 4)
        p = os.path.join(self.dossier, 'gros.glb')
        bloc = bytes((i * 13 + 5) & 255 for i in range(1024 * 1024))
        with open(p, 'wb') as f:
            f.write(b'glTF' + struct.pack('<II', 2, 12 + 8 + len(jb) + 8 + taille))
            f.write(struct.pack('<I', len(jb)) + b'JSON' + jb + struct.pack('<I', taille) + b'BIN\0')
            for _ in range(taille // len(bloc)):
                f.write(bloc)
        tracemalloc.start()
        ok = self.mod.patch_glb(p)
        _, pic = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        self.assertTrue(ok)
        self.assertLess(pic, 50 * 1024 * 1024, f'pic {pic / 1e6:.1f} Mo : le fichier ne doit pas etre charge en entier')
        r = lire_glb_entete(p)
        self.assertTrue(porte_le_marquage(r))


def lire_glb_entete(chemin):
    with open(chemin, 'rb') as f:
        e = f.read(20)
        jl = struct.unpack('<I', e[12:16])[0]
        return json.loads(f.read(jl).decode('utf-8').rstrip('\x00 '))


class MeshToolsExport(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import trimesh  # noqa: F401
        cls.mod = charger(MESH_TOOLS, 'mesh_tools_sous_test')

    def setUp(self):
        self.dossier = tempfile.mkdtemp(prefix='marquage_tools_')
        self.addCleanup(shutil.rmtree, self.dossier, True)

    def _source(self):
        import trimesh
        m = trimesh.creation.icosphere(subdivisions=3)
        p = os.path.join(self.dossier, 'source.glb')
        m.export(p)
        # un GLB « genere » : marque, comme la sortie du generateur
        sys.modules.pop('add_ai_metadata', None)
        charger(ADD_AI, 'add_ai_sous_test').patch_glb(p)
        return p

    def test_export_trimesh_sort_marque(self):
        import trimesh
        m = trimesh.creation.box()
        p = os.path.join(self.dossier, 'boite.glb')
        self.mod._export(None, [m], p)
        gltf = lire_glb(p)['json']
        self.assertTrue(porte_le_marquage(gltf), f"asset = {gltf['asset']}")

    def test_smooth_decimate_fix_normals_sortent_marques(self):
        src = self._source()
        sorties = {}
        sorties['smooth'] = os.path.join(self.dossier, 'smooth.glb')
        self.mod.smooth(src, sorties['smooth'], 2, 0.5)
        sorties['fix_normals'] = os.path.join(self.dossier, 'fix.glb')
        self.mod.fix_normals(src, sorties['fix_normals'])
        sorties['center'] = os.path.join(self.dossier, 'center.glb')
        self.mod.center(src, sorties['center'])
        for nom, p in sorties.items():
            with self.subTest(nom):
                self.assertTrue(os.path.exists(p))
                self.assertTrue(porte_le_marquage(lire_glb(p)['json']), nom)

    def test_cli_marque_aussi_les_sorties_hors_export(self):
        """La CLI marque apres l'operation : couvre les ops qui passent par un sous-processus (scellage, retexture...)."""
        src = self._source()
        sortie = os.path.join(self.dossier, 'cli.glb')
        r = subprocess.run([sys.executable, MESH_TOOLS, 'center', src, sortie], capture_output=True, text=True, timeout=300,
                           env={**os.environ, 'PYTHONUTF8': '1'})
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertTrue(porte_le_marquage(lire_glb(sortie)['json']))

    def test_un_echec_de_marquage_nest_jamais_fatal(self):
        import trimesh
        m = trimesh.creation.box()
        p = os.path.join(self.dossier, 'ok.glb')
        sys.modules['add_ai_metadata'] = type(sys)('add_ai_metadata')   # module sans patch_glb -> ImportError
        try:
            self.mod._export(None, [m], p)
        finally:
            sys.modules.pop('add_ai_metadata', None)
        self.assertTrue(os.path.exists(p) and os.path.getsize(p) > 100, 'le fichier est exporte malgre l\'echec du marquage')


def vrais_fichiers():
    meshes = os.path.join(RACINE, 'meshes')
    if not os.path.isdir(meshes):
        return []
    return sorted(f for f in os.listdir(meshes)
                  if f.startswith('verif_t80_trellis2_native_1791025300001') and f.endswith('.glb'))


def empreinte(chemin):
    """Geometrie et textures vues par trimesh : sommets, faces, bornes, taille de chaque texture."""
    import trimesh
    sc = trimesh.load(chemin, force='scene', process=False)
    sortie = []
    for nom in sorted(sc.geometry):
        g = sc.geometry[nom]
        tex = []
        mat = getattr(getattr(g, 'visual', None), 'material', None)
        for attr in ('baseColorTexture', 'image', 'metallicRoughnessTexture', 'normalTexture', 'emissiveTexture'):
            im = getattr(mat, attr, None) if mat is not None else None
            if im is not None and hasattr(im, 'size'):
                tex.append((attr, tuple(im.size)))
        sortie.append((nom, len(g.vertices), len(g.faces),
                       tuple(np.round(g.bounds.reshape(-1), 5).tolist()), tuple(tex)))
    return sortie


@unittest.skipUnless(vrais_fichiers(), 'meshes/verif_t80* absents (fichiers ignores par git, produits par l\'appli)')
class VraisFichiers(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import trimesh  # noqa: F401
        os.makedirs(COPIES, exist_ok=True)
        cls.mod = charger(ADD_AI, 'add_ai_reel')

    def _copie(self, nom):
        dest = os.path.join(COPIES, nom)
        shutil.copyfile(os.path.join(RACINE, 'meshes', nom), dest)
        self.addCleanup(lambda: os.path.exists(dest) and os.remove(dest))
        return dest

    def _verifie(self, nom, marqueur):
        copie = self._copie(nom)
        avant, json_avant = empreinte(copie), lire_glb(copie)
        self.assertTrue(marqueur(copie), nom)
        apres = lire_glb(copie)
        self.assertTrue(porte_le_marquage(apres['json']), f'{nom} : trois cles absentes')
        self.assertEqual(apres['reste'], json_avant['reste'], f'{nom} : binaire modifie')
        sans = lambda g: {k: v for k, v in g.items() if k != 'asset'}   # noqa: E731
        self.assertEqual(sans(apres['json']), sans(json_avant['json']), f'{nom} : JSON modifie hors asset')
        self.assertEqual(apres['json']['asset'].get('version'), json_avant['json']['asset'].get('version'))
        self.assertEqual(empreinte(copie), avant, f'{nom} : geometrie / textures differentes pour trimesh')
        self.assertEqual(apres['total'], len(apres['octets']))

    def test_python_sur_tous_les_vrais_fichiers(self):
        for nom in vrais_fichiers():
            with self.subTest(nom):
                self._verifie(nom, self.mod.patch_glb)

    def test_javascript_du_bureau_sur_les_derives(self):
        """Le module Node du bureau (editeur, Paint Mesh, rig) donne le meme resultat, relu par trimesh."""
        def par_node(chemin):
            code = ('const { marquerGlbIA } = require(%s);'
                    'const r = marquerGlbIA(%s); console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 3);'
                    % (json.dumps(MODULE_JS), json.dumps(chemin)))
            r = subprocess.run(['node', '-e', code], capture_output=True, text=True, timeout=300)
            return r.returncode == 0
        for nom in vrais_fichiers():
            if not any(m in nom for m in ('_edited_', '_paint_', '_rigged_', '_smooth_', '_fix_normals_', '_decimate_', '_watertight_')):
                continue
            with self.subTest(nom):
                self._verifie(nom, par_node)


if __name__ == '__main__':
    unittest.main()
