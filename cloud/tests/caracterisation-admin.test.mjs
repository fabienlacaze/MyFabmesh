// Tests de CARACTERISATION de l'acces administrateur (constat EXP-05, 03/10/2026) : cookie de session admin signe, double facteur (TOTP), garde des echecs de
// connexion, controle d'acces _requireAdmin. Une regression ici = la porte d'administration (credits, prix, utilisateurs) s'ouvre ou se ferme mal.
// Lancer (vivant) :  cd cloud && node --test tests/caracterisation-admin.test.mjs
// Lancer (reference) : WORKER_SRC=C:/tmp/vague2/tc/worker_HEAD.ts node --test tests/caracterisation-admin.test.mjs
// Difference VOULUE de la vague 1 : ADM-07 (compteur d'echecs de connexion global en plus du compteur par IP). Aucun reseau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { chargerFonctions, creerR2, existe } from './_charge-worker.mjs';

const maintenant = () => Math.floor(Date.now() / 1000);
const MDP = 'mot-de-passe-admin-assez-long-123456';  // >= 20 caracteres : seuil d'acceptation d'un secret d'environnement
const base64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

const A = chargerFonctions(['parseCookies', 'ADMIN_EMAILS', 'ADMIN_COOKIE', 'ADMIN_TTL_SEC', '_hmacSign', '_getAdminPasswordSource', '_getAdminUsername', '_hashAdminPassword',
  '_adminTokenCheck', '_requireAdmin', 'json', 'err', 'SECURITY_HEADERS'],
  { getSessionUser: async (req) => req.__user ?? null });
const COURRIEL_ADMIN = [...A.ADMIN_EMAILS][0];
const req = (cookie, user) => { const r = new Request('https://site.example/api/admin/x', { headers: cookie ? { cookie } : {} }); if (user !== undefined) r.__user = user; return r; };
const jeton = (cle, email = COURRIEL_ADMIN, exp = maintenant() + 3600) => { const p = `${email}:${exp}`; return `${p}.${base64url(createHmac('sha256', cle).update(p).digest())}`; };
const cookieAdmin = (cle, email, exp) => `admin_session=${encodeURIComponent(jeton(cle, email, exp))}`;

test('constantes admin : cookie admin_session, validite 4 h, au moins un courriel administrateur', () => {
  assert.equal(A.ADMIN_COOKIE, 'admin_session'); assert.equal(A.ADMIN_TTL_SEC, 4 * 3600); assert.ok(A.ADMIN_EMAILS.size >= 1);
  for (const e of A.ADMIN_EMAILS) assert.equal(e, e.toLowerCase(), 'les courriels admin sont stockes en minuscules (la comparaison met en minuscules)');
});
test('_hmacSign : HMAC-SHA256 en base64url sans remplissage (identique a node:crypto)', async () => {
  for (const m of ['a', 'admin@x.example:1234567890', 'u\u00e9\u20ac']) {
    const attendu = base64url(createHmac('sha256', 'cle-secrete').update(m).digest());
    assert.equal(await A._hmacSign('cle-secrete', m), attendu);
    assert.doesNotMatch(await A._hmacSign('cle-secrete', m), /[+/=]/);
  }
});
test('_hashAdminPassword : SHA-256 hex de "sel:mot de passe"', async () => {
  assert.equal(await A._hashAdminPassword('sel', 'pw'), createHash('sha256').update('sel:pw').digest('hex'));
  assert.notEqual(await A._hashAdminPassword('sel1', 'pw'), await A._hashAdminPassword('sel2', 'pw'));
});

