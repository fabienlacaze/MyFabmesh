// SUITE rigs + animations (2026-10-02, nuit). Sans /eval ni /ipc (API « standard »). Usage : node t77_rig_anim_suite.mjs <groupe,groupe,...>
//   groupes : anim_chev (animations sur le rig du chevalier : walk / run / ... corrigees, variantes, mode), rig_cochon, rig_alien, rig_bus, rig_ue5, anim_cochon, points, poids, exports
// Piege de la 1re campagne : « Generate Animation » genere la LISTE (par defaut IDLE) ; choisir « walk » dans la liste deroulante ne suffit pas :
// il faut vider la liste (Remove), choisir, « Add to the list », puis Generate. Les 5 « animations » de la campagne 1 etaient 5 fois la meme IDLE.
import * as s from './s.mjs';
const h = s.h;
const groupes = (process.argv[2] || 'anim_chev').split(',');
const on = (g) => groupes.includes(g);

async function viderListe() {
  for (let i = 0; i < 12; i++) {
    const rem = (await s.liste('step-card-animation')).filter((e) => e.label === 'Remove'); if (!rem.length) return i;
    await h.clic(rem[0].ref); await s.dormir(500);
  }
  return -1;
}
async function preparerAnim(projet, rigChip) {
  if (!(await s.ouvrirProjet(projet))) return { ok: false, error: 'projet non ouvert' };
  const p = await s.puce('step-card-rig', rigChip); if (!p.ok) return { ok: false, error: 'puce rig ' + rigChip + ' : ' + p.error };
  const u = await h.clic('ws-use-for-anim-btn'); if (!u.ok) return { ok: false, error: 'Use this rig for Animation : ' + JSON.stringify(u).slice(0, 150) };
  await s.dormir(2500);
  s_note_rig = p.titre; return { ok: true, rig: p.titre };
}
let s_note_rig = '';
async function lancerAnim(choix, variante = 'normal', extra = {}) {
  await viderListe();
  const f = await h.remplir({ '#ws-anim-choix': choix, '#ws-anim-variante': variante, ...extra }); if (f && f.ok === false) return { ok: false, error: 'remplir : ' + JSON.stringify(f).slice(0, 150) };
  await s.dormir(500);
  const v = await s.valeur('#ws-anim-choix');   // 2026-10-02 : une option non proposee pour l'espece (trot, eat sur un humanoide) laisse la valeur precedente : on ne genere pas un autre clip a la place
  if (v && v.value !== choix) return { ok: false, error: 'option « ' + choix + ' » non acceptee par la liste (valeur restee « ' + v.value + ' ») : non applicable a ce rig' };
  const a = await h.clic('ws-anim-ajouter'); if (!a.ok) return { ok: false, error: 'Add to the list : ' + JSON.stringify(a).slice(0, 150) };
  await s.dormir(700);
  return await h.clic('ws-generate-anim');
}
const animEssai = (nom, projet, rigChip, choix, variante = 'normal', extra = {}, notes = '') => s.essai({
  groupe: '06_anim_suite', nom, projet, genre: 'anim', max: 600000, lourd: false, cible: '#ws-anim-result-canvas',
  notes: notes || ('Generate Animation : ' + choix + ' / ' + variante + (Object.keys(extra).length ? ' ' + JSON.stringify(extra) : '') + ' (liste videe avant)'),
  avant: () => preparerAnim(projet, rigChip), lancer: () => lancerAnim(choix, variante, extra) });

if (on('anim_chev')) {
  for (const [c, v] of [['walk', 'normal'], ['run', 'normal'], ['idle', 'normal'], ['attack', 'normal'], ['death', 'normal']]) {
    const r = await animEssai('anim_chev_' + c + '_' + v, 'chevalier_medieval', 'v0', c, v);
    if (s.arrete()) break;
  }
}

