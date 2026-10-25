// Ingestion du texte de l'utilisateur (24/10, audit des prompts) : les VRAIES fonctions des deux index2.js (bureau et site), extraites par acorn.
//   - m16b : _epurerDemande n'abime plus « Make up kit », « Draw bridge », « a card saying thank you » ;
//   - m5 / M12 : _verifierAvantDepense AVERTIT avant toute depense (texte long, conflit gabarit / demande), Echap = rien n'est lance, « decocher T-pose » decoche la case.
// Rejouer contre l'ANCIEN code (les tests doivent echouer) :
//   LIB_JS=<ancienne lib> INDEX2_BUREAU=<ancien index2.js> INDEX2_WEB=<ancien index2.js du site> node --test tests/bureau-interface/ingestion.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as acorn from 'acorn';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dossier = mkdtempSync(join(tmpdir(), 'ingestion-'));
let LIB;
try {
  const copie = join(dossier, 'composeur-intention.mjs');
  writeFileSync(copie, readFileSync(process.env.LIB_JS || join(RACINE, 'src/renderer/lib/composeur-intention.js'), 'utf-8'));
  LIB = await import(pathToFileURL(copie).href);
} finally {
  rmSync(dossier, { recursive: true, force: true });
}

const DECLARATIONS = ['_DEMANDE_EN', '_DEMANDE_FR', '_retirerPolitesseFin', '_epurerDemande', '_optionsPose', '_i18nT', '_i18nTf'];
// absentes de l'ancien code : facultatives pour que le fichier tourne AUSSI contre lui (les tests echouent alors, c'est la preuve)
const DECLARATIONS_AVERTISSEMENTS = ['_TEXTES_AVERTISSEMENT', '_nbMotsAvertissement', '_bridageEquilibre', '_confirmerAvertissements', '_verifierAvantDepense'];
const CHEMINS = { 'src/renderer/index2.js': process.env.INDEX2_BUREAU, 'cloud/public/app/index2.js': process.env.INDEX2_WEB };

function charger(chemin, env) {
  const src = readFileSync(CHEMINS[chemin] || join(RACINE, chemin), 'utf-8');
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
  const morceaux = [];
  const vus = new Set();
  for (const n of ast.body) {
    let nom = null;
    if (n.type === 'VariableDeclaration' && n.declarations.length === 1 && n.declarations[0].id.type === 'Identifier') nom = n.declarations[0].id.name;
    else if (n.type === 'FunctionDeclaration') nom = n.id.name;
    if (nom && (DECLARATIONS.includes(nom) || DECLARATIONS_AVERTISSEMENTS.includes(nom)) && !vus.has(nom)) { vus.add(nom); morceaux.push(src.slice(n.start, n.end)); }
  }
  assert.deepEqual(DECLARATIONS.filter((d) => !vus.has(d)), [], chemin + ' : declarations introuvables');
  const f = new Function('composeurActif', 'detecterAvertissements', 'document', 'window', '_saveProjectMeta', 'NEG_MAX_LONG',
    morceaux.join('\n') + '\nreturn { _epurerDemande, _optionsPose, ' + (vus.has('_verifierAvantDepense') ? '_verifierAvantDepense, _confirmerAvertissements' : '_verifierAvantDepense: null, _confirmerAvertissements: null') + ' };');
  return f(() => true, LIB.detecterAvertissements, env.document, env.window, env.sauver, LIB.NEG_MAX_LONG);
}

