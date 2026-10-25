// LOT W04 (25/10) : l editeur Cut / Copy / Paste (#select-modal) adopte le gabarit .fen-3d (apercu a gauche, reglages en colonne
// a droite, pied Annuler + action). Verifie site ET bureau, et que tous les id lus par le JS existent encore.
// Lancer : node --test tests/bureau-interface/lot-w04-select.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lire = (f) => readFileSync(join(RACINE, f), 'utf8').replace(/\r\n/g, '\n');
const COTES = [
  { nom: 'bureau', html: 'src/renderer/index2.html', js: 'src/renderer/index2-edit-tools.js', css: 'src/renderer/styles/index2.css' },
  { nom: 'site', html: 'cloud/public/app/index.html', js: 'cloud/public/app/index2-edit-tools.js', css: 'cloud/public/app/styles/index2.css' },
];

function bloc(html) {
  const a = html.indexOf('<div id="select-modal"');
  assert.ok(a >= 0, 'select-modal absent');
  const b = html.indexOf('<!-- ====', a);
  return html.slice(a, b);
}

for (const c of COTES) {
  test(`${c.nom} : #select-modal suit le gabarit fen-3d`, () => {
    const h = bloc(lire(c.html));
    assert.match(h, /class="modal-card fen-3d"/);
    assert.match(h, /class="fen-corps"/);
    assert.match(h, /class="fen-apercu"/);
    assert.match(h, /class="fen-form"/);
    // apercu avant reglages
    assert.ok(h.indexOf('fen-apercu') < h.indexOf('class="fen-form"'));
    // pied : Annuler puis action
    assert.ok(h.indexOf('id="select-cancel"') < h.indexOf('id="select-save"'));
    assert.match(h, /class="modal-actions"/);
    // les boutons ne sont plus au-dessus du canevas
    assert.ok(h.indexOf('id="select-cut"') > h.indexOf('id="select-canvas-container"'));
    assert.doesNotMatch(h, /class="modal-content"/);
  });

  test(`${c.nom} : tous les id lus par le JS existent`, () => {
    const h = bloc(lire(c.html));
    const js = lire(c.js);
    const ids = new Set();
    for (const m of js.matchAll(/getElementById\('(select-[a-z-]+)'\)/g)) ids.add(m[1]);
    assert.ok(ids.size >= 10);
    for (const id of ids) assert.ok(h.includes(`id="${id}"`), `id perdu : ${id}`);
    assert.ok(h.includes('id="select-overlay"'));
  });

  test(`${c.nom} : regles CSS du lot`, () => {
    const css = lire(c.css);
    assert.match(css, /LOT W04/);
    assert.match(css, /\.fen-apercu-canevas\s*\{[^}]*inset: 0/);
  });
}

test('cles de langue du lot identiques des deux cotes', () => {
  const a = lire('src/renderer/lang/_additions6.js');
  assert.equal(a, lire('cloud/public/app/lang/_additions6.js'));
  for (const k of ['Selection shape', 'Cut and paste', 'View and history']) assert.ok(a.includes(`"${k}"`));
});
