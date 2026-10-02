#!/bin/bash
# Rejoue tous les tests de /admin2 sur le faux serveur (redemarre a CHAQUE test : etat et session propres).
# Usage : run_admin2_tests.sh [numeros...]   (sans argument : tous)
cd /c/tmp
redemarrer() {
  powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8799 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force }" >/dev/null 2>&1
  sleep 0.5
  (node /c/tmp/admin2_mock.mjs >/dev/null 2>&1 &)
  for i in 1 2 3 4 5 6 7 8 9 10; do curl -s -m 2 -o /dev/null http://127.0.0.1:8799/admin2 && return; sleep 0.5; done
}
liste="$@"; [ -z "$liste" ] && liste='0 2 3 4 5 6 7 8 9 10 11 12 13 14 15'
for n in $liste; do
  [ "$n" = "0" ] && n=""
  f=/c/tmp/admin2_test$n.mjs
  [ -f "$f" ] || continue
  redemarrer
  out=$(timeout 240 node /c/Users/Utilisateur/.claude/skills/browser-automation/browser.mjs http://127.0.0.1:8799/admin2 --script "$f" 2>&1)
  err=$(echo "$out" | grep -c "SCRIPT ERROR")
  con=$(echo "$out" | sed -n 's/^console errors\/warnings (\([0-9]*\)).*/\1/p')
  req=$(echo "$out" | sed -n 's/^requests failed (\([0-9]*\)).*/\1/p')
  echo "test$n : scriptErreur=$err console=$con reqEchec=$req"
  if [ "$err" != "0" ]; then echo "$out" | grep "SCRIPT ERROR" | cut -c1-400; fi
  echo "$out" > /c/tmp/admin2_out_test$n.txt
done
