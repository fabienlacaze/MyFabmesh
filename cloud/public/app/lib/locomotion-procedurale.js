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

// VARIANTES (2026-09-28) : styles d'une même allure, pour varier les personnages.
// Multiplicateurs : T (période), foulee, h (hauteur de pas), bob, lacet ; valeurs : tendu
// (bassin), tete (inclinaison, rad, + = tête basse), regard (amplitude du regard à l'arrêt),
// queue et bras (amplitude). Nom du clip : « walk » (normal) ou « walk__sneak ».
const TOURNANTS = { normal: {}, tight: { lacet: 1.6, foulee: 0.6 }, wide: { lacet: 0.6, foulee: 1.2 } };
export const VARIANTES = {
  idle: {
    normal: {},
    alert: { T: 0.75, regard: 2.2, tete: -0.08, queue: 1.4, bob: 0.8 },
    tired: { T: 1.3, bob: 2.2, tendu: 0.9, tete: 0.18, regard: 0.4, queue: 0.5 },
  },
  walk: {
    normal: {},
    slow: { T: 1.35, foulee: 0.8, h: 0.8, bob: 1.3, tendu: 0.945, tete: 0.10, queue: 0.7, bras: 0.7 },
    brisk: { T: 0.8, foulee: 1.15, h: 1.1, bob: 0.8, bras: 1.3 },
    sneak: { T: 1.55, foulee: 0.7, h: 1.35, bob: 0.35, tendu: 0.86, tete: 0.14, queue: 0.4, bras: 0.4 },
    proud: { T: 1.1, h: 1.45, bob: 0.8, tete: -0.12, queue: 1.3, bras: 1.2 },
    crawl: { T: 1.6, foulee: 0.6, h: 0.8, bob: 0.3, tendu: 0.78, tete: 0.1, queue: 0.5, bras: 0.5 },
  },
  run: {
    normal: {},
    jog: { T: 1.25, foulee: 0.7, h: 0.8, bob: 0.8, bras: 0.8 },
    sprint: { T: 0.85, foulee: 1.25, h: 1.15, tendu: 0.84, tete: 0.06, bras: 1.3 },
  },
  turn_left: TOURNANTS,
  turn_right: TOURNANTS,
};
/** « walk__sneak » -> { allure: 'walk', variante: 'sneak' } */
export function lireClip(nom) {
  const [a, variante = 'normal'] = String(nom).split('__');
  return { allure: ALIAS_ALLURES[a] || a, variante };
}

// ------------------------------------------------------------------ MODE DE DEPLACEMENT (2026-09-28)
// User : « j'ai teste poisson mais ca m'a propose Run ». Le squelette seul ne distingue pas un thon
// (nageoires) d'un crocodile (pattes courtes) : l'interface lit d'abord les MOTS du projet
// (modeDepuisTexte), puis le squelette (modeDuSquelette), et l'utilisateur peut imposer le mode.
//   pattes    : marche / course (detection des pattes)
//   nage      : onde laterale le long de la colonne, a la hauteur du corps (poisson, cetace)
//   reptation : meme onde, au sol (serpent, ver)
// Les clips portent alors un nom qui dit ce qu'ils sont : swim, slither… (walk pour les pattes).
export const MODES = ['auto', 'pattes', 'nage', 'reptation'];
const NOMS_PAR_MODE = {
  nage: { walk: 'swim', run: 'swim_fast', turn_left: 'swim_left', turn_right: 'swim_right' },
  reptation: { walk: 'slither', run: 'slither_fast', turn_left: 'slither_left', turn_right: 'slither_right' },
};
/** Nom de clip -> allure du moteur (« swim » -> « walk »). */
export const ALIAS_ALLURES = Object.fromEntries(Object.values(NOMS_PAR_MODE).flatMap((t) => Object.entries(t).map(([a, n]) => [n, a])));
export function allureDeClip(nom) { const a = String(nom).split('__')[0]; return ALIAS_ALLURES[a] || a; }
// Mots (anglais, francais, espagnol, allemand, italien, portugais), sans accents, en minuscules.
const MOTS_NAGE = new Set(('fish fishes tuna shark sharks whale whales dolphin dolphins orca salmon trout carp cod eel '
  + 'ray manta stingray piranha goldfish koi marlin swordfish sardine herring mackerel pike perch catfish barracuda '
  + 'seahorse narwhal beluga porpoise bass tilapia sturgeon '
  + 'poisson poissons thon requin requins baleine baleines dauphin dauphins saumon truite carpe morue anguille raie '
  + 'espadon hareng maquereau brochet perche silure hippocampe narval marsouin esturgeon '
  + 'pez peces atun tiburon ballena delfin salmon trucha anguila '
  + 'fisch thunfisch hai wal delfin lachs forelle karpfen aal '
  + 'pesce tonno squalo balena delfino salmone trota '
  + 'peixe atum tubarao baleia golfinho').split(' '));
const MOTS_REPTATION = new Set(('snake snakes serpent serpents python cobra viper boa anaconda mamba rattlesnake adder '
  + 'worm worms earthworm larva larvae maggot caterpillar slug leech '
  + 'couleuvre vipere ver vers lombric chenille limace sangsue asticot larve '
  + 'serpiente culebra gusano oruga babosa '
  + 'schlange wurm raupe schnecke '
  + 'serpente verme bruco lumaca '
  + 'cobra minhoca lagarta lesma').split(' '));
