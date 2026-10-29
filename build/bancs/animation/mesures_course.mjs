// Mesures d'une course / marche anatomique (banc de relecture par Qwen3.6, build/bancs/animation/relecture_qwen.py).
// usage : [REGLAGES='{"run":{...}}'] [POSITIONS=<fichier.json>] node mesures_course.mjs <moteur.js> <rig.glb> <allure: run|walk> [variante: normal|jog|sprint]
// Sortie : une ligne JSON (vitesse, vol, glissement, tete, buste, genoux, bras, a-coups). POSITIONS : ecrit aussi 8 images d'un cycle (positions
// monde des os + parents + roles), pour dessiner les squelettes sans navigateur.
// Reprise de C:/tmp/anim_auto/ca_mes.mjs (banc du 28-29/10), plus a-coups, mains / yeux, et sortie des positions.
if (process.env.REGLAGES) globalThis.__reglagesCourse = JSON.parse(process.env.REGLAGES);
globalThis.__debugCourse = true;
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const [mot, rig, allure = 'run', variante = 'normal'] = process.argv.slice(2);
const src = readFileSync(mot, 'utf8').replace(/\r\n/g, '\n');
const dossier = join(tmpdir(), 'fabmesh_banc_anim'); mkdirSync(dossier, { recursive: true });
const out = join(dossier, 'm_' + createHash('md5').update(src).digest('hex').slice(0, 10) + '.mjs');
writeFileSync(out, src + '\nexport const __ca = { animerAllureSure, detecterPattes, charger, _fkMonde };\n');
const M = (await import(pathToFileURL(out).href)).__ca;
const b = readFileSync(rig);
const sq = M.charger(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
const clip = M.animerAllureSure(sq, allure, 3, 30, variante, 'auto', 'humain');
const { D, P } = M._fkMonde(sq, clip);
const det = M.detecterPattes(sq.par, sq.P0, sq.racine);
const H = Math.max(...sq.P0.map((p) => p[1])) - Math.min(...sq.P0.map((p) => p[1])), sol = Math.min(...sq.P0.map((p) => p[1]));
const n = P.length, fps = clip.fps || 30;
const r1 = (x, d = 2) => +x.toFixed(d), deg = 180 / Math.PI;
const sub = (a, c) => [a[0] - c[0], a[1] - c[1], a[2] - c[2]], dot = (a, c) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2], nrm = (a) => Math.hypot(...a);
const r = sq.racine;
const T = clip.infos.periode || 0, Tf = T ? Math.round(T * fps) : Math.round((n - 1) / 3);
const o = { moteur: clip.infos.moteur_course || 'ancien', periode_s: r1(Tf / fps, 3), cadence_pas_s: r1(2 * fps / Tf, 2) };
o.vitesse_Hs = r1(Math.hypot(P[n - 1][r][0] - P[0][r][0], P[n - 1][r][2] - P[0][r][2]) / H / ((n - 1) / fps), 2);
const pieds = det.pattes.map((p) => p.bout), dgj = (clip.infos.diag || {}).jambes || [];
const hrest = (j) => sq.P0[j][1] - sol;
const haut = pieds.map((j) => { const q = dgj.find((x) => x.cheville === j || x.toe === j); return P.map((F) => (q && q.toe >= 0 ? Math.min(F[q.toe][1] - sol - hrest(q.toe), F[q.cheville][1] - sol - hrest(q.cheville)) : F[j][1] - sol - hrest(j))); });
let air = 0; for (let i = 0; i < n - 1; i++) if (Math.min(...haut.map((h) => h[i])) > 0.005 * H) air++;
o.phase_aerienne_pct = r1(100 * air / (n - 1), 0);
o.glissement_max_par_appui_pctH = pieds.map((j, k) => {
  const q = dgj.find((x) => x.cheville === j || x.toe === j), pt = q && q.toe >= 0 ? q.toe : j, runs = []; let cur = 0, dedans = false;
  for (let i = 1; i < n; i++) { const a = P[i - 1][pt], c = P[i][pt]; const app = haut[k][i - 1] < 0.005 * H && haut[k][i] < 0.005 * H && (!q || q.toe < 0 || (a[1] - sol < 0.005 * H && c[1] - sol < 0.005 * H)); if (app) { cur += Math.hypot(c[0] - a[0], c[2] - a[2]); dedans = true; } else if (dedans) { runs.push(cur); cur = 0; dedans = false; } }
  if (dedans) runs.push(cur);
  return r1(100 * Math.max(0, ...runs) / H, 2);
});
let ecC = 0; for (let i = 0; i < n; i++) for (let k = 0; k < 2; k++) if (haut[k] && haut[k][i] < 0.03 * H && pieds.length >= 2) ecC = Math.max(ecC, Math.abs(P[i][pieds[0]][0] - P[i][pieds[1]][0]));
o.ecart_entre_pieds_pctH = r1(100 * ecC / H, 1);
let sommet = 0; sq.P0.forEach((p, j) => { if (p[1] > sq.P0[sommet][1]) sommet = j; });
const ty = P.map((F) => F[sommet][1]); o.tete_verticale_pctH = r1(100 * (Math.max(...ty) - Math.min(...ty)) / H, 2);
const ang = (A) => Math.acos(Math.max(-1, Math.min(1, (A[0] + A[4] + A[8] - 1) / 2))) * deg;
let amax = 0; for (const Dd of D) { const rel = new Array(9).fill(0); for (let a = 0; a < 3; a++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) rel[3 * a + c] += D[0][sommet][3 * k + a] * Dd[sommet][3 * k + c]; amax = Math.max(amax, ang(rel)); }
o.tete_orientation_ecart_max_deg = r1(amax, 1);
let mn = 1e9; for (const F of P) for (const p of F) mn = Math.min(mn, p[1]); o.os_sous_sol_pctH = r1(100 * Math.max(0, sol - mn) / H, 2);
o.acoups_max_deg = r1(clip.infos.acoups_max_deg ?? 0, 1);
const dg = clip.infos.diag; o.bras = [];
if (dg) {
  const mo = dg.voie[dg.m]; let l0 = 0, lm = -90; for (const F of P) { const v = sub(F[mo], F[r]); const a = Math.atan2(v[2], v[1]) * deg; l0 += a / n; lm = Math.max(lm, a); }
  o.buste_deg = { moyenne: r1(l0, 1), max: r1(lm, 1) };
  const tete = dg.voie[dg.voie.length - 1], cou = dg.voie[Math.min(dg.voie.length - 1, dg.m + 1)];
  // tete : inclinaison du segment cou -> sommet par rapport au buste (+ = tete penchee vers l'avant plus que le buste)
  let tt = 0; for (const F of P) { const vt = sub(F[tete], F[cou]), vb = sub(F[mo], F[r]); tt += (Math.atan2(vt[2], vt[1]) - Math.atan2(vb[2], vb[1])) * deg / n; }
  o.tete_vs_buste_deg = r1(tt, 1);
  const yeux = P.map((F) => F[cou][1] + 0.6 * (F[tete][1] - F[cou][1]));
  for (const q of dg.bras) {
    const sh = q.epaule, el = q.coude, h = q.poignet;
    const a = P.map((F) => { const u = sub(F[sh], F[el]), v = sub(F[h], F[el]); return Math.acos(dot(u, v) / nrm(u) / nrm(v)) * deg; });
    const hr = P.map((F) => (F[h][1] - F[sh][1]) / H * 100), hy = P.map((F, i) => (F[h][1] - yeux[i]) / H * 100);
    const abdu = P.map((F) => { const u = sub(F[el], F[sh]); return Math.asin(Math.abs(u[0]) / nrm(u)) * deg; });
    const swing = P.map((F) => { const u = sub(F[el], F[sh]); return Math.atan2(u[2], -u[1]) * deg; });
    o.bras.push({ cote: q.cote, coude_flexion_deg: [r1(180 - Math.max(...a), 0), r1(180 - Math.min(...a), 0)], abduction_bras_deg: [r1(Math.min(...abdu), 0), r1(Math.max(...abdu), 0)],
      balancement_bras_deg: [r1(Math.min(...swing), 0), r1(Math.max(...swing), 0)], main_vs_epaule_pctH: [r1(Math.min(...hr), 0), r1(Math.max(...hr), 0)], main_vs_yeux_max_pctH: r1(Math.max(...hy), 1) });
  }
  o.genou_flexion_deg = dg.jambes.map((q) => { const a = P.map((F) => { const u = sub(F[q.hanche], F[q.genou]), v = sub(F[q.cheville], F[q.genou]); return 180 - Math.acos(dot(u, v) / nrm(u) / nrm(v)) * deg; }); return [r1(Math.min(...a), 0), r1(Math.max(...a), 0)]; });
}
if (process.env.POSITIONS) {
  const roles = {};
  det.pattes.forEach((p) => p.chaine.forEach((j) => { roles[j] = 'jambe'; }));
  if (dg) { for (const q of dg.bras) for (const j of [q.epaule, q.coude, q.poignet]) roles[j] = 'bras'; for (const j of dg.voie) roles[j] = 'colonne'; }
  const images = Array.from({ length: 8 }, (_, k) => P[Math.min(n - 1, Tf + Math.round(k * Tf / 8))].map((p) => p.map((x) => +(x / H).toFixed(4))));
  writeFileSync(process.env.POSITIONS, JSON.stringify({ par: sq.par, roles, sol: sol / H, images }));
}
console.log(JSON.stringify(o));
