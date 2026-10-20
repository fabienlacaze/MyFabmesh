// Outils de test du filtrage des textures (2026-10-15, complete le 2026-10-18) : un GLB MINIMAL fabrique en memoire, un
// encodeur PNG et un decodeur d'image factice, pour que le VRAI GLTFLoader (three r170 livre dans src/renderer/lib) lise un
// VRAI fichier GLB sous Node, sans navigateur ni GPU ; et, avec `png`, un GLB dont l'image est REELLE (lisible par un vrai
// navigateur : banc build/bancs/viewer/*). Le GLB porte un triangle (ou un carre) et cinq textures qui partagent UNE image
// mais ont chacune un echantillonneur different (la facon dont les exporteurs decrivent le filtrage) :
//   0 baseColor          : aucun echantillonneur       -> le chargeur applique LinearMipmapLinear (cas des GLB de trimesh / TRELLIS,
//                                                         mesure le 2026-10-18 sur hr_G1792_tranches_t4096_f500000.glb : pas de « samplers »)
//   1 metallicRoughness  : LINEAR / LINEAR (9729)      -> pas de mipmaps : l'anisotropie serait sans effet
//   2 normal             : LINEAR_MIPMAP_NEAREST (9985) -> idem : three n'applique l'anisotropie qu'avec LinearMipmapLinear
//   3 occlusion          : LINEAR_MIPMAP_LINEAR (9987)  -> deja bon
//   4 emissive           : NEAREST / NEAREST (9728)     -> pixel-art voulu : a laisser tel quel
// Les cartes metallicRoughness servent a la fois de roughnessMap et de metalnessMap (meme objet dans three).
import { deflateSync } from 'node:zlib';

export const SAMPLERS = [
  {},
  { magFilter: 9729, minFilter: 9729 },
  { magFilter: 9729, minFilter: 9985 },
  { magFilter: 9729, minFilter: 9987 },
  { magFilter: 9728, minFilter: 9728 },
];

function morceau(type, octets) {
  const pad = (4 - (octets.length % 4)) % 4;
  const corps = Buffer.concat([octets, Buffer.alloc(pad, type === 0x4e4f534a ? 0x20 : 0)]);   // JSON : completé par des espaces
  const entete = Buffer.alloc(8);
  entete.writeUInt32LE(corps.length, 0);
  entete.writeUInt32LE(type, 4);
  return Buffer.concat([entete, corps]);
}

// ---------- PNG ----------
let TABLE_CRC = null;
function crc32(octets) {
  if (!TABLE_CRC) {
    TABLE_CRC = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); TABLE_CRC[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (const o of octets) c = TABLE_CRC[(c ^ o) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunkPng(type, donnees) {
  const t = Buffer.from(type, 'ascii');
  const long = Buffer.alloc(4); long.writeUInt32BE(donnees.length, 0);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, donnees])), 0);
  return Buffer.concat([long, t, donnees, crc]);
}

/** PNG RGBA 8 bits VALIDE (un vrai navigateur le decode). pixel(x, y) -> [r, g, b, a]. @returns {Buffer} */
export function pngRGBA(largeur, hauteur, pixel) {
  const brut = Buffer.alloc((1 + largeur * 4) * hauteur);   // chaque ligne : octet de filtre 0 puis les pixels
  let o = 0;
  for (let y = 0; y < hauteur; y++) {
    brut[o++] = 0;
    for (let x = 0; x < largeur; x++) { const p = pixel(x, y); brut[o++] = p[0]; brut[o++] = p[1]; brut[o++] = p[2]; brut[o++] = p[3]; }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largeur, 0); ihdr.writeUInt32BE(hauteur, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8 bits, RGBA, deflate, filtre 0, sans entrelacement
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunkPng('IHDR', ihdr), chunkPng('IDAT', deflateSync(brut)), chunkPng('IEND', Buffer.alloc(0))]);
}

/** Damier clair / sombre de `carre` pixels de cote (la texture d'ecole de l'anisotropie : des lignes fines et regulieres). */
export function pngDamier(taille = 1024, carre = 16) {
  return pngRGBA(taille, taille, (x, y) => (((Math.floor(x / carre) + Math.floor(y / carre)) & 1) ? [242, 242, 242, 255] : [32, 32, 32, 255]));
}

// ---------- GLB ----------
const flottants = (v) => { const b = Buffer.alloc(v.length * 4); v.forEach((x, i) => b.writeFloatLE(x, i * 4)); return b; };
const entiers16 = (v) => { const b = Buffer.alloc(v.length * 2); v.forEach((x, i) => b.writeUInt16LE(x, i * 2)); return b; };
const aligner4 = (n) => n + ((4 - (n % 4)) % 4);

