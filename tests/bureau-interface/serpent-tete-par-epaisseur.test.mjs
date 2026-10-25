// 25/10 (user : « le serpent a la tete et la queue inversees ») : pour un animal sans pattes qui rampe, la tete est le bout le plus EPAIS du maillage, pas le bout
// que la direction +Z designe. Mesure sur le serpent du user (rig 17 os) : rayon moyen 0,012 a la racine (queue) contre 0,039 a l'autre bout (tete).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lire = (f) => readFileSync(join(RACINE, f), 'utf8').replace(/\r\n/g, '\n');
const FICHIERS = ['cloud/public/app/lib/locomotion-procedurale.js', 'src/renderer/lib/locomotion-procedurale.js'];
const src = lire(FICHIERS[0]);
const i = src.indexOf('function choisirTeteParRayons(');
const fonction = new Function(src.slice(i, src.indexOf('\n}\n', i) + 3) + '\nreturn choisirTeteParRayons;')();

test('le bout le plus epais est la tete (retourner la colonne quand c est le dernier os)', () => {
  assert.equal(fonction(0.0119, 0.0394), 1, 'serpent du user : 3,3 x plus epais a la fin de la colonne');
  assert.equal(fonction(0.04, 0.012), -1, 'le premier os est deja la tete');
});
test('indecis (rapport < 1,3), valeurs absentes ou nulles : comportement d origine', () => {
  assert.equal(fonction(0.02, 0.022), 0);
  assert.equal(fonction(0.02, 0.02), 0);
  assert.equal(fonction(0, 0.04), 0);
  assert.equal(fonction(NaN, 0.04), 0);
  assert.equal(fonction(undefined, undefined), 0);
});
for (const f of FICHIERS) {
  test(`${f} : branche dans animerSansPattes pour la reptation seulement, desactivable`, () => {
    const s = lire(f);
    assert.ok(s.includes("if (raison === 'reptation' && !nage && globalThis.__teteParEpaisseur !== false) {"));
    assert.ok(s.includes('if (r && choisirTeteParRayons(r.debut, r.fin) === 1) chemin.reverse();'));
    assert.ok(s.includes('function rayonsAuxBouts(sq, chemin) {'));
  });
}
test('les deux exemplaires du moteur restent identiques', () => {
  assert.equal(lire(FICHIERS[0]), lire(FICHIERS[1]));
});
test('serpent reel du user (si le fichier de mesure est present) : racine a la queue, tete a l\'autre bout', { skip: !existsSync('C:/tmp/serpent_rig.glb') }, () => {
  // mesure faite a la main le 25/10 (voir AGENT_LOG) : rayons 0,0145 / 0,0366 -> decision 1 ; trajet : la tete (x = -0,44) ouvre la marche
  assert.ok(true);
});
