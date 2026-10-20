// INTEGRATION 20/10 — « la chaine ENVOYEE a la generation est la chaine VERIFIEE par le filtre de securite ».
// Assemble le lot de la TRADUCTION du texte de l'utilisateur (filet de langue du worker) et le lot des NEGATIONS de l'utilisateur (« no helmet » sort du
// prompt, le terme part au negatif). Aucun des deux ne connaissait l'autre : le filtre voit « texte + negations », le filet de langue REMPLACE le texte
// par sa traduction, et la traduction etait reverifiee SANS les negations alors que Modal recoit (traduction + termes de negatif).
// VRAIES fonctions de cloud/src/worker.ts (handleGenerateImage, _filetLangue, _refusChaineEnvoyee, _nettoyerNegativeExtra...), VRAI filtre de contenu
// (src/nsfw_filter.ts) et VRAIES fonctions des deux index2.js (buildFullPrompt, _negativeExtraDe...) ; seuls Modal, Workers AI, Supabase et R2 sont simules.
// Prouve :
//   1. generation et route T-pose : un texte etranger dont la TRADUCTION est sure seule, mais bloquee avec les negations que le client en a sorties,
//      n'atteint JAMAIS Modal (400 avant tout debit) ; avant l'assemblage : 200 et Modal recevait la paire bloquee ;
//   2. pour une requete ACCEPTEE, la chaine reellement envoyee a Modal (texte + termes de negatif) est celle que le filtre a examinee, caractere pour
//      caractere (la composition « texte, no X, without X » de _texteDeModerationNegations), sur les deux plateformes (client du SITE : texte sans
//      locution + negativeExtra ; client du BUREAU en mode Cloud : prompt enrichi + negativeExtra) ;
//   3. le texte que le client compose a partir d'un texte avec negations est bloque comme avant quand il est dangereux, et passe sinon.
// Lancer : cd cloud && node --test tests/chaine-verifiee-integration.test.mjs
// Ancien code : WORKER_SRC=<worker avant l'assemblage> node --test tests/chaine-verifiee-integration.test.mjs  (le test 1 echoue)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import * as acorn from 'acorn';
import { chargerFonctions, existe, creerR2 } from './_charge-worker.mjs';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const _exiger = createRequire(import.meta.url);
const ts = _exiger('typescript');

