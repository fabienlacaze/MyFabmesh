// Filtrage anisotrope + mipmaps des textures des visualiseurs 3D (2026-10-15, demande du proprietaire : « Filtrage anisotrope du
// visualiseur »). Execute le VRAI lib/filtrage-textures.js contre le VRAI three r170 et le VRAI GLTFLoader livres dans src/renderer/lib
// (l'importmap des pages est rejouee par _importmap-lib.mjs) ; un GLB minimal est fabrique en memoire (_glb-minimal.mjs).
// Aucune page, aucun reseau, aucun GPU. Lancer : node --test tests/bureau-interface/filtrage-textures.test.mjs
//
// POUR PROUVER QUE CES TESTS ECHOUENT SANS LE CORRECTIF (ou sur un module casse) :
//   FICHIER_FILTRAGE=<chemin d'une variante du module>   FICHIER_VIEWER3D=<Viewer3D.js du bureau, ancien>
//   FICHIER_VIEWER3D_SITE=<Viewer3D.js du site, ancien>
// build/bancs/viewer/prouver_tests_filtrage.mjs fabrique des variantes cassees du module (et l'etat d'AVANT le correctif :
// module sans effet + Viewer3D.js de l'ancienne base) et verifie que chacune est refusee. Lancer la meme suite sur la copie
// du SITE : cloud/tests/filtrage-textures-site.test.mjs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import v8 from 'node:v8';
import vm from 'node:vm';
import { brancherImportmap } from './_importmap-lib.mjs';
import { glbMinimal, pngDamier, installerDecodeurFactice } from './_glb-minimal.mjs';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LIB = join(RACINE, 'src/renderer/lib');
const FICHIER_FILTRAGE = process.env.FICHIER_FILTRAGE || join(LIB, 'filtrage-textures.js');
const FICHIER_VIEWER3D = process.env.FICHIER_VIEWER3D || join(LIB, 'Viewer3D.js');
const FICHIER_VIEWER3D_SITE = process.env.FICHIER_VIEWER3D_SITE || join(RACINE, 'cloud/public/app/lib/Viewer3D.js');
const lire = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

brancherImportmap({ three: join(LIB, 'three.module.js'), addons: LIB });
const THREE = await import('three');
const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
const retirerDecodeur = installerDecodeurFactice(1024, 1024);
after(() => retirerDecodeur());

const chargerGlb = (Chargeur = GLTFLoader) => new Promise((ok, ko) => new Chargeur().parse(glbMinimal(), '', ok, ko));
const cartesDe = (gltf) => {
  const sortie = {};
  gltf.scene.traverse((o) => { if (o.isMesh) for (const [cle, t] of Object.entries(o.material)) if (t && t.isTexture) sortie[cle] = t; });
  return sortie;
};

// ---- TEMOIN, pris AVANT d'importer le module : ce que three fait tout seul ----
const DEFAUT_AVANT = THREE.Texture.DEFAULT_ANISOTROPY;
const PARSE_ORIGINE = GLTFLoader.prototype.parse;
const TEMOIN = cartesDe(await chargerGlb());

const M = await import(pathToFileURL(FICHIER_FILTRAGE).href);

const PLAFOND = 16;
const rendu = (max, dejaLa = () => false) => ({ capabilities: { getMaxAnisotropy: () => max }, properties: { has: (t) => dejaLa(t), get: () => ({ __webglTexture: {} }) } });
const scene = (...matieres) => {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.BufferGeometry(), matieres.length === 1 ? matieres[0] : matieres));
  return g;
};
const texture = (reglages = {}) => Object.assign(new THREE.Texture({ width: 64, height: 64 }), reglages);

// ===================================================================================================================
test('temoin : sans le module, three laisse toutes les cartes d un GLB a l anisotropie 1, et deux echantillonneurs rendent le reglage sans effet', () => {
  assert.equal(DEFAUT_AVANT, 1, 'DEFAULT_ANISOTROPY d origine');
  for (const [cle, t] of Object.entries(TEMOIN)) assert.equal(t.anisotropy, 1, cle + ' : anisotropie d origine');
  // three (setTextureParameters) n applique l anisotropie QUE si minFilter = LinearMipmapLinear (ou NearestMipmapLinear) :
  assert.equal(TEMOIN.normalMap.minFilter, THREE.LinearMipmapNearestFilter, 'echantillonneur 9985 : anisotropie ignoree par three');
  assert.equal(TEMOIN.roughnessMap.minFilter, THREE.LinearFilter, 'echantillonneur 9729 : pas de mipmaps');
  assert.equal(TEMOIN.roughnessMap.generateMipmaps, false);
});

