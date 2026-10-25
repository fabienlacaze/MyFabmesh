// « Reshape a region » avec une VUE CHOISIE dans le visualiseur 3D (2026-10-19) : module partage, deux etapes, parite bureau / site.
// Demande du proprietaire : « Reshape a region doit avoir un viewer 3D pour permettre d'afficher la zone que l'on souhaite,
// pas un 2D de face ». Verifie, sans navigateur ni Python :
//   - src/renderer/lib/reshape-vue.js : validation des angles, conversion camera -> yaw / pitch, matrice, demi-largeur
//     (cas partages avec Python, le worker et le processus principal : build/bancs/noyaux/reshape_vue_cas.json) ;
//   - la table des DEUX ETAPES (ce que montre la fenetre a l'etape 1 / 2 / 0) ;
//   - la PARITE : le module est identique bureau / site, les deux pages ont les memes elements, appellent le rendu avec les
//     angles, transmettent la vue a reshapeRegion, et le site la transmet a la route /api/mesh-reshape ;
//   - les libelles nouveaux dans les 5 langues, bureau ET site.
// Lancer :  node --test tests/bureau-interface/reshape-vue.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, '..', '..');
const lire = (p) => fs.readFileSync(path.join(RACINE, p), 'utf8').replace(/\r\n/g, '\n');
const CAS = JSON.parse(lire('build/bancs/noyaux/reshape_vue_cas.json'));
const jeton = (v) => (v === '__NaN__' ? NaN : v === '__Infinity__' ? Infinity : v === '__-Infinity__' ? -Infinity : v);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reshape_vue_ui_'));
process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {} });
fs.writeFileSync(path.join(tmp, 'reshape-vue.mjs'), lire('src/renderer/lib/reshape-vue.js'));
const L = await import(pathToFileURL(path.join(tmp, 'reshape-vue.mjs')).href);

test('validerVue : les cas partages (angles dans les bornes, nombres finis, pas de chaine ni de booleen)', () => {
  for (const c of CAS.cas) {
    const r = L.validerVue(jeton(c.yaw), jeton(c.pitch));
    assert.equal(r.ok, c.ok, JSON.stringify(c));
    if (c.ok) assert.deepEqual([r.yaw, r.pitch], c.sortie, JSON.stringify(c));
  }
  assert.equal(Object.is(L.validerVue(-0, -0).yaw, 0), true);
});

test('xmagPourVue et validerXmag : les cas partages', () => {
  for (const [entree, attendu] of CAS.xmag_pour_vue) assert.equal(L.xmagPourVue(entree), attendu, String(entree));
  for (const c of CAS.xmag_valide) {
    const r = L.validerXmag(jeton(c.x));
    assert.equal(r.ok, c.ok, JSON.stringify(c));
    if (c.ok) assert.equal(r.xmag, c.sortie);
  }
});

test('anglesDepuisCamera : de face, dos, cotes, dessus, dessous, diagonale, cible decalee', () => {
  for (const c of CAS.camera) {
    const [px, py, pz] = c.position, [tx, ty, tz] = c.cible;
    const r = L.anglesDepuisCamera({ x: px, y: py, z: pz }, { x: tx, y: ty, z: tz });
    assert.deepEqual([r.yaw, r.pitch], [c.yaw, c.pitch], JSON.stringify(c));
    assert.equal(L.validerVue(r.yaw, r.pitch).ok, true, 'les angles releves sont toujours valides');
  }
  // camera confondue avec la cible : vue de face, jamais NaN
  assert.deepEqual(L.anglesDepuisCamera({ x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: 1 }), { yaw: 0, pitch: 0 });
  // balayage : tout point de la sphere donne des angles valides
  for (let i = 0; i < 2000; i++) {
    const a = Math.random() * 2 * Math.PI, b = (Math.random() - 0.5) * Math.PI, d = 0.5 + Math.random() * 20;
    const r = L.anglesDepuisCamera({ x: d * Math.sin(a) * Math.cos(b), y: d * Math.sin(b), z: d * Math.cos(a) * Math.cos(b) }, { x: 0, y: 0, z: 0 });
    assert.equal(L.validerVue(r.yaw, r.pitch).ok, true, JSON.stringify(r));
  }
});

