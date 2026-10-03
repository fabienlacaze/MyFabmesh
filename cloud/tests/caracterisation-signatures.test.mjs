// Tests de CARACTERISATION des signatures et de l'authentification (constat EXP-05, 03/10/2026) : URLs R2 signees, signature du webhook Stripe, cookies de session,
// jetons Bearer / cle API, resolution de la session. Une regression ici = un acces non autorise ou un encaissement forge.
// Lancer (vivant) :  cd cloud && node --test tests/caracterisation-signatures.test.mjs
// Lancer (reference) : WORKER_SRC=C:/tmp/vague2/tc/worker_HEAD.ts node --test tests/caracterisation-signatures.test.mjs
// Les signatures attendues sont recalculees ICI avec node:crypto (independamment du code teste). Aucun reseau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { chargerFonctions, creerR2, creerSupabase, lireSource } from './_charge-worker.mjs';
const existeSource = (fragment) => lireSource().includes(fragment);

const hmac = (secret, texte) => createHmac('sha256', secret).update(texte).digest('hex');
const SECRET = 'secret-de-test-0123456789abcdef';
const maintenant = () => Math.floor(Date.now() / 1000);

/* ───────────── URLs R2 signees ───────────── */
const R = chargerFonctions(['SECURITY_HEADERS', 'json', 'err', 'isMock', 'siteUrl', 'R2_TTL_IMAGE_SEC', 'R2_TTL_MESH_SEC', 'R2_TTL_EXPORT_SEC', 'r2TtlFor', '_r2SignWarned',
  'r2SignHex', 'signedR2Url', 'r2ContentType', 'timingSafeEqualHex', 'handleSignedR2']);
const silence = async (f) => { const w = console.warn; console.warn = () => {}; try { return await f(); } finally { console.warn = w; } };
const envSigne = (extra = {}) => ({ R2_URL_SIGNING_SECRET: SECRET, NEXT_PUBLIC_SITE_URL: 'https://site.example', MESHES: creerR2(), ...extra });

