// GARDE « MOTS COURANTS » (24/10, apres la relecture de prompts-secu-2410). Un terme de nudite ou d enfant ajoute au filtre pour UNE langue
// peut etre un mot du quotidien d une AUTRE (« dalam » = « dans » en indonesien, « goala » = « vide » en roumain, « nudos » = « noeuds »
// en espagnol) : le filtre refuse alors des phrases innocentes. Un banc de phrases ecrites a la main ne les voit pas ; ce balayage, si.
//
// Methode : chaque mot des listes de frequence (mots_courants/<langue>.txt, ordre de frequence decroissant, ~32 langues) est juge par les
// VRAIES fonctions du filtre (copie de travail) dans deux gabarits :
//   « <mot> »            : le mot seul (collision d un terme de nudite ou de mineur ecrit seul) ;
//   « <mot> bath »       : le mot + « bath » (plancher mineur + nudite faible) : collision d un terme d enfant avec un mot courant.
// Un mot est un HIT s il est refuse (G ou P) par la copie de travail et PAS par la version de reference (--avant, defaut la production
// f86208c0). Tout hit qui n est pas dans la LISTE BLANCHE (mots_courants_politique.json : { terme, langue, raison }) fait echouer la garde :
// SEUIL ZERO. La liste blanche ne contient que des mots dont le sens, dans la langue, EST la nudite ou l enfant (decision de politique ecrite).
//
// Les langues sans liste de frequence (tagalog, swahili, afrikaans, gallois, latin, esperanto, somali, azeri, ouzbek, maltais, irlandais,
// javanais, ...) ont une liste de REPLI ecrite a la main (mots_courants/repli_<code>.txt, ~100-250 mots du quotidien) : moins complete.
// Usage : node build/bancs/moderation/mots_courants.mjs [--avant f86208c0] [--dir <dossier de listes>] [--max <rang>] [--langues id,ms]
//         [--sortie hits.json] [--tout]   (--tout : liste aussi les hits en liste blanche)
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { arg, versions, verdict } from './lib_bancs.mjs';

const ICI = dirname(fileURLToPath(import.meta.url));
const DIR = arg('--dir', join(ICI, 'mots_courants'));
const MAX = +arg('--max', 1e9);
const LANGUES = arg('--langues', '') ? arg('--langues').split(',') : null;
const AVANT = arg('--avant', 'f86208c0');
const { PROD, APRES } = versions({ prod: AVANT, sansAvant: true });

const GABARITS = [['seul', (m) => m], ['enfant', (m) => `${m} bath`]];
const lire = (f) => readFileSync(f, 'utf8').replace(/\r/g, '').split('\n').map((l) => l.split(' ')[0].trim()).filter(Boolean);

// mot -> [{ langue, rang, repli }]
const mots = new Map();
const fichiers = readdirSync(DIR).filter((f) => f.endsWith('.txt'));
const parLangue = {};
for (const f of fichiers) {
  const repli = f.startsWith('repli_');
  const langue = f.replace(/^repli_/, '').replace(/\.txt$/, '');
  if (LANGUES && !LANGUES.includes(langue)) continue;
  const liste = lire(join(DIR, f)).slice(0, MAX);
  parLangue[langue] = (parLangue[langue] || 0) + liste.length;
  liste.forEach((m, i) => {
    if (m.length < 2) return;
    if (!mots.has(m)) mots.set(m, []);
    mots.get(m).push({ langue, rang: i + 1, repli });
  });
}

const blanche = existsSync(join(ICI, 'mots_courants_politique.json')) ? JSON.parse(readFileSync(join(ICI, 'mots_courants_politique.json'), 'utf8')) : [];
const clefBlanche = new Set(blanche.map((b) => `${b.terme}\t${b.langue}`));
const refus = (m, t) => verdict(m, t) !== '.';

const hits = [];
let essais = 0;
for (const [mot, occ] of mots) {
  for (const [nom, g] of GABARITS) {
    const t = g(mot);
    essais++;
    if (verdict(APRES, t) === '.') continue;
    if (refus(PROD, t)) continue;
    const langues = occ.map((o) => o.langue + ':' + o.rang + (o.repli ? 'r' : '')).join(' ');
    const ok = occ.some((o) => clefBlanche.has(`${mot}\t${o.langue}`)) || clefBlanche.has(`${mot}\t*`);
    hits.push({ mot, gabarit: nom, verdict: verdict(APRES, t), langues, blanche: ok, rangMin: Math.min(...occ.map((o) => o.rang)) });
    break;
  }
}
const aTraiter = hits.filter((h) => !h.blanche);
if (arg('--sortie')) writeFileSync(arg('--sortie'), JSON.stringify(hits, null, 1), 'utf8');
console.log(`${mots.size} mots distincts (${Object.keys(parLangue).length} langues), ${essais} essais ; hits : ${hits.length} (liste blanche ${hits.length - aTraiter.length}, A TRAITER ${aTraiter.length}) contre ${AVANT}`);
for (const h of (process.argv.includes('--tout') ? hits : aTraiter).sort((a, b) => a.rangMin - b.rangMin)) {
  console.log(`  ${h.blanche ? '[blanche] ' : ''}${h.mot}  [${h.gabarit} ${h.verdict}]  ${h.langues}`);
}
if (aTraiter.length) {
  console.log('\nECHEC : mots courants nouvellement refuses. Retirer le terme (ou le reecrire en tournure non ambigue), ou l inscrire dans mots_courants_politique.json avec sa raison.');
  process.exit(1);
}
