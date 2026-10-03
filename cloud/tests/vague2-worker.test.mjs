// Tests de la voie « worker-vague2 » (analyse du 03/10/2026) : SM-11/MP-07, CLOUD-12/SM-04/FIN-09/MP-05, CLOUD-07, CLOUD-06, ADM-06, IA-11, PB-06, D-11, ADM-03.
// Charge les VRAIES fonctions de cloud/src/worker.ts (transpilees) avec des doublures (faux R2, faux Supabase, faux fetch) : aucun appel reseau.
// Lancer : cd cloud && node --test tests/vague2-worker.test.mjs
// Autre exemplaire du worker (par ex. l'ancien code, pour verifier qu'un test ECHOUE dessus) : WORKER_SRC=<chemin> node --test tests/vague2-worker.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chargerFonctions, creerR2, creerSupabase, existe, lireSource } from './_charge-w3.mjs';

/** Charge `noms` (ceux que l'exemplaire teste ne declare pas sont ignores : sur l'ancien code les tests echouent par COMPORTEMENT, pas par chargement). */
const charger = (noms, doublures = {}) => chargerFonctions(noms.filter((n) => existe(n)), doublures);
const COMMUN = ['err', 'json', 'SECURITY_HEADERS', 'isMock', '_plafond', '_attenteBruitee', '_casIncrementCounter', '_incrementAtomique', 'r2GetText', 'todayUTC', '_isoNow'];
const lire = async (rep) => JSON.parse(await rep.text());

/* ═══════════════════════ SM-11 / MP-07 : nom public du vendeur ═══════════════════════ */
const SITE = (env, def) => 'https://site.example';
const UID1 = '3f2b8c1e-aaaa-4bbb-8ccc-111111111111';
const UID2 = '9d1e7a55-bbbb-4ccc-8ddd-222222222222';
const fiche = (o = {}) => ({ id: 'L1', user_id: UID1, author_email: 'jean.dupont@example.com', author_display: 'jean.dupont', title: 'T', description: 'D',
  price_cents: 0, currency: 'EUR', licence: 'cc-by', asset_kind: 'mesh', mesh_url: 'k', asset_url: 'k', status: 'approved', created_at: '2026-09-01T00:00:00Z', downloads: 0, ...o });

test('SM-11 : _ficheVitrine ne publie plus le debut de l e-mail ; pseudonyme stable', () => {
  const w = charger([...COMMUN, '_hachageCourt', 'NOM_VENDEUR_SUPPRIME', '_nomPublicVendeur', '_ficheVitrine'], { siteUrl: SITE });
  const a = w._ficheVitrine(fiche(), {});
  const b = w._ficheVitrine(fiche(), {});
  assert.notEqual(a.author_display, 'jean.dupont', 'le debut de l e-mail ne doit plus sortir');
  assert.match(a.author_display, /^Créateur-[0-9a-f]{6}$/);
  assert.equal(a.author_display, b.author_display, 'stable d un appel a l autre');
  assert.notEqual(w._ficheVitrine(fiche({ user_id: UID2 }), {}).author_display, a.author_display, 'deux comptes, deux pseudonymes');
  assert.ok(!JSON.stringify(a).includes('dupont'), 'aucune trace du nom dans la projection publique');
});

test('SM-11 : pseudonyme choisi respecte, adresse refusee, « Compte supprime » conserve', () => {
  const w = charger([...COMMUN, '_hachageCourt', 'NOM_VENDEUR_SUPPRIME', '_nomPublicVendeur'], {});
  assert.equal(w._nomPublicVendeur({ user_id: UID1, author_pseudo: '  Studio Nova ' }), 'Studio Nova');
  assert.match(w._nomPublicVendeur({ user_id: UID1, author_pseudo: 'jean@example.com' }), /^Créateur-/, 'un pseudonyme qui est une adresse est refuse');
  assert.equal(w._nomPublicVendeur({ user_id: UID1, author_display: 'Compte supprimé' }), 'Compte supprimé');
  assert.equal(w._nomPublicVendeur({}), 'Créateur');
  assert.equal(w._nomPublicVendeur(null), 'Créateur');
  assert.ok(!w._nomPublicVendeur({ user_id: UID1, author_pseudo: '<b>x\u0000</b>' }).includes('<'));
});

test('SM-11 : liste, fiche, page auteur, achats et « mes annonces » : aucune de ces routes ne renvoie le nom tire de l e-mail', async () => {
  const r2 = creerR2({ '_market/listings/L1.json': JSON.stringify(fiche()), '_market/listings/L2.json': JSON.stringify(fiche({ id: 'L2', price_cents: 500 })) });
  r2.ecrire(`_market/owners/L1/${UID2}.json`, '{}');
  const env = { MESHES: r2 };
  const NOMS = [...COMMUN, '_hachageCourt', 'NOM_VENDEUR_SUPPRIME', '_nomPublicVendeur', '_ficheVitrine', '_loadAllListings', '_offertsDuMois', '_moisCourant', '_finDuMois',
    '_getMarketKillSwitch', 'handleMarketList', 'handleMarketGet', 'handleMarketAuthorPage', 'handleMarketOwned', 'handleMePublishedAssets',
    '_cacheListeMarche', '_genCacheMarche', '_invaliderCacheMarche', '_reponseListeMarche', 'MARCHE_LISTE_TTL_MS'];
  const doublures = (uid) => ({ siteUrl: SITE, _loadAllRatingsByListing: async () => new Map(), getSessionUser: async () => ({ id: uid }), bumpListingDownloads: async () => {}, readListingDownloads: async () => 0 });
  const acheteur = charger(NOMS, doublures(UID2));
  const vendeur = charger(NOMS, doublures(UID1));
  const req = new Request('https://s/x');
  const reponses = {
    liste: await (await acheteur.handleMarketList(req, env)).text(),
    auteur: await (await acheteur.handleMarketAuthorPage(req, env, UID1)).text(),
    achats: await (await acheteur.handleMarketOwned(req, env)).text(),
    mesAnnonces: await (await vendeur.handleMePublishedAssets(req, env)).text(),
  };
  for (const [nom, t] of Object.entries(reponses)) {
    assert.ok(!t.includes('dupont'), nom + ' : le debut de l e-mail ne doit apparaitre dans aucune reponse : ' + t.slice(0, 200));
    assert.ok(!t.includes('example.com'), nom);
    assert.match(t, /Créateur-[0-9a-f]{6}/, nom);
  }
});

test('SM-11 : la publication n enregistre plus l e-mail ni son debut dans la fiche (lecture du code)', () => {
  const src = lireSource();
  const i = src.indexOf('const listing: MarketListing = {');
  assert.ok(i > 0);
  const bloc = src.slice(i, i + 900);
  assert.ok(!/split\('@'\)/.test(bloc), 'plus de debut d e-mail dans la fiche');
  assert.ok(!/author_email:\s*user\.email/.test(bloc), 'plus d e-mail copie dans la fiche');
});

