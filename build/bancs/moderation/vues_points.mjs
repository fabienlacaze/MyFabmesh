// BALAYAGE SYSTEMATIQUE PAR INCLUSION DES VUES (cinquieme relecture, 20/10/2026) : controle structurel (inclusion.mjs) sur des familles de textes ou un ou DEUX caracteres
// exotiques se glissent entre les lettres d'un mot epele ; aucune liste de termes : seulement « chaque vue de la production se retrouve-t-elle parmi les vues de la
// version courante ? ».
//   famille 1 : CHAQUE point de code (grands blocs homogenes echantillonnes, comme les autres balayages) dans ~35 gabarits (mots courts, mots du plancher, ages epeles,
//               mineur + nudite colles ou separes, idiomes au contact de lettres isolees, nombres, mots courts colles a une lettre) ;
//   famille 2 : TOUTES les paires ordonnees (c1, c2) de ~70 representants (blancs, controles, formats, marques, symboles, lettres d'autres ecritures, ponctuation...)
//               dans des mots epeles dont chaque intervalle est c1, c2, un espace ou un point (« 4yearold n u<U+2013>e<U+2028>s » est de cette famille).
// Usage : node build/bancs/moderation/vues_points.mjs --famille 1|2 [--tranches K --tranche k] [--fils 3] [--montrer 30]
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { versions, arg, montrer, car, expanser } from './lib_bancs.mjs';
import { manquants, declencheursManquants } from './inclusion.mjs';

const F = (...m) => m.join('');
const NA = F('na', 'ked'), ENF = F('chi', 'ld'), KID = F('ki', 'd'), TOD = F('todd', 'ler'), NUD = F('nu', 'de'), BIK = F('bik', 'ini');
const CSAM = F('cs', 'am'), LOLI = F('lo', 'li'), SHOTA = F('sho', 'ta');
const epeler = (mot, seps) => Array.from(mot).map((ch, i, l) => ch + (i < l.length - 1 ? seps[i % seps.length] : '')).join('');

const GABARITS = [
  (c) => `n${c}u${c}e`, (c) => `n${c}u${c}e${c}s`, (c) => `n u${c}e s`, (c) => `n${c}u e s`, (c) => `n u e${c}s`,
  (c) => `4yearold n u${c}e s`, (c) => `4yearold n${c}u e s`, (c) => `${ENF} n${c}u${c}e`, (c) => `${ENF} nu${c}`, (c) => `${ENF} ${c}nue`, (c) => `${ENF} nus${c}`,
  (c) => `4 y${c}r old ${NA}`, (c) => `9 y${c}r${c}old ${NA}`, (c) => `${NA} person, 1 2 y${c}r o l d`, (c) => `age${c}of${c}12 ${NA}`, (c) => `aged${c}12 ${NA}`,
  (c) => `${ENF} ${epeler(NA, ['.', c, '.', '.'])}`, (c) => `${ENF} ${epeler(NA, [c, '.', '.', '.'])}`, (c) => `${ENF} ${epeler(NA, ['-', '-', '-', c])}`,
  (c) => `${epeler(ENF, ['.', c, '.', '.'])} ${NA}`, (c) => `${epeler(KID, [c, '_'])} ${NUD}`, (c) => epeler(CSAM, ['.', c, '.']), (c) => epeler(LOLI, [c, '.', '.']),
  (c) => epeler(SHOTA, ['.', '.', c, '.']), (c) => `${ENF}${c}${NA}`, (c) => `${ENF} ${c} ${NA}`, (c) => `${NA}${c}${ENF}`, (c) => `${TOD}${c}${BIK}`,
  (c) => `a${c}c h i l d ${NA}`, (c) => `x${c}a${c}c h i l d ${NA}`, (c) => `${NA} person, age${c}12`, (c) => `k${c}id${F('por', 'n')}`,
  // (aucun gabarit avec un idiome ou une expression sure : les vues different alors PAR CONSTRUCTION, c'est de la politique ; le verdict de ces textes est verifie par les
  //  cas V6-B5 du banc et par le balayage « idiomes »)
  (c) => `nu${c}`, (c) => `${c}nuas`, (c) => `torse${c}nus ${ENF}`,
];

/** Representants des paires (~70) : une ou deux de chaque categorie qui compte pour la lecture. */
const REPRESENTANTS = [' ', '.', '-', '_', '*', ',', '\t', '\n', 0xa0, 0x2028, 0x2029, 0x1680, 0x3000, 0xad, 0x200b, 0x200c, 0x200d, 0x200e, 0x2060, 0xfeff, 0x61c, 0x2061,
  0xfe0f, 0x17b5, 0x115f, 0x3164, 0x2800, 0x1, 0x7f, 0x85, 0x180e, 0x301, 0x489, 0x20dd, 0x1dc0, 0x323, 0x303, 0x93f, 0xe31, 0x2122, 0x1f1e6, 0x24cd, 0x2169, 0x667, 0xff10, 0xb2,
  0x2013, 0x2026, 0x3002, 0x30fb, 0xb7, 0xff0c, 0x436, 0x5d0, 0x627, 0x4e2d, 0x3042, 0xf8, 0xdf, 0x127, 0x1d00, 0x430, 0x3b1, 0x585, 0x1f600, 0xe000, 0x378, 0xfffd, 0xfffc,
].map((x) => (typeof x === 'string' ? x : car(x)));

