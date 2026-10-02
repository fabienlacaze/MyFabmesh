// /admin2 : pastille « annonce » dans la liste des maillages d'un compte, apercu 3D (liste des maillages + visionneuse des Creations)
export default async function run(page) {
  const r = { echecs: [], infos: {} };
  const ok = (c, m) => { if (!c) r.echecs.push(m); };
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => { try { localStorage.removeItem('admin2.volets'); } catch (_) {} });
  await page.reload(); await page.waitForTimeout(1500);
  await page.click('[data-tab="users"]'); await page.waitForTimeout(1200);
  await page.locator('#liste-comptes .ligne').first().click(); await page.waitForTimeout(400);
  await page.click('[data-actifs="meshes"]'); await page.waitForTimeout(900);
  const lignes = await page.locator('#actifs tbody tr').allInnerTexts();
  r.infos.lignes = lignes.map((x) => x.replace(/\s+/g, ' ').slice(0, 90));
  ok(lignes.some((x) => /annonce publiée/.test(x)), 'pastille « annonce publiée » absente');
  ok(lignes.some((x) => /annonce à valider/.test(x)), 'pastille « annonce à valider » absente');
  const b3d = page.locator('#actifs [data-apercu3d]');
  ok(await b3d.count() >= 1, 'bouton Aperçu 3D absent');
  await b3d.first().click(); await page.waitForTimeout(700);
  ok(await page.locator('#v3d').isVisible(), 'aperçu 3D : fenêtre non ouverte');
  r.infos.titre3d = (await page.locator('#v3d-titre').innerText()).slice(0, 60);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  ok(!(await page.locator('#v3d').isVisible()), 'aperçu 3D : Échap ne ferme pas');
  ok((await page.locator('#v3d-zone').innerHTML()) === '', 'aperçu 3D : zone non vidée à la fermeture');
  // Creations : onglet 3D -> visionneuse -> « Voir en 3D »
  ok(await page.evaluate(() => document.querySelector('details[data-id="f-creations"]').open), 'Créations de la fiche : pas ouvertes par défaut');
  await page.click('#cre-onglets [data-cre="3d"]'); await page.waitForTimeout(900);
  await page.locator('#galerie .vignette').first().click(); await page.waitForTimeout(400);
  ok(await page.locator('#lb-voir3d').isVisible(), 'visionneuse : bouton Voir en 3D absent');
  await page.click('#lb-voir3d'); await page.waitForTimeout(700);
  ok(await page.locator('#v3d').isVisible(), 'visionneuse : aperçu 3D non ouvert');
  await page.click('#v3d-fermer'); await page.waitForTimeout(300);
  ok(await page.locator('#lb').isVisible(), 'la visionneuse a disparu avec l\'aperçu 3D');
  r.ok = r.echecs.length === 0; return r;
}
