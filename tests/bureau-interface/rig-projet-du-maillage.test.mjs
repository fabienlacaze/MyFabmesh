// 25/10 (user : « Auto-rig IA (repris) : etrange, je ne le trouve nulle part ») : le rig du maillage du projet « bleu snake » etait annonce sous « etrange »
// (projet OUVERT au lancement) alors que le serveur l'avait range sous « bleu snake ». Le projet du MAILLAGE doit primer partout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const R = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lire = (f) => readFileSync(join(R, f), 'utf8').replace(/\r\n/g, '\n');
test('le worker renvoie le projet deduit du maillage', () => {
  assert.ok(lire('cloud/src/worker.ts').includes("    creditsRemaining: remaining,\n    // projet du MAILLAGE (deduit ci-dessus)"));
});
test('le shim : projet serveur > projet demande > projet ouvert, et l appelant passe p.name', () => {
  const s = lire('cloud/public/app/meshyAPI-cloud.js');
  assert.ok(s.includes('const projectName = _projetServeur || _projetDemande || window.state?.currentProject?.name || null;'));
  assert.ok(s.includes('projectName: _projetDemande } = {}) => {'));
  assert.ok(lire('cloud/public/app/index2.js').includes('        projectName: p.name,\n        engine: rigEngine,'));
});
