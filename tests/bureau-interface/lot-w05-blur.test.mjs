// LOT W05 (25/10) : l'editeur Blur / Sharpen suit le gabarit .fen-3d (apercu a gauche, reglages a droite, pied pleine largeur).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lire = (f) => readFileSync(join(RACINE, f), 'utf8').replace(/\r\n/g, '\n');
const IDS = ['blur-close-x', 'blur-brush-size', 'blur-brush-val', 'blur-strength', 'blur-strength-val', 'blur-mode-blur', 'blur-mode-sharpen',
  'blur-loupe-toggle', 'blur-fit', 'blur-undo', 'blur-redo', 'blur-reset', 'blur-canvas-container', 'blur-canvas', 'blur-brush-cursor', 'blur-cancel', 'blur-save'];
for (const [html, css] of [['cloud/public/app/index.html', 'cloud/public/app/styles/index2.css'], ['src/renderer/index2.html', 'src/renderer/styles/index2.css']]) {
  test(`${html} : Blur / Sharpen en carte fen-3d`, () => {
    const h = lire(html);
    const i = h.indexOf('<div id="modal-blur"');
    const bloc = h.slice(i, h.indexOf('<!-- Crop modal -->', i));
    assert.ok(bloc.includes('class="modal-card fen-3d'));
    for (const id of IDS) assert.ok(bloc.includes(`id="${id}"`), id);
    assert.ok(bloc.indexOf('id="blur-canvas-container" class="fen-apercu"') < bloc.indexOf('class="fen-form"'), 'apercu a gauche');
    assert.ok(bloc.indexOf('id="blur-brush-size"') > bloc.indexOf('class="fen-form"'), 'reglages dans la colonne');
    assert.ok(bloc.indexOf('id="blur-cancel"') < bloc.indexOf('id="blur-save"'));
    assert.ok(!bloc.includes('width:95vw'));
  });
  test(`${css} : pied pleine largeur`, () => {
    assert.ok(lire(css).includes('.fen-2d-blur .modal-actions .primary-btn { flex: 1 1 auto; }'));
  });
}
