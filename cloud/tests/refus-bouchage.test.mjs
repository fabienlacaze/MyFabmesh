// Fill holes non destructif (2026-10-21) : les refus EXPLIQUES (« rien a boucher », « aucun trou dans cette plage »...) viennent du noyau Python
// (scripts/bouchage_trous.py::message_refus), passent par Modal (HTTP 422, le worker rembourse), et doivent etre :
//   1. reconnus par le MEME code par le worker (REFUS_CONNUS) et par l'interface (lib/textes-serveur.js, bureau ET web) ;
//   2. affiches dans les 5 langues avec les VRAIS dictionnaires, chiffres conserves (aucun « Nothing to fill » anglais ne subsiste) ;
//   3. montres tels quels par les DEUX index2.js (sans le prefixe « fill_holes failed: » qui empecherait la traduction).
// Les messages sont ceux que le Python a GRAVES dans build/bouchage_attendus.json (cas du test de parite) : pas de texte recopie a la main.
// Lancer : cd cloud && node --test tests/refus-bouchage.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chargerFonctions, lireSource } from './_charge-worker.mjs';
import { creerPage } from './_dom-minimal.mjs';

const require = createRequire(import.meta.url);
const acorn = require('acorn');
const RACINE = process.env.RACINE_DEPOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const lire = (rel) => fs.readFileSync(path.join(RACINE, rel), 'utf8');
const LANGUES = ['fr', 'es', 'zh', 'hi', 'ar'];

// les refus graves par le Python (un par code) + le seul que les cas de parite ne produisent pas (contour impossible a remplir)
const GRAVES = JSON.parse(lire('build/bouchage_attendus.json')).cas.filter((c) => c.attendu.refus).map((c) => c.attendu.refus);
const INSOLUBLE = ['fill_holes_unfillable', 'Could not fill the 2 open hole(s): their outline is too complex or folds over itself. The mesh was left unchanged.'];
const REFUS = GRAVES.concat([INSOLUBLE]);
const CODES = ['fill_holes_closed', 'fill_holes_closed_debris', 'fill_holes_closed_flipped', 'fill_holes_closed_nonmanifold', 'fill_holes_range', 'fill_holes_unfillable'];

test('les cas graves couvrent les six codes de refus du noyau', () => {
  assert.deepEqual([...new Set(REFUS.map((r) => r[0]))].sort(), CODES);
});

function worker() { return chargerFonctions(['REFUS_CONNUS', 'codeRefus']); }
function client(rel) {
  const p = creerPage();
  p.executer(lire(rel), rel);
  return p.fenetre.FabMessages;
}
function pageReelle(cible, lang) {
  const base = cible === 'web' ? 'cloud/public/app' : 'src/renderer';
  const p = creerPage({ html: '<div id="zone"></div>', stockage: { 'fabmesh.lang.choisi': lang } });
  p.executer(lire(base + '/i18n.js'), 'i18n.js');
  const html = lire(cible === 'web' ? 'cloud/public/app/index.html' : 'src/renderer/index2.html');
  for (const m of html.matchAll(/<script src="(lang\/[^"]+|lib\/textes-serveur\.js)"><\/script>/g)) p.executer(lire(base + '/' + m[1]), m[1]);
  p.charger();
  return p;
}

test('le worker donne au refus le code que le noyau Python lui a donne (avec ou sans le suffixe de remboursement)', () => {
  const w = worker();
  for (const [code, texte] of REFUS) {
    assert.equal(w.codeRefus(texte).code, code, texte);
    assert.equal(w.codeRefus(texte + ' (credits refunded)').code, code, texte + ' (credits refunded)');
  }
});

test('le worker liste ces familles (la source de worker.ts les contient)', () => {
  const src = lireSource();
  for (const c of CODES) assert.ok(src.includes("'" + c + "'"), c);
});

test('client (bureau ET web) : memes codes et memes parametres que le worker', () => {
  const w = worker();
  for (const rel of ['src/renderer/lib/textes-serveur.js', 'cloud/public/app/lib/textes-serveur.js']) {
    const fm = client(rel);
    for (const [, texte] of REFUS) {
      const a = w.codeRefus(texte), b = fm.reconnaitre(texte);
      assert.equal(b && b.code, a && a.code, rel + ' : ' + texte);
      assert.equal(JSON.stringify(b && b.params ? b.params : null), JSON.stringify(a && a.params ? a.params : null), rel + ' (parametres) : ' + texte);
    }
  }
});

