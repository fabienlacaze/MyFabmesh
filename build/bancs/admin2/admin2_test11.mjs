// Creations : onglets par type, visionneuse avec parametres a droite, texte saisi a la demande, suppression d'une image.
export default async function run(page) {
  const r = {};
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e.message || e)));
  await page.setViewportSize({ width: 1300, height: 900 });
  await page.evaluate(() => { try { localStorage.removeItem('admin2.volets'); } catch (_) {} });
  await page.reload(); await page.waitForTimeout(2500);
  await page.click('[data-tab="users"]'); await page.waitForTimeout(1000); await page.locator('#liste-comptes .ligne').nth(0).click(); await page.waitForTimeout(1800);
  r.volet = await page.evaluate(() => document.querySelector('details[data-id="f-creations"]').open);
  r.onglets = (await page.locator('#cre-onglets button').allInnerTexts()).map((x) => x.trim());
  r.actif = await page.evaluate(() => document.querySelector('#cre-onglets [aria-selected="true"]').dataset.cre);
  r.imagesVignettes = await page.locator('#galerie .vignette').count();
  r.resume = await page.evaluate(() => document.querySelector('#n-imgs').textContent);
  // visionneuse : parametres a droite
  await page.locator('#galerie .vignette').first().click(); await page.waitForTimeout(300);
  r.params = (await page.locator('#lb-params').innerText()).replace(/\s+/g, ' ');
  r.positions = await page.evaluate(() => { const a = document.querySelector('#lb-img').getBoundingClientRect(), b = document.querySelector('#lb-params').getBoundingClientRect(); return { imageGauche: Math.round(a.left), paramsGauche: Math.round(b.left), aDroite: b.left > a.right - 2 }; });
  r.texteMasque = !(await page.locator('#lb-params').innerText()).includes('chevalier en armure');
  await page.locator('#lb-voir-texte').click(); await page.waitForTimeout(500);
  r.texteApres = (await page.locator('#lb-texte').innerText()).replace(/\s+/g, ' ');
  r.scriptInjecte = await page.evaluate(() => !!document.querySelector('#lb-texte script'));
  r.supVisible = await page.locator('#lb-sup').isVisible();
  await page.screenshot({ path: 'admin2_creations_lb.png' });
  // navigation suivante : le texte redevient masque
  await page.click('#lb-suiv'); await page.waitForTimeout(200);
  r.texteReMasque = !(await page.locator('#lb-params').innerText()).includes('chevalier en armure');
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  r.ferme = await page.evaluate(() => document.querySelector('#lb').hidden);
  // onglet 3D : vignette sans image + telechargement
  await page.click('#cre-onglets [data-cre="3d"]'); await page.waitForTimeout(800);
  r.vign3d = await page.locator('#galerie .vignette').count();
  r.sansImage = await page.locator('#galerie .vignette .sans-img').count();
  await page.locator('#galerie .vignette').first().click(); await page.waitForTimeout(250);
  r.type3d = (await page.locator('#lb-params').innerText()).replace(/\s+/g, ' ').slice(0, 160);
  r.lien3d = await page.evaluate(() => { const a = document.querySelector('#lb-3d'); return { visible: !a.hidden, href: a.getAttribute('href') }; });
  r.pasDeSupp = !(await page.locator('#lb-sup').isVisible());
  r.pasImage = await page.evaluate(() => !document.querySelector('#lb-pas-image').hidden);
  await page.screenshot({ path: 'admin2_creations_3d.png' });
  await page.keyboard.press('Escape');
  // vide + projets + editions
  await page.click('#cre-onglets [data-cre="animations"]'); await page.waitForTimeout(600);
  r.vide = (await page.locator('#galerie').innerText()).trim();
  await page.click('#cre-onglets [data-cre="projets"]'); await page.waitForTimeout(600);
  r.projets = await page.locator('#galerie .vignette').count();
  await page.locator('#galerie .vignette').first().click(); await page.waitForTimeout(200);
  r.paramsProjet = (await page.locator('#lb-params').innerText()).replace(/\s+/g, ' ').slice(0, 200);
  r.pasTexteProjet = (await page.locator('#lb-voir-texte').count()) === 0;
  await page.keyboard.press('Escape');
  await page.click('#cre-onglets [data-cre="editions"]'); await page.waitForTimeout(600);
  r.editions = await page.locator('#galerie .vignette').count();
  await page.locator('#galerie .vignette').first().click(); await page.waitForTimeout(200);
  r.paramsEdition = (await page.locator('#lb-params').innerText()).replace(/\s+/g, ' ').slice(0, 200);
  r.supEdition = await page.locator('#lb-sup').isVisible();
  await page.keyboard.press('Escape');
  // retour aux images + suppression (double clic)
  await page.click('#cre-onglets [data-cre="images"]'); await page.waitForTimeout(500);
  const avant = await page.locator('#galerie .vignette').count();
  await page.locator('#galerie .vignette').first().click(); await page.waitForTimeout(200);
  await page.click('#lb-sup'); r.confirmation = (await page.locator('#lb-sup').innerText()).trim();
  await page.click('#lb-sup'); await page.waitForTimeout(500);
  r.avant = avant; r.apres = await page.locator('#galerie .vignette').count();
  r.erreurs = erreurs;
  return r;
}
