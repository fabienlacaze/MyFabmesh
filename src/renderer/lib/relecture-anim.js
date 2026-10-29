// RELECTURE + CORRECTION DU REALISME D'UNE ANIMATION PAR QWEN3.6, A CHAQUE GENERATION (29/10, decision du user : « Qwen3.6 doit faire le
// travail qu'on fait maintenant de maniere automatique pour rendre realistes les animations », « a chaque generation »).
// Fichier COMMUN au site (cloud/public/app/lib) et au bureau (src/renderer/lib) : copies identiques.
//
// La page calcule l'animation (moteur procedural), la MESURE et DESSINE les squelettes (camera fixe), puis demande a Qwen3.6 (via le
// serveur, route /api/anim-review) des LEVIERS (multiplicateurs du moteur, voir LEVIERS_ACTION dans locomotion-procedurale.js). Un candidat
// n'est garde que s'il respecte les garde-fous mesures (sol, glissement des pieds, a-coups) ET gagne la COMPARAISON avec la version
// courante (Qwen3.6 dit laquelle est la plus realiste ; l'ordre A / B alterne d'un tour a l'autre). 3 tours au plus (6 appels).
import { __interne } from './locomotion-procedurale.js';

const { charger, detecterPattes, animerAllureSure, _fkMonde } = __interne;
export const ALLURES_RELISIBLES = ['attack', 'hit', 'eat', 'drink', 'lie_down'];   // actions dont les courbes portent les leviers
const LEVIERS = ['deplacement', 'bascule', 'rebond', 'rotation', 'roulis', 'tete', 'hauteurPattes', 'ecart', 'bras', 'crochets', 'vitesse'];
const PAS_MAX = 0.35, CHANGEMENTS_MAX = 4, TOURS = 3;

export function relisible(cle) { return ALLURES_RELISIBLES.includes(String(cle).split('__')[0]); }

/** Leviers proposes -> leviers retenus : connus, numeriques, bornes [0,3 ; 3], au plus PAS_MAX de la valeur courante, 4 au plus. Pure. */
export function validerChangements(changements, actuels) {
  const out = {};
  if (!changements || typeof changements !== 'object') return out;
  for (const [k, v] of Object.entries(changements)) {
    if (!LEVIERS.includes(k)) continue;
    const x = Number(v);
    if (!Number.isFinite(x)) continue;
    const a = actuels[k] ?? 1;
    const y = Math.round(Math.min(3, Math.max(0.3, a + Math.max(-PAS_MAX, Math.min(PAS_MAX, x - a)))) * 1000) / 1000;
    if (Math.abs(y - a) < 1e-6) continue;
    out[k] = y;
    if (Object.keys(out).length >= CHANGEMENTS_MAX) break;
  }
  return out;
}

/** Garde-fous : le candidat ne doit pas enfoncer d'os sous le sol, faire glisser un pied ni creer d'a-coup de plus que la version courante. Pure. */
export function gardeFous(courant, candidat) {
  if (!candidat || !candidat.ok) return 'animation impossible';
  if (candidat.sous_sol_pctH > Math.max(courant.sous_sol_pctH, 0.5) + 0.1) return 'bones below the ground';
  if (candidat.glissement_pctH > Math.max(courant.glissement_pctH, 1.5) + 0.3) return 'feet slide';
  if (candidat.acoups_deg > Math.max(courant.acoups_deg * 1.3, 60)) return 'joint pops';
  return null;
}

