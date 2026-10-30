// Banc des ECRANS (30/10, demande du user : « un outil de test / debug pour valider les changements » de mise en page, sur telephone, tablette et PC).
// Script execute par le skill browser-automation (patchright) : pour UNE taille d'ecran, capture l'accueil, la fenetre New project, l'espace de
// travail d'un faux projet (image + maillage + rig) et chaque fenetre d'outil, et MESURE les defauts de mise en page. Lance par banc_ecrans.mjs.
// Variables : BANC_BASE (url du site servi), BANC_W / BANC_H (taille), BANC_OUT (dossier des captures), BANC_IDS (filtre facultatif, ids separes par des virgules).
import fs from 'node:fs';
const BASE = process.env.BANC_BASE, W = +process.env.BANC_W, H = +process.env.BANC_H, OUT = process.env.BANC_OUT;
const FILTRE = process.env.BANC_IDS ? process.env.BANC_IDS.split(',') : null;
// boutons d'outils ouverts un par un (liste du banc du 25-26/10, C:/tmp/rev_etroit) ; un id absent est note « absent », jamais une erreur
export const OUTILS = ['ws-modify-btn', 'ws-autoinpaint-btn', 'ws-removebg-btn', 'ws-resolution-btn', 'ws-style-btn', 'ws-facefix-btn', 'ws-outfit-btn', 'ws-symmetrize-auto-btn', 'ws-multiview-btn', 'ws-variant-btn', 'ws-recolor-btn', 'ws-age-btn',
  'ws-clone-btn', 'ws-mask-btn', 'ws-crop-btn', 'ws-select-btn', 'ws-extend-btn', 'ws-brightness-btn', 'ws-picker-btn', 'ws-blur-btn', 'ws-symmetrize-btn', 'ws-paint-btn',
  'ws-mesh-smooth-btn', 'ws-mesh-decimate-btn', 'ws-mesh-subdivide-btn', 'ws-mesh-fixnormals-btn', 'ws-mesh-fillholes-btn', 'ws-mesh-watertight-btn', 'ws-mesh-center-btn', 'ws-mesh-retexture-btn', 'ws-mesh-texvar-btn', 'ws-mesh-enhance-tex-btn',
  'ws-mesh-region-retex-btn', 'ws-mesh-reshape-btn', 'ws-mesh-segment-btn', 'ws-mesh-name-btn', 'ws-mesh-explode-btn', 'ws-mesh-sculpt-btn', 'ws-mesh-paintvert-btn', 'ws-mesh-selectface-btn', 'ws-mesh-clone3d-btn', 'ws-mesh-reshape-draw-btn',
  'ws-mesh-stages3d-btn', 'ws-mesh-resize-btn', 'ws-mesh-aligntex-btn', 'ws-mesh-symmetrize-btn', 'ws-mesh-paint-mesh-btn', 'ws-mesh-material-btn', 'ws-mesh-recolor-btn', 'ws-rig-reskin-btn', 'ws-rig-poids-btn', 'ws-rig-test-btn', 'ws-anim-gen-more-btn'];

