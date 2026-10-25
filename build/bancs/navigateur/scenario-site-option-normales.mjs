// Banc NAVIGATEUR du SITE : case « Game-engine relief (normal map) » -> corps multipart REELLEMENT envoye a /api/generate (2026-10-18).
// Page reelle (cloud/public/app) et VRAI shim meshyAPI-cloud.js, vrai Chromium sans tete. L'API du worker est SIMULEE par page.route ; three.js est servi
// depuis les copies du depot (jamais depuis unpkg) ; tout autre reseau externe est coupe. Aucune connexion a un compte, aucun credit.
//   node build/bancs/navigateur/serveur-statique.mjs cloud/public 8772 index.html          (en arriere-plan)
//   node ~/.claude/skills/browser-automation/browser.mjs http://127.0.0.1:8772/app/ --script build/bancs/navigateur/scenario-site-option-normales.mjs
// Le resultat imprime { verdict: { ok, echecs: [...] }, ... } : ok doit valoir true. Port : variable BANC_PORT (8772 par defaut).
// PIEGES MESURES : les modules three/addons servis hors origine exigent l'en-tete CORS (sans lui, tout le graphe de index2.js echoue et window.state
// reste indefini) ; SimplifyModifier n'existe pas dans src/renderer/lib (stub) ; Playwright check() expire dans ce workspace (voir le banc du bureau).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = process.env.BANC_PORT || '8772';
const ORIGINE = 'http://127.0.0.1:' + PORT;
const DEPOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

async function main(page, code) {
  const id = 'r' + Math.random().toString(36).slice(2);
  await page.addScriptTag({ content: `(async () => { let out; try { out = await (async () => { ${code} })(); } catch (e) { out = { error: String(e && e.stack || e) }; } document.documentElement.setAttribute('data-${id}', JSON.stringify(out === undefined ? null : out)); })();` });
  await page.waitForFunction((a) => document.documentElement.hasAttribute(a), 'data-' + id, { timeout: 20000 });
  const v = await page.evaluate((a) => document.documentElement.getAttribute(a), 'data-' + id);
  return JSON.parse(v);
}

export default async function run(page) {
  const out = {};
  try { return await corps(page, out); } catch (e) { out.verdict = { ok: false, echecs: ['exception du banc : ' + String((e && e.message) || e).split('\n')[0]] }; return out; }
}

