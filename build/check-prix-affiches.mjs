/**
 * GARDE-FOU — les prix AFFICHÉS doivent suivre la grille du worker.
 *
 * Pourquoi ce contrôle existe. Audit du 2026-08-18 : chaque prix montré à
 * l'utilisateur était une constante, et TOUTES avaient dérivé SOUS le prix
 * réellement débité. Toujours dans le même sens — annoncer moins que ce
 * qu'on prélève.
 *
 *     maillage « fast »   annoncé 1   facturé 8    ×8
 *     maillage balanced   annoncé 2   facturé 10
 *     image               annoncé 2   facturé 3
 *     Auto Inpaint        annoncé 3   facturé 6
 *     variantes           annoncé N   facturé 3×N
 *
 * Aucune de ces divergences n'a été détectée par un test : elles ont toutes
 * été trouvées à l'œil, par hasard. C'est cela que ce script corrige.
 *
 * Il vérifie deux choses :
 *   1. Le SITE (appli /app, page mobile /m, pages Next.js) n'écrit AUCUN prix
 *      en dur (2026-09-30, règle du user : tout prix vient de /api/pricing,
 *      rien n'est affiché avant la grille) : ni table de prix, ni chiffre de
 *      repli, ni « +N cr » dans un texte ; et chaque clé de grille qu'il lit
 *      existe dans PRICING_DEFAULTS.
 *   2. Les anciennes constantes en dur du desktop ne sont pas revenues, et
 *      les pastilles lisent toujours la grille.
 *
 * Usage : node build/check-prix-affiches.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lire = (p) => fs.readFileSync(path.join(RACINE, p), 'utf8');

const erreurs = [];
const ok = [];

/* ── 1. La grille du worker, source de vérité ─────────────────────────── */
const worker = lire('cloud/src/worker.ts');
const blocGrille = worker.match(/const PRICING_DEFAULTS = \{([\s\S]*?)\n\};/);
if (!blocGrille) {
  console.error('  PRICING_DEFAULTS introuvable dans cloud/src/worker.ts — le contrôle ne peut pas s\'exécuter.');
  process.exit(1);
}
const grille = {};
for (const m of blocGrille[1].matchAll(/^\s*([a-z_0-9]+)\s*:\s*(\d+)\s*,/gim)) {
  grille[m[1]] = Number(m[2]);
}
ok.push(`grille du worker lue : ${Object.keys(grille).length} tarifs`);

/* ── 2. Le SITE n'affiche AUCUN prix ecrit en dur (2026-09-30) ──────────
 *
 * Regle du user : tout prix affiche vient de GET /api/pricing, et rien n'est
 * affiche tant que la grille n'est pas chargee. Les anciennes valeurs de repli
 * du site (ACTION_COSTS, _COST_DEFAULTS, data-credits du HTML) s'affichaient
 * au demarrage, et pour toujours si la grille ne repondait pas : « Fast » a 1
 * pour 8 factures, Smooth ou Watertight jamais resynchronises.
 *
 * Fichiers d'interface du site : l'appli (/app), la page mobile (/m), les
 * pages Next.js servies par le worker. Les commentaires sont ignores ; les
 * regles portent sur le CODE (tables et valeurs de repli) et sur le TEXTE
 * visible (chaines JS, texte HTML/JSX). */
const clesGrille = Object.keys(grille).sort((a, b) => b.length - a.length);
const ALT_CLES = clesGrille.join('|');

