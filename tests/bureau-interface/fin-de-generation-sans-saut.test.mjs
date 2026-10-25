// 25/10 (user : « ca m'a actualise la page et amene a la generation qui vient de finir : il y a un systeme de spawned automatique en fin de generation
// qu'il faut enlever »). Le sondage des travaux serveur ne recharge plus le projet affiche ; « Aller a » le fait, sur demande.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lire = (f) => readFileSync(join(RACINE, f), 'utf8').replace(/\r\n/g, '\n');

test('site : la fin d un travail suivi par le sondage ne recharge plus le projet (toast + listes seulement)', () => {
  const s = lire('cloud/public/app/index2.js');
  const i = s.indexOf('for (const [sid, local] of Array.from(_jobByServerId.entries())) {');
  assert.ok(i > 0);
  const bloc = s.slice(i, s.indexOf('_rafraichirListeProjets();', i) + 40);
  assert.doesNotMatch(bloc, /reloadCurrentProject/);
  assert.match(bloc, /completeJob\(local\.id, true\)/);
  assert.match(bloc, /_i18nTf\('\{x\} finished/);
});
for (const f of ['cloud/public/app/index2.js', 'src/renderer/index2.js']) {
  test(`${f} : « Aller a » recharge le projet, sur demande, si la version produite n est pas encore connue`, () => {
    const s = lire(f);
    const i = s.indexOf('const v = ') > 0 ? s.indexOf('_versionDuTravail(j, pj)') : -1;
    assert.ok(i > 0);
    const bloc = s.slice(i - 200, i + 700);
    assert.match(bloc, /if \(!v && pj && typeof reloadCurrentProject === 'function'\)/);
    assert.match(bloc, /await reloadCurrentProject\(\)/);
  });
}
