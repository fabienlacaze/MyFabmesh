// Case « T-pose » (2026-10-03, demande du user : cochee par defaut, +1 credit) — SERVEUR.
// Charge les VRAIES fonctions de cloud/src/worker.ts (transpilees) avec des doublures : aucun reseau, aucun GPU.
// Prouve : le supplement `tpose` s'ajoute PAR IMAGE quand (et seulement quand) la route T-pose est reellement utilisee ; le credit debite, le remboursement
// d'un echec et la ligne de journal portent le MEME montant ; la case decochee (poseLibre) est transmise a Modal ; la grille expose la cle.
// Lancer : cd cloud && node --test tests/tpose-option.test.mjs     (ancien code : WORKER_SRC=<chemin> node --test tests/tpose-option.test.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chargerFonctions, lireSource, existe } from './_charge-worker.mjs';

const GRILLE = { text2image: 6, tpose: 1 };

function monter({ tposeUrl = 'https://tpose.example', t2iUrl = 'https://t2i.example', echec = false, credits = 500, grille = GRILLE } = {}) {
  const j = { depenses: [], remboursements: [], tposeAppels: [], t2iAppels: [], journal: [], prixLus: [], assets: [] };
  const reponse = (o, init) => new Response(JSON.stringify(o), { status: (init && init.status) || 200, headers: { 'content-type': 'application/json' } });
  const dbl = {
    getSessionUser: async () => ({ id: 'u1', email: 'a@b.c' }),
    err: (status, message) => reponse({ error: message }, { status }),
    json: (o, init) => reponse(o, init),
    getParentalState: async () => ({}),
    _checkPromptSafetyAlerte: async () => ({ safe: true }),
    getPrice: async (_env, k) => { j.prixLus.push(k); return grille[k]; },
    isTrustedAssetHost: () => true,
    checkAndIncrementModalSpend: async () => 100,
    checkAndIncrementDailySpend: async () => 100,
    _spendRefusalMessage: async () => 'refus',
    checkAndIncrementUserCalls: async () => 10,
    refundModalSpend: async () => {},
    refundDailySpend: async () => {},
    spendCredits: async (_e, _u, cout) => { j.depenses.push(cout); return credits - cout; },
    addCredits: async (_e, _u, cout) => { j.remboursements.push(cout); },
    callModalTpose: async (_e, _u, input) => { j.tposeAppels.push(input); if (echec) throw new Error('GPU en panne'); return 'https://r2.example/front/t.png'; },
    callModalText2Image: async (_e, _u, input) => { j.t2iAppels.push(input); if (echec) throw new Error('GPU en panne'); return 'https://r2.example/front/i.png'; },
    callMyfabmeshCog: async (_e, _u, input) => { j.t2iAppels.push(input); return 'https://r2.example/front/c.png'; },
    logOperation: async (_e, _u, type, cout, _d, _f, statut) => { j.journal.push({ type, cout, statut }); },
    insertUserAsset: async (_e, _u, projet, genre) => { j.assets.push({ projet, genre }); },
    r2PathFromPublicUrl: (_e, u) => u,
  };
  const w = chargerFonctions(['handleGenerateImage', '_prixImageSelonPas', '_prixImageComplet'], dbl);
  const env = { MODAL_TPOSE_URL: tposeUrl, MODAL_TEXT2IMAGE_URL: t2iUrl };
  const appeler = (corps) => w.handleGenerateImage(
    new Request('https://x.example/api/generate-image', { method: 'POST', body: JSON.stringify(corps) }), env);
  return { j, appeler, w };
}
const BASE = { prompt: 'An orc warrior, holding a club', userPrompt: 'An orc warrior, holding a club', asset_type: 'character', asset_style: 'realistic', steps: 30 };

test('_prixImageComplet : le supplement s ajoute au prix de l image, sans suivre les pas ni le Turbo', () => {
  const { w } = monter();
  assert.equal(w._prixImageComplet(6, 30, 0), 6);
  assert.equal(w._prixImageComplet(6, 30, 1), 7);
  assert.equal(w._prixImageComplet(6, 10, 1), 3, '10 pas = 2, plus 1');
  assert.equal(w._prixImageComplet(6, 60, 1), 13, '60 pas = 12, plus 1');
  assert.equal(w._prixImageComplet(6, 4, 1), 2, 'Turbo : prix de 4 pas (1, plancher), plus 1');
  assert.equal(w._prixImageComplet(6, 30, undefined), 6);
  assert.equal(w._prixImageComplet(6, 30, -3), 6, 'un supplement negatif vaut 0');
  assert.equal(w._prixImageComplet(6, 30, NaN), 6);
  assert.equal(w._prixImageComplet(6, 30, 2), 8);
});

