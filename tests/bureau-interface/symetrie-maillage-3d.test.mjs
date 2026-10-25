// OUTIL « Symmetrize mesh » (25/10) : fenetre au gabarit .fen-3d, calculs purs de l'apercu (lib/symetrie-maillage.js), parite avec
// le noyau Python (region_faces), branchement bureau + site + worker, et le script de bout en bout sur un vrai GLB.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lire = (c) => readFileSync(join(RACINE, c), 'utf8').replace(/\r\n/g, '\n');
const L = await import(pathToFileURL(join(RACINE, 'src/renderer/lib/symetrie-maillage.js')).href);

const IDS = ['sm3-close', 'sm3-viewport', 'sm3-canvas', 'sm3-hint', 'sm3-axis-x', 'sm3-axis-y', 'sm3-axis-z', 'sm3-offset', 'sm3-offset-num',
  'sm3-tilt-a', 'sm3-tilt-a-num', 'sm3-tilt-b', 'sm3-tilt-b-num', 'sm3-gz-move', 'sm3-gz-rot', 'sm3-dir-pos', 'sm3-dir-neg',
  'sm3-mode-full', 'sm3-mode-mask', 'sm3-brush-bloc', 'sm3-brush-size', 'sm3-brush-val', 'sm3-paint-mode', 'sm3-erase-mode',
  'sm3-recenter', 'sm3-undo', 'sm3-redo', 'sm3-reset', 'sm3-cancel', 'sm3-apply'];

// ---------- calculs purs ----------
test('normaleDepuis : axes de base et inclinaisons, toujours unitaire', () => {
  assert.deepEqual(L.normaleDepuis('x', 0, 0).map((v) => Math.round(v) + 0), [1, 0, 0]);
  assert.deepEqual(L.normaleDepuis('y', 0, 0).map((v) => Math.round(v) + 0), [0, 1, 0]);
  assert.deepEqual(L.normaleDepuis('z', 0, 0).map((v) => Math.round(v) + 0), [0, 0, 1]);
  for (const axe of ['x', 'y', 'z']) {
    for (const a of [-170, -90, -30, 0, 45, 120, 180]) {
      for (const b of [-80, -20, 0, 35, 80]) {
        const n = L.normaleDepuis(axe, a, b);
        assert.ok(Math.abs(Math.hypot(...n) - 1) < 1e-12, `${axe} ${a} ${b}`);
      }
    }
  }
});

test('anglesDepuis est l inverse de normaleDepuis', () => {
  for (const axe of ['x', 'y', 'z']) {
    for (const a of [-150, -60, 0, 25, 100, 170]) {
      for (const b of [-75, -10, 0, 40, 85]) {
        const n = L.normaleDepuis(axe, a, b);
        const r = L.anglesDepuis(axe, n);
        const n2 = L.normaleDepuis(axe, r.a, r.b);
        for (let i = 0; i < 3; i++) assert.ok(Math.abs(n[i] - n2[i]) < 1e-9, `${axe} ${a} ${b}`);
        assert.ok(r.b >= -90 && r.b <= 90);
      }
    }
  }
});

test('matriceMiroir : un point se reflechit par le plan, deux fois = lui-meme', () => {
  const P = [0.3, -0.2, 0.5], n = L.normaleDepuis('x', 25, 10);
  const m = L.matriceMiroir(P, n);
  const app = (p) => [0, 1, 2].map((r) => m[r * 4] * p[0] + m[r * 4 + 1] * p[1] + m[r * 4 + 2] * p[2] + m[r * 4 + 3]);
  const p = [1.1, 0.7, -0.4];
  const q = app(p);
  assert.ok(Math.abs(L.distanceAuPlan(q, P, n) + L.distanceAuPlan(p, P, n)) < 1e-9, 'distance signee opposee');
  const r = app(q);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(r[i] - p[i]) < 1e-9);
  app(P).forEach((v, i) => assert.ok(Math.abs(v - P[i]) < 1e-9, 'un point du plan reste en place'));
});

