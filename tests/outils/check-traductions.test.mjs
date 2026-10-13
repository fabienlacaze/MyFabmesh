// Garde des traductions (lot interface multilingue, 2026-10-13 ; constats INTERFACE-02, -07, -15, M01, M06).
// Faux depots minimaux sous le dossier temporaire : chaque regle du garde doit REFUSER la construction quand elle est
// enfreinte, et le vrai depot doit passer. Lancer : node --test tests/outils/check-traductions.test.mjs
// Preuve sur l'ancien code : GARDE_RACINE=<copie de HEAD> node --test tests/outils/check-traductions.test.mjs
// (le test « le depot reel passe » echoue sur HEAD : derive, ecrans prioritaires, selecteur traduit, seuils absents).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifier, gabaritCasse, zoneHtml, doublonsContradictoires, seuilsAtteints } from '../../build/check-traductions.mjs';
import { libellesJs } from '../../build/couverture-traductions.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(RACINE, 'build', 'check-traductions.mjs');
const I18N_MIN = "(function(){ const I18N = { fr: {} }; window.FabI18n = { register(){}, applyLang(){}, t(s){return s;} }; }());";

/** Faux depot : deux cibles avec index HTML, dictionnaires par langue. `dicos` : { bureau: { fr: {...} }, web: {...} }. */
function fauxDepot({ htmlBureau, htmlWeb, dicos, js = {}, coque = null }) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'garde-trad-'));
  const cibles = { bureau: ['src/renderer', 'index2.html', htmlBureau], web: ['cloud/public/app', 'index.html', htmlWeb] };
  for (const [nom, [dossier, page, html]] of Object.entries(cibles)) {
    const base = path.join(d, dossier);
    fs.mkdirSync(path.join(base, 'lang'), { recursive: true });
    fs.writeFileSync(path.join(base, page), html);
    fs.writeFileSync(path.join(base, 'i18n.js'), I18N_MIN);
    for (const [L, carte] of Object.entries((dicos[nom]) || {})) {
      fs.writeFileSync(path.join(base, 'lang', L + '.js'), 'window.FabI18n.register(' + JSON.stringify(L) + ', ' + JSON.stringify(carte) + ');');
    }
    if (js[nom]) fs.writeFileSync(path.join(base, 'index2.js'), js[nom]);
  }
  fs.mkdirSync(path.join(d, 'build'), { recursive: true });
  if (coque) {
    fs.mkdirSync(path.join(d, 'cloud/src/lib'), { recursive: true });
    fs.mkdirSync(path.join(d, 'cloud/src/components'), { recursive: true });
    fs.writeFileSync(path.join(d, 'cloud/src/components/Nav.tsx'), coque.tsx);
    fs.writeFileSync(path.join(d, 'cloud/src/lib/coque-traductions.json'), JSON.stringify(coque.dico));
  }
  return d;
}
const tout = (cartes) => Object.fromEntries(['fr', 'es', 'zh', 'hi', 'ar'].map((L) => [L, cartes(L)]));
const SELECT_OK = '<select id="lang-select" translate="no"><option value="en">English</option></select>';

test('regle « derive » : un libelle commun aux deux interfaces, traduit d un seul cote, est refuse', () => {
  const html = '<b>Save</b><b>Open</b>' + SELECT_OK;
  const d = fauxDepot({
    htmlBureau: html, htmlWeb: html,
    dicos: { bureau: tout((L) => ({ Save: 'S-' + L, Open: 'O-' + L })), web: tout((L) => ({ Save: 'S-' + L })) },
  });
  const { erreurs } = verifier(d, { seuils: null });
  assert.ok(erreurs.some((e) => /derive web\/bureau \(fr\)/.test(e) && /Open/.test(e)), erreurs.join('\n'));
});

test('regle « couverture » : passer sous le seuil enregistre est refuse ; au seuil, accepte', () => {
  const html = '<b>Save</b><b>Open</b>' + SELECT_OK;
  const d = fauxDepot({ htmlBureau: html, htmlWeb: html, dicos: { bureau: tout(() => ({ Save: 'x' })), web: tout(() => ({ Save: 'x' })) } });
  const ok = verifier(d, { seuils: { bureau: { fr: 50 }, web: { fr: 50 } } });
  assert.deepEqual(ok.erreurs.filter((e) => /couverture/.test(e)), []);
  const ko = verifier(d, { seuils: { bureau: { fr: 50.1 }, web: { fr: 100 } } });
  assert.equal(ko.erreurs.filter((e) => /^couverture (bureau|web)\/fr/.test(e)).length, 2, ko.erreurs.join('\n'));
});

