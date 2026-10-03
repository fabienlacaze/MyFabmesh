// Composeur d'intention (2026-10-03) : buildFullPrompt et stripKnownPromptSuffixes, VRAIS, extraits des deux index2.js (bureau et web) avec leurs
// vraies tables de gabarits. Aucune page, aucun reseau, aucun GPU.
//   - un personnage qui TIENT quelque chose recoit une clause precise et un gabarit qui ne dit plus l'inverse ;
//   - un texte sans objet tenu donne EXACTEMENT le meme prompt qu'avec le composeur coupe (window.__composeurIntention = false) ;
//   - composer puis relire (Enhance puis Generate) redonne le texte de l'utilisateur : la clause ne s'accumule pas.
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
  writeFileSync(copie, readFileSync(join(RACINE, 'src/renderer/lib/composeur-intention.js'), 'utf-8'));
  LIB = await import(pathToFileURL(copie).href);
} finally {
  rmSync(dossier, { recursive: true, force: true });
}

const DECLARATIONS = ['ASSET_TYPE_PROMPTS', 'ASSET_STYLE_PROMPTS', 'ASSET_TYPE_PREFIXES', 'ASSET_TYPE_PREFIXES_ANCIENS', '_TYPES_UNITE',
  '_TENUE_PREHISTORIQUE', '_TENUES_EPOQUE', '_epoqueUnite', '_MOTS_VOL', '_parleDeVol', '_DEMANDE_EN', '_DEMANDE_FR', '_epurerDemande',
  'buildFullPrompt', 'stripKnownPromptSuffixes'];

function charger(chemin) {
  const src = readFileSync(join(RACINE, chemin), 'utf-8');
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
  const morceaux = [];
  const vus = new Set();
  for (const n of ast.body) {
    let nom = null;
    if (n.type === 'VariableDeclaration' && n.declarations.length === 1 && n.declarations[0].id.type === 'Identifier') nom = n.declarations[0].id.name;
    else if (n.type === 'FunctionDeclaration') nom = n.id.name;
    if (nom && DECLARATIONS.includes(nom) && !vus.has(nom)) { vus.add(nom); morceaux.push(src.slice(n.start, n.end)); }
  }
  const manque = DECLARATIONS.filter((d) => !vus.has(d));
  assert.deepEqual(manque, [], chemin + ' : declarations introuvables ' + manque.join(', '));
  const f = new Function('analyserIntention', 'composerGabarit', 'clauseObjetTenu', 'retirerClauseFinale', 'composeurActif', 'modeDepuisTexte',
    morceaux.join('\n') + '\nreturn { buildFullPrompt, stripKnownPromptSuffixes, ASSET_STYLE_PROMPTS, ASSET_TYPE_PROMPTS };');
  return f(LIB.analyser, LIB.composerGabarit, LIB.clauseObjetTenu, LIB.retirerClauseFinale, LIB.actif, () => null);
}

const ORC = 'An orc warrior covered in blood, holding a massive spiked club';
const CLAUSE_ORC = 'holding exactly one massive spiked club in the right hand, left hand open and empty';
// MEME chaine que build_enriched_prompt de Modal (build/bancs/noyaux/test_composeur_modal.py::ORC_ATTENDU) : le client et le serveur composent pareil
const ORC_ATTENDU = 'An orc warrior covered in blood, holding a massive spiked club, '
  + 'holding exactly one massive spiked club in the right hand, left hand open and empty, '
  + 'dark fantasy, gothic grimdark, dramatic chiaroscuro lighting, weathered ornate detail, brooding, '
  + 'isolated 3D character, full body, fully clothed, T-pose, arms extended horizontally, legs apart, strict front view, facing camera, '
  + 'plain white background, entire figure and held item fully visible, generous empty margins';

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
    const textes = ['An orc', 'A medieval peasant', 'A knight without a weapon', 'A monk, unarmed', 'A man holding his breath', 'A cat sitting'];
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
}
