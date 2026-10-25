// 25/10 (user : « a la fin de la subdivision, un flash, je me retrouve en haut de la page ») : populateWorkspace garde la position de defilement du MEME projet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const f of ['cloud/public/app/index2.js', 'src/renderer/index2.js']) {
  test(`${f} : populateWorkspace relit puis remet le defilement quand le projet affiche est le meme`, () => {
    const s = readFileSync(join(RACINE, f), 'utf8').replace(/\r\n/g, '\n');
    assert.equal((s.match(/^function populateWorkspace\(p\) \{/gm) || []).length, 1, 'un seul populateWorkspace public');
    assert.equal((s.match(/^function _populateWorkspaceBrut\(p\) \{/gm) || []).length, 1);
    const i = s.indexOf('function populateWorkspace(p) {');
    const corps = s.slice(i, s.indexOf('\n}\n', i));
    assert.match(corps, /state\.currentProject\.name === p\.name/);
    assert.match(corps, /page\.scrollTop/);
    assert.match(corps, /_populateWorkspaceBrut\(p\)/);
    assert.match(corps, /\[150, 500, 1200, 2500\]/);
  });
}
