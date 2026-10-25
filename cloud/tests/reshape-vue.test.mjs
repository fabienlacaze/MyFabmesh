// « Reshape a region » avec une VUE CHOISIE dans le visualiseur 3D (2026-10-19) : validation cote worker.
// Demande du proprietaire : « Reshape a region doit avoir un viewer 3D pour permettre d'afficher la zone que l'on
// souhaite, pas un 2D de face ». Le navigateur envoie `vue` = { yaw, pitch, xmag } ; le worker la VALIDE avant tout
// debit, puis la transmet a Modal, qui fait tourner le maillage (scripts/mesh_inpaint.py).
//   - validerVueReshape : les cas partages avec Python / bureau / pages (build/bancs/noyaux/reshape_vue_cas.json) ;
//   - handleMeshReshape (VRAIE fonction, doublures) : angle invalide -> 400 SANS aucun debit ni appel Modal ;
//     vue valide -> transmise a Modal telle quelle ; vue de face (ou absente) -> aucun champ `vue` (comme avant) ;
//     zone peinte en 3D + vue tournee -> 400.
// Lancer : cd cloud && node --test tests/reshape-vue.test.mjs
// Contre l'ancien code : git show <rev>:cloud/src/worker.ts > copie.ts ; WORKER_SRC=copie.ts node --test tests/reshape-vue.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chargerFonctions } from './_charge-worker.mjs';

const CAS = JSON.parse(readFileSync(new URL('../../build/bancs/noyaux/reshape_vue_cas.json', import.meta.url), 'utf8'));
const jeton = (v) => (v === '__NaN__' ? NaN : v === '__Infinity__' ? Infinity : v === '__-Infinity__' ? -Infinity : v);

const err = (status, message) => new Response(JSON.stringify({ error: message }), { status, headers: { 'content-type': 'application/json' } });
const json = (o, init) => new Response(JSON.stringify(o), { status: init?.status ?? 200, headers: { 'content-type': 'application/json' } });

test('validerVueReshape : les cas partages (angles) et la demi-largeur', () => {
  const { validerVueReshape } = chargerFonctions(['validerVueReshape']);
  assert.equal(typeof validerVueReshape, 'function');
  for (const c of CAS.cas) {
    const r = validerVueReshape({ yaw: jeton(c.yaw), pitch: jeton(c.pitch) });
    assert.equal(r.ok, c.ok, JSON.stringify(c));
    if (c.ok) {
      if (c.sortie[0] === 0 && c.sortie[1] === 0) assert.equal(r.vue, null, 'vue de face : rien a transmettre');
      else assert.deepEqual([r.vue.yaw, r.vue.pitch], c.sortie, JSON.stringify(c));
    }
  }
  for (const c of CAS.xmag_valide) {
    const r = validerVueReshape({ yaw: 10, pitch: 0, xmag: jeton(c.x) });
    assert.equal(r.ok, c.ok, JSON.stringify(c));
    if (c.ok) assert.equal(r.vue.xmag, c.sortie);
  }
  assert.deepEqual(validerVueReshape(undefined), { ok: true, vue: null });
  assert.deepEqual(validerVueReshape(null), { ok: true, vue: null });
  for (const mauvais of ['x', 5, true, [1, 2]]) assert.equal(validerVueReshape(mauvais).ok, false, String(mauvais));
});

function monter({ vue, uvMask = false, corps = {} } = {}) {
  const journal = { debits: 0, remboursements: 0, modal: [], jobs: [], r2: [] };
  const f = chargerFonctions(['handleMeshReshape', 'validerVueReshape', 'ESTIMATED_USD_RESHAPE'], {
    err, json,
    getSessionUser: async () => ({ id: 'u1' }),
    isTrustedAssetHost: () => true,
    getParentalState: async () => ({}),
    _checkPromptSafetyAlerte: async () => ({ safe: true }),
    getPrice: async () => 5,
    checkAndIncrementModalSpend: async () => { journal.debits++; return 10; },
    checkAndIncrementUserCalls: async () => 10,
    spendCredits: async () => 20,
    addCredits: async () => { journal.remboursements++; },
    refundModalSpend: async () => {},
    // doublures INERTES sur ce code, utiles quand le lot « filet de langue » (integration-2) est fusionne : la fonction les appelle alors
    _filetLangue: async (_env, _uid, texte) => ({ texte, refus: null }),
    neutraliserSyntaxePrompt: (t) => t,   // 2026-10-13 (MODERATION-07) : la route l'appelle avant l'envoi a Modal
    _refusChaineEnvoyee: async () => null,
    _spendRefusalMessage: async () => 'refus',
    signedR2Url: async (_env, cle) => 'https://site.example/r2/' + cle,
    _provenance: () => ({}), _paysRequete: () => 'FR',
    supabaseAdmin: () => ({ from: () => ({
      insert: async (ligne) => { journal.jobs.push(ligne); return { error: null }; },
      update: () => ({ eq: async () => ({}) }),
    }) }),
    fetch: async (_url, init) => { journal.modal.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }); },
  });
  const env = {
    MODAL_MESH_START_URL: 'https://modal.example/mesh_start', MODAL_MESH_STATUS_URL: 'https://modal.example/mesh_status', MODAL_SHARED_SECRET: 's',
    MESHES: { put: async (cle) => { journal.r2.push(cle); } },
  };
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  const requete = () => new Request('https://site.example/api/mesh-reshape', { method: 'POST', body: JSON.stringify({
    meshUrl: 'https://site.example/r2/u1/a.glb?exp=1&sig=x', vueUrl: 'https://site.example/r2/u1/v.png?exp=1&sig=x',
    prompt: 'a crystal skull', ...(uvMask ? { uvMaskDataUrl: png } : { maskDataUrl: png }),
    ...(vue !== undefined ? { vue } : {}), ...corps }) });
  return { appeler: () => f.handleMeshReshape(requete(), env), journal };
}

