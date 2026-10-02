// Style de l'ancienne page (onglets groupes, banniere Modal, logo) et tri du diagnostic (serveur simule).
export default async function run(page) {
  await page.evaluate(() => { const ids = [...document.querySelectorAll('details.vol[data-id]')].map((d) => d.dataset.id); ids.push('f-credits', 'g-postes', 'g-protections'); localStorage.setItem('admin2.volets', JSON.stringify(Object.fromEntries(ids.map((i) => [i, true])))); });
  await page.reload(); await page.waitForTimeout(1500);
  const r = {};
  const col = async (sel) => (await page.locator(sel).allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').trim());
  await page.setViewportSize({ width: 1300, height: 900 });
  await page.waitForTimeout(1500);
  r.groupes = await col('.tab-group-header');
  r.onglets = await col('.tab');
  r.logo = await page.locator('img.logo').count();
  r.banniere = (await page.locator('#bandeau-modal').isHidden()) ? 'cachee' : (await page.locator('#bandeau-modal').innerText()).trim();
  r.kpiCollant = await page.evaluate(() => getComputedStyle(document.querySelector('#bandeau')).position);
  await page.click('[data-tab="argent"]'); await page.waitForTimeout(500);
  r.actifArgent = await page.locator('.tab[data-tab="argent"]').getAttribute('aria-selected');
  r.clicBanniere = await page.evaluate(() => { document.querySelector('#bandeau-modal').click(); return document.querySelector('.tab[aria-selected="true"]').dataset.tab; });
  // tri du diagnostic
  await page.click('[data-tab="journal"]'); await page.waitForTimeout(1500);
  await page.click('#b-dbg'); await page.waitForTimeout(800);
  r.avant = await col('#dbg-traces tr td:nth-child(3)');
  await page.locator('th[data-tri="dbg:operation"]').click(); await page.waitForTimeout(300);
  r.parOperation = await col('#dbg-traces tr td:nth-child(3)'); r.ariaSort = await page.locator('th[data-tri="dbg:operation"]').getAttribute('aria-sort');
  await page.locator('th[data-tri="dbg:duree_s"]').click(); await page.waitForTimeout(300);
  r.parDuree = await col('#dbg-traces tr td:nth-child(5)');
  await page.locator('[data-trace="0"]').click(); r.detail = (await page.locator('#dbg-viewer').innerText()).slice(0, 40);
  await page.locator('th[data-tri="dbglog:size"]').click(); r.tri2 = await page.locator('th[data-tri="dbglog:size"]').getAttribute('aria-sort');
  await page.locator('th[data-tri="audit:actor"]').click(); r.tri3 = await page.locator('th[data-tri="audit:actor"]').getAttribute('aria-sort');
  await page.click('[data-tab="maintenant"]'); await page.waitForTimeout(1000);
  await page.screenshot({ path: 'admin2_style.png' });
  return r;
}
