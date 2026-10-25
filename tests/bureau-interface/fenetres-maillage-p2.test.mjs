import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// LOT P2 (25/10, user : « il faut une fenetre pour TOUS les outils ») : Recolor 3D et les outils de maillage a
// fenetre de lancement (Sharpen texture, Detail++) s'ouvrent dans le gabarit .fen-3d avec le MODELE reel a gauche.
const cotes = [
  ['bureau', 'src/renderer/index2.html', 'src/renderer/index2.js', 'src/renderer/styles/index2.css'],
  ['site', 'cloud/public/app/index.html', 'cloud/public/app/index2.js', 'cloud/public/app/styles/index2.css'],
];

for (const [nom, h, j, c] of cotes) {
  test('Recolor 3D : gabarit fen-3d avec apercu du modele (' + nom + ')', () => {
    const html = fs.readFileSync(h, 'utf8');
    const i = html.indexOf('id="modal-recolor3d"');
    assert.ok(i > 0);
    const bloc = html.slice(i, html.indexOf('id="modal-recolor"', i));
    assert.match(bloc, /class="modal-card fen-3d"/);
    // aide sous le titre, avant le corps ; apercu a gauche, reglages a droite, pied apres
    assert.ok(bloc.indexOf('modal-subtitle') < bloc.indexOf('fen-corps'));
    assert.ok(bloc.indexOf('id="r3-canvas"') < bloc.indexOf('id="r3-mode"'));
    assert.ok(bloc.indexOf('id="r3-mode"') < bloc.indexOf('class="modal-actions"'));
    assert.match(bloc, /id="r3-credits"/);
    // tous les id lus par le JS sont conserves
    for (const id of ['r3-mode', 'r3-swatches', 'r3-strength', 'r3-strength-val', 'r3-hint', 'r3-cancel', 'r3-go', 'r3-etat'])
      assert.ok(bloc.includes('id="' + id + '"'), id);
    const js = fs.readFileSync(j, 'utf8');
    assert.match(js, /_apercuMaillageMontrer\('r3-canvas', 'r3-etat'\)/);
    assert.match(js, /_r3PoserPrix\(\);/);
    const css = fs.readFileSync(c, 'utf8');
    assert.match(css, /#modal-recolor3d \.modal-actions \.primary-btn \{ flex: 1 1 auto; \}/);
  });

  test('fenetre de lancement : apercu 3D du modele pour Sharpen texture (' + nom + ')', () => {
    const html = fs.readFileSync(h, 'utf8');
    const i = html.indexOf('id="modal-lancement"');
    const bloc = html.slice(i, html.indexOf('FENETRE STYLE', i));
    assert.ok(bloc.includes('id="lct-canvas"'));
    assert.ok(bloc.includes('id="lct-etat"'));
    const js = fs.readFileSync(j, 'utf8');
    assert.match(js, /'ws-mesh-enhance-tex-btn': \{[^}]*apercu: 'mesh'/);
    assert.match(js, /_apercuMaillageMontrer\('lct-canvas', 'lct-etat'\)/);
    assert.match(js, /classList\.toggle\('fen-3d', !!src \|\| mesh\)/);
  });
}

test('Detail++ : apercu 3D du modele (bureau)', () => {
  const js = fs.readFileSync('src/renderer/index2.js', 'utf8');
  assert.match(js, /'ws-mesh-detail-synth-btn': \{[^}]*apercu: 'mesh'/);
});
