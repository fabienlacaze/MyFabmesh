export default async function run(page) {
  const erreurs = [];
  page.on('pageerror', e => erreurs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') erreurs.push('console: ' + m.text().slice(0, 160)); });
  page.on('requestfailed', r => erreurs.push('requestfailed: ' + r.url().slice(0, 100)));
  page.on('response', r => { if (r.status() >= 400) erreurs.push('HTTP ' + r.status() + ' ' + r.url().slice(0, 100)); });
  await page.setViewportSize({ width: 1400, height: 1000 });
  const onglets = await page.evaluate(() => Array.from(document.querySelectorAll('button.tab[data-tab]')).map(b => b.dataset.tab));
  const rapport = {};
  for (const t of onglets) {
    const avant = erreurs.length;
    await page.click('button.tab[data-tab="' + t + '"]');
    await page.waitForTimeout(1200);
    const info = await page.evaluate((t) => {
      const p = document.getElementById('p-' + t);
      const vis = p && !p.hidden && p.offsetParent !== null;
      const boutons = p ? Array.from(p.querySelectorAll('button, [role=button], a.btn, input, select')).filter(e => e.offsetParent !== null).length : 0;
      const vides = p ? Array.from(p.querySelectorAll('.vide')).map(e => e.textContent.trim().slice(0, 50)) : [];
      return { vis, boutons, vides, texte: p ? p.innerText.length : 0 };
    }, t);
    rapport[t] = { ...info, erreurs: erreurs.slice(avant) };
  }
  return { onglets, rapport, erreursTotal: erreurs.length };
}
