// Ouvre le projet de verification (verif_t80) : rafraichit la grille puis clique la carte. Usage : node t80_ouvrir.mjs
import * as l from './t80_lib.mjs';
const h = l.h;
await l.fermerModales();
await h.evalue('await renderProjectsGrid(); return 1');
await l.dormir(1500);
const ok = await l.ouvrirProjet('verif_t80');
console.log('ouvert', ok);
const p = await h.projet();
console.log(JSON.stringify(p));
await h.shot('t80_projet');
const c = await h.catalogue('blender');
console.log(JSON.stringify((c.data.elements || []).map((e) => [e.ref, e.label, e.zone, e.disabled, e.title && e.title.slice(0, 50)])));
