// BOUCHAGE DE TROUS NON DESTRUCTIF (2026-10-21) — jumeau JavaScript de scripts/bouchage_trous.py (= modal_app/bouchage_trous.py).
// FICHIER COMMUN bureau / web (src/renderer/lib = cloud/public/app/lib, build/check-noyaux-partages.mjs).
//
// POURQUOI. Le projet avait CINQ detecteurs de trous (deux apercus, deux Python, un bouchage « sur l'appareil ») qui ne partageaient ni
// tolerance, ni regle de boucle, ni sens des curseurs : l'apercu montrait un bouchage, le serveur en faisait un autre (et, sur l'orc de
// 512 000 faces, supprimait 11,9 % des faces et reecrivait 38 % des UV). Ce module est la MEME logique que le Python : les apercus (bureau ET
// site) l'appellent, donc ce qu'ils montrent est ce qui sera ajoute.
//
// CE QUE FAIT LE MODULE : il LIT positions + indices et rend des FACES A AJOUTER (jamais de face retiree, de sommet deplace ou ajoute, d'UV
// modifiee). Les rustines sont orientees a l'inverse des faces de rive et ne contiennent aucun triangle retourne ; les boucles degenerees
// (aire nulle) sont ignorees. Voir l'en-tete du module Python pour le detail des modes (triangle, quad, optimal, oreilles).
//
// MEMES NOMS DE CLES que le module Python (snake_case) : build/bouchage_attendus.json (ecrit par build/bancs/noyaux/test_bouchage_trous.py) et
// tests/bureau-interface/bouchage-trous.test.mjs verifient que les deux langages donnent les memes sorties. Les formules sont ecrites dans le
// meme ordre que le Python (pas de Math.hypot, pas de ** : memes arrondis).

export const VERSION = 1;
export const TOL_ARETE = 0.02;
export const SEUIL_PLAT = 0.05;
export const BRUIT_FLOAT32 = 8 * 1.2e-7;
export const TAILLE_OPTIMALE_MAX = 48;
export const TAILLE_MAX = 5000;
// BUDGET DE TRAVAIL (voir le module Python) : calcule sur les tailles, jamais sur l'horloge. Unite = 0,1 microseconde de Python.
export const BUDGET_TRAVAIL = 250000000;
const EPS_QUALITE = 1e-9;
const SQRT3 = Math.sqrt(3.0);
export const CATEGORIES = ['a_boucher', 'trop_petite', 'trop_grande', 'degeneree', 'non_triangulable'];

// ------------------------------------------------------------------------------------------------------------------------------------------
// Preparation : soudure par position, aretes de la copie d'analyse
// ------------------------------------------------------------------------------------------------------------------------------------------
export function arete_moyenne(P, F) {
  const m = Math.floor(F.length / 3);
  let somme = 0, nb = 0;
  for (let f = 0; f < m; f++) {
    for (let c = 0; c < 3; c++) {
      const a = F[f * 3 + c], b = F[f * 3 + (c + 1) % 3];
      const dx = P[b * 3] - P[a * 3], dy = P[b * 3 + 1] - P[a * 3 + 1], dz = P[b * 3 + 2] - P[a * 3 + 2];
      const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (l > 0) { somme += l; nb++; }
    }
  }
  return nb ? somme / nb : 0.0;
}

/** Numero de groupe par sommet (distance <= tol, fermeture transitive), numerotes dans l'ordre de leur premier sommet.
 *  Grille spatiale a cles NUMERIQUES (3 x 17 bits, exacts en double) : une recherche par chaine prenait plusieurs secondes sur 250 000 sommets. */
export function souder_par_position(P, tol) {
  const n = Math.floor(P.length / 3);
  const groupe = new Int32Array(n);
  if (!(tol > 0) || n === 0) { for (let i = 0; i < n; i++) groupe[i] = i; return groupe; }
  let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    if (x < mnx) mnx = x; if (x > mxx) mxx = x;
    if (y < mny) mny = y; if (y > mxy) mxy = y;
    if (z < mnz) mnz = z; if (z > mxz) mxz = z;
  }
  const R = 131072;                                    // 2^17 cellules par axe
  const etendue = Math.max(mxx - mnx, mxy - mny, mxz - mnz);
  const cote = Math.max(tol, etendue / (R - 4));       // cellule plus grande que tol si l'etendue l'exige (le voisinage 3 x 3 x 3 couvre toujours tol)
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const trouve = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const grille = new Map();
  const tol2 = tol * tol;
  const R2 = R * R;
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    const cx = Math.floor((x - mnx) / cote) + 1, cy = Math.floor((y - mny) / cote) + 1, cz = Math.floor((z - mnz) / cote) + 1;
    const cle = cx * R2 + cy * R + cz;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const liste = grille.get(cle + dx * R2 + dy * R + dz);
      if (liste === undefined) continue;
      for (let t = 0; t < liste.length; t++) {
        const j = liste[t];
        const ex = P[j * 3] - x, ey = P[j * 3 + 1] - y, ez = P[j * 3 + 2] - z;
        if (ex * ex + ey * ey + ez * ez <= tol2) {
          const ri = trouve(i), rj = trouve(j);
          if (ri !== rj) { if (ri < rj) parent[rj] = ri; else parent[ri] = rj; }
        }
      }
    }
    const l = grille.get(cle);
    if (l !== undefined) l.push(i); else grille.set(cle, [i]);
  }
  // la racine est toujours le plus petit sommet du groupe : numerotation par premier sommet
  const numero = new Int32Array(n).fill(-1);
  let g = 0;
  for (let i = 0; i < n; i++) {
    const r = trouve(i);
    if (numero[r] < 0) numero[r] = g++;
    groupe[i] = numero[r];
  }
  return groupe;
}

