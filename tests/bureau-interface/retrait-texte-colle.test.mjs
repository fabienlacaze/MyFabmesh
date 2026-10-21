// « Modify image : retrait » — LE TEXTE QUI SUIT LA CIBLE N'EST JAMAIS AVALE DANS LA CIBLE (relecture du 2026-10-20, bloquants B1 et B2).
// CONSTAT : « remove the wings\nadd a hat », « remove the wings make the pig blue », « remove the wings without changing the rest », « remove the
// wings along with the tail » partaient en RETRAIT (6 credits, aucune confirmation) avec pour cible « wings add a hat », « wings make the pig blue »...
// alors que le rapport et le journal affirmaient « mixte jamais route en silence » et « les retours a la ligne ne sont pas routes ».
// Cause : extraireCible() ne retirait que des complements de lieu, nettoyer() remplacait \n par une espace AVANT l'analyse, et aucun verbe, preposition
// ou connecteur n'etait refuse dans une cible. B2 : « remove the tail and replace the wings with a hat » fusionnait deux operations (la queue etait
// elle aussi remplacee par un chapeau).
// Ce test execute : 1. le module pur (les DEUX copies) sur des compositions « retrait + autre chose » ; 2. le VRAI bloc Modify des deux index2.js :
// la consigne n'est PAS confiee a Auto Inpaint (img2img jamais remplace en silence), pastille 3, curseur actif, aucune confirmation.
// Lancer : node --test tests/bureau-interface/retrait-texte-colle.test.mjs
// Contre l'ancien code : RETRAIT_LIB=<retrait-image.js ancien> BUREAU_INDEX2=<ancien> WEB_INDEX2=<ancien> node --test tests/bureau-interface/retrait-texte-colle.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODULES, creerPage } from './_page-modify.mjs';

const PREMIERS = ['remove the wings', 'delete the hat', 'erase the logo', 'get rid of the tail', 'take off the helmet', 'remove wings'];
const LIAISONS = [' ', '\n', '\r\n', '\n\n', ' then ', ', ', '. ', ' and ', '; ', ' - ', ' & ', ' after that ', ' afterwards ', ' next ', ' plus ', ' also ',
  ' while ', ' but ', '\n- '];
const SECONDS = ['make it blue', 'add a hat', 'change the color to red', 'paint the shirt green', 'turn the body blue', 'sharpen the image', 'blur the background',
  'make the pig bigger', 'put a crown on it', 'give it a tail', 'replace the tail with a bow', 'lower the horns', 'make smaller', 'add gore'];

const routee = (nom, t) => MODULES[nom].estRoute(MODULES[nom].analyserRetrait(t));

