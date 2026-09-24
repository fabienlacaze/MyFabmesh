#!/usr/bin/env node
/**
 * Analyse syntaxique FIABLE des gros fichiers JS livres.
 *
 * POURQUOI CE FICHIER EXISTE (mesure du 2026-09-24).
 * `node --check <fichier>` a renvoye 0 sur src/renderer/index2.js — 1,18 Mo —
 * alors que la ligne 18179 contenait :
 *
 *     showToast('Choisis d'abord une image.', 'error');
 *
 * c'est-a-dire une apostrophe non echappee qui casse l'appel. Le meme contenu
 * dans un fichier d'UNE ligne est correctement refuse par `node --check`, et
 * `node --check` par STDIN refuse aussi le gros fichier. Seule la forme
 * « --check <chemin> » ment, et elle ment en SILENCE, avec un code de sortie 0.
 *
 * Consequence vecue : l'application s'est lancee sur « MyFabmesh.AI failed to
 * start — SyntaxError: missing ) after argument list », apres qu'un
 * `node --check` au vert eut servi de preuve que tout allait bien. Un garde
 * qui repond « tout va bien » sans regarder est pire que pas de garde.
 *
 * acorn (deja dans node_modules) ne ment pas. On essaie « module » puis
 * « script » : un fichier valide passe dans au moins un des deux.
 *
 * Usage : node build/check-js-syntax.mjs [fichiers...]
 *         sans argument, verifie la liste LIVRES ci-dessous.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Les fichiers qui partent chez l'utilisateur. Une erreur de syntaxe dans
 *  l'un d'eux, c'est un ecran « failed to start ». */
const LIVRES = [
  'src/renderer/index2.js',
  'src/renderer/index2-edit-tools.js',
  'src/renderer/canvas-utils.js',
  'src/renderer/lib/Viewer3D.js',
  'src/main/main.js',
  'src/main/preload.js',
  'src/main/cloud_fallback.js',
  'cloud/public/app/index2.js',
  'cloud/public/app/index2-edit-tools.js',
  'cloud/public/app/meshyAPI-cloud.js',
  'cloud/public/app/cloud-overrides.js',
  'cloud/public/app/canvas-utils.js',
  'cloud/public/app/lib/Viewer3D.js',
];

const cibles = process.argv.slice(2);
const liste = (cibles.length ? cibles : LIVRES)
  .map(f => (cibles.length ? f : join(RACINE, f)))
  .filter(f => existsSync(f));

if (!liste.length) {
  console.error('  aucun fichier a verifier');
  process.exit(1);
}

let casse = 0;
for (const f of liste) {
  const src = readFileSync(f, 'utf-8');
  const erreurs = [];
  let ok = false;
  for (const sourceType of ['module', 'script']) {
    try {
      acorn.parse(src, { ecmaVersion: 'latest', sourceType, allowHashBang: true, allowReturnOutsideFunction: true });
      ok = true;
      break;
    } catch (e) {
      erreurs.push({ sourceType, message: e.message, loc: e.loc });
    }
  }
  const nom = relative(RACINE, f).replace(/\\/g, '/');
  if (ok) {
    console.log(`  ok     ${nom}  (${Math.round(src.length / 1024)} Ko)`);
    continue;
  }
  casse++;
  console.error(`\n  CASSE  ${nom}`);
  for (const e of erreurs) {
    const ou = e.loc ? ` (ligne ${e.loc.line}, colonne ${e.loc.column})` : '';
    console.error(`           en ${e.sourceType}${ou} : ${e.message}`);
    if (e.loc) {
      const ligne = src.split('\n')[e.loc.line - 1];
      if (ligne) console.error(`           ${ligne.trim().slice(0, 140)}`);
    }
  }
}

if (casse) {
  console.error(`\n  ${casse} fichier(s) ne se chargeront pas. N'utilise PAS`);
  console.error('  `node --check <fichier>` pour t\'en assurer : sur un fichier de plus');
  console.error('  d\'un Mo il renvoie 0 sans rien voir (mesure du 2026-09-24).\n');
  process.exit(1);
}
console.log(`[js] ${liste.length} fichier(s) livres analyses, syntaxe valide`);
