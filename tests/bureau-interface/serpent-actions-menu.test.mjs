// 26/10 (user : « rajoute attack pour les reptiles et boire manger ») : le menu du mode Reptation propose Attaque, Manger (avaler une proie) et Boire ;
// « boire » est une action nouvelle du moteur (sans pattes : tete a l'eau qui lape ; a pattes : meme posture que manger).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const R = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lire = (f) => readFileSync(join(R, f), 'utf8').replace(/\r\n/g, '\n');
for (const lib of ['cloud/public/app/lib/locomotion-procedurale.js', 'src/renderer/lib/locomotion-procedurale.js']) {
  test(`${lib} : action « drink » dans le moteur`, () => {
    const s = lire(lib);
    assert.ok(s.includes("  drink: { beta: 1.0, T: [4.5, 4.5]"));
    assert.ok(s.includes("  drink: { normal: {} },"));
    assert.ok(s.includes("['attack', 'hit', 'death', 'eat', 'drink', 'jump', 'lie_down'].includes(allure)"));
    assert.ok(s.includes("} else if (allure === 'drink') {"));
  });
}
for (const ix of ['cloud/public/app/index2.js', 'src/renderer/index2.js']) {
  test(`${ix} : menu Reptation avec attaque / manger / boire`, () => {
    const s = lire(ix);
    assert.ok(s.includes("attack: '⚔️ Strike', eat: '🐁 Swallow prey', drink: '💧 Drink'"));
    assert.ok(s.includes("(m === 'reptation' ? ['idle', 'walk', 'run', 'turn_left', 'turn_right', 'attack', 'eat', 'drink']"));
    assert.ok(s.includes("{ v: 'drink', libelle: '💧 Drink' }"));
    assert.ok(s.includes("'trot', 'walk_back', 'jump', 'eat', 'drink', 'lie_down', 'attack', 'hit', 'death'];"));
  });
}
test('les deux copies du moteur restent identiques', () => {
  assert.equal(lire('cloud/public/app/lib/locomotion-procedurale.js'), lire('src/renderer/lib/locomotion-procedurale.js'));
});
