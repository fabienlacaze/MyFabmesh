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
  'TRADUCTION_MORCEAU_MAX', 'TRADUCTION_PLAFOND_HEURE', 'TRADUCTION_PLAFOND_JOUR', 'LANGUES_TRADUITES', '_filetLangue'];

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
