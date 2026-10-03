// Vague 5, voie « bureau-reste » (2026-10-03) : constats D-05 (reste, URL des telechargements) et D-08 (nom de projet dans les rapports).
//   node --test tests/main/vague5-bureau.test.mjs
// Rejouer contre l'ANCIEN code (les memes tests doivent alors ECHOUER) :
//   MAIN_JS=<ancien main.js> DURC_JS=<ancien durcissement.js> CLOUD_FALLBACK_JS=<ancien cloud_fallback.js> node --test tests/main/vague5-bureau.test.mjs
// Aucun appel reseau : https.get, electron.net.fetch et fetch sont des doublures.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ici = path.dirname(fileURLToPath(import.meta.url));
const racineDepot = path.resolve(ici, '..', '..');
const DURC_JS = process.env.DURC_JS || path.join(racineDepot, 'src', 'main', 'durcissement.js');
const MAIN_JS = process.env.MAIN_JS || path.join(racineDepot, 'src', 'main', 'main.js');
const CLOUD_JS = process.env.CLOUD_FALLBACK_JS || path.join(racineDepot, 'src', 'main', 'cloud_fallback.js');
const D = require(DURC_JS);
const texteMain = fs.readFileSync(MAIN_JS, 'utf-8').replace(/\r\n/g, '\n');

function bloc(debut, fin = '\n});\n') {
  const i = texteMain.indexOf(debut);
  assert.ok(i >= 0, 'ancre introuvable dans main.js : ' + debut);
  const j = texteMain.indexOf(fin, i);
  assert.ok(j >= 0, 'fin introuvable pour : ' + debut);
  return texteMain.slice(i, j + fin.length);
}
function fonction(nom) { return bloc('function ' + nom + '(', '\n}\n'); }

// ============================================================ fonction pure : URL ====
const ACCEPTEES = [
  'https://example.com/a.png',
  'https://cdn.example.co.uk/img/a.jpg?x=1#f',
  'https://8.8.8.8/a.png',
  'https://xn--bcher-kva.example/a.png',
  'https://myfabmesh-cloud.fabien65400.workers.dev/r2/mesh/a.glb?exp=1&sig=ab',
  'https://example.com:8443/a.png',
];
const REFUSEES = [
  ['http://example.com/a.png', 'http en clair'],
  ['file:///C:/Windows/win.ini', 'schema file'],
  ['ftp://example.com/a.png', 'schema ftp'],
  ['data:image/png;base64,AAAA', 'schema data'],
  ['javascript:alert(1)', 'schema javascript'],
  ['https://localhost/a.png', 'localhost'],
  ['https://LOCALHOST./a.png', 'localhost avec point final et majuscules'],
  ['https://foo.localhost/a.png', 'sous-domaine de localhost'],
  ['https://127.0.0.1/a.png', 'boucle locale'],
  ['https://127.1/a.png', 'boucle locale abregee'],
  ['https://127.255.255.254/a.png', '127/8 entier'],
  ['https://2130706433/a.png', 'boucle locale en notation decimale'],
  ['https://0x7f000001/a.png', 'boucle locale en hexadecimal'],
  ['https://0x7f.0.0.1/a.png', 'hexadecimal par champ'],
  ['https://0177.0.0.1/a.png', 'octal'],
  ['https://017700000001/a.png', 'octal entier'],
  ['https://0.0.0.0/a.png', '0.0.0.0'],
  ['https://10.0.0.5/a.png', '10/8'],
  ['https://172.16.0.1/a.png', '172.16/12 bas'],
  ['https://172.31.255.255/a.png', '172.16/12 haut'],
  ['https://192.168.1.1/a.png', '192.168/16'],
  ['https://169.254.169.254/latest/meta-data', 'metadonnees des hebergeurs'],
  ['https://100.64.0.1/a.png', 'CGNAT'],
  ['https://[::1]/a.png', 'IPv6 boucle locale'],
  ['https://[::]/a.png', 'IPv6 non specifiee'],
  ['https://[fe80::1]/a.png', 'IPv6 lien local'],
  ['https://[fc00::1]/a.png', 'IPv6 locale unique'],
  ['https://[::ffff:127.0.0.1]/a.png', 'IPv4 encapsulee dans IPv6'],
  ['https://[::ffff:7f00:1]/a.png', 'IPv4 encapsulee, forme hexadecimale'],
  ['https://[2606:4700::1111]/a.png', 'toute IPv6 litterale est refusee'],
  ['https://user@example.com/a.png', 'identifiant'],
  ['https://user:pass@example.com/a.png', 'identifiant et mot de passe'],
  ['https://example.com@127.0.0.1/a.png', 'faux hote avant l arobase'],
  ['https://example.com\\@127.0.0.1/a.png', 'barre oblique inverse'],
  ['https://intranet/a.png', 'nom sans domaine'],
  ['https://monpc.local/a.png', '.local'],
  ['https://service.internal/a.png', '.internal'],
  ['https://routeur.lan/a.png', '.lan'],
  ['https://example.com/a\nb.png', 'saut de ligne dans l adresse'],
  ['', 'vide'],
  ['   ', 'espaces'],
  ['pas une url', 'illisible'],
  ['https://', 'sans hote'],
  [null, 'null'],
  [undefined, 'undefined'],
  [42, 'nombre'],
  [{ href: 'https://example.com/' }, 'objet'],
];

