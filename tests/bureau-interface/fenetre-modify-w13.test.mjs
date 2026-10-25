import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const FICHIERS = { bureau: 'src/renderer/index2.html', site: 'cloud/public/app/index.html' };
const IDS = ['mod-source-img', 'mod-prompt', 'mod-retrait-hint', 'mod-engine', 'mod-strength', 'mod-strength-val', 'mod-strength-hint', 'mod-cancel', 'mod-apply'];

for (const [nom, f] of Object.entries(FICHIERS)) {
  const html = readFileSync(f, 'utf-8');
  const i = html.indexOf('id="modal-modify-image"');
  const fin = html.indexOf('<!-- ====', i);
  const bloc = html.slice(i, fin);
  test(`Modify (${nom}) : gabarit .fen-3d, apercu a gauche, colonne a droite`, () => {
    assert.match(bloc, /class="modal-card fen-3d"/);
    assert.match(bloc, /class="fen-corps"/);
    assert.ok(bloc.indexOf('fen-apercu') < bloc.indexOf('class="fen-form"'), 'apercu avant les reglages');
    assert.doesNotMatch(bloc, /modal-with-image|modal-image-side|modal-form-side/);
  });
  test(`Modify (${nom}) : tous les id lus par le JS sont conserves`, () => {
    for (const id of IDS) assert.ok(bloc.includes(`id="${id}"`), id);
  });
}
