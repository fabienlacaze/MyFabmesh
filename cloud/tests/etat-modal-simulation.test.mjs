// Levier L8 (etude des couts du 11/10/2026), relecture du 14/10 : SIMULATION D'UNE HEURE avec le VRAI code de la page du site
// (installModalStatusPoll de cloud-overrides.js), de /admin2 (sonderModalStatus) et du worker (handleModalStatus / handleAdminModalStatus et
// leur cache), devant un modele du conteneur Modal de myfabmesh-etat (fenetre de maintien W lue dans etat_services.py, demarrage a froid
// 3,1 s, lecture a chaud 0,4 s). Horloge simulee, aucun reseau.
// Mesures par scenario : requetes au worker, lectures de l'application d'etat, demarrages a froid, part du temps ou son conteneur est
// ALLUME (= facture), et age de l'etat AFFICHE (depuis la lecture Modal qui l'a produit ; onglet visible seulement).
// EXIGENCE : a usage egal, requetes, lectures et temps allume <= ancien code (f86208c0), et l'etat affiche pas plus vieux la ou l'on
// regarde (panneau ouvert, /admin2). Les references ci-dessous ont ete mesurees sur f86208c0 par CE fichier, a la meme fenetre (20 s) :
//   git show f86208c0:cloud/src/worker.ts > <tmp>/worker.ts ; git show f86208c0:cloud/public/app/cloud-overrides.js > <tmp>/co.js ;
//   git show f86208c0:cloud/public/admin2.html > <tmp>/admin2.html ;
//   SIM_FENETRE_S=20 WORKER_SRC=<tmp>/worker.ts WEB_OVERRIDES=<tmp>/co.js ADMIN2_HTML=<tmp>/admin2.html node --test tests/etat-modal-simulation.test.mjs
// Lancer : cd cloud && node --test tests/etat-modal-simulation.test.mjs   (~10 s)
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
  py: chemin('ETAT_SERVICES_PY', '../../modal_app/etat_services.py'),
};
const FENETRE_S = Number(process.env.SIM_FENETRE_S) || Number((/scaledown_window\s*=\s*(\d+)/.exec(
  (/@app\.function\(([\s\S]*?)\)\s*\n@modal\.concurrent[^\n]*\n@modal\.fastapi_endpoint[^\n]*\ndef etat_services\(/.exec(lire(FICHIERS.py)) || [])[1] || '') || [])[1]);
// Sur un autre exemplaire (WORKER_SRC) : on mesure sans rien exiger, sauf SIM_EXIGER=1 (prouver que les exigences echouent sur un code fautif).
const MESURE_REFERENCE = !!process.env.WORKER_SRC && !process.env.SIM_EXIGER;

/* ───────── horloge simulee ───────── */
function horloge() {
  let maintenant = Date.UTC(2026, 9, 14, 8, 0, 0); const t0 = maintenant; let seq = 0;
  const minuteries = new Map();
  class FauxDate extends Date { constructor(...a) { if (a.length) super(...a); else super(maintenant); } static now() { return maintenant; } }
  const poser = (f, ms) => { const id = ++seq; minuteries.set(id, { f, a: maintenant + Math.max(0, Number(ms) || 0) }); return id; };
  const retirer = (id) => { minuteries.delete(id); };
  const FauxAbortSignal = { timeout(ms) { const ac = new AbortController(); poser(() => ac.abort(new Error('TimeoutError')), ms); return ac.signal; } };
  const vider = async () => { for (let i = 0; i < 15; i++) await new Promise((r) => setImmediate(r)); };
  const avancer = async (ms) => {
    const fin = maintenant + ms;
    for (;;) {
      await vider();
      let suivant = null;
      for (const [id, m] of minuteries) if (m.a <= fin && (!suivant || m.a < suivant[1].a)) suivant = [id, m];
      if (!suivant) break;
      minuteries.delete(suivant[0]); maintenant = suivant[1].a; suivant[1].f();
    }
    maintenant = fin; await vider();
  };
  const dormir = (ms) => new Promise((ok) => poser(ok, ms));
  return { Date: FauxDate, setTimeout: poser, clearTimeout: retirer, AbortSignal: FauxAbortSignal, avancer, vider, dormir,
    get t() { return maintenant - t0; } };
}

/** Conteneur Modal de etat_services : fenetre de maintien W (s) ; facture de l'allumage a la fin de la fenetre d'inactivite. */
function conteneur(h, W, { froid = 3_100, chaud = 400 } = {}) {
  let finInactif = -Infinity, allumeDepuis = null, enCours = 0, total = 0, froids = 0, lectures = 0;
  const majArret = () => { if (allumeDepuis != null && enCours === 0 && h.t >= finInactif) { total += finInactif - allumeDepuis; allumeDepuis = null; } };
  return {
    async servir() {
      majArret(); lectures++;
      let lat = chaud;
      if (allumeDepuis == null) { allumeDepuis = h.t; froids++; lat = froid; }
      enCours++;
      await h.dormir(lat);
      enCours--; finInactif = h.t + W * 1000;
    },
    bilan(duree) { majArret(); const t = total + (allumeDepuis != null ? Math.min(h.t, finInactif) - allumeDepuis : 0); return { lectures, froids, allume: t / duree }; },
  };
}

const URL_ETAT = 'https://ex--myfabmesh-etat-etat-services.modal.run';
const NOMS = ['SECURITY_HEADERS', 'json', 'err', 'COLD_THRESHOLD_MS', 'KEEP_WARM_HEURES', 'ETAT_FRAIS_VISITEUR_MS', 'ETAT_FRAIS_ACTIF_MS', 'ETAT_FRAIS_ADMIN_MS',
  'ETAT_VISIBILITE_MS', 'ETAT_INTERVALLE_MIN_MS', 'ETAT_ATTENTE_MS', 'ETAT_DELAI_MAX_MS', 'ETAT_PAUSE_ECHEC_MS', 'ETAT_REPLI_MAX_MS', '_etatReel',
  '_etatServicesUrl', '_lireEtatServices', '_etatReelPerime', '_etatReelModal', '_avecDelai', 'handleModalStatus', 'handleAdminModalStatus'];

/** Une instance du worker. Rend appeler(chemin, admin) -> { j, ageMs } : ageMs = age de l'etat reel rendu, depuis le DEPART de la lecture
 *  Modal qui l'a produit (ancien worker, sans cache : la lecture faite pendant la requete). */
function isolat(h, C) {
  const lent = (v) => new Promise((ok) => h.setTimeout(() => ok(v), 120));            // Supabase / R2 : 120 ms
  const q = { select: () => q, eq: () => q, gte: () => q, in: () => q, order: () => q, limit: () => q,
    then: (ok, ko) => lent({ data: [], error: null }).then(ok, ko) };
  let departLecture = null;
  const fetch = async (url, init) => {
    if (String(url) !== URL_ETAT) return new Response('{}');
    departLecture = h.t;
    await C.servir();
    if (init?.signal?.aborted) throw new Error('abort');
    return new Response(JSON.stringify({ text2image: { etat: 'cold' }, image: { etat: 'warm' }, mesh: { etat: 'cold' } }), { status: 200 });
  };
  const w = chargerFonctions(NOMS.filter((n) => existe(n)), {
    Date: h.Date, setTimeout: h.setTimeout, clearTimeout: h.clearTimeout, AbortSignal: h.AbortSignal, fetch,
    getSessionUser: async () => ({ id: 'u' }), supabaseAdmin: () => ({ from: () => q }), _readLastWarmMs: async () => null,
    _requireAdmin: async () => ({}), _keepWarmLire: async () => ({}),
  });
  const env = { MODAL_ETAT_URL: URL_ETAT, MODAL_SHARED_SECRET: 's' };
  const ctx = { waitUntil() {} };
  let requetes = 0;
  const appeler = async (chemin, admin = false) => {
    requetes++;
    await h.dormir(40);                                   // reseau navigateur -> worker
    departLecture = null;
    const rq = new Request('https://site.test' + chemin);
    const rep = admin ? await w.handleAdminModalStatus(rq, env, ctx) : await w.handleModalStatus(rq, env, { ctx });
    const j = JSON.parse(await rep.text());
    const ageMs = typeof j.etat_reel_age_s === 'number' ? j.etat_reel_age_s * 1000 : departLecture != null ? h.t - departLecture : null;
    await h.dormir(40);
    return { j, ageMs: ageMs == null ? null : ageMs + 40 };
  };
  return { appeler, get requetes() { return requetes; } };
}

/** Age de l'etat affiche, echantillonne chaque seconde onglet visible : derniere reponse recue + son age. */
function suiviAge(h, visible) {
  let recu = null; const ages = [];
  h.setTimeout(function tic() { if (recu && visible()) ages.push(h.t - recu.t + recu.ageMs); h.setTimeout(tic, 1_000); }, 1_000);
  return {
    noter(ageMs) { if (ageMs != null) recu = { t: h.t, ageMs }; },
    bilan() { return ages.length ? { ageMax: Math.max(...ages) / 1000, ageMoy: ages.reduce((a, b) => a + b, 0) / ages.length / 1000 } : { ageMax: 0, ageMoy: 0 }; },
  };
}

/** Le VRAI code de la page du site (installModalStatusPoll et ses dependances), monte dans une fausse page. */
function page(h, I, { masque = false, panneauOuvert = false } = {}) {
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
  const code = [...voulus.values()].sort((a, b) => a.start - b.start).map((n) => src.slice(n.start, n.end)).join('\n');
  const popover = { style: { display: panneauOuvert ? 'block' : 'none' } };
  const ecouteurs = {};
  const document = { visibilityState: masque ? 'hidden' : 'visible', hidden: masque,
    getElementById: (id) => (id === 'gpu-warmup-popover' ? popover : null), addEventListener: (t, f) => { (ecouteurs[t] ||= []).push(f); } };
  const window = { dispatchEvent() {} };
  const age = suiviAge(h, () => document.visibilityState !== 'hidden');
  const fetch = async (url) => { const { j, ageMs } = await I.appeler(String(url)); age.noter(ageMs); return { ok: true, json: async () => j }; };
  // eslint-disable-next-line no-new-func
  const f = new Function('document', 'window', 'fetch', 'setTimeout', 'clearTimeout', 'Date', 'console', 'CustomEvent', code + '\nreturn { installModalStatusPoll };');
  f(document, window, fetch, h.setTimeout, h.clearTimeout, h.Date, { log() {} }, class {}).installModalStatusPoll();
  return {
    window, age,
    clic() { for (const g of ecouteurs.click || []) g({ target: { closest: (s) => (s === '.tool-btn' ? {} : null) } }); },
    basculer(m) { document.visibilityState = m ? 'hidden' : 'visible'; document.hidden = m; for (const g of ecouteurs.visibilitychange || []) g(); },
  };
}

/** /admin2 sur Sante : le VRAI sonderModalStatus sous cadence(…, 8000) ; ancien code (sans sonderModalStatus) : un appel a la fois. */
function admin(h, I) {
  const html = lire(FICHIERS.admin2);
  const src = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((b) => b.includes('function cadence('));
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true });
  const fonctions = {};
  const visiter = (n) => {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'FunctionDeclaration' && n.id && ['sur', 'sonderModalStatus'].includes(n.id.name)) fonctions[n.id.name] = n;
    for (const k of Object.keys(n)) { const v = n[k]; if (Array.isArray(v)) v.forEach(visiter); else if (v && typeof v.type === 'string') visiter(v); }
  };
  visiter(ast);
  const age = suiviAge(h, () => true);
  const S = { tab: 'systeme', msEnCours: 0 };
  const charger = () => I.appeler('/api/admin/modal-status', true).then(({ ageMs }) => { age.noter(ageMs); });
  let sonder;
  if (fonctions.sonderModalStatus) {
    // eslint-disable-next-line no-new-func
    sonder = new Function('document', 'S', 'chargerModalStatus', 'Date', src.slice(fonctions.sur.start, fonctions.sur.end) + '\n'
      + src.slice(fonctions.sonderModalStatus.start, fonctions.sonderModalStatus.end) + '\nreturn sonderModalStatus;')({ hidden: false }, S, charger, h.Date);
  } else {
    sonder = () => { if (!S.msEnCours) { S.msEnCours = 1; charger().finally(() => { S.msEnCours = 0; }); } };
  }
  h.setTimeout(function tic() { sonder(); h.setTimeout(tic, 8_000); }, 8_000);
  return { age };
}

