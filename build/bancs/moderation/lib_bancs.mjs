// OUTILS PARTAGES des bancs de non-recul du filtre de texte (banc_non_recul.mjs, balayages.mjs, fuzz.mjs, fil_bancs.mjs).
// Charge la PRODUCTION (f86208c0), la version AVANT (option --avant) et la version APRES (copie de travail) du filtre
// cloud/src/nsfw_filter.ts, avec ou sans l'export de leurs listes ; juge un texte ; reduit un recul a son texte minimal.
// Aucun reseau, aucune installation : git et le module typescript de cloud/node_modules.
import { readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const requireCloud = createRequire(join(RACINE, 'cloud', 'package.json'));
const ts = requireCloud('typescript');

export const arg = (nom, defaut) => { const i = process.argv.indexOf(nom); return i > 0 ? process.argv[i + 1] : defaut; };
export const PROD = arg('--prod', 'f86208c0');
export const AVANT = arg('--avant', 'd5c0c6a3');

/** Listes de la PRODUCTION que les bancs lisent (le module de production ne les exporte pas : on les exporte a l'evaluation). */
export const LISTES_PROD = ['MINEURS_FORT', 'MINEURS_AMBIGUS', 'MINEURS_VIOLENCE', 'NU_FORT', 'NU_MOYEN', 'NU_FAIBLE_PLANCHER', 'NU_FAIBLE_GENERAL',
  'VIOLENCE_ENFANT_PLANCHER', 'PLANCHER_MOTS', 'PLANCHER_COLLES', 'PLANCHER_UNICODE', 'SERIE_MINEURS', 'SERIE_NUDITE', 'GENERAL_SEXUEL_DUR',
  'GENERAL_CTX_SEXUEL', 'CONTEXTE_SEXUEL_FAIBLE', 'GENERAL_CTX_VIOLENCE', 'GENERAL_VIOLENCE_DUR', 'GENERAL_DROGUE_DUR', 'GENERAL_EXTREMISME_DUR',
  'GENERAL_AUTOBLESSURE_DUR', 'GENERAL_HAINE_DUR', 'GENERAL_ARMES_DUR', 'PERSONNES', 'NUDITE_EXTREME', 'VIOLENCE_ENFANT_GENERAL', '_vuesPlancher'];
/** Listes de la version APRES lues par les bancs (idiomes et expressions sures, pour les balayages de leurs variantes). */
export const LISTES_APRES = ['EXPRESSIONS_SURES', 'IDIOMES', 'IDIOMES_RACINES', 'IDIOMES_EXACTS', 'NU_EXACTS', 'NU_MOYEN', 'PLANCHER_MOTS',
  'PLANCHER_COLLES', 'DUREES_NON_AGE', 'GRANDS_NOMBRES', 'NOMBRES_AMBIGUS', 'ANIMAUX_BEBE', 'CONTEXTE_DESACTIVATION', '_lire'];

export function charger(src, noms = []) {
  const extra = noms.length ? '\nexport { ' + noms.join(', ') + ', _NOMBRES_LETTRES as __NOMBRES_LETTRES };\n' : '';
  const js = ts.transpileModule(src + extra, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const ex = {};
  new Function('exports', 'require', js)(ex, requireCloud);
  return ex;
}
export const source = (rev) => execFileSync('git', ['-C', RACINE, 'show', `${rev}:cloud/src/nsfw_filter.ts`], { maxBuffer: 1 << 26 }).toString('utf8');
/** Version APRES : la copie de travail, ou le fichier `NSFW_FILTER_SRC` (preuve d'echec : git show <rev>:cloud/src/nsfw_filter.ts > /tmp/ancien.ts). */
export const sourceApres = () => readFileSync(process.env.NSFW_FILTER_SRC || join(RACINE, 'cloud', 'src', 'nsfw_filter.ts'), 'utf8');

/** { PROD, AVANT, APRES } ; `listes` : les modules exportent aussi leurs listes (LISTES_PROD / LISTES_APRES). */
export function versions({ prod = PROD, avant = AVANT, listes = false, sansAvant = false } = {}) {
  return {
    PROD: charger(source(prod), listes ? LISTES_PROD : []),
    AVANT: sansAvant ? null : charger(source(avant)),
    APRES: charger(sourceApres(), listes ? LISTES_APRES : []),
  };
}

// ── Verdicts ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** 'P' : refuse par le PLANCHER (jamais levable, compte unrestricted compris) ; 'G' : refuse par le filtre general (compte ordinaire) ;
 *  '.' : accepte. */
export const verdict = (m, t) => (!m.checkHardFloor(t).safe ? 'P' : (!m.checkPromptSafety(t, false).safe ? 'G' : '.'));
export const RANG = { '.': 0, G: 1, P: 2 };
/** Recul : la production refuse (au niveau `vProd`) et la version APRES refuse MOINS. Rend 'RP' (plancher perdu), 'RG' (general perdu) ou null. */
export function recul(vProd, vApres) {
  if (RANG[vApres] >= RANG[vProd]) return null;
  return vProd === 'P' ? 'RP' : 'RG';
}
export const montrer = (p) => String(p).replace(/[^\x20-\x7e]/gu, (c) => '<U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0') + '>');
export const car = (cp) => (cp >= 0xd800 && cp <= 0xdfff ? String.fromCharCode(cp) : String.fromCodePoint(cp));

/** Generateur pseudo-aleatoire deterministe (mulberry32). */
export function prng(graine) {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Reduction d'un recul a son texte minimal (ddmin sur les points de code) ────────────────────────────────────────────────
/** Plus petit texte (retrait de blocs de points de code) pour lequel `propriete(texte)` reste vraie. */
export function minimiser(texte, propriete) {
  let cur = Array.from(texte);
  let taille = Math.max(1, cur.length >> 1);
  for (;;) {
    let change = false;
    for (let i = 0; i < cur.length;) {
      const essai = cur.slice(0, i).concat(cur.slice(i + taille));
      if (essai.length && propriete(essai.join(''))) { cur = essai; change = true; } else i += taille;
    }
    if (taille === 1 && !change) break;
    if (taille > 1) taille = Math.max(1, taille >> 1);
  }
  return cur.join('');
}

// ── Vocabulaire CLIP + Qwen du cache Hugging Face local (aucun reseau) ───────────────────────────────────────────────────────
/** Mots (ASCII, sans accents, >= 3 lettres) des vocabulaires CLIP et Qwen du cache local, s'il existe. */
export function vocabulaire() {
  const racine = process.env.HF_HUB_CACHE || join(process.env.HF_HOME || join(homedir(), '.cache', 'huggingface'), 'hub');
  const octets = [...Array.from({ length: 94 }, (_, i) => 33 + i), ...Array.from({ length: 12 }, (_, i) => 161 + i), ...Array.from({ length: 82 }, (_, i) => 174 + i)];
  const dec = new Map();
  let n = 0;
  for (let o = 0; o < 256; o++) dec.set(String.fromCharCode(octets.includes(o) ? o : 256 + n++), o);
  for (const o of octets) dec.set(String.fromCharCode(o), o);
  const decoder = (tok) => { try { return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from([...tok].map((c) => { const v = dec.get(c); if (v === undefined) throw 0; return v; }))); } catch { return null; } };
  const mots = new Set();
  const sources = [];
  for (const [modele, fin, debut] of [['models--openai--clip-vit-large-patch14', '</w>', ''], ['models--Qwen--Qwen3-1.7B', '', '\u{120}']]) {
    let dossiers = [];
    try { dossiers = readdirSync(join(racine, modele, 'snapshots')); } catch { continue; }
    for (const d of dossiers) {
      let vocab;
      try { vocab = JSON.parse(readFileSync(join(racine, modele, 'snapshots', d, 'vocab.json'), 'utf8')); } catch { continue; }
      sources.push(modele);
      for (const k of Object.keys(vocab)) {
        if ((fin && !k.endsWith(fin)) || (debut && !k.startsWith(debut))) continue;
        const t = decoder(k.slice(debut.length, fin ? k.length - fin.length : undefined));
        if (!t) continue;
        const m = t.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/\u{df}/gu, 'ss');
        if (/^[a-z]{3,}$/.test(m)) mots.add(m);
      }
      break;
    }
  }
  return { mots: [...mots], sources };
}

