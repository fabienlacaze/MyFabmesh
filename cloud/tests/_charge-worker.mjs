// Chargeur reutilisable de fonctions de cloud/src/worker.ts pour les tests de CARACTERISATION (constat EXP-05 de l'analyse du 03/10/2026 :
// un backend de 24 000 lignes sans test automatique). Ce fichier n'est PAS un test (le prefixe _ l'exclut du motif *.test.mjs).
//
// Principe : worker.ts n'exporte presque rien. On l'analyse avec le VRAI analyseur de TypeScript (cloud/node_modules/typescript) plutot qu'avec un
// compteur d'accolades fait main : l'arbre syntaxique connait les chaines, les gabarits `${ {} }`, les litteraux regex, les commentaires et les
// types generiques (`Promise<{ a: number }>`), qui sont precisement les cas ou un compteur d'accolades se trompe. On extrait ensuite les declarations
// de premier niveau demandees (function, const/let/var, class, enum), on les transpile (types effaces) et on les evalue dans une fermeture ou les
// DOUBLURES (faux R2, faux Supabase, faux fetch, fonctions voisines) sont injectees comme parametres.
//
// Variable d'environnement WORKER_SRC : chemin d'un autre exemplaire de worker.ts (par defaut cloud/src/worker.ts), par exemple
//   git show HEAD:cloud/src/worker.ts > /c/tmp/vague2/tc/worker_HEAD.ts ; WORKER_SRC=/c/tmp/vague2/tc/worker_HEAD.ts node --test tests/caracterisation-*.test.mjs
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

/** Faux Supabase en memoire : tables { nom: [lignes] }, et rpc(nom, args) pilote par `rpcs`. Filtres : eq, is, in, gt, limit. */
export function creerSupabase(tables = {}, rpcs = {}) {
  const journal = [];
  function builder(nom) {
    const st = { op: 'select', filtres: [], patch: null, ligne: null, lim: Infinity, renvoyer: false };
    const t = () => (tables[nom] ??= []);
    const executer = async () => {
      const cibles = t().filter((l) => st.filtres.every((f) => f(l)));
      if (st.op === 'insert') { t().push({ ...st.ligne }); return { data: null, error: null }; }
      if (st.op === 'update') { for (const l of cibles) Object.assign(l, st.patch); return { data: st.renvoyer ? cibles.map((l) => ({ id: l.id })) : null, error: null }; }
      return { data: cibles.slice(0, st.lim).map((l) => ({ ...l })), error: null };
    };
    const api = {
      select() { if (st.op === 'update') st.renvoyer = true; return api; },
      insert(l) { st.op = 'insert'; st.ligne = l; return api; },
      update(p) { st.op = 'update'; st.patch = p; return api; },
      eq(c, v) { st.filtres.push((l) => l[c] === v); return api; },
      is(c, v) { st.filtres.push((l) => (l[c] ?? null) === v); return api; },
      in(c, vs) { st.filtres.push((l) => vs.includes(l[c])); return api; },
      gt(c, v) { st.filtres.push((l) => l[c] > v); return api; },
      limit(n) { st.lim = n; return api; },
      async maybeSingle() { const r = await executer(); return { data: r.data?.[0] ?? null, error: r.error }; },
      then(ok, ko) { return executer().then(ok, ko); },
    };
    return api;
  }
  return {
    tables, journal,
    from: builder,
    async rpc(nom, args) { journal.push({ nom, args }); const f = rpcs[nom]; return f ? f(args) : { data: null, error: { message: 'rpc inconnue' } }; },
  };
}

/** Reponse d'erreur et reponse JSON comme dans worker.ts (memes formes que les helpers err / json). */
export const doublesReponses = {
  err: (status, message) => new Response(JSON.stringify({ error: message }), { status, headers: { 'content-type': 'application/json' } }),
  json: (o, init) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' }, ...(init || {}) }),
};
