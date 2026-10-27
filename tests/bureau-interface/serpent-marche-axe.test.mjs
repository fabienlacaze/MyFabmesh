// Banc de rendu, 2e passe (26/10) : defauts vus sur des planches de poses d'un rig reel (voir AGENT_LOG, entree « anim-realisme 2 »).
//  a. frappe du serpent : l'avance partait toujours vers +z ; sur un rig couche le long de X (le serpent du user) la frappe glissait de COTE ;
//  b. saut d'un quadrupede : montee faible, queue qui s'enfonce ;
//  c. a-coups des allures a pattes.
// Squelettes SYNTHETIQUES (aucun fichier externe) : GLB sans maillage, noeuds + un skin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { __interne } from '../../cloud/public/app/lib/locomotion-procedurale.js';

function glb(noeuds, joints) {
  const json = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: noeuds, skins: [{ joints }] };
  let js = Buffer.from(JSON.stringify(json)); js = Buffer.concat([js, Buffer.alloc((4 - js.length % 4) % 4, 0x20)]);
  const tete = Buffer.alloc(20); tete.writeUInt32LE(0x46546c67, 0); tete.writeUInt32LE(2, 4); tete.writeUInt32LE(12 + 8 + js.length, 8);
  tete.writeUInt32LE(js.length, 12); tete.writeUInt32LE(0x4e4f534a, 16);
  const b = Buffer.concat([tete, js]);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}
// specs = [nom, parent, [x, y, z] position MONDE]
function squelette(specs) {
  const noeuds = specs.map(([nom]) => ({ name: nom, translation: [0, 0, 0] }));
  specs.forEach(([, p, w], i) => {
    if (p >= 0) { const q = specs[p][2]; noeuds[i].translation = [w[0] - q[0], w[1] - q[1], w[2] - q[2]]; (noeuds[p].children ||= []).push(i); } else noeuds[i].translation = w.slice();
  });
  return glb(noeuds, specs.map((_, i) => i));
}
function positions(sq, c, i) {
  const { par, P0 } = sq, n = par.length, D = new Array(n), P = new Array(n);
  const mul = (a, b) => { const o = new Array(9); for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) o[r * 3 + q] = a[r * 3] * b[q] + a[r * 3 + 1] * b[3 + q] + a[r * 3 + 2] * b[6 + q]; return o; };
  const ordre = [], vu = new Set();
  const visite = (j) => { if (vu.has(j)) return; if (par[j] >= 0) visite(par[j]); vu.add(j); ordre.push(j); };
  for (let j = 0; j < n; j++) visite(j);
  for (const j of ordre) {
    const q = par[j]; D[j] = q < 0 ? c.R[i][j] : mul(D[q], c.R[i][j]);
    if (q < 0) P[j] = c.racineMonde[i].slice();
    else { const o = [P0[j][0] - P0[q][0], P0[j][1] - P0[q][1], P0[j][2] - P0[q][2]]; const d = D[q]; P[j] = [P[q][0] + d[0] * o[0] + d[1] * o[1] + d[2] * o[2], P[q][1] + d[3] * o[0] + d[4] * o[1] + d[5] * o[2], P[q][2] + d[6] * o[0] + d[7] * o[1] + d[8] * o[2]]; }
  }
  return P;
}

// 27/10 (user : le serpent marche en travers) : la REPTATION (suivi de trace) avancait toujours vers +z ; un serpent couche le long de X marchait donc a 90 degres de son corps.
// serpent couche le long de X, racine a la TETE (x = -0,4)
function serpentX() {
  const s = [];
  for (let k = 0; k < 17; k++) s.push(['s' + k, k - 1, [-0.4 + k * 0.056, 0.03, 0]]);
  return s;
}
const mesure = (sq, allure, flags = {}) => {
  for (const [k, v] of Object.entries(flags)) globalThis[k] = v;
  try {
    const c = __interne.animerAllureSure(sq, allure, 3, 30, 'normal', 'reptation', 'generique');
    const tete = c.R.map((_, i) => positions(sq, c, i)[sq.racine]);
    const ptp = (k) => Math.max(...tete.map((p) => p[k])) - Math.min(...tete.map((p) => p[k]));
    return { x: ptp(0), z: ptp(2), dx: tete[tete.length - 1][0] - tete[0][0] };
  } finally { for (const k of Object.keys(flags)) delete globalThis[k]; }
};
test("marche du serpent : la tete avance dans l'axe du corps (X), pas en travers (Z)", () => {
  const sq = __interne.charger(squelette(serpentX()));
  const m = mesure(sq, 'walk');
  assert.ok(m.x > 2 * m.z, `avance le long du corps attendue : course X ${m.x.toFixed(3)} contre Z ${m.z.toFixed(3)}`);
  assert.ok(m.dx < 0, `la tete (x = -0,4) mene la marche vers -X : dx ${m.dx.toFixed(3)}`);
});
test("interrupteur : sans __marcheAxeCorps le comportement d'origine (vers +z) revient", () => {
  const sq = __interne.charger(squelette(serpentX()));
  const m = mesure(sq, 'walk', { __marcheAxeCorps: false });
  assert.ok(m.z > m.x, `origine : course Z ${m.z.toFixed(3)} > X ${m.x.toFixed(3)}`);
});