const HEURE = 3_600_000;
const resultats = new Map();
async function scenario(nom, monter) {
  const h = horloge(); const C = conteneur(h, FENETRE_S);
  const isolats = [];
  const nouvelIsolat = () => { const I = isolat(h, C); isolats.push(I); return I; };
  const vues = monter(h, nouvelIsolat);
  await h.avancer(HEURE);
  const b = C.bilan(HEURE);
  const ages = (Array.isArray(vues) ? vues : [vues]).map((v) => v.age.bilan());
  const r = { requetes: isolats.reduce((s, I) => s + I.requetes, 0), ...b,
    ageMax: Math.max(...ages.map((a) => a.ageMax)), ageMoy: Math.max(...ages.map((a) => a.ageMoy)) };
  resultats.set(nom, r);
  console.log(`[SIM] ${nom.padEnd(44)} W=${FENETRE_S} s : requetes ${String(r.requetes).padStart(4)}/h, lectures Modal ${String(r.lectures).padStart(4)}/h, `
    + `demarrages a froid ${String(r.froids).padStart(3)}/h, allume ${(r.allume * 100).toFixed(1).padStart(5)} %, `
    + `etat affiche : ${r.ageMoy.toFixed(1)} s en moyenne, ${r.ageMax.toFixed(1)} s au plus`);
  return r;
}

