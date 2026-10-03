#!/usr/bin/env node
// Couverture des traductions de l'interface (2026-10-03, vague 5, constat P10).
//
// POURQUOI : l'interface est ecrite en anglais ; chaque langue est un
// dictionnaire « libelle anglais exact -> traduction » (i18n.js + lang/*.js).
// Un libelle sans entree reste en anglais, SANS erreur : rien ne mesurait donc
// la part reellement traduite. Cet outil la mesure, par cible et par langue.
//
// COMMENT (aucune regle inventee : on rejoue celles de i18n.js) :
//  - Les dictionnaires sont EXECUTES (vm), pas lus par regex : i18n.js (dict
//    en ligne, dont fr) puis lang/*.js, qui appellent FabI18n.register().
//  - Les libelles a traduire = ce que le traducteur du DOM verrait :
//      * HTML : noeuds texte (hors script/style/textarea/pre/code/svg) et
//        attributs placeholder / title / aria-label ;
//      * JS : litteraux de FabI18n.t('...') / tf('...') / t('...').
//    Le filtre « ce n'est pas du texte a traduire » est celui de
//    _shouldAutoTranslate (i18n.js) : sans lettres, URL, jeton de code,
//    valeur du genre « 18s ».
//  - Un libelle est « traduit » si dict[coeur] ou dict[brut] existe, ou le
//    coeur est le libelle prive de ses symboles de tete (meme regle que
//    _translateNodeValue).
//  Limite assumee : le texte construit dynamiquement (gabarits avec ${...})
//  n'est pas mesure ; le repli automatique du bureau (Argos) n'est pas compte.
//
// Usage : node build/couverture-traductions.mjs [--json] [--min <pourcent>] [--racine <dossier>]
// Par defaut informatif (code 0). --min : code 1 si une langue est sous le seuil.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const LANGUES = ['fr', 'es', 'zh', 'hi', 'ar'];

export const CIBLES = [
  { nom: 'bureau', dossier: 'src/renderer', html: ['index2.html'], js: ['index2.js', 'index2-edit-tools.js'], i18n: 'i18n.js', lang: 'lang' },
  { nom: 'web', dossier: 'cloud/public/app', html: ['index.html'], js: ['index2.js', 'index2-edit-tools.js', 'cloud-overrides.js'], i18n: 'i18n.js', lang: 'lang' },
];

