// Scenarios precis (suite) : enregistrement des prix avec plancher, double clic sur « Appliquer », double clic sur « Verser », panne de /pricing.
export default async function run(page) {
  const res = [];
  const ok = (nom, cond, detail) => res.push({ nom, ok: !!cond, detail: detail === undefined ? undefined : String(detail).slice(0, 220) });
  const txt = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.innerText.replace(/\s+/g, ' ').trim() : null; }, sel);
  await page.setViewportSize({ width: 1400, height: 1100 });
  await page.waitForSelector('button.tab[data-tab]');

  // ---- A. Enregistrement : le serveur refuse un prix sous le plancher -> la page le DIT apres l'enregistrement
  await page.route('**/api/admin/pricing', (r) => {
    if (r.request().method() !== 'POST') return r.continue();
    const b = JSON.parse(r.request().postData() || '{}');
    const cur = Object.assign({}, b.prices); cur.mesh_fast = 11;
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, current: cur, refuses: [{ cle: 'mesh_fast', demande: 5, plancher: 11 }] }) });
  });
  await page.reload(); await page.waitForSelector('button.tab[data-tab]');
  await page.click('button.tab[data-tab="argent"]'); await page.waitForSelector('#pk-mesh_fast', { timeout: 15000 });
  await page.fill('#pk-mesh_fast', '5'); await page.waitForSelector('#b-tarifs-ok');
  await page.click('#b-tarifs-ok'); await page.waitForTimeout(1500);
  const msg = await txt('#tarifs-msg');
  const champ = await page.evaluate(() => document.querySelector('#pk-mesh_fast') && document.querySelector('#pk-mesh_fast').value);
  ok('Prix : apres enregistrement, le refus du plancher est ECRIT', /mesh_fast/.test(msg || '') && /plancher|refus|ignor/i.test(msg || '') && !/^✓ Enregistré\.?$/.test(msg || ''), msg);
  ok('Prix : le champ revient au plancher (11), pas 5', champ === '11', 'champ=' + champ);
  await page.unroute('**/api/admin/pricing');

  // ---- B. Panne de GET /pricing : l'onglet Argent ne reste pas muet
  await page.route('**/api/admin/pricing', (r) => r.request().method() === 'GET' ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"r2 down"}' }) : r.continue());
  await page.reload(); await page.waitForSelector('button.tab[data-tab]');
  await page.click('button.tab[data-tab="argent"]'); await page.waitForTimeout(3500);
  const vis = await page.evaluate(() => { const o = []; document.querySelectorAll('#p-argent *').forEach((e) => { if (e.children.length === 0 && /r2 down|Lecture impossible|prix.*indisponible|indisponible/i.test(e.textContent || '')) o.push(e.textContent.trim().slice(0, 140)); }); const av = document.querySelector('#avert'); if (av && !av.hidden) o.push('AVERT: ' + av.textContent.slice(0, 140)); return o; });
  ok('Argent : panne de GET /pricing visible', vis.length > 0, vis.join(' || '));
  await page.unroute('**/api/admin/pricing');

  // ---- C. Comptes : double clic sur « Appliquer » = UN seul POST
  let posts = 0;
  await page.route('**/api/admin/users/credits', async (r) => { posts++; await new Promise((x) => setTimeout(x, 800)); r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"balance":123}' }); });
  await page.reload(); await page.waitForSelector('button.tab[data-tab]');
  await page.click('button.tab[data-tab="users"]'); await page.waitForSelector('#liste-comptes [data-sel]', { timeout: 15000 });
  await page.click('#liste-comptes [data-sel]'); await page.waitForSelector('#aj', { state: 'attached', timeout: 8000 });
  await page.evaluate(() => { const d = document.querySelector('details[data-id="f-credits"]'); if (d) d.open = true; });
  await page.fill('#aj', '10'); await page.fill('#aj-motif', 'essai de la revue'); await page.fill('#aj-mdp', 'bon');
  await page.evaluate(() => { const b = document.querySelector('#b-aj'); b.click(); b.click(); });
  await page.waitForTimeout(2200);
  ok('Comptes : double clic sur Appliquer = 1 seul POST', posts === 1, 'posts=' + posts);
  ok('Comptes : confirmation visible apres versement', /crédit|solde|123|✓/i.test((await txt('#aj-msg')) || ''), await txt('#aj-msg'));
  await page.unroute('**/api/admin/users/credits');

  // ---- D. Rapprochement : un POST « Verser » vise bien la session AFFICHEE ; double clic = 1 POST
  let recPosts = 0, sidEnvoye = null;
  await page.route('**/api/admin/payments/unreconciled', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ count: 2, payments: [
    { stripe_session_id: 'cs_live_AAA111', email: 'a@x.fr', user_id: 'u1', pack_id: 'pack_500', amount_eur: 19, expected_credits: 500, created_at: new Date(Date.now() - 3600e3).toISOString() },
    { stripe_session_id: 'cs_live_BBB222', email: 'b@x.fr', user_id: 'u2', pack_id: 'pack_100', amount_eur: 5, expected_credits: 100, created_at: new Date(Date.now() - 7200e3).toISOString() }] }) }));
  await page.route('**/api/admin/payments/reconcile', async (r) => { recPosts++; sidEnvoye = JSON.parse(r.request().postData() || '{}').sessionId; await new Promise((x) => setTimeout(x, 700)); r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"credits":100,"amount_eur":5,"balance":200}' }); });
  await page.reload(); await page.waitForSelector('button.tab[data-tab]');
  await page.click('button.tab[data-tab="argent"]'); await page.waitForSelector('[data-recon]', { timeout: 15000 });
  const boutons = await page.$$('[data-recon]');
  await boutons[boutons.length - 1].click(); await page.waitForSelector('#rc-mdp', { timeout: 5000 });
  const affiche = await txt('#recon-form');
  await page.fill('#rc-mdp', 'bon');
  await page.evaluate(() => { const b = document.querySelector('#rc-ok'); b.click(); b.click(); });
  await page.waitForTimeout(2200);
  const sidAffiche = /BBB222/.test(affiche || '') ? 'cs_live_BBB222' : /AAA111/.test(affiche || '') ? 'cs_live_AAA111' : '?';
  ok('Verser : la session envoyee est celle du paiement AFFICHE', sidEnvoye === sidAffiche, 'affiche=' + sidAffiche + ' envoye=' + sidEnvoye);
  ok('Verser : double clic = 1 seul POST', recPosts === 1, 'posts=' + recPosts);
  await page.unroute('**/api/admin/payments/unreconciled'); await page.unroute('**/api/admin/payments/reconcile');

  return { res, echecs: res.filter((x) => !x.ok).length };
}
