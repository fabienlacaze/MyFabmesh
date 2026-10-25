// Option « relief pour moteur de jeu » (case « Game-engine relief (normal map) », 2026-10-15) — SERVEUR (worker) et SITE.
//
// Decision du proprietaire (15/10, apres l'essai GPU A/B) : la carte de normales n'est plus cuite d'office, c'est une OPTION PAR GENERATION,
// DESACTIVEE par defaut, GRATUITE, plafonnee a 2048 px (cote Modal : build/bancs/noyaux/test_option_normales_serveur.py ; cote bureau :
// tests/main/option-normales.test.mjs). Ce fichier prouve, avec les VRAIES fonctions de cloud/src/worker.ts (transpilees) et les VRAIS
// fichiers du site, que :
//   - handleGenerate lit le champ `normal_map` en booleen STRICT (seule la chaine « true » du formulaire l'active), le range dans les options
//     du travail (historique) et ne transmet a Modal QU'UN BOOLEEN ;
//   - callModalMeshStart refuse de laisser passer toute valeur non booleenne (1, "true", {}...) meme appele par un autre code interne ;
//   - l'option est GRATUITE (creditCost inchange) et n'est pas une option morte (OPTIONS_SANS_EFFET_CLOUD, __optionsMortesCloud) ;
//   - le site porte la case (decochee), la lit en `=== true`, l'envoie a /api/generate (le shim la serialise) et la traduit en 5 langues.
// Lancer : cd cloud && node --test tests/option-normales.test.mjs
// Preuve d'echec sur l'ANCIEN code : git show 3886f61a:cloud/src/worker.ts > <fichier> ; WORKER_SRC=<fichier> node --test tests/option-normales.test.mjs
//   (et SITE_RACINE=<dossier d'une copie de cloud/public/app d'avant> pour les fichiers du site).
// Aucun reseau, aucun GPU, aucun secret.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { chargerFonctions, lireSource, creerR2, creerSupabase, doublesReponses } from './_charge-worker.mjs';

const require = createRequire(import.meta.url);
const acorn = require('acorn');
const ts = require('typescript');