// liste de plusieurs animations lancees d'un coup (enchainement / lot)
async function lancerListe(items) {
  await viderListe();
  for (const [c, v] of items) {
    const f = await h.remplir({ '#ws-anim-choix': c, '#ws-anim-variante': v }); if (f && f.ok === false) return { ok: false, error: 'remplir : ' + JSON.stringify(f).slice(0, 150) };
    await s.dormir(400); const a = await h.clic('ws-anim-ajouter'); if (!a.ok) return { ok: false, error: 'Add to the list : ' + JSON.stringify(a).slice(0, 150) };
    await s.dormir(500);
  }
  return await h.clic('ws-generate-anim');
}
if (on('anim_chev2')) {
  const L = [['walk', 'slow'], ['walk', 'brisk'], ['walk', 'sneak'], ['walk', 'proud'], ['walk', 'crawl'], ['walk', '*'], ['turn_left', 'normal'], ['turn_right', 'normal'], ['jump', 'normal'], ['walk_back', 'normal'], ['hit', 'normal'], ['eat', 'normal'], ['lie_down', 'normal'], ['trot', 'normal']];
  for (const [c, v] of L) { await animEssai('anim_chev_' + c + '_' + (v === '*' ? 'tous' : v), 'chevalier_medieval', 'v0', c, v); if (s.arrete()) break; }
  if (!s.arrete()) await s.essai({ groupe: '06_anim_suite', nom: 'anim_chev_liste_idle_walk_run_attack', projet: 'chevalier_medieval', genre: 'anim', max: 900000, lourd: false, cible: '#ws-anim-result-canvas',
    notes: 'Liste de 4 animations (idle, walk, run, attack) generees d\'un coup : un fichier par clip ou un seul fichier a 4 clips ?', avant: () => preparerAnim('chevalier_medieval', 'v0'), lancer: () => lancerListe([['idle', 'normal'], ['walk', 'normal'], ['run', 'normal'], ['attack', 'normal']]) });
}

// ------------------------------------------------------------------ RIGS sur d'autres sujets / d'autres squelettes
const rigEssai = (nom, projet, motifTitre, skeleton, notes) => s.essai({ groupe: '05_rig_suite', nom, projet, genre: 'rig', max: 1500000, lourd: true, cible: '#ws-rig-canvas', notes,
  avant: async () => {
    if (!(await s.ouvrirProjet(projet))) return { ok: false, error: 'projet ' + projet + ' non ouvert' };
    const p = await s.puceTitre('step-card-mesh', motifTitre); if (!p.ok) return { ok: false, error: p.error };
    const u = await h.clic('ws-use-for-rig-btn'); if (!u.ok) return { ok: false, error: 'Use this mesh for Rig : ' + JSON.stringify(u).slice(0, 150) };
    await s.dormir(2500); return { ok: true, base: p.titre };
  },
  lancer: async () => { const f = await h.remplir({ '#ws-rig-skeleton': skeleton }); if (f && f.ok === false) return { ok: false, error: 'squelette : ' + JSON.stringify(f).slice(0, 150) }; await s.dormir(700); return await h.clic('ws-generate-rig-ai'); } });
