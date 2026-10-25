// LOT W25 : la fenetre Paint Emissive (modes re-texture / remodeler une zone) adopte le gabarit .fen-3d
// (apercu a gauche, reglages en colonne a droite, pied Annuler + action), sur le bureau ET le site.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const PAGES = { bureau: 'src/renderer/index2.html', site: 'cloud/public/app/index.html' };
const IDS = ['pe-viewport-wrap', 'pe-canvas', 'pe-status', 'pe-mask-panel', 'pe-mask-prompt', 'pe-mask-strength',
  'pe-mask-strength-val', 'pe-clone-panel', 'pe-color', 'pe-intensity', 'pe-intensity-val', 'pe-brush-size',
  'pe-brush-size-val', 'pe-brush-opacity', 'pe-brush-opacity-val', 'pe-brush-falloff', 'pe-brush-falloff-val',
  'pe-mode-paint', 'pe-mode-erase', 'pe-loupe-toggle', 'pe-undo', 'pe-redo', 'pe-clear', 'pe-toggle-emissive',
  'pe-load-image-layer', 'pe-cancel', 'pe-apply-device'];

function fenetre(html) {
  const a = html.indexOf('<div id="modal-paint-emissive"');
  const b = html.indexOf('<!-- Magnifier loupe for the Paint-Emissive');
  assert.ok(a > 0 && b > a);
  return html.slice(a, b);
}

for (const [nom, chemin] of Object.entries(PAGES)) {
  test(`Paint Emissive (${nom}) : gabarit fen-3d`, () => {
    const f = fenetre(fs.readFileSync(chemin, 'utf8'));
    assert.match(f, /class="modal-card fen-3d"/);
    assert.match(f, /class="fen-corps"/);
    assert.match(f, /id="pe-viewport-wrap" class="fen-apercu"/);
    assert.match(f, /class="fen-form"/);
    assert.match(f, /id="pe-status" class="fen-apercu-etat"/);
    // pied : Annuler puis l'action
    assert.ok(f.indexOf('id="pe-cancel"') > 0 && f.indexOf('id="pe-cancel"') < f.indexOf('id="pe-apply-device"'));
    // l'apercu est a gauche de la colonne de reglages
    assert.ok(f.indexOf('pe-viewport-wrap') < f.indexOf('class="fen-form"'));
    for (const id of IDS) assert.ok(f.includes(`id="${id}"`), `id perdu : ${id}`);
    assert.ok(!/max-width:1400px; width:95vw/.test(f), 'ancienne carte large');
  });
}

test('Paint Emissive : pied pleine largeur dans les deux CSS', () => {
  for (const c of ['src/renderer/styles/index2.css', 'cloud/public/app/styles/index2.css']) {
    const css = fs.readFileSync(c, 'utf8');
    assert.match(css, /LOT W25 : fenetre Paint Emissive/);
    assert.match(css, /#modal-paint-emissive \.modal-actions \.primary-btn \{ flex: 1 1 0/);
  }
});

test('Paint Emissive (bureau) : le prix du bouton est repose apres le libelle', () => {
  const js = fs.readFileSync('src/renderer/index2.js', 'utf8');
  assert.match(js, /'pe-apply-device': \(\) =>/);
  assert.match(js, /LOT W25 : le libelle vient d'etre reecrit/);
});
