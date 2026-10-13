// Noms de projet NON LATINS ou accentues dans le processus principal du bureau (2026-10-13, audit de la langue du 11/10) :
//   CHAMPS-13      dossier d'images = nom avec [^a-zA-Z0-9_-] -> « _ » : « 兽人战士 » et « 精灵射手 » partageaient « ____ », accents detruits ;
//   CHAMPS-24      mode Cloud : le nom envoye au site etait ce nom de DOSSIER assaini, pas le nom saisi ;
//   MANQUE-SERV-03 marqueurs de projets vides : « 兽人战士 » et « 精灵射手 » s'ecrasaient dans « ____.json ».
// Les VRAIS gestionnaires de src/main/main.js (generate-images, projet-vide:*, delete-project, rename-project-files, import-dropped-file)
// sont extraits (acorn) et executes contre un dossier temporaire ; le cloud est une doublure (aucun reseau, aucun GPU, aucun Python).
//   node --test tests/main/noms-projet-bureau.test.mjs
// Rejouer contre l'ANCIEN code (les tests de correctif doivent alors ECHOUER) :
//   MAIN_JS=<ancien main.js> SLUG_PROJET=<chemin absent> node --test tests/main/noms-projet-bureau.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';

const require = createRequire(import.meta.url);
const ici = path.dirname(fileURLToPath(import.meta.url));
const racineDepot = path.resolve(ici, '..', '..');
const MAIN_JS = process.env.MAIN_JS || path.join(racineDepot, 'src', 'main', 'main.js');
const SLUG_JS = process.env.SLUG_PROJET || path.join(racineDepot, 'src', 'main', 'slug_projet.js');
let S = null;
try { S = require(SLUG_JS); } catch (_) { S = null; }
const texteMain = fs.readFileSync(MAIN_JS, 'utf-8').replace(/\r\n/g, '\n');
const ast = acorn.parse(texteMain, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true, allowReturnOutsideFunction: true });

/** Source du gestionnaire passe a ipcMain.handle('<canal>', ...). */
function gestionnaire(canal) {
  let src = null;
  (function visiter(n) {
    if (!n || typeof n.type !== 'string' || src) return;
    if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && n.callee.object && n.callee.object.name === 'ipcMain'
        && n.callee.property.name === 'handle' && n.arguments[0] && n.arguments[0].value === canal) { src = texteMain.slice(n.arguments[1].start, n.arguments[1].end); return; }
    for (const k of Object.keys(n)) { const v = n[k]; if (Array.isArray(v)) v.forEach(visiter); else if (v && typeof v.type === 'string') visiter(v); }
  })(ast);
  assert.ok(src, 'gestionnaire introuvable : ' + canal);
  return src;
}
/** Source d'une fonction de premier niveau (null si absente de cette copie de main.js). */
function fonction(nom) {
  const n = ast.body.find((x) => x.type === 'FunctionDeclaration' && x.id && x.id.name === nom);
  return n ? texteMain.slice(n.start, n.end) : null;
}

const PAIRES = [['chinois', '兽人战士', '精灵射手'], ['arabe', 'تنين', 'فارس'], ['russe', 'орк', 'дом'], ['accents', 'Éléphant', 'Àlèphant']];

