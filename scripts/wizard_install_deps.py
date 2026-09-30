"""Install Python dependencies (wheels + pip packages) into the
embedded Python interpreter shipped with FabMesh.

Run between the wizard's "Mode" and "Download" steps. The flow is:

  1. Bootstrap pip into the embedded Python (only once).
  2. Install torch 2.8 + torchvision (PyTorch cu128 official wheels).
  3. Install kaolin (NVIDIA pre-built Win+cu128 wheels).
  4. Install lightweight packages from PyPI (diffusers, transformers, …).
  5. Install the TRELLIS-2 custom CUDA wheels (o-voxel, cumesh,
     flex-gemm, spconv) from the local bundled wheels dir
     (FABMESH_WHEELS_DIR) or the GitHub prerelease — see build/build_wheels.md.

The target env MUST mirror external/TRELLIS2_win/.venv (the dev venv
that runs trellis2_native on the RTX 5080): torch 2.8.0+cu128,
kaolin 0.18.0, NO xformers, NO flash-attn (SDPA backend is
authoritative — see the flash-attn note below).

Streams JSONL progress on stdout so the Electron main process can
forward updates to the wizard UI:
    {"step": "pip-bootstrap", "pct": 0, "done": false}
    {"step": "torch",         "pct": 35, "done": false, "current": "..."}
    {"step": "pypi",          "pct": 90, "done": false, "current": "diffusers"}
    {"step": "done",          "pct": 100, "done": true}

If `--python` is not passed, falls back to `sys.executable` (useful in
dev where we use the system Python).
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
import threading
import time


# PyTorch CUDA 12.8 official wheels (binary only, no compile needed).
TORCH_INDEX = 'https://download.pytorch.org/whl/cu128'
# NVIDIA kaolin pre-built wheels for Windows + CUDA (must match torch).
KAOLIN_INDEX = 'https://nvidia-kaolin.s3.us-east-2.amazonaws.com/torch-2.8.0_cu128.html'
# Standard PyPI for everything else.
PYPI_INDEX = 'https://pypi.org/simple/'
# GitHub prerelease hosting the custom-built TRELLIS-2 wheels
# (direct .whl URLs — pip installs them without any index; sha256 of
# each file is pinned in build/fetch_trellis2_wheels.py).
TRELLIS2_WHEELS_BASE = ('https://github.com/fabienlacaze/MyFabmesh/releases/'
                        'download/trellis2-wheels-v1/')

# torch + torchvision: official PyTorch CUDA 12.8 binaries. ~2.5 GB total.
# 2.8.0 is REQUIRED by TRELLIS-2 native (mirrors external/TRELLIS2_win/.venv).
TORCH_PACKAGES = [
    'torch==2.8.0',
    'torchvision==0.23.0',
]

# kaolin: NVIDIA publishes Win+cu128 cp311 wheels on the kaolin index above
# (verified: kaolin-0.18.0-cp311-cp311-win_amd64.whl). Required by TRELLIS-2.
KAOLIN_PACKAGES = [
    'kaolin==0.18.0',
]

# TRELLIS-2 custom CUDA extensions. NOT on PyPI (spconv-cu128 included) —
# they ship as pre-compiled cp311/win_amd64 wheels (build/build_wheels.md)
# bundled in the installer (FABMESH_WHEELS_DIR env → resources/wheels) with
# the GitHub prerelease as network fallback. Their pure-Python deps
# (triton-windows, pccm, ccimport, …) resolve on PyPI.
#
# INSTALLATION SANS RESOLUTION (2026-09-30, echec constate a l'installation de zero de la version Store) : la roue spconv-cu128 2.3.8
# declare `cumm-cu128<0.8.0,>=0.7.11`, or nous livrons cumm 0.8.2 (compilee sm_120 pour la RTX 50) -> pip refusait avec ResolutionImpossible, l'installation
# du moteur echouait pour TOUS les utilisateurs. Les 5 roues sont donc posees avec --no-deps (versions choisies a la main), et leurs vraies
# dependances (TRELLIS2_WHEELS_DEPS) sont installees a part.
TRELLIS2_WHEELS_DEPS = [
    'pccm>=0.4.16', 'ccimport>=0.4.4', 'pybind11>=2.6.0', 'fire', 'sympy',
    'triton-windows>=3.2.0', 'filelock', 'easydict', 'trimesh', 'plyfile', 'tqdm', 'zstandard', 'numpy',
]
TRELLIS2_CUSTOM_WHEELS = [
    'spconv-cu128==2.3.8',
    'cumm-cu128==0.8.2',
    'o-voxel==0.0.1',
    'cumesh==1.0',
    'flex-gemm==0.0.1',
]
TRELLIS2_WHEEL_FILES = [
    'spconv_cu128-2.3.8-cp311-cp311-win_amd64.whl',
    'cumm_cu128-0.8.2-cp311-cp311-win_amd64.whl',
    'o_voxel-0.0.1-cp311-cp311-win_amd64.whl',
    'cumesh-1.0-cp311-cp311-win_amd64.whl',
    'flex_gemm-0.0.1-cp311-cp311-win_amd64.whl',
]

# utils3d: the PyPI project named "utils3d" is a DIFFERENT homonym package.
# TRELLIS-2 needs EasternJournalist/utils3d at this exact commit (same pin
# as the dev venv). Zip archive URL = pip-installable without git.
UTILS3D_ZIP = ('https://github.com/EasternJournalist/utils3d/archive/'
               '9a4eb15e4021b67b12c460c7057d642626897ec8.zip')

# Pure-Python or pip-managed binaries — small + safe to grab from PyPI.
#
# BORNES HAUTES SUR TOUT (2026-08-20). Chaque entree n'avait qu'un plancher
# `>=`, donc pip resolvait « la derniere version publiee le jour de
# l'installation ». Deux consequences, toutes deux vues venir de loin :
#   - le moteur d'un client n'est jamais celui qui a ete teste ici, et deux
#     clients installes a un mois d'ecart n'ont pas le meme ;
#   - le jour ou transformers passe en 5.x ou diffusers en 0.33, l'appli
#     DEJA LIVREE cesse de s'installer chez les nouveaux, sans qu'une seule
#     ligne de notre code ait bouge.
# Les planchers sont desormais les versions REELLEMENT installees dans le
# venv de developpement (relevees le 2026-08-20), et le plafond est la
# prochaine version incompatible : majeure suivante, ou mineure suivante pour
# les bibliotheques encore en 0.x, ou une mineure casse.
#
# numpy : la borne `<2.0` venait de kaolin 0.17, dont l'extension Cython
# etait compilee pour l'ABI numpy 1. On installe kaolin 0.18.0 (voir
# KAOLIN_PACKAGES), qui declare `numpy` sans plafond, et le venv de
# developpement tourne en numpy 2.4.6 depuis des mois. La borne obligeait
# donc les clients — et EUX SEULS — a un couple numpy 1.26 + kaolin 0.18 que
# personne n'a jamais fait tourner. Verifie avant de la lever : basicsr,
# realesrgan, rembg, pyrender, trimesh, kaolin, cv2 et scipy s'importent tous
# sous numpy 2.4.6, et aucun script de scripts/ n'utilise les alias supprimes
# par numpy 2 (np.float_, np.NaN, np.in1d, …).
PYPI_PACKAGES = [
    'diffusers>=0.32,<0.33',
    'transformers>=4.56,<5',
    'huggingface_hub>=0.36,<1',
    'accelerate>=1.13,<2',
    # Le venv de dev tourne sur 0.8.0rc0 ; un plancher `>=0.8` exclurait cette
    # pre-version (PEP 440) et exigerait une 0.8.0 finale peut-etre pas encore
    # publiee. On garde le plancher d'origine et on n'ajoute que le plafond.
    'safetensors>=0.4,<0.9',
    'pillow>=10,<13',
    'numpy>=2.1,<3',
    'scipy>=1.13,<2',
    'trimesh>=4.4,<5',
    'pygltflib>=1.16,<2',
    'opencv-python>=4.9,<5',
    'pyrender>=0.1.45,<0.2',
    # DETOURAGE (2026-09-30) : PAS de paquet `rembg` (il tire pymatting -> numba, dont la DLL est BLOQUEE par Smart App Control, et n'installe aucun moteur
    # onnxruntime). `scripts/rembg/` le remplace (u2net par onnxruntime seul, meme resultat) ; il ne lui faut que onnxruntime (version CPU, ~1 s par image).
    'onnxruntime>=1.18,<2',
    'timm>=1.0,<2',      # code distant de Florence-2 (legende d'image) : `requires timm` sinon
    # Redacteur local (scripts/redacteur.py) : ONNX Runtime GenAI (Microsoft, MIT), import verifie sous Smart App Control.
    'onnxruntime-genai>=0.17,<0.18',
    # Modules importes a la demande par les scripts, absents de l'environnement neuf (audit des imports du 2026-09-30) : reduction de maillage
    # (fast_simplification : petites cibles sans triangles retournes), depliage UV (xatlas), telemetrie GPU
    # (pynvml). PAS kornia (detection de visage, retouche locale) : sa DLL kornia_rs est BLOQUEE par Smart App Control (« An Application Control policy has
    # blocked this file », mesure du 2026-09-30) ; on ne desactive jamais SAC. PAS meshoptimizer : aucune roue Windows (compilation C++
    # exigee, absente d'un PC neuf) ; acceleration_glb retombe sur `_reduire_meshopt_wasm`.
    'fast_simplification>=0.1.7,<1',
    'xatlas>=0.0.9,<1',
    'nvidia-ml-py>=12,<14',
    'realesrgan>=0.3.0,<0.4',
    'basicsr>=1.4,<2',
    # TRELLIS-2 runtime deps (inference path only, no training extras):
    'easydict>=1.13,<2',
    'einops>=0.8,<0.9',
    'plyfile>=1.0,<2',
    'zstandard>=0.22,<1',
    'tqdm>=4.66,<5',
    UTILS3D_ZIP,
]


_EMIT_LOCK = threading.Lock()


def emit(obj):
    with _EMIT_LOCK:
        sys.stdout.write(json.dumps(obj) + '\n')
        sys.stdout.flush()


# PROGRESSION EN OCTETS (2026-09-30, test d'installation de zero : « le debit reste a zero, la barre ne marche pas, il ne se passe rien »).
# Jusqu'ici la progression se comptait en PAQUETS : torch (2,5 Go) est UN paquet, donc la barre restait a 6,9 % pendant des dizaines de minutes
# et le debit affichait « — ». pip telecharge chaque roue dans un dossier temporaire `pip-unpack-*` : on en mesure la taille chaque seconde
# (les dossiers deja presents au demarrage sont ignores) et on emet octets telecharges + debit lisse.
_UNPACK_DEJA = set()
_UNPACK_MAX = {}


def _dossiers_pip():
    import glob
    return glob.glob(os.path.join(tempfile.gettempdir(), 'pip-unpack-*'))


def _taille_dossier(d):
    total = 0
    try:
        for f in os.listdir(d):
            try:
                total += os.path.getsize(os.path.join(d, f))
            except OSError:
                pass
    except OSError:
        pass
    return total


def _surveiller_telechargement(stop, step):
    """Thread : emet {bytes_done, speed_mbps} toutes les ~1,5 s tant que `stop` n'est pas leve."""
    t_prev, b_prev, vitesse = time.time(), sum(_UNPACK_MAX.values()), 0.0
    while not stop.wait(1.5):
        try:
            for d in _dossiers_pip():
                if d in _UNPACK_DEJA:
                    continue
                _UNPACK_MAX[d] = max(_UNPACK_MAX.get(d, 0), _taille_dossier(d))
        except Exception:
            pass
        total = sum(_UNPACK_MAX.values())
        now = time.time()
        inst = max(0.0, (total - b_prev) / max(now - t_prev, 1e-3)) / 1e6      # Mo/s
        vitesse = inst if vitesse == 0.0 else 0.6 * vitesse + 0.4 * inst        # lissage
        t_prev, b_prev = now, total
        emit({'step': step, 'done': False, 'bytes_done': int(total), 'speed_mbps': round(vitesse, 2)})


