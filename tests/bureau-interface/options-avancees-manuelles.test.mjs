// 25/10 (user : « options avancees visibles que si je clique sur reglages manuels » ; « mets le resume Ultra 500 K a droite de reglages manuels »).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lire = (f) => readFileSync(join(RACINE, f), 'utf8').replace(/\r\n/g, '\n');
for (const [html, js] of [['cloud/public/app/index.html', 'cloud/public/app/index2.js'], ['src/renderer/index2.html', 'src/renderer/index2.js']]) {
  test(`${html} : le resume automatique est dans la MEME ligne que la case « Manual settings »`, () => {
    const h = lire(html);
    const i = h.indexOf('id="ws-3d-auto-row"');
    const fin = h.indexOf('</div>', i);
    const ligne = h.slice(i, fin);
    assert.match(ligne, /id="ws-3d-manual"/);
    assert.match(ligne, /id="ws-3d-auto-note"/);
    assert.match(ligne, /display:flex/);
  });
  test(`${js} : les options avancees ne s'affichent que moteur natif ET « Reglages manuels » cochee`, () => {
    const s = lire(js);
    const i = s.indexOf('function _ws3dEngineSync()');
    const corps = s.slice(i, s.indexOf('\n}\n', i));
    assert.match(corps, /getElementById\('ws-3d-manual'\)\?\.checked/);
    assert.match(s, /if \(typeof _ws3dEngineSync === 'function'\) _ws3dEngineSync\(\);   \/\/ visibles seulement en reglages manuels/);
    assert.match(s, /if \(manuel\.checked\) \{ if \(note\) note\.textContent = ''; return; \}/);
  });
}
