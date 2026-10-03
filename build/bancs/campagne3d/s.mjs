// Bibliotheque de la SUITE de la campagne des outils 3D / rigs / animations (2026-10-02, nuit, user absent).
// Differences avec t72/t73 : la Control API est au niveau « standard » (« Developer full access » ETEINT, ni /eval ni /ipc) -> tout passe par /ui/*, /state, /jobs
// et par les fichiers du disque ; la lignee d'une version se lit dans le NOM du fichier (…_decimate_<ts>_resize_<ts>.glb), pas dans l'etat de la page.
import * as h from './h.mjs';
import { appendFileSync, existsSync, statSync, readdirSync, mkdirSync, openSync, readSync, closeSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ICI = dirname(fileURLToPath(import.meta.url)).replace(/\\/g, '/');
export const REPO = ICI.replace(/\/build\/bancs\/campagne3d$/, '');
export const PY = join(process.env.APPDATA, 'myfabmesh-ai', 'python', 'python.exe');
export const LOGS = join(process.env.APPDATA, 'myfabmesh-ai', 'logs');
export const MESHES = join(process.env.APPDATA, 'myfabmesh-ai', 'meshes');
export const ANIMES = join(MESHES, 'animated');
export const JSONL = REPO + '/docs/campagnes/resultats_outils_3d_suite.jsonl';
export const SORTIE = 'C:/tmp/campagne/suite_resume.txt';
export const EXPORTS = 'C:/tmp/campagne/export_3d_suite'; mkdirSync(EXPORTS, { recursive: true });
export const STOP = 'C:/tmp/procedural_test/STOP';
// Budget : 3 h a partir de 22 h 53 (heure locale) ; plus aucun essai lance apres 2 h 45.
export const DEBUT_ABS = new Date(2026, 9, 2, 22, 53, 0).getTime();
export const LIMITE_LANCEMENT = DEBUT_ABS + 165 * 60e3;
export const FIN_ABS = DEBUT_ABS + 180 * 60e3;
export const note = (s) => { const l = new Date().toLocaleTimeString('fr-FR') + ' ' + s; console.log(l); try { appendFileSync(SORTIE, l + '\n'); } catch (_) {} };
export const taille = (f) => { try { return statSync(f).size; } catch (_) { return 0; } };
export const dormir = h.dormir;
export { h };

const ETAT = { projet: null, arret: null, essais: 0 };
const CACHE_BASE = {};
export const arrete = () => ETAT.arret;

// ------------------------------------------------------------------ gardes (regles du proprietaire)
function vramUtilisee() {
  try { return parseFloat(execFileSync('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits'], { encoding: 'utf8', timeout: 8000 }).trim()); } catch (_) { return null; }
}
export async function garde(lourd = true) {
  if (ETAT.arret) return false;
  if (existsSync(STOP)) { ETAT.arret = 'fichier STOP present'; note('ARRET : ' + ETAT.arret); return false; }
  if (Date.now() > LIMITE_LANCEMENT) { ETAT.arret = 'limite de 2 h 45 depassee : plus aucun essai lance'; note('ARRET : ' + ETAT.arret); return false; }
  // un travail que nous n'avons pas lance ? On attend 4 min qu'il finisse, sinon on s'arrete (l'utilisateur est revenu).
  const t0 = Date.now();
  for (;;) {
    const j = (await h.jobs().catch(() => [])).filter((x) => !/^(error|failed|done|completed|cancel)/i.test(String((x && x.status) || '')));
    if (!j.length) break;
    if (Date.now() - t0 > 240000) { ETAT.arret = 'travail inconnu en cours depuis plus de 4 min (' + j.map((x) => x.name || x.nom || x.type).join(' | ') + ') : l\'utilisateur est peut-etre revenu'; note('ARRET : ' + ETAT.arret); return false; }
    await dormir(5000);
  }
  if (lourd) {
    const t1 = Date.now();
    for (;;) {
      const v = vramUtilisee();
      if (v == null || v < 12000) break;
      if (Date.now() - t1 > 600000) { note('SAUT : VRAM occupee (' + v + ' Mo) depuis plus de 10 min par un autre programme'); return false; }
      note('   VRAM occupee (' + v + ' Mo) : j\'attends'); await dormir(30000);
    }
  }
  return true;
}

