// Tests de CARACTERISATION des garde-fous de depense et d'acces (constat EXP-05, 03/10/2026) : plafonds (le zero coupe vraiment), compteurs atomiques,
// arret dur sur la facture reelle, messages de refus, hotes de confiance, anti-CSRF, paliers de generation. Une regression ici = une facture Modal qui derape
// ou une porte ouverte.
// Lancer (vivant) :  cd cloud && node --test tests/caracterisation-garde.test.mjs
// Lancer (reference) : WORKER_SRC=C:/tmp/vague2/tc/worker_HEAD.ts node --test tests/caracterisation-garde.test.mjs
// Les differences VOULUES de la vague 1 (palier Fast en atlas 2048, ADM-12) ont deux attentes explicites, HEAD contre vivant. Aucun reseau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chargerFonctions, chargerDepuisSource, chargerConstante, creerR2, creerSupabase, existe } from './_charge-worker.mjs';

const aujourdhui = () => new Date().toISOString().slice(0, 10);
const muet = (f) => async (...a) => { const m = { l: console.log, e: console.error, w: console.warn }; console.log = console.error = console.warn = () => {}; try { return await f(...a); } finally { console.log = m.l; console.error = m.e; console.warn = m.w; } };
// fonctions pures du module voisin src/prevision_modal.ts (importees par worker.ts) : chargees pour de vrai, pas remplacees
const PM = chargerDepuisSource(readFileSync(new URL('../src/prevision_modal.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n'), ['moisUtc', 'SEUIL_ARRETE_H']);
const AGE = chargerDepuisSource(readFileSync(new URL('../src/age_verification.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n'), ['PIN_ECHECS_MAX', 'PIN_VERROU_MS']);

/* ───────────── _plafond : le zero coupe vraiment ───────────── */
const PL = chargerFonctions(['_plafond']);
test('_plafond : absent, vide ou non numerique -> defaut', () => {
  for (const brut of [undefined, null, '', '   ', 'abc', 'NaN', 'Infinity', '-Infinity', '1e999']) assert.equal(PL._plafond(brut, 7), 7, String(brut));
});
test('_plafond : ZERO est une consigne respectee (jamais remplace par le defaut)', () => {
  assert.equal(PL._plafond('0', 10), 0); assert.equal(PL._plafond(' 0 ', 10), 0); assert.equal(PL._plafond('0.0', 10), 0); assert.equal(PL._plafond(0, 10), 0);
});
test('_plafond : valeurs valides lues telles quelles ; negatif ramene a zero (meme intention : couper)', () => {
  assert.equal(PL._plafond('12.5', 1), 12.5); assert.equal(PL._plafond('65', 1), 65); assert.equal(PL._plafond('1e2', 1), 100);
  assert.equal(PL._plafond('-3', 10), 0); assert.equal(PL._plafond('-0.01', 10), 0);
});

/* ───────────── hotes de confiance (SSRF) ───────────── */
const H = chargerFonctions(['isTrustedAssetHost']);
const ENV = { NEXT_PUBLIC_SITE_URL: 'https://site.example', R2_PUBLIC_URL: 'https://pub-abc.r2.dev', R2_ACCOUNT_ID: 'ACC123' };
const ok = (u, env = ENV) => H.isTrustedAssetHost(env, u);
test('isTrustedAssetHost : hotes de confiance acceptes (replicate.delivery et sous-domaines, pollinations, notre /r2/, notre r2.dev exact, notre compte R2)', () => {
  for (const u of ['https://replicate.delivery/a.png', 'https://pbxt.replicate.delivery/a.png', 'https://a.b.replicate.delivery/x', 'https://image.pollinations.ai/prompt/x',
    'https://site.example/r2/u1/a.png?exp=1&sig=2', 'https://pub-abc.r2.dev/u1/a.png', 'https://acc123.r2.cloudflarestorage.com/bucket/k', 'HTTPS://REPLICATE.DELIVERY/A.PNG'])
    assert.equal(ok(u), true, u);
});
test('isTrustedAssetHost : http, schemas exotiques, hotes inconnus et JOKERS partages refuses', () => {
  for (const u of ['http://replicate.delivery/a.png', 'ftp://replicate.delivery/a', 'file:///etc/passwd', 'data:text/html,x', 'javascript:alert(1)',
    'https://evil.example/a.png', 'https://attaquant.r2.dev/a.png', 'https://autre.workers.dev/r2/a.png', 'https://autre-compte.r2.cloudflarestorage.com/b/k',
    'https://localhost/a', 'https://127.0.0.1/a', 'https://169.254.169.254/latest', 'https://[::1]/a', '', 'pas une url', 'https://'])
    assert.equal(ok(u), false, u);
});
test('isTrustedAssetHost : pieges de nom d\'hote (suffixe colle, userinfo, sous-domaine d\'un hote exact)', () => {
  for (const u of ['https://evilreplicate.delivery/a', 'https://replicate.delivery.evil.example/a', 'https://replicate.delivery@evil.example/a', 'https://evil.example/replicate.delivery',
    'https://x.image.pollinations.ai/a', 'https://sub.site.example/r2/a.png', 'https://x.pub-abc.r2.dev/a'])
    assert.equal(ok(u), false, u);
});
test('isTrustedAssetHost : NOTRE hote n\'est de confiance que sous /r2/ ; r2.dev et compte R2 exigent la configuration', () => {
  assert.equal(ok('https://site.example/api/secret'), false);
  assert.equal(ok('https://site.example/'), false);
  assert.equal(ok('https://pub-abc.r2.dev/a', { ...ENV, R2_PUBLIC_URL: undefined }), false);
  assert.equal(ok('https://acc123.r2.cloudflarestorage.com/b/k', { ...ENV, R2_ACCOUNT_ID: undefined }), false);
  assert.equal(ok('https://site.example/r2/a', { ...ENV, NEXT_PUBLIC_SITE_URL: undefined }), false);
  assert.equal(ok('https://site.example/r2/a', { ...ENV, NEXT_PUBLIC_SITE_URL: 'pas une url' }), false, 'configuration invalide : refuse');
});

/* ───────────── anti-CSRF ───────────── */
const O = chargerFonctions(['_origineSuspecte']);
const rq = (origin, url = 'https://site.example/api/x') => new Request(url, { method: 'POST', headers: origin === undefined ? {} : { origin } });
test('_origineSuspecte : sans en-tete Origin (appli de bureau, scripts) -> pas suspecte', () => {
  assert.equal(O._origineSuspecte(rq(undefined), ENV), false);
});
test('_origineSuspecte : Origin = origine de la requete ou = NEXT_PUBLIC_SITE_URL -> pas suspecte', () => {
  assert.equal(O._origineSuspecte(rq('https://site.example'), ENV), false);
  assert.equal(O._origineSuspecte(rq('https://site.example', 'https://site.example/a?b=1'), { }), false, 'sans configuration : l\'origine de la requete suffit');
  assert.equal(O._origineSuspecte(rq('https://www.site.example', 'https://interne.workers.dev/api/x'), { NEXT_PUBLIC_SITE_URL: 'https://www.site.example/app' }), false, 'la configuration est comparee par son ORIGINE');
});
test('_origineSuspecte : autre site, schema http, port different, sous-domaine, "null" -> suspecte', () => {
  for (const o of ['https://evil.example', 'http://site.example', 'https://site.example:8443', 'https://sub.site.example', 'https://site.example.evil.example', 'null', 'https://site.example/', 'file://', 'n importe quoi'])
    assert.equal(O._origineSuspecte(rq(o), ENV), true, o);
});
test('_origineSuspecte : configuration invalide -> ferme par prudence (suspecte)', () => {
  assert.equal(O._origineSuspecte(rq('https://site.example'), { NEXT_PUBLIC_SITE_URL: 'pas une url' }), true);
});
// ADM-12 (2026-10-03, vague 1) : seconde couche anti-CSRF sur les ecritures d'administration. ABSENTE de HEAD : difference voulue.
const ADM12 = existe('ecritureAdminDepuisAutreOrigine');
test('ecritureAdminDepuisAutreOrigine (ADM-12, voulue : absente de HEAD) : ecritures /api/admin/* depuis une autre origine refusees, lectures et hors-admin intactes', () => {
  if (!ADM12) { assert.equal(existe('_origineSuspecte'), true, 'HEAD : seule la garde de base existe'); return; }
  const A = chargerFonctions(['_origineSuspecte', 'ecritureAdminDepuisAutreOrigine']);
  const f = (chemin, methode, origin) => A.ecritureAdminDepuisAutreOrigine(chemin, methode, rq(origin), ENV);
  assert.equal(f('/api/admin/credits', 'POST', 'https://evil.example'), true);
  assert.equal(f('/api/admin/credits', 'DELETE', 'https://evil.example'), true);
  assert.equal(f('/api/admin/credits', 'POST', 'https://site.example'), false);
  assert.equal(f('/api/admin/credits', 'POST', undefined), false, 'sans Origin (outil en ligne de commande) : inchange');
  for (const m of ['GET', 'HEAD', 'OPTIONS']) assert.equal(f('/api/admin/credits', m, 'https://evil.example'), false, m);
  assert.equal(f('/api/generate', 'POST', 'https://evil.example'), false, 'hors /api/admin/ : cette couche ne s\'applique pas');
  assert.equal(f('/api/administrateur', 'POST', 'https://evil.example'), false, 'le prefixe est /api/admin/ avec la barre');
});

/* ───────────── compteurs atomiques sur R2 ───────────── */
const sansAttente = { _attenteBruitee: () => 0 };
const CN = chargerFonctions(['todayUTC', 'r2GetText', '_casIncrementCounter', '_incrementAtomique'], sansAttente);
const compteur = (r2, cle) => parseFloat(r2.lire(cle) ?? 'NaN');
test('_casIncrementCounter : sans bucket R2 -> null (ferme)', async () => { assert.equal(await CN._casIncrementCounter({}, 'k', 1, 10), null); });
test('_casIncrementCounter : cree puis cumule, rend le nouveau total', async () => {
  const env = { MESHES: creerR2() };
  assert.equal(await CN._casIncrementCounter(env, 'k', 1, 10), 1); assert.equal(await CN._casIncrementCounter(env, 'k', 2.5, 10), 3.5);
  assert.equal(compteur(env.MESHES, 'k'), 3.5);
});
test('_casIncrementCounter : le maximum est INCLUS (cur + delta == max passe), au-dela -> null SANS ecrire', async () => {
  const env = { MESHES: creerR2({ k: '9' }) };
  assert.equal(await CN._casIncrementCounter(env, 'k', 1, 10), 10);
  assert.equal(await CN._casIncrementCounter(env, 'k', 1, 10), null); assert.equal(compteur(env.MESHES, 'k'), 10);
  assert.equal(await CN._casIncrementCounter(env, 'k', 0.01, 10), null);
});
test('_casIncrementCounter : maximum 0 refuse tout (le zero coupe)', async () => {
  assert.equal(await CN._casIncrementCounter({ MESHES: creerR2() }, 'k', 0.01, 0), null);
});
test('_casIncrementCounter : contenu illisible traite comme zero', async () => {
  const env = { MESHES: creerR2({ k: 'pas un nombre' }) };
  assert.equal(await CN._casIncrementCounter(env, 'k', 1, 10), 1);
});
test('_casIncrementCounter : contention SOUTENUE (6 echecs de suite) -> null, ferme, sans ecraser', async () => {
  const r2 = creerR2({ k: '3' }); r2.put = async () => null;
  assert.equal(await muet(CN._casIncrementCounter)({ MESHES: r2 }, 'k', 1, 10), null); assert.equal(compteur(r2, 'k'), 3);
});
test('_casIncrementCounter : contention passagere (2 echecs puis succes) -> le compteur avance quand meme', async () => {
  const r2 = creerR2({ k: '3' }); const vraiPut = r2.put.bind(r2); let echecs = 2;
  r2.put = async (...a) => (echecs-- > 0 ? null : vraiPut(...a));
  assert.equal(await CN._casIncrementCounter({ MESHES: r2 }, 'k', 1, 10), 4);
});
test('_casIncrementCounter : concurrence — aucun increment perdu, jamais au-dela du maximum', async () => {
  const r2 = creerR2(); const env = { MESHES: r2 };
  const rs = await muet(() => Promise.all(Array.from({ length: 12 }, () => CN._casIncrementCounter(env, 'k', 1, 5))))();
  const reussis = rs.filter((x) => x !== null);
  assert.ok(reussis.length <= 5, `${reussis.length} > 5`);
  assert.equal(compteur(r2, 'k'), reussis.length, 'le compteur = nombre exact de succes');
  assert.equal(new Set(reussis).size, reussis.length, 'chaque succes voit un total distinct');
});
test('_incrementAtomique : sans plafond, cree puis cumule ; sans bucket -> null', async () => {
  const env = { MESHES: creerR2() };
  assert.equal(await CN._incrementAtomique(env, 'k', 1.5), 1.5); assert.equal(await CN._incrementAtomique(env, 'k', 1000), 1001.5);
  assert.equal(await CN._incrementAtomique({}, 'k', 1), null);
});
test('_incrementAtomique : contention soutenue -> renonce (null) plutot qu\'ecraser', async () => {
  const r2 = creerR2({ k: '3' }); r2.put = async () => null;
  assert.equal(await CN._incrementAtomique({ MESHES: r2 }, 'k', 1), null); assert.equal(compteur(r2, 'k'), 3);
});
test('_incrementAtomique : concurrence — la somme finale est exacte (aucun increment perdu quand tous reussissent)', async () => {
  const r2 = creerR2(); const env = { MESHES: r2 };
  const rs = await Promise.all(Array.from({ length: 8 }, () => CN._incrementAtomique(env, 'k', 1)));
  assert.equal(compteur(r2, 'k'), rs.filter((x) => x !== null).length);
});
test('_attenteBruitee : attente croissante bornee, bruitee entre 50 % et 150 % de la base', () => {
  const A = chargerFonctions(['_attenteBruitee']);
  assert.equal(A._attenteBruitee(0), 0);
  for (const [essai, base] of [[1, 25], [2, 60], [3, 110], [4, 180], [5, 280], [9, 280]])
    for (let i = 0; i < 50; i++) { const v = A._attenteBruitee(essai); assert.ok(v >= Math.round(base * 0.5) && v <= Math.round(base * 1.5), `${essai}: ${v}`); }
});

/* ───────────── arret dur sur la facture reelle ───────────── */
function mondeBudget({ r2 = {}, env = {}, alertes } = {}) {
  const bucket = creerR2(r2);
  const f = chargerFonctions(['todayUTC', 'r2GetText', '_budgetR2', '_budgetReelEpuise'], { moisUtc: PM.moisUtc, SEUIL_ARRETE_H: PM.SEUIL_ARRETE_H, _alerteUsageReelMuet: async (_e, raison) => { alertes?.push(raison); } });
  return { f, env: { MESHES: bucket, ...env }, bucket };
}
const releve = (usage, ts = new Date().toISOString(), mois) => JSON.stringify({ usage, ts, ...(mois ? { mois } : {}) });
test('_budgetReelEpuise : SEUIL_ARRETE_H = 26 h', () => { assert.equal(PM.SEUIL_ARRETE_H, 26); });
test('_budgetReelEpuise : sans bucket -> false ; sans budget defini -> false (aucune reference)', async () => {
  assert.equal(await mondeBudget().f._budgetReelEpuise({}), false);
  const m = mondeBudget(); assert.equal(await m.f._budgetReelEpuise(m.env), false);
});
test('_budgetReelEpuise : budget ZERO ecrit dans R2 -> arret dur actif (un zero est une consigne)', async () => {
  const m = mondeBudget({ r2: { '_meta/modal_budget_total.txt': '0' }, env: { MODAL_BUDGET_USD: '65' } });
  assert.equal(await muet(m.f._budgetReelEpuise)(m.env), true, 'le zero de R2 prime sur la variable d\'environnement');
});
test('_budgetReelEpuise : MODAL_BUDGET_USD = 0 -> arret dur actif ; "0 " et "0.00" aussi', async () => {
  for (const v of ['0', ' 0 ', '0.00', '-5']) {
    const m = mondeBudget({ env: { MODAL_BUDGET_USD: v } });
    assert.equal(await muet(m.f._budgetReelEpuise)(m.env), true, v);
  }
});
test('_budgetReelEpuise : variable vide ou non numerique = absente (pas d\'arret)', async () => {
  for (const v of ['', '  ', 'abc']) { const m = mondeBudget({ env: { MODAL_BUDGET_USD: v } }); assert.equal(await m.f._budgetReelEpuise(m.env), false, JSON.stringify(v)); }
});
test('_budgetReelEpuise : usage reel sous / egal / au-dessus du budget (>= declenche)', async () => {
  const cas = [[64.99, false], [65, true], [90, true], [0, false]];
  for (const [usage, attendu] of cas) {
    const m = mondeBudget({ r2: { '_meta/modal_real_usage.json': releve(usage) }, env: { MODAL_BUDGET_USD: '65' } });
    assert.equal(await muet(m.f._budgetReelEpuise)(m.env), attendu, String(usage));
  }
});
test('_budgetReelEpuise : le budget de R2 (ecran admin) prime sur la variable d\'environnement', async () => {
  const m = mondeBudget({ r2: { '_meta/modal_budget_total.txt': '100', '_meta/modal_real_usage.json': releve(80) }, env: { MODAL_BUDGET_USD: '65' } });
  assert.equal(await m.f._budgetReelEpuise(m.env), false);
});
test('_budgetReelEpuise : releve absent ou perime (> 26 h) -> mode ouvert + alerte ; frais (25 h) -> applique', async () => {
  let alertes = [];
  let m = mondeBudget({ env: { MODAL_BUDGET_USD: '65' }, alertes });
  assert.equal(await m.f._budgetReelEpuise(m.env), false); assert.deepEqual(alertes, ['jamais publie']);
  alertes = [];
  m = mondeBudget({ r2: { '_meta/modal_real_usage.json': releve(999, new Date(Date.now() - 27 * 3600e3).toISOString()) }, env: { MODAL_BUDGET_USD: '65' }, alertes });
  assert.equal(await m.f._budgetReelEpuise(m.env), false); assert.equal(alertes.length, 1); assert.match(alertes[0], /perime/);
  m = mondeBudget({ r2: { '_meta/modal_real_usage.json': releve(999, new Date(Date.now() - 25 * 3600e3).toISOString(), PM.moisUtc(Date.now())) }, env: { MODAL_BUDGET_USD: '65' } });
  assert.equal(await muet(m.f._budgetReelEpuise)(m.env), true);
});
test('_budgetReelEpuise : releve d\'un mois PRECEDENT -> mode ouvert (Modal remet son compteur a zero le 1er)', async () => {
  const m = mondeBudget({ r2: { '_meta/modal_real_usage.json': releve(999, new Date().toISOString(), '2020-01') }, env: { MODAL_BUDGET_USD: '65' } });
  assert.equal(await muet(m.f._budgetReelEpuise)(m.env), false);
});
test('_budgetReelEpuise : releve illisible ou sans champ -> false, jamais d\'exception', async () => {
  for (const contenu of ['{pas du json', '{}', '{"usage":"x","ts":"y"}', '{"usage":100}']) {
    const m = mondeBudget({ r2: { '_meta/modal_real_usage.json': contenu }, env: { MODAL_BUDGET_USD: '65' } });
    assert.equal(await muet(m.f._budgetReelEpuise)(m.env), false, contenu);
  }
});

/* ───────────── plafonds de depense journaliers ───────────── */
const NOMS_DEPENSE = ['todayUTC', 'r2GetText', '_plafond', '_casIncrementCounter', '_incrementAtomique', '_cleSpendUser', '_cleCapUser', '_isPaidAccount',
  'DEFAULT_MAX_DAILY_SPEND_USD', 'DEFAULT_MAX_MODAL_SPEND_USD', 'DEFAULT_MAX_USER_DAILY_CALLS', 'DEFAULT_MAX_USER_DAILY_SPEND_USD',
  'checkAndIncrementUserDailySpend', 'checkAndIncrementDailySpend', 'refundDailySpend', 'checkAndIncrementModalSpend', 'refundModalSpend', 'checkAndIncrementUserCalls'];
function mondeDepense({ r2 = {}, env = {}, budgetEpuise = false, payants = [] } = {}) {
  const bucket = creerR2(r2);
  const sb = creerSupabase({ payments: payants.map((u, i) => ({ id: i + 1, user_id: u, credits: 25 })) });
  const f = chargerFonctions(NOMS_DEPENSE, { ...sansAttente, supabaseAdmin: () => sb, _budgetReelEpuise: async () => budgetEpuise });
  return { f, env: { MESHES: bucket, ...env }, r2: bucket, sb };
}
const j = aujourdhui;
test('valeurs par defaut des plafonds : Replicate 0,50 $ ; Modal 2 $ ; compte 2 $ et 10 appels par jour', () => {
  const m = mondeDepense();
  assert.deepEqual([m.f.DEFAULT_MAX_DAILY_SPEND_USD, m.f.DEFAULT_MAX_MODAL_SPEND_USD, m.f.DEFAULT_MAX_USER_DAILY_SPEND_USD, m.f.DEFAULT_MAX_USER_DAILY_CALLS], [0.5, 2, 2, 10]);
});
test('cles des compteurs : plafond (userspend_cap) et comptabilite (userspend) sont DEUX cles distinctes, par jour UTC', () => {
  const m = mondeDepense();
  assert.equal(m.f._cleCapUser('u1'), `_meta/userspend_cap/u1/${j()}`); assert.equal(m.f._cleSpendUser('u1'), `_meta/userspend/u1/${j()}`);
});
test('checkAndIncrementUserDailySpend : plafond du compte (2 $ par defaut), reste rendu, comptabilite parallele non plafonnee', async () => {
  const m = mondeDepense();
  assert.equal(m.f.DEFAULT_MAX_USER_DAILY_SPEND_USD - 0.5, 1.5);
  assert.equal(await m.f.checkAndIncrementUserDailySpend(m.env, 'u1', 0.5), 1.5);
  assert.equal(await m.f.checkAndIncrementUserDailySpend(m.env, 'u1', 1.5), 0);
  assert.equal(await m.f.checkAndIncrementUserDailySpend(m.env, 'u1', 0.01), null);
  assert.equal(compteur(m.r2, m.f._cleCapUser('u1')), 2); assert.equal(compteur(m.r2, m.f._cleSpendUser('u1')), 2, 'la comptabilite additionne ce qui a ete accorde');
});
test('checkAndIncrementUserDailySpend : MAX_USER_DAILY_SPEND_USD=0 coupe vraiment', async () => {
  const m = mondeDepense({ env: { MAX_USER_DAILY_SPEND_USD: '0' } });
  assert.equal(await m.f.checkAndIncrementUserDailySpend(m.env, 'u1', 0.01), null);
});
test('checkAndIncrementDailySpend (Replicate) : plafond global puis par compte ; refus par compte -> le global est RENDU', async () => {
  const m = mondeDepense({ env: { MAX_DAILY_SPEND_USD: '1', MAX_USER_DAILY_SPEND_USD: '0.4' } });
  assert.equal(await m.f.checkAndIncrementDailySpend(m.env, 0.3, 'u1'), 0.7);
  assert.equal(await m.f.checkAndIncrementDailySpend(m.env, 0.3, 'u1'), null, 'le compte atteint son plafond personnel (0,6 > 0,4)');
  assert.equal(compteur(m.r2, `_meta/spend/${j()}`), 0.3, 'le global a ete defait pour le refus');
  assert.equal(await m.f.checkAndIncrementDailySpend(m.env, 0.3, 'u2'), 0.4, 'un autre compte passe');
  assert.equal(await m.f.checkAndIncrementDailySpend(m.env, 0.5), null, 'sans compte : seul le global s\'applique (0,6 + 0,5 > 1)');
});
test('checkAndIncrementDailySpend : MAX_DAILY_SPEND_USD=0 coupe vraiment', async () => {
  const m = mondeDepense({ env: { MAX_DAILY_SPEND_USD: '0' } });
  assert.equal(await m.f.checkAndIncrementDailySpend(m.env, 0.01, 'u1'), null);
});
test('refundDailySpend : rend au global et aux DEUX compteurs du compte, jamais sous zero', async () => {
  const m = mondeDepense({ r2: { [`_meta/spend/${j()}`]: '0.5', [`_meta/userspend_cap/u1/${j()}`]: '0.3', [`_meta/userspend/u1/${j()}`]: '0.3' } });
  await m.f.refundDailySpend(m.env, 0.2, 'u1');
  const proche = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
  proche(compteur(m.r2, `_meta/spend/${j()}`), 0.3); proche(compteur(m.r2, `_meta/userspend_cap/u1/${j()}`), 0.1); proche(compteur(m.r2, `_meta/userspend/u1/${j()}`), 0.1);
  await m.f.refundDailySpend(m.env, 99, 'u1');
  assert.equal(compteur(m.r2, `_meta/spend/${j()}`), 0); assert.equal(compteur(m.r2, `_meta/userspend_cap/u1/${j()}`), 0);
});
test('checkAndIncrementModalSpend : arret dur sur la facture reelle -> refuse tout le monde, payants compris', async () => {
  const m = mondeDepense({ budgetEpuise: true, payants: ['p1'] });
  assert.equal(await m.f.checkAndIncrementModalSpend(m.env, 0.1, 'u1'), null); assert.equal(await m.f.checkAndIncrementModalSpend(m.env, 0.1, 'p1'), null);
  assert.equal(m.r2.lire(`_meta/modal_spend/${j()}`), undefined, 'rien n\'est compte');
});
test('checkAndIncrementModalSpend : compte gratuit — plafond global 2 $ par defaut, le reste est rendu', async () => {
  const m = mondeDepense({ env: { MAX_USER_DAILY_SPEND_USD: '100' } });
  assert.equal(await m.f.checkAndIncrementModalSpend(m.env, 0.5, 'u1'), 1.5);
  assert.equal(await m.f.checkAndIncrementModalSpend(m.env, 1.5, 'u2'), 0);
  assert.equal(await m.f.checkAndIncrementModalSpend(m.env, 0.01, 'u3'), null);
  assert.equal(compteur(m.r2, `_meta/modal_spend/${j()}`), 2);
});
test('checkAndIncrementModalSpend : MAX_DAILY_MODAL_SPEND_USD=0 coupe vraiment les comptes gratuits', async () => {
  const m = mondeDepense({ env: { MAX_DAILY_MODAL_SPEND_USD: '0' } });
  assert.equal(await m.f.checkAndIncrementModalSpend(m.env, 0.01, 'u1'), null);
});
test('checkAndIncrementModalSpend : refus par le plafond PERSONNEL -> le global est defait, le personnel inchange', async () => {
  const m = mondeDepense({ env: { MAX_USER_DAILY_SPEND_USD: '0.4' } });
  assert.equal(await m.f.checkAndIncrementModalSpend(m.env, 0.3, 'u1') !== null, true);
  assert.equal(await m.f.checkAndIncrementModalSpend(m.env, 0.3, 'u1'), null);
  assert.equal(compteur(m.r2, `_meta/modal_spend/${j()}`), 0.3, 'global defait');
  assert.equal(compteur(m.r2, m.f._cleCapUser('u1')), 0.3, 'le compteur personnel n\'a pas bouge pour le refus');
});
test('checkAndIncrementModalSpend : compte PAYANT jamais rationne (plafond global ignore), mais depense comptee partout', async () => {
  const m = mondeDepense({ payants: ['p1'], r2: { [`_meta/modal_spend/${j()}`]: '1.9' } });
  assert.equal(await m.f.checkAndIncrementModalSpend(m.env, 5, 'p1'), 2, 'rend le plafond (non borne)');
  assert.equal(compteur(m.r2, `_meta/modal_spend/${j()}`), 6.9);
  assert.equal(compteur(m.r2, m.f._cleSpendUser('p1')), 5, 'comptabilite personnelle');
  assert.equal(compteur(m.r2, '_meta/modal_spend_total.txt'), 5);
  assert.equal(m.r2.lire(m.f._cleCapUser('p1')), undefined, 'le compteur de PLAFOND n\'est pas touche par un payant');
});
test('checkAndIncrementModalSpend : un compte devenu payant — le marqueur _meta/paid/<uid> est ecrit et reutilise sans Supabase', async () => {
  const m = mondeDepense({ payants: ['p1'] });
  await m.f.checkAndIncrementModalSpend(m.env, 0.1, 'p1');
  assert.equal(m.r2.lire('_meta/paid/p1'), '1');
  m.sb.tables.payments.length = 0;
  assert.equal(await m.f._isPaidAccount(m.env, 'p1'), true, 'marqueur permanent');
});
test('_isPaidAccount : un paiement a credits = 0 (rembourse) ne compte PAS ; marqueur negatif du jour ; panne -> non payant', async () => {
  const m = mondeDepense();
  m.sb.tables.payments.push({ id: 1, user_id: 'r1', credits: 0 });
  assert.equal(await m.f._isPaidAccount(m.env, 'r1'), false);
  assert.equal(m.r2.lire(`_meta/paidcheck/r1/${j()}`), '0');
  assert.equal(await m.f._isPaidAccount(m.env, ''), false); assert.equal(await m.f._isPaidAccount({}, 'u'), false);
  const f2 = chargerFonctions(['todayUTC', 'r2GetText', '_isPaidAccount'], { supabaseAdmin: () => { throw new Error('base HS'); } });
  assert.equal(await f2._isPaidAccount({ MESHES: creerR2() }, 'u9'), false, 'au doute : non payant, donc plafonds appliques');
});
test('refundModalSpend : rend au global et au cumul, jamais sous zero ; compteur personnel SEULEMENT si userId fourni', async () => {
  const m = mondeDepense({ r2: { [`_meta/modal_spend/${j()}`]: '1', '_meta/modal_spend_total.txt': '1', [`_meta/userspend/u1/${j()}`]: '0.5', [`_meta/userspend_cap/u1/${j()}`]: '0.5' } });
  await m.f.refundModalSpend(m.env, 0.25);
  assert.equal(compteur(m.r2, `_meta/modal_spend/${j()}`), 0.75); assert.equal(compteur(m.r2, '_meta/modal_spend_total.txt'), 0.75); assert.equal(compteur(m.r2, m.f._cleSpendUser('u1')), 0.5);
  await m.f.refundModalSpend(m.env, 0.25, 'u1');
  assert.equal(compteur(m.r2, m.f._cleSpendUser('u1')), 0.25);
  await m.f.refundModalSpend(m.env, 100, 'u1');
  assert.equal(compteur(m.r2, `_meta/modal_spend/${j()}`), 0); assert.equal(compteur(m.r2, '_meta/modal_spend_total.txt'), 0); assert.equal(compteur(m.r2, m.f._cleSpendUser('u1')), 0);
});
test('checkAndIncrementUserCalls : 10 appels par jour pour un compte gratuit (restes 9..0), le 11e est refuse', async () => {
  const m = mondeDepense();
  const restes = []; for (let i = 0; i < 10; i++) restes.push(await m.f.checkAndIncrementUserCalls(m.env, 'u1'));
  assert.deepEqual(restes, [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
  assert.equal(await m.f.checkAndIncrementUserCalls(m.env, 'u1'), null);
  assert.equal(await m.f.checkAndIncrementUserCalls(m.env, 'u2'), 9, 'chaque compte a son compteur');
});
test('checkAndIncrementUserCalls : un compte PAYANT n\'est jamais refuse, mais l\'appel est compte', async () => {
  const m = mondeDepense({ payants: ['p1'], env: { MAX_USER_DAILY_CALLS: '2' } });
  const r = []; for (let i = 0; i < 5; i++) r.push(await m.f.checkAndIncrementUserCalls(m.env, 'p1'));
  assert.deepEqual(r, [1, 0, 2, 2, 2]);
  assert.equal(compteur(m.r2, `_meta/userdaily/p1/${j()}`), 5);
});
test('checkAndIncrementUserCalls : MAX_USER_DAILY_CALLS=0 coupe les gratuits (le zero est respecte)', async () => {
  const m = mondeDepense({ env: { MAX_USER_DAILY_CALLS: '0' } });
  assert.equal(await m.f.checkAndIncrementUserCalls(m.env, 'u1'), null);
});

/* ───────────── message de refus : dit la VRAIE cause ───────────── */
function mondeRefus({ r2 = {}, env = {}, payants = [], budgetEpuise = false } = {}) {
  const bucket = creerR2(r2);
  const sb = creerSupabase({ payments: payants.map((u, i) => ({ id: i + 1, user_id: u, credits: 25 })) });
  const f = chargerFonctions(['todayUTC', 'r2GetText', '_plafond', '_cleCapUser', '_isPaidAccount', '_spendRefusalMessage', 'DEFAULT_MAX_MODAL_SPEND_USD', 'DEFAULT_MAX_USER_DAILY_SPEND_USD'],
    { supabaseAdmin: () => sb, _limiteCalculAtteinte: async () => budgetEpuise });
  return { f, env: { MESHES: bucket, ...env } };
}
const msg = (m, uid) => m.f._spendRefusalMessage(m.env, uid);
test('_spendRefusalMessage : arret dur sur la facture -> "Cloud generation is paused", credits saufs', async () => {
  const t = await msg(mondeRefus({ budgetEpuise: true }), 'u1');
  assert.match(t, /^Cloud generation is paused/); assert.match(t, /credits are safe/);
});
test('_spendRefusalMessage : sans compte ou sans bucket -> capacite quotidienne generique (reset minuit UTC)', async () => {
  for (const t of [await msg(mondeRefus(), undefined), await msg({ ...mondeRefus(), env: {} }, 'u1')]) { assert.match(t, /^The service has reached its daily capacity/); assert.match(t, /midnight UTC/); assert.match(t, /not charged/); }
});
test('_spendRefusalMessage : compte au-dessus de 80 % de SON plafond -> limite des comptes gratuits', async () => {
  const m = mondeRefus({ r2: { [`_meta/userspend_cap/u1/${aujourdhui()}`]: '1.6' } });
  assert.match(await msg(m, 'u1'), /^You have reached today's generation limit for free accounts/);
});
test('_spendRefusalMessage : plafond global loin d\'etre atteint (< 80 %) -> c\'est forcement le plafond PERSONNEL qui refuse', async () => {
  const m = mondeRefus({ r2: { [`_meta/modal_spend/${aujourdhui()}`]: '0.5' } });
  assert.match(await msg(m, 'u1'), /^You have reached today's generation limit for free accounts/);
});
test('_spendRefusalMessage : global proche du plafond — gratuit : "Free accounts share a daily cloud capacity" ; payant : generique', async () => {
  const r2 = { [`_meta/modal_spend/${aujourdhui()}`]: '1.9' };
  assert.match(await msg(mondeRefus({ r2 }), 'u1'), /^Free accounts share a daily cloud capacity/);
  assert.match(await msg(mondeRefus({ r2, payants: ['p1'] }), 'p1'), /^The service has reached its daily capacity/);
});
test('_spendRefusalMessage : les plafonds de l\'environnement sont respectes, y compris le zero', async () => {
  // plafond global a 0 : 0 >= 0 -> pas "loin du plafond" ; le compte n'a rien depense
  const m = mondeRefus({ env: { MAX_DAILY_MODAL_SPEND_USD: '0' } });
  assert.match(await msg(m, 'u1'), /^Free accounts share a daily cloud capacity/);
  const m2 = mondeRefus({ env: { MAX_USER_DAILY_SPEND_USD: '0' } });
  assert.match(await msg(m2, 'u1'), /^You have reached today's generation limit for free accounts/, 'plafond personnel 0 : 0 >= 0');
});
test('_spendRefusalMessage : tous les messages rassurent (credits saufs / pas debite)', async () => {
  for (const m of [mondeRefus({ budgetEpuise: true }), mondeRefus(), mondeRefus({ r2: { [`_meta/userspend_cap/u1/${aujourdhui()}`]: '2' } }), mondeRefus({ r2: { [`_meta/modal_spend/${aujourdhui()}`]: '2' } })])
    assert.match(await msg(m, 'u1'), /credits are safe|not charged/);
});

/* ───────────── limite de debit : essais de PIN ───────────── */
test('PIN : 5 essais par fenetre de 15 minutes (constantes du module age_verification)', () => {
  assert.equal(AGE.PIN_ECHECS_MAX, 5); assert.equal(AGE.PIN_VERROU_MS, 15 * 60 * 1000);
});
test('PIN : compteur atomique par fenetre — le 6e essai est refuse, un autre compte n\'est pas touche, la cle est celle de la fenetre courante', async () => {
  const f = chargerFonctions(['_pinFenetre', '_pinBloqueSecondes', '_casIncrementCounter', 'r2GetText'], { ...sansAttente, PIN_VERROU_MS: AGE.PIN_VERROU_MS, PIN_ECHECS_MAX: AGE.PIN_ECHECS_MAX });
  const env = { MESHES: creerR2() };
  const w = f._pinFenetre('u1');
  assert.match(w.cle, /^_meta\/pinfail\/u1\/\d+$/); assert.ok(w.resteS > 0 && w.resteS <= 900);
  assert.equal(await f._pinBloqueSecondes(env, 'u1'), 0);
  for (let i = 1; i <= 5; i++) assert.equal(await f._casIncrementCounter(env, w.cle, 1, AGE.PIN_ECHECS_MAX), i);
  assert.equal(await f._casIncrementCounter(env, w.cle, 1, AGE.PIN_ECHECS_MAX), null, '6e essai refuse');
  const bloque = await f._pinBloqueSecondes(env, 'u1'); assert.ok(bloque > 0 && bloque <= 900);
  assert.equal(await f._pinBloqueSecondes(env, 'u2'), 0);
  assert.equal(await f._pinBloqueSecondes({}, 'u1'), 0);
});

/* ───────────── paliers de generation ───────────── */
// DIFFERENCE VOULUE de la vague 1 (2026-10-03, palier Fast) : fast passe de l'atlas 1024 a 2048 (table au niveau du fichier, tailleAtlasGeneration).
const TABLE_VIVANTE = existe('PALIERS_GENERATION');
const PALIERS = chargerConstante(TABLE_VIVANTE ? 'PALIERS_GENERATION' : 'PALIERS');
test('paliers de generation : pas de diffusion (24 / 24 / 32 / 32) et atlas (quality et 8K en 4096, balanced en 2048)', () => {
  assert.deepEqual(Object.keys(PALIERS).sort(), ['balanced', 'fast', 'quality', 'ultra_8k']);
  assert.deepEqual(['fast', 'balanced', 'quality', 'ultra_8k'].map((k) => PALIERS[k].pas), [24, 24, 32, 32]);
  assert.deepEqual(['balanced', 'quality', 'ultra_8k'].map((k) => PALIERS[k].atlas), [2048, 4096, 4096]);
});
test('palier fast — DEUX attentes : HEAD = atlas 1024, vivant = atlas 2048 (voulu, 2026-10-03)', () => {
  assert.equal(PALIERS.fast.atlas, TABLE_VIVANTE ? 2048 : 1024);
});
test('paliers : jamais un palier superieur avec moins de pas ni un atlas plus petit', () => {
  const o = ['fast', 'balanced', 'quality', 'ultra_8k'];
  for (let i = 1; i < o.length; i++) { assert.ok(PALIERS[o[i]].pas >= PALIERS[o[i - 1]].pas, o[i]); assert.ok(PALIERS[o[i]].atlas >= PALIERS[o[i - 1]].atlas, o[i]); }
});
test('tailleAtlasGeneration (vivant) : ultra_hd -> 4096 d\'abord, puis le palier, puis le mode historique', () => {
  if (!existe('tailleAtlasGeneration')) { assert.equal(TABLE_VIVANTE, false, 'HEAD : la regle est ecrite en ligne dans handleGenerate'); return; }
  const T = chargerFonctions(['PALIERS_GENERATION', 'tailleAtlasGeneration']).tailleAtlasGeneration;
  assert.equal(T({ ultra_hd: true, preset: 'fast' }), 4096); assert.equal(T({ ultra_hd: true }), 4096);
  assert.equal(T({ preset: 'fast' }), 2048); assert.equal(T({ preset: 'balanced' }), 2048); assert.equal(T({ preset: 'quality' }), 4096); assert.equal(T({ preset: 'ultra_8k' }), 4096);
  assert.equal(T({ mode: 'full' }), 2048); assert.equal(T({}), 1024); assert.equal(T({ mode: 'lite' }), 1024);
  assert.equal(T({ preset: 'inconnu', mode: 'full' }), 2048, 'palier inconnu : repli sur le mode');
  assert.equal(T({ preset: 'fast', mode: 'full' }), 2048);
});
const DELAI = (() => {
  const noms = ['_delaiMaxGenerationS'];
  if (existe('tailleAtlasGeneration')) noms.push('PALIERS_GENERATION', 'tailleAtlasGeneration');
  return chargerFonctions(noms)._delaiMaxGenerationS;
})();
test('_delaiMaxGenerationS : borne entre 40 min et 3 h 30', () => {
  assert.equal(DELAI({ preset: 'fast' }, false), 2400, 'plancher');
  // pire cas realiste : (600 + 300 + 3430 + 240 + 180 + 300) * 2 = 10 100 s, sous le plafond de 12 600 s
  assert.equal(DELAI({ preset: 'ultra_8k', max_tris: 10_000_000, refine: true, face_fix: true, ultra_hd: true }, true), 10_100);
  for (const preset of [undefined, 'fast', 'balanced', 'quality', 'ultra_8k']) for (const t of [undefined, 50_000, 5_000_000, 10_000_000]) {
    const d = DELAI({ preset, max_tris: t }, t > 5_000_000); assert.ok(d >= 2400 && d <= 12_600, `${preset}/${t}=${d}`);
  }
});
test('_delaiMaxGenerationS : croit avec les triangles, la grille 1536 et les options', () => {
  const base = DELAI({ preset: 'quality', max_tris: 4_000_000 }, false);
  assert.ok(DELAI({ preset: 'quality', max_tris: 8_000_000 }, false) > base);
  assert.ok(DELAI({ preset: 'quality', max_tris: 4_000_000 }, true) > base);
  assert.ok(DELAI({ preset: 'quality', max_tris: 4_000_000, ultra_hd: true }, false) > base);
});
test('_delaiMaxGenerationS : palier fast avec beaucoup de triangles — DEUX attentes (HEAD 1024 -> 2400 s ; vivant 2048 -> plus long, voulu)', () => {
  const d = DELAI({ preset: 'fast', max_tris: 10_000_000 }, true);
  // HEAD : tex 1024 (facteur 0,5) : (600 + 300 + 350) * 2 = 2500 ; vivant : tex 2048 (facteur 1) : (600 + 300 + 700) * 2 = 3200
  assert.equal(d, TABLE_VIVANTE ? 3200 : 2500);
});
test('_delaiMaxGenerationS : palier quality (4096) — meme valeur HEAD et vivant', () => {
  assert.equal(DELAI({ preset: 'quality', max_tris: 4_000_000 }, false), (600 + Math.round(70 * 4 * 4.9)) * 2);
});
