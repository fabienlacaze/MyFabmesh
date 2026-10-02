// Banc de la campagne de test des outils du bureau : pilotage (Control API), mesures (duree, VRAM, RAM, GPU, temperature), journal des erreurs, captures.
import { readFileSync, existsSync, mkdirSync, appendFileSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { homedir, totalmem, freemem } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

export const DOSSIER = 'C:/tmp/campagne';
export const SHOTS = DOSSIER + '/shots';
mkdirSync(SHOTS, { recursive: true });
const BASE = 'http://127.0.0.1:7331';
const jeton = () => readFileSync(join(homedir(), '.fabmesh', 'test_api_token.txt'), 'utf8').trim();
const LOGS = join(process.env.APPDATA, 'myfabmesh-ai', 'logs');

export async function api(m, p, b) {
  const r = await fetch(BASE + p, { method: m, headers: { Authorization: 'Bearer ' + jeton(), 'Content-Type': 'application/json' }, body: m === 'POST' ? JSON.stringify(b || {}) : undefined });
  const t = r.headers.get('content-type') || '';
  return t.includes('json') ? r.json() : { ok: r.ok, data: '[binaire]' };
}
export const cible = (t) => (typeof t === 'string' && t.startsWith('texte:') ? { text: t.slice(6) } : t);
export const clic = (t) => api('POST', '/ui/click', { target: cible(t) });
export const remplir = (f) => api('POST', '/ui/fill', { fields: f });
export const modale = () => api('GET', '/ui/modal');
export const catalogue = (q) => api('GET', '/ui/catalog' + (q ? '?q=' + encodeURIComponent(q) : ''));
export const evalue = (code) => api('POST', '/eval', { code });
export const ipc = (method, args = []) => api('POST', '/ipc', { method, args });
export const etat = () => api('GET', '/state').catch(() => api('POST', '/state', {}));
export const jobs = async () => ((await api('GET', '/jobs')).data) || [];
export const toasts = async () => ((await api('GET', '/ui/toasts')).data) || [];
export const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
export async function shot(nom, target) {
  const f = SHOTS + '/' + nom + '.png';
  const r = await api('GET', '/ui/shot?file=' + encodeURIComponent(f) + (target ? '&target=' + encodeURIComponent(target) : ''));
  return r && r.ok ? f : null;
}

// ---- mesures
function gpu() {
  try {
    const o = execFileSync('nvidia-smi', ['--query-gpu=memory.used,utilization.gpu,temperature.gpu,power.draw', '--format=csv,noheader,nounits'], { encoding: 'utf8', timeout: 8000 }).trim().split(',').map((x) => parseFloat(x));
    return { vram: o[0], util: o[1], temp: o[2], watts: o[3] };
  } catch (_) { return null; }
}
const ramUtiliseeMo = () => Math.round((totalmem() - freemem()) / 1048576);
export function echantillonneur() {
  const base = { gpu: gpu(), ram: ramUtiliseeMo() };
  const s = { n: 0, vramMax: 0, utilMax: 0, utilSomme: 0, tempMax: 0, wattsMax: 0, ramMax: 0 };
  const t = setInterval(() => {
    const g = gpu(); const r = ramUtiliseeMo();
    if (g) { s.n++; s.vramMax = Math.max(s.vramMax, g.vram); s.utilMax = Math.max(s.utilMax, g.util); s.utilSomme += g.util; s.tempMax = Math.max(s.tempMax, g.temp); s.wattsMax = Math.max(s.wattsMax, g.watts || 0); }
    s.ramMax = Math.max(s.ramMax, r);
  }, 2000);
  return () => {
    clearInterval(t);
    return {
      vram_base_mo: base.gpu ? base.gpu.vram : null, vram_pic_mo: s.vramMax, vram_ajoutee_mo: base.gpu ? Math.max(0, s.vramMax - base.gpu.vram) : null,
      gpu_pic_pct: s.utilMax, gpu_moy_pct: s.n ? Math.round(s.utilSomme / s.n) : null, temp_pic_c: s.tempMax, watts_pic: Math.round(s.wattsMax),
      ram_base_mo: base.ram, ram_pic_mo: s.ramMax, ram_ajoutee_mo: Math.max(0, s.ramMax - base.ram),
    };
  };
}

// ---- journaux : ce qui s'est ecrit PENDANT l'outil
const taille = (f) => { try { return statSync(f).size; } catch (_) { return 0; } };
export function posJournaux() { return { main: taille(join(LOGS, 'fabmesh.log')), renderer: taille(join(LOGS, 'renderer.log')) }; }
function lireDepuis(f, pos) {
  try {
    const n = taille(f); if (n <= pos) return '';
    const fd = openSync(f, 'r'); const buf = Buffer.alloc(Math.min(n - pos, 2_000_000)); readSync(fd, buf, 0, buf.length, pos); closeSync(fd);
    return buf.toString('utf8');
  } catch (_) { return ''; }
}
export function erreursDepuis(pos) {
  const out = [];
  for (const [nom, f, p] of [['main', 'fabmesh.log', pos.main], ['renderer', 'renderer.log', pos.renderer]]) {
    for (const l of lireDepuis(join(LOGS, f), p).split(/\r?\n/)) {
      if (/\[(ERROR|WARN)\]|error|erreur|failed|echec|exception|traceback|cannot|unable|CUDA out of memory|OOM/i.test(l) && !/NSFW scan|heartbeat|ready-to-show|ResizeObserver/i.test(l)) out.push(nom + ': ' + l.slice(0, 260));
    }
  }
  return [...new Set(out)].slice(0, 12);
}

// ---- attendre la fin des travaux (apparition puis disparition dans /jobs)
export async function attendreTravaux(maxMs, { graceMs = 6000, journal = null } = {}) {
  const debut = Date.now(); let vu = false; let vide = 0;
  while (Date.now() - debut < maxMs) {
    const j = await jobs().catch(() => []);
    if (j.length) { vu = true; vide = 0; if (journal) journal(j); }
    else { vide++; if (vu && vide >= 2) return { fini: true, vu, ms: Date.now() - debut }; if (!vu && Date.now() - debut > graceMs) return { fini: true, vu: false, ms: Date.now() - debut }; }
    await dormir(2500);
  }
  return { fini: false, vu, ms: Date.now() - debut };
}

// ---- un essai complet : mesures + journaux + captures + ligne dans resultats.jsonl
export async function essayer({ categorie, nom, lancer, max = 600000, cible: vue = null, attendre = true, note = '' }) {
  const pos = posJournaux(); const stop = echantillonneur();
  const t0 = Date.now(); let ok = true; let erreur = null; let attente = null; let suivi = [];
  try {
    const r = await lancer();
    if (r && r.ok === false) { ok = false; erreur = (r.error || JSON.stringify(r)).slice(0, 300); }
    if (attendre && ok) {
      attente = await attendreTravaux(max, { journal: (j) => { const l = j.map((x) => (x.name || x.nom || x.type || '?') + (x.progress != null ? ' ' + x.progress + '%' : '')).join(' | '); if (!suivi.length || suivi[suivi.length - 1] !== l) suivi.push(l); } });
      if (!attente.fini) { ok = false; erreur = 'delai depasse (' + Math.round(max / 1000) + ' s)'; }
    }
  } catch (e) { ok = false; erreur = String((e && e.message) || e).slice(0, 300); }
  await dormir(1200);
  const mes = stop();
  const tt = await toasts().catch(() => []);
  const erreursJournal = erreursDepuis(pos);
  const capture = await shot((categorie + '_' + nom).replace(/[^\w.-]+/g, '_'), vue).catch(() => null);
  const ligne = {
    categorie, nom, ok, erreur, duree_s: Math.round((Date.now() - t0) / 100) / 10, travaux_vus: attente ? attente.vu : null,
    ...mes, toasts: (Array.isArray(tt) ? tt : []).map((x) => (x.text || x.message || String(x))).slice(-4), erreurs_journal: erreursJournal, etapes: suivi.slice(0, 6), capture, note,
  };
  appendFileSync(DOSSIER + '/resultats.jsonl', JSON.stringify(ligne) + '\n');
  return ligne;
}
export function resume(l) {
  return `${l.ok ? 'OK ' : 'ECHEC'} ${l.categorie}/${l.nom} ${l.duree_s}s VRAM+${l.vram_ajoutee_mo}Mo(pic ${l.vram_pic_mo}) RAM+${l.ram_ajoutee_mo}Mo GPU ${l.gpu_pic_pct}%/${l.gpu_moy_pct}% ${l.temp_pic_c}C ${l.watts_pic}W` + (l.erreur ? ' ERREUR: ' + l.erreur : '') + (l.toasts.length ? ' | toasts: ' + l.toasts.join(' / ') : '') + (l.erreurs_journal.length ? ' | journal: ' + l.erreurs_journal.slice(0, 2).join(' // ') : '');
}

// ---- aides pour la campagne
export async function projet() { const r = await evalue('const p=window.state.currentProject; return JSON.stringify({images:(p.images||[]).map(i=>typeof i==="string"?i:(i.path||i.url||"")), sel:p.selectedImagePath, meshes:p.meshes||[], selMesh:p.selectedMeshPath, rigs:p.rigs||[], animations:(p.animations||[]).length})'); return JSON.parse(r.data || '{}'); }
export async function selectionnerImage(chemin) {
  let dir = 'ws-img-prev';
  for (let i = 0; i < 16; i++) {
    const p = await projet(); if (p.sel === chemin) return true;
    await clic(dir); await dormir(600);
    const q = await projet();
    if (q.sel === p.sel) dir = dir === 'ws-img-prev' ? 'ws-img-next' : 'ws-img-prev';   // pas bouge : on inverse le sens
  }
  return false;
}
export const dernierFichier = (arr) => (arr && arr.length ? (typeof arr[arr.length - 1] === 'string' ? arr[arr.length - 1] : arr[arr.length - 1].path) : null);
// lance un outil a modale : ouvre, remplit, clique le bouton de validation. Rend { ok } ; l'attente et les mesures sont faites par essayer()
export async function outil({ bouton, champs = {}, valider, avant = 900 }) {
  const o = await clic(bouton); if (!o.ok) return { ok: false, error: 'ouverture: ' + JSON.stringify(o).slice(0, 160) };
  await dormir(avant);
  if (Object.keys(champs).length) { const f = await remplir(champs); if (f && f.ok === false) return { ok: false, error: 'remplir: ' + JSON.stringify(f).slice(0, 200) }; await dormir(300); }
  const v = await clic(valider); if (!v.ok) return { ok: false, error: 'valider: ' + JSON.stringify(v).slice(0, 200) };
  return { ok: true };
}

// V0 = la premiere version (ref_0.png) : on la PREVISUALISE (les outils partent de l'image previsualisee) puis on verifie.
export async function versV0() {
  for (let i = 0; i < 4; i++) {
    await clic({ text: 'v0', within: 'step-card-image' }); await dormir(700);
    const r = await evalue('return window.state.currentProject.previewImagePath'); const v = String(r.data || '');
    if (/ref_0\.png$/.test(v)) return true;
  }
  return false;
}
export const nomFichier = (x) => String(x || '').split(String.fromCharCode(92)).pop().split('/').pop();
