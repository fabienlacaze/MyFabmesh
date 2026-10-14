// Langue de l'interface (lot « interface multilingue », 2026-10-13) — constats INTERFACE-05, -08, -10, -14, -16, M04, M05, M06, M07
// de l'audit du 11/10/2026. Execute le VRAI i18n.js du WEB et du BUREAU (texte d'execution commun) dans un DOM minimal
// (tests/_dom-minimal.mjs) : aucun navigateur, aucun reseau.
// Lancer : cd cloud && node --test tests/langue-interface.test.mjs
// Preuve sur l'ancien code : I18N_WEB=<i18n.js de HEAD> I18N_BUREAU=<i18n.js du bureau de HEAD> node --test tests/langue-interface.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { creerPage } from './_dom-minimal.mjs';

const lire = (p) => readFileSync(p, 'utf8');
const FICHIERS = {
  web: process.env.I18N_WEB || new URL('../public/app/i18n.js', import.meta.url),
  bureau: process.env.I18N_BUREAU || new URL('../../src/renderer/i18n.js', import.meta.url),
};
const SOURCES = { web: lire(FICHIERS.web), bureau: lire(FICHIERS.bureau) };
const FSI = '\u2068';
const PDI = '\u2069';

const SELECT = `<div id="reglages"><label for="lang-select">Interface language</label>
  <img id="lang-flag" alt="">
  <select id="lang-select"><option value="en">English</option><option value="zh">中文</option><option value="hi">हिन्दी</option>
  <option value="es">Español</option><option value="fr">Français</option><option value="ar">العربية</option></select></div>`;

// Dictionnaires d'essai (les vrais sont mesures par build/check-traductions.mjs).
const DICOS = {
  fr: { English: 'Anglais', Close: 'Fermer', 'Search projects...': 'Rechercher des projets...', Settings: 'Paramètres', 'Subsequent runs are much faster.': 'Les lancements suivants sont bien plus rapides.', 'Delete project «{x}»?': 'Supprimer le projet «{x}» ?', 'Language: {x}': 'Langue : {x}' },
  es: { English: 'Inglés', Close: 'Cerrar', Settings: 'Ajustes', 'MyFabmesh is not available in {x} yet: the interface is shown in {y}.': 'MyFabmesh aún no está disponible en {x}: la interfaz se muestra en {y}.', 'Change language': 'Cambiar idioma' },
  zh: { English: '英语' },
  hi: { English: 'अंग्रेज़ी' },
  ar: { English: 'الإنجليزية', Close: 'إغلاق', Settings: 'الإعدادات', 'Delete project «{x}»?': 'حذف المشروع «{x}»؟' },
};
const enregistrer = (dicos) => Object.entries(dicos).map(([l, d]) => `window.FabI18n.register(${JSON.stringify(l)}, ${JSON.stringify(d)});`).join('\n');

/** Page chargee : i18n.js de la cible, dictionnaires d'essai, DOMContentLoaded. */
function page(cible, { html = SELECT, langues = ['en-US'], stockage = {}, dicos = DICOS, avant = null } = {}) {
  const p = creerPage({ html, langues, stockage });
  if (avant) avant(p);
  p.executer(SOURCES[cible], 'i18n.js');
  p.executer(enregistrer(dicos), 'lang.js');
  p.charger();
  return p;
}
const I18N = (p) => p.fenetre.FabI18n;
const optionsMenu = (p, n = 0) => p.document.querySelectorAll('[role="listbox"]')[n].querySelectorAll('[role="option"]');
const boutonMenu = (p, n = 0) => p.document.querySelectorAll('button[aria-haspopup="listbox"]')[n];

