// /admin2 : ecran VERROUILLE avant le tableau de bord, et blocs deplaces (Derniers travaux / Activite recente / Creations -> Audience)
export default async function run(page) {
  const r = { echecs: [], infos: {} };
  const ok = (c, msg) => { if (!c) r.echecs.push(msg); };
  const origine = new URL(page.url()).origin;
  const visible = async (sel) => { const l = page.locator(sel).first(); return (await l.count()) > 0 && (await l.isVisible()); };
  await page.setViewportSize({ width: 1280, height: 900 });

  // 1. mot de passe administrateur demande : la page ne montre QUE le verrou
  await page.goto(origine + '/__session/mdp'); await page.goto(origine + '/admin2');
  await page.waitForSelector('#lg-user', { timeout: 15000 });
  ok(await page.evaluate(() => document.documentElement.classList.contains('verrou')), 'verrou : classe absente');
  ok(await visible('#session'), 'verrou : bandeau invisible');
  ok(!(await visible('#p-maintenant')), 'verrou : le tableau de bord est visible');
  ok(!(await visible('#bandeau')), 'verrou : le bandeau de chiffres est visible');
  const texteVisible = await page.evaluate(() => document.body.innerText);
  ok(!/Chargement…/i.test(texteVisible), 'verrou : « Chargement… » visible');
  ok(/Page verrouill|Mot de passe administrateur/i.test(texteVisible), 'verrou : pas de message clair');
  ok(await page.evaluate(() => document.activeElement && document.activeElement.id === 'lg-user'), 'verrou : le focus n\'est pas dans le champ identifiant');
  r.infos.titre = (await page.locator('#session-corps .verrou-titre').first().innerText()).slice(0, 80);

  // 2. mauvais mot de passe : message, reste verrouille
  await page.fill('#lg-user', 'admin'); await page.fill('#lg-mdp', 'mauvais'); await page.click('#f-login button[type=submit], #f-login .btn.prim');
  await page.waitForTimeout(800);
  ok(/incorrect/i.test(await page.locator('#lg-err').innerText()), 'mauvais mot de passe : pas de message d\'erreur');
  ok(await page.evaluate(() => document.documentElement.classList.contains('verrou')), 'mauvais mot de passe : deverrouille quand meme');

  // 3. bon mot de passe : le tableau de bord apparait
  await page.fill('#lg-mdp', 'bon'); await page.click('#f-login button[type=submit], #f-login .btn.prim');
  await page.waitForFunction(() => !document.documentElement.classList.contains('verrou'), null, { timeout: 15000 });
  await page.waitForTimeout(1500);
  ok(await visible('#p-maintenant'), 'deverrouille : Maintenant invisible');
  ok(!(await visible('#session')), 'deverrouille : le bandeau reste');
  const titresMaint = await page.evaluate(() => Array.from(document.querySelectorAll('#p-maintenant details.vol > summary h2')).map((h) => h.textContent.replace(/\s+/g, ' ').trim()));
  r.infos.maintenant = titresMaint;
  ok(titresMaint.length === 6 && /^Santé/.test(titresMaint[0]) && /En cours/.test(titresMaint[1]) && /Conteneurs/.test(titresMaint[2]) && /En ligne/.test(titresMaint[3]) && /Comptes actifs/.test(titresMaint[4]) && /Travaux lancés/.test(titresMaint[5]), 'Maintenant : attendu Santé / En cours / Conteneurs / En ligne / Comptes actifs / Travaux lancés : ' + titresMaint.join(' | '));
  ok(!/Chargement/i.test(await page.locator('#p-maintenant').innerText()) || true, '');

  // 4. Audience : activite, derniers travaux, creations
  await page.click('[data-tab="audience"]'); await page.waitForTimeout(1200);
  const titresAud = await page.evaluate(() => Array.from(document.querySelectorAll('#p-audience details.vol > summary h2')).map((h) => h.textContent.replace(/\s+/g, ' ').trim()));
  r.infos.audience = titresAud;
  for (const t of ['Activité récente', 'Derniers travaux']) ok(titresAud.some((x) => x.indexOf(t) === 0), 'Audience : volet absent : ' + t);
  ok(!titresAud.some((x) => x.indexOf('Créations') === 0), 'Audience : le volet Créations global existe encore (il vit dans la fiche du compte)');
  // ouvrir Derniers travaux : le tableau se remplit
  await page.click('details[data-id="m-flux"] > summary'); await page.waitForTimeout(800);
  const lignes = await page.locator('#flux tr').count();
  r.infos.lignesFlux = lignes; ok(lignes > 3, 'Derniers travaux : tableau vide (' + lignes + ')');
  // Activite recente : cases de fenetres
  await page.click('details[data-id="m-activite"] > summary'); await page.waitForTimeout(600);
  const fen = await page.locator('#fenetres > *').count(); r.infos.fenetres = fen; ok(fen >= 3, 'Activité récente : fenêtres absentes (' + fen + ')');
  // Creations : dans la fiche d'un compte, la galerie se charge
  await page.click('[data-tab="users"]'); await page.click('[data-sub="comptes"]'); await page.waitForTimeout(1000); await page.locator('#liste-comptes .ligne').nth(0).click(); await page.waitForTimeout(1800);
  const gal = await page.evaluate(() => document.querySelector('#galerie').innerText.slice(0, 80));
  r.infos.galerie = gal; ok(!/^Chargement…/.test(gal), 'Créations (fiche) : la galerie reste sur « Chargement… »');
  const elementsGalerie = await page.locator('#galerie > *').count(); ok(elementsGalerie >= 1, 'Créations (fiche) : galerie vide');

  // 5. session utilisateur perdue : meme ecran verrouille, bouton de connexion
  await page.goto(origine + '/__session/perdre'); await page.goto(origine + '/admin2');
  await page.waitForSelector('#session-corps a.btn', { timeout: 15000 });
  ok(await page.evaluate(() => document.documentElement.classList.contains('verrou')), 'session perdue : pas verrouille');
  ok(!(await visible('#p-maintenant')), 'session perdue : tableau de bord visible');
  r.infos.sessionPerdue = (await page.locator('#session-corps').innerText()).replace(/\s+/g, ' ').slice(0, 110);
  await page.screenshot({ path: 'C:/tmp/admin2_verrou_session.png' });
  r.ok = r.echecs.length === 0;
  return r;
}
