// Fill holes, TROUS DE PEAU (2026-10-26) : la case « Also repair holes in the outer skin » (decochee par defaut, option a part) et la lueur bleu clair
// des trous detectes dans la fenetre. Module pur lib/trous-peau.js + cablage des deux pages, du processus principal du bureau et du shim du site.
// Lancer : node --test tests/bureau-interface/trous-peau.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COULEUR_PEAU, RETRAIT, HALO, filtrer, geometrie, diagonale } from '../../src/renderer/lib/trous-peau.js';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const lire = (rel) => fs.readFileSync(path.join(RACINE, rel), 'utf8');

const carre = (z = 0, cote = 1) => [[0, 0, z], [cote, 0, z], [cote, cote, z], [0, cote, z]];
const DETECT = {
  nombre: 3,
  trous: [
    { maillage: 0, n: 4, centre: [0.5, 0.5, 0], normale: [0, 0, 1], rayon: 0.7, points: carre() },
    { maillage: 0, n: 12, centre: [5, 5, 0], normale: [0, 1, 0], rayon: 1, points: Array.from({ length: 12 }, (_, i) => [5 + Math.cos(i), 5, Math.sin(i)]) },
    { maillage: 0, n: 40, centre: [9, 9, 9], normale: [1, 0, 0], rayon: 2, points: Array.from({ length: 40 }, (_, i) => [9, 9 + Math.cos(i), 9 + Math.sin(i)]) },
  ],
};

test('la couleur est un bleu clair', () => {
  assert.equal(COULEUR_PEAU, 0x7fd4ff);
  const [r, g, b] = [(COULEUR_PEAU >> 16) & 255, (COULEUR_PEAU >> 8) & 255, COULEUR_PEAU & 255];
  assert.ok(b > g && g > r && b >= 240, 'bleu clair : le canal bleu domine, le rouge est le plus faible');
});

test('filtrer : les curseurs Min / Max retiennent les trous par nombre d\'aretes du pourtour', () => {
  assert.equal(filtrer(DETECT, 3, 5000).length, 3);
  assert.equal(filtrer(DETECT, 5, 5000).length, 2);
  assert.equal(filtrer(DETECT, 3, 20).length, 2);
  assert.equal(filtrer(DETECT, 13, 39).length, 0);
  assert.equal(filtrer(null, 3, 100).length, 0);
  assert.equal(filtrer({ trous: [{ n: 5, points: [[0, 0, 0]] }] }, 3, 100).length, 0, 'un pourtour de moins de 3 points est ignore');
});

test('geometrie : contour, zone et halo en tableaux plats, zone en retrait SOUS la surface (le long de -normale)', () => {
  const g = geometrie(DETECT, 3, 5000, 10);
  assert.equal(g.nombre, 3);
  assert.equal(g.lignes.length, (4 + 12 + 40) * 6, 'un segment (6 nombres) par arete du pourtour');
  assert.equal(g.zone.length, (4 + 12 + 40) * 9, 'un triangle (9 nombres) par arete, en eventail depuis le centre');
  assert.equal(g.halo.length, g.zone.length);
  // le premier trou : normale +z, le retrait est donc en z negatif de RETRAIT * diagonale ; le contour, lui, reste sur la surface (z = 0)
  assert.equal(g.lignes[2], 0);
  assert.ok(Math.abs(g.zone[2] - (-RETRAIT * 10)) < 1e-6, 'centre de la zone sous la surface');
  assert.ok(Math.abs(g.zone[5] - (-RETRAIT * 10)) < 1e-6);
  assert.ok(HALO > 1, 'le halo est plus large que la zone');
  const hx = g.halo[3];                                  // premier sommet du halo : (0 - 0.5) * HALO + 0.5
  assert.ok(Math.abs(hx - (0.5 + (0 - 0.5) * HALO)) < 1e-6);
});

test('geometrie : aucun trou retenu -> tableaux vides ; normale absente -> pas de retrait', () => {
  const g = geometrie(DETECT, 100, 200, 1);
  assert.equal(g.nombre, 0);
  assert.equal(g.lignes.length + g.zone.length + g.halo.length, 0);
  const sans = geometrie({ trous: [{ n: 4, points: carre(), centre: [0.5, 0.5, 0] }] }, 3, 10, 5);
  assert.equal(sans.zone[2], 0);
});

test('diagonale : boite englobante d\'un tableau de positions', () => {
  assert.ok(Math.abs(diagonale(new Float32Array([0, 0, 0, 3, 4, 0])) - 5) < 1e-6);
  assert.equal(diagonale(new Float32Array([])), 1);
});

