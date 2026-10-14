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
import {
  libellesJs, libellesHtml, estTraduisible, valeurDe, CIBLES, fichiersCible, libellesCible, chargerDictionnaires,
} from '../../build/couverture-traductions.mjs';

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

/* ── Revue du lot (2026-10-14) : bloquants B1 (placeholder d'un textarea) et B2 (textes de plus de 200 caracteres),
 *    reproduits par les mutations M3 et M2 de la revue (C:/tmp/revue_interface_cas/mutations), qui laissaient la garde a 0. */
const CENT = Object.fromEntries(['fr', 'es', 'zh', 'hi', 'ar'].map((L) => [L, 100]));

test('mesure : les ATTRIBUTS d un <textarea>, <pre>, <code>, <svg> sont mesures, pas leur contenu (bloquant B1)', () => {
  const h = libellesHtml('<textarea id="rp" rows="4" placeholder="What is wrong with this result?">raw prompt text</textarea>'
    + '<code title="Copy this code">let x = 1</code><svg aria-label="Close panel"><path d="M0 0"/></svg><p>Visible</p>');
  assert.deepEqual([...h.keys()].sort(), ['Close panel', 'Copy this code', 'Visible', 'What is wrong with this result?']);
});

test('regle « ecrans prioritaires » : le placeholder du formulaire de signalement non traduit est refuse (mutation M3)', () => {
  const html = '<div id="modal-report"><h2>Report content</h2>'
    + '<textarea id="rp-details" rows="4" placeholder="Describe precisely the harmful content you saw"></textarea></div>' + SELECT_OK;
  const sauf = (L) => (L === 'fr' ? { 'Report content': 'R', 'Describe precisely the harmful content you saw': 'D' } : { 'Report content': 'R' });
  const d = fauxDepot({ htmlBureau: html, htmlWeb: html, dicos: { bureau: tout(sauf), web: tout(sauf) } });
  const { erreurs } = verifier(d, { seuils: null });
  for (const cible of ['bureau', 'web']) {
    assert.ok(erreurs.some((e) => e.includes(`(${cible}) : "Describe precisely the harmful content you saw" non traduit en es, zh, hi, ar`)), erreurs.join('\n'));
  }
});

test('regle « couverture » : un texte de PLUS DE 200 caracteres non traduit fait baisser la couverture (mutation M2)', () => {
  const LONG = 'This brand new consent paragraph explains in detail what we collect, why we collect it, how long we keep it, who can read it, and how you can object to it at any time from the settings of your account, in plain words.';
  assert.ok(LONG.length > 200);
  assert.equal(estTraduisible(LONG), true, 'le plafond de 200 caracteres de la traduction AUTOMATIQUE ne s applique pas a la mesure');
  const html = '<b>Save</b><p>' + LONG + '</p>' + SELECT_OK;
  const d = fauxDepot({ htmlBureau: html, htmlWeb: html, dicos: { bureau: tout(() => ({ Save: 'x' })), web: tout(() => ({ Save: 'x' })) } });
  const { m, erreurs } = verifier(d, { seuils: { bureau: CENT, web: CENT } });
  assert.equal(m.cibles.web.couverture.es, 50);
  assert.ok(erreurs.some((e) => /^couverture web\/es : 50\.0 % < seuil 100 %/.test(e)), erreurs.join('\n'));
  assert.ok(erreurs.some((e) => /^couverture bureau\/ar : 50\.0 % < seuil 100 %/.test(e)), erreurs.join('\n'));
});

test('mesure : textes AFFECTES (textContent, title, placeholder, setAttribute) mesures ; feuille de style, document.title et autres attributs non', () => {
  const j = libellesJs("el.textContent = 'Sending your report…'; btn.title = ok ? 'Already published' : 'Publish it'; "
    + "x.setAttribute('aria-label', 'Inbox & contact us'); y.setAttribute('data-x', 'Not text'); st.textContent = '.a { color: red; }'; "
    + "document.title = 'Window title'; n.textContent = name || 'image'; z.className = 'Not a label'; w.placeholder = `Type here`;");
  assert.deepEqual([...j.keys()].sort(), ['Already published', 'Inbox & contact us', 'Publish it', 'Sending your report…', 'Type here', 'image'].sort());
  // et un tel texte sans traduction fait echouer la garde
  const d = fauxDepot({
    htmlBureau: '<b>Save</b>' + SELECT_OK, htmlWeb: '<b>Save</b>' + SELECT_OK,
    dicos: { bureau: tout(() => ({ Save: 'x' })), web: tout(() => ({ Save: 'x' })) },
    js: { web: "status.textContent = 'Sending your report…';" },
  });
  assert.ok(verifier(d, { seuils: { web: CENT } }).erreurs.some((e) => /^couverture web\/hi : 50\.0 %/.test(e)));
});

