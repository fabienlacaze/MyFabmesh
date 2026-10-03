// Tests du processus principal (voie « bureau-main », 2026-10-03).
//   node --test tests/main/durcissement.test.mjs
//   MAIN_JS=<chemin d'un ancien main.js> node --test tests/main/durcissement.test.mjs   (rejoue les memes tests contre l'ancien code)
//
// Aucun appel reseau. Les gestionnaires IPC sont extraits du TEXTE de main.js (impossible de charger main.js sans Electron)
// et executes dans un bac a sable (dossier temporaire) avec des doublures pour ipcMain, log, loadConfig...
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ici = path.dirname(fileURLToPath(import.meta.url));
const racineDepot = path.resolve(ici, '..', '..');
const D = require('../../src/main/durcissement.js');
const MAIN_JS = process.env.MAIN_JS || path.join(racineDepot, 'src', 'main', 'main.js');
const texteMain = fs.readFileSync(MAIN_JS, 'utf-8').replace(/\r\n/g, '\n');
const ANCIEN = !texteMain.includes("require('./durcissement')");   // vrai quand on rejoue contre l'ancien main.js

// ---------------------------------------------------------------- extraction ----
function bloc(debut, fin = '\n});\n') {
  const i = texteMain.indexOf(debut);
  assert.ok(i >= 0, 'ancre introuvable dans main.js : ' + debut);
  const j = texteMain.indexOf(fin, i);
  assert.ok(j >= 0, 'fin introuvable pour : ' + debut);
  return texteMain.slice(i, j + fin.length);
}
function fonction(nom) {   // « function nom(...) { ... } » jusqu'a l'accolade fermante en colonne 0
  return bloc('function ' + nom + '(', '\n}\n');
}

function bacASable() {
  const racine = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fm-durc-')));
  const dirs = { MESHES_DIR: path.join(racine, 'data', 'meshes'), IMAGES_DIR: path.join(racine, 'data', 'images'),
    HISTORY_DIR: path.join(racine, 'data', 'history'), SCRIPTS_DIR: path.join(racine, 'data', 'scripts') };
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  return { racine, ...dirs };
}

function chargerGestionnaires(bac, extra = {}) {
  const gestionnaires = new Map();
  const ipcMain = { handle: (nom, fn) => gestionnaires.set(nom, fn) };
  const journal = { warn() {}, info() {}, error() {} };
  const code = [
    fonction('isPathAllowed'),
    bloc("ipcMain.handle('delete-mesh',"),
    bloc("ipcMain.handle('get-mesh-path',"),
    bloc("ipcMain.handle('delete-image-folder',"),
    bloc("ipcMain.handle('delete-project',"),
  ].join('\n');
  const noms = ['ipcMain', 'path', 'fs', 'log', 'cheminAutorise', 'MESHES_DIR', 'IMAGES_DIR', 'HISTORY_DIR', 'SCRIPTS_DIR',
    'loadVersions', 'saveVersions', '_cheminProjetVide', '_meshProjectBackend'];
  const valeurs = [ipcMain, path, fs, journal, D.cheminAutorise, bac.MESHES_DIR, bac.IMAGES_DIR, bac.HISTORY_DIR, bac.SCRIPTS_DIR,
    () => ({ versions: [] }), () => {}, () => path.join(bac.racine, 'inexistant.marqueur'), () => '__aucun__'];
  new Function(...noms, code)(...valeurs);
  return { gestionnaires, ...extra };
}