const ID = 'ws-trellis2-normal-map';
const LIBELLE = 'Game-engine relief (normal map)';
const LIBELLE_COURT = 'Game-engine relief';
const SITE = process.env.SITE_RACINE || new URL('../public/app/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const lireSite = (rel) => readFileSync(SITE.replace(/[\\/]+$/, '') + '/' + rel, 'utf8').replace(/\r\n/g, '\n');

/* ═══════════════ 1. handleGenerate de bout en bout : formulaire -> ligne `jobs` -> corps envoye a Modal ═══════════════ */

function monterGeneration() {
  const j = { modal: [], depenses: [], remboursements: [], refundBudget: 0 };
  const sb = creerSupabase({});
  const aucun = (nom) => async () => { throw new Error(nom + ' ne doit pas etre appele dans ce scenario'); };
  const dbl = {
    ...doublesReponses,
    isMock: () => false,
    mock: {},
    getSessionUser: async () => ({ id: 'u1', email: 'a@b.c' }),
    verifyTurnstile: async () => true,
    extractTurnstileToken: () => null,
    isTrustedAssetHost: () => true,
    assetFetch: aucun('assetFetch'),
    checkAndIncrementModalSpend: async () => 100,
    checkAndIncrementDailySpend: async () => 100,
    checkAndIncrementUserCalls: async () => 10,
    refundModalSpend: async () => { j.refundBudget++; },
    refundDailySpend: async () => { j.refundBudget++; },
    _spendRefusalMessage: async () => 'refus',
    spendCredits: async (_e, _u, cout) => { j.depenses.push(cout); return 500 - cout; },
    addCredits: async (_e, _u, cout) => { j.remboursements.push(cout); return 500; },
    supabaseAdmin: () => sb,
    insertUserAsset: async () => {},
    r2PathFromPublicUrl: () => null,
    signedR2Url: async () => 'https://signed.example/source.png',
    _urlPutR2Signee: async () => 'https://put.example/mesh.glb',
    _retirerMetadonneesImage: (octets) => octets,
    preWarmModal: async () => {},
    _journaliserAppelAux: async (_e, _u, _t, f) => f(),
    callModalRectify: aucun('callModalRectify'),
    callModalBackView: aucun('callModalBackView'),
    callModalMVAdapter: aucun('callModalMVAdapter'),
    callModalSheet: aucun('callModalSheet'),
    createReplicatePrediction: aucun('createReplicatePrediction'),
    fetch: async (url, init) => {
      j.modal.push({ url: String(url), corps: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ job_id: 'x' }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  };
  const w = chargerFonctions(['handleGenerate', 'callModalMeshStart', 'creditCost', '_getPricing', '_invalidatePricingCache', 'PRICING_DEFAULTS',
    'PRICING_KEY', 'PRICING_TTL_MS', '_pricingCache', '_supplementTriangles', '_neutraliserOptionsSansEffet', 'OPTIONS_SANS_EFFET_CLOUD',
    'MAX_TRIS_GENERATION', 'PALIERS_GENERATION', 'tailleAtlasGeneration', '_delaiMaxGenerationS', '_meshCostUsd', '_auxGpuCostUsd',
    'MODAL_COST_USD', 'AUTO_BACKVIEW_SKIP', 'HARD_SURFACE_TYPES', 'MVA_TYPES', '_paysRequete', '_provenance'], dbl);
  const env = {
    MODAL_MESH_START_URL: 'https://modal.example/mesh_start', MODAL_MESH_STATUS_URL: 'https://modal.example/mesh_status',
    MODAL_SHARED_SECRET: 'secret-de-test', MESHES: creerR2(), R2_PUBLIC_URL: 'https://r2.example',
  };
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
  /** champs : { nom: valeur | undefined } ; `normal_map` absent du formulaire si la cle n'est pas donnee. */
  const appeler = async (champs = {}) => {
    w._invalidatePricingCache();
    const fd = new FormData();
    fd.append('image', new File([png], 'src.png', { type: 'image/png' }));
    const base = { asset_type: 'prop', preset: 'fast', back_view: 'false', rectify: 'false', project_name: 'essai', ...champs };
    for (const [k, v] of Object.entries(base)) if (v !== undefined) fd.append(k, v);
    const silence = { log: console.log, warn: console.warn, error: console.error };
    console.log = console.warn = console.error = () => {};
    try {
      const rep = await w.handleGenerate(new Request('https://x.example/api/generate', { method: 'POST', body: fd }), env);
      return { rep, texte: await rep.clone().text() };
    } finally { Object.assign(console, silence); }
  };
  return { j, sb, w, appeler };
}

test('handleGenerate : option ABSENTE -> Modal recoit normal_map === false (booleen), la ligne jobs aussi', async () => {
  const { j, sb, appeler } = monterGeneration();
  const { rep, texte } = await appeler();
  assert.equal(rep.status, 200, texte);
  assert.equal(j.modal.length, 1, 'un seul appel a Modal');
  assert.strictEqual(j.modal[0].corps.normal_map, false);
  assert.strictEqual(sb.tables.jobs[0].options.normal_map, false);
});

test('handleGenerate : « true » (la case cochee) -> Modal recoit normal_map === true, la ligne jobs aussi (historique)', async () => {
  const { j, sb, appeler } = monterGeneration();
  const { rep, texte } = await appeler({ normal_map: 'true' });
  assert.equal(rep.status, 200, texte);
  assert.strictEqual(j.modal[0].corps.normal_map, true);
  assert.strictEqual(sb.tables.jobs[0].options.normal_map, true);
  assert.equal(j.modal[0].corps._auth, 'secret-de-test');
});

test('handleGenerate : toute autre valeur que la chaine exacte « true » donne faux, jamais une valeur brute vers Modal', async () => {
  const ambigues = ['false', 'FALSE', 'True', 'TRUE', '1', '0', 'yes', 'on', 'oui', '', ' true', 'true ', 'true,true', 'null', 'undefined', '[true]', '{"a":1}'];
  for (const valeur of ambigues) {
    const { j, sb, appeler } = monterGeneration();
    const { rep, texte } = await appeler({ normal_map: valeur });
    assert.equal(rep.status, 200, valeur + ' : ' + texte);
    assert.strictEqual(j.modal[0].corps.normal_map, false, 'valeur ambigue acceptee : ' + JSON.stringify(valeur));
    assert.strictEqual(sb.tables.jobs[0].options.normal_map, false, valeur);
  }
});

test('handleGenerate : le champ du formulaire a le meme nom que celui du shim du site et du bureau (normal_map)', async () => {
  const { j, appeler } = monterGeneration();
  // les cles voisines (camelCase du renderer, ancien nom) n'activent PAS l'option : un seul nom, lu a un seul endroit
  await appeler({ normalMap: 'true', trellis2NormalMap: 'true', game_engine_relief: 'true' });
  assert.strictEqual(j.modal[0].corps.normal_map, false);
});

test('handleGenerate : l option est GRATUITE (meme debit, meme prix qu a l ancien prix, quelle que soit la valeur)', async () => {
  const sans = monterGeneration();
  const avec = monterGeneration();
  await sans.appeler({ preset: 'quality' });
  await avec.appeler({ preset: 'quality', normal_map: 'true' });
  assert.equal(sans.j.depenses.length, 1);
  assert.deepEqual(avec.j.depenses, sans.j.depenses, 'cocher la case ne change pas le debit');
  assert.equal(avec.sb.tables.jobs[0].credit_cost, sans.sb.tables.jobs[0].credit_cost);
  assert.equal(avec.sb.tables.jobs[0].cost_usd, sans.sb.tables.jobs[0].cost_usd, 'ni le cout GPU estime du budget');
});

test('handleGenerate : l option ne change rien d autre dans le corps envoye a Modal', async () => {
  const sans = monterGeneration();
  const avec = monterGeneration();
  await sans.appeler({ preset: 'quality', ultra_q: 'true' });
  await avec.appeler({ preset: 'quality', ultra_q: 'true', normal_map: 'true' });
  const a = { ...sans.j.modal[0].corps }; const b = { ...avec.j.modal[0].corps };
  delete a.job_id; delete b.job_id;
  assert.notDeepEqual(a, b);
  assert.deepEqual({ ...b, normal_map: false }, a, 'seul le champ normal_map differe');
});

/* ═══════════════ 2. callModalMeshStart : le dernier rempart avant Modal ═══════════════ */

test('callModalMeshStart : normal_map vaut TOUJOURS un booleen dans le corps envoye a Modal', async () => {
  const corps = [];
  const dbl = {
    _urlPutR2Signee: async () => 'https://put.example/x.glb',
    fetch: async (_u, init) => { corps.push(JSON.parse(String(init.body))); return new Response('{"job_id":"j"}', { status: 200 }); },
  };
  const w = chargerFonctions(['callModalMeshStart'], dbl);
  const env = { MODAL_MESH_START_URL: 'https://modal.example/start', MODAL_SHARED_SECRET: 's' };
  const base = { jobId: 'modal_abcdef012345', frontImageUrl: 'https://r2.example/a.png' };
  const attendus = [[true, true], [false, false], [undefined, false], [null, false], ['true', false], ['false', false], [1, false], [0, false],
    [{}, false], [[], false], [[true], false], ['', false], [NaN, false]];
  for (const [entree, attendu] of attendus) {
    await w.callModalMeshStart(env, { ...base, normal_map: entree });
    assert.strictEqual(corps[corps.length - 1].normal_map, attendu, 'entree ' + String(entree));
  }
  await w.callModalMeshStart(env, { ...base });
  assert.strictEqual(corps[corps.length - 1].normal_map, false, 'champ absent');
});

/* ═══════════════ 3. gratuite, pas une option morte ═══════════════ */

test('creditCost : normal_map ne change pas le prix (gratuit), et n est pas dans OPTIONS_SANS_EFFET_CLOUD', async () => {
  const P = chargerFonctions(['PRICING_DEFAULTS', 'PRICING_KEY', 'PRICING_TTL_MS', '_pricingCache', '_getPricing', '_invalidatePricingCache', '_supplementTriangles',
    'creditCost', '_neutraliserOptionsSansEffet', 'OPTIONS_SANS_EFFET_CLOUD']);
  const cout = async (i) => { P._invalidatePricingCache(); return P.creditCost({ MESHES: creerR2() }, { ...i }); };
  for (const preset of ['fast', 'balanced', 'quality', 'ultra_8k']) {
    assert.equal(await cout({ preset, normal_map: true }), await cout({ preset }), preset);
    assert.equal(await cout({ preset, normal_map: true, ultra_q: true, smooth: true }), await cout({ preset, ultra_q: true, smooth: true }), preset);
  }
  assert.ok(!P.OPTIONS_SANS_EFFET_CLOUD.includes('normal_map'), 'l option serait neutralisee par le serveur : option morte');
  assert.ok(!Object.keys(P.PRICING_DEFAULTS).some((k) => /normal/i.test(k)), 'aucune ligne de la grille : gratuit');
});

test('GenerateInput declare le champ, et handleGenerate / callModalMeshStart sont les seuls a le lire', () => {
  const src = lireSource();
  assert.match(src, /interface GenerateInput \{[\s\S]*?normal_map\?: boolean;/);
  // chaque lecture du champ brut du formulaire est la comparaison stricte a la chaine « true »
  const lectures = src.match(/form\.get\('normal_map'\)[^,\n]*/g) || [];
  assert.deepEqual(lectures, ["form.get('normal_map') === 'true'"]);
  // et le worker ne lit nulle part l'ancienne cle camelCase
  assert.ok(!/trellis2NormalMap|normalMap\b/.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));
});

/* ═══════════════ 4. SITE : page, lecture de la case, envoi, traductions ═══════════════ */

/** Source de la fonction fléchée / méthode `imageTo3D` de meshyAPI-cloud.js, extraite par l'analyseur (le shim est une grande fermeture). */
function extraireImageTo3D() {
  const src = lireSite('meshyAPI-cloud.js');
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true });
  let trouve = null;
  const visiter = (n) => {
    if (!n || typeof n !== 'object' || trouve) return;
    if (n.type === 'Property' && n.key && (n.key.name === 'imageTo3D' || n.key.value === 'imageTo3D') && n.value.type === 'ArrowFunctionExpression') { trouve = n.value; return; }
    for (const k of Object.keys(n)) { const v = n[k]; if (Array.isArray(v)) v.forEach(visiter); else if (v && typeof v.type === 'string') visiter(v); }
  };
  visiter(ast);
  assert.ok(trouve, 'imageTo3D introuvable dans meshyAPI-cloud.js');
  return src.slice(trouve.start, trouve.end);
}

test('site : le shim serialise normal_map (true -> « true », false -> « false ») dans le formulaire de /api/generate, tel que le worker le lit', async () => {
  const code = extraireImageTo3D();
  const envois = [];
  const postForm = async (route, fd) => { envois.push({ route, fd }); return { jobId: 'job1' }; };
  const fenetre = { __meshyEmit() {}, fabmeshJobs: {}, __cloudCreditsRefresh() {} };
  const fabrique = new Function('postForm', 'pollPrediction', 'window', '_addPendingJob', '_removePendingJob', '_finDuServeur', 'FormData', 'Blob', 'fetch',
    'return (' + code + ');');
  const imageTo3D = fabrique(postForm, async () => ({ url: 'https://r2/x.glb', duration_s: 1 }), fenetre, () => {}, () => {}, () => true, FormData, Blob, async () => { throw new Error('reseau'); });
  for (const [valeur, attendu] of [[true, 'true'], [false, 'false']]) {
    envois.length = 0;
    const r = await imageTo3D({ imagePath: 'https://r2.example/a.png', outputName: 'p', preset: 'fast', normal_map: valeur });
    assert.equal(r.success, true);
    assert.equal(envois[0].route, '/api/generate');
    assert.equal(envois[0].fd.get('normal_map'), attendu);
  }
  envois.length = 0;
  await imageTo3D({ imagePath: 'https://r2.example/a.png', outputName: 'p', preset: 'fast' });
  assert.equal(envois[0].fd.get('normal_map'), null, 'sans la cle, aucun champ : le worker lit alors faux');
});

test('site : index.html porte la case, DECOCHEE, dans les options avancees de la generation 3D, avec son libelle et son infobulle', () => {
  const h = lireSite('index.html');
  const occurrences = h.match(new RegExp('id="' + ID + '"', 'g')) || [];
  assert.equal(occurrences.length, 1, 'un seul champ ' + ID);
  const debut = h.indexOf('id="' + ID + '"');
  const balise = h.slice(h.lastIndexOf('<input', debut), h.indexOf('>', debut) + 1);
  assert.match(balise, /type="checkbox"/);
  assert.ok(!/\bchecked\b/.test(balise), 'la case doit etre decochee par defaut : ' + balise);
  assert.ok(!/\bdisabled\b/.test(balise));
  const etiquette = h.slice(h.lastIndexOf('<label', debut), h.indexOf('</label>', debut));
  assert.ok(etiquette.includes(LIBELLE), etiquette);
  assert.match(etiquette, /title="[^"]*normal map[^"]*2048px[^"]*Off by default[^"]*"/);
  // dans le bloc des options de la 3D (avant le bouton « Generate 3D »)
  const details = h.lastIndexOf('<details', debut);
  assert.ok(details > 0 && h.slice(details, debut).includes('ws-3d-trellis2-opts'), 'la case doit etre dans <details id="ws-3d-trellis2-opts">');
  assert.ok(h.indexOf('id="ws-generate-mesh"') > debut);
  assert.ok(!/\bhidden\b|display:\s*none/.test(h.slice(h.lastIndexOf('<div', debut), debut)), 'ligne cachee');
});

test('site : index2.js lit la case en booleen STRICT, l envoie sous le nom normal_map et la montre dans les options actives', () => {
  const s = lireSite('index2.js');
  const lectures = s.match(/document\.getElementById\('ws-trellis2-normal-map'\)[^;\n]*/g) || [];
  assert.deepEqual(lectures, ["document.getElementById('ws-trellis2-normal-map')?.checked === true"]);
  assert.match(s, /normal_map:\s+trellis2NormalMap,/);
  assert.match(s, /const _optsActives = [\s\S]*?trellis2NormalMap && 'Game-engine relief'/);
  assert.match(s, /o\.normal_map === true && 'Game-engine relief'/, 'travail repris apres un rechargement : meme libelle');
  assert.match(s, /normal_map: 'Game-engine relief'/, 'fiche des parametres (historique)');
  // execute la lecture avec des cases de toutes sortes
  const lire = (el) => new Function('document', 'return document.getElementById(\'ws-trellis2-normal-map\')?.checked === true;')({ getElementById: () => el });
  assert.equal(lire({ checked: true }), true);
  for (const faux of [{ checked: false }, { checked: 'true' }, { checked: 1 }, { checked: undefined }, null, undefined]) assert.equal(lire(faux), false, JSON.stringify(faux));
});

test('site : la case n est ni cachee ni forcee par le profil d asset, ni declaree morte, ni facturee', () => {
  const s = lireSite('index2.js');
  const debut = s.indexOf('const ASSET_OPTIONS_PROFILE = {');
  const fin = s.indexOf('\n};\n', debut);
  assert.ok(debut > 0 && fin > debut);
  assert.ok(!s.slice(debut, fin).includes(ID), 'ASSET_OPTIONS_PROFILE ne doit pas contenir la case (profil null = masquee et forcee a off)');
  const o = lireSite('cloud-overrides.js');
  const morte = o.match(/window\.__optionsMortesCloud = new Set\(\[([^\]]*)\]\)/);
  assert.ok(morte, '__optionsMortesCloud introuvable');
  assert.ok(!morte[1].includes(ID), 'la case est declaree morte : elle serait masquee et forcee a off');
  assert.ok(!o.includes(ID), 'cloud-overrides.js ne doit ni lister ni facturer la case (option gratuite)');
  // _AUTO3D_OPTIONS (reglages automatiques) : la case est un choix d export, jamais deduit de l image
  const auto = s.match(/var _AUTO3D_OPTIONS = \[([\s\S]*?)\];/);
  assert.ok(auto && !auto[1].includes(ID));
});

