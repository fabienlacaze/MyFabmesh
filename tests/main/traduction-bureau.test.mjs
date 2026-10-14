// TRADUCTION DU PROMPT COTE BUREAU (2026-10-13, lot 2 de l'audit de la langue : TRADUCTION-02/10/11, CHAMPS-01/11, SERVEUR-02) — le VRAI
// gestionnaire IPC 'translate-prompt' de src/main/main.js (extrait avec acorn), doublures seulement : aucun Python, aucun reseau.
//   - sans moteur IA local (mode Cloud) : traduction par le SITE avec la session MyFabmesh (avant : texte rendu tel quel, sans un mot) ;
//   - aucune session : echec avec raison (l'interface le dit) ; modele de langue en telechargement : le site prend le relais ;
//   - deux echecs ne coupent plus la traduction pour la session : disjoncteur de 5 minutes, remis a zero par un succes.
// Autour de la generation (CHAMPS-09, MANQUE-SERV-01, TRADUCTION-10) : le composeur du pont local recoit le texte ANGLAIS, le mode Cloud
// envoie le style choisi et « tel quel » (main.js puis cloud_fallback.js), l'aide de langue interroge 'translate-status', l'arabe est pose.
// Lancer : node --test tests/main/traduction-bureau.test.mjs
// Ancien code : MAIN_JS=<copie> CLOUD_FALLBACK_JS=<copie> WIZARD_PY=<copie> node --test tests/main/traduction-bureau.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';

const ici = path.dirname(fileURLToPath(import.meta.url));
const MAIN_JS = process.env.MAIN_JS || path.join(ici, '..', '..', 'src', 'main', 'main.js');
const src = fs.readFileSync(MAIN_JS, 'utf-8');
const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true, allowHashBang: true });

const NOMS = ['_traduireLocal', '_traduireParLeSite', '_traduirePrompt', '_prechaufferTraducteur', '_traducteurLocalCoupe', 'TRADUCTION_COUPURE_MS',
  '_translateFailures', '_translateCoupeJusqua', '_translateBroken', '_translateWorkingPy'];
const morceaux = [];
const vus = new Set();
let gestionnaire = null;
for (const n of ast.body) {
  if (n.type === 'FunctionDeclaration' && NOMS.includes(n.id.name)) { vus.add(n.id.name); morceaux.push(src.slice(n.start, n.end)); }
  else if (n.type === 'VariableDeclaration') {
    for (const d of n.declarations) {
      if (d.id.type === 'Identifier' && NOMS.includes(d.id.name)) {
        vus.add(d.id.name);
        morceaux.push(n.kind + ' ' + src.slice(d.start, d.end) + ';');
      }
    }
  } else if (n.type === 'ExpressionStatement' && n.expression.type === 'CallExpression') {
    const c = n.expression;
    if (c.callee.type === 'MemberExpression' && c.callee.object.name === 'ipcMain' && c.callee.property.name === 'handle'
        && c.arguments[0] && c.arguments[0].value === 'translate-prompt') gestionnaire = src.slice(c.arguments[1].start, c.arguments[1].end);
  }
}
assert.ok(gestionnaire, "gestionnaire 'translate-prompt' introuvable dans main.js");

const EN_ATTENTE = Object.freeze({ pending: true });

function monter({ local = false, serveur = () => null, session = true, site = null, horloge = { t: 1_000_000 } } = {}) {
  const j = { serveur: [], lancements: 0, site: [], prechauffe: 0, journal: [] };
  const cloudFallback = {
    aSession: () => session,
    authedFetch: async (chemin, init) => {
      j.site.push({ chemin, corps: JSON.parse(init.body) });
      const r = site ? site(JSON.parse(init.body)) : { status: 200, json: { text: 'EN:' + JSON.parse(init.body).text, translated: true } };
      if (r.needsCloudLogin) return { needsCloudLogin: true };
      return { resp: { status: r.status || 200, json: async () => r.json } };
    },
  };
  const doublures = {
    ensureTranslateServer: async () => { j.prechauffe++; return local; },
    translateServerCall: async (texte, de) => { j.serveur.push({ texte, de }); return serveur(texte, de); },
    TRADUCTION_EN_ATTENTE: EN_ATTENTE,
    _translateCache: new Map(),
    _localPyLibsUsable: () => local,
    cloudFallback,
    log: { warn: (...a) => j.journal.push(a.join(' ')), info: () => {} },
    path: { join: (...a) => a.join('/') },
    SCRIPTS_DIR: '/scripts',
    _embeddedPython: () => 'python',
    _pythonTraduction: () => 'python',
    execFile: (py, argv, opts, cb) => { j.lancements++; cb(new Error('argos absent'), ''); },
    process: { env: {} },
    Date: { now: () => horloge.t },
  };
  const cles = Object.keys(doublures).filter((k) => !vus.has(k));
  // eslint-disable-next-line no-new-func
  const f = new Function(...cles, morceaux.join('\n') + '\nreturn ' + gestionnaire + ';');
  const h = f(...cles.map((k) => doublures[k]));
  return { appeler: (corps) => h({}, corps), j, horloge };
}