// ---------------------------------------------------------------- cheminAutorise ----
test('cheminAutorise : chemins legitimes, racine, traversee, voisin au prefixe commun', () => {
  const b = bacASable();
  const R = [b.MESHES_DIR];
  assert.equal(D.cheminAutorise(path.join(b.MESHES_DIR, 'a.glb'), R), true);
  assert.equal(D.cheminAutorise(path.join(b.MESHES_DIR, 'sous', 'x', 'a.glb'), R), true, 'fichier inexistant dans un sous-dossier inexistant');
  assert.equal(D.cheminAutorise(b.MESHES_DIR, R), true, 'la racine elle-meme');
  assert.equal(D.cheminAutorise(b.MESHES_DIR, R, { sansRacine: true }), false, 'la racine est refusee en mode strict');
  assert.equal(D.cheminAutorise(path.join(b.MESHES_DIR, '..', 'secret.txt'), R), false, 'traversee ..');
  assert.equal(D.cheminAutorise(path.join(b.MESHES_DIR, 'a', '..', '..', 'secret.txt'), R), false, 'traversee profonde');
  assert.equal(D.cheminAutorise(b.MESHES_DIR + '_evil' + path.sep + 'x.glb', R), false, 'prefixe commun sans separateur');
  assert.equal(D.cheminAutorise(b.MESHES_DIR + '_evil', R), false);
  for (const v of [undefined, null, 42, '', {}, 'a\0b']) assert.equal(D.cheminAutorise(v, R), false, 'valeur inutilisable : ' + String(v));
  assert.equal(D.cheminAutorise(path.join(b.MESHES_DIR, 'a.glb'), []), false, 'aucune racine');
  assert.equal(D.cheminAutorise(path.join(b.MESHES_DIR, 'a.glb'), [undefined, '']), false, 'racines inutilisables');
});

test('cheminAutorise : plusieurs racines, une racine inexistante reste utilisable', () => {
  const b = bacASable();
  const futur = path.join(b.racine, 'pas-encore', 'dossier');
  assert.equal(D.cheminAutorise(path.join(futur, 'a.png'), [futur]), true);
  assert.equal(D.cheminAutorise(path.join(b.IMAGES_DIR, 'p', 'a.png'), [b.MESHES_DIR, b.IMAGES_DIR]), true);
});

test('cheminAutorise : majuscules/minuscules (Windows)', { skip: process.platform !== 'win32' }, () => {
  const b = bacASable();
  const autre = path.join(b.MESHES_DIR.toUpperCase(), 'A.GLB');
  assert.equal(D.cheminAutorise(autre, [b.MESHES_DIR]), true);
  assert.equal(D.cheminAutorise(b.MESHES_DIR.toLowerCase() + path.sep + 'x', [b.MESHES_DIR.toUpperCase()]), true);
});

test('cheminAutorise : UNC et prefixe \\\\?\\ (Windows)', { skip: process.platform !== 'win32' }, () => {
  const b = bacASable();
  assert.equal(D.cheminAutorise('\\\\serveur\\partage\\meshes\\x.glb', [b.MESHES_DIR]), false, 'UNC hors racine');
  assert.equal(D.cheminAutorise('\\\\?\\UNC\\serveur\\partage\\x.glb', [b.MESHES_DIR]), false, 'UNC etendu hors racine');
  assert.equal(D.cheminAutorise('\\\\?\\' + path.join(b.MESHES_DIR, 'a.glb'), [b.MESHES_DIR]), true, 'prefixe \\\\?\\ sur un chemin local de la racine');
  assert.equal(D.cheminAutorise('\\\\serveur\\partage\\x', ['\\\\serveur\\partage']), true, 'racine UNC legitime');
});

test('cheminAutorise : un lien (jonction) qui sort de la racine est refuse', () => {
  const b = bacASable();
  const dehors = path.join(b.racine, 'dehors'); fs.mkdirSync(dehors);
  fs.writeFileSync(path.join(dehors, 'perso.txt'), 'x');
  const lien = path.join(b.MESHES_DIR, 'lien');
  try { fs.symlinkSync(dehors, lien, 'junction'); } catch (e) { return; /* liens non permis ici : rien a prouver */ }
  assert.equal(D.cheminAutorise(path.join(lien, 'perso.txt'), [b.MESHES_DIR]), false);
  // et le cas legitime inverse : une racine qui est elle-meme une jonction
  const racineLien = path.join(b.racine, 'racine-lien');
  fs.symlinkSync(b.MESHES_DIR, racineLien, 'junction');
  assert.equal(D.cheminAutorise(path.join(racineLien, 'a.glb'), [b.MESHES_DIR]), true);
  assert.equal(D.cheminAutorise(path.join(b.MESHES_DIR, 'a.glb'), [racineLien]), true);
});

