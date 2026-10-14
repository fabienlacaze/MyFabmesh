// INTEGRATION DU 14/10/2026 (branche integration-1410) : interactions CROISEES entre les lots fusionnes, sur les VRAIS fichiers.
// Chaque lot avait ses tests ; ce fichier verifie ce qu'aucun ne voyait seul, avec le VRAI i18n.js et les VRAIS dictionnaires
// (charges dans l'ordre de la page, DOM minimal tests/_dom-minimal.mjs ; aucun navigateur, aucun reseau) :
//  1. etat des services Modal (leviers-modal-etat) x interface multilingue (lot-interface-langue) : la ligne d'age du panneau
//     « Cloud services » (« Last known state, N s old », ajoutee par le levier L8) est traduite dans les 5 langues. Ecrite en
//     gabarit `${…}`, elle restait en anglais partout, et la garde des traductions ne la mesurait pas (CORRIGE ici : _tf +
//     entree de lang/_additions6.js).
//  2. noms de projet non latins (lot-noms-langue) x interface multilingue : dans la VRAIE grille des projets (bureau et site),
//     les libelles autour des noms sont traduits mais AUCUN nom n'est traduit ni entoure de caracteres d'isolation, y compris
//     un projet nomme comme un libelle (« Settings ») et le nom SAISI d'un dossier non latin du bureau ; les messages qui
//     citent un nom (suppression, projet introuvable) gardent le nom tel quel. (CONTROLE : aucun defaut trouve.)
// Lancer : cd cloud && node --test tests/integration-1410.test.mjs
// Preuve sur le code fusionne SANS le correctif (1 doit echouer, 2 passer) : extraire b0dfd879 (cloud/public/app + src/renderer)
//   dans <tmp>, puis RACINE_DEPOT=<tmp> node --test tests/integration-1410.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';
import { creerPage } from './_dom-minimal.mjs';
import { zoneHtml } from '../../build/check-traductions.mjs';

const RACINE = process.env.RACINE_DEPOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const lire = (rel) => fs.readFileSync(path.join(RACINE, rel), 'utf8').replace(/\r\n/g, '\n');
const LANGUES = ['fr', 'es', 'zh', 'hi', 'ar'];
const BASE = { web: 'cloud/public/app', bureau: 'src/renderer' };
const PAGE = { web: 'cloud/public/app/index.html', bureau: 'src/renderer/index2.html' };
const ISOLATION = /[\u2066-\u2069]/;
const sansIsolation = (t) => String(t).replace(/[\u2066-\u2069]/g, '');

/** Page avec le VRAI i18n.js, les VRAIS lang/*.js et lib/textes-serveur.js de la cible, dans l'ordre de sa page. */
function page(cible, lang, html) {
  const p = creerPage({ html, stockage: { 'fabmesh.lang.choisi': lang } });
  p.executer(lire(BASE[cible] + '/i18n.js'), 'i18n.js');
  for (const m of lire(PAGE[cible]).matchAll(/<script src="(lang\/[^"]+|lib\/textes-serveur\.js)"><\/script>/g)) p.executer(lire(BASE[cible] + '/' + m[1]), m[1]);
  p.charger();
  // Ce que le DOM minimal n'a pas et que la grille des projets utilise : replaceChildren, prepend, selecteur descendant
  // (« .project-card-thumb img »), querySelectorAll d'un fragment.
  const protoEl = Object.getPrototypeOf(p.document.createElement('div'));
  if (!protoEl.__integration1410) {
    const qsa = protoEl.querySelectorAll;
    protoEl.querySelectorAll = function (sel) {
      const parts = String(sel).trim().split(/\s+/);
      if (parts.length < 2 || String(sel).includes(',')) return qsa.call(this, sel);
      const anc = parts.slice(0, -1).join(' ');
      return qsa.call(this, parts[parts.length - 1]).filter((e) => {
        for (let x = e.parentNode; x && x !== this; x = x.parentNode) if (x.nodeType === 1 && x.matches(anc)) return true;
        return false;
      });
    };
    protoEl.replaceChildren = function (...ns) { for (const c of [...this.childNodes]) this._retirer(c); for (const n of ns) this.appendChild(n); };
    protoEl.prepend = function (...ns) { const ref = this.firstChild; for (const n of ns) this.insertBefore(typeof n === 'string' ? this.ownerDocument.createTextNode(n) : n, ref); };
    const protoFrag = Object.getPrototypeOf(p.document.createDocumentFragment());
    protoFrag.querySelectorAll = function (sel) {
      const r = [];
      for (const c of this.childNodes) if (c.nodeType === 1) { if (!String(sel).includes(' ') && c.matches(sel)) r.push(c); r.push(...c.querySelectorAll(sel)); }
      return r;
    };
    protoEl.__integration1410 = true;
  }
  return p;
}

