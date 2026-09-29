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
  <div class="modal-card fen-3d">
    <div class="fen-tete"><h2>&#127912; ${esc(T('Skin weights'))}</h2><button type="button" class="settings-close-x" id="pp-close" title="Close">&#10005;</button></div>
    <p class="modal-subtitle">${esc(T('Colors show what each bone moves. Paint to change it.'))}</p>
    <div class="fen-corps">
      <div class="fen-apercu" id="pp-vue"><canvas id="pp-canvas" style="width:100%;height:100%;display:block;"></canvas>
        <div class="fen-apercu-etat" id="pp-etat">${esc(T('Loading…'))}</div></div>
      <div class="fen-form">
        <div class="fen-champ"><span class="fen-label">${esc(T('Bone'))}</span>
          <select id="pp-os"></select>
          <span class="fen-note">${esc(T('Or pick it with the Pick brush, by clicking the mesh.'))}</span></div>
        <label class="opt-ligne"><input type="checkbox" id="pp-centrer"> <span>${esc(T('Center the view on the bone'))}</span></label>
        <div class="fen-champ"><span class="fen-label">${esc(T('View'))}</span>
          <div class="choix" id="pp-vues">
            <button type="button" class="choix-btn actif" data-v="os"><b>${esc(T('This bone'))}</b></button>
            <button type="button" class="choix-btn" data-v="tous"><b>${esc(T('All bones'))}</b></button>
          </div></div>
        <div class="fen-champ"><span class="fen-label">${esc(T('Brush'))}</span>
          <div class="choix" id="pp-pinceaux" style="grid-template-columns:1fr 1fr;">
            <button type="button" class="choix-btn actif" data-p="ajouter"><b>${esc(T('Add'))}</b><small>${esc(T('moves with this bone'))}</small></button>
            <button type="button" class="choix-btn" data-p="retirer"><b>${esc(T('Remove'))}</b><small>${esc(T('stops following it'))}</small></button>
            <button type="button" class="choix-btn" data-p="statique"><b>${esc(T('Static'))}</b><small>${esc(T('follows the body only'))}</small></button>
            <button type="button" class="choix-btn" data-p="choisir"><b>${esc(T('Pick'))}</b><small>${esc(T('click = choose the bone'))}</small></button>
          </div></div>
        <div class="fen-champ"><div class="fen-champ-tete"><span class="fen-label">${esc(T('Size'))}</span><span class="fen-valeur" id="pp-taille-v">6 %</span></div>
          <input type="range" id="pp-taille" min="1" max="25" value="6"></div>
        <div class="fen-champ"><div class="fen-champ-tete"><span class="fen-label">${esc(T('Strength'))}</span><span class="fen-valeur" id="pp-force-v">50 %</span></div>
          <input type="range" id="pp-force" min="5" max="100" value="50"></div>
        <div class="opt-ligne" style="gap:8px;display:flex;flex-wrap:wrap;">
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
  const sel = $('pp-os');
  sel.innerHTML = os.map((b, i) => `<option value="${i}">${esc(b.name || 'bone ' + i)}</option>`).join('');
  let osChoisi = Math.min(os.length - 1, Math.max(0, racine + 1));
  sel.value = String(osChoisi);

  // --- par maillage : positions de repos (monde), couleurs, BVH de pointage, grille pour le pinceau
  const donnees = corps.map((sm) => {
    const g = sm.geometry, n = g.attributes.position.count;
    const pos = new Float32Array(n * 3), v = new THREE.Vector3();
    for (let i = 0; i < n; i++) { v.fromBufferAttribute(g.attributes.position, i).applyMatrix4(sm.matrixWorld); v.toArray(pos, i * 3); }
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
    const cle = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
    for (let i = 0; i < n; i++) {
      const k = cle(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]);
      let l = grille.get(k); if (!l) grille.set(k, (l = [])); l.push(i);
    }
    return { sm, g, n, pos, couleurs, pointage, grille, cell, idx: g.attributes.skinIndex, wts: g.attributes.skinWeight };
  });

  let vue = 'os';
  const tmp = [0, 0, 0], palette = os.map((_, i) => couleurOs(i));
  function colorer(d, liste = null) {
    const { idx, wts, couleurs } = d, a = couleurs.array;
    const faire = (i) => {
      if (vue === 'os') {
        let w = 0;
        for (let c = 0; c < 4; c++) if (idx.getComponent(i, c) === osChoisi) w += wts.getComponent(i, c);
        degrade(w, tmp); a[3 * i] = tmp[0]; a[3 * i + 1] = tmp[1]; a[3 * i + 2] = tmp[2];
      } else {
        let r = 0, g = 0, b = 0;
        for (let c = 0; c < 4; c++) { const w = wts.getComponent(i, c); if (w > 0) { const p = palette[idx.getComponent(i, c)] || palette[0]; r += w * p.r; g += w * p.g; b += w * p.b; } }
        a[3 * i] = r; a[3 * i + 1] = g; a[3 * i + 2] = b;
      }
    };
    if (liste) liste.forEach(faire); else for (let i = 0; i < d.n; i++) faire(i);
    couleurs.needsUpdate = true;
  }
  const toutColorer = () => donnees.forEach((d) => colorer(d));
  toutColorer();
  etat.textContent = `${os.length} ${T('bones')} · ${donnees.reduce((t, d) => t + d.n, 0).toLocaleString()} ${T('vertices')}`;

  // --- pinceau
  let pinceau = 'ajouter', modifie = false, trait = null;
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
    let m = 0, b = racine;
    for (let c = 0; c < 4; c++) { const w = d.wts.getComponent(i, c); if (w > m) { m = w; b = d.idx.getComponent(i, c); } }
    return b;
  }
  function viser(d, i, b, cible, f) {
    // cible = part voulue pour l'os b (1 = le suit entierement, 0 = plus du tout)
    const J = [0, 1, 2, 3].map((c) => d.idx.getComponent(i, c)), W = [0, 1, 2, 3].map((c) => d.wts.getComponent(i, c));
    let s = J.indexOf(b);
    if (s < 0) {
      if (cible <= 0) return;
      s = W.indexOf(Math.min(...W)); J[s] = b; W[s] = 0;
    }
    const nouveau = W[s] + (cible - W[s]) * f, reste = W.reduce((t, w, c) => t + (c === s ? 0 : w), 0);
    W[s] = nouveau;
    if (reste > 1e-6) for (let c = 0; c < 4; c++) { if (c !== s) W[c] *= (1 - nouveau) / reste; }
    else if (nouveau < 0.999) {                       // rien d'autre : le reste va a l'os parent
      const parent = os[b]?.parent, pi = parent && parent.isBone ? os.indexOf(parent) : racine;
      const c2 = (s + 1) % 4; J[c2] = pi >= 0 ? pi : racine; W[c2] = 1 - nouveau;
    }
    for (let c = 0; c < 4; c++) { d.idx.setComponent(i, c, J[c]); d.wts.setComponent(i, c, Math.max(0, W[c])); }
  }
  function peindre(best) {
    const { h, d } = best, R = rayon(), f0 = force() * 0.35, p = h.point, cell = d.cell, n = Math.ceil(R / cell);
    const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell), cz = Math.floor(p.z / cell), touches = [];
    for (let x = cx - n; x <= cx + n; x++) for (let y = cy - n; y <= cy + n; y++) for (let z = cz - n; z <= cz + n; z++) {
      const l = d.grille.get(`${x},${y},${z}`); if (!l) continue;
      for (const i of l) {
        const dist = Math.hypot(d.pos[3 * i] - p.x, d.pos[3 * i + 1] - p.y, d.pos[3 * i + 2] - p.z);
        if (dist > R) continue;
        const f = f0 * (1 - dist / R) ** 2;
        if (!trait.avant.has(d)) trait.avant.set(d, new Map());
        const av = trait.avant.get(d);
        if (!av.has(i)) av.set(i, [0, 1, 2, 3].flatMap((c) => [d.idx.getComponent(i, c), d.wts.getComponent(i, c)]));
        if (pinceau === 'ajouter') viser(d, i, osChoisi, 1, f);
        else if (pinceau === 'retirer') viser(d, i, osChoisi, 0, f);
        else if (pinceau === 'statique') viser(d, i, racine, 1, f);
        touches.push(i);
      }
    }
    if (!touches.length) return;
    d.idx.needsUpdate = true; d.wts.needsUpdate = true;
    colorer(d, touches);
    modifie = true; $('pp-save').disabled = false;
  }
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || essai) return;
    const b = toucher(ev); if (!b) return;
    if (pinceau === 'choisir') {
      const f = b.h.face, i = [f.a, f.b, f.c].reduce((m, k) => (b.d.wts.getComponent(k, 0) > b.d.wts.getComponent(m, 0) ? k : m), f.a);
      osChoisi = osDominant(b.d, i); sel.value = String(osChoisi); toutColorer(); return;
    }
    trait = { avant: new Map() };
    canvas.setPointerCapture(ev.pointerId);
    peindre(b);
  });
  canvas.addEventListener('pointermove', (ev) => { if (!trait) return; const b = toucher(ev); if (b) peindre(b); });
  const finTrait = () => {
    if (!trait) return;
    if (trait.avant.size) { pile.push(trait.avant); $('pp-annuler').disabled = false; if (pile.length > 30) pile.shift(); }
    trait = null;
  };
  canvas.addEventListener('pointerup', finTrait); canvas.addEventListener('pointercancel', finTrait);
  $('pp-annuler').onclick = () => {
    const av = pile.pop(); if (!av) return;
    for (const [d, m] of av) {
      for (const [i, v] of m) for (let c = 0; c < 4; c++) { d.idx.setComponent(i, c, v[2 * c]); d.wts.setComponent(i, c, v[2 * c + 1]); }
      d.idx.needsUpdate = true; d.wts.needsUpdate = true; colorer(d, [...m.keys()]);
    }
    $('pp-annuler').disabled = !pile.length;
  };

  // --- choix
  sel.onchange = () => { osChoisi = +sel.value; toutColorer(); };
  fen.querySelectorAll('#pp-vues .choix-btn').forEach((b) => b.onclick = () => {
    fen.querySelectorAll('#pp-vues .choix-btn').forEach((x) => x.classList.toggle('actif', x === b));
    vue = b.dataset.v; toutColorer();
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
  const groupeSq = new THREE.Group(); groupeSq.add(lignesSq, articulation); scene.add(groupeSq);
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
        const rouge = i === osChoisi;
        for (let e = 0; e < 2; e++) { C[k * 6 + e * 3] = rouge ? 1 : 0.85; C[k * 6 + e * 3 + 1] = rouge ? 0.1 : 0.9; C[k * 6 + e * 3 + 2] = rouge ? 0.1 : 1; }
        k++;
      }
    });
    geoSq.attributes.position.needsUpdate = true; geoSq.attributes.color.needsUpdate = true;
    os[osChoisi]?.getWorldPosition(articulation.position);
  }
  $('pp-squelette').onclick = () => {
    groupeSq.visible = !groupeSq.visible;
    $('pp-squelette').classList.toggle('active', groupeSq.visible);
  };

  // --- boucle
  const tourner = () => {
    if (!vivant) return;
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
    geoSq.dispose(); articulation.geometry.dispose();
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
