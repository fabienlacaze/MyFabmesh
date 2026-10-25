// TABLEAU « textes courts latins hors du filtre general » (24/10, lot securite). Passe chaque chaine de textes_courts_cas.json
// (avec et sans accents) dans les VRAIES fonctions : filtre du worker (PROD f86208c0 et copie de travail), bloc du bureau (main.js),
// module Python de Modal, detecterLangue / morceauxEtrangers des deux exemplaires de lib/langue-texte.js.
// Verdict par chaine : refuse (filtre) / traduit (le filet de langue enverrait un morceau au traducteur : le texte traduit repasse
// le filtre) / passe (ni l'un ni l'autre : LE TROU).
// Usage : node build/bancs/moderation/textes_courts.mjs [--sortie fichier.json] [--prod f86208c0] [--strict]
// --strict : code 1 si une chaine 'interdits' passe, ou si une chaine 'sur' est refusee.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { RACINE, arg, versions } from './lib_bancs.mjs';

const JEUX = arg('--cas', 'textes_courts_cas.json').split(',');
const sansAccents = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/[øØ]/g, 'o').replace(/ł/g, 'l').replace(/đ/g, 'd');
const V = versions({ sansAvant: true });
const LT = await import(pathToFileURL(join(RACINE, 'cloud', 'public', 'app', 'lib', 'langue-texte.js')).href);
const LT2 = await import(pathToFileURL(join(RACINE, 'src', 'renderer', 'lib', 'langue-texte.js')).href);

const main = readFileSync(process.env.MAIN_JS || join(RACINE, 'src', 'main', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
const d = main.indexOf('const __filtreModeration'), f = main.indexOf('function checkPromptSafety(prompt) {\n  return __filtreModeration');
const BUREAU = new Function('isUnrestrictedMode', main.slice(d, main.indexOf('}\n', f) + 2) + '\n;return { checkHardFloor, checkPromptSafety };')(() => false);

// chaines dont le seul mot de nudite est un mot courant d une autre langue : non couvertes EN CONNAISSANCE DE CAUSE (textes_courts_ambigus.json)
const AMBIGUS = new Set(JSON.parse(readFileSync(join(RACINE, 'build', 'bancs', 'moderation', 'textes_courts_ambigus.json'), 'utf8')).chaines);
const lignes = [];
for (const jeu of JEUX) {
  const cas = JSON.parse(readFileSync(join(RACINE, 'build', 'bancs', 'moderation', jeu), 'utf8'));
  for (const [groupe, attendu] of [['interdits', 'refus'], ['sur', 'sur']]) {
    for (const [langue, liste] of Object.entries(cas[groupe])) {
      const vus = new Set();
      for (const t0 of liste) for (const t of [t0, sansAccents(t0)]) {
        if (vus.has(t)) continue;
        vus.add(t);
        lignes.push({ jeu, groupe, attendu, langue, texte: t });
      }
    }
  }
}
const script = 'import importlib.util,json,sys\nspec=importlib.util.spec_from_file_location("m",sys.argv[1])\nm=importlib.util.module_from_spec(spec)\n'
  + 'spec.loader.exec_module(m)\njson.dump([[m.check_hard_floor(t)["safe"],m.check_prompt_safety(t,False)["safe"]] for t in json.load(sys.stdin)],sys.stdout)';
const py = JSON.parse(execFileSync('python', ['-I', '-X', 'utf8', '-c', script, process.env.MODERATION_MODULE || join(RACINE, 'modal_app', '_moderation_texte.py')],
  { input: JSON.stringify(lignes.map((l) => l.texte)), env: { ...process.env, PYTHONUTF8: '1' }, maxBuffer: 1 << 26 }).toString('utf8'));

const v = (m, t) => (!m.checkHardFloor(t).safe ? 'P' : (!m.checkPromptSafety(t, false).safe ? 'G' : '.'));
let trous = 0, ambigus = 0, fauxRefus = 0, ecartsParite = 0, ecartsLib = 0;
lignes.forEach((l, i) => {
  const t = l.texte;
  l.filtre_prod = v(V.PROD, t);
  l.filtre = v(V.APRES, t);
  l.filtre_bureau = v(BUREAU, t);
  l.filtre_modal = !py[i][0] ? 'P' : (!py[i][1] ? 'G' : '.');
  const det = LT.detecterLangue(t);
  l.detection = { langue: det.langue, sure: det.sure };
  l.morceaux = LT.morceauxEtrangers(t).length;
  l.morceaux_bureau = LT2.morceauxEtrangers(t).length;
  l.verdict = l.filtre !== '.' ? 'refuse' : (l.morceaux ? 'traduit' : 'passe');
  if (l.groupe === 'interdits' && l.verdict === 'passe' && AMBIGUS.has(l.texte)) { l.verdict = 'ambigu'; ambigus++; }
  else if (l.groupe === 'interdits' && l.verdict === 'passe') trous++;
  if (l.groupe === 'sur' && l.verdict === 'refuse') fauxRefus++;
  if (new Set([l.filtre, l.filtre_bureau, l.filtre_modal]).size > 1) ecartsParite++;
  if (l.morceaux !== l.morceaux_bureau) ecartsLib++;
});
const resume = {};
for (const l of lignes) {
  const r = (resume[l.jeu + ' ' + l.groupe + ':' + l.langue] = resume[l.jeu + ' ' + l.groupe + ':' + l.langue] || { refuse: 0, traduit: 0, passe: 0, ambigu: 0 });
  r[l.verdict]++;
}
const sortie = { date: new Date().toISOString(), prod: arg('--prod', 'f86208c0'), total: lignes.length, trous_interdits_qui_passent: trous,
  faux_refus_surs: fauxRefus, ecarts_parite_trois_copies: ecartsParite, ecarts_lib_site_bureau: ecartsLib, resume, lignes };
if (arg('--sortie')) writeFileSync(arg('--sortie'), JSON.stringify(sortie, null, 1), 'utf8');
if (process.argv.includes('--detail')) for (const [k, r] of Object.entries(resume)) console.log(k.padEnd(40), `refuse ${r.refuse}  traduit ${r.traduit}  passe ${r.passe}`);
for (const jeu of JEUX) {
  const L = lignes.filter((l) => l.jeu === jeu && l.groupe === 'interdits');
  const c = (v) => L.filter((l) => l.verdict === v).length;
  console.log(`${jeu.padEnd(26)} interdits ${String(L.length).padStart(4)} : refuses ${String(c('refuse')).padStart(4)}, traduits ${String(c('traduit')).padStart(4)}, PASSENT ${String(c('passe')).padStart(4)}`);
}
console.log(`\ntotal ${lignes.length} | interdits qui PASSENT : ${trous} (+ ${ambigus} ambigus assumes, textes_courts_ambigus.json) | surs refuses : ${fauxRefus} | ecarts de parite filtre : ${ecartsParite} | ecarts lib site/bureau : ${ecartsLib}`);
const prodPasse = lignes.filter((l) => l.groupe === 'interdits' && l.filtre_prod !== '.' && l.filtre === '.');
if (prodPasse.length) console.log('RECUL contre la production :', prodPasse.map((l) => l.texte).join(' | '));
if (process.argv.includes('--strict') && (trous || fauxRefus || ecartsParite || ecartsLib || prodPasse.length)) process.exit(1);
