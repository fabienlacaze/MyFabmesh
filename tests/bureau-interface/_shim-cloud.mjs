// Aide PARTAGEE des tests (n'est PAS un test : le prefixe _ l'exclut du motif *.test.mjs).
// Extrait la VRAIE methode `autoInpaint` du pont du site (cloud/public/app/meshyAPI-cloud.js) et l'execute avec des doublures : on voit ainsi le
// corps JSON qui part VRAIMENT vers /api/auto-inpaint, sans reseau.
// Variable pour viser un autre exemplaire (preuve qu'un test ECHOUE sans la correction) : SHIM_JS.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHEMIN = process.env.SHIM_JS || join(RACINE, 'cloud/public/app/meshyAPI-cloud.js');

function extraire(nomMethode) {
  const src = readFileSync(CHEMIN, 'utf-8').replace(/\r\n/g, '\n');
  let ast;
  try { ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true }); }
  catch (_) { ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true, allowReturnOutsideFunction: true }); }
  let trouve = null;
  (function visiter(n) {
    if (!n || typeof n.type !== 'string' || trouve) return;
    if (n.type === 'Property' && !n.computed && n.key && (n.key.name === nomMethode || n.key.value === nomMethode)
        && (n.value.type === 'ArrowFunctionExpression' || n.value.type === 'FunctionExpression')) { trouve = src.slice(n.value.start, n.value.end); return; }
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v)) v.forEach(visiter); else if (v && typeof v.type === 'string') visiter(v);
    }
  })(ast);
  if (!trouve) throw new Error('methode ' + nomMethode + ' introuvable dans ' + CHEMIN);
  return trouve;
}

/** @param {(route:string, corps:object)=>Promise<object>} postJSON  doublure du reseau ; rend { autoInpaint(args) } */
export function creerShimAutoInpaint(postJSON) {
  const source = extraire('autoInpaint');
  const fenetre = { __cloudCreditsRefresh: () => {} };
  const fabrique = new Function('postJSON', '_projetAuLancement', '_attachToProject', 'window', 'return (' + source + ');');
  const autoInpaint = fabrique(postJSON, (p) => p, async () => {}, fenetre);
  return { autoInpaint };
}