// Copie de _shouldAutoTranslate (i18n.js) : ce qui n'est pas un texte a traduire.
export function estTraduisible(cle) {
  if (!cle || cle.length > 200) return false;
  if (!/[A-Za-z]/.test(cle)) return false;
  if (/^https?:\/\//i.test(cle)) return false;
  if (!/\s/.test(cle) && /[._/\\()]|[a-z][A-Z]/.test(cle)) return false;
  if (cle.length <= 24 && !/[A-Za-z]{4,}/.test(cle) && /^[~≈<>]?\s*\d/.test(cle)) return false;
  if (/\$\{|\{\{/.test(cle)) return false;
  return true;
}

// Meme decoupage que _translateNodeValue : coeur = libelle sans symboles de tete.
export function coeurDe(cle) {
  const m = cle.match(/^([^\p{L}\p{N}]+)([\p{L}\p{N}][\s\S]*)$/u);
  return m ? m[2] : cle;
}

function decoder(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&times;/g, '×')
    .replace(/&hellip;/g, '…').replace(/&middot;/g, '·')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
}

// Libelles d'un HTML : { libelle -> occurrences }.
export function libellesHtml(src) {
  const sortie = new Map();
  const ajouter = (brut) => {
    const cle = decoder(brut).trim();
    if (estTraduisible(cle)) sortie.set(cle, (sortie.get(cle) || 0) + 1);
  };
  let s = src.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<(script|style|textarea|pre|code|svg|noscript)\b[\s\S]*?<\/\1>/gi, '<$1></$1>');
  const reTexte = />([^<>]+)</g;
  let m;
  while ((m = reTexte.exec(s))) ajouter(m[1]);
  const reBalise = /<[a-zA-Z][^<>]*>/g;
  const reAttr = /\s(?:placeholder|title|aria-label)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  while ((m = reBalise.exec(s))) {
    let a;
    reAttr.lastIndex = 0;
    while ((a = reAttr.exec(m[0]))) ajouter(a[1] !== undefined ? a[1] : a[2]);
  }
  return sortie;
}

// Libelles d'un JS : litteraux passes a t( / tf( / FabI18n.t(.
export function libellesJs(src) {
  const sortie = new Map();
  const re = /(?<![\w$.])(?:FabI18n\.)?(?:tf|t)\(\s*(["'])((?:\\.|(?!\1)[^\\\n])*)\1/g;
  let m;
  while ((m = re.exec(src))) {
    const cle = m[2].replace(/\\(["'\\])/g, '$1').replace(/\\n/g, '\n').trim();
    if (estTraduisible(cle)) sortie.set(cle, (sortie.get(cle) || 0) + 1);
  }
  return sortie;
}

// Execute i18n.js (dictionnaires en ligne) puis lang/*.js ; rend { langue -> objet }.
export function chargerDictionnaires({ i18n, dossierLang }) {
  const registre = {};
  const fenetre = {
    FabI18n: {
      lang: 'en',
      applyLang() {},
      register(langue, carte) { registre[langue] = Object.assign(registre[langue] || {}, carte); },
    },
  };
  fenetre.window = fenetre;
  const contexte = vm.createContext(fenetre);
  if (i18n && fs.existsSync(i18n)) {
    // On expose le dictionnaire en ligne en reecrivant, EN MEMOIRE, le point
    // d'export de l'IIFE ; le fichier n'est jamais modifie.
    let src = fs.readFileSync(i18n, 'utf8');
    const ancre = 'window.FabI18n = {';
    if (src.split(ancre).length === 2) {
      src = src.replace(ancre, 'window.__I18N = I18N; ' + ancre);
      const stub = {
        document: { readyState: 'loading', addEventListener() {}, getElementById() { return null; }, documentElement: { setAttribute() {} }, body: {}, querySelectorAll() { return []; } },
        localStorage: { getItem() { return null; }, setItem() {} },
        MutationObserver: class { observe() {} },
        navigator: { language: 'en', languages: ['en'] },
        console, setTimeout, clearTimeout,
      };
      const ctxI18n = vm.createContext(Object.assign(stub, { window: stub }));
      try {
        vm.runInContext(src, ctxI18n, { filename: i18n });
        const enLigne = stub.__I18N || {};
        for (const l of Object.keys(enLigne)) registre[l] = Object.assign({}, enLigne[l]);
      } catch (e) {
        process.stderr.write('[couverture] i18n.js non execute (' + e.message + ') : dictionnaires en ligne ignores\n');
      }
    }
  }
  if (dossierLang && fs.existsSync(dossierLang)) {
    for (const f of fs.readdirSync(dossierLang).filter((x) => x.endsWith('.js')).sort()) {
      try { vm.runInContext(fs.readFileSync(path.join(dossierLang, f), 'utf8'), contexte, { filename: f }); }
      catch (e) { process.stderr.write('[couverture] ' + f + ' non execute : ' + e.message + '\n'); }
    }
  }
  return registre;
}

export function estTraduit(dict, cle) {
  if (!dict) return false;
  const coeur = coeurDe(cle);
  return Boolean((dict[coeur]) || (dict[cle]));
}

// Mesure complete d'une cible. `fichiers` : { html: [chemins], js: [chemins], i18n, dossierLang }.
export function mesurerCible(fichiers, langues = LANGUES) {
  const libelles = new Map(); // cle -> { occ, html }
  const verser = (carte, estHtml) => {
    for (const [cle, n] of carte) {
      const e = libelles.get(cle) || { occ: 0, html: false };
      e.occ += n; e.html = e.html || estHtml; libelles.set(cle, e);
    }
  };
  for (const f of fichiers.html || []) if (fs.existsSync(f)) verser(libellesHtml(fs.readFileSync(f, 'utf8')), true);
  for (const f of fichiers.js || []) if (fs.existsSync(f)) verser(libellesJs(fs.readFileSync(f, 'utf8')), false);
  const dicts = chargerDictionnaires({ i18n: fichiers.i18n, dossierLang: fichiers.dossierLang });
  const presentes = langues.filter((l) => dicts[l] && Object.keys(dicts[l]).length > 0);
  const total = libelles.size;
  const parLangue = {};
  const manquants = {};
  for (const l of presentes) {
    let ok = 0;
    const absents = [];
    for (const [cle, e] of libelles) {
      if (estTraduit(dicts[l], cle)) ok++; else absents.push([cle, e]);
    }
    // Les plus visibles d'abord : statiques (HTML) avant dynamiques, puis plus
    // d'occurrences, puis les plus courts (etiquettes de boutons avant phrases).
    absents.sort((a, b) => (b[1].html - a[1].html) || (b[1].occ - a[1].occ) || (a[0].length - b[0].length) || (a[0] < b[0] ? -1 : 1));
    parLangue[l] = { connus: total, traduits: ok, pourcent: total ? Math.round((ok / total) * 1000) / 10 : 100, entreesDictionnaire: Object.keys(dicts[l]).length };
    manquants[l] = absents.slice(0, 30).map(([cle, e]) => ({ libelle: cle, occurrences: e.occ, statique: e.html }));
  }
  return { libelles: total, langues: parLangue, nonTraduitsVisibles: manquants, languesAbsentes: langues.filter((l) => !presentes.includes(l)) };
}

export function mesurerDepot(racine, cibles = CIBLES) {
  const res = {};
  for (const c of cibles) {
    const base = path.join(racine, c.dossier);
    res[c.nom] = mesurerCible({
      html: c.html.map((f) => path.join(base, f)),
      js: c.js.map((f) => path.join(base, f)),
      i18n: path.join(base, c.i18n),
      dossierLang: path.join(base, c.lang),
    });
  }
  return res;
}

function afficher(res) {
  const lignes = [];
  for (const [cible, r] of Object.entries(res)) {
    lignes.push('', '== ' + cible + ' : ' + r.libelles + ' libelles a traduire ==');
    lignes.push('langue  connus  traduits  pourcent');
    for (const [l, v] of Object.entries(r.langues)) {
      lignes.push(l.padEnd(8) + String(v.connus).padStart(6) + String(v.traduits).padStart(10) + (v.pourcent.toFixed(1) + ' %').padStart(11));
    }
    if (r.languesAbsentes.length) lignes.push('(dictionnaire absent : ' + r.languesAbsentes.join(', ') + ')');
    for (const [l, liste] of Object.entries(r.nonTraduitsVisibles)) {
      lignes.push('', cible + '/' + l + ' : 30 libelles les plus visibles non traduits');
      liste.forEach((x, i) => lignes.push('  ' + String(i + 1).padStart(2) + '. ' + JSON.stringify(x.libelle) + (x.statique ? '' : ' (JS)') + (x.occurrences > 1 ? ' x' + x.occurrences : '')));
    }
  }
  return lignes.join('\n');
}

function principal() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  let min = null;
  let racine = path.resolve(ICI, '..');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--min') min = Number(args[++i]);
    else if (args[i] === '--racine') racine = path.resolve(args[++i]);
  }
  if (min !== null && !(min >= 0 && min <= 100)) { console.error('--min attend un pourcentage entre 0 et 100'); process.exit(2); }
  const res = mesurerDepot(racine);
  console.log(json ? JSON.stringify(res, null, 2) : afficher(res));
  if (min !== null) {
    const sous = [];
    for (const [cible, r] of Object.entries(res)) for (const [l, v] of Object.entries(r.langues)) if (v.pourcent < min) sous.push(cible + '/' + l + ' ' + v.pourcent + ' %');
    if (sous.length) { console.error('Sous le seuil de ' + min + ' % : ' + sous.join(', ')); process.exit(1); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) principal();
