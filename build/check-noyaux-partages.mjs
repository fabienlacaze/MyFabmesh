#!/usr/bin/env node
/**
 * Refuse une construction dont un NOYAU PARTAGE a diverge entre ses deux
 * copies.
 *
 * POURQUOI DES COPIES. Certains algorithmes doivent tourner sur les deux
 * plateformes, et aucune ne peut importer le fichier de l'autre : l'image
 * Modal ne monte que `modal_app` (app.py `.add_local_python_source`), l'appli
 * bureau packagee n'embarque que `scripts` (package.json `build.files`).
 *
 * Une copie qu'on ne peut pas supprimer, on la SURVEILLE. Sans ca on rejoue le
 * defaut mesure le 2026-09-23 : le detourage manuel etait passe a Lucida en
 * juillet, le pipeline 3D etait reste sur u2net — deux mois, sans un mot.
 *
 * `--sync` recopie le noyau de la SOURCE vers la COPIE au lieu de refuser.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEBUT = '# --- NOYAU PARTAGE : DEBUT';
const FIN = '# --- NOYAU PARTAGE : FIN ---';

/** CRLF normalise : sous Windows, Git et les editeurs changent les fins de
 *  ligne sans rien changer au code. Les comparer ferait crier le garde pour
 *  rien, et on apprendrait a l'ignorer — c'est ainsi qu'un garde meurt. */
const lf = (s) => s.split('\r\n').join('\n');

/** source = le fichier qu'on edite ; copie = regeneree, jamais editee a la main. */
const PAIRES = [
  { nom: 'habits',     source: 'scripts/outfit_cutout.py', copie: 'modal_app/_outfit_cutout.py', verifUI: true },
  { nom: 'recolorier', source: 'scripts/recolor_core.py',  copie: 'modal_app/_recolor.py' },
  { nom: 'image TRELLIS-2', source: 'scripts/trellis2_native_full_pipeline.py', copie: 'modal_app/_mesh.py' },
];

function noyau(chemin) {
  const txt = lf(readFileSync(join(RACINE, chemin), 'utf-8'));
  const i = txt.indexOf(DEBUT);
  const j = txt.indexOf(FIN);
  if (i < 0 || j < 0) {
    console.error(`\n  ${chemin} : marqueurs NOYAU PARTAGE introuvables.`);
    console.error(`  Le bloc doit etre encadre par :\n    ${DEBUT} ...\n    ${FIN}\n`);
    process.exit(1);
  }
  return { txt, i, j: j + FIN.length, bloc: txt.slice(i, j + FIN.length) };
}

/** Les cases a cocher de la modale Habits envoient des cles au serveur, qui
 *  refuse d'un 400 toute cle inconnue. Une case ajoutee sans sa ligne dans
 *  PIECES_TENUE casserait l'outil au clic, et seulement au clic. */
function verifierPiecesUI(bloc) {
  const table = bloc.slice(bloc.indexOf('PIECES_TENUE = {'));
  const cles = [...table.slice(0, table.indexOf('}')).matchAll(/'([a-z]+)':/g)].map(m => m[1]);
  const soucis = [];
  for (const page of ['src/renderer/index2.html', 'cloud/public/app/index.html']) {
    const html = lf(readFileSync(join(RACINE, page), 'utf-8'));
    const vues = [...html.matchAll(/class="of-piece" value="([^"]+)"/g)].map(m => m[1]);
    if (!vues.length) { soucis.push(`${page} : aucune case .of-piece`); continue; }
    const inconnues = vues.filter(v => !cles.includes(v));
    const oubliees = cles.filter(k => !vues.includes(k));
    if (inconnues.length) soucis.push(`${page} : case(s) inconnues du noyau — ${inconnues.join(', ')}`);
    if (oubliees.length) soucis.push(`${page} : piece(s) du noyau sans case — ${oubliees.join(', ')}`);
  }
  return { cles, soucis };
}

const sync = process.argv.includes('--sync');
let echecs = 0;