/* ═══════════════════════ CLOUD-12 / SM-04 / FIN-09 / MP-05 : articles gratuits ═══════════════════════ */
const MOIS = new Date().toISOString().slice(0, 7);
const ilYA = (jours) => new Date(Date.now() - jours * 86_400_000).toISOString();
function montage({ prix = 10000, comptes = {}, killswitch = false, envExtra = {}, createur = 'creator-1' } = {}) {
  const r2 = creerR2({
    [`_market/offerts/${MOIS}.json`]: JSON.stringify({ ids: ['L1'] }),
    '_market/listings/L1.json': JSON.stringify(fiche({ id: 'L1', user_id: createur, price_cents: prix, title: 'Pack' })),
  });
  if (killswitch) r2.ecrire('_meta/market_killswitch.json', JSON.stringify({ enabled: true, reason: 'test' }));
  const profiles = [], jobs = [];
  for (const [uid, c] of Object.entries(comptes)) { profiles.push({ id: uid, created_at: c.cree ?? ilYA(30) }); for (let i = 0; i < (c.jobs ?? 1); i++) jobs.push({ user_id: uid, status: 'succeeded', credit_cost: 5 }); }
  const supa = creerSupabase({ profiles, jobs });
  const credits = [];
  let courant = null;
  const w = charger([...COMMUN, '_moisCourant', '_finDuMois', '_offertsDuMois', 'OFFERT_PART_CREATEUR_PCT', 'SELLER_CREDITS_PER_EUR', 'SELLER_CREDIT_BONUS_PCT', '_sellerPayoutCredits',
    '_marketGate', '_getMarketKillSwitch', '_decisionEligibiliteOffert', 'OFFERT_AGE_MIN_COMPTE_JOURS', '_verifierEligibiliteOffert', '_reserverVersementOffert',
    'OFFERT_PLAFOND_CREATEUR_MOIS_CENTS_DEFAUT', 'handleMarketClaim'],
  { getSessionUser: async () => ({ id: courant, email: null, credits: 0 }), supabaseAdmin: () => supa, _versementEnArgent: async () => null,
    _stripeRest: async () => ({ ok: false, data: {} }), addCredits: async (e, uid, n) => { credits.push([uid, n]); return 10; },
    _addUserNotification: async () => {}, bumpListingDownloads: async () => {} });
  const env = { MESHES: r2, ...envExtra };
  const claim = async (uid) => { courant = uid; const rep = await w.handleMarketClaim(new Request('https://s/api/market/L1/claim', { method: 'POST' }), env, 'L1'); return { status: rep.status, corps: await lire(rep) }; };
  return { r2, credits, claim, env };
}

test('CLOUD-12 : un compte ancien avec une generation reelle recupere l article et le createur est paye', async () => {
  const m = montage({ comptes: { u1: {} } });
  const r = await m.claim('u1');
  assert.equal(r.status, 200); assert.equal(r.corps.owned, true);
  assert.deepEqual(m.credits, [['creator-1', 294]]);          // 35 % de 100 EUR = 3 500 centimes -> 294 credits
});

test('CLOUD-12 : un compte de moins de 7 jours est refuse (403), le createur n est pas paye et rien n est enregistre', async () => {
  const m = montage({ comptes: { jeune: { cree: ilYA(2) } } });
  const r = await m.claim('jeune');
  assert.equal(r.status, 403); assert.match(r.corps.error, /7 days/);
  assert.equal(m.credits.length, 0);
  assert.equal(m.r2.lire(`_market/owners/L1/jeune.json`), undefined, 'aucune propriete creee pour un compte refuse');
});

test('CLOUD-12 : un compte sans generation reussie est refuse (403)', async () => {
  const m = montage({ comptes: { vide: { jobs: 0 } } });
  const r = await m.claim('vide');
  assert.equal(r.status, 403); assert.match(r.corps.error, /generated/);
  assert.equal(m.credits.length, 0);
});

test('CLOUD-12 : base illisible -> 503 (jamais un versement sans verification)', async () => {
  const m = montage({ comptes: { u1: {} } });
  const supa = creerSupabase({ profiles: [], jobs: [] }, { profiles: 'panne' });
  const w = charger([...COMMUN, '_moisCourant', '_finDuMois', '_offertsDuMois', 'OFFERT_PART_CREATEUR_PCT', 'SELLER_CREDITS_PER_EUR', 'SELLER_CREDIT_BONUS_PCT', '_sellerPayoutCredits', '_marketGate', '_getMarketKillSwitch',
    '_decisionEligibiliteOffert', 'OFFERT_AGE_MIN_COMPTE_JOURS', '_verifierEligibiliteOffert', '_reserverVersementOffert', 'OFFERT_PLAFOND_CREATEUR_MOIS_CENTS_DEFAUT', 'handleMarketClaim'],
  { getSessionUser: async () => ({ id: 'u1' }), supabaseAdmin: () => supa, _versementEnArgent: async () => null, _stripeRest: async () => ({ ok: false, data: {} }),
    addCredits: async () => { throw new Error('ne doit pas etre atteint'); }, _addUserNotification: async () => {}, bumpListingDownloads: async () => {} });
  const rep = await w.handleMarketClaim(new Request('https://s/x', { method: 'POST' }), m.env, 'L1');
  assert.equal(rep.status, 503);
});

test('FIN-09 : plafond mensuel par createur - la 2e recuperation reste accordee mais ne paie plus', async () => {
  const m = montage({ comptes: { u1: {}, u2: {}, u3: {} } });       // 3 500 centimes par recuperation, plafond 5 000
  assert.equal((await m.claim('u1')).status, 200);
  const r2 = await m.claim('u2');
  assert.equal(r2.status, 200); assert.equal(r2.corps.owned, true, 'le lecteur garde son article gratuit');
  assert.equal((await m.claim('u3')).status, 200);
  assert.equal(m.credits.length, 1, 'un seul versement : le suivant depasserait 50 EUR');
  const vente = JSON.parse(m.r2.lire(`_market/sales/offert_${MOIS}_L1_u2.json`));
  assert.equal(vente.payout_status, 'plafonne'); assert.equal(vente.seller_amount_cents, 0);
});

test('FIN-09 : plafond reglable ; 0 coupe tous les versements', async () => {
  const m = montage({ comptes: { u1: {} }, envExtra: { OFFERT_PLAFOND_CREATEUR_MOIS_CENTS: '0' } });
  assert.equal((await m.claim('u1')).status, 200);
  assert.equal(m.credits.length, 0);
  const m2 = montage({ comptes: { u1: {}, u2: {} }, envExtra: { OFFERT_PLAFOND_CREATEUR_MOIS_CENTS: '100000' } });
  await m2.claim('u1'); await m2.claim('u2');
  assert.equal(m2.credits.length, 2);
});

test('FIN-09 : huit recuperations SIMULTANEES ne depassent pas le plafond (reservation atomique)', async () => {
  const uids = Array.from({ length: 8 }, (_, i) => 'p' + i);
  const comptes = Object.fromEntries(uids.map((u) => [u, {}]));
  const r2 = creerR2({ [`_market/offerts/${MOIS}.json`]: JSON.stringify({ ids: ['L1'] }), '_market/listings/L1.json': JSON.stringify(fiche({ id: 'L1', user_id: 'creator-1', price_cents: 10000 })) });
  const profiles = uids.map((u) => ({ id: u, created_at: ilYA(30) })); const jobs = uids.map((u) => ({ user_id: u, status: 'succeeded', credit_cost: 5 }));
  const supa = creerSupabase({ profiles, jobs }); const credits = [];
  const courants = new Map();
  const w = charger([...COMMUN, '_moisCourant', '_finDuMois', '_offertsDuMois', 'OFFERT_PART_CREATEUR_PCT', 'SELLER_CREDITS_PER_EUR', 'SELLER_CREDIT_BONUS_PCT', '_sellerPayoutCredits', '_marketGate', '_getMarketKillSwitch',
    '_decisionEligibiliteOffert', 'OFFERT_AGE_MIN_COMPTE_JOURS', '_verifierEligibiliteOffert', '_reserverVersementOffert', 'OFFERT_PLAFOND_CREATEUR_MOIS_CENTS_DEFAUT', 'handleMarketClaim'],
  { getSessionUser: async (req) => ({ id: req.headers.get('x-uid') }), supabaseAdmin: () => supa, _versementEnArgent: async () => null, _stripeRest: async () => ({ ok: false, data: {} }),
    addCredits: async (e, uid, n) => { credits.push([uid, n]); return 1; }, _addUserNotification: async () => {}, bumpListingDownloads: async () => {} });
  void comptes; void courants;
  const reps = await Promise.all(uids.map((u) => w.handleMarketClaim(new Request('https://s/x', { method: 'POST', headers: { 'x-uid': u } }), { MESHES: r2 }, 'L1')));
  assert.ok(reps.every((r) => r.status === 200));
  assert.ok(credits.length <= 1, 'au plus un versement de 35 EUR sous un plafond de 50 EUR : ' + credits.length);
});