/** Declarations de PREMIER niveau d'un module (fonctions, const/let/var), par nom -> texte source. */
function declarationsModule(src) {
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
  const m = new Map();
  for (const n of ast.body) {
    if (n.type === 'FunctionDeclaration' && n.id) m.set(n.id.name, src.slice(n.start, n.end));
    else if (n.type === 'VariableDeclaration') for (const d of n.declarations) if (d.id.type === 'Identifier') m.set(d.id.name, src.slice(n.start, n.end));
  }
  return { m, ast };
}
/** Fonction affectee a `window.<nom>` n'importe ou dans le module, ou null. */
function affectationWindow(src, ast, nom) {
  let trouve = null;
  (function visiter(n) {
    if (!n || typeof n.type !== 'string' || trouve) return;
    if (n.type === 'AssignmentExpression' && n.left.type === 'MemberExpression' && n.left.object && n.left.object.name === 'window'
        && n.left.property && n.left.property.name === nom) { trouve = src.slice(n.right.start, n.right.end); return; }
    for (const k of Object.keys(n)) { const v = n[k]; if (Array.isArray(v)) v.forEach(visiter); else if (v && typeof v.type === 'string') visiter(v); }
  })(ast);
  return trouve;
}

/* ═══════════════════════ 1. ETAT DES SERVICES MODAL x INTERFACE ═══════════════════════ */

/** Le VRAI _pollModalStatus de cloud-overrides.js (et les aides _t / _tf de ce fichier quand il les a), monte dans la page. */
function monterPanneau(p, corps) {
  const src = fs.readFileSync(process.env.WEB_OVERRIDES || path.join(RACINE, 'cloud/public/app/cloud-overrides.js'), 'utf8').replace(/\r\n/g, '\n');
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true });
  const voulus = new Map();
  (function visiter(n) {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'FunctionDeclaration' && n.id && n.id.name === '_pollModalStatus' && !voulus.has('_pollModalStatus')) voulus.set('_pollModalStatus', n);
    for (const nom of ['_modalStatusTimer', '_t', '_tf']) {
      if (n.type === 'VariableDeclaration' && n.declarations.some((d) => d.id && d.id.name === nom) && !voulus.has(nom)) voulus.set(nom, n);
    }
    for (const k of Object.keys(n)) { const v = n[k]; if (Array.isArray(v)) v.forEach(visiter); else if (v && typeof v.type === 'string') visiter(v); }
  })(ast);
  assert.ok(voulus.has('_pollModalStatus'), '_pollModalStatus introuvable dans cloud-overrides.js');
  const code = [...voulus.values()].sort((a, b) => a.start - b.start).map((n) => src.slice(n.start, n.end)).join('\n');
  p.fenetre.fetch = async () => ({ ok: true, json: async () => corps });
  p.executer('(function () {\n' + code + '\nwindow.__sonderPanneau = _pollModalStatus;\n})();', 'cloud-overrides.extrait.js');
}

const ETAT_VIEUX = { image_op: { warm: true, reel: true, etat: 'warm' }, mesh: { warm: false, etat: 'cold', reel: true }, etat_reel_age_s: 75 };
const ANGLAIS_AGE = 'Last known state, 75 s old';

