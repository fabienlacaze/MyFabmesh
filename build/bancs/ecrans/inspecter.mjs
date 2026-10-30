// Banc des ecrans, outil de DEBUG : ouvre une fenetre d'outil a une taille donnee et rend la structure et les styles CALCULES d'un selecteur.
// BANC_BASE, BANC_W, BANC_H, BANC_ID (bouton a cliquer, ex. ws-modify-btn), BANC_SEL (selecteur a inspecter, ex. « .modal:not(.hidden) .modal-actions »).
import capture from './capture.mjs';
export default async function run(page) {
  process.env.BANC_IDS = '__aucun__';
  const W = +process.env.BANC_W, H = +process.env.BANC_H, BASE = process.env.BANC_BASE;
  await page.setViewportSize({ width: W, height: H });
  await page.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: /\/api\/me/.test(r.request().url()) ? '{"ok":true,"user":{"id":"u","email":"t@t","credits":15}}' : '{"ok":true,"projects":[]}' }));
  await page.goto(BASE + '/app/', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(3500);
  const T = BASE + '/app/t/';
  await page.addScriptTag({ content: `(function(){ const p={ name:'Essai', assetType:'character', previewMeshPath:'${T}mesh.glb', selectedMeshPath:'${T}mesh.glb', images:[{path:'${T}img.png',url:'${T}img.png',filename:'img.png',name:'img.png'}], meshes:[{path:'${T}mesh.glb',url:'${T}mesh.glb',filename:'mesh.glb',name:'mesh.glb'}], rigs:[], animations:[] }; window.state.projects=[p]; window.openProject(p); })();` });
  await page.waitForTimeout(5000);
  await page.evaluate((i) => { const e = document.getElementById(i); for (let p = e; p; p = p.parentElement) { if (p.classList && p.classList.contains('collapsed')) p.classList.remove('collapsed'); if (p.tagName === 'DETAILS') p.open = true; } e.click(); }, process.env.BANC_ID);
  await page.waitForTimeout(2500);
  return await page.evaluate((sel) => {
    const e = document.querySelector(sel); if (!e) return 'introuvable';
    const st = (x) => { const c = getComputedStyle(x), r = x.getBoundingClientRect(); return { tag: x.tagName, id: x.id, cls: String(x.className).slice(0, 60), texte: (x.textContent || '').trim().slice(0, 30), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), display: c.display, flex: c.flex, flexWrap: c.flexWrap, flexDir: c.flexDirection, width: c.width, minWidth: c.minWidth, justify: c.justifyContent }; };
    return { conteneur: st(e), enfants: [...e.children].map(st) };
  }, process.env.BANC_SEL);
}
