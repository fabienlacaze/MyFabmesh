// Test navigateur de /admin2 (faux serveur) : les trois acces du haut de page (Marketplace, site Desktop / Cloud, appli Cloud).
// Lancer : voir run_admin2_tests.sh (copier ce fichier en C:/tmp/admin2_test_liens.mjs, faux serveur sur le port 8799).
export default async function run(page) {
  const res = [];
  const ok = (nom, cond, detail) => res.push({ nom, ok: !!cond, detail: detail === undefined ? undefined : String(detail).slice(0, 240) });
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.waitForSelector('.liens-site a');
  const lire = () => page.evaluate(() => {
    const cs = (el) => getComputedStyle(el);
    const ref = document.querySelector('#b-refresh');
    const rr = ref.getBoundingClientRect();
    return {
      liens: [...document.querySelectorAll('.liens-site a')].map((a) => {
        const r = a.getBoundingClientRect(); const s = cs(a);
        return { id: a.id, href: a.getAttribute('href'), target: a.target, rel: a.rel, texte: a.innerText.replace(/\s+/g, ' ').trim(), nom: a.getAttribute('aria-label') || a.title,
          largeur: Math.round(r.width), haut: Math.round(r.top), bas: Math.round(r.bottom), droite: Math.round(r.right), gauche: Math.round(r.left),
          fond: s.backgroundColor, couleur: s.color, bordure: s.borderTopColor, rayon: s.borderTopLeftRadius, police: s.fontSize, deco: s.textDecorationLine };
      }),
      ref: { haut: Math.round(rr.top), bas: Math.round(rr.bottom), fond: cs(ref).backgroundColor, couleur: cs(ref).color, bordure: cs(ref).borderTopColor, rayon: cs(ref).borderTopLeftRadius, police: cs(ref).fontSize },
      vw: window.innerWidth, defil: document.documentElement.scrollWidth
    };
  });

  // 1. grand ecran : trois liens, bons href, nouvel onglet, noopener, meme allure que les boutons voisins
  let e = await lire();
  ok('trois liens dans le haut de page', e.liens.length === 3, e.liens.map((l) => l.id).join(','));
  const attendu = { 'l-market': '/market', 'l-vitrine': 'https://fabienlacaze.github.io/MyFabmesh/', 'l-cloud': '/app/' };
  for (const l of e.liens) {
    ok(l.id + ' : adresse', l.href === attendu[l.id], l.href);
    ok(l.id + ' : nouvel onglet + noopener', l.target === '_blank' && /noopener/.test(l.rel), l.target + ' / ' + l.rel);
    ok(l.id + ' : visible et lisible', l.largeur > 40 && /\w/.test(l.texte), l.largeur + ' px | ' + l.texte);
    ok(l.id + ' : meme allure qu\'un bouton (fond, texte, bordure, rayon, police, pas de soulignement)',
      l.fond === e.ref.fond && l.couleur === e.ref.couleur && l.bordure === e.ref.bordure && l.rayon === e.ref.rayon && l.police === e.ref.police && l.deco === 'none',
      JSON.stringify({ lien: [l.fond, l.couleur, l.bordure, l.rayon, l.police, l.deco], bouton: [e.ref.fond, e.ref.couleur, e.ref.bordure, e.ref.rayon, e.ref.police] }));
  }
  ok('sur la meme ligne que le titre (grand ecran)', e.liens.every((l) => Math.abs(l.haut - e.ref.haut) <= 14), JSON.stringify(e.liens.map((l) => l.haut)) + ' / bouton ' + e.ref.haut);
  ok('a droite du bouton Deconnexion', e.liens.every((l) => l.gauche > 300), JSON.stringify(e.liens.map((l) => l.gauche)));
  ok('pas de defilement horizontal (grand ecran)', e.defil <= e.vw + 1, e.defil + ' / ' + e.vw);
  await page.screenshot({ path: 'C:/tmp/liens_site_grand.png', clip: { x: 0, y: 0, width: 1500, height: 260 } });

  // 2. clavier : Tab depuis Deconnexion atteint les trois liens dans l'ordre, avec un contour visible
  await page.focus('#b-logout');
  const ordre = []; let contour = true;
  for (let k = 0; k < 3; k++) {
    await page.keyboard.press('Tab');
    const f = await page.evaluate(() => { const a = document.activeElement; const s = getComputedStyle(a); return { id: a.id, contour: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2 }; });
    ordre.push(f.id); contour = contour && f.contour;
  }
  ok('Tab atteint les trois liens dans l\'ordre', ordre.join(',') === 'l-market,l-vitrine,l-cloud', ordre.join(','));
  ok('un contour de focus est visible sur chaque lien', contour);

  // 3. un clic ouvre un NOUVEL onglet et laisse /admin2 ouvert (session intacte)
  const ctx = page.context();
  await ctx.route(/fabienlacaze\.github\.io/, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>vitrine</title>' }));
  const urls = [];
  for (const id of ['l-market', 'l-vitrine', 'l-cloud']) {
    try {
      const [popup] = await Promise.all([page.waitForEvent('popup', { timeout: 8000 }), page.click('#' + id)]);
      urls.push(popup.url());
      await popup.close();
    } catch (er) { urls.push('ECHEC ' + String(er.message).slice(0, 80)); }
  }
  ok('Marketplace s\'ouvre dans un nouvel onglet', /\/market$/.test(urls[0] || ''), urls[0]);
  ok('le site Desktop / Cloud s\'ouvre dans un nouvel onglet', /fabienlacaze\.github\.io\/MyFabmesh\/?$/.test(urls[1] || ''), urls[1]);
  ok('l\'appli Cloud s\'ouvre dans un nouvel onglet', /\/app\/$/.test(urls[2] || ''), urls[2]);
  const reste = await page.evaluate(() => ({ chemin: location.pathname, onglets: document.querySelectorAll('button.tab[data-tab]').length, formulaire: !!document.querySelector('#f-login') }));
  ok('/admin2 reste ouvert et connecte apres les clics', reste.chemin === '/admin2' && reste.onglets >= 5 && !reste.formulaire, JSON.stringify(reste));

  // 4. telephone : rien ne deborde, les trois liens restent atteignables
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  e = await lire();
  ok('telephone : pas de defilement horizontal', e.defil <= e.vw + 1, e.defil + ' / ' + e.vw);
  ok('telephone : les trois liens sont dans l\'ecran', e.liens.length === 3 && e.liens.every((l) => l.gauche >= 0 && l.droite <= e.vw), JSON.stringify(e.liens.map((l) => [l.gauche, l.droite])));
  await page.screenshot({ path: 'C:/tmp/liens_site_tel.png', clip: { x: 0, y: 0, width: 390, height: 330 } });
  return { res, echecs: res.filter((x) => !x.ok).length };
}
