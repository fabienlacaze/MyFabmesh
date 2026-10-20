// Option « relief pour moteur de jeu » (case « Game-engine relief (normal map) », 2026-10-15) — INTERFACE, bureau ET site, et leur PARITE.
//
// Decision du proprietaire (15/10) : la carte de normales (plafonnee a 2048 px) est une OPTION par generation, DECOCHEE par defaut, gratuite,
// presente dans les options avancees de la creation 3D du bureau comme du site. Ce fichier verifie, sur les VRAIS fichiers des deux
// interfaces (aucune page lancee, aucun reseau, aucun GPU) :
//   - la case existe une seule fois par page, decochee, dans <details id="ws-3d-trellis2-opts">, avec le MEME libelle et la MEME infobulle ;
//   - la page la lit en booleen STRICT (`?.checked === true`) et la transmet : bureau `trellis2NormalMap`, site `normal_map` ;
//   - elle n'est ni forcee / masquee par ASSET_OPTIONS_PROFILE, ni declaree morte (_OPTIONS_MORTES_CLOUD, __optionsMortesCloud), ni rangee
//     parmi les reglages automatiques (_AUTO3D_OPTIONS) : c'est un choix d'EXPORT, jamais deduit de l'image ;
//   - elle est traduite dans les 5 langues, dictionnaires du bureau et du site identiques, et la GARDE DE TRADUCTION build/check-traductions.mjs
//     REFUSE un arbre ou ces traductions manquent (preuve sur une copie) ;
//   - aucun nom de moteur dans le texte visible.
// Lancer : node --test tests/bureau-interface/option-normales-interface.test.mjs
// Preuve d'echec sur l'ANCIEN code : RENDERER=<dossier d'un src/renderer d'avant> SITE=<dossier d'un cloud/public/app d'avant> node --test ...
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const acorn = require('acorn');
const ici = path.dirname(fileURLToPath(import.meta.url));
const racine = path.resolve(ici, '..', '..');
const BUREAU = process.env.RENDERER || path.join(racine, 'src', 'renderer');
const SITE = process.env.SITE || path.join(racine, 'cloud', 'public', 'app');
const lire = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

const ID = 'ws-trellis2-normal-map';
const LIBELLE = 'Game-engine relief (normal map)';
const LIBELLE_COURT = 'Game-engine relief';
const INFOBULLE = 'Adds a normal map to the exported model: the fine relief of the detailed shape (skin, muscles, cloth folds) is baked into a texture of at most 2048px that game engines use for lighting. Off by default; adds a few MB to the file. The difference is subtle in a plain viewer.';
const LECTURE = "document.getElementById('ws-trellis2-normal-map')?.checked === true";

const PAGES = [
  { nom: 'bureau', dossier: BUREAU, html: 'index2.html', js: 'index2.js' },
  { nom: 'site', dossier: SITE, html: 'index.html', js: 'index2.js' },
];

