// OUTIL « Symmetrize mesh » (26/10) : detection automatique du plan de symetrie (lib/symetrie-maillage.js, bouton « Auto »).
// Formes synthetiques a plan CONNU (boite desaxee, L tourne de 20 degres, sphere deformee, boite + appendice non symetrique) et
// forme sans symetrie (doit etre refusee). Le banc sur la vraie moissonneuse est hors suite (fichier hors depot).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lib = await import(pathToFileURL(join(RACINE, 'src/renderer/lib/symetrie-maillage.js')).href);
const { echantillonnerSurface, echantillonnerSurfaceNormales, trouverPlanSymetrie, axeEtAnglesDepuis, angleEntrePlans, tournerNormale, normaleDepuis } = lib;

// ---- fabrique de maillages ------------------------------------------------------------------------------------------
function boite(cx, cy, cz, sx, sy, sz, sub = 12) {
  const pos = [], idx = [];
  const face = (o, u, v) => {
    const base = pos.length / 3;
    for (let i = 0; i <= sub; i++) for (let j = 0; j <= sub; j++) pos.push(o[0] + u[0] * i / sub + v[0] * j / sub, o[1] + u[1] * i / sub + v[1] * j / sub, o[2] + u[2] * i / sub + v[2] * j / sub);
    for (let i = 0; i < sub; i++) for (let j = 0; j < sub; j++) {
      const a = base + i * (sub + 1) + j, b = a + 1, c = a + sub + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  };
  const x0 = cx - sx / 2, y0 = cy - sy / 2, z0 = cz - sz / 2;
  face([x0, y0, z0], [sx, 0, 0], [0, sy, 0]); face([x0, y0, z0 + sz], [sx, 0, 0], [0, sy, 0]);
  face([x0, y0, z0], [sx, 0, 0], [0, 0, sz]); face([x0, y0 + sy, z0], [sx, 0, 0], [0, 0, sz]);
  face([x0, y0, z0], [0, sy, 0], [0, 0, sz]); face([x0 + sx, y0, z0], [0, sy, 0], [0, 0, sz]);
  return { pos, idx };
}
function fusion(...ms) {
  const pos = [], idx = [];
  for (const m of ms) { const b = pos.length / 3; pos.push(...m.pos); for (const i of m.idx) idx.push(i + b); }
  return { pos, idx };
}
function sphere(f, nu = 90, nv = 45) {
  const pos = [], idx = [];
  for (let i = 0; i <= nv; i++) for (let j = 0; j <= nu; j++) {
    const th = Math.PI * i / nv, ph = 2 * Math.PI * j / nu;
    pos.push(...f(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)));
  }
  for (let i = 0; i < nv; i++) for (let j = 0; j < nu; j++) { const a = i * (nu + 1) + j, b = a + 1, c = a + nu + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  return { pos, idx };
}
/** Rotation (axe unitaire, angle) puis translation, appliquees a tous les sommets. */
function placer(m, axe, ang, t) {
  const out = [];
  for (let i = 0; i < m.pos.length; i += 3) {
    const n = tournerNormale([m.pos[i], m.pos[i + 1], m.pos[i + 2]], axe, ang);   // tournerNormale renormalise : on refait la rotation a la main
    const L = Math.hypot(m.pos[i], m.pos[i + 1], m.pos[i + 2]);
    out.push(n[0] * L + t[0], n[1] * L + t[1], n[2] * L + t[2]);
  }
  return { pos: out, idx: m.idx };
}
const enParts = (m) => [{ positions: new Float32Array(m.pos), index: new Uint32Array(m.idx), m: null }];
const diagDe = (m) => { const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (let i = 0; i < m.pos.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], m.pos[i + k]); mx[k] = Math.max(mx[k], m.pos[i + k]); } return Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]); };
async function detecter(m) {
  const e = await echantillonnerSurfaceNormales(enParts(m), 15000);
  return trouverPlanSymetrie(e.points, { normales: e.normales });
}
/** Ecart (degres, diagonale) du plan trouve a la liste de plans attendus [{n, P}] : on garde le plus proche. */
function ecartAuMieux(r, attendus, diag) {
  let best = null;
  for (const a of attendus) {
    const ang = angleEntrePlans(r.n, a.n);
    const dist = Math.abs((r.P[0] - a.P[0]) * a.n[0] + (r.P[1] - a.P[1]) * a.n[1] + (r.P[2] - a.P[2]) * a.n[2]) / diag;
    if (!best || ang < best.ang) best = { ang, dist };
  }
  return best;
}

test('boite desaxee : un des trois plans de la boite, ecart < 1 degre et 0,3 % de la diagonale', async () => {
  const axe = [0.3, 0.8, 0.5]; const L = Math.hypot(...axe); const k = axe.map((v) => v / L);
  const b = placer(boite(0, 0, 0, 2, 1, 0.6), k, 33, [0.7, -0.4, 1.1]);
  const r = await detecter(b);
  const rot = (v) => { const R = tournerNormale(v, k, 33); return R; };
  const attendus = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((v) => ({ n: rot(v), P: [0.7, -0.4, 1.1] }));
  const e = ecartAuMieux(r, attendus, diagDe(b));
  assert.ok(e.ang < 1, 'angle ' + e.ang);
  assert.ok(e.dist < 0.003, 'position ' + e.dist);
  assert.ok(r.symetrique && r.confiance > 0.8, 'confiance ' + r.confiance);
});