test('mesure : &nbsp; garde son caractere, et la recherche suit EXACTEMENT celle de i18n.js (_chercher)', () => {
  const k = [...libellesHtml('<div>reply within 48&nbsp;h</div>').keys()][0];
  assert.equal(k, 'reply within 48\u00a0h');
  assert.equal(valeurDe({ 'reply within 48 h': 'v' }, k), 'v', 'insecable ramenee a une espace, comme _chercher');
  assert.equal(valeurDe({ 'a b': 'v' }, 'a\n      b'), 'v');
  assert.equal(valeurDe({ 'a b': 'v' }, 'a  b'), 'v');
  assert.equal(valeurDe({ 'a b': 'v' }, 'a b'), 'v');
  assert.equal(valeurDe({ 'a  b': 'v' }, 'a b'), null, 'une cle a deux espaces ne peut pas etre trouvee par le navigateur');
});

test('depot reel : les textes cites par la revue sont MESURES et traduits dans les 5 langues, sur le web et le bureau', () => {
  const racine = process.env.GARDE_RACINE || RACINE;
  const COMMUNS = [
    'What is wrong with this result?',
    'Results are generated by AI models and may occasionally be inappropriate or inaccurate. If you see a generated result that should not have been produced, please tell us — reports are reviewed by an admin.',
    'Create game-ready 3D assets from a prompt or a picture: the image, a textured 3D model, an automatic rig for any body and animation (beta). Everything you generate stays editable with AI and manual tools. Export to Unreal, Blender, Unity or Godot.',
    'Sending your report…', 'Report sent. Thank you — an admin will review it.', 'Copy address', 'make it red, add details, anime style...',
  ];
  const PAR_CIBLE = {
    bureau: ['When the app hits an unexpected error, an anonymous report is sent to our error tracker (Sentry): the stack trace, the app version, the Windows version, and a random installation id. Your Windows username and machine name are removed first. No prompt, image or mesh is ever included.'],
    web: [
      "Off. Turn this on only if support asks you to: it sends this tab's console — including your prompts and project names — to MyFabmesh so a problem can be reproduced. Passwords, tokens and e-mail addresses are stripped before sending. Logs are deleted after 30 days. You can turn it back off at any time.",
      "Error reports: when an operation FAILS, the last 300 lines of this tab's console are sent so we can fix the problem — with your prompts, e-mail address, passwords and tokens removed. Nothing is sent when an operation succeeds. Deleted after 30 days. You can object by unticking the box.",
      'Inbox & contact us', 'Your current credit balance', 'MyFabmesh.AI website', '✓ Sellable by users', '✗ Not sellable by users',
    ],
  };
  for (const c of CIBLES) {
    const f = fichiersCible(racine, c);
    const libs = libellesCible(f);
    const vus = new Map([...libs.keys()].map((k) => [k.replace(/\s+/g, ' '), k]));
    const d = chargerDictionnaires({ i18n: f.i18n, dossierLang: f.dossierLang });
    for (const k of COMMUNS.concat(PAR_CIBLE[c.nom])) {
      assert.ok(vus.has(k), `${c.nom} : non mesure par la garde : ${k.slice(0, 60)}`);
      const manque = ['fr', 'es', 'zh', 'hi', 'ar'].filter((L) => !valeurDe(d[L], vus.get(k)));
      assert.deepEqual(manque, [], `${c.nom} : ${k.slice(0, 60)}`);
    }
    // la zone prioritaire du signalement contient bien le texte indicatif
    const html = f.html.map((p) => fs.readFileSync(p, 'utf8')).join('\n');
    assert.ok(libellesHtml(zoneHtml(html, 'modal-report')).has('What is wrong with this result?'), c.nom + ' : placeholder hors de la zone prioritaire');
  }
});
