// Arabe (droite a gauche) dans l'appli, web ET bureau (lot interface multilingue, 2026-10-13 ; constats
// INTERFACE-05 et -13 de l'audit du 11/10/2026, mesures dans un navigateur : 102 elements a texte arabe avec
// un espacement de lettres, 23 boutons d'outils alignes a gauche, deux boutons dont le libelle deborde en
// espagnol et en francais, fleches « suivant » qui pointaient a contre-sens).
// Verifie les feuilles de style et les dictionnaires REELS (analyse statique, aucun navigateur).
// Lancer : cd cloud && node --test tests/arabe-rtl.test.mjs
// Preuve sur l'ancien code : RACINE_DEPOT=<copie de HEAD> node --test tests/arabe-rtl.test.mjs (echoue).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = process.env.RACINE_DEPOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const lire = (rel) => readFileSync(path.join(RACINE, rel), 'utf8');
const CIBLES = { web: 'cloud/public/app', bureau: 'src/renderer' };

for (const [cible, dossier] of Object.entries(CIBLES)) {
  const css = lire(dossier + '/styles/index2.css');

  test(`${cible} : aucun espacement de lettres sur l'arabe (ecriture cursive : la liaison des lettres casse)`, () => {
    assert.match(css, /html\[lang="ar"\] body, html\[lang="ar"\] body \* \{ letter-spacing: normal !important; \}/);
  });

  test(`${cible} : text-align: left ecrit dans le HTML devient le debut de ligne logique en arabe`, () => {
    assert.match(css, /html\[dir="rtl"\] \[style\*="text-align:left"\], html\[dir="rtl"\] \[style\*="text-align: left"\] \{ text-align: start !important; \}/);
    // et chaque regle de feuille qui pose text-align: left a son pendant logique
    for (const f of ['styles/index2.css', 'styles/main.css']) {
      const src = lire(dossier + '/' + f).replace(/\/\*[\s\S]*?\*\//g, '');
      for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (!/text-align\s*:\s*left/.test(m[2])) continue;
        for (const sel of m[1].split(',').map((s) => s.trim())) {
          assert.ok(css.includes('html[dir="rtl"] ' + sel), `${f} : « ${sel} » (text-align: left) sans pendant en arabe`);
        }
      }
    }
  });

  test(`${cible} : fleche « retour aux projets » retournee en arabe, tailles lues de gauche a droite`, () => {
    assert.match(css, /html\[dir="rtl"\] #back-to-projects \{ transform: scaleX\(-1\); \}/);
    assert.match(css, /html\[dir="rtl"\] \.res-tailles \{ direction: ltr;/);
  });

  test(`${cible} : les boutons au libelle long passent a la ligne au lieu de deborder (#at-reset, #ai-preview-btn)`, () => {
    assert.match(css, /#at-reset, #ai-preview-btn \{ white-space: normal;/);
  });

  test(`${cible} : en arabe, une fleche « suivant » pointe dans le sens de lecture (←)`, () => {
    const dico = readdirSync(path.join(RACINE, dossier, 'lang')).filter((f) => /^(ar|_additions\d*)\.js$/.test(f)).map((f) => lire(dossier + '/lang/' + f)).join('\n');
    for (const [faux, juste] of [
      ['استخدم هذه الصورة للنموذج ثلاثي الأبعاد →', 'استخدم هذه الصورة للنموذج ثلاثي الأبعاد ←'],
      ['→ الانتقال إلى {x}', '← الانتقال إلى {x}'],
      ['→ الانتقال إلى الصورة', '← الانتقال إلى الصورة'],
      ['✓ مُستخدَم لإنشاء الهيكل →', '✓ مُستخدَم لإنشاء الهيكل ←'],
    ]) {
      assert.ok(!dico.includes(faux), 'fleche a contre-sens : ' + faux);
      assert.ok(dico.includes(juste), 'traduction attendue : ' + juste);
    }
  });
}

test('web : pastilles de prix a marge LOGIQUE (a l\'autre bout du bouton en arabe aussi)', () => {
  const src = lire('cloud/public/app/cloud-overrides.js');
  assert.match(src, /\.generate-cost-pill \{ margin-inline-start: 8px; \}/);
  assert.match(src, /\.cloud-cost-badge\.opt-cost \{[^}]*margin-inline-start: auto;/);
  assert.ok(!/\.generate-cost-pill \{ margin-left/.test(src));
});
