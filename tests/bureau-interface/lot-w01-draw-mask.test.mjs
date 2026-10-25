import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const FICHIERS = {
  site: ['cloud/public/app/index.html', 'cloud/public/app/index2-edit-tools.js'],
  bureau: ['src/renderer/index2.html', 'src/renderer/index2-edit-tools.js'],
};
const IDS = ['mask-modal', 'mask-modal-close', 'mask-brush-size', 'mask-brush-val', 'mask-brush-mode', 'mask-eraser-mode',
  'mask-loupe-toggle', 'mask-recenter', 'mask-undo', 'mask-redo', 'mask-clear', 'mask-canvas-container',
  'mask-base-canvas', 'mask-overlay-canvas', 'mask-brush-cursor', 'mask-prompt', 'mask-cancel', 'mask-apply'];

for (const [cible, [html, js]] of Object.entries(FICHIERS)) {
  const h = fs.readFileSync(html, 'utf8');
  const i = h.indexOf('<div id="mask-modal"');
  const bloc = h.slice(i, h.indexOf('<!-- =====', i));
  test(cible + ' : Draw Mask au gabarit fen-3d', () => {
    assert.ok(/class="modal-card fen-3d/.test(bloc), 'carte fen-3d');
    assert.ok(/class="fen-corps"/.test(bloc), 'corps en deux colonnes');
    assert.ok(/id="mask-canvas-container" class="fen-apercu"/.test(bloc), 'apercu a gauche');
    assert.ok(/class="fen-form"/.test(bloc), 'colonne de reglages');
    assert.ok(bloc.indexOf('fen-apercu') < bloc.indexOf('fen-form'), 'apercu avant reglages');
    assert.ok(bloc.indexOf('fen-form') < bloc.indexOf('id="mask-cancel"'), 'pied apres');
    assert.ok(!/width:95vw/.test(bloc), 'plus de carte plein ecran');
  });
  test(cible + ' : tous les id du JS sont conserves', () => {
    for (const id of IDS) assert.ok(bloc.includes('id="' + id + '"'), id);
    const code = fs.readFileSync(js, 'utf8');
    for (const m of code.matchAll(/getElementById\('(mask-[a-z-]+)'\)/g)) assert.ok(bloc.includes('id="' + m[1] + '"'), m[1]);
  });
}