for (const cible of ['web', 'bureau']) {
  test(`${cible} : chaque refus de Fill holes s'affiche dans les 5 langues, chiffres conserves, rien d'anglais`, () => {
    for (const L of LANGUES) {
      const fm = pageReelle(cible, L).fenetre.FabMessages;
      for (const [code, texte] of REFUS) {
        for (const suffixe of ['', ' (credits refunded)']) {
          const v = fm.traduire(texte + suffixe);
          assert.notEqual(v, texte + suffixe, `${L} ${code} : non traduit`);
          assert.ok(!/Nothing to fill|No hole between|Could not fill|nothing was charged|unchanged/i.test(v), `${L} ${code} : reste de l'anglais : ${v}`);
          // les chiffres PORTES par le code (bornes de la plage, nombre de faces...) restent affiches ; le detail de l'anglais (plus petit / plus grand) non
          for (const n of Object.values(fm.reconnaitre(texte).params || {})) assert.ok(v.includes(String(n)), `${L} ${code} : le chiffre ${n} a disparu : ${v}`);
        }
      }
    }
    const fr = pageReelle(cible, 'fr').fenetre.FabMessages;
    assert.match(fr.traduire(REFUS.find((r) => r[0] === 'fill_holes_closed_flipped')[1]), /^Rien à boucher : le maillage n'a aucun trou ouvert, mais \d+ faces/);
    assert.match(fr.traduire(REFUS.find((r) => r[0] === 'fill_holes_range')[1]), /^Aucun trou entre 40 et 60 arêtes\./);
    // anglais : rien ne change
    const en = pageReelle(cible, 'en').fenetre.FabMessages;
    for (const [, texte] of REFUS) assert.equal(en.traduire(texte), texte);
  });
}

/** Fonctions de premier niveau d'un fichier, par nom (analyse acorn). */
function extraire(rel, noms) {
  const src = lire(rel);
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
  const out = [];
  for (const n of ast.body) if (n.type === 'FunctionDeclaration' && noms.includes(n.id.name)) out.push(src.slice(n.start, n.end));
  assert.equal(out.length, noms.length, rel + ' : fonctions introuvables (' + noms.join(', ') + ')');
  return out.join('\n');
}

for (const [cible, rel] of [['web', 'cloud/public/app/index2.js'], ['bureau', 'src/renderer/index2.js']]) {
  test(`${cible} : le VRAI _refusBouchage reconnait un refus (meme enrobe par « Error: » ou le remboursement) et laisse passer les autres erreurs`, () => {
    const p = creerPage();
    p.executer(extraire(rel, ['_refusBouchage']) + '\nwindow.__r = _refusBouchage;', 'extrait.js');
    for (const [, texte] of REFUS) {
      assert.equal(p.fenetre.__r(texte), texte);
      assert.equal(p.fenetre.__r('Error: ' + texte + ' (credits refunded)'), texte + ' (credits refunded)');
    }
    for (const autre of ['mesh fill_holes failed (credits refunded)', 'insufficient credits', 'unknown', '', null, undefined, 'Cloud session expired']) {
      assert.equal(p.fenetre.__r(autre), null, String(autre));
    }
  });
  test(`${cible} : runMeshTool montre le refus tel quel (avertissement, sans « fill_holes failed: »)`, () => {
    const src = lire(rel);
    const i = src.indexOf('async function runMeshTool(');
    const corps = src.slice(i, src.indexOf('\n}\n', i));
    assert.match(corps, /const refus = _refusBouchage\(msg\);/);
    assert.match(corps, /if \(refus\) showToast\(refus, 'warning'/);
  });
}

test('le bureau local : main.js remonte la phrase du refus (ligne « [mesh_tools] REFUS: ») au lieu de « Command failed »', () => {
  const src = lire('src/main/main.js');
  assert.match(src, /\\\[mesh_tools\\\] REFUS: \(\[\^\\r\\n\]\+\)/);
  assert.match(src, /resolve\(\{ success: false, error: _refus\[1\]\.trim\(\), refus: true \}\)/);
  // mode Cloud du bureau : les curseurs Min / Max sont TRANSMIS (avant : « sliders min/max ignorés par Modal »)
  assert.match(src, /case 'fill_holes':\s+opParams = \{ min_hole_size:/);
  assert.ok(!/sliders min\/max ignorés/.test(src));
});
