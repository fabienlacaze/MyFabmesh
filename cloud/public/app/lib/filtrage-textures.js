// FILTRAGE DES TEXTURES DES VISUALISEURS 3D : anisotropie + mipmaps (2026-10-15, demande du proprietaire :
// « Filtrage anisotrope du visualiseur »).
// FICHIER COMMUN bureau / web (src/renderer/lib = cloud/public/app/lib) : identite exigee par build/check-noyaux-partages.mjs.
//
// POURQUOI. Une texture vue sous un angle rasant (flanc d'un bras, dessus d'une epaule, sol) est etiree par la
// perspective : l'empreinte d'un pixel sur la texture est un RUBAN, pas un carre. Le filtrage trilineaire ordinaire
// moyenne un grand carre de texels et floute la texture dans le sens du ruban ; l'anisotropie prend plusieurs
// echantillons le long du ruban : meme texture, plus nette. Ce reglage ne change NI le fichier 3D NI l'image de la
// texture, seulement la facon dont la carte graphique la lit.
//
// ETAT AVANT CE FICHIER (constate le 2026-10-15) : seule _applyMeshTextureFilter (index2.js) reglait l'anisotropie,
// et seulement sur cinq chemins de chargement (maillage de l'etape Maillage, plein ecran, source du Rig, viewer du Rig,
// editeur de maillage). Les autres vues (Paint Mesh, materiaux, alignement de texture, apercus des outils...) lisaient
// leurs textures en anisotropie 1, et les toiles de Paint Mesh aussi.
//
// TROIS MECANISMES, du plus large au plus precis. Aucun ne touche index2.js :
//  1. Texture.DEFAULT_ANISOTROPY : toute texture creee ensuite (chargeur GLB, FBX, toile de Paint Mesh...) part avec
//     le plafond ci-dessous ; three le borne tout seul a ce que la carte supporte au televersement. (Une carte Nearest
//     voulue par l'auteur porte aussi cette valeur, SANS EFFET : three ignore l'anisotropie quand magFilter est Nearest.)
//  2. brancherSurChargeurGLTF(GLTFLoader) : a la fin de chaque parse() (donc aussi load() et parseAsync()), toutes les
//     textures de tous les materiaux du modele sont verifiees AVANT leur premier televersement : aucun televersement
//     en plus, quelle que soit la vue qui recevra le modele.
//  3. preparerTexturesModele(racine, renderer) : la meme verification, appelable a la main (Viewer3D.preparerTextures).
//
// REGLES DE LA VERIFICATION (une seule fois par texture, WeakSet : pas de fuite) :
//  - anisotropie = min(plafond, getMaxAnisotropy() du renderer) ; jamais abaissee si elle est deja plus haute ;
//  - PIEGE three r170 : setTextureParameters n'applique l'anisotropie que si minFilter vaut LinearMipmapLinear ou
//    NearestMipmapLinear (pas LinearMipmapNearest, pas Linear) ET si magFilter n'est pas Nearest. Un echantillonneur
//    glTF qui demande 9729 (LINEAR) ou 9985 (LINEAR_MIPMAP_NEAREST) rendait donc le reglage SANS EFFET, en silence :
//    la texture est ramenee a LinearMipmapLinear et ses mipmaps sont activees ;
//  - magFilter Nearest (pixel-art voulu par l'auteur), textures flottantes, cubes, videos, cibles de rendu,
//    gradientMap (rampe de toon : doit rester Nearest) et envMap : laisses tels quels ;
//  - textures compressees ou a mipmaps fournies : seule l'anisotropie est posee (three ne sait pas generer leurs mips) ;
//  - memoire : aucune mipmap n'est creee au-dela de 8192 x 8192 (+33 % de memoire de carte) ;
//  - needsUpdate (televersement complet) UNIQUEMENT si la texture est deja sur la carte du renderer fourni ET qu'un
//    reglage a change : un modele frais n'est jamais televerse deux fois.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** Plafond sur ordinateur : valeur deja en service dans la vue principale depuis le 2026-04-15 (16x). */
export const ANISOTROPIE_ORDINATEUR = 16;
/** Plafond sur ecran tactile (telephone, tablette) : le debit de texture et la batterie y sont comptes ;
 *  8x resout deja les surfaces jusqu'a ~83 degres de la normale, au-dela elles couvrent quelques pixels.
 *  Aucun effet sur la memoire de la carte, dans un cas comme dans l'autre. */
export const ANISOTROPIE_TACTILE = 8;
/** Au-dela de cette taille (pixels), on ne CREE pas de mipmaps (ils ajoutent un tiers de memoire). */
export const PIXELS_MAX_POUR_MIPMAPS = 8192 * 8192;

/** Cartes qui ne sont pas des textures de modele a lire en trilineaire anisotrope. */
const CLES_IGNOREES = new Set(['envMap', 'gradientMap']);

const _traitees = new WeakSet();

/** 16 sur ordinateur, 8 si le pointeur principal est tactile. `env.matchMedia` sert aux tests. */
export function plafondAnisotropie(env) {
  let tactile = false;
  try {
    const q = env && env.matchMedia ? env.matchMedia('(pointer: coarse)')
      : (typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : null);
    tactile = !!(q && q.matches);
  } catch (_) { /* media query indisponible : on suppose un ordinateur */ }
  return tactile ? ANISOTROPIE_TACTILE : ANISOTROPIE_ORDINATEUR;
}

/** min(plafond, capacite de la carte). Sans renderer, le plafond (three bornera au televersement). Jamais sous 1. */
export function anisotropieCible(renderer, env) {
  const plafond = plafondAnisotropie(env);
  let max = plafond;
  try {
    const m = renderer && renderer.capabilities && renderer.capabilities.getMaxAnisotropy();
    if (typeof m === 'number' && isFinite(m)) max = m;
  } catch (_) { /* renderer sans capacites : plafond */ }
  return Math.max(1, Math.min(plafond, max));
}

