// Meme maillage, meme page, ANCIEN code (release-1.0.45) : la vue de face a plat d'avant, pour comparer a l'octet avec yaw 0 / pitch 0.
import { brancher, SORTIE } from './mock.mjs';
import { writeFileSync } from 'node:fs';

const P = 'reshape3d_site_ancien';

export default async function run(page, ui) {
  page.setDefaultTimeout(180000);
  await page.setViewportSize({ width: 1600, height: 900 });
  const vus = [], captures = { uploads: [], reshape: [] };
  await brancher(page, { port: 8797, vus, captures, prefixe: P });
  const erreurs = [];
  page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text().slice(0, 240)); });
  page.on('pageerror', (e) => erreurs.push('PAGEERROR ' + String(e).slice(0, 240)));
  const out = { erreurs };
  const pause = (ms) => page.waitForTimeout(ms);
  await page.goto('http://127.0.0.1:8797/app/index.html', { waitUntil: 'domcontentloaded' });
  await pause(6000);
  await page.getByText('orc', { exact: false }).first().click();
  await page.waitForFunction(() => /triangles/.test(document.getElementById('ws-mesh-stats')?.textContent || ''), null, { timeout: 180000 });
  await pause(1500);
  await page.evaluate(() => document.getElementById('ws-mesh-reshape-btn').click());
  await page.waitForFunction(() => (document.getElementById('rrx-img')?.src || '').startsWith('data:') && getComputedStyle(document.getElementById('rrx-loading')).display === 'none', null, { timeout: 180000 });
  await pause(800);
  await page.screenshot({ path: SORTIE + P + '_fenetre.png' });
  out.uploads = captures.uploads;
  const b = await page.locator('#rrx-canvas').boundingBox();
  await page.mouse.move(b.x + b.width * 0.45, b.y + b.height * 0.4);
  await page.mouse.down(); await page.mouse.move(b.x + b.width * 0.55, b.y + b.height * 0.5, { steps: 8 }); await page.mouse.up();
  await page.fill('#rrx-prompt', 'a crystal skull with two horns');
  await page.evaluate(() => document.getElementById('rrx-apply').click());
  for (let i = 0; i < 40 && captures.reshape.length === 0; i++) await pause(500);
  out.apply = captures.reshape.map((x) => ({ aVueKey: 'vue' in x, cles: Object.keys(x).sort(), vueUrl: String(x.vueUrl || '').slice(0, 70) }));
  writeFileSync(SORTIE + P + '_resultat.json', JSON.stringify(out, null, 2));
  return out;
}
