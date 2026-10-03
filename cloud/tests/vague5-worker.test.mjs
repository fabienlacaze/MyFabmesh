// Tests de la voie « worker-reste » (vague 5, 03/10/2026) : W-1 plafond de securite des comptes payants (IA-06 / FIN-03 / FIN-07),
// W-2 lot boutique (SM-01, SM-06, SM-10 / MP-06, MP-11, SM-03, MP-03), W-3 adresses IP tronquees et compteurs hachés (D-05 / D-07).
// Charge les VRAIES fonctions de cloud/src/worker.ts (transpilees) avec des doublures (faux R2, faux Supabase, faux fetch) : aucun appel reseau.
// Lancer : cd cloud && node --test tests/vague5-worker.test.mjs
// Ancien code (prouver qu'un test ECHOUE dessus) : git show HEAD:cloud/src/worker.ts > <tmp>/worker_HEAD.ts ; WORKER_SRC=<tmp>/worker_HEAD.ts node --test tests/vague5-worker.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chargerFonctions, creerR2, creerSupabase, existe } from './_charge-w3.mjs';

/** Charge `noms` (ceux que l'exemplaire teste ne declare pas sont ignores : sur l'ancien code les tests echouent par COMPORTEMENT, pas par chargement). */
const charger = (noms, doublures = {}) => chargerFonctions(noms.filter((n) => existe(n)), doublures);
const COMMUN = ['err', 'json', 'SECURITY_HEADERS', 'isMock', '_plafond', '_attenteBruitee', '_casIncrementCounter', '_incrementAtomique', 'r2GetText', 'todayUTC', '_isoNow'];
const lire = async (rep) => JSON.parse(await rep.text());

/* ═══════════════════════ W-1 : plafond de securite des comptes payants (IA-06 / FIN-03 / FIN-07) ═══════════════════════ */
const PAYANT = '7c1d9e20-aaaa-4bbb-8ccc-0123456789ab';
const GRATUIT = '11111111-bbbb-4ccc-8ddd-222222222222';
const NOMS_W1 = [...COMMUN, 'DEFAULT_MAX_USER_DAILY_SPEND_USD', 'DEFAULT_MAX_MODAL_SPEND_USD', 'DEFAULT_MAX_PAID_USER_DAILY_SPEND_USD', 'DEFAULT_PAID_USER_SPEND_ALERT_USD',
  '_cleSpendUser', '_cleCapUser', 'checkAndIncrementUserDailySpend', 'decisionPlafondPayant', 'refusVientDuPlafondPayant', 'texteAlerteComptePayant',
  '_alerterComptePayant', '_depensePayanteAvecPlafond', 'checkAndIncrementModalSpend', 'refundModalSpend', '_spendRefusalMessage'];

function monde(payants = [PAYANT], envExtra = {}) {
  const r2 = creerR2();
  const courriels = [];
  const env = { MESHES: r2, ...envExtra };
  const w = charger(NOMS_W1, {
    _budgetReelEpuise: async () => false,
    _limiteCalculAtteinte: async () => false,
    _isPaidAccount: async (_e, uid) => payants.includes(uid),
    _sendAdminAlertEmail: async (_e, sujet, texte) => { courriels.push({ sujet, texte }); },
  });
  const depense = (uid) => parseFloat(r2.lire(`_meta/userspend/${uid}/${new Date().toISOString().slice(0, 10)}`) ?? '0');
  const global = () => parseFloat(r2.lire(`_meta/modal_spend/${new Date().toISOString().slice(0, 10)}`) ?? '0');
  return { w, env, r2, courriels, depense, global };
}

test('W-1 decision pure : sous le plafond, au-dessus, zero, alerte', () => {
  const { w } = monde();
  assert.deepEqual(w.decisionPlafondPayant(0, 1, 15, 5), { refuser: false, apres: 1, alerter: false });
  assert.equal(w.decisionPlafondPayant(4.5, 1, 15, 5).alerter, true, 'franchit le seuil d alerte');
  assert.equal(w.decisionPlafondPayant(14.5, 1, 15, 5).refuser, true, 'depasserait le plafond');
  assert.equal(w.decisionPlafondPayant(14, 1, 15, 5).refuser, false, 'exactement au plafond = permis');
  assert.equal(w.decisionPlafondPayant(0, 0.01, 0, 5).refuser, true, 'zero = on coupe vraiment');
  assert.equal(w.decisionPlafondPayant(0, 0, 0, 5).refuser, true, 'zero coupe meme une depense nulle');
  assert.equal(w.decisionPlafondPayant(100, 1, 15, 0).alerter, false, 'seuil 0 = alerte desactivee');
  assert.equal(w.decisionPlafondPayant('x', 'y', 15, 5).refuser, false, 'entrees non numeriques traitees comme 0');
});

test('W-1 compte GRATUIT : le rationnement de 2 $ est inchange (et n est pas le plafond de securite)', async () => {
  const m = monde([PAYANT], { MAX_DAILY_MODAL_SPEND_USD: '100' });
  assert.notEqual(await m.w.checkAndIncrementModalSpend(m.env, 1.5, GRATUIT), null);
  assert.equal(await m.w.checkAndIncrementModalSpend(m.env, 1.0, GRATUIT), null, 'au-dela de 2 $ : refuse');
  assert.equal(m.courriels.length, 0, 'aucune alerte pour un compte gratuit');
});

test('W-1 compte PAYANT sous le seuil d alerte : accepte, compte, aucun courriel', async () => {
  const m = monde();
  for (let i = 0; i < 4; i++) assert.notEqual(await m.w.checkAndIncrementModalSpend(m.env, 0.9, PAYANT), null);
  assert.equal(m.depense(PAYANT).toFixed(2), '3.60');
  assert.equal(m.global().toFixed(2), '3.60');
  assert.equal(m.courriels.length, 0);
});