def _lower_priority():
    """Drop this process (and the pip children it spawns) to BELOW_NORMAL so
    the ~5 GB torch install doesn't freeze the desktop. Best-effort; no-op off
    Windows or on failure. On Windows the priority class is inherited by
    subprocess.Popen children (no creationflags), so pip stays throttled too.
    Uses the typed-ctypes idiom (restype=c_void_p) required so the 64-bit
    GetCurrentProcess() pseudo-handle isn't truncated → SetPriorityClass works."""
    try:
        if sys.platform == 'win32':
            import ctypes
            from ctypes import wintypes
            k32 = ctypes.windll.kernel32
            k32.GetCurrentProcess.restype = ctypes.c_void_p
            k32.SetPriorityClass.argtypes = [ctypes.c_void_p, wintypes.DWORD]
            k32.SetPriorityClass.restype = wintypes.BOOL
            k32.SetPriorityClass(k32.GetCurrentProcess(), 0x00004000)  # BELOW_NORMAL_PRIORITY_CLASS
        else:
            os.nice(10)
    except Exception:
        pass


_TOTAL_STEPS = (len(TORCH_PACKAGES) + len(KAOLIN_PACKAGES)
                + len(TRELLIS2_CUSTOM_WHEELS)
                + len(PYPI_PACKAGES))