test('TTL des URLs signees : image 24 h, maillage 7 j, export 30 j (defaut image)', () => {
  assert.deepEqual([R.R2_TTL_IMAGE_SEC, R.R2_TTL_MESH_SEC, R.R2_TTL_EXPORT_SEC], [86400, 604800, 2592000]);
  assert.equal(R.r2TtlFor('image'), 86400); assert.equal(R.r2TtlFor('mesh'), 604800); assert.equal(R.r2TtlFor('export'), 2592000);
  assert.equal(R.r2TtlFor('inconnu'), 86400);
});
test('signedR2Url : format /r2/<cle>?exp=&sig=, signature = HMAC-SHA256("v1:<cle>\\n<exp>"), hex minuscule de 64 caracteres', async () => {
  const u = new URL(await R.signedR2Url(envSigne(), 'uid/source/1.png'));
  assert.equal(u.origin, 'https://site.example'); assert.equal(u.pathname, '/r2/uid/source/1.png');
  const exp = u.searchParams.get('exp'), sig = u.searchParams.get('sig');
  assert.match(sig, /^[0-9a-f]{64}$/);
  assert.equal(sig, hmac(SECRET, `v1:uid/source/1.png\n${exp}`));
});
test('signedR2Url : echeance arrondie a l\'heure, entre la duree prevue et la duree + 1 h, selon le type', async () => {
  for (const [kind, ttl] of [['image', 86400], ['mesh', 604800], ['export', 2592000], [undefined, 86400]]) {
    const exp = Number(new URL(await R.signedR2Url(envSigne(), 'a/b.glb', kind)).searchParams.get('exp'));
    assert.equal(exp % 3600, 0, kind);
    const reste = exp - maintenant();
    assert.ok(reste >= ttl - 1 && reste <= ttl + 3600, `${kind}: ${reste}`);
  }
});
test('signedR2Url : stable pendant l\'heure (meme URL deux fois de suite, cache navigateur)', async () => {
  const a = await R.signedR2Url(envSigne(), 'a/b.png'), b = await R.signedR2Url(envSigne(), 'a/b.png');
  assert.equal(a, b);
});
test('signedR2Url : cle, secret ou type differents -> signature differente', async () => {
  const sig = async (env, cle, k) => new URL(await R.signedR2Url(env, cle, k)).searchParams.get('sig');
  const s0 = await sig(envSigne(), 'a/b.png');
  assert.notEqual(s0, await sig(envSigne(), 'a/c.png'));
  assert.notEqual(s0, await sig(envSigne({ R2_URL_SIGNING_SECRET: SECRET + 'x' }), 'a/b.png'));
  assert.notEqual(s0, await sig(envSigne(), 'a/b.png', 'export'));
});
test('signedR2Url : barre oblique initiale retiree, segments encodes, barres internes conservees', async () => {
  const u = new URL(await R.signedR2Url(envSigne(), '///uid/mon dossier/a#b?c.png'));
  assert.equal(u.pathname, '/r2/uid/mon%20dossier/a%23b%3Fc.png');
  assert.equal(u.searchParams.get('sig'), hmac(SECRET, `v1:uid/mon dossier/a#b?c.png\n${u.searchParams.get('exp')}`), 'la signature porte sur la cle DECODEE');
});
test('signedR2Url : base du site sans barre finale ; defaut http://localhost:3030', async () => {
  assert.ok((await R.signedR2Url(envSigne({ NEXT_PUBLIC_SITE_URL: 'https://site.example///' }), 'a.png')).startsWith('https://site.example/r2/a.png?'));
  assert.ok((await R.signedR2Url(envSigne({ NEXT_PUBLIC_SITE_URL: undefined }), 'a.png')).startsWith('http://localhost:3030/r2/a.png?'));
});
test('signedR2Url : cle vide rendue telle quelle ; URL complete (anciennes lignes) laissee intacte', async () => {
  assert.equal(await R.signedR2Url(envSigne(), ''), '');
  assert.equal(await R.signedR2Url(envSigne(), 'https://ancien.example/x.png'), 'https://ancien.example/x.png');
  assert.equal(await R.signedR2Url(envSigne(), 'HTTP://ancien.example/x.png'), 'HTTP://ancien.example/x.png');
});
test('signedR2Url : SANS secret, en production, REFUSE (jamais d\'URL publique permanente)', async () => {
  await assert.rejects(() => R.signedR2Url({ NEXT_PUBLIC_SITE_URL: 'https://site.example', R2_PUBLIC_URL: 'https://pub.r2.dev' }, 'a/b.png'), /R2_URL_SIGNING_SECRET is required/);
});
test('signedR2Url : sans secret, repli public SEULEMENT en mode MOCK ou avec R2_ALLOW_UNSIGNED=1', async () => {
  const base = { NEXT_PUBLIC_SITE_URL: 'https://site.example', R2_PUBLIC_URL: 'https://pub.r2.dev/' };
  assert.equal(await silence(() => R.signedR2Url({ ...base, MOCK: '1' }, '/a/b.png')), 'https://pub.r2.dev/a/b.png');
  assert.equal(await silence(() => R.signedR2Url({ ...base, R2_ALLOW_UNSIGNED: '1' }, 'a/b.png')), 'https://pub.r2.dev/a/b.png');
  await assert.rejects(() => R.signedR2Url({ ...base, R2_ALLOW_UNSIGNED: 'true' }, 'a/b.png'), /required/, 'seule la valeur "1" ouvre le repli');
});
test('r2ContentType : table des extensions, insensible a la casse, defaut octet-stream', () => {
  const t = R.r2ContentType;
  assert.equal(t('a.glb'), 'model/gltf-binary'); assert.equal(t('a.GLB'), 'model/gltf-binary'); assert.equal(t('a.gltf'), 'model/gltf+json');
  assert.equal(t('a.png'), 'image/png'); assert.equal(t('a.jpg'), 'image/jpeg'); assert.equal(t('a.jpeg'), 'image/jpeg'); assert.equal(t('a.webp'), 'image/webp');
  assert.equal(t('a.gif'), 'image/gif'); assert.equal(t('a.json'), 'application/json'); assert.equal(t('a.fbx'), 'application/octet-stream');
  assert.equal(t('sans_extension'), 'application/octet-stream');
  assert.equal(t('a.svg'), 'application/octet-stream', 'jamais image/svg+xml : pas de script servi depuis notre origine');
  assert.equal(t('a.html'), 'application/octet-stream');
});
test('timingSafeEqualHex : egalite stricte, longueurs differentes refusees, sensible a la casse', () => {
  const f = R.timingSafeEqualHex;
  assert.equal(f('abcd', 'abcd'), true); assert.equal(f('', ''), true);
  assert.equal(f('abcd', 'abce'), false); assert.equal(f('abcd', 'abc'), false); assert.equal(f('abc', 'abcd'), false);
  assert.equal(f('ABCD', 'abcd'), false);
  assert.equal(f('a'.repeat(64), 'a'.repeat(63) + 'b'), false);
});

/* handleSignedR2 : on signe cote test, on rejoue la requete */
const exp1h = () => maintenant() + 3600;
const urlSignee = (cle, { exp = exp1h(), secret = SECRET, sig, chemin } = {}) => {
  const enc = (chemin ?? cle).split('/').map(encodeURIComponent).join('/');
  return `https://site.example/r2/${enc}?exp=${exp}&sig=${sig ?? hmac(secret, `v1:${cle}\n${exp}`)}`;
};
const lire = (url, env = envSigne({ MESHES: creerR2({ 'u1/a.png': 'PNGDATA', '_meta/pricing.json': '{}', '_meta/contact/m1/capture.png': 'CAP', '_meta/contact/m1.json': '{}', 'u1/a b.glb': 'GLB' }) })) =>
  R.handleSignedR2(new Request(url), env);

