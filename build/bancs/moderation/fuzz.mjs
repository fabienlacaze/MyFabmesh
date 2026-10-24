// FUZZ DIFFERENTIEL de non-recul du filtre de texte (cinquieme relecture du lot, 18/10/2026).
// Des millions de textes sont CONSTRUITS (graine fixe) a partir des listes de la PRODUCTION : un mineur ou un age + une nudite, une tenue,
// une scene ou une violence ; ou un terme illicite en soi ; ou un terme explicite du filtre general. Chaque mot subit des deguisements
// (separateurs, ponctuation, caracteres exotiques, lettres d'autres ecritures, leet, homoglyphes, casse, chiffres colles, syntaxe de
// poids, references HTML...) ; des declencheurs d'EXCEPTIONS de la version APRES (idiomes, expressions sures, grands nombres, durees,
// nombres ambigus, tournures de ferme) sont glisses entre les mots. La PRODUCTION sert d'oracle : RECUL = elle refuse (au plancher « P »
// ou au filtre general « G ») et la version APRES refuse MOINS. Chaque recul est reduit a son texte minimal (balayages.mjs : rapporter)
// puis classe : famille de politique documentee, ou INEXPLIQUE (echec du banc).
//
// Modes : plancher | general | mixte | epeles | ages | courts | idiomes | expressions | tout (defaut : un melange de tous).
// Suffixe « +pur » (ex. epeles+pur, plancher+pur) : AUCUN declencheur d'exception n'est glisse (ni idiome, ni expression sure, ni grand nombre,
// ni duree, ni tournure de ferme, ni « baby <animal> »), seulement des mots neutres : tout recul y est un VRAI recul, pas une politique documentee.
// Lu par banc_non_recul.mjs (option --fuzz N [--mode m] [--graine s]) ; execute par fil_bancs.mjs.
import { verdict, recul, car, prng, vocabulaire } from './lib_bancs.mjs';
import { EXCEPTIONS_TERMES } from './familles_politique.mjs';
import { expanser } from './lib_bancs.mjs';
import { EXOTIQUES } from './balayages.mjs';

const sansEtoile = (t) => t.replace(/^\*/, '').replace(/\*$/, '');
const SUFFIXES = ['s', 'es', 'ing', 'ed', 'er', 'ers', 'y', 'ie', 'ies', 'a', 'o', 'e', 'ist', 'ism', 'ity', 'al', 'ic', 'ung', 'chen', 'ita', 'ito'];

/** Formes concretes d'une liste de la production : « x* » donne la racine, un suffixe et `parRacine` mots du vocabulaire qui la commencent. */
function etendre(termes, mots, parRacine, rnd) {
  const sortie = new Set();
  for (const t of termes) {
    const noyau = sansEtoile(t);
    sortie.add(noyau);
    if (t.endsWith('*')) {
      const tete = noyau.split(' ').slice(0, -1).join(' '), q = noyau.split(' ').pop();
      const cands = mots.filter((m) => m.startsWith(q));
      for (let k = 0; k < parRacine && cands.length; k++) sortie.add((tete ? tete + ' ' : '') + cands[Math.floor(rnd() * cands.length)]);
      sortie.add(noyau + SUFFIXES[Math.floor(rnd() * SUFFIXES.length)]);
    }
  }
  return [...sortie].filter((w) => !/[^\x00-\x7f]/.test(w));
}

const SEP_ASCII = [' ', ' ', ' ', ', ', ',', ' - ', '-', '_', '. ', '; ', ' / ', '/', ' | ', ' & ', ' + ', ' (', ') ', ': ', '\n', '\t', '  ', '   ', ' ,',
  '"', "'", '!', '?', '...', '#', '*', '=', '~', '<', '>', '[', ']', '{', '}', '@', '$', '%', '^'];
