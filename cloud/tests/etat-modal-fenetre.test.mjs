// Levier L8 de l'etude des couts du 11/10/2026, partie Modal : la fenetre de maintien (scaledown_window) de l'application CPU
// `myfabmesh-etat` (modal_app/etat_services.py) doit la laisser s'eteindre entre deux lectures de visiteurs, tout en la gardant chaude
// pendant que /admin2 regarde. Elle se juge contre le cache du worker (worker.ts, ETAT_FRAIS_*) : voir tests/etat-modal.test.mjs.
// PROPOSITION NON DEPLOYEE au moment du commit : PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python -m modal deploy modal_app/etat_services.py
// Lancer : cd cloud && node --test tests/etat-modal-fenetre.test.mjs
// Ancien code : git show <rev>:modal_app/etat_services.py > <tmp>/etat.py ; ETAT_SERVICES_PY=<tmp>/etat.py node --test tests/etat-modal-fenetre.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chargerConstante } from './_charge-worker.mjs';

const CHEMIN_PY = process.env.ETAT_SERVICES_PY
  || new URL('../../modal_app/etat_services.py', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const FROID_S = 3.1;                       // demarrage a froid de l'application, mesure le 29/09 (AGENT_LOG)

test('Modal : scaledown_window de etat_services laisse le conteneur s eteindre entre deux lectures de visiteurs, chaud pour /admin2', () => {
  const visiteur = chargerConstante('ETAT_FRAIS_VISITEUR_MS'), actif = chargerConstante('ETAT_FRAIS_ACTIF_MS'), attente = chargerConstante('ETAT_ATTENTE_MS');
  assert.equal(visiteur, 60_000, 'cache visiteurs du worker : 60 s');
  assert.equal(actif, 15_000, 'cache /admin2 et lectures fraiches du worker : 15 s');
  assert.ok(attente / 1000 > FROID_S + 1 && attente < 8_000, 'repli du worker : apres un demarrage a froid, avant l ancien delai de 8 s');
  const py = readFileSync(CHEMIN_PY, 'utf8').replace(/\r\n/g, '\n');
  const deco = /@app\.function\(([\s\S]*?)\)\s*\n@modal\.concurrent[^\n]*\n@modal\.fastapi_endpoint[^\n]*\ndef etat_services\(/.exec(py);
  assert.ok(deco, 'decorateur de etat_services introuvable');
  const fenetre = Number((/scaledown_window\s*=\s*(\d+)/.exec(deco[1]) || [])[1]);
  assert.ok(Number.isFinite(fenetre), 'scaledown_window absent (defaut de Modal)');
  assert.ok(fenetre > actif / 1000,
    `scaledown_window ${fenetre} s <= ${actif / 1000} s : /admin2 (une lecture toutes les ~16 s) paierait un demarrage a froid a chaque lecture`);
  assert.ok(fenetre + FROID_S + 1 < visiteur / 1000,
    `scaledown_window ${fenetre} s : le conteneur reste allume entre deux lectures de visiteurs (${visiteur / 1000} s)`);
  assert.ok(!/min_containers\s*=\s*[1-9]|keep_warm\s*=\s*[1-9]/.test(deco[1]), 'un conteneur garde allume en permanence');
  assert.ok(!/\(\s*["']myfabmesh-etat["']\s*,/.test(py), 'garde_chaud ne doit pas pouvoir viser l application d etat elle-meme');
});