test('handleSignedR2 : URL valide -> 200, octets, type, cache prive borne par l\'echeance, nosniff, ACAO *', async () => {
  const exp = exp1h(); const r = await lire(urlSignee('u1/a.png', { exp }));
  assert.equal(r.status, 200); assert.equal(await r.text(), 'PNGDATA');
  assert.equal(r.headers.get('content-type'), 'image/png');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.equal(r.headers.get('content-disposition'), 'inline');
  const m = /^private, max-age=(\d+)$/.exec(r.headers.get('cache-control')); assert.ok(m); assert.ok(Number(m[1]) <= 3600 && Number(m[1]) >= 3590);
});
test('handleSignedR2 : cle avec espace (encodee) -> 200', async () => {
  assert.equal((await lire(urlSignee('u1/a b.glb'))).status, 200);
});
test('handleSignedR2 : signature en MAJUSCULES acceptee (comparaison apres minuscule)', async () => {
  const exp = exp1h(); const r = await lire(urlSignee('u1/a.png', { exp, sig: hmac(SECRET, `v1:u1/a.png\n${exp}`).toUpperCase() }));
  assert.equal(r.status, 200);
});
test('handleSignedR2 : signature valide mais pour une AUTRE cle -> 403 (pas de reutilisation)', async () => {
  const exp = exp1h();
  const r = await lire(urlSignee('u1/a.png', { exp, sig: hmac(SECRET, `v1:u2/a.png\n${exp}`) }));
  assert.equal(r.status, 403);
});
test('handleSignedR2 : chemin altere apres signature -> 403', async () => {
  const exp = exp1h(); const sig = hmac(SECRET, `v1:u1/a.png\n${exp}`);
  assert.equal((await lire(`https://site.example/r2/u1/b.png?exp=${exp}&sig=${sig}`)).status, 403);
});
test('handleSignedR2 : echeance alteree (prolongee) -> 403 ; echeance depassee -> 403 expired', async () => {
  const exp = exp1h(); const sig = hmac(SECRET, `v1:u1/a.png\n${exp}`);
  assert.equal((await lire(`https://site.example/r2/u1/a.png?exp=${exp + 1}&sig=${sig}`)).status, 403);
  const passe = maintenant() - 10;
  const r = await lire(urlSignee('u1/a.png', { exp: passe }));
  assert.equal(r.status, 403); assert.match((await r.json()).error, /expired/);
});
test('handleSignedR2 : mauvais secret, signature absente / vide / tronquee, echeance absente ou non numerique -> 403', async () => {
  const exp = exp1h(); const bon = hmac(SECRET, `v1:u1/a.png\n${exp}`);
  assert.equal((await lire(urlSignee('u1/a.png', { exp, secret: 'autre' }))).status, 403);
  assert.equal((await lire(`https://site.example/r2/u1/a.png?exp=${exp}`)).status, 403);
  assert.equal((await lire(`https://site.example/r2/u1/a.png?exp=${exp}&sig=`)).status, 403);
  assert.equal((await lire(`https://site.example/r2/u1/a.png?exp=${exp}&sig=${bon.slice(0, 63)}`)).status, 403);
  assert.equal((await lire(`https://site.example/r2/u1/a.png?sig=${bon}`)).status, 403);
  assert.equal((await lire(`https://site.example/r2/u1/a.png?exp=abc&sig=${bon}`)).status, 403);
});
test('handleSignedR2 : sans R2_URL_SIGNING_SECRET la route n\'existe pas (404), meme avec une signature plausible', async () => {
  const env = envSigne({ R2_URL_SIGNING_SECRET: undefined, MESHES: creerR2({ 'u1/a.png': 'x' }) });
  assert.equal((await lire(urlSignee('u1/a.png'), env)).status, 404);
});
test('handleSignedR2 : objet absent -> 404 (apres verification de la signature)', async () => {
  assert.equal((await lire(urlSignee('u1/absent.png'))).status, 404);
  assert.equal((await lire('https://site.example/r2/u1/absent.png?exp=1&sig=zz')).status, 403, 'une signature invalide ne revele pas l\'existence');
});
test('handleSignedR2 : cles INTERNES (prefixe _) refusees meme avec une signature valide', async () => {
  assert.equal((await lire(urlSignee('_meta/pricing.json'))).status, 403);
  assert.equal((await lire(urlSignee('_logs/x.txt'))).status, 403);
  assert.equal((await lire(urlSignee('_market/x.json'))).status, 403);
});
test('handleSignedR2 : seule exception, les pieces jointes de contact _meta/contact/<id>/<fichier>', async () => {
  assert.equal((await lire(urlSignee('_meta/contact/m1/capture.png'))).status, 200);
  assert.equal((await lire(urlSignee('_meta/contact/m1.json'))).status, 403, 'le fichier du message lui-meme reste interdit');
  assert.equal((await lire(urlSignee('_meta/contact/m1/sous/dossier.png'))).status, 403, 'un seul niveau');
  assert.equal((await lire(urlSignee('_meta/contact/m1/capture.png', { secret: 'autre' }))).status, 403, 'la signature reste exigee');
});
test('handleSignedR2 : traversee de chemin (..) refusee meme signee', async () => {
  const exp = exp1h(); const cle = 'u1/../_meta/pricing.json';
  const r = await lire(`https://site.example/r2/u1/%2e%2e/_meta/pricing.json?exp=${exp}&sig=${hmac(SECRET, `v1:${cle}\n${exp}`)}`);
  assert.equal(r.status, 403);
});
test('handleSignedR2 : encodage invalide -> 400 ; cle vide -> 403', async () => {
  assert.equal((await lire('https://site.example/r2/%E0%A4%A?exp=1&sig=a')).status, 400);
  assert.equal((await lire('https://site.example/r2/?exp=1&sig=a')).status, 403);
});

