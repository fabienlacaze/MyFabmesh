// Garde des traductions, point 8 (2026-10-24, correction des prompts, chantier B « aide de langue ») : les textes LIES AU PROMPT que la
// couverture ne voyait pas. Le garde annoncait 100 % alors que le sous-titre de « Texture variations » (un outil qui traduit un champ
// libre) et le refus du controle parental de New project (un gabarit `...${x}...` pose dans textContent : la cle du dictionnaire n'etait
// jamais cherchee) restaient en anglais dans les cinq langues.
// Lancer : node --test tests/outils/check-traductions-prompt.test.mjs
// Preuve sur l'ancien code : les cas « refuses » ci-dessous sont des fixtures qui reproduisent le defaut ; le cas « depot reel » echoue
// sur l'ancien garde (build/check-traductions.mjs d'origin/prompts-2410 n'exporte ni textesSchemasOutils ni gabaritsDirects).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifier, textesSchemasOutils, gabaritsDirects, clesPrompt } from '../../build/check-traductions.mjs';
import { CIBLES, fichiersCible, chargerDictionnaires, valeurDe } from '../../build/couverture-traductions.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LANGUES = ['fr', 'es', 'zh', 'hi', 'ar'];
const I18N_MIN = "(function(){ const I18N = { fr: {} }; window.FabI18n = { register(){}, applyLang(){}, t(s){return s;} }; }());";
const SELECT_OK = '<select id="lang-select" translate="no"><option value="en">English</option></select>';

function fauxDepot({ js, dico = {} }) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'garde-prompt-'));
  for (const [dossier, page] of [['src/renderer', 'index2.html'], ['cloud/public/app', 'index.html']]) {
    const base = path.join(d, dossier);
    fs.mkdirSync(path.join(base, 'lang'), { recursive: true });
    fs.writeFileSync(path.join(base, page), '<b>Save</b>' + SELECT_OK);
    fs.writeFileSync(path.join(base, 'i18n.js'), I18N_MIN);
    for (const L of LANGUES) {
      fs.writeFileSync(path.join(base, 'lang', L + '.js'), 'window.FabI18n.register(' + JSON.stringify(L) + ', ' + JSON.stringify({ Save: 'x', ...dico }) + ');');
    }
    fs.writeFileSync(path.join(base, 'index2.js'), js);
  }
  fs.mkdirSync(path.join(d, 'build'), { recursive: true });
  return d;
}
const filtre = (erreurs, re) => erreurs.filter((e) => re.test(e));

const SCHEMA_LIBRE = `const S = { texture_var: { title: 'Texture variations', subtitle: 'Regenerate ONLY the texture - never translated.',
  params: [{ id: 'style', label: 'Style (optional)', type: 'text', placeholder: 'rusty, golden' }], texteLibre: 'style' } };`;
const SCHEMA_SIMPLE = `const S = { watertight: { title: 'Watertight', subtitle: 'Make the mesh watertight - never translated.', params: [{ id: 'r', label: 'Resolution' }] } };`;

test('extraction : les textes d un schema d outil (titre, sous-titre, libelles, exemples) sont lus, `libre` marque le champ traduit', () => {
  const t = textesSchemasOutils(SCHEMA_LIBRE);
  assert.equal(t.get('Regenerate ONLY the texture - never translated.').libre, true);
  assert.equal(t.get('Regenerate ONLY the texture - never translated.').role, 'subtitle');
  assert.ok(t.has('Style (optional)') && t.has('rusty, golden') && t.has('Texture variations'));
  const s = textesSchemasOutils(SCHEMA_SIMPLE);
  assert.equal(s.get('Make the mesh watertight - never translated.').libre, false);
});

test('regle 8a : le sous-titre d un outil qui traduit un champ libre, sans traduction, est REFUSE ; traduit, accepte', () => {
  const d = fauxDepot({ js: SCHEMA_LIBRE });
  const { erreurs } = verifier(d, { seuils: null });
  const e = filtre(erreurs, /champ libre/);
  assert.ok(e.some((x) => /subtitle de « Texture variations » non traduit en fr, es, zh, hi, ar/.test(x)), erreurs.join('\n'));
  const dico = { 'Texture variations': 'T', 'Regenerate ONLY the texture - never translated.': 'R', 'Style (optional)': 'S', 'rusty, golden': 'r' };
  const ok = fauxDepot({ js: SCHEMA_LIBRE, dico });
  assert.deepEqual(filtre(verifier(ok, { seuils: null }).erreurs, /champ libre/), []);
});

