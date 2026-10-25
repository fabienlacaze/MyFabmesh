import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const FICHIERS = ['src/renderer/index2.html', 'cloud/public/app/index.html'];
const IDS = ['pe-viewport-wrap','pe-canvas','pe-status','pe-mask-panel','pe-mask-prompt','pe-mask-strength','pe-mask-strength-val','pe-clone-panel','pe-color','pe-intensity','pe-intensity-val','pe-brush-size','pe-brush-size-val','pe-brush-opacity','pe-brush-opacity-val','pe-brush-falloff','pe-brush-falloff-val','pe-mode-paint','pe-mode-erase','pe-loupe-toggle','pe-undo','pe-redo','pe-clear','pe-toggle-emissive','pe-load-image-layer','pe-cancel','pe-apply-device'];
for (const f of FICHIERS) {
  const s = fs.readFileSync(f, 'utf8');
  const a = s.indexOf('id="modal-paint-emissive"');
  const b = s.indexOf('Magnifier loupe for the Paint-Emissive');
  const blk = s.slice(a, b);
  test('Paint Emissive au gabarit fen-3d : ' + f, () => {
    assert.match(blk, /class="modal-card fen-3d"/);
    assert.match(blk, /class="fen-corps"/);
    assert.match(blk, /id="pe-viewport-wrap" class="fen-apercu"/);
    assert.match(blk, /class="fen-form"/);
    assert.doesNotMatch(blk, /width:280px/);
    for (const id of IDS) assert.ok(blk.includes('id="' + id + '"'), 'id perdu : ' + id);
    const n = (x) => (blk.match(new RegExp('<' + x + '[ >]', 'g')) || []).length;
    const c = (blk.match(/<\/div>/g) || []).length;
    assert.equal(n('div') + 1, c, 'div equilibres');
  });
}
