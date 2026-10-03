// Test du rendu des pages legales (constats F1, F8, IA-09, D-08 du 2026-10-03).
// Transpile les VRAIS composants de src/app/legal, les rend en HTML (react-dom/server) et verifie :
//  - aucun marqueur « a completer » n'arrive au visiteur, bandeau « phase de test » present ;
//  - les CGU ne promettent plus « vous appartient » ni « autorisent tous l'usage commercial » ;
//  - la politique de confidentialite nomme les sous-traitants reels et les durees.
// Lancer : cd cloud && node --test tests/legal-affichage.test.mjs
// Pour rejouer contre un ancien arbre (preuve que le test echoue sur l'ancien code) :
//   LEGAL_SRC_ROOT=<dossier contenant app/legal et config/> node --test tests/legal-affichage.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const RACINE = process.env.LEGAL_SRC_ROOT || fileURLToPath(new URL('../src', import.meta.url));
const cache = new Map();

function resoudre(depuis, spec) {
  let base;
  if (spec.startsWith('@/')) base = path.join(RACINE, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(depuis), spec);
  else return null;
  for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) if (existsSync(base + ext) && /\.tsx?$/.test(base + ext)) return base + ext;
  throw new Error('module introuvable : ' + spec + ' depuis ' + depuis);
}
function charger(fichier) {
  if (cache.has(fichier)) return cache.get(fichier).exports;
  const code = ts.transpileModule(readFileSync(fichier, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const mod = { exports: {} };
  cache.set(fichier, mod);
  const req = (spec) => { const r = resoudre(fichier, spec); return r ? charger(r) : require(spec); };
  new Function('require', 'module', 'exports', code)(req, mod, mod.exports);
  return mod.exports;
}
const rendre = (rel, nom) => renderToStaticMarkup(React.createElement(charger(path.join(RACINE, rel))[nom]));

const PAGES = [
  ['app/legal/mentions/MentionsFr.tsx', 'MentionsFr', 'fr'], ['app/legal/mentions/MentionsEn.tsx', 'MentionsEn', 'en'],
  ['app/legal/terms/TermsFr.tsx', 'TermsFr', 'fr'], ['app/legal/terms/TermsEn.tsx', 'TermsEn', 'en'],
  ['app/legal/privacy/PrivacyFr.tsx', 'PrivacyFr', 'fr'], ['app/legal/privacy/PrivacyEn.tsx', 'PrivacyEn', 'en'],
];

for (const [rel, nom, langue] of PAGES) {
  test(`${nom} : aucun marqueur a completer visible`, () => {
    const html = rendre(rel, nom);
    assert.ok(!/COMPL[ÉE]TER/i.test(html), 'marqueur visible dans ' + nom);
  });
  test(`${nom} : bandeau phase de test avec le contact public`, () => {
    const html = rendre(rel, nom);
    assert.match(html, langue === 'fr' ? /Service en phase de test/ : /Service in test phase/);
    assert.match(html, /myfabmesh\.contact@gmail\.com/);
  });
}

test('CGU : plus de promesse generale de propriete ni d usage commercial', () => {
  const fr = rendre('app/legal/terms/TermsFr.tsx', 'TermsFr');
  const en = rendre('app/legal/terms/TermsEn.tsx', 'TermsEn');
  assert.ok(!/Ce que vous générez<\/strong> vous appartient/.test(fr));
  assert.ok(!/autorisent tous/.test(fr));
  assert.match(fr, /sous réserve des licences des modèles utilisés/);
  assert.match(fr, /ne garantissons pas qu.elles soient protégeables par le droit d.auteur ni exemptes de droits de tiers/);
  assert.ok(!/all currently permit commercial use/.test(en));
  assert.match(en, /subject to the licences of the models used/);
  assert.match(en, /do not guarantee that they are protectable by copyright or free of third-party rights/);
});

test('Confidentialite : sous-traitants, administrateur, formulaires, sauvegardes, date', () => {
  for (const [rel, nom, mots] of [
    ['app/legal/privacy/PrivacyFr.tsx', 'PrivacyFr', [/Brevo/, /Resend/, /Workers AI/, /unpkg\.com/, /administrateur du service peut consulter/, /12 mois/, /14 jours/, /2026-10-03/]],
    ['app/legal/privacy/PrivacyEn.tsx', 'PrivacyEn', [/Brevo/, /Resend/, /Workers AI/, /unpkg\.com/, /administrator\s+can view/, /12 months/, /14 days/, /2026-10-03/]],
  ]) {
    const html = rendre(rel, nom);
    for (const m of mots) assert.match(html, m, nom + ' : ' + m);
  }
});

test('Confidentialite : aucune garantie de transfert affirmee', () => {
  const html = rendre('app/legal/privacy/PrivacyFr.tsx', 'PrivacyFr') + rendre('app/legal/privacy/PrivacyEn.tsx', 'PrivacyEn');
  assert.ok(!/Data Privacy Framework/i.test(html), 'DPF ne doit pas etre affirme');
  assert.ok(!/nous n.affirmons pas.*certifi/i.test(html));
});
