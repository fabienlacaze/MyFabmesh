// LOT W09 (25/10) : fenetre Re-texture / Reshape (etape image) au gabarit commun des fenetres d'outils.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lire = (f) => readFileSync(join(RACINE, f), 'utf8').replace(/\r\n/g, '\n');
const COTES = [
  { nom: 'bureau', js: 'src/renderer/index2.js', html: 'src/renderer/index2.html', css: 'src/renderer/styles/index2.css' },
  { nom: 'site', js: 'cloud/public/app/index2.js', html: 'cloud/public/app/index.html', css: 'cloud/public/app/styles/index2.css' },
];
const ID = ['rrx-img', 'rrx-canvas', 'rrx-stage', 'rrx-3d-stage', 'rrx-3d-canvas', 'rrx-3d-loading', 'rrx-3d-panel', 'rrx-3d-info', 'rrx-form',
  'rrx-part', 'rrx-prompt', 'rrx-brush', 'rrx-strength', 'rrx-detect', 'rrx-clear', 'rrx-cancel', 'rrx-change-view', 'rrx-use-view', 'rrx-apply', 'rrx-close-x', 'rrx-loading', 'rrx-vue-nom'];

for (const c of COTES) {
  test(`${c.nom} : fenetre region-retex au gabarit commun`, () => {
    const h = lire(c.html);
    const a = h.indexOf('id="modal-region-retex"');
    const bloc = h.slice(a, h.indexOf('<!-- ====', a + 10) > 0 ? h.indexOf('id="modal-paint-', a) : a + 9000);
    for (const id of ID) assert.ok(bloc.includes(`id="${id}"`), `id perdu : ${id}`);
    assert.ok(!/calc\(min\(88vh, 920px\) - 210px\)/.test(bloc), 'apercu encore dimensionne en carre fixe');
    assert.ok(bloc.includes('id="rrx-brush-val"') && bloc.includes('id="rrx-strength-val"'), 'valeur des curseurs absente');
    assert.ok(bloc.includes('class="fen-label"'), 'etiquettes au gabarit absentes');
    const js = lire(c.js);
    assert.ok(js.includes("'rrx-strength'") && js.includes("id + '-val'"), 'valeurs de curseurs non synchronisees');
    assert.ok(lire(c.css).includes('#modal-region-retex .modal-actions .primary-btn { flex: 1 1 0; }'), 'pied pleine largeur absent');
  });
}
