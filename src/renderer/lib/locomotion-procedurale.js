// Moteur de marche PROCÉDURAL (sans IA, sans données d'animation) pour un squelette quelconque.
// Portage JavaScript de la référence Python validée par l'exploitant le 28/09/2026
// (C:\tmp\procedural_test\locomotion.py + ik_forme.py, branche backup-moteur-procedural-20260928-162700).
// Module autonome, sans dépendance : même fichier sur le bureau et sur le web.
//
//   import { animerGLB, ALLURES } from './locomotion-procedurale.js';
//   const { glb, infos } = animerGLB(arrayBufferDuRig, { allures: ['walk', 'run', 'idle'] });
//
// Repère glTF de nos rigs : Y en haut, face +Z, +X = gauche.

export const ALLURES = {
  // beta : part du cycle au sol ; T : période (<= 4 pattes, 6 et plus) ; h : hauteur de pas ;
  // bob : balancement vertical ; foulee : longueur relative ; lacet : rad/s (+ = vers la gauche) ;
  // tendu : extension des pattes au neutre (bassin abaissé d'autant) ; talon : déroulé du pied
  walk: { beta: 0.65, T: [1.1, 0.7], h: 0.22, bob: 0.035, foulee: 1.0, lacet: 0.0, tendu: 0.965, talon: 0.5, pas: true },
  run: { beta: 0.38, T: [0.62, 0.42], h: 0.22, bob: 0.035, foulee: 1.8, lacet: 0.0, tendu: 0.87, talon: 0.7, pas: true },
  turn_left: { beta: 0.65, T: [1.1, 0.7], h: 0.2, bob: 0.02, foulee: 0.55, lacet: 0.55, tendu: 0.92, talon: 0.35, pas: true },
  turn_right: { beta: 0.65, T: [1.1, 0.7], h: 0.2, bob: 0.02, foulee: 0.55, lacet: -0.55, tendu: 0.92, talon: 0.35, pas: true },
  idle: { beta: 1.0, T: [4.0, 4.0], h: 0.0, bob: 0.008, foulee: 0.0, lacet: 0.0, tendu: 0.95, talon: 0.0, pas: false },
};

// ------------------------------------------------------------------ vecteurs et matrices 3x3
// vecteur = [x, y, z] ; matrice = 9 nombres, lignes d'abord
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mulS = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const I3 = () => [1, 0, 0, 0, 1, 0, 0, 0, 1];
const mm = (A, B) => {
  const C = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[3 * i + j] = A[3 * i] * B[j] + A[3 * i + 1] * B[3 + j] + A[3 * i + 2] * B[6 + j];
  return C;
};
const mv = (A, v) => [A[0] * v[0] + A[1] * v[1] + A[2] * v[2], A[3] * v[0] + A[4] * v[1] + A[5] * v[2], A[6] * v[0] + A[7] * v[1] + A[8] * v[2]];
const tr = (A) => [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]];
const Rx = (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };
const Ry = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
const Rz = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
function rotvec(axe, ang) {                                   // Rodrigues
  const n = norm(axe);
  if (n < 1e-12 || Math.abs(ang) < 1e-15) return I3();
  const [x, y, z] = mulS(axe, 1 / n), c = Math.cos(ang), s = Math.sin(ang), C = 1 - c;
  return [c + x * x * C, x * y * C - z * s, x * z * C + y * s,
    y * x * C + z * s, c + y * y * C, y * z * C - x * s,
    z * x * C - y * s, z * y * C + x * s, c + z * z * C];
}
function aligner(a, b) {                                      // rotation minimale a -> b
  a = mulS(a, 1 / (norm(a) + 1e-12));
  b = mulS(b, 1 / (norm(b) + 1e-12));
  const v = cross(a, b), c = dot(a, b);
  if (c < -0.999999) {
    const axe = Math.abs(a[0]) < 0.9 ? cross(a, [1, 0, 0]) : cross(a, [0, 1, 0]);
    return rotvec(axe, Math.PI);
  }
  const K = [0, -v[2], v[1], v[2], 0, -v[0], -v[1], v[0], 0];
  const K2 = mm(K, K), f = 1 / (1 + c);
  return I3().map((e, i) => e + K[i] + K2[i] * f);
}
function orthonormer(M) {                                     // rotation la plus proche (décomposition polaire)
  let R = M.slice();
  for (let it = 0; it < 30; it++) {
    const det = R[0] * (R[4] * R[8] - R[5] * R[7]) - R[1] * (R[3] * R[8] - R[5] * R[6]) + R[2] * (R[3] * R[7] - R[4] * R[6]);
    if (Math.abs(det) < 1e-12) break;
    const inv = [(R[4] * R[8] - R[5] * R[7]) / det, (R[2] * R[7] - R[1] * R[8]) / det, (R[1] * R[5] - R[2] * R[4]) / det,
      (R[5] * R[6] - R[3] * R[8]) / det, (R[0] * R[8] - R[2] * R[6]) / det, (R[2] * R[3] - R[0] * R[5]) / det,
      (R[3] * R[7] - R[4] * R[6]) / det, (R[1] * R[6] - R[0] * R[7]) / det, (R[0] * R[4] - R[1] * R[3]) / det];
    const it_ = tr(inv), N = R.map((e, i) => 0.5 * (e + it_[i]));
    let d = 0;
    for (let i = 0; i < 9; i++) d = Math.max(d, Math.abs(N[i] - R[i]));
    R = N;
    if (d < 1e-12) break;
  }
  return R;
}
function quatDeMatrice(m) {                                   // [x, y, z, w]
  const t = m[0] + m[4] + m[8];
  let x, y, z, w;
  if (t > 0) {
    const s = Math.sqrt(t + 1) * 2;
    w = 0.25 * s; x = (m[7] - m[5]) / s; y = (m[2] - m[6]) / s; z = (m[3] - m[1]) / s;
  } else if (m[0] > m[4] && m[0] > m[8]) {
    const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2;
    w = (m[7] - m[5]) / s; x = 0.25 * s; y = (m[1] + m[3]) / s; z = (m[2] + m[6]) / s;
  } else if (m[4] > m[8]) {
    const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2;
    w = (m[2] - m[6]) / s; x = (m[1] + m[3]) / s; y = 0.25 * s; z = (m[5] + m[7]) / s;
  } else {
    const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2;
    w = (m[3] - m[1]) / s; x = (m[2] + m[6]) / s; y = (m[5] + m[7]) / s; z = 0.25 * s;
  }
  const n = Math.hypot(x, y, z, w);
  return [x / n, y / n, z / n, w / n];
}
const angleRot = (m) => Math.acos(Math.max(-1, Math.min(1, (m[0] + m[4] + m[8] - 1) / 2)));
const median = (a) => { const s = [...a].sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : 0.5 * (s[n / 2 - 1] + s[n / 2]); };
const moyenne = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const clip = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const longueurChaine = (P) => { let L = 0; for (let k = 1; k < P.length; k++) L += norm(sub(P[k], P[k - 1])); return L; };