// ---------------------------------------------------------------- faux DOM minimal
class Noeud {
  constructor(tag) { this.tag = tag; this.enfants = []; this.ecouteurs = {}; this.style = {}; this.checked = true; this.textContent = ''; this.className = ''; }
  appendChild(n) { this.enfants.push(n); n.parent = this; return n; }
  append(...ns) { ns.forEach((n) => this.appendChild(n)); }
  addEventListener(t, f) { (this.ecouteurs[t] = this.ecouteurs[t] || []).push(f); }
  removeEventListener(t, f) { this.ecouteurs[t] = (this.ecouteurs[t] || []).filter((x) => x !== f); }
  dispatchEvent(e) { (this.ecouteurs[e.type] || []).forEach((f) => f(e)); return true; }
  remove() { if (this.parent) this.parent.enfants = this.parent.enfants.filter((x) => x !== this); this.parent = null; }
  focus() {}
  tous() { return this.enfants.flatMap((e) => [e, ...e.tous()]); }
}
function fauxEnv({ tposeCochee = true } = {}) {
  const racine = new Noeud('body');
  const touches = [];
  const caseTpose = new Noeud('input'); caseTpose.checked = tposeCochee;
  const doc = {
    body: racine,
    createElement: (t) => new Noeud(t),
    getElementById: (id) => (id === 'ws-tpose' ? caseTpose : null),
    addEventListener: (t, f) => touches.push([t, f]),
    removeEventListener: (t, f) => { const i = touches.findIndex((x) => x[0] === t && x[1] === f); if (i >= 0) touches.splice(i, 1); },
  };
  const sauvegardes = [];
  globalThis.Event = globalThis.Event || class { constructor(type) { this.type = type; } };
  return { document: doc, window: { FabI18n: null }, sauver: (...a) => sauvegardes.push(a), racine, caseTpose, touches, sauvegardes };
}
const boutonAvec = (env, texte) => env.racine.tous().find((n) => n.tag === 'button' && n.textContent === texte);
const modaleOuverte = (env) => env.racine.enfants.length > 0;
const cliquer = (b) => b.dispatchEvent({ type: 'click', target: b });
const attendre = () => new Promise((r) => setTimeout(r, 0));

const MOTS60 = 'a tired old knight ' + Array.from({ length: 56 }, (_, i) => 'scarred' + (i % 3 ? '' : ' and')).join(' ');
const ASSET = 'character';

