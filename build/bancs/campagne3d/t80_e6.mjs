// E6 : editeur de maillage. vide = Select All + Delete + Save (doit refuser) ; couleur = pinceau + Delete + Save (COLOR_0 sans cyan) ; paint = Paint Mesh garde la taille de texture.
// Usage : node t80_e6.mjs vide,couleur,paint
import * as l from './t80_lib.mjs';
import { execFileSync } from 'node:child_process';
const h = l.h;
const quoi = (process.argv[2] || 'vide').split(',');
const mouse = (target, path) => h.api('POST', '/ui/mouse', { target, path, steps: 12, delay: 15 });
const color0 = (p) => { try { return JSON.parse(execFileSync(l.PY, ['C:/tmp/essais_bureau/color0.py', p], { encoding: 'utf8' }).trim().split('\n').pop()); } catch (e) { return { erreur: String(e.message).slice(0, 200) }; } };
async function choisirVersion(motif) {
  const r = await h.api('GET', '/ui/catalog?all=1&limit=2000&zone=step-card-mesh');
  const e = ((r.data && r.data.elements) || []).find((x) => /^v\d+$/.test((x.label || '').trim().split(/\s+/)[0]) && new RegExp(motif).test(x.title || ''));
  if (e) { await h.clic(e.ref); await l.dormir(1500); }
  return e ? e.title : null;
}
await l.fermerModales();
await l.ouvrirProjet('verif_t80');

if (quoi.includes('vide')) {
  const base = await choisirVersion('decimate_1791025542165');
  const avantFichiers = l.fichiersApres(0, /_edited_.*\.glb$/i).length;
  const p0 = l.pos(); const t0 = Date.now();
  const o = await h.clic('ws-mesh-selectface-btn'); await l.dormir(5000);
  const a = await h.clic('me-sel-all'); await l.dormir(1000);
  const d = await h.clic('me-sel-delete'); await l.dormir(1200);
  const tAvant = ((await h.toasts()) || []).length;
  const s = await h.clic('me-save'); await l.dormir(3500);
  const toasts = ((await h.toasts()) || []).map((x) => x.type + ':' + x.text);
  const f = l.fichiersApres(t0, /_edited_.*\.glb$/i);
  const m = (await h.modale()).data || [];
  await h.shot('t80_e6_vide');
  const msgOk = toasts.some((x) => /Nothing to save/i.test(x));
  const res = { id: 'E6', nom: 'vide_select_all_delete_save', ok: msgOk && f.length === 0, base, ouvert: o.ok, all: a.ok, del: d.ok, save: s.ok, toasts, nouveaux_fichiers: f.map((x) => x.f), editeur_toujours_ouvert: m.map((x) => x.id), erreurs_journal: l.erreursDepuis(p0), duree_s: Math.round((Date.now() - t0) / 100) / 10 };
  l.ligne(res); l.note('E6 vide : ' + JSON.stringify(res));
  await l.fermerModales();
}

if (quoi.includes('couleur')) {
  const base = await choisirVersion('decimate_1791025542165');
  const p0 = l.pos(); const t0 = Date.now();
  const o = await h.clic('ws-mesh-selectface-btn'); await l.dormir(5000);
  const m1 = await mouse('#me-canvas', [[0.5, 0.4], [0.52, 0.45], [0.5, 0.5], [0.48, 0.55]]); await l.dormir(800);
  await h.shot('t80_e6_couleur_selection');
  const d = await h.clic('me-sel-delete'); await l.dormir(1200);
  const s = await h.clic('me-save'); await l.dormir(4500);
  const toasts = ((await h.toasts()) || []).map((x) => x.type + ':' + x.text);
  const f = l.fichiersApres(t0, /_edited_.*\.glb$/i);
  const res = { id: 'E6', nom: 'couleur_selection_pas_dans_COLOR_0', ok: false, base, ouvert: o.ok, souris: m1 && m1.ok, del: d.ok, save: s.ok, toasts, nouveaux_fichiers: f.map((x) => x.f), erreurs_journal: l.erreursDepuis(p0) };
  if (f.length) { res.color0 = color0(f[0].p); res.glb = l.validerGlb(f[0].p); res.chemin = f[0].p; res.ok = !!(res.color0.prims && res.color0.prims.every((q) => !q.cyan)); }
  l.ligne(res); l.note('E6 couleur : ' + JSON.stringify({ ok: res.ok, f: res.nouveaux_fichiers, color0: res.color0, faces: res.glb && res.glb.faces, toasts }));
  await l.fermerModales();
}

if (quoi.includes('paint')) {
  const base = await choisirVersion('^verif_t80_1791025300001\.glb$|trellis2_native_1791025300001\.glb$');
  l.note('paint base : ' + base);
  const p0 = l.pos(); const t0 = Date.now();
  const o = await h.clic('ws-mesh-paint-mesh-btn'); await l.dormir(9000);
  const c = await h.catalogue('canvas'); const cv = ((c.data && c.data.elements) || []).find((x) => /modal-paint-mesh/.test(x.zone || '') && x.tag === 'canvas');
  const cible = cv ? cv.ref : '#pm-canvas';
  const taillesCanvas = await l.eval_('return JSON.stringify(typeof pmState!=="undefined" && pmState.canvases ? [...pmState.canvases.values()].map(e=>[e.diffuse&&e.diffuse.w, e.diffuse&&e.diffuse.h, e.metal?e.metal.w:null]) : null)');
  await h.remplir({ '#pm-color': '#ff0000' }); await l.dormir(400);
  const m1 = await mouse(cible, [[0.44, 0.40], [0.56, 0.44], [0.46, 0.52], [0.56, 0.58]]); await l.dormir(1000);
  await h.shot('t80_e6_paint');
  const s = await h.clic('pm-save');
  const att = await l.attendre(600000);
  await l.dormir(2000);
  const f = l.fichiersApres(t0, /_paint_.*\.glb$/i);
  const res = { id: 'E6', nom: 'paint_mesh_taille_texture', ok: false, base, ouvert: o.ok, canvas: cible, taillesCanvas, souris: m1 && m1.ok, save: s.ok, attente: att, nouveaux_fichiers: f.map((x) => x.f), toasts: ((await h.toasts()) || []).map((x) => x.text).slice(-3), erreurs_journal: l.erreursDepuis(p0), duree_s: Math.round((Date.now() - t0) / 100) / 10 };
  if (f.length) { res.glb = l.validerGlb(f[0].p); res.chemin = f[0].p; res.ok = !!(res.glb.tex_couleur && res.glb.tex_couleur[0] >= 4096); }
  l.ligne(res); l.note('E6 paint : ' + JSON.stringify({ ok: res.ok, tex: res.glb && res.glb.tex_couleur, mr: res.glb && res.glb.tex_metal_rugosite, f: res.nouveaux_fichiers, toasts: res.toasts, canvases: taillesCanvas }));
  await l.fermerModales();
}
