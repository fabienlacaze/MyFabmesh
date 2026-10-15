// Crochets de resolution de modules (node:module register) : rejouent, SOUS NODE, l'importmap des pages du bureau et du site
//   "three"          -> le VRAI three.module.js livre (r170) ;
//   "three/addons/"  -> les VRAIS addons livres (src/renderer/lib/loaders/GLTFLoader.js ...).
// Les tests qui s'en servent executent ainsi le code de production contre la revision de three que les pages chargent,
// pas contre celle de node_modules (autre revision). Voir _importmap-lib.mjs.
let carte = { three: '', addons: '' };

export async function initialize(data) {
  carte = data;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'three') return { url: carte.three, format: 'module', shortCircuit: true };
  if (specifier.startsWith('three/addons/')) return { url: carte.addons + specifier.slice('three/addons/'.length), format: 'module', shortCircuit: true };
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  // les fichiers des pages sont des modules ES dans des .js, sans package.json « type » : format explicite
  // (sinon Node doit le deviner et avertit a chaque fichier)
  if (url.startsWith('file:') && url.endsWith('.js') && !url.includes('/node_modules/')) return nextLoad(url, { ...context, format: 'module' });
  return nextLoad(url, context);
}