test('etat Modal x interface : la ligne d age du panneau « Cloud services » est TRADUITE dans les 5 langues (et intacte en anglais)', async () => {
  const zone = zoneHtml(lire(PAGE.web), 'gpu-warmup-wrap');
  assert.ok(zone && zone.includes('id="gpu-warmup-age"'), 'panneau « Cloud services » ou sa ligne d age introuvable dans index.html');
  const restes = [];
  for (const L of ['en', ...LANGUES]) {
    const p = page('web', L, zone);
    await p.attendre();
    monterPanneau(p, ETAT_VIEUX);
    await p.fenetre.__sonderPanneau(false);
    await p.attendre();
    const age = p.document.getElementById('gpu-warmup-age');
    assert.equal(age.style.display, 'block', `${L} : etat de 75 s, la ligne d age doit etre visible`);
    const texte = age.textContent;
    assert.ok(texte.includes('75'), `${L} : l age (75 s) doit figurer : ${JSON.stringify(texte)}`);
    if (L === 'en') { assert.equal(texte, ANGLAIS_AGE); continue; }
    if (sansIsolation(texte) === ANGLAIS_AGE) restes.push(L);
    else assert.equal(texte, p.fenetre.FabI18n.tf('Last known state, {x} s old', 75), `${L} : texte inattendu`);
  }
  assert.deepEqual(restes, [], 'langues ou la ligne d age du panneau reste en anglais');
});

/* ═══════════════════════ 2. NOMS DE PROJET x INTERFACE ═══════════════════════ */

const GRILLE_HTML = '<input id="project-search"><div id="projects-empty"></div><div id="projects-grid"></div>';
/** Projets de chaque cible : un nom qui est AUSSI un libelle du dictionnaire, un nom non latin (au bureau : dossier
 *  « project-h<empreinte> » + nom SAISI memorise), un nom accentue. `attendu` = ce que la carte doit afficher. */
const PROJETS = {
  bureau: [
    { name: 'Settings', displayName: null, attendu: 'Settings' },
    { name: 'project-hde2e0b71', displayName: '兽人战士', attendu: '兽人战士' },
    { name: 'Chateau_fort-h9a1b2c3d', displayName: 'Château fort', attendu: 'Château fort' },
    { name: 'Animation', displayName: null, attendu: 'Animation' },
  ],
  web: [
    { name: 'Settings', attendu: 'Settings' },
    { name: '兽人战士', attendu: '兽人战士' },
    { name: 'Château fort', attendu: 'Château fort' },
    { name: 'Animation', attendu: 'Animation' },
  ],
};

/** Monte la VRAIE renderProjectsGrid (et window.openProjectByName du site) de la cible, avec ses aides reelles. */
function monterGrille(cible, p) {
  const src = lire(BASE[cible] + '/index2.js');
  const { m, ast } = declarationsModule(src);
  const reelles = ['escapeHtml', '_estNomAscii', '_nomsEquivalents', '_projetDuNom', '_nomSaisiDuProjet', '_i18nT', '_i18nTf', 'renderProjectsGrid'];
  for (const n of ['escapeHtml', 'renderProjectsGrid', '_i18nTf']) assert.ok(m.has(n), `${cible} : ${n} introuvable`);
  const ouvrir = affectationWindow(src, ast, 'openProjectByName');
  const code = [
    'var state = window.__etat; var avis = window.__avis;',
    'var API = { getParentalStatus: async () => ({ unrestricted: true }) };',
    'let _renderProjectsGen = 0; let _homeView = "projects";',
    'function renderProjectsBulkBar() {} function _syncSelectAllBtn() {} function _updateHomeViewCounts() {}',
    'function renderAllImagesGrid() {} function renderAllMeshesGrid() {} function renderAllRigsGrid() {}',
    'function openNewProjectModal() {} async function openProject(pr) { window.__ouverts.push(pr.name); }',
    'async function refreshProjectsPage() {} function renderImageVersions() {} function renderMeshVersions() {}',
    'async function _nsfwRaison() { return null; } function _nsfwAvertirMasques() {} function _toFileUrl(x) { return String(x); }',
    'function showToast(t) { avis.push(String(t)); } async function customConfirm(t) { avis.push(String(t)); return false; }',
    'async function customPrompt() { return null; }',
    ...reelles.filter((n) => m.has(n)).map((n) => m.get(n)),
    'window.__grille = renderProjectsGrid;',
    ouvrir ? 'window.__ouvrirParNom = (' + ouvrir + ');' : '',
  ].join('\n');
  p.fenetre.__etat = { projects: PROJETS[cible].map((x) => ({ name: x.name, displayName: x.displayName ?? null, images: [], meshes: [], rigs: [], animations: [] })), jobs: [] };
  p.fenetre.__avis = [];
  p.fenetre.__ouverts = [];
  p.executer('(function () {\n' + code + '\n})();', `${cible}-index2.extrait.js`);
}

