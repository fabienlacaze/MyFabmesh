// « Modify image : retrait » — SECURITE DE LA CONSIGNE COMPLETE, BUREAU (src/main/main.js, gestionnaire 'auto-inpaint'), 2026-10-20.
// CONSTAT DE LA RELECTURE : le chemin « retrait » laissait passer des consignes que Modify refuse (plancher illegal compris). Les mots de contexte
// (« girl », « woman », « on the girl ») sont retires par l'analyse AVANT le filtre, qui ne voyait plus que « dress. no clothing » et l'acceptait.
// L'invariant revendique — « la securite ne depend pas du bouton clique » — etait faux.
// CORRECTIF : la fenetre joint la consigne COMPLETE (texte traduit ET texte tape) ; le gestionnaire la passe par les memes filtres que 'img2img' avant
// tout appel au moteur, et ne l'envoie JAMAIS au moteur.
// Ce test charge le VRAI gestionnaire et le VRAI filtre de main.js, ET le VRAI bloc Modify de src/renderer/index2.js dans une fausse page : la chaine
// complete (fenetre -> arguments de l'appel -> gestionnaire) est executee.
// Lancer : node --test tests/main/retrait-modify-securite.test.mjs
// Contre l'ancien code : MAIN_JS=<main.js ancien> BUREAU_INDEX2=<index2.js ancien> node --test tests/main/retrait-modify-securite.test.mjs
// AUCUN contenu explicite reel : cas assembles a partir de fragments.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filtre, monter, appelsMoteur } from './_auto-inpaint-main.mjs';
import { creerPage } from '../bureau-interface/_page-modify.mjs';
import { F, PHRASES_TETE, PHRASES_ROUTEES, corpus, nommeVetement } from '../bureau-interface/_corpus-securite.mjs';

const SANS_VETEMENT = F('no clo', 'thing');
// PHRASES_TETE[1] (« woman ») : depuis le 2026-10-22 une consigne qui nomme un enfant (PHRASES_TETE[0], « girl ») est refusee AVANT le filtre
// de texte (refusRetraitMineur, tests/main/retrait-mineur-serveur.test.mjs) ; ici on exerce le filtre sur la consigne complete.
const PHRASE = PHRASES_TETE[1];          // « replace the clothes on the woman with no clothing »

test('reference : Modify refuse la consigne complete, mais ni la cible « dress » ni le remplacement « no clothing » ne sont refuses seuls ou joints', () => {
  assert.equal(filtre.checkPromptSafety(PHRASE).safe, false, 'la consigne complete est refusee');
  assert.equal(filtre.checkPromptSafety('dress. ' + SANS_VETEMENT).safe, true, 'cible + remplacement joints : acceptes (c\'est le trou)');
});

test('la consigne COMPLETE refusee par Modify est refusee ici : aucun appel moteur, en local ET en cloud', async () => {
  for (const cloud of [false, true]) {
    const m = monter({ cloud });
    const r = await m.appeler({ targetText: 'dress', prompt: SANS_VETEMENT, consigne: PHRASE, consigneOriginale: PHRASE });
    assert.equal(r.success, false, 'cloud=' + cloud);
    assert.match(r.error, /Content filter|blocked/i);
    assert.equal(appelsMoteur(m.j), 0, 'aucun appel moteur (cloud=' + cloud + ')');
  }
});

test('le texte TAPE (consigneOriginale) est verifie aussi, meme si la traduction en est propre', async () => {
  const m = monter();
  const r = await m.appeler({ targetText: 'dress', prompt: '', consigne: 'remove the dress', consigneOriginale: PHRASE });
  assert.equal(r.success, false);
  assert.equal(appelsMoteur(m.j), 0);
});

test('le texte TRADUIT (consigne) est verifie aussi, meme si le texte tape est propre', async () => {
  const m = monter();
  const r = await m.appeler({ targetText: 'dress', prompt: '', consigne: PHRASE, consigneOriginale: 'retire la robe' });
  assert.equal(r.success, false);
  assert.equal(appelsMoteur(m.j), 0);
});

