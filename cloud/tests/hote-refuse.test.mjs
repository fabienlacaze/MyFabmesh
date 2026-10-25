// 25/10 : « meshUrl host not allowed » (etapes de construction 3D) ne disait pas QUELLE URL posait probleme. Le message nomme maintenant l'hote refuse (jamais le chemin
// ni la signature).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const chemin = process.env.WORKER_SRC || new URL('../src/worker.ts', import.meta.url);
const SRC = readFileSync(chemin, 'utf8').replace(/\r\n/g, '\n');
const a = SRC.indexOf('function _hoteRefuse('), b = SRC.indexOf('\n}\n', a) + 3;
const js = ts.transpileModule(SRC.slice(a, b), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const _hoteRefuse = new Function(js + '; return _hoteRefuse;')();

test('hote refuse : nom de domaine seul, sans chemin ni signature', () => {
  assert.equal(_hoteRefuse('https://Evil.Example/r2/mesh/x.glb?exp=1&sig=SECRET'), 'evil.example');
});
test('cas sans hote : relatif, vide, schema non https', () => {
  assert.equal(_hoteRefuse('/r2/mesh/x.glb'), 'relative URL (no host)');
  assert.equal(_hoteRefuse(''), 'empty URL');
  assert.equal(_hoteRefuse(undefined), 'empty URL');
  assert.match(_hoteRefuse('http://x.example/a.glb'), /http: \(not https\)/);
  assert.match(_hoteRefuse('blob:https://x.example/uuid'), /blob:/);
  assert.match(_hoteRefuse('pas une url'), /^invalid URL \(starts with "pas une url"\)$/);
  assert.doesNotMatch(_hoteRefuse('cle/sans/schema.glb?exp=1&sig=SECRET'), /SECRET/);
});
test('les refus d hote des maillages (meshUrl) nomment l hote refuse', () => {
  const n = (SRC.match(/host not allowed: ' \+ _hoteRefuse\(/g) || []).length;
  assert.ok(n >= 20, 'refus mis a jour : ' + n);
  assert.equal((SRC.match(/err\(400, 'meshUrl host not allowed'\)/g) || []).length, 0, 'plus aucun refus muet de meshUrl');
});
