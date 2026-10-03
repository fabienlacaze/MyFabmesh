// Voie bureau-interface, 2026-10-03 : tests des correctifs de src/renderer (editeur de maillage, Paint Mesh,
// installation de la segmentation, etat des boutons Blender, paliers de qualite et libelles).
// Chaque test charge le VRAI texte de index2.js / index2.html, en decoupe le bloc concerne par des reperes
// et l execute avec des doublures minimales. Lancer : node --test tests/bureau-interface/editeur-et-reglages.test.mjs
// Pour verifier qu ils ECHOUENT sur l ancien code : FICHIER_INDEX2=<index2.js ancien> FICHIER_HTML=<index2.html ancien>.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as THREE from 'three';

const lire = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const SRC = lire(process.env.FICHIER_INDEX2 || new URL('../../src/renderer/index2.js', import.meta.url));
const HTML = lire(process.env.FICHIER_HTML || new URL('../../src/renderer/index2.html', import.meta.url));

function bloc(src, debut, fin) {
  const a = src.indexOf(debut); assert.ok(a >= 0, 'repere de debut introuvable : ' + debut);
  const b = src.indexOf(fin, a + debut.length); assert.ok(b > a, 'repere de fin introuvable : ' + fin);
  return src.slice(a, b);
}

// ---------- doublures communes ----------
function geometrieTest({ avecUv = true } = {}) {
  // deux triangles (4 sommets) avec UV, normales et couleurs de vertex
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]), 3));
  if (avecUv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array([0.2, 0.3, 0.4, 0.2, 0.3, 0.4, 0.2, 0.3, 0.4, 0.2, 0.3, 0.4]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}
function editeur(geom) {
  const clics = {};
  const toasts = [];
  const meshObj = { isMesh: true, geometry: geom, material: {} };
  const meState = { mesh: { traverse: (cb) => cb(meshObj) }, meshPath: 'C:/x/m.glb' };
  const document = { getElementById: (id) => ({ addEventListener: (ev, fn) => { if (ev === 'click') clics[id] = fn; } }) };
  return { clics, toasts, meState, document, showToast: (m, t) => toasts.push([m, t]) };
}

// ---------- (b) Delete : la couleur cyan ne fuit plus ----------
test('Select All + Delete : les sommets supprimes retrouvent leur vraie couleur (pas de cyan dans COLOR_0)', () => {
  const code = bloc(SRC, "document.getElementById('me-sel-delete')?.addEventListener", "document.getElementById('me-sel-invert')");
  const g = geometrieTest();
  const e = editeur(g);
  // selection de TOUS les sommets, couleur d origine memorisee, sommets teintes en cyan (comme « Select All »)
  const sel = new Map(); const col = g.attributes.color;
  for (let i = 0; i < col.count; i++) { sel.set(i, [col.getX(i), col.getY(i), col.getZ(i)]); col.setXYZ(i, 0, 1, 1); }
  g._selSaved = sel;
  new Function('document', 'meState', '_meRestoreView', '_mePushUndo', 'showToast', code)(e.document, e.meState, () => {}, () => {}, e.showToast);
  e.clics['me-sel-delete']();
  for (let i = 0; i < col.count; i++) assert.deepEqual([col.getX(i), col.getY(i), col.getZ(i)].map((v) => +v.toFixed(3)), [0.2, 0.3, 0.4], 'sommet ' + i + ' encore cyan');
  assert.equal(g.index.count, 0);
});

// ---------- (d) Duplicate : tous les attributs sont prolonges ----------
test('Select > Duplicate : POSITION, UV, NORMAL et COLOR ont le meme nombre de sommets', () => {
  const code = bloc(SRC, "document.getElementById('me-sel-duplicate')?.addEventListener", '// --- Extra Paint tools');
  const g = geometrieTest();
  const e = editeur(g);
  const sel = new Map(); const col = g.attributes.color;
  for (let i = 0; i < col.count; i++) { sel.set(i, [col.getX(i), col.getY(i), col.getZ(i)]); col.setXYZ(i, 0, 1, 1); }
  g._selSaved = sel;
  const ensureColor = (c) => c.geometry.attributes.color;
  new Function('document', 'meState', 'THREE', '_meRestoreView', '_mePushUndo', '_meHasSelection', '_meEnsureColor', '_meUpdateSelButtons', 'showToast', code)(
    e.document, e.meState, THREE, () => {}, () => {}, () => true, ensureColor, () => {}, e.showToast);
  e.clics['me-sel-duplicate']();
  const n = g.attributes.position.count;
  assert.equal(n, 4 + 6, '2 triangles dupliques = 6 sommets de plus');
  for (const nom of Object.keys(g.attributes)) assert.equal(g.attributes[nom].count, n, nom + ' doit avoir ' + n + ' sommets (GLB valide)');
  assert.equal(g.index.count, 12);
  // les UV de la copie reprennent ceux des sommets d origine
  assert.deepEqual([g.attributes.uv.getX(4), g.attributes.uv.getY(4)], [0, 0]);
});

// ---------- (a) Save : refus d un maillage sans face ----------
test('Enregistrer un maillage sans aucune face est refuse avec un message', async () => {
  const code = bloc(SRC, "document.getElementById('me-save')?.addEventListener", '// Clean export base name');
  const g = geometrieTest(); g.setIndex([]);
  const e = editeur(g);
  let jobs = 0;
  new Function('document', 'meState', 'state', '_meRestoreView', '_meSetSelectionTint', 'pushJob', 'completeJob', 'showToast', 'API', '_closeMeshEdit', 'populateWorkspace', code)(
    e.document, e.meState, { currentProject: { name: 'p' } }, () => {}, () => {}, () => { jobs++; return { id: 1 }; }, () => {}, e.showToast, {}, () => {}, () => {});
  await e.clics['me-save']();
  assert.equal(jobs, 0, 'aucun travail d enregistrement ne doit etre cree');
  assert.ok(e.toasts.some(([m, t]) => /no faces/i.test(m) && t === 'error'), 'message clair attendu');
});

// ---------- (c) Paint Mesh : taille native ----------
test('Paint Mesh : la texture 4096 garde ses 4096 px et l historique est borne', async () => {
  const code = bloc(SRC, 'const PM_HISTORY_MAX = 20;', 'function _pmRestoreMaterials');
  const canvasFaux = () => ({ width: 0, height: 0, getContext: () => ({ drawImage() {}, fillRect() {}, getImageData: () => ({}) }) });
  const doc = { createElement: () => canvasFaux(), getElementById: () => null };
  class Tex { constructor(c) { this.image = c; } }
  class Col { constructor() {} }
  const fauxTHREE = { CanvasTexture: Tex, Color: Col, SRGBColorSpace: 'srgb', RepeatWrapping: 1000 };
  const mesh = { material: { map: { image: { width: 4096, height: 4096 }, flipY: false } } };
  const pmState = { meshes: [{ mesh }], canvases: null };
  const fab = new Function('document', 'THREE', 'pmState', '_pmHistoryPush', 'pmState_', code + '; return { _pmSetupCanvasAndBind, _pmHistoryMax: typeof _pmHistoryMax === "function" ? _pmHistoryMax : null };');
  const r = fab(doc, fauxTHREE, pmState, () => {});
  await r._pmSetupCanvasAndBind();
  const d = pmState.canvases.get(mesh).diffuse;
  assert.equal(d.w, 4096); assert.equal(d.h, 4096);
  assert.ok(r._pmHistoryMax, 'budget d historique attendu');
  assert.ok(r._pmHistoryMax() <= 20 && r._pmHistoryMax() >= 2);
});

// ---------- (e) Segmentation : « Cancel » ne laisse pas de travail en erreur ----------
test('Installation de la segmentation refusee : aucune tuile en erreur', async () => {
  const code = bloc(SRC, 'async function _runSegmentJob(granularity, allowInstall) {', 'async function runMeshSegment()');
  const extra = (SRC.includes('function _retirerJobSansTrace')) ? bloc(SRC, '/** 2026-10-03 (campagne 3D, defaut 12)', 'async function _runSegmentJob(') : '';
  const state = { jobs: [], currentProject: { name: 'p', previewMeshPath: 'C:/m.glb', meshes: [] } };
  const erreurs = [];
  const pushJob = (nom) => { const j = { id: state.jobs.length + 1, name: nom, status: 'running' }; state.jobs.push(j); return j; };
  const completeJob = (id, ok, msg) => { const j = state.jobs.find((x) => x.id === id); j.status = ok ? 'done' : 'error'; if (!ok) erreurs.push(msg); };
  const fab = new Function('state', 'pushJob', 'completeJob', 'API', 'customConfirm', '_installSegmentEngine', '_meshJobThumb', 'showToast', 'populateWorkspace', 'renderJobs', 'window',
    extra + '\n' + code + '; return _runSegmentJob;');
  const run = fab(state, pushJob, completeJob, { meshSegment: async () => ({ success: false, error: 'engine not installed' }) },
    async () => false, async () => true, () => '', () => {}, () => {}, () => {}, {});
  await run(0.2, true);
  assert.equal(state.jobs.filter((j) => j.status === 'error').length, 0, 'aucune tuile en erreur apres Cancel');
  assert.deepEqual(erreurs, []);
});

// ---------- DU-2 : etat des boutons Blender relu ----------
test('Blender : l etat des boutons est releve apres un export, a l ouverture d un projet et des reglages', () => {
  const n = (SRC.match(/window\._applyBlenderToolState\?\.\(\)/g) || []).length;
  assert.ok(n >= 3, 'attendu au moins 3 reevaluations (export, projet, reglages), trouve ' + n);
  assert.match(bloc(SRC, 'async function openSettings(', 'if (API.onMcpRefresh)'), /_applyBlenderToolState/);
  assert.match(bloc(SRC, 'async function openProject(p) {', 'For each step that already has content'), /_applyBlenderToolState/);
  assert.match(bloc(SRC, 'const r = await API.exportMesh({ sourcePath, targetFormat: format, outputPath, customName });', 'const outPath = r?.outputPath'), /_applyBlenderToolState/);
});

test('Blender : la fonction relit bien la configuration a chaque appel', async () => {
  const code = bloc(SRC, 'window._applyBlenderToolState = async function () {', 'window._applyBlenderToolState();');
  const boutons = {};
  const el = (id) => boutons[id] ||= { disabled: true, classList: { toggle() {} }, removeAttribute() {}, title: '' };
  let chemin = '';
  const w = {};
  new Function('window', 'document', 'API', '_BLENDER_TOOLS', '_i18nT', code)(w, { getElementById: el }, { getConfig: async () => ({ blenderPath: chemin }) }, ['b1', 'b2'], (s) => s);
  await w._applyBlenderToolState(); assert.equal(boutons.b1.disabled, true);
  chemin = 'C:/Blender/blender.exe';
  await w._applyBlenderToolState(); assert.equal(boutons.b1.disabled, false);
  assert.equal(w._blenderConfigure, true);
});

// ---------- DU-3 / DU-4 : paliers de qualite, libelles, imgRes ----------
test('Paliers de qualite : Fast = 24 pas, libelles identiques a ce que l interface calcule, plus de imgRes', () => {
  const m = /const TRELLIS2_PRESETS = (\{[\s\S]*?\n  \});/.exec(SRC);
  assert.ok(m, 'table des paliers introuvable');
  const P = new Function('return ' + m[1])();
  assert.equal(P.fast.steps, 24, 'Fast doit envoyer 24 pas dans trellis2Steps');
  assert.ok(!Object.values(P).some((p) => 'imgRes' in p), 'imgRes (sans lecteur) retire de la table');
  assert.ok(!/trellis2ImgRes/.test(SRC), 'trellis2ImgRes n est plus envoye');
  const sel = bloc(HTML, '<select id="ws-trellis2-preset">', '</select>');
  const lib = {}; for (const o of sel.matchAll(/<option value="(\w+)"[^>]*>([^<]*)<\/option>/g)) lib[o[1]] = o[2];
  assert.equal(lib.fast, `Fast (${P.fast.steps} steps · ${P.fast.texSize}px)`);
  assert.equal(lib.balanced, `Balanced (${P.balanced.steps} steps · ${P.balanced.texSize}px)`);
  assert.equal(lib.quality, `Quality (${P.quality.steps} steps · ${P.quality.texSize}px)`);
  assert.match(lib.ultra_8k, new RegExp(`^Ultra \\(${P.ultra_8k.steps} steps · ${P.ultra_8k.texSize}px sharpened to 8192px\\)$`));
  // Relecture independante (03/10/2026) : l'outil Re-texture applique 12 pas (scripts/mesh_tools.py _TRELLIS2_PRESETS) : son libelle le dit, et lui seul.
  assert.equal((SRC.match(/12 steps/g) || []).length, 1, 'un seul libelle « 12 steps » : celui du preset Re-texture');
  assert.match(SRC, /\['fast','Fast \(12 steps · 2048px\)'\]/);
});

test('Traductions : le libelle Fast (24 steps) existe dans les 5 langues', () => {
  const t = lire(new URL('../../src/renderer/lang/_additions.js', import.meta.url));
  assert.equal((t.match(/"Fast \(24 steps · 2048px\)":/g) || []).length, 5);
  assert.equal((t.match(/"Fast \(12 steps · 2048px\)":/g) || []).length, 5, 'libelle Re-texture (12 pas) traduit lui aussi');
});
