// Tampon « mode eco » sur les visionneuses 3D dont le contexte WebGL est libere pendant une generation (2026-10-19) : src/renderer/index2.js.
// Execute le VRAI code (bloc entre les reperes TAMPON ECO et les fonctions _libererMemoireGraphique / _restaurerMemoireGraphique) dans un faux DOM.
// Autre exemplaire (preuve d'echec sur l'ancien code) : INDEX2=<chemin d'un index2.js>.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = process.env.INDEX2 || path.join(RACINE, 'src', 'renderer', 'index2.js');
const texte = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');

function bloc(debut, fin) {
  const i = texte.indexOf(debut);
  assert.ok(i >= 0, 'repere introuvable : ' + debut);
  const j = texte.indexOf(fin, i);
  assert.ok(j > i, 'fin introuvable : ' + fin);
  return texte.slice(i, j);
}

// --- faux DOM minimal
function faitElement(tag) {
  const e = {
    tag, children: [], parentElement: null, style: {}, dataset: {}, attrs: {}, className: '', innerHTML: '', offsetWidth: 400, offsetHeight: 300,
    setAttribute(k, v) { this.attrs[k] = v; },
    appendChild(c) { c.parentElement = this; this.children.push(c); return c; },
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((x) => x !== this); this.parentElement = null; },
    querySelector(sel) { const m = /^:scope > \.(.+)$/.exec(sel); return m ? this.children.find((c) => c.className === m[1]) || null : null; },
  };
  return e;
}
function monde() {
  const racine = faitElement('body');
  const tous = () => { const o = []; const marche = (n) => { n.children.forEach((c) => { o.push(c); marche(c); }); }; marche(racine); return o; };
  const document = {
    createElement: faitElement,
    querySelectorAll: (sel) => ({ forEach: (f) => tous().filter((n) => '.' + n.className === sel).forEach(f) }),
  };
  const ctx = { document, getComputedStyle: (el) => ({ position: el.style.position || 'static' }), _i18nT: (s) => s, showToast() {}, setInterval() {}, console, window: {}, state: { jobs: [] } };
  vm.createContext(ctx);
  return { ctx, racine, tous };
}
function fauxGl(perdu = false) {
  const gl = { perdu, isContextLost() { return this.perdu; }, getExtension() { return { loseContext: () => { gl.perdu = true; }, restoreContext: () => { gl.perdu = false; } }; } };
  return gl;
}
function visionneuse(racine, offset = [400, 300], position) {
  const parent = faitElement('div'); if (position) parent.style.position = position;
  const cv = faitElement('canvas'); cv.offsetWidth = offset[0]; cv.offsetHeight = offset[1];
  racine.appendChild(parent); parent.appendChild(cv);
  return { parent, cv };
}

const FONCTIONS = bloc('// >>> TAMPON ECO', '// <<< TAMPON ECO');
const LIBERER = bloc('window._libererMemoireGraphique = function () {', 'window._restaurerMemoireGraphique');
const RESTAURER = bloc('window._restaurerMemoireGraphique = function () {', 'const _genEco = new Set();');

function charge() {
  const m = monde();
  vm.runInContext('const _glLiberes = [];\n' + FONCTIONS + '\n' + LIBERER + '\n' + RESTAURER, m.ctx);
  return m;
}

test('le code appelle le tampon a la liberation et le retire a la restauration', () => {
  assert.match(LIBERER, /_poserTamponEco\(cv\)/);
  assert.match(RESTAURER, /_retirerTamponsEco\(\)/);
});

test('une visionneuse liberee recoit un tampon, retire quand les visionneuses reviennent', () => {
  const { ctx, racine } = charge();
  const v = visionneuse(racine);
  const gl = fauxGl();
  ctx.window.__fabGlSuivis = [{ cv: { deref: () => v.cv }, gl: { deref: () => gl } }];
  ctx.WeakRef = class { constructor(x) { this.x = x; } deref() { return this.x; } };
  vm.runInContext('globalThis.WeakRef = this.WeakRef', ctx);
  assert.equal(ctx.window._libererMemoireGraphique(), 1);
  const tampon = v.parent.children.find((c) => c.className === 'tampon-eco');
  assert.ok(tampon, 'pas de tampon pose');
  assert.match(tampon.innerHTML, /Eco mode/);
  assert.match(tampon.innerHTML, /Viewer paused/);
  assert.equal(tampon.attrs['data-i18n-skip'], '');
  assert.equal(v.parent.style.position, 'relative', 'le parent doit etre positionne pour porter le tampon');
  assert.equal(ctx.window._restaurerMemoireGraphique(), 1);
  assert.equal(v.parent.children.filter((c) => c.className === 'tampon-eco').length, 0, 'tampon reste apres la restauration');
  assert.equal(v.parent.style.position, '', 'position d origine non rendue');
});

test('un seul tampon par visionneuse, meme si la liberation est rejouee', () => {
  const { ctx, racine } = charge();
  const v = visionneuse(racine);
  ctx.window._poserTamponEco = undefined;
  vm.runInContext('_poserTamponEco', ctx);
  const poser = vm.runInContext('_poserTamponEco', ctx);
  poser(v.cv); poser(v.cv); poser(v.cv);
  assert.equal(v.parent.children.filter((c) => c.className === 'tampon-eco').length, 1);
});

test('une visionneuse cachee ne recoit pas de tampon', () => {
  const { ctx, racine } = charge();
  const v = visionneuse(racine, [0, 0]);
  vm.runInContext('_poserTamponEco', ctx)(v.cv);
  assert.equal(v.parent.children.filter((c) => c.className === 'tampon-eco').length, 0);
});

test('un parent deja positionne garde sa position', () => {
  const { ctx, racine } = charge();
  const v = visionneuse(racine, [400, 300], 'absolute');
  vm.runInContext('_poserTamponEco', ctx)(v.cv);
  assert.equal(v.parent.style.position, 'absolute');
  vm.runInContext('_retirerTamponsEco', ctx)();
  assert.equal(v.parent.style.position, 'absolute', 'la position d un parent deja positionne ne doit pas etre effacee');
});

test('le filet de 5 s pose le tampon sur une visionneuse affichee apres la liberation', () => {
  assert.match(texte, /else if \(_genEco\.size && _glLiberes\.length\)[\s\S]{0,300}isContextLost\(\)\) _poserTamponEco\(cv\)/);
});

test('le style du tampon existe et les deux textes sont traduits dans les 5 langues (bureau et site)', () => {
  const css = fs.readFileSync(path.join(RACINE, 'src', 'renderer', 'styles', 'index2.css'), 'utf8');
  assert.match(css, /\.tampon-eco\s*\{[^}]*pointer-events:\s*none/);
  for (const copie of [['src', 'renderer', 'lang', '_additions6.js'], ['cloud', 'public', 'app', 'lang', '_additions6.js']]) {
    const t = fs.readFileSync(path.join(RACINE, ...copie), 'utf8');
    for (const cle of ['Viewer paused: memory given to the generation.', 'It comes back when the generation is done.']) {
      const m = new RegExp('"' + cle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '": \\[([^\\]]*)\\]').exec(t);
      assert.ok(m, cle + ' absent de ' + copie.join('/'));
      assert.equal(m[1].split('", "').length, 5, cle + ' : 5 langues attendues');
    }
  }
});
