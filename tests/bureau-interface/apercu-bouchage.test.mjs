// Apercus de Fill holes (2026-10-21) : les VRAIES fonctions des deux index2.js (bureau : _jsHoleFillPreview + _mtBuildFillOverlays ; site : _jsFillHoles +
// previewStatus du schema), extraites par leur nom et executees avec le VRAI three.js (BufferGeometry), le VRAI noyau lib/bouchage-trous.js et le VRAI
// FabMessages. Aucune page, aucun reseau. Elles prouvent que l'apercu :
//   - consomme le MEME noyau que l'operation (memes faces ajoutees que le noyau Python grave dans build/bouchage_attendus.json) ;
//   - sur le site, rend la geometrie ORIGINALE + les faces ajoutees (rien de retire : les indices d'origine sont un prefixe), sans toucher aux positions ;
//   - dit la VERITE quand il n'y a rien a boucher (hors plage, maillage ferme + diagnostic) au lieu d'affirmer « normales inversees » sans preuve ;
//   - ne rend pas de geometrie pour un maillage ferme (le bouton « Apply on device » du site reste desactive).
// Lancer : node --test tests/bureau-interface/apercu-bouchage.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as acorn from 'acorn';
import * as THREE from 'three';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dossier = mkdtempSync(join(tmpdir(), 'apercu-bouchage-'));
let LIB;
try {
  const copie = join(dossier, 'bouchage-trous.mjs');
  writeFileSync(copie, readFileSync(join(RACINE, 'src/renderer/lib/bouchage-trous.js'), 'utf-8'));
  LIB = await import(pathToFileURL(copie).href);
} finally {
  rmSync(dossier, { recursive: true, force: true });
}
const GRAVES = JSON.parse(readFileSync(join(RACINE, 'build/bouchage_attendus.json'), 'utf-8')).cas;
const cas = (nom) => GRAVES.find((c) => c.nom === nom);

/** Texte source de declarations de premier niveau (function) et d'une fonction-valeur d'un objet, par nom. */
function sources(chemin, noms) {
  const src = readFileSync(join(RACINE, chemin), 'utf-8');
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
  const morceaux = [];
  for (const n of ast.body) if (n.type === 'FunctionDeclaration' && noms.includes(n.id.name)) morceaux.push(src.slice(n.start, n.end));
  assert.equal(morceaux.length, noms.length, chemin + ' : fonctions introuvables parmi ' + noms.join(', '));
  return { src, ast, texte: morceaux.join('\n') };
}

/** La methode `previewStatus` de MESH_TOOL_SCHEMAS.fill_holes (site) : texte de la propriete. */
function previewStatusDuSite() {
  const { src, ast } = sources('cloud/public/app/index2.js', ['_positionsPlates']);
  let trouve = null;
  const parcourir = (n) => {
    if (!n || typeof n.type !== 'string' || trouve) return;
    if (n.type === 'Property' && n.key && n.key.name === 'fill_holes' && n.value.type === 'ObjectExpression') {
      for (const p of n.value.properties) if (p.key && p.key.name === 'previewStatus') trouve = src.slice(p.value.start, p.value.end);
    }
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v)) v.forEach(parcourir); else if (v && typeof v.type === 'string') parcourir(v);
    }
  };
  parcourir(ast);
  assert.ok(trouve, 'previewStatus de fill_holes introuvable');
  return trouve;
}

const traduit = [];
const FabMessages = { traduire: (t) => { traduit.push(t); return 'TRADUIT:' + t; } };
const i18nT = (s) => s;
const i18nTf = (s, ...a) => { let k = 0; return String(s).replace(/\{[xy]\}/g, () => String(a[k++])); };

function geometrie(c) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(c.positions, 3));
  g.setIndex(c.indices);
  return g;
}

