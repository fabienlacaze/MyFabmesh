// 25/10 (user : « il y a du trellis... ») : la liste des travaux finis affichait « trellis2_retex: prehistoric barracks » (cle interne = nom de moteur).
// VRAIES fonctions _nomTravailLisible / _displayJobName des deux index2.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const acorn = createRequire(join(RACINE, 'cloud', 'tests', 'x.js'))('acorn');
const FICHIERS = { bureau: 'src/renderer/index2.js', site: 'cloud/public/app/index2.js' };
const NOMS = ['_OP_LABEL', '_nomTravailLisible', '_displayJobName'];
function charger(f, langue) {
  const src = readFileSync(join(RACINE, f), 'utf-8');
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
  const morceaux = [], vus = new Set();
  for (const n of ast.body) {
    let nom = null;
    if (n.type === 'VariableDeclaration' && n.declarations.length === 1 && n.declarations[0].id.type === 'Identifier') nom = n.declarations[0].id.name;
    else if (n.type === 'FunctionDeclaration') nom = n.id.name;
    if (nom && NOMS.includes(nom) && !vus.has(nom)) { vus.add(nom); morceaux.push(src.slice(n.start, n.end)); }
  }
  for (const n of NOMS) assert.ok(vus.has(n), f + ' : ' + n);
  const FR = { 're-texture': 're-texturage', 'watertight sealing': 'etancheite' };
  const fenetre = { FabI18n: { lang: langue, t: (s) => (langue === 'fr' && FR[s]) || s, tf: () => null } };
  return new Function('window', '_i18nT', morceaux.join('\n') + '\nreturn _displayJobName;')(fenetre, fenetre.FabI18n.t);
}
for (const [nom, f] of Object.entries(FICHIERS)) {
  test(`${nom} : une cle de moteur n'est plus affichee (anglais)`, () => {
    const a = charger(f, 'en');
    assert.equal(a('trellis2_retex: prehistoric barracks'), 'Re-texture: prehistoric barracks');
    assert.equal(a('watertight: bench'), 'Watertight sealing: bench');
    assert.doesNotMatch(a('trellis2_retex: x'), /trellis/i);
  });
  test(`${nom} : traduit dans la langue de l'interface`, () => {
    assert.equal(charger(f, 'fr')('trellis2_retex: benchy'), 'Re-texturage: benchy');
  });
  test(`${nom} : un nom ordinaire reste identique`, () => {
    const a = charger(f, 'en');
    assert.equal(a('Generate 3D: orc'), 'Generate 3D: orc');
    assert.equal(a('Explosion 3D: orc'), 'Explosion 3D: orc');
  });
}
