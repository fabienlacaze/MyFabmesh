// EDITEUR DES POIDS DE PEAU (2026-09-29, user : « dans le rig, un outil qui colore les parties du mesh bougees
// par chaque os, qu'on puisse modifier en peignant, et peindre des parties statiques »).
// FICHIER COMMUN bureau / web (src/renderer/lib = cloud/public/app/lib, garde check-noyaux-partages).
//   - vue « cet os » (degrade bleu -> rouge = part du mouvement) ou « tous les os » (une couleur par os) ;
//   - pinceau : AJOUTER a l'os choisi, RETIRER, ou STATIQUE (rattache a l'os racine : la zone ne suit plus
//     les membres) ; « Choisir » : un clic sur le maillage choisit l'os qui le bouge le plus ;
//   - « Tester l'os » fait osciller l'os choisi pour voir ce qu'il entraine ;
//   - l'enregistrement reecrit JOINTS_0 / WEIGHTS_0 DANS le GLB d'origine (tout le reste intact) et le
//     rend a l'appelant, qui le range comme nouvelle version du rig.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';

const T = (s) => (typeof window !== 'undefined' && typeof window._i18nT === 'function' ? window._i18nT(s) : s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function construireFenetre() {
  let m = document.getElementById('modal-poids-peau');
  if (m) return m;
  m = document.createElement('div');
  m.id = 'modal-poids-peau';
  m.className = 'modal-overlay hidden';
  m.innerHTML = `
  <style>
    #modal-poids-peau .pp-liste { max-height: 190px; overflow-y: auto; border: 1px solid var(--border, #3a3a4a); border-radius: 8px; padding: 3px; }
    #modal-poids-peau .pp-os-btn { display: block; width: 100%; text-align: left; padding: 3px 8px; margin: 0; border: 0; border-radius: 5px;
      background: transparent; color: inherit; font: inherit; font-size: 12px; cursor: pointer; }
    #modal-poids-peau .pp-os-btn:hover { background: rgba(255, 150, 30, 0.28); }
    #modal-poids-peau .pp-os-btn.actif { background: rgba(255, 60, 60, 0.35); font-weight: 600; }
    #modal-poids-peau .modal-card.fen-3d .fen-corps { grid-template-columns: minmax(0, 1fr) 350px; }
    #modal-poids-peau .pp-form { gap: 10px; }
    #modal-poids-peau .pp-sect { display: flex; flex-direction: column; gap: 6px; }
    #modal-poids-peau .pp-tete { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    #modal-poids-peau .pp-case { display: flex; align-items: center; gap: 6px; font-size: 12px; margin: 0; cursor: pointer; }
    #modal-poids-peau .pp-liste { max-height: 132px; }
    #modal-poids-peau .pp-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    #modal-poids-peau .pp-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
    #modal-poids-peau .choix-btn { padding: 6px 4px; text-align: center; }
    #modal-poids-peau .choix-btn b { font-size: 12.5px; }
    #modal-poids-peau .pp-curseur { display: grid; grid-template-columns: 62px 1fr 44px; align-items: center; gap: 8px; font-size: 12px; }
    #modal-poids-peau .pp-curseur input[type=range] { width: 100%; }
    #modal-poids-peau .pp-curseur .fen-valeur { text-align: right; }
    #modal-poids-peau .pp-plie { border: 1px solid var(--border, #3a3a4a); border-radius: 8px; padding: 6px 8px; }
    #modal-poids-peau .pp-plie > summary { cursor: pointer; font-size: 12px; font-weight: 600; color: var(--text-2); user-select: none; }
    #modal-poids-peau .pp-plie[open] > summary { margin-bottom: 6px; }
    #modal-poids-peau .pp-actions { display: flex; gap: 6px; flex-wrap: wrap; }
  </style>
  <div class="modal-card fen-3d">
    <div class="fen-tete"><h2>&#127912; ${esc(T('Skin weights'))}</h2><button type="button" class="settings-close-x" id="pp-close" title="Close">&#10005;</button></div>
    <p class="modal-subtitle">${esc(T('Colors show what each bone moves. Paint to change it.'))}</p>
    <div class="fen-corps">
      <div class="fen-apercu" id="pp-vue"><canvas id="pp-canvas" style="width:100%;height:100%;display:block;"></canvas>
        <div class="fen-apercu-etat" id="pp-etat">${esc(T('Loading…'))}</div></div>
      <div class="fen-form pp-form">
        <div class="pp-sect">
          <div class="pp-tete"><span class="fen-label">${esc(T('Bone'))}</span>
            <label class="pp-case"><input type="checkbox" id="pp-centrer"> <span>${esc(T('Center the view on the bone'))}</span></label></div>
          <div id="pp-liste" class="pp-liste"></div>
        </div>
        <div class="pp-sect">
          <span class="fen-label">${esc(T('View'))}</span>
          <div class="choix pp-2" id="pp-vues">
            <button type="button" class="choix-btn actif" data-v="os"><b>${esc(T('This bone'))}</b></button>
            <button type="button" class="choix-btn" data-v="tous"><b>${esc(T('All bones'))}</b></button>
          </div>
        </div>
        <div class="pp-sect">
          <span class="fen-label">${esc(T('Brush'))}</span>
          <div class="choix pp-4" id="pp-pinceaux">
            <button type="button" class="choix-btn actif" data-p="ajouter" title="${esc(T('moves with this bone'))}"><b>${esc(T('Add'))}</b></button>
            <button type="button" class="choix-btn" data-p="retirer" title="${esc(T('stops following it'))}"><b>${esc(T('Remove'))}</b></button>
            <button type="button" class="choix-btn" data-p="statique" title="${esc(T('follows the body only'))}"><b>${esc(T('Static'))}</b></button>
            <button type="button" class="choix-btn" data-p="choisir" title="${esc(T('click = choose the bone'))}"><b>${esc(T('Pick'))}</b></button>
          </div>
          <div class="pp-curseur"><span>${esc(T('Size'))}</span><input type="range" id="pp-taille" min="1" max="25" value="6"><span class="fen-valeur" id="pp-taille-v">6 %</span></div>
          <div class="pp-curseur"><span>${esc(T('Strength'))}</span><input type="range" id="pp-force" min="5" max="500" value="50"><span class="fen-valeur" id="pp-force-v">50 %</span></div>
        </div>
        <details class="pp-sect pp-plie">
          <summary>${esc(T('Spread / shrink the zone'))}</summary>
          <div class="pp-2">
            <button type="button" class="ghost-btn" id="pp-contracter">&#8722; ${esc(T('Shrink'))}</button>
            <button type="button" class="ghost-btn" id="pp-etendre">+ ${esc(T('Spread'))}</button>
          </div>
          <div class="pp-curseur"><span>${esc(T('Step'))}</span><input type="range" id="pp-pas" min="1" max="20" value="4"><span class="fen-valeur" id="pp-pas-v">2 %</span></div>
        </details>
        <details class="pp-sect pp-plie">
          <summary>${esc(T('Clean far zones'))}</summary>
          <div class="pp-curseur"><span>${esc(T('close'))}</span><input type="range" id="pp-dist" min="1" max="40" value="8"><span class="fen-valeur" id="pp-dist-v">8 %</span></div>
          <button type="button" class="ghost-btn fen-petit" id="pp-dist-ok">${esc(T('Remove zones farther than this'))}</button>
        </details>
        <div class="pp-actions">
          <button type="button" class="ghost-btn fen-petit" id="pp-tester">&#9654; ${esc(T('Test the bone'))}</button>
          <button type="button" class="ghost-btn fen-petit active" id="pp-squelette">&#129460; ${esc(T('Skeleton'))}</button>
          <button type="button" class="ghost-btn fen-petit" id="pp-annuler" disabled>&#8630; ${esc(T('Undo'))}</button>
        </div>
        <span class="fen-note">${esc(T('Left drag = paint · right drag = rotate · middle drag or Shift + right drag = move · wheel = zoom'))}</span>
      </div>
    </div>
    <div class="modal-actions">
      <button class="ghost-btn" id="pp-cancel">${esc(T('Cancel'))}</button>
      <button class="primary-btn" id="pp-save" disabled>${esc(T('Save as new rig version'))}</button>
    </div>
  </div>`;
  document.body.appendChild(m);
  return m;
}

// couleur d'un os (tous les os) : teintes reparties au nombre d'or
const couleurOs = (i) => new THREE.Color().setHSL((i * 0.618034) % 1, 0.75, 0.55);
// degrade « cet os » : 0 = bleu-gris, 1 = rouge
function degrade(w, out) {
  if (w <= 0.001) { out[0] = 0.22; out[1] = 0.25; out[2] = 0.35; return; }
  const c = new THREE.Color().setHSL((1 - w) * 0.66, 0.9, 0.5);
  out[0] = c.r; out[1] = c.g; out[2] = c.b;
}

/**
 * @param {{buffer: ArrayBuffer, enregistrer: (glb: ArrayBuffer) => Promise<void>}} opts
 */
export async function ouvrirEditeurPoids({ buffer, enregistrer }) {
  const fen = construireFenetre();
  const $ = (id) => fen.querySelector('#' + id);
  const etat = $('pp-etat');
  fen.classList.remove('hidden');
  const canvas = $('pp-canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0b12);
  scene.add(new THREE.AmbientLight(0xffffff, 1.2));
  const soleil = new THREE.DirectionalLight(0xffffff, 1.4); soleil.position.set(1, 2, 1.5); scene.add(soleil);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
  const ctrl = new OrbitControls(camera, canvas);
  // clic gauche = pinceau ; molette = zoom ; clic du milieu (ou Maj + clic droit) = TRANSLATER la vue ; clic droit = tourner
  ctrl.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
  ctrl.screenSpacePanning = true;
  let vivant = true;
  const taille = () => {
    const r = $('pp-vue').getBoundingClientRect();
    renderer.setSize(Math.max(1, r.width), Math.max(1, r.height), false);
    camera.aspect = Math.max(1, r.width) / Math.max(1, r.height); camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(taille); ro.observe($('pp-vue'));

  // --- chargement
  const gltf = await new Promise((ok, ko) => new GLTFLoader().parse(buffer.slice(0), '', ok, ko));
  const corps = [];
  gltf.scene.traverse((o) => { if (o.isSkinnedMesh && o.geometry.attributes.skinWeight) corps.push(o); });
  if (!corps.length) { etat.textContent = T('This file has no skin weights.'); }
  scene.add(gltf.scene);
  gltf.scene.updateMatrixWorld(true);
  const boite = new THREE.Box3().setFromObject(gltf.scene), centre = boite.getCenter(new THREE.Vector3());
  const ext = boite.getSize(new THREE.Vector3()).length() || 1;
  camera.position.copy(centre).add(new THREE.Vector3(0.2, 0.25, 1).multiplyScalar(ext * 1.1));
  ctrl.target.copy(centre); ctrl.update();

  const squelette = corps[0]?.skeleton;
  const os = squelette ? squelette.bones : [];
  const racine = Math.max(0, os.findIndex((b) => !b.parent || !b.parent.isBone));
  const liste = $('pp-liste');
  let osChoisi = Math.min(os.length - 1, Math.max(0, racine + 1)), survol = -1;
  liste.innerHTML = os.map((b, i) => `<button type="button" class="pp-os-btn" data-i="${i}">${esc(b.name || 'bone ' + i)}</button>`).join('');
  const boutonsOs = Array.from(liste.children);
  if (boutonsOs[osChoisi]) boutonsOs[osChoisi].classList.add('actif');

  // --- par maillage : positions de repos (monde), couleurs, BVH de pointage, grille pour le pinceau.
  // Poids et os passes en tableaux « bruts » Float32 / Uint16 : la peinture les modifie directement (pas de getComponent).
  const cleGrille = (x, y, z) => ((x + 1024) * 2048 + (y + 1024)) * 2048 + (z + 1024);
  const donnees = corps.map((sm) => {
    const g = sm.geometry, n = g.attributes.position.count;
    const A = g.attributes;
    const w0 = new Float32Array(n * 4), j0 = new Uint16Array(n * 4);
    for (let i = 0; i < n; i++) for (let c = 0; c < 4; c++) { w0[4 * i + c] = A.skinWeight.getComponent(i, c); j0[4 * i + c] = A.skinIndex.getComponent(i, c); }
    g.setAttribute('skinWeight', new THREE.BufferAttribute(w0, 4));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(j0, 4));
    const pos = new Float32Array(n * 3), v = new THREE.Vector3();
    for (let i = 0; i < n; i++) { v.fromBufferAttribute(A.position, i).applyMatrix4(sm.matrixWorld); v.toArray(pos, i * 3); }
    const couleurs = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    g.setAttribute('color', couleurs);
    sm.material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    // maillage de pointage (pose de repos, meme geometrie) accelere par BVH
    const gp = new THREE.BufferGeometry();
    gp.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    if (g.index) gp.setIndex(g.index);
    gp.boundsTree = new MeshBVH(gp);
    const pointage = new THREE.Mesh(gp, new THREE.MeshBasicMaterial({ visible: false }));
    pointage.raycast = acceleratedRaycast;
    const cell = ext * 0.02, grille = new Map();
    for (let i = 0; i < n; i++) {
      const k = cleGrille(Math.floor(pos[3 * i] / cell), Math.floor(pos[3 * i + 1] / cell), Math.floor(pos[3 * i + 2] / cell));
      let l = grille.get(k); if (!l) grille.set(k, (l = [])); l.push(i);
    }
    return { sm, g, n, pos, couleurs, pointage, grille, cell, idx: g.attributes.skinIndex, wts: g.attributes.skinWeight,
      sale: [], min: Infinity, max: -1 };
  });

  let vue = 'os';
  const tmp = [0, 0, 0], palette = os.map((_, i) => { const c = couleurOs(i); return [c.r, c.g, c.b]; });
  const teinte = new THREE.Color();
  function colorer(d, liste2 = null) {
    const I = d.idx.array, W = d.wts.array, a = d.couleurs.array;
    const faire = (i) => {
      const o = i * 4;
      if (vue === 'os') {
        let w = 0;
        for (let c = 0; c < 4; c++) if (I[o + c] === osChoisi) w += W[o + c];
        if (w <= 0.001) { a[3 * i] = 0.22; a[3 * i + 1] = 0.25; a[3 * i + 2] = 0.35; }
        else { teinte.setHSL((1 - Math.min(1, w)) * 0.66, 0.9, 0.5); a[3 * i] = teinte.r; a[3 * i + 1] = teinte.g; a[3 * i + 2] = teinte.b; }
      } else {
        let r = 0, g = 0, b = 0;
        for (let c = 0; c < 4; c++) { const w = W[o + c]; if (w > 0) { const q = palette[I[o + c]] || palette[0]; r += w * q[0]; g += w * q[1]; b += w * q[2]; } }
        a[3 * i] = r; a[3 * i + 1] = g; a[3 * i + 2] = b;
      }
    };
    if (liste2) for (let k = 0; k < liste2.length; k++) faire(liste2[k]); else for (let i = 0; i < d.n; i++) faire(i);
    d.couleurs.needsUpdate = true;
  }
  const toutColorer = () => donnees.forEach((d) => colorer(d));
  toutColorer();
  etat.textContent = `${os.length} ${T('bones')} · ${donnees.reduce((t, d) => t + d.n, 0).toLocaleString()} ${T('vertices')}`;
  function choisirOs(i, defiler = true) {
    osChoisi = i;
    boutonsOs.forEach((x, k) => x.classList.toggle('actif', k === i));
    if (defiler && boutonsOs[i]) boutonsOs[i].scrollIntoView({ block: 'nearest' });
    toutColorer();
  }
  boutonsOs.forEach((x, i) => {
    x.onmouseenter = () => { survol = i; };
    x.onmouseleave = () => { if (survol === i) survol = -1; };
    x.onclick = () => choisirOs(i, false);
  });

  // --- envoi au GPU : UNE fois par image, et seulement la plage touchee
  function envoyer() {
    for (const d of donnees) {
      if (!d.sale.length) continue;
      colorer(d, d.sale);
      const plage = (att, k) => { if (att.addUpdateRange) { att.clearUpdateRanges(); att.addUpdateRange(d.min * k, (d.max - d.min + 1) * k); } att.needsUpdate = true; };
      plage(d.idx, 4); plage(d.wts, 4); plage(d.couleurs, 3);
      d.sale = []; d.min = Infinity; d.max = -1;
    }
  }

  // --- pinceau
  let pinceau = 'ajouter', modifie = false, trait = null, dernier = null;
  const pile = [];
  const rayon = () => ext * (+$('pp-taille').value / 100);
  const force = () => +$('pp-force').value / 100;
  const souris = new THREE.Vector2(), ray = new THREE.Raycaster();
  function toucher(ev) {
    const r = canvas.getBoundingClientRect();
    souris.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(souris, camera);
    let best = null;
    for (const d of donnees) { const h = ray.intersectObject(d.pointage, false)[0]; if (h && (!best || h.distance < best.h.distance)) best = { h, d }; }
    return best;
  }
  function osDominant(d, i) {
    const I = d.idx.array, W = d.wts.array, o = i * 4;
    let m = 0, b = racine;
    for (let c = 0; c < 4; c++) if (W[o + c] > m) { m = W[o + c]; b = I[o + c]; }
    return b;
  }
  function noter(d, i) {                                  // etat d'avant, pour annuler
    if (!trait) return;
    let av = trait.avant.get(d); if (!av) trait.avant.set(d, (av = new Map()));
    if (!av.has(i)) { const o = i * 4, I = d.idx.array, W = d.wts.array; av.set(i, [I[o], I[o + 1], I[o + 2], I[o + 3], W[o], W[o + 1], W[o + 2], W[o + 3]]); }
  }
  function salir(d, i) { d.sale.push(i); if (i < d.min) d.min = i; if (i > d.max) d.max = i; modifie = true; $('pp-save').disabled = false; }
  function viser(d, i, b, cible, f) {
    // cible = part voulue pour l'os b (1 = le suit entierement, 0 = plus du tout)
    const I = d.idx.array, W = d.wts.array, o = i * 4;
    let s = -1;
    for (let c = 0; c < 4; c++) if (I[o + c] === b) { s = c; break; }
    if (s < 0) {
      if (cible <= 0) return false;
      s = 0; for (let c = 1; c < 4; c++) if (W[o + c] < W[o + s]) s = c;
      I[o + s] = b; W[o + s] = 0;
    }
    let reste = 0;
    for (let c = 0; c < 4; c++) if (c !== s) reste += W[o + c];
    const nouveau = W[o + s] + (cible - W[o + s]) * f;
    W[o + s] = nouveau;
    if (reste > 1e-6) { const k = (1 - nouveau) / reste; for (let c = 0; c < 4; c++) if (c !== s) W[o + c] *= k; }
    else if (nouveau < 0.999) {                          // rien d'autre : le reste va a l'os parent
      const parent = os[b]?.parent, pi = parent && parent.isBone ? os.indexOf(parent) : racine;
      const c2 = (s + 1) & 3; I[o + c2] = pi >= 0 ? pi : racine; W[o + c2] = 1 - nouveau;
    }
    for (let c = 0; c < 4; c++) if (W[o + c] < 0) W[o + c] = 0;
    return true;
  }
  function peindre(best) {
    const { h, d } = best, R = rayon(), f0 = force() * 0.35, p = h.point, cell = d.cell, n = Math.ceil(R / cell);
    const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell), cz = Math.floor(p.z / cell), P = d.pos, R2 = R * R;
    for (let x = cx - n; x <= cx + n; x++) for (let y = cy - n; y <= cy + n; y++) for (let z = cz - n; z <= cz + n; z++) {
      const l = d.grille.get(cleGrille(x, y, z)); if (!l) continue;
      for (let k = 0; k < l.length; k++) {
        const i = l[k], dx = P[3 * i] - p.x, dy = P[3 * i + 1] - p.y, dz = P[3 * i + 2] - p.z, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > R2) continue;
        // au-dela de 100 % : plus fort ET plus dur (bord moins doux : exposant 2 -> 0,4 a 500 %), plafonne a 1
        const t = 1 - Math.sqrt(d2) / R, f = Math.min(1, f0 * Math.pow(t, force() > 1 ? 2 / force() : 2));
        noter(d, i);
        const b = pinceau === 'statique' ? racine : osChoisi, cible = pinceau === 'retirer' ? 0 : 1;
        if (viser(d, i, b, cible, f)) salir(d, i);
      }
    }
  }

  // --- propager / contracter la zone de l'os choisi : un PAS par clic (taille du pas = curseur, 0,5 % de l'etendue par cran),
  // valide tout de suite et annulable. Zone = sommets lies a l'os a 35 % ou plus.
  $('pp-pas').oninput = () => { $('pp-pas-v').textContent = (+$('pp-pas').value * 0.5) + ' %'; };
  function pas(etendre) {
    const dist = +$('pp-pas').value * ext * 0.005, D2 = dist * dist;
    trait = { avant: new Map() };
    let nb = 0;
    for (const d of donnees) {
      const I = d.idx.array, W = d.wts.array, P = d.pos, dans = new Uint8Array(d.n);
      for (let i = 0; i < d.n; i++) { let w = 0; for (let c = 0; c < 4; c++) if (I[4 * i + c] === osChoisi) w += W[4 * i + c]; dans[i] = w >= 0.35 ? 1 : 0; }
      const source = etendre ? 1 : 0;                       // etendre : on cherche la zone ; contracter : ce qui est HORS zone
      const g = new Map();
      for (let i = 0; i < d.n; i++) if (dans[i] === source) {
        const k = cleGrille(Math.floor(P[3 * i] / dist), Math.floor(P[3 * i + 1] / dist), Math.floor(P[3 * i + 2] / dist));
        let l = g.get(k); if (!l) g.set(k, (l = [])); l.push(i);
      }
      for (let i = 0; i < d.n; i++) {
        if (dans[i] === source) continue;
        const x = P[3 * i], y = P[3 * i + 1], z = P[3 * i + 2], cx = Math.floor(x / dist), cy = Math.floor(y / dist), cz = Math.floor(z / dist);
        let best = D2 + 1;
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
          const l = g.get(cleGrille(cx + a, cy + b, cz + c)); if (!l) continue;
          for (let k = 0; k < l.length; k++) {
            const j = l[k], dx = P[3 * j] - x, dy = P[3 * j + 1] - y, dz = P[3 * j + 2] - z, q = dx * dx + dy * dy + dz * dz;
            if (q < best) best = q;
          }
        }
        if (best > D2) continue;
        noter(d, i);
        if (viser(d, i, osChoisi, etendre ? 1 : 0, 1 - 0.7 * Math.sqrt(best / D2))) { salir(d, i); nb++; }
      }
    }
    if (trait.avant.size) { pile.push(trait.avant); $('pp-annuler').disabled = false; if (pile.length > 30) pile.shift(); }
    trait = null;
    etat.textContent = `${nb.toLocaleString()} ${T('vertices changed')}`;
  }
  $('pp-etendre').onclick = () => pas(true);
  $('pp-contracter').onclick = () => pas(false);

  // --- nettoyage automatique : retire l'os des sommets trop loin de lui (distance au segment os -> enfants,
  // en pose de repos, en % de l'etendue). Meme mecanique que le pinceau : le poids retire va aux autres os.
  const reposOs = os.map((b) => b.getWorldPosition(new THREE.Vector3()));
  const segsOs = os.map((b, i) => {
    const l = []; b.children.forEach((c) => { if (c.isBone) l.push([reposOs[i], reposOs[os.indexOf(c)]]); });
    return l;
  });
  function distOs(b, x, y, z) {
    const A = reposOs[b], segs = segsOs[b];
    let m = Math.hypot(x - A.x, y - A.y, z - A.z);
    for (const [a, c] of segs) {
      const bx = c.x - a.x, by = c.y - a.y, bz = c.z - a.z, l2 = bx * bx + by * by + bz * bz || 1e-12;
      const t = Math.max(0, Math.min(1, ((x - a.x) * bx + (y - a.y) * by + (z - a.z) * bz) / l2));
      const q = Math.hypot(x - a.x - t * bx, y - a.y - t * by, z - a.z - t * bz); if (q < m) m = q;
    }
    return m;
  }
  function majLibelleNettoyage() {
    $('pp-dist-ok').textContent = `${T('Remove zones farther than this')} (${vue === 'tous' ? T('all bones') : T('this bone')})`;
  }
  majLibelleNettoyage();
  $('pp-dist').oninput = () => { $('pp-dist-v').textContent = $('pp-dist').value + ' %'; };
  $('pp-dist-ok').onclick = () => {
    const dmax = ext * (+$('pp-dist').value / 100), tous = vue === 'tous';        // suit la Vue : cet os / tous les os
    trait = { avant: new Map() };
    let nb = 0;
    for (const d of donnees) {
      const I = d.idx.array, W = d.wts.array, P = d.pos;
      for (let i = 0; i < d.n; i++) {
        let change = false;
        for (let c = 0; c < 4; c++) {
          const b = I[4 * i + c];
          if (W[4 * i + c] <= 0.001 || (!tous && b !== osChoisi)) continue;
          if (distOs(b, P[3 * i], P[3 * i + 1], P[3 * i + 2]) <= dmax) continue;
          noter(d, i);
          if (viser(d, i, b, 0, 1)) change = true;
        }
        if (change) { salir(d, i); nb++; }
      }
    }
    if (trait.avant.size) { pile.push(trait.avant); $('pp-annuler').disabled = false; if (pile.length > 30) pile.shift(); }
    trait = null;
    etat.textContent = `${nb.toLocaleString()} ${T('vertices changed')}`;
  };

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || essai) return;
    const b = toucher(ev); if (!b) return;
    if (pinceau === 'choisir') {
      const f = b.h.face, W = b.d.wts.array;
      const i = [f.a, f.b, f.c].reduce((m, k) => (W[4 * k] > W[4 * m] ? k : m), f.a);
      choisirOs(osDominant(b.d, i)); return;
    }
    trait = { avant: new Map() };
    canvas.setPointerCapture(ev.pointerId);
    peindre(b);
  });
  canvas.addEventListener('pointermove', (ev) => { dernier = ev; });          // traite une fois par image (traiter)
  canvas.addEventListener('pointerleave', () => { dernier = null; anneau.visible = false; });
  const finTrait = () => {
    if (!trait) return;
    if (trait.avant.size) { pile.push(trait.avant); $('pp-annuler').disabled = false; if (pile.length > 30) pile.shift(); }
    trait = null;
  };
  canvas.addEventListener('pointerup', finTrait); canvas.addEventListener('pointercancel', finTrait);
  $('pp-annuler').onclick = () => {
    const av = pile.pop(); if (!av) return;
    for (const [d, m] of av) {
      const I = d.idx.array, W = d.wts.array;
      for (const [i, v] of m) { for (let c = 0; c < 4; c++) { I[4 * i + c] = v[c]; W[4 * i + c] = v[4 + c]; } salir(d, i); }
    }
    $('pp-annuler').disabled = !pile.length;
  };

  // --- cercle du pinceau : suit le curseur sur la surface, a la taille reelle du pinceau
  const pts = []; for (let k = 0; k < 64; k++) pts.push(new THREE.Vector3(Math.cos(k / 64 * 2 * Math.PI), Math.sin(k / 64 * 2 * Math.PI), 0));
  const anneau = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.95 }));
  anneau.renderOrder = 1001; anneau.visible = false; anneau.frustumCulled = false; scene.add(anneau);
  const COULEUR_PINCEAU = { ajouter: 0xffffff, retirer: 0xff5050, statique: 0x40d0ff, choisir: 0xffc040 };
  const zAxe = new THREE.Vector3(0, 0, 1), nrm = new THREE.Vector3();
  function traiter() {                                                      // une fois par image
    if (dernier && !essai) {
      const b = toucher(dernier);
      if (b) {
        nrm.copy(b.h.face.normal).normalize();
        anneau.position.copy(b.h.point).addScaledVector(nrm, ext * 0.002);
        anneau.quaternion.setFromUnitVectors(zAxe, nrm);
        anneau.scale.setScalar(pinceau === 'choisir' ? ext * 0.008 : rayon());
        anneau.material.color.setHex(COULEUR_PINCEAU[pinceau] || 0xffffff);
        anneau.visible = true;
        if (trait) peindre(b);
      } else anneau.visible = false;
      if (!trait) dernier = null;
      else if (dernier) { /* garde le dernier point pour continuer le trait */ }
    }
    envoyer();
  }

  // --- choix
  fen.querySelectorAll('#pp-vues .choix-btn').forEach((b) => b.onclick = () => {
    fen.querySelectorAll('#pp-vues .choix-btn').forEach((x) => x.classList.toggle('actif', x === b));
    vue = b.dataset.v; toutColorer(); majLibelleNettoyage();
  });
  fen.querySelectorAll('#pp-pinceaux .choix-btn').forEach((b) => b.onclick = () => {
    fen.querySelectorAll('#pp-pinceaux .choix-btn').forEach((x) => x.classList.toggle('actif', x === b));
    pinceau = b.dataset.p;
  });
  $('pp-taille').oninput = () => { $('pp-taille-v').textContent = $('pp-taille').value + ' %'; };
  $('pp-force').oninput = () => { $('pp-force-v').textContent = $('pp-force').value + ' %'; };

  // --- tester l'os : oscillation autour de sa pose de repos
  let essai = null;
  $('pp-tester').onclick = () => {
    if (essai) { essai.b.quaternion.copy(essai.q0); essai = null; $('pp-tester').classList.remove('active'); return; }
    const b = os[osChoisi]; if (!b) return;
    essai = { b, q0: b.quaternion.clone(), t0: performance.now() };
    $('pp-tester').classList.add('active');
  };

  // --- squelette : segments os -> enfants (blanc), os choisi en ROUGE (segments vers ses enfants + articulation),
  // dessine par-dessus le maillage ; suit l'os pendant « Tester l'os »
  const nSeg = os.reduce((t, b) => t + b.children.filter((c) => c.isBone).length, 0);
  const geoSq = new THREE.BufferGeometry();
  geoSq.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nSeg * 6), 3));
  geoSq.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nSeg * 6), 3));
  const lignesSq = new THREE.LineSegments(geoSq, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }));
  lignesSq.renderOrder = 999; lignesSq.frustumCulled = false;
  const articulation = new THREE.Mesh(new THREE.SphereGeometry(ext * 0.012, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xff2a2a, depthTest: false }));
  articulation.renderOrder = 1000;
  const articulationSurvol = new THREE.Mesh(new THREE.SphereGeometry(ext * 0.014, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xff9a1a, depthTest: false }));
  articulationSurvol.renderOrder = 1002; articulationSurvol.visible = false;
  const groupeSq = new THREE.Group(); groupeSq.add(lignesSq, articulation, articulationSurvol); scene.add(groupeSq);
  const va = new THREE.Vector3(), vb = new THREE.Vector3();
  function majSquelette() {
    if (!groupeSq.visible) return;
    const P = geoSq.attributes.position.array, C = geoSq.attributes.color.array;
    let k = 0;
    os.forEach((b, i) => {
      b.getWorldPosition(va);
      for (const c of b.children) {
        if (!c.isBone) continue;
        c.getWorldPosition(vb);
        va.toArray(P, k * 6); vb.toArray(P, k * 6 + 3);
        const rouge = i === osChoisi, orange = i === survol;
        const col = orange ? [1, 0.55, 0.05] : rouge ? [1, 0.1, 0.1] : [0.85, 0.9, 1];
        for (let e = 0; e < 2; e++) { C[k * 6 + e * 3] = col[0]; C[k * 6 + e * 3 + 1] = col[1]; C[k * 6 + e * 3 + 2] = col[2]; }
        k++;
      }
    });
    geoSq.attributes.position.needsUpdate = true; geoSq.attributes.color.needsUpdate = true;
    os[osChoisi]?.getWorldPosition(articulation.position);
    articulationSurvol.visible = survol >= 0;
    if (survol >= 0) os[survol]?.getWorldPosition(articulationSurvol.position);
  }
  $('pp-squelette').onclick = () => {
    groupeSq.visible = !groupeSq.visible;
    $('pp-squelette').classList.toggle('active', groupeSq.visible);
  };

  // --- boucle
  const tourner = () => {
    if (!vivant) return;
    traiter();
    majSquelette();
    if ($('pp-centrer').checked && os[osChoisi]) {            // la vue suit l'os choisi, en douceur
      os[osChoisi].getWorldPosition(va);
      vb.copy(va).sub(ctrl.target).multiplyScalar(0.2);
      ctrl.target.add(vb); camera.position.add(vb);
    }
    if (essai) {
      const a = 0.6 * Math.sin((performance.now() - essai.t0) / 350);
      essai.b.quaternion.copy(essai.q0).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(a, 0, a * 0.5)));
    }
    ctrl.update(); renderer.render(scene, camera);
    requestAnimationFrame(tourner);
  };
  taille(); tourner();

  // --- fermeture / enregistrement
  const fermer = () => {
    vivant = false; ro.disconnect(); ctrl.dispose(); renderer.dispose();
    donnees.forEach((d) => { d.pointage.geometry.dispose(); });
    geoSq.dispose(); articulation.geometry.dispose(); articulationSurvol.geometry.dispose(); anneau.geometry.dispose();
    fen.classList.add('hidden');
  };
  $('pp-cancel').onclick = fermer;
  $('pp-close').onclick = fermer;
  $('pp-save').onclick = async () => {
    const btn = $('pp-save'), txt = btn.textContent;
    btn.disabled = true; btn.textContent = T('Saving…');
    try {
      if (essai) { essai.b.quaternion.copy(essai.q0); essai = null; }
      const glb = reecrirePoids(buffer, gltf, donnees);
      await enregistrer(glb);
      fermer();
    } catch (e) {
      etat.textContent = T('Save failed: ') + (e && e.message ? e.message : e);
      btn.disabled = false; btn.textContent = txt;
    }
  };
}