test('W-1 compte PAYANT qui franchit l alerte : UN seul courriel par jour, sans donnee personnelle', async () => {
  const m = monde();
  for (let i = 0; i < 8; i++) assert.notEqual(await m.w.checkAndIncrementModalSpend(m.env, 1, PAYANT), null);   // 8 $ > 5 $
  assert.equal(m.courriels.length, 1, 'une seule alerte pour le compte et le jour');
  const { sujet, texte } = m.courriels[0];
  assert.ok((sujet + texte).includes(PAYANT.slice(0, 8)), 'les 8 premiers caracteres de l identifiant');
  assert.ok(!(sujet + texte).includes(PAYANT), 'jamais l identifiant complet');
  assert.ok(!/@/.test(sujet + texte), 'jamais d adresse e-mail');
  assert.match(texte, /\d{4}-\d{2}-\d{2}T/, 'l heure figure');
  assert.match(sujet + texte, /5\.\d\d|6\.00|\$/, 'un montant figure');
  assert.ok(m.r2.lire(`_meta/alerte_payant/${new Date().toISOString().slice(0, 10)}/${PAYANT}`), 'marqueur R2 pose');
});

test('W-1 compte PAYANT au-dessus du plafond de securite : refuse, RIEN n est incremente', async () => {
  const m = monde();
  for (let i = 0; i < 7; i++) assert.notEqual(await m.w.checkAndIncrementModalSpend(m.env, 2, PAYANT), null);   // 14 $
  const avant = { u: m.depense(PAYANT), g: m.global() };
  assert.equal(await m.w.checkAndIncrementModalSpend(m.env, 2, PAYANT), null, '14 + 2 > 15');
  assert.equal(m.depense(PAYANT), avant.u, 'compteur du compte inchange par le refus');
  assert.equal(m.global(), avant.g, 'compteur global inchange par le refus');
  assert.notEqual(await m.w.checkAndIncrementModalSpend(m.env, 1, PAYANT), null, '14 + 1 = 15 est encore permis');
});

test('W-1 le plafond est reglable et le ZERO coupe vraiment', async () => {
  const m = monde([PAYANT], { MAX_PAID_USER_DAILY_SPEND_USD: '0' });
  assert.equal(await m.w.checkAndIncrementModalSpend(m.env, 0.5, PAYANT), null, '0 = coupe, ce n est pas « retomber sur 15 »');
  const m2 = monde([PAYANT], { MAX_PAID_USER_DAILY_SPEND_USD: '3' });
  assert.notEqual(await m2.w.checkAndIncrementModalSpend(m2.env, 2, PAYANT), null);
  assert.equal(await m2.w.checkAndIncrementModalSpend(m2.env, 2, PAYANT), null, '2 + 2 > 3');
});

test('W-1 un remboursement RENDS le plafond', async () => {
  const m = monde();
  for (let i = 0; i < 7; i++) await m.w.checkAndIncrementModalSpend(m.env, 2, PAYANT);                  // 14 $
  assert.equal(await m.w.checkAndIncrementModalSpend(m.env, 5, PAYANT), null);
  await m.w.refundModalSpend(m.env, 10, PAYANT);                                                          // travaux rates : 10 $ rendus
  assert.equal(m.depense(PAYANT), 4);
  assert.notEqual(await m.w.checkAndIncrementModalSpend(m.env, 5, PAYANT), null, 'apres remboursement le compte peut a nouveau travailler');
});

test('W-1 le message de refus nomme le plafond de securite pour un compte payant, et reste celui des comptes gratuits sinon', async () => {
  const m = monde();
  for (let i = 0; i < 7; i++) await m.w.checkAndIncrementModalSpend(m.env, 2, PAYANT);                   // 14 $ sur 15
  const msg = await m.w._spendRefusalMessage(m.env, PAYANT);
  assert.match(msg, /safety limit/i, msg);
  assert.doesNotMatch(msg, /free accounts/i, 'ne doit pas nommer le plafond des comptes gratuits');
  assert.match(msg, /midnight UTC/, 'la page remplace « midnight UTC » par l heure locale');
  assert.match(msg, /not charged/);
  const mg = monde([PAYANT], { MAX_DAILY_MODAL_SPEND_USD: '100' });
  await mg.w.checkAndIncrementModalSpend(mg.env, 1.9, GRATUIT);
  assert.match(await mg.w._spendRefusalMessage(mg.env, GRATUIT), /free accounts/i, 'comptes gratuits : message inchange');
});

test('W-1 les comptes sont comptes separement (un compte payant plafonne n empeche pas un autre)', async () => {
  const AUTRE = '99999999-cccc-4ddd-8eee-333333333333';
  const m = monde([PAYANT, AUTRE]);
  for (let i = 0; i < 7; i++) await m.w.checkAndIncrementModalSpend(m.env, 2, PAYANT);
  assert.equal(await m.w.checkAndIncrementModalSpend(m.env, 2, PAYANT), null);
  assert.notEqual(await m.w.checkAndIncrementModalSpend(m.env, 2, AUTRE), null);
});

/* ═══════════════════════ W-2 : lot boutique ═══════════════════════ */
const SITE_ENV = { NEXT_PUBLIC_SITE_URL: 'https://site.example' };
const VENDEUR = '3f2b8c1e-aaaa-4bbb-8ccc-111111111111';
const AUTRE_VENDEUR = '9d1e7a55-bbbb-4ccc-8ddd-222222222222';
const ACHETEUR = '55555555-cccc-4ddd-8eee-555555555555';
const fiche = (o = {}) => ({ id: 'L1', job_id: null, user_id: VENDEUR, author_email: null, author_display: 'x', title: 'T', description: 'D', price_cents: 500, currency: 'EUR',
  licence: 'personal', asset_kind: 'mesh', asset_type: null, asset_url: 'u/mesh/a.glb', mesh_url: 'u/mesh/a.glb', thumbnail_url: null, status: 'approved',
  created_at: '2026-09-01T00:00:00Z', approved_at: '2026-09-02T00:00:00Z', downloads: 0, ...o });

