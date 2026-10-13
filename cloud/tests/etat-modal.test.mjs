// Levier L8 de l'etude des couts du 11/10/2026 : l'application CPU `myfabmesh-etat` (modal_app/etat_services.py) ne doit plus rester
// allumee parce qu'on la sonde en continu. Deux etages, testes ici sans reseau ni GPU (la fenetre de maintien Modal : etat-modal-fenetre.test.mjs) :
//   1. worker (/api/modal-status, /api/admin/modal-status) : cache court (60 s visiteurs, 15 s /admin2 ou ?frais=1), une seule lecture
//      en vol, repli rapide (4,5 s) puis pause de 30 s apres un echec, cache perime par un reveil ou un interrupteur chaud / froid ;
//   2. pages (site : cloud-overrides.js ; /admin2) : aucune lecture onglet masque, reprise au retour, une seule boucle.
// Lancer : cd cloud && node --test tests/etat-modal.test.mjs
// Ancien code (prouver que les tests ECHOUENT dessus) :
//   git show <rev>:cloud/src/worker.ts > <tmp>/worker.ts ; git show <rev>:cloud/public/app/cloud-overrides.js > <tmp>/co.js ;
//   git show <rev>:cloud/public/admin2.html > <tmp>/admin2.html ;
//   WORKER_SRC=<tmp>/worker.ts WEB_OVERRIDES=<tmp>/co.js ADMIN2_HTML=<tmp>/admin2.html node --test tests/etat-modal.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as acorn from 'acorn';
import { chargerFonctions, existe } from './_charge-worker.mjs';

const chemin = (env, rel) => process.env[env] || new URL(rel, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const lire = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const FICHIERS = {
  overrides: chemin('WEB_OVERRIDES', '../public/app/cloud-overrides.js'),
  admin2: chemin('ADMIN2_HTML', '../public/admin2.html'),
};
/** Charge les declarations qui existent dans l'exemplaire teste : sur l'ancien code, les tests echouent par COMPORTEMENT. */
const charger = (noms, doublures = {}) => chargerFonctions(noms.filter((n) => existe(n)), doublures);
/** Attend une promesse au plus `ms` millisecondes REELLES : un ancien code qui reste bloque fait echouer le test au lieu de le figer. */
const AUCUNE = Symbol('aucune reponse');
const auPlus = (p, ms = 1500) => {
  let m;
  return Promise.race([p, new Promise((ok) => { m = setTimeout(() => ok(AUCUNE), ms); })]).finally(() => clearTimeout(m));
};

/* ═══════════════════════ horloge simulee (Date, setTimeout, AbortSignal.timeout) ═══════════════════════ */
function horloge(depart = Date.UTC(2026, 9, 13, 18, 0, 0)) {
  let maintenant = depart, seq = 0;
  const minuteries = new Map();
  class FauxDate extends Date {
    constructor(...a) { if (a.length) super(...a); else super(maintenant); }
    static now() { return maintenant; }
  }
  const poser = (f, ms) => { const id = ++seq; minuteries.set(id, { f, a: maintenant + Math.max(0, Number(ms) || 0) }); return id; };
  const retirer = (id) => { minuteries.delete(id); };
  const FauxAbortSignal = { timeout(ms) { const ac = new AbortController(); poser(() => ac.abort(new Error('TimeoutError')), ms); return ac.signal; } };
  const vider = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r)); };
  const avancer = async (ms) => {
    const fin = maintenant + ms;
    for (;;) {
      await vider();
      const prets = [...minuteries.entries()].filter(([, m]) => m.a <= fin).sort((x, y) => x[1].a - y[1].a);
      if (!prets.length) break;
      const [id, m] = prets[0];
      minuteries.delete(id); maintenant = m.a; m.f();
    }
    maintenant = fin;
    await vider();
  };
  return { Date: FauxDate, setTimeout: poser, clearTimeout: retirer, AbortSignal: FauxAbortSignal, avancer, vider, minuteries,
    get maintenant() { return maintenant; } };
}

/* ═══════════════════════ 1. WORKER ═══════════════════════ */
const URL_ETAT = 'https://ex--myfabmesh-etat-etat-services.modal.run';
const FROID = { text2image: { etat: 'cold' }, image: { etat: 'cold' }, mesh: { etat: 'cold' } };
const CHAUD = { text2image: { etat: 'warm' }, image: { etat: 'warm' }, mesh: { etat: 'warm' } };

