#!/bin/bash
# usage: cmp.sh tag rig espece allure [extra]
cd /c/tmp/banc_visuel
bash /c/tmp/lourd.sh node planche_cmp.mjs "$2" "$3" "$4" --avant C:/tmp/anim2_bipedes/avant.js --apres C:/tmp/anim2_bipedes/cloud/public/app/lib/locomotion-procedurale.js --sans-maillage 1 --sortie C:/tmp/anim2_bipedes/out/$1.png ${@:5}
