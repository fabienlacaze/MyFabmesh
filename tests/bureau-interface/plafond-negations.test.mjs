// Plafond de negations PAR ROUTE (24/10, decision du proprietaire : 20).
//   - routes a encodeur long (generation d'image : text2image, T-pose...) : NEG_MAX_LONG = 20 termes ;
//   - outils a appel direct (budget CLIP de 77 jetons) : NEG_MAX_DIRECT = 8 ; une fonction sans plafond prend le plus prudent (8).
// Chaque test echoue si le plafond est ignore, mal transmis ou mal borne. Execute les VRAIES bibliotheques des deux exemplaires (bureau et site) ; les fichiers
// d'interface (index2.js) sont verifies par leur texte, les messages par les tables de langue.
// Lancer : node --test tests/bureau-interface/plafond-negations.test.mjs      (ancien code : COMPOSEUR_JS=<ancienne lib>)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dossier = mkdtempSync(join(tmpdir(), 'plafond-neg-'));
const lire = (rel) => readFileSync(join(RACINE, rel), 'utf-8').replace(/\r\n/g, '\n');

async function charger(nom, chemin) {
  const copie = join(dossier, nom + '.mjs');
  writeFileSync(copie, readFileSync(chemin, 'utf-8'));
  return import(pathToFileURL(copie).href);
}

const EXEMPLAIRES = { bureau: 'src/renderer', site: 'cloud/public/app' };
const C = {};
for (const [nom, rel] of Object.entries(EXEMPLAIRES)) C[nom] = await charger('composeur-' + nom, process.env.COMPOSEUR_JS || join(RACINE, rel, 'lib/composeur-intention.js'));

const MOTS = ['helmet', 'cape', 'sword', 'shield', 'crown', 'boots', 'belt', 'ring', 'staff', 'horns', 'wings', 'tail', 'beard', 'scarf', 'gloves', 'amulet', 'spear',
  'quiver', 'hood', 'mask', 'banner', 'chain'];
const virgules = (n) => 'An orc warrior, ' + (n ? MOTS.slice(0, n).map((m) => 'no ' + m).join(', ') + ', ' : '') + 'holding an axe';

for (const nom of Object.keys(C)) {
  const L = C[nom];
  test(nom + ' : constantes 8 / 20', () => {
    assert.equal(L.NEG_MAX_DIRECT, 8);
    assert.equal(L.NEG_MAX_LONG, 20);
    assert.equal(L.MAX_TERMES_NEGATIFS, 8);
  });

  test(nom + ' : 12, 20 et 21 negations sur une route longue (les 20 premieres au negatif, la 21e retiree du positif et annoncee)', () => {
    for (const [n, gardes, perdus] of [[12, 12, []], [20, 20, []], [21, 20, ['banner']]]) {
      const t = virgules(n);
      const r = L.negationsEtPositif(t, undefined, L.NEG_MAX_LONG);
      assert.deepEqual(r.negatifs, MOTS.slice(0, gardes), String(n));
      assert.deepEqual(r.perdus || [], perdus, String(n));
      assert.equal(r.positif, 'An orc warrior, holding an axe', `les ${n} locutions quittent le positif`);
      assert.deepEqual(L.negationsPerdues(t, undefined, L.NEG_MAX_LONG), perdus);
      assert.equal(L.detecterAvertissements(t, t, 'prop', { plafond: L.NEG_MAX_LONG }).includes('negations-en-trop'), perdus.length > 0, String(n));
      assert.deepEqual(L.negationsDe(t, undefined, L.NEG_MAX_LONG), MOTS.slice(0, gardes));
    }
  });

  test(nom + ' : 9 negations sur un outil direct (plafond 8 ou absent) : la 9e est annoncee', () => {
    const t = virgules(9);
    for (const plafond of [undefined, L.NEG_MAX_DIRECT]) {
      const r = L.negationsEtPositif(t, undefined, plafond);
      assert.deepEqual(r.negatifs, MOTS.slice(0, 8));
      assert.deepEqual(r.perdus, ['staff']);
      assert.equal(r.positif, 'An orc warrior, holding an axe');
      assert.ok(L.detecterAvertissements(t, t, 'prop', { plafond }).includes('negations-en-trop'));
    }
    assert.ok(!L.detecterAvertissements(t, t, 'prop', { plafond: L.NEG_MAX_LONG }).includes('negations-en-trop'), 'la meme phrase sur une route longue : rien a annoncer');
    assert.ok(L.detecterAvertissements(t, t, 'prop').includes('negations-en-trop'), 'sans options : le plus prudent');
  });

  test(nom + ' : les trois formes de liste', () => {
    for (const [n, perdus] of [[12, []], [20, []], [22, MOTS.slice(20, 22)]]) {
      const mots = MOTS.slice(0, n);
      const formes = [
        'An orc with no ' + mots.slice(0, -1).join(', ') + ' or ' + mots[n - 1] + ', holding an axe',
        'An orc without ' + mots.join(' and ') + ', holding an axe',
        'An orc, ' + mots.map((m) => 'no ' + m).join(', ') + ', holding an axe',
      ];
      for (const f of formes) {
        const r = L.negationsEtPositif(f, undefined, L.NEG_MAX_LONG);
        assert.deepEqual(r.negatifs, mots.slice(0, 20), f.slice(0, 50));
        assert.deepEqual(r.perdus || [], perdus, f.slice(0, 50));
        assert.match(r.positif, /holding an axe/);
        for (const m of mots) assert.ok(!r.positif.split(/\W+/).includes(m), `la locution ${m} est restee dans le positif : ${r.positif}`);
      }
    }
  });

  test(nom + ' : 0 a 8 negations : le MEME resultat qu\'avant a l\'octet, quel que soit le plafond', () => {
    for (let n = 0; n <= 8; n++) {
      const t = virgules(n);
      const avant = L.extraireNegations(t);
      for (const p of [undefined, 8, 20]) {
        assert.deepEqual(L.extraireNegations(t, undefined, p), avant, `${n} / ${p}`);
        assert.deepEqual(L.negationsEtPositif(t, undefined, p), L.negationsEtPositif(t), `${n} / ${p}`);
      }
      if (n === 0) assert.equal(avant.positif, t, 'sans negation : le texte a l\'octet');
    }
  });

  test(nom + ' : plafond invalide = le plus prudent (8)', () => {
    const t = virgules(12);
    for (const p of [0, -1, 21, 99, 8.5, '20', [20], null, NaN, true]) assert.equal(L.extraireNegations(t, undefined, p).negatifs.length, 8, String(p));
  });

  test(nom + ' : assainirNegatifs a chaque plafond', () => {
    assert.deepEqual(L.assainirNegatifs(MOTS), MOTS.slice(0, 8));
    assert.deepEqual(L.assainirNegatifs(MOTS, 8), MOTS.slice(0, 8));
    assert.deepEqual(L.assainirNegatifs(MOTS, 20), MOTS.slice(0, 20));
    assert.deepEqual(L.assainirNegatifs(MOTS, 12), MOTS.slice(0, 12));
    assert.deepEqual(L.assainirNegatifs(MOTS, 99), MOTS.slice(0, 8));
  });
}

