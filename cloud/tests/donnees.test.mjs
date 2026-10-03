// Tests de la voie « worker-donnees » (analyse du 03/10/2026) : effacement et export du compte (D-01, D-06), retention (D-05, D-07, _trash),
// sauvegarde nocturne (EXP-01, EXP-02, FIN-06), alerte de message (EXP-08), table des paliers (texture Fast), route /api/health (EXP-04),
// pagination du tableau de bord (PB-04). Charge les VRAIES fonctions depuis src/worker.ts (transpilees) et les rejoue contre un faux R2 et un
// faux Supabase en memoire. Aucun reseau.
// Lancer : cd cloud && node --test tests/donnees.test.mjs
// Pour verifier qu'ils echouent sur l'ancien code : WORKER_SRC=<copie de l'ancien worker.ts> node --test tests/donnees.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');

const chemin = process.env.WORKER_SRC || new URL('../src/worker.ts', import.meta.url);
const SRC = readFileSync(chemin, 'utf8').replace(/\r\n/g, '\n');
const ANCIEN = !!process.env.WORKER_SRC;

/* ---------- extraction ---------- */
export function transpiler(texte) {
  return ts.transpileModule(texte, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
}
/** Texte d'une fonction ou constante de premier niveau, par son en-tete exact (jusqu'a la premiere accolade fermante en colonne 0). */
function fonction(entete) {
  const a = SRC.indexOf(entete);
  assert.ok(a >= 0, 'introuvable dans worker.ts : ' + entete);
  const fin = SRC.indexOf('\n}\n', a);
  assert.ok(fin > a, 'fin introuvable : ' + entete);
  return SRC.slice(a, fin + 3);
}
function constante(entete) {   // const X = ...;  (une seule instruction, terminee par « ;\n » en colonne 0 ou fin de ligne)
  const a = SRC.indexOf(entete);
  assert.ok(a >= 0, 'introuvable dans worker.ts : ' + entete);
  const fin = SRC.indexOf(';\n', a);
  return SRC.slice(a, fin + 2);
}
function entre(debut, fin) {
  const a = SRC.indexOf(debut);
  const b = SRC.indexOf(fin, a + 1);
  assert.ok(a >= 0 && b > a, 'ancres introuvables : ' + debut + ' .. ' + fin);
  return SRC.slice(a, b);
}
export function charger(texte, noms, retour) {
  const js = transpiler(texte);
  return new Function(...Object.keys(noms), js + '; return {' + retour.join(',') + '};')(...Object.values(noms));
}

/* ---------- faux R2 en memoire ---------- */
export function fauxR2(initial = {}) {
  const objets = new Map();
  let etag = 1;
  const poser = (k, v, uploaded = new Date()) => objets.set(k, { corps: typeof v === 'string' ? v : JSON.stringify(v), uploaded, etag: String(etag++) });
  for (const [k, v] of Object.entries(initial)) poser(k, v);
  const enveloppe = (k, o) => ({
    key: k, size: o.corps.length, uploaded: o.uploaded, etag: o.etag,
    text: async () => o.corps, json: async () => JSON.parse(o.corps),
    arrayBuffer: async () => new TextEncoder().encode(o.corps).buffer,
  });
  const journal = { suppressions: [], lectures: 0, listes: 0 };
  const bucket = {
    objets, poser, journal,
    async get(k) { journal.lectures++; const o = objets.get(k); return o ? enveloppe(k, o) : null; },
    async head(k) { const o = objets.get(k); return o ? enveloppe(k, o) : null; },
    async put(k, v, opt) {
      const ex = objets.get(k);
      if (opt?.onlyIf?.etagMatches && (!ex || ex.etag !== opt.onlyIf.etagMatches)) return null;
      if (opt?.onlyIf?.etagDoesNotMatch === '*' && ex) return null;
      poser(k, typeof v === 'string' ? v : v instanceof ArrayBuffer ? new TextDecoder().decode(v) : v instanceof Uint8Array ? new TextDecoder().decode(v) : String(v));
      return enveloppe(k, objets.get(k));
    },
    async delete(cles) {
      for (const k of Array.isArray(cles) ? cles : [cles]) { objets.delete(k); journal.suppressions.push(k); }
    },
    async list({ prefix = '', cursor, limit = 1000, delimiter } = {}) {
      journal.listes++;
      const toutes = [...objets.keys()].filter((k) => k.startsWith(prefix)).sort();
      const dossiers = new Set();
      const feuilles = [];
      for (const k of toutes) {
        if (delimiter) {
          const reste = k.slice(prefix.length);
          const i = reste.indexOf(delimiter);
          if (i >= 0) { dossiers.add(prefix + reste.slice(0, i + 1)); continue; }
        }
        feuilles.push(k);
      }
      const debut = cursor ? Number(cursor) : 0;
      const page = feuilles.slice(debut, debut + limit);
      const suite = debut + limit < feuilles.length;
      return {
        objects: page.map((k) => enveloppe(k, objets.get(k))),
        truncated: suite, cursor: suite ? String(debut + limit) : undefined,
        delimitedPrefixes: [...dossiers],
      };
    },
  };
  return bucket;
}

/* ---------- faux Supabase en memoire ---------- */
export function fauxSupabase(tables) {
  const requetes = [];
  function builder(nom) {
    const st = { op: 'select', filtres: [], tri: null, plage: null, patch: null, renvoyer: false };
    const executer = async () => {
      requetes.push({ nom, op: st.op, plage: st.plage });
      if (st.erreur) return { data: null, error: { message: st.erreur } };
      const t = tables[nom] || (tables[nom] = []);
      let cibles = t.filter((l) => st.filtres.every((f) => f(l)));
      if (st.op === 'delete') { tables[nom] = t.filter((l) => !cibles.includes(l)); return { data: null, error: null, count: cibles.length }; }
      if (st.op === 'update') { for (const l of cibles) Object.assign(l, st.patch); return { data: st.renvoyer ? cibles.map((l) => ({ ...l })) : null, error: null }; }
      if (st.tri) cibles = [...cibles].sort((a, b) => String(a[st.tri]).localeCompare(String(b[st.tri])));
      if (st.plage) cibles = cibles.slice(st.plage[0], st.plage[1] + 1);
      if (st.limite != null) cibles = cibles.slice(0, st.limite);
      return { data: cibles.map((l) => ({ ...l })), error: null };
    };
    const api = {
      select(_c, opt) { if (st.op === 'update') st.renvoyer = true; if (opt?.head) st.tete = true; return api; },
      delete() { st.op = 'delete'; return api; },
      update(p) { st.op = 'update'; st.patch = p; return api; },
      eq(c, v) { st.filtres.push((l) => l[c] === v); return api; },
      neq(c, v) { st.filtres.push((l) => l[c] !== v); return api; },
      in(c, vs) { st.filtres.push((l) => vs.includes(l[c])); return api; },
      not(c, op, v) { st.filtres.push((l) => !(op === 'is' && v === null ? l[c] == null : false)); return api; },
      order(c) { st.tri = c; return api; },
      limit(n) { st.limite = n; return api; },
      range(a, b) { st.plage = [a, b]; return api; },
      async maybeSingle() { const r = await executer(); return { data: r.data?.[0] ?? null, error: r.error }; },
      then(ok, ko) { return executer().then(ok, ko); },
    };
    api.fail = (m) => { st.erreur = m; return api; };
    return api;
  }
  return { from: builder, requetes, tables };
}

/* =====================================================================================================================
 * W2-1 — effacement et export du compte (D-01, D-06)
 * ===================================================================================================================== */
const UID = '11111111-1111-1111-1111-111111111111';
const AUTRE = '22222222-2222-2222-2222-222222222222';
const EMP = 'a'.repeat(64);
const EMP2 = 'b'.repeat(64);

function mondeCompte() {
  const r2 = fauxR2({
    [`${UID}/front/a.png`]: 'png',
    'mesh/j1.glb': 'GLB1', 'mesh/j2.glb': 'GLB2-partage', 'mesh/j3.glb': 'GLB3-vendu', 'mesh/j4.glb': 'GLB4',
    'mesh/autre.glb': 'GLB-AUTRE', [`${AUTRE}/front/b.png`]: 'png',
    [`_meta/api_keys/${EMP}.json`]: { uid: UID, email: 'a@b.fr', nom: 'ma cle', plafond: 5, cree: '2026-10-01', prefixe: 'mfm_ab' },
    [`_meta/api_keys_user/${UID}/${EMP}`]: '1',
    [`_meta/api_keys_spend/${EMP}/2026-10-02`]: '3',
    [`_meta/api_keys/${EMP2}.json`]: { uid: AUTRE, email: 'c@d.fr', nom: 'autre', plafond: 5, cree: '2026-10-01', prefixe: 'mfm_cd' },
    [`_meta/api_keys_user/${AUTRE}/${EMP2}`]: '1',
    [`_notifications/${UID}/n1.json`]: { id: 'n1', kind: 'market_sale', message: 'vendu', created_at: '2026-10-01' },
    [`_notifications/${AUTRE}/n9.json`]: { id: 'n9' },
    [`_meta/userspend/${UID}/2026-10-02`]: '0.5', [`_meta/userspend_cap/${UID}/2026-10-02`]: '0.5',
    [`_meta/userdaily/${UID}/2026-10-02`]: '4', [`_meta/paidcheck/${UID}/2026-10-02`]: '1',
    [`_meta/userspend/${AUTRE}/2026-10-02`]: '9',
    '_market/listings/L1.json': { id: 'L1', user_id: UID, asset_url: 'mesh/j3.glb', mesh_url: 'mesh/j3.glb', status: 'approved' },
    '_market/listings/L2.json': { id: 'L2', user_id: UID, asset_url: 'mesh/j4.glb', mesh_url: 'mesh/j4.glb', status: 'pending' },
    '_market/listings/L3.json': { id: 'L3', user_id: AUTRE, asset_url: 'mesh/autre.glb', mesh_url: 'mesh/autre.glb', status: 'approved' },
    [`_market/owners/L1/${AUTRE}.json`]: { sale_id: 's1' },          // L1 a ete achetee par un autre compte
    [`_market/owners/L3/${UID}.json`]: { sale_id: 's2' },            // notre compte a achete L3
    [`_market/ratings/L3/${UID}.json`]: { stars: 5 },
    '_meta/rig_jobs/r1.json': { user_id: UID, mesh_url: 'x' }, '_meta/rig_jobs/r2.json': { user_id: AUTRE },
    '_meta/contact/100.json': { id: '100', user_id: UID, email: 'a@b.fr', subject: 'bonjour', message: 'hello', ip: '1.2.3.4', created_at: '2026-10-01', attachments: [] },
    '_meta/contact/100/screenshot_0.png': 'png',
    '_meta/contact/200.json': { id: '200', user_id: AUTRE, email: 'c@d.fr', subject: 'x', message: 'y' },
    '_meta/pricing.json': { mesh_fast: 17 }, '_backup/2026-10-01/manifest.json': '{}',
  });
  const sb = fauxSupabase({
    profiles: [{ id: UID, credits: 10 }, { id: AUTRE, credits: 3 }],
    payments: [{ id: 1, user_id: UID, amount_eur: 5 }],
    user_assets: [{ user_id: UID, r2_path: `${UID}/front/a.png` }],
    jobs: [
      { id: 'job-j1-xxxxxxxx', user_id: UID, mesh_url: 'mesh/j1.glb' },
      { id: 'job-j2-xxxxxxxx', user_id: UID, mesh_url: 'mesh/j2.glb' },      // copie chez un autre compte
      { id: 'job-j3-xxxxxxxx', user_id: UID, mesh_url: 'mesh/j3.glb' },      // vendu a un autre compte
      { id: 'job-j4-xxxxxxxx', user_id: UID, mesh_url: 'mesh/j4.glb' },      // publie sans acheteur
      { id: 'job-x1-xxxxxxxx', user_id: AUTRE, mesh_url: 'mesh/j2.glb' },
      { id: 'job-x2-xxxxxxxx', user_id: AUTRE, mesh_url: 'mesh/autre.glb' },
    ],
  });
  return { r2, sb };
}

function chargerCompte(monde, extra = {}) {
  const texte = entre("/** Volet marketplace de l'export RGPD", '/** Site coupe (site_enabled=false)')
    + '\n' + fonction('function _cleR2DepuisUrl(') + '\n' + fonction('async function r2GetText(') + '\n' + fonction('async function _loadAllListings(') + '\n' + fonction('async function _loadAllListingsStrict(')
    + '\n' + fonction('async function _lireCle(') + '\n' + fonction('async function _clesDuCompte(');
  const env = { MESHES: monde.r2, NEXT_PUBLIC_SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 'cle' };
  const noms = {
    err: (status, message) => new Response(JSON.stringify({ error: message }), { status }),
    json: (o) => new Response(JSON.stringify(o), { status: 200 }),
    getSessionUser: async () => ({ id: UID, email: 'a@b.fr' }),
    supabaseAdmin: () => monde.sb,
    siteUrl: () => 'https://site.example',
    signedR2Url: async (_e, cle) => 'https://site.example/r2/' + cle + '?sig=x',
    getParentalStateBrut: async () => ({}),
    SECURITY_HEADERS: {},
    ...extra,
  };
  return { env, ...charger(texte, noms, ['handleMeDelete', 'handleMeExport']) };
}
const requeteDelete = () => new Request('https://site.example/api/me/delete', { method: 'POST', body: JSON.stringify({ confirm: 'DELETE' }) });

test('D-01 : suppression du compte -> maillages exclusifs supprimes, partages et vendus conserves', async () => {
  const m = mondeCompte();
  const { env, handleMeDelete } = chargerCompte(m);
  globalThis.fetch = async () => new Response('{}', { status: 200 });
  const r = await handleMeDelete(requeteDelete(), env);
  assert.equal(r.status, 200);
  const cles = new Set(m.r2.objets.keys());
  assert.ok(!cles.has('mesh/j1.glb'), 'maillage exclusif du compte supprime');
  assert.ok(!cles.has('mesh/j4.glb'), 'maillage publie sans acheteur supprime');
  assert.ok(cles.has('mesh/j2.glb'), 'maillage reference par le job d un AUTRE compte conserve');
  assert.ok(cles.has('mesh/j3.glb'), 'maillage deja achete par un autre compte conserve');
  assert.ok(cles.has('mesh/autre.glb') && cles.has(`${AUTRE}/front/b.png`), 'rien d un autre compte n est touche');
  assert.ok(!cles.has(`${UID}/front/a.png`), 'le dossier du compte part toujours');
  const corps = await r.json();
  assert.equal(corps.shared_meshes_deleted, 2);
  assert.equal(corps.shared_meshes_kept_referenced_elsewhere, 2);
  assert.equal(m.sb.tables.jobs.filter((j) => j.user_id === UID).length, 0, 'lignes jobs supprimees');
});

test('D-06 : suppression du compte -> cles API, notifications, compteurs, achats, travaux, messages de contact', async () => {
  const m = mondeCompte();
  const { env, handleMeDelete } = chargerCompte(m);
  globalThis.fetch = async () => new Response('{}', { status: 200 });
  await handleMeDelete(requeteDelete(), env);
  const cles = [...m.r2.objets.keys()];
  const restantsDuCompte = cles.filter((k) => k.includes(UID) && !k.startsWith('_market/listings/'));
  assert.deepEqual(restantsDuCompte, [], 'plus aucune cle portant l identifiant du compte (hors fiche anonymisee de la boutique)');
  for (const k of [`_meta/api_keys/${EMP}.json`, `_meta/api_keys_spend/${EMP}/2026-10-02`, '_meta/rig_jobs/r1.json', '_meta/contact/100.json', '_meta/contact/100/screenshot_0.png',
                   `_market/owners/L3/${UID}.json`, `_market/ratings/L3/${UID}.json`]) assert.ok(!cles.includes(k), 'supprime : ' + k);
  // l'autre compte et le systeme restent intacts
  for (const k of [`_meta/api_keys/${EMP2}.json`, `_meta/api_keys_user/${AUTRE}/${EMP2}`, `_notifications/${AUTRE}/n9.json`, `_meta/userspend/${AUTRE}/2026-10-02`,
                   '_meta/rig_jobs/r2.json', '_meta/contact/200.json', '_meta/pricing.json', '_backup/2026-10-01/manifest.json', `_market/owners/L1/${AUTRE}.json`]) assert.ok(cles.includes(k), 'conserve : ' + k);
});

test('D-01 : si Supabase est indisponible, 503 et RIEN n est supprime', async () => {
  const m = mondeCompte();
  const jobs = m.sb.tables.jobs;
  const origine = m.sb.from;
  m.sb.from = (nom) => { const b = origine(nom); return nom === 'jobs' ? b.fail('panne') : b; };
  const { env, handleMeDelete } = chargerCompte(m);
  globalThis.fetch = async () => new Response('{}', { status: 200 });
  const avant = m.r2.objets.size;
  const r = await handleMeDelete(requeteDelete(), env);
  assert.equal(r.status, 503);
  assert.equal(m.r2.objets.size, avant, 'aucun objet supprime');
  assert.equal(jobs.length, 6);
});

test('D-01 : un mesh_url hors liste blanche (autre dossier, _meta) n est jamais supprime', async () => {
  const m = mondeCompte();
  m.r2.poser(`${AUTRE}/mesh-op/x.glb`, 'x'); m.r2.poser('_meta/admin-totp.json', 'secret');
  m.sb.tables.jobs.push({ id: 'job-bad-1-xxxxxx', user_id: UID, mesh_url: `${AUTRE}/mesh-op/x.glb` }, { id: 'job-bad-2-xxxxxx', user_id: UID, mesh_url: '_meta/admin-totp.json' },
    { id: 'job-bad-3-xxxxxx', user_id: UID, mesh_url: 'mesh/../_meta/admin-totp.json' });
  const { env, handleMeDelete } = chargerCompte(m);
  globalThis.fetch = async () => new Response('{}', { status: 200 });
  await handleMeDelete(requeteDelete(), env);
  assert.ok(m.r2.objets.has(`${AUTRE}/mesh-op/x.glb`) && m.r2.objets.has('_meta/admin-totp.json'));
});

test('D-01 / D-06 : l export contient les maillages communs et les donnees rattachees', async () => {
  const m = mondeCompte();
  const { env, handleMeExport } = chargerCompte(m);
  const r = await handleMeExport(new Request('https://site.example/api/me/export'), env);
  assert.equal(r.status, 200);
  const e = await r.json();
  const cles = e.r2_keys.map((k) => k.key);
  assert.ok(cles.includes('mesh/j1.glb') && cles.includes('mesh/j2.glb') && cles.includes('mesh/j3.glb'), 'maillages de l espace commun listes : ' + cles.join(','));
  assert.ok(cles.includes(`${UID}/front/a.png`));
  assert.ok(!cles.includes('mesh/autre.glb'), 'jamais le maillage d un autre compte');
  const d = e.donnees_rattachees;
  assert.equal(d.notifications.length, 1);
  assert.equal(d.cles_api.length, 1);
  assert.equal(d.cles_api[0].nom, 'ma cle');
  assert.ok(!JSON.stringify(d.cles_api).includes(EMP), 'l empreinte de la cle n est pas exportee');
  assert.equal(d.evaluations_boutique.length, 1);
  assert.equal(d.messages_contact.length, 1);
  assert.equal(d.messages_contact[0].subject, 'bonjour');
  assert.ok(!('ip' in JSON.parse(JSON.stringify(d.messages_contact[0]))), 'l IP brute n est pas reexportee');
  assert.ok(d.compteurs_usage.length >= 3);
});

/* =====================================================================================================================
 * W2-2 / W2-8 — retention (D-05, D-07, corbeille)
 * ===================================================================================================================== */
const MAINT = Date.UTC(2026, 9, 3, 12, 0, 0);
const ilYa = (jours) => new Date(MAINT - jours * 86400000);
function chargerRetention(env, extra = {}) {
  const texte = entre('/* ═══ W2-2 / W2-8 RETENTION : DEBUT', '/* ═══ W2-2 / W2-8 RETENTION : FIN')
    + '\n' + fonction('async function _lireMessagesContact(') + '\n' + fonction('async function _supprimerMessageContact(') + '\n' + fonction('async function _supprimerCles(')
    + '\n' + fonction('async function _clesSousPrefixe(') + '\n' + fonction('async function r2GetText(');
  return charger(texte, { supabaseAdmin: () => extra.sb, ...extra }, ['decisionRetention', 'purgeRetention', 'purgerMessagesComptesSupprimes', '_comptesConfirmesSupprimes', 'jourEnMs']);
}

test('retention : decisions pures (age et prefixe)', () => {
  const { decisionRetention: d } = chargerRetention({});
  const ms = (j) => MAINT - j * 86400000;
  assert.equal(d('_backup/2020-01-01/supabase/jobs/0001.json', ms(2000), MAINT), 'garder', '_backup/ n est JAMAIS purge');
  assert.equal(d('_backup/_dernier.json', ms(2000), MAINT), 'garder');
  // corbeille : 30 jours
  assert.equal(d('_trash/2026-09-02/f.glb', ms(31), MAINT), 'supprimer');
  assert.equal(d('_trash/2026-09-04/f.glb', ms(29), MAINT), 'garder');
  assert.equal(d('_trash/2026-08-01/f.glb', ms(1), MAINT), 'garder', 'ecriture recente : on garde (date la plus recente)');
  assert.equal(d('_trash/pas-une-date/f.glb', null, MAINT), 'garder');
  // journaux console
  assert.equal(d('_anon/logs/a.log', ms(45), MAINT), 'supprimer');
  assert.equal(d('_anon/logs/a.log', ms(10), MAINT), 'garder');
  assert.equal(d(`${UID}/logs/a.log`, ms(59), MAINT), 'supprimer');
  assert.equal(d(`${UID}/logs/a.log`, ms(29), MAINT), 'garder');
  assert.equal(d(`${UID}/front/a.png`, ms(400), MAINT), 'garder', 'le reste du dossier du compte n est pas concerne');
  assert.equal(d('autre/logs/a.log', ms(400), MAINT), 'garder', 'un dossier qui n est pas un identifiant de compte est ignore');
  // audit admin : 12 mois
  assert.equal(d('_meta/admin_audit/2025-09-01.log', ms(1), MAINT), 'supprimer');
  assert.equal(d('_meta/admin_audit/2025-10-05.log', ms(1), MAINT), 'garder');
  // compteurs par IP : 2 jours
  assert.equal(d('_meta/report_rate/2026-09-30/1.2.3.4', null, MAINT), 'supprimer');
  assert.equal(d('_meta/report_rate/2026-10-02/1.2.3.4', null, MAINT), 'garder');
  assert.equal(d('_meta/contact_count/2026-10-01/_global.txt', null, MAINT), 'supprimer');
  assert.equal(d('_meta/contact_count/2026-10-03/_global.txt', null, MAINT), 'garder');
  assert.equal(d('_meta/alerte_messages/2026-09-30T14.txt', null, MAINT), 'supprimer');
  // messages de contact : 12 mois, d'apres l'horodatage de l'identifiant (fiche ET pieces)
  const vieux = Date.UTC(2025, 8, 1) + '_abc123', recent = Date.UTC(2026, 8, 1) + '_def456';
  assert.equal(d(`_meta/contact/${vieux}.json`, ms(1), MAINT), 'supprimer', 'relire / modifier la fiche ne repousse pas la retention');
  assert.equal(d(`_meta/contact/${vieux}/screenshot_0.png`, ms(1), MAINT), 'supprimer');
  assert.equal(d(`_meta/contact/${recent}.json`, ms(400), MAINT), 'garder');
  // familles inconnues et reglages : toujours gardes
  for (const k of ['_meta/pricing.json', '_meta/compta/paiements_anonymes/1.json', 'mesh/x.glb', '_market/listings/L1.json', '_meta/cron/last_run.json']) assert.equal(d(k, ms(5000), MAINT), 'garder', k);
});

test('retention : passage complet sur un faux R2, _backup/ et _trash/ recent intacts', async () => {
  const vieux = Date.UTC(2025, 8, 1) + '_abc123', recent = Date.UTC(2026, 8, 1) + '_def456', gone = Date.UTC(2026, 8, 5) + '_ggg111', present = Date.UTC(2026, 8, 6) + '_hhh222';
  const GONE = '99999999-9999-9999-9999-999999999999';
  const r2 = fauxR2();
  const mettre = (k, v, jours = 1) => r2.poser(k, v, ilYa(jours));
  mettre('_backup/2026-09-01/supabase/jobs/0001.json', '[]', 400); mettre('_backup/_dernier.json', '{}', 400);
  mettre('_trash/2026-08-01/vieux.glb', 'x', 60); mettre('_trash/2026-09-30/recent.glb', 'x', 3);
  mettre('_anon/logs/a.log', 'x', 45); mettre('_anon/logs/b.log', 'x', 2);
  mettre(`${UID}/logs/a.log`, 'x', 90); mettre(`${UID}/logs/b.log`, 'x', 2); mettre(`${UID}/front/a.png`, 'x', 400);
  mettre(`${AUTRE}/logs/c.log`, 'x', 61);
  mettre('_meta/admin_audit/2025-09-01.log', 'x', 400); mettre('_meta/admin_audit/2026-09-30.log', 'x', 3);
  mettre('_meta/report_rate/2026-09-28/1.2.3.4', '1', 5); mettre('_meta/report_rate/2026-10-03/1.2.3.4', '1', 0);
  mettre('_meta/contact_count/2026-09-28/_global.txt', '1', 5); mettre('_meta/contact_count/2026-10-03/_global.txt', '1', 0);
  mettre(`_meta/contact/${vieux}.json`, { id: vieux, user_id: null }, 1); mettre(`_meta/contact/${vieux}/screenshot_0.png`, 'png', 1);
  mettre(`_meta/contact/${recent}.json`, { id: recent, user_id: null }, 400);
  mettre(`_meta/contact/${gone}.json`, { id: gone, user_id: GONE }, 1); mettre(`_meta/contact/${gone}/screenshot_0.png`, 'png', 1);
  mettre(`_meta/contact/${present}.json`, { id: present, user_id: UID }, 1);
  mettre('_meta/pricing.json', '{}', 900);
  const env = { MESHES: r2 };
  const { purgeRetention } = chargerRetention(env);
  const verifier = async (ids) => new Set(ids.filter((i) => i === GONE));   // GONE : compte confirme supprime
  const bilan = await purgeRetention(env, MAINT, verifier);
  const cles = new Set(r2.objets.keys());
  for (const k of ['_trash/2026-08-01/vieux.glb', '_anon/logs/a.log', `${UID}/logs/a.log`, `${AUTRE}/logs/c.log`, '_meta/admin_audit/2025-09-01.log',
                   '_meta/report_rate/2026-09-28/1.2.3.4', '_meta/contact_count/2026-09-28/_global.txt', `_meta/contact/${vieux}.json`, `_meta/contact/${vieux}/screenshot_0.png`,
                   `_meta/contact/${gone}.json`, `_meta/contact/${gone}/screenshot_0.png`]) assert.ok(!cles.has(k), 'purge : ' + k);
  for (const k of ['_backup/2026-09-01/supabase/jobs/0001.json', '_backup/_dernier.json', '_trash/2026-09-30/recent.glb', '_anon/logs/b.log', `${UID}/logs/b.log`, `${UID}/front/a.png`,
                   '_meta/admin_audit/2026-09-30.log', '_meta/report_rate/2026-10-03/1.2.3.4', '_meta/contact_count/2026-10-03/_global.txt', `_meta/contact/${recent}.json`,
                   `_meta/contact/${present}.json`, '_meta/pricing.json']) assert.ok(cles.has(k), 'conserve : ' + k);
  assert.equal(bilan.messages_de_comptes_supprimes, 1);
  assert.ok(bilan.deleted >= 9);
  assert.ok(!r2.journal.suppressions.some((k) => k.startsWith('_backup/')), 'aucune suppression sous _backup/');
});

test('retention : la verification de compte supprime exige profil absent ET 404 de l auth ; au moindre doute rien n est supprime', async () => {
  const env = { MESHES: fauxR2(), NEXT_PUBLIC_SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 'cle' };
  const sb = fauxSupabase({ profiles: [{ id: UID }] });
  const { _comptesConfirmesSupprimes } = chargerRetention(env, { sb });
  const ID = '33333333-3333-3333-3333-333333333333';
  globalThis.fetch = async () => new Response('', { status: 404 });
  assert.deepEqual([...(await _comptesConfirmesSupprimes(env, [UID, ID]))], [ID], 'present dans profiles : jamais supprime');
  globalThis.fetch = async () => new Response('', { status: 500 });
  assert.equal((await _comptesConfirmesSupprimes(env, [ID])).size, 0, 'erreur serveur : pas de suppression');
  globalThis.fetch = async () => new Response('{}', { status: 200 });
  assert.equal((await _comptesConfirmesSupprimes(env, [ID])).size, 0, 'le compte existe encore cote auth : pas de suppression');
  const sbPanne = { from: () => fauxSupabase({}).from('profiles').fail('panne') };
  const r = chargerRetention(env, { sb: sbPanne });
  assert.equal(await r._comptesConfirmesSupprimes(env, [ID]), null, 'requete en erreur : doute -> null');
});

/* =====================================================================================================================
 * W2-3 — sauvegarde nocturne (EXP-01, EXP-02, FIN-06)
 * ===================================================================================================================== */
function chargerSauvegarde(env, extra = {}) {
  const texte = entre('/* ═══ W2-3 SAUVEGARDE NOCTURNE : DEBUT', '/* ═══ W2-3 SAUVEGARDE NOCTURNE : FIN')
    + '\n' + fonction('function jourEnMs(') + '\n' + fonction('async function _clesSousPrefixe(') + '\n' + fonction('async function _supprimerCles(') + '\n' + fonction('async function r2GetText(');
  return charger(texte, { supabaseAdmin: () => extra.sb, _sendAdminAlertEmail: async () => {}, ...extra },
    ['sauvegardeNocturne', 'sauvegardeDue', 'plageDuBloc', 'dossiersSauvegardeASupprimer', 'evaluerSauvegarde', '_tablesSupabaseASauvegarder']);
}
const NUIT = Date.UTC(2026, 9, 3, 3, 0, 0);          // 03/10/2026 03:00 UTC
const ENV_SB = { NEXT_PUBLIC_SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 'cle' };
const lignes = (n, prefixe) => Array.from({ length: n }, (_, i) => ({ id: prefixe + i, user_id: UID, v: i }));
function espionnerPuts(r2) { const puts = []; const p = r2.put.bind(r2); r2.put = async (k, v, o) => { puts.push(k); return p(k, v, o); }; return puts; }

test('sauvegarde : garde de date (une fois par jour UTC, apres 02:00, verrou, plafond d echecs)', () => {
  const { sauvegardeDue: due } = chargerSauvegarde({});
  const T = (h) => Date.UTC(2026, 9, 3, h, 0, 0);
  assert.equal(due(null, T(1)), 'trop_tot');
  assert.equal(due(null, T(2)), 'oui');
  assert.equal(due({ jour: '2026-10-03', statut: 'ok', echecs: 0 }, T(10)), 'deja_faite');
  assert.equal(due({ jour: '2026-10-02', statut: 'ok', echecs: 0 }, T(10)), 'oui', 'la reussite d hier ne vaut pas pour aujourd hui');
  assert.equal(due({ jour: '2026-10-03', statut: 'echec', echecs: 4 }, T(10)), 'trop_d_echecs');
  assert.equal(due({ jour: '2026-10-03', statut: 'echec', echecs: 2 }, T(10)), 'oui');
  assert.equal(due({ jour: '2026-10-03', statut: 'en_cours', echecs: 0, verrou_jusqua: T(10) + 5000 }, T(10)), 'verrouille');
  assert.equal(due({ jour: '2026-10-03', statut: 'en_cours', echecs: 0, verrou_jusqua: T(10) - 5000 }, T(10)), 'oui', 'verrou expire');
});

test('sauvegarde : decoupage en blocs, choix des dossiers a supprimer, point de sante', () => {
  const { plageDuBloc: p, dossiersSauvegardeASupprimer: d, evaluerSauvegarde: e } = chargerSauvegarde({});
  assert.deepEqual(p(0), [0, 999]); assert.deepEqual(p(1), [1000, 1999]); assert.deepEqual(p(3), [3000, 3999]);
  const dossiers = ['_backup/2026-09-10/', '_backup/2026-09-19/', '_backup/2026-09-18/', '_backup/2026-10-03/', '_backup/mal-nomme/', '_backup/2026-09-10', '_trash/2026-01-01/'];
  assert.deepEqual(d(dossiers, '2026-10-03'), ['_backup/2026-09-10/', '_backup/2026-09-18/'], '15 jours d age = a supprimer, 14 = conserve, le reste ignore');
  assert.deepEqual(d(dossiers, 'pas-une-date'), []);
  const h = (n) => new Date(NUIT - n * 3600000).toISOString();
  assert.equal(e({ derniere_reussite: h(35) }, NUIT).ok, true);
  assert.equal(e({ derniere_reussite: h(37) }, NUIT).ok, false);
  assert.equal(e(null, NUIT).ok, false);
  assert.match(e(null, NUIT).etat, /JAMAIS/);
  assert.equal(e({ derniere_reussite: h(10) }, NUIT).age_h, 10);
});

function mondeSauvegarde() {
  const r2 = fauxR2({
    '_meta/pricing.json': { mesh_fast: 17 }, '_meta/service-flags.json': { site_enabled: true }, '_meta/admin-totp.json': 'SECRET-TOTP', '_meta/admin_password.json': 'SECRET-PW',
    '_meta/admin_audit/2026-10-02.log': 'ligne', '_meta/compta/paiements_anonymes/1.json': '{}', '_meta/gros.json': 'x',
    '_backup/2026-09-10/manifest.json': '{}', '_backup/2026-09-10/supabase/jobs/0000.json': '[]',
    '_backup/2026-09-19/manifest.json': '{}', '_backup/2026-09-25/manifest.json': '{}',
  });
  const sb = fauxSupabase({ profiles: lignes(3, 'p'), jobs: lignes(2500, 'j'), payments: [], user_assets: lignes(1, 'a') });
  return { r2, sb, env: { MESHES: r2, ...ENV_SB } };
}
const TABLES = ['profiles', 'jobs', 'payments', 'user_assets'];

test('sauvegarde : passage complet (blocs de 1000, une ecriture par bloc, meta, manifeste, rotation) puis garde de date', async () => {
  const m = mondeSauvegarde();
  const puts = espionnerPuts(m.r2);
  const { sauvegardeNocturne } = chargerSauvegarde(m.env, { sb: m.sb });
  const r = await sauvegardeNocturne(m.env, NUIT, { sb: m.sb, tables: TABLES });
  assert.equal(r.statut, 'ok', JSON.stringify(r));
  const lire = (k) => JSON.parse(m.r2.objets.get(k).corps);
  assert.equal(lire('_backup/2026-10-03/supabase/jobs/0000.json').length, 1000);
  assert.equal(lire('_backup/2026-10-03/supabase/jobs/0001.json').length, 1000);
  assert.equal(lire('_backup/2026-10-03/supabase/jobs/0002.json').length, 500);
  assert.ok(!m.r2.objets.has('_backup/2026-10-03/supabase/jobs/0003.json'));
  assert.equal(lire('_backup/2026-10-03/supabase/profiles/0000.json').length, 3);
  assert.deepEqual(lire('_backup/2026-10-03/supabase/payments/0000.json'), [], 'table vide : bloc 0000 vide');
  assert.equal(puts.filter((k) => k.startsWith('_backup/2026-10-03/supabase/jobs/')).length, 3, 'une ecriture R2 par bloc');
  // fichiers de reglages : copies ; secrets d administration : JAMAIS
  assert.ok(m.r2.objets.has('_backup/2026-10-03/r2/_meta/pricing.json'));
  assert.ok(m.r2.objets.has('_backup/2026-10-03/r2/_meta/admin_audit/2026-10-02.log'));
  assert.ok(m.r2.objets.has('_backup/2026-10-03/r2/_meta/compta/paiements_anonymes/1.json'));
  assert.ok(![...m.r2.objets.keys()].some((k) => k.startsWith('_backup/') && /admin-totp|admin_password/.test(k)), 'aucun secret copie');
  assert.ok(!m.r2.objets.has('_backup/2026-10-03/r2/_meta/gros.json'), 'un fichier hors liste n est pas copie');
  const man = lire('_backup/2026-10-03/manifest.json');
  assert.equal(man.tables.jobs.lignes, 2500); assert.equal(man.tables.jobs.blocs, 3);
  const etat = lire('_backup/_dernier.json');
  assert.equal(etat.statut, 'ok'); assert.equal(etat.jour, '2026-10-03'); assert.ok(etat.derniere_reussite);
  // rotation : > 14 jours supprime, le reste conserve
  assert.ok(![...m.r2.objets.keys()].some((k) => k.startsWith('_backup/2026-09-10/')), 'dossier de 23 jours supprime');
  assert.ok(m.r2.objets.has('_backup/2026-09-19/manifest.json') && m.r2.objets.has('_backup/2026-09-25/manifest.json'));
  // garde de date : un second passage le meme jour ne fait rien
  const lectures = m.sb.requetes.length, nbPuts = puts.length;
  assert.equal((await sauvegardeNocturne(m.env, NUIT + 3600000, { sb: m.sb, tables: TABLES })).statut, 'deja_faite');
  assert.equal(m.sb.requetes.length, lectures); assert.equal(puts.length, nbPuts);
  // le lendemain, une nouvelle sauvegarde
  assert.equal((await sauvegardeNocturne(m.env, NUIT + 86400000, { sb: m.sb, tables: TABLES })).statut, 'ok');
  assert.ok(m.r2.objets.has('_backup/2026-10-04/manifest.json'));
});

test('sauvegarde : budget de temps epuise -> passage partiel, reprise au bloc suivant sans doublon', async () => {
  const m = mondeSauvegarde();
  const { sauvegardeNocturne } = chargerSauvegarde(m.env, { sb: m.sb });
  let t = 0; const horloge = () => (t += 60_000);          // chaque lecture d horloge avance d une minute : budget de 100 s epuise vite
  const r1 = await sauvegardeNocturne(m.env, NUIT, { sb: m.sb, tables: ['jobs'], horloge });
  assert.equal(r1.statut, 'partiel');
  const apres1 = JSON.parse(m.r2.objets.get('_backup/_dernier.json').corps);
  assert.equal(apres1.statut, 'en_cours'); assert.equal(apres1.verrou_jusqua, 0);
  assert.ok(apres1.tables.jobs.blocs >= 1 && apres1.tables.jobs.blocs < 3);
  const r2e = await sauvegardeNocturne(m.env, NUIT + 60_000, { sb: m.sb, tables: ['jobs'] });
  assert.equal(r2e.statut, 'ok');
  const blocs = [...m.r2.objets.keys()].filter((k) => k.startsWith('_backup/2026-10-03/supabase/jobs/')).sort();
  assert.deepEqual(blocs.map((k) => k.slice(-9)), ['0000.json', '0001.json', '0002.json']);
  const total = blocs.reduce((n, k) => n + JSON.parse(m.r2.objets.get(k).corps).length, 0);
  assert.equal(total, 2500, 'aucune ligne perdue ni dupliquee');
});

test('sauvegarde : echecs -> une seule alerte par jour, pas de rotation, plafond d essais, reprise le lendemain', async () => {
  const m = mondeSauvegarde();
  const { sauvegardeNocturne } = chargerSauvegarde(m.env, { sb: m.sb });
  const origine = m.sb.from;
  let panne = true;
  const sbCasse = { ...m.sb, from: (nom) => (panne && nom === 'jobs' ? origine(nom).fail('connexion perdue') : origine(nom)) };
  const alertes = [];
  const deps = { sb: sbCasse, tables: TABLES, alerter: async (s, t) => { alertes.push({ s, t }); } };
  const statuts = [];
  for (let i = 0; i < 6; i++) statuts.push((await sauvegardeNocturne(m.env, NUIT + i * 900_000, deps)).statut);
  assert.deepEqual(statuts, ['echec', 'echec', 'echec', 'echec', 'trop_d_echecs', 'trop_d_echecs']);
  assert.equal(alertes.length, 1, 'une seule alerte e-mail par jour');
  assert.match(alertes[0].s, /Sauvegarde nocturne en echec/);
  assert.ok(alertes[0].t.includes('connexion perdue'));
  assert.ok(m.r2.objets.has('_backup/2026-09-10/manifest.json'), 'pas de rotation tant que la sauvegarde du jour n a pas reussi');
  assert.ok(!m.r2.objets.has('_backup/2026-10-03/manifest.json'));
  panne = false;
  assert.equal((await sauvegardeNocturne(m.env, NUIT + 86400000, deps)).statut, 'ok');
  const etat = JSON.parse(m.r2.objets.get('_backup/_dernier.json').corps);
  assert.equal(etat.echecs, 0); assert.equal(etat.jour, '2026-10-04');
  assert.ok(!m.r2.objets.has('_backup/2026-09-10/manifest.json'), 'rotation apres la reussite');
});

test('sauvegarde : ne leve JAMAIS, meme si R2 est en panne ; non configuree = rien', async () => {
  const r2 = fauxR2(); r2.put = async () => { throw new Error('R2 indisponible'); };
  const env = { MESHES: r2, ...ENV_SB };
  const { sauvegardeNocturne } = chargerSauvegarde(env, {});
  const r = await sauvegardeNocturne(env, NUIT, { sb: fauxSupabase({}), tables: ['jobs'] });
  assert.equal(r.statut, 'erreur_interne');
  assert.equal((await sauvegardeNocturne({ MESHES: fauxR2() }, NUIT)).statut, 'non_configuree');
  assert.equal((await sauvegardeNocturne({}, NUIT)).statut, 'non_configuree');
});

test('sauvegarde : liste des tables = 4 critiques + tables exposees par l API (noms valides seulement) ; repli sur les 4 critiques', async () => {
  const env = { MESHES: fauxR2(), ...ENV_SB };
  const { _tablesSupabaseASauvegarder: t } = chargerSauvegarde(env, {});
  globalThis.fetch = async () => new Response(JSON.stringify({ paths: { '/': {}, '/profiles': {}, '/credits_log': {}, '/rpc/f': {}, '/mauvais-nom': {}, '/x;drop': {} } }), { status: 200 });
  assert.deepEqual(await t(env), ['profiles', 'jobs', 'payments', 'user_assets', 'credits_log']);
  globalThis.fetch = async () => new Response('', { status: 500 });
  assert.deepEqual(await t(env), ['profiles', 'jobs', 'payments', 'user_assets']);
  globalThis.fetch = async () => { throw new Error('reseau'); };
  assert.deepEqual(await t(env), ['profiles', 'jobs', 'payments', 'user_assets']);
});

/* =====================================================================================================================
 * W2-4 — alerte e-mail a chaque nouveau message de contact / signalement (EXP-08)
 * ===================================================================================================================== */
function chargerAlerte(env, extra = {}) {
  const mails = [];
  const texte = entre('/* ═══ W2-4 ALERTE DE NOUVEAU MESSAGE : DEBUT', '/* ═══ W2-4 ALERTE DE NOUVEAU MESSAGE : FIN')
    + '\n' + fonction('function _attenteBruitee(') + '\n' + fonction('async function _casIncrementCounter(') + '\n' + fonction('async function r2GetText(')
    + '\n' + fonction('function _safeId(') + '\n' + fonction('async function handleContactSubmit(')
    // 2026-10-03 (vague 5, D-05 / D-07) : la route de contact tronque l'IP et indexe son compteur par empreinte : ces aides doivent etre chargees aussi
    + '\n' + fonction('function _tronquerIp(') + '\n' + fonction('async function _empreinteIp(') + '\n' + fonction('async function _cleCompteurIp(');
  const noms = {
    _sendAdminAlertEmail: async (_e, sujet, corps) => { mails.push({ sujet, corps }); },
    err: (status, message) => new Response(JSON.stringify({ error: message }), { status }),
    json: (o) => new Response(JSON.stringify(o), { status: 200 }),
    getSessionUser: async () => null, signedR2Url: async () => 'https://x', ...extra,
  };
  return { mails, ...charger(texte, noms, ['_alerterNouveauMessage', 'texteAlerteMessage', 'cleCompteurAlerteMessages', 'handleContactSubmit']) };
}
async function avecHorloge(ms, f) { const vraie = Date.now; Date.now = () => ms; try { return await f(); } finally { Date.now = vraie; } }

test('alerte message : texte = type, objet tronque, identifiant, heure ; jamais le contenu', () => {
  const { texteAlerteMessage: t } = chargerAlerte({});
  const m = t('contact', '123_abc', 'Bonjour\r\nBcc: pirate@example.com ' + 'x'.repeat(200), '2026-10-03T12:00:00.000Z');
  assert.equal(m.sujet, '[MyFabmesh] Nouveau message de contact');
  assert.ok(!m.texte.includes('\r'), 'pas de retour chariot injecte');
  assert.ok(m.texte.split('\n')[1].length <= 'Objet : '.length + 80, 'objet tronque a 80');
  assert.match(m.texte, /Heure : 2026-10-03T12:00:00.000Z/);
  assert.equal(t('signalement', 'i', 'sexual', 'z').sujet, '[MyFabmesh] Nouveau signalement de contenu');
});

test('alerte message : au plus 10 e-mails par heure (global), l heure suivante repart, jamais d exception', async () => {
  const env = { MESHES: fauxR2() };
  const a = chargerAlerte(env);
  const H = Date.UTC(2026, 9, 3, 14, 5, 0);
  const envoyes = [];
  await avecHorloge(H, async () => { for (let i = 0; i < 13; i++) envoyes.push(await a._alerterNouveauMessage(env, 'contact', 'id' + i, 'objet')); });
  assert.equal(envoyes.filter(Boolean).length, 10); assert.equal(a.mails.length, 10);
  assert.ok(env.MESHES.objets.has('_meta/alerte_messages/2026-10-03T14.txt'));
  await avecHorloge(H + 3600_000, async () => { assert.equal(await a._alerterNouveauMessage(env, 'contact', 'z', 'o'), true); });
  assert.equal(a.mails.length, 11);
  assert.equal(await a._alerterNouveauMessage({}, 'contact', 'x', 'o'), false, 'sans R2 : pas d alerte, pas d exception');
  const casse = { MESHES: { get: async () => { throw new Error('R2'); }, put: async () => { throw new Error('R2'); } } };
  assert.equal(await a._alerterNouveauMessage(casse, 'contact', 'x', 'o'), false);
});

test('alerte message : POST /api/contact declenche UN e-mail sans le texte du message', async () => {
  const env = { MESHES: fauxR2() };
  const a = chargerAlerte(env);
  const corps = { name: 'Alice', email: 'alice@example.com', subject: 'Probleme de facture', message: 'TEXTE-SECRET-DU-MESSAGE' };
  const r = await a.handleContactSubmit(new Request('https://site.example/api/contact', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '1.2.3.4' }, body: JSON.stringify(corps) }), env);
  assert.equal(r.status, 200);
  assert.equal(a.mails.length, 1);
  assert.match(a.mails[0].corps, /Probleme de facture/);
  assert.ok(!a.mails[0].corps.includes('TEXTE-SECRET-DU-MESSAGE') && !a.mails[0].sujet.includes('TEXTE-SECRET'), 'le message n est pas recopie');
  assert.ok(!a.mails[0].corps.includes('alice@example.com'), 'ni l e-mail du visiteur');
});

