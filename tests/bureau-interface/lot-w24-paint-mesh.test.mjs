import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const FICHIERS = ['src/renderer/index2.html', 'cloud/public/app/index.html'];
const IDS = ['pm-title','pm-subtitle','pm-toggle-emissive','pm-close-x','pm-canvas','pm-status','pm-viewport-wrap',
  'pm-tool-pen','pm-tool-spray','pm-tool-ink','pm-tool-eraser','pm-tool-pipette','pm-tool-decal','pm-color',
  'pm-brush-size','pm-brush-val','pm-opacity','pm-falloff','pm-decal-panel','pm-undo','pm-redo','pm-reset','pm-cancel','pm-save'];

for (const f of FICHIERS) {
  test('Paint Mesh suit le gabarit fen-3d : ' + f, () => {
    const h = readFileSync(f, 'utf8');
    const i = h.indexOf('id="modal-paint-mesh"');
    const j = h.indexOf('id="modal-paint-emissive"');
    assert.ok(i > 0 && j > i);
    const b = h.slice(i, j);
    assert.match(b, /class="modal-card fen-3d"/);
    assert.match(b, /class="fen-corps"/);
    assert.ok(b.indexOf('id="pm-viewport-wrap"') < b.indexOf('fen-form'), 'apercu a gauche, colonne a droite');
    assert.match(b, /id="pm-viewport-wrap" class="fen-apercu"/);
    for (const id of IDS) assert.ok(b.includes('id="' + id + '"'), 'id perdu : ' + id);
    assert.ok(b.indexOf('id="pm-cancel"') < b.indexOf('id="pm-save"'));
  });
}
