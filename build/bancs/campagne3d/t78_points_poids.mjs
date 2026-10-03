// Editeur de points du squelette + editeur de poids (2026-10-02, suite). Sans /eval ni /ipc, et SANS souris ni clavier (niveau « standard » de la Control API :
// « Developer full access » eteint) : le glisser d'une articulation, l'ajout d'un point et la peinture de poids sont donc NON TESTABLES ici ; ce banc fait ce qui passe par des clics.
// Usage : node t78_points_poids.mjs <groupe,...>   groupes : ouvrir (etat de l'editeur de points), regen (retirer un os puis « Re-generate rig », IA ~3-5 min), poids (editeur de poids : ouverture seule)
// Avec l'acces complet, la partie « glisser » est ecrite plus bas (relancer avec GLISSER=1).
import * as s from './s.mjs';
import { execFileSync } from 'node:child_process';
const h = s.h;
const groupes = (process.argv[2] || 'ouvrir').split(',');
const on = (g) => groupes.includes(g);
const PROJ = 'chevalier_medieval';
const blobs = (f) => { try { return JSON.parse(execFileSync(s.PY, [s.ICI + '/blobs.py', f], { encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1' } })); } catch (_) { return []; } };
const comparer = (a, b) => { try { return JSON.parse(execFileSync(s.PY, [s.ICI + '/comparer_rigs.py', a, b], { encoding: 'utf8', timeout: 300000, env: { ...process.env, PYTHONUTF8: '1' } }).trim().split('\n').pop()); } catch (e) { return { erreur: String(e.message || e).slice(0, 200) }; } };
const prepRig = (chip) => async () => { if (!(await s.ouvrirProjet(PROJ))) return { ok: false, error: 'projet' }; const p = await s.puce('step-card-rig', chip); return p.ok ? { ok: true, base: p.titre } : { ok: false, error: p.error }; };
const RIG0 = s.MESHES + '/chevalier_medieval_trellis2_native_1790901989157_rigged_skintokens_1790920284609.glb';
const lire = async () => { const m = await h.modale(); return (m.data || []).filter((x) => x.id === 'lm-fullscreen').map((x) => ({ texte: String(x.texte || '').slice(0, 900), nbBoutons: (x.boutons || []).length, retirer: (x.boutons || []).filter((b) => /Remove this point/.test(b.label)).length })); };

if (on('ouvrir')) {
  await s.essai({ groupe: '05_rig_points_suite', nom: 'points_ouvrir_etat', projet: PROJ, genre: null, accepteSansFichier: true, lourd: false, max: 120000, cible: '#lm-fs-canvas', avant: prepRig('v0'),
    notes: 'Skeleton points : ouverture de l\'editeur sur le rig du chevalier (72 os, 10 points a atteindre), « Save moved joints » sans rien deplacer (doit expliquer quoi faire), « Reset »',
    lancer: async () => {
      const o = await h.clic('ws-lm-manual'); if (!o.ok) return { ok: false, error: 'ouverture : ' + JSON.stringify(o).slice(0, 150) };
      await s.dormir(9000);
      const f = await h.shot('pts_ouvert_ok', '#lm-fs-canvas'); const b = f ? blobs(f) : [];
      s.note('   fenetre : ' + JSON.stringify(await lire()).slice(0, 500) + ' ; ' + b.length + ' articulations reperees dans la capture');
      const g = await h.clic('pts-enregistrer-sans-ia'); await s.dormir(1500);
      const t = await h.toasts(); s.note('   toasts apres « Save moved joints » sans changement : ' + JSON.stringify((t || []).map((x) => x.text).slice(-2)));
      await h.clic('pts-reinit'); await s.dormir(800);
      return { ok: true };
    } });
}
if (on('ouvrir') && process.env.GLISSER !== '1') {
  s.nonTestable('05_rig_points_suite', 'points_deplacer_genou_sans_ia', PROJ, 'Skeleton points : tirer une articulation (genou) a la souris puis « Save moved joints » (sans IA)');
  s.nonTestable('05_rig_points_suite', 'points_ajouter_un_point', PROJ, 'Skeleton points : « Add point » puis clic sur le maillage, puis « Re-generate rig with these points » (le squelette doit atteindre le point)');
  s.nonTestable('05_rig_points_suite', 'poids_peindre_et_enregistrer', PROJ, 'Skin weights : peindre des poids puis enregistrer une version « skinpaint »');
}
if (on('regen')) {
  await s.essai({ groupe: '05_rig_points_suite', nom: 'points_retirer_os_puis_regenerer', projet: PROJ, genre: 'rig', lourd: true, max: 1500000, cible: '#ws-rig-canvas', avant: prepRig('v0'),
    notes: 'Skeleton points : retirer UNE articulation de la liste (bout d\'orteil) puis « Re-generate rig with these points » (squelette impose, peau recalculee par l\'IA) : le nouveau rig a-t-il 71 os ? la peau est-elle saine ?',
    lancer: async () => {
      const o = await h.clic('ws-lm-manual'); if (!o.ok) return { ok: false, error: 'ouverture : ' + JSON.stringify(o).slice(0, 150) };
      await s.dormir(9000);
      const els = (await s.liste('modal:lm-fullscreen')).filter((x) => /Remove this point/.test(x.label || ''));
      s.note('   ' + els.length + ' boutons « Remove this point » (72 os + points)');
      if (els.length < 72) return { ok: false, error: 'liste des os introuvable (' + els.length + ' boutons)' };
      const r = await h.clic(els[70].ref); await s.dormir(1200);   // 71e articulation de la liste (bone_70, orteil)
      s.note('   suppression : ' + JSON.stringify(r).slice(0, 200) + ' ; fenetre ' + JSON.stringify(await lire()).slice(0, 300));
      const g = await h.clic('pts-regenerer'); if (!g.ok) return { ok: false, error: 'Re-generate : ' + JSON.stringify(g).slice(0, 200) };
      return { ok: true };
    },
    post: async (l, nouveau) => { if (nouveau) l.comparaison = comparer(RIG0, nouveau); } });
}
if (on('poids')) {
  await s.essai({ groupe: '05_rig_points_suite', nom: 'poids_ouvrir_editeur', projet: PROJ, genre: null, accepteSansFichier: true, lourd: false, max: 120000, avant: prepRig('v0'),
    notes: 'Skin weights : ouverture de l\'editeur de poids (ouverture seule : la peinture demande la souris)',
    lancer: async () => { const o = await h.clic('ws-rig-poids-btn'); if (!o.ok) return { ok: false, error: 'ouverture : ' + JSON.stringify(o).slice(0, 150) }; await s.dormir(7000); const m = await h.modale(); s.note('   fenetres : ' + JSON.stringify((m.data || []).map((x) => ({ id: x.id, titre: x.titre, texte: String(x.texte || '').slice(0, 400), boutons: (x.boutons || []).map((b) => b.label).slice(0, 25) }))).slice(0, 1500)); return { ok: true }; } });
}
if (process.env.GLISSER === '1') {
  // acces complet requis : tire l'articulation du genou gauche vers la hanche, « Save moved joints », compare au rig d'origine
  await s.essai({ groupe: '05_rig_points_suite', nom: 'points_deplacer_genou_sans_ia', projet: PROJ, genre: 'rig', lourd: false, max: 300000, cible: '#lm-fs-canvas', avant: prepRig('v0'),
    notes: 'Skeleton points : tirer une articulation (genou) a la souris, « Save moved joints » (le maillage et la peau ne doivent pas changer, seule l\'articulation se deplace)',
    lancer: async () => {
      const o = await h.clic('ws-lm-manual'); if (!o.ok) return { ok: false, error: 'ouverture' }; await s.dormir(9000);
      const f = await h.shot('pts_avant_drag', '#lm-fs-canvas'); const b = f ? blobs(f) : []; if (b.length < 10) return { ok: false, error: 'peu d\'articulations reperees' };
      const ys = b.map((x) => x.y); const y0 = Math.min(...ys), y1 = Math.max(...ys);
      const cible = b.filter((x) => x.x < 0.5).sort((p, q) => Math.abs(p.y - (y0 + 0.62 * (y1 - y0))) - Math.abs(q.y - (y0 + 0.62 * (y1 - y0))))[0];
      await s.souris('#lm-fs-canvas', [[cible.x, cible.y]], { move: true }); await s.dormir(500);
      await s.souris('#lm-fs-canvas', [[cible.x, cible.y], [cible.x, cible.y - 0.02], [cible.x, cible.y - 0.04]], { steps: 14, delay: 20 });
      await s.dormir(1500); const g = await h.clic('pts-enregistrer-sans-ia'); if (!g.ok) return { ok: false, error: 'Save moved joints' }; return { ok: true };
    },
    post: async (l, nouveau) => { if (nouveau) l.comparaison = comparer(RIG0, nouveau); } });
}
s.note('############ FIN t78 (' + groupes.join(',') + ')');
