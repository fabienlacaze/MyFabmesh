// 25/10 : une edition d'image (image_op) rend la taille de l'ENTREE ; une petite image (225 px) etait refusee comme « placeholder ».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const chemin = process.env.WORKER_SRC || new URL('../src/worker.ts', import.meta.url);
const SRC = readFileSync(chemin, 'utf8').replace(/\r\n/g, '\n');
const a = SRC.indexOf('function _assertImageBytes(');
const b = SRC.indexOf('/** Enrobe un appel GPU AUXILIAIRE');
const js = ts.transpileModule(SRC.slice(a, b), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const _assertImageBytes = new Function(js + '; return _assertImageBytes;')();

function png(largeur, taille) {
  const u = new Uint8Array(taille);
  u.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(u.buffer).setUint32(16, largeur, false);
  return u.buffer;
}
test('petite image editee (225 px, 67 Ko) : acceptee quand la largeur n est pas controlee', () => {
  assert.doesNotThrow(() => _assertImageBytes(png(225, 66982), 'Modal image_op (mask_inpaint)', false, true));
});
test('generation : un PNG de 225 px reste refuse', () => {
  assert.throws(() => _assertImageBytes(png(225, 66982), 'Modal text2image'), /placeholder size/);
});