/* REFERENCES : f86208c0 (avant le levier), mesurees par ce fichier le 14/10/2026 a W = 20 s (voir l'en-tete) ; allume en %, age en s.
 * Pour memoire, la branche du 13/10 (a0a3992b, fenetre « active » de 30 s) : clic / 2 min = 210 requetes, 90 lectures, 52,1 % ; panneau
 * ouvert = etat affiche jusqu'a 19 s ; /admin2 = jusqu'a 15,7 s ; allers-retours d'onglet = 361 requetes. */
const REFERENCE = {
  'visiteur visible au repos':                  { requetes: 57, lectures: 57, allume: 36.6, ageMax: 66.6 },
  'visiteur onglet masque':                     { requetes: 57, lectures: 57, allume: 36.6, ageMax: 0 },
  'visiteur, panneau Cloud services ouvert':    { requetes: 629, lectures: 629, allume: 100.0, ageMax: 8.7 },
  '/admin2 sur Sante':                          { requetes: 450, lectures: 449, allume: 99.8, ageMax: 7.7 },
  'visiteur, clic d outil toutes les 2 min':    { requetes: 88, lectures: 88, allume: 47.1, ageMax: 66.5 },
  'visiteur, survol / reveil toutes les 2 min': { requetes: 61, lectures: 61, allume: 39.1, ageMax: 65.7 },
  'visiteur, aller-retour d onglet / 10 s':     { requetes: 57, lectures: 57, allume: 36.6, ageMax: 66.6 },
  // Deux visiteurs : le second est servi par le cache, donc ~3 s plus vite ; sa cadence de 60 s se comptant depuis la REPONSE (comme
  // avant), il fait ~2 requetes de plus par heure (116 contre 114) pour la MEME cadence. Tolerance de 2 % sur les requetes, et
  // seulement ici. Son etat peut avoir ~2 min (cache 60 s + cadence 60 s) : le panneau l'affiche au-dela de 30 s, et un survol relit en frais.
  'deux visiteurs sur la meme instance':        { requetes: 114, lectures: 114, allume: 73.0, ageMax: 66.6, toleranceRequetes: 0.02 },
};
/** Scenarios ou l'on REGARDE l'etat : il ne doit pas y etre plus vieux qu'avant (tolerance : 1 s d'arrondi). */
const REGARDES = new Set(['visiteur, panneau Cloud services ouvert', '/admin2 sur Sante']);

