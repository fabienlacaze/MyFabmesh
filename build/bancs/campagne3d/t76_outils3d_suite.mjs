// SUITE des outils 3D du bureau (2026-10-02, nuit) : ce que la 1re campagne n'avait pas teste. Sans /eval ni /ipc (API « standard »).
// Usage : node t76_outils3d_suite.mjs <groupe,groupe,...>   groupes : geo, edit, etat, tex
//   geo  : Triangle count (5 000 / 1 000 / 500), Subdivide x2, Watertight « keep detail », Smooth fort, Set pivot « bottom », Resize rotation 90
//   edit : pinceaux de sculpture, selections (baguette, lasso, grow / shrink, inverser, dupliquer, recadrer, retourner, lisser), peinture (remplir / lisser / reinitialiser)
//   etat : Segment parts, Name the zones, Decals / Align texture, 3D construction stages : etat reel et premiere execution
//   tex  : Texture variants autre style, Watertight, Re-bake
import * as s from './s.mjs';
const h = s.h;
const groupes = (process.argv[2] || 'geo').split(',');
const on = (g) => groupes.includes(g);
const mouse = (target, path, extra = {}) => s.souris(target, path, extra);
const PROJ = 'chevalier_medieval';
const prep = (projet, chip, aligner = false) => async () => {
  if (!(await s.ouvrirProjet(projet))) return { ok: false, error: 'projet ' + projet + ' non ouvert' };
  const p = await s.puce('step-card-mesh', chip); if (!p.ok) return { ok: false, error: 'puce ' + chip + ' : ' + p.error };
  if (aligner) { await h.clic('ws-use-for-rig-btn'); await s.dormir(800); }
  return { ok: true, base: p.titre };
};
const outil = async (bouton, apres = null) => { const o = await h.clic(bouton); if (!o.ok) return { ok: false, error: 'ouverture ' + bouton + ' : ' + JSON.stringify(o).slice(0, 160) }; await s.dormir(3200); if (apres) await apres(); return { ok: true }; };
const fixerNombre = async (valeur) => h.remplir({ '#modal-mesh-tool input.fen-valeur': valeur });

