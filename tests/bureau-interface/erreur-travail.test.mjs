// 25/10 (demande du user) : un travail en echec montre « Error » (et non « Go to ») ; la fenetre donne l'image, les parametres, le code, son explication et le
// message EXACT ; aucun echec sans texte. VRAIES fonctions des deux index2.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const [nom, f] of Object.entries({ bureau: 'src/renderer/index2.js', site: 'cloud/public/app/index2.js' })) {
  const src = readFileSync(join(RACINE, f), 'utf-8').replace(/\r\n/g, '\n');
  const i = src.indexOf('function _expliquerErreur('), j = src.indexOf('function _rapportErreurTravail(');
  assert.ok(i >= 0 && j > i, nom);
  const expliquer = new Function(src.slice(i, j) + '\nreturn _expliquerErreur;')();
  test(`${nom} : le cas de la capture (HTTP 503, Worker exceeded resource limits) est explique avec son code et le cf-ray`, () => {
    const x = expliquer('HTTP 503 sur /api/construction-stages-3d : Worker exceeded resource limits | myfabmesh-cloud.fabien65400.workers.dev | Cloudflare [cf-ray a5023fbf09455d7b-FRA]');
    assert.match(x.code, /HTTP 503 · Worker exceeded resource limits/);
    assert.equal(x.rayon, 'a5023fbf09455d7b-FRA');
    assert.equal(x.titre, 'The site server ran out of resources');
  });
  test(`${nom} : « prompt required », credits, limites, session, reseau, delai, aucun message`, () => {
    assert.equal(expliquer('prompt required').titre, 'A description is missing');
    assert.equal(expliquer('insufficient credits — recolor costs 1').titre, 'Not enough credits');
    assert.equal(expliquer('HTTP 429: user limit reached.').titre, 'A usage limit was reached');
    assert.equal(expliquer('HTTP 401 unauthorized').titre, 'Your session has expired');
    assert.equal(expliquer('TypeError: Failed to fetch').titre, 'Network problem');
    assert.equal(expliquer('Service mesh_op HTTP 524').titre, 'The step took too long');
    assert.equal(expliquer('Service rig HTTP 500: boom').titre, 'A computing service failed');
    assert.equal(expliquer('').titre, 'No detail was returned');
    assert.equal(expliquer('No error message was returned (the step ended without detail).').titre, 'No detail was returned');
    assert.equal(expliquer('quelque chose de jamais vu').titre, 'Unexpected error');
  });
  test(`${nom} : « Error » remplace « Go to » pour un echec, dans « Travaux finis » et dans « En cours »`, () => {
    assert.match(src, /e\.statut === 'echec' \? `<button type="button" class="job-goto-btn job-error-btn" data-fini-erreur=/);
    assert.match(src, /j\.status === 'error' \? `<button class="job-goto-btn job-error-btn" onclick="event\.stopPropagation\(\); window\._ouvrirErreurTravailId\(\$\{j\.id\}\)"/);
    assert.match(src, /const be = e\.target\.closest\('\[data-fini-erreur\]'\);/);
  });
  test(`${nom} : l'archivage garde parametres et texte exact ; jamais d'echec sans texte`, () => {
    assert.match(src, /errorRaw: j\.errorRaw \? String\(j\.errorRaw\)\.slice\(0, 2000\) : null/);
    assert.match(src, /params: \(\(\) => \{ try \{ return j\.params \? JSON\.parse\(JSON\.stringify\(j\.params\)\) : null; \} catch \(_\) \{ return null; \} \}\)\(\),/);
    assert.match(src, /if \(!success && !j\.errorMessage\) j\.errorMessage = 'No error message was returned/);
  });
}
