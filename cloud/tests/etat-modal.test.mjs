// Levier L8 de l'etude des couts du 11/10/2026 : l'application CPU `myfabmesh-etat` (modal_app/etat_services.py) ne doit plus rester
// allumee parce qu'on la sonde en continu. Deux etages, testes ici sans reseau ni GPU (la fenetre de maintien Modal :
// etat-modal-fenetre.test.mjs ; la simulation d'une heure, vrai code de la page et du worker : etat-modal-simulation.test.mjs) :
//   1. worker (/api/modal-status, /api/admin/modal-status) : cache court (60 s visiteurs au repos, 4 s pour ?frais=1, 7 s pour /admin2),
//      une seule lecture en vol, repli rapide (4,5 s) puis pause de 30 s apres un echec, cache perime par un reveil (TOUTES les cibles) ou
//      un interrupteur chaud / froid, un travail en cours que la lecture n'a pas vu prime sur elle (relecture du 14/10, cas H11) ;
//   2. pages (site : cloud-overrides.js ; /admin2) : aucune lecture onglet masque, jamais plus de lectures que l'ancien code, une seule boucle.
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
const reponseJson = (corps, status = 200) => new Response(typeof corps === 'string' ? corps : JSON.stringify(corps),
  { status, headers: { 'content-type': 'application/json' } });

/** Faux reseau : l'application d'etat repond `corps` (tout de suite ou apres `delai` ms), est en panne (502), ne repond pas jusqu'a son
 *  abandon par le signal (bloque), ou JAMAIS, abandon ignore (sourd : lecture morte) ; `brut` rend un texte tel quel. */
function reseau(h) {
  const appels = [];
  let mode = { type: 'ok', corps: FROID };
  const file = [];
  const bloques = [];
  const sourds = [];
  async function fetch(url, init = {}) {
    appels.push({ url: String(url), t: h.maintenant, corps: init.body ? JSON.parse(init.body) : null });
    if (String(url) !== URL_ETAT) return reponseJson({ ok: true });
    const m = file.length ? file.shift() : mode;
    if (m.type === 'bloque') {
      return new Promise((ok, ko) => {
        bloques.push(ok);
        init.signal?.addEventListener?.('abort', () => ko(new Error('abort')));
      });
    }
    if (m.type === 'sourd') return new Promise((ok) => { sourds.push(ok); });
    if (m.type === 'panne') return new Response('panne', { status: 502 });
    if (m.type === 'brut') return new Response(m.texte, { status: 200 });
    if (m.delai) return new Promise((ok) => { h.setTimeout(() => ok(reponseJson(m.corps)), m.delai); });
    return reponseJson(m.corps);
  }
  return {
    fetch, appels,
    poser(m) { mode = m; },
    enfiler(...m) { file.push(...m); },
    liberer(corps) { for (const ok of bloques.splice(0)) ok(reponseJson(corps)); },
    /** Regle la plus ANCIENNE lecture sourde avec `corps` (ou un statut d'erreur). */
    liberer1Sourd(corps, status = 200) { const ok = sourds.shift(); if (ok) ok(reponseJson(corps, status)); },
    lectures() { return appels.filter((a) => a.url === URL_ETAT).length; },
  };
}

/** Base Supabase : aucun travail recent ; `actifs()` = travaux en cours (requete `.in('status', ...)`), relus a chaque requete. */
function base({ actifs = () => [] } = {}) {
  return {
    from: () => {
      const q = { enCours: false, select: () => q, eq: () => q, gte: () => q, order: () => q, limit: () => q,
        in: () => { q.enCours = true; return q; },
        then: (ok, ko) => Promise.resolve({ data: q.enCours ? actifs() : [], error: null }).then(ok, ko) };
      return q;
    },
  };
}

const NOMS_WORKER = ['SECURITY_HEADERS', 'json', 'err', 'COLD_THRESHOLD_MS', 'KEEP_WARM_HEURES', 'PREWARM_FRESH_MS',
  'ETAT_FRAIS_VISITEUR_MS', 'ETAT_FRAIS_ACTIF_MS', 'ETAT_FRAIS_ADMIN_MS', 'ETAT_VISIBILITE_MS', 'ETAT_INTERVALLE_MIN_MS', 'ETAT_ATTENTE_MS',
  'ETAT_DELAI_MAX_MS', 'ETAT_PAUSE_ECHEC_MS', 'ETAT_REPLI_MAX_MS', '_etatReel', '_etatServicesUrl', '_lireEtatServices', '_etatReelPerime',
  '_etatReelModal', '_avecDelai', 'handleModalStatus', 'handleAdminModalStatus', '_healthzUrl', 'preWarmModal', '_etatGardeUrl',
  '_gardeChaudAppliquer'];
const URL_RIG = 'https://ex--myfabmesh-rig-router.modal.run/rig-start';

