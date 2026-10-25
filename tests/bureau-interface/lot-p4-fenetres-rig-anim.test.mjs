// LOT P4 (25/10) : Re-skin only, Test animation, Import GLB et Add Animation s'ouvrent dans la fenetre commune .fen-3d
// (apercu REEL du rig a gauche, colonne a droite, pied Annuler + action), sur le bureau ET le site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lire = (f) => readFileSync(join(RACINE, f), 'utf8').replace(/\r\n/g, '\n');
const bloc = (h, id) => { const i = h.indexOf(`<div id="${id}"`); assert.ok(i > 0, id); return h.slice(i, h.indexOf('\n    </div>\n', i)); };
const PLATEFORMES = [
  ['bureau', 'src/renderer/index2.html', 'src/renderer/index2.js', 'src/renderer/styles/index2.css'],
  ['site', 'cloud/public/app/index.html', 'cloud/public/app/index2.js', 'cloud/public/app/styles/index2.css'],
];
const FENETRES = [
  ['modal-rig-reskin', 'rgs-canvas', ['rgs-go', 'rgs-cancel', 'rgs-close-x', 'rgs-rig', 'rgs-source', 'rgs-status']],
  ['modal-rig-test', 'rgt-canvas', ['rgt-go', 'rgt-cancel', 'rgt-close-x', 'rgt-choix', 'rgt-status']],
  ['modal-anim-import', 'ami-canvas', ['ami-go', 'ami-cancel', 'ami-close-x', 'ami-choisir', 'ami-type', 'ami-fichier', 'ami-status']],
];
for (const [nom, html, js, css] of PLATEFORMES) {
  for (const [id, canvas, ids] of FENETRES) {
    test(`${nom} : ${id} = gabarit fen-3d, apercu a gauche, colonne, pied`, () => {
      const b = bloc(lire(html), id);
      assert.ok(b.includes('class="modal-card fen-3d fen-p4"'));
      assert.ok(b.indexOf(`id="${canvas}"`) > 0 && b.indexOf(`id="${canvas}"`) < b.indexOf('class="fen-form"'), 'canevas avant la colonne');
      assert.ok(b.indexOf('class="modal-actions"') > b.indexOf('class="fen-form"'), 'pied apres la colonne');
      for (const i of ids) assert.ok(b.includes(`id="${i}"`), i);
    });
  }
  test(`${nom} : Add Animation = apercu du rig a gauche, choix dans la colonne`, () => {
    const h = lire(html);
    const i = h.indexOf('id="modal-anim-gen"'), b = h.slice(i, h.indexOf('id="modal-confirm"', i));
    assert.ok(b.indexOf('id="modal-anim-apercu"') < b.indexOf('class="fen-form"'));
    assert.ok(b.indexOf('class="fen-form"') < b.indexOf('id="modal-anim-types"'));
  });
  test(`${nom} : les clics ouvrent les fenetres (plus de confirm, plus de redirection, plus d'import direct)`, () => {
    const s = lire(js);
    assert.ok(s.includes("getElementById('ws-rig-reskin-btn')?.addEventListener('click', _p4OuvrirReskin)"));
    assert.ok(s.includes("getElementById('ws-rig-test-btn')?.addEventListener('click', _p4OuvrirTest)"));
    assert.ok(s.includes("getElementById('ws-anim-import-btn')?.addEventListener('click', _p4OuvrirImport)"));
    assert.ok(!s.includes("customConfirm(_i18nT('Recompute the skin weights of this rig?"), 'plus de boite de confirmation pour Re-skin');
    assert.ok(!s.includes('repli : l\'ancienne fenetre a cases'), 'Add Animation ne redirige plus vers Create new');
    assert.ok(s.includes('_p4ApercuAjout();'));
    assert.ok(!/ws-anim-import-file'\)\?\.addEventListener\('change', async/.test(s), 'le choix du fichier ne lance plus l\'import');
    assert.ok(/getElementById\('ami-go'\)\?\.addEventListener\('click', async \(\) => \{[\s\S]*?_p4Importer\(file, type\)/.test(s));
  });
  test(`${nom} : bloc CSS LOT P4 (pied pleine largeur)`, () => {
    const s = lire(css);
    assert.ok(s.includes('LOT P4'));
    assert.ok(s.includes('#modal-rig-reskin .modal-actions .primary-btn'));
    assert.ok(s.includes('flex: 1 1 auto'));
  });
}
test('apercu : lecture d\'un clip integre et pause (fichier commun)', () => {
  const a = lire('src/renderer/lib/apercu-animation.js'), b = lire('cloud/public/app/lib/apercu-animation.js');
  assert.equal(a, b);
  for (const m of ['jouerIntegre', 'nomsIntegres', 'pause']) assert.ok(a.includes(m), m);
});
test('site : pastilles de prix des pieds (grille du reseau)', () => {
  const s = lire('cloud/public/app/cloud-overrides.js');
  assert.ok(/'rgs-go':\s+'reskin'/.test(s));
  assert.ok(/'ami-go':\s+'manual_tool'/.test(s));
});
test('bureau : prix du pied Re-skin lu de la grille, jamais en dur', () => {
  const s = lire('src/renderer/index2.js');
  assert.ok(s.includes("_posePastille?.(document.getElementById('rgs-go')"));
  assert.ok(s.includes("_prixDe?.('reskin')"));
});
test('traductions des fenetres LOT P4', () => {
  const s = lire('src/renderer/lang/_additions6.js');
  for (const k of ['Motion', 'Animation type', 'Choose a GLB file…', 'No animation found in this file.', 'This rig has no motion to play.']) assert.ok(s.includes(`"${k}"`), k);
  assert.equal(s, lire('cloud/public/app/lang/_additions6.js'));
});
