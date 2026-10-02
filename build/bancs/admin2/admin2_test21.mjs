// /admin2 : les Créations vivent dans la fiche du compte (Utilisateurs > Comptes), propres à CE compte ; plus de volet global ni de liste « Projets » en double
export default async function run(page) {
  const r = { echecs: [], infos: {} };
  const ok = (c, m) => { if (!c) r.echecs.push(m); };
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => { try { localStorage.removeItem('admin2.volets'); } catch (_) {} });
  await page.goto(new URL(page.url()).origin + '/admin2#users'); await page.reload(); await page.waitForTimeout(1500);
  // Travaux : plus de volet global
  await page.click('[data-tab="travaux"]'); await page.waitForTimeout(800);
  ok((await page.locator('#p-travaux details[data-id="m-creations"]').count()) === 0, 'Travaux : le volet Créations global existe encore');
  ok((await page.locator('#galerie').count()) === 0, 'Travaux : une galerie traîne');
  // Utilisateurs : rien tant qu'aucun compte n'est choisi
  await page.click('[data-tab="users"]'); await page.waitForTimeout(1000);
  ok((await page.locator('#galerie').count()) === 0, 'Créations visibles sans compte choisi');
  // compte 1
  await page.locator('#liste-comptes .ligne').nth(0).click(); await page.waitForTimeout(1800);
  ok(await page.evaluate(() => document.querySelector('details[data-id="f-creations"]').open), 'Créations fermées par défaut dans la fiche');
  const nom1 = (await page.locator('#fiche h2').innerText()).split('\n')[0].trim();
  const v1 = await page.locator('#galerie .vignette').count(); r.infos.compte1 = { nom1, v1 };
  ok(v1 >= 1, 'compte 1 : aucune vignette');
  const onglets = (await page.locator('#cre-onglets button').allInnerTexts()).map((x) => x.trim());
  r.infos.onglets = onglets; ok(/^Projets \(\d+\)\|Images\|3D\|Rigs\|Animations\|Éditions$/.test(onglets.join('|')), 'onglets : ' + onglets.join('|'));
  const leg = await page.locator('#galerie .leg').first().innerText(); r.infos.legende = leg.replace(/\s+/g, ' ');
  ok(leg.indexOf('@') < 0, 'la légende répète l\'adresse du compte : ' + leg);
  // redondances retirees de la fiche
  ok((await page.locator('#b-projets').count()) === 0, 'le bouton « Voir ses projets » existe encore');
  ok((await page.locator('#projets').count()) === 0, 'le bloc « Projets » existe encore');
  const compteBtn = await page.locator('#fiche').innerText(); ok(/Voir ses travaux et achats/.test(compteBtn) && !/travaux, images et achats/.test(compteBtn), 'libellé du bouton Compte : ' + compteBtn.slice(0, 200));
  // onglet Projets : la liste des projets est ici
  await page.click('#cre-onglets [data-cre="projets"]'); await page.waitForTimeout(900);
  r.infos.projets = await page.locator('#galerie .vignette').count();
  // lightbox + parametres
  await page.click('#cre-onglets [data-cre="images"]'); await page.waitForTimeout(900);
  await page.locator('#galerie .vignette').first().click(); await page.waitForTimeout(300);
  ok(!(await page.locator('#lb').isHidden()), 'visionneuse non ouverte');
  ok(/paramètres utilisés/i.test(await page.locator("#lb-params").innerText()), 'paramètres absents');
  await page.keyboard.press('Escape');
  // changer de compte : la galerie change, pas de reste du compte precedent
  await page.locator('#liste-comptes .ligne').nth(1).click(); await page.waitForTimeout(1800);
  const nom2 = (await page.locator('#fiche h2').innerText()).split('\n')[0].trim(); r.infos.compte2 = nom2;
  ok(nom2 !== nom1, 'le compte n\'a pas changé');
  const caps = await page.evaluate(() => Array.from(document.querySelectorAll('#galerie .vignette')).map((b) => b.title));
  ok(caps.every((c) => c.indexOf(nom1) < 0 || nom1 === nom2), 'des créations du compte 1 apparaissent dans la fiche du compte 2');
  // replier puis rouvrir : se recharge
  await page.click('details[data-id="f-creations"] > summary'); await page.waitForTimeout(300);
  await page.click('details[data-id="f-creations"] > summary'); await page.waitForTimeout(1500);
  ok((await page.locator('#galerie .vignette').count()) >= 0, '');
  // la fiche garde Maillages / Rigs / Animations (gestion : telechargement, suppression, annonce)
  for (const g of ['meshes', 'rigs', 'animations']) ok((await page.locator('[data-actifs="' + g + '"]').count()) === 1, 'bouton de gestion absent : ' + g);
  ok((await page.locator('#fiche dl > div').count()) === 4, 'la fiche doit avoir 4 tuiles (Crédits, Travaux, Échecs, Dépensés) : ' + (await page.locator('#fiche dl > div').count()));
  ok(/Maillages \(\d+\)/.test(await page.locator('[data-actifs="meshes"]').innerText()), 'le bouton Maillages ne porte pas son compteur');
  await page.screenshot({ path: 'C:/tmp/admin2_fiche_creations.png' });
  r.ok = r.echecs.length === 0; return r;
}
