// ============================================================
// FabMesh Control API — serveur HTTP local (127.0.0.1:7331)
// ============================================================
// Permet aux programmes de CE PC (Claude Desktop via scripts/mcp_server.py,
// Claude Code, scripts, generateurs par lots) de piloter l'appli comme un
// utilisateur :
//   * generer images / maillages / rigs, ouvrir un projet, attendre les travaux
//   * cliquer / remplir n'importe quel controle, lire fenetres et notifications
//   * captures d'ecran, lecture des journaux
//   * (acces complet) toute fonction de preload.js via POST /ipc, code via /eval
//
// ALLUMAGE (2026-09-30, user : « aucune explication sur comment le brancher,
// comment ca marche »). Decide par main.js (_decisionApiAuLancement) :
//   * appli installee : COUPEE par defaut ; interrupteur persistant dans
//     Reglages > Assistant (config.json > controlApi.enabled), demarre et
//     arrete A CHAUD par IPC (assistant-api:*) — plus besoin de redemarrer ;
//   * developpement (npm start) : allumee au lancement, acces complet
//     (build/fab.mjs, build/lister-commandes-bureau.mjs) ;
//   * FABMESH_TEST_API=1 ou FABMESH_CONTROL_API=1 : allumee au lancement,
//     acces complet, dans toute livraison (outil de pilotage de
//     l'orchestrateur) ; FABMESH_CONTROL_API=0 : pas de demarrage automatique.
//
// DEUX NIVEAUX.
//   * standard — ce qu'un client final peut confier a Claude : interface
//     (/ui/click et /ui/fill GARDES : Reglages > Assistant, desinstallation,
//     controle parental, code PIN… sont refuses, test_api_client.js), generation,
//     projets, travaux, captures, journaux EN LECTURE, /ipc en LISTE BLANCHE
//     (lectures), images des dossiers de donnees, reponses aux fenetres de
//     fichier bornees (types media, jamais d'ecrasement). Ni /eval, ni /ipc
//     libre, ni ecriture ou lecture de fichier arbitraire, ni desinstallation.
//   * complet — « Developer full access » (absent de la version Store) :
//     toutes les routes, dont /eval et /ipc sans filtre = executer du code.
//     C'est le niveau du developpement et des variables d'environnement.
//
// SECURITE. Ecoute sur 127.0.0.1 seulement. Chaque requete porte
// « Authorization: Bearer <cle> » : cle aleatoire de 32 octets, regeneree a
// chaque demarrage du serveur, ecrite APRES un listen reussi (un port occupe
// n'ecrase plus la cle d'une autre instance) dans
// ~/.fabmesh/test_api_token.txt (+ .test_api_token a la racine du depot en
// developpement), effacee a l'arret. Une requete de navigateur (en-tete
// Origin) ou dont le Host n'est pas 127.0.0.1 / localhost est refusee (pages
// web, DNS rebinding). Comparaison de la cle a temps constant.
// ============================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { ipcMain, app, dialog } = require('electron');

const PORT_DEFAUT = 7331;
const HOST = '127.0.0.1';
const STANDARD = 'standard';
const COMPLET = 'complet';

// ------------------------------------------------------------
// Contexte fourni par main.js (configurer) : fenetre et dossiers de donnees.
// Sans lui (ancien appel startControlApi), repli sur l'arborescence du depot.
// ------------------------------------------------------------
const _ctx = {
  fenetre: null,          // () => BrowserWindow principale
  port: PORT_DEFAUT,      // les bancs d'essai passent un autre port ; main.js jamais
  dataBase: null,         // racine des donnees (userData installe, depot en dev)
  logsDir: null,
  logFile: null,
  rendererLog: null,
  imagesDir: null,
  meshesDir: null,
  previewsDir: null,
  racineDepot: null,      // developpement seulement : AGENT_LOG.md, .test_api_token
  surEvenement: null,     // (evt) -> main.js (notifications, rafraichissement du panneau)
};
function configurer(opts) {
  for (const [k, v] of Object.entries(opts || {})) if (k in _ctx) _ctx[k] = v;
}
function _port() { return Number(_ctx.port) || PORT_DEFAUT; }
function _chemins() {
  const base = _ctx.dataBase || path.join(__dirname, '..', '..');
  const logs = _ctx.logsDir || path.join(base, 'logs');
  return {
    base,
    logs,
    logFile: _ctx.logFile || path.join(logs, 'fabmesh.log'),
    rendererLog: _ctx.rendererLog || path.join(logs, 'renderer.log'),
    lastError: path.join(logs, 'last_error.log'),
    images: _ctx.imagesDir || path.join(base, 'images'),
    meshes: _ctx.meshesDir || path.join(base, 'meshes'),
    previews: _ctx.previewsDir || path.join(base, 'previews'),
  };
}
function _emettre(evt) {
  try { if (typeof _ctx.surEvenement === 'function') _ctx.surEvenement(evt); } catch (_) {}
}

/** Vrai si p est DANS racine (pas la racine elle-meme). Insensible a la casse sous Windows. */
function _dans(racine, p) {
  if (!racine || !p) return false;
  const rel = path.relative(path.resolve(racine), path.resolve(p));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}
const EXT_IMAGES = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
const _ext = (p) => path.extname(String(p || '')).slice(1).toLowerCase();
/** Niveau standard : seulement les images des dossiers de donnees de l'appli. */
function _imageDeDonnees(abs) {
  const c = _chemins();
  return EXT_IMAGES.has(_ext(abs)) && [c.images, c.meshes, c.previews].some((d) => _dans(d, abs));
}

// ------------------------------------------------------------
// Cle d'acces : aleatoire, regeneree a chaque demarrage, jamais ecrite avant
// un listen reussi, effacee a l'arret.
// ------------------------------------------------------------
let _authToken = null;
function _fichierCle() { return path.join(os.homedir(), '.fabmesh', 'test_api_token.txt'); }
function _fichierCleDepot() { return _ctx.racineDepot ? path.join(_ctx.racineDepot, '.test_api_token') : null; }
function _ecrireCle() {
  const f = _fichierCle();
  try { fs.mkdirSync(path.dirname(f), { recursive: true }); } catch (_) {}
  try {
    fs.writeFileSync(f, _authToken, { encoding: 'utf-8', mode: 0o600 });
  } catch (e) {
    console.error('[control_api] could not write token file:', e.message);
  }
  // Developpement : aussi a la racine du depot, pour les outils du depot.
  const d = _fichierCleDepot();
  if (d) { try { fs.writeFileSync(d, _authToken, { encoding: 'utf-8', mode: 0o600 }); } catch (_) {} }
  console.log('[control_api] auth token written to', f);
}
function _effacerCle(cle) {
  for (const f of [_fichierCle(), _fichierCleDepot()]) {
    if (!f || !cle) continue;
    // Seulement si le fichier porte NOTRE cle : jamais celle d'une autre instance.
    try { if (fs.readFileSync(f, 'utf-8').trim() === cle) fs.unlinkSync(f); } catch (_) {}
  }
}
function _egal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function _checkAuth(req, url) {
  if (!_authToken) return false;
  // Header form: Authorization: Bearer <token>
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ') && _egal(auth.slice(7).trim(), _authToken)) return true;
  // ?token= : ancien repli du visualiseur de journaux (EventSource ne pose pas
  // d'en-tete). Le visualiseur lit desormais par IPC ; garde pour les scripts
  // du niveau complet seulement (une cle dans une URL finit dans les journaux).
  if (_niveau === COMPLET && _egal(url.searchParams.get('token') || '', _authToken)) return true;
  return false;
}
/** Refuse les pages web (en-tete Origin) et un Host etranger (DNS rebinding). */
function _requeteLocale(req) {
  if (req.headers.origin !== undefined) return false;
  const h = String(req.headers.host || '').trim().toLowerCase();
  const p = String(_port());
  return h === HOST + ':' + p || h === 'localhost:' + p || h === HOST || h === 'localhost';
}

// Pending renderer commands keyed by id. When the renderer sends
// back test:result, we look up the promise and resolve it.
const _pending = new Map();
let _cmdCounter = 0;

// Renderer console buffer (filled by test:console IPC)
const _consoleBuf = [];
const CONSOLE_MAX = 1000;

