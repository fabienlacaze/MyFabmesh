// Tests de CARACTERISATION de l'argent (constat EXP-05, 03/10/2026) : ils figent le comportement actuel de cloud/src/worker.ts sur la grille de prix,
// le cout d'un travail, l'arithmetique des credits, les remboursements et l'idempotence. Une regression de ces regles = de l'argent perdu ou cree.
// Lancer (vivant) :  cd cloud && node --test tests/caracterisation-argent.test.mjs
// Lancer (reference) : git show HEAD:cloud/src/worker.ts > /c/tmp/vague2/tc/worker_HEAD.ts
//                      WORKER_SRC=C:/tmp/vague2/tc/worker_HEAD.ts node --test tests/caracterisation-argent.test.mjs
// Aucun reseau, aucun secret. Les doublures (faux R2, faux Supabase) viennent de _charge-worker.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chargerFonctions, creerR2, creerSupabase, existe } from './_charge-worker.mjs';

const silence = (f) => async (...a) => { const l = console.log, e = console.error, w = console.warn; console.log = console.error = console.warn = () => {}; try { return await f(...a); } finally { console.log = l; console.error = e; console.warn = w; } };

/* ---------- tarification ---------- */
const P = chargerFonctions(['PRICING_DEFAULTS', 'PRICING_KEY', 'PRICING_TTL_MS', '_pricingCache', '_getPricing', '_invalidatePricingCache', '_supplementTriangles',
  'creditCost', '_neutraliserOptionsSansEffet', 'OPTIONS_SANS_EFFET_CLOUD', '_prixImageSelonPas', '_decomposerMeshAuPrix', '_creditsMeshAuPrix',
  '_creditsAuPrixActuel', '_PRIX_CLE_OP', 'PRIX_IMAGE_AVANT_2026_10_02']);
const D = P.PRICING_DEFAULTS;
const cout = silence((i, env = { MESHES: creerR2() }) => { P._invalidatePricingCache(); return P.creditCost(env, { ...i }); });

test('PRICING_DEFAULTS : tous les prix sont des entiers positifs ou nuls', () => {
  for (const [k, v] of Object.entries(D)) { assert.ok(Number.isInteger(v) && v >= 0, `${k}=${v}`); }
});
test('PRICING_DEFAULTS : toute operation facturee est payante (au moins 1 credit), sauf les reglages d\'affichage du bureau', () => {
  const reglages = new Set(['desktop_prix_centimes', 'desktop_gratuit']);
  for (const [k, v] of Object.entries(D)) if (!reglages.has(k)) assert.ok(v >= 1, `${k} gratuit`);
});
test('PRICING_DEFAULTS : les cles mesh_ des paliers sont ordonnees (aucun palier superieur moins cher)', () => {
  assert.ok(D.mesh_fast <= D.mesh_balanced && D.mesh_balanced <= D.mesh_quality && D.mesh_quality <= D.mesh_ultra_8k);
});
test('PRICING_DEFAULTS : valeurs cles de la grille x4 du 2026-10-02', () => {
  assert.deepEqual([D.mesh_fast, D.mesh_balanced, D.mesh_quality, D.mesh_ultra_8k], [17, 17, 18, 19]);
  assert.deepEqual([D.text2image, D.back_view, D.rectify, D.mesh_rectify, D.outfit_complete, D.reshape, D.rig, D.reskin, D.anim, D.mesh_segment], [6, 6, 9, 9, 19, 23, 10, 6, 5, 15]);
  assert.equal(D.mesh_tris_courbe_pct, 130);
});