for (const cible of ['bureau', 'web']) {
  test(`noms x interface (${cible}) : la VRAIE grille des projets traduit ses libelles et jamais un nom de projet, dans les 5 langues`, async () => {
    for (const L of LANGUES) {
      const p = page(cible, L, GRILLE_HTML);
      await p.attendre();
      monterGrille(cible, p);
      await p.fenetre.__grille();
      await p.attendre();
      const grille = p.document.getElementById('projects-grid');
      const cartes = grille.querySelectorAll('.project-card').filter((c) => !c.classList.contains('new-card'));
      assert.equal(cartes.length, PROJETS[cible].length, `${cible}/${L} : ${cartes.length} cartes`);
      const noms = cartes.map((c) => {
        const bloc = c.querySelector('.project-card-name');
        const span = bloc && bloc.querySelector('span');
        return (span || bloc).textContent;
      });
      assert.deepEqual(noms, PROJETS[cible].map((x) => x.attendu), `${cible}/${L} : un nom de projet a ete traduit ou modifie`);
      for (const n of noms) assert.ok(!ISOLATION.test(n), `${cible}/${L} : caracteres d isolation autour de ${JSON.stringify(n)}`);
      // les libelles AUTOUR des noms, eux, sont traduits
      const I = p.fenetre.FabI18n;
      const titre = cartes[0].querySelector('.card-delete-btn').getAttribute('title');
      assert.notEqual(titre, 'Delete project', `${cible}/${L} : bulle « Delete project » restee en anglais`);
      assert.equal(titre, I.t('Delete project'));
      const nouvelle = grille.querySelector('.new-card').textContent.replace(/\s+/g, ' ').trim();
      assert.ok(!/Create a new project/.test(nouvelle), `${cible}/${L} : « Create a new project » reste en anglais : ${nouvelle}`);
      // message qui cite un nom (suppression) : gabarit traduit, nom insere tel quel (isole en arabe, jamais traduit)
      for (const x of PROJETS[cible]) {
        const t = I.tf('Delete project "{x}" and all its files?', x.attendu);
        assert.notEqual(t, `Delete project "${x.attendu}" and all its files?`, `${cible}/${L} : message de suppression non traduit`);
        assert.ok(sansIsolation(t).includes(x.attendu), `${cible}/${L} : nom modifie dans ${JSON.stringify(t)}`);
      }
    }
  });
}

test('noms x interface (site) : « projet introuvable » est traduit et cite le nom demande tel quel (non latin compris)', async () => {
  for (const L of LANGUES) {
    const p = page('web', L, GRILLE_HTML);
    await p.attendre();
    monterGrille('web', p);
    assert.equal(typeof p.fenetre.__ouvrirParNom, 'function', 'window.openProjectByName introuvable');
    for (const demande of ['精灵射手', '____', 'Settings 2']) {
      p.fenetre.__avis.length = 0;
      await p.fenetre.__ouvrirParNom(demande);
      assert.deepEqual(p.fenetre.__ouverts, [], `${L} : « ${demande} » ne doit ouvrir aucun projet`);
      assert.equal(p.fenetre.__avis.length, 1, `${L} : un avis attendu pour « ${demande} »`);
      const avis = p.fenetre.__avis[0];
      assert.notEqual(avis, `Project "${demande}" not found`, `${L} : avis reste en anglais`);
      assert.ok(sansIsolation(avis).includes(demande), `${L} : nom demande modifie dans ${JSON.stringify(avis)}`);
    }
  }
});