test('plafond : 16 sur ordinateur, 8 sur ecran tactile (pointeur grossier), 16 si matchMedia est absent ou leve', () => {
  assert.equal(M.plafondAnisotropie({ matchMedia: () => ({ matches: false }) }), 16);
  assert.equal(M.plafondAnisotropie({ matchMedia: (q) => ({ matches: q === '(pointer: coarse)' }) }), 8);
  assert.equal(M.plafondAnisotropie({}), 16);
  assert.equal(M.plafondAnisotropie({ matchMedia: () => { throw new Error('indisponible'); } }), 16);
  assert.equal(M.ANISOTROPIE_ORDINATEUR, 16);
  assert.equal(M.ANISOTROPIE_TACTILE, 8);
});

test('anisotropieCible : min(plafond, capacite de la carte), jamais sous 1, plafond seul sans renderer', () => {
  const ordi = { matchMedia: () => ({ matches: false }) };
  const tactile = { matchMedia: () => ({ matches: true }) };
  assert.equal(M.anisotropieCible(rendu(16), ordi), 16);
  assert.equal(M.anisotropieCible(rendu(4), ordi), 4, 'carte limitee a 4x');
  assert.equal(M.anisotropieCible(rendu(32), ordi), 16, 'carte a 32x : plafond 16');
  assert.equal(M.anisotropieCible(rendu(16), tactile), 8, 'tactile : 8');
  assert.equal(M.anisotropieCible(rendu(0), ordi), 1, 'extension absente (getMaxAnisotropy = 0) : 1, pas 0');
  assert.equal(M.anisotropieCible(null, ordi), 16, 'sans renderer : le plafond (three bornera au televersement)');
  assert.equal(M.anisotropieCible({ capabilities: { getMaxAnisotropy: () => { throw new Error('perdu'); } } }, ordi), 16);
});

test('importer le module : toute texture NEUVE (image, toile de Paint Mesh, FBX...) part au plafond d anisotropie', () => {
  assert.equal(THREE.Texture.DEFAULT_ANISOTROPY, PLAFOND, 'DEFAULT_ANISOTROPY apres import (avant : ' + DEFAUT_AVANT + ')');
  assert.equal(new THREE.Texture().anisotropy, PLAFOND);
  assert.equal(new THREE.CanvasTexture({ width: 8, height: 8 }).anisotropy, PLAFOND, 'CanvasTexture (toiles de Paint Mesh)');
  assert.equal(new THREE.DataTexture(new Uint8Array(16), 2, 2).anisotropy, PLAFOND, 'DataTexture : three ignore l anisotropie quand magFilter est Nearest');
});

test('GLTFLoader.parse REEL : chaque carte PBR est reglee avant son premier televersement (anisotropie, filtre, mipmaps)', async () => {
  assert.equal(GLTFLoader.prototype.parse.__filtrageTextures, true, 'parse enveloppe');
  assert.notEqual(GLTFLoader.prototype.parse, PARSE_ORIGINE);
  const c = cartesDe(await chargerGlb());
  for (const cle of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) {
    assert.equal(c[cle].anisotropy, PLAFOND, cle + ' : anisotropie');
    assert.equal(c[cle].minFilter, THREE.LinearMipmapLinearFilter, cle + ' : filtre de reduction (sinon three n applique pas l anisotropie)');
    assert.equal(c[cle].generateMipmaps, true, cle + ' : mipmaps');
    assert.equal(c[cle].version, 1, cle + ' : AUCUN televersement de plus n est demande (version inchangee)');
  }
  assert.equal(c.roughnessMap, c.metalnessMap, 'carte metal / rugosite = un seul objet, regle une fois');
  // espace colorimetrique : inchange (couleur en sRGB, donnees lineaires)
  assert.equal(c.map.colorSpace, THREE.SRGBColorSpace);
  assert.equal(c.normalMap.colorSpace, THREE.NoColorSpace);
  assert.equal(c.roughnessMap.colorSpace, THREE.NoColorSpace);
});

