// Composeur d'intention (2026-10-03) : buildFullPrompt et stripKnownPromptSuffixes, VRAIS, extraits des deux index2.js (bureau et web) avec leurs
// vraies tables de gabarits. Aucune page, aucun reseau, aucun GPU.
//   - un personnage qui TIENT quelque chose recoit une clause precise et un gabarit qui ne dit plus l'inverse ;
//   - un texte sans objet tenu donne EXACTEMENT le meme prompt qu'avec le composeur coupe (window.__composeurIntention = false) ;
//   - composer puis relire (Enhance puis Generate) redonne le texte de l'utilisateur : la clause ne s'accumule pas ;
//   - NEGATIONS de l'utilisateur (« no helmet », « without a beard ») : la relecture ne les supprime plus, l'envoi les sort du prompt et les met au negatif
//     (negativeExtra), l'affichage (Enhance) les garde, et seuls les residus des ANCIENS gabarits sont encore retires.
// Rejouer contre l'ANCIEN code (les tests de negations doivent alors ECHOUER) :
//   LIB_JS=<ancienne lib> INDEX2_BUREAU=<ancien src/renderer/index2.js> INDEX2_WEB=<ancien cloud/public/app/index2.js> node --test tests/bureau-interface/composeur-prompt.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as acorn from 'acorn';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// la lib est un module ES dans un .js : on en importe une copie .mjs temporaire
const dossier = mkdtempSync(join(tmpdir(), 'composeur-prompt-'));
let LIB;
try {
  const copie = join(dossier, 'composeur-intention.mjs');
  writeFileSync(copie, readFileSync(process.env.LIB_JS || join(RACINE, 'src/renderer/lib/composeur-intention.js'), 'utf-8'));
  LIB = await import(pathToFileURL(copie).href);
} finally {
  rmSync(dossier, { recursive: true, force: true });
}

const DECLARATIONS = ['ASSET_TYPE_PROMPTS', 'ASSET_STYLE_PROMPTS', 'ASSET_TYPE_PREFIXES', 'ASSET_TYPE_PREFIXES_ANCIENS', '_TYPES_UNITE',
  '_TENUE_PREHISTORIQUE', '_TENUES_EPOQUE', '_epoqueUnite', '_MOTS_VOL', '_parleDeVol', '_DEMANDE_EN', '_DEMANDE_FR', '_epurerDemande',
  'buildFullPrompt', 'stripKnownPromptSuffixes', '_optionsPose'];
// declarations ajoutees avec les negations : facultatives ici pour que ce fichier puisse AUSSI tourner contre l'ancien code (ses tests de negations echouent alors, c'est la preuve)
const DECLARATIONS_NEGATIONS = ['_optionsAffichage', '_sansNegations', '_negativeExtraDe', '_retirerPolitesseFin'];

const CHEMINS = { 'src/renderer/index2.js': process.env.INDEX2_BUREAU, 'cloud/public/app/index2.js': process.env.INDEX2_WEB };
function charger(chemin) {
  const src = readFileSync(CHEMINS[chemin] || join(RACINE, chemin), 'utf-8');
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
  const morceaux = [];
  const vus = new Set();
  for (const n of ast.body) {
    let nom = null;
    if (n.type === 'VariableDeclaration' && n.declarations.length === 1 && n.declarations[0].id.type === 'Identifier') nom = n.declarations[0].id.name;
    else if (n.type === 'FunctionDeclaration') nom = n.id.name;
    if (nom && (DECLARATIONS.includes(nom) || DECLARATIONS_NEGATIONS.includes(nom)) && !vus.has(nom)) { vus.add(nom); morceaux.push(src.slice(n.start, n.end)); }
  }
  const manque = DECLARATIONS.filter((d) => !vus.has(d));
  assert.deepEqual(manque, [], chemin + ' : declarations introuvables ' + manque.join(', '));
  const f = new Function('analyserIntention', 'composerGabarit', 'clauseObjetTenu', 'retirerClauseFinale', 'composeurActif', 'modeDepuisTexte',
    'positifSansNegations', 'negationsDe', 'assainirNegatifs', 'texteDUnAncienGabarit', 'retirerNegationsGabarit', 'nettoyerVirgules',
    morceaux.join('\n') + '\nreturn { buildFullPrompt, stripKnownPromptSuffixes, _optionsPose, ASSET_STYLE_PROMPTS, ASSET_TYPE_PROMPTS, ASSET_TYPE_PREFIXES, _epurerDemande,\n      _optionsAffichage: typeof _optionsAffichage === "function" ? _optionsAffichage : undefined,\n      _sansNegations: typeof _sansNegations === "function" ? _sansNegations : undefined,\n      _negativeExtraDe: typeof _negativeExtraDe === "function" ? _negativeExtraDe : undefined };');
  return f(LIB.analyser, LIB.composerGabarit, LIB.clauseObjetTenu, LIB.retirerClauseFinale, LIB.actif, () => null,
    LIB.positifSansNegations, LIB.negationsDe, LIB.assainirNegatifs, LIB.texteDUnAncienGabarit, LIB.retirerNegationsGabarit, LIB.nettoyerVirgules);
}

