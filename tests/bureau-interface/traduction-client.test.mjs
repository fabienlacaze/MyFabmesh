// TRADUCTION DU TEXTE DE L'UTILISATEUR COTE INTERFACE (2026-10-13, lot 2 de l'audit de la langue du 11/10) — VRAIES fonctions des deux
// index2.js (bureau et web), extraites avec acorn ; traducteur, fenetre et page simules. Aucun reseau, aucun Electron.
//   - la langue SOURCE est celle du TEXTE (TRADUCTION-01/07, CHAMPS-04) ; un prompt anglais n'est jamais renvoye au traducteur (TRADUCTION-06) ;
//   - un ECHEC est dit : { echec, raison } ; une generation payante demande « Reessayer / Envoyer tel quel » (TRADUCTION-03, CHAMPS-05/21,
//     SERVEUR-03) ; annule = rien n'est lance ;
//   - Generate traduit la partie de l'utilisateur d'un champ enrichi, meme avec un mot du gabarit (MANQUE-01, CHAMPS-06/23) ;
//   - stripKnownPromptSuffixes ne detruit plus un texte qui contient un marqueur de gabarit au milieu d'une phrase (MANQUE-03) ;
//   - le bloc commun est identique bureau / web ; l'aide de langue du bureau dit quand aucun traducteur n'est joignable (TRADUCTION-02).
// Lancer : node --test tests/bureau-interface/traduction-client.test.mjs
// Ancien code : WEB_INDEX2=<copie> BUREAU_INDEX2=<copie> node --test tests/bureau-interface/traduction-client.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as acorn from 'acorn';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FICHIERS = {
  bureau: process.env.BUREAU_INDEX2 || join(RACINE, 'src/renderer/index2.js'),
  web: process.env.WEB_INDEX2 || join(RACINE, 'cloud/public/app/index2.js'),
};

// modules ES dans des .js : copies .mjs temporaires
const dossier = mkdtempSync(join(tmpdir(), 'traduction-client-'));
let LT, COMPO;
try {
  const c1 = join(dossier, 'langue-texte.mjs');
  writeFileSync(c1, readFileSync(join(RACINE, 'src/renderer/lib/langue-texte.js'), 'utf-8'));
  LT = await import(pathToFileURL(c1).href);
  const c2 = join(dossier, 'composeur-intention.mjs');
  writeFileSync(c2, readFileSync(join(RACINE, 'src/renderer/lib/composeur-intention.js'), 'utf-8'));
  COMPO = await import(pathToFileURL(c2).href);
} finally {
  rmSync(dossier, { recursive: true, force: true });
}

const NOMS = ['_cacheTraductions', '_etatTraduction', '_langueInterface', '_majEtatTraduction', '_occupationTraduction', '_ressembleAnglais',
  'traduireTexteUtilisateur', 'translateUserPrompt', '_traduirePourGeneration', 'MSG_TRADUCTION', '_messageTraduction',
  '_choixTraductionEchouee', '_indiceDosAnglais', '_texteUtilisateurPourGeneration', '_corrigerFauxAmis', 'stripKnownPromptSuffixes',
  'ASSET_TYPE_PROMPTS', 'ASSET_STYLE_PROMPTS', 'ASSET_TYPE_PREFIXES', 'ASSET_TYPE_PREFIXES_ANCIENS', 'PROMPT_LANG_HINT',
  '_updatePromptLangHint', '_sonderTraducteur'];

function extraire(chemin) {
  const src = readFileSync(chemin, 'utf-8');
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
  const morceaux = [];
  const vus = new Set();
  for (const n of ast.body) {
    let nom = null;
    if (n.type === 'VariableDeclaration' && n.declarations.length === 1 && n.declarations[0].id.type === 'Identifier') nom = n.declarations[0].id.name;
    else if (n.type === 'FunctionDeclaration') nom = n.id.name;
    if (nom && NOMS.includes(nom) && !vus.has(nom)) { vus.add(nom); morceaux.push(src.slice(n.start, n.end)); }
  }
  return { src, morceaux, vus };
}

