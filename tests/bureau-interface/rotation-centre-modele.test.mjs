// 25/10 : la molette enfoncee tourne autour du CENTRE du modele (et plus d'un point derive par zoomToCursor / deplacement).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as THREE from 'three';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = readFileSync(join(RACINE, 'cloud/public/app/lib/centre-rotation.js'), 'utf8');
// le module importe « three » (importmap du navigateur) : on le charge via un data-URL qui garde la meme specification, resolue par node_modules
const url = pathToFileURL(join(RACINE, 'tests/bureau-interface/.centre-rotation.tmp.mjs'));
import { writeFileSync, unlinkSync } from 'node:fs';
writeFileSync(url, SRC);
const mod = await import(url.href);
unlinkSync(url);

function maillage(centre, taille = 2, n = 400) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { pos[3 * i] = centre[0] + (Math.random() - 0.5) * taille; pos[3 * i + 1] = centre[1] + (Math.random() - 0.5) * taille; pos[3 * i + 2] = centre[2] + (Math.random() - 0.5) * taille; }
  pos.set([centre[0] - taille / 2, centre[1] - taille / 2, centre[2] - taille / 2, centre[0] + taille / 2, centre[1] + taille / 2, centre[2] + taille / 2], 0);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial());
}

test('centre du modele : boite englobante des maillages visibles, petits objets ignores', () => {
  const scene = new THREE.Scene();
  scene.add(maillage([5, 1, -3]));
  const poignee = maillage([100, 100, 100], 1, 10);          // moins de 300 sommets : poignee / curseur
  scene.add(poignee);
  const c = mod.centreDuModele(scene);
  assert.ok(Math.abs(c.x - 5) < 0.01 && Math.abs(c.y - 1) < 0.01 && Math.abs(c.z + 3) < 0.01, JSON.stringify(c));
});
test('maillage masque ignore ; scene vide -> null', () => {
  const scene = new THREE.Scene();
  const m = maillage([5, 5, 5]); m.visible = false; scene.add(m);
  assert.equal(mod.centreDuModele(scene), null);
  assert.equal(mod.centreDuModele(null), null);
});
test('appui molette : la cible se place au centre et la camera suit du meme vecteur (pas de saut d angle)', () => {
  const scene = new THREE.Scene(); scene.add(maillage([2, 0, 0]));
  const cam = new THREE.PerspectiveCamera(); cam.position.set(0, 0, 10); cam.__derniereScene = scene;
  const controls = { object: cam, target: new THREE.Vector3(0, 0, 0), update() { this.misAJour = true; } };
  const ecouteurs = {};
  const dom = { addEventListener: (t, f, capture) => { ecouteurs[t] = { f, capture }; } };
  mod.centrerRotation(controls, dom);
  assert.equal(ecouteurs.pointerdown.capture, true);
  ecouteurs.pointerdown.f({ button: 0 });                      // autre bouton : rien
  assert.equal(controls.target.x, 0);
  ecouteurs.pointerdown.f({ button: 1 });
  assert.ok(Math.abs(controls.target.x - 2) < 0.01);
  assert.ok(Math.abs(cam.position.x - 2) < 0.01 && Math.abs(cam.position.z - 10) < 0.01, 'meme direction et meme distance');
  assert.ok(controls.misAJour);
});
test('les quatre visualiseurs et les deux index2.js appellent centrerRotation', () => {
  for (const f of ['cloud/public/app/index2.js', 'src/renderer/index2.js', 'cloud/public/app/lib/Viewer3D.js', 'src/renderer/lib/Viewer3D.js',
    'cloud/public/app/lib/apercu-animation.js', 'cloud/public/app/lib/editeur-poids.js']) {
    assert.match(readFileSync(join(RACINE, f), 'utf8'), /centrerRotation\(/, f);
  }
});
