// Negations de l'utilisateur (2026-10-03, piste « serveur » : worker) — « an orc, no helmet » : le CLIENT sort la locution du texte et envoie le terme a part
// (`negativeExtra`) ; le WORKER le nettoie de facon stricte et le transporte a Modal (`negative_extra`), qui l'ajoute au NEGATIF.
// Charge les VRAIES fonctions de cloud/src/worker.ts (transpilees) avec des doublures : aucun reseau, aucun GPU.
// Prouve :
//   - _nettoyerNegativeExtra : 8 termes au plus, 40 caracteres, lettres / espaces / tirets, minuscules, sans doublon ; tout le reste est ECARTE sans erreur ;
//     la garde-robe et la nudite sont refusees (meme liste que le tri du client) ; une negation que le filtre de moderation traite comme de la nudite
//     est, par construction, dans cette liste ;
//   - handleGenerateImage transporte le champ nettoye (route T-pose : `negativeExtra` ; route text2image : `negative_extra`) sans toucher au prix, au debit
//     ni au remboursement ; il ne plante JAMAIS sur un champ inattendu (jamais de 400 : un client plus ancien ou plus recent doit continuer a generer) ;
//   - la MODERATION ne se relache pas : le client a jour envoie le texte SANS la locution (« a child » + le terme « weapon »), le worker rend la locution au
//     VRAI filtre (nsfw_filter.ts) : le verdict est celui de « a child, no weapon » (bloque), comme avant ; un terme de garde-robe n'est jamais transporte ;
//   - callModalText2Image / callModalTpose envoient le champ a Modal (essai, reprise apres 524, reprise du filtre de contenu) et, SANS negation, un corps
//     identique a celui d'avant.
// Lancer : cd cloud && node --test tests/negations-utilisateur.test.mjs     (ancien code : WORKER_SRC=<chemin> node --test tests/negations-utilisateur.test.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chargerFonctions, existe } from './_charge-worker.mjs';

// Le VRAI filtre de moderation (transpile depuis src/nsfw_filter.ts, sans reseau), comme tests/moderation.test.mjs. NSFW_FILTER_SRC : un autre exemplaire.
const _ts = createRequire(import.meta.url)('typescript');
const _modFiltre = {};
new Function('exports', 'require', _ts.transpileModule(readFileSync(process.env.NSFW_FILTER_SRC || new URL('../src/nsfw_filter.ts', import.meta.url), 'utf8'),
  { compilerOptions: { target: _ts.ScriptTarget.ES2022, module: _ts.ModuleKind.CommonJS } }).outputText)(_modFiltre, createRequire(import.meta.url));
const { checkPromptSafety } = _modFiltre;

const lire = (rel) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

/** Noms nouveaux du worker : absents de l'ANCIEN code (WORKER_SRC), les tests qui n'en ont pas besoin restent executables dessus. */
const NOUVEAUX = ['_nettoyerNegativeExtra', '_texteDeModerationNegations', 'NEG_MAX_TERMES', 'NEG_MAX_CARS', 'NEG_SENSIBLES'];
const charger = (noms, doublures) => chargerFonctions([...noms, ...NOUVEAUX.filter((n) => existe(n))], doublures);

/* ═══════════════ 1. LE NETTOYAGE (fonction pure) ═══════════════ */
const net = (x) => {
  assert.ok(existe('_nettoyerNegativeExtra'), '_nettoyerNegativeExtra est absente de worker.ts');
  return charger([])._nettoyerNegativeExtra(x);
};

test('nettoyage : les termes propres passent, en minuscules, blancs normalises', () => {
  assert.deepEqual(net(['helmet', 'Golden  Crown', 'foo-bar', ' cape\t']), ['helmet', 'golden crown', 'foo-bar', 'cape']);
  assert.deepEqual(net(['a'.repeat(40)]), ['a'.repeat(40)]);
});

