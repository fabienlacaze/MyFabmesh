// OUTILS A TEXTE LIBRE : TRADUCTION SANS ECHEC SILENCIEUX ET CHOIX « ENVOYER TEL QUEL » TRANSMIS (24/10, audit des prompts, B1 / M3 / M6).
// Garde de structure sur les DEUX index2.js (bureau et site) et les DEUX index2-edit-tools.js :
//   1. plus aucun appel silencieux a translateUserPrompt (ancienne signature texte -> texte qui rendait le BRUT en cas d'echec) : Detect,
//      apercus du masque et Refine mesh passent par traduireTexteUtilisateur (echec montre) ou _traduirePourGeneration (choix de l'utilisateur) ;
//   2. chaque appel d'un outil PAYANT a texte libre transmet langueVerifiee (sinon « Envoyer tel quel » est refuse en boucle par le serveur) ;
//   3. dans le Paint-mask, un rejet de la traduction ne lance plus la requete avec le texte brut.
// Lancer : node --test tests/bureau-interface/langue-outils-renderer.test.mjs
// Ancien code : BUREAU_INDEX2=<copie> WEB_INDEX2=<copie> BUREAU_EDIT_TOOLS=<copie> WEB_EDIT_TOOLS=<copie> node --test ...
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const INDEX2 = {
  bureau: process.env.BUREAU_INDEX2 || path.join(RACINE, 'src/renderer/index2.js'),
  web: process.env.WEB_INDEX2 || path.join(RACINE, 'cloud/public/app/index2.js'),
};
const EDIT = {
  bureau: process.env.BUREAU_EDIT_TOOLS || path.join(RACINE, 'src/renderer/index2-edit-tools.js'),
  web: process.env.WEB_EDIT_TOOLS || path.join(RACINE, 'cloud/public/app/index2-edit-tools.js'),
};

/** Texte de l'appel qui commence a `debut` (la parenthese ouvrante est la premiere apres) : parentheses equilibrees, chaines ignorees. */
function appelComplet(src, debut) {
  let i = src.indexOf('(', debut);
  let prof = 0, quote = null;
  const fin0 = i;
  for (; i < src.length; i++) {
    const c = src[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '(') prof++;
    else if (c === ')') { prof--; if (prof === 0) return src.slice(debut, i + 1); }
  }
  return src.slice(debut, fin0 + 400);
}
function appels(src, motif) {
  const out = [];
  for (const m of src.matchAll(motif)) out.push(appelComplet(src, m.index));
  return out;
}

