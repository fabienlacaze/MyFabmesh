// 25/10 (demande du user : « les memes boutons que Recolorier pour la 3D ») : fenetre « Recolor » du maillage, cablage des deux plateformes.
// Recette de portage (CLAUDE.md, section 9) : croisement des id HTML <-> getElementById du JS, API exposee, prix, marquage IA, noyau partage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lire = (r) => readFileSync(join(RACINE, r), 'utf-8').replace(/\r\n/g, '\n');
const PLATEFORMES = {
  bureau: { html: 'src/renderer/index2.html', js: 'src/renderer/index2.js' },
  site: { html: 'cloud/public/app/index.html', js: 'cloud/public/app/index2.js' },
};
const IDS = ['modal-recolor3d', 'r3-mode', 'r3-swatches', 'r3-strength', 'r3-strength-val', 'r3-hint', 'r3-cancel', 'r3-go', 'ws-mesh-recolor-btn'];

for (const [nom, f] of Object.entries(PLATEFORMES)) {
  const html = lire(f.html), js = lire(f.js);
  test(`${nom} : chaque id de la fenetre Recolor existe dans la page ET est lu par le JS`, () => {
    for (const id of IDS) {
      assert.ok(html.includes(`id="${id}"`), `${f.html} : id ${id} absent`);
      assert.ok(js.includes(`'${id}'`), `${f.js} : ${id} jamais lu`);
    }
  });
  test(`${nom} : la fenetre propose Whole model / One part / Style`, () => {
    const bloc = html.slice(html.indexOf('id="modal-recolor3d"'), html.indexOf('id="modal-recolor"'));
    for (const v of ['general', 'zone', 'whole-style']) assert.ok(bloc.includes(`data-valeur="${v}"`), v);
  });
  test(`${nom} : tout, une partie peinte, style : les trois chemins sont branches`, () => {
    assert.match(js, /window\.meshyAPI\.recolorMesh\(\{ meshPath: mp, color: _r3\.couleur, intensity: intensite/);
    assert.match(js, /openPaintEmissive\(\{ maskMode: true, recolor: \{ color: _r3\.couleur, intensity: intensite \}, meshPath: mp \}\)/);
    assert.match(js, /if \(mode === 'whole-style'\) \{ fermer\(\); document\.getElementById\('ws-mesh-texvar-btn'\)\?\.click\(\); return; \}/);
    assert.match(js, /if \(peState\.maskMode && peState\.recolor\) \{\n\s*await _peApplyRecolor\(\);/);
    assert.match(js, /\(mesh edit\|save mesh\|sculpt\|watertight\|decimate\|subdivid\|\^center\|set\[- \]\?pivot\|fix\[- \]\?normals\|segment\|recolor 3d\)/);
  });
}
test('bureau : API exposee (preload) et canal marque IA', () => {
  assert.match(lire('src/main/preload.js'), /recolorMesh: \(opts\) => ipcRenderer\.invoke\('mesh-recolor', opts\)/);
  assert.match(lire('src/main/marquage_ia.js'), /'mesh-recolor': \{\}/);
  assert.match(lire('src/main/main.js'), /ipcMain\.handle\('mesh-recolor'/);
  assert.match(lire('src/renderer/index2.js'), /'materialAdjust', 'recolorMesh', 'resizeMesh'/);
});
test('site : operation autorisee et validee par le worker, API exposee', () => {
  const w = lire('cloud/src/worker.ts');
  assert.match(w, /'recolor',     \/\/ recolorier la texture/);
  assert.match(w, /recolor needs params\.color as #rrggbb/);
  assert.match(w, /'region_retex', 'name_parts', 'recolor'\]/);
  assert.match(lire('cloud/public/app/meshyAPI-cloud.js'), /recolorMesh: async \(\{ meshPath, meshUrl, color, intensity = 1, maskDataUrl = null, projectName \} = \{\}\)/);
  assert.match(lire('cloud/public/app/cloud-overrides.js'), /'ws-mesh-recolor-btn':\s+'mesh_op_simple'/);
});
