// INCLUSION DES VUES (cinquieme relecture, 20/10/2026) : coeur du controle STRUCTUREL de non-recul, partage par vues_sur.mjs (fuzz) et vues_points.mjs (balayage).
// La production (f86208c0) cherche ses termes dans ses vues (`chiffres`, `leetI`, `leetL`, `collees`, `series`) et, pour le filtre general, dans le texte
// SOUPLE (`_simple(_base(texte))`). Si chacune de ces chaines se retrouve telle quelle parmi les vues de la version courante (toutes lectures confondues),
// tout terme que la production y lisait est lu aussi, quelle que soit la liste de termes. Les mots COURTS (« nu », « nue »...) sont lus par la production dans
// ses vues ordinaires, par la version courante dans sa vue EXACTE seulement : tout jeton court d'une vue de la production doit etre un jeton d'une vue exacte.
//
// Ecarts de POLITIQUE documentee, exclus ici : un caractere attribue apres Unicode 14 que NFKC change en lettre (efface par le lot, comme par le tokenizer CLIP de
// Modal) ; « torse nu » (tenue, retiree de la vue exacte) ; une lettre a marque distinctive (nu avec tilde, crochet, corne ou point souscrit : vietnamien, « ñu »).

export const COURTS = ['nu', 'nue', 'nus', 'nues', 'nua', 'nuas'];
const POST_U14 = /[\u{1ccd6}-\u{1ccf9}\u{1e030}-\u{1e06d}]/u;
const MARQUE_DISTINCTIVE = /[̛̣̃̉]/u;

/** Liste des vues de la PRODUCTION absentes de la version courante pour le texte `t` ([] si tout est inclus ; null si le texte est hors champ). */
const _CACHE_IDIOMES = new WeakMap();
/** Expression des mots d'IDIOME de la version courante (« snaked », « nudel* »...) : la production les lisait comme des mots, le lot les retire (politique documentee). */
function expressionIdiomes(A) {
  let re = _CACHE_IDIOMES.get(A);
  if (!re) { re = new RegExp('(?:^| )(?:' + [...A.IDIOMES, ...A.IDIOMES_RACINES].join('|') + ')'); _CACHE_IDIOMES.set(A, re); }
  return re;
}

const _CACHE_PROD = new WeakMap();
/** Les expressions que la PRODUCTION retirait entieres (`IDIOMES_PRODUCTION`), en expression reguliere globale. */
function expressionProduction(A) {
  let re = _CACHE_PROD.get(A);
  if (!re) { re = new RegExp('(?:^| )(?:' + A.IDIOMES_PRODUCTION.join('|') + ')(?= |$)', 'g'); _CACHE_PROD.set(A, re); }
  return re;
}

export function manquants(V, t) {
  if (POST_U14.test(t)) return null;
  const A = V.APRES;
  const p = V.PROD._vuesPlancher(t);
  // hors champ : une vue de la production contient un mot d'idiome (le leet de « 5naked » donne « snaked », « mu s naked »...) ; ces textes sont juges par les cas V6-B5 et le balayage « idiomes »
  const re = expressionIdiomes(A);
  const souplePrd = V.PROD._simple(V.PROD._base(t));
  if ([p.chiffres, p.leetI, p.leetL, souplePrd].some((v) => re.test(v))) return null;
  // hors champ aussi : une vue de la production contient une EXPRESSION SURE de la version courante autre que les expressions que la production retirait elle-meme entieres
  // (« baby <animal> », « rape crop », « hit points »... : exemptions du lot, politique documentee)
  const sansProd = expressionProduction(A);
  if ([p.chiffres, p.leetI, p.leetL, souplePrd].some((v) => { const x = v.replace(sansProd, ' '); return A._sansExpressionsSures(x, []) !== x; })) return null;
  const L = A._lire(t);
  const chaines = new Set(), collees = new Set(), series = new Set(), exactes = new Set();
  for (const v of L.vues) {
    for (const x of [v.chiffres, v.leetI, v.leetL, ...v.separees, ...v.nonEcrasees]) chaines.add(x);
    for (const x of v.collees) collees.add(x);
    for (const x of v.series) series.add(x);
    for (const x of [...v.exactes, ...v.exactesSouples]) for (const j of x.split(' ')) exactes.add(j);
  }
  const manque = [];
  for (const kind of ['chiffres', 'leetI', 'leetL']) if (!chaines.has(p[kind])) manque.push(kind);
  for (const x of p.collees) if (!collees.has(x)) manque.push('collees');
  for (const x of p.series) if (!series.has(x)) manque.push('series');
  if (!MARQUE_DISTINCTIVE.test(t.normalize('NFD'))) {
    for (const kind of ['chiffres', 'leetI', 'leetL']) {
      for (const j of p[kind].replace(/(?:^| )torses? nus?(?= |$)/g, ' ').split(' ')) if (COURTS.includes(j) && !exactes.has(j)) manque.push('court:' + j);
    }
  }
  // texte SOUPLE du filtre general : lu parmi les textes simplifies de la version courante, expressions sures retirees ou gardees (le contexte decide)
  const souples = new Set();
  for (const net of L.nets) {
    for (const des of [[], ['mineur'], ['mineur', 'personne'], ['mineur', 'personne', 'coq', 'chantier']]) souples.add(A._simple(A._sansExpressionsSures(A._sansMarques(net), des)));
  }
  // (expressions que la production retirait ENTIERES : le filtre general lit le texte AUSSI comme elle, avec le declencheur et l'expression REELS du code)
  for (const net of L.nets) {
    const sp = A._sansMarques(net);
    if (A._RE_INDICE_PHRASES.test(sp) && A._RE_IDIOMES_PRODUCTION.test(A._simple(sp))) souples.add(A._simple(sp, true, true));
  }
  for (const x of A._separees([...souples])) souples.add(x);
  if (!souples.has(V.PROD._simple(V.PROD._base(t)))) manque.push('souple');
  return [...new Set(manque)];
}

/** Controle UNIQUE des declencheurs : chaque expression que la production retirait entiere (`IDIOMES_PRODUCTION`) doit contenir un mot de `_RE_INDICE_PHRASES`
 *  (sinon le filtre ne la lirait jamais comme la production). Rend la liste des formes qui echouent. */
export function declencheursManquants(V, expanser) {
  const A = V.APRES, manque = [];
  for (const e of A.IDIOMES_PRODUCTION) for (const forme of expanser(e, 40)) {
    if (!A._RE_INDICE_PHRASES.test(forme) || !A._RE_IDIOMES_PRODUCTION.test(' ' + forme + ' ')) manque.push(forme);
  }
  return manque;
}