/** Bureau simule : dossiers temporaires + config en memoire + cloud enregistre. Les gestionnaires sont evalues avec ces doublures. */
function bureau() {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'noms-projet-'));
  const IMAGES_DIR = path.join(racine, 'images'), MESHES_DIR = path.join(racine, 'meshes');
  const PROJETS_VIDES_DIR = path.join(racine, 'projets_vides'), HISTORY_DIR = path.join(racine, 'history');
  for (const d of [IMAGES_DIR, MESHES_DIR, HISTORY_DIR]) fs.mkdirSync(d, { recursive: true });
  let config = { blenderPath: '' };
  const envoisCloud = [];
  const doublures = {
    fs, path, IMAGES_DIR, MESHES_DIR, PROJETS_VIDES_DIR, HISTORY_DIR, HF_CACHE_DIR: path.join(racine, 'hf'),
    process: { env: {} }, console: { log() {}, warn() {}, error() {} }, log: { warn() {}, info() {}, error() {} },
    loadConfig: () => JSON.parse(JSON.stringify(config)), saveConfig: (c) => { config = JSON.parse(JSON.stringify(c)); },
    isCloudMode: () => true, _localPyLibsUsable: () => true,
    checkPromptSafety: () => ({ safe: true }), checkPromptSafetyAI: async () => ({ safe: true }),
    detectNvidiaGpu: async () => ({ hasNvidia: false }), safeSend() {}, _BUILD_STAGE_MODIFIERS: [],
    cloudFallback: { generateImages: async (args) => { envoisCloud.push(args); return { success: true, images: [] }; } },
    cheminAutorise: (p, racines) => racines.some((r) => path.resolve(p).startsWith(path.resolve(r) + path.sep)),
    slugProjet: S ? S.slugProjet : undefined, nomAffichageAMemoriser: S ? S.nomAffichageAMemoriser : undefined,
    nomPourLeSite: S ? S.nomPourLeSite : undefined,
  };
  const cles = Object.keys(doublures);
  const evaluer = (src) => new Function(...cles, '_memoriserNomProjet', '_cheminProjetVide', '_meshProjectBackend', 'return (' + src + ');');
  // fonctions de premier niveau de main.js (celles que cette copie declare), evaluees avec les memes doublures
  const aides = {};
  for (const nom of ['_memoriserNomProjet', '_cheminProjetVide', '_meshProjectBackend']) {
    const src = fonction(nom);
    aides[nom] = src ? (...a) => fabriquer(src)(...a) : undefined;
  }
  function fabriquer(src) { return evaluer(src)(...cles.map((k) => doublures[k]), aides._memoriserNomProjet, aides._cheminProjetVide, aides._meshProjectBackend); }
  const appeler = async (canal, args) => fabriquer(gestionnaire(canal))({}, args);
  const dossiers = () => fs.readdirSync(IMAGES_DIR).sort();
  const marqueurs = () => (fs.existsSync(PROJETS_VIDES_DIR) ? fs.readdirSync(PROJETS_VIDES_DIR).sort() : []);
  const nomsAffiches = () => ({ ...(config.projectDisplayNames || {}) });
  const fin = () => { try { fs.rmSync(racine, { recursive: true, force: true }); } catch (_) {} };
  return { appeler, dossiers, marqueurs, nomsAffiches, envoisCloud, IMAGES_DIR, MESHES_DIR, PROJETS_VIDES_DIR, fin, config: () => config };
}
const generer = (b, projectName) => b.appeler('generate-images', {
  prompt: 'an orc warrior', userPrompt: 'an orc warrior', numImages: 1, projectName, engine: 'local-lightning', steps: 4, assetType: 'character', computeMode: 'cloud',
});

/* ═══════════════ regle de slug (src/main/slug_projet.js) ═══════════════ */
test('slug_projet : deux noms non latins ou accentues de meme forme ont des dossiers DIFFERENTS ; un nom ASCII garde son dossier', () => {
  assert.ok(S, 'src/main/slug_projet.js introuvable');
  for (const [langue, a, b] of PAIRES) {
    assert.notEqual(S.slugProjet(a), S.slugProjet(b), langue);
    for (const s of [S.slugProjet(a), S.slugProjet(b)]) {
      assert.match(s, /^[A-Za-z0-9_-]+$/, 'dossier sur : ' + s);
      assert.equal(s.replace(/[^a-zA-Z0-9_-]/g, '_'), s, 'point fixe de l ancienne regle (un dossier rendu comme nom reste ce dossier)');
      assert.equal(s.replace(/_\d+$/, ''), s, 'le regroupement des dossiers (_<chiffres> retire) ne le coupe pas');
    }
  }
  for (const nom of ['Orc', 'Mobilier design', 'orc_woman', 'v1.2', "L'orc"]) assert.equal(S.slugProjet(nom), nom.replace(/[^a-zA-Z0-9_-]/g, '_'), nom);
  assert.equal(S.slugProjet('Épée magique'), 'Epee_magique-h' + S.empreinteNom('Épée magique'));
});

