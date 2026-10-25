// 25/10 (demande du user) : SOURIS COMMUNE DES VISUALISEURS 3D.
//   clic GAUCHE = action de l'outil (maintenu = en continu) ; clic DROIT maintenu + mouvement = deplacement X / Y de la camera ;
//   molette = zoom ; molette enfoncee + mouvement = rotation du modele.
// Controle les DEUX index2.js (site et bureau) et les bibliotheques : chaque OrbitControls recoit le schema, aucun ancien schema ne subsiste,
// et les outils (peinture, decalque, edition de maillage, reperes, points, poids) prennent leur action principale sur le bouton 0 (gauche).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lire = (r) => readFileSync(join(RACINE, r), 'utf-8').replace(/\r\n/g, '\n');
const INDEX = { bureau: 'src/renderer/index2.js', site: 'cloud/public/app/index2.js' };
const LIBS = ['cloud/public/app/lib/Viewer3D.js', 'src/renderer/lib/Viewer3D.js', 'cloud/public/app/lib/apercu-animation.js', 'src/renderer/lib/apercu-animation.js',
  'cloud/public/app/lib/editeur-poids.js', 'src/renderer/lib/editeur-poids.js'];

for (const [nom, f] of Object.entries(INDEX)) {
  const src = lire(f);
  test(`${nom} : _sourisVisualiseur pose droit = deplacer, molette enfoncee = tourner, gauche = libre (outil), et supprime le menu contextuel`, () => {
    const i = src.indexOf('function _sourisVisualiseur(');
    assert.ok(i >= 0);
    const code = src.slice(i, src.indexOf('\n}\n', i) + 3);
    const ecouteurs = [];
    const THREE = { MOUSE: { PAN: 'PAN', ROTATE: 'ROTATE' }, TOUCH: { PAN: 'tp', DOLLY_ROTATE: 'tdr' } };
    const ctl = {}; const dom = { addEventListener: (t, fn) => ecouteurs.push([t, fn]) };
    const f2 = new Function('THREE', 'ctl', 'dom', code + '\n_sourisVisualiseur(ctl, dom); _sourisVisualiseur(ctl, dom); return _sourisVisualiseur;');
    f2(THREE, ctl, dom);
    assert.deepEqual(ctl.mouseButtons, { LEFT: null, MIDDLE: 'ROTATE', RIGHT: 'PAN' });
    assert.equal(ctl.screenSpacePanning, true);
    assert.equal(ctl.enableZoom, true);
    assert.equal(ecouteurs.filter(([t]) => t === 'contextmenu').length, 1, 'le menu contextuel n\'est supprime qu\'une fois');
    let bloque = false; ecouteurs[0][1]({ preventDefault() { bloque = true; } });
    assert.ok(bloque);
  });
  test(`${nom} : chaque OrbitControls de index2.js est suivi du schema commun`, () => {
    const crees = (src.match(/new OrbitControls\(/g) || []).length;
    const appels = (src.match(/_sourisVisualiseur\(/g) || []).length - 1;   // - la definition
    assert.ok(crees >= 8, 'visualiseurs trouves : ' + crees);
    assert.ok(appels >= crees, `appels ${appels} < controles ${crees}`);
  });
  test(`${nom} : plus aucun ancien schema (gauche = tourner / gauche = deplacer)`, () => {
    assert.doesNotMatch(src, /LEFT: THREE\.MOUSE\.ROTATE/);
    assert.doesNotMatch(src, /LEFT: THREE\.MOUSE\.PAN/);
    assert.doesNotMatch(src, /RIGHT: null/);
  });
  test(`${nom} : les outils de peinture / decalque / edition / reperes / points prennent le clic gauche`, () => {
    assert.match(src, /if \(e\.button !== 0\) return;\n *if \(peState|const down = \(e\) => \{[\s\S]{0,400}if \(e\.button !== 0\) return;/);
    assert.match(src, /cv\.onpointerdown = \(e\) => \{\n *if \(e\.button !== 0\) return;/);
    assert.match(src, /function _meMouseDown\(e\) \{\n *if \(e\.button !== 0 \|\| e\.altKey\) return;/);
    assert.match(src, /_pts\.actif \|\| e\.button !== 0/);
  });
}

for (const f of LIBS) {
  test(`${f} : schema commun`, () => {
    const src = lire(f);
    assert.match(src, /mouseButtons = \{ LEFT: null, MIDDLE: THREE\.MOUSE\.ROTATE, RIGHT: THREE\.MOUSE\.PAN \}/);
    assert.doesNotMatch(src, /LEFT: THREE\.MOUSE\.PAN/);
    if (/editeur-poids/.test(f)) assert.match(src, /if \(ev\.button !== 0 \|\| essai\) return;/);
  });
}
