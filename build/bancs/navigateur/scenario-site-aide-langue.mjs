// Banc NAVIGATEUR du SITE : l'aide de langue est VISIBLE sous chaque champ de prompt, en fr, en, zh et ar (RTL), sans etre coupee (2026-10-24, chantier B).
// Page reelle (copie de cloud/public) et vrai Chromium sans tete ; l'API du worker est SIMULEE par page.route ; three.js est servi depuis le depot ; aucun reseau externe.
//   node build/bancs/navigateur/serveur-statique.mjs <COPIE de cloud/public> 8781 index.html    (jamais cloud/out lui-meme)
//   BANC_PORT=8781 node ~/.claude/skills/browser-automation/browser.mjs http://127.0.0.1:8781/app/ --script build/bancs/navigateur/scenario-site-aide-langue.mjs
// Sortie : { verdict: { ok, echecs }, mesures } ; captures sous CAPTURES (variable, dossier du rapport par defaut).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = process.env.BANC_PORT || '8781';
const ORIGINE = 'http://127.0.0.1:' + PORT;
const DEPOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CAPTURES = process.env.CAPTURES || 'C:/Users/Utilisateur/Documents/MyFabmesh_corrections_prompts_2026-10-24/captures_aide';
const MODALES = ['modal-new-project', 'modal-auto-inpaint', 'modal-recolor', 'modal-age', 'modal-refine-mesh', 'modal-modify-image'];
const CHAMPS = { 'modal-new-project': 'np-prompt', 'modal-auto-inpaint': 'ai-target', 'modal-recolor': 'rc-prompt', 'modal-age': 'age-guide', 'modal-refine-mesh': 'rfn-prompt', 'modal-modify-image': 'mod-prompt' };

async function main(page, code) {
  const id = 'r' + Math.random().toString(36).slice(2);
  await page.addScriptTag({ content: `(async () => { let out; try { out = await (async () => { ${code} })(); } catch (e) { out = { error: String(e && e.stack || e) }; } document.documentElement.setAttribute('data-${id}', JSON.stringify(out === undefined ? null : out)); })();` });
  await page.waitForFunction((a) => document.documentElement.hasAttribute(a), 'data-' + id, { timeout: 20000 });
  const v = await page.evaluate((a) => document.documentElement.getAttribute(a), 'data-' + id);
  return JSON.parse(v);
}

export default async function run(page) {
  const out = { mesures: {} };
  const echecs = [];
  try { await corps(page, out, echecs); } catch (e) { echecs.push('exception du banc : ' + String((e && e.message) || e).split('\n')[0]); }
  out.verdict = { ok: echecs.length === 0, echecs };
  return out;
}

