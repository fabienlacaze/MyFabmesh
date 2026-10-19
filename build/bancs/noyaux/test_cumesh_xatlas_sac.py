"""Parade Smart App Control pour cumesh/_xatlas.pyd (2026-10-19) : scripts/cumesh_xatlas_sac.py.

Lancer :  <python de l'appli> build/bancs/noyaux/test_cumesh_xatlas_sac.py -v
Essai reel (xatlas de PyPI contre le vrai cumesh._xatlas, charge torch + CuMesh) : TEST_REEL=1 <python de l'appli> ...
Autre exemplaire (preuve d'echec sur l'ancien code) : MODULE_SAC=<chemin du module> PIPELINE=<chemin du pipeline natif>
"""
import importlib.util
import os
import sys
import types
import unittest
from unittest import mock

RACINE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
MODULE = os.environ.get('MODULE_SAC') or os.path.join(RACINE, 'scripts', 'cumesh_xatlas_sac.py')
PIPELINE = os.environ.get('PIPELINE') or os.path.join(RACINE, 'scripts', 'trellis2_native_full_pipeline.py')


def charger():
    spec = importlib.util.spec_from_file_location('cumesh_xatlas_sac_teste', MODULE)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


class FauxXatlas(types.ModuleType):
    """Faux paquet xatlas (PyPI) qui enregistre les appels."""

    def __init__(self):
        super().__init__('xatlas')
        self.appels = []
        outer = self

        class ChartOptions:
            max_cost = 16.0

        class PackOptions:
            pass

        class Atlas:
            def add_mesh(self, positions, indices, normals=None, uvs=None):
                outer.appels.append(('add_mesh', positions.dtype.name, indices.dtype.name, positions.flags['C_CONTIGUOUS'],
                                     None if normals is None else normals.dtype.name))

            def generate(self, chart_options, pack_options, verbose=False):
                outer.appels.append(('generate', chart_options, pack_options, verbose))

            def get_mesh(self, index):
                import numpy as np
                return (np.array([0, 1, 2, 2], np.uint32), np.array([[0, 1, 2], [2, 1, 3]], np.uint32),
                        np.array([[0, 0], [1, 0], [0, 1], [1, 1]], np.float32))
        self.ChartOptions, self.PackOptions, self.Atlas = ChartOptions, PackOptions, Atlas


class Base(unittest.TestCase):
    def setUp(self):
        self.m = charger()
        self.avant = {k: sys.modules.get(k) for k in ('cumesh._xatlas', 'xatlas', 'cumesh')}
        for k in ('cumesh._xatlas', 'cumesh'):
            sys.modules.pop(k, None)
        os.environ.pop('FABMESH_CUMESH_XATLAS_SAC', None)

    def tearDown(self):
        for k, v in self.avant.items():
            if v is None:
                sys.modules.pop(k, None)
            else:
                sys.modules[k] = v
        os.environ.pop('FABMESH_CUMESH_XATLAS_SAC', None)


