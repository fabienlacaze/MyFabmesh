// Campagne des outils 3D du bureau (2026-10-02 nuit, user au lit, ordinateur a eteindre ensuite).
// Pilote l'appli par la Control API (h.mjs), sur le projet chevalier_medieval : chaque outil part d'une version de base (v4 = chevalier_..._1790901989157, 4096 px, ~500 K faces)
// ou de la version ALLEGEE (issue de « Triangle count 20 000 ») pour les outils de geometrie. Mesures (duree, VRAM, RAM, GPU, temperature), journal, capture, validation du GLB produit.
// Usage : node t72_outils3d.mjs [groupe,groupe,...]   groupes : geo, tex, edit, lourd (defaut : tous)
import * as h from './h.mjs';
import { appendFileSync, existsSync, statSync, mkdirSync, readFileSync, openSync, readSync, closeSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const DEBUT = Date.now();
const BUDGET_MS = Number(process.env.BUDGET_H || 5) * 3600e3;
const PY = join(process.env.APPDATA, 'myfabmesh-ai', 'python', 'python.exe');
const LOGS = join(process.env.APPDATA, 'myfabmesh-ai', 'logs');
const SORTIE = 'C:/tmp/campagne/t72_resume.txt';
const BASE_V = 'v4';
const PROJET = 'chevalier_medieval';
const groupes = (process.argv[2] || 'geo,tex,edit,lourd').split(',');
const note = (s) => { const l = new Date().toLocaleTimeString('fr-FR') + ' ' + s; console.log(l); appendFileSync(SORTIE, l + '\n'); };
const mouse = (target, path, extra = {}) => h.api('POST', '/ui/mouse', { target, path, steps: 12, delay: 15, ...extra });
const taille = (f) => { try { return statSync(f).size; } catch (_) { return 0; } };
let LEGER = process.env.LEGER_V || null;                 // puce de la version allegee (ex. « v6 »), issue de « Triangle count 20 000 »
let CRASH_GPU = false;

function journalDepuis(pos) {
  const f = join(LOGS, 'fabmesh.log'); const n = taille(f); if (n <= pos) return '';
  const fd = openSync(f, 'r'); const buf = Buffer.alloc(Math.min(n - pos, 8_000_000)); readSync(fd, buf, 0, buf.length, pos); closeSync(fd);
  return buf.toString('utf8');
}
async function fermerTout() {
  for (let i = 0; i < 5; i++) {
    const m = await h.modale(); const l = (m.data || []); if (!l.length) return true;
    for (const x of l) {
      let r;
      if (x.id === 'modal-confirm') r = await h.clic('confirm-ok');
      else { r = await h.clic({ text: 'Cancel', within: x.id }); if (!r.ok) r = await h.clic({ text: 'Close', within: x.id }); if (!r.ok) r = await h.clic({ text: 'Back', within: x.id }); }
      await h.dormir(600);
    }
  }
  return ((await h.modale()).data || []).length === 0;
}
async function modalesApresLancement() {
  // fenetres qui peuvent surgir apres « Apply » : confirmation (Continue / OK), memoire graphique juste (Normal / Eco). La confirmation passe en premier.
  for (let i = 0; i < 5; i++) {
    await h.dormir(1500);
    const m = await h.modale(); const l = (m.data || []).filter((x) => x.id !== 'modal-job-details');
    const cible = l.find((x) => x.id === 'modal-confirm') || l.find((x) => (x.boutons || []).some((b) => /^(normal|continue)$/i.test(b.label) || /eco/i.test(b.label)));
    if (!cible) return;
    const noms = (cible.boutons || []).map((b) => b.label);
    note('   fenetre apres lancement : ' + cible.id + ' « ' + String(cible.titre || '').slice(0, 50) + ' » boutons ' + noms.join('/'));
    const eco = noms.find((n) => /eco/i.test(n)); const normal = noms.find((n) => /^normal$/i.test(n)); const ok = noms.find((n) => /^(ok|confirm|continue|yes)/i.test(n));
    const choix = eco || ok || normal;
    if (!choix) return;
    await h.clic({ text: choix, within: cible.id }); await h.dormir(1000);
  }
}
const projetEtat = async () => {
  const r = await h.evalue('const p=window.state.currentProject; const m=(p.meshes||[]).map(x=>typeof x==="string"?x:(x.path||x.url||"")); return JSON.stringify({meshes:m, prev:p.previewMeshPath||null, sel:p.selectedMeshPath||null})');
  try { return JSON.parse(r.data); } catch (_) { return { meshes: [], prev: null }; }
};
async function selectionner(puce) {
  if (puce === 'leger') puce = LEGER;
  if (!puce) return false;
  for (let i = 0; i < 4; i++) {
    await h.clic({ text: puce, within: 'step-card-mesh' }); await h.dormir(1500);
    const e = await projetEtat(); const n = e.meshes.length; const idx = Number(puce.slice(1));
    const attendu = e.meshes[n - 1 - idx];
    if (attendu && e.prev && String(e.prev).replace(/\\/g, '/') === String(attendu).replace(/\\/g, '/')) return true;
  }
  return false;
}
async function setNombre(valeur, modal = 'modal-mesh-tool') {
  const code = 'const m=document.getElementById("' + modal + '"); const n=m.querySelector("input[type=number]"); n.value="' + valeur + '"; n.dispatchEvent(new Event("input",{bubbles:true})); n.dispatchEvent(new Event("change",{bubbles:true})); return n.value';
  return (await h.evalue(code)).data;
}
async function attendreVersion(avant, ms = 180000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const e = await projetEtat(); if (e.meshes.length > avant) return true; await h.dormir(2500); }
  return false;
}
function valider(chemin) {
  try { return JSON.parse(execFileSync(PY, ['C:/tmp/campagne/valider_glb.py', chemin], { encoding: 'utf8', timeout: 240000, env: { ...process.env, PYTHONUTF8: '1' } }).trim().split('\n').pop()); }
  catch (e) { return { erreur: String(e.message || e).slice(0, 160) }; }
}
const LECTURES = [];
// dernier clic d'un outil : si le bouton a deja disparu parce que le travail est parti (clic sur un choix qui lance tout de suite), ce n'est pas un echec
async function finir(cible) {
  const r = await h.clic(cible); if (r.ok) return r;
  await h.dormir(1500); if ((await h.jobs()).length) return { ok: true, note: 'travail deja lance' };
  return r;
}