function pointsDeCode() {
  const l = [];
  for (let cp = 0; cp <= 0x10ffff; cp++) {
    if (cp >= 0x61 && cp <= 0x7a) continue;
    const c = car(cp);
    const cjk = (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0x20000 && cp <= 0x3134f) || (cp >= 0x17000 && cp <= 0x18cff);
    if ((/\p{Cn}/u.test(c) && cp % 61 !== 0) || (/\p{Co}/u.test(c) && cp % 251 !== 0) || (cjk && cp % 41 !== 0)) continue;
    l.push(cp);
  }
  return l;
}

/** Textes de la famille 2 pour la paire (c1, c2) : mots epeles dont chaque intervalle est c1, c2, un espace ou un point. */
function textesPaire(c1, c2) {
  const options = [c1, c2, ' ', '.'];
  const sortie = [];
  for (const [mot, contexte] of [['nues', '4yearold '], ['nus', '4yearold '], ['nua', `${ENF} `], ['naked', `${ENF} `], ['child', `${NA} `], ['loli', ''], ['csam', '']]) {
    const intervalles = mot.length - 1;
    const total = options.length ** intervalles;
    for (let k = 0; k < total; k++) {
      const seps = [];
      for (let g = 0, x = k; g < intervalles; g++, x = Math.floor(x / options.length)) seps.push(options[x % options.length]);
      sortie.push(contexte + epeler(mot === 'naked' ? NA : mot === 'child' ? ENF : mot === 'loli' ? LOLI : mot === 'csam' ? CSAM : mot, seps));
    }
  }
  return sortie;
}

const FAMILLE = Number(arg('--famille', 1));
const K = Number(arg('--tranches', 1)), TRANCHE = Number(arg('--tranche', 0));
const LIMITE = Number(arg('--limite', Infinity));   // (essais rapides : nombre maximal d'elements par fil)

if (!isMainThread) {
  const V = versions({ listes: true, sansAvant: true });
  const manques = [];
  let n = 0;
  const juger = (t) => {
    const m = manquants(V, t);
    if (m === null) return;
    n++;
    if (m.length && manques.length < 4000) manques.push([t, m.join('+')]);
  };
  if (FAMILLE === 1) {
    const cps = pointsDeCode();
    for (let k = TRANCHE * workerData.fils + workerData.i, vus = 0; k < cps.length && vus < LIMITE; k += workerData.fils * K, vus++) {
      const c = car(cps[k]);
      for (const g of GABARITS) juger(g(c));
    }
  } else {
    const paires = [];
    for (const a of REPRESENTANTS) for (const b of REPRESENTANTS) paires.push([a, b]);
    for (let k = TRANCHE * workerData.fils + workerData.i, vus = 0; k < paires.length && vus < LIMITE; k += workerData.fils * K, vus++) {
      for (const t of textesPaire(paires[k][0], paires[k][1])) juger(t);
    }
  }
  parentPort.postMessage({ n, manques });
} else {
  const fils = Number(arg('--fils', 3));
  const t0 = Date.now();
  const res = await Promise.all(Array.from({ length: fils }, (_, i) => new Promise((ok, ko) => {
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { i, fils }, argv: process.argv.slice(2), resourceLimits: { maxOldGenerationSizeMb: 1500 } });
    w.on('message', ok); w.on('error', ko);
  })));
  const n = res.reduce((a, r) => a + r.n, 0);
  const tous = new Map();
  for (const r of res) for (const [t, k] of r.manques) if (!tous.has(t)) tous.set(t, k);
  const parKind = {};
  for (const k of tous.values()) parKind[k] = (parKind[k] || 0) + 1;
  console.log(`inclusion des vues, famille ${FAMILLE}, tranche ${TRANCHE + 1}/${K} : ${n} textes, ${tous.size} textes dont une vue de la production MANQUE ${JSON.stringify(parKind)} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  const V = versions({ listes: true, sansAvant: true });
  const sansDeclencheur = declencheursManquants(V, expanser);
  console.log(`declencheurs des expressions que la production retirait entieres : ${sansDeclencheur.length} forme(s) sans declencheur ${JSON.stringify(sansDeclencheur.slice(0, 10))}`);
  if (sansDeclencheur.length) process.exitCode = 1;
  for (const [t, k] of [...tous.entries()].sort((a, b) => a[0].length - b[0].length).slice(0, Number(arg('--montrer', 30)))) {
    console.log(`  [${k}] ${montrer(t).slice(0, 160)}    (production : ${montrer(V.PROD._vuesPlancher(t).chiffres).slice(0, 100)})`);
  }
  process.exit(tous.size ? 1 : 0);
}
