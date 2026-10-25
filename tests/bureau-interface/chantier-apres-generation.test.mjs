// 25/10 : « les etapes de construction definies en debut de generation 3D ne marchent pas » (toast « n'ont pas ete lancees »).
// Le garde comparait les noms de projet strictement ; apres le rechargement le nom peut revenir sous une autre forme (espaces / underscores).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const f of ['cloud/public/app/index2.js', 'src/renderer/index2.js']) {
  test(`${f} : le lancement apres generation accepte un nom de projet equivalent et dit pourquoi il renonce`, () => {
    const src = readFileSync(join(RACINE, f), 'utf8').replace(/\r\n/g, '\n');
    const i = src.indexOf('function _chantierApresGeneration(');
    const corps = src.slice(i, src.indexOf('\n}\n', i));
    assert.match(corps, /_nomsEquivalents\(cur\.name, p\.name\)/);
    assert.doesNotMatch(corps, /cur\.name !== p\.name/);
    assert.match(corps, /_raison/);
    assert.match(corps, /window\._chantierPrereglage/);
  });
}
for (const f of ['cloud/public/app/index2.js', 'src/renderer/index2.js']) {
  test(`${f} : le libelle de la case reprend le nombre d'etapes choisi dans la fenetre`, () => {
    const src = readFileSync(join(RACINE, f), 'utf8').replace(/\r\n/g, '\n');
    assert.match(src, /function _bs3dLibelleCase\(n\)/);
    assert.match(src, /_bs3dLibelleCase\(window\._chantierPrereglage\.count\)/);
    assert.match(src, /Construction stages \(\{x\} versions\)/);
  });
}
for (const f of ['cloud/public/app/index2.js', 'src/renderer/index2.js']) {
  test(`${f} : les reglages des etapes de construction sont un panneau deroulant sous la case (plus de fenetre)`, () => {
    const src = readFileSync(join(RACINE, f), 'utf8').replace(/\r\n/g, '\n');
    assert.match(src, /function _bs3dPanneau\(\)/);
    assert.match(src, /createElement\('details'\)/);
    assert.match(src, /Construction stages options/);
    assert.doesNotMatch(src, /_bs3dPrereglage|_bs3dFinPrereglage/);
  });
}