/** Faux reseau : l'application d'etat repond `corps`, est en panne (502) ou ne repond pas (jusqu'a son abandon par le signal). */
function reseau(h) {
  const appels = [];
  let mode = { type: 'ok', corps: FROID };
  const bloques = [];
  async function fetch(url, init = {}) {
    appels.push({ url: String(url), t: h.maintenant, corps: init.body ? JSON.parse(init.body) : null });
    const m = mode;
    if (m.type === 'bloque') {
      return new Promise((ok, ko) => {
        bloques.push(ok);
        init.signal?.addEventListener?.('abort', () => ko(new Error('abort')));
      });
    }
    if (m.type === 'panne') return new Response('panne', { status: 502 });
    return new Response(JSON.stringify(m.corps), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return {
    fetch, appels,
    poser(m) { mode = m; },
    liberer(corps) { for (const ok of bloques.splice(0)) ok(new Response(JSON.stringify(corps), { status: 200 })); },
    lectures() { return appels.filter((a) => a.url === URL_ETAT).length; },
  };
}

/** Base Supabase vide (aucun travail recent ni en cours) : chainable, comme le client. */
function baseVide() {
  const q = { select: () => q, eq: () => q, gte: () => q, in: () => q, order: () => q, limit: () => q,
    then: (ok, ko) => Promise.resolve({ data: [], error: null }).then(ok, ko) };
  return { from: () => q };
}

const NOMS_WORKER = ['SECURITY_HEADERS', 'json', 'err', 'COLD_THRESHOLD_MS', 'KEEP_WARM_HEURES', 'PREWARM_FRESH_MS',
  'ETAT_FRAIS_VISITEUR_MS', 'ETAT_FRAIS_ACTIF_MS', 'ETAT_INTERVALLE_MIN_MS', 'ETAT_ATTENTE_MS', 'ETAT_DELAI_MAX_MS', 'ETAT_PAUSE_ECHEC_MS',
  'ETAT_REPLI_MAX_MS', '_etatReel', '_etatServicesUrl', '_lireEtatServices', '_etatReelPerime', '_etatReelModal', '_avecDelai',
  'handleModalStatus', 'handleAdminModalStatus', '_healthzUrl', 'preWarmModal', '_etatGardeUrl', '_gardeChaudAppliquer'];

function monde() {
  const h = horloge();
  const r = reseau(h);
  const w = charger(NOMS_WORKER, {
    Date: h.Date, setTimeout: h.setTimeout, clearTimeout: h.clearTimeout, AbortSignal: h.AbortSignal, fetch: r.fetch,
    getSessionUser: async () => ({ id: 'compte-1' }),
    supabaseAdmin: () => baseVide(),
    _readLastWarmMs: async () => null,
    _writeLastWarmMs: async () => {},
    _rigBaseUrl: () => null,
    _requireAdmin: async () => ({ email: 'admin@exemple.test' }),
    _keepWarmLire: async () => ({}),
  });
  const env = { MODAL_ETAT_URL: URL_ETAT, MODAL_SHARED_SECRET: 'secret-partage' };
  /** GET de la route (promesse de la reponse JSON). */
  const brut = (chemin = '/api/modal-status', { admin = false, ctx } = {}) => {
    const req = new Request('https://site.test' + chemin);
    const p = admin ? w.handleAdminModalStatus(req, env, ctx) : w.handleModalStatus(req, env, ctx ? { ctx } : undefined);
    return p.then(async (rep) => JSON.parse(await rep.text()));
  };
  const statut = async (chemin, o) => {
    const j = await auPlus(brut(chemin, o));
    assert.notEqual(j, AUCUNE, 'la route n a pas repondu');
    return j;
  };
  return { h, r, w, env, brut, statut };
}

test('worker : visiteurs = UNE lecture de l application d etat par minute, servie a tous par le cache', { timeout: 20_000 }, async () => {
  const m = monde();
  const a = await m.statut();
  assert.equal(m.r.lectures(), 1);
  assert.equal(a.text2image.reel, true);
  assert.equal(a.text2image.etat, 'cold');
  assert.equal(m.r.appels[0].corps._auth, 'secret-partage', 'cle partagee transmise');
  await m.h.avancer(10_000);
  const b = await m.statut();
  assert.equal(m.r.lectures(), 1, '2e lecture 10 s plus tard : servie par le cache, sans appeler Modal');
  assert.equal(b.text2image.etat, 'cold');
  assert.equal(b.text2image.reel, true);
  assert.equal(b.etat_reel_age_s, 10, 'age de l etat reel annonce');
  for (let i = 0; i < 4; i++) { await m.h.avancer(10_000); await m.statut(); }
  assert.equal(m.r.lectures(), 1, '6 lectures en 50 s : un seul appel');
  await m.h.avancer(11_000);
  await m.statut();
  assert.equal(m.r.lectures(), 2, 'au-dela de 60 s : nouvelle lecture');
});

test('worker : /admin2 et ?frais=1 = 15 s ; le visiteur profite de la lecture la plus recente', { timeout: 20_000 }, async () => {
  const m = monde();
  await m.statut();                                             // t = 0 : lecture 1
  await m.h.avancer(10_000);
  await m.statut('/api/modal-status?frais=1');                  // 10 s < 15 s
  assert.equal(m.r.lectures(), 1, 'frais : 10 s, encore dans le cache');
  await m.h.avancer(6_000);
  await m.statut('/api/modal-status?frais=1');                  // 16 s
  assert.equal(m.r.lectures(), 2, 'frais : au-dela de 15 s, nouvelle lecture');
  await m.h.avancer(8_000);
  const adm = await m.statut('/api/admin/modal-status', { admin: true });   // 24 s : age 8 s
  assert.equal(m.r.lectures(), 2, 'admin : 8 s, cache');
  assert.equal(adm.mesh.reel, true);
  assert.deepEqual(adm.garde_chaud, {}, 'la route admin ajoute toujours la garde au chaud');
  await m.h.avancer(8_000);
  await m.statut('/api/admin/modal-status', { admin: true });   // 32 s : age 16 s
  assert.equal(m.r.lectures(), 3, 'admin : au-dela de 15 s, nouvelle lecture');
  await m.h.avancer(20_000);
  await m.statut();                                             // 52 s, visiteur : age 20 s
  assert.equal(m.r.lectures(), 3, 'visiteur : la lecture de l admin (20 s) suffit');
});

test('worker : une seule lecture en vol, pas de rafale (5 requetes simultanees = 1 appel)', { timeout: 20_000 }, async () => {
  const m = monde();
  m.r.poser({ type: 'bloque' });
  const reps = [1, 2, 3, 4, 5].map(() => m.brut());
  await m.h.vider();
  assert.equal(m.r.lectures(), 1, 'une seule lecture partie pour 5 requetes');
  m.r.liberer(CHAUD);
  const toutes = await auPlus(Promise.all(reps));
  assert.notEqual(toutes, AUCUNE, 'toutes les requetes ont repondu');
  assert.equal(m.r.lectures(), 1);
  assert.ok(toutes.some((j) => j.mesh.reel === true && j.mesh.etat === 'warm'), 'la requete qui a lance la lecture rend l etat reel');
  assert.ok(toutes.filter((j) => !j.mesh.reel).length >= 1, 'les autres repondent sans attendre (estimation)');
  m.r.poser({ type: 'ok', corps: CHAUD });
  await m.h.avancer(1_000);
  const apres = await m.statut();
  assert.equal(apres.mesh.etat, 'warm', 'la lecture suivante sert la valeur rapportee');
  assert.equal(m.r.lectures(), 1);
});

test('worker : repli RAPIDE si l application d etat ne repond pas, puis 30 s sans nouvel essai', { timeout: 20_000 }, async () => {
  const m = monde();
  m.r.poser({ type: 'bloque' });
  let fini = false;
  const p = m.brut().then((j) => { fini = true; return j; });
  await m.h.avancer(4_600);
  assert.equal(fini, true, 'reponse au bout de 4,5 s (et non 8 s ou plus)');
  const j = await p;
  assert.equal(j.text2image.reel, undefined, 'estimation');
  assert.equal(j.etat_reel_age_s, null);
  await m.h.avancer(4_000);                                     // 8,6 s : la lecture est abandonnee (delai de 8 s) = echec
  const n = m.r.lectures();
  let fini2 = false;
  const p2 = m.brut().then((x) => { fini2 = true; return x; });
  await m.h.vider();
  assert.equal(fini2, true, 'apres un echec : reponse immediate');
  await p2;
  assert.equal(m.r.lectures(), n, 'pas de nouvel essai pendant 30 s');
  m.r.poser({ type: 'ok', corps: CHAUD });
  await m.h.avancer(20_000);
  await m.statut();
  assert.equal(m.r.lectures(), n, 'toujours rien 28,6 s apres l echec');
  await m.h.avancer(10_000);
  const k = await m.statut();
  assert.equal(m.r.lectures(), n + 1, 'nouvel essai apres 30 s');
  assert.equal(k.mesh.etat, 'warm');
});

test('worker : repli sur la DERNIERE valeur connue (moins de 2 min, age annonce), puis sur l estimation', { timeout: 20_000 }, async () => {
  const m = monde();
  await m.statut();                                             // t = 0 : froid
  await m.h.avancer(61_000);
  m.r.poser({ type: 'panne' });
  const a = await m.statut();                                   // 61 s : 502
  assert.equal(m.r.lectures(), 2);
  assert.equal(a.text2image.reel, true, 'derniere valeur connue (61 s)');
  assert.equal(a.text2image.etat, 'cold');
  assert.equal(a.etat_reel_age_s, 61);
  await m.h.avancer(60_000);
  const b = await m.statut();                                   // 121 s : nouvel echec, valeur trop vieille
  assert.equal(m.r.lectures(), 3);
  assert.equal(b.text2image.reel, undefined, 'plus de 2 min : estimation');
  assert.equal(b.etat_reel_age_s, null);
});

test('worker : la lecture interrompue par le repli finit en arriere-plan (waitUntil) et sert la requete suivante', { timeout: 20_000 }, async () => {
  const m = monde();
  m.r.poser({ type: 'bloque' });
  const confiees = [];
  const ctx = { waitUntil: (p) => { confiees.push(p); } };
  const p = m.brut('/api/modal-status', { ctx });
  await m.h.avancer(4_600);
  const j = await auPlus(p);
  assert.notEqual(j, AUCUNE, 'reponse de repli');
  assert.equal(confiees.length, 1, 'la lecture est confiee a waitUntil');
  m.r.liberer(CHAUD);
  await auPlus(Promise.all(confiees));
  const k = await m.statut();
  assert.equal(k.mesh.etat, 'warm', 'valeur rapportee par la lecture d arriere-plan');
  assert.equal(m.r.lectures(), 1, 'sans nouvel appel');
});

test('worker : un reveil (preWarmModal) perime le cache : la lecture suivante est neuve', { timeout: 20_000 }, async () => {
  const m = monde();
  await m.statut();
  await m.h.avancer(3_000);
  await m.statut();
  assert.equal(m.r.lectures(), 1, '3 s plus tard : cache');
  m.r.poser({ type: 'ok', corps: { ...FROID, text2image: { etat: 'starting' } } });
  await m.w.preWarmModal({ ...m.env, MODAL_TEXT2IMAGE_URL: 'https://ex--myfabmeshpredictor-router.modal.run/text2image' }, { cible: 'text2image' });
  assert.ok(m.r.appels.some((a) => /\/healthz$/.test(a.url)), 'reveil envoye');
  await m.h.avancer(2_500);                                     // la page relit 2,5 s apres le reveil
  const j = await m.statut('/api/modal-status?frais=1');
  assert.equal(m.r.lectures(), 2, 'la lecture qui suit le reveil interroge Modal');
  assert.equal(j.text2image.etat, 'starting', 'le demarrage se voit tout de suite');
});

test('worker : un interrupteur chaud / froid (garde_chaud) perime aussi le cache', { timeout: 20_000 }, async () => {
  const m = monde();
  await m.statut('/api/admin/modal-status', { admin: true });
  await m.h.avancer(3_000);
  await m.statut('/api/admin/modal-status', { admin: true });
  assert.equal(m.r.lectures(), 1, '3 s plus tard : cache');
  await m.w._gardeChaudAppliquer(m.env, { mesh: true });
  assert.ok(m.r.appels.some((a) => /myfabmesh-etat-garde-chaud/.test(a.url)), 'interrupteur applique');
  await m.h.avancer(2_000);
  await m.statut('/api/admin/modal-status', { admin: true });
  assert.equal(m.r.lectures(), 2, 'l etat relu reflete l interrupteur');
});

test('worker : sans URL de l application d etat, aucune lecture et l estimation reste servie', { timeout: 20_000 }, async () => {
  const m = monde();
  delete m.env.MODAL_ETAT_URL;
  const j = await m.statut();
  assert.equal(m.r.appels.length, 0);
  assert.equal(j.text2image.reel, undefined);
  assert.equal(j.etat_reel_age_s ?? null, null);
});

/* ═══════════════════════ 2a. PAGE DU SITE : cloud-overrides.js ═══════════════════════ */
/** Extrait _modalStatusTimer, _pollModalStatus et installModalStatusPoll (imbriques dans cloud-overrides.js) et les monte dans une fausse page. */
function pageSite({ bloquerPremiere = false } = {}) {
  const src = lire(FICHIERS.overrides);
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true });
  const voulus = new Map();
  const visiter = (n) => {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'FunctionDeclaration' && n.id && ['_pollModalStatus', 'installModalStatusPoll'].includes(n.id.name) && !voulus.has(n.id.name)) voulus.set(n.id.name, n);
    if (n.type === 'VariableDeclaration' && n.declarations.some((d) => d.id && d.id.name === '_modalStatusTimer') && !voulus.has('_modalStatusTimer')) voulus.set('_modalStatusTimer', n);
    for (const k of Object.keys(n)) { const v = n[k]; if (Array.isArray(v)) v.forEach(visiter); else if (v && typeof v.type === 'string') visiter(v); }
  };
  visiter(ast);
  for (const nom of ['_modalStatusTimer', '_pollModalStatus', 'installModalStatusPoll']) assert.ok(voulus.has(nom), nom + ' introuvable dans cloud-overrides.js');
  const code = [...voulus.values()].sort((a, b) => a.start - b.start).map((n) => src.slice(n.start, n.end)).join('\n');

  const h = horloge();
  const ecouteurs = {};
  const popover = { style: { display: 'none' } };
  const document = {
    visibilityState: 'visible', hidden: false,
    getElementById: (id) => (id === 'gpu-warmup-popover' ? popover : null),
    addEventListener: (t, f) => { (ecouteurs[t] ||= []).push(f); },
    removeEventListener() {},
  };
  const window = { dispatchEvent() {} };
  const lectures = [];
  let premiere = bloquerPremiere, liberer = null;
  const fetch = (url) => {
    lectures.push({ url: String(url), t: h.maintenant });
    const rep = { ok: true, json: async () => ({ image_op: { warm: true }, mesh: { warm: false, etat: 'cold' } }) };
    if (premiere) { premiere = false; return new Promise((ok) => { liberer = () => ok(rep); }); }
    return Promise.resolve(rep);
  };
  const console = { log() {}, warn() {} };
  class CustomEvent { constructor(t, o) { this.type = t; this.detail = o && o.detail; } }
  // eslint-disable-next-line no-new-func
  const f = new Function('document', 'window', 'fetch', 'setTimeout', 'clearTimeout', 'Date', 'console', 'CustomEvent',
    code + '\nreturn { installModalStatusPoll };');
  const api = f(document, window, fetch, h.setTimeout, h.clearTimeout, h.Date, console, CustomEvent);
  const basculer = (masque) => {
    document.visibilityState = masque ? 'hidden' : 'visible'; document.hidden = masque;
    for (const g of (ecouteurs.visibilitychange || [])) g();
  };
  return { h, api, window, document, popover, lectures, basculer, liberer: () => liberer && liberer() };
}

