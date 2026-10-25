// 25/10 : « si je clique sur Aller a, ca ne m'amene pas a la version (ca reste sur V22) ». Un travail de maillage termine selectionne la version qu'il a produite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const f of ['cloud/public/app/index2.js', 'src/renderer/index2.js']) {
  const src = readFileSync(join(RACINE, f), 'utf8').replace(/\r\n/g, '\n');
  const i = src.indexOf('function _versionDuTravail(');
  const code = src.slice(i, src.indexOf('\n}\n', i) + 3);
  const versionDuTravail = new Function(code + '\nreturn _versionDuTravail;')();
  const FIN = 1792947000000;
  const p = { meshes: [
    { path: 'https://x/r2/u/mesh-op/p/1792946000000_decimate_client.glb?exp=1', filename: '1792946000000_decimate_client.glb' },     // v21, plus ancienne
    { path: 'https://x/r2/u/mesh-op/p/1792946990000_subdivide_client.glb?exp=1', filename: '1792946990000_subdivide_client.glb' },   // produite par le travail
    { path: 'https://x/r2/u/mesh/modal_aaaa.glb', filename: 'modal_aaaa.glb', mtime: 1792940000000 },                                 // generation anterieure
  ] };
  test(`${f} : la version produite est celle dont l'horodatage tombe dans la duree du travail`, () => {
    const v = versionDuTravail({ startedAt: FIN - 12000, finiLe: FIN }, p);
    assert.equal(v.filename, '1792946990000_subdivide_client.glb');
  });
  test(`${f} : sans version dans la fenetre -> rien (on ne selectionne pas au hasard)`, () => {
    assert.equal(versionDuTravail({ startedAt: FIN + 600000, finiLe: FIN + 610000 }, p), null);
    assert.equal(versionDuTravail({ startedAt: 1, finiLe: 2 }, { meshes: [] }), null);
  });
  test(`${f} : resultPath a la priorite, meme avec une adresse signee differente`, () => {
    const v = versionDuTravail({ resultPath: 'https://x/r2/u/mesh-op/p/1792946000000_decimate_client.glb?exp=999', finiLe: FIN }, p);
    assert.equal(v.filename, '1792946000000_decimate_client.glb');
  });
  test(`${f} : une generation (nom modal_..., date du fichier) est retrouvee par sa date`, () => {
    const q = { meshes: [{ path: 'https://x/r2/u/mesh/modal_bbbb.glb', filename: 'modal_bbbb.glb', mtime: FIN - 3000 }, p.meshes[0]] };
    assert.equal(versionDuTravail({ startedAt: FIN - 90000, finiLe: FIN }, q).filename, 'modal_bbbb.glb');
  });
  test(`${f} : la navigation appelle la selection pour un travail de maillage termine, et completeJob note l'heure de fin`, () => {
    assert.match(src, /if \(_fini && stepIdx === 2\) \{[\s\S]{0,600}_versionDuTravail\(j, pj\)/);
    assert.match(src, /j\.finiLe = Date\.now\(\);/);
  });
}
