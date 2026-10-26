// Banc de rendu visuel (26/10) : trois defauts VUS sur des planches de poses d'un rig reel, que les mesures d'avant ne montraient pas.
//  1. mort d'un bipede : le tronc restait a ~30 % de la hauteur du sol (un bras tendu vers le bas le tenait comme un pilier) ;
//  2. vol : le bout de l'aile ne couvrait que ~52 deg crete a crete (reference citee : 80-120 deg) et ne passait jamais sous l'horizontale ;
//  3. un os de chaine libre (queue) traversait le sol au saut.
// Squelettes SYNTHETIQUES (aucun fichier externe) : GLB sans maillage, noeuds + un skin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
const indexDe = (sq, nom) => sq.joints.findIndex((n) => sq.json.nodes[n].name === nom);

// bipede droit de ~1,65 de haut, face a +z : bassin, deux jambes, colonne, deux bras le long du corps
function humanoide() {
  const s = [['bassin', -1, [0, 0.95, 0]]];
  for (const cote of [-1, 1]) {
    s.push(['hanche' + cote, 0, [0.1 * cote, 0.92, 0]]); let p = s.length - 1;
    for (const [y, z] of [[0.5, 0.02], [0.08, 0], [0.0, 0.12]]) { s.push(['j' + cote + y, p, [0.1 * cote, y, z]]); p = s.length - 1; }
  }
  let p = 0;
  for (const y of [1.1, 1.3, 1.5, 1.65]) { s.push(['dos' + y, p, [0, y, 0]]); p = s.length - 1; }
  const dos = indexDe0(s, 'dos1.5');
  for (const cote of [-1, 1]) {
    s.push(['epaule' + cote, dos, [0.18 * cote, 1.45, 0]]); let q = s.length - 1;
    for (const [x, y] of [[0.3, 1.2], [0.33, 0.95], [0.34, 0.82]]) { s.push(['b' + cote + y, q, [x * cote, y, 0.02]]); q = s.length - 1; }
  }
  return s;
}
const indexDe0 = (specs, nom) => specs.findIndex((e) => e[0] === nom);

test('mort d\'un bipede : le tronc se pose au sol (plus de pilier-bras)', () => {
  const sq = __interne.charger(squelette(humanoide()));
  const hauteurRacine = (flag) => {
    globalThis.__mortAPlat = flag;
    try {
      const c = __interne.animerAllureSure(sq, 'death', 1, 30, 'normal', 'auto', 'humain');
      const P = positions(sq, c, c.R.length - 1), sol = Math.min(...sq.P0.map((p) => p[1])), H = Math.max(...sq.P0.map((p) => p[1])) - sol;
      return { y: (P[sq.racine][1] - sol) / H, bas: (Math.min(...P.map((p) => p[1])) - sol) / H };
    } finally { delete globalThis.__mortAPlat; }
  };
  const avant = hauteurRacine(false), apres = hauteurRacine(undefined);
  assert.ok(apres.y < avant.y, `le bassin couche descend : ${(100 * avant.y).toFixed(0)} % -> ${(100 * apres.y).toFixed(0)} % de H`);
  assert.ok(apres.y < 0.2, `le bassin couche est a ${(100 * apres.y).toFixed(0)} % de H du sol`);
  assert.ok(apres.bas >= -0.07, 'rien ne passe de plus de 7 % de H sous le sol');
});

