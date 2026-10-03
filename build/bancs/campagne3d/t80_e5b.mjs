// E5b : branche « sans armature » de export-to-unreal, appelee directement (aucun bouton Unreal n'existe pour un maillage sans rig).
import * as l from './t80_lib.mjs';
const src = l.MESHES + '/verif_t80_trellis2_native_1791025300001_decimate_1791025542165.glb';
const t0 = Date.now(); const p0 = l.pos();
const r = await l.eval_('const r = await window.meshyAPI.exportToUnreal({sourcePath: ' + JSON.stringify(src) + ', customName: "verif_t80_sans_rig_unreal"}); return JSON.stringify(r)');
const f = l.fichiersApres(t0, /\.fbx$/i);
const res = { id: 'E5', nom: 'unreal_sans_squelette', ok: !!f.length, retour: r, duree_s: Math.round((Date.now() - t0) / 100) / 10, fichiers: f.map((x) => x.f + ' ' + x.taille), erreurs_journal: l.erreursDepuis(p0) };
if (f.length) { res.fbx = l.validerFbx(f[0].p); res.chemin = f[0].p; }
l.ligne(res); console.log(JSON.stringify(res));
