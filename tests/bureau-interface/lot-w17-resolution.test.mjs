// Lot W17 (25/10) : la fenetre Resolution adopte le gabarit .fen-3d (apercu a gauche, reglages a droite, pied commun)
// sur le bureau ET le site, en gardant les id lus par le JS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PAGES = { bureau: 'src/renderer/index2.html', site: 'cloud/public/app/index.html' };
const IDS = ['res-preview', 'res-current', 'res-arrow', 'res-target', 'res-mode', 'res-downscale', 'res-upscale', 'res-close', 'res-apply'];

for (const [nom, chemin] of Object.entries(PAGES)) {
  const html = readFileSync(chemin, 'utf8');
  const a = html.indexOf('id="modal-resolution"');
  const bloc = html.slice(a, html.indexOf('res-apply', a) + 200);
  test(`${nom} : Resolution au gabarit fen-3d`, () => {
    assert.ok(a > 0);
    assert.match(bloc, /class="modal-card fen-3d"/);
    assert.match(bloc, /class="fen-corps"/);
    assert.match(bloc, /class="fen-apercu"/);
    assert.match(bloc, /class="fen-form"/);
    assert.doesNotMatch(bloc, /modal-with-image|modal-image-side|modal-form-side/);
  });
  test(`${nom} : id conserves`, () => {
    for (const id of IDS) assert.ok(bloc.includes(`id="${id}"`), id);
  });
}
