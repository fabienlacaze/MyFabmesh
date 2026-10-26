// Symetrie de maillage (outil « Symmetrize mesh », 25/10) : calculs PURS (nombres et tableaux, aucun THREE) de la fenetre.
// MEME fichier sur le bureau et le site (garde build/check-noyaux-partages.mjs). Le maillage lui-meme est coupe et recopie
// par scripts/symmetrize_mesh.py (bureau) / modal_app/_symetrie.py (site) ; ce module ne sert qu'a l'APERCU : orientation
// du plan, zone peinte au pinceau (les memes regles que region_faces en Python), tri des faces.
//
// Le plan : un axe de base (x, y ou z) puis deux inclinaisons en degres. La normale de base est l'axe ; « a » tourne la
// normale autour de l'axe LOCAL Y, « b » autour de l'axe local Z (dans cet ordre : Z d'abord, puis Y).

const RAD = Math.PI / 180;

/** Normale unitaire du plan [x, y, z] pour un axe de base ('x' | 'y' | 'z') et deux inclinaisons en degres. */
export function normaleDepuis(axe, a, b) {
  const ca = Math.cos(a * RAD), sa = Math.sin(a * RAD), cb = Math.cos(b * RAD), sb = Math.sin(b * RAD);
  const rx = cb * ca, ry = sb, rz = -cb * sa;           // normale quand l'axe de base est X
  if (axe === 'y') return [-ry, rx, rz];                // base tournee de +90 degres autour de Z : X -> Y
  if (axe === 'z') return [-rz, ry, rx];                // base tournee de -90 degres autour de Y : X -> Z
  return [rx, ry, rz];
}

/** Inverse de normaleDepuis : les inclinaisons {a, b} (degres) d'une normale donnee, pour un axe de base. */
export function anglesDepuis(axe, n) {
  let nx = n[0], ny = n[1], nz = n[2];
  const L = Math.hypot(nx, ny, nz) || 1;
  nx /= L; ny /= L; nz /= L;
  let rx = nx, ry = ny, rz = nz;
  if (axe === 'y') { rx = ny; ry = -nx; rz = nz; }
  else if (axe === 'z') { rx = nz; ry = ny; rz = -nx; }
  const b = Math.asin(Math.max(-1, Math.min(1, ry))) / RAD;
  const a = Math.abs(rx) < 1e-9 && Math.abs(rz) < 1e-9 ? 0 : Math.atan2(-rz, rx) / RAD;
  return { a, b };
}

/** Distance signee d'un point au plan (point P, normale unitaire n). */
export function distanceAuPlan(p, P, n) {
  return (p[0] - P[0]) * n[0] + (p[1] - P[1]) * n[1] + (p[2] - P[2]) * n[2];
}

/** Matrice 4x4 (ligne par ligne, 16 nombres) de la reflexion par le plan (point P, normale unitaire n). */
export function matriceMiroir(P, n) {
  const d = P[0] * n[0] + P[1] * n[1] + P[2] * n[2];
  const [x, y, z] = n;
  return [1 - 2 * x * x, -2 * x * y, -2 * x * z, 2 * d * x,
    -2 * y * x, 1 - 2 * y * y, -2 * y * z, 2 * d * y,
    -2 * z * x, -2 * z * y, 1 - 2 * z * z, 2 * d * z,
    0, 0, 0, 1];
}

/** Centres des faces (Float32Array de 3 par face), dans l'espace du modele : `positions` = tableau des sommets (3 par
 *  sommet), `index` = tableau d'indices ou null (maillage non indexe), `m` = matrice 4x4 ligne par ligne (16 nombres)
 *  du maillage vers l'espace du modele, ou null. */
export function centresDesFaces(positions, index, m) {
  const nTri = index ? Math.floor(index.length / 3) : Math.floor(positions.length / 9);
  const out = new Float32Array(nTri * 3);
  for (let t = 0; t < nTri; t++) {
    let sx = 0, sy = 0, sz = 0;
    for (let k = 0; k < 3; k++) {
      const v = (index ? index[t * 3 + k] : t * 3 + k) * 3;
      let x = positions[v], y = positions[v + 1], z = positions[v + 2];
      if (m) {
        const X = m[0] * x + m[1] * y + m[2] * z + m[3];
        const Y = m[4] * x + m[5] * y + m[6] * z + m[7];
        const Z = m[8] * x + m[9] * y + m[10] * z + m[11];
        x = X; y = Y; z = Z;
      }
      sx += x; sy += y; sz += z;
    }
    out[t * 3] = sx / 3; out[t * 3 + 1] = sy / 3; out[t * 3 + 2] = sz / 3;
  }
  return out;
}

