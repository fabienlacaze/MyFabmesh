// GARDE « MOTS COURANTS » (24/10, apres la relecture de prompts-secu-2410). Un terme de nudite ou d enfant ajoute au filtre pour UNE langue
// peut etre un mot du quotidien d une AUTRE (« dalam » = « dans » en indonesien, « goala » = « vide » en roumain, « nudos » = « noeuds »
// en espagnol) : le filtre refuse alors des phrases innocentes. Un banc de phrases ecrites a la main ne les voit pas ; ce balayage, si.
//
// Methode : chaque mot des listes de frequence (mots_courants/<langue>.txt[.gz], ordre de frequence decroissant ; source : FrequencyWords
// de hermitdave, sous-titres OpenSubtitles, CC-BY-SA-4.0 ; les 20 000 premiers mots de 32 langues) est juge par les VRAIES fonctions du
// filtre (copie de travail) dans le gabarit « <mot> bath » (« bath » est le mot de nudite faible du plancher : il revele a la fois un terme de
// nudite ecrit seul et un terme d enfant). Un mot est un HIT s il est refuse (G ou P) par la copie de travail et PAS par la version de reference
// (--avant, defaut le parent fbc8079e). Tout hit qui n est pas dans la LISTE BLANCHE (mots_courants_politique.json) fait echouer la garde :
// SEUIL ZERO. La liste blanche ne contient que des mots dont le sens, dans la langue, EST la nudite, l acte sexuel ou l enfant : decision de
// politique ecrite (terme, langue, raison), jamais un mot du quotidien.
//
// Les langues sans liste de frequence (tagalog, swahili, afrikaans, gallois, latin, esperanto, somali, azeri, ouzbek, maltais, irlandais, javanais,
// ...) ont une liste de REPLI ecrite a la main (repli_<code>.txt, ~120-170 mots du quotidien) : moins complete, voir le rapport.
// Les 20 000 mots x 32 langues prennent ~3 minutes : le resultat est memorise (mots_courants.cache.json, empreinte du filtre + des listes + de la liste
// blanche) ; une garde a jour repond en une seconde. --force ignore la memoire. --ecrire met la memoire a jour quand la garde passe.
// Usage : node build/bancs/moderation/mots_courants.mjs [--avant fbc8079e] [--dir <dossier de listes>] [--max <rang>] [--langues id,ms]
//         [--sortie hits.json] [--tout] [--force] [--sans-cache]
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { arg, charger, source, sourceApres, verdict, RACINE } from './lib_bancs.mjs';

const ICI = dirname(fileURLToPath(import.meta.url));
const DIR = arg('--dir', join(ICI, 'mots_courants'));
const MAX = +arg('--max', 1e9);
const LANGUES = arg('--langues', '') ? arg('--langues').split(',') : null;
// Reference = le filtre PARENT du lot securite (fbc8079e = prompts-2410), copie dans reference/ : une copie de travail en integration continue n a pas
// l historique git (fetch-depth 1). Les hits sont donc les mots refuses PAR LES AJOUTS depuis ce parent ; la liste blanche porte les termes voulus du lot
// securite. (Contre la production f86208c0 il y a aussi les ~50 mots par langue du lot de base prompts-2410, juges par ses propres relectures.)
// --avant <revision> compare a une revision git a la place (ex. --avant f86208c0 pour mesurer contre la production).
const AVANT = arg('--avant', 'fbc8079e');
const REF_SRC = arg('--avant') ? source(AVANT) : readFileSync(join(ICI, 'reference', 'nsfw_filter_parent_fbc8079e.ts'), 'utf8');
const SANS_CACHE = process.argv.includes('--sans-cache') || process.argv.includes('--force') || arg('--dir') || arg('--max') || LANGUES;
const FICHIER_CACHE = join(ICI, 'mots_courants.cache.json');
const FICHIER_BLANCHE = join(ICI, 'mots_courants_politique.json');

const lireFichier = (f) => (f.endsWith('.gz') ? gunzipSync(readFileSync(f)).toString('utf8') : readFileSync(f, 'utf8'));
const lire = (f) => lireFichier(f).replace(/\r/g, '').split('\n').map((l) => l.split(' ')[0].trim()).filter(Boolean);

const fichiers = readdirSync(DIR).filter((f) => /^(repli_)?[a-z]{2,3}\.txt(\.gz)?$/.test(f)).sort();
const blanche = existsSync(FICHIER_BLANCHE) ? JSON.parse(readFileSync(FICHIER_BLANCHE, 'utf8')) : { entrees: [] };

