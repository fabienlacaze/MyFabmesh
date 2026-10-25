// 25/10 : « il manque l'historique en amont et les parametres » (version issue de Subdivision). Les versions produites par un outil de maillage portent maintenant
// leur maillage d'origine, leurs reglages et le NOM du fichier produit (retrouve par handleLineageMeta).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const chemin = process.env.WORKER_SRC || new URL('../src/worker.ts', import.meta.url);
const SRC = readFileSync(chemin, 'utf8').replace(/\r\n/g, '\n');
const a = SRC.indexOf('function _paramsPourHistorique('), b = SRC.indexOf('\n}\n', a) + 3;
const js = ts.transpileModule(SRC.slice(a, b), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const _paramsPourHistorique = new Function(js + '; return _paramsPourHistorique;')();

test('reglages : valeurs simples gardees, URL / masques / donnees ecartes', () => {
  const r = _paramsPourHistorique({ iterations: 2, lamb: 0.5, style: 'rusty', actif: true, meshUrl: 'https://x/y.glb', uv_mask_b64: 'AAAA', image_data: 'x', long: 'x'.repeat(500), lien: 'https://a.b/c', 'bad key': 1 });
  assert.deepEqual(r, { iterations: 2, lamb: 0.5, style: 'rusty', actif: true });
});
test('reglages : null / non objet -> vide, 12 cles au plus', () => {
  assert.deepEqual(_paramsPourHistorique(null), {});
  assert.deepEqual(_paramsPourHistorique('x'), {});
  const gros = {}; for (let i = 0; i < 30; i++) gros['k' + i] = i;
  assert.equal(Object.keys(_paramsPourHistorique(gros)).length, 12);
});
test('les deux chemins d enregistrement ecrivent output_name, params et le maillage d origine', () => {
  assert.match(SRC, /output_name: key\.split\('\/'\)\.pop\(\) \|\| '', params: _paramsPourHistorique\(params\)/);
  assert.match(SRC, /output_name: key\.split\('\/'\)\.pop\(\) \|\| '', params: _paramsPourHistorique\(reglagesBruts\)/);
  assert.match(SRC, /mesh_url_in: versionDe/);
});
test('handleLineageMeta retrouve la version par le nom du fichier produit et fusionne ses reglages', () => {
  assert.match(SRC, /eq\('options->>output_name', nom\)/);
  assert.match(SRC, /for \(const \[k, v\] of Object\.entries\(options\.params as Record<string, unknown>\)\) params\[k\] = v;/);
  assert.match(SRC, /const _CHAMPS_INTERNES = new Set\(\['output_name', 'client_side', 'size_bytes'/);
});
test('les etapes de construction et les operations d atlas ecrivent aussi leur maillage d origine, leurs reglages et le nom du fichier produit', () => {
  assert.ok(SRC.includes("mesh_url_in: finalUrl, output_name: `${newStem}.glb`, params: _paramsPourHistorique({ stage_count: n, ...mats })"));
  assert.ok(SRC.includes("op: conf.op, output_name: key.split('/').pop() || '', params: _paramsPourHistorique(envoi)"));
});