// Activite : les N dernieres requetes (toutes externes : le panneau des
// Reglages lit l'etat par IPC et ne se compte plus lui-meme).
const _reqHistory = [];
const REQ_HISTORY_MAX = 50;
let _premiereConnexionVue = false;
/** Libelle lisible du programme appelant, tire de son User-Agent. */
function _nomClient(ua) {
  const u = String(ua || '');
  if (/MyFabmesh-MCP/i.test(u)) return 'Claude';
  if (/claude/i.test(u)) return 'Claude';
  if (/^curl\//i.test(u)) return 'curl';
  if (/python/i.test(u)) return 'Python script';
  if (/powershell/i.test(u)) return 'PowerShell';
  if (/^node\b|undici/i.test(u)) return 'Node script';
  return u ? u.slice(0, 40) : 'Unknown program';
}
function _recordRequest(req, statusCode, authentifie) {
  try {
    const ua = (req.headers && req.headers['user-agent']) || '';
    const client = _nomClient(ua);
    _reqHistory.push({
      ts: Date.now(),
      method: req.method,
      path: (req.url || '').split('?')[0],
      remote: (req.socket && req.socket.remoteAddress) || 'unknown',
      ua,
      client,
      auth: !!authentifie,
      status: statusCode,
    });
    while (_reqHistory.length > REQ_HISTORY_MAX) _reqHistory.shift();
    if (authentifie && !_premiereConnexionVue) {
      _premiereConnexionVue = true;
      _emettre({ type: 'premiere-connexion', client, niveau: _niveau });
    }
  } catch (_) {}
}

// Cached last known renderer state (filled by test:state-push)
let _lastState = null;

function _newCmdId() {
  _cmdCounter++;
  return 'cmd_' + Date.now() + '_' + _cmdCounter;
}

// Send a command to the renderer and wait for its reply.
function rendererCall(mainWindow, action, payload, timeoutMs = 30000) {
  return new Promise((resolve) => {
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.webContents) {
      return resolve({ ok: false, error: 'mainWindow not available' });
    }
    const id = _newCmdId();
    const timer = setTimeout(() => {
      if (_pending.has(id)) {
        _pending.delete(id);
        resolve({ ok: false, error: 'timeout waiting for renderer' });
      }
    }, timeoutMs);
    _pending.set(id, { resolve, timer });
    try {
      mainWindow.webContents.send('test:command', { id, action, payload });
    } catch (e) {
      _pending.delete(id);
      clearTimeout(timer);
      resolve({ ok: false, error: 'send failed: ' + e.message });
    }
  });
}

// Register IPC listeners ONCE (the server can now start and stop many times).
let _ipcInstalle = false;
function _installIpcHandlers() {
  if (_ipcInstalle) return;
  _ipcInstalle = true;
  // Renderer posts back command results
  ipcMain.on('test:result', (_event, msg) => {
    try {
      if (!msg || !msg.id) return;
      const entry = _pending.get(msg.id);
      if (!entry) return;
      _pending.delete(msg.id);
      clearTimeout(entry.timer);
      entry.resolve({ ok: !msg.error, data: msg.data, error: msg.error });
    } catch (e) { /* ignore */ }
  });

  // Renderer streams console log entries
  ipcMain.on('test:console', (_event, entry) => {
    try {
      _consoleBuf.push(entry);
      while (_consoleBuf.length > CONSOLE_MAX) _consoleBuf.shift();
    } catch (e) { /* ignore */ }
  });

  // Renderer pushes a state snapshot whenever it changes
  ipcMain.on('test:state-push', (_event, snap) => {
    _lastState = snap;
  });
}

// ============================================================
// PILOTAGE COMPLET (2026-09-28) — souris / clavier REELS, dialogues natifs.
// Une session (Claude Code, script) doit pouvoir faire TOUT ce qu'un
// utilisateur fait : peindre un masque, tirer un gizmo, tourner la camera,
// choisir un fichier a importer, un chemin d'export. Listing complet et
// exemples : docs/pilotage_bureau.md (genere par build/lister-commandes-bureau.mjs).
// ============================================================
const _pause = (ms) => new Promise((r) => setTimeout(r, ms));

// Reponses en file d'attente pour les PROCHAINES boites de dialogue natives :
// sans elles, un import ou un export attend un clic humain dans une fenetre
// Windows qu'aucune commande ne peut atteindre.
// DUREE DE VIE (2026-09-30) : une reponse jamais consommee detournait le
// PROCHAIN import ou export manuel de l'utilisateur, sans limite de temps.
// Elle expire desormais (1 min en standard, 10 min en complet) et la file est
// videe a l'arret du serveur.
const DUREE_REPONSE_MS = { [STANDARD]: 60 * 1000, [COMPLET]: 10 * 60 * 1000 };
const _dialogues = { open: [], save: [], message: [], vus: [] };   // open/save/message : [{ valeur, ts }]
function _viderDialogues() { _dialogues.open.length = 0; _dialogues.save.length = 0; _dialogues.message.length = 0; }
function _prochaineReponse(file) {
  const vie = DUREE_REPONSE_MS[_niveau] || DUREE_REPONSE_MS[STANDARD];
  while (file.length && Date.now() - file[0].ts > vie) file.shift();
  return file.length ? file.shift() : null;
}
/** Niveau standard : la reponse doit correspondre aux types de fichier de la fenetre. */
function _conformeAuxFiltres(chemin, o) {
  const exts = [];
  for (const f of ((o && o.filters) || [])) for (const e of (f.extensions || [])) exts.push(String(e).toLowerCase());
  if (!exts.length || exts.includes('*')) return true;
  return exts.includes(_ext(chemin));
}
function _installerDialogues() {
  if (!dialog || dialog.__fabPilote) return;
  dialog.__fabPilote = true;
  const optsDe = (a) => a.find((x) => x && typeof x === 'object' && !x.webContents && (x.title || x.filters || x.defaultPath || x.message || x.properties)) || {};
  const noter = (type, o) => {
    _dialogues.vus.push({ ts: Date.now(), type, titre: o.title || o.message || null, defaut: o.defaultPath || null,
      filtres: (o.filters || []).map((f) => f.name + ' (' + (f.extensions || []).join(',') + ')'),
      reponse: null });
    while (_dialogues.vus.length > 30) _dialogues.vus.shift();
    return _dialogues.vus[_dialogues.vus.length - 1];
  };
  const signaler = (genre, chemin) => { if (_niveau !== COMPLET) _emettre({ type: 'dialogue', genre, chemin }); };
  const origOpen = dialog.showOpenDialog.bind(dialog);
  const origSave = dialog.showSaveDialog.bind(dialog);
  const origMsg = dialog.showMessageBox.bind(dialog);
  dialog.showOpenDialog = async (...a) => {
    const o = optsDe(a);
    const v = noter('open', o);
    const r = _prochaineReponse(_dialogues.open);
    if (r) {
      const fp = r.valeur;
      if (_niveau !== COMPLET && !fp.every((c) => _conformeAuxFiltres(c, o))) {
        v.reponse = 'refusee (type de fichier)';
        return origOpen(...a);
      }
      v.reponse = fp; signaler('open', fp[0] || '');
      return { canceled: !fp.length, filePaths: fp };
    }
    v.reponse = 'utilisateur'; return origOpen(...a);
  };
  dialog.showSaveDialog = async (...a) => {
    const o = optsDe(a);
    const v = noter('save', o);
    const r = _prochaineReponse(_dialogues.save);
    if (r) {
      const fp = r.valeur;
      if (fp && _niveau !== COMPLET && !_conformeAuxFiltres(fp, o)) {
        v.reponse = 'refusee (type de fichier)';
        return origSave(...a);
      }
      v.reponse = fp; if (fp) signaler('save', fp);
      return { canceled: !fp, filePath: fp || undefined };
    }
    v.reponse = 'utilisateur'; return origSave(...a);
  };
  dialog.showMessageBox = async (...a) => {
    const v = noter('message', optsDe(a));
    const r = _prochaineReponse(_dialogues.message);
    if (r) { v.reponse = r.valeur; return { response: r.valeur, checkboxChecked: false }; }
    v.reponse = 'utilisateur'; return origMsg(...a);
  };
}

// Niveau standard : fichiers qu'une reponse automatique peut faire ouvrir
// (imports : images et modeles 3D) ou enregistrer (exports : jamais d'ecrasement,
// jamais dans les dossiers du systeme ni dans AppData).
const EXT_OUVRIR = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tga', 'glb', 'gltf', 'obj', 'fbx', 'stl', 'ply']);
const EXT_ENREGISTRER = new Set(['png', 'jpg', 'jpeg', 'webp', 'glb', 'gltf', 'obj', 'fbx', 'stl', 'ply',
  'usd', 'usda', 'usdc', 'usdz', 'zip', 'xlsx']);
