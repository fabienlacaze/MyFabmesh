// 27/10 : « upload failed » a l'enregistrement d'un gros maillage (Select faces, moissonneuse) : base64 JSON decode dans le Worker = memoire depassee.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const api = readFileSync(new URL('../public/app/meshyAPI-cloud.js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../src/worker.ts', import.meta.url), 'utf8');
test('saveBuffer envoie les gros maillages bruts par la route en flux', () => {
  assert.match(api, /arg\.base64\.length > 16e6/);
  assert.match(api, /kind: 'mesh'/);
  assert.match(api, /\/api\/upload-rig\?/);
});
test('la route en flux ne suffixe pas un maillage en rig', () => {
  assert.match(worker, /searchParams\.get\('kind'\) !== 'mesh' && !\/_rigged_\/i\.test\(nom\)/);
});
test('le message d\'echec donne le code HTTP', () => {
  assert.match(api, /upload failed \(HTTP \$\{resp\.status\}\)/);
});
test('au-dela de 90 Mo : envoi par morceaux (HTTP 413 sur la moissonneuse), cle de maillage acceptee par le worker', () => {
  assert.match(api, /oct\.byteLength > 90e6/);
  assert.match(api, /action: 'init', kind: 'mesh'/);
  assert.match(worker, /const cleValide = \(k: string\) => cleOk\(k\) \|\| cleMeshOk\(k\)/);
  assert.match(worker, /q\.get\('kind'\) === 'mesh'/);
});
test('fenetre d\'echec : « Copy error » est le bouton principal', () => {
  const idx = readFileSync(new URL('../public/app/index2.js', import.meta.url), 'utf8');
  assert.match(idx, /_cb\.className = 'primary-btn'/);
  assert.match(idx, /gotoBtn\.classList\.toggle\('ghost-btn', j\.status === 'error'\)/);
});
