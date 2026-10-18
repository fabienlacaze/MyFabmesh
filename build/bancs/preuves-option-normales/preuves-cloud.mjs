// PREUVES D'ECHEC du test du worker et du site (cloud/tests/option-normales.test.mjs) : chaque MUTANT de cloud/src/worker.ts ou de
// cloud/public/app doit le faire echouer. Rien n'est ecrit dans le depot : copies dans le dossier temporaire.
//   node build/bancs/preuves-option-normales/preuves-cloud.mjs            (code de sortie 0 = tous les mutants sont detectes)
// Preuve complementaire sur le code d'AVANT l'option :
//   git show 3886f61a:cloud/src/worker.ts > <fichier> ; git archive 3886f61a cloud/public/app | tar -x -C <dossier>
//   cd cloud && WORKER_SRC=<fichier> SITE_RACINE=<dossier>/cloud/public/app node --test tests/option-normales.test.mjs   (12 echecs sur 16 attendus)
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, cpSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SORTIE = mkdtempSync(path.join(tmpdir(), 'preuves-cloud-'));
mkdirSync(SORTIE, { recursive: true });
cpSync(path.join(RACINE, 'cloud', 'public', 'app'), path.join(SORTIE, 'app'), { recursive: true });
const WORKER = readFileSync(path.join(RACINE, 'cloud', 'src', 'worker.ts'), 'utf8');

const MUTANTS = [
  // ----- worker -----
  ['worker', 'lecture non stricte du formulaire', "normal_map: form.get('normal_map') === 'true',", "normal_map: !!form.get('normal_map'),"],
  ['worker', 'option jamais transmise a Modal (handleGenerate)', "        normal_map: input.normal_map === true,\n        // Transmis pour information", "        // Transmis pour information"],
  ['worker', 'valeur brute transmise a Modal (callModalMeshStart)', "normal_map: input.normal_map === true,\n    }),\n    // mesh-start returns instantly", "normal_map: input.normal_map as boolean,\n    }),\n    // mesh-start returns instantly"],
  ['worker', 'option non enregistree dans la ligne jobs', "        normal_map: input.normal_map === true,\n        // preset de qualite", "        // preset de qualite"],
  ['worker', 'option declaree sans effet cote cloud', "const OPTIONS_SANS_EFFET_CLOUD = ['refine', 'face_fix'] as const;", "const OPTIONS_SANS_EFFET_CLOUD = ['refine', 'face_fix', 'normal_map'] as const;"],
  ['worker', 'option facturee', "  if (i.smooth)       n += p.mesh_smooth       ?? 1;\n", "  if (i.smooth)       n += p.mesh_smooth       ?? 1;\n  if ((i as unknown as Record<string, unknown>).normal_map) n += 1;\n"],
  ['worker', 'option toujours vraie', "normal_map: form.get('normal_map') === 'true',", "normal_map: true,"],
  // ----- site -----
  ['app/index.html', 'case cochee par defaut', '<input type="checkbox" id="ws-trellis2-normal-map" />', '<input type="checkbox" id="ws-trellis2-normal-map" checked />'],
  ['app/index.html', 'case retiree de la page', '<input type="checkbox" id="ws-trellis2-normal-map" />', '<input type="checkbox" id="ws-trellis2-normal-map-x" />'],
  ['app/index2.js', 'lecture non stricte de la case', "document.getElementById('ws-trellis2-normal-map')?.checked === true", "document.getElementById('ws-trellis2-normal-map')?.checked || false"],
  ['app/index2.js', 'option non envoyee au serveur', "    normal_map:   trellis2NormalMap,", "    // normal_map retire,"],
  ['app/index2.js', 'case forcee par le profil d asset', "const ASSET_OPTIONS_PROFILE = {\n  character: {\n", "const ASSET_OPTIONS_PROFILE = {\n  character: {\n    'ws-trellis2-normal-map': null,\n"],
  ['app/cloud-overrides.js', 'case declaree morte', "window.__optionsMortesCloud = new Set(['ws-trellis2-refine', 'ws-trellis2-face-fix']);", "window.__optionsMortesCloud = new Set(['ws-trellis2-refine', 'ws-trellis2-face-fix', 'ws-trellis2-normal-map']);"],
  ['app/lang/_additions6.js', 'traduction arabe vide', '"Game-engine relief": ["Relief pour moteur de jeu", "Relieve para motor de juego", "游戏引擎凹凸细节", "गेम इंजन के लिए सतही उभार", "نقش بارز لمحركات الألعاب"],', '"Game-engine relief": ["Relief pour moteur de jeu", "Relieve para motor de juego", "游戏引擎凹凸细节", "गेम इंजन के लिए सतही उभार", ""],'],
  ['app/lang/_additions6.js', 'libelle court non traduit', '"Game-engine relief": ["Relief pour moteur de jeu", "Relieve para motor de juego", "游戏引擎凹凸细节", "गेम इंजन के लिए सतही उभार", "نقش بارز لمحركات الألعاب"],', ''],
  ['app/meshyAPI-cloud.js', 'le shim ignore normal_map', "if (k === 'image' || k === 'imagePath') continue;", "if (k === 'image' || k === 'imagePath' || k === 'normal_map') continue;"],
];

let detectes = 0;
MUTANTS.forEach(([cible, nom, ancien, nouveau], i) => {
  const env = { ...process.env };
  let restaurer = () => {};
  if (cible === 'worker') {
    const nl = WORKER.includes('\r\n') ? '\r\n' : '\n';
    const a = ancien.replace(/\n/g, nl), n = nouveau.replace(/\n/g, nl);
    const k = WORKER.split(a).length - 1;
    if (k !== 1) { console.log(`ANCRE (${k}) : ${nom}`); process.exit(2); }
    const chemin = path.join(SORTIE, `worker_${i}.ts`);
    writeFileSync(chemin, WORKER.replace(a, n));
    env.WORKER_SRC = chemin;
  } else {
    const chemin = path.join(SORTIE, cible);
    const brut = readFileSync(chemin, 'utf8');
    const nl = brut.includes('\r\n') ? '\r\n' : '\n';
    const a = ancien.replace(/\n/g, nl), n = nouveau.replace(/\n/g, nl);
    const k = brut.split(a).length - 1;
    if (k !== 1) { console.log(`ANCRE (${k}) : ${nom}`); process.exit(2); }
    writeFileSync(chemin, brut.replace(a, n));
    env.SITE_RACINE = path.join(SORTIE, 'app');
    restaurer = () => writeFileSync(chemin, brut);
  }
  const r = spawnSync(process.execPath, ['--test', 'tests/option-normales.test.mjs'], { cwd: path.join(RACINE, 'cloud'), env, encoding: 'utf8' });
  restaurer();
  if (r.status !== 0) { detectes++; console.log('detecte     : ' + nom); } else console.log('NON DETECTE : ' + nom);
});
console.log(`${MUTANTS.length} mutants, ${detectes} detectes`);
process.exit(detectes === MUTANTS.length ? 0 : 1);
