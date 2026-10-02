// Fenetres courtes d'Argent (6 h, 24 h) et d'Audience.
export default async function run(page) {
  await page.evaluate(() => { const ids = [...document.querySelectorAll('details.vol[data-id]')].map((d) => d.dataset.id); ids.push('f-credits', 'g-postes', 'g-protections'); localStorage.setItem('admin2.volets', JSON.stringify(Object.fromEntries(ids.map((i) => [i, true])))); });
  await page.reload(); await page.waitForTimeout(1500);
  const r = {};
  const txt = async (sel) => (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ').trim();
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.waitForTimeout(1000); await page.click('[data-tab="argent"]'); await page.waitForTimeout(1800);
  r.boutons = await page.locator('#periode button').allInnerTexts();
  for (const per of ['6h', '24h']) {
    await page.click('[data-per="' + per + '"]'); await page.waitForTimeout(1200);
    r['kpis' + per] = await txt('#kpis-argent');
    r['sous' + per] = await txt('#sous-graphe');
    r['lignes' + per] = await page.locator('#t-ops tr').count();
    r['fenetre' + per] = await txt('#ops-fenetre');
    r['entete' + per] = await txt('th[data-tri="ops:reel"]');
    r['verdict' + per] = await txt('#t-ops tr:first-child');
  }
  await page.locator('th[data-tri="ops:credits"]').click(); await page.waitForTimeout(300);
  r.triCredits24 = await page.locator('#t-ops tr td:first-child').allInnerTexts();
  await page.click('[data-per="7j"]'); await page.waitForTimeout(1200);
  r.retour7j = await txt('#kpis-argent'); r.entete7j = await txt('th[data-tri="ops:reel"]'); r.fenetre7j = await txt('#ops-fenetre');
  await page.click('[data-tab="users"]'); await page.click('[data-sub="origine"]'); await page.waitForTimeout(800);
  await page.click('[data-per="6h"]'); await page.waitForTimeout(1000);
  r.audience6h = await txt('#note-audience'); r.boutonsAudience = await page.locator('#periode button').allInnerTexts();
  await page.click('[data-tab="argent"]'); await page.click('[data-per="24h"]'); await page.waitForTimeout(1200); await page.screenshot({ path: 'admin2_argent24h.png' });
  return r;
}