/** Applique UN tampon [x, y, z, rayon, s] a une selection (Uint8Array, 1 par face) : s >= 0.5 allume les faces dont le
 *  centre est dans la sphere, sinon les eteint. `refl` = {P, n} : le centre du tampon est d'abord reflechi par le plan. */
export function appliquerTampon(sel, centres, tampon, refl) {
  let cx = tampon[0], cy = tampon[1], cz = tampon[2];
  if (refl) {
    const d = (cx - refl.P[0]) * refl.n[0] + (cy - refl.P[1]) * refl.n[1] + (cz - refl.P[2]) * refl.n[2];
    cx -= 2 * d * refl.n[0]; cy -= 2 * d * refl.n[1]; cz -= 2 * d * refl.n[2];
  }
  const r = tampon[3], r2 = r * r, v = tampon[4] >= 0.5 ? 1 : 0;
  const n = sel.length;
  for (let i = 0; i < n; i++) {
    const j = i * 3;
    const dx = centres[j] - cx;
    if (dx > r || dx < -r) continue;
    const dy = centres[j + 1] - cy;
    if (dy > r || dy < -r) continue;
    const dz = centres[j + 2] - cz;
    if (dz > r || dz < -r) continue;
    if (dx * dx + dy * dy + dz * dz <= r2) sel[i] = v;
  }
}

/** Zone peinte : les tampons appliques DANS L'ORDRE (peindre allume, gommer eteint). Meme regle que region_faces (Python). */
export function regionFaces(centres, tampons, refl) {
  const sel = new Uint8Array(Math.floor(centres.length / 3));
  for (const t of tampons || []) appliquerTampon(sel, centres, t, refl || null);
  return sel;
}

/** Cote de chaque face : Int8Array (+1 si le centre est du cote de la normale `n`, -1 de l'autre, 0 sur le plan a eps pres). */
export function coteDesFaces(centres, P, n, eps) {
  const nTri = Math.floor(centres.length / 3);
  const out = new Int8Array(nTri);
  for (let i = 0; i < nTri; i++) {
    const d = (centres[i * 3] - P[0]) * n[0] + (centres[i * 3 + 1] - P[1]) * n[1] + (centres[i * 3 + 2] - P[2]) * n[2];
    out[i] = d > eps ? 1 : d < -eps ? -1 : 0;
  }
  return out;
}

/** Ecrit dans `sortie` (Uint32Array) les indices de sommets des faces retenues (masque[i] vrai), dans l'ordre ; rend le
 *  nombre de faces ecrites. `index` = tableau d'indices du maillage ou null (non indexe). */
export function ecrireFaces(sortie, index, masque) {
  let w = 0;
  const n = masque.length;
  for (let t = 0; t < n; t++) {
    if (!masque[t]) continue;
    if (index) { sortie[w++] = index[t * 3]; sortie[w++] = index[t * 3 + 1]; sortie[w++] = index[t * 3 + 2]; }
    else { sortie[w++] = t * 3; sortie[w++] = t * 3 + 1; sortie[w++] = t * 3 + 2; }
  }
  return w / 3;
}

// ============================================================================================================================
// DETECTION DU PLAN DE SYMETRIE (26/10) : bouton « Auto » de la fenetre. Calcul PUR (nombres et tableaux), asynchrone par
// tranches : l'interface ne gele jamais, meme sur 500 000 faces.
//
// Principe : on echantillonne la SURFACE (points tires au hasard, proportionnellement a l'aire des triangles : un GLB texture
// dedouble ses sommets le long des coutures UV, un tirage par aire n'en depend pas, contrairement a un tirage de sommets).
// Pour un plan candidat, chaque point est reflechi et on mesure la distance au point echantillonne LE PLUS PROCHE (grille de
// hachage 3D). Le score est la moyenne de cette distance TRONQUEE a un plafond : une partie sans pendant (bras, accessoire)
// coute au plus le plafond, elle ne fausse pas la recherche. Candidats : les 3 axes principaux (ACP) et les 3 axes du monde
// par le centre de gravite, plus un balayage de la demi-sphere (formes sans axe principal net : cube, sphere). Les meilleurs
// sont affines par recherche locale (position + deux angles) a pas decroissants.
// ============================================================================================================================