/** Copie d'analyse. `positions` : [x, y, z, ...] ; `indices` : [a, b, c, ...]. Ne modifie jamais ses entrees. */
export function preparer(positions, indices, tol) {
  const n = Math.floor(positions.length / 3);
  const m = Math.floor(indices.length / 3);
  const arete = arete_moyenne(positions, indices);
  if (tol === undefined || tol === null) tol = TOL_ARETE * arete;
  tol = Number(tol);
  const groupe = souder_par_position(positions, tol);
  let nG = 0;
  for (let i = 0; i < n; i++) if (groupe[i] + 1 > nG) nG = groupe[i] + 1;
  const idx = [];
  for (let f = 0; f < m; f++) {
    const a = groupe[indices[f * 3]], b = groupe[indices[f * 3 + 1]], c = groupe[indices[f * 3 + 2]];
    if (a !== b && b !== c && a !== c) idx.push(f);
  }
  const mm = idx.length;
  const Fw = new Int32Array(mm * 3);
  const ea = new Int32Array(mm * 3), eb = new Int32Array(mm * 3);
  for (let k = 0; k < mm; k++) {
    const f = idx[k];
    for (let c = 0; c < 3; c++) Fw[k * 3 + c] = groupe[indices[f * 3 + c]];
    for (let c = 0; c < 3; c++) { ea[k * 3 + c] = Fw[k * 3 + c]; eb[k * 3 + c] = Fw[k * 3 + (c + 1) % 3]; }
  }
  const grandG = Math.max(nG, 1);
  const ids = new Map();
  const inv = new Int32Array(mm * 3);
  const cnt = [];
  for (let e = 0; e < mm * 3; e++) {
    const a = ea[e], b = eb[e];
    const cle = (a < b ? a : b) * grandG + (a < b ? b : a);
    let id = ids.get(cle);
    if (id === undefined) { id = cnt.length; ids.set(cle, id); cnt.push(0); }
    cnt[id]++;
    inv[e] = id;
  }
  return { positions, indices, n, m, tol, arete_moyenne: arete, groupe, nG, idxF: Int32Array.from(idx), Fw, ea, eb, inv, cnt, ids };
}

// ------------------------------------------------------------------------------------------------------------------------------------------
// Pourtours
// ------------------------------------------------------------------------------------------------------------------------------------------
function _pourtours(prep) {
  const { ea, eb, inv, cnt } = prep;
  const bord = [];
  for (let e = 0; e < ea.length; e++) if (cnt[inv[e]] === 1) bord.push(e);
  const nb = bord.length;
  if (nb === 0) return { cycles: [], ouvertes: 0, fermees: 0, nb };
  const A = bord.map((e) => ea[e]), B = bord.map((e) => eb[e]);
  const sortants = new Map(), sortie = new Map(), entree = new Map();
  for (let k = 0; k < nb; k++) {
    const l = sortants.get(A[k]); if (l) l.push(k); else sortants.set(A[k], [k]);
    sortie.set(A[k], (sortie.get(A[k]) || 0) + 1);
    entree.set(B[k], (entree.get(B[k]) || 0) + 1);
  }
  const utilise = new Array(nb).fill(false);
  const suivantLibre = new Map();
  const cycles = [];
  let ouvertes = 0, fermees = 0;
  const grandG = Math.max(prep.nG, 1);
  // une chaine dont les deux bouts sont relies par une arete EXISTANTE (au moins deux faces) est fermee par elle (arete virtuelle, -1)
  const corde = (u, w) => {
    const id = prep.ids.get((u < w ? u : w) * grandG + (u < w ? w : u));
    return id !== undefined && prep.cnt[id] >= 2;
  };
  const marcher = (k0) => {
    let aretes = [];
    let sommets = [A[k0]];
    const position = new Map([[A[k0], 0]]);
    let k = k0;
    for (;;) {
      utilise[k] = true;
      sortie.set(A[k], sortie.get(A[k]) - 1);
      entree.set(B[k], entree.get(B[k]) - 1);
      aretes.push(k);
      const v = B[k];
      if (position.has(v)) {
        const p = position.get(v);
        cycles.push(aretes.slice(p));
        aretes = aretes.slice(0, p);
        for (let s = p + 1; s < sommets.length; s++) position.delete(sommets[s]);
        sommets = sommets.slice(0, p + 1);
      } else {
        position.set(v, sommets.length);
        sommets.push(v);
      }
      const courant = sommets[sommets.length - 1];
      const liste = sortants.get(courant) || [];
      let i = suivantLibre.get(courant) || 0;
      while (i < liste.length && utilise[liste[i]]) i++;
      suivantLibre.set(courant, i);
      if (i >= liste.length) {
        if (aretes.length) {
          if (corde(B[aretes[aretes.length - 1]], A[aretes[0]])) { cycles.push(aretes.concat([-1])); fermees++; }
          else ouvertes++;
        }
        return;
      }
      k = liste[i];
    }
  };
  for (let k0 = 0; k0 < nb; k0++) if (!utilise[k0] && sortie.get(A[k0]) > (entree.get(A[k0]) || 0)) marcher(k0);   // 1. les chaines
  for (let k0 = 0; k0 < nb; k0++) if (!utilise[k0]) marcher(k0);                                                  // 2. le reste : des cycles
  return { cycles: cycles.map((c) => c.map((k) => (k >= 0 ? bord[k] : -1))), ouvertes, fermees, nb };
}

