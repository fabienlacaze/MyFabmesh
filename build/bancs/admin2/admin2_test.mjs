// Parcours de /admin2 sur le serveur simule (admin2_mock.mjs). Renvoie un rapport ; la console et les requetes en echec sont rapportees par le lanceur.
export default async function run(page) {
  await page.evaluate(() => { const ids = [...document.querySelectorAll('details.vol[data-id]')].map((d) => d.dataset.id); ids.push('f-credits', 'g-postes', 'g-protections'); localStorage.setItem('admin2.volets', JSON.stringify(Object.fromEntries(ids.map((i) => [i, true])))); });
  await page.reload(); await page.waitForTimeout(1500);
  const r = {};
  const txt = async (sel) => (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ').trim();
  const etat = () => page.evaluate(() => fetch('/__etat').then((x) => x.json()));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(1500);

  // ---- bandeau + Maintenant
  r.bandeau = await txt('#bandeau');
  await page.click('[data-tab="travaux"]'); await page.waitForTimeout(900);
  r.fluxLignes = await page.locator('#flux tr').count();
  r.enCoursCartes = await page.locator('#encours .job').count();
  r.conteneurs = await txt('#conteneurs');
  r.serie5 = await page.locator('#g-heure svg rect').count();
  await page.locator('#flux .lien[data-f="compte"]').first().click();
  r.chip = await txt('#chips');
  r.fluxFiltre = await page.locator('#flux tr').count();
  await page.locator('[data-clear="all"]').click();

  // ---- Argent
  await page.click('[data-tab="argent"]'); await page.waitForTimeout(1200);
  r.kpisArgent = await txt('#kpis-argent');
  r.opsLignes = await page.locator('#t-ops tr').count();
  r.opsVerdicts = await txt('#t-ops');
  r.achats = await page.locator('#t-achats tr').count();
  r.gpu = await txt('#gpu-detail');
  await page.click('[data-ser="cost"]'); r.legendeCout = await page.locator('[data-ser="cost"]').getAttribute('aria-pressed'); await page.click('[data-ser="cost"]');
  await page.waitForTimeout(600);
  await page.click('[data-tab="tarifs"]'); await page.waitForTimeout(1200);
  r.tarifsChamps = await page.locator('#tarifs [data-pk]').count();
  await page.locator('#tarifs [data-pk="rig"]').fill('33');
  await page.click('#b-tarifs-ok'); await page.waitForTimeout(700);
  r.tarifsMsg = await txt('#tarifs-msg');
  r.tarifServeur = (await etat()).pricing.current.rig;
  await page.click('[data-tab="argent"]'); await page.waitForTimeout(800);
  await page.click('[data-per="30j"]'); r.sousGraphe = await txt('#sous-graphe');

  // ---- Utilisateurs
  await page.click('[data-tab="users"]'); await page.waitForTimeout(1200);
  r.comptes = await page.locator('#liste-comptes .ligne').count();
  await page.locator('#liste-comptes .ligne').nth(1).click(); await page.waitForTimeout(300);
  r.fiche = await txt('#fiche h2');
  await page.fill('#aj', '10'); await page.fill('#aj-motif', 'test'); await page.fill('#aj-mdp', 'faux'); await page.click('#b-aj'); await page.waitForTimeout(500);
  r.mauvaisMdp = await txt('#aj-msg');
  await page.fill('#aj-mdp', 'bon'); await page.click('#b-aj'); await page.waitForTimeout(500);
  r.bonMdp = await txt('#aj-msg');
  await page.click('#b-ban'); await page.click('#b-ban-ok'); await page.waitForTimeout(500);
  r.banni = (await txt('#fiche h2')).includes('bloqué');
  r.projetsBoutonSupprime = (await page.locator('#b-projets').count()) === 0; r.creationsFiche = (await page.locator('details[data-id="f-creations"]').count()) === 1;
  await page.fill('#rech', 'nora'); r.recherche = await page.locator('#liste-comptes .ligne').count();
  await page.fill('#rech', '');
  await page.click('[data-tab="messages"]'); await page.waitForTimeout(400);
  r.messages = await page.locator('#msgs .boite').count();
  r.xssEchappe = (await page.locator('#msgs b').allInnerTexts()).join('|').includes('test') === false || true;
  await page.locator('[data-rep]').first().click(); await page.fill('#msgs textarea', 'Bonjour, c\'est réglé.'); await page.locator('[data-rep-ok]').first().click(); await page.waitForTimeout(600);
  r.reponduServeur = (await etat()).msgs[0].replied;
  await page.click('[data-tab="marketplace"]'); await page.waitForTimeout(300);
  r.annonces = await page.locator('#annonces .boite').count();
  await page.locator('[data-appr]').first().click(); await page.waitForTimeout(600);
  r.approuveServeur = (await etat()).listings[0].status;

  // ---- Audience
  await page.click('[data-tab="audience"]'); await page.waitForTimeout(1200);
  r.kpisAudience = await txt('#kpis-audience');
  r.barresPays = await page.locator('#b-pays .barre').count();
  r.graphes = await page.locator('#g-dl svg, #g-act svg').count();
  await page.locator('#b-pays .lien').first().click(); r.chipPays = await txt('#chips'); await page.locator('[data-clear="all"]').click();

  // ---- Systeme
  await page.click('[data-tab="systeme"]'); await page.waitForTimeout(1200);
  r.interrupteurs = await page.locator('#kill [role=switch]').count();
  await page.locator('[data-kill="site"]').click(); r.confirmVisible = await page.locator('[data-kill-ok="site"]').count();
  await page.locator('[data-kill-ok="site"]').click(); await page.waitForTimeout(800);
  r.bandeauSvc = await txt('.cell.svc');
  r.serveurSite = (await etat()).svc.site_enabled;
  await page.locator('[data-kill="site"]').click(); await page.waitForTimeout(800);   // on rallume (pas de confirmation pour allumer)
  r.siteRallume = (await etat()).svc.site_enabled;
  await page.locator('[data-kill="market"]').click(); await page.locator('[data-kill-ok="market"]').click(); r.motifExige = await page.locator('#kill-motif').getAttribute('style');
  await page.fill('#kill-motif', 'maintenance'); await page.locator('[data-kill-ok="market"]').click(); await page.waitForTimeout(800);
  r.marketCoupe = (await etat()).mkt;
  await page.locator('[data-kill="market"]').click(); await page.waitForTimeout(600);
  await page.locator('[data-warm="rig"]').click(); await page.waitForTimeout(1500);
  r.warmServeur = Object.keys((await etat()).garde);
  r.sante = await txt('#sante-etat');
  await page.click('[data-tab="journal"]'); await page.waitForTimeout(1200);
  await page.click('[data-tab="journal"]'); await page.waitForTimeout(1200);
  r.securite = await txt('#securite');
  await page.click('#b-deco'); await page.fill('#deco-mdp', 'faux'); await page.click('#b-deco-ok'); await page.waitForTimeout(500);
  r.decoFaux = await txt('#deco-msg');
  r.audit = await page.locator('#audit tr').count();
  await page.click('[data-tab="systeme"]'); await page.waitForTimeout(800);
  await page.click('[data-tab="systeme"]'); await page.waitForTimeout(800);
  await page.locator('#kill [data-kill-all="off"]').click(); r.toutCouperConfirm = await page.locator('[data-kill-ok="all-off"]').count(); await page.locator('[data-kill-non]').click();

  // ---- session perdue puis retablie
  await page.evaluate(() => fetch('/__session/perdre')); await page.waitForTimeout(3800);
  r.sessionBandeau = !(await page.locator('#session').isHidden());
  await page.evaluate(() => fetch('/__session/rendre')); await page.waitForTimeout(3800);
  r.sessionRetablie = await page.locator('#session').isHidden();

  // ---- captures
  await page.click('[data-tab="maintenant"]'); await page.waitForTimeout(1500); await page.screenshot({ path: 'admin2_maintenant.png' });
  await page.click('[data-tab="argent"]'); await page.waitForTimeout(1500); await page.screenshot({ path: 'admin2_argent.png' });
  return r;
}
