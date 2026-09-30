'use strict';
/* REGISTRE DES CALCULS LANCES (2026-09-30, user : « on est bien sur que les generations s'arretent si desktop tombe ? »).
 *
 * La surveillance du parent (scripts/cloisonnement_memoire.py, scripts/surveillance_parent.py) arrete un calcul des que
 * l'appli disparait, mais seulement dans les scripts qui l'arment et tant que leur Python tourne normalement. Filet de
 * securite : chaque Python / Blender lance par l'appli est inscrit dans userData/calculs_lances.json ; au demarrage suivant,
 * les survivants de la session precedente sont arretes (arbre complet), SAUF ceux gardes volontairement :
 *   - « Quit and keep jobs running » : fichier drapeau FABMESH_KEEP_FLAG present au demarrage ;
 *   - pause : processus des manifestes de paused_jobs/ (repris par resumePausedJobs).
 * Avec le drapeau, les serveurs d'appoint (images, traduction, filtre, redacteur) ne sont pas des « travaux » : arretes si plus
 * aucun travail garde ne tourne, sinon reportes au demarrage suivant (un travail garde peut encore s'en servir).
 * Un PID peut avoir ete REUTILISE par Windows : avant d'arreter, on verifie le nom de l'image (python.exe...), que la ligne de
 * commande contient le script inscrit, et que le processus a ete cree a l'heure du lancement inscrit (a 30 s pres).
 * Sans Electron : teste par build/test-registre-processus.mjs.
 */
const fs = require('fs');
const path = require('path');

const IMAGES_SUIVIES = new Set(['python.exe', 'pythonw.exe', 'blender.exe']);
const SERVEURS = /(^|[\\/])(sdxl_server|translate_server|nsfw_server|redacteur)\.py$/i;
const TOLERANCE_CREATION_MS = 30000;

