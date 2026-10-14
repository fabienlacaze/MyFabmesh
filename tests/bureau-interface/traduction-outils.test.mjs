// TRADUCTION DANS LES OUTILS (2026-10-13, lot 2 de l'audit de la langue du 11/10) — les VRAIS gestionnaires de clic des deux index2.js
// (bureau et site) et des deux index2-edit-tools.js, executes dans une page simulee (acorn + portee simulee : aucun Electron, aucun
// reseau, aucun moteur). Pour chaque outil, trois cas :
//   1. traduction reussie : le texte part EN ANGLAIS au moteur (TRADUCTION-04/05, CHAMPS-03/08, SERVEUR-04/05 : Modify, Auto-inpaint,
//      apercu du masque, vue de dos et Paint-mask partaient bruts sur le site ; « Replace with » et l'indice de dos partout) ;
//   2. traduction impossible + Echap : RIEN n'est lance ni debite (TRADUCTION-03, CHAMPS-05, SERVEUR-03 : avant, le texte d'origine
//      partait en silence) ;
//   3. « Envoyer tel quel » : le texte d'origine part, et le site transmet ce choix au serveur (langueVerifiee), dont le filet le respecte.
// Plus : Recolor lit la couleur APRES traduction et ne traduit plus la couleur du nuancier (MANQUE-06, CHAMPS-10) ; Generate traduit
// l'ajout fait dans un champ enrichi et donne au pont du bureau le texte ANGLAIS et le style (MANQUE-01, CHAMPS-06/09/23,
// MANQUE-SERV-01) ; New project detecte le type sur la traduction et laisse le menu libre quand rien n'est detecte (MANQUE-02, CHAMPS-10).
// Lancer : node --test tests/bureau-interface/traduction-outils.test.mjs
// Ancien code : WEB_INDEX2=<copie> BUREAU_INDEX2=<copie> WEB_EDIT_TOOLS=<copie> BUREAU_EDIT_TOOLS=<copie> node --test ...
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as acorn from 'acorn';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const INDEX2 = {
  bureau: process.env.BUREAU_INDEX2 || join(RACINE, 'src/renderer/index2.js'),
  web: process.env.WEB_INDEX2 || join(RACINE, 'cloud/public/app/index2.js'),
};
const OUTILS_EDITION = {
  bureau: process.env.BUREAU_EDIT_TOOLS || join(RACINE, 'src/renderer/index2-edit-tools.js'),
  web: process.env.WEB_EDIT_TOOLS || join(RACINE, 'cloud/public/app/index2-edit-tools.js'),
};

// modules ES dans des .js : copies .mjs temporaires
const dossier = mkdtempSync(join(tmpdir(), 'traduction-outils-'));
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

// Declarations de premier niveau embarquees TELLES QUELLES (celles qui manquent dans un ancien exemplaire sont simplement absentes).
const DECLARATIONS = [
  // traduction (bloc commun) et ce qui l'entoure
  '_cacheTraductions', '_etatTraduction', '_langueInterface', '_majEtatTraduction', '_occupationTraduction', '_ressembleAnglais',
  'traduireTexteUtilisateur', 'translateUserPrompt', '_traduirePourGeneration', 'MSG_TRADUCTION', '_messageTraduction',
  '_choixTraductionEchouee', '_indiceDosAnglais', '_texteUtilisateurPourGeneration', '_corrigerFauxAmis', 'stripKnownPromptSuffixes',
  'ASSET_TYPE_PROMPTS', 'ASSET_STYLE_PROMPTS', 'ASSET_TYPE_PREFIXES', 'ASSET_TYPE_PREFIXES_ANCIENS', 'PROMPT_LANG_HINT', 'TRANSLATING_MSG',
  // outils
  '_stripColorWords', '_RC_COLOR_WORDS', '_ageBuildPrompt', '_ageStrength', '_preremplirPrompt',
  // New project (mode Auto)
  '_npAutoSync', '_npTexteAnalyse', 'NP_TYPE_NON_DETECTE', '_npTraductions', '_npTradMinuteur', '_npDescAuto', '_npAutoInfo', '_npResume',
  'detecterTypeEtStyle', '_npNormaliser', '_NP_TYPES', '_NP_STYLES', '_npCompter', '_i18nT', '_i18nTf',
];

