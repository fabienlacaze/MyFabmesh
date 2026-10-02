import * as h from './h.mjs';
const lire = async (nom) => { const m = await h.modale(); console.log('--', nom, JSON.stringify((m.data || []).map((x) => ({ id: x.id, titre: x.titre, texte: String(x.texte || '').replace(/\s+/g, ' ').slice(0, 700), boutons: (x.boutons || []).map((b) => b.label) })))); };
const fermer = async () => { for (let i = 0; i < 4; i++) { const m = await h.modale(); if (!(m.data || []).length) break; for (const x of m.data) { let r = await h.clic({ text: 'Cancel', within: x.id }); if (!r.ok) r = await h.clic({ text: 'OK', within: x.id }); if (!r.ok) r = await h.clic({ text: 'Close', within: x.id }); await h.dormir(500); } } };
await fermer();
await h.api('POST', '/dialog/next', { save: 'C:/tmp/campagne/export_3d/diag_anim.fbx' });
console.log('export anim:', JSON.stringify(await h.clic('ws-anim-export-btn')).slice(0, 100)); await h.dormir(12000); await lire('apres export anim'); console.log('dialogs', JSON.stringify(await h.api('GET', '/dialog/state')).slice(0, 300)); await fermer();
const t = await h.toasts(); console.log('toasts', JSON.stringify((Array.isArray(t) ? t : []).slice(-3).map((x) => (x.text || '').slice(0, 300))));
