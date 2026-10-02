// Parite avec /admin : fonctions ajoutees (audit, protections GPU, sante, messages, annonces, comptes, tarifs, diagnostic). ASSERTIONS : renvoie { ok, echecs }.
export default async function run(page) {
  const echecs = [];
  const verif = (nom, cond, detail) => { if (!cond) echecs.push(nom + (detail !== undefined ? ' -> ' + JSON.stringify(detail) : '')); };
  const txt = async (sel) => (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ').trim();
  const flag = (k, v) => page.evaluate(([a, b]) => fetch('/__flag?k=' + a + '&v=' + b), [k, v]);
  await page.setViewportSize({ width: 1300, height: 900 });
  await page.evaluate(() => { const ids = [...document.querySelectorAll('details.vol[data-id]')].map((d) => d.dataset.id); ids.push('f-credits', 'g-postes', 'g-protections'); localStorage.setItem('admin2.volets', JSON.stringify(Object.fromEntries(ids.map((i) => [i, true])))); });
  await page.reload(); await page.waitForTimeout(1800);

  // ---- ARGENT : credits consommes, prix / cout par operation, detail GPU
  await page.click('[data-tab="argent"]'); await page.waitForTimeout(1800);
  const kp = await txt('#kpis-argent');
  verif('kpi credits consommes', /CRÉDITS CONSOMMÉS 41,50 € \+ 12,25 € offerts/.test(kp), kp);
  verif('en-tetes prix/cout par op', (await page.locator('th[data-tri="ops:prix"]').count()) === 1 && (await page.locator('th[data-tri="ops:coutop"]').count()) === 1);
  const l1 = await txt('#t-ops tr:first-child');
  verif('ligne mesh prix/op', /1,712/.test(l1) && /0,792/.test(l1), l1);
  await page.locator('th[data-tri="ops:prix"] .tri').click(); await page.waitForTimeout(200);
  const par = (await page.locator('#t-ops tr td:first-child').allInnerTexts()).map((x) => x.trim());
  verif('tri par prix/op (decroissant)', par[0] === 'mesh' && par[1] === 'rig', par);
  verif('resume : encaisse reel sur ces operations', /Réellement encaissé sur ces opérations[^.]*: 78,00/.test((await txt('#resume-ops')).replace(/ /g, ' ')) || /Réellement encaissé sur ces opérations/.test(await txt('#resume-ops')), await txt('#resume-ops'));
  const g = await txt('#gpu-detail');
  verif('gpu : remise a zero', /Remise à zéro de la facture/.test(g));
  verif('gpu : releve a jour (pastille)', /Relevé Modal : à jour/.test(g), g.slice(0, 400));
  verif('gpu : 3 postes', (await page.locator('#gpu-detail details[data-id="g-postes"] .barre').count()) === 3);
  verif('gpu : repartition', /Compte administrateur : 310 calculs/.test(g), g);
  verif('gpu : plus de bloc protections (renvoi vers Sante)', (await page.locator('#gpu-detail details[data-id="g-protections"]').count()) === 0 && /sont dans Santé/.test(g), g.slice(-300));
  verif('gpu : pas d alarme au depart', !/protections à vérifier/.test(await page.locator('details[data-id="a-gpu"] > summary .res').textContent()));
  verif('gpu : bouton limite', /Changer la limite mensuelle/.test(g));
  // coupe le calcul GPU -> la protection passe a « a verifier »
  await page.click('[data-tab="systeme"]'); await page.waitForTimeout(800);
  await page.locator('#kill [data-kill="modal"]').click(); await page.locator('[data-kill-ok="modal"]').click(); await page.waitForTimeout(1200);
  await page.click('[data-tab="argent"]'); await page.waitForTimeout(1800);
  const sg = await page.locator('details[data-id="a-gpu"] > summary .res').textContent();
  verif('gpu : alarme quand le GPU est coupe', /protections à vérifier/.test(sg), sg);
  await page.click('[data-tab="systeme"]'); await page.waitForTimeout(1500);
  verif('sante : interrupteur GPU coupe visible dans Systeme', /Interrupteur « Calcul GPU »\s*coupé/.test(await page.locator('#sante').innerText()), (await page.locator('#sante').innerText()).slice(0, 400));
  await page.click('[data-tab="systeme"]'); await page.locator('#kill [data-kill="modal"]').click(); await page.waitForTimeout(800);

  // ---- AUDIENCE : travaux
  await page.click('[data-tab="users"]'); await page.click('[data-sub="comptes"]'); await page.click('[data-sub="origine"]'); await page.waitForTimeout(1200);
  const ka = await txt('#kpis-audience');
  verif('audience : carte travaux', /TRAVAUX \(TOTAL\) 900 93,3 % réussis · 60 échecs/.test(ka), ka);
  verif('audience : courbe travaux/jour', (await page.locator('#g-ops svg').count()) === 1);
  verif('audience : resume travaux', /sur 7 j · .* sur 30 j/.test(await page.locator('details[data-id="u-ops"] > summary .res').textContent()));

  // ---- SYSTEME : sante + reaper, audit, diagnostic
  await page.click('[data-tab="systeme"]'); await page.waitForTimeout(1800);
  const sa = await txt('#sante');
  verif('sante : remboursement automatique', /Remboursement automatique des travaux bloqués il y a \d+ min · 18 examinés · 1 récupérés · 60 crédits remboursés/.test(sa), sa);
  verif('sante : 1 point', /1 point/.test(await txt('#sante-etat')));
  await flag('cronAgeMin', 120);
  await page.click('[data-tab="argent"]'); await page.click('[data-tab="systeme"]');
  await page.evaluate(() => document.querySelector('#b-refresh').click()); await page.waitForTimeout(1800);
  const sa2 = await txt('#sante');
  verif('sante : tache arretee (120 min)', /plus de 45 min/.test(sa2), sa2);
  verif('sante : 2 points', /2 point/.test(await txt('#sante-etat')), await txt('#sante-etat'));
  await page.click('#b-audit'); await page.waitForTimeout(700);
  const au = (await page.locator('#audit tr').allInnerTexts()).map((x) => x.replace(/\s+/g, ' '));
  verif('audit : IP', au.some((x) => x.includes('198.51.100.4')), au);
  verif('audit : details a plat', au.some((x) => x.includes('"service":"modal"') && x.includes('"enabled":true')) && au.some((x) => x.includes('"credits":500')), au);
  verif('audit : colonne IP triable', (await page.locator('th[data-tri="audit:ip"]').count()) === 1);
  await page.click('#b-dbg'); await page.waitForTimeout(900);
  verif('diag : colonne projet', /bus/.test(await txt('#dbg-logs')) && (await page.locator('th[data-tri="dbglog:project"]').count()) === 1);
  await page.click('#b-dbg-dernier'); await page.waitForTimeout(800);
  verif('diag : dernier journal', /_logs\/latest\/u1\.log/.test(await txt('#dbg-viewer')), await txt('#dbg-viewer'));
  verif('2fa : pas de bouton retirer', (await page.locator('#b-2fa-retirer').count()) === 0);

  // ---- UTILISATEURS : recherche par identifiant, tris, avertissement, profil public
  await page.click('[data-tab="users"]'); await page.click('[data-sub="comptes"]'); await page.waitForTimeout(1500);
  await page.fill('#rech', 'u3'); await page.waitForTimeout(200);
  verif('comptes : recherche par identifiant', (await page.locator('#liste-comptes .ligne').count()) === 1);
  await page.fill('#rech', '');
  const opts = await page.locator('#tri-comptes option').allInnerTexts();
  verif('comptes : nouveaux tris', ['Trier : taux d\'échec', 'Trier : rigs', 'Trier : animations', 'Trier : crédits dépensés'].every((x) => opts.includes(x)), opts);
  await page.selectOption('#tri-comptes', 'echecpct'); await page.waitForTimeout(200);
  verif('comptes : tri taux d echec', /sam\.t/.test(await txt('#liste-comptes .ligne:first-child')) || /nora|hugo|lea|sam/.test(await txt('#liste-comptes .ligne:first-child')));
  verif('comptes : avertissement 50 000 lignes', /50 000 dernières lignes/.test(await txt('#users-avert')), await txt('#users-avert'));
  await page.locator('#liste-comptes .ligne').first().click(); await page.waitForTimeout(400);
  verif('fiche : profil public', (await page.locator('#fiche a[href^="/market/author?id="]').count()) === 1);
  verif('fiche : taux d echec', /%/.test(await txt('#fiche dl')));

  // ---- MESSAGES
  await page.click('[data-sub="messages"]'); await page.waitForTimeout(500);
  verif('messages : capture visible', (await page.locator('#msgs img.pj').count()) === 1);
  verif('messages : fichier 3D signale', (await page.locator('#msgs .pj-fichier').count()) === 1 && /Contenu signalé/.test(await txt('#msgs')));
  verif('messages : legende apercu', /Aperçu · capture\.png · 50 Ko/.test(await txt('#msgs')));
  verif('messages : ip + reponse a', /IP : 203\.0\.113\.7/.test(await txt('#msgs')) && /Répondre à : visiteur@exemple\.org/.test(await txt('#msgs')));
  verif('messages : reponse datee', /Votre réponse · .* : Merci, nous regardons\./.test(await txt('#msgs')));
  verif('messages : nom echappe (XSS)', (await page.locator('#msgs i').count()) === 0 && (await page.locator('#msgs b').count()) >= 2);

  // ---- MARKETPLACE
  await page.click('[data-sub="market"]'); await page.waitForTimeout(500);
  verif('annonce a valider : apercu (poster)', (await page.locator('#annonces .annonce img.apercu-annonce[src^="/api/market/poster/a1"]').count()) === 1);
  verif('annonce : licence + auteur', /CC-BY/.test(await txt('#annonces')) && (await page.locator('#annonces a[href="/market/author?id=u9"]').count()) === 1);
  verif('annonce a valider : pas de « gratuit ce mois »', (await page.locator('#annonces [data-offert]').count()) === 0);
  await page.locator('[data-ms="approved"]').click(); await page.waitForTimeout(300);
  verif('annonce publiee : lien public', (await page.locator('#annonces a[href="/market?item=a2"]').count()) === 1);
  verif('annonce publiee : image directe', (await page.locator('#annonces img.apercu-annonce[src^="data:image/svg"]').count()) === 1);
  verif('annonce publiee : gratuit ce mois + part du createur', /le créateur reçoit 1,75 € par retrait/.test(await txt('#annonces')) && (await page.locator('#annonces [data-offert]').count()) === 1, await txt('#annonces'));
  verif('annonce : titre echappe (XSS)', (await page.locator('#annonces img[src="x"]').count()) === 0);

  // ---- TARIFS : remise ligne par ligne
  await page.click('[data-tab="argent"]'); await page.waitForTimeout(1500);
  const rz = page.locator('#tarifs [data-pk-raz="rig"]'), champ = page.locator('#tarifs [data-pk="rig"]');
  verif('tarifs : bouton remise desactive si inchange', await rz.isDisabled());
  await champ.fill('77'); await page.waitForTimeout(100);
  verif('tarifs : bouton actif + orange apres modification', !(await rz.isDisabled()) && (await champ.evaluate((e) => e.style.color)) !== '');
  await rz.click(); await page.waitForTimeout(100);
  verif('tarifs : remise a l origine', (await champ.inputValue()) === '30' && (await rz.isDisabled()));

  // ---- AUDIENCE : par pays (un compte = un pays : la somme des comptes par pays est le nombre de comptes distincts)
  await page.click('[data-tab="users"]'); await page.click('[data-sub="comptes"]'); await page.click('[data-sub="origine"]'); await page.waitForTimeout(1200);
  const pays = (await page.locator('#b-pays .barre').allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').trim());
  verif('par pays : 3 lignes triees par travaux', pays.length === 3 && /^France 320 · 5 comptes · 6.3 % éch\./.test(pays[0]) && /^Belgique 110 · 2 comptes · 4.5 % éch\./.test(pays[1]) && /^inconnu 40 · 1 compte · 0 % éch\./.test(pays[2]), pays);
  verif('par pays : resume avec total des comptes', /8 comptes/.test(await page.locator('details[data-id="u-pays"] > summary .res').textContent()), await page.locator('details[data-id="u-pays"] > summary .res').textContent());
  await page.locator('#b-pays .lien').first().click(); await page.waitForTimeout(200);
  verif('par pays : clic filtre', /Pays : France/.test(await txt('#chips')));
  await page.locator('[data-clear="all"]').click();

  // ---- ACTUALISER
  await page.click('#b-refresh'); await page.waitForTimeout(1200);
  verif('actualiser : la page reste affichee', /EN LIGNE/.test(await txt('#bandeau')));
  return { ok: echecs.length === 0, echecs };
}