// Souris / clavier / molette : refuses au niveau « standard » (« Developer full access » eteint) -> l'essai est « non testable », pas « en echec ».
export async function souris(target, path, extra = {}) {
  const r = await h.api('POST', '/ui/mouse', { target, path, steps: 12, delay: 15, ...extra });
  if (r && r.ok === false && /full access/i.test(String(r.error || ''))) throw new Error('souris refusee : acces « standard » de la Control API (Developer full access eteint)');
  return r;
}
let _sourisDispo = null;
export async function sourisDispo() {
  if (_sourisDispo !== null) return _sourisDispo;
  const r = await h.api('POST', '/ui/mouse', { target: 'body', path: [[0.99, 0.99]], move: true });
  _sourisDispo = !(r && r.ok === false && /full access/i.test(String(r.error || '')));
  return _sourisDispo;
}
// ligne « non testable » sans toucher a l'appli
export function nonTestable(groupe, nom, projet, notes, raison) {
  const ligne = { groupe, nom, projet: projet || null, ok: false, cause: 'acces_standard', erreur: raison || 'souris / clavier refuses au niveau « standard » de la Control API (Developer full access eteint) : essai impossible a piloter', note: notes || '' };
  try { appendFileSync(JSONL, JSON.stringify(ligne) + String.fromCharCode(10)); } catch (_) {}
  note('NON TESTABLE ' + groupe + ' / ' + nom + ' : ' + ligne.erreur);
}
export async function touche(body) {
  const r = await h.api('POST', '/ui/key', body);
  if (r && r.ok === false && /full access/i.test(String(r.error || ''))) throw new Error('clavier refuse : acces « standard » de la Control API (Developer full access eteint)');
  return r;
}