// ------------------------------------------------------------------------------------------------------------------------------------------
// Triangulation d'un pourtour
// ------------------------------------------------------------------------------------------------------------------------------------------
function _newell(P) {
  let nx = 0.0, ny = 0.0, nz = 0.0;
  const n = P.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1, z1] = P[i];
    const [x2, y2, z2] = P[(i + 1) % n];
    nx += (y1 - y2) * (z1 + z2);
    ny += (z1 - z2) * (x1 + x2);
    nz += (x1 - x2) * (y1 + y2);
  }
  return [nx, ny, nz];
}

function _tri(P, N, i, k, j) {
  const [ax, ay, az] = P[i];
  const [bx, by, bz] = P[k];
  const [cx, cy, cz] = P[j];
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  const qx = uy * vz - uz * vy;
  const qy = uz * vx - ux * vz;
  const qz = ux * vy - uy * vx;
  const a2 = Math.sqrt(qx * qx + qy * qy + qz * qz);
  const wx = cx - bx, wy = cy - by, wz = cz - bz;
  let s = ux * ux + uy * uy + uz * uz;
  s += wx * wx + wy * wy + wz * wz;
  s += vx * vx + vy * vy + vz * vz;
  const q = s > 0 ? (2.0 * SQRT3 * a2) / s : 0.0;
  const d = qx * N[0] + qy * N[1] + qz * N[2];
  const mauvais = d <= 0 ? 2.0 : 1.0 - q;
  return [mauvais, 0.5 * a2];
}

function _optimale(P, N) {
  const n = P.length;
  const mb = [], ar = [], kk = [];
  for (let i = 0; i < n; i++) { mb.push(new Array(n).fill(0.0)); ar.push(new Array(n).fill(0.0)); kk.push(new Array(n).fill(0)); }
  for (let longueur = 2; longueur < n; longueur++) {
    for (let i = 0; i < n - longueur; i++) {
      const j = i + longueur;
      let bmx = 0.0, bar = 0.0, bk = -1;
      for (let k = i + 1; k < j; k++) {
        const [m, a] = _tri(P, N, i, k, j);
        let mx = m;
        if (mb[i][k] > mx) mx = mb[i][k];
        if (mb[k][j] > mx) mx = mb[k][j];
        const ai = a + ar[i][k] + ar[k][j];
        let prendre;
        if (bk < 0) prendre = true;
        else if (mx < bmx - EPS_QUALITE) prendre = true;
        else if (mx <= bmx + EPS_QUALITE && ai < bar - 1e-12 * bar) prendre = true;
        else prendre = false;
        if (prendre) { bmx = mx; bar = ai; bk = k; }
      }
      mb[i][j] = bmx; ar[i][j] = bar; kk[i][j] = bk;
    }
  }
  const triangles = [];
  const pile = [[0, n - 1]];
  while (pile.length) {
    const [i, j] = pile.pop();
    if (j - i < 2) continue;
    const k = kk[i][j];
    triangles.push([i, k, j]);
    pile.push([k, j]);
    pile.push([i, k]);
  }
  return triangles;
}

