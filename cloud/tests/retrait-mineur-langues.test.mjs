// « Modify image : retrait » / Auto Inpaint, SITE — FAUX REFUS d'une consigne NON anglaise (2026-10-28).
// CONSTAT : refusRetraitMineur lisait la consigne TAPEE (consigneOriginale, jamais traduite) avec la liste ANGLAISE des mineurs : « son » (fils en
// anglais) est le possessif francais (« retire son chapeau » = remove his hat) et « are » en espagnol (« los sombreros que son rojos ») : retrait
// refuse a tort (400, « child or a young person »). Le filet de langue ne change rien : il traduit cible et remplacement, pas la consigne tapee.
// CORRECTIF : « son » / « sons » sont retires de la liste POUR UN TEXTE que la detection de langue commune range hors de l'anglais (ecriture latine) ;
// tout autre terme de mineur reste refuse dans toutes les langues ; « fils » est ajoute pour que « le chapeau de son fils » reste refuse.
// Lancer : cd cloud && node --test tests/retrait-mineur-langues.test.mjs
// Contre l'ancien code : WORKER_SRC=<worker.ts ancien> node --test tests/retrait-mineur-langues.test.mjs (les cas « faux refus » echouent)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chargerFonctions } from './_charge-worker.mjs';
import { monter, rien, NOMS_REFUS_MINEUR } from './_auto-inpaint.mjs';
import * as LangueTexte from '../public/app/lib/langue-texte.js';

const w = chargerFonctions(NOMS_REFUS_MINEUR, { LangueTexte });
const refus = (cible, remplacement, consignes) => w.refusRetraitMineur(cible, remplacement, consignes);
const MINEURS = w.ev('_RM_MINEURS');
const AMBIGUS = ['son', 'sons'];
const ZERO = { depenses: 0, modal: 0, budget: 0, appels: 0 };

// Consignes courantes de retrait d'un objet porte (consigne tapee). Aucune ne nomme un enfant.
const INNOCENTES = [
  'retire son chapeau', 'enleve son casque', 'efface son manteau', 'retire son chapeau rouge', 'retire son chapeau et sa veste', 'supprime son sac',
  'son bouclier', 'son chapeau', 'retire le chapeau de son chien', 'supprime le sac a dos de son ami',
  'quita los sombreros que son rojos', 'elimina las botas que son de cuero', 'quita los sombreros que son rojos y azules',
];

test('faux refus : une consigne tapee dans une autre langue qui contient « son » n\'est plus refusee (Modify : traduite + tapee)', () => {
  for (const tapee of INNOCENTES) {
    assert.equal(refus(tapee, '', []), null, 'cible seule : ' + tapee);
    assert.equal(refus('hat', '', ['remove his hat', tapee]), null, 'consigne : ' + tapee);
  }
});

test('faux refus : a travers handleAutoInpaint (consigne traduite + consigne tapee en francais), 200 et Modal appele', async () => {
  const m = monter({ etranger: true, traduire: () => ['hat', ''] });
  const r = await m.inpaint({ targetText: 'chapeau', prompt: '', consigne: 'remove his hat', consigneOriginale: 'retire son chapeau', langueVerifiee: true });
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal(m.j.modal.length, 1);
  assert.equal(m.j.depenses.length, 1);
});

test('securite : le meme retrait avec un terme de mineur est refuse, pour CHAQUE terme de la liste (hors « son » / « sons »), dans toutes les langues', () => {
  const termes = MINEURS.filter((t) => !AMBIGUS.includes(t));
  assert.ok(termes.length > 100);
  for (const t of termes) {
    assert.ok(refus('hat', '', [`remove the hat of the ${t}`]), 'anglais : ' + t);
    assert.ok(refus('hat', '', [`retire le chapeau de son ${t}`]), 'francais avec son : ' + t);
    assert.ok(refus('hat', '', [`quita el sombrero que son del ${t}`]), 'espagnol avec son : ' + t);
    assert.ok(refus('hat', '', [`retire son chapeau, ${t}`]), 'francais, terme en fin : ' + t);
    assert.ok(refus(t, 'hat', []), 'cible : ' + t);
    assert.ok(refus('hat', t, []), 'remplacement : ' + t);
  }
});

test('securite : « son » reste un mineur en anglais, et dans un texte dont la langue n\'est pas reconnue', () => {
  for (const t of ['remove the hat of my son', 'the son\'s hat', 'remove his sons hat', 'remove the sons', 'erase the hat that his son wears',
    'remove son hat', 'son hat', 'remove son']) {
    assert.ok(refus('hat', '', [t]), t);
  }
});

test('securite : « fils » (= son) et les ages restent refuses dans une phrase francaise', () => {
  for (const t of ['enleve le chapeau de son fils', 'retire le chapeau de ses fils', 'le fils', 'retire le chapeau de son enfant',
    'retire la veste de la fille', 'retire son chapeau, il a 10 ans']) {
    assert.ok(refus('hat', '', [t]), t);
  }
});

test('securite : une consigne etrangere ne desarme pas la liste sur les AUTRES champs (cible, remplacement, traduction)', () => {
  assert.ok(refus('hat', 'a boy', ['retire son chapeau']), 'remplacement anglais');
  assert.ok(refus('the child hat', '', ['retire son chapeau']), 'cible anglaise');
  assert.ok(refus('hat', '', ['retire son chapeau', 'remove the hat of the boy']), 'traduction anglaise');
  assert.ok(refus('hat', '', ['remove his hat', 'retire le chapeau de son enfant']), 'consigne tapee');
  assert.ok(refus('hat', '', ['retire son chapeau', 'remove son hat']), 'une consigne etrangere ne couvre pas une consigne anglaise voisine');
});

test('securite : un melange d\'homoglyphes ou d\'ecritures n\'ouvre pas l\'exception', () => {
  assert.ok(refus('hat', '', ['remove sοn hat']));          // o grec, texte anglais
  assert.ok(refus('hat', '', ['сон son']));      // cyrillique + « son »
});

test('securite : handleAutoInpaint refuse toujours un enfant nomme en francais ou en espagnol, sans debit ni Modal', async () => {
  for (const tapee of ['retire le chapeau de son enfant', 'quita el sombrero del nino', 'enleve le chapeau de son fils', 'remove the hat of my son']) {
    const m = monter({ etranger: true, traduire: (t) => t });
    const r = await m.inpaint({ targetText: 'hat', prompt: '', consigne: 'remove the hat', consigneOriginale: tapee, langueVerifiee: true });
    assert.equal(r.status, 400, tapee);
    assert.match((await r.json()).error, /child or a young person/);
    assert.deepEqual(rien(m.j), ZERO, tapee);
  }
});
