// LOT W22 (25/10) : fenetre de lancement (Sym. auto et outils a un clic) au gabarit commun des outils.
// Verifie, sur le bureau ET le site : ids conserves, aide sous le titre, pastille de credits dans l'entete,
// pied Annuler + action, regles CSS de la grande carte, helper JS present.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const R = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CIBLES = [
  { nom: 'bureau', html: 'src/renderer/index2.html', js: 'src/renderer/index2.js', css: 'src/renderer/styles/index2.css' },
  { nom: 'site', html: 'cloud/public/app/index.html', js: 'cloud/public/app/index2.js', css: 'cloud/public/app/styles/index2.css' },
];
const lire = (p) => readFileSync(join(R, p), 'utf-8').replace(/\r\n/g, '\n');

for (const c of CIBLES) {
  test(`${c.nom} : fenetre de lancement au gabarit commun`, () => {
    const h = lire(c.html);
    const debut = h.indexOf('id="modal-lancement"');
    assert.ok(debut > 0);
    const fenetre = h.slice(debut, h.indexOf('FENETRE STYLE', debut));
    for (const id of ['lct-titre', 'lct-fermer', 'lct-corps', 'lct-apercu', 'lct-image', 'lct-texte', 'lct-annuler', 'lct-lancer', 'lct-credits', 'lct-credits-val']) {
      assert.ok(fenetre.includes(`id="${id}"`), `id ${id} conserve`);
    }
    // l'aide est SOUS le titre (avant le corps), pas dans la colonne de droite
    assert.ok(fenetre.indexOf('id="lct-texte"') < fenetre.indexOf('id="lct-corps"'), 'aide sous le titre');
    // la pastille de credits est dans l'entete
    assert.ok(fenetre.indexOf('id="lct-credits"') < fenetre.indexOf('id="lct-corps"'), 'pastille dans l\'entete');
    assert.ok(fenetre.indexOf('id="lct-annuler"') < fenetre.indexOf('id="lct-lancer"'), 'Annuler puis action');
    const js = lire(c.js);
    assert.ok(js.includes('function _lctPastilleEntete'), 'helper de la pastille');
    assert.ok(js.includes('_lctPastilleEntete('), 'helper appele');
    const css = lire(c.css);
    assert.ok(css.includes('LOT W22'), 'bloc CSS du lot');
    assert.match(css, /lct-carte:not\(:has\(\.fen-corps\.sans-apercu\)\) \{ width: min\(1700px, 97vw\)/);
    assert.match(css, /\.modal-actions \.primary-btn \{ flex: 1 1 auto; \}/);
  });
}