/** Mode d'apres les mots d'un texte (nom du projet, prompt…) : 'nage', 'reptation' ou null. */
export function modeDepuisTexte(texte) {
  const mots = String(texte || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9]+/);
  if (mots.some((m) => MOTS_NAGE.has(m))) return 'nage';
  if (mots.some((m) => MOTS_REPTATION.has(m))) return 'reptation';
  return null;
}
/** Mode d'apres le SQUELETTE : 'pattes' si des pattes sont detectees, sinon 'reptation'. */
export function modeDuSquelette(glb) {
  const sq = charger(glb);
  return detecterPattes(sq.par, sq.P0, sq.racine).pattes.length ? 'pattes' : 'reptation';
}

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
/** Comme aligner, mais le LACET (rotation autour de la verticale) d'abord : un os qui ne fait que
 *  tourner à plat reste à plat. La rotation minimale seule faisait basculer un os incliné
 *  (nageoire caudale du poisson sous le sol en virage serré, 28/09). */
function alignerLacet(a, b) {
  const ha = Math.hypot(a[0], a[2]), hb = Math.hypot(b[0], b[2]);
  if (ha < 1e-4 * norm(a) || hb < 1e-4 * norm(b)) return aligner(a, b);
  const Y = Ry(Math.atan2(b[0], b[2]) - Math.atan2(a[0], a[2]));
  return mm(aligner(mv(Y, a), b), Y);
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
  // plusieurs racines possibles (corps + accessoire separes) : la principale porte le plus d'os
  const E = enfantsDe(par);
  const racines = par.map((q, i) => (q < 0 ? i : -1)).filter((i) => i >= 0);
  const taille = (r) => sousArbre(E, r).length;
  const racine = racines.reduce((m, r) => (taille(r) > taille(m) ? r : m), racines[0]);
  return { json, bin, joints, par, P0, W, parent, racines, racine };
}

// ------------------------------------------------------------------ squelette
const enfantsDe = (par) => { const E = par.map(() => []); par.forEach((p, j) => { if (p >= 0) E[p].push(j); }); return E; };
function sousArbre(E, j) { const pile = [j], out = []; while (pile.length) { const k = pile.pop(); out.push(k); pile.push(...E[k]); } return out; }
const ptpAxe = (P, a) => Math.max(...P.map((p) => p[a])) - Math.min(...P.map((p) => p[a]));
const etendue = (P) => Math.max(ptpAxe(P, 0), ptpAxe(P, 1), ptpAxe(P, 2));

