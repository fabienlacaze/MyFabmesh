// PREUVES D'ECHEC du test du processus principal du bureau (tests/main/option-normales.test.mjs) : chaque MUTANT doit le faire echouer.
// Rien n'est ecrit dans le depot : chaque mutant est ecrit dans le dossier temporaire et designe au test par une variable d'environnement.
//   node build/bancs/preuves-option-normales/preuves-main.mjs             (code de sortie 0 = tous les mutants sont detectes)
// Preuve complementaire sur le code d'AVANT l'option :
//   MAIN_JS=<main.js de 3886f61a> OPTION_NORMALES_JS=<chemin absent> node --test tests/main/option-normales.test.mjs   (8 echecs sur 11 attendus)
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SORTIE = mkdtempSync(path.join(tmpdir(), 'preuves-main-'));

const FICHIERS = { main: ['src/main/main.js', 'MAIN_JS'], option: ['src/main/option_normales.js', 'OPTION_NORMALES_JS'],
  preload: ['src/main/preload.js', 'PRELOAD_JS'], pipeline: ['scripts/trellis2_native_full_pipeline.py', 'PIPELINE_BUREAU'],
  noyau: ['scripts/normal_bake.py', 'NOYAU_NORMAL_BAKE'], cloud: ['src/main/cloud_fallback.js', 'CLOUD_FALLBACK_JS'] };

const MUTANTS = [
  ['option', 'option non stricte', 'return valeur === true;', 'return !!valeur;'],
  ['option', 'variable posee seulement quand active', "env[VARIABLE] = optionActive(valeur) ? '1' : '0';", "if (optionActive(valeur)) env[VARIABLE] = '1';"],
  ['option', 'mauvais nom de variable', "const VARIABLE = 'FABMESH_NORMAL_MAP_OPTION';", "const VARIABLE = 'FABMESH_NORMAL_MAP_OPT';"],
  ['main', 'champ de la page ignore', 'trellis2MaxTris, trellis2NormalMap, assetType })', 'trellis2MaxTris, assetType })'],
  ['main', 'drapeau Cloud non strict', 'normal_map: OptionNormales.optionActive(trellis2NormalMap),   // option gratuite', 'normal_map: !!trellis2NormalMap,   // option gratuite'],
  ['main', 'drapeau Cloud retire', 'normal_map: OptionNormales.optionActive(trellis2NormalMap),   // option gratuite', '// retire   // option gratuite'],
  ['main', 'variable du pipeline retiree', "...(engine === 'trellis2_native' ? OptionNormales.variablesEnv(trellis2NormalMap) : {}),", ''],
  ['main', 'variable du pipeline pour tous les moteurs', "...(engine === 'trellis2_native' ? OptionNormales.variablesEnv(trellis2NormalMap) : {}),", '...OptionNormales.variablesEnv(trellis2NormalMap),'],
  ['main', 'module de regle non charge', "const OptionNormales = require('./option_normales');", 'const OptionNormales = { optionActive: (v) => v === true, variablesEnv: () => ({}) };'],
  ['preload', 'preload filtre les options', "imageTo3D: (opts) => ipcRenderer.invoke('image-to-3d', opts),", "imageTo3D: (opts) => ipcRenderer.invoke('image-to-3d', { ...opts, trellis2NormalMap: undefined }),"],
  ['pipeline', 'pipeline sans la vraie regle', 'if carte_normales_voulue(option_carte_normales()):', 'if carte_normales_active():'],
  ['noyau', 'valeur oui du noyau changee', 'return str(env.get(OPTION_ENV, "")).strip() == "1"', 'return str(env.get(OPTION_ENV, "")).strip().lower() in ("1", "true")'],
  ['noyau', 'nom de variable du noyau change', 'OPTION_ENV = "FABMESH_NORMAL_MAP_OPTION"', 'OPTION_ENV = "FABMESH_NORMAL_MAP_OPT"'],
  ['cloud', 'cloud_fallback n envoie plus les drapeaux', "for (const [k, v] of Object.entries(flags)) fd.append(k, v ? 'true' : 'false');", "for (const [k, v] of Object.entries(flags)) if (k !== 'normal_map') fd.append(k, v ? 'true' : 'false');"],
];

let detectes = 0;
MUTANTS.forEach(([cle, nom, ancien, nouveau], i) => {
  const [rel, variable] = FICHIERS[cle];
  const brut = readFileSync(path.join(RACINE, rel), 'utf8');
  const nl = brut.includes('\r\n') ? '\r\n' : '\n';
  const a = ancien.replace(/\n/g, nl), n = nouveau.replace(/\n/g, nl);
  const k = brut.split(a).length - 1;
  if (k !== 1) { console.log(`ANCRE (${k}) : ${nom}`); process.exit(2); }
  const chemin = path.join(SORTIE, `${i}_${path.basename(rel)}`);
  writeFileSync(chemin, brut.replace(a, n));
  const env = { ...process.env, [variable]: chemin };
  const r = spawnSync(process.execPath, ['--test', 'tests/main/option-normales.test.mjs'], { cwd: RACINE, env, encoding: 'utf8' });
  if (r.status !== 0) { detectes++; console.log('detecte     : ' + nom); } else console.log('NON DETECTE : ' + nom);
});
console.log(`${MUTANTS.length} mutants, ${detectes} detectes`);
rmSync(SORTIE, { recursive: true, force: true });
process.exit(detectes === MUTANTS.length ? 0 : 1);