function _prng(graine) {
  let s = graine >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const _cedeParDefaut = () => new Promise((r) => setTimeout(r, 0));
/** Rend une fonction `pause()` qui cede la main a l'interface toutes les ~`ms` millisecondes de calcul. */
function _pauseur(cede, ms) {
  let t = Date.now();
  const f = cede || _cedeParDefaut;
  return async () => { if (Date.now() - t >= ms) { await f(); t = Date.now(); } };
}

/** Echantillon de surface : `n` points tires proportionnellement a l'aire des triangles. `parts` = [{positions, index|null, m|null}]
 *  (m = matrice 4x4 ligne par ligne vers l'espace du modele). Rend un Float32Array (3 par point). Deterministe (graine). */
async function _echantillonner(parts, n, options) {
  const o = options || {};
  const pause = _pauseur(o.cede, 25);
  const rnd = _prng(o.graine == null ? 12345 : o.graine);
  const morceaux = [];
  let total = 0;
  for (const p of parts) {
    const pos = p.positions, idx = p.index || null, m = p.m || null;
    const nTri = idx ? Math.floor(idx.length / 3) : Math.floor(pos.length / 9);
    const cum = new Float64Array(nTri);
    let acc = 0;
    const P = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let t = 0; t < nTri; t++) {
      for (let k = 0; k < 3; k++) {
        const v = (idx ? idx[t * 3 + k] : t * 3 + k) * 3;
        const x = pos[v], y = pos[v + 1], z = pos[v + 2];
        if (m) { P[k * 3] = m[0] * x + m[1] * y + m[2] * z + m[3]; P[k * 3 + 1] = m[4] * x + m[5] * y + m[6] * z + m[7]; P[k * 3 + 2] = m[8] * x + m[9] * y + m[10] * z + m[11]; }
        else { P[k * 3] = x; P[k * 3 + 1] = y; P[k * 3 + 2] = z; }
      }
      const ux = P[3] - P[0], uy = P[4] - P[1], uz = P[5] - P[2], vx = P[6] - P[0], vy = P[7] - P[1], vz = P[8] - P[2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      acc += 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
      cum[t] = acc;
      if ((t & 0xFFFF) === 0xFFFF) await pause();
    }
    morceaux.push({ pos, idx, m, nTri, cum, debut: total });
    total += acc;
    await pause();
  }
  const out = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  if (!(total > 0)) return { points: new Float32Array(0), normales: new Float32Array(0) };
  for (let i = 0; i < n; i++) {
    const r = rnd() * total;
    let c = morceaux[0];
    for (const q of morceaux) { if (r >= q.debut) c = q; else break; }
    const loc = r - c.debut;
    let lo = 0, hi = c.nTri - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (c.cum[mid] < loc) lo = mid + 1; else hi = mid; }
    const t = lo;
    let r1 = rnd(), r2 = rnd();
    if (r1 + r2 > 1) { r1 = 1 - r1; r2 = 1 - r2; }
    const w0 = 1 - r1 - r2;
    const pt = [0, 0, 0];
    const ws = [w0, r1, r2];
    const T = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const v = (c.idx ? c.idx[t * 3 + k] : t * 3 + k) * 3;
      const x = c.pos[v], y = c.pos[v + 1], z = c.pos[v + 2];
      let X = x, Y = y, Z = z;
      if (c.m) { const m = c.m; X = m[0] * x + m[1] * y + m[2] * z + m[3]; Y = m[4] * x + m[5] * y + m[6] * z + m[7]; Z = m[8] * x + m[9] * y + m[10] * z + m[11]; }
      pt[0] += ws[k] * X; pt[1] += ws[k] * Y; pt[2] += ws[k] * Z;
      T[k * 3] = X; T[k * 3 + 1] = Y; T[k * 3 + 2] = Z;
    }
    out[i * 3] = pt[0]; out[i * 3 + 1] = pt[1]; out[i * 3 + 2] = pt[2];
    const fn = _vnorm(_vcross([T[3] - T[0], T[4] - T[1], T[5] - T[2]], [T[6] - T[0], T[7] - T[1], T[8] - T[2]]));
    nor[i * 3] = fn[0]; nor[i * 3 + 1] = fn[1]; nor[i * 3 + 2] = fn[2];
    if ((i & 0x3FFF) === 0x3FFF) await pause();
  }
  return { points: out, normales: nor };
}
/** Points seuls (voir _echantillonner). */
export async function echantillonnerSurface(parts, n, options) { return (await _echantillonner(parts, n, options)).points; }
/** Points ET normales des faces ({ points, normales }, 3 par point) : la detection mesure alors une distance point-plan, bien
 *  moins sensible a la finesse de l'echantillon qu'une distance point-point. */
