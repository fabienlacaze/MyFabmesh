// OUTILS D'IMAGE DU BUREAU EN MODE CLOUD : « Envoyer tel quel » doit atteindre le serveur (24/10, audit des prompts, B1).
// Cause : apres un echec de traduction, la fenetre propose « Reessayer / Envoyer tel quel / Annuler ». Le renderer posait le choix
// (langueVerifiee) mais les gestionnaires de main.js ne le lisaient pas : le serveur recevait le texte non traduit SANS le drapeau et
// le refusait (422) en boucle. Ces tests executent les VRAIS gestionnaires IPC de src/main/main.js (extraits avec acorn), doublures seulement.
// Lancer : node --test tests/main/langue-outils-cloud.test.mjs
// Ancien code : MAIN_JS=<copie de main.js de prompts-2410> node --test tests/main/langue-outils-cloud.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';

const ici = path.dirname(fileURLToPath(import.meta.url));
const MAIN_JS = process.env.MAIN_JS || path.join(ici, '..', '..', 'src', 'main', 'main.js');
const src = fs.readFileSync(MAIN_JS, 'utf-8');
const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true, allowHashBang: true });

/** Fonction du gestionnaire ipcMain.handle(<canal>, <fonction>) : { code, params }. */
function gestionnaire(canal) {
  for (const n of ast.body) {
    if (n.type !== 'ExpressionStatement' || n.expression.type !== 'CallExpression') continue;
    const c = n.expression;
    if (c.callee.type === 'MemberExpression' && c.callee.object.name === 'ipcMain' && c.callee.property.name === 'handle'
        && c.arguments[0] && c.arguments[0].value === canal) {
      const f = c.arguments[1];
      return { code: src.slice(f.start, f.end), params: f.params };
    }
  }
  return null;
}

/** Execute le gestionnaire avec des doublures : tout nom inconnu est une fonction muette. */
function executer(canal, args, doublures) {
  const g = gestionnaire(canal);
  assert.ok(g, `gestionnaire '${canal}' introuvable`);
  const muet = () => new Proxy(function () {}, { get: () => muet(), apply: () => undefined });
  const portee = new Proxy(doublures, {
    has: () => true,
    get: (cible, nom) => {
      if (typeof nom !== 'string') return undefined;
      if (nom in cible) return cible[nom];
      if (nom in globalThis) return globalThis[nom];
      return muet();
    },
  });
  // eslint-disable-next-line no-new-func
  const f = new Function('__portee', 'with (__portee) { return (' + g.code + '); }')(portee);
  return f({}, args);
}

function doubluresCloud(captures) {
  return {
    path, os: { tmpdir: () => '/tmp', homedir: () => '/h' },
    fs: { existsSync: () => true, statSync: () => ({ size: 10 }), mkdirSync: () => {}, readFileSync: () => Buffer.from('x'), writeFileSync: () => {} },
    isCloudMode: () => true,
    isPathAllowed: () => true,
    refusTexteOutil: () => null,
    checkPromptSafety: () => ({ safe: true }),
    checkPromptSafetyAI: async () => ({ safe: true }),
    safeBase: (s) => s,
    safeSend: () => {},
    cloudFallback: {
      imageOp: async (o) => { captures.push({ via: 'imageOp', endpoint: o.endpoint, corps: o.extraBody }); return { success: true, newPath: '/x.png' }; },
      atlasOp: async (o) => { captures.push({ via: 'atlasOp', endpoint: o.endpoint, corps: o.champs }); return { success: true, newPath: '/x.glb' }; },
    },
    _localPyLibsUsable: () => true,
    SCRIPTS_DIR: '/scripts',
  };
}

const IMG = '/p/a.png';
const OUTILS_IMAGE = [
  ['mask-inpaint', { imagePath: IMG, maskDataUrl: 'data:image/png;base64,AAAA', prompt: 'un casque rouge' }, '/api/mask-inpaint'],
  ['tex-variant', { imagePath: IMG, prompt: 'une armure doree', strength: 0.5 }, '/api/tex-variant'],
  ['recolor', { imagePath: IMG, prompt: 'le casque rouge' }, '/api/recolor'],
  ['auto-inpaint', { imagePath: IMG, targetText: 'le casque', prompt: 'un chapeau' }, '/api/auto-inpaint'],
  ['img2img', { imagePath: IMG, prompt: 'plus sombre', strength: 0.5, engine: 'local-sdxl' }, '/api/modify-image'],
];

for (const [canal, args, endpoint] of OUTILS_IMAGE) {
  test(`${canal} (mode Cloud) : langueVerifiee atteint le serveur, rien d'invente sans lui`, async () => {
    const h = gestionnaire(canal);
    assert.ok(h, `gestionnaire ${canal} introuvable`);
    const lus = h.params[1].properties.map((p) => p.key.name);
    assert.ok(lus.includes('langueVerifiee'), `${canal} ne lit pas langueVerifiee envoye par l'interface`);
    const avec = [];
    await executer(canal, { ...args, langueVerifiee: true }, doubluresCloud(avec));
    assert.equal(avec.length, 1, `${canal} : un appel au serveur`);
    assert.equal(avec[0].endpoint, endpoint);
    assert.equal(avec[0].corps.langueVerifiee, true, `${canal} : « Envoyer tel quel » doit etre transmis, sinon le filet du serveur refuse en boucle`);
    const sans = [];
    await executer(canal, { ...args }, doubluresCloud(sans));
    assert.equal(sans.length, 1);
    assert.ok(!('langueVerifiee' in sans[0].corps), `${canal} : sans choix de l'utilisateur, aucun drapeau`);
    const faux = [];
    await executer(canal, { ...args, langueVerifiee: 'oui' }, doubluresCloud(faux));
    assert.ok(!('langueVerifiee' in faux[0].corps), `${canal} : seul true strict est transmis`);
  });
}

test('mesh:region-retex (mode Cloud) : langueVerifiee atteint /api/mesh-region-retex', async () => {
  const base = { meshPath: '/p/m.glb', maskDataUrl: 'data:image/png;base64,AAAA', prompt: 'du cuir use', strength: 0.8, uvMask: true };
  const avec = [];
  await executer('mesh:region-retex', { ...base, langueVerifiee: true }, doubluresCloud(avec));
  assert.equal(avec.length, 1);
  assert.equal(avec[0].endpoint, '/api/mesh-region-retex');
  assert.equal(avec[0].corps.langueVerifiee, true);
  const sans = [];
  await executer('mesh:region-retex', base, doubluresCloud(sans));
  assert.ok(!('langueVerifiee' in sans[0].corps));
});

test('mesh-tool texture_var (mode Cloud) : langueVerifiee atteint /api/mesh-texvar', async () => {
  const h = gestionnaire('mesh-tool');
  assert.ok(h.params[1].properties.map((p) => p.key.name).includes('langueVerifiee'), 'mesh-tool ne lit pas langueVerifiee');
  const base = { operation: 'texture_var', meshPath: '/p/m.glb', params: ['0.4', '3', 'rouille et or'], namedParams: null };
  const avec = [];
  await executer('mesh-tool', { ...base, langueVerifiee: true }, doubluresCloud(avec));
  assert.equal(avec.length, 1, JSON.stringify(avec));
  assert.equal(avec[0].endpoint, '/api/mesh-texvar');
  assert.equal(avec[0].corps.langueVerifiee, true);
  assert.equal(avec[0].corps.style, 'rouille et or');
  const sans = [];
  await executer('mesh-tool', base, doubluresCloud(sans));
  assert.ok(!('langueVerifiee' in sans[0].corps));
});