// ------------------------------------------------------------------------------------------------ lecture des fichiers (acorn)
const _analyses = new Map();
/** Cle d'un element qui recoit un 'click' : '#id' pour getElementById('id') / $('id'), le nom pour une variable (mApply). */
function cleElement(o) {
  if (o && o.type === 'ChainExpression') o = o.expression;
  if (o && o.type === 'Identifier') return o.name;
  if (o && o.type === 'CallExpression' && o.arguments.length === 1 && o.arguments[0].type === 'Literal') {
    const c = o.callee;
    if (c.type === 'MemberExpression' && !c.computed && c.property.name === 'getElementById') return '#' + o.arguments[0].value;
    if (c.type === 'Identifier' && c.name === '$') return '#' + o.arguments[0].value;
  }
  return null;
}
function analyser(chemin, sourceType) {
  if (_analyses.has(chemin)) return _analyses.get(chemin);
  const src = readFileSync(chemin, 'utf-8');
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType });
  const decl = new Map();
  for (const n of ast.body) {
    let nom = null;
    if (n.type === 'VariableDeclaration' && n.declarations.length === 1 && n.declarations[0].id.type === 'Identifier') nom = n.declarations[0].id.name;
    else if (n.type === 'FunctionDeclaration') nom = n.id.name;
    if (nom && !decl.has(nom)) decl.set(nom, { debut: n.start, code: src.slice(n.start, n.end) });
  }
  const clics = new Map();   // premier gestionnaire 'click' de chaque element
  const pile = [ast];
  while (pile.length) {
    const n = pile.pop();
    if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && !n.callee.computed && n.callee.property.name === 'addEventListener'
        && n.arguments.length >= 2 && n.arguments[0].type === 'Literal' && n.arguments[0].value === 'click') {
      const cle = cleElement(n.callee.object);
      if (cle && (!clics.has(cle) || clics.get(cle).debut > n.start)) clics.set(cle, { debut: n.start, code: src.slice(n.arguments[1].start, n.arguments[1].end) });
    }
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v)) { for (const x of v) if (x && typeof x.type === 'string') pile.push(x); }
      else if (v && typeof v.type === 'string') pile.push(v);
    }
  }
  const res = { decl, clics };
  _analyses.set(chemin, res);
  return res;
}

// ------------------------------------------------------------------------------------------------ page simulee
/** Portee des doublures : les noms connus rendent leur doublure, un nom inconnu (fonction voisine sans effet sur le cas teste) rend une
 *  fonction vide ; les globales du langage (Promise, Math...) restent les vraies. */
function creerPortee(doublures, journal) {
  const inconnus = new Map();
  const a = (o, n) => Object.prototype.hasOwnProperty.call(o, n);
  return new Proxy(Object.create(null), {
    has(_, nom) {
      if (typeof nom !== 'string') return false;
      if (a(doublures, nom)) return true;
      return !(nom === '__code' || nom === 'eval' || nom === 'arguments' || nom in globalThis);
    },
    get(_, nom) {
      if (typeof nom !== 'string') return undefined;
      if (a(doublures, nom)) return doublures[nom];
      // eslint-disable-next-line func-names
      if (!inconnus.has(nom)) inconnus.set(nom, function () { journal.inconnus.push(nom); return undefined; });
      return inconnus.get(nom);
    },
    set(_, nom, valeur) {
      if (a(doublures, nom)) doublures[nom] = valeur; else inconnus.set(nom, valeur);
      return true;
    },
  });
}
function creerCanvas() {
  const c = { width: 0, height: 0, toDataURL: () => 'data:image/png;base64,AAAA' };
  c.getContext = () => ({ fillStyle: '', fillRect() {}, drawImage() {}, putImageData() {},
    getImageData: (_x, _y, w, h) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)).fill(255) }) });
  return c;
}
/** Faux document : elements crees a la demande ; la fenetre « traduction impossible » (#modal-confirm) est cliquee selon `choix`. */
function creerPage({ champs = {}, choix = [], journal }) {
  const ecouteurs = {};
  const els = {};
  const element = (id) => ({
    id, value: '', checked: false, textContent: '', innerHTML: '', disabled: false, src: '', style: {}, dataset: {}, options: [], selectedIndex: 0,
    classList: { _h: new Set(), add(c) { this._h.add(c); }, remove(c) { this._h.delete(c); }, contains(c) { return this._h.has(c); },
      toggle(c, force) { const on = force === undefined ? !this._h.has(c) : !!force; if (on) this._h.add(c); else this._h.delete(c); return on; } },
    addEventListener(t, f) { (ecouteurs[id + ':' + t] ||= []).push(f); },
    removeEventListener(t, f) { ecouteurs[id + ':' + t] = (ecouteurs[id + ':' + t] || []).filter((g) => g !== f); },
    focus() {}, blur() {}, click() {}, remove() {}, appendChild() {}, setAttribute() {}, getAttribute: () => null,
    querySelector: () => null, querySelectorAll: () => [],
  });
  const document = {
    getElementById: (id) => (els[id] ||= element(id)),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener(t, f) { (ecouteurs['document:' + t] ||= []).push(f); },
    removeEventListener(t, f) { ecouteurs['document:' + t] = (ecouteurs['document:' + t] || []).filter((g) => g !== f); },
    createElement: (tag) => (tag === 'canvas' ? creerCanvas() : element(tag)),
    body: element('body'),
  };
  for (const [id, v] of Object.entries(champs)) Object.assign(document.getElementById(id), v);
  const modal = document.getElementById('modal-confirm');
  modal.classList._h.add('hidden');
  const retirer = modal.classList.remove.bind(modal.classList);
  modal.classList.remove = (c) => {
    retirer(c);
    if (c !== 'hidden') return;
    journal.fenetres.push(document.getElementById('confirm-message').textContent);
    const c0 = choix.shift() || 'annuler';
    setTimeout(() => {
      if (c0 === 'reessayer') (ecouteurs['confirm-ok:click'] || []).slice().forEach((f) => f());
      else if (c0 === 'tel-quel') (ecouteurs['confirm-cancel:click'] || []).slice().forEach((f) => f());
      else (ecouteurs['document:keydown'] || []).slice().forEach((f) => f({ key: 'Escape' }));
    }, 0);
  };
  return { document, els };
}
/** Faux window.meshyAPI : chaque methode est journalisee ; translatePrompt est le traducteur du cas. */
function creerApi({ traduire, reponses, journal }) {
  const rep = { duplicateImageVersion: () => ({ success: true, path: '/projets/P/images/a_mv.png' }), ...reponses };
  return new Proxy({}, {
    get(_, nom) {
      if (typeof nom !== 'string' || nom === 'then') return undefined;
      if (nom === 'translatePrompt') return traduire ? async (a) => { journal.traductions.push(a); return traduire(a); } : undefined;
      if (nom === 'translateStatus') return undefined;
      return async (args) => { journal.api.push({ methode: nom, args }); return rep[nom] ? rep[nom](args) : { success: false, error: 'banc' }; };
    },
  });
}

