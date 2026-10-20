// BALAYAGES DETERMINISTES de non-recul du filtre de texte (cinquieme relecture du lot, 18/10/2026). Chaque balayage construit, a partir des
// LISTES DE LA PRODUCTION (f86208c0), des familles de textes que la production refuse, et verifie que la version APRES les refuse
// encore (au plancher pour les textes « P », par le filtre general pour les « G ») :
//   epeles     mots illicites en soi, epeles avec de la ponctuation et UN OU DEUX caracteres exotiques a la place d'un separateur (B1)
//   ages       ages (nombre + unite, prefixe + nombre) epeles, avec des separateurs et des caracteres exotiques (B1, B2)
//   adjacents  chaque terme de chaque liste de la production, un point de code representatif colle devant ou derriere (B3)
//   idiomes    chaque idiome retire de la lecture, au contact de lettres isolees ou de chiffres isoles (B5)
//   exceptions chaque forme grammaticale des exceptions (idiomes, expressions sures) avec un mineur, un age ou une personne (B4)
// Un recul qui n'est dans aucune famille de politique documentee (familles_politique.mjs) fait echouer le banc.
// Lu par banc_non_recul.mjs (options --epeles, --adjacents, ... ou --exhaustif) ; execute par fil_bancs.mjs (fils de calcul).
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { verdict, recul, car, expanser, montrer, minimiser } from './lib_bancs.mjs';
import { EXCEPTIONS_TERMES, explique } from './familles_politique.mjs';

const F = (...m) => m.join('');
const NA = F('na', 'ked'), NU = F('nu', 'de'), ENF = F('chi', 'ld'), KID = F('ki', 'd'), GIRL = F('gi', 'rl'), BIK = F('bik', 'ini'), SEX = F('s', 'ex');

/** Caracteres exotiques, un ou deux par categorie : format et invisibles, controles, blancs, marques (qui se composent ou non), lettres-emoji et
 *  symboles NFKC, chiffres non ASCII, ponctuation et symboles, usage prive et non assignes, lettres d'autres ecritures. */
export const EXOTIQUES = [
  0x61c, 0x200b, 0x200c, 0x200d, 0x200e, 0x2060, 0x2061, 0x2064, 0xfe0f, 0xfe00, 0xfeff, 0xfff9, 0xfffc, 0xfffd, 0x34f, 0x115f, 0x1160,
  0x17b4, 0x17b5, 0x180e, 0x2800, 0x3164, 0xffa0, 0xad,
  0x1, 0x7, 0x7f, 0x85, 0x9f, 0xa0, 0x2000, 0x2028, 0x3000,
  0x300, 0x301, 0x336, 0x338, 0x483, 0x489, 0x5b0, 0x64b, 0x93f, 0xe31, 0x20d2, 0x20dd, 0x20e3, 0x1dc0, 0xfe20,
  0x1f1e6, 0x1f170, 0x1f150, 0x2122, 0x2121, 0x24cd, 0x2169, 0x24e7, 0x33a1,
  0x667, 0x6f7, 0x7c0, 0xff10, 0x2460, 0xb2, 0xb9,
  0xd7, 0xf7, 0x2022, 0x2013, 0x2026, 0x30fb, 0x3002, 0xff0c, 0xff1a, 0xff3f, 0xfe4d, 0x1f600, 0x1f476,
  0xe000, 0x378, 0x1e030, 0x11f00, 0xe0001, 0xe0020, 0xe0100,
  0x430, 0x435, 0x3b1, 0x585, 0x127, 0x1d00, 0x436, 0x5d0, 0x627, 0x4e2d, 0x3042,
  // blancs et points qui ne sont PAS ramenes en espace ou en ASCII par NFKC (U+2028, U+2029, U+1680) ou qui le sont (le fuzz du 20/10 a trouve un recul avec U+2028)
  0x2029, 0x1680, 0x202f, 0x205f, 0x2007, 0x200a, 0x180b, 0x1d173, 0x2011, 0x2212, 0x2024, 0xfe52, 0xff0e, 0x2027, 0xb7].map(car);