test('creditCost : socle = palier + supplement triangles minimal (1)', async () => {
  assert.equal(await cout({ preset: 'fast' }), D.mesh_fast + 1);
  assert.equal(await cout({ preset: 'balanced' }), D.mesh_balanced + 1);
  assert.equal(await cout({ preset: 'quality' }), D.mesh_quality + 1);
  assert.equal(await cout({ preset: 'ultra_8k' }), D.mesh_ultra_8k + 1);
});
test('creditCost : sans palier ni mode, c\'est le palier fast', async () => {
  assert.equal(await cout({}), await cout({ preset: 'fast' }));
});
test('creditCost : mode full sans palier ne coute jamais moins que quality', async () => {
  assert.ok(await cout({ mode: 'full' }) >= D.mesh_quality);
  assert.equal(await cout({ mode: 'full', preset: 'fast' }), await cout({ preset: 'fast' }), 'avec un palier explicite, mode full n\'ajoute rien');
});
test('creditCost : chaque option s\'ajoute a son prix de grille', async () => {
  const base = await cout({ preset: 'fast' });
  assert.equal(await cout({ preset: 'fast', rectify: true }) - base, D.mesh_rectify);
  assert.equal(await cout({ preset: 'fast', smooth: true }) - base, D.mesh_smooth);
  assert.equal(await cout({ preset: 'fast', multiref: true }) - base, D.mesh_multiref);
  assert.equal(await cout({ preset: 'fast', ultra_q: true }) - base, D.mesh_ultra_q);
  assert.equal(await cout({ preset: 'fast', quality_plus: true }) - base, D.mesh_quality_plus);
  assert.equal(await cout({ preset: 'fast', ultra_hd: true }) - base, D.mesh_ultra_hd);
});
test('creditCost : ultra_q l\'emporte sur quality_plus (jamais facture deux fois)', async () => {
  assert.equal(await cout({ preset: 'fast', ultra_q: true, quality_plus: true }), await cout({ preset: 'fast', ultra_q: true }));
});
test('creditCost : ultra_hd est INCLUS dans le palier ultra_8k (pas de double facturation)', async () => {
  assert.equal(await cout({ preset: 'ultra_8k', ultra_hd: true }), await cout({ preset: 'ultra_8k' }));
});
test('creditCost : refine et face_fix sont suspendus cote cloud : ignores ET non factures, et le champ est remis a faux', async () => {
  assert.deepEqual([...P.OPTIONS_SANS_EFFET_CLOUD], ['refine', 'face_fix']);
  const i = { preset: 'fast', refine: true, face_fix: true };
  const n = await silence(async () => { P._invalidatePricingCache(); return P.creditCost({ MESHES: creerR2() }, i); })();
  assert.equal(n, D.mesh_fast + 1);
  assert.equal(i.refine, false); assert.equal(i.face_fix, false);
});
test('creditCost : le supplement Max triangles suit la courbe (50 K=socle, 500 K=1, 1 M=3, 3 M=11, 10 M=50 a 130 %)', async () => {
  const base = D.mesh_fast;
  const sup = async (t) => (await cout({ preset: 'fast', max_tris: t })) - base;
  assert.equal(await sup(50_000), 1);
  assert.equal(await sup(500_000), 1);
  assert.equal(await sup(1_000_000), 3);
  assert.equal(await sup(3_000_000), 11);
  assert.equal(await sup(10_000_000), 50);
});
test('creditCost : le prix croit avec le nombre de triangles (jamais decroissant)', async () => {
  let prec = 0;
  for (const t of [5_000, 100_000, 500_000, 750_000, 1_000_000, 2_000_000, 5_000_000, 10_000_000]) {
    const n = await cout({ preset: 'balanced', max_tris: t }); assert.ok(n >= prec, `${t}`); prec = n;
  }
});
test('creditCost : resultat toujours un entier strictement positif', async () => {
  for (const preset of [undefined, 'fast', 'balanced', 'quality', 'ultra_8k', 'inconnu'])
    for (const max_tris of [undefined, 1, 5_000, 10_000_000]) {
      const n = await cout({ preset, max_tris, rectify: true, smooth: true, multiref: true });
      assert.ok(Number.isInteger(n) && n > 0, `${preset}/${max_tris}=${n}`);
    }
});
test('_supplementTriangles : formule, socle, courbure et tolerance d\'arrondi', () => {
  assert.equal(P._supplementTriangles(500_000, 1), 1);
  assert.equal(P._supplementTriangles(1_000_000, 1, 0, 100), 2);       // lineaire
  assert.equal(P._supplementTriangles(1_000_000, 1, 0, 130), 3);       // 2^1,3 = 2,46 -> 3
  assert.equal(P._supplementTriangles(10_000, 1, 1, 130), 1, 'le socle');
  assert.equal(P._supplementTriangles(10_000, 1, 0, 130), 1, 'arrondi au-dessus : tout triangle > 0 coute au moins 1 meme sans socle');
  assert.equal(P._supplementTriangles(0, 1, 0, 130), 0, 'zero triangle, zero credit');
  assert.equal(P._supplementTriangles(1_000_000, 1, 0, 50), 2, 'une courbure < 100 est ramenee a lineaire (jamais sous-lineaire)');
});

