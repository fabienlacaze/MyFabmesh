// COLLISIONS AVEC DES MOTS COURANTS (24/10, correction de prompts-secu-2410 apres la relecture independante).
// Le lot « textes courts latins » avait ajoute au filtre des termes de nudite / d enfant qui sont aussi des mots du quotidien d une AUTRE langue :
// « dalam » (« dans » en indonesien et malais), « berpakaian » (« habille »), « goala » (« vide » en roumain), « nudos » (« noeuds »), « luoti »
// (« balle » en finnois), « borsten », « blote » / « bloot », « nektar* », « nocht* », « toples » (bocal), « lenjerie* » (linge de lit), « tepel »,
// « nogen + nom » (danois « quelqu un »), « gol + verbe » (but), « naket » et « nahy » (repliement des homoglyphes : « пакет » = « naket »,
// « пану » = « nahy »), « nakin* » (tagalog « nakinig »), « haur* » (catalan « hauria »), « lasta », « dite », « deti », « kanner »...
// Pour CHAQUE terme retire : une phrase legitime qui doit passer, et la tournure non ambigue qui garde le trou ferme et doit etre refusee.
// Les TROIS exemplaires du filtre (site TS, miroir du bureau dans main.js, module Python de Modal) doivent donner le meme verdict.
// Lancer : node --test tests/main/collisions-mots-courants.test.mjs
// Ancien code (preuve d echec) : NSFW_FILTER_SRC=<nsfw_filter.ts de a4ead095> MAIN_JS=<main.js de a4ead095> MODERATION_MODULE=<_moderation_texte.py de a4ead095>
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ici = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.join(ici, '..', '..');
const ts = require(path.join(RACINE, 'cloud', 'node_modules', 'typescript'));

// [terme retire, phrase LEGITIME qui doit passer, tournure non ambigue qui doit etre REFUSEE]
const CAS = [
  ['dalam', 'ikan di dalam akuarium', 'celana dalam'],
  ['dalam', 'anak kucing dalam keranjang', 'seluar dalam'],
  ['dalam', 'bayi dalam gendongan', 'gadis pakaian dalam'],
  ['berpakaian', 'ksatria berpakaian zirah', 'tidak berpakaian'],
  ['berpakaian', 'wanita berpakaian rapi di kantor', 'kurang berpakaian'],
  ['toples', 'toples kue lebaran di atas meja', 'gadis toples'],
  ['toples', 'foto toples kaca berisi nastar', 'dekle toples'],
  ['goala', 'camera goală cu o fereastră mare', 'femeie goala'],
  ['goale', 'cu mâinile goale', 'fete goale'],
  ['goala', 'o sticlă goală pe masă', 'pielea goala'],
  ['lenjerie*', 'lenjerie de pat din bumbac', 'lenjerie intima'],
  ['nudos', 'madera con nudos', 'desnudo'],
  ['luoti', 'pistooli ja luoti', 'luoti nuren'],
  ['luoti', 'kultainen luoti', 'xiao haizi luoti'],
  ['borsten', 'een borstel met harde borsten', 'naakte borsten'],
  ['blote', 'met blote handen een steen optillen', 'blote vrouw'],
  ['blote', 'met het blote oog zichtbaar', 'blote meisjes'],
  ['bloot', 'de blote waarheid', 'bloot meisje'],
  ['bloot', 'rood bloot hout van de boom', 'in het bloot'],
  ['bloot', 'blote handen op het stuur', 'bloot rondlopen'],
  ['nocht*', 'nochtans een mooie dag in Brussel', 'nocht'],
  ['nektar*', 'nektar kwiat pszczola', 'nagi mezczyzna'],
  ['dalam', 'Dałam ci prezent', 'naga kobieta'],
  ['tepel', 'tepel mesto v Čechách', 'tepels'],
  ['nogen kvinde', 'er der nogen kvinde der kan hjælpe', 'nøgen kvinde'],
  ['nogen dreng', 'nogen dreng spillede fodbold', 'nogne drenge'],
  ['nogen mand', 'nogen mand i haven', 'nøgen mand'],
  ['lezi gol', 'zabio je gol u 90. minuti', 'golo dijete'],
  ['fant gol', 'fant je zabil gol', 'gol fant'],
  ['naket', 'пакет с яблоками', 'naken'],
  ['nahy', 'Подякуйте пану Ковальському', 'nahy muz'],
  ['nahy', 'дякую пану директору', 'chlapec bezici nahy'],
  ['nakin*', 'nakinig ako sa musika', 'nakinn'],
  ['nakin*', 'nakinabang siya sa regalo', 'nakid'],
  ['nakta', 'tapınakta bir heykel', 'nakin'],
  ['haur*', 'hauria de venir demà', 'haur biluzia'],
  ['haur*', 'haurà un problema', 'haurtxo biluzik'],
  ['lasta', 'ma ei lasta teda', 'alasti laps'],
  ['vaiko', 'tämäkö vaiko tuo', 'alaston lapsi'],
  ['dite', 'la dite fée dans la forêt', 'nahe dite'],
  ['dite', 'dite a tutti buongiorno', 'dite bez obleceni'],
  ['deti', 'deti sa hrajú v záhrade', 'nahe deti'],
  ['kanner', 'wat känner du där', 'meedchen nackeg'],
  ['barna', 'barna haju lány a parkban', 'barn uten klaer'],
  ['bebis*', 'si, bebiste agua del grifo', 'bebisen naken'],
  ['tarbija', 'tarbija kaitse amet', 'alasti laps'],
  ['korpe', 'korpe hljeba na stolu', 'cilpaq usaq'],
  ['nenas', 'nenas ananás fruta', 'neno espido'],
  ['golas*', 'golash rubber boots', 'golas'],
];
// Les tournures dont le verdict depend du mot d enfant (plancher) sont aussi refusees ; ici « refusee » = general OU plancher
const ORDINAIRES = ['hauria de venir', 'dite a tutti buongiorno', 'känner du den där', 'lasta ta minna', 'vaikus metsas', 'tarbija kaitse', 'nenas ananás',
    'barna haju lány', 'berna capital de Suiza', 'korpe hljeba', 'bebiste agua', 'deti pri mori', 'dece bi trebalo', 'batita yang lucu bermain'];