async function essai({ nom, groupe, base = BASE_V, max = 600000, lancer, notes = '', versionAttendue = true, lourd = false }) {
  if (!groupes.includes(groupe)) return null;
  if (CRASH_GPU) { note('SAUT (carte en erreur) : ' + nom); return null; }
  if (Date.now() - DEBUT > BUDGET_MS) { note('SAUT (budget de temps depasse) : ' + nom); return null; }
  note('=== ' + groupe + ' / ' + nom + ' (base ' + base + ')');
  await fermerTout();
  const ok = await selectionner(base);
  if (!ok) { note('   ECHEC : version ' + base + ' non selectionnable'); appendFileSync('C:/tmp/campagne/resultats3d.jsonl', JSON.stringify({ groupe, nom, ok: false, erreur: 'version de base non selectionnable' }) + '\n'); return null; }
  const e0 = await projetEtat(); const avant = e0.meshes.length;
  const pos = taille(join(LOGS, 'fabmesh.log'));
  const l = await h.essayer({ categorie: '04_mesh_' + groupe, nom, max, note: notes, cible: '#ws-mesh-canvas', lancer: async () => {
    const r = await lancer(avant); if (r && r.ok === false) return r;
    await modalesApresLancement();
    if (versionAttendue && !(await attendreVersion(avant, 30000))) {
      // outil a travail : la nouvelle version arrive a la fin du travail (essayer() attend les travaux) ; sinon on attend ici
      const j = await h.jobs(); if (!j.length) { const v = await attendreVersion(avant, Math.min(max, 240000)); if (!v) return { ok: false, error: 'aucune nouvelle version creee' }; }
    }
    return { ok: true };
  } });
  const e1 = await projetEtat(); const apres = e1.meshes.length; l.versions_ajoutees = apres - avant;
  if (versionAttendue && l.ok && apres <= avant) { l.ok = false; l.erreur = 'aucune nouvelle version creee'; }
  let m = null; const nouvelle = apres > avant ? e1.meshes[0] : null;
  if (nouvelle) { m = valider(nouvelle); l.nouvelle_version = h.nomFichier(nouvelle); l.mesures = m; }
  const j = journalDepuis(pos);
  if (/nvlddmkm|device lost|CUDA error|illegal memory access|DXGI_ERROR_DEVICE|GPU hung|cudaErrorLaunchFailure/i.test(j)) { CRASH_GPU = true; l.erreur_gpu = true; note('   !!! ERREUR GPU dans le journal : on s\'arrete avant les outils lourds suivants'); }
  appendFileSync('C:/tmp/campagne/resultats3d.jsonl', JSON.stringify({ groupe, nom, base, ...l }) + '\n');
  console.log(h.resume(l)); note((l.ok ? 'OK   ' : 'ECHEC') + ' ' + nom + ' ' + l.duree_s + 's versions +' + l.versions_ajoutees + (l.erreur ? ' | ' + l.erreur : '') + (m ? ' | ' + (m.faces ?? '?') + ' faces, tex ' + JSON.stringify(m.tex_couleur || null) + ', lum ' + (m.lum_moy ?? '?') + ', noir ' + (m.part_noir_pct ?? '?') + '%' : ''));
  if (l.erreurs_journal && l.erreurs_journal.length) note('   journal : ' + l.erreurs_journal.slice(0, 3).join(' || ').slice(0, 400));
  await fermerTout();
  return { l, nouvelle };
}

