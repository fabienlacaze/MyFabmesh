export default async function run(page) {
  const res = [];
  const ok = (nom, cond, detail) => res.push({ nom, ok: !!cond, detail: detail === undefined ? undefined : String(detail).slice(0, 200) });
  const sortie = (n) => 'window.__BUILD__ = ' + JSON.stringify({ version: '1.0.44', build: n, hash: 'abc', sale: true, date: '2026-10-02 17:52', journal: [] }) + ';';
  await page.route('**/app/build-info.js*', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: sortie(r.request().url().includes('?v=') ? 101 : 100) }));
  await page.reload(); await page.waitForSelector('button.tab[data-tab]');
  const avant = await page.evaluate(() => !!document.querySelector('#nouvelle-version'));
  ok('pas de barre au chargement', !avant);
  await page.waitForSelector('#nouvelle-version', { timeout: 25000 }).catch(() => {});
  const barre = await page.evaluate(() => { const d = document.querySelector('#nouvelle-version'); return d ? d.innerText.replace(/\s+/g, ' ') : null; });
  ok('la barre « nouvelle version » apparait (build 101 > 100)', !!barre, barre);
  await page.screenshot({ path: 'C:/tmp/nouvelle_version.png' });
  await page.click('#nv-plus-tard');
  ok('« Plus tard » ferme la barre', await page.evaluate(() => !document.querySelector('#nouvelle-version')));
  // meme build : jamais de barre
  await page.unroute('**/app/build-info.js*');
  await page.route('**/app/build-info.js*', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: sortie(100) }));
  await page.reload(); await page.waitForSelector('button.tab[data-tab]'); await page.waitForTimeout(17000);
  ok('meme build : aucune barre', await page.evaluate(() => !document.querySelector('#nouvelle-version')));
  return { res, echecs: res.filter((x) => !x.ok).length };
}
