// LOT W30 : la fenetre Redimensionner (#modal-resize) adopte le gabarit .fen-3d (apercu a gauche, colonne a droite, pied commun).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const IDS = ['rz-close', 'rz-viewport', 'rz-canvas', 'rz-readout', 'rz-hint', 'rz-uniform', 'rz-unit', 'rz-dim-x', 'rz-dim-y', 'rz-dim-z',
  'rz-reset', 'rz-x2', 'rz-half', 'rz-mode-scale', 'rz-mode-rotate', 'rz-rot-x', 'rz-rot-y', 'rz-rot-z', 'rz-rx90', 'rz-ry90', 'rz-rz90', 'rz-cancel', 'rz-apply'];

for (const [nom, chemin] of [['bureau', 'src/renderer/index2.html'], ['site', 'cloud/public/app/index.html']]) {
  test('Redimensionner (' + nom + ') : gabarit fen-3d', () => {
    const h = readFileSync(join(RACINE, chemin), 'utf8');
    const i = h.indexOf('id="modal-resize"');
    assert.ok(i > 0);
    const bloc = h.slice(i, i + 12000);
    assert.match(bloc, /<div class="modal-card fen-3d">/);
    assert.match(bloc, /<div class="fen-corps">/);
    assert.match(bloc, /<div id="rz-viewport" class="fen-apercu">/);
    assert.match(bloc, /<div class="fen-form">/);
    assert.match(bloc, /id="rz-hint" class="fen-apercu-etat"/);
    assert.doesNotMatch(bloc, /max-width:1100px/);
    for (const id of IDS) assert.ok(bloc.includes('id="' + id + '"'), 'id perdu : ' + id);
    // pied : Annuler puis Appliquer
    assert.ok(bloc.indexOf('id="rz-cancel"') < bloc.indexOf('id="rz-apply"'));
  });
}
