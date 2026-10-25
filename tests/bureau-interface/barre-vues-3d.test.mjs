// 25/10 : harmonisation des visualiseurs 3D (site + bureau). Une seule barre commune (lib/barre-vues-3d.js), un seul ordre des vues
// (Iso, Front, Back, Left, Right, Top, Bottom), un seul texte d'aide (clic droit = deplacer, molette enfoncee = tourner, molette = zoom),
// des hauteurs pilotees par des variables CSS. Aucune page, aucun GPU : le VRAI module est execute contre le VRAI three livre.
// Lancer : node --test tests/bureau-interface/barre-vues-3d.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { brancherImportmap } from './_importmap-lib.mjs';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lire = (f) => readFileSync(join(RACINE, f), 'utf8').replace(/\r\n/g, '\n');
const LIB = join(RACINE, 'src/renderer/lib');
brancherImportmap({ three: join(LIB, 'three.module.js'), addons: LIB });
const ORDRE = ['iso', 'front', 'back', 'left', 'right', 'top', 'bottom'];
const COTES = [
  { nom: 'bureau', js: 'src/renderer/index2.js', html: 'src/renderer/index2.html', css: 'src/renderer/styles/index2.css' },
  { nom: 'site', js: 'cloud/public/app/index2.js', html: 'cloud/public/app/index.html', css: 'cloud/public/app/styles/index2.css' },
];

test('la barre commune existe, identique des deux cotes, avec l ordre unique des vues', async () => {
  assert.equal(lire('src/renderer/lib/barre-vues-3d.js'), lire('cloud/public/app/lib/barre-vues-3d.js'));
  const m = await import(pathToFileURL(join(LIB, 'barre-vues-3d.js')).href);
  assert.deepEqual(m.VUES_3D, ORDRE);
  assert.equal(typeof m.creerBarreVues3D, 'function');
});

test('placerVue3D / zoomer3D / cadrer3D deplacent la camera comme annonce (clic gauche : aucune action de camera)', async () => {
  const THREE = await import(pathToFileURL(join(LIB, 'three.module.js')).href);
  const m = await import(pathToFileURL(join(LIB, 'barre-vues-3d.js')).href);
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
  scene.add(mesh, new THREE.GridHelper(50, 5), new THREE.AmbientLight());   // grille et lumiere ne comptent pas
  mesh.updateMatrixWorld(true);
  const camera = new THREE.PerspectiveCamera();
  const controls = { target: new THREE.Vector3(5, 5, 5), update() {} };
  const v = { camera, controls, scene };
  assert.ok(m.placerVue3D(v, 'front'));
  assert.ok(camera.position.z > 0 && Math.abs(camera.position.x) < 1e-6 && Math.abs(camera.position.y) < 1e-6);
  assert.deepEqual(controls.target.toArray(), [0, 0, 0]);
  const dFront = camera.position.length();
  assert.ok(dFront < 10, 'la grille de 50 ne doit pas compter dans le cadrage : ' + dFront);
  m.placerVue3D(v, 'right');
  assert.ok(camera.position.x > 0 && Math.abs(camera.position.z) < 1e-6);
  m.placerVue3D(v, 'top');
  assert.ok(camera.position.y > 0);
  m.placerVue3D(v, 'iso');
  assert.ok(camera.position.x > 0 && camera.position.y > 0 && camera.position.z > 0);
  const avant = camera.position.length();
  m.zoomer3D(v, 0.5);
  assert.ok(Math.abs(camera.position.length() - avant / 2) < 1e-6);
  m.zoomer3D(v, 2);
  assert.ok(Math.abs(camera.position.length() - avant) < 1e-6);
  assert.equal(m.placerVue3D(null, 'front'), false);
  assert.equal(m.placerVue3D(() => null, 'front'), false);
  assert.equal(m.placerVue3D(v, 'nimporte'), false);
});

