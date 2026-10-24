"""Banc navigateur (HORS suite unittest) : la carte de normales cuite par scripts/normal_bake.py, rendue par le VRAI three.js de l'appli
(src/renderer/lib/three.module.js, GLTFLoader.js) dans Chromium sans tete (WebGL logiciel, aucun GPU) (2026-10-04).

Chaine verifiee de bout en bout : cuisson (noyau) -> appliquer_carte_normales -> export GLB par trimesh (PNG et WebP sans perte) ->
GLTFLoader (pas d'attribut TANGENT : tangentes derivees a l'ecran, normalScale.y = -1) -> rendu Lambert eclaire par une lumiere
directionnelle (pixel = albedo x n.L, sans speculaire) -> les pixels sont compares a l'eclairage ATTENDU calcule en numpy a partir
des normales analytiques. Les variantes a canal vert ou rouge inverse servent de temoins : elles doivent etre nettement refusees.

  - plans : plan fin bossele (sinusoide) -> quad final ; ilot droit, en miroir, tourne de 90 degres, transpose ;
  - sphere : sphere fine -> icosphere legere (320 faces), UN ILOT PAR FACE (orientations et miroirs aleatoires), normales de
    sommet PLATES (le pire cas : sans carte, l'eclairage est facette) ; reference = ombrage de la vraie sphere.

Mesures du 2026-10-04 (three.js r170, SwiftShader, rendu 256 x 256) : plan RMSE 0,0151 (correlation 0,997) pour les quatre
dispositions contre 0,229 / 0,279 pour le vert / le rouge inverses et 0,186 sans carte ; sphere facettee RMSE 0,0034 avec la carte,
0,0436 sans, 0,0574 avec le vert inverse.

Lancer :  python build/bancs/noyaux/verif_threejs_normales.py          (~ 1 min 30 ; code 0 = tout est conforme)
Le lanceur de navigateur est le skill browser-automation (patchright) : variable BROWSER_MJS pour son chemin si ce n'est pas
~/.claude/skills/browser-automation/browser.mjs. Sur la machine du proprietaire (Unreal ouvert) : `bash /c/tmp/lourd.sh python ...`.
"""
import http.server
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time

import numpy as np

RACINE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_normal_bake as T   # noqa: E402  (constructeurs de maillages, le noyau charge)

NB = T.NB
BROWSER = os.environ.get('BROWSER_MJS') or os.path.join(os.path.expanduser('~'), '.claude', 'skills', 'browser-automation', 'browser.mjs')
S = 256
L_PLAN = np.array([0.55, 0.75, -0.45])
L_PLAN /= np.linalg.norm(L_PLAN)
L_SPH = np.array([0.5, 0.6, 0.62])
L_SPH /= np.linalg.norm(L_SPH)

