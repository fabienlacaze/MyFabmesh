// 25/10 (user : « rajoute l'icone de l'item comme pour les autres outils 2D des images ») : la fenetre « Multi-views » montre l'image de l'element, a gauche,
// comme Recolor / Variante (gabarit .modal-with-image).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lire = (f) => readFileSync(join(RACINE, f), 'utf8').replace(/\r\n/g, '\n');
for (const [html, js] of [['cloud/public/app/index.html', 'cloud/public/app/index2.js'], ['src/renderer/index2.html', 'src/renderer/index2.js']]) {
  test(`${html} : la fenetre Multi-views a l'image de l'element a gauche et les reglages a droite`, () => {
    const h = lire(html);
    const i = h.indexOf('<div id="modal-multiview-options"');
    const fin = h.indexOf('MESH TOOL PARAMS MODAL', i);
    const bloc = h.slice(i, fin > 0 ? fin : i + 4000);
    assert.ok(bloc.includes('class="modal-card modal-card-wide"'));
    assert.ok(bloc.includes('<div class="modal-with-image">'));
    assert.ok(bloc.includes('<img id="mv-opt-source-img" alt="" />'));
    assert.ok(bloc.includes('<div class="modal-form-side">'));
    assert.ok(bloc.indexOf('mv-opt-source-img') < bloc.indexOf('id="mv-opt-mode"'), "l'image vient avant les reglages");
    assert.ok(bloc.indexOf('id="mv-opt-start"') > bloc.indexOf('id="mv-opt-mode"'));
  });
  test(`${js} : l'image est chargee a l'ouverture`, () => {
    const s = lire(js);
    assert.ok(s.includes('function _mvImageDeLElement(p) {'));
    assert.ok(s.includes("img.src = _bust(_toFileUrl(chemin))"));
    assert.ok(s.includes('_mvImageDeLElement(p);   // l\'image de l\'element'));
  });
}