// ------------------------------------------------------------------ lecture / écriture GLB
function lireGLB(buffer) {
  const dv = new DataView(buffer);
  if (dv.getUint32(0, true) !== 0x46546C67) throw new Error('pas un GLB');
  let off = 12, json = null, bin = new Uint8Array(0);
  while (off < buffer.byteLength) {
    const n = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
    const bloc = new Uint8Array(buffer, off + 8, n);
    if (type === 0x4E4F534A) json = JSON.parse(new TextDecoder().decode(bloc));
    else if (type === 0x004E4942) bin = bloc.slice();
    off += 8 + n;
  }
  return { json, bin };
}
// matrice 4x4 lignes d'abord ; nœud glTF : `matrix` (colonnes d'abord) ou T * R * S
function matriceLocale(n) {
  if (n.matrix) { const m = n.matrix; return [m[0], m[4], m[8], m[12], m[1], m[5], m[9], m[13], m[2], m[6], m[10], m[14], m[3], m[7], m[11], m[15]]; }
  const [x, y, z, w] = n.rotation || [0, 0, 0, 1], [sx, sy, sz] = n.scale || [1, 1, 1], [tx, ty, tz] = n.translation || [0, 0, 0];
  const R = [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
  return [R[0] * sx, R[1] * sy, R[2] * sz, tx, R[3] * sx, R[4] * sy, R[5] * sz, ty, R[6] * sx, R[7] * sy, R[8] * sz, tz, 0, 0, 0, 1];
}
const mm4 = (A, B) => {
  const C = new Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += A[4 * i + k] * B[4 * k + j]; C[4 * i + j] = s; }
  return C;
};
function matricesMonde(json) {
  const noeuds = json.nodes, parent = new Map(), W = new Map();
  noeuds.forEach((n, i) => (n.children || []).forEach((c) => parent.set(c, i)));
  const w = (i) => {
    if (!W.has(i)) { const M = matriceLocale(noeuds[i]); W.set(i, parent.has(i) ? mm4(w(parent.get(i)), M) : M); }
    return W.get(i);
  };
  noeuds.forEach((_, i) => w(i));
  return { W, parent };
}
const rot4 = (M) => [M[0], M[1], M[2], M[4], M[5], M[6], M[8], M[9], M[10]];
const pos4 = (M) => [M[3], M[7], M[11]];
function inv4(m) {                                            // inverse d'une matrice affine 4x4
  const R = rot4(m), t = pos4(m);
  const det = R[0] * (R[4] * R[8] - R[5] * R[7]) - R[1] * (R[3] * R[8] - R[5] * R[6]) + R[2] * (R[3] * R[7] - R[4] * R[6]);
  const Ri = [(R[4] * R[8] - R[5] * R[7]) / det, (R[2] * R[7] - R[1] * R[8]) / det, (R[1] * R[5] - R[2] * R[4]) / det,
    (R[5] * R[6] - R[3] * R[8]) / det, (R[0] * R[8] - R[2] * R[6]) / det, (R[2] * R[3] - R[0] * R[5]) / det,
    (R[3] * R[7] - R[4] * R[6]) / det, (R[1] * R[6] - R[0] * R[7]) / det, (R[0] * R[4] - R[1] * R[3]) / det];
  const ti = mulS(mv(Ri, t), -1);
  return [Ri[0], Ri[1], Ri[2], ti[0], Ri[3], Ri[4], Ri[5], ti[1], Ri[6], Ri[7], Ri[8], ti[2], 0, 0, 0, 1];
}

function charger(buffer) {
  const { json, bin } = lireGLB(buffer);
  if (!json.skins || !json.skins.length) throw new Error('ce modèle n\'a pas de squelette');
  const joints = json.skins[0].joints.slice();
  const { W, parent } = matricesMonde(json);
  const ens = new Set(joints), idx = new Map(joints.map((n, i) => [n, i]));
  const par = joints.map((n) => {
    let p = parent.get(n);
    while (p !== undefined && !ens.has(p)) p = parent.get(p);
    return p !== undefined ? idx.get(p) : -1;
  });
  const P0 = joints.map((n) => pos4(W.get(n)));
  return { json, bin, joints, par, P0, W, parent };
}