test('CLOUD-12 : le createur qui prend son propre article n est pas paye et n a pas besoin d eligibilite', async () => {
  const m = montage({ comptes: {} });                                // le createur n a meme pas de profil
  const r = await m.claim('creator-1');
  assert.equal(r.status, 200); assert.equal(m.credits.length, 0);
});

test('SM-04 : coupe-circuit de la place de marche actif -> 503 et aucun versement', async () => {
  const m = montage({ comptes: { u1: {} }, killswitch: true });
  const r = await m.claim('u1');
  assert.equal(r.status, 503); assert.equal(r.corps.marketplace_disabled, true);
  assert.equal(m.credits.length, 0);
});

test('CLOUD-12 : decision d eligibilite (pure)', () => {
  const w = charger(['OFFERT_AGE_MIN_COMPTE_JOURS', '_decisionEligibiliteOffert'], {});
  const now = Date.parse('2026-10-10T00:00:00Z');
  assert.equal(w._decisionEligibiliteOffert('2026-10-02T00:00:00Z', 1, now), 'ok');
  assert.equal(w._decisionEligibiliteOffert('2026-10-04T00:00:00Z', 1, now), 'compte_trop_recent');
  assert.equal(w._decisionEligibiliteOffert('2026-10-02T00:00:00Z', 0, now), 'aucune_generation');
  assert.equal(w._decisionEligibiliteOffert(null, 5, now), 'compte_trop_recent', 'date inconnue : ferme');
  assert.equal(w._decisionEligibiliteOffert('pas une date', 5, now), 'compte_trop_recent');
});

/* ═══════════════════════ CLOUD-07 : cles d API ═══════════════════════ */
const CLE = 'mfm_' + 'a1B2c3D4e5'.repeat(4);
async function empreinte(txt) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt)))].map((b) => b.toString(16).padStart(2, '0')).join(''); }
async function montageCle({ plafond = 100, cout = 10, credits = 100000, envExtra = {} } = {}) {
  const r2 = creerR2({ [`_meta/api_keys/${await empreinte(CLE)}.json`]: JSON.stringify({ uid: 'u1', email: null, nom: 't', plafond, cree: 'x', prefixe: 'mfm_a1' }) });
  const etat = { credits, executions: 0 };
  const w = charger([...COMMUN, '_CLE_API_RE', '_lireCleApi', '_empreinteCle', '_lireCle', '_CLE_API_INTERDIT', '_OPS_API_VISIBLES', 'CLE_API_RESERVATION_DEFAUT',
    '_reserverCreditsCle', '_solderReservationCle', '_avecCleApi'],
  { _creditsDe: async () => etat.credits, _debuterOperation: async () => null, handleProjectCreate: async () => new Response('{}'), supabaseAdmin: () => ({ from: () => ({ delete: () => ({ eq: async () => ({}) }) }) }) });
  const env = { MESHES: r2, ...envExtra };
  const appeler = (chemin = '/api/modify-image', cb) => {
    const req = new Request('https://s.example' + chemin, { method: 'POST', headers: { authorization: 'Bearer ' + CLE, 'content-type': 'application/json' }, body: '{}' });
    return w._avecCleApi(req, env, async () => { etat.executions++; await new Promise((r) => setTimeout(r, 5)); if (cb) await cb(etat); else etat.credits -= cout; return new Response('{"ok":true}', { status: 200 }); }, undefined);
  };
  return { appeler, etat, r2, empreinte: await empreinte(CLE) };
}

test('CLOUD-07 : 30 requetes en rafale ne depassent pas le plafond (reservation avant execution)', async () => {
  const m = await montageCle({ plafond: 100, cout: 10 });
  const reps = await Promise.all(Array.from({ length: 30 }, () => m.appeler()));
  const ok = reps.filter((r) => r.status === 200).length;
  const refus = reps.filter((r) => r.status === 429).length;
  assert.ok(ok >= 1, 'au moins une requete passe');
  assert.ok(m.etat.executions <= 10, `plafond 100 / reservation 10 : au plus 10 executions, vu ${m.etat.executions}`);
  assert.equal(ok + refus, 30);
});

test('CLOUD-07 : sequentiellement, le plafond coupe pile ; le cout reel remplace la reservation', async () => {
  const m = await montageCle({ plafond: 100, cout: 10 });
  const statuts = [];
  for (let i = 0; i < 12; i++) statuts.push((await m.appeler()).status);
  assert.deepEqual(statuts.slice(0, 10), Array(10).fill(200));
  assert.deepEqual(statuts.slice(10), [429, 429]);
  const m2 = await montageCle({ plafond: 100, cout: 2 });                 // cout reel < reservation : la difference est rendue
  for (let i = 0; i < 50; i++) assert.equal((await m2.appeler()).status, 200, 'appel ' + i);
  assert.equal((await m2.appeler()).status, 429);
});

test('CLOUD-07 : un appel qui ne coute rien rend toute sa reservation', async () => {
  const m = await montageCle({ plafond: 20, cout: 0 });
  for (let i = 0; i < 30; i++) assert.equal((await m.appeler()).status, 200);
});

test('CLOUD-07 : une cle sans plafond (0) n est jamais refusee', async () => {
  const m = await montageCle({ plafond: 0, cout: 10 });
  for (let i = 0; i < 15; i++) assert.equal((await m.appeler()).status, 200);
});

test('CLOUD-07 : une route qui leve rend la reservation et propage l erreur', async () => {
  const m = await montageCle({ plafond: 10, cout: 0 });
  await assert.rejects(() => m.appeler('/api/modify-image', async () => { throw new Error('boum'); }), /boum/);
  assert.equal((await m.appeler()).status, 200, 'la reservation de l appel en erreur a ete rendue');
});

test('CLOUD-07 : une cle ne peut pas vider le compte (wipe-all-projects interdit, session requise)', async () => {
  const m = await montageCle({});
  const rep = await m.appeler('/api/me/wipe-all-projects?wipeR2=true');
  assert.equal(rep.status, 403);
  assert.equal(m.etat.executions, 0, 'la route n est jamais atteinte');
  assert.equal((await m.appeler('/api/me/delete')).status, 403);        // deja interdit avant : non regression
});