function _refusOuvrir(p) {
  if (typeof p !== 'string' || !path.isAbsolute(p)) return 'open: an absolute path is required';
  if (!EXT_OUVRIR.has(_ext(p))) return 'open: only images and 3D files';
  try { if (!fs.statSync(p).isFile()) return 'open: not a file: ' + p; } catch (_) { return 'open: file not found: ' + p; }
  return null;
}
function _refusEnregistrer(p) {
  if (typeof p !== 'string' || !path.isAbsolute(p)) return 'save: an absolute path is required';
  if (!EXT_ENREGISTRER.has(_ext(p))) return 'save: only images, 3D files and archives';
  const env = process.env;
  const interdits = [env.SystemRoot || env.windir, env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramData,
    env.APPDATA, env.LOCALAPPDATA, path.join(os.homedir(), 'AppData')].filter(Boolean);
  if (interdits.some((d) => _dans(d, p))) return 'save: not in system or app folders';
  if (fs.existsSync(p)) return 'save: the file already exists (never overwritten)';
  if (!fs.existsSync(path.dirname(p))) return 'save: folder not found: ' + path.dirname(p);
  return null;
}

/** Position ecran (DIP de la page) d'un point d'un element : fractions 0..1 de sa boite, ou pixels. */
async function _pointsDe(mainWindow, body) {
  const r = await rendererCall(mainWindow, 'ui-rect', { target: body.target, scroll: body.scroll }, 15000);
  if (!r.ok) throw new Error(r.error);
  const { x, y, w, h } = r.data;
  const z = mainWindow.webContents.getZoomFactor ? mainWindow.webContents.getZoomFactor() : 1;
  const chemin = Array.isArray(body.path) && body.path.length ? body.path : [[0.5, 0.5]];
  return { rect: r.data, pts: chemin.map(([a, b]) => (body.pixels ? [x + a, y + b] : [x + a * w, y + b * h]))
    .map(([a, b]) => [Math.round(a * z), Math.round(b * z)]) };
}

/** Souris REELLE (evenements d'entree Chromium) : clic, double-clic, glisser le long d'un chemin. */
async function _souris(mainWindow, body) {
  const { pts, rect } = await _pointsDe(mainWindow, body);
  const wc = mainWindow.webContents;
  const bouton = ['left', 'right', 'middle'].includes(body.button) ? body.button : 'left';
  const mods = Array.isArray(body.modifiers) ? body.modifiers : [];
  const enfonce = mods.concat([bouton + 'ButtonDown']);
  const ev = (type, [px, py], m, extra) => wc.sendInputEvent(Object.assign({ type, x: px, y: py, button: bouton, modifiers: m }, extra || {}));
  const pas = Math.max(1, Math.min(Number(body.steps) || 8, 200));
  const delai = Math.max(0, Math.min(Number(body.delay) || 12, 500));
  ev('mouseMove', pts[0], mods); await _pause(30);
  if (body.move) {                                            // survol seul, sans bouton
    for (let k = 1; k < pts.length; k++) { ev('mouseMove', pts[k], mods); await _pause(delai); }
    return { survol: pts.length, rect };
  }
  const clics = body.double ? 2 : 1;
  for (let c = 1; c <= clics; c++) {
    ev('mouseDown', pts[0], mods, { clickCount: c }); await _pause(30);
    for (let k = 1; k < pts.length; k++) {
      for (let st = 1; st <= pas; st++) {
        const t = st / pas, a = pts[k - 1], b = pts[k];
        ev('mouseMove', [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t)], enfonce);
        await _pause(delai);
      }
    }
    if (body.hold) await _pause(Math.min(Number(body.hold) || 0, 5000));
    ev('mouseUp', pts[pts.length - 1], mods, { clickCount: c }); await _pause(30);
  }
  return { points: pts.length, bouton, double: !!body.double, rect };
}

// Nom de touche -> keyCode Electron (accelerateur) : 'Enter', 'Escape', 'Delete', 'z', 'F5'...
async function _clavier(mainWindow, body) {
  const wc = mainWindow.webContents;
  const mods = Array.isArray(body.modifiers) ? body.modifiers : [];
  if (typeof body.text === 'string') {                       // saisie de texte caractere par caractere
    for (const ch of body.text) { wc.sendInputEvent({ type: 'char', keyCode: ch }); await _pause(8); }
    return { tape: body.text.length };
  }
  const touches = Array.isArray(body.keys) ? body.keys : [body.key];
  for (const k of touches) {
    if (!k) continue;
    wc.sendInputEvent({ type: 'keyDown', keyCode: String(k), modifiers: mods });
    if (String(k).length === 1 && !mods.some((m) => /control|ctrl|meta|command|alt/i.test(m))) wc.sendInputEvent({ type: 'char', keyCode: String(k), modifiers: mods });
    await _pause(20);
    wc.sendInputEvent({ type: 'keyUp', keyCode: String(k), modifiers: mods });
    await _pause(20);
  }
  return { touches: touches.length, modifiers: mods };
}

// Read JSON body from an HTTP request (safe, capped).
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > 2 * 1024 * 1024) { req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) { resolve({ __parse_error: e.message }); }
    });
    req.on('error', () => resolve({}));
  });
}

// Plus d'Access-Control-Allow-Origin : seuls des programmes locaux (pas des
// pages web) doivent lire ces reponses.
function sendJson(res, code, payload) {
  try {
    const body = JSON.stringify(payload);
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
  } catch (e) { try { res.end(); } catch (_) {} }
}

function sendOk(res, data)        { sendJson(res, 200, { ok: true,  data }); }
function sendErr(res, err, code=500) { sendJson(res, code, { ok: false, error: String(err && err.message || err) }); }

// Tail last N lines of a file safely.
function tailFile(filePath, lines) {
  try {
    if (!fs.existsSync(filePath)) return '';
    const stat = fs.statSync(filePath);
    const MAX = 512 * 1024;
    const start = Math.max(0, stat.size - MAX);
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    const text = buf.toString('utf8');
    const arr = text.split(/\r?\n/);
    return arr.slice(-lines).join('\n');
  } catch (e) {
    return '[tail error: ' + e.message + ']';
  }
}

// ============================================================
// Routes. Aide de GET / (lue aussi par build/lister-commandes-bureau.mjs :
// UNE route par ligne, forme '<METHODE>  /<chemin>   commentaire').
// ============================================================
const AIDE = [
  'GET  /',
  'GET  /state',
  'GET  /status                     (vivant ? + dernieres requetes recues)',
  'GET  /screenshot                 (full Electron window PNG)',
  'GET  /screenshot-file?path=      (image file: data folders; full access: anywhere in the data root)',
  'GET  /thumbs?project=&kind=      (list image|mesh versions + paths)',
  'POST /compare-thumbs             {a, b, threshold?}  pixel-diff two files',
  'GET  /logs?file=&lines=200       (file optional; back-compat default: fabmesh + error)',
  'GET  /logs/list',
  'POST /logs/clear                 {file}',
  'POST /logs/append                {file, line | content}',
  'POST /logs/rotate                {file}',
  'GET  /logs/stream?file=fabmesh   (Server-Sent Events live tail)',
  'GET  /console',
  'GET  /ipc/methods                   (list every window.meshyAPI.* method; standard access: read-only allow-list)',
  'POST /ipc                {method, args?: [...] | arg?: ...}  generic IPC dispatch',
  'POST /click              {selector}',
  'POST /eval               {code}  (JS dans la page ; window.state, window.meshyAPI)',
  'GET  /ui/catalog?q=&zone=&all=1&limit=   catalogue des controles (ref, label, zone, valeur, options)',
  'POST /ui/click           {target, wait?}  target = id | #id | @ref | selecteur | {text, within?} ; deplie la carte',
  'POST /ui/fill            {fields: {cible: valeur, ...}}  champs, cases, listes (valeur ou libelle)',
  'GET  /ui/modal                    modales ouvertes : titre, texte, champs, boutons',
  'POST /ui/wait            {target?, gone?, enabled?, modal?, noModal?, toast?, since?, text?, jobsDone?, timeout?}',
  'GET  /ui/toasts?since=            notifications affichees (type, texte)',
  'POST /ui/mouse           {target, path?: [[fx,fy],...], pixels?, button?, double?, move?, modifiers?, steps?, delay?, hold?}',
  'POST /ui/wheel           {target, deltaY, fx?, fy?}  molette (zoom des vues 3D)',
  'POST /ui/key             {key | keys: [...] | text, modifiers?: [control, shift, alt]}',
  'GET  /ui/shot?target=&file=&largeur=&format=jpeg   capture d un element (ou de la fenetre) ; file= (acces complet) ecrit un PNG',
  'POST /dialog/next        {open?: [chemins], save?: chemin, message?: indexBouton}  reponses aux prochains dialogues natifs',
  'GET  /dialog/state                file d attente + derniers dialogues ouverts (et qui y a repondu)',
  'POST /dialog/clear',
  'POST /set                {selector, value}',
  'POST /select-project     {name}',
  'POST /generate-image     {prompt, engine, count, steps}',
  'POST /generate-3d        {imageIndex, engine}',
  'POST /auto-rig           {}',
  'GET  /jobs',
  'GET  /wait-job?id=xxx&timeout=300',
  'GET  /popups',
  'POST /dismiss-popup     {id?}',
  'GET  /last-error',
  'GET  /devtools-open',
  'POST /calib/run                  run full auto-diagnose (SF3D + z123 + projection)',
  'GET  /calib/list-reports',
  'GET  /calib/last-report',
  'GET  /calib/report?name=...',
  'GET  /calib/log?lines=500        tail logs/fabmesh.log filtered by [calib]',
  'POST /calib/build-rubiks        rebuild the Rubik\'s calibration reference'
];
const _cleAide = (l) => { const [m, ch] = String(l).trim().split(/\s+/); return m + ' ' + String(ch).split('?')[0]; };

