import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

for (const [nom, p] of [['bureau', 'src/renderer/index2.html'], ['site', 'cloud/public/app/index.html']]) {
  test('Brightness ' + nom + ' : gabarit fen-3d, ids conserves', () => {
    const h = fs.readFileSync(p, 'utf8');
    const i = h.indexOf('id="modal-brightness"');
    const bloc = h.slice(i, h.indexOf('<!-- Color Picker modal', i) > i ? h.indexOf('<!-- Color Picker modal', i) : i + 4000);
    assert.match(bloc, /modal-card fen-3d/);
    assert.match(bloc, /class="fen-corps"/);
    assert.match(bloc, /fen-apercu/);
    assert.match(bloc, /fen-form/);
    for (const id of ['bright-preview', 'bright-brightness', 'bright-contrast', 'bright-saturation', 'bright-sharpness',
      'bright-brightness-val', 'bright-contrast-val', 'bright-saturation-val', 'bright-sharpness-val',
      'bright-reset', 'bright-cancel', 'bright-apply', 'bright-close-x']) assert.ok(bloc.includes('id="' + id + '"'), id);
  });
}