/* ═══════════════════════ CLOUD-06 : copie d animations ═══════════════════════ */
function montageCopie(envExtra = {}, taille = 1000) {
  const uid = 'u-copie';
  const r2 = creerR2({ [`${uid}/animations/a.glb`]: 'x'.repeat(taille) });
  const w = charger([...COMMUN, 'ANIM_COPY_MAX_PAR_JOUR_DEFAUT', 'ANIM_COPY_MAX_OCTETS_PAR_JOUR_DEFAUT', 'handleAnimCopy'],
    { getSessionUser: async () => ({ id: uid }), siteUrl: SITE, signedR2Url: async (e, k) => 'https://signed/' + k });
  const env = { MESHES: r2, R2_PUBLIC_URL: 'https://pub.r2.dev', ...envExtra };
  const copier = async () => { const rep = await w.handleAnimCopy(new Request('https://s/api/animations/copy', { method: 'POST', body: JSON.stringify({ sourceUrl: `${uid}/animations/a.glb`, animType: 'idle', projectName: 'p' }) }), env); return { status: rep.status, corps: await lire(rep) }; };
  return { copier, r2, uid };
}

test('CLOUD-06 : la 4e copie du jour est refusee (429) quand le plafond est a 3', async () => {
  const m = montageCopie({ ANIM_COPY_MAX_PER_DAY: '3' });
  for (let i = 0; i < 3; i++) assert.equal((await m.copier()).status, 200);
  const r = await m.copier();
  assert.equal(r.status, 429); assert.match(r.corps.error, /quota/);
});

test('CLOUD-06 : plafond d octets ; le compteur de copies est rendu quand le volume est refuse', async () => {
  const m = montageCopie({ ANIM_COPY_MAX_BYTES_PER_DAY: '2500' }, 1000);
  assert.equal((await m.copier()).status, 200); assert.equal((await m.copier()).status, 200);
  const r = await m.copier();
  assert.equal(r.status, 429); assert.match(r.corps.error, /volume/);
  const jour = new Date().toISOString().slice(0, 10);
  assert.equal(m.r2.lire(`_meta/anim_copy_count/${m.uid}/${jour}.txt`), '2', 'la copie refusee n est pas comptee');
});

test('CLOUD-06 : par defaut, un usage normal (50 copies de 30 Mo) n est jamais bloque', async () => {
  const m = montageCopie({}, 30 * 1024 * 1024 / 1024);            // taille fictive 30 Ko ; les bornes par defaut sont 300 copies et 10 Gio
  for (let i = 0; i < 50; i++) assert.equal((await m.copier()).status, 200);
  const w = charger(['ANIM_COPY_MAX_PAR_JOUR_DEFAUT', 'ANIM_COPY_MAX_OCTETS_PAR_JOUR_DEFAUT']);
  assert.equal(w.ANIM_COPY_MAX_PAR_JOUR_DEFAUT, 300); assert.equal(w.ANIM_COPY_MAX_OCTETS_PAR_JOUR_DEFAUT, 10 * 1024 ** 3);
});

/* ═══════════════════════ ADM-06 : alerte sur actions admin ═══════════════════════ */
function montageAlerte(envExtra = {}) {
  const r2 = creerR2({});
  const envoyes = [];
  const fetchAvant = globalThis.fetch;
  globalThis.fetch = async (url, init) => { envoyes.push({ url: String(url), corps: JSON.parse(init.body) }); return new Response('{}'); };
  const w = charger([...COMMUN, 'ADMIN_EMAILS', '_sendAdminAlertEmail', 'ALERTE_ADMIN_MAX_PAR_HEURE', 'ALERTE_ADMIN_SEUIL_CREDITS_DEFAUT', 'ACTIONS_ADMIN_FORT_IMPACT', 'decisionAlerteActionAdmin', '_alerterActionAdmin', '_auditLog'], {});
  const env = { MESHES: r2, RESEND_API_KEY: 'cle-test', ...envExtra };
  const req = new Request('https://s/api/admin/x', { headers: { 'cf-connecting-ip': '203.0.113.9', 'user-agent': 'UA-secret' } });
  return { w, env, req, envoyes, restaurer: () => { globalThis.fetch = fetchAvant; } };
}

test('ADM-06 : decision pure - seuil des octrois, actions a fort impact, rien pour le reste', () => {
  const w = charger(['ACTIONS_ADMIN_FORT_IMPACT', 'decisionAlerteActionAdmin'], {});
  const iso = '2026-10-03T10:00:00.000Z';
  assert.equal(w.decisionAlerteActionAdmin('grant_credits', 'uid', { delta: 499 }, 500, iso), null);
  assert.ok(w.decisionAlerteActionAdmin('grant_credits', 'uid', { delta: 500 }, 500, iso));
  assert.ok(w.decisionAlerteActionAdmin('grant_credits', 'uid', { delta: -900 }, 500, iso), 'un retrait massif alerte aussi');
  assert.equal(w.decisionAlerteActionAdmin('grant_credits', 'uid', {}, 500, iso), null);
  for (const a of ['set_pricing', 'toggle_service', 'market_killswitch_set', 'force_logout_all', 'reconcile_payment', 'revoke_admin_sessions', 'delete_user', 'refund'])
    assert.ok(w.decisionAlerteActionAdmin(a, undefined, {}, 500, iso), a);
  for (const a of ['view_users', 'view_prompt', 'delete_image', 'market_approve', 'admin_login_ok', 'constructor', '__proto__']) assert.equal(w.decisionAlerteActionAdmin(a, undefined, {}, 500, iso), null, a);
  const t = w.decisionAlerteActionAdmin('toggle_service', 'all', { enabled: false }, 500, iso);
  assert.match(t.texte, /Service : all/); assert.match(t.texte, /coupe/);
});

test('ADM-06 : _auditLog envoie l alerte (sans donnee personnelle), au plus 10 par heure', async () => {
  const m = montageAlerte();
  try {
    for (let i = 0; i < 13; i++) await m.w._auditLog(m.env, { req: m.req, actorEmail: 'admin@secret.example', action: 'set_pricing', target: 'cible-secrete', details: { email: 'victime@example.com', prices: { a: 1 } } });
    assert.equal(m.envoyes.length, 10, 'limite de 10 alertes par heure');
    const tout = JSON.stringify(m.envoyes);
    for (const interdit of ['admin@secret.example', 'victime@example.com', '203.0.113.9', 'UA-secret', 'cible-secrete']) assert.ok(!tout.includes(interdit), 'donnee personnelle dans l alerte : ' + interdit);
    assert.match(m.envoyes[0].corps.subject, /tarif/);
    const jour = new Date().toISOString().slice(0, 10);
    assert.ok(m.env.MESHES.lire(`_meta/admin_audit/${jour}.log`).split('\n').filter(Boolean).length >= 13, 'le journal d audit est toujours ecrit');
  } finally { m.restaurer(); }
});

test('ADM-06 : octroi sous le seuil ou action ordinaire -> aucun e-mail ; au-dessus -> un e-mail', async () => {
  const m = montageAlerte({ ADMIN_ALERTE_CREDITS_SEUIL: '1000' });
  try {
    await m.w._auditLog(m.env, { req: m.req, actorEmail: 'a', action: 'grant_credits', target: 'u', details: { delta: 999 } });
    await m.w._auditLog(m.env, { req: m.req, actorEmail: 'a', action: 'view_users' });
    assert.equal(m.envoyes.length, 0);
    await m.w._auditLog(m.env, { req: m.req, actorEmail: 'a', action: 'grant_credits', target: 'u', details: { delta: 1000 } });
    assert.equal(m.envoyes.length, 1); assert.match(m.envoyes[0].corps.text, /1000 credits/);
  } finally { m.restaurer(); }
});

