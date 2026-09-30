'use strict';
/* =============================================================================
 * Budgets memoire des generations locales (2026-09-30) — calculs PURS.
 *
 * Memes definitions que scripts/cloisonnement_memoire.py, qui POSE les plafonds
 * dans chaque processus Python (Job Object Windows pour la RAM, fraction PyTorch
 * pour la VRAM). main.js s'en sert AVANT de lancer un travail : la file
 * d'attente du renderer demande « ce travail tient-il maintenant ? », le moteur
 * 3D choisit un mode qui tient, et un refus donne une phrase claire.
 *
 *   budget RAM  = limite RAM (marqueur blanc) - RAM utilisee par tout le reste
 *   budget VRAM = limite VRAM (marqueur blanc) - VRAM deja occupee (nvidia-smi)
 *
 * Besoin d'un travail : le PIC MESURE lors du dernier travail du meme type
 * (journal logs/memoire_pics.jsonl ecrit par cloisonnement_memoire.terminer :
 * pic d'engagement exact moins les reservations d'initialisation, l'unite meme
 * du plafond) ; a defaut, la valeur fournie par l'appelant.
 *
 * Tests : node build/test-budget-memoire.mjs
 * ========================================================================== */

const PHRASE_RAM = 'This generation needs about {x} GB of RAM but only {y} GB are available '
  + 'under your limit. Close other apps or raise the RAM limit in Settings.';
const PHRASE_VRAM = 'This generation needs about {x} GB of VRAM but only {y} GB are available '
  + 'under your limit. Close other apps using the graphics card or raise the VRAM limit in Settings.';

/** Limite RAM (Mo) : le marqueur (FABMESH_RAM_LIMIT_MB) borne a la RAM physique ;
 *  sans marqueur, la RAM physique (ne jamais pousser le PC dans le fichier d'echange). */
function limiteRamMo(limiteMarqueurMo, totalMo) {
  const v = Number(limiteMarqueurMo);
  return (v > 0) ? Math.min(totalMo, v) : totalMo;
}

function budgetRamMo({ limiteMo, utiliseeMo }) {
  return Math.max(0, limiteMo - utiliseeMo);
}

/** Limite VRAM (Mo) : fraction du marqueur (0,95 par defaut, comme les scripts). */
function limiteVramMo(fraction, totalMo) {
  const f = Number(fraction);
  return ((f > 0 && f <= 1) ? f : 0.95) * totalMo;
}

function budgetVramMo({ limiteMo, utiliseeMo }) {
  return Math.max(0, limiteMo - utiliseeMo);
}

/** Mo -> Go au dixieme : vers le haut pour un besoin, vers le bas pour un disponible. */
function versGo(mo, sens = 'haut') {
  const x = (Number(mo) || 0) / 1024 * 10;
  return Math.max(0, (sens === 'bas' ? Math.floor(x + 1e-9) : Math.ceil(x - 1e-9)) / 10);
}

/** Journal des pics -> Map cle -> { besoinMo (RAM), besoinVramMo, issue, date }. Un
 *  travail REUSSI donne ses pics mesures ; un refus par manque de memoire plus recent
 *  releve le besoin (RAM ou VRAM selon `manque`) a ce qu'il avait demande : on ne
 *  relance pas un travail voue a l'echec. */
function lirePics(texte) {
  const m = new Map();
  for (const ligne of String(texte || '').split(/\r?\n/)) {
    if (!ligne.trim()) continue;
    let j;
    try { j = JSON.parse(ligne); } catch (_) { continue; }
    if (!j || !j.cle) continue;
    const prec = m.get(j.cle) || {};
    if (j.issue === 'ok' && Number(j.pic_prive_mo) > 0) {
      const vram = Number(j.pic_vram_reserve_mo) > 0
        ? Number(j.pic_vram_reserve_mo) + (Number(j.vram_contexte_mo) || 0) : null;
      m.set(j.cle, { besoinMo: Number(j.pic_prive_mo), besoinVramMo: vram, issue: 'ok', date: j.date || null });
    } else if (j.issue === 'memoire' && Number(j.besoin_mo) > 0) {
      const b = Number(j.besoin_mo);
      m.set(j.cle, j.manque === 'vram'
        ? { ...prec, besoinVramMo: Math.max(prec.besoinVramMo || 0, b), issue: 'memoire', date: j.date || null }
        : { ...prec, besoinMo: Math.max(prec.besoinMo || 0, b), issue: 'memoire', date: j.date || null });
    }
  }
  return m;
}

function _plusFaible(pics, cles, champ, defaut) {
  let meilleur = null;
  for (const c of [].concat(cles || [])) {
    const p = pics && pics.get(c);
    const v = p ? p[champ] : null;
    if (v != null && (meilleur == null || v < meilleur)) meilleur = v;
  }
  return meilleur != null ? meilleur : defaut;
}

/** Besoin RAM (Mo) pour une ou plusieurs cles : la plus FAIBLE mesure (le travail
 *  peut prendre la variante la plus legere), sinon `defautMo`. */
function besoinMo(pics, cles, defautMo) {
  return _plusFaible(pics, cles, 'besoinMo', defautMo);
}

/** Besoin VRAM (Mo) mesure (pic reserve par PyTorch + contexte CUDA), sinon `defautMo`. */
function besoinVramMo(pics, cles, defautMo) {
  return _plusFaible(pics, cles, 'besoinVramMo', defautMo);
}

function phraseManque(type, besoinGo, dispoGo) {
  return (type === 'vram' ? PHRASE_VRAM : PHRASE_RAM)
    .replace('{x}', Number(besoinGo).toFixed(1)).replace('{y}', Number(dispoGo).toFixed(1));
}

/** Le travail tient-il ? RAM d'abord (c'est elle qui gele le PC), puis VRAM.
 *  Un budget inconnu (null) ne bloque pas. */
function verdict({ besoinRamMo, budgetRamMo: bRam, besoinVramMo, budgetVramMo: bVram }) {
  if (besoinRamMo != null && bRam != null && besoinRamMo > bRam) {
    const besoinGo = versGo(besoinRamMo), dispoGo = versGo(bRam, 'bas');
    return { ok: false, type: 'ram', besoinGo, dispoGo, phrase: phraseManque('ram', besoinGo, dispoGo) };
  }
  if (besoinVramMo != null && bVram != null && besoinVramMo > bVram) {
    const besoinGo = versGo(besoinVramMo), dispoGo = versGo(bVram, 'bas');
    return { ok: false, type: 'vram', besoinGo, dispoGo, phrase: phraseManque('vram', besoinGo, dispoGo) };
  }
  return { ok: true };
}

/** Phrase de manque de memoire ecrite par un script (marqueur
 *  FABMESH_MEMOIRE_INSUFFISANTE) dans sa sortie ; null s'il n'y en a pas. */
function manqueDansSortie(texte) {
  const m = String(texte || '').match(/FABMESH_MEMOIRE_INSUFFISANTE (\{[^\r\n]*\})/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[1]);
    const type = j.type === 'vram' ? 'vram' : 'ram';
    return { type, besoinGo: Number(j.besoin_go) || 0, dispoGo: Number(j.dispo_go) || 0,
      phrase: phraseManque(type, Number(j.besoin_go) || 0, Number(j.dispo_go) || 0) };
  } catch (_) { return null; }
}

module.exports = {
  PHRASE_RAM, PHRASE_VRAM,
  limiteRamMo, budgetRamMo, limiteVramMo, budgetVramMo, versGo,
  lirePics, besoinMo, besoinVramMo, phraseManque, verdict, manqueDansSortie,
};
