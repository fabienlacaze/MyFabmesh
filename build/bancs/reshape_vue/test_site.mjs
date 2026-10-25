// Essai en vrai navigateur : « Reshape a region » du SITE (copie de cloud/public/app), etape 1 (visualiseur 3D) puis etape 2 (vue a plat).
// Lancer : node <skill>/browser.mjs about:blank --script build/bancs/reshape_vue/test_site.mjs   (serveur statique sur 8796)
import { brancher, SORTIE } from './mock.mjs';
import { writeFileSync } from 'node:fs';

const P = 'reshape3d_site';

export default async function run(page, ui) {
  page.setDefaultTimeout(180000);
  await page.setViewportSize({ width: 1600, height: 900 });
  const vus = [], captures = { uploads: [], reshape: [] };
  await brancher(page, { port: 8796, vus, captures, prefixe: P });
  const erreurs = [];
  page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text().slice(0, 240)); });
  page.on('pageerror', (e) => erreurs.push('PAGEERROR ' + String(e).slice(0, 240)));

  const out = { vues: [], erreurs };
  const texte = (id) => page.evaluate((i) => (document.getElementById(i)?.textContent || '').trim(), id);
  const visible = (id) => page.evaluate((i) => { const e = document.getElementById(i); return !!e && getComputedStyle(e).display !== 'none' && e.offsetParent !== null; }, id);
  const etat = async () => ({
    stage3d: await visible('rrx-3d-stage'), panel3d: await visible('rrx-3d-panel'), stagePlat: await visible('rrx-stage'),
    form: await visible('rrx-form'), useView: await visible('rrx-use-view'), changeView: await visible('rrx-change-view'),
    apply: await visible('rrx-apply'), info: await texte('rrx-3d-info'), nomVue: await texte('rrx-vue-nom'),
  });
  const pause = (ms) => page.waitForTimeout(ms);

  await page.goto('http://127.0.0.1:8796/app/index.html', { waitUntil: 'domcontentloaded' });
  await pause(6000);
  await page.getByText('orc', { exact: false }).first().click();
  await page.waitForFunction(() => /triangles/.test(document.getElementById('ws-mesh-stats')?.textContent || ''), null, { timeout: 180000 });
  await pause(1500);
  out.maillage = await texte('ws-mesh-stats');

  // ---- ouverture : etape 1 ----
  await page.evaluate(() => document.getElementById('ws-mesh-reshape-btn').click());
  await page.waitForSelector('#rrx-3d-stage', { state: 'visible' });
  await page.waitForFunction(() => getComputedStyle(document.getElementById('rrx-3d-loading')).display === 'none', null, { timeout: 180000 });
  await pause(2500);
  out.etape1_ouverture = await etat();
  await page.screenshot({ path: SORTIE + P + '_e1_face.png' });

  const vueDeInfo = (s) => { const m = /\((-?[\d.]+)°, (-?[\d.]+)°\)/.exec(s); return m ? [Number(m[1]), Number(m[2])] : null; };

  // ---- vues rapides, orbite a la souris ----
  const canvas = page.locator('#rrx-3d-canvas');
  const cadre = await canvas.boundingBox();
  out.canvas3d = cadre;
  const photos = [];
  async function photo(nom) {
    await pause(1200);
    const info = await texte('rrx-3d-info');
    const f = SORTIE + P + '_e1_' + nom + '.png';
    await canvas.screenshot({ path: f });
    photos.push({ nom, info, vue: vueDeInfo(info), fichier: f });
  }
  await photo('face');
  await page.evaluate(() => document.querySelector('#rrx-3d-presets [data-rrx-yaw="180"]').click());
  await photo('dos');
  await page.evaluate(() => document.querySelector('#rrx-3d-presets [data-rrx-yaw="90"][data-rrx-pitch="0"]').click());
  await photo('droite');
  await page.evaluate(() => document.querySelector('#rrx-3d-presets [data-rrx-pitch="89.9"]').click());
  await photo('dessus');
  // retour de face puis ORBITE REELLE a la souris : glisser vers la gauche et vers le haut
  await page.evaluate(() => document.querySelector('#rrx-3d-presets [data-rrx-yaw="0"][data-rrx-pitch="0"]').click());
  await pause(800);
  const cx = cadre.x + cadre.width / 2, cy = cadre.y + cadre.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 120, cy - 40, { steps: 12 });
  await page.mouse.move(cx - 220, cy - 70, { steps: 12 });
  await page.mouse.up();
  await photo('orbite');
  out.etape1_photos = photos;

  // ---- etape 2 depuis l'orbite : « Use this view » ----
  const infoOrbite = await texte('rrx-3d-info');
  out.vueOrbite = vueDeInfo(infoOrbite);
  const avant = captures.uploads.length;
  await page.evaluate(() => document.getElementById('rrx-use-view').click());
  await page.waitForFunction(() => (document.getElementById('rrx-img')?.src || '').startsWith('data:') && getComputedStyle(document.getElementById('rrx-loading')).display === 'none', null, { timeout: 180000 });
  await pause(800);
  out.etape2_orbite = await etat();
  out.etape2_orbite_rendu = captures.uploads.slice(avant);
  await page.screenshot({ path: SORTIE + P + '_e2_orbite.png' });

  // ---- « Change view » : retour a l'etape 1, la zone peinte est effacee ----
  const b0 = await page.locator('#rrx-canvas').boundingBox();
  await page.mouse.move(b0.x + b0.width * 0.5, b0.y + b0.height * 0.45);
  await page.mouse.down(); await page.mouse.move(b0.x + b0.width * 0.55, b0.y + b0.height * 0.5, { steps: 6 }); await page.mouse.up();
  out.peint_avant_retour = await page.evaluate(() => { const c = document.getElementById('rrx-canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 20) n++; return n; });
  await page.evaluate(() => document.getElementById('rrx-change-view').click());
  await pause(1500);
  out.retour_etape1 = await etat();
  out.peint_apres_retour = await page.evaluate(() => { const c = document.getElementById('rrx-canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 20) n++; return n; });
  await canvas.screenshot({ path: SORTIE + P + '_e1_retour.png' });

  // ---- vues rapides de l'etape 1 vers l'etape 2 : dos, droite, dessus ----
  out.rendus = [];
  for (const [nom, sel] of [['dos', '[data-rrx-yaw="180"]'], ['droite', '[data-rrx-yaw="90"][data-rrx-pitch="0"]'], ['dessus', '[data-rrx-pitch="89.9"]'], ['dessous', '[data-rrx-pitch="-89.9"]']]) {
    await page.evaluate((s) => document.querySelector('#rrx-3d-presets ' + s).click(), sel);
    await pause(1000);
    const info = await texte('rrx-3d-info');
    const n0 = captures.uploads.length;
    await page.evaluate(() => document.getElementById('rrx-use-view').click());
    await page.waitForFunction((n) => (document.getElementById('rrx-vue-nom')?.textContent || '').length > 0 && getComputedStyle(document.getElementById('rrx-loading')).display === 'none', null, { timeout: 180000 });
    await pause(500);
    out.rendus.push({ nom, info, vue: vueDeInfo(info), upload: captures.uploads.slice(n0), nomVue: await texte('rrx-vue-nom') });
    await page.evaluate(() => document.getElementById('rrx-change-view').click());
    await pause(900);
  }

  // ---- Apply sur le DOS : le corps envoye au serveur porte la vue ----
  await page.evaluate(() => document.querySelector('#rrx-3d-presets [data-rrx-yaw="180"]').click());
  await pause(900);
  await page.evaluate(() => document.getElementById('rrx-use-view').click());
  await page.waitForFunction(() => (document.getElementById('rrx-vue-nom')?.textContent || '').length > 0 && getComputedStyle(document.getElementById('rrx-loading')).display === 'none', null, { timeout: 180000 });
  const b1 = await page.locator('#rrx-canvas').boundingBox();
  await page.mouse.move(b1.x + b1.width * 0.45, b1.y + b1.height * 0.4);
  await page.mouse.down(); await page.mouse.move(b1.x + b1.width * 0.55, b1.y + b1.height * 0.5, { steps: 8 }); await page.mouse.up();
  await page.fill('#rrx-prompt', 'a crystal skull with two horns');
  await page.screenshot({ path: SORTIE + P + '_e2_dos_peint.png' });
  const n1 = captures.reshape.length;
  await page.evaluate(() => document.getElementById('rrx-apply').click());
  await page.waitForFunction((n) => true, null);
  for (let i = 0; i < 40 && captures.reshape.length === n1; i++) await pause(500);
  out.apply_dos = captures.reshape.slice(n1).map((b) => ({ vue: b.vue ?? null, aVueKey: 'vue' in b, meshUrl: String(b.meshUrl || '').slice(0, 60), vueUrl: String(b.vueUrl || '').slice(0, 70), prompt: b.prompt, masque: String(b.maskDataUrl || '').slice(0, 22), assetType: b.assetType }));
  await pause(1500);
  // la fenetre « Running task » s'ouvre d'elle-meme apres le lancement (comportement existant) : on la ferme avant de rouvrir l'outil
  await page.evaluate(() => document.getElementById('modal-job-details')?.classList.add('hidden'));
  await pause(300);

  // ---- vue de FACE immediate (comportement d'avant) : aucun champ vue ----
  await page.evaluate(() => document.getElementById('ws-mesh-reshape-btn').click());
  await page.waitForSelector('#rrx-3d-stage', { state: 'visible' });
  await page.waitForFunction(() => getComputedStyle(document.getElementById('rrx-3d-loading')).display === 'none', null, { timeout: 180000 });
  await pause(1500);
  out.reouverture = await etat();
  const n2 = captures.uploads.length;
  await page.evaluate(() => document.getElementById('rrx-use-view').click());
  await page.waitForFunction(() => (document.getElementById('rrx-vue-nom')?.textContent || '').length > 0 && getComputedStyle(document.getElementById('rrx-loading')).display === 'none', null, { timeout: 180000 });
  out.face_rendu = captures.uploads.slice(n2);
  out.face_nomVue = await texte('rrx-vue-nom');
  const b2 = await page.locator('#rrx-canvas').boundingBox();
  await page.mouse.move(b2.x + b2.width * 0.45, b2.y + b2.height * 0.4);
  await page.mouse.down(); await page.mouse.move(b2.x + b2.width * 0.55, b2.y + b2.height * 0.5, { steps: 8 }); await page.mouse.up();
  await page.fill('#rrx-prompt', 'a crystal skull with two horns');
  const n3 = captures.reshape.length;
  await page.evaluate(() => document.getElementById('rrx-apply').click());
  for (let i = 0; i < 40 && captures.reshape.length === n3; i++) await pause(500);
  out.apply_face = captures.reshape.slice(n3).map((b) => ({ vue: b.vue ?? null, aVueKey: 'vue' in b, vueUrl: String(b.vueUrl || '').slice(0, 70) }));
  await pause(1000);

  out.requetes = [...new Set(vus)].slice(0, 60);
  writeFileSync(SORTIE + P + '_resultat.json', JSON.stringify(out, null, 2));
  return out;
}