def _run(args, step):
    """Run a subprocess and stream a coarse progress event on each
    pip output line containing 'Downloading' / 'Installing'. On failure,
    include the tail of pip's output so the UI shows WHY (disk full, network,
    etc.) instead of a bare 'pip exited 1'."""
    emit({'step': step, 'pct': 0, 'done': False, 'msg': ' '.join(args[-3:])})
    if not _UNPACK_DEJA:
        _UNPACK_DEJA.update(_dossiers_pip())
    arret = threading.Event()
    threading.Thread(target=_surveiller_telechargement, args=(arret, step), daemon=True).start()
    proc = subprocess.Popen(args, stdout=subprocess.PIPE,
                             stderr=subprocess.STDOUT, text=True,
                             encoding='utf-8', errors='replace')
    seen_pkgs = set()
    tail = []
    for line in proc.stdout:
        line = line.rstrip()
        tail.append(line)
        if len(tail) > 20:
            tail = tail[-20:]
        if 'Downloading' in line or 'Installing collected packages' in line:
            for token in line.split():
                if '==' in token or token.endswith('.whl'):
                    seen_pkgs.add(token.split('-')[0].split('==')[0].lower())
            pct = min(99, round(len(seen_pkgs) * 100 / _TOTAL_STEPS, 1))
            emit({'step': step, 'pct': pct, 'done': False,
                  'current': line[:120]})
    proc.wait()
    arret.set()
    if proc.returncode != 0:
        ctx = '\n'.join(tail)
        low = ctx.lower()
        if ('no space left' in low or 'errno 28' in low
                or 'not enough space' in low or 'disk full' in low):
            raise RuntimeError(
                'Not enough free disk space to install the AI engine. Free up '
                'space (or move the data folder to a bigger drive in Settings) '
                'and retry.\n\n' + ctx)
        raise RuntimeError(f'pip exited {proc.returncode} on step {step}:\n{ctx}')


