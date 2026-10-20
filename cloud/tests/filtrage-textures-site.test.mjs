// Filtrage anisotrope + mipmaps des textures, COPIE DU SITE (2026-10-18, chantier « Filtrage anisotrope du visualiseur »).
// La suite complete du module est dans tests/bureau-interface/filtrage-textures.test.mjs (bureau) ; elle n'est pas lancee par
// la construction du site (`cd cloud && npm test` seulement). Ce fichier protege donc la COPIE DU SITE, telle que livree :
//  1. cloud/public/app/lib/filtrage-textures.js, execute contre le VRAI three r170 et le VRAI GLTFLoader (l'importmap de la page
//     est rejouee sous Node), sur un VRAI GLB a cinq cartes aux echantillonneurs differents : anisotropie, filtre de reduction et
//     mipmaps reglees AVANT le premier televersement, cartes Nearest voulues laissees telles quelles, aucun televersement de plus ;
//  2. Viewer3D.js du site : importe le module depuis cloud/public/app/lib (un import absent = 404 = plus aucun visualiseur 3D),
//     expose preparerTextures ;
//  3. la chaine d'activation de la page : importmap three 0.170.0 (unpkg) = revision du fichier de test, index2.js importe
//     Viewer3D.js en tete, aucun import de GLTFLoader n'echappe a l'importmap (une copie NON enveloppee serait utilisee) ;
//  4. le garde-fou « three » : l'anisotropie n'est appliquee par three que pour certains filtres ; si une mise a jour de three
//     change ces conditions, ce test echoue et le module doit etre revu (voir l'en-tete de lib/filtrage-textures.js).
// Aucun navigateur, aucun reseau, aucun GPU. Lancer : cd cloud && node --test tests/filtrage-textures-site.test.mjs
// Preuve sans le correctif : RACINE_DEPOT=<copie de l'ancienne base> (ou FICHIER_FILTRAGE_SITE=<module sans effet>) ; voir
//   build/bancs/viewer/prouver_tests_filtrage.mjs pour la preuve sur le bureau, meme logique.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { brancherImportmap } from '../../tests/bureau-interface/_importmap-lib.mjs';
import { glbMinimal, installerDecodeurFactice } from '../../tests/bureau-interface/_glb-minimal.mjs';

const RACINE = process.env.RACINE_DEPOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LIB_SITE = path.join(RACINE, 'cloud/public/app/lib');
const LIB_BUREAU = path.join(RACINE, 'src/renderer/lib');
const lire = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const FICHIER_FILTRAGE = process.env.FICHIER_FILTRAGE_SITE || path.join(LIB_SITE, 'filtrage-textures.js');
// three : la copie du site si elle existe (meme revision que la page), sinon celle du bureau ; les addons (GLTFLoader) :
// le site les prend sur unpkg (examples/jsm de la meme revision), le depot n'en garde que la copie du bureau
const THREE_FICHIER = [path.join(LIB_SITE, 'three.module.js'), path.join(LIB_BUREAU, 'three.module.js')].find((f) => fs.existsSync(f));

brancherImportmap({ three: THREE_FICHIER, addons: LIB_BUREAU });
const THREE = await import('three');
const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
const retirerDecodeur = installerDecodeurFactice(1024, 1024);
after(() => retirerDecodeur());

const DEFAUT_AVANT = THREE.Texture.DEFAULT_ANISOTROPY;
const M = await import(pathToFileURL(FICHIER_FILTRAGE).href);
const chargerGlb = () => new Promise((ok, ko) => new GLTFLoader().parse(glbMinimal(), '', ok, ko));
const cartesDe = (gltf) => {
  const sortie = {};
  gltf.scene.traverse((o) => { if (o.isMesh) for (const [cle, t] of Object.entries(o.material)) if (t && t.isTexture) sortie[cle] = t; });
  return sortie;
};

test('site : importer le module regle toute texture neuve au plafond (16 sur ordinateur) et enveloppe GLTFLoader.parse', () => {
  assert.equal(DEFAUT_AVANT, 1, 'three r170 laisse DEFAULT_ANISOTROPY a 1');
  assert.equal(THREE.Texture.DEFAULT_ANISOTROPY, 16);
  assert.equal(new THREE.CanvasTexture({ width: 8, height: 8 }).anisotropy, 16, 'CanvasTexture (toiles de Paint Mesh)');
  assert.equal(GLTFLoader.prototype.parse.__filtrageTextures, true);
});

test('site : un GLB a cinq echantillonneurs (aucun, 9729, 9985, 9987, 9728) — chaque carte est reglee avant son premier televersement', async () => {
  const c = cartesDe(await chargerGlb());
  for (const cle of ['map', 'roughnessMap', 'metalnessMap', 'normalMap', 'aoMap']) {
    assert.equal(c[cle].anisotropy, 16, cle + ' : anisotropie');
    assert.equal(c[cle].minFilter, THREE.LinearMipmapLinearFilter, cle + ' : filtre de reduction (sinon three n applique pas l anisotropie)');
    assert.equal(c[cle].generateMipmaps, true, cle + ' : mipmaps');
    assert.equal(c[cle].version, 1, cle + ' : aucun televersement de plus');
  }
  assert.equal(c.roughnessMap, c.metalnessMap, 'carte metal / rugosite = un seul objet, regle une fois');
  assert.equal(c.map.colorSpace, THREE.SRGBColorSpace, 'espace colorimetrique inchange : couleur en sRGB');
  assert.equal(c.normalMap.colorSpace, THREE.NoColorSpace, 'espace colorimetrique inchange : donnees lineaires');
  assert.equal(c.emissiveMap.magFilter, THREE.NearestFilter, 'pixel-art voulu : laisse tel quel');
  assert.equal(c.emissiveMap.minFilter, THREE.NearestFilter);
  assert.equal(c.emissiveMap.generateMipmaps, false, 'pas de mipmaps imposees a une carte Nearest');
  assert.equal(c.emissiveMap.version, 1);
  // (son champ `anisotropy` porte la valeur par defaut 16 comme toute texture neuve, sans effet : three ignore l anisotropie
  //  quand magFilter est Nearest ; le banc navigateur lit GL aniso = 1 pour cette carte)
});

