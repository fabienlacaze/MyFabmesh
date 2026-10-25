// 25/10 : « Dessiner un masque » : « Remplacer par » vide = SUPPRIMER la zone (l'interface le dit), mais le site repondait « Inpaint failed: prompt required ».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lire = (r) => readFileSync(join(RACINE, r), 'utf-8').replace(/\r\n/g, '\n');

test("shim web maskInpaint : un prompt vide n'est plus refuse et part vers /api/mask-inpaint", () => {
  const s = lire('cloud/public/app/meshyAPI-cloud.js');
  const bloc = s.slice(s.indexOf('maskInpaint: async ('), s.indexOf('faceFixImage: async ('));
  assert.ok(bloc.length > 200);
  assert.doesNotMatch(bloc, /error: 'prompt required'/);
  assert.match(bloc, /postJSON\('\/api\/mask-inpaint', \{ imageUrl: imagePath, maskDataUrl, prompt: prompt \|\| ''/);
});
test("worker handleMaskInpaint : prompt vide = suppression (aucun 400)", () => {
  const w = lire('cloud/src/worker.ts');
  const f = w.slice(w.indexOf('async function handleMaskInpaint('), w.indexOf('async function handleMaskInpaint(') + 6000);
  assert.match(f, /const isRemoval = !rawPrompt;/);
  assert.doesNotMatch(f.slice(0, f.indexOf('const isRemoval')), /err\(400, 'prompt required'\)/);
});