// ------------------------------------------------------------------ GEO
if (on('geo')) {
  for (const n of [5000, 1000]) {
    await s.essai({ groupe: '04_mesh_suite', nom: 'triangle_count_' + n + '_depuis_v4', projet: PROJ, genre: 'mesh', geom: true, lourd: false, max: 400000, avant: prep(PROJ, 'v4'),
      notes: 'Triangle count ' + n + ' depuis la base de 515 K faces : qualite de la reduction (faces retournees, composantes, aretes de bord)',
      lancer: async () => { const o = await outil('ws-mesh-decimate-btn'); if (!o.ok) return o; const f = await fixerNombre(n); if (f && f.ok === false) return { ok: false, error: 'saisie : ' + JSON.stringify(f).slice(0, 120) }; await s.dormir(2500); return await h.clic('mt-apply'); } });
    if (s.arrete()) break;
  }
  await s.essai({ groupe: '04_mesh_suite', nom: 'triangle_count_500_bus', projet: 'bus', genre: 'mesh', geom: true, lourd: false, max: 400000, avant: prep('bus', 'v0'),
    notes: 'Triangle count 500 sur le bus (objet rigide, version la plus ancienne = ~? K faces) : memoire « moitie des triangles en miettes (camion) » a petite cible',
    lancer: async () => { const o = await outil('ws-mesh-decimate-btn'); if (!o.ok) return o; await fixerNombre(500); await s.dormir(2500); return await h.clic('mt-apply'); } });
  await s.essai({ groupe: '04_mesh_suite', nom: 'subdivide_2_depuis_v6', projet: PROJ, genre: 'mesh', geom: true, lourd: false, max: 400000, avant: prep(PROJ, 'v6'),
    notes: 'Subdivide, 2 niveaux (x16 faces) depuis la version allegee de 20 K',
    lancer: async () => { const o = await outil('ws-mesh-subdivide-btn'); if (!o.ok) return o; await h.remplir({ '#modal-mesh-tool input.fen-valeur': 2 }); await s.dormir(2500); return await h.clic('mt-apply'); } });
  await s.essai({ groupe: '04_mesh_suite', nom: 'watertight_garder_detail', projet: PROJ, genre: 'mesh', geom: true, lourd: false, max: 600000, avant: prep(PROJ, 'v6'),
    notes: 'Watertight avec « Keep original detail » (colmate sans remailler : la texture doit rester)',
    lancer: async () => { const o = await outil('ws-mesh-watertight-btn'); if (!o.ok) return o; const f = await h.remplir({ '#modal-mesh-tool input[type=checkbox]': true }); await s.dormir(800); return await h.clic('mt-apply'); } });
  await s.essai({ groupe: '04_mesh_suite', nom: 'smooth_fort_10x08', projet: PROJ, genre: 'mesh', geom: true, lourd: false, max: 300000, avant: prep(PROJ, 'v6'),
    notes: 'Smooth fort : 10 iterations, lambda 0,8 (volume conserve ? retrecissement ?)',
    lancer: async () => { const o = await outil('ws-mesh-smooth-btn'); if (!o.ok) return o; const inp = await h.api('GET', '/ui/modal'); const f = await h.remplir({ '#modal-mesh-tool input.fen-valeur': 10 }); await s.dormir(1500); return await h.clic('mt-apply'); } });
  await s.essai({ groupe: '04_mesh_suite', nom: 'set_pivot_bottom', projet: PROJ, genre: 'mesh', geom: true, lourd: false, max: 300000, avant: prep(PROJ, 'v6'),
    notes: 'Set Pivot : preset par defaut « bottom » (pieds a Y=0)', lancer: async () => { const o = await outil('ws-mesh-center-btn'); if (!o.ok) return o; return await h.clic('mt-apply'); } });
  await s.essai({ groupe: '04_mesh_suite', nom: 'resize_rotation_90x', projet: PROJ, genre: 'mesh', geom: true, lourd: false, max: 300000, avant: prep(PROJ, 'v6'),
    notes: 'Resize : tourner de 90 degres autour de X (rz-rx90) puis Apply (la boite doit permuter Y / Z)',
    lancer: async () => { const o = await outil('ws-mesh-resize-btn'); if (!o.ok) return o; await h.clic('rz-rx90'); await s.dormir(1200); return await h.clic('rz-apply'); } });
}

// ------------------------------------------------------------------ GEO2 : Smooth sur le maillage COMPLET (515 K faces) et sur un autre sujet (le defaut du Smooth vu sur la version allegee se reproduit-il ?)
if (on('geo2')) {
  await s.essai({ groupe: '04_mesh_suite', nom: 'smooth_defaut_v4_complet', projet: PROJ, genre: 'mesh', geom: true, lourd: false, max: 600000, avant: prep(PROJ, 'v4'),
    notes: 'Smooth avec les reglages par defaut (3 iterations, lambda 0,5) sur le maillage COMPLET v4 (515 K faces) : reproduit-on l\'eclatement des couches de texture vu sur la version allegee ?',
    lancer: async () => { const o = await outil('ws-mesh-smooth-btn'); if (!o.ok) return o; return await h.clic('mt-apply'); } });
  await s.essai({ groupe: '04_mesh_suite', nom: 'smooth_defaut_cochon', projet: 'cochon_volant', genre: 'mesh', geom: true, lourd: false, max: 600000, avant: prep('cochon_volant', 'v1'),
    notes: 'Smooth par defaut sur le cochon volant (autre sujet, 517 K faces)',
    lancer: async () => { const o = await outil('ws-mesh-smooth-btn'); if (!o.ok) return o; return await h.clic('mt-apply'); } });
}

