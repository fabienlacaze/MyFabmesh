// Noms de projet NON LATINS ou accentues dans les PAGES (site et bureau), 2026-10-13, audit de la langue du 11/10 :
//   CHAMPS-02      rechargement du projet ouvert : « 兽人战士 » (1 image) basculait sur « 精灵射手 » (3 images) apres chaque generation ;
//   MANQUE-SERV-03 dedoublonnage « projet vide / dossier reel » : un projet vide TOUT NEUF disparaissait dans un projet plein de meme forme ;
//   CHAMPS-13      bureau : dossier « project-h<empreinte> » d'un nom non latin, relie a son nom saisi (config.projectDisplayNames).
// Les VRAIES fonctions refreshProjectsPage / reloadCurrentProject des deux index2.js sont extraites (acorn) et rejouees avec une fausse API.
// Lancer : cd cloud && node --test tests/noms-projet-pages.test.mjs
// Ancien code (les tests de correctif doivent ECHOUER) : WEB_INDEX2=<ancien cloud/public/app/index2.js> BUREAU_INDEX2=<ancien src/renderer/index2.js>
//   node --test tests/noms-projet-pages.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as acorn from 'acorn';

const chemin = (env, rel) => process.env[env] || new URL(rel, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SOURCES = {
  web: readFileSync(chemin('WEB_INDEX2', '../public/app/index2.js'), 'utf8').replace(/\r\n/g, '\n'),
  bureau: readFileSync(chemin('BUREAU_INDEX2', '../../src/renderer/index2.js'), 'utf8').replace(/\r\n/g, '\n'),
};
const require = createRequire(import.meta.url);
let slugBureau = null;
try { slugBureau = require(chemin('SLUG_PROJET', '../../src/main/slug_projet.js')); } catch (_) { slugBureau = null; }

/** Declarations de premier niveau (fonctions, const/let/var) d'un module, par nom. */
const _decl = new Map();
const _ast = new Map();
const arbre = (cle) => {
  if (!_ast.has(cle)) _ast.set(cle, acorn.parse(SOURCES[cle], { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true }));
  return _ast.get(cle);
};
/** Fonction affectee a `window.<nom>` n'importe ou dans le module (par ex. dans un bloc try), ou null. */
function affectationWindow(cle, nom) {
  const src = SOURCES[cle];
  let trouve = null;
  (function visiter(n) {
    if (!n || typeof n.type !== 'string' || trouve) return;
    if (n.type === 'AssignmentExpression' && n.left.type === 'MemberExpression' && n.left.object && n.left.object.name === 'window'
        && n.left.property && n.left.property.name === nom) { trouve = src.slice(n.right.start, n.right.end); return; }
    for (const k of Object.keys(n)) { const v = n[k]; if (Array.isArray(v)) v.forEach(visiter); else if (v && typeof v.type === 'string') visiter(v); }
  })(arbre(cle));
  return trouve;
}
function declarations(cle) {
  if (_decl.has(cle)) return _decl.get(cle);
  const src = SOURCES[cle];
  const ast = arbre(cle);
  const m = new Map();
  for (const n of ast.body) {
    if (n.type === 'FunctionDeclaration' && n.id) m.set(n.id.name, src.slice(n.start, n.end));
    else if (n.type === 'VariableDeclaration') for (const d of n.declarations) if (d.id.type === 'Identifier') m.set(d.id.name, src.slice(n.start, n.end));
  }
  _decl.set(cle, m);
  return m;
}
/** Evalue `requis` (+ `optionnels` presents dans CETTE copie : sur l'ancien code les tests echouent par comportement) avec des doublures. */
function charger(cle, requis, optionnels, inj) {
  const d = declarations(cle);
  for (const n of requis) assert.ok(d.has(n), `${cle} : ${n} introuvable`);
  const noms = [...optionnels.filter((n) => d.has(n)), ...requis];
  const cles = Object.keys(inj);
  const corps = noms.map((n) => d.get(n)).join('\n') + '\nreturn { ' + noms.join(', ') + ' };';
  return new Function(...cles, corps)(...cles.map((k) => inj[k]));
}

const AIDES = ['_estNomAscii', '_nomsEquivalents', '_projetDuNom', '_nomSaisiDuProjet'];
const silence = { log() {}, warn() {}, error() {} };

/** Monde d'une page : `projets` = [{ name, images: n, created, shell, shellCreated, displayName }]. Rend { F, state, peuples }. */
function monde(cle, { dossiers = [], coquilles = [], nomsAffiches = {} }) {
  const state = { currentProject: null, projects: [], jobs: [] };
  const peuples = [];
  const document = { getElementById: () => null, querySelector: () => null };
  const iso = (ms) => new Date(ms).toISOString();
  const API = cle === 'web'
    ? {
      listImageFolders: async () => dossiers.map((f) => ({ name: f.name, count: f.images, images: Array.from({ length: f.images }, (_, i) => `https://r2.example/${encodeURIComponent(f.name)}/${i}.png`), created: iso(f.created), prompt: '' })),
      listMeshes: async () => [],
      listProjectShells: async () => coquilles.map((c) => ({ name: c.name, created: iso(c.created), assetType: c.assetType || null, assetStyle: null, prompt: c.prompt || null })),
    }
    : {
      listImageFolders: async () => dossiers.map((f) => ({
        name: f.name, path: 'C:/images/' + f.name, images: Array.from({ length: f.images }, (_, i) => `C:/images/${f.name}/${i}.png`),
        imagesData: Array.from({ length: f.images }, (_, i) => ({ path: `C:/images/${f.name}/${i}.png`, created: new Date(f.created + i * 1000) })),
        count: f.images, created: new Date(f.created + (f.images - 1) * 1000), prompt: '', backPhotos: {},
      })),
      listMeshes: async () => [],
      listAnimations: async () => [],
      listerProjetsVides: async () => coquilles.map((c) => ({ name: c.name, created: c.created, assetType: c.assetType || null, assetStyle: null, prompt: c.prompt || '' })),
      getProjectDisplayNames: async () => ({ ...nomsAffiches }),
    };
  const F = charger(cle, ['refreshProjectsPage', 'reloadCurrentProject'], AIDES, {
    state, API, document, console: silence, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    renderProjectsGrid() {}, _runNsfwBackgroundScan() {}, populateWorkspace: (p) => peuples.push(p.name),
    _checkMultiviewForCurrentImage() {}, _offerMultiviewRegenerate() {}, setTimeout: () => 0, Date,
  });
  return { F, state, peuples };
}

const PAIRES = [
  ['chinois', '兽人战士', '精灵射手'],
  ['arabe', 'تنين', 'فارس'],
  ['russe', 'орк', 'дом'],
  ['accents', 'Éléphant', 'Àlèphant'],
  ['japonais', 'ドラゴン', 'ゴブリン'],
  ['hindi', 'ड्रैगन', 'योद्धा'],
];
const T0 = Date.parse('2026-10-01T10:00:00Z');
const H = 3600 * 1000;

/* ═══════════════ SITE (cloud/public/app/index2.js) ═══════════════ */
for (const [langue, a, b] of PAIRES) {
  test(`site, ${langue} : le rechargement garde « ${a} » ouvert (1 image) au lieu de basculer sur « ${b} » (3 images)`, async () => {
    const m = monde('web', { dossiers: [{ name: a, images: 1, created: T0 + 2 * H }, { name: b, images: 3, created: T0 }] });
    await m.F.refreshProjectsPage();
    m.state.currentProject = m.state.projects.find((p) => p.name === a);
    await m.F.reloadCurrentProject();
    assert.equal(m.state.currentProject.name, a, `bascule sur « ${m.state.currentProject.name} »`);
  });

  test(`site, ${langue} : un projet vide neuf « ${b} » ne disparait pas dans « ${a} » (plein, meme forme)`, async () => {
    const m = monde('web', { dossiers: [{ name: a, images: 2, created: T0 }], coquilles: [{ name: b, created: T0 + H, assetType: 'creature' }] });
    await m.F.refreshProjectsPage();
    const noms = m.state.projects.map((p) => p.name).sort();
    assert.deepEqual(noms, [a, b].sort(), 'projet vide retire de la liste');
    assert.equal(m.state.projects.find((p) => p.name === a).assetType, undefined, 'type du projet vide reporte sur l autre projet');
  });
}

test('site : « Café » plein et « Cafè » neuf restent deux projets (accent seul different)', async () => {
  const m = monde('web', { dossiers: [{ name: 'Café', images: 1, created: T0 }], coquilles: [{ name: 'Cafè', created: T0 + H }] });
  await m.F.refreshProjectsPage();
  assert.deepEqual(m.state.projects.map((p) => p.name).sort(), ['Cafè', 'Café'].sort());
});

test('site : le projet ouvert a disparu (derniere image supprimee) -> projet vide, PAS l autre projet de meme forme', async () => {
  const m = monde('web', { dossiers: [{ name: '精灵射手', images: 3, created: T0 }] });
  await m.F.refreshProjectsPage();
  m.state.currentProject = { name: '兽人战士', images: [], meshes: [], rigs: [], animations: [] };
  await m.F.reloadCurrentProject();
  assert.equal(m.state.currentProject.name, '兽人战士');
  assert.equal(m.state.currentProject.images.length, 0);
});

test('site, non-regression ASCII : projet vide « Mobilier design » + contenu « Mobilier_design » -> un seul projet, rouvert apres generation', async () => {
  const m = monde('web', { dossiers: [{ name: 'Mobilier_design', images: 1, created: T0 + H }, { name: 'Orc', images: 2, created: T0 }],
    coquilles: [{ name: 'Mobilier design', created: T0, assetType: 'building' }] });
  await m.F.refreshProjectsPage();
  assert.deepEqual(m.state.projects.map((p) => p.name).sort(), ['Mobilier_design', 'Orc']);
  assert.equal(m.state.projects.find((p) => p.name === 'Mobilier_design').assetType, 'building', 'type reporte depuis le projet vide');
  m.state.currentProject = { name: 'Mobilier design', images: [], meshes: [], rigs: [], animations: [] };
  await m.F.reloadCurrentProject();
  assert.equal(m.state.currentProject.name, 'Mobilier_design');
  m.state.currentProject = m.state.projects.find((p) => p.name === 'Orc');
  await m.F.reloadCurrentProject();
  assert.equal(m.state.currentProject.name, 'Orc');
  assert.equal(m.state.currentProject.images.length, 2);
});

/* ═══════════════ BUREAU (src/renderer/index2.js) ═══════════════ */
for (const [langue, a, b] of PAIRES) {
  test(`bureau, ${langue} : « ${a} » et « ${b} » ont chacun leur dossier ; apres la 1re generation, le rechargement rouvre « ${a} »`, async () => {
    // dossiers rendus par main.js (src/main/slug_projet.js) et noms saisis memorises (config.projectDisplayNames)
    const da = slugBureau ? slugBureau.slugProjet(a) : a, db = slugBureau ? slugBureau.slugProjet(b) : b;
    const m = monde('bureau', { dossiers: [{ name: da, images: 1, created: T0 + 2 * H }, { name: db, images: 3, created: T0 }],
      coquilles: [{ name: a, created: T0 + H }, { name: b, created: T0 - H }], nomsAffiches: { [da]: a, [db]: b } });
    await m.F.refreshProjectsPage();
    assert.equal(m.state.projects.length, 2, 'chaque projet vide rejoint SON dossier : ' + m.state.projects.map((p) => p.name).join(', '));
    // projet NEUF ouvert sous son nom saisi, puis rechargement apres la premiere generation
    m.state.currentProject = { name: a, images: [], meshes: [], rigs: [], animations: [] };
    await m.F.reloadCurrentProject();
    assert.equal(m.state.currentProject.displayName || m.state.currentProject.name, a, `bascule sur « ${m.state.currentProject.name} »`);
    assert.equal(m.state.currentProject.images.length, 1, 'le projet rouvert est celui qui porte l image generee');
  });
}

test('bureau : dossier de la nouvelle regle (« project-h… ») relie a son nom saisi par config.projectDisplayNames', async () => {
  assert.ok(slugBureau, 'src/main/slug_projet.js introuvable');
  const dossier = slugBureau.slugProjet('兽人战士');
  assert.match(dossier, /^project-h[0-9a-f]{8}$/);
  const m = monde('bureau', { dossiers: [{ name: dossier, images: 2, created: T0 + H }], coquilles: [{ name: '兽人战士', created: T0, assetType: 'creature' }],
    nomsAffiches: { [dossier]: '兽人战士' } });
  await m.F.refreshProjectsPage();
  assert.equal(m.state.projects.length, 1, 'projet vide et dossier forment UN projet');
  const p = m.state.projects[0];
  assert.equal(p.name, dossier);
  assert.equal(p.displayName, '兽人战士');
  assert.equal(p.assetType, 'creature', 'type du projet vide reporte sur son dossier');
});

test('bureau : ANCIEN dossier « ____ » (avant le correctif) — le projet vide cree AVANT son contenu le reprend sous son vrai nom', async () => {
  const m = monde('bureau', { dossiers: [{ name: '____', images: 2, created: T0 + H }], coquilles: [{ name: '兽人战士', created: T0 }] });
  await m.F.refreshProjectsPage();
  assert.deepEqual(m.state.projects.map((p) => [p.name, p.displayName]), [['____', '兽人战士']]);
});

test('bureau : ANCIEN dossier « ____ » + projet vide NEUF « 精灵射手 » cree APRES -> le nouveau projet reste visible (il n est pas l auteur)', async () => {
  const m = monde('bureau', { dossiers: [{ name: '____', images: 2, created: T0 }], coquilles: [{ name: '精灵射手', created: T0 + 5 * H, assetType: 'character' }] });
  await m.F.refreshProjectsPage();
  const noms = m.state.projects.map((p) => p.name).sort();
  assert.deepEqual(noms, ['____', '精灵射手'].sort(), 'projet neuf avale par l ancien dossier');
  assert.equal(m.state.projects.find((p) => p.name === '____').displayName || null, null, 'l ancien dossier ne prend pas le nom du nouveau projet');
});

test('bureau, non-regression ASCII : « Mobilier design » rejoint « Mobilier_design », un projet ASCII existant se rouvre a l identique', async () => {
  const m = monde('bureau', { dossiers: [{ name: 'Mobilier_design', images: 1, created: T0 + H }, { name: 'Orc', images: 2, created: T0 }],
    coquilles: [{ name: 'Mobilier design', created: T0, assetType: 'building' }] });
  await m.F.refreshProjectsPage();
  assert.deepEqual(m.state.projects.map((p) => p.name).sort(), ['Mobilier_design', 'Orc']);
  assert.equal(m.state.projects.find((p) => p.name === 'Mobilier_design').displayName, null, 'aucun nom d affichage invente pour un nom ASCII');
  m.state.currentProject = { name: 'Mobilier design', images: [], meshes: [], rigs: [], animations: [] };
  await m.F.reloadCurrentProject();
  assert.equal(m.state.currentProject.name, 'Mobilier_design');
  m.state.currentProject = m.state.projects.find((p) => p.name === 'Orc');
  await m.F.reloadCurrentProject();
  assert.equal(m.state.currentProject.name, 'Orc');
});

test('bureau : le nom place devant la description (prompt) est le nom SAISI, jamais le dossier « project-h… »', () => {
  // Le nom envoye au SITE (images, partage, clip d'animation) et le dossier d'un telechargement ne sont plus decides par la page : elle
  // envoie le nom de dossier et le processus principal applique UNE regle (revue du lot 3) — voir tests/main/noms-projet-chaine.test.mjs.
  const F = charger('bureau', ['_nomSaisiDuProjet'], ['_estNomAscii'], {});
  const neuf = { name: 'project-hde2e0b71', displayName: '兽人战士' };
  const ascii = { name: 'Mobilier_design', displayName: null };
  const renomme = { name: 'orc', displayName: 'Mon orc' };
  assert.equal(F._nomSaisiDuProjet(neuf), '兽人战士');
  assert.equal(F._nomSaisiDuProjet(ascii), 'Mobilier_design');
  assert.equal(F._nomSaisiDuProjet(renomme), 'orc', 'un renommage d affichage ASCII ne remplace pas le nom du projet dans le prompt');
  // assert.ok plutot que assert.match : un echec ne recopie pas les 1,6 Mo de la page dans la sortie
  assert.ok(/_sujetDuProjet\(_nomSaisiDuProjet\(p\), saisi\)/.test(SOURCES.bureau), 'populateWorkspace place encore le nom de dossier dans le prompt');
});

/* ═══════════════ regle « un seul candidat » et repli assaini (revue du lot 3 : mutants survivants) ═══════════════ */
for (const cle of ['web', 'bureau']) {
  test(`${cle} : _projetDuNom — nom EXACT d abord ; equivalence seulement si elle ne designe qu UN projet`, () => {
    const F = charger(cle, ['_projetDuNom'], ['_estNomAscii', '_nomsEquivalents'], {});
    const P = (name, displayName = null) => ({ name, displayName });
    const souligne = P('orc_woman'), point = P('orc.woman'), orc = P('Orc');
    assert.equal(F._projetDuNom([souligne, point, orc], 'orc woman'), null, 'deux projets equivalents : aucun des deux (pas de bascule au hasard)');
    assert.equal(F._projetDuNom([point, souligne], 'orc woman'), null, 'idem, ordre inverse');
    assert.equal(F._projetDuNom([souligne, orc], 'orc woman'), souligne, 'un seul projet equivalent : celui-la');
    assert.equal(F._projetDuNom([souligne, point], 'orc.woman'), point, 'le nom exact passe avant toute equivalence');
    const nfd = P('Cafe\u0301');
    assert.equal(F._projetDuNom([nfd, orc], 'Caf\u00e9'), nfd, 'meme nom a la normalisation Unicode pres');
    assert.equal(F._projetDuNom([P('兽人战士'), P('精灵射手')], '____'), null, 'la forme assainie ne relie jamais deux noms non latins');
    const dossier = P('project-hde2e0b71', '兽人战士');
    assert.equal(F._projetDuNom([P('精灵射手'), dossier], '兽人战士'), dossier, 'nom saisi memorise d un dossier non latin');
  });
}

test('site : nom ouvert absent et DEUX projets equivalents (« orc_woman » 3 images, « orc.woman » 1) -> le rechargement ne bascule sur aucun', async () => {
  // Comportement choisi par le lot (rechargement apres suppression de la derniere image) : un projet vide plutot qu'un AUTRE projet.
  const m = monde('web', { dossiers: [{ name: 'orc_woman', images: 3, created: T0 }, { name: 'orc.woman', images: 1, created: T0 + H }] });
  await m.F.refreshProjectsPage();
  m.state.currentProject = { name: 'orc woman', images: [], meshes: [], rigs: [], animations: [] };
  await m.F.reloadCurrentProject();
  assert.equal(m.state.currentProject.name, 'orc woman', `bascule sur « ${m.state.currentProject.name} »`);
  assert.equal(m.state.currentProject.images.length, 0);
});

/** window.openProjectByName du SITE (historique -> projet) avec une liste de projets donnee ; rend les projets ouverts et les avis. */
function ouvertureSite(projets) {
  const src = affectationWindow('web', 'openProjectByName');
  assert.ok(src, 'window.openProjectByName introuvable');
  const d = declarations('web');
  // Integration du 14/10 : avec le lot interface multilingue, l'avis « Project "{x}" not found » passe par _i18nTf (aide de la
  // page). Sans elle dans le bac a sable, la fonction levait ReferenceError dans son try et l'avis n'etait jamais montre (faux
  // echec : la page reelle l'a). window sans FabI18n = repli anglais de l'aide, nom insere tel quel.
  const aides = ['_estNomAscii', '_i18nT', '_i18nTf'].filter((n) => d.has(n));
  const state = { projects: projets.map((name) => ({ name, images: [], meshes: [] })) };
  const ouverts = [], avis = [];
  const inj = { state, refreshProjectsPage: async () => {}, openProject: async (p) => { ouverts.push(p.name); }, showToast: (t) => avis.push(t),
    document: { getElementById: () => null }, console: silence, renderImageVersions() {}, renderMeshVersions() {}, window: {} };
  const cles = Object.keys(inj);
  const f = new Function(...cles, aides.map((n) => d.get(n)).join('\n') + '\nreturn (' + src + ');')(...cles.map((k) => inj[k]));
  return { f, ouverts, avis };
}

test('site : openProjectByName(« ____ ») n ouvre PAS un projet non latin pris au hasard ; le repli assaini reste pour les noms ASCII', async () => {
  const o = ouvertureSite(['兽人战士', '精灵射手']);
  await o.f('____');
  assert.deepEqual(o.ouverts, [], 'projet ouvert : ' + o.ouverts.join(', '));
  assert.equal(o.avis.length, 1, 'l utilisateur est prevenu que le projet est introuvable');
  assert.ok(String(o.avis[0]).includes('"____"'), 'le nom demande figure tel quel dans l avis : ' + o.avis[0]);
  const ascii = ouvertureSite(['兽人战士', 'Mobilier design']);
  await ascii.f('Mobilier_design');
  assert.deepEqual(ascii.ouverts, ['Mobilier design'], 'repli assaini d un nom ASCII (cas d origine)');
});
