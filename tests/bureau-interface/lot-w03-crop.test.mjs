// LOT W03 : la fenetre Crop adopte le gabarit commun .fen-3d (apercu a gauche, reglages a droite, pied pleine largeur).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PAGES = {
  bureau: 'src/renderer/index2.html',
  site: 'cloud/public/app/index.html',
};
const IDS = ['crop-canvas-container', 'crop-canvas', 'crop-overlay', 'crop-close-x', 'crop-cancel', 'crop-apply',
  'crop-loupe-toggle', 'crop-recenter', 'crop-undo', 'crop-redo', 'crop-size-label',
  'crop-preset-free', 'crop-preset-1-1', 'crop-preset-4-3', 'crop-preset-16-9', 'crop-preset-center'];

for (const [nom, chemin] of Object.entries(PAGES)) {
  test(`Crop (${nom}) : gabarit fen-3d, id conserves`, () => {
    const html = readFileSync(chemin, 'utf8');
    const a = html.indexOf('id="modal-crop"');
    assert.ok(a > 0);
    const b = html.indexOf('id="modal-symmetrize"', a);
    const bloc = html.slice(a, b);
    assert.match(bloc, /class="modal-card fen-3d/);
    assert.match(bloc, /class="fen-corps"/);
    assert.match(bloc, /class="fen-form"/);
    assert.match(bloc, /id="crop-canvas-container" class="fen-apercu"/);
    for (const id of IDS) assert.ok(bloc.includes(`id="${id}"`), id);
    // les reglages sont dans la colonne de droite, apres l'apercu
    const iForm = bloc.indexOf('class="fen-form"');
    for (const id of ['crop-preset-free', 'crop-undo', 'crop-loupe-toggle']) assert.ok(bloc.indexOf(`id="${id}"`) > iForm, id);
    assert.ok(bloc.indexOf('id="crop-canvas-container"') < iForm);
    // pied : Annuler puis action
    assert.ok(bloc.indexOf('id="crop-cancel"') < bloc.indexOf('id="crop-apply"'));
    assert.doesNotMatch(bloc, /width:95vw/);
  });
}

for (const css of ['src/renderer/styles/index2.css', 'cloud/public/app/styles/index2.css']) {
  test(`Crop CSS (${css}) : bouton d'action pleine largeur`, () => {
    assert.match(readFileSync(css, 'utf8'), /#modal-crop \.modal-actions \.primary-btn \{ flex: 1 1 auto; \}/);
  });
}
