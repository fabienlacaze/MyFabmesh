// Tests de CARACTERISATION du webhook Stripe (constat EXP-05, 03/10/2026) : le point d'entree de l'argent. On rejoue la VRAIE fonction handleStripeWebhook de
// cloud/src/worker.ts avec une signature calculee ici (node:crypto) et une doublure de _traiterPaiement qui enregistre ce qui serait credite.
// Lancer (vivant) :  cd cloud && node --test tests/caracterisation-webhook.test.mjs
// Lancer (reference) : WORKER_SRC=C:/tmp/vague2/tc/worker_HEAD.ts node --test tests/caracterisation-webhook.test.mjs
// handleStripeWebhook n'est pas modifie par la vague 1 (seul _traiterPaiement l'est, remplace ici par une doublure : voir argent.test.mjs pour lui). Aucun reseau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { chargerFonctions } from './_charge-worker.mjs';

const SECRET = 'whsec_caracterisation';
let appels, marche, reponsePaiement;
const f = chargerFonctions(['handleStripeWebhook', 'verifyStripeSignature', 'timingSafeEqualHex', 'isMock', 'json', 'err', 'SECURITY_HEADERS', 'PACKS'], {
  _traiterPaiement: async (_env, opts) => { appels.push(opts); return reponsePaiement; },
  _processMarketPurchase: async (_env, sess) => { marche.push(sess.id); },
  supabaseAdmin: () => { throw new Error('Supabase ne doit pas etre atteint par ces cas'); },
  _stripeRest: async () => ({ ok: false, status: 500, data: {}, raw: '' }),
});
const reset = () => { appels = []; marche = []; reponsePaiement = { ok: true }; };
const quiet = async (fn) => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => {}; try { return await fn(); } finally { console.log = l; console.warn = w; console.error = e; } };

