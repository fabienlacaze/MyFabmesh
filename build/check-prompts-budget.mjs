#!/usr/bin/env node
/**
 * Refuse une construction dont un gabarit de prompt depasse le budget CLIP,
 * ou dont les trois copies ont diverge.
 *
 * POURQUOI (mesure du 2026-09-23). Un utilisateur signale des batiments
 * coupes alors que le prompt dit « nothing cropped » trois fois. Mesure : le
 * prompt envoye faisait 193 jetons pour une limite CLIP de 77 — SDXL en
 * ignorait ~60 %, et la coupure tombait EN PLEIN dans les consignes de
 * cadrage. Le gabarit 'building' pesait a lui seul 101 jetons.
 *
 * Rien n'avertissait : le texte est construit puis envoye, et ce qui depasse
 * est jete EN SILENCE par le tokenizer. Un defaut invisible qui se voit
 * seulement sur l'image produite, des mois plus tard.
 *
 * DEUX CONTROLES
 *   1. BUDGET — style + prefixe + suffixe doivent laisser de la place au sujet
 *      de l'utilisateur. Plafond : BUDGET_GABARIT jetons.
 *   2. PARITE — le meme gabarit existe en TROIS exemplaires (bureau, web,
 *      serveur Modal). C'est leur divergence qui a produit le doublon : le
 *      nettoyeur cherchait une version, le projet en portait une autre.
 *
 * CLIQUET, pas mur. Quatre gabarits depassent encore aujourd'hui (insect,
 * animal, creature, character). Les bloquer d'un coup arreterait toute
 * construction, donc ils sont inscrits dans prompts-budget-baseline.json avec
 * leur valeur du jour : le garde REFUSE qu'ils grossissent ou qu'un NOUVEAU
 * depassement apparaisse. La dette ne peut que diminuer.
 *
 * Le comptage est une ESTIMATION (mots x 1.35). Le vrai tokenizer CLIP n'est
 * pas disponible en Node ; le facteur est volontairement pessimiste et le
 * plafond garde de la marge.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(RACINE, 'build', 'prompts-budget-baseline.json');

/** Limite CLIP de SDXL. Au-dela, le texte est jete sans avertissement. */
const LIMITE_CLIP = 77;
/** Ce que le gabarit a le droit de consommer, le reste etant pour le sujet. */
const BUDGET_GABARIT = 60;

const jetons = (txt) => Math.round(txt.trim().split(/\s+/).filter(Boolean).length * 1.35);

/** Extrait { cle: texte } d'un objet litteral JS ou d'un dict Python. */
function extraire(source, nom) {
  const i = source.indexOf(nom);
  if (i < 0) return null;
  const debut = source.indexOf('{', i);
  if (debut < 0) return null;
  let prof = 0, fin = -1;
  for (let k = debut; k < source.length; k++) {
    if (source[k] === '{') prof++;
    else if (source[k] === '}') { prof--; if (prof === 0) { fin = k; break; } }
  }
  if (fin < 0) return null;
  const bloc = source.slice(debut, fin);
  const out = {};
  // cle: 'valeur'  ou  'cle': 'valeur'  (JS et Python)
  const re = /['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?\s*:\s*'((?:[^'\\]|\\.)*)'/g;
  let m;
  while ((m = re.exec(bloc))) out[m[1]] = m[2];
  return out;
}

const SOURCES = [
  { nom: 'bureau', chemin: 'src/renderer/index2.js' },
  { nom: 'web', chemin: 'cloud/public/app/index2.js' },
  { nom: 'modal', chemin: 'modal_app/_prompts.py' },
];

const tables = {};
for (const s of SOURCES) {
  const f = join(RACINE, s.chemin);
  if (!existsSync(f)) { console.error(`  fichier absent : ${s.chemin}`); process.exit(1); }
  const src = readFileSync(f, 'utf-8');
  tables[s.nom] = {
    types: extraire(src, 'ASSET_TYPE_PROMPTS') || {},
    styles: extraire(src, 'ASSET_STYLE_PROMPTS') || {},
    prefixes: extraire(src, 'ASSET_TYPE_PREFIXES') || {},
  };
}

let base = {};
try { base = JSON.parse(readFileSync(BASELINE, 'utf-8')); } catch { base = {}; }

const echecs = [];
const nouveaux = {};

// --- 1. BUDGET ---------------------------------------------------------------
const styleMax = Math.max(0, ...Object.values(tables.bureau.styles).map(jetons));
for (const [type, txt] of Object.entries(tables.bureau.types)) {
  const prefixe = tables.bureau.prefixes[type] ? jetons(tables.bureau.prefixes[type]) : 0;
  const total = jetons(txt) + prefixe + styleMax;
  nouveaux[type] = total;
  const tolere = base[type];
  if (total <= BUDGET_GABARIT) continue;
  if (tolere === undefined) {
    echecs.push(`NOUVEAU DEPASSEMENT  ${type} : ${total} jetons (budget ${BUDGET_GABARIT}, limite CLIP ${LIMITE_CLIP})`);
  } else if (total > tolere) {
    echecs.push(`AGGRAVATION          ${type} : ${total} jetons, contre ${tolere} tolere`);
  }
}

// --- 2. PARITE ---------------------------------------------------------------
for (const type of Object.keys(tables.bureau.types)) {
  for (const autre of ['web', 'modal']) {
    const a = tables.bureau.types[type];
    const b = tables[autre].types[type];
    if (b === undefined) { echecs.push(`ABSENT DE ${autre.toUpperCase()}      ${type}`); continue; }
    if (a !== b) echecs.push(`DIVERGENCE bureau/${autre}  ${type}`);
  }
}

// --- Rapport -----------------------------------------------------------------
if (echecs.length) {
  console.error('\n========================================================================');
  console.error('  GABARITS DE PROMPT : la construction est refusee.\n');
  for (const e of echecs) console.error('  ' + e);
  console.error('\n  Au-dela de ' + LIMITE_CLIP + ' jetons, SDXL jette la fin du prompt SANS RIEN DIRE.');
  console.error('  C\'est ainsi que les consignes de cadrage disparaissaient et que les');
  console.error('  batiments sortaient coupes (mesure du 2026-09-23 : 193 jetons envoyes).');
  console.error('\n  Corriger le gabarit, ou -- si la hausse est assumee -- mettre a jour');
  console.error('  build/prompts-budget-baseline.json en expliquant pourquoi.');
  console.error('========================================================================\n');
  process.exit(1);
}

const dette = Object.entries(nouveaux).filter(([, n]) => n > BUDGET_GABARIT);
console.log(`[prompts] ${Object.keys(nouveaux).length} gabarits verifies, parite bureau/web/modal OK`);
if (dette.length) {
  console.log(`[prompts] dette connue (n'augmente pas) : ${dette.map(([t, n]) => `${t} ${n}`).join(', ')}`);
}
