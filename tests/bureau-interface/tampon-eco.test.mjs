// Tampon « mode eco » sur les visionneuses 3D dont le contexte WebGL est libere pendant une generation (2026-10-19) : src/renderer/index2.js.
// Execute le VRAI code (bloc entre les reperes TAMPON ECO et les fonctions _libererMemoireGraphique / _restaurerMemoireGraphique) dans un faux DOM.
// Le faux contexte WebGL suit la SPECIFICATION : `getExtension` rend NULL sur un contexte perdu, et un contexte perdu ne revient que si l'evenement
// `webglcontextlost` a ete « default prevented ». C'est ce qui rendait la restauration muette : les visionneuses restaient BLANCHES apres la generation.
// Autres exemplaires (preuve d'echec sur l'ancien code) : INDEX2=<chemin d'un index2.js>, VIEWER3D=<chemin d'un Viewer3D.js>.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = process.env.INDEX2 || path.join(RACINE, 'src', 'renderer', 'index2.js');
const SRC_VIEWER = process.env.VIEWER3D || path.join(RACINE, 'src', 'renderer', 'lib', 'Viewer3D.js');
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
    tag, children: [], parentElement: null, style: {}, dataset: {}, attrs: {}, className: '', innerHTML: '', offsetWidth: 400, offsetHeight: 300, ecouteurs: [],
    setAttribute(k, v) { this.attrs[k] = v; },
    appendChild(c) { c.parentElement = this; this.children.push(c); return c; },
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((x) => x !== this); this.parentElement = null; },
    querySelector(sel) { const m = /^:scope > \.(.+)$/.exec(sel); return m ? this.children.find((c) => c.className === m[1]) || null : null; },
    addEventListener(type, fn, opts) { this.ecouteurs.push({ type, fn, once: !!(opts && opts.once) }); },
    declencher(type) {
      const evt = { type, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
      for (const l of this.ecouteurs.filter((x) => x.type === type)) { l.fn(evt); if (l.once) this.ecouteurs = this.ecouteurs.filter((x) => x !== l); }
      return evt;
    },
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
  const minuteurs = []; const evenements = [];
  const window = { dispatchEvent: (e) => { evenements.push(e.type); return true; } };
  const ctx = {
    document, getComputedStyle: (el) => ({ position: el.style.position || 'static' }), _i18nT: (s) => s, showToast() {}, setInterval() {},
    setTimeout: (fn, ms) => { minuteurs.push({ fn, ms }); return minuteurs.length; }, Event: class { constructor(type) { this.type = type; } },
    console, window, state: { jobs: [] },
  };
  vm.createContext(ctx);
  return { ctx, racine, tous, minuteurs, evenements };
}
// Contexte WebGL fidele a la specification (voir l'en-tete) ; l'evenement part sur le canvas `cv`.
function fauxGl(cv, perdu = false) {
  const gl = { perdu, empeche: false, restaures: 0, isContextLost() { return gl.perdu; } };
  const ext = {
    loseContext() { if (gl.perdu) return; gl.perdu = true; gl.empeche = cv.declencher('webglcontextlost').defaultPrevented; },
    restoreContext() { if (!gl.perdu || !gl.empeche) return; gl.perdu = false; gl.restaures++; cv.declencher('webglcontextrestored'); },
  };
  gl.getExtension = (nom) => (nom === 'WEBGL_lose_context' && !gl.perdu ? ext : null);
  return gl;
}
function visionneuse(racine, offset = [400, 300], position) {
  const parent = faitElement('div'); if (position) parent.style.position = position;
  const cv = faitElement('canvas'); cv.offsetWidth = offset[0]; cv.offsetHeight = offset[1];
  racine.appendChild(parent); parent.appendChild(cv);
  return { parent, cv };
}
function suivre(ctx, ...paires) {
  ctx.window.__fabGlSuivis = paires.map(({ cv, gl }) => ({ cv: { deref: () => cv }, gl: { deref: () => gl } }));
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
  const gl = fauxGl(v.cv);
  suivre(ctx, { cv: v.cv, gl });
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

test('le contexte WebGL REVIENT vraiment apres la generation (sinon la visionneuse reste blanche)', () => {
  const { ctx, racine } = charge();
  const v = visionneuse(racine);
  const gl = fauxGl(v.cv);
  suivre(ctx, { cv: v.cv, gl });
  assert.equal(ctx.window._libererMemoireGraphique(), 1);
  assert.equal(gl.perdu, true);
  assert.equal(gl.getExtension('WEBGL_lose_context'), null, 'modele : getExtension rend NULL sur un contexte perdu');
  assert.equal(gl.empeche, true, 'l evenement webglcontextlost doit etre default prevented, sinon le contexte ne peut plus revenir');
  assert.equal(ctx.window._restaurerMemoireGraphique(), 1);
  assert.equal(gl.perdu, false, 'le contexte est reste perdu : la visionneuse resterait BLANCHE');
  assert.equal(gl.restaures, 1);
  assert.equal(ctx.window._restaurerMemoireGraphique(), 0, 'une seconde restauration ne doit plus rien trouver');
});

test('plusieurs visionneuses : toutes reviennent, une seule perdue pour une autre cause n est pas touchee', () => {
  const { ctx, racine } = charge();
  const a = visionneuse(racine); const b = visionneuse(racine); const c = visionneuse(racine);
  const ga = fauxGl(a.cv); const gb = fauxGl(b.cv); const gc = fauxGl(c.cv, true);   // c : deja perdue (pilote) avant la liberation
  suivre(ctx, { cv: a.cv, gl: ga }, { cv: b.cv, gl: gb }, { cv: c.cv, gl: gc });
  assert.equal(ctx.window._libererMemoireGraphique(), 2);
  assert.equal(c.parent.children.filter((x) => x.className === 'tampon-eco').length, 0, 'tampon sur une visionneuse que le mode eco n a pas liberee');
  assert.equal(ctx.window._restaurerMemoireGraphique(), 2);
  assert.deepEqual([ga.perdu, gb.perdu, gc.perdu], [false, false, true]);
});

test('apres la restauration, les visionneuses sont reveillees par un evenement resize (gros maillages : rendu sur activite seulement)', () => {
  const { ctx, racine, minuteurs, evenements } = charge();
  const v = visionneuse(racine);
  suivre(ctx, { cv: v.cv, gl: fauxGl(v.cv) });
  ctx.window._libererMemoireGraphique();
  assert.equal(minuteurs.length, 0);
  ctx.window._restaurerMemoireGraphique();
  assert.deepEqual(minuteurs.map((m) => m.ms), [300, 1200]);
  minuteurs.forEach((m) => m.fn());
  assert.deepEqual(evenements, ['resize', 'resize']);
});

test('rien a restaurer : aucun reveil, et une visionneuse disparue entre-temps ne fait pas planter', () => {
  const { ctx, minuteurs } = charge();
  assert.equal(ctx.window._restaurerMemoireGraphique(), 0);
  vm.runInContext('_glLiberes.push({ gl: { deref: () => undefined }, ext: { deref: () => undefined } })', ctx);
  assert.equal(ctx.window._restaurerMemoireGraphique(), 0);
  assert.equal(minuteurs.length, 0);
  assert.equal(vm.runInContext('_glLiberes.length', ctx), 0);
});

test('un seul tampon par visionneuse, meme si la liberation est rejouee', () => {
  const { ctx, racine } = charge();
  const v = visionneuse(racine);
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

test('Viewer3D refabrique sa carte d environnement quand le contexte revient (sinon un maillage metallique rend NOIR)', () => {
  // Mesure en navigateur (2026-10-19, banc : contexte perdu puis restaure) : sans cela le contexte revenait mais le modele restait noir, car la carte PMREM
  // est une texture DESSINEE sur la carte graphique, que three.js ne peut pas rebatir seul ; avec, 1,4 % de pixels d'objet avant ET apres.
  const v = fs.readFileSync(SRC_VIEWER, 'utf8').replace(/\r\n/g, '\n');
  assert.match(v, /this\.canvas\.addEventListener\('webglcontextrestored',\s*this\._surContexteRestaure\)/, 'aucun ecouteur de restauration du contexte');
  const corps = /this\._surContexteRestaure = \(\) => \{([\s\S]*?)\n      \};/.exec(v);
  assert.ok(corps, 'corps de l ecouteur introuvable');
  assert.match(corps[1], /setTimeout\(/, 'doit etre differe : un renderer pose apres celui-ci sur le meme canvas se re-initialise d abord');
  assert.match(corps[1], /isContextLost\(\)/, 'rien a refaire tant que le contexte n est pas revenu');
  assert.match(corps[1], /this\.rebuildEnvironment\(\)/);
  assert.match(corps[1], /_forceRendu = true/, 'un gros maillage ne se redessine que sur activite : il faut forcer le rendu');
  assert.match(v, /removeEventListener\('webglcontextrestored',\s*this\._surContexteRestaure\)/, 'dispose() doit retirer l ecouteur');
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
