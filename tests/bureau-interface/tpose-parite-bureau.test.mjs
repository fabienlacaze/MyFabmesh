// 26/10 (decision du proprietaire : « oui, parite payante ») : le bureau en mode Cloud utilise la route T-pose du serveur quand la case « T-pose » est cochee
// (personnage), avec le meme supplement par image que le site ; Turbo (moteur sans route T-pose) et pose libre en sont exclus. Prix annonce = prix facture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const R = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lire = (f) => readFileSync(join(R, f), 'utf8').replace(/\r\n/g, '\n');
test('renderer : tposeDemandee seulement pour un personnage, case cochee, hors Turbo', () => {
  const s = lire('src/renderer/index2.js');
  assert.ok(s.includes("...(assetType === 'character' && document.getElementById('ws-tpose')?.checked && engine !== 'local-lightning' ? { tposeDemandee: true } : {}) };"));
});
test('main.js et cloud_fallback.js : transmis, jamais avec poseLibre', () => {
  const m = lire('src/main/main.js'), c = lire('src/main/cloud_fallback.js');
  assert.ok(m.includes('poseLibre, negativeExtra, tposeDemandee }) => {'));
  assert.ok(m.includes('tposeDemandee: tposeDemandee === true || undefined,'));
  assert.ok(c.includes('negativeExtra, poseLibre, tposeDemandee }) {'));
  assert.ok(c.includes('...(tposeDemandee && !poseLibre ? { tpose: true } : {}),'));
});
test('pastille du bureau : n * (prix + supplement), meme condition que l appel', () => {
  const s = lire('src/renderer/index2.js');
  assert.ok(s.includes("window._posePastille(btn, img ? n * (img.prix + supp) : null, true);"));
  assert.ok(s.includes("&& !(img && img.turbo) && typeof suppGrille === 'number' ? suppGrille : 0;"));
  assert.ok(s.includes("['ws-count', 'ws-quality', 'ws-engine', 'ws-img-buildstages', 'ws-tpose', 'ws-asset-type'].forEach"));
});
test('comportement : la condition d envoi reproduite sur des cas', () => {
  const demande = (type, coche, engine) => type === 'character' && coche && engine !== 'local-lightning';
  assert.equal(demande('character', true, 'sdxl'), true);
  assert.equal(demande('character', false, 'sdxl'), false);
  assert.equal(demande('animal', true, 'sdxl'), false);
  assert.equal(demande('character', true, 'local-lightning'), false);
});
