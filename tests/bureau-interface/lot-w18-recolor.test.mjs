import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const FICHIERS = ['src/renderer/index2.html', 'cloud/public/app/index.html'];
const IDS = ['rc-source-img', 'rc-detect-spinner', 'rc-detect-label', 'rc-mode', 'rc-prompt', 'rc-all-prompt', 'rc-swatches',
  'rc-strength', 'rc-strength-val', 'rc-precision', 'rc-precision-val', 'rc-dilate', 'rc-dilate-val', 'rc-mode-hint', 'rc-cancel', 'rc-go'];

for (const f of FICHIERS) {
  test('Recolorier au gabarit fen-3d : ' + f, () => {
    const s = fs.readFileSync(f, 'utf8');
    const i = s.indexOf('id="modal-recolor" class');
    const j = s.indexOf('rc-go', i);
    const b = s.slice(i, j);
    assert.ok(b.includes('modal-card fen-3d'));
    assert.ok(b.includes('class="fen-corps"'));
    assert.ok(b.includes('class="fen-apercu"'));
    assert.ok(b.includes('fen-form'));
    assert.ok(b.includes('modal-subtitle'));
    for (const id of IDS) assert.ok(s.slice(i, j + 200).includes('id="' + id + '"'), id);
  });
  test('Recolorier : css du lot ' + f.split('/')[0], () => {
    const c = fs.readFileSync(f.startsWith('src') ? 'src/renderer/styles/index2.css' : 'cloud/public/app/styles/index2.css', 'utf8');
    assert.ok(c.includes('LOT W18') && c.includes('#modal-recolor .modal-card > .modal-actions .primary-btn'));
  });
}
