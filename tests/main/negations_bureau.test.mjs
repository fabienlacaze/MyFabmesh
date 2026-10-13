// Negations de l'utilisateur dans le BUREAU (2026-10-03) : src/main/main.js (handler generate-images) et src/main/cloud_fallback.js (generateImages).
//   « an orc, no helmet » : le renderer sort la locution du prompt et envoie le terme (« helmet ») dans `negativeExtra`. Le main process :
//     - re-verifie les termes (8 au plus, 40 caracteres, lettres / espaces / tirets) ;
//     - rend la locution au FILTRE DE MODERATION (« a child, without clothes » ne doit pas devenir « a child ») ;
//     - les transmet au pont local (FABMESH_NEGATIVE_EXTRA) et au serveur (champ `negativeExtra` du corps de /api/generate-image).
//   node --test tests/main/negations_bureau.test.mjs
// Contre l'ANCIEN code (les tests doivent echouer) :
//   MAIN_JS=<ancien main.js> CLOUD_FALLBACK_JS=<ancien cloud_fallback.js> node --test tests/main/negations_bureau.test.mjs
// Aucun reseau, aucun Electron : fetch est une doublure.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';

const require = createRequire(import.meta.url);
const ici = path.dirname(fileURLToPath(import.meta.url));
const racine = path.resolve(ici, '..', '..');
const MAIN_JS = process.env.MAIN_JS || path.join(racine, 'src', 'main', 'main.js');
const CLOUD_JS = process.env.CLOUD_FALLBACK_JS || path.join(racine, 'src', 'main', 'cloud_fallback.js');
const texteMain = fs.readFileSync(MAIN_JS, 'utf-8').replace(/\r\n/g, '\n');
const astMain = acorn.parse(texteMain, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true });

/** Une fonction de premier niveau de main.js, evaluee seule. */
function fonction(nom) {
  const n = astMain.body.find((x) => x.type === 'FunctionDeclaration' && x.id.name === nom);
  assert.ok(n, 'fonction introuvable dans main.js : ' + nom);
  return new Function(texteMain.slice(n.start, n.end) + '\nreturn ' + nom + ';')();
}
const grave = JSON.parse(fs.readFileSync(path.join(racine, 'build', 'intention_attendus.json'), 'utf-8'));

// ============================================================ _assainirNegativeExtra ====
test('_assainirNegativeExtra : memes sorties que assainir_negatifs de Python sur toutes les entrees gravees', () => {
  const f = fonction('_assainirNegativeExtra');
  assert.ok(grave.assainir.length >= 20);
  for (const { entree, sortie } of grave.assainir) {
    assert.deepEqual(f(entree), sortie, JSON.stringify(entree).slice(0, 100));
  }
});

test('_assainirNegativeExtra : plafonds et entrees hostiles', () => {
  const f = fonction('_assainirNegativeExtra');
  assert.deepEqual(f(['helmet', 'Helmet', ' beard ']), ['helmet', 'beard']);
  assert.equal(f(Array.from({ length: 30 }, (_, i) => 'terme' + 'abcdefghijklmnopqrstuvwxyz'[i % 26])).length <= 8, true, '8 termes au plus');
  assert.deepEqual(f(['x'.repeat(41)]), []);
  assert.deepEqual(f(['x'.repeat(40)]), ['x'.repeat(40)]);
  assert.deepEqual(f(['<script>', 'rm -rf /', 'a;b', 'a,b', '1 2', "o'neil", 'café']), [], 'le moindre caractere hors lettres / espaces / tirets : ecarte');
  assert.deepEqual(f('helmet'), []);
  assert.deepEqual(f(null), []);
  assert.deepEqual(f({ length: 1, 0: 'helmet' }), [], 'pas un tableau');
  assert.deepEqual(f([{ toString: () => 'helmet' }, 12, null, undefined, ['x']]), [], 'que des chaines');
  const t0 = performance.now();
  f(['x '.repeat(500000)]);                  // un element de un million de caracteres : ecarte sans le parcourir
  f(Array.from({ length: 100000 }, () => 'a'));
  assert.ok(performance.now() - t0 < 1000, 'lent');
});

// ============================================================ _texteDeModeration ====
test('_texteDeModeration : sans terme le prompt est inchange ; avec termes la locution revient sous deux formes', () => {
  const f = fonction('_texteDeModeration');
  assert.equal(f('An orc', []), 'An orc');
  assert.equal(f('An orc', undefined), 'An orc');
  assert.equal(f('An orc', ['helmet', 'white beard']), 'An orc, no helmet, without helmet, no white beard, without white beard');
});

