// Numero de version affiche en bas a droite de l'appli (2026-09-29, user : « la version du logiciel, incrementee a chaque
// modif »). Version = package.json ; build = nombre de commits (+1 s'il y a des modifs non commitees) : il monte tout seul
// a chaque modification. Ecrit build-info.js pour le bureau ET le web. Lance par le prebuild web et les scripts start / dev.
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');
const sh = (c) => { try { return execSync(c, { cwd: racine, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (_) { return ''; } };
const version = JSON.parse(readFileSync(join(racine, 'package.json'), 'utf8')).version;
const commits = parseInt(sh('git rev-list --count HEAD'), 10) || 0;
const sale = !!sh('git status --porcelain -- src cloud/public cloud/src modal_app scripts docs');
const journal = (() => { try { return execFileSync('git', ['log', '-25', '--pretty=format:%cs|%s'], { cwd: racine, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch (_) { return ''; } })().split(/\r?\n/).filter(Boolean).map((l) => { const i = l.indexOf('|'); return { d: l.slice(0, i), t: l.slice(i + 1).slice(0, 220) }; });
const info = { version, build: commits + (sale ? 1 : 0), hash: sh('git rev-parse --short HEAD'), sale, date: new Date().toISOString().slice(0, 16).replace('T', ' '), journal };
const contenu = `window.__BUILD__ = ${JSON.stringify(info)};\n`;
for (const f of ['src/renderer/build-info.js', 'cloud/public/app/build-info.js']) {
  let avant = ''; try { avant = readFileSync(join(racine, f), 'utf8'); } catch (_) { /* premiere fois */ }
  if (avant !== contenu) writeFileSync(join(racine, f), contenu);
}
console.log(`[version] v${info.version} build ${info.build}${sale ? ' (modifs non commitees)' : ''} ${info.hash}`);
