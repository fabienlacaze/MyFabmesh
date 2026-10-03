// Bibliotheque de la verification des correctifs (2026-10-03, voie « essais-bureau », vague 2).
// Pilote l'appli de bureau par la Control API (acces complet). Journal : docs/campagnes/resultats_verif_correctifs_2026-10-03.jsonl
import * as h from './h.mjs';
import { appendFileSync, existsSync, readFileSync, statSync, openSync, readSync, closeSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export { h };
export const ICI = dirname(fileURLToPath(import.meta.url)).split(String.fromCharCode(92)).join('/');
export const REPO = ICI.replace(/\/build\/bancs\/campagne3d$/, '');
export const JSONL = REPO + '/docs/campagnes/resultats_verif_correctifs_2026-10-03.jsonl';
export const PY = join(process.env.APPDATA, 'myfabmesh-ai', 'python', 'python.exe');
export const STOP = 'C:/tmp/procedural_test/STOP';
export const SORTIE = 'C:/tmp/essais_bureau';
export const LOG_RENDERER = REPO + '/logs/renderer.log';
export const LOG_START = REPO + '/logs/fabmesh_start.log';
export const dormir = h.dormir;
export const note = (s) => { const l = new Date().toLocaleTimeString('fr-FR') + ' ' + s; console.log(l); try { appendFileSync(SORTIE + '/journal.txt', l + '\n'); } catch (_) {} };
export const taille = (f) => { try { return statSync(f).size; } catch (_) { return 0; } };
export const stop = () => existsSync(STOP);

export function ligne(o) { try { appendFileSync(JSONL, JSON.stringify({ date: new Date().toISOString(), ...o }) + '\n'); } catch (e) { console.log('JSONL: ' + e.message); } }

// lecture d'un journal a partir d'un offset
export function lireDepuis(f, pos, max = 4_000_000) {
  try {
    const n = taille(f); if (n <= pos) return '';
    const fd = openSync(f, 'r'); const buf = Buffer.alloc(Math.min(n - pos, max)); readSync(fd, buf, 0, buf.length, pos); closeSync(fd);
    return buf.toString('utf8');
  } catch (_) { return ''; }
}
export const pos = () => ({ r: taille(LOG_RENDERER), s: taille(LOG_START) });
export function erreursDepuis(p) {
  const out = [];
  for (const [nom, f, o] of [['renderer', LOG_RENDERER, p.r], ['start', LOG_START, p.s]]) {
    for (const l of lireDepuis(f, o).split(/\r?\n/)) {
      if (/\[(error|uncaught|warn)\]|uncaught|exception|traceback|0xC0000005|ReferenceError|TypeError|SyntaxError/i.test(l) && !/NSFW scan|heartbeat|ResizeObserver|hidream/i.test(l)) out.push(nom + ': ' + l.slice(0, 300));
    }
  }
  return [...new Set(out)].slice(0, 20);
}

export async function fermerModales() {
  for (let i = 0; i < 6; i++) {
    const m = await h.modale(); const l = (m.data || []);
    if (!l.length) return true;
    for (const x of l) {
      let r;
      if (x.id === 'modal-job-details') { r = await h.clic('job-details-close-x'); await dormir(600); continue; }   // JAMAIS « Cancel task » : annulerait le travail en cours
      if (x.id === 'modal-confirm') { r = await h.clic({ text: 'Cancel', within: 'modal-confirm' }); if (!r.ok) r = await h.clic({ text: 'OK', within: 'modal-confirm' }); }   // OK seulement pour un simple message d'erreur (Copy error / OK)
      else { r = await h.clic({ text: 'Cancel', within: x.id }); if (!r.ok) r = await h.clic({ text: 'Close', within: x.id }); if (!r.ok) r = await h.clic({ text: 'Back', within: x.id }); if (!r.ok) r = await h.clic({ text: '✕', within: x.id }); }
      await dormir(600);
    }
  }
  return ((await h.modale()).data || []).length === 0;
}
export async function nomProjet() { const s = await h.etat(); return s && s.data && s.data.currentProject && s.data.currentProject.name; }
export async function ouvrirProjet(nom) {
  const e0 = await h.etat();
  if (e0 && e0.data && e0.data.page === 'workspace' && (await nomProjet()) === nom) return true;   // la page « projects » garde currentProject : il faut aussi etre dans l'espace de travail
  await h.clic('back-to-projects').catch(() => {}); await dormir(1800);
  await h.clic('texte:' + nom); await dormir(4500);
  return (await nomProjet()) === nom;
}
export const py = (script, args, timeout = 300000) => {
  try { return JSON.parse(execFileSync(PY, [join(ICI, script), ...args], { encoding: 'utf8', timeout, env: { ...process.env, PYTHONUTF8: '1' }, maxBuffer: 64 * 1024 * 1024 }).trim().split('\n').pop()); }
  catch (e) { return { erreur: String(e.message || e).slice(0, 300) }; }
};
export const validerGlb = (p) => py('valider_glb.py', [p], 240000);
export const validerGeom = (p) => py('valider_geom.py', [p], 300000);
export const BLENDER = 'C:/Program Files/Blender Foundation/Blender 5.1/blender.exe';
export function validerFbx(p) {
  try {
    const o = execFileSync(BLENDER, ['--background', '--factory-startup', '--python', join(ICI, 'valider_fbx.py'), '--', p], { encoding: 'utf8', timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
    const l = o.split('\n').map((x) => x.trim()).filter((x) => x.startsWith('JSON:')).pop(); return l ? JSON.parse(l.slice(5)) : { erreur: 'pas de sortie JSON', fin: o.slice(-300) };
  } catch (e) { return { erreur: String(e.message || e).slice(0, 300) }; }
}
export async function eval_(code) { const r = await h.evalue(code); return r && r.ok ? r.data : { erreur: r && r.error }; }

// ---- fichiers produits (le depot est le dossier de donnees en developpement)
export const MESHES = REPO + '/meshes';
export function fichiersApres(t0, re = /\.glb$/i, dossiers = [MESHES, MESHES + '/animated']) {
  const out = [];
  for (const d of dossiers) {
    try { for (const f of readdirSync(d)) { if (!re.test(f)) continue; const p = d + '/' + f; const s = statSync(p); if (s.isFile() && s.mtimeMs >= t0 - 1500) out.push({ f, p, t: s.mtimeMs, taille: s.size }); } } catch (_) {}
  }
  return out.sort((a, b) => b.t - a.t);
}
// clique la puce « vN » d'une carte d'etape
export async function puce(zone, libelle) {
  const r = await h.api('GET', '/ui/catalog?all=1&limit=2000&zone=' + encodeURIComponent(zone));
  const els = (r.data && r.data.elements) || [];
  const prem = (x) => (x.label || '').trim().split(/\s+/)[0];
  const e = els.find((x) => prem(x) === libelle && /div/.test(x.tag));
  if (!e) return { ok: false, error: 'puce ' + libelle + ' introuvable' };
  const c = await h.clic(e.ref); await dormir(1500);
  return { ok: !!c.ok, titre: e.title || null };
}
// fenetres de confirmation / de choix apres un lancement : on prend toujours la voie par defaut, JAMAIS Install / Delete / Reset
export async function modalesApresLancement() {
  for (let i = 0; i < 4; i++) {
    await dormir(1200);
    const m = await h.modale(); const lst = (m.data || []).filter((x) => x.id !== 'modal-job-details' && x.id !== 'modal-mesh-tool');
    const cible = lst.find((x) => x.id === 'modal-confirm') || lst.find((x) => (x.boutons || []).some((b) => /^(normal|continue)$/i.test(b.label)));
    if (!cible) return;
    const noms = (cible.boutons || []).map((b) => b.label);
    note('   fenetre apres lancement : ' + cible.id + ' « ' + String(cible.titre || '').slice(0, 60) + ' » boutons ' + noms.join('/'));
    const choix = noms.find((n) => /^(ok|confirm|continue|yes|apply|normal)/i.test(n));
    if (!choix || /^(install|delete|reset|supprimer|reinstall)/i.test(choix)) return;
    await h.clic({ text: choix, within: cible.id }); await dormir(1000);
  }
}
// attend la fin des travaux, avec delai et fichier STOP
export async function attendre(maxMs, grace = 8000) {
  const t0 = Date.now(); let vu = false; let vide = 0;
  while (Date.now() - t0 < maxMs) {
    if (stop()) return { fini: false, stop: true, vu };
    const j = (await h.jobs().catch(() => [])).filter((x) => !/^(error|failed|done|completed|cancel)/i.test(String((x && x.status) || '')));
    if (j.length) { vu = true; vide = 0; } else { vide++; if (vu && vide >= 2) return { fini: true, vu, ms: Date.now() - t0 }; if (!vu && Date.now() - t0 > grace) return { fini: true, vu: false, ms: Date.now() - t0 }; }
    await dormir(2500);
  }
  return { fini: false, vu, ms: Date.now() - t0 };
}
