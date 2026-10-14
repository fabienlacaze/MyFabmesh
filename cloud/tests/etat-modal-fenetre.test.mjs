// Levier L8 de l'etude des couts du 11/10/2026, partie Modal : la fenetre de maintien (scaledown_window) de l'application CPU
// `myfabmesh-etat` (modal_app/etat_services.py) doit la laisser s'eteindre entre deux lectures de visiteurs, tout en la gardant chaude
// pendant que /admin2 regarde. Elle se juge contre le cache du worker (worker.ts, ETAT_FRAIS_*) et la cadence des pages (cloud-overrides.js,
// admin2.html) : voir tests/etat-modal.test.mjs.
// PROPOSITION NON DEPLOYEE au moment du commit : PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python -m modal deploy modal_app/etat_services.py
// Lancer : cd cloud && node --test tests/etat-modal-fenetre.test.mjs
// Ancien code : git show <rev>:modal_app/etat_services.py > <tmp>/etat.py ; ETAT_SERVICES_PY=<tmp>/etat.py node --test tests/etat-modal-fenetre.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chargerConstante } from './_charge-worker.mjs';

const chemin = (env, rel) => process.env[env] || new URL(rel, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const lire = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const CHEMIN_PY = chemin('ETAT_SERVICES_PY', '../../modal_app/etat_services.py');
const FROID_S = 3.1;                       // demarrage a froid de l'application, mesure le 29/09 (AGENT_LOG)
const nombre = (s) => Number(String(s).replace(/_/g, ''));

/** Cadences reelles des pages : /admin2 (cadence(sonderModalStatus, N)) et le site (actif() ? RAPIDE : REPOS). */
function cadences() {
  const admin2 = lire(chemin('ADMIN2_HTML', '../public/admin2.html'));
  const site = lire(chemin('WEB_OVERRIDES', '../public/app/cloud-overrides.js'));
  const a = /cadence\(sonderModalStatus,\s*(\d+)\)/.exec(admin2);
  const s = /actif\(\)\s*\?\s*([\d_]+)\s*:\s*([\d_]+)/.exec(site);
  assert.ok(a, 'cadence de /admin2 introuvable');
  assert.ok(s, 'cadence du site introuvable (actif() ? rapide : repos)');
  return { admin: nombre(a[1]), rapide: nombre(s[1]), repos: nombre(s[2]) };
}

test('worker : chaque lecture « active » rend un etat aussi frais qu avant le cache (fraicheur SOUS la cadence de la page)', () => {
  const c = cadences();
  const visiteur = chargerConstante('ETAT_FRAIS_VISITEUR_MS'), actif = chargerConstante('ETAT_FRAIS_ACTIF_MS');
  const admin = chargerConstante('ETAT_FRAIS_ADMIN_MS'), attente = chargerConstante('ETAT_ATTENTE_MS');
  assert.equal(visiteur, c.repos, 'cache des visiteurs = cadence de repos de la page (60 s)');
  assert.ok(actif < c.rapide, `?frais=1 : ${actif} ms >= cadence du panneau ouvert (${c.rapide} ms) : l etat affiche vieillirait`);
  assert.ok(admin < c.admin, `/admin2 : ${admin} ms >= sa cadence (${c.admin} ms) : l etat reel de 8 s (exigence du 02/10) serait perdu`);
  assert.ok(attente / 1000 > FROID_S + 1 && attente < 8_000, 'repli du worker : apres un demarrage a froid, avant l ancien delai de 8 s');
});

test('Modal : scaledown_window de etat_services laisse le conteneur s eteindre entre deux lectures de visiteurs, chaud pour /admin2', () => {
  const c = cadences();
  const visiteur = chargerConstante('ETAT_FRAIS_VISITEUR_MS'), attente = chargerConstante('ETAT_ATTENTE_MS');
  const py = lire(CHEMIN_PY);
  const deco = /@app\.function\(([\s\S]*?)\)\s*\n@modal\.concurrent[^\n]*\n@modal\.fastapi_endpoint[^\n]*\ndef etat_services\(/.exec(py);
  assert.ok(deco, 'decorateur de etat_services introuvable');
  const fenetre = Number((/scaledown_window\s*=\s*(\d+)/.exec(deco[1]) || [])[1]);
  assert.ok(Number.isFinite(fenetre), 'scaledown_window absent (defaut de Modal)');
  // BORNE BASSE : deux lectures de /admin2 sont separees au plus de sa cadence + le repli du worker ; 1 s de marge.
  const basse = c.admin / 1000 + attente / 1000 + 1;
  // BORNE HAUTE : entre deux lectures de visiteurs (60 s), le conteneur doit s'eteindre (demarrage a froid compris, 1 s de marge).
  const haute = visiteur / 1000 - FROID_S - 1;
  assert.ok(fenetre >= basse,
    `scaledown_window ${fenetre} s < ${basse} s : /admin2 (une lecture toutes les ${c.admin / 1000} s) paierait un demarrage a froid a chaque lecture`);
  assert.ok(fenetre <= haute,
    `scaledown_window ${fenetre} s > ${haute.toFixed(1)} s : le conteneur reste allume entre deux lectures de visiteurs (${visiteur / 1000} s)`);
  assert.ok(!/min_containers\s*=\s*[1-9]|keep_warm\s*=\s*[1-9]/.test(deco[1]), 'un conteneur garde allume en permanence');
  assert.ok(!/\(\s*["']myfabmesh-etat["']\s*,/.test(py), 'garde_chaud ne doit pas pouvoir viser l application d etat elle-meme');
  assert.match(py, /Garde : cloud\/tests\/etat-modal-fenetre\.test\.mjs/, 'le commentaire de etat_services.py doit nommer CE fichier de garde');
});
