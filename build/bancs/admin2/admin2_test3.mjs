// Galerie d'images, visionneuse, filtre par compte et tableaux qui tiennent dans leur colonne (serveur simule).
export default async function run(page) {
  await page.evaluate(() => { const ids = [...document.querySelectorAll('details.vol[data-id]')].map((d) => d.dataset.id); ids.push('f-credits', 'g-postes', 'g-protections'); localStorage.setItem('admin2.volets', JSON.stringify(Object.fromEntries(ids.map((i) => [i, true])))); });
  await page.reload(); await page.waitForTimeout(1500);
  const r = {};
  const fit = (sel) => page.evaluate((s) => { const d = document.querySelector(s).closest('.defil'); return { scrollW: d.scrollWidth, clientW: d.clientWidth }; }, sel);
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.goto('http://127.0.0.1:8799/admin2#audience'); await page.reload(); await page.waitForTimeout(2000);
  r.vignettes = await page.locator('#galerie .vignette').count();
  r.titreGalerie = (await page.locator('#n-imgs').innerText()).trim();
  r.legende = (await page.locator('#galerie .leg').first().innerText()).replace(/\s+/g, ' ');
  await page.locator('#galerie .vignette').nth(2).click(); await page.waitForTimeout(300);
  r.lbVisible = !(await page.locator('#lb').isHidden()); r.lbLegende = (await page.locator('#lb-cap').innerText()).replace(/\s+/g, ' ');
  await page.keyboard.press('ArrowRight'); r.lbApres = (await page.locator('#lb-cap').innerText()).replace(/\s+/g, ' ');
  await page.keyboard.press('Escape'); r.lbFerme = await page.locator('#lb').isHidden();
  await page.locator('#flux .lien[data-f="compte"]').first().click(); await page.waitForTimeout(800);
  r.vignettesFiltre = await page.locator('#galerie .vignette').count(); r.titreFiltre = (await page.locator('#n-imgs').innerText()).trim();
  await page.locator('[data-clear="all"]').click(); await page.waitForTimeout(800);
  r.vignettesRetour = await page.locator('#galerie .vignette').count();
  for (const largeur of [800, 1100]) {
    await page.setViewportSize({ width: largeur, height: 900 });
    await page.click('[data-tab="argent"]'); await page.waitForTimeout(1500);
    r['ops' + largeur] = await fit('#t-ops');
    r['achats' + largeur] = await fit('#t-achats');
    r['verdict' + largeur] = (await page.locator('#t-ops tr').first().innerText()).replace(/\s+/g, ' ');
    await page.click('[data-tab="audience"]'); await page.waitForTimeout(800);
    r['flux' + largeur] = await fit('#flux');
  }
  await page.setViewportSize({ width: 800, height: 1000 }); await page.click('[data-tab="argent"]'); await page.waitForTimeout(1200);
  await page.locator('#t-ops').scrollIntoViewIfNeeded(); await page.screenshot({ path: 'admin2_ops800.png' });
  await page.setViewportSize({ width: 1100, height: 900 }); await page.click('[data-tab="audience"]'); await page.waitForTimeout(800);
  await page.locator('#galerie').scrollIntoViewIfNeeded(); await page.screenshot({ path: 'admin2_galerie.png' });
  return r;
}