test('une carte a echantillonneur NEAREST (pixel-art voulu par l auteur) est laissee telle quelle', async () => {
  const c = cartesDe(await chargerGlb());
  assert.equal(c.emissiveMap.magFilter, THREE.NearestFilter);
  assert.equal(c.emissiveMap.minFilter, THREE.NearestFilter);
  assert.equal(c.emissiveMap.generateMipmaps, false);
  assert.equal(c.emissiveMap.version, 1);
});

test('sans l enveloppe de parse, le defaut SEUL laisse la carte de normales et la carte metal / rugosite sans effet (raison d etre de l enveloppe)', async () => {
  class ChargeurSansEnveloppe extends GLTFLoader { parse(...a) { return PARSE_ORIGINE.apply(this, a); } }   // le parse d origine de three, sans l enveloppe
  const c = cartesDe(await chargerGlb(ChargeurSansEnveloppe));
  assert.equal(c.map.anisotropy, PLAFOND, 'le defaut atteint bien les textures neuves');
  assert.notEqual(c.normalMap.minFilter, THREE.LinearMipmapLinearFilter, 'echantillonneur 9985 : filtre inchange sans l enveloppe');
  assert.equal(c.roughnessMap.generateMipmaps, false, 'echantillonneur 9729 : pas de mipmaps sans l enveloppe');
});

test('parseAsync et load() passent par parse : meme resultat', async () => {
  const a = cartesDe(await new GLTFLoader().parseAsync(glbMinimal(), ''));
  assert.equal(a.normalMap.minFilter, THREE.LinearMipmapLinearFilter, 'parseAsync');
  // load() lit le corps de la reponse par un flux et annonce la progression avec ProgressEvent (global des navigateurs, absent de Node)
  const fetchAvant = globalThis.fetch;
  const progressAvant = Object.getOwnPropertyDescriptor(globalThis, 'ProgressEvent');
  globalThis.fetch = async () => new Response(glbMinimal(), { status: 200 });
  globalThis.ProgressEvent = class ProgressEvent extends Event { constructor(type, init = {}) { super(type); Object.assign(this, init); } };
  try {
    const l = await new Promise((ok, ko) => new GLTFLoader().load('https://exemple.test/modele.glb', ok, undefined, ko));
    const c = cartesDe(l);
    assert.equal(c.normalMap.minFilter, THREE.LinearMipmapLinearFilter, 'load');
    assert.equal(c.map.anisotropy, PLAFOND);
  } finally {
    globalThis.fetch = fetchAvant;
    if (progressAvant) Object.defineProperty(globalThis, 'ProgressEvent', progressAvant); else delete globalThis.ProgressEvent;
  }
});

test('l erreur du chargeur et le rappel de l appelant sont transmis intacts (onLoad recoit le meme gltf, onError une vraie erreur)', async () => {
  const gltf = await chargerGlb();
  assert.ok(gltf.scene && gltf.scenes.length === 1 && gltf.parser, 'resultat standard du chargeur');
  await assert.rejects(new Promise((ok, ko) => new GLTFLoader().parse(new ArrayBuffer(16), '', ok, ko)), 'un fichier invalide echoue toujours');
});

test('modeles charges plusieurs fois (variante de texture, re-texture, version legere) : chacun est regle, les textures deja vues ne sont pas retouchees', async () => {
  const un = await chargerGlb();
  const deux = await chargerGlb();
  assert.notEqual(cartesDe(un).map, cartesDe(deux).map, 'deux chargements = deux jeux de textures');
  for (const g of [un, deux]) {
    const c = cartesDe(g);
    assert.equal(c.map.anisotropy, PLAFOND);
    assert.equal(c.normalMap.minFilter, THREE.LinearMipmapLinearFilter);
  }
  const rejeu = M.preparerTexturesModele(un.scene, rendu(16));
  assert.deepEqual(rejeu, { textures: 0, anisotropie: 0, mipmaps: 0, ignorees: 0, retelechargees: 0 }, 'deja traitees : rien a refaire');
});