/** Une partie seulement, pour les balayages rapides (une par categorie). */
export const EXOTIQUES_COURT = [0x61c, 0x200b, 0x2061, 0xfe0f, 0x115f, 0x17b5, 0x2800, 0x1, 0x7f, 0xa0, 0x336, 0x489, 0x20dd, 0x1dc0, 0x93f,
  0x1f1e6, 0x2122, 0x667, 0xff10, 0x2022, 0x1f600, 0xe000, 0x378, 0x430, 0x436, 0x127].map(car);
/** Separateurs ordinaires entre les lettres d'un mot epele. */
export const BASES = ['.', '-', '_', '*', '/', '|', ',', ';', ':', '~', '+', '=', '!', '?', '#', '%', '^', '&', '(', ')', ' ', '', '  ', '. ', ' - '];
export const BASES_COURT = ['.', '-', '_', '*', ',', ' ', '/'];

/** Mot epele : chaque lettre suivie du separateur `seps[i]`. */
export const epeler = (mot, seps) => { const c = Array.from(mot); return c.map((ch, i) => ch + (i < c.length - 1 ? seps[i % seps.length] : '')).join(''); };

const sansEtoile = (t) => t.replace(/^\*/, '').replace(/\*$/, '');
const ascii = (l) => [...new Set(l.map(sansEtoile))].filter((x) => x && !/[^\x00-\x7f]/.test(x));
/** Vrai si le terme (son dernier mot) est une exception DOCUMENTEE au niveau du terme (infantry, Pornic, poitrine, heroine, stable...). */
const exception = (w) => EXCEPTIONS_TERMES.some(([re]) => re.test(w.split(' ').pop()));

/** Lexiques tires des listes de la PRODUCTION (formes concretes ASCII ; racines « x* » : la racine seule ; hors exceptions de termes). */
export function lexique(V) {
  const P = V.PROD;
  const net = (l) => ascii(l).filter((w) => !exception(w));
  const illicites = net([...P.PLANCHER_MOTS, ...P.PLANCHER_COLLES]);
  return {
    illicites,
    // un seul mot (epelable lettre par lettre) ; pour un terme de plusieurs mots, la forme collee
    illicitesColles: [...new Set(illicites.map((w) => w.replace(/ /g, '')))],
    mineursFort: net(P.MINEURS_FORT), mineursAmbigus: net(P.MINEURS_AMBIGUS), nuFort: net(P.NU_FORT), nuMoyen: net(P.NU_MOYEN),
    nuFaible: net(P.NU_FAIBLE_PLANCHER), violence: net(P.VIOLENCE_ENFANT_PLANCHER), generalSexuel: net(P.GENERAL_SEXUEL_DUR),
    generalAutres: net([...P.GENERAL_VIOLENCE_DUR, ...P.GENERAL_DROGUE_DUR, ...P.GENERAL_EXTREMISME_DUR, ...P.GENERAL_AUTOBLESSURE_DUR,
      ...P.GENERAL_HAINE_DUR, ...P.GENERAL_ARMES_DUR]),
    nombres: P.__NOMBRES_LETTRES,
  };
}

function nouvelAcc() { return { n: 0, refusesProd: 0, reculs: [] }; }
/** Juge un texte : `niveau` 'P' (plancher seulement, rapide) ou 'G' (filtre general) ; ajoute le recul a `acc`. */
function juger(ctx, t, niveau, acc) {
  acc.n++;
  if (niveau === 'P') {
    if (ctx.V.PROD.checkHardFloor(t).safe) return;
    acc.refusesProd++;
    if (ctx.V.APRES.checkHardFloor(t).safe) acc.reculs.push(['RP', t]);
    return;
  }
  const vp = verdict(ctx.V.PROD, t);
  if (vp === '.') return;
  acc.refusesProd++;
  const r = recul(vp, verdict(ctx.V.APRES, t));
  if (r) acc.reculs.push([r, t]);
}