if (on('rig_cochon')) await rigEssai('rig_cochon_volant_wolf', 'cochon_volant', '^cochon_volant_1790909123082\.glb$', 'wolf', 'Generate Rig sur le cochon volant (quadrupede a ailes, ~500 K faces), squelette « Canine quadruped »');
if (on('rig_alien')) await rigEssai('rig_alien_cape_orc', 'alien_form_another_time', '1790909122082\.glb$', 'orc_m1', 'Generate Rig sur la forme « alien » (cape a capuche + objet), squelette bipede');
if (on('rig_bus')) await rigEssai('rig_bus_natif', 'bus', '1790909121082\.glb$', 'puppeteer_raw', 'Generate Rig sur le bus (objet rigide), squelette natif sans remap');
if (on('rig_ue5')) await rigEssai('rig_chevalier_ue5_mannequin', 'chevalier_medieval', '^chevalier_medieval_1790901989157\.glb$', 'ue5_mannequin', 'Generate Rig sur le chevalier v4 (515 K faces) avec le squelette « UE5 Mannequin std (161 bones) »');
if (on('rig_chev_wolf')) await rigEssai('rig_chevalier_wolf', 'chevalier_medieval', '^chevalier_medieval_1790901989157\.glb$', 'wolf', 'Generate Rig sur le chevalier v4 avec le squelette « Canine quadruped » (mauvais gabarit volontaire) : le choix du gabarit change-t-il le resultat (nombre d\'os) par rapport a orc_m1 (72 os) ?');
if (on('rig_cochon_dragon')) await rigEssai('rig_cochon_volant_dragon', 'cochon_volant', '^cochon_volant_1790909123082\.glb$', 'dragon', 'Generate Rig sur le cochon volant avec le squelette « Fantasy dragon (103 bones) » (ailes) : les ailes sont-elles rigguees ? comparaison avec wolf (67 os, ailes ?)');
if (on('reskin_cochon')) await s.essai({ groupe: '05_rig_suite', nom: 'reskin_cochon_volant', projet: 'cochon_volant', genre: 'rig', max: 900000, lourd: true, cible: '#ws-rig-canvas', notes: 'Re-skin only sur le rig du cochon (le squelette doit rester identique, les poids sont recalcules)',
  avant: async () => { if (!(await s.ouvrirProjet('cochon_volant'))) return { ok: false, error: 'projet' }; const p = await s.puceTitre('step-card-rig', '1790976290371'); return p.ok ? { ok: true, base: p.titre } : { ok: false, error: p.error }; },
  lancer: async () => await h.clic('ws-rig-reskin-btn') });
if (on('anim_cochon')) {
  for (const [c, v, ex] of [['walk', 'normal', {}], ['trot', 'normal', {}], ['run', 'normal', {}], ['idle', 'normal', {}], ['walk', 'normal', { '#ws-anim-espece': 'equide' }], ['walk', 'normal', { '#ws-anim-espece': 'felin' }]]) {
    await animEssai('anim_cochon_' + c + (ex['#ws-anim-espece'] ? '_' + ex['#ws-anim-espece'] : '') + '_' + v, 'cochon_volant', 'v0', c, v, ex);
    if (s.arrete()) break;
  }
}

