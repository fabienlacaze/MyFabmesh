// PREUVES D'ECHEC du test des deux interfaces (tests/bureau-interface/option-normales-interface.test.mjs) : chaque MUTANT de
// src/renderer ou de cloud/public/app doit le faire echouer. Rien n'est ecrit dans le depot : copies dans le dossier temporaire.
//   node build/bancs/preuves-option-normales/preuves-interface.mjs        (code de sortie 0 = tous les mutants sont detectes)
// Preuve complementaire sur le code d'AVANT l'option :
//   git archive 3886f61a src/renderer cloud/public/app | tar -x -C <dossier>
//   RENDERER=<dossier>/src/renderer SITE=<dossier>/cloud/public/app node --test tests/bureau-interface/option-normales-interface.test.mjs   (13 echecs sur 15 attendus)
import { readFileSync, writeFileSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SORTIE = mkdtempSync(path.join(tmpdir(), 'preuves-interface-'));
cpSync(path.join(RACINE, 'src', 'renderer'), path.join(SORTIE, 'renderer'), { recursive: true });
cpSync(path.join(RACINE, 'cloud', 'public', 'app'), path.join(SORTIE, 'site'), { recursive: true });

const PROFIL_B = "const ASSET_OPTIONS_PROFILE = {\n  character: {\n";
const MUTANTS = [
  ['renderer/index2.html', 'bureau : case cochee par defaut', '<input type="checkbox" id="ws-trellis2-normal-map" />', '<input type="checkbox" id="ws-trellis2-normal-map" checked />'],
  ['renderer/index2.html', 'bureau : case retiree', '<input type="checkbox" id="ws-trellis2-normal-map" />', '<input type="checkbox" id="ws-trellis2-normal-map-x" />'],
  ['renderer/index2.html', 'bureau : libelle change', '                        Game-engine relief (normal map)\n', '                        Normal map\n'],
  ['renderer/index2.html', 'bureau : infobulle changee', 'a texture of at most 2048px that game engines', 'a texture of at most 4096px that game engines'],
  ['renderer/index2.js', 'bureau : lecture non stricte', "document.getElementById('ws-trellis2-normal-map')?.checked === true", "document.getElementById('ws-trellis2-normal-map')?.checked || false"],
  ['renderer/index2.js', 'bureau : option non transmise', "    trellis2NormalMap,                   // option", "    // retire,                   // option"],
  ['renderer/index2.js', 'bureau : case forcee par le profil', PROFIL_B, PROFIL_B + "    'ws-trellis2-normal-map':   null,\n"],
  ['renderer/index2.js', 'bureau : case declaree morte en mode Cloud', "var _OPTIONS_MORTES_CLOUD = ['ws-trellis2-refine', 'ws-trellis2-face-fix'];", "var _OPTIONS_MORTES_CLOUD = ['ws-trellis2-refine', 'ws-trellis2-face-fix', 'ws-trellis2-normal-map'];"],
  ['renderer/index2.js', 'bureau : case rangee parmi les reglages automatiques', "var _AUTO3D_OPTIONS = ['ws-trellis2-rectify',", "var _AUTO3D_OPTIONS = ['ws-trellis2-normal-map', 'ws-trellis2-rectify',"],
  ['site/index.html', 'site : case cochee par defaut', '<input type="checkbox" id="ws-trellis2-normal-map" />', '<input type="checkbox" id="ws-trellis2-normal-map" checked />'],
  ['site/index.html', 'site : libelle change', '                        Game-engine relief (normal map)\n', '                        Relief\n'],
  ['site/index2.js', 'site : lecture non stricte', "document.getElementById('ws-trellis2-normal-map')?.checked === true", "document.getElementById('ws-trellis2-normal-map')?.checked"],
  ['site/index2.js', 'site : option non envoyee', "    normal_map:   trellis2NormalMap,", "    // retire,"],
  ['renderer/lang/_additions6.js', 'bureau : traduction espagnole vide', '"Game-engine relief": ["Relief pour moteur de jeu", "Relieve para motor de juego",', '"Game-engine relief": ["Relief pour moteur de jeu", "",'],
  ['site/lang/_additions6.js', 'site : traduction chinoise differente (derive)', '"游戏引擎凹凸细节（法线贴图）"', '"游戏引擎凹凸细节（法线贴图!）"'],
  ['renderer/lang/_additions6.js', 'bureau : infobulle non traduite', '"Adds a normal map to the exported model: the fine relief of the detailed shape (skin, muscles, cloth folds) is baked into a texture of at most 2048px that game engines use for lighting. Off by default; adds a few MB to the file. The difference is subtle in a plain viewer.": [', '"Adds a normal map (x) to the exported model: the fine relief of the detailed shape (skin, muscles, cloth folds) is baked into a texture of at most 2048px that game engines use for lighting. Off by default; adds a few MB to the file. The difference is subtle in a plain viewer.": ['],
];

let detectes = 0;
MUTANTS.forEach(([rel, nom, ancien, nouveau]) => {
  const chemin = path.join(SORTIE, rel);
  const brut = readFileSync(chemin, 'utf8');
  const nl = brut.includes('\r\n') ? '\r\n' : '\n';
  const a = ancien.replace(/\n/g, nl), n = nouveau.replace(/\n/g, nl);
  const k = brut.split(a).length - 1;
  if (k !== 1) { console.log(`ANCRE (${k}) : ${nom}`); process.exit(2); }
  writeFileSync(chemin, brut.replace(a, n));
  const env = { ...process.env, RENDERER: path.join(SORTIE, 'renderer'), SITE: path.join(SORTIE, 'site') };
  const r = spawnSync(process.execPath, ['--test', 'tests/bureau-interface/option-normales-interface.test.mjs'], { cwd: RACINE, env, encoding: 'utf8' });
  writeFileSync(chemin, brut);
  if (r.status !== 0) { detectes++; console.log('detecte     : ' + nom); } else console.log('NON DETECTE : ' + nom);
});
console.log(`${MUTANTS.length} mutants, ${detectes} detectes`);
rmSync(SORTIE, { recursive: true, force: true });
process.exit(detectes === MUTANTS.length ? 0 : 1);