/* ═══════════════ generate-images (mode Cloud) ═══════════════ */
for (const [langue, a, b] of PAIRES) {
  test(`generate-images, ${langue} : « ${a} » et « ${b} » ont chacun leur dossier, le site recoit le nom SAISI`, async () => {
    const b_ = bureau();
    try {
      await generer(b_, a);
      await generer(b_, b);
      const ds = b_.dossiers();
      assert.equal(ds.length, 2, `un seul dossier pour deux projets : ${ds.join(', ')}`);
      assert.deepEqual(b_.envoisCloud.map((e) => e.projectName), [a, b], 'nom envoye au site (user_assets)');
      for (const d of ds) assert.match(d, /^[A-Za-z0-9_-]+$/);
      // le nom saisi est memorise pour la grille : dossier -> nom
      const dn = b_.nomsAffiches();
      assert.deepEqual(Object.values(dn).sort(), [a, b].sort());
      // 2e generation, lancee depuis le projet rouvert sous son NOM DE DOSSIER : meme dossier, meme nom pour le site
      const dossierA = Object.keys(dn).find((k) => dn[k] === a);
      await generer(b_, dossierA);
      assert.equal(b_.dossiers().length, 2, 'la 2e generation cree un autre dossier');
      assert.equal(b_.envoisCloud[2].projectName, a, '2e generation : le site recoit encore le nom saisi');
    } finally { b_.fin(); }
  });
}

test('generate-images, non-regression ASCII : « Mobilier design » et « Orc » gardent leur dossier et leur nom de site d avant', async () => {
  const b_ = bureau();
  try {
    await generer(b_, 'Mobilier design');
    await generer(b_, 'Orc');
    await generer(b_, 'Mobilier_design');
    assert.deepEqual(b_.dossiers(), ['Mobilier_design', 'Orc']);
    assert.deepEqual(b_.envoisCloud.map((e) => e.projectName), ['Mobilier_design', 'Orc', 'Mobilier_design']);
    assert.deepEqual(b_.nomsAffiches(), {}, 'aucun nom d affichage memorise pour un nom ASCII');
  } finally { b_.fin(); }
});

test('generate-images : un ancien dossier « ____ » (avant le correctif) continue de recevoir ses images sous le meme nom de site', async () => {
  const b_ = bureau();
  try {
    fs.mkdirSync(path.join(b_.IMAGES_DIR, '____'));
    await generer(b_, '____');   // projet rouvert sous son nom de dossier
    assert.deepEqual(b_.dossiers(), ['____']);
    assert.equal(b_.envoisCloud[0].projectName, '____');
  } finally { b_.fin(); }
});

/* ═══════════════ projets vides : marqueurs ═══════════════ */
test('projets vides : « 兽人战士 » puis « 精灵射手 » -> deux marqueurs (le second n ecrase plus le premier) ; ASCII inchange', async () => {
  const b_ = bureau();
  try {
    for (const name of ['兽人战士', '精灵射手', 'تنين', 'فارس', 'Mobilier design']) await b_.appeler('projet-vide:creer', { name, assetType: 'character' });
    const liste = (await b_.appeler('projet-vide:lister')).map((x) => x.name).sort();
    assert.deepEqual(liste, ['兽人战士', '精灵射手', 'تنين', 'فارس', 'Mobilier design'].sort());
    assert.ok(b_.marqueurs().includes('Mobilier design.json'), 'nom de fichier ASCII d avant : ' + b_.marqueurs().join(', '));
  } finally { b_.fin(); }
});

