import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const FICHIERS = {
  bureau: ['src/renderer/index2.html', 'src/renderer/styles/index2.css'],
  site: ['cloud/public/app/index.html', 'cloud/public/app/styles/index2.css'],
};
const IDS = ['paint-canvas', 'paint-emissive-overlay', 'paint-sel-overlay', 'paint-brush-cursor', 'paint-canvas-container',
  'paint-emissive-toggle', 'paint-loupe-toggle', 'paint-recenter', 'paint-undo', 'paint-redo', 'paint-reset', 'paint-close-x',
  'paint-tool-sel-rect', 'paint-tool-sel-lasso', 'paint-tool-wand', 'paint-sel-invert', 'paint-sel-none',
  'paint-tool-pen', 'paint-tool-spray', 'paint-tool-ink', 'paint-tool-line', 'paint-tool-smudge', 'paint-tool-fill', 'paint-tool-eraser',
  'paint-color', 'paint-eyedropper', 'paint-brush-val', 'paint-brush-size', 'paint-opacity-val', 'paint-opacity',
  'paint-hardness-val', 'paint-hardness', 'paint-tolerance-group', 'paint-tolerance-val', 'paint-tolerance', 'paint-cancel', 'paint-save'];

for (const [nom, [html, css]] of Object.entries(FICHIERS)) {
  const h = readFileSync(html, 'utf8');
  const debut = h.indexOf('id="modal-paint"');
  const bloc = h.slice(debut, h.indexOf('id="modal-mesh-edit"'));
  test(`${nom} : Paint Tools au gabarit fen-3d`, () => {
    assert.match(bloc, /modal-card fen-3d/);
    assert.ok(bloc.indexOf('paint-canvas-container') < bloc.indexOf('paint-colonne'), 'apercu a gauche avant la colonne');
    assert.ok(bloc.indexOf('paint-tool-pen') > bloc.indexOf('paint-colonne'), 'outils dans la colonne de droite');
    assert.ok(bloc.indexOf('paint-undo') > bloc.indexOf('paint-colonne'), 'annuler/refaire dans la colonne');
    for (const id of IDS) assert.ok(bloc.includes(`id="${id}"`), `id perdu : ${id}`);
  });
  test(`${nom} : CSS LOT W07`, () => {
    const c = readFileSync(css, 'utf8');
    assert.match(c, /LOT W07[\s\S]*#modal-paint \.modal-actions \.primary-btn \{ flex: 1 1 auto/);
  });
}