test('handleMeshReshape : un angle invalide est refuse en 400 AVANT tout debit, tout stockage et tout appel Modal', async () => {
  const mauvais = [
    { yaw: 400, pitch: 0 }, { yaw: -181, pitch: 0 }, { yaw: 0, pitch: 91 }, { yaw: 10, pitch: -90.5 },
    { yaw: '90', pitch: 0 }, { yaw: 0, pitch: true }, { yaw: [], pitch: 0 }, { yaw: 10, pitch: 0, xmag: 0.2 },
    { yaw: 10, pitch: 0, xmag: 50 }, { yaw: 10, pitch: 0, xmag: '1' }, 'tourne', 12, [1, 2],
  ];
  for (const vue of mauvais) {
    const m = monter({ vue });
    const r = await m.appeler();
    assert.equal(r.status, 400, JSON.stringify(vue));
    assert.match((await r.json()).error, /invalid view/);
    assert.equal(m.journal.debits, 0, 'aucun debit : ' + JSON.stringify(vue));
    assert.equal(m.journal.r2.length, 0);
    assert.equal(m.journal.jobs.length, 0);
    assert.equal(m.journal.modal.length, 0);
  }
});

test('handleMeshReshape : NaN et Infinity ne passent pas le JSON, null equivaut a 0 (vue de face)', async () => {
  // JSON.stringify(NaN) donne null : une vue { yaw: null, pitch: null } est la vue de face, jamais un angle invente
  const m = monter({ vue: { yaw: NaN, pitch: Infinity } });
  const r = await m.appeler();
  assert.equal(r.status, 200);
  assert.equal('vue' in m.journal.modal[0], false);
});

test('handleMeshReshape : une vue valide est transmise a Modal avec ses trois nombres', async () => {
  const m = monter({ vue: { yaw: 135.5, pitch: -20, xmag: 0.85 } });
  const r = await m.appeler();
  assert.equal(r.status, 200);
  assert.equal(m.journal.modal.length, 1);
  assert.deepEqual(m.journal.modal[0].vue, { yaw: 135.5, pitch: -20, xmag: 0.85 });
  assert.equal(m.journal.modal[0].op_type, 'reshape');
  assert.equal(m.journal.jobs[0].options.vue_yaw, 135.5);
  assert.equal(m.journal.jobs[0].options.vue_pitch, -20);
});

test('handleMeshReshape : vue absente, nulle ou de face (0, 0) = comportement d avant, aucun champ vue', async () => {
  for (const vue of [undefined, null, { yaw: 0, pitch: 0 }, { yaw: 0, pitch: 0, xmag: 0.6 }, {}]) {
    const m = monter({ vue });
    const r = await m.appeler();
    assert.equal(r.status, 200, JSON.stringify(vue));
    assert.equal('vue' in m.journal.modal[0], false, 'aucun champ vue : ' + JSON.stringify(vue));
    assert.equal('vue_yaw' in m.journal.jobs[0].options, false);
  }
});

test('handleMeshReshape : zone peinte en 3D et vue tournee ne se combinent pas (400) ; avec une vue de face c est permis', async () => {
  const m = monter({ vue: { yaw: 90, pitch: 0, xmag: 0.7 }, uvMask: true });
  const r = await m.appeler();
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /cannot be combined/);
  assert.equal(m.journal.debits, 0);
  const ok = monter({ vue: { yaw: 0, pitch: 0 }, uvMask: true });
  assert.equal((await ok.appeler()).status, 200);
});
