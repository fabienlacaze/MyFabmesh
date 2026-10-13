// Refus du serveur traduits cote client (lot interface multilingue, 2026-10-13 ; constat INTERFACE-03 de l'audit du 11/10).
// Prouve :
//  1. le worker ajoute un CODE stable (+ le prix) a toute reponse d'erreur, sans toucher au texte anglais ni aux codes existants ;
//  2. chaque message « insufficient credits » ecrit dans worker.ts recoit ce code, avec son prix quand il est dit ;
//  3. le module client lib/textes-serveur.js (bureau = web) reconnait les MEMES familles que le worker ;
//  4. avec les VRAIS dictionnaires, la boite « plus assez de credits » et les refus s'affichent dans les 5 langues ;
//  5. les VRAIS showToast / customError des deux index2.js affichent la traduction, et le bouton d'achat suit toujours le texte anglais.
// Lancer : cd cloud && node --test tests/codes-refus.test.mjs
// Preuve sur l'ancien code : WORKER_SRC=<worker.ts de HEAD> RACINE_DEPOT=<copie de HEAD> node --test tests/codes-refus.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chargerFonctions, lireSource } from './_charge-worker.mjs';
import { creerPage } from './_dom-minimal.mjs';

const require = createRequire(import.meta.url);
const acorn = require('acorn');
const RACINE = process.env.RACINE_DEPOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const lire = (rel) => fs.readFileSync(path.join(RACINE, rel), 'utf8');
const LANGUES = ['fr', 'es', 'zh', 'hi', 'ar'];

// Messages tels qu'ecrits dans worker.ts (chacun est verifie present dans la source).
const ECHANTILLONS = [
  ['insufficient credits', 'insufficient_credits', undefined],
  ['Cloud generation is paused for now — your credits are safe and you were not charged. ', 'compute_paused'],
  ['Free accounts share a daily cloud capacity, which has been used up for today. ', 'free_capacity_used'],
  ["You have reached today's generation limit for free accounts. It resets at midnight UTC. ", 'free_daily_limit'],
  ['Your account has reached its daily safety limit for cloud generation. It resets at midnight UTC. ', 'account_safety_limit'],
  ['The service has reached its daily capacity. It resets at midnight UTC. ', 'service_daily_capacity'],
  ['you have reached the per-user daily generation limit.', 'daily_call_limit'],
  ['per-user daily generation limit reached.', 'daily_call_limit'],
  ['user limit reached.', 'daily_call_limit'],
  ['too many failed attempts; try again in an hour', 'too_many_failed_attempts'],
  ['daily mesh upload quota reached', 'upload_quota'],
  ['Too many messages from this IP today. Try again tomorrow.', 'contact_rate_limited'],
  ['too many reports today from this account', 'reports_rate_limited'],
  ['Payments are temporarily unavailable. Please try again later.', 'payments_unavailable'],
  ['site temporarily disabled by admin', 'site_disabled'],
  ['account deletion could not start (temporary error) - nothing was deleted, please try again', 'account_deletion_failed'],
  ['unauthorized', 'unauthorized'],
  ['forbidden', 'forbidden'],
  ['not found', 'not_found'],
];

function worker() {
  // VRAIS json / err / _avecCodeRefus du worker, VRAIE classe Response de node
  return chargerFonctions(['REFUS_CONNUS', 'codeRefus', 'avecCodeRefus', '_avecCodeRefus', 'SECURITY_HEADERS', 'json', 'err']);
}
/** Ce que le client recoit : la reponse du routeur passee par la sortie de fetch. */
async function sortie(w, res) { const r = await w._avecCodeRefus(res); return { status: r.status, corps: await r.json(), type: r.headers.get('content-type') }; }

test('worker : une reponse d erreur recoit un code stable et le prix ; texte anglais, codes existants et succes intacts', async () => {
  const w = worker();
  const r = await sortie(w, w.json({ ok: false, success: false, error: 'insufficient credits — image generation costs 6 credits' }, { status: 402 }));
  assert.equal(r.status, 402);
  assert.match(r.type, /application\/json/);
  assert.deepEqual(r.corps, { ok: false, success: false, error: 'insufficient credits — image generation costs 6 credits', code: 'insufficient_credits', params: { cost: 6 } });
  assert.deepEqual((await sortie(w, w.err(401, 'unauthorized'))).corps, { error: 'unauthorized', code: 'unauthorized' });
  // un code deja pose par la route n'est jamais remplace
  assert.deepEqual((await sortie(w, w.json({ error: 'too_many_attempts', code: 'too_many_attempts' }, { status: 429 }))).corps, { error: 'too_many_attempts', code: 'too_many_attempts' });
  // une reponse de succes, un tableau, un message inconnu, une page HTML : inchanges
  assert.deepEqual((await sortie(w, w.json({ ok: true, error: 'insufficient credits' }))).corps, { ok: true, error: 'insufficient credits' });
  assert.deepEqual((await sortie(w, w.json([1, 2], { status: 400 }))).corps, [1, 2]);
  assert.deepEqual((await sortie(w, w.err(400, 'bad json'))).corps, { error: 'bad json' });
  const page = new Response('<h1>404</h1>', { status: 404, headers: { 'content-type': 'text/html' } });
  assert.equal(await w._avecCodeRefus(page), page, 'une page HTML est rendue telle quelle');
  // json() / err() eux-memes sont inchanges (les tests qui les chargent seuls restent valides)
  assert.deepEqual(await w.err(401, 'unauthorized').json(), { error: 'unauthorized' });
  assert.deepEqual((await sortie(w, w.err(402, 'insufficient credits — upscale x2 costs 3'))).corps.params, { cost: 3 }, 'un chiffre AVANT « costs » ne trompe pas la lecture du prix');
});