for (const c of COTES) {
  test(`${c.nom} : chaque fenetre d'outil 3D recoit la barre commune`, () => {
    const js = lire(c.js);
    assert.match(js, /import \{ creerBarreVues3D \} from '\.\/lib\/barre-vues-3d\.js'/);
    for (const etat of ['mtState', 'pmState', 'peState', 'meState']) {
      assert.match(js, new RegExp(`creerBarreVues3D\\([a-z]+, ${etat}\\)`), etat);
    }
    assert.match(js, /creerBarreVues3D\(canvas\.parentElement, _matViewer/);
    assert.match(js, /creerBarreVues3D\(vp, rzState/);
    assert.match(js, /creerBarreVues3D\(canvas\.parentElement, \(\) => _apercuAnim/);
    assert.match(js, /creerBarreVues3D\(canvas\.parentElement, \{ camera: cam, controls: ctl, scene \}\)/);
  });

  test(`${c.nom} : les boutons de vues suivent l'ordre unique (Align Texture, points plein ecran, Reshape)`, () => {
    const html = lire(c.html);
    const i = html.indexOf('id="at-view-buttons"');
    const bloc = html.slice(i, html.indexOf('</div>', i));
    assert.deepEqual([...bloc.matchAll(/data-view="(\w+)"/g)].map((x) => x[1]), ORDRE);
    let pos = 0;
    for (let k = 0; k < 2; k++) {
      const a = html.indexOf('class="lm-fs-view-toolbar"', pos);
      const b = html.slice(a, html.indexOf('</div>', a));
      assert.deepEqual([...b.matchAll(/data-view="(\w+)"/g)].map((x) => x[1]), ORDRE, 'panneau ' + k);
      pos = a + 10;
    }
    const r = html.slice(html.indexOf('id="rrx-3d-presets"'), html.indexOf('id="rrx-3d-info"'));
    assert.match(r, /title="Reset camera"/);
    assert.match(r, />Iso</);
    assert.ok(r.indexOf('>Iso<') < r.indexOf('>Front<'));
    assert.doesNotMatch(html, /id="rrx-3d-canvas"[^>]*cursor:grab/);
  });

  test(`${c.nom} : textes d'aide du schema 25/10 (plus de "orbit with right-click", "Drag to rotate")`, () => {
    const html = lire(c.html);
    const js = lire(c.js);
    for (const vieux of ['Orbit with right-click', 'right-drag to orbit', 'right-click to orbit', 'Drag to rotate', 'Drag / middle-drag', 'orbit with right-drag', 'Drag to turn the model']) {
      assert.ok(!html.includes(vieux) && !js.includes(vieux), vieux);
    }
    assert.match(html, /id="mt-preview-status"[^>]*>Right-drag to pan · middle-drag to rotate · wheel to zoom</);
    assert.match(html, /id="mat-preview-status"[^>]*>Right-drag to pan · middle-drag to rotate · wheel to zoom</);
    assert.match(html, /id="rz-hint"[^>]*>Drag gizmo · right-drag: pan · middle-drag: rotate · wheel: zoom</);
  });

  test(`${c.nom} : hauteurs pilotees par variables (plus de 560px / 56vh), curseur de lumiere 0-500 avec son icone`, () => {
    const html = lire(c.html);
    const css = lire(c.css);
    for (const id of ['pe-viewport-wrap', 'at-preview-canvas-wrap', 'rz-viewport']) {
      const i = html.indexOf(`id="${id}"`);
      const tag = html.slice(i, html.indexOf('>', i));
      assert.match(tag, /var\(--vz-h-corps\)/, id);
    }
    assert.doesNotMatch(html.slice(html.indexOf('id="pm-viewport-wrap"'), html.indexOf('id="pm-canvas"')), /560px/);
    assert.match(css, /--vz-h-corps:/);
    assert.match(css, /\.mesh-toolbar\.fen \{/);
    const lb = html.slice(html.indexOf('id="lightbox-3d-toolbar"'), html.indexOf('id="lightbox-2"'));
    assert.match(lb, /class="light-label"/);
    assert.match(lb, /data-act="light" min="0" max="500"/);
    assert.match(lb, /data-explode-wrap/);
    assert.match(html, /id="lb3d-loading"/);
  });

  test(`${c.nom} : les chaines nouvelles sont traduites en 5 langues`, () => {
    const lang = lire(c.nom === 'bureau' ? 'src/renderer/lang/_additions6.js' : 'cloud/public/app/lang/_additions6.js');
    for (const cle of ['Right-drag to pan · middle-drag to rotate · wheel to zoom', 'Zoom in', 'Zoom out',
      'Drag gizmo · right-drag: pan · middle-drag: rotate · wheel: zoom', 'Drag any point. Right-drag pans, middle-drag rotates, wheel zooms.',
      'Left drag = paint · right drag = pan · middle drag = rotate · wheel = zoom']) {
      const re = new RegExp('"' + cle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '": \\[("[^"]+",? ?){5}\\]');
      assert.match(lang, re, cle);
    }
  });
}

test('le site reprend la frise traduite, la garde WebGL du bureau et le rig source en three.js', () => {
  const js = lire('cloud/public/app/index2.js');
  assert.match(js, /function _stageKindLabels\(stages\)/);
  assert.doesNotMatch(js, /'CHANTIER'/);
  assert.match(js, /function _apercuRigSourceAnim\(/);
  assert.doesNotMatch(js, /<model-viewer src="\$\{url\}"\s+camera-controls touch-action="pan-y"\s+shadow-intensity="1" exposure="1"\s+auto-rotate/);
  assert.match(js, /const _r2 = _mkRenderer\(\{\s+canvas, antialias: true, alpha: false/);
  assert.match(lire('cloud/public/app/index.html'), /Explode parts \(segmented mesh\)/);
  assert.doesNotMatch(lire('cloud/public/app/index.html'), /segmented \/ fractured mesh/);
});

test('poids de peau et apercu d allures : ordre des vues, aide corrigee, curseur par defaut', () => {
  const poids = lire('src/renderer/lib/editeur-poids.js');
  assert.equal(poids, lire('cloud/public/app/lib/editeur-poids.js'));
  assert.match(poids, /creerBarreVues3D\(\$\('pp-vue'\)/);   // LOT W32 : barre commune (ordre garanti par barre-vues-3d.js)
  assert.match(poids, /right drag = pan · middle drag = rotate/);
  assert.doesNotMatch(poids, /right drag = rotate/);
  const ap = lire('src/renderer/lib/apercu-animation.js');
  assert.equal(ap, lire('cloud/public/app/lib/apercu-animation.js'));
  assert.doesNotMatch(ap, /cursor = 'grab'/);
});