test('alerte message : le signalement de contenu appelle aussi l alerte (cablage)', () => {
  const debut = SRC.indexOf('async function handleReportContent(');
  const fin = SRC.indexOf('async function _exportMarketplaceDuCompte(');
  assert.ok(debut > 0 && fin > debut);
  assert.match(SRC.slice(debut, fin), /_alerterNouveauMessage\(env, 'signalement', id, motif\)/);
});

/* =====================================================================================================================
 * W2-5 — palier Fast : atlas 2048 (texture)
 * ===================================================================================================================== */
test('texture : table de decision de texture_size selon le palier (Fast passe a 2048, pas inchanges)', () => {
  const debut = SRC.indexOf('const PALIERS_GENERATION');
  assert.ok(debut > 0, 'PALIERS_GENERATION absente (ancien code)');
  const fin = SRC.indexOf('/* ───────────────────── Modal mesh — ASYNC pattern', debut);
  const { PALIERS_GENERATION: P, tailleAtlasGeneration: atlas } = charger(SRC.slice(debut, fin), {}, ['PALIERS_GENERATION', 'tailleAtlasGeneration']);
  assert.deepEqual(P.fast, { pas: 24, atlas: 2048 }, 'Fast : atlas 2048, 24 pas inchanges');
  assert.deepEqual(P.balanced, { pas: 24, atlas: 2048 });
  assert.deepEqual(P.quality, { pas: 32, atlas: 4096 });
  assert.deepEqual(P.ultra_8k, { pas: 32, atlas: 4096 });
  assert.equal(atlas({ preset: 'fast' }), 2048);
  assert.equal(atlas({ preset: 'fast', mode: 'lite' }), 2048, 'le palier prime sur le mode');
  assert.equal(atlas({ preset: 'balanced' }), 2048);
  assert.equal(atlas({ preset: 'quality' }), 4096);
  assert.equal(atlas({ preset: 'ultra_8k' }), 4096);
  assert.equal(atlas({ preset: 'fast', ultra_hd: true }), 4096, 'ultra_hd force 4096');
  assert.equal(atlas({ mode: 'full' }), 2048, 'ancien client sans palier : mode full');
  assert.equal(atlas({}), 1024, 'ancien client sans palier : 1024 inchange');
  assert.equal(atlas({ preset: 'inconnu' }), 1024);
});