function detecterPattes(par, P0, racinePrincipale = null) {
  const E = enfantsDe(par), J = par.length;
  const racine = racinePrincipale ?? par.indexOf(-1);
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
    // + PROCHES dans l'espace : 4 pieds courts d'une table (ancetre commun a 2 os) formaient un seul pied
    const g = grappes.find((g_) => {
      const a = ancetre(j, g_[0]);
      return prof[j] - prof[a] <= 2 && prof[g_[0]] - prof[a] <= 2 && norm(sub(P0[j], P0[g_[0]])) < 0.12 * ext;
    });
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
    // une patte levée part du CORPS (niveau du bassin), jamais des épaules : les bras d'un
    // guerrier accroupi tenant une hache basse (mains à 40 % de la hauteur) passaient pour des
    // pattes et le faisaient marcher à quatre pattes (28/09)
    if (toutesLevees && P0[chaine[0]][1] > P0[racine][1] + 0.15 * H) return;
    // une patte DESCEND vers le sol ou part sur le COTE : la tete d'un serpent posee au sol
    // (chaine centrale et horizontale) n'en est pas une
    const Lc = longueurChaine(chaine.map((k) => P0[k]));
    if (P0[chaine[0]][1] - P0[bout][1] < 0.25 * Lc && Math.abs(P0[bout][0] - x0) < 0.15 * ext) return;
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
    while (k >= 0 && par[k] >= 0 && !dansPattes.has(k) && k !== racine && E[par[k]].length === 1) { c.push(k); k = par[k]; }
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
    else if (p.nbCote >= 5 && allure !== 'run') p.phase = ((0.5 * s + 0.1 * p.rang) % 1 + 1) % 1;              // mille-pattes : vague
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
  if (Math.max(...phi.map(Math.abs)) < 0.05 && phi.length >= 2) {
    const m = (phi.length - 1) / 2;                           // premiere moitie vers le pole, seconde en retour
    phi = phi.map((_, k) => (k < m ? 0.08 : k > m ? -0.08 : 0));
  }
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
  // pas d'autre plafond que 0,9 pi sur la plus forte pliure : une jambe DROITE au repos (pliure
  // conventionnelle de 0,08) plafonnait à k = 8, genou à 73° ; accroupie (« crawl ») elle ne
  // pouvait plus se replier et enfonçait le pied de 4 % sous le sol (28/09)
  let kmax = 0.9 * Math.PI / Math.max(Math.max(...F.phi.map(Math.abs)), 1e-3);
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
function animerAllure(sq, allure, cycles, fps, variante = 'normal') {
  const { joints, par, P0 } = sq;
  const det = detecterPattes(par, P0, sq.racine);
  const { racine, queues, tetes, sol } = det;
  let pattes = det.pattes.map((p) => ({ ...p }));
  if (!pattes.length) return animerSansPattes(sq, allure, cycles, fps, variante, det);
  let palpes = [];
  if (pattes.length >= 6) {                                   // pédipalpes : « pattes » bien plus courtes
    const lg = pattes.map((q) => longueurChaine(q.chaine.map((k) => P0[k]))), med = median(lg);
    palpes = pattes.filter((_, i) => lg[i] < 0.65 * med);
    pattes = pattes.filter((_, i) => lg[i] >= 0.65 * med);
  }
  phases(pattes, P0, allure);
  const B = ALLURES[allure], V = (VARIANTES[allure] || {})[variante] || {};
  const A = {
    ...B, T: B.T.map((x) => x * (V.T || 1)), foulee: B.foulee * (V.foulee || 1), h: B.h * (V.h || 1),
    bob: B.bob * (V.bob || 1), lacet: B.lacet * (V.lacet || 1), tendu: V.tendu ?? B.tendu,
    tete: V.tete || 0, regard: V.regard ?? 1, queue: V.queue ?? 1, bras: V.bras ?? 1,
  };
  const nombreux = pattes.length >= 6, bipede = pattes.length <= 2;
  const T = A.T[nombreux ? 1 : 0];
  let beta = nombreux && allure !== 'run' && A.pas ? 0.55 : A.beta;
  if (pattes.length >= 10 && allure !== 'run' && A.pas) beta = 0.7;      // mille-pattes : plus de pieds au sol
  if (bipede && A.pas && allure !== 'run') beta = 0.6;
  const H = ptpAxe(P0, 1), E = enfantsDe(par);

  // --- géométrie de chaque patte : chaîne IK, pied rigide, point neutre, sens de pliure
  for (const p of pattes) {
    const ch = p.chaine;
    const seg = [];
    for (let k = 1; k < ch.length; k++) seg.push(norm(sub(P0[ch[k]], P0[ch[k - 1]])));
    const d0 = sub(P0[p.bout], P0[ch[0]]);
    const debout = Math.abs(d0[1]) > 1.5 * Math.hypot(d0[0], d0[2]);
    let piedCourt = ch.length >= 4 && seg[seg.length - 1] < 0.5 * moyenne(seg.slice(0, -1));
    p.ik = piedCourt ? ch.slice(0, -1) : ch;
    // Patte ÉTALÉE (araignée, insecte) : son premier os part du CENTRE du corps jusqu'à la base
    // de la patte (la coxa, dans le corps). Le faire pivoter faisait glisser la base de la patte
    // le long du corps et déchirait la peau autour (plaques étirées, 28/09) : il reste rigide.
    if (!debout && ch.length >= 4) {
      p.ik = p.ik.slice(1);
      if (p.ik.length < 3) { p.ik = ch.slice(1); piedCourt = false; }   // garder 2 os qui plient
    }
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
    if (debout) N[2] = haut[2] + p.piedOff[2];               // cheville à l'aplomb de la hanche
    const contact = Math.min(...sousArbre(E, p.bout).map((k) => P0[k][1]));
    if (contact - sol > 0.02 * H) N[1] -= contact - sol;     // le point le plus BAS du pied touche le sol
    // Patte étalée presque tendue au repos (araignée : 96 % depuis sa base) : on ramène le pied
    // vers le corps plutôt que d'abaisser le corps (qui écrasait l'araignée au sol, 28/09).
    p.debout = debout;
    if (!debout) {
      const base = P0[p.ik[0]], Lc = longueurChaine(p.ik.map((k) => P0[k]));
      const v = sub(sub(N, p.piedOff), base), hz = Math.hypot(v[0], v[2]), lim = Math.min(A.tendu, 0.85) * Lc;
      if (norm(v) > lim && hz > 1e-9) {
        const k = Math.sqrt(Math.max(lim * lim - v[1] * v[1], 0)) / hz;
        N[0] = base[0] + k * v[0] + p.piedOff[0];
        N[2] = base[2] + k * v[2] + p.piedOff[2];
      }
    }
    p.neutre = N;
    const a_ = P0[p.ik[0]], b_ = P0[p.ik[p.ik.length - 1]];
    const u_ = mulS(sub(b_, a_), 1 / (norm(sub(b_, a_)) + 1e-12));
    let pole = [0, 0, 0];
    for (const k of p.ik.slice(1, -1)) { const o = sub(P0[k], a_); pole = add(pole, sub(o, mulS(u_, dot(o, u_)))); }
    if (debout) pole[0] = 0;
    if (norm(pole) < 1e-4) pole = debout ? [0, 0, 1] : [0, 1, 0];
    p.pole = mulS(pole, 1 / norm(pole));
    p.forme = preparerForme(p.ik.map((k) => P0[k]), p.pole);
    // Patte étalée dont le genou est SOUS la corde (tentacule de pieuvre qui s'affaisse) : en se
    // repliant elle enfonçait le genou dans le sol (8 % sous le sol, 28/09). Elle se replie en
    // MIROIR, genou vers le haut, comme une vraie patte qui se lève.
    p.poleIK = !debout && p.pole[1] < 0 ? mulS(p.pole, -1) : p.pole;
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
    return [Lc, Math.abs(d[0]), -d[1], Math.abs(d[2]), p.debout && p.ik.length >= 3];   // patte d'un seul os : ne plie pas
  });
  let abaisse = 0;
  for (const [Lc, dx, dy, dz, deb] of geo) { if (!deb) continue; const r2 = (A.tendu * Lc) ** 2 - dx * dx - dz * dz; if (r2 > 0) abaisse = Math.max(abaisse, dy - Math.sqrt(r2)); }
  const margeBob = A.bob * hanche * (allure === 'run' ? 2 : -1);
  let demis = null;
  if (A.pas) {
    demis = geo.map(([Lc, dx, dy, dz]) => Math.max(Math.sqrt(Math.max((TENDU_MAX * Lc) ** 2 - dx * dx - (dy - abaisse + margeBob) ** 2, 0)) - dz, 0.03 * portee));
    S = Math.min(S, median(demis.map((d_) => 2 * d_ / beta)));
    pattes.forEach((p, i) => { p.beta = clip(2 * demis[i] / S, 0.25, beta); });
  } else pattes.forEach((p) => { p.beta = beta; });
  // pivot du corps : le CENTRE des attaches de pattes (et non l'os racine, qui peut etre la tete :
  // un mille-pattes tournait autour de sa tete et balayait ses pattes arriere)
  const hautsPattes = pattes.map((p) => P0[p.chaine[0]]);
  const moy = hautsPattes.reduce((a, b) => add(a, b), [0, 0, 0]).map((x) => x / hautsPattes.length);
  const centre = [moy[0], P0[racine][1], moy[2]];
  let v = S / T, w = A.lacet;
  // VIRAGE : une patte loin du pivot balaie de côté (w × r) en plus de la foulée. Les pattes
  // arrière d'un mille-pattes sortaient de leur portée et claquaient (à-coup de 30°, 28/09) :
  // l'allure ralentit (même arc) jusqu'à ce que chaque patte tienne dans sa portée.
  if (demis && Math.abs(w) > 1e-9) {
    // pied posé au neutre à mi-appui (t = 0) ; où est-il, vu du corps, en début et fin d'appui ?
    const horsPortee = (vv, ww) => pattes.some((p) => {
      const Lik = longueurChaine(p.ik.map((k) => P0[k])), hanche_ = sub(P0[p.ik[0]], [0, abaisse, 0]);
      return [-1, 1].some((sg) => {
        const dt = sg * p.beta * T / 2, cap = ww * dt;
        const c = [(vv / ww) * (1 - Math.cos(cap)), 0, (vv / ww) * Math.sin(cap)];
        const q = add(centre, mv(tr(Ry(cap)), sub(sub(p.neutre, centre), c)));
        return norm(sub(sub(q, p.piedOff), hanche_)) > 0.95 * Lik;
      });
    });
    for (let n = 0; n < 30 && horsPortee(v, w); n++) { v *= 0.9; w *= 0.9; }
  }
  const nT = Math.round(cycles * T * fps), J = joints.length;
  const t = Array.from({ length: nT }, (_, i) => i / fps);

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
  if (pattes.every((p) => p.ik.length < 3)) for (let i = 0; i < nT; i++) bob[i] = 0;   // pieds rigides : pas de bob
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
      const Q = resoudreForme(p.forme, hanche_i, cib, mv(Rb[i], p.poleIK));
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
  const ampQ = (allure === 'run' ? 0.16 : allure === 'idle' ? 0.08 : 0.10) * A.queue;
  for (const cq of queues) {
    cq.slice(0, -1).forEach((j, a) => {
      balance.set(j, t.map((tt) => Ry(ampQ * (a + 1) / cq.length * Math.sin(2 * Math.PI * tt / T * (A.pas ? 1 : 2) - 0.7 * a))));
    });
  }
  palpes.forEach((cp, q) => {
    const c = cp.chaine, vit = A.pas ? 1 : 0.5;
    // le premier os part du centre du corps (dans le corps) : on anime les suivants
    const o = c.length >= 4 ? 1 : 0;
    balance.set(c[o], t.map((tt) => Rx(-0.07 * (0.5 + 0.5 * Math.sin(2 * Math.PI * vit * tt / T + 1.7 * q)))));
    if (c.length > o + 2) balance.set(c[o + 1], t.map((tt) => Rx(-0.05 * Math.sin(2 * Math.PI * vit * tt / T + 1.7 * q + 0.8))));
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
    const [ampB0, flex] = allure === 'run' ? [0.5, 1.1] : allure === 'idle' ? [0.03, 0.12] : [0.3, 0.15];
    const ampB = ampB0 * A.bras;
    for (const b of bras) {
      const d_ = sub(P0[b.coude], P0[b.epaule]);
      let axe = cross(mulS(d_, 1 / (norm(d_) + 1e-12)), [0, 0, 1]);
      if (norm(axe) < 1e-6) continue;
      axe = mulS(axe, 1 / norm(axe));
      const ampL = Math.abs(d_[1]) < 0.5 * norm(d_) ? 0.35 * ampB : ampB;   // bras en T / aile : balancement reduit
      const avant = t.map((tt, i) => (A.pas ? -b.cote * ampL * sG[i] : ampL * Math.sin(2 * Math.PI * tt / T + (b.cote === 1 ? 0 : 1.3))));
      balance.set(b.epaule, avant.map((a) => rotvec(axe, a)));
      balance.set(b.coude, avant.map((a) => rotvec(axe, flex + (allure !== 'run' ? 0.15 : 0.2) * clip(a / Math.max(ampB, 1e-6), 0, 1))));
    }
  }
  let nbAiles = 0;
  if (!bipede) {
    // ailes et autres appendices lateraux (dragon, oiseau a 4 pattes…) : leger battement symetrique
    const xMid = median(P0.map((p) => p[0])), ext = etendue(P0);
    const pris = new Set([...pattes, ...palpes].flatMap((q) => sousArbre(E, q.chaine[0])));
    [...tetes, ...queues].forEach((c) => c.forEach((k) => pris.add(k)));
    for (let f = 0; f < J; f++) {
      if (E[f].length || pris.has(f) || Math.abs(P0[f][0] - xMid) < 0.12 * ext) continue;
      const c = [f];
      let k = f;
      while (par[k] >= 0 && E[par[k]].length === 1 && !pris.has(par[k])) { k = par[k]; c.push(k); }
      c.reverse();
      if (c.length < 2 || par[c[0]] < 0 || balance.has(c[0]) || fixes.has(c[0])) continue;
      const cote = P0[f][0] > xMid ? 1 : -1, amp = allure === 'run' ? 0.12 : allure === 'idle' ? 0.04 : 0.07;
      balance.set(c[0], t.map((tt) => Rz(cote * amp * Math.sin(2 * Math.PI * tt / T))));
      nbAiles++;
    }
  }
  for (const ct of tetes) {
    ct.slice(0, -1).forEach((j, a) => {
      balance.set(j, t.map((tt, i) => {
        const hoche = (A.pas ? 0.03 : 0.04) * Math.sin(4 * Math.PI * tt / T + 0.5 + 0.3 * a);
        let m = Rx(hoche - (a === 0 ? tangage[i] - A.tete : 0));
        if (!A.pas && a === 0) m = mm(Ry(0.22 * A.regard * Math.sin(2 * Math.PI * tt / T)), m);
        if (bipede && a === 0) m = mm(Ry(0.6 * lacetBassin[i]), m);
        return m;
      }));
    });
  }
  // --- assemblage, parents d'abord : un os non piloté suit son parent
  const ordre = [], file = [racine, ...sq.racines.filter((r) => r !== racine)];
  while (file.length) { const j = file.shift(); ordre.push(j); file.push(...E[j]); }
  for (let i = 0; i < nT; i++) {
    for (const j of ordre) {
      if (par[j] < 0) D[i][j] = Rb[i];
      else if (fixes.has(j)) D[i][j] = fixes.get(j)[i];
      else if (balance.has(j)) D[i][j] = mm(D[i][par[j]], balance.get(j)[i]);
      else D[i][j] = D[i][par[j]];
    }
  }
  // rotations locales (repos aligné sur le monde) : R_j = D_parent^T · D_j
  const R = D.map((Di) => Di.map((Dj, j) => (par[j] < 0 ? Dj : mm(tr(Di[par[j]]), Dj))));
  const racineMonde = t.map((_, i) => monde(i, P0[racine]));
  const racinesSec = sq.racines.filter((r) => r !== racine).map((r) => ({ j: r, pos: t.map((_, i) => monde(i, P0[r])) }));
  // --- contrôles : positions reconstruites, os sous le sol, glissement des pieds en appui
  let sousSol = 0, glisse = 0, acoups = 0, pireAcoup = [-1, -1];
  const Pw = D.map(() => new Array(J));
  for (let i = 0; i < nT; i++) for (const j of ordre) {
    Pw[i][j] = j === racine ? racineMonde[i] : par[j] < 0 ? racinesSec.find((x) => x.j === j).pos[i]
      : add(Pw[i][par[j]], mv(D[i][par[j]], sub(P0[j], P0[par[j]])));
  }
  let pireOs = -1;
  for (let i = 0; i < nT; i++) for (let j = 0; j < J; j++) if (sol - Pw[i][j][1] > sousSol) { sousSol = sol - Pw[i][j][1]; pireOs = j; }
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
        if (prec !== null && Math.abs(w_ - prec) > acoups) { acoups = Math.abs(w_ - prec); pireAcoup = [j, i]; }
        prec = w_;
      }
    }
  }
  const infos = {
    mode: 'pattes', ailes: nbAiles,
    pattes: pattes.length, pedipalpes: palpes.length, queues: queues.length, tetes: tetes.length, bras: nbBras,
    periode: T, foulee: +S.toFixed(3), images: nT,
    sous_sol_pct: +(100 * sousSol / H).toFixed(1), pire_os: pireOs, glissement_appui_pct: +(100 * glisse / H).toFixed(2), acoups_max_deg: +(acoups * 180 / Math.PI).toFixed(1),
    acoup_os: pireAcoup[0], acoup_image: pireAcoup[1],
  };
  return { nom: variante === 'normal' ? allure : `${allure}__${variante}`, R, racineMonde, racinesSec, infos };
}

