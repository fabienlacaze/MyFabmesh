#!/usr/bin/env node
/**
 * Garde du retrait dans « Modify image » (2026-10-20).
 *
 * « Modify image » confie a Auto Inpaint les consignes de RETRAIT (« remove the wings ») et de REMPLACEMENT EXPLICITE (« replace the wings with a
 * hat »). La decision est prise par un module pur (src/renderer/lib/retrait-image.js = cloud/public/app/lib/retrait-image.js) sur le texte deja
 * traduit en anglais. Une derive de ce module — une regex retouchee, une liste elargie — changerait en silence ce qui est route (et donc FACTURE
 * au prix d'Auto Inpaint) : ce garde rejoue la table ecrite a la main build/retrait_cas.json (consigne -> mode, cible, remplacement, raison) dans
 * LES DEUX copies et refuse la construction au moindre ecart.
 *
 * Il verifie aussi : les deux copies sont identiques a l'octet, la table compte au moins 80 consignes de tous les modes, et les chaines que le
 * module produit (cible, remplacement) n'ont jamais de syntaxe de prompt.
 * Usage : node build/check-retrait.mjs
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const lf = (s) => s.split('\r\n').join('\n');
const COPIES = { bureau: 'src/renderer/lib/retrait-image.js', web: 'cloud/public/app/lib/retrait-image.js' };

let echecs = 0;
const dit = (m) => { console.error('  ' + m); echecs++; };

// Node traite les .js de ce depot comme du CommonJS : on importe une copie .mjs temporaire.
const dossier = mkdtempSync(join(tmpdir(), 'retrait-'));
const M = {};
try {
  for (const [nom, rel] of Object.entries(COPIES)) {
    const copie = join(dossier, 'retrait-' + nom + '.mjs');
    writeFileSync(copie, readFileSync(join(RACINE, rel), 'utf-8'));
    M[nom] = await import(pathToFileURL(copie).href);
  }
} finally {
  rmSync(dossier, { recursive: true, force: true });
}

if (lf(readFileSync(join(RACINE, COPIES.bureau), 'utf-8')) !== lf(readFileSync(join(RACINE, COPIES.web), 'utf-8'))) dit('les deux copies de retrait-image.js different (node build/check-noyaux-partages.mjs --sync)');

const table = JSON.parse(readFileSync(join(RACINE, 'build/retrait_cas.json'), 'utf-8')).cas;
const modes = new Set(table.map((c) => c[1]));
if (table.length < 80) dit('la table ne compte que ' + table.length + ' consignes (80 au moins)');
for (const m of ['retrait', 'remplacement', 'mixte', 'aucun']) if (!modes.has(m)) dit('aucun cas de mode ' + m);
const vus = new Set();
for (const c of table) { if (vus.has(c[0])) dit('consigne en double dans la table : ' + JSON.stringify(c[0])); vus.add(c[0]); }

const texteDuCas = (t) => (t === 'REMOVE_LONG_TEXT' ? 'remove the wings ' + 'and the tail '.repeat(20) : t);
for (const [t, mode, cible, remp, raison, restant] of table) {
  for (const [nom, mod] of Object.entries(M)) {
    const r = mod.analyserRetrait(texteDuCas(t));
    const obtenu = JSON.stringify([r.mode, r.cible, r.remplacement, r.raison, r.restant]);
    const attendu = JSON.stringify([mode, cible, remp, raison, restant]);
    if (obtenu !== attendu) dit(`${nom} : ${JSON.stringify(t)}\n      attendu ${attendu}\n      obtenu  ${obtenu}`);
    for (const champ of [r.cible, r.remplacement]) {
      if (champ !== '' && !/^[\p{L}\p{N}][\p{L}\p{N}' -]*$/u.test(champ)) dit(`${nom} : caracteres interdits dans ${JSON.stringify(champ)} (${JSON.stringify(t)})`);
    }
  }
}

if (echecs) {
  console.error(`\n[retrait] ${echecs} ecart(s). Un changement VOULU du module : mettre a jour build/retrait_cas.json A LA MAIN (la table est l'oracle, elle n'est jamais generee).`);
  process.exit(1);
}
console.log(`[retrait] ${table.length} consignes x 2 copies : memes decisions que la table ; copies identiques ; aucune syntaxe de prompt dans les cibles`);
