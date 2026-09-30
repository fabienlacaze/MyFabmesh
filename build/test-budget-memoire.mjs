#!/usr/bin/env node
/**
 * Tests des calculs de budget memoire de main.js (src/main/budget_memoire.js).
 *   node build/test-budget-memoire.mjs
 * Les memes definitions sont testees cote Python par build/test_cloisonnement_memoire.py.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const b = require(join(RACINE, 'src', 'main', 'budget_memoire.js'));

let n = 0;
function cas(nom, fn) { fn(); n++; console.log('ok  ' + nom); }

cas('limite RAM : marqueur borne a la RAM physique, sinon la RAM physique', () => {
  assert.equal(b.limiteRamMo('27645', 32524), 27645);
  assert.equal(b.limiteRamMo('99999', 32524), 32524);
  assert.equal(b.limiteRamMo('', 32524), 32524);
  assert.equal(b.limiteRamMo(undefined, 32524), 32524);
});

cas("budget RAM de l'incident du 30/09 (limite 27 645 Mo, 14,2 Go utilises)", () => {
  const budget = b.budgetRamMo({ limiteMo: 27645, utiliseeMo: 14.2 * 1024 });
  assert.ok(Math.abs(budget - 13104.2) < 0.1, String(budget));
  assert.equal(b.budgetRamMo({ limiteMo: 10000, utiliseeMo: 12000 }), 0);
});

cas('VRAM : fraction du marqueur moins la VRAM deja occupee', () => {
  assert.ok(Math.abs(b.limiteVramMo('0.90', 16303) - 14672.7) < 0.1);
  assert.ok(Math.abs(b.limiteVramMo('abc', 16303) - 15487.85) < 0.1);   // defaut 0,95
  assert.equal(b.budgetVramMo({ limiteMo: 14672, utiliseeMo: 3212 }), 11460);
  assert.equal(b.budgetVramMo({ limiteMo: 14672, utiliseeMo: 16000 }), 0);
});

cas('arrondis : besoin vers le haut, disponible vers le bas', () => {
  assert.equal(b.versGo(1024), 1.0);
  assert.equal(b.versGo(1025), 1.1);
  assert.equal(b.versGo(2047, 'bas'), 1.9);
  assert.equal(b.versGo(-5), 0);
});

cas('journal des pics : dernier travail reussi, releve par un refus plus recent', () => {
  const journal = [
    '{"cle":"trellis2_1024","issue":"ok","pic_prive_mo":5200}',
    'pas du json',
    '{"cle":"trellis2_1024","issue":"ok","pic_prive_mo":4800,"pic_vram_reserve_mo":9100,"vram_contexte_mo":480}',
    '{"cle":"trellis2_1536_cascade","issue":"memoire","besoin_mo":11800}',
    '{"cle":"trellis2_1024_cascade","issue":"ok","pic_prive_mo":5000,"pic_vram_reserve_mo":10000}',
    '{"cle":"trellis2_1024_cascade","issue":"memoire","manque":"vram","besoin_mo":12500}',
    '{"cle":"realvis","issue":"fin","pic_prive_mo":9000}',
    '{"cle":"sdxl_server","issue":"ok","pic_prive_mo":0}',
  ].join('\r\n');
  const pics = b.lirePics(journal);
  assert.equal(pics.get('trellis2_1024').besoinMo, 4800);
  assert.equal(pics.get('trellis2_1024').besoinVramMo, 9580);       // pic reserve + contexte CUDA
  // refus RAM (ancien plafond d'engagement, disparu le 30/09) : ignores
  assert.equal(pics.has('trellis2_1536_cascade'), false);
  // un refus VRAM ne se confond pas avec un besoin RAM
  assert.equal(pics.get('trellis2_1024_cascade').besoinMo, 5000);
  assert.equal(pics.get('trellis2_1024_cascade').besoinVramMo, 12500);
  assert.equal(pics.has('realvis'), false);        // issue inconnue (processus arrete) : ignore
  assert.equal(pics.has('sdxl_server'), false);    // pic nul : ignore
  assert.equal(b.besoinMo(pics, ['trellis2_1536_cascade', 'trellis2_1024'], 999), 4800);
  assert.equal(b.besoinVramMo(pics, ['trellis2_1536_cascade'], null), null);
  assert.equal(b.besoinVramMo(pics, ['trellis2_1024_cascade', 'trellis2_1024'], null), 9580);
  assert.equal(b.besoinMo(pics, 'inconnu', 999), 999);
  assert.equal(b.besoinMo(null, 'x', 7), 7);
});

cas('verdict : la RAM ne bloque jamais (plafond souple), la VRAM avec une marge de 10 %', () => {
  assert.equal(b.verdict({ besoinRamMo: 4000, budgetRamMo: 13104, besoinVramMo: 9000, budgetVramMo: 11460 }).ok, true);
  const v = b.verdict({ besoinRamMo: 12700, budgetRamMo: 8300, besoinVramMo: 1000, budgetVramMo: 5000 });
  assert.equal(v.ok, true);                                  // RAM courte : le calcul part, plus lent
  assert.deepEqual(v.ralenti, { type: 'ram', besoinGo: 12.5, dispoGo: 8.1 });
  const w = b.verdict({ besoinRamMo: 1, budgetRamMo: 2, besoinVramMo: 8808, budgetVramMo: 8454 });
  assert.equal(w.ok, false);
  assert.equal(w.type, 'vram');                              // 8,8 Go x 1,1 > 8,45 : retenu au lancement
  assert.equal(b.verdict({ besoinVramMo: 8000, budgetVramMo: 8700 }).ok, false);   // 8,8 avec la marge
  assert.equal(b.verdict({ besoinVramMo: 7800, budgetVramMo: 8700 }).ok, true);
  assert.equal(b.verdict({ besoinRamMo: 5000, budgetRamMo: null }).ok, true);
  assert.ok(b.phraseManque('ram', 12.5, 8.1).startsWith('This generation needs about 12.5 GB of RAM but only 8.1 GB are available under your limit'));
});

cas('modele de reserve : part = total - plancher - max(reserve, autres) ; reserve maximale', () => {
  assert.equal(b.budgetReserveMo({ totalMo: 16303, plancherMo: 512, reserveMo: 5000, autresMo: 3900 }), 16303 - 512 - 5000);
  assert.equal(b.budgetReserveMo({ totalMo: 16303, plancherMo: 512, reserveMo: 5000, autresMo: 7000 }), 16303 - 512 - 7000);
  assert.equal(b.budgetReserveMo({ totalMo: 8000, plancherMo: 512, reserveMo: 9000, autresMo: 0 }), 0);
  assert.equal(b.reserveMaxMo({ totalMo: 16303, plancherMo: 512, besoinMaxMo: 10000 }), 16303 - 512 - 10000);
  assert.equal(b.reserveMaxMo({ totalMo: 8000, plancherMo: 512, besoinMaxMo: 10000 }), 0);
  assert.equal(b.PLANCHER_RAM_MO, 2048);
  assert.equal(b.PLANCHER_VRAM_MO, 512);
});

cas('marqueur Python -> phrase (sortie melangee, CRLF)', () => {
  const sortie = 'blabla\r\n[t2_native] x\r\nFABMESH_MEMOIRE_INSUFFISANTE {"type": "vram", "besoin_go": 13.2, "dispo_go": 9.6, "nom": "t"}\r\nThis generation...';
  const m = b.manqueDansSortie(sortie);
  assert.equal(m.type, 'vram');
  assert.equal(m.phrase, b.phraseManque('vram', 13.2, 9.6));
  assert.ok(m.phrase.includes('13.2 GB of VRAM but only 9.6 GB'));
  assert.equal(b.manqueDansSortie('rien'), null);
  assert.equal(b.manqueDansSortie('FABMESH_MEMOIRE_INSUFFISANTE {pas json'), null);
});

cas('meme phrase que le Python (scripts/cloisonnement_memoire.py)', () => {
  const py = readFileSync(join(RACINE, 'scripts', 'cloisonnement_memoire.py'), 'utf-8');
  const debut = 'This generation needs about {x} GB of RAM but only {y} GB are available';
  assert.ok(b.PHRASE_RAM.startsWith(debut));
  assert.ok(py.includes("'This generation needs about {x} GB of RAM but only {y} GB are available '"));
});

console.log(`\n${n} cas OK`);