/** Reecrit JOINTS_0 / WEIGHTS_0 dans une COPIE du GLB d'origine (meme taille, tout le reste intact). */
export function reecrirePoids(buffer, gltf, donnees) {
  const out = buffer.slice(0), dv = new DataView(out);
  const nJson = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(out, 20, nJson)));
  const bin0 = 20 + nJson + 8;
  if ((json.extensionsUsed || []).includes('EXT_meshopt_compression') || (json.extensionsUsed || []).includes('KHR_draco_mesh_compression'))
    throw new Error('compressed file: skin weights cannot be rewritten in place');
  const ecrire = (accIdx, attr, estPoids) => {
    const a = json.accessors[accIdx];
    if (a.sparse) throw new Error('sparse accessor');
    const bv = json.bufferViews[a.bufferView], ct = a.componentType, sz = { 5126: 4, 5121: 1, 5123: 2 }[ct];
    const st = bv.byteStride || 4 * sz, base = bin0 + (bv.byteOffset || 0) + (a.byteOffset || 0);
    if (a.count !== attr.count) throw new Error('vertex count mismatch');
    for (let i = 0; i < a.count; i++) {
      let vals = [0, 1, 2, 3].map((c) => attr.getComponent(i, c));
      if (estPoids) { const s = vals.reduce((t, x) => t + x, 0) || 1; vals = vals.map((x) => x / s); }
      for (let c = 0; c < 4; c++) {
        const o = base + i * st + c * sz, v = vals[c];
        if (ct === 5126) dv.setFloat32(o, v, true);
        else if (ct === 5121) dv.setUint8(o, estPoids ? Math.round(v * 255) : v);
        else dv.setUint16(o, estPoids ? Math.round(v * 65535) : v, true);
      }
    }
  };
  for (const d of donnees) {
    const as = gltf.parser.associations.get(d.sm);
    if (!as || as.meshes == null) throw new Error('mesh not found in the file');
    const pr = json.meshes[as.meshes].primitives[as.primitives ?? 0];
    ecrire(pr.attributes.JOINTS_0, d.idx, false);
    ecrire(pr.attributes.WEIGHTS_0, d.wts, true);
  }
  return out;
}