/** Fabrique un GLB minimal (en-tete + chunk JSON + chunk BIN vide) a partir d'un objet glTF. */
function glb(json, { binaire = 8 } = {}) {
  let t = JSON.stringify(json); while (t.length % 4) t += ' ';
  const jsonB = new TextEncoder().encode(t);
  const total = 12 + 8 + jsonB.length + 8 + binaire;
  const b = new Uint8Array(total); const dv = new DataView(b.buffer);
  dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jsonB.length, true); dv.setUint32(16, 0x4E4F534A, true); b.set(jsonB, 20);
  dv.setUint32(20 + jsonB.length, binaire, true); dv.setUint32(24 + jsonB.length, 0x004E4942, true);
  return b;
}
const gltfIndexe = (nbIndices, extra = {}) => ({ asset: { version: '2.0' }, accessors: [{ count: nbIndices }, { count: 5000 }], nodes: [{ mesh: 0 }],
  meshes: [{ primitives: [{ attributes: { POSITION: 1 }, indices: 0 }] }], ...extra });

/* ── SM-01 : l'apercu d'une fiche payante est une copie legere, statique ── */
test('SM-01 inspecterGlbApercu : indices / 3, positions / 3, bandes, instances, peaux, animations, fichier illisible', () => {
  const w = charger(['inspecterGlbApercu', 'APERCU_PAYANT_MAX_TRIANGLES']);
  assert.equal(w.APERCU_PAYANT_MAX_TRIANGLES, 30000);
  assert.deepEqual(w.inspecterGlbApercu(glb(gltfIndexe(90000))), { ok: true, triangles: 30000, skins: 0, animations: 0 });
  const nonIndexe = { asset: {}, accessors: [{ count: 300 }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }] };
  assert.equal(w.inspecterGlbApercu(glb(nonIndexe)).triangles, 100, 'sans indices : positions / 3');
  const bande = { asset: {}, accessors: [{ count: 12 }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 5 }, { attributes: { POSITION: 0 }, mode: 1 }] }] };
  assert.equal(w.inspecterGlbApercu(glb(bande)).triangles, 10, 'bande : n-2 ; lignes : 0');
  const instances = gltfIndexe(30000, { nodes: [{ mesh: 0 }, { mesh: 0 }, { mesh: 0 }] });
  assert.equal(w.inspecterGlbApercu(glb(instances)).triangles, 30000, '3 instances x 10 000 triangles');
  const avecPeau = w.inspecterGlbApercu(glb(gltfIndexe(30, { skins: [{ joints: [0] }], animations: [{}, {}] })));
  assert.equal(avecPeau.skins, 1); assert.equal(avecPeau.animations, 2);
  for (const mauvais of [new Uint8Array(10), new TextEncoder().encode('glTF' + 'x'.repeat(40)), glb({ asset: {}, accessors: [], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 3 } }] }] })]) {
    assert.deepEqual(w.inspecterGlbApercu(mauvais), { ok: false }, 'illisible ou accesseur manquant : refus');
  }
});

function mondeUpload(listing, user = VENDEUR) {
  const r2 = creerR2({ '_market/listings/L1.json': JSON.stringify(listing) });
  const env = { MESHES: r2 };
  const w = charger([...COMMUN, '_typeOctets', 'APERCU_PREFIXE', 'APERCU_PAYANT_MAX_TRIANGLES', 'inspecterGlbApercu', '_marquerApercu', 'handleMarketPreviewUpload', 'handleMarketPosterUpload'],
    { getSessionUser: async () => (user ? { id: user } : null) });
  const post = (octets) => new Request('https://site.example/x', { method: 'POST', body: octets });
  const statut = () => JSON.parse(r2.lire('_market/listings/L1.json')).status;
  return { w, env, r2, post, statut };
}
test('SM-01 apercu d une fiche PAYANTE : le fichier complet (508 000 triangles) est refuse, une copie legere statique est acceptee', async () => {
  const m = mondeUpload(fiche());
  const lourd = await m.w.handleMarketPreviewUpload(m.post(glb(gltfIndexe(508_000 * 3))), m.env, 'L1');
  assert.equal(lourd.status, 400); assert.match((await lire(lourd)).error, /too detailed|508000/);
  assert.equal(m.r2.lire('_market/apercu/L1'), undefined, 'rien n est range quand le depot est refuse');
  const peau = await m.w.handleMarketPreviewUpload(m.post(glb(gltfIndexe(300, { skins: [{ joints: [0] }] }))), m.env, 'L1');
  assert.equal(peau.status, 400); assert.match((await lire(peau)).error, /static|skin/i);
  const anim = await m.w.handleMarketPreviewUpload(m.post(glb(gltfIndexe(300, { animations: [{}] }))), m.env, 'L1');
  assert.equal(anim.status, 400);
  const illisible = await m.w.handleMarketPreviewUpload(m.post(new Uint8Array([0x67, 0x6C, 0x54, 0x46, ...new Array(40).fill(7)])), m.env, 'L1');
  assert.equal(illisible.status, 400, 'GLB dont le chunk JSON est illisible : refuse sur une fiche payante');
  const limite = await m.w.handleMarketPreviewUpload(m.post(glb(gltfIndexe(30_000 * 3))), m.env, 'L1');
  assert.equal(limite.status, 200, '30 000 triangles pile : permis');
  assert.equal((await m.w.handleMarketPreviewUpload(m.post(glb(gltfIndexe(30_000 * 3 + 3))), m.env, 'L1')).status, 400, '30 001 : refuse');
});
test('SM-01 la fiche GRATUITE et la fiche IMAGE ne sont pas concernees par la limite', async () => {
  const gratuit = mondeUpload(fiche({ price_cents: 0 }));
  assert.equal((await gratuit.w.handleMarketPreviewUpload(gratuit.post(glb(gltfIndexe(508_000 * 3, { skins: [{}] }))), gratuit.env, 'L1')).status, 200);
  const image = mondeUpload(fiche({ asset_kind: 'image' }));
  const png = new Uint8Array([0x89, 0x50, 0x4E, 0x47, ...new Array(40).fill(1)]);
  assert.equal((await image.w.handleMarketPreviewUpload(image.post(png), image.env, 'L1')).status, 200);
});