function listerFichiers(dossier, ext) {
  const abs = path.join(RACINE, dossier);
  if (!fs.existsSync(abs)) return [];
  const out = [];
  for (const nom of fs.readdirSync(abs)) {
    const rel = path.posix.join(dossier, nom);
    const st = fs.statSync(path.join(abs, nom));
    if (st.isDirectory()) out.push(...listerFichiers(rel, ext));
    else if (ext.some((e) => nom.endsWith(e))) out.push(rel);
  }
  return out;
}
const WEB_JS = [
  'cloud/public/app/cloud-overrides.js', 'cloud/public/app/index2.js', 'cloud/public/app/meshyAPI-cloud.js',
  'cloud/public/app/index2-edit-tools.js', 'cloud/public/app/canvas-utils.js', 'cloud/public/app/console-capture.js',
  'cloud/public/app/i18n.js', ...listerFichiers('cloud/public/app/lang', ['.js']), 'cloud/public/m/mobile.js',
].filter((f) => fs.existsSync(path.join(RACINE, f)));
const WEB_HTML = ['cloud/public/app/index.html', 'cloud/public/m/index.html']
  .filter((f) => fs.existsSync(path.join(RACINE, f)));
const WEB_TSX = [...listerFichiers('cloud/src/app', ['.tsx']), ...listerFichiers('cloud/src/components', ['.tsx'])];

/** JS -> { code sans commentaires, textes visibles (chaines et gabarits) }. */
function decouperJs(source) {
  const commentaires = [];
  const textes = [];
  let ok = false;
  for (const sourceType of ['script', 'module']) {
    try {
      commentaires.length = 0; textes.length = 0;
      for (const t of acorn.tokenizer(source, { ecmaVersion: 'latest', sourceType, allowHashBang: true,
        onComment: (bloc, texte, debut, fin) => commentaires.push([debut, fin]) })) {
        if (t.type === acorn.tokTypes.string || t.type === acorn.tokTypes.template) textes.push(String(t.value));
      }
      ok = true;
      break;
    } catch (_) { /* on essaie l'autre forme */ }
  }
  if (!ok) return null;   // la syntaxe est l'affaire de check-js-syntax.mjs
  // TABLES DE PRIX : un objet dont au moins DEUX proprietes sont des cles de la
  // grille associees a un petit nombre ({ modify: 3, auto_inpaint: 6 }). Une
  // seule cle ne suffit pas : { rig: 4 } est aussi une table de VRAM.
  const tables = [];
  let ast = null;
  for (const sourceType of ['script', 'module']) {
    try { ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType, locations: true, allowHashBang: true }); break; }
    catch (_) { /* on essaie l'autre forme */ }
  }
  const visiter = (n) => {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'ObjectExpression') {
      const cles = n.properties.filter((p) => p.type === 'Property' && p.value && p.value.type === 'Literal'
        && typeof p.value.value === 'number' && p.value.value < 1000
        && typeof grille[p.key.type === 'Identifier' ? p.key.name : p.key.value] === 'number')
        .map((p) => (p.key.type === 'Identifier' ? p.key.name : p.key.value));
      if (cles.length >= 2) tables.push({ ligne: n.loc.start.line, cles });
    }
    for (const k of Object.keys(n)) {
      if (k === 'loc') continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(visiter);
      else if (v && typeof v.type === 'string') visiter(v);
    }
  };
  visiter(ast);
  // commentaires remplaces par des espaces (les numeros de ligne restent justes)
  const morceaux = [];
  let pos = 0;
  for (const [d, f] of commentaires) {
    morceaux.push(source.slice(pos, d), source.slice(d, f).replace(/[^\n]/g, ' '));
    pos = f;
  }
  morceaux.push(source.slice(pos));
  return { code: morceaux.join(''), textes, tables };
}
const sansCommentairesHtml = (s) => s.replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ' '))
  .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:'"\w])\/\/[^\n]*/g, '$1');

