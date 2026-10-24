// Lot « securite mineurs et robustesse du filtre de texte » cote WORKER (audit langue / moderation du 11/10/2026 : MODERATION-04,
// MODERATION-07, SERVEUR-09). Charge les VRAIES fonctions de cloud/src/worker.ts (transpilees) et le VRAI filtre
// (cloud/src/nsfw_filter.ts) ; aucun appel reseau : session, Supabase, R2, Modal et fetch sont des doublures.
// Lancer : cd cloud && node --test tests/moderation-worker.test.mjs
// Ancien code (le test ECHOUE dessus) : git show HEAD:cloud/src/worker.ts > <tmp>/w.ts ; git show HEAD:cloud/src/nsfw_filter.ts > <tmp>/f.ts ;
//   WORKER_SRC=<tmp>/w.ts NSFW_FILTER_SRC=<tmp>/f.ts node --test tests/moderation-worker.test.mjs
// Aucun contenu explicite en clair : les textes sont assembles par fragments (F).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chargerFonctions, existe, creerR2 } from './_charge-worker.mjs';
const require = createRequire(import.meta.url);
const ts = require('typescript');

const F = (...m) => m.join('');
const ENFANT = F('chi', 'ld'), NA = F('na', 'ked');

// ── Filtre reel ────────────────────────────────────────────────────────────────────────────────────────────────────
const cheminFiltre = process.env.NSFW_FILTER_SRC || new URL('../src/nsfw_filter.ts', import.meta.url);
const filtre = {};
new Function('exports', 'require', ts.transpileModule(readFileSync(cheminFiltre, 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(filtre, require);
// Sur l'ancien filtre, les fonctions du 13/10 n'existent pas : la doublure laisse passer le texte tel quel (le test echoue
// alors par COMPORTEMENT, pas par chargement).
const FILTRE = {
  checkPromptSafety: filtre.checkPromptSafety,
  controlerLongueurPrompt: filtre.controlerLongueurPrompt ?? (() => ({ safe: true })),
  neutraliserSyntaxePrompt: filtre.neutraliserSyntaxePrompt ?? ((t) => t),
  PROMPT_MAX_CARACTERES: filtre.PROMPT_MAX_CARACTERES ?? 2000,
  PROMPT_MAX_ENRICHI: filtre.PROMPT_MAX_ENRICHI ?? 4000,
};

/** Charge `noms` (ceux que l'exemplaire teste ne declare pas sont ignores). */
const charger = (noms, doublures = {}) => chargerFonctions(noms.filter((n) => existe(n)), doublures);
// Integration 24/10 : integration-2 ajoute les negations de l'utilisateur (_nettoyerNegativeExtra...) et le filet de langue (doublure neutre ici :
// ce fichier teste la BORNE et le filtre, le filet a ses propres tests dans traduction-serveur.test.mjs).
const NEGATIONS_UTILISATEUR = ['_nettoyerNegativeExtra', '_texteDeModerationNegations', 'NEG_MAX_DIRECT', 'NEG_MAX_LONG', 'NEG_MAX_CARS', 'NEG_SENSIBLES'];
const FILET_NEUTRE = {
  _filetLangue: async (_e, _u, texte) => { const textes = Array.isArray(texte) ? texte : [texte]; return { texte: textes[0], textes, traduit: false, langues: [] }; },
  LangueTexte: { morceauxEtrangers: () => [] },
};
const COMMUN = ['json', 'err', 'SECURITY_HEADERS', '_refusLongueur', 'NEGATIF_TEX_VARIANT_PERMIS', '_negatifTexVariant', ...NEGATIONS_UTILISATEUR, '_refusChaineEnvoyee',
  '_checkPromptSafetyAlerte', 'categorieContenuGrave', 'alerteContenuDue', 'texteAlerteContenu', '_alerterContenuGrave',
  'ALERTE_CONTENU_FENETRE_MS'];

/** Monde de test : un compte, des espions sur tout ce qui depense ou appelle Modal. */
function monde({ unrestricted = false, sortieRedacteur = 'a brave knight with a red cape' } = {}) {
  const appels = [];
  const espion = (nom, rendu) => async (...args) => { appels.push({ nom, args }); return typeof rendu === 'function' ? rendu(...args) : rendu; };
  const courriels = [];
  const doublures = {
    ...FILTRE,
    ...FILET_NEUTRE,
    getSessionUser: async () => ({ id: '7c1d9e20-aaaa-4bbb-8ccc-0123456789ab' }),
    getParentalState: async () => ({ unrestricted }),
    getPrice: async () => 3,
    _prixImageSelonPas: (p) => p, _prixImageComplet: (p) => p,
    checkAndIncrementModalSpend: espion('budget', 1), checkAndIncrementDailySpend: espion('budget', 1),
    checkAndIncrementUserCalls: espion('appels', 1), spendCredits: espion('debit', 10), addCredits: espion('remboursement'),
    refundModalSpend: espion('rembourse_budget'), refundDailySpend: espion('rembourse_budget'),
    callModalText2Image: espion('modal', 'https://site/r2/a.png'), callMyfabmeshCog: espion('cog', 'https://site/r2/a.png'),
    callModalTpose: espion('tpose', 'https://site/r2/a.png'), callModalImageOp: espion('image_op', { url: 'https://site/r2/b.png' }),
    logOperation: espion('journal'), insertUserAsset: espion('actif'), r2PathFromPublicUrl: () => 'k', isTrustedAssetHost: () => true,
    _spendRefusalMessage: async () => 'refus', _sendAdminAlertEmail: async (_e, sujet) => { courriels.push(sujet); },
    REDACTEUR_TYPES: new Set(['character']), prechauffeRedacteurDue: () => true, PRECHAUFFE_REDACTEUR_FENETRE_MS: 60000,
    fetch: espion('fetch', () => new Response(JSON.stringify({ ok: true, description: sortieRedacteur, type: 'character' }),
      { status: 200, headers: { 'content-type': 'application/json' } })),
  };
  const env = { MESHES: creerR2(), MODAL_TEXT2IMAGE_URL: 'https://modal/t2i', MODAL_IMAGE_OP_URL: 'https://modal/image_op',
    MODAL_REDACTEUR_URL: 'https://modal/redacteur', MODAL_SHARED_SECRET: 's', R2_PUBLIC_URL: 'https://site/r2' };
  const nomsAppeles = () => appels.map((a) => a.nom);
  return { doublures, env, appels, nomsAppeles, courriels };
}
const requete = (route, corps) => new Request('https://site' + route, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify(corps) });
const DEPENSES = ['budget', 'appels', 'debit', 'modal', 'cog', 'tpose', 'image_op'];

/* ═══════════════ MODERATION-07 / SERVEUR-09 : borne de longueur AVANT le filtre et tout debit ═══════════════ */
test('_refusLongueur : 400 de la meme forme que les refus du filtre, au-dela de la borne ponderee', async () => {
  assert.ok(existe('_refusLongueur'), '_refusLongueur absent de worker.ts');
  const { doublures } = monde();
  const w = charger(COMMUN, doublures);
  assert.equal(w._refusLongueur('x'.repeat(2000)), null);
  const r = w._refusLongueur('x'.repeat(2001));
  assert.equal(r.status, 400);
  const b = await r.json();
  assert.equal(b.blocked, 'length');
  assert.equal(b.success, false);
  assert.match(b.error, /too long/);
  assert.equal(w._refusLongueur('x'.repeat(3999), 4000), null);
});

test('generate-image : description trop longue refusee (400) SANS budget, appel, debit ni Modal ; prompt enrichi du bureau jusqu a 4000', async () => {
  const m = monde();
  const w = charger([...COMMUN, 'handleGenerateImage'], m.doublures);
  const r = await w.handleGenerateImage(requete('/api/generate-image', { userPrompt: 'a knight '.repeat(300), prompt: 'a knight' }), m.env);
  assert.equal(r.status, 400);
  assert.equal((await r.json()).blocked, 'length');
  assert.deepEqual(m.nomsAppeles().filter((n) => DEPENSES.includes(n)), []);
  // l'appli de bureau n'envoie que le prompt ENRICHI (gabarits compris) : borne 4000, pas 2000
  const m2 = monde();
  const w2 = charger([...COMMUN, 'handleGenerateImage'], m2.doublures);
  const r2 = await w2.handleGenerateImage(requete('/api/generate-image', { prompt: 'a knight, '.repeat(300) }), m2.env);
  assert.equal(r2.status, 200);
  assert.ok(m2.nomsAppeles().includes('modal'));
});

/* ═══════════════ MODERATION-04 : champs de texte oublies ═══════════════ */
test('auto-inpaint : le texte CIBLE passe le filtre, et le plancher voit cible + remplacement ENSEMBLE (meme sous unrestricted)', async () => {
  // compte sans restriction : chaque champ passe seul ; le plancher les refuse ensemble
  const m = monde({ unrestricted: true });
  const w = charger([...COMMUN, 'handleAutoInpaint'], m.doublures);
  const r = await w.handleAutoInpaint(requete('/api/auto-inpaint', { imageUrl: 'https://site/r2/x.png', targetText: ENFANT, prompt: NA }), m.env);
  assert.equal(r.status, 400);
  assert.equal((await r.json()).blocked, 'minor-safety');
  assert.deepEqual(m.nomsAppeles().filter((n) => DEPENSES.includes(n)), []);
  assert.equal(m.courriels.length, 1, 'alerte d exploitant sur le plancher');
  // compte ordinaire : une nudite dans la CIBLE seule est refusee par le filtre general
  const m2 = monde();
  const w2 = charger([...COMMUN, 'handleAutoInpaint'], m2.doublures);
  const r2 = await w2.handleAutoInpaint(requete('/api/auto-inpaint', { imageUrl: 'https://site/r2/x.png', targetText: `${NA} woman`, prompt: 'a red dress' }), m2.env);
  assert.equal(r2.status, 400);
  assert.deepEqual(m2.nomsAppeles().filter((n) => DEPENSES.includes(n)), []);
  // legitime : le filtre general reste champ par champ (« bed » en cible, jouet d'enfant en remplacement)
  const m3 = monde();
  const w3 = charger([...COMMUN, 'handleAutoInpaint'], m3.doublures);
  const r3 = await w3.handleAutoInpaint(requete('/api/auto-inpaint', { imageUrl: 'https://site/r2/x.png', targetText: 'bed', prompt: "child's toy box" }), m3.env);
  assert.equal(r3.status, 200);
  // cible trop longue
  const m4 = monde();
  const w4 = charger([...COMMUN, 'handleAutoInpaint'], m4.doublures);
  const r4 = await w4.handleAutoInpaint(requete('/api/auto-inpaint', { imageUrl: 'https://site/r2/x.png', targetText: 'shirt '.repeat(60), prompt: 'cape' }), m4.env);
  assert.equal(r4.status, 400);
});

test('tex-variant : le negatif ne garde que les termes envoyes par les clients (aucun vetement, aucune ponderation)', async () => {
  const m = monde();
  const w = charger([...COMMUN, 'handleTexVariant'], m.doublures);
  const r = await w.handleTexVariant(requete('/api/tex-variant', { imageUrl: 'https://site/r2/x.png', prompt: 'older, weathered',
    negPrompt: 'clothes, Deformed,  dress, (shirt:2), nsfw, nude, deformed, jacket' }), m.env);
  assert.equal(r.status, 200);
  const appel = m.appels.find((a) => a.nom === 'image_op');
  assert.equal(appel.args[2].negPrompt, 'deformed, nsfw, nude');
  // les negatifs reels des deux clients passent intacts (NEG_VARIANTE_PERSONNAGE et l'outil Age)
  const client = 'deformed, distorted, changed shape, different pose, extra parts, missing parts, blurry, low quality, different person, '
    + 'different face, animal head, werewolf, nude, nsfw, green skin, blue skin, grey skin, colored skin, body paint, monochrome, color tint';
  assert.equal(charger(COMMUN, m.doublures)._negatifTexVariant(client), client);
  assert.equal(charger(COMMUN, m.doublures)._negatifTexVariant('clothes, dress'), undefined);
});

test('describe-asset : nom et notes filtres AVANT le redacteur, sa description APRES ; un refus garde le contrat { ok:false }', async () => {
  // entree refusee : le redacteur n'est pas appele
  const m = monde();
  const w = charger([...COMMUN, 'handleDescribeAsset'], m.doublures);
  const r = await w.handleDescribeAsset(requete('/api/describe-asset', { name: `${ENFANT} ${NA}`, notes: '' }), m.env);
  assert.deepEqual(await r.json(), { ok: false, raison: 'blocked', error: filtre.checkPromptSafety(`${ENFANT} ${NA}`).reason, blocked: 'minor-safety' });
  assert.ok(!m.nomsAppeles().includes('fetch'), 'le redacteur ne doit pas recevoir le texte refuse');
  // sortie refusee : la description n'est pas rendue
  const m2 = monde({ sortieRedacteur: `a woman, ${NA}` });
  const w2 = charger([...COMMUN, 'handleDescribeAsset'], m2.doublures);
  const r2 = await (await w2.handleDescribeAsset(requete('/api/describe-asset', { name: 'warrior', notes: '' }), m2.env)).json();
  assert.equal(r2.ok, false);
  assert.equal(r2.raison, 'blocked');
  assert.equal(r2.description, undefined);
  // legitime
  const m3 = monde();
  const w3 = charger([...COMMUN, 'handleDescribeAsset'], m3.doublures);
  const r3 = await (await w3.handleDescribeAsset(requete('/api/describe-asset', { name: 'knight', notes: 'red cape' }), m3.env)).json();
  assert.equal(r3.ok, true);
  assert.equal(r3.description, 'a brave knight with a red cape');
});

/* ═══════════════ MODERATION-07 : texte NEUTRALISE au moment de partir chez Modal ═══════════════ */
test('callModalImageOp : prompt, cible et negatif partent neutralises (jetons speciaux casses, poids bornes, caracteres effaces)', async () => {
  const corps = [];
  const fauxFetch = async (_url, init) => { corps.push(JSON.parse(init.body)); return new Response('{"detail":"masque vide"}', { status: 422 }); };
  const w = chargerFonctions(['callModalImageOp'], { ...FILTRE, fetch: fauxFetch, RAPPELS_524: [], _writeLastWarmMs: async () => {} });
  const env = { MODAL_IMAGE_OP_URL: 'https://modal/image_op', MODAL_SHARED_SECRET: 's' };
  await w.callModalImageOp(env, 'u', { op: 'auto_inpaint', imageUrl: 'https://site/r2/x.png', prompt: 'a (cape:99999) <|endoftext|> robe',
    targetText: 'shi' + String.fromCharCode(1) + 'rt' }, 'inpaint');
  await w.callModalImageOp(env, 'u', { op: 'tex_variant', imageUrl: 'https://site/r2/x.png', prompt: 'older', negPrompt: '(dress:-5)' }, 'texvar');
  assert.equal(corps[0].prompt, 'a (cape:2)  endoftext  robe');
  assert.equal(corps[0].target_text, 'shirt');
  assert.equal(corps[1].neg_prompt, '(dress:0.5)');
});

test('callModalText2Image : le prompt part neutralise', async () => {
  const corps = [];
  const fauxFetch = async (_url, init) => { corps.push(JSON.parse(init.body)); return new Response('erreur', { status: 500 }); };
  const w = chargerFonctions(['callModalText2Image', 'COUT_REPRISE_IMAGE_USD', ...NEGATIONS_UTILISATEUR].filter((n) => existe(n)),
    { ...FILTRE, fetch: fauxFetch, RAPPELS_524: [], _incrementAtomique: async () => {}, todayUTC: () => '2026-10-13' });
  await assert.rejects(w.callModalText2Image({ MODAL_TEXT2IMAGE_URL: 'https://modal/t2i', MODAL_SHARED_SECRET: 's' }, 'u',
    { prompt: 'a knight <|startoftext|> (cape:-3)', asset_type: 'character' }, 'front'));
  assert.equal(corps[0].prompt, 'a knight  startoftext  (cape:0.5)');
});
