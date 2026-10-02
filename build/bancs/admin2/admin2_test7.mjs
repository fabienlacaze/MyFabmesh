// Fonctions portees de /admin : 2FA, diagnostic, arret de travaux, actifs d'un compte, suppression d'image, rapprochement, tarifs Windows, annonces (serveur simule).
export default async function run(page) {
  await page.evaluate(() => { const ids = [...document.querySelectorAll('details.vol[data-id]')].map((d) => d.dataset.id); ids.push('f-credits', 'g-postes', 'g-protections'); localStorage.setItem('admin2.volets', JSON.stringify(Object.fromEntries(ids.map((i) => [i, true])))); });
  await page.reload(); await page.waitForTimeout(1500);
  const r = {};
  const txt = async (sel) => (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ').trim();
  const etat = () => page.evaluate(() => fetch('/__etat').then((x) => x.json()));
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.waitForTimeout(1500);

  // ---- Maintenant : arret de travaux
  await page.click('[data-tab="travaux"]'); await page.waitForTimeout(1200);
  r.enCours = await page.locator('#encours .job').count();
  r.toutArreter = await page.locator('[data-stop="tous"]').count();
  await page.locator('[data-stop="j1"]').click(); await page.waitForTimeout(200);
  r.confirmArret = await page.locator('[data-stop-ok="j1"]').count();
  await page.locator('[data-stop-ok="j1"]').click(); await page.waitForTimeout(3600);
  r.apresArret = await page.locator('#encours .job').count(); r.msgArret = (await txt('#encours .note')).slice(0, 120);
  r.annuleServeur = (await etat()).annules;
  r.toutArreterApres = await page.locator('[data-stop="tous"]').count();

  // ---- galerie : suppression d'une image
  await page.click('[data-tab="users"]'); await page.waitForTimeout(1000); await page.locator('#liste-comptes .ligne').nth(0).click(); await page.waitForTimeout(1800);
  const avant = await page.locator('#galerie .vignette').count();
  await page.locator('#galerie .vignette').first().click(); await page.waitForTimeout(200);
  await page.click('#lb-sup'); r.libelleSup = await txt('#lb-sup'); await page.click('#lb-sup'); await page.waitForTimeout(600);
  r.galerieAvantApres = [avant, await page.locator('#galerie .vignette').count()];

  // ---- Utilisateurs : maillages, rigs
  await page.click('[data-tab="users"]'); await page.waitForTimeout(1200);
  await page.locator('#liste-comptes .ligne').first().click(); await page.waitForTimeout(300);
  await page.click('[data-actifs="meshes"]'); await page.waitForTimeout(500);
  r.maillages = await page.locator('#actifs tbody tr').count();
  await page.locator('[data-actif-sup]').first().click(); await page.locator('[data-actif-sup-ok]').first().click(); await page.waitForTimeout(500);
  r.maillagesApres = await page.locator('#actifs tbody tr').count();
  await page.click('[data-actifs="rigs"]'); await page.waitForTimeout(500);
  r.rigs = await page.locator('#actifs tbody tr').count(); r.rigSansSuppression = (await page.locator('#actifs [data-actif-sup]').count()) === 0;
  // annonces : prix, gratuit, suppression
  await page.click('[data-tab="marketplace"]'); await page.waitForTimeout(400);
  await page.locator('#annonces .boite input[type=number]').first().fill('25'); await page.locator('[data-prix]').first().click(); await page.waitForTimeout(600);
  r.prixAnnonce = (await etat()).prixAnnonce;
  r.offertAbsentSiNonPublie = (await page.locator('#annonces [data-offert]').count()) === 0;
  await page.locator('[data-ms="approved"]').click(); await page.waitForTimeout(300);
  await page.locator('[data-offert]').first().check(); await page.waitForTimeout(600); r.offerts = (await etat()).offerts;
  await page.locator('[data-supann]').first().click(); await page.locator('[data-supann-ok]').first().click(); await page.waitForTimeout(700);
  r.annoncesApres = await page.locator('#annonces .boite').count();

  // ---- Argent : rapprochement, tarifs Windows, exports
  await page.click('[data-tab="argent"]'); await page.waitForTimeout(1500);
  r.reconVisible = !(await page.locator('#recon').isHidden());
  await page.locator('[data-recon="0"]').click(); await page.fill('#rc-mdp', 'faux'); await page.click('#rc-ok'); await page.waitForTimeout(500); r.reconMauvais = await txt('#rc-msg');
  await page.fill('#rc-mdp', 'bon'); await page.click('#rc-ok'); await page.waitForTimeout(900); r.reconOk = await txt('#recon-form');
  await page.waitForTimeout(500); r.reconCache = await page.locator('#recon').isHidden();
  r.exports = await page.locator('a[href^="/api/admin/history"]').count();
  await page.waitForTimeout(600);
  await page.click('[data-tab="tarifs"]'); await page.waitForTimeout(1000);
  r.blocWindows = await page.locator('#tar-d-prix').inputValue(); await page.fill('#tar-d-prix', '49.99'); await page.uncheck('#tar-d-gratuit');
  await page.click('#b-tarifs-ok'); await page.waitForTimeout(800);
  const pr = (await etat()).pricing.current; r.tarifWindows = [pr.desktop_prix_centimes, pr.desktop_gratuit];

  // ---- Systeme : 2FA et diagnostic
  await page.click('[data-tab="journal"]'); await page.waitForTimeout(1500);
  r.statut2fa = await txt('#securite .sw');
  await page.click('#b-2fa-remplacer'); await page.waitForTimeout(500);
  r.qrOuFallback = (await page.locator('#totp-qr svg').count()) + ' svg / ' + (await page.locator('#securite .note').count()) + ' notes';
  r.cle = (await txt('#securite .confirm div.tn')).slice(0, 20);
  await page.fill('#tp-actuel', '000000'); await page.fill('#tp-code', '123456'); await page.click('#b-2fa-ok'); await page.waitForTimeout(500); r.remplMauvaisActuel = await txt('#tp-err');
  await page.fill('#tp-actuel', '654321'); await page.click('#b-2fa-ok'); await page.waitForTimeout(800); r.remplOk = await txt('#securite .msg-ok');
  r.retirerAbsent = (await page.locator('#b-2fa-retirer').count()) === 0;
  r.noteRetrait = (await txt('#securite .sw .d')).includes('ne peut pas être retirée');
  await page.evaluate(() => fetch('/__totp/reset')); await page.click('[data-tab="maintenant"]'); await page.click('[data-tab="journal"]'); await page.waitForTimeout(1200);
  await page.click('#b-2fa-activer'); await page.waitForTimeout(500); await page.fill('#tp-code', '123456'); await page.click('#b-2fa-ok'); await page.waitForTimeout(900); r.activerOk = await txt('#securite .msg-ok');
  await page.click('#b-dbg'); await page.waitForTimeout(800);
  r.traces = await page.locator('#dbg-traces tr').count(); r.logs = await page.locator('#dbg-logs tr').count();
  await page.locator('[data-trace="0"]').click(); r.detail = (await txt('#dbg-viewer')).slice(0, 80);
  await page.locator('#dbg-traces [data-log]').first().click(); await page.waitForTimeout(500); r.rapport = await txt('#dbg-viewer');
  await page.check('#dbg-echecs'); await page.click('#b-dbg'); await page.waitForTimeout(700); r.tracesEchecs = await page.locator('#dbg-traces tr').count();
  r.pied = await txt('.pied');
  await page.screenshot({ path: 'admin2_systeme.png' });
  return r;
}