/** Monde simule : interface en `langue`, traducteur `traduire(args)` (ou absent), choix de la fenetre `choix` (liste consommee). */
function monter(cheminFichier, { langue = 'fr', traduire = null, choix = [], statut = null } = {}) {
  const { morceaux, vus } = extraire(cheminFichier);
  const appels = [];
  const fenetre = { ouvertures: 0, messages: [] };
  const aides = [];
  const ecouteurs = {};
  const element = (id) => ({
    id, textContent: '', style: {}, value: '',
    classList: { _h: new Set(['hidden']), add(c) { this._h.add(c); }, remove(c) { this._h.delete(c); }, contains(c) { return this._h.has(c); } },
    addEventListener(t, f) { (ecouteurs[id + ':' + t] ||= []).push(f); },
    removeEventListener(t, f) { ecouteurs[id + ':' + t] = (ecouteurs[id + ':' + t] || []).filter((g) => g !== f); },
    focus() {},
  });
  const els = { 'modal-confirm': element('modal-confirm'), 'confirm-title': element('confirm-title'), 'confirm-message': element('confirm-message'),
    'confirm-ok': element('confirm-ok'), 'confirm-cancel': element('confirm-cancel'), 'lang-select': Object.assign(element('lang-select'), { value: langue }) };
  // la fenetre « traduction impossible » : on clique selon `choix` des qu'elle s'ouvre
  const origRemove = els['modal-confirm'].classList.remove.bind(els['modal-confirm'].classList);
  els['modal-confirm'].classList.remove = (c) => {
    origRemove(c);
    if (c !== 'hidden') return;
    fenetre.ouvertures++;
    fenetre.messages.push(els['confirm-message'].textContent);
    const c0 = choix.shift() || 'annuler';
    setTimeout(() => {
      if (c0 === 'reessayer') (ecouteurs['confirm-ok:click'] || []).slice().forEach((f) => f());
      else if (c0 === 'tel-quel') (ecouteurs['confirm-cancel:click'] || []).slice().forEach((f) => f());
      else (ecouteurs['document:keydown'] || []).slice().forEach((f) => f({ key: 'Escape' }));
    }, 0);
  };
  const document = {
    getElementById: (id) => els[id] || null,
    querySelectorAll: (sel) => (sel === '.prompt-lang-hint' ? [{ set textContent(v) { aides.push(v); }, style: {} }] : []),
    addEventListener(t, f) { (ecouteurs['document:' + t] ||= []).push(f); },
    removeEventListener(t, f) { ecouteurs['document:' + t] = (ecouteurs['document:' + t] || []).filter((g) => g !== f); },
  };
  const window = {
    meshyAPI: {
      translatePrompt: traduire ? async (args) => { appels.push(args); return traduire(args, appels.length); } : undefined,
      translateStatus: statut ? async () => statut : undefined,
    },
    confirm: () => false,
  };
  const localStorage = { getItem: () => langue };
  const doublures = {
    window, document, localStorage, setTimeout, clearTimeout, API: window.meshyAPI,   // l'ancien web appelait API.translatePrompt
    langueSource: LT.langueSource, normaliserCodeLangue: LT.normaliserCodeLangue, ressembleAnglais: LT.ressembleAnglais,
    retirerClauseFinale: COMPO.retirerClauseFinale,
    _setPromptBusy: () => {}, _clearPromptBusy: () => {}, TRANSLATING_MSG: {},
  };
  for (const n of ['_updatePromptLangHint', 'PROMPT_LANG_HINT', '_sonderTraducteur']) if (!vus.has(n)) doublures[n] = n === 'PROMPT_LANG_HINT' ? {} : (() => {});
  const exportes = NOMS.filter((n) => vus.has(n));
  const cles = Object.keys(doublures).filter((k) => !vus.has(k));
  // eslint-disable-next-line no-new-func
  const f = new Function(...cles, morceaux.join('\n') + '\nreturn { ' + exportes.join(', ')
    + ', etat: () => (typeof _etatTraduction === "undefined" ? undefined : _etatTraduction) };');
  return { M: f(...cles.map((k) => doublures[k])), appels, fenetre, aides, vus };
}

const CORPUS = JSON.parse(readFileSync(join(RACINE, 'build/intention_cas.json'), 'utf-8')).map((c) => c.texte);
const traducteurOk = ({ text }) => ({ text: 'EN:' + text, translated: true });

