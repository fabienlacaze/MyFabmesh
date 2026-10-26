// Fill holes, reparation de la PEAU (2026-10-26) cote worker : liste blanche des parametres de fill_holes, detection seule JAMAIS debitee, et les deux refus
// « double peau » reconnus par leur code. Lancer : cd cloud && node --test tests/skin-repair.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chargerFonctions, lireSource } from './_charge-worker.mjs';

const src = lireSource();
const i = src.indexOf('async function handleMeshOp(');
const corps = src.slice(i, src.indexOf('\nasync function ', i + 40));

test('fill_holes : liste BLANCHE des parametres (seuls min, max, skin_repair, detect_only partent vers Modal)', () => {
  assert.match(corps, /if \(op === 'fill_holes'\) \{/);
  assert.match(corps, /params = \{ min_hole_size: borne\(pr\.min_hole_size, 3\), max_hole_size: borne\(pr\.max_hole_size, 1_000_000\),\s+skin_repair: pr\.skin_repair === true, detect_only: detectOnly \};/);
  assert.match(corps, /detectOnly = pr\.detect_only === true;/);
  assert.match(corps, /let params = paramsEntree;/);
});

test('un booleen strict : « true » en texte, 1 ou un objet ne cochent rien', () => {
  const m = corps.match(/skin_repair: pr\.skin_repair === true/);
  assert.ok(m);
});

test('detection seule : aucun credit debite, aucune cle R2, reponse JSON sans maillage', () => {
  assert.match(corps, /const remaining = detectOnly \? 0 : await spendCredits\(env, user\.id, COST_PER\);/);
  assert.match(corps, /const urlPut = detectOnly \? null : await _urlPutR2Signee/);
  assert.match(corps, /if \(detectOnly\) \{[\s\S]*?return json\(\{ ok: true, success: true, detect: d\.detect \?\? \{ nombre: 0, trous: \[\] \}, charged: 0 \}\);/);
});

test('la detection seule compte quand meme dans le budget GPU et les appels du compte', () => {
  const a = corps.indexOf('checkAndIncrementModalSpend');
  const b = corps.indexOf('checkAndIncrementUserCalls');
  const c = corps.indexOf('detectOnly ? 0 : await spendCredits');
  assert.ok(a > 0 && b > a && c > b, 'budget, appels, puis (pas de) debit');
});

test('les deux refus « double peau » ont chacun leur code (avec / sans la recherche de peau)', () => {
  const { codeRefus } = chargerFonctions(['REFUS_CONNUS', 'codeRefus']);
  const sans = 'Nothing to fill: the mesh has no open hole, but 25801 edges are shared by more than two faces (double skin or glued parts). If the hull looks pierced, tick "Also repair holes in the outer skin" and try again. The mesh was left unchanged.';
  const avec = 'Nothing to fill: the mesh has no open hole, but 25801 edges are shared by more than two faces (double skin or glued parts). No hole in the outer skin was found either. The mesh was left unchanged.';
  assert.equal(codeRefus(sans).code, 'fill_holes_closed_nonmanifold');
  assert.equal(codeRefus(avec).code, 'fill_holes_closed_nonmanifold_skin');
  assert.equal(codeRefus(sans).params.n, 25801);
  assert.equal(codeRefus(avec).params.n, 25801);
});
