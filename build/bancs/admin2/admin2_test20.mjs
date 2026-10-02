// /admin2 (plan A) : « Sante » = points du serveur + protections automatiques en UNE liste triee (A traiter / En ordre) dans l'onglet Sante ; Vue d'ensemble n'en montre que les points a traiter ; rien dans Argent
export default async function run(page) {
  const r = { echecs: [], infos: {} };
  const ok = (c, m) => { if (!c) r.echecs.push(m); };
  const compte = (txt, mot) => (txt.match(new RegExp(mot, 'g')) || []).length;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => { try { localStorage.removeItem('admin2.volets'); } catch (_) {} });
  await page.goto(new URL(page.url()).origin + '/admin2#maintenant'); await page.reload(); await page.waitForTimeout(3500);
  // Vue d'ensemble : seulement ce qui est a traiter
  const titres = await page.evaluate(() => Array.from(document.querySelectorAll('#p-maintenant details.vol > summary h2')).map((h) => h.textContent.replace(/\s+/g, ' ').trim()));
  r.infos.titres = titres;
  ok(titres.some((t) => /^À traiter/.test(t)), 'Vue d ensemble : carte À traiter absente : ' + titres.join(' | '));
  const court = await page.locator('#sante-m').innerText(); r.infos.court = court.replace(/\s+/g, ' ').slice(0, 300);
  ok(/Clé Stripe/.test(court), 'Vue d ensemble : le point à traiter (Clé Stripe) manque');
  ok(!/Dettes de crédits|Arrêt automatique|Relevé de la facture/.test(court), 'Vue d ensemble : des points EN ORDRE sont affiches');
  ok(/Ouvrir Santé/.test(court), 'Vue d ensemble : lien vers Santé absent');
  // pastille de l'onglet
  const badge = await page.locator('#b-sante').innerText(); r.infos.badge = badge; ok(/^[1-9]/.test(badge.trim()), 'badge de l onglet Santé : ' + badge);
  // Sante : liste complete, groupee, sans doublon
  await page.click('[data-tab="systeme"]'); await page.waitForTimeout(1800);
  const txt = await page.locator('#sante').innerText(); r.infos.sante = txt.replace(/\s+/g, ' ').slice(0, 500);
  ok(/À TRAITER/i.test(txt) && /EN ORDRE/i.test(txt), 'Santé : groupes À traiter / En ordre absents');
  ok(txt.search(/À TRAITER/i) < txt.search(/EN ORDRE/i), 'Santé : « À traiter » doit précéder « En ordre »');
  for (const m of ['Dettes de crédits', 'Clé Stripe', 'Arrêt automatique', 'Relevé de la facture', "E-mail d'alerte", 'Interrupteur', 'Remboursement automatique']) ok(txt.indexOf(m) >= 0, 'ligne absente : ' + m);
  ok(compte(txt, 'Relevé de la facture') === 1, 'Relevé de la facture en double : ' + compte(txt, 'Relevé de la facture'));
  ok(txt.indexOf('Alertes par e-mail') < 0, '« Alertes par e-mail » (point serveur) double « E-mail d\'alerte »');
  ok(txt.indexOf('Relevé de la facture Modal') < 0, '« Relevé de la facture Modal » (point serveur) double « Relevé de la facture »');
  const pill = (await page.locator('#sante-etat').innerText()).trim(); r.infos.pastille = pill;
  ok(/point\(s\) à traiter|prêt à vendre/.test(pill), 'pastille de Santé illisible : ' + pill);
  // le lien « Ouvrir Santé » de la Vue d'ensemble mene bien ici
  await page.click('[data-tab="maintenant"]'); await page.waitForTimeout(600);
  await page.click('#sante-m [data-goto="systeme"]'); await page.waitForTimeout(600);
  ok(await page.evaluate(() => document.querySelector('.tab[aria-selected="true"]').dataset.tab) === 'systeme', 'le lien Ouvrir Santé ne mène pas à l onglet Santé');
  // Argent : plus de bloc protections, un renvoi
  await page.click('[data-tab="argent"]'); await page.waitForTimeout(1500);
  const argent = await page.locator('#gpu-detail').innerText();
  ok(!(await page.locator('details[data-id="g-protections"]').count()), 'Argent : le bloc Protections existe encore');
  ok(/sont dans l.onglet Santé/.test(argent), 'Argent : pas de renvoi vers Santé');
  r.ok = r.echecs.length === 0; return r;
}