test('nettoyage : tout ce qui n\'est pas un terme propre est ECARTE (jamais corrige, jamais d\'erreur)', () => {
  const mauvais = ['(nude:0)', 'nude), (cape', 'a, b', '[nude]', 'helmet:1.5', 'x\\y', 'café', 'café', 'h3lmet', '1', '', '   ', '-', '--', 'a--b', '-a', 'a-',
    'x'.repeat(41), 'a '.repeat(21), 'rock\nroll;', 'a;b', 'a|b', 'a.b', 'a/b', '"a"', "o'clock", '​helmet'];
  for (const m of mauvais) assert.deepEqual(net([m]), [], JSON.stringify(m));
  for (const entree of [undefined, null, 'helmet', 5, { a: 1 }, true]) assert.deepEqual(net(entree), [], String(entree));
  assert.deepEqual(net([null, 3, {}, ['x'], undefined, 1.5, true]), []);
  // un element invalide n'empeche pas les bons de passer
  assert.deepEqual(net(['(nude:0)', 'helmet', 7, 'cape']), ['helmet', 'cape']);
});

test('nettoyage : doublons ecartes, 8 termes au plus, jamais plus de 64 elements lus', () => {
  assert.deepEqual(net(['a', 'A', 'a ', ' a', 'b']), ['a', 'b']);
  const douze = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima'];
  assert.deepEqual(net(douze), douze.slice(0, 8));
  assert.deepEqual(net(Array(10).fill('(x)').concat(douze)), douze.slice(0, 8), 'les elements invalides ne prennent pas de place parmi les 8');
  assert.deepEqual(net(Array(100).fill('(x)').concat(douze)), [], 'jamais plus de 64 elements lus : meme borne que Modal (termes_negatifs_valides)');
  // un tableau enorme ne coute pas plus qu'un petit
  const enorme = new Array(2_000_000).fill('zz');
  assert.deepEqual(net(enorme), ['zz']);
});

test('nettoyage : la garde-robe et la nudite sont refusees, morceaux a tiret compris', () => {
  const w = charger([]);
  for (const mal of ['clothes', 'Shirt', 'no clothes', 'bare-chested', 'clothes-less', 'nude', 'naked', 'underwear', 'bikini', 'topless', 'nsfw', 'top hat']) {
    assert.deepEqual(w._nettoyerNegativeExtra([mal]), [], mal);
  }
  assert.deepEqual(w._nettoyerNegativeExtra(['clothes', 'helmet', 'shirt', 'cape']), ['helmet', 'cape']);
  for (const mot of w.NEG_SENSIBLES) assert.deepEqual(w._nettoyerNegativeExtra([mot]), [], mot);
});

// Vecteurs du nettoyage : LES MEMES que VECTEURS_NETTOYAGE de build/bancs/noyaux/test_composeur_modal.py (Modal, Python). Le worker (JS) et Modal nettoient a
// l'IDENTIQUE ; verifie en plus le 2026-10-03 sur 6 007 entrees tirees au hasard (graine fixe) : 0 difference entre les deux implementations.
const DOUZE_TERMES = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima'];
const VECTEURS_NETTOYAGE = [
  [['helmet', 'beard'], ['helmet', 'beard']],
  [['Golden  Crown', '\tCAPE\n'], ['golden crown', 'cape']],
  [['(nude:0)', 'helmet'], ['helmet']],
  [['nude), (cape', 'a, b', '[x]', 'x:1.5', 'x\\y'], []],
  [['clothes', 'cape', 'Shirt', 'top hat', 'bare-chested', 'NSFW'], ['cape']],
  [['foo-bar', 'foo - bar', '-x', 'x-', 'a--b'], ['foo-bar']],
  [['café', 'h3lmet', '1', '', '   ', 'a.b', 'a;b', "o'clock"], []],
  [['x'.repeat(40), 'x'.repeat(41)], ['x'.repeat(40)]],
  [['a '.repeat(20)], [Array(20).fill('a').join(' ')]],
  [['a '.repeat(21)], []],
  [['helmet', 'HELMET', ' helmet '], ['helmet']],
  [['hel met'], ['hel met']],
  [[' helmet', 'hel​met', 'ｈelmet'], []],
  [[null, 3, {}, ['x'], true, 1.5], []],
  [null, []],
  ['helmet', []],
  [{ a: 1 }, []],
  [5, []],
  [DOUZE_TERMES, DOUZE_TERMES.slice(0, 8)],
  [Array(10).fill('(x)').concat(DOUZE_TERMES), DOUZE_TERMES.slice(0, 8)],
  [Array(100).fill('(x)').concat(DOUZE_TERMES), []],
];