test('centresDesFaces, coteDesFaces, ecrireFaces', () => {
  // deux triangles non indexes : un a x ~ 1, un a x ~ -1
  const pos = new Float32Array([1, 0, 0, 1, 1, 0, 1, 0, 1, -1, 0, 0, -1, 1, 0, -1, 0, 1]);
  const c = L.centresDesFaces(pos, null, null);
  assert.equal(c.length, 6);
  assert.ok(Math.abs(c[0] - 1) < 1e-6 && Math.abs(c[3] + 1) < 1e-6);
  const cote = L.coteDesFaces(c, [0, 0, 0], [1, 0, 0], 1e-6);
  assert.deepEqual(Array.from(cote), [1, -1]);
  const out = new Uint32Array(6);
  assert.equal(L.ecrireFaces(out, null, [0, 1]), 1);
  assert.deepEqual(Array.from(out.slice(0, 3)), [3, 4, 5]);
  // maillage indexe + matrice de decalage
  const idx = new Uint32Array([0, 1, 2]);
  const m = [1, 0, 0, 5, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const c2 = L.centresDesFaces(pos.slice(0, 9), idx, m);
  assert.ok(Math.abs(c2[0] - 6) < 1e-6);
});

test('regionFaces : peindre allume, gommer eteint, dans l ordre ; la zone miroir reflechit les tampons', () => {
  const c = new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0]);
  assert.deepEqual(Array.from(L.regionFaces(c, [[1, 0, 0, 5, 1], [1, 0, 0, 0.2, 0]])), [1, 0, 1]);
  assert.deepEqual(Array.from(L.regionFaces(c, [[1, 0, 0, 0.2, 1]], { P: [0.5, 0, 0], n: [1, 0, 0] })), [1, 0, 0]);   // 1 reflechi par x=0.5 -> 0
  assert.deepEqual(Array.from(L.regionFaces(c, [])), [0, 0, 0]);
});

