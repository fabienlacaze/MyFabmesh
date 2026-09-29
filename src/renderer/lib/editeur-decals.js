// DECALQUES (2026-09-30, user : « Align Texture est pas pratique et ne marche pas : on va plutot le retravailler pour pouvoir
// superposer des textures (decals) sur le mesh », puis « reutilise Paint Mesh directement »). FICHIER COMMUN bureau / web
// (src/renderer/lib = cloud/public/app/lib). Le decalque est un OUTIL de Paint Mesh : sa fenetre, ses calques de texture, son
// annulation et son enregistrement servent tels quels ; ce module fournit seulement le calcul :
//   - cadreDecal  : repere d'un decalque (centre, axes, dimensions) ;
//   - cuireDecals : projette l'image sur le maillage et la peint dans l'atlas de couleur (meme surface, memes coutures d'UV) ;
//   - lireImage   : image -> canvas + pixels.
import * as THREE from 'three';

/** Repere d'un decalque (unites du MONDE). d : { p:[x,y,z], n:[x,y,z], rot (deg), flip, largeur, ratio (hauteur / largeur) }. */
export function cadreDecal(d) {
  const n = new THREE.Vector3(...d.n).normalize();
  const haut0 = Math.abs(n.y) > 0.95 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const r = new THREE.Vector3().crossVectors(haut0, n).normalize();
  const u = new THREE.Vector3().crossVectors(n, r).normalize();
  const a = (d.rot || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const r2 = r.clone().multiplyScalar(c).addScaledVector(u, s), u2 = u.clone().multiplyScalar(c).addScaledVector(r, -s);
  if (d.flip) r2.negate();
  return { p: new THREE.Vector3(...d.p), r: r2, u: u2, n, w: d.largeur, h: d.largeur * (d.ratio || 1) };
}

/** CUISSON : peint les decalques dans l'atlas de couleur.
 *  cible : { pos (monde, n*3), nor (monde, n*3), uv (n*2), index (ou null), atlas: { data: Uint8ClampedArray RGBA, w, h, flipY } }
 *          flipY (defaut vrai) : la rangee 0 du canvas est en haut de l'UV (v = 1), comme un CanvasTexture ordinaire.
 *  decals : [{ cadre, opacite, profondeur (monde), faceAvant, img: { data: RGBA, w, h } }]. Rend le nombre de texels modifies. */
export function cuireDecals(cible, decals) {
  const { pos, nor, uv, index, atlas } = cible, W = atlas.w, H = atlas.h, A = atlas.data, flipV = atlas.flipY !== false;
  const nTri = (index ? index.length : pos.length / 3) / 3;
  let modifies = 0;
  for (const d of decals) {
    const { p, r, u, n, w, h } = d.cadre, prof = d.profondeur, img = d.img, IW = img.w, IH = img.h, ID = img.data;
    const iw = 1 / w, ih = 1 / h;
    const sv = new Float32Array(3), tv = new Float32Array(3), qv = new Float32Array(3), fv = new Float32Array(3);
    const vs = [0, 0, 0], px = [0, 0, 0], py = [0, 0, 0];
    for (let t = 0; t < nTri; t++) {
      vs[0] = index ? index[3 * t] : 3 * t; vs[1] = index ? index[3 * t + 1] : 3 * t + 1; vs[2] = index ? index[3 * t + 2] : 3 * t + 2;
      let dessous = 0;
      for (let k = 0; k < 3; k++) {
        const i = vs[k], x = pos[3 * i] - p.x, y = pos[3 * i + 1] - p.y, z = pos[3 * i + 2] - p.z;
        sv[k] = (x * r.x + y * r.y + z * r.z) * iw + 0.5; tv[k] = (x * u.x + y * u.y + z * u.z) * ih + 0.5; qv[k] = x * n.x + y * n.y + z * n.z;
        fv[k] = nor[3 * i] * n.x + nor[3 * i + 1] * n.y + nor[3 * i + 2] * n.z;
        if (fv[k] < 0.1) dessous++;
      }
      if (sv[0] < 0 && sv[1] < 0 && sv[2] < 0) continue; if (sv[0] > 1 && sv[1] > 1 && sv[2] > 1) continue;
      if (tv[0] < 0 && tv[1] < 0 && tv[2] < 0) continue; if (tv[0] > 1 && tv[1] > 1 && tv[2] > 1) continue;
      if (qv[0] > prof && qv[1] > prof && qv[2] > prof) continue; if (qv[0] < -prof && qv[1] < -prof && qv[2] < -prof) continue;
      if (d.faceAvant && dessous === 3) continue;
      for (let k = 0; k < 3; k++) { px[k] = uv[2 * vs[k]] * W; py[k] = flipV ? (1 - uv[2 * vs[k] + 1]) * H : uv[2 * vs[k] + 1] * H; }
      const x0 = Math.max(0, Math.floor(Math.min(px[0], px[1], px[2]) - 1)), x1 = Math.min(W - 1, Math.ceil(Math.max(px[0], px[1], px[2]) + 1));
      const y0 = Math.max(0, Math.floor(Math.min(py[0], py[1], py[2]) - 1)), y1 = Math.min(H - 1, Math.ceil(Math.max(py[0], py[1], py[2]) + 1));
      const den = (py[1] - py[2]) * (px[0] - px[2]) + (px[2] - px[1]) * (py[0] - py[2]);
      if (Math.abs(den) < 1e-9) continue;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const cx = x + 0.5, cy = y + 0.5;
        const l0 = ((py[1] - py[2]) * (cx - px[2]) + (px[2] - px[1]) * (cy - py[2])) / den;
        const l1 = ((py[2] - py[0]) * (cx - px[2]) + (px[0] - px[2]) * (cy - py[2])) / den, l2 = 1 - l0 - l1;
        if (l0 < -0.03 || l1 < -0.03 || l2 < -0.03) continue;                        // un peu de debord : pas de trou aux coutures
        const s = l0 * sv[0] + l1 * sv[1] + l2 * sv[2], tt = l0 * tv[0] + l1 * tv[1] + l2 * tv[2], q = l0 * qv[0] + l1 * qv[1] + l2 * qv[2];
        if (s < 0 || s > 1 || tt < 0 || tt > 1 || q > prof || q < -prof) continue;
        const f = l0 * fv[0] + l1 * fv[1] + l2 * fv[2];
        let fondu = 1;
        if (d.faceAvant) { if (f < 0.1) continue; fondu = f >= 0.45 ? 1 : (f - 0.1) / 0.35; }
        // echantillon bilineaire de l'image (haut de l'image = tt = 1)
        const fx = Math.min(IW - 1.001, Math.max(0, s * IW - 0.5)), fy = Math.min(IH - 1.001, Math.max(0, (1 - tt) * IH - 0.5));
        const ix = Math.floor(fx), iy = Math.floor(fy), ax = fx - ix, ay = fy - iy;
        const o00 = (iy * IW + ix) * 4, o10 = o00 + 4, o01 = o00 + IW * 4, o11 = o01 + 4;
        const al = (ID[o00 + 3] * (1 - ax) + ID[o10 + 3] * ax) * (1 - ay) + (ID[o01 + 3] * (1 - ax) + ID[o11 + 3] * ax) * ay;
        const a = (al / 255) * d.opacite * fondu;
        if (a <= 0.002) continue;
        const o = (y * W + x) * 4;
        for (let c = 0; c < 3; c++) {
          const v = (ID[o00 + c] * (1 - ax) + ID[o10 + c] * ax) * (1 - ay) + (ID[o01 + c] * (1 - ax) + ID[o11 + c] * ax) * ay;
          A[o + c] = A[o + c] * (1 - a) + v * a;
        }
        modifies++;
      }
    }
  }
  return modifies;
}

/** Charge une image (Blob, File ou ArrayBuffer) : { canvas, data (RGBA), w, h }, reduite a 2048 px de cote au plus. */
export async function lireImage(source) {
  const blob = source instanceof Blob ? source : new Blob([source]);
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, 2048 / Math.max(bmp.width, bmp.height)), w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bmp, 0, 0, w, h);
  return { canvas: cv, data: ctx.getImageData(0, 0, w, h).data, w, h };
}