function etiquetteDeLaCase(html) {
  const debut = html.indexOf('id="' + ID + '"');
  assert.ok(debut >= 0, 'case absente de la page');
  const balise = html.slice(html.lastIndexOf('<input', debut), html.indexOf('>', debut) + 1);
  const etiquette = html.slice(html.lastIndexOf('<label', debut), html.indexOf('</label>', debut));
  return { debut, balise, etiquette, titre: (etiquette.match(/title="([^"]*)"/) || [])[1] || '', texte: etiquette.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() };
}

for (const p of PAGES) {
  test(p.nom + ' : la case existe une seule fois, DECOCHEE, dans les options avancees de la creation 3D, avant le bouton Generate 3D', () => {
    const h = lire(path.join(p.dossier, p.html));
    assert.equal((h.match(new RegExp('id="' + ID + '"', 'g')) || []).length, 1);
    const { debut, balise } = etiquetteDeLaCase(h);
    assert.match(balise, /type="checkbox"/);
    assert.ok(!/\bchecked\b/.test(balise), 'cochee par defaut : ' + balise);
    assert.ok(!/\bdisabled\b/.test(balise), balise);
    const details = h.lastIndexOf('<details', debut);
    assert.ok(details > 0 && h.slice(details, h.indexOf('>', details)).includes('id="ws-3d-trellis2-opts"'), 'pas dans <details id="ws-3d-trellis2-opts">');
    assert.ok(h.indexOf('</details>', debut) > debut && h.indexOf('id="ws-generate-mesh"') > debut);
  });

  test(p.nom + ' : libelle et infobulle exacts, sans nom de moteur', () => {
    const { texte, titre } = etiquetteDeLaCase(lire(path.join(p.dossier, p.html)));
    assert.equal(texte, LIBELLE);
    assert.equal(titre, INFOBULLE);
    assert.ok(!/unirig|trellis|puppeteer|realvis|clipseg|skintokens|unreal|unity|godot/i.test(texte + ' ' + titre), texte + ' ' + titre);
  });

  test(p.nom + ' : la page lit la case en booleen STRICT, a un seul endroit, et la montre dans les options actives', () => {
    const s = lire(path.join(p.dossier, p.js));
    const lectures = s.match(/document\.getElementById\('ws-trellis2-normal-map'\)[^;\n]*/g) || [];
    assert.deepEqual(lectures, [LECTURE]);
    assert.match(s, /trellis2NormalMap && 'Game-engine relief'/);
    assert.match(s, /normal_map: 'Game-engine relief'/, 'fiche des parametres (historique des generations)');
    // execution de la lecture : seul un booleen vrai compte
    const lire1 = (el) => new Function('document', 'return ' + LECTURE + ';')({ getElementById: () => el });
    assert.equal(lire1({ checked: true }), true);
    for (const faux of [{ checked: false }, { checked: 'true' }, { checked: 1 }, { checked: undefined }, null, undefined]) assert.equal(lire1(faux), false, JSON.stringify(faux));
  });

  test(p.nom + ' : ni forcee ni masquee par le profil d asset, ni declaree morte, ni rangee parmi les reglages automatiques', () => {
    const s = lire(path.join(p.dossier, p.js));
    const debut = s.indexOf('const ASSET_OPTIONS_PROFILE = {');
    const fin = s.indexOf('\n};\n', debut);
    assert.ok(debut > 0 && fin > debut);
    assert.ok(!s.slice(debut, fin).includes(ID), 'ASSET_OPTIONS_PROFILE contient la case (null = masquee et forcee a off)');
    const auto = s.match(/var _AUTO3D_OPTIONS = \[([\s\S]*?)\];/);
    assert.ok(auto, '_AUTO3D_OPTIONS introuvable');
    assert.ok(!auto[1].includes(ID));
    const mortes = s.match(/var _OPTIONS_MORTES_CLOUD = \[([^\]]*)\]/);
    if (mortes) assert.ok(!mortes[1].includes(ID), 'case declaree morte en mode Cloud : elle serait decochee de force');
  });
}

test('bureau : la page envoie l option au gestionnaire sous le nom trellis2NormalMap', () => {
  const s = lire(path.join(BUREAU, 'index2.js'));
  const ast = acorn.parse(s, { ecmaVersion: 'latest', sourceType: 'module' });    // index2.js du bureau est un module ES
  let params = null;
  const visiter = (n) => {
    if (!n || typeof n !== 'object' || params) return;
    if (n.type === 'VariableDeclarator' && n.id && n.id.name === 'params' && n.init && n.init.type === 'ObjectExpression'
        && n.init.properties.some((x) => x.key && x.key.name === 'trellis2FaceFix')) { params = n.init; return; }
    for (const k of Object.keys(n)) { const v = n[k]; if (Array.isArray(v)) v.forEach(visiter); else if (v && typeof v.type === 'string') visiter(v); }
  };
  visiter(ast);
  assert.ok(params, 'objet params de la creation 3D introuvable');
  const prop = params.properties.find((x) => x.key && x.key.name === 'trellis2NormalMap');
  assert.ok(prop, 'trellis2NormalMap absent des parametres de la creation 3D : la case serait sans effet');
  assert.equal(prop.shorthand, true, 'la valeur doit etre la constante lue de la case (const trellis2NormalMap = ...checked === true)');
  assert.match(s, new RegExp('const trellis2NormalMap = ' + LECTURE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ';'));
});

test('site : la page envoie l option au serveur sous le nom normal_map (celui que le worker lit)', () => {
  const s = lire(path.join(SITE, 'index2.js'));
  assert.match(s, /normal_map:\s+trellis2NormalMap,/);
  assert.match(s, new RegExp('const trellis2NormalMap = ' + LECTURE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ';'));
});

test('parite : les deux interfaces ont le meme libelle, la meme infobulle et la meme lecture', () => {
  const [b, w] = PAGES.map((p) => etiquetteDeLaCase(lire(path.join(p.dossier, p.html))));
  assert.equal(b.texte, w.texte);
  assert.equal(b.titre, w.titre);
});

/* ═══════════════ traductions : 5 langues, dictionnaires identiques, garde de traduction ═══════════════ */

const CLES = [LIBELLE, LIBELLE_COURT, INFOBULLE];

