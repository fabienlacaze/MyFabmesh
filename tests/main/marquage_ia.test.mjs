// Test du marquage « genere par IA » des GLB (AI Act, reglement UE 2024/1689 art. 50) — constat du 2026-10-03 :
// les fichiers DERIVES (outils de maillage, editeur, Paint Mesh, rig) perdaient asset.extras.aiGenerated.
// Charge le VRAI module src/main/marquage_ia.js (sans Electron, sans reseau) sur des GLB synthetiques, verifie :
//   - le marquage (generator + trois cles extras) et l'IDEMPOTENCE (fichier deja marque : aucun octet reecrit) ;
//   - la preservation EXACTE du chunk binaire (octet pour octet) et la coherence de l'en-tete GLB ;
//   - qu'un fichier tronque / invalide / incoherent reste INTACT et ne laisse aucun fichier temporaire ;
//   - un GLB de 150 Mo marque sans depasser ~50 Mo de memoire supplementaire (processus fils, pic RSS) ;
//   - la table des canaux IPC (quels resultats declenchent le marquage, lesquels l'ecartent) ;
//   - le CABLAGE reel dans src/main/main.js (le bloc qui enveloppe ipcMain.handle est extrait et execute) ;
//   - (si presents) des copies des vrais fichiers meshes/verif_t80* : JSON identique hors `asset`, binaire identique.
// Lancer :  node --test tests/main/marquage_ia.test.mjs
// Contre l'ancien code : MARQUAGE_IA_JS=<chemin>  MAIN_JS=<chemin>  (l'ancien depot n'a pas le module : le test echoue).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, '..', '..');
const CHEMIN_MODULE = process.env.MARQUAGE_IA_JS || path.join(RACINE, 'src', 'main', 'marquage_ia.js');
const CHEMIN_MAIN = process.env.MAIN_JS || path.join(RACINE, 'src', 'main', 'main.js');
const { marquerGlbIA, cheminsGlbDeSortie, envelopper } = require(CHEMIN_MODULE);

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'marquage_ia_'));
process.on('exit', () => { try { fs.rmSync(dossier, { recursive: true, force: true }); } catch (_) {} });
let n = 0;
const nouveau = (nom = 'm') => path.join(dossier, `${nom}_${++n}.glb`);

// ── Fabrique d'un GLB : en-tete + chunk JSON (rempli par `pad` octets) + chunk binaire (+ chunk supplementaire).
function fabriquerGlb(json, bin, { pad = ' ', chunkSupp = null } = {}) {
  let j = Buffer.from(typeof json === 'string' ? json : JSON.stringify(json), 'utf8');
  const r = (4 - (j.length % 4)) % 4;
  if (r) j = Buffer.concat([j, Buffer.alloc(r, pad === ' ' ? 0x20 : 0x00)]);
  const morceaux = [];
  const entete = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.write(type, 4, 'latin1'); return b; };
  morceaux.push(entete(j.length, 'JSON'), j);
  if (bin) morceaux.push(entete(bin.length, 'BIN\0'), bin);
  if (chunkSupp) morceaux.push(entete(chunkSupp.length, 'XTRA'), chunkSupp);
  const corps = Buffer.concat(morceaux);
  const tete = Buffer.alloc(12);
  tete.write('glTF', 0, 'latin1'); tete.writeUInt32LE(2, 4); tete.writeUInt32LE(12 + corps.length, 8);
  return Buffer.concat([tete, corps]);
}
function lire(chemin) {
  const d = fs.readFileSync(chemin);
  const jl = d.readUInt32LE(12);
  return { d, total: d.readUInt32LE(8), jl, json: JSON.parse(d.toString('utf8', 20, 20 + jl)), reste: d.subarray(20 + jl) };
}
const binTest = () => { const b = Buffer.alloc(1000); for (let i = 0; i < b.length; i++) b[i] = (i * 31 + 7) & 255; return b; };
const autreOutil = () => ({ asset: { version: '2.0', generator: 'https://github.com/mikedh/trimesh' }, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], buffers: [{ byteLength: 1000 }] });