export async function echantillonnerSurfaceNormales(parts, n, options) { return _echantillonner(parts, n, options); }

/** Grille de hachage 3D : cellules cubiques de cote `cell`, seaux a adressage par hachage (CSR). */
function _grille(pts, cell) {
  const n = pts.length / 3;
  let M = 1024;
  while (M < n * 2) M <<= 1;
  const inv = 1 / cell;
  const cle = new Int32Array(n);
  const debut = new Int32Array(M + 1);
  for (let i = 0; i < n; i++) {
    const h = (Math.imul(Math.floor(pts[i * 3] * inv), 73856093) ^ Math.imul(Math.floor(pts[i * 3 + 1] * inv), 19349663) ^ Math.imul(Math.floor(pts[i * 3 + 2] * inv), 83492791)) & (M - 1);
    cle[i] = h; debut[h + 1]++;
  }
  for (let h = 0; h < M; h++) debut[h + 1] += debut[h];
  const pos = debut.slice(0, M);
  const items = new Int32Array(n);
  for (let i = 0; i < n; i++) items[pos[cle[i]]++] = i;
  return { pts, debut, items, inv, M };
}
/** Carre de la distance du point (x, y, z) a son plus proche voisin de la grille, plafonne a `plafond2` (= cell^2 au plus). */
function _plusProche2(g, x, y, z, plafond2) {
  const ix = Math.floor(x * g.inv), iy = Math.floor(y * g.inv), iz = Math.floor(z * g.inv);
  let best = plafond2;
  const { pts, debut, items, M } = g;
  for (let a = ix - 1; a <= ix + 1; a++) {
    const ha = Math.imul(a, 73856093);
    for (let b = iy - 1; b <= iy + 1; b++) {
      const hb = ha ^ Math.imul(b, 19349663);
      for (let c = iz - 1; c <= iz + 1; c++) {
        const h = (hb ^ Math.imul(c, 83492791)) & (M - 1);
        for (let k = debut[h], e = debut[h + 1]; k < e; k++) {
          const j = items[k] * 3;
          const dx = pts[j] - x, dy = pts[j + 1] - y, dz = pts[j + 2] - z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < best) best = d2;
        }
      }
    }
  }
  return best;
}

/** Comme _plusProche2, mais rend l'INDICE du plus proche voisin (ou -1 s'il est au-dela du plafond) ; distance dans g.d2. */
function _plusProcheIdx(g, x, y, z, plafond2) {
  const ix = Math.floor(x * g.inv), iy = Math.floor(y * g.inv), iz = Math.floor(z * g.inv);
  let best = plafond2, bj = -1;
  const { pts, debut, items, M } = g;
  for (let a = ix - 1; a <= ix + 1; a++) {
    const ha = Math.imul(a, 73856093);
    for (let b = iy - 1; b <= iy + 1; b++) {
      const hb = ha ^ Math.imul(b, 19349663);
      for (let c = iz - 1; c <= iz + 1; c++) {
        const h = (hb ^ Math.imul(c, 83492791)) & (M - 1);
        for (let k = debut[h], e = debut[h + 1]; k < e; k++) {
          const jj = items[k], j = jj * 3;
          const dx = pts[j] - x, dy = pts[j + 1] - y, dz = pts[j + 2] - z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < best) { best = d2; bj = jj; }
        }
      }
    }
  }
  g.d2 = best;
  return bj;
}

