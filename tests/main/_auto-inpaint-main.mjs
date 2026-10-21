// Aide PARTAGEE des tests du gestionnaire IPC 'auto-inpaint' de src/main/main.js (n'est PAS un test : le prefixe _ l'exclut du motif *.test.mjs).
// Charge le VRAI gestionnaire et le VRAI filtre de main.js (sans Electron, sans reseau, sans GPU) avec des doublures qui enregistrent tout appel
// au moteur (cloud, serveur local, sous-processus).
// Pour viser un autre exemplaire (preuve qu'un test ECHOUE sur l'ancien code) : MAIN_JS=<chemin>.
import { readFileSync } from 'node:fs';
import * as acorn from 'acorn';

const cheminMain = process.env.MAIN_JS || new URL('../../src/main/main.js', import.meta.url);
const main = readFileSync(cheminMain, 'utf8').replace(/\r\n/g, '\n');

// ── le filtre, tel que main.js le definit ─────────────────────────────────
const d = main.indexOf('const __filtreModeration');
const fin = main.indexOf('function checkPromptSafety(prompt) {\n  return __filtreModeration');
if (!(d > 0 && fin > d)) throw new Error('bloc du filtre introuvable dans main.js');
const morceauFiltre = main.slice(d, main.indexOf('}\n', fin) + 2);
let sansRestriction = false;
/** Mode « sans restriction » du filtre (le plancher illegal reste intouchable). */
export const regler = { sansRestriction: (v) => { sansRestriction = !!v; } };
export const filtre = new Function('isUnrestrictedMode', morceauFiltre + '\n;return { checkPromptSafety };')(() => sansRestriction);

// ── le gestionnaire, tel que main.js le definit ───────────────────────────
const ast = acorn.parse(main, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true, allowReturnOutsideFunction: true });
let sourceGestionnaire = null;
(function visiter(n) {
  if (!n || typeof n.type !== 'string' || sourceGestionnaire) return;
  if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && n.callee.property.name === 'handle'
      && n.arguments[0] && n.arguments[0].value === 'auto-inpaint') { sourceGestionnaire = main.slice(n.arguments[1].start, n.arguments[1].end); return; }
  for (const k of Object.keys(n)) {
    const v = n[k];
    if (Array.isArray(v)) v.forEach(visiter); else if (v && typeof v.type === 'string') visiter(v);
  }
})(ast);
if (!sourceGestionnaire) throw new Error("gestionnaire 'auto-inpaint' introuvable");

export function monter({ cloud = false, aiSafe = true } = {}) {
  const j = { cloud: [], serveur: [], processus: [], ia: [], multivue: [] };
  const doublures = {
    path: { dirname: () => '/proj', extname: () => '.png', basename: () => 'pig', join: (...a) => a.join('/') },
    safeBase: (b) => b, safeSend: () => {}, SCRIPTS_DIR: '/scripts', _aiPython: () => 'python',
    isCloudMode: () => cloud,
    cloudFallback: { imageOp: async (o) => { j.cloud.push(o); return { success: true, newPath: o.outPath, creditsRemaining: 10 }; } },
    ensureSdxlServer: async () => {},
    sdxlServerCall: async (route, corps) => { j.serveur.push([route, corps]); return { ok: true }; },
    _handleMultiviewInheritance: async () => {},
    execFile: (...a) => { j.processus.push(a); return { stdout: { on() {} }, stderr: { on() {} }, on() {} }; },
    fs: { existsSync: () => true },
    checkPromptSafety: (t) => filtre.checkPromptSafety(t),
    checkPromptSafetyAI: async (t) => { j.ia.push(t); return aiSafe ? { safe: true } : { safe: false, reason: 'ia' }; },
    sdxlReady: true,
  };
  const noms = Object.keys(doublures);
  const gestionnaire = new Function(...noms, 'return (' + sourceGestionnaire + ');')(...noms.map((n) => doublures[n]));
  return { j, appeler: (args) => gestionnaire({}, { imagePath: '/proj/pig.png', ...args }) };
}
/** Nombre d'appels au moteur (cloud + serveur local + sous-processus) : 0 = rien n'est parti. */
export const appelsMoteur = (j) => j.cloud.length + j.serveur.length + j.processus.length;
