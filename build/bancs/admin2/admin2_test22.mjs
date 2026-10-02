// /admin2 : « Par operation » liste TOUTES les operations qui existent (celles sans activite a zero), 30 jours ET 6 h / 24 h ; le filtre d'une ligne eclatee passe par sa famille
export default async function run(page) {
  const r = { echecs: [], infos: {} };
  const ok = (c, m) => { if (!c) r.echecs.push(m); };
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => { try { localStorage.removeItem('admin2.volets'); } catch (_) {} });
  await page.goto(new URL(page.url()).origin + '/admin2#argent'); await page.reload(); await page.waitForTimeout(3000);
  const lire = () => page.evaluate(() => Array.from(document.querySelectorAll('#t-ops tr')).map((tr) => { const td = tr.querySelectorAll('td'); return { op: td[0] ? td[0].innerText.trim() : '', n: td[1] ? td[1].innerText.trim() : '', verdict: td[8] ? td[8].innerText.trim() : '' }; }));
  // 30 jours
  await page.click('[data-per="30j"]'); await page.waitForTimeout(1500);
  const l30 = await lire(); r.infos.nb30 = l30.length;
  const noms = l30.map((x) => x.op);
  for (const k of ['mesh', 'rig', 'modify', 'mesh-op:smooth', 'upscale', 'auto_inpaint', 'mask_inpaint', 'face_fix_image', 'tex_variant', 'recolor', 'outfit', 'segment-image', 'segment', 'tpose', 'sheet', 'retexture', 'mesh-op:watertight', 'mesh-op-client:clone3d']) ok(noms.indexOf(k) >= 0, '30 j : operation absente : ' + k);
  ok(l30.length >= 28, '30 j : trop peu d operations listees : ' + l30.length);
  ok(new Set(noms).size === noms.length, '30 j : operation en double');
  const upscale = l30.find((x) => x.op === 'upscale'); ok(upscale && upscale.n === '0' && /pas utilisée/.test(upscale.verdict), '30 j : upscale devrait etre a zero / « pas utilisée » : ' + JSON.stringify(upscale));
  const modify = l30.find((x) => x.op === 'modify'); ok(modify && /^30/.test(modify.n), '30 j : modify devrait avoir 30 travaux : ' + JSON.stringify(modify));
  // les operations utilisees passent avant celles a zero (tri par cout reel decroissant)
  const premierZero = l30.findIndex((x) => x.n === '0'), dernierUtilise = l30.map((x) => x.n !== '0').lastIndexOf(true);
  ok(premierZero > dernierUtilise, '30 j : des lignes a zero sont melangees aux lignes utilisees (' + premierZero + ' / ' + dernierUtilise + ')');
  const resume = await page.evaluate(() => document.querySelector('details[data-id="a-ops"] > summary .res').textContent); r.infos.resume = resume;
  ok(/utilisées? sur \d+/.test(resume), '30 j : resume sans « N utilisees sur M » : ' + resume);
  const note = await page.locator('#note-ops').innerText(); ok(/Toutes les opérations existantes/.test(note), '30 j : note absente');
  // filtre par famille : cliquer « modify » (ligne eclatee) filtre sur le type grossier text2image
  await page.locator('#t-ops .lien', { hasText: /^modify$/ }).first().click(); await page.waitForTimeout(500);
  const chip = await page.locator('#chips').innerText(); r.infos.chip = chip.replace(/\s+/g, ' ');
  ok(/text2image/.test(chip), 'filtre : « modify » devrait filtrer sur text2image : ' + chip);
  await page.locator('[data-clear="all"]').click(); await page.waitForTimeout(300);
  // 24 h
  await page.click('[data-per="24h"]'); await page.waitForTimeout(1800);
  const l24 = await lire(); r.infos.nb24 = l24.length;
  ok(l24.length >= 28, '24 h : trop peu d operations listees : ' + l24.length);
  ok(l24.some((x) => x.op === 'remove-bg' && x.n.startsWith('9')), '24 h : remove-bg (9 travaux) manque');
  ok(l24.some((x) => x.op === 'upscale' && x.n === '0'), '24 h : upscale a zero manque');
  r.ok = r.echecs.length === 0; return r;
}
