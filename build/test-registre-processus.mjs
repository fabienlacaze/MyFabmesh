// Banc du registre des calculs lances (src/main/registre_processus.js) : qui est inscrit, qui est arrete au demarrage suivant,
// et surtout qui ne l'est JAMAIS (PID reutilise, travaux gardes, pause). Aucun processus reel n'est touche.
// Usage : node build/test-registre-processus.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const R = require('../src/main/registre_processus.js');

let echecs = 0, n = 0;
const ok = (cond, nom) => { n++; if (!cond) { echecs++; console.log('ECHEC  ' + nom); } else console.log('ok     ' + nom); };

const S = 'C:\\Program Files\\MyFabmesh\\resources\\scripts\\';
const proc = (pid, spawnfile, args) => ({ pid, spawnfile, spawnargs: [spawnfile, ...args] });

// 1. inscription
const e1 = R.entreeDe(proc(101, 'C:\\Users\\u\\AppData\\Roaming\\myfabmesh-ai\\python\\python.exe', [S + 'detail_synth.py', 'a.glb']), 1000);
ok(e1 && e1.image === 'python.exe' && e1.script === S + 'detail_synth.py' && e1.debut === 1000, 'python + script inscrit');
ok(R.entreeDe(proc(102, 'powershell.exe', ['-Command', 'x']), 1) === null, 'outil systeme ignore');
ok(R.entreeDe(proc(103, 'python', ['-c', 'print(1)']), 1) === null, 'python sans script ignore (rien a verifier)');
ok(R.entreeDe(proc(104, 'python', ['C:/x/scripts/mesh_tools.py']), 1).image === 'python.exe', "'python' (developpement) -> python.exe");
ok(R.entreeDe(proc(105, 'D:\\Blender\\blender.exe', ['--background', '--python', 'C:\\t\\export.py']), 1).script === 'C:\\t\\export.py', 'Blender + script');
ok(R.entreeDe({ spawnfile: 'python.exe', spawnargs: ['python.exe', 'x.py'] }, 1) === null, 'pas de pid (lancement rate) ignore');

// 2. verification (PID reutilise)
const vivant = (nom, ligne, creation) => ({ nom, ligne, creation });
const ligne1 = '"C:\\Users\\u\\AppData\\Roaming\\myfabmesh-ai\\python\\python.exe" "C:\\Program Files\\MyFabmesh\\resources\\scripts\\detail_synth.py" a.glb';
ok(R.verifier(e1, vivant('python.exe', ligne1, 1200)), 'meme image, meme script, cree a l heure : verifie');
ok(R.verifier(e1, vivant('Python.EXE', ligne1.replace(/\\/g, '/'), 900)), 'casse et barres ignorees');
ok(!R.verifier(e1, vivant('chrome.exe', ligne1, 1200)), 'autre image : pas touche');
ok(!R.verifier(e1, vivant('python.exe', '"python.exe" C:\\autre\\script.py', 1200)), 'autre script : pas touche');
ok(!R.verifier(e1, vivant('python.exe', ligne1, 1000 + R.TOLERANCE_CREATION_MS + 1)), 'cree bien plus tard (PID reutilise) : pas touche');
ok(!R.verifier(e1, vivant('python.exe', null, 1000)), 'ligne de commande illisible : pas touche');

// 3. plan sans drapeau
const serveur = { pid: 201, image: 'python.exe', script: S + 'sdxl_server.py', debut: 5000 };
const travail = { pid: 202, image: 'python.exe', script: S + 'detail_synth.py', debut: 6000 };
const mort = { pid: 203, image: 'python.exe', script: S + 'mesh_tools.py', debut: 7000 };
const repris = { pid: 204, image: 'python.exe', script: S + 'texture_project.py', debut: 8000 };
const pause = { pid: 205, image: 'python.exe', script: S + 'trellis2_native_full_pipeline.py', debut: 9000 };
const V = new Map([
  [201, vivant('python.exe', 'python.exe ' + S + 'sdxl_server.py', 5100)],
  [202, vivant('python.exe', 'python.exe ' + S + 'detail_synth.py x', 6050)],
  [204, vivant('python.exe', 'python.exe ' + S + 'texture_project.py', 8000 + 3600e3)],   // meme PID, relance 1 h plus tard
  [205, vivant('python.exe', 'python.exe ' + S + 'trellis2_native_full_pipeline.py', 9010)],
]);
const entrees = [serveur, travail, mort, repris, pause];
let p = R.plan({ entrees, vivants: V, pidsPause: new Set([205]), drapeauGarde: false });
ok(p.arreter.map((e) => e.pid).sort().join() === '201,202', 'sans drapeau : serveur et travail orphelins arretes');
ok(!p.arreter.some((e) => e.pid === 204), 'PID reutilise jamais arrete');
ok(!p.arreter.some((e) => e.pid === 203), 'processus mort ignore');
ok(p.garder.length === 1 && p.garder[0].pid === 205 && p.garder[0].raison === 'pause', 'travail en pause garde');

