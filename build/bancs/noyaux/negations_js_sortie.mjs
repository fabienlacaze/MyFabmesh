// Sortie du jumeau JavaScript de extraire_negations sur une liste de textes (banc de parite de test_negations.py).
// usage : node negations_js_sortie.mjs <composeur-intention.js> <entrees.json> <sorties.json>
//   entrees : tableau de textes ; sorties : tableau de [positif, negatifs], dans le meme ordre.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [, , lib, entrees, sorties] = process.argv;
// la lib est un module ES dans un .js (CommonJS pour Node) : on importe une copie .mjs temporaire
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'negations-js-'));
try {
  const copie = path.join(dossier, 'composeur-intention.mjs');
  fs.writeFileSync(copie, fs.readFileSync(lib, 'utf8'));
  const m = await import(pathToFileURL(copie).href);
  const textes = JSON.parse(fs.readFileSync(entrees, 'utf8'));
  fs.writeFileSync(sorties, JSON.stringify(textes.map((t) => { const r = m.extraireNegations(t); return [r.positif, r.negatifs]; })), 'utf8');
} finally {
  fs.rmSync(dossier, { recursive: true, force: true });
}