const SPECIAUX = [...EXOTIQUES, String.fromCharCode(0xd800), String.fromCharCode(0xdc00), '&#8203;', '&#x200b;', '&#173;', '&#0;', '&#65279;', '&amp;', '&#1161;', '&nbsp;', '&shy;', '&zwj;'];
const cps = (...l) => l.map((c) => String.fromCodePoint(c));
const HOMO = { a: cps(0x430, 0x3b1), e: cps(0x435, 0x3b5), o: cps(0x43e, 0x3bf, 0x585), c: cps(0x441), p: cps(0x440, 0x3c1), x: cps(0x445, 0x3c7),
  i: cps(0x456, 0x3b9, 0x131), y: cps(0x443), k: cps(0x43a, 0x3ba), h: cps(0x43d, 0x4bb), n: cps(0x43f, 0x3b7, 0x578), u: cps(0x3c5, 0x3bc, 0x57d),
  s: cps(0x455), t: cps(0x442, 0x3c4), m: cps(0x43c), b: cps(0x432, 0x3b2), d: cps(0x501), w: cps(0x51d, 0x3c9), r: cps(0x433), l: cps(0x4cf),
  j: cps(0x458), g: cps(0x261) };
const LEET = { a: ['4', '@'], e: ['3'], i: ['1', '!'], o: ['0'], s: ['5', '$'], t: ['7'], l: ['1'] };
const FULL = (c) => (c >= 'a' && c <= 'z' ? String.fromCodePoint(c.charCodeAt(0) - 97 + 0xff41) : c);
const MATH = (c) => (c >= 'a' && c <= 'z' ? String.fromCodePoint(c.charCodeAt(0) - 97 + 0x1d41a) : c);
const CIRC = (c) => (c >= 'a' && c <= 'z' ? String.fromCodePoint(c.charCodeAt(0) - 97 + 0x24d0) : c);
// lettres d'autres ecritures (cyrillique, hebreu, arabe, han, kana, grec) et latines sans decomposition (eth, thorn, eng, schwa, sharp s, o barre, l barre),
// puis des lettres a marque : n tilde, u tilde, u corne, u point souscrit, u corne tilde, e accent aigu, u trema
const NON_ASCII_LETTRES = cps(0x436, 0x5d0, 0x627, 0x4e2d, 0x3042, 0x3a9, 0xf0, 0xfe, 0x14b, 0x259, 0xdf, 0xf8, 0x142, 0xf1, 0x169, 0x1b0, 0x1ee5, 0x1eef, 0xe9, 0xfc);

