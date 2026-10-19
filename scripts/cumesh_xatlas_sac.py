"""Parade « Smart App Control » pour l'extension native xatlas de CuMesh (2026-10-19).

Symptome (appli de bureau, outil « Reshape a region » ou toute generation 3D locale) :
    ImportError: DLL load failed while importing _xatlas : An Application Control policy has blocked this file.
Cause : `cumesh/_xatlas.cp311-win_amd64.pyd` est une extension compilee sur place, NON signee, sans reputation ; Smart App Control
(Code Integrity, evenements 3077 / 3033) en refuse le chargement. `import cumesh` echoue alors tout entier, car
`cumesh/xatlas.py` fait `from . import _xatlas`.
On ne desactive JAMAIS Smart App Control (interdiction formelle du proprietaire) : meme parade que `scripts/rembg/` (numba / pymatting) et
`scripts/lucida_shims.py` (kornia / timm). Si le vrai module est bloque, `installer()` le remplace, AVANT `import cumesh`, par un adaptateur
au-dessus du paquet PyPI `xatlas` (meme bibliotheque C++, roue largement diffusee) :
  * le vrai module gagne TOUJOURS : rien ne change tant que Windows le laisse charger ;
  * l'adaptateur reproduit l'API que `cumesh/xatlas.py` utilise : Atlas.add_mesh / compute_charts / pack_charts / get_mesh,
    ChartOptions, PackOptions (noms en snake_case : block_align, brute_force) ; get_mesh rend des tenseurs torch comme le vrai module ;
  * si l'adaptateur est lui aussi impossible (paquet absent ou bloque), `installer()` le dit et rend 'indisponible' : l'erreur d'origine
    reste visible, rien n'est masque.
Desactivation d'urgence : FABMESH_CUMESH_XATLAS_SAC=0.
"""
import importlib.util
import os
import sys
import types

ETATS = ('inactif', 'actif', 'indisponible')
# Erreurs Windows rendues quand la politique d'application refuse l'image : 4551 (ERROR_..._BLOCKED, vu dans le journal de l'appli)
# et 1260 (ERROR_ACCESS_DISABLED_BY_POLICY).
CODES_POLITIQUE = (4551, 1260)


def _trouver_pyd():
    """Chemin de cumesh/_xatlas*.pyd SANS importer cumesh (le find_spec d'un paquet de premier niveau n'execute pas son __init__)."""
    try:
        spec = importlib.util.find_spec('cumesh')
    except (ImportError, ValueError):
        return None
    if spec is None or not spec.submodule_search_locations:
        return None
    for dossier in spec.submodule_search_locations:
        try:
            for nom in sorted(os.listdir(dossier)):
                if nom.startswith('_xatlas') and nom.endswith('.pyd'):
                    return os.path.join(dossier, nom)
        except OSError:
            continue
    return None


def _bloque_par_la_politique(chemin):
    """Vrai si Windows refuse de charger `chemin` pour une raison de politique (Smart App Control). Faux ailleurs et en cas de doute."""
    if os.name != 'nt' or not chemin:
        return False
    try:
        import ctypes
        k32 = ctypes.WinDLL('kernel32', use_last_error=True)
        k32.LoadLibraryExW.restype = ctypes.c_void_p
        k32.LoadLibraryExW.argtypes = [ctypes.c_wchar_p, ctypes.c_void_p, ctypes.c_uint32]
        k32.FreeLibrary.argtypes = [ctypes.c_void_p]
        poignee = k32.LoadLibraryExW(chemin, None, 0x00000008)      # LOAD_WITH_ALTERED_SEARCH_PATH
        if poignee:
            k32.FreeLibrary(poignee)
            return False
        return ctypes.get_last_error() in CODES_POLITIQUE
    except Exception:
        return False


