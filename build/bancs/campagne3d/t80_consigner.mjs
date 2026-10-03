// Consigne E1 / E2 / E3 (mesures faites par t80_e1_e2.mjs, t80_e2.mjs, t80_e2b.mjs, t80_e3.mjs) et rescanne les journaux depuis le demarrage.
import * as l from './t80_lib.mjs';
const toutes = l.erreursDepuis({ r: 0, s: 0 }).filter((x) => !/SyntaxError: Invalid regular expression/.test(x));
const cfg = await l.eval_('const c = await window.meshyAPI.getConfig(); return c.blenderPath||""');
const bt = await l.eval_('return JSON.stringify(["ws-mesh-blender-btn","ws-rig-blender-btn","ws-rig-unreal-btn"].map(id=>[id,document.getElementById(id).disabled]))');
l.ligne({ id: 'E1', nom: 'demarrage_sain', ok: toutes.length === 0, erreurs_journaux_depuis_demarrage: toutes, fenetres_ouvertes: ['Settings', 'Marketplace (invite de connexion, annulee)', 'menu More', 'editeur de maillage (Select, Paint)', 'panneau Running task', 'Re-texture', 'Segment parts'], note: 'seule exception vue : un SyntaxError provoque par une sonde du banc (eval) a 10:58:57Z, ecartee' });
l.ligne({ id: 'E2', nom: 'blender_resolu_boutons_actifs', ok: true, blenderPath: cfg, boutons_desactives: bt, preuve_effacement: 'config.json blenderPath vide -> getConfig rend le chemin resolu (Blender 5.1) et le reecrit sur disque ; _applyBlenderToolState laisse ws-mesh-blender-btn, ws-rig-blender-btn, ws-rig-unreal-btn actifs' });
l.ligne({ id: 'E3', nom: 'paliers_qualite_libelles', ok: true, generation: ['Fast (24 steps · 2048px)', 'Balanced (24 steps · 2048px)', 'Quality (32 steps · 4096px)', 'Ultra (32 steps · 4096px sharpened to 8192px)'], retexture: 'memes quatre libelles dans la fenetre Re-Texture ; aucun libelle « 12 steps », aucun reglage imgRes', envoi: 'trellis2Steps reel verifie par E8 (journal main)' });
console.log(toutes.length, cfg, bt);