test('marque un GLB issu d\'un autre outil : generator + trois cles extras', () => {
  const p = nouveau();
  fs.writeFileSync(p, fabriquerGlb(autreOutil(), binTest()));
  const r = marquerGlbIA(p);
  assert.deepEqual(r, { ok: true, deja: false, raison: '' });
  const { json } = lire(p);
  assert.match(json.asset.generator, /^FabMesh \S+ \(AI-generated\)$/);
  assert.equal(json.asset.extras.aiGenerated, true);
  assert.equal(json.asset.extras.aiSystem, 'FabMesh');
  assert.equal(json.asset.extras.aiActArticle50, true);
  assert.equal(json.asset.version, '2.0');          // le reste du JSON est conserve
  assert.deepEqual(json.scenes, [{ nodes: [0] }]);
});

test('le chunk binaire est preserve octet pour octet ; en-tete et alignement coherents ; chunk suivant conserve', () => {
  const bin = binTest(); const supp = Buffer.from('chunk-supplementaire-ABCD', 'latin1');
  const p = nouveau();
  const original = fabriquerGlb(autreOutil(), bin, { chunkSupp: supp });
  fs.writeFileSync(p, original);
  const ancienReste = lire(p).reste;
  assert.equal(marquerGlbIA(p).ok, true);
  const { d, total, jl, reste } = lire(p);
  assert.equal(total, d.length, 'longueur totale de l\'en-tete = taille du fichier');
  assert.equal(jl % 4, 0, 'chunk JSON aligne sur 4 octets');
  assert.equal(d.toString('latin1', 16, 20), 'JSON');
  assert.ok(Buffer.compare(reste, ancienReste) === 0, 'tout ce qui suit le chunk JSON est identique octet pour octet');
  assert.ok(d.includes(bin) && d.includes(supp));
});

test('tous les remplissages (longueur JSON modulo 4) et JSON deja rempli par des zeros', () => {
  for (let extra = 0; extra < 4; extra++) {
    for (const pad of [' ', '\0']) {
      const j = autreOutil(); j.asset.commentaire = 'x'.repeat(extra);
      const p = nouveau('pad');
      fs.writeFileSync(p, fabriquerGlb(JSON.stringify(j), binTest(), { pad }));
      const r = marquerGlbIA(p);
      assert.equal(r.ok, true, `extra=${extra} pad=${JSON.stringify(pad)} : ${r.raison}`);
      const { total, d, jl, json } = lire(p);
      assert.equal(total, d.length); assert.equal(jl % 4, 0);
      assert.equal(json.asset.extras.aiGenerated, true);
    }
  }
});

test('idempotent : un fichier deja marque n\'est pas reecrit (aucun octet, date inchangee)', async () => {
  const p = nouveau();
  fs.writeFileSync(p, fabriquerGlb(autreOutil(), binTest()));
  assert.equal(marquerGlbIA(p).deja, false);
  const avant = fs.readFileSync(p); const m1 = fs.statSync(p).mtimeMs;
  await new Promise((r) => setTimeout(r, 30));
  const r2 = marquerGlbIA(p);
  assert.deepEqual(r2, { ok: true, deja: true, raison: '' });
  assert.ok(Buffer.compare(avant, fs.readFileSync(p)) === 0);
  assert.equal(fs.statSync(p).mtimeMs, m1);
  assert.deepEqual(fs.readdirSync(dossier).filter((f) => f.endsWith('.marquage-ia.tmp')), []);
});

test('un GLB deja marque par la generation (meme valeurs que le Python) est reconnu', () => {
  const j = autreOutil();
  j.asset.generator = 'FabMesh 1.0.0 (AI-generated)';
  j.asset.extras = { aiGenerated: true, aiSystem: 'FabMesh', aiActArticle50: true };
  const p = nouveau(); fs.writeFileSync(p, fabriquerGlb(j, binTest()));
  assert.equal(marquerGlbIA(p).deja, true);
});