test('texture : rien d autre ne force 1024 pour le palier Fast (envoi a Modal, options du job, delai maximal)', () => {
  const debut = SRC.indexOf('async function handleGenerate(');
  const fin = SRC.indexOf('let prediction;', debut);
  const gen = SRC.slice(debut, fin);
  assert.ok(!/palier \? palier\.atlas/.test(gen), 'plus de duplication de la regle dans handleGenerate');
  assert.equal((gen.match(/texture_size: atlasGeneration,/g) || []).length, 2, 'envoi a Modal ET options du job lisent la meme valeur');
  assert.ok(!/preset === 'fast' \? 1024/.test(SRC), 'le delai maximal n estime plus Fast en 1024');
  // le delai maximal d un Fast ne doit pas etre inferieur a celui d un Balanced (meme atlas, memes pas)
  const texte = fonction('function _delaiMaxGenerationS(') ;
  const tex = SRC.slice(SRC.indexOf('const PALIERS_GENERATION'), SRC.indexOf('/* ───────────────────── Modal mesh — ASYNC pattern'));
  const { _delaiMaxGenerationS: d } = charger(tex + '\n' + texte, {}, ['_delaiMaxGenerationS']);
  for (const tris of [500_000, 3_000_000, 7_000_000]) {
    assert.equal(d({ preset: 'fast', max_tris: tris }, false), d({ preset: 'balanced', max_tris: tris }, false), 'meme delai pour Fast et Balanced a ' + tris);
  }
});