// Niveau STANDARD : routes permises (plusieurs par ligne, a dessein : l'aide
// ci-dessus reste la seule liste « une route par ligne » du fichier).
const ROUTES_STANDARD = new Set([
  'GET /', 'GET /status', 'GET /state',
  'GET /screenshot', 'GET /screenshot-file', 'GET /thumbs', 'POST /compare-thumbs',
  'GET /logs', 'GET /logs/list', 'GET /logs/stream',
  'GET /ipc/methods', 'POST /ipc',
  'GET /ui/catalog', 'POST /ui/click', 'POST /ui/fill', 'GET /ui/modal',
  'POST /ui/wait', 'GET /ui/toasts', 'GET /ui/shot',
  'POST /dialog/next', 'GET /dialog/state', 'POST /dialog/clear',
  'POST /select-project', 'POST /generate-image', 'POST /generate-3d', 'POST /auto-rig',
  'GET /jobs', 'GET /wait-job', 'GET /popups', 'POST /dismiss-popup', 'GET /last-error',
]);
// Niveau STANDARD : fonctions de window.meshyAPI appelables par POST /ipc.
// Lectures seulement (listes, metadonnees, materiel, compte). Jamais :
// saveBuffer, runBlenderScript, uninstallFabmesh, donneesSupprimer, killProcess,
// delete*, cloudLogin/Logout/Signup/ShareAsset, toggleUnrestricted, setConfig,
// install*, assistant* (l'automatisation ne se donne pas l'acces complet).
const IPC_STANDARD = new Set([
  'listProjects', 'listMeshes', 'listImageFolders', 'getProjectDisplayNames', 'listerProjetsVides',
  'listAnimations', 'listRigTemplates', 'animBanqueListe', 'getLineageMeta',
  'gpuStatus', 'checkGPU', 'checkRAM', 'cpuUsage', 'diskFree', 'memoryNeeds', 'jobsRunningCount', 'countPython',
  'cloudStatus', 'cloudPricing', 'rigLocalDisponible', 'cloudListLibrary', 'cloudListMarket', 'cloudHistoryList',
  'isStoreBuild', 'getParentalStatus', 'readLogTail',
]);
const MSG_COMPLET = 'needs "Developer full access" (MyFabmesh.AI > Settings > Assistant > Advanced)';