function exiger(nom) {
  if (MESURE_REFERENCE) return;
  const r = resultats.get(nom), ref = REFERENCE[nom];
  const maxRequetes = Math.floor(ref.requetes * (1 + (ref.toleranceRequetes || 0)));
  assert.ok(r.requetes <= maxRequetes, `${nom} : ${r.requetes} requetes au worker par heure, ancien code ${ref.requetes}`);
  assert.ok(r.lectures <= ref.lectures, `${nom} : ${r.lectures} lectures Modal par heure, ancien code ${ref.lectures}`);
  assert.ok(r.allume * 100 <= ref.allume + 0.05, `${nom} : conteneur allume ${(r.allume * 100).toFixed(1)} %, ancien code ${ref.allume} %`);
  if (REGARDES.has(nom)) assert.ok(r.ageMax <= ref.ageMax + 1, `${nom} : etat affiche jusqu a ${r.ageMax.toFixed(1)} s, ancien code ${ref.ageMax} s`);
}

test('simulation 1 h : la fenetre de maintien est lue dans etat_services.py', () => {
  assert.ok(FENETRE_S > 0, 'scaledown_window introuvable');
});

const SCENARIOS = [
  ['visiteur visible au repos', (h, I) => page(h, I())],
  ['visiteur onglet masque', (h, I) => page(h, I(), { masque: true })],
  ['visiteur, panneau Cloud services ouvert', (h, I) => page(h, I(), { panneauOuvert: true })],
  ['/admin2 sur Sante', (h, I) => admin(h, I())],
  ['visiteur, clic d outil toutes les 2 min', (h, I) => {
    const P = page(h, I());
    h.setTimeout(function clic() { P.clic(); h.setTimeout(clic, 120_000); }, 30_000);
    return P;
  }],
  ['visiteur, survol / reveil toutes les 2 min', (h, I) => {   // le scenario de la relecture du 13/10 (__sonderEtatModal(0))
    const P = page(h, I());
    h.setTimeout(function sonde() { P.window.__sonderEtatModal(0); h.setTimeout(sonde, 120_000); }, 30_000);
    return P;
  }],
  ['visiteur, aller-retour d onglet / 10 s', (h, I) => {
    const P = page(h, I());
    let masque = false;
    h.setTimeout(function bascule() { masque = !masque; P.basculer(masque); h.setTimeout(bascule, 5_000); }, 5_000);
    return P;
  }],
  ['deux visiteurs sur la meme instance', (h, I) => {
    const inst = I();
    const A = page(h, inst);
    let B = null;
    h.setTimeout(() => { B = page(h, inst); }, 30_000);
    return [A, { age: { bilan: () => (B ? B.age.bilan() : { ageMax: 0, ageMoy: 0 }) } }];
  }],
];
for (const [nom, monter] of SCENARIOS) {
  test(`simulation 1 h : ${nom}`, { timeout: 120_000 }, async () => {
    await scenario(nom, monter);
    exiger(nom);
  });
}
