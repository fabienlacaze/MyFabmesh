// 26/10 (decision du user : « l'assistant en 3 temps, menus a droite, verticalement ») : « Select faces » se pilote par un menu vertical a 3 etapes.
// Garde : (1) TOUS les ids me-* du mode Select existent une fois dans les DEUX HTML et le menu n'a aucun controle propre ; (2) le VRAI bloc
// « ASSISTANT SELECTION » des deux index2.js est execute dans une fausse page : etapes, resume, mode expert, compteur reel, Echap, raccourcis,
// message « N faces deleted » ; (3) le CSS et les traductions sont presents des deux cotes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const R = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lire = (f) => readFileSync(join(R, f), 'utf8').replace(/\r\n/g, '\n');
const CIBLES = { site: { html: 'cloud/public/app/index.html', js: 'cloud/public/app/index2.js', css: 'cloud/public/app/styles/index2.css' },
  bureau: { html: 'src/renderer/index2.html', js: 'src/renderer/index2.js', css: 'src/renderer/styles/index2.css' } };

// ---- (1) ids ----
const IDS_SELECT = ['me-sel-add', 'me-sel-erase', 'me-sel-wand', 'me-sel-lasso', 'me-sel-wand-angle', 'me-sel-grow', 'me-sel-shrink', 'me-sel-all', 'me-sel-invert', 'me-sel-clear',
  'me-sel-isolate', 'me-sel-hide', 'me-sel-move', 'me-move-translate', 'me-move-rotate', 'me-move-scale', 'me-sel-duplicate', 'me-sel-crop', 'me-sel-crop-keeprest', 'me-sel-flip',
  'me-sel-smooth', 'me-sel-delete', 'me-brush-size', 'me-strength', 'me-tool-sculpt', 'me-tool-paint', 'me-tool-select', 'me-sym-x', 'me-sym-y', 'me-sym-z', 'me-loupe-toggle', 'me-undo', 'me-redo'];
const IDS_ASSISTANT = ['me-wizard', 'me-w-back', 'me-w-chip', 'me-w-count-n', 'me-w-count-pct', 'me-w-step-1', 'me-w-step-2', 'me-w-step-3', 'me-w-head-1', 'me-w-head-2', 'me-w-head-3',
  'me-w-sum-1', 'me-w-sum-2', 'me-w-sum-3', 'me-w-add', 'me-w-erase', 'me-w-wand', 'me-w-lasso', 'me-w-radius', 'me-w-radius-val', 'me-w-radius-row', 'me-w-angle', 'me-w-angle-val', 'me-w-angle-row',
  'me-w-grow', 'me-w-shrink', 'me-w-all', 'me-w-invert', 'me-w-clear', 'me-w-next1', 'me-w-c-duplicate', 'me-w-c-move', 'me-w-c-isolate', 'me-w-c-hide', 'me-w-c-smooth', 'me-w-c-flip', 'me-w-c-crop',
  'me-w-c-delete', 'me-w-back1', 'me-w-back2', 'me-w-translate', 'me-w-rotate', 'me-w-scale', 'me-w-gizmo', 'me-w-expert'];
