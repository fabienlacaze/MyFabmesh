#!/usr/bin/env node
/**
 * Pilote le SITE WEB (serveur cloud) depuis un terminal ou une session Claude
 * Code : appelle les routes de cloud/src/worker.ts connecte a un compte, comme
 * le fait la page. Listing complet : docs/pilotage_web.md (genere par
 * build/lister-routes-web.mjs).
 *
 *   node build/fab-web.mjs login <email>      mot de passe saisi MASQUE (a lancer soi-meme
 *                                             dans un terminal) ou FABWEB_PASSWORD
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
 * Session : ~/.fabmesh/web_session.json (HORS du depot, qui est public), jeton
 * rafraichi automatiquement. Base : FABWEB_URL ou le site de production.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, createWriteStream } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.env.FABWEB_URL || 'https://myfabmesh-cloud.fabien65400.workers.dev').replace(/\/$/, '');
const SESSION = join(homedir(), '.fabmesh', 'web_session.json');

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

async function appel(methode, chemin, corps, { payer = false } = {}) {
  if (!chemin.startsWith('/')) chemin = '/' + chemin;
  const r0 = routeConnue(methode, chemin);
  if (r0 && r0.payant && !payer) {
    throw new Error(`route PAYANTE (${r0.tarifs.join(', ')}) : relancer avec --payer pour debiter les credits du compte`);
  }
  const envoyer = async (s) => fetch(BASE + chemin, {
    method: methode,
    headers: { cookie: `mfm-session=${s.access_token}`, 'content-type': 'application/json', accept: 'application/json' },
    body: methode === 'GET' || methode === 'HEAD' ? undefined : JSON.stringify(corps ?? {}),
  });
  // route publique sans session : appel anonyme (tarifs, catalogue public…)
  const anonyme = !lireSession() && r0 && r0.acces === 'public';
  let r = await envoyer(anonyme ? { access_token: '' } : await session(false));
  if (r.status === 401 && !anonyme) r = await envoyer(await session(true));
  const type = r.headers.get('content-type') || '';
  const data = type.includes('json') ? await r.json().catch(() => null) : `[${type || 'sans type'} ${r.headers.get('content-length') || '?'} octets]`;
  return { status: r.status, ok: r.ok, data };
}

const pause = (ms) => new Promise((res) => setTimeout(res, ms));
const args = process.argv.slice(2);
const payer = args.includes('--payer');
const [cmd, ...a] = args.filter((x) => x !== '--payer');
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
    case 'logout':
      try { await appel('POST', '/api/auth/signout', {}); } catch (_) {}
      rmSync(SESSION, { force: true });
      res = { deconnecte: true };
      break;
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
      const s = await session(false);
      const r = await fetch(url.startsWith('http') ? url : BASE + chemin(url), { headers: { cookie: `mfm-session=${s.access_token}` } });
      if (!r.ok) throw new Error(`telechargement refuse (${r.status})`);
      await pipeline(Readable.fromWeb(r.body), createWriteStream(resolve(fichier)));
      res = { fichier: resolve(fichier), octets: Number(r.headers.get('content-length')) || null };
      break;
    }
    case 'get': case 'post': case 'delete': case 'put':
      res = await appel(cmd.toUpperCase(), chemin(a[0]), a[1] ? JSON.parse(a[1]) : {}, { payer });
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
