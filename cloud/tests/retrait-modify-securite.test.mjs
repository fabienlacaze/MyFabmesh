// « Modify image : retrait » — SECURITE DE LA CONSIGNE COMPLETE, SITE (/api/auto-inpaint), 2026-10-20.
// CONSTAT DE LA RELECTURE : le chemin « retrait » laissait passer des consignes que /api/modify-image refuse (plancher illegal compris). Les mots de
// contexte (« girl », « woman », « on the girl ») sont retires par l'analyse AVANT le filtre, qui ne voyait plus que « dress. no clothing » et
// l'acceptait : 200, Modal appele, 6 credits debites. L'invariant revendique — « la securite ne depend pas du bouton clique » — etait faux.
// CORRECTIF : la fenetre joint la consigne COMPLETE (texte traduit ET texte tape), le pont du site la transmet, handleAutoInpaint la passe par le meme
// filtre que handleModifyImage AVANT tout debit, et ne l'envoie JAMAIS a Modal.
// Ce test charge les VRAIES fonctions de cloud/src/worker.ts (doublures, aucun reseau, aucun GPU), le VRAI filtre, la VRAIE methode autoInpaint du pont
// du site et le VRAI bloc Modify de cloud/public/app/index2.js : la chaine complete (fenetre -> pont -> serveur) est executee.
// Lancer : cd cloud && node --test tests/retrait-modify-securite.test.mjs
// Contre l'ancien code : WORKER_SRC=<worker.ts ancien> WEB_INDEX2=<index2.js ancien> SHIM_JS=<meshyAPI-cloud.js ancien> node --test tests/retrait-modify-securite.test.mjs
// AUCUN contenu explicite reel : cas assembles a partir de fragments.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monter, filtre, rien } from './_auto-inpaint.mjs';
import { creerPage } from '../../tests/bureau-interface/_page-modify.mjs';
import { creerShimAutoInpaint } from '../../tests/bureau-interface/_shim-cloud.mjs';
import { F, PHRASES_TETE, PHRASES_ROUTEES, corpus, nommeVetement } from '../../tests/bureau-interface/_corpus-securite.mjs';

const SANS_VETEMENT = F('no clo', 'thing');
const PHRASE = PHRASES_TETE[0];          // « replace the dress on the girl with no clothing »
const ZERO = { depenses: 0, modal: 0, budget: 0, appels: 0 };

/** Le pont du site, branche sur le VRAI serveur de test : renvoie ce que le navigateur verrait (postJSON etiquette les refus ok:false). */
function pontVersServeur(m) {
  const corpsEnvoyes = [];
  const postJSON = async (_route, corps) => {
    corpsEnvoyes.push(corps);
    const r = await m.inpaint(corps);
    let b; try { b = await r.json(); } catch { b = {}; }
    return r.ok ? b : { ok: false, success: false, status: r.status, error: (b && b.error) || 'HTTP ' + r.status, ...b };
  };
  return { ...creerShimAutoInpaint(postJSON), corpsEnvoyes };
}

test('reference : Modify refuse la consigne complete, mais ni la cible « dress » ni le remplacement « no clothing » ne sont refuses seuls ou joints', async () => {
  const m = monter();
  assert.equal((await m.modify({ prompt: PHRASE })).status, 400, 'Modify refuse');
  assert.equal(filtre.checkPromptSafety('dress. ' + SANS_VETEMENT).safe, true, 'cible + remplacement joints : acceptes (c\'est le trou)');
});

test('la consigne COMPLETE refusee par Modify est refusee par /api/auto-inpaint : 400, sans debit, sans Modal, sans budget', async () => {
  const m = monter();
  const r = await m.inpaint({ targetText: 'dress', prompt: SANS_VETEMENT, consigne: PHRASE, consigneOriginale: PHRASE });
  assert.equal(r.status, 400);
  const corps = await r.json();
  assert.equal(corps.success, false);
  assert.match(corps.error, /Content filter|blocked/i);
  assert.deepEqual(rien(m.j), ZERO);
});

test('le texte TAPE (consigneOriginale) est verifie aussi, meme si la traduction en est propre', async () => {
  const m = monter();
  const r = await m.inpaint({ targetText: 'dress', prompt: '', consigne: 'remove the dress', consigneOriginale: PHRASE });
  assert.equal(r.status, 400);
  assert.deepEqual(rien(m.j), ZERO);
});

test('le texte TRADUIT (consigne) est verifie aussi, meme si le texte tape est propre', async () => {
  const m = monter();
  const r = await m.inpaint({ targetText: 'dress', prompt: '', consigne: PHRASE, consigneOriginale: 'retire la robe' });
  assert.equal(r.status, 400);
  assert.deepEqual(rien(m.j), ZERO);
});

test("une consigne benigne passe, est verifiee, et n'est JAMAIS envoyee a Modal", async () => {
  const m = monter();
  const r = await m.inpaint({ targetText: 'wings', prompt: '', consigne: 'remove the wings', consigneOriginale: 'retire les ailes' });
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual(m.j.verifies, ['wings', 'remove the wings', 'retire les ailes']);
  assert.deepEqual(Object.keys(m.j.modal[0]).sort(), ['dilate', 'imageUrl', 'op', 'prompt', 'targetText']);
  assert.doesNotMatch(JSON.stringify(m.j.modal), /retire|consigne/);
  assert.deepEqual(m.j.depenses, [6]);
});

test("une consigne identique a l'autre ou au texte joint n'est verifiee qu'une fois ; absente (l'outil Auto Inpaint lui-meme) : comportement inchange", async () => {
  const m = monter();
  await m.inpaint({ targetText: 'wings', prompt: '', consigne: 'wings', consigneOriginale: 'wings' });
  assert.deepEqual(m.j.verifies, ['wings']);
  const seul = monter();
  await seul.inpaint({ targetText: 'wings', prompt: 'a hat' });
  assert.deepEqual(seul.j.verifies, ['wings. a hat']);
});