test('le classificateur IA est consulte sur la consigne complete (comme dans img2img) ; son refus arrete tout', async () => {
  const m = monter({ aiSafe: false });
  const r = await m.appeler({ targetText: 'hat', prompt: '', consigne: 'remove the hat', consigneOriginale: 'remove the hat' });
  assert.equal(r.success, false);
  assert.equal(appelsMoteur(m.j), 0);
  const ok = monter();
  await ok.appeler({ targetText: 'hat', prompt: '', consigne: 'remove the hat please', consigneOriginale: 'retire le chapeau' });
  assert.deepEqual(ok.j.ia, ['hat', 'remove the hat please', 'retire le chapeau']);
});

test("une consigne benigne passe, et n'est JAMAIS envoyee au moteur local", async () => {
  const local = monter();
  const r = await local.appeler({ targetText: 'wings', prompt: '', dilate: 15, rel: 0.585, consigne: 'remove the wings', consigneOriginale: 'retire les ailes' });
  assert.equal(r.success, true);
  assert.deepEqual(Object.keys(local.j.serveur[0][1]).sort(), ['dilate', 'input', 'output', 'prompt', 'rel', 'target']);
  assert.doesNotMatch(JSON.stringify(local.j.serveur), /retire|consigne/);
});

test('mode Cloud : la consigne complete part AUSSI au serveur (qui la verifie avec l etat du compte), rognee, et seulement quand elle est donnee', async () => {
  // 2026-10-21 : sans elle, le serveur ne voyait que « coat. no clothing » ; un poste en mode sans restriction (filtre local indulgent)
  // contournait le controle parental du COMPTE, que /api/modify-image applique au prompt complet de 'img2img'.
  const cloud = monter({ cloud: true });
  await cloud.appeler({ targetText: 'wings', prompt: '', consigne: '  remove the wings ', consigneOriginale: 'retire les ailes' });
  assert.deepEqual(Object.keys(cloud.j.cloud[0].extraBody).sort(), ['consigne', 'consigneOriginale', 'dilate', 'prompt', 'targetText']);
  assert.equal(cloud.j.cloud[0].extraBody.consigne, 'remove the wings');
  assert.equal(cloud.j.cloud[0].extraBody.consigneOriginale, 'retire les ailes');
  const outil = monter({ cloud: true });     // l'outil Auto Inpaint lui-meme : corps inchange
  await outil.appeler({ targetText: 'wings', prompt: 'a hat', consigne: { a: 1 }, consigneOriginale: '   ' });
  assert.deepEqual(Object.keys(outil.j.cloud[0].extraBody).sort(), ['dilate', 'prompt', 'targetText']);
});

test('une consigne demesuree ou non textuelle : refus net (trop longue) ou ignoree (pas du texte), sans plantage', async () => {
  const longue = monter();
  const r = await longue.appeler({ targetText: 'wings', prompt: '', consigne: 'remove the wings ' + 'x'.repeat(1100) });
  assert.equal(r.success, false);
  assert.equal(appelsMoteur(longue.j), 0);
  const bizarre = monter();
  const r2 = await bizarre.appeler({ targetText: 'wings', prompt: '', consigne: { a: 1 }, consigneOriginale: 42 });
  assert.equal(r2.success, true);
});

test("sans consigne (l'outil Auto Inpaint lui-meme) : comportement inchange, le classificateur ne voit que le texte joint", async () => {
  const m = monter();
  const r = await m.appeler({ targetText: 'wings', prompt: 'a hat' });
  assert.equal(r.success, true);
  assert.deepEqual(m.j.ia, ['wings. a hat']);
});

/* ═════ la chaine COMPLETE : fenetre Modify (vrai bloc de index2.js) -> arguments de l'appel -> vrai gestionnaire ═════ */

