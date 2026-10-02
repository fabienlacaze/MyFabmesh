// Tri des tableaux et mise en page etroite de /admin2 (serveur simule).
export default async function run(page) {
  await page.evaluate(() => { const ids = [...document.querySelectorAll('details.vol[data-id]')].map((d) => d.dataset.id); ids.push('f-credits', 'g-postes', 'g-protections'); localStorage.setItem('admin2.volets', JSON.stringify(Object.fromEntries(ids.map((i) => [i, true])))); });
  await page.reload(); await page.waitForTimeout(1500);
  const r = {};
  const col = async (sel) => (await page.locator(sel).allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').trim());
  for (const largeur of [1100, 1400]) {
    await page.setViewportSize({ width: largeur, height: 900 });
    await page.goto('http://127.0.0.1:8799/admin2#travaux'); await page.reload(); await page.waitForTimeout(1500);
    const m = await page.evaluate(() => { const d = document.querySelector('#flux').closest('.defil'); return { scrollW: d.scrollWidth, clientW: d.clientWidth, page: document.documentElement.scrollWidth, fenetre: window.innerWidth }; });
    r['largeur' + largeur] = m;
  }
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.goto('http://127.0.0.1:8799/admin2#travaux'); await page.reload(); await page.waitForTimeout(1500);
  const avant = (await col('#flux tr td:nth-child(2)')).slice(0, 4);
  await page.locator('th[data-tri="flux:email"]').click(); await page.waitForTimeout(300);
  const asc = await col('#flux tr td:nth-child(2)');
  r.triCompteAsc = asc.slice(0, 3).concat(['…']).concat(asc.slice(-1));
  r.triCompteOk = asc.every((x, i) => i === 0 || asc[i - 1].localeCompare(x, 'fr') <= 0);
  await page.locator('th[data-tri="flux:email"]').click(); await page.waitForTimeout(300);
  const desc = await col('#flux tr td:nth-child(2)');
  r.triCompteDesc = desc.every((x, i) => i === 0 || desc[i - 1].localeCompare(x, 'fr') >= 0);
  await page.locator('th[data-tri="flux:credits"]').click(); await page.waitForTimeout(300);
  const cr = (await col('#flux tr td:nth-child(7)')).map(Number);
  r.triCreditsDesc = cr.every((x, i) => i === 0 || cr[i - 1] >= x); r.creditsHaut = cr.slice(0, 3);
  r.ariaSort = await page.locator('th[data-tri="flux:credits"]').getAttribute('aria-sort');
  await page.locator('th[data-tri="flux:duree_s"]').click(); await page.waitForTimeout(300);
  r.premiereDuree = (await col('#flux tr td:nth-child(6)'))[0];
  r.erreurSousStatut = await page.locator('#flux .erreur-ligne').count();
  r.colonnes = (await col('#flux').then((x) => x)).length;
  // Argent : operations et achats
  await page.click('[data-tab="argent"]'); await page.waitForTimeout(1200);
  await page.locator('th[data-tri="ops:op"]').click(); await page.waitForTimeout(300);
  r.opsParNom = (await col('#t-ops tr td:first-child'));
  await page.locator('th[data-tri="ops:credits"]').click(); await page.waitForTimeout(300);
  r.opsParCredits = (await col('#t-ops tr td:nth-child(3)'));
  await page.locator('th[data-tri="achats:encaisse_eur"]').click(); await page.waitForTimeout(300);
  r.achatsParMontant = await col('#t-achats tr td:nth-child(4)');
  // Utilisateurs : tri des comptes
  await page.click('[data-tab="users"]'); await page.waitForTimeout(1200);
  r.comptesAvant = await col('#liste-comptes .ligne span:first-child');
  await page.selectOption('#tri-comptes', 'credits'); await page.waitForTimeout(300);
  r.comptesParCredits = (await col('#liste-comptes .ligne')).map((x) => x.replace(/\s+/g, ' '));
  await page.selectOption('#tri-comptes', 'email'); await page.waitForTimeout(300);
  r.comptesParEmail = (await col('#liste-comptes .ligne span:first-child'));
  await page.setViewportSize({ width: 1100, height: 900 }); await page.click('[data-tab="travaux"]'); await page.waitForTimeout(1200);
  await page.screenshot({ path: 'admin2_etroit.png' });
  return r;
}
