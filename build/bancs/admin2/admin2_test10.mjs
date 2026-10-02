// Volets repliables : fermes au depart, resume sur une ligne, ouverture, memoire apres rechargement, tout ouvrir / replier.
export default async function run(page) {
  const r = {};
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e.message || e)));
  await page.setViewportSize({ width: 1300, height: 900 });
  await page.evaluate(() => { try { localStorage.removeItem('admin2.volets'); } catch (_) {} });
  await page.reload(); await page.waitForTimeout(2500);
  const etat = async (panel) => page.evaluate((p) => Array.from(document.querySelectorAll('#' + p + ' details.vol')).filter((d) => !d.hidden).map((d) => ({ id: d.dataset.id, ouvert: d.open, resume: (d.querySelector('summary .res') || {}).textContent || '', titre: (d.querySelector('summary h2') || {}).textContent || '' })), panel);
  r.maintenant = await etat('p-maintenant');
  r.toutFerme = r.maintenant.every((v) => !v.ouvert);
  await page.click('[data-tab="audience"]'); await page.waitForTimeout(900);
  r.hauteurVolet = await page.evaluate(() => Math.round(document.querySelector('details[data-id="m-flux"]').getBoundingClientRect().height));
  // ouvrir « Derniers travaux » : le tableau devient visible
  await page.click('details[data-id="m-flux"] > summary'); await page.waitForTimeout(300);
  r.fluxOuvert = await page.evaluate(() => document.querySelector('details[data-id="m-flux"]').open);
  r.lignesFlux = await page.locator('#flux tr').count();
  // memoire : recharger
  await page.reload(); await page.waitForTimeout(2000);
  r.apresReload = await page.evaluate(() => document.querySelector('details[data-id="m-flux"]').open);
  // tri toujours possible dans un volet ouvert
  await page.locator('th[data-tri="flux:email"]').click(); await page.waitForTimeout(300);
  r.triFlux = await page.locator('th[data-tri="flux:email"]').getAttribute('aria-sort');
  // tout replier / tout ouvrir
  await page.locator('#p-audience [data-volets="0"]').click(); await page.waitForTimeout(200);
  r.apresReplier = (await etat('p-audience')).every((v) => !v.ouvert);
  await page.locator('#p-audience [data-volets="1"]').click(); await page.waitForTimeout(800);
  r.apresOuvrir = (await etat('p-audience')).every((v) => v.ouvert);
  await page.locator('#p-audience [data-volets="0"]').click(); await page.waitForTimeout(200);
  // Argent
  await page.click('[data-tab="argent"]'); await page.waitForTimeout(1500);
  r.argent = await etat('p-argent');
  r.kpisArgent = await page.locator('#kpis-argent .cell').count();
  await page.click('details[data-id="a-tarifs"] > summary'); await page.waitForTimeout(800);
  r.tarifsLignes = await page.locator('#tarifs tbody tr').count();
  await page.click('details[data-id="a-tarifs"] > summary'); await page.waitForTimeout(200);
  // Audience
  await page.click('[data-tab="audience"]'); await page.waitForTimeout(1500);
  r.audience = await etat('p-audience');
  // Systeme : le diagnostic et l'audit ne chargent qu'a l'ouverture
  await page.click('[data-tab="systeme"]'); await page.waitForTimeout(1500);
  r.systeme = await etat('p-systeme');
  r.diagAvant = await page.locator('#dbg-traces tr').count();
  await page.click('details[data-id="s-diag"] > summary'); await page.waitForTimeout(1200);
  r.diagApres = await page.locator('#dbg-traces tr').count();
  r.diagResume = await page.evaluate(() => { document.querySelector('details[data-id="s-diag"]').open = false; return null; });
  await page.waitForTimeout(2300);
  r.diagResumeFerme = await page.evaluate(() => document.querySelector('details[data-id="s-diag"] .res').textContent);
  // Utilisateurs : « Ajuster les credits » replie
  await page.click('[data-tab="users"]'); await page.waitForTimeout(1500);
  await page.locator('#liste-comptes button.ligne').first().click(); await page.waitForTimeout(500);
  r.fiche = await page.evaluate(() => { const d = document.querySelector('#fiche details[data-id="f-credits"]'); return d ? { ouvert: d.open } : null; });
  await page.click('#fiche details[data-id="f-credits"] > summary'); await page.waitForTimeout(300);
  r.ficheOuverte = await page.evaluate(() => document.querySelector('#fiche details[data-id="f-credits"]').open);
  r.champVisible = await page.locator('#aj').isVisible();
  await page.screenshot({ path: 'admin2_volets_users.png' });
  await page.click('[data-tab="maintenant"]'); await page.waitForTimeout(1200);
  await page.screenshot({ path: 'admin2_volets_maintenant.png' });
  r.erreurs = erreurs;
  return r;
}
