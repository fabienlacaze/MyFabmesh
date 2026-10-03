// E4 : outils de maillage sur le maillage texture de 515 K faces (verif_t80) : Smooth, Triangle count 1000, Watertight, Fix normals.
// Usage : node t80_e4.mjs smooth,tri,water,fix
import * as l from './t80_lib.mjs';
const h = l.h;
const quoi = (process.argv[2] || 'smooth').split(',');
const BASE = l.MESHES + '/verif_t80_trellis2_native_1791025300001.glb';

async function essai(nom, bouton, champs, notes) {
  if (l.stop()) { l.note('STOP present : arret'); return null; }
  await l.fermerModales();
  await l.ouvrirProjet('verif_t80');
  const pc = await l.puce('step-card-mesh', 'v0'); if (!pc.ok) { l.note('puce v0 : ' + pc.error); }
  const p0 = l.pos(); const t0 = Date.now();
  const o = await h.clic(bouton); await l.dormir(3200);
  if (!o.ok) { l.ligne({ id: 'E4', nom, ok: false, erreur: 'ouverture ' + JSON.stringify(o).slice(0, 160) }); return null; }
  if (champs) { const f = await h.remplir(champs); if (f && f.ok === false) l.note('remplir: ' + JSON.stringify(f).slice(0, 160)); await l.dormir(2500); }
  const m = await h.modale(); const lectures = await l.eval_('return (document.querySelector("#modal-mesh-tool")||document.body).innerText.split(String.fromCharCode(10)).join(" | ").slice(0,500)');
  await h.shot('t80_e4_' + nom + '_modale');
  const a = await h.clic('mt-apply');
  await l.modalesApresLancement();
  const att = await l.attendre(900000);
  await l.dormir(1500);
  const f = l.fichiersApres(t0).filter((x) => !/_thumb|\.meta/.test(x.f));
  const toasts = await h.toasts();
  const res = { id: 'E4', nom, ok: !!(a.ok && f.length), duree_s: Math.round((Date.now() - t0) / 100) / 10, attente: att, fichiers: f.map((x) => x.f), lectures, erreurs_journal: l.erreursDepuis(p0), toasts: (toasts || []).map((x) => x.text).slice(-3) };
  if (f.length) { res.glb = l.validerGlb(f[0].p); res.geom = l.validerGeom(f[0].p); res.chemin = f[0].p; }
  await h.shot('t80_e4_' + nom + '_fin');
  l.ligne(res);
  l.note(nom + ' : ' + JSON.stringify({ ok: res.ok, s: res.duree_s, f: res.fichiers, faces: res.glb && res.glb.faces, tex: res.glb && res.glb.tex_couleur, compo: res.geom && res.geom.composantes, bord: res.geom && res.geom.aretes_bord, err: res.erreurs_journal.slice(0, 2) }));
  await l.fermerModales();
  return res;
}
if (quoi.includes('base')) { const b = l.validerGlb(BASE); const g = l.validerGeom(BASE); l.ligne({ id: 'E4', nom: 'base', glb: b, geom: g }); console.log(JSON.stringify({ b, g })); }
if (quoi.includes('smooth')) await essai('smooth_defaut', 'ws-mesh-smooth-btn', null, 'Smooth par defaut');
if (quoi.includes('tri')) await essai('triangle_1000', 'ws-mesh-decimate-btn', { '#modal-mesh-tool input.fen-valeur': 1000 }, 'Triangle count 1000');
if (quoi.includes('water')) await essai('watertight', 'ws-mesh-watertight-btn', null, 'Watertight');
if (quoi.includes('fix')) await essai('fix_normals', 'ws-mesh-fixnormals-btn', null, 'Fix normals');
