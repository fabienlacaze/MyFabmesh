// 26/10 (user : « un cerf-volant c'est pas un animal ... (si ?) ») : table d'audit de ~150 mots courants (fr / en / es, vie quotidienne et jeu video)
// -> type attendu, executee sur la VRAIE detecterTypeEtStyle des deux index2.js (+ lib/mots-projet.js). Un mot ambigu n'est pas dans la table.
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
const NOMS = ['_NP_TYPES', '_NP_STYLES', '_npNormaliser', '_npCompter', '_NP_MOTS', '_NP_LATIN_PLUS', '_NP_COMPOSES', '_npCompterUnicode', 'detecterTypeEtStyle'];

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
  ["cerf-volant", "prop"],
  ["cerf volant", "prop"],
  ["cerfs-volants", "prop"],
  ["cerfs volants", "prop"],
  ["Un cerf-volant rouge", "prop"],
  ["kite", "prop"],
  ["cometa", "prop"],
  ["cerf", "animal"],
  ["lucane cerf-volant", "insect"],
  ["stag beetle", "insect"],
  ["ballon", "prop"],
  ["parapluie", "prop"],
  ["umbrella", "prop"],
  ["paraguas", "prop"],
  ["cle", "prop"],
  ["clé", "prop"],
  ["key", "prop"],
  ["llave", "prop"],
  ["barque", "bateau"],
  ["canoe", "bateau"],
  ["canoë", "bateau"],
  ["trottinette", "vehicle"],
  ["scooter", "vehicle"],
  ["drone", "avion"],
  ["montgolfière", "avion"],
  ["hot air balloon", "avion"],
  ["fusée", "avion"],
  ["rocket", "avion"],
  ["cohete", "avion"],
  ["hélicoptère", "avion"],
  ["zeppelin", "avion"],
  ["lanterne", "prop"],
  ["lantern", "prop"],
  ["linterna", "prop"],
  ["épée", "weapon"],
  ["hache", "weapon"],
  ["arc", "weapon"],
  ["bouclier", "weapon"],
  ["shield", "weapon"],
  ["coffre", "prop"],
  ["treasure chest", "prop"],
  ["tonneau", "prop"],
  ["barril", "prop"],
  ["trône", "prop"],
  ["throne", "prop"],
  ["trono", "prop"],
  ["couronne", "prop"],
  ["crown", "prop"],
  ["corona", "prop"],
  ["potion", "prop"],
  ["pocion", "prop"],
  ["carte", "prop"],
  ["map", "prop"],
  ["mapa", "prop"],
  ["livre", "prop"],
  ["libro", "prop"],
  ["piano", "prop"],
  ["guitare", "prop"],
  ["guitar", "prop"],
  ["guitarra", "prop"],
  ["robot", "character"],
  ["golem", "creature"],
  ["squelette", "creature"],
  ["skeleton", "creature"],
  ["esqueleto", "creature"],
  ["fantôme", "creature"],
  ["ghost", "creature"],
  ["sirène", "creature"],
  ["mermaid", "creature"],
  ["sirena", "creature"],
  ["centaure", "creature"],
  ["centaur", "creature"],
  ["centauro", "creature"],
  ["elfe", "character"],
  ["elf", "character"],
  ["elfo", "character"],
  ["nain", "character"],
  ["dwarf", "character"],
  ["enano", "character"],
  ["licorne", "creature"],
  ["unicorn", "creature"],
  ["unicornio", "creature"],
  ["dragon", "creature"],
  ["pégase", "creature"],
  ["pegasus", "creature"],
  ["pegaso", "creature"],
  ["loup-garou", "creature"],
  ["werewolf", "creature"],
  ["hombre lobo", "creature"],
  ["vampire", "creature"],
  ["zombie", "creature"],
  ["scarabée", "insect"],
  ["beetle", "insect"],
  ["escarabajo", "insect"],
  ["libellule", "insect"],
  ["dragonfly", "insect"],
  ["libélula", "insect"],
  ["chenille", "insect"],
  ["caterpillar", "insect"],
  ["oruga", "insect"],
  ["mille-pattes", "insect"],
  ["millipede", "insect"],
  ["ciempiés", "insect"],
  ["méduse", "animal"],
  ["jellyfish", "animal"],
  ["medusa", "animal"],
  ["pieuvre", "animal"],
  ["octopus", "animal"],
  ["pulpo", "animal"],
  ["requin", "animal"],
  ["shark", "animal"],
  ["tiburón", "animal"],
  ["baleine", "animal"],
  ["whale", "animal"],
  ["ballena", "animal"],
  ["crevette", "animal"],
  ["shrimp", "animal"],
  ["camarón", "animal"],
  ["escargot", "animal"],
  ["snail", "animal"],
  ["caracol", "animal"],
  ["grenouille", "animal"],
  ["frog", "animal"],
  ["rana", "animal"],
  ["tortue", "animal"],
  ["turtle", "animal"],
  ["tortuga", "animal"],
  ["serpent", "animal"],
  ["snake", "animal"],
  ["serpiente", "animal"],
  ["abeille", "insect"],
  ["bee", "insect"],
  ["abeja", "insect"],
  ["papillon", "insect"],
  ["butterfly", "insect"],
  ["mariposa", "insect"],
  ["chauve-souris", "animal"],
  ["murciélago", "animal"],
];

for (const [nom, fichiers] of Object.entries(FICHIERS)) {
  const detecter = charger(fichiers);
  if (process.env.AUDIT) for (const [texte, attendu] of CAS) { const r = detecter(texte).type; if (r !== attendu) console.log('ECART ' + nom + ' : ' + texte + ' -> ' + r + ' (attendu ' + attendu + ')'); }
  for (const [texte, attendu] of CAS) {
    test(`${nom} : « ${texte} » -> ${attendu}`, () => {
      assert.equal(detecter(texte).type, attendu);
    });
  }
}