for (const [nom, rel] of [['bureau', 'src/renderer/index2.js'], ['site', 'cloud/public/app/index2.js']]) {
  test(`${nom} : la case est DECOCHEE par defaut, avec une aide, et le 3e parametre part vers l'operation`, () => {
    const src = lire(rel);
    assert.match(src, /import \{ geometrie as geometrieTrousPeau, diagonale as diagonaleTrousPeau, COULEUR_PEAU \} from '\.\/lib\/trous-peau\.js';/);
    assert.match(src, /\{ id: 'skin_repair', label: 'Also repair holes in the outer skin', type: 'checkbox', default: false,/);
    assert.match(src, /hint: 'For models whose hull is pierced without an open edge, like a boat\. Experimental: it can take a minute\. Check the result\.'/);
    assert.match(src, /build: \(vals\) => \[String\(vals\.min_hole_size\), String\(vals\.max_hole_size\), vals\.skin_repair \? '1' : '0'\],/);
  });

  test(`${nom} : la detection n'est lancee QUE quand la case est cochee, et ses resultats sont mis en cache par maillage`, () => {
    const src = lire(rel);
    assert.match(src, /if \(!vals\.skin_repair\) \{ if \(sk\.etat !== 'inactif'\) _mtSkinReinit\(\); mtState\.skinN = 0; return 0; \}/);
    assert.match(src, /if \(sk\.etat === 'inactif'\) _mtSkinChercher\(\);/);
    assert.match(src, /if \(sk\.detect && sk\.cle === chemin\) \{ sk\.etat = 'pret'; return; \}/);
    assert.match(src, /API\.detectSkinHoles\(\{ meshPath: chemin, min: 3, max: 5000/);
    assert.match(src, /_mtSkinReinit\(\);/, 'la fermeture de la fenetre annule la recherche');
  });

  test(`${nom} : la lueur est bleu clair, sans test de profondeur (visible a travers la coque), contour + zone + halo`, () => {
    const src = lire(rel);
    const i = src.indexOf('function _mtSkinDessiner');
    const corps = src.slice(i, src.indexOf('async function _mtSkinChercher'));
    assert.match(corps, /color: COULEUR_PEAU/);
    assert.equal((corps.match(/depthTest: false/g) || []).length, 2, 'zone et contour ne testent pas la profondeur');
    assert.match(corps, /new THREE\.LineSegments/);
    assert.match(corps, /tri\(g\.halo, /);
    assert.match(corps, /tri\(g\.zone, /);
    assert.match(corps, /renderOrder = ordre/);
  });

  test(`${nom} : compteur, progression et echec sont des textes traduits`, () => {
    const src = lire(rel);
    for (const t of ['Searching the outer skin for holes (about a minute)… {x} s', 'Outer skin: {x} holes detected (light blue). Apply will patch them; nothing is removed.',
      'Outer skin: no hole detected.', 'The search for skin holes failed. Apply can still try.']) {
      assert.ok(src.includes(t), t);
    }
  });
}

test('chaque texte neuf est traduit dans les 5 langues (vrai dictionnaire commun)', () => {
  const dict = lire('src/renderer/lang/_additions6.js');
  for (const cle of ['Also repair holes in the outer skin', 'For models whose hull is pierced without an open edge, like a boat. Experimental: it can take a minute. Check the result.',
    'Searching the outer skin for holes (about a minute)… {x} s', 'Outer skin: {x} holes detected (light blue). Apply will patch them; nothing is removed.',
    'Outer skin: no hole detected.', 'The search for skin holes failed. Apply can still try.', 'Repairing the outer skin runs on the server: use Apply.',
    'Double skin: filled {x} holes in the outer skin (+{y} faces); nothing was removed or moved.']) {
    const m = dict.match(new RegExp('"' + cle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '": (\\[.*\\]),'));
    assert.ok(m, 'pas de traduction pour : ' + cle);
    const t = JSON.parse(m[1]);
    assert.equal(t.length, 5, cle);
    assert.ok(t.every((x) => x && x !== cle), 'traductions vides ou identiques : ' + cle);
    if (cle.includes('{x}')) assert.ok(t.every((x) => x.includes('{x}')), 'le chiffre {x} doit rester : ' + cle);
  }
  // aucun nom de moteur dans les textes visibles
  assert.ok(!/trellis|unirig|puppeteer|skintokens|realvis|clipseg/i.test(dict.slice(dict.indexOf('Also repair holes in the outer skin'), dict.indexOf('Also repair holes in the outer skin') + 6000)));
});

test('les deux copies du module d\'apercu sont identiques (noyau partage)', () => {
  assert.equal(lire('src/renderer/lib/trous-peau.js'), lire('cloud/public/app/lib/trous-peau.js'));
});

test('bureau : processus principal, preload et mode Cloud', () => {
  const main = lire('src/main/main.js');
  assert.match(main, /ipcMain\.handle\('detect-skin-holes'/);
  assert.match(main, /'detect_skin', meshPath, sortie, String\(lo\), String\(hi\)/, 'mode local : mesh_tools.py detect_skin');
  assert.match(main, /params: \{ min_hole_size: lo, max_hole_size: hi, detect_only: true \}/, 'mode Cloud : detect_only, jamais debite');
  assert.match(main, /skin_repair: p\[2\] === '1' \}/, 'le 3e parametre part vers le serveur en mode Cloud');
  assert.match(lire('src/main/preload.js'), /detectSkinHoles: \(opts\) => ipcRenderer\.invoke\('detect-skin-holes', opts\)/);
  assert.match(lire('src/main/cloud_fallback.js'), /if \(j\.detect\) return \{ success: true, detect: j\.detect \};/);
});

test('site : le shim transmet skin_repair et expose detectSkinHoles (detect_only)', () => {
  const shim = lire('cloud/public/app/meshyAPI-cloud.js');
  assert.match(shim, /finalParams\.skin_repair = a\[2\] === '1' \|\| a\[2\] === true;/);
  assert.match(shim, /detectSkinHoles: async \(\{ meshPath, meshUrl, min = 3, max = 5000, projectName \} = \{\}\)/);
  assert.match(shim, /opType: 'fill_holes', projectName: projectName \|\| null,\s+params: \{ min_hole_size: [^}]*detect_only: true \}/);
});

test('le script bureau accepte le 5e argument sans casser l\'appel a 4 arguments', () => {
  const py = lire('scripts/mesh_tools.py');
  assert.match(py, /def fill_holes\(input_path, output_path, min_hole_size=3, max_hole_size=2000, skin_repair=0\):/);
  assert.match(py, /def detect_skin\(input_path, output_json, min_hole_size=3, max_hole_size=2000\):/);
  assert.match(py, /peau=reparer_peau/);
});
