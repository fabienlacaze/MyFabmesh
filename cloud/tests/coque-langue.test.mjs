// Enveloppe Next dans les SIX langues de l'appli (lot interface multilingue, 2026-10-13 ; constats
// INTERFACE-04, -05, -07 et -14 de l'audit du 11/10/2026).
//
// Avant : l'accueil, la connexion, l'inscription, le mot de passe oublie, la boutique et le bandeau des
// cookies n'existaient qu'en francais et en anglais (un visiteur espagnol, chinois, hindi ou arabe y
// arrivait en anglais), sans choix de langue hors de l'appli, et lire une page legale dans l'autre langue
// faisait basculer toute l'interface.
//
// Transpile les VRAIS composants de src/ (typescript), les rend en HTML (react-dom/server) et verifie :
//   - SCRIPT_LANGUE : meme decision que l'appli (choix, langue detectee re-detectee, navigateur), sens
//     de lecture de l'arabe, version juridique, langue demandee non servie ;
//   - <T> : une version par langue, valeurs inserees sans mise en forme, isolees en arabe ;
//   - pages d'entree (accueil, connexion, mot de passe, cookies, boutique) traduites ;
//   - selecteur de langue accessible dans la barre du haut ;
//   - textes juridiques en francais / anglais seulement, bascules sans toucher a la langue de l'interface.
//
// Lancer : cd cloud && node --test tests/coque-langue.test.mjs
// Preuve sur l'ancien code : COQUE_SRC_ROOT=<dossier contenant app/, components/, lib/ de l'ancien
// commit> node --test tests/coque-langue.test.mjs   (echoue).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const RACINE = process.env.COQUE_SRC_ROOT || fileURLToPath(new URL('../src', import.meta.url));
const cache = new Map();

// Modules de Next remplaces par des doublures minimales (pas de serveur Next dans un test).
const DOUBLURES = {
  'next/link': { __esModule: true, default: ({ href, children, ...r }) => React.createElement('a', { href: String(href), ...r }, children) },
  'next/script': { __esModule: true, default: () => null },
  'next/navigation': { __esModule: true, useRouter: () => ({ push() {}, replace() {} }), useSearchParams: () => new URLSearchParams('') },
  '@supabase/ssr': { __esModule: true, createBrowserClient: () => ({ auth: {} }) },
};

function resoudre(depuis, spec) {
  let base;
  if (spec.startsWith('@/')) base = path.join(RACINE, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(depuis), spec);
  else return null;
  for (const ext of ['', '.ts', '.tsx', '.json', '/index.ts', '/index.tsx']) {
    const p = base + ext;
    if (existsSync(p) && /\.(tsx?|json)$/.test(p)) return p;
  }
  throw new Error('module introuvable : ' + spec + ' depuis ' + depuis);
}
function charger(fichier) {
  if (cache.has(fichier)) return cache.get(fichier).exports;
  if (fichier.endsWith('.json')) {
    const mod = { exports: JSON.parse(readFileSync(fichier, 'utf8')) };
    cache.set(fichier, mod);
    return mod.exports;
  }
  const code = ts.transpileModule(readFileSync(fichier, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, resolveJsonModule: true },
  }).outputText;
  const mod = { exports: {} };
  cache.set(fichier, mod);
  const req = (spec) => {
    if (DOUBLURES[spec]) return DOUBLURES[spec];
    const r = resoudre(fichier, spec);
    return r ? charger(r) : require(spec);
  };
  new Function('require', 'module', 'exports', code)(req, mod, mod.exports);
  return mod.exports;
}
const module_ = (rel) => charger(path.join(RACINE, rel));
const rendre = (rel, nom, props = {}) => renderToStaticMarkup(React.createElement(module_(rel)[nom], props));
const texteVisible = (html) => html.replace(/<[^>]+>/g, ' ');

// Execute SCRIPT_LANGUE comme le navigateur (dans le <head>, avant le rendu).
function executerScript({ stockage = {}, langues = ['en-US'] } = {}) {
  const attrs = {};
  const html = { lang: 'en', dir: '', setAttribute: (k, v) => { attrs[k] = String(v); }, getAttribute: (k) => attrs[k] ?? null };
  const ctx = {
    document: { documentElement: html },
    navigator: { languages: langues, language: langues[0] },
    localStorage: { getItem: (k) => (k in stockage ? stockage[k] : null), setItem() {}, removeItem() {} },
  };
  vm.runInNewContext(module_('lib/langue.tsx').SCRIPT_LANGUE, ctx);
  return { lang: html.lang, dir: html.dir, juridique: attrs['data-juridique'] ?? null, demandee: attrs['data-langue-demandee'] ?? null };
}

