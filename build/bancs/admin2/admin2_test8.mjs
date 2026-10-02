export default async function run(page) {
  await page.evaluate(() => { const ids = [...document.querySelectorAll('details.vol[data-id]')].map((d) => d.dataset.id); ids.push('f-credits', 'g-postes', 'g-protections'); localStorage.setItem('admin2.volets', JSON.stringify(Object.fromEntries(ids.map((i) => [i, true])))); });
  await page.reload(); await page.waitForTimeout(1500);
  const r = {};
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.waitForTimeout(1500);
  const vis = {};
  for (const tab of ['maintenant', 'argent', 'users', 'audience', 'systeme']) { await page.click('[data-tab="' + tab + '"]'); await page.waitForTimeout(500); vis[tab] = !(await page.locator('#l4').isHidden()); }
  r.selecteurVisible = vis;
  await page.click('[data-tab="audience"]'); await page.waitForTimeout(800);
  r.fluxTitre = (await page.locator('#n-flux').innerText()).trim(); r.lignes = await page.locator('#flux tr').count(); r.galerie = (await page.locator('#n-imgs').count()) === 0 ? 'absente de Activité' : 'PRESENTE';
  await page.click('[data-tab="argent"]'); await page.waitForTimeout(800); await page.click('[data-per="6h"]'); await page.waitForTimeout(800);
  r.argent6h = (await page.locator('#sous-graphe').innerText()).trim();
  return r;
}