// ------------------------------------------------------------------ EDIT
if (on('edit')) {
  const B = 'v6';
  const ouvrir = (btn) => async () => { const o = await h.clic(btn); if (!o.ok) return { ok: false, error: 'ouverture ' + btn + ' : ' + JSON.stringify(o).slice(0, 160) }; await s.dormir(4800); return { ok: true }; };
  const edit = async (nom, notes, btnOuverture, script, needsMouse = true) => { if (needsMouse && !(await s.sourisDispo())) { s.nonTestable('04_mesh_edit_suite', nom, PROJ, notes); return null; } return editReel(nom, notes, btnOuverture, script); };
  const editReel = (nom, notes, btnOuverture, script) => s.essai({ groupe: '04_mesh_edit_suite', nom, projet: PROJ, genre: 'mesh', geom: true, lourd: false, max: 300000, avant: prep(PROJ, B), notes,
    lancer: async () => { const o = await ouvrir(btnOuverture)(); if (o.ok === false) return o; const r = await script(); if (r && r.ok === false) return r; await s.dormir(900); return await h.clic('me-save'); } });
  const torse = [[0.46, 0.46], [0.54, 0.5], [0.48, 0.55]];
  for (const [id, nom] of [['me-sculpt-pull', 'pull'], ['me-sculpt-flatten', 'flatten'], ['me-sculpt-inflate', 'inflate'], ['me-sculpt-smooth', 'smooth'], ['me-sculpt-grab', 'grab']]) {
    await edit('sculpt_' + nom, 'Sculpt : pinceau ' + nom + ' sur le torse, enregistre (la geometrie doit changer)', 'ws-mesh-sculpt-btn', async () => { await h.clic(id); await s.dormir(500); await mouse('#me-canvas', torse); });
    if (s.arrete()) break;
  }
  await edit('sculpt_push_symetrie_x', 'Sculpt : push avec symetrie X activee sur un seul cote (les deux cotes doivent bouger)', 'ws-mesh-sculpt-btn', async () => { await h.clic('me-sym-x'); await s.dormir(400); await h.clic('me-sculpt-push'); await mouse('#me-canvas', [[0.42, 0.5], [0.44, 0.54], [0.42, 0.58]]); });
  await edit('select_baguette_supprimer', 'Select : baguette magique sur un aplat puis Suppr (des faces doivent disparaitre)', 'ws-mesh-selectface-btn', async () => { await h.clic('me-sel-wand'); await s.dormir(400); await mouse('#me-canvas', [[0.5, 0.47]]); await s.dormir(900); await h.clic('me-sel-delete'); await s.dormir(900); });
  await edit('select_lasso_recadrer', 'Select : lasso autour du torse puis Crop (garder la selection ; le maillage doit se reduire)', 'ws-mesh-selectface-btn', async () => { await h.clic('me-sel-lasso'); await s.dormir(400); await mouse('#me-canvas', [[0.42, 0.36], [0.58, 0.36], [0.58, 0.6], [0.42, 0.6], [0.42, 0.36]]); await s.dormir(900); await h.clic('me-sel-crop'); await s.dormir(900); });
  await edit('select_pinceau_grow_supprimer', 'Select : pinceau + Grow x2 puis Suppr (la zone supprimee doit etre plus grande que le coup de pinceau)', 'ws-mesh-selectface-btn', async () => { await mouse('#me-canvas', [[0.5, 0.3], [0.5, 0.32]]); await s.dormir(700); await h.clic('me-sel-grow'); await h.clic('me-sel-grow'); await s.dormir(700); await h.clic('me-sel-delete'); await s.dormir(800); });
  await edit('select_inverser_supprimer', 'Select : pinceau + Invert puis Suppr (ne reste que le coup de pinceau)', 'ws-mesh-selectface-btn', async () => { await mouse('#me-canvas', [[0.5, 0.45], [0.52, 0.47]]); await s.dormir(700); await h.clic('me-sel-invert'); await s.dormir(700); await h.clic('me-sel-delete'); await s.dormir(800); });
  await edit('select_dupliquer', 'Select : pinceau + Duplicate (copie dans un nouveau calque : le nombre de faces doit augmenter)', 'ws-mesh-selectface-btn', async () => { await mouse('#me-canvas', [[0.5, 0.45], [0.52, 0.47]]); await s.dormir(700); await h.clic('me-sel-duplicate'); await s.dormir(1000); });
  await edit('select_retourner_normales', 'Select : tout selectionner + Flip normals puis enregistrer (faces voisines retournees attendues)', 'ws-mesh-selectface-btn', async () => { await h.clic('me-sel-all'); await s.dormir(700); await h.clic('me-sel-flip'); await s.dormir(1000); });
  await edit('select_lisser', 'Select : pinceau + Smooth de la selection (laplacien sur les seuls sommets choisis)', 'ws-mesh-selectface-btn', async () => { await mouse('#me-canvas', [[0.48, 0.45], [0.52, 0.5]]); await s.dormir(700); await h.clic('me-sel-smooth'); await s.dormir(1000); });
  await edit('select_isoler', 'Select : pinceau + Isolate puis enregistrer (la version enregistree ne garde-t-elle que la selection ?)', 'ws-mesh-selectface-btn', async () => { await mouse('#me-canvas', [[0.46, 0.4], [0.54, 0.5]]); await s.dormir(700); await h.clic('me-sel-isolate'); await s.dormir(1000); });
  // ---- sans souris : tout se fait par clics sur des boutons
  await edit('select_tout_retourner_normales', 'Select : All puis Flip normals (aucun trait de souris) puis enregistrer : les faces voisines retournees doivent apparaitre', 'ws-mesh-selectface-btn', async () => { await h.clic('me-sel-all'); await s.dormir(900); await h.clic('me-sel-flip'); await s.dormir(1000); }, false);
  await edit('select_tout_dupliquer', 'Select : All puis Duplicate (le nombre de faces doit doubler : copie dans un nouveau calque) puis enregistrer', 'ws-mesh-selectface-btn', async () => { await h.clic('me-sel-all'); await s.dormir(900); await h.clic('me-sel-duplicate'); await s.dormir(1000); }, false);
  await edit('select_tout_lisser', 'Select : All puis Smooth de la selection (laplacien) puis enregistrer', 'ws-mesh-selectface-btn', async () => { await h.clic('me-sel-all'); await s.dormir(900); await h.clic('me-sel-smooth'); await s.dormir(1000); }, false);
  await edit('select_tout_supprimer', 'Select : All puis Delete puis enregistrer (que doit faire l\'outil quand on supprime TOUT : refuser, ou ecrire un fichier vide ?)', 'ws-mesh-selectface-btn', async () => { await h.clic('me-sel-all'); await s.dormir(900); await h.clic('me-sel-delete'); await s.dormir(1000); }, false);
  await edit('peinture_lisser', 'Paint : Smooth (lissage des couleurs de sommets) sans trait puis enregistrer', 'ws-mesh-paintvert-btn', async () => { await h.clic('me-tool-paint'); await s.dormir(500); await h.clic('me-paint-smooth'); await s.dormir(1000); }, false);
  await edit('peinture_remplir_rouge', 'Paint : couleur rouge + Fill all (la texture / les couleurs de sommets doivent changer)', 'ws-mesh-paintvert-btn', async () => { await h.clic('me-tool-paint'); await s.dormir(500); await h.remplir({ '#me-paint-color': '#ff0000' }); await s.dormir(400); await h.clic('me-paint-fill'); await s.dormir(1000); }, false);
}