test('nettoyage : vecteurs communs avec Modal (memes entrees, memes sorties)', () => {
  for (const [entree, attendu] of VECTEURS_NETTOYAGE) assert.deepEqual(net(entree), attendu, JSON.stringify(entree));
});

test('nettoyage : propriete sur 5 000 entrees tirees au hasard — jamais plus de 8 termes, tous propres, sans doublon, sans garde-robe', () => {
  const w = charger([]);
  let etat = 20261003;                                       // generateur congruentiel : meme suite a chaque lancement
  const hasard = () => { etat = (Math.imul(etat, 1664525) + 1013904223) >>> 0; return etat / 4294967296; };
  const choix = (t) => t[Math.floor(hasard() * t.length)];
  const morceaux = ['helmet', 'Helmet', 'beard', 'golden crown', 'foo-bar', 'a', '-', '--', ' ', '', '\t', '\n', ' ', ' ', 'clothes', 'Shirt', 'nude', 'top',
    'top hat', 'bare-chested', 'nsfw', '(nude:0)', 'nude), (cape', 'a, b', '[x]', 'x:1.5', '1', 'h3lmet', 'café', "o'clock", '"a"', 'a.b', 'a;b', 'x'.repeat(41)];
  let retenus = 0;
  for (let i = 0; i < 5000; i++) {
    const k = choix([0, 1, 2, 3, 9, 70]);
    const entree = Array.from({ length: k }, () => (hasard() < 0.1 ? choix([null, 3, {}, ['x'], true])
      : Array.from({ length: 1 + Math.floor(hasard() * 3) }, () => choix(morceaux)).join(choix([' ', '', '-', '\t']))));
    const sortie = w._nettoyerNegativeExtra(entree);
    assert.ok(sortie.length <= 8, JSON.stringify(entree));
    assert.equal(new Set(sortie).size, sortie.length, 'doublon : ' + JSON.stringify(sortie));
    for (const t of sortie) {
      retenus++;
      assert.match(t, /^[a-z]+(?:[ -][a-z]+)*$/, JSON.stringify(t));
      assert.ok(t.length <= 40, t);
      for (const p of t.split(/[ -]/)) assert.ok(!w.NEG_SENSIBLES.has(p), 'garde-robe : ' + t);
    }
  }
  assert.ok(retenus > 1000, 'le generateur doit produire de vrais termes : ' + retenus);
});

test('les constantes du nettoyage (8 termes, 40 caracteres) sont celles du tri du client', () => {
  const w = charger([]);
  assert.equal(w.NEG_MAX_TERMES, 8);
  assert.equal(w.NEG_MAX_CARS, 40);
  for (const chemin of ['../../scripts/composeur_intention.py', '../../modal_app/composeur_intention.py']) {
    const py = readFileSync(new URL(chemin, import.meta.url), 'utf8');
    assert.match(py, /^MAX_TERMES_NEGATIFS = 8\b/m, chemin);
    assert.match(py, /^MAX_CARS_TERME = 40\b/m, chemin);
  }
});

test('la liste refusee est EXACTEMENT celle du tri du client (composeur_intention.py, bureau / web / Modal)', () => {
  const w = charger([]);
  for (const chemin of ['../../scripts/composeur_intention.py', '../../modal_app/composeur_intention.py']) {
    const py = readFileSync(new URL(chemin, import.meta.url), 'utf8');
    const m = py.match(/_NEG_SENSIBLES = frozenset\(\(([\s\S]*?)\)\.split\(\)\)/);
    assert.ok(m, '_NEG_SENSIBLES introuvable dans ' + chemin);
    const mots = [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]).join(' ').split(/\s+/).filter(Boolean);
    assert.deepEqual([...w.NEG_SENSIBLES].sort(), [...new Set(mots)].sort(), chemin);
  }
});