for (const nom of ['bureau', 'web']) {
  test(nom + " : « retrait » suivi d'une AUTRE demande (collee, a la ligne, apres un connecteur) n'est jamais route en silence", () => {
    const routees = [];
    let n = 0;
    for (const p of PREMIERS) for (const l of LIAISONS) for (const s of SECONDS) {
      const t = p + l + s;
      n++;
      if (routee(nom, t)) routees.push(JSON.stringify(t) + ' -> ' + JSON.stringify(MODULES[nom].analyserRetrait(t)));
    }
    assert.ok(n > 1000, 'le test doit etre dense : ' + n);
    assert.deepEqual(routees, [], routees.slice(0, 5).join('\n'));
  });

  test(nom + ' : les exemples du rapport de relecture (B1) ne sont pas routes ; mixte ou aucun, jamais retrait', () => {
    const CAS = ['remove the wings\nadd a hat', 'remove the wings make the pig blue', 'remove the wings after that make it blue', 'no add wings',
      'with no wings and a hat', 'remove the wings and lower the horns', "remove the wings. Actually, don't", "I don't want the wings pink",
      "I don't want the wings to be so big", 'remove the wings and the tail make it blue', 'remove the wings on the pig make it blue',
      'remove the wings from the pig and the cow', 'take the hat off make it blue', 'replace the wings with a hat add a tail'];
    for (const t of CAS) {
      const r = MODULES[nom].analyserRetrait(t);
      assert.ok(r.mode === 'mixte' || r.mode === 'aucun', nom + ' : ' + JSON.stringify(t) + ' -> ' + JSON.stringify(r));
    }
  });

  test(nom + ' : B2, un retrait et un remplacement sont deux operations : mixte, la queue n\'est pas remplacee par le chapeau', () => {
    for (const t of ['remove the tail and replace the wings with a hat', 'remove the tail, replace the wings with a hat',
      'replace the wings with a hat. Remove the tail.', 'replace the wings with a hat and remove the tail', 'replace the wings with a hat and the tail with a bow']) {
      const r = MODULES[nom].analyserRetrait(t);
      assert.equal(r.mode, 'mixte', t);
      assert.equal(r.remplacement, '', t);
    }
    // et le remplacement d'UNE cible reste route
    const ok = MODULES[nom].analyserRetrait('remove the tail and replace it with a bow');
    assert.deepEqual([ok.mode, ok.cible, ok.remplacement], ['remplacement', 'tail', 'a bow']);
  });

  test(nom + ' : une cible ne contient jamais de verbe d\'action, de pronom, de preposition, de determinant interieur ni de negation', () => {
    const MOTS = new Set(['make', 'add', 'change', 'turn', 'put', 'give', 'is', 'are', 'it', 'you', 'i', 'not', 'no', 'after', 'next', 'along', 'without',
      'then', 'the', 'a', 'an', 'its', 'this', 'that', 'with', 'if', 'when', 'keep', 'please']);
    for (const p of PREMIERS) for (const l of LIAISONS) for (const s of SECONDS) {
      const r = MODULES[nom].analyserRetrait(p + l + s);
      for (const w of r.cible.split(' ')) assert.ok(!MOTS.has(w), nom + ' : ' + JSON.stringify(p + l + s) + ' -> cible ' + JSON.stringify(r.cible));
    }
  });

  test(nom + ' : « sans toucher au reste » est la conduite du moteur de retrait : route, la cible reste « wings »', () => {
    for (const t of ['remove the wings without changing the rest', 'remove the wings without changing anything else', 'remove the wings without touching the body',
      'remove the wings while keeping the rest', 'remove the wings. Do not change anything else.']) {
      const r = MODULES[nom].analyserRetrait(t);
      assert.deepEqual([r.mode, r.cible], ['retrait', 'wings'], t);
    }
  });
}

/* ═════ la VRAIE fenetre Modify (bureau ET site) ═════ */

const HOSTILES = ['remove the wings\nadd a hat', 'remove the wings make the pig blue', 'remove the wings without the tail',
  'remove the wings after that make it blue', "I don't want the wings pink", 'no add wings', 'with no wings and a hat',
  'remove the tail and replace the wings with a hat', 'remove the tail, replace the wings with a hat'];

for (const cle of ['bureau', 'web']) {
  test(cle + " : la fenetre ne confie PAS ces consignes a Auto Inpaint : img2img inchange, pastille de Modify, curseur actif, aucune confirmation", async () => {
    for (const t of HOSTILES) {
      const page = creerPage(cle, { lang: 'en', mode: 'cloud' });
      await page.taper(t);
      assert.equal(page.curseurActif(), true, t);
      assert.equal(page.prixAffiche(), 3, 'pastille de Modify (3), pas d\'Auto Inpaint (6) : ' + t);
      await page.cliquer();
      assert.equal(page.journal.autoInpaint.length, 0, 'pas de retrait : ' + JSON.stringify(t));
      assert.equal(page.journal.img2img.length, 1, 'Modify garde sa conduite : ' + JSON.stringify(t));
      assert.equal(page.journal.confirm.length, 0);
    }
  });

  test(cle + " : « remove the wings without changing the rest » est route avec la cible « wings » (conservation = conduite du moteur)", async () => {
    const page = creerPage(cle, { lang: 'en', mode: 'cloud' });
    await page.taper('remove the wings without changing the rest');
    assert.equal(page.curseurActif(), false);
    assert.equal(page.prixAffiche(), 6);
    await page.cliquer();
    assert.equal(page.journal.autoInpaint.length, 1);
    assert.equal(page.journal.autoInpaint[0].targetText, 'wings');
    assert.equal(page.journal.autoInpaint[0].prompt, '');
    assert.equal(page.journal.img2img.length, 0);
  });

  test(cle + " : une consigne a retours a la ligne n'est jamais lue comme une seule phrase", async () => {
    const page = creerPage(cle, { lang: 'en', mode: 'cloud' });
    await page.taper('remove the wings\nmake it blue');
    await page.cliquer();
    assert.equal(page.journal.autoInpaint.length, 0);
    assert.equal(page.journal.img2img.length, 1);
    assert.equal(page.journal.img2img[0].prompt, 'remove the wings\nmake it blue', 'le texte envoye a Modify est celui de l\'utilisateur, a l\'octet');
  });
}