// ------------------------------------------------------------------ PAINT MESH : outils et couche emissive (le « Paint Emissive » de la doc = bascule dans Paint Mesh)
if (on('paint')) {
  const pm = async (nom, chip, notes, script, aligner = true, needsMouse = true) => { if (needsMouse && !(await s.sourisDispo())) { s.nonTestable('04_mesh_paint_suite', nom, PROJ, notes); return null; } return pmReel(nom, chip, notes, script, aligner); };
  const pmReel = (nom, chip, notes, script, aligner = true) => s.essai({ groupe: '04_mesh_paint_suite', nom, projet: PROJ, genre: 'mesh', geom: false, lourd: false, max: 300000, avant: prep(PROJ, chip, aligner), notes,
    lancer: async () => {
      const o = await h.clic('ws-mesh-paint-mesh-btn'); if (!o.ok) return { ok: false, error: 'ouverture : ' + JSON.stringify(o).slice(0, 150) }; await s.dormir(4500);
      const c = await h.catalogue('canvas'); const cv = ((c.data && c.data.elements) || []).find((x) => /modal-paint-mesh/.test(x.zone || '') && x.tag === 'canvas');
      const cible = cv ? cv.ref : '#pm-canvas';
      await script(cible); await s.dormir(800); return await h.clic('pm-save'); } });
  const trait = [[0.44, 0.40], [0.56, 0.44], [0.46, 0.52], [0.56, 0.58]];
  await pm('paint_emissive_vide_v6', 'v6', 'Paint Mesh en mode emissif SANS trait puis enregistrer (la couleur de base doit rester identique ; une carte emissive vide apparait-elle ?)', async () => { await h.clic('pm-toggle-emissive'); await s.dormir(500); }, true, false);
  await pm('paint_emissive_v4', 'v4', 'Paint Mesh en mode EMISSIF (bascule 💡) sur v4 (4096 px) : la couleur de base doit rester intacte, une carte emissive doit apparaitre', async (cible) => { await h.clic('pm-toggle-emissive'); await s.dormir(500); await h.remplir({ '#pm-color': '#00ffff' }); await mouse(cible, trait); });
  await pm('paint_spray_v6', 'v6', 'Paint Mesh : outil spray (couleur verte) sur la version allegee', async (cible) => { await h.clic('pm-tool-spray'); await h.remplir({ '#pm-color': '#00ff00' }); await s.dormir(400); await mouse(cible, trait); }, false);
  await pm('paint_gomme_v6', 'v6', 'Paint Mesh : stylo rouge puis gomme par-dessus (la texture doit revenir proche de l\'original)', async (cible) => { await h.remplir({ '#pm-color': '#ff0000' }); await mouse(cible, trait); await s.dormir(500); await h.clic('pm-tool-eraser'); await mouse(cible, trait); }, false);
}