def _poser_nvrtc13(py):
    """NVRTC 13 pour cumm (2026-09-30, echec constate apres l'installation des roues) : `core_cc.pyd` de notre roue cumm-cu128 0.8.2 (compilee sur le poste
    de developpement, CUDA 13 installe) importe `nvrtc64_130_0.dll`. Sur un PC sans kit CUDA 13, `import cumm` echoue (« DLL load failed while importing
    core_cc ») et spconv, donc le maillage local, avec. On installe le paquet PyPI `nvidia-cuda-nvrtc` (13.x, ~45 Mo) et on copie la DLL dans torch/lib,
    dossier que torch ajoute deja au chemin de recherche des DLL. (A terme : recompiler cumm contre NVRTC 12.8 et supprimer cette etape.)"""
    _run([py, '-m', 'pip', 'install', '--no-deps', 'nvidia-cuda-nvrtc>=13,<14'], step='trellis2-nvrtc')
    code = "; ".join([
        "import sysconfig, glob, os, shutil",
        "sp = sysconfig.get_paths()['purelib']",
        "cible = os.path.join(sp, 'torch', 'lib')",
        "fichiers = glob.glob(os.path.join(sp, 'nvidia', '**', 'nvrtc*130*.dll'), recursive=True)",
        "[shutil.copy2(f, cible) for f in fichiers]",
        "print(len(fichiers))",
    ])
    r = subprocess.run([py, '-c', code], capture_output=True, text=True, timeout=120)
    if r.returncode != 0 or r.stdout.strip() in ('', '0'):
        raise RuntimeError('NVRTC 13 introuvable apres installation : ' + (r.stderr or r.stdout)[-300:])
    emit({'step': 'trellis2-nvrtc', 'pct': 99, 'done': False, 'current': 'nvrtc64_130_0.dll -> torch/lib'})


