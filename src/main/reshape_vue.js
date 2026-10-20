'use strict';
// « Reshape a region » : validation de la VUE CHOISIE cote processus principal (2026-10-19).
// Memes regles que scripts/mesh_inpaint.py (valider_vue, xmag_pour_vue), que src/renderer/lib/reshape-vue.js
// et que le worker ; les cas de build/bancs/noyaux/reshape_vue_cas.json sont rejoues par chacun.
// yaw dans [-180, 180], pitch dans [-90, 90] (degres), nombres finis ; xmag dans [0,6 ; 3] ; yaw 0 / pitch 0 = vue de face
// (rien a transmettre, comportement d'avant).

const YAW_MAX = 180;
const PITCH_MAX = 90;
const XMAG = 0.6;
const XMAG_MAX = 3.0;

function un(v, nom, borne) {
  if (v === null || v === undefined) return { ok: true, v: 0 };
  if (typeof v !== 'number') return { ok: false, erreur: nom + ' must be a number' };
  if (!Number.isFinite(v)) return { ok: false, erreur: nom + ' must be a finite number' };
  if (Math.abs(v) > borne) return { ok: false, erreur: nom + ' must be within [-' + borne + ', ' + borne + ']' };
  return { ok: true, v: v + 0 };
}

function validerVue(yaw, pitch) {
  const y = un(yaw, 'yaw', YAW_MAX);
  if (!y.ok) return y;
  const p = un(pitch, 'pitch', PITCH_MAX);
  if (!p.ok) return p;
  return { ok: true, yaw: y.v, pitch: p.v };
}

function validerXmag(x) {
  if (x === null || x === undefined) return { ok: true, xmag: XMAG };
  if (typeof x !== 'number' || !Number.isFinite(x) || x < XMAG || x > XMAG_MAX) {
    return { ok: false, erreur: 'xmag must be a number within [' + XMAG + ', ' + XMAG_MAX + ']' };
  }
  return { ok: true, xmag: x };
}

/** Vue recue de la fenetre : { ok, vue } (vue === null pour la vue de face) ou { ok:false, erreur }. */
function normaliserVue(vue) {
  if (vue === null || vue === undefined) return { ok: true, vue: null };
  if (typeof vue !== 'object' || Array.isArray(vue)) return { ok: false, erreur: 'view must be an object' };
  const a = validerVue(vue.yaw, vue.pitch);
  if (!a.ok) return a;
  if (a.yaw === 0 && a.pitch === 0) return { ok: true, vue: null };
  const x = validerXmag(vue.xmag);
  if (!x.ok) return x;
  return { ok: true, vue: { yaw: a.yaw, pitch: a.pitch, xmag: x.xmag } };
}

/** Arguments de ligne de commande de `mesh_inpaint.py rendre` apres la taille : [] en vue de face, [yaw, pitch] sinon. */
function argsRendu(vue) {
  return vue ? [String(vue.yaw), String(vue.pitch)] : [];
}

module.exports = { YAW_MAX, PITCH_MAX, XMAG, XMAG_MAX, validerVue, validerXmag, normaliserVue, argsRendu };
