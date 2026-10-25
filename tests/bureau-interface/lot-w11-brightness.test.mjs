import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const lire = (p) => fs.readFileSync(path.join(racine, p), 'utf8').replace(/\r\n/g, '\n');

const COTES = [
  { nom: 'bureau', html: 'src/renderer/index2.html', js: 'src/renderer/index2.js', css: 'src/renderer/styles/index2.css' },
  { nom: 'site', html: 'cloud/public/app/index.html', js: 'cloud/public/app/index2.js', css: 'cloud/public/app/styles/index2.css' },
];

function fenetre(html) {
  const a = html.indexOf('id="modal-brightness"');
  const b = html.indexOf('<!-- Color Picker modal -->');
  assert.ok(a > 0 && b > a, 'fenetre Brightness introuvable');
  return html.slice(a, b);
}

for (const c of COTES) {
  test(`Brightness ${c.nom} : gabarit .fen-3d (apercu a gauche, reglages a droite, pied)`, () => {
    const w = fenetre(lire(c.html));
    assert.match(w, /class="modal-card fen-3d"/);
    assert.doesNotMatch(w, /modal-card-wide|modal-with-image|modal-form-side/);
    assert.match(w, /class="fen-corps"/);
    assert.match(w, /class="fen-apercu[^"]*"[^>]*>\s*<img id="bright-preview"/);
    assert.match(w, /class="fen-form"/);
    assert.match(w, /class="modal-subtitle"/);
    assert.ok(w.indexOf('fen-apercu') < w.indexOf('fen-form'), 'apercu avant reglages');
    assert.ok(w.indexOf('fen-corps') < w.indexOf('bright-cancel'), 'pied apres le corps');
  });

  test(`Brightness ${c.nom} : tous les id lus par le JS existent`, () => {
    const w = fenetre(lire(c.html));
    const js = lire(c.js);
    for (const k of ['brightness', 'contrast', 'saturation', 'sharpness']) {
      assert.ok(w.includes(`id="bright-${k}"`), k);
      assert.ok(w.includes(`id="bright-${k}-val"`), k + '-val');
    }
    for (const id of ['bright-preview', 'bright-reset', 'bright-cancel', 'bright-close-x', 'bright-apply']) {
      assert.ok(w.includes(`id="${id}"`), id);
      assert.ok(js.includes(`'${id}'`), id + ' non lu par le JS');
    }
    assert.ok(lire(c.html).includes('id="bright-sharpen-matrix"'));
  });

  test(`Brightness ${c.nom} : regles CSS du lot (pied pleine largeur)`, () => {
    const css = lire(c.css);
    assert.match(css, /LOT W11 : Brightness/);
    assert.match(css, /#modal-brightness \.modal-actions \.primary-btn \{ flex: 1 1 0; \}/);
  });
}

test('Brightness site : pastille de prix sur le bouton Apply', () => {
  assert.match(lire('cloud/public/app/cloud-overrides.js'), /'bright-apply':\s+'manual_tool'/);
});
