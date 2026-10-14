// TRADUCTION COTE SERVEUR (2026-10-13, lot 2 de l'audit de la langue du 11/10) — VRAIES fonctions de cloud/src/worker.ts, doublures seulement
// (aucun reseau, aucun modele : Workers AI simule).
//   /api/translate (TRADUCTION-01/07/08/16, CHAMPS-04/25, SERVEUR-11) : toutes les langues du modele, langue du TEXTE d'abord, code
//     regional normalise, anglais jamais envoye, texte long decoupe, corps nul sans 500, plafond par compte, raison de chaque refus.
//   Filet de langue (SERVEUR-01, CHAMPS-12) : un texte manifestement non anglais est traduit AVANT tout debit, ou refuse (422, rien debite) ;
//     « Envoyer tel quel » (langueVerifiee) est respecte ; un gabarit anglais n'est jamais touche ; le texte traduit repasse le filtre.
// Lancer : cd cloud && node --test tests/traduction-serveur.test.mjs
// Ancien code : WORKER_SRC=<copie de worker.ts> node --test tests/traduction-serveur.test.mjs  (les assertions de comportement echouent)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chargerFonctions, existe, creerR2 } from './_charge-worker.mjs';

const LIB = process.env.LIB_LANGUE || new URL('../public/app/lib/langue-texte.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const dossier = mkdtempSync(join(tmpdir(), 'traduction-serveur-'));
let LangueTexte;
try {
  const copie = join(dossier, 'langue-texte.mjs');
  writeFileSync(copie, readFileSync(LIB, 'utf-8'));
  LangueTexte = await import(pathToFileURL(copie).href);
} finally {
  rmSync(dossier, { recursive: true, force: true });
}

const reponse = (o, init) => new Response(JSON.stringify(o), { status: (init && init.status) || 200, headers: { 'content-type': 'application/json' } });
const err = (status, message) => reponse({ error: message }, { status });
const json = (o, init) => reponse(o, init);

/** Les declarations demandees qui EXISTENT dans l'exemplaire charge (l'ancien worker n'a ni filet ni decoupe : on charge ce qu'il a, et
 *  ce sont les assertions de COMPORTEMENT qui echouent, pas le chargement). */
const charger = (noms, doublures) => chargerFonctions(noms.filter((n) => existe(n)), doublures);
const AUXILIAIRES = ['_traduireVersAnglais', '_decouperPourTraduction', '_derniereCoupe', '_plafondTraduction', 'TRADUCTION_MAX_CARACTERES',
  'TRADUCTION_MORCEAU_MAX', 'TRADUCTION_PLAFOND_HEURE', 'TRADUCTION_PLAFOND_JOUR', 'LANGUES_TRADUITES', '_filetLangue',
  '_quotaTraduction', '_refusFiletLangue', 'TRADUCTION_APPELS_PAR_REQUETE'];

/** Faux Workers AI : traduit en prefixant « EN: », ou echoue / rend du vide / boucle sur demande. */
function fauxAI({ mode = 'ok' } = {}) {
  const appels = [];
  return {
    appels,
    async run(modele, entree) {
      appels.push({ modele, ...entree });
      if (mode === 'panne') throw new Error('quota depasse');
      if (mode === 'vide') return { translated_text: '' };
      if (mode === 'boucle') return { translated_text: 'a dog, '.repeat(8000) };
      return { translated_text: 'EN:' + entree.text };
    },
  };
}

function monterTraduction({ ai = fauxAI(), session = true, r2 = creerR2() } = {}) {
  const w = charger(['handleTranslate', ...AUXILIAIRES], {
    getSessionUser: async () => (session ? { id: 'u1', email: 'a@b.c' } : null), err, json, LangueTexte,
    _checkPromptSafetyAlerte: async () => ({ safe: true }),
  });
  const env = { AI: ai, MESHES: r2 };
  const appeler = async (corps, brut) => {
    const r = await w.handleTranslate(new Request('https://x.example/api/translate',
      { method: 'POST', body: brut !== undefined ? brut : JSON.stringify(corps) }), env);
    return { status: r.status, corps: await r.json() };
  };
  return { appeler, ai, r2, env };
}

test('/api/translate : les langues HORS interface sont traduites (avant : de, pt, ru, ja, ko, tr, it, nl, pl repartaient brutes)', async () => {
  const cas = [['de', 'ein roter Drache mit Flügeln'], ['pt', 'um dragão vermelho com asas'], ['ru', 'красный дракон с крыльями'],
    ['ja', '赤いドラゴン'], ['ko', '빨간 용'], ['tr', 'kanatlı kırmızı bir ejderha'], ['it', 'un drago rosso con le ali'],
    ['nl', 'een rode draak met vleugels'], ['pl', 'czerwony smok ze skrzydłami']];
  for (const [lg, texte] of cas) {
    const { appeler, ai } = monterTraduction();
    const r = await appeler({ text: texte, from: lg });
    assert.equal(r.status, 200);
    assert.equal(r.corps.translated, true, lg + ' : ' + JSON.stringify(r.corps));
    assert.equal(ai.appels.length, 1, lg);
    assert.equal(ai.appels[0].source_lang, lg);
    assert.equal(ai.appels[0].target_lang, 'en');
    assert.equal(r.corps.text, 'EN:' + texte);
  }
});

test('/api/translate : la langue du TEXTE l emporte sur celle annoncee (texte espagnol sous une interface francaise)', async () => {
  const { appeler, ai } = monterTraduction();
  const r = await appeler({ text: 'un dragón rojo con alas', from: 'fr' });
  assert.equal(r.corps.translated, true);
  assert.equal(ai.appels[0].source_lang, 'es');
  // interface anglaise, texte francais : traduit quand meme
  const b = monterTraduction();
  const r2 = await b.appeler({ text: 'un dragon rouge avec des ailes', from: 'en' });
  assert.equal(r2.corps.translated, true);
  assert.equal(b.ai.appels[0].source_lang, 'fr');
});

test('/api/translate : sans indice dans le texte, la langue annoncee sert, code regional normalise (« fr-FR » etait refuse)', async () => {
  const { appeler, ai } = monterTraduction();
  const r = await appeler({ text: 'orc', from: 'fr-FR' });
  assert.equal(r.corps.translated, true, JSON.stringify(r.corps));
  assert.equal(ai.appels[0].source_lang, 'fr');
});

test('/api/translate : un texte deja anglais n est jamais envoye au modele, et la reponse le dit', async () => {
  const { appeler, ai } = monterTraduction();
  for (const t of ['a red dragon', 'An orc warrior covered in blood, holding a massive spiked club', 'wooden barrel']) {
    const r = await appeler({ text: t, from: 'fr' });
    assert.equal(r.corps.translated, false);
    assert.equal(r.corps.raison, 'already-english', t);
    assert.equal(r.corps.text, t);
  }
  assert.equal(ai.appels.length, 0);
});

test('/api/translate : texte long DECOUPE (avant : 400 au-dela de 1 000 unites UTF-16, avale par l interface)', async () => {
  const { appeler, ai } = monterTraduction();
  const phrase = 'un chevalier avec une épée dorée et un bouclier rouge. ';
  const texte = phrase.repeat(30).trim();                      // ~1 600 caracteres
  const r = await appeler({ text: texte, from: 'fr' });
  assert.equal(r.status, 200);
  assert.equal(r.corps.translated, true, JSON.stringify(r.corps).slice(0, 200));
  assert.ok(ai.appels.length >= 2, 'decoupe en plusieurs appels : ' + ai.appels.length);
  for (const a of ai.appels) assert.ok([...a.text].length <= 1000, 'morceau de ' + [...a.text].length + ' caracteres');
  assert.equal(ai.appels.map((a) => a.text).join(''), texte, 'les morceaux couvrent tout le texte, dans l ordre');
  // 600 emoji + texte francais : compte en caracteres (1 200 unites UTF-16), accepte
  const b = monterTraduction();
  const r2 = await b.appeler({ text: 'un dragon rouge ' + '🐉'.repeat(600), from: 'fr' });
  assert.equal(r2.status, 200);
  assert.notEqual(r2.corps.raison, 'too-long');
  // au-dela du plafond : refus EXPLIQUE (raison), pas une erreur muette
  const c = monterTraduction();
  const r3 = await c.appeler({ text: 'é'.repeat(5000), from: 'fr' });
  assert.equal(r3.status, 200);
  assert.equal(r3.corps.raison, 'too-long');
  assert.equal(c.ai.appels.length, 0);
});

test('/api/translate : corps nul, illisible ou mal type : jamais d exception (avant : TypeError -> 500 sur « null »)', async () => {
  const { appeler, ai } = monterTraduction();
  for (const brut of ['null', '42', '"texte"', '{', '[]', '']) {
    const r = await appeler(null, brut);
    assert.equal(r.status, 200, 'corps ' + JSON.stringify(brut));
    assert.equal(r.corps.translated, false);
  }
  const r = await appeler({ text: 12, from: {} });
  assert.equal(r.corps.translated, false);
  assert.equal(ai.appels.length, 0);
});

test('/api/translate : echec, reponse vide, sortie qui boucle : raison donnee, sortie bornee', async () => {
  const p = monterTraduction({ ai: fauxAI({ mode: 'panne' }) });
  const r1 = await p.appeler({ text: 'un dragon rouge avec des ailes', from: 'fr' });
  assert.equal(r1.corps.translated, false);
  assert.equal(r1.corps.raison, 'failed');
  assert.equal(r1.corps.text, 'un dragon rouge avec des ailes');
  const v = monterTraduction({ ai: fauxAI({ mode: 'vide' }) });
  const r2 = await v.appeler({ text: 'un dragon rouge avec des ailes', from: 'fr' });
  assert.equal(r2.corps.raison, 'failed');
  const b = monterTraduction({ ai: fauxAI({ mode: 'boucle' }) });
  const texte = 'un dragon rouge avec des ailes';
  const r3 = await b.appeler({ text: texte, from: 'fr' });
  assert.equal(r3.corps.translated, true);
  assert.ok([...r3.corps.text].length <= 4 * [...texte].length + 200, 'sortie bornee : ' + r3.corps.text.length);
  const sans = monterTraduction({ ai: null });
  const r4 = await sans.appeler({ text: texte, from: 'fr' });
  assert.equal(r4.corps.raison, 'unavailable');
});

test('/api/translate : plafond par compte (300 appels du modele par heure), refus explique, comme le redacteur', async () => {
  const r2 = creerR2();
  const { appeler, ai } = monterTraduction({ r2 });
  const heure = new Date().toISOString().slice(0, 13).replace(/[-T]/g, '');
  r2.ecrire(`_meta/traduction/u1-${heure}.txt`, '300');
  const r = await appeler({ text: 'un dragon rouge avec des ailes', from: 'fr' });
  assert.equal(r.corps.translated, false);
  assert.equal(r.corps.raison, 'rate-limited');
  assert.equal(ai.appels.length, 0, 'le modele n est pas appele au-dela du plafond');
  // sous le plafond : le compteur avance d'un appel de modele (pas pour un texte deja anglais)
  const r2b = creerR2();
  const m = monterTraduction({ r2: r2b });
  await m.appeler({ text: 'un dragon rouge avec des ailes', from: 'fr' });
  await m.appeler({ text: 'a red dragon', from: 'fr' });
  assert.equal(r2b.lire(`_meta/traduction/u1-${heure}.txt`), '1');
});

test('/api/translate : session obligatoire', async () => {
  const { appeler, ai } = monterTraduction({ session: false });
  const r = await appeler({ text: 'un dragon rouge', from: 'fr' });
  assert.equal(r.status, 401);
  assert.equal(ai.appels.length, 0);
});

// ------------------------------------------------------------------------------------------------------- FILET DE LANGUE (generation)

function monterGeneration({ ai = fauxAI(), bloquerTraduit = false } = {}) {
  const j = { depenses: [], t2i: [], tpose: [], filtre: [], assets: [] };
  const w = charger(['handleGenerateImage', '_prixImageSelonPas', '_prixImageComplet', ...AUXILIAIRES], {
    getSessionUser: async () => ({ id: 'u1', email: 'a@b.c' }), err, json, LangueTexte,
    getParentalState: async () => ({}),
    _checkPromptSafetyAlerte: async (_e, _u, texte) => {
      j.filtre.push(texte);
      if (bloquerTraduit && /^EN:/.test(String(texte))) return { safe: false, reason: 'Content filter: blocked', blocked: ['x'] };
      return { safe: true };
    },
    getPrice: async (_e, k) => ({ text2image: 6, tpose: 1 }[k]),
    isTrustedAssetHost: () => true,
    checkAndIncrementModalSpend: async () => 100,
    checkAndIncrementDailySpend: async () => 100,
    _spendRefusalMessage: async () => 'refus',
    checkAndIncrementUserCalls: async () => 10,
    refundModalSpend: async () => {},
    refundDailySpend: async () => {},
    spendCredits: async (_e, _u, cout) => { j.depenses.push(cout); return 100 - cout; },
    addCredits: async () => {},
    callModalTpose: async (_e, _u, input) => { j.tpose.push(input); return 'https://r2.example/front/t.png'; },
    callModalText2Image: async (_e, _u, input) => { j.t2i.push(input); return 'https://r2.example/front/i.png'; },
    callMyfabmeshCog: async (_e, _u, input) => { j.t2i.push(input); return 'https://r2.example/front/c.png'; },
    logOperation: async () => {},
    insertUserAsset: async (_e, _u, projet, genre, _p, _par, meta) => { j.assets.push({ projet, genre, meta }); },
    r2PathFromPublicUrl: (_e, u) => u,
  });
  const env = { AI: ai, MODAL_TEXT2IMAGE_URL: 'https://t2i.example', MODAL_TPOSE_URL: 'https://tpose.example' };
  const appeler = async (corps) => {
    const r = await w.handleGenerateImage(new Request('https://x.example/api/generate-image', { method: 'POST', body: JSON.stringify(corps) }), env);
    return { status: r.status, corps: await r.json() };
  };
  return { j, appeler, ai, env, w };
}

test('filet : un prompt francais (cle API, client ancien, bureau sans traducteur) est TRADUIT avant le moteur (avant : envoye tel quel)', async () => {
  const { j, appeler, ai } = monterGeneration();
  const r = await appeler({ userPrompt: 'un dragon rouge avec des ailes', prompt: 'un dragon rouge avec des ailes', asset_type: 'creature', projectName: 'P' });
  assert.equal(r.status, 200, JSON.stringify(r.corps));
  assert.equal(ai.appels.length, 1, 'un seul appel au modele (meme texte pour prompt et userPrompt)');
  assert.equal(ai.appels[0].source_lang, 'fr');
  assert.equal(j.t2i[0].prompt, 'EN:un dragon rouge avec des ailes', 'le moteur recoit la traduction');
  assert.deepEqual(j.depenses, [6]);
  assert.ok(j.filtre.includes('EN:un dragon rouge avec des ailes'), 'le texte TRADUIT repasse le filtre de contenu');
  assert.equal(j.assets[0].meta.langue_traduite, 'fr', 'l historique dit qu une traduction serveur a eu lieu');
});

test('filet : traduction impossible -> 422 explicite, RIEN n est debite ni envoye au moteur (avant : facture et envoye brut)', async () => {
  const { j, appeler } = monterGeneration({ ai: fauxAI({ mode: 'panne' }) });
  const r = await appeler({ userPrompt: 'ein roter Drache mit Flügeln', asset_type: 'creature' });
  assert.equal(r.status, 422);
  assert.equal(r.corps.code, 'non-english-text');
  assert.equal(r.corps.langue, 'de');
  assert.match(r.corps.error, /English/);
  assert.deepEqual(j.depenses, [], 'aucun credit debite');
  assert.equal(j.t2i.length, 0, 'rien envoye au moteur');
});

test('filet : « Envoyer tel quel » choisi par l utilisateur (langueVerifiee) est respecte, et l anglais ne coute aucun appel', async () => {
  const a = monterGeneration();
  const r = await a.appeler({ userPrompt: 'un dragon rouge avec des ailes', asset_type: 'creature', langueVerifiee: true });
  assert.equal(r.status, 200);
  assert.equal(a.ai.appels.length, 0);
  assert.equal(a.j.t2i[0].prompt, 'un dragon rouge avec des ailes');
  const b = monterGeneration();
  await b.appeler({ userPrompt: 'An orc warrior covered in blood, holding a massive spiked club', asset_type: 'character' });
  assert.equal(b.ai.appels.length, 0);
  assert.equal(b.j.t2i[0].prompt, 'An orc warrior covered in blood, holding a massive spiked club');
});

test('filet : prompt deja ENRICHI sans userPrompt (bureau en mode Cloud) : seul le texte francais est traduit, le gabarit reste intact', async () => {
  const { j, appeler, ai } = monterGeneration();
  const gabarit = 'realistic style, photorealistic, sharp details, detailed materials';
  const queue = 'full body creature, single isolated 3D creature, plain white background';
  const prompt = `${gabarit}, un dragon rouge avec des ailes, ${queue}`;
  const r = await appeler({ prompt, asset_type: 'creature' });
  assert.equal(r.status, 200);
  assert.equal(ai.appels.length, 1);
  assert.equal(ai.appels[0].text, 'un dragon rouge avec des ailes');
  assert.equal(j.t2i[0].prompt, `${gabarit}, EN:un dragon rouge avec des ailes, ${queue}`);
});

test('filet : route T-pose : le prompt enrichi ET le texte brut sont traduits, un seul appel au modele', async () => {
  const { j, appeler, ai } = monterGeneration();
  const r = await appeler({ userPrompt: 'un chevalier sans casque', prompt: 'un chevalier sans casque, isolated 3D character, full body, T-pose',
    asset_type: 'character', tpose: true });
  assert.equal(r.status, 200, JSON.stringify(r.corps));
  assert.equal(ai.appels.length, 1);
  assert.equal(j.tpose[0].prompt, 'EN:un chevalier sans casque, isolated 3D character, full body, T-pose');
});

test('filet : le texte traduit bloque par le filtre de contenu -> 400, rien debite', async () => {
  const { j, appeler } = monterGeneration({ bloquerTraduit: true });
  const r = await appeler({ userPrompt: 'un dragon rouge avec des ailes', asset_type: 'creature' });
  assert.equal(r.status, 400);
  assert.deepEqual(j.depenses, []);
});

test('filet : Workers AI absent (developpement local) : comportement d avant, aucune exception', async () => {
  const { j, appeler } = monterGeneration({ ai: null });
  const r = await appeler({ userPrompt: 'un dragon rouge avec des ailes', asset_type: 'creature' });
  assert.equal(r.status, 200);
  assert.equal(j.t2i[0].prompt, 'un dragon rouge avec des ailes');
});

// ------------------------------------------------------------------------------------------------------- FILET DE LANGUE (outils)

function doublesOutils(j) {
  return {
    getSessionUser: async () => ({ id: 'u1', email: 'a@b.c' }), err, json, LangueTexte,
    getParentalState: async () => ({}),
    _checkPromptSafetyAlerte: async () => ({ safe: true }),
    getPrice: async () => 3,
    isTrustedAssetHost: () => true,
    checkAndIncrementModalSpend: async () => 100,
    checkAndIncrementDailySpend: async () => 100,
    _spendRefusalMessage: async () => 'refus',
    checkAndIncrementUserCalls: async () => 10,
    refundModalSpend: async () => {},
    refundDailySpend: async () => {},
    spendCredits: async (_e, _u, cout) => { j.depenses.push(cout); return 100 - cout; },
    addCredits: async () => {},
    callModalImageOp: async (_e, _u, input) => { j.op.push(input); return { url: 'https://r2.example/x.png' }; },
    callModalBackView: async (_e, _u, input) => { j.dos.push(input); return 'https://r2.example/b.png'; },
    callMyfabmeshCog: async () => 'https://r2.example/c.png',
    logOperation: async () => {},
    r2PathFromPublicUrl: (_e, u) => u,
    signedR2Url: async () => 'https://r2.example/masque.png',
  };
}
const corpsRequete = (url, corps) => new Request('https://x.example' + url, { method: 'POST', body: JSON.stringify(corps) });

test('filet : Modify, Auto-inpaint (cible ET remplacement), Paint-mask, Recolor, vue de dos : texte traduit avant le moteur', async () => {
  const j = { depenses: [], op: [], dos: [] };
  const ai = fauxAI();
  const w = charger(['handleModifyImage', 'handleAutoInpaint', 'handleMaskInpaint', 'handleRecolor', 'handleGenerateBackView',
    'handleSegmentPreview', ...AUXILIAIRES], doublesOutils(j));
  const env = { AI: ai, MODAL_IMAGE_OP_URL: 'https://op.example', MODAL_BACKVIEW_URL: 'https://bv.example', MESHES: creerR2(),
    R2_PUBLIC_URL: 'https://r2.example' };
  let r = await w.handleModifyImage(corpsRequete('/api/modify-image', { imageUrl: 'https://r2.example/a.png', prompt: 'rends le casque rouge et doré' }), env);
  assert.equal(r.status, 200);
  assert.equal(j.op.at(-1).prompt, 'EN:rends le casque rouge et doré');
  r = await w.handleAutoInpaint(corpsRequete('/api/auto-inpaint', { imageUrl: 'https://r2.example/a.png', targetText: 'le chapeau du chevalier', prompt: 'une couronne en or' }), env);
  assert.equal(r.status, 200);
  assert.equal(j.op.at(-1).targetText, 'EN:le chapeau du chevalier', 'la cible part a CLIPSeg EN ANGLAIS');
  assert.equal(j.op.at(-1).prompt, 'EN:une couronne en or');
  r = await w.handleMaskInpaint(corpsRequete('/api/mask-inpaint', { imageUrl: 'https://r2.example/a.png', maskDataUrl: 'data:image/png;base64,AAAA', prompt: 'une épée avec des runes' }), env);
  assert.equal(r.status, 200);
  assert.equal(j.op.at(-1).prompt, 'EN:une épée avec des runes', '« Replace with » du Paint-mask traduit');
  r = await w.handleRecolor(corpsRequete('/api/recolor', { imageUrl: 'https://r2.example/a.png', prompt: 'la cape en rouge' }), env);
  assert.equal(j.op.at(-1).prompt, 'EN:la cape en rouge');
  r = await w.handleGenerateBackView(corpsRequete('/api/generate-back-view', { frontImageUrl: 'https://r2.example/a.png', promptHint: 'un chevalier avec une cape rouge' }), env);
  assert.equal(r.status, 200);
  assert.equal(j.dos.at(-1).promptHint, 'EN:un chevalier avec une cape rouge');
  r = await w.handleSegmentPreview(corpsRequete('/api/segment-preview', { imageUrl: 'https://r2.example/a.png', targetText: 'le chapeau du chevalier' }), env);
  assert.equal(j.op.at(-1).targetText, 'EN:le chapeau du chevalier');
});

test('filet : outil en echec de traduction -> 422 avant le debit ; texte anglais -> aucun appel au modele', async () => {
  const j = { depenses: [], op: [], dos: [] };
  const w = charger(['handleModifyImage', 'handleAutoInpaint', ...AUXILIAIRES], doublesOutils(j));
  const env = { AI: fauxAI({ mode: 'panne' }), MODAL_IMAGE_OP_URL: 'https://op.example' };
  const r = await w.handleModifyImage(corpsRequete('/api/modify-image', { imageUrl: 'https://r2.example/a.png', prompt: 'rends le casque rouge et doré' }), env);
  assert.equal(r.status, 422);
  assert.deepEqual(j.depenses, []);
  assert.equal(j.op.length, 0);
  const ai = fauxAI();
  const env2 = { AI: ai, MODAL_IMAGE_OP_URL: 'https://op.example' };
  await w.handleAutoInpaint(corpsRequete('/api/auto-inpaint', { imageUrl: 'https://r2.example/a.png', targetText: 'hat', prompt: '' }), env2);
  assert.equal(ai.appels.length, 0);
  assert.equal(j.op.at(-1).targetText, 'hat');
});

/** Doublures des routes maillage / rectification : Modal (fetch), Supabase et R2 simules. */
function monterOutils3d({ ai = fauxAI() } = {}) {
  const j = { depenses: [], op: [], dos: [], rect: [], modal: [], jobs: [] };
  const w = charger(['handleTexVariant', 'handleRectifyImage', 'handleMeshReshape', 'ESTIMATED_USD_RESHAPE', '_opAtlasGpu', 'handleMeshTexVar',
    'handleMeshRegionRetex', ...AUXILIAIRES], {
    ...doublesOutils(j),
    callModalRectify: async (_e, _u, input) => { j.rect.push(input); return 'https://r2.example/r.png'; },
    supabaseAdmin: () => ({ from: () => ({ insert: async (ligne) => { j.jobs.push(ligne); return { error: null }; },
      update: () => ({ eq: async () => ({}) }) }) }),
    _provenance: () => 'web', _paysRequete: () => 'FR',
    fetch: async (url, init) => {
      j.modal.push({ url: String(url), corps: JSON.parse(init.body) });
      return new Response(JSON.stringify({ ok: true, glb_base64: btoa('glTF') }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  const env = { AI: ai, MODAL_IMAGE_OP_URL: 'https://op.example/image_op', MODAL_RECTIFY_URL: 'https://rect.example', MODAL_SHARED_SECRET: 's',
    MODAL_MESH_START_URL: 'https://mesh.example/mesh_start', MODAL_MESH_STATUS_URL: 'https://mesh.example/mesh_status', MESHES: creerR2(),
    R2_PUBLIC_URL: 'https://r2.example' };
  return { j, w, env, ai };
}

test('filet : Age / Variant (tex-variant), Rectify, Reshape, Texture variants du maillage (Style), Re-texture d une region : texte traduit', async () => {
  const { j, w, env } = monterOutils3d();
  let r = await w.handleTexVariant(corpsRequete('/api/tex-variant', { imageUrl: 'https://r2.example/a.png', prompt: 'une armure dorée', strength: 0.5 }), env);
  assert.equal(r.status, 200);
  assert.equal(j.op.at(-1).prompt, 'EN:une armure dorée');
  r = await w.handleRectifyImage(corpsRequete('/api/rectify-image', { prompt: 'un chevalier en armure', refImageUrl: 'https://r2.example/a.png' }), env);
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  assert.equal(j.rect.at(-1).prompt, 'EN:un chevalier en armure');
  r = await w.handleMeshReshape(corpsRequete('/api/mesh-reshape', { meshUrl: 'https://r2.example/m.glb', vueUrl: 'https://r2.example/v.png',
    maskDataUrl: 'data:image/png;base64,AAAA', prompt: 'une aile de chauve-souris' }), env);
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  assert.equal(j.modal.at(-1).corps.prompt, 'EN:une aile de chauve-souris', 'reshape : Modal recoit le texte traduit');
  r = await w.handleMeshTexVar(corpsRequete('/api/mesh-texvar', { meshUrl: 'https://r2.example/m.glb', style: 'rouillé et doré', strength: 0.4, seed: 1 }), env);
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  assert.equal(j.modal.at(-1).corps.style, 'EN:rouillé et doré', 'Texture variants : le Style n etait traduit nulle part (CHAMPS-03)');
  r = await w.handleMeshRegionRetex(corpsRequete('/api/mesh-region-retex', { meshUrl: 'https://r2.example/m.glb', mask: 'data:image/png;base64,AAAA',
    prompt: 'du cuir usé et taché' }), env);
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  assert.equal(j.modal.at(-1).corps.prompt, 'EN:du cuir usé et taché', 'Re-texture d une region : Modal recoit le texte traduit');
});

test('filet (maillage) : traduction impossible -> 422 AVANT tout debit ; « tel quel » respecte ; anglais sans appel', async () => {
  const panne = monterOutils3d({ ai: fauxAI({ mode: 'panne' }) });
  let r = await panne.w.handleMeshRegionRetex(corpsRequete('/api/mesh-region-retex', { meshUrl: 'https://r2.example/m.glb',
    mask: 'data:image/png;base64,AAAA', prompt: 'du cuir usé et taché' }), panne.env);
  assert.equal(r.status, 422);
  r = await panne.w.handleMeshReshape(corpsRequete('/api/mesh-reshape', { meshUrl: 'https://r2.example/m.glb', vueUrl: 'https://r2.example/v.png',
    maskDataUrl: 'data:image/png;base64,AAAA', prompt: 'une aile de chauve-souris' }), panne.env);
  assert.equal(r.status, 422);
  assert.deepEqual(panne.j.depenses, [], 'rien debite');
  assert.equal(panne.j.modal.length + panne.j.jobs.length, 0, 'rien envoye a Modal, aucun travail cree');
  r = await panne.w.handleMeshTexVar(corpsRequete('/api/mesh-texvar', { meshUrl: 'https://r2.example/m.glb', style: 'rouillé et doré',
    langueVerifiee: true }), panne.env);
  assert.equal(r.status, 200);
  assert.equal(panne.j.modal.at(-1).corps.style, 'rouillé et doré');
  const ok = monterOutils3d();
  await ok.w.handleMeshRegionRetex(corpsRequete('/api/mesh-region-retex', { meshUrl: 'https://r2.example/m.glb', mask: 'data:image/png;base64,AAAA',
    prompt: 'worn leather with stains' }), ok.env);
  assert.equal(ok.ai.appels.length, 0);
  assert.equal(ok.j.modal.at(-1).corps.prompt, 'worn leather with stains');
});

// ------------------------------------------------------------------------------------------------------- REVUE DU 2026-10-14
// Bloquants B1 et B3 de la revue du lot 2.
//   B1 : un seul mot partage avec une autre langue (« van », « den », « Las », « sin », « con ») suffisait au filet : « camper van » partait
//        au modele « depuis le neerlandais », et quand le traducteur etait en panne, ces prompts ANGLAIS recevaient un 422.
//   B3 : le filet appelait le modele sans borne (une requete de 96 000 caracteres = 108 appels), hors de tout plafond, et meme pour un
//        compte sans credit.
const ANGLAIS_PARTAGES = ['camper van', 'delivery van', 'police van', 'wolf den', 'Las Vegas sign', 'sin eater', 'con artist',
  'El Dorado gold statue', 'pour over coffee', 'beer mug', 'kobold archer', 'sombrero', 'Van Helsing monster hunter', 'que sera sera music box'];
const GABARIT_QUEUE = ', 3D game asset, single isolated object, plain white background, sharp details';

function monterBornes({ ai = fauxAI(), credits, r2 = creerR2() } = {}) {
  const j = { depenses: [], t2i: [] };
  const w = charger(['handleGenerateImage', '_prixImageSelonPas', '_prixImageComplet', 'handleTranslate', ...AUXILIAIRES], {
    getSessionUser: async () => ({ id: 'u1', email: 'a@b.c', credits }), err, json, LangueTexte,
    getParentalState: async () => ({}),
    _checkPromptSafetyAlerte: async () => ({ safe: true }),
    getPrice: async (_e, k) => ({ text2image: 6, tpose: 1 }[k]),
    isTrustedAssetHost: () => true,
    checkAndIncrementModalSpend: async () => 100, checkAndIncrementDailySpend: async () => 100,
    _spendRefusalMessage: async () => 'refus', checkAndIncrementUserCalls: async () => 10,
    refundModalSpend: async () => {}, refundDailySpend: async () => {},
    spendCredits: async (_e, _u, c) => { if (typeof credits === 'number' && credits < c) return null; j.depenses.push(c); return 100 - c; },
    addCredits: async () => {},
    callModalTpose: async (_e, _u, i) => { j.t2i.push(i); return 'https://r2.example/front/t.png'; },
    callModalText2Image: async (_e, _u, i) => { j.t2i.push(i); return 'https://r2.example/front/i.png'; },
    callMyfabmeshCog: async (_e, _u, i) => { j.t2i.push(i); return 'https://r2.example/front/c.png'; },
    logOperation: async () => {}, insertUserAsset: async () => {}, r2PathFromPublicUrl: (_e, u) => u,
  });
  const env = { AI: ai, MODAL_TEXT2IMAGE_URL: 'https://t2i.example', MESHES: r2 };
  const generer = async (corps) => {
    const r = await w.handleGenerateImage(new Request('https://x.example/api/generate-image', { method: 'POST', body: JSON.stringify(corps) }), env);
    return { status: r.status, corps: await r.json() };
  };
  const traduire = async (corps) => {
    const r = await w.handleTranslate(new Request('https://x.example/api/translate', { method: 'POST', body: JSON.stringify(corps) }), env);
    return { status: r.status, corps: await r.json() };
  };
  return { j, ai, r2, generer, traduire };
}
const heureCourante = () => new Date().toISOString().slice(0, 13).replace(/[-T]/g, '');

test('B1 : un prompt ANGLAIS a mots partages n est jamais refuse quand le traducteur est en panne, et part TEL QUEL au moteur', async () => {
  const refuses = [], reecrits = [];
  for (const t of ANGLAIS_PARTAGES) {
    const panne = monterBornes({ ai: fauxAI({ mode: 'panne' }) });
    const r = await panne.generer({ userPrompt: t, prompt: t + GABARIT_QUEUE, asset_type: 'prop', projectName: 'P' });
    if (r.status !== 200) refuses.push(`${t} -> ${r.status} ${r.corps.langue || ''}`);
    const ok = monterBornes();
    await ok.generer({ userPrompt: t, prompt: t + GABARIT_QUEUE, asset_type: 'prop', projectName: 'P' });
    const recu = ok.j.t2i[0] && ok.j.t2i[0].prompt;
    if (recu !== t || ok.ai.appels.length) reecrits.push(`${t} -> ${JSON.stringify(recu)} (${ok.ai.appels.length} appel(s))`);
  }
  assert.deepEqual({ refuses, reecrits }, { refuses: [], reecrits: [] });
});

test('B1 : /api/translate sous une interface anglaise : un prompt anglais a mots partages n est pas envoye au modele', async () => {
  for (const t of ANGLAIS_PARTAGES) {
    const { traduire, ai } = monterBornes();
    const r = await traduire({ text: t, from: 'en' });
    assert.equal(r.corps.translated, false, t);
    assert.equal(r.corps.raison, 'already-english', t);
    assert.equal(ai.appels.length, 0, t);
  }
  // un texte SUREMENT etranger reste traduit, meme annonce « en »
  const { traduire, ai } = monterBornes();
  const r = await traduire({ text: 'ein roter Drache mit Flügeln', from: 'en' });
  assert.equal(r.corps.translated, true);
  assert.equal(ai.appels[0].source_lang, 'de');
});

test('B3 : une requete de 96 000 caracteres etrangers ne declenche AUCUN appel au modele (refus « too-long », rien debite)', async () => {
  const { generer, ai, j } = monterBornes();
  const r = await generer({ userPrompt: 'un dragon rouge avec des ailes. '.repeat(3000), asset_type: 'creature', projectName: 'P' });
  assert.equal(r.status, 422);
  assert.equal(r.corps.code, 'non-english-text');
  assert.equal(r.corps.raison, 'too-long');
  assert.equal(ai.appels.length, 0, 'appels au modele : ' + ai.appels.length);
  assert.deepEqual(j.depenses, []);
  assert.doesNotMatch(r.corps.error, /\(fr\)/, 'la langue est nommee en toutes lettres, pas par son code');
  assert.match(r.corps.error, /French/);
});

test('B3 : au plus 6 appels du modele par requete, champs cumules (userPrompt + prompt enrichi)', async () => {
  const { generer, ai, j } = monterBornes();
  const long = 'un chevalier avec une épée dorée et un bouclier rouge. '.repeat(70).trim();       // ~3 800 caracteres : 5 morceaux
  const autre = 'une sorcière avec un chapeau pointu et une cape noire. '.repeat(25).trim();    // ~1 400 caracteres : 2 morceaux
  const r = await generer({ userPrompt: long, prompt: autre, asset_type: 'character', projectName: 'P' });
  assert.equal(r.status, 422, JSON.stringify(r.corps).slice(0, 200));
  assert.ok(ai.appels.length <= 6, 'appels : ' + ai.appels.length);
  assert.deepEqual(j.depenses, []);
});

test('B3 : le filet compte sur le plafond horaire du compte (comme /api/translate) ; au plafond : 422, aucun appel, rien debite', async () => {
  const r2 = creerR2();
  const a = monterBornes({ r2 });
  const r = await a.generer({ userPrompt: 'un dragon rouge avec des ailes', asset_type: 'creature', projectName: 'P' });
  assert.equal(r.status, 200);
  assert.equal(a.ai.appels.length, 1);
  assert.equal(r2.lire(`_meta/traduction/u1-${heureCourante()}.txt`), '1', 'l appel du filet est compte');
  r2.ecrire(`_meta/traduction/u1-${heureCourante()}.txt`, '300');
  const b = monterBornes({ r2 });
  const r3 = await b.generer({ userPrompt: 'un chevalier sans casque', asset_type: 'character', projectName: 'P' });
  assert.equal(r3.status, 422);
  assert.equal(r3.corps.raison, 'rate-limited');
  assert.equal(b.ai.appels.length, 0);
  assert.deepEqual(b.j.depenses, []);
  // un texte anglais n'est pas touche par le plafond
  const c = monterBornes({ r2 });
  assert.equal((await c.generer({ userPrompt: 'a red dragon with wings', asset_type: 'creature', projectName: 'P' })).status, 200);
});

test('B3 : un compte SANS credit ne declenche aucun appel au modele (la route refuse ensuite faute de credit)', async () => {
  const { generer, ai, j } = monterBornes({ credits: 0 });
  const r = await generer({ userPrompt: 'un dragon rouge avec des ailes', asset_type: 'creature', projectName: 'P' });
  assert.equal(ai.appels.length, 0);
  assert.equal(r.status, 402);
  assert.deepEqual(j.depenses, []);
  // avec des credits : traduit
  const ok = monterBornes({ credits: 50 });
  assert.equal((await ok.generer({ userPrompt: 'un dragon rouge avec des ailes', asset_type: 'creature', projectName: 'P' })).status, 200);
  assert.equal(ok.ai.appels.length, 1);
});

test('B3 : /api/translate compte CHAQUE appel du modele (texte decoupe) sur le plafond du compte', async () => {
  const r2 = creerR2();
  const { traduire, ai } = monterBornes({ r2 });
  const texte = 'un chevalier avec une épée dorée et un bouclier rouge. '.repeat(30).trim();     // ~1 600 caracteres : 2 morceaux
  const r = await traduire({ text: texte, from: 'fr' });
  assert.equal(r.corps.translated, true);
  assert.equal(r2.lire(`_meta/traduction/u1-${heureCourante()}.txt`), String(ai.appels.length));
  assert.ok(ai.appels.length >= 2);
});