test('la grille porte la cle tpose, a 1, et le garde-fou des prix affiches la connait', () => {
  const src = lireSource();
  const m = src.match(/const PRICING_DEFAULTS = \{([\s\S]*?)\n\};/);
  assert.ok(m, 'PRICING_DEFAULTS introuvable');
  assert.match(m[1], /^\s*tpose:\s*1,/m);
  assert.ok(existe('_prixImageComplet'));
});

test('tpose vrai : 3 images coutent 3 x (6 + 1) = 21, le supplement est lu dans la grille', async () => {
  const { j, appeler } = monter();
  const r = await appeler({ ...BASE, numImages: 3, tpose: true });
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual(j.depenses, [21]);
  assert.deepEqual(j.remboursements, []);
  assert.equal(j.tposeAppels.length, 3);
  assert.equal(j.t2iAppels.length, 0);
  assert.ok(j.prixLus.includes('tpose'));
  // une ligne de journal par image, au prix complet de l'image (7), pas 6
  assert.deepEqual(j.journal.map((l) => l.cout), [7, 7, 7]);
  assert.ok(j.journal.every((l) => l.type === 'tpose' && l.statut === 'succeeded'));
});

test('tpose faux ou absent : prix inchange (6 par image), la grille n est pas interrogee pour le supplement', async () => {
  for (const corps of [{ ...BASE, numImages: 2 }, { ...BASE, numImages: 2, tpose: false }]) {
    const { j, appeler } = monter();
    const r = await appeler(corps);
    assert.equal(r.status, 200, await r.clone().text());
    assert.deepEqual(j.depenses, [12]);
    assert.ok(!j.prixLus.includes('tpose'), 'pas de lecture du supplement quand la T-pose n est pas utilisee');
    assert.equal(j.tposeAppels.length, 0);
    assert.equal(j.t2iAppels.length, 2);
    assert.deepEqual(j.journal.map((l) => l.cout), [6, 6]);
  }
});

test('tpose demande mais route T-pose absente (MODAL_TPOSE_URL non pose) : pas de supplement, pas de T-pose', async () => {
  const { j, appeler } = monter({ tposeUrl: '' });
  const r = await appeler({ ...BASE, numImages: 2, tpose: true });
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual(j.depenses, [12], 'on ne facture pas une route qu on n utilise pas');
  assert.equal(j.tposeAppels.length, 0);
});

test('echec GPU : le remboursement rend EXACTEMENT ce qui a ete debite, supplement compris', async () => {
  const { j, appeler } = monter({ echec: true });
  const r = await appeler({ ...BASE, numImages: 4, tpose: true });
  assert.equal(r.status, 502);
  assert.deepEqual(j.depenses, [28]);
  assert.deepEqual(j.remboursements, [28], 'debit 4 x 7 = 28, remboursement 28');
});

test('le supplement suit une grille modifiee par l administrateur', async () => {
  const { j, appeler } = monter({ grille: { text2image: 6, tpose: 3 } });
  await appeler({ ...BASE, numImages: 2, tpose: true });
  assert.deepEqual(j.depenses, [18], '2 x (6 + 3)');
});

test('poseLibre (case decochee) est transmis a Modal ; sans la case, faux', async () => {
  const a = monter();
  await a.appeler({ ...BASE, numImages: 1, poseLibre: true });
  assert.equal(a.j.t2iAppels[0].pose_libre, true);
  assert.equal(a.j.t2iAppels[0].prompt, 'An orc warrior, holding a club', 'Modal recoit le texte brut');
  const b = monter();
  await b.appeler({ ...BASE, numImages: 1 });
  assert.equal(b.j.t2iAppels[0].pose_libre, false);
});

