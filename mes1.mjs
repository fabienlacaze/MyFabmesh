import { chargerMoteur, chargerRig } from 'file:///C:/tmp/banc_visuel/lib.mjs';
const [mot, rig, esp, al] = process.argv.slice(2);
const M = await chargerMoteur(mot); const r = await chargerRig(rig);
for (const a of al.split(',')) {
  const sq = M.charger(r.buf); const pas = !!M.ALLURES[a].pas;
  const c = M.animerAllureSure(sq, a, pas?2:1, 30, 'normal', 'auto', esp); const i = c.infos;
  const ys=sq.P0.map(p=>p[1]); const H=Math.max(...ys)-Math.min(...ys);
  console.log(`${rig}/${esp} ${a} S/H ${(i.foulee/H).toFixed(2)} v/H ${(i.foulee/H/i.periode).toFixed(2)} cad ${(120/i.periode).toFixed(0)} acoup ${i.acoups_max_deg} sol ${i.sous_sol_pct}% gliss ${i.glissement_appui_pct}%`);
}
