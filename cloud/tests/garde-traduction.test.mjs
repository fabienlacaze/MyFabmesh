// Garde de traduction du site (cloud/public/app/garde-traduction.js) : cas reel du 03/10/2026 (« bouteille d'eau avec un liquide fluo bleu »).
// Aucun reseau. Lancer : cd cloud && node --test tests/garde-traduction.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = process.env.GARDE_SRC || new URL('../public/app/garde-traduction.js', import.meta.url);
const code = readFileSync(SRC, 'utf8');

function charger(api) {
  const window = { meshyAPI: api };
  vm.runInNewContext(code, { window, globalThis: window, console }, { filename: 'garde-traduction.js' });
  return window;
}
const garder = (s, t) => charger(null).garderTraduction(s, t);

test('cas reel : la proposition inventee « glass bottle » est retiree', () => {
  assert.equal(
    garder("bouteille d'eau avec un liquide fluo bleu", 'water bottle with a blue fluo liquid, a glass bottle with a blue fluo liquid'),
    'water bottle with a blue fluo liquid');
});

test('une traduction normale n\'est jamais modifiee', () => {
  assert.equal(garder('un orc avec une massue', 'an orc with a club'), 'an orc with a club');
  assert.equal(garder('un chat noir, avec des yeux verts', 'a black cat, with green eyes'), 'a black cat, with green eyes');
  assert.equal(garder('une bouteille bleue et un verre', 'a blue bottle and a glass'), 'a blue bottle and a glass');
});

test('deux propositions voulues par l\'utilisateur, meme tres proches : conservees', () => {
  const t = 'a water bottle with a blue fluo liquid, a glass bottle with a blue fluo liquid';
  assert.equal(garder("une bouteille d'eau avec un liquide fluo bleu, une bouteille en verre avec un liquide fluo bleu", t), t);
});

test('boucle de repetition : une seule proposition restante', () => {
  assert.equal(garder('un chien', 'a dog, a dog, a dog'), 'a dog');
});

test('proposition en trop mais DIFFERENTE : conservee (la garde ne decide pas du sens)', () => {
  const t = 'a red car, with a driver and a dog';
  assert.equal(garder('une voiture rouge', t), t);
});

test('sources non latines et entrees degenerees : aucune exception', () => {
  assert.equal(garder('一瓶蓝色液体', 'a bottle of blue liquid, a bottle of blue liquid'), 'a bottle of blue liquid');
  assert.equal(garder('', ''), '');
  assert.equal(garder(null, undefined), '');
  assert.equal(garder(undefined, 'a, ,'), 'a, ,');
});

test('l\'enveloppe de translatePrompt nettoie la reponse du serveur, une seule fois', async () => {
  let appels = 0;
  const api = { translatePrompt: async () => { appels++; return { text: 'water bottle with a blue fluo liquid, a glass bottle with a blue fluo liquid' }; } };
  const w = charger(api);
  const r = await w.meshyAPI.translatePrompt({ text: "bouteille d'eau avec un liquide fluo bleu", from: 'fr' });
  assert.equal(r.text, 'water bottle with a blue fluo liquid');
  assert.equal(r.nettoye, true);
  assert.equal(appels, 1);
  // second chargement du script : pas de double enveloppe
  vm.runInNewContext(code, { window: w, globalThis: w, console });
  const r2 = await w.meshyAPI.translatePrompt({ text: "bouteille d'eau avec un liquide fluo bleu", from: 'fr' });
  assert.equal(r2.text, 'water bottle with a blue fluo liquid');
  assert.equal(appels, 2);
});

test('l\'enveloppe laisse passer une reponse sans texte ou normale', async () => {
  const w = charger({ translatePrompt: async () => ({ text: 'an orc with a club' }) });
  assert.deepEqual(await w.meshyAPI.translatePrompt({ text: 'un orc avec une massue', from: 'fr' }), { text: 'an orc with a club' });
  const w2 = charger({ translatePrompt: async () => null });
  assert.equal(await w2.meshyAPI.translatePrompt({ text: 'x', from: 'fr' }), null);
});

test('le site charge le script apres cloud-overrides.js et avant index2.js (module)', () => {
  const html = readFileSync(new URL('../public/app/index.html', import.meta.url), 'utf8');
  const i = html.indexOf('<script src="cloud-overrides.js"'), j = html.indexOf('<script src="garde-traduction.js"'), k = html.search(/<script type="module" src="index2\.js"/);
  assert.ok(i > 0 && j > i, 'garde-traduction.js absent ou charge avant cloud-overrides.js');
  assert.ok(k > j, 'index2.js doit etre charge apres la garde');
});