test('regle « ecrans prioritaires » : un libelle du formulaire de signalement non traduit dans une langue est refuse', () => {
  const html = '<div id="modal-report"><h2>Report content</h2><label>Reason</label></div>' + SELECT_OK;
  const sauf = (L) => (L === 'hi' ? { 'Report content': 'R' } : { 'Report content': 'R', Reason: 'M' });
  const d = fauxDepot({ htmlBureau: html, htmlWeb: html, dicos: { bureau: tout(sauf), web: tout(sauf) } });
  const { erreurs } = verifier(d, { seuils: null });
  assert.ok(erreurs.some((e) => /signalement de contenu IA/.test(e) && /"Reason" non traduit en hi/.test(e)), erreurs.join('\n'));
});

test('regle « gabarit » : marques {x}/{y} perdues, ajoutees ou INTERVERTIES (tf remplit dans l ordre) refusees', () => {
  assert.equal(gabaritCasse('Delete {x}?', 'Supprimer ?'), true);
  assert.equal(gabaritCasse('{x} of {y} GB used', '{y} में से {x}'), true, 'ordre interverti');
  assert.equal(gabaritCasse('{x} of {y} GB used', '{x} / {y} GB'), false);
  assert.equal(gabaritCasse('{x} project{x} selected', '已选择 {x} 个项目'), false, 'astuce de pluriel : non verifiable');
  const html = '<b>Hi</b>' + SELECT_OK;
  const d = fauxDepot({ htmlBureau: html, htmlWeb: html, dicos: { bureau: tout(() => ({ Hi: 'h', 'A {x} B {y}': '{y} A {x}' })), web: tout(() => ({ Hi: 'h' })) } });
  assert.ok(verifier(d, { seuils: null }).erreurs.some((e) => /gabarit casse \(bureau\//.test(e)));
});

test('regle « doublons » : une cle traduite deux fois differemment est comptee, et le nombre ne peut pas monter', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'doublons-'));
  fs.writeFileSync(path.join(d, 'a.js'), "window.FabI18n.register('fr', { 'Back': 'Dos', 'Save': 'Enregistrer' });");
  fs.writeFileSync(path.join(d, 'b.js'), "window.FabI18n.register('fr', { 'Back': 'Arrière', 'Save': 'Enregistrer' });");
  fs.writeFileSync(path.join(d, 'c.js'), "(function(){ var T = { 'Back': ['Retour', null, null, null, null] }; })();");
  const r = doublonsContradictoires([path.join(d, 'a.js'), path.join(d, 'b.js'), path.join(d, 'c.js')]);
  assert.deepEqual(r.fr, ['Back']);
  const html = '<b>Back</b>' + SELECT_OK;
  const dep = fauxDepot({ htmlBureau: html, htmlWeb: html, dicos: { bureau: tout(() => ({ Back: 'x' })), web: tout(() => ({ Back: 'x' })) } });
  fs.writeFileSync(path.join(dep, 'src/renderer/lang/zz.js'), "window.FabI18n.register('fr', { 'Back': 'y' });");
  const { erreurs } = verifier(dep, { seuils: { doublons: { bureau: { fr: 0 } } } });
  assert.ok(erreurs.some((e) => /doublons contradictoires bureau\/fr : 1 > 0/.test(e)), erreurs.join('\n'));
});

test('regle « selecteur autonyme » : #lang-select sans translate="no" est refuse', () => {
  const d = fauxDepot({ htmlBureau: '<select id="lang-select"><option>English</option></select>', htmlWeb: SELECT_OK, dicos: {} });
  assert.ok(verifier(d, { seuils: null }).erreurs.some((e) => /selecteur de langue \(bureau\)/.test(e)));
});