/** Positions des separateurs exotiques : toutes (`complet`) ou le premier, le milieu, le dernier. */
const positions = (nb, complet) => (complet ? Array.from({ length: nb }, (_, i) => i) : [...new Set([0, Math.floor(nb / 2), nb - 1])]);

// ── Points de code representatifs (adjacents) ─────────────────────────────────────────────────────────────────────────────
export function representants(complet) {
  const vus = new Set();
  const l = [];
  const ajoute = (cp) => { if (!vus.has(cp) && !(cp >= 0xd800 && cp <= 0xdfff)) { vus.add(cp); l.push(cp); } };
  const pas = complet ? [7, 97, 211] : [61, 389, 997];
  for (let cp = 0x80; cp <= 0x2fff; cp += pas[0]) { if (!/\p{Cn}/u.test(String.fromCodePoint(cp))) ajoute(cp); }
  for (let cp = 0x3000; cp <= 0xffff; cp += pas[1]) { if (!/\p{Cn}/u.test(String.fromCodePoint(cp))) ajoute(cp); }
  for (let cp = 0x10000; cp <= 0x1ffff; cp += pas[2]) { if (!/\p{Cn}/u.test(String.fromCodePoint(cp))) ajoute(cp); }
  for (const cp of [0x430, 0x435, 0x43e, 0x436, 0x3a9, 0x3b1, 0x5d0, 0x627, 0x4e2d, 0x3042, 0x30a2, 0xac00, 0x905, 0xe01, 0x1ee5, 0x1eef, 0xf1,
    0xe9, 0xfc, 0xdf, 0xf8, 0xe6, 0x153, 0x131, 0x127, 0xf0, 0xfe, 0x14b, 0x259, 0x61c, 0x200b, 0x200d, 0x2061, 0xfe0f, 0x2122, 0x2460, 0x667,
    0xff10, 0xff41, 0x1d41a, 0x24d0, 0x1f1e6, 0x1f600, 0x1f476, 0x300, 0x301, 0x323, 0x303, 0x31b, 0x489, 0x20dd, 0x1dc0, 0xe0001, 0xad, 0xa0,
    0x2028, 0x3000, 0x1, 0x7f, 0x85]) ajoute(cp);
  return l;
}