class TestInstaller(Base):
    def test_inactif_quand_windows_laisse_charger(self):
        with mock.patch.object(self.m, '_trouver_pyd', return_value='C:/x/_xatlas.pyd'), \
                mock.patch.object(self.m, '_bloque_par_la_politique', return_value=False):
            self.assertEqual(self.m.installer(log=lambda s: None), 'inactif')
        self.assertNotIn('cumesh._xatlas', sys.modules)

    def test_actif_quand_la_politique_bloque(self):
        sys.modules['xatlas'] = FauxXatlas()
        journal = []
        with mock.patch.object(self.m, '_trouver_pyd', return_value='C:/x/_xatlas.cp311-win_amd64.pyd'), \
                mock.patch.object(self.m, '_bloque_par_la_politique', return_value=True):
            self.assertEqual(self.m.installer(log=journal.append), 'actif')
        self.assertTrue(getattr(sys.modules['cumesh._xatlas'], '__fabmesh_adaptateur__', False))
        self.assertTrue(any('Smart App Control' in ligne for ligne in journal), journal)

    def test_indisponible_quand_xatlas_manque_aussi(self):
        sys.modules['xatlas'] = None                      # `import xatlas` -> ImportError
        journal = []
        with mock.patch.object(self.m, '_trouver_pyd', return_value='C:/x/_xatlas.pyd'), \
                mock.patch.object(self.m, '_bloque_par_la_politique', return_value=True):
            self.assertEqual(self.m.installer(log=journal.append), 'indisponible')
        self.assertNotIn('cumesh._xatlas', sys.modules)
        self.assertTrue(any('IMPOSSIBLE' in ligne for ligne in journal), journal)

    def test_interrupteur_d_urgence(self):
        os.environ['FABMESH_CUMESH_XATLAS_SAC'] = '0'
        with mock.patch.object(self.m, '_bloque_par_la_politique', return_value=True):
            self.assertEqual(self.m.installer(log=lambda s: None), 'inactif')
        self.assertNotIn('cumesh._xatlas', sys.modules)

    def test_idempotent(self):
        sys.modules['xatlas'] = FauxXatlas()
        with mock.patch.object(self.m, '_trouver_pyd', return_value='C:/x/_xatlas.pyd'), \
                mock.patch.object(self.m, '_bloque_par_la_politique', return_value=True):
            self.assertEqual(self.m.installer(log=lambda s: None), 'actif')
            premier = sys.modules['cumesh._xatlas']
            self.assertEqual(self.m.installer(log=lambda s: None), 'actif')
            self.assertIs(sys.modules['cumesh._xatlas'], premier)

    def test_import_avorte_d_avant_est_purge(self):
        sys.modules['xatlas'] = FauxXatlas()
        sys.modules['cumesh'] = types.ModuleType('cumesh')           # paquet a moitie importe : pas d'Atlas
        with mock.patch.object(self.m, '_trouver_pyd', return_value='C:/x/_xatlas.pyd'), \
                mock.patch.object(self.m, '_bloque_par_la_politique', return_value=True):
            self.m.installer(log=lambda s: None)
        self.assertNotIn('cumesh', sys.modules)

    def test_sans_cumesh_installe_rien_ne_se_passe(self):
        with mock.patch.object(self.m, '_trouver_pyd', return_value=None):
            self.assertEqual(self.m.installer(log=lambda s: None), 'inactif')


class TestDetection(Base):
    def _faux_ctypes(self, poignee, code):
        k32 = mock.MagicMock()
        k32.LoadLibraryExW.return_value = poignee
        faux = types.SimpleNamespace(WinDLL=mock.MagicMock(return_value=k32), get_last_error=lambda: code,
                                     c_void_p=object, c_wchar_p=object, c_uint32=object)
        return faux, k32

    def test_code_4551_est_un_blocage_de_politique(self):
        faux, _ = self._faux_ctypes(0, 4551)
        with mock.patch.object(os, 'name', 'nt'), mock.patch.dict(sys.modules, {'ctypes': faux}):
            self.assertTrue(self.m._bloque_par_la_politique('C:/x/_xatlas.pyd'))

    def test_code_1260_aussi(self):
        faux, _ = self._faux_ctypes(0, 1260)
        with mock.patch.object(os, 'name', 'nt'), mock.patch.dict(sys.modules, {'ctypes': faux}):
            self.assertTrue(self.m._bloque_par_la_politique('C:/x/_xatlas.pyd'))

    def test_dependance_manquante_n_est_pas_un_blocage(self):
        faux, _ = self._faux_ctypes(0, 126)                           # module introuvable : autre probleme, pas la politique
        with mock.patch.object(os, 'name', 'nt'), mock.patch.dict(sys.modules, {'ctypes': faux}):
            self.assertFalse(self.m._bloque_par_la_politique('C:/x/_xatlas.pyd'))

    def test_chargement_reussi_libere_la_dll(self):
        faux, k32 = self._faux_ctypes(1234, 0)
        with mock.patch.object(os, 'name', 'nt'), mock.patch.dict(sys.modules, {'ctypes': faux}):
            self.assertFalse(self.m._bloque_par_la_politique('C:/x/_xatlas.pyd'))
        k32.FreeLibrary.assert_called_once()

    def test_hors_windows_ou_sans_chemin(self):
        self.assertFalse(self.m._bloque_par_la_politique(None))
        with mock.patch.object(os, 'name', 'posix'):
            self.assertFalse(self.m._bloque_par_la_politique('/x/_xatlas.so'))


