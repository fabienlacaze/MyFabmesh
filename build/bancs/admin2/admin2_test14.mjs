// Accessibilite de base : onglets ARIA, focus visible, ordre de tabulation (volets fermes / ouverts), noms accessibles, dialogues, contraste. ASSERTIONS.
export default async function run(page) {
  const echecs = [], infos = {};
  const verif = (nom, cond, detail) => { if (!cond) echecs.push(nom + (detail !== undefined ? ' -> ' + JSON.stringify(detail) : '')); };
  const erreurs = []; page.on('pageerror', (e) => erreurs.push(String(e.message || e)));
  await page.setViewportSize({ width: 1300, height: 900 });
  await page.evaluate(() => { try { localStorage.removeItem('admin2.volets'); } catch (_) {} });
  await page.reload(); await page.waitForTimeout(2200);

  // ---- onglets ARIA
  const onglets = await page.evaluate(() => Array.from(document.querySelectorAll('[role=tab][data-tab]')).map((b) => { const c = document.getElementById(b.getAttribute('aria-controls')); return { id: b.id, ctl: !!c, lab: c && c.getAttribute('aria-labelledby') === b.id, tab: b.tabIndex, sel: b.getAttribute('aria-selected') }; }));
  verif('onglets : aria-controls/aria-labelledby', onglets.length === 10 && onglets.every((o) => o.ctl && o.lab), onglets);
  verif('onglets : un seul arret de tabulation', onglets.filter((o) => o.tab === 0).length === 1 && onglets.find((o) => o.tab === 0).sel === 'true', onglets);
  await page.focus('#t-maintenant'); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(300);
  verif('onglets : fleche droite active Travaux', (await page.evaluate(() => document.activeElement.id)) === 't-travaux' && (await page.getAttribute('#t-travaux', 'aria-selected')) === 'true');
  await page.keyboard.press('End'); verif('onglets : Fin -> dernier', (await page.evaluate(() => document.activeElement.id)) === 't-journal');
  await page.keyboard.press('Home'); await page.waitForTimeout(200); verif('onglets : Debut -> premier', (await page.evaluate(() => document.activeElement.id)) === 't-maintenant');
  verif('onglets : panneau cache pour les autres', await page.locator('#p-argent').isHidden() && await page.locator('#p-maintenant').isVisible());

  // ---- parcours clavier, volets FERMES : le focus ne tombe jamais dans un volet ferme ni dans un panneau cache, et chaque arret montre un contour
  await page.evaluate(() => { document.activeElement.blur(); window.scrollTo(0, 0); });
  const arrets = [];
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('Tab');
    arrets.push(await page.evaluate(() => {
      const e = document.activeElement; if (!e || e === document.body) return null;
      const cs = getComputedStyle(e), r = e.getBoundingClientRect();
      const dans = e.closest('details:not([open])'), estSummary = e.matches('details > summary');
      return { tag: e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.dataset.tab ? '[' + e.dataset.tab + ']' : '') + (e.dataset.per ? '[' + e.dataset.per + ']' : ''), contour: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0, dansVoletFerme: !!dans && !estSummary, cache: r.width === 0 || r.height === 0, nom: (e.getAttribute('aria-label') || e.textContent || e.title || '').trim().slice(0, 30) };
    }));
  }
  const vus = arrets.filter(Boolean);
  verif('clavier : des arrets de tabulation', vus.length >= 20, vus.length);
  verif('clavier : jamais dans un volet ferme', vus.every((a) => !a.dansVoletFerme), vus.filter((a) => a.dansVoletFerme));
  verif('clavier : jamais sur un element invisible', vus.every((a) => !a.cache), vus.filter((a) => a.cache));
  verif('clavier : contour de focus partout', vus.every((a) => a.contour), vus.filter((a) => !a.contour));
  infos.premiersArrets = vus.slice(0, 12).map((a) => a.tag);
  verif('clavier : un seul onglet principal dans l ordre', new Set(vus.filter((a) => /^button#t-/.test(a.tag)).map((a) => a.tag)).size === 1, vus.filter((a) => /^button#t-/.test(a.tag)).map((a) => a.tag));
  verif('clavier : les volets (summary) sont atteignables', vus.filter((a) => a.tag === 'summary').length >= 4, vus.filter((a) => a.tag === 'summary').length);

  // ---- ordre dans un volet OUVERT : ordre du DOM, sans tabindex positif
  await page.click('[data-tab="travaux"]'); await page.waitForTimeout(900);
  await page.evaluate(() => document.querySelector('details[data-id="m-flux"] > summary').click()); await page.waitForTimeout(400);
  const ordre = await page.evaluate(() => {
    const d = document.querySelector('details[data-id="m-flux"]'), foc = Array.from(d.querySelectorAll('button,a[href],input,select,textarea,[tabindex]')).filter((e) => e.tabIndex >= 0 && e.offsetParent !== null);
    const positifs = Array.from(document.querySelectorAll('[tabindex]')).filter((e) => Number(e.getAttribute('tabindex')) > 0).length;
    let ok = true; for (let i = 1; i < foc.length; i++) if (!(foc[i - 1].compareDocumentPosition(foc[i]) & Node.DOCUMENT_POSITION_FOLLOWING)) ok = false;
    return { n: foc.length, positifs, ok };
  });
  verif('volet ouvert : ordre du DOM, aucun tabindex positif', ordre.ok && ordre.positifs === 0 && ordre.n > 3, ordre);

  const CONTRASTE = () => {
    const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const parse = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map((x) => parseFloat(x)); return { c: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 }; };
    const fond = (e) => { let a = e, acc = []; while (a) { const p = parse(getComputedStyle(a).backgroundColor); if (p && p.a > 0) { acc.push(p); if (p.a >= 1) break; } a = a.parentElement; } let base = [10, 10, 14]; for (let i = acc.length - 1; i >= 0; i--) { const p = acc[i]; base = base.map((v, k) => p.c[k] * p.a + v * (1 - p.a)); } return base; };
    const mauvais = {}; let testes = 0, mini = 99;
    document.querySelectorAll('body *').forEach((e) => {
      if (!e.childNodes.length || !Array.from(e.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim())) return;
      if (e.offsetParent === null && getComputedStyle(e).position !== 'fixed') return;
      const cs = getComputedStyle(e), p = parse(cs.color); if (!p) return;
      const bg = fond(e), fg = p.c.map((v, k) => v * p.a + bg[k] * (1 - p.a));
      const l1 = lum(fg), l2 = lum(bg), ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      const px = parseFloat(cs.fontSize), gras = parseInt(cs.fontWeight, 10) >= 700, grand = px >= 24 || (gras && px >= 18.66);
      testes++; if (ratio < mini) mini = ratio;
      if (ratio < (grand ? 3 : 4.5)) { const k = e.tagName.toLowerCase() + '.' + String(e.className).split(' ')[0] + ' ' + cs.color + ' sur ' + bg.map(Math.round).join(','); mauvais[k] = (mauvais[k] || 0) + 1; if (!mauvais['_r' + k]) mauvais['_r' + k] = ratio.toFixed(2); }
    });
    mauvais._stats = { testes, mini: +mini.toFixed(2) }; return mauvais;
  };
  const tousContrastes = { testes: 0, mini: 99, faibles: {} };
  const mesurer = async (nom) => { const c = await page.evaluate(CONTRASTE); tousContrastes.testes += c._stats.testes; tousContrastes.mini = Math.min(tousContrastes.mini, c._stats.mini); Object.keys(c).filter((k) => k[0] !== '_').forEach((k) => { tousContrastes.faibles[nom + ' ' + k] = c[k] + ' ratio ' + c['_r' + k]; }); };
  // ---- noms accessibles de tous les controles (tous les volets ouverts)
  for (const tab of ['maintenant', 'travaux', 'audience', 'argent', 'tarifs', 'users', 'messages', 'marketplace', 'systeme', 'journal']) {
    await page.click('[data-tab="' + tab + '"]'); await page.waitForTimeout(500);
    await page.evaluate((t) => { document.querySelectorAll('#p-' + t + ' [data-volets="1"]').forEach((b) => b.click()); }, tab); await page.waitForTimeout(1200);
    const sans = await page.evaluate(() => {
      const nom = (e) => (e.getAttribute('aria-label') || (e.labels && e.labels.length ? 'label' : '') || e.getAttribute('aria-labelledby') || (e.matches('button,a,summary,th') ? (e.textContent || '').trim() || e.title || (e.querySelector('img[alt]') || {}).alt : '') || '').trim();
      const out = [];
      document.querySelectorAll('input:not([type=hidden]),select,textarea,button,a[href],summary,[role=switch]').forEach((e) => { if (e.offsetParent === null && getComputedStyle(e).position !== 'fixed') return; if (!nom(e)) out.push(e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.className ? '.' + String(e.className).split(' ')[0] : '')); });
      const imgs = Array.from(document.querySelectorAll('img')).filter((i) => i.offsetParent !== null && !i.hasAttribute('alt')).map((i) => 'img sans alt ' + (i.className || i.id));
      return out.concat(imgs);
    });
    verif('noms accessibles (' + tab + ')', sans.length === 0, sans);
    await mesurer(tab);
    await page.keyboard.press('Tab');
    const sansContour = await page.evaluate(() => { const out = []; Array.from(document.querySelectorAll('button,a[href],input,select,textarea,summary,[tabindex="0"]')).filter((e) => e.offsetParent !== null && !e.disabled && e.tabIndex >= 0).forEach((e) => { e.focus(); if (document.activeElement !== e) return; const cs = getComputedStyle(e); if (!(cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0)) out.push(e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + '.' + String(e.className).split(' ')[0]); }); return out; });
    verif('contour de focus sur tous les controles (' + tab + ')', sansContour.length === 0, sansContour.slice(0, 8));
  }
  // onglets Messages et Marketplace
  for (const sub of ['messages', 'marketplace']) {
    await page.click('[data-tab="' + sub + '"]'); await page.waitForTimeout(700);
    const sans = await page.evaluate((t) => { const out = []; document.querySelectorAll('#p-' + t + ' input:not([type=hidden]),#p-' + t + ' select,#p-' + t + ' textarea,#p-' + t + ' button,#p-' + t + ' a[href]').forEach((e) => { if (e.offsetParent === null) return; const n = e.getAttribute('aria-label') || (e.labels && e.labels.length ? 'label' : '') || (e.textContent || '').trim() || e.title || (e.querySelector('img[alt]') || {}).alt; if (!n) out.push(e.tagName.toLowerCase() + (e.id ? '#' + e.id : '')); }); return out; }, sub);
    verif('noms accessibles (' + sub + ')', sans.length === 0, sans);
    await mesurer(sub);
  }
  // titres de colonnes : th reste un columnheader, le tri passe par un bouton
  const ths = await page.evaluate(() => Array.from(document.querySelectorAll('th[data-tri]')).map((t) => ({ role: t.getAttribute('role'), bouton: !!t.querySelector('button.tri'), sort: t.getAttribute('aria-sort') })));
  verif('tri : th sans role=button, avec bouton interne et aria-sort', ths.length > 10 && ths.every((t) => t.role === null && t.bouton && ['none', 'ascending', 'descending'].includes(t.sort)), ths.filter((t) => t.role !== null || !t.bouton).slice(0, 3));
  await page.click('[data-tab="travaux"]'); await page.waitForTimeout(700);
  await page.focus('th[data-tri="flux:email"] .tri'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  verif('tri au clavier (Entree sur le bouton)', (await page.getAttribute('th[data-tri="flux:email"]', 'aria-sort')) === 'ascending');
  await page.keyboard.press('Space'); await page.waitForTimeout(200);
  verif('tri au clavier (Espace) inverse', (await page.getAttribute('th[data-tri="flux:email"]', 'aria-sort')) === 'descending');

  // ---- visionneuse : focus dedans, boucle, Echap, retour au declencheur
  await page.click('[data-tab="users"]'); await page.waitForTimeout(1000); await page.locator('#liste-comptes .ligne').nth(0).click(); await page.waitForTimeout(1800);
  await page.evaluate(() => { const d = document.querySelector('details[data-id="f-creations"]'); if (d && !d.open) d.open = true; }); await page.waitForTimeout(1200);
  const vign = page.locator('#galerie .vignette').first(); await vign.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
  verif('visionneuse : focus sur Fermer', (await page.evaluate(() => document.activeElement.id)) === 'lb-fermer');
  let dehors = 0; for (let i = 0; i < 14; i++) { await page.keyboard.press('Tab'); if (!(await page.evaluate(() => !!document.activeElement.closest('#lb')))) dehors++; }
  verif('visionneuse : Tab reste dans la fenetre', dehors === 0, dehors);
  for (let i = 0; i < 14; i++) { await page.keyboard.press('Shift+Tab'); if (!(await page.evaluate(() => !!document.activeElement.closest('#lb')))) dehors++; }
  verif('visionneuse : Maj+Tab reste dans la fenetre', dehors === 0, dehors);
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  verif('visionneuse : Echap ferme et rend le focus', (await page.locator('#lb').isHidden()) && (await page.evaluate(() => document.activeElement.classList.contains('vignette'))));
  verif('visionneuse : aria-modal + dialog', (await page.getAttribute('#lb', 'aria-modal')) === 'true' && (await page.getAttribute('#lb', 'role')) === 'dialog');

  // ---- mot de passe oublie (session par mot de passe) : meme comportement
  await page.evaluate(() => fetch('/__session/mdp')); await page.waitForTimeout(3800);
  await page.focus('#b-oubli'); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  verif('mdp oublie : focus dans le dialogue', await page.evaluate(() => !!document.activeElement.closest('#fp')));
  let ext = 0; for (let i = 0; i < 12; i++) { await page.keyboard.press('Tab'); if (!(await page.evaluate(() => !!document.activeElement.closest('#fp')))) ext++; }
  verif('mdp oublie : Tab boucle dans le dialogue', ext === 0, ext);
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  verif('mdp oublie : Echap ferme et rend le focus', (await page.locator('#fp').isHidden()) && (await page.evaluate(() => document.activeElement.id)) === 'b-oubli');
  verif('connexion : champs nommes', await page.evaluate(() => ['lg-user', 'lg-mdp'].every((id) => !!document.getElementById(id).getAttribute('aria-label'))));
  verif('connexion : alerte de session annoncee', (await page.getAttribute('#session', 'role')) === 'alert');
  await page.evaluate(() => fetch('/__session/rendre'));

  infos.contraste = { testes: tousContrastes.testes, mini: tousContrastes.mini }; verif('contraste AA', Object.keys(tousContrastes.faibles).length === 0, tousContrastes.faibles);
  verif('aucune erreur JS', erreurs.length === 0, erreurs);
  infos.arrets = vus.length;
  return { ok: echecs.length === 0, echecs, infos };
}
