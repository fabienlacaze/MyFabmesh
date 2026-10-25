// 25/10 : « si j'efface la zone dessinee il reste des points qui ne partent pas » (re-texture / Reshape d'une zone, peinture sur le maillage 3D).
// Cause : le remplissage anti-aliase laisse une couverture partielle sur les aretes des triangles ; a l'effacement il en reste (0,75 x 0,5 x 0,5 = 0,19).
// Correctif : un contour de 2 px dans la meme operation. VRAIE fonction _peStampAtPointer des deux index2.js, avec un faux contexte 2D.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FICHIERS = { bureau: join(RACINE, 'src/renderer/index2.js'), site: join(RACINE, 'cloud/public/app/index2.js') };

function extraire(chemin) {
  const src = readFileSync(chemin, 'utf-8').replace(/\r\n/g, '\n');
  const i = src.indexOf('function _peStampAtPointer(');
  assert.ok(i >= 0, chemin + ' : fonction introuvable');
  const j = src.indexOf('\n}\n', i) + 3;
  return src.slice(i, j);
}

function essai(code, mode, opacite) {
  const journal = [];
  const ctx = {
    set globalCompositeOperation(v) { this._op = v; journal.push(['op', v]); }, get globalCompositeOperation() { return this._op; },
    fillStyle: null, strokeStyle: null, lineWidth: 1, lineJoin: 'miter',
    createRadialGradient: () => ({ addColorStop() {} }),
    save() {}, restore() {}, beginPath() { journal.push(['debut']); }, moveTo() {}, lineTo() {}, closePath() {},
    fill() { journal.push(['fill', this._op]); },
    stroke() { journal.push(['stroke', this._op, this.lineWidth]); },
  };
  const hit = { uv: { x: 0.5, y: 0.5 }, object: { worldToLocal: (v) => v, geometry: {
      attributes: { uv: { array: new Float32Array([0.4, 0.4, 0.6, 0.4, 0.5, 0.6, 0.45, 0.45, 0.55, 0.45, 0.5, 0.55]) },
                    position: { array: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0]), count: 6 } }, index: null } },
    point: { clone() { return { x: 0.2, y: 0.2, z: 0 }; } } };
  const entry = { ctx, texture: { needsUpdate: false } };
  const peState = { brushMode: mode, brushOpacity: opacite, brushColor: '#ffffff', brushSize: 600, brushFalloff: 0.3,
    canvases: new Map([[hit.object, entry]]), camera: { fov: 50, position: { distanceTo: () => 2 } },
    renderer: { domElement: { clientHeight: 600 } } };
  const f = new Function('peState', '_peRaycast', 'PE_TEX_SIZE', '_peHexToRgba', code + '\nreturn _peStampAtPointer;')(
    peState, () => hit, 1024, (h, a) => `rgba(255,255,255,${a})`);
  f(10, 10);
  return journal;
}

for (const [nom, chemin] of Object.entries(FICHIERS)) {
  const code = extraire(chemin);
  test(`${nom} : la gomme contourne chaque triangle (destination-out, 2 px) : plus de points residuels`, () => {
    const j = essai(code, 'erase', 1);
    const fills = j.filter((e) => e[0] === 'fill'), strokes = j.filter((e) => e[0] === 'stroke');
    assert.ok(fills.length >= 1);
    assert.equal(strokes.length, fills.length, 'un contour par triangle rempli');
    assert.ok(strokes.every((s) => s[1] === 'destination-out' && s[2] === 2));
  });
  test(`${nom} : la peinture pleine opacite contourne aussi (memes aretes couvertes)`, () => {
    const j = essai(code, 'paint', 1);
    assert.equal(j.filter((e) => e[0] === 'stroke').length, j.filter((e) => e[0] === 'fill').length);
  });
  test(`${nom} : une peinture a demi-opacite n'est pas doublee sur le contour`, () => {
    const j = essai(code, 'paint', 0.5);
    assert.equal(j.filter((e) => e[0] === 'stroke').length, 0);
    assert.ok(j.filter((e) => e[0] === 'fill').length >= 1);
  });
}
