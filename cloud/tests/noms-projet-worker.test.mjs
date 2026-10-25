// Noms de projet NON LATINS ou accentues cote worker (2026-10-13, audit de la langue du 11/10 : SERVEUR-10, CHAMPS-22, INTERFACE-M03).
// Les resultats des outils de maillage sont ranges sous <uid>/mesh-op/<segment du projet>/ ; le segment remplacait tout caractere hors
// [A-Za-z0-9._-] par « _ » : « 兽人战士 » et « 精灵射手 » donnaient tous deux « ____ », et le listing rattachait les deux versions au meme
// projet. Ici : VRAIE ecriture (handleUploadMesh) puis VRAI listing (handleListMeshes) de cloud/src/worker.ts, faux R2 / faux Supabase.
// Lancer : cd cloud && node --test tests/noms-projet-worker.test.mjs
// Ancien code (les tests de correctif doivent ECHOUER) : git show HEAD:cloud/src/worker.ts > <tmp>/worker_HEAD.ts ;
//   WORKER_SRC=<tmp>/worker_HEAD.ts node --test tests/noms-projet-worker.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { chargerFonctions, existe, creerR2, doublesReponses, lireSource } from './_charge-worker.mjs';

const require = createRequire(import.meta.url);
/** Module du bureau (meme regle) : SLUG_PROJET pour viser une autre copie. */
const cheminSlugBureau = process.env.SLUG_PROJET || new URL('../../src/main/slug_projet.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
let bureau = null;
try { bureau = require(cheminSlugBureau); } catch (_) { bureau = null; }

/** Fonctions du correctif : absentes de l'ancien code, ou les tests echouent alors par COMPORTEMENT (pas au chargement). */
const AIDES = ['_TRANSLIT_NOM_PROJET', '_estNomAscii', '_empreinteNomProjet', '_partieLisibleNomProjet', 'slugNonLatin', '_ancienSlugProjet', 'slugProjet', '_tableSegmentsProjets', '_paramsPourHistorique'];
const charger = (noms, doublures = {}) => chargerFonctions([...noms, ...AIDES].filter((n, i, t) => existe(n) && t.indexOf(n) === i), doublures);

/** Paires de l'audit (memes longueurs : meme ancien segment) + temoins. */
const PAIRES = [
  ['chinois', '兽人战士', '精灵射手'],
  ['arabe', 'تنين', 'فارس'],
  ['russe', 'орк', 'дом'],
  ['accents', 'Éléphant', 'Àlèphant'],
  ['japonais', 'ドラゴン', 'ゴブリン'],
  ['hindi', 'ड्रैगन', 'योद्धा'],
  ['accents (audit serveur)', 'Dragon Épique', 'Dragon Èpique'],
];
const ancienSegment = (s) => (s || 'untitled').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'untitled';

/* ───────────── monde : faux R2 partage par l'ecriture et le listing, faux Supabase (table jobs) ───────────── */
function monde(nomsDesProjets) {
  const r2 = creerR2();
  const env = { MESHES: r2, R2_PUBLIC_URL: 'https://r2.example' };
  const jobs = nomsDesProjets.map((nom, i) => ({
    id: `modal_${String(i + 1).padStart(32, '0')}`, asset_type: 'character', mode: 'standard', status: 'succeeded',
    mesh_url: `mesh/modal_${String(i + 1).padStart(32, '0')}.glb`, created_at: `2026-10-0${(i % 8) + 1}T09:00:00Z`,
    project_name: nom, options: {}, type: 'mesh', cost_usd: 0,
  }));
  const chaine = {
    select() { return chaine; }, eq() { return chaine; }, not() { return chaine; }, order() { return chaine; },
    limit() { return Promise.resolve({ data: jobs, error: null }); },
  };
  const w = charger(['handleUploadMesh', 'handleListMeshes'], {
    getSessionUser: async () => ({ id: 'u1', email: 'a@b.c' }),
    err: doublesReponses.err, json: doublesReponses.json,
    isMock: () => false, mock: {},
    supabaseAdmin: () => ({ from: () => chaine }),
    signedR2Url: async (_e, cle) => 'https://r2.example/' + cle,
    r2PathFromPublicUrl: (_e, u) => String(u || '').replace('https://r2.example/', ''),
    _imageSourceSignee: async () => null,
    getPrice: async () => 0, spendCredits: async () => 100, addCredits: async () => 100, logOperation: async () => {},
    console: { log() {}, warn() {}, error() {} },
  });
  /** Enregistre une version (sculpt, peinture...) dans `projet` par la VRAIE route ; rend la cle R2 ecrite. */
  const enregistrer = async (projet, fichier) => {
    const glb = Buffer.from('glTF' + '\u0002\u0000\u0000\u0000' + 'x'.repeat(40), 'latin1').toString('base64');
    const rep = await w.handleUploadMesh(new Request('https://x.example/api/upload-mesh', {
      method: 'POST', body: JSON.stringify({ base64: glb, filename: fichier, projectName: projet }),
    }), env);
    const corps = await rep.json();
    assert.equal(rep.status, 200, 'enregistrement refuse : ' + JSON.stringify(corps));
    return corps.path;
  };
  const lister = async () => (await (await w.handleListMeshes(new Request('https://x.example/api/meshes'), env)).json()).meshes;
  return { w, r2, env, enregistrer, lister };
}

/* ═══════════════ 1. segment de projet ═══════════════ */
test('slugProjet : deux noms non latins ou accentues de meme forme donnent des segments DIFFERENTS, surs et stables', () => {
  const { w } = monde([]);
  assert.equal(typeof w.slugProjet, 'function', 'slugProjet absent du worker');
  for (const [nom, a, b] of PAIRES) {
    const sa = w.slugProjet(a), sb = w.slugProjet(b);
    assert.notEqual(sa, sb, `${nom} : « ${a} » et « ${b} » partagent le segment ${sa}`);
    for (const s of [sa, sb]) assert.match(s, /^[A-Za-z0-9_-]{1,120}$/, `${nom} : segment non sur pour une cle R2 : ${s}`);
    assert.equal(w.slugProjet(a), sa, 'stable');
    assert.equal(w.slugProjet(sa), sa, 'un segment rendu comme nom de projet reste le meme segment (point fixe)');
  }
  assert.match(w.slugProjet('орк'), /^ork-h[0-9a-f]{8}$/, 'cyrillique translittere');
  assert.match(w.slugProjet('Éléphant'), /^Elephant-h[0-9a-f]{8}$/, 'accents retires');
  assert.match(w.slugProjet('兽人战士'), /^project-h[0-9a-f]{8}$/, 'ecriture sans translitteration : empreinte seule');
});

test('slugProjet : un nom ASCII garde EXACTEMENT son segment d avant (aucune cle existante ne change)', () => {
  const { w } = monde([]);
  for (const nom of ['Orc', 'Mobilier design', 'orc_woman', 'v1.2 test', 'Dragon-rouge', "L'orc (v2)", '', 'x'.repeat(200)]) {
    assert.equal(w.slugProjet(nom), ancienSegment(nom), JSON.stringify(nom));
  }
});

/* ═══════════════ 2. ecriture par la vraie route, relecture par le vrai listing ═══════════════ */
for (const [nom, a, b] of PAIRES) {
  test(`${nom} : la version enregistree dans « ${a} » reste dans « ${a} » apres rechargement, celle de « ${b} » dans « ${b} »`, async () => {
    const m = monde([a, b]);
    const cleA = await m.enregistrer(a, 'sculpt_a.glb');
    const cleB = await m.enregistrer(b, 'sculpt_b.glb');
    const versions = await m.lister();
    const rangee = (cle) => versions.find((v) => v.url === 'https://r2.example/' + cle)?.projectName;
    assert.deepEqual([rangee(cleA), rangee(cleB)], [a, b],
      `versions rangees dans [${rangee(cleA)}, ${rangee(cleB)}] (cles ${cleA} / ${cleB})`);
    assert.notEqual(cleA.split('/')[2], cleB.split('/')[2], `meme segment R2 pour deux projets : ${cleA} / ${cleB}`);
  });
}

test('compatibilite : une version ecrite AVANT le correctif (ancien segment « ____ ») reste rattachee a son projet', async () => {
  const m = monde(['兽人战士']);
  const cle = `u1/mesh-op/${ancienSegment('兽人战士')}/1700000000000_smooth.glb`;
  m.r2.ecrire(cle, 'glTF');
  const v = (await m.lister()).find((x) => x.url === 'https://r2.example/' + cle);
  assert.ok(v, 'ancienne cle absente du listing');
  assert.equal(v.projectName, '兽人战士');
});

test('non-regression : un projet existant au nom ASCII ecrit et relit au MEME endroit qu avant', async () => {
  const m = monde(['Mobilier design', 'Orc']);
  const cle = await m.enregistrer('Mobilier design', 'sculpt.glb');
  assert.match(cle, /^u1\/mesh-op\/Mobilier_design\/sculpt_\d+\.glb$/, 'segment ASCII inchange');
  const ancienne = 'u1/mesh-op/Orc/1700000000000_decimate.glb';
  m.r2.ecrire(ancienne, 'glTF');
  const versions = await m.lister();
  assert.equal(versions.find((v) => v.url === 'https://r2.example/' + cle)?.projectName, 'Mobilier design');
  assert.equal(versions.find((v) => v.url === 'https://r2.example/' + ancienne)?.projectName, 'Orc');
});

/* ═══════════════ 3. toutes les routes qui ecrivent un segment de projet passent par slugProjet ═══════════════ */
test('aucune route n assainit encore un nom de projet par l ancienne regle (segment de cle R2)', () => {
  const src = lireSource();
  // un nom de projet suivi (meme sur la ligne suivante) d'un remplacement [^A-Za-z0-9._-] -> « _ »
  const restes = [...src.matchAll(/(projectName|project_name|nomProjet)[^;]{0,160}?\.replace\(\/\[\^A-Za-z0-9\._-\]\/g/g)]
    .map((m) => `${src.slice(0, m.index).split('\n').length}: ${m[0].replace(/\s+/g, ' ').slice(0, 140)}`);
  assert.deepEqual(restes, [], 'segments de projet encore assainis en « _ »');
  const ecritures = (src.match(/\/(mesh-op|animations)\/\$\{(projectSlug|segmentProjet|projet|slugProjet\([^}]*\))\}\//g) || []).length;
  assert.ok(ecritures >= 9, 'cles mesh-op / animations par projet : ' + ecritures);
});

/* ═══════════════ 4. meme regle que le bureau (src/main/slug_projet.js) ═══════════════ */
test('parite bureau / worker : meme segment pour tout nom non latin ou accentue, meme partage ASCII / non ASCII', () => {
  const { w } = monde([]);
  assert.ok(bureau, 'module du bureau introuvable : ' + cheminSlugBureau);
  assert.equal(typeof w.slugNonLatin, 'function', 'slugNonLatin absent du worker');
  const corpus = [...PAIRES.flatMap(([, a, b]) => [a, b]), 'Épée magique', 'Château fort', 'Straße', 'Ærøskøbing', 'Дракон ёжик', 'Αθηνά',
    '🐉', 'Ｏｒｃ', 'café 2', 'تنين احمر', '용사', 'mixte Orc 兽人', 'x'.repeat(30) + 'é' + 'y'.repeat(30), ' espaces é ', 'éclair'];
  for (const nom of corpus) {
    assert.equal(w.slugNonLatin(nom), bureau.slugNonLatin(nom), JSON.stringify(nom));
    assert.equal(w.slugProjet(nom), bureau.slugProjet(nom), 'slugProjet ' + JSON.stringify(nom));
  }
  for (const nom of ['Orc', 'orc_woman', 'Mobilier-design', 'abc123']) {
    assert.equal(w.slugProjet(nom), bureau.slugProjet(nom), 'nom deja sur : identique des deux cotes ' + nom);
  }
  // forme NFC et forme decomposee d un meme nom : meme projet visuel, meme segment
  assert.equal(w.slugNonLatin('e\u0301clair'), w.slugNonLatin('\u00e9clair'));
});

/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 5. revue du lot 3 : ordre du rattachement, et les deux autres routes d'ecriture citees par l'audit \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */
const silence = { log() {}, warn() {}, error() {} };

test('rattachement : le segment de la regle ACTUELLE passe avant l ANCIEN segment d un autre nom (\u00ab Ch_teau \u00bb / \u00ab Ch\u00e2teau \u00bb)', async () => {
  // \u00ab Ch\u00e2teau \u00bb est liste APRES \u00ab Ch_teau \u00bb : pour l'ancien segment \u00ab Ch_teau \u00bb (commun aux deux), la table garderait \u00ab Ch\u00e2teau \u00bb.
  const m = monde(['Ch_teau', 'Ch\u00e2teau']);
  const t = m.w._tableSegmentsProjets(['Ch_teau', 'Ch\u00e2teau']);
  assert.equal(t('Ch_teau'), 'Ch_teau', 'segment actuel du nom ASCII \u00ab Ch_teau \u00bb');
  assert.equal(t(m.w.slugProjet('Ch\u00e2teau')), 'Ch\u00e2teau', 'segment actuel de \u00ab Ch\u00e2teau \u00bb');
  const cle = await m.enregistrer('Ch_teau', 'sculpt.glb');
  const v = (await m.lister()).find((x) => x.url === 'https://r2.example/' + cle);
  assert.equal(v && v.projectName, 'Ch_teau', 'version de \u00ab Ch_teau \u00bb rangee dans \u00ab Ch\u00e2teau \u00bb');
});

test('handleMeshOp (outils de maillage) : chaque version est rangee sous le segment de SON projet, puis relue dans ce projet', async () => {
  const m = monde(['\u517d\u4eba\u6218\u58eb', '\u7cbe\u7075\u5c04\u624b', 'Mobilier design']);
  const env = { ...m.env, MODAL_MESH_START_URL: 'https://modal.example/mesh_start', MODAL_SHARED_SECRET: 's' };
  const op = charger(['handleMeshOp'], {
    getSessionUser: async () => ({ id: 'u1', email: 'a@b.c' }), err: doublesReponses.err, json: doublesReponses.json,
    isTrustedAssetHost: () => true, supabaseAdmin: () => { throw new Error('non utilise'); },
    getPrice: async () => 1, checkAndIncrementModalSpend: async () => 1, checkAndIncrementUserCalls: async () => 1,
    spendCredits: async () => 10, addCredits: async () => 10, refundModalSpend: async () => {}, _spendRefusalMessage: async () => 'refus',
    fetch: async () => new Response(JSON.stringify({ glb_base64: Buffer.from('glTF version').toString('base64'), stats: {} })),
    _urlPutR2Signee: async () => null,   // 25/10 : pas de cles S3 dans le test -> repli base64
    signedR2Url: async (_e, cle) => 'https://r2.example/' + cle, logOperation: async () => {}, console: silence,
  });
  const segments = {};
  for (const projet of ['\u517d\u4eba\u6218\u58eb', '\u7cbe\u7075\u5c04\u624b', 'Mobilier design']) {
    const rep = await op.handleMeshOp(new Request('https://x.example/api/mesh-op', { method: 'POST',
      body: JSON.stringify({ meshUrl: 'https://r2.example/u1/a.glb', opType: 'smooth', projectName: projet }) }), env);
    const corps = await rep.json();
    assert.equal(rep.status, 200, JSON.stringify(corps));
    segments[projet] = corps.path.replace('https://r2.example/', '');
  }
  assert.equal(segments['\u517d\u4eba\u6218\u58eb'].split('/')[2], m.w.slugProjet('\u517d\u4eba\u6218\u58eb'));
  assert.equal(segments['\u7cbe\u7075\u5c04\u624b'].split('/')[2], m.w.slugProjet('\u7cbe\u7075\u5c04\u624b'));
  assert.equal(segments['Mobilier design'].split('/')[2], 'Mobilier_design', 'nom ASCII : segment d avant');
  const versions = await m.lister();
  const rangee = (cle) => versions.find((v) => v.url === 'https://r2.example/' + cle)?.projectName;
  assert.deepEqual(Object.keys(segments).map((p) => rangee(segments[p])), ['\u517d\u4eba\u6218\u58eb', '\u7cbe\u7075\u5c04\u624b', 'Mobilier design'],
    'versions relues dans : ' + Object.keys(segments).map((p) => rangee(segments[p])).join(', '));
});

test('handleAnimCopy (copie d un clip) : rangee sous animations/<segment de SON projet>/, distinct pour \u00ab \u517d\u4eba\u6218\u58eb \u00bb et \u00ab \u7cbe\u7075\u5c04\u624b \u00bb', async () => {
  const uid = 'u1';
  const source = `${uid}/animations/rig_idle_b1_1700000000000.glb`;
  const r2 = creerR2({ [source]: 'glTF' + 'x'.repeat(100) });
  const COMMUN = ['err', 'json', 'SECURITY_HEADERS', 'isMock', '_plafond', '_attenteBruitee', '_casIncrementCounter', '_incrementAtomique', 'r2GetText', 'todayUTC', '_isoNow'];
  const w = charger([...COMMUN, 'ANIM_COPY_MAX_PAR_JOUR_DEFAUT', 'ANIM_COPY_MAX_OCTETS_PAR_JOUR_DEFAUT', 'handleAnimCopy'],
    { getSessionUser: async () => ({ id: uid }), siteUrl: () => 'https://site.example', signedR2Url: async (_e, k) => 'https://r2.example/' + k });
  const env = { MESHES: r2, R2_PUBLIC_URL: 'https://r2.example' };
  const segments = {};
  for (const projet of ['\u517d\u4eba\u6218\u58eb', '\u7cbe\u7075\u5c04\u624b', 'Mobilier design']) {
    const rep = await w.handleAnimCopy(new Request('https://site.example/api/animations/copy', { method: 'POST',
      body: JSON.stringify({ sourceUrl: source, animType: 'idle', projectName: projet }) }), env);
    const corps = await rep.json();
    assert.equal(rep.status, 200, JSON.stringify(corps));
    segments[projet] = corps.key.split('/')[2];
  }
  assert.equal(segments['\u517d\u4eba\u6218\u58eb'], w.slugProjet('\u517d\u4eba\u6218\u58eb'));
  assert.equal(segments['\u7cbe\u7075\u5c04\u624b'], w.slugProjet('\u7cbe\u7075\u5c04\u624b'));
  assert.notEqual(segments['\u517d\u4eba\u6218\u58eb'], segments['\u7cbe\u7075\u5c04\u624b'], 'meme segment pour deux projets');
  assert.equal(segments['Mobilier design'], 'Mobilier_design', 'nom ASCII : segment d avant');
});
