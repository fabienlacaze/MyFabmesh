// Test de /api/proxy-image (constat CLOUD-02 de l'analyse du 03/10/2026) : charge la VRAIE fonction depuis src/worker.ts (transpilee) et rejoue les cas d'attaque
// avec un fetch simule. Lancer : cd cloud && node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');

const src = readFileSync(new URL('../src/worker.ts', import.meta.url), 'utf8');
const a = src.indexOf('function _typeImageParOctets');
const b = src.indexOf('/** AI upscale endpoint');
assert.ok(a > 0 && b > a, 'ancres introuvables dans worker.ts');
const js = ts.transpileModule(src.slice(a, b), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const err = (status, message) => new Response(JSON.stringify({ error: message }), { status, headers: { 'content-type': 'application/json' } });
const fabrique = new Function('err', 'siteUrl', 'handleSignedR2', js + '; return { handleProxyImage, _typeImageParOctets };');
const { handleProxyImage, _typeImageParOctets } = fabrique(err, () => 'https://site.example', async () => new Response('signe', { status: 200 }));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const HTML = new TextEncoder().encode('<html><script>alert(document.domain)</script></html>');
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
const appel = (url, env = {}) => handleProxyImage(new Request('https://site.example/api/proxy-image?url=' + encodeURIComponent(url)), env);
function simuler(reponses) { const vus = []; globalThis.fetch = async (u) => { vus.push(String(u)); const r = reponses.shift(); return r instanceof Function ? r() : r; }; return vus; }

test('types reconnus par les octets, pas par un en-tete', () => {
  assert.equal(_typeImageParOctets(PNG), 'image/png');
  assert.equal(_typeImageParOctets(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(_typeImageParOctets(new TextEncoder().encode('GIF89a....')), 'image/gif');
  assert.equal(_typeImageParOctets(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])), 'image/webp');
  assert.equal(_typeImageParOctets(HTML), null, 'HTML refuse');
  assert.equal(_typeImageParOctets(SVG), null, 'SVG refuse (peut porter du script)');
  assert.equal(_typeImageParOctets(new Uint8Array([])), null);
});

test('un sous-domaine r2.dev quelconque est REFUSE sans aucun appel reseau', async () => {
  const vus = simuler([]);
  const r = await appel('https://attaquant.r2.dev/x.html');
  assert.equal(r.status, 403); assert.equal(vus.length, 0);
});

test('hote exact autorise mais contenu HTML : refuse (415)', async () => {
  simuler([new Response(HTML, { status: 200, headers: { 'content-type': 'text/html' } })]);
  const r = await appel('https://replicate.delivery/a.png');
  assert.equal(r.status, 415);
});

test('PNG servi avec un faux Content-Type text/html : renvoye en image/png, nosniff, sandbox', async () => {
  simuler([new Response(PNG, { status: 200, headers: { 'content-type': 'text/html' } })]);
  const r = await appel('https://replicate.delivery/a.png');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/png');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.headers.get('content-security-policy') || '', /sandbox/);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
});

test('redirection d un hote autorise vers un hote NON autorise : refusee', async () => {
  const vus = simuler([new Response(null, { status: 302, headers: { location: 'https://evil.example/p.png' } })]);
  const r = await appel('https://replicate.delivery/a.png');
  assert.equal(r.status, 502); assert.equal(vus.length, 1, 'le second hote n est jamais contacte');
});

test('redirection vers un autre hote AUTORISE : suivie', async () => {
  const vus = simuler([new Response(null, { status: 301, headers: { location: 'https://pbxt.replicate.delivery/b.png' } }), new Response(PNG, { status: 200 })]);
  const r = await appel('https://replicate.delivery/a.png');
  assert.equal(r.status, 200); assert.equal(vus.length, 2);
});

test('fichier annonce trop gros : 413 sans lire le corps', async () => {
  simuler([new Response(PNG, { status: 200, headers: { 'content-length': String(40 * 1024 * 1024) } })]);
  const r = await appel('https://replicate.delivery/a.png');
  assert.equal(r.status, 413);
});

test('http non securise et url absente', async () => {
  assert.equal((await appel('http://replicate.delivery/a.png')).status, 400);
  assert.equal((await handleProxyImage(new Request('https://site.example/api/proxy-image'), {})).status, 400);
});

test('R2_PUBLIC_URL de l environnement reste autorise (un seul hote exact)', async () => {
  simuler([new Response(PNG, { status: 200 })]);
  const r = await appel('https://pub-1234.r2.dev/a.png', { R2_PUBLIC_URL: 'https://pub-1234.r2.dev' });
  assert.equal(r.status, 200);
  const vus = simuler([]);
  assert.equal((await appel('https://pub-9999.r2.dev/a.png', { R2_PUBLIC_URL: 'https://pub-1234.r2.dev' })).status, 403); assert.equal(vus.length, 0);
});