for (const [nom, chemin] of Object.entries(FICHIERS)) {
  test(nom + ' : la langue SOURCE est celle du TEXTE (avant : celle de l interface, ou rien sous une interface anglaise)', async () => {
    const a = monter(chemin, { langue: 'en', traduire: traducteurOk });
    const r = await a.M.translateUserPrompt('un dragon rouge avec des ailes');
    assert.equal(r, 'EN:un dragon rouge avec des ailes', 'interface anglaise + texte francais : traduit');
    assert.equal(a.appels[0].from, 'fr');
    const b = monter(chemin, { langue: 'fr', traduire: traducteurOk });
    await b.M.translateUserPrompt('ein roter Drache mit Flügeln');
    assert.equal(b.appels[0].from, 'de', 'texte allemand sous une interface francaise : source de');
    await b.M.translateUserPrompt('un dragón rojo con alas');
    assert.equal(b.appels[1].from, 'es');
  });

  test(nom + ' : un prompt ANGLAIS n est jamais renvoye au traducteur (corpus du proprietaire : 21 sur 64 l etaient)', async () => {
    const a = monter(chemin, { langue: 'fr', traduire: traducteurOk });
    for (const t of CORPUS) assert.equal(await a.M.translateUserPrompt(t), t);
    for (const t of ['a red dragon', 'wooden barrel', 'A stone golem']) assert.equal(await a.M.translateUserPrompt(t), t);
    assert.equal(a.appels.length, 0, 'appels inutiles : ' + JSON.stringify(a.appels.slice(0, 5)));
  });

  test(nom + ' : ECHEC dit (raison), plus jamais confondu avec un succes ; cache des reussites', async () => {
    const echec = monter(chemin, { langue: 'fr', traduire: ({ text }) => ({ text, translated: false, raison: 'rate-limited' }) });
    const r = await echec.M.traduireTexteUtilisateur('un dragon rouge avec des ailes');
    assert.equal(r.echec, true);
    assert.equal(r.raison, 'rate-limited');
    assert.equal(r.texte, 'un dragon rouge avec des ailes');
    assert.equal(echec.M.etat(), 'echec', 'l aide de langue passe en « traduction indisponible »');
    const lent = monter(chemin, { langue: 'fr', traduire: () => new Promise(() => {}) });
    const r2 = await lent.M.traduireTexteUtilisateur('un dragon rouge avec des ailes', { plafondMs: 30 });
    assert.equal(r2.echec, true);
    assert.equal(r2.raison, 'timeout');
    const ok = monter(chemin, { langue: 'fr', traduire: traducteurOk });
    await ok.M.translateUserPrompt('un chevalier sans casque');
    await ok.M.translateUserPrompt('un chevalier sans casque');
    assert.equal(ok.appels.length, 1, 'un meme texte n est traduit qu une fois');
  });

  test(nom + ' : generation payante + echec -> fenetre « Reessayer / Envoyer tel quel » ; Echap = rien n est lance', async () => {
    let n = 0;
    const retente = monter(chemin, { langue: 'fr', choix: ['reessayer'],
      traduire: ({ text }) => (++n === 1 ? { text, translated: false, raison: 'failed' } : { text: 'EN:' + text, translated: true }) });
    assert.deepEqual(await retente.M._traduirePourGeneration('un chevalier sans casque'), { texte: 'EN:un chevalier sans casque', telQuel: false });
    assert.equal(retente.fenetre.ouvertures, 1);
    assert.match(retente.fenetre.messages[0], /anglais/);
    const telQuel = monter(chemin, { langue: 'fr', choix: ['tel-quel'], traduire: ({ text }) => ({ text, translated: false, raison: 'failed' }) });
    assert.deepEqual(await telQuel.M._traduirePourGeneration('un chevalier sans casque'), { texte: 'un chevalier sans casque', telQuel: true });
    const annule = monter(chemin, { langue: 'fr', choix: ['annuler'], traduire: ({ text }) => ({ text, translated: false, raison: 'failed' }) });
    assert.equal(await annule.M._traduirePourGeneration('un chevalier sans casque'), null);
    // texte deja anglais : aucune fenetre, aucun appel
    const en = monter(chemin, { langue: 'fr', traduire: traducteurOk });
    assert.deepEqual(await en.M._traduirePourGeneration('a red dragon'), { texte: 'a red dragon', telQuel: false });
    assert.equal(en.fenetre.ouvertures + en.appels.length, 0);
  });

  test(nom + ' : Generate traduit la partie de l utilisateur d un champ enrichi, meme avec un mot du gabarit (avant : envoyee brute)', async () => {
    const a = monter(chemin, { langue: 'fr', traduire: traducteurOk });
    const T = a.M.ASSET_STYLE_PROMPTS;
    const enrichi = T.realistic + ', a red dragon with wings, avec des flammes';
    const r = await a.M._texteUtilisateurPourGeneration(enrichi);
    assert.equal(r.texte, 'EN:a red dragon with wings, avec des flammes');
    const b = monter(chemin, { langue: 'fr', traduire: traducteurOk });
    const r2 = await b.M._texteUtilisateurPourGeneration('un chevalier en armure, photorealistic');
    assert.equal(r2.texte, 'EN:un chevalier en armure');
    // champ enrichi entierement anglais : aucun appel
    const c = monter(chemin, { langue: 'fr', traduire: traducteurOk });
    const r3 = await c.M._texteUtilisateurPourGeneration(T.realistic + ', a red dragon with golden wings');
    assert.equal(r3.texte, 'a red dragon with golden wings');
    assert.equal(c.appels.length, 0);
  });

  test(nom + ' : vue de dos : l indice part TRADUIT (avant : le texte d origine de l utilisateur)', async () => {
    const a = monter(chemin, { langue: 'fr', traduire: traducteurOk });
    assert.deepEqual(await a.M._indiceDosAnglais('un chevalier avec une cape rouge'), { texte: 'EN:un chevalier avec une cape rouge', telQuel: false });
  });

  test(nom + ' : stripKnownPromptSuffixes ne detruit plus un texte qui contient un marqueur au milieu (« a complete boat... » -> « a »)', () => {
    const { M } = monter(chemin, { langue: 'en' });
    for (const t of ['a complete boat with white sails', 'a complete vehicle with open doors', 'a full structure of wooden beams',
      'an isolated 3D character in a red cape', 'architectural building exterior with a glass facade', 'a flat app icon of a rocket']) {
      assert.equal(M.stripKnownPromptSuffixes(t), t, t);
    }
    // les vieux gabarits restent nettoyes (proposition entiere)
    assert.equal(M.stripKnownPromptSuffixes('medieval townhall, architectural building exterior, complete edifice, nothing cropped'), 'medieval townhall');
    assert.equal(M.stripKnownPromptSuffixes('3D game asset reference sheet, full body character sheet, a winged dragon'), 'a winged dragon');
    assert.equal(M.stripKnownPromptSuffixes('a red boat, complete boat, 3/4 isometric view'), 'a red boat');
  });
}