test('moderation : « a child, without clothes » ne passe PAS au filtre une fois la locution sortie du prompt (le filtre doit voir les negations)', () => {
  const ts = require('../../cloud/node_modules/typescript');
  const js = ts.transpileModule(fs.readFileSync(path.join(racine, 'cloud', 'src', 'nsfw_filter.ts'), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const filtre = {};
  new Function('exports', 'require', js)(filtre, require);
  const f = fonction('_texteDeModeration');
  // le prompt ENVOYE n'a plus la locution : « a child » seul passe...
  assert.equal(filtre.checkPromptSafety('a child', false).safe, true, 'temoin : « a child » seul est accepte');
  // ... mais la locution d'origine (« without clothes ») est un cas que le filtre refuse : on la lui rend
  assert.equal(filtre.checkPromptSafety('a child, without clothes', false).safe, false, 'temoin : la locution d\'origine etait refusee');
  const vu = f('a child', ['clothes']);
  assert.equal(filtre.checkPromptSafety(vu, false).safe, false, 'le texte controle doit etre refuse : ' + vu);
  // un prompt sans rapport reste accepte
  assert.equal(filtre.checkPromptSafety(f('An orc warrior holding a club', ['helmet', 'beard']), false).safe, true);
});

// ============================================================ le handler generate-images ====
test('generate-images : le terme passe au filtre, au pont local (FABMESH_NEGATIVE_EXTRA) et au serveur (argsCloud)', () => {
  const i = texteMain.indexOf("ipcMain.handle('generate-images', async (event, {");
  assert.ok(i > 0);
  const corps = texteMain.slice(i, texteMain.indexOf('\n});\n', i));
  assert.ok(/computeMode, negativeExtra \}\) => \{/.test(corps), 'negativeExtra n\'est pas dans les parametres du handler');
  assert.ok(corps.includes('const _negatifs = _assainirNegativeExtra(negativeExtra);'), 'termes non re-verifies');
  assert.ok(corps.includes('const _texteModere = _texteDeModeration(prompt, _negatifs);'));
  assert.ok(corps.includes('checkPromptSafety(_texteModere)') && corps.includes('checkPromptSafetyAI(_texteModere)'), 'le filtre doit lire le texte AVEC les locutions');
  assert.ok(!/checkPromptSafety(?:AI)?\(prompt\)/.test(corps), 'un controle lit encore le prompt SANS les locutions');
  assert.ok(corps.includes('FABMESH_NEGATIVE_EXTRA: JSON.stringify(_negatifs)'), 'pont local');
  assert.ok(/negativeExtra: _negatifs,/.test(corps), 'serveur : argsCloud');
  // les deux appels de cloudFallback.generateImages passent par argsCloud
  const appels = [...corps.matchAll(/cloudFallback\.generateImages\(\{\s*\.\.\.argsCloud,/g)];
  assert.equal(appels.length, 2, 'etapes de construction ET generation normale');
});

// ============================================================ cloud_fallback.generateImages ====
function reponseJson(objet, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => objet };
}

async function genererAvecFetchFactice(options) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fm-neg-')));
  delete require.cache[require.resolve(CLOUD_JS)];
  const M = require(CLOUD_JS);
  M.register({ ipcMain: { handle() {} }, app: { getPath: () => base }, MESHES_DIR: path.join(base, 'meshes'), IMAGES_DIR: path.join(base, 'images'), isCloudMode: () => false });
  const avant = globalThis.fetch;
  const corps = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('/auth/v1/token')) return reponseJson({ access_token: 'jeton-factice', refresh_token: 'r', expires_in: 3600, user: { email: 'test@example.invalid' } });
    if (u.endsWith('/api/generate-image')) {
      corps.push(JSON.parse(init.body));
      return reponseJson({ ok: true, success: true, paths: ['https://images.example.invalid/a.png'], creditsRemaining: 5 });
    }
    if (u.startsWith('https://images.example.invalid/')) return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array(2000).buffer };
    throw new Error('url inattendue : ' + u);
  };
  try {
    await M.login('test@example.invalid', 'x');
    const r = await M.generateImages({ prompt: 'An orc, holding a club', numImages: options.numImages || 1, imagesDir: path.join(base, 'images', 'p'), assetType: 'character', steps: 30,
      turbo: false, projectName: 'p', ...options.args });
    return { r, corps };
  } finally { globalThis.fetch = avant; M.logout(); }
}

test('cloud_fallback.generateImages : negativeExtra part dans le corps de /api/generate-image, re-verifie', async () => {
  const { r, corps } = await genererAvecFetchFactice({ args: { negativeExtra: ['helmet', 'white curly beard', 'Bad!', 12, 'x'.repeat(41), "o'neil"] } });
  assert.equal(r.success, true, JSON.stringify(r));
  assert.equal(corps.length, 1);
  assert.deepEqual(corps[0].negativeExtra, ['helmet', 'white curly beard']);
  assert.equal(corps[0].prompt, 'An orc, holding a club');
});

test('cloud_fallback.generateImages : sans terme, le corps est celui d\'avant (aucun champ negativeExtra)', async () => {
  for (const negativeExtra of [undefined, [], ['Bad!'], 'helmet', null]) {
    const { r, corps } = await genererAvecFetchFactice({ args: { negativeExtra } });
    assert.equal(r.success, true);
    assert.equal('negativeExtra' in corps[0], false, JSON.stringify(negativeExtra));
  }
});

test('cloud_fallback.generateImages : plus de 8 termes : 8 au plus, a chaque lot de 4 images', async () => {
  const termes = Array.from({ length: 12 }, (_, i) => 'terme' + 'abcdefghijkl'[i]);
  const { corps } = await genererAvecFetchFactice({ numImages: 6, args: { negativeExtra: termes } });
  assert.equal(corps.length, 2, 'six images = deux appels de 4 au plus');
  for (const c of corps) assert.deepEqual(c.negativeExtra, termes.slice(0, 8));
});