/** Tas binaire ordonne par (mauvais, i, stamp) — meme ordre que heapq sur des tuples Python. */
class Tas {
  constructor() { this.t = []; }
  get length() { return this.t.length; }
  static avant(a, b) { return a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2]))); }
  push(x) {
    const t = this.t; t.push(x);
    let i = t.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (Tas.avant(t[i], t[p])) { [t[i], t[p]] = [t[p], t[i]]; i = p; } else break; }
  }
  pop() {
    const t = this.t; const haut = t[0]; const dernier = t.pop();
    if (t.length) {
      t[0] = dernier; let i = 0;
      for (;;) {
        const g = 2 * i + 1, d = g + 1; let m = i;
        if (g < t.length && Tas.avant(t[g], t[m])) m = g;
        if (d < t.length && Tas.avant(t[d], t[m])) m = d;
        if (m === i) break;
        [t[i], t[m]] = [t[m], t[i]]; i = m;
      }
    }
    return haut;
  }
}

function _oreilles(P, N) {
  const n = P.length;
  const nl = Math.sqrt(N[0] * N[0] + N[1] * N[1] + N[2] * N[2]);
  if (!(nl > 0)) return null;
  const nx = N[0] / nl, ny = N[1] / nl, nz = N[2] / nl;
  const ax_ = Math.abs(nx), ay_ = Math.abs(ny), az_ = Math.abs(nz);
  let ex, ey, ez;
  if (ax_ <= ay_ && ax_ <= az_) { ex = 1.0; ey = 0.0; ez = 0.0; }
  else if (ay_ <= az_) { ex = 0.0; ey = 1.0; ez = 0.0; }
  else { ex = 0.0; ey = 0.0; ez = 1.0; }
  let ux = ny * ez - nz * ey, uy = nz * ex - nx * ez, uz = nx * ey - ny * ex;
  const ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
  ux = ux / ul; uy = uy / ul; uz = uz / ul;
  const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
  const X = P.map((p) => p[0] * ux + p[1] * uy + p[2] * uz);
  const Y = P.map((p) => p[0] * vx + p[1] * vy + p[2] * vz);
  let xmin = X[0], xmax = X[0], ymin = Y[0], ymax = Y[0];
  for (let i = 1; i < n; i++) {
    if (X[i] < xmin) xmin = X[i]; if (X[i] > xmax) xmax = X[i];
    if (Y[i] < ymin) ymin = Y[i]; if (Y[i] > ymax) ymax = Y[i];
  }
  const echelle = Math.max(xmax - xmin, ymax - ymin);
  const eps = 1e-12 * echelle * echelle;
  const prec = [], suiv = [];
  for (let i = 0; i < n; i++) { prec.push(((i - 1) % n + n) % n); suiv.push((i + 1) % n); }
  const vivant = new Array(n).fill(true);
  const stamp = new Array(n).fill(0);
  const croix = (a, b, c) => (X[b] - X[a]) * (Y[c] - Y[a]) - (Y[b] - Y[a]) * (X[c] - X[a]);
  const convexe = (i) => croix(prec[i], i, suiv[i]) > eps;
  const reflexes = new Set();
  for (let i = 0; i < n; i++) if (!convexe(i)) reflexes.add(i);
  const proche = (a, b) => { const dx = X[a] - X[b], dy = Y[a] - Y[b]; return dx * dx + dy * dy <= eps; };
  const estOreille = (i) => {
    if (!convexe(i)) return false;
    const p = prec[i], q = suiv[i];
    for (const r of reflexes) {
      if (r === p || r === q || r === i) continue;
      if (proche(r, p) || proche(r, i) || proche(r, q)) continue;
      if (croix(p, i, r) >= -eps && croix(i, q, r) >= -eps && croix(q, p, r) >= -eps) return false;
    }
    return true;
  };
  const tas = new Tas();
  const pousser = (i) => { if (estOreille(i)) { const [mauvais] = _tri(P, N, prec[i], i, suiv[i]); tas.push([mauvais, i, stamp[i]]); } };
  for (let i = 0; i < n; i++) pousser(i);
  const triangles = [];
  let restant = n;
  while (restant > 3) {
    if (tas.length === 0) {
      for (let i = 0; i < n; i++) if (vivant[i]) pousser(i);
      if (tas.length === 0) return null;
    }
    const [, i, st] = tas.pop();
    if (!vivant[i] || st !== stamp[i] || !estOreille(i)) continue;
    const p = prec[i], q = suiv[i];
    triangles.push([p, i, q]);
    vivant[i] = false;
    reflexes.delete(i);
    suiv[p] = q; prec[q] = p;
    restant--;
    stamp[p]++; stamp[q]++;
    for (const s of [p, q]) { if (convexe(s)) reflexes.delete(s); else reflexes.add(s); }
    pousser(p); pousser(q);
  }
  let v = 0;
  while (!vivant[v]) v++;
  triangles.push([v, suiv[v], suiv[suiv[v]]]);
  return triangles;
}