test('site : AUCUNE lecture de l etat onglet masque, reprise immediate au retour', { timeout: 20_000 }, async () => {
  const p = pageSite();
  p.api.installModalStatusPoll();
  await p.h.vider();
  assert.equal(p.lectures.length, 1, 'lecture au chargement');
  await p.h.avancer(60_000);
  assert.equal(p.lectures.length, 2, 'une lecture par minute au repos');
  p.basculer(true);
  await p.h.avancer(10 * 60_000);
  assert.equal(p.lectures.length, 2, 'onglet masque : aucune lecture pendant 10 min');
  p.window.__sonderEtatModal(0);
  await p.h.avancer(5_000);
  assert.equal(p.lectures.length, 2, 'onglet masque : un reveil ne relance pas la lecture');
  p.basculer(false);
  await p.h.vider();
  assert.equal(p.lectures.length, 3, 'retour sur l onglet : lecture immediate');
  await p.h.avancer(31_000);                                    // fin de la fenetre « active » du reveil
  const n = p.lectures.length;
  await p.h.avancer(60_000);
  assert.equal(p.lectures.length, n + 1, 'puis cadence de repos (60 s)');
});

test('site : lectures « actives » en ?frais=1 (panneau ouvert, 30 s apres un reveil), simples au repos', { timeout: 20_000 }, async () => {
  const p = pageSite();
  p.api.installModalStatusPoll();
  await p.h.vider();
  assert.equal(p.lectures[0].url, '/api/modal-status', 'au repos : pas de lecture fraiche');
  p.popover.style.display = 'block';
  await p.h.avancer(60_000);
  assert.equal(p.lectures.at(-1).url, '/api/modal-status?frais=1', 'panneau ouvert : lecture fraiche');
  await p.h.avancer(5_000);
  assert.equal(p.lectures.at(-1).url, '/api/modal-status?frais=1', 'panneau ouvert : toutes les 5 s');
  p.popover.style.display = 'none';
  await p.h.avancer(5_000);
  await p.h.avancer(60_000);
  assert.equal(p.lectures.at(-1).url, '/api/modal-status', 'panneau ferme : retour au repos');
  p.window.__sonderEtatModal();                                 // apres un reveil (prewarmGpu)
  await p.h.avancer(2_500);
  assert.equal(p.lectures.at(-1).url, '/api/modal-status?frais=1', 'apres un reveil : lecture fraiche');
});

