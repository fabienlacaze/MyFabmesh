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

/** Les pages HTML embarquent des <script> EN LIGNE. Ils ne sont dans aucun
 *  fichier .js, donc ce garde ne les voyait pas — et le 2026-09-24 un
 *  nettoyage trop large y a transforme `(function () {` en `(function {` et
 *  `, () => {` en `, => {`. Huit lignes cassees, LIVREES en production : le
 *  panneau de prechauffage ne se depliait plus au survol, et rien ne l'a
 *  signale. Ils sont analyses comme le reste, maintenant. */
const PAGES = ['src/renderer/index2.html', 'cloud/public/app/index.html'];

function scriptsEnLigne(chemin) {
  const brut = readFileSync(join(RACINE, chemin), 'utf-8');
  // Les commentaires HTML CITENT parfois <script> en prose (c'est le cas
  // dans index2.html, qui explique a quoi sert son script de secours). Sans
  // cette neutralisation, le motif mord dans le commentaire et l'analyse
  // porte sur du texte anglais. On remplace chaque commentaire par le MEME
  // nombre de sauts de ligne, pour que les numeros restent justes.
  const html = brut.replace(/<!--[\s\S]*?-->/g,
    (c) => (c.match(/[\n]/g) || []).join(''));
  const blocs = [];
  // Regex LITTERAL, surtout pas `new RegExp('...')` : dans une chaine JS,
  // \b est un caractere backspace et non une limite de mot. Le motif ne
  // mordait alors sur RIEN et ce garde annoncait « tout va bien » sans avoir
  // rien lu — le pire comportement possible pour un garde-fou.
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1] || '';
    if (/src\s*=/i.test(attrs)) continue;
    if (/type\s*=\s*["'](?!text\/javascript|module)/i.test(attrs)) continue;
    blocs.push({ code: m[2], ligne: (html.slice(0, m.index).match(/[\n]/g) || []).length + 1 });
  }
  return blocs;
}

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

// --- <script> en ligne des pages HTML ---------------------------------------
if (!cibles.length) {
  for (const page of PAGES) {
    if (!existsSync(join(RACINE, page))) continue;
    let n = 0;
    for (const bloc of scriptsEnLigne(page)) {
      n++;
      try {
        acorn.parse(bloc.code, { ecmaVersion: 'latest', sourceType: 'script' });
      } catch (e) {
        casse++;
        console.error('  CASSE  ' + page + ' — <script> en ligne commencant ligne ' + bloc.ligne);
        console.error('           ' + e.message);
      }
    }
    if (n) console.log('  ok     ' + page + ' — ' + n + ' <script> en ligne');
  }
}

if (casse) {
  console.error(`\n  ${casse} fichier(s) ne se chargeront pas. N'utilise PAS`);
  console.error('  `node --check <fichier>` pour t\'en assurer : sur un fichier de plus');
  console.error('  d\'un Mo il renvoie 0 sans rien voir (mesure du 2026-09-24).\n');
  process.exit(1);
}
console.log(`[js] ${liste.length} fichier(s) livres analyses, syntaxe valide`);
