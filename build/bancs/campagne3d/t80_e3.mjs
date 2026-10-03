// E3 : libelles et paliers de qualite (generation + Re-texture), sans lancer de travail. Prerequis : t80_ouvrir.mjs
import * as l from './t80_lib.mjs';
const h = l.h;
const gen = await l.eval_('const s=document.getElementById("ws-trellis2-preset"); return JSON.stringify([...s.options].map(o=>o.value+"|"+o.textContent))');
const c = await h.clic('ws-mesh-trellis2-btn'); await l.dormir(2500);
const m = await h.modale();
const opts = await l.eval_('return JSON.stringify([...document.querySelectorAll("#modal-mesh-tool select")].map(s=>({id:s.id,opts:[...s.options].map(o=>o.value+"|"+o.textContent)})))');
await h.shot('t80_e3_retexture');
const textes = await l.eval_('return (document.querySelector("#modal-mesh-tool")||document.body).innerText.slice(0,600)');
await l.fermerModales();
const toasts = await h.toasts();
const trouve = (s) => /12 steps|imgRes|image res/i.test(s);
console.log(JSON.stringify({ gen: JSON.parse(gen), clic: c.ok, modales: (m.data || []).map((x) => x.id), opts, textes, toasts, douze_ou_imgres: trouve(gen + opts + textes) }, null, 1));
