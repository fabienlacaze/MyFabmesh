// 25/10 : avertissement avant la 3D quand l'image source fait moins de 512 px (une source de 225 px donnait une carapace plate sans aucun message).
// VRAIE fonction _avertirSourceTropPetite des deux index2.js (bureau et site), avec un faux DOM, une fausse Image et une fausse API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FICHIERS = { bureau: join(RACINE, 'src/renderer/index2.js'), site: join(RACINE, 'cloud/public/app/index2.js') };

function extraire(chemin) {
  const src = readFileSync(chemin, 'utf-8').replace(/\r\n/g, '\n');
  const i = src.indexOf('async function _avertirSourceTropPetite(');
  assert.ok(i >= 0, chemin + ' : fonction introuvable');
  const j = src.indexOf("\n}\n", i) + 3;
  return src.slice(i, j);
}

function monde({ w, h, bouton, agrandi }) {
  const boutons = {};
  const faux = (id) => (boutons[id] = boutons[id] || { ecouteurs: {}, addEventListener(t, f) { this.ecouteurs[t] = f; } });
  const boite = { innerHTML: '', style: {}, querySelector: (s) => faux(s.slice(1)) };
  const fond = { style: {}, appendChild() {}, remove() {}, addEventListener() {} };
  let n = 0;
  const document = {
    createElement: () => (n++ === 0 ? fond : boite),
    body: { appendChild() { setTimeout(() => boutons[bouton] && boutons[bouton].ecouteurs.click && boutons[bouton].ecouteurs.click(), 0); } },
    addEventListener() {}, removeEventListener() {},
  };
  class Image { set src(_) { this.naturalWidth = w; this.naturalHeight = h; setTimeout(() => this.onload && this.onload(), 0); } }
  const appels = [];
  const API = { imageQuickEdit: async (a) => { appels.push(a); return agrandi ? { success: true, newPath: 'https://x/grand.png' } : { success: false, error: 'non' }; } };
  const toasts = [];
  return { document, Image, API, showToast: (m, t) => toasts.push([m, t]), window: { _prixDe: () => 3 }, appels, toasts };
}

for (const [nom, chemin] of Object.entries(FICHIERS)) {
  const code = extraire(chemin);
  const lancer = (m, url = 'https://x/petite.png') =>
    new Function('document', 'Image', 'API', 'showToast', 'window', code + '\nreturn _avertirSourceTropPetite;')(m.document, m.Image, m.API, m.showToast, m.window)(url, 'p');

  test(`${nom} : une image de 1024 px ne declenche aucun avertissement`, async () => {
    const m = monde({ w: 1024, h: 1024 });
    assert.equal(await lancer(m), null);
    assert.equal(m.appels.length, 0);
  });
  test(`${nom} : 225 px + « Enlarge, then generate » : image agrandie x4 rendue`, async () => {
    const m = monde({ w: 225, h: 225, bouton: 'sp-agrandir', agrandi: true });
    const r = await lancer(m);
    assert.deepEqual(r, { nouveau: 'https://x/grand.png' });
    assert.equal(m.appels.length, 1);
    assert.equal(m.appels[0].operation, 'upscale');
    assert.equal(m.appels[0].params.scale, 4);
  });
  test(`${nom} : 400 px : agrandissement x2`, async () => {
    const m = monde({ w: 400, h: 400, bouton: 'sp-agrandir', agrandi: true });
    await lancer(m);
    assert.equal(m.appels[0].params.scale, 2);
  });
  test(`${nom} : « Generate anyway » : rien n'est depense`, async () => {
    const m = monde({ w: 225, h: 225, bouton: 'sp-quand-meme' });
    assert.equal(await lancer(m), null);
    assert.equal(m.appels.length, 0);
  });
  test(`${nom} : « Cancel » annule`, async () => {
    const m = monde({ w: 225, h: 225, bouton: 'sp-annuler' });
    assert.equal(await lancer(m), 'annuler');
  });
  test(`${nom} : l'agrandissement echoue : annule avec un message (jamais de 3D lancee sur la petite image sans le dire)`, async () => {
    const m = monde({ w: 225, h: 225, bouton: 'sp-agrandir', agrandi: false });
    assert.equal(await lancer(m), 'annuler');
    assert.ok(m.toasts.some(([, t]) => t === 'error'));
  });
}
