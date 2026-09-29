// REDUCTION PAR MESHOPTIMIZER cote BUREAU (2026-09-29). Le paquet Python (bibliotheque compilee, non signee)
// serait bloque par Smart App Control : on execute ici la version WebAssembly officielle (MIT, 1.3.0) avec
// l'executable Electron, deja signe (ELECTRON_RUN_AS_NODE=1). Meme sequence que acceleration_glb._reduire_meshopt
// sur le serveur : qualite (erreur 1 %), puis sans limite d'erreur, puis « sloppy ».
//   entree  : int32 nb_sommets, int32 nb_faces, float32 positions[3n], uint32 indices[3f]
//   sortie  : int32 nb_faces, uint32 indices[3f]
//   usage   : <node> meshopt_reduire.mjs entree.bin sortie.bin cible_faces
import { readFileSync, writeFileSync } from 'node:fs';
import { MeshoptSimplifier as S } from './meshopt_simplifier.mjs';

const [, , entree, sortie, cibleTxt] = process.argv;
const b = readFileSync(entree);
const nv = b.readInt32LE(0), nf = b.readInt32LE(4);
const pos = new Float32Array(b.buffer.slice(b.byteOffset + 8, b.byteOffset + 8 + nv * 12));
const idx = new Uint32Array(b.buffer.slice(b.byteOffset + 8 + nv * 12, b.byteOffset + 8 + nv * 12 + nf * 12));
await S.ready;
const cible = Math.max(3, parseInt(cibleTxt, 10) * 3);
let [r] = S.simplify(idx, pos, 3, cible, 0.01, []);
if (r.length > cible * 1.1) [r] = S.simplify(idx, pos, 3, cible, 1.0, []);
if (r.length > cible * 1.3) [r] = S.simplifySloppy(idx, pos, 3, null, cible, 1.0);
const out = Buffer.alloc(4 + r.length * 4);
out.writeInt32LE(r.length / 3, 0);
Buffer.from(r.buffer, r.byteOffset, r.length * 4).copy(out, 4);
writeFileSync(sortie, out);
