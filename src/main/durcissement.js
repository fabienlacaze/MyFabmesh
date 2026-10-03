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
 *  - urlTelechargementAutorisee, adresseIpPubliqueSure, creerLookupPublic : constat D-05 (reste, URL des telechargements)
 *  - masquerNomsProjet   : constat D-08 (nom de projet dans ce qui quitte la machine)
 */

const fsReel = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');

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
// 2026-10-03 (constat D-08) : `noms` (facultatif) = noms de projet a masquer en plus des chemins Windows.
function nettoyerEvenementSentry(evenement, noms) {
  return _parcourirChaines(evenement, (s) => masquerNomsProjet(nettoyerCheminsWindows(s), noms));
}

// 2026-10-03 (constat D-08) : masque SEULEMENT les noms de projet (le nettoyage des chemins a deja eu lieu).
function masquerNomsDansEvenement(evenement, noms) {
  return _parcourirChaines(evenement, (s) => masquerNomsProjet(s, noms));
}

function _parcourirChaines(evenement, transformer) {
  const vus = new WeakSet();
  let budget = 20000;
  const visiter = (v, profondeur) => {
    if (typeof v === 'string') return transformer(v);
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

/* ---------------------------------------------------------- D-05 (reste) -- */

/* TELECHARGEMENTS D'UNE URL FOURNIE PAR LA PAGE (2026-10-03, constat D-05 « reste »).
 *
 * `download-to-temp` (main.js) et `downloadItem` (cloud_fallback.js) ouvraient n'importe quelle URL http(s) donnee par le
 * rendu : une page compromise (ou un glisser-deposer hostile) pouvait faire lire 127.0.0.1, un routeur (192.168.x), le service
 * de metadonnees d'un hebergeur (169.254.169.254), ou envoyer une requete en clair. Les deux gestionnaires passent desormais
 * par urlTelechargementAutorisee() AVANT tout reseau, et a CHAQUE redirection.
 *
 * Fonctions PURES. Regles :
 *   - https obligatoire (pas d'http, de file:, de data:, de ftp:) ;
 *   - aucun identifiant dans l'URL (https://hote@127.0.0.1/ : l'hote reel est apres l'arobase) ;
 *   - aucune adresse locale ou privee : localhost, 127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10, 0/8, multicast...
 *     L'analyse se fait sur l'URL NORMALISEE par le standard WHATWG, qui ramene 2130706433, 0x7f.1 ou 0177.0.0.1 a 127.0.0.1 :
 *     on teste donc ce que la requete visera reellement, pas ce que la chaine a l'air de dire ;
 *   - toute adresse IPv6 litterale est refusee (::1, fe80::, ::ffff:127.0.0.1, fc00::...) : aucun appelant legitime n'en donne ;
 *   - un nom sans point (« intranet ») ou en .local / .internal / .lan... est refuse ;
 *   - si une liste d'hotes est fournie, l'hote doit y figurer (« exemple.com » exact, « *.exemple.com » ou « .exemple.com » =
 *     sous-domaines). Sans liste (null) : n'importe quel hote PUBLIC (glisser-deposer d'une image depuis un site quelconque).
 *
 * Reste un angle que la chaine ne montre pas : un NOM public qui pointe sur une adresse privee (rebinding DNS, « 127.0.0.1.nip.io »).
 * Il est couvert par creerLookupPublic(), a passer en option `lookup` de https.get : la resolution est refusee si une seule
 * adresse rendue n'est pas publique. */

// « a.b.c.d » strict (chaque champ 0-255, sans zero initial ambigu) -> [a, b, c, d] ou null.
function _octetsIPv4(s) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(s));
  if (!m) return null;
  const o = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  return o.every((n) => n >= 0 && n <= 255) ? o : null;
}

// Vrai si l'adresse IPv4 n'est PAS une adresse publique routable.
function _ipv4NonPublique(o) {
  const [a, b, c] = o;
  if (a === 0 || a === 10 || a === 127) return true;               // « ce reseau », prive, boucle locale
  if (a === 169 && b === 254) return true;                         // lien local, metadonnees des hebergeurs
  if (a === 172 && b >= 16 && b <= 31) return true;                // prive
  if (a === 192 && b === 168) return true;                         // prive
  if (a === 100 && b >= 64 && b <= 127) return true;               // CGNAT
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;   // reserve IETF, documentation
  if (a === 198 && (b === 18 || b === 19)) return true;            // bancs d'essai
  if (a === 198 && b === 51 && c === 100) return true;             // documentation
  if (a === 203 && b === 0 && c === 113) return true;              // documentation
  if (a >= 224) return true;                                       // multicast, reserve, diffusion
  return false;
}

