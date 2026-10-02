// /admin2 : interrupteur GENERAL dans l'en-tete des sections Systeme (volet ferme), sans deplier le volet
export default async function run(page) {
  const r = { echecs: [], infos: {} };
  const ok = (c, m) => { if (!c) r.echecs.push(m); };
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => { try { localStorage.removeItem('admin2.volets'); } catch (_) {} });
  await page.reload(); await page.waitForTimeout(1500);
  await page.click('[data-tab="systeme"]'); await page.waitForTimeout(2500);
  const ouvert = (id) => page.evaluate((i) => document.querySelector('details[data-id="' + i + '"]').open, id);
  ok((await ouvert('s-kill')) && (await ouvert('s-warm')), 'cartes ouvertes au depart (plan A)');
  const sw = (id) => page.locator('details[data-id="' + id + '"] > summary button[role=switch].maitre');
  ok(await sw('s-kill').count() === 1, 'pas d\'interrupteur general dans Interrupteurs d\'urgence');
  ok(await sw('s-warm').count() === 1, 'pas d\'interrupteur general dans Conteneurs');
  ok(await sw('s-kill').isVisible(), 'interrupteur general (urgence) invisible');
  r.infos.kill = await sw('s-kill').getAttribute('aria-checked');
  r.infos.warm = await sw('s-warm').getAttribute('aria-checked');
  // un clic sur l'interrupteur du titre ne deplie PAS le volet « Conteneurs » ; il garde tout chaud
  await sw('s-warm').click(); await page.waitForTimeout(1500);
  ok(await ouvert('s-warm'), 'le clic sur l\'interrupteur a replie la carte Conteneurs');
  r.infos.warmApres = await sw('s-warm').getAttribute('aria-checked');
  ok(r.infos.warmApres === 'true', 'tous chauds : interrupteur non active (' + r.infos.warmApres + ')');
  // « Tout couper » depuis le titre : ouvre le volet et demande confirmation
  await sw('s-kill').click(); await page.waitForTimeout(800);
  ok(await ouvert('s-kill'), 'tout couper : la carte n\'est pas ouverte');
  ok(await page.locator('#kill .confirm').count() >= 1, 'tout couper : pas de confirmation');
  await page.locator('#kill [data-kill-ok="all-off"]').click(); await page.waitForTimeout(1500);
  r.infos.killApres = await sw('s-kill').getAttribute('aria-checked');
  ok(r.infos.killApres === 'false', 'tout coupe : interrupteur general toujours actif');
  // GPU coupe : le titre de Conteneurs propose de le rallumer
  const rall = page.locator('details[data-id="s-warm"] > summary [data-kill="modal"]');
  ok(await rall.count() === 1, 'GPU coupe : pas de bouton Rallumer dans le titre de Conteneurs');
  await page.screenshot({ path: 'C:/tmp/admin2_interrupteurs.png' });
  await rall.click(); await page.waitForTimeout(1500);
  ok(await sw('s-warm').count() === 1, 'GPU rallume : l\'interrupteur general de Conteneurs n\'est pas revenu');
  r.ok = r.echecs.length === 0; return r;
}
