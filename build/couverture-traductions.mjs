#!/usr/bin/env node
// Couverture des traductions de l'interface (2026-10-03, vague 5, constat P10).
//
// POURQUOI : l'interface est ecrite en anglais ; chaque langue est un
// dictionnaire « libelle anglais exact -> traduction » (i18n.js + lang/*.js).
// Un libelle sans entree reste en anglais, SANS erreur : rien ne mesurait donc
// la part reellement traduite. Cet outil la mesure, par cible et par langue.
// Il sert aussi de bibliotheque au garde de construction build/check-traductions.mjs.
//
// COMMENT (aucune regle inventee : on rejoue celles de i18n.js) :
//  - Les dictionnaires sont EXECUTES (vm), pas lus par regex : i18n.js (dict
//    en ligne, dont fr) puis lang/*.js, qui appellent FabI18n.register().
//  - Les libelles a traduire = ce que le traducteur du DOM verrait :
//      * HTML : noeuds texte (hors script/style/textarea/pre/code/svg) et
//        attributs placeholder / title / aria-label de TOUTES les balises, y compris
//        textarea / pre / code / svg (2026-10-14 : le placeholder d'un textarea echappait) ;
//      * JS : litteraux passes a t() / tf() / FabI18n.t() / _i18nT() / _i18nTf()
//        ET aux fonctions qui affichent un message (showToast, customError,
//        customConfirm, ...), aux positions qui portent du texte (2026-10-13 :
//        sans elles, les notifications et les fenetres d'erreur — la moitie de
//        ce que l'utilisateur lit — n'etaient pas mesurees) ;
//      * JS : litteraux AFFECTES a textContent / innerText / title / placeholder /
//        ariaLabel ou passes a setAttribute('title' | 'aria-label' | 'placeholder', …)
//        (2026-10-14, revue du lot interface : etats du formulaire de signalement,
//        bulles de la barre du haut).
//    Le filtre « ce n'est pas du texte a traduire » est celui de
//    _shouldAutoTranslate (i18n.js) : sans lettres, URL, jeton de code,
//    valeur du genre « 18s » — SANS son plafond de longueur (2026-10-14).
//  - Un libelle est « traduit » si dict[coeur] ou dict[brut] existe, ou le
//    coeur est le libelle prive de ses symboles de tete (meme regle que
//    _translateNodeValue ET, depuis le 2026-10-13, que _translateAttrs).
//  - Libelles NEUTRES (2026-10-13) : un sigle de format (GLB, FBX), une lettre
//    d'axe ou de touche (X, B), un nom de langue ecrit dans sa langue (Español)
//    ou un nom de produit s'ecrivent pareil partout : ils ne sont ni « traduits »
//    ni « manquants », ils sont comptes a part (liste EXPLICITE ci-dessous,
//    jamais une heuristique qui laisserait passer un vrai mot anglais).
//  Limite assumee : le texte construit dynamiquement (gabarits avec ${...}, valeur
//  passee par une variable : `el.textContent = mot`) n'est pas mesure ; le repli
//  automatique du bureau n'est pas compte.
//
// Usage : node build/couverture-traductions.mjs [--json] [--min <pourcent>] [--racine <dossier>]
// Par defaut informatif (code 0). --min : code 1 si une langue est sous le seuil.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const LANGUES = ['fr', 'es', 'zh', 'hi', 'ar'];

// acorn (deja utilise par check-js-syntax) ; absent -> repli sur l'ancienne extraction par regex.
let acorn = null;
try { acorn = createRequire(import.meta.url)('acorn'); } catch (_) { acorn = null; }

export const CIBLES = [
  { nom: 'bureau', dossier: 'src/renderer', html: ['index2.html'], js: ['index2.js', 'index2-edit-tools.js', 'lib/textes-serveur.js', 'i18n.js'], i18n: 'i18n.js', lang: 'lang' },
  { nom: 'web', dossier: 'cloud/public/app', html: ['index.html'], js: ['index2.js', 'index2-edit-tools.js', 'cloud-overrides.js', 'meshyAPI-cloud.js', 'lib/textes-serveur.js', 'i18n.js'], i18n: 'i18n.js', lang: 'lang' },
];

