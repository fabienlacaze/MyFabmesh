// /admin2 : les courbes « Comptes actifs » et « Travaux lances » par jour vivent dans Activite SEULEMENT (retirees de Maintenant) ; graduations a pas entier
export default async function run(page) {
  const r = { echecs: [], infos: {} };
  const ok = (c, m) => { if (!c) r.echecs.push(m); };
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => { try { localStorage.removeItem('admin2.volets'); } catch (_) {} });
  await page.goto(new URL(page.url()).origin + '/admin2#maintenant'); await page.reload(); await page.waitForTimeout(2500);
  const titres = await page.evaluate(() => Array.from(document.querySelectorAll('#p-maintenant details.vol > summary h2')).map((h) => h.textContent.replace(/\s+/g, ' ').trim()));
  r.infos.titres = titres;
  ok(!titres.some((t) => /^Comptes actifs/.test(t)) && !titres.some((t) => /^Travaux lancés/.test(t)), 'Maintenant montre encore une courbe par jour : ' + titres.join(' | '));
  ok((await page.locator('#p-maintenant #g-act-m, #p-maintenant #g-ops-m, #p-maintenant [data-id="m-act"], #p-maintenant [data-id="m-ops"]').count()) === 0, 'Maintenant : restes des volets de courbes');
  // Activite garde les siennes, avec des graduations sans doublon
  await page.click('[data-tab="audience"]'); await page.waitForTimeout(900);
  const titresAud = await page.evaluate(() => Array.from(document.querySelectorAll('#p-audience details.vol > summary h2')).map((h) => h.textContent.replace(/\s+/g, ' ').trim()));
  r.infos.activite = titresAud;
  ok(titresAud.some((t) => /^Comptes actifs/.test(t)) && titresAud.some((t) => /^Travaux lancés/.test(t)), 'Activité : les deux courbes manquent : ' + titresAud.join(' | '));
  await page.click('details[data-id="u-act"] > summary'); await page.waitForTimeout(400);
  await page.click('details[data-id="u-ops"] > summary'); await page.waitForTimeout(400);
  ok((await page.locator('#g-act svg').count()) === 1, 'Activité : courbe des comptes actifs absente');
  ok((await page.locator('#g-ops svg').count()) === 1, 'Activité : courbe des travaux lancés absente');
  const resumes = await page.evaluate(() => ['u-act', 'u-ops'].map((i) => (document.querySelector('details[data-id="' + i + '"] .res') || {}).textContent || ''));
  r.infos.resumes = resumes; ok(resumes.every((x) => x.length > 3 && x !== '…'), 'résumés vides : ' + JSON.stringify(resumes));
  const axes = await page.evaluate(() => ['g-act', 'g-ops'].map((id) => Array.from(document.querySelectorAll('#' + id + ' text.ax')).filter((t) => t.getAttribute('text-anchor') === 'end').map((t) => t.textContent.trim())));
  r.infos.axes = axes;
  axes.forEach((a, i) => ok(new Set(a).size === a.length, 'graduations en double (' + ['comptes actifs', 'travaux'][i] + ') : ' + a.join(' ')));
  r.ok = r.echecs.length === 0; return r;
}
