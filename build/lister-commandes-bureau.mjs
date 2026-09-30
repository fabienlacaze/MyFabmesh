#!/usr/bin/env node
/**
 * Genere docs/pilotage_bureau.md : TOUTES les commandes qu'une session (Claude
 * Code, script) peut envoyer a l'appli de BUREAU pour la piloter.
 *
 * Sources lues, jamais recopiees a la main (le listing ne peut pas deriver) :
 *   - src/main/control_api.js   routes HTTP de la Control API (aide de GET /)
 *   - src/main/preload.js       methodes window.meshyAPI.* (appelables par POST /ipc)
 *   - src/main/*.js             commentaire au-dessus de chaque ipcMain.handle
 *   - src/main/main.js          actions du pont MCP (port 7555)
 *   - l'appli EN MARCHE (GET /ui/catalog?all=1) pour les controles de l'interface,
 *     rangés par zone (page, etape, modale) ; a defaut, index2.html (liste plate).
 *
 *   node build/lister-commandes-bureau.mjs          (relancer apres tout ajout d'outil)
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const lire = (p) => readFileSync(join(RACINE, p), 'utf-8').split('\r\n').join('\n');
const echap = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- Control API
const api = lire('src/main/control_api.js');
const aide = [...api.matchAll(/^\s+'((?:GET|POST)\s+\/(?:[^'\\]|\\.)*)',?$/gm)].map((m) => m[1].replace(/\\'/g, "'"));
const routes = [...api.matchAll(/^\s+'((?:GET|POST) \/[^']*)': async/gm)].map((m) => m[1]);
const cleAide = (a) => { const [m, ch] = a.trim().split(/\s+/); return m + ' ' + String(ch).split('?')[0]; };
const sansAide = routes.filter((r) => !aide.some((a) => cleAide(a) === r));

// ---------------------------------------------------------------- IPC (preload)
const preload = lire('src/main/preload.js');
const debut = preload.indexOf("exposeInMainWorld('meshyAPI', {");
const bloc = preload.slice(debut, preload.indexOf('\n});', debut));
const methodes = [], evenements = [];
for (const m of bloc.matchAll(/^\s+(\w+):\s*(?:async\s*)?\(([^)]*)\)\s*=>\s*ipcRenderer\.(invoke|send|on)\(\s*'([^']+)'/gm)) {
  const [, nom, args, genre, canal] = m;
  (genre === 'on' ? evenements : methodes).push({ nom, args: args.trim(), genre, canal });
}
// methodes sans ipcRenderer direct (composees dans le preload)
const autres = [...bloc.matchAll(/^\s{2}(\w+):\s*(?:async\s*)?\(/gm)].map((m) => m[1])
  .filter((n) => !methodes.some((x) => x.nom === n) && !evenements.some((x) => x.nom === n));

// description : commentaire juste au-dessus du ipcMain.handle / ipcMain.on du canal
const fichiersMain = readdirSync(join(RACINE, 'src/main')).filter((f) => f.endsWith('.js') && !f.includes('backup')).map((f) => 'src/main/' + f);
const sourcesMain = fichiersMain.map((f) => ({ f, lignes: lire(f).split('\n') }));
function description(canal) {
  for (const { f, lignes } of sourcesMain) {
    const i = lignes.findIndex((l) => l.includes(`ipcMain.handle('${canal}'`) || l.includes(`ipcMain.on('${canal}'`));
    if (i < 0) continue;
    const com = [];
    for (let k = i - 1; k >= 0 && k >= i - 8; k--) {
      const t = lignes[k].trim();
      if (!t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')) break;
      com.unshift(t.replace(/^\/\/+\s?|^\/\*+\s?|^\*\/?\s?|\*\/$/g, '').trim());
    }
    return { fichier: `${f}:${i + 1}`, texte: com.filter(Boolean).join(' ').slice(0, 220) };
  }
  return { fichier: null, texte: '' };
}
const THEMES = [
  ['Projets, fichiers, versions', /project|projet|folder|reveal|openpath|listmeshes|listimages|delete|rename|meta|thumb|version|savebuffer|readmesh|readfile|file|export|import|copy|duplicate/i],
  ['Cloud, compte, credits', /cloud|credit|login|logout|signup|account|pricing|stripe|buy|purchase|market|licen|verif/i],
  ['Animation', /anim|motion|clip|retarget|kimodo|unimate/i],
  ['Rig et squelette', /rig|skelet|bone|joint|point|skin|squelette/i],
  ['Mesh 3D et textures', /mesh|3d|trellis|retex|textur|explode|resize|stage|segment|part|voxel|detail|enhance|clone|atlas|material|decimat|remesh|watertight/i],
  ['Images', /image|img|bg|background|inpaint|outpaint|upscale|paint|outfit|recolor|age|rectif|front|back|view|sheet|face|prompt|nsfw|caption|translate/i],
  ['Systeme, GPU, reglages, journaux', /./],
];
const parTheme = new Map(THEMES.map(([t]) => [t, []]));
for (const m of methodes) {
  const cle = m.nom + ' ' + m.canal;
  const th = THEMES.find(([, re]) => re.test(cle))[0];
  parTheme.get(th).push({ ...m, ...description(m.canal) });
}

// ---------------------------------------------------------------- pont MCP (7555)
const main = lire('src/main/main.js');
const actionsMcp = [...new Set([...main.matchAll(/action === '([a-z0-9-]+)'/g)].map((m) => m[1]))];

// ---------------------------------------------------------------- interface (appli en marche)
async function catalogueVivant() {
  const tok = [join(homedir(), '.fabmesh', 'test_api_token.txt'), join(RACINE, '.test_api_token')].find(existsSync);
  if (!tok) return null;
  try {
    const r = await fetch('http://127.0.0.1:7331/ui/catalog?all=1&limit=5000', {
      headers: { Authorization: 'Bearer ' + readFileSync(tok, 'utf-8').trim() }, signal: AbortSignal.timeout(20000) });
    const j = await r.json();
    return j.ok ? j.data : null;
  } catch (_) { return null; }
}
const vivant = await catalogueVivant();
let ui = [], sourceUi;
if (vivant) {
  ui = vivant.elements.filter((e) => e.ref.startsWith('#'));   // id stables seulement (les @ref changent)
  sourceUi = "catalogue de l'appli en marche (GET /ui/catalog?all=1)";
} else {
  const html = lire('src/renderer/index2.html');
  for (const m of html.matchAll(/<(button|input|select|textarea|canvas|details)\b[^>]*\bid="([^"]+)"[^>]*>([^<]{0,80})/g)) {
    const titre = (m[0].match(/title="([^"]*)"/) || [])[1] || '';
    ui.push({ ref: '#' + m[2], tag: m[1], label: echap(m[3]) || titre.slice(0, 80), zone: 'index2.html' });
  }
  sourceUi = "index2.html (appli arretee : zones inconnues — relancer avec l'appli ouverte)";
}
const zones = new Map();
for (const e of ui) { if (!zones.has(e.zone)) zones.set(e.zone, []); zones.get(e.zone).push(e); }
const ordreZone = (z) => (z.startsWith('page:') ? 0 : z.startsWith('etape:') ? 1 : z.startsWith('modal:') ? 2 : 3);
const zonesTriees = [...zones.keys()].sort((a, b) => ordreZone(a) - ordreZone(b) || a.localeCompare(b));

// ---------------------------------------------------------------- ecriture
const L = [];
L.push('# Piloter l\'appli de bureau depuis une session', '');
L.push('> **Fichier GENERE** par `node build/lister-commandes-bureau.mjs` — ne pas editer a la main,');
L.push('> relancer le generateur apres tout ajout d\'outil (de preference appli ouverte, pour le');
L.push('> catalogue par zone).', '');
L.push('## Principe', '');
L.push('L\'appli de bureau (mode developpement) ecoute sur `http://127.0.0.1:7331` (Control API,');
L.push('`src/main/control_api.js`). Chaque requete porte `Authorization: Bearer <jeton>` ; le jeton est');
L.push('reecrit a chaque demarrage dans `.test_api_token` (racine) et `~/.fabmesh/test_api_token.txt`.');
L.push('Appli installee : coupee par defaut, interrupteur Reglages > Assistant (niveau standard : pas de');
L.push('`/eval`, `/ipc` en liste blanche, interface gardee ; « Developer full access » = tout). Developpement et');
L.push('`FABMESH_TEST_API=1` / `FABMESH_CONTROL_API=1` : allumee au lancement, acces complet.', '');
L.push('Trois niveaux couvrent **100 % des fonctions** :', '');
L.push('1. **Interface** (`/ui/*`) — tout ce qu\'un utilisateur fait : cliquer n\'importe quel bouton (meme dans une');
L.push('   carte repliee), remplir les champs, lire les modales, et la **souris / clavier reels** pour ce qui se');
L.push('   dessine ou se tire (masques, gizmos, camera 3D). C\'est le chemin a preferer : il passe par la file');
L.push('   d\'attente, les tuiles de travaux, la facturation et l\'enregistrement dans le projet, comme un clic.');
L.push('2. **IPC** (`POST /ipc {method, args}`) — les ' + methodes.length + ' fonctions du processus principal');
L.push('   (`window.meshyAPI.*`), sans interface : utiles pour lire (listes, meta) ou lancer un traitement brut.');
L.push('3. **Code** (`POST /eval {code}`) — JS dans la page (`window.state`, `window.meshyAPI`) : dernier recours.', '');
L.push('Les **dialogues natifs** (choisir un fichier a importer, un chemin d\'export, une boite de message) se');
L.push('reglent AVANT le clic avec `POST /dialog/next` ; sinon ils attendent un humain.', '');
L.push('## Outil en ligne de commande : `build/fab.mjs`', '');
L.push('```bash');
L.push('node build/fab.mjs etat                                   # projet ouvert, travaux, modales');
L.push('node build/fab.mjs catalogue resize                       # controles visibles contenant « resize »');
L.push('node build/fab.mjs clic ws-mesh-resize-btn                # id, @ref du catalogue, selecteur, ou texte:Apply');
L.push('node build/fab.mjs remplir rz-rot-x 90');
L.push('node build/fab.mjs modale                                 # champs et boutons de la modale ouverte');
L.push('node build/fab.mjs attendre \'{"jobsDone":true,"timeout":900000}\'');
L.push('node build/fab.mjs capture C:/tmp/vue.png rz-viewport     # PNG d\'un element (ou de la fenetre)');
L.push('node build/fab.mjs ipc listMeshes');
L.push('node build/fab.mjs POST /ui/mouse \'{"target":"rz-canvas","path":[[0.3,0.5],[0.7,0.5]]}\'');
L.push('```', '');
L.push('## Recettes', '');
L.push('| but | commandes |', '|---|---|');
L.push('| ouvrir un projet | `POST /select-project {name}` ou `clic "texte:<nom>"` sur la page Projets |');
L.push('| lancer un outil | `catalogue <mot>` -> `clic <id>` -> `modale` -> `remplir` -> `clic <bouton Apply/Generate>` -> `attendre {"jobsDone":true}` |');
L.push('| peindre un masque / dessiner | `POST /ui/mouse {target:<canvas>, path:[[fx,fy],...], steps, delay}` (fractions 0..1 du canvas) |');
L.push('| tirer un gizmo, tourner la camera | `POST /ui/mouse` (bouton `left` / `right`), `POST /ui/wheel {target, deltaY}` pour zoomer |');
L.push('| importer un fichier | `POST /dialog/next {open:["C:/chemin/image.png"]}` puis `clic` sur le bouton d\'import |');
L.push('| exporter | `POST /dialog/next {save:"C:/chemin/sortie.glb"}` puis `clic` sur le bouton d\'export |');
L.push('| raccourci clavier | `POST /ui/key {key:"z", modifiers:["control"]}` ; texte : `{text:"..."}` ; focus : `{target}` |');
L.push('| verifier le resultat | `GET /ui/toasts`, `GET /ui/shot?target=<vue>&file=<png>`, `GET /jobs`, `GET /logs?file=renderer` |');
L.push('');
L.push('Cibles acceptees partout : `id`, `#id`, `@r12` (reference donnee par le catalogue, pour les elements');
L.push('sans id : vignettes de versions, cartes de projets), selecteur CSS, ou `{"text":"Apply","within":"modal-resize"}`.', '');

L.push('## 1. Routes de la Control API (' + routes.length + ')', '');
L.push('```');
for (const a of aide) L.push(a.replace(/\s{2,}/g, '  '));
L.push('```');
if (sansAide.length) L.push('', 'Routes sans ligne d\'aide dans `GET /` : ' + sansAide.map((r) => '`' + r + '`').join(', '));
L.push('');

L.push('## 2. Fonctions IPC — `POST /ipc {"method": "<nom>", "args": [...]}` (' + methodes.length + ')', '');
L.push('Signature = arguments du preload ; description = commentaire au-dessus du gestionnaire dans le processus principal.', '');
for (const [th] of THEMES) {
  const liste = parTheme.get(th).sort((a, b) => a.nom.localeCompare(b.nom));
  if (!liste.length) continue;
  L.push(`### ${th} (${liste.length})`, '', '| methode | args | canal | description |', '|---|---|---|---|');
  for (const m of liste) L.push(`| \`${m.nom}\` | ${echap(m.args) || '—'} | \`${m.canal}\`${m.genre === 'send' ? ' (send)' : ''} | ${echap(m.texte) || '—'} |`);
  L.push('');
}
if (autres.length) L.push('Autres membres de `meshyAPI` (composes dans le preload) : ' + autres.map((n) => '`' + n + '`').join(', '), '');
L.push('### Evenements (abonnements, lecture seule) (' + evenements.length + ')', '');
L.push(evenements.map((e) => '`' + e.nom + '` (' + e.canal + ')').join(', '), '');

L.push('## 3. Controles de l\'interface (' + ui.length + ') — `POST /ui/click`, `POST /ui/fill`', '');
L.push('Source : ' + sourceUi + '. Seuls les elements a **id** stable sont listes ; `GET /ui/catalog` donne en plus');
L.push('les elements dynamiques (vignettes, cartes) avec une reference `@rN` valable jusqu\'au prochain rendu.', '');
for (const z of zonesTriees) {
  const liste = zones.get(z);
  L.push(`### ${z} (${liste.length})`, '', '| cible | type | libelle / info-bulle |', '|---|---|---|');
  for (const e of liste) {
    const type = e.tag + (e.type ? ':' + e.type : '') + (e.options ? ' [' + e.options.slice(0, 8).join(', ') + (e.options.length > 8 ? ', …' : '') + ']' : '');
    L.push(`| \`${e.ref}\` | ${echap(type)} | ${echap(e.label || e.title || '')}${e.title && e.label && e.title !== e.label ? ' — ' + echap(e.title).slice(0, 120) : ''} |`);
  }
  L.push('');
}

L.push('## 4. Pont MCP (port 7555, mode --headless seulement)', '');
L.push('Pont historique (jeton `.mcp_bridge_token`). `scripts/mcp_server.py` (Claude Desktop / Claude Code) ne');
L.push('l\'utilise plus : il parle a la Control API ci-dessus (cle de `~/.fabmesh`).');
L.push('Actions : ' + actionsMcp.map((a) => '`' + a + '`').join(', '), '');

writeFileSync(join(RACINE, 'docs', 'pilotage_bureau.md'), L.join('\n') + '\n');
console.log(`[pilotage] docs/pilotage_bureau.md : ${routes.length} routes, ${methodes.length} fonctions IPC, ${evenements.length} evenements, ${ui.length} controles (${vivant ? 'appli en marche' : 'HTML statique'}), ${actionsMcp.length} actions MCP`);
if (sansAide.length) console.log('[pilotage] routes sans aide :', sansAide.join(', '));
