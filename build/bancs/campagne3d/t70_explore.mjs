// Exploration de l'etat du projet pour la campagne 3D (lecture seule, aucun outil lance)
import * as h from './h.mjs';
await h.clic('back-to-projects').catch(() => {}); await h.dormir(1500);
const r = await h.clic('texte:chevalier_medieval'); console.log('ouvrir', JSON.stringify(r).slice(0, 120)); await h.dormir(3500);
const k = await h.evalue('const p=window.state.currentProject; const m=(p.meshes||[]).map(x=>typeof x==="string"?x:(x.path||x.url||"")); return JSON.stringify({keys:Object.keys(p), name:p.name, nm:m.length, meshes:m.map(x=>x.split("\\\\").pop()), sel:p.selectedMeshPath||null, prev:p.previewMeshPath||null, stateKeys:Object.keys(window.state).slice(0,60)})');
console.log(String(k.data).slice(0, 2500));
const c = await h.catalogue('mesh'); console.log(JSON.stringify(c).slice(0, 1500));
