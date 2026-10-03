// E2b : preuve de la resolution de Blender a la demande. On efface blenderPath de la config (cle prevue : chaine vide), puis on relit get-config
// SANS redemarrer : avant le correctif, getConfig rendait '' et les boutons Blender restaient grises ; apres, le chemin est resolu et les boutons sont actifs.
import * as l from './t80_lib.mjs';
import { readFileSync } from 'node:fs';
const lireCfg = () => { try { return JSON.parse(readFileSync(l.REPO + '/config.json', 'utf8')).blenderPath; } catch (e) { return 'illisible'; } };
const avant = lireCfg();
const eff = await l.eval_('const r = await window.meshyAPI.setConfig({blenderPath: ""}); return JSON.stringify(r)');
const disque1 = lireCfg();
const lu = await l.eval_('const c = await window.meshyAPI.getConfig(); return JSON.stringify({bp: c.blenderPath||""})');
await l.eval_('await window._applyBlenderToolState(); return 1');
await l.dormir(800);
const etat = await l.eval_('return JSON.stringify(["ws-mesh-blender-btn","ws-rig-blender-btn","ws-rig-unreal-btn"].map(id=>{const e=document.getElementById(id);return [id,e.disabled]}))');
const disque2 = lireCfg();
console.log(JSON.stringify({ avant, eff, disque1, lu, etat, disque2 }, null, 1));
