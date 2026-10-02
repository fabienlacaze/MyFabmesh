export default async function run(page) {
  await page.setViewportSize({ width: 1500, height: 1500 });
  await page.click('button.tab[data-tab="argent"]');
  await page.waitForSelector('#carte-banc:not([hidden])', { timeout: 15000 });
  await page.waitForTimeout(1200);
  const info = await page.evaluate(() => {
    const c = document.querySelector('#carte-banc');
    c.open = true; c.scrollIntoView({ block: 'start' });
    const lignes = Array.from(c.querySelectorAll('tbody tr')).map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => td.innerText.replace(/\s+/g, ' ').trim().slice(0, 40)).join(' | '));
    const verdicts = Array.from(document.querySelectorAll('#t-ops tr')).filter((tr) => /Redressement auto|Géométrie fine|Texture nette 8K|Triangles max|Affinage|Correction du visage|Arêtes nettes|Texture lissée/.test(tr.innerText)).map((tr) => { const td = tr.querySelectorAll('td'); return td[0].innerText.split('\n')[0] + ' => coût ' + td[4].innerText.trim() + ' | ' + td[8].innerText.trim(); });
    return { titre: c.querySelector('summary').innerText.replace(/\s+/g, ' '), lignes, verdicts };
  });
  await page.screenshot({ path: 'C:/tmp/carte_banc.png' });
  return info;
}