// ------------------------------------------------------------------ créatures SANS pattes, objets
// Serpent, ver, poisson… : REPTATION — une onde parcourt la colonne (le plus long chemin du
// squelette) de la tête vers la queue et fait avancer le corps. Variante « crawl » : onde
// VERTICALE (ver, chenille). À l'arrêt : seule la tête ondule. Sans colonne (objet d'un ou deux
// os) : mouvement RIGIDE minimal (léger balancement, glissement), jamais une erreur.
function cheminLePlusLong(par, P0, racine) {
  const voisins = par.map(() => []);
  par.forEach((p, j) => { if (p >= 0) { const L = norm(sub(P0[j], P0[p])); voisins[p].push([j, L]); voisins[j].push([p, L]); } });
  const loin = (src) => {
    const dist = new Map([[src, 0]]), prec = new Map([[src, -1]]), pile = [src];
    while (pile.length) {
      const u = pile.pop();
      for (const [v, L] of voisins[u]) if (!dist.has(v)) { dist.set(v, dist.get(u) + L); prec.set(v, u); pile.push(v); }
    }
    let best = src;
    for (const [k, d] of dist) if (d > dist.get(best)) best = k;
    return { best, prec };
  };
  const a = loin(racine).best;
  const { best: b, prec } = loin(a);
  const chemin = [];
  for (let k = b; k >= 0; k = prec.get(k)) chemin.push(k);
  return chemin;
}

