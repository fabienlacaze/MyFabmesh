// Prepare une copie JETABLE du renderer du BUREAU pour un banc navigateur : src/renderer + un faux window.meshyAPI (a la place de preload.js) qui
// ENREGISTRE les arguments de imageTo3D dans window.__mock.imageTo3D. Rien n'est ecrit dans le depot ; aucun appel reseau externe n'est permis.
//   node build/bancs/navigateur/preparer-bureau.mjs <dossier de sortie> [racine du depot]
// Puis : node build/bancs/navigateur/serveur-statique.mjs <dossier de sortie> 8771 index2.html
//        node ~/.claude/skills/browser-automation/browser.mjs http://127.0.0.1:8771/index2.html --script build/bancs/navigateur/scenario-bureau-option-normales.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ici = path.dirname(fileURLToPath(import.meta.url));
const sortie = process.argv[2];
const depot = path.resolve(process.argv[3] || path.join(ici, '..', '..', '..'));
if (!sortie) { console.error('usage : node preparer-bureau.mjs <dossier de sortie> [racine du depot]'); process.exit(1); }
fs.rmSync(sortie, { recursive: true, force: true });
fs.cpSync(path.join(depot, 'src', 'renderer'), sortie, { recursive: true });

// noms exposes par preload.js (bloc meshyAPI) : chacun devient une methode du faux
const pre = fs.readFileSync(path.join(depot, 'src', 'main', 'preload.js'), 'utf8').replace(/\r\n/g, '\n');
const bloc = pre.slice(pre.indexOf("exposeInMainWorld('meshyAPI'"));
const noms = [...new Set([...bloc.matchAll(/^\s+([A-Za-z_][\w]*):\s*\(/gm)].map((m) => m[1]))];

const mock = `(function () {
  const NOMS = ${JSON.stringify(noms)};
  const M = window.__mock = { calls: [], logs: [], listeners: {}, imageTo3D: [], cfg: { computeMode: 'local', vramUsedGB: 2 } };
  const ORIG = location.origin;
  const _fetch = window.fetch.bind(window);
  window.fetch = function (u, o) { const s = String((u && u.url) || u); if (/^https?:/i.test(s) && s.indexOf(ORIG) !== 0) { M.logs.push('[fetch bloque] ' + s); return Promise.reject(new TypeError('bloque par le banc')); } return _fetch(u, o); };
  window.EventSource = function (u) { M.logs.push('[EventSource bloque] ' + u); this.close = function () {}; };
  window.WebSocket = function (u) { M.logs.push('[WebSocket bloque] ' + u); this.close = function () {}; this.send = function () {}; };
  const img = 'C:/tmp/none/logo-symbole.png';
  const defauts = {
    getConfig: () => ({ computeMode: M.cfg.computeMode }),
    getParentalStatus: () => ({ hasPin: false, unrestricted: false }),
    gpuStatus: () => ({ hasNvidia: true, name: 'NVIDIA GeForce RTX 5080', wizardMode: 'full' }),
    checkGPU: () => ({ available: true, name: 'NVIDIA GeForce RTX 5080', totalGB: 15.9, usedGB: M.cfg.vramUsedGB, freeGB: 15.9 - M.cfg.vramUsedGB, gpuUtil: 5, tempC: 50 }),
    checkRAM: () => ({ usedGB: 10, totalGB: 31.7, freeGB: 21.7 }),
    memoryBudget: () => ({ ok: true, vramMesuree: false }),
    memoryNeeds: () => ({ vram: { go: 8.9, outil: 'x' }, ram: { go: 12, outil: 'y' }, types: {}, appliActive: false }),
    listProcesses: () => ({ procs: [] }),
    jobsRunningCount: () => 0,
    isStoreBuild: () => false,
    hidreamAvailable: () => ({ available: false }),
    cloudStatus: () => ({ loggedIn: true, email: 'test@example.com', credits: 500 }),
    cloudPricing: () => ({ success: true, prices: { text2image: 3, mesh_fast: 8, mesh_balanced: 10, mesh_quality: 13, mesh_ultra_8k: 16, mesh_op_simple: 1 }, features: {} }),
    getNsfwKeywords: () => ['nsfw'],
    batchCheckNsfw: () => ({}),
    checkImagesNsfwTags: () => ({}),
    listImageFolders: () => [{ name: 'orc', count: 1, images: [img], created: Date.now() - 60000, prompt: 'an orc warrior' }],
    listMeshes: () => [],
    listerProjetsVides: () => [],
    listAnimations: () => [],
    getProjectDisplayNames: () => ({}),
    rigLocalDisponible: () => true,
    cpuUsage: () => ({ pct: 10, threads: 32 }),
    diskFree: () => ({ freeGB: 500, totalGB: 1000 }),
    countPython: () => 0,
    getThumbnail: () => null,
    checkMultiviewDir: () => null,
    checkStagesDir: () => null,
    checkStages3dDir: () => null,
    listRigTemplates: () => [],
    stopSdxlServer: () => ({ success: true }),
    setGpuLimits: () => ({ success: true }),
    translateText: (o) => ({ success: true, text: (o && (o.text || o.prompt)) || '' }),
    cancelJob: () => true,
    // la generation 3D n'aboutit jamais : on veut seulement les ARGUMENTS recus par le gestionnaire du processus principal
    imageTo3D: (args) => {
      try { M.imageTo3D.push(JSON.parse(JSON.stringify(args))); } catch (e) { M.imageTo3D.push({ erreur: String(e) }); }
      return new Promise((r) => setTimeout(() => r({ success: false, error: 'faux moteur : arret ici' }), 1200));
    },
  };
  const api = {};
  for (const nom of NOMS) {
    if (/^on[A-Z]/.test(nom)) { api[nom] = (cb) => { (M.listeners[nom] = M.listeners[nom] || []).push(cb); return () => {}; }; continue; }
    if (nom === 'logToFile') { api[nom] = (line) => { M.logs.push(String(line)); }; continue; }
    if (nom === 'jobsSnapshot' || nom === 'setComputeMode' || nom === 'confirmAppClose') { api[nom] = () => {}; continue; }
    api[nom] = (...args) => {
      M.calls.push(nom);
      const f = defauts[nom];
      try { return Promise.resolve(f ? f(...args) : null); } catch (e) { return Promise.reject(e); }
    };
  }
  window.meshyAPI = api;
})();
`;
fs.writeFileSync(path.join(sortie, 'mock_api.js'), mock);
const htmlPath = path.join(sortie, 'index2.html');
const html = fs.readFileSync(htmlPath, 'utf8');
if (!html.includes('<head>')) { console.error('index2.html sans <head> : le faux meshyAPI ne peut pas etre injecte'); process.exit(2); }
fs.writeFileSync(htmlPath, html.replace('<head>', '<head>\n  <script src="mock_api.js"></script>'));
console.log('banc bureau pret :', sortie, '(' + noms.length + ' methodes simulees)');
