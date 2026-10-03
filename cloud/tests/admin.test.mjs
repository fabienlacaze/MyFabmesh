// Tests de securite du worker (analyse du 03/10/2026) : SSRF (CLOUD-05), consentement boutique (SM-03/F4), administration (ADM-07/08/12, D-10),
// alerte contenu illicite (IA-07), fiches de la place de marche (IA-08, SM-09), pre-chauffe du redacteur (CLOUD-11).
// Charge les VRAIES fonctions depuis src/worker.ts (transpilees), avec des doublures. Aucun reseau.
// Lancer : cd cloud && node --test tests/admin.test.mjs
// Contre l'ancien code : WORKER_SRC=<copie de git show HEAD:cloud/src/worker.ts> node --test tests/admin.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');

const chemin = process.env.WORKER_SRC || new URL('../src/worker.ts', import.meta.url);
const SRC = readFileSync(chemin, 'utf8').replace(/\r\n/g, '\n');

/** Extrait le texte entre deux ancres (la seconde doit suivre la premiere) et le transpile. */
function tranche(debut, fin) {
  const a = SRC.indexOf(debut);
  assert.ok(a >= 0, 'ancre de debut introuvable : ' + debut);
  const b = SRC.indexOf(fin, a + debut.length);
  assert.ok(b > a, 'ancre de fin introuvable : ' + fin);
  return ts.transpileModule(SRC.slice(a, b), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
}
/** Assemble des tranches et rend les noms demandes ; `doublures` = { nom: valeur } injectees comme parametres. */
function charger(morceaux, retour, doublures = {}) {
  const js = morceaux.map(([d, f]) => tranche(d, f)).join('\n');
  const noms = Object.keys(doublures);
  // Un nom absent (ancien code) rend `undefined` au lieu de lever, pour que le test echoue sur l'ASSERTION.
  const rendu = retour.map((n) => `${n}: typeof ${n} === "undefined" ? undefined : ${n}`).join(', ');
  return new Function(...noms, js + `; return { ${rendu} };`)(...noms.map((n) => doublures[n]));
}
const err = (status, message) => new Response(JSON.stringify({ error: message }), { status, headers: { 'content-type': 'application/json' } });
const json = (o, init) => new Response(JSON.stringify(o), { status: init?.status ?? 200, headers: { 'content-type': 'application/json' } });

/* ====================== CLOUD-05 : SSRF ====================== */
const ENV_SSRF = { NEXT_PUBLIC_SITE_URL: 'https://site.example', R2_ACCOUNT_ID: 'acc123', R2_PUBLIC_URL: 'https://pub.example' };
const { isTrustedAssetHost } = charger([['function isTrustedAssetHost', '/** Bump a listing']], ['isTrustedAssetHost']);

test('isTrustedAssetHost : table de cas (URL signee, hote de confiance, externe, http, localhost, IPv6)', () => {
  const ok = [
    'https://site.example/r2/u1/a.png?exp=1&sig=abc',
    'https://replicate.delivery/a.png', 'https://pbxt.replicate.delivery/a.png',
    'https://acc123.r2.cloudflarestorage.com/bucket/x.png', 'https://pub.example/x.png',
  ];
  const ko = [
    'https://site.example/api/me', 'https://evil.example/r2/u1/a.png', 'http://site.example/r2/u1/a.png',
    'http://replicate.delivery/a.png', 'https://localhost/r2/a', 'https://127.0.0.1/x', 'https://[::1]/r2/a',
    'https://[::ffff:7f00:1]/x', 'https://169.254.169.254/latest/meta-data', 'file:///etc/passwd', 'ftp://replicate.delivery/a',
    'https://replicate.delivery.evil.example/a', 'https://replicate.delivery@evil.example/a', 'https://other.r2.cloudflarestorage.com/x',
    '', 'pas une url',
  ];
  for (const u of ok) assert.equal(isTrustedAssetHost(ENV_SSRF, u), true, 'doit etre accepte : ' + u);
  for (const u of ko) assert.equal(isTrustedAssetHost(ENV_SSRF, u), false, 'doit etre refuse : ' + u);
});

function chargerRectify() {
  return charger([['async function handleRectifyImage', '// CSV-field escape']], ['handleRectifyImage'],
    { getSessionUser: async () => ({ id: 'u1' }), err, json, isTrustedAssetHost });
}
const requeteRectify = (corps) => new Request('https://site.example/api/rectify-image', { method: 'POST', body: JSON.stringify(corps) });

test('handleRectifyImage : refImageUrl non fiable refusee (400) AVANT tout debit', async () => {
  const { handleRectifyImage } = chargerRectify();
  for (const u of ['http://127.0.0.1:8080/x', 'https://evil.example/a.png', 'file:///etc/passwd', 'https://[::1]/x', 'http://site.example/r2/a']) {
    const r = await handleRectifyImage(requeteRectify({ refImageUrl: u, prompt: '' }), { ...ENV_SSRF, MODAL_RECTIFY_URL: 'https://modal.example' });
    assert.equal(r.status, 400, u);
    assert.match((await r.json()).error, /host not allowed/);
  }
});

test('handleRectifyImage : une URL signee du site passe la garde (le flux legitime continue)', async () => {
  const { handleRectifyImage } = chargerRectify();
  // La garde est franchie : le code poursuit vers la tarification, absente de nos doublures -> ReferenceError, jamais un 400.
  await assert.rejects(handleRectifyImage(requeteRectify({ refImageUrl: 'https://site.example/r2/u1/a.png?exp=1&sig=x', prompt: '' }),
    { ...ENV_SSRF, MODAL_RECTIFY_URL: 'https://modal.example' }), /not defined|is not a function|undefined/);
});

test('_cleDepuisUrlSignee : un hote etranger a chemin /r2/ n est JAMAIS ouvert', async () => {
  const appels = [];
  const { _cleDepuisUrlSignee } = charger([['async function _cleDepuisUrlSignee', 'function _cleLegere']], ['_cleDepuisUrlSignee'],
    { assetFetch: async (_e, u) => { appels.push(u); return new Response('x', { status: 200 }); }, siteUrl: (env) => env.NEXT_PUBLIC_SITE_URL });
  assert.equal(await _cleDepuisUrlSignee(ENV_SSRF, 'https://evil.example/r2/u1/x.glb'), null);
  assert.equal(await _cleDepuisUrlSignee(ENV_SSRF, 'http://169.254.169.254/r2/x'), null);
  assert.deepEqual(appels, [], 'aucun appel reseau vers un hote etranger');
  assert.equal(await _cleDepuisUrlSignee(ENV_SSRF, 'https://site.example/r2/u1/x.glb?exp=1&sig=z'), 'u1/x.glb');
  assert.equal(appels.length, 1);
});

/* ====================== SM-03 / F4 : consentement a la boutique ====================== */
test('validerConsentementMarche : consent === true exige, horodatage borne', () => {
  const { validerConsentementMarche: v } = charger([['function validerConsentementMarche', '/** POST /api/market/checkout']], ['validerConsentementMarche']);
  assert.equal(typeof v, 'function');
  for (const c of [undefined, null, {}, { consent: false }, { consent: 'true' }, { consent: 1 }]) {
    const r = v(c, '2026-10-03T10:00:00Z'); assert.equal(r.ok, false); assert.match(r.message, /consentement/i);
  }
  assert.deepEqual(v({ consent: true, consentedAt: '2026-10-03T09:00:00Z' }, 'X'), { ok: true, consentedAt: '2026-10-03T09:00:00Z' });
  assert.equal(v({ consent: true }, 'MAINTENANT').consentedAt, 'MAINTENANT');
  assert.equal(v({ consent: true, consentedAt: 'x'.repeat(41) }, 'MAINTENANT').consentedAt, 'MAINTENANT');
});

test('handleMarketCheckout : sans consent -> 400 ; avec consent -> metadonnees de renonciation, facture et recu', async () => {
  const vus = [];
  const listing = { id: 'L1', status: 'approved', price_cents: 500, currency: 'eur', title: 'Epee', asset_kind: 'mesh', licence: 'personal', user_id: 'vendeur' };
  const doublures = {
    _venteBloqueeParMentions: () => null, _marketGate: async () => null, getSessionUser: async () => ({ id: 'u1', email: 'a@b.fr' }),
    isMock: () => false, err, json, r2GetText: async () => JSON.stringify(listing), siteUrl: () => 'https://site.example',
    _stripeCheckoutSessionsUrl: () => 'https://stripe.test/v1/checkout/sessions',
  };
  // _stripeForm est reel (il encode les objets imbriques) ; fetch est simule.
  const { handleMarketCheckout } = charger([['function _stripeForm', '/** 2026-10-03 (constats SM-03'], ['function validerConsentementMarche', '/** Webhook helper: persist ownership']],
    ['handleMarketCheckout'], doublures);
  assert.equal(typeof handleMarketCheckout, 'function');
  globalThis.fetch = async (u, init) => { vus.push(String(init.body)); return new Response(JSON.stringify({ id: 'cs_1', url: 'https://pay' }), { status: 200 }); };
  const env = { STRIPE_SECRET_KEY: 'sk_live_x', MESHES: { head: async () => null } };
  const q = (corps) => new Request('https://site.example/api/market/checkout', { method: 'POST', body: JSON.stringify(corps) });

  const r1 = await handleMarketCheckout(q({ listing_ids: ['L1'] }), env);
  assert.equal(r1.status, 400); assert.equal(vus.length, 0, 'aucune session Stripe sans consentement');
  const r2 = await handleMarketCheckout(q({ listing_ids: ['L1'], consent: false }), env);
  assert.equal(r2.status, 400);
  const r3 = await handleMarketCheckout(q({ listing_ids: ['L1'], consent: true, consentedAt: '2026-10-03T09:00:00Z' }), env);
  assert.equal(r3.status, 200);
  const corps = new URLSearchParams(vus[0]);
  assert.equal(corps.get('metadata[withdrawal_waiver]'), 'accepted');
  assert.equal(corps.get('metadata[withdrawal_waiver_at]'), '2026-10-03T09:00:00Z');
  assert.equal(corps.get('invoice_creation[enabled]'), 'true');
  assert.equal(corps.get('payment_intent_data[receipt_email]'), 'a@b.fr');
  assert.equal(corps.get('metadata[kind]'), 'market_purchase');
});

/* ====================== ADM-07 : verrouillage des echecs ====================== */
const ANCRES_ECHECS = [['async function _adminFailGate', '/** POST /api/admin/totp/confirm']];
function chargerEchecs() {
  const stock = new Map();
  const MESHES = {
    get: async (k) => (stock.has(k) ? { json: async () => JSON.parse(stock.get(k)), text: async () => stock.get(k) } : null),
    put: async (k, v) => { stock.set(k, String(v)); },
  };
  const mod = charger(ANCRES_ECHECS, ['_adminFailGate', 'etatEchecsAdmin'], {});
  return { ...mod, MESHES, stock };
}
const reqIp = (ip) => new Request('https://site.example/x', { headers: { 'cf-connecting-ip': ip } });

test('etatEchecsAdmin : fenetre d une heure et plafond', () => {
  const { etatEchecsAdmin: f } = chargerEchecs();
  assert.equal(typeof f, 'function');
  let etat = null;
  for (let i = 1; i <= 9; i++) { const r = f(etat, 1000, true, 10); etat = r.f; assert.equal(r.bloque, false); }
  assert.equal(f(etat, 1000, true, 10).bloque, true, '10e echec : bloque');
  assert.equal(f(etat, 1000, false, 10).bloque, false, 'lecture seule : ne compte pas');
  assert.equal(f({ count: 50, first_ts: 1 }, 1 + 3600_001, false, 10).bloque, false, 'fenetre expiree : remise a zero');
});

test('_adminFailGate : bloque a 10 echecs depuis une IP, et a 30 echecs repartis sur des IP differentes (global)', async () => {
  const { _adminFailGate, MESHES } = chargerEchecs();
  assert.equal(typeof _adminFailGate, 'function');
  const env = { MESHES };
  for (let i = 0; i < 9; i++) assert.equal(await _adminFailGate(reqIp('1.1.1.1'), env, 'credits', true), false);
  assert.equal(await _adminFailGate(reqIp('1.1.1.1'), env, 'credits', true), true, '10e echec de la meme IP');
  assert.equal(await _adminFailGate(reqIp('1.1.1.1'), env, 'credits', false), true);
  assert.equal(await _adminFailGate(reqIp('2.2.2.2'), env, 'reconcile', false), false, 'une autre action n est pas verrouillee');
  // changer d adresse a chaque essai : le plafond par IP ne mord jamais, le global oui
  const m2 = chargerEchecs();
  const env2 = { MESHES: m2.MESHES };
  let bloque = false, n = 0;
  while (!bloque && n < 100) { n++; bloque = await m2._adminFailGate(reqIp('9.9.9.' + n), env2, 'reconcile', true); }
  assert.equal(n, 30, 'bloque au 30e echec, toutes IP confondues');
});

const PRELUDE_ADMIN = { err, json, getSessionUser: async () => ({ id: 'a' }) };
function chargerRoute(nom, suivante) {
  const mod = chargerEchecs();
  const doublures = { _requireAdmin: async () => ({ id: 'a', email: 'admin@x.fr', credits: 0 }), _verifyAdminPassword: async () => false, err, json,
    _adminFailGate: mod._adminFailGate, _auditLog: async () => {}, supabaseAdmin: () => { throw new Error('ne doit pas etre atteint'); }, addCredits: async () => null };
  const m = charger([[`async function ${nom}`, suivante]], [nom], doublures);
  return { handler: m[nom], MESHES: mod.MESHES };
}
test('handleAdminAdjustCredits : mot de passe faux -> 401 jusqu au plafond puis 429 (n est plus un oracle sans limite)', async () => {
  const { handler, MESHES } = chargerRoute('handleAdminAdjustCredits', '/**');
  assert.equal(typeof handler, 'function');
  const q = () => new Request('https://site.example/api/admin/users/credits', { method: 'POST', headers: { 'cf-connecting-ip': '3.3.3.3' },
    body: JSON.stringify({ userId: 'u', delta: 5, reason: 'test', password: 'faux' }) });
  const statuts = [];
  for (let i = 0; i < 12; i++) statuts.push((await handler(q(), { MESHES })).status);
  assert.deepEqual(statuts.slice(0, 10), Array(10).fill(401));
  assert.deepEqual(statuts.slice(10), [429, 429]);
});
test('handleAdminReconcilePayment : mot de passe faux -> 401 jusqu au plafond puis 429', async () => {
  const { handler, MESHES } = chargerRoute('handleAdminReconcilePayment', '/** GET');
  assert.equal(typeof handler, 'function');
  const q = () => new Request('https://site.example/api/admin/payments/reconcile', { method: 'POST', headers: { 'cf-connecting-ip': '4.4.4.4' },
    body: JSON.stringify({ sessionId: 'cs_x', password: 'faux' }) });
  const statuts = [];
  for (let i = 0; i < 12; i++) statuts.push((await handler(q(), { MESHES })).status);
  assert.deepEqual(statuts.slice(0, 10), Array(10).fill(401));
  assert.deepEqual(statuts.slice(10), [429, 429]);
});

/* ====================== ADM-12 : Origin sur les ecritures admin ====================== */
test('ecritureAdminDepuisAutreOrigine : seule une ECRITURE admin avec Origin etranger est refusee', () => {
  const { ecritureAdminDepuisAutreOrigine: refus, _origineSuspecte } = charger([['function _origineSuspecte', '/** Essais de PIN'], ['function ecritureAdminDepuisAutreOrigine', '\n/**']].filter(Boolean), ['ecritureAdminDepuisAutreOrigine', '_origineSuspecte']);
  assert.equal(typeof refus, 'function');
  const env = { NEXT_PUBLIC_SITE_URL: 'https://site.example' };
  const r = (origin) => new Request('https://site.example/api/admin/x', { method: 'POST', headers: origin === undefined ? {} : { origin } });
  assert.equal(refus('/api/admin/users/ban', 'POST', r('https://evil.example'), env), true, 'Origin etranger : refuse');
  assert.equal(refus('/api/admin/users/ban', 'DELETE', r('null'), env), true, 'Origin null (page isolee) : refuse');
  assert.equal(refus('/api/admin/users/ban', 'POST', r('https://site.example'), env), false, 'page /admin2 (meme origine)');
  assert.equal(refus('/api/admin/users/ban', 'POST', r(undefined), env), false, 'outil en ligne de commande : pas d en-tete Origin');
  assert.equal(refus('/api/admin/users', 'GET', r('https://evil.example'), env), false, 'lecture : non concernee');
  assert.equal(refus('/api/me', 'POST', r('https://evil.example'), env), false, 'hors /api/admin : non concerne ici');
});

/* ====================== ADM-08 / D-10 : journal ====================== */
test('auditLectureDue : au plus une ligne par action et par 10 minutes', () => {
  const { auditLectureDue: due } = charger([['const AUDIT_LECTURE_FENETRE_MS', 'async function _auditLecture']], ['auditLectureDue'], {});
  assert.equal(typeof due, 'function');
  assert.equal(due(null, 1_000_000), true, 'jamais journalise : oui');
  assert.equal(due(undefined, 1_000_000), true);
  assert.equal(due(NaN, 1_000_000), true);
  assert.equal(due(1_000_000 - 60_000, 1_000_000), false, 'il y a 1 min : non');
  assert.equal(due(1_000_000 - 600_001, 1_000_000), true, 'il y a plus de 10 min : oui');
  assert.equal(due(1_000_000 + 5_000, 1_000_000), true, 'horloge incoherente (marqueur dans le futur) : on journalise');
});
test('le journal ne contient plus l identifiant saisi, seulement sa longueur', () => {
  assert.ok(!/tried:\s*providedUser/.test(SRC), 'l identifiant saisi ne doit plus etre journalise');
  assert.match(SRC, /tried_length:\s*providedUser\.length/);
});
test('gestionnaires sensibles : chacun appelle _auditLog ou _auditLecture', () => {
  const noms = ['handleAdminMarketKillSwitchSet', 'handleAdminMarketApprove', 'handleAdminMarketReject', 'handleAdminMarketDelete', 'handleAdminContactReply', 'handleAdminContactDelete',
    'handleAdminModalSetBudget', 'handleAdminContactList', 'handleAdminHistoryCsv', 'handleAdminHistoryXls', 'handleAdminListUsers', 'handleAdminCreations', 'handleAdminLogsGet',
    'handleAdminPayments', 'handleAdminImagesRecent', 'handleAdminUserImages'];
  for (const n of noms) {
    const a = SRC.indexOf('async function ' + n + '(');
    assert.ok(a >= 0, n);
    const corps = SRC.slice(a, a + 2500);
    assert.match(corps, /_audit(Log|Lecture)\(env/, n + ' doit etre journalise');
  }
});

/* ====================== IA-07 : alerte sur contenu illicite grave ====================== */
const ANCRES_ALERTE = [['type CategorieContenuGrave', '/** Check the per-user daily call cap']];
const SORTIES_ALERTE = ['categorieContenuGrave', 'alerteContenuDue', 'texteAlerteContenu', '_alerterContenuGrave', '_checkPromptSafetyAlerte'];
const FLOOR = { safe: false, blocked: 'minor-safety', reason: 'Blocked: depicting minors in this context is illegal and cannot be generated under any setting.' };
const FLOOR_MOT = { safe: false, blocked: 'pedophil', reason: 'Blocked: this content is illegal and cannot be generated under any setting.' };
const SOUPLE = { safe: false, blocked: 'nude', reason: 'Content filter: "nude" is blocked. Modify your prompt or contact support to request unrestricted access.' };

test('categorieContenuGrave : seul le plancher dur declenche (minor / illegal), jamais le filtre souple', () => {
  const { categorieContenuGrave: c } = charger(ANCRES_ALERTE, SORTIES_ALERTE, { checkPromptSafety: () => ({ safe: true }), _sendAdminAlertEmail: async () => {} });
  assert.equal(typeof c, 'function');
  assert.equal(c(FLOOR), 'minor');
  assert.equal(c(FLOOR_MOT), 'illegal');
  assert.equal(c(SOUPLE), null);
  assert.equal(c({ safe: true }), null);
  assert.equal(c(null), null);
});

test('alerteContenuDue : une alerte par compte et par heure', () => {
  const { alerteContenuDue: d } = charger(ANCRES_ALERTE, SORTIES_ALERTE, { checkPromptSafety: () => ({ safe: true }), _sendAdminAlertEmail: async () => {} });
  const H = 3600_000, T = 10 * H;
  assert.equal(d(null, null, T), false, 'pas de categorie : jamais');
  assert.equal(d('minor', null, T), true, 'premiere fois');
  assert.equal(d('minor', T - 59 * 60_000, T), false, 'il y a 59 min : non');
  assert.equal(d('illegal', T - H - 1, T), true, 'il y a plus d une heure : oui');
  assert.equal(d('illegal', T + 1000, T), true, 'marqueur dans le futur (horloge) : on alerte');
});

test('_checkPromptSafetyAlerte : e-mail sans le texte du prompt, 1 par compte et par heure ; le resultat du filtre est inchange', async () => {
  const mails = [];
  const stock = new Map();
  const env = { MESHES: { get: async (k) => (stock.has(k) ? { text: async () => stock.get(k) } : null), put: async (k, v) => { stock.set(k, String(v)); } } };
  const SECRET = 'texte-du-prompt-secret-xyz';
  const m = charger(ANCRES_ALERTE, SORTIES_ALERTE, {
    checkPromptSafety: (p) => (p.includes('LOLI') ? FLOOR : p.includes('NUDE') ? SOUPLE : { safe: true }),
    _sendAdminAlertEmail: async (_e, sujet, texte) => { mails.push({ sujet, texte }); },
  });
  assert.equal(typeof m._checkPromptSafetyAlerte, 'function');
  const r = await m._checkPromptSafetyAlerte(env, 'abcdef12-aaaa', SECRET + ' LOLI', false);
  assert.equal(r.safe, false); assert.equal(r.blocked, 'minor-safety');
  assert.equal(mails.length, 1);
  assert.ok(!mails[0].texte.includes(SECRET) && !mails[0].sujet.includes(SECRET), 'le prompt ne figure pas dans l alerte');
  assert.match(mails[0].texte, /minor/); assert.match(mails[0].texte, /abcdef12/);
  await m._checkPromptSafetyAlerte(env, 'abcdef12-aaaa', 'LOLI encore', false);
  assert.equal(mails.length, 1, 'meme compte dans l heure : pas de seconde alerte');
  await m._checkPromptSafetyAlerte(env, 'autre-compte-1', 'LOLI', false);
  assert.equal(mails.length, 2, 'un autre compte est alerte separement');
  await m._checkPromptSafetyAlerte(env, 'troisieme-cpt', 'NUDE', false);
  assert.equal(mails.length, 2, 'filtre souple : aucune alerte');
  const ok = await m._checkPromptSafetyAlerte(env, 'quatrieme-c', 'un chat', false);
  assert.equal(ok.safe, true);
});

test('tous les appels au filtre passent par la version avec alerte', () => {
  const brut = SRC.match(/checkPromptSafety\(/g) || [];
  const enveloppe = SRC.match(/_checkPromptSafetyAlerte\(/g) || [];
  // 11 appels de l'enveloppe + sa definition ; le seul appel brut restant est celui de l'enveloppe elle-meme
  assert.ok(enveloppe.length >= 12, 'au moins 11 usages + la definition');
  assert.equal(brut.length, 1, 'un seul appel direct au filtre : dans l enveloppe');
});

/* ====================== IA-08 / SM-09 : fiches de la place de marche ====================== */
function chargerMarche(sortieSupp = []) {
  const ecrits = [];
  const stock = { 'L1': JSON.stringify({ id: 'L1', user_id: 'u1', status: 'approved', title: 'Epee', description: 'd', price_cents: 500, currency: 'EUR', licence: 'personal' }) };
  const doublures = {
    _marketGate: async () => null, getSessionUser: async () => ({ id: 'u1' }), err, json,
    r2GetText: async (_e, cle) => stock[cle.replace('_market/listings/', '').replace('.json', '')] ?? null,
    _checkPromptSafetyAlerte: async (_e, _u, t) => (/nsfw/i.test(t) ? { safe: false, reason: 'Content filter: "nsfw" is blocked.' } : { safe: true }),
    APERCU_PREFIXE: 'x/', _retirerDesOfferts: async () => {},
  };
  const m = charger([['const MARKET_LICENCES', "/** Cle R2 d'un actif de fiche"], ['async function handleMarketUpdate', '/** POST /api/market/unpublish']],
    ['validerPrixFiche', 'validerTexteFiche', '_filtrerTexteFiche', 'handleMarketUpdate', ...sortieSupp], doublures);
  const env = { MESHES: { put: async (k, v) => { ecrits.push([k, JSON.parse(v)]); } } };
  const patch = (corps) => m.handleMarketUpdate(new Request('https://site.example/api/market/listing/L1', { method: 'PATCH', body: JSON.stringify(corps) }), env, 'L1');
  return { ...m, ecrits, patch };
}

test('validerPrixFiche : entier, 0 ou au moins 50 centimes, maximum', () => {
  const { validerPrixFiche: v } = chargerMarche();
  assert.equal(typeof v, 'function');
  for (const bon of [0, 50, 51, 500, 1_000_000, '250']) assert.equal(v(bon).ok, true, String(bon));
  for (const mauvais of [1, 49, -1, 10.5, NaN, Infinity, 1_000_001, 'abc', '', true, {}, []]) assert.equal(v(mauvais).ok, false, String(mauvais));
  assert.equal(v('250').cents, 250);
});

test('validerTexteFiche : < et > refuses dans le titre et la description', () => {
  const { validerTexteFiche: v } = chargerMarche();
  assert.equal(typeof v, 'function');
  assert.equal(v('Epee magique', 'Une belle epee').ok, true);
  assert.equal(v(undefined, undefined).ok, true);
  assert.equal(v('<script>alert(1)</script>', 'x').ok, false);
  assert.equal(v('ok', 'a > b').ok, false);
  assert.equal(v('ok', 'a < b').ok, false);
  assert.match(v('<b>', '').message, /caract/);
});

test('handleMarketUpdate (la route active) : prix, licence, caracteres et filtre appliques', async () => {
  const m = chargerMarche();
  assert.equal(typeof m.handleMarketUpdate, 'function');
  for (const prix of [1, 49, 10.5, -3, 1_000_001]) {
    assert.equal((await m.patch({ price_cents: prix })).status, 400, 'prix refuse : ' + prix);
  }
  assert.equal((await m.patch({ licence: 'inconnue' })).status, 400);
  assert.equal((await m.patch({ title: '<img src=x onerror=alert(1)>' })).status, 400);
  assert.equal((await m.patch({ description: 'voir <script>' })).status, 400);
  assert.equal((await m.patch({ title: 'un titre nsfw' })).status, 400, 'filtre de contenu');
  assert.equal(m.ecrits.length, 0, 'rien n est ecrit quand une validation echoue');
  for (const prix of [0, 50, 1200]) assert.equal((await m.patch({ price_cents: prix, licence: 'cc0', title: 'Epee +2' })).status, 200, 'prix accepte : ' + prix);
  assert.equal(m.ecrits.length, 3);
  assert.equal(m.ecrits[2][1].price_cents, 1200);
  assert.equal(m.ecrits[2][1].status, 'pending');
});

test('la route PATCH /api/market/listing/<id> n est declaree qu une fois', () => {
  const n = SRC.split("method === 'PATCH') return await handleMarket").length - 1;
  assert.equal(n, 1, 'une seule declaration de route PATCH de modification de fiche');
  assert.ok(!SRC.includes('handleMarketListingUpdate'), 'la fonction morte est supprimee');
});

/* ====================== CLOUD-11 : pre-chauffe du redacteur ====================== */
test('prechauffeRedacteurDue : une pre-chauffe par minute et par compte', () => {
  const { prechauffeRedacteurDue: d } = charger([['const PRECHAUFFE_REDACTEUR_FENETRE_MS', 'async function handleDescribeAsset']], ['prechauffeRedacteurDue']);
  assert.equal(typeof d, 'function');
  assert.equal(d(null, 100_000), true);
  assert.equal(d(100_000 - 30_000, 100_000), false);
  assert.equal(d(100_000 - 60_001, 100_000), true);
  assert.equal(d(100_000 + 1, 100_000), true, 'marqueur dans le futur : on laisse passer');
});

test('handleDescribeAsset : la 2e pre-chauffe de la minute ne reveille PAS Modal', async () => {
  const stock = new Map(); let appelsModal = 0;
  const env = { MODAL_REDACTEUR_URL: 'https://modal.example/redacteur', MODAL_SHARED_SECRET: 's',
    MESHES: { get: async (k) => (stock.has(k) ? { text: async () => stock.get(k) } : null), put: async (k, v) => { stock.set(k, String(v)); } } };
  globalThis.fetch = async () => { appelsModal++; return new Response(JSON.stringify({ ok: true }), { status: 200 }); };
  const m = charger([['const PRECHAUFFE_REDACTEUR_FENETRE_MS', '/* ────────────────────────── main fetch handler']],
    ['handleDescribeAsset'], { getSessionUser: async () => ({ id: 'u1' }), err, json, REDACTEUR_TYPES: new Set(['character']) });
  const q = () => m.handleDescribeAsset(new Request('https://site.example/api/describe-asset', { method: 'POST', body: JSON.stringify({ prechauffer: true }) }), env);
  assert.equal((await q()).status, 200);
  assert.equal((await q()).status, 200);
  assert.equal((await q()).status, 200);
  assert.equal(appelsModal, 1, 'un seul reveil de conteneur en une minute');
});

/* ====================== CLOUD-05 (suite) : autres transmetteurs d URL ====================== */
test('handleRemoveBackground : une adresse http(s) non fiable est refusee avant tout debit ; data: et URL signee acceptees', async () => {
  const m = charger([['async function handleRemoveBackground', 'async function callModalBackView']], ['handleRemoveBackground'],
    { getSessionUser: async () => ({ id: 'u1' }), err, json, isTrustedAssetHost });
  const q = (imageUrl) => m.handleRemoveBackground(new Request('https://site.example/api/remove-background', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ imageUrl }) }), { ...ENV_SSRF, REPLICATE_API_TOKEN: 'r8' });
  for (const u of ['http://127.0.0.1/x.png', 'https://evil.example/a.png', 'file:///etc/passwd', 'ftp://x/y', 'https://[::1]/a']) {
    const r = await q(u); assert.equal(r.status, 400, u); assert.match((await r.json()).error, /host not allowed/);
  }
  // Les cas legitimes franchissent la garde : le code poursuit vers la tarification (getPrice, absente de nos doublures).
  for (const u of ['https://site.example/r2/u1/a.png?exp=1&sig=x', 'https://replicate.delivery/a.png', 'data:image/png;base64,AAAA']) {
    await assert.rejects(q(u), /not defined|undefined|is not a function/, u);
  }
});

test('handleMeshOp : params.image_url verifiee pour toute operation (avant : seulement retex_swap et align_texture)', async () => {
  const m = charger([['async function handleMeshOp', 'async function handleMeshRetexture']], ['handleMeshOp'],
    { getSessionUser: async () => ({ id: 'u1' }), err, json, isTrustedAssetHost, supabaseAdmin: () => { throw new Error('non'); } });
  const q = (op, image_url) => m.handleMeshOp(new Request('https://site.example/api/mesh-op', { method: 'POST',
    body: JSON.stringify({ meshUrl: 'https://site.example/r2/u1/a.glb?exp=1&sig=x', opType: op, params: { image_url } }) }), { ...ENV_SSRF, MODAL_MESH_START_URL: 'https://modal.example/mesh_start' });
  for (const op of ['material', 'retex_swap', 'align_texture']) {
    const r = await q(op, 'http://169.254.169.254/x.png'); assert.equal(r.status, 400, op);
    assert.match((await r.json()).error, /image_url host not allowed/);
  }
  // URL fiable : la garde est franchie, la suite exige getPrice (absent de nos doublures)
  await assert.rejects(q('material', 'https://site.example/r2/u1/t.png?exp=1&sig=x'), /not defined|undefined|is not a function/);
});