test('urlTelechargementAutorisee : tables d URL acceptees', () => {
  for (const u of ACCEPTEES) assert.equal(D.urlTelechargementAutorisee(u, null), true, 'a refuser a tort : ' + u);
});

test('urlTelechargementAutorisee : tables d URL refusees (adresses locales, schemas, ecritures piegees)', () => {
  for (const [u, pourquoi] of REFUSEES) {
    assert.equal(D.urlTelechargementAutorisee(u, null), false, 'accepte a tort (' + pourquoi + ') : ' + String(u));
    assert.equal(D.urlTelechargementAutorisee(u, ['example.com', '*.example.com']), false, 'accepte a tort avec liste (' + pourquoi + ') : ' + String(u));
  }
});

test('urlTelechargementAutorisee : liste d hotes (exact, sous-domaines, aucun faux ami)', () => {
  const L = ['myfabmesh-cloud.fabien65400.workers.dev', '*.replicate.delivery'];
  assert.equal(D.urlTelechargementAutorisee('https://myfabmesh-cloud.fabien65400.workers.dev/r2/a.glb', L), true);
  assert.equal(D.urlTelechargementAutorisee('https://MYFABMESH-CLOUD.fabien65400.workers.dev./r2/a.glb', L), true, 'casse et point final');
  assert.equal(D.urlTelechargementAutorisee('https://pbxt.replicate.delivery/a.png', L), true);
  assert.equal(D.urlTelechargementAutorisee('https://replicate.delivery/a.png', L), false, '*.x ne couvre pas x lui-meme');
  assert.equal(D.urlTelechargementAutorisee('https://evilreplicate.delivery/a.png', L), false, 'suffixe sans point');
  assert.equal(D.urlTelechargementAutorisee('https://sub.myfabmesh-cloud.fabien65400.workers.dev/a.glb', L), false, 'sous-domaine d un hote exact');
  assert.equal(D.urlTelechargementAutorisee('https://myfabmesh-cloud.fabien65400.workers.dev.evil.com/a.glb', L), false, 'hote en prefixe');
  assert.equal(D.urlTelechargementAutorisee('https://example.com/a.png', L), false);
  assert.equal(D.urlTelechargementAutorisee('https://example.com/a.png', []), false, 'liste vide = rien d autorise');
  assert.equal(D.urlTelechargementAutorisee('https://example.com/a.png', ['.example.com']), false, '.x ne couvre pas x lui-meme');
  assert.equal(D.urlTelechargementAutorisee('https://a.example.com/a.png', ['.example.com']), true);
});

