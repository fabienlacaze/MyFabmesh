import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const cotes = [
  ['bureau', 'src/renderer/index2.html', 'src/renderer/index2.js', 'src/renderer/styles/index2.css'],
  ['site', 'cloud/public/app/index.html', 'cloud/public/app/index2.js', 'cloud/public/app/styles/index2.css'],
];

for (const [nom, h, j, c] of cotes) {
  test('Segment parts : fenetre au gabarit fen-3d avec apercu 3D (' + nom + ')', () => {
    const html = fs.readFileSync(h, 'utf8');
    const i = html.indexOf('id="modal-segment-parts"');
    assert.ok(i > 0, 'fenetre statique absente');
    const bloc = html.slice(i, html.indexOf('id="modal-name-parts"', i));
    assert.match(bloc, /class="modal-card fen-3d"/);
    for (const id of ['seg-sub', 'seg-canvas', 'seg-gran', 'seg-gran-label', 'seg-cancel', 'seg-go'])
      assert.ok(bloc.includes('id="' + id + '"'), id);
    assert.ok(bloc.indexOf('id="seg-sub"') < bloc.indexOf('class="fen-corps"'));
    assert.ok(bloc.indexOf('id="seg-canvas"') < bloc.indexOf('id="seg-gran"'), 'apercu a gauche, reglages a droite');
    assert.ok(bloc.indexOf('id="seg-cancel"') < bloc.indexOf('id="seg-go"'));
    const js = fs.readFileSync(j, 'utf8');
    assert.match(js, /_p3ChargerApercu\('seg', 'seg-canvas', meshPath\)/);
    assert.ok(!js.includes('<svg viewBox="0 0 120 64"'), 'plus d illustration a la place de l apercu');
  });

  test('Name the zones : fenetre au gabarit fen-3d avec apercu 3D (' + nom + ')', () => {
    const html = fs.readFileSync(h, 'utf8');
    const i = html.indexOf('id="modal-name-parts"');
    assert.ok(i > 0, 'fenetre statique absente');
    const bloc = html.slice(i, i + 2500);
    assert.match(bloc, /class="modal-card fen-3d"/);
    for (const id of ['np-canvas', 'np-cats', 'np-cancel', 'np-go'])
      assert.ok(bloc.includes('id="' + id + '"'), id);
    assert.ok(bloc.indexOf('id="np-canvas"') < bloc.indexOf('id="np-cats"'));
    const js = fs.readFileSync(j, 'utf8');
    assert.match(js, /_p3ChargerApercu\('np', 'np-canvas', meshPath\)/);
    assert.ok(!js.includes('id="np-cancel" class="ghost-btn" style'), 'ancienne boite en ligne supprimee');
    assert.match(js, /_openNameCategoryModal\(_nameCategoryFromAsset\(projAsset\), meshPath\)/);
    const css = fs.readFileSync(c, 'utf8');
    assert.match(css, /LOT P3 \(25\/10\)/);
    assert.match(css, /#modal-name-parts \.modal-card\.fen-3d \.modal-actions \.primary-btn \{ flex: 1 1 auto; \}/);
  });
}
