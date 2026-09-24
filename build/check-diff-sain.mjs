#!/usr/bin/env node
/**
 * Refuse une construction quand un fichier a ete REECRIT EN MASSE sans que
 * son code change — typiquement une indentation ecrasee.
 *
 * POURQUOI (deux fois le 2026-09-24).
 *   1. `sed -i` sur des fichiers CRLF a converti tout le fichier en LF ;
 *   2. un `replace('  ', ' ')` applique au fichier ENTIER pour corriger trois
 *      libelles a ecrase l'indentation des deux index.html — 7 024 lignes
 *      modifiees chacun, pour 38 lignes de vrai changement.
 *
 * Les deux ont ete rattrapes en lisant `git diff --stat` par reflexe. Un
 * reflexe n'est pas un garde-fou : la fois ou on ne regarde pas, le bruit
 * part en production et rend illisible toute relecture ulterieure.
 *
 * COMMENT. `git diff --numstat` donne les lignes changees ; `git diff -w`
 * les ignore les changements d'espaces. Un fichier dont le premier compte
 * est gros et le second quasi nul a ete reecrit sans rien dire de neuf.
 *
 * Echappatoire assumee, pour un reformatage VOLONTAIRE :
 *   ALLOW_REFORMAT=1 npm run build
 */
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Au-dela de ce nombre de lignes changees, on regarde de pres. */
const SEUIL_LIGNES = 200;
/** Part des lignes qui doit rester apres `-w` pour que le changement soit reel. */
const PART_REELLE_MINI = 0.05;

function git(...args) {
  try {
    return execFileSync('git', args, { cwd: RACINE, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    // Pas un depot git, ou git absent : ce garde ne doit jamais bloquer pour ca.
    return null;
  }
}

function numstat(ignorerEspaces) {
  const sortie = git('diff', ...(ignorerEspaces ? ['-w'] : []), '--numstat', 'HEAD');
  if (sortie == null) return null;
  const m = new Map();
  for (const ligne of sortie.split('\n')) {
    const [add, del, chemin] = ligne.split('\t');
    if (!chemin) continue;
    const n = (Number(add) || 0) + (Number(del) || 0);
    m.set(chemin.trim(), n);
  }
  return m;
}

const brut = numstat(false);
if (brut == null) {
  console.log('[diff] hors depot git — controle ignore');
  process.exit(0);
}
const sansEspaces = numstat(true) ?? new Map();

const suspects = [];
for (const [chemin, lignes] of brut) {
  if (lignes < SEUIL_LIGNES) continue;
  const reelles = sansEspaces.get(chemin) ?? 0;
  if (reelles <= Math.max(4, lignes * PART_REELLE_MINI)) {
    suspects.push({ chemin, lignes, reelles });
  }
}

if (!suspects.length) {
  console.log('[diff] aucune reecriture en masse dans le repertoire de travail');
  process.exit(0);
}

if (process.env.ALLOW_REFORMAT === '1') {
  console.log('[diff] reecriture en masse ACCEPTEE (ALLOW_REFORMAT=1) :');
  for (const s of suspects) console.log(`       ${s.chemin} — ${s.lignes} lignes`);
  process.exit(0);
}

console.error('\n========================================================================');
console.error('  REECRITURE EN MASSE : la construction est refusee.\n');
for (const s of suspects) {
  console.error(`  ${s.chemin}`);
  console.error(`     ${s.lignes} lignes changees, dont ${s.reelles} seulement hors espaces.`);
}
console.error('\n  Un fichier dont presque tout le diff disparait avec `git diff -w` a ete');
console.error('  reecrit sans rien dire de neuf : indentation ecrasee, ou fins de ligne');
console.error('  converties. Le code livre est peut-etre correct, mais le bruit rend');
console.error('  toute relecture impossible et masquera le prochain vrai defaut.');
console.error('\n  Verifier avec :  git diff --stat');
console.error('  Si le reformatage est VOULU :  ALLOW_REFORMAT=1 npm run build');
console.error('========================================================================\n');
process.exit(1);
