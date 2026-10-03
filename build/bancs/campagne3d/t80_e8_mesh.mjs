// E8 (2/2) : image -> 3D en local, palier Fast. Mesure : duree, VRAM, journaux (pas transmis, atlas, remplissage au bord proche, code de sortie), validation + rendu du GLB.
import * as l from './t80_lib.mjs';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
const h = l.h;
if (l.stop()) { l.note('STOP present'); process.exit(0); }
await l.fermerModales();
const NOM = 'verif_t80_orc';
if ((await l.nomProjet()) !== NOM) await l.ouvrirProjet(NOM);
await h.clic('ws-use-for-3d-btn'); await l.dormir(1500);
const ch = await h.remplir({ '#ws-trellis2-preset': 'fast' }); await l.dormir(600);
const etat = await l.eval_('return JSON.stringify({preset: document.getElementById("ws-trellis2-preset").value, gen: document.getElementById("ws-generate-mesh").disabled, q3d: (document.getElementById("ws-3d-quality")||{}).value})');
l.note('options : ' + etat + ' remplir=' + JSON.stringify(ch).slice(0, 100));
const p0 = l.pos(); const t0 = Date.now();
const stopG = h.echantillonneur();
const g = await h.clic('ws-generate-mesh'); l.note('clic Generate 3D : ' + JSON.stringify(g).slice(0, 260));
await l.dormir(4000);
await l.modalesApresLancement();
await h.shot('t80_e8_mesh_lancement');
const att = await l.attendre(45 * 60000, 15000);
await l.dormir(2500);
const mes = stopG();
const f = l.fichiersApres(t0).filter((x) => !/_rigged_/.test(x.f) && x.f.startsWith(NOM));
const meta = f.length ? (() => { try { return JSON.parse(readFileSync(f[0].p + '.meta.json', 'utf8')); } catch (_) { return null; } })() : null;
// lignes de journal de la generation
const jr = l.lireDepuis(l.LOG_START, p0.s, 8000000);
const interessantes = jr.split(String.fromCharCode(10)).filter((x) => /steps|FABMESH_TEX|atlas|bord le plus proche|plus proche|TELEA|0xC0000005|exit code|code de sortie|texture|GLB export|DONE|dt=|mode=|voxel/i.test(x)).map((x) => x.slice(0, 260));
const res = { id: 'E8b', nom: 'generation_fast_locale', ok: f.length > 0, options: etat, attente: att, duree_s: Math.round((Date.now() - t0) / 100) / 10, mesures_gpu: mes, fichiers: f.map((x) => x.f + ' ' + x.taille), meta, lignes_journal: interessantes.slice(0, 60), plantage_c5: /0xC0000005|3221225477/i.test(jr), trace_bord_proche: /bord le plus proche/i.test(jr), erreurs_journal: l.erreursDepuis(p0), toasts: ((await h.toasts()) || []).map((x) => x.type + ':' + x.text).slice(-4) };
if (f.length) { res.glb = l.validerGlb(f[0].p); res.geom = l.validerGeom(f[0].p); res.chemin = f[0].p; }
l.ligne(res); l.note('E8b : ' + JSON.stringify({ ok: res.ok, s: res.duree_s, f: res.fichiers, glb: res.glb, c5: res.plantage_c5, bord: res.trace_bord_proche, meta: res.meta && res.meta.params }));
await h.shot('t80_e8_mesh_fin');