test('sans fuite : le module ne retient aucune texture (WeakSet) - une texture traitee puis abandonnee est ramassee', async () => {
  v8.setFlagsFromString('--expose-gc');
  const gc = vm.runInNewContext('gc');
  const refs = [];
  (function fabriquer() {
    for (let i = 0; i < 20; i++) {
      const t = texture({ anisotropy: 1 });
      refs.push(new WeakRef(t));
      M.preparerTexturesModele(scene(new THREE.MeshStandardMaterial({ map: t })), null);
    }
  })();
  for (let i = 0; i < 5; i++) { await new Promise((r) => setTimeout(r, 5)); gc(); }
  assert.equal(refs.filter((r) => r.deref() !== undefined).length, 0, 'textures encore en memoire apres ramassage');
});

// ===================================================================================================================
test('preparerTexturesModele : TOUTES les cartes de TOUS les materiaux (tableau de materiaux, SkinnedMesh, cartes Physical)', () => {
  const noms = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'bumpMap', 'displacementMap', 'alphaMap', 'lightMap',
    'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap', 'sheenColorMap', 'sheenRoughnessMap', 'transmissionMap', 'thicknessMap', 'specularIntensityMap', 'specularColorMap', 'iridescenceMap'];
  const m1 = new THREE.MeshStandardMaterial();
  const m2 = new THREE.MeshPhysicalMaterial();
  const toutes = [];
  for (const n of noms) { const t = texture({ anisotropy: 1 }); toutes.push(t); (n in m1 ? m1 : m2)[n] = t; }
  const racine = new THREE.Group();
  racine.add(new THREE.Mesh(new THREE.BufferGeometry(), [m1, m2]));
  const peau = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ map: texture({ anisotropy: 1 }) }));
  racine.add(peau);
  const bilan = M.preparerTexturesModele(racine, rendu(16));
  for (const t of toutes) assert.equal(t.anisotropy, PLAFOND);
  assert.equal(peau.material.map.anisotropy, PLAFOND, 'SkinnedMesh (rigs)');
  assert.equal(bilan.textures, noms.length + 1);
  assert.equal(bilan.anisotropie, noms.length + 1);
});

test('preparerTexturesModele : meme texture sur plusieurs cartes ou plusieurs materiaux = comptee et reglee une fois', () => {
  const t = texture({ anisotropy: 1 });
  const bilan = M.preparerTexturesModele(scene(new THREE.MeshStandardMaterial({ roughnessMap: t, metalnessMap: t }), new THREE.MeshStandardMaterial({ map: t })), rendu(16));
  assert.equal(bilan.textures, 1);
  assert.equal(t.anisotropy, PLAFOND);
});

test('preparerTexturesModele : borne par la capacite de la carte, jamais abaissee, jamais sous 1', () => {
  const faible = texture({ anisotropy: 1 });
  M.preparerTexturesModele(scene(new THREE.MeshBasicMaterial({ map: faible })), rendu(4));
  assert.equal(faible.anisotropy, 4, 'carte a 4x : 4');
  const dejaHaut = texture({ anisotropy: 16 });
  M.preparerTexturesModele(scene(new THREE.MeshBasicMaterial({ map: dejaHaut })), rendu(8));
  assert.equal(dejaHaut.anisotropy, 16, 'une valeur plus haute posee par ailleurs n est jamais abaissee');
  const sansExtension = texture({ anisotropy: 1 });
  M.preparerTexturesModele(scene(new THREE.MeshBasicMaterial({ map: sansExtension })), rendu(0));
  assert.equal(sansExtension.anisotropy, 1, 'sans extension : inchangee');
});