for (const cible of ['bureau', 'web']) {
  const src = fs.readFileSync(INDEX2[cible], 'utf-8');

  test(`${cible} : aucun appel silencieux a translateUserPrompt (le brut partait sans un mot en cas d'echec)`, () => {
    const lignes = src.split(/\r?\n/);
    const appelants = lignes.map((l, i) => [i + 1, l]).filter(([, l]) => /\btranslateUserPrompt\(/.test(l) && !/^\s*async function translateUserPrompt\(/.test(l)
      && !/^\s*(\/\/|\*)/.test(l));
    assert.deepEqual(appelants.map(([n, l]) => `${n}: ${l.trim().slice(0, 100)}`), []);
  });

  test(`${cible} : chaque outil payant a texte libre transmet langueVerifiee au serveur`, () => {
    const manque = [];
    const outils = [
      [/\bAPI\.img2img\(\{/g, (a) => /prompt: style[,\s]/.test(a)],       // style du menu : texte du produit, jamais traduit
      [/\bAPI\.texVariant\(\{/g, () => false],
      [/\bAPI\.autoInpaint\(\{/g, () => false],
      [/\bAPI\.recolor\(\{/g, () => false],
      [/\bAPI\.regionRetex\??\.\(\{/g, () => false],
      [/\bmeshyAPI\.regionRetex\??\.\(\{/g, () => false],
      [/\bAPI\.meshTool\(\{/g, () => false],
      [/\bwindow\.meshyAPI\??\.texVariant\(\{/g, () => false],
      [/\bwindow\.meshyAPI\??\.img2img\(\{/g, () => false],
    ];
    let total = 0;
    for (const [motif, exempte] of outils) {
      for (const a of appels(src, motif)) {
        total++;
        if (exempte(a)) continue;
        if (!/langueVerifiee/.test(a)) manque.push(a.replace(/\s+/g, ' ').slice(0, 110));
      }
    }
    assert.ok(total >= 8, `${total} appels trouves`);
    assert.deepEqual(manque, []);
  });
}

test('bureau : Refine mesh et Detect (Reshape) traduisent avec echec montre ; site : Refine mesh traduit aussi', () => {
  const bureau = fs.readFileSync(INDEX2.bureau, 'utf-8');
  const web = fs.readFileSync(INDEX2.web, 'utf-8');
  for (const [nom, src] of [['bureau', bureau], ['web', web]]) {
    const i = src.indexOf("getElementById('rfn-go')?.addEventListener");
    assert.ok(i > 0, `${nom} : rfn-go introuvable`);
    const corps = src.slice(i, i + 1600);
    assert.match(corps, /_traduirePourGeneration\(rawModification\)/, `${nom} : Refine mesh doit traduire avec le choix de l'utilisateur`);
  }
  const d = bureau.indexOf('async function _rrxDetect()');
  assert.ok(d > 0);
  assert.match(bureau.slice(d, d + 1500), /traduireTexteUtilisateur\(part\)[\s\S]*?\.echec/, 'Detect : un echec de traduction est montre, le brut ne part pas');
});

for (const cible of ['bureau', 'web']) {
  test(`${cible} Paint-mask : un rejet de la traduction ne lance PAS la requete avec le texte brut`, () => {
    const src = fs.readFileSync(EDIT[cible], 'utf-8');
    const i = src.indexOf('fabmeshTraduirePourGeneration(promptText)');
    assert.ok(i > 0);
    const suite = src.slice(i, i + 1600);
    const rejet = suite.slice(suite.indexOf('}, function () {'));
    const bloc = rejet.slice(0, rejet.indexOf('});') + 3);
    assert.ok(bloc.length > 10, 'bloc de rejet trouve');
    assert.doesNotMatch(bloc, /lancer\(\)/, 'le rejet lancait la requete avec le texte brut');
  });
}

test('bureau Paint-mask : « Envoyer tel quel » est transmis a maskInpaint', () => {
  const src = fs.readFileSync(EDIT.bureau, 'utf-8');
  assert.match(src, /langueVerifiee = !!tr\.telQuel/);
  assert.match(src, /var _args = \{[^}]*langueVerifiee: langueVerifiee \|\| undefined/);
});

// m6a (24/10) : le nom d'un projet IMPORTE (guillemet, chevron) cassait l'attribut alt de la carte de projet (auto-XSS)
for (const cible of ['bureau', 'web']) {
  test(`${cible} : aucun attribut alt/title de gabarit n'interpole un nom de projet sans echappement`, () => {
    const src = fs.readFileSync(INDEX2[cible], 'utf-8');
    const mauvais = [...src.matchAll(/(?:alt|title)="\$\{(?!escapeHtml\(|_escapeHtml\()[^}]*\.(?:name|displayName)[^}]*\}"/g)].map((m) => m[0]);
    assert.deepEqual(mauvais, []);
    assert.match(src, /alt="\$\{escapeHtml\(p\.displayName \|\| p\.name\)\}"/, 'carte de projet : alt echappe');
  });
}

// m16a (24/10) : « short » (le vetement) ne devient « shorts » que seul ; « short sword », « short hair » restent justes.
// Ancien code : BUREAU_INDEX2=<copie> WEB_INDEX2=<copie> node --test ...
for (const cible of ['bureau', 'web']) {
  test(`${cible} : _corrigerFauxAmis ne transforme pas « short sword » en « shorts sword »`, () => {
    const src = fs.readFileSync(INDEX2[cible], 'utf-8');
    const i = src.indexOf('function _corrigerFauxAmis(');
    assert.ok(i > 0);
    const code = src.slice(i, i + src.slice(i).search(/\r?\n\}\r?\n/) + 3);
    // eslint-disable-next-line no-new-func
    const f = new Function(code + '\nreturn _corrigerFauxAmis;')();
    assert.equal(f('une epee courte et un short', 'a warrior with a short sword and a short', 'fr'), 'a warrior with a short sword and shorts');
    assert.equal(f('un short rouge', 'a red short', 'fr'), 'a red shorts');
    assert.equal(f('un short', 'a short', 'fr'), 'shorts');
    assert.equal(f('un guerrier en short et un casque', 'a warrior in short and a helmet', 'fr'), 'a warrior in shorts and a helmet');
    assert.equal(f('un short a poches', 'the short with pockets', 'fr'), 'the shorts with pockets');
    // jamais d'adjectif : « short hair », « short story », « short sword »
    assert.equal(f('un nain avec un short', 'a dwarf with a short beard and short hair, wearing a short', 'fr'), 'a dwarf with a short beard and short hair, wearing shorts');
    assert.equal(f('une histoire courte avec un short', 'a short story with a short', 'fr'), 'a short story with shorts');
    // pas de source francaise avec « short » : rien ne bouge
    assert.equal(f('une epee courte', 'a short sword', 'fr'), 'a short sword');
    assert.equal(f('a short sword', 'a short sword', 'en'), 'a short sword');
    // deja au pluriel : intact
    assert.equal(f('des shorts', 'a pair of shorts and a short sword', 'fr'), 'a pair of shorts and a short sword');
  });
}