test('analyserUrlTelechargement : rend l adresse NORMALISEE et la raison du refus', () => {
  const ok = D.analyserUrlTelechargement('  https://Example.COM:443/a%20b.png?x=1  ', null);
  assert.equal(ok.ok, true);
  assert.equal(ok.url, 'https://example.com/a%20b.png?x=1');
  assert.equal(ok.hote, 'example.com');
  const non = D.analyserUrlTelechargement('http://127.0.0.1/', null);
  assert.equal(non.ok, false);
  assert.match(non.raison, /https/);
  assert.match(D.analyserUrlTelechargement('https://2130706433/', null).raison, /locale|privee/);
});

test('adresseIpPubliqueSure : IPv4 et IPv6', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111', '2a00:1450:4007:80f::200e']) assert.equal(D.adresseIpPubliqueSure(ip), true, ip);
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.0.10', '169.254.1.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '100.100.0.1',
    '::', '::1', 'fe80::1', 'fe80::1%eth0', 'fc00::1', 'fd12:3456::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:7f00:1',
    '64:ff9b::7f00:1', '2002:7f00:1::', '2001:db8::1', '2001::1', 'pas une ip', '', null, undefined, '1.2.3', '256.1.1.1']) {
    assert.equal(D.adresseIpPubliqueSure(ip), false, String(ip));
  }
  assert.equal(D.adresseIpPubliqueSure('::ffff:8.8.8.8'), true, 'IPv4 publique encapsulee');
  assert.equal(D.adresseIpPubliqueSure('64:ff9b::808:808'), true, 'NAT64 vers une IPv4 publique');
});

test('creerLookupPublic : refuse une resolution qui contient UNE adresse non publique (rebinding DNS)', async () => {
  const faux = (rep) => (hote, options, cb) => setImmediate(() => rep(cb));
  const appel = (lookup, hote = 'exemple.test', opts = {}) => new Promise((resolve) => lookup(hote, opts, (err, adr, fam) => resolve({ err, adr, fam })));
  let r = await appel(D.creerLookupPublic(faux((cb) => cb(null, '8.8.8.8', 4))));
  assert.equal(r.err, null); assert.equal(r.adr, '8.8.8.8'); assert.equal(r.fam, 4);
  r = await appel(D.creerLookupPublic(faux((cb) => cb(null, '127.0.0.1', 4))));
  assert.equal(r.err.code, 'EADRBLOQUEE');
  r = await appel(D.creerLookupPublic(faux((cb) => cb(null, [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }]))), 'x.test', { all: true });
  assert.equal(r.err.code, 'EADRBLOQUEE', 'une seule adresse privee dans la liste suffit');
  r = await appel(D.creerLookupPublic(faux((cb) => cb(null, [{ address: '8.8.8.8', family: 4 }, { address: '2606:4700::1111', family: 6 }]))), 'x.test', { all: true });
  assert.equal(r.err, null);
  r = await appel(D.creerLookupPublic(faux((cb) => cb(null, [{ address: '::1', family: 6 }]))), 'x.test', { all: true });
  assert.equal(r.err.code, 'EADRBLOQUEE');
  r = await appel(D.creerLookupPublic(faux((cb) => cb(new Error('ENOTFOUND')))));
  assert.match(r.err.message, /ENOTFOUND/, 'une erreur DNS normale est transmise telle quelle');
  // forme a deux arguments (pas d options)
  const lk = D.creerLookupPublic((h, o, cb) => cb(null, '1.1.1.1', 4));
  r = await new Promise((resolve) => lk('x.test', (err, adr) => resolve({ err, adr })));
  assert.equal(r.adr, '1.1.1.1');
});