/* ───────────── signature du webhook Stripe ───────────── */
const V = chargerFonctions(['timingSafeEqualHex', 'verifyStripeSignature']);
const WH = 'whsec_test_secret';
const signer = (payload, t, secret = WH) => hmac(secret, `${t}.${payload}`);
const BODY = '{"id":"evt_1","type":"checkout.session.completed"}';

test('verifyStripeSignature : signature valide (t = maintenant) acceptee', async () => {
  const t = maintenant();
  assert.equal(await V.verifyStripeSignature(BODY, `t=${t},v1=${signer(BODY, t)}`, WH), true);
});
test('verifyStripeSignature : corps altere, mauvais secret -> refuse', async () => {
  const t = maintenant(); const h = `t=${t},v1=${signer(BODY, t)}`;
  assert.equal(await V.verifyStripeSignature(BODY + ' ', h, WH), false);
  assert.equal(await V.verifyStripeSignature(BODY, h, WH + 'x'), false);
  assert.equal(await V.verifyStripeSignature(BODY, `t=${t},v1=${signer(BODY, t, 'autre')}`, WH), false);
});
test('verifyStripeSignature : horodatage altere (signature d\'un autre instant) -> refuse', async () => {
  const t = maintenant();
  assert.equal(await V.verifyStripeSignature(BODY, `t=${t + 1},v1=${signer(BODY, t)}`, WH), false);
});
test('verifyStripeSignature : tolerance de 300 s dans les DEUX sens (rejeu refuse, avance d\'horloge refusee)', async () => {
  const sig = (t) => `t=${t},v1=${signer(BODY, t)}`;
  assert.equal(await V.verifyStripeSignature(BODY, sig(maintenant() - 290), WH), true);
  assert.equal(await V.verifyStripeSignature(BODY, sig(maintenant() - 310), WH), false);
  assert.equal(await V.verifyStripeSignature(BODY, sig(maintenant() + 290), WH), true);
  assert.equal(await V.verifyStripeSignature(BODY, sig(maintenant() + 310), WH), false);
  assert.equal(await V.verifyStripeSignature(BODY, sig(maintenant() - 3600 * 24), WH), false);
});
test('verifyStripeSignature : tolerance parametrable (quatrieme argument)', async () => {
  const t = maintenant() - 500; const h = `t=${t},v1=${signer(BODY, t)}`;
  assert.equal(await V.verifyStripeSignature(BODY, h, WH), false);
  assert.equal(await V.verifyStripeSignature(BODY, h, WH, 600), true);
  assert.equal(await V.verifyStripeSignature(BODY, h, WH, 10), false);
});
test('verifyStripeSignature : plusieurs signatures v1 (rotation du secret) : une seule valide suffit, aucune valide refuse', async () => {
  const t = maintenant(); const bonne = signer(BODY, t), mauvaise = 'f'.repeat(64);
  assert.equal(await V.verifyStripeSignature(BODY, `t=${t},v1=${mauvaise},v1=${bonne}`, WH), true);
  assert.equal(await V.verifyStripeSignature(BODY, `t=${t},v1=${bonne},v1=${mauvaise}`, WH), true);
  assert.equal(await V.verifyStripeSignature(BODY, `t=${t},v1=${mauvaise},v1=${'e'.repeat(64)}`, WH), false);
});
test('verifyStripeSignature : schema v0 seul, v1 absent, t absent / nul / non numerique, en-tete vide -> refuse', async () => {
  const t = maintenant(); const s = signer(BODY, t);
  assert.equal(await V.verifyStripeSignature(BODY, `t=${t},v0=${s}`, WH), false);
  assert.equal(await V.verifyStripeSignature(BODY, `t=${t}`, WH), false);
  assert.equal(await V.verifyStripeSignature(BODY, `v1=${s}`, WH), false);
  assert.equal(await V.verifyStripeSignature(BODY, `t=0,v1=${s}`, WH), false);
  assert.equal(await V.verifyStripeSignature(BODY, `t=abc,v1=${s}`, WH), false);
  assert.equal(await V.verifyStripeSignature(BODY, '', WH), false);
  assert.equal(await V.verifyStripeSignature(BODY, 'n importe quoi', WH), false);
});
test('verifyStripeSignature : signature en majuscules ou avec espace apres la virgule -> refusee (comparaison stricte)', async () => {
  const t = maintenant(); const s = signer(BODY, t);
  assert.equal(await V.verifyStripeSignature(BODY, `t=${t},v1=${s.toUpperCase()}`, WH), false);
  assert.equal(await V.verifyStripeSignature(BODY, `t=${t}, v1=${s}`, WH), false);
});
test('verifyStripeSignature : charge utile non ASCII (accents, emoji) : signee sur les octets UTF-8', async () => {
  const corps = '{"nom":"Rene Zoe \u00e9\u00e8 \u20ac \ud83d\ude00"}'; const t = maintenant();
  assert.equal(await V.verifyStripeSignature(corps, `t=${t},v1=${signer(corps, t)}`, WH), true);
});

