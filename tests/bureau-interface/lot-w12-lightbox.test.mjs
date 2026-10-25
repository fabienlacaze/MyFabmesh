import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

for (const [nom, chemin] of [['site', 'cloud/public/app/styles/index2.css'], ['bureau', 'src/renderer/styles/index2.css']]) {
  test('LOT W12 visionneuse 2D harmonisee (' + nom + ')', () => {
    const css = readFileSync(chemin, 'utf8');
    const i = css.indexOf('LOT W12 (25/10)');
    assert.ok(i > 0, 'bloc LOT W12 absent');
    const bloc = css.slice(i);
    assert.match(bloc, /#lightbox-2 \.lightbox-nav\.next[^{]*\{ right: calc\(var\(--lb-colonne\) \+ 44px\); \}/);
    assert.match(bloc, /max-height: calc\(100vh - 144px\)/);
    assert.match(bloc, /@media \(hover: none\)/);
    assert.match(bloc, /#lightbox-2-bottom \{[^}]*left: calc\(\(100% - var\(--lb-colonne\) - 18px\) \/ 2\)/);
  });
}

test('LOT W12 ids de la visionneuse conserves', () => {
  for (const f of ['cloud/public/app/index.html', 'src/renderer/index2.html']) {
    const h = readFileSync(f, 'utf8');
    for (const id of ['lightbox-2', 'lightbox-2-close', 'lightbox-2-prev', 'lightbox-2-next', 'lightbox-2-img', 'lightbox-2-bottom', 'lightbox-2-use-3d', 'lb-toolbox'])
      assert.ok(h.includes('id="' + id + '"'), f + ' perd ' + id);
  }
});
