// 25/10 (user : « inverse : Reglages manuels, et pas coche ») : la case visible de la creation 3D est « Reglages manuels », decochee d'office ;
// la case d'origine (ws-3d-auto, source de verite) reste cachee et synchronisee.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const f of ['cloud/public/app/index2.js', 'src/renderer/index2.js']) {
  test(`${f} : « Reglages manuels » inverse la case automatique sans changer sa logique`, () => {
    const src = readFileSync(join(RACINE, f), 'utf8').replace(/\r\n/g, '\n');
    const i = src.indexOf('(function _caseManuelle3D() {');
    assert.ok(i > 0);
    const corps = src.slice(i, src.indexOf('})();', i));
    assert.match(corps, /cb\.checked = !auto\.checked/);
    assert.match(corps, /auto\.checked = !cb\.checked/);
    assert.match(corps, /cb\.checked = !v/);
    assert.match(corps, /_i18nT\('Manual settings'\)/);
    assert.match(corps, /lab\.style\.display = 'none'/);
    assert.doesNotMatch(src, /Tick "Auto settings"/);
  });
}
test('la logique d inversion : tout etat de la case cachee se reflete a l envers', () => {
  // simulation minimale : setter de checked relie a la case visible
  let interne = true; const visible = { checked: false };
  const auto = { get checked() { return interne; }, set checked(v) { interne = v; visible.checked = !v; } };
  auto.checked = false; assert.equal(visible.checked, true);
  auto.checked = true; assert.equal(visible.checked, false);
});
