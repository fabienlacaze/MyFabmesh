// SECURITE DE LA LANGUE : LES MEMES CHAINES SONT REFUSEES PAR LES TROIS EXEMPLAIRES DU FILTRE (24/10, audit des prompts, B2).
// Audit : des textes explicites en chinois, hindi, arabe, russe, japonais et turc (mineurs compris) passaient le filtre. Le lot securite
// (cloud/src/nsfw_filter.ts) les refuse ; ce test prouve que les trois exemplaires — le TS du site, la copie Python de Modal
// (modal_app/_moderation_texte.py) et le miroir du bureau (bloc genere de src/main/main.js) — donnent le MEME verdict sur les chaines
// minimales de l'audit, et que les deux faux refus de l'audit (« torse nu », « nu » vietnamien) restent acceptes.
// Aucun contenu explicite : chaines minimales de l'audit, identiques a celles du corpus d'essai.
// Lancer : node --test tests/main/securite-corpus-trois-exemplaires.test.mjs
// Ancien code : MAIN_JS=<main.js de integration-2> NSFW_FILTER_SRC=<nsfw_filter.ts> MODERATION_MODULE=<_moderation_texte.py> node --test ...
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

const REFUSEES = [
  ['fr', 'une femme nue'], ['es', 'mujer desnuda'], ['de', 'nackte Frau'], ['zh', '裸体女人'], ['zh (mineur)', '裸体儿童'], ['ar', 'امرأة عارية'],
  ['hi', 'एक नग्न महिला'], ['ru', 'голая женщина'], ['tr', 'çıplak kadın'], ['ja', '裸の女性'], ['en (mineur)', 'naked child'],
];
const ACCEPTEES = [['fr', 'un guerrier barbare torse nu avec une hache'], ['vi', 'một nữ chiến binh cầm khiên'], ['en', 'an orc warrior with a club']];

// ---- site (TS)
const cheminTs = process.env.NSFW_FILTER_SRC || path.join(RACINE, 'cloud', 'src', 'nsfw_filter.ts');
const jsTs = ts.transpileModule(readFileSync(cheminTs, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const modTs = {};
new Function('exports', 'require', jsTs)(modTs, require);

// ---- bureau (bloc de moderation de main.js : meme technique que moderation_bureau.test.mjs)
const cheminMain = process.env.MAIN_JS || path.join(RACINE, 'src', 'main', 'main.js');
const main = readFileSync(cheminMain, 'utf8').replace(/\r\n/g, '\n');
let morceau;
if (main.includes('__filtreModeration')) {
  const d = main.indexOf('const __filtreModeration');
  const fin = main.indexOf('function checkPromptSafety(prompt) {\n  return __filtreModeration');
  assert.ok(d > 0 && fin > d, 'bloc du filtre introuvable dans main.js');
  morceau = main.slice(d, main.indexOf('}\n', fin) + 2);
} else {
  const debut = main.indexOf('const NSFW_KEYWORDS');
  const p1 = main.slice(debut, main.indexOf('/* BUILD MICROSOFT STORE'));
  const d2 = main.indexOf('// Dangerous combinations');
  const p2 = main.slice(d2, main.indexOf('// ====', d2));
  const d3 = main.indexOf('function checkPromptSafety(prompt) {');
  morceau = p1 + p2 + main.slice(d3, main.indexOf('// Layer 3: AI text classifier'));
}
const bureau = new Function('isUnrestrictedMode', morceau + '\n;return { checkPromptSafety, checkHardFloor };')(() => false);

// ---- Modal (copie Python)
const cheminPy = process.env.MODERATION_MODULE || path.join(RACINE, 'modal_app', '_moderation_texte.py');
function verdictsPython(textes) {
  const code = [
    'import importlib.util, json, sys',
    'spec = importlib.util.spec_from_file_location("m", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'textes = json.loads(sys.stdin.buffer.read().decode("utf-8"))',
    'out = [[bool(m.check_prompt_safety(t).get("safe") if isinstance(m.check_prompt_safety(t), dict) else m.check_prompt_safety(t)[0])] for t in textes]',
    'sys.stdout.write(json.dumps(out))',
  ].join('\n');
  let sortie;
  try {
    sortie = execFileSync(process.env.PYTHON || 'python', ['-I', '-c', code, cheminPy],
      { input: JSON.stringify(textes), encoding: 'utf8', timeout: 60000, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  } catch (e) { return null; }
  return JSON.parse(sortie).map((x) => x[0]);
}
const tous = [...REFUSEES, ...ACCEPTEES].map((x) => x[1]);
const py = verdictsPython(tous);

test('B2 : site (TS) et bureau (miroir) refusent les 11 chaines de l audit et acceptent les 3 chaines legitimes', () => {
  const fautes = [];
  for (const [lg, t] of REFUSEES) {
    if (modTs.checkPromptSafety(t).safe) fautes.push(`site accepte (${lg})`);
    if (bureau.checkPromptSafety(t).safe) fautes.push(`bureau accepte (${lg})`);
  }
  for (const [lg, t] of ACCEPTEES) {
    if (!modTs.checkPromptSafety(t).safe) fautes.push(`site refuse a tort (${lg}) : ${t}`);
    if (!bureau.checkPromptSafety(t).safe) fautes.push(`bureau refuse a tort (${lg}) : ${t}`);
  }
  assert.deepEqual(fautes, []);
});

test('B2 : la copie Python de Modal rend les memes verdicts (le test est saute, pas vert, si Python manque)', (t) => {
  if (!py) { t.skip('python indisponible'); return; }
  const attendu = [...REFUSEES.map(() => false), ...ACCEPTEES.map(() => true)];
  assert.deepEqual(py, attendu);
});

// ---- N3 : controle d'ouverture de « New project » du bureau (IPC check-prompt-text) = filtre complet, pas la liste de mots anglais
test('N3 : l IPC check-prompt-text du bureau refuse les 11 chaines (texte brut ou traduit) et accepte les chaines legitimes', () => {
  const iFn = main.indexOf('function refusTexteOutil(');
  assert.ok(iFn > 0, 'refusTexteOutil introuvable');
  const finFn = main.indexOf('\n}\n', iFn) + 3;
  const iH = main.indexOf("ipcMain.handle('check-prompt-text'");
  assert.ok(iH > 0, "IPC 'check-prompt-text' absent de main.js");
  const finH = main.indexOf('\n});\n', iH) + 5;
  const handlers = {};
  const fabrique = new Function('ipcMain', 'checkPromptSafety', 'checkHardFloor',
    main.slice(iFn, finFn) + '\n' + main.slice(iH, finH) + '\n;return refusTexteOutil;');
  fabrique({ handle: (nom, f) => { handlers[nom] = f; } }, bureau.checkPromptSafety, bureau.checkHardFloor);
  const h = handlers['check-prompt-text'];
  for (const [lg, t] of REFUSEES) assert.deepEqual(h({}, { texts: ['mon projet', t] }), { safe: false }, lg);
  // le nom ET le texte traduit sont lus : une traduction non sure suffit
  assert.deepEqual(h({}, { texts: ['mon projet', 'un texte sans danger', 'a naked woman'] }), { safe: false });
  for (const [lg, t] of ACCEPTEES) assert.deepEqual(h({}, { texts: ['mon projet', t] }), { safe: true }, lg);
  assert.deepEqual(h({}, {}), { safe: true }, 'corps vide : rien a refuser');
  assert.deepEqual(h({}, { texts: 'pas un tableau' }), { safe: true });
});