const ORC = 'An orc warrior covered in blood, holding a massive spiked club';
const CLAUSE_ORC = 'holding exactly one massive spiked club in the right hand, left hand open and empty';
// MEME chaine que build_enriched_prompt de Modal (build/bancs/noyaux/test_composeur_modal.py::ORC_ATTENDU) : le client et le serveur composent pareil
const ORC_ATTENDU = 'An orc warrior covered in blood, holding a massive spiked club, '
  + 'holding exactly one massive spiked club in the right hand, left hand open and empty, '
  + 'dark fantasy, gothic grimdark, dramatic chiaroscuro lighting, weathered ornate detail, brooding, '
  + 'isolated 3D character, full body, fully clothed, T-pose, arms extended horizontally, legs apart, strict front view, facing camera, '
  + 'plain white background, entire figure and held item fully visible, generous empty margins';

const NEG_ORC = 'An orc warrior covered in blood, no helmet, holding a massive spiked club';
const TEXTES_NEG = [
  ['An orc, no helmet, holding a club', ['helmet']],
  ['A knight without a helmet and holding a sword', ['helmet']],
  [NEG_ORC, ['helmet']],
  ['A dragon, no wings', ['wings']],
  ['a cat - no tail - sitting', ['tail']],
  ['A tower, no windows and no doors, with a flag', ['windows', 'doors']],
  ['An elf, without any weapons or armor', ['weapons', 'armor']],
  ['A pirate, not wearing a hat, no shadows', ['hat', 'shadows']],
  ['an orc (no helmet) holding a club', ['helmet']],
  ['A man with no hat', ['hat']],
];
const PARITE = {};

