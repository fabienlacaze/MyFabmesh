// Ingestion, BUREAU en mode Cloud (24/10, M9) : la case « T-pose » decochee, le style et les negations partent au serveur.
//   node --test tests/main/ingestion_bureau.test.mjs
// Contre l'ANCIEN code (les tests doivent echouer) :
//   MAIN_JS=<ancien main.js> CLOUD_FALLBACK_JS=<ancien cloud_fallback.js> node --test tests/main/ingestion_bureau.test.mjs
// Aucun reseau, aucun Electron : fetch est une doublure.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ici = path.dirname(fileURLToPath(import.meta.url));
const racine = path.resolve(ici, '..', '..');
const MAIN_JS = process.env.MAIN_JS || path.join(racine, 'src', 'main', 'main.js');
const CLOUD_JS = process.env.CLOUD_FALLBACK_JS || path.join(racine, 'src', 'main', 'cloud_fallback.js');
const texteMain = fs.readFileSync(MAIN_JS, 'utf-8').replace(/\r\n/g, '\n');

function reponseJson(objet, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => objet };
}

async function genererAvecFetchFactice(args) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fm-ing-')));
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
    const r = await M.generateImages({ prompt: 'An orc, holding a club', numImages: 1, imagesDir: path.join(base, 'images', 'p'), assetType: 'character', steps: 30,
      turbo: false, projectName: 'p', ...args });
    return { r, corps };
  } finally { globalThis.fetch = avant; M.logout(); }
}

test('cloud_fallback : case T-pose decochee -> tpose:false et poseLibre:true dans le corps, avec le style et les negations', async () => {
  const { r, corps } = await genererAvecFetchFactice({ poseLibre: true, assetStyle: 'anime', negativeExtra: ['helmet'] });
  assert.equal(r.success, true, JSON.stringify(r));
  assert.equal(corps[0].tpose, false);
  assert.equal(corps[0].poseLibre, true);
  assert.equal(corps[0].asset_style, 'anime');
  assert.deepEqual(corps[0].negativeExtra, ['helmet']);
});

test('cloud_fallback : case cochee -> aucun champ tpose / poseLibre (pas de route T-pose ni de supplement pour le bureau)', async () => {
  for (const poseLibre of [undefined, false, null]) {
    const { corps } = await genererAvecFetchFactice({ poseLibre });
    assert.equal('tpose' in corps[0], false);
    assert.equal('poseLibre' in corps[0], false);
  }
});

test('generate-images : poseLibre est lu par le handler et transmis a argsCloud', () => {
  const i = texteMain.indexOf("ipcMain.handle('generate-images', async (event, {");
  assert.ok(i > 0);
  const corps = texteMain.slice(i, texteMain.indexOf('\n});\n', i));
  assert.ok(/\bposeLibre, negativeExtra(, tposeDemandee)? \}\) => \{/.test(corps), 'poseLibre n\'est pas dans les parametres du handler');
  assert.ok(/poseLibre: poseLibre === true \|\| undefined,/.test(corps), 'argsCloud ne transmet pas poseLibre');
});

test('renderer : la case T-pose decochee ajoute poseLibre:true aux arguments de generateImages', () => {
  const src = fs.readFileSync(path.join(racine, 'src', 'renderer', 'index2.js'), 'utf-8');
  assert.ok(/_optionsPose\(assetType\)\.tpose === false \? \{ poseLibre: true \} : \{\}/.test(src));
});