/* Regles sur le CODE : tables de prix et valeurs de repli. */
const REGLES_CODE = [
  { motif: /\b(ACTION_COSTS|_COST_DEFAULTS|_COST_PRICING_KEY|ACTION_COST_TO_PRICING|PRICING_TO_DATA_CREDITS)\s*=/,
    quoi: 'une ancienne table de prix du site (ACTION_COSTS & co)' },
  { motif: /_prixOutfit\s*=\s*\{/, quoi: 'la table de prix d\'Habits en dur' },
  { motif: /['"](?:ws|pts|of|rc|age|bs3d|mat|rz|ex3d|pm|pp|res|mod|ai|mask|mv|var|seg|rrx|pe|lct|sty|mt)-[a-z0-9-]+['"]\s*:\s*\d+(?:\.\d+)?\s*[,}]/,
    quoi: 'un bouton associe a un prix chiffre (table { \'ws-…-btn\': N })' },
  { motif: new RegExp(`\\.(?:${ALT_CLES})\\s*(?:\\?\\?|\\|\\|)\\s*\\d`), quoi: 'un prix de la grille avec un chiffre de repli (?? N / || N)' },
  { motif: new RegExp(`\\.(?:${ALT_CLES})\\s*===\\s*['"]number['"]\\s*\\?[^:;\\n]*:\\s*\\d`),
    quoi: 'un prix de la grille avec un chiffre de repli (typeof … === \'number\' ? … : N)' },
  { motif: /(?:__LIVE_PRICES|(?:_prixDe|_prixGrille|_prixAction)\((?:'[^']*'|[\w.$]+)\))\s*(?:\?\?|\|\|)\s*\d/,
    quoi: 'un prix lu dans la grille avec un chiffre de repli' },
  { motif: /__prixTris\w*\s*(?:\?\?|\|\|)\s*\d/, quoi: 'un parametre de prix des triangles avec un chiffre de repli' },
  { motif: /(?:cost-value|credit-badge|cost-badge|gcp-val|cost-pill)[^\n]{0,160}\|\|\s*['"]\d+['"]/,
    quoi: 'une pastille de prix avec un chiffre de repli (|| \'N\')' },
  { motif: /textContent\s*=\s*[^;\n]*\?\s*['"]\d+['"]\s*:\s*['"]\d+['"]/, quoi: 'un prix choisi entre deux chiffres ecrits en dur' },
  { motif: /data-credits\s*=\s*["']?\d/, quoi: 'un attribut data-credits chiffre' },
  { motif: /data-cost-base\s*=/, quoi: 'un attribut data-cost-base' },
  { motif: /class=\\?["'][^"'>]*(?:credit-badge|cloud-cost-badge|generate-cost-pill)[^"'>]*\\?["'][^>]*>\s*\d+\s*</,
    quoi: 'une pastille de prix contenant un chiffre ecrit en dur' },
  { motif: /id=\\?["'][^"'>]*cost[^"'>]*\\?["'][^>]*>\s*\d+\s*</, quoi: 'un champ de prix (id …cost…) contenant un chiffre ecrit en dur' },
];
/* Regles sur le TEXTE visible : prix ecrits dans une phrase. */
const REGLES_TEXTE = [
  { motif: /\+\s?\d+\s?cr\b/i, quoi: '« +N cr »' },
  { motif: /\(\s?\d+\s?(?:credits?|crédits?|créditos?)\s?\)/i, quoi: '« (N credits) »' },
  { motif: /\b\d+\s?(?:credits?|crédits?)\s(?:per|par|each|chacun)\b/i, quoi: '« N credits per … »' },
  { motif: /\bcosts?\s\d+\s?(?:credits?|cr)\b/i, quoi: '« costs N credits »' },
  { motif: /co[uû]te\s\d+\s?(?:crédits?|cr)\b/i, quoi: '« coûte N crédits »' },
];
const ligneDe = (texte, index) => texte.slice(0, index).split('\n').length;
function appliquer(fichier, code, textes) {
  for (const { motif, quoi } of REGLES_CODE) {
    const m = motif.exec(code);
    if (m) erreurs.push(`${fichier}:${ligneDe(code, m.index)} ecrit ${quoi} : « ${m[0].trim().slice(0, 80)} ». `
      + 'Le site lit ses prix dans la grille (window._prixDe, /api/pricing).');
  }
  for (const t of textes) {
    for (const { motif, quoi } of REGLES_TEXTE) {
      const m = motif.exec(t);
      if (m) erreurs.push(`${fichier} affiche un prix ecrit dans le texte ${quoi} : « ${t.trim().slice(0, 90)} ».`);
    }
  }
}
const erreursAvantWeb = erreurs.length;
const clesLues = new Map();   // cle de grille referencee par le site -> fichier
const noterCles = (fichier, code) => {
  for (const m of code.matchAll(/\b(?:_prixDe|_prixGrille)\(\s*'([a-z_0-9]+)'\s*\)/g)) clesLues.set(m[1], fichier);
  for (const m of code.matchAll(/\bcr\(\s*'([a-z_0-9]+)'\s*\)/g)) clesLues.set(m[1], fichier);
  // tables cle de grille des boutons, modales et options (cloud-overrides.js)
  for (const bloc of code.matchAll(/const (?:ACTION_TARIFS|MODAL_TARIFS|CLE_PRESET|CLE_OPTION) = \{([\s\S]*?)\n\s*\};/g)) {
    for (const m of bloc[1].matchAll(/:\s*'([a-z_0-9]+)'/g)) clesLues.set(m[1], fichier);
  }
};
for (const f of WEB_JS) {
  const d = decouperJs(lire(f));
  if (!d) continue;
  appliquer(f, d.code, d.textes);
  for (const t of d.tables) {
    erreurs.push(`${f}:${t.ligne} ecrit une table de prix chiffree (${t.cles.join(', ')}). `
      + 'Le site lit ses prix dans la grille (window._prixDe, /api/pricing).');
  }
  noterCles(f, d.code);
}
for (const f of WEB_HTML) {
  const sans = sansCommentairesHtml(lire(f));
  // texte visible : ce qui est entre deux balises, et les attributs title/placeholder
  const textes = [...sans.matchAll(/>([^<>]{2,})</g)].map((m) => m[1])
    .concat([...sans.matchAll(/\b(?:title|placeholder|aria-label)="([^"]*)"/g)].map((m) => m[1]));
  appliquer(f, sans, textes);
  noterCles(f, sans);
}
for (const f of WEB_TSX) {
  const sans = sansCommentairesHtml(lire(f));
  const textes = [...sans.matchAll(/>([^<>{}]{2,})</g)].map((m) => m[1])
    .concat([...sans.matchAll(/\b(?:fr|en)="([^"]*)"/g)].map((m) => m[1]));
  appliquer(f, sans, textes);
  noterCles(f, sans);
  // page d'achat : la grille y est lue sous le nom `prix`
  if (f.endsWith('/buy/page.tsx')) for (const m of sans.matchAll(/\bprix\??\.([a-z_0-9]+)/g)) clesLues.set(m[1], f);
}
for (const [cle, f] of clesLues) {
  if (typeof grille[cle] !== 'number') {
    erreurs.push(`${f} lit la cle « ${cle} », absente de PRICING_DEFAULTS : ce prix ne s'afficherait jamais.`);
  }
}
// Le site doit exposer la lecture de grille et la charger.
const surcouche = lire('cloud/public/app/cloud-overrides.js');
for (const { motif, quoi } of [
  { motif: /window\._prixDe\s*=/, quoi: 'la lecture de grille window._prixDe' },
  { motif: /fetch\('\/api\/pricing'\)/, quoi: 'le chargement de la grille (/api/pricing)' },
  { motif: /const ACTION_TARIFS = \{/, quoi: 'la table des cles de grille des boutons (ACTION_TARIFS)' },
]) {
  if (!motif.test(surcouche)) erreurs.push(`cloud/public/app/cloud-overrides.js ne contient plus ${quoi}.`);
}
if (erreurs.length === erreursAvantWeb) {
  ok.push(`site : ${WEB_JS.length + WEB_HTML.length + WEB_TSX.length} fichiers d'interface sans prix en dur, `
    + `${clesLues.size} cles de grille lues, toutes connues du worker`);
}

/* ── 3. Le desktop ne doit pas réintroduire de prix en dur ────────────── */
const rendu = lire('src/renderer/index2.js');

const interdits = [
  { motif: /const BASE = \{\s*fast:\s*\d+/, quoi: 'la table de prix des presets de maillage en dur (const BASE = { fast: … })' },
  { motif: /textContent = String\(\s*\d+\s*\*\s*count\s*\)/, quoi: 'un multiplicateur de prix d\'image en dur (String(N * count))' },
  // Audit du 2026-09-30 : pastilles d'outils, rig, peau, animation et textes
  // « N credits » etaient encore des constantes (Modify 2 pour 3, Auto Inpaint
  // 3 pour 6, Draw Mask 3 pour 6…).
  { motif: /const _CLOUD_(TOOL|LB|LB3D)_PRICES\s*=\s*\{/, quoi: 'une table de prix d\'outils en dur (_CLOUD_TOOL_PRICES & co)' },
  { motif: /AI animation \(\d+ credits?\)/, quoi: 'un prix d\'animation IA écrit dans un texte' },
  { motif: /['"]\d+ credits? per image/, quoi: 'un prix par image écrit dans un texte' },
];
for (const { motif, quoi } of interdits) {
  if (motif.test(rendu)) {
    erreurs.push(`src/renderer/index2.js réintroduit ${quoi}. Les prix doivent venir de window._prixDe().`);
  }
}
// Memes textes cote HTML du bureau, de l'assistant et du web.
for (const f of ['src/renderer/index2.html', 'src/renderer/wizard.html', 'cloud/public/app/index2.js']) {
  const t = lire(f);
  if (/>\s*\d+ credits? per image\s*</.test(t) || /AI animation \(\d+ credits?\)/.test(t)
      || /wiz-fact-val"[^>]*>\s*\d+\s*<\/div>\s*<div class="wiz-fact-lbl">credits \/ image/.test(t)) {
    erreurs.push(`${f} écrit un prix en dur (« N credits per image », « AI animation (N credits) » ou `
      + 'la case « credits / image » de l\'assistant). Le lire dans la grille.');
  }
}

const requis = [
  { motif: /window\._prixDe\s*=/, quoi: 'la fonction de lecture de grille window._prixDe' },
  { motif: /_prixDe\('text2image'\)/, quoi: 'la pastille image lisant text2image dans la grille' },
  { motif: /CLE_PRESET/, quoi: 'la correspondance preset → clé de grille pour le maillage' },
  { motif: /window\._prixBouton\s*=/, quoi: 'la table des prix des outils lue dans la grille (window._prixBouton)' },
];
for (const { motif, quoi } of requis) {
  if (!motif.test(rendu)) {
    erreurs.push(`src/renderer/index2.js ne contient plus ${quoi} — les prix affichés risquent de ne plus suivre la grille.`);
  }
}
if (!interdits.some(({ motif }) => motif.test(rendu))) ok.push('desktop : aucun prix en dur détecté');

/* ── Verdict ──────────────────────────────────────────────────────────── */
if (erreurs.length) {
  console.error('');
  console.error('  PRIX AFFICHÉS INCOHÉRENTS AVEC LA FACTURATION');
  console.error('');
  for (const e of erreurs) console.error('   - ' + e);
  console.error('');
  console.error('  Annoncer un prix inférieur à celui débité est une pratique');
  console.error('  commerciale trompeuse. La grille du worker fait foi :');
  console.error('  cloud/src/worker.ts, PRICING_DEFAULTS.');
  console.error('');
  process.exit(1);
}

for (const l of ok) console.log('[check-prix] ' + l);
console.log('[check-prix] OK — les prix affichés suivent la facturation.');