// ------------------------------------------------------------------ squelette
const enfantsDe = (par) => { const E = par.map(() => []); par.forEach((p, j) => { if (p >= 0) E[p].push(j); }); return E; };
function sousArbre(E, j) { const pile = [j], out = []; while (pile.length) { const k = pile.pop(); out.push(k); pile.push(...E[k]); } return out; }
const ptpAxe = (P, a) => Math.max(...P.map((p) => p[a])) - Math.min(...P.map((p) => p[a]));
const etendue = (P) => Math.max(ptpAxe(P, 0), ptpAxe(P, 1), ptpAxe(P, 2));

function detecterPattes(par, P0) {
  const E = enfantsDe(par), J = par.length;
  const racine = par.indexOf(-1);
  const sol = Math.min(...P0.map((p) => p[1])), H = ptpAxe(P0, 1), ext = etendue(P0);
  const x0 = median(P0.map((p) => p[0]));                    // axe médian du corps
  const feuilles = [];
  for (let j = 0; j < J; j++) if (!E[j].length) feuilles.push(j);
  const prof = par.map((_, j) => { let k = j, n = 0; while (par[k] >= 0) { k = par[k]; n++; } return n; });
  const chemin = (j) => { const c = []; while (j >= 0) { c.push(j); j = par[j]; } return c.reverse(); };
  const ancetre = (a, b) => { const ca = chemin(a), cb = chemin(b); let k = 0; while (k < Math.min(ca.length, cb.length) && ca[k] === cb[k]) k++; return ca[k - 1]; };

  let bas = feuilles.filter((j) => P0[j][1] - sol < 0.2 * H);
  // patte LEVÉE au repos (pattes arrière de l'araignée à 26-28 % de la hauteur)
  const levees = new Set(feuilles.filter((j) => P0[j][1] - sol >= 0.2 * H && P0[j][1] - sol < 0.45 * H && Math.abs(P0[j][0] - x0) > 0.1 * ext));
  bas = bas.concat([...levees].sort((a, b) => a - b));
  // queue posée au sol : bout central ET derrière la hanche -> pas une patte
  bas = bas.filter((j) => !(Math.abs(P0[j][0] - x0) < 0.01 * ext && P0[j][2] < P0[racine][2] - 0.1 * ext));
  // pieds : feuilles au sol dont l'ancêtre commun est à 2 os au plus (orteils d'un même pied)
  const grappes = [];
  for (const j of [...bas].sort((a, b) => P0[a][1] - P0[b][1])) {
    const g = grappes.find((g_) => { const a = ancetre(j, g_[0]); return prof[j] - prof[a] <= 2 && prof[g_[0]] - prof[a] <= 2; });
    if (g) g.push(j); else grappes.push([j]);
  }
  const feuilleGrappe = new Map();
  grappes.forEach((g, gi) => g.forEach((j) => feuilleGrappe.set(j, gi)));
  const grappesSous = (j) => new Set(sousArbre(E, j).filter((k) => feuilleGrappe.has(k)).map((k) => feuilleGrappe.get(k)));

  let pattes = [];
  grappes.forEach((g, gi) => {
    let bout = g[0];
    for (const f of g.slice(1)) bout = ancetre(bout, f);    // la cheville si plusieurs orteils
    let haut = bout;
    while (par[haut] >= 0 && par[haut] !== racine) {
      const gs = grappesSous(par[haut]);
      if (gs.size !== 1 || !gs.has(gi)) break;
      haut = par[haut];
    }
    const chaine = [];
    for (let k = bout; ; k = par[k]) { chaine.push(k); if (k === haut) break; }
    chaine.reverse();
    if (chaine.length < 2) return;
    const toutesLevees = g.every((f) => levees.has(f));
    if (toutesLevees && (chaine.length < 3 || P0[bout][1] >= P0[chaine[1]][1])) return;
    pattes.push({ chaine, bout, levee: toutesLevees, dx: (P0[bout][0] + P0[chaine[0]][0]) / 2 - x0 });
  });
  const longueur = (q) => longueurChaine(q.chaine.map((k) => P0[k]));
  const ref = pattes.filter((q) => !q.levee).map(longueur);
  if (ref.length) { const m = median(ref); pattes = pattes.filter((q) => !q.levee || longueur(q) >= 0.6 * m); }
  // côté (+X = gauche) ; patte presque centrale (lion étroit) : l'opposé de sa voisine en Z
  for (const p of pattes) p.cote = Math.abs(p.dx) > 0.01 * ext ? Math.sign(p.dx) : 0;
  for (const p of pattes) {
    if (p.cote !== 0) continue;
    const autres = pattes.filter((q) => q !== p);
    if (autres.length) {
      const v = autres.reduce((m, q) => (Math.abs(P0[q.bout][2] - P0[p.bout][2]) < Math.abs(P0[m.bout][2] - P0[p.bout][2]) ? q : m));
      p.cote = v.cote ? -v.cote : (p.dx >= v.dx ? 1 : -1);
    } else p.cote = 1;
  }
  // queue et tête : chaînes centrales issues du tronc
  const dansPattes = new Set(pattes.flatMap((p) => p.chaine));
  const sousPattes = new Set(pattes.flatMap((p) => sousArbre(E, p.chaine[0])));
  const autres = [];
  for (const f of feuilles) {
    if (dansPattes.has(f) || sousPattes.has(f)) continue;
    const c = [];
    let k = f;
    while (k >= 0 && !dansPattes.has(k) && k !== racine && E[par[k]].length === 1) { c.push(k); k = par[k]; }
    if (k >= 0 && k !== racine && !dansPattes.has(k)) c.push(k);
    c.reverse();
    if (c.length >= 2) autres.push(c);
  }
  const queues = autres.filter((c) => P0[c[c.length - 1]][2] < P0[racine][2] && Math.abs(P0[c[c.length - 1]][0] - x0) < 0.05 * ext);
  const tetes = autres.filter((c) => P0[c[c.length - 1]][2] > P0[racine][2] && Math.abs(P0[c[c.length - 1]][0] - x0) < 0.05 * ext);
  return { racine, pattes, queues, tetes, sol };
}

