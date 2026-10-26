# -*- coding: utf-8 -*-
"""Viewer HTML LOCAL de comparaison de Fill holes (2026-10-26) : trois vues synchronisees (surface d'origine / ancien outil / nouvel outil) sur la
moissonneuse percee de trous controles ; les aretes OUVERTES (apres soudure par position) sont tracees en rouge. Couleurs = texture echantillonnee
a l'UV de chaque sommet (ce que montre le modele texture), ombrage plat pour voir la courbure.

Lancer :  python build/bancs/noyaux/viewer_remplissage.py C:/tmp/fill_demo/viewer [--ref integration-2510]
          puis  python -m http.server 8890 --directory C:/tmp/fill_demo/viewer   et ouvrir http://127.0.0.1:8890/
(le dossier doit contenir three/ : build/ et examples/jsm/{controls,loaders,utils} de three.js)
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile

import numpy as np

ICI = os.path.dirname(os.path.abspath(__file__))
RACINE = os.path.abspath(os.path.join(ICI, '..', '..', '..'))
for chemin in (os.path.join(RACINE, 'scripts'), ICI, RACINE):
    if chemin not in sys.path:
        sys.path.insert(0, chemin)

import trimesh  # noqa: E402

import _percage_trous as P  # noqa: E402
import bouchage_lisse as BL  # noqa: E402
import bouchage_trous as B  # noqa: E402
from avant_apres_remplissage import extraire  # noqa: E402


def couleurs_sommets(m, tex):
    uv = np.asarray(m.visual.uv)
    c = P.echantillonner(tex, uv)
    return np.clip(c, 0, 255).astype(np.uint8)


def aretes_ouvertes(V, F):
    """Segments (x1 y1 z1 x2 y2 z2 ...) des aretes de bord de la copie soudee par position."""
    prep = B.preparer(V, F)
    ea, eb, inv, cnt = prep['ea'], prep['eb'], prep['inv'], prep['cnt']
    idxF = prep['idxF']
    bord = np.nonzero(cnt[inv] == 1)[0]
    seg = []
    for k in bord:
        f = idxF[k // 3]
        c = k % 3
        a, b = F[f, c], F[f, (c + 1) % 3]
        seg += [float(x) for x in V[a]] + [float(x) for x in V[b]]
    return seg, int(len(bord))


def decouper(m, tex, centre, rayon):
    """Sous-maillage (faces dont le centre est a moins de `rayon` du centre), couleurs de sommets sans UV ni texture. Rend aussi les aretes ouvertes
    de CE sous-maillage ne comptant que celles proches du centre (le decoupage cree un bord artificiel, ecarte)."""
    V = np.asarray(m.vertices, dtype=np.float64)
    F = np.asarray(m.faces, dtype=np.int64)
    garde = np.linalg.norm(V[F].mean(axis=1) - centre, axis=1) < rayon
    Fs = F[garde]
    utilises, inv = np.unique(Fs.ravel(), return_inverse=True)
    sous = trimesh.Trimesh(vertices=V[utilises], faces=inv.reshape(-1, 3), process=False)
    col = couleurs_sommets(m, tex)[utilises]
    sous.visual = trimesh.visual.ColorVisuals(sous, vertex_colors=np.hstack([col, np.full((len(col), 1), 255, dtype=np.uint8)]))
    seg_all, _ = aretes_ouvertes(np.asarray(sous.vertices), np.asarray(sous.faces))
    seg = []
    for i in range(0, len(seg_all), 6):
        s = np.array(seg_all[i:i + 6])
        if np.linalg.norm((s[:3] + s[3:]) / 2 - centre) < 0.8 * rayon:
            seg += seg_all[i:i + 6]
    return sous, seg


HTML = r'''<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Fill holes - avant / apres</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--bg:#0f1017;--card:#181a26;--txt:#e8e8f0;--mut:#8d90a8;--ok:#4ade80;--ko:#f87171;--ac:#a78bfa}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font:14px system-ui,sans-serif}
header{padding:12px 16px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;border-bottom:1px solid #2a2d40}
h1{font-size:17px;margin:0 12px 0 0}
button{background:var(--card);color:var(--txt);border:1px solid #2f3350;border-radius:8px;padding:6px 12px;cursor:pointer}
button.on{border-color:var(--ac);background:#2a2447}
.grille{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:10px;height:calc(100vh - 150px)}
.pane{background:var(--card);border-radius:10px;position:relative;overflow:hidden;min-height:260px}
.pane canvas{width:100%;height:100%;display:block}
.pane .t{position:absolute;left:10px;top:8px;font-weight:600}
.pane .n{position:absolute;left:10px;bottom:8px;font-size:13px}
.ok{color:var(--ok)}.ko{color:var(--ko)}
.note{padding:6px 16px;color:var(--mut);font-size:13px}
@media(max-width:900px){.grille{grid-template-columns:1fr;height:auto}.pane{height:340px}}
</style></head><body>
<header><h1>Fill holes : avant / apres sur la moissonneuse percee</h1><span id="cas"></span><button id="fil">Fil de fer : non</button></header>
<div class="note" id="info"></div>
<div class="note">Lignes <b style="color:#ff3b3b">rouges</b> = aretes ouvertes (un trou) apres soudure par position. Couleurs = texture a l'UV de chaque sommet. Les trois vues partagent la camera.</div>
<div class="grille" id="g"></div>
<script type="importmap">{"imports":{"three":"./three/build/three.module.js"}}</script>
<script type="module">
import * as THREE from 'three';
import { OrbitControls } from './three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from './three/examples/jsm/loaders/GLTFLoader.js';
const META = await (await fetch('meta.json')).json();
const PANES = [['orig', 'Surface d\'origine (verite)'], ['avant', 'Avant : outil livre (1.0.67)'], ['apres', 'Apres : bouchon lisse']];
let cas = META.cas[0].id, fil = false; const vues = [];
const g = document.getElementById('g');
for (const [k, t] of PANES) {
  const d = document.createElement('div'); d.className = 'pane'; d.innerHTML = `<canvas></canvas><div class="t">${t}</div><div class="n"></div>`; g.appendChild(d);
  const cv = d.querySelector('canvas'); const r = new THREE.WebGLRenderer({ canvas: cv, antialias: true }); r.setPixelRatio(devicePixelRatio);
  const sc = new THREE.Scene(); sc.background = new THREE.Color(0x14151f); sc.add(new THREE.HemisphereLight(0xffffff, 0x303040, 1.7));
  const dl = new THREE.DirectionalLight(0xffffff, 1.3); dl.position.set(3, 4, 5); sc.add(dl);
  const cam = new THREE.PerspectiveCamera(40, 1, 0.001, 100); const ct = new OrbitControls(cam, cv);
  vues.push({ k, sc, cam, ct, r, cv, note: d.querySelector('.n'), objet: null });
}
let sync = false;
vues.forEach(v => v.ct.addEventListener('change', () => { if (sync) return; sync = true; vues.forEach(w => { if (w !== v) { w.cam.position.copy(v.cam.position); w.cam.quaternion.copy(v.cam.quaternion); w.ct.target.copy(v.ct.target); w.ct.update(); } }); sync = false; }));
const loader = new GLTFLoader();
function ligne(a, col) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(a, 3)); return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: col, depthTest: false })); }
async function charger() {
  const c = META.cas.find(x => x.id === cas);
  document.getElementById('info').textContent = c.info;
  for (const v of vues) {
    if (v.objet) v.sc.remove(v.objet);
    const gltf = await loader.loadAsync(`${cas}_${v.k}.glb`); const o = gltf.scene;
    o.traverse(n => { if (n.isMesh) { n.material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide, wireframe: fil, roughness: 0.9, metalness: 0 }); } });
    const seg = c[v.k].segments || [];
    if (seg.length) o.add(ligne(seg, 0xff3b3b));
    v.sc.add(o); v.objet = o;
    const nb = c[v.k].aretes_ouvertes;
    v.note.innerHTML = `${c[v.k].faces} faces · ` + (nb ? `<span class="ko">${nb} arete(s) ouverte(s)</span>` : `<span class="ok">0 arete ouverte</span>`) + (c[v.k].detail ? ' · ' + c[v.k].detail : '');
  }
  const ctr = c.centre, R = c.rayon;
  vues[0].ct.target.set(...ctr); vues[0].cam.position.set(ctr[0] + R * 1.6, ctr[1] + R * 1.0, ctr[2] + R * 1.8); vues[0].ct.update();
  vues.slice(1).forEach(w => { w.cam.position.copy(vues[0].cam.position); w.cam.quaternion.copy(vues[0].cam.quaternion); w.ct.target.copy(vues[0].ct.target); w.ct.update(); });
}
const b = document.getElementById('cas');
for (const c of META.cas) { const x = document.createElement('button'); x.textContent = c.titre; x.onclick = () => { cas = c.id; [...b.children].forEach(y => y.classList.toggle('on', y === x)); charger(); }; if (c.id === cas) x.classList.add('on'); b.appendChild(x); }
document.getElementById('fil').onclick = e => { fil = !fil; e.target.textContent = 'Fil de fer : ' + (fil ? 'oui' : 'non'); charger(); };
function boucle() { requestAnimationFrame(boucle); for (const v of vues) { const w = v.cv.clientWidth, h = v.cv.clientHeight; if (v.cv.width !== w * devicePixelRatio) { v.r.setSize(w, h, false); v.cam.aspect = w / h; v.cam.updateProjectionMatrix(); } v.ct.update(); v.r.render(v.sc, v.cam); } }
await charger(); boucle();
</script></body></html>
'''


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('dossier')
    ap.add_argument('--ref', default='integration-2510')
    a = ap.parse_args()
    os.makedirs(a.dossier, exist_ok=True)
    g = P.charger()
    V0, F0 = np.asarray(g.vertices, dtype=np.float64), np.asarray(g.faces, dtype=np.int64)
    tex = P.texture_numpy(g)
    cas, prep0 = P.fabriquer_cas(g)
    tr = P.trou_traversant(g)
    if tr:
        cas.append(tr)
    arete = prep0['arete_moyenne']
    titres = {'rond': 'Trou rond', 'irregulier': 'Trou irregulier', 'grand': 'Grand trou', 'courbe': 'Surface courbe', 'arete_vive': 'Arete vive',
              'plusieurs': 'Plusieurs trous', 'traversant': 'Trou traversant'}
    meta = {'cas': []}
    env = {**os.environ, 'PYTHONUTF8': '1', 'PYTHONIOENCODING': 'utf-8'}
    with tempfile.TemporaryDirectory() as tmp:
        ancien = os.path.join(tmp, 'ancien')
        os.makedirs(ancien)
        extraire(a.ref, ancien)
        for c in cas:
            h, _ = P.percer(g, c['retirees'])
            ret = c['retirees']
            centre_faces = V0[F0[ret]].mean(axis=1)
            if c['nom'] == 'plusieurs':
                # un trou parmi les cinq : le plus gros groupe connexe = le premier, on cadre sur le centre du premier trou
                adj, _p = P.adjacence_faces(F0, V=V0)
                from scipy.sparse.csgraph import connected_components
                sub = adj[ret][:, ret]
                _n, lab = connected_components(sub, directed=False)
                gros = np.bincount(lab).argmax()
                centre_faces = centre_faces[lab == gros]
            centre = centre_faces.mean(axis=0)
            rayon_trou = float(np.linalg.norm(centre_faces - centre, axis=1).max())
            rayon = max(5 * arete, 3.0 * rayon_trou + 3 * arete)
            e = os.path.join(tmp, c['nom'] + '.glb')
            h.export(e)
            sorties = {}
            # AVANT : l'outil livre, en ligne de commande
            s = os.path.join(tmp, c['nom'] + '_avant.glb')
            r = subprocess.run([sys.executable, os.path.join(ancien, 'scripts', 'mesh_tools.py'), 'fill_holes', e, s, '3', '2000'],
                               capture_output=True, text=True, env=env)
            sorties['avant'] = list(trimesh.load(s, process=False).geometry.values())[0] if os.path.exists(s) else h
            # APRES : le depot courant, meme chemin
            s2 = os.path.join(tmp, c['nom'] + '_apres.glb')
            subprocess.run([sys.executable, os.path.join(RACINE, 'scripts', 'mesh_tools.py'), 'fill_holes', e, s2, '3', '2000'],
                           capture_output=True, text=True, env=env)
            sorties['apres'] = list(trimesh.load(s2, process=False).geometry.values())[0] if os.path.exists(s2) else h
            sorties['orig'] = g
            entree = {'id': c['nom'], 'titre': titres.get(c['nom'], c['nom']), 'centre': [float(x) for x in centre], 'rayon': float(rayon * 0.9)}
            for k in ('orig', 'avant', 'apres'):
                sous, seg = decouper(sorties[k], tex, centre, rayon)
                sous.export(os.path.join(a.dossier, '%s_%s.glb' % (c['nom'], k)))
                entree[k] = {'faces': int(len(sous.faces)), 'aretes_ouvertes': len(seg) // 6, 'segments': seg}
            Vh, Fh = np.asarray(h.vertices), np.asarray(h.faces)
            entree['info'] = '%s : %d faces retirees, %d arete(s) de bord a l ouverture ; rayon de cadrage %.1f aretes.' % (
                titres.get(c['nom'], c['nom']), len(ret), P.aretes_de_bord_soudees(Vh, Fh)[0], rayon / arete)
            meta['cas'].append(entree)
            print(c['nom'], {k: (entree[k]['faces'], entree[k]['aretes_ouvertes']) for k in ('orig', 'avant', 'apres')}, flush=True)
    with open(os.path.join(a.dossier, 'meta.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f)
    with open(os.path.join(a.dossier, 'index.html'), 'w', encoding='utf-8') as f:
        f.write(HTML)
    print('viewer ecrit dans', a.dossier)


if __name__ == '__main__':
    main()