test('asset absent, extras non objet, extras deja renseignes par un autre outil', () => {
  const sans = { scenes: [], buffers: [{ byteLength: 1000 }] };
  const p1 = nouveau(); fs.writeFileSync(p1, fabriquerGlb(sans, binTest()));
  assert.equal(marquerGlbIA(p1).ok, true);
  assert.equal(lire(p1).json.asset.extras.aiGenerated, true);
  const j2 = autreOutil(); j2.asset.extras = 'texte';
  const p2 = nouveau(); fs.writeFileSync(p2, fabriquerGlb(j2, binTest()));
  assert.equal(marquerGlbIA(p2).ok, true);
  assert.equal(lire(p2).json.asset.extras.aiSystem, 'FabMesh');
  const j3 = autreOutil(); j3.asset.extras = { auteur: 'moi' };
  const p3 = nouveau(); fs.writeFileSync(p3, fabriquerGlb(j3, binTest()));
  assert.equal(marquerGlbIA(p3).ok, true);
  const e = lire(p3).json.asset.extras;
  assert.equal(e.auteur, 'moi'); assert.equal(e.aiGenerated, true);   // les cles des autres sont gardees
});

test('fichiers invalides : laisses INTACTS, aucun temporaire, jamais d\'exception', () => {
  const bon = fabriquerGlb(autreOutil(), binTest());
  const cas = {
    'tronque en plein binaire': bon.subarray(0, bon.length - 200),
    'tronque dans le JSON': bon.subarray(0, 60),
    'plus court que l\'en-tete': Buffer.from('glTF'),
    'vide': Buffer.alloc(0),
    'mauvais magic': Buffer.concat([Buffer.from('XXXX'), bon.subarray(4)]),
    'version 1': (() => { const b = Buffer.from(bon); b.writeUInt32LE(1, 4); return b; })(),
    'longueur d\'en-tete fausse': (() => { const b = Buffer.from(bon); b.writeUInt32LE(b.length + 9, 8); return b; })(),
    'premier chunk pas JSON': (() => { const b = Buffer.from(bon); b.write('BIN\0', 16, 'latin1'); return b; })(),
    'chunk JSON deborde': (() => { const b = Buffer.from(bon); b.writeUInt32LE(b.length * 2, 12); return b; })(),
    'JSON illisible': fabriquerGlb('{"asset": {', binTest()),
    'racine JSON = liste': fabriquerGlb('[1,2,3]', binTest()),
  };
  for (const [nom, contenu] of Object.entries(cas)) {
    const p = nouveau('inv'); fs.writeFileSync(p, contenu);
    let r;
    assert.doesNotThrow(() => { r = marquerGlbIA(p); }, nom);
    assert.equal(r.ok, false, nom); assert.equal(r.deja, false, nom); assert.ok(r.raison, nom);
    assert.ok(Buffer.compare(fs.readFileSync(p), contenu) === 0, `${nom} : fichier modifie`);
  }
  assert.deepEqual(fs.readdirSync(dossier).filter((f) => f.endsWith('.marquage-ia.tmp')), []);
  for (const mauvais of [path.join(dossier, 'absent.glb'), '', null, undefined, 42, path.join(dossier, 'x.fbx'), path.join(dossier, 'x.obj'), path.join(dossier, 'x.stl')]) {
    let r; assert.doesNotThrow(() => { r = marquerGlbIA(mauvais); });
    assert.equal(r.ok, false);
  }
});

test('un FBX / OBJ / STL n\'est jamais touche (format sans champ extras)', () => {
  for (const ext of ['fbx', 'obj', 'stl']) {
    const p = path.join(dossier, `modele.${ext}`); const c = fabriquerGlb(autreOutil(), binTest());
    fs.writeFileSync(p, c);
    assert.equal(marquerGlbIA(p).ok, false);
    assert.ok(Buffer.compare(fs.readFileSync(p), c) === 0);
  }
});

