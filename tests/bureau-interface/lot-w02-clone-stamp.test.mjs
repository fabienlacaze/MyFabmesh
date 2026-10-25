// LOT W02 (25/10) : Clone Stamp au gabarit .fen-3d (apercu a gauche, reglages en colonne a droite, pied Annuler + action).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lire = (r) => readFileSync(join(RACINE, r), 'utf-8').replace(/\r\n/g, '\n');
const CIBLES = { bureau: ['src/renderer/index2.html', 'src/renderer/styles/index2.css'], site: ['cloud/public/app/index.html', 'cloud/public/app/styles/index2.css'] };
const IDS = ['clone-modal-close', 'clone-canvas-container', 'clone-canvas', 'clone-brush-cursor', 'clone-source-marker', 'clone-status', 'clone-brush-size',
  'clone-brush-val', 'clone-hardness', 'clone-hardness-val', 'clone-flip-toggle', 'clone-source-toggle', 'clone-loupe-toggle', 'clone-recenter',
  'clone-undo', 'clone-redo', 'clone-reset', 'clone-error', 'clone-cancel', 'clone-save'];

for (const [nom, [h, c]] of Object.entries(CIBLES)) {
  const html = lire(h), css = lire(c);
  const a = html.indexOf('<div id="clone-modal"');
  const bloc = html.slice(a, html.indexOf('<!-- Selection / Cut-Paste modal'));

  test(`${nom} : Clone Stamp utilise la carte .fen-3d (corps a deux colonnes, apercu a gauche)`, () => {
    assert.match(bloc, /class="modal-card fen-3d fen-2d"/);
    assert.match(bloc, /<div class="fen-corps">\s*<div id="clone-canvas-container" class="fen-apercu/);
    assert.match(bloc, /<div class="fen-form">/);
    assert.ok(bloc.indexOf('clone-canvas-container') < bloc.indexOf('class="fen-form"'), 'apercu avant les reglages');
    assert.doesNotMatch(bloc, /class="modal-content"|width:95vw/);
  });
  test(`${nom} : tous les id lus par le JS sont conserves`, () => {
    for (const id of IDS) assert.ok(bloc.includes('id="' + id + '"'), id);
  });
  test(`${nom} : reglages dans la colonne de droite, pied Annuler puis action en fin de carte`, () => {
    const form = bloc.slice(bloc.indexOf('class="fen-form"'));
    for (const id of ['clone-brush-size', 'clone-hardness', 'clone-flip-toggle', 'clone-undo', 'clone-reset']) assert.ok(form.includes('id="' + id + '"'), id);
    assert.match(bloc, /<div class="modal-actions fen-pied-editeur">\s*<button id="clone-cancel" class="ghost-btn">Cancel<\/button>\s*<button id="clone-save" class="primary-btn">/);
    assert.ok(bloc.indexOf('fen-pied-editeur') > bloc.indexOf('clone-reset'));
  });
  test(`${nom} : CSS du pied (action sur toute la largeur restante) et traductions`, () => {
    assert.match(css, /LOT W02/);
    assert.match(css, /#clone-modal \.modal-actions\.fen-pied-editeur \.primary-btn \{ flex: 1 1 0; \}/);
    const l = lire(h.replace(/[^/]+$/, 'lang/_additions6.js'));
    for (const k of ['Source', 'History']) assert.ok(l.includes('"' + k + '": ['), k);
  });
}
