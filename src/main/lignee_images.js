'use strict';
/* LIGNEE DES VERSIONS D'IMAGE (2026-10-01, user : « il faut que j'aie les View generation history sur les versions d'images aussi, il manque des
 * parametres »).
 *
 * CONSTAT : l'historique de generation (popup ⏱) existait pour les maillages, rigs et animations (sidecar `<fichier>.meta.json`, voir meta.js),
 * mais AUCUNE version d'image n'ecrivait de sidecar : l'image n'avait ni action « historique » ni parametres a montrer.
 *
 * COMMENT : un SEUL point d'entree. main.js enveloppe ipcMain.handle ; pour les canaux qui produisent des images (CANAUX ci-dessous), l'enveloppe
 * lit les arguments EXACTS envoyes au moteur et le resultat, puis ecrit le sidecar de chaque image nouvelle : parent (l'image de depart), operation,
 * moteur, parametres, duree. Aucun des ~15 gestionnaires n'est modifie, et un nouvel outil qui passe par un de ces canaux est suivi tout seul.
 * Meme principe que meta.js : ne jamais lever d'exception (un sidecar rate ne doit jamais casser une generation).
 *
 * Fonctions PURES ici (aucune ecriture) : le banc build/test-lignee-images.mjs les appelle telles quelles. */
const path = require('path');

// canal -> { op } ; op null = deduite du suffixe du nom de fichier produit
const CANAUX = {
  'generate-images': { op: 'generate', racine: true },
  'img2img': { op: null },
  'mask-inpaint': { op: 'inpaint' },
  'auto-inpaint': { op: 'inpaint' },
  'tex-variant': { op: 'texvar' },
  'recolor': { op: 'recolor' },
  'remove-background': { op: 'nobg' },
  'outfit-cutout': { op: 'outfit' },
  'generate-construction-stages': { op: 'chantier' },
  'generate-multiview': { op: 'multiview' },
  'generate-back-view': { op: 'backview' },
  'image-adjust': { op: null },
  'image-quick-edit': { op: null },
  'save-image-data-url': { op: null },
};

// suffixe de nom de fichier -> operation (le nom ne garde que la DERNIERE operation : _meshRootBase fait pareil pour les maillages)
const SUFFIXE_OP = {
  refined: 'modify', texvar: 'texvar', inpaint: 'inpaint', nobg: 'nobg', recolor: 'recolor', upscale: 'upscale', downscale: 'downscale',
  brightness: 'brightness', blur: 'blur', painted: 'paint', cloned: 'clone', edit: 'edit', extend: 'extend', crop: 'crop',
  symmetrize: 'symmetrize', symmetrized: 'symmetrize', outfit: 'outfit', facefix: 'facefix', mv: 'multiview', chantier: 'chantier',
  style: 'style', adjust: 'adjust',
};
const RE_SUFFIXE = /^(.*)_([a-z]+)_(\d{13})(?:_\d+)?(\.[a-z0-9]+)$/i;

/** Operation et parent DEDUITS du nom d'un fichier (images anterieures au suivi) : { op, parent, ts } ou null pour une image racine. */
function deduireDuNom(fichier) {
  const dossier = path.dirname(fichier);
  const m = path.basename(fichier).match(RE_SUFFIXE);
  if (!m || !SUFFIXE_OP[m[2].toLowerCase()]) return null;
  return { op: SUFFIXE_OP[m[2].toLowerCase()], parent: path.join(dossier, m[1] + m[4]), ts: Number(m[3]) };
}

const CLES_EXCLUES = /^(imagePath|basePath|frontImage|sourcePath|dataUrl|maskDataUrl|uvMaskDataUrl|image|lignee|projectName)$/i;
function tronquer(v, prof) {
  if (typeof v === 'string') return /^data:/i.test(v) ? undefined : (v.length > 1200 ? v.slice(0, 1200) + '…' : v);
  if (typeof v === 'number' || typeof v === 'boolean' || v === null) return v;
  if (Array.isArray(v)) return (v.length <= 32 && v.every((x) => ['string', 'number', 'boolean'].includes(typeof x))) ? v.map((x) => tronquer(x, prof + 1)) : undefined;
  if (v && typeof v === 'object' && prof < 2) {
    const o = {};
    for (const [k, x] of Object.entries(v)) { const t = tronquer(x, prof + 1); if (t !== undefined) o[k] = t; }
    return Object.keys(o).length ? o : undefined;
  }
  return undefined;
}
/** Parametres EXACTS envoyes au moteur, sans rien de volumineux (images en data-URL, masques) ni les chemins (ils vont dans `parent`). */
function parametresPropres(a0) {
  const out = {};
  if (!a0 || typeof a0 !== 'object') return out;
  for (const [k, v] of Object.entries(a0)) {
    if (CLES_EXCLUES.test(k)) continue;
    const t = tronquer(v, 0);
    if (t !== undefined) out[k] = t;
  }
  return out;
}

function parentDe(a0) {
  if (typeof a0 === 'string') return a0;
  if (!a0 || typeof a0 !== 'object') return null;
  return a0.imagePath || a0.basePath || a0.frontImage || a0.sourcePath || null;
}

const RE_IMG = /\.(png|jpe?g|webp)$/i;
/** Chemins d'images cites par un resultat (champs path / images / pieces / ...), hors miniatures, apercus et sources. */
function sortiesDe(res) {
  const out = new Set();
  const visite = (v, prof) => {
    if (v == null || prof > 3) return;
    if (typeof v === 'string') { if (RE_IMG.test(v) && /[\\/]/.test(v)) out.add(v); return; }
    if (Array.isArray(v)) { v.slice(0, 64).forEach((x) => visite(x, prof + 1)); return; }
    if (typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (/^(thumb|preview|source|input|parent|mask|original)/i.test(k)) continue; visite(x, prof + 1); }
  };
  visite(res, 0);
  return [...out];
}

/** Sidecars a ecrire pour un appel IPC termine : [{ chemin, meta }]. `deps` : { existe(p), mtime(p) } (injectes pour les essais). */
function lignees(canal, args, resultat, dureeMs, debutMs, deps) {
  const cfg = CANAUX[canal];
  if (!cfg) return [];
  if (resultat && resultat.success === false) return [];
  const a0 = args && args[0];
  const parent = cfg.racine ? null : parentDe(a0);
  const params = parametresPropres(a0);
  const indice = a0 && typeof a0 === 'object' && a0.lignee && typeof a0.lignee === 'object' ? a0.lignee : null;   // surcharge facultative du rendu : { op, params }
  const sorties = sortiesDe(resultat).filter((p) => p !== parent && deps.existe(p) && deps.mtime(p) >= debutMs - 3000);
  return sorties.map((chemin) => {
    const d = deduireDuNom(chemin);
    const op = (indice && indice.op) || cfg.op || (d && d.op) || canal;
    const m = { kind: 'image', op, parent: parent || (d && d.parent) || null, params: Object.assign({}, params, indice && indice.params ? tronquer(indice.params, 0) || {} : {}), durationMs: Math.round(dureeMs) };
    if (cfg.racine) delete m.parent;
    if (a0 && typeof a0 === 'object' && a0.engine) m.engine = String(a0.engine);
    if (!m.parent) delete m.parent;
    return { chemin, meta: m };
  });
}

module.exports = { CANAUX, SUFFIXE_OP, deduireDuNom, parametresPropres, parentDe, sortiesDe, lignees };