function _vnorm(v) { const L = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / L, v[1] / L, v[2] / L]; }
function _vcross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
/** Deux vecteurs unitaires perpendiculaires entre eux et a `n`. */
function _perp(n) {
  const t = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = _vnorm(_vcross(n, t));
  return [u, _vcross(n, u)];
}
/** Valeurs propres / vecteurs propres d'une matrice symetrique 3x3 (Jacobi). Rend { vecteurs: [[x,y,z] x3], valeurs: [3] } triees decroissantes. */
function _jacobi3(A) {
  const a = A.map((r) => r.slice());
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let it = 0; it < 50; it++) {
    let p = 0, q = 1, mx = Math.abs(a[0][1]);
    if (Math.abs(a[0][2]) > mx) { p = 0; q = 2; mx = Math.abs(a[0][2]); }
    if (Math.abs(a[1][2]) > mx) { p = 1; q = 2; mx = Math.abs(a[1][2]); }
    if (mx < 1e-18) break;
    const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
    const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
    const c = 1 / Math.sqrt(t * t + 1), s = t * c;
    for (let k = 0; k < 3; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
    for (let k = 0; k < 3; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
    for (let k = 0; k < 3; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
  }
  const ordre = [0, 1, 2].sort((i, j) => a[j][j] - a[i][i]);
  return { valeurs: ordre.map((i) => a[i][i]), vecteurs: ordre.map((i) => [V[0][i], V[1][i], V[2][i]]) };
}

/** Meilleur plan de symetrie d'un nuage de points (`points` : Float32Array, 3 par point, espace du modele).
 *  Rend { n, d, P, confiance, symetrique, ecart, score, diag } ou null si le nuage est vide :
 *   - le plan est { x : n . x = d } (n unitaire) ; P = le point du plan le plus proche du centre de gravite ;
 *   - confiance (0..1) = part des points dont l'image miroir retombe sur la surface (a la finesse de l'echantillon pres) ;
 *   - symetrique = confiance >= seuil (0,6 par defaut : mesure sur formes symetriques ~0,9-1, asymetriques < 0,45) ;
 *   - ecart = distance moyenne tronquee, en part de la diagonale (plus petit = mieux).
 *  options : { cede (fonction async de cession de la main), seuil, requetes (points de requete), tour : callback(0..1) } */
export async function trouverPlanSymetrie(points, options) {
  const o = options || {};
  const N = Math.floor(points.length / 3);
  if (N < 20) return null;
  const nor = o.normales && o.normales.length === points.length ? o.normales : null;
  const pause = _pauseur(o.cede, 25);
  const rapport = typeof o.tour === 'function' ? o.tour : () => {};
  // boite, centre de gravite, covariance
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity], g = [0, 0, 0];
  for (let i = 0; i < N; i++) for (let k = 0; k < 3; k++) { const v = points[i * 3 + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; g[k] += v; }
  g = g.map((v) => v / N);
  const diag = Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) || 1;
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < N; i++) {
    const d0 = points[i * 3] - g[0], d1 = points[i * 3 + 1] - g[1], d2 = points[i * 3 + 2] - g[2];
    C[0][0] += d0 * d0; C[0][1] += d0 * d1; C[0][2] += d0 * d2; C[1][1] += d1 * d1; C[1][2] += d1 * d2; C[2][2] += d2 * d2;
  }
  C[1][0] = C[0][1]; C[2][0] = C[0][2]; C[2][1] = C[1][2];
  const acp = _jacobi3(C.map((r) => r.map((v) => v / N)));
  // normalisation en unites de la diagonale (les seuils sont relatifs)
  const tauMax = 0.05 * diag;
  const grille = _grille(points, tauMax);
  // requetes : un sous-ensemble (les points sont deja tires au hasard)
  const nReq = Math.min(N, o.requetes || 6000);
  const req = points.subarray(0, nReq * 3);
  // finesse de l'echantillon : distance mediane au plus proche voisin DANS l'echantillon (hors lui-meme) -> tolerance des points « apparies »
  const grFine = _grille(points, Math.max(tauMax * 0.25, 1e-9));
  const nn = [];
  for (let i = 0; i < Math.min(nReq, 1500); i++) {
    const x = points[i * 3], y = points[i * 3 + 1], z = points[i * 3 + 2];
    // plus proche voisin autre que soi : on cherche dans la grille fine en excluant la distance nulle
    let best = (tauMax * 0.25) ** 2;
    const ix = Math.floor(x * grFine.inv), iy = Math.floor(y * grFine.inv), iz = Math.floor(z * grFine.inv);
    for (let a = ix - 1; a <= ix + 1; a++) for (let b = iy - 1; b <= iy + 1; b++) for (let c = iz - 1; c <= iz + 1; c++) {
      const h = (Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791)) & (grFine.M - 1);
      for (let k = grFine.debut[h], e = grFine.debut[h + 1]; k < e; k++) {
        const j = grFine.items[k]; if (j === i) continue;
        const dx = points[j * 3] - x, dy = points[j * 3 + 1] - y, dz = points[j * 3 + 2] - z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < best) best = d2;
      }
    }
    nn.push(Math.sqrt(best));
  }
  nn.sort((a, b) => a - b);
  const finesse = nn.length ? nn[nn.length >> 1] : 0.01 * diag;
  const eps = Math.min(Math.max(3 * finesse, 0.004 * diag), tauMax);
  await pause();

  const tau2Max = tauMax * tauMax;
  /** Score (distance moyenne tronquee) du plan (n, d) sur les `m` premieres requetes. */
  const score = (n, d, tau, m) => {
    const t2 = tau * tau;
    let s = 0;
    for (let i = 0; i < m; i++) {
      const x = req[i * 3], y = req[i * 3 + 1], z = req[i * 3 + 2];
      const h = 2 * (n[0] * x + n[1] * y + n[2] * z - d);
      const qx = x - h * n[0], qy = y - h * n[1], qz = z - h * n[2];
      if (nor) {
        const j = _plusProcheIdx(grille, qx, qy, qz, Math.min(t2, tau2Max));
        if (j < 0) { s += tau; continue; }
        const pp = Math.abs((qx - points[j * 3]) * nor[j * 3] + (qy - points[j * 3 + 1]) * nor[j * 3 + 1] + (qz - points[j * 3 + 2]) * nor[j * 3 + 2]);
        s += pp < tau ? pp : tau;
      } else s += Math.sqrt(_plusProche2(grille, qx, qy, qz, Math.min(t2, tau2Max)));
    }
    return s / m;
  };
  const evals = { n: 0 };
  // ---- candidats
  const cand = [];
  const ajouter = (n) => { n = _vnorm(n); cand.push({ n, d: n[0] * g[0] + n[1] * g[1] + n[2] * g[2], s: 0, acp: false }); return cand[cand.length - 1]; };
  for (const v of acp.vecteurs) ajouter(v).acp = true;
  ajouter([1, 0, 0]); ajouter([0, 1, 0]); ajouter([0, 0, 1]);
  const NF = 160, phi = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < NF; i++) {          // demi-sphere (z >= 0) : Fibonacci
    const z = (i + 0.5) / NF, r = Math.sqrt(1 - z * z);
    ajouter([Math.cos(phi * i) * r, Math.sin(phi * i) * r, z]);
  }
  const mCoarse = Math.min(nReq, 2000);
  for (let i = 0; i < cand.length; i++) {
    cand[i].s = score(cand[i].n, cand[i].d, tauMax, mCoarse);
    if (i % 8 === 7) { await pause(); rapport(0.25 * (i / cand.length)); }
  }
  const parScore = cand.slice().sort((a, b) => a.s - b.s);
  const aAffiner = [];
  const dejaProche = (n) => aAffiner.some((c) => Math.abs(c.n[0] * n[0] + c.n[1] * n[1] + c.n[2] * n[2]) > Math.cos(12 * RAD));
  for (const c of cand.filter((x) => x.acp)) if (!dejaProche(c.n)) aAffiner.push(c);
  for (const c of parScore) { if (aAffiner.length >= 7) break; if (!dejaProche(c.n)) aAffiner.push(c); }

  // ---- affinage local : etage A (pas larges, peu de requetes) pour tous, puis etage B (pas fins) pour les 3 meilleurs
  const niveaux = [[8, 0.04, 0.05], [4, 0.02, 0.04], [2, 0.01, 0.03], [1, 0.005, 0.02], [0.5, 0.0025, 0.014], [0.25, 0.0012, 0.01], [0.12, 0.0006, 0.007]];
  const affiner = async (c, lesNiveaux, m) => {
    let n = c.n.slice(), d = c.d;
    for (const [angDeg, offFrac, tauFrac] of lesNiveaux) {
      const tau = Math.min(tauMax, Math.max(tauFrac * diag, 2 * finesse));   // jamais sous la finesse de l'echantillon : sinon le score est plat
      let cur = score(n, d, tau, m);
      for (let it = 0; it < 10; it++) {
        const [u, v] = _perp(n);
        const th = angDeg * RAD, off = offFrac * diag;
        const essais = [];
        for (const sg of [-1, 1]) {
          essais.push([_vnorm([n[0] * Math.cos(th) + sg * u[0] * Math.sin(th), n[1] * Math.cos(th) + sg * u[1] * Math.sin(th), n[2] * Math.cos(th) + sg * u[2] * Math.sin(th)]), d]);
          essais.push([_vnorm([n[0] * Math.cos(th) + sg * v[0] * Math.sin(th), n[1] * Math.cos(th) + sg * v[1] * Math.sin(th), n[2] * Math.cos(th) + sg * v[2] * Math.sin(th)]), d]);
          essais.push([n, d + sg * off]);
        }
        let bs = cur, bn = null;
        for (const [en, ed] of essais) { const s = score(en, ed, tau, m); evals.n++; if (s < bs - 1e-12) { bs = s; bn = [en, ed]; } }
        await pause();
        if (!bn) break;
        n = bn[0]; d = bn[1]; cur = bs;
      }
    }
    return { n, d, s: score(n, d, tauMax, m) };
  };
  // Affinage « ICP plan a plan » (avec normales) : a chaque tour on apparie les points reflechis a leur voisin le plus proche
  // et on resout au sens des moindres carres les 3 corrections (deux angles, un decalage) qui annulent l'ecart point-plan.
  // Converge en quelques tours meme dans une vallee etroite, la ou la recherche par pas bute sur une arete.
  const icp = async (c, m, tours) => {
    let n = c.n.slice(), d = c.d;
    const plan = [0.05, 0.05, 0.04, 0.04, 0.03, 0.03, 0.02, 0.02, 0.015, 0.015, 0.01, 0.01, 0.008, 0.008];
    for (const tf of plan.slice(0, tours)) {
      const tau = Math.min(tauMax, Math.max(tf * diag, 2 * finesse));
      const t2 = tau * tau;
      const [u, v] = _perp(n);
      const A = [0, 0, 0, 0, 0, 0], B = [0, 0, 0];
      let cnt = 0;
      for (let i = 0; i < m; i++) {
        const x = req[i * 3], y = req[i * 3 + 1], z = req[i * 3 + 2];
        const hq = n[0] * x + n[1] * y + n[2] * z - d;
        const qx = x - 2 * hq * n[0], qy = y - 2 * hq * n[1], qz = z - 2 * hq * n[2];
        const j = _plusProcheIdx(grille, qx, qy, qz, t2);
        if (j < 0) continue;
        const nx = nor[j * 3], ny = nor[j * 3 + 1], nz = nor[j * 3 + 2];
        const r = (qx - points[j * 3]) * nx + (qy - points[j * 3 + 1]) * ny + (qz - points[j * 3 + 2]) * nz;
        const uq = u[0] * x + u[1] * y + u[2] * z, vq = v[0] * x + v[1] * y + v[2] * z;
        const nn_ = n[0] * nx + n[1] * ny + n[2] * nz;
        const J0 = -2 * (uq * nn_ + hq * (u[0] * nx + u[1] * ny + u[2] * nz));
        const J1 = -2 * (vq * nn_ + hq * (v[0] * nx + v[1] * ny + v[2] * nz));
        const J2 = 2 * nn_;
        const w = Math.abs(r) < 0.5 * tau ? 1 : 0.5 * tau / Math.abs(r);
        A[0] += w * J0 * J0; A[1] += w * J0 * J1; A[2] += w * J0 * J2; A[3] += w * J1 * J1; A[4] += w * J1 * J2; A[5] += w * J2 * J2;
        B[0] -= w * J0 * r; B[1] -= w * J1 * r; B[2] -= w * J2 * r;
        cnt++;
      }
      if (cnt < 30) break;
      const lam = 1e-3 * (A[0] + A[3] + A[5]) / 3 + 1e-12;
      const M3 = [[A[0] + lam, A[1], A[2]], [A[1], A[3] + lam, A[4]], [A[2], A[4], A[5] + lam]];
      const det = M3[0][0] * (M3[1][1] * M3[2][2] - M3[1][2] * M3[2][1]) - M3[0][1] * (M3[1][0] * M3[2][2] - M3[1][2] * M3[2][0]) + M3[0][2] * (M3[1][0] * M3[2][1] - M3[1][1] * M3[2][0]);
      if (Math.abs(det) < 1e-300) break;
      const cof = (a, b) => { const r0 = [0, 1, 2].filter((k) => k !== a), c0 = [0, 1, 2].filter((k) => k !== b); return ((a + b) % 2 ? -1 : 1) * (M3[r0[0]][c0[0]] * M3[r0[1]][c0[1]] - M3[r0[0]][c0[1]] * M3[r0[1]][c0[0]]); };
      const x3 = [0, 1, 2].map((i) => (cof(0, i) * B[0] + cof(1, i) * B[1] + cof(2, i) * B[2]) / det);
      const lim = 5 * RAD;
      const tu = Math.max(-lim, Math.min(lim, x3[0])), tv = Math.max(-lim, Math.min(lim, x3[1]));
      n = _vnorm([n[0] + tu * u[0] + tv * v[0], n[1] + tu * u[1] + tv * v[1], n[2] + tu * u[2] + tv * v[2]]);
      d += Math.max(-0.03 * diag, Math.min(0.03 * diag, x3[2]));
      await pause();
    }
    return { n, d, s: score(n, d, tauMax, m) };
  };
  const etageA = [];
  for (let ci = 0; ci < aAffiner.length; ci++) {
    etageA.push(nor ? await icp(aAffiner[ci], Math.min(nReq, 2500), 10) : await affiner(aAffiner[ci], niveaux.slice(0, 3), Math.min(nReq, 2500)));
    rapport(0.25 + 0.4 * ((ci + 1) / aAffiner.length));
  }
  etageA.sort((a, b) => a.s - b.s);
  let meilleur = null;
  const fin = etageA.slice(0, 3);
  for (let ci = 0; ci < fin.length; ci++) {
    const r = nor ? await icp(fin[ci], nReq, 14) : await affiner(fin[ci], niveaux.slice(3), nReq);
    r.s = score(r.n, r.d, tauMax, nReq);
    if (!meilleur || r.s < meilleur.s) meilleur = r;
    rapport(0.65 + 0.35 * ((ci + 1) / fin.length));
  }
  // ---- verdict : part des points dont le miroir retombe a `eps` d'un point de l'echantillon
  const e2 = eps * eps;
  let ok = 0;
  for (let i = 0; i < nReq; i++) {
    const x = req[i * 3], y = req[i * 3 + 1], z = req[i * 3 + 2];
    const h = 2 * (meilleur.n[0] * x + meilleur.n[1] * y + meilleur.n[2] * z - meilleur.d);
    if (_plusProche2(grille, x - h * meilleur.n[0], y - h * meilleur.n[1], z - h * meilleur.n[2], e2 * 1.0000001) < e2) ok++;
  }
  const confiance = ok / nReq;
  // P : projection du centre de gravite sur le plan
  const dist = meilleur.n[0] * g[0] + meilleur.n[1] * g[1] + meilleur.n[2] * g[2] - meilleur.d;
  const P = [g[0] - dist * meilleur.n[0], g[1] - dist * meilleur.n[1], g[2] - dist * meilleur.n[2]];
  return { n: meilleur.n, d: meilleur.d, P, confiance, symetrique: confiance >= (o.seuil == null ? 0.6 : o.seuil),
    ecart: meilleur.s / diag, score: meilleur.s, diag, eps, evals: evals.n };
}

