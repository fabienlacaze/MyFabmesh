import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const cotes = [
  ['bureau', 'src/renderer/index2.html', 'src/renderer/index2.js'],
  ['site', 'cloud/public/app/index.html', 'cloud/public/app/index2.js'],
];
const fenetres = [
  ['modal-explode-options', 'ex3d', ['ex3d-frags', 'ex3d-frags-val', 'ex3d-modes', 'ex3d-fill', 'ex3d-cancel', 'ex3d-start']],
  ['modal-stages3d-options', 'bs3d', ['bs3d-count', 'bs3d-count-val', 'bs3d-mat-mode', 'bs3d-material', 'bs3d-mat-scaffold', 'bs3d-cancel', 'bs3d-start']],
];

for (const [nom, h, j] of cotes) {
  const html = fs.readFileSync(h, 'utf8');
  const js = fs.readFileSync(j, 'utf8');
  for (const [mid, cle, ids] of fenetres) {
    test(mid + ' : apercu 3D reel a gauche, pas une illustration (' + nom + ')', () => {
      const i = html.indexOf('id="' + mid + '"');
      assert.ok(i > 0);
      const fin = html.indexOf('<div class="modal-actions">', i);
      const bloc = html.slice(i, fin);
      assert.ok(!bloc.includes('fen-apercu-pictos'), 'illustration statique');
      assert.ok(bloc.includes('id="' + cle + '-canvas"'), 'canevas 3D');
      assert.ok(bloc.indexOf('id="' + cle + '-canvas"') < bloc.indexOf('class="fen-form"'), 'apercu avant les reglages');
      for (const id of ids.filter((x) => !(nom === 'site' && x === 'ex3d-fill'))) assert.ok(html.slice(i).includes('id="' + id + '"'), id);
    });
    test(mid + ' : l\'ouverture charge le maillage affiche (' + nom + ')', () => {
      assert.match(js, /async function _apercuMaillageFenetre\(cle\)/);
      assert.ok(js.includes("_apercuMaillageFenetre('" + cle + "');"));
      assert.match(js, /creerBarreVues3D\(canvas\.parentElement, e\.viewer/);
    });
  }
}