/* =====================================================================================================================
 * W2-7 — pagination du tableau de bord (PB-04)
 * ===================================================================================================================== */
test('PB-04 : lirePagesSupabase lit au-dela de 1000 lignes, meme si le projet plafonne ses reponses', async () => {
  const { lirePagesSupabase: lire } = charger(fonction('async function lirePagesSupabase<T>('), {}, ['lirePagesSupabase']);
  const table = Array.from({ length: 2500 }, (_, i) => ({ i }));
  const serveur = (plafond) => { const appels = []; return { appels, fabrique: async (a, b) => { appels.push([a, b]); return { data: table.slice(a, Math.min(b, a + plafond - 1) + 1), error: null }; } }; };
  const s1 = serveur(1000);
  const tout = await lire(s1.fabrique);
  assert.equal(tout.length, 2500); assert.deepEqual(tout.map((x) => x.i), table.map((x) => x.i));
  assert.deepEqual(s1.appels.slice(0, 3), [[0, 999], [1000, 1999], [2000, 2999]], 'blocs de 1000 via range');
  const s2 = serveur(500);                                   // projet configure a 500 lignes max : aucune ligne sautee
  assert.equal((await lire(s2.fabrique)).length, 2500);
  assert.equal((await lire(serveur(1000).fabrique, 1200)).length, 1200, 'le plafond max est respecte');
  assert.deepEqual(await lire(async () => ({ data: [], error: null })), []);
  await assert.rejects(lire(async () => ({ data: null, error: { message: 'panne' } })), /panne/);
});

