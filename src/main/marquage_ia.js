'use strict';
// Marquage « genere par IA » des GLB — reglement (UE) 2024/1689 (AI Act), article 50.
//
// 2026-10-03 (vague 3, voie marquage-bureau). POURQUOI : la generation marque son GLB
// (asset.generator + asset.extras.aiGenerated, scripts/add_ai_metadata.py), mais tout
// fichier DERIVE le perdait : outils de maillage (trimesh), editeur de maillage et Paint
// Mesh (THREE.GLTFExporter), rig (Blender). Le livrable de l'utilisateur n'etait plus
// marque ; echeance reglementaire pour les systemes existants : 2026-12-02.
//
// Meme resultat que add_ai_metadata.patch_glb (Python) : memes cles, memes valeurs.
// Lecture de l'en-tete et du chunk JSON SEULEMENT, puis recopie EN FLUX (blocs de 8 Mo) vers
// un fichier temporaire du meme dossier et renommage : un GLB de plusieurs centaines de Mo
// n'est jamais charge en memoire, et l'original reste intact tant que le renommage n'a pas
// eu lieu. Idempotent : un fichier deja marque n'est pas reecrit. Ne leve JAMAIS d'exception.
//
// Les formats FBX / OBJ / STL ne peuvent pas porter ce marquage (pas de champ extras) :
// ils ne sont pas traites ici.

const fs = require('fs');

const BLOC = 8 * 1024 * 1024;            // taille des blocs de recopie
const JSON_MAX = 256 * 1024 * 1024;      // un chunk JSON plus gros est anormal : on ne touche pas
const VERSION_DEFAUT = '1.0.0';          // comme le Python
const SUFFIXE_TMP = '.marquage-ia.tmp';

function _version() {
  // app.getVersion() quand Electron est la ; en Node pur (tests), require('electron') est
  // une chaine ou echoue : on retombe sur la valeur du Python.
  try {
    const el = require('electron');
    const v = el && el.app && typeof el.app.getVersion === 'function' ? el.app.getVersion() : '';
    if (typeof v === 'string' && /^[0-9][0-9A-Za-z.+-]*$/.test(v)) return v;
  } catch (_) { /* hors Electron */ }
  return VERSION_DEFAUT;
}

function dejaMarque(gltf) {
  const a = gltf && typeof gltf === 'object' ? gltf.asset : null;
  const e = a && typeof a === 'object' ? a.extras : null;
  return !!(e && typeof e === 'object'
    && e.aiGenerated === true && e.aiSystem === 'FabMesh' && e.aiActArticle50 === true
    && typeof a.generator === 'string' && a.generator.includes('(AI-generated)'));
}

function _lire(fd, buf, longueur, position) {
  let lu = 0;
  while (lu < longueur) {
    const n = fs.readSync(fd, buf, lu, longueur - lu, position + lu);
    if (n <= 0) break;
    lu += n;
  }
  return lu;
}

function _dormir(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (_) { /* tant pis */ }
}

// Renommage atomique ; sous Windows un antivirus ou l'indexeur peut tenir le fichier une fraction de seconde.
function _remplacer(tmp, cible) {
  let derniere = null;
  for (let i = 0; i < 5; i++) {
    try { fs.renameSync(tmp, cible); return; } catch (e) {
      derniere = e;
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(e && e.code)) break;
      _dormir(150 * (i + 1));
    }
  }
  throw derniere;
}

/**
 * Marque le GLB `chemin` comme genere par IA (AI Act art. 50), en place.
 * @returns {{ok: boolean, deja: boolean, raison: string}}
 *   ok:true deja:true  -> deja marque, fichier non touche
 *   ok:true deja:false -> marque maintenant
 *   ok:false           -> fichier laisse intact, `raison` explique pourquoi
 */
