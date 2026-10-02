import * as h from './h.mjs';
const m = await h.modale(); console.log(JSON.stringify((m.data || []).map((x) => ({ id: x.id, titre: x.titre, texte: String(x.texte || '').slice(0, 400), boutons: (x.boutons || []).map((b) => b.label) }))));
console.log('jobs', JSON.stringify(await h.jobs()));
console.log('toasts', JSON.stringify((await h.toasts()).slice(-3)));
await h.shot('diag_modal_courant');
