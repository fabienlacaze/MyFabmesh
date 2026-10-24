// BUREAU LOCAL : AUCUN OUTIL IA A TEXTE LIBRE SANS FILTRE (24/10, audit des prompts, M8). Balayage acorn de src/main/main.js : tout
// gestionnaire ipcMain.handle dont les parametres nomment un texte libre (prompt, targetText, modification, style, guide, negPrompt,
// userPrompt, promptHint, notes, name) doit appeler le filtre de texte (refusTexteOutil / checkPromptSafety / _refusTexteEntree) AVANT
// d'envoyer ce texte quelque part. Un gestionnaire ajoute plus tard sans filtre fait echouer ce test (liste d'exceptions justifiees ci-dessous).
// Lancer : node --test tests/main/filtre-texte-gestionnaires.test.mjs
// Ancien code : MAIN_JS=<copie de main.js de integration-2> node --test tests/main/filtre-texte-gestionnaires.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';

const ici = path.dirname(fileURLToPath(import.meta.url));
const MAIN_JS = process.env.MAIN_JS || path.join(ici, '..', '..', 'src', 'main', 'main.js');
const src = fs.readFileSync(MAIN_JS, 'utf-8');
const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true, allowHashBang: true });

const TEXTES_LIBRES = new Set(['prompt', 'targetText', 'modification', 'style', 'guide', 'negPrompt', 'userPrompt', 'promptHint', 'notes',
  'userPromptAnglais', 'rawPrompt', 'replacement', 'replaceText', 'description']);
const FILTRES = ['refusTexteOutil(', 'checkPromptSafety(', 'checkPromptSafetyAI(', '_refusTexteEntree('];

/** Exceptions : le texte n'est pas du texte de l'utilisateur envoye a un moteur d'image / de maillage. */
const EXCEPTIONS = {
  'translate-prompt': "le texte n'est que TRADUIT (le filtre s'applique ensuite a la chaine envoyee par le gestionnaire de l'outil)",
  'translate-status': "ne lit aucun texte",
  'segment-mask': "CLIPSeg ne fait que DETECTER la zone nommee (aucune image generee) ; l'outil qui remplace la zone filtre son propre texte",
  'projet-vide:creer': "range le texte dans un fichier de projet ; il est filtre au moment ou une generation l'envoie a un moteur",
};

function gestionnaires() {
  const out = [];
  for (const n of ast.body) {
    if (n.type !== 'ExpressionStatement' || n.expression.type !== 'CallExpression') continue;
    const c = n.expression;
    if (!(c.callee.type === 'MemberExpression' && c.callee.object.name === 'ipcMain' && c.callee.property.name === 'handle')) continue;
    const canal = c.arguments[0] && c.arguments[0].value;
    const f = c.arguments[1];
    if (!f || !/Function/.test(f.type)) continue;
    const noms = [];
    for (const p of f.params) {
      if (p.type === 'ObjectPattern') for (const q of p.properties) if (q.key && q.key.name) noms.push(q.key.name);
      if (p.type === 'AssignmentPattern' && p.left.type === 'ObjectPattern') for (const q of p.left.properties) if (q.key && q.key.name) noms.push(q.key.name);
    }
    out.push({ canal, noms, code: src.slice(f.start, f.end) });
  }
  return out;
}

test('M8 : tout gestionnaire IPC a texte libre appelle le filtre de texte', () => {
  const g = gestionnaires();
  assert.ok(g.length > 100, `${g.length} gestionnaires lus`);
  const sansFiltre = [];
  let aTexte = 0;
  for (const h of g) {
    if (!h.noms.some((n) => TEXTES_LIBRES.has(n))) continue;
    if (EXCEPTIONS[h.canal]) continue;
    aTexte++;
    if (!FILTRES.some((f) => h.code.includes(f))) sansFiltre.push(`${h.canal} (${h.noms.filter((n) => TEXTES_LIBRES.has(n)).join(', ')})`);
  }
  assert.ok(aTexte >= 10, `${aTexte} gestionnaires a texte libre trouves`);
  assert.deepEqual(sansFiltre, [], 'gestionnaire(s) a texte libre sans filtre de texte');
});

test('M8 : les 9 outils nommes par l audit appellent le filtre (generate-back-view, mask-inpaint, tex-variant, recolor, auto-inpaint, region-retex, reshape-region, mesh-tool, detail-synth)', () => {
  const g = new Map(gestionnaires().map((h) => [h.canal, h]));
  const attendus = ['generate-back-view', 'mask-inpaint', 'tex-variant', 'recolor', 'auto-inpaint', 'mesh:region-retex', 'mesh:reshape-region',
    'mesh-tool', 'detail-synth', 'redacteur:decrire', 'animate-ai'];
  const manque = [];
  for (const canal of attendus) {
    const h = g.get(canal) || [...g.values()].find((x) => String(x.canal).includes(canal.replace('mesh:', '')));
    if (!h) { manque.push(`${canal} : introuvable`); continue; }
    if (!FILTRES.some((f) => h.code.includes(f))) manque.push(`${canal} : pas de filtre`);
  }
  assert.deepEqual(manque, []);
});

test('M8 : le pont MCP / API de controle (handleGenerateImages) filtre aussi le texte avant le moteur d image', () => {
  const i = src.indexOf('async function handleGenerateImages(params)');
  assert.ok(i > 0);
  assert.ok(FILTRES.some((f) => src.slice(i, i + 800).includes(f)), 'handleGenerateImages sans filtre de texte');
});
