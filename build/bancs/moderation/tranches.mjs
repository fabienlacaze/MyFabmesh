// BALAYAGES ET FUZZ DE NON-RECUL PAR TRANCHES, AVEC REPRISE (cinquieme relecture du lot, 19/10/2026).
// Un balayage complet ou un fuzz de plusieurs millions de textes dure des dizaines de minutes : sur le poste du proprietaire (Unreal ouvert) il
// est decoupe en TRANCHES d'une a quelques minutes. L'etat (tranches terminees, comptes, reculs inexpliques) est ecrit dans un fichier ;
// relancer la meme commande reprend aux tranches restantes. Le programme s'arrete de lui-meme quand le budget de temps est atteint
// (aucune attente active, aucune boucle de sommeil) ; code de sortie 0 = tout est fait ou budget atteint sans recul inexplique, 1 = au moins
// un recul INEXPLIQUE (echec du banc), 2 = erreur d'usage.
//
// Usage : node build/bancs/moderation/tranches.mjs <tache> --etat <fichier.json> [--tranches K] [--fils N] [--budget S]
//           [--complet] [--politique] [--total N --mode <mode> --graine <s>]
//   taches de balayage : epeles | ages | adjacents | idiomes | exceptions | unicode   (--complet : version complete ; K tranches de rang modulo)
//   taches de fuzz     : fuzz | mutations   (--total textes PAR TRANCHE ; --tranches K tranches ; la tranche t utilise la graine <s> + t ;
//                        --mode : plancher | general | mixte | epeles | ages | courts | courts-epeles | ages-epeles | idiomes | expressions | tout,
//                        avec le suffixe +pur pour n'y glisser AUCUN declencheur d'exception ; --prod <rev> : l'oracle, 5a302cea = la branche avant ce tour)
//   Controles structurels (inclusion des vues) : vues_sur.mjs (fuzz) et vues_points.mjs (points de code, paires), qui ne passent pas par ici.
// Lance normalement par : bash /c/tmp/lourd.sh --max-sec 600 node build/bancs/moderation/tranches.mjs ...
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { versions, arg } from './lib_bancs.mjs';
import { lancer, rapporter, TACHES } from './balayages.mjs';
import { TACHES_FUZZ } from './fuzz.mjs';

const tache = process.argv[2];
const etatFichier = arg('--etat', null);
if (!tache || !etatFichier || !(TACHES[tache] || TACHES_FUZZ[tache])) {
  console.error('usage : node tranches.mjs <tache> --etat <fichier.json> [--tranches K] [--fils N] [--budget S] [--complet] [--total N --mode m --graine s]');
  process.exit(2);
}
const fuzz = Boolean(TACHES_FUZZ[tache]);
const K = Number(arg('--tranches', fuzz ? 1 : 8)); // balayage : nombre de tranches de rang ; fuzz : nombre de tranches (une graine chacune)
const fils = Number(arg('--fils', 3));
const budget = Number(arg('--budget', 500)) * 1000;
const complet = process.argv.includes('--complet');
const total = Number(arg('--total', 300000));
const mode = arg('--mode', 'tout');
const graine = Number(arg('--graine', 1));
const maxTranches = Number(arg('--max-tranches', Infinity)); // plafond par lancement (le budget de temps borne deja)
const description = JSON.stringify({ tache, K, complet, total, mode, graine, prod: arg('--prod', 'f86208c0') });

let etat = { description, tranches: {} };
if (existsSync(etatFichier)) {
  const lu = JSON.parse(readFileSync(etatFichier, 'utf8'));
  if (lu.description === description) etat = lu;
  else console.log('(etat existant d\'une autre configuration : ignore)');
}
const enregistrer = () => writeFileSync(etatFichier, JSON.stringify(etat, null, 1));

const V = versions({ listes: true, sansAvant: true });
const debut = Date.now();
let derniere = 0, lancees = 0;
for (let t = 0; t < K; t++) {
  if (etat.tranches[t]) continue;
  if (lancees > 0 && Date.now() - debut + derniere * 1.3 > budget) { console.log(`budget atteint (${((Date.now() - debut) / 1000).toFixed(0)} s) : relancer pour reprendre`); break; }
  if (lancees >= maxTranches) break;
  const t0 = Date.now();
  const params = fuzz ? { total, mode, graine: graine + t } : { complet, tranches: K, tranche: t };
  const res = await lancer(tache, params, fils);
  derniere = Date.now() - t0;
  lancees++;
  const inexpliques = rapporter(`${tache} tranche ${t + 1}/${K}`, res, V, { maxAffiches: 60, montrerPolitique: process.argv.includes('--politique') });
  etat.tranches[t] = { n: res.n, refusesProd: res.refusesProd, brut: res.reculs.length, inexpliques, secondes: Math.round(derniere / 1000) };
  enregistrer();
}
const faites = Object.values(etat.tranches);
const somme = (k) => faites.reduce((a, x) => a + x[k], 0);
console.log(`\nBILAN ${tache} : ${faites.length}/${K} tranche(s) faite(s), ${somme('n')} textes, ${somme('refusesProd')} refuses par la production, `
  + `${somme('brut')} reculs bruts, ${somme('inexpliques')} INEXPLIQUE(S)${faites.length < K ? ' ; RESTE ' + (K - faites.length) + ' tranche(s)' : ''}`);
process.exit(somme('inexpliques') ? 1 : 0);
