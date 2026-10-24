// « Reshape a region » avec une VUE CHOISIE dans le visualiseur 3D (2026-10-19) : cote processus principal (bureau).
// Demande du proprietaire : « Reshape a region doit avoir un viewer 3D pour permettre d'afficher la zone que l'on
// souhaite, pas un 2D de face ». Verifie, sans Electron, sans Python, sans GPU :
//   - src/main/reshape_vue.js : les cas partages (build/bancs/noyaux/reshape_vue_cas.json) et la PARITE avec le module des
//     pages (src/renderer/lib/reshape-vue.js) sur une grille d'entrees ;
//   - les VRAIS gestionnaires IPC `mesh:render-front` et `mesh:reshape-region`, extraits de main.js (analyseur acorn) et
//     executes avec des doublures : angle invalide -> refus AVANT tout calcul ; vue valide -> les MEMES angles au rendu
//     (`rendre ... yaw pitch`) et a l'isolement de la piece (`preparer ... <vue>.vue.json`) ; yaw 0 / pitch 0 ou absents ->
//     exactement les arguments d'avant ; zone peinte en 3D + vue tournee -> refus.
// Lancer :  node --test tests/main/reshape_vue.test.mjs
// Contre l'ancien code : MAIN_JS=<copie de git show <rev>:src/main/main.js> (les gestionnaires ignorent alors la vue : les tests echouent).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as acorn from 'acorn';
const require = createRequire(import.meta.url);
const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, '..', '..');
const CHEMIN_MAIN = process.env.MAIN_JS || path.join(RACINE, 'src', 'main', 'main.js');
const RV = require(path.join(RACINE, 'src', 'main', 'reshape_vue.js'));
const CAS = JSON.parse(fs.readFileSync(path.join(RACINE, 'build', 'bancs', 'noyaux', 'reshape_vue_cas.json'), 'utf8'));
const jeton = (v) => (v === '__NaN__' ? NaN : v === '__Infinity__' ? Infinity : v === '__-Infinity__' ? -Infinity : v);

// le module des pages est un module ES dans un .js : copie .mjs temporaire
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reshape_vue_test_'));
process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {} });
fs.writeFileSync(path.join(tmp, 'reshape-vue.mjs'), fs.readFileSync(path.join(RACINE, 'src', 'renderer', 'lib', 'reshape-vue.js'), 'utf8'));
const LIB = await import(pathToFileURL(path.join(tmp, 'reshape-vue.mjs')).href);

test('reshape_vue.js (bureau) : les cas partages avec Python, les pages et le worker', () => {
  for (const c of CAS.cas) {
    const r = RV.validerVue(jeton(c.yaw), jeton(c.pitch));
    assert.equal(r.ok, c.ok, JSON.stringify(c));
    if (c.ok) assert.deepEqual([r.yaw, r.pitch], c.sortie, JSON.stringify(c));
  }
  for (const c of CAS.xmag_valide) {
    const r = RV.validerXmag(jeton(c.x));
    assert.equal(r.ok, c.ok, JSON.stringify(c));
    if (c.ok) assert.equal(r.xmag, c.sortie);
  }
  assert.equal(Object.is(RV.validerVue(-0, -0).yaw, 0), true, 'zero negatif normalise');
});

test('reshape_vue.js (bureau) = reshape-vue.js (pages) sur une grille d entrees', () => {
  const valeurs = [0, -0, 1, -1, 45, 89.99, 90, 90.0001, 179.9, 180, 180.1, -180, -180.5, 720, NaN, Infinity, -Infinity, null, undefined, '1', 'x', true, [], {}];
  for (const y of valeurs) for (const p of valeurs) {
    const a = RV.validerVue(y, p), b = LIB.validerVue(y, p);
    assert.equal(a.ok, b.ok, `${String(y)} / ${String(p)}`);
    if (a.ok) assert.deepEqual([a.yaw, a.pitch], [b.yaw, b.pitch]);
  }
  for (const x of [null, undefined, 0.5, 0.6, 0.75, 3, 3.01, NaN, '0.7', true]) {
    assert.equal(RV.validerXmag(x).ok, LIB.validerXmag(x).ok, String(x));
  }
  const vues = [undefined, null, {}, { yaw: 0, pitch: 0 }, { yaw: 10, pitch: 5, xmag: 0.8 }, { yaw: 10, pitch: 5 }, { yaw: 400, pitch: 0 }, 'x', [], { yaw: 1, pitch: 1, xmag: 9 }];
  for (const v of vues) assert.deepEqual(RV.normaliserVue(v), LIB.normaliserVue(v), JSON.stringify(v));
});

