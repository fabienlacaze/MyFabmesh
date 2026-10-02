import { readFileSync } from 'node:fs';
export default async function run(page) {
  const res = [];
  const ok = (nom, cond, detail) => res.push({ nom, ok: !!cond, detail: detail === undefined ? undefined : String(detail).slice(0, 220) });
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.waitForSelector('button.tab[data-tab]');
  await page.click('button.tab[data-tab="systeme"]'); await page.waitForSelector('#b-formes', { state: 'attached' });
  await page.evaluate(() => { const d = document.querySelector('details[data-id="s-formes"]'); if (d) d.open = true; });
  const gets = []; page.on('request', (r) => { if (/\/api\/admin\//.test(r.url())) gets.push(r.method()); });
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#b-formes')]);
  const chemin = 'C:/tmp/admin_formes_page.json'; await dl.saveAs(chemin);
  const j = JSON.parse(readFileSync(chemin, 'utf8'));
  const txt = JSON.stringify(j);
  ok('le fichier est telecharge sous le bon nom', dl.suggestedFilename() === 'admin_formes.json', dl.suggestedFilename());
  ok('23 routes lues', Object.keys(j.routes).length === 23, Object.keys(j.routes).length);
  ok('seules des lectures (GET) ont ete envoyees', gets.length > 0 && gets.every((m) => m === 'GET'), [...new Set(gets)].join(','));
  ok('aucune adresse e-mail dans le fichier', !/@/.test(txt.replace(/<e-mail>/g, '')), '');
  const TYPES = new Set(['string', 'number', 'boolean', 'null', 'objet', 'undefined']);
  const mauvaises = []; (function marche(v, c) { if (Array.isArray(v)) v.forEach((x, i) => marche(x, c + '[' + i + ']')); else if (v && typeof v === 'object') Object.keys(v).forEach((k) => marche(v[k], c + '/' + k)); else if (typeof v === 'string' && !TYPES.has(v) && !c.endsWith('/erreur') && !c.endsWith('/genere') && !c.endsWith('/note')) mauvaises.push(c + '=' + v); })(j.routes, '');
  ok('toutes les feuilles sont des NOMS DE TYPE (aucune valeur)', mauvaises.length === 0, mauvaises.slice(0, 5).join(' ; '));
  ok('la forme des badges est lue', j.routes['/api/admin/badges'] && j.routes['/api/admin/badges'].forme && j.routes['/api/admin/badges'].forme.active === 'number', JSON.stringify(j.routes['/api/admin/badges']).slice(0, 120));
  ok('le message de fin s affiche', /telecharge/i.test(await page.evaluate(() => (document.querySelector('#formes-msg') || {}).textContent || '').then((x) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))), await page.evaluate(() => document.querySelector('#formes-msg').textContent));
  await page.screenshot({ path: 'C:/tmp/formes.png' });
  return { res, echecs: res.filter((x) => !x.ok).length };
}