test('site : une seule boucle de lecture, meme si __sonderEtatModal arrive pendant une lecture', { timeout: 20_000 }, async () => {
  const p = pageSite({ bloquerPremiere: true });
  p.api.installModalStatusPoll();
  await p.h.vider();
  assert.equal(p.lectures.length, 1, 'premiere lecture en cours');
  p.window.__sonderEtatModal(0);                                // survol du panneau pendant la lecture
  await p.h.avancer(0);
  p.liberer();
  await p.h.avancer(0);
  await p.h.avancer(5 * 60_000);
  assert.equal(p.h.minuteries.size, 1, 'une seule minuterie de lecture programmee (pas de seconde boucle)');
  const n = p.lectures.length;
  await p.h.avancer(10 * 60_000);
  assert.equal(p.lectures.length - n, 10, 'au repos : 10 lectures en 10 min, pas 20');
});

/* ═══════════════════════ 2b. /admin2 ═══════════════════════ */
function scriptAdmin2() {
  const html = lire(FICHIERS.admin2);
  const blocs = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const src = blocs.find((b) => b.includes('function cadence('));
  assert.ok(src, 'script principal de /admin2 introuvable');
  return { src, ast: acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true }) };
}
function trouver(ast, test) {
  let r = null;
  const visiter = (n) => {
    if (!n || typeof n !== 'object' || r) return;
    if (test(n)) { r = n; return; }
    for (const k of Object.keys(n)) { const v = n[k]; if (Array.isArray(v)) v.forEach(visiter); else if (v && typeof v.type === 'string') visiter(v); }
  };
  visiter(ast);
  return r;
}
const fonction = (ast, nom) => trouver(ast, (n) => n.type === 'FunctionDeclaration' && n.id && n.id.name === nom);