// ── Les balayages ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export const TACHES = {
  /** B1 : mots illicites en soi epeles, un ou deux separateurs exotiques parmi des separateurs ordinaires. */
  epeles(ctx, i, n, p) {
    const acc = nouvelAcc();
    const bases = p.complet ? BASES : BASES_COURT, exo = p.complet ? EXOTIQUES : EXOTIQUES_COURT;
    const mots = ctx.L.illicitesColles;
    for (let k = i; k < mots.length; k += n) {
      const w = mots[k], nb = w.length - 1;
      if (nb < 2) continue;
      for (const b of bases) for (const e of exo) for (const pos of positions(nb, p.complet)) {
        const seps = Array(nb).fill(b); seps[pos] = e;
        juger(ctx, epeler(w, seps), 'P', acc);
        for (const q of [pos + 1, pos + 2, nb - 1]) {
          if (q >= nb || q <= pos) continue;
          const s2 = seps.slice(); s2[q] = e;
          juger(ctx, epeler(w, s2), 'P', acc);
        }
      }
    }
    return acc;
  },

  /** B1, B2 : ages (nombre + unite, prefixe + nombre) epeles, avec une tenue explicite. */
  ages(ctx, i, n, p) {
    const acc = nouvelAcc();
    const bases = p.complet ? ['', ' ', '.', '_', '-', '/', ',', '*', '|', ';', ':', '~', '+', '='] : ['', ' ', '.', '_', '-'];
    const exo = p.complet ? EXOTIQUES : EXOTIQUES_COURT.filter((_, k) => k % 3 === 0);
    const nb = [...Array.from({ length: 18 }, (_, k) => String(k)), '01', '09',
      ...(p.complet ? ctx.L.nombres.filter((x, k) => k % 3 === 0) : ['twelve', 'douze', 'doce', 'zwolf', 'dodici', 'doze'])];
    const unites = ['yo', 'y o', 'yr old', 'yrs old', 'yr o', 'years old', 'year old', 'year olds', 'yearold', 'yrold', 'ans', 'anos', 'anni',
      'jahre alt', 'jahrig', 'j alt', 'years of age', 'yrs of age'];
    const prefixes = ['aged', 'age', 'age of', 'ages', 'age de', 'agee de', 'agee', 'edad de', 'edad', 'alter von', 'alter', 'eta di', 'idade de', 'idade'];
    const tenues = [NA, `in a ${BIK}`, F('top', 'less')];
    let c = 0;
    const essayer = (age) => {
      for (const t of tenues) { juger(ctx, `${t} person, ${age}`, 'P', acc); juger(ctx, `a person ${age} ${t}`, 'P', acc); }
    };
    for (const nombre of nb) for (const u of unites) {
      if (c++ % n !== i) continue;
      for (const sp of [' ', '']) {
        essayer(nombre + sp + u);
        for (const b of bases) {
          essayer(epeler(nombre, [b]) + sp + epeler(u, [b]));
          essayer(nombre + sp + epeler(u, [b]));
          essayer(epeler(nombre, [b]) + sp + u);
          // un caractere exotique a la place d'un separateur de l'unite, ou entre le nombre et l'unite
          const un = Array.from(u).length - 1;
          if (un > 0) for (const e of exo) {
            for (const pos of positions(un, false)) { const seps = Array(un).fill(b); seps[pos] = e; essayer(nombre + sp + epeler(u, seps)); }
          }
        }
        for (const e of exo) essayer(nombre + e + u);
      }
    }
    const anglais = ['aged', 'age', 'age of', 'ages'];
    for (const nombre of nb) for (const pre of prefixes) {
      if (c++ % n !== i) continue;
      // exception documentee (politique 8) : apres un prefixe ANGLAIS, un nombre ambigu (elf, due, um, un, une, once) n'est pas un age
      if (anglais.includes(pre) && ctx.V.APRES.NOMBRES_AMBIGUS.includes(nombre)) continue;
      for (const sp of [' ', '']) {
        essayer(pre + sp + nombre);
        for (const b of bases) {
          essayer(epeler(pre, [b]) + sp + nombre);
          essayer(epeler(pre, [b]) + sp + epeler(nombre, [b]));
          const un = Array.from(pre).length - 1;
          if (un > 0) for (const e of exo) { const seps = Array(un).fill(b); seps[Math.min(1, un - 1)] = e; essayer(epeler(pre, seps) + sp + nombre); }
        }
        for (const e of exo) essayer(pre + e + nombre);
      }
    }
    return acc;
  },

  /** B3 : chaque terme des listes de la production, un point de code representatif colle devant ou derriere. */
  adjacents(ctx, i, n, p) {
    const acc = nouvelAcc();
    const cps = representants(p.complet).map(car);
    const jeux = [
      ['nuFort', ctx.L.nuFort, (t, c) => [`child ${t}${c}`, `child ${c}${t}`, `a girl ${t}${c}`, `kid ${c}${t} here`], 'P'],
      ['nuMoyen', ctx.L.nuMoyen, (t, c) => [`child ${t}${c}`, `child ${c}${t}`], 'P'],
      ['nuFaible', ctx.L.nuFaible, (t, c) => [`child ${t}${c}`, `child ${c}${t}`], 'P'],
      ['violence', ctx.L.violence, (t, c) => [`child ${t}${c}`, `child ${c}${t}`], 'P'],
      ['mineursFort', ctx.L.mineursFort, (t, c) => [`${t}${c} ${NA}`, `${c}${t} ${NA}`, `${t}${c} in the bath`], 'P'],
      ['mineursAmbigus', ctx.L.mineursAmbigus, (t, c) => [`${t}${c} ${NA}`, `${c}${t} ${NA}`], 'P'],
      ['illicites', ctx.L.illicites, (t, c) => [`${t}${c}`, `${c}${t}`, `a ${t}${c} b`], 'P'],
      ['generalSexuel', ctx.L.generalSexuel, (t, c) => [`a woman ${t}${c}`, `a woman ${c}${t}`], 'G'],
      ['generalAutres', ctx.L.generalAutres, (t, c) => [`a scene ${t}${c} here`, `a scene ${c}${t} here`], 'G'],
    ];
    let k = 0;
    for (const [, termes, fab, niv] of jeux) {
      for (const t of termes) {
        if (k++ % n !== i) continue;
        for (const c of cps) for (const texte of fab(t, c)) juger(ctx, texte, niv, acc);
      }
    }
    return acc;
  },

  /** B5 : chaque idiome retire de la lecture, entre des lettres isolees ou des chiffres isoles. */
  idiomes(ctx, i, n) {
    const acc = nouvelAcc();
    const A = ctx.V.APRES;
    const mots = new Set();
    for (const e of A.IDIOMES) for (const x of expanser(e, 20)) mots.add(x);
    for (const e of A.IDIOMES_RACINES) {
      const racine = e.replace(/\(\?=.*$/, '');
      for (const x of expanser(racine, 4)) for (const fin of ['', 'n', 'holz', 'suppe', 'chen', 'oi', 'o', 'a']) mots.add(x + fin);
    }
    const liste = [...mots].filter((x) => /^[a-z]+$/.test(x));
    const SPELL = [['c h i l d', 'P'], ['k i d', 'P'], ['g i r l', 'P'], ['t e e n', 'P'], ['b a b y', 'P']];
    let k = 0;
    for (const w of liste) {
      if (k++ % n !== i) continue;
      for (const [min] of SPELL) {
        for (const art of ['a', 'an', 'the', '9', '1 2', 'one', 'my', 'xx']) {
          juger(ctx, `${art} ${w} ${min} ${NA}`, 'P', acc);
          juger(ctx, `${art} ${w}, ${min} ${NA}`, 'P', acc);
          juger(ctx, `${w} ${art} ${min} ${NA}`, 'P', acc);
          juger(ctx, `${min} ${w} ${art} ${NA}`, 'P', acc);
          juger(ctx, `${NA} ${art} ${w} ${min}`, 'P', acc);
          juger(ctx, `${art} ${w} ${epeler(min.replace(/ /g, ''), ['.'])} ${NA}`, 'P', acc);
          juger(ctx, `${art} ${w} ${min.replace(/ /g, '-')} ${NA}`, 'P', acc);
        }
      }
      for (const art of ['a', 'an', 'the', '9', 'xx']) {
        juger(ctx, `${art} ${w} ${SEX.split('').join(' ')}`, 'G', acc);
        juger(ctx, `${art} ${w} ${NU.split('').join(' ')}`, 'G', acc);
        juger(ctx, `${art} ${w} ${NA.split('').join(' ')}`, 'G', acc);
        juger(ctx, `${art} ${w} ${NA.split('').join('.')}`, 'G', acc);
        // age epele au contact de l'idiome (« 9 y r old »)
        juger(ctx, `${NA} person, xx ${w} 9 y r old`, 'P', acc);
        juger(ctx, `${NA} person, ${w} 1 2 y r old`, 'P', acc);
        juger(ctx, `${NA} person, 9 ${w} y r old`, 'P', acc);
        juger(ctx, `${NA} person, 4 y ${w} r o l d`, 'P', acc);
      }
    }
    return acc;
  },

  /** Termes NON LATINS du plancher de la production (PLANCHER_UNICODE : substring sur le texte NFKC, invisibles retires) : invisibles et
   *  caracteres exotiques au milieu, equivalents de compatibilite NFKC, blancs differents entre les deux mots, voisins ASCII ou non. */
  unicode(ctx, i, n, p) {
    const acc = nouvelAcc();
    const termes = ctx.V.PROD.PLANCHER_UNICODE || [];
    const INVIS = [0xad, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2060, 0xfeff].map(car);
    const compat = new Map();
    for (let cp = 0xa0; cp <= 0x2fa1d; cp++) {
      if (cp > 0xffff && cp < 0x2f800) continue;
      const c = String.fromCodePoint(cp);
      let f; try { f = c.normalize('NFKC'); } catch { continue; }
      if (f !== c && Array.from(f).length === 1) { if (!compat.has(f)) compat.set(f, []); compat.get(f).push(c); }
    }
    const exo = p.complet ? EXOTIQUES : EXOTIQUES_COURT;
    const BLANCS = ['  ', '   ', '\t', '\n', '\r\n', '\u00a0', '\u3000', '\u2003', ' \u200b', '\u200b ', ' \u00ad ', '\u2028', '\u0085', '\u1680', '\u202f', '\u205f'];
    const ENTOURS = ['', 'a ', ' a', 'ab', 'a1', '1a', '.', ',', '\u3001', '\u0436', '\u4e2d', 'xx ', ' xx', '(', ')'];
    const essayer = (t) => { for (const e of ENTOURS) { juger(ctx, e + t, 'P', acc); if (e) juger(ctx, t + e, 'P', acc); } };
    let k = 0;
    for (const terme of termes) {
      if (k++ % n !== i) continue;
      const c = Array.from(terme);
      essayer(terme); essayer(terme.toUpperCase());
      for (let pos = 0; pos <= c.length; pos++) {
        for (const x of [...INVIS, ...exo]) essayer(c.slice(0, pos).join('') + x + c.slice(pos).join(''));
        for (const x of INVIS.slice(0, 4)) for (let q = pos; q <= c.length; q++) essayer(c.slice(0, pos).join('') + x + c.slice(pos, q).join('') + x + c.slice(q).join(''));
      }
      for (let pos = 0; pos < c.length; pos++) {
        for (const v of compat.get(c[pos]) || []) essayer(c.slice(0, pos).join('') + v + c.slice(pos + 1).join(''));
      }
      for (const b of BLANCS) if (terme.includes(' ')) { essayer(terme.replace(' ', b)); essayer(terme.replace(' ', b).toUpperCase()); }
      if (terme.includes(' ')) {
        for (const x of exo) { essayer(terme.replace(' ', x)); essayer(terme.replace(' ', ' ' + x + ' ')); }
        essayer(terme.replace(' ', ''));
      }
    }
    return acc;
  },


  /** B4 : chaque forme grammaticale des exceptions (idiomes de la vue exacte, expressions sures), avec un mineur ou un age. */
  exceptions(ctx, i, n) {
    const acc = nouvelAcc();
    const A = ctx.V.APRES;
    const formes = new Set();
    for (const e of A.IDIOMES_EXACTS) for (const x of expanser(e, 60)) formes.add(x);
    for (const e of A.EXPRESSIONS_SURES) for (const x of expanser(e, 60)) formes.add(x);
    const mineurs = [ENF, KID, GIRL, 'enfant', 'menina', 'nina', 'kind', '9 year old', 'aged 12', 'little girl', 'toddler', 'gamine', 'fillette'];
    const adultes = ['woman', 'man', 'she', 'a girl'];
    let k = 0;
    for (const f of formes) {
      if (k++ % n !== i) continue;
      for (const m of mineurs) {
        juger(ctx, `${m} ${f}`, 'P', acc);
        juger(ctx, `${f} ${m}`, 'P', acc);
        juger(ctx, `a ${m}, ${f}, ${NA}`, 'P', acc);
        juger(ctx, `a ${m} in ${BIK}, ${f}`, 'P', acc);
      }
      for (const a of adultes) { juger(ctx, `${a} ${f}`, 'G', acc); juger(ctx, `a ${a}, ${f}, ${BIK}`, 'G', acc); }
    }
    return acc;
  },
};

