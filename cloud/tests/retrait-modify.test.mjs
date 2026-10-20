// « Modify image » : retrait et remplacement (2026-10-20) — PRIX facture et affiche. Charge les VRAIES fonctions de cloud/src/worker.ts (doublures,
// aucun reseau, aucun GPU) ET le VRAI code de la fenetre Modify (site et bureau) dans une fausse page.
//   - un retrait est facture a la cle `auto_inpaint` de la grille, une consigne ordinaire a la cle `modify` ;
//   - la pastille de la fenetre affiche la cle de la route reellement appelee : prix affiche = prix facture, sur les deux pages.
// Lancer : cd cloud && node --test tests/retrait-modify.test.mjs      Contre l'ancien code : WORKER_SRC=<chemin> node --test tests/retrait-modify.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lireSource } from './_charge-worker.mjs';
import { creerPage } from '../../tests/bureau-interface/_page-modify.mjs';
import { monter } from './_auto-inpaint.mjs';

test('un retrait legitime est facture au prix de la cle auto_inpaint de la grille (6), pas au prix de Modify', async () => {
  const m = monter();
  const r = await m.inpaint({ targetText: 'wings', prompt: '', dilate: 15 });
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual(m.j.depenses, [6]);
  assert.ok(m.j.prixLus.includes('auto_inpaint') && !m.j.prixLus.includes('modify'));
  assert.equal(m.j.modal.length, 1);
  assert.equal(m.j.modal[0].op, 'auto_inpaint');
  assert.equal(m.j.modal[0].targetText, 'wings');
  assert.equal(m.j.modal[0].prompt, '');
  assert.deepEqual(m.j.journal.map((l) => [l.cout, l.statut]), [[6, 'succeeded']]);
});

test('Modify (img2img) reste facture a la cle modify (3) : aucun changement pour les autres consignes', async () => {
  const m = monter();
  const r = await m.modify({ prompt: 'make it red', strength: 0.55 });
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual(m.j.depenses, [3]);
  assert.ok(m.j.prixLus.includes('modify') && !m.j.prixLus.includes('auto_inpaint'));
  assert.equal(m.j.modal[0].op, 'modify');
});

test('le prix facture suit une grille modifiee par l\'administrateur (R2 _meta/pricing.json) : les deux cles restent independantes', async () => {
  const m = monter({ grille: { modify: 4, auto_inpaint: 9 } });
  await m.inpaint({ targetText: 'wings', prompt: '' });
  await m.modify({ prompt: 'make it red' });
  assert.deepEqual(m.j.depenses, [9, 4]);
});

/* ═══════════ prix AFFICHE = prix FACTURE (site) ═══════════ */

