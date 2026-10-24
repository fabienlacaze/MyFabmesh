// Negations de l'utilisateur sur le SITE (2026-10-03) : cloud/public/app/meshyAPI-cloud.js, generateImages (la requete /api/generate-image).
//   « an orc, no helmet » : index2.js envoie le prompt SANS la locution, le texte brut SANS la locution (le serveur recompose le prompt depuis `userPrompt`),
//   et le terme (« helmet ») dans `negativeExtra`. Le texte AVEC la negation ne sert qu'a la memoire du projet (_savePrompt) : la zone de texte la retrouve.
//   node --test tests/bureau-interface/negations-site.test.mjs
// Contre l'ANCIEN code (les tests doivent echouer) : SHIM_JS=<ancien meshyAPI-cloud.js> node --test tests/bureau-interface/negations-site.test.mjs
// La fonction generateImages est EXTRAITE du fichier (acorn) et executee avec des doublures : ni page, ni reseau.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';

const ici = path.dirname(fileURLToPath(import.meta.url));
const racine = path.resolve(ici, '..', '..');
const SHIM = process.env.SHIM_JS || path.join(racine, 'cloud', 'public', 'app', 'meshyAPI-cloud.js');
const src = fs.readFileSync(SHIM, 'utf-8').replace(/\r\n/g, '\n');
const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script' });
const grave = JSON.parse(fs.readFileSync(path.join(racine, 'build', 'intention_attendus.json'), 'utf-8'));

/** Premier noeud qui verifie le predicat (parcours en profondeur). */
function trouver(noeud, predicat) {
  if (!noeud || typeof noeud.type !== 'string') return null;
  if (predicat(noeud)) return noeud;
  for (const cle of Object.keys(noeud)) {
    const v = noeud[cle];
    const enfants = Array.isArray(v) ? v : [v];
    for (const e of enfants) {
      const r = e && typeof e.type === 'string' ? trouver(e, predicat) : null;
      if (r) return r;
    }
  }
  return null;
}

const noeudGenerer = trouver(ast, (n) => n.type === 'Property' && n.key && (n.key.name === 'generateImages') && n.value.type === 'ArrowFunctionExpression' && n.value.async);
const noeudAssainir = trouver(ast, (n) => n.type === 'FunctionDeclaration' && n.id && n.id.name === '_assainirNegatifs');

