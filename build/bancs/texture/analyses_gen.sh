#!/bin/bash
# Analyses (une a la fois) des generations locales, lancees APRES la fin de la file (aucun recouvrement GPU) : #7 (cuissons), #9 (sampler), #12 (marge de recadrage), dispersion de graine.
REPO="C:/Users/Utilisateur/Desktop/FabWare/MeshyMyself"
PY="C:/Users/Utilisateur/AppData/Roaming/myfabmesh-ai/python/python.exe"
G="C:/tmp/texture_essais/gen"; P="C:/tmp/texture_essais/photos_in"
an() { # photo ref variantes...
  if [ -e "C:/tmp/procedural_test/STOP" ]; then echo "[analyses] STOP present"; return 1; fi
  local photo="$1"; shift; local ref="$1"; shift
  for f in "$ref" "$@"; do [ -f "$f" ] || { echo "[analyses] fichier absent $f : groupe ignore"; return 0; }; done
  echo "[analyses] $(date +%H:%M:%S) $ref"
  "$PY" "$REPO/build/bancs/texture/essai_gen_analyse.py" "$photo" "$ref" "$@" 2>&1 | grep -v "slow image"
}
an $P/chevalier.png $G/chevalier_m1024_atlas4096.glb $G/chevalier_m1024_atlas2048.glb $G/chevalier_m1024_atlas1024.glb
an $P/alien.png $G/alien_m1024_atlas4096.glb $G/alien_m1024_atlas2048.glb $G/alien_m1024_atlas1024.glb
an $P/bus.png $G/bus_m1024_atlas4096.glb $G/bus_m1024_atlas2048.glb $G/bus_m1024_atlas1024.glb
an $P/cochon.png $G/cochon_m1024_atlas4096.glb $G/cochon_m1024_atlas2048.glb $G/cochon_m1024_atlas1024.glb
export ESSAI_TAG=_s9
# #9 : reference = cuisson 2048 de la generation de base ; memes voxels, memes mailles (texture seule) pour g2, g4, int09, juin, s32
an $P/chevalier.png $G/chevalier_m1024_atlas2048.glb $G/chev_g2_atlas2048.glb $G/chev_g4_atlas2048.glb $G/chev_int09_atlas2048.glb $G/chev_juin_atlas2048.glb
export ESSAI_TAG=_s12
# #12 + graine : maillages differents (camera ajustee a part)
an $P/chevalier.png $G/chevalier_m1024_atlas2048.glb $G/chev_pad0_atlas2048.glb $G/chev_pad015_atlas2048.glb $G/chev_seed7_atlas2048.glb
echo "[analyses] terminees $(date +%H:%M:%S)"
