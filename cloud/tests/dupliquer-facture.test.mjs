// 27/10 (decision du user) : « Dupliquer » (Select faces) est facture (manual_tool, 1 credit) en plus de l'enregistrement. Site seulement : le bureau n'a pas de credits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const idx = readFileSync(new URL('../public/app/index2.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const ov = readFileSync(new URL('../public/app/cloud-overrides.js', import.meta.url), 'utf8');
test('Dupliquer debite avant de copier et s\'arrete si les credits manquent', () => {
  const i = idx.indexOf("document.getElementById('me-sel-duplicate')?.addEventListener('click', async () => {");
  assert.ok(i > 0);
  const g = idx.slice(i, i + 1200);
  assert.ok(g.includes("API.chargeTool({ tool: 'sel_duplicate' })"));
  assert.ok(g.indexOf('chargeTool') < g.indexOf('_mePushUndo()'), 'debit AVANT la copie');
  assert.match(g, /if \(!c\.success\) \{ showToast\(c\.error \|\| 'Not enough credits'/);
});
test('le prix se voit sur les deux boutons Dupliquer (carte de l\'assistant et mode expert)', () => {
  assert.match(ov, /'me-sel-duplicate':\s+'manual_tool'/);
  assert.match(ov, /'me-w-c-duplicate':\s+'manual_tool'/);
});
