// LOT W29 (25/10) : la fenetre d'edition de maillage (Sculpt / Paint / Select) suit le gabarit .fen-3d des outils :
// apercu a gauche, reglages en colonne a droite, pied Annuler + action. Les id lus par le JS doivent tous rester.
// Lancer : node --test tests/bureau-interface/lot-w29-edition-maillage.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PAGES = [
  ['site', 'cloud/public/app/index.html', 'cloud/public/app/index2.js'],
  ['bureau', 'src/renderer/index2.html', 'src/renderer/index2.js'],
];

function bloc(html) {
  const a = html.lastIndexOf('<div', html.indexOf('id="modal-mesh-edit"'));
  const b = html.indexOf('<!-- Global loupe magnifier', a);
  assert.ok(a > 0 && b > a, 'fenetre introuvable');
  return html.slice(a, b);
}

for (const [nom, h, j] of PAGES) {
  const html = readFileSync(join(RACINE, h), 'utf8');
  const js = readFileSync(join(RACINE, j), 'utf8');
  const blk = bloc(html);

  test(nom + ' : carte .fen-3d avec apercu a gauche et colonne a droite', () => {
    assert.match(blk, /class="modal-card fen-3d"/);
    assert.match(blk, /class="fen-corps"/);
    const iApercu = blk.indexOf('id="me-viewport"');
    const iPanneau = blk.indexOf('id="me-panel"');
    assert.ok(iApercu > 0 && iPanneau > iApercu, 'apercu avant le panneau de reglages');
    assert.match(blk, /id="me-viewport" class="fen-apercu"/);
    assert.match(blk, /id="me-panel" class="fen-form"/);
    assert.match(blk, /id="me-subtitle" class="modal-subtitle"/);
  });

  test(nom + ' : barre d\'outils et modes dans la colonne, pas dans l\'entete', () => {
    const tete = blk.slice(blk.indexOf('class="fen-tete"'), blk.indexOf('id="me-subtitle"'));
    for (const id of ['me-undo', 'me-redo', 'me-loupe-toggle', 'me-tool-sculpt', 'me-sym-x', 'me-brush-size', 'me-strength'])
      assert.ok(!tete.includes('id="' + id + '"'), id + ' ne doit plus etre dans l\'entete');
    const panneau = blk.slice(blk.indexOf('id="me-panel"'), blk.indexOf('class="modal-actions'));
    for (const id of ['me-undo', 'me-redo', 'me-loupe-toggle', 'me-tool-sculpt', 'me-tool-paint', 'me-tool-select', 'me-sym-x', 'me-brush-size', 'me-strength'])
      assert.ok(panneau.includes('id="' + id + '"'), id + ' dans la colonne de droite');
  });

  test(nom + ' : pied Annuler + action, et tous les id lus par le JS existent', () => {
    assert.match(blk, /<div class="modal-actions">\s*<button id="me-cancel"[^>]*>Cancel<\/button>\s*<button id="me-save"/);
    const ids = new Set();
    for (const m of js.matchAll(/getElementById\('(me-[a-z0-9-]+)'\)/g)) ids.add(m[1]);
    assert.ok(ids.size > 20);
    const manquants = [...ids].filter((i) => !blk.includes('id="' + i + '"') && !js.includes("'" + i + "'.createElement") && !new RegExp("id\\s*=\\s*['\"]" + i + "['\"]").test(js));
    // un id peut etre cree par le JS ; on ne refuse que ceux absents du HTML ET de toute creation dynamique
    assert.deepEqual(manquants, [], 'id perdus : ' + manquants.join(', '));
  });

  test(nom + ' : divs equilibres', () => {
    assert.equal((blk.match(/<div\b/g) || []).length, (blk.match(/<\/div>/g) || []).length);
  });
}

test('traduction du sous-titre dans les deux copies communes', () => {
  const a = readFileSync(join(RACINE, 'cloud/public/app/lang/_additions6.js'), 'utf8');
  const b = readFileSync(join(RACINE, 'src/renderer/lang/_additions6.js'), 'utf8');
  assert.equal(a, b);
  assert.ok(a.includes('"Sculpt, paint or select faces on the model, then save the result as a new version."'));
});