/** Chemin entre deux joints d'un même arbre (par les ancêtres). */
function cheminEntre(par, a, b) {
  const anc = (j) => { const c = []; for (; j >= 0; j = par[j]) c.push(j); return c; };
  const ca = anc(a), cb = anc(b), sb = new Set(cb);
  const i = ca.findIndex((k) => sb.has(k));
  if (i < 0) return null;
  return [...ca.slice(0, i + 1), ...cb.slice(0, cb.indexOf(ca[i])).reverse()];
}

/** Colonne d'une créature sans pattes : le plus long chemin, dont chaque bout est ensuite remplacé
 *  par le bout le plus AVANCÉ dans l'axe du corps. Le plus long chemin d'un poisson passait par une
 *  nageoire pectorale (plus longue que l'os de la tête) : la tête réelle n'ondulait pas (28/09). */
function colonneAxiale(par, P0, racine) {
  let chemin = cheminLePlusLong(par, P0, racine);
  if (P0[chemin[0]][2] < P0[chemin[chemin.length - 1]][2]) chemin.reverse();   // tête = bout le plus en avant (+Z)
  if (chemin.length < 3) return chemin;
  const deg = par.map(() => 0);
  par.forEach((p, j) => { if (p >= 0) { deg[p]++; deg[j]++; } });
  for (const bout of [0, 1]) {
    const a = chemin[bout ? chemin.length - 1 : 0], b = chemin[bout ? 0 : chemin.length - 1];
    const axe = sub(P0[a], P0[b]), L = norm(axe);
    if (L < 1e-9) continue;
    const u = mulS(axe, 1 / L), proj = (k) => dot(sub(P0[k], P0[b]), u);
    let best = a;
    for (let k = 0; k < par.length; k++) if (deg[k] <= 1 && k !== b && proj(k) > proj(best) + 0.02 * L) best = k;
    if (best === a) continue;
    const c = cheminEntre(par, b, best);
    if (c && c.length >= 3) chemin = bout ? c : c.reverse();   // c va de b vers le nouveau bout
    if (P0[chemin[0]][2] < P0[chemin[chemin.length - 1]][2]) chemin.reverse();
  }
  return chemin;
}