// ── Expansion de la mini-syntaxe des expressions sures ──────────────────────────────────────────────────────────────────────
/** Formes concretes d'un motif de la liste EXPRESSIONS_SURES (« !mot », « mot? », « (?:a|b) », « [a-z]* ») : des chaines ordinaires,
 *  les mots separes par un espace. Les balises « <coq> » en tete et les « ! » sont retires. */
export function expanser(motif, plafond = 40) {
  const s = motif.replace(/^(?:<[a-z]+>)+ /, '').replace(/!/g, '');
  let i = 0;
  function alternatives() {
    const alts = [sequence()];
    while (s[i] === '|') { i++; alts.push(sequence()); }
    return alts.flat();
  }
  function sequence() {
    let acc = [''];
    while (i < s.length && s[i] !== '|' && s[i] !== ')') {
      let piece;
      if (s.startsWith('(?:', i)) { i += 3; piece = alternatives(); i++; }
      else if (s.startsWith('(?!', i) || s.startsWith('(?<!', i)) {
        let prof = 0;
        do { if (s[i] === '(') prof++; else if (s[i] === ')') prof--; i++; } while (i < s.length && prof > 0);
        piece = [''];
      } else if (s[i] === '[') {
        const j = s.indexOf(']', i); const classe = s.slice(i + 1, j); i = j + 1;
        piece = [classe.startsWith('0-9') ? '5' : classe.startsWith('a-z') ? 'x' : classe[0]];
        if (s[i] === '*') { i++; piece = ['', ...piece]; } else if (s[i] === '+') i++;
      } else if (s[i] === '\\') { piece = [s[i + 1]]; i += 2; }
      else { piece = [s[i]]; i++; }
      if (s[i] === '?') { i++; piece = ['', ...piece]; }
      const suivant = [];
      for (const a of acc) for (const p of piece) { suivant.push(a + p); if (suivant.length > 400) break; }
      acc = suivant.slice(0, 400);
    }
    return acc;
  }
  return Array.from(new Set(alternatives())).slice(0, plafond);
}