function blocModale(html) {
  const i = html.indexOf('<div id="modal-mesh-edit"');
  assert.ok(i > 0);
  return html.slice(i, html.indexOf('<!-- Global loupe magnifier', i));
}
const occ = (b, id) => (b.match(new RegExp('id="' + id + '"', 'g')) || []).length;
for (const [nom, c] of Object.entries(CIBLES)) {
  test(`${nom} : les ${IDS_SELECT.length} ids me-* d'origine et ceux de l'assistant existent une seule fois`, () => {
    const b = blocModale(lire(c.html));
    for (const id of [...IDS_SELECT, ...IDS_ASSISTANT]) assert.equal(occ(b, id), 1, `${nom} : #${id} doit exister exactement une fois`);
  });
  test(`${nom} : l'assistant n'a AUCUN controle propre (pas d'id me-sel-* ni me-move-* dans #me-wizard)`, () => {
    const b = blocModale(lire(c.html));
    const w = b.slice(b.indexOf('<div id="me-wizard"'), b.indexOf('id="me-w-expert"'));
    assert.ok(w.length > 1000);
    assert.ok(!/id="me-(sel|move|tool|sym|brush|strength)-/.test(w), 'le menu ne duplique aucun controle existant');
  });
  test(`${nom} : CSS de l'assistant present (menu vertical, mode simple, puce du compteur)`, () => {
    const css = lire(c.css);
    assert.ok(!/[\u0000-\u0008]/.test(css), 'aucun caractere de controle dans le CSS (escapes CSS mal ecrits)');
    assert.ok(css.includes("content: '\\2039\\00a0'") && css.includes("content: '\\00a0\\203A'"), 'fleches du menu');
    for (const m of ['#modal-mesh-edit.me-simple #me-wizard', '#modal-mesh-edit.me-simple #me-panel > :not(#me-wizard):not(#me-actions-row)', '.me-w-step.on .me-w-body', '#me-w-chip']) assert.ok(css.includes(m), m);
  });
  test(`${nom} : Echap passe par _meOnEscape (plus de fermeture directe)`, () => {
    const js = lire(c.js);
    assert.ok(js.includes("if (e.key === 'Escape') { _meOnEscape(); return; }"));
    assert.ok(!js.includes("if (e.key === 'Escape') _closeMeshEdit();"));
  });
}
test('parite : meme jeu d\'ids dans les deux fenetres', () => {
  const ids = (h) => new Set([...blocModale(h).matchAll(/ id="(me-[a-z0-9-]+)"/g)].map(m => m[1]));
  const a = ids(lire(CIBLES.site.html)), b = ids(lire(CIBLES.bureau.html));
  for (const id of [...IDS_SELECT, ...IDS_ASSISTANT]) { assert.ok(a.has(id), 'site ' + id); assert.ok(b.has(id), 'bureau ' + id); }
});
test('les deux HTML ont le MEME texte d\'assistant', () => {
  const t = (h) => { const b = blocModale(h); return b.slice(b.indexOf('<button id="me-w-back"'), b.indexOf('id="me-w-expert"')); };
  assert.equal(t(lire(CIBLES.site.html)), t(lire(CIBLES.bureau.html)));
});
test('le bloc JS est identique des deux cotes, SAUF _meAsstCount', () => {
  const b = (f) => { const j = lire(f), i = j.indexOf('// ═══ ASSISTANT SELECTION : DEBUT'), k = j.indexOf('// ═══ ASSISTANT SELECTION : FIN'); assert.ok(i > 0 && k > i); return j.slice(i, k); };
  const sans = (s) => s.replace(/\n\/\/ Faces concernees[\s\S]*?\n\}\n/, '\n');
  assert.equal(sans(b(CIBLES.site.js)), sans(b(CIBLES.bureau.js)));
});