for (const [nom, chemin] of [['bureau', 'src/renderer/index2.js'], ['web', 'cloud/public/app/index2.js']]) {
  const P = charger(chemin);
  const style = Object.keys(P.ASSET_STYLE_PROMPTS).includes('dark-fantasy') ? 'dark-fantasy' : 'realistic';

  test(nom + ' : un orc qui tient une massue recoit la clause et un gabarit qui ne se contredit plus', () => {
    const p = P.buildFullPrompt(ORC, 'character', style);
    assert.ok(p.startsWith(ORC + ', ' + CLAUSE_ORC), 'la clause suit IMMEDIATEMENT le texte de l\'utilisateur : ' + p);
    assert.ok(!p.includes('empty open hands'), 'le gabarit disait « empty open hands » : ' + p);
    assert.ok(!/\bsymmetric\b/.test(p), 'le gabarit disait « symmetric » : ' + p);
    assert.ok(!p.includes('clean silhouette'));
    assert.ok(p.endsWith('entire figure and held item fully visible, generous empty margins'), p);
    assert.ok(p.includes('T-pose') && p.includes('arms extended horizontally'), 'la T-pose reste imposee (decision du proprietaire pour la pose) : ' + p);
    assert.equal(p.split(CLAUSE_ORC).length - 1, 1, 'une seule clause');
    if (style === 'dark-fantasy') assert.equal(p, ORC_ATTENDU, 'client et Modal composent la meme chaine');
  });

  test(nom + ' : sans objet tenu, le prompt est identique, a l\'octet, a celui du composeur coupe', () => {
    // (« A knight without a weapon » n'y est plus : la locution negative quitte le prompt, voir les tests de negations plus bas)
    const textes = ['An orc', 'A medieval peasant', 'A monk, unarmed', 'A man holding his breath', 'A cat sitting'];
    for (const type of ['character', 'other_living', 'vehicle', 'building', 'weapon', 'prop', 'creature', 'animal']) {
      for (const t of textes) {
        const avec = P.buildFullPrompt(t, type, 'realistic');
        globalThis.window = { __composeurIntention: false };
        let sans;
        try { sans = P.buildFullPrompt(t, type, 'realistic'); } finally { delete globalThis.window; }
        assert.equal(avec, sans, type + ' / ' + t);
      }
    }
  });

  test(nom + ' : un type qui n\'est pas une unite n\'est jamais touche, meme avec « holding »', () => {
    for (const type of ['vehicle', 'building', 'weapon', 'prop', 'creature', 'animal']) {
      const t = 'A statue holding a flag';
      const avec = P.buildFullPrompt(t, type, 'realistic');
      globalThis.window = { __composeurIntention: false };
      let sans;
      try { sans = P.buildFullPrompt(t, type, 'realistic'); } finally { delete globalThis.window; }
      assert.equal(avec, sans, type);
    }
  });

  test(nom + ' : composer puis relire (Enhance puis Generate) redonne le texte de l\'utilisateur, la clause ne s\'accumule pas', () => {
    const textes = [ORC, 'A knight with a sword in his left hand', 'A samurai wielding two katanas', 'A barbarian wielding a greatsword with both hands',
      'A knight holding a sword and a shield', 'A farmer holding a pitchfork', 'An orc', 'A wizard holding a wooden staff'];
    for (const t of textes) {
      const un = P.buildFullPrompt(t, 'character', style);
      const relu = P.stripKnownPromptSuffixes(un);
      assert.equal(relu, t, 'relecture : ' + JSON.stringify(relu) + ' au lieu de ' + JSON.stringify(t));
      const deux = P.buildFullPrompt(relu, 'character', style);
      assert.equal(deux, un, 'deuxieme composition differente');
    }
  });

  test(nom + ' : l\'ecriture de l\'utilisateur n\'est jamais prise pour une clause generee', () => {
    const t = 'knight holding exactly one sword in the right hand, left hand open and empty';
    const relu = P.stripKnownPromptSuffixes(P.buildFullPrompt(t, 'character', style));
    assert.ok(relu.includes('holding exactly one sword'), 'texte de l\'utilisateur perdu : ' + relu);
  });

  // ── case « T-pose » (2026-10-03) ──────────────────────────────────────────────────────────────────────────────────────────
  const CONSIGNES_TPOSE = ['T-pose', 'arms extended horizontally', 'legs apart', 'symmetric', 'empty open hands'];
  // les mots-cles par lesquels le pont du bureau (_is_tpose) et le site (_tposeDemande) reconnaissent un prompt de T-pose
  const MOTS_TPOSE = /t-pose|t pose|tpose|arms extended horizontally|rts unit|neutral stance/i;

  test(nom + ' : case T-pose decochee = pose libre (plus aucune consigne de T-pose, ni de mot que le pont ou le site prendraient pour une T-pose)', () => {
    const libre = P.buildFullPrompt('An orc warrior', 'character', 'realistic', { tpose: false });
    for (const c of CONSIGNES_TPOSE) assert.ok(!libre.includes(c), c + ' : ' + libre);
    assert.ok(!MOTS_TPOSE.test(libre), 'le pont / le site y verraient une T-pose : ' + libre);
    for (const garde of ['isolated 3D character', 'full body', 'fully clothed', 'strict front view', 'facing camera', 'plain white background', 'clean silhouette']) {
      assert.ok(libre.includes(garde), garde);
    }
    const defaut = P.buildFullPrompt('An orc warrior', 'character', 'realistic');
    assert.ok(MOTS_TPOSE.test(defaut) && defaut.includes('T-pose'), 'par defaut : T-pose');
    assert.equal(P.buildFullPrompt('An orc warrior', 'character', 'realistic', {}), defaut);
    assert.equal(P.buildFullPrompt('An orc warrior', 'character', 'realistic', { tpose: true }), defaut);
  });

  test(nom + ' : pose libre et objet tenu : la clause reste, la T-pose part', () => {
    const libre = P.buildFullPrompt(ORC, 'character', 'dark-fantasy', { tpose: false });
    assert.ok(libre.startsWith(ORC + ', ' + CLAUSE_ORC), libre);
    for (const c of CONSIGNES_TPOSE) assert.ok(!libre.includes(c), c);
    assert.ok(libre.endsWith('entire figure and held item fully visible, generous empty margins'), libre);
  });

  test(nom + ' : pose libre : composer puis relire redonne le texte (Enhance puis Generate)', () => {
    for (const t of ['An orc', ORC, 'A knight with a sword in his left hand', 'A soldier sitting on a chair']) {
      const un = P.buildFullPrompt(t, 'character', style, { tpose: false });
      assert.equal(P.stripKnownPromptSuffixes(un), t, JSON.stringify(P.stripKnownPromptSuffixes(un)));
      assert.equal(P.buildFullPrompt(P.stripKnownPromptSuffixes(un), 'character', style, { tpose: false }), un);
    }
  });

  test(nom + " : l'option pose libre ne touche que les unites ; les autres types sont identiques", () => {
    for (const type of ['vehicle', 'building', 'weapon', 'prop', 'creature', 'animal', 'other_living']) {
      assert.equal(P.buildFullPrompt('A thing', type, 'realistic', { tpose: false }), P.buildFullPrompt('A thing', type, 'realistic'), type);
    }
  });

  test(nom + " : l'interrupteur d'urgence coupe les adaptations d'intention mais respecte la case", () => {
    globalThis.window = { __composeurIntention: false };
    try {
      const libre = P.buildFullPrompt(ORC, 'character', 'dark-fantasy', { tpose: false });
      for (const c of CONSIGNES_TPOSE) assert.ok(!libre.includes(c), c);
      assert.ok(!libre.includes('holding exactly one'), 'pas de clause : le composeur est coupe');
      const defaut = P.buildFullPrompt(ORC, 'character', 'dark-fantasy');
      assert.ok(defaut.includes('empty open hands') && !defaut.includes('holding exactly one'), "et par defaut le gabarit d'origine");
    } finally { delete globalThis.window; }
  });

  test(nom + ' : _optionsPose lit la case : decochee + personnage = pose libre, sinon T-pose', () => {
    const avecCase = (checked) => { globalThis.document = { getElementById: (id) => (id === 'ws-tpose' ? { checked } : null) }; };
    try {
      avecCase(false);
      assert.deepEqual(P._optionsPose('character'), { tpose: false });
      assert.deepEqual(P._optionsPose('vehicle'), {}, 'seul le personnage est concerne');
      avecCase(true);
      assert.deepEqual(P._optionsPose('character'), {});
      globalThis.document = { getElementById: () => null };
      assert.deepEqual(P._optionsPose('character'), {}, 'case absente : T-pose, comme avant');
    } finally { delete globalThis.document; }
  });

  // ── negations de l'utilisateur (2026-10-03) ───────────────────────────────────────────────────────────────────────────────
  // « an orc, no helmet, holding a club » : le modele d'image dessine ce qu'on lui demande d'eviter. Avant, stripKnownPromptSuffixes SUPPRIMAIT « no helmet » en silence ;
  // maintenant le texte la garde, la generation sort la locution du prompt envoye, et le terme (« helmet ») part au negatif (champ negativeExtra).
  const avecDocument = (fn) => { globalThis.document = { getElementById: () => null }; try { return fn(); } finally { delete globalThis.document; } };
  const coupe = (fn) => { globalThis.window = { __composeurIntention: false }; try { return fn(); } finally { delete globalThis.window; } };

  test(nom + " : stripKnownPromptSuffixes ne supprime plus les negations de l'utilisateur (avant : « no helmet » disparaissait en silence)", () => {
    for (const t of ['An orc, no helmet, holding a club', 'A knight, without a beard', 'a dragon, not flying', 'An orc, no shadows, no text', 'A cat, never smiling',
      'no helmet', 'A tower, no windows and no doors, with a flag', 'a house with no roof', 'A man, NOT a portrait']) {
      assert.equal(P.stripKnownPromptSuffixes(t), t, t);
    }
  });

  test(nom + " : prompt ENVOYE sans la locution, terme au negatif ; l'orc a la MEME chaine que Modal sans negation", () => avecDocument(() => {
    const p = P.buildFullPrompt(NEG_ORC, 'character', 'dark-fantasy');
    assert.ok(!/no helmet/i.test(p), 'la locution est restee dans le prompt : ' + p);
    assert.equal(p, ORC_ATTENDU, 'client et Modal composent la meme chaine, negation ou pas');
    assert.deepEqual(P._negativeExtraDe(NEG_ORC), ['helmet']);
    for (const [t, termes] of TEXTES_NEG) {
      const envoye = P.buildFullPrompt(t, 'character', 'realistic');
      assert.deepEqual(P._negativeExtraDe(t), termes, t);
      for (const terme of termes) assert.ok(!new RegExp('\\b(?:no|without|not wearing)\\s+(?:a |an |any )?' + terme + '\\b', 'i').test(envoye), t + ' -> ' + envoye);
    }
  }));

  test(nom + " : Enhance -> Generate -> prompt envoye -> negatifs : la negation survit a l'affichage, puis part au negatif ; rien ne s'accumule", () => avecDocument(() => {
    for (const [t, termes] of TEXTES_NEG) {
      for (const type of ['character', 'other_living', 'vehicle', 'building', 'weapon', 'prop', 'creature', 'animal']) {
        const affiche = P.buildFullPrompt(t, type, style, P._optionsAffichage(type));          // ce que « Enhance » ecrit dans la zone de texte
        assert.ok(affiche.includes(t) || P._negativeExtraDe(t).length === 0, type + ' : la locution doit rester dans le texte AFFICHE : ' + affiche);
        const relu = P.stripKnownPromptSuffixes(affiche);                                      // ce que « Generate » relit
        assert.equal(relu, t, type + ' / ' + t + ' : relecture ' + JSON.stringify(relu));
        assert.deepEqual(P._negativeExtraDe(relu), termes, type + ' / ' + t);
        const envoye = P.buildFullPrompt(relu, type, style, P._optionsPose(type));
        assert.equal(envoye, P.buildFullPrompt(t, type, style, P._optionsPose(type)), type + ' : meme prompt envoye avec ou sans Enhance');
        assert.equal(P.buildFullPrompt(relu, type, style, P._optionsAffichage(type)), affiche, type + ' : deuxieme Enhance identique (aucune accumulation)');
        assert.notEqual(envoye, affiche, type + ' : l\'affichage et l\'envoi different par la locution');
      }
    }
  }));

  test(nom + ' : la detection du vol et le composeur lisent le texte SANS la negation (« a bird, not flying » ne choisit pas le gabarit en vol)', () => avecDocument(() => {
    const t = 'a bird, not flying';
    for (const opts of [{}, { garderNegations: true }]) {
      const p = P.buildFullPrompt(t, 'animal', 'realistic', opts);
      assert.ok(p.includes('all four feet on ground') && !p.includes('airborne'), JSON.stringify(opts) + ' : ' + p);
    }
    assert.ok(P.buildFullPrompt('a bird flying', 'animal', 'realistic').includes('airborne'), 'temoin : sans negation, le vol est detecte');
    // le composeur d'objets tenus : « no weapon, holding a shield » garde son bouclier (le texte brut disait « sans arme »)
    const c = P.buildFullPrompt('A knight, no weapon, holding a shield', 'character', 'realistic');
    assert.ok(c.includes('holding exactly one shield'), c);
    const relu = P.stripKnownPromptSuffixes(P.buildFullPrompt('A knight, no weapon, holding a shield', 'character', 'realistic', P._optionsAffichage('character')));
    assert.equal(relu, 'A knight, no weapon, holding a shield', 'la clause generee sur le texte sans negation est bien retiree a la relecture');
  }));

  test(nom + " : un texte entierement negatif garde son positif (un prompt vide ne vaut rien) et envoie quand meme ses termes", () => avecDocument(() => {
    const p = P.buildFullPrompt('no helmet', 'character', 'realistic');
    assert.ok(p.startsWith('no helmet, '), p);
    assert.deepEqual(P._negativeExtraDe('no helmet'), ['helmet']);
    assert.equal(P._sansNegations('no helmet'), 'no helmet');
  }));

  test(nom + " : faux positifs, garde-robe et textes sans negation : rien ne change", () => avecDocument(() => {
    for (const t of ['no one around', 'not only fast but also strong', 'no longer needed', 'a car, not too shiny', 'A man without clothes', 'A woman, no shirt',
      'A monk, unarmed', 'An orc', 'A nose and a north wind', 'a poster titled Without Remorse', 'A knight, none of them wear helmets']) {
      assert.deepEqual(P._negativeExtraDe(t), [], t);
      for (const type of ['character', 'building']) {
        assert.equal(P.buildFullPrompt(t, type, 'realistic'), coupe(() => P.buildFullPrompt(t, type, 'realistic')), t + ' / ' + type);
      }
    }
    // les negations de garde-robe RESTENT dans le prompt : le filtre de moderation de chaque plateforme doit continuer a les lire
    assert.ok(P.buildFullPrompt('A man without clothes', 'character', 'realistic').includes('without clothes'));
  }));

  test(nom + " : interrupteur d'urgence : ancien comportement (la negation est supprimee a la relecture, rien n'est envoye au negatif)", () => avecDocument(() => {
    coupe(() => {
      assert.equal(P.stripKnownPromptSuffixes('An orc, no helmet, holding a club'), 'An orc, holding a club');
      assert.equal(P.stripKnownPromptSuffixes('An orc, NOT a portrait, no shadows'), 'An orc');
      assert.deepEqual(P._negativeExtraDe(NEG_ORC), []);
      assert.equal(P._sansNegations(NEG_ORC), NEG_ORC);
      assert.equal(P.buildFullPrompt(NEG_ORC, 'character', 'realistic'), P.buildFullPrompt(NEG_ORC, 'character', 'realistic', { garderNegations: true }));
    });
  }));

  // ── residus des ANCIENS gabarits ───────────────────────────────────────────────────────────────────────────────────────────
  const HISTO = JSON.parse(readFileSync(join(RACINE, 'tests/bureau-interface/gabarits-historiques.json'), 'utf-8')).lignes;
  const norm = (s) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  const SUJETS = ['An orc warrior holding a club', 'a medieval castle'];
  const STYLE_2 = Object.values(P.ASSET_STYLE_PROMPTS).filter(Boolean)[1];

  test(nom + ' : un ancien gabarit colle derriere un texte est nettoye (62 lignes de l\'historique git) : sujet intact, aucun residu negatif', () => {
    assert.ok(typeof LIB.texteDUnAncienGabarit === 'function', 'la lib n\'a pas texteDUnAncienGabarit');
    const residus = new Set(LIB.NEGATIONS_GABARIT_HISTORIQUES);
    let ancien = 0;
    for (const l of HISTO) {
      if (!LIB.texteDUnAncienGabarit(l.texte)) continue;       // la seule ligne actuelle : le style « hand-painted » (voir le test des signatures)
      ancien++;
      for (const U of SUJETS) {
        for (const s of [U + ', ' + l.texte, STYLE_2 + ', ' + U + ', ' + l.texte]) {
          const out = P.stripKnownPromptSuffixes(s);
          assert.ok(out.includes(U), 'sujet perdu : ' + JSON.stringify(out) + ' <- ' + s.slice(0, 120));
          const reste = out.split(',').map(norm).filter((x) => residus.has(x));
          assert.deepEqual(reste, [], 'residus negatifs encore la : ' + reste.join(' | ') + ' <- ' + l.texte.slice(0, 100));
          if (l.nettoye_par_l_ancien_code[nom]) assert.equal(out, U, 'REGRESSION : l\'ancien nettoyeur rendait le sujet seul pour ' + l.texte.slice(0, 100));
        }
      }
    }
    assert.ok(ancien >= 60, 'lignes historiques avec signature : ' + ancien);
  });

  test(nom + " : les negations de l'utilisateur survivent a un ancien gabarit ; seule la liste historique part", () => {
    const ligne = HISTO.find((l) => l.texte.startsWith('ONE building only'));
    assert.ok(ligne, 'ligne de reference introuvable');
    assert.equal(P.stripKnownPromptSuffixes('a castle, no moat, ' + ligne.texte), 'a castle, no moat');
    assert.equal(P.stripKnownPromptSuffixes('An orc, without a beard, ' + HISTO[0].texte), 'An orc, without a beard');
    // un texte d'AUJOURD'HUI qui reprend des mots de l'ancien gabarit n'est pas un ancien gabarit : « no shadows » reste a l'utilisateur
    assert.equal(P.stripKnownPromptSuffixes('A castle, no shadows, no text, no duplicate'), 'A castle, no shadows, no text, no duplicate');
    assert.deepEqual(P._negativeExtraDe('A castle, no shadows, no text, no duplicate'), ['shadows', 'text', 'duplicate']);
  });

  test(nom + ' : signatures et liste historique : aucune ligne des tables ACTUELLES n\'est prise pour un ancien gabarit', () => {
    const actuelles = [...Object.values(P.ASSET_TYPE_PROMPTS), ...Object.values(P.ASSET_STYLE_PROMPTS), ...Object.values(P.ASSET_TYPE_PREFIXES)].filter(Boolean);
    for (const a of actuelles) assert.equal(LIB.texteDUnAncienGabarit(a), false, 'ligne actuelle prise pour un ancien gabarit : ' + a.slice(0, 100));
    // aucune ligne actuelle ne porte de negation, sauf le style « hand-painted » (« no realistic PBR maps »), qui est dans la liste historique
    const residus = new Set(LIB.NEGATIONS_GABARIT_HISTORIQUES);
    const dedans = actuelles.flatMap((a) => a.split(',').map(norm)).filter((x) => residus.has(x));
    assert.deepEqual([...new Set(dedans)], ['no realistic pbr maps']);
    for (const a of actuelles) {
      for (const seg of a.split(',').map(norm)) {
        if (/^(?:no|not|never)\b/.test(seg)) assert.ok(residus.has(seg), 'segment negatif d\'un gabarit actuel absent de la liste historique : ' + seg);
      }
    }
    // chaque ligne de l'historique est reconnue, et chacun de ses segments negatifs est dans la liste
    for (const l of HISTO) {
      for (const seg of l.texte.split(',').map(norm)) {
        if (/^(?:no|not|never)\b/.test(seg)) assert.ok(residus.has(seg), 'segment negatif historique absent de la liste : ' + seg + ' <- ' + l.texte.slice(0, 80));
      }
    }
    // la liste : formes normalisees, sans doublon, que des segments negatifs
    assert.equal(new Set(LIB.NEGATIONS_GABARIT_HISTORIQUES).size, LIB.NEGATIONS_GABARIT_HISTORIQUES.length, 'doublons');
    for (const s of LIB.NEGATIONS_GABARIT_HISTORIQUES) assert.ok(s === norm(s) && /^(?:no|not|never)\b/.test(s), 'forme non normalisee : ' + s);
    for (const s of LIB.SIGNATURES_GABARITS_ANCIENS) assert.ok(s === s.toLowerCase() && s.length > 8, 'signature : ' + s);
  });

  // ── robustesse : 100 000 caracteres en moins d'une seconde ─────────────────────────────────────────────────────────────────
  test(nom + ' : entrees adverses de 100 000 caracteres : relecture et negations en moins d\'une seconde', () => avecDocument(() => {
    const N = 100000;
    const entrees = {
      'espaces puis x': ' '.repeat(N) + 'x', 'virgules puis x': ','.repeat(N) + 'x', 'espaces-virgules': ', '.repeat(N / 2) + 'x', 'x puis espaces': 'x' + ' '.repeat(N),
      'no x en liste': 'no x, '.repeat(N / 6), 'no sans fin': 'no '.repeat(N / 3), 'without sans fin': 'without '.repeat(N / 8),
      'holding exactly one': 'holding exactly one a, '.repeat(N / 23), 'a': 'a'.repeat(N), 'mot long': 'no ' + 'x'.repeat(N), 'tirets': '- '.repeat(N / 2) + 'no helmet',
      'parentheses': '(no '.repeat(N / 4), 'emoji': '\u{1F600}'.repeat(N / 2), 'gabarit': 'plain white background, '.repeat(N / 24),
      'ancien gabarit': 'ONE building only, no shadows, no text, '.repeat(N / 40),
    };
    const fonctions = { strip: (t) => P.stripKnownPromptSuffixes(t), negativeExtra: (t) => P._negativeExtraDe(t), sansNegations: (t) => P._sansNegations(t) };
    const lents = [];
    for (const [nf, f] of Object.entries(fonctions)) {
      for (const [ne, e] of Object.entries(entrees)) {
        const t0 = performance.now();
        f(e);
        const ms = performance.now() - t0;
        if (ms > 1000) lents.push(nf + ' / ' + ne + ' : ' + Math.round(ms) + ' ms');
      }
    }
    assert.deepEqual(lents, [], 'trop lent');
    // buildFullPrompt aussi (sa regle de politesse de fin, _epurerDemande, etait quadratique : 4 s pour 100 000 blancs avant _retirerPolitesseFin)
    for (const ne of Object.keys(entrees)) {
      const t0 = performance.now();
      P.buildFullPrompt(entrees[ne], 'character', 'realistic');
      P.buildFullPrompt(entrees[ne], 'building', 'realistic', { garderNegations: true });
      const ms = performance.now() - t0;
      assert.ok(ms < 1000, 'buildFullPrompt / ' + ne + ' : ' + Math.round(ms) + ' ms');
    }
  }));

  // ── branchement des handlers (le texte du fichier : les handlers sont des ecouteurs de clic, pas des fonctions extractibles) ──────────────────
  test(nom + ' : les handlers envoient negativeExtra, affichent avec garderNegations et nettoient la vue de dos', () => {
    const src = readFileSync(CHEMINS[chemin] || join(RACINE, chemin), 'utf-8').replace(/\r\n/g, '\n');
    assert.ok(/import \{[^}]*positifSansNegations[^}]*negationsDe[^}]*assainirNegatifs[^}]*\} from '\.\/lib\/composeur-intention\.js'/.test(src), 'import de la lib');
    // l'ENVOI : negativeExtra calcule sur le texte traduit, passe a l'API
    assert.ok(/const negativeExtra = [^\n]*_negativeExtraDe\(/.test(src), 'negativeExtra calcule dans le handler Generate');
    if (nom === 'bureau') {
      assert.ok(src.includes('const _genArgs = { prompt, userPrompt, negativeExtra, engine,'), '_genArgs porte negativeExtra');
      assert.ok(src.includes("(engine === 'hidream') && !_isCloudMode()"), 'HiDream local : pas de canal negatif, la negation reste dans le texte');
    } else {
      assert.ok(src.includes('API.generateImages({ prompt, userPrompt, userPromptEnvoye: _sansNegations(userPrompt), negativeExtra, engine,'), 'le site envoie le texte sans negation ET les termes');
    }
    // l'AFFICHAGE : Enhance, pre-rempli, nouveau projet gardent les negations
    const affichages = [...src.matchAll(/(?:ta|textarea)\.value = buildFullPrompt\([^\n]*\)/g)].map((m) => m[0]).concat(
      [...src.matchAll(/const enhanced = buildFullPrompt\([^\n]*\)/g)].map((m) => m[0]));
    assert.ok(affichages.length >= 3, 'sites d\'affichage trouves : ' + affichages.length);
    for (const a of affichages) assert.ok(/garderNegations|_optionsAffichage/.test(a), 'affichage sans garderNegations : ' + a);
    // la vue de dos n'a pas de canal negatif : la locution n'y est pas dessinee
    const vuesDeDos = [...src.matchAll(/const rawPrompt = [^\n]*\n[^\n]*\n/g)].map((m) => m[0]).filter((x) => /dataset\.rawPrompt/.test(x));
    assert.ok(vuesDeDos.length >= 3, 'lectures de rawPrompt : ' + vuesDeDos.length);
    for (const v of vuesDeDos) assert.ok(v.includes('_sansNegations('), 'vue de dos sans _sansNegations : ' + v);
    // les outils qui relisent le prompt ENREGISTRE du projet (il garde maintenant les negations) pour generer ou detecter le lisent sans les locutions negatives
    const consommateurs = nom === 'bureau'
      ? ["const prompt = _sansNegations((p && (p.prompt || p.initialPrompt)) || '');",                                   // etapes de construction 2D
        "_sansNegations((p && (p.prompt || p.initialPrompt)) || '') || 'high quality, detailed'",                         // variantes
        "_sansNegations(p.prompt || p.initialPrompt || ''))"]                                                            // variantes (sujet)
      : ["_sansNegations(p.prompt || p.initialPrompt || '') || 'variation'", "_sansNegations(p.prompt || p.initialPrompt || ''))"];
    for (const c of consommateurs) assert.ok(src.includes(c), 'consommateur du prompt du projet non nettoye : ' + c);
    assert.ok(src.includes('modeDepuisTexte([p.name, _sansNegations(p.prompt), p.assetType]'), 'mode d\'animation : « not flying » n\'est pas un vol');
    assert.ok(src.includes('especeDepuisTexte([p.name, _sansNegations(p.prompt), p.assetType]'), 'espece d\'animation');
  });

  test(nom + " : un texte de plus de 2 000 caracteres n'est ni tronque ni analyse : ses negations restent dans le prompt, rien n'est perdu", () => avecDocument(() => {
    const queue = ' queue-unique-xyz';
    const long = 'An orc, no helmet, ' + 'word '.repeat(450) + 'holding a club,' + queue;
    assert.ok(long.length > 2000);
    const p = P.buildFullPrompt(long, 'building', 'realistic');
    assert.ok(p.includes('no helmet'), 'la negation reste dans le texte (le texte est trop long pour etre analyse)');
    assert.ok(p.includes('queue-unique-xyz'), 'la fin du texte de l\'utilisateur ne doit jamais etre coupee');
    assert.deepEqual(P._negativeExtraDe(long), [], 'pas d\'analyse au-dela de 2 000 caracteres : aucun terme envoye');
    assert.equal(P._sansNegations(long), long);
    assert.equal(P.stripKnownPromptSuffixes(long), long);
    // juste en dessous : analyse normale
    const court = 'An orc, no helmet, ' + 'word '.repeat(300);
    assert.deepEqual(P._negativeExtraDe(court), ['helmet']);
  }));

  test(nom + " : _epurerDemande : la politesse de fin part, comme avec l'ancienne regle (qui etait quadratique)", () => {
    assert.ok(typeof P._epurerDemande === 'function');
    const ancienne = (brut) => {
      // l'ancienne regle d'origine, recopiee : /[\s,;.!]*\b(?:please|thanks|thank you|merci)\b[\s.!]*$/i
      const t = brut.replace(/[\s,;.!]*\b(?:please|thanks|thank you|merci)\b[\s.!]*$/i, '').trim();
      return t.length >= 3 ? t : brut.trim();
    };
    for (const t of ['a knight, please', 'a knight please!', 'A knight. Thank you!', 'A knight, thanks', 'Un chevalier, merci.', 'displease', 'a knight xplease', 'a knight pleasex',
      'A knight THANK YOU', 'a knight, thank  you', 'a knight thanks,', 'please', 'a knight.thanks', 'knight_please', 'a knight pléase', 'no thanks, a knight', 'a knight, please, thanks']) {
      assert.equal(P._epurerDemande(t), ancienne(t), JSON.stringify(t));
    }
    assert.equal(P._epurerDemande('a knight, please'), 'a knight');
    assert.equal(P._epurerDemande('displease'), 'displease');
    assert.equal(P._epurerDemande('a knightplease'), 'a knightplease', 'pas de coupe au milieu d\'un mot');
  });

  PARITE[nom] = P;
}

