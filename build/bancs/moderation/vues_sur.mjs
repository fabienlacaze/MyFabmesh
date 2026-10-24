// INCLUSION DES VUES sur des textes du FUZZ (cinquieme relecture, 20/10/2026) : controle STRUCTUREL de non-recul, plus fin que le verdict (voir inclusion.mjs).
// Un texte dont une vue de la production MANQUE dans la version courante est un recul LATENT (meme si le verdict du texte ne change pas encore), ou une politique
// documentee (idiomes, expressions sures : les vues different alors par construction ; le mode « +pur » du fuzz n'en glisse aucune).
// Usage : node build/bancs/moderation/vues_sur.mjs [--n 300000] [--mode plancher+pur] [--graine 1] [--fils 3] [--montrer 30]
//   modes : ceux de fuzz.mjs (plancher, general, epeles, ages, courts, courts-epeles, idiomes, expressions, mixte), avec ou sans le suffixe +pur.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { versions, arg, montrer, expanser } from './lib_bancs.mjs';
import { creerGenerateur } from './fuzz.mjs';
import { manquants, declencheursManquants } from './inclusion.mjs';

const MODE = arg('--mode', 'plancher+pur');
const N = Number(arg('--n', 300000));
const GRAINE = Number(arg('--graine', 1));

if (!isMainThread) {
  const V = versions({ listes: true, sansAvant: true });
  const mode = MODE === 'tout' ? 'mixte' : MODE;
  const fabriquer = creerGenerateur({ V }, workerData.graine, mode);
  const manques = [];
  let n = 0;
  for (let k = 0; k < workerData.n; k++) {
    const t = fabriquer(mode);
    const m = manquants(V, t);
    if (m === null) continue;
    n++;
    if (m.length) manques.push([t, m.join('+')]);
  }
  parentPort.postMessage({ n, manques });
} else {
  const fils = Number(arg('--fils', 3));
  const t0 = Date.now();
  const res = await Promise.all(Array.from({ length: fils }, (_, i) => new Promise((ok, ko) => {
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { graine: GRAINE * 1000 + i, n: Math.floor(N / fils) }, argv: process.argv.slice(2), resourceLimits: { maxOldGenerationSizeMb: 1500 } });
    w.on('message', ok); w.on('error', ko);
  })));
  const n = res.reduce((a, r) => a + r.n, 0);
  const tous = new Map();
  for (const r of res) for (const [t, k] of r.manques) if (!tous.has(t)) tous.set(t, k);
  const parKind = {};
  for (const k of tous.values()) parKind[k] = (parKind[k] || 0) + 1;
  console.log(`inclusion des vues (${MODE}, graine ${GRAINE}) : ${n} textes, ${tous.size} textes dont une vue de la production MANQUE ${JSON.stringify(parKind)} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  const V = versions({ listes: true, sansAvant: true });
  const sansDeclencheur = declencheursManquants(V, expanser);
  console.log(`declencheurs des expressions que la production retirait entieres : ${sansDeclencheur.length} forme(s) sans declencheur ${JSON.stringify(sansDeclencheur.slice(0, 10))}`);
  if (sansDeclencheur.length) process.exitCode = 1;
  const courts = [...tous.entries()].sort((a, b) => a[0].length - b[0].length).slice(0, Number(arg('--montrer', 30)));
  for (const [t, k] of courts) {
    const p = V.PROD._vuesPlancher(t);
    console.log(`  [${k}] ${montrer(t).slice(0, 160)}`);
    console.log(`      production chiffres : ${montrer(p.chiffres).slice(0, 160)}`);
  }
  process.exit(tous.size ? 1 : 0);
}
