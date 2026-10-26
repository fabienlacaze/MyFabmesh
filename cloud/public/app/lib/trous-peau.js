// Apercu des TROUS DE PEAU (2026-10-26) : la lueur bleu clair de la fenetre Fill holes.
//
// Le noyau (scripts/bouchage_peau.py, bureau : mesh_tools.py detect_skin ; site : Modal fill_holes detect_only) rend, pour chaque trou de la peau
// exterieure, son pourtour (points 3D), son centre et sa normale (vers l'observateur). Ce module PUR (aucune dependance : ni three.js ni le DOM) en tire
// les tableaux a dessiner ; les deux pages (bureau et site, MEME fichier, voir build/check-noyaux-partages.mjs) en font des objets three.js.
//
// Rendu voulu : une LUEUR bleu clair qui sort du trou — contour lumineux + zone translucide legerement en retrait de la surface (sous la coque : on la
// voit ainsi a travers), plus un halo plus large et plus pale. Les trous a bord ouvert gardent leur code couleur (vert / gris / rouge).

export const COULEUR_PEAU = 0x7fd4ff;          // bleu clair
export const RETRAIT = 0.004;                  // retrait sous la surface, en fraction de la diagonale du maillage
export const HALO = 1.35;                      // le halo est la meme zone agrandie autour du centre

/** Les trous dont le pourtour a entre `min` et `max` aretes (les curseurs Min / Max de la fenetre). */
export function filtrer(detect, min, max) {
  const lo = Math.max(3, Math.trunc(Number(min) || 3));
  const hi = Math.max(lo, Math.trunc(Number(max) || 1000000));
  const liste = (detect && Array.isArray(detect.trous)) ? detect.trous : [];
  return liste.filter((t) => t && Array.isArray(t.points) && t.points.length >= 3 && t.n >= lo && t.n <= hi);
}

/**
 * Tableaux a dessiner pour les trous retenus.
 * @returns {{nombre:number, lignes:Float32Array, zone:Float32Array, halo:Float32Array}}
 *   lignes : segments (6 nombres chacun) du contour ; zone et halo : triangles (9 nombres chacun), en eventail depuis le centre.
 */
export function geometrie(detect, min, max, diagonale) {
  const trous = filtrer(detect, min, max);
  const retrait = RETRAIT * (Number(diagonale) > 0 ? Number(diagonale) : 1);
  const lignes = [], zone = [], halo = [];
  for (const t of trous) {
    const P = t.points;
    const n = Array.isArray(t.normale) && t.normale.length === 3 ? t.normale : [0, 0, 0];
    const c = Array.isArray(t.centre) && t.centre.length === 3 ? t.centre : P[0];
    // zone legerement EN RETRAIT : le long de -normale (la normale regarde l'observateur)
    const dx = -n[0] * retrait, dy = -n[1] * retrait, dz = -n[2] * retrait;
    const centre = [c[0] + dx, c[1] + dy, c[2] + dz];
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length];
      lignes.push(a[0], a[1], a[2], b[0], b[1], b[2]);
      zone.push(centre[0], centre[1], centre[2], a[0] + dx, a[1] + dy, a[2] + dz, b[0] + dx, b[1] + dy, b[2] + dz);
      const h = (p) => [c[0] + (p[0] - c[0]) * HALO + dx, c[1] + (p[1] - c[1]) * HALO + dy, c[2] + (p[2] - c[2]) * HALO + dz];
      const ha = h(a), hb = h(b);
      halo.push(centre[0], centre[1], centre[2], ha[0], ha[1], ha[2], hb[0], hb[1], hb[2]);
    }
  }
  return { nombre: trous.length, lignes: new Float32Array(lignes), zone: new Float32Array(zone), halo: new Float32Array(halo) };
}

/** Diagonale de la boite englobante d'un tableau de positions (x y z ...). */
export function diagonale(positions) {
  let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < mnx) mnx = x; if (x > mxx) mxx = x;
    if (y < mny) mny = y; if (y > mxy) mxy = y;
    if (z < mnz) mnz = z; if (z > mxz) mxz = z;
  }
  return Number.isFinite(mnx) ? Math.hypot(mxx - mnx, mxy - mny, mxz - mnz) : 1;
}
