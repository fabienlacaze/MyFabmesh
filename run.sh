#!/bin/bash
# usage: run.sh <sortie> [moteur] [allures]
M=${2:-C:/tmp/anim2_bipedes/cloud/public/app/lib/locomotion-procedurale.js}
bash /c/tmp/lourd.sh node /c/tmp/anim2_bipedes/mes.mjs $M ${3:-walk,run} > $1 2>&1