/* ───────────── cookies, jetons, cles API ───────────── */
const K = chargerFonctions(['parseCookies', 'MFM_SESSION_COOKIE', 'MFM_REFRESH_COOKIE', 'readSupabaseAccessToken', '_CLE_API_RE', '_lireCleApi', '_decodeJwtIat']);
const req = (h) => new Request('https://site.example/api/x', { headers: h });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
const b64url = (o) => b64(o).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (payload) => `${b64url({ alg: 'HS256' })}.${b64url(payload)}.sig`;
const CLE = 'mfm_' + 'A1b2C3d4E5'.repeat(4);

test('noms des cookies de session', () => { assert.equal(K.MFM_SESSION_COOKIE, 'mfm-session'); assert.equal(K.MFM_REFRESH_COOKIE, 'mfm-refresh'); });
test('parseCookies : plusieurs cookies, decodage, valeur contenant "=", entrees sans nom ignorees', () => {
  const c = K.parseCookies(req({ cookie: 'a=1; b=x%20y;c=ab==; =oublie; sansegal; d=' }));
  assert.equal(c.a, '1'); assert.equal(c.b, 'x y'); assert.equal(c.c, 'ab=='); assert.equal(c.d, '');
  assert.equal(Object.hasOwn(c, 'sansegal'), false); assert.equal(Object.keys(c).includes(''), false);
});
test('parseCookies : pas de cookie -> objet vide', () => { assert.deepEqual(K.parseCookies(req({})), {}); });
test('parseCookies : un pourcentage mal forme ne produit JAMAIS un cookie exploitable (soit objet, soit URIError)', () => {
  let r; try { r = K.parseCookies(req({ cookie: 'mfm-session=%E0%A4%A' })); } catch (e) { assert.ok(e instanceof URIError); return; }
  assert.equal(r['mfm-session'] === undefined || typeof r['mfm-session'] === 'string', true);
});
test('readSupabaseAccessToken : le cookie HttpOnly mfm-session est prefere', () => {
  assert.equal(K.readSupabaseAccessToken(req({ cookie: `mfm-session=TOK1; sb-abc-auth-token=${encodeURIComponent(JSON.stringify({ access_token: 'LEGACY' }))}` })), 'TOK1');
});
test('readSupabaseAccessToken : repli sur le cookie historique sb-<ref>-auth-token (JSON, base64, prefixe base64-)', () => {
  const o = { access_token: 'LEGACY', refresh_token: 'r' };
  assert.equal(K.readSupabaseAccessToken(req({ cookie: `sb-abc-auth-token=${encodeURIComponent(JSON.stringify(o))}` })), 'LEGACY');
  assert.equal(K.readSupabaseAccessToken(req({ cookie: `sb-abc-auth-token=${b64(o)}` })), 'LEGACY');
  assert.equal(K.readSupabaseAccessToken(req({ cookie: `sb-abc-auth-token=base64-${b64(o)}` })), 'LEGACY');
});
test('readSupabaseAccessToken : cookie historique en morceaux .0 .1 concatenes dans l\'ordre', () => {
  const brut = JSON.stringify({ access_token: 'CHUNKED' }); const m = Math.floor(brut.length / 2);
  const c = `sb-abc-auth-token.1=${encodeURIComponent(brut.slice(m))}; sb-abc-auth-token.0=${encodeURIComponent(brut.slice(0, m))}`;
  assert.equal(K.readSupabaseAccessToken(req({ cookie: c })), 'CHUNKED');
});
test('readSupabaseAccessToken : aucun cookie, cookie illisible, JSON sans access_token, reference avec tiret -> null', () => {
  assert.equal(K.readSupabaseAccessToken(req({})), null);
  assert.equal(K.readSupabaseAccessToken(req({ cookie: 'autre=1' })), null);
  assert.equal(K.readSupabaseAccessToken(req({ cookie: 'sb-abc-auth-token=pas-du-json-ni-base64!!' })), null);
  assert.equal(K.readSupabaseAccessToken(req({ cookie: `sb-abc-auth-token=${encodeURIComponent(JSON.stringify({ refresh_token: 'r' }))}` })), null);
  assert.equal(K.readSupabaseAccessToken(req({ cookie: `sb-a-b-auth-token=${encodeURIComponent(JSON.stringify({ access_token: 'X' }))}` })), null, 'la reference ne contient pas de tiret');
});
test('readSupabaseAccessToken : un en-tete Authorization Bearer n\'est PAS un jeton de session (cookies seulement)', () => {
  assert.equal(K.readSupabaseAccessToken(req({ authorization: 'Bearer abc.def.ghi' })), null);
});
test('_lireCleApi : Bearer ou x-api-key au format mfm_ + 40 alphanumeriques ; tout le reste -> null', () => {
  assert.equal(K._lireCleApi(req({ authorization: `Bearer ${CLE}` })), CLE);
  assert.equal(K._lireCleApi(req({ authorization: `Bearer   ${CLE}  ` })), CLE, 'espaces rognes');
  assert.equal(K._lireCleApi(req({ 'x-api-key': CLE })), CLE);
  assert.equal(K._lireCleApi(req({ authorization: `Basic zzz`, 'x-api-key': CLE })), CLE, 'authorization non Bearer : on regarde x-api-key');
  assert.equal(K._lireCleApi(req({ authorization: 'Bearer ' + jwt({ iat: 1 }) })), null, 'un JWT Supabase n\'est pas une cle API');
  assert.equal(K._lireCleApi(req({ authorization: `Bearer ${CLE.slice(0, -1)}` })), null);
  assert.equal(K._lireCleApi(req({ authorization: `Bearer ${CLE}x` })), null);
  assert.equal(K._lireCleApi(req({ authorization: `Bearer mfm_${'a'.repeat(39)}-` })), null);
  assert.equal(K._lireCleApi(req({ authorization: 'bearer ' + CLE })), null, 'le mot Bearer est sensible a la casse');
  assert.equal(K._lireCleApi(req({ authorization: 'Bearer abc', 'x-api-key': CLE })), null, 'un Bearer present l\'emporte, meme invalide');
  assert.equal(K._lireCleApi(req({})), null);
});
test('_decodeJwtIat : lit iat (base64url), tout le reste -> null', () => {
  assert.equal(K._decodeJwtIat(jwt({ iat: 1700000000, sub: 'u' })), 1700000000);
  assert.equal(K._decodeJwtIat(jwt({ iat: 'x' })), null);
  assert.equal(K._decodeJwtIat(jwt({ sub: 'u' })), null);
  assert.equal(K._decodeJwtIat('a.b'), null); assert.equal(K._decodeJwtIat('a.b.c.d'), null); assert.equal(K._decodeJwtIat(''), null);
  assert.equal(K._decodeJwtIat('a.%%%.c'), null);
  assert.equal(K._decodeJwtIat(`x.${b64url({ iat: 5, n: '>>>???' })}.y`), 5, 'caracteres base64url - et _');
});

