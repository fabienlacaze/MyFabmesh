#!/usr/bin/env node
/**
 * Refuse une construction dont les deux copies du noyau « Habits seuls » ont
 * diverge.
 *
 * POURQUOI. L'algorithme vit en DEUX exemplaires et ne peut pas vivre
 * autrement : l'image Modal ne monte que `modal_app` (app.py
 * `.add_local_python_source("modal_app")`) et l'appli bureau packagee
 * n'embarque que `scripts` (package.json `build.files`). Aucun des deux ne
 * peut importer l'autre.
 *
 * Une copie qu'on ne peut pas supprimer, on la SURVEILLE. Sans ca on rejoue
 * le defaut mesure le 2026-09-23 : le detourage manuel etait passe a Lucida
 * en juillet, le pipeline 3D etait reste sur u2net — dans les deux fichiers,
 * pendant deux mois, sans que rien ne le signale.
 *
 * `--sync` recopie le noyau du bureau vers Modal au lieu de refuser.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEBUT = '# --- NOYAU PARTAGE : DEBUT';
const FIN = '# --- NOYAU PARTAGE : FIN ---';

/** La SOURCE : c'est ce fichier qu'on edite. */
const SOURCE = 'scripts/outfit_cutout.py';
/** La COPIE : regeneree depuis la source, jamais editee a la main. */
const COPIE = 'modal_app/_outfit_cutout.py';

/** CRLF normalise : sous Windows, Git et les editeurs changent les fins de
 *  ligne sans rien changer au code. Les comparer ferait crier le garde pour
 *  rien, et on apprendrait a l'ignorer -- c'est ainsi qu'un garde meurt. */
const lf = (s) => s.split('\r\n').join('\n');

function noyau(chemin) {
  const txt = lf(readFileSync(join(RACINE, chemin), 'utf-8'));
  const i = txt.indexOf(DEBUT);
  const j = txt.indexOf(FIN);
  if (i < 0 || j < 0) {
    console.error(`\n  ${chemin} : marqueurs NOYAU PARTAGE introuvables.`);
    console.error('  Le bloc doit etre encadre par :');
    console.error(`    ${DEBUT} ...`);
    console.error(`    ${FIN}\n`);
    process.exit(1);
  }
  return { txt, i, j: j + FIN.length, bloc: txt.slice(i, j + FIN.length) };
}

const a = noyau(SOURCE);
const b = noyau(COPIE);

/** Les cases a cocher de la modale envoient des cles de piece au serveur, qui
 *  refuse d'un 400 toute cle inconnue. Une case ajoutee dans le HTML sans sa
 *  ligne dans PIECES_TENUE casse donc l'outil au clic, et seulement au clic. */
function verifierPiecesUI(clesNoyau) {
  const pages = ['src/renderer/index2.html', 'cloud/public/app/index.html'];
  const soucis = [];
  for (const page of pages) {
    const html = lf(readFileSync(join(RACINE, page), 'utf-8'));
    const vues = [...html.matchAll(/class="of-piece" value="([^"]+)"/g)].map(m => m[1]);
    if (!vues.length) { soucis.push(`${page} : aucune case .of-piece`); continue; }
    const inconnues = vues.filter(v => !clesNoyau.includes(v));
    const oubliees = clesNoyau.filter(k => !vues.includes(k));
    if (inconnues.length) soucis.push(`${page} : case(s) inconnues du noyau — ${inconnues.join(', ')}`);
    if (oubliees.length) soucis.push(`${page} : piece(s) du noyau sans case — ${oubliees.join(', ')}`);
  }
  return soucis;
}

if (a.bloc === b.bloc) {
  const table = a.bloc.slice(a.bloc.indexOf('PIECES_TENUE = {'));
  const cles = [...table.slice(0, table.indexOf('}')).matchAll(/'([a-z]+)':/g)].map(m => m[1]);
  const soucis = verifierPiecesUI(cles);
  if (soucis.length) {
    console.error('\n  HABITS SEULS : la modale et le noyau ne parlent pas des memes pieces.\n');
    for (const s of soucis) console.error('  ' + s);
    console.error('\n  Le serveur refuse une piece inconnue par un 400 : le defaut ne se');
    console.error('  verrait qu\'au clic de l\'utilisateur.\n');
    process.exit(1);
  }
  const lignes = a.bloc.split('\n').length;
  console.log(`[habits] noyau partage identique (${lignes} lignes, ${a.bloc.length} octets)`
    + `, ${cles.length} pieces alignees avec les deux modales`);
  process.exit(0);
}

if (process.argv.includes('--sync')) {
  writeFileSync(join(RACINE, COPIE), b.txt.slice(0, b.i) + a.bloc + b.txt.slice(b.j), 'utf-8');
  console.log(`[habits] ${COPIE} resynchronise depuis ${SOURCE}`);
  process.exit(0);
}

// Premiere ligne qui differe : plus utile qu'un « ils different ».
const la = a.bloc.split('\n');
const lb = b.bloc.split('\n');
let k = 0;
while (k < la.length && k < lb.length && la[k] === lb[k]) k++;

console.error('\n========================================================================');
console.error('  HABITS SEULS : les deux copies du noyau ont diverge.\n');
console.error(`  source : ${SOURCE}`);
console.error(`  copie  : ${COPIE}`);
console.error(`\n  premiere difference, ligne ${k + 1} du bloc :`);
console.error(`    source : ${JSON.stringify(la[k] ?? '(fin du bloc)')}`);
console.error(`    copie  : ${JSON.stringify(lb[k] ?? '(fin du bloc)')}`);
console.error('\n  L\'algorithme tourne sur DEUX plateformes qui ne peuvent pas partager');
console.error('  de fichier. Une divergence ici, c\'est une amelioration qui n\'atteint');
console.error('  qu\'une moitie des utilisateurs, en silence.');
console.error('\n  Editer la source, puis :  node build/check-outfit-parity.mjs --sync');
console.error('========================================================================\n');
process.exit(1);