test('mode Cloud (pas de moteur IA local) + session MyFabmesh : traduit par le SITE (avant : texte rendu tel quel)', async () => {
  const { appeler, j } = monter({ local: false, session: true });
  const r = await appeler({ text: 'un dragon rouge avec des ailes', from: 'fr' });
  assert.equal(r.translated, true, JSON.stringify(r));
  assert.equal(r.text, 'EN:un dragon rouge avec des ailes');
  assert.equal(j.site.length, 1);
  assert.equal(j.site[0].chemin, '/api/translate');
  assert.deepEqual(j.site[0].corps, { text: 'un dragon rouge avec des ailes', from: 'fr' });
  assert.equal(j.lancements + j.serveur.length, 0, 'aucun Argos sans moteur IA');
  // cache : le meme texte ne repart pas
  await appeler({ text: 'un dragon rouge avec des ailes', from: 'fr' });
  assert.equal(j.site.length, 1);
});

test('aucun traducteur (pas de moteur local, pas de session) : echec AVEC raison, que l interface affiche', async () => {
  const { appeler, j } = monter({ local: false, session: false });
  const r = await appeler({ text: 'un dragon rouge avec des ailes', from: 'fr' });
  assert.equal(r.translated, false);
  assert.equal(r.raison, 'no-engine');
  assert.equal(r.text, 'un dragon rouge avec des ailes');
  assert.equal(j.site.length, 0);
  const expiree = monter({ local: false, session: true, site: () => ({ needsCloudLogin: true }) });
  assert.equal((await expiree.appeler({ text: 'un dragon rouge', from: 'fr' })).raison, 'signed-out');
  const quota = monter({ local: false, session: true, site: () => ({ status: 200, json: { text: 'x', translated: false, raison: 'rate-limited' } }) });
  assert.equal((await quota.appeler({ text: 'un dragon rouge', from: 'fr' })).raison, 'rate-limited');
});

test('modele de langue en telechargement (premier usage) : le site prend le relais ; sans session, l attente est DITE', async () => {
  const a = monter({ local: true, serveur: () => EN_ATTENTE, session: true });
  const r = await a.appeler({ text: 'تنين أحمر', from: 'ar' });
  assert.equal(r.translated, true, JSON.stringify(r));
  assert.equal(a.j.site.length, 1);
  const b = monter({ local: true, serveur: () => EN_ATTENTE, session: false });
  const r2 = await b.appeler({ text: 'تنين أحمر', from: 'ar' });
  assert.equal(r2.translated, false);
  assert.equal(r2.raison, 'model-downloading');
  assert.equal(r2.pending, true);
});

test('traducteur local qui marche : utilise en premier, sans appel au site', async () => {
  const { appeler, j } = monter({ local: true, serveur: (t) => 'LOCAL:' + t, session: true });
  const r = await appeler({ text: 'un dragon rouge', from: 'fr' });
  assert.equal(r.translated, true);
  assert.equal(r.text, 'LOCAL:un dragon rouge');
  assert.equal(j.site.length, 0);
});

