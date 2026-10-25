// LOT W34 (25/10) : fenetres d'animation au gabarit commun (apercu a gauche, colonne a droite, pied pleine largeur).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lire = (f) => readFileSync(join(RACINE, f), 'utf8').replace(/\r\n/g, '\n');
const bloc = (h, id, fin) => { const i = h.indexOf(`<div id="${id}"`); assert.ok(i > 0, id); return h.slice(i, h.indexOf(fin, i)); };
for (const [html, css] of [['cloud/public/app/index.html', 'cloud/public/app/styles/index2.css'], ['src/renderer/index2.html', 'src/renderer/styles/index2.css']]) {
  test(`${html} : Generate Animation au gabarit fen-3d, ids conserves`, () => {
    const b = bloc(lire(html), 'modal-anim-gen', 'id="modal-confirm"');
    assert.ok(b.includes('class="modal-card fen-3d fen-anim-gen"'));
    assert.ok(b.includes('<div class="fen-corps">') && b.includes('<div class="fen-form">'));
    assert.ok(b.indexOf('id="modal-anim-apercu"') < b.indexOf('class="fen-form"') && b.indexOf('class="fen-form"') < b.indexOf('id="modal-anim-types"'), 'apercu du rig a gauche (LOT P4), choix dans la colonne de droite');
    assert.equal((b.match(/name="modal-anim-type"/g) || []).length, 14);
    for (const id of ['modal-anim-cancel', 'modal-anim-go']) assert.ok(b.includes(`id="${id}"`));
    assert.ok(!b.includes('width:440px'));
  });
  // 25/10 : la fenetre « Tache en cours » (detail d'un travail) a retrouve sa mise en forme d'origine (la conversion au gabarit faisait deborder l'apercu sur les boutons)
  test(`${css} : bloc LOT W34 (pied pleine largeur)`, () => {
    const s = lire(css);
    assert.ok(s.includes('LOT W34'));
    assert.ok(s.includes('#modal-anim-gen .modal-actions .primary-btn'));
    assert.ok(s.includes('flex: 1 1 auto'));
  });
}
test('traduction de la phrase de la colonne', () => {
  const s = lire('src/renderer/lang/_additions6.js');
  assert.ok(s.includes('"Animations marked EXISTING already have a version.'));
});