function phases(pattes, P0, allure) {
  for (const cote of [1, -1]) {
    const cc = pattes.filter((p) => p.cote === cote).sort((a, b) => P0[b.bout][2] - P0[a.bout][2]);
    cc.forEach((p, k) => { p.rang = k; p.nbCote = cc.length; });
  }
  const n = pattes.length;
  for (const p of pattes) {
    const s = p.cote === 1 ? 0 : 1;
    if (n <= 2) p.phase = 0.5 * s;
    else if (n <= 4 && p.nbCote === 2 && allure !== 'run') p.phase = 0.5 * s + (p.rang === 0 ? 0.25 : 0.0);   // pas latéral
    else {
      const onde = allure !== 'run' ? 0.06 : 0.0;             // trépied / tétrapode alterné (+ onde)
      p.phase = (((0.5 * ((p.rang + s) % 2) + onde * (p.nbCote - 1 - p.rang)) % 1) + 1) % 1;
    }
  }
}

// ------------------------------------------------------------------ cinématique inverse à forme gardée
// La patte garde la FORME de sa pose de repos (zigzag, sens de pliure) : toutes ses pliures sont
// multipliées par un même facteur k pour atteindre la cible, puis la patte entière est orientée.
// FABRIK (sans contrainte) faisait dériver la pliure : genoux de côté, pattes retournées de 138°.
function preparerForme(P, pole) {
  const a = P[0], b = P[P.length - 1];
  const e1 = mulS(sub(b, a), 1 / (norm(sub(b, a)) + 1e-12));
  let e2 = sub(pole, mulS(e1, dot(pole, e1)));
  if (norm(e2) < 1e-6) e2 = Math.abs(e1[0]) < 0.9 ? cross(e1, [1, 0, 0]) : cross(e1, [0, 1, 0]);
  e2 = mulS(e2, 1 / norm(e2));
  const e3 = cross(e1, e2), l = [], z = [];
  let phi = [];
  for (let k = 1; k < P.length; k++) {
    const v = sub(P[k], P[k - 1]), x = dot(v, e1), y = dot(v, e2);
    l.push(Math.hypot(x, y)); phi.push(Math.atan2(y, x)); z.push(dot(v, e3));
  }
  if (Math.max(...phi.map(Math.abs)) < 0.05 && phi.length >= 2) phi = phi.map((_, k) => (k % 2 === 0 ? 0.08 : -0.08));
  return { l, phi, z };
}
function chaineLocale(F, k) {
  const C = [[0, 0, 0]];
  for (let i = 0; i < F.l.length; i++) {
    const a = k * F.phi[i], p = C[C.length - 1];
    C.push([p[0] + F.l[i] * Math.cos(a), p[1] + F.l[i] * Math.sin(a), p[2] + F.z[i]]);
  }
  return C;
}
function resoudreForme(F, base, cible, poleMonde) {
  const d = norm(sub(cible, base));
  let kmax = Math.min(0.9 * Math.PI / Math.max(Math.max(...F.phi.map(Math.abs)), 1e-3), 8.0);
  const longueur = (k) => { const C = chaineLocale(F, k); return norm(C[C.length - 1]); };
  // au-delà d'un certain repli la patte se RALLONGE : recherche arrêtée au minimum de longueur
  let kmin = 0, lmin = Infinity;
  for (let i = 0; i <= 64; i++) { const k = kmax * i / 64, L = longueur(k); if (L < lmin) { lmin = L; kmin = k; } }
  kmax = kmin;
  let k;
  if (d >= longueur(0)) k = 0;
  else if (d <= longueur(kmax)) k = kmax;
  else {
    let lo = 0, hi = kmax;
    for (let it = 0; it < 40; it++) { const m = 0.5 * (lo + hi); if (longueur(m) > d) lo = m; else hi = m; }
    k = 0.5 * (lo + hi);
  }
  const C = chaineLocale(F, k), fin = C[C.length - 1];
  const g1 = mulS(fin, 1 / (norm(fin) + 1e-12));
  let g2 = sub([0, 1, 0], mulS(g1, g1[1]));
  g2 = mulS(g2, 1 / (norm(g2) + 1e-12));
  const g3 = cross(g1, g2);
  const f1 = mulS(sub(cible, base), 1 / (d + 1e-12));
  let f2 = sub(poleMonde, mulS(f1, dot(poleMonde, f1)));
  f2 = norm(f2) < 1e-6 ? g2 : mulS(f2, 1 / norm(f2));
  const f3 = cross(f1, f2);
  // M = [f1 f2 f3] (colonnes) · [g1; g2; g3] (lignes)
  const M = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[3 * i + j] = f1[i] * g1[j] + f2[i] * g2[j] + f3[i] * g3[j];
  return C.map((p) => add(base, mv(M, p)));
}

