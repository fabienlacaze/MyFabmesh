// « Reshape a region » : VUE CHOISIE dans le visualiseur 3D (2026-10-19).
//
// Demande du proprietaire : « Reshape a region doit avoir un viewer 3D pour permettre d'afficher la zone que
// l'on souhaite, pas un 2D de face ». La fenetre a deux etapes : (1) un visualiseur 3D ou l'on tourne le modele,
// (2) la fenetre a plat (pinceau, nom de la partie, prompt) sur le rendu pris DEPUIS L'ANGLE CHOISI.
//
// Ce module est SANS dependance (ni three.js ni DOM) et IDENTIQUE sur le bureau et le site
// (src/renderer/lib/reshape-vue.js = cloud/public/app/lib/reshape-vue.js, garde check-noyaux-partages).
// Ses regles sont celles de scripts/mesh_inpaint.py (valider_vue, matrice_vue, xmag_pour_vue) et de
// src/main/reshape_vue.js (bureau, CommonJS) ; les cas de build/bancs/noyaux/reshape_vue_cas.json sont rejoues
// par les trois.
//
// Contrat : yaw (autour de Y) dans [-180, 180], pitch (autour de X) dans [-90, 90], en degres, nombres finis.
// yaw 0 / pitch 0 = la vue de face d'avant. La camera du visualiseur est vue depuis le centre : sa direction est
// d = (sin yaw cos pitch, sin pitch, cos yaw cos pitch). La chaine serveur fait tourner le MAILLAGE pour que d
// regarde +Z (matrice Rx(pitch) . Ry(-yaw)), puis remet le resultat dans le repere d'origine.

export const YAW_MAX = 180;
export const PITCH_MAX = 90;
export const XMAG = 0.6;
export const PAS_XMAG = 0.05;
export const XMAG_MAX = 3.0;

function un(v, nom, borne) {
  if (v === null || v === undefined) return { ok: true, v: 0 };
  if (typeof v !== 'number') return { ok: false, erreur: nom + ' must be a number' };
  if (!Number.isFinite(v)) return { ok: false, erreur: nom + ' must be a finite number' };
  if (Math.abs(v) > borne) return { ok: false, erreur: nom + ' must be within [-' + borne + ', ' + borne + ']' };
  return { ok: true, v: v + 0 };               // -0 -> 0
}

/** { ok, yaw, pitch } ou { ok:false, erreur }. null / undefined = 0. */
export function validerVue(yaw, pitch) {
  const y = un(yaw, 'yaw', YAW_MAX);
  if (!y.ok) return y;
  const p = un(pitch, 'pitch', PITCH_MAX);
  if (!p.ok) return p;
  return { ok: true, yaw: y.v, pitch: p.v };
}

export function vueNeutre(yaw, pitch) {
  return Number(yaw) === 0 && Number(pitch) === 0;
}

/** Demi-largeur de la fenetre d'une vue tournee (meme regle que mesh_inpaint.xmag_pour_vue). */
export function xmagPourVue(maxAbs) {
  const x = Math.ceil(Number(maxAbs) * 1.03 / PAS_XMAG - 1e-9) * PAS_XMAG;
  return Math.round(Math.min(XMAG_MAX, Math.max(XMAG, x)) * 1e4) / 1e4;
}

/** Valide la demi-largeur recue (cadre, requete) : nombre fini dans [0,6 ; 3]. null = 0,6. */
export function validerXmag(x) {
  if (x === null || x === undefined) return { ok: true, xmag: XMAG };
  if (typeof x !== 'number' || !Number.isFinite(x) || x < XMAG || x > XMAG_MAX) {
    return { ok: false, erreur: 'xmag must be a number within [' + XMAG + ', ' + XMAG_MAX + ']' };
  }
  return { ok: true, xmag: x };
}