for (const cible of ['web', 'bureau']) {
  test(`${cible} : le menu de langue garde les noms AUTONYMES (English ne devient pas « Inglés ») et #lang-select porte translate="no"`, async () => {
    const p = page(cible, { stockage: { 'fabmesh.lang.choisi': 'es' } });
    await p.attendre();
    assert.equal(I18N(p).lang, 'es');
    const noms = optionsMenu(p).map((o) => o.textContent.trim());
    assert.deepEqual(noms, ['English', '中文', 'हिन्दी', 'Español', 'Français', 'العربية']);
    assert.equal(p.document.getElementById('lang-select').getAttribute('translate'), 'no');
  });

  test(`${cible} : le menu de langue s'utilise au CLAVIER (Entree ouvre, fleche bas, Entree choisit) et annonce son etat (ARIA)`, async () => {
    const p = page(cible, { stockage: { 'fabmesh.lang.choisi': 'en' } });
    const b = boutonMenu(p);
    assert.ok(b, 'bouton aria-haspopup="listbox" absent');
    assert.equal(b.getAttribute('aria-expanded'), 'false');
    b.dispatchEvent(new p.fenetre.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    assert.equal(b.getAttribute('aria-expanded'), 'true');
    const liste = p.document.getElementById(b.getAttribute('aria-controls'));
    assert.equal(liste.getAttribute('role'), 'listbox');
    assert.equal(p.document.activeElement, liste, 'le focus passe dans la liste');
    // en -> zh -> hi -> es -> fr : quatre fois vers le bas
    for (let i = 0; i < 4; i++) p.clavier(liste, 'ArrowDown');
    assert.equal(liste.getAttribute('aria-activedescendant'), liste.id + '-fr');
    p.clavier(liste, 'Enter');
    assert.equal(I18N(p).lang, 'fr');
    assert.equal(p.stockage.get('fabmesh.lang.choisi'), 'fr', 'le choix au clavier est un choix EXPLICITE');
    assert.equal(b.getAttribute('aria-expanded'), 'false');
    assert.equal(p.document.activeElement, b, 'le focus revient au bouton');
    assert.equal(optionsMenu(p).find((o) => o.dataset.lang === 'fr').getAttribute('aria-selected'), 'true');
    // Echap ferme sans changer
    p.clavier(b, 'ArrowDown');
    p.clavier(liste, 'End');
    p.clavier(liste, 'Escape');
    assert.equal(I18N(p).lang, 'fr');
    assert.equal(b.getAttribute('aria-expanded'), 'false');
  });

  test(`${cible} : un acces direct a la langue existe HORS des Reglages (hote [data-fab-lang] de la barre du haut)`, async () => {
    const p = page(cible, { html: SELECT + '<header id="topbar"><span id="topbar-lang" data-fab-lang></span></header>', stockage: { 'fabmesh.lang.choisi': 'en' } });
    const hote = p.document.getElementById('topbar-lang');
    const b = hote.querySelector('button');
    assert.ok(b, 'aucun bouton de langue dans la barre du haut');
    assert.equal(b.getAttribute('aria-haspopup'), 'listbox');
    assert.match(b.getAttribute('aria-label'), /English/);
    b.click();
    optionsMenu(p, 1).find((o) => o.dataset.lang === 'ar').click();
    assert.equal(I18N(p).lang, 'ar');
    assert.equal(p.document.documentElement.getAttribute('dir'), 'rtl');
    assert.equal(p.document.getElementById('lang-select').value, 'ar', 'le select des Reglages suit');
  });

  test(`${cible} : changer de langue passe par l'API PUBLIQUE FabI18n.applyLang (l'enveloppe d'index2.js rejoue les noms accessibles)`, async () => {
    const p = page(cible, { stockage: { 'fabmesh.lang.choisi': 'en' } });
    const appels = [];
    const origine = I18N(p).applyLang;
    I18N(p).applyLang = function (l) { appels.push(l); return origine.apply(this, arguments); };
    const sel = p.document.getElementById('lang-select');
    sel.value = 'fr';
    sel.dispatchEvent(new p.fenetre.Event('change'));
    assert.deepEqual(appels, ['fr']);
    assert.equal(I18N(p).lang, 'fr');
  });

  test(`${cible} : un attribut a icone de tete est traduit comme un noeud texte (« 🔍 Search projects... »)`, async () => {
    const p = page(cible, { html: SELECT + '<input id="recherche" placeholder="&#128269; Search projects...">', stockage: { 'fabmesh.lang.choisi': 'fr' } });
    assert.equal(p.document.getElementById('recherche').getAttribute('placeholder'), '🔍 Rechercher des projets...');
  });

  test(`${cible} : le contenu de l'utilisateur n'est jamais traduit (data-i18n-skip, translate="no") — un projet nomme « Settings »`, async () => {
    const p = page(cible, { html: SELECT + '<div class="project-card-name" translate="no">Settings</div><div id="journal" data-i18n-skip><span>Close</span></div><p id="libre">Settings</p>', stockage: { 'fabmesh.lang.choisi': 'fr' } });
    assert.equal(p.document.querySelector('.project-card-name').textContent, 'Settings');
    assert.equal(p.document.getElementById('journal').textContent, 'Close');
    assert.equal(p.document.getElementById('libre').textContent, 'Paramètres', 'le reste est traduit');
    // un texte AJOUTE plus tard dans un element protege ne l'est pas non plus
    p.document.querySelector('.project-card-name').textContent = 'Close';
    await p.attendre();
    assert.equal(p.document.querySelector('.project-card-name').textContent, 'Close');
  });

  test(`${cible} : arabe — un texte reste anglais est ISOLE (FSI … PDI) et les valeurs inserees par tf() aussi ; retour en anglais = texte d'origine`, async () => {
    const p = page(cible, { html: SELECT + '<span id="pas">30 steps · Medium</span><span id="ok">Close</span>', stockage: { 'fabmesh.lang.choisi': 'ar' } });
    assert.equal(p.document.getElementById('pas').textContent, FSI + '30 steps · Medium' + PDI);
    assert.equal(p.document.getElementById('ok').textContent, 'إغلاق', 'un texte traduit n est pas isole');
    assert.equal(I18N(p).tf('Delete project «{x}»?', 'orc'), 'حذف المشروع «' + FSI + 'orc' + PDI + '»؟');
    I18N(p).applyLang('en');
    assert.equal(p.document.getElementById('pas').textContent, '30 steps · Medium');
    assert.equal(I18N(p).tf('Delete project «{x}»?', 'orc'), 'Delete project «orc»?');
  });

  test(`${cible} : arabe — les champs de saisie recoivent dir="auto" (prompt anglais lisible), retire en anglais`, async () => {
    const p = page(cible, { html: SELECT + '<textarea id="ws-prompt"></textarea><input id="nom" type="text"><input id="fixe" type="text" dir="ltr"><input id="case" type="checkbox">', stockage: { 'fabmesh.lang.choisi': 'ar' } });
    assert.equal(p.document.getElementById('ws-prompt').getAttribute('dir'), 'auto');
    assert.equal(p.document.getElementById('nom').getAttribute('dir'), 'auto');
    assert.equal(p.document.getElementById('fixe').getAttribute('dir'), 'ltr', 'un dir pose par la page est respecte');
    assert.equal(p.document.getElementById('case').getAttribute('dir'), null);
    I18N(p).applyLang('fr');
    assert.equal(p.document.getElementById('ws-prompt').getAttribute('dir'), null);
    assert.equal(p.document.getElementById('fixe').getAttribute('dir'), 'ltr');
  });

  test(`${cible} : langue non proposee — repli EXPLICITE : message (nom de la langue ecrit dans sa langue) une seule fois`, async () => {
    const p = page(cible, { langues: ['de-DE', 'de'] });
    assert.equal(I18N(p).lang, 'en');
    const avis = p.document.getElementById('fab-avis-langue');
    assert.ok(avis, 'aucun message pour une langue non proposee');
    assert.equal(avis.getAttribute('role'), 'status');
    assert.match(avis.textContent, /not available in Deutsch yet: the interface is shown in English/);
    avis.querySelector('button[aria-label]').click();
    assert.equal(p.document.getElementById('fab-avis-langue'), null);
    // deuxieme ouverture : plus de message pour la meme langue
    const p2 = page(cible, { langues: ['de-DE'], stockage: Object.fromEntries(p.stockage) });
    assert.equal(p2.document.getElementById('fab-avis-langue'), null);
  });

  test(`${cible} : langue non proposee puis langue servie (pt-BR, es) — le message est dans la langue servie`, async () => {
    const p = page(cible, { langues: ['pt-BR', 'es-ES'] });
    assert.equal(I18N(p).lang, 'es');
    assert.match(p.document.getElementById('fab-avis-langue').textContent, /aún no está disponible en Português: la interfaz se muestra en Español/);
    // pas de message pour une langue servie
    assert.equal(page(cible, { langues: ['fr-FR'] }).document.getElementById('fab-avis-langue'), null);
    // ni quand l'utilisateur a choisi lui-meme
    assert.equal(page(cible, { langues: ['de-DE'], stockage: { 'fabmesh.lang.choisi': 'en' } }).document.getElementById('fab-avis-langue'), null);
  });

  test(`${cible} : une langue seulement DETECTEE suit le navigateur ; un choix explicite ou ancien reste ; une valeur inconnue est ignoree`, async () => {
    // detectee en fr la derniere fois, navigateur passe en espagnol -> es
    assert.equal(I18N(page(cible, { langues: ['es-ES'], stockage: { 'fabmesh.lang': 'fr', 'fabmesh.lang.detectee': '1' } })).lang, 'es');
    // choix d'avant le marqueur (pas de « detectee ») : respecte
    assert.equal(I18N(page(cible, { langues: ['es-ES'], stockage: { 'fabmesh.lang': 'fr' } })).lang, 'fr');
    // choix explicite : respecte
    assert.equal(I18N(page(cible, { langues: ['es-ES'], stockage: { 'fabmesh.lang.choisi': 'hi' } })).lang, 'hi');
    // valeur inconnue : detection
    const p = page(cible, { langues: ['fr-FR'], stockage: { 'fabmesh.lang.choisi': 'de' } });
    assert.equal(I18N(p).lang, 'fr');
    assert.equal(p.document.documentElement.getAttribute('lang'), 'fr');
  });

  test(`${cible} : l'arabe est detecte depuis le navigateur ou le systeme`, async () => {
    const p = page(cible, { langues: ['ar-EG', 'en'] });
    assert.equal(I18N(p).lang, 'ar');
    assert.equal(p.document.documentElement.getAttribute('dir'), 'rtl');
  });

  test(`${cible} : un attribut REECRIT par le code apres le chargement est traduit (title = 'Close')`, async () => {
    const p = page(cible, { html: SELECT + '<button id="b" title="Settings">x</button>', stockage: { 'fabmesh.lang.choisi': 'fr' } });
    const b = p.document.getElementById('b');
    assert.equal(b.getAttribute('title'), 'Paramètres');
    b.setAttribute('title', 'Close');
    await p.attendre();
    assert.equal(b.getAttribute('title'), 'Fermer');
    I18N(p).applyLang('en');
    assert.equal(b.getAttribute('title'), 'Close', 'retour a l anglais : la valeur ecrite par le code, pas l ancienne');
  });

  test(`${cible} : un texte HTML ecrit sur plusieurs lignes trouve son entree (blancs ramenes a un espace)`, async () => {
    const p = page(cible, { html: SELECT + '<p id="m">Subsequent runs\n            are much faster.</p>', stockage: { 'fabmesh.lang.choisi': 'fr' } });
    assert.equal(p.document.getElementById('m').textContent, 'Les lancements suivants sont bien plus rapides.');
  });

  test(`${cible} : un message compose par tf() n'est jamais renvoye au traducteur automatique`, async () => {
    const envoyes = [];
    const p = page(cible, {
      html: SELECT + '<div id="zone"></div>', stockage: { 'fabmesh.lang.choisi': 'fr' },
      avant: (pg) => { pg.fenetre.meshyAPI = { i18nAutoTranslate: async ({ texts }) => { envoyes.push(...texts); return {}; } }; },
    });
    const z = p.document.getElementById('zone');
    z.textContent = I18N(p).tf('Delete project «{x}»?', 'orc');
    await p.attendre(600);
    assert.ok(!envoyes.some((t) => /Supprimer le projet/.test(t)), 'message deja traduit envoye au traducteur : ' + JSON.stringify(envoyes));
    assert.equal(z.textContent, 'Supprimer le projet «orc» ?');
  });

  test(`${cible} : FabI18n.locale() donne la langue de l'INTERFACE pour les dates et les nombres`, async () => {
    const p = page(cible, { langues: ['en-US'], stockage: { 'fabmesh.lang.choisi': 'fr' } });
    assert.equal(I18N(p).locale(), 'fr-FR');
    I18N(p).applyLang('ar');
    assert.equal(I18N(p).locale(), 'ar-u-nu-latn');
    assert.equal((1234.5).toLocaleString(I18N(p).locale()), (1234.5).toLocaleString('ar-u-nu-latn'));
  });
}
