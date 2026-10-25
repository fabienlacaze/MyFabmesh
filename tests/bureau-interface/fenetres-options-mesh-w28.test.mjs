// LOT W28 : Explosion et Etapes de construction 3D au gabarit .fen-3d (site ET bureau).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const FICHIERS = [
  ['site', 'cloud/public/app/index.html', 'cloud/public/app/styles/index2.css'],
  ['bureau', 'src/renderer/index2.html', 'src/renderer/styles/index2.css'],
];
const IDS = {
  'modal-explode-options': ['ex3d-frags', 'ex3d-frags-val', 'ex3d-modes', 'ex3d-cancel', 'ex3d-start'],
  'modal-stages3d-options': ['bs3d-count', 'bs3d-count-val', 'bs3d-mat-mode', 'bs3d-material', 'bs3d-mat-scaffold', 'bs3d-cancel', 'bs3d-start'],
};

function bloc(html, id) {
  const i = html.indexOf('id="' + id + '"');
  assert.ok(i > 0, id + ' absent');
  const fin = html.indexOf('<div id="modal-', i + 20);
  return html.slice(i, fin > 0 ? fin : undefined);
}

for (const [nom, h, c] of FICHIERS) {
  const html = fs.readFileSync(h, 'utf8');
  const css = fs.readFileSync(c, 'utf8');
  for (const [modal, ids] of Object.entries(IDS)) {
    test(nom + ' ' + modal + ' : gabarit fen-3d', () => {
      const b = bloc(html, modal);
      assert.match(b, /modal-card fen-3d/);
      assert.match(b, /class="fen-corps"/);
      // LOT P1 (25/10) : explosion et etudes de construction ont un apercu 3D reel (canevas) au lieu de l'illustration
      if (modal === 'modal-explode-options' || modal === 'modal-stages3d-options') assert.match(b, /class="fen-apercu"><canvas id="(ex3d|bs3d)-canvas"/);
      else assert.match(b, /class="fen-apercu fen-apercu-pictos"/);
      assert.match(b, /class="fen-form"/);
      assert.ok(b.indexOf('fen-form') < b.indexOf('modal-actions'), 'pied apres le formulaire');
      for (const id of ids) assert.ok(b.includes('id="' + id + '"'), 'id perdu : ' + id);
    });
  }
  test(nom + ' CSS : action principale sur toute la largeur du pied', () => {
    assert.match(css, /\.modal-card\.fen-3d \.modal-actions \.primary-btn\s*\{\s*flex:\s*1 1 auto/);
  });
}
