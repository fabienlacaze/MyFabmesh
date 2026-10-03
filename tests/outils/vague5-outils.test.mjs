// Tests vague 5 (2026-10-03) : mesure de couverture des traductions (P10) et
// crochet pre-commit (DEP-11). Aucun reseau ; faux depots sous le dossier temporaire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mesurerCible, libellesHtml, libellesJs, estTraduisible } from '../../build/couverture-traductions.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(RACINE, 'build', 'couverture-traductions.mjs');

function tmp(prefixe) { return fs.mkdtempSync(path.join(os.tmpdir(), prefixe)); }

test('extraction HTML : texte, attributs, entites ; script/style/code ignores', () => {
  const h = libellesHtml('<style>.a{}</style><button title="Save &amp; quit">&#9998; Edit</button><p>Hello</p><p>Hello</p>'
    + '<input placeholder="Your name"><script>var x = "Not me";</script><code>raw text</code><span>12s</span><span>https://x.y</span>');
  assert.deepEqual([...h.keys()].sort(), ['Hello', 'Save & quit', 'Your name', '✎ Edit'].sort());
  assert.equal(h.get('Hello'), 2);
});

test('extraction JS : t(), tf(), FabI18n.t() ; pas obj.t( ni gabarit dynamique', () => {
  const j = libellesJs("t('Open file'); FabI18n.t(\"Close it\"); tf('Done: {x}', 3); a.t('Nope'); t(`Tpl ${x}`); split('Zzz');");
  assert.deepEqual([...j.keys()].sort(), ['Close it', 'Done: {x}', 'Open file']);
  assert.equal(estTraduisible('18s'), false);
  assert.equal(estTraduisible('myFunction'), false);
});

test('pourcentages exacts sur un jeu de dictionnaires synthetique', () => {
  const d = tmp('couv-');
  fs.mkdirSync(path.join(d, 'lang'));
  fs.writeFileSync(path.join(d, 'p.html'), '<b>Alpha</b><b>&#9998; Beta</b><b>Gamma</b><b>Delta</b><i title="Eps">x</i>');
  fs.writeFileSync(path.join(d, 'p.js'), "t('Alpha'); t('Omega');");
  // Univers : Alpha, Beta, Gamma, Delta, Eps, Omega = 6 libelles ("x" sans interet : une lettre mais traduisible -> compte).
  fs.writeFileSync(path.join(d, 'lang', 'es.js'),
    "window.FabI18n.register('es', {'Alpha':'A','Beta':'B','Gamma':'G'});");
  fs.writeFileSync(path.join(d, 'lang', '_add.js'),
    "window.FabI18n.register('es', {'Delta':'D'}); window.FabI18n.register('fr', {'Alpha':'A','Eps':'E','Inutile':'I'});");
  const r = mesurerCible({ html: [path.join(d, 'p.html')], js: [path.join(d, 'p.js')], dossierLang: path.join(d, 'lang') });
  assert.equal(r.libelles, 7); // Alpha Beta Gamma Delta Eps x Omega
  assert.equal(r.langues.es.traduits, 4);
  assert.equal(r.langues.es.pourcent, 57.1);
  assert.equal(r.langues.fr.traduits, 2); // Alpha + Eps
  assert.equal(r.langues.fr.pourcent, 28.6);
  assert.deepEqual(r.languesAbsentes.sort(), ['ar', 'hi', 'zh']);
  assert.ok(r.nonTraduitsVisibles.es.every((x) => !['Alpha', '✎ Beta', 'Gamma', 'Delta'].includes(x.libelle)));
  fs.rmSync(d, { recursive: true, force: true });
});

test('CLI : --min donne le code 1 sous le seuil, 0 par defaut et au-dessus', () => {
  const d = tmp('couv-cli-');
  const b = path.join(d, 'src', 'renderer');
  fs.mkdirSync(path.join(b, 'lang'), { recursive: true });
  fs.mkdirSync(path.join(d, 'cloud', 'public', 'app', 'lang'), { recursive: true });
  for (const base of [b, path.join(d, 'cloud', 'public', 'app')]) {
    fs.writeFileSync(path.join(base, base === b ? 'index2.html' : 'index.html'), '<b>One</b><b>Two</b>');
    fs.writeFileSync(path.join(base, 'lang', 'es.js'), "window.FabI18n.register('es', {'One':'Uno'});");
  }
  const lancer = (...a) => spawnSync(process.execPath, [SCRIPT, '--racine', d, ...a], { encoding: 'utf8' });
  assert.equal(lancer().status, 0);
  assert.equal(lancer('--min', '50').status, 0);
  assert.equal(lancer('--min', '60').status, 1);
  const j = JSON.parse(lancer('--json').stdout);
  assert.equal(j.bureau.langues.es.pourcent, 50);
  assert.equal(j.web.langues.es.traduits, 1);
  fs.rmSync(d, { recursive: true, force: true });
});

// ---- Crochet pre-commit ----
function fauxDepot() {
  const d = tmp('hook-');
  const git = (...a) => spawnSync('git', a, { cwd: d, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 't@t.t'); git('config', 'user.name', 't');
  git('config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(d, 'build')); fs.mkdirSync(path.join(d, '.githooks'));
  fs.copyFileSync(path.join(RACINE, 'build', 'check-secrets.mjs'), path.join(d, 'build', 'check-secrets.mjs'));
  fs.copyFileSync(path.join(RACINE, '.githooks', 'pre-commit'), path.join(d, '.githooks', 'pre-commit'));
  git('config', 'core.hooksPath', '.githooks');
  return { d, git };
}

test('crochet : commit refuse avec un secret, accepte sans', () => {
  const { d, git } = fauxDepot();
  // Faux secret construit par morceaux (ne declenche pas la garde sur ce fichier).
  const faux = 'sk_' + 'live_' + 'A1b2C3d4E5f6G7h8I9j0K1l2';
  fs.writeFileSync(path.join(d, 'a.txt'), 'cle = ' + faux + '\n');
  git('add', '-A');
  const refuse = git('commit', '-q', '-m', 'avec secret');
  assert.notEqual(refuse.status, 0);
  assert.match(refuse.stderr, /COMMIT REFUSE/);
  assert.match(refuse.stderr, /--no-verify/);
  assert.equal(git('rev-list', '--all', '--count').stdout.trim(), '0');
  // Contournement exceptionnel documente.
  fs.writeFileSync(path.join(d, 'a.txt'), 'rien\n');
  git('add', '-A');
  const ok = git('commit', '-q', '-m', 'sans secret');
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(git('rev-list', '--all', '--count').stdout.trim(), '1');
  fs.rmSync(d, { recursive: true, force: true });
});

test('crochet : s ouvre en echec si la garde est absente', () => {
  const { d, git } = fauxDepot();
  fs.rmSync(path.join(d, 'build', 'check-secrets.mjs'));
  fs.writeFileSync(path.join(d, 'b.txt'), 'x\n');
  git('add', '-A');
  const r = git('commit', '-q', '-m', 'x');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /introuvable/);
  fs.rmSync(d, { recursive: true, force: true });
});
