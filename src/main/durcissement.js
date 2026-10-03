'use strict';
/* DURCISSEMENT DU PROCESSUS PRINCIPAL (2026-10-03, analyse complete du 03/10/2026)
 *
 * Fonctions PURES (aucune dependance a Electron) pour que main.js reste mince et
 * que chaque regle soit testable sans lancer l'appli (voir tests/main/durcissement.test.mjs).
 *
 *  - cheminAutorise      : constat D-05 (validation de chemin unique)
 *  - nettoyerChemins...  : constat D-09 (chemins Windows dans les rapports Sentry)
 *  - blenderExeValide    : defaut 4 de la campagne des outils 3D (chemin Blender)
 *  - pasTexturePourPalier: constat T2 (nombre de pas de texture du palier)
 *  - estPlantageNatif    : constat T6 (code de sortie 0xC0000005)
 */

const fsReel = require('fs');
const path = require('path');

/* ---------------------------------------------------------------- D-05 -- */

// Forme canonique d'un chemin pour la comparaison : path.resolve, puis liens
// symboliques et noms courts 8.3 resolus (realpath.native) pour la partie qui
// EXISTE, la queue inexistante etant rajoutee telle quelle. Prefixe \\?\ retire,
// casse ignoree sous Windows. Renvoie null pour une valeur inutilisable.
function _canonique(p, fs) {
  if (typeof p !== 'string' || !p || p.indexOf('\0') !== -1) return null;
  let r = path.resolve(p);
  const queue = [];
  let cur = r;
  const realpath = (fs.realpathSync && fs.realpathSync.native) || fs.realpathSync;
  for (let i = 0; i < 128; i++) {
    try {
      const reel = realpath(cur);
      r = queue.length ? path.join(reel, ...queue.reverse()) : reel;
      break;
    } catch (_) {
      const parent = path.dirname(cur);
      if (parent === cur) break;
      queue.push(path.basename(cur));
      cur = parent;
    }
  }
  if (process.platform === 'win32') {
    if (/^\\\\\?\\UNC\\/i.test(r)) r = '\\\\' + r.slice(8);
    else if (/^\\\\\?\\/.test(r)) r = r.slice(4);
    r = r.toLowerCase();
  }
  return r;
}

/* cheminAutorise(p, racines, opts) : vrai si p est DANS l'une des racines (ou egal a une racine,
 * sauf opts.sansRacine). Constat D-05 : l'ancien controle comparait path.resolve + startsWith, ne
 * voyait pas les liens symboliques, et `delete-mesh` n'en faisait aucun.
 * La comparaison se fait avec separateur final : « images_evil » n'est pas dans « images ». */
function cheminAutorise(p, racines, opts) {
  const fs = (opts && opts.fs) || fsReel;
  const cible = _canonique(p, fs);
  if (!cible || !Array.isArray(racines)) return false;
  for (const racine of racines) {
    const base = _canonique(racine, fs);
    if (!base) continue;
    const avecSep = base.endsWith(path.sep) ? base : base + path.sep;
    if (cible === base || cible + path.sep === avecSep) {
      if (!(opts && opts.sansRacine)) return true;
      continue;
    }
    if (cible.startsWith(avecSep)) return true;
  }
  return false;
}

/* ---------------------------------------------------------------- D-09 -- */

// C:\Users\<nom> -> ~ (barres obliques, doublees ou non, et file:///). Le nom peut contenir
// des espaces : on s'arrete au separateur suivant.
const RE_PROFIL_WINDOWS = /[A-Za-z]:[\\/]+Users[\\/]+[^\\/:*?"<>|\r\n]+/gi;

function nettoyerCheminsWindows(texte) {
  if (typeof texte !== 'string') return texte;
  return texte.replace(RE_PROFIL_WINDOWS, '~');
}

// Parcourt un evenement Sentry (objet JSON) et nettoie toutes les chaines. Profondeur et
// nombre de noeuds bornes ; les cycles sont ignores.
function nettoyerEvenementSentry(evenement) {
  const vus = new WeakSet();
  let budget = 20000;
  const visiter = (v, profondeur) => {
    if (typeof v === 'string') return nettoyerCheminsWindows(v);
    if (!v || typeof v !== 'object' || profondeur > 12 || --budget < 0) return v;
    if (vus.has(v)) return v;
    vus.add(v);
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) v[i] = visiter(v[i], profondeur + 1);
    } else {
      for (const k of Object.keys(v)) v[k] = visiter(v[k], profondeur + 1);
    }
    return v;
  };
  return visiter(evenement, 0);
}

/* -------------------------------------------------------------- Blender -- */

// Un chemin Blender n'est retenu que si c'est un FICHIER existant nomme blender.exe.
function blenderExeValide(p, fs) {
  fs = fs || fsReel;
  if (typeof p !== 'string' || !p || p.indexOf('\0') !== -1) return false;
  if (path.basename(p).toLowerCase() !== 'blender.exe') return false;
  try { return fs.statSync(p).isFile(); } catch (_) { return false; }
}

/* ------------------------------------------------------------------ T2 -- */

// Nombre de pas de l'echantillonneur de TEXTURE a transmettre au pipeline (FABMESH_TEX_STEPS).
// null = champ absent ou illisible : on ne pose rien, le pipeline garde son defaut (24).
// Decision du 2026-10-03 : le palier Fast annonce 12 pas cote interface, mais le web mesure 24
// meilleur que 12 -> 12 devient 24 pour Fast seulement. Borne [8, 48] dans tous les cas.
function pasTexturePourPalier(pas, palier) {
  if (pas === undefined || pas === null || pas === '' || typeof pas === 'boolean') return null;
  const n = Number(pas);
  if (!Number.isFinite(n)) return null;
  let v = Math.round(n);
  if (String(palier) === 'fast' && v === 12) v = 24;
  return Math.min(48, Math.max(8, v));
}

/* ------------------------------------------------------------------ T6 -- */

// 0xC0000005 (violation d'acces) : Node le rend en non signe (3221225477) ; on accepte aussi
// la forme signee. Jamais pour une erreur Python normale (code 1), un arret par delai ou un signal.
function estPlantageNatif(erreur) {
  if (!erreur || erreur.killed || erreur.signal) return false;
  return erreur.code === 3221225477 || erreur.code === -1073741819;
}

module.exports = {
  cheminAutorise,
  nettoyerCheminsWindows,
  nettoyerEvenementSentry,
  blenderExeValide,
  pasTexturePourPalier,
  estPlantageNatif,
};