test('_getPricing : sans surcharge R2, la grille du code', async () => {
  P._invalidatePricingCache();
  const p = await P._getPricing({ MESHES: creerR2() });
  assert.deepEqual(p, D);
});
test('_getPricing : une surcharge R2 valide s\'applique (arrondie a l\'entier inferieur)', async () => {
  P._invalidatePricingCache();
  const p = await P._getPricing({ MESHES: creerR2({ '_meta/pricing.json': JSON.stringify({ text2image: 9.9, modify: 4 }) }) });
  assert.equal(p.text2image, 9); assert.equal(p.modify, 4); assert.equal(p.rig, D.rig);
});
test('_getPricing : une surcharge mesh_* SOUS le plancher du code est ignoree', async () => {
  P._invalidatePricingCache();
  const p = await silence(() => P._getPricing({ MESHES: creerR2({ '_meta/pricing.json': JSON.stringify({ mesh_fast: 1, mesh_quality: 2, mesh_ultra_8k: 8 }) }) }))();
  assert.equal(p.mesh_fast, D.mesh_fast); assert.equal(p.mesh_quality, D.mesh_quality); assert.equal(p.mesh_ultra_8k, D.mesh_ultra_8k);
});
test('_getPricing : une surcharge mesh_* AU-DESSUS du plancher passe', async () => {
  P._invalidatePricingCache();
  const p = await P._getPricing({ MESHES: creerR2({ '_meta/pricing.json': JSON.stringify({ mesh_fast: D.mesh_fast + 3 }) }) });
  assert.equal(p.mesh_fast, D.mesh_fast + 3);
});
test('_getPricing : valeurs invalides (negatif, texte, null, Infinity) ignorees ; zero accepte hors mesh_', async () => {
  P._invalidatePricingCache();
  const p = await P._getPricing({ MESHES: creerR2({ '_meta/pricing.json': '{"rig":-5,"reskin":"12","anim":null,"export":0,"upscale":1e999}' }) });
  assert.equal(p.rig, D.rig); assert.equal(p.reskin, D.reskin); assert.equal(p.anim, D.anim); assert.equal(p.export, 0); assert.equal(p.upscale, D.upscale);
});
test('_getPricing : fichier R2 illisible -> grille du code (jamais d\'exception)', async () => {
  P._invalidatePricingCache();
  const p = await P._getPricing({ MESHES: creerR2({ '_meta/pricing.json': '{pas du json' }) });
  assert.deepEqual(p, D);
});
test('_getPricing : memoire 60 s (une seconde lecture ne relit pas R2)', async () => {
  P._invalidatePricingCache();
  const r2 = creerR2({ '_meta/pricing.json': JSON.stringify({ modify: 4 }) });
  await P._getPricing({ MESHES: r2 });
  r2.ecrire('_meta/pricing.json', JSON.stringify({ modify: 99 }));
  assert.equal((await P._getPricing({ MESHES: r2 })).modify, 4, 'memoire');
  P._invalidatePricingCache();
  assert.equal((await P._getPricing({ MESHES: r2 })).modify, 99, 'apres invalidation');
});