/* ── SM-06 : un depot sur une fiche approuvee la repasse en attente ── */
test('SM-06 apercu ou miniature deposes sur une fiche APPROUVEE : elle repasse en pending ; pending et rejected ne changent pas', async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4E, 0x47, ...new Array(40).fill(1)]);
  const a = mondeUpload(fiche({ price_cents: 0 }));
  assert.equal(a.statut(), 'approved');
  assert.equal((await a.w.handleMarketPreviewUpload(a.post(glb(gltfIndexe(30))), a.env, 'L1')).status, 200);
  assert.equal(a.statut(), 'pending', 'apercu : repasse en attente');
  const b = mondeUpload(fiche());
  assert.equal((await b.w.handleMarketPosterUpload(b.post(png), b.env, 'L1')).status, 200);
  assert.equal(b.statut(), 'pending', 'miniature : repasse en attente');
  assert.ok(b.r2.lire('_market/poster/L1') !== undefined, 'la miniature est bien deposee');
  const c = mondeUpload(fiche({ status: 'pending' }));
  await c.w.handleMarketPosterUpload(c.post(png), c.env, 'L1');
  assert.equal(c.statut(), 'pending');
  const d = mondeUpload(fiche({ status: 'rejected' }));
  await d.w.handleMarketPosterUpload(d.post(png), d.env, 'L1');
  assert.equal(d.statut(), 'rejected', 'une fiche rejetee n est pas ressuscitee par un depot');
  const e = mondeUpload(fiche({ price_cents: 0 }), AUTRE_VENDEUR);
  assert.equal((await e.w.handleMarketPosterUpload(e.post(png), e.env, 'L1')).status, 403, 'pas son annonce');
  assert.equal(e.statut(), 'approved');
});

/* ── SM-06 + MP-11 : publication (empreinte, doublon d un autre compte, licence d une fiche payante) ── */
function mondePublication(initial = {}) {
  const r2 = creerR2({ 'u/mesh/a.glb': 'contenu-A', 'u/mesh/b.glb': 'contenu-B', 'u/mesh/c.glb': 'contenu-C', 'u/mesh/a-copie.glb': 'contenu-A', ...initial });
  const sb = creerSupabase({ jobs: [] });
  let utilisateur = VENDEUR;
  const credits = [];
  const w = charger([...COMMUN, 'siteUrl', '_cleR2DepuisUrl', '_hachageCourt', 'NOM_VENDEUR_SUPPRIME', '_nomPublicVendeur', 'MARKET_LICENCES', 'PRIX_FICHE_MIN_PAYANT_CENTS', 'PRIX_FICHE_MAX_CENTS',
    'validerPrixFiche', 'validerTexteFiche', '_filtrerTexteFiche', 'LICENCES_FICHE_PAYANTE', 'validerLicencePourPrix', '_loadAllListings', '_empreinteSha256Cle', 'handleMarketPublish'], {
    _marketGate: async () => null, getSessionUser: async () => ({ id: utilisateur }), supabaseAdmin: () => sb,
    _checkPromptSafetyAlerte: async () => ({ safe: true }), getPrice: async () => 0, spendCredits: async () => 1, addCredits: async (...a) => { credits.push(a); },
  });
  const env = { MESHES: r2, ...SITE_ENV };
  const publier = (cle, o = {}) => {
    sb.tables.jobs.push({ id: 'J-' + cle + '-' + utilisateur, user_id: utilisateur, mesh_url: cle, project_name: 'p', asset_type: 'x', status: 'succeeded' });
    return w.handleMarketPublish(new Request('https://site.example/api/market/publish', { method: 'POST', body: JSON.stringify({ asset_kind: 'mesh', jobId: 'J-' + cle + '-' + utilisateur, title: 'Un titre', description: 'Une description', price_cents: 0, currency: 'EUR', licence: 'cc-by', ...o }) }), env);
  };
  return { w, env, r2, publier, qui: (u) => { utilisateur = u; } };
}
const sha256 = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');

test('SM-06 la publication enregistre l empreinte SHA-256 du fichier vendu (asset_sha256)', async () => {
  const m = mondePublication();
  const rep = await m.publier('u/mesh/a.glb');
  assert.equal(rep.status, 200, JSON.stringify(await lire(rep.clone())));
  const { id } = await lire(rep);
  assert.equal(JSON.parse(m.r2.lire(`_market/listings/${id}.json`)).asset_sha256, await sha256('contenu-A'));
});
test('SM-06 un fichier dont l empreinte existe sur la fiche d un AUTRE compte est refuse (409) ; un autre fichier et une fiche sans empreinte ne bloquent pas', async () => {
  const m = mondePublication();
  assert.equal((await m.publier('u/mesh/a.glb')).status, 200);
  m.qui(AUTRE_VENDEUR);
  const copie = await m.publier('u/mesh/a-copie.glb');          // MEME contenu, autre adresse : l ancien controle (adresse seule) laissait passer
  assert.equal(copie.status, 409, 'copie sous un autre nom, autre compte');
  assert.match((await lire(copie)).error, /already published/i);
  assert.equal((await m.publier('u/mesh/b.glb')).status, 200, 'un autre fichier passe');
  // fiche ancienne SANS empreinte : inconnue, jamais bloquante
  const sansEmpreinte = mondePublication({ '_market/listings/OLD.json': JSON.stringify(fiche({ id: 'OLD', asset_url: 'u/mesh/z.glb', mesh_url: 'u/mesh/z.glb' })) });
  sansEmpreinte.qui(AUTRE_VENDEUR);
  assert.equal((await sansEmpreinte.publier('u/mesh/a.glb')).status, 200, 'les fiches sans empreinte ne bloquent personne');
});
test('SM-06 meme compte : republier un contenu identique sous une autre adresse n est pas bloque par l empreinte', async () => {
  const m = mondePublication();
  assert.equal((await m.publier('u/mesh/a.glb')).status, 200);
  assert.equal((await m.publier('u/mesh/a-copie.glb')).status, 200);
});
test('MP-11 publication : une fiche payante n accepte que personal et commercial ; cc-by et cc0 restent permises en gratuit', async () => {
  const m = mondePublication();
  for (const lic of ['cc-by', 'cc0', 'cc-by-nc']) {
    const r = await m.publier('u/mesh/a.glb', { price_cents: 500, licence: lic });
    assert.equal(r.status, 400, 'payant + ' + lic); assert.match((await lire(r)).error, /personal/);
  }
  assert.equal((await m.publier('u/mesh/b.glb', { price_cents: 500, licence: 'commercial' })).status, 200);
  assert.equal((await m.publier('u/mesh/a.glb', { price_cents: 500, licence: 'personal' })).status, 200);
  const g = mondePublication();
  const gratuit = [['u/mesh/a.glb', 'cc-by'], ['u/mesh/b.glb', 'cc0'], ['u/mesh/c.glb', 'personal']];
  for (const [cle, lic] of gratuit) assert.equal((await g.publier(cle, { price_cents: 0, licence: lic })).status, 200, 'gratuit + ' + lic);
});
test('MP-11 validerLicencePourPrix : pure, insensible a la casse', () => {
  const w = charger(['LICENCES_FICHE_PAYANTE', 'validerLicencePourPrix']);
  assert.equal(w.validerLicencePourPrix('cc-by', 0).ok, true);
  assert.equal(w.validerLicencePourPrix('cc-by', 50).ok, false);
  assert.equal(w.validerLicencePourPrix('Commercial', 50).ok, true);
  assert.equal(w.validerLicencePourPrix('personal', 1_000_000).ok, true);
  assert.equal(w.validerLicencePourPrix(undefined, 100).ok, false);
});

