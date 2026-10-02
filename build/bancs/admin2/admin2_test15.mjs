// Travaux bloques depuis plus de 3 h (ancienne liste « Active » de /admin) : visibles dans « En cours », arretables avec remboursement. ASSERTIONS.
export default async function run(page) {
  const echecs = [];
  const verif = (nom, cond, detail) => { if (!cond) echecs.push(nom + (detail !== undefined ? ' -> ' + JSON.stringify(detail) : '')); };
  const txt = async (sel) => (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ').trim();
  const etat = () => page.evaluate(() => fetch('/__etat').then((x) => x.json()));
  await page.setViewportSize({ width: 1300, height: 900 });
  await page.evaluate(() => { localStorage.setItem('admin2.volets', JSON.stringify({ 'm-cours': false })); });
  await page.reload(); await page.waitForTimeout(2200);
  const res = await page.locator('details[data-id="m-cours"] > summary .res').textContent();
  verif('resume ferme : pastille bloques', /1 bloqué depuis plus de 3 h/.test(res), res);
  await page.click('details[data-id="m-cours"] > summary'); await page.waitForTimeout(400);
  const corps = await txt('#encours');
  verif('section bloques', /Bloqués depuis plus de 3 h/.test(corps) && /vieux-chateau/.test(corps) && /lancé il y a 5 h/.test(corps), corps);
  verif('le travail recent n est pas dans les bloques', (await page.locator('#encours .job').count()) === 4, await page.locator('#encours .job').count());
  await page.locator('[data-stop="z1"]').click(); await page.waitForTimeout(200);
  verif('confirmation avec remboursement', (await page.locator('[data-stop-ok="z1"]').count()) === 1 && (await page.locator('#stop-refund').isChecked()));
  await page.locator('[data-stop-ok="z1"]').click(); await page.waitForTimeout(1500);
  verif('annule cote serveur', (await etat()).annules.includes('z1'));
  verif('disparu de la liste', !/vieux-chateau/.test(await txt('#encours')), await txt('#encours'));
  return { ok: echecs.length === 0, echecs };
}