test('_prixImageSelonPas : au prorata de 30 pas, jamais moins d\'un credit', () => {
  assert.equal(P._prixImageSelonPas(6, 30), 6);
  assert.equal(P._prixImageSelonPas(6, 10), 2);
  assert.equal(P._prixImageSelonPas(6, 60), 12);
  assert.equal(P._prixImageSelonPas(6, 4), 1);
  assert.equal(P._prixImageSelonPas(6, 0), 1);
});
test('_decomposerMeshAuPrix / _creditsMeshAuPrix : meme total que creditCost', async () => {
  for (const o of [{ preset: 'fast' }, { preset: 'quality', rectify: true, smooth: true }, { preset: 'ultra_8k', ultra_hd: true, max_tris: 2_000_000 }, { preset: 'balanced', ultra_q: true, quality_plus: true }]) {
    assert.equal(P._creditsMeshAuPrix(o, D), await cout(o), JSON.stringify(o));
  }
});
test('_creditsAuPrixActuel : recompte des travaux anciens au prix d\'aujourd\'hui', () => {
  assert.equal(P._creditsAuPrixActuel('text2image', 'text2image', { pas: 30 }, 3, D), 6);
  assert.equal(P._creditsAuPrixActuel('text2image', 'text2image', {}, 3, D), 6, 'sans pas : au prorata 3 -> 6');
  assert.equal(P._creditsAuPrixActuel('back-view', 'back-view', { n: 2 }, 3, D), 12);
  assert.equal(P._creditsAuPrixActuel('back-view', 'back-view', { n: 99 }, 3, D), 24, 'plafonne a 4 vues');
  assert.equal(P._creditsAuPrixActuel('rectify', 'rectify', {}, 0, D), 0, 'rectify interne non facture');
  assert.equal(P._creditsAuPrixActuel('outfit', 'outfit', { completer: true }, 3, D), D.outfit_complete);
  assert.equal(P._creditsAuPrixActuel('outfit', 'outfit', {}, 3, D), D.outfit);
  assert.equal(P._creditsAuPrixActuel('rig', 'rig', { squelette_impose: true }, 1, D), D.reskin);
  assert.equal(P._creditsAuPrixActuel('rig', 'rig', {}, 1, D), D.rig);
  assert.equal(P._creditsAuPrixActuel('retexture', 'retexture', { preset: 'inconnu' }, 1, D), D.retex_fast);
  assert.equal(P._creditsAuPrixActuel('operation-inconnue', 'x', {}, 7, D), 7, 'cle inconnue : le prix enregistre');
});

/* ---------- credits : addCredits / spendCredits ---------- */
const C = chargerFonctions(['addCredits', 'spendCredits', 'isMock'], { supabaseAdmin: (env) => env.__sb, mock: { add: async () => 'mock-add', spend: async () => 'mock-spend' } });
const envSb = (rpcs) => ({ __sb: creerSupabase({}, rpcs) });

test('addCredits : appelle la fonction SQL add_credits et rend le nouveau solde', async () => {
  const env = envSb({ add_credits: ({ p_user_id, p_amount }) => ({ data: 100 + p_amount, error: null }) });
  assert.equal(await C.addCredits(env, 'u1', 25), 125);
  assert.deepEqual(env.__sb.journal, [{ nom: 'add_credits', args: { p_user_id: 'u1', p_amount: 25 } }]);
});
test('spendCredits : appelle spend_credits et rend le solde restant', async () => {
  const env = envSb({ spend_credits: () => ({ data: 7, error: null }) });
  assert.equal(await C.spendCredits(env, 'u1', 3), 7);
  assert.deepEqual(env.__sb.journal, [{ nom: 'spend_credits', args: { p_user_id: 'u1', p_amount: 3 } }]);
});
test('addCredits / spendCredits : erreur SQL ou reponse vide -> null (jamais une exception, jamais un solde invente)', async () => {
  for (const reponse of [{ data: null, error: { message: 'x' } }, { data: 5, error: { message: 'x' } }, { data: null, error: null }]) {
    const env = envSb({ add_credits: () => reponse, spend_credits: () => reponse });
    assert.equal(await C.addCredits(env, 'u1', 5), null);
    assert.equal(await C.spendCredits(env, 'u1', 5), null);
  }
});
test('spendCredits : un solde de 0 est un succes (data=0 ne doit pas etre pris pour un echec)', async () => {
  assert.equal(await C.spendCredits(envSb({ spend_credits: () => ({ data: 0, error: null }) }), 'u1', 3), 0);
});
test('addCredits / spendCredits : en mode MOCK, ni Supabase ni SQL', async () => {
  const env = { MOCK: '1', __sb: creerSupabase() };
  assert.equal(await C.addCredits(env, 'u1', 1), 'mock-add'); assert.equal(await C.spendCredits(env, 'u1', 1), 'mock-spend');
  assert.equal(env.__sb.journal.length, 0);
  assert.equal((await chargerFonctions(['isMock']).isMock({ NEXT_PUBLIC_MOCK: '1' })), true);
  assert.equal(chargerFonctions(['isMock']).isMock({ MOCK: '0' }), false);
});

