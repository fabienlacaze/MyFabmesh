// Aide PARTAGEE des tests d'Auto Inpaint / Modify cote worker (n'est PAS un test : le prefixe _ l'exclut du motif *.test.mjs).
// Charge les VRAIES fonctions handleAutoInpaint et handleModifyImage de cloud/src/worker.ts avec des doublures (aucun reseau, aucun GPU, aucun Modal)
// et le VRAI filtre de securite de cloud/src/nsfw_filter.ts.
// Pour viser un autre exemplaire du worker (preuve qu'un test echoue sur l'ancien code) : WORKER_SRC=<chemin>.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chargerFonctions, lireSource } from './_charge-worker.mjs';
const require = createRequire(import.meta.url);
const ts = require('typescript');
// le VRAI filtre du worker
const jsFiltre = ts.transpileModule(readFileSync(new URL('../src/nsfw_filter.ts', import.meta.url), 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
export const filtre = {};
new Function('exports', 'require', jsFiltre)(filtre, require);

export const F = (...m) => m.join('');
export const NU = F('na', 'ked');
export const GRILLE = { modify: 3, auto_inpaint: 6 };
/** Declarations du refus « personne mineure nommee » de handleAutoInpaint (2026-10-22). */
export const NOMS_REFUS_MINEUR = ['refusRetraitMineur', '_rmPlier', '_RM_CONFUSABLES', '_RM_MINEURS', '_RM_RE_MINEUR', '_RM_NB', '_RM_RE_AGE',
  '_RM_PERSONNE_SEULE',
  // alerte exploitant d'un retrait refuse (deuxieme relecture du 2026-10-22) : absente d'un worker plus ancien (WORKER_SRC)
  ...(lireSource().includes('\nasync function _alerterTextesRetrait(') ? ['_alerterTextesRetrait'] : [])];
export const AVEC_REFUS_MINEUR = lireSource().includes('\nfunction refusRetraitMineur(');

export function monter({ grille = GRILLE, resultat = { url: 'https://r2.example/front/out.png' }, echec = false, credits = 100 } = {}) {
  const j = { depenses: [], remboursements: [], modal: [], journal: [], prixLus: [], verifies: [], budget: [], appels: [], alertes: [] };
  const reponse = (o, init) => new Response(JSON.stringify(o), { status: (init && init.status) || 200, headers: { 'content-type': 'application/json' } });
  const dbl = {
    getSessionUser: async () => ({ id: 'u1', email: 'a@b.c' }),
    err: (status, message) => reponse({ error: message }, { status }),
    json: (o, init) => reponse(o, init),
    getParentalState: async () => ({}),
    _checkPromptSafetyAlerte: async (_e, _u, texte, unrestricted) => { j.verifies.push(texte); return filtre.checkPromptSafety(texte, unrestricted); },
    getPrice: async (_env, k) => { j.prixLus.push(k); return grille[k]; },
    isTrustedAssetHost: () => true,
    checkAndIncrementModalSpend: async (_e, montant) => { j.budget.push(montant); return 100; },
    _spendRefusalMessage: async () => 'refus',
    checkAndIncrementUserCalls: async () => { j.appels.push(1); return 10; },
    refundModalSpend: async (_e, montant) => { j.budget.push(-montant); },
    spendCredits: async (_e, _u, cout) => { j.depenses.push(cout); return credits - cout; },
    addCredits: async (_e, _u, cout) => { j.remboursements.push(cout); },
    callModalImageOp: async (_e, _u, input) => {
      j.modal.push(input);
      if (echec) throw new Error('GPU en panne');
      return resultat;
    },
    logOperation: async (_e, _u, type, cout, _d, _f, statut, extra) => { j.journal.push({ type, cout, statut, extra }); },
  };
  // refus « personne mineure nommee » (2026-10-22) : charge s'il existe (un worker plus ancien, WORKER_SRC, n'en a pas)
  const w = chargerFonctions(['handleAutoInpaint', 'handleModifyImage', ...(AVEC_REFUS_MINEUR ? NOMS_REFUS_MINEUR : [])], dbl);
  const env = { MODAL_IMAGE_OP_URL: 'https://modal.example' };
  const post = (fonction, corps) => fonction(new Request('https://x.example/api/x', { method: 'POST', body: JSON.stringify(corps) }), env);
  return {
    j,
    inpaint: (corps) => post(w.handleAutoInpaint, { imageUrl: 'https://r2.example/front/pig.png', ...corps }),
    modify: (corps) => post(w.handleModifyImage, { imageUrl: 'https://r2.example/front/pig.png', ...corps }),
  };
}

export const rien = (j) => ({ depenses: j.depenses.length, modal: j.modal.length, budget: j.budget.length, appels: j.appels.length });