test('admin2 : la cadence ne fait rien onglet masque', () => {
  const { src, ast } = scriptAdmin2();
  const c = fonction(ast, 'cadence');
  assert.ok(c);
  const intervalles = [];
  const document = { hidden: false };
  // eslint-disable-next-line no-new-func
  const cadence = new Function('document', 'setInterval', src.slice(c.start, c.end) + '\nreturn cadence;')(document, (f) => intervalles.push(f));
  let n = 0;
  cadence(() => { n++; }, 8000);
  intervalles[0]();
  document.hidden = true; intervalles[0](); intervalles[0]();
  document.hidden = false; intervalles[0]();
  assert.equal(n, 2);
});

test('admin2 : l etat des conteneurs n est sonde que onglet visible, sur Maintenant / Sante, un appel a la fois', async () => {
  const { src, ast } = scriptAdmin2();
  const s = fonction(ast, 'sonderModalStatus'), sur = fonction(ast, 'sur');
  assert.ok(s, 'sonderModalStatus absent : la sonde de modal-status n est pas factorisee (retour sur l onglet impossible)');
  const S = { tab: 'systeme', msEnCours: 0 };
  const document = { hidden: false };
  let appels = 0, finir = null;
  const chargerModalStatus = () => { appels++; return new Promise((ok) => { finir = ok; }); };
  // eslint-disable-next-line no-new-func
  const sonder = new Function('document', 'S', 'chargerModalStatus', 'Date', src.slice(sur.start, sur.end) + '\n' + src.slice(s.start, s.end) + '\nreturn sonderModalStatus;')(
    document, S, chargerModalStatus, Date);
  sonder();
  assert.equal(appels, 1, 'Sante, onglet visible : lecture');
  sonder();
  assert.equal(appels, 1, 'lecture precedente pas revenue : pas de second appel');
  finir();
  await new Promise((r) => setImmediate(r));
  assert.equal(S.msEnCours, 0, 'garde levee au retour de la lecture');
  document.hidden = true; sonder();
  assert.equal(appels, 1, 'onglet masque : aucun appel');
  document.hidden = false; S.tab = 'argent'; sonder();
  assert.equal(appels, 1, 'autre onglet de l admin : aucun appel');
  S.tab = 'maintenant'; sonder();
  assert.equal(appels, 2, 'Maintenant, visible : lecture');
});