// ---- les vrais gestionnaires de main.js ----
const SRC = fs.readFileSync(CHEMIN_MAIN, 'utf8');
const AST = acorn.parse(SRC, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true });
function gestionnaire(canal) {
  let trouve = null;
  (function visiter(n) {
    if (!n || typeof n.type !== 'string' || trouve) return;
    if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && n.callee.object.name === 'ipcMain' && n.callee.property.name === 'handle'
      && n.arguments[0] && n.arguments[0].value === canal) { trouve = n.arguments[1]; return; }
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v)) v.forEach(visiter); else if (v && typeof v.type === 'string') visiter(v);
    }
  })(AST);
  assert.ok(trouve, 'gestionnaire introuvable : ' + canal);
  return SRC.slice(trouve.start, trouve.end);
}
const ENTREES = ['isCloudMode', 'isPathAllowed', 'fs', 'path', 'os', 'nativeImage', 'safeSend', '_lancerPy', '_aiPython', 'SCRIPTS_DIR', 'ensureSdxlServer',
  'sdxlServerCall', 'stopSdxlServer', 'app', 'writeMeta', 'execFile', '_reshapeVue', 'getSdxlReady', '__dirname'];

function monterReshape() {
  const journal = { appels: [], ecrits: [], sdxl: [], meta: [] };
  const maillage = path.join(tmp, 'm' + Math.random().toString(16).slice(2) + '.glb');
  fs.writeFileSync(maillage, 'glb');
  const front = path.join(tmp, 'front' + Math.random().toString(16).slice(2) + '.png');
  fs.writeFileSync(front, 'png');
  const doublures = {
    isCloudMode: () => false, isPathAllowed: () => true, fs, path, os,
    nativeImage: { createFromPath: () => ({ getSize: () => ({ width: 1024, height: 1024 }) }),
                   createFromBuffer: () => ({ resize: () => ({ toPNG: () => Buffer.from('png') }) }) },
    safeSend: () => {}, _aiPython: () => 'python', SCRIPTS_DIR: '/scripts',
    ensureSdxlServer: async () => {}, sdxlServerCall: async (_r, corps) => { journal.sdxl.push(corps); fs.writeFileSync(corps.output, 'x'); return { ok: true }; },
    stopSdxlServer: () => {}, app: { isPackaged: false }, __dirname: path.join(RACINE, 'src', 'main'), writeMeta: (...a) => journal.meta.push(a), execFile: () => {},
    getSdxlReady: () => true,
    _reshapeVue: RV,
    _lancerPy: async (_exe, args) => {
      journal.appels.push(args);
      const sous = args[1];
      if (sous === 'rendre') { fs.writeFileSync(args[3], 'v'); }
      else if (sous === 'preparer') { fs.writeFileSync(args[4], 'p'); fs.writeFileSync(args[5], '{}'); }
      else if (sous === 'assembler') { fs.writeFileSync(args[6], 'g'); }
      else if (args[0] && String(args[0]).endsWith('trellis2_native_full_pipeline.py')) { fs.writeFileSync(args[2], 'g'); }
      return { ok: true };
    },
  };
  // `sdxlReady` est une variable du module : on la remplace par un appel a la doublure
  const src = gestionnaire('mesh:reshape-region').replace(/\bsdxlReady\b/g, 'getSdxlReady()');
  const f = new Function(...ENTREES, 'return (' + src + ');')(...ENTREES.map((n) => doublures[n]));
  return { f, journal, maillage, front };
}

const MASQUE = 'data:image/png;base64,iVBORw0KGgo=';

test('mesh:reshape-region : une vue choisie arrive au rendu ET a l isolement de la piece (memes angles)', async () => {
  const { f, journal, maillage, front } = monterReshape();
  const r = await f({}, { meshPath: maillage, frontPath: front, maskDataUrl: MASQUE, prompt: 'a crystal skull', vue: { yaw: 135.5, pitch: -20, xmag: 0.85 } });
  assert.equal(r.ok, true, JSON.stringify(r));
  const rendre = journal.appels.find((a) => a[1] === 'rendre');
  assert.deepEqual(rendre.slice(5), ['135.5', '-20'], 'les angles sont passes au rendu : ' + rendre.join(' '));
  const preparer = journal.appels.find((a) => a[1] === 'preparer');
  assert.equal(preparer[7], preparer[6] + '.vue.json', 'preparer lit le fichier de vue ecrit par le rendu');
  assert.equal(journal.meta[0][1].params.view.yaw, 135.5);
});