const MINUTERIES = new Set();
after(() => { for (const t of MINUTERIES) clearTimeout(t); MINUTERIES.clear(); });

const DICO = { 'casco rojo': 'red helmet', 'castillo medieval': 'medieval castle' };
const traducteurOk = (a) => (a.prechauffer ? { ok: true } : { text: DICO[a.text] || ('EN:' + a.text), translated: true });
const traducteurEnPanne = (a) => (a.prechauffer ? { ok: true } : { text: a.text, translated: false, raison: 'failed' });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** Monte un index2.js : declarations reelles + doublures ; lancer('#id') execute le VRAI gestionnaire de clic. */
function monter(plateforme, opts = {}) {
  const { langue = 'fr', traduire = traducteurOk, choix = [], champs = {}, projet = {}, doublures = {}, reponses = {} } = opts;
  const A = analyser(INDEX2[plateforme], 'module');
  const morceaux = DECLARATIONS.filter((n) => A.decl.has(n)).map((n) => A.decl.get(n)).sort((x, y) => x.debut - y.debut).map((d) => d.code);
  const journal = { api: [], traductions: [], fenetres: [], toasts: [], travaux: [], inconnus: [] };
  const page = creerPage({ champs, choix: [...choix], journal });
  const api = creerApi({ traduire, reponses, journal });
  const window = { meshyAPI: api, confirm: () => false };
  const state = { currentProject: { name: 'P', selectedImagePath: '/projets/P/images/a.png', prompt: '', initialPrompt: '', assetType: 'character', ...projet } };
  const base = {
    window, document: page.document, localStorage: { getItem: () => langue, setItem() {}, removeItem() {} }, API: api, state,
    // minuteries suivies : celles qui restent (plafond de 8 s de la traduction...) sont annulees a la fin du fichier
    setTimeout: (f, ms, ...r) => { const t = setTimeout(() => { MINUTERIES.delete(t); f(...r); }, ms); MINUTERIES.add(t); return t; },
    clearTimeout: (t) => { MINUTERIES.delete(t); clearTimeout(t); },
    langueSource: LT.langueSource, normaliserCodeLangue: LT.normaliserCodeLangue, ressembleAnglais: LT.ressembleAnglais,
    retirerClauseFinale: COMPO.retirerClauseFinale,
    showToast: (message, genre) => { journal.toasts.push({ genre, message: String(message) }); },
    gatedRun: (_genre, _nom, fn) => { const pr = Promise.resolve().then(fn); journal.travaux.push(pr); return pr; },
    pushJob: () => ({ id: 'travail-1' }),
    completeJob() {}, customError() {}, renderJobs() {}, reloadCurrentProject: async () => {},
    editTarget: (p) => (p ? p.selectedImagePath : null),
    modifyModal: page.document.getElementById('modal-modify'), modStrength: { value: '60' },
    _rcSelectedColor: '', _npIaType: null, _npTypeMotsCles: null, _aiFirstDetectDone: false,
    _isCloudMode: () => false,
    _reglagesVarianteForme: (_force, _graine, guide, _type, texte) => ({ prompt: guide || texte, cnScale: 0.5, gris: 0, neg: '', motifs: 0 }),
    ...doublures,
  };
  const portee = creerPortee(base, journal);
  // eslint-disable-next-line no-new-func
  const evaluer = new Function('__portee', 'with (__portee) {\n' + morceaux.join('\n') + '\nreturn (__code) => eval(__code);\n}')(portee);
  const lancer = async (cle) => {
    const g = A.clics.get(cle);
    assert.ok(g, INDEX2[plateforme] + ' : gestionnaire ' + cle + ' introuvable');
    const h = evaluer('(' + g.code + ')');
    await h({ preventDefault() {}, stopPropagation() {}, target: page.document.getElementById(cle.slice(1)) });
    await Promise.allSettled(journal.travaux);
  };
  const appels = (methode) => journal.api.filter((x) => x.methode === methode).map((x) => x.args);
  return { lancer, evaluer, appels, existe: (n) => A.decl.has(n), journal, page, window, state, base };
}

