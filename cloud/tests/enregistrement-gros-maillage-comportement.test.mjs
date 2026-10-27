// 27/10 : COMPORTEMENT reel de saveBuffer (meshyAPI-cloud.js dans un contexte simule) : petit -> /api/upload-mesh, moyen -> flux brut (kind=mesh), > 90 Mo -> morceaux de 32 Mio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const src = readFileSync(new URL('../public/app/meshyAPI-cloud.js', import.meta.url), 'utf8');
function monde() {
  const appels = [];
  const reponse = (obj, ok = true, status = 200) => ({ ok, status, json: async () => obj });
  const fetch = async (url, init = {}) => {
    const corps = init.body;
    appels.push({ url: String(url), taille: typeof corps === 'string' ? corps.length : (corps ? corps.byteLength : 0), json: init.headers && /json/.test(init.headers['content-type'] || init.headers['Content-Type'] || '') && typeof corps === 'string' ? JSON.parse(corps) : null });
    const u = new URL(String(url), 'https://x.test');
    if (u.pathname === '/api/upload-mesh') return reponse({ success: true, path: 'u/mesh-op/p/a_1.glb', url: 'https://x.test/r2/a' });
    if (u.pathname === '/api/upload-rig') return reponse({ success: true, path: 'u/mesh-op/p/a_2.glb', url: 'https://x.test/r2/b' });
    if (u.pathname === '/api/mesh-op/client-multi') {
      const a = u.searchParams.get('action');
      if (a === 'init') return reponse({ success: true, key: 'u/mesh-op/p/a_3.glb', uploadId: 'U1', partSize: 32 * 1024 * 1024 });
      if (a === 'part') return reponse({ success: true, partNumber: Number(u.searchParams.get('n')), etag: 'e' + u.searchParams.get('n') });
      if (a === 'complete') return reponse({ success: true, path: 'https://x.test/r2/c', mesh_url: 'https://x.test/r2/c' });
      return reponse({ success: true });
    }
    return reponse({}, false, 404);
  };
  const el = () => new Proxy(function () {}, { get: (t, p) => (p === Symbol.toPrimitive ? () => '' : el()), apply: () => el(), set: () => true });
  const window = { addEventListener() {}, location: { href: 'https://x.test/app/', origin: 'https://x.test', search: '' }, __cloudCreditsRefresh() {}, localStorage: { getItem: () => null, setItem() {} } };
  const ctx = vm.createContext({ window, document: { querySelector: () => null, getElementById: () => null, addEventListener() {}, createElement: el, body: el(), documentElement: el() }, fetch, console: { log() {}, warn() {}, error() {} }, navigator: { userAgent: 'x' }, location: window.location,
    localStorage: window.localStorage, sessionStorage: window.localStorage, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, atob: (s) => Buffer.from(s, 'base64').toString('binary'), btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    URL, URLSearchParams, Blob, Uint8Array, Promise, Date, JSON, Math, TextEncoder, TextDecoder, AbortController, EventTarget, Event, CustomEvent, ArrayBuffer, Map, Set, WeakMap, Symbol, Array, Object, String, Number, Boolean, RegExp, Error, parseInt, parseFloat, isNaN, structuredClone, queueMicrotask, FormData: class {}, Image: class {}, requestAnimationFrame: () => 0, matchMedia: () => ({ matches: false, addEventListener() {} }) });
  ctx.self = ctx.globalThis = ctx;
  vm.runInContext(src, ctx);
  const utiles = { filter: null };
  return { api: window.meshyAPI, get appels() { return appels.filter((a) => /upload-mesh|upload-rig|client-multi/.test(a.url)); } };
}
const glb = (octets) => { const b = Buffer.alloc(octets, 0x41); b.write('glTF', 0, 'latin1'); return b.toString('base64'); };
test('petit maillage : /api/upload-mesh en JSON', async () => {
  const m = monde(); const api = m.api;
  const r = await api.saveBuffer({ path: 'x/a.glb', base64: glb(1e6), projectName: 'p', tool: 'select_faces' });
  assert.equal(r.success, true); assert.equal(m.appels[0].url, '/api/upload-mesh');
});
test('maillage moyen (30 Mo) : flux brut par /api/upload-rig?kind=mesh', async () => {
  const m = monde(); const api = m.api;
  const r = await api.saveBuffer({ path: 'x/a.glb', base64: glb(30e6), projectName: 'p', tool: 'select_faces' });
  assert.equal(r.success, true);
  assert.match(m.appels[0].url, /^\/api\/upload-rig\?/); assert.match(m.appels[0].url, /kind=mesh/);
});
test('gros maillage (95 Mo) : morceaux de 32 Mio (init, 3 parts, complete), aucun corps > 100 Mo', async () => {
  const m = monde(); const api = m.api;
  const r = await api.saveBuffer({ path: 'x/a.glb', base64: glb(95e6), projectName: 'p', tool: 'select_faces' });
  assert.equal(r.success, true, JSON.stringify(r));
  const q = m.appels.map((a) => new URL(a.url, 'https://x.test').searchParams.get('action'));
  assert.deepEqual(q, ['init', 'part', 'part', 'part', 'complete']);
  assert.ok(m.appels.every((a) => a.taille <= 33 * 1024 * 1024), 'chaque requete reste sous 33 Mio');
  const complet = m.appels[m.appels.length - 1].json;
  assert.equal(complet.parts.length, 3); assert.equal(complet.key, 'u/mesh-op/p/a_3.glb');
});