/* ───────────── getSessionUser : de la requete a l'utilisateur ───────────── */
class ServiceIndisponible extends Error {}
function mondeSession({ reponse, banni = [], minIat = null, profils = [{ id: 'u1', credits: 42 }], cles = {} } = {}) {
  const r2 = creerR2({ ...(banni.length ? { '_meta/banned-users.json': JSON.stringify(banni) } : {}), ...(minIat ? { '_meta/min-session-iat.json': JSON.stringify({ iat: minIat }) } : {}), ...cles });
  const sb = creerSupabase({ profiles: profils });
  const appels = [];
  const fetchSimule = async (url, init) => {
    appels.push({ url: String(url), init });
    const v = typeof reponse === 'function' ? reponse() : reponse;
    if (v instanceof Error) throw v;
    return v;
  };
  const f = chargerFonctions(['getSessionUser', 'isMock', '_getBannedUserIds', '_banListCache', 'BAN_LIST_KEY', 'BAN_LIST_TTL_MS', '_invalidateBanCache',
    '_getMinSessionIat', '_minSessionIatCache', 'MIN_SESSION_IAT_KEY', 'MIN_SESSION_TTL_MS', 'ADMIN_EMAILS', 'parseCookies', 'MFM_SESSION_COOKIE', 'readSupabaseAccessToken',
    '_CLE_API_RE', '_lireCleApi', '_decodeJwtIat', '_empreinteCle', '_lireCle', '_creditsDe'],
    { ServiceIndisponible, supabaseAdmin: () => sb, MOCK_COOKIE: 'myfm_mock_session', mock: { getUserBySession: () => null }, fetch: fetchSimule });
  const env = { MESHES: r2, NEXT_PUBLIC_SUPABASE_URL: 'https://sb.example', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon' };
  return { f, env, appels, r2, sb };
}
// Le Function du chargeur voit `fetch` comme parametre : on l'injecte via la doublure ci-dessus.
const utilisateurOk = () => new Response(JSON.stringify({ id: 'u1', email: 'a@b.example' }), { status: 200 });
const avecSession = (tok = jwt({ iat: maintenant() })) => req({ cookie: `mfm-session=${tok}` });

test('getSessionUser : pas de cookie ni de cle -> null, sans appel reseau', async () => {
  const m = mondeSession({ reponse: utilisateurOk() });
  assert.equal(await m.f.getSessionUser(req({}), m.env), null); assert.equal(m.appels.length, 0);
});
test('getSessionUser : jeton valide -> { id, email, credits } ; le jeton part en Bearer vers /auth/v1/user avec la cle anon', async () => {
  const m = mondeSession({ reponse: utilisateurOk() });
  const tok = jwt({ iat: maintenant() });
  const u = await m.f.getSessionUser(avecSession(tok), m.env);
  assert.deepEqual(u, { id: 'u1', email: 'a@b.example', credits: 42 });
  assert.equal(m.appels[0].url, 'https://sb.example/auth/v1/user');
  assert.equal(m.appels[0].init.headers.authorization, `Bearer ${tok}`); assert.equal(m.appels[0].init.headers.apikey, 'anon');
});
test('getSessionUser : profil sans ligne -> 0 credit (pas d\'invention de solde)', async () => {
  const m = mondeSession({ reponse: utilisateurOk(), profils: [] });
  assert.equal((await m.f.getSessionUser(avecSession(), m.env)).credits, 0);
});
test('getSessionUser : Supabase refuse le jeton (401 / 403 / 400) -> null (session invalide)', async () => {
  for (const status of [400, 401, 403, 404]) {
    const m = mondeSession({ reponse: new Response('{}', { status }) });
    assert.equal(await m.f.getSessionUser(avecSession(), m.env), null, String(status));
  }
});
test('getSessionUser : service en panne (5xx, 429, reseau) -> exception ServiceIndisponible, JAMAIS null (la page ne deconnecte pas)', async () => {
  for (const reponse of [new Response('', { status: 500 }), new Response('', { status: 503 }), new Response('', { status: 429 }), new Error('reseau')]) {
    const m = mondeSession({ reponse });
    await assert.rejects(() => m.f.getSessionUser(avecSession(), m.env), (e) => e instanceof ServiceIndisponible);
  }
});
test('getSessionUser : reponse sans id -> null ; configuration Supabase absente -> null', async () => {
  const m = mondeSession({ reponse: new Response('{"email":"x"}', { status: 200 }) });
  assert.equal(await m.f.getSessionUser(avecSession(), m.env), null);
  const m2 = mondeSession({ reponse: utilisateurOk() });
  assert.equal(await m2.f.getSessionUser(avecSession(), { ...m2.env, NEXT_PUBLIC_SUPABASE_ANON_KEY: '' }), null);
  assert.equal(await m2.f.getSessionUser(avecSession(), { ...m2.env, NEXT_PUBLIC_SUPABASE_URL: undefined }), null);
});
test('getSessionUser : compte banni -> null (indiscernable d\'une session absente)', async () => {
  const m = mondeSession({ reponse: utilisateurOk(), banni: ['u1'] });
  assert.equal(await m.f.getSessionUser(avecSession(), m.env), null);
});
test('getSessionUser : deconnexion forcee — jeton emis AVANT la date -> null avec raison ; apres -> accepte', async () => {
  const t = maintenant();
  const m = mondeSession({ reponse: utilisateurOk(), minIat: t });
  const rq = avecSession(jwt({ iat: t - 100 }));
  assert.equal(await m.f.getSessionUser(rq, m.env), null);
  assert.equal(rq.__sessionExpiredReason, 'admin_forced_logout');
  const m2 = mondeSession({ reponse: utilisateurOk(), minIat: t });
  assert.equal((await m2.f.getSessionUser(avecSession(jwt({ iat: t + 5 })), m2.env)).id, 'u1');
});
test('getSessionUser : deconnexion forcee — l\'administrateur n\'est pas deconnecte par son propre bouton', async () => {
  const t = maintenant(); const m = mondeSession({ reponse: utilisateurOk(), minIat: t });
  const admin = [...m.f.ADMIN_EMAILS][0];
  m.appels.length = 0;
  const m2 = mondeSession({ reponse: new Response(JSON.stringify({ id: 'u1', email: admin.toUpperCase() }), { status: 200 }), minIat: t });
  assert.equal((await m2.f.getSessionUser(avecSession(jwt({ iat: t - 100 })), m2.env)).id, 'u1');
});
test('getSessionUser : jeton sans iat lisible n\'est pas deconnecte par la deconnexion forcee (comportement actuel)', async () => {
  const t = maintenant(); const m = mondeSession({ reponse: utilisateurOk(), minIat: t });
  assert.equal((await m.f.getSessionUser(avecSession('jeton-opaque'), m.env)).id, 'u1');
});
test('getSessionUser : cle API valide -> le compte de la cle, SANS appeler Supabase Auth', async () => {
  const m = mondeSession({ reponse: utilisateurOk() });
  const emp = await m.f._empreinteCle(CLE);
  m.r2.ecrire(`_meta/api_keys/${emp}.json`, JSON.stringify({ uid: 'u1', email: 'k@b.example', nom: 'k', plafond: 0, cree: 'x', prefixe: 'mfm_' }));
  const u = await m.f.getSessionUser(req({ authorization: `Bearer ${CLE}` }), m.env);
  assert.deepEqual(u, { id: 'u1', email: 'k@b.example', credits: 42 });
  assert.equal(m.appels.length, 0);
});
test('getSessionUser : cle API inconnue, revoquee ou d\'un compte banni -> null (et pas de repli sur les cookies)', async () => {
  const emp = async (m) => m.f._empreinteCle(CLE);
  let m = mondeSession({ reponse: utilisateurOk() });
  assert.equal(await m.f.getSessionUser(req({ authorization: `Bearer ${CLE}`, cookie: 'mfm-session=' + jwt({ iat: 1 }) }), m.env), null, 'inconnue');
  m = mondeSession({ reponse: utilisateurOk() });
  m.r2.ecrire(`_meta/api_keys/${await emp(m)}.json`, JSON.stringify({ uid: 'u1', revoquee: '2026-10-01' }));
  assert.equal(await m.f.getSessionUser(req({ authorization: `Bearer ${CLE}` }), m.env), null, 'revoquee');
  m = mondeSession({ reponse: utilisateurOk(), banni: ['u1'] });
  m.r2.ecrire(`_meta/api_keys/${await emp(m)}.json`, JSON.stringify({ uid: 'u1' }));
  assert.equal(await m.f.getSessionUser(req({ authorization: `Bearer ${CLE}` }), m.env), null, 'banni');
});

/* ───────────── assetFetch / _cleDepuisUrlSignee : qui peut etre lu depuis le seau ───────────── */
// Reponses fabriquees a la demande (un clone() de Response garde le corps ouvert et bloquerait body.cancel()).
function mondeAssets({ signe = () => new Response('OCTETS', { status: 200 }), externe = () => new Response('EXT', { status: 200 }) } = {}) {
  const appels = { signe: [], externe: [] };
  const f = chargerFonctions(['siteUrl', 'assetFetch', '_cleDepuisUrlSignee'], {
    handleSignedR2: async (rq) => { appels.signe.push(rq.url); return signe(); },
    fetch: async (u) => { appels.externe.push(String(u)); return externe(); },
  });
  return { f, appels, env: { NEXT_PUBLIC_SITE_URL: 'https://site.example' } };
}
test('assetFetch : une URL de NOTRE hote sous /r2/ est servie par le seau (signature verifiee), jamais par une sous-requete reseau', async () => {
  const m = mondeAssets(); const r = await m.f.assetFetch(m.env, 'https://site.example/r2/u1/a.png?exp=1&sig=2');
  assert.equal(await r.text(), 'OCTETS'); assert.equal(m.appels.signe.length, 1); assert.equal(m.appels.externe.length, 0);
});
test('assetFetch : tout autre hote, ou notre hote hors /r2/, passe par fetch() normal', async () => {
  for (const u of ['https://replicate.delivery/a.png', 'https://autre.workers.dev/r2/a.png', 'https://site.example/api/me']) {
    const m = mondeAssets(); await m.f.assetFetch(m.env, u);
    assert.equal(m.appels.signe.length, 0, u); assert.deepEqual(m.appels.externe, [u]);
  }
});
test('_cleDepuisUrlSignee : URL signee de notre hote -> cle DECODEE ; chemin hors /r2/, URL invalide, lecture refusee -> null', async () => {
  let m = mondeAssets(); assert.equal(await m.f._cleDepuisUrlSignee(m.env, 'https://site.example/r2/u1/mon%20dossier/a.glb?exp=1&sig=2'), 'u1/mon dossier/a.glb');
  m = mondeAssets(); assert.equal(await m.f._cleDepuisUrlSignee(m.env, 'https://site.example/api/me'), null);
  m = mondeAssets(); assert.equal(await m.f._cleDepuisUrlSignee(m.env, 'pas une url'), null);
  m = mondeAssets({ signe: () => new Response('interdit', { status: 403 }) }); assert.equal(await m.f._cleDepuisUrlSignee(m.env, 'https://site.example/r2/u1/a.glb?exp=1&sig=2'), null, 'signature refusee : pas de cle');
});
test('_cleDepuisUrlSignee CLOUD-05 (voulu) : un AUTRE hote avec un chemin /r2/ — HEAD ouvre l\'adresse par fetch() (SSRF), vivant refuse sans aucun appel', async () => {
  const m = mondeAssets(); const cle = await m.f._cleDepuisUrlSignee(m.env, 'https://interne.example/r2/u1/a.glb');
  const vivant = existeSource('u.host !== new URL(siteUrl(env,');
  if (vivant) { assert.equal(cle, null); assert.equal(m.appels.externe.length, 0); assert.equal(m.appels.signe.length, 0); }
  else { assert.equal(cle, 'u1/a.glb', 'HEAD : accepte'); assert.deepEqual(m.appels.externe, ['https://interne.example/r2/u1/a.glb']); }
});