test('SCRIPT_LANGUE : la langue du navigateur est servie dans les six langues (plus seulement fr / en)', () => {
  assert.equal(executerScript({ langues: ['es-ES', 'en'] }).lang, 'es');
  assert.equal(executerScript({ langues: ['zh-CN'] }).lang, 'zh');
  assert.equal(executerScript({ langues: ['hi-IN'] }).lang, 'hi');
  assert.equal(executerScript({ langues: ['fr-FR'] }).lang, 'fr');
  assert.equal(executerScript({ langues: ['en-GB', 'fr'] }).lang, 'en');
});

test('SCRIPT_LANGUE : arabe de droite a gauche ; version juridique fr pour le francais, en pour les autres', () => {
  const ar = executerScript({ langues: ['ar-EG'] });
  assert.deepEqual([ar.lang, ar.dir, ar.juridique], ['ar', 'rtl', 'en']);
  const fr = executerScript({ langues: ['fr'] });
  assert.deepEqual([fr.dir, fr.juridique], ['ltr', 'fr']);
  assert.equal(executerScript({ langues: ['es'] }).juridique, 'en');
});

test('SCRIPT_LANGUE : meme ordre de decision que l\'appli (choix explicite, langue enregistree, detection)', () => {
  assert.equal(executerScript({ stockage: { 'fabmesh.lang.choisi': 'hi' }, langues: ['fr'] }).lang, 'hi', 'choix explicite');
  assert.equal(executerScript({ stockage: { 'fabmesh.lang': 'ar' }, langues: ['fr'] }).lang, 'ar', 'langue enregistree avant le 13/10');
  assert.equal(executerScript({ stockage: { 'fabmesh.lang': 'fr', 'fabmesh.lang.detectee': '1' }, langues: ['zh-CN'] }).lang, 'zh', 'langue seulement detectee : re-detectee (INTERFACE-14)');
  assert.equal(executerScript({ stockage: { 'fabmesh.lang.choisi': 'de' }, langues: ['es'] }).lang, 'es', 'choix inconnu ignore');
});

test('SCRIPT_LANGUE : langue demandee non servie notee pour l\'avis de repli (allemand, chinois traditionnel)', () => {
  const de = executerScript({ langues: ['de-DE', 'fr'] });
  assert.deepEqual([de.lang, de.demandee], ['fr', 'de-DE']);
  assert.equal(executerScript({ langues: ['de-DE'] }).lang, 'en');
  const tw = executerScript({ langues: ['zh-TW'] });
  assert.deepEqual([tw.lang, tw.demandee], ['zh', 'zh-TW']);
  assert.equal(executerScript({ langues: ['es'] }).demandee, null);
  assert.equal(executerScript({ stockage: { 'fabmesh.lang.choisi': 'fr' }, langues: ['de'] }).demandee, null, 'pas d\'avis apres un choix explicite');
});

test('<T> : une version par langue, de la table coque-traductions.json', () => {
  const { T } = module_('lib/langue.tsx');
  const html = renderToStaticMarkup(React.createElement(T, { fr: 'Se connecter', en: 'Sign in' }));
  for (const [l, mot] of [['en', 'Sign in'], ['fr', 'Se connecter'], ['es', 'Iniciar sesión'], ['zh', '登录'], ['hi', 'साइन इन करें'], ['ar', 'تسجيل الدخول']]) {
    assert.ok(html.includes(`<span class="lang-${l}">${mot}</span>`), `${l} : ${html}`);
  }
});