test('toute negation que le filtre de moderation traite comme de la nudite est dans la liste refusee (donc reste dans le texte, sous ses yeux)', () => {
  const w = charger([]);
  const filtre = lire('src/nsfw_filter.ts');
  const phrases = [...filtre.matchAll(/'((?:wearing )?(?:no|without) [a-z ]+)'/g)].map((x) => x[1]);
  assert.ok(phrases.length >= 10, 'le filtre porte au moins une dizaine de negations de nudite : ' + phrases.length);
  for (const p of phrases) {
    const mots = p.replace(/^(?:wearing )?(?:no|without) /, '').split(' ').filter((x) => !['a', 'an', 'any', 'the'].includes(x));
    for (const mot of mots) {
      assert.ok(w.NEG_SENSIBLES.has(mot), `« ${p} » est une negation de nudite pour le filtre, mais « ${mot} » n'est pas refuse dans negativeExtra (NEG_SENSIBLES, `
        + 'composeur_intention.py) : ajouter le mot aux DEUX listes, sinon la negation sortirait du texte que le filtre examine');
    }
  }
});

/* ═══════════════ 2. handleGenerateImage : transport du champ ═══════════════ */
const GRILLE = { text2image: 6, tpose: 1 };

function monter({ tposeUrl = 'https://tpose.example', t2iUrl = 'https://t2i.example', echec = false, grille = GRILLE, filtreReel = false } = {}) {
  const j = { depenses: [], remboursements: [], tposeAppels: [], t2iAppels: [], journal: [], assets: [], moderation: [] };
  const reponse = (o, init) => new Response(JSON.stringify(o), { status: (init && init.status) || 200, headers: { 'content-type': 'application/json' } });
  const dbl = {
    getSessionUser: async () => ({ id: 'u1', email: 'a@b.c' }),
    err: (status, message) => reponse({ error: message }, { status }),
    json: (o, init) => reponse(o, init),
    getParentalState: async () => ({}),
    _checkPromptSafetyAlerte: async (_e, _u, texte, unrestricted) => { j.moderation.push(texte); return filtreReel ? checkPromptSafety(texte, !!unrestricted) : { safe: true }; },
    getPrice: async (_env, k) => grille[k],
    isTrustedAssetHost: () => true,
    checkAndIncrementModalSpend: async () => 100,
    checkAndIncrementDailySpend: async () => 100,
    _spendRefusalMessage: async () => 'refus',
    checkAndIncrementUserCalls: async () => 10,
    refundModalSpend: async () => {},
    refundDailySpend: async () => {},
    spendCredits: async (_e, _u, cout) => { j.depenses.push(cout); return 500 - cout; },
    addCredits: async (_e, _u, cout) => { j.remboursements.push(cout); },
    callModalTpose: async (_e, _u, input) => { j.tposeAppels.push(input); if (echec) throw new Error('GPU en panne'); return 'https://r2.example/front/t.png'; },
    callModalText2Image: async (_e, _u, input) => { j.t2iAppels.push(input); if (echec) throw new Error('GPU en panne'); return 'https://r2.example/front/i.png'; },
    callMyfabmeshCog: async (_e, _u, input) => { j.t2iAppels.push(input); return 'https://r2.example/front/c.png'; },
    logOperation: async (_e, _u, type, cout, _d, _f, statut) => { j.journal.push({ type, cout, statut }); },
    insertUserAsset: async (_e, _u, projet, genre, _chemin, _x, meta) => { j.assets.push({ projet, genre, meta }); },
    r2PathFromPublicUrl: (_e, u) => u,
  };
  const w = charger(['handleGenerateImage', '_prixImageSelonPas', '_prixImageComplet'], dbl);
  const env = { MODAL_TPOSE_URL: tposeUrl, MODAL_TEXT2IMAGE_URL: t2iUrl };
  const appeler = (corps) => w.handleGenerateImage(new Request('https://x.example/api/generate-image', { method: 'POST', body: JSON.stringify(corps) }), env);
  return { j, appeler };
}
const BASE = { prompt: 'An orc warrior, holding a club', userPrompt: 'An orc warrior, holding a club', asset_type: 'character', asset_style: 'realistic', steps: 30 };

