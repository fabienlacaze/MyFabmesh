#!/usr/bin/env node
/**
 * Pilote l'appli de BUREAU depuis un terminal (ou une session Claude Code) via
 * la Control API locale (127.0.0.1:7331). Listing complet des commandes :
 * docs/pilotage_bureau.md.
 *
 *   node build/fab.mjs GET  /ui/catalog q=resize
 *   node build/fab.mjs POST /ui/click '{"target":"ws-mesh-resize-btn"}'
 *   node build/fab.mjs POST /ipc '{"method":"listMeshes"}'
 *
 * Raccourcis :
 *   node build/fab.mjs catalogue [texte]          controles visibles (filtre facultatif)
 *   node build/fab.mjs clic <cible>               id | @ref | selecteur | "texte:Apply"
 *   node build/fab.mjs remplir <cible> <valeur>
 *   node build/fab.mjs modale                     modales ouvertes, champs et boutons
 *   node build/fab.mjs attendre <json>            ex. '{"jobsDone":true,"timeout":600000}'
 *   node build/fab.mjs ipc <methode> [json-args]  ex. ipc resizeMesh '[{"meshPath":"..."}]'
 *   node build/fab.mjs capture <fichier.png> [cible]
 *   node build/fab.mjs etat                       projet ouvert, travaux, modales
 *
 * Jeton : .test_api_token (racine, dev) ou ~/.fabmesh/test_api_token.txt,
 * reecrit a chaque demarrage de l'appli.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.FABMESH_CONTROL_URL || 'http://127.0.0.1:7331';

function jeton() {
  for (const f of [join(homedir(), '.fabmesh', 'test_api_token.txt'), join(RACINE, '.test_api_token')]) {
    if (existsSync(f)) { const t = readFileSync(f, 'utf-8').trim(); if (t) return t; }
  }
  console.error("Jeton introuvable : l'appli de bureau est-elle lancee (npm start) ?");
  process.exit(2);
}

async function appel(methode, chemin, corps) {
  // Git Bash convertit « /ui/catalog » en « C:/Program Files/Git/ui/catalog » : on le defait,
  // et un chemin sans « / » initial est accepte (« ui/catalog »)
  chemin = String(chemin || '/').replace(/^[A-Za-z]:[\/].*?[\/]Git(?=[\/?]|$)/i, '') || '/';
  if (!chemin.startsWith('/')) chemin = '/' + chemin;
  const r = await fetch(BASE + chemin, {
    method: methode,
    headers: { Authorization: 'Bearer ' + jeton(), 'Content-Type': 'application/json' },
    body: methode === 'POST' ? JSON.stringify(corps || {}) : undefined,
  });
  const type = r.headers.get('content-type') || '';
  if (!type.includes('json')) return { ok: r.ok, data: `[${type} ${r.headers.get('content-length')} octets]` };
  return r.json();
}

const cible = (s) => (s && s.startsWith('texte:') ? { text: s.slice(6) } : s);
const json = (s, def) => { if (s === undefined) return def; try { return JSON.parse(s); } catch (_) { return s; } };

const [cmd, ...a] = process.argv.slice(2);
let res;
try {
  switch ((cmd || '').toLowerCase()) {
    case 'get': {
      const [chemin, ...kv] = a;
      const q = kv.length ? '?' + kv.map((x) => x.split('=').map(encodeURIComponent).join('=')).join('&') : '';
      res = await appel('GET', chemin + q);
      break;
    }
    case 'post': res = await appel('POST', a[0], json(a[1], {})); break;
    case 'catalogue': res = await appel('GET', '/ui/catalog' + (a[0] ? '?q=' + encodeURIComponent(a[0]) : '')); break;
    case 'clic': res = await appel('POST', '/ui/click', { target: cible(a[0]) }); break;
    case 'remplir': res = await appel('POST', '/ui/fill', { fields: { [a[0]]: json(a[1], a[1]) } }); break;
    case 'modale': res = await appel('GET', '/ui/modal'); break;
    case 'attendre': res = await appel('POST', '/ui/wait', json(a[0], {})); break;
    case 'ipc': res = await appel('POST', '/ipc', { method: a[0], args: json(a[1], []) }); break;
    case 'capture': {
      const f = resolve(a[0] || 'capture.png');
      res = await appel('GET', '/ui/shot?file=' + encodeURIComponent(f) + (a[1] ? '&target=' + encodeURIComponent(a[1]) : ''));
      break;
    }
    case 'etat': {
      const [st, mod] = await Promise.all([appel('GET', '/state'), appel('GET', '/ui/modal')]);
      res = { etat: st.data, modales: mod.data };
      break;
    }
    default:
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf-8').split('*/')[0]);
      process.exit(cmd ? 1 : 0);
  }
} catch (e) {
  console.error('Echec :', e.message, "(appli de bureau lancee ? Control API sur", BASE + ')');
  process.exit(1);
}
console.log(JSON.stringify(res, null, 1));
if (res && res.ok === false) process.exit(1);
