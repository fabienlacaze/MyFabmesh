import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const FICHIERS = [
  ['site', 'cloud/public/app/index.html', 'cloud/public/app/index2.js', 'cloud/public/app/styles/index2.css'],
  ['bureau', 'src/renderer/index2.html', 'src/renderer/index2.js', 'src/renderer/styles/index2.css'],
];
const IDS = ['lm-fs-close', 'lm-fs-info', 'lm-fs-canvas', 'lm-fs-canvas-b', 'lm-fs-instruction', 'pts-ajout-options',
  'pts-ajout-coller', 'pts-ajout-centrer', 'lm-fs-undo', 'lm-fs-redo', 'pts-reinit', 'pts-ajouter', 'pts-regenerer',
  'pts-enregistrer-sans-ia', 'pts-voir-os', 'pts-liste', 'lm-fs-pane-label-a', 'lm-fs-pane-label-b', 'pts-annuler'];

for (const [nom, html, js, css] of FICHIERS) {
  test(`points du squelette (${nom}) : gabarit fen-3d`, () => {
    const h = fs.readFileSync(html, 'utf8');
    const a = h.indexOf('id="lm-fullscreen"');
    const bloc = h.slice(a, h.indexOf('3D LIGHTBOX', a));
    assert.match(bloc, /class="modal-card fen-3d/);
    assert.match(bloc, /class="fen-tete"/);
    assert.match(bloc, /class="fen-corps"/);
    assert.match(bloc, /class="fen-apercu/);
    assert.match(bloc, /class="modal-actions"/);
    for (const id of IDS) assert.ok(bloc.includes(`id="${id}"`), `id perdu : ${id}`);
    // le pied : Annuler puis l'action principale
    const pied = bloc.slice(bloc.indexOf('class="modal-actions"'));
    assert.ok(pied.indexOf('pts-annuler') < pied.indexOf('pts-regenerer'));
    // chaque id lu par le JS pour cette fenetre existe
    const j = fs.readFileSync(js, 'utf8');
    assert.ok(j.includes("getElementById('pts-annuler')"));
    assert.ok(fs.readFileSync(css, 'utf8').includes('LOT W33'));
  });
}