test('le bloc « TRADUCTION COMMUNE » est IDENTIQUE dans les deux index2.js', () => {
  const bloc = (p) => {
    const s = readFileSync(p, 'utf-8').replace(/\r\n/g, '\n');
    const i = s.indexOf('// --- TRADUCTION COMMUNE : DEBUT ---');
    const j = s.indexOf('// --- TRADUCTION COMMUNE : FIN ---');
    assert.ok(i >= 0 && j > i, p + ' : bloc commun absent');
    return s.slice(i, j);
  };
  assert.equal(bloc(FICHIERS.bureau), bloc(FICHIERS.web));
});

test('bureau : sans moteur IA local ni session MyFabmesh, l aide le DIT (avant : « traduit auto » en mode Cloud, rien n etait traduit)', async () => {
  const a = monter(FICHIERS.bureau, { langue: 'fr', traduire: traducteurOk, statut: { local: false, cloud: false } });
  assert.ok(a.vus.has('_sonderTraducteur'), '_sonderTraducteur absent');
  await a.M._sonderTraducteur();
  assert.equal(a.M.etat(), 'indisponible');
  assert.match(a.aides.at(-1), /aucun traducteur/i);
  const b = monter(FICHIERS.bureau, { langue: 'fr', traduire: traducteurOk, statut: { local: false, cloud: true } });
  await b.M._sonderTraducteur();
  assert.equal(b.M.etat(), 'ok', 'session MyFabmesh : la traduction passe par le site');
});
