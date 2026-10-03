// Chargeur de fonctions de cloud/src/worker.ts pour vague2-worker.test.mjs (voie worker-vague2, 2026-10-03). Ce fichier n'est PAS un test.
// Principe (identique a _charge-worker.mjs, copie autonome) : le VRAI analyseur TypeScript decoupe worker.ts en declarations de premier niveau,
// on transpile celles demandees et on les evalue dans une fermeture ou les doublures (faux R2, faux Supabase, faux fetch) sont des parametres.
// WORKER_SRC : chemin d'un autre exemplaire de worker.ts (ancien code pour prouver qu'un test echoue sur l'ancienne version).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');

export const CHEMIN_WORKER = process.env.WORKER_SRC || new URL('../src/worker.ts', import.meta.url);
/** Vrai quand les tests tournent sur l'exemplaire de reference (WORKER_SRC pose) : certains tests documentent alors la valeur d'AVANT la vague 1. */
export const EST_REFERENCE = !!process.env.WORKER_SRC;

const _caches = new Map(); // texte -> { sf, index }

/** Texte du worker, fins de ligne normalisees en LF (le fichier peut etre en CRLF). */
export function lireSource(chemin = CHEMIN_WORKER) {
  return readFileSync(chemin, 'utf8').replace(/\r\n/g, '\n');
}

function analyser(src) {
  let c = _caches.get(src);
  if (c) return c;
  const sf = ts.createSourceFile('worker.ts', src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const index = new Map(); // nom -> noeud de premier niveau
  const ajouter = (nom, noeud) => { if (!index.has(nom)) index.set(nom, noeud); };
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name && st.body) ajouter(st.name.text, st);
    else if (ts.isClassDeclaration(st) && st.name) ajouter(st.name.text, st);
    else if (ts.isEnumDeclaration(st)) ajouter(st.name.text, st);
    else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) ajouter(d.name.text, st);
    }
  }
  c = { sf, index };
  _caches.set(src, c);
  return c;
}

function texteDe(noeud, sf) {
  return sf.text.slice(noeud.getStart(sf), noeud.end).replace(/^export\s+(default\s+)?/, '');
}

function transpiler(code) {
  return ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, removeComments: false } }).outputText;
}

/** Charge des declarations de premier niveau depuis un TEXTE de worker.
 *  noms      : declarations a embarquer (fonctions ET constantes dont elles dependent, dans n'importe quel ordre : l'ordre du fichier est conserve).
 *  doublures : { nom: valeur } injectees comme parametres (jamais en meme temps que `noms`).
 *  Rend { nom: valeur, ..., ev(expression) } ; `ev` evalue une expression DANS la fermeture (lire ou ecrire une variable `let` du worker). */
export function chargerDepuisSource(src, noms, doublures = {}) {
  const { sf, index } = analyser(src);
  const manquants = noms.filter((n) => !index.has(n));
  if (manquants.length) throw new Error('declaration(s) introuvable(s) dans worker.ts : ' + manquants.join(', '));
  const conflit = noms.filter((n) => Object.prototype.hasOwnProperty.call(doublures, n));
  if (conflit.length) throw new Error('nom a la fois charge et doublure : ' + conflit.join(', '));
  const vus = new Set();
  const noeuds = [];
  for (const n of noms) { const nd = index.get(n); if (!vus.has(nd)) { vus.add(nd); noeuds.push(nd); } }
  noeuds.sort((a, b) => a.pos - b.pos);
  const js = transpiler(noeuds.map((nd) => texteDe(nd, sf)).join('\n'));
  const cles = Object.keys(doublures);
  const corps = js + '\nreturn { ' + noms.join(', ') + ', ev: (e) => eval(e) };';
  // eslint-disable-next-line no-new-func
  return new Function(...cles, corps)(...cles.map((k) => doublures[k]));
}

/** Meme chose, depuis le worker vivant (ou WORKER_SRC). */
export function chargerFonctions(noms, doublures = {}) {
  return chargerDepuisSource(lireSource(), noms, doublures);
}

/** Evalue le litteral d'initialisation d'une constante declaree N'IMPORTE OU (meme dans le corps d'une fonction : l'ancienne table PALIERS de
 *  handleGenerate etait locale). Sert aux tables pures (objets, tableaux, nombres). Rend undefined si absente. */