// --- mesures (executees dans la page) : page entiere, puis fenetre ouverte s'il y en a une
const MESURE = `
const vis=(e)=>{const r=e.getBoundingClientRect();const cs=getComputedStyle(e);return r.width>0&&r.height>0&&cs.visibility!=='hidden'&&cs.display!=='none';};
const vw=innerWidth, vh=innerHeight, nom=(e)=>(e.id?'#'+e.id:(e.className&&typeof e.className==='string'&&e.className.trim()?'.'+e.className.trim().split(/\\s+/)[0]:e.tagName.toLowerCase()+(e.parentElement&&e.parentElement.id?' dans #'+e.parentElement.id:''))+((e.textContent||'').trim()?' «'+(e.textContent||'').trim().replace(/\\s+/g,' ').slice(0,24)+'»':''));
const r={ largeurPage: document.documentElement.scrollWidth, debordeH: document.documentElement.scrollWidth>vw+1, horsEcran:[], petits:[], fenetre:null };
// elements visibles qui sortent a droite (ou a gauche) de l'ecran, sans etre dans un conteneur qui defile horizontalement
const defileH=(e)=>{for(let p=e.parentElement;p;p=p.parentElement){const s=getComputedStyle(p);if((s.overflowX==='auto'||s.overflowX==='scroll')&&p.scrollWidth>p.clientWidth+1)return true;}return false;};
// 30/10 : element COUPE par un parent qui masque (overflow hidden / clip) : la barre des vues 3D l'etait sans etre vue par la mesure
r.coupes=[];
for (const p of document.querySelectorAll('body *')) {
  if (r.coupes.length>=8||!vis(p)) continue; const s=getComputedStyle(p);
  if (!(s.overflowX==='hidden'||s.overflowX==='clip')||p.scrollWidth<=p.clientWidth+2) continue;
  const pr=p.getBoundingClientRect(); if (pr.right<0||pr.left>vw||pr.bottom<0||pr.top>vh) continue;
  const enfant=[...p.querySelectorAll('button,a,input,select,span,label')].find((c)=>{if(!vis(c))return false;const b=c.getBoundingClientRect();return b.width>4&&(b.left<pr.left-2||b.right>pr.right+2);});
  if (enfant) r.coupes.push(nom(p)+' coupe '+nom(enfant));
}
for (const e of document.querySelectorAll('body *')) {
  if (!vis(e)) continue; const b=e.getBoundingClientRect();
  if ((b.right>vw+2||b.left<-2) && b.width<vw*3 && !defileH(e)) { if (r.horsEcran.length<8 && ![...e.children].some((c)=>vis(c)&&(c.getBoundingClientRect().right>vw+2))) r.horsEcran.push(nom(e)+' '+Math.round(b.left)+'..'+Math.round(b.right)); }
}
// cibles tactiles trop petites (< 32 px de cote) parmi les controles visibles DANS l'ecran (telephone et tablette seulement)
if (vw<1100) for (const e of document.querySelectorAll('button, a[href], input:not([type=hidden]), select, [role=button]')) {
  if (!vis(e)) continue; const b=e.getBoundingClientRect(); if (b.bottom<0||b.top>vh||b.right<0||b.left>vw) continue;
  if (Math.min(b.width,b.height)<32 && r.petits.length<12) r.petits.push(nom(e)+' '+Math.round(b.width)+'x'+Math.round(b.height));
}
for (const ov of document.querySelectorAll('.modal:not(.hidden), .modal-overlay:not(.hidden)')) {
  if (!vis(ov)) continue; const c=ov.querySelector('.modal-card, .fen-3d'); if(!c||!vis(c)) continue;
  const cr=c.getBoundingClientRect(); const pieds=[...c.querySelectorAll('.modal-actions')].filter(vis); const pied=pieds[pieds.length-1];
  let p=null; if (pied) { const pr=pied.getBoundingClientRect(); const bt=pied.querySelector('button')||pied; const q=bt.getBoundingClientRect(); const t=document.elementFromPoint(q.left+q.width/2,q.top+q.height/2);
    p={ visible: pr.top>=0&&pr.bottom<=vh+1, libre: !!(t&&(bt===t||bt.contains(t)||pied.contains(t))) }; }
  // titre recouvert (30/10 : les titres longs passaient sous la pastille du solde) : 5 points le long de la ligne du titre
  let titreRecouvert=null; const ti=[...c.querySelectorAll('h1,h2,h3')].filter(vis)[0];
  if (ti) { const tr=ti.getBoundingClientRect(); const rg=document.createRange(); rg.selectNodeContents(ti); const tx=rg.getBoundingClientRect();
    for (const f of [0.15,0.35,0.55,0.75,0.95]) { const x=tx.left+f*tx.width, y=tx.top+Math.min(tx.height,30)/2; const t=document.elementFromPoint(x,y);
      if (t && !(ti===t||ti.contains(t)||t.contains(ti))) { titreRecouvert=nom(t); break; } } }
  r.fenetre={ id: ov.id||'', carte:[Math.round(cr.left),Math.round(cr.top),Math.round(cr.right),Math.round(cr.bottom)], deborde: cr.right>vw+1||cr.left<-1, hauteurPlusQueEcran: cr.height>vh+1, pied:p, titreRecouvert };
  break;
}
return r;`;