/** Anime UN clip (cle « attack », « attack__kick »...) avec ces leviers, rend positions et mesures. */
export function mesurer(sq, cle, { mode = 'auto', espece = 'generique', leviers = {} } = {}) {
  const [allure, variante = 'normal'] = cle.split('__');
  const avant = globalThis.__reglagesAnim;
  globalThis.__reglagesAnim = { [cle]: leviers };
  try {
    const clip = animerAllureSure(sq, allure, 1, 30, variante, mode, espece);
    const { P } = _fkMonde(sq, clip);
    const H = Math.max(...sq.P0.map((p) => p[1])) - Math.min(...sq.P0.map((p) => p[1])) || 1;
    const det = detecterPattes(sq.par, sq.P0, sq.racine);
    // glissement : pour chaque bout de patte, deplacement horizontal d'une image a l'autre quand il est au contact (a 1 % H de son point le plus bas)
    let glis = 0;
    for (const p of det.pattes) {
      const j = p.chaine[p.chaine.length - 1], y0 = Math.min(...P.map((F) => F[j][1]));
      for (let i = 1; i < P.length; i++) {
        const a = P[i - 1][j], b = P[i][j];
        if (a[1] - y0 < 0.01 * H && b[1] - y0 < 0.01 * H) glis = Math.max(glis, Math.hypot(b[0] - a[0], b[2] - a[2]));
      }
    }
    const r = clip.racineMonde, z = r.map((q) => q[2]), y = r.map((q) => q[1]);
    const pct = (v) => Math.round(1000 * v / H) / 10;
    return {
      ok: true, P, par: sq.par, H, jambes: det.pattes.map((p) => p.chaine),
      duree_s: Math.round(100 * (P.length - 1) / 30) / 100,
      deplacement_avant_pctH: pct(Math.max(...z) - z[0]), recul_pctH: pct(z[0] - Math.min(...z)), mouvement_vertical_pctH: pct(Math.max(...y) - Math.min(...y)),
      glissement_pctH: pct(glis), sous_sol_pctH: +clip.infos.sous_sol_pct || 0, acoups_deg: +clip.infos.acoups_max_deg || 0, amplitude_reduite: clip.infos.ampleur ?? 1,
    };
  } catch (e) {
    return { ok: false, erreur: String(e && e.message || e) };
  } finally {
    globalThis.__reglagesAnim = avant;
  }
}
const resume = (m) => ({ duration_s: m.duree_s, forward_travel_pct: m.deplacement_avant_pctH, recoil_pct: m.recul_pctH, vertical_motion_pct: m.mouvement_vertical_pctH,
  foot_slide_pct: m.glissement_pctH, below_ground_pct: m.sous_sol_pctH, max_joint_jump_deg: m.acoups_deg, auto_amplitude_cut: m.amplitude_reduite });

/** Dessine `nb` images du cycle (2 par image : rangees ; profil a gauche, face a droite), camera FIXE (le deplacement se voit). Rend des JPEG base64. */
export function dessiner(m, nb = 8, taille = 224) {
  const n = m.P.length, roles = new Set(m.jambes.flat()), F0 = m.P[0];
  const cz = F0.reduce((s, p) => s + p[2], 0) / F0.length, cx = F0.reduce((s, p) => s + p[0], 0) / F0.length;
  const sol = Math.min(...m.P.flat().map((p) => p[1])), ech = taille * 0.62 / m.H;
  const images = [];
  for (let k = 0; k < nb / 2; k++) {
    const c = document.createElement('canvas'); c.width = 2 * taille; c.height = 2 * taille;
    const g = c.getContext('2d');
    g.fillStyle = '#f4f4f4'; g.fillRect(0, 0, c.width, c.height);
    for (let rang = 0; rang < 2; rang++) {
      const F = m.P[Math.min(n - 1, Math.round((2 * k + rang) * (n - 1) / (nb - 1)))];
      for (let vue = 0; vue < 2; vue++) {
        const ox = vue * taille, oy = rang * taille, base = oy + taille * 0.9;
        const pt = (p) => [ox + taille / 2 + (vue === 0 ? (p[2] - cz) : -(p[0] - cx)) * ech, base - (p[1] - sol) * ech];
        g.strokeStyle = '#a0a0a0'; g.lineWidth = 1; g.beginPath(); g.moveTo(ox, base); g.lineTo(ox + taille, base); g.stroke();
        for (let j = 0; j < m.par.length; j++) {
          const q = m.par[j]; if (q < 0) continue;
          const [x1, y1] = pt(F[q]), [x2, y2] = pt(F[j]);
          g.strokeStyle = roles.has(j) ? '#1e50dc' : '#202020'; g.lineWidth = roles.has(j) ? 2.5 : 1.5;
          g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
        }
        g.fillStyle = '#000'; g.font = '11px sans-serif'; g.fillText(`frame ${2 * k + rang + 1}/${nb} ${vue === 0 ? 'side' : 'front'}`, ox + 4, oy + 13);
      }
    }
    images.push(c.toDataURL('image/jpeg', 0.82).split(',')[1]);
  }
  return images;
}

