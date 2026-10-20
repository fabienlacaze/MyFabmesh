// FIL DE CALCUL des balayages et du fuzz de non-recul (lance par balayages.mjs et fuzz.mjs) : charge la production et la version APRES (avec
// leurs listes), execute une tranche de la tache demandee, renvoie les reculs au fil principal.
import { parentPort, workerData } from 'node:worker_threads';
import { versions } from './lib_bancs.mjs';
import { TACHES, lexique } from './balayages.mjs';
import { TACHES_FUZZ } from './fuzz.mjs';

const V = versions({ listes: true, sansAvant: true });
const ctx = { V, L: lexique(V) };
const { tache, params } = workerData; let { i, n } = workerData; if (params && params.tranches > 1 && TACHES[tache]) { i += n * (params.tranche || 0); n *= params.tranches; } // tranche k de K : les elements dont le rang vaut i + n*k modulo n*K
const f = TACHES[tache] || TACHES_FUZZ[tache];
if (!f) throw new Error('tache inconnue : ' + tache);
parentPort.postMessage(await f(ctx, i, n, params));
