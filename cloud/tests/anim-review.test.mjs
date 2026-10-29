// 29/10 (decision du user : Qwen3.6 corrige le realisme des animations A CHAQUE GENERATION) : route /api/anim-review. La page calcule
// l'animation, puis appelle : debut (debit UNIQUE + jeton signe) -> appels (relayes a la route « relire » de Qwen3.6) -> rembourser si rien n'a abouti.
// Ces tests echouent sur l'ancien worker (handleAnimReview n'existe pas).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chargerFonctions, creerR2 } from './_charge-worker.mjs';

const URL_DECRIRE = 'https://fabienlacaze--myfabmesh-reglage-gpu-reglagegpu-decrire.modal.run';
const URL_RELIRE = 'https://fabienlacaze--myfabmesh-reglage-gpu-reglagegpu-relire.modal.run';

function monter({ reponse = { ok: true, analyse: 'too weak', changements: { deplacement: 1.3 } }, credits = 10, env = {}, budget = true } = {}) {
  const appels = [], journal = { credits, depense: 0, rembourse: 0 };
  const faux = async (url, init) => {
    appels.push({ url, corps: JSON.parse(init.body) });
    if (reponse instanceof Error) throw reponse;
    return { ok: !!reponse, status: reponse ? 200 : 503, json: async () => reponse };
  };
  const w = chargerFonctions(['handleAnimReview', '_relectureUrl', '_jetonRelecture', '_lireJetonRelecture', '_hmacSign', 'RELECTURE_APPELS_MAX', 'RELECTURE_DUREE_MS', 'RELECTURE_USD_APPEL'], {
    getSessionUser: async () => ({ id: 'u1' }), err: (status, error) => ({ status, error }), json: (o, init) => ({ ...o, _status: init?.status ?? 200 }), fetch: faux,
    getPrice: async (_e, k) => (k === 'anim_review' ? 2 : 99),
    spendCredits: async (_e, _u, n) => { if (journal.credits < n) return null; journal.credits -= n; return journal.credits; },
    addCredits: async (_e, _u, n) => { journal.credits += n; journal.rembourse += n; return journal.credits; },
    checkAndIncrementModalSpend: async (_e, usd) => { if (!budget) return null; journal.depense += usd; return 1; },
    refundModalSpend: async (_e, usd) => { journal.depense -= usd; },
    _spendRefusalMessage: async () => 'daily GPU budget reached',
  });
  const E = { MODAL_REDACTEUR_GPU_URL: URL_DECRIRE, MODAL_SHARED_SECRET: 's', R2_URL_SIGNING_SECRET: 'cle', MESHES: creerR2(), ...env };
  const req = (corps) => ({ json: async () => corps });
  return { w, appels, journal, E, req };
}
const IMG = 'QUJD';

test("debut : debite 2 credits UNE fois et rend un jeton ; l'URL relire est deduite de decrire", async () => {
  const m = monter();
  const d = await m.w.handleAnimReview(m.req({ action: 'debut', allure: 'attack' }), m.E);
  assert.equal(d.ok, true); assert.equal(d.cost, 2); assert.equal(m.journal.credits, 8); assert.ok(d.jeton.includes('.'));
  const r = await m.w.handleAnimReview(m.req({ action: 'appel', jeton: d.jeton, mode: 'proposer', allure: 'attack', espece: 'araignee', leviers: { deplacement: 1 }, images: [IMG] }), m.E);
  assert.equal(r.ok, true); assert.deepEqual(r.changements, { deplacement: 1.3 });
  assert.equal(m.appels[0].url, URL_RELIRE); assert.equal(m.appels[0].corps.mode, 'proposer'); assert.equal(m.appels[0].corps._auth, 's');
  assert.equal(m.journal.credits, 8, 'les appels ne debitent pas de credits');
});

test('credits insuffisants : 402, aucun jeton', async () => {
  const m = monter({ credits: 1 });
  const d = await m.w.handleAnimReview(m.req({ action: 'debut', allure: 'attack' }), m.E);
  assert.equal(d.ok, false); assert.equal(d._status, 402); assert.equal(d.jeton, undefined);
});

