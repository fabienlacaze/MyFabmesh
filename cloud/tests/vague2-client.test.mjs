// Vague 2, voie client (PERF-04, 2026-10-03) : les sondages reseau ralentissent x10 quand l'onglet / la fenetre est
// cache(e) (jamais un arret) et reprennent aussitot a visibilitychange. Aucun reseau, minuteries simulees.
// Lancer : cd cloud && node --test tests/vague2-client.test.mjs
// Variables facultatives : WEB_INDEX2, WEB_OVERRIDES, BUREAU_INDEX2 (chemins de copies a verifier).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const chemin = (env, rel) => process.env[env] || new URL(rel, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const FICHIERS = {
  'web index2.js': chemin('WEB_INDEX2', '../public/app/index2.js'),
  'web cloud-overrides.js': chemin('WEB_OVERRIDES', '../public/app/cloud-overrides.js'),
  'bureau index2.js': chemin('BUREAU_INDEX2', '../../src/renderer/index2.js'),
};
const lire = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

function extraireHelper(src) {
  const a = src.indexOf('// --- SONDAGE ADAPTATIF : DEBUT ---');
  const b = src.indexOf('// --- SONDAGE ADAPTATIF : FIN ---');
  assert.ok(a >= 0 && b > a, 'bloc SONDAGE ADAPTATIF absent (sondages encore a plein regime onglet cache)');
  return src.slice(a, b);
}

// Environnement minimal : document.hidden, ecouteurs, horloge simulee.
function monde(helper) {
  const ecouteurs = new Set();
  const doc = {
    hidden: false,
    addEventListener(t, f) { if (t === 'visibilitychange') ecouteurs.add(f); },
    removeEventListener(t, f) { if (t === 'visibilitychange') ecouteurs.delete(f); },
  };
  let maintenant = 0, id = 0;
  const minuteries = new Map();
  const ctx = {
    document: doc,
    setTimeout(f, ms) { const i = ++id; minuteries.set(i, { f, a: maintenant + ms }); return i; },
    clearTimeout(i) { minuteries.delete(i); },
  };
  vm.createContext(ctx);
  vm.runInContext(helper + '\nthis.intervalleSondage = intervalleSondage; this.sondageAdaptatif = sondageAdaptatif;', ctx);
  const avancer = async (ms) => {
    const fin = maintenant + ms;
    for (;;) {
      const prets = [...minuteries.entries()].filter(([, m]) => m.a <= fin).sort((x, y) => x[1].a - y[1].a);
      if (!prets.length) break;
      const [i, m] = prets[0];
      minuteries.delete(i); maintenant = m.a;
      await m.f();
    }
    maintenant = fin;
  };
  const basculer = (cache) => { doc.hidden = cache; for (const f of [...ecouteurs]) f(); };
  return { ctx, doc, avancer, basculer, ecouteurs, minuteries };
}

for (const [nom, p] of Object.entries(FICHIERS)) {
  test(`${nom} : intervalleSondage multiplie par 10 uniquement onglet cache`, () => {
    const w = monde(extraireHelper(lire(p)));
    assert.equal(w.ctx.intervalleSondage(8000), 8000);
    w.doc.hidden = true;
    assert.equal(w.ctx.intervalleSondage(8000), 80000);
  });

  test(`${nom} : sondageAdaptatif ralentit cache, ne s'arrete jamais, reprend tout de suite au retour`, async () => {
    const w = monde(extraireHelper(lire(p)));
    let n = 0;
    const h = w.ctx.sondageAdaptatif(async () => { n++; }, 1000);
    await w.avancer(3000);
    assert.equal(n, 3, 'visible : un passage par seconde');
    w.basculer(true);                       // onglet cache
    n = 0;
    await w.avancer(9000);
    assert.equal(n, 0, 'cache : rien pendant 9 s (intervalle 10 s)');
    await w.avancer(1500);
    assert.equal(n, 1, 'cache : le sondage continue, a 10 s (jamais un arret)');
    await w.avancer(10000);
    assert.equal(n, 2, 'cache : toujours actif');
    w.basculer(false);                      // retour au premier plan
    await new Promise((r) => setImmediate(r));   // laisse finir le passage immediat
    await w.avancer(0);
    assert.equal(n, 3, 'visibilitychange : rafraichissement immediat');
    await w.avancer(1000);
    assert.equal(n, 4, 'intervalle normal retabli');
    h.arreter();
    assert.equal(w.ecouteurs.size, 0, 'ecouteur retire a l arret');
    await w.avancer(5000);
    assert.equal(n, 4, 'arrete');
  });

  test(`${nom} : une tache qui echoue n'arrete pas le sondage, pas de passages simultanes`, async () => {
    const w = monde(extraireHelper(lire(p)));
    let n = 0, simultanes = 0, max = 0;
    w.ctx.sondageAdaptatif(async () => { n++; simultanes++; max = Math.max(max, simultanes); simultanes--; throw new Error('reseau'); }, 500);
    await w.avancer(2000);
    assert.equal(n, 4);
    assert.equal(max, 1);
  });
}

test('cablage web : les trois sondages passent par le ralentisseur', () => {
  const idx = lire(FICHIERS['web index2.js']);
  const ov = lire(FICHIERS['web cloud-overrides.js']);
  assert.ok(!/setTimeout\(_tick, (8000|12000)\)/.test(idx), 'active-jobs : delai fixe encore present');
  assert.ok(/setTimeout\(_tick, intervalleSondage\(8000\)\)/.test(idx));
  assert.ok(/setTimeout\(_tick, intervalleSondage\(12000\)\)/.test(idx));
  assert.ok(/addEventListener\('visibilitychange'[\s\S]{0,400}_tick\(\)/.test(idx), 'active-jobs : pas de rafraichissement a visibilitychange');
  assert.ok(!/setInterval\(refreshCreditsPill/.test(ov), 'pastille de credits : setInterval fixe');
  assert.ok(!/setInterval\(refreshInbox/.test(ov), 'boite aux lettres : setInterval fixe');
  assert.ok(/sondageAdaptatif\(refreshCreditsPill, 30_000\)/.test(ov));
  assert.ok(/sondageAdaptatif\(refreshInbox, 30_000\)/.test(ov));
});

test('cablage bureau : prix, sonde GPU et etat de l assistant passent par le ralentisseur', () => {
  const b = lire(FICHIERS['bureau index2.js']);
  assert.ok(!/setInterval\(rafraichir, 2000\)/.test(b));
  assert.ok(!/setInterval\(\(\) => \{ window\._chargerPrix\(\); \}/.test(b));
  assert.ok(/sondageAdaptatif\(\(\) => window\._chargerPrix\(\), 5 \* 60 \* 1000\)/.test(b));
  assert.ok(/sondageAdaptatif\(rafraichir, 2000\)/.test(b));
  assert.ok(/_timer\.arreter\(\)/.test(b));
  assert.ok(/sondageAdaptatif\(\(\) => \{[^]{0,300}refreshGpuStats\(\);[^]{0,40}\}, 60000\)/.test(b));
});