test('chaine complete (bureau) : toute consigne que Modify refuse et que la fenetre route est REFUSEE par le gestionnaire, sans appel moteur', async () => {
  const m = monter({ cloud: true });
  const page = creerPage('bureau', { lang: 'en', mode: 'cloud' });
  let routeesRefusees = 0, routeesAcceptees = 0, nonRoutees = 0, contournees = [];
  for (const phrase of corpus()) {
    const refuseParModify = !filtre.checkPromptSafety(phrase).safe;
    page.journal.autoInpaint.length = 0; page.journal.img2img.length = 0;
    page.code.modifyModal.classList.remove('hidden');   // la fenetre se ferme a chaque lancement : on la rouvre (clic dans une fenetre fermee = rien)
    await page.taper(phrase);
    await page.cliquer();
    const appel = page.journal.autoInpaint[0];
    if (!appel) { nonRoutees++; continue; }
    assert.ok(!nommeVetement(phrase), 'un vetement du corps ne doit jamais etre route : ' + phrase);
    const avant = appelsMoteur(m.j);
    const r = await m.appeler(appel);
    const parti = appelsMoteur(m.j) > avant;
    if (refuseParModify) {
      if (r.success || parti) contournees.push({ phrase, cible: appel.targetText, remplacement: appel.prompt });
      else routeesRefusees++;
    } else {
      assert.equal(r.success, true, 'une consigne que Modify accepte ne doit pas etre refusee par la nouvelle verification : ' + phrase);
      routeesAcceptees++;
    }
  }
  assert.deepEqual(contournees, [], 'consignes refusees par Modify mais executees via la fenetre : ' + JSON.stringify(contournees.slice(0, 3)));
  // 20 : depuis le 21/10 les vetements du corps et les remplacements revelateurs ne sont plus routes (73 routees puis refusees), et depuis le
  // 22/10 une consigne qui nomme un enfant (girl, child, teenager, schoolgirl) non plus : 25 routees puis refusees (woman, man)
  assert.ok(routeesRefusees >= 20, 'le test doit exercer le chemin (routees puis refusees : ' + routeesRefusees + ')');
  assert.ok(nonRoutees + routeesAcceptees + routeesRefusees === corpus().length);
});

test('chaine complete (bureau) : les consignes du rapport qui nomment un vetement du corps ne sont PLUS routees (chemin d origine, Modify)', async () => {
  for (const phrase of PHRASES_TETE.filter(nommeVetement)) {
    const page = creerPage('bureau', { lang: 'en', mode: 'cloud' });
    await page.taper(phrase);
    await page.cliquer();
    assert.equal(page.journal.autoInpaint.length, 0, 'non routee : ' + phrase);
    assert.equal(page.journal.img2img.length, 1, 'chemin d origine : ' + phrase);
  }
});

test('chaine complete (bureau) : les memes consignes avec un vetement de DESSUS sont routees PAR LA FENETRE (cible et remplacement sans contexte) puis refusees', async () => {
  const m = monter();
  for (const phrase of PHRASES_ROUTEES) {
    const page = creerPage('bureau', { lang: 'en', mode: 'cloud' });
    await page.taper(phrase);
    await page.cliquer();
    assert.equal(page.journal.autoInpaint.length, 1, 'routee : ' + phrase);
    const a = page.journal.autoInpaint[0];
    assert.equal(a.consigne, phrase);
    assert.equal(a.consigneOriginale, phrase);
    const r = await m.appeler(a);
    assert.equal(r.success, false, phrase);
  }
  assert.equal(appelsMoteur(m.j), 0);
});

test("chaine complete (bureau) : consigne francaise -> texte tape ET texte traduit sont joints a l'appel", async () => {
  const page = creerPage('bureau', { lang: 'fr', mode: 'cloud', traductions: { 'retire les ailes': 'remove the wings' } });
  await page.taper('retire les ailes');
  await page.cliquer();
  const a = page.journal.autoInpaint[0];
  assert.equal(a.consigne, 'remove the wings');
  assert.equal(a.consigneOriginale, 'retire les ailes');
  assert.equal(a.targetText, 'wings');
});