test('_getAdminPasswordSource : hash R2 prioritaire ; cle de signature = ADMIN_PASSWORD (>= 20 car.) sinon le hash', async () => {
  const r2 = creerR2({ '_meta/admin_password.json': JSON.stringify({ salt: 's', hash: 'h'.repeat(64) }) });
  assert.deepEqual(await A._getAdminPasswordSource({ MESHES: r2, ADMIN_PASSWORD: MDP }), { mode: 'r2', salt: 's', hash: 'h'.repeat(64), signingKey: MDP });
  assert.equal((await A._getAdminPasswordSource({ MESHES: r2, ADMIN_PASSWORD: 'court' })).signingKey, 'h'.repeat(64));
  assert.equal((await A._getAdminPasswordSource({ MESHES: r2 })).signingKey, 'h'.repeat(64));
});
test('_getAdminPasswordSource : repli sur ADMIN_PASSWORD (>= 20 caracteres) ; trop court, absent ou R2 sans sel/hash -> mode none (ferme)', async () => {
  assert.deepEqual(await A._getAdminPasswordSource({ MESHES: creerR2(), ADMIN_PASSWORD: MDP }), { mode: 'env', literal: MDP, signingKey: MDP });
  assert.deepEqual(await A._getAdminPasswordSource({ MESHES: creerR2(), ADMIN_PASSWORD: 'dix-neuf-caracteres' }), { mode: 'none' });
  assert.deepEqual(await A._getAdminPasswordSource({ MESHES: creerR2() }), { mode: 'none' });
  assert.deepEqual(await A._getAdminPasswordSource({}), { mode: 'none' });
  assert.deepEqual(await A._getAdminPasswordSource({ MESHES: creerR2({ '_meta/admin_password.json': JSON.stringify({ salt: 's' }) }) }), { mode: 'none' });
  assert.deepEqual(await A._getAdminPasswordSource({ MESHES: creerR2({ '_meta/admin_password.json': '{illisible' }) }), { mode: 'none' });
});
test('_getAdminUsername : R2 > ADMIN_USERNAME > "admin", toujours rogne et en minuscules', async () => {
  assert.equal(await A._getAdminUsername({ MESHES: creerR2({ '_meta/admin_password.json': JSON.stringify({ username: '  Chef  ' }) }), ADMIN_USERNAME: 'env' }), 'chef');
  assert.equal(await A._getAdminUsername({ MESHES: creerR2(), ADMIN_USERNAME: '  EnvUser ' }), 'envuser');
  assert.equal(await A._getAdminUsername({ MESHES: creerR2() }), 'admin');
  assert.equal(await A._getAdminUsername({ MESHES: creerR2({ '_meta/admin_password.json': JSON.stringify({ username: '   ' }) }), ADMIN_USERNAME: '' }), 'admin');
  assert.equal(await A._getAdminUsername({}), 'admin');
});

const envAdmin = (extra = {}) => ({ MESHES: creerR2(), ADMIN_PASSWORD: MDP, ...extra });
test('_adminTokenCheck : cookie valide (signe avec la cle) accepte', async () => {
  assert.equal(await A._adminTokenCheck(req(cookieAdmin(MDP)), envAdmin()), true);
});
test('_adminTokenCheck : sans cookie, signature fausse, signature tronquee / allongee, cle differente -> refuse', async () => {
  const env = envAdmin();
  assert.equal(await A._adminTokenCheck(req(), env), false);
  const bon = jeton(MDP);
  assert.equal(await A._adminTokenCheck(req(`admin_session=${encodeURIComponent(bon.slice(0, -2) + 'AA')}`), env), false);
  assert.equal(await A._adminTokenCheck(req(`admin_session=${encodeURIComponent(bon.slice(0, -1))}`), env), false);
  assert.equal(await A._adminTokenCheck(req(`admin_session=${encodeURIComponent(bon + 'A')}`), env), false);
  assert.equal(await A._adminTokenCheck(req(cookieAdmin('autre-cle-de-signature-0123456789')), env), false);
});
test('_adminTokenCheck : charge utile alteree (autre courriel, echeance prolongee) avec l\'ancienne signature -> refuse', async () => {
  const env = envAdmin(); const [p, s] = jeton(MDP, 'a@b.example', maintenant() + 60).split('.');
  assert.equal(await A._adminTokenCheck(req(`admin_session=${encodeURIComponent('autre@b.example:' + p.split(':')[1] + '.' + s)}`), env), false);
  assert.equal(await A._adminTokenCheck(req(`admin_session=${encodeURIComponent(p.split(':')[0] + ':' + (maintenant() + 99999) + '.' + s)}`), env), false);
});
test('_adminTokenCheck : jeton expire, sans echeance ou mal forme -> refuse (meme correctement signe)', async () => {
  const env = envAdmin();
  assert.equal(await A._adminTokenCheck(req(cookieAdmin(MDP, undefined, maintenant() - 1)), env), false);
  assert.equal(await A._adminTokenCheck(req(cookieAdmin(MDP, undefined, 0)), env), false);
  const signer = (p) => `admin_session=${encodeURIComponent(p + '.' + base64url(createHmac('sha256', MDP).update(p).digest()))}`;
  assert.equal(await A._adminTokenCheck(req(signer('a@b.example')), env), false, 'pas d\'echeance');
  assert.equal(await A._adminTokenCheck(req(signer(`a:b:${maintenant() + 60}`)), env), false, 'trop de segments');
  assert.equal(await A._adminTokenCheck(req(signer(`a@b.example:abc`)), env), false);
  assert.equal(await A._adminTokenCheck(req('admin_session=sansPoint'), env), false);
});
test('_adminTokenCheck : serveur mal configure (mode none) -> refuse TOUJOURS, meme avec un jeton bien forme', async () => {
  assert.equal(await A._adminTokenCheck(req(cookieAdmin(MDP)), { MESHES: creerR2() }), false);
  assert.equal(await A._adminTokenCheck(req(cookieAdmin('court')), { MESHES: creerR2(), ADMIN_PASSWORD: 'court' }), false);
});
test('_adminTokenCheck : la rotation du hash R2 ne deconnecte pas tant que ADMIN_PASSWORD (>= 20 car.) signe le cookie', async () => {
  const r2 = creerR2({ '_meta/admin_password.json': JSON.stringify({ salt: 's', hash: 'h'.repeat(64) }) });
  assert.equal(await A._adminTokenCheck(req(cookieAdmin(MDP)), { MESHES: r2, ADMIN_PASSWORD: MDP }), true);
  assert.equal(await A._adminTokenCheck(req(cookieAdmin('h'.repeat(64))), { MESHES: r2 }), true, 'sans variable : signe par le hash');
});

