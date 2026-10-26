import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// 26/10 : fenetres d'outils (.fen-3d) a MOINS de 900 px (tablette, fenetre etroite, telephone) :
// le CORPS defile, le PIED reste visible en bas, l'apercu garde ~40 vh, un degrade signale le defilement ;
// Extend et Color Picker ont une colonne de droite renseignee.
const cotes = [
  ['bureau', 'src/renderer/index2.html', 'src/renderer/styles/index2.css', 'src/renderer/index2.js', 'src/renderer/lang/_additions6.js'],
  ['site', 'cloud/public/app/index.html', 'cloud/public/app/styles/index2.css', 'cloud/public/app/index2.js', 'cloud/public/app/lang/_additions6.js'],
];

for (const [nom, h, c, j, l] of cotes) {
  test('fenetres etroites : corps qui defile, pied fixe, indice de defilement (' + nom + ')', () => {
    const css = fs.readFileSync(c, 'utf8').replace(/\r\n/g, '\n');
    const i = css.indexOf('/* 3. Fenetre etroite (< 900 px, une colonne) — 26/10');
    assert.ok(i > 0, 'bloc 26/10 present');
    const bloc = css.slice(i, css.indexOf('/* RESTAURATION (25/10)', i));
    assert.match(bloc, /@media \(max-width: 900px\)/);
    assert.match(bloc, /--vz-h-corps: clamp\(170px, 40vh, 420px\)/);
    // la carte ne defile plus : son corps oui
    assert.match(bloc, /\.modal-card\.fen-3d \{\s*height: auto !important; max-height: 94vh !important; overflow: hidden !important;/);
    assert.match(bloc, /\.fen-corps \{[^}]*flex: 1 1 auto !important; min-height: 0 !important;[^}]*overflow-y: auto;/);
    // pied : plus colle au bord ni sticky, toujours dans la carte
    assert.match(bloc, /> \.modal-actions \{\s*position: static !important;/);
    assert.doesNotMatch(bloc, /position: sticky/);
    // indice : degrade « scroll » en haut et en bas + barre fine coloree
    assert.match(bloc, /radial-gradient\(farthest-side at 50% 100%/);
    assert.match(bloc, /scrollbar-width: thin/);
  });

  test('fenetres etroites : Extend detaille ses valeurs, Color Picker complete sa colonne (' + nom + ')', () => {
    const html = fs.readFileSync(h, 'utf8');
    const js = fs.readFileSync(j, 'utf8');
    const t = fs.readFileSync(l, 'utf8');
    assert.match(html, /id="lct-details"/);
    for (const id of ['cpick-hsl', 'cpick-pos', 'cpick-dim']) assert.ok(html.includes('id="' + id + '"'), id);
    assert.match(js, /action: 'Extend', apercu: 'image', details: 'extend'/);
    assert.match(js, /function _lctDetails\(def, img\)/);
    assert.match(js, /_lctDetails\(def, src \? document\.getElementById\('lct-image'\) : null\)/);
    // meme calcul que l'operation (meshyAPI-cloud : floor(max(w, h) * 0.15) de chaque cote)
    assert.match(js, /Math\.floor\(Math\.max\(w, h\) \* 0\.15\)/);
    assert.match(js, /cpick-hsl/);
    for (const k of ['Margin', 'Current size', 'New size', 'Position', 'Image size', 'Click to copy the HEX value.']) {
      assert.ok(t.includes('"' + k + '":'), 'traduction ' + k);
    }
  });
}

test('fenetres etroites : les deux plateformes ont le meme bloc CSS', () => {
  const lire = (p) => { const s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n'); const i = s.indexOf('/* 3. Fenetre etroite (< 900 px, une colonne) — 26/10'); return s.slice(i, s.indexOf('/* RESTAURATION (25/10)', i)); };
  assert.equal(lire('src/renderer/styles/index2.css'), lire('cloud/public/app/styles/index2.css'));
});