/* ---------- paiements : tables pures ---------- */
// DIFFERENCE VOULUE de la vague 1 (CLOUD-01) : decisionPriseEnCharge n'existe pas dans HEAD (la decision etait ecrite en ligne dans _traiterPaiement).
const DECISION_PRESENTE = existe('decisionPriseEnCharge');
const S = chargerFonctions(['PACKS', '_packPayout', 'SELLER_CREDITS_PER_EUR', 'SELLER_CREDIT_BONUS_PCT', '_sellerPayoutCredits', ...(DECISION_PRESENTE ? ['decisionPriseEnCharge'] : [])]);
test('PACKS : credits et euros positifs, pack payant plus avantageux que le precedent', () => {
  const pay = ['starter', 'pro', 'studio'].map((k) => S.PACKS[k]);
  for (const p of Object.values(S.PACKS)) { assert.ok(p.credits > 0 && p.euros > 0); }
  const ratio = pay.map((p) => p.credits / p.euros);
  assert.ok(ratio[0] < ratio[1] && ratio[1] < ratio[2], 'prix au credit decroissant : ' + ratio);
  assert.deepEqual(pay.map((p) => [p.euros, p.credits]), [[5, 25], [20, 120], [50, 350]]);
  assert.deepEqual(['sub_starter', 'sub_pro', 'sub_studio'].map((k) => [S.PACKS[k].euros, S.PACKS[k].credits]), [[5, 30], [15, 100], [40, 300]]);
});
test('_packPayout : lu dans la table du serveur, jamais dans la requete ; pack inconnu -> null', () => {
  assert.deepEqual(S._packPayout('studio'), { credits: 350, eur: 50 });
  assert.equal(S._packPayout('inconnu'), null); assert.equal(S._packPayout(null), null); assert.equal(S._packPayout(undefined), null);
  // Cles heritees d'Object.prototype : l'implementation actuelle rend un objet SANS montant (credits indefini) ; ce qui compte est qu'aucun montant creditable n'en sorte.
  for (const k of ['__proto__', 'constructor', 'toString']) assert.ok(!Number.isFinite(S._packPayout(k)?.credits), k);
});
test('_sellerPayoutCredits : 7 credits/EUR + bonus 20 % (arrondi) ; zero centime -> zero credit ; jamais negatif', () => {
  assert.equal(S.SELLER_CREDITS_PER_EUR, 7); assert.equal(S.SELLER_CREDIT_BONUS_PCT, 20);
  assert.equal(S._sellerPayoutCredits(100), 8);     // 1 EUR : 8,4
  assert.equal(S._sellerPayoutCredits(1000), 84);   // 10 EUR
  assert.equal(S._sellerPayoutCredits(5000), 420);
  assert.equal(S._sellerPayoutCredits(0), 0);
  assert.ok(S._sellerPayoutCredits(1) >= 0);
});
test('decisionPriseEnCharge : table de decision de l\'encaissement idempotent (CLOUD-01 : absente de HEAD, voulue)', () => {
  if (!DECISION_PRESENTE) { assert.equal(existe('MSG_PAIEMENT_REMBOURSE'), false, 'HEAD : ni la decision pure ni son message n\'existent'); return; }
  const d = S.decisionPriseEnCharge;
  assert.equal(d(null), 'a_creer'); assert.equal(d(undefined), 'a_creer');
  assert.equal(d({ credits: 350 }), 'deja_credite');
  assert.equal(d({ credits: 350, credits_origine: 350 }), 'deja_credite');
  assert.equal(d({ credits: 0, credits_origine: 0 }), 'rembourse', 'origine = 0 est renseignee');
  assert.equal(d({ credits: 0, credits_origine: 350 }), 'rembourse');
  assert.equal(d({ credits: 0, credits_origine: null }), 'a_reprendre');
  assert.equal(d({ credits: 0 }), 'a_reprendre');
  assert.equal(d({}), 'a_reprendre');
});

