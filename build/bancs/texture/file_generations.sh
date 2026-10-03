#!/bin/bash
# File d'attente des generations locales du plan texture (#7, #9, #12) : UNE SEULE a la fois, controles de securite AVANT CHAQUE lancement
# (fichier d'arret, /jobs vide, VRAM occupee par d'autres programmes <= 8 Go) ; l'arret se fait ENTRE deux generations.
# Usage : bash file_generations.sh <liste de lignes "etiquette|sujet|variables d'environnement separees par des espaces">  (voir le bas du fichier)
REPO="C:/Users/Utilisateur/Desktop/FabWare/MeshyMyself"
PY="C:/Users/Utilisateur/AppData/Roaming/myfabmesh-ai/python/python.exe"
OUT="C:/tmp/texture_essais/gen"
HEURE_MAX="${HEURE_MAX:-0415}"       # aucune nouvelle generation apres cette heure (HHMM)
sur() {
  if [ -e "C:/tmp/procedural_test/STOP" ]; then echo "[file] STOP present : arret"; return 1; fi
  local h; h=$(date +%H%M); if [ "$h" \> "$HEURE_MAX" ] && [ "$h" \< "1200" ]; then echo "[file] heure $h > $HEURE_MAX : arret"; return 1; fi
  local j; j=$(cd "$REPO" && node build/fab.mjs GET /jobs | tr -d '\n ')
  if [ "$j" != '{"ok":true,"data":[]}' ]; then echo "[file] un travail est apparu dans /jobs ($j) : le proprietaire est revenu, arret"; return 1; fi
  local v; v=$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits | head -1)
  if [ "$v" -gt 8000 ]; then echo "[file] VRAM occupee $v Mo > 8000 : arret"; return 1; fi
  return 0
}
while IFS='|' read -r tag sujet envs; do
  [ -z "$tag" ] && continue
  sur || exit 3
  echo "[file] $(date +%H:%M:%S) lancement $tag ($sujet) : $envs"
  env $envs "$PY" "$REPO/build/bancs/texture/essai_gen.py" "$tag" "C:/tmp/texture_essais/photos_in/$sujet.png" "$OUT" > "$OUT/$tag.log" 2>&1
  echo "[file] $(date +%H:%M:%S) fin $tag : $(grep -E 'essai_gen\] termine' "$OUT/$tag.log" | tail -1)"
done
echo "[file] file terminee"