test('preparerTexturesModele : cartes a NE PAS toucher (Nearest, rampe de toon, environnement, cubes, profondeur, flottantes, cibles de rendu)', () => {
  const pixelArt = texture({ anisotropy: 1, magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter, generateMipmaps: false });
  const rampe = texture({ anisotropy: 1, magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter, generateMipmaps: false });
  const env = texture({ anisotropy: 1, minFilter: THREE.LinearFilter, generateMipmaps: false });
  const cube = new THREE.CubeTexture(); cube.anisotropy = 1;
  const profondeur = new THREE.DepthTexture(4, 4); profondeur.anisotropy = 1;
  const flottante = new THREE.DataTexture(new Float32Array(16), 2, 2, THREE.RedFormat, THREE.FloatType); flottante.anisotropy = 1; flottante.minFilter = THREE.LinearFilter; flottante.magFilter = THREE.LinearFilter;
  const cible = new THREE.WebGLRenderTarget(4, 4).texture; cible.anisotropy = 1;
  const racine = scene(new THREE.MeshStandardMaterial({ map: pixelArt, envMap: env }), new THREE.MeshToonMaterial({ gradientMap: rampe }),
    new THREE.MeshBasicMaterial({ map: cube }), new THREE.MeshBasicMaterial({ map: profondeur }), new THREE.MeshBasicMaterial({ map: flottante }), new THREE.MeshBasicMaterial({ map: cible }));
  const bilan = M.preparerTexturesModele(racine, rendu(16));
  assert.equal(pixelArt.minFilter, THREE.NearestFilter);
  assert.equal(pixelArt.generateMipmaps, false);
  assert.equal(pixelArt.anisotropy, 1, 'magFilter Nearest : ignoree par three, donc laissee');
  assert.equal(rampe.minFilter, THREE.NearestFilter, 'gradientMap doit rester Nearest');
  assert.equal(rampe.anisotropy, 1);
  assert.equal(env.minFilter, THREE.LinearFilter, 'envMap : pas de mipmaps imposees');
  assert.equal(env.anisotropy, 1);
  for (const [nom, t] of [['cube', cube], ['profondeur', profondeur], ['flottante', flottante], ['cible de rendu', cible]]) assert.equal(t.anisotropy, 1, nom);
  assert.equal(bilan.anisotropie, 0);
  assert.ok(bilan.ignorees >= 5);
});

test('mipmaps : un filtre sans mipmaps est corrige, une texture incomplete (filtre a mipmaps sans mipmaps) l est aussi, un tres gros atlas n en recoit pas', () => {
  const lineaire = texture({ anisotropy: 1, minFilter: THREE.LinearFilter, generateMipmaps: false });
  const incomplete = texture({ anisotropy: 1, minFilter: THREE.LinearMipmapLinearFilter, generateMipmaps: false });   // rendrait NOIR dans three
  const proche = texture({ anisotropy: 1, minFilter: THREE.LinearMipmapNearestFilter, generateMipmaps: true });
  const enorme = texture({ anisotropy: 1, minFilter: THREE.LinearFilter, generateMipmaps: false });
  enorme.image = { width: 16384, height: 16384 };
  const bilan = M.preparerTexturesModele(scene(new THREE.MeshStandardMaterial({ map: lineaire, normalMap: incomplete, roughnessMap: proche, aoMap: enorme })), rendu(16));
  assert.equal(lineaire.minFilter, THREE.LinearMipmapLinearFilter); assert.equal(lineaire.generateMipmaps, true);
  assert.equal(incomplete.generateMipmaps, true);
  assert.equal(proche.minFilter, THREE.LinearMipmapLinearFilter);
  assert.equal(enorme.minFilter, THREE.LinearFilter, '16384 x 16384 : +33 % de memoire de carte, on n y touche pas');
  assert.equal(enorme.generateMipmaps, false);
  assert.equal(bilan.mipmaps, 3);
});

test('textures compressees ou a mipmaps fournies : seule l anisotropie est posee (three ne sait pas en generer)', () => {
  const comprimee = new THREE.CompressedTexture([{ width: 4, height: 4, data: new Uint8Array(8) }, { width: 2, height: 2, data: new Uint8Array(8) }], 4, 4, THREE.RGBAFormat);
  comprimee.anisotropy = 1; comprimee.minFilter = THREE.LinearFilter;
  M.preparerTexturesModele(scene(new THREE.MeshBasicMaterial({ map: comprimee })), rendu(16));
  assert.equal(comprimee.anisotropy, PLAFOND);
  assert.equal(comprimee.generateMipmaps, false, 'jamais de generation sur une texture compressee');
});

test('televersement : needsUpdate SEULEMENT pour une texture deja sur la carte dont un reglage change ; un modele frais n est jamais televerse deux fois', () => {
  const surCarte = texture({ anisotropy: 1 }); surCarte.needsUpdate = true;        // version 1
  const dejaBonne = texture({ anisotropy: PLAFOND, minFilter: THREE.LinearMipmapLinearFilter }); dejaBonne.needsUpdate = true;
  const fraiche = texture({ anisotropy: 1 }); fraiche.needsUpdate = true;
  const sur = new Set([surCarte, dejaBonne]);
  const bilan = M.preparerTexturesModele(scene(new THREE.MeshBasicMaterial({ map: surCarte, aoMap: dejaBonne, alphaMap: fraiche })), rendu(16, (t) => sur.has(t)));
  assert.equal(surCarte.version, 2, 'deja sur la carte, reglage change : un televersement de plus (sinon l anisotropie ne part jamais au pilote)');
  assert.equal(dejaBonne.version, 1, 'rien a changer : aucun televersement');
  assert.equal(fraiche.version, 1, 'pas encore televersee : le premier televersement portera deja le bon reglage');
  assert.equal(bilan.retelechargees, 1);
});