// ======================================================== cablage : download-to-temp ====
function chargerDownloadToTemp({ reponses = [] } = {}) {
  const gestionnaires = new Map();
  const ipcMain = { handle: (nom, fn) => gestionnaires.set(nom, fn) };
  const appels = [];
  const faireHttps = (schema) => ({
    get(url, options, cb) {
      appels.push({ schema, url: String(url), options });
      const rep = reponses.shift();
      const handlers = {};
      const req = { on(ev, fn) { handlers[ev] = fn; return req; }, destroy() {} };
      setImmediate(() => {
        if (!rep) { handlers.error && handlers.error(new Error('ECONNREFUSEE (doublure)')); return; }
        const res = Object.assign(new (require('node:events').EventEmitter)(), {
          statusCode: rep.status, headers: rep.headers || {}, resume() {}, pipe(out) { this.emit('data', Buffer.alloc(200, 1)); out.end(Buffer.alloc(200, 1)); },
        });
        cb(res);
      });
      return req;
    },
  });
  const requireDouble = (m) => {
    if (m === 'https') return faireHttps('https');
    if (m === 'http') return faireHttps('http');
    if (m === 'dns') return { lookup: (h, o, cb) => cb(null, '93.184.216.34', 4) };
    return require(m);
  };
  const code = bloc("ipcMain.handle('download-to-temp',");
  new Function('ipcMain', 'path', 'fs', 'require', 'analyserUrlTelechargement', 'creerLookupPublic', code)(
    ipcMain, path, fs, requireDouble, D.analyserUrlTelechargement, D.creerLookupPublic);
  return { dl: gestionnaires.get('download-to-temp'), appels };
}

test('download-to-temp : une adresse locale, privee ou non https est refusee AVANT tout reseau', async () => {
  const mauvaises = ['http://example.com/a.png', 'http://127.0.0.1:5555/secret', 'https://127.0.0.1/a.png', 'https://localhost/a.png',
    'https://192.168.1.1/admin', 'https://169.254.169.254/latest/meta-data', 'https://2130706433/a.png', 'https://[::1]/a.png',
    'https://user:pw@example.com/a.png', 'file:///C:/Windows/win.ini', 'ftp://example.com/a.png', 'javascript:alert(1)'];
  for (const u of mauvaises) {
    const { dl, appels } = chargerDownloadToTemp();
    const r = await dl({}, u);
    assert.equal(r.success, false, 'accepte a tort : ' + u);
    assert.equal(typeof r.error, 'string');
    assert.equal(appels.length, 0, 'une requete est partie pour : ' + u);
  }
  const { dl } = chargerDownloadToTemp();
  for (const v of [undefined, null, '', 42, {}]) assert.equal((await dl({}, v)).success, false);
});

test('download-to-temp : une redirection vers une adresse locale est refusee (aucune seconde requete)', async () => {
  for (const cible of ['http://127.0.0.1:5555/secret', 'https://192.168.1.1/admin', 'https://169.254.169.254/latest', '/\\\\evil']) {
    const { dl, appels } = chargerDownloadToTemp({ reponses: [{ status: 302, headers: { location: cible } }] });
    const r = await dl({}, 'https://example.com/a.png');
    assert.equal(r.success, false, cible);
    assert.equal(appels.length, 1, 'la redirection a ete suivie vers ' + cible);
    assert.match(r.error, /refused|invalid|refus/i);
  }
});

test('download-to-temp : une image publique en https est telechargee (comportement conserve), avec la garde DNS', async () => {
  const { dl, appels } = chargerDownloadToTemp({ reponses: [{ status: 200, headers: { 'content-type': 'image/png' } }] });
  const r = await dl({}, 'https://example.com/a.png');
  assert.equal(r.success, true, JSON.stringify(r));
  assert.ok(r.path && fs.existsSync(r.path));
  assert.equal(appels.length, 1);
  assert.equal(appels[0].schema, 'https');
  assert.equal(typeof appels[0].options.lookup, 'function', 'le lookup qui refuse les adresses privees est branche');
  try { fs.unlinkSync(r.path); } catch (_) {}
});

test('download-to-temp : une redirection publique est suivie (comportement conserve)', async () => {
  const { dl, appels } = chargerDownloadToTemp({ reponses: [
    { status: 302, headers: { location: '/autre/b.png' } },
    { status: 200, headers: { 'content-type': 'image/jpeg' } },
  ] });
  const r = await dl({}, 'https://example.com/a.png');
  assert.equal(r.success, true, JSON.stringify(r));
  assert.equal(appels.length, 2);
  assert.equal(appels[1].url, 'https://example.com/autre/b.png');
  try { fs.unlinkSync(r.path); } catch (_) {}
});