test('<T> : valeurs inserees comme du texte (jamais un lien ni du gras), isolees en arabe', () => {
  const { T } = module_('lib/langue.tsx');
  const html = renderToStaticMarkup(React.createElement(T, {
    en: 'Enter the 6-digit code sent to **{x}**.', fr: 'Saisissez le code à 6 chiffres envoyé à **{x}**.', vals: ['[x](javascript:alert(1))**y**'],
  }));
  assert.ok(!/href="javascript/.test(html), 'une valeur ne devient jamais un lien');
  assert.match(html, /<strong>\[x\]\(javascript:alert\(1\)\)\*\*y\*\*<\/strong>/, 'la valeur reste du texte, dans le gras du gabarit');
  const ar = html.match(/<span class="lang-ar">([\s\S]*?)<\/span>/)[1];
  assert.ok(ar.includes('\u2068[x](javascript:alert(1))**y**\u2069'), 'valeur isolee (FSI/PDI) en arabe');
  const lien = renderToStaticMarkup(React.createElement(T, {
    en: 'I confirm I am at least 16 years old (or have my guardian\'s consent) and I accept the [Terms of Service](/legal/terms) and the [Privacy Policy](/legal/privacy).',
    fr: 'x [a](/legal/terms) [b](/legal/privacy)',
  }));
  assert.equal((lien.match(/href="\/legal\/terms"/g) || []).length, 6, 'le lien des conditions existe dans les six versions');
});

test('feuille de style : seule la version de html[lang] est visible, juridique regle par html[data-juridique]', () => {
  const css = readFileSync(path.join(RACINE, 'app/globals.css'), 'utf8');
  for (const l of ['fr', 'es', 'zh', 'hi', 'ar']) {
    assert.ok(css.includes(`html:not([lang="${l}"]) .lang-${l}`), 'regle .lang-' + l);
    assert.ok(new RegExp(`\\[lang="${l}"\\][^{]*\\.lang-en`).test(css), 'anglais cache en ' + l);
  }
  assert.ok(css.includes('html[data-juridique="fr"] .juridique-en'));
  assert.ok(css.includes('html:not([data-juridique="fr"]) .juridique-fr'));
  // l'avis de repli est dans le flux : mesure du 13/10 en navigateur, fixe il recouvrait le titre de la page
  const avis = css.match(/\.coque-avis-langue \{([^}]*)\}/);
  assert.ok(avis && !/position:\s*fixed/.test(avis[1]), 'avis de repli dans le flux de la page');
});

test('barre du haut : selecteur de langue accessible, noms autonymes, hors traduction', () => {
  const html = rendre('components/Nav.tsx', 'Nav');
  assert.match(html, /aria-haspopup="listbox"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /role="listbox"/);
  assert.equal((html.match(/role="option"/g) || []).length, 6);
  for (const nom of ['English', 'Français', 'Español', '中文', 'हिन्दी', 'العربية']) assert.ok(html.includes(nom), nom);
  assert.match(html, /<li[^>]*lang="ar"[^>]*dir="rtl"/);
  assert.match(html, /class="coque-langue" translate="no"/);
});

test('pages d\'entree traduites : accueil, connexion / inscription, mot de passe, cookies', () => {
  const pages = [
    ['app/page.tsx', 'default', null, 'Inicia'],
    ['app/login/page.tsx', 'default', 'Hola de nuevo', null],
    ['app/login/LoginForm.tsx', 'LoginForm', 'Contraseña', '¿Has olvidado tu contraseña?'],
    ['app/auth/reset-password/page.tsx', 'default', 'Restablece tu contraseña', null],
    ['components/CookieBanner.tsx', 'CookieBanner', null, null],
  ];
  for (const [rel, nom, attendu] of pages) {
    const html = rendre(rel, nom);
    if (attendu) assert.ok(html.includes(attendu), rel + ' : ' + attendu);
  }
  const accueil = rendre('app/page.tsx', 'default');
  // L'accueil rend « … » tant que la session n'est pas verifiee : ses textes sont dans le composant.
  const src = readFileSync(path.join(RACINE, 'app/page.tsx'), 'utf8');
  assert.ok(/<T\b/.test(src), 'accueil : textes en <T>');
  assert.ok(typeof accueil === 'string');
  const formulaire = rendre('app/login/LoginForm.tsx', 'LoginForm');
  for (const [l, mot] of [['zh', '密码'], ['hi', 'पासवर्ड'], ['ar', 'كلمة المرور'], ['fr', 'Mot de passe']]) {
    assert.ok(formulaire.includes(`<span class="lang-${l}">${mot}</span>`), 'connexion ' + l);
  }
});