test('site : traduite dans les 5 langues (libelle, libelle court, infobulle), sans vide', () => {
  const t = lireSite('lang/_additions6.js');
  const cles = [LIBELLE, LIBELLE_COURT, 'Adds a normal map to the exported model: the fine relief of the detailed shape (skin, muscles, cloth folds) is baked into a texture of at most 2048px that game engines use for lighting. Off by default; adds a few MB to the file. The difference is subtle in a plain viewer.'];
  const ctx = {};
  vm.createContext(ctx);
  // _additions6.js est une IIFE qui remplit des tables ; on retrouve les lignes par leur cle
  for (const cle of cles) {
    const i = t.indexOf('"' + cle + '": [');
    assert.ok(i >= 0, 'cle absente : ' + cle.slice(0, 40));
    const ligne = t.slice(i, t.indexOf('\n', i)).replace(/,\s*$/, '');
    const tableau = vm.runInContext('(' + ligne.slice(ligne.indexOf(': [') + 2) + ')', ctx);
    assert.equal(tableau.length, 5, cle.slice(0, 40));
    tableau.forEach((tr, k) => { if (k === 0 && tr === null) return; assert.ok(typeof tr === 'string' && tr.trim().length > 3, 'traduction vide, langue ' + k + ' : ' + cle.slice(0, 40)); });
    assert.ok(tableau.slice(1).every((tr) => tr !== cle), 'traduction identique a l anglais : ' + cle.slice(0, 40));
  }
});