// ---------------------------------------------------------------- gestionnaires IPC (ancien code : ECHEC) ----
test('delete-mesh : un nom avec .. ne supprime rien hors du dossier des maillages', async () => {
  const b = bacASable();
  const victime = path.join(b.racine, 'data', 'Documents-x.docx');
  fs.writeFileSync(victime, 'precieux');
  const { gestionnaires } = chargerGestionnaires(b);
  const del = gestionnaires.get('delete-mesh');
  await del({}, '..' + path.sep + 'Documents-x.docx');
  assert.equal(fs.existsSync(victime), true, 'le fichier hors du dossier a ete supprime');
  const lien = path.join(b.racine, 'data', 'history', 'h.txt'); fs.writeFileSync(lien, 'h');
  await del({}, '..' + path.sep + 'history' + path.sep + 'h.txt');
  assert.equal(fs.existsSync(lien), true);
});

test('delete-mesh : un maillage legitime est supprime (comportement conserve)', async () => {
  const b = bacASable();
  const m = path.join(b.MESHES_DIR, 'orc_1.glb'); fs.writeFileSync(m, 'glb');
  const sous = path.join(b.MESHES_DIR, 'animated'); fs.mkdirSync(sous);
  const m2 = path.join(sous, 'walk__orc_1.glb'); fs.writeFileSync(m2, 'glb');
  const { gestionnaires } = chargerGestionnaires(b);
  const del = gestionnaires.get('delete-mesh');
  assert.equal(await del({}, 'orc_1.glb'), true);
  assert.equal(fs.existsSync(m), false);
  await del({}, 'animated/walk__orc_1.glb');
  assert.equal(fs.existsSync(m2), false);
  assert.equal(await del({}, 'absent.glb'), true, 'fichier absent : meme resultat qu avant');
});

test('delete-image-folder : refuse la racine des images, accepte un projet', async () => {
  const b = bacASable();
  const projet = path.join(b.IMAGES_DIR, 'orc_1'); fs.mkdirSync(projet);
  fs.writeFileSync(path.join(b.IMAGES_DIR, 'garde.png'), 'x');
  const { gestionnaires } = chargerGestionnaires(b);
  const del = gestionnaires.get('delete-image-folder');
  await del({}, b.IMAGES_DIR);
  assert.equal(fs.existsSync(path.join(b.IMAGES_DIR, 'garde.png')), true, 'la racine des images a ete supprimee');
  assert.equal(await del({}, projet), true);
  assert.equal(fs.existsSync(projet), false);
});

test('delete-project : un nom « .. » ne vise pas le parent du dossier d\'historique', async () => {
  const b = bacASable();
  fs.writeFileSync(path.join(b.racine, 'data', 'temoin.txt'), 'x');
  const { gestionnaires } = chargerGestionnaires(b);
  await gestionnaires.get('delete-project')({}, { projectName: '..' });
  assert.equal(fs.existsSync(path.join(b.racine, 'data', 'temoin.txt')), true, 'le dossier parent de l\'historique a ete supprime');
});

test('delete-project : l\'historique d\'un vrai projet est supprime', async () => {
  const b = bacASable();
  const h = path.join(b.HISTORY_DIR, 'orc'); fs.mkdirSync(h); fs.writeFileSync(path.join(h, 'v.json'), '{}');
  const { gestionnaires } = chargerGestionnaires(b);
  const r = await gestionnaires.get('delete-project')({}, { projectName: 'orc' });
  assert.equal(r.ok, true);
  assert.equal(fs.existsSync(h), false);
});

test('get-mesh-path : un nom avec .. ne sort pas du dossier des maillages', async () => {
  const b = bacASable();
  const { gestionnaires } = chargerGestionnaires(b);
  const get = gestionnaires.get('get-mesh-path');
  assert.equal(await get({}, 'orc.glb'), path.join(b.MESHES_DIR, 'orc.glb'));
  const r = await get({}, '..' + path.sep + '..' + path.sep + 'secret.txt');
  assert.ok(D.cheminAutorise(r, [b.MESHES_DIR]), 'chemin renvoye hors du dossier : ' + r);
});

