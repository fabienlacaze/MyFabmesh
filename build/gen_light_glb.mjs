// VERSION LEGERE D'UN GLB (2026-09-30, user : « ca suffit pas », rig du centipede de 466 Mo inutilisable dans le viewer).
//   node build/gen_light_glb.mjs entree.glb sortie.glb [triangles=400000]
// Reduit chaque primitive par meshoptimizer (WASM, MIT, avec les UV dans le calcul : la texture reste calee) puis COMPACTE : seuls
// les sommets encore references sont gardes, avec TOUS leurs attributs (positions, normales, UV, os et poids de peau...), et les
// tampons devenus inutiles sont retires. Textures, materiaux, squelette et animations sont recopies tels quels : le fichier
// leger est un vrai GLB autonome, meme apparence, meme rig, 10 a 20 fois moins de triangles. Aucun nouveau sommet, aucune cuisson.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ici = dirname(fileURLToPath(import.meta.url));
const { MeshoptSimplifier: S } = await import('file:///' + join(ici, '..', 'src', 'renderer', 'lib', 'meshopt-simplifier.js').replace(/\\/g, '/'));

export const ERREUR_MAX = parseFloat(process.env.ERREUR_MAX_LEGER || '0.0015');   // 0,15 % de la taille du maillage
const TYPES = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const OCTETS = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const CTORS = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };

