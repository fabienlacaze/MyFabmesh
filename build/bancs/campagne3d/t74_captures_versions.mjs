// Apres la campagne : previsualise chaque version creee par les outils (puces v6, v7, ...) et capture le visualiseur 3D, pour juger le RESULTAT (la capture prise pendant l'essai montre encore la version de depart).
import * as h from './h.mjs';
import { writeFileSync } from 'node:fs';
await h.clic('back-to-projects').catch(() => {}); await h.dormir(1500); await h.clic('texte:chevalier_medieval').catch(() => {}); await h.dormir(3500);
// le panneau « Task failed » (modal-job-details) et les fenetres restees ouvertes masquent le visualiseur : on les ferme avant de capturer
for (let i = 0; i < 4; i++) {
  const m = await h.modale(); const l = (m.data || []); if (!l.length) break;
  for (const x of l) { let r = await h.clic({ text: 'Réduire', within: x.id }); if (!r.ok) r = await h.clic({ text: 'Cancel', within: x.id }); if (!r.ok) r = await h.clic({ text: 'OK', within: x.id }); if (!r.ok) r = await h.clic({ text: 'Close', within: x.id }); await h.dormir(500); }
  await h.api('POST', '/ui/key', { key: 'Escape' }); await h.dormir(800);
}
console.log('fenetres restantes :', JSON.stringify(((await h.modale()).data || []).map((x) => x.id)));
const lire = async () => { const r = await h.evalue('const p=window.state.currentProject; return JSON.stringify({meshes:(p.meshes||[]).map(x=>typeof x==="string"?x:(x.path||x.url||"")), prev:p.previewMeshPath||""})'); return JSON.parse(r.data); };
let e = await lire(); const n = e.meshes.length; console.log('versions :', n);
const sortie = [];
for (let i = 4; i < n; i++) {
  const chemin = e.meshes[n - 1 - i]; const nom = String(chemin).split('\\').pop().replace(/\.glb$/, '');
  const tag = nom.replace(/^chevalier_medieval_trellis2_native_\d+_?/, '') || 'base';
  let ok = false;
  for (let k = 0; k < 3 && !ok; k++) { await h.clic({ text: 'v' + i, within: 'step-card-mesh' }); await h.dormir(3500); const e2 = await lire(); ok = String(e2.prev).replace(/\\/g, '/') === String(chemin).replace(/\\/g, '/'); }
  // zoom : vue de face, puis capture
  const f = await h.shot('ver_' + String(i).padStart(2, '0') + '_' + tag.replace(/[^\w]+/g, '_').slice(0, 40), '#ws-mesh-canvas');
  console.log('v' + i, ok ? 'OK' : 'APERCU NON CHANGE', tag, f);
  sortie.push({ i, nom, tag, ok, capture: f });
}
writeFileSync('C:/tmp/campagne/captures_versions.json', JSON.stringify(sortie, null, 1));
console.log('fini');