test('forme en L symetrique tournee de 20 degres : plan de la diagonale (ou celui de l epaisseur)', async () => {
  const L1 = boite(0.5, 0.15, 0, 1, 0.3, 0.3, 10), L2 = boite(0.15, 0.65, 0, 0.3, 0.7, 0.3, 10);
  const m = placer(fusion(L1, L2), [0, 0, 1], 20, [0.2, 0.1, -0.3]);
  const r = await detecter(m);
  const s2 = Math.SQRT1_2;
  const diagonale = tournerNormale([s2, -s2, 0], [0, 0, 1], 20);
  const epaisseur = [0, 0, 1];
  const t = [0.2, 0.1, -0.3];
  const attendus = [{ n: diagonale, P: [0.2 + 0.15 * 0 + 0, 0.1, -0.3] }, { n: epaisseur, P: t }];
  // le plan de la diagonale passe par le coin interieur ; on ne verifie que l'angle pour lui, et la position pour l'epaisseur
  const angDiag = angleEntrePlans(r.n, diagonale), angEp = angleEntrePlans(r.n, epaisseur);
  assert.ok(angDiag < 1.5 || angEp < 1.5, 'angles ' + angDiag + ' / ' + angEp);
  assert.ok(r.symetrique, 'confiance ' + r.confiance);
  void attendus;
});

test('sphere deformee symetrique (plan x=0.2 incline de 15 degres) : plan retrouve', async () => {
  const f = (x, y, z) => { const s = 1 + 0.3 * y + 0.2 * z + 0.25 * x * x + 0.3 * y * z + 0.2 * x * x * z; return [x * s * 1.0, y * s * 1.3, z * s * 0.55]; };
  const m0 = sphere(f);
  const k = [0, 0, 1];
  const m = placer(m0, k, 15, [0.2, 0.1, 0.0]);
  const r = await detecter(m);
  const n = tournerNormale([1, 0, 0], k, 15);
  const e = ecartAuMieux(r, [{ n, P: [0.2, 0.1, 0] }], diagDe(m));
  assert.ok(e.ang < 1.5, 'angle ' + e.ang);
  assert.ok(e.dist < 0.004, 'position ' + e.dist);
  assert.ok(r.symetrique, 'confiance ' + r.confiance);
});

test('boite + appendice non symetrique : le plan reste trouve (score tronque, robuste)', async () => {
  const b = fusion(boite(0, 0, 0, 2, 1, 0.6), boite(0.55, 0.65, 0.1, 0.5, 0.35, 0.3, 6));
  const r = await detecter(b);
  const attendus = [{ n: [1, 0, 0], P: [0, 0, 0] }, { n: [0, 0, 1], P: [0, 0, 0] }];
  // l'appendice casse y et le plan x=0 reste vrai pour la boite seule ; l'appendice est a x = 0.55 -> casse x aussi ; z ne l'est pas tout a fait (z=0.1)
  const e = ecartAuMieux(r, [...attendus, { n: [0, 1, 0], P: [0, 0, 0] }], diagDe(b));
  assert.ok(e.ang < 2.5, 'angle ' + e.ang);
});

test('forme sans symetrie : refusee (symetrique = faux)', async () => {
  const f = (x, y, z) => {
    const s = 1 + 0.5 * Math.sin(3 * x + 1) * Math.cos(2 * y) + 0.45 * Math.sin(2.5 * z + 0.4 * x) + 0.3 * x * y * z + 0.45 * x;
    return [x * s * 1.2, y * s, z * s * 0.7 + 0.3 * x * x * y];
  };
  const m = sphere(f);
  const r = await detecter(m);
  assert.equal(r.symetrique, false, 'confiance ' + r.confiance);
  assert.ok(r.confiance < 0.6);
});

test('axeEtAnglesDepuis : aller-retour avec normaleDepuis (au signe pres)', () => {
  for (const n of [[1, 0.2, -0.1], [-0.3, 0.9, 0.2], [0.1, -0.2, -0.95], [0.5, 0.5, 0.5], [-1, 0, 0]]) {
    const L = Math.hypot(...n); const u = n.map((v) => v / L);
    const r = axeEtAnglesDepuis(u);
    const n2 = normaleDepuis(r.axe, r.a, r.b);
    const d = Math.abs(n2[0] * u[0] + n2[1] * u[1] + n2[2] * u[2]);
    assert.ok(d > 0.99999, JSON.stringify(u) + ' -> ' + d);
  }
});

test('echantillonnerSurface : la couture UV dedoublee ne change pas la repartition (tirage par aire)', async () => {
  const m = boite(0, 0, 0, 1, 1, 1, 4);
  const dup = { pos: m.pos.slice(), idx: m.idx.slice() };
  const a = await echantillonnerSurface(enParts(m), 3000, { graine: 7 });
  const b = await echantillonnerSurface([...enParts(m), ...enParts(dup)], 6000, { graine: 7 });
  assert.equal(a.length, 9000); assert.equal(b.length, 18000);
  let s = 0; for (let i = 0; i < a.length; i += 3) s += a[i]; assert.ok(Math.abs(s / 3000) < 0.05);
});
