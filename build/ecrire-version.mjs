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
// Journal groupe par version : chaque commit porte le numero de version (package.json) en vigueur A CE MOMENT.
const journal = (() => {
  try {
    const git = (args) => execFileSync('git', args, { cwd: racine, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
    const lignes = git(['log', '-400', '--pretty=format:%H|%cs|%s']).split(/\r?\n/).filter(Boolean);
    const commits = lignes.map((l) => { const i = l.indexOf('|'), k = l.indexOf('|', i + 1); return { h: l.slice(0, i), d: l.slice(i + 1, k), t: l.slice(k + 1).slice(0, 220) }; });
    const versionA = (h) => { try { return JSON.parse(git(['show', h + ':package.json'])).version; } catch (_) { return null; } };
    // les commits qui ont change package.json : la version y est relue ; les autres heritent du plus ancien voisin
    const changes = new Set(git(['log', '-400', '--pretty=format:%H', '-G"version"', '--', 'package.json']).split(/\r?\n/).filter(Boolean));
    let courante = versionA(commits[commits.length - 1].h) || version;
    for (let i = commits.length - 1; i >= 0; i--) {
      if (changes.has(commits[i].h)) courante = versionA(commits[i].h) || courante;
      commits[i].v = courante;
    }
    commits[0].v = version;    // le plus recent : version actuelle du fichier de travail
    return commits.map((c) => ({ d: c.d, t: c.t, v: c.v }));
  } catch (_) { return []; }
})();
const info = { version, build: commits + (sale ? 1 : 0), hash: sh('git rev-parse --short HEAD'), sale, date: new Date().toISOString().slice(0, 16).replace('T', ' '), journal };
const contenu = `window.__BUILD__ = ${JSON.stringify(info)};\n`;
for (const f of ['src/renderer/build-info.js', 'cloud/public/app/build-info.js']) {
  let avant = ''; try { avant = readFileSync(join(racine, f), 'utf8'); } catch (_) { /* premiere fois */ }
  if (avant !== contenu) writeFileSync(join(racine, f), contenu);
}
console.log(`[version] v${info.version} build ${info.build}${sale ? ' (modifs non commitees)' : ''} ${info.hash}`);