function _image(fichier) {
  let b = path.win32.basename(String(fichier || '')).toLowerCase();
  if (b && !/\.[a-z0-9]+$/.test(b)) b += '.exe';          // 'python' (developpement) -> python.exe
  return b;
}
function _script(args) {
  for (const a of (Array.isArray(args) ? args.slice(1) : [])) {
    if (typeof a === 'string' && /\.py$/i.test(a.trim())) return a.trim();
  }
  return null;
}
const _norm = (s) => String(s || '').replace(/\//g, '\\').replace(/"/g, '').toLowerCase();

/** Entree du registre pour un ChildProcess (null : pas un calcul suivi — outils systeme, commande sans script). */
function entreeDe(proc, maintenant) {
  if (!proc || !proc.pid) return null;
  const image = _image(proc.spawnfile);
  if (!IMAGES_SUIVIES.has(image)) return null;
  const script = _script(proc.spawnargs);
  if (!script) return null;                                  // rien pour verifier la ligne de commande : on ne touchera jamais
  return { pid: proc.pid, image, script, debut: maintenant != null ? maintenant : Date.now() };
}

function estServeur(e) { return !!(e && SERVEURS.test(String(e.script || ''))); }

/** Le processus vivant `v` ({ nom, ligne, creation }) est-il bien celui de l'entree ? (PID reutilise sinon) */
function verifier(e, v) {
  if (!e || !v) return false;
  if (String(v.nom || '').toLowerCase() !== e.image) return false;
  if (!_norm(v.ligne).includes(_norm(e.script))) return false;
  if (typeof v.creation !== 'number' || !isFinite(v.creation)) return false;
  return Math.abs(v.creation - e.debut) <= TOLERANCE_CREATION_MS;
}

/** Que faire des survivants de la session precedente. entrees : registre lu ; vivants : Map pid -> { nom, ligne, creation } ;
 *  pidsPause : Set des pid en pause ; drapeauGarde : quitte avec « keep jobs ». Rend { arreter, garder, reporter }. */
function plan({ entrees, vivants, pidsPause, drapeauGarde }) {
  const res = { arreter: [], garder: [], reporter: [] };
  const serveurs = [];
  let travailGarde = false;
  for (const e of (entrees || [])) {
    const v = vivants && vivants.get(e.pid);
    if (!v || !verifier(e, v)) continue;                     // mort, ou PID repris par un autre programme : on n'y touche pas
    if (pidsPause && pidsPause.has(e.pid)) { res.garder.push({ ...e, raison: 'pause' }); if (!estServeur(e)) travailGarde = true; continue; }
    if (!drapeauGarde) { res.arreter.push(e); continue; }
    if (estServeur(e)) { serveurs.push(e); continue; }
    res.garder.push({ ...e, raison: 'keep' });
    travailGarde = true;
  }
  for (const s of serveurs) {
    if (travailGarde) { res.garder.push({ ...s, raison: 'keep' }); res.reporter.push(s); }
    else res.arreter.push(s);
  }
  return res;
}

function lire(fichier) {
  try {
    const o = JSON.parse(fs.readFileSync(fichier, 'utf-8'));
    const liste = (o && Array.isArray(o.processus)) ? o.processus : [];
    return { session: (o && o.session) || null, processus: liste.filter((e) => e && Number.isInteger(e.pid) && e.pid > 0 && e.image && e.script) };
  } catch (_) {
    return { session: null, processus: [] };
  }
}

function _ecrireAtomique(fichier, contenu) {
  const tmp = fichier + '.tmp';
  try {
    fs.mkdirSync(path.dirname(fichier), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(contenu, null, 1));
    fs.renameSync(tmp, fichier);
  } catch (_) {
    try { fs.writeFileSync(fichier, JSON.stringify(contenu)); } catch (__) {}
    try { fs.unlinkSync(tmp); } catch (__) {}
  }
}

/** Registre de la session en cours. heritage : entrees de la session precedente, gardees dans le fichier tant que leur sort
 *  n'est pas regle (finHeritage) — un plantage au demarrage ne les fait pas oublier. */
function creer({ fichier, heritage, pidSession, horloge } = {}) {
  const now = horloge || Date.now;
  const courants = new Map();
  let herites = Array.isArray(heritage) ? heritage.slice() : [];
  let minuterie = null;
  const session = { pid: pidSession || process.pid, debut: now() };
  const ecrireMaintenant = () => {
    if (minuterie) { clearTimeout(minuterie); minuterie = null; }
    _ecrireAtomique(fichier, { session, processus: [...herites, ...courants.values()] });
  };
  const planifier = () => {
    if (minuterie) return;
    minuterie = setTimeout(ecrireMaintenant, 400);
    if (minuterie && minuterie.unref) minuterie.unref();
  };
  return {
    ajouter(proc) {
      const e = entreeDe(proc, now());
      if (!e) return null;
      courants.set(e.pid, e);
      planifier();
      return e;
    },
    retirer(pid) { if (courants.delete(pid)) planifier(); },
    /** Sort de l'heritage regle : ne garder dans le fichier que les entrees a reverifier au prochain demarrage. */
    finHeritage(reporter) { herites = Array.isArray(reporter) ? reporter.slice() : []; ecrireMaintenant(); },
    /** Fermeture normale : tous les calculs de la session viennent d'etre arretes. */
    vider() { courants.clear(); ecrireMaintenant(); },
    ecrireMaintenant,
    entrees: () => [...herites, ...courants.values()],
  };
}

/** Processus vivants parmi `pids` (Windows) : Map pid -> { nom, ligne, creation (ms Unix) }. execFile injectable (tests). */
function interrogerWindows(pids, execFile) {
  return new Promise((resolve) => {
    const liste = [...new Set((pids || []).filter((p) => Number.isInteger(p) && p > 0))];
    const vivants = new Map();
    if (!liste.length || process.platform !== 'win32') return resolve(vivants);
    const filtre = liste.map((p) => 'ProcessId=' + p).join(' OR ');
    const ps = `$ErrorActionPreference='SilentlyContinue';`
      + `Get-CimInstance Win32_Process -Filter "${filtre}" | ForEach-Object { [pscustomobject]@{ pid=[int]$_.ProcessId; nom=$_.Name; `
      + `ligne=$_.CommandLine; creation=([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } } | ConvertTo-Json -Compress`;
    const ef = execFile || require('child_process').execFile;
    ef('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 20000, windowsHide: true },
      (err, stdout) => {
        try {
          const txt = String(stdout || '').trim();
          if (txt) {
            const o = JSON.parse(txt);
            for (const x of (Array.isArray(o) ? o : [o])) {
              if (x && Number.isInteger(x.pid)) vivants.set(x.pid, { nom: x.nom, ligne: x.ligne, creation: Number(x.creation) });
            }
          }
        } catch (_) { /* sortie illisible : personne n'est arrete */ }
        resolve(vivants);
      });
  });
}

module.exports = { entreeDe, estServeur, verifier, plan, lire, creer, interrogerWindows, TOLERANCE_CREATION_MS };