/** Generateur de textes ; `mode` choisit la famille de noyaux. */
export function creerGenerateur(ctx, graine, mode) {
  const rnd = prng(graine);
  const pick = (l) => l[Math.floor(rnd() * l.length)];
  const P = ctx.V.PROD, A = ctx.V.APRES;
  const { mots } = vocabulaire();
  const FILL0 = mots.filter((m) => m.length >= 3 && m.length <= 9);

  // ── Lexiques tires de la PRODUCTION, sans les termes dont l'exception est documentee au niveau du terme ──
  const exceptions = (w) => EXCEPTIONS_TERMES.some(([re]) => re.test(w.split(' ').pop()));
  const retires = [];   // termes retires de l'echantillon parce que la version courante les accepte (recul DE TERME, hors exceptions documentees) : journalises
  const assainir = (liste, gabarits) => liste.filter((w) => {
    if (exceptions(w)) return false;
    for (const [niv, g] of gabarits) {
      const t = g(w);
      const vp = niv === 'P' ? P.checkHardFloor(t).safe : P.checkPromptSafety(t, false).safe;
      if (vp) continue;
      const va = niv === 'P' ? A.checkHardFloor(t).safe : A.checkPromptSafety(t, false).safe;
      if (va) { retires.push(`${niv}:${w}`); return false; }
    }
    return true;
  });
  const MIN_F = assainir(etendre(P.MINEURS_FORT, mots, 2, rnd), [['P', (w) => `a ${w} naked`], ['P', (w) => `a ${w} in a bikini`], ['P', (w) => `a ${w} in the bath`]]);
  const MIN_A = assainir(etendre(P.MINEURS_AMBIGUS, mots, 1, rnd), [['P', (w) => `a ${w} naked`], ['P', (w) => `a ${w} in a bikini`]]);
  const NU_F = assainir(etendre(P.NU_FORT, mots, 2, rnd), [['P', (w) => `a child ${w}`], ['P', (w) => `a girl ${w}`], ['P', (w) => `a 12 year old person ${w}`]]);
  const NU_M = assainir(etendre(P.NU_MOYEN, mots, 1, rnd), [['P', (w) => `a child ${w}`], ['P', (w) => `a girl ${w}`], ['P', (w) => `a person aged 12 ${w}`]]);
  const NU_W = assainir(etendre(P.NU_FAIBLE_PLANCHER, mots, 1, rnd), [['P', (w) => `a child ${w}`], ['P', (w) => `a 12 year old person ${w}`]]);
  const VIOL = assainir(etendre(P.VIOLENCE_ENFANT_PLANCHER, mots, 2, rnd), [['P', (w) => `a child ${w}`], ['P', (w) => `a 12 year old person ${w}`]]);
  const PL_MOTS = assainir(etendre(P.PLANCHER_MOTS, mots, 2, rnd), [['P', (w) => `a ${w} picture`], ['P', (w) => w]]);
  const G_SEX = assainir(etendre(P.GENERAL_SEXUEL_DUR, mots, 2, rnd), [['G', (w) => `a woman ${w}`], ['G', (w) => `a ${w} scene`]]);
  const G_AUTRES = assainir([...P.GENERAL_VIOLENCE_DUR, ...P.GENERAL_DROGUE_DUR, ...P.GENERAL_EXTREMISME_DUR, ...P.GENERAL_AUTOBLESSURE_DUR,
    ...P.GENERAL_HAINE_DUR, ...P.GENERAL_ARMES_DUR].map(sansEtoile), [['G', (w) => `a scene ${w} here`], ['G', (w) => w]]);
  if (retires.length && graine % 1000 === 0) console.error(`[fuzz] ${retires.length} terme(s) RETIRE(S) de l'echantillon (la version courante les accepte dans le gabarit ; a comparer aux exceptions documentees) : ${[...new Set(retires)].slice(0, 60).join(' | ')}`);
  const G_CTX_S = etendre(P.GENERAL_CTX_SEXUEL, mots, 1, rnd), G_CTX_SF = etendre(P.CONTEXTE_SEXUEL_FAIBLE, mots, 1, rnd);
  const G_CTX_V = etendre(P.GENERAL_CTX_VIOLENCE, mots, 1, rnd), MIN_V = etendre(P.MINEURS_VIOLENCE, mots, 1, rnd);
  const V_ENF_G = P.VIOLENCE_ENFANT_GENERAL, PERS = P.PERSONNES, NU_EXT = etendre(P.NUDITE_EXTREME, mots, 1, rnd), NU_FG = P.NU_FAIBLE_GENERAL;
  const FILL = FILL0.filter((w) => !/^(thousand|thousands|hundred|hundreds|million|millions|billion|billions|dozens?|mille|milles|cents?|mil|miles|millones|millon|tausend|hundert|mila|cento|infantry|infanter.*|stable|stability|heroine|nudel.*|pornic|poitrine|years?|yrs?|ans|anos|anni|jahre|months?|siecles?|centuries|century)$/.test(w)
    && P.checkPromptSafety('a woman ' + w, false).safe === A.checkPromptSafety('a woman ' + w, false).safe
    && P.checkHardFloor('a child ' + w + ' naked').safe === A.checkHardFloor('a child ' + w + ' naked').safe);

  // ── Ages ──
  const NB_DIG = Array.from({ length: 18 }, (_, i) => String(i));
  const NB_LET = P.__NOMBRES_LETTRES;
  const PRE = ['aged', 'age', 'age of', 'ages', 'age de', 'agee de', 'agee', 'edad de', 'edad', 'alter von', 'alter', 'eta di', 'idade de', 'idade',
    'age:', 'aged:', 'Age :', 'AGED', 'aged -', 'age =', 'age (', 'just turned'];
  const UNI = ['yo', 'y o', 'yr old', 'yrs old', 'yr o', 'years old', 'year old', 'year olds', 'yearold', 'yrold', 'ans', 'anos', 'anni', 'jahre alt',
    'jahrig', 'jahrige', 'j alt', 'y.o.', 'y/o', 'years of age', 'yrs of age', 'months old'];
  const nb = () => (rnd() < 0.7 ? pick(NB_DIG) : pick(NB_LET));
  const agePhrase = () => {
    const k = rnd(), nbr = nb();
    if (k < 0.5) return `${pick(PRE)}${rnd() < 0.5 ? ' ' : ''}${nbr}`;
    if (k < 0.9) return `${nbr}${rnd() < 0.6 ? ' ' : ''}${pick(UNI)}`;
    return `${nbr}-${pick(['year-old', 'yo', 'y-o'])}`;
  };

  // ── Declencheurs d'exceptions de la version APRES (glisses entre les mots) ──
  const EXPR = [];
  for (const e of A.EXPRESSIONS_SURES) for (const x of expanser(e, 60)) EXPR.push(x);
  const IDIO = [...['snaked', 'pornic', 'nacktkatze', 'nacktkatzen', 'infantry', 'infantries', 'infanterie', 'infanteria', 'infanteristen', 'infantaria'],
    ...A.IDIOMES_RACINES.flatMap((e) => expanser(e.replace(/\(\?=.*$/, ''), 3)), 'nudeln', 'nudelholz', 'nudelsuppe', 'nudel', 'nudelchen', 'nacktschnecke',
    'nacktmull', 'nackthunde', 'spogliatoio', 'seminuovo', 'seminuevo', 'naaktslak', 'torse nu', 'torses nus', 'torse nus', 'torses nu'];
  const GRANDS = ['thousand', 'thousands', 'hundred', 'hundreds', 'million', 'millions', 'billion', 'dozens', 'mille', 'milles', 'cent', 'cents',
    'milliers', 'mil', 'miles', 'millones', 'tausend', 'hundert', 'mila', 'cento', 'milioni', 'milhares', '100 years', '200 years old', '000 years',
    '100 ans', '500 anos', '300 jahre', '1 000 years', '100 months', '100 centuries', '100 siecles', '100 yrs'];
  const DUREES = ['de guerre', 'de service', 'd experience', 'de travail', 'de prison', 'de mer', 'de croisade', 'de retraite', 'de legion', "d'aventures",
    'de guerra', 'de servicio', 'di guerra', 'de servico', 'de carriere', 'de mariage', 'de regne'];
  const ANIMAUX = A.ANIMAUX_BEBE;
  const FERME = ['hens', 'a cock and two hens', 'hens and a cock', 'a crowing cock', 'weather cock', 'the erection of the tower', 'paint stripper', 'moby dick',
    'pussy cats', 'pussy willow', 'bottle nipples', 'rapeseed', 'oilseed rape', 'pelada de futebol', 'viol da gamba', 'play a viol', 'golf foursome'];
  const DESACT = A.CONTEXTE_DESACTIVATION.map(sansEtoile);

  // ── Deguisements d'un mot ──
  function transformerMot(w) {
    if (w.length < 2) return w;
    const k = Math.floor(rnd() * 34);
    const chars = Array.from(w);
    const pos = 1 + Math.floor(rnd() * (chars.length - 1));
    switch (k) {
      case 0: return w.toUpperCase();
      case 1: return w[0].toUpperCase() + w.slice(1);
      case 2: return chars.map((c) => (rnd() < 0.5 ? c.toUpperCase() : c)).join('');
      case 3: return chars.join(' ');
      case 4: return chars.join(pick(['.', '-', '_', '*', '/', '|', ',']));
      case 5: return chars.map((c) => (rnd() < 0.5 ? c + c + c : c)).join('');
      case 6: return chars.map((c) => (LEET[c] && rnd() < 0.7 ? pick(LEET[c]) : c)).join('');
      case 7: return chars.map((c) => (HOMO[c] && rnd() < 0.7 ? pick(HOMO[c]) : c)).join('');
      case 8: case 9: case 10: return chars.slice(0, pos).join('') + pick(SPECIAUX) + chars.slice(pos).join('');
      case 11: return chars.map((c) => c + (rnd() < 0.4 ? pick(SPECIAUX) : '')).join('');
      case 12: return chars.map(FULL).join('');
      case 13: return chars.map(MATH).join('');
      case 14: return chars.map(CIRC).join('');
      case 15: return chars.slice(0, pos).join('') + pick(cps(0x301, 0x336, 0x338, 0x323, 0x303, 0x20dd, 0x489)) + chars.slice(pos).join('');
      case 16: return chars.map((c) => (rnd() < 0.4 ? '&#' + c.codePointAt(0) + ';' : c)).join('');
      case 17: return chars.slice(0, pos).join('') + pick(['()', '[]', ')(', ':1)(', '(:1)']) + chars.slice(pos).join('');
      case 18: return '(' + w + ':' + pick(['1.2', '1.5', '0.8', '9', '2', '0.1', '-3', '99999', '1']) + ')';
      case 19: return '(' + chars.slice(0, pos).join('') + ')(' + chars.slice(pos).join('') + ')';
      case 20: return chars.slice(0, pos).join('') + pick(['1', '2', '3', '7', '9', '0']) + chars.slice(pos).join('');
      case 21: return chars.map((c) => (rnd() < 0.5 ? c : c.normalize('NFD') + String.fromCodePoint(0x301))).join('');
      case 22: return chars.map((c, i) => (i % 2 ? c : c + pick(cps(0x200b, 0xad, 0x2060)))).join('');
      case 23: return chars.slice(0, pos).join('') + pick(NON_ASCII_LETTRES) + chars.slice(pos).join('');
      case 24: case 25: case 26:
        // separateurs INDEPENDANTS par intervalle : ponctuation ordinaire, caractere exotique, espace ou rien
        return chars.map((c, i) => c + (i < chars.length - 1 ? (rnd() < 0.34 ? pick(SEP_ASCII.slice(3, 24)) : rnd() < 0.6 ? pick(SPECIAUX) : rnd() < 0.8 ? '' : ' ') : '')).join('');
      case 27: case 28: case 29: {
        // un seul intervalle exotique, les autres ordinaires (B1)
        const o = pick(['.', '-', '_', '*', '/']);
        const e = Math.floor(rnd() * (chars.length - 1));
        return chars.map((c, i) => c + (i < chars.length - 1 ? (i === e ? pick(SPECIAUX) : o) : '')).join('');
      }
      case 30: case 31: return w + pick(NON_ASCII_LETTRES);                       // lettre d'une autre ecriture collee derriere (B3)
      case 32: return pick(NON_ASCII_LETTRES) + w;                                // ... devant
      default: return w;
    }
  }
  const sep = () => (rnd() < 0.62 ? ' ' : (rnd() < 0.85 ? pick(SEP_ASCII) : pick(SPECIAUX)));

  /** Noyau : liste de segments (mots) dont l'assemblage doit etre refuse par la production. */
  function noyau(m) {
    const k = rnd();
    if (m === 'epeles') {
      // un terme illicite, ou mineur + nudite, epele : un intervalle exotique
      if (k < 0.3) return [pick(PL_MOTS)];
      if (k < 0.65) return [pick(MIN_F), pick(NU_F)];
      return [agePhrase(), pick(NU_F)];
    }
    if (m === 'ages') return [agePhrase(), rnd() < 0.7 ? pick(NU_F) : pick(NU_M)];
    if (m === 'courts') return [pick(MIN_F.concat(MIN_A)), pick(['nu', 'nue', 'nus', 'nues', 'nua', 'nuas'])];
    if (m === 'idiomes') return [pick(MIN_F), pick(NU_F)];
    if (m === 'expressions') return k < 0.4 ? [agePhrase(), pick(NU_F)] : k < 0.8 ? [pick(MIN_F), pick(NU_F)] : [pick(PL_MOTS)];
    if (m === 'plancher' || m === 'mixte') {
      if (k < 0.34) return [pick(MIN_F), pick(NU_F)];
      if (k < 0.48) return [pick(MIN_F), pick(NU_M)];
      if (k < 0.58) return [pick(MIN_F), pick(NU_W)];
      if (k < 0.64) return [pick(MIN_F), pick(VIOL)];
      if (k < 0.72) return [pick(MIN_A), pick(NU_F)];
      if (k < 0.76) return [pick(MIN_A), pick(NU_M)];
      if (k < 0.88) return [agePhrase(), pick(NU_F)];
      if (k < 0.94) return [agePhrase(), pick(NU_M)];
      if (k < 0.97) return [agePhrase(), pick(NU_W)];
      if (k < 0.985) return [agePhrase(), pick(VIOL)];
      return [pick(PL_MOTS)];
    }
    // general
    if (k < 0.35) return [pick(G_SEX)];
    if (k < 0.45) return [pick(G_AUTRES)];
    if (k < 0.60) return [pick(G_CTX_S), pick(G_CTX_SF)];
    if (k < 0.70) return [pick(MIN_V), pick(G_CTX_V)];
    if (k < 0.78) return [pick(PERS), pick(NU_EXT)];
    if (k < 0.86) return [pick(MIN_V), pick(V_ENF_G)];
    if (k < 0.90) return [pick(MIN_F), pick(NU_FG)];
    if (k < 0.95) return [pick(G_CTX_S), pick(G_SEX)];
    return [pick(MIN_F), pick(G_SEX)];
  }

  function fabriquer(mode0) {
    const pur = mode0.endsWith('+pur');
    const m = pur ? mode0.slice(0, -4) : mode0;
    if (m === 'ages-epeles') {
      // un age (nombre + unite, ou prefixe + nombre) epele lettre par lettre, separateurs INDEPENDANTS, a cote d'une tenue explicite
      const pool = [' ', ' ', '.', '-', '_', '*', '/', ',', '|', ':', '\u2013', '\u2028', '\u2029', '\u1680', '\u00a0', '\u3000', '\t', '\n', ...SPECIAUX];
      const epele = (mot) => Array.from(mot).map((c, i, l) => c + (i < l.length - 1 ? (rnd() < 0.5 ? ' ' : pick(pool)) : '')).join('');
      const nombre = rnd() < 0.7 ? pick(NB_DIG) : pick(NB_LET);
      const age = rnd() < 0.6 ? epele(nombre) + (rnd() < 0.5 ? ' ' : pick(pool)) + epele(pick(UNI)) : epele(pick(PRE)) + (rnd() < 0.5 ? ' ' : pick(pool)) + epele(nombre);
      const tenue = pick(NU_F);
      const avant = rnd() < 0.15 ? pick(FILL) + sep() : '';
      return avant + (rnd() < 0.5 ? age + sep() + tenue : tenue + sep() + age);
    }
    if (m === 'courts-epeles') {
      // un mot court epele lettre par lettre, separateurs INDEPENDANTS (blancs, ponctuation, blancs non ASCII, caracteres exotiques)
      const w = pick(['nu', 'nue', 'nus', 'nues', 'nua', 'nuas']);
      const pool = [' ', ' ', '.', '-', '_', '*', '/', ',', '|', ':', '\u2013', '\u2028', '\u2029', '\u1680', '\u00a0', '\u3000', '\t', '\n', ...SPECIAUX];
      const gaps = Array.from({ length: w.length - 1 }, () => (rnd() < 0.45 ? ' ' : pick(pool)));
      const mot = Array.from(w).map((c, i) => c + (i < gaps.length ? gaps[i] : '')).join('');
      const ctx = rnd() < 0.5 ? agePhrase() : pick(MIN_F.concat(MIN_A));
      const avant = rnd() < 0.15 ? pick(FILL) + sep() : '';
      return avant + (rnd() < 0.5 ? ctx + sep() + mot : mot + sep() + ctx);
    }
    const coeur = noyau(m);
    const segs = coeur.slice();
    const nf = m === 'idiomes' || m === 'expressions' ? 1 + Math.floor(rnd() * 3) : Math.floor(rnd() * 4);
    for (let i = 0; i < nf; i++) {
      const r = rnd();
      let f;
      if (pur) f = pick(FILL);
      else if (m === 'idiomes') f = r < 0.6 ? pick(IDIO) : r < 0.8 ? pick(['a', 'an', 'the', '9', '1 2', 'xx']) : pick(FILL);
      else if (m === 'expressions') f = r < 0.6 ? pick(EXPR) : r < 0.85 ? pick(['a', 'an', 'the', '9', '1 2', 'xx', 'y', 'o', '1']) : pick(FILL);
      else if (r < 0.28) f = pick(EXPR);
      else if (r < 0.40) f = pick(IDIO);
      else if (r < 0.52) f = pick(GRANDS);
      else if (r < 0.58) f = pick(DUREES);
      else if (r < 0.62) f = pick(ANIMAUX);
      else if (r < 0.68) f = pick(FERME);
      else if (r < 0.72) f = pick(DESACT);
      else if (r < 0.76) f = pick(A.NOMBRES_AMBIGUS);
      else if (r < 0.78) f = pick(PRE) + ' ' + nb();
      else f = pick(FILL);
      segs.splice(Math.floor(rnd() * (segs.length + 1)), 0, f);
    }
    // deguisements
    const nt = m === 'idiomes' || m === 'expressions' || m === 'epeles' ? 1 + Math.floor(rnd() * 2) : (rnd() < 0.5 ? 0 : 1 + Math.floor(rnd() * 2));
    for (let i = 0; i < nt; i++) {
      const j = Math.floor(rnd() * segs.length);
      if (m === 'idiomes' || m === 'expressions') segs[j] = segs[j].split('').join(' ');                                   // lettres isolees au contact des idiomes
      else if (rnd() < 0.2) segs[j] = segs[j].split(' ').map(transformerMot).join(' ');
      else segs[j] = transformerMot(segs[j]);
    }
    if (!pur && rnd() < 0.05 && segs.length) segs[0] = 'baby ' + pick(ANIMAUX) + ' ' + segs[0];
    let texte = segs[0];
    for (let i = 1; i < segs.length; i++) texte += sep() + segs[i];
    if (rnd() < 0.3) texte = pick(['a ', 'an ', 'the ', 'portrait of ', 'photo, ', 'my ']) + texte;
    if (rnd() < 0.2) texte += pick([', ', ' ', '. ', ' - ']) + pick(FILL);
    return texte;
  }
  return fabriquer;
}

const MODES = ['plancher', 'general', 'mixte', 'epeles', 'ages', 'courts', 'courts-epeles', 'ages-epeles', 'idiomes', 'expressions'];
/** Mode d'un texte quand `mode` est « tout » : repartition fixe. */
const melange = (rnd) => { const r = rnd(); return r < 0.25 ? 'plancher' : r < 0.40 ? 'general' : r < 0.55 ? 'epeles' : r < 0.70 ? 'ages' : r < 0.80 ? 'courts' : r < 0.88 ? 'idiomes' : r < 0.95 ? 'expressions' : 'mixte'; };

export const TACHES_FUZZ = {
  fuzz(ctx, i, n, p) {
    const total = Math.floor(p.total / n);
    const mode = p.mode || 'tout';
    if (mode !== 'tout' && !MODES.includes(mode.replace(/\+pur$/, ''))) throw new Error('mode de fuzz inconnu : ' + mode);
    const fabriquer = creerGenerateur(ctx, p.graine * 1000 + i, mode === 'tout' ? 'mixte' : mode);
    const choix = prng(p.graine * 7919 + i);
    const acc = { n: 0, refusesProd: 0, reculs: [] };
    const vus = new Set();
    for (let k = 0; k < total; k++) {
      const t = fabriquer(mode === 'tout' ? melange(choix) : mode);
      acc.n++;
      const vp = verdict(ctx.V.PROD, t);
      if (vp === '.') continue;
      acc.refusesProd++;
      const r = recul(vp, verdict(ctx.V.APRES, t));
      if (r && !vus.has(t) && acc.reculs.length < (p.plafond || 6000)) { vus.add(t); acc.reculs.push([r, t]); }
    }
    return acc;
  },
};

/** Mutations ALEATOIRES des cas du banc (cas_non_recul.mjs : tous des contournements connus que la production refuse) : un point de code
 *  exotique, une ponctuation, un blanc, un mot d'exception, une casse ou une suppression changes dans le texte. */
const MOTS_MUTATION = ['a', 'the', 'of', 'in', 'snaked', 'pornic', 'nudel', 'infantry', 'baby shower', 'bath toys', 'hit points', 'toy gun', 'pieds nus',
  'torse nu', 'cock and two hens', 'mil', 'thousand', 'elf', 'aged', 'ans de guerre', 'spogliatoio', 'nacktkatze'];
const ORDINAIRES = ['.', ',', '-', '_', '/', '|', '*', ':', ';', '!', '?', '(', ')', '"', "'", '#', '$', '@', '%', '+', '=', '~', ' ', '  ', '\t', '\n'];
TACHES_FUZZ.mutations = async function mutations(ctx, i, n, p) {
  const { cas } = await import('./cas_non_recul.mjs');
  const base = cas().filter(([, att]) => att === 'P' || att === 'G' || att === 'P?' || att === '?').map(([, , t]) => t).filter((t) => t.length < 400);
  const r = prng(p.graine * 100 + i);
  const pick = (l) => l[Math.floor(r() * l.length)];
  const acc = { n: 0, refusesProd: 0, reculs: [] };
  const vus = new Set();
  for (let k = 0; k < Math.floor(p.total / n); k++) {
    let t = pick(base);
    const nm = 1 + Math.floor(r() * 3);
    for (let m = 0; m < nm; m++) {
      const ch = Array.from(t);
      const pos = Math.floor(r() * (ch.length + 1));
      const x = r();
      const ins = x < 0.4 ? String.fromCodePoint(pick(EXOTIQUES_MUT)) : x < 0.7 ? pick(ORDINAIRES) : x < 0.85 ? ' ' + pick(MOTS_MUTATION) + ' ' : '';
      if (x < 0.85) ch.splice(pos, 0, ins);
      else if (x < 0.92) ch[pos] = (ch[pos] || '').toUpperCase();
      else if (x < 0.96) ch.splice(Math.floor(r() * ch.length), 1);
      else ch.splice(pos, 0, ins, pick(ORDINAIRES));
      t = ch.join('');
    }
    acc.n++;
    const vp = verdict(ctx.V.PROD, t);
    if (vp === '.') continue;
    acc.refusesProd++;
    const rc = recul(vp, verdict(ctx.V.APRES, t));
    if (rc && !vus.has(t) && acc.reculs.length < (p.plafond || 6000)) { vus.add(t); acc.reculs.push([rc, t]); }
  }
  return acc;
};
const EXOTIQUES_MUT = [0x61c, 0x200b, 0x200d, 0x2061, 0xfe0f, 0x1dc0, 0x1f1e6, 0x667, 0x20dd, 0x489, 0x17b5, 0x2122, 0x1, 0x7f, 0xa0, 0x127, 0x430, 0x436, 0x5d0,
  0x3b1, 0x585, 0x1d00, 0x323, 0x303, 0x336, 0xad, 0xfffd, 0xfffc, 0xe0001, 0x2800, 0x3164, 0x3a3, 0x378];

// car est utilise par d'autres modules ; re-export pour les essais
export { car };