function _construireRoutes(mainWindow) {
  const C = _chemins();
  const LOG_FILE      = C.logFile;
  const LAST_ERROR    = C.lastError;
  const CALIB_REPORTS = path.join(C.images, '_calibration', 'reports');
  const garde = () => _niveau !== COMPLET;

  const routes = {
    'GET /': async (req, res) => {
      sendOk(res, {
        name: 'FabMesh Control API',
        version: 2,
        level: _niveau,
        endpoints: _niveau === COMPLET ? AIDE : AIDE.filter((l) => ROUTES_STANDARD.has(_cleAide(l))),
      });
    },

    // Status endpoint. Returns the server's "I'm alive" info plus recent
    // request history (external clients only).
    'GET /status': async (req, res) => {
      const now = Date.now();
      const last5min = _reqHistory.filter(r => now - r.ts < 5 * 60 * 1000);
      // Distinct user-agents (truncated) seen in last 5 min — gives a
      // hint of what clients are talking to us.
      const ua_set = {};
      for (const r of last5min) {
        const k = (r.ua || 'unknown').slice(0, 60);
        ua_set[k] = (ua_set[k] || 0) + 1;
      }
      sendOk(res, {
        listening: true,
        host: HOST,
        port: _port(),
        version: 2,
        level: _niveau,
        uptime_s: process.uptime ? Math.floor(process.uptime()) : null,
        token_hint: _authToken ? (_authToken.slice(0, 8) + '...' + _authToken.slice(-4)) : null,
        request_count_total: _reqHistory.length,
        request_count_5min: last5min.length,
        recent_clients: ua_set,
        recent_requests: _reqHistory.slice(-10).map(r => ({
          ts: r.ts,
          method: r.method,
          path: r.path,
          remote: r.remote,
          status: r.status,
        })),
      });
    },

    'GET /state': async (req, res) => {
      const r = await rendererCall(mainWindow, 'state', {});
      if (!r.ok) return sendErr(res, r.error);
      sendOk(res, r.data);
    },

    'GET /screenshot': async (req, res) => {
      try {
        if (!mainWindow || mainWindow.isDestroyed()) return sendErr(res, 'no window');
        const img = await mainWindow.webContents.capturePage();
        const png = img.toPNG();
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Content-Length': png.length,
        });
        res.end(png);
      } catch (e) { sendErr(res, e); }
    },

    // GET /screenshot-file?path=<abs path>
    // Stream a version thumbnail (e.g. images/<project>/ref_2.png) without
    // going through the Electron webContents capture. Standard access: image
    // files of the data folders only. Full access: any file of the data root
    // (the repository in development).
    'GET /screenshot-file': async (req, res, url) => {
      try {
        const p = url.searchParams.get('path');
        if (!p) return sendErr(res, 'missing path', 400);
        // Containment BEFORE existence: a 404 must not reveal files elsewhere.
        const abs = path.resolve(p);
        if (_niveau === COMPLET && !_dans(C.base, abs)) return sendErr(res, 'path outside project root', 400);
        if (_niveau !== COMPLET && !_imageDeDonnees(abs)) {
          return sendErr(res, 'only image files inside the MyFabmesh.AI data folders', 403);
        }
        if (!fs.existsSync(abs)) return sendErr(res, 'not found: ' + p, 404);
        const ext = _ext(abs);
        const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
                       webp: 'image/webp', gif: 'image/gif' }[ext] || 'application/octet-stream';
        const data = fs.readFileSync(abs);
        res.writeHead(200, {
          'Content-Type': mime,
          'Content-Length': data.length,
        });
        res.end(data);
      } catch (e) { sendErr(res, e); }
    },

    // GET /thumbs?project=<name>&kind=image|mesh
    // List every version's on-disk file + size + mtime for a project.
    // Lets a remote analyser iterate versions and pull their bytes via
    // /screenshot-file.
    'GET /thumbs': async (req, res, url) => {
      try {
        const project = url.searchParams.get('project');
        const kind = (url.searchParams.get('kind') || 'image').toLowerCase();
        if (!project) return sendErr(res, 'missing project', 400);
        if (/[\\/]|\.\./.test(project)) return sendErr(res, 'invalid project name', 400);
        let dir, filter;
        if (kind === 'image') {
          dir = path.join(C.images, project);
          filter = f => /\.(png|jpe?g|webp)$/i.test(f);
        } else if (kind === 'mesh') {
          dir = C.meshes;
          filter = f => f.toLowerCase().includes(project.toLowerCase()) && /\.glb$/i.test(f);
        } else {
          return sendErr(res, 'kind must be image or mesh', 400);
        }
        if (!fs.existsSync(dir)) return sendOk(res, { project, kind, items: [] });
        const files = fs.readdirSync(dir).filter(filter).map(f => {
          const abs = path.join(dir, f);
          const st = fs.statSync(abs);
          return { name: f, path: abs, sizeBytes: st.size, modified: st.mtime };
        }).sort((a, b) => a.modified - b.modified);
        sendOk(res, { project, kind, items: files });
      } catch (e) { sendErr(res, e); }
    },

    // POST /compare-thumbs {a, b, threshold?}
    // Pixel-diff between two images. Returns
    //   { widthA, heightA, widthB, heightB,
    //     comparable, pixelCount, diffPixels, diffRatio }
    // 'comparable' is false when dimensions differ. threshold is the
    // per-channel delta below which a pixel is considered unchanged
    // (default 4). Uses plain Node Buffer reads — no external deps.
    'POST /compare-thumbs': async (req, res) => {
      try {
        const body = await readBody(req);
        const a = body && body.a, b = body && body.b;
        if (!a || !b) return sendErr(res, 'missing a and b paths', 400);
        const absA = path.resolve(a);
        const absB = path.resolve(b);
        if (_niveau === COMPLET && (!_dans(C.base, absA) || !_dans(C.base, absB))) {
          return sendErr(res, 'paths must be inside project root', 400);
        }
        if (_niveau !== COMPLET && (!_imageDeDonnees(absA) || !_imageDeDonnees(absB))) {
          return sendErr(res, 'paths must be image files inside the MyFabmesh.AI data folders', 403);
        }
        if (!fs.existsSync(absA) || !fs.existsSync(absB)) {
          return sendErr(res, 'one or both files missing', 404);
        }
        const threshold = Math.max(0, parseInt(body.threshold || '4', 10));
        // Decode via Electron's nativeImage (bundled, no deps).
        const { nativeImage } = require('electron');
        const imgA = nativeImage.createFromPath(absA);
        const imgB = nativeImage.createFromPath(absB);
        const sizeA = imgA.getSize(), sizeB = imgB.getSize();
        if (sizeA.width !== sizeB.width || sizeA.height !== sizeB.height) {
          return sendOk(res, {
            comparable: false,
            widthA: sizeA.width, heightA: sizeA.height,
            widthB: sizeB.width, heightB: sizeB.height,
          });
        }
        const bufA = imgA.toBitmap();   // BGRA, same layout both sides
        const bufB = imgB.toBitmap();
        const pixelCount = sizeA.width * sizeA.height;
        let diff = 0;
        for (let i = 0; i < bufA.length; i += 4) {
          const db = Math.abs(bufA[i]   - bufB[i]);
          const dg = Math.abs(bufA[i+1] - bufB[i+1]);
          const dr = Math.abs(bufA[i+2] - bufB[i+2]);
          if (db > threshold || dg > threshold || dr > threshold) diff++;
        }
        sendOk(res, {
          comparable: true,
          widthA: sizeA.width, heightA: sizeA.height,
          widthB: sizeB.width, heightB: sizeB.height,
          pixelCount, diffPixels: diff,
          diffRatio: diff / pixelCount,
          threshold,
        });
      } catch (e) { sendErr(res, e); }
    },

    // Log registry — short name -> absolute path. Dossiers de donnees de
    // l'appli (userData une fois installee : les chemins d'avant visaient
    // app.asar). « agent » (AGENT_LOG.md) n'existe qu'en developpement.
    ...(function() {
      const REGISTRY = {
        fabmesh:  LOG_FILE,                            // main process log
        renderer: C.rendererLog,                       // renderer console mirror
        error:    LAST_ERROR,                          // latest error dump
      };
      if (_ctx.racineDepot) REGISTRY.agent = path.join(_ctx.racineDepot, 'AGENT_LOG.md');   // claude's durable notes
      function resolveLog(name) {
        const f = REGISTRY[name || 'fabmesh'];
        if (!f) throw new Error('unknown log file: ' + name);
        return f;
      }

      return {
        // GET /logs?file=fabmesh&lines=200   (file optional, default fabmesh)
        // Back-compat: with no file param returns { fabmesh_log, last_error }.
        'GET /logs': async (req, res, url) => {
          try {
            const lines = parseInt(url.searchParams.get('lines') || '200', 10);
            const file = url.searchParams.get('file');
            if (!file) {
              // Legacy shape
              return sendOk(res, {
                fabmesh_log: tailFile(LOG_FILE, lines),
                last_error:  tailFile(LAST_ERROR, lines),
              });
            }
            const target = resolveLog(file);
            sendOk(res, { file, path: target, content: tailFile(target, lines) });
          } catch (e) { sendErr(res, e); }
        },

        // GET /logs/list — registered log names + current sizes.
        'GET /logs/list': async (req, res) => {
          const out = {};
          for (const [name, p] of Object.entries(REGISTRY)) {
            try {
              const st = fs.statSync(p);
              out[name] = { path: p, sizeBytes: st.size, modified: st.mtime };
            } catch (_) {
              out[name] = { path: p, sizeBytes: 0, modified: null, missing: true };
            }
          }
          sendOk(res, out);
        },

        // POST /logs/clear {file} — truncate to empty.
        'POST /logs/clear': async (req, res) => {
          try {
            const body = await readBody(req);
            const target = resolveLog(body.file);
            fs.writeFileSync(target, '');
            sendOk(res, { file: body.file || 'fabmesh', cleared: target });
          } catch (e) { sendErr(res, e); }
        },

        // POST /logs/append {file, line}  — append a single line with LF.
        //   {file, content} — append arbitrary content verbatim.
        'POST /logs/append': async (req, res) => {
          try {
            const body = await readBody(req);
            const target = resolveLog(body.file);
            const text = body.content != null
              ? String(body.content)
              : (body.line != null ? String(body.line) + '\n' : '');
            if (!text) return sendErr(res, 'missing line or content', 400);
            fs.appendFileSync(target, text);
            sendOk(res, { file: body.file || 'fabmesh', appended: text.length });
          } catch (e) { sendErr(res, e); }
        },

        // POST /logs/rotate {file}  — move current log to <name>.<ts>.log
        // and start a fresh empty file.
        'POST /logs/rotate': async (req, res) => {
          try {
            const body = await readBody(req);
            const target = resolveLog(body.file);
            const ts = new Date().toISOString().replace(/[:.]/g, '-');
            const archived = target + '.' + ts;
            if (fs.existsSync(target)) {
              fs.renameSync(target, archived);
            }
            fs.writeFileSync(target, '');
            sendOk(res, { file: body.file || 'fabmesh', archived });
          } catch (e) { sendErr(res, e); }
        },

        // GET /logs/stream?file=fabmesh — Server-Sent Events of new lines.
        // Clients get one `data: <line>\n\n` per appended line until they
        // disconnect (or the server stops). Useful for live-tailing a batch run.
        'GET /logs/stream': async (req, res, url) => {
          try {
            const file = url.searchParams.get('file') || 'fabmesh';
            const target = resolveLog(file);
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
            });
            res.write(': fabmesh log stream started\n\n');
            _flux.add(res);

            let pos = 0;
            try { pos = fs.statSync(target).size; } catch (_) {}
            let closed = false;
            const interval = setInterval(() => {
              if (closed) return;
              try {
                const st = fs.statSync(target);
                if (st.size < pos) { pos = 0; }       // log was rotated
                if (st.size === pos) return;
                const fd = fs.openSync(target, 'r');
                const buf = Buffer.alloc(st.size - pos);
                fs.readSync(fd, buf, 0, buf.length, pos);
                fs.closeSync(fd);
                pos = st.size;
                const text = buf.toString('utf8');
                for (const line of text.split(/\r?\n/)) {
                  if (line) res.write('data: ' + line.replace(/\n/g, '\\n') + '\n\n');
                }
              } catch (_) { /* ignore transient read errors */ }
            }, 500);

            const fin = () => { closed = true; clearInterval(interval); _flux.delete(res); };
            req.on('close', fin);
            res.on('close', fin);
          } catch (e) { sendErr(res, e); }
        },
      };
    })(),

    'GET /console': async (req, res, url) => {
      const lines = parseInt(url.searchParams.get('lines') || '500', 10);
      sendOk(res, _consoleBuf.slice(-lines));
    },

    'POST /click': async (req, res) => {
      const body = await readBody(req);
      if (!body.selector) return sendErr(res, 'missing selector', 400);
      const r = await rendererCall(mainWindow, 'click', { selector: body.selector });
      if (!r.ok) return sendErr(res, r.error);
      sendOk(res, r.data);
    },

    'POST /eval': async (req, res) => {
      const body = await readBody(req);
      if (!body.code) return sendErr(res, 'missing code', 400);
      try {
        // executeJavaScript s'execute dans le monde PRINCIPAL de la page
        // (window.state, window.meshyAPI) : c'est executer du code, d'ou le
        // niveau complet exige.
        const result = await mainWindow.webContents.executeJavaScript(
          '(async()=>{ try { return { ok:true, data: await (async()=>{' + body.code + '})() }; } catch(e){ return { ok:false, error: e && e.message || String(e) }; } })()',
          true
        );
        if (result && result.ok === false) return sendErr(res, result.error);
        sendOk(res, result && result.data);
      } catch (e) { sendErr(res, e); }
    },

    // Generic IPC dispatch — calls a method on window.meshyAPI with the
    // given args. Full access: every preload handler. Standard access: the
    // read-only allow-list IPC_STANDARD.
    // Body: { method: "generateImages", args: [ {...} ] }  OR
    //       { method: "generateImages", arg:  {...}      }
    'POST /ipc': async (req, res) => {
      const body = await readBody(req);
      const method = body && body.method;
      if (!method || typeof method !== 'string') {
        return sendErr(res, 'missing method (e.g. "generateImages")', 400);
      }
      // Never allow reaching into non-exposed properties or prototype.
      if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(method)) {
        return sendErr(res, 'invalid method name', 400);
      }
      if (_niveau !== COMPLET && !IPC_STANDARD.has(method)) {
        return sendErr(res, 'meshyAPI.' + method + ' ' + MSG_COMPLET + ' (see GET /ipc/methods)', 403);
      }
      const args = Array.isArray(body.args)
        ? body.args
        : (body.arg !== undefined ? [body.arg] : []);
      try {
        const script = `(async () => {
          try {
            const api = window.meshyAPI;
            if (!api) return { ok:false, error:'meshyAPI not exposed yet' };
            const fn = api[${JSON.stringify(method)}];
            if (typeof fn !== 'function') {
              return { ok:false, error:'meshyAPI.${method} is not a function' };
            }
            const out = await fn(...${JSON.stringify(args)});
            return { ok:true, data: out };
          } catch (e) {
            return { ok:false, error: (e && e.message) || String(e) };
          }
        })()`;
        const result = await mainWindow.webContents.executeJavaScript(script, true);
        if (result && result.ok === false) return sendErr(res, result.error);
        sendOk(res, result && result.data);
      } catch (e) { sendErr(res, e); }
    },

    // Introspection — list the methods of window.meshyAPI this level may call.
    'GET /ipc/methods': async (req, res) => {
      try {
        const result = await mainWindow.webContents.executeJavaScript(
          '(() => ({ ok:true, data: Object.keys(window.meshyAPI || {}).sort() }))()',
          true
        );
        const tout = (result && result.data) || [];
        sendOk(res, _niveau === COMPLET ? tout : tout.filter((m) => IPC_STANDARD.has(m)));
      } catch (e) { sendErr(res, e); }
    },

    // ---------------- PILOTAGE COMPLET (2026-09-28) ----------------
    'GET /ui/catalog': async (req, res, url) => {
      const q = Object.fromEntries(url.searchParams.entries());
      const r = await rendererCall(mainWindow, 'ui-catalog', q, 30000);
      if (!r.ok) return sendErr(res, r.error);
      sendOk(res, r.data);
    },
    // __garde : en standard, le renderer refuse les zones reservees a
    // l'utilisateur (test_api_client.js, _ZONES_RESERVEES). Pose ICI, apres
    // le corps de la requete : le client ne peut pas le choisir.
    'POST /ui/click': async (req, res) => {
      const body = await readBody(req);
      if (body.target === undefined) return sendErr(res, 'missing target', 400);
      const r = await rendererCall(mainWindow, 'ui-click', Object.assign({}, body, { __garde: garde() }), 30000);
      if (!r.ok) return sendErr(res, r.error);
      sendOk(res, r.data);
    },
    'POST /ui/fill': async (req, res) => {
      const body = await readBody(req);
      if (!body.fields || typeof body.fields !== 'object') return sendErr(res, 'missing fields {cible: valeur}', 400);
      const r = await rendererCall(mainWindow, 'ui-fill', Object.assign({}, body, { __garde: garde() }), 30000);
      if (!r.ok) return sendErr(res, r.error);
      sendOk(res, r.data);
    },
    'GET /ui/modal': async (req, res) => {
      const r = await rendererCall(mainWindow, 'ui-modal', {}, 15000);
      if (!r.ok) return sendErr(res, r.error);
      sendOk(res, r.data);
    },
    'POST /ui/wait': async (req, res) => {
      const body = await readBody(req);
      const t = Math.min(Number(body.timeout) || 30000, 600000);
      const r = await rendererCall(mainWindow, 'ui-wait', body, t + 5000);
      if (!r.ok) return sendErr(res, r.error);
      sendOk(res, r.data);
    },
    'GET /ui/toasts': async (req, res, url) => {
      const r = await rendererCall(mainWindow, 'ui-toasts', { since: url.searchParams.get('since') }, 10000);
      if (!r.ok) return sendErr(res, r.error);
      sendOk(res, r.data);
    },
    'POST /ui/mouse': async (req, res) => {
      const body = await readBody(req);
      if (body.target === undefined) return sendErr(res, 'missing target', 400);
      try { sendOk(res, await _souris(mainWindow, body)); } catch (e) { sendErr(res, e); }
    },
    'POST /ui/wheel': async (req, res) => {
      const body = await readBody(req);
      if (body.target === undefined) return sendErr(res, 'missing target', 400);
      try {
        const { pts } = await _pointsDe(mainWindow, { target: body.target, path: [[body.fx ?? 0.5, body.fy ?? 0.5]] });
        const n = Math.max(1, Math.min(Math.abs(Number(body.deltaY) || 0) / 120 || 1, 40));
        for (let i = 0; i < n; i++) {
          mainWindow.webContents.sendInputEvent({ type: 'mouseWheel', x: pts[0][0], y: pts[0][1],
            deltaX: 0, deltaY: Math.sign(Number(body.deltaY) || 1) * 120, canScroll: true });
          await _pause(20);
        }
        sendOk(res, { crans: n });
      } catch (e) { sendErr(res, e); }
    },
    'POST /ui/key': async (req, res) => {
      const body = await readBody(req);
      if (body.target !== undefined) {                      // focus d'abord (clic reel au centre)
        try { await _souris(mainWindow, { target: body.target }); } catch (e) { return sendErr(res, e); }
      }
      try { sendOk(res, await _clavier(mainWindow, body)); } catch (e) { sendErr(res, e); }
    },
    // largeur= (reduction) et format=jpeg (2026-09-30) : une capture legere
    // pour le serveur MCP (Claude voit l'appli). file= (ecrit un PNG sur le
    // disque) : acces complet seulement.
    'GET /ui/shot': async (req, res, url) => {
      try {
        const cible = url.searchParams.get('target');
        const fichier = url.searchParams.get('file');
        if (fichier && _niveau !== COMPLET) return sendErr(res, 'file= ' + MSG_COMPLET + ' ; without it the image is returned in the response', 403);
        let rect;
        if (cible) {
          const { rect: r } = await _pointsDe(mainWindow, { target: cible });
          const z = mainWindow.webContents.getZoomFactor ? mainWindow.webContents.getZoomFactor() : 1;
          rect = { x: Math.max(0, Math.floor(r.x * z)), y: Math.max(0, Math.floor(r.y * z)), width: Math.max(1, Math.ceil(r.w * z)), height: Math.max(1, Math.ceil(r.h * z)) };
        }
        let img = await mainWindow.webContents.capturePage(rect);
        if (fichier) {
          const png = img.toPNG();
          if (!/\.png$/i.test(fichier) || !path.isAbsolute(fichier)) return sendErr(res, 'file doit etre un chemin ABSOLU en .png', 400);
          fs.mkdirSync(path.dirname(fichier), { recursive: true });
          fs.writeFileSync(fichier, png);
          const t = img.getSize();
          return sendOk(res, { file: fichier, w: t.width, h: t.height });
        }
        const largeur = parseInt(url.searchParams.get('largeur') || url.searchParams.get('width') || '0', 10);
        if (largeur > 0 && img.getSize().width > largeur) img = img.resize({ width: largeur, quality: 'good' });
        const jpeg = /^jpe?g$/i.test(url.searchParams.get('format') || '');
        const octets = jpeg ? img.toJPEG(85) : img.toPNG();
        res.writeHead(200, { 'Content-Type': jpeg ? 'image/jpeg' : 'image/png', 'Content-Length': octets.length });
        res.end(octets);
      } catch (e) { sendErr(res, e); }
    },
    'POST /dialog/next': async (req, res) => {
      const body = await readBody(req);
      const ts = Date.now();
      const open = Array.isArray(body.open) ? body.open.map(String) : (typeof body.open === 'string' ? [body.open] : null);
      const save = body.save !== undefined ? (body.save ? String(body.save) : '') : undefined;
      if (_niveau !== COMPLET) {
        for (const p of (open || [])) { const e = _refusOuvrir(p); if (e) return sendErr(res, e, 403); }
        if (save) { const e = _refusEnregistrer(save); if (e) return sendErr(res, e, 403); }
      }
      if (open) _dialogues.open.push({ valeur: open, ts });
      if (save !== undefined) _dialogues.save.push({ valeur: save, ts });
      if (body.message !== undefined) _dialogues.message.push({ valeur: Number(body.message) || 0, ts });
      sendOk(res, { enAttente: { open: _dialogues.open.length, save: _dialogues.save.length, message: _dialogues.message.length },
        expireApres_s: Math.round((DUREE_REPONSE_MS[_niveau] || DUREE_REPONSE_MS[STANDARD]) / 1000) });
    },
    'GET /dialog/state': async (req, res) => {
      const v = (f) => f.map((e) => e.valeur);
      sendOk(res, { enAttente: { open: v(_dialogues.open), save: v(_dialogues.save), message: v(_dialogues.message) }, derniers: _dialogues.vus.slice(-10) });
    },
    'POST /dialog/clear': async (req, res) => {
      _viderDialogues();
      sendOk(res, { vide: true });
    },

    'POST /set': async (req, res) => {
      const body = await readBody(req);
      if (!body.selector) return sendErr(res, 'missing selector', 400);
      const r = await rendererCall(mainWindow, 'set', { selector: body.selector, value: body.value });
      if (!r.ok) return sendErr(res, r.error);
      sendOk(res, r.data);
    },

    'POST /select-project': async (req, res) => {
      const body = await readBody(req);
      if (!body.name) return sendErr(res, 'missing name', 400);
      const r = await rendererCall(mainWindow, 'select-project', { name: body.name });
      if (!r.ok) return sendErr(res, r.error);
      sendOk(res, r.data);
    },

    'POST /generate-image': async (req, res) => {
      const body = await readBody(req);
      const r = await rendererCall(mainWindow, 'generate-image', body, 60000);
      if (!r.ok) return sendErr(res, r.error);
      sendOk(res, r.data);
    },

    'POST /generate-3d': async (req, res) => {
      const body = await readBody(req);
      const r = await rendererCall(mainWindow, 'generate-3d', body, 60000);
      if (!r.ok) return sendErr(res, r.error);
      sendOk(res, r.data);
    },

    'POST /auto-rig': async (req, res) => {
      const body = await readBody(req);
      const r = await rendererCall(mainWindow, 'auto-rig', body, 60000);
      if (!r.ok) return sendErr(res, r.error);
      sendOk(res, r.data);
    },

    // ============================================================
    // CALIBRATION endpoints — full pipeline + per-stage scoring.
    // Lets scripts (Claude Code, CI, batch sweeps) run calibration
    // without the UI. Uses the same Python script as the Settings UI.
    // ============================================================
    // /calib/run and /calib/run-legacy removed in 2026-05-18 legal cleanup
    // — their backing scripts (_calib_tiered.py, _calib_diagnose.py) never
    // existed in the repo. Use /calib/run-v3 instead (calls
    // run_calibration_v3.py which is present).
    'POST /calib/run': async (_req, res) => {
      sendErr(res, 'endpoint removed; use POST /calib/run-v3', 410);
    },

    'GET /calib/list-reports': async (req, res) => {
      try {
        const reportsDir = CALIB_REPORTS;
        if (!fs.existsSync(reportsDir)) return sendOk(res, { reports: [] });
        const out = [];
        for (const name of fs.readdirSync(reportsDir)) {
          if (name.startsWith('sweep_')) continue;
          const dir = path.join(reportsDir, name);
          const sp = path.join(dir, 'score.json');
          if (!fs.existsSync(sp)) continue;
          try {
            const s = JSON.parse(fs.readFileSync(sp, 'utf-8'));
            out.push({
              name, dir, mtime: fs.statSync(dir).mtimeMs,
              score: s.score, total: s.total,
              similarity: s.avg_similarity, timestamp: s.timestamp,
              mesh: s.mesh, results: s.results,
            });
          } catch (_) {}
        }
        out.sort((a, b) => b.mtime - a.mtime);
        sendOk(res, { reports: out });
      } catch (e) { sendErr(res, e.message, 500); }
    },

    'GET /calib/last-report': async (req, res) => {
      try {
        const reportsDir = CALIB_REPORTS;
        if (!fs.existsSync(reportsDir)) return sendErr(res, 'no reports dir', 404);
        const entries = fs.readdirSync(reportsDir)
          .filter(n => !n.startsWith('sweep_'))
          .map(n => ({ n, t: fs.statSync(path.join(reportsDir, n)).mtimeMs }))
          .sort((a, b) => b.t - a.t);
        if (!entries.length) return sendErr(res, 'no reports', 404);
        const dir = path.join(reportsDir, entries[0].n);
        const score = JSON.parse(fs.readFileSync(path.join(dir, 'score.json'), 'utf-8'));
        sendOk(res, {
          name: entries[0].n, dir, score,
          html: path.join(dir, 'index.html'),
        });
      } catch (e) { sendErr(res, e.message, 500); }
    },

    'GET /calib/report': async (req, res, url) => {
      const name = url.searchParams.get('name');
      if (!name) return sendErr(res, 'missing name', 400);
      if (/[\\/]|\.\./.test(name)) return sendErr(res, 'invalid name', 400);
      try {
        const reportsDir = CALIB_REPORTS;
        const dir = path.join(reportsDir, name);
        if (!fs.existsSync(dir)) return sendErr(res, 'not found', 404);
        const result = { name, dir };
        for (const fn of ['score.json', 'stage1_sf3d.json', 'stage2_mv.json',
                          'stage3_projected.json', 'verdict.json']) {
          const p = path.join(dir, fn);
          if (fs.existsSync(p)) {
            try { result[fn.replace('.json', '')] = JSON.parse(fs.readFileSync(p, 'utf-8')); }
            catch (_) {}
          }
        }
        sendOk(res, result);
      } catch (e) { sendErr(res, e.message, 500); }
    },

    'GET /calib/log': async (req, res, url) => {
      const lines = parseInt(url.searchParams.get('lines') || '500', 10);
      // Filter the main fabmesh.log by [calib] source.
      if (!fs.existsSync(LOG_FILE)) return sendOk(res, { log: '', path: LOG_FILE });
      const content = fs.readFileSync(LOG_FILE, 'utf-8');
      const calibLines = content.split(/\r?\n/).filter(l => l.includes('[calib]'));
      const tail = calibLines.slice(-lines).join('\n');
      sendOk(res, { log: tail, path: LOG_FILE, total_bytes: content.length });
    },

    'POST /calib/build-rubiks': async (req, res) => {
      // Was : rebuild the Rubik's calibration reference. Backing script
      // (_calib_build_rubiks.py) was never present in the repo (see the
      // similar removal of _calib_tiered/_calib_diagnose in the 2026-05-18
      // legal cleanup). Endpoint left as 410 Gone for any external caller
      // that still depends on it.
      sendErr(res, 'calib/build-rubiks: removed (backing script missing). '
        + 'Use /calib/run-v3 for the active calibration flow.', 410);
    },

    'GET /jobs': async (req, res) => {
      const r = await rendererCall(mainWindow, 'jobs', {});
      if (!r.ok) return sendErr(res, r.error);
      sendOk(res, r.data);
    },

    'GET /wait-job': async (req, res, url) => {
      const id = url.searchParams.get('id');
      const timeoutSec = parseInt(url.searchParams.get('timeout') || '300', 10);
      if (!id) return sendErr(res, 'missing id', 400);
      const deadline = Date.now() + timeoutSec * 1000;
      while (Date.now() < deadline) {
        if (!_server) return sendErr(res, 'control API stopped', 503);
        const r = await rendererCall(mainWindow, 'get-job', { id });
        if (r.ok && r.data) {
          const st = r.data.status;
          if (st === 'completed' || st === 'failed' || st === 'cancelled') {
            return sendOk(res, r.data);
          }
        }
        // Interrupt fast if an error popup appeared: the renderer often
        // shows customError() before the job status is flipped, and
        // waiting out the timeout would mean minutes of wasted time.
        // We detect any visible modal whose title matches /fail|error|failed/i.
        const pr = await rendererCall(mainWindow, 'popups', {});
        if (pr.ok && Array.isArray(pr.data)) {
          const errPopup = pr.data.find(p => {
            const title = (p.title || '').toLowerCase();
            return /fail|error|erreur|échec/.test(title);
          });
          if (errPopup) {
            return sendOk(res, {
              job: r.ok ? r.data : null,
              interrupted: true,
              errorPopup: {
                id: errPopup.id,
                title: errPopup.title,
                text: errPopup.text,
              },
            });
          }
        }
        await new Promise(rv => setTimeout(rv, 500));
      }
      sendErr(res, 'timeout');
    },

    'GET /popups': async (req, res) => {
      const r = await rendererCall(mainWindow, 'popups', {});
      if (!r.ok) return sendErr(res, r.error);
      sendOk(res, r.data);
    },

    'POST /dismiss-popup': async (req, res) => {
      const body = await readBody(req);
      const r = await rendererCall(mainWindow, 'dismiss-popup', body);
      if (!r.ok) return sendErr(res, r.error);
      sendOk(res, r.data);
    },

    'GET /last-error': async (req, res) => {
      try {
        const content = fs.existsSync(LAST_ERROR) ? fs.readFileSync(LAST_ERROR, 'utf8') : '';
        sendOk(res, { content });
      } catch (e) { sendErr(res, e); }
    },

    'GET /devtools-open': async (req, res) => {
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.openDevTools({ mode: 'detach' });
        }
        sendOk(res, { opened: true });
      } catch (e) { sendErr(res, e); }
    }
  };
  return routes;
}