/** Pastille du bouton de Modify (site) : la cle de grille qu'elle porte DOIT etre celle que le worker lit pour la route appelee. */
test('site : la cle de grille de la pastille de « Modify image » est la cle lue par la route reellement appelee (modify / auto_inpaint)', () => {
  const page = readFileSync(new URL('../public/app/index2.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(page, /badge\.dataset\.pricingKey = route \? 'auto_inpaint' : 'modify';/);
  const overrides = readFileSync(new URL('../public/app/cloud-overrides.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(overrides, /'mod-apply':\s+'modify',/, 'cle de depart : modify (consigne ordinaire)');
  const src = lireSource();
  const mod = src.slice(src.indexOf('async function handleModifyImage'), src.indexOf('async function handleSegmentPreview'));
  const inp = src.slice(src.indexOf('async function handleAutoInpaint'), src.indexOf('async function handleTexVariant'));
  assert.match(mod, /getPrice\(env, 'modify'\)/);
  assert.match(inp, /getPrice\(env, 'auto_inpaint'\)/);
});

test('prix AFFICHE = prix FACTURE : la VRAIE page (site ET bureau) et le VRAI worker, sur la meme grille, retrait comme consigne ordinaire', async () => {
  for (const grille of [{ modify: 3, auto_inpaint: 6 }, { modify: 5, auto_inpaint: 2 }, { modify: 4, auto_inpaint: 4 }]) {
    const m = monter({ grille });
    await m.inpaint({ targetText: 'wings', prompt: '' });
    await m.modify({ prompt: 'make it red' });
    const [debitRetrait, debitModify] = m.j.depenses;
    for (const cle of ['web', 'bureau']) {
      const p = creerPage(cle, { prix: grille });
      await p.taper('remove the wings');
      const afficheRetrait = p.prixAffiche();
      await p.taper('make it red');
      const afficheModify = p.prixAffiche();
      assert.equal(afficheRetrait, debitRetrait, cle + ' retrait ' + JSON.stringify(grille));
      assert.equal(afficheModify, debitModify, cle + ' modify ' + JSON.stringify(grille));
    }
  }
});

test('prix AFFICHE : le remplacement (replace X with Y) est facture et annonce comme un retrait (meme route)', async () => {
  const grille = { modify: 3, auto_inpaint: 6 };
  const m = monter({ grille });
  await m.inpaint({ targetText: 'wings', prompt: 'a hat' });
  for (const cle of ['web', 'bureau']) {
    const p = creerPage(cle, { prix: grille });
    await p.taper('replace the wings with a hat');
    assert.equal(p.prixAffiche(), m.j.depenses[0], cle);
  }
});

test('admin : les cles modify et auto_inpaint existent dans la grille par defaut (aucune cle inventee)', () => {
  const src = lireSource();
  const bloc = src.match(/const PRICING_DEFAULTS = \{([\s\S]*?)\n\};/)[1];
  assert.match(bloc, /^\s*modify:\s*\d+,/m);
  assert.match(bloc, /^\s*auto_inpaint:\s*\d+,/m);
});

/* ═══════════ traductions RUNTIME : le VRAI i18n.js + les VRAIS dictionnaires, dans les 5 langues, sur les DEUX interfaces ═══════════ */
import { creerPage as creerPageDom } from './_dom-minimal.mjs';

const LANGUES_ESSAI = { fr: 'fr', es: 'es', zh: 'zh', hi: 'hi', ar: 'ar' };
const FICHIERS_LANG = ['es.js', 'zh.js', 'hi.js', 'ar.js', '_additions.js', '_additions2.js', '_additions3.js', '_additions4.js', '_additions5.js', '_additions6.js', '_additions_retrait.js'];

for (const [cible, base] of [['web', '../public/app/'], ['bureau', '../../src/renderer/']]) {
  test(`${cible} : les textes de Modify (retrait) sortent traduits dans les 5 langues, avec leurs valeurs {x} / {y}, sans moteur nomme`, () => {
    for (const lang of Object.keys(LANGUES_ESSAI)) {
      const p = creerPageDom({ html: '<div id="reglages"><select id="lang-select"><option value="en">English</option></select></div>', langues: ['en-US'], stockage: { 'fabmesh.lang.choisi': lang, 'fabmesh.lang': lang } });
      p.executer(readFileSync(new URL(base + 'i18n.js', import.meta.url), 'utf8'), 'i18n.js');
      for (const f of FICHIERS_LANG) p.executer(readFileSync(new URL(base + 'lang/' + f, import.meta.url), 'utf8'), f);
      p.charger();
      const I = p.fenetre.FabI18n;
      assert.equal(I.lang, lang);
      const cas = [
        [I.tf('Erases "{x}" and fills the gap. The Strength slider is not used.', 'wings'), 'wings'],
        [I.tf('Replaces "{x}" with "{y}". The Strength slider is not used.', 'wings', 'a hat'), 'wings', 'a hat'],
        [I.tf('This is a removal: "{x}" will be erased with the removal tool, which costs {y} credits. Continue?', 'wings', 6), 'wings', '6'],
        [I.tf('"{x}" was not found in the image. Try a simpler word, or use Auto Inpaint.', 'wings'), 'wings'],
        [I.t('To remove something, ask for it on its own (for example "remove the wings"), then make the other changes in a second step.')],
        [I.t('Not used when erasing or replacing')],
        [I.t('No credits were used.')],
      ];
      for (const [texte, ...valeurs] of cas) {
        assert.ok(!/^(Erases|Replaces|This is a removal|To remove something|Not used when|No credits were used|"wings" was not found)/.test(texte), `${cible}/${lang} : non traduit : ${texte}`);
        for (const v of valeurs) assert.ok(texte.includes(v), `${cible}/${lang} : valeur ${v} perdue : ${texte}`);
        assert.ok(!/\{x\}|\{y\}/.test(texte), `${cible}/${lang} : gabarit non rempli : ${texte}`);
      }
    }
  });
}