class TestAdaptateur(Base):
    def test_api_attendue_par_cumesh(self):
        faux = FauxXatlas()
        mod = self.m.fabriquer_module(faux)
        for nom in ('Atlas', 'ChartOptions', 'PackOptions'):
            self.assertTrue(hasattr(mod, nom), nom)
        opts = mod.PackOptions()
        for nom in ('max_chart_size', 'padding', 'texels_per_unit', 'resolution', 'bilinear', 'block_align', 'brute_force',
                    'rotate_charts', 'rotate_charts_to_axis'):
            self.assertTrue(hasattr(opts, nom), nom)

    def test_deux_etapes_de_cumesh_deviennent_un_generate(self):
        import numpy as np
        faux = FauxXatlas()
        mod = self.m.fabriquer_module(faux)
        a = mod.Atlas()
        a.add_mesh(np.zeros((4, 3), np.float64), np.zeros((2, 3), np.int64), None, None)
        charts = mod.ChartOptions()
        a.compute_charts(charts, None)
        self.assertEqual([c[0] for c in faux.appels], ['add_mesh'], 'compute_charts ne doit encore rien calculer')
        packs = mod.PackOptions()
        packs.block_align, packs.brute_force, packs.padding = True, True, 3
        a.pack_charts(packs, None)
        self.assertEqual(faux.appels[0][1:4], ('float32', 'uint32', True))
        _, charts_recus, packs_recus, verbose = faux.appels[1]
        self.assertIs(charts_recus, charts)
        self.assertEqual((packs_recus.blockAlign, packs_recus.bruteForce, packs_recus.padding), (True, True, 3))
        self.assertIs(verbose, False)

    def test_pack_sans_compute_utilise_les_options_de_decoupe_par_defaut(self):
        faux = FauxXatlas()
        a = self.m.fabriquer_module(faux).Atlas()
        a.pack_charts(self.m.fabriquer_module(faux).PackOptions(), None)
        self.assertIsInstance(faux.appels[0][1], faux.ChartOptions)

    def test_get_mesh_rend_des_tenseurs_comme_le_vrai_module(self):
        try:
            import torch
        except ImportError:
            self.skipTest('torch absent')
        a = self.m.fabriquer_module(FauxXatlas()).Atlas()
        xrefs, faces, uvs = a.get_mesh(0)
        self.assertEqual((xrefs.dtype, faces.dtype, uvs.dtype), (torch.int32, torch.int32, torch.float32))
        self.assertEqual(tuple(faces.shape), (2, 3))
        self.assertEqual(tuple(uvs.shape), (4, 2))


class TestBranchement(unittest.TestCase):
    def test_pipeline_installe_la_parade_avant_tout_import_de_cumesh(self):
        with open(PIPELINE, encoding='utf-8', newline='') as f:          # newline='' : garde les fins de ligne telles quelles
            texte = f.read()
        i = texte.find('import cumesh_xatlas_sac')
        self.assertGreater(i, 0, 'le pipeline natif ne branche pas la parade')
        j = texte.find('import cloisonnement_memoire')
        self.assertTrue(0 < i < j, 'la parade doit venir avant les imports lourds')
        self.assertEqual(texte.count('\n') - texte.count('\r\n'), 0, 'CRLF perdus')
        premier_cumesh = texte.find('import cumesh\n') if '\r\n' not in texte else texte.find('import cumesh\r\n')
        self.assertTrue(premier_cumesh < 0 or i < premier_cumesh)


@unittest.skipUnless(os.environ.get('TEST_REEL') == '1', 'essai reel : TEST_REEL=1 (charge torch et CuMesh)')
class TestReel(unittest.TestCase):
    def test_meme_resultat_que_le_vrai_module(self):
        import numpy as np
        import torch
        import xatlas
        import cumesh
        m = charger()
        adaptateur = m.fabriquer_module(xatlas)
        # un cube : 8 sommets, 12 triangles
        v = np.array([[x, y, z] for x in (0, 1) for y in (0, 1) for z in (0, 1)], np.float32)
        f = np.array([[0, 1, 3], [0, 3, 2], [4, 6, 7], [4, 7, 5], [0, 4, 5], [0, 5, 1], [2, 3, 7], [2, 7, 6], [0, 2, 6], [0, 6, 4],
                      [1, 5, 7], [1, 7, 3]], np.int32)

        def lancer(classe_atlas):
            a = classe_atlas()
            a.add_mesh(torch.from_numpy(v), torch.from_numpy(f))
            a.compute_charts()
            a.pack_charts(resolution=256, padding=1)
            return a.get_mesh(0)
        r_vrai = lancer(cumesh.Atlas)
        # l'enveloppe de CuMesh branchee sur l'adaptateur
        import cumesh.xatlas as env
        ancien = env._xatlas
        env._xatlas = adaptateur
        try:
            r_adapt = lancer(cumesh.Atlas)
        finally:
            env._xatlas = ancien
        for a, b in zip(r_vrai, r_adapt):
            self.assertTrue(np.allclose(a.numpy(), b.numpy(), atol=1e-5), 'resultat different du vrai module')


if __name__ == '__main__':
    unittest.main()