test('GLB de 150 Mo : marque sans charger le fichier (memoire supplementaire < 50 Mo, pic RSS du processus fils)', () => {
  const p = nouveau('gros');
  const j = Buffer.from(JSON.stringify({ ...autreOutil(), buffers: [{ byteLength: 150 * 1024 * 1024 }] }), 'utf8');
  const jp = Buffer.concat([j, Buffer.alloc((4 - (j.length % 4)) % 4, 0x20)]);
  const taille = 150 * 1024 * 1024;
  const fd = fs.openSync(p, 'w');
  const tete = Buffer.alloc(20); tete.write('glTF', 0, 'latin1'); tete.writeUInt32LE(2, 4);
  tete.writeUInt32LE(12 + 8 + jp.length + 8 + taille, 8); tete.writeUInt32LE(jp.length, 12); tete.write('JSON', 16, 'latin1');
  fs.writeSync(fd, tete); fs.writeSync(fd, jp);
  const enteteBin = Buffer.alloc(8); enteteBin.writeUInt32LE(taille, 0); enteteBin.write('BIN\0', 4, 'latin1');
  fs.writeSync(fd, enteteBin);
  const bloc = Buffer.alloc(8 * 1024 * 1024);
  for (let i = 0; i < bloc.length; i++) bloc[i] = (i * 13 + 5) & 255;
  for (let ecrit = 0; ecrit < taille; ecrit += bloc.length) fs.writeSync(fd, bloc, 0, Math.min(bloc.length, taille - ecrit));
  fs.closeSync(fd);
  const avantTaille = fs.statSync(p).size;
  const script = `
    const { marquerGlbIA } = require(${JSON.stringify(CHEMIN_MODULE)});
    const avant = process.resourceUsage().maxRSS;      // Ko
    const t0 = Date.now();
    const r = marquerGlbIA(${JSON.stringify(p)});
    const apres = process.resourceUsage().maxRSS;
    console.log(JSON.stringify({ r, deltaMo: (apres - avant) / 1024, ms: Date.now() - t0 }));`;
  const sortie = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 120000 });
  assert.equal(sortie.status, 0, sortie.stderr);
  const res = JSON.parse(sortie.stdout.trim().split('\n').pop());
  assert.equal(res.r.ok, true, JSON.stringify(res.r));
  assert.ok(res.deltaMo < 50, `memoire supplementaire ${res.deltaMo.toFixed(1)} Mo (limite 50)`);
  const apres = fs.statSync(p).size;
  assert.ok(apres > avantTaille && apres - avantTaille < 400, 'seul le JSON a grandi');
  const d = fs.openSync(p, 'r'); const b = Buffer.alloc(20); fs.readSync(d, b, 0, 20, 0);
  assert.equal(b.readUInt32LE(8), apres);
  // dernier octet et un octet du milieu du binaire identiques a ceux ecrits
  const fin = Buffer.alloc(1); fs.readSync(d, fin, 0, 1, apres - 1); fs.closeSync(d);
  assert.equal(fin[0], bloc[(taille - 1) % bloc.length]);
  fs.unlinkSync(p);
});