test('site : aucun nom de moteur dans le libelle visible de l option', () => {
  const h = lireSite('index.html');
  const debut = h.indexOf('id="' + ID + '"');
  const etiquette = h.slice(h.lastIndexOf('<label', debut), h.indexOf('</label>', debut));
  const titre = (etiquette.match(/title="([^"]*)"/) || [])[1] || '';
  const visible = titre + ' ' + etiquette.replace(/<[^>]*>/g, ' ');        // l'identifiant de l'element (ws-trellis2-...) n'est pas visible
  assert.ok(visible.includes(LIBELLE));
  assert.ok(!/unirig|trellis|puppeteer|realvis|clipseg|skintokens|unreal|unity|godot/i.test(visible), visible);
});

test('parser TypeScript : le champ normal_map du formulaire est lu au meme endroit que ses voisins (face_fix, ultra_q)', () => {
  const src = lireSource();
  const sf = ts.createSourceFile('worker.ts', src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const lectures = [];
  const visiter = (n) => {
    if (ts.isPropertyAssignment(n) && n.name.getText(sf) === 'normal_map' && /form\.get/.test(n.initializer.getText(sf))) lectures.push(n.initializer.getText(sf));
    ts.forEachChild(n, visiter);
  };
  visiter(sf);
  assert.deepEqual(lectures, ["form.get('normal_map') === 'true'"]);
});