/** Les trois cas d'un outil : traduit / echec + Echap / echec + « tel quel ». */
async function troisCas(plateforme, { cle, methode, champs = {}, projet = {}, doublures = {}, reponses = {}, traduit, brut, drapeau = plateforme === 'web' }) {
  const ok = monter(plateforme, { champs, projet, doublures, reponses });
  await ok.lancer(cle);
  const a = ok.appels(methode);
  assert.equal(a.length, 1, `${cle} : un appel a ${methode} ; messages : ${JSON.stringify(ok.journal.toasts)}`);
  traduit(a[0]);
  assert.equal(ok.journal.fenetres.length, 0, `${cle} : traduction reussie, aucune fenetre`);
  if (drapeau) assert.equal(a[0].langueVerifiee, undefined, `${cle} : traduction reussie, rien a signaler au serveur`);

  const annule = monter(plateforme, { champs, projet, doublures, reponses, traduire: traducteurEnPanne, choix: ['annuler'] });
  await annule.lancer(cle);
  assert.equal(annule.journal.fenetres.length, 1, `${cle} : la fenetre « Reessayer / Envoyer tel quel » s'ouvre (avant : rien, texte d'origine envoye)`);
  assert.equal(annule.appels(methode).length, 0, `${cle} : traduction impossible + Echap -> RIEN n'est lance ni debite`);

  const telQuel = monter(plateforme, { champs, projet, doublures, reponses, traduire: traducteurEnPanne, choix: ['tel-quel', 'tel-quel', 'tel-quel'] });
  await telQuel.lancer(cle);
  const t = telQuel.appels(methode);
  assert.equal(t.length, 1, `${cle} : « Envoyer tel quel » lance l'outil`);
  brut(t[0]);
  if (drapeau) assert.equal(t[0].langueVerifiee, true, `${cle} : le choix part au serveur (langueVerifiee), dont le filet ne refusera pas le texte`);
  return { ok, annule, telQuel };
}

