// Constat D-01 (analyse du 03/10/2026) : XSS dans la Marketplace du bureau. Execute le VRAI code de
// src/renderer/index2.js (showCloudLibraryModal + onglet Marketplace) contre un DOM minimal et des fiches hostiles,
// puis analyse le HTML produit avec un petit lecteur de balises qui respecte les guillemets comme un navigateur.
// Lancer : node --test tests/bureau-interface/   ;   variable FICHIER_INDEX2 pour viser un autre fichier (ancien code).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const chemin = process.env.FICHIER_INDEX2 || new URL('../../src/renderer/index2.js', import.meta.url);
const src = readFileSync(chemin, 'utf8').replace(/\r\n/g, '\n');
const a = src.indexOf('// ---- Navigateur Bibliothèque cloud / Marketplace ----');
const b = src.indexOf("document.getElementById('btn-cloud-library')");
assert.ok(a > 0 && b > a, 'ancres introuvables');
const code = src.slice(a, b);

// Lecteur de balises : renvoie [{nom, attrs:{nom:valeur}}] ; une valeur entre guillemets doubles ne se termine qu au guillemet suivant.
function balises(html) {
  const out = []; let i = 0;
  while ((i = html.indexOf('<', i)) >= 0) {
    const m = /^<([a-zA-Z][a-zA-Z0-9]*)/.exec(html.slice(i)); if (!m) { i++; continue; }
    let j = i + m[0].length; const attrs = {};
    for (;;) {
      while (/\s/.test(html[j] || '')) j++;
      if (j >= html.length) break;
      if (html[j] === '>') { j++; break; }
      if (html[j] === '/') { j++; continue; }
      const n = /^[^\s=>\/]+/.exec(html.slice(j)); if (!n) { j++; continue; }
      j += n[0].length; let v = '';
      if (html[j] === '=') { j++; if (html[j] === '"') { const e = html.indexOf('"', j + 1); v = html.slice(j + 1, e < 0 ? html.length : e); j = (e < 0 ? html.length : e) + 1; } else { const w = /^[^\s>]*/.exec(html.slice(j)); v = w[0]; j += v.length; } }
      attrs[n[0].toLowerCase()] = v;
    }
    out.push({ nom: m[1].toLowerCase(), attrs }); i = j;
  }
  return out;
}

function lancer(listings) {
  const elems = {};
  const faux = (id) => elems[id] ||= {
    id, innerHTML: '', textContent: '', style: {}, dataset: {}, classList: { add() {}, remove() {} },
    querySelector(sel) { return faux(sel); }, querySelectorAll() { return []; }, addEventListener() {}, remove() {}, appendChild() {},
  };
  const doc = { getElementById: () => null, createElement: () => faux('overlay'), body: { appendChild() {} } };
  const API = { cloudListMarket: async () => ({ success: true, listings, owned: [] }), cloudListLibrary: async () => ({ success: true, projects: [], meshes: [] }) };
  const fabrique = new Function('document', 'window', 'API', 'state', '_exigerConnexion', '_openCloudSite', 'showToast', '_i18nT', 'reloadCurrentProject', 'refreshProjectsPage', 'showCloudLoginModal',
    code + '; return showCloudLibraryModal;');
  const showCloudLibraryModal = fabrique(doc, {}, API, { currentProject: null }, async () => true, () => {}, () => {}, (s) => s, async () => {}, () => {}, async () => true);
  return { showCloudLibraryModal, elems };
}

const HOSTILES = [
  { id: 'a1', title: '<img src=x onerror=alert(1)>', author_display: '<svg/onload=alert(2)>', asset_kind: '"><script>alert(3)</script>', currency: '</button><iframe src=//evil>', downloads: 3, price_cents: 500, asset_url: 'javascript:alert(4)' },
  { id: '" onmouseover="alert(5)', title: 'x" onfocus="alert(6)" autofocus="', author_display: 'ok', asset_kind: 'mesh', price_cents: 0, asset_url: 'https://cdn.example/a.png" onerror="alert(7)' },
  { id: 'a3', title: 'normal', author_display: 'bob', asset_kind: 'image', price_cents: 0, asset_url: 'data:text/html,<script>alert(8)</script>' },
];

test('Marketplace : aucune balise ni attribut actif produit par des fiches hostiles', async () => {
  const { showCloudLibraryModal, elems } = lancer(HOSTILES);
  await showCloudLibraryModal();
  elems['#clb-tab-market'].onclick();
  await new Promise((r) => setTimeout(r, 20));
  const html = elems['#clb-body'].innerHTML;
  assert.ok(html.length > 100, 'la grille doit etre rendue');
  const tags = balises(html);
  const autorisees = new Set(['div', 'img', 'span', 'button']);
  for (const t of tags) assert.ok(autorisees.has(t.nom), 'balise interdite : ' + t.nom);
  const attrsOk = new Set(['style', 'src', 'loading', 'onerror', 'title', 'class', 'data-market', 'data-fname', 'data-buy', 'data-url']);
  for (const t of tags) for (const n of Object.keys(t.attrs)) assert.ok(attrsOk.has(n), 'attribut interdit : ' + n + ' sur <' + t.nom + '>');
  // le seul onerror admis est le gestionnaire statique du code (repli d icone)
  for (const t of tags) if (t.attrs.onerror !== undefined) assert.match(t.attrs.onerror, /^this\.outerHTML='<span style=&quot;font-size:34px;opacity:\.5;&quot;>&#128444;&#65039;<\/span>'$/);
  // images : https seulement, aucune des URL hostiles (javascript:, data:, guillemet injecte)
  for (const t of tags.filter((x) => x.nom === 'img')) assert.match(t.attrs.src, /^https:\/\/[^"<>]*$/);
  // abs() prefixe les valeurs non http(s) par l origine du site : les 3 fiches donnent une image https, jamais javascript: ni data:
  assert.equal(tags.filter((x) => x.nom === 'img').length, 3);
  assert.ok(!tags.some((x) => x.nom === 'img' && /^(javascript|data):/i.test(x.attrs.src)));
  assert.ok(!/<script|<iframe|<svg/i.test(html), 'aucune balise injectee');
  // le texte hostile doit apparaitre, mais echappe
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

test('Marketplace : une URL d image http: est ecartee (https seulement)', async () => {
  const { showCloudLibraryModal, elems } = lancer([{ id: 'h1', title: 't', asset_kind: 'image', price_cents: 0, asset_url: 'http://exemple.test/a.png' }]);
  await showCloudLibraryModal();
  elems['#clb-tab-market'].onclick();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(balises(elems['#clb-body'].innerHTML).filter((x) => x.nom === 'img').length, 0);
});