function animerSansPattes(sq, allure, cycles, fps, variante, det, raison = 'reptation', nage = false) {
  const { par, P0 } = sq, J = par.length, E = enfantsDe(par);
  const racine = det.racine, sol = det.sol, H = Math.max(ptpAxe(P0, 1), 1e-6), ext = Math.max(etendue(P0), 1e-6);
  const B = ALLURES[allure], V = (VARIANTES[allure] || {})[variante] || {};
  const pas = B.pas;
  const chemin = colonneAxiale(par, P0, racine);
  const Ltot = longueurChaine(chemin.map((k) => P0[k]));
  const mode = raison === 'reptation' && chemin.length >= 4 && Ltot > 0.05 * ext ? 'reptation' : 'rigide';
  const vertical = variante === 'crawl';
  // poisson a l'arret : battement de queue lent (sur place), pas la tete seule
  const T = (allure === 'idle' ? (nage ? 1.8 : 4.0) : allure === 'run' ? 0.8 : 1.3) * (V.T || 1);
  const nT = Math.max(2, Math.round((allure === 'idle' ? 1 : cycles) * T * fps));
  const t = Array.from({ length: nT }, (_, i) => i / fps);
  const L = mode === 'reptation' ? Ltot : ext;
  const lambda = 0.7 * L;
  const amp = (allure === 'idle' ? 0.03 : allure === 'run' ? 0.14 : 0.10) * L * (V.h || 1) * (vertical ? 0.6 : 1);
  const v = pas ? (mode === 'reptation' ? 0.55 * lambda / T : 0.35 * L / T) * (V.foulee || 1) : 0;
  const w = pas ? (B.lacet || 0) * (V.lacet || 1) : 0;
  const cheminCorps = (tt) => {
    const cap = w * tt;
    const c = Math.abs(w) < 1e-9 ? [0, 0, v * tt] : [(v / w) * (1 - Math.cos(cap)), 0, (v / w) * Math.sin(cap)];
    return { c, cap };
  };
  const D = Array.from({ length: nT }, () => new Array(J));
  const positions = new Map();                                // joint -> positions imposées (colonne)
  const rotImposees = new Map();                              // joint -> rotations monde imposées
  if (mode === 'reptation') {
    const s = [0];
    for (let k = 1; k < chemin.length; k++) s.push(s[k - 1] + norm(sub(P0[chemin[k]], P0[chemin[k - 1]])));
    const kappa = v > 1e-9 ? w / v : 0;
    const X = chemin.map(() => new Array(nT));
    for (let i = 0; i < nT; i++) {
      const { c, cap } = cheminCorps(t[i]);
      const Rc = Ry(cap);
      let p = [0, 0, 0];
      const pts = [p];
      for (let k = 0; k < chemin.length - 1; k++) {
        const repos = sub(P0[chemin[k + 1]], P0[chemin[k]]);
        const sm = 0.5 * (s[k] + s[k + 1]), phi = 2 * Math.PI * (sm / lambda - t[i] / T);
        const env = allure === 'idle' && !nage ? Math.max(0, 1 - sm / (0.35 * Ltot)) : 0.4 + 0.6 * sm / Ltot;
        let R_;
        if (vertical) {
          const pente = Math.atan(amp * env * Math.PI / lambda * Math.sin(phi));
          let axe = cross(repos, [0, 1, 0]);
          R_ = norm(axe) < 1e-9 ? I3() : rotvec(axe, pente);
        } else {
          R_ = Ry(Math.atan(amp * env * 2 * Math.PI / lambda * Math.cos(phi)) - kappa * sm);
        }
        p = add(p, mv(mm(Rc, R_), repos));
        pts.push(p);
      }
      // la tête mène le chemin ; la colonne garde sa hauteur de repos (bosses au-dessus du sol)
      const tete = add(P0[chemin[0]], c);
      const Xi = pts.map((q) => add(tete, q));
      const creux = Math.min(...Xi.map((q, k) => q[1] - P0[chemin[k]][1]));
      Xi.forEach((q, k) => { q[1] -= creux; X[k][i] = q; });
    }
    chemin.forEach((j, k) => positions.set(j, X[k]));
    // rotation de chaque joint de la colonne : aligne ses os de colonne (1 ou 2 enfants sur le chemin)
    const surChemin = new Set(chemin);
    for (const j of chemin) {
      const enfantsC = E[j].filter((c) => surChemin.has(c));
      if (!enfantsC.length) continue;
      const Pj = positions.get(j);
      rotImposees.set(j, t.map((_, i) => {
        if (enfantsC.length === 1) {
          const c = enfantsC[0];
          return alignerLacet(sub(P0[c], P0[j]), sub(positions.get(c)[i], Pj[i]));
        }
        const [a, b] = enfantsC;
        return alignerLacet(sub(P0[b], P0[a]), sub(positions.get(b)[i], positions.get(a)[i]));
      }));
    }
  }
  // rigide (ou tout os hors colonne) : le corps entier suit le chemin avec un léger balancement
  const bob = t.map((tt) => (pas ? 0.02 : 0.01) * H * Math.sin(2 * Math.PI * 2 * tt / T));
  const Rb = t.map((tt, i) => mm(Ry(cheminCorps(tt).cap), mode === 'rigide' ? mm(Rz(0.03 * Math.sin(2 * Math.PI * tt / T)), Rx(0.02 * Math.sin(4 * Math.PI * tt / T))) : I3()));
  const ordre = [], file = [...sq.racines];
  while (file.length) { const j = file.shift(); ordre.push(j); file.push(...E[j]); }
  const racineMonde = t.map((tt, i) => {
    if (positions.has(racine)) return positions.get(racine)[i];
    return add(add(P0[racine], cheminCorps(tt).c), [0, mode === 'rigide' ? bob[i] : 0, 0]);
  });
  for (let i = 0; i < nT; i++) {
    for (const j of ordre) {
      if (rotImposees.has(j)) D[i][j] = rotImposees.get(j)[i];
      else if (par[j] < 0) D[i][j] = mode === 'reptation' && positions.size ? (rotImposees.get(chemin[0])?.[i] || Rb[i]) : Rb[i];
      else D[i][j] = D[i][par[j]];
    }
  }
  // racine hors colonne : elle suit rigidement le premier joint de colonne qu'elle porte
  if (mode === 'reptation' && !positions.has(racine)) {
    const proche = chemin.reduce((m, k) => (norm(sub(P0[k], P0[racine])) < norm(sub(P0[m], P0[racine])) ? k : m), chemin[0]);
    for (let i = 0; i < nT; i++) {
      const Dp = D[i][proche];
      racineMonde[i] = add(positions.get(proche)[i], mv(Dp, sub(P0[racine], P0[proche])));
      for (let k = racine; k >= 0 && k !== proche;) { D[i][k] = Dp; break; }
    }
    for (let i = 0; i < nT; i++) for (const j of ordre) if (!rotImposees.has(j) && par[j] >= 0) D[i][j] = D[i][par[j]];
  }
  const R = D.map((Di) => Di.map((Dj, j) => (par[j] < 0 ? Dj : mm(tr(Di[par[j]]), Dj))));
  const racinesSec = sq.racines.filter((r) => r !== racine).map((r) => ({ j: r, pos: t.map((tt, i) => add(add(P0[r], cheminCorps(tt).c), [0, bob[i], 0])) }));
  // contrôles
  const Pw = D.map(() => new Array(J));
  for (let i = 0; i < nT; i++) for (const j of ordre) {
    if (j === racine) Pw[i][j] = racineMonde[i];
    else if (par[j] < 0) Pw[i][j] = racinesSec.find((x) => x.j === j).pos[i];
    else Pw[i][j] = add(Pw[i][par[j]], mv(D[i][par[j]], sub(P0[j], P0[par[j]])));
  }
  let sousSol = 0, pireOs = -1, acoups = 0;
  for (let i = 0; i < nT; i++) for (let j = 0; j < J; j++) if (sol - Pw[i][j][1] > sousSol) { sousSol = sol - Pw[i][j][1]; pireOs = j; }
  for (const j of chemin) {
    let prec = null;
    for (let i = 1; i < nT; i++) {
      const w_ = angleRot(mm(tr(D[i - 1][j]), D[i][j]));
      if (prec !== null) acoups = Math.max(acoups, Math.abs(w_ - prec));
      prec = w_;
    }
  }
  const infos = {
    mode, pattes: 0, pedipalpes: 0, queues: 0, tetes: 0, bras: 0, colonne: chemin.length,
    periode: T, foulee: +(v * T).toFixed(3), images: nT,
    sous_sol_pct: +(100 * sousSol / H).toFixed(1), pire_os: pireOs, glissement_appui_pct: 0, acoups_max_deg: +(acoups * 180 / Math.PI).toFixed(1),
  };
  return { nom: variante === 'normal' ? allure : `${allure}__${variante}`, R, racineMonde, racinesSec, infos };
}

