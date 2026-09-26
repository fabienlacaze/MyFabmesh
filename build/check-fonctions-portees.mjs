#!/usr/bin/env node
/**
 * Refuse une construction si le code WEB appelle une fonction qui n'existe
 * que sur le BUREAU.
 *
 * POURQUOI (mesure du 2026-09-26). `translateUserPrompt()` etait appelee trois
 * fois dans cloud/public/app/index2.js — Recolorier, son apercu de masque, et
 * le guide de l'outil Age — et definie nulle part cote web. Les blocs avaient
 * ete copies depuis le bureau, ou la fonction existe ; sa definition n'avait
 * pas suivi. Chaque clic levait un ReferenceError, hors de tout `try` : le
 * bouton ne faisait RIEN, sans message ni tuile. Deux outils factures, jamais
 * fonctionnels depuis leur portage, et aucun garde ne pouvait le voir :
 * la syntaxe etait parfaite.
 *
 * LA SIGNATURE DU DEFAUT est tres precise, et c'est elle qu'on cherche :
 *   appelee cote web  ET  definie nulle part cote web  ET  definie cote bureau.
 * Ce troisieme critere elimine presque tout le bruit : une fonction du
 * navigateur (setTimeout, fetch…) n'est declaree dans aucun fichier du bureau.
 *
 * On est volontairement PRUDENT : un nom declare N'IMPORTE OU cote web (meme
 * comme variable locale ou parametre) est considere comme present. Un garde
 * qui bloque a tort finit desactive ; celui-ci doit rester muet sauf sur un
 * vrai trou.
 *
 * Un appel protege par `typeof X === 'function'` est un choix delibere
 * (fonctionnalite optionnelle) : il est signale a titre d'information,
 * sans bloquer.
 *
 * Usage : node build/check-fonctions-portees.mjs
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Bibliotheques tierces embarquees : ni a analyser ni a comparer. */
const IGNORES = /(^|\/)(vendor|node_modules)\/|\.min\.js$|(^|\/)three[^/]*\.js$/i;

function fichiersJs(dossier) {
  const out = [];
  const abs = join(RACINE, dossier);
  if (!existsSync(abs)) return out;
  for (const nom of readdirSync(abs)) {
    const p = join(abs, nom);
    const rel = relative(RACINE, p).replace(/\\/g, '/');
    if (statSync(p).isDirectory()) { out.push(...fichiersJs(rel)); continue; }
    if (extname(nom) === '.js' && !IGNORES.test(rel)) out.push(rel);
  }
  return out;
}

function scriptsEnLigne(chemin) {
  const brut = readFileSync(join(RACINE, chemin), 'utf-8');
  // Meme neutralisation que check-js-syntax.mjs : un commentaire HTML qui
  // CITE <script> en prose ne doit pas etre pris pour du code.
  const html = brut.replace(/<!--[\s\S]*?-->/g, (c) => (c.match(/[\n]/g) || []).join(''));
  const blocs = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1] || '';
    if (/src\s*=/i.test(attrs)) continue;
    if (/type\s*=\s*["'](?!text\/javascript|module)/i.test(attrs)) continue;
    blocs.push({ code: m[2], ligne: (html.slice(0, m.index).match(/[\n]/g) || []).length + 1 });
  }
  return blocs;
}

function analyser(code) {
  for (const sourceType of ['module', 'script']) {
    try {
      return acorn.parse(code, { ecmaVersion: 'latest', sourceType, locations: true,
        allowHashBang: true, allowReturnOutsideFunction: true });
    } catch (_) { /* on essaie l'autre forme */ }
  }
  return null;   // la syntaxe est l'affaire de check-js-syntax.mjs
}

/** Parcours generique : acorn-walk n'est pas installe, et il n'en faut pas plus. */
function parcourir(noeud, visite) {
  if (!noeud || typeof noeud.type !== 'string') return;
  visite(noeud);
  for (const cle of Object.keys(noeud)) {
    if (cle === 'loc' || cle === 'start' || cle === 'end') continue;
    const v = noeud[cle];
    if (Array.isArray(v)) { for (const x of v) if (x && typeof x.type === 'string') parcourir(x, visite); }
    else if (v && typeof v.type === 'string') parcourir(v, visite);
  }
}

