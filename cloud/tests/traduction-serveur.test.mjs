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

test('B3 : 4 000 caracteres etrangers au plus par requete, champs cumules (userPrompt + prompt enrichi) : refus AVANT tout appel', async () => {
  const { generer, ai, j } = monterBornes();
  const long = 'un chevalier avec une épée dorée et un bouclier rouge. '.repeat(70).trim();       // ~3 800 caracteres : 5 morceaux
  const autre = 'une sorcière avec un chapeau pointu et une cape noire. '.repeat(25).trim();    // ~1 400 caracteres : 2 morceaux
  const r = await generer({ userPrompt: long, prompt: autre, asset_type: 'character', projectName: 'P' });
  assert.equal(r.status, 422, JSON.stringify(r.corps).slice(0, 200));
  assert.equal(r.corps.raison, 'too-long');
  assert.equal(ai.appels.length, 0, 'appels : ' + ai.appels.length);
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

// Seconde relecture du correctif B3 (2026-10-14) : seul un compte a 0 credit etait ecarte. Un compte a 1 ou 2 credits, sous le prix de
// TOUTE route, declenchait encore jusqu'a 6 appels du modele par requete, refusee ensuite faute de credit : des traductions gratuites a
// volonte (300 par heure et par compte). Le prix de la requete est desormais lu AVANT le filet, sur chaque route qui l'appelle.
function monterOutilsCredits(credits) {
  const j = { depenses: [], op: [], dos: [], rect: [], modal: [], jobs: [] };
  const ai = fauxAI();
  const w = charger(['handleModifyImage', 'handleAutoInpaint', 'handleMaskInpaint', 'handleRecolor', 'handleGenerateBackView',
    'handleSegmentPreview', 'handleTexVariant', 'handleRectifyImage', 'handleMeshReshape', 'ESTIMATED_USD_RESHAPE', '_opAtlasGpu',
    'handleMeshTexVar', 'handleMeshRegionRetex', ...AUXILIAIRES], {
    ...doublesOutils(j),
    getSessionUser: async () => ({ id: 'u1', email: 'a@b.c', credits }),
    callModalRectify: async (_e, _u, input) => { j.rect.push(input); return 'https://r2.example/r.png'; },
    supabaseAdmin: () => ({ from: () => ({ insert: async (ligne) => { j.jobs.push(ligne); return { error: null }; },
      update: () => ({ eq: async () => ({}) }) }) }),
    _provenance: () => 'web', _paysRequete: () => 'FR',
    fetch: async (url, init) => {
      j.modal.push({ url: String(url), corps: JSON.parse(init.body) });
      return new Response(JSON.stringify({ ok: true, glb_base64: btoa('glTF') }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  const env = { AI: ai, MODAL_IMAGE_OP_URL: 'https://op.example/image_op', MODAL_BACKVIEW_URL: 'https://bv.example', MODAL_RECTIFY_URL: 'https://rect.example',
    MODAL_SHARED_SECRET: 's', MODAL_MESH_START_URL: 'https://mesh.example/mesh_start', MODAL_MESH_STATUS_URL: 'https://mesh.example/mesh_status',
    MESHES: creerR2(), R2_PUBLIC_URL: 'https://r2.example' };
  const A = 'https://r2.example/a.png';
  const routes = [
    ['modify', () => w.handleModifyImage(corpsRequete('/api/modify-image', { imageUrl: A, prompt: 'rends le casque rouge et doré' }), env)],
    ['auto-inpaint', () => w.handleAutoInpaint(corpsRequete('/api/auto-inpaint', { imageUrl: A, targetText: 'le chapeau du chevalier', prompt: 'une couronne en or' }), env)],
    ['mask-inpaint', () => w.handleMaskInpaint(corpsRequete('/api/mask-inpaint', { imageUrl: A, maskDataUrl: 'data:image/png;base64,AAAA', prompt: 'une épée avec des runes' }), env)],
    ['recolor', () => w.handleRecolor(corpsRequete('/api/recolor', { imageUrl: A, prompt: 'la cape en rouge' }), env)],
    ['back-view', () => w.handleGenerateBackView(corpsRequete('/api/generate-back-view', { frontImageUrl: A, promptHint: 'un chevalier avec une cape rouge' }), env)],
    ['segment-preview', () => w.handleSegmentPreview(corpsRequete('/api/segment-preview', { imageUrl: A, targetText: 'le chapeau du chevalier' }), env)],
    ['tex-variant', () => w.handleTexVariant(corpsRequete('/api/tex-variant', { imageUrl: A, prompt: 'une armure dorée', strength: 0.5 }), env)],
    ['rectify', () => w.handleRectifyImage(corpsRequete('/api/rectify-image', { prompt: 'un chevalier en armure', refImageUrl: A }), env)],
    ['reshape', () => w.handleMeshReshape(corpsRequete('/api/mesh-reshape', { meshUrl: 'https://r2.example/m.glb', vueUrl: 'https://r2.example/v.png',
      maskDataUrl: 'data:image/png;base64,AAAA', prompt: 'une aile de chauve-souris' }), env)],
    ['mesh-texvar', () => w.handleMeshTexVar(corpsRequete('/api/mesh-texvar', { meshUrl: 'https://r2.example/m.glb', style: 'rouillé et doré', strength: 0.4, seed: 1 }), env)],
    ['region-retex', () => w.handleMeshRegionRetex(corpsRequete('/api/mesh-region-retex', { meshUrl: 'https://r2.example/m.glb', mask: 'data:image/png;base64,AAAA',
      prompt: 'du cuir usé et taché' }), env)],
  ];
  return { ai, routes };
}

test('B3 : credits SOUS le prix de la requete (pas seulement 0) : aucun appel au modele, sur la generation ET sur chaque outil', async () => {
  // generation d'image : 5 credits pour une image a 6
  const g = monterBornes({ credits: 5 });
  const r = await g.generer({ userPrompt: 'un dragon rouge avec des ailes', asset_type: 'creature', projectName: 'P' });
  assert.equal(g.ai.appels.length, 0, 'image a 6 credits, compte a 5');
  assert.equal(r.status, 402);
  // le prix compte le nombre d'images : 4 images a 6 = 24, un compte a 20 ne declenche rien
  const quatre = monterBornes({ credits: 20 });
  assert.equal((await quatre.generer({ userPrompt: 'un dragon rouge avec des ailes', numImages: 4, asset_type: 'creature', projectName: 'P' })).status, 402);
  assert.equal(quatre.ai.appels.length, 0, '4 images a 6 credits, compte a 20');
  // temoin : exactement le prix -> traduit
  const juste = monterBornes({ credits: 6 });
  assert.equal((await juste.generer({ userPrompt: 'un dragon rouge avec des ailes', asset_type: 'creature', projectName: 'P' })).status, 200);
  assert.equal(juste.ai.appels.length, 1);
  // outils (prix 3 dans les doublures) : un compte a 2 credits ne declenche aucun appel, sur aucune route
  const pauvre = monterOutilsCredits(2);
  const fautes = [];
  for (const [nom, appeler] of pauvre.routes) {
    const avant = pauvre.ai.appels.length;
    await appeler();
    if (pauvre.ai.appels.length !== avant) fautes.push(`${nom} : ${pauvre.ai.appels.length - avant} appel(s) du modele avec 2 credits pour un prix de 3`);
  }
  assert.deepEqual(fautes, []);
  // temoin : 3 credits (= le prix) -> chaque route traduit (le test n'est pas vide)
  const assez = monterOutilsCredits(3);
  const muettes = [];
  for (const [nom, appeler] of assez.routes) {
    const avant = assez.ai.appels.length;
    await appeler();
    if (assez.ai.appels.length === avant) muettes.push(nom);
  }
  assert.deepEqual(muettes, [], 'routes qui ne traduisent plus, credits suffisants');
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

// ------------------------------------------------------------------------------------------------------- SECONDE REVUE DU 2026-10-14
// Bloquants restants de la seconde revue du lot 2 (cas rejoues de C:/tmp/revue_traduction_1410b_cas/sceptique_worker.test.mjs) :
//   B3 (a) : le compteur de plafond etait LU puis ECRIT sans condition : 100 requetes simultanees = 500 appels du modele pour un plafond
//            de 300 par heure (compteur a 5). Desormais comparaison-echange sur l'etag R2.
//   B3 (b) : /api/translate (gratuit, ouvert aux comptes a 0 credit) et le filet des routes payantes partageaient le plafond GLOBAL du
//            jour : des comptes sans credit l'epuisaient et un client PAYANT recevait 422. Trois compteurs du jour desormais.
//   Refus a tort : la borne de 6 appels par requete comptait les MORCEAUX : un prompt melange de 253 caracteres, ou un prompt allemand de
//            618 caracteres envoye avec son prompt enrichi, etait refuse « too-long ».
//   Mineurs : le refus au plafond du JOUR disait « this hour » et consommait le plafond horaire du compte ; un second champ hors borne
//            tombait APRES les appels du premier.
/** R2 avec latence : une vraie lecture / ecriture prend des millisecondes, les requetes simultanees se chevauchent. */
function r2Lent(ms = 3) {
  const r = creerR2();
  const get = r.get.bind(r), put = r.put.bind(r);
  r.get = async (k) => { await new Promise((x) => setTimeout(x, ms)); return get(k); };
  r.put = async (k, v, o) => { await new Promise((x) => setTimeout(x, ms)); return put(k, v, o); };
  return r;
}
/** Faux Workers AI LENT (2 ms par appel) : les requetes concurrentes se chevauchent vraiment. */
function fauxAILent(mode = 'ok') {
  const appels = [];
  return { appels, async run(_m, e) {
    appels.push(e);
    await new Promise((r) => setTimeout(r, 2));
    if (mode === 'panne') throw new Error('quota');
    return { translated_text: 'EN<' + e.source_lang + '>:' + e.text };
  } };
}
/** Generation + /api/translate avec une session CHANGEABLE et un debit ATOMIQUE sur le solde reel de chaque compte. */
function monterComptes({ ai = fauxAILent(), r2 = creerR2(), utilisateur = { id: 'u1', email: 'a@b.c', credits: 100 } } = {}) {
  const j = { depenses: [], t2i: [] };
  let session = utilisateur;
  const soldes = new Map();
  const solde = { get v() { return soldes.has(session.id) ? soldes.get(session.id) : session.credits; }, set v(x) { soldes.set(session.id, x); } };
  const w = charger(['handleGenerateImage', '_prixImageSelonPas', '_prixImageComplet', 'handleTranslate', 'handleAutoInpaint', ...AUXILIAIRES], {
    getSessionUser: async () => session, err, json, LangueTexte,
    getParentalState: async () => ({}),
    _checkPromptSafetyAlerte: async () => ({ safe: true }),
    getPrice: async (_e, k) => ({ text2image: 6, tpose: 1, auto_inpaint: 3 }[k]),
    isTrustedAssetHost: () => true,
    checkAndIncrementModalSpend: async () => 100, checkAndIncrementDailySpend: async () => 100,
    _spendRefusalMessage: async () => 'refus', checkAndIncrementUserCalls: async () => 10,
    refundModalSpend: async () => {}, refundDailySpend: async () => {},
    spendCredits: async (_e, _u, c) => { if (solde.v < c) return null; solde.v -= c; j.depenses.push(c); return solde.v; }, addCredits: async () => {},
    callModalTpose: async (_e, _u, i) => { j.t2i.push(i); return 'https://r2.example/front/t.png'; },
    callModalText2Image: async (_e, _u, i) => { j.t2i.push(i); return 'https://r2.example/front/i.png'; },
    callMyfabmeshCog: async (_e, _u, i) => { j.t2i.push(i); return 'https://r2.example/front/c.png'; },
    callModalImageOp: async (_e, _u, i) => { j.t2i.push(i); return { url: 'https://r2.example/x.png' }; },
    logOperation: async () => {}, insertUserAsset: async () => {}, r2PathFromPublicUrl: (_e, u) => u,
  });
  const env = { AI: ai, MODAL_TEXT2IMAGE_URL: 'https://t2i.example', MODAL_IMAGE_OP_URL: 'https://op.example', MESHES: r2 };
  const reponse = async (r) => ({ status: r.status, corps: await r.json() });
  const gen = async (corps) => reponse(await w.handleGenerateImage(corpsRequete('/api/generate-image', corps), env));
  const trad = async (corps) => reponse(await w.handleTranslate(corpsRequete('/api/translate', corps), env));
  const inpaint = async (corps) => reponse(await w.handleAutoInpaint(corpsRequete('/api/auto-inpaint', corps), env));
  return { j, gen, trad, inpaint, ai, r2, changerSession: (u) => { session = u; } };
}
const jourCourant = () => new Date().toISOString().slice(0, 10);
const FR_4000 = ('un dragon rouge avec de grandes ailes et des cornes noires, assis sur un tas de pieces d\'or dans une caverne sombre. ')
  .repeat(40).slice(0, 3990);

test('seconde revue B3 : 100 /api/translate SIMULTANES d un compte a 0 credit restent sous SON plafond, et le compteur compte juste', async () => {
  const r2 = r2Lent(3);
  const m = monterComptes({ r2, utilisateur: { id: 'pirate', email: 'p', credits: 0 } });
  await Promise.all(Array.from({ length: 100 }, () => m.trad({ text: FR_4000, from: 'fr' })));
  const compteur = Number(r2.lire(`_meta/traduction/pirate-${heureCourante()}.txt`) || 0);
  assert.ok(m.ai.appels.length <= 60, `plafond d un compte sans credit (60 par heure) depasse : ${m.ai.appels.length} appels`);
  assert.equal(compteur, m.ai.appels.length, 'le compteur du compte = les appels reellement faits (avant : 5 pour 500)');
});

test('seconde revue B3 : 100 generations SIMULTANEES (compte a 6 credits, une seule payable) : appels du modele bornes et comptes', async () => {
  const r2 = r2Lent(3);
  const m = monterComptes({ r2, utilisateur: { id: 'u6', email: 'p', credits: 6 } });
  const rs = await Promise.all(Array.from({ length: 100 }, () => m.gen({ userPrompt: FR_4000.slice(0, 3500), asset_type: 'creature', projectName: 'P' })));
  const compteur = Number(r2.lire(`_meta/traduction/u6-${heureCourante()}.txt`) || 0);
  assert.ok(m.ai.appels.length <= 300, `plafond horaire de 300 appels depasse : ${m.ai.appels.length}`);
  assert.equal(compteur, m.ai.appels.length, 'compteur = appels reels');
  assert.deepEqual(m.j.depenses, [6], 'une seule generation payee');
  assert.equal(rs.filter((r) => r.status === 200).length, 1);
});

test('seconde revue B3 : des comptes a 0 credit epuisent LEUR plafond du jour, jamais celui d un client PAYANT (avant : 422 pour lui)', async () => {
  const r2 = creerR2();
  const m = monterComptes({ r2, utilisateur: { id: 'gratuit0', email: 'g', credits: 0 } });
  let refuses = 0;
  for (let c = 0; c < 40; c++) {
    m.changerSession({ id: 'gratuit' + c, email: 'g', credits: 0 });
    for (let k = 0; k < 13; k++) if ((await m.trad({ text: FR_4000, from: 'fr' })).corps.raison === 'rate-limited') refuses++;
  }
  assert.ok(refuses > 0, 'les comptes sans credit atteignent leurs plafonds');
  assert.ok(Number(r2.lire(`_meta/traduction/jour-sans-credit-${jourCourant()}.txt`) || 0) <= 2000, 'plafond du jour des comptes sans credit');
  assert.equal(r2.lire(`_meta/traduction/jour-filet-${jourCourant()}.txt`), undefined, 'le compteur du filet n est pas touche');
  // le compteur des comptes CREDITES de /api/translate est plein lui aussi : sans effet sur le filet d une requete payante
  r2.ecrire(`_meta/traduction/jour-${jourCourant()}.txt`, '20000');
  m.changerSession({ id: 'client-payant', email: 'c', credits: 100 });
  const avant = m.ai.appels.length;
  const r = await m.gen({ userPrompt: 'un chevalier en armure doree avec une epee', asset_type: 'character', projectName: 'P' });
  assert.equal(r.status, 200, JSON.stringify(r.corps));
  assert.equal(m.ai.appels.length - avant, 1, 'le prompt du client payant est traduit');
  assert.match(m.j.t2i.at(-1).prompt, /^EN<fr>:/);
});

test('seconde revue B3 : au plafond du JOUR, le refus le dit (plus « this hour ») et ne consomme pas le plafond horaire du compte', async () => {
  const r2 = creerR2();
  r2.ecrire(`_meta/traduction/jour-filet-${jourCourant()}.txt`, '20000');
  const m = monterComptes({ r2 });
  const r = await m.gen({ userPrompt: 'un dragon rouge avec des ailes', asset_type: 'creature', projectName: 'P' });
  assert.equal(r.status, 422);
  assert.equal(r.corps.raison, 'rate-limited');
  assert.equal(r.corps.portee, 'jour');
  assert.match(r.corps.error, /daily/);
  assert.doesNotMatch(r.corps.error, /this hour/);
  assert.equal(Number(r2.lire(`_meta/traduction/u1-${heureCourante()}.txt`) || 0), 0, 'le plafond horaire du compte est rendu');
  assert.equal(m.ai.appels.length, 0);
  // /api/translate : meme portee dans la reponse
  r2.ecrire(`_meta/traduction/jour-${jourCourant()}.txt`, '20000');
  const t = await m.trad({ text: 'un dragon rouge avec des ailes', from: 'fr' });
  assert.equal(t.corps.raison, 'rate-limited');
  assert.equal(t.corps.portee, 'jour');
});

test('seconde revue, refus a tort : prompt MELANGE allemand / mots-cles anglais de 253 caracteres (cle API) -> traduit, pas 422', async () => {
  const t = 'ein alter Ritter mit Schwert, highly detailed, eine rostige Rüstung, cinematic lighting, ein roter Umhang, octane render, ein Helm mit Hörnern, sharp focus, ein Schild mit Drachen, masterpiece, die Stiefel aus Leder, 8k, ein Pferd neben ihm, concept art';
  const m = monterComptes();
  const r = await m.gen({ prompt: t, asset_type: 'character', projectName: 'P' });
  assert.equal(r.status, 200, JSON.stringify(r.corps));
  const recu = m.j.t2i[0].prompt;
  assert.doesNotMatch(recu.replace(/EN<de>:[^,]*/g, ''), /Ritter|Rüstung|Umhang|Hörnern|Stiefel|Pferd/, 'chaque passage allemand est traduit : ' + recu);
  assert.match(recu, /highly detailed/);
});

test('seconde revue, refus a tort : prompt allemand de 618 caracteres + prompt enrichi (ancien client) -> UN appel, traduit partout', async () => {
  const u = ['Ein alter Ritter in einer rostigen Rüstung', 'er trägt einen schweren Schild mit einem roten Drachen',
    'sein Schwert ist aus schwarzem Stahl', 'auf dem Kopf ein Helm mit Hörnern', '4K', 'der Umhang ist dunkelblau und zerrissen',
    'im Hintergrund eine verfallene Burg', 'Nebel', 'die Stiefel sind aus braunem Leder', 'er hält eine Laterne in der linken Hand',
    'sehr detailliert', 'Gold', 'die Augen leuchten grün', 'neben ihm ein kleiner Hund mit einem Halsband', 'RPG',
    'der Gürtel hat eine silberne Schnalle', 'Zauberer', 'ein Beutel mit Münzen hängt am Gürtel', 'PBR',
    'auf dem Rücken trägt er einen Bogen', 'Low Poly', 'die Handschuhe sind aus Kettengeflecht'].join(', ');
  const enrichi = 'masterpiece, best quality, ' + u + ', full body, T-pose, plain white background, 3D game asset, sharp details';
  const m = monterComptes();
  const r = await m.gen({ userPrompt: u, prompt: enrichi, asset_type: 'character', projectName: 'P', tpose: true });
  assert.equal(r.status, 200, JSON.stringify(r.corps));
  assert.equal(m.ai.appels.length, 1, 'le texte brut est traduit une fois, le prompt enrichi recoit la meme traduction');
  assert.equal(m.ai.appels[0].text, u);
});

test('seconde revue : un prompt aux passages trop nombreux et de langues alternees -> 422 AVANT tout appel (borne par requete)', async () => {
  // 18 passages DISTINCTS (un passage repete n'est traduit qu'une fois), allemand et francais en alternance : aucune fusion possible
  const de = ['rote', 'blaue', 'grüne', 'gelbe', 'schwarze', 'weiße', 'braune', 'graue', 'goldene'];
  const fr = ['rouge', 'bleu', 'vert', 'jaune', 'noir', 'blanc', 'brun', 'gris', 'doré'];
  const passages = [];
  for (let k = 0; k < 9; k++) passages.push(`ein Drache mit ${de[k]} Flügeln und einem Schwert`, 'a blue bird', `un dragon ${fr[k]} avec des ailes et une épée`, 'a green cat');
  const m = monterComptes();
  const r = await m.gen({ prompt: passages.join(', '), asset_type: 'creature', projectName: 'P' });
  assert.equal(r.status, 422, JSON.stringify(r.corps).slice(0, 200));
  assert.equal(r.corps.raison, 'too-long');
  assert.equal(r.corps.portee, 'melange');
  assert.equal(m.ai.appels.length, 0);
});

test('seconde revue : Auto-inpaint, cible + remplacement planifies ENSEMBLE : hors borne -> 422 sans AUCUN appel (avant : la cible etait traduite puis refus)', async () => {
  const m = monterComptes();
  const r = await m.inpaint({ imageUrl: 'https://r2.example/a.png', targetText: FR_4000.slice(0, 2500), prompt: FR_4000.slice(0, 2000) });
  assert.equal(r.status, 422);
  assert.equal(r.corps.raison, 'too-long');
  assert.equal(m.ai.appels.length, 0, 'appels perdus : ' + m.ai.appels.length);
  // temoin : cible + remplacement courts -> un appel chacun, un seul debit
  const ok = monterComptes();
  const r2 = await ok.inpaint({ imageUrl: 'https://r2.example/a.png', targetText: 'le chapeau du chevalier', prompt: 'une couronne en or' });
  assert.equal(r2.status, 200, JSON.stringify(r2.corps));
  assert.equal(ok.ai.appels.length, 2);
});

test('seconde revue : le prompt enrichi ne recoit la traduction du texte brut que s il le contient comme passage ENTIER', async () => {
  const m = monterComptes();
  // « un chat noir » est un bout de « un chat noirci » : pas de substitution, le prompt enrichi passe entier au filet
  const r = await m.gen({ userPrompt: 'un chat noir', prompt: 'un chat noirci par la suie, isolated 3D character, full body, T-pose',
    asset_type: 'character', projectName: 'P', tpose: true });
  assert.equal(r.status, 200, JSON.stringify(r.corps));
  const textes = m.ai.appels.map((a) => a.text);
  assert.ok(textes.includes('un chat noir'), JSON.stringify(textes));
  assert.ok(textes.some((t) => t.startsWith('un chat noirci par la suie')), 'le passage etranger du prompt enrichi est traduit entier : ' + JSON.stringify(textes));
});
