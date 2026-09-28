#!/usr/bin/env node
/**
 * Genere docs/pilotage_web.md (+ build/pilotage_web_routes.json, lu par
 * build/fab-web.mjs) : TOUTES les routes du serveur web (cloud/src/worker.ts)
 * qu'une session peut appeler avec build/fab-web.mjs.
 *
 * Lu dans les sources, jamais recopie a la main :
 *   - routeur de worker.ts : chemin, methode(s), handler (routes fixes ET a motif)
 *   - commentaire /** … *\/ au-dessus de chaque handler : description
 *   - corps du handler : acces (public / compte / admin) et tarif (getPrice)
 *   - PRICING_DEFAULTS : tarif par defaut (_meta/pricing.json le SURCHARGE en prod,
 *     `node build/fab-web.mjs tarifs` donne les valeurs vivantes)
 *   - cloud/public/app/meshyAPI-cloud.js : methode de l'appli qui appelle la route
 *
 *   node build/lister-routes-web.mjs      (relancer apres tout ajout de route)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const lire = (p) => readFileSync(join(RACINE, p), 'utf-8').split('\r\n').join('\n');
const echap = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const w = lire('cloud/src/worker.ts');

// ---------------------------------------------------------------- routes
const routes = [];
const methodesDe = (txt) => [...txt.matchAll(/method === '([A-Z]+)'/g)].map((m) => m[1]);
// fixes : if (pathname === '/api/x' && method === 'POST') return await handleX(req, env);
for (const m of w.matchAll(/if \(pathname === '(\/[^']+)'\s*&&\s*(\([^)]*\)|method === '[A-Z]+')\)\s*return (?:await )?(\w+)\(/g)) {
  routes.push({ chemin: m[1], methodes: methodesDe(m[2]), handler: m[3], motif: false });
}
// a motif : const m = pathname.match(/^\/api\/…$/); if (m && method === 'GET') return await handleX(...)
for (const m of w.matchAll(/pathname\.match\(\/\^(\\\/api[^\n]*?)\$?\/\);\s*\n\s*if \(m\s*&&\s*(\([^)]*\)|method === '[A-Z]+')\)\s*return (?:await )?(\w+)\(/g)) {
  const lisible = m[1].replace(/\\\//g, '/').replace(/\(\[[^\]]+\]\+\)|\(\[\^\/\]\+\)|\(\.\+\)|\([^)]*\)/g, ':param');
  routes.push({ chemin: lisible, methodes: methodesDe(m[2]), handler: m[3], motif: true });
}
// prefixes : if (pathname.startsWith('/api/x/')) return await handleX(...)
for (const m of w.matchAll(/if \(pathname\.startsWith\('(\/api\/[^']+)'\)(?:\s*&&\s*(\([^)]*\)|method === '[A-Z]+'))?\)\s*return (?:await )?(\w+)\(/g)) {
  routes.push({ chemin: m[1] + '…', methodes: methodesDe(m[2] || ''), handler: m[3], motif: true });
}

// ---------------------------------------------------------------- handlers
const lignes = w.split('\n');
const prixDefaut = {};
{
  const i = w.indexOf('const PRICING_DEFAULTS = {');
  const bloc = w.slice(i, w.indexOf('\n};', i));
  for (const m of bloc.matchAll(/^\s+([a-z0-9_]+):\s+(\d+(?:\.\d+)?)/gm)) prixDefaut[m[1]] = Number(m[2]);
}
function infosHandler(nom) {
  const i = lignes.findIndex((l) => new RegExp(`^(?:export )?async function ${nom}\\(|^function ${nom}\\(`).test(l));
  if (i < 0) return { description: '', acces: '?', tarifs: [], ligne: null };
  // commentaire /** … */ juste au-dessus
  let description = '';
  if (lignes[i - 1] && lignes[i - 1].trim().endsWith('*/')) {
    let k = i - 1; const com = [];
    while (k >= 0 && !lignes[k].includes('/**') && !lignes[k].trim().startsWith('/*')) { com.unshift(lignes[k]); k--; }
    if (k >= 0) com.unshift(lignes[k]);
    description = com.join(' ').replace(/\/\*\*?|\*\/|^\s*\*/g, ' ').replace(/\s\*\s/g, ' ').replace(/\s+/g, ' ').trim();
  } else {
    const com = [];
    for (let k = i - 1; k >= 0 && lignes[k].trim().startsWith('//'); k--) com.unshift(lignes[k].trim().replace(/^\/\/\s?/, ''));
    description = com.join(' ');
  }
  // corps : jusqu'a la prochaine fonction de premier niveau
  let j = i + 1;
  while (j < lignes.length && !/^(?:export )?(?:async )?function |^const [A-Z_]+ = /.test(lignes[j])) j++;
  const corps = lignes.slice(i, j).join('\n');
  const acces = /_adminTokenCheck\(|requireAdmin|isAdminUser\(/.test(corps) ? 'admin'
    : /getSessionUser\(/.test(corps) ? 'compte' : 'public';
  const tarifs = [...new Set([...corps.matchAll(/getPrice\(env,\s*([^)]+)\)/g)]
    .flatMap((m) => [...[...m[1].matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]),
                     ...[...m[1].matchAll(/`([a-z0-9_]+)\$\{/g)].map((x) => x[1] + '*')]))];
  // paye = debite des credits (spendCredits), meme quand le prix est calcule ailleurs (creditCost…)
  const calcule = (corps.match(/(?:const|let) cost = await (\w+)\(/) || [])[1];
  const payant = /spendCredits\(/.test(corps) || tarifs.length > 0;
  if (payant && !tarifs.length) tarifs.push(calcule ? `calcule par ${calcule}()` : 'variable (voir le handler)');
  // alias : le handler ne fait que deleguer a un autre (handleMeEarnings…) -> meme acces / tarif
  const delegue = (corps.match(/return (?:await )?(handle\w+)\(/) || [])[1];
  return { description: description.slice(0, 260), acces, tarifs, payant, delegue, ligne: i + 1 };
}
for (const r of routes) {
  Object.assign(r, infosHandler(r.handler));
  if (r.acces === 'public' && r.delegue && r.delegue !== r.handler) {
    const d = infosHandler(r.delegue);
    r.acces = d.acces;
    if (!r.payant && d.payant) { r.payant = true; r.tarifs = d.tarifs; }
  }
}
for (const r of routes) if (r.chemin.startsWith('/api/admin')) r.acces = 'admin';

// ---------------------------------------------------------------- shim de l'appli web
const shim = lire('cloud/public/app/meshyAPI-cloud.js');
const appelants = new Map();
{
  const blocs = shim.split(/\n(?=\s{4}\w+:\s*(?:async\s*)?\()/);
  for (const b of blocs) {
    const nom = (b.match(/^\s{4}(\w+):/) || [])[1];
    if (!nom) continue;
    for (const m of b.matchAll(/['`](\/api\/[a-zA-Z0-9_\-/]+)/g)) {
      const ch = m[1].replace(/\/$/, '');
      if (!appelants.has(ch)) appelants.set(ch, new Set());
      appelants.get(ch).add(nom);
    }
  }
}
for (const r of routes) {
  const cle = r.chemin.replace(/…$/, '').replace(/\/:param.*$/, '');
  const noms = new Set([...(appelants.get(r.chemin) || []), ...(r.motif ? [...appelants.entries()].filter(([k]) => k.startsWith(cle + '/') || k === cle).flatMap(([, v]) => [...v]) : [])]);
  r.appelants = [...noms].sort();
}

// ---------------------------------------------------------------- themes
const THEMES = [
  ['Compte, session, credits, achats', /^\/api\/(auth|me\b|me\/|credits|account|profile|checkout|stripe|buy|purchase|pricing|signup|login|referral|gift|coupon|legal)/],
  ['Admin (jeton admin requis)', /^\/api\/admin/],
  ['Marketplace', /^\/api\/market/],
  ['Images', /^\/api\/(text2image|generate|image|img|modify|back|front|rectif|removebg|remove-bg|inpaint|auto-inpaint|mask|outfit|recolor|age|upscale|face|variant|sheet|tpose|segment|translate|caption|name)/],
  ['Mesh 3D et textures', /^\/api\/(mesh|3d|retex|texture|tex|clone|detail|explode|region|stages)/],
  ['Rig et animation', /^\/api\/(rig|anim|skin|motion|squelette|points)/],
  ['Projets, fichiers, versions', /^\/api\/(projects?|files?|upload|download|r2|assets?|versions?|jobs?|history|export|import|share|delete)/],
  ['Divers', /./],
];
const parTheme = new Map(THEMES.map(([t]) => [t, []]));
for (const r of routes.sort((a, b) => a.chemin.localeCompare(b.chemin))) {
  parTheme.get(THEMES.find(([, re]) => re.test(r.chemin))[0]).push(r);
}

// ---------------------------------------------------------------- ecriture
const tarif = (r) => r.tarifs.map((k) => {
  if (k.endsWith('*')) { const pre = k.slice(0, -1); return k + ' (' + Object.keys(prixDefaut).filter((x) => x.startsWith(pre)).map((x) => x + ' = ' + prixDefaut[x]).join(', ') + ')'; }
  return `${k}${prixDefaut[k] !== undefined ? ' = ' + prixDefaut[k] : ''}`;
}).join(', ');
const L = [];
L.push('# Piloter le site web (serveur cloud) depuis une session', '');
L.push('> **Fichier GENERE** par `node build/lister-routes-web.mjs` depuis `cloud/src/worker.ts` — ne pas');
L.push('> editer a la main ; relancer apres tout ajout de route.', '');
L.push('## Principe', '');
L.push('Le site web (`https://myfabmesh-cloud.fabien65400.workers.dev`) n\'est qu\'une page qui appelle ces routes.');
L.push('`build/fab-web.mjs` les appelle directement, **connecte a un compte** : les travaux lances apparaissent dans');
L.push('le site de ce compte (projets, tuiles « Running jobs ») et **ses credits sont debites**. Les calculs GPU passent');
L.push('par Modal : ils sont refuses tant que le budget du jour ou le plafond du compte est atteint.', '');
L.push('## Outil : `build/fab-web.mjs`', '');
L.push('```bash');
L.push('node build/fab-web.mjs login <email>        # a lancer par l\'UTILISATEUR dans un terminal : mot de passe saisi');
L.push('                                            # masque, jamais transmis a la session ; FABWEB_PASSWORD sinon');
L.push('node build/fab-web.mjs moi                  # compte connecte + credits');
L.push('node build/fab-web.mjs tarifs               # grille vivante (GET /api/pricing)');
L.push('node build/fab-web.mjs routes [mot]         # routes de ce listing, filtrees');
L.push('node build/fab-web.mjs GET /api/projects');
L.push('node build/fab-web.mjs POST /api/<route> \'{"...":"..."}\' --payer   # route payante : --payer obligatoire');
L.push('node build/fab-web.mjs travaux              # travaux en cours du compte');
L.push('node build/fab-web.mjs telecharger <url> <fichier>');
L.push('node build/fab-web.mjs logout');
L.push('```', '');
L.push('Session : `~/.fabmesh/web_session.json` (hors du depot, qui est PUBLIC), rafraichie automatiquement');
L.push('(jeton 1 h, rafraichissement 30 jours). Cookie envoye : `mfm-session=<access_token>`, exactement comme le site.', '');
L.push('Pour **lancer un outil** : trouver sa route ci-dessous (colonne « appelee par » = methode de');
L.push('`cloud/public/app/meshyAPI-cloud.js`, dont le corps montre le JSON exact que le site envoie), puis');
L.push('`POST` avec le meme JSON. Les tarifs indiques sont les valeurs PAR DEFAUT ; `_meta/pricing.json` les surcharge.', '');
const nPay = routes.filter((r) => r.payant).length;
L.push(`**${routes.length} routes** — ${routes.filter((r) => r.acces === 'public').length} publiques, ${routes.filter((r) => r.acces === 'compte').length} avec compte, ${routes.filter((r) => r.acces === 'admin').length} admin, ${nPay} payantes.`, '');
for (const [th] of THEMES) {
  const liste = parTheme.get(th);
  if (!liste.length) continue;
  L.push(`## ${th} (${liste.length})`, '', '| route | acces | tarif (credits) | appelee par | description |', '|---|---|---|---|---|');
  for (const r of liste) {
    L.push(`| \`${r.methodes.join('/') || '*'} ${r.chemin}\` | ${r.acces} | ${echap(tarif(r)) || '—'} | ${r.appelants.map((n) => '`' + n + '`').join(', ') || '—'} | ${echap(r.description) || '—'} [worker.ts:${r.ligne}] |`);
  }
  L.push('');
}
writeFileSync(join(RACINE, 'docs', 'pilotage_web.md'), L.join('\n') + '\n');
writeFileSync(join(RACINE, 'build', 'pilotage_web_routes.json'), JSON.stringify(routes.map((r) => ({
  chemin: r.chemin, methodes: r.methodes, acces: r.acces, payant: !!r.payant, tarifs: r.tarifs, handler: r.handler, motif: r.motif,
})), null, 1) + '\n');
console.log(`[pilotage web] docs/pilotage_web.md : ${routes.length} routes (${nPay} payantes, ${routes.filter((r) => r.acces === 'admin').length} admin)`);