/** Calcul protégé : une allure qui échoue ou rend une valeur invalide donne un mouvement minimal. */
function animerAllureSure(sq, allure, cycles, fps, variante, mode = 'auto') {
  const fini = (c) => c.R.every((Ri) => Ri.every((m) => m.every(Number.isFinite))) && c.racineMonde.every((p) => p.every(Number.isFinite));
  // nom du clip selon ce qu'il est vraiment : « swim » pour un poisson, « slither » pour un serpent
  const nommer = (c) => {
    const table = NOMS_PAR_MODE[mode === 'nage' ? 'nage' : c.infos.mode === 'reptation' ? 'reptation' : ''];
    if (table && table[allure]) c.nom = table[allure] + (variante === 'normal' ? '' : '__' + variante);
    c.infos.deplacement = mode === 'nage' ? 'nage' : c.infos.mode === 'reptation' ? 'reptation' : 'pattes';
    return c;
  };
  try {
    const c = mode === 'nage' || mode === 'reptation'
      ? animerSansPattes(sq, allure, cycles, fps, variante, detecterPattes(sq.par, sq.P0, sq.racine), 'reptation', mode === 'nage')
      : animerAllure(sq, allure, cycles, fps, variante);
    if (fini(c)) return nommer(c);
    throw new Error('valeur invalide dans le calcul');
  } catch (e) {
    const det = detecterPattes(sq.par, sq.P0, sq.racine);
    const c = animerSansPattes(sq, allure, cycles, fps, variante, det, 'rigide');
    c.infos.mode = 'secours';
    c.infos.erreur = String(e?.message || e);
    return c;
  }
}

