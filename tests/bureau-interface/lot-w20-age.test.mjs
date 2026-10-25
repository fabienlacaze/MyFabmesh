import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const FICHIERS = [
  ['site', 'cloud/public/app/index.html', 'cloud/public/app/styles/index2.css', 'cloud/public/app/index2.js'],
  ['bureau', 'src/renderer/index2.html', 'src/renderer/styles/index2.css', 'src/renderer/index2.js'],
];

for (const [nom, html, css, js] of FICHIERS) {
  const h = fs.readFileSync(html, 'utf8');
  const i = h.indexOf('id="modal-age"');
  const bloc = h.slice(i, h.indexOf('<!-- ====', i));
  test('Age ' + nom + ' : gabarit fen-3d, apercu a gauche, reglages a droite', () => {
    assert.ok(/class="modal-card fen-3d/.test(bloc));
    assert.ok(bloc.includes('fen-corps') && bloc.includes('fen-apercu') && bloc.includes('fen-form'));
    assert.ok(bloc.indexOf('fen-apercu') < bloc.indexOf('fen-form'));
    assert.ok(!bloc.includes('modal-with-image'));
  });
  test('Age ' + nom + ' : tous les id lus par le JS sont presents', () => {
    const src = fs.readFileSync(js, 'utf8');
    for (const id of ['age-source-img', 'age-slider', 'age-val', 'age-guide', 'age-cancel', 'age-go']) {
      assert.ok(src.includes("'" + id + "'"), id + ' lu par le JS');
      assert.ok(bloc.includes('id="' + id + '"'), id + ' dans le HTML');
    }
  });
  test('Age ' + nom + ' : pied avec bouton d action pleine largeur', () => {
    const c = fs.readFileSync(css, 'utf8');
    assert.ok(/#modal-age \.modal-actions \.primary-btn \{ flex: 1 1 auto; \}/.test(c));
  });
}
