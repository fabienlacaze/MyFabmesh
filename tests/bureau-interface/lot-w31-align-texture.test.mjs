// LOT W31 (25/10) : « Align Texture » sur le gabarit .fen-3d (apercu a gauche, colonne de reglages a droite, pied Annuler + action).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lire = (r) => readFileSync(join(RACINE, r), 'utf-8').replace(/\r\n/g, '\n');
const CIBLES = { bureau: ['src/renderer/index2.html', 'src/renderer/styles/index2.css'], site: ['cloud/public/app/index.html', 'cloud/public/app/styles/index2.css'] };
const IDS = ['at-preview-canvas', 'at-preview-canvas-wrap', 'at-preview-status', 'at-view-buttons', 'at-side-buttons', 'at-tx', 'at-ty', 'at-tz', 'at-scale',
  'at-roty', 'at-vis', 'at-opacity', 'at-tx-val', 'at-ty-val', 'at-tz-val', 'at-scale-val', 'at-roty-val', 'at-vis-val', 'at-opacity-val', 'at-project-live',
  'at-show-overlay', 'at-autofit', 'at-framefix', 'at-skipvflip', 'at-reset', 'at-cancel', 'at-reproject'];

for (const [nom, [html, css]] of Object.entries(CIBLES)) {
  test(`Align Texture (${nom}) : gabarit fen-3d, ids conserves`, () => {
    const h = lire(html);
    const i = h.indexOf('id="modal-align-texture"');
    const bloc = h.slice(i, h.indexOf('<!-- ====', i));
    assert.match(bloc, /class="modal-card fen-3d"/);
    assert.match(bloc, /<div class="fen-corps">/);
    assert.match(bloc, /id="at-preview-canvas-wrap" class="fen-apercu"/);
    assert.match(bloc, /<div class="fen-form">/);
    assert.ok(bloc.indexOf('fen-apercu') < bloc.indexOf('fen-form'), 'apercu avant reglages');
    assert.ok(bloc.indexOf('id="at-cancel"') < bloc.indexOf('id="at-reproject"'), 'Annuler puis action');
    assert.ok(bloc.indexOf('class="modal-actions"') > bloc.indexOf('fen-form'));
    assert.doesNotMatch(bloc, /width:280px|height:var\(--vz-h-corps\)/);
    for (const id of IDS) assert.ok(bloc.includes(`id="${id}"`), `id perdu : ${id}`);
    assert.match(lire(css), /LOT W31[\s\S]*#modal-align-texture \.modal-actions \.primary-btn \{ flex: 1 1 auto; \}/);
  });
}
