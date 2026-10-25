// 25/10 (user : « le prix ne doit pas etre en haut a gauche, surtout quand pas actif : il doit etre pour chaque parametre ») : sur le site, le prix des etapes de
// construction n'est plus sur la ligne de la case ; il est dans le menu de ses reglages, et seulement quand la case est cochee.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lire = (f) => readFileSync(join(RACINE, f), 'utf8').replace(/\r\n/g, '\n');
test('site : plus de pastille sur la ligne de la case, pastille dans le resume des reglages, seulement si coche', () => {
  const s = lire('cloud/public/app/cloud-overrides.js');
  assert.ok(s.includes("vignette(chantier && chantier.closest('label'), null);"));
  assert.ok(s.includes("document.querySelector('#ws-3d-stages-opts > summary')"));
  assert.ok(s.includes("const actif = !!(chantier && chantier.checked) && typeof pc === 'number' && pc > 0;"));
  assert.ok(!s.includes("vignette(chantier && chantier.closest('label'), pc,"));
});
test('site : la case recalcule le prix apres avoir cree le panneau des reglages', () => {
  const s = lire('cloud/public/app/index2.js');
  assert.ok(s.includes("window.__majPrixMaillage && window.__majPrixMaillage()"));
});
