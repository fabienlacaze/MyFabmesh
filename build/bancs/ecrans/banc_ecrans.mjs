// BANC DES ECRANS (30/10, demande du user : « un outil de test / debug pour valider les changements » de mise en page sur telephone, tablette, PC).
//
//   node build/bancs/ecrans/banc_ecrans.mjs [--tailles 390x844,768x1024] [--ids ws-modify-btn,...] [--sortie DOSSIER] [--ref DOSSIER_PRECEDENT]
//
// 1. copie le site CONSTRUIT (cloud/out : lancer `npm run build` dans cloud/ avant) dans un dossier temporaire (jamais cloud/out lui-meme : le
//    serveur le verrouillerait et la construction suivante echouerait sur EBUSY), plus les fichiers de test (t/ : img.png, img2.png, mesh.glb,
//    mesh_segment_1.glb, rig.glb ; trop gros pour le depot public : dossier BANC_ACTIFS, par defaut C:/tmp/rev_etroit/app/t) ;
// 2. sert ce dossier (serveur http integre), avec un FAUX serveur d'API (compte connecte, aucune donnee) : rien ne part vers le vrai site ;
// 3. pour chaque taille, ouvre l'accueil, New project, l'espace de travail d'un faux projet et chaque fenetre d'outil, capture et MESURE
//    (page qui deborde sur le cote, elements hors ecran, cibles tactiles < 32 px, fenetre plus haute que l'ecran, pied invisible ou recouvert) ;
// 4. ecrit DOSSIER/index.html : une ligne par ecran, une colonne par taille, defauts en rouge, comparaison avec --ref (captures precedentes).
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ecrireRapport } from './rapport.mjs';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, '..', '..', '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
export const TAILLES_DEFAUT = [[360, 780, 'Android'], [390, 844, 'iPhone'], [768, 1024, 'Tablette portrait'], [1024, 768, 'Tablette paysage'], [1400, 900, 'PC'], [1920, 1080, 'Grand ecran']];
const tailles = arg('tailles') ? arg('tailles').split(',').map((t) => { const [w, h] = t.split('x').map(Number); return [w, h, `${w}x${h}`]; }) : TAILLES_DEFAUT;
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
const SORTIE = path.resolve(arg('sortie', path.join(os.tmpdir(), 'banc_ecrans', stamp)));
const ACTIFS = process.env.BANC_ACTIFS || 'C:/tmp/rev_etroit/app/t';
const NAVIGATEUR = process.env.BANC_NAVIGATEUR || 'C:/Users/Utilisateur/.claude/skills/browser-automation/browser.mjs';

const SITE = path.join(os.tmpdir(), 'banc_ecrans_site');
fs.rmSync(SITE, { recursive: true, force: true });
fs.cpSync(path.join(RACINE, 'cloud', 'out'), SITE, { recursive: true });
if (fs.existsSync(ACTIFS)) fs.cpSync(ACTIFS, path.join(SITE, 'app', 't'), { recursive: true });
else console.warn(`[banc] fichiers de test absents (${ACTIFS}) : l'espace de travail et les outils seront vides`);

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.ico': 'image/x-icon' };
const serveur = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let f = path.join(SITE, p);
  if (!f.startsWith(SITE)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f) && fs.existsSync(f + '.html')) f += '.html';
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => serveur.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${serveur.address().port}`;
console.log(`[banc] site servi sur ${BASE} ; captures dans ${SORTIE}`);

const resultats = [];
for (const [w, h, nom] of tailles) {
  const out = path.join(SORTIE, `${w}x${h}`);
  const t0 = Date.now();
  const code = await new Promise((resolve) => {
    const p = spawn(process.execPath, [NAVIGATEUR, BASE + '/app/', '--script', path.join(ICI, 'capture.mjs'), '--timeout', '1200000'],
      { env: { ...process.env, BANC_BASE: BASE, BANC_SITE: SITE.replace(/\\/g, '/'), BANC_W: String(w), BANC_H: String(h), BANC_OUT: out, ...(arg('ids') ? { BANC_IDS: arg('ids') } : {}) }, stdio: ['ignore', 'pipe', 'pipe'] });
    let journal = ''; p.stdout.on('data', (d) => { journal += d; }); p.stderr.on('data', (d) => { journal += d; });
    p.on('close', (c) => { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, '_journal.txt'), journal); resolve(c); });
  });
  console.log(`[banc] ${nom} ${w}x${h} : code ${code}, ${Math.round((Date.now() - t0) / 1000)} s`);
  resultats.push({ w, h, nom, dossier: `${w}x${h}` });
}
serveur.close();
const f = ecrireRapport(SORTIE, resultats, arg('ref') ? path.resolve(arg('ref')) : null);
console.log(`[banc] rapport : ${f}`);