for (const plateforme of ['bureau', 'web']) {
  const site = plateforme === 'web';

  test(`${plateforme} : Modify — la consigne part traduite (TRADUCTION-04, CHAMPS-03, SERVEUR-04)`, () => troisCas(plateforme, {
    cle: '#mod-apply', methode: 'img2img',
    champs: { 'mod-prompt': { value: 'rends le casque rouge et doré' }, 'mod-engine': { value: 'cloud' } },
    traduit: (a) => assert.equal(a.prompt, 'EN:rends le casque rouge et doré'),
    brut: (a) => assert.equal(a.prompt, 'rends le casque rouge et doré'),
  }));

  test(`${plateforme} : Auto-inpaint — cible ET remplacement traduits (TRADUCTION-04, CHAMPS-03)`, () => troisCas(plateforme, {
    cle: '#ai-go', methode: 'autoInpaint',
    champs: { 'ai-target': { value: 'le chapeau du chevalier' }, 'ai-replace': { value: 'une couronne en or' }, 'ai-dilate': { value: '15' } },
    traduit: (a) => { assert.equal(a.targetText, 'EN:le chapeau du chevalier'); assert.equal(a.prompt, 'EN:une couronne en or'); },
    brut: (a) => { assert.equal(a.targetText, 'le chapeau du chevalier'); assert.equal(a.prompt, 'une couronne en or'); },
  }));

  if (site) {
    test('web : apercu du masque d Auto-inpaint — la cible part traduite (CLIPSeg ne lit que l anglais)', () => troisCas(plateforme, {
      cle: '#ai-preview-btn', methode: 'segmentMask',
      champs: { 'ai-target': { value: 'le chapeau du chevalier' }, 'ai-dilate': { value: '15' } },
      traduit: (a) => assert.equal(a.targetText, 'EN:le chapeau du chevalier'),
      brut: (a) => assert.equal(a.targetText, 'le chapeau du chevalier'),
    }));
  }

  test(`${plateforme} : Age — le guide part traduit`, () => troisCas(plateforme, {
    cle: '#age-go', methode: 'texVariant',
    champs: { 'age-slider': { value: '50' }, 'age-guide': { value: 'avec une barbe blanche' }, 'ws-asset-type': { value: 'character' } },
    traduit: (a) => assert.ok(a.prompt.endsWith(', EN:avec une barbe blanche'), a.prompt),
    brut: (a) => assert.ok(a.prompt.endsWith(', avec une barbe blanche'), a.prompt),
  }));

  test(`${plateforme} : Variant — le texte du PROJET (description d origine) et le guide partent traduits`, async () => {
    const champs = { 'var-strength': { value: '50' }, 'var-count': { value: '1' }, 'var-tex-mode': { checked: false }, 'var-tex-prompt': { value: '' } };
    await troisCas(plateforme, {
      cle: '#var-apply', methode: 'img2img', champs, projet: { prompt: '', initialPrompt: 'un chevalier en armure' },
      traduit: (a) => assert.equal(a.prompt, 'EN:un chevalier en armure', 'avant : la description d origine partait brute'),
      brut: (a) => assert.equal(a.prompt, 'un chevalier en armure'),
    });
    const guide = monter(plateforme, { champs: { ...champs, 'var-tex-prompt': { value: 'une armure dorée' } }, projet: { prompt: '', initialPrompt: 'un chevalier' } });
    await guide.lancer('#var-apply');
    assert.equal(guide.appels('img2img')[0].prompt, 'EN:une armure dorée');
    // sans texte de projet : notre texte par defaut, deja anglais, ne part jamais au traducteur ni ne demande rien
    const vide = monter(plateforme, { champs, traduire: traducteurEnPanne, projet: { prompt: '', initialPrompt: '' } });
    await vide.lancer('#var-apply');
    assert.equal(vide.appels('img2img').length, 1);
    assert.equal(vide.journal.traductions.length + vide.journal.fenetres.length, 0);
  });

  test(`${plateforme} : vue de dos (2 vues) — l indice part TRADUIT ; annule = rien n est duplique ni lance (TRADUCTION-05, CHAMPS-08, SERVEUR-05)`, async () => {
    const champs = { 'mv-opt-mode': { value: '2view' }, 'ws-asset-type': { value: 'character' },
      'ws-prompt': { value: '', dataset: { rawPrompt: 'un chevalier avec une cape rouge' } } };
    const r = await troisCas(plateforme, {
      cle: '#mv-opt-start', methode: 'generateBackView', champs,
      traduit: (a) => assert.equal(a.promptHint, 'EN:un chevalier avec une cape rouge', 'avant : le texte d origine partait au moteur'),
      brut: (a) => assert.equal(a.promptHint, 'un chevalier avec une cape rouge'),
    });
    assert.equal(r.annule.appels('duplicateImageVersion').length, 0, 'annule : aucune version dupliquee');
  });

  test(`${plateforme} : Recolor — zone : la couleur est lue APRES traduction (MANQUE-06, CHAMPS-10 : « casco rojo » donnait « Pick a colour »)`, async () => {
    const zone = (texte) => ({ 'rc-mode': { value: 'zone' }, 'rc-prompt': { value: texte }, 'rc-all-prompt': { value: '' },
      'rc-strength': { value: '100' }, 'rc-dilate': { value: '15' } });
    const ok = monter(plateforme, { champs: zone('casco rojo') });
    await ok.lancer('#rc-go');
    const a = ok.appels('recolor');
    assert.equal(a.length, 1, 'avant : « Pick a colour below » et rien de lance ; messages : ' + JSON.stringify(ok.journal.toasts));
    assert.equal(a[0].prompt, 'red helmet');
    assert.equal(ok.journal.traductions.length, 1, 'un seul appel au traducteur');
    const annule = monter(plateforme, { champs: zone('casque rouge'), traduire: traducteurEnPanne, choix: ['annuler'] });
    await annule.lancer('#rc-go');
    assert.equal(annule.appels('recolor').length, 0);
    assert.equal(annule.journal.fenetres.length, 1);
    // « tel quel » : texte d'origine (couleur francaise reconnue), UNE seule fenetre (la zone n'est pas redemandee)
    const tq = monter(plateforme, { champs: zone('casque rouge'), traduire: traducteurEnPanne, choix: ['tel-quel', 'tel-quel'] });
    await tq.lancer('#rc-go');
    assert.equal(tq.appels('recolor').length, 1);
    assert.equal(tq.appels('recolor')[0].prompt, 'casque rouge');
    assert.equal(tq.journal.fenetres.length, 1, 'une seule fenetre pour un seul texte');
    if (site) assert.equal(tq.appels('recolor')[0].langueVerifiee, true);
  });

  test(`${plateforme} : Recolor — la couleur du NUANCIER (mot anglais de l interface) ne part jamais au traducteur`, async () => {
    const champs = { 'rc-mode': { value: 'general' }, 'rc-prompt': { value: '' }, 'rc-all-prompt': { value: '' },
      'rc-strength': { value: '100' }, 'rc-dilate': { value: '15' } };
    const r = monter(plateforme, { champs, traduire: traducteurEnPanne, doublures: { _rcSelectedColor: 'gold' } });
    await r.lancer('#rc-go');
    assert.equal(r.appels('recolor').length, 1);
    assert.equal(r.appels('recolor')[0].prompt, 'gold');
    assert.equal(r.journal.traductions.length, 0, 'avant : « gold » partait au traducteur « depuis le francais »');
    assert.equal(r.journal.fenetres.length, 0);
    // style libre (whole-style) : traduit
    const s = monter(plateforme, { champs: { ...champs, 'rc-mode': { value: 'whole-style' }, 'rc-all-prompt': { value: 'tons pastel doux' } } });
    await s.lancer('#rc-go');
    assert.equal(s.appels('recolor')[0].prompt, 'EN:tons pastel doux');
  });

  test(`${plateforme} : Generate — l ajout en langue native dans un champ ENRICHI est traduit (MANQUE-01, CHAMPS-06/23)`, async () => {
    const champs = (texte) => ({ 'ws-prompt': { value: texte, dataset: {} }, 'ws-asset-type': { value: 'character' }, 'ws-asset-style': { value: 'cartoon' },
      'ws-engine': { value: 'cloud' }, 'ws-count': { value: '1' }, 'ws-quality': { value: '30' }, 'ws-mv-scope': { value: 'front_only' } });
    const sonde = monter(plateforme);
    const gabarit = sonde.evaluer('ASSET_STYLE_PROMPTS').realistic;
    assert.ok(gabarit && /photorealistic/.test(gabarit), 'gabarit realiste introuvable');
    const anglais = (a) => (site ? a.userPrompt : a.userPromptAnglais);
    // champ enrichi (gabarit anglais) + description francaise : avant, « deja enrichi » = jamais traduit
    const r = monter(plateforme, { champs: champs(gabarit + ', un dragon rouge avec des ailes') });
    await r.lancer('#ws-generate-image');
    const a = r.appels('generateImages');
    assert.equal(a.length, 1, JSON.stringify(r.journal.toasts));
    assert.equal(anglais(a[0]), 'EN:un dragon rouge avec des ailes');
    // texte anglais : aucun appel au traducteur
    const en = monter(plateforme, { champs: champs('An orc warrior covered in blood, holding a massive spiked club'), traduire: traducteurEnPanne });
    await en.lancer('#ws-generate-image');
    assert.equal(en.journal.traductions.length + en.journal.fenetres.length, 0);
    assert.equal(anglais(en.appels('generateImages')[0]), 'An orc warrior covered in blood, holding a massive spiked club');
  });

  test(`${plateforme} : Generate — echec de traduction : fenetre ; Echap = rien ; « tel quel » transmis au serveur (TRADUCTION-03, SERVEUR-03)`, async () => {
    const champs = { 'ws-prompt': { value: 'un orc qui tient une massue', dataset: {} }, 'ws-asset-type': { value: 'character' },
      'ws-asset-style': { value: 'cartoon' }, 'ws-engine': { value: 'cloud' }, 'ws-count': { value: '1' }, 'ws-quality': { value: '30' },
      'ws-mv-scope': { value: 'front_only' } };
    const r = await troisCas(plateforme, {
      cle: '#ws-generate-image', methode: 'generateImages', champs, drapeau: true,
      traduit: (a) => assert.equal(site ? a.userPrompt : a.userPromptAnglais, 'EN:un orc qui tient une massue'),
      brut: (a) => assert.equal(site ? a.userPrompt : a.userPromptAnglais, 'un orc qui tient une massue'),
    });
    if (!site) {
      // BUREAU : texte d'origine pour prompt.txt, TRADUCTION pour le composeur d'intention du pont local (CHAMPS-09), STYLE pour le mode
      // Cloud (MANQUE-SERV-01 : sans lui, le serveur ajoutait « realistic style, photorealistic » derriere un prompt cartoon)
      const a = r.ok.appels('generateImages')[0];
      assert.equal(a.userPrompt, 'un orc qui tient une massue');
      assert.equal(a.assetStyle, 'cartoon');
    }
  });

  test(`${plateforme} : pre-remplissage et Enhance — un echec de traduction n est plus fige dans un texte « enrichi » (CHAMPS-21, TRADUCTION-03)`, async () => {
    const gab = (t) => 'GABARIT(' + t + ')';
    const doublures = { buildFullPrompt: (t) => gab(t), _promptStartCycle: () => () => {} };
    const brut = 'un dragon rouge avec des ailes';
    // pre-remplissage de la zone a l'ouverture d'un projet
    const ok = monter(plateforme, { doublures });
    await ok.evaluer('_preremplirPrompt')(brut, 'creature', 'realistic');
    assert.equal(ok.page.document.getElementById('ws-prompt').value, gab('EN:' + brut));
    const echec = monter(plateforme, { doublures, traduire: traducteurEnPanne });
    await echec.evaluer('_preremplirPrompt')(brut, 'creature', 'realistic');
    assert.equal(echec.page.document.getElementById('ws-prompt').value, brut,
      'echec : texte BRUT, sans gabarit (avant : gabarit anglais autour du texte non traduit, que Generate croyait deja traduit)');
    const gabaritReel = ok.evaluer('ASSET_STYLE_PROMPTS').realistic;
    for (const [cle, champ] of [['#ws-enhance-prompt', 'ws-prompt'], ['#np-enhance-prompt', 'np-prompt']]) {
      // echec : DIT, et le champ reste tel quel
      const e = monter(plateforme, { doublures, traduire: traducteurEnPanne, champs: { [champ]: { value: brut, dataset: {} } } });
      await e.lancer(cle);
      assert.equal(e.page.document.getElementById(champ).value, brut, cle + ' : texte laisse tel quel');
      assert.ok(e.journal.toasts.some((t) => t.genre === 'error'), cle + ' : l echec est dit');
      // champ deja enrichi + ajout en francais : repris (gabarit retire puis remis), la partie de l'utilisateur traduite
      const r = monter(plateforme, { doublures, champs: { [champ]: { value: gabaritReel + ', ' + brut, dataset: {} } } });
      await r.lancer(cle);
      assert.equal(r.page.document.getElementById(champ).value, gab('EN:' + brut),
        cle + ' : avant, « Prompt already enhanced » (site) ; ajout jamais traduit');
    }
  });

  test(`${plateforme} : Paint-mask « Replace with » traduit (TRADUCTION-05 : il ne l etait nulle part)`, async () => {
    const E = analyser(OUTILS_EDITION[plateforme], 'script');
    const g = E.clics.get('mApply');
    assert.ok(g, OUTILS_EDITION[plateforme] + ' : gestionnaire mask-apply introuvable');
    const essai = async ({ traduire = traducteurOk, choix = [], fermerPendantTraduction = false } = {}) => {
      const maskCtx = { imagePath: '/projets/P/images/a.png', onSuccess: null };
      // doublure FIDELE de _closeMask : compte les fermetures comme la vraie (voir le test « _closeMask compte les fermetures »)
      const fermer = () => {
        maskCtx.fermetures = (maskCtx.fermetures || 0) + 1; maskCtx.enTraduction = false;
        I.journal.fermeturesMasque = (I.journal.fermeturesMasque || 0) + 1;
      };
      // l'utilisateur ferme la fenetre du masque (Cancel, croix, Echap) PENDANT que la traduction tourne
      const traducteur = fermerPendantTraduction ? (a) => { if (!a.prechauffer) fermer(); return traduire(a); } : traduire;
      const I = monter(plateforme, { traduire: traducteur, choix });
      I.page.document.getElementById('mask-prompt').value = 'une épée avec des runes';
      if (I.existe('_traduirePourGeneration')) I.window.fabmeshTraduirePourGeneration = I.evaluer('_traduirePourGeneration');
      const portee = creerPortee({
        window: I.window, document: I.page.document,
        maskCtx,
        maskOverlayCanvas: { width: 8, height: 8 },
        maskOverlayCtx: { getImageData: (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(255) }) },
        _alerte: (m) => I.journal.toasts.push({ genre: 'alerte', message: String(m) }),
        _closeMask: fermer,
        addJob: () => ({ id: 'travail-masque' }), completeJob() {}, showLog() {},
      }, I.journal);
      // eslint-disable-next-line no-new-func
      const h = new Function('__portee', 'with (__portee) { return (__code) => eval(__code); }')(portee)('(' + g.code + ')');
      h();
      // le gestionnaire est synchrone, la traduction ne l'est pas : on attend l'envoi, ou la fenetre ouverte PUIS refermee
      const modal = I.page.document.getElementById('modal-confirm');
      for (let t = 0; t < 600; t++) {
        if (I.appels('maskInpaint').length || (I.journal.fenetres.length && modal.classList.contains('hidden'))) break;
        if (fermerPendantTraduction && I.journal.traductions.length && t > 10) break;
        await pause(5);
      }
      await pause(10);
      return I;
    };
    const ok = await essai();
    assert.equal(ok.appels('maskInpaint').length, 1, JSON.stringify(ok.journal.toasts));
    assert.equal(ok.appels('maskInpaint')[0].prompt, 'EN:une épée avec des runes');
    assert.equal(ok.journal.fermeturesMasque, 1, 'envoi : la fenetre du masque se ferme');
    const annule = await essai({ traduire: traducteurEnPanne, choix: ['annuler'] });
    assert.equal(annule.journal.fenetres.length, 1);
    assert.equal(annule.appels('maskInpaint').length, 0, 'annule : rien n est lance');
    // revue du 2026-10-14 : annuler apres un echec de traduction GARDE la fenetre du masque (avant : fermee avant la traduction, masque perdu)
    assert.equal(annule.journal.fermeturesMasque || 0, 0, 'annule : la fenetre du masque reste ouverte');
    const tq = await essai({ traduire: traducteurEnPanne, choix: ['tel-quel'] });
    assert.equal(tq.appels('maskInpaint')[0].prompt, 'une épée avec des runes');
    if (site) assert.equal(tq.appels('maskInpaint')[0].langueVerifiee, true);
    // seconde relecture du 2026-10-14 : la fenetre reste ouverte pendant la traduction, donc l'utilisateur peut la FERMER ; la traduction
    // aboutie lancait quand meme l'inpaint (facture) sur un masque que l'utilisateur venait d'abandonner
    const ferme = await essai({ fermerPendantTraduction: true });
    assert.equal(ferme.journal.traductions.length, 1, 'la traduction a bien ete demandee');
    assert.equal(ferme.appels('maskInpaint').length, 0, 'fenetre fermee pendant la traduction : rien n est lance ni debite');
    // echec de traduction sur un masque abandonne, puis « Envoyer tel quel » dans la fenetre d'echec : toujours rien
    const fermeEchec = await essai({ traduire: traducteurEnPanne, choix: ['tel-quel'], fermerPendantTraduction: true });
    assert.equal(fermeEchec.journal.fenetres.length, 1);
    assert.equal(fermeEchec.appels('maskInpaint').length, 0, 'fenetre fermee pendant la traduction (echec, tel quel) : rien n est lance');
  });

  test(`${plateforme} : New project — type detecte sur la TRADUCTION ; rien de detecte = menu libre et message (MANQUE-02, CHAMPS-10)`, async () => {
    const minuteurs = [];
    const TYPES = ['character', 'creature', 'animal', 'insect', 'vehicle', 'bateau', 'avion', 'building', 'weapon', 'prop', 'environment', 'icon'];
    const I = monter(plateforme, {
      champs: {
        'np-auto': { checked: true },
        'np-asset-type': { value: 'character', options: TYPES.map((v) => ({ value: v, textContent: v })), selectedIndex: 0 },
        'np-asset-style': { value: 'realistic', options: [{ value: 'realistic', textContent: 'Realistic' }], selectedIndex: 0 },
        'np-prompt': { value: '', dataset: {} },
        'np-name': { value: 'castillo medieval' },
      },
      doublures: { setTimeout: (f) => { minuteurs.push(f); return minuteurs.length; }, clearTimeout: () => {} },
    });
    const doc = I.page.document;
    const selT = doc.getElementById('np-asset-type');
    I.evaluer('_npAutoSync')();
    assert.equal(selT.disabled, false, 'rien de detecte : le menu du type reste LIBRE (avant : verrouille sur « Character », gabarit T-pose)');
    assert.doesNotMatch(doc.getElementById('np-auto-info').textContent, /Detected/, 'avant : « Detected: Character » pour un chateau');
    // la traduction (differee pendant la frappe) arrive, puis l'analyse est refaite sur elle
    assert.ok(minuteurs.length >= 1, 'traduction programmee');
    await minuteurs.shift()();
    assert.equal(I.journal.traductions.length, 1);
    assert.equal(selT.value, 'building', 'type detecte sur « medieval castle »');
    assert.match(doc.getElementById('np-auto-info').textContent, /Detected/);
    // texte francais ou anglais : listes directes, aucune traduction
    const fr = monter(plateforme, {
      champs: { 'np-auto': { checked: true }, 'np-asset-type': { value: 'character', options: TYPES.map((v) => ({ value: v })) },
        'np-asset-style': { value: 'realistic', options: [{ value: 'realistic' }] }, 'np-prompt': { value: '', dataset: {} }, 'np-name': { value: 'un chateau fort' } },
      doublures: { setTimeout: () => 0, clearTimeout: () => {} },
    });
    fr.evaluer('_npAutoSync')();
    assert.equal(fr.page.document.getElementById('np-asset-type').value, 'building');
    assert.equal(fr.journal.traductions.length, 0);
  });
}

