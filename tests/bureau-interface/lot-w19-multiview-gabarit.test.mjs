// Lot W19 (25/10) : la fenetre Multi-views adopte le gabarit .fen-3d (apercu a gauche, reglages a droite, pied pleine largeur).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lire = (f) => readFileSync(join(RACINE, f), 'utf8').replace(/\r\n/g, '\n');
const IDS = ['mv-opt-source-img', 'mv-opt-mode', 'mv-opt-6view-block', 'mv-opt-harmonize', 'mv-opt-upscale', 'mv-opt-cancel', 'mv-opt-start'];
for (const [html, css] of [['cloud/public/app/index.html', 'cloud/public/app/styles/index2.css'], ['src/renderer/index2.html', 'src/renderer/styles/index2.css']]) {
  test(`${html} : Multi-views en gabarit fen-3d, tous les id conserves`, () => {
    const h = lire(html);
    const i = h.indexOf('<div id="modal-multiview-options"');
    const bloc = h.slice(i, h.indexOf('<!-- ====', i));
    assert.ok(bloc.includes('modal-card fen-3d'));
    assert.ok(!bloc.includes('modal-with-image'));
    for (const id of IDS) assert.ok(bloc.includes(`id="${id}"`), id);
    assert.ok(bloc.indexOf('class="modal-subtitle"') < bloc.indexOf('class="fen-corps"'), 'aide sous le titre');
    assert.ok(bloc.indexOf('fen-apercu') < bloc.indexOf('fen-form'), 'apercu a gauche');
  });
  test(`${css} : pied pleine largeur`, () => {
    const c = lire(css);
    assert.ok(c.includes('#modal-multiview-options .modal-actions .primary-btn { flex: 1 1 auto; }'));
  });
}