function marquerGlbIA(chemin, options) {
  let fd = null;
  let tmp = null;
  let sortie = null;
  try {
    if (typeof chemin !== 'string' || !chemin) return { ok: false, deja: false, raison: 'chemin invalide' };
    if (!/\.glb$/i.test(chemin)) return { ok: false, deja: false, raison: 'pas un .glb (FBX / OBJ / STL ne portent pas ce marquage)' };
    const taille = fs.statSync(chemin).size;
    fd = fs.openSync(chemin, 'r');

    const entete = Buffer.alloc(20);
    if (_lire(fd, entete, 20, 0) < 20 || entete.toString('latin1', 0, 4) !== 'glTF') {
      return { ok: false, deja: false, raison: 'GLB invalide (en-tete)' };
    }
    const version = entete.readUInt32LE(4);
    const total = entete.readUInt32LE(8);
    if (version !== 2) return { ok: false, deja: false, raison: 'version GLB ' + version + ' non geree' };
    if (total !== taille) return { ok: false, deja: false, raison: 'taille incoherente (en-tete ' + total + ', fichier ' + taille + ')' };
    const jsonLen = entete.readUInt32LE(12);
    if (entete.toString('latin1', 16, 20) !== 'JSON') return { ok: false, deja: false, raison: 'le premier chunk n\'est pas JSON' };
    if (jsonLen > JSON_MAX || 20 + jsonLen > taille) return { ok: false, deja: false, raison: 'chunk JSON incoherent (' + jsonLen + ')' };

    const blob = Buffer.alloc(jsonLen);
    if (_lire(fd, blob, jsonLen, 20) < jsonLen) return { ok: false, deja: false, raison: 'chunk JSON tronque' };
    let gltf;
    // certains exporteurs remplissent le chunk JSON par des NUL : on les ecarte avant de lire
    try { gltf = JSON.parse(blob.toString('utf8').replace(/[\0\s]+$/, '')); } catch (e) {
      return { ok: false, deja: false, raison: 'JSON illisible : ' + e.message };
    }
    if (!gltf || typeof gltf !== 'object' || Array.isArray(gltf)) return { ok: false, deja: false, raison: 'racine JSON inattendue' };

    if (dejaMarque(gltf)) return { ok: true, deja: true, raison: '' };

    const v = (options && options.version) || _version();
    if (!gltf.asset || typeof gltf.asset !== 'object' || Array.isArray(gltf.asset)) gltf.asset = {};
    gltf.asset.generator = 'FabMesh ' + v + ' (AI-generated)';
    if (!gltf.asset.extras || typeof gltf.asset.extras !== 'object' || Array.isArray(gltf.asset.extras)) gltf.asset.extras = {};
    gltf.asset.extras.aiGenerated = true;
    gltf.asset.extras.aiSystem = 'FabMesh';
    gltf.asset.extras.aiActArticle50 = true;

    let nouveau = Buffer.from(JSON.stringify(gltf), 'utf8');
    const pad = (4 - (nouveau.length % 4)) % 4;
    if (pad) nouveau = Buffer.concat([nouveau, Buffer.alloc(pad, 0x20)]);   // espaces : exige par la spec GLB
    const reste = taille - 20 - jsonLen;
    const nouveauTotal = 12 + 8 + nouveau.length + reste;
    if (nouveauTotal > 0xFFFFFFFF) return { ok: false, deja: false, raison: 'GLB trop gros pour etre reecrit (> 4 Go)' };

    tmp = chemin + SUFFIXE_TMP;
    sortie = fs.openSync(tmp, 'w');
    const tete = Buffer.alloc(20);
    tete.write('glTF', 0, 'latin1');
    tete.writeUInt32LE(2, 4);
    tete.writeUInt32LE(nouveauTotal, 8);
    tete.writeUInt32LE(nouveau.length, 12);
    tete.write('JSON', 16, 'latin1');
    fs.writeSync(sortie, tete);
    fs.writeSync(sortie, nouveau);

    // Recopie du reste (chunk binaire et suivants) octet pour octet, par blocs.
    const bloc = Buffer.alloc(Math.min(BLOC, Math.max(reste, 1)));
    let pos = 20 + jsonLen;
    let copie = 0;
    while (copie < reste) {
      const n = _lire(fd, bloc, Math.min(bloc.length, reste - copie), pos);
      if (n <= 0) throw new Error('lecture du chunk binaire interrompue (' + copie + '/' + reste + ')');
      let ecrit = 0;
      while (ecrit < n) ecrit += fs.writeSync(sortie, bloc, ecrit, n - ecrit);
      pos += n;
      copie += n;
    }
    try { fs.fsyncSync(sortie); } catch (_) { /* meilleur effort */ }
    fs.closeSync(sortie); sortie = null;
    fs.closeSync(fd); fd = null;
    if (fs.statSync(tmp).size !== nouveauTotal) throw new Error('taille du fichier temporaire incoherente');

    _remplacer(tmp, chemin);
    tmp = null;
    return { ok: true, deja: false, raison: '' };
  } catch (e) {
    return { ok: false, deja: false, raison: String((e && e.message) || e) };
  } finally {
    try { if (sortie !== null) fs.closeSync(sortie); } catch (_) {}
    try { if (fd !== null) fs.closeSync(fd); } catch (_) {}
    try { if (tmp) fs.unlinkSync(tmp); } catch (_) {}
  }
}

