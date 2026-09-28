// Mini-lecteur d'APERÇU des allures (2026-09-28) : joue en boucle, sur le rig du projet,
// l'allure choisie dans le sélecteur d'animations, AVANT toute génération. Le rig n'est
// chargé qu'une fois ; chaque allure est calculée par le moteur procédural (quelques ms) et
// jouée directement, sans réécrire de GLB. Même fichier sur le bureau et le web
// (THREE importé par « three » : un chemin relatif chargerait un second THREE sur le web).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { animerPistes, modeDuSquelette } from './locomotion-procedurale.js';

export function creerApercu(canvas) {
  let rendu = null, scene = null, camera = null, melangeur = null, modele = null;
  let cle = null, tampon = null, noeuds = null, raf = 0, detruit = false, enCours = null, controles = null, modeSq = null;
  const horloge = new THREE.Clock();

  function initRendu() {
    rendu = new THREE.WebGLRenderer({ canvas, antialias: true });
    rendu.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0e0e14);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x333344, 2.2));
    const soleil = new THREE.DirectionalLight(0xffffff, 1.4);
    soleil.position.set(2, 4, 3);
    scene.add(soleil);
    camera = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);
    // Tourner autour du rig (glisser) et zoomer (molette) — demande user du 2026-09-28.
    // Pas de deplacement lateral : le rig reste au centre, il marche sur place.
    controles = new OrbitControls(camera, canvas);
    controles.enableDamping = true;
    controles.dampingFactor = 0.12;
    controles.enablePan = false;
    canvas.style.cursor = 'grab';
    boucle();
  }
  function boucle() {
    if (detruit) return;
    raf = requestAnimationFrame(boucle);
    const dt = horloge.getDelta();
    if (!canvas.offsetParent) return;                         // carte repliée : rien à dessiner
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.floor(w * rendu.getPixelRatio())) {
      rendu.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    if (melangeur) melangeur.update(dt);
    controles?.update();
    rendu.render(scene, camera);
  }
  function liberer(obj) {
    obj.traverse((o) => {
      o.geometry?.dispose?.();
      const m = o.material;
      (Array.isArray(m) ? m : m ? [m] : []).forEach((x) => { for (const k in x) if (x[k]?.isTexture) x[k].dispose(); x.dispose?.(); });
    });
  }
  function cadrer() {
    // cadrage sur les OS : la boîte d'un maillage skinné peut être fausse (repères différents)
    modele.updateMatrixWorld(true);
    const boite = new THREE.Box3();
    modele.traverse((o) => { if (o.isBone) boite.expandByPoint(o.getWorldPosition(new THREE.Vector3())); });
    if (boite.isEmpty()) boite.setFromObject(modele);
    const c = boite.getCenter(new THREE.Vector3()), t = boite.getSize(new THREE.Vector3()).length() * 1.3 || 1;
    camera.position.set(c.x + t * 1.1, c.y + t * 0.45, c.z + t * 1.35);
    camera.near = t / 200;
    camera.far = t * 50;
    camera.lookAt(c);
    camera.updateProjectionMatrix();
    if (controles) {                                         // nouveau rig : l'orbite repart de ce cadrage
      controles.target.copy(c);
      controles.minDistance = t * 0.25;
      controles.maxDistance = t * 6;
      controles.update();
    }
  }

  /** Charge le rig (une fois par clé). `lireTampon` rend un ArrayBuffer du GLB riggé. */
  async function chargerRig(nouvelleCle, lireTampon) {
    if (nouvelleCle === cle && modele) return true;
    if (enCours && enCours.cle === nouvelleCle) return enCours.promesse;
    const promesse = (async () => {
      const buf = await lireTampon();
      if (!buf || detruit) return false;
      if (!rendu) initRendu();
      const g = await new Promise((ok, ko) => new GLTFLoader().parse(buf, '', ok, ko));
      if (detruit) return false;
      if (modele) { scene.remove(modele); liberer(modele); }
      modele = g.scene;
      modele.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
      scene.add(modele);
      noeuds = new Map();
      for (const [obj, a] of g.parser.associations) if (a && a.nodes !== undefined && obj.isObject3D) noeuds.set(a.nodes, obj);
      tampon = buf;
      modeSq = null;                                         // nouveau rig : mode a recalculer
      cle = nouvelleCle;
      melangeur = new THREE.AnimationMixer(modele);
      cadrer();
      return true;
    })();
    enCours = { cle: nouvelleCle, promesse };
    try { return await promesse; } finally { if (enCours?.promesse === promesse) enCours = null; }
  }

  /** Joue en boucle une allure (« walk », « walk__sneak »…), sur place. */
  /** Mode deduit du SQUELETTE seul (pattes detectees ou non), calcule une fois par rig. */
  function modeSquelette() {
    if (!tampon) return null;
    if (!modeSq) { try { modeSq = modeDuSquelette(tampon); } catch (_) { modeSq = 'pattes'; } }
    return modeSq;
  }
  function jouer(nomClip, mode = 'auto', espece = 'generique') {
    if (!modele || !tampon) return false;
    const { clips } = animerPistes(tampon, { allures: [nomClip], cycles: 2, mode, espece });
    const c = clips[0];
    const pistes = [];
    for (const { noeud, q } of c.rotations) {
      const o = noeuds.get(noeud);
      if (o) pistes.push(new THREE.QuaternionKeyframeTrack(o.uuid + '.quaternion', c.temps, q));
    }
    // racine principale puis racines SECONDAIRES (arme, accessoire séparé du corps) : sur place
    // toutes les deux, au même décalage, pour qu'elles ne se séparent pas
    const dx = c.translation.v[0], dz = c.translation.v[2];
    for (const tr_ of [c.translation, ...(c.translationsSec || [])]) {
      const o = noeuds.get(tr_.noeud);
      if (!o) continue;
      const v = tr_.v.slice();
      for (let i = 3; i < v.length; i += 3) { v[i] -= c.translation.v[i] - dx; v[i + 2] -= c.translation.v[i + 2] - dz; }   // sur place (le cap tourne encore)
      pistes.push(new THREE.VectorKeyframeTrack(o.uuid + '.position', c.temps, v));
    }
    melangeur.stopAllAction();
    melangeur.uncacheRoot(modele);
    melangeur.clipAction(new THREE.AnimationClip(nomClip, c.duree, pistes)).play();
    return true;
  }
  /** Pose de repos (animation IA : pas d'aperçu). */
  function arreter() { if (melangeur) { melangeur.stopAllAction(); modele?.traverse((o) => { if (o.isSkinnedMesh) o.skeleton.pose(); }); } }
  function detruire() {
    detruit = true;
    cancelAnimationFrame(raf);
    if (modele) liberer(modele);
    controles?.dispose();
    rendu?.dispose();
  }
  return { chargerRig, jouer, arreter, detruire, modeSquelette, pret: () => !!modele, cleChargee: () => cle };
}
