// 25/10 (user : « mets environ 2000 mots dans toutes les langues de l'appli ») : detection du TYPE d'un nouveau projet a partir du nom.
// Cas declencheur : « cacatoes » sortait en Personnage (aucun mot-cle, le petit modele de redaction a invente un humain).
// VRAIE fonction detecterTypeEtStyle des deux index2.js + le vrai fichier lib/mots-projet.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const acorn = createRequire(join(RACINE, 'cloud', 'tests', 'x.js'))('acorn');
const FICHIERS = {
  bureau: [join(RACINE, 'src/renderer/index2.js'), join(RACINE, 'src/renderer/lib/mots-projet.js')],
  site: [join(RACINE, 'cloud/public/app/index2.js'), join(RACINE, 'cloud/public/app/lib/mots-projet.js')],
};
const NOMS = ['_NP_TYPES', '_NP_STYLES', '_npNormaliser', '_npCompter', '_NP_MOTS', '_NP_LATIN_PLUS', '_npCompterUnicode', 'detecterTypeEtStyle'];

function charger([index, mots]) {
  const src = readFileSync(index, 'utf-8');
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
  const morceaux = [], vus = new Set();
  for (const n of ast.body) {
    let nom = null;
    if (n.type === 'VariableDeclaration' && n.declarations.length === 1 && n.declarations[0].id.type === 'Identifier') nom = n.declarations[0].id.name;
    else if (n.type === 'FunctionDeclaration') nom = n.id.name;
    if (nom && NOMS.includes(nom) && !vus.has(nom)) { vus.add(nom); morceaux.push(src.slice(n.start, n.end)); }
  }
  for (const n of NOMS) assert.ok(vus.has(n), index + ' : ' + n + ' introuvable');
  const fenetre = {};
  new Function('window', readFileSync(mots, 'utf-8'))(fenetre);
  // _NP_MOTS lit `window` : on le fournit ; l'ordre des declarations de index2.js est conserve
  return new Function('window', morceaux.join('\n') + '\nreturn detecterTypeEtStyle;')(fenetre);
}

const CAS = [
  ['cacatoès', 'animal'], ['cockatoo', 'animal'], ['perroquet', 'animal'], ['loro', 'animal'], ['toucan', 'animal'], ['kookaburra', 'animal'],
  ['axolotl', null], ['hipopótamo', 'animal'], ['jirafa', 'animal'], ['girafe', 'animal'], ['otarie', 'animal'], ['wombat', 'animal'],
  ['dragon rouge', 'creature'], ['minotaure', 'creature'], ['fantasma', 'creature'], ['vampiro', 'creature'],
  ['gladiateur', 'character'], ['bruja', 'character'], ['herrero', 'character'], ['pirate', 'character'],
  ['voiture de course', 'vehicle'], ['tractor', 'vehicle'], ['camioneta', 'vehicle'], ['helicóptero', 'avion'], ['avion de chasse', 'avion'],
  ['yate', 'bateau'], ['voilier', 'bateau'], ['castillo', 'building'], ['phare', 'building'], ['molino', 'building'],
  ['espada larga', 'weapon'], ['hallebarde', 'weapon'], ['candelabro', 'prop'], ['sablier', 'prop'], ['cascada', 'environment'], ['volcan', 'environment'],
  ['mariposa', 'insect'], ['libellule', 'insect'], ['Cerf-volant', 'prop'], ['lucane cerf-volant', 'insect'], ['cerf', 'animal'],
  ['鹦鹉', 'animal'], ['大象', 'animal'], ['कुत्ता', 'animal'], ['طاووس', 'animal'], ['城堡', 'building'], ['सेना का टैंक', 'vehicle'], ['战斗机', 'avion'],
  ['宝剑', 'weapon'], ['شجرة', 'environment'], ['龙', 'creature'],
];

for (const [nom, fichiers] of Object.entries(FICHIERS)) {
  const detecter = charger(fichiers);
  for (const [texte, attendu] of CAS) {
    test(`${nom} : « ${texte} » -> ${attendu}`, () => {
      const r = detecter(texte);
      // « axolotl » n'est dans aucune liste : type non detecte (null), le menu reste libre
      assert.equal(r.type, attendu);
    });
  }
  test(`${nom} : un nom ordinaire sans mot connu reste non detecte (pas de faux type)`, () => {
    assert.equal(detecter('zxqwv').type, null);
  });
}