def _poser_detourage(py):
    """Remplacement de `rembg` DANS l'environnement (2026-09-30). Le vrai rembg tire pymatting -> numba (DLL bloquee par Smart App Control) ; notre
    `scripts/rembg/__init__.py` (u2net par onnxruntime seul) le remplace. Il doit etre dans site-packages et non seulement dans scripts/ : l'interprete
    embarque a un fichier ._pth, donc le dossier du script n'est PAS ajoute a sys.path et la plupart des scripts ne l'y ajoutent pas eux-memes."""
    import shutil
    src = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'rembg', '__init__.py')
    if not os.path.isfile(src):
        raise RuntimeError('detourage de remplacement introuvable : ' + src)
    r = subprocess.run([py, '-c', "import sysconfig; print(sysconfig.get_paths()['purelib'])"], capture_output=True, text=True, timeout=60)
    if r.returncode != 0 or not r.stdout.strip():
        raise RuntimeError('site-packages introuvable : ' + (r.stderr or '')[-200:])
    dest = os.path.join(r.stdout.strip(), 'rembg')
    shutil.rmtree(dest, ignore_errors=True)          # un vrai rembg deja present (ancienne installation) est remplace
    os.makedirs(dest, exist_ok=True)
    shutil.copy2(src, os.path.join(dest, '__init__.py'))
    emit({'step': 'pypi', 'pct': 99, 'done': False, 'current': 'background remover installed'})


def _install_trellis2_wheels(py):
    """Install the custom TRELLIS-2 CUDA wheels. Tries the local bundled
    wheels dir first (FABMESH_WHEELS_DIR env, set by the Electron wizard when
    the installer ships them), then the GitHub prerelease. REQUIRED for
    the default mesh engine (trellis2_native) — a clear error beats a broken
    install, so failure of both sources aborts the whole step."""
    local_dir = os.environ.get('FABMESH_WHEELS_DIR', '')
    attempts = []
    if local_dir and os.path.isdir(local_dir):
        attempts.append(('trellis2-wheels-local',
                         [py, '-m', 'pip', 'install', '--no-deps',
                          '--find-links', local_dir,
                          *TRELLIS2_CUSTOM_WHEELS]))
    attempts.append(('trellis2-wheels-github',
                     [py, '-m', 'pip', 'install', '--no-deps',
                      *(TRELLIS2_WHEELS_BASE + f
                        for f in TRELLIS2_WHEEL_FILES)]))
    last_err = None
    for step, args in attempts:
        try:
            _run(args, step=step)
            # dependances reelles des roues (posees sans resolution) : depuis PyPI
            _run([py, '-m', 'pip', 'install', *TRELLIS2_WHEELS_DEPS], step='trellis2-deps')
            _poser_nvrtc13(py)
            return
        except Exception as e:
            last_err = e
            emit({'step': step, 'pct': 0, 'done': False,
                  'warn': f'{step} failed, trying next source'})
    raise RuntimeError(
        'Could not install the TRELLIS-2 engine wheels '
        f'({", ".join(TRELLIS2_CUSTOM_WHEELS)}). The 3D mesh engine cannot '
        'run without them. Check your internet connection and retry; if the '
        'problem persists, report it — the FabMesh wheel CDN may be down.\n\n'
        f'Last error: {last_err}')