test('entrees degenerees : racine absente, sans traverse, materiau nul, mesh sans materiau, Sprite / lignes ignores', () => {
  assert.deepEqual(M.preparerTexturesModele(null), { textures: 0, anisotropie: 0, mipmaps: 0, ignorees: 0, retelechargees: 0 });
  assert.deepEqual(M.preparerTexturesModele({}), { textures: 0, anisotropie: 0, mipmaps: 0, ignorees: 0, retelechargees: 0 });
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.BufferGeometry(), [null, undefined]));
  const nu = new THREE.Mesh(new THREE.BufferGeometry()); nu.material = null; g.add(nu);
  const t = texture({ anisotropy: 1 });
  g.add(new THREE.Sprite(new THREE.SpriteMaterial({ map: t })));
  assert.equal(M.preparerTexturesModele(g, null).textures, 0);
  assert.equal(t.anisotropy, 1, 'etiquettes (Sprite) : hors du perimetre, la valeur par defaut seule s applique a la creation');
});

test('brancherSurChargeurGLTF : idempotent, et une erreur du filtrage n empeche jamais le chargement', async () => {
  assert.equal(M.brancherSurChargeurGLTF(GLTFLoader), false, 'deja branche : rend false, ne s empile pas');
  const depart = GLTFLoader.prototype.parse;
  M.brancherSurChargeurGLTF(GLTFLoader);
  assert.equal(GLTFLoader.prototype.parse, depart);
  class Faux { parse(data, path, onLoad) { onLoad({ scenes: [{ traverse() { throw new Error('boum'); } }] }); } }
  assert.equal(M.brancherSurChargeurGLTF(Faux), true);
  const avertis = []; const w = console.warn; console.warn = (...a) => avertis.push(a.join(' '));
  try {
    const recu = await new Promise((ok) => new Faux().parse('', '', ok));
    assert.ok(recu && recu.scenes, 'le rappel de l appelant part malgre l erreur');
    assert.match(avertis.join('|'), /filtrage non applique/);
  } finally { console.warn = w; }
});

// ===================================================================================================================
test('Viewer3D.js (bureau) importe le module de filtrage et expose preparerTextures, qui regle les textures avec LE renderer du viewer', async () => {
  const src = lire(FICHIER_VIEWER3D);
  assert.match(src, /import \{ preparerTexturesModele \} from '\.\/filtrage-textures\.js';/, 'import du module : c est lui qui active le reglage pour toute la page');
  const { Viewer3D } = await import(pathToFileURL(FICHIER_VIEWER3D).href);
  assert.equal(typeof Viewer3D.prototype.preparerTextures, 'function');
  const t = texture({ anisotropy: 1 });
  const hote = { scene: scene(new THREE.MeshBasicMaterial({ map: t })), renderer: rendu(4) };
  const bilan = Viewer3D.prototype.preparerTextures.call(hote);
  assert.equal(t.anisotropy, 4, 'borne par la carte du viewer');
  assert.equal(bilan.textures, 1);
});

test('gardes de la construction : le module figure dans la liste des fichiers livres (syntaxe) et dans celle des fichiers partages bureau / web', () => {
  assert.match(lire(join(RACINE, 'build/check-js-syntax.mjs')), /'src\/renderer\/lib\/filtrage-textures\.js'/);
  assert.match(lire(join(RACINE, 'build/check-js-syntax.mjs')), /'cloud\/public\/app\/lib\/filtrage-textures\.js'/);
  assert.match(lire(join(RACINE, 'build/check-noyaux-partages.mjs')), /source: 'src\/renderer\/lib\/filtrage-textures\.js', copie: 'cloud\/public\/app\/lib\/filtrage-textures\.js'/);
});

test('les deux copies du module (bureau / web) sont identiques', () => {
  assert.equal(lire(join(RACINE, 'src/renderer/lib/filtrage-textures.js')), lire(join(RACINE, 'cloud/public/app/lib/filtrage-textures.js')));
});

