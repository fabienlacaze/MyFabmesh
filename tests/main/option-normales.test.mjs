// Option « relief pour moteur de jeu » (case « Game-engine relief (normal map) », 2026-10-15) — PROCESSUS PRINCIPAL du bureau.
//
// Decision du proprietaire (15/10) : la carte de normales (plafonnee a 2048 px) devient une OPTION PAR GENERATION, desactivee par defaut,
// gratuite. Le bureau la porte de deux facons :
//   - mode Cloud : drapeau `normal_map` du formulaire /api/generate (main.js -> cloud_fallback.generateMesh -> worker -> Modal) ;
//   - mode Local : variable d'environnement FABMESH_NORMAL_MAP_OPTION ('1' / '0') posee a CHAQUE generation pour le pipeline TRELLIS.2
//     (src/main/option_normales.js -> scripts/normal_bake.py::option_carte_normales -> scripts/trellis2_native_full_pipeline.py).
// Ce fichier prouve, sans Electron ni GPU ni reseau :
//   - option_normales.js : booleen STRICT (seule la valeur true compte), variable toujours posee, meme nom que le noyau Python ;
//   - main.js (analyse syntaxique) : le gestionnaire « image-to-3d » lit trellis2NormalMap et le transmet aux DEUX chemins ;
//   - cloud_fallback.generateMesh (execute pour de vrai, fetch simule) : flags.normal_map devient « true » / « false » dans le formulaire ;
//   - preload.js : la page appelle bien le gestionnaire sans filtrer le champ.
// Lancer : node --test tests/main/option-normales.test.mjs
// Preuve d'echec sur l'ANCIEN code (les memes tests doivent alors ECHOUER) :
//   MAIN_JS=<ancien main.js> OPTION_NORMALES_JS=<absent> CLOUD_FALLBACK_JS=<ancien cloud_fallback.js> node --test tests/main/option-normales.test.mjs
// (cloud_fallback.js n'a pas change : il sert de temoin de la serialisation « true » / « false » du drapeau.)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const acorn = require('acorn');
const ici = path.dirname(fileURLToPath(import.meta.url));
const racine = path.resolve(ici, '..', '..');
const OPTION_JS = process.env.OPTION_NORMALES_JS || path.join(racine, 'src', 'main', 'option_normales.js');
const MAIN_JS = process.env.MAIN_JS || path.join(racine, 'src', 'main', 'main.js');
const CLOUD_JS = process.env.CLOUD_FALLBACK_JS || path.join(racine, 'src', 'main', 'cloud_fallback.js');
const PRELOAD_JS = process.env.PRELOAD_JS || path.join(racine, 'src', 'main', 'preload.js');
const NOYAU_PY = process.env.NOYAU_NORMAL_BAKE || path.join(racine, 'scripts', 'normal_bake.py');
const PIPELINE_PY = process.env.PIPELINE_BUREAU || path.join(racine, 'scripts', 'trellis2_native_full_pipeline.py');
const lire = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

/* ═══════════════ 1. le petit module de regle ═══════════════ */

test('option_normales : seule la valeur booleenne true active l option (jamais une chaine, un entier, un objet)', () => {
  const O = require(OPTION_JS);
  assert.equal(O.optionActive(true), true);
  for (const faux of [false, undefined, null, 0, 1, -1, NaN, '', 'true', 'True', '1', 'false', 'yes', 'on', {}, [], [true], { valueOf: () => true }, () => true, Symbol('x')]) {
    assert.equal(O.optionActive(faux), false, 'valeur ambigue acceptee : ' + String(typeof faux === 'symbol' ? 'symbol' : JSON.stringify(faux)));
  }
});

test('option_normales : la variable du pipeline est TOUJOURS posee (le choix de la page l emporte sur l environnement herite)', () => {
  const O = require(OPTION_JS);
  assert.deepEqual(O.variablesEnv(true), { FABMESH_NORMAL_MAP_OPTION: '1' });
  for (const non of [false, undefined, null, 0, 1, 'true', '1', {}]) assert.deepEqual(O.variablesEnv(non), { FABMESH_NORMAL_MAP_OPTION: '0' }, JSON.stringify(non));
  // fusionnee APRES process.env (comme main.js), la variable herite d'un '1' exterieur n'est jamais conservee
  const env = { ...{ FABMESH_NORMAL_MAP_OPTION: '1', PATH: 'x' }, ...O.variablesEnv(false) };
  assert.equal(env.FABMESH_NORMAL_MAP_OPTION, '0');
});

