// SONDE : verdicts PROD / AVANT / APRES des textes donnes en arguments (ou lus sur l'entree standard, un par ligne), avec les vues lues.
// Notation <U+XXXX> acceptee dans les textes. Usage : node build/bancs/moderation/_sonde.mjs "texte 1" "texte 2" ...
import { versions, verdict, montrer } from './lib_bancs.mjs';
import { readFileSync } from 'node:fs';

const V = versions({ listes: true, sansAvant: false });
const lire = (s) => s.replace(/<U\+([0-9A-Fa-f]+)>/g, (_m, h) => String.fromCodePoint(parseInt(h, 16)));
let textes = process.argv.slice(2);
if (!textes.length) textes = readFileSync(0, 'utf8').split(/\r?\n/).filter(Boolean);
for (const t0 of textes) {
  const t = lire(t0);
  const p = verdict(V.PROD, t), a = verdict(V.AVANT, t), r = verdict(V.APRES, t);
  const lp = V.PROD.checkPromptSafety(t, true).safe ? 'passe' : 'bloque', lr = V.APRES.checkPromptSafety(t, true).safe ? 'passe' : 'bloque';
  const rp = V.PROD.checkHardFloor(t), rr = V.APRES.checkHardFloor(t);
  console.log(`PROD ${p} AVANT ${a} APRES ${r} libre ${lp}/${lr} | ${montrer(t)}`);
  console.log(`    prod : ${JSON.stringify(rp.blocked ?? null)}   apres : ${JSON.stringify(rr.blocked ?? null)}`);
}