test('isPathAllowed : prefixe commun, liens et casse', () => {
  const b = bacASable();
  const { gestionnaires } = chargerGestionnaires(b);   // eslint-disable-line no-unused-vars
  const code = fonction('isPathAllowed');
  const isPathAllowed = new Function('cheminAutorise', 'path', 'MESHES_DIR', 'IMAGES_DIR', 'SCRIPTS_DIR', 'HISTORY_DIR', code + '\nreturn isPathAllowed;')(
    D.cheminAutorise, path, b.MESHES_DIR, b.IMAGES_DIR, b.SCRIPTS_DIR, b.HISTORY_DIR);
  assert.equal(isPathAllowed(path.join(b.IMAGES_DIR, 'p', 'a.png')), true);
  assert.equal(isPathAllowed(b.IMAGES_DIR + '_evil' + path.sep + 'a.png'), false);
  if (process.platform === 'win32') assert.equal(isPathAllowed(path.join(b.MESHES_DIR.toUpperCase(), 'A.GLB')), true, 'casse ignoree sous Windows');
  const dehors = path.join(b.racine, 'dehors2'); fs.mkdirSync(dehors);
  try { fs.symlinkSync(dehors, path.join(b.MESHES_DIR, 'lien'), 'junction'); assert.equal(isPathAllowed(path.join(b.MESHES_DIR, 'lien', 'x.txt')), false, 'jonction vers l\'exterieur'); } catch (e) { if (e.name === 'AssertionError') throw e; }
  assert.doesNotThrow(() => isPathAllowed(undefined));
  assert.equal(isPathAllowed(undefined), false);
});

test('mesh-tool et import-dropped-file : controles de chemin presents', () => {
  const mt = bloc("ipcMain.handle('mesh-tool',", '\n  const script');
  assert.match(mt, /isPathAllowed\(meshPath\)/, 'mesh-tool sans controle de chemin');
  assert.doesNotMatch(texteMain, /resolved\.startsWith\(path\.resolve\(IMAGES_DIR\)\)/, 'ancien controle startsWith sans separateur');
});

// ---------------------------------------------------------------- Blender (DM-2) ----
function chargerBlender(bac, { config, env }) {
  const gestionnaires = new Map();
  const ipcMain = { handle: (nom, fn) => gestionnaires.set(nom, fn) };
  const etat = { config: { ...config }, sauvegardes: 0 };
  const code = [
    fonction('_autoDetectBlender'),
    fonction('_resolveBlenderPath'),
    texteMain.includes('_blenderPourInterface') ? bloc('let _blenderRechercheApres', '\n}\n') : '',
    bloc("ipcMain.handle('get-config',"),
    bloc("ipcMain.handle('set-config',"),
  ].join('\n');
  const noms = ['ipcMain', 'path', 'fs', 'process', 'require', 'loadConfig', 'saveConfig', 'blenderExeValide'];
  const fauxProcess = { env: { ...env }, platform: process.platform };
  new Function(...noms, code)(ipcMain, path, fs, fauxProcess, require, () => ({ ...etat.config }),
    (c) => { etat.config = { ...c }; etat.sauvegardes++; }, D.blenderExeValide);
  return { gestionnaires, etat };
}

test('Blender : get-config renvoie le chemin RESOLU et le memorise (boutons actifs sans redemarrage)', async () => {
  const b = bacASable();
  const exe = path.join(b.racine, 'Blender 9.9', 'blender.exe');
  fs.mkdirSync(path.dirname(exe)); fs.writeFileSync(exe, 'MZ');
  const { gestionnaires, etat } = chargerBlender(b, { config: { blenderPath: '' }, env: { BLENDER_EXE: exe, ProgramFiles: b.racine, 'ProgramFiles(x86)': b.racine } });
  const cfg = await gestionnaires.get('get-config')();
  assert.equal(cfg.blenderPath, exe);
  assert.equal(etat.config.blenderPath, exe, 'le chemin resolu doit etre memorise');
});

