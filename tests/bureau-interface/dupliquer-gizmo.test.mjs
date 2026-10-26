// 26/10 (user : « si je clique sur Dupliquer, il faut copier la zone selectionnee et faire apparaitre le gizmo pour deplacer la copie ») :
// apres « Dupliquer » (Selectionner des faces), la COPIE est la seule selection et le gizmo de deplacement s'ouvre dessus.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const R = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lire = (f) => readFileSync(join(R, f), 'utf8').replace(/\r\n/g, '\n');
function gestionnaire(src) {
  const i = src.indexOf("document.getElementById('me-sel-duplicate')?.addEventListener('click', () => {");
  assert.ok(i > 0);
  return src.slice(i, src.indexOf('\n});\n', i) + 4);
}
for (const f of ['cloud/public/app/index2.js', 'src/renderer/index2.js']) {
  test(`${f} : Dupliquer ferme un gizmo deja ouvert puis ouvre le gizmo sur la copie`, () => {
    const g = gestionnaire(lire(f));
    assert.ok(g.includes('if (meState.moveActive) _meEndMove();'));
    assert.ok(/_meStartMove\(\);/.test(g));
    assert.ok(g.indexOf('_meEndMove();') < g.indexOf('_meRestoreView()'), 'le gizmo precedent est ferme AVANT de dupliquer');
    assert.ok(g.lastIndexOf('_meStartMove();') > g.indexOf('Duplicated'), 'le gizmo s ouvre APRES la duplication');
  });
}
test('site : l original est deselectionne, seule la copie reste orange', () => {
  const g = gestionnaire(lire('cloud/public/app/index2.js'));
  assert.ok(g.includes("for (let i = 0; i < oldV; i++) if (_meOrange(cur, i)) cur.setXYZ(i, gris, gris, gris);"));
});
