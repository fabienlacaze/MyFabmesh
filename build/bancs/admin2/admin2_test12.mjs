// Affichage a 400 px (telephone) : aucun defilement horizontal de la page, volets lisibles, visionneuse empilee, periode et onglets utilisables.
export default async function run(page) {
  const r = { debordements: {}, erreurs: [] };
  page.on('pageerror', (e) => r.erreurs.push(String(e.message || e)));
  await page.setViewportSize({ width: 400, height: 800 });
  await page.evaluate(() => { const ids = [...document.querySelectorAll('details.vol[data-id]')].map((d) => d.dataset.id); ids.push('f-credits'); localStorage.setItem('admin2.volets', JSON.stringify(Object.fromEntries(ids.map((i) => [i, true])))); });
  await page.reload(); await page.waitForTimeout(2500);
  const mesure = () => page.evaluate(() => {
    const W = window.innerWidth, doc = document.documentElement;
    const clipe = (e) => { for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) { const o = getComputedStyle(a).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') { const b = a.getBoundingClientRect(); if (b.right <= W + 1) return true; } } return false; };
    const larges = [];
    document.querySelectorAll('body *').forEach((e) => {
      if (e.closest('svg') && e.tagName.toLowerCase() !== 'svg') return;
      const b = e.getBoundingClientRect(); if (!b.width || !b.height) return;
      if (e.closest('[hidden]')) return;
      if (b.right > W + 1 && !clipe(e)) larges.push(e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ')[0] : '') + ' ' + Math.round(b.right));
    });
    return { page: doc.scrollWidth, fenetre: W, depassent: larges.slice(0, 8), n: larges.length };
  });
  for (const tab of ['maintenant', 'argent', 'users', 'audience', 'systeme']) {
    await page.click('[data-tab="' + tab + '"]'); await page.waitForTimeout(1500);
    r.debordements[tab] = await mesure();
    await page.screenshot({ path: 'admin2_m400_' + tab + '.png', fullPage: true });
  }
  // utilisateurs : choisir un compte, messages, marketplace
  await page.click('[data-tab="users"]'); await page.waitForTimeout(500);
  await page.locator('#liste-comptes .ligne').first().click(); await page.waitForTimeout(500);
  r.debordements.fiche = await mesure();
  await page.click('[data-sub="messages"]'); await page.waitForTimeout(500); r.debordements.messages = await mesure();
  await page.screenshot({ path: 'admin2_m400_messages.png', fullPage: true });
  await page.click('[data-sub="market"]'); await page.waitForTimeout(500); r.debordements.market = await mesure();
  await page.locator('[data-ms="approved"]').click(); await page.waitForTimeout(300); r.debordements.marketPublie = await mesure();
  await page.screenshot({ path: 'admin2_m400_market.png', fullPage: true });
  // visionneuse empilee
  await page.click('[data-tab="audience"]'); await page.waitForTimeout(1500);
  await page.locator('#galerie .vignette').first().click(); await page.waitForTimeout(500);
  r.lb = await page.evaluate(() => { const a = document.querySelector('#lb-img').getBoundingClientRect(), b = document.querySelector('#lb-params').getBoundingClientRect(); return { imageHaut: Math.round(a.top), paramsHaut: Math.round(b.top), empile: b.top >= a.bottom - 2, largeurImg: Math.round(a.width), largeurParams: Math.round(b.width), fenetre: window.innerWidth, page: document.documentElement.scrollWidth }; });
  await page.screenshot({ path: 'admin2_m400_lb.png' });
  await page.keyboard.press('Escape');
  // selecteur de periode + onglets : tailles de cibles tactiles et visibilite
  await page.click('[data-tab="argent"]'); await page.waitForTimeout(800);
  r.cibles = await page.evaluate(() => {
    const t = (s) => Array.from(document.querySelectorAll(s)).filter((e) => e.offsetParent !== null).map((e) => { const b = e.getBoundingClientRect(); return { h: Math.round(b.height), w: Math.round(b.width), dansEcran: b.left >= 0 && b.right <= window.innerWidth + 1 }; });
    return { onglets: t('.tab'), periode: t('#periode button') };
  });
  r.tousOngletsDansEcran = r.cibles.onglets.every((x) => x.dansEcran);
  r.tousPeriodeDansEcran = r.cibles.periode.every((x) => x.dansEcran);
  await page.screenshot({ path: 'admin2_m400_haut.png' });
  return r;
}
