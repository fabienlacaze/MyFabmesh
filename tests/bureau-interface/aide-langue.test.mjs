// AIDE DE LANGUE SOUS CHAQUE CHAMP DE PROMPT (2026-10-24, correction des prompts, chantier B). Principe du proprietaire : « le prompt est la
// donnee d'entree definie par l'utilisateur, elle doit etre respectee » ; l'aide ecrite sous un champ dit donc la VERITE sur la langue a
// utiliser. Avant : 2 champs sur 14 avaient une aide (Generation prompt, New project), figee, coupee par une ellipse, fausse sur le bureau
// 1.0.45 ; les 12 autres (Find / Replace with, Recolor, Age, Modify, Variant, Re-texture, Refine, Draw mask...) n'en avaient aucune.
//   1. STRUCTURE : chaque champ de texte libre des deux pages est un champ de prompt avec son aide (data-pour = id), ou une exception
//      NOMMEE (nom de projet, recherche, contact...). Un champ neuf non classe fait echouer le test.
//   2. MISE EN PAGE : aucune aide n'est en `nowrap` / ellipse (le message d'etat etait coupe a 1366 px) ; la feuille de style les laisse
//      passer a la ligne ; dir="auto" (arabe).
//   3. VERITE : le texte vient des vraies fonctions des deux index2.js ; un champ traduit dit « on traduit vers l'anglais », un champ non traduit
//      dit « ecris en anglais » ; l'etat reel (traducteur absent, dernier essai rate) l'emporte pour les champs traduits ; et la table des champs
//      non traduits correspond au CODE : un champ dit « traduit » appelle bien la traduction dans son gestionnaire.
//   4. LANGUES : meme phrase dans les 5 langues + anglais, « vers l'anglais » present partout, aucun nom de moteur.
//   5. LIBELLES : infobulle Enhance parlante, placeholder de Draw mask identique bureau / site.
// Lancer : node --test tests/bureau-interface/aide-langue.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';
import { CIBLES, fichiersCible, chargerDictionnaires } from '../../build/couverture-traductions.mjs';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lire = (p) => readFileSync(join(RACINE, p), 'utf-8');
const PAGES = { bureau: 'src/renderer/index2.html', web: 'cloud/public/app/index.html' };
const JS = { bureau: 'src/renderer/index2.js', web: 'cloud/public/app/index2.js' };
const EDIT = { bureau: 'src/renderer/index2-edit-tools.js', web: 'cloud/public/app/index2-edit-tools.js' };
const CSS = { bureau: 'src/renderer/styles/index2.css', web: 'cloud/public/app/styles/index2.css' };
const LANGUES = ['fr', 'es', 'zh', 'hi', 'ar'];

/** Champs de prompt (texte que l'IA lit) : chacun a son aide. */
const CHAMPS_PROMPT = ['ws-prompt', 'np-prompt', 'ai-target', 'ai-replace', 'rc-prompt', 'rc-all-prompt', 'age-guide', 'pe-mask-prompt',
  'rfn-prompt', 'mod-prompt', 'var-tex-prompt', 'mask-prompt', 'rrx-part', 'rrx-prompt'];
/** Champs de texte qui ne sont PAS un prompt (et pourquoi). */
const EXCEPTIONS = {
  'project-search': 'recherche', 'np-name': 'nom du projet', 'rp-details': 'signalement au support', 'll-filter': 'filtre de journal',
  'exp-path': 'chemin d export', 'expimg-path': 'chemin d export', 'pub-title': 'titre de publication', 'pub-description': 'description de publication',
  'set-apikey-name': 'reglage', 'set-apikey-value': 'reglage', 'set-api-token': 'reglage', 'contact-name': 'contact', 'contact-subject': 'contact',
  'contact-body': 'contact',
};