function tableauxDe(dossier, cle) {
  const t = lire(path.join(dossier, 'lang', '_additions6.js'));
  const i = t.indexOf('"' + cle + '": [');
  assert.ok(i >= 0, 'traduction absente : ' + cle.slice(0, 50));
  const ligne = t.slice(i, t.indexOf('\n', i)).replace(/,\s*$/, '');
  // JSON : un tableau cree dans un autre contexte vm n'a pas le meme prototype (deepStrictEqual le refuserait)
  return JSON.parse(vm.runInContext('JSON.stringify(' + ligne.slice(ligne.indexOf(': [') + 2) + ')', vm.createContext({})));
}

for (const p of PAGES) {
  test(p.nom + ' : libelles et infobulle traduits dans les 5 langues (aucune vide, aucune egale a l anglais)', () => {
    for (const cle of CLES) {
      const t = tableauxDe(p.dossier, cle);
      assert.equal(t.length, 5, cle.slice(0, 50));
      t.forEach((tr, k) => {
        if (k === 0 && tr === null) return;                    // francais deja la langue de la cle courte, voir i18n.js
        assert.ok(typeof tr === 'string' && tr.trim().length > 3, 'traduction vide (langue ' + k + ') : ' + cle.slice(0, 50));
        assert.notEqual(tr, cle);
      });
    }
  });
}

test('parite : les dictionnaires du bureau et du site portent les memes traductions de l option', () => {
  for (const cle of CLES) assert.deepEqual(tableauxDe(BUREAU, cle), tableauxDe(SITE, cle), cle.slice(0, 50));
});

/** Copie minimale des fichiers que lit la garde (build/check-traductions.mjs --racine). */
function copierPourLaGarde(dest) {
  const a = (rel) => { fs.mkdirSync(path.dirname(path.join(dest, rel)), { recursive: true }); fs.cpSync(path.join(racine, rel), path.join(dest, rel), { recursive: true }); };
  for (const [dossier, base] of [['src/renderer', BUREAU], ['cloud/public/app', SITE]]) {
    const pages = ['index2.html', 'index.html', 'index2.js', 'index2-edit-tools.js', 'cloud-overrides.js', 'meshyAPI-cloud.js', 'i18n.js', 'lib/textes-serveur.js'];
    for (const f of pages) {
      const src = path.join(base, f);
      if (fs.existsSync(src)) { fs.mkdirSync(path.dirname(path.join(dest, dossier, f)), { recursive: true }); fs.copyFileSync(src, path.join(dest, dossier, f)); }
    }
    fs.cpSync(path.join(base, 'lang'), path.join(dest, dossier, 'lang'), { recursive: true });
  }
  a('cloud/src');
  a('build/traductions-seuils.json');
}

function lancerLaGarde(arbre) {
  const r = spawnSync(process.execPath, [path.join(racine, 'build', 'check-traductions.mjs'), '--racine', arbre], { encoding: 'utf8', cwd: racine });
  return { code: r.status, sortie: (r.stdout || '') + (r.stderr || '') };
}

test('garde de traduction : accepte l arbre complet, REFUSE un arbre ou les traductions de l option manquent (bureau ou site)', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-garde-trad-'));
  try {
    copierPourLaGarde(dossier);
    const ok = lancerLaGarde(dossier);
    assert.equal(ok.code, 0, 'la garde refuse l arbre complet :\n' + ok.sortie.slice(-1500));
    // retirer les trois entrees du dictionnaire du SITE seulement (derive web / bureau) puis des DEUX (couverture)
    const retirer = (chemin) => {
      let t = fs.readFileSync(chemin, 'utf8');
      for (const cle of CLES) {
        const i = t.indexOf('"' + cle + '": [');
        assert.ok(i >= 0);
        const fin = t.indexOf('\n', i);
        t = t.slice(0, i) + t.slice(fin + 1);
      }
      fs.writeFileSync(chemin, t);
    };
    retirer(path.join(dossier, 'cloud/public/app/lang/_additions6.js'));
    const derive = lancerLaGarde(dossier);
    assert.equal(derive.code, 1, 'la garde accepte un site sans les traductions :\n' + derive.sortie.slice(-1500));
    retirer(path.join(dossier, 'src/renderer/lang/_additions6.js'));
    const couverture = lancerLaGarde(dossier);
    assert.equal(couverture.code, 1, 'la garde accepte des dictionnaires sans les traductions :\n' + couverture.sortie.slice(-1500));
    assert.match(couverture.sortie, /Game-engine relief/, 'la garde ne nomme pas le libelle manquant :\n' + couverture.sortie.slice(-1500));
  } finally { fs.rmSync(dossier, { recursive: true, force: true }); }
});