/** Objet { yaw, pitch, xmag } valide, ou { ok:false, erreur }. Vue neutre -> { ok, vue:null } (rien a envoyer). */
export function normaliserVue(vue) {
  if (vue === null || vue === undefined) return { ok: true, vue: null };
  if (typeof vue !== 'object' || Array.isArray(vue)) return { ok: false, erreur: 'view must be an object' };
  const a = validerVue(vue.yaw, vue.pitch);
  if (!a.ok) return a;
  if (vueNeutre(a.yaw, a.pitch)) return { ok: true, vue: null };
  const x = validerXmag(vue.xmag);
  if (!x.ok) return x;
  return { ok: true, vue: { yaw: a.yaw, pitch: a.pitch, xmag: x.xmag } };
}

/**
 * Angles (degres) de la camera du visualiseur autour de sa cible.
 * @param {{x:number,y:number,z:number}} position  position de la camera
 * @param {{x:number,y:number,z:number}} cible     point regarde (controls.target)
 * @param {number} [decimales=1]                   arrondi (0,1 degre : invisible, evite les -0)
 */
export function anglesDepuisCamera(position, cible, decimales = 1) {
  const dx = position.x - cible.x, dy = position.y - cible.y, dz = position.z - cible.z;
  const n = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!(n > 1e-9)) return { yaw: 0, pitch: 0 };
  const k = Math.pow(10, decimales);
  const pitchBrut = Math.asin(Math.max(-1, Math.min(1, dy / n))) * 180 / Math.PI;
  // au zenith / nadir la direction horizontale n'est plus definie : yaw 0 (le rendu ne depend plus de lui)
  const yawBrut = (Math.abs(dx) < 1e-9 && Math.abs(dz) < 1e-9) ? 0 : Math.atan2(dx, dz) * 180 / Math.PI;
  const arrondi = (v, borne) => Math.max(-borne, Math.min(borne, Math.round(v * k) / k)) + 0;
  return { yaw: arrondi(yawBrut, YAW_MAX), pitch: arrondi(pitchBrut, PITCH_MAX) };
}

/** Rotation 3x3 (ligne par ligne) : la direction de la camera va sur +Z (= mesh_inpaint.matrice_vue). */
export function matriceVue(yaw, pitch) {
  const a = -yaw * Math.PI / 180, b = pitch * Math.PI / 180;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  const ry = [[ca, 0, sa], [0, 1, 0], [-sa, 0, ca]];
  const rx = [[1, 0, 0], [0, cb, -sb], [0, sb, cb]];
  const r = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i][j] += rx[i][k] * ry[k][j];
  return r;
}

/** Libelle court de la vue (« Front », « Back, 20° up »...) : cles de traduction, pas de phrase construite. */
export function nomVue(yaw, pitch) {
  if (pitch >= 80) return 'Top';
  if (pitch <= -80) return 'Bottom';
  const a = ((yaw % 360) + 360) % 360;
  if (a <= 22.5 || a > 337.5) return 'Front';
  if (a > 157.5 && a <= 202.5) return 'Back';
  if (a > 67.5 && a <= 112.5) return 'Right';
  if (a > 247.5 && a <= 292.5) return 'Left';
  return 'Angled view';
}

/**
 * Ce que montre la fenetre « Reshape a region » a chaque etape : { id d'element -> visible }.
 * 0 = fenetre a plat seule (Re-texture a region, comme avant), 1 = visualiseur 3D (« Use this view »),
 * 2 = fenetre a plat sur la vue choisie (« Change view » pour revenir a 1, « Apply » pour lancer).
 */
export function affichageEtape(n) {
  return {
    'rrx-sous-titre': n !== 1,
    'rrx-3d-stage': n === 1,
    'rrx-3d-panel': n === 1,
    'rrx-stage': n !== 1,
    'rrx-form': n !== 1,
    'rrx-use-view': n === 1,
    'rrx-change-view': n === 2,
    'rrx-apply': n !== 1,
    'rrx-vue-nom': n === 2,
  };
}
