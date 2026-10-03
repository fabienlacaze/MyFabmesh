// E2 : etat des boutons Blender / Unreal / Export FBX avec un maillage ET un rig selectionnes. Prerequis : t80_ouvrir.mjs
import * as l from './t80_lib.mjs';
const h = l.h;
const cfg = await l.eval_('const c = await window.meshyAPI.getConfig(); return JSON.stringify({blenderPath: c.blenderPath, existe: !!c.blenderPath})');
const etat = await l.eval_('return JSON.stringify(["ws-mesh-blender-btn","ws-rig-blender-btn","ws-rig-unreal-btn","ws-anim-export-btn"].map(id=>{const e=document.getElementById(id);return {id, present:!!e, disabled:e?e.disabled:null, classDisabled:e?e.classList.contains("disabled"):null, title:e?(e.title||"").slice(0,60):null, visible:e?(e.offsetParent!==null):null}}))');
const flag = await l.eval_('return String(window._blenderConfigure)');
console.log(JSON.stringify({ cfg, flag, etat: JSON.parse(etat) }, null, 1));
// bouton d'export de maillage vers Unreal (le menu d'export) : chercher
const c = await h.catalogue('unreal');
console.log(JSON.stringify((c.data.elements || []).map((e) => [e.ref, e.label, e.zone, e.title && e.title.slice(0, 40)])));
const c2 = await h.catalogue('fbx');
console.log(JSON.stringify((c2.data.elements || []).map((e) => [e.ref, e.label, e.zone, e.title && e.title.slice(0, 40)])));