// ======================================================== cablage : downloadItem ====
function chargerCloudFallback() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fm-v5-')));
  const meshes = path.join(base, 'meshes'); const images = path.join(base, 'images');
  fs.mkdirSync(meshes, { recursive: true }); fs.mkdirSync(images, { recursive: true });
  delete require.cache[require.resolve(CLOUD_JS)];
  const M = require(CLOUD_JS);
  const gestionnaires = new Map();
  M.register({ ipcMain: { handle: (nom, fn) => gestionnaires.set(nom, fn) }, MESHES_DIR: meshes, IMAGES_DIR: images, isCloudMode: () => false });
  return { dl: gestionnaires.get('cloud-download-item'), base, meshes, images };
}

async function avecFetch(reponses, fn) {
  const avant = globalThis.fetch;
  const appels = [];
  globalThis.fetch = async (url, options) => {
    appels.push({ url: String(url), options });
    const rep = reponses.length ? reponses.shift() : { status: 200 };
    if (rep.status >= 300 && rep.status < 400) return new Response(null, { status: rep.status, headers: { location: rep.location } });
    return new Response(Buffer.alloc(300, 7), { status: rep.status || 200 });
  };
  try { return await fn(appels); } finally { globalThis.fetch = avant; }
}

test('downloadItem : adresse locale, http, hote etranger ou identifiants refuses AVANT tout reseau', async () => {
  const { dl } = chargerCloudFallback();
  const mauvaises = ['http://127.0.0.1:8080/secret', 'https://127.0.0.1/a.png', 'https://localhost/a.png', 'https://192.168.1.1/a.png',
    'https://169.254.169.254/latest/meta-data', 'https://2130706433/a.png', 'https://[::1]/a.png', 'http://myfabmesh-cloud.fabien65400.workers.dev/r2/a.png',
    'https://evil.example.com/a.png', 'https://sub.myfabmesh-cloud.fabien65400.workers.dev/r2/a.png',
    'https://myfabmesh-cloud.fabien65400.workers.dev@evil.example.com/r2/a.png', 'file:///C:/Windows/win.ini', '//evil.example.com/a.png', 'javascript:1'];
  for (const u of mauvaises) {
    await avecFetch([], async (appels) => {
      const r = await dl({}, { url: u, fname: 'x.png', kind: 'image', project: 'p' });
      assert.equal(r.success, false, 'accepte a tort : ' + u);
      assert.equal(typeof r.error, 'string');
      assert.equal(appels.length, 0, 'une requete est partie pour : ' + u);
    });
  }
});

test('downloadItem : une redirection du site vers une adresse locale n est pas suivie', async () => {
  const { dl } = chargerCloudFallback();
  await avecFetch([{ status: 302, location: 'http://127.0.0.1:8080/secret' }], async (appels) => {
    const r = await dl({}, { url: '/r2/mesh/a.glb?exp=1&sig=x', fname: 'a.glb', kind: 'mesh' });
    assert.equal(r.success, false);
    assert.equal(appels.length, 1, 'la redirection a ete suivie');
  });
});

test('downloadItem : les URL du site (relative et absolue) fonctionnent toujours (comportement conserve)', async () => {
  const { dl, meshes, images } = chargerCloudFallback();
  await avecFetch([], async (appels) => {
    const r = await dl({}, { url: '/r2/mesh/a.glb?exp=1&sig=x', fname: 'a.glb', kind: 'mesh' });
    assert.equal(r.success, true, JSON.stringify(r));
    assert.ok(fs.existsSync(path.join(meshes, 'a.glb')));
    assert.match(appels[0].url, /^https:\/\/myfabmesh-cloud\.fabien65400\.workers\.dev\/r2\/mesh\/a\.glb\?exp=1&sig=x$/);
  });
  await avecFetch([], async (appels) => {
    const r = await dl({}, { url: 'https://myfabmesh-cloud.fabien65400.workers.dev/r2/u/front/b.png?exp=1&sig=y', fname: 'b.png', kind: 'image', project: 'mon projet' });
    assert.equal(r.success, true, JSON.stringify(r));
    assert.ok(fs.existsSync(path.join(images, 'mon_projet', 'b.png')));
    assert.equal(appels.length, 1);
  });
  await avecFetch([{ status: 302, location: '/r2/mesh/c.glb?exp=2&sig=z' }, { status: 200 }], async (appels) => {
    const r = await dl({}, { url: '/r2/mesh/c0.glb', fname: 'c.glb', kind: 'mesh' });
    assert.equal(r.success, true, 'redirection interne au site');
    assert.equal(appels.length, 2);
  });
});