// ------------------------------------------------------------------ ouverture du projet
note('############ CAMPAGNE OUTILS 3D — projet ' + PROJET + ' — groupes ' + groupes.join(','));
await h.clic('back-to-projects').catch(() => {}); await h.dormir(1500); await h.clic('texte:' + PROJET).catch(() => {}); await h.dormir(3500);
const e00 = await projetEtat(); note('versions du projet : ' + e00.meshes.length + ' ; base ' + BASE_V + ' = ' + h.nomFichier(e00.meshes[e00.meshes.length - 1 - Number(BASE_V.slice(1))]));
if (!/1790901989157/.test(String(e00.meshes[e00.meshes.length - 1 - Number(BASE_V.slice(1))]))) note('ATTENTION : la version v4 n\'est pas la version attendue');
const travauxAuDepart = await h.jobs(); if (travauxAuDepart.length) note('ATTENTION : ' + travauxAuDepart.length + ' travail(aux) en cours au depart');

// ------------------------------------------------------------------ GEO : outils de geometrie (modal-mesh-tool), d'abord la version allegee
if (groupes.includes('geo')) {
  const r = await essai({ nom: 'triangle_count_20000', groupe: 'geo', max: 400000, notes: 'Triangle count : 500 K -> 20 000 (cree la version allegee des essais suivants)', lancer: async () => {
    let o = await h.clic('ws-mesh-decimate-btn'); if (!o.ok) return o; await h.dormir(3000); await setNombre(20000); await h.dormir(3500); return await h.clic('mt-apply'); } });
  if (r && r.nouvelle) { const e = await projetEtat(); LEGER = 'v' + (e.meshes.length - 1); note('version allegee = ' + LEGER + ' (' + h.nomFichier(r.nouvelle) + ')'); }
  else note('PAS de version allegee : les outils de geometrie suivants partent de v4');
  const base = LEGER ? 'leger' : BASE_V;
  const simple = (bouton, extra) => async () => { let o = await h.clic(bouton); if (!o.ok) return o; await h.dormir(3500); if (extra) await extra(); return await h.clic('mt-apply'); };
  await essai({ nom: 'smooth', groupe: 'geo', base, max: 300000, notes: 'Smooth, 3 iterations (lissage laplacien)', lancer: simple('ws-mesh-smooth-btn') });
  await essai({ nom: 'subdivide_1', groupe: 'geo', base, max: 400000, notes: 'Subdivide, 1 niveau (x4 faces)', lancer: simple('ws-mesh-subdivide-btn') });
  await essai({ nom: 'fix_normals', groupe: 'geo', base, max: 300000, notes: 'Fix Normals (soude les coutures UV)', lancer: simple('ws-mesh-fixnormals-btn') });
  await essai({ nom: 'fill_holes', groupe: 'geo', base, max: 300000, notes: 'Fill Holes (3 a 20 000 aretes)', lancer: simple('ws-mesh-fillholes-btn') });
  await essai({ nom: 'set_pivot_center', groupe: 'geo', base, max: 300000, notes: 'Set Pivot : centre', lancer: simple('ws-mesh-center-btn', async () => { await h.remplir({ '@r625': 'center' }).catch(() => {}); }) });
  await essai({ nom: 'resize_x2', groupe: 'geo', base, max: 300000, notes: 'Resize : taille uniforme x2', lancer: async () => { let o = await h.clic('ws-mesh-resize-btn'); if (!o.ok) return o; await h.dormir(3000); await h.clic('rz-x2'); await h.dormir(1500); return await h.clic('rz-apply'); } });
  await essai({ nom: 'watertight', groupe: 'geo', base, max: 600000, notes: 'Watertight : remaillage voxel 192 (perd les UV et la texture)', lancer: simple('ws-mesh-watertight-btn') });
}