test('deux echecs ne coupent plus la traduction pour TOUTE la session : disjoncteur de 5 min, remis a zero par un succes', async () => {
  let enPanne = true;
  const horloge = { t: 1_000_000 };
  const { appeler, j } = monter({ local: true, serveur: (t) => (enPanne ? null : 'LOCAL:' + t), session: false, horloge });
  await appeler({ text: 'un chat noir', from: 'fr' });
  await appeler({ text: 'un chien noir', from: 'fr' });
  const lancementsApres2 = j.lancements;
  // dans les 5 minutes : le local n'est plus tente (pas de gel de 40 s par generation)
  const r3 = await appeler({ text: 'un cheval noir', from: 'fr' });
  assert.equal(r3.translated, false);
  assert.equal(j.lancements, lancementsApres2, 'disjoncteur ouvert : pas de nouveaux lancements');
  // le service revient et 5 minutes passent : le local est RETENTE (avant : coupe jusqu'au redemarrage de l'appli)
  enPanne = false;
  horloge.t += 5 * 60 * 1000 + 1;
  const r4 = await appeler({ text: 'un loup noir', from: 'fr' });
  assert.equal(r4.translated, true, JSON.stringify(r4));
  assert.equal(r4.text, 'LOCAL:un loup noir');
});

test('deux echecs ISOLES separes par des succes ne declenchent rien (avant : le compteur n etait jamais remis a zero)', async () => {
  let enPanne = false;
  const { appeler } = monter({ local: true, serveur: (t) => (enPanne ? null : 'LOCAL:' + t), session: false });
  const textes = ['un', 'deux', 'trois', 'quatre', 'cinq'].map((m) => 'un chat ' + m);
  enPanne = true; await appeler({ text: textes[0], from: 'fr' });
  enPanne = false; await appeler({ text: textes[1], from: 'fr' });
  enPanne = true; await appeler({ text: textes[2], from: 'fr' });
  enPanne = false;
  const r = await appeler({ text: textes[3], from: 'fr' });
  assert.equal(r.translated, true, 'deux echecs non consecutifs : la traduction continue');
});

test('prechauffage (ouverture d une fenetre d outil) : demarre le traducteur local, ne traduit rien, n appelle pas le site', async () => {
  const { appeler, j } = monter({ local: true, session: true });
  const r = await appeler({ prechauffer: true });
  assert.deepEqual(r, { ok: true });
  assert.equal(j.prechauffe, 1);
  assert.equal(j.serveur.length + j.site.length, 0);
});

// ------------------------------------------------------------------------------------------------- autour de la generation d'images
/** Source du 2e argument de ipcMain.handle(<canal>, ...) (noeud acorn), ou null. */
function noeudGestionnaire(canal) {
  for (const n of ast.body) {
    if (n.type !== 'ExpressionStatement' || n.expression.type !== 'CallExpression') continue;
    const c = n.expression;
    if (c.callee.type === 'MemberExpression' && c.callee.object.name === 'ipcMain' && c.callee.property.name === 'handle'
        && c.arguments[0] && c.arguments[0].value === canal) return c.arguments[1];
  }
  return null;
}
/** Premier noeud du sous-arbre qui satisfait `test` (parcours en profondeur). */
function trouver(racine, test) {
  const pile = [racine];
  while (pile.length) {
    const n = pile.pop();
    if (test(n)) return n;
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v)) { for (let i = v.length - 1; i >= 0; i--) if (v[i] && typeof v[i].type === 'string') pile.push(v[i]); }
      else if (v && typeof v.type === 'string') pile.push(v);
    }
  }
  return null;
}
/** Evalue une EXPRESSION du fichier avec des valeurs pour ses noms libres (les autres valent undefined ; globales du langage reelles). */
function evaluerAvec(code, valeurs) {
  const portee = new Proxy(Object.create(null), {
    has: (_, n) => typeof n === 'string' && n !== '__code' && n !== 'eval' && !(n in globalThis),
    get: (_, n) => (typeof n === 'string' ? valeurs[n] : undefined),
  });
  // eslint-disable-next-line no-new-func
  return new Function('__portee', '__code', 'with (__portee) { return eval(__code); }')(portee, '(' + code + ')');
}

