export default async function run(page) {
  const res = [];
  const ok = (nom, cond, detail) => res.push({ nom, ok: !!cond, detail: detail === undefined ? undefined : String(detail).slice(0, 220) });
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.waitForSelector('button.tab[data-tab]');
  const requetes = [];
  page.on('request', (r) => { if (/\/api\/admin\/traces/.test(r.url())) requetes.push(decodeURIComponent(r.url())); });
  // 1. un filtre de PAYS traine (cas de la capture du user) : on clique un pays dans l'onglet Activite
  await page.click('button.tab[data-tab="travaux"]'); await page.waitForTimeout(1500);
  const pays = await page.$('#p-travaux [data-f="pays"]');
  if (pays) { await pays.click(); await page.waitForTimeout(400); }
  const chipsAvant = await page.evaluate(() => (document.querySelector('#chips') || document.body).innerText.replace(/\s+/g, ' ').slice(0, 160));
  ok('un filtre de pays est actif avant le clic', !!pays, chipsAvant);
  // 2. fiche d'un compte puis « Voir ses travaux et achats »
  await page.click('button.tab[data-tab="users"]'); await page.waitForSelector('#liste-comptes [data-sel]', { timeout: 15000 });
  const email = await page.evaluate(() => { const b = document.querySelector('#liste-comptes [data-sel]'); b.click(); return (b.innerText || '').split('\n')[0].trim(); });
  await page.waitForSelector('[data-goto-filtre]', { timeout: 8000 });
  const cible = await page.evaluate(() => document.querySelector('[data-goto-filtre]').dataset.gotoFiltre);
  await page.click('[data-goto-filtre]');
  await page.waitForTimeout(2200);
  const etat = await page.evaluate(() => ({
    onglet: (document.querySelector('button.tab[aria-selected="true"]') || {}).dataset.tab,
    titre: (document.querySelector('#t-flux') || {}).textContent,
    lignes: document.querySelectorAll('#flux tr').length,
    achatsVisible: !!document.querySelector('#flux-achats') && !document.querySelector('#flux-achats').hidden,
    achats: (document.querySelector('#flux-achats') || {}).innerText || null,
    carteHaut: Math.round(document.querySelector('details[data-id="m-flux"]').getBoundingClientRect().top),
    scrollY: Math.round(window.scrollY), vh: window.innerHeight,
    chips: (document.querySelector('#chips') || document.body).innerText.replace(/\s+/g, ' ').slice(0, 200)
  }));
  ok('on arrive dans l\'onglet Activite', etat.onglet === 'travaux', etat.onglet);
  ok('le compte est le seul filtre (le pays est efface)', /Compte/i.test(etat.chips) && !/Pays/i.test(etat.chips), etat.chips);
  ok('la liste des TRAVAUX du compte est affichee', etat.titre === 'Travaux' && etat.lignes > 0, 'titre=' + etat.titre + ' lignes=' + etat.lignes);
  ok('la carte « Travaux » est a l\'ecran (pas le haut de l\'onglet)', etat.carteHaut >= -5 && etat.carteHaut < etat.vh && etat.scrollY > 100, 'haut=' + etat.carteHaut + ' scrollY=' + etat.scrollY);
  ok('la liste est demandee au serveur PAR E-MAIL', requetes.some((u) => u.includes('email=' + cible)), requetes.slice(-2).join(' ; ').slice(0, 200));
  ok('lien « voir ses achats » present', etat.achatsVisible && /achats/.test(etat.achats || ''), etat.achats);
  await page.screenshot({ path: 'C:/tmp/voir_travaux.png' });
  // 3. le lien des achats mene a Argent, meme compte
  await page.evaluate(() => document.querySelector('#flux-achats [data-goto="argent"]').click());
  await page.waitForTimeout(1500);
  const arg = await page.evaluate(() => ({ onglet: (document.querySelector('button.tab[aria-selected="true"]') || {}).dataset.tab, chips: (document.querySelector('#chips') || document.body).innerText.replace(/\s+/g, ' ').slice(0, 120) }));
  ok('« voir ses achats » ouvre Argent avec le meme compte', arg.onglet === 'argent' && /Compte/i.test(arg.chips), JSON.stringify(arg));
  return { res, echecs: res.filter((x) => !x.ok).length, cible };
}
