// Connexion integree, mot de passe oublie, deconnexion et limite GPU avec garde-fous (serveur simule).
export default async function run(page) {
  await page.evaluate(() => { const ids = [...document.querySelectorAll('details.vol[data-id]')].map((d) => d.dataset.id); ids.push('f-credits', 'g-postes', 'g-protections'); localStorage.setItem('admin2.volets', JSON.stringify(Object.fromEntries(ids.map((i) => [i, true])))); });
  await page.reload(); await page.waitForTimeout(1500);
  const r = {};
  const txt = async (sel) => (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ').trim();
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.waitForTimeout(1200);
  // --- limite GPU
  await page.click('[data-tab="argent"]'); await page.waitForTimeout(1500);
  r.ancienChampSupprime = (await page.locator('#lim-gpu').count()) === 0;
  await page.click('#b-lim-ouvrir');
  r.zoneVisible = !(await page.locator('#lim-zone').isHidden());
  r.boutonInactifAuDepart = await page.locator('#b-lim-ok').isDisabled();
  await page.fill('#lim-montant', '30'); await page.waitForTimeout(700);
  r.apercuDepasse = await txt('#lim-apercu'); r.boutonSansCase = await page.locator('#b-lim-ok').isDisabled();
  await page.check('#lim-fait'); r.boutonLibelle = await txt('#b-lim-ok'); r.boutonActif = !(await page.locator('#b-lim-ok').isDisabled());
  await page.fill('#lim-montant', '200'); await page.waitForTimeout(700); r.apercuOk = await txt('#lim-apercu');
  await page.click('#b-lim-ok'); await page.waitForTimeout(600); r.apresEnregistrement = await txt('#lim-apercu');
  await page.click('#b-lim-non');
  // --- connexion integree : mot de passe + 2FA
  await page.evaluate(() => fetch('/__session/mdp?totp=1')); await page.waitForTimeout(3800);
  r.formulaire = await page.locator('#f-login').count();
  await page.fill('#lg-mdp', 'faux'); await page.click('#f-login button[type=submit]'); await page.waitForTimeout(500); r.mauvaisMdp = await txt('#lg-err');
  await page.fill('#lg-mdp', 'bon'); await page.click('#f-login button[type=submit]'); await page.waitForTimeout(500);
  r.demande2fa = await txt('#lg-err'); r.ligne2fa = !(await page.locator('#lg-totp-ligne').isHidden());
  await page.fill('#lg-totp', '000000'); await page.click('#f-login button[type=submit]'); await page.waitForTimeout(500); r.mauvais2fa = await txt('#lg-err');
  await page.fill('#lg-totp', '123456'); await page.click('#f-login button[type=submit]'); await page.waitForTimeout(1500);
  r.bandeauCache = await page.locator('#session').isHidden();
  r.donneesRevenues = (await txt('#bandeau')).includes('EN LIGNE');
  // --- deconnexion
  await page.click('#b-logout'); await page.waitForTimeout(3800); r.revientAuFormulaire = await page.locator('#f-login').count();
  // --- mot de passe oublie
  await page.click('#b-oubli'); r.fpOuvert = !(await page.locator('#fp').isHidden());
  await page.click('#fp-envoyer'); await page.waitForTimeout(400); r.fpEtape2 = !(await page.locator('#fp-e2').isHidden()); r.fpMsg = await txt('#fp-msg');
  await page.fill('#fp-code', '111111'); await page.click('#fp-verifier'); await page.waitForTimeout(400); r.fpCodeFaux = await txt('#fp-msg');
  await page.fill('#fp-code', '654321'); await page.click('#fp-verifier'); await page.waitForTimeout(400); r.fpEtape3 = !(await page.locator('#fp-e3').isHidden());
  await page.fill('#fp-mdp1', 'court'); await page.fill('#fp-mdp2', 'court'); await page.click('#fp-valider'); r.fpTropCourt = await txt('#fp-msg');
  await page.fill('#fp-mdp1', 'un-mot-de-passe-de-plus-de-20-caracteres'); await page.fill('#fp-mdp2', 'different-de-plus-de-20-caracteres'); await page.click('#fp-valider'); r.fpDifferents = await txt('#fp-msg');
  await page.fill('#fp-mdp2', 'un-mot-de-passe-de-plus-de-20-caracteres'); await page.click('#fp-valider'); await page.waitForTimeout(500); r.fpSucces = await txt('#fp-msg');
  await page.waitForTimeout(2000); r.fpFerme = await page.locator('#fp').isHidden(); r.champPrerempli = (await page.inputValue('#lg-mdp')).length;
  // --- session utilisateur perdue : lien vers la connexion
  await page.evaluate(() => fetch('/__session/perdre')); await page.waitForTimeout(3800);
  r.lienConnexion = await page.locator('#session-corps a').first().getAttribute('href');
  await page.screenshot({ path: 'admin2_login.png' });
  return r;
}
