// « Modify image » — UN CANCEL PENDANT L'ANALYSE ANNULE VRAIMENT (relecture du 2026-10-22, bloquant B5).
// CONSTAT : depuis que « Apply » attend l'analyse (traduction : jusqu'a 8 s, ou demarrage a froid du traducteur local), la fenetre reste ouverte et
// seul « Apply » est grise. Un Cancel pendant ce temps fermait la fenetre, mais le travail partait quand meme a la fin de la traduction, avec le
// texte lu AVANT : img2img facture sans confirmation (mode Cloud, site), ou retrait sans confirmation (mode Local).
// CORRECTIF : _modClic / _modClicValide (bureau ET site) : un Cancel, une reouverture ou un texte modifie pendant l'analyse invalident le clic.
// Le VRAI bloc Modify des deux index2.js est execute dans une fausse page (tests/bureau-interface/_page-modify.mjs).
// Lancer : node --test tests/bureau-interface/retrait-modify-annuler.test.mjs
// Contre l'ancien code : BUREAU_INDEX2=<ancien> WEB_INDEX2=<ancien> node --test tests/bureau-interface/retrait-modify-annuler.test.mjs (echoue)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerPage } from './_page-modify.mjs';

const TICKS = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const CAS = [['enleve les ailes', 'remove the wings', 'retrait'], ['rends le cochon bleu', 'make the pig blue', 'modify']];
const parti = (page) => page.journal.autoInpaint.length + page.journal.img2img.length + page.journal.jobs.length + page.journal.confirm.length;

/** Clic sur Apply AVANT la fin de l'analyse (traduction lente), puis `pendant(page)`, puis la traduction se termine. */
async function clicPendantAnalyse(cle, texte, anglais, mode, pendant) {
  const page = creerPage(cle, { lang: 'fr', traductions: { [texte]: anglais }, traductionLente: true, mode });
  await page.taper(texte, { avancer: false });
  const clic = page.cliquer();
  await TICKS(1);
  assert.equal(page.el('mod-apply').disabled, true, 'Apply grise pendant l\'analyse');
  await pendant(page);
  // la traduction se termine, puis (chemin Modify, depuis la fusion avec deploy-2510) la traduction de l'ENVOI, qui attend aussi : on libere
  // jusqu'a ce que le clic soit termine
  let fini = false;
  clic.then(() => { fini = true; }, () => { fini = true; });
  for (let i = 0; i < 20 && !fini; i++) { page.liberer(); await TICKS(2); }
  await clic;
  await TICKS();
  page.liberer();
  await TICKS();
  return page;
}
const annuler = (page) => { for (const f of page.el('mod-cancel').ecouteurs.click || []) f(); };

for (const cle of ['bureau', 'web']) {
  for (const mode of ['cloud', 'local']) {
    for (const [texte, anglais, nature] of CAS) {
      test(`${cle} (${mode}) : Cancel pendant l'analyse de « ${texte} » (${nature}) : rien ne part, aucune confirmation, Apply re-active`, async () => {
        const page = await clicPendantAnalyse(cle, texte, anglais, mode, async (p) => { annuler(p); assert.equal(p.ouverte(), false); });
        assert.equal(parti(page), 0, JSON.stringify(page.journal, null, 1));
        assert.equal(page.el('mod-apply').disabled, false);
      });
    }
  }

  test(`${cle} : texte modifie pendant l'analyse : le clic ne lance rien avec l'ancien texte`, async () => {
    const page = await clicPendantAnalyse(cle, 'enleve les ailes', 'remove the wings', 'cloud', async (p) => { p.el('mod-prompt').value = 'rends le cochon bleu'; });
    assert.equal(parti(page), 0);
    assert.equal(page.ouverte(), true, 'la fenetre reste ouverte : l\'utilisateur clique de nouveau');
  });

  test(`${cle} : Cancel puis reouverture pendant l'analyse : le clic d'avant ne lance rien`, async () => {
    const page = await clicPendantAnalyse(cle, 'enleve les ailes', 'remove the wings', 'local', async (p) => {
      annuler(p);
      for (const f of p.el('ws-modify-btn').ecouteurs.click || []) f();
      assert.equal(p.ouverte(), true);
    });
    assert.equal(parti(page), 0);
  });

  test(`${cle} : sans Cancel, un clic pendant l'analyse part toujours (une fois), retrait comme Modify`, async () => {
    for (const [texte, anglais, nature] of CAS) {
      const page = await clicPendantAnalyse(cle, texte, anglais, 'local', async () => {});
      if (nature === 'retrait') assert.equal(page.journal.autoInpaint.length, 1, texte);
      else assert.equal(page.journal.img2img.length, 1, texte);
      assert.equal(page.journal.autoInpaint.length + page.journal.img2img.length, 1);
      assert.equal(page.ouverte(), false);
    }
  });
}