test('site : deux chargements (variante de texture, re-texture) = deux jeux de textures reglees, et rien a refaire sur le premier', async () => {
  const un = await chargerGlb();
  const deux = await chargerGlb();
  assert.notEqual(cartesDe(un).map, cartesDe(deux).map);
  for (const g of [un, deux]) assert.equal(cartesDe(g).normalMap.minFilter, THREE.LinearMipmapLinearFilter);
  assert.deepEqual(M.preparerTexturesModele(un.scene, null), { textures: 0, anisotropie: 0, mipmaps: 0, ignorees: 0, retelechargees: 0 });
});

test('site : Viewer3D.js importe le module depuis cloud/public/app/lib, expose preparerTextures, et tous ses imports relatifs existent', () => {
  const src = lire(process.env.FICHIER_VIEWER3D_SITE || path.join(LIB_SITE, 'Viewer3D.js'));
  assert.match(src, /^import \{ preparerTexturesModele \} from '\.\/filtrage-textures\.js';$/m);
  assert.match(src, /^  preparerTextures\(racine\) \{\n    return preparerTexturesModele\(racine \|\| this\.scene, this\.renderer\);\n  \}$/m);
  const relatifs = [...src.matchAll(/^import .* from '(\.\/[^']+)';$/gm)].map((m) => m[1]);
  assert.ok(relatifs.includes('./filtrage-textures.js'));
  for (const rel of relatifs) assert.ok(fs.existsSync(path.join(LIB_SITE, rel)), rel + ' absent de cloud/public/app/lib (404 au chargement du site)');
});

test('site : chaine d activation — importmap three 0.170.0, index2.js importe Viewer3D.js en tete, aucun GLTFLoader hors importmap', () => {
  const html = lire(path.join(RACINE, 'cloud/public/app/index.html'));
  const carte = JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(html)[1]).imports;
  assert.equal(carte.three, 'https://unpkg.com/three@0.170.0/build/three.module.js');
  assert.equal(carte['three/addons/'], 'https://unpkg.com/three@0.170.0/examples/jsm/');
  assert.match(lire(THREE_FICHIER), /^const REVISION = '170';$/m, 'le fichier three des tests est la revision 170 de la page');
  const page = lire(path.join(RACINE, 'cloud/public/app/index2.js'));
  assert.match(page, /^import \{ Viewer3D \} from '\.\/lib\/Viewer3D\.js';$/m, 'import statique : le module de filtrage est evalue avant tout chargement de modele');
  const fichiers = ['cloud/public/app/index2.js'].concat(fs.readdirSync(LIB_SITE).filter((f) => f.endsWith('.js') && !/^three/.test(f)).map((f) => 'cloud/public/app/lib/' + f));
  let vus = 0;
  for (const rel of fichiers) {
    for (const m of lire(path.join(RACINE, rel)).matchAll(/(?:from\s*|import\s*\(\s*)'([^']*GLTFLoader[^']*)'/g)) {
      vus++;
      assert.equal(m[1], 'three/addons/loaders/GLTFLoader.js', rel + ' importe GLTFLoader autrement que par l importmap : ' + m[1]);
    }
  }
  assert.ok(vus >= 4, 'imports de GLTFLoader trouves : ' + vus);
});

test('garde-fou three r170 : l anisotropie n est appliquee que pour magFilter != Nearest ET minFilter = (Nearest|Linear)MipmapLinear — le module en depend', () => {
  const src = lire(THREE_FICHIER);
  const i = src.indexOf("if ( extensions.has( 'EXT_texture_filter_anisotropic' ) === true ) {\n\n\t\t\tif ( texture.magFilter === NearestFilter ) return;");
  assert.ok(i > 0, 'bloc d anisotropie de setTextureParameters introuvable : three a change, revoir lib/filtrage-textures.js');
  const bloc = src.slice(i, i + 900);
  assert.match(bloc, /if \( texture\.magFilter === NearestFilter \) return;/);
  assert.match(bloc, /if \( texture\.minFilter !== NearestMipmapLinearFilter && texture\.minFilter !== LinearMipmapLinearFilter \) return;/);
  assert.match(bloc, /Math\.min\( texture\.anisotropy, capabilities\.getMaxAnisotropy\(\) \)/, 'three borne lui-meme la valeur a ce que la carte supporte');
  // le reglage n'atteint le pilote qu'au televersement : changer l'anisotropie d'une texture deja envoyee exige needsUpdate
  assert.match(src, /function uploadTexture\( textureProperties, texture, slot \) \{[\s\S]{0,2500}setTextureParameters\( textureType, texture \);/);
});

test('les deux copies du module (site / bureau) sont identiques, et le module livre au site figure dans la liste des fichiers verifies', () => {
  assert.equal(lire(path.join(LIB_SITE, 'filtrage-textures.js')), lire(path.join(LIB_BUREAU, 'filtrage-textures.js')));
  assert.match(lire(path.join(RACINE, 'build/check-js-syntax.mjs')), /'cloud\/public\/app\/lib\/filtrage-textures\.js'/);
  assert.match(lire(path.join(RACINE, 'build/check-noyaux-partages.mjs')), /copie: 'cloud\/public\/app\/lib\/filtrage-textures\.js'/);
});
