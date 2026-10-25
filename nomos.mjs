import { chargerMoteur, chargerRig } from 'file:///C:/tmp/banc_visuel/lib.mjs';
const [mot, rig, esp, al] = process.argv.slice(2);
const M = await chargerMoteur(mot); const r = await chargerRig(rig); const sq = M.charger(r.buf);
const c = M.animerAllureSure(sq, al, 2, 30, 'normal', 'auto', esp);
const par = sq.par; const dep = j => { let d = 0; for (let k = j; k >= 0; k = par[k]) d++; return d; };
const i = c.infos; console.log(JSON.stringify({ os: i.acoup_os, prof: dep(i.acoup_os), img: i.acoup_image, deg: i.acoups_max_deg, nom: sq.noms?.[i.acoup_os], J: par.length }));