test('regle 8a (cliquet) : les textes des AUTRES outils ne peuvent que baisser', () => {
  const d = fauxDepot({ js: SCHEMA_SIMPLE });
  assert.deepEqual(filtre(verifier(d, { seuils: null }).erreurs, /textes d'outils non traduits/), []);
  const e = filtre(verifier(d, { seuils: { schemas_non_traduits: { bureau: 0, web: 0 } } }).erreurs, /textes d'outils non traduits/);
  assert.equal(e.length, 2, e.join('\n'));   // bureau et web
  assert.deepEqual(filtre(verifier(d, { seuils: { schemas_non_traduits: { bureau: 3, web: 3 } } }).erreurs, /textes d'outils non traduits/), []);
});

test('extraction : un gabarit `...${x}...` pose DIRECTEMENT dans textContent est vu ; _i18nTf, toast court et phrase de moins de 4 mots, non', () => {
  const src = `
    el.textContent = \`Blocked: "\${blocked}" is not allowed with parental control active.\`;
    el.textContent = _i18nTf('Blocked: "{x}" is not allowed with parental control active.', blocked);
    el.title = \`Count: \${n}\`;
    showToast(\`Add back photo failed: \${e}\`, 'error');`;
  const g = gabaritsDirects(src);
  assert.deepEqual([...g.keys()], ['Blocked: "{x}" is not allowed with parental control active.']);
});

test('regle 8b : le refus du controle parental pose en gabarit direct est REFUSE au-dela du compte enregistre ; via _i18nTf, accepte', () => {
  const mauvais = fauxDepot({ js: 'const _msg = {}; _msg.textContent = `Blocked: "${blocked}" is not allowed with parental control active.`;' });
  const e = filtre(verifier(mauvais, { seuils: { gabarits_directs: { bureau: 0, web: 0 } } }).erreurs, /gabarits poses dans textContent/);
  assert.equal(e.length, 2, e.join('\n'));
  assert.match(e[0], /_i18nTf/);
  const bon = fauxDepot({ js: "const _msg = {}; _msg.textContent = _i18nTf('Blocked: \"{x}\" is not allowed with parental control active.', blocked);" });
  assert.deepEqual(filtre(verifier(bon, { seuils: { gabarits_directs: { bureau: 0, web: 0 } } }).erreurs, /gabarits poses dans textContent/), []);
});

test('regle 8c : une cle prompt.aide.* ecrite dans le code sans traduction dans les 5 langues est REFUSEE', () => {
  const js = "const a = dico('prompt.aide.trad', 'x'); const b = 'prompt.aide.angl';";
  assert.deepEqual(clesPrompt(js).sort(), ['prompt.aide.angl', 'prompt.aide.trad']);
  const d = fauxDepot({ js, dico: { 'prompt.aide.trad': 'T' } });
  const e = filtre(verifier(d, { seuils: null }).erreurs, /aide de langue/);
  assert.ok(e.some((x) => /prompt\.aide\.angl/.test(x) && /fr, es, zh, hi, ar/.test(x)), e.join('\n'));
  assert.ok(!e.some((x) => /prompt\.aide\.trad/.test(x)), 'la cle traduite n est pas refusee');
});

test('depot reel : les cles prompt.aide.*, le sous-titre de Texture variations et le refus parental sont traduits dans les 5 langues, bureau ET site', () => {
  const cles = ['prompt.aide.trad', 'prompt.aide.angl',
    'Translates your text to English if needed, keeps all your words, and adds the asset type and style keywords around them',
    'Regenerate ONLY the texture — geometry & UVs stay exactly the same. Change the Variation seed for a different look; raise Strength for a bigger change. Add a Style word (rusty, golden, camo…) to steer it. ~1–3 min.',
    'Blocked: "{x}" is not allowed with parental control active. Unlock to disable the content filter.'];
  for (const c of CIBLES) {
    const f = fichiersCible(RACINE, c);
    const dicts = chargerDictionnaires({ i18n: f.i18n, dossierLang: f.dossierLang });
    for (const k of cles) for (const L of LANGUES) assert.ok(valeurDe(dicts[L], k), `${c.nom}/${L} : ${k.slice(0, 60)}`);
  }
  const { erreurs } = verifier(RACINE, { seuils: JSON.parse(fs.readFileSync(path.join(RACINE, 'build', 'traductions-seuils.json'), 'utf8')) });
  assert.deepEqual(erreurs, []);
});