// ------------------------------------------------------------------ TEX : outils de texture rejoues (defauts de la 1re campagne) sur la version allegee et sur un autre sujet
if (on('tex')) {
  await s.essai({ groupe: '04_mesh_tex_suite', nom: 'texvar_rouille_force70_v6', projet: PROJ, genre: 'mesh', lourd: true, max: 900000, avant: prep(PROJ, 'v6'),
    notes: 'Texture variants : style « rusty », force 70 % (campagne 1 : « golden » a 40 % sans effet visible) : la texture doit changer nettement, la geometrie ne bouge pas',
    lancer: async () => { const o = await outil('ws-mesh-texvar-btn'); if (!o.ok) return o; await h.remplir({ '#modal-mesh-tool input[type=text]': 'rusty', '#modal-mesh-tool input.fen-valeur': 70 }); await s.dormir(800); return await h.clic('mt-apply'); } });
  await s.essai({ groupe: '04_mesh_tex_suite', nom: 'sharpen_texture_cochon', projet: 'cochon_volant', genre: 'mesh', lourd: true, max: 900000, avant: prep('cochon_volant', 'v1'),
    notes: 'Sharpen texture (x2) sur un AUTRE sujet (cochon volant, texture 8192) : le plafond de taille est-il respecte ? duree ?',
    lancer: async () => { const o = await h.clic('ws-mesh-enhance-tex-btn'); if (!o.ok) return { ok: false, error: 'ouverture : ' + JSON.stringify(o).slice(0, 150) }; await s.dormir(1500); const g = await h.clic('lct-lancer'); return g; } });
  await s.essai({ groupe: '04_mesh_tex_suite', nom: 'material_adjust_bus', projet: 'bus', genre: 'mesh', lourd: false, max: 300000, avant: prep('bus', 'v0', true),
    notes: 'Material adjust sur le bus (autre sujet) : luminosite 1,2 saturation 0,8 (selection alignee par « Use this mesh » : contournement du defaut selectedMeshPath)',
    lancer: async () => { const o = await h.clic('ws-mesh-material-btn'); if (!o.ok) return { ok: false, error: 'ouverture' }; await s.dormir(3500); await h.remplir({ '#mat-brightness': 1.2, '#mat-saturation': 0.8 }); await s.dormir(1200); return await h.clic('mat-apply-btn'); } });
  await s.essai({ groupe: '04_mesh_tex_suite', nom: 'detail_plus_plus_cochon', projet: 'cochon_volant', genre: 'mesh', lourd: true, max: 1500000, avant: prep('cochon_volant', 'v1'),
    notes: 'Detail++ sur un autre sujet (cochon volant) : detail IA sur la texture',
    lancer: async () => { const o = await h.clic('ws-mesh-detail-synth-btn'); if (!o.ok) return { ok: false, error: 'ouverture : ' + JSON.stringify(o).slice(0, 150) }; await s.dormir(1500); return await h.clic('lct-lancer'); } });
}

