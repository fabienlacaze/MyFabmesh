// LOT W16 : la fenetre Habits / Outfit adopte le gabarit .fen-3d (apercu a gauche, reglages a droite, pied pleine largeur).
// Lancer : node --test tests/bureau-interface/lot-w16-outfit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lire = (p) => readFileSync(join(RACINE, p), 'utf-8');
const PAGES = { bureau: 'src/renderer/index2.html', web: 'cloud/public/app/index.html' };
const CSS = { bureau: 'src/renderer/styles/index2.css', web: 'cloud/public/app/styles/index2.css' };
const IDS = ['of-source-img', 'of-spinner', 'of-spinner-label', 'of-mode', 'of-pieces-box', 'of-completer', 'of-recadrer', 'of-absentes', 'of-cancel', 'of-go'];

for (const [cible, page] of Object.entries(PAGES)) {
  test('Outfit ' + cible + ' : gabarit fen-3d, ids conserves', () => {
    const h = lire(page).replace(/\r\n/g, '\n');
    const a = h.indexOf('id="modal-outfit"');
    assert.ok(a > 0);
    const blk = h.slice(a, h.indexOf('id="modal-', a + 30));
    assert.match(blk, /modal-card fen-3d/);
    assert.match(blk, /class="fen-corps"/);
    assert.match(blk, /class="fen-apercu"/);
    assert.match(blk, /class="fen-form"/);
    assert.doesNotMatch(blk, /modal-with-image|modal-image-side|modal-card-wide/);
    // l'image source est dans l'apercu, le pied est apres le corps
    assert.ok(blk.indexOf('class="fen-apercu"') < blk.indexOf('of-source-img'));
    assert.ok(blk.indexOf('class="fen-form"') < blk.indexOf('class="modal-actions"'));
    for (const id of IDS) assert.ok(blk.includes('id="' + id + '"'), 'id perdu : ' + id);
  });
  test('Outfit ' + cible + ' : regles CSS du lot', () => {
    assert.match(lire(CSS[cible]), /LOT W16[\s\S]*#modal-outfit \.fen-apercu > img/);
  });
}
