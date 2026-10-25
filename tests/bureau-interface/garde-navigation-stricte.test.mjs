// 25/10, second retour du user (« toujours un saut vers l'endroit quand la generation finit ») : AUCUN defilement programmatique sans geste de l'utilisateur
// dans les 6 dernieres secondes, quelle que soit la facon dont le travail se termine. VRAIES fonctions _gnActive / _gnFenetre des deux index2.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const [nom, f] of Object.entries({ bureau: 'src/renderer/index2.js', site: 'cloud/public/app/index2.js' })) {
  const src = readFileSync(join(RACINE, f), 'utf-8').replace(/\r\n/g, '\n');
  const i = src.indexOf('var _GN = {'), j = src.indexOf('function _gnCle(');
  assert.ok(i >= 0 && j > i, nom);
  const bloc = src.slice(i, j);
  const monde = (maintenant) => new Function('window', 'Date', bloc + '\nreturn { _GN, _gnActive, _gnFenetre };')({}, { now: () => maintenant.t });
  test(`${nom} : sans geste depuis plus de 6 s, tout defilement programmatique est refuse (meme sans travail termine)`, () => {
    const h = { t: 100000 }; const m = monde(h);
    m._GN.dernierGeste = h.t - 7000;
    assert.equal(m._gnActive(), true);
    assert.equal(m._gnFenetre(), false, 'la fenetre « apres un travail » n\'est plus necessaire');
  });
  test(`${nom} : juste apres un geste de l'utilisateur (<= 6 s), le defilement qu'il declenche passe`, () => {
    const h = { t: 100000 }; const m = monde(h);
    m._GN.dernierGeste = h.t - 800;
    assert.equal(m._gnActive(), false);
    m._GN.dernierGeste = h.t - 5900;
    assert.equal(m._gnActive(), false);
  });
  test(`${nom} : fenetre apres la fin d'un travail : refus des 1,5 s apres un geste, jusqu'a 20 s`, () => {
    const h = { t: 100000 }; const m = monde(h);
    m._GN.jusqua = h.t + 20000; m._GN.dernierGeste = h.t - 2000;
    assert.equal(m._gnFenetre(), true);
    assert.equal(m._gnActive(), true);
  });
  test(`${nom} : desactivable (window.__gardeNavigation = false) et levee par _GN.libre`, () => {
    const h = { t: 100000 };
    const fen = {}; const m = new Function('window', 'Date', bloc + '\nreturn { _GN, _gnActive };')(fen, { now: () => h.t });
    m._GN.dernierGeste = 0;
    assert.equal(m._gnActive(), true);
    m._GN.libre = true; assert.equal(m._gnActive(), false); m._GN.libre = false;
    fen.__gardeNavigation = false; assert.equal(m._gnActive(), false);
  });
  test(`${nom} : le changement de projet et la photo de la vue utilisent la fenetre, pas la regle stricte`, () => {
    assert.match(src, /if \(_gnFenetre\(\)\) return;   \/\/ garde de navigation : pas de changement de projet automatique/);
    assert.match(src, /function _gnPhoto\(\) \{ try \{ if \(!_gnFenetre\(\)\)/);
  });
}
