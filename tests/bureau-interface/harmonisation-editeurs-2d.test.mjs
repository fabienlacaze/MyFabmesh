// 25/10 : HARMONISATION DES VISUALISEURS 2D (site + bureau). Une regle de taille par famille (variables CSS), un emplacement et un ordre
// uniques pour les boutons des editeurs 2D, schema de souris commun (clic droit maintenu = deplacer), zoom dans la visionneuse 2D.
// Lit les deux exemplaires de l'interface : tout ecart entre site et bureau, ou retour a l'ancien code, fait echouer ce test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lire = (r) => readFileSync(join(RACINE, r), 'utf-8').replace(/\r\n/g, '\n');
const CIBLES = {
  bureau: { css: 'src/renderer/styles/index2.css', html: 'src/renderer/index2.html', js: 'src/renderer/index2.js', outils: 'src/renderer/index2-edit-tools.js' },
  site: { css: 'cloud/public/app/styles/index2.css', html: 'cloud/public/app/index.html', js: 'cloud/public/app/index2.js', outils: 'cloud/public/app/index2-edit-tools.js' },
};

// Ordre des boutons (hors reglages propres a l'outil) : [reglages] | [zoom] | [historique] | [reinitialiser]
const EDITEURS = {
  'mask-modal': ['mask-brush-mode', 'mask-eraser-mode', '|', 'mask-loupe-toggle', 'mask-recenter', '|', 'mask-undo', 'mask-redo', '|', 'mask-clear'],
  'clone-modal': ['clone-flip-toggle', 'clone-source-toggle', '|', 'clone-loupe-toggle', 'clone-recenter', '|', 'clone-undo', 'clone-redo', '|', 'clone-reset'],
  'select-modal': ['select-cut', 'select-copy', 'select-delete', 'select-drop', 'select-deselect', '|', 'select-mode-rect', 'select-mode-lasso', '|',
    'select-loupe-toggle', 'select-recenter', '|', 'select-undo', 'select-redo'],
  'modal-blur': ['blur-mode-blur', 'blur-mode-sharpen', '|', 'blur-loupe-toggle', 'blur-fit', '|', 'blur-undo', 'blur-redo', '|', 'blur-reset'],
  'modal-crop': ['crop-preset-free', 'crop-preset-1-1', 'crop-preset-4-3', 'crop-preset-16-9', 'crop-preset-center', 'crop-loupe-toggle', 'crop-recenter', 'crop-undo', 'crop-redo'],   // LOT W03 : colonne de droite, groupes titres (reglages, vue, historique) sans separateur
  'modal-symmetrize': ['sym-loupe-toggle', 'sym-recenter', '|', 'sym-undo', 'sym-redo', '|', 'sym-reset'],
  'modal-paint': ['paint-emissive-toggle', '|', 'paint-loupe-toggle', 'paint-recenter', '|', 'paint-undo', 'paint-redo', '|', 'paint-reset'],
};
const TITRES = [[/-loupe-toggle$/, 'Magnifier'], [/-(recenter|fit)$/, 'Fit to view'], [/-undo$/, 'Undo'], [/-redo$/, 'Redo'],
  [/^(mask-clear|clone-reset|blur-reset|sym-reset|paint-reset)$/, 'Reset']];

