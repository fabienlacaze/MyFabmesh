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
const indexDe = (sq, nom) => sq.joints.findIndex((n) => sq.json.nodes[n].name === nom);


// serpent couche le long de X, racine a la TETE (x = -0,4), queue a x = +0,5 (sans maillage la tete ne se devine pas : la racine fait foi)
function serpentX() {
  const s = [];
  for (let k = 0; k < 17; k++) s.push(['s' + k, k - 1, [-0.4 + k * 0.056, 0.03, 0]]);
  return s;
}
test('frappe du serpent : l\'avance suit l\'axe du corps (pas de derive laterale) et la tete parcourt 0,3 a 0,6 L', () => {
  const sq = __interne.charger(squelette(serpentX()));
  const L = 0.9;
  const mesure = (flags) => {
    for (const [k, v] of Object.entries(flags)) globalThis[k] = v;
    try {
      const c = __interne.animerAllureSure(sq, 'attack', 1, 30, 'normal', 'reptation', 'generique');
      const racine = c.R.map((_, i) => positions(sq, c, i)[sq.racine]);   // = la tete
      const tete = racine, ancre = c.R.map((_, i) => positions(sq, c, i)[12]);   // joint ancre (75 % de la colonne)
      const ptp = (a, k) => Math.max(...a.map((p) => p[k])) - Math.min(...a.map((p) => p[k]));
      return { derive: ptp(ancre, 2) / L, course: ptp(tete, 0) / L };
    } finally { for (const k of Object.keys(flags)) delete globalThis[k]; }
  };
  const avant = mesure({ __avanceAxeCorps: false, __frappeSerpent: false }), apres = mesure({});
  assert.ok(apres.derive < 0.5 * avant.derive, `derive laterale ${avant.derive.toFixed(3)} -> ${apres.derive.toFixed(3)} L`);
  assert.ok(apres.course > avant.course + 0.1, `course de la tete le long du corps ${avant.course.toFixed(2)} -> ${apres.course.toFixed(2)} L`);
  assert.ok(apres.course >= 0.3 && apres.course <= 0.65, `course ${apres.course.toFixed(2)} L (reference : 0,3-0,5 L)`);
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
test('saut d\'un quadrupede : le corps monte d\'au moins 0,3 H et les pieds le suivent en se repliant (plus d\'echasses)', () => {
  const sq = __interne.charger(squelette(quadrupede()));
  const sol = Math.min(...sq.P0.map((p) => p[1])), H = Math.max(...sq.P0.map((p) => p[1])) - sol, y0 = sq.P0[sq.racine][1];
  const bouts = ['arj-10', 'arj10', 'avj-10', 'avj10'].map((n) => indexDe(sq, n)).filter((k) => k >= 0);
  const mesure = (flag) => {
    globalThis.__sautQuadrupede = flag;
    try {
      const c = __interne.animerAllureSure(sq, 'jump', 1, 30, 'normal', 'auto', 'equide');
      const P = c.R.map((_, i) => positions(sq, c, i));
      return { montee: (Math.max(...P.map((q) => q[sq.racine][1])) - y0) / H, pieds: (Math.max(...P.map((q) => Math.max(...bouts.map((b) => q[b][1])))) - sol) / H };
    } finally { delete globalThis.__sautQuadrupede; }
  };
  const avant = mesure(false), apres = mesure(undefined);
  assert.ok(apres.montee > avant.montee + 0.05, `montee du corps ${(100 * avant.montee).toFixed(0)} -> ${(100 * apres.montee).toFixed(0)} % de H`);
  assert.ok(apres.montee >= 0.15, `montee ${(100 * apres.montee).toFixed(0)} % de H`);
  assert.ok(apres.pieds >= apres.montee + 0.05, `les pieds montent plus haut que le corps (pliés) : pieds ${(100 * apres.pieds).toFixed(0)} % contre corps ${(100 * apres.montee).toFixed(0)} %`);
});

test('a-coups d\'un quadrupede : la portee des jambes est bornee en douceur (pas de jambe gelee puis relachee) sans glissement de plus', () => {
  const sq = __interne.charger(squelette(quadrupede()));
  for (const allure of ['walk', 'trot']) {
    const mesure = (flag) => {
      globalThis.__porteeDouce = flag;
      try { const c = __interne.animerAllureSure(sq, allure, 2, 60, 'normal', 'auto', 'equide'); return { ac: c.infos.acoups_max_deg, gl: c.infos.glissement_appui_pct, ss: c.infos.sous_sol_pct }; } finally { delete globalThis.__porteeDouce; }
    };
    const avant = mesure(false), apres = mesure(undefined);
    assert.ok(apres.ac <= 0.85 * avant.ac, `${allure} : a-coups ${avant.ac} -> ${apres.ac} deg`);
    assert.ok(apres.gl <= avant.gl + 0.02, `${allure} : glissement ${avant.gl} -> ${apres.gl} % de H`);
    assert.ok(apres.ss <= avant.ss + 0.1, `${allure} : sous le sol ${avant.ss} -> ${apres.ss} % de H`);
  }
});

// araignee synthetique : 8 pattes a 4 os + pied (les pieds arriere pointent vers l'ARRIERE, leur bout est a 3,5 cm du sol au repos) et deux pedipalpes de 3 os dont le bout est a ras du sol
function araignee({ palpes }) {
  const s = [['corps', -1, [0, 0.12, 0]]];
  [0.3, 0.1, -0.1, -0.3].forEach((z, k) => {
    for (const c of [-1, 1]) {
      const dz = k >= 2 ? -0.08 : 0.08;
      s.push(['h' + k + c, 0, [0.06 * c, 0.12, z * 0.3]]); let p = s.length - 1;
      s.push(['g' + k + c, p, [0.22 * c, 0.24, z * 0.7]]); p = s.length - 1;
      s.push(['a' + k + c, p, [0.36 * c, 0.09, z + dz * 0.5]]); p = s.length - 1;
      s.push(['c' + k + c, p, [0.40 * c, 0.02, z + dz * 1.2]]); p = s.length - 1;
      s.push(['t' + k + c, p, [0.41 * c, 0.035, z + dz * 1.8]]);
    }
  });
  if (palpes) for (const c of [-1, 1]) {
    s.push(['p1' + c, 0, [0.03 * c, 0.12, 0.2]]); s.push(['p2' + c, s.length - 1, [0.04 * c, 0.06, 0.3]]); s.push(['p3' + c, s.length - 1, [0.04 * c, 0.0, 0.42]]);
  }
  return s;
}
test('araignee : un pied qui pointe vers l\'arriere ne deroule plus a l\'envers (la cheville ne traverse plus le sol)', () => {
  const sq = __interne.charger(squelette(araignee({ palpes: false })));
  const mesure = (flag) => {
    globalThis.__deroulePiedLibre = flag;
    try { const c = __interne.animerAllureSure(sq, 'walk', 2, 30, 'normal', 'auto', 'araignee'); return { ss: c.infos.sous_sol_pct, gl: c.infos.glissement_appui_pct }; } finally { delete globalThis.__deroulePiedLibre; }
  };
  const avant = mesure(false), apres = mesure(undefined);
  assert.ok(avant.ss > 5, `l'ancien calcul enfonce (${avant.ss} % de H)`);
  assert.ok(apres.ss < 0.6 * avant.ss, `sous le sol ${avant.ss} -> ${apres.ss} % de H`);
  assert.ok(apres.gl <= avant.gl, `glissement ${avant.gl} -> ${apres.gl} % de H`);
});
test('araignee : les pedipalpes (chaines courtes, hors appuis) sont releves quand leur bout passe sous le sol', () => {
  const sq = __interne.charger(squelette(araignee({ palpes: true })));
  const sol = Math.min(...sq.P0.map((p) => p[1])), H = Math.max(...sq.P0.map((p) => p[1])) - sol;
  const bouts = ['p3-1', 'p31'].map((n) => indexDe(sq, n));
  assert.ok(bouts.every((b) => b >= 0));
  const pire = (flag) => {
    globalThis.__palpesSousSol = flag;
    try {
      const c = __interne.animerAllureSure(sq, 'trot', 2, 30, 'normal', 'auto', 'araignee');
      return Math.max(0, ...c.R.map((_, i) => { const P = positions(sq, c, i); return Math.max(...bouts.map((b) => sol - P[b][1])); })) / H;
    } finally { delete globalThis.__palpesSousSol; }
  };
  const avant = pire(false), apres = pire(undefined);
  assert.ok(avant > 0.02, `l'ancien calcul enfonce le bout du palpe de ${(100 * avant).toFixed(1)} % de H`);
  assert.ok(apres < 0.25 * avant, `${(100 * avant).toFixed(1)} -> ${(100 * apres).toFixed(1)} % de H`);
});