/* ── MP-11 : modification d une fiche ── */
function mondeModification(initiale) {
  const r2 = creerR2({ '_market/listings/L1.json': JSON.stringify(initiale) });
  const w = charger([...COMMUN, 'MARKET_LICENCES', 'PRIX_FICHE_MIN_PAYANT_CENTS', 'PRIX_FICHE_MAX_CENTS', 'validerPrixFiche', 'validerTexteFiche', '_filtrerTexteFiche',
    'LICENCES_FICHE_PAYANTE', 'validerLicencePourPrix', 'handleMarketUpdate'],
  { _marketGate: async () => null, getSessionUser: async () => ({ id: VENDEUR }), _checkPromptSafetyAlerte: async () => ({ safe: true }), APERCU_PREFIXE: 'x/', _retirerDesOfferts: async () => {} });
  const patch = (corps) => w.handleMarketUpdate(new Request('https://site.example/x', { method: 'PATCH', body: JSON.stringify(corps) }), { MESHES: r2 }, 'L1');
  return { patch, lue: () => JSON.parse(r2.lire('_market/listings/L1.json')) };
}
test('MP-11 modification : le couple RESULTANT prix + licence est controle ; un simple changement de titre sur une ancienne fiche payante cc-by reste permis', async () => {
  const gratuitCcBy = mondeModification(fiche({ price_cents: 0, licence: 'cc-by' }));
  assert.equal((await gratuitCcBy.patch({ price_cents: 500 })).status, 400, 'passer en payant une fiche cc-by : refuse');
  assert.equal((await gratuitCcBy.patch({ price_cents: 500, licence: 'commercial' })).status, 200, 'prix et licence changes ensemble : permis');
  const payant = mondeModification(fiche({ price_cents: 500, licence: 'personal' }));
  assert.equal((await payant.patch({ licence: 'cc0' })).status, 400, 'passer une fiche payante en cc0 : refuse');
  assert.equal(payant.lue().licence, 'personal', 'rien n est ecrit');
  assert.equal((await payant.patch({ licence: 'commercial' })).status, 200);
  const ancienne = mondeModification(fiche({ price_cents: 500, licence: 'cc-by' }));       // ancienne fiche valide au moment de sa creation
  assert.equal((await ancienne.patch({ title: 'Nouveau titre' })).status, 200, 'titre seul : permis');
  assert.equal((await ancienne.patch({ description: 'texte' })).status, 200);
  assert.equal((await ancienne.patch({ price_cents: 800 })).status, 400, 'toucher au prix la soumet a la regle');
  assert.equal((await ancienne.patch({ price_cents: 0 })).status, 200, 'la rendre gratuite : permis');
});