function _estTexture2DOrdinaire(t) {
  return !(t.isCubeTexture || t.isVideoTexture || t.isDepthTexture || t.isRenderTargetTexture
    || t.isDataArrayTexture || t.isData3DTexture || t.type === THREE.FloatType || t.type === THREE.HalfFloatType);
}

function _pixels(t) {
  const im = t.image || (t.source && t.source.data);
  const l = im && (im.naturalWidth || im.width || 0);
  const h = im && (im.naturalHeight || im.height || 0);
  return (l || 0) * (h || 0);
}

function _dejaTeleversee(t, renderer) {
  try {
    const props = renderer && renderer.properties;
    if (!props || typeof props.has !== 'function' || !props.has(t)) return false;
    const p = props.get(t);
    return !!(p && p.__webglTexture);
  } catch (_) { return false; }
}

function _preparerTexture(t, cible, renderer, bilan) {
  if (_traitees.has(t)) return;
  _traitees.add(t);
  if (!_estTexture2DOrdinaire(t)) { bilan.ignorees++; return; }
  // pixel-art voulu : three n'applique de toute facon pas l'anisotropie quand magFilter est Nearest
  if (t.magFilter === THREE.NearestFilter) { bilan.ignorees++; return; }
  bilan.textures++;

  let change = false;
  let mipmapsCorriges = false;
  const mipsFournis = Array.isArray(t.mipmaps) && t.mipmaps.length > 1;
  const generable = !t.isCompressedTexture && !mipsFournis;
  const minOk = t.minFilter === THREE.LinearMipmapLinearFilter || t.minFilter === THREE.NearestMipmapLinearFilter;

  if (!minOk && (mipsFournis || (generable && _pixels(t) <= PIXELS_MAX_POUR_MIPMAPS))) {
    t.minFilter = THREE.LinearMipmapLinearFilter;
    mipmapsCorriges = true;
  }
  if (generable && t.generateMipmaps === false
    && (t.minFilter === THREE.LinearMipmapLinearFilter || t.minFilter === THREE.NearestMipmapLinearFilter)) {
    t.generateMipmaps = true;   // un filtre a mipmaps sans mipmaps = texture incomplete = noire
    mipmapsCorriges = true;
  }
  if (mipmapsCorriges) { bilan.mipmaps++; change = true; }   // une texture comptee UNE fois, quel que soit le nombre de reglages touches
  if (!(t.anisotropy >= cible)) {
    t.anisotropy = cible;
    bilan.anisotropie++;
    change = true;
  }
  if (change && _dejaTeleversee(t, renderer)) {
    t.needsUpdate = true;
    bilan.retelechargees++;
  }
}

/**
 * Regle l'anisotropie et verifie les mipmaps de TOUTES les cartes de TOUS les materiaux des meshes de `racine`
 * (map, normalMap, roughnessMap, metalnessMap, aoMap, emissiveMap, bumpMap, clearcoat..., toute propriete de
 * materiau qui est une texture). Idempotent : une texture deja vue n'est plus touchee.
 * `renderer` (facultatif) borne l'anisotropie a la capacite de la carte et permet de savoir si un televersement
 * est deja fait. Rend un bilan { textures, anisotropie, mipmaps, ignorees, retelechargees }.
 */
export function preparerTexturesModele(racine, renderer) {
  const bilan = { textures: 0, anisotropie: 0, mipmaps: 0, ignorees: 0, retelechargees: 0 };
  if (!racine || typeof racine.traverse !== 'function') return bilan;
  const cible = anisotropieCible(renderer);
  racine.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;   // meshes seulement : pas les etiquettes (Sprite) ni les lignes
    const materiaux = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of materiaux) {
      if (!mat) continue;
      for (const cle of Object.keys(mat)) {
        if (CLES_IGNOREES.has(cle)) continue;
        const t = mat[cle];
        if (t && t.isTexture === true) _preparerTexture(t, cible, renderer, bilan);
      }
    }
  });
  return bilan;
}

/**
 * Enveloppe GLTFLoader.prototype.parse : le rappel de l'appelant ne part qu'APRES la verification des textures.
 * Idempotent (marqueur sur la methode). Une erreur de verification n'empeche jamais le chargement.
 * Rend true si l'enveloppe vient d'etre posee.
 */
export function brancherSurChargeurGLTF(Chargeur) {
  const proto = Chargeur && Chargeur.prototype;
  if (!proto || typeof proto.parse !== 'function' || proto.parse.__filtrageTextures) return false;
  const origine = proto.parse;
  const enveloppe = function parse(data, path, onLoad, onError) {
    const surCharge = function (gltf) {
      try {
        const scenes = gltf && gltf.scenes && gltf.scenes.length ? gltf.scenes : (gltf && gltf.scene ? [gltf.scene] : []);
        for (const s of scenes) preparerTexturesModele(s, null);
      } catch (e) {
        try { console.warn('[textures] filtrage non applique :', e && e.message ? e.message : e); } catch (_) { /* rien */ }
      }
      return typeof onLoad === 'function' ? onLoad.apply(this, arguments) : undefined;
    };
    return origine.call(this, data, path, surCharge, onError);
  };
  enveloppe.__filtrageTextures = true;
  proto.parse = enveloppe;
  return true;
}

// ── Effets a l'import (les deux premiers mecanismes ci-dessus) ─────────────────────────────────────────────────
THREE.Texture.DEFAULT_ANISOTROPY = Math.max(THREE.Texture.DEFAULT_ANISOTROPY || 1, plafondAnisotropie());
brancherSurChargeurGLTF(GLTFLoader);