PAGE = r'''<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Verification normales three.js</title>
<script type="importmap">{ "imports": { "three": "./lib/three.module.js" } }</script></head>
<body><pre id="out">en cours...</pre>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from './lib/loaders/GLTFLoader.js';
const out = document.getElementById('out');
const S = %(S)d;
async function rendre(v, renderer) {
  const gltf = await new GLTFLoader().loadAsync(v.glb);
  const scene = new THREE.Scene();
  const infos = [];
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const vieux = o.material;
    infos.push({ normalMap: !!vieux.normalMap, normalScale: vieux.normalScale ? [vieux.normalScale.x, vieux.normalScale.y] : null,
                 tangent: !!o.geometry.attributes.tangent, normal: !!o.geometry.attributes.normal });
    // normalScale.y = -1 a ete pose par le chargeur (tangentes derivees) : copie telle quelle dans un Lambert blanc, sans speculaire
    o.material = new THREE.MeshLambertMaterial({ color: 0xffffff, normalMap: vieux.normalMap, side: vieux.side });
    if (vieux.normalMap) o.material.normalScale.copy(vieux.normalScale);
  });
  scene.add(gltf.scene);
  const l = new THREE.DirectionalLight(0xffffff, Math.PI);          // Lambert : pixel = albedo * intensite / pi * n.L = n.L
  l.position.set(v.lumiere[0] * 5, v.lumiere[1] * 5, v.lumiere[2] * 5);
  scene.add(l);
  let cam;
  if (v.camera === 'plan') {
    cam = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.1, 20);
    cam.position.set(0.5, 5, -0.5); cam.up.set(0, 0, -1); cam.lookAt(0.5, 0, -0.5);
  } else {
    cam = new THREE.OrthographicCamera(-1.1, 1.1, 1.1, -1.1, 0.1, 20);
    cam.position.set(0, 0, 5); cam.up.set(0, 1, 0); cam.lookAt(0, 0, 0);
  }
  renderer.setClearColor(0x000000, 1);
  renderer.render(scene, cam);
  const gl = renderer.getContext();
  const px = new Uint8Array(S * S * 4);
  gl.readPixels(0, 0, S, S, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const gris = new Uint8Array(S * S);
  for (let i = 0; i < S; i++) for (let j = 0; j < S; j++) gris[i * S + j] = px[((S - 1 - i) * S + j) * 4];
  const rep = await fetch('/save/' + v.nom, { method: 'POST', body: gris });
  return { nom: v.nom, envoye: rep.status, infos };
}
const resultats = [];
try {
  const variantes = await (await fetch('variantes.json')).json();
  const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true, antialias: false });
  renderer.setSize(S, S, false); renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping;
  document.body.appendChild(renderer.domElement);
  for (const v of variantes) {
    try { resultats.push(await rendre(v, renderer)); }
    catch (e) { resultats.push({ nom: v.nom, erreur: String(e && e.message || e) }); }
  }
  out.textContent = JSON.stringify({ revision: THREE.REVISION, resultats });
} catch (e) { out.textContent = JSON.stringify({ erreur_globale: String(e && e.message || e) }); }
const fin = document.createElement('div'); fin.id = 'done'; document.body.appendChild(fin);
</script></body></html>
''' % {'S': S}


