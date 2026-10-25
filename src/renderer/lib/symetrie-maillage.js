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