// IPv6 -> 8 groupes de 16 bits, ou null. Gere « :: », la zone « %eth0 » et la queue IPv4 (::ffff:1.2.3.4).
function _groupesIPv6(ip) {
  let s = String(ip).toLowerCase();
  const z = s.indexOf('%');
  if (z !== -1) s = s.slice(0, z);
  if (!net.isIPv6(s)) return null;
  const q = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (q) {
    const o = _octetsIPv4(q[2]);
    if (!o) return null;
    s = q[1] + ((o[0] << 8) | o[1]).toString(16) + ':' + ((o[2] << 8) | o[3]).toString(16);
  }
  const i = s.indexOf('::');
  let tete; let queue;
  if (i === -1) { tete = s.split(':'); queue = []; }
  else {
    tete = s.slice(0, i) ? s.slice(0, i).split(':') : [];
    queue = s.slice(i + 2) ? s.slice(i + 2).split(':') : [];
  }
  const manque = 8 - tete.length - queue.length;
  if (i === -1 ? tete.length !== 8 : manque < 0) return null;
  const tout = i === -1 ? tete : tete.concat(new Array(manque).fill('0'), queue);
  const g = tout.map((x) => parseInt(x, 16));
  return g.length === 8 && g.every((n) => Number.isFinite(n)) ? g : null;
}

/* adresseIpPubliqueSure(ip) : vrai SEULEMENT pour une adresse IPv4/IPv6 publique routable. En cas de doute : faux.
 * IPv6 : seul 2000::/3 (monodiffusion globale) est admis, et les formes qui ENCAPSULENT de l'IPv4 (::ffff:a.b.c.d,
 * 64:ff9b::/96, 2002::/16 « 6to4 ») sont jugees sur l'IPv4 qu'elles contiennent. */
function adresseIpPubliqueSure(ip) {
  const texte = String(ip == null ? '' : ip).trim();
  if (net.isIPv4(texte)) {
    const o = _octetsIPv4(texte);
    return !!o && !_ipv4NonPublique(o);
  }
  const g = _groupesIPv6(texte);
  if (!g) return false;
  const v4 = (hi, lo) => [hi >> 8, hi & 255, lo >> 8, lo & 255];
  if (g.slice(0, 5).every((n) => n === 0) && (g[5] === 0xffff || g[5] === 0)) return !_ipv4NonPublique(v4(g[6], g[7]));
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((n) => n === 0)) return !_ipv4NonPublique(v4(g[6], g[7]));
  if (g[0] === 0x2002) return !_ipv4NonPublique(v4(g[1], g[2]));
  if (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0xdb8)) return false;   // Teredo, documentation
  return (g[0] & 0xe000) === 0x2000;
}

const _SUFFIXES_LOCAUX = ['.localhost', '.local', '.localdomain', '.internal', '.intranet', '.lan', '.home', '.home.arpa', '.corp', '.private'];

function _hoteDansListe(hote, liste) {
  return liste.some((entree) => {
    const e = String(entree || '').toLowerCase().replace(/\.+$/, '');
    if (!e) return false;
    if (e.startsWith('*.')) return hote.endsWith(e.slice(1)) && hote.length > e.length - 1;
    if (e.startsWith('.')) return hote.endsWith(e) && hote.length > e.length;
    return hote === e;
  });
}

/* analyserUrlTelechargement(url, hotesAutorises) -> { ok: true, url, hote } | { ok: false, raison }.
 * `url` rendue est l'adresse NORMALISEE : c'est elle qu'il faut ouvrir, pas la chaine d'origine. */