// ── Table des canaux IPC
test('canaux : le resultat nomme le .glb final ; echec, FBX et animation importee sont ecartes', () => {
  assert.deepEqual(cheminsGlbDeSortie('mesh-tool', { success: true, newPath: 'C:/m/a_smooth_1.glb' }), ['C:/m/a_smooth_1.glb']);
  assert.deepEqual(cheminsGlbDeSortie('mesh-tool', { success: false, error: 'x', newPath: 'C:/m/a.glb' }), []);
  assert.deepEqual(cheminsGlbDeSortie('mesh:region-retex', { ok: true, path: 'C:/m/a_retex_1.glb' }), ['C:/m/a_retex_1.glb']);
  assert.deepEqual(cheminsGlbDeSortie('mesh:align-texture', { ok: true, meshPath: 'C:/m/a.glb' }), ['C:/m/a.glb']);
  assert.deepEqual(cheminsGlbDeSortie('auto-rig-ai', { success: true, path: 'C:/m/a_rigged_skintokens_1.glb', filename: 'a.glb' }), ['C:/m/a_rigged_skintokens_1.glb']);
  assert.deepEqual(cheminsGlbDeSortie('run-blender-script', { meshPath: 'C:/m/b.glb', format: 'glb' }), ['C:/m/b.glb']);
  assert.deepEqual(cheminsGlbDeSortie('anim:retarget', { success: true, jobId: 'j', glbPath: 'C:/m/animated/x__r.glb' }), ['C:/m/animated/x__r.glb']);
  assert.deepEqual(cheminsGlbDeSortie('generate-construction-stages-3d', { success: true, versionMeshPath: 'C:/m/v.glb', stages: [{ path: 'C:/m/s0.glb' }, { path: 'C:/m/s1.glb' }] }),
    ['C:/m/v.glb', 'C:/m/s0.glb', 'C:/m/s1.glb']);
  assert.deepEqual(cheminsGlbDeSortie('generate-build-stages', { success: true, stages: [{ meshPath: 'C:/m/s.glb' }, { success: false, error: 'x' }] }), ['C:/m/s.glb']);
  assert.deepEqual(cheminsGlbDeSortie('mesh-tool', { success: true, newPath: 'C:/m/a.fbx' }), [], 'FBX non marque');
  assert.deepEqual(cheminsGlbDeSortie('mesh-segment', { success: true, newPath: 'C:/m/a.obj' }), []);
  assert.deepEqual(cheminsGlbDeSortie('save-buffer', { success: true, path: 'C:/m/a_edited_1.glb' }), ['C:/m/a_edited_1.glb']);
  assert.deepEqual(cheminsGlbDeSortie('save-buffer', { success: true, path: 'C:/m/animated/walk_imported_17__rig.glb' }), [], 'animation importee par l\'utilisateur : non marquee');
  assert.deepEqual(cheminsGlbDeSortie('save-buffer', { success: true, path: 'C:/img/photo.png' }), []);
  assert.deepEqual(cheminsGlbDeSortie('import-mesh', { success: true, path: 'C:/m/a.glb' }), [], 'canal hors liste (import utilisateur)');
  assert.deepEqual(cheminsGlbDeSortie('export-mesh', { path: 'C:/m/a.glb' }), [], 'export = copie conforme de la source');
  assert.deepEqual(cheminsGlbDeSortie('mesh-tool', null), []);
});

test('envelopper : canal hors liste rendu INCHANGE ; le resultat et les erreurs du gestionnaire ne sont pas alteres', async () => {
  const f = () => 1;
  assert.equal(envelopper('get-config', f), f);
  const p = nouveau('canal'); fs.writeFileSync(p, fabriquerGlb(autreOutil(), binTest()));
  const res = { success: true, newPath: p, extra: 'x' };
  const journal = [];
  const g = envelopper('mesh-tool', async () => res, (c, ch, r) => journal.push([c, ch, r.ok]));
  assert.equal(await g({}, {}), res, 'meme objet rendu');
  assert.equal(lire(p).json.asset.extras.aiGenerated, true);
  assert.deepEqual(journal, [['mesh-tool', p, true]]);
  const boum = envelopper('mesh-tool', () => { throw new Error('echec outil'); });
  await assert.rejects(async () => boum({}, {}), /echec outil/);
  const casse = envelopper('mesh-tool', async () => ({ success: true, newPath: path.join(dossier, 'absent.glb') }), () => { throw new Error('journal casse'); });
  assert.equal((await casse({}, {})).success, true, 'un journal ou un marquage en echec ne casse jamais l\'operation');
});