test('_requireAdmin : pas de session -> 401 ; session d\'un compte non admin -> 403 (jamais d\'indice sur le 2e facteur)', async () => {
  const env = envAdmin();
  const r1 = await A._requireAdmin(req(cookieAdmin(MDP), null), env); assert.equal(r1.status, 401);
  const r2 = await A._requireAdmin(req(cookieAdmin(MDP), { id: 'u1', email: 'quelquun@x.example', credits: 0 }), env); assert.equal(r2.status, 403);
  const r3 = await A._requireAdmin(req(cookieAdmin(MDP), { id: 'u1', email: null, credits: 0 }), env); assert.equal(r3.status, 403);
});
test('_requireAdmin : courriel admin SANS cookie admin valide -> 401 admin_password_required', async () => {
  const r = await A._requireAdmin(req('', { id: 'a', email: COURRIEL_ADMIN, credits: 0 }), envAdmin());
  assert.equal(r.status, 401); assert.equal((await r.json()).error, 'admin_password_required');
  const r2 = await A._requireAdmin(req(cookieAdmin(MDP, undefined, maintenant() - 5), { id: 'a', email: COURRIEL_ADMIN, credits: 0 }), envAdmin());
  assert.equal(r2.status, 401);
});
test('_requireAdmin : courriel admin (casse ignoree) + cookie valide -> l\'utilisateur', async () => {
  const u = { id: 'a', email: COURRIEL_ADMIN.toUpperCase(), credits: 3 };
  assert.deepEqual(await A._requireAdmin(req(cookieAdmin(MDP), u), envAdmin()), u);
});
test('_requireAdmin : le cookie admin d\'une AUTRE session n\'ouvre rien sans la session de compte (les deux facteurs sont exiges)', async () => {
  assert.equal((await A._requireAdmin(req(cookieAdmin(MDP), undefined), envAdmin())).status, 401);
});