test('regle « coque Next » : un texte <T> sans ses langues est compte, et refuse quand le seuil est 100 %', () => {
  const d = fauxDepot({
    htmlBureau: SELECT_OK, htmlWeb: SELECT_OK, dicos: {},
    coque: { tsx: '<T fr="Tarifs" en="Pricing" /> <T fr="Se connecter" en="Sign in" />', dico: { Pricing: { es: 'Precios', zh: '价格', hi: 'कीमतें', ar: 'الأسعار' }, 'Sign in': { es: 'Entrar' } } },
  });
  const { m, erreurs } = verifier(d, { seuils: { coque: { fr: 100, es: 100, zh: 100, hi: 100, ar: 100 } } });
  assert.equal(m.coque.libelles, 2);
  assert.equal(m.coque.langues.es.pourcent, 100);
  assert.equal(m.coque.langues.zh.pourcent, 50);
  assert.ok(erreurs.some((e) => /coque Next \(zh\)/.test(e) && /Sign in/.test(e)), erreurs.join('\n'));
});

test('regle « coque Next » : texte() / tr() / attributs dans tout ordre ; valeur, lien ou gras perdus refuses ; deux francais refuses', () => {
  const tsx = [
    '<T en="Sent to **{x}**." fr="Envoyé à **{x}**." vals={[e]} />',
    "<T\n  fr=\"Lire les [CGU](/legal/terms).\"\n  en=\"Read the [terms](/legal/terms).\"\n/>",
    "setError(texte('Too many attempts.', 'Trop de tentatives.'));",
    "title={tr('Close', 'Fermer')}",
    "aria-label={tr('Close', 'Clore')}",
  ].join('\n');
  const dico = {
    'Sent to **{x}**.': { es: 'Enviado a **{x}**.', zh: '已发送至 {x}。', hi: '**{x}** को भेजा गया।', ar: 'أُرسل إلى **{x}**.' },
    'Read the [terms](/legal/terms).': { es: 'Lee las [condiciones](/legal/terms).', zh: '阅读条款。', hi: '[शर्तें](/legal/terms) पढ़ें।', ar: 'اقرأ [الشروط](/legal/terms).' },
    'Too many attempts.': { es: 'Demasiados intentos.', zh: '尝试次数过多。', hi: 'बहुत ज़्यादा प्रयास।', ar: 'محاولات كثيرة جدًا.' },
    Close: { es: 'Cerrar', zh: '关闭', hi: 'बंद करें', ar: 'إغلاق' },
  };
  const d = fauxDepot({ htmlBureau: SELECT_OK, htmlWeb: SELECT_OK, dicos: {}, coque: { tsx, dico } });
  const { m, erreurs } = verifier(d, { seuils: { coque: { fr: 100, es: 100, zh: 100, hi: 100, ar: 100 } } });
  assert.equal(m.coque.libelles, 4, [...m.coque.manquants.es].join(','));
  assert.ok(erreurs.some((e) => /perdent ou ajoutent/.test(e) && /zh : "Sent to/.test(e)), 'gras perdu (zh) : ' + erreurs.join('\n'));
  assert.ok(erreurs.some((e) => /zh : "Read the \[terms\]/.test(e)), 'lien perdu (zh)');
  assert.ok(!erreurs.some((e) => /es : "Sent to/.test(e)), 'espagnol correct');
  assert.ok(erreurs.some((e) => /deux francais differents/.test(e) && /"Close"/.test(e)), 'Fermer / Clore');
});

test('mesure : les gabarits « Action failed: » + detail entrent dans l univers (lib/textes-serveur.js les cherche)', () => {
  const j = libellesJs("showToast('Export failed: ' + e.message, 'error'); showToast(`Save failed: ${e}`); showToast('Done: ' + x + '!');");
  assert.ok(j.has('Export failed: {x}'));
  assert.ok(j.has('Save failed: {x}'));
  assert.ok(!j.has('Done: {x}!'));
  assert.ok(zoneHtml('<div id="a"><div>x</div><span>y</span></div><p>z</p>', 'a').endsWith('</span></div>'));
});

test('le depot reel passe le garde (seuils, derive, ecrans prioritaires, gabarits, doublons, selecteur, coque)', () => {
  const racine = process.env.GARDE_RACINE || RACINE;
  const r = spawnSync(process.execPath, [SCRIPT, '--racine', racine], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + '\n' + r.stderr);
  // et la couverture reste au moins celle enregistree
  const s = JSON.parse(fs.readFileSync(path.join(racine, 'build', 'traductions-seuils.json'), 'utf8'));
  const { m } = verifier(racine, { seuils: s });
  const atteints = seuilsAtteints(m);
  for (const c of ['bureau', 'web']) for (const L of ['fr', 'es', 'zh', 'hi', 'ar']) assert.ok(atteints[c][L] >= s[c][L], c + '/' + L);
});
