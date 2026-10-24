// Relecture du 24/10 sur prompts-2410 : B1 (texte etranger court sous interface ANGLAISE) et B2 (9e negation).
//   B1 : langueSource(texte, 'en') rendait null des qu'une detection n'etait que PROBABLE (« un orco sin casco ») : le traducteur n'etait jamais appele,
//        le texte partait brut, sans fenetre. Desormais une langue etrangere meme peu sure est traduite ; un texte sans langue (« camper van ») reste intact.
//   B2 : au-dela de 8 termes la 9e negation (« no dagger ») restait dans le positif et faisait DESSINER la dague. Elle quitte le positif et le code
//        d'avertissement 'negations-en-trop' previent AVANT la depense.
// Rejouer contre l'ancien code : LANGUE_JS=<ancienne lib> COMPOSEUR_JS=<ancienne lib> node --test tests/bureau-interface/respect-entree-relecture.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dossier = mkdtempSync(join(tmpdir(), 'respect-entree-'));

async function charger(nom, chemin) {
  const copie = join(dossier, nom + '.mjs');
  writeFileSync(copie, readFileSync(chemin, 'utf-8'));
  return import(pathToFileURL(copie).href);
}

const EXEMPLAIRES = [
  ['bureau', 'src/renderer/lib'],
  ['site', 'cloud/public/app/lib'],
];
const L = {};
const C = {};
for (const [nom, rel] of EXEMPLAIRES) {
  L[nom] = await charger('langue-' + nom, process.env.LANGUE_JS || join(RACINE, rel, 'langue-texte.js'));
  C[nom] = await charger('composeur-' + nom, process.env.COMPOSEUR_JS || join(RACINE, rel, 'composeur-intention.js'));
}
test.after(() => { try { rmSync(dossier, { recursive: true, force: true }); } catch (e) { /* ignore */ } });

for (const nom of Object.keys(L)) {
  test(nom + ' B1 : un texte etranger court est traduit meme sous interface anglaise', () => {
    const cas = [
      ['un orco sin casco', 'es'], ['No me gusta el casco, un orco', 'es'], ['um papagaio em um poleiro', 'pt'],
      ['un robot de 2,5 m de haut', 'fr'], ['un dragn rouje avek des ail', 'fr'], ['un abogado', 'es'], ['um advogado', 'pt'],
    ];
    // RESIDU assume (un seul mot de la langue, aucun article) : « bald fertig », « la tour Eiffel » restent envoyes tels quels sous interface anglaise.
    for (const [texte, langue] of cas) assert.equal(L[nom].langueSource(texte, 'en'), langue, texte);
    assert.equal(L[nom].langueSource("Non voglio l'elmo, un orco", 'en'), 'it');
  });

  test(nom + ' B1 : l\'anglais et les emprunts restent intacts sous interface anglaise', () => {
    for (const t of ['a red dragon', 'a knight with a sword', 'camper van', 'sombrero', 'Las Vegas sign', 'crème brûlée', 'robot 2.5 m', 'pina colada', 'Die Hard poster', 'Le Mans race car', 'pan flute', 'die cast car', 'Von Braun rocket', 'piñata shaped like a donkey', 'la dolce vita scooter'])
      assert.equal(L[nom].langueSource(t, 'en'), null, t);
  });
}

const DIX = 'a knight, no helmet, no shield, no cape, no sword, no bow, no axe, no spear, no mace, no dagger';
for (const nom of Object.keys(C)) {
  test(nom + ' B2 : la 9e negation quitte le positif, est consignee et annoncee', () => {
    const r = C[nom].negationsEtPositif(DIX);
    assert.deepEqual(r.negatifs, ['helmet', 'shield', 'cape', 'sword', 'bow', 'axe', 'spear', 'mace']);
    assert.equal(r.positif, 'a knight');
    assert.doesNotMatch(r.positif, /dagger/);
    assert.deepEqual(C[nom].negationsPerdues(DIX), ['dagger']);
    assert.ok(C[nom].detecterAvertissements(DIX, DIX, 'prop').includes('negations-en-trop'));
  });

  test(nom + ' B2 : jusqu\'a 8 negations, aucun avertissement et sortie inchangee', () => {
    const t = 'a knight, no helmet, no shield, no cape, no sword, no bow, no axe, no spear, no mace';
    assert.deepEqual(C[nom].negationsPerdues(t), []);
    assert.equal(C[nom].detecterAvertissements(t, t, 'prop').includes('negations-en-trop'), false);
    assert.equal(C[nom].negationsEtPositif(t).positif, 'a knight');
  });

  test(nom + ' B2 : une liste dans UNE locution garde 8 termes, le reste est annonce', () => {
    const t = 'a knight without helmet and shield and cape and sword and bow and axe and spear and mace and dagger and club';
    const r = C[nom].negationsEtPositif(t);
    assert.equal(r.negatifs.length, 8);
    assert.deepEqual(C[nom].negationsPerdues(t), ['dagger', 'club']);
    assert.doesNotMatch(r.positif, /dagger|club/);
  });
}
