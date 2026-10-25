import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const racine = new URL('../../', import.meta.url);
const lire = (p) => readFileSync(new URL(p, racine), 'utf8');
const src = lire('src/renderer/lib/editeur-poids.js');
const web = lire('cloud/public/app/lib/editeur-poids.js');

test('editeur des poids : fichier identique site / bureau', () => {
  assert.equal(web, src);
});

test('editeur des poids : en-tete = titre + croix, outils dans la colonne de droite', () => {
  const tete = src.slice(src.indexOf('<div class="fen-tete">'), src.indexOf('<p class="modal-subtitle">'));
  for (const id of ['pp-tester', 'pp-squelette', 'pp-annuler', 'pp-refaire']) {
    assert.ok(!tete.includes(id), id + ' ne doit plus etre dans l en-tete');
    const i = src.indexOf('id="' + id + '"');
    assert.ok(i > src.indexOf('class="fen-form pp-form"'), id + ' dans la colonne de droite');
  }
  assert.ok(tete.includes('id="pp-close"'));
});

test('editeur des poids : barre de vues commune, plus de barre maison', () => {
  assert.ok(src.includes("from './barre-vues-3d.js'"));
  assert.ok(/creerBarreVues3D\(\$\('pp-vue'\)/.test(src));
  assert.ok(!src.includes('pp-vues3d'));
});

test('editeur des poids : pied avec action pleine largeur (site et bureau)', () => {
  for (const p of ['src/renderer/styles/index2.css', 'cloud/public/app/styles/index2.css']) {
    const css = lire(p);
    assert.ok(/LOT W32 : editeur des poids/.test(css), p);
    assert.ok(/#modal-poids-peau \.modal-card\.fen-3d \.modal-actions \.primary-btn \{ flex: 1 1 0; \}/.test(css), p);
  }
  for (const id of ['pp-cancel', 'pp-save', 'pp-vue', 'pp-canvas', 'pp-etat', 'pp-liste']) assert.ok(src.includes('id="' + id + '"'), id);
});