// ------------------------------------------------------------------ animation d'une allure
function animerAllure(sq, allure, cycles, fps) {
  const { joints, par, P0 } = sq;
  const det = detecterPattes(par, P0);
  const { racine, queues, tetes, sol } = det;
  let pattes = det.pattes.map((p) => ({ ...p }));
  if (!pattes.length) throw new Error('aucune patte détectée sur ce squelette');
  let palpes = [];
  if (pattes.length >= 6) {                                   // pédipalpes : « pattes » bien plus courtes
    const lg = pattes.map((q) => longueurChaine(q.chaine.map((k) => P0[k]))), med = median(lg);
    palpes = pattes.filter((_, i) => lg[i] < 0.65 * med);
    pattes = pattes.filter((_, i) => lg[i] >= 0.65 * med);
  }
  phases(pattes, P0, allure);
  const A = ALLURES[allure];
  const nombreux = pattes.length >= 6, bipede = pattes.length <= 2;
  const T = A.T[nombreux ? 1 : 0];
  let beta = nombreux && allure !== 'run' && A.pas ? 0.55 : A.beta;
  if (bipede && A.pas && allure !== 'run') beta = 0.6;
  const H = ptpAxe(P0, 1), E = enfantsDe(par);

  // --- géométrie de chaque patte : chaîne IK, pied rigide, point neutre, sens de pliure
  for (const p of pattes) {
    const ch = p.chaine;
    const seg = [];
    for (let k = 1; k < ch.length; k++) seg.push(norm(sub(P0[ch[k]], P0[ch[k - 1]])));
    const piedCourt = ch.length >= 4 && seg[seg.length - 1] < 0.5 * moyenne(seg.slice(0, -1));
    p.ik = piedCourt ? ch.slice(0, -1) : ch;
    p.piedOff = sub(P0[p.bout], P0[p.ik[p.ik.length - 1]]);
    const sous = sousArbre(E, p.bout).filter((k) => !E[k].length && k !== p.bout);
    p.pivotOff = null;
    if (piedCourt) p.pivotOff = [0, 0, 0];                    // la patte pivote sur son bout
    else if (sous.length) {
      const orteil = sous.reduce((m, k) => (P0[k][2] > P0[m][2] ? k : m));
      const off = sub(P0[orteil], P0[p.bout]);
      if (off[2] > 0.05 * longueurChaine(ch.map((k) => P0[k]))) p.pivotOff = off;
    }
    const haut = P0[ch[0]];
    const N = P0[p.bout].slice();
    const d = sub(N, haut);
    const debout = Math.abs(d[1]) > 1.5 * Math.hypot(d[0], d[2]);
    if (debout) N[2] = haut[2] + p.piedOff[2];               // cheville à l'aplomb de la hanche
    const contact = Math.min(...sousArbre(E, p.bout).map((k) => P0[k][1]));
    if (contact - sol > 0.02 * H) N[1] -= contact - sol;     // le point le plus BAS du pied touche le sol
    p.neutre = N;
    const a_ = P0[p.ik[0]], b_ = P0[p.ik[p.ik.length - 1]];
    const u_ = mulS(sub(b_, a_), 1 / (norm(sub(b_, a_)) + 1e-12));
    let pole = [0, 0, 0];
    for (const k of p.ik.slice(1, -1)) { const o = sub(P0[k], a_); pole = add(pole, sub(o, mulS(u_, dot(o, u_)))); }
    if (debout) pole[0] = 0;
    if (norm(pole) < 1e-4) pole = debout ? [0, 0, 1] : [0, 1, 0];
    p.pole = mulS(pole, 1 / norm(pole));
    p.forme = preparerForme(p.ik.map((k) => P0[k]), p.pole);
  }
  const portee = moyenne(pattes.map((p) => norm(sub(p.neutre, P0[p.chaine[0]]))));
  const hanche = moyenne(pattes.map((p) => P0[p.chaine[0]][1] - sol));
  let S = A.foulee * (0.6 * portee + 0.8 * hanche);
  const h = A.h * (0.5 * portee + 0.5 * hanche);
  // patte jamais trop tendue : bassin abaissé (A.tendu au neutre), demi-pas borné à 98 %
  const TENDU_MAX = 0.98;
  const geo = pattes.map((p) => {
    const Lc = longueurChaine(p.ik.map((k) => P0[k]));
    const d = sub(sub(p.neutre, p.piedOff), P0[p.ik[0]]);
    return [Lc, Math.abs(d[0]), -d[1], Math.abs(d[2])];
  });
  let abaisse = 0;
  for (const [Lc, dx, dy, dz] of geo) { const r2 = (A.tendu * Lc) ** 2 - dx * dx - dz * dz; if (r2 > 0) abaisse = Math.max(abaisse, dy - Math.sqrt(r2)); }
  const margeBob = A.bob * hanche * (allure === 'run' ? 2 : -1);
  if (A.pas) {
    const demis = geo.map(([Lc, dx, dy, dz]) => Math.max(Math.sqrt(Math.max((TENDU_MAX * Lc) ** 2 - dx * dx - (dy - abaisse + margeBob) ** 2, 0)) - dz, 0.03 * portee));
    S = Math.min(S, median(demis.map((d_) => 2 * d_ / beta)));
    pattes.forEach((p, i) => { p.beta = clip(2 * demis[i] / S, 0.25, beta); });
  } else pattes.forEach((p) => { p.beta = beta; });
  const v = S / T, w = A.lacet;
  const nT = Math.round(cycles * T * fps), J = joints.length;
  const t = Array.from({ length: nT }, (_, i) => i / fps);
  const centre = P0[racine];

  const cheminCorps = (tt) => {
    const cap = w * tt;
    const c = Math.abs(w) < 1e-9 ? [0, 0, v * tt] : [(v / w) * (1 - Math.cos(cap)), 0, (v / w) * Math.sin(cap)];
    return { c, cap };
  };
  const Rcap = [], cc = [];
  for (const tt of t) { const r = cheminCorps(tt); cc.push(r.c); Rcap.push(Ry(r.cap)); }
  // --- balancement du corps
  const p0 = pattes[0].phase;
  const bob = [], tangage = [], roulis = [], lateral = [], lacetBassin = new Array(nT).fill(0), sG = new Array(nT).fill(0);
  for (let i = 0; i < nT; i++) {
    const x = t[i] / T, onde2 = Math.cos(4 * Math.PI * (x - (beta / 2 - p0)));
    if (!A.pas) {
      bob.push(A.bob * hanche * Math.sin(4 * Math.PI * x)); tangage.push(0.01 * Math.sin(2 * Math.PI * x));
      roulis.push(0.012 * Math.sin(2 * Math.PI * x + 1.0)); lateral.push(0.015 * hanche * Math.sin(2 * Math.PI * x + 1.0));
    } else {
      bob.push(A.bob * hanche * (allure !== 'run' ? onde2 : -onde2));
      tangage.push((allure === 'run' && bipede ? 0.05 : 0.0) + 0.02 * Math.sin(4 * Math.PI * x));
      roulis.push((bipede ? 0.035 : 0.012) * Math.sin(2 * Math.PI * (x + p0 - beta / 2)));
      lateral.push((bipede ? 0.04 * hanche : 0.0) * Math.sin(2 * Math.PI * (x + p0 - beta / 2)));
    }
  }
  // bipède : bassin qui tourne et bascule (calé sur la jambe gauche), épaules en contre-rotation
  if (bipede) {
    const gauche = pattes.find((q) => q.cote === 1) || pattes[0];
    const amp = allure === 'run' ? [0.12, 0.05] : [0.08, 0.06];
    for (let i = 0; i < nT; i++) {
      const x = t[i] / T;
      sG[i] = Math.cos(2 * Math.PI * (x + gauche.phase));
      if (A.pas) {
        lacetBassin[i] = -amp[0] * sG[i];
        roulis[i] = amp[1] * Math.cos(2 * Math.PI * (x + gauche.phase - beta / 2));
        lateral[i] = 0.035 * hanche * Math.cos(2 * Math.PI * (x + gauche.phase - beta / 2));
      }
    }
  }
  const Rb = [], decal = [];
  for (let i = 0; i < nT; i++) {
    Rb.push(mm(mm(mm(Rcap[i], Ry(lacetBassin[i])), Rx(tangage[i])), Rz(roulis[i])));
    decal.push(add(add(cc[i], [0, bob[i] - abaisse, 0]), mv(Rcap[i], [lateral[i], 0, 0])));
  }
  const monde = (i, p) => add(add(centre, decal[i]), mv(Rb[i], sub(p, centre)));
  const appui = (p, k) => {                                   // pied neutre sous le corps au MILIEU de l'appui
    const tm = (k - p.phase) * T + p.beta * T / 2;
    const { c, cap } = cheminCorps(tm);
    const X = add(add(centre, c), mv(Ry(cap), sub(p.neutre, centre)));
    X[1] = p.neutre[1];
    return X;
  };

  // D[i][j] : rotation monde (delta sur le repos) de l'os j à l'image i
  const D = Array.from({ length: nT }, () => new Array(J));
  const fixes = new Map();
  for (const p of pattes) {
    const ch = p.ik;
    const Fpied = new Array(nT), Dch = ch.slice(0, -1).map(() => new Array(nT));
    const Lik = longueurChaine(ch.map((k) => P0[k]));
    let u = 0;
    for (let i = 0; i < nT; i++) {
      let cible, phi = 0, b_ = p.beta;
      if (!A.pas) cible = p.neutre.slice();
      else {
        const x = t[i] / T + p.phase, k = Math.floor(x);
        phi = x - k;
        if (phi < b_) cible = appui(p, k);
        else {
          u = (phi - b_) / (1 - b_);
          const X0 = appui(p, k), X1 = appui(p, k + 1), e = (1 - Math.cos(Math.PI * u)) / 2;
          cible = add(X0, mulS(sub(X1, X0), e));
          cible[1] += h * Math.sin(Math.PI * u) ** 2;
        }
      }
      let theta = 0;                                          // déroulé : talon qui se lève en fin d'appui
      if (A.pas && p.pivotOff) {
        const s_ = phi < b_ ? clip((phi / b_ - 0.55) / 0.45, 0, 1) : 1 - clip(u / 0.45, 0, 1);
        theta = A.talon * s_ * s_ * (3 - 2 * s_);
      }
      const F = mm(Rcap[i], Rx(theta));
      Fpied[i] = F;
      if (p.pivotOff && theta > 0) {
        const orteil = add(cible, mv(Rcap[i], p.pivotOff));
        cible = sub(orteil, mv(F, p.pivotOff));
      }
      const hanche_i = monde(i, P0[ch[0]]);
      let cib = sub(cible, mv(F, p.piedOff));                // cible de la cheville
      const dd = sub(cib, hanche_i);
      if (norm(dd) > 0.97 * Lik) cib = add(hanche_i, mulS(dd, 0.97 * Lik / norm(dd)));   // portée bornée
      const Q = resoudreForme(p.forme, hanche_i, cib, mv(Rb[i], p.pole));
      for (let a = 0; a < ch.length - 1; a++) {
        const repos = mv(Rb[i], sub(P0[ch[a + 1]], P0[ch[a]]));
        Dch[a][i] = mm(aligner(repos, sub(Q[a + 1], Q[a])), Rb[i]);
      }
    }
    ch.slice(0, -1).forEach((k, a) => fixes.set(k, Dch[a]));
    fixes.set(ch[ch.length - 1], Fpied);                    // pied rigide (cap + déroulé)
    fixes.set(p.bout, Fpied);
  }
  // --- queue, pédipalpes, colonne, bras, tête : rotations locales « balance »
  const balance = new Map();
  const ampQ = allure === 'run' ? 0.16 : allure === 'idle' ? 0.08 : 0.10;
  for (const cq of queues) {
    cq.slice(0, -1).forEach((j, a) => {
      balance.set(j, t.map((tt) => Ry(ampQ * (a + 1) / cq.length * Math.sin(2 * Math.PI * tt / T * (A.pas ? 1 : 2) - 0.7 * a))));
    });
  }
  palpes.forEach((cp, q) => {
    const c = cp.chaine, vit = A.pas ? 1 : 0.5;
    balance.set(c[0], t.map((tt) => Rx(-0.07 * (0.5 + 0.5 * Math.sin(2 * Math.PI * vit * tt / T + 1.7 * q)))));
    if (c.length > 2) balance.set(c[1], t.map((tt) => Rx(-0.05 * Math.sin(2 * Math.PI * vit * tt / T + 1.7 * q + 0.8))));
  });
  let nbBras = 0;
  if (bipede) {
    const xMid = median(P0.map((p) => p[0])), ext = etendue(P0);
    const pris = new Set([...pattes.flatMap((q) => sousArbre(E, q.chaine[0])), ...tetes.flat()]);
    const bras = [];
    for (let f = 0; f < J; f++) {
      if (E[f].length || pris.has(f) || Math.abs(P0[f][0] - xMid) < 0.1 * ext) continue;
      const c = [f];
      let k = f;
      while (par[k] >= 0 && E[par[k]].length === 1) { k = par[k]; c.push(k); }
      c.reverse();
      if (c.length < 3 || par[c[0]] < 0) continue;
      let ep = 0;                                             // épaule = premier os qui descend
      for (let a = 0; a < c.length - 1; a++) {
        const b = sub(P0[c[a + 1]], P0[c[a]]);
        if (b[1] < -0.5 * norm(b)) { ep = a; break; }
      }
      bras.push({ epaule: c[ep], coude: c[Math.min(ep + 1, c.length - 2)], cote: P0[f][0] > xMid ? 1 : -1, moyeu: par[c[0]] });
    }
    nbBras = bras.length;
    const colonne = [];
    if (bras.length) { for (let k = bras[0].moyeu; k >= 0 && k !== racine; k = par[k]) colonne.push(k); colonne.reverse(); }
    const nC = Math.max(colonne.length, 1);
    for (const j of colonne) balance.set(j, t.map((_, i) => mm(Ry(-1.6 * lacetBassin[i] / nC), Rz(-roulis[i] / nC))));
    const [ampB, flex] = allure === 'run' ? [0.5, 1.1] : allure === 'idle' ? [0.03, 0.12] : [0.3, 0.15];
    for (const b of bras) {
      const d_ = sub(P0[b.coude], P0[b.epaule]);
      let axe = cross(mulS(d_, 1 / (norm(d_) + 1e-12)), [0, 0, 1]);
      if (norm(axe) < 1e-6) continue;
      axe = mulS(axe, 1 / norm(axe));
      const avant = t.map((tt, i) => (A.pas ? -b.cote * ampB * sG[i] : ampB * Math.sin(2 * Math.PI * tt / T + (b.cote === 1 ? 0 : 1.3))));
      balance.set(b.epaule, avant.map((a) => rotvec(axe, a)));
      balance.set(b.coude, avant.map((a) => rotvec(axe, flex + (allure !== 'run' ? 0.15 : 0.2) * clip(a / Math.max(ampB, 1e-6), 0, 1))));
    }
  }
  for (const ct of tetes) {
    ct.slice(0, -1).forEach((j, a) => {
      balance.set(j, t.map((tt, i) => {
        const hoche = (A.pas ? 0.03 : 0.04) * Math.sin(4 * Math.PI * tt / T + 0.5 + 0.3 * a);
        let m = Rx(hoche - (a === 0 ? tangage[i] : 0));
        if (!A.pas && a === 0) m = mm(Ry(0.22 * Math.sin(2 * Math.PI * tt / T)), m);
        if (bipede && a === 0) m = mm(Ry(0.6 * lacetBassin[i]), m);
        return m;
      }));
    });
  }
  // --- assemblage, parents d'abord : un os non piloté suit son parent
  const ordre = [], file = [racine];
  while (file.length) { const j = file.shift(); ordre.push(j); file.push(...E[j]); }
  for (let i = 0; i < nT; i++) {
    for (const j of ordre) {
      if (j === racine) D[i][j] = Rb[i];
      else if (fixes.has(j)) D[i][j] = fixes.get(j)[i];
      else if (balance.has(j)) D[i][j] = mm(D[i][par[j]], balance.get(j)[i]);
      else D[i][j] = D[i][par[j]];
    }
  }
  // rotations locales (repos aligné sur le monde) : R_j = D_parent^T · D_j
  const R = D.map((Di) => Di.map((Dj, j) => (par[j] < 0 ? Dj : mm(tr(Di[par[j]]), Dj))));
  const racineMonde = t.map((_, i) => monde(i, P0[racine]));
  // --- contrôles : positions reconstruites, os sous le sol, glissement des pieds en appui
  let sousSol = 0, glisse = 0, acoups = 0;
  const Pw = D.map(() => new Array(J));
  for (let i = 0; i < nT; i++) for (const j of ordre) Pw[i][j] = j === racine ? racineMonde[i] : add(Pw[i][par[j]], mv(D[i][par[j]], sub(P0[j], P0[par[j]])));
  for (let i = 0; i < nT; i++) for (let j = 0; j < J; j++) sousSol = Math.max(sousSol, sol - Pw[i][j][1]);
  for (const p of pattes) {
    if (!A.pas) continue;
    let s = 0, n = 0;
    for (let i = 1; i < nT; i++) {
      const a = ((t[i - 1] / T + p.phase) % 1 + 1) % 1, b = ((t[i] / T + p.phase) % 1 + 1) % 1;
      if (b < p.beta && a < b) { s += norm(sub(Pw[i][p.bout], Pw[i - 1][p.bout])); n++; }
    }
    if (n) glisse = Math.max(glisse, s / n);
    for (const j of p.chaine.slice(0, -1)) {
      let prec = null;
      for (let i = 1; i < nT; i++) {
        const w_ = angleRot(mm(tr(D[i - 1][j]), D[i][j]));
        if (prec !== null) acoups = Math.max(acoups, Math.abs(w_ - prec));
        prec = w_;
      }
    }
  }
  const infos = {
    pattes: pattes.length, pedipalpes: palpes.length, queues: queues.length, tetes: tetes.length, bras: nbBras,
    periode: T, foulee: +S.toFixed(3), images: nT,
    sous_sol_pct: +(100 * sousSol / H).toFixed(1), glissement_appui_pct: +(100 * glisse / H).toFixed(2), acoups_max_deg: +(acoups * 180 / Math.PI).toFixed(1),
  };
  return { nom: allure, R, racineMonde, infos };
}