// ── memoire : empreinte du filtre + des listes + de la liste blanche + de la reference ────────────────────────────────────────
const sha = (b) => createHash('sha256').update(b).digest('hex');
const filtreSrc = readFileSync(process.env.NSFW_FILTER_SRC || join(RACINE, 'cloud', 'src', 'nsfw_filter.ts'), 'utf8').replace(/\r\n/g, '\n');
const empreinte = sha([sha(filtreSrc), sha(REF_SRC.split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))), AVANT, sha(readFileSync(FICHIER_BLANCHE, 'utf8').replace(/\r\n/g, '\n')),
  ...fichiers.map((f) => f + ':' + sha(f.endsWith('.gz') ? readFileSync(join(DIR, f)) : lireFichier(join(DIR, f)).split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))))].join('|'));
if (!SANS_CACHE && existsSync(FICHIER_CACHE)) {
  const c = JSON.parse(readFileSync(FICHIER_CACHE, 'utf8'));
  if (c.empreinte === empreinte && c.resultat === 'ok') {
    console.log(`mots courants : OK (memoire a jour, ${c.mots} mots, ${c.langues} langues, ${c.hits} hits en liste blanche, mesure du ${c.date})`);
    process.exit(0);
  }
}

const PROD = charger(REF_SRC), APRES = charger(sourceApres());

// mot -> [{ langue, rang, repli }]
const mots = new Map();
const parLangue = {};
for (const f of fichiers) {
  const repli = f.startsWith('repli_');
  const langue = f.replace(/^repli_/, '').replace(/\.txt(\.gz)?$/, '');
  if (LANGUES && !LANGUES.includes(langue)) continue;
  const liste = lire(join(DIR, f)).slice(0, MAX);
  parLangue[langue] = (parLangue[langue] || 0) + liste.length;
  liste.forEach((m, i) => {
    if (m.length < 2) return;
    if (!mots.has(m)) mots.set(m, []);
    mots.get(m).push({ langue, rang: i + 1, repli });
  });
}

const clefBlanche = new Set();
for (const e of blanche.entrees) for (const t of e.termes) clefBlanche.add(`${t}\t${e.langue}`);
const refus = (m, t) => verdict(m, t) !== '.';

const hits = [];
let essais = 0;
for (const [mot, occ] of mots) {
  const t = `${mot} bath`;
  essais++;
  const v = verdict(APRES, t);
  if (v === '.' || refus(PROD, t)) continue;
  const seul = verdict(APRES, mot) !== '.' ? 'seul' : 'enfant';
  const langues = occ.map((o) => o.langue + ':' + o.rang + (o.repli ? 'r' : '')).join(' ');
  const ok = occ.some((o) => clefBlanche.has(`${mot}\t${o.langue}`)) || clefBlanche.has(`${mot}\t*`);
  hits.push({ mot, gabarit: seul, verdict: v, langues, blanche: ok, rangMin: Math.min(...occ.map((o) => o.rang)) });
}
const aTraiter = hits.filter((h) => !h.blanche);
if (arg('--sortie')) writeFileSync(arg('--sortie'), JSON.stringify(hits, null, 1), 'utf8');
console.log(`${mots.size} mots distincts (${Object.keys(parLangue).length} langues), ${essais} essais ; hits : ${hits.length} (liste blanche ${hits.length - aTraiter.length}, A TRAITER ${aTraiter.length}) contre ${AVANT}`);
for (const h of (process.argv.includes('--tout') ? hits : aTraiter).sort((a, b) => a.rangMin - b.rangMin)) {
  console.log(`  ${h.blanche ? '[blanche] ' : ''}${h.mot}  [${h.gabarit} ${h.verdict}]  ${h.langues}`);
}
if (aTraiter.length) {
  console.log('\nECHEC : mots courants nouvellement refuses. Retirer le terme (ou le reecrire en tournure non ambigue), ou l inscrire dans\n'
    + 'mots_courants_politique.json avec sa raison (uniquement si le mot SIGNIFIE la nudite / l enfant dans cette langue).');
  process.exit(1);
}
if (!SANS_CACHE || process.argv.includes('--ecrire')) {
  writeFileSync(FICHIER_CACHE, JSON.stringify({ empreinte, resultat: 'ok', date: new Date().toISOString().slice(0, 10), mots: mots.size,
    langues: Object.keys(parLangue).length, hits: hits.length }, null, 1) + '\n', 'utf8');
}