test('regionFaces (JS) = region_faces (Python) sur des centres et des tampons tires au hasard', () => {
  let graine = 12345;
  const alea = () => { graine = (graine * 1664525 + 1013904223) % 4294967296; return graine / 4294967296; };
  const n = 4000;
  const centres = new Float32Array(n * 3);
  for (let i = 0; i < centres.length; i++) centres[i] = Math.fround(alea() * 4 - 2);
  const tampons = [];
  for (let i = 0; i < 60; i++) tampons.push([Number((alea() * 4 - 2).toFixed(4)), Number((alea() * 4 - 2).toFixed(4)), Number((alea() * 4 - 2).toFixed(4)),
    Number((0.1 + alea() * 0.6).toFixed(4)), alea() < 0.75 ? 1 : 0]);
  const plan = { P: [0.2, -0.1, 0.0], n: (() => { const v = [1, 0.5, -0.3]; const l = Math.hypot(...v); return v.map((x) => x / l); })() };
  const dir = mkdtempSync(join(tmpdir(), 'sm3-'));
  writeFileSync(join(dir, 'entree.json'), JSON.stringify({ centres: Array.from(centres), tampons, plan }));
  const py = `
import json, sys
import numpy as np
sys.path.insert(0, ${JSON.stringify(join(RACINE, 'scripts'))})
import symmetrize_mesh as S
d = json.load(open(sys.argv[1]))
c = np.array(d['centres'], dtype=np.float32).reshape(-1, 3).astype(np.float64)
a = S.region_faces(c, d['tampons'])
b = S.region_faces(c, d['tampons'], (np.array(d['plan']['P']), np.array(d['plan']['n'])))
json.dump({'a': a.astype(int).tolist(), 'b': b.astype(int).tolist()}, open(sys.argv[2], 'w'))
`;
  writeFileSync(join(dir, 'p.py'), py);
  const r = spawnSync('python', ['-I', join(dir, 'p.py'), join(dir, 'entree.json'), join(dir, 'sortie.json')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const sortie = JSON.parse(readFileSync(join(dir, 'sortie.json'), 'utf8'));
  const a = Array.from(L.regionFaces(centres, tampons, null));
  const b = Array.from(L.regionFaces(centres, tampons, plan));
  const ecart = (x, y) => x.reduce((s, v, i) => s + (v !== y[i] ? 1 : 0), 0);
  // float32 contre float64 : seules les faces a moins de 1e-6 du bord d'une sphere peuvent differer
  assert.ok(ecart(a, sortie.a) <= 2, 'zone peinte : ' + ecart(a, sortie.a) + ' faces differentes');
  assert.ok(ecart(b, sortie.b) <= 2, 'zone miroir : ' + ecart(b, sortie.b) + ' faces differentes');
  assert.ok(a.some((v) => v) && a.some((v) => !v));
});

// ---------- fenetre, boutons, branchement ----------
for (const [nom, page, js] of [['bureau', 'src/renderer/index2.html', 'src/renderer/index2.js'], ['site', 'cloud/public/app/index.html', 'cloud/public/app/index2.js']]) {
  test(`Symmetrize mesh (${nom}) : gabarit fen-3d, ids, pied Annuler puis Appliquer`, () => {
    const h = lire(page);
    const i = h.indexOf('id="modal-symmetrize-mesh"');
    assert.ok(i > 0);
    const bloc = h.slice(i, h.indexOf('id="modal-buildstages-options"', i) > 0 ? h.indexOf('id="modal-buildstages-options"', i) : i + 12000);
    assert.match(bloc, /<div class="modal-card fen-3d fen-sym3d">/);
    assert.match(bloc, /<div class="fen-corps">/);
    assert.match(bloc, /<div id="sm3-viewport" class="fen-apercu">/);
    assert.match(bloc, /<div class="fen-form">/);
    assert.match(bloc, /id="sm3-hint" class="fen-apercu-etat"/);
    assert.doesNotMatch(bloc, /max-width:\s*1100px/);
    for (const id of IDS) assert.ok(bloc.includes('id="' + id + '"'), 'id perdu : ' + id);
    assert.ok(bloc.indexOf('id="sm3-cancel"') < bloc.indexOf('id="sm3-apply"'));
    assert.ok(/<div class="modal-actions">\s*<button class="ghost-btn" id="sm3-cancel">Cancel<\/button>\s*<button class="primary-btn" id="sm3-apply">/.test(bloc));
    // le bouton de la liste des outils manuels, juste apres Resize
    assert.ok(h.indexOf('id="ws-mesh-symmetrize-btn"') > h.indexOf('id="ws-mesh-resize-btn"'));
    assert.ok(h.indexOf('id="ws-mesh-symmetrize-btn"') < h.indexOf('id="ws-mesh-aligntex-btn"'));
    // tous les ids du HTML lus par le JS existent
    const src = lire(js);
    for (const m of src.matchAll(/_sm3El\('([a-z0-9-]+)'\)/g)) {
      if (m[1].startsWith('sm3-') || m[1].startsWith('ws-mesh-symmetrize')) assert.ok(h.includes('id="' + m[1] + '"'), nom + ' : id lu par le JS mais absent du HTML : ' + m[1]);
    }
  });

  test(`Symmetrize mesh (${nom}) : le JS appelle l API, nomme le travail pour l etape 3D et annonce son prix`, () => {
    const src = lire(js);
    assert.match(src, /from '\.\/lib\/symetrie-maillage\.js'/);
    assert.match(src, /function openSymmetrizeMeshTool\(\)/);
    assert.match(src, /API\.symmetrizeMesh\(\{ \.\.\.args, projectName: p\?\.name \}\)/);
    assert.match(src, /pushJob\(`Symmetrize mesh: \$\{p\?\.name \|\| ''\}`/);
    assert.match(src, /renderer\.localClippingEnabled = true/);
    // jamais d'ecrasement : le resultat est une nouvelle version rattachee au projet du lancement
    assert.match(src, /showStep2Preview\(\{ path: r\.newPath, filename: r\.filename \}\)/);
    // la symetrie d'IMAGE ne doit pas avaler le travail de maillage (etape 1)
    assert.match(src, /symmetri\[sz\]e\(\?! mesh\)/);
    assert.match(src, /if \(\/symmetri\[sz\]e mesh\/i\.test\(n\)\) return 2;/);
  });
}

test('prix : la pastille du bouton et du pied de la fenetre suit la grille mesh_op_simple', () => {
  const d = lire('src/renderer/index2.js');
  assert.match(d, /'ws-mesh-symmetrize-btn': 'mesh_op_simple'/);
  assert.match(d, /'sm3-apply': \(\) => window\._prixBouton\('ws-mesh-symmetrize-btn'\)/);
  const w = lire('cloud/public/app/cloud-overrides.js');
  assert.match(w, /'ws-mesh-symmetrize-btn':\s+'mesh_op_simple'/);
  assert.match(w, /'sm3-apply':\s+'mesh_op_simple'/);
});

test('lib/symetrie-maillage.js : meme fichier sur le bureau et le site', () => {
  assert.equal(lire('src/renderer/lib/symetrie-maillage.js'), lire('cloud/public/app/lib/symetrie-maillage.js'));
});

test('bureau : IPC mesh-symmetrize, preload, marquage IA, poignee moteur local', () => {
  const m = lire('src/main/main.js');
  assert.match(m, /ipcMain\.handle\('mesh-symmetrize'/);
  assert.match(m, /_POIGNEES_MOTEUR_LOCAL = new Set\([\s\S]*'mesh-symmetrize'/);
  assert.match(m, /symmetrize_mesh\.py/);
  assert.match(m, /opType: 'symmetrize'/);
  assert.match(m, /nouvelle version|NOUVELLE version/i);   // l'original n'est jamais ecrase : chemin de sortie horodate
  assert.match(m, /`\$\{stem\}_symmetrize_\$\{Date\.now\(\)\}\.glb`/);
  assert.match(lire('src/main/preload.js'), /symmetrizeMesh: \(opts\) => ipcRenderer\.invoke\('mesh-symmetrize', opts\)/);
  assert.match(lire('src/main/marquage_ia.js'), /'mesh-symmetrize': \{\}/);
  assert.match(lire('src/renderer/index2.js'), /'resizeMesh', 'symmetrizeMesh'/);   // connexion cloud demandee si la session manque
});

test('site : shim symmetrizeMesh -> /api/mesh-op, worker : liste blanche + validation des reglages', () => {
  const s = lire('cloud/public/app/meshyAPI-cloud.js');
  assert.match(s, /symmetrizeMesh: async/);
  assert.match(s, /opType: 'symmetrize'/);
  const w = lire('cloud/src/worker.ts');
  assert.match(w, /'symmetrize',  \/\/ symetrie par un plan/);
  assert.match(w, /symmetrize needs params\.point and params\.normal/);
  assert.match(w, /symmetrize stamps: at most 1200/);
  assert.match(w, /'resize', 'explode', 'symmetrize'/);
  const py = lire('modal_app/_mesh_op.py');
  assert.match(py, /'symmetrize':\s+None,/);
  assert.match(py, /if op_type == 'symmetrize':/);
});

// ---------- le script, de bout en bout, sur un vrai GLB ----------
test('symmetrize_mesh.py : GLB texture -> GLB symetrique, ferme, marque IA ; refus d un maillage pese', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sm3-glb-'));
  const prep = `
import sys, json
import numpy as np, trimesh
from PIL import Image
m = trimesh.creation.icosphere(subdivisions=3)
v = m.vertices.copy(); v[:, 0] *= 1.4; v += np.array([0.3, 0.1, -0.2])
v[:, 1] += np.exp(-((v - np.array([1.2, 0.3, 0.2])) ** 2).sum(axis=1) / 0.1) * 0.4
uv = np.stack([(v[:, 0] + 2) / 4, (v[:, 1] + 2) / 4], axis=1)
img = Image.fromarray((np.random.RandomState(1).rand(32, 32, 3) * 255).astype(np.uint8))
t = trimesh.Trimesh(vertices=v, faces=m.faces, process=False)
t.visual = trimesh.visual.TextureVisuals(uv=uv, material=trimesh.visual.material.PBRMaterial(baseColorTexture=img))
t.export(sys.argv[1] + '/src.glb')
json.dump({'point': [0.3, 0, 0], 'normal': [1, 0, 0], 'keep': 'pos', 'mode': 'full'}, open(sys.argv[1] + '/p.json', 'w'))
json.dump({'point': [0.3, 0, 0], 'normal': [1, 0, 0], 'keep': 'pos', 'mode': 'mask', 'stamps': [[1.2, 0.3, 0.2, 0.5, 1]]}, open(sys.argv[1] + '/pz.json', 'w'))
`;
  writeFileSync(join(dir, 'prep.py'), prep);
  let r = spawnSync('python', [join(dir, 'prep.py'), dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const script = join(RACINE, 'scripts', 'symmetrize_mesh.py');
  r = spawnSync('python', [script, join(dir, 'src.glb'), join(dir, 'out.glb'), join(dir, 'p.json')], { encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1' } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /DONE symmetrize mode=full kept=\d+ mirrored=\d+/);
  assert.ok(existsSync(join(dir, 'out.glb')));
  const verif = `
import sys, io, json
import numpy as np, trimesh
sc = trimesh.load(sys.argv[1] + '/out.glb', force='scene')
g = list(sc.geometry.values())[0]
w = trimesh.Trimesh(vertices=g.vertices, faces=g.faces, process=False); w.merge_vertices(digits_vertex=6)
e = np.sort(w.edges, axis=1); _, c = np.unique(e, axis=0, return_counts=True)
V = np.asarray(g.vertices); R = V.copy(); R[:, 0] = 0.6 - R[:, 0]
cle = lambda P: set(map(tuple, np.round(P / 1e-4).astype(np.int64)))
a = cle(V)
dec = [(i, j, k) for i in (-1, 0, 1) for j in (-1, 0, 1) for k in (-1, 0, 1)]
manque = sum(1 for p in R if tuple(np.round(p / 1e-4).astype(np.int64)) not in a and not any(tuple(np.round(p / 1e-4).astype(np.int64) + np.array(d)) in a for d in dec))
raw = open(sys.argv[1] + '/out.glb', 'rb').read()
import struct
n = struct.unpack('<I', raw[12:16])[0]; doc = json.loads(raw[20:20 + n])
print(json.dumps({'bord': int((c == 1).sum()), 'multi': int((c > 2).sum()), 'manque': int(manque), 'watertight': bool(w.is_watertight),
  'coherent': bool(w.is_winding_consistent), 'uv': g.visual.kind, 'tex': g.visual.material.baseColorTexture is not None,
  'generator': doc.get('asset', {}).get('generator', ''), 'ia': (doc.get('asset', {}).get('extras') or {}).get('aiGenerated')}))
`;
  writeFileSync(join(dir, 'verif.py'), verif);
  r = spawnSync('python', [join(dir, 'verif.py'), dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const v = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.equal(v.bord, 0, 'aretes de bord');
  assert.equal(v.multi, 0);
  assert.equal(v.manque, 0, 'sommets sans image miroir');
  assert.ok(v.watertight && v.coherent);
  assert.equal(v.uv, 'texture');
  assert.ok(v.tex, 'la texture est reprise');
  assert.match(v.generator, /AI-generated/i);
  assert.equal(v.ia, true);
  // mode zone
  r = spawnSync('python', [script, join(dir, 'src.glb'), join(dir, 'outz.glb'), join(dir, 'pz.json')], { encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1' } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /mode=mask kept=\d+ mirrored=[1-9]\d* removed=\d+/);
  // zone vide : refus clair, code 3, aucun fichier
  writeFileSync(join(dir, 'vide.json'), JSON.stringify({ point: [0.3, 0, 0], normal: [1, 0, 0], mode: 'mask', stamps: [] }));
  r = spawnSync('python', [script, join(dir, 'src.glb'), join(dir, 'vide.glb'), join(dir, 'vide.json')], { encoding: 'utf8' });
  assert.equal(r.status, 3);
  assert.match(r.stdout, /^ERROR Paint the area to mirror first\./m);
  assert.ok(!existsSync(join(dir, 'vide.glb')));
});

test('symmetrize_mesh.py : un GLB avec peau est refuse avec un message clair', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sm3-peau-'));
  const doc = { asset: { version: '2.0' }, skins: [{ joints: [0] }], nodes: [{}] };
  let j = Buffer.from(JSON.stringify(doc));
  j = Buffer.concat([j, Buffer.alloc((4 - (j.length % 4)) % 4, 0x20)]);
  const h = Buffer.alloc(20);
  h.write('glTF', 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(20 + j.length, 8); h.writeUInt32LE(j.length, 12); h.write('JSON', 16);
  writeFileSync(join(dir, 'peau.glb'), Buffer.concat([h, j]));
  writeFileSync(join(dir, 'p.json'), JSON.stringify({ point: [0, 0, 0], normal: [1, 0, 0] }));
  const r = spawnSync('python', [join(RACINE, 'scripts', 'symmetrize_mesh.py'), join(dir, 'peau.glb'), join(dir, 'o.glb'), join(dir, 'p.json')], { encoding: 'utf8' });
  assert.equal(r.status, 3);
  assert.match(r.stdout, /^ERROR This mesh is rigged or animated: symmetrize the mesh before rigging it\./m);
});