function analyserUrlTelechargement(url, hotesAutorises) {
  const refus = (raison) => ({ ok: false, raison });
  if (typeof url !== 'string' || !url.trim()) return refus('adresse vide');
  if (url.length > 4096) return refus('adresse trop longue');
  if (/[\u0000-\u001f\u007f\\]/.test(url)) return refus('caractere interdit dans l\'adresse');
  let u;
  try { u = new URL(url.trim()); } catch (_) { return refus('adresse illisible'); }
  if (u.protocol !== 'https:') return refus('https obligatoire');
  if (u.username || u.password) return refus('identifiants dans l\'adresse');
  const hote = u.hostname.toLowerCase().replace(/\.+$/, '');
  if (!hote) return refus('hote absent');
  if (hote.startsWith('[') || hote.includes(':')) return refus('adresse IPv6 litterale');
  if (net.isIPv4(hote)) {
    if (!adresseIpPubliqueSure(hote)) return refus('adresse locale ou privee');
  } else {
    if (!hote.includes('.')) return refus('nom sans domaine (reseau local)');
    if (hote === 'localhost' || _SUFFIXES_LOCAUX.some((s) => hote.endsWith(s))) return refus('nom local');
  }
  if (Array.isArray(hotesAutorises) && !_hoteDansListe(hote, hotesAutorises)) return refus('hote non autorise');
  return { ok: true, url: u.href, hote };
}

function urlTelechargementAutorisee(url, hotesAutorises) {
  return analyserUrlTelechargement(url, hotesAutorises).ok;
}

/* creerLookupPublic(dnsLookup) : enveloppe dns.lookup (a passer en option `lookup` de https.get). Refuse la resolution
 * si UNE SEULE adresse rendue n'est pas publique (rebinding DNS, nom public pointant chez soi). */
function creerLookupPublic(dnsLookup) {
  return function lookupPublic(hote, options, rappel) {
    if (typeof options === 'function') { rappel = options; options = {}; }
    dnsLookup(hote, options, (err, adresse, famille) => {
      if (err) return rappel(err, adresse, famille);
      const liste = Array.isArray(adresse) ? adresse : [{ address: adresse, family: famille }];
      if (!liste.length || liste.some((a) => !adresseIpPubliqueSure(a && a.address))) {
        const e = new Error('adresse non publique refusee pour ' + hote);
        e.code = 'EADRBLOQUEE';
        return rappel(e);
      }
      return rappel(null, adresse, famille);
    });
  };
}

/* ---------------------------------------------------------------- D-08 -- */

/* NOMS DE PROJET MASQUES DANS CE QUI QUITTE LA MACHINE (2026-10-03, constat D-08 : la politique de confidentialite annonce un
 * rapport « debarrasse des textes saisis », or le nom de projet saisi par l'utilisateur partait tel quel). Chaque nom connu est
 * remplace par « projet-xxxxxx » (6 caracteres hexadecimaux du SHA-256 du nom en minuscules) : COURT et STABLE, deux rapports du meme
 * projet portent le meme identifiant, sans que le nom soit lisible. Les noms trop courts (< 3) ou trop generiques sont ignores,
 * sinon on masquerait « log » ou « mesh » partout. Un nom est reconnu entre deux caracteres non alphanumeriques (« _ » compte
 * comme separateur : « bus_1727.glb » est masque), sans tenir compte de la casse. */
const _NOMS_GENERIQUES = new Set(['cloud_import', 'images', 'image', 'meshes', 'mesh', 'logs', 'log', 'error', 'errors', 'info', 'warn',
  'debug', 'test', 'tests', 'temp', 'tmp', 'default', 'project', 'projects', 'null', 'undefined', 'true', 'false', 'none', 'data',
  'cloud', 'local', 'user', 'users', 'node', 'electron', 'python', 'main', 'renderer', 'untitled', 'new project']);

function identifiantProjet(nom) {
  return 'projet-' + crypto.createHash('sha256').update(String(nom).trim().toLowerCase()).digest('hex').slice(0, 6);
}

function masquerNomsProjet(texte, noms) {
  if (typeof texte !== 'string' || !texte || !Array.isArray(noms) || !noms.length) return texte;
  const uniques = new Map();
  for (const brut of noms) {
    if (typeof brut !== 'string') continue;
    const n = brut.trim();
    if (n.length < 3 || n.length > 200 || _NOMS_GENERIQUES.has(n.toLowerCase())) continue;
    uniques.set(n.toLowerCase(), n);
  }
  if (!uniques.size) return texte;
  const echappe = [...uniques.values()].sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp('(?<![A-Za-z0-9])(?:' + echappe.join('|') + ')(?![A-Za-z0-9])', 'gi');
  return texte.replace(re, (trouve) => identifiantProjet(trouve));
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
  masquerNomsDansEvenement,
  blenderExeValide,
  pasTexturePourPalier,
  estPlantageNatif,
  urlTelechargementAutorisee,
  analyserUrlTelechargement,
  adresseIpPubliqueSure,
  creerLookupPublic,
  identifiantProjet,
  masquerNomsProjet,
};