// ------------------------------------------------------------------------------------------------------------------------------------------
// BUREAU
// ------------------------------------------------------------------------------------------------------------------------------------------
{
  const { texte } = sources('src/renderer/index2.js', ['_positionsPlates', '_jsHoleFillPreview', '_mtBuildFillOverlays']);
  const mtState = { overlays: [], origGeoms: [] };
  const f = new THREE.BufferGeometry();   // pour que `new Function` voie THREE
  void f;
  const construire = new Function('THREE', 'preparerTrous', 'analyserTrous', 'diagnostiquerTrous', 'agregerTrous', 'messageRefusTrous', 'renduApercuTrous', 'mtState',
    '_mtClearOverlays', texte + '\nreturn { _jsHoleFillPreview, _mtBuildFillOverlays, _positionsPlates };');
  const P = construire(THREE, LIB.preparer, LIB.analyser, LIB.diagnostiquer, LIB.agreger, LIB.message_refus, LIB.rendu_apercu, mtState, () => { mtState.overlays = []; });

  test('bureau : l apercu consomme le noyau — memes faces ajoutees, rustines vertes en 9 nombres par triangle, traits par couleur', () => {
    const c = cas('sphere_trois_trous_plage');
    const r = P._jsHoleFillPreview(geometrie(c), c.min, c.max);
    assert.equal(r.analyse.faces_ajoutees, c.attendu.faces_ajoutees);
    assert.deepEqual(r.analyse.ajout, c.attendu.ajout);
    assert.equal(r.greenFaces.length, 9 * c.attendu.faces_ajoutees);
    assert.equal(r.stats.filled, 2);
    assert.equal(r.stats.tooSmall, 1);
    assert.equal(r.stats.faces, c.attendu.faces_ajoutees);
    assert.equal(r.green.length, 6 * (12 + 8));          // 2 segments x 3 nombres par arete des deux pourtours verts
    assert.equal(r.grey.length, 6 * 3);                    // le trou de 3 aretes est « trop petit » (min 5)
    assert.equal(r.red.length, 0);
  });

  test('bureau : les boucles degenerees (T-jonction) ne sont pas dessinees et ne comptent pour aucun trou', () => {
    const c = cas('sphere_t_jonction');
    const r = P._jsHoleFillPreview(geometrie(c), 3, 2000);
    assert.equal(r.stats.flat, 1);
    assert.equal(r.stats.loops, 0);
    assert.equal(r.green.length + r.grey.length + r.red.length, 0);
    assert.equal(r.greenFaces.length, 0);
  });

  test('bureau : geometrie non indexee (soupe de triangles) acceptee — meme resultat que l indexee', () => {
    const c = cas('sphere_trou_moyen');
    const indexee = geometrie(c);
    const soupe = indexee.toNonIndexed();
    const a = P._jsHoleFillPreview(indexee, 3, 2000), b = P._jsHoleFillPreview(soupe, 3, 2000);
    assert.equal(b.stats.indexed, false);
    assert.equal(b.stats.filled, a.stats.filled);
    assert.equal(b.stats.faces, a.stats.faces);
  });

  test('bureau : positions entrelacees ou normalisees lues correctement (copie en Float32Array)', () => {
    const c = cas('sphere_trou_3');
    const g = geometrie(c);
    const buf = new THREE.InterleavedBuffer(Float32Array.from(c.positions.flatMap((x, i) => (i % 3 === 2 ? [x, 0] : [x]))), 4);
    g.setAttribute('position', new THREE.InterleavedBufferAttribute(buf, 3, 0));
    const r = P._jsHoleFillPreview(g, 3, 2000);
    assert.equal(r.stats.filled, 1);
    assert.equal(r.stats.faces, 1);
  });

  test('bureau : _mtBuildFillOverlays dit POURQUOI il n y a rien a boucher (hors plage, maillage ferme + diagnostic) et ajoute les surcouches vertes sinon', () => {
    const avec = (nom, min, max) => {
      const c = cas(nom);
      const racine = new THREE.Group();
      const mesh = new THREE.Mesh(geometrie(c), new THREE.MeshBasicMaterial());
      racine.add(mesh);
      mtState.overlays = [];
      mtState.origGeoms = [{ mesh, originalGeom: mesh.geometry }];
      return { st: P._mtBuildFillOverlays({ min_hole_size: min, max_hole_size: max }), mesh };
    };
    let { st, mesh } = avec('sphere_trou_moyen', 3, 2000);
    assert.equal(st.filled, 1);
    assert.equal(st.faces, 7);
    assert.equal(st.refus, null);
    assert.ok(mtState.overlays.length >= 2, 'surface verte + traits');
    assert.ok(mesh.children.length >= 2);
    ({ st } = avec('sphere_hors_plage', 40, 60));
    assert.equal(st.faces, 0);
    assert.equal(st.refus.code, 'fill_holes_range');
    assert.match(st.refus.texte, /^No hole between 40 and 60 edges/);
    ({ st } = avec('sphere_faces_retournees', 3, 2000));
    assert.equal(st.refus.code, 'fill_holes_closed_flipped');
    assert.match(st.refus.texte, /4 faces point the wrong way/);
    ({ st } = avec('sphere_fermee', 3, 2000));
    assert.equal(st.refus.code, 'fill_holes_closed');
    ({ st } = avec('sphere_t_jonction', 3, 2000));
    assert.equal(st.refus.code, 'fill_holes_closed');
    assert.equal(st.flat, 1);
    ({ st } = avec('sphere_miettes', 3, 2000));
    assert.equal(st.refus.code, 'fill_holes_closed_debris');
  });

  test('bureau : l ancien message sans preuve (« taches noires = normales inversees ») a disparu de la source', () => {
    const src = readFileSync(join(RACINE, 'src/renderer/index2.js'), 'utf-8');
    assert.ok(!src.includes('No open boundary: the black speckles are reversed-normal faces'));
    assert.ok(!src.includes('boundary-loop hole finder'.toUpperCase()));
    assert.match(src, /from '\.\/lib\/bouchage-trous\.js'/);
  });
}