async function corps(page, out) {
  const echecs = [];
  const attendre = (nom, cond) => { if (!cond) echecs.push(nom); };
  const generations = [];      // corps des POST /api/generate
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const json = (route, o, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    // three.js depuis le depot : unpkg est intercepte (jamais de reseau externe)
    if (url.hostname === 'unpkg.com' && url.pathname.includes('three@0.170.0')) {
      const rel = url.pathname.split('three@0.170.0/')[1];
      const local = rel === 'build/three.module.js'
        ? path.join(DEPOT, 'cloud', 'public', 'app', 'lib', 'three.module.js')
        : path.join(DEPOT, 'src', 'renderer', 'lib', rel.replace('examples/jsm/', ''));
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
    if (p === '/api/meshes') return json(route, { meshes: [] });
    if (p === '/api/projects') return json(route, { projects: [] });
    if (p === '/api/generate' && req.method() === 'POST') {
      const brut = req.postDataBuffer();
      generations.push(brut ? brut.toString('latin1') : '');
      return json(route, { jobId: 'modal_test0001', creditsRemaining: 480 });
    }
    if (p.startsWith('/api/jobs/')) return json(route, { status: 'processing' });
    return json(route, {});
  });
  const diag = { erreursPage: [] };
  page.on('pageerror', (e) => diag.erreursPage.push(String((e && e.message) || e).slice(0, 300)));
  out.diag = diag;
  await page.reload();
  await page.waitForTimeout(5000);

  out.ouverture = await main(page, `
    const ok = typeof window.openProjectByName === 'function' ? await window.openProjectByName('orc') : 'openProjectByName absent';
    await new Promise(r => setTimeout(r, 1500));
    return { ok, projet: window.state && window.state.currentProject && window.state.currentProject.name };`);
  attendre('le projet de test s ouvre', out.ouverture.projet === 'orc');          // openProjectByName du site ne rend pas de booleen
  out.panneau = await main(page, `
    const carte = document.getElementById('step-card-mesh'); if (carte) carte.classList.remove('collapsed', 'disabled');
    const det = document.getElementById('ws-3d-trellis2-opts'); if (det) det.open = true;
    const cb = document.getElementById('ws-trellis2-normal-map');
    if (!cb) return { existe: false };
    const r = cb.getBoundingClientRect();
    return { existe: true, cocheeAuDepart: cb.checked, libelle: cb.closest('label').innerText.trim(), visible: r.width > 0 && r.height > 0 };`);
  attendre('la case existe, decochee, visible', out.panneau.existe && out.panneau.cocheeAuDepart === false && out.panneau.visible);
  attendre('libelle', out.panneau.libelle === 'Game-engine relief (normal map)');

  const lancer = async () => {
    const avant = generations.length;
    await main(page, `document.getElementById('ws-generate-mesh').disabled = false; return true;`);
    await page.locator('#ws-generate-mesh').click({ force: true });
    for (let i = 0; i < 30 && generations.length === avant; i++) await page.waitForTimeout(300);
    await page.waitForTimeout(800);
    await main(page, `for (const id of ['modal-confirm', 'modal-job-details']) { const m = document.getElementById(id); if (m && !m.classList.contains('hidden')) { const b = id === 'modal-confirm' ? document.getElementById('confirm-ok') : document.getElementById('job-details-close-x'); if (b) b.click(); await new Promise(r => setTimeout(r, 400)); } } return true;`);
    return generations.length > avant ? generations[generations.length - 1] : null;
  };
  const champ = (corpsHttp, nom) => {
    if (corpsHttp == null) return 'aucun envoi';
    const m = corpsHttp.match(new RegExp('name="' + nom + '"\\r?\\n\\r?\\n([^\\r\\n]*)'));
    return m ? m[1] : null;
  };

  // 1) sans toucher la case
  const c1 = await lancer();
  out.sans_toucher = { envoi: c1 != null, normal_map: champ(c1, 'normal_map'), preset: champ(c1, 'preset'), asset_type: champ(c1, 'asset_type'), ultra_q: champ(c1, 'ultra_q') };
  attendre('sans toucher : un envoi, normal_map = false', out.sans_toucher.envoi && out.sans_toucher.normal_map === 'false');

  // 2) vrai clic de souris sur la case
  const viser = async () => main(page, `const cb = document.getElementById('ws-trellis2-normal-map'); cb.scrollIntoView({ block: 'center' }); await new Promise(r => setTimeout(r, 600));
    const r = cb.getBoundingClientRect(); const x = r.x + r.width / 2, y = r.y + r.height / 2; const e = document.elementFromPoint(x, y);
    return { x, y, estLaCase: !!e && (e === cb || cb.contains(e) || e.contains(cb)), dessus: e ? e.tagName + '#' + e.id : null };`);
  const cible = await viser();
  await page.mouse.click(cible.x, cible.y);
  await page.waitForTimeout(300);
  out.clic = { sousLePointeur: cible.estLaCase, dessus: cible.dessus, cochee: await page.locator('#ws-trellis2-normal-map').isChecked() };
  attendre('le clic atteint la case et la coche', cible.estLaCase && out.clic.cochee === true);
  const c2 = await lancer();
  out.case_cochee = { envoi: c2 != null, normal_map: champ(c2, 'normal_map'), preset: champ(c2, 'preset') };
  attendre('case cochee : un envoi, normal_map = true', out.case_cochee.envoi && out.case_cochee.normal_map === 'true');

  // 3) decocher par le libelle, regenerer
  await viser();
  await page.locator('label:has(#ws-trellis2-normal-map)').click({ timeout: 6000 }).catch((e) => { out.libelleErreur = String(e.message || e).slice(0, 200); });
  out.decoche_par_le_libelle = { cochee: await page.locator('#ws-trellis2-normal-map').isChecked() };
  attendre('le libelle decoche la case', out.decoche_par_le_libelle.cochee === false);
  const c3 = await lancer();
  out.case_decochee = { envoi: c3 != null, normal_map: champ(c3, 'normal_map') };
  attendre('case decochee : un envoi, normal_map = false', out.case_decochee.envoi && out.case_decochee.normal_map === 'false');

  // 4) traduction
  out.fr = await main(page, `window.FabI18n.applyLang('fr'); await new Promise(r => setTimeout(r, 900));
    const l = document.getElementById('ws-trellis2-normal-map').closest('label'); const r = { libelle: l.innerText.trim(), infobulle: l.title.slice(0, 60) };
    window.FabI18n.applyLang('en'); return r;`);
  attendre('libelle traduit en francais', out.fr.libelle === 'Relief pour moteur de jeu (carte de normales)');
  attendre('infobulle traduite en francais', out.fr.infobulle.startsWith('Ajoute une carte de normales'));
  attendre('aucune erreur de page', diag.erreursPage.length === 0);
  out.champs_du_dernier_envoi = c3 ? [...c3.matchAll(/name="([^"]+)"/g)].map((m) => m[1]) : null;
  out.verdict = { ok: echecs.length === 0, echecs };
  return out;
}
