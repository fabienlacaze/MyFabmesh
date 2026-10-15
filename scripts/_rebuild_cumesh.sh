#!/bin/bash
# ATTENTION LICENCE (2026-10-15) : `git clone --recursive` ci-dessous recupere le sous-module cubvh de CuMesh
# (JeffreyXiang/cubvh ce92267), dont le BVH vient d'instant-ngp : NVIDIA Source Code License, usage « research or
# evaluation purposes only ». Ce script ne sert qu'a l'environnement de DEVELOPPEMENT (WSL) ; NE PAS en tirer une roue
# livree ni un service. Pour une roue livrable : python build/reconstruire_roue_cumesh.py ; pour Modal : modal_app/app.py
# (_CUMESH_MIT). Explication : docs/cumesh_licence_et_fill_holes_2026-10-15.md.
set -e
cd ~/TRELLIS.2
source .venv/bin/activate

export CUDA_HOME=/usr/local/cuda-12.8
export PATH="$VIRTUAL_ENV/bin:/usr/local/cuda-12.8/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export TORCH_CUDA_ARCH_LIST='12.0'
export MAX_JOBS=4

echo "=== clone or update CuMesh ==="
if [ ! -d /tmp/CuMesh ]; then
    git clone https://github.com/JeffreyXiang/CuMesh.git /tmp/CuMesh --recursive 2>&1 | tail -5
else
    echo "already cloned"
fi

echo ""
echo "=== uninstall old cumesh ==="
pip uninstall -y cumesh 2>&1 | tail -3

echo ""
echo "=== build + install cumesh from source ==="
pip install /tmp/CuMesh --no-build-isolation 2>&1 | tail -20

echo ""
echo "=== test ==="
python3 -c "
import torch
print('torch:', torch.__version__)
import cumesh
print('cumesh loaded OK')
"