test('downloadItem : sans url ni marketId, erreur claire sans lever', async () => {
  const { dl } = chargerCloudFallback();
  await avecFetch([], async (appels) => {
    for (const o of [{ fname: 'x.png' }, { url: '', fname: 'x.png' }, { url: 'x.png', fname: 'x.png' }, { url: 12, fname: 'x.png' }]) {
      const r = await dl({}, o);
      assert.equal(r.success, false);
    }
    assert.equal(appels.length, 0);
  });
});

// ================================================================= D-08 : masquage ====
test('masquerNomsProjet : identifiant court et STABLE, casse ignoree, chemins et noms de fichiers couverts', () => {
  const a = D.masquerNomsProjet('project Mon Chateau ; C:\\x\\images\\mon chateau\\ref_0.png ; mon chateau_1727.glb ; MON CHATEAU', ['Mon Chateau']);
  assert.ok(!/chateau/i.test(a), a);
  const ids = a.match(/projet-[0-9a-f]{6}/g);
  assert.equal(ids.length, 4);
  assert.equal(new Set(ids).size, 1, 'meme identifiant partout');
  assert.equal(D.identifiantProjet('Mon Chateau'), D.identifiantProjet('  mon chateau '));
  assert.notEqual(D.identifiantProjet('Mon Chateau'), D.identifiantProjet('Autre'));
  assert.match(D.identifiantProjet('x'), /^projet-[0-9a-f]{6}$/);
});

test('masquerNomsProjet : pas de faux positif sur les mots generiques, les noms courts ou les sous-chaines', () => {
  const t = D.masquerNomsProjet('un bus; busy; business; bus_1.glb', ['bus']);
  assert.equal(t, 'un ' + D.identifiantProjet('bus') + '; busy; business; ' + D.identifiantProjet('bus') + '_1.glb');
  assert.equal(D.masquerNomsProjet('log mesh images ab', ['log', 'mesh', 'images', 'ab', 'Test', 'cloud_import']), 'log mesh images ab');
  assert.equal(D.masquerNomsProjet('rien a voir', ['Orc Chief']), 'rien a voir');
  assert.equal(D.masquerNomsProjet('a.b (c) [d]', ['a.b (c)']), D.identifiantProjet('a.b (c)') + ' [d]', 'metacaracteres de regex echappes');
  for (const v of [undefined, null, 5]) assert.equal(D.masquerNomsProjet(v, ['abc']), v);
  assert.equal(D.masquerNomsProjet('abc', undefined), 'abc');
  assert.equal(D.masquerNomsProjet('abc', []), 'abc');
  // le plus long gagne : « Mon Chateau Fort » n est pas coupe en « Mon Chateau » + « Fort »
  const l = D.masquerNomsProjet('Mon Chateau Fort', ['Mon Chateau', 'Mon Chateau Fort']);
  assert.equal(l, D.identifiantProjet('Mon Chateau Fort'));
});

test('nettoyerEvenementSentry : masque aussi les noms de projet quand on les donne (D-08), chemins toujours nettoyes (D-09)', () => {
  const ev = { message: 'echec sur Mon Chateau', exception: { values: [{ value: 'ENOENT C:\\Users\\Jean\\images\\Mon Chateau\\ref_0.png' }] }, breadcrumbs: [{ message: 'project=Mon Chateau' }] };
  const out = D.nettoyerEvenementSentry(ev, ['Mon Chateau']);
  const s = JSON.stringify(out);
  assert.ok(!/chateau/i.test(s), s);
  assert.ok(!/Jean/.test(s), s);
  assert.equal((s.match(/projet-[0-9a-f]{6}/g) || []).length, 3);
  const sans = D.nettoyerEvenementSentry({ message: 'x Mon Chateau' });
  assert.equal(sans.message, 'x Mon Chateau', 'sans liste de noms, rien n est masque (compatibilite)');
});

