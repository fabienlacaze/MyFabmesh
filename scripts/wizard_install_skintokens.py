# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 MyFabmesh.AI contributors
# Installe le moteur de rig SkinTokens, dont le dossier src/model/michelangelo
# est sous GPL-3.0 : ce fichier est distribue sous GPL-3.0 ou ulterieure.
# Voir THIRD_PARTY_LICENSES.txt (notice SkinTokens).
"""Installe le moteur de rig LOCAL (SkinTokens) sur le poste de l'utilisateur.

Phase « moteur de rig » de l'assistant de premier lancement. Tout va sous le
dossier de donnees lourdes (HEAVY_DIR), jamais dans le paquet de l'appli :

  <HEAVY_DIR>/python-rig/   copie du Python embarque + pile du rigger
                            (torch 2.7.0 cu128 : INCOMPATIBLE avec le torch
                            2.8 de l'environnement IA, d'ou un env separe)
  <HEAVY_DIR>/SkinTokens/   code TELECHARGE CHEZ SON AUTEUR (VAST-AI-Research,
                            GitHub) au commit valide en production, nos
                            correctifs, et les poids Hugging Face (MIT, 1,6 Go)

LICENCE (2026-09-26) : le dossier src/model/michelangelo de SkinTokens est du
code Michelangelo sous GPL-3.0. Le code est telecharge depuis le depot de
l'auteur : FabMesh ne le redistribue pas. Le moteur tourne comme programme
separe (son propre processus Python) ; l'appli n'y est pas liee.

Recette = celle de l'image Modal de production (modal_app/_skintokens_rig.py),
versions figees sur le venv de developpement valide (C:\\tmp\\skv) :
  patches SDPA (pas de flash-attn a compiler, bloque par Smart App Control),
  import paresseux de gradio (inutile en ligne de commande), shim
  flash_attn_interface, correctifs FabMesh (patch_skintokens_transfert.py).

Sortie JSONL sur stdout (meme contrat que wizard_install_rig.py) :
    {"step": "rig-torch", "pct": 12, "done": false, "current": "..."}
    {"step": "done", "pct": 100, "done": true}

    python wizard_install_skintokens.py --python <python du rig> --dest <HEAVY_DIR>/SkinTokens
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile

ICI = os.path.dirname(os.path.abspath(__file__))
COMMIT = '273b691d35989d71cd17ff2895fdc735097b92d1'      # valide en production le 2026-09-26
URL_CODE = f'https://codeload.github.com/VAST-AI-Research/SkinTokens/zip/{COMMIT}'
TORCH_INDEX = 'https://download.pytorch.org/whl/cu128'
TORCH_PACKAGES = ['torch==2.7.0', 'torchvision==0.22.0']
# Figees sur le venv valide (pip freeze de C:\tmp\skv, Python 3.11.9). Pas de
# gradio (interface web de la demo, inutile ici).
PYPI_PACKAGES = [
    'transformers==5.14.1', 'tokenizers==0.22.2', 'safetensors==0.8.0',
    'huggingface_hub==1.24.0', 'diffusers==0.39.0',
    'lightning==2.6.5', 'pytorch-lightning==2.6.5',
    'bpy==5.0.1', 'open3d==0.19.0', 'trimesh==4.12.2',
    'numpy==1.26.4', 'scipy==1.17.1',
    'omegaconf==2.3.1', 'einops==0.8.2', 'python-box==7.4.1', 'addict==2.4.0',
    'fast_simplification==0.1.13',
    # bpy_server.py : `from bottle import ...` + serveur tornado (indispensables)
    'bottle==0.13.4', 'tornado==6.5.7', 'requests==2.34.2',
]
POIDS = [
    os.path.join('experiments', 'skin_vae_2_10_32768', 'last.ckpt'),
    os.path.join('experiments', 'articulation_xl_quantization_256_token_4', 'grpo_1400.ckpt'),
]


def emit(obj):
    sys.stdout.write(json.dumps(obj) + '\n')
    sys.stdout.flush()


def _run(args, step, cwd=None):
    emit({'step': step, 'pct': 0, 'done': False, 'msg': ' '.join(str(a) for a in args[-3:])})
    proc = subprocess.Popen(args, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, encoding='utf-8', errors='replace')
    fin = []
    for ligne in proc.stdout:
        ligne = ligne.rstrip()
        fin = (fin + [ligne])[-20:]
        if 'Downloading' in ligne or 'Installing collected packages' in ligne or 'downloaded' in ligne:
            emit({'step': step, 'pct': 50, 'done': False, 'current': ligne[:120]})
    proc.wait()
    if proc.returncode != 0:
        ctx = '\n'.join(fin)
        if 'no space left' in ctx.lower() or 'errno 28' in ctx.lower():
            raise RuntimeError('Not enough free disk space to install the rig engine.\n\n' + ctx)
        raise RuntimeError(f'step {step} failed (exit {proc.returncode}):\n{ctx}')


def _telecharger_code(dest):
    """Code SkinTokens au commit fige, depuis le depot de son auteur. Garde les
    poids deja presents (experiments/, models/) : une reinstallation ne les
    retelecharge pas."""
    marque = os.path.join(dest, '.fabmesh_commit')
    if os.path.isfile(marque) and open(marque).read().strip() == COMMIT \
            and os.path.isfile(os.path.join(dest, 'demo.py')):
        emit({'step': 'rig-code', 'pct': 100, 'done': False, 'msg': 'already present'})
        return
    tmp = tempfile.mkdtemp(prefix='skintokens_code_')
    try:
        archive = os.path.join(tmp, 'code.zip')
        emit({'step': 'rig-code', 'pct': 0, 'done': False, 'msg': f'github.com/VAST-AI-Research/SkinTokens @ {COMMIT[:7]}'})
        with urllib.request.urlopen(URL_CODE, timeout=120) as r, open(archive, 'wb') as f:
            shutil.copyfileobj(r, f)
        with zipfile.ZipFile(archive) as z:
            z.extractall(tmp)
        racine = os.path.join(tmp, f'SkinTokens-{COMMIT}')
        if not os.path.isfile(os.path.join(racine, 'demo.py')):
            raise RuntimeError('unexpected SkinTokens archive layout (demo.py missing)')
        os.makedirs(dest, exist_ok=True)
        shutil.copytree(racine, dest, dirs_exist_ok=True)
        with open(marque, 'w') as f:
            f.write(COMMIT)
        emit({'step': 'rig-code', 'pct': 100, 'done': False, 'msg': 'ok'})
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _remplacer(chemin, ancien, nouveau, absent=None):
    with open(chemin, encoding='utf-8', newline='') as f:
        texte = f.read()
    if ancien in texte:
        texte = texte.replace(ancien, nouveau)
        with open(chemin, 'w', encoding='utf-8', newline='') as f:
            f.write(texte)
    if absent and absent in texte:
        raise RuntimeError(f'patch not applied in {chemin}: {absent!r} still present')


def _patcher(dest):
    """Memes correctifs que l'image Modal ; chacun est VERIFIE (un remplacement
    qui ne trouve rien ne doit pas passer en silence)."""
    emit({'step': 'rig-patch', 'pct': 0, 'done': False})
    # attention SDPA (flash-attn exigerait une compilation bloquee par SAC)
    _remplacer(os.path.join(dest, 'src', 'model', 'tokenrig.py'),
               'attn_implementation="flash_attention_2"', 'attn_implementation="sdpa"',
               absent='flash_attention_2')
    _remplacer(os.path.join(dest, 'src', 'server', 'spec.py'),
               '_attn_implementation="flash_attention_2"', '_attn_implementation="sdpa"',
               absent='flash_attention_2')
    # gradio : import paresseux, seul le mode web de la demo s'en sert
    demo = os.path.join(dest, 'demo.py')
    with open(demo, encoding='utf-8', newline='') as f:
        lignes = f.read().splitlines(keepends=True)
    lignes = [('gr = None  # import paresseux : voir main()\n' if l.strip() == 'import gradio as gr'
               else ('' if l.strip() == 'gr.TEMP_DIR = "tmp_gradio"' else l)) for l in lignes]
    with open(demo, 'w', encoding='utf-8', newline='') as f:
        f.write(''.join(lignes))
    if any(l.startswith('import gradio') for l in lignes):
        raise RuntimeError('gradio lazy-import patch not applied')
    # shim flash_attn_interface (import DIRECT dans skin_vae_model.py)
    shutil.copyfile(os.path.join(ICI, 'skintokens_flash_attn_interface.py'),
                    os.path.join(dest, 'flash_attn_interface.py'))
    # correctifs FabMesh : alignement du transfert + 4 correctifs du rigger
    sys.path.insert(0, ICI)
    import patch_skintokens_transfert as correctifs
    emit({'step': 'rig-patch', 'pct': 100, 'done': False, 'msg': correctifs.appliquer_tout(dest)})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--python', required=True, help='python.exe de l\'environnement du rig')
    ap.add_argument('--dest', required=True, help='dossier de SkinTokens (HEAVY_DIR/SkinTokens)')
    a = ap.parse_args()
    py = a.python
    try:
        pip = [py, '-m', 'pip', 'install', '--no-warn-script-location', '--disable-pip-version-check']
        emit({'step': 'rig-torch', 'pct': 5, 'done': False})
        _run(pip + TORCH_PACKAGES + ['--index-url', TORCH_INDEX], 'rig-torch')
        emit({'step': 'rig-deps', 'pct': 35, 'done': False})
        _run(pip + PYPI_PACKAGES, 'rig-deps')
        _telecharger_code(a.dest)
        _patcher(a.dest)
        emit({'step': 'rig-weights', 'pct': 70, 'done': False, 'msg': 'huggingface.co/VAST-AI/SkinTokens (1.6 GB)'})
        _run([py, 'download.py', '--model'], 'rig-weights', cwd=a.dest)
        manquants = [p for p in POIDS if not os.path.isfile(os.path.join(a.dest, p))]
        if manquants:
            raise RuntimeError(f'weights missing after download: {manquants}')
        # verification : les imports dont le rig a besoin passent
        emit({'step': 'rig-check', 'pct': 95, 'done': False})
        _run([py, '-c', 'import torch, bpy, transformers, open3d, trimesh, scipy; '
                        'from flash_attn_interface import flash_attn_func; '
                        'print("cuda", torch.cuda.is_available())'], 'rig-check', cwd=a.dest)
        # marque ecrite EN DERNIER : l'appli ne propose le rig local qu'une fois
        # l'installation complete (une installation interrompue ne compte pas)
        with open(os.path.join(a.dest, '.fabmesh_pret'), 'w') as f:
            f.write(COMMIT)
        emit({'step': 'done', 'pct': 100, 'done': True})
    except Exception as e:
        emit({'step': 'error', 'pct': 100, 'done': True, 'error': str(e)[:2000]})
        sys.exit(1)


if __name__ == '__main__':
    main()
