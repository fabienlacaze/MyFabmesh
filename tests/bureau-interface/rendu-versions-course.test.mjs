// 28/10 : deux symetries d'affilee dupliquaient les vignettes de la bande des versions de maillage (v2 v1 v0 v2 v1 v0) : renderMeshVersions videait la bande
// AVANT ses attentes reseau, donc deux rendus en vol ajoutaient chacun leurs vignettes. Le rendu perime doit etre ecarte et la bande videe APRES les attentes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const racine = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const f of ['cloud/public/app/index2.js', 'src/renderer/index2.js']) {
  test(`renderMeshVersions : bande videe apres les attentes, rendu perime ecarte (${f})`, () => {
    const src = readFileSync(join(racine, f), 'utf8');
    const debut = src.indexOf('async function renderMeshVersions(p) {');
    assert.ok(debut > 0, 'fonction introuvable');
    const fin = src.indexOf('meshes.forEach((m, i) => {', debut);
    const corps = src.slice(debut, fin);
    const dernierAwait = corps.lastIndexOf('await ');
    const vidage = corps.indexOf("strip.innerHTML = ''");
    const jeton = corps.indexOf('_rmvJeton !== window.__rmvJeton');
    assert.ok(dernierAwait > 0 && vidage > dernierAwait, 'la bande doit etre videe APRES le dernier await');
    assert.ok(jeton > dernierAwait && jeton < vidage, 'le test du jeton doit preceder le vidage, apres le dernier await');
    assert.equal(corps.split("strip.innerHTML = ''").length - 1, 1, 'un seul vidage de la bande');
  });
}