// ── Cablage reel dans main.js : on extrait le bloc qui enveloppe ipcMain.handle et on l'execute tel quel.
test('main.js : les gestionnaires de maillage sont reellement enveloppes (bloc extrait et execute)', async () => {
  const src = fs.readFileSync(CHEMIN_MAIN, 'utf8').replace(/\r\n/g, '\n');
  const d = src.indexOf("const _marquageIA = require('./marquage_ia');");
  const f = src.indexOf('// Force UTF-8 in EVERY spawned Python child');
  assert.ok(d > 0 && f > d, 'le require de marquage_ia et le bloc ipcMain.handle doivent exister dans main.js');
  const bloc = src.slice(d, f);
  const enregistres = new Map();
  const ipcMain = { handle: (canal, fn) => { enregistres.set(canal, fn); } };
  const journalLogs = [];
  const exige = (m) => (m.startsWith('./') ? require(path.join(RACINE, 'src', 'main', m)) : require(m));
  new Function('require', 'ipcMain', 'fs', 'writeMeta', '_log', bloc)(exige, ipcMain, fs, () => {}, (...a) => journalLogs.push(a.join(' ')));

  // Un gestionnaire « mesh-tool » qui ecrit un GLB sans marquage (comme trimesh) puis rend { success, newPath }.
  const sortie = nouveau('mesh_tool');
  ipcMain.handle('mesh-tool', async () => { fs.writeFileSync(sortie, fabriquerGlb(autreOutil(), binTest())); return { success: true, newPath: sortie }; });
  const r = await enregistres.get('mesh-tool')({}, { operation: 'smooth' });
  assert.equal(r.success, true);
  assert.equal(lire(sortie).json.asset.extras.aiGenerated, true, 'le GLB livre par mesh-tool doit etre marque');
  assert.ok(journalLogs.some((l) => l.includes('GLB marque')));

  // save-buffer : le renderer envoie le GLB (editeur, Paint Mesh).
  const edite = nouveau('edited');
  ipcMain.handle('save-buffer', async (_e, { path: p }) => { fs.writeFileSync(p, fabriquerGlb({ asset: { version: '2.0', generator: 'THREE.GLTFExporter r170' } }, binTest())); return { success: true, path: p }; });
  await enregistres.get('save-buffer')({}, { path: edite });
  assert.equal(lire(edite).json.asset.extras.aiGenerated, true);

  // un canal etranger n'est pas touche
  const autre = nouveau('autre');
  ipcMain.handle('export-image', async () => { fs.writeFileSync(autre, fabriquerGlb(autreOutil(), binTest())); return { success: true, path: autre }; });
  await enregistres.get('export-image')({}, {});
  assert.equal(lire(autre).json.asset.extras, undefined);
});

test('main.js : le rig MCP (handleAutoRigAI) marque son GLB avant de repondre', () => {
  const src = fs.readFileSync(CHEMIN_MAIN, 'utf8').replace(/\r\n/g, '\n');
  const i = src.indexOf('async function handleAutoRigAI');
  const j = src.indexOf("safeSend('mcp-job-end', { type: 'rig', success: true, path: outputGlb });", i);
  assert.ok(i > 0 && j > i);
  assert.ok(src.slice(i, j).includes('marquerGlbIA(outputGlb)'), 'le GLB riggé MCP doit etre marque');
});

// ── Vrais fichiers de l'appli (ignores par git) : COPIES uniquement, jamais les originaux.
const REEL = path.join(RACINE, 'meshes');
const vrais = fs.existsSync(REEL) ? fs.readdirSync(REEL).filter((f) => /^verif_t80_trellis2_native_1791025300001.*\.glb$/.test(f)) : [];
for (const nom of vrais) {
  test(`vrai fichier ${nom.slice(-48)} : JSON identique hors asset, binaire identique, trois cles presentes`, () => {
    const copie = nouveau('reel'); fs.copyFileSync(path.join(REEL, nom), copie);
    const avant = lire(copie);
    const r = marquerGlbIA(copie);
    assert.equal(r.ok, true, r.raison);
    const apres = lire(copie);
    assert.ok(Buffer.compare(apres.reste, avant.reste) === 0, 'chunks binaires identiques');
    const { asset: a1, ...reste1 } = avant.json; const { asset: a2, ...reste2 } = apres.json;
    assert.deepEqual(reste2, reste1, 'JSON identique hors asset');
    assert.equal(a2.version, a1.version);
    assert.equal(a2.extras.aiGenerated, true); assert.equal(a2.extras.aiSystem, 'FabMesh'); assert.equal(a2.extras.aiActArticle50, true);
    assert.equal(apres.total, apres.d.length);
    fs.unlinkSync(copie);
  });
}