/** generateImages du site, avec ses doublures. Rend { appeler, requetes, memoire }. */
function fabriquer() {
  assert.ok(noeudGenerer, 'generateImages introuvable dans le shim');
  const sourceGenerer = src.slice(noeudGenerer.value.start, noeudGenerer.value.end);
  const sourceAssainir = noeudAssainir ? src.slice(noeudAssainir.start, noeudAssainir.end) : 'function _assainirNegatifs(l) { return []; }';
  const requetes = [];
  const memoire = [];
  const fetchFactice = async (url, init) => {
    requetes.push({ url, corps: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => ({ success: true, paths: ['https://images.example.invalid/' + requetes.length + '.png'] }) };
  };
  const fenetre = { __meshyEmit() {}, __cloudCreditsRefresh() {} };
  const document = { getElementById: (id) => (id === 'ws-asset-type' ? { value: 'character' } : id === 'ws-asset-style' ? { value: 'realistic' } : id === 'ws-tpose' ? { checked: true } : null) };
  const fabrique = new Function('log', '_appendCloudImages', '_savePrompt', '_CLOUD_BUILD_STAGE_MODIFIERS', 'document', 'window', 'fetch', 'console',
    sourceAssainir + '\nreturn (' + sourceGenerer + ');');
  const generer = fabrique(() => {}, () => {}, (projet, texte) => memoire.push([projet, texte]), ['STAGE1', 'STAGE2', 'STAGE3'], document, fenetre, fetchFactice, { log() {} });
  return { generer, requetes, memoire };
}

test('shim : _assainirNegatifs rend les memes sorties que assainir_negatifs de Python sur toutes les entrees gravees', () => {
  assert.ok(noeudAssainir, 'le shim n\'a pas de _assainirNegatifs');
  const f = new Function(src.slice(noeudAssainir.start, noeudAssainir.end) + '\nreturn _assainirNegatifs;')();
  assert.ok(grave.assainir.length >= 20);
  for (const { entree, sortie } of grave.assainir) assert.deepEqual(f(entree), sortie, JSON.stringify(entree).slice(0, 100));
});

test('shim : le serveur recoit le prompt ET le texte brut SANS la locution, plus negativeExtra ; la memoire du projet garde le texte ecrit', async () => {
  const { generer, requetes, memoire } = fabriquer();
  const r = await generer({
    prompt: 'An orc, holding a club, isolated 3D character, T-pose',
    userPrompt: 'An orc, no helmet, holding a club',                 // ce que l'utilisateur a ecrit (traduit)
    userPromptEnvoye: 'An orc, holding a club',                      // sans la locution (index2.js)
    negativeExtra: ['helmet'], projectName: 'p', numImages: 1, steps: 30, engine: 'local-flux',
  });
  assert.equal(r.success, true, JSON.stringify(r));
  assert.equal(requetes.length, 1);
  const c = requetes[0].corps;
  assert.equal(c.userPrompt, 'An orc, holding a club', 'le serveur recompose le prompt depuis userPrompt : sans « no helmet »');
  assert.ok(!/no helmet/i.test(c.prompt), c.prompt);
  assert.deepEqual(c.negativeExtra, ['helmet']);
  assert.deepEqual(memoire, [['p', 'An orc, no helmet, holding a club']], 'la zone de texte doit retrouver ce que l\'utilisateur a ecrit');
});

test('shim : sans terme, la requete est celle d\'avant (aucun champ negativeExtra) ; userPrompt est le texte tel quel', async () => {
  for (const negativeExtra of [undefined, [], ['Bad!'], 'helmet', null]) {
    const { generer, requetes } = fabriquer();
    await generer({ prompt: 'An orc', userPrompt: 'An orc', negativeExtra, projectName: 'p', numImages: 1, steps: 30 });
    assert.equal('negativeExtra' in requetes[0].corps, false, JSON.stringify(negativeExtra));
    assert.equal(requetes[0].corps.userPrompt, 'An orc');
  }
});

test('shim : sans userPromptEnvoye (autre appelant), userPrompt part tel quel', async () => {
  const { generer, requetes } = fabriquer();
  await generer({ prompt: 'p', userPrompt: 'An orc, no helmet', negativeExtra: ['helmet'], projectName: 'p', numImages: 1, steps: 30 });
  assert.equal(requetes[0].corps.userPrompt, 'An orc, no helmet');
  assert.deepEqual(requetes[0].corps.negativeExtra, ['helmet']);
});

test('shim : plus de 8 termes ou termes invalides : 8 au plus, chaque lot de 4 images, et les etapes de construction portent aussi les termes', async () => {
  const termes = Array.from({ length: 12 }, (_, i) => 'terme' + 'abcdefghijkl'[i]);
  let m = fabriquer();
  await m.generer({ prompt: 'p', userPrompt: 'u', userPromptEnvoye: 'u2', negativeExtra: ['Bad!', ...termes], projectName: 'p', numImages: 6, steps: 30 });
  assert.equal(m.requetes.length, 2, 'six images = deux appels');
  for (const q of m.requetes) { assert.deepEqual(q.corps.negativeExtra, termes.slice(0, 8)); assert.equal(q.corps.userPrompt, 'u2'); }
  m = fabriquer();
  await m.generer({ prompt: 'p', userPrompt: 'u', userPromptEnvoye: 'u2', negativeExtra: ['helmet'], projectName: 'p', numImages: 1, steps: 30, buildStages: true });
  assert.equal(m.requetes.length, 3, 'trois etapes');
  m.requetes.forEach((q, i) => {
    assert.deepEqual(q.corps.negativeExtra, ['helmet']);
    assert.equal(q.corps.userPrompt, 'STAGE' + (i + 1) + ', u2', 'chaque etape part du texte SANS la locution');
  });
});
