// PARITE DES VUES entre le worker (TypeScript) et le module Python de Modal (cinquieme relecture, 20/10/2026) : plus fine que la parite des verdicts. Pour des textes du
// fuzz (tous les modes, politique comprise), les lectures (`nets`) et TOUTES les vues de chaque lecture doivent etre IDENTIQUES dans les deux implementations ; si elles
// le sont et que les listes le sont (gen_module.py), les verdicts le sont aussi, y compris sur les chemins rares que les tests de verdict ne visitent pas.
// Usage : node build/bancs/moderation/parite_vues.mjs [--n 20000] [--graine 1] [--modes plancher,epeles,...] [--montrer 20]
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { versions, arg, montrer, RACINE } from './lib_bancs.mjs';
import { creerGenerateur } from './fuzz.mjs';

const N = Number(arg('--n', 20000));
const GRAINE = Number(arg('--graine', 1));
const MODES = arg('--modes', 'plancher,general,epeles,ages,courts,courts-epeles,ages-epeles,idiomes,expressions,mixte').split(',');
const CHAMPS = ['chiffres', 'leetI', 'leetL', 'collees', 'series', 'nonEcrasees', 'separees', 'exactes', 'exactesSouples', 'unicode'];

const V = versions({ listes: true, sansAvant: true });
const textes = [];
MODES.forEach((mode, i) => {
  const fabriquer = creerGenerateur({ V }, GRAINE * 100 + i, mode);
  for (let k = 0; k < Math.floor(N / MODES.length); k++) textes.push(fabriquer(mode));
});

const dossier = mkdtempSync(join(tmpdir(), 'parite_vues_'));
const script = ['import importlib.util, json, sys', 'spec = importlib.util.spec_from_file_location("m", sys.argv[1])', 'm = importlib.util.module_from_spec(spec)',
  'spec.loader.exec_module(m)', 'textes = json.load(open(sys.argv[2], encoding="utf-8"))', 'sortie = []', 'for t in textes:', '    nets, vues = m._lire(t)',
  '    sortie.append({"nets": nets, "vues": vues})', 'json.dump(sortie, open(sys.argv[3], "w", encoding="utf-8"))'].join('\n');
writeFileSync(join(dossier, 'lire.py'), script);
writeFileSync(join(dossier, 'textes.json'), JSON.stringify(textes));
execFileSync('python', ['-I', '-X', 'utf8', join(dossier, 'lire.py'), join(RACINE, 'modal_app', '_moderation_texte.py'), join(dossier, 'textes.json'), join(dossier, 'py.json')],
  { env: { ...process.env, PYTHONUTF8: '1' }, maxBuffer: 1 << 28 });
const py = JSON.parse((await import('node:fs')).readFileSync(join(dossier, 'py.json'), 'utf8'));

let ecarts = 0;
const exemples = [];
textes.forEach((t, i) => {
  const ts = V.APRES._lire(t);
  const p = py[i];
  const diff = [];
  if (JSON.stringify(ts.nets) !== JSON.stringify(p.nets)) diff.push('nets');
  else ts.vues.forEach((v, k) => { for (const c of CHAMPS) if (JSON.stringify(v[c]) !== JSON.stringify(p.vues[k][c])) diff.push(`${c}[${k}]`); });
  if (diff.length) { ecarts++; if (exemples.length < Number(arg('--montrer', 20))) exemples.push(`${diff.slice(0, 4).join(',')} | ${montrer(t).slice(0, 140)}`); }
});
console.log(`parite des vues TypeScript / Python : ${textes.length} textes (${MODES.join(', ')}), ${ecarts} ecart(s)`);
for (const e of exemples) console.log('  ' + e);
process.exit(ecarts ? 1 : 0);
