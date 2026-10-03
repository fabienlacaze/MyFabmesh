// Miroir du filtre de prompt : cloud/src/nsfw_filter.ts (source de verite) -> src/main/main.js (bureau, JavaScript pur).
//
// Le filtre de texte existe en deux exemplaires qui ne peuvent pas partager de fichier (le Worker est en TypeScript, l'appli de bureau
// charge main.js tel quel). Avant le 2026-10-03 ils avaient diverge ; le bloc de main.js est desormais GENERE.
//
//   node build/miroir-moderation.mjs           verifie : code 1 si le bloc de main.js differe du bloc genere (garde de construction)
//   node build/miroir-moderation.mjs --sync    reecrit le bloc de main.js a partir de nsfw_filter.ts
//
// Le bloc est delimite dans main.js par les deux lignes « // >>> MIROIR MODERATION : DEBUT » et « // <<< MIROIR MODERATION : FIN ».
// Modifier nsfw_filter.ts, puis lancer --sync, puis cloud/tests/moderation.test.mjs et tests/main/moderation_bureau.test.mjs.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');
const cheminTs = join(racine, 'cloud', 'src', 'nsfw_filter.ts');
const cheminMain = join(racine, 'src', 'main', 'main.js');
const DEBUT = '// >>> MIROIR MODERATION : DEBUT';
const FIN = '// <<< MIROIR MODERATION : FIN';
const sync = process.argv.includes('--sync');

function echec(message) {
  console.error('[miroir-moderation] ECHEC : ' + message);
  process.exit(1);
}

let ts;
try {
  ts = createRequire(join(racine, 'cloud', 'package.json'))('typescript');
} catch (e) {
  echec('module typescript introuvable (cd cloud && npm install) : ' + e.message);
}

function genererBloc() {
  const source = readFileSync(cheminTs, 'utf8');
  let js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, removeComments: false } }).outputText;
  js = js.replace(/\r\n/g, '\n').replace(/^export /gm, '');
  // Le conseil de refus differe : sur le bureau, le mode « sans restriction » se regle dans les Reglages.
  const conseil = "const _CONSEIL_REFUS = 'Modify your prompt or contact support to request unrestricted access.';";
  if (!js.includes(conseil)) echec('ancre _CONSEIL_REFUS absente de nsfw_filter.ts (le generateur doit etre mis a jour)');
  js = js.replace(conseil, "const _CONSEIL_REFUS = 'Disable parental control in Settings to use unrestricted mode.';");
  for (const nom of ['checkHardFloor', 'checkPromptSafety', 'NSFW_KEYWORDS']) {
    if (!new RegExp('(function|const)\\s+' + nom + '\\b').test(js)) echec('symbole attendu absent de nsfw_filter.ts : ' + nom);
  }
  const entete = [
    '// ============================================================================',
    '// MIROIR BUREAU du filtre de prompt : GENERE par build/miroir-moderation.mjs --sync a partir de',
    '// cloud/src/nsfw_filter.ts (constats IA-02 / IA-03 / IA-04 du 2026-10-03). NE PAS EDITER A LA MAIN :',
    '// modifier nsfw_filter.ts puis relancer la commande ; la garde de construction refuse une divergence.',
    '// Tout le code est dans une fonction anonyme : seuls checkHardFloor, checkPromptSafety et NSFW_KEYWORDS',
    '// sont visibles dans main.js (memes noms et memes formes de retour qu\'avant, plus les champs optionnels',
    '// "categorie" et "hardFloor").',
    '// ============================================================================',
  ].join('\n');
  const corps = [
    'const __filtreModeration = (() => {',
    js.split('\n').map((l) => (l ? '  ' + l : l)).join('\n').replace(/\n+$/, ''),
    '  return { checkHardFloor, checkPromptSafety, NSFW_KEYWORDS };',
    '})();',
    '',
    'const NSFW_KEYWORDS = __filtreModeration.NSFW_KEYWORDS;',
    '',
    'function checkHardFloor(prompt) {',
    '  return __filtreModeration.checkHardFloor(prompt);',
    '}',
    '',
    'function checkPromptSafety(prompt) {',
    '  return __filtreModeration.checkPromptSafety(prompt, isUnrestrictedMode());',
    '}',
  ].join('\n');
  return entete + '\n' + corps;
}

const brut = readFileSync(cheminMain, 'utf8');
const eol = brut.includes('\r\n') ? '\r\n' : '\n';
const texte = brut.replace(/\r\n/g, '\n');
const i = texte.indexOf(DEBUT + '\n');
const j = texte.indexOf('\n' + FIN);
if (i < 0 || j < 0 || j < i) echec('marqueurs « ' + DEBUT + ' » / « ' + FIN + ' » introuvables (ou dans le mauvais ordre) dans src/main/main.js');
if (texte.indexOf(DEBUT, i + 1) >= 0) echec('marqueur de debut present plusieurs fois dans src/main/main.js');
const attendu = genererBloc();
const present = texte.slice(i + DEBUT.length + 1, j);

if (present === attendu) {
  console.log('[miroir-moderation] OK : le filtre de main.js est identique a cloud/src/nsfw_filter.ts (' + attendu.split('\n').length + ' lignes)');
  process.exit(0);
}
if (!sync) {
  const a = present.split('\n'), b = attendu.split('\n');
  let k = 0;
  while (k < a.length && k < b.length && a[k] === b[k]) k++;
  console.error('[miroir-moderation] DIVERGENCE : le filtre de src/main/main.js differe de celui genere depuis cloud/src/nsfw_filter.ts (premiere difference ligne ' + (k + 1) + ' du bloc).');
  console.error('  main.js : ' + String(a[k]).slice(0, 140));
  console.error('  genere  : ' + String(b[k]).slice(0, 140));
  console.error('  Corriger avec : node build/miroir-moderation.mjs --sync');
  process.exit(1);
}
const nouveau = texte.slice(0, i + DEBUT.length + 1) + attendu + texte.slice(j);
writeFileSync(cheminMain, nouveau.replace(/\n/g, eol));
console.log('[miroir-moderation] bloc reecrit dans src/main/main.js (' + attendu.split('\n').length + ' lignes). Relancer : cd cloud && node --test tests/moderation.test.mjs ; node --test tests/main/moderation_bureau.test.mjs');
