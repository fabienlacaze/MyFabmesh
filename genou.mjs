import { calculer } from 'file:///C:/tmp/banc_visuel/lib.mjs';
const [mot, rig, esp, al] = process.argv.slice(2);
const r = await calculer({ rig, espece: esp, allure: al, moteur: mot, N: 32, maille: false });
const sub=(a,b)=>a.map((v,i)=>v-b[i]); const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0); const nn=a=>Math.hypot(...a);
for (const p of r.pattes) {
  const ch = p.chaine; const res=[];
  for (let a=1;a<ch.length-1;a++){ const ang=r.cadres.map(c=>{const u=sub(c.P[ch[a]],c.P[ch[a-1]]),v=sub(c.P[ch[a+1]],c.P[ch[a]]);return Math.acos(Math.max(-1,Math.min(1,dot(u,v)/(nn(u)*nn(v)+1e-12))))*180/Math.PI;});
    res.push(`j${a}:${Math.min(...ang).toFixed(0)}-${Math.max(...ang).toFixed(0)}`);}
  console.log('patte cote', p.cote, res.join(' '));
}
console.log(JSON.stringify(r.infos));