// ---- (2) le vrai bloc, dans une fausse page ----
class ClassList {
  constructor() { this.s = new Set(); }
  add(c) { this.s.add(c); } remove(c) { this.s.delete(c); } contains(c) { return this.s.has(c); }
  toggle(c, f) { const on = f === undefined ? !this.s.has(c) : !!f; on ? this.s.add(c) : this.s.delete(c); return on; }
}
class El {
  constructor(id, doc) { this.id = id; this.doc = doc; this.classList = new ClassList(); this.style = {}; this.textContent = ''; this.value = ''; this.disabled = false; this.checked = false; this.L = {}; this.clicks = 0; this.kids = {}; this._parent = null; }
  addEventListener(t, f, cap) { (this.L[t] = this.L[t] || []).push({ f, cap: !!cap }); }
  dispatchEvent(ev) { const l = (this.L[ev.type] || []); for (const x of l.filter(y => y.cap).concat(l.filter(y => !y.cap))) x.f(ev); return true; }
  click() { if (this.disabled) return; this.clicks++; this.dispatchEvent({ type: 'click', target: this }); }
  querySelector(s) { return this.kids[s] || (this.kids[s] = new El(this.id + '>' + s, this.doc)); }
  get parentElement() { return this._parent || (this._parent = new El(this.id + '^', this.doc)); }
  set parentElement(v) { this._parent = v; }
}
function page(nom, mode = 'select') {
  const src = lire(CIBLES[nom].js);
  const i = src.indexOf('// ═══ ASSISTANT SELECTION : DEBUT'), k = src.indexOf('// ═══ ASSISTANT SELECTION : FIN');
  const code = src.slice(i, k);
  const els = {}, docL = {}, store = {};
  const doc = {
    getElementById(id) { return els[id] || (els[id] = new El(id, doc)); },
    addEventListener(t, f) { (docL[t] = docL[t] || []).push(f); },
    activeElement: null,
  };
  const modal = doc.getElementById('modal-mesh-edit'); modal.classList.add('hidden'); doc.getElementById('modal-confirm').classList.add('hidden');
  const toasts = [], confirms = []; let fermee = 0, gizmoFermes = 0, confirmOk = false;
  const meState = { mode, moveActive: false, undoStack: [], mesh: null };
  // maillage factice : 4 triangles ; sommets selectionnes = tableau sel (site : couleur orange ; bureau : Map _selSaved)
  const sel = new Set();
  const geom = { attributes: { position: { count: 12 } }, index: { count: 12, getX: (n) => n } };
  if (nom === 'site') geom.attributes.color = { count: 12 }; else Object.defineProperty(geom, '_selSaved', { get: () => ({ size: sel.size, has: (v) => sel.has(v) }) });
  meState.mesh = { traverse: (f) => f({ isMesh: true, geometry: geom }) };
  const env = {
    document: doc, meState, window: {}, Event: class { constructor(t) { this.type = t; } },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    MutationObserver: class { observe() {} }, setTimeout, clearTimeout,
    showToast: (m) => toasts.push(m), _i18nT: (s) => s, _i18nTf: (s, ...a) => { let n = 0; return s.replace(/\{[xy]\}/g, () => a[n++]); },
    _locale: () => 'en', customConfirm: async (m) => { confirms.push(m); return confirmOk; }, _closeMeshEdit: () => { fermee++; }, _meEndMove: () => { gizmoFermes++; meState.moveActive = false; },
    _meOrange: (col, n) => sel.has(n),
  };
  const f = new Function(...Object.keys(env), code + '\nreturn { _meAsst, _meAsstCount, _meOnEscape, _meAsstGo, _meAsstApply, _meAsstRender, _meAsstSetExpert };');
  const api = f(...Object.values(env));
  modal.classList.remove('hidden');
  return { api, doc, els, docL, meState, sel, toasts, confirms, store, get fermee() { return fermee; }, get gizmoFermes() { return gizmoFermes; }, setConfirm: (v) => { confirmOk = v; }, modal };
}
const attendre = (ms = 15) => new Promise(r => setTimeout(r, ms));

