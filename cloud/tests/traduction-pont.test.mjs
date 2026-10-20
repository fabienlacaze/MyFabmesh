// TRADUCTION : LE PONT DU SITE (public/app/meshyAPI-cloud.js) — 2026-10-13, lot 2 de l'audit de la langue du 11/10.
//   - translatePrompt rend le drapeau `translated` et la `raison` du serveur (TRADUCTION-03, SERVEUR-03 : ils etaient jetes, l'interface ne
//     pouvait pas distinguer un echec d'un texte deja anglais) ; une erreur HTTP donne sa raison (quota 429, session 401) ;
//   - « Envoyer tel quel » (langueVerifiee), choisi dans l'interface apres un echec de traduction, atteint CHAQUE route qui porte un texte
//     libre : le filet de langue du serveur respecte ce choix au lieu de refuser le texte (422).
// Les VRAIES methodes de l'objet `impl` du pont, extraites avec acorn ; postJSON et fetch simules. Aucun reseau.
// Lancer : cd cloud && node --test tests/traduction-pont.test.mjs        (ancien code : PONT_JS=<copie> node --test ...)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as acorn from 'acorn';

const CHEMIN = process.env.PONT_JS || new URL('../public/app/meshyAPI-cloud.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const src = readFileSync(CHEMIN, 'utf-8');
const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script' });

/** Les methodes du pont, par nom : proprietes de `const impl = { ... }` puis des `Object.assign(impl, { ... })` (ordre du fichier). */
function methodesImpl() {
  const objets = [];
  const pile = [ast];
  while (pile.length) {
    const n = pile.pop();
    if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.id.name === 'impl' && n.init && n.init.type === 'ObjectExpression') objets.push(n.init);
    if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && n.callee.object.name === 'Object' && n.callee.property.name === 'assign'
        && n.arguments[0] && n.arguments[0].type === 'Identifier' && n.arguments[0].name === 'impl'
        && n.arguments[1] && n.arguments[1].type === 'ObjectExpression') objets.push(n.arguments[1]);
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v)) { for (const x of v) if (x && typeof x.type === 'string') pile.push(x); }
      else if (v && typeof v.type === 'string') pile.push(v);
    }
  }
  assert.ok(objets.length, 'objet impl introuvable dans ' + CHEMIN);
  const m = new Map();
  for (const o of objets.sort((a, b) => a.start - b.start)) {
    for (const p of o.properties) if (p.type === 'Property' && !p.computed) m.set(p.key.name || p.key.value, src.slice(p.value.start, p.value.end));
  }
  return m;
}
const METHODES = methodesImpl();
// _assainirNegatifs (negations de l'utilisateur, fusionne le 20/10) : declaration de premier niveau du pont, extraite telle quelle
// (sinon la doublure par defaut rend `undefined` et generateImages leve avant de poster)
const _noeudAssainir = (function chercher(n) {
  if (!n || typeof n.type !== 'string') return null;
  if (n.type === 'FunctionDeclaration' && n.id && n.id.name === '_assainirNegatifs') return n;
  for (const k of Object.keys(n)) {
    const v = n[k];
    for (const e of (Array.isArray(v) ? v : [v])) { const r = e && typeof e.type === 'string' ? chercher(e) : null; if (r) return r; }
  }
  return null;
})(ast);
const ASSAINIR = _noeudAssainir ? new Function('return (' + src.slice(_noeudAssainir.start, _noeudAssainir.end) + ')')() : null;

/** Evalue une methode du pont avec des doublures ; un nom inconnu vaut une fonction vide (les globales du langage restent les vraies). */
function methode(nom, doublures) {
  const code = METHODES.get(nom);
  assert.ok(code, 'methode ' + nom + ' introuvable');
  const portee = new Proxy(Object.create(null), {
    has: (_, n) => typeof n === 'string' && (Object.prototype.hasOwnProperty.call(doublures, n)
      || !(n === '__code' || n === 'eval' || n === 'arguments' || n in globalThis)),
    // eslint-disable-next-line func-names
    get: (_, n) => (typeof n !== 'string' ? undefined : Object.prototype.hasOwnProperty.call(doublures, n) ? doublures[n] : function () { return undefined; }),
  });
  // eslint-disable-next-line no-new-func
  return new Function('__portee', '__code', 'with (__portee) { return eval(__code); }')(portee, '(' + code + ')');
}

