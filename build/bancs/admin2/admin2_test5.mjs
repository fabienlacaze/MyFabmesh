// Selecteur de periode sous le menu et ses effets (serveur simule).
export default async function run(page) {
  await page.evaluate(() => { const ids = [...document.querySelectorAll('details.vol[data-id]')].map((d) => d.dataset.id); ids.push('f-credits', 'g-postes', 'g-protections'); localStorage.setItem('admin2.volets', JSON.stringify(Object.fromEntries(ids.map((i) => [i, true])))); });
  await page.reload(); await page.waitForTimeout(1500);
  const r = {};
  const box = async (sel) => { const b = await page.locator(sel).first().boundingBox(); return b ? { y: Math.round(b.y), h: Math.round(b.height) } : null; };
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.waitForTimeout(1500);
  await page.click('[data-tab="argent"]'); await page.waitForTimeout(500);
  const nav = await box('.tabs'), per = await box('#periode');
  r.sousLeMenu = per.y > nav.y + nav.h - 2;
  r.boutons = await page.locator('#periode button').allInnerTexts();
  const visible = {};
  for (const tab of ['maintenant', 'argent', 'users', 'audience', 'systeme']) { await page.click('[data-tab="' + tab + '"]'); await page.waitForTimeout(500); visible[tab] = !(await page.locator('#l4').isHidden()); }
  r.visibleParOnglet = visible;
  await page.click('[data-tab="maintenant"]'); await page.waitForTimeout(500); r.periodeMasqueeSurMaintenant = await page.locator('#l4').isHidden();
  await page.click('[data-tab="users"]'); await page.waitForTimeout(1000);
  r.comptesTitre = (await page.locator('#n-comptes').innerText()).trim();
  await page.click('[data-per="6h"]'); await page.waitForTimeout(300);
  r.comptesTitre6h = (await page.locator('#n-comptes').innerText()).trim();
  await page.check('#users-actifs'); await page.waitForTimeout(300);
  r.comptesActifs6h = await page.locator('#liste-comptes .ligne').count();
  await page.uncheck('#users-actifs'); await page.waitForTimeout(300);
  r.comptesTous = await page.locator('#liste-comptes .ligne').count();
  await page.click('[data-tab="argent"]'); await page.waitForTimeout(1000); r.argent6h = (await page.locator('#sous-graphe').innerText()).trim();
  await page.screenshot({ path: 'admin2_periode.png' });
  return r;
}
