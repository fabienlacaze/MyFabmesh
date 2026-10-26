// Bouchage de trous NON DESTRUCTIF (2026-10-21) : le jumeau JavaScript (src/renderer/lib/bouchage-trous.js = cloud/public/app/lib/bouchage-trous.js)
// doit donner EXACTEMENT les memes sorties que le noyau Python (scripts/bouchage_trous.py = modal_app/bouchage_trous.py) sur les cas gravés par
// build/bancs/noyaux/test_bouchage_trous.py --ecrire (build/bouchage_attendus.json) : memes pourtours, memes categories, memes modes, memes
// faces ajoutees (a l'indice pres), meme diagnostic, memes refus. Les apercus du bureau ET du site appellent ce module : ce qu'ils montrent
// est ce que le serveur ajoutera.
// Lancer : node --test tests/bureau-interface/bouchage-trous.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

async function charger(rel) {
  const dossier = mkdtempSync(join(tmpdir(), 'bouchage-'));
  try {
    const copie = join(dossier, 'lib.mjs');
    writeFileSync(copie, readFileSync(join(RACINE, rel), 'utf-8'));
    return await import(pathToFileURL(copie).href + '?' + Math.random());
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
}

const LIB = await charger('src/renderer/lib/bouchage-trous.js');
const LIB_SITE = await charger('cloud/public/app/lib/bouchage-trous.js');
const GRAVES = JSON.parse(readFileSync(join(RACINE, 'build/bouchage_attendus.json'), 'utf-8')).cas;

const proche = (a, b) => Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(b));

function sortie(lib, c) {
  const prep = lib.preparer(c.positions, c.indices);
  const a = lib.analyser(c.positions, c.indices, c.min, c.max, null, prep, c.budget);
  const d = lib.diagnostiquer(prep, a);
  const refus = a.faces_ajoutees === 0 ? lib.message_refus(a, d, c.min, c.max) : null;
  return { a, d, refus };
}

test('les deux exemplaires du jumeau JS (bureau et site) sont le meme fichier', () => {
  assert.equal(readFileSync(join(RACINE, 'src/renderer/lib/bouchage-trous.js'), 'utf-8').split('\r\n').join('\n'),
    readFileSync(join(RACINE, 'cloud/public/app/lib/bouchage-trous.js'), 'utf-8').split('\r\n').join('\n'));
});

test('au moins 15 cas graves, toutes les categories de pourtour presentes', () => {
  assert.ok(GRAVES.length >= 15, 'cas graves : ' + GRAVES.length);
  const categories = new Set(), modes = new Set(), causes = new Set();
  for (const c of GRAVES) {
    for (const b of c.attendu.boucles) { categories.add(b.categorie); if (b.mode) modes.add(b.mode); }
    causes.add(c.attendu.diagnostic.cause);
  }
  for (const k of ['a_boucher', 'trop_petite', 'degeneree', 'non_triangulable']) assert.ok(categories.has(k), k);
  for (const k of ['triangle', 'quad', 'optimal', 'oreilles']) assert.ok(modes.has(k), k);
  for (const k of ['aucune', 'retournees', 'non_manifold', 'miettes']) assert.ok(causes.has(k), k);
});

for (const c of GRAVES) {
  test('parite Python / JS : ' + c.nom, () => {
    const { a, d, refus } = sortie(LIB, c);
    const att = c.attendu;
    for (const k of ['sommets', 'faces', 'aretes_de_bord', 'aretes_non_manifold', 'chaines_ouvertes', 'a_boucher', 'trop_petites', 'trop_grandes',
      'degenerees', 'non_triangulables', 'plus_petite', 'plus_grande', 'faces_ajoutees', 'restantes', 'verdict', 'min_aretes', 'max_aretes', 'plafond']) {
      assert.equal(a[k], att[k], k);
    }
    assert.deepEqual(a.modes, att.modes);
    assert.ok(proche(a.tolerance, att.tolerance), 'tolerance ' + a.tolerance + ' / ' + att.tolerance);
    assert.ok(proche(a.arete_moyenne, att.arete_moyenne), 'arete moyenne');
    assert.deepEqual(a.boucles.map((b) => ({ n: b.n, categorie: b.categorie, mode: b.mode, debut: b.debut, triangles: b.triangles })), att.boucles);
    assert.deepEqual(a.ajout, att.ajout);
    assert.deepEqual(d, att.diagnostic);
    assert.deepEqual(refus, att.refus);
  });
}