class _OptionsEmpaquetage:
    """PackOptions de cumesh/_xatlas (snake_case) : on retient les valeurs, puis on les verse dans le vrai xatlas.PackOptions."""

    def __init__(self):
        self.max_chart_size = 0
        self.padding = 0
        self.texels_per_unit = 0.0
        self.resolution = 0
        self.bilinear = True
        self.block_align = False
        self.brute_force = False
        self.rotate_charts = True
        self.rotate_charts_to_axis = True

    def vers_xatlas(self, xatlas):
        o = xatlas.PackOptions()
        o.max_chart_size = int(self.max_chart_size)
        o.padding = int(self.padding)
        o.texels_per_unit = float(self.texels_per_unit)
        o.resolution = int(self.resolution)
        o.bilinear = bool(self.bilinear)
        o.blockAlign = bool(self.block_align)
        o.bruteForce = bool(self.brute_force)
        o.rotate_charts = bool(self.rotate_charts)
        o.rotate_charts_to_axis = bool(self.rotate_charts_to_axis)
        return o


def fabriquer_module(xatlas):
    """Module de remplacement de `cumesh._xatlas`, construit sur le module `xatlas` (PyPI) passe en argument (testable avec un faux)."""

    class Atlas:
        def __init__(self):
            self._atlas = xatlas.Atlas()
            self._options_charts = None

        def add_mesh(self, vertices, faces, normals=None, uvs=None):
            import numpy as np

            def _np(x, dtype):
                if x is None:
                    return None
                x = x.detach().cpu().numpy() if hasattr(x, 'detach') else np.asarray(x)
                return np.ascontiguousarray(x, dtype=dtype)
            self._atlas.add_mesh(_np(vertices, np.float32), _np(faces, np.uint32), _np(normals, np.float32), _np(uvs, np.float32))

        def compute_charts(self, options, callback=None):
            # le xatlas de PyPI fait les deux etapes dans generate() : on retient les options de decoupe, le travail se fait a pack_charts
            self._options_charts = options

        def pack_charts(self, options, callback=None):
            charts = self._options_charts if self._options_charts is not None else xatlas.ChartOptions()
            self._atlas.generate(charts, options.vers_xatlas(xatlas), False)

        def get_mesh(self, index):
            import numpy as np
            import torch
            xrefs, faces, uvs = self._atlas.get_mesh(index)
            return (torch.from_numpy(np.ascontiguousarray(xrefs, dtype=np.int32)),
                    torch.from_numpy(np.ascontiguousarray(faces, dtype=np.int32)),
                    torch.from_numpy(np.ascontiguousarray(uvs, dtype=np.float32)))

    module = types.ModuleType('cumesh._xatlas')
    module.Atlas = Atlas
    module.ChartOptions = xatlas.ChartOptions
    module.PackOptions = _OptionsEmpaquetage
    module.__doc__ = 'Adaptateur FabMesh : cumesh._xatlas bloque par Smart App Control, remplace par le paquet xatlas.'
    module.__fabmesh_adaptateur__ = True
    return module


def installer(log=print):
    """Rend 'inactif' (le vrai module se charge : rien de change), 'actif' (adaptateur installe) ou 'indisponible' (bloque ET pas
    d'adaptateur possible). A appeler AVANT le premier `import cumesh` du processus ; sans effet si cumesh n'est pas installe."""
    if os.environ.get('FABMESH_CUMESH_XATLAS_SAC', '1') == '0':
        return 'inactif'
    if 'cumesh._xatlas' in sys.modules:
        return 'actif' if getattr(sys.modules['cumesh._xatlas'], '__fabmesh_adaptateur__', False) else 'inactif'
    chemin = _trouver_pyd()
    if not _bloque_par_la_politique(chemin):
        return 'inactif'
    log('[cumesh] %s refuse par Smart App Control : remplace par le paquet xatlas' % os.path.basename(chemin))
    try:
        import xatlas
        module = fabriquer_module(xatlas)
    except Exception as exc:                       # paquet absent ou bloque a son tour : on le dit, on ne masque rien
        log('[cumesh] adaptateur xatlas IMPOSSIBLE (%s: %s) : la generation 3D locale echouera' % (type(exc).__name__, exc))
        return 'indisponible'
    if 'cumesh' in sys.modules and not hasattr(sys.modules['cumesh'], 'Atlas'):      # import avorte d'avant : on repart propre
        for nom in [n for n in sys.modules if n == 'cumesh' or n.startswith('cumesh.')]:
            del sys.modules[nom]
    sys.modules['cumesh._xatlas'] = module
    return 'actif'
