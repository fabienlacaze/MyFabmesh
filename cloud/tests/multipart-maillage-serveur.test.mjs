// 27/10 : cote SERVEUR de l'envoi par morceaux d'un maillage edite (kind=mesh) : cle rangee comme /api/upload-mesh, validee pour part / complete / abort,
// 1 credit manual_tool a l'assemblage, refus d'une cle d'un autre compte et d'un fichier qui n'est pas un GLB.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chargerFonctions } from './_charge-worker.mjs';

function monde() {
  const depenses = [], journal = [], obj = new Map(), mp = new Map();
  const MESHES = {
    async createMultipartUpload(key) { const id = 'U' + (mp.size + 1); mp.set(id, { key, parts: [] }); return { uploadId: id }; },
    resumeMultipartUpload(key, id) {
      const u = mp.get(id);
      return {
        async uploadPart(n, corps) { u.parts.push(n); return { partNumber: n, etag: 'e' + n }; },
        async complete() { obj.set(key, new Uint8Array([0x67, 0x6C, 0x54, 0x46, 2, 0, 0, 0, 0, 0, 0, 0])); },
        async abort() { mp.delete(id); },
      };
    },
    async get(key, opts) { const o = obj.get(key); return o ? { arrayBuffer: async () => o.slice(opts?.range?.offset || 0, (opts?.range?.offset || 0) + (opts?.range?.length || o.length)).buffer } : null; },
    async delete(key) { obj.delete(key); },
  };
  const env = { MESHES, R2_PUBLIC_URL: 'https://r2.test' };
  const F = chargerFonctions(['handleMeshOpClientMulti', 'MULTI_PART_OCTETS', 'err', 'json', 'SECURITY_HEADERS'], {
    getSessionUser: async () => ({ id: 'U-A' }),
    checkAndIncrementUserCalls: async () => 5,
    getPrice: async () => 1,
    spendCredits: async (e, u, p) => { depenses.push([u, p]); return 10; },
    addCredits: async () => {},
    logOperation: async (...a) => { journal.push(a); },
    signedR2Url: async (e, k) => 'https://signed.test/' + k,
  });
  const appel = (qs, corps, methode = 'POST') => F.handleMeshOpClientMulti(new Request('https://x.test/api/mesh-op/client-multi?' + new URLSearchParams(qs), {
    method: methode, headers: { 'content-type': typeof corps === 'object' && !(corps instanceof Uint8Array) ? 'application/json' : 'application/octet-stream' },
    body: corps && typeof corps === 'object' && !(corps instanceof Uint8Array) ? JSON.stringify(corps) : corps }), env);
  return { appel, depenses, journal, obj };
}
const lire = async (r) => ({ s: r.status, d: await r.json() });

test('init kind=mesh : cle sous mesh-op/<projet>/ ; sans projet sous edited/', async () => {
  const w = monde();
  const a = await lire(await w.appel({ action: 'init', kind: 'mesh', project: 'mois sonneuse', source: 'cmb.glb' }));
  assert.equal(a.s, 200);
  assert.match(a.d.key, /^U-A\/mesh-op\/mois_sonneuse\/cmb_\d+\.glb$/);
  const b = await lire(await w.appel({ action: 'init', kind: 'mesh', source: 'cmb' }));
  assert.match(b.d.key, /^U-A\/edited\/cmb_\d+\.glb$/);
});
test('envoi complet : parts, assemblage, 1 credit manual_tool, URL signee', async () => {
  const w = monde();
  const i = (await lire(await w.appel({ action: 'init', kind: 'mesh', project: 'p', source: 'a' }))).d;
  const p1 = await lire(await w.appel({ action: 'part', key: i.key, uploadId: i.uploadId, n: '1' }, new Uint8Array(10)));
  assert.equal(p1.s, 200);
  const c = await lire(await w.appel({ action: 'complete' }, { key: i.key, uploadId: i.uploadId, project: 'p', parts: [{ partNumber: 1, etag: p1.d.etag }] }));
  assert.equal(c.s, 200); assert.ok(c.d.success);
  assert.deepEqual(w.depenses, [['U-A', 1]]);
  assert.equal(w.journal.length, 1); assert.equal(w.journal[0][8]?.op_type ?? w.journal[0].at(-1)?.op_type, 'manual_mesh');
});
test('cle d\'un autre compte ou hors mesh-op / edited : refusee', async () => {
  const w = monde();
  for (const key of ['U-B/mesh-op/p/a_1.glb', 'U-A/mesh-op/../x/a.glb', 'U-A/autre/a_1.glb', 'U-A/mesh-op/p/a_1.txt']) {
    const r = await lire(await w.appel({ action: 'part', key, uploadId: 'U1', n: '1' }, new Uint8Array(4)));
    assert.equal(r.s, 400, key);
  }
});
test('abandon : abort accepte pour une cle de maillage', async () => {
  const w = monde();
  const i = (await lire(await w.appel({ action: 'init', kind: 'mesh', project: 'p', source: 'a' }))).d;
  const r = await lire(await w.appel({ action: 'abort' }, { key: i.key, uploadId: i.uploadId }));
  assert.equal(r.s, 200);
});