test("jeton falsifie ou d'un autre compte : 403", async () => {
  const m = monter();
  const d = await m.w.handleAnimReview(m.req({ action: 'debut', allure: 'attack' }), m.E);
  const [corps, sig] = d.jeton.split('.');
  const faux = btoa(JSON.stringify({ u: 'u2', a: 'attack', e: Date.now() + 1e6, j: 'abcdefgh-1234' })).replace(/=+$/, '') + '.' + sig;
  for (const j of [faux, corps + '.xx', 'n/importe']) {
    const r = await m.w.handleAnimReview(m.req({ action: 'appel', jeton: j, mode: 'proposer', images: [IMG] }), m.E);
    assert.equal(r.status, 403, j);
  }
  assert.equal(m.appels.length, 0);
});

test('au-dela de 8 appels par jeton : 429, Modal non appele', async () => {
  const m = monter();
  const d = await m.w.handleAnimReview(m.req({ action: 'debut', allure: 'attack' }), m.E);
  for (let i = 0; i < 8; i++) await m.w.handleAnimReview(m.req({ action: 'appel', jeton: d.jeton, mode: 'comparer', images: [IMG, IMG, IMG, IMG] }), m.E);
  const r = await m.w.handleAnimReview(m.req({ action: 'appel', jeton: d.jeton, mode: 'comparer', images: [IMG, IMG, IMG, IMG] }), m.E);
  assert.equal(r._status, 429); assert.equal(m.appels.length, 8);
});

test("Qwen injoignable : budget GPU rendu, puis remboursement des credits UNE fois si rien n'a abouti", async () => {
  const m = monter({ reponse: new Error('timeout') });
  const d = await m.w.handleAnimReview(m.req({ action: 'debut', allure: 'attack' }), m.E);
  const r = await m.w.handleAnimReview(m.req({ action: 'appel', jeton: d.jeton, mode: 'proposer', images: [IMG] }), m.E);
  assert.equal(r.ok, false); assert.equal(m.journal.depense, 0);
  const rb = await m.w.handleAnimReview(m.req({ action: 'rembourser', jeton: d.jeton }), m.E);
  assert.equal(rb.ok, true); assert.equal(m.journal.credits, 10);
  const rb2 = await m.w.handleAnimReview(m.req({ action: 'rembourser', jeton: d.jeton }), m.E);
  assert.equal(rb2.ok, false); assert.equal(m.journal.credits, 10, 'pas de double remboursement');
});

test('pas de remboursement apres un appel abouti', async () => {
  const m = monter();
  const d = await m.w.handleAnimReview(m.req({ action: 'debut', allure: 'attack' }), m.E);
  await m.w.handleAnimReview(m.req({ action: 'appel', jeton: d.jeton, mode: 'proposer', images: [IMG] }), m.E);
  const rb = await m.w.handleAnimReview(m.req({ action: 'rembourser', jeton: d.jeton }), m.E);
  assert.equal(rb.ok, false); assert.equal(m.journal.credits, 8);
});

test("RELECTURE_ANIM='0' coupe la route ; budget GPU du jour atteint : 429", async () => {
  const m = monter({ env: { RELECTURE_ANIM: '0' } });
  const d = await m.w.handleAnimReview(m.req({ action: 'debut', allure: 'attack' }), m.E);
  assert.equal(d.ok, false); assert.equal(d.raison, 'unavailable'); assert.equal(m.journal.credits, 10);
  const m2 = monter({ budget: false });
  const d2 = await m2.w.handleAnimReview(m2.req({ action: 'debut', allure: 'attack' }), m2.E);
  const r2 = await m2.w.handleAnimReview(m2.req({ action: 'appel', jeton: d2.jeton, mode: 'proposer', images: [IMG] }), m2.E);
  assert.equal(r2._status, 429); assert.equal(m2.appels.length, 0);
});
