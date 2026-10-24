// Mesure : sur les references anglaises du corpus d'essai (24/10), combien de negations sont reconnues (terme au negatif, absent du positif).
// usage : node build/bancs/noyaux/mesure_negations_corpus.mjs [corpus.json]   (sans argument : le corpus du dossier de corrections du proprietaire, s'il existe)
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const racine = resolve(new URL('../../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const C = await import(pathToFileURL(resolve(racine, 'src/renderer/lib/composeur-intention.js')).href);
const defaut = 'C:/Users/Utilisateur/Documents/MyFabmesh_corrections_prompts_2026-10-24/corpus.json';
const f = process.argv[2] || defaut;
if (!existsSync(f)) { console.log('corpus absent : ' + f); process.exit(0); }
const corpus = JSON.parse(readFileSync(f, 'utf-8'));
const vus = new Set();
let total = 0, ok = 0;
const echecs = [];
for (const e of corpus.entrees) {
  const att = e.attendu || {};
  const attendus = att.negatif_contient || [];
  if (!attendus.length || !e.reference_en) continue;
  const cle = e.reference_en + '|' + attendus.join(',');
  if (vus.has(cle)) continue;
  vus.add(cle);
  total++;
  const negs = C.assainirNegatifs(C.negationsDe(e.reference_en)).map((s) => s.toLowerCase());
  const positif = C.positifSansNegations(e.reference_en).toLowerCase();
  const bon = attendus.every((a) => negs.some((n) => n.includes(a.toLowerCase())))
    && (att.interdit_positif || []).every((a) => !new RegExp('\\b' + a.toLowerCase() + '\\b').test(positif));
  if (bon) ok++; else echecs.push({ id: e.id, ref: e.reference_en, negs, positif });
}
console.log(`negations reconnues : ${ok}/${total}`);
for (const x of echecs) console.log(' -', JSON.stringify(x));
if (process.argv.includes('--strict') && ok !== total) process.exit(1);
