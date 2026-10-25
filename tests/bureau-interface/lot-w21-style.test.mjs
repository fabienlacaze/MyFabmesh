import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const fichiers = ['src/renderer/index2.html', 'cloud/public/app/index.html'];
for (const f of fichiers) {
  test('fenetre Style au gabarit fen-3d : ' + f, () => {
    const h = fs.readFileSync(f, 'utf8');
    const i = h.indexOf('id="modal-style"');
    assert.ok(i > 0);
    const bloc = h.slice(i, h.indexOf('id="modal-multiview-options"'));
    assert.match(bloc, /modal-card fen-3d/);
    assert.match(bloc, /class="fen-corps"/);
    assert.match(bloc, /class="fen-apercu"><img id="sty-image"/);
    assert.match(bloc, /class="fen-form"/);
    assert.ok(!/modal-with-image/.test(bloc));
    for (const id of ['sty-liste', 'sty-image', 'sty-cancel', 'sty-apply']) assert.ok(bloc.includes('id="' + id + '"'), id);
  });
}