function _sansRetourne(P, N, triangles) {
  for (const [a, b, c] of triangles) if (_tri(P, N, a, b, c)[0] >= 2.0) return false;
  return true;
}

/** Triangule le polygone P ([[x, y, z], ...], dans l'ordre de la RUSTINE). Rend [mode, triangles] ou null. */
export function trianguler(P) {
  const n = P.length;
  let cx = 0.0, cy = 0.0, cz = 0.0;
  for (const [x, y, z] of P) { cx += x; cy += y; cz += z; }
  cx = cx / n; cy = cy / n; cz = cz / n;
  const Q = P.map(([x, y, z]) => [x - cx, y - cy, z - cz]);
  const N = _newell(Q);
  if (!(N[0] * N[0] + N[1] * N[1] + N[2] * N[2] > 0)) return null;
  if (n <= TAILLE_OPTIMALE_MAX) {
    const triangles = _optimale(Q, N);
    if (_sansRetourne(Q, N, triangles)) return [n === 3 ? 'triangle' : n === 4 ? 'quad' : 'optimal', triangles];
  }
  const triangles = _oreilles(Q, N);
  if (triangles !== null && _sansRetourne(Q, N, triangles)) return ['oreilles', triangles];
  return null;
}

// ------------------------------------------------------------------------------------------------------------------------------------------
// Analyse complete
// ------------------------------------------------------------------------------------------------------------------------------------------
function _sommetsRustine(n, riveDebut, riveFin, triangle) {
  const arete = new Set();
  for (let s = 0; s < 3; s++) {
    const u = triangle[s], v = triangle[(s + 1) % 3];
    if (v === (u + 1) % n) arete.add(u);
  }
  const sortie = [];
  for (const x of triangle) {
    const entrante = arete.has(((x - 1) % n + n) % n);
    const sortante = arete.has(x);
    if (sortante && !entrante) sortie.push(riveFin[n - 1 - ((x + 1) % n)]);
    else sortie.push(riveDebut[n - 1 - x]);
  }
  return sortie;
}

/** Vrai si ces trois sommets (indices d'origine) forment, une fois soudes, une face DEJA presente (voir le Python). */
function _estUneFace(prep, sommets) {
  if (!prep._triples) {
    prep._triples = new Set();
    const { Fw } = prep;
    for (let f = 0; f < Fw.length; f += 3) prep._triples.add([Fw[f], Fw[f + 1], Fw[f + 2]].sort((a, b) => a - b).join(','));
  }
  return prep._triples.has(sommets.map((v) => prep.groupe[v]).sort((a, b) => a - b).join(','));
}

/** Travail prevu pour trianguler un pourtour de n aretes (unites de 0,1 microseconde, voir BUDGET_TRAVAIL). */
export function cout_travail(n) {
  return n <= TAILLE_OPTIMALE_MAX ? (n - 2) * (n - 1) * n : 7 * n * n;
}