def attendu_plan(grad):
    """Eclairage attendu (S, S) d'un plan dont la normale haute definition est analytique, vu de dessus (camera orthographique)."""
    i, j = np.mgrid[0:S, 0:S]
    hx, hy = grad((j + 0.5) / S, 1.0 - (i + 0.5) / S)
    n = np.stack([-hx, -hy, np.ones_like(hx)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return np.clip((T.zup_yup(n) * L_PLAN).sum(-1), 0.0, 1.0)


def zbuffer_orthographique(V, F, demi=1.1):
    """Points de surface vus par une camera orthographique placee en +Z : (S, S, 3), masque (S, S)."""
    j = (np.arange(S) + 0.5) / S
    X, Y = np.meshgrid(-demi + j * 2 * demi, demi - j * 2 * demi)
    Z = np.full((S, S), -np.inf)
    for f in F:
        a, b, c = V[f]
        den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(den) < 1e-12:
            continue
        l0 = ((b[1] - c[1]) * (X - c[0]) + (c[0] - b[0]) * (Y - c[1])) / den
        l1 = ((c[1] - a[1]) * (X - c[0]) + (a[0] - c[0]) * (Y - c[1])) / den
        l2 = 1.0 - l0 - l1
        dedans = (l0 >= 0) & (l1 >= 0) & (l2 >= 0)
        z = l0 * a[2] + l1 * b[2] + l2 * c[2]
        Z = np.where(dedans & (z > Z), z, Z)
    masque = np.isfinite(Z)
    return np.stack([X, Y, np.where(masque, Z, 0.0)], -1), masque


def main():
    if not os.path.exists(BROWSER):
        print('lanceur de navigateur introuvable : %s (variable BROWSER_MJS)' % BROWSER)
        return 2
    travail = tempfile.mkdtemp(prefix='verif-three-normales-')
    try:
        os.makedirs(os.path.join(travail, 'glb'))
        os.makedirs(os.path.join(travail, 'out'))
        for rel in ('three.module.js', os.path.join('loaders', 'GLTFLoader.js'), os.path.join('utils', 'BufferGeometryUtils.js')):
            dest = os.path.join(travail, 'lib', rel)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            shutil.copy(os.path.join(RACINE, 'src', 'renderer', 'lib', rel), dest)
        with open(os.path.join(travail, 'index.html'), 'w', encoding='utf-8') as f:
            f.write(PAGE)

        variantes, attendus, genres = [], {}, {}

        def ajouter(cle, m, webp, camera, lumiere, attendu, genre):
            glb = m.export(file_type='glb', extension_webp=webp)
            with open(os.path.join(travail, 'glb', cle + '.glb'), 'wb') as f:
                f.write(glb)
            variantes.append({'nom': cle, 'glb': 'glb/%s.glb' % cle, 'camera': camera, 'lumiere': lumiere.tolist()})
            attendus[cle] = attendu
            genres[cle] = (genre, len(glb))

        # --- plans ---
        h, grad = T.champ_sinus(0.03, 3, 3)
        Vh, Fh = T.grille_fine(161, h)
        ref_plan = attendu_plan(grad)
        dispositions = {'droit': None, 'miroir': lambda xn, yn: (1.0 - xn, yn), 'tourne': lambda xn, yn: (yn, 1.0 - xn),
                        'transpose': lambda xn, yn: (yn, xn)}
        a_faire = [('droit', 'carte', False), ('droit', 'carte', True), ('droit', 'vert_inverse', False), ('droit', 'rouge_inverse', False),
                   ('droit', 'sans', False), ('miroir', 'carte', False), ('miroir', 'vert_inverse', False), ('tourne', 'carte', False),
                   ('tourne', 'vert_inverse', False), ('transpose', 'carte', False)]
        for nom, mode, webp in a_faire:
            Vq, Fq, UV = T.quad_final(0, 1, 0, 1, uv_de=dispositions[nom])
            m = T.maillage_texture(Vq, Fq, UV)
            carte = NB.bake_normal_map(m, Vh, Fh, 256, log=None)
            if mode == 'vert_inverse':
                carte = carte.copy()
                carte[..., 1] = 255 - carte[..., 1]
            if mode == 'rouge_inverse':
                carte = carte.copy()
                carte[..., 0] = 255 - carte[..., 0]
            if mode != 'sans':
                NB.appliquer_carte_normales(m, carte, log=None)
            ajouter('plan_%s_%s%s' % (nom, mode, '_webp' if webp else ''), m, webp, 'plan', L_PLAN, ref_plan, ('plan', nom, mode))

        # --- sphere a normales plates ---
        s = T.trimesh.creation.icosphere(subdivisions=5, radius=1.0)
        Vs, Fs = np.asarray(s.vertices, np.float32), np.asarray(s.faces, np.int32)
        leg = T.trimesh.creation.icosphere(subdivisions=2, radius=1.0)
        V, F, UV, N = T.ilots_par_face(np.asarray(leg.vertices), np.asarray(leg.faces), 'plates', 0.5, True, 1)
        P, masque = zbuffer_orthographique(V, F)
        ref = P / np.maximum(np.linalg.norm(P, axis=-1, keepdims=True), 1e-9)
        ideal = np.where(masque, np.clip((ref * L_SPH).sum(-1), 0.0, 1.0), 0.0)
        for mode in ('carte', 'vert_inverse', 'sans'):
            m = T.maillage_texture(V, F, UV, normales=N)
            carte = NB.bake_normal_map(m, Vs, Fs, 512, log=None)
            if mode == 'vert_inverse':
                carte = carte.copy()
                carte[..., 1] = 255 - carte[..., 1]
            if mode != 'sans':
                NB.appliquer_carte_normales(m, carte, log=None)
            ajouter('sphere_plates_%s' % mode, m, True, 'sphere', L_SPH, (ideal, masque), ('sphere', 'plates', mode))

        with open(os.path.join(travail, 'variantes.json'), 'w') as f:
            json.dump(variantes, f)

        class Gestionnaire(http.server.SimpleHTTPRequestHandler):
            extensions_map = dict(http.server.SimpleHTTPRequestHandler.extensions_map)
            extensions_map.update({'.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary',
                                   '.json': 'application/json', '.html': 'text/html', '': 'application/octet-stream'})

            def __init__(self, *a, **kw):
                super().__init__(*a, directory=travail, **kw)

            def log_message(self, *a):
                pass

            def do_POST(self):
                donnees = self.rfile.read(int(self.headers.get('Content-Length', 0)))
                with open(os.path.join(travail, 'out', self.path.split('/save/')[1] + '.u8'), 'wb') as f:
                    f.write(donnees)
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'ok')

        serveur = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Gestionnaire)
        threading.Thread(target=serveur.serve_forever, daemon=True).start()
        t0 = time.time()
        cmd = ['node', BROWSER, 'http://127.0.0.1:%d/index.html' % serveur.server_address[1], '--wait', '#done', '--timeout', '400000',
               '--eval', "document.getElementById('out').textContent"]
        r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=900)
        serveur.shutdown()
        erreurs_console = [l for l in r.stdout.splitlines() if l.startswith('  ') and 'console' not in l][:5]
        print('navigateur : %d variantes en %.0f s' % (len(variantes), time.time() - t0))

        def lire(cle):
            p = os.path.join(travail, 'out', cle + '.u8')
            if not os.path.exists(p):
                return None
            with open(p, 'rb') as f:
                return np.frombuffer(f.read(), np.uint8).reshape(S, S).astype(np.float64) / 255.0

        from scipy import ndimage
        mesures = {}
        print('%-30s %8s %8s %11s' % ('variante', 'RMSE', 'corr', 'octets GLB'))
        for v in variantes:
            cle = v['nom']
            img = lire(cle)
            genre = genres[cle][0]
            if img is None:
                print('%-30s  (pas de rendu)' % cle)
                continue
            if genre[0] == 'plan':
                ref_, zone = attendus[cle], np.zeros((S, S), bool)
                zone[8:-8, 8:-8] = True
            else:
                ref_, masque = attendus[cle]
                zone = ndimage.binary_erosion(masque, iterations=3)
            d = (img - ref_)[zone]
            rmse = float(np.sqrt((d * d).mean()))
            corr = float(np.corrcoef(img[zone], ref_[zone])[0, 1]) if img[zone].std() > 1e-9 else float('nan')
            mesures[cle] = (rmse, corr)
            print('%-30s %8.4f %8.4f %11d' % (cle, rmse, corr, genres[cle][1]))

        # --- verdict ---
        echecs = []

        def exiger(condition, texte):
            if not condition:
                echecs.append(texte)
        for v in variantes:
            exiger(v['nom'] in mesures, '%s : pas de rendu' % v['nom'])
        if not echecs:
            for nom, mode, webp in a_faire:
                cle = 'plan_%s_%s%s' % (nom, mode, '_webp' if webp else '')
                rmse, corr = mesures[cle]
                if mode == 'carte':
                    exiger(rmse < 0.03 and corr > 0.99, '%s : RMSE %.4f, correlation %.4f (attendu < 0,03 et > 0,99)' % (cle, rmse, corr))
                elif mode == 'sans':
                    exiger(rmse > 0.1, '%s : le temoin sans carte devrait etre loin de l attendu (%.4f)' % (cle, rmse))
                else:
                    exiger(rmse > 0.15, '%s : canal inverse NON refuse (RMSE %.4f)' % (cle, rmse))
            carte_s, sans_s, vert_s = mesures['sphere_plates_carte'][0], mesures['sphere_plates_sans'][0], mesures['sphere_plates_vert_inverse'][0]
            exiger(carte_s < 0.01, 'sphere avec carte : RMSE %.4f (attendu < 0,01)' % carte_s)
            exiger(carte_s < 0.25 * sans_s, 'sphere : la carte n ameliore pas assez (%.4f contre %.4f sans)' % (carte_s, sans_s))
            exiger(vert_s > sans_s, 'sphere : le vert inverse devrait etre PIRE que sans carte (%.4f contre %.4f)' % (vert_s, sans_s))
        for e in echecs:
            print('ECHEC : ' + e)
        if echecs and erreurs_console:
            print('sortie du navigateur :', r.stdout[-1500:], r.stderr[-800:])
        print('CONFORME : toutes les verifications passent' if not echecs else '%d verification(s) en echec' % len(echecs))
        return 1 if echecs else 0
    finally:
        shutil.rmtree(travail, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
