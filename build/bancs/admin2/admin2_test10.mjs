// /admin2 (plan A) : plus de volets repliables : toutes les cartes sont ouvertes, sans « Tout ouvrir / replier » ; la fiche garde son formulaire repliable
export default async function run(page) {
  const r = { echecs: [], infos: {} };
  const ok = (c, m) => { if (!c) r.echecs.push(m); };
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => { try { localStorage.setItem('admin2.volets', JSON.stringify({ 'm-flux': false, 'a-tarifs': false, 's-diag': false })); } catch (_) {} });
  await page.reload(); await page.waitForTimeout(2500);
  const TABS = ['maintenant', 'travaux', 'audience', 'argent', 'tarifs', 'users', 'messages', 'marketplace', 'systeme', 'journal'];
  for (const t of TABS) {
    await page.click('[data-tab="' + t + '"]'); await page.waitForTimeout(900);
    const e = await page.evaluate(() => Array.from(document.querySelectorAll('section[role=tabpanel]:not([hidden]) details.carte.vol')).filter((d) => !d.hidden).map((d) => d.open));
    r.infos[t] = e.length;
    ok(e.every(Boolean), t + ' : une carte est repliee malgre l etat memorise');
  }
  ok((await page.locator('[data-volets]').count()) === 0, 'des boutons Tout ouvrir / Tout replier existent encore');
  // un clic sur le titre d'une carte ne la replie pas
  await page.click('[data-tab="travaux"]'); await page.waitForTimeout(600);
  await page.click('details[data-id="m-flux"] > summary h2'); await page.waitForTimeout(300);
  ok(await page.evaluate(() => document.querySelector('details[data-id="m-flux"]').open), 'un clic sur le titre a replie la carte');
  // la hauteur d'une carte ouverte n'est plus celle d'une simple ligne
  ok((await page.evaluate(() => Math.round(document.querySelector('details[data-id="m-flux"]').getBoundingClientRect().height))) > 150, 'carte Derniers travaux ecrasee');
  // la fiche d'un compte garde un formulaire repliable (Ajuster les credits)
  await page.click('[data-tab="users"]'); await page.waitForTimeout(1200);
  await page.locator('#liste-comptes .ligne').nth(0).click(); await page.waitForTimeout(1200);
  ok(!(await page.evaluate(() => document.querySelector('#fiche details[data-id="f-credits"]').open)), 'Ajuster les credits devrait etre replie');
  await page.click('#fiche details[data-id="f-credits"] > summary'); await page.waitForTimeout(300);
  ok(await page.evaluate(() => document.querySelector('#fiche details[data-id="f-credits"]').open), 'Ajuster les credits ne s ouvre pas');
  r.ok = r.echecs.length === 0; return r;
}
