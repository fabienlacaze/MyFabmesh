// Pages statiques (constats CLOUD-04, ADM-04, SM-07, ADM-05, DEP-03, du 2026-10-03) : en-tetes Cloudflare Assets
// (public/_headers) et integrite des scripts tiers. Aucun reseau. Lancer : cd cloud && node --test tests/web-statique.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
const lire = (p) => readFileSync(new URL('../public/' + p, import.meta.url), 'utf8');

function regles(texte) {
  const out = {}; let cur = null;
  for (const l of texte.split(/\r?\n/)) {
    if (!l.trim() || l.trim().startsWith('#')) continue;
    if (!/^\s/.test(l)) { cur = l.trim(); out[cur] = out[cur] || {}; continue; }
    const i = l.indexOf(':'); out[cur][l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim();
  }
  return out;
}

test('_headers : en-tetes de securite pour toutes les pages', () => {
  assert.ok(existsSync(new URL('../public/_headers', import.meta.url)), '_headers absent');
  const r = regles(lire('_headers'))['/*'];
  assert.equal(r['x-content-type-options'], 'nosniff');
  assert.equal(r['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.equal(r['strict-transport-security'], 'max-age=31536000');
  assert.equal(r['permissions-policy'], 'camera=(), microphone=(), geolocation=()');
  assert.equal(r['content-security-policy'], "frame-ancestors 'self'", 'SEULEMENT frame-ancestors : une CSP complete casserait les scripts en ligne');
});

test('_headers : /admin2* jamais dans un cadre ni en cache', () => {
  const r = regles(lire('_headers'))['/admin2*'];
  assert.equal(r['x-frame-options'], 'DENY');
  assert.equal(r['content-security-policy'], "frame-ancestors 'none'");
  assert.equal(r['cache-control'], 'no-store');
});

test('scripts unpkg : integrity sha384 + crossorigin partout (hors importmap)', () => {
  for (const f of ['app/index.html', 'admin2.html', 'admin.html']) {
    const t = lire(f);
    for (const m of t.matchAll(/<script\b[^>]*src="https:\/\/unpkg\.com\/[^"]+"[^>]*>/g)) {
      assert.match(m[0], /integrity="sha384-[A-Za-z0-9+/]{64}"/, f + ' : ' + m[0]);
      assert.match(m[0], /crossorigin="anonymous"/, f);
    }
  }
  // Script cree dynamiquement dans admin2 (apercu 3D)
  assert.match(lire('admin2.html'), /sc\.integrity = 'sha384-/);
  assert.match(lire('admin2.html'), /sc\.crossOrigin = 'anonymous'/);
});

test('le libelle Fast de la GENERATION annonce 24 pas (comme le serveur) ; celui de Re-texture annonce les 12 pas que son preset applique', () => {
  assert.match(lire('app/index.html'), /Fast \(24 steps · 2048px\)/);                      // menu de generation (table PALIERS du worker : fast = 24 pas)
  assert.ok(!/Fast \(12 steps/.test(lire('app/index.html') + lire('app/lang/_additions.js')));
  // outil Re-texture : modal_app/_retexture.py PRESETS fast = 12 pas (relecture independante du 2026-10-03 : le libelle doit rester fidele au preset)
  assert.match(lire('app/index2.js'), /\['fast','Fast \(12 steps · 2048px\)'\]/);
  assert.ok(!/\['fast','Fast \(24 steps/.test(lire('app/index2.js')));
});

test('security.txt', () => {
  const t = lire('.well-known/security.txt');
  assert.match(t, /^Contact: mailto:myfabmesh\.contact@gmail\.com$/m);
  assert.match(t, /^Expires: 20\d\d-/m);
  assert.match(t, /^Preferred-Languages: fr, en$/m);
});

test('_headers : /_next/static/* en cache immutable, et RIEN pour /app/* (pas d\'empreinte dans leur nom)', () => {
  const r = regles(lire('_headers'));
  assert.equal(r['/_next/static/*']['cache-control'], 'public, max-age=31536000, immutable');
  assert.deepEqual(Object.keys(r).filter((k) => k.startsWith('/app')), [], 'aucune regle de cache long pour /app/*');
});

test('ADM-10 : /admin redirige toujours vers /admin2 (plus de ?ancienne=1) et le pied de /admin2 ne renvoie plus vers l\'ancienne page', () => {
  const w = readFileSync(new URL('../src/worker.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(!w.includes("searchParams.get('ancienne')"), 'plus de condition ancienne dans le routeur');
  const i = w.indexOf('/^\\/admin\\/?$/.test(pathname)) {');
  assert.ok(i > 0, 'redirection de /admin introuvable');
  assert.ok(w.slice(i, i + 200).includes("status: 302, headers: { location: '/admin2'"), 'la redirection mene a /admin2');
  assert.ok(!lire('admin2.html').includes('ancienne=1'));
});