for (const p of PAIRES) {
  const a = noyau(p.source);
  const b = noyau(p.copie);

  if (a.bloc !== b.bloc) {
    if (sync) {
      writeFileSync(join(RACINE, p.copie), b.txt.slice(0, b.i) + a.bloc + b.txt.slice(b.j), 'utf-8');
      console.log(`[noyaux] ${p.nom} : ${p.copie} resynchronise depuis ${p.source}`);
      continue;
    }
    const la = a.bloc.split('\n');
    const lb = b.bloc.split('\n');
    let k = 0;
    while (k < la.length && k < lb.length && la[k] === lb[k]) k++;
    console.error(`\n========================================================================`);
    console.error(`  NOYAU « ${p.nom} » : les deux copies ont diverge.\n`);
    console.error(`  source : ${p.source}`);
    console.error(`  copie  : ${p.copie}`);
    console.error(`\n  premiere difference, ligne ${k + 1} du bloc :`);
    console.error(`    source : ${JSON.stringify(la[k] ?? '(fin du bloc)')}`);
    console.error(`    copie  : ${JSON.stringify(lb[k] ?? '(fin du bloc)')}`);
    console.error(`\n  L'algorithme tourne sur DEUX plateformes qui ne peuvent pas partager`);
    console.error(`  de fichier. Une divergence ici, c'est une amelioration qui n'atteint`);
    console.error(`  qu'une moitie des utilisateurs, en silence.`);
    console.error(`\n  Editer la source, puis :  node build/check-noyaux-partages.mjs --sync`);
    console.error(`========================================================================\n`);
    echecs++;
    continue;
  }

  let extra = '';
  if (p.verifUI) {
    const { cles, soucis } = verifierPiecesUI(a.bloc);
    if (soucis.length) {
      console.error(`\n  NOYAU « ${p.nom} » : la modale et le noyau ne parlent pas des memes pieces.\n`);
      for (const s of soucis) console.error('  ' + s);
      console.error(`\n  Le serveur refuse une piece inconnue par un 400 : le defaut ne se`);
      console.error(`  verrait qu'au clic de l'utilisateur.\n`);
      echecs++;
      continue;
    }
    extra = `, ${cles.length} pieces alignees avec les deux modales`;
  }
  console.log(`[noyaux] ${p.nom} : identique (${a.bloc.split('\n').length} lignes, ${a.bloc.length} octets)${extra}`);
}

/* ── COPIES DE FICHIERS ENTIERS ────────────────────────────────────────────
 *
 * Certains outils sont faits de scripts AUTONOMES qui s'appellent entre eux
 * par chemin de fichier (le nommage des zones : un routeur qui lance deux
 * voies en sous-processus). Les decouper en noyau + colle casserait ces
 * appels. On les copie donc tels quels, sous le MEME nom de fichier dans un
 * sous-dossier de modal_app, et on exige l'identite du fichier entier. */
const FICHIERS = [
  { nom: 'nommage (routeur)', source: 'scripts/name_parts.py',        copie: 'modal_app/part_namer/name_parts.py' },
  { nom: 'nommage (vision)',  source: 'scripts/part_namer_vision.py', copie: 'modal_app/part_namer/part_namer_vision.py' },
  { nom: 'nommage (squelette)', source: 'scripts/skin_zone_namer.py', copie: 'modal_app/part_namer/skin_zone_namer.py' },
];
for (const p of FICHIERS) {
  const a = lf(readFileSync(join(RACINE, p.source), 'utf-8'));
  let b = null;
  try { b = lf(readFileSync(join(RACINE, p.copie), 'utf-8')); } catch (_) { /* copie absente */ }
  if (a === b) {
    console.log(`[noyaux] ${p.nom} : fichier identique (${a.split('\n').length} lignes)`);
    continue;
  }
  if (sync) {
    writeFileSync(join(RACINE, p.copie), a, 'utf-8');
    console.log(`[noyaux] ${p.nom} : copie resynchronisee depuis ${p.source}`);
    continue;
  }
  console.error(`\n========================================================================`);
  console.error(`  FICHIER PARTAGE « ${p.nom} » : ${b === null ? 'copie ABSENTE' : 'les deux copies ont diverge'}.\n`);
  console.error(`  source : ${p.source}`);
  console.error(`  copie  : ${p.copie}`);
  console.error(`\n  Editer la source, puis :  node build/check-noyaux-partages.mjs --sync`);
  console.error(`========================================================================\n`);
  echecs++;
}

process.exit(echecs ? 1 : 0);