test('bureau et site : memes sorties a chaque plafond', () => {
  for (const n of [0, 8, 9, 12, 20, 21, 25]) {
    for (const p of [undefined, 8, 20]) {
      const t = virgules(n);
      assert.deepEqual(C.bureau.negationsEtPositif(t, undefined, p), C.site.negationsEtPositif(t, undefined, p));
    }
  }
});

// ── l'interface passe bien le plafond de la route longue, des DEUX cotes ──────────────────────────────────────────────────
for (const [nom, rel] of Object.entries(EXEMPLAIRES)) {
  const src = lire(rel + '/index2.js');
  test(nom + ' index2.js : la generation d\'image passe NEG_MAX_LONG (termes, avertissement, message)', () => {
    assert.match(src, /detecterAvertissements, NEG_MAX_LONG \} from '\.\/lib\/composeur-intention\.js'/);
    assert.ok(src.includes('assainirNegatifs(negationsDe(_epurerDemande(texte), undefined, NEG_MAX_LONG), NEG_MAX_LONG)'), '_negativeExtraDe');
    assert.ok(src.includes('detecterAvertissements(texteSaisi, texteAnglais, assetType, { ..._optionsPose(assetType), plafond: NEG_MAX_LONG })'), '_verifierAvantDepense');
    assert.ok(src.includes("_i18nTf(_TEXTES_AVERTISSEMENT[c], NEG_MAX_LONG, NEG_MAX_LONG)"), 'le message donne le plafond reel');
    assert.ok(!/more than 8 things/.test(src), 'plus de « 8 » ecrit en dur dans le message');
  });
}

// ── message : plafond reel, 5 langues, deux exemplaires, aucun nom de moteur ──────────────────────────────────────────────
const CLE = 'You list more than {x} things to avoid (no X, without X). Only the first {y} are applied as exclusions; the others are removed from your description and may still appear. Shorten the list.';
for (const [nom, rel] of Object.entries(EXEMPLAIRES)) {
  test(nom + ' : le message « negations-en-trop » existe dans les 5 langues avec {x} et {y}, sans chiffre en dur ni nom de moteur', () => {
    assert.ok(lire(rel + '/index2.js').includes(CLE), 'cle anglaise de index2.js');
    const tables = lire(rel + '/lang/_additions6.js');
    const ligne = tables.split('\n').find((l) => l.includes(JSON.stringify(CLE)));
    assert.ok(ligne, 'la table de langue porte la cle');
    const traductions = JSON.parse(ligne.slice(ligne.indexOf('": [') + 3).replace(/,\s*$/, ''));
    assert.equal(traductions.length, 5, 'fr, es, zh, hi, ar');
    for (const t of traductions) {
      assert.ok(t.includes('{x}') && t.includes('{y}'), t);
      assert.ok(!/(^|[^0-9{])8([^0-9}]|$)/.test(t) && !/20/.test(t), 'aucun plafond ecrit en dur : ' + t);
      assert.ok(!/trellis|unirig|puppeteer|realvis|clipseg|juggernaut|skintokens|unimate/i.test(t), 'nom de moteur : ' + t);
    }
    assert.ok(!/trellis|unirig|puppeteer|realvis|clipseg/i.test(CLE));
  });
}

// ── les envois (client -> serveur) acceptent 20 termes et pas un de plus ──────────────────────────────────────────────────
test('meshyAPI-cloud.js, main.js et cloud_fallback.js : 20 termes au plus, plus 8', () => {
  assert.ok(lire('cloud/public/app/meshyAPI-cloud.js').includes('if (sortie.length >= 20) break;'));
  assert.ok(lire('src/main/main.js').includes('if (sortie.length >= 20) break;'));
  assert.ok(lire('src/main/cloud_fallback.js').includes('.slice(0, 20)'));
  assert.ok(!lire('src/main/cloud_fallback.js').includes('.slice(0, 8)'));
});
