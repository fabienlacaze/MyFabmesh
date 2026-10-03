// E1 (demarrage sain) + E2 (Blender resolu, boutons non grises) de la verification des correctifs, 2026-10-03.
import * as l from './t80_lib.mjs';
const h = l.h;
const p0 = { r: 0, s: 0 };
// ---- E1
l.note('E1 : journaux depuis le demarrage');
let errs = l.erreursDepuis(p0).filter((x) => !/SyntaxError: Invalid regular expression/.test(x));   // celle-ci vient d'un eval de sonde du banc, pas de l'appli
const fenetres = {};
for (const [nom, btn, fermer] of [['settings', 'btn-settings'], ['marketplace', 'topbar-market'], ['more', 'btn-topbar-more']]) {
  const before = l.pos();
  const c = await h.clic(btn); await l.dormir(2500);
  const m = (await h.modale()).data || [];
  fenetres[nom] = { clic: c.ok, modales: m.map((x) => x.id + ':' + String(x.titre || '').slice(0, 40)) };
  if (nom === 'settings') {
    const cfg = await l.eval_('const c = await window.meshyAPI.getConfig(); return JSON.stringify({blenderPath: c.blenderPath})');
    fenetres[nom].cfg = cfg;
    const bl = await l.eval_('const e=document.getElementById("set-blender-path")||document.querySelector("[id*=blender]"); return e? e.id+"="+e.value : "absent"');
    fenetres[nom].champBlender = bl;
    await h.shot('t80_e1_settings');
  } else await h.shot('t80_e1_' + nom);
  await l.fermerModales();
  // "More" est un menu, pas une modale : echap
  await h.api('POST', '/ui/key', { key: 'Escape' }).catch(() => {});
  await l.dormir(600);
  fenetres[nom].erreurs = l.erreursDepuis(before);
}
console.log(JSON.stringify({ errs, fenetres }, null, 1));