/** Axe de base ('x' | 'y' | 'z', celui dont la normale est la plus proche) et inclinaisons {a, b} d'une normale quelconque :
 *  normaleDepuis(axe, a, b) redonne +-n (le signe est choisi pour que la composante dominante soit positive). */
export function axeEtAnglesDepuis(n) {
  let [x, y, z] = _vnorm(n);
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  const axe = ax >= ay && ax >= az ? 'x' : ay >= az ? 'y' : 'z';
  const dom = axe === 'x' ? x : axe === 'y' ? y : z;
  if (dom < 0) { x = -x; y = -y; z = -z; }
  const t = anglesDepuis(axe, [x, y, z]);
  return { axe, a: t.a, b: Math.max(-90, Math.min(90, t.b)), n: [x, y, z] };
}

/** Angle (degres) entre deux plans de normales n1 et n2 (le signe des normales n'a pas d'importance : 0..90). */
export function angleEntrePlans(n1, n2) {
  const c = Math.abs(n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]) / ((Math.hypot(...n1) * Math.hypot(...n2)) || 1);
  return Math.acos(Math.min(1, c)) / RAD;
}

/** Fait tourner la normale `n` de `angle` degres autour de l'axe unitaire `axe` (Rodrigues). */
export function tournerNormale(n, axe, angle) {
  const c = Math.cos(angle * RAD), s = Math.sin(angle * RAD);
  const k = axe, d = k[0] * n[0] + k[1] * n[1] + k[2] * n[2];
  const kx = _vcross(k, n);
  return _vnorm([n[0] * c + kx[0] * s + k[0] * d * (1 - c), n[1] * c + kx[1] * s + k[1] * d * (1 - c), n[2] * c + kx[2] * s + k[2] * d * (1 - c)]);
}