function monde({ actifs } = {}) {
  const h = horloge();
  const r = reseau(h);
  const w = charger(NOMS_WORKER, {
    Date: h.Date, setTimeout: h.setTimeout, clearTimeout: h.clearTimeout, AbortSignal: h.AbortSignal, fetch: r.fetch,
    getSessionUser: async () => ({ id: 'compte-1' }),
    supabaseAdmin: () => base({ actifs }),
    _readLastWarmMs: async () => null,
    _writeLastWarmMs: async () => {},
    _rigBaseUrl: () => URL_RIG,
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

test('worker : ?frais=1 = 4 s et /admin2 = 7 s (sous la cadence de la page qui les demande) ; le visiteur profite de la lecture la plus recente', { timeout: 20_000 }, async () => {
  const m = monde();
  await m.statut();                                             // t = 0 : lecture 1
  await m.h.avancer(3_000);
  await m.statut('/api/modal-status?frais=1');                  // 3 s < 4 s
  assert.equal(m.r.lectures(), 1, 'frais : 3 s, encore dans le cache');
  await m.h.avancer(2_000);
  await m.statut('/api/modal-status?frais=1');                  // 5 s : le panneau ouvert relit toutes les 5 s, chaque lecture est neuve
  assert.equal(m.r.lectures(), 2, 'frais : au-dela de 4 s, nouvelle lecture');
  await m.h.avancer(6_000);
  const adm = await m.statut('/api/admin/modal-status', { admin: true });   // 11 s : age 6 s
  assert.equal(m.r.lectures(), 2, 'admin : 6 s, cache');
  assert.equal(adm.mesh.reel, true);
  assert.deepEqual(adm.garde_chaud, {}, 'la route admin ajoute toujours la garde au chaud');
  await m.h.avancer(2_000);
  await m.statut('/api/admin/modal-status', { admin: true });   // 13 s : age 8 s (cadence de /admin2 : 8 s)
  assert.equal(m.r.lectures(), 3, 'admin : au-dela de 7 s, nouvelle lecture (etat aussi frais qu avant le cache)');
  await m.h.avancer(20_000);
  await m.statut();                                             // 33 s, visiteur : age 20 s
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

test('worker : une lecture en vol bloque les suivantes meme espacees de plus de 2 s ; morte (10 s), elle ne bloque plus', { timeout: 20_000 }, async () => {
  const m = monde();
  m.r.enfiler({ type: 'sourd' });                               // ne se regle jamais, ignore l'abandon (requete coupee sans waitUntil)
  const p = m.brut();
  await m.h.avancer(4_600);
  assert.notEqual(await auPlus(p), AUCUNE, 'repli au bout de 4,5 s');
  for (const pas of [2_000, 3_000]) {                           // 6,6 s puis 9,6 s apres le depart de la lecture en vol
    await m.h.avancer(pas);
    let fini = false;
    const q = m.brut().then(() => { fini = true; });
    await m.h.vider();
    assert.equal(fini, true, 'reponse immediate pendant la lecture en vol');
    await q;
  }
  assert.equal(m.r.lectures(), 1, 'lecture en vol depuis 9,6 s : aucune autre, meme a plus de 2 s d ecart');
  await m.h.avancer(1_000);                                     // 10,6 s : la lecture est morte
  m.r.poser({ type: 'ok', corps: CHAUD });
  const k = await m.statut();
  assert.equal(m.r.lectures(), 2, 'lecture morte ecartee au bout de 10 s : nouvelle lecture');
  assert.equal(k.mesh.etat, 'warm');
});

test('worker : jamais deux departs a moins de 2 s, meme sous une rafale de reveils', { timeout: 30_000 }, async () => {
  const m = monde();
  for (let i = 0; i < 100; i++) {                               // 10 s : un reveil et une lecture fraiche toutes les 100 ms
    m.w._etatReelPerime();
    const p = m.brut('/api/modal-status?frais=1');
    await m.h.avancer(100);
    await auPlus(p);
  }
  assert.ok(m.r.lectures() <= 6, `lectures pendant 10 s de reveils en rafale : ${m.r.lectures()} (attendu <= 6)`);
  assert.ok(m.r.lectures() >= 4, `un reveil doit pourtant faire relire : ${m.r.lectures()} lectures (attendu >= 4)`);
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

test('worker : l age de l etat se compte depuis le DEPART de la lecture (lecture lente de 3 s = etat de 3 s)', { timeout: 20_000 }, async () => {
  const m = monde();
  m.r.poser({ type: 'ok', corps: FROID, delai: 3_000 });        // application d'etat froide : 3 s
  const p = m.brut();
  await m.h.avancer(3_000);
  const a = await auPlus(p);
  assert.equal(a.etat_reel_age_s, 3, 'etat lu par une lecture partie il y a 3 s');
  await m.h.avancer(7_000);                                     // t = 10 s
  const b = await m.statut();
  assert.equal(m.r.lectures(), 1);
  assert.equal(b.etat_reel_age_s, 10, 'en cache : 10 s depuis le depart de la lecture (et non 7 s depuis son arrivee)');
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

test('worker : une lecture morte qui se regle EN RETARD ne remplace pas une lecture plus recente (H7)', { timeout: 20_000 }, async () => {
  const m = monde();
  m.r.enfiler({ type: 'sourd' });                               // A part a t = 0 et ne se regle pas
  const p = m.brut(); await m.h.avancer(4_600); await auPlus(p);
  await m.h.avancer(6_000);                                     // 10,6 s : A est morte
  m.r.poser({ type: 'ok', corps: CHAUD });
  const b = await m.statut('/api/modal-status?frais=1');        // B part a 10,6 s : warm
  assert.equal(b.mesh.etat, 'warm');
  m.r.liberer1Sourd(FROID);                                     // A se regle tard avec un etat PERIME (lu a 0 s)
  await m.h.avancer(1_000);
  const c = await m.statut();
  assert.equal(c.mesh.etat, 'warm', 'la valeur lue a 10,6 s a ete remplacee par celle lue a 0 s');
  assert.equal(c.etat_reel_age_s, 1, 'age de la lecture la plus recente');
});

test('worker : l echec tardif d une lecture morte ne met pas en pause les lectures suivantes', { timeout: 20_000 }, async () => {
  const m = monde();
  m.r.enfiler({ type: 'sourd' });
  const p = m.brut(); await m.h.avancer(4_600); await auPlus(p);
  await m.h.avancer(6_000);                                     // 10,6 s
  m.r.poser({ type: 'ok', corps: CHAUD });
  await m.statut('/api/modal-status?frais=1');                  // B : warm
  m.r.liberer1Sourd('panne', 502);                              // A echoue tard
  await m.h.avancer(5_400);                                     // 16 s : la valeur de B (5,4 s) n'est plus fraiche
  m.r.poser({ type: 'ok', corps: FROID });
  const c = await m.statut('/api/modal-status?frais=1');
  assert.equal(m.r.lectures(), 3, 'l echec de A (partie a 0 s) a bloque la lecture suivante pendant 30 s');
  assert.equal(c.mesh.etat, 'cold');
});

test('worker : une lecture morte qui se regle ne libere pas le verrou d une lecture plus recente encore en vol', { timeout: 20_000 }, async () => {
  const m = monde();
  m.r.enfiler({ type: 'sourd' }, { type: 'sourd' });           // A (t = 0) puis B (t = 10,6 s) : toutes deux sans reponse
  const p = m.brut(); await m.h.avancer(4_600); await auPlus(p);
  await m.h.avancer(6_000);
  const q = m.brut(); await m.h.avancer(4_600); await auPlus(q);   // B part a 10,6 s ; repli a 15,1 s
  assert.equal(m.r.lectures(), 2);
  m.r.liberer1Sourd(FROID);                                     // A se regle (15,1 s) : B est toujours en vol
  await m.h.avancer(1_000);
  await m.statut('/api/modal-status?frais=1');                  // 16,1 s : 5,5 s apres le depart de B
  assert.equal(m.r.lectures(), 2, 'B en vol : aucune nouvelle lecture');
});

/** Adresses de toutes les cibles de reveil (preWarmModal). */
const ENV_REVEILS = {
  MODAL_TEXT2IMAGE_URL: 'https://ex--myfabmeshpredictor-router.modal.run/text2image',
  MODAL_IMAGE_OP_URL: 'https://ex--myfabmeshbackview-router.modal.run/image_op',
  MODAL_RECTIFY_URL: 'https://ex--myfabmeshbackview-router.modal.run/rectify',
  MODAL_MESH_START_URL: 'https://ex--myfabmesh-cloud-mesh-router.modal.run/mesh_start',
  MODAL_ANYTOP_ANIM_URL: 'https://ex--myfabmesh-anim-router.modal.run/anim-start',
  MODAL_SEGMENT_URL: 'https://ex--myfabmesh-partsam-router.modal.run/segment-start',
  MODAL_FBX_RETARGET_URL: 'https://ex--myfabmesh-fbx-retarget-router.modal.run/fbx-retarget-start',
};
for (const [cible, motif] of [['text2image', /\/healthz$/], ['image_op', /backview-router.*\/warm$/], ['mesh', /\/mesh_warm$/],
  ['rectify', /backview-router.*\/healthz$/], ['rig', /rig-router.*\/warm$/], ['anim', /anim-router.*\/warm$/],
  ['segment', /partsam-router.*\/warm$/], ['fbx', /fbx-retarget-router.*\/warm$/]]) {
  test(`worker : un reveil ${cible} (preWarmModal) perime le cache : la lecture suivante est neuve`, { timeout: 20_000 }, async () => {
    const m = monde();
    await m.statut();
    await m.h.avancer(3_000);
    await m.statut();
    assert.equal(m.r.lectures(), 1, '3 s plus tard : cache');
    m.r.poser({ type: 'ok', corps: { text2image: { etat: 'starting' }, image: { etat: 'starting' }, mesh: { etat: 'starting' },
      rig: { etat: 'starting' }, anim: { etat: 'starting' }, mesh_segment: { etat: 'starting' }, fbx_retarget: { etat: 'starting' } } });
    await m.w.preWarmModal({ ...m.env, ...ENV_REVEILS }, { cible });
    assert.ok(m.r.appels.some((a) => motif.test(a.url)), 'reveil envoye');
    await m.h.avancer(2_500);                                   // la page relit 2,5 s apres le reveil
    const j = await m.statut();                                 // lecture de REPOS (60 s) : seule la peremption la rend neuve
    assert.equal(m.r.lectures(), 2, 'la lecture qui suit le reveil interroge Modal');
    assert.equal(j.mesh.etat, 'starting', 'le demarrage se voit tout de suite');
  });
}

test('worker : une lecture partie dans la seconde qui suit un reveil ne compte pas comme fraiche', { timeout: 20_000 }, async () => {
  const m = monde();
  await m.statut();                                             // t = 0
  await m.h.avancer(3_000);
  m.w._etatReelPerime();                                        // reveil a t = 3 s
  await m.h.avancer(500);
  await m.statut();                                             // 3,5 s : Modal n'a pas encore vu le reveil (froid)
  assert.equal(m.r.lectures(), 2);
  m.r.poser({ type: 'ok', corps: { ...FROID, mesh: { etat: 'starting' } } });
  await m.h.avancer(2_500);
  const j = await m.statut();                                   // 6 s
  assert.equal(m.r.lectures(), 3, 'la lecture de 3,5 s pouvait ignorer le reveil : relue');
  assert.equal(j.mesh.etat, 'starting');
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

for (const [nom, texte] of [['tableau', '[]'], ['null', 'null'], ['chaine', '"x"'], ['nombre', '42'], ['JSON invalide', '{pas du json']]) {
  test(`worker : corps ${nom} de l application d etat : aucune exception, estimation servie, compte comme un echec`, { timeout: 20_000 }, async () => {
    const m = monde();
    m.r.enfiler({ type: 'brut', texte });
    const a = await m.statut();
    assert.equal(a.mesh.reel, undefined, 'estimation');
    assert.equal(a.etat_reel_age_s, null, 'aucun etat reel annonce');
    await m.h.avancer(5_000);
    await m.statut();
    assert.equal(m.r.lectures(), 1, 'pause apres l echec');
  });
}

test('worker : sans URL de l application d etat, aucune lecture et l estimation reste servie', { timeout: 20_000 }, async () => {
  const m = monde();
  delete m.env.MODAL_ETAT_URL;
  const j = await m.statut();
  assert.equal(m.r.appels.length, 0);
  assert.equal(j.text2image.reel, undefined);
  assert.equal(j.etat_reel_age_s ?? null, null);
});

/* ─── travail en cours contre etat reel en cache (H11) ─── */
const iso = (t) => new Date(t).toISOString();

test('worker : un travail lance APRES la lecture en cache prime sur elle (warm -> busy, cold -> starting, tout le conteneur Modal)', { timeout: 20_000 }, async () => {
  let lignes = [];
  const m = monde({ actifs: () => lignes });
  m.r.poser({ type: 'ok', corps: { text2image: { etat: 'warm' }, image: { etat: 'cold' }, mesh: { etat: 'warm' } } });
  const a = await m.statut();                                   // t = 0 : lecture mise en cache
  assert.equal(a.text2image.etat, 'warm');
  await m.h.avancer(5_000);
  lignes = [{ type: 'text2image', asset_type: 'text2image', options: {}, created_at: iso(m.h.maintenant) },
            { type: 'tpose', asset_type: 'character', options: {}, created_at: iso(m.h.maintenant) }];
  await m.h.avancer(5_000);
  const b = await m.statut();                                   // t = 10 s : etat reel du cache (age 10 s)
  assert.equal(m.r.lectures(), 1, 'servi par le cache');
  assert.equal(b.text2image.busy, true, 'text2image : le travail lance a 5 s est masque par l etat en cache (warm)');
  assert.equal(b.text2image.etat, 'busy');
  assert.equal(b.text2image.warm, true);
  for (const k of ['tpose', 'image_op', 'back_view']) {
    assert.equal(b[k].etat, 'starting', `${k} : meme conteneur Modal que la rectification, froid en cache -> demarrage`);
    assert.equal(b[k].starting, true);
    assert.equal(b[k].busy, false);
  }
  assert.equal(b.mesh.etat, 'warm', 'aucun travail sur le maillage : le cache reste');
  assert.equal(b.mesh.busy, false);
});

test('worker : un travail que la lecture a deja vu laisse le dernier mot a Modal (travail bloque en processing)', { timeout: 20_000 }, async () => {
  let lignes = [];
  const m = monde({ actifs: () => lignes });
  lignes = [{ type: 'text2image', asset_type: 'text2image', options: {}, created_at: iso(m.h.maintenant - 600_000) }];
  m.r.poser({ type: 'ok', corps: { text2image: { etat: 'cold' } } });
  const a = await m.statut();                                   // travail cree il y a 10 min, Modal : froid
  assert.equal(a.text2image.etat, 'cold', 'le travail bloque ne fait pas croire a un conteneur allume');
  await m.h.avancer(30_000);
  const b = await m.statut();                                   // cache
  assert.equal(b.text2image.etat, 'cold');
  assert.equal(b.text2image.busy, false);
});

test('worker : un travail cree juste AVANT le depart de la lecture (moins de 5 s) n y est pas encore compte : il prime', { timeout: 20_000 }, async () => {
  const m = monde({ actifs: () => [{ type: 'mesh', asset_type: 'character', options: {}, created_at: iso(m.h.maintenant - 2_000) }] });
  m.r.poser({ type: 'ok', corps: { mesh: { etat: 'warm' } } });
  const a = await m.statut();
  assert.equal(a.mesh.etat, 'busy');
});

test('worker : travail en cours sans heure de creation connue : il prime (forme des lignes du relecteur, H11)', { timeout: 20_000 }, async () => {
  let actif = false;
  const m = monde({ actifs: () => (actif ? [{ asset_type: 'text2image', options: {}, type: 'text2image' }] : []) });
  m.r.poser({ type: 'ok', corps: { text2image: { etat: 'warm' } } });
  await m.statut();
  await m.h.avancer(5_000);
  actif = true;
  await m.h.avancer(5_000);
  const j = await m.statut();
  assert.equal(j.text2image.busy, true);
});

test('worker : le routeur transmet ctx (waitUntil) a /api/modal-status et a /api/admin/modal-status', { timeout: 20_000 }, async () => {
  const recu = {};
  const w = charger(['SECURITY_HEADERS', 'json', 'err', '_routeur'], {
    _envAvecReprises: (e) => e,
    _getServiceFlags: async () => ({ site_enabled: true, modal_enabled: true, stripe_enabled: true }),
    ecritureAdminDepuisAutreOrigine: () => false,
    ServiceIndisponible: class ServiceIndisponible extends Error {},
    handleModalStatus: async (req, env, opts) => { recu.site = opts; return new Response('{}'); },
    handleAdminModalStatus: async (req, env, ctx) => { recu.admin = ctx; return new Response('{}'); },
  });
  const ctx = { waitUntil() {} };
  const a = await w._routeur(new Request('https://site.test/api/modal-status'), {}, ctx);
  assert.equal(a.status, 200, 'route /api/modal-status atteinte');
  assert.equal(recu.site?.ctx, ctx, '/api/modal-status : sans ctx, la lecture coupee par le repli meurt avec la requete');
  const b = await w._routeur(new Request('https://site.test/api/admin/modal-status'), {}, ctx);
  assert.equal(b.status, 200, 'route /api/admin/modal-status atteinte');
  assert.equal(recu.admin, ctx, '/api/admin/modal-status : ctx transmis');
});

/* ═══════════════════════ 2a. PAGE DU SITE : cloud-overrides.js ═══════════════════════ */
/** Extrait _modalStatusTimer, _pollModalStatus et installModalStatusPoll (imbriques dans cloud-overrides.js) et les monte dans une fausse page.
 *  elements : ajoute la pastille, la liste et la ligne d'age du panneau « Cloud services » (sinon seul le panneau existe). */
function pageSite({ bloquer = [], masqueAuDepart = false, elements = false } = {}) {
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
  const element = (id) => ({ id, style: {}, textContent: '', innerHTML: '', title: '', ecouteurs: {},
    addEventListener(t, f) { (this.ecouteurs[t] ||= []).push(f); } });
  const dom = { 'gpu-warmup-popover': element('gpu-warmup-popover') };
  dom['gpu-warmup-popover'].style.display = 'none';
  if (elements) for (const id of ['gpu-warmup-wrap', 'gpu-warmup-list', 'gpu-warmup-text', 'gpu-warmup-age']) dom[id] = element(id);
  const document = {
    visibilityState: masqueAuDepart ? 'hidden' : 'visible', hidden: masqueAuDepart,
    getElementById: (id) => dom[id] || null,
    addEventListener: (t, f) => { (ecouteurs[t] ||= []).push(f); },
    removeEventListener() {},
  };
  const window = { dispatchEvent() {} };
  const lectures = [];
  let corps = { image_op: { warm: true }, mesh: { warm: false, etat: 'cold' } };
  const liberations = [];
  let n = 0;
  const fetch = (url) => {
    const i = n++;
    lectures.push({ url: String(url), t: h.maintenant, masque: document.visibilityState === 'hidden' });
    const c = corps;
    const rep = { ok: true, json: async () => c };
    if (bloquer.includes(i)) return new Promise((ok) => { liberations.push(() => ok(rep)); });
    return Promise.resolve(rep);
  };
  const console = { log() {}, warn() {} };
  class CustomEvent { constructor(t, o) { this.type = t; this.detail = o && o.detail; } }
  // eslint-disable-next-line no-new-func
  const f = new Function('document', 'window', 'fetch', 'setTimeout', 'clearTimeout', 'Date', 'console', 'CustomEvent',
    code + '\nreturn { installModalStatusPoll };');
  const api = f(document, window, fetch, h.setTimeout, h.clearTimeout, h.Date, console, CustomEvent);
  const panneau = dom['gpu-warmup-popover'];
  return {
    h, api, window, document, dom, popover: panneau, lectures,
    basculer(masque) {
      document.visibilityState = masque ? 'hidden' : 'visible'; document.hidden = masque;
      for (const g of (ecouteurs.visibilitychange || [])) g();
    },
    /** Survol de la pastille : index.html ouvre le panneau, puis cloud-overrides.js demande une lecture. */
    survol() { panneau.style.display = 'block'; for (const g of (dom['gpu-warmup-wrap']?.ecouteurs.mouseenter || [])) g(); },
    /** Clic sur un bouton d'outil (.tool-btn). */
    clic() { for (const g of (ecouteurs.click || [])) g({ target: { closest: (sel) => (sel === '.tool-btn' ? {} : null) } }); },
    poserCorps(c) { corps = c; },
    liberer() { for (const l of liberations.splice(0)) l(); },
  };
}
const frais = (l) => l.url === '/api/modal-status?frais=1';

test('site : AUCUNE lecture de l etat onglet masque ; au retour, relecture si la cadence est depassee', { timeout: 20_000 }, async () => {
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
  assert.equal(p.h.minuteries.size, 0, 'onglet masque : un reveil ne programme aucune minuterie');
  await p.h.avancer(5_000);
  assert.equal(p.lectures.length, 2, 'onglet masque : un reveil ne relance pas la lecture');
  p.basculer(false);
  await p.h.vider();
  assert.equal(p.lectures.length, 3, 'retour sur l onglet apres 10 min : lecture immediate');
  assert.ok(frais(p.lectures[2]), 'la lecture demandee par le reveil reste fraiche');
  await p.h.avancer(59_000);
  assert.equal(p.lectures.length, 3, 'puis cadence de repos (60 s)');
  await p.h.avancer(1_000);
  assert.equal(p.lectures.length, 4);
  assert.ok(!frais(p.lectures[3]), 'lecture de repos : pas fraiche');
});

test('site : retour rapide sur l onglet = pas de relecture avant la cadence (et jamais a moins de 15 s)', { timeout: 20_000 }, async () => {
  const p = pageSite();
  p.api.installModalStatusPoll();
  await p.h.vider();                                            // lecture 1 a t = 0
  await p.h.avancer(20_000);
  p.basculer(true);
  await p.h.avancer(5_000);
  p.basculer(false);                                            // t = 25 s : derniere lecture il y a 25 s
  await p.h.vider();
  assert.equal(p.lectures.length, 1, 'derniere lecture a 25 s : la suivante garde son heure (60 s)');
  await p.h.avancer(35_000);                                    // t = 60 s
  assert.equal(p.lectures.length, 2, 'lecture a l heure de la cadence');
  p.popover.style.display = 'block';                            // panneau ouvert : cadence de 5 s
  await p.h.avancer(60_000);                                    // la boucle passe en lecture rapide
  const n = p.lectures.length, t0 = p.lectures.at(-1).t;
  p.basculer(true);
  await p.h.avancer(9_000);
  p.basculer(false);                                            // derniere lecture il y a 9 s (< 15 s)
  await p.h.vider();
  assert.equal(p.lectures.length, n, 'moins de 15 s : pas de relecture au retour');
  await p.h.avancer(6_000);
  assert.equal(p.lectures.length, n + 1, 'relecture 15 s apres la precedente');
  assert.equal(p.lectures.at(-1).t - t0, 15_000);
});

test('site : 60 allers-retours d onglet en 10 min ne font pas plus de requetes que l ancien code (11)', { timeout: 60_000 }, async () => {
  const p = pageSite();
  p.api.installModalStatusPoll();
  await p.h.vider();
  for (let i = 0; i < 60; i++) { p.basculer(true); await p.h.avancer(5_000); p.basculer(false); await p.h.avancer(5_000); }
  assert.ok(p.lectures.length <= 11, `${p.lectures.length} requetes au worker en 10 min (ancien code : 11)`);
  assert.equal(p.lectures.filter((l) => l.masque).length, 0, 'aucune onglet masque');
});

test('site : apres un reveil, UNE lecture fraiche puis la cadence de repos (pas de rafale de 5 s pendant 30 s)', { timeout: 20_000 }, async () => {
  const p = pageSite();
  p.api.installModalStatusPoll();
  await p.h.vider();
  assert.equal(p.lectures[0].url, '/api/modal-status', 'au repos : pas de lecture fraiche');
  await p.h.avancer(10_000);
  p.window.__sonderEtatModal();                                 // apres un reveil (prewarmGpu) : 2,5 s
  await p.h.avancer(2_500);
  assert.equal(p.lectures.length, 2);
  assert.ok(frais(p.lectures[1]), 'apres un reveil : lecture fraiche');
  await p.h.avancer(59_000);
  assert.equal(p.lectures.length, 2, 'ensuite, rien avant la cadence de repos (la fenetre active de 30 s faisait 6 lectures de plus)');
  await p.h.avancer(1_000);
  assert.equal(p.lectures.length, 3);
  assert.ok(!frais(p.lectures[2]), 'lecture de repos');
});

test('site : panneau ouvert ou service qui demarre = ?frais=1 toutes les 5 s ; ferme = retour au repos', { timeout: 20_000 }, async () => {
  const p = pageSite();
  p.api.installModalStatusPoll();
  await p.h.vider();
  p.popover.style.display = 'block';
  await p.h.avancer(60_000);
  assert.ok(frais(p.lectures.at(-1)), 'panneau ouvert : lecture fraiche');
  const n = p.lectures.length;
  await p.h.avancer(5_000);
  assert.equal(p.lectures.length, n + 1, 'panneau ouvert : toutes les 5 s');
  assert.ok(frais(p.lectures.at(-1)));
  p.popover.style.display = 'none';
  p.window.__modalServicesDemarrage = 1;                        // un service demarre
  await p.h.avancer(5_000);
  assert.ok(frais(p.lectures.at(-1)), 'service qui demarre : lecture fraiche');
  p.window.__modalServicesDemarrage = 0;
  await p.h.avancer(5_000);
  const m = p.lectures.length;
  await p.h.avancer(59_000);
  assert.equal(p.lectures.length, m, 'au repos : 60 s');
  await p.h.avancer(1_000);
  assert.ok(!frais(p.lectures.at(-1)), 'panneau ferme : retour au repos');
});

test('site : un clic d outil = UNE lecture fraiche par la boucle (aucune si l etat a moins de 15 s)', { timeout: 20_000 }, async () => {
  const p = pageSite();
  p.api.installModalStatusPoll();
  await p.h.vider();                                            // lecture 1 a t = 0
  await p.h.avancer(10_000);
  p.clic();
  await p.h.vider();
  assert.equal(p.lectures.length, 1, 'etat lu il y a 10 s : le clic ne relit pas');
  await p.h.avancer(20_000);                                    // t = 30 s
  p.clic();
  await p.h.avancer(0);
  assert.equal(p.lectures.length, 2, 'etat de 30 s : une lecture');
  assert.ok(frais(p.lectures[1]), 'lecture fraiche');
  assert.equal(p.h.minuteries.size, 1, 'une seule boucle (le clic ne lance pas une lecture a cote)');
  await p.h.avancer(59_000);
  assert.equal(p.lectures.length, 2, 'la lecture du clic remplace la lecture periodique suivante');
  await p.h.avancer(1_000);
  assert.equal(p.lectures.length, 3);
});

test('site : une seule boucle de lecture, meme si __sonderEtatModal arrive pendant une lecture', { timeout: 20_000 }, async () => {
  const p = pageSite({ bloquer: [0] });
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

test('site : une lecture demandee PENDANT une lecture n est pas perdue (relue des la fin, fraiche)', { timeout: 20_000 }, async () => {
  const p = pageSite({ bloquer: [0] });
  p.api.installModalStatusPoll();
  await p.h.vider();
  p.window.__sonderEtatModal(0);
  await p.h.avancer(500);
  assert.equal(p.lectures.length, 1, 'une seule lecture a la fois');
  p.liberer();
  await p.h.avancer(0);
  assert.equal(p.lectures.length, 2, 'la lecture demandee est faite des la fin de la precedente');
  assert.ok(frais(p.lectures[1]));
});

test('site : onglet masque PENDANT une lecture : aucune lecture ni minuterie ensuite ; une lecture au retour', { timeout: 20_000 }, async () => {
  const p = pageSite({ bloquer: [0] });
  p.api.installModalStatusPoll();
  await p.h.vider();
  p.basculer(true);
  p.liberer();
  await p.h.avancer(0);
  assert.equal(p.h.minuteries.size, 0, 'la lecture finie onglet masque ne programme pas la suivante');
  await p.h.avancer(10 * 60_000);
  assert.equal(p.lectures.filter((l) => l.masque).length, 0, 'lectures onglet masque');
  assert.equal(p.h.minuteries.size, 0, 'minuterie active onglet masque');
  p.basculer(false);
  await p.h.vider();
  assert.equal(p.lectures.length, 2, 'une lecture au retour');
});

test('site : page chargee en arriere-plan (masquee des le debut) : aucune lecture avant d etre visible', { timeout: 20_000 }, async () => {
  const p = pageSite({ masqueAuDepart: true });
  p.api.installModalStatusPoll();
  await p.h.avancer(10 * 60_000);
  assert.equal(p.lectures.length, 0);
  p.basculer(false);
  await p.h.vider();
  assert.equal(p.lectures.length, 1);
});

test('site : la date de l etat est celle de la LECTURE Modal ; au-dela de 30 s, le panneau affiche son age', { timeout: 20_000 }, async () => {
  const p = pageSite({ elements: true });
  p.poserCorps({ image_op: { warm: true, reel: true, etat: 'warm' }, mesh: { warm: false, etat: 'cold', reel: true }, etat_reel_age_s: 75 });
  p.api.installModalStatusPoll();
  await p.h.vider();
  assert.equal(p.window.__modalEtatDate, p.h.maintenant - 75_000, 'etat lu il y a 75 s, pas maintenant');
  const age = p.dom['gpu-warmup-age'];
  assert.equal(age.style.display, 'block', 'repli de 75 s : age affiche');
  assert.match(age.textContent, /75 s/);
  await p.h.avancer(1_000);
  p.survol();                                                   // ouverture du panneau 1 s apres la reponse
  assert.equal(p.dom['gpu-warmup-list'].style.opacity, '0.45', 'etat de 76 s : grise le temps de la relecture');
  p.poserCorps({ image_op: { warm: true, reel: true, etat: 'warm' }, mesh: { warm: false, etat: 'cold', reel: true }, etat_reel_age_s: 2 });
  await p.h.avancer(0);
  assert.equal(p.lectures.length, 2);
  assert.ok(frais(p.lectures.at(-1)), 'le survol relit en frais');
  assert.equal(p.window.__modalEtatDate, p.h.maintenant - 2_000);
  assert.equal(age.style.display, 'none', 'etat de 2 s : pas de mention d age');
  assert.equal(p.dom['gpu-warmup-list'].style.opacity, '', 'liste lisible');
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

test('admin2 : etat des conteneurs sonde onglet visible, sur Maintenant / Sante, un appel a la fois, jamais deux a moins de 7 s', async () => {
  const { src, ast } = scriptAdmin2();
  const s = fonction(ast, 'sonderModalStatus'), sur = fonction(ast, 'sur');
  assert.ok(s, 'sonderModalStatus absent : la sonde de modal-status n est pas factorisee (retour sur l onglet impossible)');
  const S = { tab: 'systeme', msEnCours: 0 };
  const document = { hidden: false };
  let t = Date.UTC(2026, 9, 14, 12, 0, 0);
  const D = { now: () => t };
  let appels = 0, finir = null;
  const chargerModalStatus = () => { appels++; return new Promise((ok) => { finir = ok; }); };
  // eslint-disable-next-line no-new-func
  const sonder = new Function('document', 'S', 'chargerModalStatus', 'Date', src.slice(sur.start, sur.end) + '\n' + src.slice(s.start, s.end) + '\nreturn sonderModalStatus;')(
    document, S, chargerModalStatus, D);
  sonder();
  assert.equal(appels, 1, 'Sante, onglet visible : lecture');
  sonder();
  assert.equal(appels, 1, 'lecture precedente pas revenue : pas de second appel');
  finir();
  await new Promise((r) => setImmediate(r));
  assert.equal(S.msEnCours, 0, 'garde levee au retour de la lecture');
  t += 3_000; sonder();
  assert.equal(appels, 1, '3 s apres la precedente : rien (des allers-retours d onglet ne relisent pas plus vite que la cadence)');
  t += 5_000; sonder();
  assert.equal(appels, 2, 'cadence de 8 s : lecture');
  finir(); await new Promise((r) => setImmediate(r));
  t += 8_000; document.hidden = true; sonder();
  assert.equal(appels, 2, 'onglet masque : aucun appel');
  document.hidden = false; S.tab = 'argent'; sonder();
  assert.equal(appels, 2, 'autre onglet de l admin : aucun appel');
  S.tab = 'maintenant'; sonder(15_000);
  assert.equal(appels, 2, 'retour sur l onglet : derniere lecture il y a 8 s (< 15 s), pas de relecture');
  t += 7_000; sonder(15_000);
  assert.equal(appels, 3, 'retour sur l onglet : derniere lecture il y a 15 s, relecture');
});

test('admin2 : retour sur l onglet = relecture si la derniere a plus de 15 s ; aucun setInterval direct sur modal-status', () => {
  const { src, ast } = scriptAdmin2();
  const ecoute = trouver(ast, (n) => n.type === 'CallExpression' && n.callee && n.callee.type === 'MemberExpression'
    && n.callee.object && n.callee.object.name === 'document' && n.callee.property && n.callee.property.name === 'addEventListener'
    && n.arguments[0] && n.arguments[0].value === 'visibilitychange' && /chargerLive/.test(src.slice(n.start, n.end)));
  assert.ok(ecoute, 'ecouteur visibilitychange de /admin2 introuvable');
  const fn = ecoute.arguments[1];
  const appels = [];
  const noter = (nom) => (...a) => { appels.push([nom, ...a]); };
  const document = { hidden: false };
  // eslint-disable-next-line no-new-func
  const f = new Function('document', 'chargerLive', 'chargerServices', 'chargerBadges', 'maintenirSession', 'sonderModalStatus', 'chargerModalStatus',
    'return (' + src.slice(fn.start, fn.end) + ');')(document, noter('live'), noter('services'), noter('badges'), noter('session'), noter('sonder'), noter('charger'));
  f();
  const sonde = appels.find((a) => a[0] === 'sonder');
  assert.ok(sonde, 'retour sur l onglet : l etat des conteneurs n est pas relu');
  assert.equal(sonde[1], 15_000, 'retour sur l onglet : relecture seulement si la derniere a plus de 15 s');
  assert.ok(!appels.some((a) => a[0] === 'charger'), 'jamais de lecture directe (sans les gardes de sonderModalStatus)');
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
  assert.equal(ageReel({ etat_reel_age_s: 12 }), '', 'cache normal : rien');
  assert.equal(ageReel({}), '', 'ancien worker sans age : rien');
  assert.match(ageReel({ etat_reel_age_s: 75 }), /\(75 s\)/, 'repli : age affiche');
  assert.equal((src.match(/e\.reel \? ageReel\(m\)/g) || []).length, 2, 'cartes Conteneurs (Maintenant) et garde au chaud (Sante)');
});