test('Blender : un chemin qui n\'est pas un blender.exe existant n\'est jamais memorise ni renvoye', async () => {
  const b = bacASable();
  const faux = path.join(b.racine, 'blender.bat'); fs.writeFileSync(faux, 'x');
  const { gestionnaires, etat } = chargerBlender(b, { config: { blenderPath: '' }, env: { BLENDER_EXE: faux, ProgramFiles: b.racine, 'ProgramFiles(x86)': b.racine, PATH: '' } });
  const cfg = await gestionnaires.get('get-config')();
  assert.ok(!cfg.blenderPath, 'chemin douteux renvoye : ' + cfg.blenderPath);
  assert.equal(etat.config.blenderPath, '', 'chemin douteux memorise');
  // set-config : refuse un chemin quelconque, accepte vide et un vrai blender.exe
  const exe = path.join(b.racine, 'vrai', 'blender.exe'); fs.mkdirSync(path.dirname(exe)); fs.writeFileSync(exe, 'MZ');
  const set = gestionnaires.get('set-config');
  assert.equal((await set({}, { blenderPath: 'C:\\n\\existe\\pas\\blender.exe' })).success, false);
  assert.equal((await set({}, { blenderPath: faux })).success, false);
  assert.equal((await set({}, { blenderPath: b.racine })).success, false, 'un dossier');
  assert.equal((await set({}, { blenderPath: exe })).success, true);
  assert.equal(etat.config.blenderPath, exe);
  assert.equal((await set({}, { blenderPath: '' })).success, true);
  assert.equal(etat.config.blenderPath, '');
});

test('Blender : un chemin deja configure et existant est conserve tel quel', async () => {
  const b = bacASable();
  const exe = path.join(b.racine, 'perso', 'mon-blender.exe'); fs.mkdirSync(path.dirname(exe)); fs.writeFileSync(exe, 'MZ');
  const { gestionnaires, etat } = chargerBlender(b, { config: { blenderPath: exe }, env: { ProgramFiles: b.racine, 'ProgramFiles(x86)': b.racine } });
  assert.equal((await gestionnaires.get('get-config')()).blenderPath, exe);
  assert.equal(etat.sauvegardes, 0);
});

test('blenderExeValide : fichier existant nomme blender.exe uniquement', () => {
  const b = bacASable();
  const ok = path.join(b.racine, 'blender.exe'); fs.writeFileSync(ok, 'x');
  assert.equal(D.blenderExeValide(ok), true);
  assert.equal(D.blenderExeValide(ok.toUpperCase().replace('BLENDER.EXE', 'Blender.EXE')), process.platform === 'win32');
  assert.equal(D.blenderExeValide(path.join(b.racine, 'absent', 'blender.exe')), false);
  assert.equal(D.blenderExeValide(b.racine), false);
  const dossier = path.join(b.racine, 'sous', 'blender.exe'); fs.mkdirSync(dossier, { recursive: true });
  assert.equal(D.blenderExeValide(dossier), false, 'un DOSSIER nomme blender.exe');
  for (const v of [undefined, null, 5, '', 'x\0blender.exe']) assert.equal(D.blenderExeValide(v), false);
});

// ---------------------------------------------------------------- pas de texture (DM-3) ----
test('pasTexturePourPalier : borne [8, 48], Fast 12 -> 24, champ absent -> null', () => {
  assert.equal(D.pasTexturePourPalier(12, 'fast'), 24);
  assert.equal(D.pasTexturePourPalier(12, 'balanced'), 12, '12 hors Fast reste 12');
  assert.equal(D.pasTexturePourPalier(24, 'balanced'), 24);
  assert.equal(D.pasTexturePourPalier(32, 'quality'), 32);
  assert.equal(D.pasTexturePourPalier(32, 'ultra_8k'), 32);
  assert.equal(D.pasTexturePourPalier(16, 'fast'), 16, 'Fast explicite autre que 12 : respecte');
  assert.equal(D.pasTexturePourPalier(1, 'quality'), 8);
  assert.equal(D.pasTexturePourPalier(-5, 'quality'), 8);
  assert.equal(D.pasTexturePourPalier(500, 'quality'), 48);
  assert.equal(D.pasTexturePourPalier('32', 'quality'), 32, 'chaine numerique');
  assert.equal(D.pasTexturePourPalier(23.6, 'x'), 24, 'arrondi');
  for (const v of [undefined, null, '', 'abc', NaN, Infinity, true, {}]) assert.equal(D.pasTexturePourPalier(v, 'fast'), null, 'doit etre null : ' + String(v));
  assert.equal(D.pasTexturePourPalier(12, undefined), 12, 'palier absent : pas de conversion Fast');
});

