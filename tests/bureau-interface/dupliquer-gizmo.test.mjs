// 26/10 (user : « si je clique sur Dupliquer, il faut copier la zone selectionnee et faire apparaitre le gizmo pour deplacer la copie ») :
// apres « Dupliquer » (Selectionner des faces), la COPIE est la seule selection et le gizmo de deplacement s'ouvre dessus.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const R = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lire = (f) => readFileSync(join(R, f), 'utf8').replace(/\r\n/g, '\n');
function gestionnaire(src) {
  let i = src.indexOf("document.getElementById('me-sel-duplicate')?.addEventListener('click', () => {");
  if (i < 0) i = src.indexOf("document.getElementById('me-sel-duplicate')?.addEventListener('click', async () => {");   // site : debit (27/10)
  assert.ok(i > 0);
  return src.slice(i, src.indexOf('\n});\n', i) + 4);
}
for (const f of ['cloud/public/app/index2.js', 'src/renderer/index2.js']) {
  test(`${f} : Dupliquer ferme un gizmo deja ouvert puis ouvre le gizmo sur la copie`, () => {
    const g = gestionnaire(lire(f));
    assert.ok(g.includes('if (meState.moveActive) _meEndMove();'));
    assert.ok(/_meStartMove\(\);/.test(g));
    assert.ok(g.indexOf('_meEndMove();') < g.indexOf('_meRestoreView()'), 'le gizmo precedent est ferme AVANT de dupliquer');
    assert.ok(g.lastIndexOf('_meStartMove();') > g.indexOf('Duplicated'), 'le gizmo s ouvre APRES la duplication');
  });
}
test('site : l original est deselectionne, seule la copie reste orange', () => {
  const g = gestionnaire(lire('cloud/public/app/index2.js'));
  assert.ok(g.includes("for (let i = 0; i < oldV; i++) if (_meOrange(cur, i)) cur.setXYZ(i, gris, gris, gris);"));
});

// ---- _meGarderGrosMorceaux : ecarte les fragments ramasses par le pinceau (26/10, « toujours eclate ») ----
function fonctionGros(src) {
  const i = src.indexOf('function _meGarderGrosMorceaux(geom, tris) {');
  assert.ok(i > 0);
  const f = src.slice(i, src.indexOf('\n}\n', i) + 3);
  return new Function('_meBuildPosAdj', f + '\nreturn _meGarderGrosMorceaux;');
}
for (const f of ['cloud/public/app/index2.js', 'src/renderer/index2.js']) {
  test(`${f} : _meGarderGrosMorceaux garde le gros morceau et ecarte les petits fragments`, () => {
    const gros = fonctionGros(lire(f))(() => {});
    // sommets : une grille 20 x 20 (gros morceau connexe = 722 triangles) + 3 petits triangles isoles loin de la grille
    const cles = [], tris = [];
    const n = 20, id = (x, y) => y * (n + 1) + x;
    for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++) cles[id(x, y)] = `${x},${y},0`;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { tris.push(id(x, y), id(x + 1, y), id(x, y + 1)); tris.push(id(x + 1, y), id(x + 1, y + 1), id(x, y + 1)); }
    const base = (n + 1) * (n + 1);
    for (let k = 0; k < 3; k++) { const b = base + k * 3; cles[b] = `f${k}a`; cles[b + 1] = `f${k}b`; cles[b + 2] = `f${k}c`; tris.push(b, b + 1, b + 2); }
    const geom = { _posKeyByIndex: cles };
    const sortie = gros(geom, tris);
    assert.equal(sortie.length, 800 * 3 === sortie.length ? sortie.length : 800 * 3);
    assert.equal(sortie.length / 3, 800, 'les 800 triangles du gros morceau restent');
    assert.ok(!sortie.some((v) => v >= base), 'les 3 fragments isoles sont ecartes');
  });
  test(`${f} : une selection petite (< 40 triangles) n'est jamais filtree`, () => {
    const gros = fonctionGros(lire(f))(() => {});
    const tris = [0, 1, 2, 3, 4, 5];
    assert.deepEqual(gros({ _posKeyByIndex: ['a', 'b', 'c', 'd', 'e', 'f'] }, tris), tris);
  });
}

// ---- 26/10 : la copie garde l'ECHELLE (translation rigide, plus de gonflement par la normale de chaque sommet) ----
for (const f of ['cloud/public/app/index2.js', 'src/renderer/index2.js']) {
  test(`${f} : Dupliquer decale la copie d'une TRANSLATION unique (pas de poussee par sommet)`, () => {
    const g = gestionnaire(lire(f));
    assert.ok(g.includes('const decX = sx / lnN * dec'), 'decalage rigide calcule une fois');
    assert.ok(g.includes('+ decX;') && g.includes('+ decY;') && g.includes('+ decZ;'));
    assert.ok(!/\* eps;/.test(g.split('Duplicated')[0].split('// DECALAGE RIGIDE')[1] || ''), 'plus de * eps par sommet');
  });
}

// ---- 26/10 : la copie dupliquee garde sa TEXTURE pendant le deplacement ; la fenetre n'est pas gratuite : prix visible sur « Save as new version » ----
for (const f of ['cloud/public/app/index2.js', 'src/renderer/index2.js']) {
  test(`${f} : la teinte de selection est masquee pendant le deplacement puis remise`, () => {
    const s = lire(f);
    assert.ok(s.includes('function _meMasquerTeinteDeplacement(masquer) {'));
    assert.ok(s.includes('_meMasquerTeinteDeplacement(true);'), 'masquee au debut du deplacement');
    assert.ok(s.includes('_meMasquerTeinteDeplacement(false);'), 'remise a la fin du deplacement');
  });
}
test('site : le bouton Save de la fenetre Sculpt / Paint / Select porte la pastille du tarif manual_tool', () => {
  assert.ok(lire('cloud/public/app/cloud-overrides.js').includes("'me-save':                  'manual_tool',"));
});