// ------------------------------------------------------------------ TEX : outils de texture (sur la version de base v4)
if (groupes.includes('tex')) {
  await essai({ nom: 'material_adjust', groupe: 'tex', max: 300000, notes: 'Material adjust : luminosite 1,3 ; saturation 1,2 ; rugosite 0,5', lancer: async () => {
    let o = await h.clic('ws-mesh-material-btn'); if (!o.ok) return o; await h.dormir(3500);
    await h.remplir({ '#mat-brightness': 1.3, '#mat-saturation': 1.2, '#mat-roughness': 0.5 }); await h.dormir(1200); return await h.clic('mat-apply-btn'); } });
  await essai({ nom: 'sharpen_texture_x2', groupe: 'tex', max: 900000, notes: 'Sharpen texture (x2) : agrandissement sans invention', lancer: async () => {
    let o = await h.clic('ws-mesh-enhance-tex-btn'); if (!o.ok) return o; await h.dormir(1500); return await finir('lct-lancer'); } });
  await essai({ nom: 'rebake_photo_2048', groupe: 'tex', max: 900000, notes: 'Re-bake from photo (HD) : 2048 px', lancer: async () => {
    let o = await h.clic('ws-mesh-retexture-btn'); if (!o.ok) return o; await h.dormir(3000);
    await h.clic({ text: '2048 px', within: 'modal-mesh-tool' }); await h.dormir(800); return await finir('mt-apply'); } });
  await essai({ nom: 'texture_variation_or', groupe: 'tex', max: 900000, notes: 'Texture variations : style « golden », force 40 %', lancer: async () => {
    let o = await h.clic('ws-mesh-texvar-btn'); if (!o.ok) return o; await h.dormir(3500);
    await h.evalue('const m=document.getElementById("modal-mesh-tool"); const t=m.querySelector("input[type=text]"); if(t){t.value="golden"; t.dispatchEvent(new Event("input",{bubbles:true}));} return !!t'); await h.dormir(800); return await finir('mt-apply'); } });
  await essai({ nom: 'retexture_all_fast', groupe: 'tex', max: 1500000, lourd: true, notes: 'Re-texture all : 3D Native PBR, preset Fast (12 pas, 2048 px)', lancer: async () => {
    let o = await h.clic('ws-mesh-trellis2-btn'); if (!o.ok) return o; await h.dormir(3500);
    await h.clic({ text: 'Fast', within: 'modal-mesh-tool' }); await h.dormir(800); return await finir('mt-apply'); } });
  await essai({ nom: 'detail_plus_plus', groupe: 'tex', max: 2400000, lourd: true, notes: 'Detail++ : detail IA sur la texture (rendu, affinage SDXL, report)', lancer: async () => {
    let o = await h.clic('ws-mesh-detail-synth-btn'); if (!o.ok) return o; await h.dormir(1500); return await finir('lct-lancer'); } });
  await essai({ nom: 'region_retexture_cuirasse', groupe: 'tex', max: 1500000, lourd: true, notes: 'Re-texture a region : cuirasse peinte a la souris, prompt « golden polished metal armor »', lancer: async () => {
    let o = await h.clic('ws-mesh-region-retex-btn'); if (!o.ok) return o; await h.dormir(4000);
    await h.remplir({ '#pe-mask-prompt': 'golden polished metal armor' }); await h.dormir(500);
    await mouse('#pe-canvas', [[0.46, 0.42], [0.54, 0.42], [0.54, 0.50], [0.46, 0.50], [0.46, 0.46], [0.54, 0.46]]); await h.dormir(800);
    return await finir('pe-apply-device'); } });
  await essai({ nom: 'clone_stamp_3d', groupe: 'tex', max: 600000, notes: 'Clone stamp : source (Ctrl+clic) puis copie en glissant', lancer: async () => {
    let o = await h.clic('ws-mesh-clone3d-btn'); if (!o.ok) return o; await h.dormir(4000);
    await mouse('#pe-canvas', [[0.46, 0.40]], { modifiers: ['control'] }); await h.dormir(500);
    await mouse('#pe-canvas', [[0.54, 0.55], [0.58, 0.58], [0.54, 0.62]]); await h.dormir(800); return await h.clic('pe-apply-device'); } });
  await essai({ nom: 'paint_mesh_stylo', groupe: 'tex', max: 600000, notes: 'Paint Mesh : trait rouge au stylo sur la texture', lancer: async () => {
    let o = await h.clic('ws-mesh-paint-mesh-btn'); if (!o.ok) return o; await h.dormir(4000);
    const c = await h.catalogue('canvas'); const cv = ((c.data && c.data.elements) || []).find((x) => /modal-paint-mesh/.test(x.zone || '') && x.tag === 'canvas');
    const cible = cv ? cv.ref : '#pm-canvas';
    await mouse(cible, [[0.44, 0.40], [0.56, 0.44], [0.46, 0.52], [0.56, 0.58]]); await h.dormir(800); return await h.clic('pm-save'); } });
}

