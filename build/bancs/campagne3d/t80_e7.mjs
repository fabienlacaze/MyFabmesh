// E7 : « Segment parts » -> fenetre « Install part segmentation » -> Cancel (JAMAIS Install). Aucun travail en erreur ne doit rester.
import * as l from './t80_lib.mjs';
import { renameSync, existsSync } from 'node:fs';
const h = l.h;
await l.fermerModales();
await l.ouvrirProjet('verif_t80');
const r = await h.api('GET', '/ui/catalog?all=1&limit=2000&zone=step-card-mesh');
const e = ((r.data && r.data.elements) || []).find((x) => /^v\d+$/.test((x.label || '').trim().split(/\s+/)[0]) && /fix_normals_1791025598552\.glb/.test(x.title || ''));
if (e) { await h.clic(e.ref); await l.dormir(1500); }
// Le moteur de segmentation (PartSAM) est present sur ce poste : l'invite d'installation ne vient donc pas d'un moteur absent. On provoque le MEME chemin de code
// (le principal repond « Mesh not found », que le renderer traite comme « moteur non installe ») en renommant, le temps de l'essai, un fichier produit par le banc.
const cibleFic = l.MESHES + '/verif_t80_trellis2_native_1791025300001_fix_normals_1791025598552.glb';
renameSync(cibleFic, cibleFic + '.t80');
try {
const jobsAvant = (await h.jobs()).length;
const p0 = l.pos(); const t0 = Date.now();
const c = await h.clic('ws-mesh-segment-btn'); await l.dormir(2000);
const m1 = (await h.modale()).data || [];
l.note('apres clic Segment : modales ' + JSON.stringify(m1.map((x) => [x.id, x.titre, (x.boutons || []).map((b) => b.label)])));
await h.shot('t80_e7_granularite');
// bouton de validation de la granularite (jamais Install)
// la fenetre de granularite n'est pas listee par /ui/modal : on clique le bouton « Segment » par son texte exact
let valide = null;
const gc = await h.catalogue('Segment');
const bt = ((gc.data && gc.data.elements) || []).find((x) => (x.label || '').trim() === 'Segment' && !/ws-mesh-segment-btn/.test(x.ref));
l.note('bouton Segment de la fenetre : ' + JSON.stringify(bt && [bt.ref, bt.label, bt.zone]));
if (bt) { valide = bt.ref; await h.clic(bt.ref); }
await l.dormir(6000);
const m2 = (await h.modale()).data || [];
l.note('apres validation : modales ' + JSON.stringify(m2.map((x) => [x.id, x.titre, (x.boutons || []).map((b) => b.label)])));
await h.shot('t80_e7_confirm');
const jobsPendant = await h.jobs();
let annule = null;
const cf = m2.find((x) => x.id === 'modal-confirm');
if (cf) { const noms = (cf.boutons || []).map((b) => b.label); annule = noms.find((n) => /^cancel/i.test(n)); if (annule) await h.clic({ text: annule, within: 'modal-confirm' }); }
await l.dormir(2500);
const jobsApres = await h.jobs();
const toasts = ((await h.toasts()) || []).map((x) => x.type + ':' + x.text).slice(-4);
const enErreur = (jobsApres || []).filter((x) => /error|failed/i.test(String(x.status || '')));
const res = { id: 'E7', nom: 'segmentation_cancel', ok: !!(cf && annule && !enErreur.length), clic: c.ok, valide, fenetre_confirm: cf ? { titre: cf.titre, boutons: (cf.boutons || []).map((b) => b.label) } : null, jobs_avant: jobsAvant, jobs_pendant: (jobsPendant || []).map((x) => (x.name || x.nom) + ':' + x.status), jobs_apres: (jobsApres || []).map((x) => (x.name || x.nom) + ':' + x.status), en_erreur: enErreur.length, toasts, erreurs_journal: l.erreursDepuis(p0), duree_s: Math.round((Date.now() - t0) / 100) / 10 };
l.ligne(res); l.note('E7 : ' + JSON.stringify(res));
await h.shot('t80_e7_fin');
await l.fermerModales();
} finally { if (existsSync(cibleFic + '.t80')) renameSync(cibleFic + '.t80', cibleFic); }
