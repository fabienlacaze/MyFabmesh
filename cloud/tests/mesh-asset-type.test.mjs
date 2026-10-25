// 25/10 : le type d'actif part vers Modal avec la generation 3D (il decide le retrait de la dalle de sol : personnage / creature / animal).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const chemin = process.env.WORKER_SRC || new URL('../src/worker.ts', import.meta.url);
const SRC = readFileSync(chemin, 'utf8').replace(/\r\n/g, '\n');
const a = SRC.indexOf('async function callModalMeshStart(');
const b = SRC.indexOf('\n}\n', a) + 3;
const js = ts.transpileModule(SRC.slice(a, b), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
async function appeler(assetType) {
  let corps = null;
  const fetch = async (_u, o) => { corps = JSON.parse(o.body); return { ok: true, status: 200, json: async () => ({ job_id: 'x' }), text: async () => '' }; };
  const f = new Function('fetch', '_urlPutR2Signee', js + '; return callModalMeshStart;')(fetch, async () => null);
  await f({ MODAL_MESH_START_URL: 'https://m.test/start', MODAL_SHARED_SECRET: 's' }, { jobId: 'j', frontImageUrl: 'https://i.test/a.png', asset_type: assetType });
  return corps;
}
test('le type d actif est transmis a Modal', async () => {
  assert.equal((await appeler('creature')).asset_type, 'creature');
});
test('un type absent donne une chaine vide et un type piege est nettoye', async () => {
  assert.equal((await appeler(undefined)).asset_type, '');
  assert.equal((await appeler('char<script>1')).asset_type, 'charscript');
});