// ------------------------------------------------------------------ navigation
export const nomProjet = async () => { const s = await h.etat().catch(() => null); return s && s.data && s.data.currentProject && s.data.currentProject.name; };
export const etatProjet = async () => { const s = await h.etat(); return (s.data && s.data.currentProject) || {}; };
export async function ouvrirProjet(nom) {
  const cur = await nomProjet();
  if (ETAT.projet && cur && cur !== ETAT.projet && cur !== nom) { ETAT.arret = 'le projet ouvert a change sans nous (« ' + cur + ' » au lieu de « ' + ETAT.projet + ' ») : l\'utilisateur est peut-etre revenu'; note('ARRET : ' + ETAT.arret); return false; }
  if (cur === nom) { ETAT.projet = nom; return true; }
  await h.clic('back-to-projects').catch(() => {}); await dormir(1800);
  await h.clic('texte:' + nom); await dormir(4500);
  const c2 = await nomProjet(); ETAT.projet = nom;
  return c2 === nom;
}
export async function fermerTout() {
  await h.clic('seg-cancel').catch(() => {});
  for (let i = 0; i < 5; i++) {
    const m = await h.modale(); const l = (m.data || []); if (!l.length) return true;
    for (const x of l) {
      let r;
      if (x.id === 'lm-fullscreen') { r = await h.clic('lm-fs-close'); await dormir(600); continue; }
      if (x.id === 'modal-confirm') { r = await h.clic({ text: 'Cancel', within: 'modal-confirm' }); if (!r.ok) r = await h.clic('confirm-cancel'); }   // JAMAIS « Install » / « Delete » en fermeture automatique
      else { r = await h.clic({ text: 'Cancel', within: x.id }); if (!r.ok) r = await h.clic({ text: 'Close', within: x.id }); if (!r.ok) r = await h.clic({ text: 'Back', within: x.id }); }
      await dormir(600);
    }
  }
  return ((await h.modale()).data || []).length === 0;
}
export async function modalesApresLancement() {
  for (let i = 0; i < 5; i++) {
    await dormir(1500);
    const m = await h.modale(); const l = (m.data || []).filter((x) => x.id !== 'modal-job-details');
    const cible = l.find((x) => x.id === 'modal-confirm') || l.find((x) => (x.boutons || []).some((b) => /^(normal|continue)$/i.test(b.label) || /eco/i.test(b.label)));
    if (!cible) return;
    const noms = (cible.boutons || []).map((b) => b.label);
    note('   fenetre apres lancement : ' + cible.id + ' « ' + String(cible.titre || '').slice(0, 60) + ' » boutons ' + noms.join('/'));
    const eco = noms.find((n) => /eco/i.test(n)); const normal = noms.find((n) => /^normal$/i.test(n)); const ok = noms.find((n) => /^(ok|confirm|continue|yes|re-skin|apply)/i.test(n));
    const choix = ok || normal || eco;   // « Normal » d'abord : on mesure le fonctionnement par defaut (la campagne 1 avait pris Eco)
    if (!choix || /^(install|delete|reset|supprimer|reinstall)/i.test(choix)) return;
    await h.clic({ text: choix, within: cible.id }); await dormir(1000);
  }
}
// clique la puce « vN » de la carte (mesh, rig...) : on cherche l'element au libelle exact dans le catalogue de la zone
export async function puce(zone, libelle) {
  const r = await h.api('GET', '/ui/catalog?all=1&limit=2000&zone=' + encodeURIComponent(zone));
  const els = (r.data && r.data.elements) || [];
  const prem = (x) => (x.label || '').trim().split(/\s+/)[0];   // carte repliee : le libelle devient « v1 ✕ 📷 ⏱ ⋮ »
  const e = els.find((x) => prem(x) === libelle && /div/.test(x.tag)) || els.find((x) => new RegExp('(^|\\s)' + libelle + '(\\s|$)').test(x.label || '') && /div/.test(x.tag));
  if (!e) return { ok: false, error: 'puce ' + libelle + ' introuvable', titre: null };
  const c = await h.clic(e.ref); await dormir(1500);
  return { ok: !!c.ok, titre: e.title || null, ref: e.ref };
}
export async function puceTitre(zone, motif) {
  const r = await h.api('GET', '/ui/catalog?all=1&limit=2000&zone=' + encodeURIComponent(zone));
  const els = (r.data && r.data.elements) || [];
  const e = els.find((x) => /^v\d+$/.test((x.label || '').trim().split(/\s+/)[0]) && /div/.test(x.tag) && new RegExp(motif).test(x.title || ''));
  if (!e) return { ok: false, error: 'aucune puce de titre ~ ' + motif, titre: null };
  const c = await h.clic(e.ref); await dormir(1500);
  return { ok: !!c.ok, titre: e.title || null, ref: e.ref, label: e.label };
}
export async function liste(zone, filtre) {
  const r = await h.api('GET', '/ui/catalog?all=1&limit=2000&zone=' + encodeURIComponent(zone) + (filtre ? '&q=' + encodeURIComponent(filtre) : ''));
  return (r.data && r.data.elements) || [];
}
export async function champs() {
  const m = await h.modale(); return (m.data || []);
}
export async function valeur(id) {
  const r = await h.api('GET', '/ui/catalog?all=1&limit=50&q=' + encodeURIComponent(id.replace(/^#/, '')));
  const e = ((r.data && r.data.elements) || []).find((x) => x.ref === (id.startsWith('#') ? id : '#' + id));
  return e || null;
}

// ------------------------------------------------------------------ fichiers produits
export function fichiersApres(t0, re = /\.glb$/i, dossiers = null) {
  const out = [];
  if (!dossiers) { dossiers = [MESHES, ANIMES]; try { for (const d of readdirSync(MESHES)) { const p = join(MESHES, d); if (statSync(p).isDirectory() && p !== ANIMES) dossiers.push(p); } } catch (_) {} }
  for (const d of dossiers) {
    try { for (const f of readdirSync(d)) { if (!re.test(f)) continue; const p = join(d, f); const s = statSync(p); if (s.isFile() && s.mtimeMs >= t0 - 1500) out.push({ f, p, t: s.mtimeMs }); } } catch (_) {}
  }
  return out.sort((a, b) => b.t - a.t);
}
function py(script, args, timeout = 300000) {
  try { return JSON.parse(execFileSync(PY, [join(ICI, script), ...args], { encoding: 'utf8', timeout, env: { ...process.env, PYTHONUTF8: '1' }, maxBuffer: 64 * 1024 * 1024 }).trim().split('\n').pop()); }
  catch (e) { return { erreur: String(e.message || e).slice(0, 200) }; }
}
export const validerGlb = (p) => py('valider_glb.py', [p], 240000);
export const BLENDER = 'C:/Program Files/Blender Foundation/Blender 5.1/blender.exe';
export function validerFbx(p) {
  try {
    const o = execFileSync(BLENDER, ['--background', '--factory-startup', '--python', join(ICI, 'valider_fbx.py'), '--', p], { encoding: 'utf8', timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
    const l = o.split(String.fromCharCode(10)).map((x) => x.trim()).filter((x) => x.startsWith('JSON:')).pop(); return l ? JSON.parse(l.slice(5)) : { erreur: 'pas de sortie JSON', fin: o.slice(-300) };
  } catch (e) { return { erreur: String(e.message || e).slice(0, 200) }; }
}
export const validerGeom = (p) => py('valider_geom.py', [p], 300000);
export const validerRig = (p, rapide = false) => py('valider_rig2.py', rapide ? [p, '--rapide'] : [p], 420000);
export const nomFichier = h.nomFichier;

// ------------------------------------------------------------------ un essai : mesures + journaux + fichiers produits + validation + ligne JSONL
function journalDepuis(pos) {
  const f = join(LOGS, 'fabmesh.log'); const n = taille(f); if (n <= pos) return '';
  const fd = openSync(f, 'r'); const buf = Buffer.alloc(Math.min(n - pos, 8_000_000)); readSync(fd, buf, 0, buf.length, pos); closeSync(fd);
  return buf.toString('utf8');
}
/**
 * essai({ groupe, nom, projet, avant, notes, max, lancer, genre, cible, lourd, rapide, accepteSansFichier })
 *  genre : 'mesh' (valider_glb), 'rig' / 'anim' (valider_rig2), null (pas de fichier attendu)
 *  avant : async () => {} preparation (selection de version...) executee APRES la garde et l'ouverture du projet, AVANT le chronometre
 */
export async function essai({ groupe, nom, projet, avant = null, notes = '', max = 600000, lancer, genre = 'mesh', cible = '#ws-mesh-canvas', lourd = true, rapide = false, accepteSansFichier = false, attendre = true, geom = false, post = null }) {
  if (!(await garde(lourd))) return null;
  note('=== ' + groupe + ' / ' + nom + (projet ? ' (projet ' + projet + ')' : ''));
  await fermerTout();
  if (projet && !(await ouvrirProjet(projet))) { if (ETAT.arret) return null; note('   ECHEC : projet ' + projet + ' non ouvert'); appendFileSync(JSONL, JSON.stringify({ groupe, nom, projet, ok: false, erreur: 'projet non ouvert (banc)' }) + '\n'); return null; }
  let prep = null;
  if (avant) { try { prep = await avant(); } catch (e) { prep = { ok: false, error: 'preparation : ' + String(e.message || e).slice(0, 200) }; } }
  if (prep && prep.ok === false) { note('   ECHEC (preparation, banc) : ' + prep.error); appendFileSync(JSONL, JSON.stringify({ groupe, nom, projet, ok: false, erreur: prep.error, cause: 'banc' }) + '\n'); await fermerTout(); return null; }
  const t0 = Date.now(); const pos = taille(join(LOGS, 'fabmesh.log'));
  const baseTitre = prep && prep.base ? prep.base : null;
  const l = await h.essayer({ categorie: groupe, nom, max, note: notes, cible, attendre, lancer: async () => {
    const r = await lancer(); if (r && r.ok === false) return r;
    await modalesApresLancement(); return { ok: true }; } });
  if (/acces « standard »/.test(l.erreur || '')) l.cause = 'acces_standard';
  try { const mf = await h.modale(); const fin = (mf.data || []).map((x) => ({ id: x.id, titre: String(x.titre || '').slice(0, 80), texte: String(x.texte || '').replace(/\s+/g, ' ').slice(0, 700), boutons: (x.boutons || []).map((b) => b.label).slice(0, 8) })); if (fin.length && (!l.ok || fin.some((x) => /fail|error|erreur/i.test(x.titre + ' ' + x.texte)))) l.fenetres_finales = fin; } catch (_) {}
  const produits = fichiersApres(t0).filter((x) => !/_thumb|\.meta|\.source/.test(x.f));
  l.fichiers = produits.map((x) => x.f); if (baseTitre) l.base = baseTitre;
  const nouveau = produits.length ? produits[0].p : null;
  if (nouveau) {
    l.nouvelle_version = nomFichier(nouveau); l.taille_mo = Math.round(taille(nouveau) / 1048576 * 10) / 10;
    if (genre === 'mesh') {
      l.mesures = validerGlb(nouveau); if (geom) l.geometrie = validerGeom(nouveau);
      const bp = resoudreTitre(baseTitre); if (bp) { if (!CACHE_BASE[bp]) CACHE_BASE[bp] = { glb: validerGlb(bp), geom: geom ? validerGeom(bp) : null }; l.base_mesures = CACHE_BASE[bp].glb; if (geom) l.base_geometrie = CACHE_BASE[bp].geom; }
    }
    else if (genre === 'rig' || genre === 'anim') l.mesures = validerRig(nouveau, rapide);
  } else if (genre && l.ok && !accepteSansFichier) { l.ok = false; l.erreur = 'aucun fichier cree dans meshes/ (' + groupe + '/' + nom + ')'; }
  if (post) { try { await post(l, nouveau); } catch (e) { l.post_erreur = String((e && e.message) || e).slice(0, 200); } }
  const j = journalDepuis(pos);
  if (/nvlddmkm|device lost|CUDA error|illegal memory access|DXGI_ERROR_DEVICE|GPU hung|cudaErrorLaunchFailure/i.test(j)) { l.erreur_gpu = true; ETAT.arret = 'ERREUR GPU dans le journal'; note('   !!! ERREUR GPU dans le journal : arret de la campagne'); }
  const ligne = { groupe, nom, projet: projet || null, ...l };
  mkdirSync(dirname(JSONL), { recursive: true });
  appendFileSync(JSONL, JSON.stringify(ligne) + '\n');
  note((l.ok ? 'OK   ' : 'ECHEC') + ' ' + nom + ' ' + l.duree_s + 's VRAM+' + l.vram_ajoutee_mo + ' (pic ' + l.vram_pic_mo + ') RAM+' + l.ram_ajoutee_mo + (l.erreur ? ' | ' + l.erreur : '') + (nouveau ? ' | ' + l.nouvelle_version : ''));
  if (l.toasts && l.toasts.length) note('   toasts : ' + l.toasts.join(' / ').slice(0, 300));
  if (l.erreurs_journal && l.erreurs_journal.length) note('   journal : ' + l.erreurs_journal.slice(0, 3).join(' || ').slice(0, 400));
  ETAT.essais++;
  await fermerTout();
  return { l, nouveau, produits };
}
export const resumeMesures = (m) => (m ? JSON.stringify(m).slice(0, 600) : '');

// « chevalier_medieval_1790901989157_decimate_….glb » (titre de puce) -> chemin reel dans meshes/ (le titre n'a pas « trellis2_native_ »)
export function resoudreTitre(titre) {
  if (!titre) return null;
  try { for (const f of readdirSync(MESHES)) if (f.replace('trellis2_native_', '') === titre) return join(MESHES, f); } catch (_) {}
  return null;
}