test('mesh:reshape-region : vue absente ou de face = les arguments d avant, sans angle ni fichier de vue', async () => {
  for (const vue of [undefined, null, { yaw: 0, pitch: 0 }, { yaw: 0, pitch: 0, xmag: 0.6 }]) {
    const { f, journal, maillage, front } = monterReshape();
    const r = await f({}, { meshPath: maillage, frontPath: front, maskDataUrl: MASQUE, prompt: 'a crystal skull', ...(vue !== undefined ? { vue } : {}) });
    assert.equal(r.ok, true, JSON.stringify(vue));
    assert.equal(journal.appels.find((a) => a[1] === 'rendre').length, 5, 'script rendre <maillage> <vue> <taille> seulement');
    assert.equal(journal.appels.find((a) => a[1] === 'preparer').length, 7, 'preparer sans fichier de vue');
    assert.equal('view' in journal.meta[0][1].params, false);
  }
});

test('mesh:reshape-region : un angle invalide est refuse AVANT tout calcul (aucun script, aucun SDXL)', async () => {
  for (const vue of [{ yaw: 400, pitch: 0 }, { yaw: 0, pitch: -95 }, { yaw: '90', pitch: 0 }, { yaw: NaN, pitch: 5 }, { yaw: 10, pitch: 5, xmag: 0.1 }, 'x', 7]) {
    const { f, journal, maillage, front } = monterReshape();
    const r = await f({}, { meshPath: maillage, frontPath: front, maskDataUrl: MASQUE, prompt: 'a crystal skull', vue });
    assert.equal(r.ok, false, JSON.stringify(vue));
    assert.match(r.error, /Invalid view/);
    assert.equal(journal.appels.length, 0);
    assert.equal(journal.sdxl.length, 0);
  }
});

test('mesh:reshape-region : zone peinte en 3D + vue tournee refusee ; avec une vue de face permise', async () => {
  const a = monterReshape();
  const r = await a.f({}, { meshPath: a.maillage, uvMaskDataUrl: MASQUE, prompt: 'x', vue: { yaw: 90, pitch: 0, xmag: 0.7 } });
  assert.equal(r.ok, false);
  assert.match(r.error, /cannot be combined/);
  assert.equal(a.journal.appels.length, 0);
});

function monterRendu() {
  const appels = [];
  const doublures = {
    path, os, fs, _aiPython: () => 'python', SCRIPTS_DIR: '/scripts', _reshapeVue: RV,
    execFile: (exe, args, _opts, cb) => {
      appels.push(args);
      const sortie = args[3];
      fs.writeFileSync(sortie, 'png');
      if (args.length > 5) fs.writeFileSync(sortie + '.vue.json', JSON.stringify({ yaw: Number(args[5]), pitch: Number(args[6]), xmag: 0.75, taille: 1024 }));
      cb(null);
    },
  };
  const nom = ['path', 'os', 'fs', '_aiPython', 'SCRIPTS_DIR', '_reshapeVue', 'execFile'];
  const f = new Function(...nom, 'return (' + gestionnaire('mesh:render-front') + ');')(...nom.map((n) => doublures[n]));
  return { f, appels };
}

test('mesh:render-front : yaw / pitch vont au script, la vue (avec la demi-largeur) revient', async () => {
  const { f, appels } = monterRendu();
  const r = await f({}, { meshPath: '/m.glb', yaw: 180, pitch: 15.5 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(appels[0].slice(1, 3), ['rendre', '/m.glb']);
  assert.deepEqual(appels[0].slice(4), ['1024', '180', '15.5']);
  assert.deepEqual(r.vue, { yaw: 180, pitch: 15.5, xmag: 0.75 });
  assert.match(r.dataUrl, /^data:image\/png;base64,/);
});

test('mesh:render-front : sans angle (ou 0 / 0) = rendu de face d avant, vue null ; angle invalide refuse sans calcul', async () => {
  for (const args of [{}, { yaw: 0, pitch: 0 }, { yaw: null, pitch: null }]) {
    const { f, appels } = monterRendu();
    const r = await f({}, { meshPath: '/m.glb', ...args });
    assert.equal(r.ok, true);
    assert.equal(appels[0].length, 5, 'rendre <maillage> <vue> 1024 : aucun angle');
    assert.equal(r.vue, null);
  }
  for (const args of [{ yaw: 181 }, { pitch: 91 }, { yaw: 'a' }, { yaw: NaN }, { pitch: Infinity }]) {
    const { f, appels } = monterRendu();
    const r = await f({}, { meshPath: '/m.glb', ...args });
    assert.equal(r.ok, false, JSON.stringify(args));
    assert.match(r.error, /Invalid view/);
    assert.equal(appels.length, 0);
  }
});