/* ---------- remboursement d'un travail echoue : exactement une fois ---------- */
function mondeJobs(job) {
  const sb = creerSupabase({ jobs: [job] });
  const credits = [];
  const annulations = [];
  const f = chargerFonctions(['_failAndRefundJob', 'NON_TERMINAL_JOB_STATUSES', 'TYPES_JOB_ASYNC'],
    { supabaseAdmin: () => sb, addCredits: async (_e, uid, n) => { credits.push([uid, n]); return 1; }, _cancelModalJob: async (_e, id, t) => { annulations.push([id, t]); } });
  return { sb, credits, annulations, ...f };
}
test('_failAndRefundJob : un travail en cours est marque failed et rembourse du credit_cost', async () => {
  const m = mondeJobs({ id: 'j1', user_id: 'u1', credit_cost: 18, status: 'processing', type: 'mesh' });
  assert.equal(await m._failAndRefundJob({}, { id: 'j1', user_id: 'u1', credit_cost: 18, type: 'mesh' }, 'boom'), true);
  assert.deepEqual(m.credits, [['u1', 18]]);
  assert.equal(m.sb.tables.jobs[0].status, 'failed'); assert.equal(m.sb.tables.jobs[0].error, 'boom');
});
test('_failAndRefundJob : EXACTEMENT UNE FOIS (le deuxieme appel ne rembourse plus)', async () => {
  const m = mondeJobs({ id: 'j1', user_id: 'u1', credit_cost: 18, status: 'queued', type: 'mesh' });
  const job = { id: 'j1', user_id: 'u1', credit_cost: 18, type: 'mesh' };
  const r = await Promise.all([m._failAndRefundJob({}, job, 'a'), m._failAndRefundJob({}, job, 'b'), m._failAndRefundJob({}, job, 'c')]);
  // le faux Supabase est synchrone par tour : un seul appel revendique la ligne
  assert.equal(r.filter(Boolean).length, 1);
  assert.equal(m.credits.length, 1);
  assert.equal(m.annulations.length, 1, 'le conteneur n\'est arrete qu\'une fois');
});
test('_failAndRefundJob : un travail deja termine (done / failed / canceled) n\'est JAMAIS rembourse', async () => {
  for (const status of ['done', 'succeeded', 'failed', 'canceled', 'completed']) {
    const m = mondeJobs({ id: 'j1', user_id: 'u1', credit_cost: 18, status, type: 'mesh' });
    assert.equal(await m._failAndRefundJob({}, { id: 'j1', user_id: 'u1', credit_cost: 18, type: 'mesh' }, 'x'), false, status);
    assert.equal(m.credits.length, 0, status);
  }
});
test('_failAndRefundJob : tous les statuts non terminaux sont reclamables (queued et starting compris)', async () => {
  const m0 = mondeJobs({ id: 'x', status: 'queued' });
  assert.deepEqual([...m0.NON_TERMINAL_JOB_STATUSES], ['queued', 'starting', 'running', 'processing', 'pending']);
  for (const status of m0.NON_TERMINAL_JOB_STATUSES) {
    const m = mondeJobs({ id: 'j1', user_id: 'u1', credit_cost: 5, status, type: 'text2image' });
    assert.equal(await m._failAndRefundJob({}, { id: 'j1', user_id: 'u1', credit_cost: 5, type: 'text2image' }, 'x'), true, status);
    assert.equal(m.credits.length, 1, status);
  }
});
test('_failAndRefundJob : pas de credit_cost numerique ou pas de user_id -> echec marque mais rien rembourse', async () => {
  const m = mondeJobs({ id: 'j1', user_id: 'u1', credit_cost: '18', status: 'processing', type: 'mesh' });
  assert.equal(await m._failAndRefundJob({}, { id: 'j1', user_id: 'u1', credit_cost: '18', type: 'mesh' }, 'x'), true);
  assert.equal(m.credits.length, 0, 'une chaine n\'est pas un montant');
});
test('_failAndRefundJob : le conteneur n\'est arrete que pour les familles asynchrones', async () => {
  const m0 = mondeJobs({ id: 'x', status: 'queued' });
  assert.deepEqual([...m0.TYPES_JOB_ASYNC].sort(), ['animate', 'animate_fbx', 'mesh', 'rig', 'segment']);
  for (const [type, attendu] of [['mesh', 1], ['rig', 1], ['text2image', 0], ['rectify', 0], ['back-view', 0], [undefined, 0]]) {
    const m = mondeJobs({ id: 'j1', user_id: 'u1', credit_cost: 1, status: 'processing', type });
    await m._failAndRefundJob({}, { id: 'j1', user_id: 'u1', credit_cost: 1, type }, 'x');
    assert.equal(m.annulations.length, attendu, String(type));
  }
});
test('_failAndRefundJob : le message d\'erreur est borne a 500 caracteres', async () => {
  const m = mondeJobs({ id: 'j1', user_id: 'u1', credit_cost: 1, status: 'processing', type: 'mesh' });
  await m._failAndRefundJob({}, { id: 'j1', user_id: 'u1', credit_cost: 1, type: 'mesh' }, 'x'.repeat(5000));
  assert.equal(m.sb.tables.jobs[0].error.length, 500);
});

