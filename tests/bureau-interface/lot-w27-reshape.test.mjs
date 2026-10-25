import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const CIBLES = [
  { nom: 'site', html: 'cloud/public/app/index.html', js: 'cloud/public/app/index2.js', css: 'cloud/public/app/styles/index2.css' },
  { nom: 'bureau', html: 'src/renderer/index2.html', js: 'src/renderer/index2.js', css: 'src/renderer/styles/index2.css' },
];
const lire = (p) => fs.readFileSync(p, 'utf8');

for (const c of CIBLES) {
  test(`${c.nom} : Reshape etape 3D = apercu commun, barre commune, pied pleine largeur`, () => {
    const html = lire(c.html), js = lire(c.js), css = lire(c.css);
    const i = html.indexOf('id="rrx-3d-stage"');
    const balise = html.slice(i, html.indexOf('>', i));
    assert.ok(!/aspect-ratio|min\(88vh/.test(balise), 'plus de taille en dur');
    assert.ok(!html.includes('id="rrx-3d-presets"'));
    for (const id of ['rrx-3d-canvas', 'rrx-3d-info', 'rrx-use-view', 'rrx-change-view', 'rrx-apply', 'rrx-cancel', 'rrx-3d-panel']) assert.ok(html.includes(`id="${id}"`), id);
    assert.match(js, /creerBarreVues3D\(\$\('rrx-3d-stage'\)/);
    assert.match(css, /LOT W27[\s\S]*#modal-region-retex \.modal-actions \.primary-btn \{ flex: 1 1 0/);
  });
}