test('bandeau des cookies : texte et lien vers la politique de confidentialite dans les six langues', () => {
  const { T } = module_('lib/langue.tsx');
  const src = readFileSync(path.join(RACINE, 'components/CookieBanner.tsx'), 'utf8');
  const en = src.match(/en="(We only set strictly necessary cookies[^"]*)"/);
  assert.ok(en, 'texte du bandeau en <T>');
  const fr = src.match(/fr="(Nous ne déposons[^"]*)"/)[1];
  const html = renderToStaticMarkup(React.createElement(T, { en: en[1], fr }));
  assert.equal((html.match(/href="\/legal\/privacy"/g) || []).length, 6);
  assert.match(html, /<span class="lang-es">Solo usamos cookies/);
  assert.match(html, /<span class="lang-ar">لا نستخدم/);
});

test('pages legales : textes de loi en francais / anglais seulement, regles par la version juridique', () => {
  for (const [rel] of [['app/legal/terms/page.tsx'], ['app/legal/privacy/page.tsx'], ['app/legal/mentions/page.tsx']]) {
    const src = readFileSync(path.join(RACINE, rel), 'utf8');
    assert.match(src, /className="juridique-fr" lang="fr"/, rel);
    assert.match(src, /className="juridique-en" lang="en"/, rel);
    assert.ok(!/className="lang-(fr|en)"/.test(src), rel + ' : plus de .lang-fr / .lang-en (cachees dans les 4 autres langues)');
    assert.match(src, /<AvisJuridique \/>/, rel + ' : avis dans les quatre autres langues');
  }
  const avis = rendre('components/BasculeLangue.tsx', 'AvisJuridique');
  assert.match(avis, /class="avis-juridique"/);
  assert.match(avis, /<span class="lang-es">Este texto legal solo está disponible en inglés y en francés\.<\/span>/);
  // La bascule change la version juridique, plus la langue de l'interface.
  const bascule = readFileSync(path.join(RACINE, 'components/BasculeLangue.tsx'), 'utf8');
  assert.match(bascule, /setAttribute\('data-juridique'/);
  assert.ok(!/documentElement\.lang\s*=/.test(bascule), 'la bascule ne touche plus html[lang]');
});

test('achat de credits : renonciation et TTC en version juridique, refus du serveur traduits par leur code', () => {
  const page = readFileSync(path.join(RACINE, 'app/buy/page.tsx'), 'utf8');
  assert.ok(!/className="lang-(fr|en)"/.test(page));
  assert.match(page, /className="juridique-fr"/);
  const bouton = readFileSync(path.join(RACINE, 'app/buy/BuyButton.tsx'), 'utf8');
  assert.ok(!/className="lang-(fr|en)"/.test(bouton));
  const { messageServeur } = module_('lib/langue.tsx');
  assert.deepEqual(messageServeur({ error: 'Sales are not open yet — legal notice incomplete', code: 'sales_closed' }, { en: 'x', fr: 'x' }).fr, 'Les achats ne sont pas encore ouverts.');
  assert.equal(messageServeur({ error: 'unknown problem' }, { en: 'x', fr: 'x' }), 'unknown problem');
  assert.deepEqual(messageServeur({}, { en: 'Checkout error.', fr: 'Erreur lors du paiement.' }).en, 'Checkout error.');
});

test('boutique : rendu sans erreur, onglets et libelles en <T>, prix « gratuit » traduit', () => {
  const html = rendre('app/market/page.tsx', 'default');
  for (const [l, mot] of [['es', 'Carrito'], ['zh', '购物车'], ['ar', 'السلة'], ['hi', 'कार्ट']]) {
    assert.ok(html.includes(`<span class="lang-${l}">${mot}</span>`), 'panier ' + l);
  }
  const src = readFileSync(path.join(RACINE, 'app/market/page.tsx'), 'utf8');
  assert.ok(!/alert\('/.test(src), 'plus d\'alert() en anglais en dur');
  assert.ok(!/toLocaleDateString\('en-GB'/.test(src), 'dates dans la langue de l\'interface');
  const auteur = rendre('app/market/author/page.tsx', 'default');
  assert.match(auteur, /<span class="lang-fr">Chargement du profil de l&#x27;auteur…<\/span>|<span class="lang-fr">Chargement…<\/span>/);
});