/* ---------- remboursement des triangles non livres ---------- */
function mondeTris() {
  const sb = creerSupabase({ jobs: [{ id: 'j1', credit_cost: 28, options: {} }] });
  const credits = [];
  const f = chargerFonctions(['_rembourserTrianglesNonLivres', '_supplementTriangles'], { supabaseAdmin: () => sb, addCredits: async (_e, uid, n) => { credits.push([uid, n]); } });
  return { sb, credits, ...f };
}
const optsTris = { max_tris: 3_000_000, tris_supplement: 11, tris_prix_tranche: 1, tris_prix_socle: 1, tris_courbe_pct: 130 };
test('_rembourserTrianglesNonLivres : le moteur livre moins que demande -> les tranches non livrees sont rendues', async () => {
  const m = mondeTris();
  await silence(m._rembourserTrianglesNonLivres)({}, { id: 'j1', user_id: 'u1', credit_cost: 28, options: { ...optsTris } }, 1_000_000);
  assert.deepEqual(m.credits, [['u1', 8]], '11 payes - 3 dus pour 1 M');
  const o = m.sb.tables.jobs[0].options;
  assert.equal(o.tris_rendu, 8); assert.equal(o.tris_livres, 1_000_000); assert.equal(m.sb.tables.jobs[0].credit_cost, 20);
});
test('_rembourserTrianglesNonLivres : idempotent (options.tris_rendu deja pose) et jamais de credit negatif', async () => {
  const m = mondeTris();
  await silence(m._rembourserTrianglesNonLivres)({}, { id: 'j1', user_id: 'u1', credit_cost: 20, options: { ...optsTris, tris_rendu: 8 } }, 1_000_000);
  assert.equal(m.credits.length, 0);
  await silence(m._rembourserTrianglesNonLivres)({}, { id: 'j1', user_id: 'u1', credit_cost: 28, options: { ...optsTris } }, 10_000_000);
  assert.equal(m.credits.length, 0, 'livre plus que demande : rien a rendre');
});
test('_rembourserTrianglesNonLivres : donnees absentes (faces, supplement, prix) -> aucun mouvement', async () => {
  for (const [faces, opts] of [[null, optsTris], [0, optsTris], [1e6, { ...optsTris, tris_supplement: 0 }], [1e6, { ...optsTris, tris_prix_tranche: 0 }], [1e6, { ...optsTris, max_tris: 0 }]]) {
    const m = mondeTris();
    await silence(m._rembourserTrianglesNonLivres)({}, { id: 'j1', user_id: 'u1', credit_cost: 28, options: { ...opts } }, faces);
    assert.equal(m.credits.length, 0);
  }
});
test('_rembourserTrianglesNonLivres : une panne de base ne remonte jamais d\'exception', async () => {
  const f = chargerFonctions(['_rembourserTrianglesNonLivres', '_supplementTriangles'], { supabaseAdmin: () => { throw new Error('base HS'); }, addCredits: async () => { throw new Error('rpc HS'); } });
  await silence(f._rembourserTrianglesNonLivres)({}, { id: 'j1', user_id: 'u1', credit_cost: 28, options: { ...optsTris } }, 1_000_000);
});

test('garde-fou du filet : les declarations testees existent bien dans cet exemplaire de worker.ts', () => {
  for (const n of ['creditCost', 'addCredits', 'spendCredits', '_failAndRefundJob', '_getPricing', '_rembourserTrianglesNonLivres']) assert.ok(existe(n), n);
});