test('ADM-06 : sans cle Resend, l action admin reussit sans erreur ni e-mail', async () => {
  const m = montageAlerte({ RESEND_API_KEY: undefined });
  try { await m.w._auditLog(m.env, { req: m.req, actorEmail: 'a', action: 'set_pricing' }); assert.equal(m.envoyes.length, 0); } finally { m.restaurer(); }
});

/* ═══════════════════════ IA-11 : metadonnees des images ═══════════════════════ */
const octets = (...parts) => { const out = []; for (const p of parts) { if (typeof p === 'string') for (const c of p) out.push(c.charCodeAt(0) & 0xff); else out.push(...p); } return new Uint8Array(out); };
const be16 = (n) => [(n >> 8) & 255, n & 255];
const le16 = (n) => [n & 255, (n >> 8) & 255];
const le32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const seg = (m, charge) => octets([0xff, m], be16(charge.length + 2), charge);
/** TIFF little-endian : IFD0 { Orientation, pointeur GPS } puis un faux bloc GPS lisible. */
function tiff(orientation, { be = false } = {}) {
  const u16 = (n) => (be ? be16(n) : le16(n)); const u32 = (n) => (be ? be32(n) : le32(n));
  const t = [...(be ? [0x4d, 0x4d] : [0x49, 0x49]), ...u16(42), ...u32(8)];
  t.push(...u16(2));
  if (orientation !== null) t.push(...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientation), 0, 0);
  else t.push(...u16(0x010f), ...u16(2), ...u32(1), 0, 0, 0, 0);
  t.push(...u16(0x8825), ...u16(4), ...u32(1), ...u32(8 + 2 + 24 + 4));
  t.push(...u32(0));
  t.push(...[...'GPS-LAT-48.8566N-LON-2.3522E'].map((c) => c.charCodeAt(0)));
  return new Uint8Array(t);
}
function jpegAvec({ orientation = 1, xmp = true, iptc = true, exif = true, icc = true, be = false } = {}) {
  const parts = [[0xff, 0xd8], seg(0xe0, octets('JFIF\0', [1, 1, 0, 0, 1, 0, 1, 0, 0]))];
  if (exif) parts.push(seg(0xe1, octets('Exif\0\0', tiff(orientation, { be }))));
  if (xmp) parts.push(seg(0xe1, octets('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:Description tiff:Orientation="1" xmp:Creator="MARQUE-XMP"/></x:xmpmeta>')));
  if (iptc) parts.push(seg(0xed, octets('Photoshop 3.0\0', '8BIM', [4, 4, 0, 0, 0, 0, 0, 12], 'IPTC-MARQUE')));
  if (icc) parts.push(seg(0xe2, octets('ICC_PROFILE\0', [1, 1], 'PROFIL-ICC')));
  parts.push(seg(0xdb, new Uint8Array(65).fill(7)));
  parts.push(seg(0xc0, octets([8, 0, 2, 0, 2, 1, 1, 0x11, 0])));
  parts.push(seg(0xc4, octets([0, 1, 2, 3, 4, 5])));
  parts.push(seg(0xda, octets([1, 1, 0, 0, 0x3f, 0])));
  parts.push(octets([0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd9]));              // donnees d image (avec un 0xFF 0x00) puis EOI
  return octets(...parts);
}
const contient = (o, txt) => { const s = new TextDecoder('latin1').decode(o); return s.includes(txt); };
function validerJpeg(o, finStricte = true) {
  assert.ok(o[0] === 0xff && o[1] === 0xd8, 'SOI');
  let p = 2;
  while (p < o.length) {
    assert.equal(o[p], 0xff, 'marqueur a ' + p); const m = o[p + 1];
    if (m === 0xda) { if (finStricte) { assert.equal(o[o.length - 2], 0xff); assert.equal(o[o.length - 1], 0xd9, 'EOI final'); } return true; }
    const len = (o[p + 2] << 8) | o[p + 3]; assert.ok(len >= 2 && p + 2 + len <= o.length, 'longueur de segment'); p += 2 + len;
  }
  assert.fail('pas de SOS');
}
function chunkPng(type, data) { return octets(be32(data.length), type, data, [1, 2, 3, 4]); }
function pngAvec({ orientation = 1 } = {}) {
  return octets([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    chunkPng('IHDR', octets(be32(2), be32(2), [8, 2, 0, 0, 0])),
    chunkPng('eXIf', tiff(orientation)), chunkPng('tEXt', octets('Comment\0PNG-TEXTE-MARQUE')),
    chunkPng('iTXt', octets('XML:com.adobe.xmp\0\0\0\0\0<x tiff:Orientation="1"/>PNG-XMP-MARQUE')), chunkPng('zTXt', octets('k\0\0', [1, 2, 3])),
    chunkPng('IDAT', octets([9, 8, 7, 6, 5, 4])), chunkPng('IEND', new Uint8Array(0)));
}
function validerPng(o) {
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]; SIG.forEach((b, i) => assert.equal(o[i], b));
  let p = 8; const types = [];
  while (p < o.length) { const len = ((o[p] << 24) | (o[p + 1] << 16) | (o[p + 2] << 8) | o[p + 3]) >>> 0; types.push(String.fromCharCode(o[p + 4], o[p + 5], o[p + 6], o[p + 7])); p += 12 + len; assert.ok(p <= o.length); }
  assert.equal(p, o.length); assert.equal(types[0], 'IHDR'); assert.equal(types[types.length - 1], 'IEND'); return types;
}
function chunkWebp(four, data) { return octets(four, le32(data.length), data, data.length & 1 ? [0] : []); }
function webpAvec({ orientation = 1 } = {}) {
  const corps = octets('WEBP', chunkWebp('VP8X', octets([0x2c, 0, 0, 0], [1, 0, 0, 1, 0, 0])), chunkWebp('ICCP', octets('ICC')),
    chunkWebp('VP8 ', octets([1, 2, 3, 4, 5])), chunkWebp('EXIF', octets('Exif\0\0', tiff(orientation))), chunkWebp('XMP ', octets('<x tiff:Orientation="1"/>WEBP-XMP-MARQUE')));
  return octets('RIFF', le32(corps.length), corps);
}
function validerWebp(o) {
  assert.equal(String.fromCharCode(...o.subarray(0, 4)), 'RIFF'); const t = o[4] | (o[5] << 8) | (o[6] << 16) | (o[7] << 24); assert.equal(t + 8, o.length, 'taille RIFF');
  let p = 12; const types = [];
  while (p < o.length) { const len = (o[p + 4] | (o[p + 5] << 8) | (o[p + 6] << 16) | (o[p + 7] << 24)) >>> 0; types.push(String.fromCharCode(...o.subarray(p, p + 4))); p += 8 + len + (len & 1); assert.ok(p <= o.length); }
  assert.equal(p, o.length); return types;
}
const IMG = ['_exifMinimalOrientation', '_u32be', '_u32le', '_concatOctets', '_orientationExif', '_xmpOrientationNonNormale', '_SIG_PNG', '_nettoyerJpeg', '_nettoyerPng', '_nettoyerWebp', '_retirerMetadonneesImage'];