// ---- send-diagnostics : le rapport ENVOYE est masque ; l export sur le Bureau n'est pas touche ----
function chargerEnvoiDiagnostics({ texteDiag, dossiers = [], affichage = {} }) {
  const racine = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fm-v5d-')));
  const images = path.join(racine, 'images'); fs.mkdirSync(images);
  for (const d of dossiers) fs.mkdirSync(path.join(images, d));
  fs.writeFileSync(path.join(images, 'fichier.txt'), 'x');
  const gestionnaires = new Map();
  const ipcMain = { handle: (nom, fn) => gestionnaires.set(nom, fn) };
  const envoyes = [];
  const requireDouble = (m) => (m === 'electron'
    ? { net: { fetch: async (url, opts) => { envoyes.push({ url, opts }); return { ok: true, status: 200, json: async () => ({ ok: true, id: 'abc' }) }; } } }
    : require(m));
  const code = [fonction('_nomsDeProjets'), bloc("ipcMain.handle('send-diagnostics',")].join('\n');
  new Function('ipcMain', 'fs', 'path', 'require', 'app', 'IMAGES_DIR', 'loadConfig', '_diagnosticsTexte', 'masquerNomsProjet', code)(
    ipcMain, fs, path, requireDouble, { getVersion: () => '1.0.0' }, images, () => ({ projectDisplayNames: affichage }), () => texteDiag, D.masquerNomsProjet);
  return { envoi: gestionnaires.get('send-diagnostics'), envoyes };
}

test('masquerNomsDansEvenement : masque les noms sans toucher au reste (les chemins sont nettoyes a part)', () => {
  const ev = { message: 'echec Mon Chateau', fil: [{ v: 'C:/Users/Jean/Mon Chateau' }] };
  D.masquerNomsDansEvenement(ev, ['Mon Chateau']);
  assert.ok(!/chateau/i.test(JSON.stringify(ev)));
  assert.match(ev.fil[0].v, /Jean/, 'ne nettoie pas les chemins : c est le role de nettoyerEvenementSentry');
});

test('send-diagnostics : le nom de projet (dossier ou nom affiche) ne part pas en clair vers le support', async () => {
  const texte = ['MyFabmesh.AI diagnostics', 'project=Chevalier Noir', 'C:\\data\\images\\Chevalier_Noir\\ref_0.png', 'Chevalier_Noir_1727.glb', 'affiche : Mon Super Chevalier', 'version 1.0'].join('\n');
  const { envoi, envoyes } = chargerEnvoiDiagnostics({ texteDiag: texte, dossiers: ['Chevalier_Noir', '_calibration'], affichage: { Chevalier_Noir: 'Mon Super Chevalier' } });
  const r = await envoi({});
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(envoyes.length, 1);
  const corps = String(envoyes[0].opts.body);
  assert.ok(!/Chevalier_Noir/i.test(corps), corps);
  assert.ok(!/Mon Super Chevalier/i.test(corps), corps);
  assert.match(corps, new RegExp(D.identifiantProjet('Chevalier_Noir')));
  assert.match(corps, /MyFabmesh\.AI diagnostics/, 'le reste du rapport est conserve');
  assert.match(corps, /version 1\.0/);
});

test('send-diagnostics : un dossier illisible ou une config cassee n empechent pas l envoi', async () => {
  const { envoi, envoyes } = chargerEnvoiDiagnostics({ texteDiag: 'rapport simple', dossiers: [] });
  const r = await envoi({});
  assert.equal(r.ok, true);
  assert.equal(String(envoyes[0].opts.body), 'rapport simple');
});

test('main.js : le rapport Sentry recoit les noms de projet', () => {
  assert.match(texteMain, /masquerNomsDansEvenement\(event, _noms\)/);
  assert.match(texteMain, /function _nomsDeProjets\(/);
});