export function chargerConstante(nom, doublures = {}, src = lireSource()) {
  const { sf } = analyser(src);
  let trouve = null;
  const visiter = (n) => {
    if (trouve) return;
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === nom && n.initializer) { trouve = n.initializer; return; }
    ts.forEachChild(n, visiter);
  };
  visiter(sf);
  if (!trouve) return undefined;
  const cles = Object.keys(doublures);
  const js = transpiler('const __v = ' + texteDe(trouve, sf) + ';');
  // eslint-disable-next-line no-new-func
  return new Function(...cles, js + '\nreturn __v;')(...cles.map((k) => doublures[k]));
}

/** Verifie qu'une declaration existe (pour les tests qui se documentent par difference HEAD / vivant). */
export function existe(nom, src = lireSource()) { return analyser(src).index.has(nom); }

/* ───────────────────────── doublures communes ───────────────────────── */

/** Faux bucket R2 en memoire : get / put (avec onlyIf etagMatches | etagDoesNotMatch) / head / delete / list. Aucun reseau. */
export function creerR2(initial = {}) {
  const m = new Map(); let seq = 1;
  const objet = (cle) => {
    const e = m.get(cle); if (!e) return null;
    return { key: cle, etag: e.etag, size: e.valeur.length, uploaded: new Date(),
      text: async () => e.valeur, json: async () => JSON.parse(e.valeur),
      arrayBuffer: async () => new TextEncoder().encode(e.valeur).buffer,
      body: new Response(e.valeur).body };
  };
  const r2 = {
    _m: m,
    async get(cle) { return objet(cle); },
    async head(cle) { return objet(cle); },
    async put(cle, valeur, opts = {}) {
      const existant = m.get(cle);
      const cond = opts && opts.onlyIf;
      if (cond) {
        if (cond.etagDoesNotMatch === '*' && existant) return null;
        if (cond.etagMatches && (!existant || existant.etag !== cond.etagMatches)) return null;
      }
      const v = typeof valeur === 'string' ? valeur : valeur instanceof ArrayBuffer ? new TextDecoder().decode(valeur) : String(valeur);
      m.set(cle, { valeur: v, etag: 'e' + (seq++) });
      return objet(cle);
    },
    async delete(cle) { for (const k of (Array.isArray(cle) ? cle : [cle])) m.delete(k); },
    async list({ prefix = '', limit = 1000 } = {}) {
      const objets = [...m.keys()].filter((k) => k.startsWith(prefix)).sort().slice(0, limit).map(objet);
      return { objects: objets, truncated: false, delimitedPrefixes: [] };
    },
    lire(cle) { return m.has(cle) ? m.get(cle).valeur : undefined; },
    ecrire(cle, v) { m.set(cle, { valeur: String(v), etag: 'e' + (seq++) }); },
  };
  for (const [k, v] of Object.entries(initial)) r2.ecrire(k, v);
  return r2;
}

/** Faux Supabase : tables { nom: [lignes] }. select(cols, { count, head }) renvoie { count } ; filtres eq, gt ; maybeSingle. Erreur forcee par `erreurs[table]`. */
export function creerSupabase(tables = {}, erreurs = {}) {
  return {
    tables,
    from(nom) {
      const st = { filtres: [], count: false };
      const api = {
        select(_cols, opts) { if (opts && opts.count) st.count = true; return api; },
        eq(c, v) { st.filtres.push((l) => l[c] === v); return api; },
        gt(c, v) { st.filtres.push((l) => l[c] > v); return api; },
        async maybeSingle() { if (erreurs[nom]) return { data: null, error: { message: erreurs[nom] } }; const r = (tables[nom] ??= []).filter((l) => st.filtres.every((f) => f(l))); return { data: r[0] ? { ...r[0] } : null, error: null }; },
        then(ok, ko) {
          const p = erreurs[nom] ? { data: null, count: null, error: { message: erreurs[nom] } }
            : (() => { const r = (tables[nom] ??= []).filter((l) => st.filtres.every((f) => f(l))); return { data: st.count ? null : r.map((l) => ({ ...l })), count: st.count ? r.length : null, error: null }; })();
          return Promise.resolve(p).then(ok, ko);
        },
      };
      return api;
    },
  };
}
export const doublesReponses = {
  err: (status, message) => new Response(JSON.stringify({ error: message }), { status, headers: { 'content-type': 'application/json' } }),
  json: (o, init) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' }, ...(init || {}) }),
};
