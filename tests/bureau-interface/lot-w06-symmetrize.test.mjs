// LOT W06 (25/10) : la fenetre Symmetrize adopte le gabarit commun (carte .fen-3d, apercu a gauche, reglages a droite, pied).
// Lancer : node --test tests/bureau-interface/lot-w06-symmetrize.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lire = (f) => readFileSync(join(RACINE, f), 'utf8').replace(/\r\n/g, '\n');
const COTES = [
  { nom: 'bureau', html: 'src/renderer/index2.html', js: 'src/renderer/index2.js', css: 'src/renderer/styles/index2.css' },
  { nom: 'site', html: 'cloud/public/app/index.html', js: 'cloud/public/app/index2.js', css: 'cloud/public/app/styles/index2.css' },
];
const IDS = ['sym-close', 'sym-dir-lr', 'sym-dir-rl', 'sym-mode-full', 'sym-mode-mask', 'sym-brush-label', 'sym-brush-size',
  'sym-brush-val', 'sym-paint-mode', 'sym-erase-mode', 'sym-loupe-toggle', 'sym-recenter', 'sym-undo', 'sym-redo', 'sym-reset',
  'sym-canvas-container', 'sym-canvas', 'sym-overlay', 'sym-brush-cursor', 'sym-cancel', 'sym-apply'];

for (const c of COTES) {
  test(`${c.nom} : Symmetrize au gabarit fen-3d, tous les id conserves`, () => {
    const html = lire(c.html);
    const a = html.indexOf('id="modal-symmetrize"');
    assert.ok(a > 0);
    const bloc = html.slice(a, html.indexOf('<!-- Paint Tools modal -->', a));
    assert.match(bloc, /class="modal-card fen-3d/);
    assert.match(bloc, /class="fen-corps"/);
    assert.match(bloc, /class="fen-apercu"/);
    assert.match(bloc, /class="fen-form"/);
    assert.ok(bloc.indexOf('fen-apercu') < bloc.indexOf('fen-form'), 'apercu a gauche, reglages apres');
    assert.ok(bloc.indexOf('sym-cancel') < bloc.indexOf('sym-apply'));
    for (const id of IDS) assert.ok(bloc.includes(`id="${id}"`), `id perdu : ${id}`);
    // le canevas n'est plus precede d'une barre d'outils au-dessus
    assert.ok(bloc.indexOf('fen-corps') < bloc.indexOf('sym-dir-lr'));
    // chaque id lu par le JS existe dans le HTML
    const js = lire(c.js);
    for (const m of js.matchAll(/getElementById\('(sym-[a-z-]+)'\)/g)) assert.ok(html.includes(`id="${m[1]}"`), `JS lit ${m[1]} absent du HTML`);
  });
  test(`${c.nom} : regles CSS du lot`, () => {
    assert.match(lire(c.css), /LOT W06[\s\S]*#modal-symmetrize \.sym-conteneur/);
  });
}
