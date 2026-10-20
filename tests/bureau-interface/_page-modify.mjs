// Aide PARTAGEE des tests de « Modify image : retrait » (n'est PAS un test : le prefixe _ l'exclut du motif *.test.mjs).
// Charge les deux copies du module pur lib/retrait-image.js et extrait le VRAI bloc Modify de src/renderer/index2.js (bureau) et de
// cloud/public/app/index2.js (site) pour l'executer dans une fausse page.
// Variables pour viser un autre exemplaire (preuve qu'un test ECHOUE sans la correction) : BUREAU_INDEX2, WEB_INDEX2, RETRAIT_LIB (chemin du module).
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as acorn from 'acorn';
export const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const lire = (rel) => readFileSync(join(RACINE, rel), 'utf-8').replace(/\r\n/g, '\n');
const PAGES = {
  bureau: process.env.BUREAU_INDEX2 || join(RACINE, 'src/renderer/index2.js'),
  web: process.env.WEB_INDEX2 || join(RACINE, 'cloud/public/app/index2.js'),
};
const LIBS = { bureau: 'src/renderer/lib/retrait-image.js', web: 'cloud/public/app/lib/retrait-image.js' };
const LIB_AUTRE = process.env.RETRAIT_LIB || null;

// la lib est un module ES dans un .js : on en importe une copie .mjs temporaire
const dossier = mkdtempSync(join(tmpdir(), 'retrait-modify-'));
export const MODULES = {};
try {
  for (const [nom, rel] of Object.entries(LIBS)) {
    const copie = join(dossier, 'retrait-' + nom + '.mjs');
    writeFileSync(copie, LIB_AUTRE ? readFileSync(LIB_AUTRE, 'utf-8') : lire(rel));
    MODULES[nom] = await import(pathToFileURL(copie).href);
  }
} finally {
  rmSync(dossier, { recursive: true, force: true });
}

export const TABLE = JSON.parse(lire('build/retrait_cas.json')).cas;
export const texteDuCas = (t) => (t === 'REMOVE_LONG_TEXT' ? 'remove the wings ' + 'and the tail '.repeat(20) : t);

/* ═════════════════════ 2. la fenetre Modify, VRAIE, dans une fausse page ═════════════════════ */

