// FAUX AMIS DU CHOIX DE GABARIT (2026-10-13, lot 2 de l'audit de la langue : SERVEUR-06, MANQUE-SERV-04) — le VRAI modeDepuisTexte des deux
// exemplaires de lib/locomotion-procedurale.js (bureau et site). Il choisit le gabarit SANS PATTES (serpent : corps etire, pattes
// interdites) ou POISSON du prompt d'un animal, et l'allure du moteur de marche. Meme regle cote Modal (modal_app/_prompts.py,
// build/bancs/noyaux/test_faux_amis_gabarit.py, qui verifie aussi que les listes sont identiques).
// Lancer : node --test tests/bureau-interface/gabarit-faux-amis.test.mjs
// Ancien code : LOCOMOTION_BUREAU=<copie> LOCOMOTION_WEB=<copie> node --test tests/bureau-interface/gabarit-faux-amis.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const COPIES = {
  bureau: process.env.LOCOMOTION_BUREAU || join(RACINE, 'src/renderer/lib/locomotion-procedurale.js'),
  web: process.env.LOCOMOTION_WEB || join(RACINE, 'cloud/public/app/lib/locomotion-procedurale.js'),
};

const dossier = mkdtempSync(join(tmpdir(), 'gabarit-faux-amis-'));
const MODULES = {};
try {
  for (const [nom, chemin] of Object.entries(COPIES)) {
    const copie = join(dossier, nom + '.mjs');
    writeFileSync(copie, readFileSync(chemin, 'utf-8'));
    MODULES[nom] = await import(pathToFileURL(copie).href);
  }
} finally {
  rmSync(dossier, { recursive: true, force: true });
}

const FAUX_AMIS = [
  'un chat noir qui court vers la maison', 'une créature qui regarde vers le ciel', 'un loup qui marche vers les arbres',
  'un gato negro que quiere ver el mar', 'um gato preto que quer ver o mar',
  'a green parrot sitting on a wooden perch', 'a tabby cat with a bass guitar', "a medieval knight's horse carrying a pike",
  'a fluffy white rabbit with a pink feather boa', 'a cow wearing a python skin pattern', 'a fox in a ray of light', 'hai un gatto nero',
];
const VRAIS = {
  'a pike': 'nage', 'a big bass fish': 'nage', 'a koi carp': 'nage', 'a great white shark': 'nage', 'a giant python': 'reptation',
  'a red boa': 'reptation', 'un ver de terre': 'reptation', 'des vers de terre': 'reptation', 'a cobra': 'reptation',
  'a python snake': 'reptation', 'un poisson rouge': 'nage', 'une baleine': 'nage', 'a pink earthworm': 'reptation', 'ein Fisch': 'nage',
};

for (const [nom, M] of Object.entries(MODULES)) {
  test(nom + ' : faux amis et mots a double sens ne donnent plus le gabarit serpent / poisson (« vers la maison », « perch », « bass »...)', () => {
    for (const t of FAUX_AMIS) assert.equal(M.modeDepuisTexte(t), null, t);
  });
  test(nom + ' : les vrais poissons, serpents et vers le donnent toujours', () => {
    for (const [t, m] of Object.entries(VRAIS)) assert.equal(M.modeDepuisTexte(t), m, t);
  });
}