function nomsDuMotif(motif, into) {
  if (!motif) return;
  switch (motif.type) {
    case 'Identifier': into.add(motif.name); break;
    case 'ObjectPattern':
      for (const p of motif.properties) nomsDuMotif(p.type === 'RestElement' ? p.argument : p.value, into);
      break;
    case 'ArrayPattern': for (const e of motif.elements) nomsDuMotif(e, into); break;
    case 'RestElement': nomsDuMotif(motif.argument, into); break;
    case 'AssignmentPattern': nomsDuMotif(motif.left, into); break;
  }
}

const GLOBAUX = new Set(['window', 'globalThis', 'self']);

/** Rend { declares, appels: Map<nom, [{fichier, ligne}]>, proteges }. */
function inventaire(fichiers, pages) {
  const declares = new Set();
  const proteges = new Set();
  const appels = new Map();
  const sources = [];
  for (const f of fichiers) sources.push({ nom: f, code: readFileSync(join(RACINE, f), 'utf-8'), decalage: 0 });
  for (const pg of pages) {
    if (!existsSync(join(RACINE, pg))) continue;
    for (const b of scriptsEnLigne(pg)) sources.push({ nom: pg, code: b.code, decalage: b.ligne - 1 });
  }
  for (const s of sources) {
    const ast = analyser(s.code);
    if (!ast) continue;
    parcourir(ast, (n) => {
      switch (n.type) {
        case 'FunctionDeclaration':
        case 'FunctionExpression':
        case 'ArrowFunctionExpression':
          if (n.id) declares.add(n.id.name);
          for (const p of n.params) nomsDuMotif(p, declares);
          break;
        case 'ClassDeclaration': case 'ClassExpression':
          if (n.id) declares.add(n.id.name);
          break;
        case 'VariableDeclarator': nomsDuMotif(n.id, declares); break;
        case 'CatchClause': nomsDuMotif(n.param, declares); break;
        case 'ImportSpecifier': case 'ImportDefaultSpecifier': case 'ImportNamespaceSpecifier':
          declares.add(n.local.name);
          break;
        case 'AssignmentExpression': {
          // window.foo = … / globalThis.foo = … : la fonction devient globale.
          const g = n.left;
          if (g.type === 'MemberExpression' && !g.computed && g.object.type === 'Identifier'
              && GLOBAUX.has(g.object.name) && g.property.type === 'Identifier') declares.add(g.property.name);
          break;
        }
        case 'UnaryExpression':
          if (n.operator === 'typeof' && n.argument.type === 'Identifier') proteges.add(n.argument.name);
          break;
        case 'CallExpression':
          if (n.callee.type === 'Identifier') {
            const nom = n.callee.name;
            if (!appels.has(nom)) appels.set(nom, []);
            appels.get(nom).push({ fichier: s.nom, ligne: n.loc.start.line + s.decalage });
          }
          break;
      }
    });
  }
  return { declares, appels, proteges };
}

const web = inventaire(fichiersJs('cloud/public/app'), ['cloud/public/app/index.html']);
const bureau = inventaire(fichiersJs('src/renderer'), ['src/renderer/index2.html']);

const trous = [];
const optionnels = [];
for (const [nom, lieux] of [...web.appels].sort()) {
  if (web.declares.has(nom)) continue;         // existe cote web
  if (!bureau.declares.has(nom)) continue;     // pas une fonction du projet
  (web.proteges.has(nom) ? optionnels : trous).push({ nom, lieux });
}

/* ── MEME DEFAUT, AUTRE FORME : une methode du PONT qui manque ─────────────
 *
 * Le renderer web appelle le backend par `API.xxx()` / `window.meshyAPI.xxx()`.
 * Sur le bureau ces methodes viennent de preload.js ; sur le web, de
 * meshyAPI-cloud.js. Une methode appelee sans exister leve « API.xxx is not a
 * function » exactement comme ci-dessus.
 *
 * Piege de lecture : `window.meshyAPI?.xxx()` NE protege PAS. Le `?.` ne court-
 * circuite que si meshyAPI est absent, pas si xxx l'est. Seul `API.xxx?.()`
 * (appel optionnel) ou une verification prealable (`if (API.xxx)`, `typeof
 * API.xxx`) est sur — ces cas sont traites comme des choix deliberes. */
