// Tests de l'encaissement Stripe (constat CLOUD-01 de l'analyse du 03/10/2026) : charge les VRAIES fonctions depuis src/worker.ts (transpilees)
// et les rejoue contre un faux client Supabase en memoire. Aucun reseau.
// Lancer : cd cloud && node --test tests/argent.test.mjs
// Pour verifier qu'ils echouent sur l'ancien code : WORKER_SRC=<copie de git show HEAD:cloud/src/worker.ts> node --test tests/argent.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');

const chemin = process.env.WORKER_SRC || new URL('../src/worker.ts', import.meta.url);
const src = readFileSync(chemin, 'utf8').replace(/\r\n/g, '\n');
const debut = src.includes('const MSG_PAIEMENT_REMBOURSE') ? src.indexOf('const MSG_PAIEMENT_REMBOURSE') : src.indexOf('/* Encaissement idempotent');
const fin = src.indexOf('async function handleStripeWebhook');
assert.ok(debut > 0 && fin > debut, 'ancres introuvables dans worker.ts');
const js = ts.transpileModule(src.slice(debut, fin), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

/* ---------- faux Supabase en memoire (tables payments et profiles) ---------- */
function creerMonde({ addCreditsEchoue = 0 } = {}) {
  const tables = { payments: [], profiles: [{ id: 'u1', credits: 0 }] };
  let seq = 1;
  const journal = { credits: [], dettes: [] };
  const tick = () => new Promise((r) => setImmediate(r)); // laisse les requetes concurrentes s'entrelacer
  function builder(nom) {
    const st = { op: 'select', filtres: [], patch: null, ligne: null, cols: '*' };
    const correspond = (l) => st.filtres.every((f) => f(l));
    const executer = async () => {
      await tick();
      const t = tables[nom];
      if (st.op === 'insert') {
        if (t.some((l) => l.stripe_session_id === st.ligne.stripe_session_id)) return { data: null, error: { code: '23505', message: 'dup' } };
        t.push({ id: seq++, credits_origine: null, ...st.ligne });
        return { data: null, error: null };
      }
      const cibles = t.filter(correspond);
      if (st.op === 'update') { for (const l of cibles) Object.assign(l, st.patch); await tick(); return { data: st.renvoyer ? cibles.map((l) => ({ id: l.id })) : null, error: null }; }
      return { data: cibles.map((l) => ({ ...l })), error: null };
    };
    const api = {
      select(cols) { if (st.op === 'update') st.renvoyer = true; else st.cols = cols; return api; },
      insert(ligne) { st.op = 'insert'; st.ligne = ligne; return api; },
      update(patch) { st.op = 'update'; st.patch = patch; return api; },
      eq(c, v) { st.filtres.push((l) => l[c] === v); return api; },
      is(c, v) { st.filtres.push((l) => (l[c] ?? null) === v); return api; },
      async maybeSingle() { const r = await executer(); return { data: r.data?.[0] ?? null, error: r.error }; },
      then(ok, ko) { return executer().then(ok, ko); },
    };
    return api;
  }
  const sb = { from: builder };
  const env = { MESHES: { delete: async () => {} } };
  let echecs = addCreditsEchoue;
  const addCredits = async (_env, uid, montant) => {
    await tick();
    if (echecs > 0) { echecs--; return null; }
    const p = tables.profiles.find((x) => x.id === uid); p.credits += montant; journal.credits.push(montant); return p.credits;
  };
  return { tables, sb, env, addCredits, journal };
}

function charger(monde, extra = {}) {
  const f = new Function('supabaseAdmin', 'addCredits', '_detteTotale', '_consommerDette', '_poserDette', 'todayUTC',
    'err', 'json', 'getSessionUser', '_stripeRest', 'PACKS',
    js + '; return { _traiterPaiement, handleCheckoutReconcile, decisionPriseEnCharge: typeof decisionPriseEnCharge === "function" ? decisionPriseEnCharge : undefined };');
  return f(() => monde.sb, monde.addCredits, async () => 0, async () => 0, async () => {}, () => '2026-10-03',
    (status, message) => new Response(JSON.stringify({ error: message }), { status }),
    (o) => new Response(JSON.stringify(o), { status: 200 }),
    extra.getSessionUser || (async () => ({ id: 'u1' })),
    extra._stripeRest || (async () => ({ ok: false, status: 500, data: {}, raw: '' })),
    { studio: { credits: 350 }, starter: { credits: 25 } });
}
const ACHAT = { sessionOrInvoiceId: 'cs_test_1', userId: 'u1', credits: 350, packId: 'studio', amountEur: 50 };

test('decisionPriseEnCharge : table de decision', () => {
  const m = creerMonde(); const { decisionPriseEnCharge: d } = charger(m);
  assert.equal(d(null), 'a_creer');
  assert.equal(d({ credits: 350, credits_origine: null }), 'deja_credite');
  assert.equal(d({ credits: 0, credits_origine: null }), 'a_reprendre');
  assert.equal(d({ credits: 0 }), 'a_reprendre');
  assert.equal(d({ credits: 0, credits_origine: 350 }), 'rembourse', 'remboursement total : ne JAMAIS recrediter');
  assert.equal(d({ credits: 0, credits_origine: 0 }), 'rembourse', 'origine = 0 compte aussi (renseignee)');
  assert.equal(d({ credits: 175, credits_origine: 350 }), 'deja_credite', 'remboursement partiel : deja credite');
});

test('achat normal : un seul credit, ligne au vrai montant', async () => {
  const m = creerMonde(); const { _traiterPaiement } = charger(m);
  const r = await _traiterPaiement(m.env, ACHAT);
  assert.equal(r.ok, true);
  assert.deepEqual(m.journal.credits, [350]);
  assert.equal(m.tables.payments[0].credits, 350);
  assert.equal(m.tables.payments[0].amount_eur, 50);
});

test('webhook rejoue : pas de double credit', async () => {
  const m = creerMonde(); const { _traiterPaiement } = charger(m);
  await _traiterPaiement(m.env, ACHAT);
  const r2 = await _traiterPaiement(m.env, ACHAT);
  assert.equal(r2.ok, true);
  assert.deepEqual(m.journal.credits, [350]);
});

test('essai interrompu (ligne a 0, jamais remboursee) : repris une seule fois', async () => {
  const m = creerMonde(); const { _traiterPaiement } = charger(m);
  m.tables.payments.push({ id: 99, stripe_session_id: 'cs_test_1', user_id: 'u1', credits: 0, credits_origine: null, amount_eur: 0 });
  await _traiterPaiement(m.env, ACHAT);
  await _traiterPaiement(m.env, ACHAT);
  assert.deepEqual(m.journal.credits, [350]);
});

test('reconcile apres remboursement : AUCUN credit (la ligne est a 0 avec credits_origine)', async () => {
  const m = creerMonde(); const { _traiterPaiement } = charger(m);
  m.tables.payments.push({ id: 7, stripe_session_id: 'cs_test_1', user_id: 'u1', credits: 0, credits_origine: 350, amount_eur: 0 });
  const r = await _traiterPaiement(m.env, ACHAT);
  assert.equal(r.ok, true);
  assert.equal(r.credited, false);
  assert.deepEqual(m.journal.credits, []);
  assert.equal(m.tables.payments[0].credits, 0, 'la ligne reste remboursee');
});

test('handleCheckoutReconcile : session payee mais ligne remboursee -> credited:false, rien credite', async () => {
  const m = creerMonde();
  m.tables.payments.push({ id: 7, stripe_session_id: 'cs_test_1', user_id: 'u1', credits: 0, credits_origine: 350, amount_eur: 0 });
  const stripe = async () => ({ ok: true, status: 200, raw: '', data: { payment_status: 'paid', amount_total: 5000, metadata: { user_id: 'u1', pack_id: 'studio' } } });
  const { handleCheckoutReconcile } = charger(m, { _stripeRest: stripe });
  const rep = await handleCheckoutReconcile(new Request('https://site.example/api/checkout/reconcile', { method: 'POST', body: JSON.stringify({ session_id: 'cs_test_1' }) }), { STRIPE_SECRET_KEY: 'sk' });
  const corps = await rep.json();
  assert.equal(corps.credited, false);
  assert.match(corps.reason, /rembours/);
  assert.deepEqual(m.journal.credits, []);
});

test('handleCheckoutReconcile : Stripe signale amount_refunded > 0 avant le webhook -> rien credite, rien insere', async () => {
  const m = creerMonde();
  const stripe = async (_e, url) => ({ ok: true, status: 200, raw: '', data: url.includes('expand')
    ? { payment_status: 'paid', amount_total: 5000, metadata: { user_id: 'u1', pack_id: 'studio' }, payment_intent: { latest_charge: { amount_refunded: 5000, refunded: true } } }
    : { payment_status: 'paid', amount_total: 5000, metadata: { user_id: 'u1', pack_id: 'studio' } } });
  const { handleCheckoutReconcile } = charger(m, { _stripeRest: stripe });
  const rep = await handleCheckoutReconcile(new Request('https://site.example/x', { method: 'POST', body: JSON.stringify({ session_id: 'cs_test_1' }) }), { STRIPE_SECRET_KEY: 'sk' });
  assert.equal((await rep.json()).credited, false);
  assert.deepEqual(m.journal.credits, []);
  assert.equal(m.tables.payments.length, 0);
});

test('handleCheckoutReconcile : achat normal credite une fois, un second reconcile ne recredite pas', async () => {
  const m = creerMonde();
  const stripe = async () => ({ ok: true, status: 200, raw: '', data: { payment_status: 'paid', amount_total: 5000, metadata: { user_id: 'u1', pack_id: 'studio' } } });
  const { handleCheckoutReconcile } = charger(m, { _stripeRest: stripe });
  const appel = () => handleCheckoutReconcile(new Request('https://site.example/x', { method: 'POST', body: JSON.stringify({ session_id: 'cs_test_1' }) }), { STRIPE_SECRET_KEY: 'sk' });
  await appel(); await appel();
  assert.deepEqual(m.journal.credits, [350]);
});

test('deux reconcile simultanes (et une rafale de 8) : un seul credit', async () => {
  for (const n of [2, 8]) {
    const m = creerMonde(); const { _traiterPaiement } = charger(m);
    const res = await Promise.all(Array.from({ length: n }, () => _traiterPaiement(m.env, ACHAT)));
    assert.ok(res.every((r) => r.ok));
    assert.deepEqual(m.journal.credits, [350], `rafale de ${n}`);
    assert.equal(m.tables.payments.length, 1);
  }
});

test('webhook et reconcile en course sur une ligne a 0 laissee par un essai interrompu : un seul credit', async () => {
  const m = creerMonde(); const { _traiterPaiement } = charger(m);
  m.tables.payments.push({ id: 99, stripe_session_id: 'cs_test_1', user_id: 'u1', credits: 0, credits_origine: null, amount_eur: 0 });
  await Promise.all([_traiterPaiement(m.env, ACHAT), _traiterPaiement(m.env, ACHAT), _traiterPaiement(m.env, ACHAT)]);
  assert.deepEqual(m.journal.credits, [350]);
});

test('echec de addCredits : la ligne est remise a 0, retry:true, le rejeu credite une seule fois', async () => {
  const m = creerMonde({ addCreditsEchoue: 1 }); const { _traiterPaiement } = charger(m);
  const r1 = await _traiterPaiement(m.env, ACHAT);
  assert.deepEqual(r1, { ok: false, retry: true });
  assert.equal(m.tables.payments[0].credits, 0);
  assert.deepEqual(m.journal.credits, []);
  const r2 = await _traiterPaiement(m.env, ACHAT);
  assert.equal(r2.ok, true);
  assert.deepEqual(m.journal.credits, [350]);
});
