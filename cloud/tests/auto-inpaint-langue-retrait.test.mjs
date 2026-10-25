// Auto Inpaint / « Modify : retrait » apres la FUSION avec deploy-2510 (filet de langue du lot 2) : la chaine envoyee a Modal est la chaine VERIFIEE.
// Avant la fusion, deux gardes vivaient chacune dans sa branche : le filet de langue (traduit cible et remplacement APRES le filtre) et le refus
// « personne mineure nommee » + la verification de chaque champ seul (Modify retrait). Cote a cote, le texte TRADUIT n'etait revu que par le
// plancher (`true`), et le refus lexical « mineur » (liste anglaise) tournait sur le texte d'ORIGINE : un mot francais courant (« son », « sa »)
// refusait un retrait innocent, un « enfant » traduit en « child » passait.
// Technique : cloud/tests/_auto-inpaint.mjs charge la VRAIE handleAutoInpaint avec le VRAI filtre ; `traduire` simule le filet de langue.
// Contre l'ancien code (deploy-2510 seul) : WORKER_SRC=<worker.ts de deploy-2510> node --test tests/auto-inpaint-langue-retrait.test.mjs (echoue)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monter, rien, filtre, F, NU } from './_auto-inpaint.mjs';

const ZERO = { depenses: 0, modal: 0, budget: 0, appels: 0 };

test('le remplacement TRADUIT repasse par tout le filtre (pas seulement le plancher) : une nudite adulte apparue a la traduction est refusee', async () => {
  const traduite = F(NU, ' woman');
  assert.equal(filtre.checkPromptSafety(traduite, true).safe, true, 'controle : le plancher seul laisse passer (adulte)');
  assert.equal(filtre.checkPromptSafety(traduite, false).safe, false, 'controle : le filtre general la refuse');
  const m = monter({ etranger: true, traduire: ([c]) => [c, traduite] });
  const r = await m.inpaint({ targetText: 'robe', prompt: 'une femme interessante' });
  assert.equal(r.status, 400, await r.clone().text());
  assert.deepEqual(rien(m.j), ZERO);
  assert.ok(m.j.verifies.some((t) => t.includes(traduite)), 'la chaine traduite n\'a pas ete vue par le filtre : ' + JSON.stringify(m.j.verifies));
});

test('la CIBLE traduite en « enfant nomme » est refusee par le refus lexical, sur la chaine FINALE', async () => {
  const m = monter({ etranger: true, traduire: () => ['the child', 'a red hat'] });
  const r = await m.inpaint({ targetText: 'l\'enfant', prompt: 'un chapeau rouge' });
  assert.equal(r.status, 400, await r.clone().text());
  assert.match((await r.json()).error, /child or a young person/);
  assert.deepEqual(rien(m.j), ZERO);
});

test('un mot francais courant (« son », « sa ») n\'est PAS pris pour un enfant : le refus lexical lit la chaine traduite, pas l\'originale', async () => {
  // « son » = « his » : c'est aussi « son » (fils) dans la liste anglaise des mineurs.
  const m = monter({ etranger: true, traduire: () => ['hat', 'his red cap'] });
  const r = await m.inpaint({ targetText: 'son chapeau', prompt: 'sa casquette rouge' });
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual([m.j.modal[0].targetText, m.j.modal[0].prompt], ['hat', 'his red cap'], 'Modal recoit la chaine traduite, celle qui a ete verifiee');
});

test('sans traduction (texte deja anglais) : le refus lexical « mineur » vise toujours la chaine envoyee', async () => {
  const m = monter();
  const r = await m.inpaint({ targetText: 'the boy', prompt: 'a red hat' });
  assert.equal(r.status, 400, await r.clone().text());
  assert.deepEqual(rien(m.j), ZERO);
});

test('chaque chaine envoyee a Modal a ete verifiee TELLE QUELLE (cible rognee, remplacement traduit)', async () => {
  const m = monter({ etranger: true, traduire: () => ['hat', 'a red cap'] });
  const r = await m.inpaint({ targetText: '  chapeau  ', prompt: ' une casquette rouge ' });
  assert.equal(r.status, 200, await r.clone().text());
  const envoye = [m.j.modal[0].targetText, m.j.modal[0].prompt];
  assert.deepEqual(envoye, ['hat', 'a red cap']);
  for (const t of envoye) assert.ok(m.j.verifies.includes(t), 'chaine envoyee jamais verifiee telle quelle : ' + t + ' / ' + JSON.stringify(m.j.verifies));
});

test('cible blanche : 400 avant le filet de langue, rien n\'est debite', async () => {
  const m = monter({ etranger: true, traduire: (t) => t });
  const r = await m.inpaint({ targetText: '   ', prompt: 'x' });
  assert.equal(r.status, 400);
  assert.equal(m.j.filet || 0, 0);
  assert.deepEqual(rien(m.j), ZERO);
});
