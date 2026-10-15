// Outils de test du filtrage des textures (2026-10-15) : un GLB MINIMAL fabrique en memoire et un decodeur d'image
// factice, pour que le VRAI GLTFLoader (three r170 livre dans src/renderer/lib) lise un VRAI fichier GLB sous Node,
// sans navigateur ni GPU. Le GLB porte un triangle et cinq textures qui partagent UNE image mais ont chacune un
// echantillonneur different (la facon dont les exporteurs decrivent le filtrage) :
//   0 baseColor          : aucun echantillonneur       -> le chargeur applique LinearMipmapLinear (cas des GLB de trimesh / TRELLIS)
//   1 metallicRoughness  : LINEAR / LINEAR (9729)      -> pas de mipmaps : l'anisotropie serait sans effet
//   2 normal             : LINEAR_MIPMAP_NEAREST (9985) -> idem : three n'applique l'anisotropie qu'avec LinearMipmapLinear
//   3 occlusion          : LINEAR_MIPMAP_LINEAR (9987)  -> deja bon
//   4 emissive           : NEAREST / NEAREST (9728)     -> pixel-art voulu : a laisser tel quel
// Les cartes metallicRoughness servent a la fois de roughnessMap et de metalnessMap (meme objet dans three).

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

/** @returns {ArrayBuffer} un GLB 2.0 valide (triangle + 5 textures decrites ci-dessus). */
export function glbMinimal() {
  const positions = Buffer.alloc(36); [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((v, i) => positions.writeFloatLE(v, i * 4));
  const normales = Buffer.alloc(36); [0, 0, 1, 0, 0, 1, 0, 0, 1].forEach((v, i) => normales.writeFloatLE(v, i * 4));
  const uv = Buffer.alloc(24); [0, 0, 1, 0, 0, 1].forEach((v, i) => uv.writeFloatLE(v, i * 4));
  const indices = Buffer.alloc(8); [0, 1, 2].forEach((v, i) => indices.writeUInt16LE(v, i * 2));
  const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);   // l'entete PNG : le decodeur factice n'en lit rien
  const bin = Buffer.concat([positions, normales, uv, indices, image]);
  const json = {
    asset: { version: '2.0', generator: 'test filtrage-textures' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'triangle' }],
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
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: 3, type: 'VEC2' },
      { bufferView: 3, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 },
      { buffer: 0, byteOffset: 36, byteLength: 36, target: 34962 },
      { buffer: 0, byteOffset: 72, byteLength: 24, target: 34962 },
      { buffer: 0, byteOffset: 96, byteLength: 6, target: 34963 },
      { buffer: 0, byteOffset: 104, byteLength: 8 },
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