// ------------------------------------------------------------------ STAGES : 3D construction stages (« Fabricate ») sur un objet rigide, et diagnostic de la case Watertight « Keep original detail »
if (on('stages')) {
  await s.essai({ groupe: '04_mesh_stages_suite', nom: 'construction_3d_fabriquer_bus', projet: 'bus', genre: 'mesh', geom: false, lourd: false, max: 400000, avant: prep('bus', 'v0'),
    notes: 'Construction stages 3D (5 etapes, materiau auto) sur le bus : le dossier d\'etapes doit contenir 5 GLB navigables ; le maillage final reste la derniere etape',
    lancer: async () => { const o = await h.clic('ws-mesh-stages3d-btn'); if (!o.ok) return { ok: false, error: 'ouverture : ' + JSON.stringify(o).slice(0, 150) }; await s.dormir(2500); return await h.clic('bs3d-start'); },
    post: async (l) => { const f = s.fichiersApres(Date.now() - 400000).filter((x) => /stages|stage/i.test(x.p)); l.etapes_fichiers = f.map((x) => x.f).slice(0, 12); l.etapes_nombre = f.length; } });
}
if (on('diag')) {
  if (await s.garde(false)) {
    s.note('=== diag / watertight_case_keepdetail');
    await s.fermerTout(); await s.ouvrirProjet(PROJ); await s.puce('step-card-mesh', 'v6');
    await h.clic('ws-mesh-watertight-btn'); await s.dormir(3000);
    const avant = (await s.liste('modal:modal-mesh-tool')).filter((x) => x.type === 'checkbox' || /Keep original/i.test(x.label || ''));
    await h.remplir({ '#modal-mesh-tool input[type=checkbox]': true }); await s.dormir(500);
    const apres = (await s.liste('modal:modal-mesh-tool')).filter((x) => x.type === 'checkbox' || /Keep original/i.test(x.label || ''));
    const { appendFileSync } = await import('node:fs');
    appendFileSync(s.JSONL, JSON.stringify({ groupe: '04_mesh_diag', nom: 'watertight_case_keepdetail_etat', projet: PROJ, ok: true, avant, apres, note: 'etat de la case « Keep original detail » avant / apres /ui/fill (le test watertight_garder_detail a perdu texture et UV : la case etait-elle cochee ?)' }) + String.fromCharCode(10));
    s.note('   case avant ' + JSON.stringify(avant).slice(0, 300) + ' apres ' + JSON.stringify(apres).slice(0, 300));
    await s.fermerTout();
  }
}