export async function versionLegere(data, cible = 400000, log = console.log) {
  if (data.readUInt32LE(0) !== 0x46546C67) throw new Error('pas un GLB');
  const nj = data.readUInt32LE(12);
  const j = JSON.parse(data.toString('utf8', 20, 20 + nj));
  const dbin = 20 + nj + 8;
  const bin = (off, len) => data.subarray(dbin + off, dbin + off + len);
  const nouvellesVues = [];                       // { octets: Buffer, cible }
  const vueDe = (buf, tgt) => { j.bufferViews.push({ buffer: 0, byteOffset: -1, byteLength: buf.length, target: tgt, _buf: buf }); return j.bufferViews.length - 1; };
  const accesseur = (o) => { j.accessors.push(o); return j.accessors.length - 1; };
  const lire = (ai) => {                          // -> { rows: Buffer (serre), n, taille, a }
    const a = j.accessors[ai]; if (a.sparse) throw new Error('accessor sparse non gere');
    const v = j.bufferViews[a.bufferView], taille = TYPES[a.type] * OCTETS[a.componentType], pas = v.byteStride || taille;
    const base = (v.byteOffset || 0) + (a.byteOffset || 0);
    const out = Buffer.alloc(a.count * taille);
    for (let i = 0; i < a.count; i++) bin(base + i * pas, taille).copy(out, i * taille);
    return { rows: out, n: a.count, taille, a };
  };
  let avant = 0, apres = 0;
  for (const m of j.meshes) for (const p of m.primitives) {
    if ((p.mode ?? 4) !== 4 || p.indices == null) continue;
    const pos = lire(p.attributes.POSITION), idxA = lire(p.indices);
    const P = new Float32Array(pos.rows.buffer, pos.rows.byteOffset, pos.n * 3);
    const I = idxA.a.componentType === 5125 ? new Uint32Array(idxA.rows.buffer, idxA.rows.byteOffset, idxA.n) : Uint32Array.from(new CTORS[idxA.a.componentType](idxA.rows.buffer, idxA.rows.byteOffset, idxA.n));
    const nTri = I.length / 3; avant += nTri;
    if (nTri <= cible * 1.05) { apres += nTri; continue; }
    let res, erreur = 0, cibleP = cible;
    const t = Date.now();
    const U = (p.attributes.TEXCOORD_0 != null && j.accessors[p.attributes.TEXCOORD_0].componentType === 5126)
      ? (() => { const uv = lire(p.attributes.TEXCOORD_0); return new Float32Array(uv.rows.buffer, uv.rows.byteOffset, uv.n * 2); })() : null;
    // CONTROLE DE QUALITE AUTOMATIQUE : meshoptimizer rend l'erreur geometrique reelle (relative a la taille du maillage). Au-dela de
    // ERREUR_MAX (0,15 % ; le centipede, 10 M -> 500 K, est a ~0,02-0,05 %), on double la cible de triangles (jusqu'a 2 M) et on recommence.
    for (let essai = 0; essai < 3; essai++) {
      if (U) [res, erreur] = S.simplifyWithAttributes(I, P, 3, U, 2, [1, 1], null, cibleP * 3, 0.02, []);
      else [res, erreur] = S.simplify(I, P, 3, cibleP * 3, 0.02, []);
      if (res.length > cibleP * 3 * 1.5) [res, erreur] = S.simplify(I, P, 3, cibleP * 3, 1.0, []);
      if (res.length > cibleP * 3 * 2) [res, erreur] = S.simplifySloppy(I, P, 3, null, cibleP * 3, 1.0);
      log(`  essai ${essai + 1} : cible ${cibleP} -> ${res.length / 3} triangles, erreur ${(erreur * 100).toFixed(3)} %`);
      if (erreur <= ERREUR_MAX || cibleP * 2 > 2000000 || nTri <= cibleP * 2) break;
      cibleP *= 2;
    }
    log(`  primitive : ${nTri} -> ${res.length / 3} triangles en ${((Date.now() - t) / 1000).toFixed(1)} s (erreur ${(erreur * 100).toFixed(3)} %)`);
    // sommets references -> nouvel indice
    const remap = new Int32Array(pos.n).fill(-1); let nv = 0;
    for (let i = 0; i < res.length; i++) if (remap[res[i]] < 0) remap[res[i]] = nv++;
    const ordre = new Uint32Array(nv); for (let i = 0; i < pos.n; i++) if (remap[i] >= 0) ordre[remap[i]] = i;
    const nIdx = new Uint32Array(res.length); for (let i = 0; i < res.length; i++) nIdx[i] = remap[res[i]];
    const attrs = Object.entries(p.attributes);
    for (const [nom, ai] of attrs) {
      const src = lire(ai), o = Buffer.alloc(nv * src.taille);
      for (let k = 0; k < nv; k++) src.rows.copy(o, k * src.taille, ordre[k] * src.taille, (ordre[k] + 1) * src.taille);
      const a2 = { bufferView: vueDe(o, 34962), componentType: src.a.componentType, count: nv, type: src.a.type };
      if (src.a.normalized) a2.normalized = true;
      if (nom === 'POSITION') {
        const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity], F = new Float32Array(o.buffer, o.byteOffset, nv * 3);
        for (let k = 0; k < nv; k++) for (let c = 0; c < 3; c++) { const x = F[k * 3 + c]; if (x < mn[c]) mn[c] = x; if (x > mx[c]) mx[c] = x; }
        a2.min = mn; a2.max = mx;
      }
      p.attributes[nom] = accesseur(a2);
    }
    if (p.targets) for (const tg of p.targets) for (const nom of Object.keys(tg)) {          // cibles de morphing : memes sommets
      const src = lire(tg[nom]), o = Buffer.alloc(nv * src.taille);
      for (let k = 0; k < nv; k++) src.rows.copy(o, k * src.taille, ordre[k] * src.taille, (ordre[k] + 1) * src.taille);
      tg[nom] = accesseur({ bufferView: vueDe(o, 34962), componentType: src.a.componentType, count: nv, type: src.a.type });
    }
    const petit = nv < 65536;
    const ib = Buffer.from((petit ? Uint16Array.from(nIdx) : nIdx).buffer.slice(0));
    p.indices = accesseur({ bufferView: vueDe(petit ? Buffer.from(Uint16Array.from(nIdx).buffer) : Buffer.from(nIdx.buffer), 34963), componentType: petit ? 5123 : 5125, count: nIdx.length, type: 'SCALAR' });
    apres += res.length / 3;
  }
  // --- compactage : on ne garde que ce qui est reference ---------------------------------------------------------------
  const acc = new Set();
  for (const m of j.meshes) for (const p of m.primitives) {
    Object.values(p.attributes).forEach((v) => acc.add(v)); if (p.indices != null) acc.add(p.indices);
    (p.targets || []).forEach((tg) => Object.values(tg).forEach((v) => acc.add(v)));
  }
  (j.skins || []).forEach((s) => { if (s.inverseBindMatrices != null) acc.add(s.inverseBindMatrices); });
  (j.animations || []).forEach((an) => an.samplers.forEach((s) => { acc.add(s.input); acc.add(s.output); }));
  const accListe = [...acc].sort((a, b) => a - b), accMap = new Map(accListe.map((o, i) => [o, i]));
  const vues = new Set(accListe.map((a) => j.accessors[a].bufferView).filter((x) => x != null));
  (j.images || []).forEach((im) => { if (im.bufferView != null) vues.add(im.bufferView); });
  const vueListe = [...vues].sort((a, b) => a - b), vueMap = new Map(vueListe.map((o, i) => [o, i]));
  const morceaux = []; let taille = 0; const nvues = [];
  const pad = () => { const r = (4 - (taille % 4)) % 4; if (r) { morceaux.push(Buffer.alloc(r)); taille += r; } };
  for (const o of vueListe) {
    const v = j.bufferViews[o]; pad();
    const buf = v._buf || bin(v.byteOffset || 0, v.byteLength);
    const nv = { buffer: 0, byteOffset: taille, byteLength: buf.length };
    if (v.target) nv.target = v.target; if (v.byteStride && !v._buf) nv.byteStride = v.byteStride; if (v.name) nv.name = v.name;
    morceaux.push(buf); taille += buf.length; nvues.push(nv);
  }
  const accs = accListe.map((o) => { const a = { ...j.accessors[o] }; if (a.bufferView != null) a.bufferView = vueMap.get(a.bufferView); return a; });
  for (const m of j.meshes) for (const p of m.primitives) {
    for (const k of Object.keys(p.attributes)) p.attributes[k] = accMap.get(p.attributes[k]);
    if (p.indices != null) p.indices = accMap.get(p.indices);
    (p.targets || []).forEach((tg) => { for (const k of Object.keys(tg)) tg[k] = accMap.get(tg[k]); });
  }
  (j.skins || []).forEach((s) => { if (s.inverseBindMatrices != null) s.inverseBindMatrices = accMap.get(s.inverseBindMatrices); });
  (j.animations || []).forEach((an) => an.samplers.forEach((s) => { s.input = accMap.get(s.input); s.output = accMap.get(s.output); }));
  (j.images || []).forEach((im) => { if (im.bufferView != null) im.bufferView = vueMap.get(im.bufferView); });
  j.bufferViews = nvues; j.accessors = accs; pad();
  j.buffers = [{ byteLength: taille }];
  let js = Buffer.from(JSON.stringify(j)); js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const tete = Buffer.alloc(12); tete.write('glTF', 0); tete.writeUInt32LE(2, 4); tete.writeUInt32LE(12 + 8 + js.length + 8 + taille, 8);
  const h1 = Buffer.alloc(8); h1.writeUInt32LE(js.length, 0); h1.write('JSON', 4);
  const h2 = Buffer.alloc(8); h2.writeUInt32LE(taille, 0); h2.write('BIN\0', 4);
  log(`  total : ${avant} -> ${apres} triangles`);
  return Buffer.concat([tete, h1, js, h2, ...morceaux]);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [, , entree, sortie, cibleTxt] = process.argv;
  await S.ready;
  const data = readFileSync(entree);
  const t = Date.now();
  const out = await versionLegere(data, parseInt(cibleTxt || '400000', 10));
  writeFileSync(sortie, out);
  console.log(`${(data.length / 1e6).toFixed(1)} Mo -> ${(out.length / 1e6).toFixed(1)} Mo en ${((Date.now() - t) / 1000).toFixed(0)} s`);
}
