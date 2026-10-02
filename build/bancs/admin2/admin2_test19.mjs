// /admin2 : les courbes « Comptes actifs » et « Travaux lances » par jour sont aussi dans Maintenant ; graduations a pas entier
export default async function run(page) {
  const r = { echecs: [], infos: {} };
  const ok = (c, m) => { if (!c) r.echecs.push(m); };
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => { try { localStorage.removeItem('admin2.volets'); } catch (_) {} });
  await page.goto(new URL(page.url()).origin + '/admin2#maintenant'); await page.reload(); await page.waitForTimeout(2500);
  const titres = await page.evaluate(() => Array.from(document.querySelectorAll('#p-maintenant details.vol > summary h2')).map((h) => h.textContent.replace(/\s+/g, ' ').trim()));
  r.infos.titres = titres;
  ok(titres.some((t) => /^Comptes actifs/.test(t)) && titres.some((t) => /^Travaux lancés/.test(t)), 'les deux courbes ne sont pas dans Maintenant : ' + titres.join(' | '));
  await page.click('details[data-id="m-act"] > summary'); await page.waitForTimeout(400);
  await page.click('details[data-id="m-ops"] > summary'); await page.waitForTimeout(400);
  ok((await page.locator('#g-act-m svg').count()) === 1, 'Maintenant : courbe des comptes actifs absente');
  ok((await page.locator('#g-ops-m svg').count()) === 1, 'Maintenant : courbe des travaux lances absente');
  const resumes = await page.evaluate(() => ['m-act', 'm-ops'].map((i) => (document.querySelector('details[data-id="' + i + '"] .res') || {}).textContent || ''));
  r.infos.resumes = resumes; ok(resumes.every((x) => x.length > 3 && x !== '…'), 'resumes vides : ' + JSON.stringify(resumes));
  // graduations : aucune valeur en double sur l'axe vertical
  const axes = await page.evaluate(() => ['g-act-m', 'g-ops-m'].map((id) => Array.from(document.querySelectorAll('#' + id + ' text.ax')).filter((t) => t.getAttribute('text-anchor') === 'end').map((t) => t.textContent.trim())));
  r.infos.axes = axes;
  axes.forEach((a, i) => ok(new Set(a).size === a.length, 'graduations en double (' + ['comptes actifs', 'travaux'][i] + ') : ' + a.join(' ')));
  // Activite garde les siennes
  await page.click('[data-tab="audience"]'); await page.waitForTimeout(900);
  await page.click('details[data-id="u-act"] > summary'); await page.waitForTimeout(400);
  ok((await page.locator('#g-act svg').count()) === 1, 'Activite : courbe des comptes actifs absente');
  r.ok = r.echecs.length === 0; return r;
}