// 4. plan avec « keep jobs »
p = R.plan({ entrees, vivants: V, pidsPause: new Set(), drapeauGarde: true });
ok(p.arreter.length === 0, 'keep + travail vivant : rien n est arrete');
ok(p.garder.some((e) => e.pid === 202) && p.garder.some((e) => e.pid === 201), 'keep : travail et serveur gardes');
ok(p.reporter.length === 1 && p.reporter[0].pid === 201, 'keep : serveur reporte au demarrage suivant');
const V2 = new Map([[201, V.get(201)]]);
p = R.plan({ entrees, vivants: V2, pidsPause: new Set(), drapeauGarde: true });
ok(p.arreter.length === 1 && p.arreter[0].pid === 201 && p.reporter.length === 0, 'keep mais plus aucun travail : serveur d appoint arrete');

// 5. fichier du registre
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'wf5_registre_'));
const fichier = path.join(dossier, 'calculs_lances.json');
let t = 1_000_000;
const reg = R.creer({ fichier, heritage: [serveur], pidSession: 999, horloge: () => t });
reg.ajouter(proc(301, 'python.exe', [S + 'mesh_tools.py', 'decimate']));
reg.ajouter(proc(302, 'nvidia-smi.exe', ['-q']));
reg.ecrireMaintenant();
let lu = R.lire(fichier);
ok(lu.session && lu.session.pid === 999 && lu.processus.map((e) => e.pid).join() === '201,301', 'fichier : heritage + calcul de la session');
reg.retirer(301); reg.ecrireMaintenant();
ok(R.lire(fichier).processus.map((e) => e.pid).join() === '201', 'calcul termine retire');
reg.finHeritage([]);
ok(R.lire(fichier).processus.length === 0, 'heritage regle : oublie');
reg.ajouter(proc(303, 'python.exe', [S + 'detail_synth.py']));
reg.vider();
ok(R.lire(fichier).processus.length === 0, 'fermeture normale : registre vide');
fs.writeFileSync(fichier, '{ pas du json');
ok(R.lire(fichier).processus.length === 0, 'fichier abime : aucun processus (personne n est arrete)');
fs.rmSync(dossier, { recursive: true, force: true });

// 6. lecture des processus Windows (execFile simule)
const faux = (sortie) => (cmd, args, opts, cb) => { cb(null, sortie); return {}; };
if (process.platform === 'win32') {
  let m = await R.interrogerWindows([201], faux('{"pid":201,"nom":"python.exe","ligne":"python.exe x.py","creation":5100}'));
  ok(m.size === 1 && m.get(201).creation === 5100, 'reponse d un seul processus (objet) lue');
  m = await R.interrogerWindows([201, 202], faux('[{"pid":201,"nom":"a","ligne":"b","creation":1},{"pid":202,"nom":"c","ligne":"d","creation":2}]'));
  ok(m.size === 2, 'reponse de plusieurs processus (tableau) lue');
  m = await R.interrogerWindows([201], faux('<erreur>'));
  ok(m.size === 0, 'reponse illisible : aucun vivant');
  m = await R.interrogerWindows([], faux('x'));
  ok(m.size === 0, 'liste vide : aucune requete');
}

console.log(`\n${n - echecs}/${n} verifications OK`);
process.exit(echecs ? 1 : 0);
