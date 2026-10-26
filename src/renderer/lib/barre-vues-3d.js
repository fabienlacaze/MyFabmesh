// Barre commune des visualiseurs 3D des fenetres d'outils (25/10, harmonisation).
// Meme fichier sur le bureau et le site. Groupes, dans cet ordre unique :
//   [Reset camera] [Iso, Front, Back, Left, Right, Top, Bottom] [Zoom +, Zoom -, Fit].
// Aucun changement du schema de souris : la barre ne fait que placer la camera.
import * as THREE from 'three';

export const VUES_3D = ['iso', 'front', 'back', 'left', 'right', 'top', 'bottom'];
const LIBELLES = { iso: 'Iso', front: 'Front', back: 'Back', left: 'Left', right: 'Right', top: 'Top', bottom: 'Bottom' };

function _contexte(viewer) {
  const v = typeof viewer === 'function' ? viewer() : viewer;
  return v && v.camera && v.controls ? v : null;
}

function _boite(v, cible) {
  let obj = null;
  try { obj = typeof cible === 'function' ? cible() : (cible || v.model || null); } catch (_) { obj = null; }
  const box = new THREE.Box3();
  if (obj) box.setFromObject(obj);
  else if (v.scene) {
    // Sans cible : tout ce que la scene montre, sauf lumieres, grille, aides, lignes et sprites (gizmos).
    for (const o of v.scene.children) {
      if (!o.visible || o.isLight || o.isGridHelper || o.isHelper || o.isLine || o.isSprite || o.isCamera) continue;
      box.union(new THREE.Box3().setFromObject(o));
    }
  }
  if (box.isEmpty()) { box.min.set(-1, 0, -1); box.max.set(1, 2, 1); }
  return box;
}

/** Place la camera sur une des 7 vues, centree sur la boite du modele. */
export function placerVue3D(viewer, vue, cible) {
  const v = _contexte(viewer);
  if (!v) return false;
  const box = _boite(v, cible);
  const c = box.getCenter(new THREE.Vector3());
  const d = box.getSize(new THREE.Vector3()).length() * 1.4 || 2;
  const dir = {
    front: [0, 0, 1], back: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0],
    top: [0, 1, 0.001], bottom: [0, -1, 0.001], iso: [0.7, 0.5, 0.7],
  }[vue];
  if (!dir) return false;
  v.camera.position.set(c.x + dir[0] * d, c.y + dir[1] * d, c.z + dir[2] * d);
  v.camera.lookAt(c);
  v.controls.target.copy(c);
  v.controls.update();
  return true;
}

/** Zoom avant / arriere le long de l'axe camera -> cible (facteur < 1 = avant). */
export function zoomer3D(viewer, facteur) {
  const v = _contexte(viewer);
  if (!v) return false;
  const t = v.controls.target;
  const off = v.camera.position.clone().sub(t).multiplyScalar(facteur);
  v.camera.position.copy(t).add(off);
  v.controls.update();
  return true;
}

/** Cadre tout le modele en gardant la direction de vue actuelle. */
export function cadrer3D(viewer, cible) {
  const v = _contexte(viewer);
  if (!v) return false;
  const box = _boite(v, cible);
  const c = box.getCenter(new THREE.Vector3());
  const d = box.getSize(new THREE.Vector3()).length() * 1.4 || 2;
  const dir = v.camera.position.clone().sub(v.controls.target);
  if (dir.lengthSq() < 1e-9) dir.set(0.7, 0.5, 0.7);
  dir.normalize();
  v.camera.position.copy(c).addScaledVector(dir, d);
  v.camera.lookAt(c);
  v.controls.target.copy(c);
  v.controls.update();
  return true;
}

/**
 * @param {HTMLElement} conteneur  element positionne (relative) qui recoit la barre
 * @param {object|function} viewer {camera, controls, model?} ou fonction qui le rend (il peut naitre apres)
 * @param {object} [options] {vues:true, zoom:true, plein_ecran:false, cible:()=>Object3D, classe:'fen', cadre:(act, vue)=>boolean}
 * @returns {HTMLElement|null} la barre (deja presente : rendue telle quelle, jamais en double)
 */
export function creerBarreVues3D(conteneur, viewer, options) {
  if (!conteneur) return null;
  const o = Object.assign({ vues: true, zoom: true, plein_ecran: false, classe: 'fen' }, options || {});
  const deja = conteneur.querySelector(':scope > .mesh-toolbar.barre-vues-3d');
  if (deja) return deja;
  const barre = document.createElement('div');
  barre.className = 'mesh-toolbar barre-vues-3d' + (o.classe ? ' ' + o.classe : '');
  const groupe = (nom) => { const g = document.createElement('span'); g.className = 'bv3-groupe'; g.setAttribute('data-groupe', nom); barre.appendChild(g); return g; };
  const bouton = (g, act, texte, titre, vue) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('data-act', act);
    if (vue) b.setAttribute('data-view', vue);
    b.title = titre;
    b.textContent = texte;
    g.appendChild(b);
    return b;
  };
  bouton(groupe('reset'), 'reset', '⟳', 'Reset camera');
  if (o.vues) {
    const g = groupe('vues');
    for (const vue of VUES_3D) bouton(g, 'view', LIBELLES[vue], LIBELLES[vue], vue);
  }
  if (o.zoom) {
    const g = groupe('zoom');
    bouton(g, 'zoom-in', '+', 'Zoom in');
    bouton(g, 'zoom-out', '−', 'Zoom out');
    bouton(g, 'fit', 'Fit', 'Fit to view');
  }
  if (o.plein_ecran) bouton(groupe('plein-ecran'), 'fullscreen', '⛶', 'Fullscreen');
  barre.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('button[data-act]');
    if (!b) return;
    e.stopPropagation();
    const act = b.getAttribute('data-act');
    // Cadrage propre a la fenetre (ex. Symmetrize mesh : modele a ~70 % de la hauteur) : `cadre(act, vue)` rend vrai s'il a traite le clic.
    if ((act === 'view' || act === 'reset' || act === 'fit') && typeof o.cadre === 'function' && o.cadre(act, b.getAttribute('data-view'))) return;
    if (act === 'view') placerVue3D(viewer, b.getAttribute('data-view'), o.cible);
    else if (act === 'reset') {
      // Retour a la vue Iso cadree sur le modele (le reset() d'origine ramene a la pose de depart, avant chargement).
      placerVue3D(viewer, 'iso', o.cible);
    }
    else if (act === 'zoom-in') zoomer3D(viewer, 0.8);
    else if (act === 'zoom-out') zoomer3D(viewer, 1.25);
    else if (act === 'fit') cadrer3D(viewer, o.cible);
    else if (act === 'fullscreen' && typeof o.surPleinEcran === 'function') o.surPleinEcran();
  });
  // Un clic sur la barre ne doit pas servir d'outil (peinture, gizmo) sur le canvas voisin.
  for (const ev of ['pointerdown', 'mousedown', 'wheel']) barre.addEventListener(ev, (e) => e.stopPropagation());
  conteneur.appendChild(barre);
  return barre;
}

if (typeof window !== 'undefined') {
  window.creerBarreVues3D = creerBarreVues3D;
}