test('generate-images : le composeur du pont local recoit le texte ANGLAIS (CHAMPS-09) ; le mode Cloud envoie le STYLE (MANQUE-SERV-01) et « tel quel »', () => {
  const h = noeudGestionnaire('generate-images');
  assert.ok(h, "gestionnaire 'generate-images' introuvable");
  const recus = h.params[1].properties.map((p) => p.key.name);
  for (const n of ['userPromptAnglais', 'assetStyle', 'langueVerifiee']) assert.ok(recus.includes(n), `generate-images ne lit pas « ${n} » envoye par l interface`);
  // FABMESH_USER_PROMPT : le lexique du composeur d'intention est ANGLAIS ; un orc « qui tient une massue » n'etait pas reconnu
  const prop = trouver(h, (n) => n.type === 'Property' && !n.computed && (n.key.name || n.key.value) === 'FABMESH_USER_PROMPT');
  assert.ok(prop, 'FABMESH_USER_PROMPT introuvable');
  const expr = src.slice(prop.value.start, prop.value.end);
  assert.equal(evaluerAvec(expr, { userPromptAnglais: 'an orc holding a massive club', rawPrompt: 'un orc qui tient une massue' }),
    'an orc holding a massive club', 'le composeur analysait le texte BRUT');
  assert.equal(evaluerAvec(expr, { rawPrompt: 'an orc' }), 'an orc', 'interface plus ancienne (pas de traduction transmise) : texte d origine');
  // arguments du mode Cloud (cloud_fallback.generateImages)
  const decl = trouver(h, (n) => n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.id.name === 'argsCloud');
  assert.ok(decl, 'argsCloud introuvable');
  const objet = src.slice(decl.init.start, decl.init.end);
  const args = evaluerAvec(objet, { imagesDir: '/i', _assetType: 'character', assetStyle: 'cartoon', langueVerifiee: true, steps: 30, engine: 'local-lightning', safeName: 'P' });
  assert.equal(args.assetStyle, 'cartoon', 'sans le style, le serveur prenait « realistic » et ajoutait « photorealistic » derriere un prompt cartoon');
  assert.equal(args.langueVerifiee, true, '« Envoyer tel quel » doit atteindre le filet de langue du serveur');
  const sans = evaluerAvec(objet, { imagesDir: '/i', _assetType: 'character', steps: 30, engine: 'cloud', safeName: 'P' });
  assert.equal(sans.assetStyle, undefined);
  assert.equal(sans.langueVerifiee, undefined);
});

const CLOUD_FALLBACK = process.env.CLOUD_FALLBACK_JS || path.join(ici, '..', '..', 'src', 'main', 'cloud_fallback.js');
test('cloud_fallback.generateImages : le corps envoye au site porte asset_style et langueVerifiee (MANQUE-SERV-01)', async () => {
  const srcCf = fs.readFileSync(CLOUD_FALLBACK, 'utf-8');
  const astCf = acorn.parse(srcCf, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true, allowHashBang: true });
  const fn = astCf.body.find((n) => n.type === 'FunctionDeclaration' && n.id.name === 'generateImages');
  assert.ok(fn, 'generateImages introuvable');
  const corps = [], entetes = [];
  const doublures = {
    getAccessToken: async () => 'jeton', WORKER_URL: 'https://site.example', logout: () => {}, _withColdRetry: (f) => f(),
    fetch: async (_url, init) => { corps.push(JSON.parse(init.body)); entetes.push(init.headers); return { status: 500, ok: false, json: async () => ({ error: 'banc' }) }; },
    _enteteLangue: () => ({ 'X-Fabmesh-Langue': 'fr' }),   // langue de l'interface (troisieme relecture du lot 2, 14/10)
  };
  // eslint-disable-next-line no-new-func
  const generer = new Function(...Object.keys(doublures), srcCf.slice(fn.start, fn.end) + '\nreturn generateImages;')(...Object.values(doublures));
  await generer({ prompt: 'cartoon style, an orc', numImages: 1, imagesDir: '/i', assetType: 'character', assetStyle: 'cartoon', steps: 30,
    turbo: false, projectName: 'P', langueVerifiee: true });
  assert.equal(corps.length, 1);
  assert.equal(corps[0].asset_style, 'cartoon', 'avant : jamais envoye, le serveur prenait « realistic »');
  assert.equal(corps[0].langueVerifiee, true);
  assert.equal(entetes[0]['X-Fabmesh-Langue'], 'fr', 'le refus 422 du filet de langue est redige dans la langue de l interface');
  await generer({ prompt: 'an orc', numImages: 1, imagesDir: '/i', assetType: 'character', steps: 30 });
  assert.ok(!('asset_style' in corps[1]) && !('langueVerifiee' in corps[1]), 'rien d invente quand l interface ne dit rien');
});