if (on('anim_ue5')) { for (const [c, v] of [['walk', 'normal'], ['idle', 'normal']]) { await animEssai('anim_chev_ue5_' + c, 'chevalier_medieval', 'v2', c, v, {}, 'Animation ' + c + ' sur le rig « UE5 Mannequin » (161 os) du chevalier : adaptation automatique du clip a un autre squelette'); if (s.arrete()) break; } }
if (on('anim_alien')) { for (const [c, v] of [['walk', 'normal'], ['idle', 'normal']]) { await animEssai('anim_alien_' + c, 'alien_form_another_time', 'v0', c, v); if (s.arrete()) break; } }
if (on('anim_bus')) { for (const [c, v] of [['walk', 'normal']]) { await animEssai('anim_bus_' + c, 'bus', 'v0', c, v, {}, 'Animation sur un objet rigide (bus) avec squelette natif : marche / roule ?'); if (s.arrete()) break; } }
// ------------------------------------------------------------------ ANIM DIVERS : modes de deplacement (nage / reptation), especes, vehicule
if (on('anim_divers')) {
  // mode : on le choisit D'ABORD (la liste « Animation » change avec le mode), puis on prend la 1re animation proposee qui n'est pas « idle »
  const parMode = (nom, projet, rigChip, champ, valeur, notes) => s.essai({ groupe: '06_anim_suite', nom, projet, genre: 'anim', max: 600000, lourd: false, cible: '#ws-anim-result-canvas', notes,
    avant: () => preparerAnim(projet, rigChip),
    lancer: async () => {
      await viderListe();
      const f = await h.remplir({ [champ]: valeur }); if (f && f.ok === false) return { ok: false, error: champ + ' : ' + JSON.stringify(f).slice(0, 150) };
      await s.dormir(1200);
      const c = await s.valeur('#ws-anim-choix'); const opts = (c && c.options) || [];
      s.note('   ' + champ + '=' + valeur + ' -> options de la liste Animation : ' + JSON.stringify(opts).slice(0, 300));
      const prem = (opts.map((o) => String(o).split('=')[0]).find((o) => !/^idle/.test(o))) || (opts[0] || 'walk').split('=')[0];
      const g = await h.remplir({ '#ws-anim-choix': prem, '#ws-anim-variante': 'normal' }); if (g && g.ok === false) return { ok: false, error: 'choix : ' + JSON.stringify(g).slice(0, 150) };
      await s.dormir(500);
      const a = await h.clic('ws-anim-ajouter'); if (!a.ok) return { ok: false, error: 'Add to the list' };
      await s.dormir(700); return await h.clic('ws-generate-anim');
    } });
  await parMode('anim_cochon_mode_nage', 'cochon_volant', 'v0', '#ws-anim-mode', 'nage', 'Animation du cochon en mode « Swims » (moteur procedural, deplacement aquatique) : un clip est-il produit ? coherent avec le squelette ?');
  await parMode('anim_cochon_mode_reptation', 'cochon_volant', 'v0', '#ws-anim-mode', 'reptation', 'Animation du cochon en mode « Slithers » (reptation) sur un squelette de quadrupede');
  await parMode('anim_chev_espece_oiseau', 'chevalier_medieval', 'v0', '#ws-anim-espece', 'oiseau', 'Animation du chevalier (bipede humain) avec l\'espece « Bird » : le moteur adapte-t-il (ou casse-t-il) un squelette humain ?');
  await parMode('anim_chev_espece_dinosaure', 'chevalier_medieval', 'v0', '#ws-anim-espece', 'dinosaure', 'Animation du chevalier avec l\'espece « Dinosaur (two legs) »');
  await animEssai('anim_voiture_walk', 'voiture', 'v0', 'walk', 'normal', {}, 'Animation « walk » sur le rig de la voiture (5 os) : que fait le moteur procedural sur un vehicule ?');
}
// ------------------------------------------------------------------ « Add Animation » (fenetre a cases : un lot = une nouvelle version) sur le cochon
if (on('anim_modal')) {
  await s.essai({ groupe: '06_anim_suite', nom: 'anim_ajouter_lot_cochon', projet: 'cochon_volant', genre: 'anim', max: 600000, lourd: false, cible: '#ws-anim-result-canvas',
    notes: '« Add Animation » (fenetre a cases) sur le cochon : cocher « attack » et « death » puis Generate : un lot de 2 clips en une version ?',
    avant: () => preparerAnim('cochon_volant', 'v0'),
    lancer: async () => {
      const o = await h.clic('ws-anim-gen-more-btn'); if (!o.ok) return { ok: false, error: 'ouverture : ' + JSON.stringify(o).slice(0, 200) };
      await s.dormir(1500);
      const els = (await s.liste('modal:modal-anim-gen')); const cases = els.filter((x) => x.type === 'checkbox');
      s.note('   fenetre « Add Animation » : ' + cases.length + ' cases : ' + cases.map((x) => (x.label || x.ref) + '=' + x.value + (x.hidden ? '(masquee)' : '')).join(' | ').slice(0, 500));
      const veut = cases.filter((x) => /attack|death/i.test((x.label || '') + ' ' + (x.ref || '')) && !x.hidden);
      for (const c of veut) { await h.remplir({ [c.ref]: true }); await s.dormir(300); }
      if (!veut.length) return { ok: false, error: 'cases attack / death introuvables (' + cases.length + ' cases)' };
      const g = await h.clic('modal-anim-go'); if (!g.ok) return { ok: false, error: 'Generate (fenetre) : ' + JSON.stringify(g).slice(0, 200) };
      return g;
    } });
}
// ------------------------------------------------------------------ BUS 2 : rigger un objet apres reduction (le rig du bus de 487 K faces a depasse 600 s)
if (on('bus2rig')) await rigEssai('rig_bus_50k_natif', 'bus', '1790909121082_decimate_[0-9]+[.]glb$', 'puppeteer_raw', 'Generate Rig sur le bus reduit a 50 K faces (squelette natif) : le rig d un objet rigide aboutit-il dans le delai de 600 s une fois le maillage reduit ?');
if (on('bus2')) {
  const rd = await s.essai({ groupe: '04_mesh_suite', nom: 'triangle_count_50000_bus', projet: 'bus', genre: 'mesh', geom: false, lourd: false, max: 400000,
    notes: 'Triangle count 50 000 sur le bus (version 487 K faces) pour pouvoir le riguer dans le delai de 600 s',
    avant: async () => { if (!(await s.ouvrirProjet('bus'))) return { ok: false, error: 'projet' }; const p = await s.puceTitre('step-card-mesh', '^bus_1790909121082\.glb$'); return p.ok ? { ok: true, base: p.titre } : { ok: false, error: p.error }; },
    lancer: async () => { const o = await h.clic('ws-mesh-decimate-btn'); if (!o.ok) return o; await s.dormir(3000); await h.remplir({ '#modal-mesh-tool input.fen-valeur': 50000 }); await s.dormir(2500); return await h.clic('mt-apply'); } });
  if (rd && rd.l && rd.l.ok) {
    await rigEssai('rig_bus_50k_natif', 'bus', '1790909121082_decimate_[0-9]+[.]glb$', 'puppeteer_raw', 'Generate Rig sur le bus reduit a 50 K faces (squelette natif) : le rig d\'un objet rigide aboutit-il dans le delai de 600 s une fois le maillage reduit ?');
  } else s.note('bus2 : reduction a 50 K non reussie, rig saute');
}
// ------------------------------------------------------------------ EXPORTS (apres que Blender a ete detecte : voir AGENT_LOG)
import { existsSync } from 'node:fs';
async function attendreFichier(dest, ms = 240000) {
  const t0 = Date.now(); let derniere = -1;
  while (Date.now() - t0 < ms) {
    await s.dormir(3000);
    const t = s.taille(dest);
    if (t > 0 && t === derniere) return true;
    derniere = t;
  }
  return false;
}
const exporterMesh = (nom, projet, chip, format, ext, notes) => s.essai({ groupe: '07_export_suite', nom, projet, genre: null, accepteSansFichier: true, lourd: false, max: 400000, notes,
  avant: async () => { if (!(await s.ouvrirProjet(projet))) return { ok: false, error: 'projet' }; const p = await s.puce('step-card-mesh', chip); return p.ok ? { ok: true, base: p.titre } : { ok: false, error: p.error }; },
  lancer: async () => {
    const dest = s.EXPORTS + '/' + nom + '.' + ext;
    const o = await h.clic('ws-mesh-export-btn'); if (!o.ok) return { ok: false, error: 'ouverture export : ' + JSON.stringify(o).slice(0, 150) };
    await s.dormir(1500); await h.api('POST', '/dialog/next', { save: dest });
    const f = await h.remplir({ '#exp-format': format }); if (f && f.ok === false) return { ok: false, error: 'format : ' + JSON.stringify(f).slice(0, 120) };
    await h.clic('exp-browse'); await s.dormir(1500); const g = await h.clic('exp-go'); if (!g.ok) return { ok: false, error: 'Export : ' + JSON.stringify(g).slice(0, 150) };
    if (!(await attendreFichier(dest))) return { ok: false, error: 'fichier ' + dest + ' non cree' };
    return { ok: true };
  },
  post: async (l) => { const dest = s.EXPORTS + '/' + nom + '.' + ext; l.export = { chemin: dest, taille_mo: Math.round(s.taille(dest) / 1048576 * 100) / 100 }; if (s.taille(dest) > 0) l.export.validation = (ext === 'fbx' || ext === 'obj' || ext === 'glb') ? s.validerFbx(dest) : s.validerGlb(dest); } });
