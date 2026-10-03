// Vague 5, voie « bureau-reste » (2026-10-03), constat F2 : lien « Licences tierces » du SITE dans la fenetre « A propos » du bureau.
//   node --test tests/bureau-interface/vague5-bureau.test.mjs
// Ancien code (les tests doivent ECHOUER) : INDEX2_HTML=<ancien index2.html> INDEX2_JS=<ancien index2.js> ADDITIONS5_JS=<ancien _additions5.js>
//   node --test tests/bureau-interface/vague5-bureau.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const lire = (env, rel) => readFileSync(process.env[env] || new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const html = lire('INDEX2_HTML', '../../src/renderer/index2.html');
const js = lire('INDEX2_JS', '../../src/renderer/index2.js');
const add5 = lire('ADDITIONS5_JS', '../../src/renderer/lang/_additions5.js');
const main = readFileSync(process.env.MAIN_JS || new URL('../../src/main/main.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const LIBELLE = 'Third-party licenses (website)';

test('A propos : le lien « licences tierces » du site existe dans la section Legal', () => {
  const a = html.indexOf('<div class="about-label">Legal</div>');
  assert.ok(a > 0, 'section Legal introuvable');
  const fin = html.indexOf('about-credits', a);
  const section = html.slice(a, fin);
  assert.match(section, /<a href="#" id="about-link-licenses-web">Third-party licenses \(website\)<\/a>/);
  assert.match(section, /id="about-link-licenses"/, 'le fichier embarque reste disponible');
  assert.equal((html.match(/id="about-link-licenses-web"/g) || []).length, 1, 'identifiant unique');
});

test('A propos : le clic ouvre /legal/licenses par _openCloudSite (mecanisme existant), sans rien d autre', () => {
  const ligne = js.split('\n').find((l) => l.includes("getElementById('about-link-licenses-web')"));
  assert.ok(ligne, 'le branchement du lien est absent');
  const ouvertures = []; let ecouteur = null; let empeche = false;
  const document = { getElementById: (id) => (id === 'about-link-licenses-web' ? { addEventListener: (ev, fn) => { assert.equal(ev, 'click'); ecouteur = fn; } } : null) };
  vm.runInNewContext(ligne, { document, _openCloudSite: (p) => ouvertures.push(p), openLegal: () => assert.fail('ne doit pas ouvrir le fichier local') });
  assert.equal(typeof ecouteur, 'function');
  ecouteur({ preventDefault: () => { empeche = true; } });
  assert.equal(empeche, true);
  assert.deepEqual(ouvertures, ['/legal/licenses']);
});

test('A propos : aucun nouveau canal d ouverture externe (pas de shell.openExternal ni de nouvelle poignee)', () => {
  assert.ok(!/ipcMain\.handle\('[^']*licen[cs]es[^']*'/i.test(main), 'poignee de licences ajoutee');
  const lignes = js.split('\n').filter((l) => l.includes('about-link-licenses-web'));
  for (const l of lignes) assert.ok(!/window\.open|openExternal|shell\./.test(l), l);
});

test('A propos : la destination est autorisee par la liste blanche existante du processus principal', () => {
  const m = /const _EXTERNAL_HOST_ALLOWLIST = \[([\s\S]*?)\];/.exec(main);
  assert.ok(m, 'liste blanche introuvable');
  const hotes = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).filter((h) => !h.includes(' '));
  const site = new URL(js.match(/const base = '(https:\/\/myfabmesh-cloud[^']+)'/)[1]);
  assert.ok(hotes.some((h) => site.hostname === h || site.hostname.endsWith('.' + h)), 'hote du site absent de la liste blanche : ' + site.hostname);
});

test('A propos : le libelle est traduit dans les 5 langues et ne nomme aucun moteur', () => {
  const enregistrees = {};
  const sandbox = { window: { FabI18n: { register: (lang, map) => { enregistrees[lang] = Object.assign(enregistrees[lang] || {}, map); } } } };
  vm.runInNewContext(add5, sandbox);
  for (const lang of ['fr', 'es', 'zh', 'hi', 'ar']) {
    const t = enregistrees[lang] && enregistrees[lang][LIBELLE];
    assert.ok(t && t !== LIBELLE, 'traduction absente : ' + lang);
  }
  assert.equal(enregistrees.fr[LIBELLE], 'Licences tierces (site web)');
  const interdits = /unirig|trellis|puppeteer|realvis|clipseg|hidream|flux|juggernaut|skintokens|unimate|partsam|birefnet|lucida/i;
  assert.ok(!interdits.test(LIBELLE));
  for (const lang of Object.keys(enregistrees)) assert.ok(!interdits.test(enregistrees[lang][LIBELLE] || ''), lang);
});
