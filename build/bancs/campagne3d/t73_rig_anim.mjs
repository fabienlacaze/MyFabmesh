// Campagne rig et animation du bureau (suite de t72, 2026-10-02 nuit). Projet chevalier_medieval, maillage de base v4.
// Usage : node t73_rig_anim.mjs
import * as h from './h.mjs';
import { appendFileSync, existsSync, statSync, mkdirSync, openSync, readSync, closeSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const DEBUT = Date.now();
const BUDGET_MS = Number(process.env.BUDGET_H || 2) * 3600e3;
const PY = join(process.env.APPDATA, 'myfabmesh-ai', 'python', 'python.exe');
const LOGS = join(process.env.APPDATA, 'myfabmesh-ai', 'logs');
const SORTIE = 'C:/tmp/campagne/t73_resume.txt';
const EXPORT = 'C:/tmp/campagne/export_3d'; mkdirSync(EXPORT, { recursive: true });
const note = (s) => { const l = new Date().toLocaleTimeString('fr-FR') + ' ' + s; console.log(l); appendFileSync(SORTIE, l + '\n'); };
const taille = (f) => { try { return statSync(f).size; } catch (_) { return 0; } };
let CRASH_GPU = false;
const etat = async () => {
  const r = await h.evalue('const p=window.state.currentProject; const f=(a)=>(a||[]).map(x=>typeof x==="string"?x:(x.path||x.url||"")); return JSON.stringify({meshes:f(p.meshes), rigs:f(p.rigs), anims:f(p.animations), prev:p.previewMeshPath||null})');
  try { return JSON.parse(r.data); } catch (_) { return { meshes: [], rigs: [], anims: [], prev: null }; }
};
async function fermerTout() {
  for (let i = 0; i < 5; i++) {
    const m = await h.modale(); const l = (m.data || []); if (!l.length) return true;
    for (const x of l) {
      let r;
      if (x.id === 'modal-confirm') { r = await h.clic({ text: 'Cancel', within: 'modal-confirm' }); if (!r.ok) r = await h.clic('confirm-cancel'); }   // JAMAIS « Install » / « Delete » en fermeture automatique
      else { r = await h.clic({ text: 'Cancel', within: x.id }); if (!r.ok) r = await h.clic({ text: 'Close', within: x.id }); }
      await h.dormir(600);
    }
  }
  return true;
}
async function modalesApresLancement() {
  // fenetres qui peuvent surgir apres « Apply » : confirmation (Continue / OK), memoire graphique juste (Normal / Eco). La confirmation passe en premier.
  for (let i = 0; i < 5; i++) {
    await h.dormir(1500);
    const m = await h.modale(); const l = (m.data || []).filter((x) => x.id !== 'modal-job-details');
    const cible = l.find((x) => x.id === 'modal-confirm') || l.find((x) => (x.boutons || []).some((b) => /^(normal|continue)$/i.test(b.label) || /eco/i.test(b.label)));
    if (!cible) return;
    const noms = (cible.boutons || []).map((b) => b.label);
    note('   fenetre apres lancement : ' + cible.id + ' « ' + String(cible.titre || '').slice(0, 50) + ' » boutons ' + noms.join('/'));
    const eco = noms.find((n) => /eco/i.test(n)); const normal = noms.find((n) => /^normal$/i.test(n)); const ok = noms.find((n) => /^(ok|confirm|continue|yes)/i.test(n));
    const choix = eco || ok || normal;
    if (!choix) return;
    await h.clic({ text: choix, within: cible.id }); await h.dormir(1000);
  }
}
async function selectionnerV4() {
  for (let i = 0; i < 4; i++) {
    await h.clic({ text: 'v4', within: 'step-card-mesh' }); await h.dormir(1500);
    const e = await etat(); const n = e.meshes.length; const att = e.meshes[n - 5];
    if (att && e.prev && String(e.prev).replace(/\\/g, '/') === String(att).replace(/\\/g, '/')) return true;
  }
  return false;
}
function validerRig(chemin) {
  try { return JSON.parse(execFileSync(PY, ['C:/tmp/campagne/valider_rig.py', chemin], { encoding: 'utf8', timeout: 120000, env: { ...process.env, PYTHONUTF8: '1' } }).trim().split('\n').pop()); }
  catch (e) { return { erreur: String(e.message || e).slice(0, 160) }; }
}
async function essai({ nom, groupe, compteur, max = 900000, lancer, notes = '', attendreNouveau = true, cible = '#ws-rig-canvas' }) {
  if (CRASH_GPU) { note('SAUT (carte en erreur) : ' + nom); return null; }
  if (Date.now() - DEBUT > BUDGET_MS) { note('SAUT (budget de temps) : ' + nom); return null; }
  note('=== ' + groupe + ' / ' + nom);
  await fermerTout();
  const e0 = await etat(); const avant = e0[compteur].length; const pos = taille(join(LOGS, 'fabmesh.log'));
  const l = await h.essayer({ categorie: groupe, nom, max, note: notes, cible, lancer: async () => {
    const r = await lancer(); if (r && r.ok === false) return r;
    await modalesApresLancement(); return { ok: true }; } });
  const e1 = await etat(); l.ajoutes = e1[compteur].length - avant;
  if (attendreNouveau && l.ok && l.ajoutes <= 0) { l.ok = false; l.erreur = 'aucun element ajoute (' + compteur + ')'; }
  const nouveau = e1[compteur].length > avant ? e1[compteur][0] : null;
  if (nouveau) { l.nouveau = h.nomFichier(nouveau); l.mesures = validerRig(nouveau); }
  const f = join(LOGS, 'fabmesh.log'); let j = ''; try { const n = taille(f); if (n > pos) { const fd = openSync(f, 'r'); const b = Buffer.alloc(Math.min(n - pos, 6_000_000)); readSync(fd, b, 0, b.length, pos); closeSync(fd); j = b.toString('utf8'); } } catch (_) {}
  if (/nvlddmkm|device lost|CUDA error|illegal memory access|DXGI_ERROR_DEVICE|GPU hung/i.test(j)) { CRASH_GPU = true; l.erreur_gpu = true; note('   !!! ERREUR GPU'); }
  appendFileSync('C:/tmp/campagne/resultats3d.jsonl', JSON.stringify({ groupe, nom, ...l }) + '\n');
  console.log(h.resume(l));
  const m = l.mesures; note((l.ok ? 'OK   ' : 'ECHEC') + ' ' + nom + ' ' + l.duree_s + 's +' + l.ajoutes + (l.erreur ? ' | ' + l.erreur : '') + (m ? ' | joints ' + (m.joints ?? '?') + ', anims ' + (m.animations ?? '?') + (m.duree_s ? ' (' + m.duree_s + ' s)' : '') + ', poids ' + (m.avec_poids ?? '?') : ''));
  if (l.erreurs_journal && l.erreurs_journal.length) note('   journal : ' + l.erreurs_journal.slice(0, 3).join(' || ').slice(0, 400));
  await fermerTout();
  return { l, nouveau };
}

note('############ CAMPAGNE RIG + ANIMATION — projet chevalier_medieval');
await h.clic('back-to-projects').catch(() => {}); await h.dormir(1500); await h.clic('texte:chevalier_medieval').catch(() => {}); await h.dormir(3500);
if (!(await selectionnerV4())) note('ATTENTION : v4 non selectionnee');
const e00 = await etat(); note('rigs ' + e00.rigs.length + ' ; animations ' + e00.anims.length + ' ; maillages ' + e00.meshes.length);
await h.clic('ws-use-for-rig-btn'); await h.dormir(2500);

const rig = await essai({ nom: 'rig_biped_orc_m1', groupe: '05_rig', compteur: 'rigs', max: 1500000, notes: 'Generate Rig : squelette « Biped humanoid (117 bones) » sur le chevalier', lancer: async () => {
  await h.remplir({ '#ws-rig-skeleton': 'orc_m1' }).catch(() => {}); await h.dormir(800); return await h.clic('ws-generate-rig-ai'); } });
if (rig && rig.l.ok) {
  await essai({ nom: 'rig_test_animation', groupe: '05_rig', compteur: 'rigs', attendreNouveau: false, max: 120000, notes: 'Test animation : mouvement d\'essai pour verifier la peau', lancer: async () => {
    const o = await h.clic('ws-rig-test-btn'); await h.dormir(9000); return o; } });
  await essai({ nom: 'rig_reskin', groupe: '05_rig', compteur: 'rigs', max: 900000, attendreNouveau: false, notes: 'Re-skin only : recalcule les poids, squelette conserve', lancer: async () => await h.clic('ws-rig-reskin-btn') });
  const dest = EXPORT + '/chevalier_rig_unreal.fbx';
  await essai({ nom: 'rig_export_unreal', groupe: '05_rig', compteur: 'rigs', max: 600000, attendreNouveau: false, notes: 'Export to Unreal : FBX (cm, Y-up)', lancer: async () => {
    await h.api('POST', '/dialog/next', { save: dest }); const o = await h.clic('ws-rig-unreal-btn'); await h.dormir(15000); if (!existsSync(dest)) { note('   fichier exporte absent : ' + dest); return { ok: false, error: 'fichier FBX non cree' }; } note('   FBX exporte : ' + Math.round(taille(dest) / 1024) + ' Ko'); return o; } });
  await essai({ nom: 'rig_points_squelette', groupe: '05_rig', compteur: 'rigs', max: 120000, attendreNouveau: false, notes: 'Skeleton points : la fenetre d\'edition des points s\'ouvre', lancer: async () => {
    const o = await h.clic('ws-lm-manual'); await h.dormir(6000); const m = await h.modale(); note('   fenetres : ' + (m.data || []).map((x) => x.id + ':' + String(x.titre || '').slice(0, 40)).join(' | ')); if (!(m.data || []).length) return { ok: false, error: 'aucune fenetre ne s\'est ouverte' }; return o; } });
  // ---- animation
  await h.clic('ws-use-for-anim-btn'); await h.dormir(3000);
  for (const [anim, variante] of [['walk', 'normal'], ['run', 'normal'], ['idle', 'normal'], ['attack', 'normal'], ['death', 'normal']]) {
    await essai({ nom: 'anim_' + anim, groupe: '06_anim', compteur: 'anims', max: 900000, cible: '#ws-anim-result-canvas', notes: 'Generate Animation : ' + anim + ' / ' + variante, lancer: async () => {
      await h.remplir({ '#ws-anim-choix': anim, '#ws-anim-variante': variante }).catch(() => {}); await h.dormir(900); return await h.clic('ws-generate-anim'); } });
  }
  const dest2 = EXPORT + '/chevalier_anim.fbx';
  await essai({ nom: 'anim_export_fbx', groupe: '06_anim', compteur: 'anims', max: 600000, attendreNouveau: false, cible: '#ws-anim-result-canvas', notes: 'Export FBX de l\'animation', lancer: async () => {
    await h.api('POST', '/dialog/next', { save: dest2 }); const o = await h.clic('ws-anim-export-btn'); await h.dormir(20000); if (!existsSync(dest2)) { note('   fichier exporte absent : ' + dest2); return { ok: false, error: 'FBX non cree' }; } note('   FBX anim exporte : ' + Math.round(taille(dest2) / 1024) + ' Ko'); return o; } });
} else note('rig non genere : animation sautee');
note('############ FIN rig + animation — ' + Math.round((Date.now() - DEBUT) / 60000) + ' min');