for (const nom of ['site', 'bureau']) {
  test(`${nom} : compteur REEL = triangles dont un sommet au moins est selectionne`, () => {
    const p = page(nom);
    assert.deepEqual({ ...p.api._meAsstCount() }, { sel: 0, total: 4 });
    p.sel.add(0);                       // un sommet du triangle 0
    assert.equal(p.api._meAsstCount().sel, 1);
    p.sel.add(4); p.sel.add(5); p.sel.add(11);   // triangles 1 et 3
    assert.equal(p.api._meAsstCount().sel, 3);
    for (let v = 0; v < 12; v++) p.sel.add(v);
    assert.equal(p.api._meAsstCount().sel, 4);
  });

  test(`${nom} : mode Select = assistant (me-simple) ; Sculpt = colonne d'origine ; Intensite masquee en Select seulement`, () => {
    const p = page(nom);
    p.api._meAsstApply();
    assert.ok(p.modal.classList.contains('me-simple') && p.modal.classList.contains('me-select-mode'));
    assert.equal(p.doc.getElementById('me-strength').parentElement.style.display, 'none');
    assert.equal(p.doc.getElementById('me-w-back').style.display, 'none', 'pas de lien retour tant qu on est en mode guide');
    p.meState.mode = 'sculpt'; p.api._meAsstApply();
    assert.ok(!p.modal.classList.contains('me-simple') && !p.modal.classList.contains('me-select-mode'));
    assert.equal(p.doc.getElementById('me-strength').parentElement.style.display, '', 'Sculpt / Paint gardent l Intensite');
  });

  test(`${nom} : etapes : 2 et 3 verrouillees sans zone, resume, retour automatique a l'etape 1`, () => {
    const p = page(nom); p.api._meAsstApply();
    p.api._meAsstGo(2);
    assert.equal(p.api._meAsst.step, 1); assert.ok(p.toasts.some(t => /Choose an area first/.test(t)));
    p.sel.add(0); p.sel.add(1); p.sel.add(2);
    p.api._meAsstRender();
    assert.equal(p.doc.getElementById('me-w-count-n').textContent, '1');
    assert.equal(p.doc.getElementById('me-w-sum-1').textContent, '1 faces chosen');
    assert.equal(p.doc.getElementById('me-w-next1').disabled, false);
    p.api._meAsstGo(2); assert.equal(p.api._meAsst.step, 2);
    assert.ok(p.doc.getElementById('me-w-step-2').classList.contains('on') && p.doc.getElementById('me-w-step-1').classList.contains('done'));
    assert.equal(p.doc.getElementById('me-w-step-1').querySelector('.me-w-head i').textContent, '✔');
    p.sel.clear(); p.api._meAsstRender();
    assert.equal(p.api._meAsst.step, 1, 'selection vide : retour a l etape 1');
    assert.equal(p.doc.getElementById('me-w-c-delete').disabled, true);
    assert.equal(p.doc.getElementById('me-w-sum-1').textContent, 'Nothing chosen yet');
  });

  test(`${nom} : une carte d'action ne fait que declencher le controle me-* existant`, async () => {
    const p = page(nom); p.api._meAsstApply(); p.sel.add(0); p.api._meAsstRender(); p.api._meAsstGo(2);
    const cartes = { 'me-w-c-duplicate': 'me-sel-duplicate', 'me-w-c-isolate': 'me-sel-isolate', 'me-w-c-hide': 'me-sel-hide', 'me-w-c-smooth': 'me-sel-smooth', 'me-w-c-flip': 'me-sel-flip', 'me-w-c-delete': 'me-sel-delete', 'me-w-c-crop': 'me-sel-crop' };
    for (const [c, s] of Object.entries(cartes)) {
      const avant = p.doc.getElementById(s).clicks;
      p.doc.getElementById(c).click();
      assert.equal(p.doc.getElementById(s).clicks, avant + 1, `${c} -> ${s}`);
    }
    assert.equal(p.doc.getElementById('me-sel-crop-keeprest').checked, false, 'Garder seulement la zone n active jamais « garder le reste »');
    await attendre();
  });

  test(`${nom} : Dupliquer passe a l'etape 3 (le gizmo s'ouvre sur la copie) ; Terminer le placement referme le gizmo`, async () => {
    const p = page(nom); p.api._meAsstApply(); p.sel.add(0); p.api._meAsstRender(); p.api._meAsstGo(2);
    p.doc.getElementById('me-sel-duplicate').addEventListener('click', () => { p.meState.moveActive = true; });
    p.doc.getElementById('me-w-c-duplicate').click(); await attendre();
    assert.equal(p.api._meAsst.step, 3);
    assert.equal(p.doc.getElementById('me-w-sum-2').textContent, 'Duplicated');
    assert.equal(p.doc.getElementById('me-w-gizmo').textContent, 'Finish placing');
    assert.equal(p.doc.getElementById('me-w-translate').disabled, false);
    p.doc.getElementById('me-w-gizmo').click();
    assert.equal(p.doc.getElementById('me-sel-move').clicks, 1, 'Terminer = reclic sur le bouton Move (gizmo) existant');
    p.doc.getElementById('me-w-rotate').click();
    assert.equal(p.doc.getElementById('me-move-rotate').clicks, 1);
  });

  test(`${nom} : Mode expert : bascule, memorise dans localStorage, lien de retour`, () => {
    const p = page(nom); p.api._meAsstApply();
    p.doc.getElementById('me-w-expert').click();
    assert.ok(!p.modal.classList.contains('me-simple') && p.modal.classList.contains('me-select-mode'));
    assert.equal(p.store.fab_me_expert, '1');
    assert.equal(p.doc.getElementById('me-w-back').style.display, 'block');
    p.doc.getElementById('me-w-back').click();
    assert.ok(p.modal.classList.contains('me-simple'));
    assert.equal(p.store.fab_me_expert, '0');
  });

  test(`${nom} : Echap : ferme le gizmo, puis desselectionne, puis confirme s'il y a des modifications, puis ferme`, async () => {
    const p = page(nom); p.api._meAsstApply();
    p.meState.moveActive = true; await p.api._meOnEscape();
    assert.equal(p.gizmoFermes, 1); assert.equal(p.fermee, 0);
    p.sel.add(0);
    await p.api._meOnEscape();
    assert.equal(p.doc.getElementById('me-sel-clear').clicks, 1, 'premier Echap = desselectionner'); assert.equal(p.fermee, 0);
    p.sel.clear();
    p.meState.undoStack.push({}); p.setConfirm(false);
    await p.api._meOnEscape();
    assert.equal(p.confirms.length, 1); assert.equal(p.fermee, 0, 'confirmation refusee : la fenetre reste ouverte');
    p.setConfirm(true); await p.api._meOnEscape();
    assert.equal(p.fermee, 1);
    p.meState.undoStack.length = 0; await p.api._meOnEscape();
    assert.equal(p.fermee, 2, 'rien a perdre : ferme sans demander'); assert.equal(p.confirms.length, 2);
  });

  test(`${nom} : raccourcis B E W L [ ] en mode Select, jamais dans un champ de texte`, () => {
    const p = page(nom); p.api._meAsstApply();
    const touche = (key) => { let pd = false; for (const f of p.docL.keydown || []) f({ key, ctrlKey: false, metaKey: false, altKey: false, preventDefault() { pd = true; } }); return pd; };
    for (const [k, id] of [['b', 'me-sel-add'], ['e', 'me-sel-erase'], ['w', 'me-sel-wand'], ['L', 'me-sel-lasso']]) { touche(k); assert.equal(p.doc.getElementById(id).clicks, 1, k); }
    const r = p.doc.getElementById('me-brush-size'); r.value = '25'; let evts = 0; r.addEventListener('input', () => evts++);
    touche(']'); assert.equal(r.value, '30'); touche('['); touche('['); assert.equal(r.value, '20'); assert.equal(evts, 3);
    r.value = '98'; touche(']'); assert.equal(r.value, '100', 'borne haute');
    p.doc.activeElement = { tagName: 'INPUT', type: 'text' }; touche('w'); assert.equal(p.doc.getElementById('me-sel-wand').clicks, 1, 'champ de texte : ignore');
    p.doc.activeElement = { tagName: 'INPUT', type: 'range' }; touche('w'); assert.equal(p.doc.getElementById('me-sel-wand').clicks, 2, 'un curseur ne bloque pas les raccourcis');
    p.doc.activeElement = null; p.meState.mode = 'sculpt'; touche('w'); assert.equal(p.doc.getElementById('me-sel-wand').clicks, 2, 'hors mode Select : ignore');
  });

  test(`${nom} : Supprimer annonce « N faces deleted — Undo (Ctrl+Z) » avec le compte pris AVANT la suppression`, () => {
    const p = page(nom); p.api._meAsstApply(); p.sel.add(0); p.sel.add(4);
    const d = p.doc.getElementById('me-sel-delete');
    d.dispatchEvent({ type: 'click' });
    assert.equal(p.api._meAsst.pendingMsg, '2 faces deleted — Undo (Ctrl+Z)');
    p.sel.clear(); d.dispatchEvent({ type: 'click' });
    assert.equal(p.api._meAsst.pendingMsg, '', 'rien de selectionne : pas de message');
  });

  test(`${nom} : le gestionnaire d'origine de Supprimer lit le message annonce`, () => {
    const js = lire(CIBLES[nom].js);
    assert.ok(js.includes('_meAsst.pendingMsg'), 'Supprimer / Rogner affichent le message annonce');
  });
}
