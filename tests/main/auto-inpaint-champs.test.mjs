// Auto Inpaint, BUREAU (gestionnaire IPC 'auto-inpaint' de src/main/main.js) — DEUXIEME RELECTURE SECURITE du 2026-10-22.
// CONSTAT : seul le texte JOINT « cible. remplacement » passait par le filtre. Le filtre recolle les lettres isolees PAR-DESSUS la jointure :
// cible « dress a » + remplacement « n u d e » -> « dress anude », le mot n'est plus trouve ; le moteur recevait « n u d e » (mode Local), ou
// la demande partait au serveur (mode Cloud). CORRECTIF : texte joint, cible, remplacement et consignes, chacun verifie, sans doublon (meme liste
// que le worker). Charge le VRAI gestionnaire et le VRAI filtre de main.js (tests/main/_auto-inpaint-main.mjs), sans Electron, reseau ni GPU.
// Lancer : node --test tests/main/auto-inpaint-champs.test.mjs     Contre l'ancien code : MAIN_JS=<ancien main.js> (echoue)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monter, filtre, appelsMoteur } from './_auto-inpaint-main.mjs';

const L = (...x) => x.join(' ');
const REMPL = [L('n', 'u', 'd', 'e'), L('n', 'a', 'k', 'e', 'd'), L('t', 'o', 'p', 'l', 'e', 's', 's'), L('n', 'u', 'd', 'e') + ' woman'];
const CIBLES = ['dress a', 'shirt x', 'the coat of a'];

test('controle : chaque remplacement est refuse SEUL par le filtre du bureau', () => {
  for (const p of REMPL) assert.equal(filtre.checkPromptSafety(p).safe, false, p);
});

for (const cloud of [false, true]) {
  test(`mode ${cloud ? 'Cloud' : 'Local'} : un remplacement refuse seul n'atteint JAMAIS le moteur, meme colle a une cible qui finit par une lettre isolee`, async () => {
    const fuites = [];
    for (const c of CIBLES) for (const p of REMPL) {
      const m = monter({ cloud });
      const r = await m.appeler({ targetText: c, prompt: p });
      if (r.success !== false || appelsMoteur(m.j)) fuites.push(`${c} / ${p}`);
    }
    assert.deepEqual(fuites, []);
  });
}

test('textes verifies (classificateur) : le texte joint, la cible, le remplacement, puis les consignes, sans doublon', async () => {
  const m = monter();
  const r = await m.appeler({ targetText: 'wings', prompt: 'a hat', consigne: 'replace the wings with a hat', consigneOriginale: 'remplace les ailes par un chapeau' });
  assert.equal(r.success, true);
  assert.deepEqual(m.j.ia, ['wings. a hat', 'wings', 'a hat', 'replace the wings with a hat', 'remplace les ailes par un chapeau']);
  assert.equal(m.j.serveur[0][1].target, 'wings');
  assert.equal(m.j.serveur[0][1].prompt, 'a hat');
});
