// 25/10 (user : « je vois encore des tailles de lecteurs differentes entre deux outils ») : tous les visualiseurs 3D des fenetres d'outils ont la meme taille
// (variables --vz-w-corps x --vz-h-corps). Mesure en navigateur a 1400 x 900 : 896 x 576 pour les 10 outils (avant : 786 a 1120 x 558 a 702).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const f of ['cloud/public/app/styles/index2.css', 'src/renderer/styles/index2.css']) {
  test(`${f} : une seule taille pour tous les visualiseurs 3D des fenetres d'outils`, () => {
    const s = readFileSync(join(RACINE, f), 'utf8').replace(/\r\n/g, '\n');
    assert.ok(s.includes('--vz-w-corps: min(900px, 64vw);'));
    assert.ok(s.includes('.modal-card.fen-3d .fen-corps { grid-template-columns: var(--vz-w-corps) minmax(0, 1fr) !important; }'));
    assert.ok(s.includes('.modal-card.fen-3d .fen-apercu { box-sizing: content-box; width: var(--vz-w-corps); height: var(--vz-h-corps);'));
    for (const id of ['#pm-viewport-wrap', '#me-viewport', '#rz-viewport', '#pe-viewport-wrap']) {
      assert.ok(s.includes(id + ', #') || s.includes(id + ' {'), id + ' suit la taille commune');
    }
    assert.ok(s.includes('flex: 0 0 var(--vz-w-corps) !important; width: var(--vz-w-corps) !important;'));
    assert.ok(s.includes('height: var(--vz-h-corps) !important; min-height: 0 !important;'));
  });
}