const PONT = 'cloud/public/app/meshyAPI-cloud.js';
const methodesDuPont = new Set();
{
  const ast = analyser(readFileSync(join(RACINE, PONT), 'utf-8'));
  // Sur-approximation VOLONTAIRE : toute cle d'objet, toute chaine qui a la
  // forme d'un identifiant (la liste STUBS), toute affectation `x.nom = …`.
  // Mieux vaut rater un trou que bloquer a tort.
  if (ast) parcourir(ast, (n) => {
    if (n.type === 'Property' && !n.computed) methodesDuPont.add(n.key.name ?? n.key.value);
    if (n.type === 'Literal' && typeof n.value === 'string' && /^[A-Za-z_]\w*$/.test(n.value)) methodesDuPont.add(n.value);
    if (n.type === 'AssignmentExpression' && n.left.type === 'MemberExpression' && !n.left.computed
        && n.left.property.type === 'Identifier') methodesDuPont.add(n.left.property.name);
  });
}
const estLePont = (o) => (o.type === 'Identifier' && o.name === 'API')
  || (o.type === 'MemberExpression' && !o.computed && o.property.type === 'Identifier' && o.property.name === 'meshyAPI');
const appelsPont = new Map();
const pontVerifie = new Set();
for (const f of fichiersJs('cloud/public/app')) {
  if (f === PONT) continue;
  const ast = analyser(readFileSync(join(RACINE, f), 'utf-8'));
  if (!ast) continue;
  // Parcours avec le parent : il faut savoir si le membre est APPELE.
  (function descendre(n, parent) {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'MemberExpression' && !n.computed && n.property.type === 'Identifier' && estLePont(n.object)) {
      const nom = n.property.name;
      const appele = parent && parent.type === 'CallExpression' && parent.callee === n;
      if (appele && !parent.optional) {
        if (!appelsPont.has(nom)) appelsPont.set(nom, []);
        appelsPont.get(nom).push({ fichier: f, ligne: n.loc.start.line });
      } else if (!appele) {
        pontVerifie.add(nom);   // typeof API.x, !API.x, API.x && … : verifie avant usage
      }
    }
    for (const cle of Object.keys(n)) {
      if (cle === 'loc' || cle === 'start' || cle === 'end') continue;
      const v = n[cle];
      if (Array.isArray(v)) { for (const x of v) if (x && typeof x.type === 'string') descendre(x, n); }
      else if (v && typeof v.type === 'string') descendre(v, n);
    }
  })(ast, null);
}
for (const [nom, lieux] of [...appelsPont].sort()) {
  if (methodesDuPont.has(nom)) continue;
  (pontVerifie.has(nom) ? optionnels : trous).push({ nom: 'API.' + nom, lieux });
}

if (optionnels.length) {
  console.log('[portage] ' + optionnels.length + ' appel(s) proteges par typeof, absents du web (choix delibere) :');
  for (const o of optionnels) console.log('    ' + o.nom + '  (' + o.lieux.length + ' appel(s))');
}

if (trous.length) {
  console.log();
  console.log('='.repeat(72));
  console.log("  PORTAGE INCOMPLET : le web appelle des fonctions qui n'existent");
  console.log('  que sur le bureau. Chaque appel leve un ReferenceError au clic.');
  console.log();
  for (const t of trous) {
    console.log('  ' + t.nom + '()');
    for (const l of t.lieux.slice(0, 4)) console.log('      ' + l.fichier + ':' + l.ligne);
    if (t.lieux.length > 4) console.log('      … et ' + (t.lieux.length - 4) + ' autre(s)');
  }
  console.log();
  console.log("  C'est ainsi que Recolorier et Age n'ont RIEN fait sur le web");
  console.log('  depuis leur portage (translateUserPrompt, 2026-09-26).');
  console.log('='.repeat(72));
  process.exit(1);
}
console.log('[portage] aucune fonction du bureau appelee sans definition cote web');
