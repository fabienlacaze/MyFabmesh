// 25/10 (user : « autant en garder qu'une seule, la renommer de auto a manuel et inverser son etat ») : UNE case « Reglages manuels », decochee d'office
// (decochee = reglages automatiques) ; plus de case « Reglages automatiques », plus de synchronisation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lire = (f) => readFileSync(join(RACINE, f), 'utf8').replace(/\r\n/g, '\n');
for (const [html, js] of [['cloud/public/app/index.html', 'cloud/public/app/index2.js'], ['src/renderer/index2.html', 'src/renderer/index2.js']]) {
  test(`${html} : une seule case, « Manual settings », decochee d'office`, () => {
    const h = lire(html);
    assert.match(h, /<input type="checkbox" id="ws-3d-manual" \/>/);
    assert.doesNotMatch(h, /id="ws-3d-auto"/);
    assert.match(h, /Manual settings/);
  });
  test(`${js} : la logique lit la case manuelle (decochee = automatique), sans synchronisation`, () => {
    const s = lire(js);
    assert.doesNotMatch(s, /getElementById\('ws-3d-auto'\)/);
    assert.doesNotMatch(s, /_caseManuelle3D/);
    assert.match(s, /getElementById\('ws-3d-manual'\)\?\.checked === false && at/);
    assert.match(s, /if \(e\.isTrusted && !manuel\.checked\) \{ manuel\.checked = true; _ajusterAuto3D\(\); \}/);
    assert.match(s, /if \(det\) det\.open = manuel\.checked;/);
    assert.match(s, /if \(!manuel\.checked\) _applyAssetOptionsProfile/);
  });
}
test('cloud-overrides recalcule le prix sur la case manuelle', () => {
  assert.match(lire('cloud/public/app/cloud-overrides.js'), /'ws-3d-manual', 'ws-asset-type'/);
});