// ------------------------------------------------------------------ pistes locales d'un clip
// Rotations LOCALES de chaque nœud (quaternions x, y, z, w) et translation de la racine dans le
// repère de son parent : ce qu'écrit le GLB, et ce que joue directement le mini-lecteur.
function pistesLocales(sq, { nom, R, racineMonde, racinesSec = [] }, fps) {
  const nT = R.length;
  const temps = Float32Array.from({ length: nT }, (_, i) => i / fps);
  const rotations = sq.joints.map((n, u) => {
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
    return { noeud: n, q };
  });
  const racineNoeud = sq.joints[sq.racine];
  const pn = sq.parent.get(racineNoeud);
  const inv = pn !== undefined ? inv4(sq.W.get(pn)) : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const v = new Float32Array(3 * nT);
  racineMonde.forEach((p, i) => v.set(add(mv(rot4(inv), p), pos4(inv)), 3 * i));
  const translationsSec = racinesSec.map(({ j, pos }) => {
    const n = sq.joints[j], pn2 = sq.parent.get(n);
    const inv2 = pn2 !== undefined ? inv4(sq.W.get(pn2)) : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const v2 = new Float32Array(3 * nT);
    pos.forEach((p, i) => v2.set(add(mv(rot4(inv2), p), pos4(inv2)), 3 * i));
    return { noeud: n, v: v2 };
  });
  return { nom, duree: (nT - 1) / fps, temps, rotations, translation: { noeud: sq.joints[sq.racine], v: v }, translationsSec };
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
  json.animations = [];
  for (const clip of clips) {
    const P = pistesLocales(sq, clip, fps);
    const temps = ajouter(P.temps, 'SCALAR', true);
    const samplers = [], channels = [];
    for (const { noeud, q } of P.rotations) {
      samplers.push({ input: temps, output: ajouter(q, 'VEC4'), interpolation: 'LINEAR' });
      channels.push({ sampler: samplers.length - 1, target: { node: noeud, path: 'rotation' } });
    }
    for (const tr_ of [P.translation, ...P.translationsSec]) {
      samplers.push({ input: temps, output: ajouter(tr_.v, 'VEC3'), interpolation: 'LINEAR' });
      channels.push({ sampler: samplers.length - 1, target: { node: tr_.noeud, path: 'translation' } });
    }
    json.animations.push({ name: P.nom, samplers, channels });
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
 * @param {{allures?: string[], cycles?: number, fps?: number}} options  allures : « walk » ou « walk__sneak » (variante)
 * @returns {{glb: ArrayBuffer, infos: Object<string, object>}}  GLB d'origine + une animation par allure
 */
export function animerGLB(glb, { allures = Object.keys(ALLURES), cycles = 3, fps = 30, mode = 'auto' } = {}) {
  const sq = charger(glb);
  const clips = [], infos = {};
  for (const nom of allures) {
    const { allure: a, variante } = lireClip(nom);
    if (!ALLURES[a]) throw new Error('allure inconnue : ' + a);
    if (!(VARIANTES[a] || {})[variante]) throw new Error('variante inconnue : ' + nom);
    const clip_ = animerAllureSure(sq, a, a === 'idle' ? 1 : cycles, fps, variante, mode);
    clips.push(clip_);
    infos[clip_.nom] = clip_.infos;
  }
  return { glb: ecrireGLB(sq, clips, fps), infos };
}

const _cacheSquelettes = new WeakMap();
/**
 * Pistes d'animation SEULES (sans réécrire le GLB), pour un aperçu : même calcul qu'animerGLB.
 * @returns {{clips: Array<{nom, duree, temps, rotations: Array<{noeud, q}>, translation: {noeud, v}}>, infos}}
 */
export function animerPistes(glb, { allures = ['walk'], cycles = 2, fps = 30, mode = 'auto' } = {}) {
  let sq = _cacheSquelettes.get(glb);
  if (!sq) { sq = charger(glb); _cacheSquelettes.set(glb, sq); }
  const clips = [], infos = {};
  for (const nom of allures) {
    const { allure: a, variante } = lireClip(nom);
    if (!ALLURES[a] || !(VARIANTES[a] || {})[variante]) throw new Error('allure inconnue : ' + nom);
    const c = animerAllureSure(sq, a, a === 'idle' ? 1 : cycles, fps, variante, mode);
    clips.push(pistesLocales(sq, c, fps));
    infos[c.nom] = c.infos;
  }
  return { clips, infos };
}

// diagnostic (tests hors appli)
export const __interne = { charger, detecterPattes };