test('delete-project : supprime le marqueur et le nom memorise du projet non latin, pas ceux de l autre projet', async () => {
  const b_ = bureau();
  try {
    await b_.appeler('projet-vide:creer', { name: '兽人战士' });
    await b_.appeler('projet-vide:creer', { name: '精灵射手' });
    await generer(b_, '兽人战士');
    await generer(b_, '精灵射手');
    const dn = b_.nomsAffiches();
    const dossierA = Object.keys(dn).find((k) => dn[k] === '兽人战士');
    assert.ok(dossierA, 'nom saisi non memorise');
    const r = await b_.appeler('delete-project', { projectName: dossierA });
    assert.equal(r.ok, true);
    assert.deepEqual((await b_.appeler('projet-vide:lister')).map((x) => x.name), ['精灵射手'], 'marqueur restant');
    assert.deepEqual(Object.values(b_.nomsAffiches()), ['精灵射手']);
    assert.equal(b_.dossiers().length, 1);
  } finally { b_.fin(); }
});

test('delete-project : un ANCIEN marqueur « ____.json » n est retire que s il porte le nom du projet supprime', async () => {
  const b_ = bureau();
  try {
    fs.mkdirSync(b_.PROJETS_VIDES_DIR, { recursive: true });
    fs.writeFileSync(path.join(b_.PROJETS_VIDES_DIR, '____.json'), JSON.stringify({ name: '精灵射手', created: 1 }));
    await b_.appeler('delete-project', { projectName: '兽人战士' });
    assert.deepEqual(b_.marqueurs(), ['____.json'], 'le marqueur d un AUTRE projet a ete supprime');
    await b_.appeler('delete-project', { projectName: '精灵射手' });
    assert.deepEqual(b_.marqueurs(), [], 'ancien marqueur du projet supprime encore present');
  } finally { b_.fin(); }
});

/* ═══════════════ renommage et glisser-deposer ═══════════════ */
test('rename-project-files : renommer en « 精灵射手 » fonctionne (plus « invalid name ») et memorise le nom saisi', async () => {
  const b_ = bureau();
  try {
    await generer(b_, 'Orc');
    const r = await b_.appeler('rename-project-files', { oldName: 'Orc', newName: '精灵射手' });
    assert.equal(r.success, true, r.error);
    assert.match(r.newName, /^project-h[0-9a-f]{8}$/);
    assert.equal(b_.dossiers().length, 1);
    assert.ok(b_.dossiers()[0].startsWith(r.newName + '_'), 'dossier renomme : ' + b_.dossiers()[0]);
    assert.equal(b_.nomsAffiches()[r.newName], '精灵射手');
    const r2 = await b_.appeler('rename-project-files', { oldName: 'x', newName: 'Mobilier design' });
    assert.equal(r2.newName, 'Mobilier_design', 'nom ASCII : regle d avant');
  } finally { b_.fin(); }
});

test('import-dropped-file : une image deposee dans un NOUVEAU projet « 兽人战士 » ne devient plus « imported »', async () => {
  const b_ = bureau();
  try {
    const src = path.join(b_.IMAGES_DIR, '..', 'photo.png');
    fs.writeFileSync(src, 'png');
    const r1 = await b_.appeler('import-dropped-file', { filePath: src, projectName: '兽人战士' });
    const r2 = await b_.appeler('import-dropped-file', { filePath: src, projectName: '精灵射手' });
    assert.equal(r1.success && r2.success, true);
    assert.notEqual(r1.projectName, 'imported');
    assert.notEqual(r1.projectName, r2.projectName, 'deux projets de meme forme, meme dossier');
    assert.equal(b_.nomsAffiches()[r1.projectName], '兽人战士');
    const r3 = await b_.appeler('import-dropped-file', { filePath: src, projectName: 'Mobilier design' });
    assert.equal(r3.projectName, 'Mobilier_design', 'nom ASCII : regle d avant');
  } finally { b_.fin(); }
});