function oiseau() {
  const s = [['corps', -1, [0, 0.5, 0]], ['cou', 0, [0, 0.62, 0.15]], ['tete', 1, [0, 0.7, 0.3]], ['queue1', 0, [0, 0.48, -0.2]], ['queue2', 3, [0, 0.46, -0.4]]];
  for (const cote of [-1, 1]) {
    s.push(['cuisse' + cote, 0, [0.06 * cote, 0.45, 0]]); let p = s.length - 1;
    for (const [y, z] of [[0.25, 0.03], [0.02, 0.0]]) { s.push(['pat' + cote + y, p, [0.06 * cote, y, z]]); p = s.length - 1; }
  }
  for (const cote of [-1, 1]) {
    s.push(['epaule' + cote, 0, [0.06 * cote, 0.56, 0.05]]); let p = s.length - 1;
    for (let k = 1; k <= 4; k++) { s.push(['aile' + cote + k, p, [(0.06 + 0.2 * k) * cote, 0.56 + 0.04 * k, 0.05]]); p = s.length - 1; }
  }
  return s;
}
test('vol : le bout de l\'aile couvre 75 deg ou plus crete a crete et passe sous l\'horizontale', () => {
  const sq = __interne.charger(squelette(oiseau()));
  const c = __interne.animerAllureSure(sq, 'walk', 2, 30, 'normal', 'vol', 'oiseau');
  assert.equal(c.infos.mode, 'vol');
  const ep = indexDe(sq, 'epaule-1'), bout = indexDe(sq, 'aile-14');
  assert.ok(ep >= 0 && bout >= 0);
  const el = c.R.map((_, i) => { const P = positions(sq, c, i); return Math.atan2(P[bout][1] - P[ep][1], Math.abs(P[bout][0] - P[ep][0])) * 180 / Math.PI; });
  const amp = Math.max(...el) - Math.min(...el);
  assert.ok(amp >= 75, `amplitude du bout d'aile ${amp.toFixed(0)} deg (avant : ~52)`);
  assert.ok(Math.min(...el) < 0, `la descente passe sous l'horizontale (min ${Math.min(...el).toFixed(0)})`);
});

function quadrupede() {
  const s = [['bassin', -1, [0, 0.5, -0.3]], ['dos1', 0, [0, 0.55, 0]], ['dos2', 1, [0, 0.58, 0.3]], ['cou', 2, [0, 0.7, 0.45]], ['tete', 3, [0, 0.72, 0.65]]];
  let p = 0;
  for (let k = 1; k <= 5; k++) { s.push(['queue' + k, p, [0, 0.5 - 0.1 * k, -0.3 - 0.13 * k]]); p = s.length - 1; }
  for (const [z, nom] of [[-0.3, 'ar'], [0.3, 'av']]) {
    for (const cote of [-1, 1]) {
      s.push([nom + 'h' + cote, nom === 'ar' ? 0 : 2, [0.12 * cote, 0.48, z]]); let q = s.length - 1;
      for (const y of [0.25, 0.0]) { s.push([nom + 'j' + cote + y, q, [0.12 * cote, y, z + (y ? 0.04 : 0)]]); q = s.length - 1; }
    }
  }
  return s;
}
test('saut : une queue qui pendait sous le sol est relevee', () => {
  const sq = __interne.charger(squelette(quadrupede()));
  const sol = Math.min(...sq.P0.map((p) => p[1])), H = Math.max(...sq.P0.map((p) => p[1])) - sol;
  const pire = (flag) => {
    globalThis.__aplatirSousSol = flag;
    try {
      const c = __interne.animerAllureSure(sq, 'jump', 1, 30, 'normal', 'auto', 'equide');
      return Math.max(0, ...c.R.map((_, i) => sol - Math.min(...positions(sq, c, i).map((p) => p[1])))) / H;
    } finally { delete globalThis.__aplatirSousSol; }
  };
  const sans = pire(false), avec = pire(undefined);
  assert.ok(avec <= sans + 1e-9, `la correction n'aggrave rien : ${(100 * avec).toFixed(1)} % de H contre ${(100 * sans).toFixed(1)}`);
  if (sans > 0.02) assert.ok(avec < 0.6 * sans, `enfoncement reduit de ${(100 * sans).toFixed(1)} a ${(100 * avec).toFixed(1)} % de H`);
});

test('les moteurs bureau et web sont identiques', () => {
  assert.equal(readFileSync('src/renderer/lib/locomotion-procedurale.js', 'utf8'), readFileSync('cloud/public/app/lib/locomotion-procedurale.js', 'utf8'));
});
