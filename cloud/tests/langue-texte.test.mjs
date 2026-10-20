// LANGUE DU TEXTE (2026-10-13, audit de la langue du 11/10 : TRADUCTION-01/06/07, CHAMPS-04, SERVEUR-01) — module commun
// cloud/public/app/lib/langue-texte.js (= src/renderer/lib/langue-texte.js, importe aussi par le worker). Aucun reseau.
//   - l'anglais du proprietaire est reconnu (corpus build/intention_cas.json : 43/64 avec l'ancienne heuristique) ;
//   - les langues hors interface (de, it, pt, ru, ja, ko, tr, nl, pl...) sont reconnues, jamais prises pour de l'anglais ;
//   - le filet du serveur ne vise JAMAIS un gabarit anglais du produit (toutes les combinaisons style x type des deux index2.js) et, dans un
//     prompt enrichi, ne vise que le texte etranger de l'utilisateur.
// Lancer : cd cloud && node --test tests/langue-texte.test.mjs   (autre exemplaire : LIB_LANGUE=<chemin> WEB_INDEX2=... BUREAU_INDEX2=...)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as acorn from 'acorn';

const chemin = (env, rel) => process.env[env] || new URL(rel, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const LIB = chemin('LIB_LANGUE', '../public/app/lib/langue-texte.js');
const WEB = chemin('WEB_INDEX2', '../public/app/index2.js');
const BUREAU = chemin('BUREAU_INDEX2', '../../src/renderer/index2.js');
const CORPUS = chemin('CORPUS_INTENTION', '../../build/intention_cas.json');

// le module est un module ES dans un .js (le dossier cloud/ n'est pas "type": "module") : on en importe une copie .mjs
const dossier = mkdtempSync(join(tmpdir(), 'langue-texte-'));
let LT;
try {
  const copie = join(dossier, 'langue-texte.mjs');
  writeFileSync(copie, readFileSync(LIB, 'utf-8'));
  LT = await import(pathToFileURL(copie).href);
} finally {
  rmSync(dossier, { recursive: true, force: true });
}

const ANGLAIS_COURTS = [
  'a red dragon', 'wooden barrel', 'A stone golem', 'pirate ship', 'dragon with golden wings', 'sports car', 'a cute cat',
  'medieval castle', 'red sports car', 'an old wizard', 'a giant spider', 'iron sword', 'treasure chest', 'a small house',
  'fire elemental', 'ice golem', 'robot dog', 'flying whale', 'a knight', 'A samurai wielding two katanas', 'A warrior, no weapons',
  'stone tower', 'a wooden chair', 'blue potion bottle', 'goblin archer', 'skeleton king', "dragon's lair",
  'a man and his son holding a sword and the shield', 'cyberpunk motorcycle', 'steampunk airship', 'low poly tree', 'pixel art sword',
  'a cat dressed as a wizard', 'knight in shining armor', 'a lighthouse on a cliff', 'futuristic tank', 'magic staff', 'a fox',
  'cute bunny', 'evil clown', 'an elf queen', 'sitting on a chair', 'standing at night', 'red dragon', 'black cat', 'golden crown',
  'a witch hat', 'big mushroom house', 'space marine', 'viking ship', 'a dwarf blacksmith', 'ancient ruins', 'crystal cave',
  'haunted house', 'teddy bear', 'a fluffy white rabbit with a pink feather boa', 'a green parrot sitting on a wooden perch',
  'A prehistoric worker', 'a tabby cat with a bass guitar', 'an orc warrior, no helmet', 'a complete boat with white sails',
  'An orc', 'A knight’s helmet with a red plume', 'a red dragon 🐉',
];
const ETRANGERS = [
  ['fr', 'un dragon rouge avec des ailes'], ['fr', 'un chevalier sans casque'], ['fr', 'une maison en bois'],
  ['fr', "bouteille d'eau avec un liquide fluo bleu"], ['fr', 'cochon rose volant avec casquette et masque, sur ses pattes, short vert fluo'],
  ['fr', 'un chat noir qui court vers la maison'], ['fr', 'un orc warrior avec une massue spiked'], ['fr', 'chat noir'], ['fr', 'épée magique'],
  ['es', 'un dragón rojo con alas'], ['es', 'caballero a caballo a galope'], ['es', 'castillo medieval con torres'], ['es', 'un perro marrón'],
  ['es', 'un gato negro que quiere ver el mar'],
  ['de', 'ein roter Drache mit Flügeln'], ['de', 'ein brauner Hund'], ['de', 'roter Helm'], ['de', 'ein Ritter ohne Helm'],
  ['it', 'un drago rosso con le ali'], ['it', 'una casa a due piani a forma di torre'], ['it', 'un cane marrone'], ['it', 'elmo rosso'],
  ['pt', 'um dragão vermelho com asas'], ['pt', 'uma casa a beira do mar a noite'], ['pt', 'um homem a cavalo a galope'],
  ['pt', 'capacete vermelho'], ['pt', 'um gato preto que quer ver o mar'],
  ['nl', 'een rode draak met vleugels'], ['pl', 'czerwony smok ze skrzydłami'], ['tr', 'kanatlı kırmızı bir ejderha'],
  ['id', 'seekor naga merah dengan sayap'], ['vi', 'một con rồng đỏ có cánh'], ['sv', 'en röd drake med vingar'],
  ['ru', 'красный дракон с крыльями'], ['uk', 'червоний дракон з крилами, їжак'], ['zh', '一条红龙'], ['zh', '红色头盔'],
  ['ja', '赤いドラゴン'], ['ko', '빨간 용'], ['ar', 'تنين أحمر بأجنحة'], ['hi', 'पंखों वाला लाल ड्रैगन'], ['th', 'มังกรสีแดง'],
  ['el', 'κόκκινος δράκος'], ['he', 'דרקון אדום'], ['fa', 'اژدهای قرمز با بال'], ['zh', '一条红龙，photorealistic'],
];

test('le corpus anglais du proprietaire (build/intention_cas.json) est reconnu en entier (43/64 avec l ancienne heuristique)', () => {
  // 64 prompts a l'origine, TOUJOURS en tete du fichier ; la piste des negations (integration 20/10) en a ajoute 214 apres eux (phrases courtes
  // comme none ou no more, textes francais) qui ne sont pas du corpus anglais du proprietaire
  const corpus = JSON.parse(readFileSync(CORPUS, 'utf-8')).map((c) => c.texte).slice(0, 64);
  assert.equal(corpus.length, 64);
  assert.ok(corpus[0].startsWith('An orc warrior covered in blood'), 'le corpus du proprietaire ouvre toujours le fichier');
  const rates = corpus.filter((t) => LT.detecterLangue(t).langue !== 'en');
  assert.deepEqual(rates, [], 'prompts anglais pris pour une autre langue : ' + JSON.stringify(rates));
  for (const t of corpus) assert.equal(LT.langueSource(t, 'fr'), null, 'un prompt anglais ne part pas au traducteur, meme sous une interface fr : ' + t);
});

test('prompts anglais courts : reconnus, jamais vises par le filet du serveur', () => {
  const rates = ANGLAIS_COURTS.filter((t) => LT.detecterLangue(t).langue !== 'en');
  assert.deepEqual(rates, [], JSON.stringify(rates));
  for (const t of ANGLAIS_COURTS) assert.deepEqual(LT.morceauxEtrangers(t), [], 'filet a tort sur ' + t);
});

test('langues de l interface ET hors interface : identifiees, jamais prises pour de l anglais', () => {
  for (const [lg, t] of ETRANGERS) {
    const d = LT.detecterLangue(t);
    assert.equal(d.langue, lg, t + ' -> ' + JSON.stringify(d));
    assert.equal(LT.langueSource(t, 'en'), lg, 'interface anglaise : la langue du TEXTE decide (' + t + ')');
  }
});

test('contre-exemples de la contre-verification (deux « a » prepositions) : pas de l anglais', () => {
  for (const t of ['caballero a caballo a galope', 'uma casa a beira do mar a noite', 'um homem a cavalo a galope',
    'una casa a due piani a forma di torre']) {
    assert.notEqual(LT.detecterLangue(t).langue, 'en', t);
    assert.ok(LT.langueSource(t, 'fr'), 'doit partir au traducteur : ' + t);
  }
});

test('langueSource : texte sans indice -> langue de l interface ; anglais -> null ; codes regionaux normalises', () => {
  assert.equal(LT.langueSource('orc', 'fr'), 'fr');
  assert.equal(LT.langueSource('orc', 'fr-FR'), 'fr');
  assert.equal(LT.langueSource('orc', 'en'), null);
  assert.equal(LT.langueSource('a red dragon', 'fr'), null);
  assert.equal(LT.langueSource('', 'fr'), null);
  assert.equal(LT.langueSource('   ', 'fr'), null);
  assert.equal(LT.langueSource(null, 'fr'), null);
  assert.equal(LT.normaliserCodeLangue('fr-FR'), 'fr');
  assert.equal(LT.normaliserCodeLangue('zh_TW'), 'zh');
  assert.equal(LT.normaliserCodeLangue('PT-br'), 'pt');
  assert.equal(LT.normaliserCodeLangue('iw'), 'he');
  assert.equal(LT.normaliserCodeLangue('fra'), 'fr');
  assert.equal(LT.normaliserCodeLangue(' fr '), 'fr');
  assert.equal(LT.normaliserCodeLangue('x'), '');
  assert.equal(LT.normaliserCodeLangue(42), '');
  for (const lg of ['de', 'it', 'pt', 'ru', 'ja', 'ko', 'tr', 'nl', 'pl', 'id', 'vi', 'th', 'uk', 'he', 'bn', 'fa', 'fr', 'es', 'zh', 'hi', 'ar']) {
    assert.ok(LT.LANGUES_TRADUCTIBLES.has(lg), lg);
  }
  assert.ok(!LT.LANGUES_TRADUCTIBLES.has('en'));
});

function tables(cheminIndex) {
  const src = readFileSync(cheminIndex, 'utf-8');
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
  const out = {};
  for (const n of ast.body) {
    if (n.type === 'VariableDeclaration' && n.declarations.length === 1 && n.declarations[0].id.type === 'Identifier') {
      const nom = n.declarations[0].id.name;
      if (['ASSET_TYPE_PROMPTS', 'ASSET_STYLE_PROMPTS', 'ASSET_TYPE_PREFIXES'].includes(nom)) {
        // eslint-disable-next-line no-new-func
        out[nom] = new Function('return ' + src.slice(n.declarations[0].init.start, n.declarations[0].init.end))();
      }
    }
  }
  assert.ok(out.ASSET_TYPE_PROMPTS && out.ASSET_STYLE_PROMPTS, cheminIndex + ' : tables de gabarits introuvables');
  return out;
}

test('filet du serveur : aucun gabarit anglais du produit n est pris pour du texte etranger (bureau et web)', () => {
  let combinaisons = 0;
  for (const c of [BUREAU, WEB]) {
    const T = tables(c);
    for (const [k, v] of Object.entries({ ...T.ASSET_TYPE_PROMPTS, ...T.ASSET_STYLE_PROMPTS, ...(T.ASSET_TYPE_PREFIXES || {}) })) {
      assert.deepEqual(LT.morceauxEtrangers(v), [], c + ' : gabarit ' + k);
    }
    for (const s of Object.values(T.ASSET_STYLE_PROMPTS)) {
      for (const tt of Object.values(T.ASSET_TYPE_PROMPTS)) {
        for (const user of ['a red dragon', 'An orc warrior covered in blood, holding a massive spiked club', 'wooden barrel']) {
          combinaisons++;
          const p = [s, user, tt].filter(Boolean).join(', ');
          assert.deepEqual(LT.morceauxEtrangers(p), [], p);
        }
      }
    }
  }
  assert.ok(combinaisons > 1000, 'combinaisons verifiees : ' + combinaisons);
});

test('filet du serveur : dans un prompt enrichi, SEUL le texte etranger de l utilisateur est vise', () => {
  const T = tables(WEB);
  for (const user of ['un dragon rouge avec des ailes', 'ein roter Drache mit Flügeln', '一条红龙', 'красный дракон с крыльями',
    'un chevalier sans casque, avec une épée']) {
    const p = [T.ASSET_STYLE_PROMPTS.realistic, user, T.ASSET_TYPE_PROMPTS.creature].join(', ');
    const m = LT.morceauxEtrangers(p);
    assert.equal(m.length, 1, p + ' -> ' + JSON.stringify(m));
    assert.equal(p.slice(m[0].debut, m[0].fin), user);
    assert.ok(m[0].traductible);
  }
  // texte entierement etranger : une seule partie, le texte entier
  const t = 'un chevalier, une épée, un bouclier';
  assert.deepEqual(LT.morceauxEtrangers(t).map((x) => [x.debut, x.fin, x.langue]), [[0, t.length, 'fr']]);
  // les decimales et les poids ne sont pas coupes
  for (const x of ['a robot of 2.5 m', 'a (medieval:1.4) knight', 'No.5 robot, chrome']) assert.deepEqual(LT.morceauxEtrangers(x), [], x);
  // langue non traduisible par le modele du site (telougou) : visee, marquee non traductible
  const te = LT.morceauxEtrangers('ఎరుపు డ్రాగన్');
  assert.equal(te.length, 1);
  assert.equal(te[0].langue, 'te');
  assert.equal(te[0].traductible, false);
});

test('robustesse : entrees degenerees, texte enorme borne en temps', () => {
  for (const x of [undefined, null, '', '   ', 42, '12345', '🐉🐉🐉', '()[]{}', '\u0000\u0001']) {
    const d = LT.detecterLangue(x);
    assert.ok(d && 'langue' in d, String(x));
    assert.deepEqual(LT.morceauxEtrangers(x), []);
  }
  const t0 = Date.now();
  LT.detecterLangue(' '.repeat(200000) + 'un dragon');
  LT.morceauxEtrangers('a, '.repeat(100000));
  LT.morceauxEtrangers('un dragon rouge, '.repeat(20000));
  assert.ok(Date.now() - t0 < 2000, 'trop lent : ' + (Date.now() - t0) + ' ms');
});

// ------------------------------------------------------------------------------------------------ PRECISION (revue du 2026-10-14)
// Bloquants B1 / B2 de la revue du lot 2 : un seul mot outil etranger (« van », « den », « el », « las », « sin », « con », « per »,
// « pour ») ou un emprunt (« beer », « kobold », « sombrero ») suffisait : 57 prompts anglais sur 195 partaient au traducteur sous une
// interface ANGLAISE et 25 etaient vises par le filet du serveur (traduits, ou refuses en 422 si le traducteur etait en panne).
const HOSTILE = JSON.parse(readFileSync(chemin('CORPUS_HOSTILE', './langue-corpus-hostile.json'), 'utf-8'));

test('precision : prompts ANGLAIS a mots partages (camper van, wolf den, Las Vegas sign...) : jamais surement etrangers, jamais traduits sous une interface anglaise, jamais vises par le filet', () => {
  assert.ok(HOSTILE.anglais.length >= 400, 'corpus : ' + HOSTILE.anglais.length);
  const fautes = [];
  for (const t of HOSTILE.anglais) {
    const d = LT.detecterLangue(t);
    if (d.langue && d.langue !== 'en' && d.sure) fautes.push(`${t} : surement ${d.langue}`);
    const src = LT.langueSource(t, 'en');
    if (src) fautes.push(`${t} : traduit depuis ${src} sous une interface anglaise`);
    const m = LT.morceauxEtrangers(t);
    if (m.length) fautes.push(`${t} : filet du serveur (${m.map((x) => x.langue).join(',')})`);
  }
  assert.deepEqual(fautes, []);
});

test('precision : un mot qui existe aussi en anglais ne designe jamais une langue a lui seul ; un seul mot ne rend jamais « sur »', () => {
  for (const t of ['van', 'den', 'die', 'beer', 'sombrero', 'rucksack', 'kobold', 'piccolo', 'el', 'las', 'con', 'sin', 'per', 'pour']) {
    assert.equal(LT.detecterLangue(t).langue, null, t);
  }
  for (const t of ['drache', 'casque', 'chapeau', 'perro', 'que sera sera', 'Sturm und Drang poster', 'noir detective', 'crème brûlée',
    'piñata', 'jalapeño', 'São Paulo skyline', 'Mötley Crüe logo']) {
    assert.equal(LT.detecterLangue(t).sure, false, t);
    assert.equal(LT.langueSource(t, 'en'), null, 'interface anglaise : ' + t);
  }
  // sous l'interface de sa langue, le mot seul part bien au traducteur
  assert.equal(LT.langueSource('casque', 'fr'), 'fr');
  assert.equal(LT.langueSource('Drache', 'de'), 'de');
  assert.equal(LT.langueSource('sombrero', 'es'), 'es');
});

test('rappel : prompts ETRANGERS courts de 10 langues : traduits sous leur interface (tous), et sous une interface anglaise (presque tous)', () => {
  let sures = 0;
  const rates = [];
  for (const [lg, t] of HOSTILE.etrangers) {
    assert.ok(LT.langueSource(t, lg), 'interface ' + lg + ' : ' + t);
    assert.notEqual(LT.detecterLangue(t).langue, 'en', t);
    if (LT.langueSource(t, 'en') === lg) sures++; else rates.push(`${lg}|${t}`);
  }
  // 2 sur 111 restent ambigus sous une interface anglaise (« ein Holzfass », « eine Schatztruhe » : un mot outil + un compose inconnu)
  assert.ok(sures >= HOSTILE.etrangers.length - 3, `${sures} sur ${HOSTILE.etrangers.length} ; rates : ${rates.join(' ; ')}`);
});

test('precision : lettres SANS emprunt anglais (turc, polonais, tcheque...) : une phrase sans mot connu reste reconnue', () => {
  for (const [lg, t] of [['tr', 'Gerekli parametre, isteğe bağlı parametreden sonra gelemez.'], ['pl', 'Dodaj wszystkie brakujące modyfikatory'],
    ['cs', 'Povinný parametr nemůže následovat po nepovinném parametru.']]) {
    const d = LT.detecterLangue(t);
    assert.equal(d.langue, lg, t);
    assert.equal(d.sure, true, t);
  }
  // contractions anglaises : « I've » n'est pas le « ve » turc ou tcheque
  for (const t of ["I've got a sword", "we'll make a castle", "they're riding dragons"]) assert.equal(LT.detecterLangue(t).langue, 'en', t);
});

// ------------------------------------------------------------------------------------------------ SECONDE REVUE DU 2026-10-14
// B1 residuel : un prompt ANGLAIS qui contient un NOM PROPRE ou une EXPRESSION etrangere etait « surement » etranger : sous une
// interface anglaise il partait au traducteur, et le filet du serveur le reecrivait (ou le refusait en 422, traducteur en panne).
// Mesure (corpus de 142 prompts anglais a noms propres et emprunts de la revue) : 14 vises avant, 0 apres ; rappel inchange sur les
// prompts etrangers, noms propres compris.
const ANGLAIS_A_NOMS = ['a vintage music box playing Für Elise', 'Puerta del Sol clock tower', 'Santa Maria del Fiore dome',
  'Hôtel de Ville building', "Côte d'Azur travel poster", 'Pão de Açúcar cable car', "C'est la vie coffee mug", 'Tête de Moine cheese wheel',
  'Crème de la crème trophy', 'Je ne sais quoi perfume bottle', 'À la carte menu board', 'Ein Prosit beer stein', 'Glück auf miners lamp',
  'Gasthaus zum Goldenen Hirsch tavern sign', 'El Dorado gold statue', 'Van Helsing monster hunter'];
const ETRANGERS_A_NOMS = [['fr', 'la cathédrale Notre-Dame de Paris sous la neige'], ['fr', 'un chevalier devant le château de Versailles'],
  ['fr', 'Le Mont Saint-Michel sous la pluie'], ['es', 'Don Quijote de la Mancha con su lanza'], ['es', 'El Dorado, una ciudad de oro en la selva'],
  ['de', 'die Burg Hohenzollern im Nebel'], ['de', 'Das Brandenburger Tor bei Nacht'], ['de', 'der König der Elfen'], ['de', 'kleine Hütte im Wald'],
  ['it', 'la Torre di Pisa con la neve'], ['it', 'il Duomo di Milano al tramonto'], ['pt', 'o Cristo Redentor no Rio de Janeiro à noite'],
  ['es', 'Los Ángeles de noche con muchas luces'], ['de', 'Ritter, Schwert, Schild'], ['de', 'Ein Roter Drache Mit Flügeln']];

test('seconde revue, B1 residuel : un nom propre ou une expression etrangere dans un prompt ANGLAIS ne le rend pas etranger', () => {
  const fautes = [];
  for (const t of ANGLAIS_A_NOMS) {
    const src = LT.langueSource(t, 'en');
    if (src) fautes.push(`${t} : traduit depuis ${src} sous une interface anglaise`);
    const m = LT.morceauxEtrangers(t);
    if (m.length) fautes.push(`${t} : filet du serveur (${m.map((x) => x.langue).join(',')})`);
  }
  assert.deepEqual(fautes, []);
});

test('seconde revue, rappel : un prompt ETRANGER qui contient un nom propre reste reconnu (interface de sa langue ET interface anglaise)', () => {
  const fautes = [];
  for (const [lg, t] of ETRANGERS_A_NOMS) {
    if (LT.langueSource(t, lg) !== lg) fautes.push(`${t} : interface ${lg} -> ${LT.langueSource(t, lg)}`);
    if (LT.langueSource(t, 'en') !== lg) fautes.push(`${t} : interface anglaise -> ${LT.langueSource(t, 'en')}`);
    if (!LT.morceauxEtrangers(t).length) fautes.push(`${t} : ignore par le filet`);
  }
  assert.deepEqual(fautes, []);
});

test('seconde revue : un mot SEUL a lettres accentuees propres reste « sur » (documente), un mot seul sans ces lettres non', () => {
  for (const [t, lg] of [['épée', 'fr'], ['Gdańsk', 'pl'], ['kılıç', 'tr']]) {
    const d = LT.detecterLangue(t);
    assert.deepEqual([d.langue, d.sure], [lg, true], t);
  }
  for (const t of ['casque', 'Drache', 'perro']) assert.equal(LT.detecterLangue(t).sure, false, t);
});
test('troisieme relecture (mutant L4) : un MOT OUTIL etranger en tete (« Le », « El », « Les », « Un ») n ouvre pas un nom propre', () => {
  // avec un mot outil capitalise pris pour le debut d'un nom, « Le Vieux Chevalier » etait ecarte comme nom propre : le prompt francais
  // ne partait plus au traducteur sous une interface anglaise
  const cas = [['fr', 'Le Vieux Chevalier en armure, highly detailed, 8k'], ['es', 'El Gran Dragón Rojo con alas, highly detailed'],
    ['fr', 'Les Trois Mousquetaires en armure, highly detailed'], ['fr', 'Un Grand Dragon dort sur son or, highly detailed']];
  const fautes = cas.filter(([lg, t]) => LT.langueSource(t, 'en') !== lg).map(([lg, t]) => `${t} : ${LT.langueSource(t, 'en')} au lieu de ${lg}`);
  assert.deepEqual(fautes, []);
});