test('matriceVue : rotation pure, camera sur +Z, valeurs identiques a celles de Python', () => {
  for (const c of CAS.matrice) {
    const r = L.matriceVue(c.yaw, c.pitch);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) assert.ok(Math.abs(r[i][j] - c.r[i][j]) < 1e-9, `${c.yaw}/${c.pitch} [${i}][${j}]`);
    const a = c.yaw * Math.PI / 180, b = c.pitch * Math.PI / 180;
    const d = [Math.sin(a) * Math.cos(b), Math.sin(b), Math.cos(a) * Math.cos(b)];
    const v = r.map((ligne) => ligne[0] * d[0] + ligne[1] * d[1] + ligne[2] * d[2]);
    assert.ok(Math.abs(v[0]) < 1e-9 && Math.abs(v[1]) < 1e-9 && Math.abs(v[2] - 1) < 1e-9, 'la direction de la camera va sur +Z');
  }
  assert.deepEqual(L.matriceVue(0, 0), [[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
});

test('normaliserVue : vue de face = null (rien a envoyer), vue tournee = trois nombres valides', () => {
  assert.deepEqual(L.normaliserVue(null), { ok: true, vue: null });
  assert.deepEqual(L.normaliserVue({ yaw: 0, pitch: 0, xmag: 0.9 }), { ok: true, vue: null });
  assert.deepEqual(L.normaliserVue({ yaw: 90, pitch: 10 }), { ok: true, vue: { yaw: 90, pitch: 10, xmag: 0.6 } });
  assert.equal(L.normaliserVue({ yaw: 91, pitch: 10, xmag: 5 }).ok, false);
  assert.equal(L.normaliserVue('x').ok, false);
});

test('nomVue : les six vues rapides et l angle quelconque', () => {
  assert.equal(L.nomVue(0, 0), 'Front');
  assert.equal(L.nomVue(180, 0), 'Back');
  assert.equal(L.nomVue(-180, 0), 'Back');
  assert.equal(L.nomVue(90, 0), 'Right');
  assert.equal(L.nomVue(-90, 0), 'Left');
  assert.equal(L.nomVue(0, 89.9), 'Top');
  assert.equal(L.nomVue(0, -89.9), 'Bottom');
  assert.equal(L.nomVue(45, 10), 'Angled view');
});

test('affichageEtape : etape 1 = visualiseur + « Use this view » ; etape 2 = fenetre a plat + « Change view » + « Apply » ; 0 = comme avant', () => {
  const e1 = L.affichageEtape(1), e2 = L.affichageEtape(2), e0 = L.affichageEtape(0);
  assert.deepEqual(Object.keys(e1).sort(), Object.keys(e2).sort());
  // etape 1
  assert.equal(e1['rrx-3d-stage'], true); assert.equal(e1['rrx-3d-panel'], true); assert.equal(e1['rrx-use-view'], true);
  assert.equal(e1['rrx-stage'], false); assert.equal(e1['rrx-form'], false); assert.equal(e1['rrx-apply'], false);
  assert.equal(e1['rrx-change-view'], false);
  // etape 2
  assert.equal(e2['rrx-3d-stage'], false); assert.equal(e2['rrx-3d-panel'], false); assert.equal(e2['rrx-use-view'], false);
  assert.equal(e2['rrx-stage'], true); assert.equal(e2['rrx-form'], true); assert.equal(e2['rrx-apply'], true);
  assert.equal(e2['rrx-change-view'], true); assert.equal(e2['rrx-vue-nom'], true);
  // etape 0 : « Re-texture a region » garde sa fenetre a plat seule, sans aucun bouton d'etape
  assert.equal(e0['rrx-stage'], true); assert.equal(e0['rrx-apply'], true);
  assert.equal(e0['rrx-3d-stage'] || e0['rrx-3d-panel'] || e0['rrx-use-view'] || e0['rrx-change-view'] || e0['rrx-vue-nom'], false);
  // jamais « Apply » avec le visualiseur : on ne lance pas sans avoir choisi la vue
  for (const n of [0, 1, 2]) assert.equal(L.affichageEtape(n)['rrx-apply'] && L.affichageEtape(n)['rrx-3d-stage'], false);
});

test('le module est IDENTIQUE sur le bureau et sur le site', () => {
  assert.equal(lire('src/renderer/lib/reshape-vue.js'), lire('cloud/public/app/lib/reshape-vue.js'));
});

const CIBLES = [
  { nom: 'bureau', js: 'src/renderer/index2.js', html: 'src/renderer/index2.html', lang: 'src/renderer/lang', i18n: 'src/renderer/i18n.js' },
  { nom: 'site', js: 'cloud/public/app/index2.js', html: 'cloud/public/app/index.html', lang: 'cloud/public/app/lang', i18n: 'cloud/public/app/i18n.js' },
];

for (const c of CIBLES) {
  test(`${c.nom} : la page importe le module, a tous les elements des deux etapes et les sept vues rapides, Iso en premier`, () => {
    const js = lire(c.js), html = lire(c.html);
    assert.match(js, /from '\.\/lib\/reshape-vue\.js'/);
    for (const id of Object.keys(L.affichageEtape(1))) assert.ok(html.includes(`id="${id}"`), `${c.nom} : element #${id} absent de la page`);
    assert.ok(html.includes('id="rrx-3d-canvas"') && html.includes('id="rrx-3d-info"'));   // les sept vues viennent de la barre commune (LOT W27)
    for (const [yaw, pitch] of [[45, 30], [0, 0], [180, 0], [-90, 0], [90, 0], [0, 89.9], [0, -89.9]]) assert.equal(L.validerVue(yaw, pitch).ok, true);
    // l'etape 1 est la premiere chose que voit « Reshape a region »
    assert.match(js, /Viewer3D\(\{ canvas: (cv|\$\('rrx-3d-canvas'\))/);
    // « Use this view » rend la vue A PLAT depuis l'angle releve de la camera
    assert.match(js, /renderMeshFront\??\.?\(\{ meshPath(: mp)?, yaw: v\.yaw, pitch: v\.pitch \}\)/);
    assert.match(js, /_rrxAngles\((_rrxViewer|visualiseur)\.camera\.position, (_rrxViewer|visualiseur)\.controls\.target\)/);
  });
}

test('bureau : « Apply » envoie la vue choisie a reshapeRegion ; « Change view » efface la zone peinte (elle appartenait a l ancien angle)', () => {
  const js = lire('src/renderer/index2.js');
  // (motif tolerant : un autre lot peut ajouter des champs a l'appel, par exemple la langue deja verifiee)
  assert.match(js, /API\.reshapeRegion\?\.\(\{[^\n]*\.\.\.\(vue \? \{ vue \} : \{\}\)[^\n]*\}\)/);
  const m = js.match(/\$\('rrx-change-view'\)\?\.addEventListener\('click', \(\) => \{([\s\S]*?)\n  \}\);/);
  assert.ok(m, 'gestionnaire de « Change view » introuvable');
  assert.match(m[1], /ctx\.clearRect\(0, 0, canvas\.width, canvas\.height\); hasPaint = false; _rrxFrontPath = null; _rrxVue = null;/);
  assert.match(m[1], /_rrxJetonRendu\+\+;\s+_rrxRetourVisualiseur\(\)/);
  // le retour a l'etape 1 RELANCE le visualiseur (arrete a l'etape 2) : sans cela il restait fige apres un rendu a plat en echec
  const retour = js.match(/function _rrxRetourVisualiseur\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(retour, '_rrxRetourVisualiseur introuvable');
  assert.match(retour[1], /_rrxEtape\(1\)/);
  assert.match(retour[1], /_rrxViewer\?\.startTickLoop\?\.\(\)/);
  // « Reshape a region » commence par le visualiseur ; « Re-texture a region » garde la fenetre a plat seule
  assert.match(js, /if \(m === 'shape'\) \{[^}]*_rrxEtape\(1\);[^}]*_rrxOuvrirVisualiseur\(meshPath\)/);
  assert.match(js, /_rrxEtape\(0\);\s+\/\/ Re-texture a region/);
});

test('site : le rendu a plat tourne le MAILLAGE (matrice du module), elargit la fenetre, rend { dataUrl, vue } ; le shim et la route transmettent la vue', () => {
  const js = lire('cloud/public/app/index2.js');
  const rendu = js.slice(js.indexOf('window.__rendreVueAPlat'), js.indexOf('(function _initReshapeWeb'));
  assert.match(rendu, /_rrxValiderVue\(yaw, pitch\)/);
  assert.match(rendu, /_rrxMatriceVue\(choix\.yaw, choix\.pitch\)/);
  assert.match(rendu, /modele\.applyMatrix4\(m4\)/);
  assert.match(rendu, /setFromObject\(modele, true\)/);
  assert.match(rendu, /_rrxXmagPourVue\(/);
  assert.match(rendu, /new THREE\.OrthographicCamera\(-xm, xm, xm, -xm, 0\.01, 100\)/);
  assert.match(rendu, /vue: tourne \? \{ yaw: choix\.yaw, pitch: choix\.pitch, xmag: xm \} : null/);
  // l'ancienne entree reste (un autre code pourrait l'appeler) et rend toujours la vue de face
  assert.match(rendu, /window\.__rendreFaceAPlat = async function \(url, taille = 1024\) \{\s+return \(await window\.__rendreVueAPlat\(url, taille, 0, 0\)\)\.dataUrl;/);
  assert.match(js, /_lancerReshape\(\{[^\n]*\bvue: vueAngle[^\n]*\}\)/);
  assert.match(js, /function _lancerReshape\(\{[^\n]*\bvue\b[^\n]*\}\) \{/);
  assert.match(js, /API\.reshapeRegion\(\{[^\n]*\.\.\.\(vue \? \{ vue \} : \{\}\)[^\n]*\}\)/);
  const shim = lire('cloud/public/app/meshyAPI-cloud.js');
  assert.match(shim, /renderMeshFront: async \(\{ meshPath, meshUrl, yaw, pitch \} = \{\}\)/);
  assert.match(shim, /__rendreVueAPlat\(url, 1024, yaw \|\| 0, pitch \|\| 0\)/);
  assert.match(shim, /return \{ ok: true, dataUrl, frontPath: r\.path, vue \};/);
  assert.match(shim, /\.\.\.\(vueEnvoyee \? \{ vue: vueEnvoyee \} : \{\}\)/);
});

test('les libelles nouveaux sont traduits dans les 5 langues, bureau ET site', async () => {
  const { chargerDictionnaires } = await import(pathToFileURL(path.join(RACINE, 'build', 'couverture-traductions.mjs')).href);
  const CLES = ['Use this view', 'Change view', 'Angled view', 'Could not open the 3D viewer.',
    'Turn the model until you see the part to rebuild, then press Use this view.',
    'Middle-drag: rotate · right-drag: pan · wheel: zoom. Zoom is only for looking: the next step shows the whole model from this angle.',
    'Front', 'Back', 'Left', 'Right', 'Top', 'Bottom', 'View'];
  for (const c of CIBLES) {
    const dicts = chargerDictionnaires({ i18n: path.join(RACINE, c.i18n), dossierLang: path.join(RACINE, c.lang) });
    for (const lg of ['fr', 'es', 'zh', 'hi', 'ar']) {
      for (const k of CLES) {
        const t = dicts[lg] && dicts[lg][k];
        assert.ok(t && t !== k, `${c.nom} / ${lg} : « ${k} » non traduit`);
      }
    }
    // les textes de l'interface sont exactement les cles (le traducteur du DOM compare le texte tel quel)
    const html = lire(c.html);
    for (const k of ['Use this view', 'Change view', CLES[4], CLES[5]]) assert.ok(html.includes(k), `${c.nom} : « ${k} » absent de la page`);
    assert.ok(lire(c.js).includes("_i18nT('Could not open the 3D viewer.')"));
  }
});

test('aucun nom de moteur dans les libelles visibles de la fenetre', () => {
  const interdits = /unirig|trellis|puppeteer|realvis|clipseg|lucida|flux|sdxl/i;
  for (const c of CIBLES) {
    const html = lire(c.html);
    const bloc = html.slice(html.indexOf('id="rrx-3d-stage"'), html.indexOf('id="rrx-apply"'));
    const visibles = bloc.replace(/<[^>]+>/g, ' ');
    assert.ok(!interdits.test(visibles), `${c.nom} : un nom de moteur est visible dans la fenetre`);
  }
});

// ---- relecture du 2026-10-20 : trois defauts de l'ebauche du 19/10, corriges des DEUX cotes ----
for (const c of [
  { nom: 'bureau', js: 'src/renderer/index2.js', retour: '_rrxRetourVisualiseur', liberer: '_rrxLiberer', jeton: '_rrxJetonRendu', chargement: '_rrxJeton', viewer: '_rrxViewer', modele: '_rrxModele', partage: '_rrxPartage' },
  { nom: 'site', js: 'cloud/public/app/index2.js', retour: 'retourVisualiseur', liberer: 'liberer', jeton: 'jetonRendu', chargement: 'jeton3d', viewer: 'visualiseur', modele: 'modele3d', partage: 'partage3d' },
]) {
  test(`${c.nom} : le retour a l etape 1 relance le visualiseur (arrete a l etape 2), y compris quand le rendu a plat echoue`, () => {
    const js = lire(c.js);
    const retour = js.match(new RegExp(`function ${c.retour}\\(\\) \\{([\\s\\S]*?)\\n  \\}`));
    assert.ok(retour, `${c.retour} introuvable`);
    assert.match(retour[1], /\(1\)/);
    assert.match(retour[1], new RegExp(`${c.viewer}\\?\\.startTickLoop\\?\\.\\(\\)`));
    // l'echec du rendu (reponse en erreur ou exception) passe par ce retour : jamais un visualiseur fige
    const corps = js.slice(js.indexOf(c.nom === 'bureau' ? 'async function _rrxUtiliserVue' : 'async function utiliserVue'));
    const fonction = corps.slice(0, corps.indexOf('\n  }\n') + 5);
    assert.ok((fonction.match(new RegExp(`${c.retour}\\(\\)`, 'g')) || []).length >= (c.nom === 'bureau' ? 2 : 1), 'tous les chemins d echec reviennent au visualiseur');
  });

  test(`${c.nom} : un rendu a plat perime (fenetre fermee ou vue changee pendant le calcul) est ignore`, () => {
    const js = lire(c.js);
    const debut = js.indexOf(c.nom === 'bureau' ? 'async function _rrxUtiliserVue' : 'async function utiliserVue');
    const fonction = js.slice(debut, js.indexOf('\n  }\n', debut) + 5);
    assert.match(fonction, new RegExp(`\\+\\+${c.jeton}`), 'un jeton est pris au lancement');
    assert.match(fonction, new RegExp(`!== ${c.jeton}`), 'le jeton est controle apres l attente');
    // fermer / « Change view » invalident le jeton
    assert.match(js, new RegExp(`${c.jeton}\\+\\+;[^\\n]*${c.liberer}\\(\\)`), 'la fermeture invalide le jeton et libere le modele');
    // ... et le chargement du modele encore en cours : sans cela il s'ajoutait a la scene d'une fenetre deja fermee
    assert.match(js, new RegExp(`${c.chargement}\\+\\+; ${c.jeton}\\+\\+;`), 'la fermeture invalide le chargement du modele');
  });

  test(`${c.nom} : la fermeture retire le modele du visualiseur et ne libere la memoire graphique que s il n est pas partage`, () => {
    const js = lire(c.js);
    const m = js.match(new RegExp(`function ${c.liberer}\\(\\) \\{([\\s\\S]*?)\\n  \\}`));
    assert.ok(m, `${c.liberer} introuvable`);
    assert.match(m[1], new RegExp(`${c.viewer}\\??\\.scene\\.remove\\(m\\)`));
    // la copie de l'etape partage geometrie et textures avec le visualiseur principal : on n'y touche pas
    assert.match(m[1], new RegExp(`if \\(${c.partage}\\) return;`));
    assert.match(m[1], /geometry\.dispose\(\)/);
    assert.match(m[1], /isTexture/);
    // le drapeau de partage vient du meme test que le choix du chargeur
    assert.match(js, new RegExp(`${c.partage} = !!_etapeAffiche\\(`));
  });
}