test('main.js transmet le pas de texture au pipeline (FABMESH_TEX_STEPS)', () => {
  assert.match(texteMain, /FABMESH_TEX_STEPS: String\(pasTexturePourPalier\(trellis2Steps, trellis2Preset\)\)/);
});

// ---------------------------------------------------------------- plantage natif (DM-4) ----
test('estPlantageNatif : uniquement 0xC0000005 sans signal ni delai', () => {
  assert.equal(D.estPlantageNatif({ code: 3221225477 }), true);
  assert.equal(D.estPlantageNatif({ code: -1073741819 }), true);
  assert.equal(D.estPlantageNatif({ code: 1 }), false, 'erreur Python normale');
  assert.equal(D.estPlantageNatif({ code: 77 }), false, 'pause');
  assert.equal(D.estPlantageNatif({ code: 3221225477, killed: true }), false);
  assert.equal(D.estPlantageNatif({ code: 3221225477, signal: 'SIGTERM' }), false);
  assert.equal(D.estPlantageNatif({ code: 3221226505 }), false, 'autre code NTSTATUS (0xC0000409)');
  for (const v of [null, undefined, {}, 'x', 0]) assert.equal(D.estPlantageNatif(v), false);
});

test('main.js : UN seul rejeu du lancement 3D, garde par un drapeau', () => {
  const n = (texteMain.match(/estPlantageNatif\(error\)/g) || []).length;
  assert.equal(n, 1);
  assert.match(texteMain, /let _rejeuPlantageFait = false;/);
  assert.match(texteMain, /!_rejeuPlantageFait && estPlantageNatif\(error\)/);
});

// ---------------------------------------------------------------- Sentry (DM-7) ----
test('nettoyerCheminsWindows : profil Windows remplace par ~', () => {
  const f = D.nettoyerCheminsWindows;
  assert.equal(f('Error at C:\\Users\\Jean\\AppData\\Roaming\\x\\a.js:3'), 'Error at ~\\AppData\\Roaming\\x\\a.js:3');
  assert.equal(f('c:/users/jean/appdata/x'), '~/appdata/x');
  assert.equal(f('file:///C:/Users/Jean Dupont/Desktop/x.glb'), 'file:///~/Desktop/x.glb');
  assert.equal(f('{"p":"C:\\\\Users\\\\Jean\\\\x"}'), '{"p":"~\\\\x"}', 'barres doublees (JSON)');
  assert.equal(f('D:\\Users\\Zoe\\y'), '~\\y', 'autre lecteur');
  assert.equal(f('C:\\Program Files\\App\\a.js'), 'C:\\Program Files\\App\\a.js', 'hors profil : intact');
  assert.equal(f(42), 42);
});

test('nettoyerEvenementSentry : piles, messages, breadcrumbs, objets imbriques et cycles', () => {
  const ev = {
    message: 'ENOENT C:\\Users\\Jean\\x',
    exception: { values: [{ value: 'boom C:\\Users\\Jean\\y', stacktrace: { frames: [{ filename: 'C:\\Users\\Jean\\AppData\\app.asar\\main.js', abs_path: 'C:/Users/Jean/z.js' }] } }] },
    breadcrumbs: [{ message: 'open C:\\Users\\Jean\\Desktop\\a.png', data: { chemin: 'C:\\Users\\Jean\\b' } }],
    extra: { n: 3, ok: true, nul: null },
  };
  ev.boucle = ev;   // cycle
  D.nettoyerEvenementSentry(ev);
  const json = JSON.stringify({ ...ev, boucle: undefined });
  assert.ok(!/Jean/.test(json), 'nom restant : ' + json);
  assert.equal(ev.extra.n, 3);
  assert.equal(ev.exception.values[0].stacktrace.frames[0].filename, '~\\AppData\\app.asar\\main.js');
});

test('main.js : beforeSend nettoie l\'evenement sans changer le caractere actif du rapport', () => {
  const b = bloc('beforeSend(event) {', '\n      },');
  assert.match(b, /nettoyerEvenementSentry\(event\)/);
  assert.match(b, /if \(crashReportsDisabled\(\)\) return null;/);
  assert.doesNotMatch(texteMain, /crashReports\s*[:=]\s*false[^=]*default/i);
});