test('le corps envoye a Modal text2image porte pose_libre', () => {
  const src = lireSource();
  const i = src.indexOf('async function callModalText2Image');
  assert.ok(i > 0);
  assert.match(src.slice(i, i + 1500), /pose_libre: !!input\.pose_libre,/);
  assert.match(src, /pose_libre\?: boolean;/);
});

test('admin : la cle tpose a un libelle et se classe avec les images', () => {
  const adm = lireSource('../public/admin2.html'.startsWith('..') ? new URL('../public/admin2.html', import.meta.url) : '');
  assert.match(adm, /tpose:\s+'T-pose supplement/);
  assert.match(adm, /\^\(text2image\|tpose\|back_view\|/);
});

/* ═══════════════ CLIENTS : le prix AFFICHE suit le prix FACTURE ═══════════════ */
import { readFileSync } from 'node:fs';
import * as acorn from 'acorn';

const lireFichier = (rel) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

/** Extrait installImageCostMeter (fonction imbriquee dans cloud-overrides.js) et l'execute dans une fausse page. */
function monterCompteur({ grille, valeurs = {}, coches = {} }) {
  const src = lireFichier('public/app/cloud-overrides.js');
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true });
  let noeud = null;
  const visiter = (n) => {
    if (!n || typeof n !== 'object' || noeud) return;
    if (n.type === 'FunctionDeclaration' && n.id && n.id.name === 'installImageCostMeter') { noeud = n; return; }
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v)) v.forEach(visiter); else if (v && typeof v.type === 'string') visiter(v);
    }
  };
  visiter(ast);
  assert.ok(noeud, 'installImageCostMeter introuvable dans cloud-overrides.js');
  const code = src.slice(noeud.start, noeud.end);

  const els = {};
  const creer = (id) => ({
    id, value: valeurs[id], checked: !!coches[id], textContent: '', title: '', style: {}, className: '', enfants: [],
    addEventListener() {}, insertAdjacentElement(_pos, el) { this.suivant = el; return el; },
    appendChild(el) { this.enfants.push(el); el.parent = this; return el; },
    querySelector() { return this.enfants.find((c) => /opt-cost/.test(c.className)) || null; },
    closest(sel) { return sel === 'label' ? this.etiquette : (sel === '.generate-cost-pill' ? this.pastilleParente : null); },
  });
  // elements reellement presents sur la page
  for (const id of ['ws-image-cost-value', 'ws-count', 'ws-quality', 'ws-quality-val', 'ws-engine', 'ws-img-buildstages', 'ws-mv-scope', 'ws-asset-type', 'ws-tpose',
    'ws-generate-image']) els[id] = creer(id);
  els['ws-image-cost-value'].pastilleParente = creer('pastille');
  els['ws-img-buildstages'].etiquette = creer('label-etapes');
  els['ws-tpose'].etiquette = creer('label-tpose');
  const document = {
    getElementById: (id) => els[id] || null,
    createElement: () => creer('cree'),
  };
  class MutationObserver { observe() {} }
  const prixDe = (k) => (typeof grille[k] === 'number' ? grille[k] : null);
  const f = new Function('document', 'MutationObserver', '_prixDe', code + '\nreturn installImageCostMeter;')(document, MutationObserver, prixDe);
  f();   // installe le compteur et le calcule une fois
  return {
    total: () => els['ws-image-cost-value'].textContent,
    titre: () => els['ws-image-cost-value'].pastilleParente.title,
    badge: () => { const b = els['ws-tpose'].etiquette.querySelector(); return b ? { texte: b.textContent, cache: b.style.display === 'none' } : null; },
  };
}

function avecFenetre(f) {
  globalThis.window = {};
  try { return f(); } finally { delete globalThis.window; }
}

const GR = { text2image: 6, tpose: 1, back_view: 6 };
const REGLAGES = { 'ws-count': '3', 'ws-quality': '30', 'ws-engine': 'local-flux', 'ws-mv-scope': 'front_only', 'ws-asset-type': 'character' };

test('site : la pastille du bouton Generate annonce 3 x (6 + 1) = 21 pour un personnage, case cochee', () => avecFenetre(() => {
  const c = monterCompteur({ grille: GR, valeurs: REGLAGES, coches: { 'ws-tpose': true } });
  assert.equal(c.total(), '21');
  assert.match(c.titre(), /T-pose \+1/);
  assert.deepEqual(c.badge(), { texte: '+1', cache: false });
}));