// Reprise de _shouldAutoTranslate (i18n.js) : ce qui n'est pas un texte a traduire.
// SANS son plafond de 200 caracteres (revue du lot interface, 2026-10-14, bloquant B2) : ce plafond borne
// la traduction AUTOMATIQUE (cout du traducteur local) et ne dit pas si un texte doit etre traduit. Copie ici,
// il sortait de la mesure tout texte long — l'avertissement IA de la fenetre A propos (Store 11.16), les
// textes de vie privee des Reglages — et la garde affichait 100 % avec ces textes en anglais.
export function estTraduisible(cle) {
  if (!cle) return false;
  if (!/[A-Za-z]/.test(cle)) return false;
  if (/^https?:\/\//i.test(cle)) return false;
  if (!/\s/.test(cle) && /[._/\\()]|[a-z][A-Z]/.test(cle)) return false;
  if (cle.length <= 24 && !/[A-Za-z]{4,}/.test(cle) && /^[~≈<>]?\s*\d/.test(cle)) return false;
  if (/\$\{|\{\{/.test(cle)) return false;
  return true;
}

// Libelles identiques dans toutes les langues. LISTE EXPLICITE : un mot anglais
// n'y entre que si sa forme anglaise est la bonne pour TOUS les lecteurs.
export const NEUTRES = new Set([
  // formats de fichier et sigles techniques
  'GLB', 'GLTF', 'FBX', 'OBJ', 'STL', 'USDZ', 'PNG', 'JPG', 'JPEG', 'WebP', 'PBR', 'GPU', 'CPU', 'VRAM', 'RAM', 'UV', 'UVs', 'LOD', 'HDR', 'RGB', 'RGBA', 'API', 'JSON', 'CSV', 'URL', 'ID', 'PIN',
  // marques d'etat et noms de mode internes affiches tels quels (banc de calibration, sorties « 2view »)
  'XX', '2view',
  // noms de langue ecrits dans leur langue (le selecteur doit rester autonyme)
  'English', 'Français', 'Español', '中文', 'हिन्दी', 'العربية',
  // noms de produits et de marques
  'MyFabmesh', 'MyFabmesh.AI', 'MyFabmesh.AI Cloud', 'MyFabmesh.AI 3D Native', 'Claude', 'Claude Code', 'Claude Desktop', 'Blender', 'Unreal Engine', 'Unity', 'Stripe', 'GitHub', 'Discord', 'Sketchfab', 'Windows', 'NVIDIA', 'PowerShell',
]);
export function estNeutre(cle) {
  const c = coeurDe(String(cle || '').trim());
  if (NEUTRES.has(c)) return true;
  if (/^[A-Z][°']?$/.test(c)) return true;           // lettre d'axe ou de touche : X, Y°, B
  return false;
}

// Meme decoupage que _translateNodeValue : coeur = libelle sans symboles de tete.
// Un gabarit de tf() (« {x} credits ») garde sa marque de tete : c'est sa cle de dictionnaire.
export function coeurDe(cle) {
  if (/^\{[xy]\}/.test(cle)) return cle;
  const m = cle.match(/^([^\p{L}\p{N}]+)([\p{L}\p{N}][\s\S]*)$/u);
  return m ? m[2] : cle;
}

// Entites nommees courantes dans les deux pages (le navigateur les decode : le dictionnaire doit porter le caractere).
// &nbsp; et les espaces fines donnent LEUR caractere, pas une espace ordinaire (revue du 2026-10-14) : decodes en
// espace, « 48&nbsp;h » comptait comme traduit alors que le navigateur cherchait « 48 h » et ne trouvait rien.
const ENTITES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', ndash: '–', mdash: '—', times: '×', hellip: '…', middot: '·',
  rarr: '→', larr: '←', harr: '↔', uarr: '↑', darr: '↓', rArr: '⇒', lArr: '⇐', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  laquo: '«', raquo: '»', bull: '•', deg: '°', copy: '©', reg: '®', trade: '™', euro: '€', plusmn: '±', le: '≤', ge: '≥', ne: '≠',
  minus: '−', sup2: '²', sup3: '³', frac12: '½', para: '¶', sect: '§', check: '✓', cross: '✗', star: '☆', hearts: '♥', asymp: '≈',
  infin: '∞', larrhk: '↩', crarr: '↵', loz: '◊', diams: '♦', spades: '♠', clubs: '♣', prime: '′', Prime: '″', thinsp: '\u2009', ensp: '\u2002', emsp: '\u2003',
};
function decoder(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([A-Za-z][A-Za-z0-9]*);/g, (tout, nom) => (Object.prototype.hasOwnProperty.call(ENTITES, nom) ? ENTITES[nom] : tout));
}

// Libelles d'un HTML : { libelle -> occurrences }.
export function libellesHtml(src) {
  const sortie = new Map();
  const ajouter = (brut) => {
    const cle = decoder(brut).trim();
    if (estTraduisible(cle)) sortie.set(cle, (sortie.get(cle) || 0) + 1);
  };
  let s = src.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, '<$1></$1>');
  // textarea / pre / code / svg : leur TEXTE n'est pas traduit (SKIP_TAGS de i18n.js), mais leurs ATTRIBUTS le
  // sont (_translateAttrs parcourt tous les [placeholder], [title], [aria-label]). Avant (bloquant B1 de la revue,
  // 2026-10-14), toute la balise etait remplacee, attributs compris : le placeholder « What is wrong with this
  // result? » du formulaire de signalement echappait a la mesure et restait en anglais dans 4 langues.
  // On garde donc les balises (et leurs attributs) et on retire seulement le texte qu'elles contiennent.
  s = s.replace(/<(textarea|pre|code|svg)\b([^<>]*)>([\s\S]*?)<\/\1>/gi,
    (_, b, attrs, dedans) => '<' + b + attrs + '>' + (dedans.match(/<[a-zA-Z][^<>]*>/g) || []).join('') + '</' + b + '>');
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

// Fonctions dont un argument LITTERAL est du texte montre a l'utilisateur, et ses positions.
// (le 2e argument de showToast est un TYPE — 'error' — pas du texte : il n'est pas compte).
export const PUITS = {
  t: [0], tf: [0], _i18nT: [0], _i18nTf: [0], _t: [0], _tf: [0], _tfp: [0], _toastReg: [0],
  showToast: [0], customError: [0, 1], customErrorWithAction: [0, 1, 2], customConfirm: [0, 1, 2],
  customPrompt: [0, 2, 3], customAlert: [0, 1], reportPipelineError: [0, 1], showGoToToast: [1, 2],
};
const OBJETS_I18N = new Set(['FabI18n', 'I18n']);
// Fonctions qui recoivent le NOM d'un travail, et sa position.
const NOMS_TRAVAUX = { pushJob: 0, gatedRun: 1 };

function litteral(n) {
  if (!n) return null;
  if (n.type === 'Literal' && typeof n.value === 'string') return n.value;
  if (n.type === 'TemplateLiteral' && n.expressions.length === 0) return n.quasis.map((q) => q.value.cooked).join('');
  return null;
}

// Textes POSES PAR AFFECTATION (revue du lot interface, 2026-10-14) : el.textContent = 'Sending your report…',
// btn.title = 'Inbox & contact us', el.setAttribute('aria-label', '…'). Le traducteur du DOM les traduit (son
// observateur voit le noeud texte ajoute ou l'attribut change) s'ils ont une entree ; la mesure ne les voyait pas :
// les messages d'etat du formulaire de signalement (Store 11.16) n'etaient traduits qu'en francais, sans alerte.
export const PROPRIETES_TEXTE = new Set(['textContent', 'innerText', 'title', 'placeholder', 'ariaLabel']);
export const ATTRIBUTS_TEXTE = new Set(['title', 'aria-label', 'placeholder']);
// Feuille de style posee par textContent (style.textContent = '.a { color: red }') : pas du texte affiche.
const estCss = (s) => /\{[^{}]*:[^{}]*\}/.test(s);
function litterauxAffectes(n, sortie) {
  if (!n) return;
  const v = litteral(n);
  if (v != null) { sortie.push(v); return; }
  if (n.type === 'ConditionalExpression') { litterauxAffectes(n.consequent, sortie); litterauxAffectes(n.alternate, sortie); }
  else if (n.type === 'LogicalExpression') { litterauxAffectes(n.left, sortie); litterauxAffectes(n.right, sortie); }
}
function textesAffectes(n) {
  const sortie = [];
  if (n.type === 'AssignmentExpression' && n.operator === '=' && n.left.type === 'MemberExpression' && !n.left.computed
      && n.left.property.type === 'Identifier' && PROPRIETES_TEXTE.has(n.left.property.name)
      // document.title : le titre de l'onglet n'est pas parcouru par le traducteur du DOM
      && !(n.left.object.type === 'Identifier' && n.left.object.name === 'document')) {
    litterauxAffectes(n.right, sortie);
  } else if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && !n.callee.computed
      && n.callee.property.type === 'Identifier' && n.callee.property.name === 'setAttribute'
      && ATTRIBUTS_TEXTE.has(litteral(n.arguments[0]))) {
    litterauxAffectes(n.arguments[1], sortie);
  }
  return sortie.filter((s) => !estCss(s));
}

function nomAppele(callee) {
  if (!callee) return null;
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier') {
    const p = callee.property.name;
    if (p !== 't' && p !== 'tf') return null;
    let o = callee.object;
    if (o.type === 'MemberExpression' && !o.computed && o.property.type === 'Identifier' && o.object.type === 'Identifier' && o.object.name === 'window') o = o.property;
    if (o.type === 'Identifier' && OBJETS_I18N.has(o.name)) return p;
  }
  return null;
}

function analyser(src) {
  for (const sourceType of ['module', 'script']) {
    try { return acorn.parse(src, { ecmaVersion: 'latest', sourceType, allowHashBang: true, allowReturnOutsideFunction: true }); }
    catch (_) { /* essai suivant */ }
  }
  return null;
}

function parcourir(noeud, visite) {
  const pile = [noeud];
  while (pile.length) {
    const n = pile.pop();
    if (!n || typeof n.type !== 'string') continue;
    visite(n);
    for (const k in n) {
      if (k === 'type' || k === 'start' || k === 'end' || k === 'loc' || k === 'range') continue;
      const v = n[k];
      if (Array.isArray(v)) { for (let i = v.length - 1; i >= 0; i--) if (v[i] && typeof v[i].type === 'string') pile.push(v[i]); }
      else if (v && typeof v.type === 'string') pile.push(v);
    }
  }
}

function libellesJsRegex(src) {
  const sortie = new Map();
  const re = /(?<![\w$.])(?:FabI18n\.)?(?:tf|t)\(\s*(["'])((?:\\.|(?!\1)[^\\\n])*)\1/g;
  let m;
  while ((m = re.exec(src))) {
    const cle = m[2].replace(/\\(["'\\])/g, '$1').replace(/\\n/g, '\n').trim();
    if (estTraduisible(cle)) sortie.set(cle, (sortie.get(cle) || 0) + 1);
  }
  return sortie;
}

// Libelles d'un JS : litteraux passes aux fonctions de PUITS (positions de texte)
// et texte des fragments HTML ecrits en JS (innerHTML = `<div>Account</div>…`) :
// le traducteur du DOM les voit comme le reste, la mesure doit les voir aussi.
// Dans un gabarit, chaque ${…} devient « ${…} » : le libelle qui le contient est
// ecarte par estTraduisible (il ne peut pas avoir d'entree de dictionnaire).
export function libellesJs(src) {
  const ast = acorn ? analyser(src) : null;
  if (!ast) return libellesJsRegex(src);
  const sortie = new Map();
  const verserHtml = (texte) => {
    if (!/<[a-zA-Z][^<>]*>/.test(texte)) return;
    for (const [cle, k] of libellesHtml(texte)) sortie.set(cle, (sortie.get(cle) || 0) + k);
  };
  parcourir(ast, (n) => {
    if (n.type === 'TemplateLiteral') { verserHtml(n.quasis.map((q) => q.value.cooked == null ? q.value.raw : q.value.cooked).join('${…}')); return; }
    if (n.type === 'Literal' && typeof n.value === 'string') { verserHtml(n.value); return; }
    for (const v of textesAffectes(n)) {
      const cle = v.trim();
      if (estTraduisible(cle)) sortie.set(cle, (sortie.get(cle) || 0) + 1);
    }
    if (n.type !== 'CallExpression') return;
    // Noms de travaux (panneau « Running jobs ») : stockes en anglais, traduits a l'affichage par
    // _displayJobName, qui cherche le gabarit « Prefixe: {x} » (ou le nom entier s'il est fixe).
    if (n.callee.type === 'Identifier' && Object.prototype.hasOwnProperty.call(NOMS_TRAVAUX, n.callee.name)) {
      const a = n.arguments[NOMS_TRAVAUX[n.callee.name]];
      let cle = null;
      if (a && a.type === 'Literal' && typeof a.value === 'string') cle = a.value;
      else if (a && a.type === 'TemplateLiteral' && a.expressions.length === 1 && a.quasis[1].value.cooked === '' && /: $/.test(a.quasis[0].value.cooked || '')) cle = a.quasis[0].value.cooked + '{x}';
      if (cle && estTraduisible(cle.replace('{x}', 'X').trim())) sortie.set(cle.trim(), (sortie.get(cle.trim()) || 0) + 1);
      return;
    }
    const nom = nomAppele(n.callee);
    if (!nom || !Object.prototype.hasOwnProperty.call(PUITS, nom)) return;
    if (n.callee.type === 'MemberExpression' && nom !== 't' && nom !== 'tf') return;
    for (const i of PUITS[nom]) {
      const a = n.arguments[i];
      const v = litteral(a);
      if (v == null) {
        // « Export failed: » + e.message : lib/textes-serveur.js cherche le gabarit « Export failed: {x} »
        // et traduit le detail a son tour. Le gabarit doit donc exister dans les dictionnaires.
        const prefixe = (a && a.type === 'BinaryExpression' && a.operator === '+') ? litteral(a.left)
          : (a && a.type === 'TemplateLiteral' && a.expressions.length === 1 && a.quasis[1].value.cooked === '') ? a.quasis[0].value.cooked : null;
        if (prefixe && /^[^:{}\n]{2,80}: $/.test(prefixe) && estTraduisible(prefixe.trim())) {
          const cle = prefixe + '{x}';
          sortie.set(cle, (sortie.get(cle) || 0) + 1);
        }
        continue;
      }
      const cle = v.trim();
      if (estTraduisible(cle)) sortie.set(cle, (sortie.get(cle) || 0) + 1);
    }
  });
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

// MEME recherche que i18n.js (_chercher) : la cle exacte, puis — seulement si elle contient deux blancs de suite
// ou un blanc autre que l'espace (retour a la ligne, tabulation, espace insecable) — la cle aux blancs ramenes a
// un espace. Avant (revue du 2026-10-14), la mesure normalisait TOUT blanc et declarait traduit un texte que le
// navigateur ne trouvait pas.
const blancs = (k) => (/\s\s|[^\S ]/.test(k) ? k.replace(/\s+/g, ' ') : null);
function chercher(dict, k) {
  if (!dict || !k) return null;
  if (dict[k]) return dict[k];
  const n = blancs(k);
  return (n && dict[n]) || null;
}
export function valeurDe(dict, cle) {
  if (!dict) return null;
  const coeur = coeurDe(cle);
  return chercher(dict, coeur) || chercher(dict, cle) || null;
}

export function estTraduit(dict, cle) {
  return Boolean(valeurDe(dict, cle));
}

// Libelles d'une cible : Map cle -> { occ, html }.
export function libellesCible(fichiers) {
  const libelles = new Map();
  const verser = (carte, estHtml) => {
    for (const [cle, n] of carte) {
      const e = libelles.get(cle) || { occ: 0, html: false };
      e.occ += n; e.html = e.html || estHtml; libelles.set(cle, e);
    }
  };
  for (const f of fichiers.html || []) if (fs.existsSync(f)) verser(libellesHtml(fs.readFileSync(f, 'utf8')), true);
  for (const f of fichiers.js || []) if (fs.existsSync(f)) verser(libellesJs(fs.readFileSync(f, 'utf8')), false);
  return libelles;
}

// ── Pourcentages et seuils (relecture du lot interface, 2026-10-14) ──────────────────────────────────────────
// La couverture etait ARRONDIE a 0,1 % AVANT d'etre comparee a un seuil : 2 063 / 2 064 = 99,95 % devenait
// « 100.0 % », et une traduction perdue sur le bureau passait la garde du prebuild (seuil 100 %). Desormais :
//  - toute comparaison a un seuil se fait sur les COMPTES exacts, en entiers (sousLeSeuil) ;
//  - un seuil enregistre est la couverture atteinte TRONQUEE (seuilAtteint), jamais arrondie vers le haut ;
//  - le pourcentage AFFICHE reste au dixieme, mais ne vaut jamais 100.0 tant qu'un libelle manque.
// Precision des seuils : 1/10 000 de point (une traduction sur un million de libelles reste visible).
export const PRECISION_SEUIL = 10000;

/** Pourcentage affiche (au dixieme), jamais 100 tant que traduits < total. Ne sert PAS aux comparaisons. */
export function pourcentAffiche(traduits, total) {
  if (!total) return 100;
  const p = Math.round((traduits / total) * 1000) / 10;
  return p >= 100 && traduits < total ? 99.9 : p;
}

/** Vrai si traduits / total est STRICTEMENT sous `seuil` (%). Calcul en entiers : aucun arrondi ne peut
 *  faire passer un libelle manquant. Seuil absent ou non numerique, ou rien a traduire : jamais « sous ». */
export function sousLeSeuil(traduits, total, seuil) {
  if (typeof seuil !== 'number' || !Number.isFinite(seuil) || !total) return false;
  return traduits * 100 * PRECISION_SEUIL < Math.round(seuil * PRECISION_SEUIL) * total;
}

/** Seuil a enregistrer pour un etat donne : la couverture exacte tronquee au 1/10 000 de point. Jamais au-dessus
 *  du reel (sinon la garde refuserait l'etat qui vient d'ecrire son seuil), 100 seulement si tout est traduit. */
export function seuilAtteint(traduits, total) {
  if (!total) return 100;
  return Math.floor((traduits * 100 * PRECISION_SEUIL) / total) / PRECISION_SEUIL;
}

/** Comparaison de deux seuils enregistres a la meme precision (sans les ecarts du calcul en virgule flottante). */
export function seuilPlusBas(a, b) {
  return Math.round(a * PRECISION_SEUIL) < Math.round(b * PRECISION_SEUIL);
}

// Mesure complete d'une cible. `fichiers` : { html: [chemins], js: [chemins], i18n, dossierLang }.
export function mesurerCible(fichiers, langues = LANGUES) {
  const tous = libellesCible(fichiers);
  const libelles = new Map();
  let neutres = 0;
  for (const [cle, e] of tous) { if (estNeutre(cle)) neutres++; else libelles.set(cle, e); }
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
    parLangue[l] = { connus: total, traduits: ok, pourcent: pourcentAffiche(ok, total), entreesDictionnaire: Object.keys(dicts[l]).length };
    manquants[l] = absents.slice(0, 30).map(([cle, e]) => ({ libelle: cle, occurrences: e.occ, statique: e.html }));
  }
  return { libelles: total, neutres, langues: parLangue, nonTraduitsVisibles: manquants, languesAbsentes: langues.filter((l) => !presentes.includes(l)) };
}

export function fichiersCible(racine, c) {
  const base = path.join(racine, c.dossier);
  return {
    html: c.html.map((f) => path.join(base, f)),
    js: c.js.map((f) => path.join(base, f)),
    i18n: path.join(base, c.i18n),
    dossierLang: path.join(base, c.lang),
  };
}

export function mesurerDepot(racine, cibles = CIBLES) {
  const res = {};
  for (const c of cibles) res[c.nom] = mesurerCible(fichiersCible(racine, c));
  return res;
}

function afficher(res) {
  const lignes = [];
  for (const [cible, r] of Object.entries(res)) {
    lignes.push('', '== ' + cible + ' : ' + r.libelles + ' libelles a traduire' + (r.neutres ? ' (+ ' + r.neutres + ' neutres)' : '') + ' ==');
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
    // Sur les comptes exacts, pas sur le pourcentage affiche (arrondi : 2 000 / 2 001 s'affiche 99,9 mais vaut 99,95).
    for (const [cible, r] of Object.entries(res)) {
      for (const [l, v] of Object.entries(r.langues)) if (sousLeSeuil(v.traduits, v.connus, min)) sous.push(cible + '/' + l + ' ' + v.traduits + ' / ' + v.connus + ' (' + v.pourcent + ' %)');
    }
    if (sous.length) { console.error('Sous le seuil de ' + min + ' % : ' + sous.join(', ')); process.exit(1); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) principal();