test('route T-pose : le champ est nettoye et transmis a Modal dans `negativeExtra`', async () => {
  const { j, appeler } = monter();
  const r = await appeler({ ...BASE, numImages: 2, tpose: true, negativeExtra: ['helmet', '(nude:0)', 'Clothes', 'Beard'] });
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal(j.tposeAppels.length, 2);
  for (const a of j.tposeAppels) assert.deepEqual(a.negativeExtra, ['helmet', 'beard']);
  assert.equal(j.t2iAppels.length, 0);
});

test('route text2image : le champ est nettoye et transmis a Modal dans `negative_extra` (le client a jour envoie un texte SANS la locution)', async () => {
  const { j, appeler } = monter();
  const r = await appeler({ ...BASE, userPrompt: 'An orc warrior, holding a club', numImages: 3, negativeExtra: ['helmet', 'a, b', 'Beard'] });
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal(j.t2iAppels.length, 3);
  for (const a of j.t2iAppels) {
    assert.deepEqual(a.negative_extra, ['helmet', 'beard']);
    assert.equal(a.prompt, 'An orc warrior, holding a club', 'le texte brut part tel quel');
  }
  assert.equal(j.tposeAppels.length, 0);
});

test('sans champ : la cle `negative_extra` n\'est pas envoyee (requete identique a celle d\'avant) ; route T-pose : tableau vide', async () => {
  const a = monter();
  await a.appeler({ ...BASE, numImages: 1 });
  assert.equal('negative_extra' in a.j.t2iAppels[0], false);
  const b = monter();
  await b.appeler({ ...BASE, numImages: 1, tpose: true });
  assert.deepEqual(b.j.tposeAppels[0].negativeExtra, []);
  const c = monter();
  await c.appeler({ ...BASE, numImages: 1, negativeExtra: [] });
  assert.equal('negative_extra' in c.j.t2iAppels[0], false);
});

test('repli Replicate (pas de route text2image Modal) : `negative_extra` n\'est JAMAIS envoye, la requete reste celle d\'avant', async () => {
  const { j, appeler } = monter({ t2iUrl: '' });
  const r = await appeler({ ...BASE, numImages: 2, negativeExtra: ['helmet', 'beard'] });
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal(j.t2iAppels.length, 2);
  for (const a of j.t2iAppels) assert.equal('negative_extra' in a, false, 'Cog ne connait pas ce champ');
  // la route Modal, elle, le recoit (temoin : le test ci-dessus ne passe pas par hasard)
  const m = monter();
  await m.appeler({ ...BASE, numImages: 1, negativeExtra: ['helmet', 'beard'] });
  assert.deepEqual(m.j.t2iAppels[0].negative_extra, ['helmet', 'beard']);
});

test('un champ inattendu n\'est JAMAIS une erreur : ecarte, la generation part, rien d\'autre ne change', async () => {
  const inattendus = ['helmet', 5, { a: 1 }, null, true, [[]], [null, 3, {}], ['(nude:0)', 'clothes'], 'x'.repeat(100_000), Array(500).fill('(x)')];
  for (const champ of inattendus) {
    for (const route of [{}, { tpose: true }]) {
      const { j, appeler } = monter();
      const r = await appeler({ ...BASE, numImages: 1, ...route, negativeExtra: champ });
      assert.equal(r.status, 200, JSON.stringify(champ).slice(0, 60) + ' ' + (await r.clone().text()));
      const envoye = route.tpose ? j.tposeAppels[0].negativeExtra : (j.t2iAppels[0].negative_extra || []);
      assert.deepEqual(envoye, [], JSON.stringify(champ).slice(0, 60));
    }
  }
});

