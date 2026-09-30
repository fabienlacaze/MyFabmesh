// NIVEAUX DE DETAIL POUR LES GROS MAILLAGES (2026-09-30, user : « inutilisable en l'etat » sur un rig de 10 M de triangles).
// FICHIER COMMUN bureau / web (src/renderer/lib = cloud/public/app/lib).
//
// Principe : meshoptimizer (MIT, WebAssembly) reduit le maillage a ~400 K triangles. La reduction NE CREE AUCUN SOMMET : elle ne
// fait que choisir d'autres triangles parmi les sommets d'origine. Le maillage leger partage donc TOUS les attributs de
// l'original (positions, UV, normales, os et poids de peau) et n'a qu'un autre tampon d'indices : memes textures, meme peau,
// aucune memoire en plus, et la carte graphique ne traite que les sommets encore references (~20 fois moins de calcul).
//   - vu de loin (vue d'ensemble, rotation) -> version legere ; zoom serre, ou « Full detail » -> maillage complet ;
//   - les OUTILS et l'export lisent toujours le maillage complet : `geometriePleine(mesh)`.
// Le calcul tourne dans un Worker (l'interface ne gele pas) et son resultat est garde dans IndexedDB.
import * as THREE from 'three';

const _etat = new WeakMap();   // mesh -> { plein, leger, actif }
export const SEUIL_TRIANGLES = 1_000_000;
export const CIBLE_TRIANGLES = 400_000;

export function geometriePleine(mesh) {
  const e = _etat.get(mesh);
  return e ? e.plein : mesh.geometry;
}
export function estAllege(mesh) { return !!_etat.get(mesh); }

// ── cache IndexedDB (jamais bloquant) ─────────────────────────────────────────────
function _idb() {
  return new Promise((ok) => {
    try {
      const r = indexedDB.open('myfabmesh-lod', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('lod');
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ok(null);
    } catch (_) { ok(null); }
  });
}
async function _lire(cle) {
  const db = await _idb(); if (!db) return null;
  return new Promise((ok) => { try { const q = db.transaction('lod').objectStore('lod').get(cle); q.onsuccess = () => ok(q.result || null); q.onerror = () => ok(null); } catch (_) { ok(null); } });
}
async function _ecrire(cle, valeur) {
  const db = await _idb(); if (!db) return;
  try { db.transaction('lod', 'readwrite').objectStore('lod').put(valeur, cle); } catch (_) { /* cache facultatif */ }
}

let _worker = null, _jobs = new Map(), _n = 0;
function _lancer(pos, uv, idx, cible) {
  if (!_worker) {
    _worker = new Worker(new URL('./lod-worker.js', import.meta.url), { type: 'module' });
    _worker.onmessage = (e) => {
      const j = _jobs.get(e.data.id); if (!j) return; _jobs.delete(e.data.id);
      if (e.data.error) j.ko(new Error(e.data.error)); else j.ok(e.data.idx);
    };
    _worker.onerror = (e) => { _jobs.forEach((j) => j.ko(new Error(e.message || 'worker error'))); _jobs.clear(); _worker = null; };
  }
  return new Promise((ok, ko) => {
    const id = ++_n; _jobs.set(id, { ok, ko });
    const transfert = [pos.buffer, idx.buffer]; if (uv) transfert.push(uv.buffer);
    _worker.postMessage({ id, pos, uv, idx, cible }, transfert);
  });
}

/** Prepare le maillage leger de chaque mesh de `root` au-dela de SEUIL_TRIANGLES. Rend le nombre de meshes allegees.
 *  `cle` : identifiant stable du fichier (chemin sans requete) pour le cache. */
export async function preparerLOD(root, { cle = '', seuil = SEUIL_TRIANGLES, cible = CIBLE_TRIANGLES, surPret } = {}) {
  const liste = [];
  root.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.index && !_etat.has(o)) liste.push(o); });
  let n = 0;
  for (const mesh of liste) {
    const g = mesh.geometry, I = g.index, P = g.attributes.position;
    if (!I || !P || I.count / 3 <= seuil) continue;
    if (g.groups && g.groups.length > 1) continue;                      // plusieurs materiaux : on ne touche pas
    if (!(P.array instanceof Float32Array) || P.isInterleavedBufferAttribute || P.itemSize !== 3) continue;
    const cleCache = `${cle}|${I.count}|${P.count}|${cible}`;
    let res = cle ? await _lire(cleCache) : null;
    if (!(res instanceof Uint32Array)) {
      try {
        const UV = g.attributes.uv;
        const uvOk = UV && !UV.isInterleavedBufferAttribute && UV.array instanceof Float32Array && UV.itemSize === 2;
        const idx = I.array instanceof Uint32Array ? I.array.slice() : new Uint32Array(I.array);
        res = await _lancer(P.array.slice(), uvOk ? UV.array.slice() : null, idx, cible);
      } catch (e) { console.warn('[lod] reduction impossible :', e && e.message ? e.message : e); continue; }
      if (cle && res) _ecrire(cleCache, res);
    }
    if (!res || res.length < 3 || res.length >= I.array.length) continue;
    const leger = new THREE.BufferGeometry();
    for (const nom in g.attributes) leger.setAttribute(nom, g.attributes[nom]);      // MEMES attributs (aucune copie)
    for (const nom in g.morphAttributes) leger.morphAttributes[nom] = g.morphAttributes[nom];
    leger.morphTargetsRelative = g.morphTargetsRelative;
    leger.setIndex(new THREE.BufferAttribute(res, 1));
    if (g.boundingBox) leger.boundingBox = g.boundingBox.clone();
    if (g.boundingSphere) leger.boundingSphere = g.boundingSphere.clone();
    _etat.set(mesh, { plein: g, leger, actif: 'leger' });
    mesh.geometry = leger;
    n++;
  }
  if (n && surPret) surPret(n);
  return n;
}

/** Choisit le niveau selon la distance de la camera. Rend true si un niveau a change (le viewer doit redessiner). */
const _c = new THREE.Vector3(), _s = new THREE.Sphere();
export function majLOD(root, camera, forcerPlein) {
  let change = false;
  root.traverse((o) => {
    const e = o.isMesh && _etat.get(o); if (!e) return;
    const g = e.plein;
    if (!g.boundingSphere) g.computeBoundingSphere();
    _s.copy(g.boundingSphere).applyMatrix4(o.matrixWorld);
    const ratio = camera.position.distanceTo(_s.center) / Math.max(_s.radius, 1e-6);
    // hysteresis : plein sous 1,3 rayon (zoom serre), leger au-dela de 1,8
    const veut = forcerPlein || ratio < 1.3 ? 'plein' : (ratio > 1.8 ? 'leger' : e.actif);
    if (veut !== e.actif) { e.actif = veut; o.geometry = veut === 'plein' ? e.plein : e.leger; change = true; }
  });
  return change;
}
