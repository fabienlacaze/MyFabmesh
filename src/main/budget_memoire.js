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
  + 'under your limit. Close other apps or lower the reserve for other apps in Settings.';
const PHRASE_VRAM = 'This generation needs about {x} GB of VRAM but only {y} GB are available '
  + 'under your limit. Close other apps using the graphics card or lower the reserve for other apps in Settings.';

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

/* MODELE DE RESERVE (2026-09-30, meme definition que scripts/cloisonnement_memoire.py) :
 *   part de l'appli = total - plancher - max(reserve pour les autres logiciels, ce qu'ils occupent vraiment). */
const PLANCHER_RAM_MO = 2048;
const PLANCHER_VRAM_MO = 512;
function budgetReserveMo({ totalMo, plancherMo, reserveMo, autresMo }) {
  return Math.max(0, totalMo - plancherMo - Math.max(Number(reserveMo) || 0, Number(autresMo) || 0));
}
/** Reserve la plus haute qui laisse encore passer l'outil le plus lourd (les autres restant dans leur reserve). */
function reserveMaxMo({ totalMo, plancherMo, besoinMaxMo }) {
  return Math.max(0, totalMo - plancherMo - (Number(besoinMaxMo) || 0));
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
    // RAM : pic de memoire RESIDENTE (pic_ws_mo), l'unite du plafond depuis le 2026-09-30 (scripts/cloisonnement_memoire.py) ;
    // l'ancien pic d'ENGAGEMENT (pic_prive_mo) comptait les reservations jamais occupees et gonflait le besoin (13,2 Go annonces
    // pour une 3D qui en occupe 5,1). Les refus RAM des anciennes lignes (issue 'memoire', manque 'ram') venaient du plafond
    // d'engagement disparu : ignores.
    if (j.issue === 'ok' && (Number(j.pic_ws_mo) > 0 || Number(j.pic_prive_mo) > 0)) {
      const vram = Number(j.pic_vram_reserve_mo) > 0
        ? Number(j.pic_vram_reserve_mo) + (Number(j.vram_contexte_mo) || 0) : null;
      // 3D (cles trellis2_*) : elle recommence dans un mode plus leger sur manque de VRAM (repli), donc son besoin de VRAM est le plus
      // PETIT mesure, pas le dernier (un gros objet comme le portail a 11,3 Go ne doit pas retenir une voiture qui passe a 8,2).
      const vramRetenue = (prec.besoinVramMo != null && vram != null) ? Math.min(prec.besoinVramMo, vram) : vram;   // plus petit pic reserve d'une reussite (voir main.js memory-needs)
      m.set(j.cle, { besoinMo: Number(j.pic_ws_mo) > 0 ? Number(j.pic_ws_mo) : Number(j.pic_prive_mo), besoinVramMo: vramRetenue, issue: 'ok', date: j.date || null });
    } else if (/^trellis2/.test(j.cle)) {
      continue;        // echec de la 3D : le repli le rattrape, ce n'est pas un besoin
    } else if (j.issue === 'memoire' && Number(j.besoin_mo) > 0 && j.manque === 'vram') {
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

/** Le travail tient-il ? Seule la VRAM peut faire ATTENDRE : un manque de RAM ne bloque plus (2026-09-30, « mettre les limites
 *  ne doit pas casser les generations ») — le plafond RESIDENT fait ralentir le calcul au lieu de le refuser ; il est signale
 *  par `ralenti`. Un budget inconnu (null) ne bloque pas. */
function verdict({ besoinRamMo, budgetRamMo: bRam, besoinVramMo, budgetVramMo: bVram }) {
  let ralenti = null;
  if (besoinRamMo != null && bRam != null && besoinRamMo > bRam) {
    ralenti = { type: 'ram', besoinGo: versGo(besoinRamMo), dispoGo: versGo(Math.max(0, bRam), 'bas') };
  }
  // MARGE VRAM de 10 % : le besoin varie d'une image a l'autre (3D : 8,2 Go mesures, puis 8,8 Go le 30/09 a 21:56 -> echec apres
  // 6 minutes de calcul). Mieux vaut attendre ou prevenir au lancement que d'echouer en fin de calcul.
  if (besoinVramMo != null) besoinVramMo = besoinVramMo * 1.1;
  if (besoinVramMo != null && bVram != null && besoinVramMo > bVram) {
    const besoinGo = versGo(besoinVramMo), dispoGo = versGo(bVram, 'bas');
    return { ok: false, type: 'vram', besoinGo, dispoGo, phrase: phraseManque('vram', besoinGo, dispoGo), ralenti };
  }
  return { ok: true, ralenti };
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
  PLANCHER_RAM_MO, PLANCHER_VRAM_MO, budgetReserveMo, reserveMaxMo,
};