// Seconde relecture du 2026-10-14 : la VRAIE _closeMask compte les fermetures (c'est ce compteur qui annule l'envoi quand la fenetre du
// masque est fermee pendant la traduction du « Replace with »).
for (const plateforme of ['bureau', 'web']) {
  test(`${plateforme} : Paint-mask — _closeMask compte les fermetures et libere le verrou de traduction`, () => {
    const src = readFileSync(OUTILS_EDITION[plateforme], 'utf-8');
    const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script' });
    let code = null;
    const pile = [ast];
    while (pile.length && !code) {
      const n = pile.pop();
      if (n.type === 'FunctionDeclaration' && n.id && n.id.name === '_closeMask') code = src.slice(n.start, n.end);
      for (const k of Object.keys(n)) {
        const v = n[k];
        if (Array.isArray(v)) { for (const x of v) if (x && typeof x.type === 'string') pile.push(x); }
        else if (v && typeof v.type === 'string') pile.push(v);
      }
    }
    assert.ok(code, '_closeMask introuvable');
    const maskCtx = { enTraduction: true };
    const cachee = new Set();
    const maskModal = { classList: { add: (c) => cachee.add(c) } };
    // eslint-disable-next-line no-new-func
    const fermer = new Function('maskCtx', 'maskModal', '_maskMgr', 'document', code + '\nreturn _closeMask;')(
      maskCtx, maskModal, { loupeEnabled: true }, { getElementById: () => null });
    fermer();
    fermer();
    assert.equal(maskCtx.fermetures, 2);
    assert.equal(maskCtx.enTraduction, false);
    assert.ok(cachee.has('hidden'));
  });
}