/** Champs de texte libre d'une page : [{ id, placeholder }]. */
function champsTexte(html) {
  const sortie = [];
  for (const m of html.matchAll(/<(input|textarea)\b([^>]*)>/g)) {
    const a = m[2];
    const type = (a.match(/\btype="(\w+)"/) || [])[1] || 'text';
    if (m[1] === 'input' && type !== 'text' && type !== 'search') continue;
    const id = (a.match(/\bid="([^"]+)"/) || [])[1];
    if (!id) continue;
    sortie.push({ id, placeholder: (a.match(/\bplaceholder="([^"]*)"/) || [])[1] || '' });
  }
  return sortie;
}
const aidesDe = (html) => [...html.matchAll(/<(\w+)\b([^>]*\bclass="prompt-lang-hint"[^>]*)>/g)].map((m) => ({ balise: m[1], attrs: m[2], pour: (m[2].match(/data-pour="([^"]+)"/) || [])[1] }));

for (const nom of ['bureau', 'web']) {
  test(`${nom} : chaque champ de prompt a SON aide de langue (data-pour), tout autre champ de texte est une exception nommee`, () => {
    const html = lire(PAGES[nom]);
    const aides = aidesDe(html).map((a) => a.pour);
    for (const id of CHAMPS_PROMPT) assert.ok(aides.includes(id), `${nom} : pas d'aide sous #${id}`);
    assert.equal(new Set(aides).size, aides.length, `${nom} : deux aides pour le meme champ`);
    for (const a of aides) assert.ok(CHAMPS_PROMPT.includes(a), `${nom} : aide pour un champ inconnu : ${a}`);
    for (const c of champsTexte(html)) {
      assert.ok(CHAMPS_PROMPT.includes(c.id) || EXCEPTIONS[c.id], `${nom} : champ de texte #${c.id} ni champ de prompt avec aide, ni exception nommee (test)`);
    }
    // l'aide est dans le DOM AVANT d'avoir un texte, cachee, sans nom de moteur ni texte fige
    for (const a of aidesDe(html)) {
      assert.match(a.attrs, /display:\s*none/, `${nom} #${a.pour} : cachee tant que le texte n'est pas pose`);
      assert.match(a.attrs, /dir="auto"/, `${nom} #${a.pour} : dir="auto" (arabe, de droite a gauche)`);
      assert.match(a.attrs, /translate="no"/);
      assert.ok(!/nowrap|ellipsis/.test(a.attrs), `${nom} #${a.pour} : ni nowrap ni ellipse`);
    }
  });

  test(`${nom} : l aide passe a la ligne (feuille de style) et n est plus coupee par une ellipse`, () => {
    const css = lire(CSS[nom]);
    const regle = (css.match(/\.prompt-lang-hint\s*\{[^}]*\}/) || [])[0];
    assert.ok(regle, 'regle .prompt-lang-hint absente');
    assert.match(regle, /white-space:\s*normal/);
    assert.match(regle, /overflow-wrap:\s*anywhere/);
    assert.ok(!/nowrap|ellipsis/.test(regle));
    assert.match(regle, /max-width:\s*100%/);
    // plus d'aide en ligne dans une ligne d'etiquette (elle s'y retrouvait coupee) : toutes sont des blocs de leur propre ligne
    assert.ok(!/<span class="prompt-lang-hint"/.test(lire(PAGES[nom])));
  });
}

test('Draw mask : le placeholder est le meme sur le bureau et sur le site', () => {
  const p = (nom) => champsTexte(lire(PAGES[nom])).find((c) => c.id === 'mask-prompt').placeholder;
  assert.equal(p('bureau'), p('web'));
  assert.match(p('bureau'), /masked area/);
});

test('infobulle Enhance : dit qu elle traduit vers l anglais, garde les mots de l utilisateur et ajoute type + style (bureau ET site)', () => {
  for (const nom of ['bureau', 'web']) {
    const m = lire(PAGES[nom]).match(/id="ws-enhance-prompt"[^>]*\btitle="([^"]+)"/);
    assert.ok(m, nom + ' : bouton Enhance');
    assert.match(m[1], /English/);
    assert.match(m[1], /keeps all your words/);
    assert.match(m[1], /asset type and style/);
  }
});

// ------------------------------------------------------------------------------------------------ vraies fonctions des deux index2.js
function extraire(chemin, noms) {
  const src = lire(chemin);
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
  const morceaux = [];
  const vus = new Set();
  for (const n of ast.body) {
    let nom = null;
    if (n.type === 'VariableDeclaration' && n.declarations.length === 1 && n.declarations[0].id.type === 'Identifier') nom = n.declarations[0].id.name;
    else if (n.type === 'FunctionDeclaration') nom = n.id.name;
    if (nom && noms.includes(nom) && !vus.has(nom)) { vus.add(nom); morceaux.push(src.slice(n.start, n.end)); }
  }
  return { morceaux, vus };
}
const NOMS = ['_langueInterface', '_etatTraduction', 'MSG_TRADUCTION', 'AIDE_PROMPT_EN', 'CHAMPS_PROMPT_SANS_TRADUCTION', '_traductionActivePour',
  '_texteAideLangue', '_updatePromptLangHint'];
const _dicos = {};
function dicosDe(nom) {
  if (!_dicos[nom]) {
    const c = CIBLES.find((x) => x.nom === nom);
    const f = fichiersCible(RACINE, c);
    _dicos[nom] = chargerDictionnaires({ i18n: f.i18n, dossierLang: f.dossierLang });
  }
  return _dicos[nom];
}
function monter(nom, { langue = 'en', etat = 'ok', avecDico = true } = {}) {
  const { morceaux, vus } = extraire(JS[nom], NOMS);
  for (const n of NOMS) assert.ok(vus.has(n), `${nom} : ${n} absent de ${JS[nom]}`);
  const dico = dicosDe(nom)[langue] || {};
  const aides = [];
  const document = {
    getElementById: (id) => (id === 'lang-select' ? { value: langue } : null),
    querySelectorAll: (sel) => (sel === '.prompt-lang-hint'
      ? ['ws-prompt', 'rfn-prompt', undefined].map((pour) => ({ dataset: pour ? { pour } : {}, style: {}, set textContent(v) { aides.push([pour, v]); } }))
      : []),
  };
  const doublures = {
    document, localStorage: { getItem: () => langue },
    normaliserCodeLangue: (x) => String(x || '').toLowerCase().slice(0, 2),
    _i18nT: avecDico ? ((s) => dico[s] || s) : undefined,
  };
  const cles = Object.keys(doublures).filter((k) => doublures[k] !== undefined);
  // eslint-disable-next-line no-new-func
  const f = new Function(...cles, morceaux.join('\n') + `\n_etatTraduction = ${JSON.stringify(etat)};\nreturn { _texteAideLangue, _updatePromptLangHint, CHAMPS_PROMPT_SANS_TRADUCTION, MSG_TRADUCTION, AIDE_PROMPT_EN };`);
  return { ...f(...cles.map((k) => doublures[k])), aides };
}

for (const nom of ['bureau', 'web']) {
  test(`${nom} : un champ traduit promet la traduction vers l anglais, dans les 5 langues et en anglais`, () => {
    const cibles = { fr: /anglais/, es: /inglés/, zh: /英文/, hi: /अंग्रेज़ी/, ar: /الإنجليزية/, en: /translated for the AI/ };
    for (const [langue, re] of Object.entries(cibles)) {
      const a = monter(nom, { langue });
      const t = a._texteAideLangue('ai-target');
      assert.match(t, re, `${nom}/${langue} : ${t}`);
      assert.ok(t.startsWith('✍️ '), 'repere visuel conserve');
      assert.ok(!/unirig|trellis|puppeteer|realvis|clipseg|flux|lucida|pixal3d|m2m100|argos|sdxl/i.test(t), 'aucun nom de moteur : ' + t);
    }
    assert.match(monter(nom, { langue: 'en' })._texteAideLangue('ws-prompt'), /Best written in English/, 'interface anglaise : ne promet pas n importe quelle langue (textes courts non traduits)');
    assert.doesNotMatch(monter(nom, { langue: 'en' })._texteAideLangue('ws-prompt'), /any language/);
  });

  test(`${nom} : un champ NON traduit dit « ecris en anglais » (jamais de promesse fausse), dans les 5 langues`, () => {
    const attendu = { fr: /Écris en anglais/, es: /Escribe en inglés/, zh: /请用英文书写/, hi: /अंग्रेज़ी में लिखें/, ar: /اكتب بالإنجليزية/, en: /Write in English/ };
    for (const [langue, re] of Object.entries(attendu)) {
      const a = monter(nom, { langue });
      // un champ de la table des champs sans traduction, ou, si la table est vide (bureau), un identifiant ajoute pour l'essai
      const id = [...a.CHAMPS_PROMPT_SANS_TRADUCTION][0];
      if (!id) { a.CHAMPS_PROMPT_SANS_TRADUCTION.add('champ-essai'); }
      const t = a._texteAideLangue(id || 'champ-essai');
      assert.match(t, re, `${nom}/${langue} : ${t}`);
      assert.ok(!/vers l'anglais|al inglés|翻译成英文|का अंग्रेज़ी में अनुवाद|نترجمه إلى الإنجليزية|to English/i.test(t), 'ne promet pas la traduction : ' + t);
    }
  });

  test(`${nom} : l etat REEL l emporte pour un champ traduit (traducteur absent, dernier essai rate) ; pas pour un champ non traduit`, () => {
    const absent = monter(nom, { langue: 'fr', etat: 'indisponible' });
    assert.match(absent._texteAideLangue('mod-prompt'), /aucun traducteur/);
    const rate = monter(nom, { langue: 'es', etat: 'echec' });
    assert.equal(rate._texteAideLangue('mod-prompt'), rate.MSG_TRADUCTION.es.aide);
    const libre = monter(nom, { langue: 'fr', etat: 'indisponible' });
    libre.CHAMPS_PROMPT_SANS_TRADUCTION.add('champ-essai');
    assert.match(libre._texteAideLangue('champ-essai'), /Écris en anglais/, 'un champ non traduit n a que faire de l etat du traducteur');
  });

  test(`${nom} : sans dictionnaire (page sans i18n) l aide retombe sur l anglais, jamais sur une cle brute`, () => {
    const a = monter(nom, { langue: 'fr', avecDico: false });
    assert.equal(a._texteAideLangue('mod-prompt'), '✍️ ' + a.AIDE_PROMPT_EN.trad);
    assert.ok(!/prompt\.aide/.test(a._texteAideLangue('mod-prompt')));
  });

  test(`${nom} : _updatePromptLangHint pose a CHAQUE aide le texte de SON champ`, () => {
    const a = monter(nom, { langue: 'fr' });
    a._updatePromptLangHint();
    const parId = Object.fromEntries(a.aides.map(([pour, t]) => [pour, t]));
    assert.match(parId['ws-prompt'], /anglais/);
    assert.equal(parId[undefined], parId['ws-prompt'], 'une aide sans data-pour est supposee traduite (ancien appelant)');
    if (a.CHAMPS_PROMPT_SANS_TRADUCTION.has('rfn-prompt')) assert.match(parId['rfn-prompt'], /Écris en anglais/);
    else assert.match(parId['rfn-prompt'], /anglais/);
  });
}

// ------------------------------------------------------------------------------------------------ la table correspond au CODE
const APPELS_TRADUCTION = new Set(['_traduirePourGeneration', 'translateUserPrompt', 'traduireTexteUtilisateur', '_texteUtilisateurPourGeneration',
  '_indiceDosAnglais', 'fabmeshTraduirePourGeneration', '_npTraductions', 'detecterTypeEtStyle']);
function fonctionsAvecLitteral(chemin, id, sourceType) {
  const src = lire(chemin);
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType });
  const trouvees = [];
  const visite = (n) => {
    if (!n || typeof n.type !== 'string') return;
    if (/^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(n.type)) {
      let aId = false; let aTrad = false;
      const interieur = (x) => {
        if (!x || typeof x.type !== 'string') return;
        if (x.type === 'Literal' && x.value === id) aId = true;
        if (x.type === 'CallExpression') {
          const c = x.callee;
          const nomAppel = c.type === 'Identifier' ? c.name : (c.type === 'MemberExpression' && !c.computed ? c.property.name : '');
          if (APPELS_TRADUCTION.has(nomAppel)) aTrad = true;
        }
        for (const k in x) { if (k === 'type' || k === 'start' || k === 'end') continue; const v = x[k]; if (Array.isArray(v)) v.forEach(interieur); else if (v && typeof v.type === 'string') interieur(v); }
      };
      interieur(n);
      if (aId) trouvees.push(aTrad);
    }
    for (const k in n) { if (k === 'type' || k === 'start' || k === 'end') continue; const v = n[k]; if (Array.isArray(v)) v.forEach(visite); else if (v && typeof v.type === 'string') visite(v); }
  };
  visite(ast);
  return trouvees;
}
for (const nom of ['bureau', 'web']) {
  test(`${nom} : la table des champs non traduits correspond au code (un champ « traduit » appelle la traduction dans un gestionnaire qui le lit)`, () => {
    const src = lire(JS[nom]);
    const m = src.match(/const CHAMPS_PROMPT_SANS_TRADUCTION = new Set\(\[([^\]]*)\]\)/);
    const sans = new Set([...(m ? m[1] : '').matchAll(/'([^']+)'/g)].map((x) => x[1]));
    for (const id of CHAMPS_PROMPT) {
      const appels = [
        ...fonctionsAvecLitteral(JS[nom], id, 'module'),
        ...fonctionsAvecLitteral(EDIT[nom], id, 'script'),
      ];
      const traduit = appels.some(Boolean);
      assert.equal(traduit, !sans.has(id), `${nom} #${id} : ${traduit ? 'le code traduit ce champ' : 'le code NE traduit PAS ce champ'}, la table dit ${sans.has(id) ? 'non traduit' : 'traduit'}`);
    }
  });
}

test('le champ de texte libre d un outil (Texture variations > Style) recoit son aide, bureau ET site', () => {
  for (const nom of ['bureau', 'web']) {
    const src = lire(JS[nom]);
    assert.match(src, /if \(spec\.type === 'text' && schema\.texteLibre === spec\.id\) \{[\s\S]{0,400}aide\.className = 'prompt-lang-hint';/);
    assert.match(src, /aide\.dataset\.pour = 'mt-' \+ spec\.id;/);
  }
});

test('les deux index2.js ont le meme bloc d aide de langue (a la liste des champs non traduits pres)', () => {
  const bloc = (nom) => {
    const s = lire(JS[nom]);
    const t = s.slice(s.indexOf('// --- AIDE DE LANGUE : DEBUT ---'), s.indexOf('// --- AIDE DE LANGUE : FIN ---'));
    return t.replace(/new Set\(\[[^\]]*\]\)/, 'new Set([])');
  };
  assert.ok(bloc('bureau').length > 500);
  assert.equal(bloc('bureau'), bloc('web'));
});