if (on('exports')) {
  await exporterMesh('export_mesh_fbx_unreal', 'chevalier_medieval', 'v6', 'fbx_unreal', 'fbx', 'Export mesh : « FBX for Unreal Engine (cm + Y-up) » de la version allegee, re-importe dans Blender pour verification (echelle cm ?)');
  for (const [fmt, ext] of [['obj', 'obj'], ['gltf', 'gltf'], ['stl', 'stl'], ['ply', 'ply'], ['glb', 'glb']]) { await exporterMesh('export_mesh_' + fmt, 'chevalier_medieval', 'v6', fmt, ext, 'Export mesh en ' + fmt.toUpperCase() + ' (version allegee), verifie apres coup'); if (s.arrete()) break; }
  // rig vers Unreal
  const unreal = (nom, rigChip, notes) => s.essai({ groupe: '07_export_suite', nom, projet: 'chevalier_medieval', genre: null, accepteSansFichier: true, lourd: false, max: 600000, notes, cible: '#ws-rig-canvas',
    avant: async () => { if (!(await s.ouvrirProjet('chevalier_medieval'))) return { ok: false, error: 'projet' }; const p = await s.puce('step-card-rig', rigChip); await s.dormir(1500); const e = (await s.liste('step-card-rig', 'Unreal')).find((x) => x.ref === '#ws-rig-unreal-btn'); return p.ok ? { ok: true, base: p.titre + (e && e.disabled ? ' [bouton Unreal GRISE]' : '') } : { ok: false, error: p.error }; },
    lancer: async () => { const dest = s.EXPORTS + '/' + nom + '.fbx'; await h.api('POST', '/dialog/next', { save: dest }); const o = await h.clic('ws-rig-unreal-btn'); if (!o.ok) return { ok: false, error: 'Export to Unreal : ' + JSON.stringify(o).slice(0, 200) }; if (!(await attendreFichier(dest, 300000))) return { ok: false, error: 'FBX non cree' }; return { ok: true }; },
    post: async (l) => { const dest = s.EXPORTS + '/' + nom + '.fbx'; l.export = { chemin: dest, taille_mo: Math.round(s.taille(dest) / 1048576 * 100) / 100 }; if (s.taille(dest) > 0) l.export.validation = s.validerFbx(dest); } });
  await unreal('export_rig_unreal_chevalier_v0', 'v0', 'Export to Unreal du rig du chevalier (72 os), FBX verifie dans Blender : os, poids, echelle');
  // animation vers FBX
  await s.essai({ groupe: '07_export_suite', nom: 'export_anim_fbx_walk', projet: 'chevalier_medieval', genre: null, accepteSansFichier: true, lourd: false, max: 600000, cible: '#ws-anim-result-canvas',
    notes: 'Export FBX de l\'animation « walk » du chevalier (puce de la carte Animation), verifie dans Blender : actions, images, os',
    avant: async () => { if (!(await s.ouvrirProjet('chevalier_medieval'))) return { ok: false, error: 'projet' }; const els = await s.liste('step-card-animation'); const walk = els.filter((x) => /locomotion/.test(x.label || '') && /v\d+/.test(x.label || '')); const e = els.find((x) => x.ref === '#ws-anim-export-btn'); return { ok: true, base: walk.length + ' clips ; bouton Export FBX ' + (e && e.disabled ? 'GRISE' : 'actif') }; },
    lancer: async () => { const dest = s.EXPORTS + '/anim_walk_chevalier.fbx'; await h.api('POST', '/dialog/next', { save: dest }); const o = await h.clic('ws-anim-export-btn'); if (!o.ok) return { ok: false, error: 'Export FBX : ' + JSON.stringify(o).slice(0, 200) }; if (!(await attendreFichier(dest, 300000))) return { ok: false, error: 'FBX non cree' }; return { ok: true }; },
    post: async (l) => { const dest = s.EXPORTS + '/anim_walk_chevalier.fbx'; l.export = { chemin: dest, taille_mo: Math.round(s.taille(dest) / 1048576 * 100) / 100 }; if (s.taille(dest) > 0) l.export.validation = s.validerFbx(dest); } });
}
s.note('############ FIN t77 (' + groupes.join(',') + ')');