/* ── SM-10 / MP-06 : signaler et noter ── */
const JOUR = 86_400_000;
function mondeSignalement({ comptes = {}, travaux = {}, reportsInitiaux = {}, supabaseEnPanne = false } = {}) {
  const r2 = creerR2({ '_market/listings/L1.json': JSON.stringify(fiche()), ...reportsInitiaux });
  const sb = creerSupabase({
    profiles: Object.entries(comptes).map(([id, age]) => ({ id, created_at: new Date(Date.now() - age * JOUR).toISOString() })),
    jobs: Object.entries(travaux).flatMap(([id, n]) => Array.from({ length: n }, (_, i) => ({ id: id + i, user_id: id, status: 'succeeded' }))),
  }, supabaseEnPanne ? { profiles: 'base HS' } : {});
  const courriels = [];
  let qui = 'a';
  const w = charger([...COMMUN, 'SIGNALEMENT_AGE_MIN_COMPTE_JOURS', 'SIGNALEMENTS_MAX_PAR_COMPTE_JOUR', '_decisionEligibiliteSignalement', '_verifierEligibiliteSignalement',
    '_compterSignalementsEligibles', 'handleMarketReport', 'handleMarketRate'],
  { _marketGate: async () => null, getSessionUser: async () => ({ id: qui }), supabaseAdmin: () => sb, _sendAdminAlertEmail: async (_e, s, t) => { courriels.push([s, t]); }, _loadListingRatings: async () => ({ avg: 0, count: 0 }) });
  const env = { MESHES: r2 };
  const signaler = (uid, listing = 'L1') => { qui = uid; return w.handleMarketReport(new Request('https://site.example/x', { method: 'POST', body: JSON.stringify({ listing_id: listing, reason: 'contenu repris' }) }), env); };
  const noter = (uid) => { qui = uid; return w.handleMarketRate(new Request('https://site.example/x', { method: 'POST', body: JSON.stringify({ rating: 1 }) }), env, 'L1'); };
  return { signaler, noter, r2, courriels, w, statut: () => JSON.parse(r2.lire('_market/listings/L1.json')).status };
}
test('SM-10 / MP-06 : un compte de moins de 7 jours sans travail reussi ne peut NI signaler NI noter ; avec 8 jours ou un travail reussi, si', async () => {
  const m = mondeSignalement({ comptes: { neuf: 1, vieux: 8, actif: 1, limite: 6.9 }, travaux: { actif: 1 } });
  const refus = await m.signaler('neuf');
  assert.equal(refus.status, 403); assert.match((await lire(refus)).error, /7 days/);
  assert.equal((await m.noter('neuf')).status, 403, 'noter aussi');
  assert.equal((await m.signaler('limite')).status, 403, '6,9 jours : pas encore');
  assert.equal((await m.signaler('vieux')).status, 200);
  assert.equal((await m.signaler('actif')).status, 200, 'compte recent mais avec un travail reussi');
  assert.equal((await m.noter('vieux')).status, 200, 'un compte eligible peut noter');
  assert.equal(m.r2.lire('_market/reports/L1/neuf.json'), undefined, 'rien n est enregistre pour un compte non eligible');
  assert.equal((await m.signaler('inconnu')).status, 403, 'compte sans profil et sans travail : ferme');
  assert.equal(m.courriels.length, 2, 'aucun e-mail pour les signalements refuses');
});
test('SM-10 : la base d identite en panne = 503 (on ne laisse pas passer par defaut)', async () => {
  const m = mondeSignalement({ comptes: { vieux: 20 }, supabaseEnPanne: true });
  assert.equal((await m.signaler('vieux')).status, 503);
});
test('SM-10 : au plus 10 signalements par compte et par jour (le 11e est refuse en 429, pas d e-mail)', async () => {
  const lots = {}; for (let i = 0; i < 12; i++) lots['_market/listings/F' + i + '.json'] = JSON.stringify(fiche({ id: 'F' + i, status: 'pending' }));
  const m = mondeSignalement({ comptes: { vieux: 30 }, reportsInitiaux: lots });
  for (let i = 0; i < 10; i++) assert.equal((await m.signaler('vieux', 'F' + i)).status, 200, 'signalement ' + (i + 1));
  const onze = await m.signaler('vieux', 'F10');
  assert.equal(onze.status, 429);
  assert.equal(m.courriels.length, 10);
});
test('MP-06 : trois comptes eligibles masquent la fiche ; les dossiers sans la marque eligible (anciens) ne comptent pas pour le seuil', async () => {
  const m = mondeSignalement({ comptes: { a: 30, b: 30, c: 30 } });
  assert.equal((await lire(await m.signaler('a'))).auto_hidden, false);
  assert.equal((await lire(await m.signaler('b'))).auto_hidden, false);
  const troisieme = await lire(await m.signaler('c'));
  assert.equal(troisieme.report_count, 3); assert.equal(troisieme.auto_hidden, true);
  assert.equal(m.statut(), 'rejected');
  // trois dossiers anciens (comptes jamais verifies) + un seul signalement eligible : pas de masquage
  const anciens = {};
  for (const u of ['x1', 'x2', 'x3']) anciens[`_market/reports/L1/${u}.json`] = JSON.stringify({ listing_id: 'L1', reporter: u, reason: 'jetable', created_at: '2026-10-01T00:00:00Z' });
  const n = mondeSignalement({ comptes: { a: 30 }, reportsInitiaux: anciens });
  const r = await lire(await n.signaler('a'));
  assert.equal(r.report_count, 1, 'seuls les signalements de comptes eligibles comptent');
  assert.equal(r.auto_hidden, false); assert.equal(n.statut(), 'approved');
});

