import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const cotes = [
  ['bureau', 'src/renderer/index2.html', 'src/renderer/styles/index2.css'],
  ['site', 'cloud/public/app/index.html', 'cloud/public/app/styles/index2.css'],
];

for (const [nom, h, c] of cotes) {
  test('harmonisation finale : CSS commune (' + nom + ')', () => {
    const css = fs.readFileSync(c, 'utf8');
    const i = css.indexOf('HARMONISATION FINALE (25/10');
    assert.ok(i > 0, 'bloc present');
    const bloc = css.slice(i);
    // hauteur de carte commune pour Draw Mask et Paint Emissive
    assert.match(bloc, /\.modal-card\.fen-3d\.fen-editeur-2d, #modal-paint-emissive \.modal-card\.fen-3d \{ height: min\(94vh, 1000px\); \}/);
    // barre de vues : une ligne, centree sans translate
    assert.match(bloc, /\.mesh-toolbar\.fen \{ left: 0; right: 0; transform: none; margin: 0 auto; width: fit-content;/);
    // fenetre etroite : la carte defile, le pied reste atteignable
    assert.match(bloc, /@media \(max-width: 900px\)/);
    assert.match(bloc, /height: auto !important; max-height: 94vh !important; overflow-y: auto !important;/);
    assert.match(bloc, /\.modal-card\.fen-3d > \.modal-actions \{\s*position: sticky( !important)?;/);
    // la hauteur forcee de la colonne ne s'applique pas en une colonne (sinon la carte s'ecrase a 200 px)
    assert.match(bloc, /@media \(min-width: 901px\) \{\s*\.modal-card\.fen-3d\.fen-editeur-2d \.fen-corps/);
  });

  test('harmonisation finale : Recolor 3D et lancement au gabarit (' + nom + ')', () => {
    const html = fs.readFileSync(h, 'utf8');
    const i = html.indexOf('id="modal-recolor3d"');
    assert.ok(i > 0);
    const bloc = html.slice(i, html.indexOf('id="modal-recolor"', i));
    assert.match(bloc, /class="modal-card fen-3d"/);
    assert.ok(bloc.includes('class="fen-corps"') && bloc.includes('fen-apercu'));
    // les id lus par le JS sont conserves
    for (const id of ['r3-mode', 'r3-swatches', 'r3-strength', 'r3-strength-val', 'r3-hint', 'r3-cancel', 'r3-go'])
      assert.ok(bloc.includes('id="' + id + '"'), id);
    // pied : Annuler puis l'action
    assert.ok(bloc.indexOf('id="r3-cancel"') < bloc.indexOf('id="r3-go"'));
  });
}

test('pastille de credits sur toutes les fenetres .fen-3d (site)', () => {
  const js = fs.readFileSync('cloud/public/app/cloud-overrides.js', 'utf8');
  assert.match(js, /querySelectorAll\('\.modal-card\.fen-3d'\)\.forEach/);
  assert.match(js, /new MutationObserver\(\(muts\) =>/);
});
