#!/usr/bin/env node
/**
 * Refuse une construction ou un travail affiche n'appartient a AUCUNE etape.
 *
 * POURQUOI. `_jobStepIndex()` range un travail dans une des quatre etapes en
 * faisant correspondre son NOM a une liste de motifs. Un nom qui ne mord sur
 * rien renvoie 0, et alors, en silence :
 *   - le travail n'apparait pas dans le panneau « GENERATING » de l'etape,
 *   - son bouton « Go to » ne s'affiche pas.
 * Rien ne casse, rien ne s'imprime : l'outil a juste l'air inacheve.
 *
 * MESURE DU 2026-09-24 : 11 noms orphelins cote bureau et 14 cote web, dont
 * « Remove background », utilise tous les jours. Le defaut se reproduisait a
 * chaque outil ajoute, parce que rien n'obligeait a completer le tableau en
 * meme temps que l'outil. Ce garde l'oblige.
 *
 * Les noms construits a partir d'une variable (`${x}: ${y}`) ne sont pas
 * verifiables ici — ils sont listes comme DYNAMIQUES et ignores.
 */
import { readFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const FICHIERS = ['src/renderer/index2.js', 'cloud/public/app/index2.js'];

/** Noms entierement issus de variables : impossible a juger statiquement. */
const DYNAMIQUES = new Set(['X: X', 'X (resumed)', 'name: X']);

/** Quelques noms reels, avec l'etape attendue — filet anti-regression : si
 *  quelqu'un elargit un motif au point de tout attraper, ces lignes tombent. */
const TEMOINS = [
  ['Generate images: orc', 1], ['Auto inpaint: orc', 1], ['Remove background: orc', 1],
  ['Habits seuls: orc', 1], ['Recolor: orc', 1], ['Age change: orc', 1],
  ['Generate 3D: orc', 2], ['Refine mesh: orc', 2], ['Resize: orc', 2],
  ['Rig: orc', 3], ['Re-skin: orc', 3],
  ['Animate: orc', 4], ['Import animation: orc', 4],
];

let echecs = 0;
for (const rel of FICHIERS) {
  const src = readFileSync(join(RACINE, rel), 'utf-8').split('\r\n').join('\n');
  const i = src.indexOf('function _jobStepIndex');
  const j = src.indexOf('\n}\n', i) + 3;
  if (i < 0 || j < 3) { console.error(`  ${rel} : _jobStepIndex introuvable`); process.exit(1); }
  const etape = new Function('return ' + src.slice(i, j).replace('function _jobStepIndex', 'function'))();

  const noms = new Set();
  const re = /\b(?:pushJob|addJob)\(\s*(`[^`]*`|'[^']*'|"[^"]*")/g;
  let m;
  while ((m = re.exec(src))) {
    const n = m[1].slice(1, -1).replace(/\$\{[^}]*\}/g, 'X');
    if (n.trim()) noms.add(n);
  }

  const orphelins = [...noms].filter(n => !DYNAMIQUES.has(n) && etape({ name: n }) === 0);
  const faux = TEMOINS.filter(([n, attendu]) => etape({ name: n }) !== attendu);

  if (orphelins.length || faux.length) {
    echecs++;
    console.error(`\n  ${rel}`);
    for (const n of orphelins) console.error(`    SANS ETAPE   « ${n} » — pas de bouton « Go to », absent du panneau de l'etape`);
    for (const [n, attendu] of faux) console.error(`    MAUVAISE ETAPE  « ${n} » -> ${etape({ name: n })}, attendu ${attendu}`);
  } else {
    console.log(`  ok     ${rel} — ${noms.size} nom(s), tous rattaches`);
  }
}

if (echecs) {
  console.error('\n  Completer les motifs de `_jobStepIndex` dans les DEUX copies.');
  console.error('  Un outil dont le travail n\'a pas d\'etape a l\'air inacheve sans');
  console.error('  qu\'aucune erreur ne soit levee.\n');
  process.exit(1);
}
console.log('[jobs] tous les travaux sont rattaches a une etape, sur les deux plateformes');
