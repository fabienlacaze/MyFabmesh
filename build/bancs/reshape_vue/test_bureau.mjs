// Essai en vrai navigateur de la page de BUREAU (src/renderer/index2.html servie telle quelle), avec une API meshyAPI simulee :
// etape 1 (visualiseur 3D du bureau, three r170 livre) puis etape 2, angles transmis a renderMeshFront / reshapeRegion.
// Rien du processus principal n'est lance : le rendu a plat (pyrender) est une image fixe, c'est la LOGIQUE DE LA FENETRE qui est essayee.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const jal = (m) => { try { appendFileSync(path.join(os.tmpdir(), 'reshape_bureau_progress.txt'), new Date().toISOString().slice(11, 19) + ' ' + m + String.fromCharCode(10)); } catch (_) {} };

const SORTIE = (process.env.R3D_SORTIE || 'C:/tmp/trellis_cloud/montages/').replace(/\/?$/, '/');
const P = 'reshape3d_bureau';
const PORT = 8798;

export default async function run(page, ui) {
  page.setDefaultTimeout(180000);
  mkdirSync(SORTIE, { recursive: true });
  await page.setViewportSize({ width: 1600, height: 900 });
  const preload = readFileSync(fileURLToPath(new URL('../../../src/main/preload.js', import.meta.url)), 'utf8');
  const corps = preload.slice(preload.indexOf('exposeInMainWorld'));
  const cles = [...corps.matchAll(/^  ([A-Za-z0-9_]+):/gm)].map((m) => m[1]);
  const erreurs = [];
  page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text().slice(0, 240)); });
  page.on('pageerror', (e) => erreurs.push('PAGEERROR ' + String(e).slice(0, 240)));

  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
  // image fixe 8x8 gris clair comme « rendu a plat »
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFklEQVR42mN8//8/AzYwjipHFRjQSgEAHfAD/2sGM0cAAAAASUVORK5CYII=';
  await page.addInitScript(({ cles, PORT, PNG }) => {
    const api = {};
    const journal = [];
    const noter = () => { document.documentElement.dataset.appels = JSON.stringify(journal); };
    for (const k of cles) api[k] = async () => null;
    api.listImageFolders = async () => [];
    api.listerProjetsVides = async () => [];
    api.listAnimations = async () => [];
    api.getProjectDisplayNames = async () => ({});
    api.listMeshes = async () => [{ filename: 'orc_trellis2_native_1791026496124.glb', path: `http://127.0.0.1:${PORT}/orc.glb`, size: 25e6, created: Date.now() - 1000, format: 'GLB', asset_type: 'character' }];
    api.readMeshFile = async (p) => { const r = await fetch(p); return await r.arrayBuffer(); };
    api.renderMeshFront = async (a) => {
      journal.push({ f: 'renderMeshFront', a }); noter();
      const yaw = Number(a.yaw || 0), pitch = Number(a.pitch || 0);
      return { ok: true, dataUrl: PNG, frontPath: 'C:/fake/front_' + yaw + '_' + pitch + '.png', vue: (yaw || pitch) ? { yaw, pitch, xmag: 0.6 } : null };
    };
    api.reshapeRegion = async (a) => { journal.push({ f: 'reshapeRegion', a: { ...a, maskDataUrl: String(a.maskDataUrl || '').slice(0, 30) } }); noter(); return { ok: false, error: 'essai : rien n est calcule' }; };
    api.segmentMask = async () => ({ success: false });
    api.gpuStatus = async () => ({ hasNvidia: true, name: 'essai', vramMB: 16000 });
    try { localStorage.setItem('fab-compute-mode', 'local'); } catch (_) {}
    api.getNsfwKeywords = async () => ['nude', 'nsfw'];
    api.checkProjectNsfw = async () => ({ nsfw: false });
    api.checkImagesNsfwTags = async () => [];
    api.batchCheckNsfw = async () => ({ results: {} });
    api.getParentalStatus = async () => ({ unrestricted: true });
    api.findLight = async () => null;
    api.getVersions = async () => [];
    // diagnostic : rejets et erreurs de la page, lisibles par le script (monde isole : on passe par le DOM)
    const rapporter = (type, m) => { try { const a = JSON.parse(document.documentElement.dataset.rejets || '[]'); a.push(type + ' ' + String(m).slice(0, 300)); document.documentElement.dataset.rejets = JSON.stringify(a.slice(-6)); } catch (_) {} };
    window.addEventListener('unhandledrejection', (e) => rapporter('rejet', e.reason && (e.reason.stack || e.reason)));
    window.addEventListener('error', (e) => rapporter('erreur', (e.message || '') + ' ' + (e.filename || '') + ':' + (e.lineno || '')));
    window.meshyAPI = api;
  }, { cles, PORT, PNG });

  const out = { erreurs };
  const texte = (id) => page.evaluate((i) => (document.getElementById(i)?.textContent || '').trim(), id);
  const visible = (id) => page.evaluate((i) => { const e = document.getElementById(i); return !!e && getComputedStyle(e).display !== 'none' && e.offsetParent !== null; }, id);
  const etat = async () => ({
    stage3d: await visible('rrx-3d-stage'), panel3d: await visible('rrx-3d-panel'), stagePlat: await visible('rrx-stage'),
    form: await visible('rrx-form'), useView: await visible('rrx-use-view'), changeView: await visible('rrx-change-view'),
    apply: await visible('rrx-apply'), info: await texte('rrx-3d-info'), nomVue: await texte('rrx-vue-nom'),
  });
  const appels = async () => JSON.parse(await page.evaluate(() => document.documentElement.dataset.appels || '[]'));
  const pause = (ms) => page.waitForTimeout(ms);
  const vueDeInfo = (s) => { const m = /\((-?[\d.]+)°, (-?[\d.]+)°\)/.exec(s); return m ? [Number(m[1]), Number(m[2])] : null; };

  jal('goto');
  await page.goto(`http://127.0.0.1:${PORT}/index2.html`, { waitUntil: 'domcontentloaded' });
  jal('goto fini');
  await pause(7000);
  out.corpsInitial = (await page.evaluate(() => document.body.innerText)).slice(0, 300).replace(/\s+/g, ' ');
  jal('boot'); await page.screenshot({ path: SORTIE + P + '_boot.png' }); jal('boot capture');
  try {
    await page.getByText('orc', { exact: false }).first().click({ timeout: 30000 });
  } catch (e) {
    out.clic_projet = 'ECHEC ' + String(e).slice(0, 120);
    out.rejets = JSON.parse(await page.evaluate(() => document.documentElement.dataset.rejets || '[]'));
    return out;
  }
  await page.waitForFunction(() => /triangles/.test(document.getElementById('ws-mesh-stats')?.textContent || ''), null, { timeout: 180000 });
  await pause(1500);
  out.maillage = await texte('ws-mesh-stats'); jal('maillage ' + out.maillage);

  await page.evaluate(() => document.getElementById('ws-mesh-reshape-btn').click());
  await page.waitForSelector('#rrx-3d-stage', { state: 'visible' });
  await page.waitForFunction(() => getComputedStyle(document.getElementById('rrx-3d-loading')).display === 'none', null, { timeout: 180000 });
  await pause(2500);
  jal('etape1'); out.etape1 = await etat();
  await page.screenshot({ path: SORTIE + P + '_e1_face.png' });

  const canvas = page.locator('#rrx-3d-canvas');
  const cadre = await canvas.boundingBox();
  await page.evaluate(() => document.querySelector('#rrx-3d-presets [data-rrx-yaw="180"]').click());
  await pause(1200);
  out.dos = { info: await texte('rrx-3d-info') };
  await canvas.screenshot({ path: SORTIE + P + '_e1_dos.png' });
  await page.evaluate(() => document.querySelector('#rrx-3d-presets [data-rrx-yaw="0"][data-rrx-pitch="0"]').click());
  await pause(800);
  const cx = cadre.x + cadre.width / 2, cy = cadre.y + cadre.height / 2;
  await page.mouse.move(cx, cy); await page.mouse.down();
  await page.mouse.move(cx + 140, cy - 50, { steps: 12 }); await page.mouse.move(cx + 230, cy - 80, { steps: 12 });
  await page.mouse.up();
  await pause(1200);
  out.orbite = { info: await texte('rrx-3d-info') };
  out.orbite.vue = vueDeInfo(out.orbite.info);
  await canvas.screenshot({ path: SORTIE + P + '_e1_orbite.png' });

  // etape 2
  await page.evaluate(() => document.getElementById('rrx-use-view').click());
  await page.waitForFunction(() => (document.getElementById('rrx-vue-nom')?.textContent || '').length > 0 && getComputedStyle(document.getElementById('rrx-loading')).display === 'none', null, { timeout: 60000 });
  await pause(500);
  jal('etape2'); out.etape2 = await etat();
  out.appels_apres_use = await appels();
  await page.screenshot({ path: SORTIE + P + '_e2.png' });

  // Change view puis retour : le visualiseur tourne encore (il avait ete arrete a l'etape 2) -> on bouge la camera et l'info suit
  await page.evaluate(() => document.getElementById('rrx-change-view').click());
  await pause(1200);
  out.retour = await etat();
  await page.evaluate(() => document.querySelector('#rrx-3d-presets [data-rrx-yaw="-90"]').click());
  await pause(1200);
  out.retour_gauche = await texte('rrx-3d-info');
  const marque = async () => { const b = await canvas.screenshot(); return b.length + ':' + b.subarray(200, 260).toString('hex'); };
  const a1 = await marque();
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx - 150, cy + 60, { steps: 10 }); await page.mouse.up();
  await pause(1500);
  const a2 = await marque();
  out.visualiseur_vivant_apres_retour = a1 !== a2;
  out.info_apres_glisser = await texte('rrx-3d-info');

  // Apply : la vue part dans reshapeRegion
  await page.evaluate(() => document.querySelector('#rrx-3d-presets [data-rrx-yaw="180"]').click());
  await pause(900);
  await page.evaluate(() => document.getElementById('rrx-use-view').click());
  await page.waitForFunction(() => (document.getElementById('rrx-vue-nom')?.textContent || '').length > 0 && getComputedStyle(document.getElementById('rrx-loading')).display === 'none', null, { timeout: 60000 });
  const b1 = await page.locator('#rrx-canvas').boundingBox();
  await page.mouse.move(b1.x + b1.width * 0.45, b1.y + b1.height * 0.4); await page.mouse.down();
  await page.mouse.move(b1.x + b1.width * 0.55, b1.y + b1.height * 0.5, { steps: 8 }); await page.mouse.up();
  await page.fill('#rrx-prompt', 'a crystal skull with two horns');
  await page.evaluate(() => document.getElementById('rrx-apply').click());
  await pause(3000);
  const ap = await appels();
  out.apply_dos = ap.filter((x) => x.f === 'reshapeRegion').map((x) => x.a);

  // la fenetre « Running task » et le bandeau d'echec (reponse simulee en erreur) recouvrent la page : on les ferme avant de rouvrir l'outil
  await page.evaluate(() => { for (const e of document.querySelectorAll('.modal-overlay, .modal')) if (e.id !== 'modal-region-retex') e.classList.add('hidden'); });
  await pause(300);
  // vue de face immediate : aucun champ vue
  await page.evaluate(() => document.getElementById('ws-mesh-reshape-btn').click());
  await page.waitForSelector('#rrx-3d-stage', { state: 'visible' });
  await page.waitForFunction(() => getComputedStyle(document.getElementById('rrx-3d-loading')).display === 'none', null, { timeout: 180000 });
  await pause(1500);
  await page.evaluate(() => document.getElementById('rrx-use-view').click());
  await page.waitForFunction(() => (document.getElementById('rrx-vue-nom')?.textContent || '').length > 0 && getComputedStyle(document.getElementById('rrx-loading')).display === 'none', null, { timeout: 60000 });
  const b2 = await page.locator('#rrx-canvas').boundingBox();
  await page.mouse.move(b2.x + b2.width * 0.45, b2.y + b2.height * 0.4); await page.mouse.down();
  await page.mouse.move(b2.x + b2.width * 0.55, b2.y + b2.height * 0.5, { steps: 8 }); await page.mouse.up();
  await page.fill('#rrx-prompt', 'a crystal skull with two horns');
  await page.evaluate(() => document.getElementById('rrx-apply').click());
  await pause(3000);
  const ap2 = await appels();
  out.apply_face = ap2.filter((x) => x.f === 'reshapeRegion').slice(1).map((x) => x.a);
  out.appels_render = ap2.filter((x) => x.f === 'renderMeshFront').map((x) => x.a);

  // « Re-texture a region » (fenetre a plat seule, comme avant) : pas d'etape 1
  out.erreurs = erreurs.slice(0, 20);
  writeFileSync(SORTIE + P + '_resultat.json', JSON.stringify(out, null, 2));
  return out;
}
