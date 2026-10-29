// 29/10 (decision du user) : le prompt automatique de « New project » passe d'abord par Qwen3.6 (GPU, app myfabmesh-reglage-gpu), puis REPLI sur le 4B CPU
// (app myfabmesh-redacteur) si le GPU est coupe, en erreur ou ne rend pas de description. Ces tests echouent sur l'ancien worker (un seul appel, vers le 4B).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chargerFonctions, creerR2 } from './_charge-worker.mjs';

const URL_CPU = 'https://fabienlacaze--myfabmesh-redacteur-redacteur-decrire.modal.run';
const URL_GPU = 'https://fabienlacaze--myfabmesh-reglage-gpu-reglagegpu-decrire.modal.run';

function monter(reponses, env = {}) {
  const appels = [];
  const faux = async (url, init) => {
    appels.push({ url, corps: JSON.parse(init.body) });
    const r = reponses[url];
    if (r instanceof Error) throw r;
    return { ok: !!r, status: r ? 200 : 503, json: async () => r };
  };
  const w = chargerFonctions(['handleDescribeAsset', 'REDACTEUR_TYPES', 'prechauffeRedacteurDue', 'PRECHAUFFE_REDACTEUR_FENETRE_MS'], {
    getSessionUser: async () => ({ id: 'u1' }), err: (status, error) => ({ status, error }), json: (o) => o,
    getParentalState: async () => ({ unrestricted: false }), _checkPromptSafetyAlerte: async () => ({ safe: true }), fetch: faux,
  });
  const E = { MODAL_REDACTEUR_URL: URL_CPU, MODAL_SHARED_SECRET: 's', MESHES: creerR2(), ...env };
  const requete = (corps) => ({ json: async () => corps });
  return { w, appels, E, requete };
}
const BON_GPU = { ok: true, type: 'animal', description: 'Un renne majestueux aux bois ramifies et a la fourrure epaisse brune.' };
const BON_CPU = { ok: true, type: 'creature', description: 'Une creature de secours decrite par le petit modele de repli.' };

test('Qwen3.6 repond : une seule requete, vers le GPU', async () => {
  const m = monter({ [URL_GPU]: BON_GPU, [URL_CPU]: BON_CPU });
  const r = await m.w.handleDescribeAsset(m.requete({ name: 'Renne', lang: 'fr' }), m.E);
  assert.equal(r.ok, true); assert.equal(r.description, BON_GPU.description); assert.equal(r.type, 'animal');
  assert.deepEqual(m.appels.map((a) => a.url), [URL_GPU]);
});

test('GPU en erreur reseau : repli sur le 4B CPU', async () => {
  const m = monter({ [URL_GPU]: new Error('timeout'), [URL_CPU]: BON_CPU });
  const r = await m.w.handleDescribeAsset(m.requete({ name: 'Renne', lang: 'fr' }), m.E);
  assert.equal(r.ok, true); assert.equal(r.description, BON_CPU.description);
  assert.deepEqual(m.appels.map((a) => a.url), [URL_GPU, URL_CPU]);
});

test('GPU rend HTTP 503 ou « pas de description » : repli sur le 4B CPU', async () => {
  for (const g of [null, { ok: false, error: 'no valid answer' }, { ok: true, type: 'animal', description: '' }]) {
    const m = monter({ [URL_GPU]: g, [URL_CPU]: BON_CPU });
    const r = await m.w.handleDescribeAsset(m.requete({ name: 'Renne', lang: 'fr' }), m.E);
    assert.equal(r.description, BON_CPU.description, JSON.stringify(g));
    assert.deepEqual(m.appels.map((a) => a.url), [URL_GPU, URL_CPU]);
  }
});

test("REDACTEUR_GPU='0' coupe le GPU : seul le 4B est appele", async () => {
  const m = monter({ [URL_GPU]: BON_GPU, [URL_CPU]: BON_CPU }, { REDACTEUR_GPU: '0' });
  const r = await m.w.handleDescribeAsset(m.requete({ name: 'Renne', lang: 'fr' }), m.E);
  assert.equal(r.description, BON_CPU.description);
  assert.deepEqual(m.appels.map((a) => a.url), [URL_CPU]);
});

test('les deux hors service : { ok:false } comme avant, aucune exception', async () => {
  const m = monter({ [URL_GPU]: new Error('x'), [URL_CPU]: null });
  const r = await m.w.handleDescribeAsset(m.requete({ name: 'Renne', lang: 'fr' }), m.E);
  assert.equal(r.ok, false);
});

test('la pre-chauffe reveille aussi le GPU sans l\'attendre, et repond ok', async () => {
  const m = monter({ [URL_GPU]: { ok: true, pret: true }, [URL_CPU]: { ok: true, pret: true } });
  const r = await m.w.handleDescribeAsset(m.requete({ prechauffer: true }), m.E);
  assert.equal(r.ok, true);
  const urls = m.appels.map((a) => a.url).sort();
  assert.deepEqual(urls, [URL_CPU, URL_GPU].sort());
  assert.ok(m.appels.every((a) => a.corps.prechauffer === true));
});