test('translate-status : l aide de langue sait si un traducteur est joignable (moteur local, session MyFabmesh) (TRADUCTION-02, CHAMPS-16)', async () => {
  const h = noeudGestionnaire('translate-status');
  assert.ok(h, "gestionnaire 'translate-status' absent : l'aide promettait « traduit auto » sans rien verifier");
  const code = src.slice(h.start, h.end);
  // eslint-disable-next-line no-new-func
  const f = (local, coupe, session) => new Function('_localPyLibsUsable', '_traducteurLocalCoupe', 'cloudFallback', 'return ' + code)(
    () => local, () => coupe, { aSession: () => session });
  assert.deepEqual(await f(false, false, false)(), { local: false, cloud: false });
  assert.deepEqual(await f(false, false, true)(), { local: false, cloud: true });
  assert.deepEqual(await f(true, true, false)(), { local: false, cloud: false }, 'traducteur local mis de cote : indisponible');
  assert.deepEqual(await f(true, false, false)(), { local: true, cloud: false });
});

const WIZARD_PY = process.env.WIZARD_PY || path.join(ici, '..', '..', 'scripts', 'wizard_install_deps.py');
test('arabe : son modele de traduction est pose par l assistant comme les autres langues du selecteur (TRADUCTION-10, CHAMPS-11)', () => {
  const fn = ast.body.find((n) => n.type === 'FunctionDeclaration' && n.id.name === '_languesTraduction');
  assert.ok(fn, '_languesTraduction introuvable');
  // eslint-disable-next-line no-new-func
  const langues = new Function('app', src.slice(fn.start, fn.end) + '\nreturn _languesTraduction;')(
    { getPreferredSystemLanguages: () => ['ar-SA', 'fr-FR', 'en-US'], getLocale: () => 'ar' });
  assert.equal(langues(), 'ar,fr', 'avant : l arabe du systeme etait ignore');
  const py = fs.readFileSync(WIZARD_PY, 'utf-8');
  const m = py.match(/^LANGUES_TRADUCTION\s*=\s*\(([^)]*)\)/m);
  assert.ok(m, 'LANGUES_TRADUCTION introuvable dans wizard_install_deps.py');
  assert.match(m[1], /'ar'/, "l'assistant refusait de poser le modele arabe");
});

test('cloud_fallback : la langue de l interface (config uiLang, fournie par main.js) part en X-Fabmesh-Langue, normalisee ; rien sans fournisseur', () => {
  const srcCf = fs.readFileSync(CLOUD_FALLBACK, 'utf-8');
  const astCf = acorn.parse(srcCf, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true, allowHashBang: true });
  const morceaux = astCf.body.filter((n) => (n.type === 'FunctionDeclaration' && ['definirLangueInterface', '_enteteLangue'].includes(n.id.name))
    || (n.type === 'VariableDeclaration' && n.declarations[0].id.name === '_fournisseurLangue')).map((n) => srcCf.slice(n.start, n.end));
  assert.equal(morceaux.length, 3, 'definirLangueInterface / _enteteLangue / _fournisseurLangue introuvables');
  // eslint-disable-next-line no-new-func
  const m = new Function(morceaux.join('\n') + '\nreturn { definirLangueInterface, _enteteLangue };')();
  assert.deepEqual(m._enteteLangue(), {});
  m.definirLangueInterface(() => 'es-ES');
  assert.deepEqual(m._enteteLangue(), { 'X-Fabmesh-Langue': 'es' });
  m.definirLangueInterface(() => { throw new Error('config illisible'); });
  assert.deepEqual(m._enteteLangue(), {});
  m.definirLangueInterface(() => 'x\r\nInjecte: 1');
  assert.deepEqual(m._enteteLangue(), {}, 'jamais d en-tete arbitraire');
  assert.match(fs.readFileSync(path.join(ici, '..', '..', 'src', 'main', 'main.js'), 'utf-8'), /cloudFallback\.definirLangueInterface\(\(\) => _loadUiLang\(\)\)/, 'main.js branche la langue');
});
