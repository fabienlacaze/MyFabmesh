// Auto Inpaint, BUREAU (src/main/main.js, gestionnaire IPC 'auto-inpaint') — chaine de securite, 2026-10-20.
// Avant : le gestionnaire ne verifiait RIEN (le gestionnaire 'img2img' verifie son prompt). « Modify » refusait un texte que « Auto Inpaint »
// laissait passer par ses champs « Find » et « Replace with » ; depuis que « Modify image » confie les retraits a ce moteur, c'est la meme porte.
// Ce test charge le VRAI gestionnaire et le VRAI filtre de main.js (sans Electron, sans reseau, sans GPU) et prouve :
//   - un texte refuse par Modify l'est aussi ici, dans l'un OU l'autre champ, et une combinaison repartie entre les deux champs aussi ;
//   - un refus ne declenche AUCUN appel au moteur (ni cloud, ni serveur local, ni sous-processus) ;
//   - la chaine VERIFIEE est la chaine ENVOYEE (rognee une seule fois, puis utilisee telle quelle) ;
//   - un retrait legitime passe, a l'identique de l'ancien comportement.
// Lancer : node --test tests/main/auto-inpaint-securite.test.mjs        Contre l'ancien code : MAIN_JS=<chemin> node --test ...
// AUCUN contenu explicite reel : cas assembles a partir de fragments.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filtre, monter, regler } from './_auto-inpaint-main.mjs';

const F = (...m) => m.join('');
const NU = F('na', 'ked');
const FEMME = 'woman';
const SANS_VETEMENT = F('no clo', 'thing');

test('Modify refuse ce texte (prompt de la fenetre) : point de reference du test', () => {
  assert.equal(filtre.checkPromptSafety(F('replace the dress with ', NU)).safe, false);
  assert.equal(filtre.checkPromptSafety(FEMME + '. ' + SANS_VETEMENT).safe, false, 'la combinaison personne + nudite est refusee sur le texte JOINT');
  assert.equal(filtre.checkPromptSafety(FEMME).safe, true, 'seul, le mot personne passe');
  assert.equal(filtre.checkPromptSafety(SANS_VETEMENT).safe, true, 'seul, le second champ passe');
});

test("un terme refuse dans « Replace with » est refuse, rien ne part vers le moteur (local ET cloud)", async () => {
  for (const cloud of [false, true]) {
    const m = monter({ cloud });
    const r = await m.appeler({ targetText: 'dress', prompt: F('a ', NU, ' body') });
    assert.equal(r.success, false);
    assert.match(r.reason ?? r.error, /Content filter|blocked/i);
    assert.deepEqual([m.j.cloud.length, m.j.serveur.length, m.j.processus.length], [0, 0, 0], 'aucun appel moteur (cloud=' + cloud + ')');
  }
});

test("un terme refuse dans « Find » (texte cherche) est refuse lui aussi", async () => {
  const m = monter();
  const r = await m.appeler({ targetText: F(NU, ' skin'), prompt: '' });
  assert.equal(r.success, false);
  assert.deepEqual([m.j.cloud.length, m.j.serveur.length, m.j.processus.length], [0, 0, 0]);
});

test("une combinaison repartie entre « Find » et « Replace with » (personne + nudite) est refusee : seul le texte joint la voit", async () => {
  const m = monter();
  const r = await m.appeler({ targetText: FEMME, prompt: SANS_VETEMENT });
  assert.equal(r.success, false, 'chaque champ passe seul, le texte joint non');
  assert.deepEqual([m.j.cloud.length, m.j.serveur.length, m.j.processus.length], [0, 0, 0]);
});

test('le plancher illegal reste intouchable, meme en mode sans restriction', async () => {
  regler.sansRestriction(true);
  try {
    const m = monter();
    const r = await m.appeler({ targetText: 'dress', prompt: F('child ', NU) });
    assert.equal(r.success, false);
    assert.equal(m.j.serveur.length + m.j.cloud.length, 0);
  } finally { regler.sansRestriction(false); }
});

test('un retrait legitime passe : « wings », remplacement vide (serveur local)', async () => {
  const m = monter();
  const r = await m.appeler({ targetText: 'wings', prompt: '', dilate: 15, rel: 0.585 });
  assert.equal(r.success, true);
  assert.equal(m.j.serveur.length, 1);
  assert.equal(m.j.serveur[0][0], '/inpaint');
  assert.equal(m.j.serveur[0][1].target, 'wings');
  assert.equal(m.j.serveur[0][1].prompt, '');
  assert.equal(m.j.serveur[0][1].rel, 0.585);
});

test('la chaine VERIFIEE est la chaine ENVOYEE : texte rogne une seule fois, partout (local et cloud)', async () => {
  const local = monter();
  await local.appeler({ targetText: '  wings  ', prompt: '  a hat \n' });
  assert.equal(local.j.serveur[0][1].target, 'wings');
  assert.equal(local.j.serveur[0][1].prompt, 'a hat');
  const cloud = monter({ cloud: true });
  await cloud.appeler({ targetText: '  wings  ', prompt: '  a hat \n' });
  assert.equal(cloud.j.cloud[0].extraBody.targetText, 'wings');
  assert.equal(cloud.j.cloud[0].extraBody.prompt, 'a hat');
  // la classification IA est interrogee sur le texte joint verifie, pas sur autre chose
  assert.deepEqual(local.j.ia, ['wings. a hat']);
});

test("« Replace with » vide reste vide (retrait) ; champs absents ou non texte ne plantent pas", async () => {
  const m = monter();
  assert.equal((await m.appeler({ targetText: 'hat' })).success, true);
  assert.equal(m.j.serveur[0][1].prompt, '');
  assert.doesNotThrow(() => monter().appeler({ targetText: 12, prompt: null }));
});

test("le classificateur IA est consulte aussi (refus = aucun appel moteur)", async () => {
  const m = monter({ aiSafe: false });
  const r = await m.appeler({ targetText: 'hat', prompt: '' });
  assert.equal(r.success, false);
  assert.equal(m.j.serveur.length, 0);
});