test('site : case decochee = 3 x 6 = 18 ; la pastille de la case montre toujours le supplement (+1)', () => avecFenetre(() => {
  const c = monterCompteur({ grille: GR, valeurs: REGLAGES, coches: { 'ws-tpose': false } });
  assert.equal(c.total(), '18');
  assert.deepEqual(c.badge(), { texte: '+1', cache: false });
}));

test('site : un autre type que le personnage ne paie jamais le supplement, case cochee ou non', () => avecFenetre(() => {
  for (const type of ['vehicle', 'building', 'creature', 'animal', 'other_living', 'weapon']) {
    const c = monterCompteur({ grille: GR, valeurs: { ...REGLAGES, 'ws-asset-type': type }, coches: { 'ws-tpose': true } });
    assert.equal(c.total(), '18', type);
  }
}));

test("site : grille sans la cle tpose (serveur plus ancien) = rien d'annonce en plus, pastille de la case masquee", () => avecFenetre(() => {
  const c = monterCompteur({ grille: { text2image: 6, back_view: 6 }, valeurs: REGLAGES, coches: { 'ws-tpose': true } });
  assert.equal(c.total(), '18');
  assert.equal(c.badge().cache, true);
}));

test("site : le prix annonce est EXACTEMENT celui que le worker facture (qualite, Turbo, nombre d'images)", () => avecFenetre(() => {
  const { w } = monter();
  const cas = [
    { n: 1, pas: 30, turbo: false }, { n: 4, pas: 30, turbo: false }, { n: 2, pas: 10, turbo: false }, { n: 3, pas: 60, turbo: false },
    { n: 2, pas: 44, turbo: false }, { n: 4, pas: 30, turbo: true },
  ];
  for (const k of cas) {
    for (const coche of [true, false]) {
      const c = monterCompteur({
        grille: GR,
        valeurs: { ...REGLAGES, 'ws-count': String(k.n), 'ws-quality': String(k.pas), 'ws-engine': k.turbo ? 'local-lightning' : 'local-flux' },
        coches: { 'ws-tpose': coche },
      });
      const facture = k.n * w._prixImageComplet(GR.text2image, k.turbo ? 4 : k.pas, coche ? GR.tpose : 0);
      assert.equal(c.total(), String(facture), JSON.stringify({ ...k, coche }));
    }
  }
}));

test("site : meshyAPI-cloud.js decide la route T-pose D'APRES LA CASE (personnage seulement) et transmet poseLibre", () => {
  const m = lireFichier('public/app/meshyAPI-cloud.js');
  assert.match(m, /const _caseTpose = document\.getElementById\('ws-tpose'\);/);
  assert.match(m, /\? \(asset_type === 'character' && !!_caseTpose\.checked\)/);
  assert.match(m, /const _poseLibre = asset_type === 'character' && !!_caseTpose && !_caseTpose\.checked;/);
  assert.match(m, /tpose: _tposeDemande\(promptArg\),/);
  assert.match(m, /poseLibre: _poseLibre,/);
  // ancienne regle conservee SANS la case (autre page qui appelle le shim)
  assert.match(m, /t-pose\|t pose\|tpose\|arms extended horizontally\|rts unit\|neutral stance/);
});

test('les deux interfaces portent la case, cochee par defaut, et la rendent visible pour le personnage seulement', () => {
  for (const [html, js] of [['../src/renderer/index2.html', '../src/renderer/index2.js'], ['public/app/index.html', 'public/app/index2.js']]) {
    const h = lireFichier(html);
    const j = lireFichier(js);
    assert.match(h, /id="ws-tpose-row"/, html);
    assert.match(h, /<input type="checkbox" id="ws-tpose" checked \/>/, html);
    assert.match(h, /T-pose \(arms out, best for rigging\)/, html);
    assert.match(j, /\(function _wireCaseTpose\(\) \{/, js);
    assert.match(j, /row\.style\.display = \(at === 'character'\) \? '' : 'none'/, js);
    assert.match(j, /function _optionsPose\(assetType\)/, js);
    assert.match(j, /buildFullPrompt\([^)]*_optionsPose\(assetType\)\)/, js);
    assert.match(j, /cbTpose\.checked = !\(meta && meta\.tpose === false\)/, js);
  }
});
