#!/usr/bin/env node
/**
 * Pilote le SITE WEB (serveur cloud) depuis un terminal ou une session Claude
 * Code : appelle les routes de cloud/src/worker.ts connecte a un compte, comme
 * le fait la page. Listing complet : docs/pilotage_web.md (genere par
 * build/lister-routes-web.mjs).
 *
 *   node build/fab-web.mjs cle                colle la CLE API creee dans les reglages du site
 *                                             (saisie masquee) : recommande, pas de mot de passe
 *   node build/fab-web.mjs login <email>      alternative : mot de passe saisi MASQUE ou FABWEB_PASSWORD
 *   node build/fab-web.mjs moi                compte connecte + credits
 *   node build/fab-web.mjs tarifs             grille vivante (GET /api/pricing)
 *   node build/fab-web.mjs routes [mot]       routes connues (docs/pilotage_web.md), filtrees
 *   node build/fab-web.mjs travaux            travaux en cours du compte
 *   node build/fab-web.mjs attendre [jobId] [minutes]   jusqu'a ce qu'il ne soit plus en cours
 *   node build/fab-web.mjs GET  /api/projects
 *   node build/fab-web.mjs POST /api/<route> '<json>' [--payer]   route payante : --payer obligatoire
 *   node build/fab-web.mjs telecharger <url> <fichier>
 *   node build/fab-web.mjs logout
 *
 * ADMIN (2026-10-02) : pour que la session puisse VERIFIER /admin2 avec les vraies reponses du serveur, sans jamais voir un mot de passe :
 *   node build/fab-web.mjs admin-login        A LANCER PAR LE PROPRIETAIRE dans un terminal, apres `cle` ou `login` : nom, mot de passe et code 2FA admin saisis
 *                                             (mot de passe et code MASQUES, jamais transmis a la session) ; garde SEULEMENT le cookie admin (4 h) dans
 *                                             ~/.fabmesh/admin_session.json (droits 0600). Un echec compte dans le verrou du serveur (10 par heure) : aucun nouvel essai automatique.
 *   node build/fab-web.mjs admin-formes       LECTURE SEULE : appelle les routes GET /api/admin/* et n'ecrit que la FORME des reponses (noms de champs, types,
 *                                             longueurs de listes ; AUCUNE valeur, aucun e-mail) dans C:/tmp/admin_formes.json (ou --sortie <fichier>)
 *   node build/fab-web.mjs admin-logout       efface le cookie admin local
 *   Garde : sur /api/admin/*, seules les lectures (GET) passent ; une ecriture exige --ecrire (la session n'en lance jamais sans l'accord du proprietaire).
 *
 * Authentification, dans l'ordre : FABWEB_API_KEY, ~/.fabmesh/cloud_api_key (commande `cle`),
 * puis la session ~/.fabmesh/web_session.json (commande `login`). Tout reste HORS du depot, qui
 * est public. Base : FABWEB_URL ou le site de production.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, createWriteStream } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import https from 'node:https';
import http from 'node:http';
import { pipeline } from 'node:stream/promises';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.env.FABWEB_URL || 'https://myfabmesh-cloud.fabien65400.workers.dev').replace(/\/$/, '');
const SESSION = join(homedir(), '.fabmesh', 'web_session.json');
const FICHIER_CLE = join(homedir(), '.fabmesh', 'cloud_api_key');
const FICHIER_ADMIN = join(homedir(), '.fabmesh', 'admin_session.json');
function cookieAdmin() {
  try { const j = JSON.parse(readFileSync(FICHIER_ADMIN, 'utf-8')); return j && j.valeur && Date.now() < j.expire ? j.valeur : null; } catch (_) { return null; }
}
function cleApi() {
  const k = (process.env.FABWEB_API_KEY || (existsSync(FICHIER_CLE) ? readFileSync(FICHIER_CLE, 'utf-8') : '')).trim();
  return /^mfm_[A-Za-z0-9]{40}$/.test(k) ? k : null;
}

// Valeurs PUBLIQUES (deja servies au navigateur), lues dans cloud/wrangler.toml [vars]
function configSupabase() {
  const t = readFileSync(join(RACINE, 'cloud', 'wrangler.toml'), 'utf-8');
  const v = (k) => (t.match(new RegExp(`^${k}\\s*=\\s*"([^"]+)"`, 'm')) || [])[1];
  const url = process.env.FABWEB_SUPABASE_URL || v('NEXT_PUBLIC_SUPABASE_URL');
  const anon = process.env.FABWEB_SUPABASE_ANON || v('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  if (!url || !anon) throw new Error('NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY introuvables dans cloud/wrangler.toml');
  return { url, anon };
}

const lireSession = () => { try { return JSON.parse(readFileSync(SESSION, 'utf-8')); } catch (_) { return null; } };
function ecrireSession(s) {
  mkdirSync(dirname(SESSION), { recursive: true });
  writeFileSync(SESSION, JSON.stringify(s, null, 1), { mode: 0o600 });
}

async function jetonSupabase(corps, grant) {
  const { url, anon } = configSupabase();
  const r = await fetch(`${url}/auth/v1/token?grant_type=${grant}`, {
    method: 'POST', headers: { 'content-type': 'application/json', apikey: anon }, body: JSON.stringify(corps),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`connexion refusee (${r.status}) : ${j.error_description || j.msg || j.error || 'inconnue'}`);
  return { access_token: j.access_token, refresh_token: j.refresh_token,
           expires_at: Date.now() + (Number(j.expires_in) || 3600) * 1000, email: j.user?.email || corps.email };
}

async function session(forcer) {
  let s = lireSession();
  if (!s) throw new Error("aucune session : lancer `node build/fab-web.mjs login <email>` dans un terminal");
  if (forcer || Date.now() > s.expires_at - 60_000) {
    s = { ...s, ...(await jetonSupabase({ refresh_token: s.refresh_token }, 'refresh_token')) };
    ecrireSession(s);
  }
  return s;
}

function motDePasseMasque(question) {
  return new Promise((res, rej) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) return rej(new Error('pas de terminal interactif : definir FABWEB_PASSWORD ou lancer la commande soi-meme'));
    process.stdout.write(question);
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    let mdp = '';
    const lire = (c) => {
      if (c === '\r' || c === '\n' || c === '\u0004') { stdin.setRawMode(false); stdin.pause(); stdin.off('data', lire); process.stdout.write('\n'); res(mdp); }
      else if (c === '\u0003') { process.exit(130); }
      else if (c === '\u007f' || c === '\b') mdp = mdp.slice(0, -1);
      else mdp += c;
    };
    stdin.on('data', lire);
  });
}

// --- garde des routes payantes (build/pilotage_web_routes.json, genere avec le listing)
function routeConnue(methode, chemin) {
  let routes = [];
  try { routes = JSON.parse(readFileSync(join(RACINE, 'build', 'pilotage_web_routes.json'), 'utf-8')); } catch (_) { return null; }
  const p = chemin.split('?')[0];
  return routes.find((r) => (!r.methodes.length || r.methodes.includes(methode)) && (r.chemin === p
    || new RegExp('^' + r.chemin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:param/g, '[^/]+').replace(/…$/, '.*') + '$').test(p))) || null;
}

async function appel(methode, chemin, corps, { payer = false, ecrire = false } = {}) {
  if (!chemin.startsWith('/')) chemin = '/' + chemin;
  const admin = chemin.startsWith('/api/admin/');
  if (admin && methode !== 'GET' && methode !== 'HEAD' && !ecrire && chemin !== '/api/admin/login') {
    throw new Error(`ECRITURE admin refusee (${methode} ${chemin}) : seules les lectures passent ; relancer avec --ecrire UNIQUEMENT avec l'accord du proprietaire`);
  }
  const r0 = routeConnue(methode, chemin);
  if (r0 && r0.payant && !payer) {
    throw new Error(`route PAYANTE (${r0.tarifs.join(', ')}) : relancer avec --payer pour debiter les credits du compte`);
  }
  // node:https et non fetch : le fetch de Node abandonne apres 300 s sans en-tetes, or une
  // generation sur un conteneur GPU froid peut durer plus longtemps (le worker rejoue les 524).
  const envoyer = (s) => new Promise((res, rej) => {
    const u = new URL(BASE + chemin);
    const corpsTxt = methode === 'GET' || methode === 'HEAD' ? null : JSON.stringify(corps ?? {});
    const req = (u.protocol === 'http:' ? http : https).request(u, {
      method: methode,
      headers: { ...(s.cle ? { authorization: `Bearer ${s.cle}` } : {}),
                 ...((() => { const c = [s.cle ? null : `mfm-session=${s.access_token}`, admin && cookieAdmin() ? `admin_session=${cookieAdmin()}` : null].filter(Boolean); return c.length ? { cookie: c.join('; ') } : {}; })()),
                 'content-type': 'application/json', accept: 'application/json',
                 ...(corpsTxt ? { 'content-length': Buffer.byteLength(corpsTxt) } : {}) },
      timeout: 20 * 60_000,
    }, (r) => {
      const morceaux = [];
      r.on('data', (c) => morceaux.push(c));
      r.on('end', () => res({ status: r.statusCode, headers: r.headers, corps: Buffer.concat(morceaux) }));
    });
    req.on('timeout', () => req.destroy(new Error('delai de 20 min depasse')));
    req.on('error', rej);
    if (corpsTxt) req.write(corpsTxt);
    req.end();
  });
  const cle = cleApi();
  // route publique sans session : appel anonyme (tarifs, catalogue public…)
  const anonyme = !cle && !lireSession() && r0 && r0.acces === 'public';
  let r = await envoyer(cle ? { cle } : anonyme ? { access_token: '' } : await session(false));
  if (r.status === 401 && !anonyme && !cle) r = await envoyer(await session(true));
  const type = String(r.headers['content-type'] || '');
  let data;
  if (type.includes('json')) { try { data = JSON.parse(r.corps.toString('utf-8')); } catch (_) { data = r.corps.toString('utf-8').slice(0, 2000); } }
  else data = `[${type || 'sans type'} ${r.corps.length} octets]`;
  return { status: r.status, ok: r.status >= 200 && r.status < 300, data, setCookie: r.headers['set-cookie'] || [] };
}

const pause = (ms) => new Promise((res) => setTimeout(res, ms));
const args = process.argv.slice(2);
const payer = args.includes('--payer');
const ecrire = args.includes('--ecrire');
const iSortie = args.indexOf('--sortie'); const sortieFormes = iSortie >= 0 ? args[iSortie + 1] : 'C:/tmp/admin_formes.json';
const [cmd, ...a] = args.filter((x, i) => x !== '--payer' && x !== '--ecrire' && x !== '--sortie' && !(iSortie >= 0 && i === iSortie + 1));
// Git Bash convertit « /api/x » en « C:/Program Files/Git/api/x » : on le defait
const chemin = (x) => String(x || '/').replace(/^[A-Za-z]:[\\/].*?[\\/]Git(?=[\\/?]|$)/i, '') || '/';

let res;
try {
  switch ((cmd || '').toLowerCase()) {
    case 'login': {
      const email = a[0] || process.env.FABWEB_EMAIL;
      if (!email) throw new Error('usage : login <email>');
      const mdp = process.env.FABWEB_PASSWORD || await motDePasseMasque(`Mot de passe de ${email} : `);
      const s = await jetonSupabase({ email, password: mdp }, 'password');
      ecrireSession(s);
      res = { connecte: s.email, session: SESSION };
      break;
    }
    case 'cle': {
      const k = (a[0] || await motDePasseMasque('Cle API (mfm_…) : ')).trim();
      if (!/^mfm_[A-Za-z0-9]{40}$/.test(k)) throw new Error('cle invalide : attendu « mfm_ » suivi de 40 caracteres');
      mkdirSync(dirname(FICHIER_CLE), { recursive: true });
      writeFileSync(FICHIER_CLE, k, { mode: 0o600 });
      res = await appel('GET', '/api/me');
      res = { cle: k.slice(0, 12) + '…', fichier: FICHIER_CLE, compte: res.data };
      break;
    }
    case 'oublier-cle':
      rmSync(FICHIER_CLE, { force: true });
      res = { cleRetiree: true };
      break;
    case 'logout':
      try { await appel('POST', '/api/auth/signout', {}); } catch (_) {}
      rmSync(SESSION, { force: true });
      res = { deconnecte: true };
      break;
    case 'admin-login': {
      // Le proprietaire a deja lance `cle` ou `login` : la session (compte administrateur) existe. Ici : la 2e etape, comme la page /admin2.
      const nom = process.env.FABWEB_ADMIN_USER || (await new Promise((ok) => { process.stdout.write("Nom d'utilisateur admin : "); process.stdin.setEncoding('utf8'); process.stdin.once('data', (d) => { process.stdin.pause(); ok(String(d).trim()); }); }));
      const mdp = process.env.FABWEB_ADMIN_PASSWORD || await motDePasseMasque('Mot de passe admin : ');
      let r = await appel('POST', '/api/admin/login', { username: nom, password: mdp });
      if (r.status === 401 && r.data && r.data.error === 'totp_required') {
        const code = process.env.FABWEB_ADMIN_TOTP || await motDePasseMasque('Code a 6 chiffres (application d\'authentification) : ');
        r = await appel('POST', '/api/admin/login', { username: nom, password: mdp, totp: String(code).trim() });
      }
      if (!r.ok) throw new Error(`connexion admin refusee (${r.status}) : ${r.data && (r.data.error || r.data.message) || 'inconnue'} (aucun nouvel essai automatique : 10 echecs par heure verrouillent)`);
      const m = (r.setCookie.join('; ').match(/admin_session=([^;]+)/) || [])[1];
      if (!m) throw new Error("le serveur n'a pas pose de cookie admin");
      mkdirSync(dirname(FICHIER_ADMIN), { recursive: true });
      writeFileSync(FICHIER_ADMIN, JSON.stringify({ valeur: m, expire: Date.now() + 4 * 3600_000 - 60_000, cree: new Date().toISOString() }), { mode: 0o600 });
      res = { admin: true, valable_jusqu_a: new Date(Date.now() + 4 * 3600_000 - 60_000).toISOString(), fichier: FICHIER_ADMIN };
      break;
    }
    case 'admin-logout':
      rmSync(FICHIER_ADMIN, { force: true });
      res = { cookieAdminEfface: true };
      break;
    case 'admin-formes': {
      if (!cookieAdmin()) throw new Error('pas de cookie admin valide : lancer `node build/fab-web.mjs admin-login` (par le proprietaire)');
      // Seules les routes de LECTURE : GET, sans parametre de chemin, qui ne modifient rien. Liste explicite = ce que /admin2 appelle au chargement.
      const LECTURES = ['/api/admin/live?n=100', '/api/admin/services', '/api/admin/market/killswitch', '/api/admin/badges', '/api/admin/stats.json', '/api/admin/audience.json', '/api/admin/users',
        '/api/admin/contact-messages', '/api/admin/market/list', '/api/admin/pricing', '/api/admin/modal-status', '/api/admin/sante.json', '/api/admin/totp/status', '/api/admin/images/recent',
        '/api/admin/creations', '/api/admin/argent-recent?heures=24', '/api/admin/payments', '/api/admin/payments/unreconciled', '/api/admin/modal-credits', '/api/admin/traces?limit=5',
        '/api/admin/logs/list', '/api/admin/audit', '/api/admin/jobs/active'];
      const forme = (v, prof = 0) => {
        if (v === null) return 'null';
        if (Array.isArray(v)) return { '[]': v.length, element: v.length && prof < 6 ? forme(v[0], prof + 1) : undefined };
        if (typeof v === 'object') { if (prof >= 6) return 'objet'; const o = {}; for (const k of Object.keys(v).sort()) o[k] = forme(v[k], prof + 1); return o; }
        return typeof v;
      };
      const sortie = { genere: new Date().toISOString(), note: 'FORMES seulement : aucune valeur, aucun e-mail. Les champs absents d\'une liste vide ne sont pas visibles.', routes: {} };
      for (const ch of LECTURES) {
        try { const r = await appel('GET', ch, null); sortie.routes[ch] = { status: r.status, forme: forme(r.data) }; }
        catch (e) { sortie.routes[ch] = { erreur: String(e.message).slice(0, 120) }; }
      }
      mkdirSync(dirname(resolve(sortieFormes)), { recursive: true });
      writeFileSync(resolve(sortieFormes), JSON.stringify(sortie, null, 1));
      res = { fichier: resolve(sortieFormes), routes: Object.fromEntries(Object.entries(sortie.routes).map(([k, v]) => [k, v.status || v.erreur])) };
      break;
    }
    case 'moi': res = await appel('GET', '/api/me'); break;
    case 'tarifs': res = await appel('GET', '/api/pricing'); break;
    case 'travaux': res = await appel('GET', '/api/me/active-jobs'); break;
    case 'routes': {
      const routes = JSON.parse(readFileSync(join(RACINE, 'build', 'pilotage_web_routes.json'), 'utf-8'));
      const q = (a[0] || '').toLowerCase();
      res = routes.filter((r) => !q || (r.chemin + ' ' + r.handler).toLowerCase().includes(q))
        .map((r) => `${(r.methodes.join('/') || '*').padEnd(8)} ${r.chemin.padEnd(46)} ${r.acces.padEnd(7)} ${r.payant ? 'PAYANT ' + r.tarifs.join(', ') : ''}`);
      break;
    }
    case 'attendre': {
      const id = a[0], fin = Date.now() + (Number(a[1]) || 30) * 60_000;
      for (;;) {
        const r = await appel('GET', '/api/me/active-jobs');
        const jobs = (r.data && r.data.jobs) || [];
        const encours = jobs.filter((j) => ['queued', 'processing', 'running', 'pending'].includes(j.status));
        const vise = id ? encours.find((j) => String(j.id) === String(id)) : encours[0];
        if (!vise) { res = { termine: true, recents: jobs.slice(0, 5) }; break; }
        if (Date.now() > fin) { res = { termine: false, encours: vise }; break; }
        process.stderr.write(`… ${vise.type || vise.mode || ''} ${vise.status}\n`);
        await pause(10_000);
      }
      break;
    }
    case 'telecharger': {
      const [url, fichier] = a;
      if (!url || !fichier) throw new Error('usage : telecharger <url> <fichier>');
      const k = cleApi();
      const auth = k ? { authorization: `Bearer ${k}` } : { cookie: `mfm-session=${(await session(false)).access_token}` };
      const r = await fetch(url.startsWith('http') ? url : BASE + chemin(url), { headers: auth });
      if (!r.ok) throw new Error(`telechargement refuse (${r.status})`);
      await pipeline(Readable.fromWeb(r.body), createWriteStream(resolve(fichier)));
      res = { fichier: resolve(fichier), octets: Number(r.headers.get('content-length')) || null };
      break;
    }
    case 'get': case 'post': case 'delete': case 'put':
      res = await appel(cmd.toUpperCase(), chemin(a[0]), a[1] ? JSON.parse(a[1]) : {}, { payer, ecrire });
      break;
    default:
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf-8').split('*/')[0]);
      process.exit(cmd ? 1 : 0);
  }
} catch (e) {
  console.error('Echec :', e.message);
  process.exit(1);
}
console.log(typeof res === 'string' ? res : JSON.stringify(res, null, 1));
if (res && res.ok === false) process.exit(1);