// ============================================================
// Demarrage / arret A CHAUD (interrupteur des Reglages, IPC de main.js)
// ============================================================
let _server = null;
let _niveau = STANDARD;
let _demarreA = null;
let _erreur = null;         // 'port-busy' | message | null
let _demarrage = null;      // promesse d'un demarrage en cours
let _generation = 0;        // +1 a chaque arret : un demarrage en cours devenu caduc se referme
const _sockets = new Set(); // connexions ouvertes (coupees a l'arret)
const _flux = new Set();    // flux /logs/stream ouverts

async function _traiter(req, res, routes) {
  let statut = 0;
  let authentifie = false;
  // Wrap writeHead so we can capture the final status without
  // touching every handler.
  const _origWriteHead = res.writeHead.bind(res);
  res.writeHead = function (code, ...rest) {
    statut = code;
    return _origWriteHead(code, ...rest);
  };
  try {
    if (!_requeteLocale(req)) {
      return sendErr(res, 'forbidden: only programs on this PC may call this API (no browser pages)', 403);
    }
    const url = new URL(req.url, 'http://' + HOST + ':' + _port());
    const key = req.method + ' ' + url.pathname;
    // Auth check on EVERY endpoint (no exceptions)
    if (!_checkAuth(req, url)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'unauthorized — missing or invalid Authorization: Bearer <token> header' }));
      return;
    }
    authentifie = true;
    const handler = routes[key];
    if (!handler) return sendErr(res, 'not found: ' + key, 404);
    if (_niveau !== COMPLET && !ROUTES_STANDARD.has(key)) return sendErr(res, key + ' ' + MSG_COMPLET, 403);
    await handler(req, res, url);
  } catch (e) {
    try { sendErr(res, e); } catch (_) {}
  } finally {
    _recordRequest(req, statut || 200, authentifie);
  }
}

