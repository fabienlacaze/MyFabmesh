// LOT W14 : la fenetre Variant adopte le gabarit .fen-3d (apercu a gauche, colonne de reglages, pied).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const CIBLES = [
  ['bureau', 'src/renderer/index2.html', 'modal-variant', 'src/renderer/styles/index2.css'],
  ['site', 'cloud/public/app/index.html', 'variant-modal', 'cloud/public/app/styles/index2.css'],
];
const IDS = ['var-source-img', 'var-mode-group', 'var-tex-mode', 'var-free-mode', 'var-strength', 'var-strength-val',
  'var-tex-prompt', 'var-count', 'var-cancel', 'var-apply'];

for (const [nom, html, id, css] of CIBLES) {
  test('Variant ' + nom + ' : gabarit fen-3d', () => {
    const s = fs.readFileSync(html, 'utf8');
    const i = s.indexOf('id="' + id + '"');
    assert.ok(i > 0);
    const j = s.indexOf('<div class="modal-actions">', i);
    const bloc = s.slice(i, s.indexOf('</div>\r\n    </div>', j) > 0 ? j + 600 : j + 600);
    assert.match(s.slice(i, i + 200), /modal-card fen-3d/);
    assert.match(bloc, /class="fen-corps"/);
    assert.match(bloc, /fen-apercu/);
    assert.match(bloc, /fen-form/);
    assert.match(bloc, /modal-subtitle/);
    for (const x of IDS) assert.ok(bloc.includes('id="' + x + '"'), 'id perdu : ' + x);
    assert.ok(fs.readFileSync(css, 'utf8').includes('LOT W14 : Variant'));
  });
}