test('admin2 : retour sur l onglet = relecture immediate de l etat ; aucun setInterval direct sur modal-status', () => {
  const { src, ast } = scriptAdmin2();
  const ecoute = trouver(ast, (n) => n.type === 'CallExpression' && n.callee && n.callee.type === 'MemberExpression'
    && n.callee.object && n.callee.object.name === 'document' && n.callee.property && n.callee.property.name === 'addEventListener'
    && n.arguments[0] && n.arguments[0].value === 'visibilitychange' && /chargerLive/.test(src.slice(n.start, n.end)));
  assert.ok(ecoute, 'ecouteur visibilitychange de /admin2 introuvable');
  const fn = ecoute.arguments[1];
  const appels = [];
  const noter = (nom) => () => { appels.push(nom); };
  const document = { hidden: false };
  // eslint-disable-next-line no-new-func
  const f = new Function('document', 'chargerLive', 'chargerServices', 'chargerBadges', 'maintenirSession', 'sonderModalStatus', 'chargerModalStatus',
    'return (' + src.slice(fn.start, fn.end) + ');')(document, noter('live'), noter('services'), noter('badges'), noter('session'), noter('modal'), noter('modal'));
  f();
  assert.ok(appels.includes('modal'), 'retour sur l onglet : l etat des conteneurs n est pas relu (jusqu a 8 s d etat perime)');
  appels.length = 0; document.hidden = true; f();
  assert.equal(appels.length, 0, 'masquage : rien');
  assert.ok(!/setInterval\([^\n]*(ModalStatus|modal-status)/.test(src), 'un setInterval sonde modal-status sans passer par cadence');
  assert.match(src, /cadence\(sonderModalStatus, 8000\)/);
});

test('admin2 : un etat reel de repli (Modal muet) est affiche avec son age, jamais comme actuel', () => {
  const { src, ast } = scriptAdmin2();
  const a = fonction(ast, 'ageReel');
  assert.ok(a, 'ageReel absent : un etat reel de 2 min serait presente comme actuel');
  // eslint-disable-next-line no-new-func
  const ageReel = new Function(src.slice(a.start, a.end) + '\nreturn ageReel;')();
  assert.equal(ageReel({ etat_reel_age_s: 12 }), '', 'cache normal (15 s) : rien');
  assert.equal(ageReel({}), '', 'ancien worker sans age : rien');
  assert.match(ageReel({ etat_reel_age_s: 75 }), /\(75 s\)/, 'repli : age affiche');
  assert.equal((src.match(/e\.reel \? ageReel\(m\)/g) || []).length, 2, 'cartes Conteneurs (Maintenant) et garde au chaud (Sante)');
});
