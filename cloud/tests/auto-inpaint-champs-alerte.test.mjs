// Auto Inpaint, SERVEUR (/api/auto-inpaint) — DEUXIEME RELECTURE SECURITE du 2026-10-22. Charge les VRAIES fonctions de cloud/src/worker.ts et
// le VRAI filtre de cloud/src/nsfw_filter.ts (doublures, aucun reseau, aucun GPU).
//   1. CHAQUE CHAMP SEUL. Seul le texte JOINT « cible. remplacement » etait verifie ; or le filtre recolle les lettres isolees PAR-DESSUS la
//      jointure : cible « dress a » + remplacement « n u d e » -> « dress anude », le mot n'est plus trouve. 12 remplacements refuses seuls
//      partaient vers Modal, factures 6 credits (la base release-1.0.45 verifiait le remplacement seul : 0 fuite). Correctif : texte joint, cible,
//      remplacement et consignes, chacun verifie, sans doublon.
//   2. ALERTE EXPLOITANT. refusRetraitMineur refusait AVANT _checkPromptSafetyAlerte : un texte du plancher illicite (« nude child ») etait
//      refuse sans l'alerte (_alerterContenuGrave, categorie « minor »). Correctif : _alerterTextesRetrait fait passer ces textes par le filtre
//      qui alerte avant le refus.
// Lancer : cd cloud && node --test tests/auto-inpaint-champs-alerte.test.mjs     Contre l'ancien code : WORKER_SRC=<chemin> (echoue)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monter, filtre, rien } from './_auto-inpaint.mjs';

const L = (...x) => x.join(' ');
const ZERO = { depenses: 0, modal: 0, budget: 0, appels: 0 };
// remplacements refuses SEULS par le filtre (lettres espacees : le filtre les recolle)
const REMPL = [L('n', 'u', 'd', 'e'), L('n', 'a', 'k', 'e', 'd'), L('t', 'o', 'p', 'l', 'e', 's', 's'), L('n', 'u', 'd', 'e') + ' woman'];
const CIBLES = ['dress a', 'shirt x', 'the coat of a'];

test('controle : chaque remplacement est refuse SEUL par le filtre', () => {
  for (const p of REMPL) assert.equal(filtre.checkPromptSafety(p).safe, false, p);
});

test('un remplacement refuse seul ne part JAMAIS vers Modal, meme colle a une cible qui finit par une lettre isolee (12 cas)', async () => {
  const fuites = [];
  for (const c of CIBLES) for (const p of REMPL) {
    const m = monter();
    const r = await m.inpaint({ targetText: c, prompt: p });
    if (r.status !== 400 || m.j.modal.length) fuites.push(`${c} / ${p} -> ${r.status}`);
    else assert.deepEqual(rien(m.j), ZERO, c + ' / ' + p);
  }
  assert.deepEqual(fuites, []);
});

test('une cible refusee seule est refusee meme si le texte joint passe', async () => {
  for (const c of [L('n', 'u', 'd', 'e'), L('n', 'a', 'k', 'e', 'd')]) {
    const m = monter();
    const r = await m.inpaint({ targetText: c, prompt: 'a hat' });
    assert.equal(r.status, 400, c);
    assert.deepEqual(rien(m.j), ZERO);
  }
});

test('textes verifies : le texte joint, puis la cible, puis le remplacement, puis les consignes, sans doublon ; rien de neuf n\'est envoye a Modal', async () => {
  const m = monter();
  const r = await m.inpaint({ targetText: 'wings', prompt: 'a hat', consigne: 'replace the wings with a hat', consigneOriginale: 'remplace les ailes par un chapeau' });
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual(m.j.verifies, ['wings. a hat', 'wings', 'a hat', 'replace the wings with a hat', 'remplace les ailes par un chapeau']);
  assert.deepEqual([m.j.modal[0].targetText, m.j.modal[0].prompt], ['wings', 'a hat']);
});

const N = ['nu', 'de'].join('');
const PLANCHER = [['shirt', N + ' child'], ['dress', N + ' 12 year old girl'], ['coat', 'naked ' + 'kid']];

test('controle : ces remplacements relevent du plancher illicite', () => {
  for (const [, p] of PLANCHER) { const r = filtre.checkPromptSafety(p); assert.equal(r.safe, false); assert.equal(r.hardFloor, true, p); }
});

test('un retrait refuse parce qu\'il nomme un enfant passe QUAND MEME par le filtre qui alerte l\'exploitant (plancher -> alerte)', async () => {
  for (const [c, p] of PLANCHER) {
    const m = monter();
    const r = await m.inpaint({ targetText: c, prompt: p });
    assert.equal(r.status, 400, c + ' / ' + p);
    assert.deepEqual(rien(m.j), ZERO);
    assert.ok(m.j.verifies.length > 0, 'refuse SANS passer par _checkPromptSafetyAlerte (aucune alerte) : ' + c + ' / ' + p);
    assert.ok(m.j.verifies.some((t) => filtre.checkPromptSafety(t).hardFloor), 'le texte du plancher n\'a pas ete vu : ' + JSON.stringify(m.j.verifies));
  }
});

test('le refus « enfant nomme » reste un refus quand le filtre laisse passer (aucun debit, aucun appel Modal)', async () => {
  const m = monter();
  const r = await m.inpaint({ targetText: 'hat', prompt: '', consigne: 'remove the hat from the little girl', consigneOriginale: 'enleve le chapeau de la fillette' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /child or a young person/);
  assert.deepEqual(rien(m.j), ZERO);
});