test('parite avec le noyau Python : meme nom de variable (OPTION_ENV) et meme valeur « 1 » pour oui', () => {
  const O = require(OPTION_JS);
  const py = lire(NOYAU_PY);
  const m = py.match(/^OPTION_ENV = "([A-Z0-9_]+)"/m);
  assert.ok(m, 'OPTION_ENV introuvable dans normal_bake.py');
  assert.equal(O.VARIABLE, m[1]);
  assert.match(py, /return str\(env\.get\(OPTION_ENV, ""\)\)\.strip\(\) == "1"/, 'la valeur « oui » du noyau doit rester la chaine "1"');
  // le pipeline appelle la VRAIE regle du noyau, pas une copie
  assert.match(lire(PIPELINE_PY), /if carte_normales_voulue\(option_carte_normales\(\)\):/);
});

/* ═══════════════ 2. main.js : analyse syntaxique du gestionnaire « image-to-3d » ═══════════════ */

function parcourir(noeud, visiteur) {
  if (!noeud || typeof noeud.type !== 'string') return;
  visiteur(noeud);
  for (const k of Object.keys(noeud)) {
    const v = noeud[k];
    if (Array.isArray(v)) v.forEach((x) => parcourir(x, visiteur));
    else if (v && typeof v.type === 'string') parcourir(v, visiteur);
  }
}
const texteDe = (src, n) => src.slice(n.start, n.end);

function gestionnaireImageTo3D() {
  const src = lire(MAIN_JS);
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true, allowHashBang: true });
  let trouve = null;
  parcourir(ast, (n) => {
    if (trouve || n.type !== 'CallExpression') return;
    const c = n.callee;
    if (c.type === 'MemberExpression' && c.object.name === 'ipcMain' && c.property.name === 'handle'
        && n.arguments[0] && n.arguments[0].value === 'image-to-3d') trouve = n;
  });
  assert.ok(trouve, 'ipcMain.handle(\'image-to-3d\') introuvable');
  return { src, noeud: trouve.arguments[1] };
}

test('main.js : image-to-3d recoit trellis2NormalMap de la page', () => {
  const { noeud } = gestionnaireImageTo3D();
  const motif = noeud.params[1];
  assert.equal(motif.type, 'ObjectPattern');
  const noms = motif.properties.map((p) => p.key && p.key.name);
  assert.ok(noms.includes('trellis2NormalMap'), 'le gestionnaire ignore le champ de la page : ' + noms.join(','));
});

test('main.js : mode Cloud, le drapeau normal_map du formulaire vient de optionActive(trellis2NormalMap)', () => {
  const { src, noeud } = gestionnaireImageTo3D();
  let flags = null;
  parcourir(noeud, (n) => {
    if (n.type === 'Property' && n.key.name === 'flags' && n.value.type === 'ObjectExpression') flags = n.value;
  });
  assert.ok(flags, 'objet flags de cloudFallback.generateMesh introuvable');
  const p = flags.properties.find((x) => x.key && x.key.name === 'normal_map');
  assert.ok(p, 'flags.normal_map absent : l option ne partirait jamais vers le worker');
  assert.equal(texteDe(src, p.value), 'OptionNormales.optionActive(trellis2NormalMap)');
  // les drapeaux voisins gardent leur forme (aucun effet de bord sur les autres options)
  assert.ok(flags.properties.some((x) => x.key && x.key.name === 'face_fix'));
});

test('main.js : mode Local, la variable du pipeline vient de variablesEnv(trellis2NormalMap), fusionnee APRES process.env, moteur natif seulement', () => {
  const { src, noeud } = gestionnaireImageTo3D();
  let env = null;
  parcourir(noeud, (n) => {
    if (n.type === 'VariableDeclarator' && n.id.name === 'env' && n.init && n.init.type === 'ObjectExpression') env = n.init;
  });
  assert.ok(env, 'objet env du processus Python introuvable');
  const premier = env.properties[0];
  assert.equal(premier.type, 'SpreadElement');
  assert.equal(texteDe(src, premier.argument), 'process.env', 'process.env doit etre le PREMIER ensemble : les variables suivantes l emportent');
  const idx = env.properties.findIndex((x) => x.type === 'SpreadElement' && /OptionNormales\.variablesEnv\(trellis2NormalMap\)/.test(texteDe(src, x)));
  assert.ok(idx > 0, 'variablesEnv(trellis2NormalMap) absent de l environnement du pipeline : la case serait sans effet en mode Local');
  const cond = env.properties[idx].argument;
  assert.equal(cond.type, 'ConditionalExpression');
  assert.equal(texteDe(src, cond.test), "engine === 'trellis2_native'");
  assert.equal(texteDe(src, cond.alternate), '{}');
});