// ------------------------------------------------------------------ écriture du GLB (une animation par allure)
function ecrireGLB(sq, clips, fps) {
  const json = JSON.parse(JSON.stringify(sq.json));
  const morceaux = [sq.bin];
  let taille = sq.bin.byteLength;
  const ajouter = (f32, type, minmax) => {
    const bourrage = (4 - (taille % 4)) % 4;
    if (bourrage) { morceaux.push(new Uint8Array(bourrage)); taille += bourrage; }
    const off = taille;
    morceaux.push(new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength));
    taille += f32.byteLength;
    (json.bufferViews = json.bufferViews || []).push({ buffer: 0, byteOffset: off, byteLength: f32.byteLength });
    const n = { SCALAR: 1, VEC3: 3, VEC4: 4 }[type];
    const acc = { bufferView: json.bufferViews.length - 1, componentType: 5126, count: f32.length / n, type };
    if (minmax) { acc.min = [Math.min(...f32)]; acc.max = [Math.max(...f32)]; }
    (json.accessors = json.accessors || []).push(acc);
    return json.accessors.length - 1;
  };
  const ens = new Set(sq.joints);
  const racineNoeud = sq.joints.find((n) => !ens.has(sq.parent.get(n)));
  json.animations = [];
  for (const { nom, R, racineMonde } of clips) {
    const nT = R.length;
    const temps = ajouter(Float32Array.from({ length: nT }, (_, i) => i / fps), 'SCALAR', true);
    const samplers = [], channels = [];
    sq.joints.forEach((n, u) => {
      const pn = sq.parent.get(n);
      const Cp = pn !== undefined ? orthonormer(rot4(sq.W.get(pn))) : I3(), C = orthonormer(rot4(sq.W.get(n)));
      const q = new Float32Array(4 * nT);
      let prec = null;
      for (let i = 0; i < nT; i++) {
        let qq = quatDeMatrice(mm(mm(tr(Cp), R[i][u]), C));
        if (prec && qq[0] * prec[0] + qq[1] * prec[1] + qq[2] * prec[2] + qq[3] * prec[3] < 0) qq = qq.map((x) => -x);
        q.set(qq, 4 * i);
        prec = qq;
      }
      samplers.push({ input: temps, output: ajouter(q, 'VEC4'), interpolation: 'LINEAR' });
      channels.push({ sampler: samplers.length - 1, target: { node: n, path: 'rotation' } });
    });
    const pn = sq.parent.get(racineNoeud);
    const inv = pn !== undefined ? inv4(sq.W.get(pn)) : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const loc = new Float32Array(3 * nT);
    racineMonde.forEach((p, i) => loc.set(add(mv(rot4(inv), p), pos4(inv)), 3 * i));
    samplers.push({ input: temps, output: ajouter(loc, 'VEC3'), interpolation: 'LINEAR' });
    channels.push({ sampler: samplers.length - 1, target: { node: racineNoeud, path: 'translation' } });
    json.animations.push({ name: nom, samplers, channels });
  }
  const bourrage = (4 - (taille % 4)) % 4;
  if (bourrage) { morceaux.push(new Uint8Array(bourrage)); taille += bourrage; }
  json.buffers[0].byteLength = taille;
  let jb = new TextEncoder().encode(JSON.stringify(json));
  const pj = (4 - (jb.length % 4)) % 4;
  if (pj) { const t_ = new Uint8Array(jb.length + pj); t_.set(jb); t_.fill(0x20, jb.length); jb = t_; }
  const total = 12 + 8 + jb.length + 8 + taille;
  const out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jb.length, true); dv.setUint32(16, 0x4E4F534A, true); out.set(jb, 20);
  let off = 20 + jb.length;
  dv.setUint32(off, taille, true); dv.setUint32(off + 4, 0x004E4942, true); off += 8;
  for (const m of morceaux) { out.set(m, off); off += m.byteLength; }
  return out.buffer;
}

// ------------------------------------------------------------------ point d'entrée
/**
 * @param {ArrayBuffer} glb  GLB riggé (un skin)
 * @param {{allures?: string[], cycles?: number, fps?: number}} options
 * @returns {{glb: ArrayBuffer, infos: Object<string, object>}}  GLB d'origine + une animation par allure
 */
export function animerGLB(glb, { allures = Object.keys(ALLURES), cycles = 3, fps = 30 } = {}) {
  const sq = charger(glb);
  const clips = [], infos = {};
  for (const a of allures) {
    if (!ALLURES[a]) throw new Error('allure inconnue : ' + a);
    const clip_ = animerAllure(sq, a, a === 'idle' ? 1 : cycles, fps);
    clips.push(clip_);
    infos[a] = clip_.infos;
  }
  return { glb: ecrireGLB(sq, clips, fps), infos };
}