async function corps(page, out, echecs) {
  fs.mkdirSync(CAPTURES, { recursive: true });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const json = (route, o, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.hostname === 'unpkg.com' && url.pathname.includes('three@0.170.0')) {
      const rel = url.pathname.split('three@0.170.0/')[1];
      const local = rel === 'build/three.module.js' ? path.join(DEPOT, 'cloud', 'public', 'app', 'lib', 'three.module.js') : path.join(DEPOT, 'src', 'renderer', 'lib', rel.replace('examples/jsm/', ''));
      const entetes = { 'access-control-allow-origin': '*' };
      if (rel.endsWith('modifiers/SimplifyModifier.js')) return route.fulfill({ status: 200, contentType: 'text/javascript', headers: entetes, body: 'export class SimplifyModifier { modify(g) { return g; } }' });
      if (fs.existsSync(local)) return route.fulfill({ status: 200, contentType: 'text/javascript', headers: entetes, body: fs.readFileSync(local) });
      return route.abort();
    }
    if (url.origin !== ORIGINE) return route.abort();
    if (url.pathname === '/pixel.png') return route.fulfill({ status: 200, contentType: 'image/png', body: png });
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const p = url.pathname;
    if (p === '/api/me') return json(route, { user: { id: 'u1', email: 'test@example.com', credits: 500 }, credits: 500, email: 'test@example.com', id: 'u1' });
    if (p === '/api/cloud-projects') return json(route, { projects: [{ name: 'orc', path: 'orc', images: [ORIGINE + '/pixel.png'], imagesData: [], created: '2026-10-18T10:00:00Z', prompt: 'an orc warrior' }] });
    if (p === '/api/meshes' ) return json(route, { meshes: [] });
    if (p === '/api/projects') return json(route, { projects: [] });
    return json(route, {});
  });
  const erreursPage = [];
  page.on('pageerror', (e) => erreursPage.push(String((e && e.message) || e).slice(0, 300)));
  await page.reload();
  await page.waitForTimeout(5000);
  out.mesures.erreursPage = erreursPage;
  if (erreursPage.length) echecs.push('erreurs de page : ' + erreursPage.slice(0, 2).join(' | '));

  for (const lang of ['fr', 'en', 'zh', 'ar']) {
    const etat = await main(page, `
      if (window.FabI18n && window.FabI18n.applyLang) window.FabI18n.applyLang(${JSON.stringify(lang)});
      await new Promise(r => setTimeout(r, 400));
      const mod = (id) => document.getElementById(id);
      // toutes les modales listees sont rendues visibles tour a tour pour mesurer les aides qu'elles contiennent
      const res = { lang: document.documentElement.lang, dir: document.documentElement.dir, aides: [] };
      for (const el of document.querySelectorAll('.prompt-lang-hint')) {
        const modale = el.closest('.modal-overlay');
        if (modale) modale.classList.remove('hidden');
        const r = el.getBoundingClientRect();
        res.aides.push({ pour: el.dataset.pour, texte: el.textContent, visible: getComputedStyle(el).display !== 'none', largeur: Math.round(r.width), hauteur: Math.round(r.height),
          coupe: el.scrollWidth > el.clientWidth + 1, ellipse: getComputedStyle(el).textOverflow, espaces: getComputedStyle(el).whiteSpace, dir: getComputedStyle(el).direction });
        if (modale) modale.classList.add('hidden');
      }
      return res;`);
    out.mesures[lang] = etat;
    const vues = etat.aides.filter((a) => a.visible && a.texte);
    if (vues.length < 12) echecs.push(`${lang} : ${vues.length} aides visibles (12 attendues)`);
    for (const a of etat.aides) {
      if (!a.texte) echecs.push(`${lang} #${a.pour} : aide vide`);
      if (a.coupe) echecs.push(`${lang} #${a.pour} : texte coupe (scrollWidth > clientWidth)`);
      if (a.ellipse === 'ellipsis' || a.espaces === 'nowrap') echecs.push(`${lang} #${a.pour} : ellipse / nowrap`);
    }
    if (lang === 'ar' && etat.dir !== 'rtl') echecs.push('ar : page non RTL');
    const rfn = etat.aides.find((a) => a.pour === 'rfn-prompt');
    const mod = etat.aides.find((a) => a.pour === 'mod-prompt');
    if (rfn && mod && rfn.texte === mod.texte) echecs.push(`${lang} : le champ non traduit (rfn-prompt, outil bureau seul) dit la meme chose qu un champ traduit`);
    // captures : les modales ouvertes une a une
    for (const idm of MODALES) {
      await main(page, `
        for (const m of document.querySelectorAll('.modal-overlay')) m.classList.add('hidden');
        const m = document.getElementById(${JSON.stringify(idm)}); if (m) m.classList.remove('hidden');
        return true;`);
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(CAPTURES, `site_${lang}_${idm}.png`) });
    }
    await main(page, `for (const m of document.querySelectorAll('.modal-overlay')) m.classList.add('hidden'); return true;`);
  }
  // etat d'echec reel : le texte de l'aide est entier a 390 px (mobile), en arabe
  await page.setViewportSize({ width: 390, height: 800 });
  const mobile = await main(page, `
    window.FabI18n.applyLang('ar'); await new Promise(r => setTimeout(r, 300));
    const m = document.getElementById('modal-modify-image'); m.classList.remove('hidden');
    const el = m.querySelector('.prompt-lang-hint'); const r = el.getBoundingClientRect();
    return { texte: el.textContent, largeur: Math.round(r.width), coupe: el.scrollWidth > el.clientWidth + 1, debordePage: document.documentElement.scrollWidth > window.innerWidth + 1 };`);
  out.mesures.mobile_ar = mobile;
  if (mobile.coupe) echecs.push('ar 390 px : aide coupee');
  await page.screenshot({ path: path.join(CAPTURES, 'site_ar_390px_modal-modify-image.png') });
}