function bloc(html, id) {
  const i = html.search(new RegExp('<div id="' + id + '" class="modal'));
  assert.ok(i >= 0, 'fenetre introuvable : ' + id);
  const m = /\n\s*<div id="[a-z-]+" class="modal/.exec(html.slice(i + 10));
  return html.slice(i, m ? i + 10 + m.index : html.length);
}
// Suite ordonnee de boutons et de separateurs d'une fenetre
function suite(b, ids) {
  const out = [];
  const re = /<button id="([^"]+)"|class="vz-sep"|class="fen-groupe-btns"/g;
  let m;
  while ((m = re.exec(b))) {
    if (m[1]) { if (ids.includes(m[1])) out.push(m[1]); } else if (out.length && out[out.length - 1] !== '|') out.push('|');
  }
  while (out[out.length - 1] === '|') out.pop();
  return out;
}
const fontSize = (css, sel) => {
  const re = new RegExp('(^|\\n)' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{[^}]*?font-size: *([\\d.]+)px', 's');
  const m = re.exec(css); return m ? m[2] : null;
};

for (const [nom, c] of Object.entries(CIBLES)) {
  const css = lire(c.css), html = lire(c.html), js = lire(c.js), outils = lire(c.outils);

  test(`${nom} : une variable CSS par famille de visualiseur, hauteur du visualiseur principal pilotee par --vz-h-principal`, () => {
    for (const v of ['--vz-h-principal: 440px', '--vz-h-fenetre:', '--vz-editeur-w: 95vw', '--vz-editeur-h: 95vh', '--vz-editeur-zone-min: 400px',
      '--vz-source-min: 240px', '--vz-vignette-h: 200px', '--vz-pub-thumb: 84px', '--lb-colonne: 252px']) assert.ok(css.includes(v), 'variable manquante : ' + v);
    assert.match(css, /\.step-card-preview \{[^}]*height: var\(--vz-h-principal\)/s);
    assert.match(css, /\.step-card-preview\.large \{\s*height: var\(--vz-h-principal\)/);
    assert.doesNotMatch(css, /\.step-card-preview \{[^}]*height: 440px/s, 'hauteur 440px recodee en dur');
    assert.match(css, /@media \(max-width: 900px\) \{\s*:root \{ --vz-h-principal: min\(440px, 56vh\)/);
    assert.match(css, /@media \(max-width: 760px\)[\s\S]*--vz-apercu-min: 260px/);
    assert.match(css, /@media \(hover: none\)[\s\S]*\.preview-expand-btn[\s\S]*opacity: 1/);
  });

  test(`${nom} : la colonne d'outils de la visionneuse 2D vient de --lb-colonne (image, marge, colonne)`, () => {
    assert.match(css, /max-width: calc\(92vw - var\(--lb-colonne\) - 38px\)/);
    assert.match(css, /margin-right: calc\(var\(--lb-colonne\) \+ 18px\)/);
    assert.match(css, /\.lb-toolbox \{[^}]*width: var\(--lb-colonne\)/s);
    assert.match(css, /#lightbox-2-bottom \{[^}]*bottom: 24px/s);
  });

  test(`${nom} : editeurs 2D, ordre unique des boutons (reglages | zoom | historique | reinitialiser) et info-bulles uniques`, () => {
    for (const [id, attendu] of Object.entries(EDITEURS)) {
      const b = bloc(html, id);
      assert.deepEqual(suite(b, attendu.filter((x) => x !== '|')), attendu, id);
      for (const bid of attendu.filter((x) => x !== '|')) {
        for (const [re, titre] of TITRES) {
          if (re.test(bid)) assert.match(b, new RegExp('<button id="' + bid + '"[^>]*title="' + titre + '"'), bid + ' : info-bulle « ' + titre + ' »');
        }
      }
    }
  });

  test(`${nom} : plus de largeur minimale fixe de 600 px dans les editeurs 2D, Color Picker en fenetre 95vw x 95vh`, () => {
    for (const id of Object.keys(EDITEURS).concat(['modal-colorpick'])) {
      assert.doesNotMatch(bloc(html, id).split('\n').slice(0, 3).join('\n'), /min-width: *600px/, id);
    }
    const cp = bloc(html, 'modal-colorpick');
    assert.match(cp, /id="modal-colorpick" class="modal hidden"/);
    assert.match(cp, /class="modal-content" style="width:var\(--vz-editeur-w\); height:var\(--vz-editeur-h\)/);
    assert.match(css, /@media \(max-width: 760px\)[\s\S]*#modal-colorpick \.modal-content[\s\S]*100dvh/);
  });

  test(`${nom} : Draw Mask et Clone ont une aide sur une ligne ; Blur annonce le clic droit`, () => {
    assert.match(html, /<h2>Draw Mask \(paint the area to replace or remove\)<\/h2>/);
    assert.match(html, /Left: paint - Right: erase - Wheel: zoom - Middle\/Alt: pan/);
    assert.match(html, /Ctrl\+click: source - Left: clone - Right-drag: pan/);
    assert.match(html, /Left: blur or sharpen - Right-drag: pan - Wheel: zoom/);
    assert.doesNotMatch(html, /Create variant<\/h2>/);
  });

  test(`${nom} : clic droit maintenu = deplacer dans Blur, Paint, Symmetrize, Select, Clone ; la loupe de Select est branchee`, () => {
    const blur = js.slice(js.indexOf("blur-loupe-toggle'),"), js.indexOf("blur-loupe-toggle'),") + 400);
    assert.match(blur, /rightClickPan: true/);
    assert.match(js, /document\.getElementById\('blur-fit'\)\?\.addEventListener\('click'/);
    const paint = js.slice(js.indexOf("paint-loupe-toggle'),"), js.indexOf("paint-loupe-toggle'),") + 400);
    assert.match(paint, /rightClickPan: true/);
    assert.match(js, /e\.button === 1 \|\| e\.button === 2 \|\| \(e\.button === 0 && e\.altKey\)/);
    assert.match(js, /_symOverlay\.addEventListener\('mousedown', \(e\) => \{\s*if \(e\.button !== 0 \|\| e\.altKey\) return;/);
    assert.match(outils, /loupeBtn: document\.getElementById\('select-loupe-toggle'\),\s*rightClickPan: true/);
    assert.match(outils, /rightClickPan: true/);
  });

  test(`${nom} : Crop a annuler / refaire (20 niveaux), recentrer et loupe`, () => {
    assert.match(js, /function _cropPush\(\)/);
    assert.match(js, /cropState\.hist\.length > 20/);
    for (const id of ['crop-undo', 'crop-redo', 'crop-recenter', 'crop-loupe-toggle']) {
      assert.ok(js.includes("getElementById('" + id + "')"), id);
    }
  });

  test(`${nom} : visionneuse 2D, zoom molette x1.15 (0.2 a 10), deplacement clic droit, boutons Fit et 100 %, frise des etapes`, () => {
    assert.match(js, /function _lbZoomAt\(f, cx, cy\)/);
    assert.match(js, /Math\.max\(0\.2, Math\.min\(10, _lbView\.z \* f\)\)/);
    assert.match(js, /e\.deltaY < 0 \? 1\.15 : 1 \/ 1\.15/);
    assert.match(js, /e\.button !== 2/);
    assert.match(js, /_lbView\.dist > 4/);
    assert.match(js, /if \(_lbView\.bloque\)/);
    assert.match(html, /id="lightbox-2-fit" class="mv-btn"/);
    assert.match(html, /id="lightbox-2-actual" class="mv-btn"/);
    assert.match(html, /<div id="lb-stages-bar" class="stages-bar hidden" style="bottom:60px;"><\/div>/);
    assert.match(js, /function _renderLbStagesBar\(stages\)/);
    // fleches et Echap inchangees
    assert.match(js, /e\.key === 'Escape'\) closeLightbox\(\)/);
    assert.match(js, /e\.key === 'ArrowLeft'\) lightboxShowAt\(_lightboxIndex - 1\)/);
  });

  test(`${nom} : les nouveaux textes d'aide sont traduits dans les 5 langues`, () => {
    const t = lire(c.css.startsWith('src') ? 'src/renderer/lang/_additions6.js' : 'cloud/public/app/lang/_additions6.js');
    for (const k of ['Fit', 'Fit to view', 'Actual size (100%)', 'Left: paint - Right: erase - Wheel: zoom - Middle/Alt: pan',
      'Ctrl+click: source - Left: clone - Right-drag: pan - Wheel: zoom', 'Left: blur or sharpen - Right-drag: pan - Wheel: zoom']) {
      const m = t.match(new RegExp('\\n\\s*' + JSON.stringify(k).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ': \\[(.*)\\],'));
      assert.ok(m, 'traduction manquante : ' + k);
      assert.equal(JSON.parse('[' + m[1] + ']').length, 5, k);
    }
  });
}

test('site et bureau : memes ordres de boutons dans les editeurs 2D, memes polices de barre, memes tailles', () => {
  const h = { bureau: lire(CIBLES.bureau.html), site: lire(CIBLES.site.html) };
  for (const [id, attendu] of Object.entries(EDITEURS)) {
    const ids = attendu.filter((x) => x !== '|');
    assert.deepEqual(suite(bloc(h.site, id), ids), suite(bloc(h.bureau, id), ids), id);
  }
  const css = { bureau: lire(CIBLES.bureau.css), site: lire(CIBLES.site.css) };
  for (const sel of ['.mv-btn', '.nav-counter', '.lb-tool-btn', '.lb-toolbox-group-label', '.viewer-filename', '#lightbox-2-filename', '.fen-label', '.fen-valeur', '.fen-note', '.fen-echelle']) {
    assert.equal(fontSize(css.site, sel), fontSize(css.bureau, sel), 'police de ' + sel);
  }
  // polices en ligne des editeurs 2D : memes valeurs des deux cotes
  for (const id of Object.keys(EDITEURS).concat(['modal-colorpick'])) {
    const tailles = (s) => (bloc(s, id).match(/font-size: *[\d.]+px/g) || []).map((x) => x.replace(/\s/g, ''));
    assert.deepEqual(tailles(h.site), tailles(h.bureau), 'polices de ' + id);
  }
  assert.match(css.site, /#modal-recolor \.modal-with-image \{ grid-template-columns: minmax\(400px, 1\.2fr\) 1fr; \}/);
});