/** Pourtours, classement et faces a ajouter. Memes cles que le Python. `ajout` : liste de [a, b, c] (indices d'ORIGINE). */
export function analyser(positions, indices, min_aretes = 3, max_aretes = 2000, tol = null, prep = null, budget = null) {
  if (!prep) prep = preparer(positions, indices, tol);
  let reste = budget === null || budget === undefined ? BUDGET_TRAVAIL : Math.trunc(budget);
  const V = prep.positions, F = prep.indices;
  min_aretes = Math.max(3, Math.trunc(min_aretes));
  max_aretes = Math.max(min_aretes, Math.trunc(max_aretes));
  const plafond = Math.min(max_aretes, TAILLE_MAX);
  const { cycles, ouvertes, fermees, nb } = _pourtours(prep);
  const idxF = prep.idxF;
  tol = prep.tol;
  let maxabs = 0.0;
  for (let i = 0; i < V.length; i++) { const a = Math.abs(V[i]); if (a > maxabs) maxabs = a; }
  const seuilPlat = Math.max(SEUIL_PLAT * tol, BRUIT_FLOAT32 * maxabs);
  const boucles = [];
  const ajout = [];
  const modes = { triangle: 0, quad: 0, optimal: 0, oreilles: 0, lisse: 0 };
  for (const cycle of cycles) {
    const n = cycle.length;
    const reels = cycle.filter((e) => e >= 0);
    const faces = reels.map((e) => idxF[Math.floor(e / 3)]);
    const coins = reels.map((e) => e % 3);
    const debut = faces.map((f, k) => F[f * 3 + coins[k]]);
    const fin = faces.map((f, k) => F[f * 3 + (coins[k] + 1) % 3]);
    if (reels.length < n) { debut.push(fin[fin.length - 1]); fin.push(debut[0]); }   // chaine fermee par une arete existante : arete virtuelle
    const pts = debut.map((v) => [V[v * 3], V[v * 3 + 1], V[v * 3 + 2]]);
    let cx = 0.0, cy = 0.0, cz = 0.0;
    for (const p of pts) { cx += p[0]; cy += p[1]; cz += p[2]; }
    cx = cx / n; cy = cy / n; cz = cz / n;
    let aire = 0.0, perimetre = 0.0;
    for (let j = 0; j < n; j++) {
      const a = pts[j], b = pts[(j + 1) % n];
      const ux = a[0] - cx, uy = a[1] - cy, uz = a[2] - cz;
      const vx = b[0] - cx, vy = b[1] - cy, vz = b[2] - cz;
      const qx = uy * vz - uz * vy;
      const qy = uz * vx - ux * vz;
      const qz = ux * vy - uy * vx;
      aire += 0.5 * Math.sqrt(qx * qx + qy * qy + qz * qz);
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
      perimetre += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    const item = { n, debut, aire, perimetre, categorie: null, mode: null, triangles: [], chaine: reels.length < n };
    if (!(perimetre > 0) || (2.0 * aire) / perimetre < seuilPlat || (item.chaine && n === 3 && _estUneFace(prep, debut))) item.categorie = 'degeneree';   // (dernier cas : l'ailette d'un triangle)
    else if (n < min_aretes) item.categorie = 'trop_petite';
    else if (n > plafond) item.categorie = 'trop_grande';
    else if (cout_travail(n) > reste) item.categorie = 'non_triangulable';   // budget de travail epuise : ce pourtour reste ouvert
    else {
      reste -= cout_travail(n);
      const res = trianguler(pts.slice().reverse());
      item.categorie = 'a_boucher';
      if (res === null) {
        // Pourtour non plan ou qui se replie : aucune triangulation plate valable, mais le bouchon lisse (scripts/bouchage_lisse.py) n'en a pas besoin.
        item.mode = 'lisse';
        modes.lisse++;
      } else {
        const [mode, triangles] = res;
        item.mode = mode;
        modes[mode]++;
        for (const t of triangles) {
          const s = _sommetsRustine(n, debut, fin, t);
          item.triangles.push(s);
          ajout.push(s);
        }
      }
    }
    boucles.push(item);
  }
  const compte = {};
  for (const c of CATEGORIES) compte[c] = 0;
  for (const b of boucles) compte[b.categorie]++;
  let plusPetite = 0, plusGrande = 0, vu = false;
  for (const b of boucles) {
    if (b.categorie === 'degeneree') continue;
    if (!vu || b.n < plusPetite) plusPetite = b.n;
    if (!vu || b.n > plusGrande) plusGrande = b.n;
    vu = true;
  }
  const restantes = compte.trop_petite + compte.trop_grande + compte.non_triangulable + ouvertes;
  let aretesNM = 0;
  for (let i = 0; i < prep.cnt.length; i++) if (prep.cnt[i] > 2) aretesNM++;
  return {
    version: VERSION,
    sommets: prep.n, faces: prep.m,
    tolerance: tol, arete_moyenne: prep.arete_moyenne,
    aretes_de_bord: nb,
    aretes_non_manifold: aretesNM,
    boucles,
    chaines_ouvertes: ouvertes, chaines_fermees: fermees,
    a_boucher: compte.a_boucher, trop_petites: compte.trop_petite, trop_grandes: compte.trop_grande,
    degenerees: compte.degeneree, non_triangulables: compte.non_triangulable,
    plus_petite: plusPetite, plus_grande: plusGrande,
    modes,
    ajout,
    faces_ajoutees: ajout.length,
    restantes,
    verdict: restantes > 0 ? 'OPEN_HOLES' : 'CLOSED_OK',
    min_aretes, max_aretes, plafond: TAILLE_MAX,
  };
}

// ------------------------------------------------------------------------------------------------------------------------------------------
// Diagnostic d'un maillage ferme
// ------------------------------------------------------------------------------------------------------------------------------------------
function _unionFind(n) {
  const p = new Int32Array(n);
  for (let i = 0; i < n; i++) p[i] = i;
  const trouve = (x) => { while (p[x] !== x) { p[x] = p[p[x]]; x = p[x]; } return x; };
  const unir = (a, b) => { const ra = trouve(a), rb = trouve(b); if (ra !== rb) p[ra < rb ? rb : ra] = ra < rb ? ra : rb; };
  return { trouve, unir };
}

export function diagnostiquer(prep, analyse = null) {
  const { Fw, ea, eb, inv, cnt } = prep;
  const m = Fw.length / 3;
  let nm = 0;
  for (let i = 0; i < cnt.length; i++) if (cnt[i] > 2) nm++;
  const sortie = {
    faces_analysees: m, aretes_non_manifold: nm, aretes_incoherentes: 0, feuilles: 0, faces_retournees: 0, composantes: 0,
    miettes: 0, faces_miettes: 0, boucles_degenerees: analyse ? analyse.degenerees : 0, cause: 'aucune',
  };
  if (m === 0) return sortie;
  const sgn = (e) => (ea[e] < eb[e] ? 1 : -1);
  const somme = new Float64Array(cnt.length);
  for (let e = 0; e < ea.length; e++) somme[inv[e]] += sgn(e);
  for (let i = 0; i < cnt.length; i++) if (cnt[i] === 2 && Math.abs(somme[i]) === 2) sortie.aretes_incoherentes++;
  const region = _unionFind(m), feuille = _unionFind(m);
  const premiere = new Int32Array(cnt.length).fill(-1);
  for (let e = 0; e < ea.length; e++) {
    const id = inv[e];
    if (cnt[id] !== 2) continue;
    if (premiere[id] < 0) { premiere[id] = e; continue; }
    const e0 = premiere[id];
    const fa = Math.floor(e0 / 3), fb = Math.floor(e / 3);
    region.unir(fa, fb);
    if (sgn(e0) + sgn(e) === 0) feuille.unir(fa, fb);
  }
  const tailleFeuille = new Map(), tailleRegion = new Map(), plusGrande = new Map();
  for (let f = 0; f < m; f++) {
    const sf = feuille.trouve(f), rg = region.trouve(f);
    tailleFeuille.set(sf, (tailleFeuille.get(sf) || 0) + 1);
    tailleRegion.set(rg, (tailleRegion.get(rg) || 0) + 1);
  }
  for (let f = 0; f < m; f++) {
    const rg = region.trouve(f), t = tailleFeuille.get(feuille.trouve(f));
    if (!(plusGrande.get(rg) >= t)) plusGrande.set(rg, t);
  }
  let retournees = 0;
  for (const [rg, t] of tailleRegion) retournees += t - plusGrande.get(rg);
  sortie.feuilles = tailleFeuille.size - tailleRegion.size;
  sortie.faces_retournees = retournees;
  // morceaux flottants : composantes par sommets partages
  const comp = _unionFind(prep.nG);
  for (let e = 0; e < ea.length; e++) comp.unir(ea[e], eb[e]);
  const facesParComp = new Map();
  for (let f = 0; f < m; f++) { const c = comp.trouve(Fw[f * 3]); facesParComp.set(c, (facesParComp.get(c) || 0) + 1); }
  let plusGros = 0;
  for (const t of facesParComp.values()) if (t > plusGros) plusGros = t;
  let miettes = 0, facesMiettes = 0;
  for (const t of facesParComp.values()) if (t < 0.01 * plusGros && t < plusGros) { miettes++; facesMiettes += t; }
  sortie.composantes = facesParComp.size;
  sortie.miettes = miettes;
  sortie.faces_miettes = facesMiettes;
  if (sortie.faces_retournees > 0) sortie.cause = 'retournees';
  else if (sortie.aretes_non_manifold > 0) sortie.cause = 'non_manifold';
  else if (sortie.miettes > 0) sortie.cause = 'miettes';
  return sortie;
}

// ------------------------------------------------------------------------------------------------------------------------------------------
// Refus expliques (memes textes que le Python ; l'interface les traduit par leur code, lib/textes-serveur.js)
// ------------------------------------------------------------------------------------------------------------------------------------------
export function agreger(analyses, diagnostics) {
  const somme = {};
  for (const k of ['a_boucher', 'trop_petites', 'trop_grandes', 'non_triangulables']) {
    somme[k] = 0;
    for (const a of analyses) somme[k] += Math.trunc(a[k]);
  }
  let petite = 0, grande = 0;
  for (const a of analyses) {
    if (a.plus_petite && (!petite || a.plus_petite < petite)) petite = a.plus_petite;
    if (a.plus_grande > grande) grande = a.plus_grande;
  }
  somme.plus_petite = petite;
  somme.plus_grande = grande;
  const ordre = ['retournees', 'non_manifold', 'miettes', 'aucune'];
  const diag = { cause: 'aucune', faces_retournees: 0, aretes_non_manifold: 0, miettes: 0 };
  for (const d of diagnostics) {
    for (const k of ['faces_retournees', 'aretes_non_manifold', 'miettes']) diag[k] += Math.trunc(d[k] || 0);
    if (ordre.indexOf(d.cause || 'aucune') < ordre.indexOf(diag.cause)) diag.cause = d.cause;
  }
  return [somme, diag];
}

export function message_refus(analyse, diagnostic, min_aretes, max_aretes) {
  if (analyse.trop_petites + analyse.trop_grandes > 0 && analyse.a_boucher === 0) {
    return ['fill_holes_range',
      'No hole between ' + Math.max(3, Math.trunc(min_aretes)) + ' and ' + Math.trunc(max_aretes) + ' edges: the mesh has '
      + (analyse.trop_petites + analyse.trop_grandes) + ' open hole(s) outside this range (smallest ' + analyse.plus_petite
      + ' edges, largest ' + analyse.plus_grande + '). Widen the range. The mesh was left unchanged.'];
  }
  if (analyse.non_triangulables > 0 && analyse.a_boucher === 0) {
    return ['fill_holes_unfillable',
      'Could not fill the ' + analyse.non_triangulables + ' open hole(s): their outline is too complex or folds over itself. The mesh was left unchanged.'];
  }
  const d = diagnostic || {};
  const cause = d.cause || 'aucune';
  if (cause === 'retournees') {
    return ['fill_holes_closed_flipped',
      'Nothing to fill: the mesh has no open hole, but ' + d.faces_retournees + ' faces point the wrong way (dark or see-through patches). '
      + 'Use Fix normals instead. The mesh was left unchanged.'];
  }
  if (cause === 'non_manifold') {
    return ['fill_holes_closed_nonmanifold',
      'Nothing to fill: the mesh has no open hole, but ' + d.aretes_non_manifold + ' edges are shared by more than two faces (double skin or glued parts). '
      + 'No hole in the outer skin was found either. The mesh was left unchanged.'];
  }
  if (cause === 'miettes') {
    return ['fill_holes_closed_debris',
      'Nothing to fill: the mesh has no open hole, but ' + d.miettes + ' small loose pieces float apart from the main body. '
      + 'The mesh was left unchanged.'];
  }
  return ['fill_holes_closed',
    'Nothing to fill: the mesh has no open hole. Missing or thin areas are not holes in the surface, so this tool cannot '
    + 'fix them. The mesh was left unchanged.'];
}

// ------------------------------------------------------------------------------------------------------------------------------------------
// Aides d'apercu (JavaScript seulement : le Python n'a pas d'ecran). Aucun calcul de plus : tout vient de l'analyse.
// ------------------------------------------------------------------------------------------------------------------------------------------
/** Segments (x1 y1 z1 x2 y2 z2 ...) des pourtours par couleur — vert : sera bouche ; gris : trop petit ; rouge : trop grand ou impossible a
 *  remplir — et triangles des rustines (9 nombres par triangle). Les boucles degenerees ne sont pas dessinees : il n'y a rien a boucher. */
export function rendu_apercu(analyse, positions) {
  const vert = [], gris = [], rouge = [], faces = [];
  const P = positions;
  const seg = (liste, a, b) => { liste.push(P[a * 3], P[a * 3 + 1], P[a * 3 + 2], P[b * 3], P[b * 3 + 1], P[b * 3 + 2]); };
  for (const b of analyse.boucles) {
    let liste = null;
    if (b.categorie === 'a_boucher') liste = vert;
    else if (b.categorie === 'trop_petite') liste = gris;
    else if (b.categorie === 'trop_grande' || b.categorie === 'non_triangulable') liste = rouge;
    if (!liste) continue;
    for (let j = 0; j < b.n; j++) seg(liste, b.debut[j], b.debut[(j + 1) % b.n]);
    if (b.categorie === 'a_boucher') {
      if (b.triangles.length) {
        for (const t of b.triangles) {
          for (const v of t) faces.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
        }
      } else {
        // Pourtour courbe ou replie : pas de triangulation plate (le bouchon lisse n'en a pas besoin), l'apercu le montre par un eventail depuis le centre.
        let cx = 0, cy = 0, cz = 0;
        for (let j = 0; j < b.n; j++) { cx += P[b.debut[j] * 3]; cy += P[b.debut[j] * 3 + 1]; cz += P[b.debut[j] * 3 + 2]; }
        cx /= b.n; cy /= b.n; cz /= b.n;
        for (let j = 0; j < b.n; j++) {
          const u = b.debut[j], w = b.debut[(j + 1) % b.n];
          faces.push(P[u * 3], P[u * 3 + 1], P[u * 3 + 2], P[w * 3], P[w * 3 + 1], P[w * 3 + 2], cx, cy, cz);
        }
      }
    }
  }
  return { vert, gris, rouge, faces };
}

/** Les indices d'origine suivis des faces a ajouter : exactement ce que le serveur ecrira (rien de retire). */
export function indices_avec_rustines(indices, analyse) {
  const sortie = new Uint32Array(indices.length + analyse.ajout.length * 3);
  for (let i = 0; i < indices.length; i++) sortie[i] = indices[i];
  let k = indices.length;
  for (const t of analyse.ajout) { sortie[k++] = t[0]; sortie[k++] = t[1]; sortie[k++] = t[2]; }
  return sortie;
}