test('IA-11 : JPEG - EXIF (GPS), XMP et IPTC retires ; JFIF, ICC et donnees d image intacts ; fichier toujours valide', () => {
  const w = charger(IMG);
  const src = jpegAvec();
  assert.ok(contient(src, 'GPS-LAT-48.8566N') && contient(src, 'MARQUE-XMP') && contient(src, 'IPTC-MARQUE'));
  const out = w._retirerMetadonneesImage(src);
  assert.ok(out !== src && out.length < src.length);
  for (const m of ['GPS-LAT', 'Exif', 'MARQUE-XMP', 'IPTC-MARQUE', 'Photoshop']) assert.ok(!contient(out, m), m + ' doit disparaitre');
  for (const m of ['JFIF', 'PROFIL-ICC']) assert.ok(contient(out, m), m + ' doit rester');
  validerJpeg(out);
  assert.deepEqual([...out.subarray(out.length - 7)], [0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd9], 'donnees d image identiques');
});

/** Orientation declaree dans le premier EXIF d un JPEG (0 s il n y en a pas). */
function orientationDuJpeg(w, o) {
  let p = 2;
  while (p + 4 <= o.length && o[p] === 0xff && o[p + 1] !== 0xda) {
    const len = (o[p + 2] << 8) | o[p + 3];
    if (o[p + 1] === 0xe1 && o[p + 4] === 0x45) return w._orientationExif(o.subarray(p + 4, p + 2 + len));
    p += 2 + len;
  }
  return 0;
}

test('IA-11 : JPEG - portrait de telephone (orientation 2 a 8) : le GPS part, l orientation est CONSERVEE dans un EXIF minimal', () => {
  const w = charger(IMG);
  for (const o of [2, 3, 5, 6, 7, 8]) {
    const src = jpegAvec({ orientation: o, xmp: false });
    const out = w._retirerMetadonneesImage(src);
    assert.ok(out !== src && out.length < src.length, 'orientation ' + o + ' : nettoye');
    assert.ok(!contient(out, 'GPS-LAT') && !contient(out, 'MARQUE-XMP') && !contient(out, 'IPTC-MARQUE'), 'plus de GPS / XMP / IPTC');
    assert.equal(orientationDuJpeg(w, out), o, 'orientation conservee');
    validerJpeg(out);
    assert.deepEqual([...out.subarray(out.length - 7)], [0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd9]);
  }
  const be = octets(jpegAvec({ orientation: 6, be: true, xmp: false, iptc: false }));      // EXIF grand-boutiste
  const outBe = w._retirerMetadonneesImage(be); assert.ok(outBe.length < be.length); assert.equal(orientationDuJpeg(w, outBe), 6); validerJpeg(outBe);
  assert.equal(w._exifMinimalOrientation(6).length, 36);
});

test('IA-11 : JPEG - orientation illisible, hors 1..8, EXIF contradictoires ou XMP qui tourne : original intact (le meme objet)', () => {
  const w = charger(IMG);
  for (const o of [0, 9, 300]) { const src = jpegAvec({ orientation: o }); assert.strictEqual(w._retirerMetadonneesImage(src), src, 'orientation ' + o); }
  const rot = jpegAvec({ exif: false }); const rotation = octets(new TextDecoder('latin1').decode(rot).replace('tiff:Orientation="1"', 'tiff:Orientation="6"'));
  assert.strictEqual(w._retirerMetadonneesImage(rotation), rotation, 'XMP avec rotation : intact');
  const a = jpegAvec({ orientation: 6, xmp: false, iptc: false, icc: false }); const b = jpegAvec({ orientation: 3, xmp: false, iptc: false, icc: false });
  // deux EXIF contradictoires : on insere le second APP1 de b juste apres celui de a
  const seg1 = a.subarray(2 + 18, 2 + 18 + 2 + ((a[2 + 18 + 2] << 8) | a[2 + 18 + 3]));
  const seg2 = b.subarray(2 + 18, 2 + 18 + 2 + ((b[2 + 18 + 2] << 8) | b[2 + 18 + 3]));
  const double = octets(a.subarray(0, 2 + 18), seg1, seg2, a.subarray(2 + 18 + seg1.length));
  assert.strictEqual(w._retirerMetadonneesImage(double), double, 'EXIF contradictoires');
  const be = octets(jpegAvec({ xmp: false, iptc: false, be: true }));
  assert.ok(w._retirerMetadonneesImage(be).length < be.length, 'orientation 1 grand-boutiste : nettoye');
});

test('IA-11 : JPEG - orientation absente de l EXIF : nettoye ; EXIF illisible : intact', () => {
  const w = charger(IMG);
  const sans = jpegAvec({ orientation: null, xmp: false, iptc: false });
  const out = w._retirerMetadonneesImage(sans); assert.ok(!contient(out, 'GPS-LAT')); validerJpeg(out);
  const casse = octets([0xff, 0xd8], seg(0xe1, octets('Exif\0\0', 'pas un tiff du tout')), seg(0xda, octets([1, 1, 0, 0, 0x3f, 0])), [1, 2, 0xff, 0xd9]);
  assert.strictEqual(w._retirerMetadonneesImage(casse), casse);
});

test('IA-11 : JPEG sans metadonnees, tronque ou malforme : l original est rendu tel quel', () => {
  const w = charger(IMG);
  const propre = jpegAvec({ exif: false, xmp: false, iptc: false });
  assert.strictEqual(w._retirerMetadonneesImage(propre), propre);
  const complet = jpegAvec();
  for (const n of [4, 10, 25, 60, 120]) { const t = complet.subarray(0, n); assert.strictEqual(w._retirerMetadonneesImage(t), t, 'tronque a ' + n); }
  const faux = jpegAvec().slice(); faux[4] = 0xff; faux[5] = 0xff;                // longueur de segment hors limites
  assert.strictEqual(w._retirerMetadonneesImage(faux), faux);
  for (const bruit of [new Uint8Array(0), octets('GIF89a....'), octets('<html><script>x</script></html>'), octets([0xff, 0xd8, 0xff])]) assert.strictEqual(w._retirerMetadonneesImage(bruit), bruit);
});

test('IA-11 : PNG - eXIf, tEXt, iTXt, zTXt retires ; IHDR, IDAT, IEND recopies octet pour octet', () => {
  const w = charger(IMG);
  const src = pngAvec(); const out = w._retirerMetadonneesImage(src);
  assert.deepEqual(validerPng(out), ['IHDR', 'IDAT', 'IEND']);
  for (const m of ['GPS-LAT', 'PNG-TEXTE-MARQUE', 'PNG-XMP-MARQUE']) assert.ok(!contient(out, m), m);
  const ref = octets(src.subarray(0, 8), chunkPng('IHDR', octets(be32(2), be32(2), [8, 2, 0, 0, 0])), chunkPng('IDAT', octets([9, 8, 7, 6, 5, 4])), chunkPng('IEND', new Uint8Array(0)));
  assert.deepEqual([...out], [...ref]);
  const rot = pngAvec({ orientation: 6 }); assert.strictEqual(w._retirerMetadonneesImage(rot), rot, 'eXIf avec rotation : intact');
  const sans = octets(src.subarray(0, 8), chunkPng('IHDR', octets(be32(2), be32(2), [8, 2, 0, 0, 0])), chunkPng('IDAT', octets([1])), chunkPng('IEND', new Uint8Array(0)));
  assert.strictEqual(w._retirerMetadonneesImage(sans), sans);
  const tronque = src.subarray(0, src.length - 7); assert.strictEqual(w._retirerMetadonneesImage(tronque), tronque);
});

