import { chargerMoteur, chargerRig } from 'file:///C:/tmp/banc_visuel/lib.mjs';
const mot = process.argv[2];
const M = await chargerMoteur(mot);
const RG='C:/tmp/anim2_bipedes/rigs/'; const CAS = [['humain','humain'],['humain','primate'],[RG+'theropode.glb','dinosaure'],[RG+'kangourou.glb','kangourou'],[RG+'manchot.glb','manchot'],[RG+'oiseau2.glb','oiseau'],['oiseau','oiseau'],['poule','oiseau']];
const allures = (process.argv[3]||'walk,run,idle').split(',');
for (const [rig, esp] of CAS) {
  let r; try { r = await chargerRig(rig); } catch (e) { console.log(rig,'ABSENT'); continue; }
  for (const a of allures) {
    try {
      const sq = M.charger(r.buf);
      const pas = !!M.ALLURES[a].pas;
      const c = M.animerAllureSure(sq, a, pas?2:1, 30, 'normal', 'auto', esp);
      const i = c.infos; const ys=sq.P0.map(p=>p[1]); const H=Math.max(...ys)-Math.min(...ys);
      console.log(`${rig.replace(RG,'')}/${esp} ${a} T${i.periode} f${i.foulee} S/H ${(i.foulee/H).toFixed(2)} v/H ${(i.foulee/H/i.periode).toFixed(2)} cad ${(120/i.periode).toFixed(0)} v${i.vitesse??''} acoup ${i.acoups_max_deg} sol ${i.sous_sol_pct}% gliss ${i.glissement_appui_pct}% genou_env ${i.genoux_envers_pct??''} ferm ${i.fermeture_boucle_deg??''}`);
    } catch (e) { console.log(`${rig.replace(RG,'')}/${esp} ${a} ERREUR ${String(e.message).slice(0,100)}`); }
  }
}