test('main.js : l option est enregistree dans les meta du maillage (historique des generations), en Cloud comme en Local', () => {
  const { src, noeud } = gestionnaireImageTo3D();
  const metas = [];
  parcourir(noeud, (n) => {
    if (n.type === 'Property' && n.key.name === 'normal_map' && n.value.type === 'CallExpression') metas.push(texteDe(src, n.value));
  });
  assert.ok(metas.length >= 3, 'flags + meta Cloud + meta Local attendus, trouves : ' + metas.length);
  assert.ok(metas.every((m) => m === 'OptionNormales.optionActive(trellis2NormalMap)'), metas.join(' | '));
});

test('main.js : le module de regle est charge, et il est embarque (src/**/* est la liste de fichiers du paquet)', () => {
  assert.match(lire(MAIN_JS), /const OptionNormales = require\('\.\/option_normales'\);/);
  const pkg = JSON.parse(fs.readFileSync(path.join(racine, 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('src/**/*'));
});

test('preload.js : la page appelle image-to-3d avec ses options telles quelles (aucun filtre de champ)', () => {
  assert.match(lire(PRELOAD_JS), /imageTo3D: \(opts\) => ipcRenderer\.invoke\('image-to-3d', opts\),/);
});

/* ═══════════════ 3. cloud_fallback.generateMesh pour de vrai : flags -> formulaire /api/generate ═══════════════ */

async function genererAvecFlags(flags) {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-normales-'));
  try {
    const image = path.join(dossier, 'src.png');
    fs.writeFileSync(image, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    delete require.cache[require.resolve(CLOUD_JS)];
    const M = require(CLOUD_JS);
    // les dependances injectees par main.js : la session est ecrite dans CE dossier temporaire (jamais dans les donnees de l'utilisateur)
    M.register({ ipcMain: { handle() {} }, MESHES_DIR: dossier, IMAGES_DIR: dossier, isCloudMode: () => true, app: { getPath: () => dossier } });
    const envois = [];
    const avantFetch = globalThis.fetch;
    const avantTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (f) => avantTimeout(f, 0);          // le sondage attend 4 s avant la premiere lecture : inutile ici
    globalThis.fetch = async (url, init = {}) => {
      const u = String(url);
      if (u.includes('/auth/v1/token')) return new Response(JSON.stringify({ access_token: 'jeton-de-test', refresh_token: 'r', expires_in: 3600, user: { email: 'a@b.c' } }), { status: 200 });
      if (u.endsWith('/api/generate') && init.method === 'POST') { envois.push(init.body); return new Response(JSON.stringify({ jobId: 'job1' }), { status: 200 }); }
      if (u.includes('/api/jobs/job1')) return new Response(JSON.stringify({ status: 'succeeded', url: '/r2/mesh/job1.glb?exp=1&sig=x' }), { status: 200 });
      if (u.includes('/r2/mesh/job1.glb')) return new Response(Buffer.alloc(3000, 7), { status: 200 });
      return new Response('{}', { status: 404 });
    };
    try {
      await M.login('a@b.c', 'mot-de-passe-de-test');
      const r = await M.generateMesh({ imagePath: image, assetType: 'character', preset: 'fast', flags, outPath: path.join(dossier, 'sortie', 'm.glb') });
      assert.equal(r.success, true, JSON.stringify(r));
    } finally { globalThis.fetch = avantFetch; globalThis.setTimeout = avantTimeout; try { M.logout(); } catch (_) {} }
    assert.equal(envois.length, 1);
    return envois[0];
  } finally { fs.rmSync(dossier, { recursive: true, force: true }); }
}

test('cloud_fallback.generateMesh : flags.normal_map true / false devient « true » / « false » dans le formulaire /api/generate', async () => {
  const oui = await genererAvecFlags({ normal_map: true, face_fix: false, ultra_q: true });
  assert.equal(oui.get('normal_map'), 'true');
  assert.equal(oui.get('face_fix'), 'false');
  assert.equal(oui.get('ultra_q'), 'true');
  const non = await genererAvecFlags({ normal_map: false, ultra_q: true });
  assert.equal(non.get('normal_map'), 'false');
});

test('cloud_fallback.generateMesh : sans le drapeau, aucun champ normal_map (le worker lit alors faux)', async () => {
  const fd = await genererAvecFlags({ ultra_q: true });
  assert.equal(fd.get('normal_map'), null);
});
