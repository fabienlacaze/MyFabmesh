// 25/10 : « Worker exceeded resource limits » (HTTP 503 de Cloudflare) sur Re-texture a region et Etapes de construction 3D : un GLB de 60-90 Mo en
// base64 dans du JSON depassait la memoire (128 Mo) et le temps CPU du worker. Modal televerse maintenant le GLB DIRECTEMENT dans R2 (r2_put_url).
// Controle de structure des trois chemins du worker (handleMeshOp, _opAtlasGpu, etapes de construction) ; le helper Modal a son test Python.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const chemin = process.env.WORKER_SRC || new URL('../src/worker.ts', import.meta.url);
const SRC = readFileSync(chemin, 'utf8').replace(/\r\n/g, '\n');
const corps = (debut, fin) => { const a = SRC.indexOf(debut); assert.ok(a >= 0, debut); const b = SRC.indexOf(fin, a + 10); assert.ok(b > a, fin); return SRC.slice(a, b); };

test('handleMeshOp : URL PUT envoyee a Modal, GLB deja dans R2 verifie, repli base64 conserve', () => {
  const f = corps('async function handleMeshOp(', '\nasync function _opAtlasGpu(');
  assert.match(f, /r2_put_url: urlPut/);
  assert.match(f, /if \(data\.uploaded\) \{\n\s+if \(!\(await env\.MESHES\.head\(key\)\)\)/);
  assert.match(f, /glb_base64/, 'repli ancien Modal');
});
test('_opAtlasGpu : meme schema', () => {
  const f = corps('async function _opAtlasGpu(', '/** POST /api/mesh-retexture');
  assert.match(f, /r2_put_url: urlPut/);
  assert.match(f, /data\.uploaded/);
  assert.match(f, /head\(key\)/);
});
test('etapes de construction 3D : une URL PUT par etape, pas de decodage base64 quand l etape est televersee', () => {
  const f = corps('async function handleConstructionStages3d(', '/** GET /api/stages3d-list');
  assert.match(f, /r2_put_url: urlPut/);
  assert.match(f, /fd\.uploaded/);
  assert.match(f, /if \(fd\.uploaded\) \{[\s\S]*?\} else \{[\s\S]*?atob\(fd\.glb_base64\)/);
});
