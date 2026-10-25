// LOT W08 (25/10) : Color Picker au gabarit commun .fen-3d (apercu a gauche, valeurs a droite, pied Fermer / Copier).
// Lancer : node --test tests/bureau-interface/lot-w08-colorpick.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lire = (p) => readFileSync(join(RACINE, p), 'utf-8');
const PAGES = { bureau: 'src/renderer/index2.html', web: 'cloud/public/app/index.html' };
const JS = { bureau: 'src/renderer/index2.js', web: 'cloud/public/app/index2.js' };

for (const [cible, page] of Object.entries(PAGES)) {
  test(`Color Picker (${cible}) : gabarit fen-3d, ids conserves`, () => {
    const h = lire(page);
    const i = h.indexOf('id="modal-colorpick"');
    assert.ok(i > 0);
    const bloc = h.slice(i, h.indexOf('<!-- Blur Brush modal -->', i));
    assert.match(bloc, /class="modal-card fen-3d/);
    assert.match(bloc, /class="fen-corps"/);
    assert.match(bloc, /id="cpick-canvas-container" class="fen-apercu"/);
    assert.match(bloc, /class="fen-form"/);
    assert.match(bloc, /modal-actions fen-pied-editeur/);
    // ordre : apercu avant la colonne de reglages, pied apres
    assert.ok(bloc.indexOf('fen-apercu') < bloc.indexOf('fen-form'));
    assert.ok(bloc.indexOf('fen-form') < bloc.indexOf('cpick-close"'));
    // chaque id lu par le JS existe
    const js = lire(JS[cible]);
    const lus = new Set([...js.matchAll(/getElementById\('(cpick-[a-z-]+)'\)/g)].map((m) => m[1]));
    assert.ok(lus.size >= 6);
    for (const id of lus) assert.ok(bloc.includes(`id="${id}"`), `id perdu : ${id}`);
    assert.ok(!/min-width:min\(600px/.test(bloc), 'ancienne carte au contenu');
  });
}
