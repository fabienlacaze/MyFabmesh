import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const cotes = [
  ['bureau', 'src/renderer/index2.html', 'src/renderer/index2.js', 'src/renderer/styles/index2.css'],
  ['site', 'cloud/public/app/index.html', 'cloud/public/app/index2.js', 'cloud/public/app/styles/index2.css'],
];

for (const [nom, h, j, c] of cotes) {
  test('fenetre de lancement au gabarit fen-3d (' + nom + ')', () => {
    const html = fs.readFileSync(h, 'utf8');
    const i = html.indexOf('id="modal-lancement"');
    assert.ok(i > 0);
    const bloc = html.slice(i, html.indexOf('FENETRE STYLE', i));
    assert.match(bloc, /class="modal-card fen-3d lct-carte"/);
    // la phrase d'aide est sous le titre, avant le corps
    assert.ok(bloc.indexOf('id="lct-texte"') < bloc.indexOf('id="lct-corps"'));
    for (const id of ['lct-titre', 'lct-fermer', 'lct-corps', 'lct-apercu', 'lct-image', 'lct-annuler', 'lct-lancer'])
      assert.ok(bloc.includes('id="' + id + '"'), id);
    const js = fs.readFileSync(j, 'utf8');
    assert.match(js, /classList\.toggle\('fen-3d', !!src( \|\| mesh)?\)/);
    const css = fs.readFileSync(c, 'utf8');
    assert.match(css, /#modal-lancement \.modal-card\.fen-3d \.modal-actions \.primary-btn \{ flex: 1 1 auto; \}/);
  });
}