def main():
    _lower_priority()  # keep the desktop responsive during the ~5 GB install
    ap = argparse.ArgumentParser()
    ap.add_argument('--python', default=sys.executable,
                    help='path to the embedded python.exe; default = current')
    ap.add_argument('--skip-wheels', action='store_true',
                    help='skip the compiled wheels step (dev mode)')
    args = ap.parse_args()

    py = args.python
    if not os.path.isfile(py) and py != sys.executable:
        emit({'step': 'error', 'pct': 0, 'done': True,
              'error': f'python not found at {py}'})
        sys.exit(2)

    # Step 1: bootstrap pip if needed
    emit({'step': 'pip-bootstrap', 'pct': 0, 'done': False})
    try:
        subprocess.check_call([py, '-m', 'pip', '--version'],
                              stdout=subprocess.DEVNULL,
                              stderr=subprocess.DEVNULL)
    except Exception:
        getpip = os.path.join(os.path.dirname(py), 'get-pip.py')
        if os.path.isfile(getpip):
            subprocess.check_call([py, getpip, '--no-warn-script-location'])
        else:
            emit({'step': 'error', 'pct': 0, 'done': True,
                  'error': f'pip missing and no get-pip.py at {getpip}'})
            sys.exit(3)

    if args.skip_wheels:
        # Dev mode: just install the pure-Python stuff so we can iterate
        # quickly without re-downloading 2 GB of torch every time.
        _run([py, '-m', 'pip', 'install', *PYPI_PACKAGES], step='pypi')
        _poser_detourage(py)
        emit({'step': 'done', 'pct': 100, 'done': True})
        return

    # Step 2a: REQUIRED — torch + torchvision from PyTorch's CUDA 12.8 index.
    # If this fails, the rest of the install is pointless.
    _run([py, '-m', 'pip', 'install',
          '--index-url', TORCH_INDEX,
          *TORCH_PACKAGES], step='torch')

    # Step 2b: REQUIRED — kaolin from NVIDIA's pre-built wheel index
    # (its pure-Python deps resolve on PyPI via the default index).
    _run([py, '-m', 'pip', 'install',
          '--find-links', KAOLIN_INDEX,
          *KAOLIN_PACKAGES], step='kaolin')

    # Step 2c: REQUIRED — pure-Python / lightweight from PyPI
    _run([py, '-m', 'pip', 'install', *PYPI_PACKAGES], step='pypi')
    _poser_detourage(py)

    # Step 2d: REQUIRED — TRELLIS-2 custom CUDA wheels (o-voxel, cumesh,
    # flex-gemm, spconv). Local bundled dir first, GitHub release fallback.
    _install_trellis2_wheels(py)

    # NOTE: NO xformers. The dev venv runs TRELLIS-2 on the SDPA backend
    # without it, and xformers wheels pin their own torch build — installing
    # one compiled for another torch would silently downgrade torch 2.8.0
    # and break kaolin/spconv. Do not add it back without pinning a build
    # that matches torch 2.8.0+cu128 exactly.

    # Step 2e: SKIPPED — flash-attn install disabled 2026-05-30.
    # Windows Smart App Control (SAC) blocks flash_attn_2_cuda.dll on this
    # target hardware and the user formally prohibited disabling SAC. The
    # TRELLIS-2 codebase guards every `import flash_attn` behind
    # `if config.BACKEND == 'flash_attn'`, and the Electron spawn env now
    # forces ATTN_BACKEND=sdpa + SPARSE_ATTN_BACKEND=sdpa authoritatively,
    # so flash_attn is never imported. The Blackwell-correct SDPA path
    # (modules/sparse/attention/full_attn.py:214-254 fp32-math branch)
    # produces correct results on sm_120. To re-enable, set
    # WIZARD_INSTALL_FLASH_ATTN=1 in the env before running this script.
    if os.environ.get('WIZARD_INSTALL_FLASH_ATTN') == '1':
        try:
            _run([py, '-m', 'pip', 'install',
                  'https://github.com/Dao-AILab/flash-attention/releases/download/'
                  'v2.7.0/flash_attn-2.7.0-cp311-cp311-win_amd64.whl'],
                 step='flash-attn-optional')
        except Exception as e:
            emit({'step': 'flash-attn-optional', 'pct': 99, 'done': False,
                  'warn': f'flash-attn install failed ({e}) — using slower attention'})
    else:
        emit({'step': 'flash-attn-optional', 'pct': 99, 'done': False,
              'msg': 'skipped (SAC-blocked; sdpa backend is authoritative)'})

    emit({'step': 'done', 'pct': 100, 'done': True})


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        emit({'step': 'error', 'pct': 0, 'done': True, 'error': str(e)})
        sys.exit(1)