test('une inondation de termes valides est bornee a 8 par le worker', async () => {
  const { j, appeler } = monter();
  const cent = Array.from({ length: 100 }, (_, i) => 'terme' + String.fromCharCode(97 + (i % 26)).repeat(1 + Math.floor(i / 26)));
  await appeler({ ...BASE, numImages: 1, negativeExtra: cent });
  assert.equal(j.t2iAppels[0].negative_extra.length, 8);
});

test('le prix, le debit, le remboursement et le journal ne changent pas avec les negations', async () => {
  for (const route of [{}, { tpose: true }]) {
    const sans = monter();
    await sans.appeler({ ...BASE, numImages: 2, ...route });
    const avec = monter();
    await avec.appeler({ ...BASE, numImages: 2, ...route, negativeExtra: ['helmet', 'beard'] });
    assert.deepEqual(avec.j.depenses, sans.j.depenses);
    assert.deepEqual(avec.j.journal, sans.j.journal);
    const e1 = monter({ echec: true });
    await e1.appeler({ ...BASE, numImages: 2, ...route });
    const e2 = monter({ echec: true });
    await e2.appeler({ ...BASE, numImages: 2, ...route, negativeExtra: ['helmet'] });
    assert.deepEqual(e2.j.remboursements, e1.j.remboursements);
    assert.deepEqual(e2.j.remboursements, e2.j.depenses, 'un echec rend EXACTEMENT ce qui a ete debite');
  }
});

test('l\'historique du projet garde les termes appliques (meta.negative_extra), et rien quand il n\'y en a pas', async () => {
  const a = monter();
  await a.appeler({ ...BASE, numImages: 1, projectName: 'p1', negativeExtra: ['helmet', '(x)'] });
  assert.deepEqual(a.j.assets[0].meta.negative_extra, ['helmet']);
  const b = monter();
  await b.appeler({ ...BASE, numImages: 1, projectName: 'p1' });
  assert.equal(b.j.assets[0].meta.negative_extra, undefined);
});

/* ═══════════════ 2 bis. La moderation ne se relache pas ═══════════════ */
test('_texteDeModerationNegations : sans negation le texte lui-meme, sinon « no X, without X » pour chaque terme', () => {
  const w = charger([]);
  assert.ok(existe('_texteDeModerationNegations'), '_texteDeModerationNegations est absente de worker.ts');
  assert.equal(w._texteDeModerationNegations('An orc', []), 'An orc');
  assert.equal(w._texteDeModerationNegations('An orc', ['helmet', 'golden crown']), 'An orc, no helmet, without helmet, no golden crown, without golden crown');
});

test('le filtre examine le texte ET les negations rendues, pour `userPrompt` comme pour `prompt` (route T-pose)', async () => {
  const { j, appeler } = monter();
  const r = await appeler({ ...BASE, prompt: 'An orc, enriched', userPrompt: 'An orc', numImages: 1, tpose: true, negativeExtra: ['helmet'] });
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual(j.moderation, ['An orc, no helmet, without helmet', 'An orc, enriched, no helmet, without helmet']);
  // sans negation : exactement les textes d'avant
  const b = monter();
  await b.appeler({ ...BASE, prompt: 'An orc, enriched', userPrompt: 'An orc', numImages: 1 });
  assert.deepEqual(b.j.moderation, ['An orc', 'An orc, enriched']);
});