function requete(evenement, { secret = SECRET, t = Math.floor(Date.now() / 1000), brut, entete } = {}) {
  const corps = brut ?? JSON.stringify(evenement);
  const sig = entete ?? `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${corps}`).digest('hex')}`;
  return new Request('https://site.example/api/stripe/webhook', { method: 'POST', body: corps, headers: { 'stripe-signature': sig } });
}
const appelle = async (rq, env = { STRIPE_WEBHOOK_SECRET: SECRET }) => quiet(() => f.handleStripeWebhook(rq, env));
const session = (type, objet, extra = {}) => ({ type, livemode: true, data: { object: { id: 'cs_live_1', payment_status: 'paid', amount_total: 5000, ...objet } }, ...extra });
const meta = (m) => ({ metadata: m });

test('webhook : secret non configure -> 500, rien n\'est lu ni credite', async () => {
  reset(); const r = await appelle(requete(session('checkout.session.completed', meta({ user_id: 'u1', pack_id: 'studio' }))), {});
  assert.equal(r.status, 500); assert.equal(appels.length, 0);
});
test('webhook : signature absente, fausse (mauvais secret), alteree (corps change), ancienne (> 5 min) -> 400 bad signature, aucun credit', async () => {
  reset();
  const ev = session('checkout.session.completed', meta({ user_id: 'u1', pack_id: 'studio' }));
  const cas = [
    new Request('https://site.example/w', { method: 'POST', body: JSON.stringify(ev) }),
    requete(ev, { secret: 'autre' }),
    requete(ev, { t: Math.floor(Date.now() / 1000) - 1000 }),
  ];
  const bon = requete(ev); const corpsAltere = JSON.stringify(ev).replace('studio', 'pro');
  cas.push(new Request('https://site.example/w', { method: 'POST', body: corpsAltere, headers: { 'stripe-signature': bon.headers.get('stripe-signature') } }));
  for (const rq of cas) { const r = await appelle(rq); assert.equal(r.status, 400); assert.equal((await r.json()).error, 'bad signature'); }
  assert.equal(appels.length, 0);
});
test('webhook : signature valide mais corps non JSON -> 400 bad json', async () => {
  reset(); const r = await appelle(requete(null, { brut: 'ceci n\'est pas du json' }));
  assert.equal(r.status, 400); assert.equal((await r.json()).error, 'bad json');
});
test('webhook : evenement de TEST (livemode:false) -> 200 ignore, AUCUN credit ; autorise seulement avec STRIPE_ALLOW_TEST_MODE="1" ou en mode MOCK', async () => {
  reset();
  const ev = session('checkout.session.completed', meta({ user_id: 'u1', pack_id: 'studio' }), { livemode: false });
  const r = await appelle(requete(ev)); assert.equal(r.status, 200); assert.deepEqual(await r.json(), { received: true, ignored: 'test_mode' }); assert.equal(appels.length, 0);
  for (const v of ['0', 'true', '', undefined]) { await appelle(requete(ev), { STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_ALLOW_TEST_MODE: v }); assert.equal(appels.length, 0, String(v)); }
  await appelle(requete(ev), { STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_ALLOW_TEST_MODE: '1' }); assert.equal(appels.length, 1);
  await appelle(requete(ev), { STRIPE_WEBHOOK_SECRET: SECRET, MOCK: '1' }); assert.equal(appels.length, 2);
});
test('webhook : livemode absent (undefined) n\'est PAS un evenement de test (seul false l\'est)', async () => {
  reset(); const ev = session('checkout.session.completed', meta({ user_id: 'u1', pack_id: 'pro' })); delete ev.livemode;
  await appelle(requete(ev)); assert.equal(appels.length, 1);
});
test('webhook : achat de credits paye -> credits LUS DANS PACKS (jamais dans la requete), montant = amount_total / 100', async () => {
  reset();
  for (const [pack, credits, euros] of [['starter', 25, 50], ['pro', 120, 50], ['studio', 350, 50]]) {
    appels.length = 0;
    const r = await appelle(requete(session('checkout.session.completed', meta({ user_id: 'u1', pack_id: pack, credits: '99999' }))));
    assert.equal(r.status, 200);
    assert.deepEqual(appels, [{ sessionOrInvoiceId: 'cs_live_1', userId: 'u1', credits, packId: pack, amountEur: euros }], pack);
  }
});
test('webhook : l\'evenement async_payment_succeeded (SEPA, etc.) credite comme completed', async () => {
  reset(); await appelle(requete(session('checkout.session.async_payment_succeeded', meta({ user_id: 'u1', pack_id: 'studio' }))));
  assert.equal(appels.length, 1); assert.equal(appels[0].credits, 350);
});
test('webhook : session NON payee (unpaid, autre) -> rien n\'est livre ; paid et no_payment_required passent', async () => {
  reset();
  for (const statut of ['unpaid', 'processing', 'canceled']) {
    const r = await appelle(requete(session('checkout.session.completed', { ...meta({ user_id: 'u1', pack_id: 'studio' }), payment_status: statut })));
    assert.deepEqual(await r.json(), { received: true, deferred: statut });
  }
  assert.equal(appels.length, 0);
  await appelle(requete(session('checkout.session.completed', { ...meta({ user_id: 'u1', pack_id: 'studio' }), payment_status: 'no_payment_required' }))); assert.equal(appels.length, 1);
});
test('webhook : un achat BOUTIQUE non paye ne livre pas non plus (garde place au-dessus des trois branches)', async () => {
  reset();
  await appelle(requete(session('checkout.session.completed', { ...meta({ kind: 'market_purchase', user_id: 'u1' }), payment_status: 'unpaid' }))); assert.equal(marche.length, 0);
  await appelle(requete(session('checkout.session.completed', meta({ kind: 'market_purchase', user_id: 'u1' })))); assert.deepEqual(marche, ['cs_live_1']); assert.equal(appels.length, 0, 'aucun credit pour un achat boutique');
});
test('webhook : session d\'abonnement (is_subscription) -> aucun credit ici (invoice.paid s\'en charge, pas de double credit)', async () => {
  reset(); await appelle(requete(session('checkout.session.completed', meta({ user_id: 'u1', pack_id: 'sub_pro', is_subscription: 'true' })))); assert.equal(appels.length, 0);
});
test('webhook : pas d\'utilisateur ou credits nuls -> aucun credit', async () => {
  reset();
  await appelle(requete(session('checkout.session.completed', meta({ pack_id: 'studio' })))); assert.equal(appels.length, 0);
  await appelle(requete(session('checkout.session.completed', meta({ user_id: 'u1' })))); assert.equal(appels.length, 0, 'pack inconnu + credits 0');
  await appelle(requete(session('checkout.session.completed', meta({ user_id: 'u1', pack_id: 'inconnu', credits: '-5' })))); assert.equal(appels.length, 0);
  await appelle(requete(session('checkout.session.completed', {}))); assert.equal(appels.length, 0);
});
test('webhook : pack INCONNU -> repli sur les credits des metadonnees, plafonnes a 10 000 (borne de dernier recours)', async () => {
  reset();
  await appelle(requete(session('checkout.session.completed', meta({ user_id: 'u1', pack_id: 'inconnu', credits: '40' })))); assert.equal(appels[0].credits, 40);
  await appelle(requete(session('checkout.session.completed', meta({ user_id: 'u1', pack_id: 'inconnu', credits: '99999' })))); assert.equal(appels[1].credits, 10_000);
  await appelle(requete(session('checkout.session.completed', meta({ user_id: 'u1', credits: '7' })))); assert.equal(appels[2].packId, 'unknown'); assert.equal(appels[2].credits, 7);
});
test('webhook : le pack est cherche par cle propre ("constructor", "__proto__" ne donnent pas de credits inventes)', async () => {
  reset();
  for (const pack of ['constructor', '__proto__', 'toString']) {
    await appelle(requete(session('checkout.session.completed', meta({ user_id: 'u1', pack_id: pack, credits: '5' }))));
  }
  for (const a of appels) assert.ok(Number.isFinite(a.credits) && a.credits <= 10_000, JSON.stringify(a));
});
test('webhook : echec TRANSITOIRE du credit (retry) -> 500 pour que Stripe rejoue ; echec definitif -> 200 (pas de rejeu infini)', async () => {
  reset(); reponsePaiement = { ok: false, retry: true };
  const r = await appelle(requete(session('checkout.session.completed', meta({ user_id: 'u1', pack_id: 'studio' }))));
  assert.equal(r.status, 500); assert.equal((await r.json()).error, 'transient credit failure');
  reponsePaiement = { ok: false, retry: false };
  assert.equal((await appelle(requete(session('checkout.session.completed', meta({ user_id: 'u1', pack_id: 'studio' }))))).status, 200);
});
test('webhook : abonnement (invoice.paid) -> credits du pack serveur ; identifiant de facture comme cle d\'idempotence ; montant = amount_paid / 100', async () => {
  reset();
  const inv = (m, extra = {}) => ({ type: 'invoice.paid', livemode: true, data: { object: { id: 'in_1', amount_paid: 1500, subscription_details: { metadata: m }, ...extra } } });
  await appelle(requete(inv({ user_id: 'u1', pack_id: 'sub_pro', credits: '99999' })));
  assert.deepEqual(appels, [{ sessionOrInvoiceId: 'in_1', userId: 'u1', credits: 100, packId: 'sub_pro', amountEur: 15 }]);
});
test('webhook : invoice.paid — l\'utilisateur est cherche dans subscription_details, puis les lignes, puis la facture ; sans utilisateur, rien', async () => {
  reset();
  const base = { type: 'invoice.paid', livemode: true };
  await appelle(requete({ ...base, data: { object: { id: 'in_2', amount_paid: 500, lines: { data: [{ metadata: { user_id: 'u2', pack_id: 'sub_starter' } }] } } } }));
  await appelle(requete({ ...base, data: { object: { id: 'in_3', amount_paid: 500, metadata: { user_id: 'u3', pack_id: 'sub_studio' } } } }));
  await appelle(requete({ ...base, data: { object: { id: 'in_4', amount_paid: 500 } } }));
  assert.deepEqual(appels.map((a) => [a.sessionOrInvoiceId, a.userId, a.credits]), [['in_2', 'u2', 30], ['in_3', 'u3', 300]]);
});
test('webhook : evenement de test sur invoice.paid refuse aussi ; evenement inconnu / paiement differe echoue -> 200 sans credit', async () => {
  reset();
  await appelle(requete({ type: 'invoice.paid', livemode: false, data: { object: { id: 'in_5', metadata: { user_id: 'u1', pack_id: 'sub_pro' } } } })); assert.equal(appels.length, 0);
  const r = await appelle(requete(session('customer.created', {}))); assert.equal(r.status, 200); assert.deepEqual(await r.json(), { received: true });
  const r2 = await appelle(requete(session('checkout.session.async_payment_failed', meta({ user_id: 'u1', pack_id: 'studio' })))); assert.deepEqual(await r2.json(), { received: true, async_payment: 'failed' });
  assert.equal(appels.length, 0);
});