for (const chemin of ['src/renderer/index2.js', 'cloud/public/app/index2.js']) {
  const nom = chemin.startsWith('src') ? 'bureau' : 'web';

  test(nom + " : _epurerDemande garde « Make up kit », « Draw bridge », « a card saying thank you » et epure toujours les vraies phrases d'intention", () => {
    const P = charger(chemin, fauxEnv());
    for (const t of ['Make up kit on a table', 'Draw bridge over a moat', 'a card saying thank you', 'thank you card', 'a sign that reads please', 'Generate a generator'.replace('Generate a ', 'Generator of ')]) {
      assert.equal(P._epurerDemande(t), t, t);
    }
    assert.equal(P._epurerDemande('I want to make a cute pig'), 'cute pig');
    assert.equal(P._epurerDemande('please draw me a dragon'), 'dragon');
    assert.equal(P._epurerDemande('Make a red car, please'), 'red car');
    assert.equal(P._epurerDemande('a knight, thank you'), 'a knight');
    assert.equal(P._epurerDemande('Create an orc'), 'orc');
  });

  test(nom + ' : texte court, aucun conflit -> aucune fenetre', async () => {
    const env = fauxEnv();
    const P = charger(chemin, env);
    assert.ok(P._verifierAvantDepense, 'fonction absente');
    assert.equal(await P._verifierAvantDepense({ name: 'p' }, 'a stone golem with moss', 'a stone golem with moss', ASSET), true);
    assert.equal(modaleOuverte(env), false);
  });

  test(nom + ' : texte de 55 mots ou plus -> fenetre AVANT toute requete ; Echap = false (rien n\'est lance) ; continuer = true', async () => {
    let env = fauxEnv();
    let P = charger(chemin, env);
    let attente = P._verifierAvantDepense({ name: 'p' }, MOTS60, MOTS60, ASSET);
    await attendre();
    assert.equal(modaleOuverte(env), true, 'la fenetre doit etre ouverte AVANT la requete');
    assert.ok(env.racine.tous().some((n) => /words long/.test(n.textContent)), 'le message annonce la longueur');
    env.touches.filter((t) => t[0] === 'keydown').forEach((t) => t[1]({ key: 'Escape' }));
    assert.equal(await attente, false);
    assert.equal(modaleOuverte(env), false);
    env = fauxEnv(); P = charger(chemin, env);
    attente = P._verifierAvantDepense({ name: 'p' }, MOTS60, MOTS60, ASSET);
    await attendre();
    cliquer(boutonAvec(env, 'Continue anyway'));
    assert.equal(await attente, true);
    assert.equal(env.caseTpose.checked, true, 'la case n\'est pas touchee');
  });

  test(nom + ' : le nombre de mots compte aussi le texte SAISI (CJK) et le texte anglais', async () => {
    const env = fauxEnv();
    const P = charger(chemin, env);
    const cjk = '一个疲惫的老骑士'.repeat(15);   // 120 caracteres CJK, aucune espace
    const attente = P._verifierAvantDepense({ name: 'p' }, cjk, 'a tired old knight', ASSET);
    await attendre();
    assert.equal(modaleOuverte(env), true);
    cliquer(boutonAvec(env, 'Edit my text'));
    assert.equal(await attente, false);
  });

  test(nom + ' : plus de 2 000 caracteres -> seul « Edit my text » est propose', async () => {
    const env = fauxEnv();
    const P = charger(chemin, env);
    const attente = P._verifierAvantDepense({ name: 'p' }, 'x '.repeat(1100), 'x '.repeat(1100), ASSET);
    await attendre();
    assert.equal(boutonAvec(env, 'Continue anyway'), undefined);
    cliquer(boutonAvec(env, 'Edit my text'));
    assert.equal(await attente, false);
  });

  test(nom + ' : pose assise + T-pose cochee -> « Uncheck T-pose and continue » decoche la case et enregistre', async () => {
    const env = fauxEnv({ tposeCochee: true });
    const P = charger(chemin, env);
    const attente = P._verifierAvantDepense({ name: 'p' }, 'a knight sitting with arms crossed', 'a knight sitting with arms crossed', ASSET);
    await attendre();
    assert.ok(env.racine.tous().some((n) => /T-pose box is checked/.test(n.textContent)));
    cliquer(boutonAvec(env, 'Uncheck T-pose and continue'));
    assert.equal(await attente, true);
    assert.equal(env.caseTpose.checked, false);
    assert.equal(env.sauvegardes[0][0], 'p');
    assert.equal(env.sauvegardes[0][1].tpose, false);
  });

  test(nom + ' : case T-pose deja decochee -> la pose assise ne declenche aucune fenetre', async () => {
    const env = fauxEnv({ tposeCochee: false });
    const P = charger(chemin, env);
    assert.equal(await P._verifierAvantDepense({ name: 'p' }, 'a knight sitting', 'a knight sitting', ASSET), true);
    assert.equal(modaleOuverte(env), false);
  });

  test(nom + ' : quantite / vue / buste -> avertissement sans bouton T-pose ; « deux hommes » ; autre type d\'asset -> rien', async () => {
    for (const [texte, motif] of [['two men fighting', /several characters/], ['a knight in side view', /particular view/], ['a bust of a king', /portrait or a bust/],
      ['a man with a red hat and a man with a blue hat', /several characters/]]) {
      const env = fauxEnv();
      const P = charger(chemin, env);
      const attente = P._verifierAvantDepense({ name: 'p' }, texte, texte, ASSET);
      await attendre();
      assert.ok(env.racine.tous().some((n) => motif.test(n.textContent)), texte);
      assert.equal(boutonAvec(env, 'Uncheck T-pose and continue'), undefined, texte);
      cliquer(boutonAvec(env, 'Edit my text'));
      assert.equal(await attente, false);
    }
    const env = fauxEnv();
    const P = charger(chemin, env);
    assert.equal(await P._verifierAvantDepense({ name: 'p' }, 'two men fighting', 'two men fighting', 'vehicle'), true);
    assert.equal(modaleOuverte(env), false);
  });
}
