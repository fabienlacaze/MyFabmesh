// Lot W15 (25/10) : la fenetre Auto Inpaint suit le gabarit commun des outils (.modal-card.fen-3d : apercu a gauche, colonne .fen-form, pied).
// Echoue sur l'ancien code (carte .modal-card-wide / .modal-with-image).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CIBLES = [
  { nom: 'bureau', html: 'src/renderer/index2.html', js: 'src/renderer/index2.js' },
  { nom: 'site', html: 'cloud/public/app/index.html', js: 'cloud/public/app/index2.js' },
];

function fenetre(html) {
  const a = html.indexOf('id="modal-auto-inpaint"');
  assert.ok(a > 0, 'fenetre absente');
  const b = html.indexOf('id="ai-go"', a);
  return html.slice(a, b + 200);
}

for (const c of CIBLES) {
  test('Auto Inpaint (' + c.nom + ') : gabarit fen-3d, apercu et colonne', () => {
    const html = readFileSync(join(RACINE, c.html), 'utf-8');
    const f = fenetre(html);
    assert.match(f, /class="modal-card fen-3d/);
    assert.match(f, /class="fen-corps"/);
    assert.match(f, /class="fen-apercu/);
    assert.match(f, /class="fen-form/);
    assert.doesNotMatch(f, /modal-card-wide|modal-with-image/);
    assert.ok(f.indexOf('id="ai-cancel"') < f.indexOf('id="ai-go"'), 'Annuler avant Appliquer');
  });
  test('Auto Inpaint (' + c.nom + ') : tous les id lus par le JS existent', () => {
    const html = readFileSync(join(RACINE, c.html), 'utf-8');
    const js = readFileSync(join(RACINE, c.js), 'utf-8');
    const f = fenetre(html);
    const ids = new Set([...js.matchAll(/getElementById\('(ai-[a-z-]+)'\)/g)].map((m) => m[1]));
    assert.ok(ids.size >= 8);
    for (const id of ids) {
      // ai-precision n'existe que sur le bureau ; le reste doit etre present
      if (id === 'ai-precision' || id === 'ai-precision-val') { if (c.nom === 'site') continue; }
      assert.ok(f.includes('id="' + id + '"'), 'id manquant : ' + id);
    }
  });
}