// ------------------------------------------------------------------ REJOUER : essais a refaire pour obtenir le message d'erreur (fenetre finale capturee) ou verifier un doute
if (on('rejouer')) {
  await s.essai({ groupe: '04_mesh_tex_suite', nom: 'sharpen_texture_cochon_rejeu', projet: 'cochon_volant', genre: 'mesh', lourd: true, max: 900000, avant: prep('cochon_volant', 'v1'),
    notes: 'Sharpen texture (x2) sur le cochon volant (texture 8192) : REJEU pour lire le message d\'erreur (le premier essai s\'est termine sans fichier ni message)',
    lancer: async () => { const o = await h.clic('ws-mesh-enhance-tex-btn'); if (!o.ok) return { ok: false, error: 'ouverture : ' + JSON.stringify(o).slice(0, 150) }; await s.dormir(1500); return await h.clic('lct-lancer'); } });
  await s.essai({ groupe: '04_mesh_edit_suite', nom: 'select_tout_retourner_normales_rejeu', projet: PROJ, genre: 'mesh', geom: true, lourd: false, max: 300000, avant: prep(PROJ, 'v6'),
    notes: 'REJEU : Select All + Flip normals + Save : le premier essai n\'a cree aucune version et n\'a affiche aucun message ; on capture les messages et le bouton Save',
    lancer: async () => { const o = await h.clic('ws-mesh-selectface-btn'); if (!o.ok) return { ok: false, error: 'ouverture' }; await s.dormir(4800); await h.clic('me-sel-all'); await s.dormir(1200); const t1 = await h.toasts(); const f = await h.clic('me-sel-flip'); await s.dormir(1500); const t2 = await h.toasts(); s.note('   toasts apres All : ' + JSON.stringify((t1 || []).map((x) => x.text).slice(-2)) + ' ; apres Flip : ' + JSON.stringify((t2 || []).map((x) => x.text).slice(-2)) + ' ; flip=' + JSON.stringify(f).slice(0, 200)); await s.dormir(500); const sv = (await s.liste('modal:modal-mesh-edit')).find((x) => x.ref === '#me-save'); s.note('   etat du bouton Save : ' + JSON.stringify(sv)); return await h.clic('me-save'); } });
}

// ------------------------------------------------------------------ ETAT : outils qui dependent d'une installation ou qui n'ont pas ete essayes
if (on('etat')) {
  const lireFenetre = async (nom, ouvrirBtn, attente = 3500, puisClic = null) => {
    if (!(await s.garde(false))) return;
    s.note('=== etat / ' + nom);
    await s.fermerTout(); if (!(await s.ouvrirProjet(PROJ))) return;
    await s.puce('step-card-mesh', 'v6');
    const o = await h.clic(ouvrirBtn); await s.dormir(attente);
    if (puisClic) { const c2 = await h.clic(puisClic); await s.dormir(4000); s.note('   clic « ' + puisClic + ' » : ' + JSON.stringify(c2).slice(0, 160)); const j = await h.jobs(); if (j.length) s.note('   !!! un travail est parti : ' + JSON.stringify(j).slice(0, 200)); }
    const m = await h.modale(); const t = await h.toasts();
    const fen = (m.data || []).map((x) => ({ id: x.id, titre: x.titre, texte: String(x.texte || '').slice(0, 700), boutons: (x.boutons || []).map((b) => b.label), champs: (x.champs || []).map((c) => c.ref + '=' + c.value) }));
    const ligne = { groupe: '04_mesh_etat', nom, projet: PROJ, ok: true, clic: o.ok, fenetres: fen, toasts: (t || []).map((x) => x.text).slice(-3), note: 'observation seule (aucun bouton Install / Delete clique)' };
    require_append(ligne); s.note('   ' + JSON.stringify(fen).slice(0, 600));
    return fen;
  };
  const { appendFileSync } = await import('node:fs');
  function require_append(l) { appendFileSync(s.JSONL, JSON.stringify(l) + '\n'); }
  await lireFenetre('segment_parts_etat', 'ws-mesh-segment-btn', 3500, 'seg-go');
  await s.fermerTout();
  await lireFenetre('name_the_zones_etat', 'ws-mesh-name-btn');
  await s.fermerTout();
  await lireFenetre('decals_fenetre', 'ws-mesh-aligntex-btn', 5000);
  await s.fermerTout();
  await lireFenetre('construction_3d_options', 'ws-mesh-stages3d-btn');
  await s.fermerTout();
  await lireFenetre('reshape_draw_fenetre', 'ws-mesh-reshape-draw-btn', 5000);
  await s.fermerTout();
}
s.note('############ FIN t76 (' + groupes.join(',') + ')');
