import { writeFileSync } from 'node:fs';
function glb(json) {
  const jb = new TextEncoder().encode(JSON.stringify(json)); const pad = (4 - (jb.length % 4)) % 4; const total = 12 + 8 + jb.length + pad + 8;
  const out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true); dv.setUint32(12, jb.length + pad, true); dv.setUint32(16, 0x4E4F534A, true);
  out.set(jb, 20); out.fill(0x20, 20 + jb.length, 20 + jb.length + pad); const o = 20 + jb.length + pad; dv.setUint32(o, 0, true); dv.setUint32(o + 4, 0x004E4942, true); return out;
}
function sq(points, parents) {
  const nodes = points.map((p, i) => ({ name: 'bone_' + i, translation: parents[i] >= 0 ? p.map((v, k) => v - points[parents[i]][k]) : p, children: [] }));
  parents.forEach((p, i) => { if (p >= 0) nodes[p].children.push(i); }); nodes.forEach((n) => { if (!n.children.length) delete n.children; });
  const rac = parents.map((p, i) => (p < 0 ? i : -1)).filter((i) => i >= 0);
  return glb({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: rac }], nodes, skins: [{ joints: points.map((_, i) => i) }], buffers: [{ byteLength: 0 }] });
}
class B { constructor() { this.P = []; this.par = []; } ajoute(p, a) { this.P.push(p); this.par.push(a); return this.P.length - 1; } chaine(d, pts) { let k = d; for (const p of pts) k = this.ajoute(p, k); return k; } out() { return sq(this.P, this.par); } }
const R = {};
R.theropode = () => { const b = new B(); const bas = b.ajoute([0, 0.9, 0], -1);
  const po = b.chaine(bas, [[0, 1.0, 0.45]]); b.chaine(po, [[0, 1.2, 0.75], [0, 1.4, 0.95], [0, 1.45, 1.2], [0, 1.43, 1.4]]);
  for (const s of [1, -1]) b.chaine(po, [[s * 0.1, 0.98, 0.55], [s * 0.12, 0.85, 0.7], [s * 0.12, 0.78, 0.82]]);
  for (const s of [1, -1]) b.chaine(bas, [[s * 0.15, 0.88, 0.02], [s * 0.15, 0.62, 0.28], [s * 0.15, 0.32, 0.02], [s * 0.15, 0.06, 0.04], [s * 0.15, 0.0, 0.3]]);
  b.chaine(bas, [[0, 0.9, -0.4], [0, 0.85, -0.9], [0, 0.75, -1.4], [0, 0.65, -1.9]]); return b.out(); };
R.kangourou = () => { const b = new B(); const bas = b.ajoute([0, 0.7, 0], -1);
  const po = b.chaine(bas, [[0, 0.9, 0.15]]); b.chaine(po, [[0, 1.1, 0.25], [0, 1.3, 0.35], [0, 1.37, 0.5]]);
  for (const s of [1, -1]) b.chaine(po, [[s * 0.1, 1.05, 0.3], [s * 0.12, 0.9, 0.4], [s * 0.12, 0.78, 0.5]]);
  for (const s of [1, -1]) b.chaine(bas, [[s * 0.12, 0.66, 0], [s * 0.12, 0.4, 0.25], [s * 0.12, 0.12, -0.1], [s * 0.12, 0.0, 0.3]]);
  b.chaine(bas, [[0, 0.65, -0.3], [0, 0.4, -0.7], [0, 0.15, -1.0]]); return b.out(); };
R.manchot = () => { const b = new B(); const bas = b.ajoute([0, 0.35, 0], -1);
  const po = b.chaine(bas, [[0, 0.6, 0.02]]); b.chaine(po, [[0, 0.85, 0.05], [0, 1.0, 0.1], [0, 1.05, 0.22]]);
  for (const s of [1, -1]) b.chaine(po, [[s * 0.12, 0.8, 0], [s * 0.3, 0.6, 0], [s * 0.4, 0.45, 0]]);
  for (const s of [1, -1]) b.chaine(bas, [[s * 0.08, 0.3, 0], [s * 0.08, 0.15, 0.02], [s * 0.08, 0.02, 0.0], [s * 0.08, 0.0, 0.12]]); return b.out(); };
R.oiseau2 = () => { const b = new B(); const bas = b.ajoute([0, 0.5, 0], -1);
  const po = b.chaine(bas, [[0, 0.6, 0.15], [0, 0.68, 0.25]]); b.chaine(po, [[0, 0.8, 0.3], [0, 0.95, 0.35], [0, 0.97, 0.45]]);
  for (const s of [1, -1]) b.chaine(po, [[s * 0.1, 0.66, 0.18], [s * 0.14, 0.55, 0.0], [s * 0.15, 0.5, -0.2]]);   // ailes repliees
  for (const s of [1, -1]) b.chaine(bas, [[s * 0.08, 0.45, 0], [s * 0.1, 0.25, 0.1], [s * 0.1, 0.03, -0.03], [s * 0.1, 0.0, 0.1]]);
  b.chaine(bas, [[0, 0.52, -0.2], [0, 0.5, -0.35]]); return b.out(); };
for (const [k, f] of Object.entries(R)) writeFileSync('C:/tmp/anim2_bipedes/rigs/' + k + '.glb', f());
console.log(Object.keys(R));