test('une consigne demesuree : 400 net, sans debit ; une valeur non textuelle est ignoree sans planter', async () => {
  const longue = monter();
  const r = await longue.inpaint({ targetText: 'wings', prompt: '', consigne: 'remove the wings ' + 'x'.repeat(1100) });
  assert.equal(r.status, 400);
  assert.deepEqual(rien(longue.j), ZERO);
  const bizarre = monter();
  const r2 = await bizarre.inpaint({ targetText: 'wings', prompt: '', consigne: { a: 1 }, consigneOriginale: 42 });
  assert.equal(r2.status, 200);
});

test('le pont du site transmet la consigne complete (traduite ET tapee) au serveur, et seulement quand elle est donnee', async () => {
  const m = monter();
  const pont = pontVersServeur(m);
  await pont.autoInpaint({ imagePath: 'https://r2.example/front/pig.png', targetText: 'wings', prompt: '', dilate: 15, consigne: 'remove the wings', consigneOriginale: 'retire les ailes' });
  assert.equal(pont.corpsEnvoyes[0].consigne, 'remove the wings');
  assert.equal(pont.corpsEnvoyes[0].consigneOriginale, 'retire les ailes');
  await pont.autoInpaint({ imagePath: 'https://r2.example/front/pig.png', targetText: 'wings', prompt: '', dilate: 15 });
  assert.equal('consigne' in pont.corpsEnvoyes[1], false);
  assert.equal('consigneOriginale' in pont.corpsEnvoyes[1], false);
});

/* ═════ la chaine COMPLETE : fenetre Modify (vrai bloc de index2.js) -> pont du site -> vrai serveur ═════ */

test('chaine complete (site) : toute consigne que Modify refuse et que la fenetre route est REFUSEE par le serveur, sans debit ni Modal', async () => {
  const m = monter();
  const pont = pontVersServeur(m);
  const page = creerPage('web', { lang: 'en', mode: 'cloud' });
  let routeesRefusees = 0, routeesAcceptees = 0, nonRoutees = 0;
  const contournees = [];
  for (const phrase of corpus()) {
    const refuseParModify = !filtre.checkPromptSafety(phrase).safe;
    page.journal.autoInpaint.length = 0; page.journal.img2img.length = 0;
    await page.taper(phrase);
    await page.cliquer();
    const appel = page.journal.autoInpaint[0];
    if (!appel) { nonRoutees++; continue; }
    assert.ok(!nommeVetement(phrase), 'un vetement du corps ne doit jamais etre route : ' + phrase);
    const avant = rien(m.j);
    const r = await pont.autoInpaint({ ...appel, imagePath: 'https://r2.example/front/pig.png' });
    const apres = rien(m.j);
    const parti = apres.modal > avant.modal || apres.depenses > avant.depenses;
    if (refuseParModify) {
      if (r.success || parti) contournees.push({ phrase, cible: appel.targetText, remplacement: appel.prompt });
      else routeesRefusees++;
    } else {
      assert.equal(r.success, true, 'une consigne que Modify accepte ne doit pas etre refusee par la nouvelle verification : ' + phrase);
      routeesAcceptees++;
    }
  }
  assert.deepEqual(contournees, [], 'consignes refusees par Modify mais executees via la fenetre : ' + JSON.stringify(contournees.slice(0, 3)));
  assert.ok(routeesRefusees >= 100, 'le test doit exercer le chemin (routees puis refusees : ' + routeesRefusees + ')');
  assert.equal(nonRoutees + routeesAcceptees + routeesRefusees, corpus().length);
});

test('chaine complete (site) : les consignes du rapport qui nomment un vetement du corps ne sont PLUS routees (chemin d origine, Modify)', async () => {
  for (const phrase of PHRASES_TETE.filter(nommeVetement)) {
    const page = creerPage('web', { lang: 'en', mode: 'cloud' });
    await page.taper(phrase);
    await page.cliquer();
    assert.equal(page.journal.autoInpaint.length, 0, 'non routee : ' + phrase);
    assert.equal(page.journal.img2img.length, 1, 'chemin d origine : ' + phrase);
  }
});

test('chaine complete (site) : les memes consignes avec un vetement de DESSUS sont routees PAR LA FENETRE (cible et remplacement sans contexte) puis refusees par le serveur', async () => {
  const m = monter();
  const pont = pontVersServeur(m);
  for (const phrase of PHRASES_ROUTEES) {
    const page = creerPage('web', { lang: 'en', mode: 'cloud' });
    await page.taper(phrase);
    await page.cliquer();
    assert.equal(page.journal.autoInpaint.length, 1, 'routee : ' + phrase);
    const a = page.journal.autoInpaint[0];
    assert.equal(a.consigne, phrase);
    assert.equal(a.consigneOriginale, phrase);
    const r = await pont.autoInpaint({ ...a, imagePath: 'https://r2.example/front/pig.png' });
    assert.equal(r.success, false, phrase);
    assert.match(r.error, /Content filter|blocked/i);
  }
  assert.deepEqual(rien(m.j), ZERO);
});

test("chaine complete (site) : consigne francaise -> texte tape ET texte traduit sont joints a l'appel", async () => {
  const page = creerPage('web', { lang: 'fr', mode: 'cloud', traductions: { 'retire les ailes': 'remove the wings' } });
  await page.taper('retire les ailes');
  await page.cliquer();
  const a = page.journal.autoInpaint[0];
  assert.equal(a.consigne, 'remove the wings');
  assert.equal(a.consigneOriginale, 'retire les ailes');
  assert.equal(a.targetText, 'wings');
});