const _blocs = {};
export function chargerBlocModify(cle) {
  if (!_blocs[cle]) _blocs[cle] = extraireBlocModify(cle);
  return _blocs[cle];
}
function extraireBlocModify(cle) {
  const src = readFileSync(PAGES[cle], 'utf-8').replace(/\r\n/g, '\n');
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
  const debut = ast.body.find((n) => n.type === 'VariableDeclaration' && n.declarations[0].id.name === 'modifyModal');
  const fin = ast.body.find((n) => n.type === 'ExpressionStatement' && /document\.getElementById\('mod-apply'\)\.addEventListener\('click'/.test(src.slice(n.start, n.end)));
  assert.ok(debut && fin && fin.end > debut.start, cle + ' : bloc Modify introuvable');
  const bloc = src.slice(debut.start, fin.end);
  // entree de la table des prix des fenetres de validation (bureau seulement)
  const m = /'mod-apply': (\(\) => [^\n]*),\n/.exec(src);
  return { bloc, entreePrix: cle === 'bureau' && m ? m[1] : null, src };
}

const DEFAUT_ELEMENTS = {
  'mod-prompt': { value: '' }, 'mod-strength': { value: '55' }, 'mod-strength-val': { textContent: '55%' }, 'mod-engine': { value: 'local-sdxl' },
  'ai-dilate': { value: '15' }, 'ai-precision': { value: '65' },
};

/** Fausse page : une fabrique d'elements, des minuteries a la main, des doublures qui enregistrent tout ce que le code appelle. */
export function creerPage(cle, { lang = 'en', traductions = {}, mode = 'cloud', prix = { modify: 3, auto_inpaint: 6 }, reponseConfirm = true, resultatRetrait = { success: true }, traductionLente = false } = {}) {
  const { bloc, entreePrix } = chargerBlocModify(cle);
  const elements = {};
  const el = (id) => {
    if (!elements[id]) {
      const classes = new Set();
      elements[id] = Object.assign({
        id, value: '', hidden: false, disabled: false, title: '', textContent: '', dataset: {}, style: {}, ecouteurs: {},
        classList: {
          add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c),
          toggle: (c, force) => { const v = force === undefined ? !classes.has(c) : !!force; if (v) classes.add(c); else classes.delete(c); return v; },
        },
        addEventListener(type, f) { (this.ecouteurs[type] = this.ecouteurs[type] || []).push(f); },
        focus() {}, remove() {},
      }, DEFAUT_ELEMENTS[id] || {});
    }
    return elements[id];
  };
  const badge = { dataset: { pricingKey: 'modify' }, textContent: '3' };
  const document = {
    getElementById: el,
    querySelector: (sel) => (/#mod-apply \.credit-badge\[data-pricing-key\]/.test(sel) ? badge : null),
  };
  const ecouteursFenetre = {};
  const journal = { img2img: [], autoInpaint: [], jobs: [], confirm: [], erreurs: [], toasts: [], gated: [], traductions: [] };
  const minuteries = [];
  const fausseMinuterie = (f, ms) => { minuteries.push({ f, ms }); return minuteries.length; };
  const grille = { ...prix };
  const fenetre = {
    addEventListener(type, f) { (ecouteursFenetre[type] = ecouteursFenetre[type] || []).push(f); },
    _computeMode: () => mode,
    _prixDe: (k) => (typeof grille[k] === 'number' ? grille[k] : null),
    _prixBouton: (id) => ({ 'ws-modify-btn': grille.modify, 'ws-autoinpaint-btn': grille.auto_inpaint })[id] ?? null,
    _applyValidationPills: () => {},
  };
  const stockage = { getItem: (k) => (k === 'fabmesh.lang' ? lang : null) };
  const attente = []; // traductions en attente quand traductionLente
  const translateUserPrompt = async (t, opts) => {
    journal.traductions.push({ t, silencieux: !!(opts && opts.silencieux) });
    const sortie = traductions[t] !== undefined ? traductions[t] : t;
    if (!traductionLente) return sortie;
    return new Promise((res) => attente.push(() => res(sortie)));
  };
  const API = {
    autoInpaint: async (a) => { journal.autoInpaint.push(a); return resultatRetrait; },
    img2img: async (a) => { journal.img2img.push(a); return { success: true }; },
  };
  const projet = { name: 'Pig' };
  const doublures = {
    document, window: fenetre, localStorage: stockage, setTimeout: fausseMinuterie, clearTimeout: () => {},
    state: { currentProject: projet }, editTarget: () => '/projets/pig.png', showToast: (m, t) => journal.toasts.push([m, t]),
    translateUserPrompt, API, gatedRun: (kind, nom, fn) => { journal.gated.push([kind, nom]); return fn(); },
    pushJob: (nom, annul, params, ms, ...reste) => { const j = { id: journal.jobs.length + 1, nom, params, reste }; journal.jobs.push(j); return j; },
    completeJob: () => {}, reloadCurrentProject: async () => {}, customError: (m, t) => journal.erreurs.push([m, t]),
    fabConfirm: async (o) => { journal.confirm.push(o); return reponseConfirm; },
    _i18nT: (s) => s, _i18nTf: (s, ...a) => String(s).replace('{x}', a[0]).replace('{y}', a[1]),
    _precisionRel: () => 0.585, engineLabel: (e) => e, _toFileUrl: (p) => p, _bust: (p) => p,
    analyserRetrait: MODULES[cle].analyserRetrait, estRoute: MODULES[cle].estRoute,
  };
  const noms = Object.keys(doublures);
  const corps = bloc + '\nreturn { _modAppliquer, _modPlanifierRetrait, _modRetraitActif, modifyModal, etat: () => _modRetrait'
    + (entreePrix ? ', prixModApply: ' + entreePrix : '') + ' };';
  const code = new Function(...noms, corps)(...noms.map((n) => doublures[n]));

  const page = {
    el, badge, journal, fenetre, code, grille,
    /** Ecrit dans la zone de texte et declenche « input » ; avance les minuteries si on le demande. */
    async taper(texte, { avancer = true } = {}) {
      el('mod-prompt').value = texte;
      for (const f of el('mod-prompt').ecouteurs.input || []) f();
      if (avancer) await page.avancer();
    },
    async avancer() {
      while (minuteries.length) { const m = minuteries.shift(); m.f(); await new Promise((r) => setImmediate(r)); }
      for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r));
    },
    liberer() { while (attente.length) attente.shift()(); },
    async cliquer() {
      const p = Promise.resolve(el('mod-apply').ecouteurs.click[0]());
      await new Promise((r) => setImmediate(r));
      return p;
    },
    prixAffiche: () => (cle === 'bureau' ? code.prixModApply() : (badge.textContent === '' ? null : Number(badge.textContent))),
    cleBadge: () => badge.dataset.pricingKey,
    aide: () => (el('mod-retrait-hint').hidden ? '' : el('mod-retrait-hint').textContent),
    curseurActif: () => !el('mod-strength').disabled,
    ouverte: () => !code.modifyModal.classList.contains('hidden'),
  };
  el('modal-modify-image'); // evite une fabrique tardive
  page.code.modifyModal.classList.remove('hidden');
  return page;
}