test('moderation : « a child » + le terme « weapon » est BLOQUE comme « a child, no weapon » l\'etait, avant tout debit et tout appel GPU', async () => {
  assert.equal(checkPromptSafety('a child, no weapon', false).safe, false, 'temoin : le filtre bloque la phrase ecrite par l\'utilisateur');
  for (const route of [{}, { tpose: true }]) {
    const { j, appeler } = monter({ filtreReel: true });
    const r = await appeler({ prompt: 'a child', userPrompt: 'a child', asset_type: 'character', numImages: 1, ...route, negativeExtra: ['weapon'] });
    assert.equal(r.status, 400, JSON.stringify(route));
    assert.deepEqual(j.depenses, [], 'rien n\'est debite');
    assert.equal(j.t2iAppels.length + j.tposeAppels.length, 0, 'aucun calcul GPU');
  }
  // l'ancien client (texte brut avec la locution) : meme verdict, inchange
  const ancien = monter({ filtreReel: true });
  const r = await ancien.appeler({ prompt: 'a child, no weapon', userPrompt: 'a child, no weapon', asset_type: 'character', numImages: 1 });
  assert.equal(r.status, 400);
});

test('moderation : le verdict du filtre est le MEME avant (texte avec la locution) et apres (texte sans la locution + terme)', async () => {
  const paires = [['An orc warrior, no helmet', 'An orc warrior', ['helmet']], ['a child hero with a sword, no cape', 'a child hero with a sword', ['cape']],
    ['a boy, no shoes', 'a boy', ['shoes']], ['a child, no weapon', 'a child', ['weapon']], ['a kid, without a knife', 'a kid', ['knife']],
    ['a knight, no beard, no helmet', 'a knight', ['beard', 'helmet']]];
  for (const [avant, sans, termes] of paires) {
    const ancien = monter({ filtreReel: true });
    const ra = await ancien.appeler({ prompt: avant, userPrompt: avant, asset_type: 'character', numImages: 1 });
    const neuf = monter({ filtreReel: true });
    const rn = await neuf.appeler({ prompt: sans, userPrompt: sans, asset_type: 'character', numImages: 1, negativeExtra: termes });
    assert.equal(rn.status, ra.status, `${avant} -> ${ra.status} ; ${sans} + ${termes} -> ${rn.status}`);
  }
});

test('moderation : un terme de garde-robe envoye par un client n\'est PAS transporte (il resterait invisible au filtre) et ne change pas le verdict du texte', async () => {
  const { j, appeler } = monter({ filtreReel: true });
  const r = await appeler({ ...BASE, userPrompt: 'a knight', prompt: 'a knight', numImages: 1, negativeExtra: ['clothes', 'shirt', 'helmet'] });
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual(j.t2iAppels[0].negative_extra, ['helmet']);
  assert.deepEqual(j.moderation, ['a knight, no helmet, without helmet']);
});

/* ═══════════════ 3. Les corps envoyes a Modal ═══════════════ */
function png(taille = 60_000) {
  const b = new Uint8Array(taille);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  new DataView(b.buffer).setUint32(16, 1024, false);
  return b.buffer;
}
const PLACEHOLDER = () => png(1_000);      // petit PNG : « image de remplacement du filtre de contenu » pour _assertImageBytes

function monterModal(reponses) {
  const appels = [];
  const file = [...reponses];
  const faux = async (url, init) => {
    appels.push({ url, corps: JSON.parse(init.body) });
    const prochain = file.shift();
    if (prochain === undefined) throw new Error('plus de reponse prevue');
    return prochain === 524 ? new Response('timeout', { status: 524 }) : new Response(prochain, { status: 200 });
  };
  const doublures = {
    fetch: faux, RAPPELS_524: [1, 1], _incrementAtomique: async () => 0, todayUTC: () => '2026-10-03',
    _writeLastWarmMs: async () => {}, signedR2Url: async (_e, cle) => 'https://signe.example/' + cle,
  };
  const w = charger(['callModalText2Image', 'callModalTpose', '_assertImageBytes', 'COUT_REPRISE_IMAGE_USD'], doublures);
  const env = { MODAL_TEXT2IMAGE_URL: 'https://t2i.example/text2image', MODAL_TPOSE_URL: 'https://tpose.example/tpose', MODAL_SHARED_SECRET: 's',
    MESHES: { put: async () => {} }, R2_PUBLIC_URL: 'https://r2.example' };
  return { w, env, appels };
}
const T2I = { task: 'text2image', prompt: 'An orc', asset_type: 'character', asset_style: 'realistic', seed: 5, steps: 30 };