/** Demarre le serveur (sans effet s'il tourne : change seulement le niveau). */
function demarrer(opts = {}) {
  const niveau = opts.niveau === COMPLET ? COMPLET : STANDARD;
  if (_server) { _niveau = niveau; return Promise.resolve(etat()); }
  if (_demarrage) return _demarrage.then(() => { if (_server) _niveau = niveau; return etat(); });
  const generation = _generation;
  _demarrage = new Promise((resolve) => {
    let routes;
    try {
      _installIpcHandlers();
      _installerDialogues();
      const fenetre = typeof _ctx.fenetre === 'function' ? _ctx.fenetre() : _ctx.fenetre;
      routes = _construireRoutes(fenetre);
    } catch (e) {
      _erreur = String((e && e.message) || e);
      return resolve(etat());
    }
    const server = http.createServer((req, res) => { _traiter(req, res, routes); });
    server.on('connection', (so) => { _sockets.add(so); so.on('close', () => _sockets.delete(so)); });
    const surEchec = (err) => {
      _erreur = (err && err.code === 'EADDRINUSE') ? 'port-busy' : String((err && err.message) || err);
      console.error('[control_api] server error:', err && err.message);
      try { server.close(); } catch (_) {}
      resolve(etat());
    };
    server.once('error', surEchec);
    server.listen(_port(), HOST, () => {
      server.removeListener('error', surEchec);
      server.on('error', (err) => console.error('[control_api] server error:', err && err.message));
      if (generation !== _generation) {     // arret demande pendant le demarrage
        try { server.close(); } catch (_) {}
        return resolve(etat());
      }
      _server = server;
      _niveau = niveau;
      _erreur = null;
      _demarreA = Date.now();
      _premiereConnexionVue = false;
      _reqHistory.length = 0;
      _authToken = crypto.randomBytes(32).toString('hex');
      _ecrireCle();                         // APRES le listen : un port occupe n'ecrase rien
      console.log('[control_api] listening on http://' + HOST + ':' + _port() + ' (' + _niveau + ' access)');
      resolve(etat());
    });
  });
  const p = _demarrage;
  p.then(() => { _demarrage = null; _emettre({ type: 'etat' }); });
  return p;
}

