"""Provision the Puppeteer auto-rig engine on the user's machine.

Phase 3 of the first-run wizard (after the AI engine + model downloads).
Everything lands under the user-writable data dir (HEAVY_DIR):

  <HEAVY_DIR>/python-rig/   copy of the embedded Python + the rig stack
                            (torch 2.7.0+cu128 — INCOMPATIBLE with the AI
                            venv's torch 2.8, hence a separate env)
  <HEAVY_DIR>/puppeteer/    the Puppeteer code tree (copied from the
                            installer's resources) + the 3 checkpoints
                            downloaded from HuggingFace

The code tree copied is FabMesh's local tree (extraResources), NOT a
fresh upstream clone: it carries 3 local patches Puppeteer needs to run
on Windows (torch.load weights_only=False ×2, DDP backend 'gloo').

Checkpoints (all public, sizes verified byte-exact vs the dev machine):
  Seed3D/Puppeteer  skeleton_ckpts/puppeteer_skeleton_w_diverse_pose.pth   (4.10 GiB)
  Seed3D/Puppeteer  skinning_ckpts/puppeteer_skin_w_diverse_pose_depth1.pth (1.58 GiB)
  Maikou/Michelangelo checkpoints/aligned_shape_latents/shapevae-256.ckpt  (3.66 GiB)
    → needed at TWO hardcoded relative paths (skeleton/ and skinning/
      third_partys) : downloaded once, hardlinked to the second spot
      (same NTFS volume), copy fallback.

Pinned deps mirror external/Puppeteer/venv EXACTLY (the working dev env).
DO NOT install from Puppeteer's requirements.txt directly: it pins
xformers==0.0.23 (would downgrade torch to 2.1.1) and ptlflow
(animation-only, unused by rigging).

JSONL progress on stdout (same contract as wizard_install_deps.py):
    {"step": "rig-torch", "pct": 12, "done": false, "current": "..."}
    {"step": "done", "pct": 100, "done": true}

Env inputs (set by the Electron main process):
  FABMESH_PUPPETEER_CODE  source of the code tree (resources/Puppeteer)
  FABMESH_PUPPETEER_DIR   destination (<HEAVY_DIR>/puppeteer)
  HF_HOME                 HF cache (shared with the rest of the app)
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time


TORCH_INDEX = 'https://download.pytorch.org/whl/cu128'
PYG_INDEX = 'https://data.pyg.org/whl/torch-2.7.0+cu128.html'
# Pre-built Windows flash-attn wheel (same file the dev venv runs, sha256
# 19c66007…). flash_attn is a HARD requirement of the skeleton stage
# (skeletongen.py forces flash_attention_2, no SDPA fallback).
FLASH_ATTN_URL = ('https://github.com/kingbri1/flash-attention/releases/download/'
                  'v2.7.4.post1/'
                  'flash_attn-2.7.4.post1+cu128torch2.7.0cxx11abiFALSE-cp311-cp311-win_amd64.whl')

TORCH_PACKAGES = ['torch==2.7.0', 'torchvision==0.22.0']
SCATTER_PACKAGES = ['torch_scatter==2.1.2']

# Locked from the working venv (pip freeze) — requirements.txt names only,
# minus xformers (torch-downgrade trap) and ptlflow (animation-only).
PYPI_PACKAGES = [
    'trimesh==4.2.3',
    'accelerate==0.28.0',
    'mesh2sdf==1.1.0',
    'transformers==4.46.1',
    'numpy==1.26.4',
    'pyrender==0.1.45',
    'tqdm==4.67.3',
    'opencv-python==4.9.0.80',
    'omegaconf==2.3.0',
    'einops==0.7.0',
    'timm==1.0.27',
    'lightning==2.2.0',
    'boto3==1.43.18',
    'Cython==0.29.36',
    'tetgen==0.8.4',
    'loguru==0.7.3',
    'pytz==2026.2',
    'h5py==3.16.0',
    'plyfile==1.1.3',
    'pymeshlab==2025.7.post1',
    'yacs==0.1.8',
    'fvcore==0.1.5.post20221221',
    'easydict==1.13',
    'libigl==2.5.1',
    'scikit-learn==1.8.0',
    'jsonargparse==4.49.0',
    'imageio-ffmpeg==0.4.7',
    'bpy==4.2.0',
    'huggingface_hub==0.36.2',
    'safetensors==0.7.0',
    'scipy==1.17.1',
    'matplotlib==3.10.9',
]

# (repo_id, filename_in_repo, dest_path_relative_to_PUPPETEER_DIR, size_mb)
CHECKPOINTS = [
    ('Seed3D/Puppeteer',
     'skeleton_ckpts/puppeteer_skeleton_w_diverse_pose.pth',
     os.path.join('skeleton', 'skeleton_ckpts', 'puppeteer_skeleton_w_diverse_pose.pth'),
     4196),
    ('Seed3D/Puppeteer',
     'skinning_ckpts/puppeteer_skin_w_diverse_pose_depth1.pth',
     os.path.join('skinning', 'skinning_ckpts', 'puppeteer_skin_w_diverse_pose_depth1.pth'),
     1623),
    ('Maikou/Michelangelo',
     'checkpoints/aligned_shape_latents/shapevae-256.ckpt',
     os.path.join('skeleton', 'third_partys', 'Michelangelo', 'checkpoints',
                  'aligned_shape_latents', 'shapevae-256.ckpt'),
     3753),
]
# shapevae is ALSO loaded from the skinning copy (hardcoded relative path
# in Michelangelo/encode.py) — hardlink target:
SHAPEVAE_SECOND = os.path.join('skinning', 'third_partys', 'Michelangelo',
                               'checkpoints', 'aligned_shape_latents', 'shapevae-256.ckpt')


_EMIT_LOCK = threading.Lock()


def emit(obj):
    with _EMIT_LOCK:
        sys.stdout.write(json.dumps(obj) + '\n')
        sys.stdout.flush()


# DEBIT ET OCTETS (2026-09-30, user : "on n'a plus de vitesse alors que ca telecharge") : la phase du moteur de rig n'emettait que des paliers
# sans octets, donc le compteur du bas restait a "0.0 MB/s". Un fil mesure chaque 1,5 s : dossiers temporaires de pip (pip-unpack-*, roues en
# cours) + dossier de mise en attente des poids Hugging Face (_hf_staging, fichiers .incomplete compris) + poids deja deplaces.
_UNPACK_DEJA = set()
_UNPACK_MAX = {}
_STAGING = [None]
_DEJA_RANGES = [0]


def _taille_arbre(d):
    total = 0
    for racine, _dirs, fichiers in os.walk(d):
        for f in fichiers:
            try:
                total += os.path.getsize(os.path.join(racine, f))
            except OSError:
                pass
    return total


def _surveiller_octets(stop):
    import glob
    _UNPACK_DEJA.update(glob.glob(os.path.join(tempfile.gettempdir(), 'pip-unpack-*')))
    t_prev, b_prev, vitesse, max_total = time.time(), 0, 0.0, 0
    while not stop.wait(1.5):
        try:
            for d in glob.glob(os.path.join(tempfile.gettempdir(), 'pip-unpack-*')):
                if d not in _UNPACK_DEJA:
                    _UNPACK_MAX[d] = max(_UNPACK_MAX.get(d, 0), _taille_arbre(d))
            total = sum(_UNPACK_MAX.values()) + _DEJA_RANGES[0]
            if _STAGING[0] and os.path.isdir(_STAGING[0]):
                total += _taille_arbre(_STAGING[0])
        except Exception:
            continue
        total = max(total, max_total)       # jamais de recul (le poids quitte la zone de mise en attente une fois termine)
        max_total = total
        now = time.time()
        inst = max(0.0, (total - b_prev) / max(now - t_prev, 1e-3)) / 1e6
        vitesse = inst if vitesse == 0.0 else 0.6 * vitesse + 0.4 * inst
        t_prev, b_prev = now, total
        emit({'step': 'rig-octets', 'done': False, 'bytes_done': int(total), 'speed_mbps': round(vitesse, 2)})


def _run(args, step):
    emit({'step': step, 'pct': 0, 'done': False, 'msg': ' '.join(str(a) for a in args[-3:])})
    proc = subprocess.Popen(args, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, text=True,
                            encoding='utf-8', errors='replace')
    tail = []
    for line in proc.stdout:
        line = line.rstrip()
        tail.append(line)
        if len(tail) > 20:
            tail = tail[-20:]
        if 'Downloading' in line or 'Installing collected packages' in line:
            emit({'step': step, 'pct': 50, 'done': False, 'current': line[:120]})
    proc.wait()
    if proc.returncode != 0:
        ctx = '\n'.join(tail)
        if 'no space left' in ctx.lower() or 'errno 28' in ctx.lower():
            raise RuntimeError(
                'Not enough free disk space to install the rig engine.\n\n' + ctx)
        raise RuntimeError(f'pip exited {proc.returncode} on step {step}:\n{ctx}')


def _copy_code_tree(src, dst):
    """Copy the Puppeteer code tree (≈4 MB). Idempotent: existing files are
    overwritten (code updates on app update), checkpoints/dirs not in the
    source are left alone."""
    if not os.path.isdir(src):
        raise RuntimeError(f'Puppeteer code tree not found at {src} — '
                           'reinstall the app (resources/Puppeteer missing).')
    os.makedirs(dst, exist_ok=True)
    shutil.copytree(src, dst, dirs_exist_ok=True)


def _download_checkpoints(pup_dir):
    # Imported HERE (not top-level): huggingface_hub is installed by the
    # pip steps that run earlier in this very process.
    from huggingface_hub import hf_hub_download
    _STAGING[0] = os.path.join(pup_dir, '_hf_staging')
    total = sum(mb for (_, _, _, mb) in CHECKPOINTS)
    done = 0
    for repo, fname, rel_dest, size_mb in CHECKPOINTS:
        dest = os.path.join(pup_dir, rel_dest)
        step = f'rig-ckpt-{os.path.basename(dest)[:32]}'
        if os.path.isfile(dest) and os.path.getsize(dest) > 0:
            emit({'step': step, 'pct': round(done * 100 / total), 'done': False,
                  'msg': 'already present'})
            done += size_mb
            continue
        emit({'step': step, 'pct': round(done * 100 / total), 'done': False,
              'msg': f'downloading {size_mb} MB from {repo}'})
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        # hf_hub_download resumes partial downloads; local_dir puts the real
        # file at the destination (no symlink to cache on Windows).
        got = hf_hub_download(repo_id=repo, filename=fname,
                              local_dir=os.path.join(pup_dir, '_hf_staging', repo.replace('/', '_')))
        try:
            _DEJA_RANGES[0] += os.path.getsize(got)
        except OSError:
            pass
        shutil.move(got, dest)
        done += size_mb
        emit({'step': step, 'pct': round(done * 100 / total), 'done': False, 'msg': 'ok'})
    # cleanup staging metadata
    shutil.rmtree(os.path.join(pup_dir, '_hf_staging'), ignore_errors=True)

    # shapevae second location: hardlink (same NTFS volume), copy fallback.
    first = os.path.join(pup_dir, CHECKPOINTS[2][2])
    second = os.path.join(pup_dir, SHAPEVAE_SECOND)
    if not (os.path.isfile(second) and os.path.getsize(second) == os.path.getsize(first)):
        os.makedirs(os.path.dirname(second), exist_ok=True)
        try:
            if os.path.isfile(second):
                os.remove(second)
            os.link(first, second)
            emit({'step': 'rig-shapevae-link', 'pct': 99, 'done': False, 'msg': 'hardlinked'})
        except OSError:
            shutil.copy2(first, second)
            emit({'step': 'rig-shapevae-link', 'pct': 99, 'done': False, 'msg': 'copied (link failed)'})


def _seed_opt350m_config():
    """skeleton loads SkeletonOPTConfig.from_pretrained('facebook/opt-350m')
    at runtime → needs config.json in the HF cache. Pre-seed it now (~1 KB)
    so the first rigging works offline/behind a proxy."""
    try:
        from huggingface_hub import hf_hub_download
        hf_hub_download(repo_id='facebook/opt-350m', filename='config.json')
        emit({'step': 'rig-opt350m', 'pct': 99, 'done': False, 'msg': 'HF config seeded'})
    except Exception as e:
        # Non-fatal: the runtime will fetch it itself if it has network.
        emit({'step': 'rig-opt350m', 'pct': 99, 'done': False,
              'warn': f'opt-350m config seed failed ({e}) — first rig will need network'})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--python', default=sys.executable)
    ap.add_argument('--skip-deps', action='store_true',
                    help='skip pip installs (checkpoints/code only)')
    args = ap.parse_args()
    py = args.python
    threading.Thread(target=_surveiller_octets, args=(threading.Event(),), daemon=True).start()

    code_src = os.environ.get('FABMESH_PUPPETEER_CODE', '')
    pup_dir = os.environ.get('FABMESH_PUPPETEER_DIR', '')
    if not pup_dir:
        emit({'step': 'error', 'pct': 0, 'done': True,
              'error': 'FABMESH_PUPPETEER_DIR not set'})
        sys.exit(2)

    # Step 1: pip bootstrap (embedded copy ships get-pip.py)
    emit({'step': 'rig-pip-bootstrap', 'pct': 0, 'done': False})
    try:
        subprocess.check_call([py, '-m', 'pip', '--version'],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        getpip = os.path.join(os.path.dirname(py), 'get-pip.py')
        if os.path.isfile(getpip):
            subprocess.check_call([py, getpip, '--no-warn-script-location'])
        else:
            emit({'step': 'error', 'pct': 0, 'done': True,
                  'error': f'pip missing and no get-pip.py at {getpip}'})
            sys.exit(3)

    if not args.skip_deps:
        # Step 2: torch 2.7 stack (cu128 index)
        _run([py, '-m', 'pip', 'install', '--index-url', TORCH_INDEX,
              *TORCH_PACKAGES], step='rig-torch')
        # Step 3: torch_scatter (PyG wheel index for torch 2.7.0+cu128)
        _run([py, '-m', 'pip', 'install', '--find-links', PYG_INDEX,
              *SCATTER_PACKAGES], step='rig-scatter')
        # Step 4: flash_attn — HARD requirement of the skeleton stage.
        # NOTE SAC: unsigned flash_attn_2_cuda.dll may be blocked on client
        # machines with Smart App Control — surfaced at runtime, tracked in
        # build/build_wheels.md as a ship-blocker to validate.
        _run([py, '-m', 'pip', 'install', FLASH_ATTN_URL], step='rig-flash-attn')
        # Step 5: locked PyPI set (mirrors the working dev venv)
        _run([py, '-m', 'pip', 'install', *PYPI_PACKAGES], step='rig-pypi')

    # Step 6: code tree
    emit({'step': 'rig-code', 'pct': 0, 'done': False, 'msg': f'{code_src} -> {pup_dir}'})
    _copy_code_tree(code_src, pup_dir)

    # Step 7: checkpoints (~9.6 GB, resumable)
    _download_checkpoints(pup_dir)

    # Step 8: HF config seed for the skeleton LLM backbone
    _seed_opt350m_config()

    emit({'step': 'done', 'pct': 100, 'done': True})


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        emit({'step': 'error', 'pct': 0, 'done': True, 'error': str(e)})
        sys.exit(1)