test('IA-11 : WebP - EXIF et XMP retires, taille RIFF et drapeaux VP8X corriges', () => {
  const w = charger(IMG);
  const src = webpAvec(); const out = w._retirerMetadonneesImage(src);
  assert.deepEqual(validerWebp(out), ['VP8X', 'ICCP', 'VP8 ']);
  for (const m of ['GPS-LAT', 'WEBP-XMP-MARQUE']) assert.ok(!contient(out, m), m);
  assert.equal(out[20], 0x2c & ~0x0c, 'drapeaux EXIF/XMP effaces, ICC et alpha conserves');
  assert.equal(src[20], 0x2c);
  const rot = webpAvec({ orientation: 6 }); assert.strictEqual(w._retirerMetadonneesImage(rot), rot);
  const faux = webpAvec().slice(); faux[4] = 0xff; faux[5] = 0xff; faux[6] = 0xff; assert.strictEqual(w._retirerMetadonneesImage(faux), faux, 'taille RIFF mensongere');
  const tronque = webpAvec().subarray(0, 40); assert.strictEqual(w._retirerMetadonneesImage(tronque), tronque);
});

test('IA-11 : 6 000 mutations au hasard - jamais d exception, jamais de fichier invalide', () => {
  const w = charger(IMG);
  let graine = 12345; const alea = () => { graine = (graine * 1103515245 + 12345) & 0x7fffffff; return graine; };
  const bases = [[jpegAvec(), (o) => validerJpeg(o, false)], [pngAvec(), validerPng], [webpAvec(), validerWebp]];
  let changes = 0;
  for (const [base, valider] of bases) {
    for (let i = 0; i < 2000; i++) {
      let o = base.slice();
      const nb = 1 + (alea() % 4);
      for (let k = 0; k < nb; k++) { const q = alea() % 3; if (q === 0) o[alea() % o.length] = alea() & 255; else if (q === 1) o = o.subarray(0, 1 + (alea() % o.length)).slice(); else o[alea() % Math.min(o.length, 40)] ^= 1 << (alea() % 8); }
      const out = w._retirerMetadonneesImage(o);                // ne doit jamais lever
      if (out === o) continue;
      changes++;
      assert.ok(out.length < o.length); valider(out);
    }
  }
  assert.ok(changes > 100, 'le test exerce bien le chemin « nettoye » : ' + changes);
});

test('IA-11 : /api/upload-image enregistre une image SANS son EXIF/GPS', async () => {
  const pris = {};
  const env = { R2_PUBLIC_URL: 'https://pub.r2.dev', MESHES: { get: async () => null, put: async (k, v) => { pris[k] = v; return {}; } } };
  const w = charger([...COMMUN, ...IMG, 'handleUploadImage'], { getSessionUser: async () => ({ id: 'u1' }), getPrice: async () => 0, spendCredits: async () => 1, addCredits: async () => 1,
    logOperation: async () => {}, signedR2Url: async (e, k) => 'https://signed/' + k });
  const src = jpegAvec();
  const dataUrl = 'data:image/jpeg;base64,' + Buffer.from(src).toString('base64');
  const rep = await w.handleUploadImage(new Request('https://s/api/upload-image', { method: 'POST', body: JSON.stringify({ dataUrl }) }), env);
  assert.equal(rep.status, 200);
  const cle = Object.keys(pris).find((k) => k.includes('/canvas/'));
  assert.ok(cle, 'image enregistree');
  const stocke = pris[cle];
  assert.ok(!contient(stocke, 'GPS-LAT') && !contient(stocke, 'Exif'), 'le GPS ne doit pas atteindre R2');
  validerJpeg(stocke);
  const rot = jpegAvec({ orientation: 6 });
  const rep2 = await w.handleUploadImage(new Request('https://s/api/upload-image', { method: 'POST', body: JSON.stringify({ dataUrl: 'data:image/jpeg;base64,' + Buffer.from(rot).toString('base64') }) }), env);
  assert.equal(rep2.status, 200);
  const cles = Object.keys(pris).filter((k) => k.includes('/canvas/'));
  const stocke2 = pris[cles[cles.length - 1]];
  assert.ok(!contient(stocke2, 'GPS-LAT'), 'photo en portrait : le GPS part aussi');
  assert.equal(orientationDuJpeg(w, stocke2), 6, 'orientation conservee');
  validerJpeg(stocke2);
});

test('IA-11 : la photo envoyee a la generation 3D est nettoyee avant d etre rangee dans R2 (lecture du code)', () => {
  assert.match(lireSource(), /const fileBytes = _retirerMetadonneesImage\(new Uint8Array\(await input\.image\.arrayBuffer\(\)\)\)/);
});

/* ═══════════════════════ PB-06 : cache de la liste publique ═══════════════════════ */
function montageListe() {
  const r2 = creerR2({ '_market/listings/L1.json': JSON.stringify(fiche()), '_market/listings/L2.json': JSON.stringify(fiche({ id: 'L2', created_at: '2026-09-02T00:00:00Z' })) });
  const compte = { listes: 0, notes: 0 };
  const listOrig = r2.list.bind(r2); r2.list = async (o) => { if (o && String(o.prefix).startsWith('_market/listings/')) compte.listes++; return listOrig(o); };
  let barriere = null;
  const w = charger([...COMMUN, '_hachageCourt', 'NOM_VENDEUR_SUPPRIME', '_nomPublicVendeur', '_ficheVitrine', '_loadAllListings', '_offertsDuMois', '_moisCourant', '_finDuMois', '_getMarketKillSwitch',
    'MARCHE_LISTE_TTL_MS', '_cacheListeMarche', '_genCacheMarche', '_invaliderCacheMarche', '_reponseListeMarche', 'handleMarketList'],
  { siteUrl: SITE, _loadAllRatingsByListing: async () => { compte.notes++; if (barriere) await barriere; return new Map(); } });
  return { w, env: { MESHES: r2 }, compte, bloquer: () => { let lib; barriere = new Promise((r) => { lib = r; }); return () => { barriere = null; lib(); }; } };
}
const liste = (m) => m.w.handleMarketList(new Request('https://s/api/market/list'), m.env);

test('PB-06 : la 2e visite est servie par le cache (aucune relecture R2) avec Cache-Control public max-age=30', async () => {
  const m = montageListe();
  const a = await liste(m); const b = await liste(m);
  assert.equal(m.compte.listes, 1, 'une seule lecture de la liste pour deux visites');
  assert.equal(a.headers.get('cache-control'), 'public, max-age=30'); assert.equal(b.headers.get('cache-control'), 'public, max-age=30');
  assert.equal(await a.text(), await b.text());
  assert.equal(b.status, 200);
});

test('PB-06 : une invalidation (ecriture de fiche) force la relecture', async () => {
  const m = montageListe();
  await liste(m); await liste(m);
  m.w._invaliderCacheMarche();
  await liste(m);
  assert.equal(m.compte.listes, 2);
});

test('PB-06 : le cache expire apres 30 s', async () => {
  const m = montageListe(); const reel = Date.now; let t = reel();
  Date.now = () => t;
  try { await liste(m); t += 29_000; await liste(m); assert.equal(m.compte.listes, 1); t += 2_000; await liste(m); assert.equal(m.compte.listes, 2); } finally { Date.now = reel; }
});

test('PB-06 : une lecture commencee AVANT une ecriture ne remet pas un contenu perime dans le cache', async () => {
  const m = montageListe();
  const liberer = m.bloquer();
  const lente = liste(m);                                  // bloquee dans la lecture des notes
  await new Promise((r) => setTimeout(r, 20));
  m.w._invaliderCacheMarche();                              // une ecriture survient pendant la lecture
  liberer(); await lente;
  await liste(m);
  assert.equal(m.compte.listes, 2, 'la reponse lente n a pas ete mise en cache');
});

