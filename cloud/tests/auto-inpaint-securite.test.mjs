// Auto Inpaint, SERVEUR (/api/auto-inpaint) — chaine de securite, 2026-10-20. Charge les VRAIES fonctions de cloud/src/worker.ts (doublures, aucun
// reseau, aucun GPU) et le VRAI filtre. Avant : seul `prompt` etait filtre ; le texte cherche (`targetText`) partait sans controle vers le moteur, alors
// que /api/modify-image refuse le meme texte. Depuis que « Modify image » confie ses retraits a cette route, c'est la meme porte. Prouve :
//   - le texte cherche et le remplacement passent par le filtre, SEPARES ET JOINTS ;
//   - la chaine VERIFIEE est la chaine ENVOYEE a Modal (rognee une seule fois) ;
//   - un refus ne debite rien, n'appelle pas Modal, ne consomme ni budget ni appel ;
//   - la discipline de remboursement est inchangee (masque vide, panne Modal, credits insuffisants).
// Lancer : cd cloud && node --test tests/auto-inpaint-securite.test.mjs      Contre l'ancien code : WORKER_SRC=<chemin> node --test tests/auto-inpaint-securite.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chargerFonctions } from './_charge-worker.mjs';
import { monter, F, NU, rien } from './_auto-inpaint.mjs';

test('securite : un terme refuse dans le texte CHERCHE est refuse, sans debit, sans appel Modal, sans budget (avant : passait)', async () => {
  const m = monter();
  const r = await m.inpaint({ targetText: F(NU, ' skin'), prompt: '' });
  assert.equal(r.status, 400);
  const corps = await r.json();
  assert.equal(corps.success, false);
  assert.match(corps.error, /Content filter|blocked/i);
  assert.deepEqual(rien(m.j), { depenses: 0, modal: 0, budget: 0, appels: 0 });
});

test('securite : un terme refuse dans le REMPLACEMENT est refuse (comportement conserve)', async () => {
  const m = monter();
  const r = await m.inpaint({ targetText: 'dress', prompt: F('a ', NU, ' body') });
  assert.equal(r.status, 400);
  assert.deepEqual(rien(m.j), { depenses: 0, modal: 0, budget: 0, appels: 0 });
});

test('securite : une combinaison repartie entre les deux champs (personne + nudite) est refusee, chaque champ passant seul', async () => {
  const seul1 = monter(); assert.equal((await seul1.inpaint({ targetText: 'woman', prompt: '' })).status, 200);
  const seul2 = monter(); assert.equal((await seul2.inpaint({ targetText: 'dress', prompt: F('no clo', 'thing') })).status, 200);
  const m = monter();
  const r = await m.inpaint({ targetText: 'woman', prompt: F('no clo', 'thing') });
  assert.equal(r.status, 400, 'le texte JOINT est verifie');
  assert.deepEqual(rien(m.j), { depenses: 0, modal: 0, budget: 0, appels: 0 });
});

test('securite : Modify refusait deja ce texte ; Auto Inpaint le refuse maintenant aussi (meme filtre)', async () => {
  const m = monter();
  const refusModify = await m.modify({ prompt: F('replace the dress with ', NU) });
  assert.equal(refusModify.status, 400);
  const refusInpaint = await m.inpaint({ targetText: 'dress', prompt: NU });
  assert.equal(refusInpaint.status, 400);
});

test('la chaine VERIFIEE est la chaine ENVOYEE a Modal : texte rogne une seule fois, cible et remplacement', async () => {
  const m = monter();
  await m.inpaint({ targetText: '  wings  ', prompt: '  a hat \n' });
  assert.deepEqual(m.j.verifies, ['wings. a hat']);
  assert.equal(m.j.modal[0].targetText, 'wings');
  assert.equal(m.j.modal[0].prompt, 'a hat');
  const retrait = monter();
  await retrait.inpaint({ targetText: ' tail ' });
  assert.deepEqual(retrait.j.verifies, ['tail']);
  assert.equal(retrait.j.modal[0].targetText, 'tail');
  assert.equal(retrait.j.modal[0].prompt, '');
});

test('texte cherche vide ou blanc : 400, sans debit', async () => {
  for (const t of ['', '   ', undefined]) {
    const m = monter();
    const r = await m.inpaint({ targetText: t, prompt: 'a hat' });
    assert.equal(r.status, 400);
    assert.deepEqual(rien(m.j), { depenses: 0, modal: 0, budget: 0, appels: 0 });
  }
});

test('cible introuvable (masque vide) : credit et budget rembourses, 422, journal « failed » ; message nomme la cible rognee', async () => {
  const m = monter({ resultat: { maskEmpty: true } });
  const r = await m.inpaint({ targetText: ' wings ', prompt: '' });
  assert.equal(r.status, 422);
  assert.match((await r.json()).error, /^auto-inpaint: "wings" not found in the image \(credits refunded\)$/);
  assert.deepEqual(m.j.depenses, [6]);
  assert.deepEqual(m.j.remboursements, [6]);
  assert.equal(m.j.budget.reduce((a, b) => a + b, 0), 0, 'budget GPU rendu en entier');
  assert.equal(m.j.journal.at(-1).statut, 'failed');
});

test('panne Modal : remboursement exact du debit (6), budget rendu', async () => {
  const m = monter({ echec: true });
  const r = await m.inpaint({ targetText: 'wings', prompt: '' });
  assert.equal(r.status, 502);
  assert.deepEqual(m.j.depenses, [6]);
  assert.deepEqual(m.j.remboursements, [6]);
  assert.equal(m.j.budget.reduce((a, b) => a + b, 0), 0);
});

test('credits insuffisants : 402 et budget rendu, pas d\'appel Modal', async () => {
  const m = monter({ credits: 2 });
  // spendCredits renvoie 2 - 6 < 0 : la doublure ne refuse pas ; on verifie donc le chemin par une doublure qui refuse
  const refus = monter();
  const w = chargerFonctions(['handleAutoInpaint'], {
    getSessionUser: async () => ({ id: 'u1' }), err: (s, mm) => new Response(JSON.stringify({ error: mm }), { status: s }),
    json: (o, init) => new Response(JSON.stringify(o), { status: (init && init.status) || 200 }), getParentalState: async () => ({}),
    _checkPromptSafetyAlerte: async () => ({ safe: true }), getPrice: async () => 6, isTrustedAssetHost: () => true,
    checkAndIncrementModalSpend: async () => 100, _spendRefusalMessage: async () => 'refus', checkAndIncrementUserCalls: async () => 10,
    refundModalSpend: async () => { refus.j.budget.push('rembourse'); }, spendCredits: async () => null, addCredits: async () => {},
    callModalImageOp: async () => { refus.j.modal.push(1); return { url: 'x' }; }, logOperation: async () => {},
  });
  const r = await w.handleAutoInpaint(new Request('https://x.example', { method: 'POST', body: JSON.stringify({ imageUrl: 'https://r2.example/a.png', targetText: 'wings' }) }), { MODAL_IMAGE_OP_URL: 'u' });
  assert.equal(r.status, 402);
  assert.deepEqual(refus.j.budget, ['rembourse']);
  assert.equal(refus.j.modal.length, 0);
  assert.equal(m.j.modal.length, 0);
});