test('translatePrompt : le drapeau `translated`, la raison et la langue du serveur sont RENDUS (avant : seulement { text })', async () => {
  const avec = (reponse) => methode('translatePrompt', { postJSON: async () => (typeof reponse === 'function' ? reponse() : reponse) });
  let r = await avec({ text: 'a red dragon', translated: true, langue: 'fr' })({ text: 'un dragon rouge', from: 'fr' });
  assert.deepEqual([r.text, r.translated, r.langue], ['a red dragon', true, 'fr']);
  r = await avec({ text: 'a red dragon', translated: false, raison: 'already-english' })({ text: 'a red dragon', from: 'fr' });
  assert.deepEqual([r.translated, r.raison], [false, 'already-english'], 'texte deja anglais : dit comme tel, pas comme un echec');
  r = await avec({ ok: false, success: false, status: 429, error: 'HTTP 429' })({ text: 'un dragon rouge', from: 'fr' });
  assert.deepEqual([r.text, r.translated, r.raison], ['un dragon rouge', false, 'rate-limited'], 'quota : avant, le texte d origine passait pour une traduction');
  r = await avec({ ok: false, success: false, status: 401, error: 'unauthorized' })({ text: 'un dragon rouge', from: 'fr' });
  assert.equal(r.raison, 'signed-out');
  r = await avec(() => { throw new Error('reseau'); })({ text: 'un dragon rouge', from: 'fr' });
  assert.deepEqual([r.text, r.translated, r.raison], ['un dragon rouge', false, 'failed']);
  r = await avec({ text: 'un dragon rouge', translated: false, raison: 'failed' })({ text: 'un dragon rouge', from: 'fr' });
  assert.deepEqual([r.translated, r.raison], [false, 'failed']);
});

/** Corps postes par une methode appelee avec `args` (postJSON journalise). */
async function corpsPostes(nom, args) {
  const postes = [];
  const fenetre = {
    state: { currentProject: { name: 'P', assetType: 'character' } },
    meshyAPI: { renderMeshFront: async () => ({ ok: true, frontPath: 'https://r2.example/vue.png' }) },
    __meshyEmit() {},
  };
  const f = methode(nom, {
    window: fenetre,
    document: { getElementById: (id) => ({ value: id === 'ws-asset-type' ? 'character' : 'realistic', checked: true }) },
    ...(ASSAINIR ? { _assainirNegatifs: ASSAINIR } : {}),
    postJSON: async (url, corps) => { postes.push({ url, corps }); return { success: false, error: 'banc' }; },
    fetch: async (url, init) => { postes.push({ url, corps: JSON.parse(init.body) }); return { ok: false, status: 500, json: async () => ({ error: 'banc' }) }; },
    _projetAuLancement: (x) => x || 'P',
    pollPrediction: async () => ({ url: 'https://r2.example/m.glb' }),
  });
  await f(args);
  return postes;
}

const CAS = [
  ['img2img', { imagePath: 'https://r2.example/a.png', prompt: 'un casque rouge', strength: 0.5 }, '/api/modify-image'],
  ['autoInpaint', { imagePath: 'https://r2.example/a.png', targetText: 'le chapeau', prompt: 'une couronne', dilate: 15 }, '/api/auto-inpaint'],
  ['texVariant', { imagePath: 'https://r2.example/a.png', prompt: 'une armure dorée', strength: 0.5, seed: 1 }, '/api/tex-variant'],
  ['recolor', { imagePath: 'https://r2.example/a.png', prompt: 'la cape en rouge', strength: 1 }, '/api/recolor'],
  ['segmentMask', { imagePath: 'https://r2.example/a.png', targetText: 'le chapeau', dilate: 15 }, '/api/segment-preview'],
  ['maskInpaint', { imagePath: 'https://r2.example/a.png', maskDataUrl: 'data:image/png;base64,AAAA', prompt: 'une épée' }, '/api/mask-inpaint'],
  ['generateBackView', { frontImage: 'https://r2.example/a.png', promptHint: 'un chevalier', numImages: 1 }, '/api/generate-back-view'],
  ['reshapeRegion', { meshPath: 'https://r2.example/m.glb', frontPath: 'https://r2.example/v.png', maskDataUrl: 'data:image/png;base64,AAAA', prompt: 'une aile' }, '/api/mesh-reshape'],
  ['regionRetex', { meshPath: 'https://r2.example/m.glb', maskDataUrl: 'data:image/png;base64,AAAA', prompt: 'du cuir usé' }, '/api/mesh-region-retex'],
  ['meshTool', { operation: 'texture_var', meshPath: 'https://r2.example/m.glb', params: ['0.4', '42', 'rouillé'] }, '/api/mesh-texvar'],
  ['generateImages', { prompt: 'un orc', userPrompt: 'un orc', projectName: 'P', numImages: 1, steps: 30 }, '/api/generate-image'],
];

for (const [nom, args, route] of CAS) {
  test(`${nom} : « Envoyer tel quel » (langueVerifiee) atteint ${route} ; rien d invente sans lui`, async () => {
    const avec = await corpsPostes(nom, { ...args, langueVerifiee: true });
    const p = avec.find((x) => String(x.url).endsWith(route));
    assert.ok(p, `${nom} n a rien poste vers ${route} : ${JSON.stringify(avec.map((x) => x.url))}`);
    assert.equal(p.corps.langueVerifiee, true, `${route} : le choix de l utilisateur est perdu, le filet du serveur refuserait le texte`);
    const sans = await corpsPostes(nom, args);
    const q = sans.find((x) => String(x.url).endsWith(route));
    assert.ok(q && !('langueVerifiee' in q.corps));
  });
}