// ---------------------------------------------------------------- Export Unreal (DM-1) ----
function scriptUnreal(sourcePath, outputPath) {
  const tpl = bloc("const exportScript = `", '`;\n').slice('const exportScript = `'.length, -3);
  // eslint-disable-next-line no-new-func
  return new Function('sourcePath', 'outputPath', 'return `' + tpl + '`;')(sourcePath, outputPath);
}

test('export-to-unreal : le script exporte MESH et ARMATURE sans os feuille ni animation cuite', () => {
  const s = scriptUnreal('C:/a/b.glb', 'C:/a/b.fbx');
  assert.match(s, /object_types=\{'MESH', 'ARMATURE'\}/);
  assert.match(s, /add_leaf_bones=False/);
  assert.match(s, /bake_anim=False/);
  assert.match(s, /object_types=\{'MESH'\},/, 'le chemin d\'origine (maillage sans squelette) doit subsister');
});

const BLENDER = ['C:/Program Files/Blender Foundation/Blender 5.1/blender.exe', 'C:/Program Files/Blender Foundation/Blender 4.5/blender.exe']
  .find((p) => fs.existsSync(p));
const RIG = path.join(racineDepot, 'build', '_sk_perso_rigged.glb');
const STATIQUE = 'C:/tmp/_chick_in.glb';

function exporterEtCompter(glb, texteScript) {
  const rep = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-unreal-'));
  const sortie = path.join(rep, 'sortie.fbx').replace(/\\/g, '/');
  const py = path.join(rep, 'export.py'); fs.writeFileSync(py, texteScript(glb.replace(/\\/g, '/'), sortie));
  execFileSync(BLENDER, ['--background', '--python', py], { timeout: 180000, stdio: 'pipe' });
  const verif = path.join(rep, 'verif.py');
  fs.writeFileSync(verif, [
    'import bpy',
    'bpy.ops.object.select_all(action="SELECT")', 'bpy.ops.object.delete()',
    'bpy.ops.import_scene.fbx(filepath=' + JSON.stringify(sortie) + ')',
    'arm=[o for o in bpy.data.objects if o.type=="ARMATURE"]', 'mesh=[o for o in bpy.data.objects if o.type=="MESH"]',
    'print("RESULTAT arm=%d bones=%d mesh=%d groupes=%d" % (len(arm), sum(len(a.data.bones) for a in arm), len(mesh), sum(len(m.vertex_groups) for m in mesh)))',
  ].join('\n'));
  const out = execFileSync(BLENDER, ['--background', '--python', verif], { timeout: 180000, stdio: 'pipe' }).toString();
  const m = /RESULTAT arm=(\d+) bones=(\d+) mesh=(\d+) groupes=(\d+)/.exec(out);
  assert.ok(m, 'verification Blender sans resultat');
  return { arm: +m[1], bones: +m[2], mesh: +m[3], groupes: +m[4] };
}

test('export-to-unreal (Blender reel) : un rig conserve son squelette et ses poids', { skip: !BLENDER || !fs.existsSync(RIG) ? 'Blender ou rig de reference absent' : false, timeout: 400000 }, () => {
  const r = exporterEtCompter(RIG, scriptUnreal);
  assert.ok(r.arm >= 1, 'aucune armature dans le FBX exporte : ' + JSON.stringify(r));
  assert.ok(r.bones >= 1, 'aucun os : ' + JSON.stringify(r));
  assert.ok(r.groupes >= 1, 'aucun groupe de sommets : ' + JSON.stringify(r));
});

test('export-to-unreal (Blender reel) : un maillage SANS squelette s\'exporte comme avant', { skip: !BLENDER || !fs.existsSync(STATIQUE) ? 'Blender ou maillage de reference absent' : false, timeout: 400000 }, () => {
  const r = exporterEtCompter(STATIQUE, scriptUnreal);
  assert.equal(r.arm, 0);
  assert.ok(r.mesh >= 1, 'maillage perdu : ' + JSON.stringify(r));
});