test('le site charge le meme module : memes sorties sur tous les cas', () => {
  for (const c of GRAVES) assert.deepEqual(sortie(LIB_SITE, c).a.ajout, c.attendu.ajout, c.nom);
});

test('positions en Float32Array et indices en Uint32Array (le format de three.js) : memes sorties', () => {
  for (const c of GRAVES) {
    // les cas sont graves avec des positions deja arrondies a 32 bits : un GLB porte des flottants 32 bits, le serveur ET les apercus lisent donc les memes
    const p32 = Float32Array.from(c.positions), i32 = Uint32Array.from(c.indices);
    assert.deepEqual(Array.from(p32), c.positions, c.nom + ' : positions non representables en 32 bits');
    const a = LIB.analyser(p32, i32, c.min, c.max, null, null, c.budget);
    assert.deepEqual(a.ajout, c.attendu.ajout, c.nom);
    assert.equal(a.a_boucher, c.attendu.a_boucher, c.nom);
  }
});

test('le noyau ne modifie ni les positions ni les indices', () => {
  for (const c of GRAVES) {
    const p = Float64Array.from(c.positions), i = Uint32Array.from(c.indices);
    const p0 = Float64Array.from(p), i0 = Uint32Array.from(i);
    LIB.analyser(p, i, c.min, c.max);
    assert.deepEqual(p, p0, c.nom);
    assert.deepEqual(i, i0, c.nom);
  }
});

test('les rustines : aucun sommet nouveau, indices d origine, orientation inverse de la rive (aretes soudees jamais en double sens)', () => {
  for (const c of GRAVES) {
    // double peau (copie de sens inverse d'une face) : la face retrouvee double forcement le sens de sa copie — c'est le cas voulu, pas une rustine a l'envers
    if (c.nom === 'sphere_ailette_et_trou') continue;
    const prep = LIB.preparer(c.positions, c.indices);
    // la grille du banc est une nappe OUVERTE : son bord exterieur (80 aretes) serait « bouche » par une copie plate de la nappe, qui double ses
    // diagonales — artefact du cas, pas du noyau ; on le laisse de cote (max 79) comme le fait le test Python.
    const a = LIB.analyser(c.positions, c.indices, c.min, c.nom.startsWith('plan') ? 79 : c.max, null, prep);
    const n = c.positions.length / 3;
    for (const t of a.ajout) for (const v of t) assert.ok(Number.isInteger(v) && v >= 0 && v < n, c.nom);
    const F = Array.from(c.indices);
    const toutes = F.concat(a.ajout.flat());
    const g = prep.groupe;
    const vu = new Map();
    for (let f = 0; f < toutes.length; f += 3) {
      for (let k = 0; k < 3; k++) {
        const u = g[toutes[f + k]], v = g[toutes[f + (k + 1) % 3]];
        if (u === v) continue;
        const cle = u + ',' + v;
        vu.set(cle, (vu.get(cle) || 0) + 1);
      }
    }
    const avant = new Map();
    for (let f = 0; f < F.length; f += 3) {
      for (let k = 0; k < 3; k++) {
        const u = g[F[f + k]], v = g[F[f + (k + 1) % 3]];
        if (u === v) continue;
        const cle = u + ',' + v;
        avant.set(cle, (avant.get(cle) || 0) + 1);
      }
    }
    let doublesAvant = 0, doublesApres = 0;
    for (const x of avant.values()) if (x > 1) doublesAvant++;
    for (const x of vu.values()) if (x > 1) doublesApres++;
    assert.ok(doublesApres <= doublesAvant, c.nom + ' : une rustine double un sens de parcours (rustine a l envers)');
  }
});
