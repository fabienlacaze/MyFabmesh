// /admin2 : « Santé » = points du serveur + protections automatiques, en UNE liste (Maintenant ET Systeme), sans doublon, plus rien dans Argent
export default async function run(page) {
  const r = { echecs: [], infos: {} };
  const ok = (c, m) => { if (!c) r.echecs.push(m); };
  const compte = (txt, mot) => (txt.match(new RegExp(mot, 'g')) || []).length;
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => { try { localStorage.removeItem('admin2.volets'); } catch (_) {} });
  await page.goto(new URL(page.url()).origin + '/admin2#maintenant'); await page.reload(); await page.waitForTimeout(3500);
  const titres = await page.evaluate(() => Array.from(document.querySelectorAll('#p-maintenant details.vol > summary h2')).map((h) => h.textContent.replace(/\s+/g, ' ').trim()));
  r.infos.titres = titres;
  ok(/^Santé/.test(titres[0] || ''), 'Santé absente ou pas en tête de Maintenant : ' + titres.join(' | '));
  ok(!titres.some((t) => /^Protections automatiques/.test(t)), 'un volet « Protections automatiques » séparé subsiste dans Maintenant');
  const resume = await page.evaluate(() => (document.querySelector('details[data-id="m-sante"] .res') || {}).textContent || '');
  r.infos.resume = resume; ok(resume.length > 3 && resume !== '…', 'résumé vide : ' + JSON.stringify(resume));
  ok(!(await page.evaluate(() => document.querySelector('details[data-id="m-sante"]').open)), 'le volet devrait être fermé au départ');
  await page.click('details[data-id="m-sante"] > summary'); await page.waitForTimeout(600);
  const txt = await page.locator('#sante-m').innerText(); r.infos.lignes = txt.replace(/\s+/g, ' ').slice(0, 500);
  for (const m of ['Dettes de crédits', 'Clé Stripe', 'Arrêt automatique', 'Relevé de la facture', "E-mail d'alerte", 'Interrupteur']) ok(txt.indexOf(m) >= 0, 'ligne absente : ' + m);
  // doublons supprimes : un seul « Relevé de la facture », pas de « Alertes par e-mail » ni de « Relevé de la facture Modal »
  ok(compte(txt, 'Relevé de la facture') === 1, 'Relevé de la facture en double : ' + compte(txt, 'Relevé de la facture'));
  ok(txt.indexOf('Alertes par e-mail') < 0, '« Alertes par e-mail » (point serveur) double « E-mail d\'alerte »');
  ok(txt.indexOf('Relevé de la facture Modal') < 0, '« Relevé de la facture Modal » (point serveur) double « Relevé de la facture »');
  // meme liste dans Systeme
  await page.click('[data-tab="systeme"]'); await page.waitForTimeout(1800);
  await page.evaluate(() => { const d = document.querySelector('details[data-id="s-sante"]'); if (d && !d.open) d.open = true; });
  await page.waitForTimeout(400);
  const sys = await page.locator('#sante').innerText();
  { const A = txt.replace(/\s+/g, ' '), B = sys.replace(/\s+/g, ' '); let i = 0; while (i < A.length && A[i] === B[i]) i++; r.infos.diff = { i, maint: A.slice(Math.max(0, i - 40), i + 120), sys: B.slice(Math.max(0, i - 40), i + 120), lA: A.length, lB: B.length }; } ok(sys.replace(/\s+/g, ' ') === txt.replace(/\s+/g, ' '), 'Santé de Système différente de celle de Maintenant');
  ok(/Arrêt automatique/.test(sys) && /Plafond du jour/.test(sys), 'Système : protections absentes de Santé');
  r.infos.pastille = (await page.locator('#sante-etat').innerText()).trim();
  ok(/point\(s\) à traiter|prêt à vendre/.test(r.infos.pastille), 'pastille de Santé illisible : ' + r.infos.pastille);
  // Argent : plus de bloc protections, un renvoi
  await page.click('[data-tab="argent"]'); await page.waitForTimeout(1200);
  await page.click('details[data-id="a-gpu"] > summary'); await page.waitForTimeout(1800);
  const argent = await page.locator('#gpu-detail').innerText();
  ok(!(await page.locator('details[data-id="g-protections"]').count()), 'Argent : le bloc Protections existe encore');
  ok(/sont dans Santé/.test(argent), 'Argent : pas de renvoi vers Santé');
  r.ok = r.echecs.length === 0; return r;
}