/* ───────────── TOTP (RFC 6238) ───────────── */
const T = chargerFonctions(['_base32Encode', '_base32Decode', '_totpAt', '_totpVerify']);
const SECRET20 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';   // base32 de "12345678901234567890" (secret SHA-1 des vecteurs de la RFC 6238)
test('base32 : aller-retour, alphabet RFC 4648, remplissage et casse tolerees, caractere invalide refuse', () => {
  const octets = new TextEncoder().encode('12345678901234567890');
  assert.equal(T._base32Encode(octets), SECRET20);
  assert.deepEqual([...T._base32Decode(SECRET20)], [...octets]);
  assert.deepEqual([...T._base32Decode(SECRET20.toLowerCase() + '====')], [...octets]);
  assert.deepEqual([...T._base32Decode('GEZD GNBV')], [...T._base32Decode('GEZDGNBV')], 'espaces ignores');
  assert.equal(T._base32Encode(new Uint8Array([])), '');
  for (let n = 0; n < 12; n++) { const b = new Uint8Array(n).map((_, i) => (i * 37 + n) & 255); assert.deepEqual([...T._base32Decode(T._base32Encode(b))], [...b], `longueur ${n}`); }
  assert.throws(() => T._base32Decode('AB1'), /invalid base32/);
});
test('_totpAt : vecteurs de la RFC 6238 (SHA-1, 6 derniers chiffres)', async () => {
  for (const [temps, attendu] of [[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037'], [20000000000, '353130']])
    assert.equal(await T._totpAt(SECRET20, Math.floor(temps / 30)), attendu, String(temps));
});
test('_totpVerify : code courant et derive de +-1 pas (30 s) acceptes ; +-2 pas refuses', async () => {
  const pas = Math.floor(Date.now() / 1000 / 30);
  assert.equal(await T._totpVerify(SECRET20, await T._totpAt(SECRET20, pas)), true);
  assert.equal(await T._totpVerify(SECRET20, await T._totpAt(SECRET20, pas - 1)), true);
  assert.equal(await T._totpVerify(SECRET20, await T._totpAt(SECRET20, pas + 1)), true);
  const deux = new Set([await T._totpAt(SECRET20, pas - 2), await T._totpAt(SECRET20, pas + 2)]);
  const accepte = new Set([await T._totpAt(SECRET20, pas - 1), await T._totpAt(SECRET20, pas), await T._totpAt(SECRET20, pas + 1)]);
  for (const c of deux) if (!accepte.has(c)) assert.equal(await T._totpVerify(SECRET20, c), false, c);
});
test('_totpVerify : espaces tolerees ; format invalide (5 ou 7 chiffres, lettres, vide, null) refuse', async () => {
  const c = await T._totpAt(SECRET20, Math.floor(Date.now() / 1000 / 30));
  assert.equal(await T._totpVerify(SECRET20, ` ${c.slice(0, 3)} ${c.slice(3)} `), true);
  for (const mauvais of [c.slice(0, 5), c + '0', 'abcdef', '', null, undefined, '12 34 5']) assert.equal(await T._totpVerify(SECRET20, mauvais), false, String(mauvais));
});

/* ───────────── garde des echecs de connexion admin ───────────── */
const G = chargerFonctions(['_adminFailGate', ...(existe('etatEchecsAdmin') ? ['etatEchecsAdmin', 'ECHECS_ADMIN_PAR_IP', 'ECHECS_ADMIN_GLOBAUX'] : [])]);
const ADM07 = existe('etatEchecsAdmin');
const depuis = (ip) => new Request('https://site.example/api/admin/login', { method: 'POST', headers: { 'cf-connecting-ip': ip } });
test('_adminFailGate : sans echec enregistre, jamais bloque ; lecture seule n\'ecrit rien', async () => {
  const env = { MESHES: creerR2() };
  assert.equal(await G._adminFailGate(depuis('1.2.3.4'), env, 'login', false), false);
  assert.equal(env.MESHES._m.size, 0);
});
test('_adminFailGate : 10 echecs depuis la meme IP -> bloque au 10e ; une autre IP n\'est pas touchee par le compteur par IP', async () => {
  const env = { MESHES: creerR2() };
  const res = []; for (let i = 0; i < 10; i++) res.push(await G._adminFailGate(depuis('1.2.3.4'), env, 'login', true));
  assert.deepEqual(res, [false, false, false, false, false, false, false, false, false, true]);
  assert.equal(await G._adminFailGate(depuis('1.2.3.4'), env, 'login', false), true);
  assert.equal(await G._adminFailGate(depuis('9.9.9.9'), env, 'login', false), false);
});
test('_adminFailGate : compteurs separes par action (scope) ; l\'IP est assainie dans la cle R2', async () => {
  const env = { MESHES: creerR2() };
  for (let i = 0; i < 10; i++) await G._adminFailGate(depuis('1.2.3.4'), env, 'totp', true);
  assert.equal(await G._adminFailGate(depuis('1.2.3.4'), env, 'login', false), false);
  await G._adminFailGate(new Request('https://x.example/', { headers: { 'cf-connecting-ip': '../../etc;<script>' } }), env, 'login', true);
  assert.ok([...env.MESHES._m.keys()].every((k) => /^_meta\/admin_login_fails\/[A-Za-z0-9_.:-]+\.json$/.test(k)), [...env.MESHES._m.keys()].join());
});
test('_adminFailGate : fenetre d\'une heure — des echecs vieux de plus d\'une heure sont oublies', async () => {
  const vieux = JSON.stringify({ count: 9, first_ts: Date.now() - 61 * 60 * 1000 });
  const env = { MESHES: creerR2({ '_meta/admin_login_fails/login-1.2.3.4.json': vieux }) };
  assert.equal(await G._adminFailGate(depuis('1.2.3.4'), env, 'login', true), false, 'repart de zero : 1 echec');
  const recent = JSON.stringify({ count: 9, first_ts: Date.now() - 30 * 60 * 1000 });
  const env2 = { MESHES: creerR2({ '_meta/admin_login_fails/login-1.2.3.4.json': recent }) };
  assert.equal(await G._adminFailGate(depuis('1.2.3.4'), env2, 'login', true), true, '10e echec dans l\'heure');
});
test('_adminFailGate : panne R2 ou compteur illisible -> ouvert (repart de zero), jamais d\'exception', async () => {
  assert.equal(await G._adminFailGate(depuis('1.2.3.4'), {}, 'login', true), false);
  const env = { MESHES: creerR2({ '_meta/admin_login_fails/login-1.2.3.4.json': '{illisible' }) };
  assert.equal(await G._adminFailGate(depuis('1.2.3.4'), env, 'login', true), false);
});
test('_adminFailGate ADM-07 (voulu) : 30 echecs depuis 30 IP DIFFERENTES — HEAD ne bloque jamais, vivant bloque (compteur global)', async () => {
  const env = { MESHES: creerR2() };
  let dernier = false;
  for (let i = 0; i < 30; i++) dernier = await G._adminFailGate(depuis(`10.0.0.${i}`), env, 'login', true);
  assert.equal(dernier, ADM07, ADM07 ? 'vivant : le 30e echec global bloque' : 'HEAD : chaque IP repart de zero');
  assert.equal(await G._adminFailGate(depuis('10.9.9.9'), env, 'login', false), ADM07);
});
test('etatEchecsAdmin (ADM-07, voulu : absente de HEAD) : fenetre glissante, plafond, lecture seule', () => {
  if (!ADM07) return;
  assert.deepEqual([G.ECHECS_ADMIN_PAR_IP, G.ECHECS_ADMIN_GLOBAUX], [10, 30]);
  const t = Date.now();
  assert.deepEqual(G.etatEchecsAdmin(null, t, false, 10), { f: { count: 0, first_ts: 0 }, bloque: false });
  assert.deepEqual(G.etatEchecsAdmin(null, t, true, 10), { f: { count: 1, first_ts: t }, bloque: false });
  assert.equal(G.etatEchecsAdmin({ count: 9, first_ts: t - 1000 }, t, true, 10).bloque, true);
  assert.equal(G.etatEchecsAdmin({ count: 10, first_ts: t - 1000 }, t, false, 10).bloque, true, 'lecture seule : bloque sans ajouter');
  assert.equal(G.etatEchecsAdmin({ count: 10, first_ts: t - 1000 }, t, false, 10).f.count, 10);
  assert.equal(G.etatEchecsAdmin({ count: 99, first_ts: t - 3600_001 }, t, false, 10).bloque, false, 'fenetre depassee : oublie');
  assert.equal(G.etatEchecsAdmin({ count: 'x', first_ts: t }, t, false, 10).bloque, false, 'etat corrompu : repart de zero');
  assert.equal(G.etatEchecsAdmin(undefined, t, true, 1).bloque, true, 'plafond 1');
});