// ── Orchestration (fils de calcul) ────────────────────────────────────────────────────────────────────────────────────────
/** Lance la tache `nom` sur `fils` fils de calcul ; rend { n, refusesProd, reculs: [[genre, texte], ...] }. */
export async function lancer(nom, params, fils) {
  const parts = await Promise.all(Array.from({ length: fils }, (_, i) => new Promise((ok, ko) => {
    const w = new Worker(fileURLToPath(new URL('./fil_bancs.mjs', import.meta.url)), {
      workerData: { tache: nom, i, n: fils, params }, argv: process.argv.slice(2), resourceLimits: { maxOldGenerationSizeMb: 2000 } });
    w.on('message', ok); w.on('error', ko);
  })));
  const total = { n: 0, refusesProd: 0, reculs: [] };
  for (const r of parts) { total.n += r.n; total.refusesProd += r.refusesProd; total.reculs.push(...r.reculs); }
  return total;
}

/** Reduit chaque recul a son texte minimal, les regroupe, les classe (famille de politique documentee ou INEXPLIQUE) ; affiche ; rend le
 *  nombre de reculs INEXPLIQUES (distincts, apres reduction). */
export function rapporter(titre, res, V, { maxMin = 600, maxAffiches = 40, montrerPolitique = false } = {}) {
  const prop = (genre) => (x) => {
    const vp = verdict(V.PROD, x);
    return (genre === 'RP' ? vp === 'P' : vp === 'G') && recul(vp, verdict(V.APRES, x)) === genre;
  };
  const jug = {
    prod: (t) => verdict(V.PROD, t), apres: (t) => verdict(V.APRES, t),
    vuesProd: (t) => { const v = V.PROD._vuesPlancher(t); return [v.chiffres, v.leetI, v.leetL]; },
    vues: (t) => [...new Set(V.APRES._lire(t).vues.flatMap((v) => [v.chiffres, v.leetI, v.leetL, ...v.separees]))],
  };
  const groupes = new Map();
  let k = 0;
  const vusTexte = new Set();
  for (const [genre, t] of res.reculs) {
    if (vusTexte.has(t)) continue;
    vusTexte.add(t);
    if (k++ >= maxMin) break;
    const m = minimiser(t, prop(genre));
    const cle = genre + ' ' + m.toLowerCase().replace(/\s+/g, ' ');
    const g = groupes.get(cle) || { genre, minimal: m, n: 0, exemple: t };
    g.n++;
    groupes.set(cle, g);
  }
  const par = new Map();
  const inexpliques = [];
  for (const g of groupes.values()) {
    const fam = explique(g.minimal, jug);
    if (fam) { par.set(fam, (par.get(fam) || 0) + g.n); if (montrerPolitique) console.log(`    (politique) ${g.genre} x${g.n} | ${montrer(g.minimal)} :: ${fam.slice(0, 40)}`); } else inexpliques.push(g);
  }
  console.log(`${titre} : ${res.n} textes, ${res.refusesProd} refuses par la production, ${res.reculs.length} reculs bruts, ${groupes.size} textes minimaux distincts`
    + `, dont ${inexpliques.length} INEXPLIQUES`);
  for (const [nom, v] of par) console.log(`    ${String(v).padStart(6)}  politique documentee : ${nom}`);
  for (const g of inexpliques.sort((a, b) => a.minimal.length - b.minimal.length).slice(0, maxAffiches)) {
    console.log(`    RECUL ${g.genre} x${g.n} | ${montrer(g.minimal)}   (exemple : ${montrer(g.exemple).slice(0, 120)})`);
  }
  return inexpliques.length;
}