/**
 * Boucle de relecture pour UN clip. `appeler(corps)` envoie a /api/anim-review et rend la reponse JSON. `etat(texte)` (facultatif) suit la progression.
 * Rend { leviers, journal, rembourse } ; leviers = {} si rien n'a ete garde (le clip reste celui du moteur).
 */
export async function relireClip(brutOuSq, cle, { mode = 'auto', espece = 'generique', appeler, etat = () => {} } = {}) {
  const sq = brutOuSq && brutOuSq.par ? brutOuSq : charger(brutOuSq);
  const journal = [];
  const d = await appeler({ action: 'debut', allure: cle });
  if (!d || !d.ok || !d.jeton) return { leviers: {}, journal: [{ fin: d && (d.error || d.raison) || 'refused' }] };
  const jeton = d.jeton;
  let meilleur = {}, mB = mesurer(sq, cle, { mode, espece, leviers: meilleur }), aboutis = 0;
  if (!mB.ok) return { leviers: {}, journal: [{ fin: mB.erreur }] };
  const refus = [];
  for (let tour = 1; tour <= TOURS; tour++) {
    etat(`AI review ${tour}/${TOURS}`);
    const p = await appeler({ action: 'appel', jeton, mode: 'proposer', allure: cle, espece, leviers: meilleur, mesures: resume(mB), refus, images: dessiner(mB, 8) }).catch(() => null);
    if (!p || !p.ok) { journal.push({ tour, fin: (p && (p.error || p.raison)) || 'unreachable' }); break; }
    aboutis++;
    const ch = validerChangements(p.changements, meilleur);
    const T = { tour, analyse: p.analyse, propose: p.changements, retenu: ch };
    if (!Object.keys(ch).length) { T.resultat = 'no usable change'; journal.push(T); continue; }
    const cand = { ...meilleur, ...ch }, mC = mesurer(sq, cle, { mode, espece, leviers: cand });
    const g = gardeFous(mB, mC);
    if (g) { T.resultat = 'rejected: ' + g; refus.push(JSON.stringify(ch) + ' -> ' + g); journal.push(T); continue; }
    // comparaison : l'ordre alterne (tour impair : courant = A, candidat = B ; tour pair : l'inverse) pour ne pas favoriser une position
    const inverse = tour % 2 === 0, iB = dessiner(mB, 4), iC = dessiner(mC, 4);
    const c = await appeler({ action: 'appel', jeton, mode: 'comparer', allure: cle, espece, images: inverse ? [...iC, ...iB] : [...iB, ...iC] }).catch(() => null);
    if (!c || !c.ok) { T.resultat = 'comparison failed'; journal.push(T); break; }
    aboutis++;
    const gagne = inverse ? c.meilleur === 'A' : c.meilleur === 'B';
    T.resultat = gagne ? 'kept' : 'not better'; T.raison = c.raison;
    if (gagne) { meilleur = cand; mB = mC; } else refus.push(JSON.stringify(ch) + ' -> judged not better');
    journal.push(T);
  }
  let rembourse = false;
  if (!aboutis) { const r = await appeler({ action: 'rembourser', jeton }).catch(() => null); rembourse = !!(r && r.ok); }
  return { leviers: meilleur, journal, rembourse };
}