async function main(page, code) {                               // evalue dans le monde principal de la page (page.evaluate est isole), resultat par attribut
  const id = 'r' + Math.random().toString(36).slice(2);
  await page.addScriptTag({ content: `(async()=>{ try { const v = await (async()=>{ ${code} })(); document.body.setAttribute('${id}', JSON.stringify(v===undefined?null:v)); } catch(e){ document.body.setAttribute('${id}', JSON.stringify({exception:String(e&&e.message||e)})); } })();` });
  for (let i = 0; i < 100; i++) { const v = await page.evaluate((k) => document.body.getAttribute(k), id); if (v !== null) return JSON.parse(v); await page.waitForTimeout(100); }
  return { timeout: true };
}
const fenetresOuvertes = (page) => main(page, `return [...document.querySelectorAll('.modal:not(.hidden), .modal-overlay:not(.hidden), [id^="lightbox"]:not(.hidden), #lm-fullscreen')].filter(e=>e.getBoundingClientRect().width>0).length`);

async function preparer(page) {
  await page.setViewportSize({ width: W, height: H });
  await page.route('**/api/**', (route) => {                     // faux serveur : un compte connecte, aucune donnee
    const u = route.request().url(), json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (/\/api\/proxy-image/.test(u)) {                         // l'appli passe les images par ce relais : on sert le fichier de test local
      const cible = decodeURIComponent((u.match(/url=([^&]+)/) || [])[1] || '').split('?')[0];
      const f = cible.startsWith(BASE + '/') && process.env.BANC_SITE ? process.env.BANC_SITE + '/' + cible.slice(BASE.length + 1) : null;
      try { return route.fulfill({ status: 200, contentType: /\.png$/i.test(f) ? 'image/png' : 'application/octet-stream', body: fs.readFileSync(f) }); } catch (_) { return route.fulfill({ status: 404, body: '' }); }
    }
    if (/\/api\/me(\?|$)/.test(u)) return json({ ok: true, authenticated: true, user: { id: 'u1', email: 'test@example.com', credits: 15 }, credits: 15 });
    if (/\/api\/pricing/.test(u)) return json({ ok: true, prices: {} });
    if (/\/api\/jobs\//.test(u)) return json({ status: 'processing', ok: true });
    return json({ ok: true, success: true, items: [], projects: [], meshes: [] });
  });
  await page.addInitScript(() => { try { localStorage.setItem('fabmesh_cookies_ok', '1'); localStorage.setItem('mfm-cookies', 'ok'); } catch (_) {} });
  await page.goto(BASE + '/app/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
}
async function ouvrirProjet(page) {
  const T = BASE + '/app/t/';
  await page.addScriptTag({ content: `(function(){ const p={ name:'Essai', assetType:'character', previewMeshPath:'${T}mesh.glb', selectedMeshPath:'${T}mesh.glb',
    images:[{path:'${T}img.png',url:'${T}img.png',filename:'img.png',name:'img.png'},{path:'${T}img2.png',url:'${T}img2.png',filename:'img2.png',name:'img2.png'}],
    meshes:[{path:'${T}mesh.glb',url:'${T}mesh.glb',filename:'mesh.glb',name:'mesh.glb'}], rigs:[{path:'${T}rig.glb',url:'${T}rig.glb',filename:'rig.glb',name:'rig.glb'}], animations:[] };
    window.state.projects=[p]; window.openProject(p); })();` });
  await page.waitForTimeout(6000);
}
async function fermerTout(page) {
  await page.keyboard.press('Escape'); await page.waitForTimeout(250);
  // seulement les boutons de fermeture DES FENETRES OUVERTES (un « -cancel » ailleurs dans la page annulait un travail et ouvrait une confirmation)
  await page.evaluate(() => {
    const ouvertes = [...document.querySelectorAll('.modal:not(.hidden), .modal-overlay:not(.hidden)')].filter((e) => e.getBoundingClientRect().width > 0);
    for (const o of ouvertes) for (const b of o.querySelectorAll('.settings-close-x, [id$="-close"], [id$="close-x"], [id$="-cancel"]')) { try { b.click(); } catch (_) {} }
  });
  await page.waitForTimeout(350);
  await fermerConfirmations(page);
}
// confirmation en travers (« Cancel calibration? », « Discard changes? ») : on garde l'etat (bouton « Keep… », sinon le premier bouton secondaire)
async function fermerConfirmations(page) {
  await page.evaluate(() => {
    for (const b of [...document.querySelectorAll('button')].filter((x) => x.getBoundingClientRect().width > 0 && /^(keep|garder|continue|no\b|non\b)/i.test(x.textContent.trim()))) { try { b.click(); } catch (_) {} }
  });
  await page.waitForTimeout(300);
}

export default async function run(page) {
  fs.mkdirSync(OUT, { recursive: true });
  const res = { taille: [W, H], ecrans: {} };
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e).slice(0, 200)));
  const capturer = async (nom, pleine = false) => {
    await page.screenshot({ path: `${OUT}/${nom}.png`, fullPage: pleine });
    res.ecrans[nom] = { ok: true, mesure: await main(page, MESURE) };
  };
  await preparer(page);
  await capturer('00-accueil');
  // fenetre New project
  await main(page, `const b=[...document.querySelectorAll('button,a')].find(e=>/new project/i.test(e.textContent)&&e.getBoundingClientRect().width>0); if(b) b.click(); return !!b;`);
  await page.waitForTimeout(1200);
  if (await fenetresOuvertes(page)) await capturer('01-new-project'); else res.ecrans['01-new-project'] = { ok: false, raison: 'bouton New project introuvable' };
  await fermerTout(page);
  await ouvrirProjet(page);
  await fermerConfirmations(page);
  await capturer('02-espace-de-travail');
  await capturer('03-espace-de-travail-page-entiere', true);
  for (const id of OUTILS.filter((i) => !FILTRE || FILTRE.includes(i))) {
    const nom = 'outil-' + id.replace(/^ws-|-btn$/g, '');
    try {
      const existe = await page.evaluate((i) => { const e = document.getElementById(i); if (!e) return false; for (let p = e; p; p = p.parentElement) { if (p.classList && p.classList.contains('collapsed')) p.classList.remove('collapsed'); if (p.tagName === 'DETAILS') p.open = true; } return true; }, id);
      if (!existe) { res.ecrans[nom] = { ok: false, raison: 'absent' }; continue; }
      await page.waitForTimeout(250);
      await page.evaluate((i) => document.getElementById(i).click(), id);
      await page.waitForTimeout(3000);
      if (await fenetresOuvertes(page)) await capturer(nom); else res.ecrans[nom] = { ok: false, raison: 'aucune fenetre' };
    } catch (e) { res.ecrans[nom] = { ok: false, raison: 'erreur ' + String(e).slice(0, 100) }; }
    await fermerTout(page);
    if (await fenetresOuvertes(page)) { await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(3500); await ouvrirProjet(page); }
  }
  res.erreurs_page = erreurs.slice(0, 20);
  fs.writeFileSync(`${OUT}/_bilan.json`, JSON.stringify(res, null, 1));
  return { taille: res.taille, ecrans: Object.keys(res.ecrans).length };
}