/**
 * @param {{ png?: Buffer, plan?: { cote: number, repetitions: number } }} [options]
 *   png  : image REELLE (PNG) partagee par les cinq textures, pour un navigateur. Sans elle : un en-tete PNG factice, que
 *          lit le decodeur factice de Node (installerDecodeurFactice).
 *   plan : un carre `cote` x `cote` dans le plan XZ, face +Y, dont les UV vont de 0 a `repetitions` (la texture se repete),
 *          a la place du triangle : de quoi regarder la texture sous un angle rasant.
 * @returns {ArrayBuffer} un GLB 2.0 valide (triangle ou carre, et les 5 textures decrites ci-dessus).
 */
export function glbMinimal(options = {}) {
  const { png = null, plan = null } = options;
  let positions, normales, uv, indices, nbSommets, nbIndices, bornes;
  if (plan) {
    const c = plan.cote / 2, r = plan.repetitions;
    positions = flottants([-c, 0, -c, c, 0, -c, c, 0, c, -c, 0, c]);
    normales = flottants([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
    uv = flottants([0, 0, r, 0, r, r, 0, r]);
    indices = entiers16([0, 2, 1, 0, 3, 2]);
    nbSommets = 4; nbIndices = 6; bornes = { min: [-c, 0, -c], max: [c, 0, c] };
  } else {
    positions = flottants([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    normales = flottants([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    uv = flottants([0, 0, 1, 0, 0, 1]);
    indices = entiers16([0, 1, 2]);
    nbSommets = 3; nbIndices = 3; bornes = { min: [0, 0, 0], max: [1, 1, 0] };
  }
  const image = png || Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);   // factice : l'entete PNG, le decodeur factice n'en lit rien
  const oPos = 0, oNor = oPos + positions.length, oUv = oNor + normales.length, oInd = oUv + uv.length, oImg = aligner4(oInd + indices.length);
  const bin = Buffer.concat([positions, normales, uv, indices, Buffer.alloc(oImg - (oInd + indices.length)), image]);
  const json = {
    asset: { version: '2.0', generator: 'test filtrage-textures' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: plan ? 'plan' : 'triangle' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
    materials: [{
      name: 'matiere',
      pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicRoughnessTexture: { index: 1 } },
      normalTexture: { index: 2 }, occlusionTexture: { index: 3 }, emissiveTexture: { index: 4 }, emissiveFactor: [1, 1, 1],
    }],
    samplers: SAMPLERS,
    textures: SAMPLERS.map((_, i) => ({ source: 0, sampler: i })),
    images: [{ bufferView: 4, mimeType: 'image/png' }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: nbSommets, type: 'VEC3', min: bornes.min, max: bornes.max },
      { bufferView: 1, componentType: 5126, count: nbSommets, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: nbSommets, type: 'VEC2' },
      { bufferView: 3, componentType: 5123, count: nbIndices, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: oPos, byteLength: positions.length, target: 34962 },
      { buffer: 0, byteOffset: oNor, byteLength: normales.length, target: 34962 },
      { buffer: 0, byteOffset: oUv, byteLength: uv.length, target: 34962 },
      { buffer: 0, byteOffset: oInd, byteLength: indices.length, target: 34963 },
      { buffer: 0, byteOffset: oImg, byteLength: image.length },
    ],
    buffers: [{ byteLength: bin.length }],
  };
  const m1 = morceau(0x4e4f534a, Buffer.from(JSON.stringify(json), 'utf8'));
  const m2 = morceau(0x004e4942, bin);
  const entete = Buffer.alloc(12);
  entete.write('glTF', 0, 'ascii');
  entete.writeUInt32LE(2, 4);
  entete.writeUInt32LE(12 + m1.length + m2.length, 8);
  const tout = Buffer.concat([entete, m1, m2]);
  return tout.buffer.slice(tout.byteOffset, tout.byteOffset + tout.byteLength);
}

/**
 * Installe ce que GLTFLoader attend d'un navigateur pour decoder une image : `self`, `document.createElementNS('img')`
 * (TextureLoader -> ImageLoader). L'image factice « se charge » au tour suivant et fait largeur x hauteur.
 * Rend la fonction qui remet l'environnement d'origine.
 */
export function installerDecodeurFactice(largeur = 1024, hauteur = 1024) {
  const avantSelf = Object.getOwnPropertyDescriptor(globalThis, 'self');
  const avantDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'self', { value: globalThis, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'document', {
    configurable: true, writable: true,
    value: {
      createElementNS() {
        const ecouteurs = { load: [], error: [] };
        const img = {
          width: largeur, height: hauteur, naturalWidth: largeur, naturalHeight: hauteur, complete: true, _src: '',
          addEventListener(type, f) { (ecouteurs[type] || (ecouteurs[type] = [])).push(f); },
          removeEventListener(type, f) { ecouteurs[type] = (ecouteurs[type] || []).filter((x) => x !== f); },
          set src(v) { this._src = v; setTimeout(() => ecouteurs.load.slice().forEach((f) => f.call(img)), 0); },
          get src() { return this._src; },
        };
        return img;
      },
    },
  });
  return () => {
    if (avantSelf) Object.defineProperty(globalThis, 'self', avantSelf); else delete globalThis.self;
    if (avantDocument) Object.defineProperty(globalThis, 'document', avantDocument); else delete globalThis.document;
  };
}
