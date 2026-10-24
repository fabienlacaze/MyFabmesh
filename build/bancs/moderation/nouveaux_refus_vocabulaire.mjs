// NOUVEAUX REFUS sur le vocabulaire (lot securite 24/10). Chaque mot (>= 3 lettres) des vocabulaires CLIP et Qwen du cache local est juge seul,
// puis dans deux gabarits de prompt anglais (« a <mot> in a forest », « <mot>, detailed illustration ») par la version AVANT (option --avant,
// defaut origin/prompts-2410) et la version APRES (copie de travail) ; le banc liste les mots que APRES refuse et pas AVANT.
// Un mot nouvellement refuse doit etre un mot de nudite ou d enfant d une langue ajoutee ; tout autre est une collision a corriger.
// Usage : node build/bancs/moderation/nouveaux_refus_vocabulaire.mjs [--avant <rev>] [--sortie fichier.json]
import { writeFileSync } from 'node:fs';
import { versions, vocabulaire, arg } from './lib_bancs.mjs';

const avant = arg('--avant', 'origin/prompts-2410');
const { AVANT, APRES } = versions({ avant });
const { mots, sources } = vocabulaire();
const gabarits = [(m) => m, (m) => `a ${m} in a forest`, (m) => `${m}, detailed illustration`, (m) => `a woman and a ${m}`];
const refus = (m, t) => !m.checkHardFloor(t).safe || !m.checkPromptSafety(t, false).safe;
const nouveaux = [];
for (const mot of mots) {
  for (const [i, g] of gabarits.entries()) {
    const t = g(mot);
    if (refus(APRES, t) && !refus(AVANT, t)) { nouveaux.push({ mot, gabarit: i, texte: t }); break; }
  }
}
console.log(`${mots.length} mots (${sources.join(', ')}) ; ${nouveaux.length} mots nouvellement refuses par rapport a ${avant}`);
console.log(nouveaux.map((n) => n.mot + (n.gabarit ? ` [g${n.gabarit}]` : '')).join(', '));
if (arg('--sortie')) writeFileSync(arg('--sortie'), JSON.stringify({ avant, mots: mots.length, nouveaux }, null, 1), 'utf8');