test('PB-04 : handleAdminStats lit les travaux et les paiements par pages (plus de limit(20000))', () => {
  const debut = SRC.indexOf('async function handleAdminStats(');
  const corps = SRC.slice(debut, debut + 6000);
  assert.match(corps, /lirePagesSupabase<unknown>\(\(a, b\) => sb\s*\.from\('jobs'\)/);
  const sansCommentaires = corps.split(String.fromCharCode(10)).filter((l) => !l.trim().startsWith('//')).join(String.fromCharCode(10));
  assert.ok(!/\.limit\(20000\)/.test(sansCommentaires), 'plus de limit(20000)');
  assert.match(SRC.slice(debut, debut + 30000), /lirePagesSupabase<unknown>\(\(a, b\) => sb\s*\.from\('payments'\)/);
});

/* =====================================================================================================================
 * W2-6 — GET /api/health (EXP-04)
 * ===================================================================================================================== */
function chargerSante(env, extra = {}) {
  const texte = entre('/* ═══ W2-6 SONDE /api/health : DEBUT', '/* ═══ W2-6 SONDE /api/health : FIN');
  return charger(texte, { isMock: () => false, supabaseAdmin: () => extra.sb, SECURITY_HEADERS: {}, ...extra }, ['handleHealth']);
}
const ENV_SECRET = { SUPABASE_SERVICE_ROLE_KEY: 'SECRET-SERVICE-ROLE', STRIPE_SECRET_KEY: 'sk_live_SECRET', NEXT_PUBLIC_SUPABASE_URL: 'https://sb.example' };

test('health : 200 { ok, ts } quand R2 et la base repondent', async () => {
  const env = { MESHES: fauxR2(), ...ENV_SECRET };
  const { handleHealth } = chargerSante(env, { sb: fauxSupabase({ profiles: [{ id: UID }] }) });
  const r = await handleHealth(env);
  assert.equal(r.status, 200);
  const c = await r.json();
  assert.equal(c.ok, true); assert.ok(!Number.isNaN(Date.parse(c.ts)));
  assert.deepEqual(Object.keys(c).sort(), ['ok', 'ts']);
  assert.equal(r.headers.get('cache-control'), 'no-store');
});

test('health : 503 si R2 ou la base est en panne, sans aucun detail ni secret dans la reponse', async () => {
  const casseR2 = { MESHES: { head: async () => { throw new Error('R2 down: SECRET-SERVICE-ROLE'); } }, ...ENV_SECRET };
  const a = chargerSante(casseR2, { sb: fauxSupabase({ profiles: [] }) });
  const r1 = await a.handleHealth(casseR2);
  assert.equal(r1.status, 503);
  const t1 = await r1.text();
  assert.deepEqual(Object.keys(JSON.parse(t1)).sort(), ['ok', 'ts']); assert.ok(!/SECRET|down|sk_live|supabase/i.test(t1));
  const env2 = { MESHES: fauxR2(), ...ENV_SECRET };
  const sbPanne = { from: () => fauxSupabase({ profiles: [] }).from('profiles').fail('relation introuvable SECRET-SERVICE-ROLE') };
  const b = chargerSante(env2, { sb: sbPanne });
  const r2e = await b.handleHealth(env2);
  assert.equal(r2e.status, 503); const t2 = await r2e.text(); assert.ok(!/SECRET|relation/.test(t2));
  const c = chargerSante({ ...ENV_SECRET }, { sb: fauxSupabase({}) });
  assert.equal((await c.handleHealth({ ...ENV_SECRET })).status, 503, 'sans binding R2 : 503');
});

test('health : delai depasse = 503, et le resultat est memorise 10 s (la sonde publique ne marteline pas R2)', async () => {
  let tetes = 0;
  const env = { MESHES: { head: async () => { tetes++; return null; } }, ...ENV_SECRET };
  const { handleHealth } = chargerSante(env, { sb: fauxSupabase({ profiles: [{ id: UID }] }) });
  await handleHealth(env); await handleHealth(env); await handleHealth(env);
  assert.equal(tetes, 1, 'un seul controle R2 pour trois appels rapproches');
  const lent = { MESHES: { head: () => new Promise(() => {}) }, ...ENV_SECRET };   // ne repond jamais
  const l = chargerSante(lent, { sb: fauxSupabase({ profiles: [{ id: UID }] }) });
  const t0 = Date.now();
  const r = await l.handleHealth(lent);
  assert.equal(r.status, 503); assert.ok(Date.now() - t0 < 8000, 'delai de 5 s respecte');
});

test('health : exemptee du coupe-circuit maintenance, routee en GET/HEAD avant tout gestionnaire facturable', () => {
  const exemption = SRC.indexOf("|| pathname === '/api/health'");
  const garde = SRC.indexOf('const isAdminRoute = pathname.startsWith');
  const fin = SRC.indexOf('if (!isAdminRoute) {', garde);
  assert.ok(garde > 0 && exemption > garde && exemption < fin, '/api/health fait partie des routes exemptees de la maintenance');
  const route = SRC.indexOf("if (pathname === '/api/health'");
  const premiere = SRC.indexOf("if (pathname === '/api/me'                    && method === 'GET')", route);
  assert.ok(route > 0 && route < premiere, 'declaree avant la premiere route du routeur');
  assert.match(SRC.slice(route, route + 200), /method === 'GET' \|\| method === 'HEAD'/);
});

/* =====================================================================================================================
 * Cablage (cron et ecran de sante)
 * ===================================================================================================================== */
test('cablage : la sauvegarde nocturne est lancee par le cron frequent, la retention par le cron hebdomadaire', () => {
  const planif = SRC.indexOf('async scheduled(');
  const routeur = SRC.indexOf('async fetch(', planif);
  const corps = SRC.slice(planif, routeur);
  const hebdo = corps.indexOf("if (event.cron === '0 6 * * 1')");
  const frequent = corps.indexOf("if (event.cron !== '0 6 * * 1')");
  assert.ok(hebdo > 0 && frequent > hebdo);
  assert.ok(corps.slice(hebdo, frequent).includes('purgeRetention(env)'), 'retention dans le cron hebdomadaire');
  assert.ok(corps.slice(frequent).includes('sauvegardeNocturne(env)'), 'sauvegarde dans le cron frequent');
  assert.ok(corps.slice(hebdo, frequent).includes('purgeDiagLogs(env)'), 'la purge existante est conservee');
});

test('cablage : l ecran de sante expose le point « sauvegarde nocturne » avec la forme des autres points', () => {
  const debut = SRC.indexOf('async function handleAdminSante(');
  const corps = SRC.slice(debut, debut + 9000);
  assert.match(corps, /cle: 'sauvegarde_nocturne',\s+ok: bilanSauvegarde\.ok,\s+etat: bilanSauvegarde\.etat,\s+consequence:/);
  assert.match(corps, /evaluerSauvegarde\(etatSauv, Date\.now\(\)\)/);
});

/* =====================================================================================================================
 * Relecture independante de la vague 1 (03/10/2026) : correctifs appliques apres revue
 * ===================================================================================================================== */
test('relecture D-01 : une erreur R2 en lisant une fiche de la boutique interrompt la suppression (503), rien n est supprime', async () => {
  const m = mondeCompte();
  const origineGet = m.r2.get.bind(m.r2);
  m.r2.get = async (k) => { if (k === '_market/listings/L3.json') throw new Error('R2 indisponible'); return origineGet(k); };
  const { env, handleMeDelete } = chargerCompte(m);
  globalThis.fetch = async () => new Response('{}', { status: 200 });
  const avant = m.r2.objets.size;
  const r = await handleMeDelete(requeteDelete(), env);
  assert.equal(r.status, 503);
  assert.equal(m.r2.objets.size, avant, 'aucun objet supprime (maillage vendu ou partage compris)');
  assert.equal(m.sb.tables.jobs.length, 6, 'aucune ligne de travaux supprimee');
});

test('relecture D-01 : une fiche de la boutique au JSON corrompu est ignoree (elle ne designe aucun fichier) et la suppression continue', async () => {
  const m = mondeCompte();
  m.r2.poser('_market/listings/LZ.json', '{pas du json');
  const { env, handleMeDelete } = chargerCompte(m);
  globalThis.fetch = async () => new Response('{}', { status: 200 });
  const r = await handleMeDelete(requeteDelete(), env);
  assert.equal(r.status, 200);
  assert.ok(m.r2.objets.has('mesh/j3.glb'), 'le maillage deja vendu reste protege');
  assert.ok(!m.r2.objets.has('mesh/j1.glb'), 'le maillage exclusif est supprime');
});

test('relecture W2-8 : un dossier de corbeille dont le nom n est pas une date est conserve ; un dossier date et ancien est supprime', () => {
  const { decisionRetention: d } = chargerRetention({});
  const ancien = MAINT - 60 * 86400000;
  assert.equal(d('_trash/pas-une-date/f.glb', ancien, MAINT), 'garder');
  assert.equal(d('_trash/2026-08-01/f.glb', ancien, MAINT), 'supprimer');
  assert.equal(d('_trash/2026-09-25/f.glb', ancien, MAINT), 'garder', 'dossier date recent : on prend la date la plus recente');
});

test('relecture W2-3 : une table FACULTATIVE illisible ne bloque pas la sauvegarde ; une table critique illisible la fait echouer', async () => {
  const m = mondeSauvegarde();
  m.sb.tables.vue_perso = lignes(2, 'v');
  const origine = m.sb.from;
  m.sb.from = (nom) => { const b = origine(nom); return nom === 'vue_perso' ? b.fail('permission refusee') : b; };
  const { sauvegardeNocturne } = chargerSauvegarde(m.env, { sb: m.sb });
  const r = await sauvegardeNocturne(m.env, NUIT, { sb: m.sb, tables: [...TABLES, 'vue_perso'] });
  assert.equal(r.statut, 'ok', JSON.stringify(r));
  const man = JSON.parse(m.r2.objets.get('_backup/2026-10-03/manifest.json').corps);
  assert.ok(man.tables.vue_perso.erreur && man.tables.vue_perso.fini, 'la table facultative est notee en erreur dans le manifeste');
  assert.equal(man.tables.jobs.lignes, 2500, 'les tables critiques sont completes');
  // table CRITIQUE illisible : la sauvegarde echoue (compteur d'echecs, alerte)
  const m2 = mondeSauvegarde();
  const o2 = m2.sb.from;
  m2.sb.from = (nom) => { const b = o2(nom); return nom === 'payments' ? b.fail('panne') : b; };
  const { sauvegardeNocturne: s2 } = chargerSauvegarde(m2.env, { sb: m2.sb });
  assert.equal((await s2(m2.env, NUIT, { sb: m2.sb, tables: TABLES })).statut, 'echec');
});

test('relecture W2-3 : tri stable (order id) des 4 tables critiques, et audit recopie pour les 2 derniers jours seulement', async () => {
  const m = mondeSauvegarde();
  m.r2.poser('_meta/admin_audit/2026-09-01.log', 'vieux');
  m.r2.poser('_meta/admin_audit/2026-10-01.log', 'avant-hier');
  m.r2.poser('_meta/admin_audit/2026-10-03.log', 'jour');
  const ordres = [];
  const origine = m.sb.from;
  m.sb.from = (nom) => { const b = origine(nom); const o = b.order; b.order = (c, opt) => { ordres.push(nom + ':' + c); return o(c, opt); }; return b; };
  const { sauvegardeNocturne } = chargerSauvegarde(m.env, { sb: m.sb });
  const r = await sauvegardeNocturne(m.env, NUIT, { sb: m.sb, tables: TABLES });
  assert.equal(r.statut, 'ok', JSON.stringify(r));
  for (const nom of TABLES) assert.ok(ordres.includes(nom + ':id'), 'tri par id pour ' + nom);
  const cles = [...m.r2.objets.keys()];
  assert.ok(!cles.includes('_backup/2026-10-03/r2/_meta/admin_audit/2026-09-01.log'), 'journal d audit ancien non recopie');
  for (const j of ['2026-10-01', '2026-10-02', '2026-10-03']) assert.ok(cles.includes('_backup/2026-10-03/r2/_meta/admin_audit/' + j + '.log'), 'audit du ' + j);
  assert.ok(cles.includes('_backup/2026-10-03/r2/_meta/compta/paiements_anonymes/1.json'), 'la comptabilite est toujours recopiee');
});