// ------------------------------------------------------------------ EDIT : sculpture, peinture de sommets, selection (modal-mesh-edit), sur la version allegee
if (groupes.includes('edit')) {
  const base = LEGER ? 'leger' : BASE_V;
  const ouvrirEdit = async (bouton) => { let o = await h.clic(bouton); if (!o.ok) return o; await h.dormir(4500); return { ok: true }; };
  await essai({ nom: 'sculpt_push', groupe: 'edit', base, max: 300000, notes: 'Sculpt : poussee sur le torse, enregistre', lancer: async () => {
    const o = await ouvrirEdit('ws-mesh-sculpt-btn'); if (!o.ok) return o;
    await mouse('#me-canvas', [[0.48, 0.45], [0.52, 0.48], [0.48, 0.52]]); await h.dormir(800); return await h.clic('me-save'); } });
  await essai({ nom: 'vertex_paint', groupe: 'edit', base, max: 300000, notes: 'Vertex Paint : trait rouge, enregistre', lancer: async () => {
    const o = await ouvrirEdit('ws-mesh-paintvert-btn'); if (!o.ok) return o;
    await h.clic('me-tool-paint').catch(() => {}); await h.dormir(800);
    await mouse('#me-canvas', [[0.46, 0.40], [0.54, 0.44], [0.46, 0.50]]); await h.dormir(800); return await h.clic('me-save'); } });
  await essai({ nom: 'select_faces_supprimer', groupe: 'edit', base, max: 300000, notes: 'Select : selection au pinceau puis suppression des faces (Suppr), enregistre', lancer: async () => {
    const o = await ouvrirEdit('ws-mesh-selectface-btn'); if (!o.ok) return o;
    await mouse('#me-canvas', [[0.48, 0.30], [0.52, 0.32], [0.48, 0.34]]); await h.dormir(800);
    await h.api('POST', '/ui/key', { key: 'Delete' }); await h.dormir(1500); return await h.clic('me-save'); } });
  await essai({ nom: 'explode_24', groupe: 'edit', base, max: 400000, notes: 'Explode / destroy : 24 fragments, interieur plein', lancer: async () => {
    let o = await h.clic('ws-mesh-explode-btn'); if (!o.ok) return o; await h.dormir(2500); return await h.clic('ex3d-start'); } });
}

// ------------------------------------------------------------------ LOURD : segmentation, nommage, remodelage
if (groupes.includes('lourd')) {
  const seg = await essai({ nom: 'segment_parts', groupe: 'lourd', max: 1800000, lourd: true, notes: 'Segment parts : decoupe en parties semantiques (6 a 10 min)', lancer: async () => {
    let o = await h.clic('ws-mesh-segment-btn'); if (!o.ok) return o; await h.dormir(4000); const j = await h.jobs(); if (!j.length) { await h.dormir(8000); } return { ok: true }; } });
  if (seg && seg.l && seg.l.ok) {
    await essai({ nom: 'name_zones', groupe: 'lourd', base: 'v' + ((await projetEtat()).meshes.length - 1), max: 900000, lourd: true, notes: 'Name the zones : nomme les parties segmentees', lancer: async () => {
      let o = await h.clic('ws-mesh-name-btn'); if (!o.ok) return o; await h.dormir(3000);
      for (let i = 0; i < 3; i++) { const m = await h.modale(); const l = (m.data || []); if (!l.length) break; const x = l[0]; note('   fenetre nommage : ' + x.id + ' ' + String(x.titre || '').slice(0, 40) + ' boutons ' + (x.boutons || []).map((b) => b.label).join('/')); const go = (x.boutons || []).map((b) => b.label).find((n) => /name|start|apply|ok|run|launch/i.test(n)); if (!go) break; await h.clic({ text: go, within: x.id }); await h.dormir(1500); }
      return { ok: true }; } });
  }
  await essai({ nom: 'reshape_casque', groupe: 'lourd', max: 1800000, lourd: true, notes: 'Reshape a region : « helmet » -> « a crystal skull with two horns » (reconstruit la partie en 3D)', lancer: async () => {
    let o = await h.clic('ws-mesh-reshape-btn'); if (!o.ok) return o; await h.dormir(6000);
    await h.remplir({ '#rrx-part': 'helmet', '#rrx-prompt': 'a crystal skull with two horns' }); await h.dormir(500);
    await h.clic('rrx-detect'); await h.dormir(25000); return await h.clic('rrx-apply'); } });
}
note('############ FIN — ' + Math.round((Date.now() - DEBUT) / 60000) + ' min');