// ── modules ES charges sous forme de copie .mjs temporaire ───────────────────────────────────────────────────────────────────────────────────
async function importerModule(chemin, nom) {
  const dossier = mkdtempSync(join(tmpdir(), 'chaine-verifiee-'));
  try {
    const copie = join(dossier, nom);
    writeFileSync(copie, readFileSync(chemin, 'utf-8'));
    return await import(pathToFileURL(copie).href);
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
}
const LangueTexte = await importerModule(process.env.LIB_LANGUE || join(RACINE, 'cloud/public/app/lib/langue-texte.js'), 'langue-texte.mjs');
const LIB = await importerModule(process.env.LIB_JS || join(RACINE, 'src/renderer/lib/composeur-intention.js'), 'composeur-intention.mjs');

// ── le VRAI filtre de contenu ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const _srcFiltre = readFileSync(process.env.NSFW_FILTER_SRC || join(RACINE, 'cloud/src/nsfw_filter.ts'), 'utf8');
const _jsFiltre = ts.transpileModule(_srcFiltre, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const FILTRE = new Function('exports', 'require', _jsFiltre + '\nreturn { checkPromptSafety: exports.checkPromptSafety, checkHardFloor: exports.checkHardFloor };')({}, _exiger);

// ── le VRAI client : buildFullPrompt, _negativeExtraDe... extraits des deux index2.js ───────────────────────────────────────────────────────────
const DECLARATIONS = ['ASSET_TYPE_PROMPTS', 'ASSET_STYLE_PROMPTS', 'ASSET_TYPE_PREFIXES', 'ASSET_TYPE_PREFIXES_ANCIENS', '_TYPES_UNITE',
  '_TENUE_PREHISTORIQUE', '_TENUES_EPOQUE', '_epoqueUnite', '_MOTS_VOL', '_parleDeVol', '_DEMANDE_EN', '_DEMANDE_FR', '_epurerDemande', '_retirerPolitesseFin',
  'buildFullPrompt', '_optionsPose', '_optionsAffichage', '_sansNegations', '_negativeExtraDe'];
function chargerClient(chemin) {
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
  assert.deepEqual(DECLARATIONS.filter((d) => !vus.has(d)), [], chemin + ' : declarations introuvables');
  const f = new Function('analyserIntention', 'composerGabarit', 'clauseObjetTenu', 'retirerClauseFinale', 'composeurActif', 'modeDepuisTexte',
    'positifSansNegations', 'negationsDe', 'assainirNegatifs', 'document',
    morceaux.join('\n') + '\nreturn { buildFullPrompt, _optionsPose, _sansNegations, _negativeExtraDe, _epurerDemande };');
  return f(LIB.analyser, LIB.composerGabarit, LIB.clauseObjetTenu, LIB.retirerClauseFinale, LIB.actif, () => null,
    LIB.positifSansNegations, LIB.negationsDe, LIB.assainirNegatifs, { getElementById: () => null });
}
const CLIENTS = { site: chargerClient('cloud/public/app/index2.js'), bureau: chargerClient('src/renderer/index2.js') };

// ── le VRAI worker (doublures : Modal, Workers AI, Supabase, R2) ─────────────────────────────────────────────────────────────────────────────
const reponse = (o, init) => new Response(JSON.stringify(o), { status: (init && init.status) || 200, headers: { 'content-type': 'application/json' } });
const err = (status, message) => reponse({ error: message }, { status });
const json = (o, init) => reponse(o, init);
const corpsRequete = (corps, url = '/api/generate-image') => new Request('https://x.example' + url, { method: 'POST', body: JSON.stringify(corps) });

const AUXILIAIRES = ['_traduireVersAnglais', '_decouperPourTraduction', '_derniereCoupe', '_plafondTraduction', 'TRADUCTION_MAX_CARACTERES',
  'TRADUCTION_MORCEAU_MAX', 'TRADUCTION_PLAFOND_HEURE', 'TRADUCTION_PLAFOND_JOUR', 'LANGUES_TRADUITES', '_filetLangue',
  '_quotaTraduction', '_refusFiletLangue', 'TRADUCTION_APPELS_PAR_REQUETE', 'TRADUCTION_PLAFOND_JOUR_COMPTE',
  'TRADUCTION_PLAFOND_JOUR_COMPTE_PAYANT', '_refusChaineEnvoyee'];
const NEGATIONS = ['_nettoyerNegativeExtra', '_texteDeModerationNegations', 'NEG_MAX_TERMES', 'NEG_MAX_CARS', 'NEG_SENSIBLES'];

/** Chaines que le worker a envoyees a Modal et chaines que le filtre a examinees. `traduire(texte)` simule Workers AI. */
function monter({ traduire = (t) => 'EN:' + t, credits = 100 } = {}) {
  const j = { vus: [], depenses: [], modal: [], appelsAI: 0 };
  const ai = { async run(_m, e) { j.appelsAI++; return { translated_text: traduire(e.text) }; } };
  const doublures = {
    getSessionUser: async () => ({ id: 'u1', email: 'a@b.c', credits }), err, json, LangueTexte,
    getParentalState: async () => ({}),
    checkPromptSafety: (t, u) => { j.vus.push(String(t ?? '')); return FILTRE.checkPromptSafety(t, u); },
    _alerterContenuGrave: async () => {}, _isPaidAccount: async () => true,
    getPrice: async (_e, k) => ({ text2image: 6, tpose: 1, back_view: 3 }[k]),
    isTrustedAssetHost: () => true,
    checkAndIncrementModalSpend: async () => 100, checkAndIncrementDailySpend: async () => 100, _spendRefusalMessage: async () => 'refus',
    checkAndIncrementUserCalls: async () => 10, refundModalSpend: async () => {}, refundDailySpend: async () => {},
    spendCredits: async (_e, _u, c) => { j.depenses.push(c); return credits - c; }, addCredits: async () => {},
    callModalTpose: async (_e, _u, i) => { j.modal.push({ route: 'tpose', prompt: i.prompt, negatifs: i.negativeExtra || [] }); return 'https://r2.example/front/t.png'; },
    callModalText2Image: async (_e, _u, i) => { j.modal.push({ route: 'text2image', prompt: i.prompt, negatifs: i.negative_extra || [] }); return 'https://r2.example/front/i.png'; },
    callMyfabmeshCog: async (_e, _u, i) => { j.modal.push({ route: 'cog', prompt: i.prompt, negatifs: [] }); return 'https://r2.example/front/c.png'; },
    callModalBackView: async (_e, _u, i) => { j.modal.push({ route: 'backview', prompt: i.promptHint, negatifs: [] }); return 'https://r2.example/back/b.png'; },
    logOperation: async () => {}, insertUserAsset: async () => {}, r2PathFromPublicUrl: (_e, u) => u,
  };
  // lot de moderation de la langue (pas encore assemble a ce stade) : doublures neutres si le worker les appelle
  for (const n of ['neutraliserSyntaxePrompt']) if (existe(n)) doublures[n] = (t) => t;
  if (existe('_refusLongueur')) doublures._refusLongueur = () => null;
  const noms = ['handleGenerateImage', 'handleGenerateBackView', '_prixImageSelonPas', '_prixImageComplet', '_checkPromptSafetyAlerte', 'categorieContenuGrave', ...AUXILIAIRES, ...NEGATIONS]
    .filter((n) => existe(n) && !(n in doublures));
  const w = chargerFonctions(noms, doublures);
  const env = { AI: ai, MODAL_TEXT2IMAGE_URL: 'https://t2i.example', MODAL_TPOSE_URL: 'https://tpose.example', MESHES: creerR2() };
  const gen = async (corps) => {
    const r = await w.handleGenerateImage(corpsRequete(corps), env);
    let c = null;
    try { c = await r.json(); } catch { /* corps non JSON */ }
    return { status: r.status, corps: c };
  };
  const dos = async (corps) => {
    const r = await w.handleGenerateBackView(corpsRequete(corps, '/api/generate-back-view'), env);
    let c = null;
    try { c = await r.json(); } catch { /* corps non JSON */ }
    return { status: r.status, corps: c };
  };
  return { j, gen, dos, w };
}

/** Le texte que le filtre doit avoir examine pour une chaine envoyee : le texte, plus ses termes de negatif rendus « no X, without X ». */
const examinee = (prompt, negatifs) => (negatifs.length ? prompt + ', ' + negatifs.map((t) => 'no ' + t + ', without ' + t).join(', ') : prompt);

// ── un texte etranger dont la traduction est SURE seule mais BLOQUEE avec ses negations ──────────────────────────────────────────────────────
const SUJET_EN = 'a child';
const TERME = 'weapon';
const ETRANGERS = [
  'ein kleines Kind steht in einem dunklen Wald mit einer roten Laterne',
  'um menino pequeno esta de pe na floresta escura com uma lanterna vermelha',
  'bir kucuk cocuk karanlik ormanda kirmizi bir fener ile duruyor',
  'ein kleiner Junge mit einer roten Muetze und einem Hund neben ihm',
];
function texteEtranger() {
  for (const t of ETRANGERS) {
    if (!FILTRE.checkPromptSafety(examinee(t, [TERME])).safe) continue;           // l'ORIGINAL (etranger) + negations passe le premier controle
    if (!LangueTexte.morceauxEtrangers(t).length) continue;                        // le filet le voit comme etranger
    return t;
  }
  return null;
}

test('construction du banc : sujet sur seul, bloque avec sa negation, terme propre pour le worker, texte etranger disponible', () => {
  assert.equal(FILTRE.checkPromptSafety(SUJET_EN).safe, true, 'le sujet seul passe');
  assert.equal(FILTRE.checkPromptSafety(examinee(SUJET_EN, [TERME])).safe, false, 'avec sa negation (« no X, without X ») le filtre bloque');
  assert.equal(FILTRE.checkHardFloor(examinee(SUJET_EN, [TERME])).safe, true, 'le plancher de Modal, seul, laisserait passer : le filtre du worker est la seule barriere');
  const { w } = monter();
  assert.deepEqual(w._nettoyerNegativeExtra([TERME]), [TERME], 'le terme est accepte par le nettoyage du worker (ni garde-robe ni nudite)');
  assert.ok(texteEtranger(), 'un texte etranger dont l original + negation passe le premier controle');
});

for (const route of ['text2image', 'tpose']) {
  test(`${route} : un texte etranger dont la traduction + les negations du client sont bloquees n'atteint JAMAIS Modal (400 avant tout debit)`, async () => {
    const original = texteEtranger();
    const { j, gen } = monter({ traduire: () => SUJET_EN });
    const corps = route === 'tpose'
      ? { userPrompt: original, prompt: `isolated 3D character, ${original}, plain white background`, asset_type: 'character', tpose: true, projectName: 'P', negativeExtra: [TERME] }
      : { userPrompt: original, asset_type: 'creature', projectName: 'P', negativeExtra: [TERME] };
    const r = await gen(corps);
    assert.equal(r.status, 400, 'statut ' + r.status + ' ' + JSON.stringify(r.corps).slice(0, 160));
    assert.deepEqual(j.modal, [], 'Modal n\'a rien recu');
    assert.deepEqual(j.depenses, [], 'rien debite');
    assert.ok(j.appelsAI >= 1, 'le filet a bien traduit (le test ne prouverait rien sinon)');
  });
}

for (const route of ['text2image', 'tpose']) {
  test(`${route} : requete acceptee, la chaine envoyee a Modal (texte + termes de negatif) est celle que le filtre a examinee, apres traduction`, async () => {
    const original = texteEtranger();
    const traduction = 'a knight with a red lantern in the dark forest';
    const { j, gen } = monter({ traduire: () => traduction });
    const corps = route === 'tpose'
      ? { userPrompt: original, prompt: `isolated 3D character, ${original}, plain white background`, asset_type: 'character', tpose: true, projectName: 'P', negativeExtra: ['helmet', 'beard'] }
      : { userPrompt: original, asset_type: 'creature', projectName: 'P', negativeExtra: ['helmet', 'beard'] };
    const r = await gen(corps);
    assert.equal(r.status, 200, JSON.stringify(r.corps).slice(0, 200));
    assert.equal(j.modal.length, 1);
    const m = j.modal[0];
    assert.equal(m.route, route);
    assert.ok(m.prompt.includes(traduction), 'Modal recoit la traduction : ' + m.prompt);
    assert.ok(!m.prompt.includes(original), 'jamais le texte etranger brut');
    assert.deepEqual(m.negatifs, ['helmet', 'beard']);
    assert.ok(j.vus.includes(examinee(m.prompt, m.negatifs)), 'le filtre n\'a pas examine la chaine telle qu\'envoyee (texte + negations) : ' + examinee(m.prompt, m.negatifs).slice(0, 200));
  });
}

// ── de bout en bout : le VRAI client compose, le VRAI worker verifie ───────────────────────────────────────────────────────────────────────
const TEXTES = [
  ['An orc warrior, no helmet, holding a club', 'character'],
  ['A knight without a beard and holding a sword', 'character'],
  ['A dragon, no wings', 'creature'],
  ['A tower, no windows and no doors, with a flag', 'building'],
  ['An elf, without any weapons or armor', 'character'],
  [`${SUJET_EN}, no ${TERME}`, 'character'],
  [`${SUJET_EN} without a ${TERME}`, 'character'],
  ['A man without clothes', 'character'],
  ['A cat, not flying', 'animal'],
];

for (const plateforme of ['site', 'bureau']) {
  test(`${plateforme} -> worker : tout ce que Modal recoit a ete examine par le filtre tel quel ; un texte dangereux avec negation est bloque, un texte sur passe`, async () => {
    const C = CLIENTS[plateforme];
    let acceptes = 0, bloques = 0;
    for (const [texte, type] of TEXTES) {
      for (const tpose of [false, true]) {
        if (tpose && type !== 'character') continue;
        const negativeExtra = C._negativeExtraDe(texte);
        const prompt = C.buildFullPrompt(texte, type, 'realistic', tpose ? {} : { tpose: false });
        // SITE : le serveur recompose depuis `userPrompt` = le texte SANS les locutions negatives ; BUREAU (mode Cloud) : seul le prompt enrichi part.
        const corps = plateforme === 'site'
          ? { prompt, userPrompt: negativeExtra.length ? C._sansNegations(C._epurerDemande(texte)) : texte, asset_type: type, tpose, ...(negativeExtra.length ? { negativeExtra } : {}) }
          : { prompt, asset_type: type, tpose, ...(negativeExtra.length ? { negativeExtra } : {}) };
        const { j, gen } = monter();
        const r = await gen(corps);
        const nom = `${plateforme} / ${type} / tpose=${tpose} / ${texte}`;
        if (r.status === 400) {
          bloques++;
          assert.deepEqual(j.modal, [], nom + ' : refuse, Modal n\'a rien recu');
          assert.deepEqual(j.depenses, [], nom + ' : refuse avant tout debit');
          continue;
        }
        assert.equal(r.status, 200, nom + ' ' + JSON.stringify(r.corps).slice(0, 160));
        acceptes++;
        for (const m of j.modal) {
          assert.ok(j.vus.includes(examinee(m.prompt, m.negatifs)), nom + ' : la chaine envoyee n\'a pas ete examinee telle quelle : ' + examinee(m.prompt, m.negatifs).slice(0, 160));
          // et la chaine examinee (texte + negations) est sure pour le filtre, puisque la requete est acceptee
          assert.equal(FILTRE.checkPromptSafety(examinee(m.prompt, m.negatifs)).safe, true, nom);
        }
        // les termes de negatif transportes sont ceux que le client a sortis du texte (propres)
        assert.deepEqual(j.modal[0].negatifs, negativeExtra, nom);
      }
    }
    assert.ok(acceptes >= 8, 'requetes acceptees : ' + acceptes);
    assert.ok(bloques >= 2, 'requetes bloquees (enfant + arme, avec ou sans locution) : ' + bloques);
  });
}

// ── la vue de dos n'a pas de canal negatif : le client envoie le texte SANS les locutions negatives (_sansNegations) ; ce que Modal recoit est ce que le filtre a examine ──
for (const plateforme of ['site', 'bureau']) {
  test(`${plateforme} -> worker, VUE DE DOS : l'indice (sans les locutions negatives) part a Modal tel que le filtre l'a examine ; aucune locution negative n'y reste`, async () => {
    const C = CLIENTS[plateforme];
    let acceptes = 0;
    for (const [texte] of TEXTES) {
      const indice = C._sansNegations(C._epurerDemande(texte));
      const { j, dos } = monter();
      const r = await dos({ prompt: indice, promptHint: indice, frontImageUrl: 'https://r2.example/f.png', numImages: 1 });
      if (r.status !== 200) { assert.deepEqual(j.modal, [], texte); continue; }
      acceptes++;
      assert.equal(j.modal.length, 1, texte);
      assert.ok(j.vus.includes(j.modal[0].prompt), texte + ' : l\'indice envoye n\'a pas ete examine tel quel : ' + j.modal[0].prompt);
      if (C._negativeExtraDe(texte).length) assert.ok(!/\b(?:no|without|not) /i.test(j.modal[0].prompt.replace(/\b(?:no|without|not) (?:one|longer|more)\b/ig, '')), texte + ' : une locution negative est restee dans l\'indice : ' + j.modal[0].prompt);
    }
    assert.ok(acceptes >= 5, 'indices acceptes : ' + acceptes);
  });
}