// ------------------------------------------------------------------------------------------------------------------------------------------
// SITE
// ------------------------------------------------------------------------------------------------------------------------------------------
{
  const { texte } = sources('cloud/public/app/index2.js', ['_positionsPlates', '_jsFillHoles']);
  const mtState = { lastStats: null };
  const construire = new Function('THREE', 'preparerTrous', 'analyserTrous', 'renduApercuTrous', 'indicesAvecRustines', 'mtState',
    texte + '\nreturn { _jsFillHoles };');
  const S = construire(THREE, LIB.preparer, LIB.analyser, LIB.rendu_apercu, LIB.indices_avec_rustines, mtState);
  const statut = new Function('diagnostiquerTrous', 'agregerTrous', 'messageRefusTrous', '_i18nT', '_i18nTf', 'window',
    'return (' + previewStatusDuSite() + ');')(LIB.diagnostiquer, LIB.agreger, LIB.message_refus, i18nT, i18nTf, { FabMessages });

  test('site : la geometrie de l apercu est l originale PLUS les faces ajoutees (prefixe intact, positions intactes, aucun sommet nouveau)', () => {
    const c = cas('sphere_couture_trou');
    const g = geometrie(c);
    const idx0 = Array.from(g.index.array), pos0 = Float32Array.from(g.attributes.position.array);
    mtState.lastStats = null;
    const r = S._jsFillHoles(g, 3, 2000);
    assert.ok(r.geometry, 'une geometrie est rendue');
    const idx1 = Array.from(r.geometry.index.array);
    assert.deepEqual(idx1.slice(0, idx0.length), idx0, 'les faces d entree sont un prefixe');
    assert.equal(idx1.length, idx0.length + 3 * c.attendu.faces_ajoutees);
    assert.deepEqual(idx1.slice(idx0.length), c.attendu.ajout.flat());
    assert.deepEqual(Array.from(r.geometry.attributes.position.array), Array.from(pos0), 'aucun sommet deplace ou ajoute');
    assert.deepEqual(Array.from(g.index.array), idx0, 'la geometrie d origine n est pas modifiee');
    assert.equal(r.geometry.attributes.position.count, g.attributes.position.count);
    assert.equal(r.helpers.length, 1, 'un trait vert');
    assert.equal(r.stats.faces, c.attendu.faces_ajoutees);
  });

  test('site : un maillage ferme ne rend AUCUNE geometrie (le bouton « Apply on device » reste desactive) mais des statistiques', () => {
    mtState.lastStats = null;
    const r = S._jsFillHoles(geometrie(cas('sphere_fermee')), 3, 2000);
    assert.equal(r.geometry, null);
    assert.equal(r.stats.fh, true);
    assert.equal(r.stats.faces, 0);
  });

  test('site : plusieurs maillages — les statistiques se cumulent', () => {
    mtState.lastStats = null;
    const r1 = S._jsFillHoles(geometrie(cas('sphere_trou_3')), 3, 2000);
    mtState.lastStats = r1.stats;
    const r2 = S._jsFillHoles(geometrie(cas('sphere_trou_4')), 3, 2000);
    assert.equal(r2.stats.faces, 3);
    assert.equal(r2.stats.filled, 2);
    assert.equal(r2.stats.analyses.length, 2);
  });

  test('site : previewStatus — bilan quand il y a des trous, verite quand il n y en a pas (hors plage, ferme + diagnostic)', () => {
    const etat = (nom, min, max) => {
      mtState.lastStats = null;
      S._jsFillHoles(geometrie(cas(nom)), min, max);
      const r = { lastStats: null };
      mtState.lastStats = null;
      const out = S._jsFillHoles(geometrie(cas(nom)), min, max);
      r.lastStats = out.stats;
      return statut({ min_hole_size: min, max_hole_size: max }, r);
    };
    traduit.length = 0;
    const bilan = etat('sphere_trois_trous_plage', 5, 12);
    assert.match(bilan, /^Holes: 2 to fill \(green\) · 1 too small \(grey\) · 0 too large \(red\) · Each hole gets a smooth patch that follows the surface and its colours; nothing is removed$/);
    assert.equal(traduit.length, 0, 'le bilan ne passe pas par le traducteur de refus');
    const t = etat('sphere_t_jonction', 3, 2000);
    assert.equal(t, 'TRADUIT:' + cas('sphere_t_jonction').attendu.refus[1]);
    const r = etat('sphere_hors_plage', 40, 60);
    assert.match(traduit[traduit.length - 1], /^No hole between 40 and 60 edges/);
    assert.ok(r.startsWith('TRADUIT:'));
    etat('sphere_faces_retournees', 3, 2000);
    assert.match(traduit[traduit.length - 1], /4 faces point the wrong way/);
    etat('sphere_non_manifold', 3, 2000);
    assert.match(traduit[traduit.length - 1], /shared by more than two faces/);
    assert.equal(statut({}, { lastStats: null }), 'Computing…');
  });

  test('site : _mtRunPreview garde les traits et les nombres d un apercu sans geometrie (ferme) et laisse « Apply on device » desactive', () => {
    const src = readFileSync(join(RACINE, 'cloud/public/app/index2.js'), 'utf-8');
    assert.match(src, /else if \(out && out\.stats && Array\.isArray\(out\.helpers\)\) \{/);
    assert.match(src, /from '\.\/lib\/bouchage-trous\.js'/);
    assert.ok(!src.includes('Local preview found 0 boundary edges'), 'l ancien message trompeur a disparu');
    assert.ok(!src.includes('MergeCoincidentEdges'), 'l ancien detecteur du site a disparu');
  });
}
