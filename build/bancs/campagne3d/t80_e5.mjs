// E5 : Export to Unreal d'un maillage RIGGE (le FBX doit contenir l'armature et ses os), puis export FBX d'un maillage SANS squelette (comme avant).
// Usage : node t80_e5.mjs rig,sans
import * as l from './t80_lib.mjs';
const h = l.h;
const quoi = (process.argv[2] || 'rig').split(',');
await l.fermerModales();
await l.ouvrirProjet('verif_t80');
if (quoi.includes('rig')) {
  const pc = await l.puce('step-card-rig', 'v0'); l.note('puce rig v0 ' + JSON.stringify(pc));
  const p0 = l.pos(); const t0 = Date.now();
  const c = await h.clic('ws-rig-unreal-btn'); l.note('clic unreal ' + JSON.stringify(c).slice(0, 120));
  await l.modalesApresLancement();
  const att = await l.attendre(1200000);
  await l.dormir(1500);
  const f = l.fichiersApres(t0, /\.fbx$/i);
  const toasts = await h.toasts(); const tab = await h.jobs();
  const res = { id: 'E5', nom: 'unreal_rig', ok: !!f.length, duree_s: Math.round((Date.now() - t0) / 100) / 10, attente: att, fichiers: f.map((x) => x.f + ' ' + x.taille), erreurs_journal: l.erreursDepuis(p0), toasts: (toasts || []).map((x) => x.text).slice(-3), jobs: (tab || []).map((x) => (x.name || '') + ':' + (x.status || '')).slice(-3) };
  if (f.length) { res.fbx = l.validerFbx(f[0].p); res.chemin = f[0].p; }
  l.ligne(res); l.note('E5 rig : ' + JSON.stringify({ ok: res.ok, s: res.duree_s, f: res.fichiers, fbx: res.fbx, err: res.erreurs_journal.slice(0, 2), toasts: res.toasts }));
  await l.fermerModales();
}
if (quoi.includes('sans')) {
  const r = await h.api('GET', '/ui/catalog?all=1&limit=2000&zone=step-card-mesh');
  const els = (r.data && r.data.elements) || [];
  const e = els.find((x) => /^v\d+$/.test((x.label || '').trim().split(/\s+/)[0]) && /decimate/.test(x.title || ''));
  l.note('puce decimate : ' + JSON.stringify(e && [e.ref, e.label, e.title]));
  if (e) { await h.clic(e.ref); await l.dormir(1500); }
  const p0 = l.pos(); const t0 = Date.now();
  const o = await h.clic('ws-mesh-export-btn'); await l.dormir(2000);
  const f1 = await h.remplir({ '#exp-format': 'fbx' }); await l.dormir(800);
  await h.shot('t80_e5_export_modale');
  const g = await h.clic('exp-go');
  await l.modalesApresLancement();
  const att = await l.attendre(600000);
  await l.dormir(1500);
  const f = l.fichiersApres(t0, /\.fbx$/i);
  const res = { id: 'E5', nom: 'fbx_sans_squelette', ok: !!f.length, ouv: o.ok, fmt: f1, go: g.ok, duree_s: Math.round((Date.now() - t0) / 100) / 10, attente: att, fichiers: f.map((x) => x.f + ' ' + x.taille), erreurs_journal: l.erreursDepuis(p0), toasts: ((await h.toasts()) || []).map((x) => x.text).slice(-3) };
  if (f.length) { res.fbx = l.validerFbx(f[0].p); res.chemin = f[0].p; }
  l.ligne(res); l.note('E5 sans : ' + JSON.stringify({ ok: res.ok, s: res.duree_s, f: res.fichiers, fbx: res.fbx, err: res.erreurs_journal.slice(0, 2), toasts: res.toasts }));
  await l.fermerModales();
}