/* ── SM-03 (reste) : date du premier telechargement ── */
function mondeTelechargement(listing, { acheteur = ACHETEUR, proprietaire = true, actif = true } = {}) {
  const r2 = creerR2({ '_market/listings/L1.json': JSON.stringify(listing), ...(actif ? { 'u/mesh/a.glb': 'binaire' } : {}) });
  if (proprietaire) r2.ecrire(`_market/owners/L1/${ACHETEUR}.json`, JSON.stringify({ sale_id: 'S1', at: '2026-09-20T00:00:00Z', withdrawal_waiver_at: '2026-09-20T00:00:00Z' }));
  const bumps = [];
  const w = charger([...COMMUN, 'siteUrl', '_cleR2DepuisUrl', 'r2ContentType', '_fluxActifFiche', '_noterPremierTelechargement', 'handleMarketDownload'],
    { getSessionUser: async () => (acheteur ? { id: acheteur } : null), bumpListingDownloads: async (_e, id) => { bumps.push(id); } });
  const env = { MESHES: r2, ...SITE_ENV };
  const telecharger = () => w.handleMarketDownload(new Request('https://site.example/api/market/download/L1'), env, 'L1');
  const proprio = () => JSON.parse(r2.lire(`_market/owners/L1/${ACHETEUR}.json`));
  return { telecharger, proprio, r2, bumps };
}
test('SM-03 : le premier telechargement reussi enregistre first_download_at dans le fichier proprietaire, sans toucher aux autres champs, et il n est jamais ecrase', async () => {
  const m = mondeTelechargement(fiche());
  assert.equal(m.proprio().first_download_at, undefined);
  const r1 = await m.telecharger();
  assert.equal(r1.status, 200);
  const apres1 = m.proprio();
  assert.match(apres1.first_download_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(apres1.sale_id, 'S1'); assert.equal(apres1.withdrawal_waiver_at, '2026-09-20T00:00:00Z', 'les champs existants sont conserves');
  await new Promise((r) => setTimeout(r, 15));
  assert.equal((await m.telecharger()).status, 200);
  assert.equal(m.proprio().first_download_at, apres1.first_download_at, 'la date du PREMIER telechargement ne change plus');
  assert.equal(m.bumps.length, 2, 'le compteur de telechargements continue');
});
test('SM-03 : un telechargement qui echoue (fichier absent, achat absent, fiche non approuvee) n enregistre rien', async () => {
  const sansFichier = mondeTelechargement(fiche(), { actif: false });
  assert.equal((await sansFichier.telecharger()).status, 404);
  assert.equal(sansFichier.proprio().first_download_at, undefined, 'echec : pas de date');
  const sansAchat = mondeTelechargement(fiche(), { proprietaire: false });
  assert.equal((await sansAchat.telecharger()).status, 402);
  const nonApprouvee = mondeTelechargement(fiche({ status: 'pending' }));
  assert.equal((await nonApprouvee.telecharger()).status, 404);
  assert.equal(nonApprouvee.proprio().first_download_at, undefined);
});
test('SM-03 : un telechargement gratuit ne cree aucun fichier proprietaire ; un fichier proprietaire illisible ne fait pas echouer le telechargement', async () => {
  const gratuit = mondeTelechargement(fiche({ price_cents: 0 }), { acheteur: null, proprietaire: false });
  assert.equal((await gratuit.telecharger()).status, 200);
  assert.equal(gratuit.r2.lire(`_market/owners/L1/${ACHETEUR}.json`), undefined);
  const abime = mondeTelechargement(fiche());
  abime.r2.ecrire(`_market/owners/L1/${ACHETEUR}.json`, 'pas du json');
  assert.equal((await abime.telecharger()).status, 200, 'le telechargement reussit malgre tout');
  assert.equal(abime.r2.lire(`_market/owners/L1/${ACHETEUR}.json`), 'pas du json', 'fichier illisible : on n y touche pas');
});

/* ── MP-03 : etiquette IA lisible par machine ── */
test('MP-03 : _ficheVitrine porte ai_generated: true (fiche gratuite comme payante) sans exposer l empreinte du fichier', () => {
  const w = charger([...COMMUN, 'siteUrl', '_hachageCourt', 'NOM_VENDEUR_SUPPRIME', '_nomPublicVendeur', '_ficheVitrine']);
  for (const l of [fiche({ price_cents: 0 }), fiche({ price_cents: 900 }), fiche({ asset_kind: 'image' })]) {
    const v = w._ficheVitrine({ ...l, asset_sha256: 'abcdef' }, SITE_ENV);
    assert.equal(v.ai_generated, true);
    assert.ok(!('asset_sha256' in v) && !JSON.stringify(v).includes('abcdef'), 'l empreinte reste interne');
  }
});

/* ═══════════════════════ W-3 : adresses IP tronquees, compteurs par empreinte (D-05 / D-07) ═══════════════════════ */
test('D-05 _tronquerIp : IPv4 a /24, IPv6 a /48 (formes compressees, mappees, entre crochets), liste d un en-tete, entrees invalides', () => {
  const w = charger(['_tronquerIp']);
  const t = w._tronquerIp;
  assert.equal(t('203.0.113.77'), '203.0.113.0');
  assert.equal(t(' 198.51.100.9 , 10.0.0.1'), '198.51.100.0', 'premiere adresse d une liste x-forwarded-for');
  assert.equal(t('2001:db8:85a3:8d3:1319:8a2e:370:7344'), '2001:db8:85a3::/48');
  assert.equal(t('2001:db8::1'), '2001:db8:0::/48', 'forme compressee : l ancienne version inventait « 2001:db8:1 »');
  assert.equal(t('2001:0DB8:0000:0000:0000:0000:0000:0001'), '2001:db8:0::/48', 'majuscules et zeros de tete');
  assert.equal(t('::1'), '0:0:0::/48');
  assert.equal(t('[2001:db8:1:2::9]'), '2001:db8:1::/48');
  assert.equal(t('::ffff:192.0.2.55'), '192.0.2.0', 'IPv4 mappee dans IPv6 = une IPv4');
  assert.equal(t('2001:db8:1:2:3:4:1.2.3.4'), '2001:db8:1::/48', 'IPv4 en queue d une adresse IPv6');
  for (const mauvais of [null, undefined, '', 'unknown', 'inconnue', '999.1.1.1', '1.2.3', '1.2.3.4.5', 'a:b', '1:2:3:4:5:6:7:8:9', '1::2::3', 'zzzz::1', '2001:db8:::1']) {
    assert.equal(t(mauvais), null, 'invalide : ' + mauvais);
  }
});

test('D-07 _cleCompteurIp : empreinte de 16 caracteres hexadecimaux, stable, salee par le secret, sans l adresse ; repli sur le reseau tronque sans secret', async () => {
  const w = charger(['_safeId', '_tronquerIp', '_empreinteIp', '_cleCompteurIp']);
  const env = { R2_URL_SIGNING_SECRET: 'graine-secrete-un' };
  const a = await w._cleCompteurIp(env, '203.0.113.77');
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.equal(await w._cleCompteurIp(env, '203.0.113.77'), a, 'meme adresse, meme cle : le plafond par adresse fonctionne');
  assert.equal(await w._cleCompteurIp(env, '203.0.113.77, 10.0.0.1'), a, 'une liste d en-tete : la premiere adresse');
  assert.notEqual(await w._cleCompteurIp(env, '203.0.113.78'), a, 'deux adresses voisines : deux cles');
  assert.notEqual(await w._cleCompteurIp({ R2_URL_SIGNING_SECRET: 'graine-secrete-deux' }, '203.0.113.77'), a, 'le secret sale l empreinte');
  assert.ok(!a.includes('203'), 'aucune trace de l adresse');
  assert.equal(await w._cleCompteurIp({}, '203.0.113.77'), '203.0.113.0', 'sans secret : jamais l adresse complete');
  assert.equal(await w._cleCompteurIp({}, 'unknown'), 'inconnue');
});

function mondeContact() {
  const r2 = creerR2();
  const alertes = [];
  const w = charger([...COMMUN, '_safeId', '_tronquerIp', '_empreinteIp', '_cleCompteurIp', 'MOTIFS_SIGNALEMENT', 'handleContactSubmit', 'handleReportContent'],
    { getSessionUser: async () => null, signedR2Url: async () => 'https://s/x', _alerterNouveauMessage: async (...a) => { alertes.push(a); return true; } });
  const env = { MESHES: r2, R2_URL_SIGNING_SECRET: 'graine-secrete-un' };
  const IP = '203.0.113.77';
  const contacter = (ip = IP) => w.handleContactSubmit(new Request('https://site.example/api/contact', { method: 'POST', headers: { 'cf-connecting-ip': ip, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Jean', email: 'jean@example.com', subject: 'Bonjour', message: 'Un message' }) }), env);
  const signaler = (ip = IP) => w.handleReportContent(new Request('https://site.example/api/report-content', { method: 'POST', headers: { 'cf-connecting-ip': ip, 'content-type': 'application/json' },
    body: JSON.stringify({ reason: 'illegal', details: 'd', surface: 'web' }) }), env);
  const cles = () => [...r2._m.keys()];
  return { w, env, r2, contacter, signaler, cles, IP };
}
test('D-05 un message de contact et un signalement ne gardent que le RESEAU de l adresse (a.b.c.0), jamais l adresse complete', async () => {
  const m = mondeContact();
  const c = await lire(await m.contacter());
  const s = await lire(await m.signaler());
  for (const id of [c.id, s.id]) {
    const fiche = JSON.parse(m.r2.lire(`_meta/contact/${id}.json`));
    assert.equal(fiche.ip, '203.0.113.0');
    assert.ok(!m.r2.lire(`_meta/contact/${id}.json`).includes('203.0.113.77'), 'l adresse complete n est nulle part dans la fiche');
  }
  const v6 = mondeContact();
  const c6 = await lire(await v6.contacter('2001:db8:85a3:8d3:1319:8a2e:370:7344'));
  assert.equal(JSON.parse(v6.r2.lire(`_meta/contact/${c6.id}.json`)).ip, '2001:db8:85a3::/48');
  const inconnue = mondeContact();
  const ci = await lire(await inconnue.contacter('inconnue'));
  assert.equal(JSON.parse(inconnue.r2.lire(`_meta/contact/${ci.id}.json`)).ip, null, 'adresse inexploitable : rien n est stocke');
});
test('D-07 les compteurs anti-abus sont indexes par empreinte, jamais par l adresse brute ; les plafonds par adresse restent appliques', async () => {
  const m = mondeContact();
  for (let i = 0; i < 5; i++) assert.equal((await m.contacter()).status, 200, 'message ' + (i + 1));
  assert.equal((await m.contacter()).status, 429, 'le 6e message de la meme adresse est refuse : le plafond par adresse fonctionne avec la cle hachee');
  assert.equal((await m.contacter('198.51.100.5')).status, 200, 'une autre adresse n est pas bloquee');
  const attendu = await charger(['_safeId', '_tronquerIp', '_empreinteIp', '_cleCompteurIp'])._cleCompteurIp(m.env, m.IP);
  const jour = new Date().toISOString().slice(0, 10);
  assert.ok(m.cles().includes(`_meta/contact_count/${jour}/${attendu}.txt`), 'cle contact_count = jour + empreinte');
  for (let i = 0; i < 20; i++) assert.equal((await m.signaler()).status, 200);
  assert.equal((await m.signaler()).status, 429, '21e signalement : refuse');
  assert.ok(m.cles().includes(`_meta/report_rate/${jour}/${attendu}`), 'cle report_rate = jour + empreinte');
  const toutes = m.cles().join('\n') + [...m.r2._m.values()].map((v) => v.valeur).join('\n');
  assert.ok(!toutes.includes('203.0.113.77'), 'l adresse brute n apparait dans AUCUNE cle ni valeur du bucket');
});
test('D-07 la purge de retention reconnait les cles hachees (jour + empreinte) comme les anciennes (jour + adresse) : 2 jours puis suppression', () => {
  const w = charger(['jourEnMs', 'RETENTION_JOURNAUX_CONSOLE_JOURS', 'RETENTION_AUDIT_ADMIN_JOURS', 'RETENTION_COMPTEURS_IP_JOURS', 'RETENTION_MESSAGES_JOURS', 'RETENTION_CORBEILLE_JOURS', 'UUID_RE_RETENTION', 'decisionRetention']);
  const maintenant = Date.UTC(2026, 9, 10, 12);
  const jour = (n) => new Date(maintenant - n * 86_400_000).toISOString().slice(0, 10);
  for (const prefixe of ['_meta/report_rate/', '_meta/contact_count/']) {
    for (const suite of ['0123456789abcdef', '0123456789abcdef.txt', '203.0.113.77', '203.0.113.77.txt', '2001_db8__1']) {
      assert.equal(w.decisionRetention(`${prefixe}${jour(0)}/${suite}`, null, maintenant), 'garder', 'aujourd hui : gardee');
      assert.equal(w.decisionRetention(`${prefixe}${jour(1)}/${suite}`, null, maintenant), 'garder', 'hier : gardee');
      assert.equal(w.decisionRetention(`${prefixe}${jour(3)}/${suite}`, null, maintenant), 'supprimer', 'il y a 3 jours : purgee (' + suite + ')');
    }
  }
  assert.equal(w.decisionRetention(`_meta/contact_count/${jour(5)}/_global.txt`, null, maintenant), 'supprimer');
  assert.equal(w.decisionRetention(`_meta/alerte_payant/${jour(5)}/7c1d9e20-aaaa-4bbb-8ccc-0123456789ab`, null, maintenant), 'supprimer', 'marqueurs d alerte de compte payant (W-1)');
  assert.equal(w.decisionRetention(`_meta/alerte_payant/${jour(0)}/7c1d9e20-aaaa-4bbb-8ccc-0123456789ab`, null, maintenant), 'garder');
});