// ===================================================================================================================
// Les DEUX cibles, lues telles que livrees (bureau : src/renderer ; site : cloud/public/app).
const BASE_PAGE = 'http://page.test/';
const CIBLES = [
  { nom: 'bureau', page: 'src/renderer/index2.js', html: 'src/renderer/index2.html', lib: 'src/renderer/lib', viewer3d: FICHIER_VIEWER3D },
  { nom: 'site', page: 'cloud/public/app/index2.js', html: 'cloud/public/app/index.html', lib: 'cloud/public/app/lib', viewer3d: FICHIER_VIEWER3D_SITE },
];
const importmapDe = (html) => JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(html)[1]).imports;
/** Resolution d'un specificateur comme le navigateur : URL relative a son fichier, ou nom nu par l'importmap (plus long prefixe « .../ »). */
function resoudre(specifier, carte, urlDuFichier) {
  if (/^\.{1,2}\//.test(specifier)) return new URL(specifier, urlDuFichier).href;
  if (carte[specifier]) return new URL(carte[specifier], BASE_PAGE).href;
  const prefixe = Object.keys(carte).filter((k) => k.endsWith('/') && specifier.startsWith(k)).sort((a, b) => b.length - a.length)[0];
  assert.ok(prefixe, 'specificateur absent de l importmap : ' + specifier);
  return new URL(carte[prefixe] + specifier.slice(prefixe.length), BASE_PAGE).href;
}

test('Viewer3D.js des DEUX cibles : importe le module depuis son propre dossier lib, expose preparerTextures, et tous ses imports relatifs existent', () => {
  for (const c of CIBLES) {
    const src = lire(c.viewer3d);
    assert.match(src, /^import \{ preparerTexturesModele \} from '\.\/filtrage-textures\.js';$/m, c.nom + ' : import du module (c est lui qui active le reglage pour toute la page)');
    assert.match(src, /^  preparerTextures\(racine\) \{\n    return preparerTexturesModele\(racine \|\| this\.scene, this\.renderer\);\n  \}$/m, c.nom + ' : methode preparerTextures');
    const relatifs = [...src.matchAll(/^import .* from '(\.\/[^']+)';$/gm)].map((m) => m[1]);
    assert.ok(relatifs.includes('./filtrage-textures.js') && relatifs.includes('./lod-maillage.js'), c.nom + ' : imports relatifs lus');
    for (const rel of relatifs) assert.ok(existsSync(join(RACINE, c.lib, rel)), c.nom + ' : ' + rel + ' absent du dossier ' + c.lib + ' (404 au chargement = plus aucun visualiseur 3D)');
  }
});

test('chaine d activation : la page importe Viewer3D.js en tete, l importmap definit three et three/addons/, et AUCUN import de GLTFLoader n y echappe (une copie non enveloppee serait utilisee)', () => {
  for (const c of CIBLES) {
    const html = lire(join(RACINE, c.html));
    const carte = importmapDe(html);
    assert.ok(carte.three && carte['three/addons/'], c.nom + ' : importmap sans three / three/addons/');
    assert.match(html, /<script type="module" src="index2\.js"><\/script>/, c.nom + ' : la page charge index2.js comme module');
    assert.match(lire(join(RACINE, c.page)), /^import \{ Viewer3D \} from '\.\/lib\/Viewer3D\.js';$/m, c.nom + ' : import STATIQUE de Viewer3D.js (le module de filtrage est evalue avant tout chargement de modele)');
    const canon = resoudre('three/addons/loaders/GLTFLoader.js', carte, BASE_PAGE + 'index2.js');
    const fichiers = [{ rel: c.page, url: BASE_PAGE + 'index2.js' }].concat(readdirSync(join(RACINE, c.lib))
      .filter((f) => f.endsWith('.js') && f !== 'three.module.js' && f !== 'three-mesh-bvh.module.js')
      .map((f) => ({ rel: c.lib + '/' + f, url: BASE_PAGE + 'lib/' + f })));
    let vus = 0;
    for (const f of fichiers) {
      for (const m of lire(join(RACINE, f.rel)).matchAll(/(?:from\s*|import\s*\(\s*)'([^']*GLTFLoader[^']*)'/g)) {
        vus++;
        assert.equal(resoudre(m[1], carte, f.url), canon, c.nom + ' : ' + f.rel + ' importe un autre GLTFLoader que celui de l importmap (' + m[1] + ')');
      }
    }
    assert.ok(vus >= 4, c.nom + ' : imports de GLTFLoader trouves : ' + vus);
  }
});

test('garde-fou three r170 : l anisotropie n est appliquee que pour magFilter != Nearest ET minFilter = (Nearest|Linear)MipmapLinear, et seulement au televersement — le module en depend', () => {
  const src = lire(join(LIB, 'three.module.js'));
  assert.match(src, /^const REVISION = '170';$/m, 'revision de three des pages : si elle change, reverifier ce qui suit');
  const i = src.indexOf("if ( extensions.has( 'EXT_texture_filter_anisotropic' ) === true ) {\n\n\t\t\tif ( texture.magFilter === NearestFilter ) return;");
  assert.ok(i > 0, 'bloc d anisotropie de setTextureParameters introuvable : three a change, revoir lib/filtrage-textures.js');
  const bloc = src.slice(i, i + 900);
  assert.match(bloc, /if \( texture\.minFilter !== NearestMipmapLinearFilter && texture\.minFilter !== LinearMipmapLinearFilter \) return;/);
  assert.match(bloc, /Math\.min\( texture\.anisotropy, capabilities\.getMaxAnisotropy\(\) \)/, 'three borne lui-meme la valeur a ce que la carte supporte');
  // le reglage n'atteint le pilote qu'au televersement : changer l'anisotropie d'une texture deja envoyee exige needsUpdate
  assert.match(src, /function uploadTexture\( textureProperties, texture, slot \) \{[\s\S]{0,2500}setTextureParameters\( textureType, texture \);/);
  assert.match(src, /Texture\.DEFAULT_ANISOTROPY = 1;/, 'valeur par defaut de three : 1');
  assert.match(src, /anisotropy = Texture\.DEFAULT_ANISOTROPY, colorSpace = NoColorSpace/, 'le constructeur lit DEFAULT_ANISOTROPY');
});

test('GLB de test (_glb-minimal) : entete GLB 2.0 valide, image PNG REELLE quand on la donne, carre a UV repetees, triangle sans options', () => {
  const lireGlb = (tampon) => {
    const b = Buffer.from(tampon);
    assert.equal(b.toString('ascii', 0, 4), 'glTF');
    assert.equal(b.readUInt32LE(4), 2);
    assert.equal(b.readUInt32LE(8), b.length, 'longueur declaree = longueur reelle');
    const longJson = b.readUInt32LE(12);
    assert.equal(b.readUInt32LE(16), 0x4e4f534a);
    const debutBin = 20 + longJson;
    assert.equal(b.readUInt32LE(debutBin + 4), 0x004e4942);
    return { json: JSON.parse(b.toString('utf8', 20, debutBin)), bin: b.subarray(debutBin + 8, debutBin + 8 + b.readUInt32LE(debutBin)) };
  };
  const png = pngDamier(32, 4);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.readUInt32BE(16), 32, 'IHDR : largeur');
  assert.equal(png.readUInt32BE(20), 32, 'IHDR : hauteur');
  const { json, bin } = lireGlb(glbMinimal({ png, plan: { cote: 10, repetitions: 6 } }));
  const vueImage = json.bufferViews[json.images[0].bufferView];
  assert.equal(vueImage.byteLength, png.length);
  assert.ok(bin.subarray(vueImage.byteOffset, vueImage.byteOffset + vueImage.byteLength).equals(png), 'l image du GLB est exactement le PNG donne');
  assert.equal(json.accessors[0].count, 4);
  assert.equal(json.accessors[3].count, 6);
  const vueUv = json.bufferViews[2];
  const uv = new Float32Array(bin.buffer.slice(bin.byteOffset + vueUv.byteOffset, bin.byteOffset + vueUv.byteOffset + vueUv.byteLength));
  assert.equal(Math.max(...uv), 6, 'UV de 0 a `repetitions`');
  assert.equal(json.samplers.length, 5);
  const defaut = lireGlb(glbMinimal());
  assert.equal(defaut.json.accessors[0].count, 3, 'sans options : le triangle d origine');
  const vueFausse = defaut.json.bufferViews[defaut.json.images[0].bufferView];
  assert.equal(vueFausse.byteLength, 8, 'sans options : l en-tete PNG factice d origine');
});