// Revue du 2026-10-14 : la fenetre « traduction impossible » s'ouvre PAR-DESSUS la fenetre du masque ; Echap doit annuler la traduction
// sans fermer la fenetre du masque (le gestionnaire clavier du masque la fermait aussi : le masque peint etait perdu).
for (const plateforme of ['bureau', 'web']) {
  test(`${plateforme} : Paint-mask — Echap sur la fenetre de traduction ne ferme pas la fenetre du masque`, () => {
    const src = readFileSync(OUTILS_EDITION[plateforme], 'utf-8');
    const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script' });
    let code = null;
    const pile = [ast];
    while (pile.length && !code) {
      const n = pile.pop();
      if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && n.callee.object.type === 'Identifier'
          && n.callee.object.name === 'document' && n.callee.property.name === 'addEventListener' && n.arguments[0]?.value === 'keydown') {
        const c = src.slice(n.arguments[1].start, n.arguments[1].end);
        if (/maskModal/.test(c) && /_closeMask\(\)/.test(c)) code = c;
      }
      for (const k of Object.keys(n)) {
        const v = n[k];
        if (Array.isArray(v)) { for (const x of v) if (x && typeof x.type === 'string') pile.push(x); }
        else if (v && typeof v.type === 'string') pile.push(v);
      }
    }
    assert.ok(code, 'gestionnaire clavier du masque introuvable');
    const essai = (confirmationOuverte) => {
      let fermetures = 0;
      const classes = (cachee) => ({ contains: (c) => c === 'hidden' && cachee });
      const maskModal = { classList: classes(false) };
      const confirmation = { classList: classes(!confirmationOuverte) };
      const document = { getElementById: (id) => (id === 'modal-confirm' ? confirmation : null) };
      // eslint-disable-next-line no-new-func
      const h = new Function('maskModal', 'document', '_closeMask', '_maskMgr', 'updateMaskApplyBtn', 'return (' + code + ');')(
        maskModal, document, () => { fermetures++; }, { undo() {} }, () => {});
      h({ key: 'Escape', target: { tagName: 'BUTTON' }, preventDefault() {} });
      return fermetures;
    };
    assert.equal(essai(true), 0, 'fenetre de traduction ouverte : Echap ne ferme pas le masque');
    assert.equal(essai(false), 1, 'sans fenetre par-dessus : Echap ferme le masque, comme avant');
  });
}