test('parite bureau / web : memes prompts envoyes et affiches, memes relectures, memes termes de negatif', () => {
  const B = PARITE.bureau;
  const W = PARITE.web;
  globalThis.document = { getElementById: () => null };
  try {
    for (const [t] of TEXTES_NEG) {
      for (const type of ['character', 'vehicle', 'building', 'creature', 'animal']) {
        assert.equal(B.buildFullPrompt(t, type, 'realistic'), W.buildFullPrompt(t, type, 'realistic'), 'envoye : ' + type + ' / ' + t);
        assert.equal(B.buildFullPrompt(t, type, 'realistic', B._optionsAffichage(type)), W.buildFullPrompt(t, type, 'realistic', W._optionsAffichage(type)), 'affiche : ' + type + ' / ' + t);
      }
      assert.equal(B.stripKnownPromptSuffixes(t), W.stripKnownPromptSuffixes(t), t);
      assert.deepEqual(B._negativeExtraDe(t), W._negativeExtraDe(t), t);
    }
  } finally { delete globalThis.document; }
});

test('imports : chaque nom importe de la lib par les deux index2.js est exporte par les DEUX copies de la lib (un nom manquant tue le module dans le navigateur)', () => {
  const exportsDe = (chemin) => {
    const ast = acorn.parse(readFileSync(join(RACINE, chemin), 'utf-8'), { ecmaVersion: 'latest', sourceType: 'module' });
    const noms = new Set();
    for (const n of ast.body) {
      if (n.type !== 'ExportNamedDeclaration') continue;
      if (n.declaration && n.declaration.type === 'FunctionDeclaration') noms.add(n.declaration.id.name);
      if (n.declaration && n.declaration.type === 'VariableDeclaration') for (const d of n.declaration.declarations) noms.add(d.id.name);
      for (const s of n.specifiers || []) noms.add(s.exported.name);
    }
    return noms;
  };
  const libs = { bureau: exportsDe('src/renderer/lib/composeur-intention.js'), web: exportsDe('cloud/public/app/lib/composeur-intention.js') };
  for (const [nom, chemin] of [['bureau', 'src/renderer/index2.js'], ['web', 'cloud/public/app/index2.js']]) {
    const ast = acorn.parse(readFileSync(CHEMINS[chemin] || join(RACINE, chemin), 'utf-8'), { ecmaVersion: 'latest', sourceType: 'module' });
    const importes = [];
    for (const n of ast.body) {
      if (n.type === 'ImportDeclaration' && String(n.source.value).endsWith('composeur-intention.js')) importes.push(...n.specifiers.map((s) => s.imported.name));
    }
    assert.ok(importes.length >= 6, nom + ' : imports de la lib introuvables');
    for (const nomImporte of importes) {
      for (const [nomLib, noms] of Object.entries(libs)) assert.ok(noms.has(nomImporte), nom + ' importe ' + nomImporte + ', absent de la lib ' + nomLib);
    }
  }
});