/** Arrete le serveur : connexions et flux coupes, file des dialogues videe, cle effacee. */
function arreter() {
  const server = _server;
  const ancienneCle = _authToken;
  _generation++;
  _server = null;
  _authToken = null;
  _demarreA = null;
  _viderDialogues();
  for (const e of _pending.values()) {
    clearTimeout(e.timer);
    try { e.resolve({ ok: false, error: 'control API stopped' }); } catch (_) {}
  }
  _pending.clear();
  for (const res of _flux) { try { res.end(); } catch (_) {} }
  _flux.clear();
  if (ancienneCle) _effacerCle(ancienneCle);
  if (!server) return Promise.resolve(etat());
  return new Promise((resolve) => {
    let fini = false;
    const fin = () => { if (fini) return; fini = true; console.log('[control_api] stopped'); _emettre({ type: 'etat' }); resolve(etat()); };
    try { server.close(fin); } catch (_) { fin(); }
    try { if (server.closeAllConnections) server.closeAllConnections(); } catch (_) {}
    for (const so of _sockets) { try { so.destroy(); } catch (_) {} }
    _sockets.clear();
    setTimeout(fin, 1500);
  });
}

/** Change le niveau sans redemarrer (les routes le lisent a chaque requete). */
function definirNiveau(niveau) {
  _niveau = niveau === COMPLET ? COMPLET : STANDARD;
  _emettre({ type: 'etat' });
  return etat();
}

/** Nouvelle cle (l'ancienne cesse aussitot de marcher). */
function nouvelleCle() {
  if (!_server) return etat();
  const ancienne = _authToken;
  _authToken = crypto.randomBytes(32).toString('hex');
  if (ancienne) _effacerCle(ancienne);
  _ecrireCle();
  return etat();
}

function cle() { return _server ? _authToken : null; }

/** Etat pour le panneau des Reglages (jamais la cle elle-meme). */
function etat() {
  const clients = {};
  for (const r of _reqHistory) {
    if (!r.auth) continue;
    const c = clients[r.client] || (clients[r.client] = { nom: r.client, n: 0, derniere: 0 });
    c.n++;
    if (r.ts > c.derniere) c.derniere = r.ts;
  }
  return {
    actif: !!_server,
    niveau: _niveau,
    hote: HOST,
    port: _port(),
    erreur: _erreur,
    demarreA: _demarreA,
    fichierCle: _fichierCle(),
    clients: Object.values(clients).sort((a, b) => b.derniere - a.derniere),
    activite: _reqHistory.slice(-20).reverse().map((r) => ({
      ts: r.ts, client: r.client, methode: r.method, chemin: r.path, statut: r.status,
    })),
  };
}

// ============================================================
// Ancienne entree (compatibilite) : demarre au niveau complet si les
// variables d'environnement ou le developpement le demandent, comme avant.
// main.js passe desormais par configurer() + demarrer().
// ============================================================
function startControlApi(mainWindow, opts = {}) {
  const envDisabled = process.env.FABMESH_CONTROL_API === '0';
  const envForced = process.env.FABMESH_CONTROL_API === '1';
  const legacyForce = process.env.FABMESH_TEST_API === '1';
  const packaged = !!(app && app.isPackaged);
  const enabled = legacyForce || envForced
    || (!envDisabled && opts.force !== false && !packaged);
  if (!enabled) {
    console.log('[control_api] disabled (packaged=' + packaged + ')');
    return null;
  }
  configurer({ fenetre: () => mainWindow, racineDepot: packaged ? null : path.join(__dirname, '..', '..') });
  return demarrer({ niveau: COMPLET });
}

module.exports = {
  configurer, demarrer, arreter, definirNiveau, nouvelleCle, cle, etat,
  STANDARD, COMPLET, PORT: PORT_DEFAUT,
  startControlApi, startTestApi: startControlApi,
};