// ---------------------------------------------------------------------------------------------------------------
// POINTS DE SORTIE (2026-10-03, AI Act art. 50). UN SEUL endroit pour toutes les voies IPC qui livrent un GLB :
// main.js enveloppe ipcMain.handle (comme le suivi de lignee des images) et marque, APRES le retour du gestionnaire,
// les .glb que son RESULTAT nomme. Avantages : le chemin marque est toujours le chemin FINAL (jamais un fichier
// temporaire renomme ensuite), un nouvel outil de la liste est couvert sans toucher a son code, et un echec de
// marquage ne casse jamais l'operation (le resultat est rendu tel quel).
//
// FBX / OBJ / STL / PLY : pas de champ « extras » dans ces formats, donc non marques (le filtre .glb les ecarte).
// ---------------------------------------------------------------------------------------------------------------

// Canal -> ce qui le distingue. `aucunImporte` : ne pas marquer les fichiers dont le nom dit « importe par l'utilisateur ».
const CANAUX_SORTIE_GLB = {
  // generation (deja marquee par les scripts ; filet de securite idempotent, aucune reecriture si deja marque)
  'image-to-3d': {}, 'image-to-3d-trellis': {}, 'generate-from-image': {}, 'generate-from-prompt': {},
  'refine-mesh': {}, 'generate-build-stages': {}, 'run-blender-script': {},
  // outils de maillage
  'mesh-tool': {}, 'mesh-segment': {}, 'mesh-resize': {}, 'generate-explode-3d': {},
  'generate-construction-stages-3d': {}, 'material-adjust': {}, 'mesh:align-texture': {},
  'mesh:region-retex': {}, 'mesh:reshape-region': {}, 'enhance-mesh-texture': {}, 'detail-synth': {},
  // rig
  'auto-rig-ai': {}, 'auto-rig': {}, 'animate-ai': {},
  // animations (le GLB porte le maillage du rig)
  'anim:retarget': {}, 'anim:motion': {}, 'anim:kimodo': {}, 'anim:banque': {},
  // editeur de maillage, Paint Mesh, Paint Emissive, ajustement des poids, animation procedurale : le renderer
  // envoie le GLB (THREE.GLTFExporter) et main.js l'ecrit
  'save-buffer': { aucunImporte: true },
};
const CHAMPS_CHEMIN = ['path', 'newPath', 'versionMeshPath', 'meshPath', 'glbPath', 'anim_url', 'animPath'];
const IMPORTE = /_imported_/i;   // animation importee par l'utilisateur (renderer : `${type}_imported_${ts}__${rig}.glb`)

/** Liste des .glb a marquer d'apres le RESULTAT d'un gestionnaire (vide si l'operation a echoue). */
function cheminsGlbDeSortie(canal, res) {
  const cfg = CANAUX_SORTIE_GLB[canal];
  if (!cfg || !res || typeof res !== 'object') return [];
  if (res.success === false || res.ok === false) return [];
  const sortie = [];
  const ajouter = (o) => {
    if (!o || typeof o !== 'object') return;
    for (const champ of CHAMPS_CHEMIN) {
      const v = o[champ];
      if (typeof v === 'string' && /\.glb$/i.test(v) && !sortie.includes(v)) sortie.push(v);
    }
  };
  ajouter(res);
  if (Array.isArray(res.stages)) res.stages.forEach(ajouter);      // etapes de construction 3D / 2D->3D
  return cfg.aucunImporte ? sortie.filter((p) => !IMPORTE.test(p.replace(/^.*[\\/]/, ''))) : sortie;
}

/**
 * Enveloppe un gestionnaire IPC : si `canal` livre des GLB, les marque apres son retour.
 * Les autres canaux sont rendus INCHANGES. Ne modifie jamais le resultat, n'avale aucune erreur du gestionnaire.
 */
function envelopper(canal, fn, journal) {
  if (!CANAUX_SORTIE_GLB[canal] || typeof fn !== 'function') return fn;
  return async function (...a) {
    const res = await fn.apply(this, a);
    try {
      for (const p of cheminsGlbDeSortie(canal, res)) {
        const r = marquerGlbIA(p);
        if (typeof journal === 'function') {
          try { journal(canal, p, r); } catch (_) { /* journal facultatif */ }
        }
      }
    } catch (_) { /* le marquage ne doit jamais casser l'operation */ }
    return res;
  };
}

module.exports = { marquerGlbIA, dejaMarque, cheminsGlbDeSortie, envelopper, CANAUX_SORTIE_GLB };
