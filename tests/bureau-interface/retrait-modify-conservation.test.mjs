// « Modify image » — DEUXIEME RELECTURE DU 2026-10-22 : trois familles de consignes qui partaient en retrait (6 credits) a tort.
//   1. une conservation qui designe la CIBLE (« remove the wings, keep them ») : le moteur effacait ce que l'utilisateur demandait de garder ;
//   2. une forme en -ing nue (« remove the wings, smiling ») : la cible « wings and smiling » partait au detecteur, la pose etait perdue ;
//   3. un style en complement sans article (« remove the wings in watercolor », « in 4k ») : le style etait jete sans rien dire.
// CORRECTIF : lib/retrait-image.js VERSION 5 (gardeLaCible, estParticipe, queueSuspecte). Le VRAI bloc Modify des deux index2.js est execute
// dans une fausse page (tests/bureau-interface/_page-modify.mjs), bureau ET site, mode Cloud.
// Lancer : node --test tests/bureau-interface/retrait-modify-conservation.test.mjs
// Contre l'ancien module : RETRAIT_LIB=<ancien retrait-image.js> node --test tests/bureau-interface/retrait-modify-conservation.test.mjs (echoue)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerPage } from './_page-modify.mjs';

const CONSERVATION = ['remove the wings, keep them', 'remove the wings but keep the wings', 'remove the wings. keep the wings',
  'remove the hat, keep it', 'remove the wings, actually leave them'];
const PARTICIPES = ['remove the wings, smiling', 'remove the wings smiling', 'remove the wings, sitting'];
const STYLES = ['remove the wings in watercolor', 'remove the wings in pixel art', 'remove the wings in 4k'];

async function envoyer(cle, texte) {
  const page = creerPage(cle, { mode: 'cloud' });
  await page.taper(texte);
  await page.cliquer(); await page.avancer();
  return page;
}

for (const cle of ['bureau', 'web']) {
  for (const texte of [...CONSERVATION, ...PARTICIPES, ...STYLES]) {
    test(`${cle} : « ${texte} » n'est pas confie au moteur de retrait ; Modify recoit le texte tel quel`, async () => {
      const page = await envoyer(cle, texte);
      assert.equal(page.journal.autoInpaint.length, 0, 'retrait lance : ' + JSON.stringify(page.journal.autoInpaint));
      assert.equal(page.journal.img2img.length, 1, 'Modify doit partir comme avant');
      assert.equal(page.journal.img2img[0].prompt, texte);
    });
  }
  test(`${cle} : aucun texte envoye au detecteur ne contient un participe ou un style`, async () => {
    for (const texte of [...PARTICIPES, ...STYLES]) {
      const page = await envoyer(cle, texte);
      const cibles = page.journal.autoInpaint.map((a) => a.targetText);
      assert.ok(!cibles.some((c) => /smiling|sitting|watercolor|pixel|4k/.test(c)), texte + ' -> ' + JSON.stringify(cibles));
    }
  });
  test(`${cle} : les retraits legitimes restent routes (conservation d'AUTRE chose, lieu, nom en -ing)`, async () => {
    const attendus = [['remove the wings and keep the rest as it is', 'wings'], ['remove the hat, keep the pig as it is', 'hat'],
      ['remove the wings, keep the tail', 'wings'], ['remove the diamond earring', 'diamond earring'], ['remove the bucket in front of the pig', 'bucket'],
      ['remove the hat from the sleeping dog', 'hat'], ['remove the wings lol', 'wings']];
    for (const [texte, cible] of attendus) {
      const page = await envoyer(cle, texte);
      assert.deepEqual(page.journal.autoInpaint.map((a) => a.targetText), [cible], texte);
      assert.equal(page.journal.img2img.length, 0, texte);
    }
  });
}