const sansAccents = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/[øØ]/g, 'o').replace(/ł/g, 'l').replace(/đ/g, 'd');

// ---- site (TS)
const cheminTs = process.env.NSFW_FILTER_SRC || path.join(RACINE, 'cloud', 'src', 'nsfw_filter.ts');
const jsTs = ts.transpileModule(readFileSync(cheminTs, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const modTs = {};
new Function('exports', 'require', jsTs)(modTs, require);
// ---- bureau
const main = readFileSync(process.env.MAIN_JS || path.join(RACINE, 'src', 'main', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
const d = main.indexOf('const __filtreModeration');
const fin = main.indexOf('function checkPromptSafety(prompt) {\n  return __filtreModeration');
assert.ok(d > 0 && fin > d, 'bloc du filtre introuvable dans main.js');
const bureau = new Function('isUnrestrictedMode', main.slice(d, main.indexOf('}\n', fin) + 2) + '\n;return { checkPromptSafety, checkHardFloor };')(() => false);
// ---- Modal
const cheminPy = process.env.MODERATION_MODULE || path.join(RACINE, 'modal_app', '_moderation_texte.py');
function verdictsPython(textes) {
  const code = [
    'import importlib.util, json, sys',
    'spec = importlib.util.spec_from_file_location("m", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'textes = json.loads(sys.stdin.buffer.read().decode("utf-8"))',
    'out = [[bool(m.check_prompt_safety(t)["safe"]), bool(m.check_hard_floor(t)["safe"])] for t in textes]',
    'sys.stdout.write(json.dumps(out))',
  ].join('\n');
  try {
    return JSON.parse(execFileSync(process.env.PYTHON || 'python', ['-I', '-c', code, cheminPy],
      { input: JSON.stringify(textes), encoding: 'utf8', timeout: 120000, maxBuffer: 1 << 26, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }));
  } catch (e) { return null; }
}
const textes = [...new Set([...CAS.flatMap(([, a, b]) => [a, sansAccents(a), b, sansAccents(b)]), ...ORDINAIRES])];
const py = verdictsPython(textes);
const idx = new Map(textes.map((t, i) => [t, i]));
const verdicts = (t) => ({
  site: [modTs.checkPromptSafety(t).safe, modTs.checkHardFloor(t).safe],
  bureau: [bureau.checkPromptSafety(t).safe, bureau.checkHardFloor(t).safe],
  modal: py ? py[idx.get(t)] : null,
});

test('chaque phrase legitime contenant un ancien terme en collision passe sur les trois exemplaires (avec et sans accents)', () => {
  const fautes = [];
  for (const [terme, legit] of CAS) {
    for (const t of new Set([legit, sansAccents(legit)])) {
      const v = verdicts(t);
      for (const [ou, r] of Object.entries(v)) if (r && (!r[0] || !r[1])) fautes.push(`${ou} refuse a tort (ancien terme « ${terme} ») : ${t}`);
    }
  }
  assert.equal(fautes.length, 0, fautes.join('\n  '));
});

test('la tournure non ambigue qui remplace chaque terme retire reste REFUSEE sur les trois exemplaires (le trou reste ferme)', () => {
  const fautes = [];
  for (const [terme, , tournure] of CAS) {
    const v = verdicts(tournure);
    for (const [ou, r] of Object.entries(v)) if (r && r[0] && r[1]) fautes.push(`${ou} accepte la tournure de « ${terme} » : ${tournure}`);
  }
  assert.equal(fautes.length, 0, fautes.join('\n  '));
});

test('les trois exemplaires donnent le meme verdict sur toutes ces chaines', () => {
  assert.ok(py, 'python introuvable ou module Modal illisible : parite non verifiable');
  const ecarts = [];
  for (const t of textes) {
    const v = verdicts(t);
    if (v.site.join() !== v.bureau.join() || v.site.join() !== v.modal.join()) ecarts.push(`${t} : site ${v.site} bureau ${v.bureau} modal ${v.modal}`);
  }
  assert.equal(ecarts.length, 0, ecarts.join('\n  '));
});

test('un mot d enfant ordinaire d une autre langue n est jamais refuse seul ni dans une phrase ordinaire', () => {
  // « sprog », « tots » (anglais) existaient deja ; ici les mots du quotidien d autres langues que les termes d enfant du lot collisionnaient
  const fautes = [];
  for (const t of ORDINAIRES) {
    for (const [ou, r] of Object.entries(verdicts(t) || {})) if (r && (!r[0] || !r[1])) fautes.push(`${ou} refuse : ${t}`);
  }
  assert.equal(fautes.length, 0, fautes.join('\n  '));
});