test('Modal text2image : le corps porte `negative_extra` nettoye', async () => {
  const { w, env, appels } = monterModal([png()]);
  await w.callModalText2Image(env, 'u1', { ...T2I, negative_extra: ['helmet', '(nude:0)', 'Clothes', 'Beard'] }, 'front');
  assert.deepEqual(appels[0].corps.negative_extra, ['helmet', 'beard']);
});

test('Modal text2image : un corps sans negation est celui d\'avant (memes cles)', async () => {
  const { w, env, appels } = monterModal([png(), png()]);
  await w.callModalText2Image(env, 'u1', T2I, 'front');
  await w.callModalText2Image(env, 'u1', { ...T2I, negative_extra: ['(nude:0)', 'clothes'] }, 'front');
  for (const a of appels) {
    assert.deepEqual(Object.keys(a.corps), ['_auth', '_cle_rejeu', 'prompt', 'asset_type', 'asset_style', 'seed', 'steps', 'unrestricted', 'turbo', 'pose_libre']);
  }
});

test('Modal text2image : la reprise apres un 524 renvoie les MEMES negations, la meme case T-pose et la meme cle de rejeu', async () => {
  const { w, env, appels } = monterModal([524, png()]);
  await w.callModalText2Image(env, 'u1', { ...T2I, pose_libre: true, negative_extra: ['helmet'] }, 'front');
  assert.equal(appels.length, 2);
  assert.deepEqual(appels[1].corps.negative_extra, ['helmet']);
  assert.equal(appels[1].corps.pose_libre, true);
  assert.equal(appels[1].corps._cle_rejeu, appels[0].corps._cle_rejeu);
});

test('Modal text2image : la reprise du filtre de contenu (image de remplacement) garde les negations ET la case T-pose', async () => {
  const { w, env, appels } = monterModal([PLACEHOLDER(), png()]);
  await w.callModalText2Image(env, 'u1', { ...T2I, pose_libre: true, negative_extra: ['helmet', 'beard'] }, 'front');
  assert.equal(appels.length, 2, 'un essai, une reprise');
  assert.notEqual(appels[1].corps.seed, appels[0].corps.seed, 'la reprise change de graine');
  assert.deepEqual(appels[1].corps.negative_extra, ['helmet', 'beard']);
  assert.equal(appels[1].corps.pose_libre, true);
});

test('Modal T-pose : le corps porte `negative_extra` nettoye, et rien sans negation', async () => {
  const a = monterModal([png()]);
  await a.w.callModalTpose(a.env, 'u1', { prompt: 'An orc', seed: 1, steps: 30, negativeExtra: ['helmet', '[x]', 'Clothes', 'Beard'] }, 'front');
  assert.deepEqual(a.appels[0].corps.negative_extra, ['helmet', 'beard']);
  const b = monterModal([png(), png()]);
  await b.w.callModalTpose(b.env, 'u1', { prompt: 'An orc', seed: 1, steps: 30 }, 'front');
  await b.w.callModalTpose(b.env, 'u1', { prompt: 'An orc', seed: 1, steps: 30, negativeExtra: ['[x]'] }, 'front');
  for (const x of b.appels) assert.deepEqual(Object.keys(x.corps), ['_auth', '_cle_rejeu', 'prompt', 'ref_image_url', 'seed', 'steps']);
});

test('Modal T-pose : la reprise apres un 524 garde les negations', async () => {
  const { w, env, appels } = monterModal([524, png()]);
  await w.callModalTpose(env, 'u1', { prompt: 'An orc', seed: 1, negativeExtra: ['helmet'] }, 'front');
  assert.equal(appels.length, 2);
  assert.deepEqual(appels[1].corps.negative_extra, ['helmet']);
});
