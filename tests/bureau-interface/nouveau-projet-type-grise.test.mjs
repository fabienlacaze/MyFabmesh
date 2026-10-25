// 25/10 (user : « Personnage n'est pas grise en mode auto alors qu'il devrait ») : en mode Auto, le type et le style restent GRISES tant que l'IA redige ;
// ils ne redeviennent libres que si elle a fini SANS rien detecter (le menu doit alors pouvoir etre choisi).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const f of ['cloud/public/app/index2.js', 'src/renderer/index2.js']) {
  test(`${f} : type et style grises pendant la redaction de l'IA`, () => {
    const s = readFileSync(join(RACINE, f), 'utf8').replace(/\r\n/g, '\n');
    assert.ok(s.includes('let _npIaEnCours = false;'));
    assert.ok(s.includes("if (!type && saisi && !_npIaEnCours) { selT.disabled = false; selT.style.opacity = ''; }"));
    const i = s.indexOf('function _npPlanifierRedaction() {');
    const corps = s.slice(i, s.indexOf('\n}\n', i));
    assert.ok(corps.includes('_npIaEnCours = !!('));
    const j = s.indexOf('async function _npRediger() {');
    const rediger = s.slice(j, s.indexOf('\n}\n', j));
    assert.ok(rediger.includes('_npIaEnCours = false;'));
    assert.ok(s.includes("_npIaType = null; _npPlanifierRedaction(); _npAutoSync();"));
  });
}