test('worker : chaque reponse du routeur (requete de session OU par cle d API) passe par _avecCodeRefus', () => {
  const src = lireSource();
  const i = src.indexOf('async fetch(req: Request, envBrut: Env');
  assert.ok(i > 0);
  const corps = src.slice(i, src.indexOf('\n};', i) + 3);   // fin de l'objet exporte (accolade en colonne 0)
  assert.match(corps, /try \{ return await _avecCodeRefus\(await _routeur\(req, envBrut, ctx\)\); \}/);
  // le routeur enveloppe est celui que la garde des cles d'API appelle aussi
  assert.match(corps, /return await _avecCleApi\(req, _envAvecReprises\(envBrut\), routeur, ctx\);\s+return await routeur\(\);/);
});

test('worker : CHAQUE message « insufficient credits » ecrit dans worker.ts recoit le code, avec son prix quand il est dit', () => {
  const w = worker();
  const src = lireSource();
  const msgs = [...src.matchAll(/(['`])(insufficient credits[^'`]*)\1/g)].map((m) => m[2].replace(/\$\{[^}]*\}/g, '7'));
  assert.ok(msgs.length >= 20, 'messages trouves : ' + msgs.length);
  for (const m of msgs) {
    const c = w.codeRefus(m);
    assert.equal(c && c.code, 'insufficient_credits', m);
    if (/\bcosts?\s+7\b/.test(m)) assert.deepEqual(c.params, { cost: 7 }, m);
  }
});

test('worker : chaque famille de refus a son code (echantillons tels qu ecrits dans worker.ts)', () => {
  const w = worker();
  const src = lireSource();
  for (const [m, code] of ECHANTILLONS) {
    assert.ok(src.includes(m.trim().slice(0, 40)), 'message absent de worker.ts (texte modifie ?) : ' + m);
    assert.equal(w.codeRefus(m.trim()).code, code, m);
  }
});

function client(rel) {
  const p = creerPage();
  p.executer(lire(rel), rel);
  return p.fenetre.FabMessages;
}

test('client : lib/textes-serveur.js (bureau ET web, identiques) reconnait les memes familles que le worker', () => {
  const w = worker();
  const src = lireSource();
  const tous = ECHANTILLONS.map((e) => e[0].trim())
    .concat([...src.matchAll(/(['`])(insufficient credits[^'`]*)\1/g)].map((m) => m[2].replace(/\$\{[^}]*\}/g, '7')));
  assert.equal(lire('src/renderer/lib/textes-serveur.js').replace(/\r\n/g, '\n'), lire('cloud/public/app/lib/textes-serveur.js').replace(/\r\n/g, '\n'));
  for (const rel of ['src/renderer/lib/textes-serveur.js', 'cloud/public/app/lib/textes-serveur.js']) {
    const fm = client(rel);
    for (const m of tous) {
      const a = w.codeRefus(m);
      const b = fm.reconnaitre(m);
      assert.equal(b && b.code, a && a.code, rel + ' : ' + m);
      // objets de deux royaumes (vm) : comparaison par JSON
      assert.equal(JSON.stringify(b && b.params ? b.params : null), JSON.stringify(a && a.params ? a.params : null), rel + ' (parametres) : ' + m);
    }
  }
});

/** Page avec le VRAI i18n.js et les VRAIS dictionnaires d'une cible, puis le module des refus. */
function pageReelle(cible, lang) {
  const base = cible === 'web' ? 'cloud/public/app' : 'src/renderer';
  const p = creerPage({ html: '<div id="zone"></div>', stockage: { 'fabmesh.lang.choisi': lang } });
  p.executer(lire(base + '/i18n.js'), 'i18n.js');
  const html = lire(cible === 'web' ? 'cloud/public/app/index.html' : 'src/renderer/index2.html');
  for (const m of html.matchAll(/<script src="(lang\/[^"]+|lib\/textes-serveur\.js)"><\/script>/g)) p.executer(lire(base + '/' + m[1]), m[1]);
  p.charger();
  return p;
}

for (const cible of ['web', 'bureau']) {
  test(`${cible} : refus du serveur affiches dans les 5 langues avec les vrais dictionnaires (credits, plafonds, session)`, () => {
    for (const L of LANGUES) {
      const p = pageReelle(cible, L);
      const fm = p.fenetre.FabMessages;
      assert.ok(fm, 'lib/textes-serveur.js non charge par la page');
      const credits = fm.traduire('insufficient credits — image generation costs 6 credits');
      assert.notEqual(credits, 'insufficient credits — image generation costs 6 credits', L);
      assert.match(credits, /6/, L + ' : le prix doit rester affiche');
      for (const m of ['insufficient credits', 'unauthorized', 'per-user daily generation limit reached.', 'Cloud generation is paused for now — your credits are safe and you were not charged. Please try again later.', 'Not enough MyFabmesh credits. Top up on the website.']) {
        assert.notEqual(fm.traduire(m), m, L + ' : ' + m);
      }
      // « Export failed: » + detail : gabarit traduit, detail serveur traduit a son tour
      const ex = fm.traduire('Export failed: insufficient credits');
      assert.ok(!/Export failed|insufficient credits/.test(ex), L + ' : ' + ex);
      // code envoye par le serveur pour un texte que le client ne connait pas
      fm.retenir({ error: 'quota of the new kind reached', code: 'insufficient_credits', params: { cost: 3 } });
      assert.match(fm.traduire('quota of the new kind reached'), /3/);
      assert.notEqual(fm.traduire('quota of the new kind reached'), 'quota of the new kind reached');
    }
    const fr = pageReelle(cible, 'fr').fenetre.FabMessages;
    assert.equal(fr.traduire('insufficient credits — image generation costs 6 credits'), 'Pas assez de crédits : cette action coûte 6 crédits.');
    assert.equal(fr.traduire('insufficient credits — face-fix costs 1'), 'Pas assez de crédits : cette action coûte 1 crédit.');
    // anglais : rien ne change
    assert.equal(pageReelle(cible, 'en').fenetre.FabMessages.traduire('insufficient credits'), 'insufficient credits');
  });
}

for (const cible of ['web', 'bureau']) {
  test(`${cible} : « <Prefixe>: <detail> » traduit des que son gabarit existe (« Error: », « Failed: », « Server not responding: »)`, () => {
    const fr = pageReelle(cible, 'fr').fenetre.FabMessages;
    assert.equal(fr.traduire('Error: insufficient credits'), 'Erreur : Pas assez de crédits.');
    assert.equal(fr.traduire('Failed: unauthorized'), 'Échec : Votre session a expiré. Reconnectez-vous.');
    assert.equal(fr.traduire('Server not responding: HTTP 502'), 'Le serveur ne répond pas : HTTP 502', 'detail inconnu : garde son texte');
    // prefixe sans gabarit, prefixe trop long ou sur plusieurs lignes : texte d'origine
    assert.equal(fr.traduire('Zorglub: insufficient credits'), 'Zorglub: insufficient credits');
    assert.equal(fr.traduire('a\nError: insufficient credits'), 'a\nError: insufficient credits');
    for (const L of LANGUES) {
      const v = pageReelle(cible, L).fenetre.FabMessages.traduire('Error: insufficient credits — image generation costs 6 credits');
      // (« Error » s'ecrit « Error » en espagnol : seul le detail anglais du serveur doit disparaitre)
      assert.ok(!/insufficient/.test(v), L + ' : ' + v);
      assert.notEqual(v, 'Error: insufficient credits — image generation costs 6 credits', L);
      assert.match(v, /6/, L + ' : le prix reste affiche');
    }
  });
}

/** Fonctions de premier niveau d'un fichier, par nom (analyse acorn). */
function extraire(rel, noms) {
  const src = lire(rel);
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
  const out = [];
  for (const n of ast.body) if (n.type === 'FunctionDeclaration' && noms.includes(n.id.name)) out.push(src.slice(n.start, n.end));
  assert.equal(out.length, noms.length, rel + ' : fonctions introuvables (' + noms.join(', ') + ')');
  return out.join('\n');
}

for (const [cible, rel] of [['web', 'cloud/public/app/index2.js'], ['bureau', 'src/renderer/index2.js']]) {
  test(`${cible} : le VRAI showToast affiche le refus traduit et propose toujours l'achat (le test porte sur l'anglais)`, () => {
    const p = pageReelle(cible, 'es');
    const achats = [];
    p.fenetre._masquerMoteursErr = (t) => String(t);
    p.fenetre._refusCapacite = () => null;
    p.fenetre.promptBuyCredits = (m) => achats.push(m);
    p.fenetre._openCloudSite = () => {};
    p.fenetre._activeToasts = new Map();
    p.executer(extraire(rel, ['_traduireServeur', 'showToast']) + '\nwindow.__toast = showToast;', 'index2-extrait.js');
    p.fenetre.__toast('insufficient credits — recolor costs 4 credits', 'error');
    const t = p.document.getElementById('toast-container');
    assert.ok(t, 'aucune notification');
    const texte = t.textContent;
    assert.ok(!/insufficient credits/.test(texte), 'notification en anglais : ' + texte);
    assert.match(texte, /4/);
    assert.equal(achats.length, 1, 'la boite d achat doit s ouvrir (motif teste sur le texte anglais)');
  });
}