test('PB-06 : le routeur invalide le cache apres toute requete d ecriture (lecture du code)', () => {
  const src = lireSource();
  assert.match(src, /finally \{ if \(req\.method !== 'GET' && req\.method !== 'HEAD' && req\.method !== 'OPTIONS'\) _invaliderCacheMarche\(\); \}/);
  assert.match(src, /return await _avecCleApi\(req, _envAvecReprises\(envBrut\), routeur, ctx\);\s+return await routeur\(\);/);
});

/* ═══════════════════════ D-11 : diagnostic detaille ═══════════════════════ */
test('D-11 : la fonction de diagnostic detaille n existe plus et personne ne l appelle', () => {
  const src = lireSource();
  assert.ok(!/function _enregistrerDiagnostic/.test(src), 'definition supprimee');
  assert.ok(!/_enregistrerDiagnostic\s*\(/.test(src), 'aucun appel');
  assert.ok(!/ville: cf\.city/.test(src), 'plus de champ ville dans un enregistrement de diagnostic');
});

/* ═══════════════════════ ADM-03 : revocation des sessions admin ═══════════════════════ */
const MDP = 'x'.repeat(24);
function montageAdmin(envExtra = {}) {
  const r2 = creerR2({});
  const env = { MESHES: r2, ADMIN_PASSWORD: MDP, ...envExtra };
  const audits = [];
  const w = charger([...COMMUN, 'parseCookies', 'ADMIN_COOKIE', 'ADMIN_TTL_SEC', '_hmacSign', '_getAdminPasswordSource', 'ADMIN_EPOCH_KEY', '_lireEpoqueAdmin',
    '_valeurCookieAdmin', '_adminTokenCheck', 'handleAdminRevokeSessions'],
  { _requireAdmin: async () => ({ id: 'adm', email: 'admin@x.example', credits: 0 }), _verifyAdminPassword: async (e, p) => p === 'bon', _adminFailGate: async () => false,
    _auditLog: async (e, o) => { audits.push(o); } });
  const reqAvec = (valeur) => new Request('https://s/api/admin/x', { headers: valeur ? { cookie: `admin_session=${encodeURIComponent(valeur)}` } : {} });
  const exp = () => Math.floor(Date.now() / 1000) + 3600;
  const cookieHistorique = async () => { const charge = `admin@x.example:${exp()}`; return `${charge}.${await w._hmacSign(MDP, charge)}`; };
  const revoquer = async (mdp = 'bon') => { const rep = await w.handleAdminRevokeSessions(new Request('https://s/api/admin/revoke-sessions', { method: 'POST', body: JSON.stringify({ password: mdp }) }), env); return rep; };
  const valeurDuCookie = (rep) => { const sc = rep.headers.get('set-cookie'); return sc ? decodeURIComponent(/admin_session=([^;]*)/.exec(sc)[1]) : null; };
  const verifier = (valeur) => w._adminTokenCheck(reqAvec(valeur), env);
  return { w, env, r2, audits, cookieHistorique, revoquer, valeurDuCookie, verifier };
}

test('ADM-03 : epoque absente (0) - le cookie historique (sans epoque) reste valide, et le cookie emis garde le format historique', async () => {
  const m = montageAdmin();
  assert.equal(await m.verifier(await m.cookieHistorique()), true);
  const attendu = `admin@x.example:1893456000.${await m.w._hmacSign(MDP, 'admin@x.example:1893456000')}`;
  assert.equal(await m.w._valeurCookieAdmin('Admin@X.example', 1893456000, MDP, 0), attendu, 'octet pour octet le cookie d avant la modification');
  const v = await m.w._valeurCookieAdmin('Admin@X.example', 1893456000, MDP, 0);
  assert.match(v, /^admin@x\.example:1893456000\.[A-Za-z0-9_-]+$/, 'aucune epoque dans le format tant que l epoque vaut 0');
  assert.equal(await m.verifier(v), true);
});

test('ADM-03 : une revocation invalide l ancien cookie, et l appelant recoit un cookie neuf valide', async () => {
  const m = montageAdmin();
  const ancien = await m.cookieHistorique();
  assert.equal(await m.verifier(ancien), true);
  const rep = await m.revoquer();
  assert.equal(rep.status, 200); assert.equal((await lire(rep)).epoch, 1);
  assert.equal(JSON.parse(m.r2.lire('_meta/admin_epoch.json')).epoch, 1);
  const neuf = m.valeurDuCookie(rep);
  assert.ok(neuf && neuf.slice(0, neuf.lastIndexOf('.')).split(':').length === 3, 'le cookie neuf porte l epoque');
  assert.equal(await m.verifier(neuf), true, 'l administrateur reste connecte');
  assert.equal(await m.verifier(ancien), false, 'l ancien cookie est revoque');
  assert.ok(m.audits.some((a) => a.action === 'revoke_admin_sessions'));
});

test('ADM-03 : deuxieme revocation - le cookie de la premiere ne vaut plus ; epoque falsifiee refusee (signature)', async () => {
  const m = montageAdmin();
  const c1 = m.valeurDuCookie(await m.revoquer());
  const c2 = m.valeurDuCookie(await m.revoquer());
  assert.equal(await m.verifier(c1), false); assert.equal(await m.verifier(c2), true);
  const [charge, sig] = [c2.slice(0, c2.lastIndexOf('.')), c2.slice(c2.lastIndexOf('.') + 1)];
  const parts = charge.split(':'); parts[2] = '9';
  assert.equal(await m.verifier(`${parts.join(':')}.${sig}`), false, 'changer l epoque sans la cle casse la signature');
  assert.equal(await m.verifier(`${parts.slice(0, 2).join(':')}.${sig}`), false, 'retirer l epoque aussi');
});

test('ADM-03 : mauvais mot de passe - 401 et l epoque ne bouge pas ; cookie de l ancien format toujours accepte', async () => {
  const m = montageAdmin();
  const ancien = await m.cookieHistorique();
  const rep = await m.revoquer('mauvais');
  assert.equal(rep.status, 401);
  assert.equal(m.r2.lire('_meta/admin_epoch.json'), undefined);
  assert.equal(await m.verifier(ancien), true);
});

test('ADM-03 : fichier d epoque absent ou illisible -> epoque 0, l administrateur n est jamais enferme dehors', async () => {
  const m = montageAdmin();
  const ancien = await m.cookieHistorique();
  m.r2.ecrire('_meta/admin_epoch.json', 'pas du json');
  assert.equal(await m.verifier(ancien), true);
  const m2 = montageAdmin(); m2.r2.get = async () => { throw new Error('R2 en panne'); };
  assert.equal(await m2.verifier(await m2.cookieHistorique()), true);
});

test('ADM-03 : la connexion admin emet son cookie par _valeurCookieAdmin avec l epoque en vigueur (lecture du code) ; la route est branchee', () => {
  const src = lireSource();
  assert.match(src, /const value = await _valeurCookieAdmin\(user\.email, exp, pwSrc\.signingKey, await _lireEpoqueAdmin\(env\)\);/);
  assert.match(src, /pathname === '\/api\/admin\/revoke-sessions' && method === 'POST'\) return await handleAdminRevokeSessions\(req, env\)/);
});
