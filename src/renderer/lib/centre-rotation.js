// Rotation du modele AUTOUR DE SON CENTRE (25/10, user : « quand je fais tourner la vue 3D avec la molette, ca n'a pas l'air de tourner depuis le centre du mesh »).
// OrbitControls tourne autour de `controls.target`. Ce point derive : le zoom vers le curseur (zoomToCursor) et le deplacement a droite le
// decalent, et la camera tournait alors autour d'un point vide a cote du modele. A chaque appui sur la molette, le point de rotation est
// replace au centre de la boite englobante des maillages visibles ; la camera est translatee du meme vecteur (meme direction, meme
// distance : le modele se recentre a l'ecran, sans saut d'angle).
import * as THREE from 'three';

// Le visualiseur ne nous donne pas sa scene : on la retient a chaque rendu (une fois, sur le prototype du moteur de rendu).
function _retenirScene() {
  const proto = THREE.WebGLRenderer && THREE.WebGLRenderer.prototype;
  if (!proto || proto.__sceneRetenue) return;
  proto.__sceneRetenue = true;
  const rendre = proto.render;
  proto.render = function (scene, camera) {
    try { if (camera) camera.__derniereScene = scene; } catch (_) { /* camera figee : on ne retient rien */ }
    return rendre.call(this, scene, camera);
  };
}

/** Centre de la boite englobante des maillages visibles (hors petits objets : poignees, curseurs, reperes). Null si rien. */
export function centreDuModele(scene) {
  if (!scene || !scene.traverseVisible) return null;
  const boite = new THREE.Box3(), une = new THREE.Box3();
  let n = 0;
  scene.traverseVisible((o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
    if (o.geometry.attributes.position.count < 300) return;
    une.setFromObject(o);
    if (une.isEmpty() || !Number.isFinite(une.min.x + une.max.x)) return;
    boite.union(une); n++;
  });
  if (!n || boite.isEmpty()) return null;
  return boite.getCenter(new THREE.Vector3());
}

export function centrerRotation(controls, domEl) {
  try {
    _retenirScene();
    if (!controls || !domEl || domEl.__centreRotation) return;
    domEl.__centreRotation = true;
    // 25/10 (user : « il ne faut pas que le maintien de la molette fasse remonter la page, ca doit juste faire tourner l'objet ») : l'appui sur la molette
    // declenche le defilement automatique du navigateur (la page part en haut / en bas). On l'annule sur le canevas ; la rotation (pointerdown) n'est pas touchee.
    for (const evt of ['mousedown', 'auxclick']) domEl.addEventListener(evt, (e) => { if (e.button === 1) e.preventDefault(); }, { capture: true, passive: false });
    domEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 1) return;                       // molette enfoncee = rotation
      const cam = controls.object;
      const c = centreDuModele(cam && cam.__derniereScene);
      if (!c) return;
      const delta = c.clone().sub(controls.target);
      if (delta.lengthSq() < 1e-10) return;
      controls.target.copy(c);
      cam.position.add(delta);
      controls.update();
    }, true);
  } catch (_) { /* sans moteur de rendu connu : comportement d'origine */ }
}
