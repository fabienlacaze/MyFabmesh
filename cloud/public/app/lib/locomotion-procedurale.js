// Moteur de marche PROCÉDURAL (sans IA, sans données d'animation) pour un squelette quelconque.
// Portage JavaScript de la référence Python validée par l'exploitant le 28/09/2026
// (C:\tmp\procedural_test\locomotion.py + ik_forme.py, branche backup-moteur-procedural-20260928-162700).
// Module autonome, sans dépendance : même fichier sur le bureau et sur le web.
//
//   import { animerGLB, ALLURES } from './locomotion-procedurale.js';
//   const { glb, infos } = animerGLB(arrayBufferDuRig, { allures: ['walk', 'run', 'idle'] });
//
// Repère glTF de nos rigs : Y en haut, face +Z, +X = gauche.

export const ALLURES = {
  // beta : part du cycle au sol ; T : période (<= 4 pattes, 6 et plus) ; h : hauteur de pas ;
  // bob : balancement vertical ; foulee : longueur relative ; lacet : rad/s (+ = vers la gauche) ;
  // tendu : extension des pattes au neutre (bassin abaissé d'autant) ; talon : déroulé du pied
  walk: { beta: 0.65, T: [1.1, 0.7], h: 0.22, bob: 0.035, foulee: 1.0, lacet: 0.0, tendu: 0.965, talon: 0.5, pas: true },
  run: { beta: 0.38, T: [0.62, 0.42], h: 0.22, bob: 0.035, foulee: 1.8, lacet: 0.0, tendu: 0.87, talon: 0.7, pas: true },
  turn_left: { beta: 0.65, T: [1.1, 0.7], h: 0.2, bob: 0.02, foulee: 0.55, lacet: 0.55, tendu: 0.92, talon: 0.35, pas: true },
  turn_right: { beta: 0.65, T: [1.1, 0.7], h: 0.2, bob: 0.02, foulee: 0.55, lacet: -0.55, tendu: 0.92, talon: 0.35, pas: true },
  idle: { beta: 1.0, T: [4.0, 4.0], h: 0.0, bob: 0.008, foulee: 0.0, lacet: 0.0, tendu: 0.95, talon: 0.0, pas: false },
  // --- ajoutes le 2026-09-28 (user : « plus de types d'animations »)
  // rapide : se calcule comme une course (suspension) ; motif : ordre des pieds d'un quadrupede
  trot: { beta: 0.42, T: [0.78, 0.5], h: 0.2, bob: 0.03, foulee: 1.35, lacet: 0.0, tendu: 0.9, talon: 0.6, pas: true, rapide: true, motif: 'trot' },
  // recul : le corps avance a reculons (pas de deroule du pied)
  walk_back: { beta: 0.65, T: [1.2, 0.8], h: 0.18, bob: 0.03, foulee: 0.6, lacet: 0.0, tendu: 0.955, talon: 0.0, pas: true, recul: true },
  // saut : toutes les pattes ensemble, accroupi -> envol -> reception, en boucle (bonds)
  jump: { beta: 0.45, T: [0.9, 0.7], h: 0.35, bob: 0.0, foulee: 0.9, lacet: 0.0, tendu: 0.9, talon: 0.4, pas: true, rapide: true, saut: true },
  // actions, pieds PLANTES : le corps, la tete, les bras suivent des courbes (COURBES_ACTIONS)
  eat: { beta: 1.0, T: [4.0, 4.0], h: 0.0, bob: 0.006, foulee: 0.0, lacet: 0.0, tendu: 0.93, talon: 0.0, pas: false, action: 'eat', regard: 0.25 },
  lie_down: { beta: 1.0, T: [3.0, 3.0], h: 0.0, bob: 0.006, foulee: 0.0, lacet: 0.0, tendu: 0.95, talon: 0.0, pas: false, action: 'lie_down', regard: 0.5 },
  attack: { beta: 1.0, T: [1.4, 1.4], h: 0.0, bob: 0.004, foulee: 0.0, lacet: 0.0, tendu: 0.93, talon: 0.0, pas: false, action: 'attack', regard: 0, queue: 2.0 },
  hit: { beta: 1.0, T: [1.0, 1.0], h: 0.0, bob: 0.004, foulee: 0.0, lacet: 0.0, tendu: 0.95, talon: 0.0, pas: false, action: 'hit', regard: 0, queue: 2.5 },
  // mort : chute RIGIDE sur le flanc (animerChute)
  death: { beta: 1.0, T: [2.4, 2.4], h: 0.0, bob: 0.0, foulee: 0.0, lacet: 0.0, tendu: 0.95, talon: 0.0, pas: false, action: 'death' },
};
// Courbes des actions : cles [instant 0..1, valeur] ; bob et avance en fraction de la hauteur de
// hanche, tangage / roulis / tete / bras / lacet / torse en radians (tangage + = nez bas, tete + = tete
// basse, lacet + = vers la gauche). Les courbes « _bipede » servent aux bipedes (mains, torse) ; les
// autres aux quadrupedes et creatures a gueule. Interpolation : Hermite monotone (voir cles) : la
// vitesse est continue d'une cle a l'autre, le mouvement ne repart plus de zero a chaque cle.
// Reperes biomecaniques (25/10, valeurs citees de memoire, non reverifiees en ligne) :
//  - attaque bipede : chaine cinetique proximo-distale, bassin puis torse puis bras (Putnam 1993,
//    J Biomech 26 Suppl 1:125-135, « Sequential motions of body segments in striking and throwing
//    skills » ; Marshall et Elliott 2000, J Sports Sci 18:247) ; frappe = 0.10-0.20 s, armement plus
//    lent (~2/3 du geste), retour lent ;
//  - attaque quadrupede : ramassement (arriere qui s'abaisse, poitrine haute), puis detente de tout
//    le corps avant la tete (reglage a l'oeil, pas de mesure publiee retenue) ;
//  - coup recu : reponse du second ordre amortie (zeta ~ 0.3 : 2 a 3 oscillations visibles), le tronc
//    plie vers l'avant apres le recul (Winter 2009, reponse a une perturbation) ;
//  - manger : tete basse a la prehension puis relevee pour macher (bovins, chevaux : Beauchemin 1991,
//    J Dairy Sci, ~1 a 1.5 mastications par seconde) ;
//  - se coucher : l'avant flechit d'abord (carpes), puis le train arriere s'affaisse (Lidfors 1989,
//    « The use of getting up and lying down movements in the evaluation of cattle environments ») ;
//    s'asseoir : tronc penche de 30-40 degres des le debut (Schenkman et al. 1990, Phys Ther 70:638).
const COURBES_ACTIONS = {
  eat: {               // baisse la tete, prend, releve la tete pour macher, recommence, se redresse
    tangage: [[0, 0], [0.12, 0.14], [0.22, 0.14], [0.31, 0.04], [0.55, 0.04], [0.63, 0.14], [0.73, 0.14], [0.86, 0.03], [0.94, 0.03], [1, 0]],
    bob: [[0, 0], [0.12, -0.05], [0.22, -0.05], [0.31, -0.01], [0.55, -0.01], [0.63, -0.05], [0.73, -0.05], [0.86, -0.01], [1, 0]],
    tete: [[0, 0], [0.12, 1.0], [0.22, 1.0], [0.25, 0.88], [0.31, 0.32], [0.55, 0.32], [0.63, 1.0], [0.72, 1.0], [0.75, 0.88], [0.84, 0.3], [0.94, 0.3], [1, 0]],
    // deux phases de mastication tete relevee : ~1.3 Hz (5.2 cycles par cycle de 4 s)
    machoire: [[0.32, 0.54, 5.2, 0.06], [0.85, 0.96, 5.2, 0.06]],
  },
  lie_down: {          // l'avant flechit d'abord, puis l'arriere s'affaisse, la tete se pose
    bob: [[0, 0], [0.1, 0.0], [0.3, -0.2], [0.5, -0.45], [0.72, -0.56], [1, -0.55]],
    tangage: [[0, 0], [0.1, -0.05], [0.32, 0.13], [0.55, 0.04], [0.75, -0.03], [1, 0]],
    avance: [[0, 0], [0.5, -0.03], [1, -0.04]], roulis: [[0, 0], [0.6, 0], [0.8, 0.05], [1, 0.05]],
    tete: [[0, 0], [0.3, 0.2], [0.6, 0.12], [0.8, 0.28], [1, 0.3]],
  },
  lie_down_bipede: {   // s'accroupit / s'assoit : bassin en arriere, tronc penche, bras en contrepoids
    bob: [[0, 0], [0.25, -0.22], [0.55, -0.52], [0.8, -0.6], [1, -0.6]],
    avance: [[0, 0], [0.3, -0.18], [0.6, -0.3], [1, -0.3]],
    tangage: [[0, 0], [0.25, 0.28], [0.55, 0.18], [1, 0.1]], torseT: [[0, 0], [0.25, 0.15], [1, 0.08]],
    tete: [[0, 0], [0.3, -0.1], [1, -0.05]], bras: [[0, 0], [0.25, 0.6], [0.55, 0.3], [1, 0.15]],
  },
  attack: {            // se ramasse (arriere bas, tete en arriere), detente du corps puis de la tete, tient, revient
    avance: [[0, 0], [0.28, -0.10], [0.40, 0.26], [0.50, 0.26], [0.62, 0.15], [1, 0]],
    bob: [[0, 0], [0.2, -0.10], [0.28, -0.12], [0.38, -0.02], [0.46, 0.0], [1, 0]],
    tangage: [[0, 0], [0.28, -0.12], [0.40, 0.18], [0.52, 0.14], [1, 0]],
    tete: [[0, 0], [0.28, -0.55], [0.40, 0.75], [0.52, 0.60], [0.70, 0.20], [1, 0]],
    roulis: [[0, 0], [0.28, 0.04], [0.40, -0.05], [1, 0]],
  },
  attack_bipede: {     // armement (bassin, torse, bras en arriere), frappe en chaine bassin -> torse -> bras
    avance: [[0, 0], [0.28, -0.05], [0.42, 0.14], [0.58, 0.14], [1, 0]],
    bob: [[0, 0], [0.28, -0.05], [0.40, -0.07], [0.5, -0.04], [1, 0]],
    tangage: [[0, 0], [0.28, -0.05], [0.42, 0.10], [0.6, 0.08], [1, 0]],
    lacet: [[0, 0], [0.26, -0.22], [0.38, 0.24], [0.56, 0.20], [1, 0]],
    torse: [[0, 0], [0.30, -0.35], [0.43, 0.40], [0.58, 0.34], [1, 0]],
    torseT: [[0, 0], [0.28, -0.12], [0.44, 0.28], [0.58, 0.22], [1, 0]],
    lateral: [[0, 0], [0.28, -0.04], [0.42, 0.05], [0.6, 0.04], [1, 0]],
    tete: [[0, 0], [0.3, -0.05], [0.44, 0.08], [1, 0]],
    bras: [[0, 0], [0.28, -1.25], [0.40, -1.35], [0.58, 1.0], [0.70, 0.9], [1, 0]],
  },
  hit: {               // recul brusque, tete rejetee, puis oscillations amorties jusqu'au retour
    avance: [[0, 0], [0.07, -0.14], [0.2, -0.02], [0.32, -0.05], [0.5, 0.0], [0.7, -0.01], [1, 0]],
    bob: [[0, 0], [0.08, -0.05], [0.22, 0.01], [0.4, -0.015], [1, 0]],
    tangage: [[0, 0], [0.07, -0.15], [0.2, 0.05], [0.34, -0.04], [0.5, 0.015], [0.7, -0.01], [1, 0]],
    roulis: [[0, 0], [0.07, 0.09], [0.22, -0.05], [0.38, 0.025], [0.6, -0.01], [1, 0]],
    tete: [[0, 0], [0.07, -0.5], [0.2, 0.15], [0.35, -0.1], [0.52, 0.04], [0.75, -0.01], [1, 0]],
  },
  hit_bipede: {        // le torse part en arriere puis se plie en deux, les bras volent, un pas de recul
    avance: [[0, 0], [0.07, -0.10], [0.25, -0.04], [0.5, -0.03], [1, 0]],
    bob: [[0, 0], [0.08, -0.03], [0.22, -0.02], [1, 0]],
    tangage: [[0, 0], [0.07, -0.08], [0.2, 0.05], [0.4, -0.01], [1, 0]],
    torseT: [[0, 0], [0.09, -0.28], [0.21, 0.26], [0.36, -0.08], [0.55, 0.03], [1, 0]],
    torse: [[0, 0], [0.09, 0.25], [0.27, -0.1], [0.5, 0.03], [1, 0]],
    lacet: [[0, 0], [0.07, 0.12], [0.25, -0.05], [1, 0]],
    roulis: [[0, 0], [0.07, 0.07], [0.22, -0.04], [0.4, 0.02], [1, 0]],
    tete: [[0, 0], [0.09, -0.45], [0.22, 0.25], [0.38, -0.1], [0.55, 0.03], [1, 0]],
    bras: [[0, 0], [0.09, -0.8], [0.24, 0.3], [0.42, -0.1], [1, 0]],
  },
};
// Bras d'un bipede qui SAUTE (rad, + = bras vers l'avant / le haut), sur le cycle accroupi -> poussee -> vol -> reception : les bras partent
// derriere pendant l'elan (extension de l'epaule ~30 deg), puis montent vivement a la poussee (~75-80 deg au decollage, plus de 100 deg en
// vol), et redescendent pour la reception. Un saut sans bras qui poussent perd 10 a 20 % de hauteur (Lees, Vanrenterghem & De Clercq 2004,
// J Biomech 37 : le balancier des bras augmente la hauteur d'environ 10 %).
const BRAS_SAUT = [[0, 0.2], [0.2, -0.55], [0.4, 0.75], [0.58, 1.55], [0.8, 0.7], [1, 0.2]];
/** Valeur d'une courbe par cles [[u, v], ...] (u croissant dans 0..1) : Hermite cubique monotone
 *  (tangentes de Fritsch-Carlson : moyenne harmonique des pentes voisines, nulle a un extremum). La vitesse
 *  est continue, la courbe ne depasse jamais ses cles. */
function cles(u, k) {
  if (u <= k[0][0]) return k[0][1];
  const n = k.length;
  for (let i = 1; i < n; i++) {
    if (u <= k[i][0]) {
      const pente = (a) => (k[a + 1][1] - k[a][1]) / Math.max(k[a + 1][0] - k[a][0], 1e-9);
      const tang = (a) => {
        if (a <= 0 || a >= n - 1) return 0;
        const s0 = pente(a - 1), s1 = pente(a);
        if (s0 * s1 <= 0) return 0;
        const h0 = k[a][0] - k[a - 1][0], h1 = k[a + 1][0] - k[a][0], w1 = 2 * h1 + h0, w2 = h1 + 2 * h0;
        return (w1 + w2) / (w1 / s0 + w2 / s1);
      };
      const [u0, v0] = k[i - 1], [u1, v1] = k[i], h = Math.max(u1 - u0, 1e-9), x = (u - u0) / h;
      const x2 = x * x, x3 = x2 * x;
      return (2 * x3 - 3 * x2 + 1) * v0 + (x3 - 2 * x2 + x) * h * tang(i - 1) + (-2 * x3 + 3 * x2) * v1 + (x3 - x2) * h * tang(i);
    }
  }
  return k[n - 1][1];
}

// VARIANTES (2026-09-28) : styles d'une même allure, pour varier les personnages.
// Multiplicateurs : T (période), foulee, h (hauteur de pas), bob, lacet ; valeurs : tendu
// (bassin), tete (inclinaison, rad, + = tête basse), regard (amplitude du regard à l'arrêt),
// queue et bras (amplitude). Nom du clip : « walk » (normal) ou « walk__sneak ».
const TOURNANTS = { normal: {}, tight: { lacet: 1.6, foulee: 0.6 }, wide: { lacet: 0.6, foulee: 1.2 } };
export const VARIANTES = {
  idle: {
    normal: {},
    alert: { T: 0.75, regard: 2.2, tete: -0.08, queue: 1.4, bob: 0.8 },
    tired: { T: 1.3, bob: 2.2, tendu: 0.9, tete: 0.18, regard: 0.4, queue: 0.5 },
  },
  walk: {
    normal: {},
    slow: { T: 1.35, foulee: 0.8, h: 0.8, bob: 1.3, tendu: 0.945, tete: 0.10, queue: 0.7, bras: 0.7 },
    brisk: { T: 0.8, foulee: 1.15, h: 1.1, bob: 0.8, bras: 1.3 },
    sneak: { T: 1.55, foulee: 0.7, h: 1.35, bob: 0.35, tendu: 0.86, tete: 0.14, queue: 0.4, bras: 0.4 },
    proud: { T: 1.1, h: 1.45, bob: 0.8, tete: -0.12, queue: 1.3, bras: 1.2 },
    crawl: { T: 1.6, foulee: 0.6, h: 0.8, bob: 0.3, tendu: 0.78, tete: 0.1, queue: 0.5, bras: 0.5 },
  },
  run: {
    normal: {},
    jog: { T: 1.25, foulee: 0.7, h: 0.8, bob: 0.8, bras: 0.8 },
    sprint: { T: 0.85, foulee: 1.25, h: 1.15, tendu: 0.84, tete: 0.06, bras: 1.3 },
  },
  turn_left: TOURNANTS,
  turn_right: TOURNANTS,
  trot: { normal: {}, slow: { T: 1.2, foulee: 0.8, h: 0.85 }, extended: { T: 0.95, foulee: 1.2, h: 1.1 } },
  walk_back: { normal: {}, slow: { T: 1.3, foulee: 0.8 } },
  jump: { normal: {}, big: { h: 1.4, T: 1.15, foulee: 1.2 }, small: { h: 0.7, T: 0.85, foulee: 0.7 } },
  eat: { normal: {} },
  lie_down: { normal: {} },
  attack: { normal: {}, strong: { ampleur: 1.4, T: 1.15 }, quick: { T: 0.7 } },
  hit: { normal: {}, strong: { ampleur: 1.6 } },
  death: { normal: {}, left: { cote: 1 } },
};
// REFERENCES BIPEDES (25/10, travail « realisme des bipedes »). Valeurs visees, a verifier a l'oeil par l'exploitant :
//  - marche : appui 60 % du cycle, double appui 2 x 10 % ; genou ~5 deg a l'attaque du talon, 15-20 deg a 15 % (reponse a la charge), ~5 deg
//    en milieu d'appui, 35-40 deg au decollage, pic ~60 deg a ~73 % (Perry & Burnfield 2010, Gait Analysis, 2e ed. ; Kadaba et al. 1990,
//    J Orthop Res 8). Cheville : talon d'abord, pointe relevee ~15 deg, puis deroule (Winter 1991, Biomechanics and Motor Control of Human
//    Gait). Garde au sol du pied en milieu de balancier ~1,5 cm (Winter 1991). Bassin : rotation +/- 4-5 deg, obliquite +/- 4-5 deg (Kadaba 1990).
//    Centre de masse : ~4-5 cm d'amplitude verticale ET laterale (Saunders, Inman & Eberhart 1953 ; Orendurff et al. 2004, J Rehabil Res Dev).
//    Cadence naturelle ~110-117 pas/min. Bras : epaule ~ +/- 15-20 deg, coude 10-35 deg (Murray 1967).
//  - course : cadence ~160-175 pas/min (Heiderscheit et al. 2011, Med Sci Sports Exerc 43), foulee ~2-2,5 longueurs de jambe au petit trot,
//    rapport cyclique 0,3-0,37 (phase aerienne), genou ~45 deg en milieu d'appui et 100+ deg au balancier (Novacheck 1998, Gait & Posture 7),
//    centre de masse le plus BAS en milieu d'appui (ressort, Cavagna et al. 1976, J Physiol 262), buste penche ~5-10 deg, coudes ~90 deg
//    (Hinrichs 1990), attaque du talon chez la majorite des coureurs (Larson et al. 2011, J Sports Sci 29).
//  - saut vertical : le balancier des bras ajoute ~10 % de hauteur (Lees, Vanrenterghem & De Clercq 2004, J Biomech 37).
//  - oiseau : hochement de tete = phase de tenue + poussee (Frost 1978, J Exp Biol 74). Kangourou : ~2 bonds/s a 3 m/s (Alexander & Vernon
//    1975, J Zool 177). Manchot : dandinement (Griffin & Kram 2000, Nature 408). Chimpanze bipede : hanches et genoux flechis (Pontzer et al. 2009).
//    Dinosaure bipede : queue en contrepoids (Gatesy 1990, Paleobiology 16).
// PROFILS D'ESPECE (2026-09-28) : le meme squelette ne court pas pareil selon l'animal (un cheval
// galope, un lion bondit en pliant le dos, un lapin sautille, un lezard ondule). Par allure :
//   motif      : ordre de pose des pieds d'un quadrupede (voir MOTIFS) ;
//   T, foulee, h, bob : multiplicateurs (comme les variantes) ; beta, tendu, tete, talon : valeurs ;
//   flexion    : flexion/extension du dos (rad), pliee quand les pattes AVANT portent ;
//   ondulation : flexion laterale du dos (rad, lezard) ; tangage : bascule avant/arriere du corps ;
//   hoche      : hochement de tete cale sur les appuis ; roulis : balancement gauche/droite (amble).
// Les virages reprennent le profil de la marche. « generique » = moteur d'origine, inchange.
export const ESPECES = {
  generique: {},
  equide: {        // cheval, ane, zebre, cerf… : pattes droites, dos raide, tete qui balance
    walk: { motif: 'lateral', T: 1.0, h: 0.9, hoche: 0.1 },
    // repos (26/10) : respiration lente ~0,2 Hz (cheval au repos 8-16 cycles/min, Hoyt/Taylor 1981 ; ici T 5,4 s -> bob 2 fois par T = 0,37 Hz, plus lisible a l'ecran), queue qui chasse les mouches
    idle: { T: 1.35, bob: 2.2, queue: 1.7, regard: 0.7 },
    jump: { decalage: 0.07, h: 1.25, T: 1.1 },
    // trot (26/10) : deux temps diagonaux, suspension ; genou haut (action du genou), tete et dos quasi immobiles (Hildebrand 1965 ; Heglund & Taylor 1988 : 1,2-2,2 foulees/s)
    trot: { motif: 'trot', T: 1.1, h: 1.25, bob: 0.85, hoche: 0.03, tangage: 0.02, tendu: 0.93, talon: 0.4, leve: 0.8 },
    // galop (25/10, « on dirait la demarche d'un chien ») : jambes presque tendues (tendu 0.9 -> 0.97), corps plus haut et plus plat (bob 1.2 -> 0.8), cadence plus lente,
    // grand balancement de tete et d'encolure (hoche 0.22 -> 0.32)
    run: { motif: 'transverse', beta: 0.3, T: 0.9, foulee: 1.6, h: 1.1, bob: 0.8, tangage: 0.08, hoche: 0.32, flexion: 0.03, tendu: 0.9, leve: 0.65 },
  },
  felin: {         // lion, tigre, chat : marche basse et souple, galop bondissant (dos plie/deplie)
    walk: { motif: 'lateral', T: 1.1, h: 0.75, bob: 0.6, tendu: 0.93, tete: 0.1, hoche: 0.015, flexion: 0.03 },
    // galop rotatif (26/10 ; tendu 0.82 -> 0.9 le 25/10 apres relecture : 5 % d'os sous le sol sur Mule / Phacochere) : foulee ~3,5 hauteurs de garrot, 2 suspensions (rassemblee + etendue), colonne qui se plie et se deplie
    // (Hildebrand 1959 ; Hudson, Corr & Wilson 2012, JEB 215:2425 : guepard 2,4 -> 3,2 foulees/s), pattes bien repliees au decollage
    run: { motif: 'rotatif', beta: 0.27, T: 0.9, foulee: 1.5, h: 1.1, bob: 1.4, tangage: 0.06, hoche: 0.02, tete: 0.06, flexion: 0.34, tendu: 0.9, leve: 0.65 },
    idle: { T: 1.2, bob: 1.8, queue: 2.0, regard: 1.2 },
    jump: { decalage: 0.08, h: 1.3 },
  },
  canide: {        // chien, loup, renard
    walk: { motif: 'lateral', hoche: 0.03 },
    // galop du chien (26/10) : ~2,5-3 foulees/s (greyhound ~3,5 : Hudson 2012), foulee 3-4 hauteurs, dos bien plie
    run: { motif: 'rotatif', beta: 0.28, T: 0.88, foulee: 1.4, h: 1.1, bob: 1.3, tangage: 0.07, hoche: 0.05, flexion: 0.3, tendu: 0.9, leve: 0.65 },
    trot: { motif: 'trot', T: 1.0, h: 1.1, bob: 0.9, hoche: 0.03, tendu: 0.86, leve: 0.8 },
    idle: { T: 1.1, bob: 2.0, queue: 2.2, regard: 1.4 },
    jump: { decalage: 0.08, h: 1.2 },
  },
  bovin: {         // vache, boeuf, chevre, cochon : pas lourd, tete basse, galop pataud
    walk: { motif: 'lateral', T: 1.2, h: 0.75, bob: 1.3, hoche: 0.05, tete: 0.08 },
    run: { motif: 'transverse', beta: 0.36, T: 1.1, foulee: 0.85, bob: 1.8, tangage: 0.07, hoche: 0.07, flexion: 0.05, tete: 0.1 },
    trot: { motif: 'trot', T: 1.05, h: 1.0, bob: 1.0, hoche: 0.04, tete: 0.08, leve: 0.8 },
    idle: { T: 1.5, bob: 2.4, queue: 1.6, regard: 0.5, tete: 0.08 },
  },
  bondissant: {    // lapin, lievre, ecureuil, rat : pattes arriere ensemble, dos qui se plie
    walk: { motif: 'demi_bond', beta: 0.45, T: 0.75, foulee: 0.7, h: 1.2, bob: 1.5, tangage: 0.06, flexion: 0.12 },
    run: { motif: 'demi_bond', beta: 0.28, T: 0.8, foulee: 1.3, bob: 2.0, tangage: 0.1, flexion: 0.3 },
  },
  ours: {          // ours, panda, blaireau : amble qui roule, galop lourd
    walk: { motif: 'amble', T: 1.15, h: 0.8, bob: 1.2, tete: 0.1, hoche: 0.04, roulis: 0.05 },
    run: { motif: 'rotatif', beta: 0.34, T: 0.95, foulee: 1.15, bob: 1.5, tangage: 0.06, flexion: 0.16, hoche: 0.05, tendu: 0.9, leve: 0.8 },
  },
  pachyderme: {    // elephant, rhinoceros, hippopotame : jamais de phase aerienne
    walk: { motif: 'lateral', beta: 0.72, T: 1.35, h: 0.55, foulee: 0.9, bob: 0.8, hoche: 0.03, tendu: 0.975 },
    run: { motif: 'amble', beta: 0.52, T: 1.3, foulee: 0.8, bob: 0.9, hoche: 0.04, tendu: 0.95 },
  },
  camelide: {      // chameau, lama, girafe : l'amble (les deux pattes d'un meme cote ensemble)
    walk: { motif: 'amble_pur', beta: 0.62, T: 1.1, hoche: 0.05, roulis: 0.06 },
    run: { motif: 'amble_pur', beta: 0.4, T: 1.0, bob: 1.3, hoche: 0.06, roulis: 0.05 },
  },
  reptile: {       // lezard, crocodile, salamandre : trot etale, le dos ondule de cote
    // 25/10 (« realisme de chaque animation ») : marche en couples diagonaux decales (Hildebrand 1976 ; Ashley-Ross 1994
    // pour la salamandre : sequence laterale, couples diagonaux, rapport cyclique 0,7-0,8) ; trot a tous les
    // allures chez le lezard a pattes bien developpees (Reilly & DeLancey 1997, Sceloporus clarkii : trot,
    // onde STATIONNAIRE de flexion du tronc avec noeuds aux ceintures, la meme a toutes les vitesses ; Ritter
    // 1992 : onde progressive seulement aux vitesses elevees). Foulee d'un lezard ~0,6-0,8 longueur museau-cloaque
    // (Farley & Ko 1997) : l'ancienne foulee (0,15 L) donnait des pieds qui patinent. Flexion du tronc :
    // l'ondulation est la rotation RELATIVE des deux ceintures (rad), pic ~0,35 rad (20 deg) a la marche.
    walk: { motif: 'diag_lat', beta: 0.66, T: 0.95, foulee: 1.7, h: 0.8, bob: 0.4, tendu: 0.9, ondulation: 0.75, queue: 1.4, tete: 0.02, piedPlat: true, cycleEntier: true, talon: 0.1, teteContre: 0.7, queueOnde: 1.0 },
    run: { motif: 'trot', beta: 0.46, T: 1.0, foulee: 1.5, bob: 0.5, ondulation: 1.0, queue: 2.0, piedPlat: true, cycleEntier: true, talon: 0.2, teteContre: 0.7, queueOnde: 1.2 },
  },
  tortue: {        // tortue : lente, toujours trois pattes au sol
    walk: { motif: 'lateral', beta: 0.8, T: 1.9, foulee: 0.5, h: 0.6, bob: 0.4 },
    run: { motif: 'lateral', beta: 0.7, T: 1.8, foulee: 0.6, h: 0.7, bob: 0.5 },
  },
  oiseau: {        // bipede a plumes : pas vif et haut, tete qui hoche a chaque pas
    idle: { T: 1.0 },
    // course : 0,5 s par cycle (30 images, a-coups 36 deg) -> 0,62 s ; la tete « tient » puis part d'un coup (voir tetePique)
    walk: { T: 0.7, h: 1.3, hoche: 0.07, tete: -0.04 },
    run: { T: 1.0, hoche: 0.05 },
  },
  // --- ajoutes le 2026-09-28 (user : « il manque humain et d'autres choix »)
  humain: {        // bipede : pas deroule, bras qui balancent (valeurs de reference : voir REFERENCES BIPEDES ci-dessus)
    idle: { T: 1.5 },
    walk: { T: 0.95, bras: 1.0, attaque: 0.28, bob: 0.72, lateral: 0.026, levee: 1, h: 0.7 },
    // course (25/10, « la course ressemble a une marche sur place ») : foulee 6 fois plus courte que la marche -> 2,1 hauteurs de hanche ;
    // cadence ~156 pas/min (T 0,77 s), jambe plus pliee au milieu de l'appui (tendu), phase aerienne, attaque du talon
    run: { T: 1.25, bras: 1.15, h: 1.3, bob: 1.2, beta: 0.33, attaque: 0.17, tendu: 0.9, lateral: 0.02 },
  },
  primate: {       // singe, gorille : genoux plies, gros balancement des bras, roule des epaules
    idle: { T: 1.5 },
    // marche bipede du chimpanze : « hanches et genoux flechis » (Elftman & Manter 1935 ; Pontzer 2009) -> genou ~35 deg en milieu d'appui
    // (tendu 0,9), tronc penche d'environ 17 deg, bassin qui roule beaucoup, pas courts et frequents
    walk: { T: 0.85, h: 0.9, tendu: 0.9, bras: 1.6, tete: 0.1, roulis: 0.08, tronc: 0.3, lateral: 0.05, attaque: 0.12, bob: 0.9 },
    run: { T: 1.0, tendu: 0.85, bras: 1.4, tronc: 0.35, h: 1.2, lateral: 0.04, attaque: 0.08 },
  },
  dinosaure: {     // T-rex, raptor : pas lourd, tete qui balance, queue en balancier, petits bras immobiles
    idle: { T: 1.5 },
    walk: { T: 1.25, h: 0.9, bob: 1.3, hoche: 0.06, bras: 0.2, queue: 1.8, tendu: 0.93 },
    run: { T: 1.0, bras: 0.15, queue: 1.5, hoche: 0.08, h: 1.2, bob: 1.2 },
  },
  kangourou: {     // bipede qui avance par BONDS, les deux pattes ensemble
    idle: { T: 1.5 },
    // rebond du kangourou roux : ~2,1 bonds / s a 3 m/s (Alexander & Vernon 1975, J Zool 177) -> periode 0,5-0,7 s, et une hauteur de vol
    // petite devant la longueur du pas (le centre de masse monte de ~10-15 cm seulement) : sautH 0,3 -> 0,14 de la hauteur de hanche
    walk: { saut: true, T: 0.7, h: 0.8, foulee: 0.7, sautH: 0.14 },
    run: { saut: true, T: 1.0, h: 1.2, foulee: 1.2, sautH: 0.18 },
  },
  manchot: {       // se dandine : petits pas, gros roulis, ailerons presque immobiles
    idle: { T: 1.5 },
    // dandinement : le centre de masse passe d'un pied a l'autre (translation laterale ~ 1/10 de la hauteur de hanche) avec un roulis de
    // +/- 8 a 10 deg (Griffin & Kram 2000, Nature 408 « Penguin waddling is not wasteful »)
    walk: { T: 0.6, foulee: 0.45, h: 0.45, roulis: 0.14, bras: 0.35, tete: -0.05, lateral: 0.055 },
    run: { T: 0.55, foulee: 0.6, roulis: 0.12, bras: 0.4 },
  },
  grenouille: {    // quadrupede qui avance par BONDS
    // 25/10 : bond a 3 temps (accroupie / poussee / vol, voir « bond » dans animerAllure), museau qui monte au
    // decollage (Nauwelaerts & Aerts 2003 ; Zug 1972 : ~30-40 deg), temps de contact ~35 % du cycle (poussee
    // des pattes arriere ~0,1-0,15 s pour un vol de 0,2-0,3 s, Nauwelaerts & Aerts 2006)
    walk: { saut: true, bond: { creux: 0.3, pitch: 0.4 }, beta: 0.38, T: 0.9, foulee: 1.4, h: 1.0, piedPlat: true, cycleEntier: true },
    run: { saut: true, bond: { creux: 0.35, pitch: 0.55 }, beta: 0.3, T: 0.95, foulee: 2.2, h: 1.4, piedPlat: true, cycleEntier: true },
    jump: { saut: true, bond: { creux: 0.4, pitch: 0.6 }, beta: 0.32, T: 0.9, foulee: 2.0, h: 1.4, piedPlat: true, cycleEntier: true },
  },
  dragon: {        // quadrupede reptilien et lourd, le dos ondule
    walk: { motif: 'lateral', T: 1.2, h: 0.85, bob: 1.1, tendu: 0.92, ondulation: 0.12, hoche: 0.05 },
    run: { motif: 'rotatif', beta: 0.32, T: 1.0, foulee: 1.2, bob: 1.4, tangage: 0.06, flexion: 0.12, hoche: 0.06 },
  },
  // 25/10 (« realisme de chaque animation ») pour les 6 pattes et plus. Rapport cyclique (part du cycle au sol) :
  //  - insecte : trepied alterne, jamais sous 0,5 (pas de phase aerienne : Full & Tu 1991 ; Ting, Blickhan & Full
  //    1994, blatte : le rapport cyclique baisse avec la vitesse mais reste ~0,5) ; l'ancienne course (0,38) laissait
  //    les DEUX trepieds en l'air 24 % du temps, comme un sautillement ;
  //  - araignee : tetrapode alterne, 0,6-0,7 a la marche (Wilson 1967 sur la mygale, onde metachronale legere) ; retenu
  //    0,57 : au-dela, les appuis se chevauchent trop et l'a-coup des genoux depasse celui d'origine (mesure) ;
  //  - crabe : pas lateral, ~0,6 a la marche et 0,5 en course (Blickhan & Full 1987, Ocypode : les pattes d'arriere-cote
  //    poussent, celles d'avant-cote tirent).
  // Aussi : lacet du corps a chaque demi-cycle, abdomen qui suit avec retard, antennes / pinces qui bougent, cycle
  // arrondi a un nombre entier d'images (boucle fermee).
  insecte: {       // 6 pattes et plus : pas rapide en trepied
    walk: { T: 1.0, h: 0.75, beta: 0.6, lacetCorps: 0.05, abdomen: 0.05, antennes: true, cycleEntier: true },
    run: { T: 1.0, foulee: 1.3, h: 0.7, beta: 0.5, lacetCorps: 0.07, abdomen: 0.07, antennes: true, cycleEntier: true },
    idle: { antennes: true, cycleEntier: true },
  },
  araignee: {      // araignee, scorpion : pattes hautes, marche posee
    walk: { T: 1.5, h: 1.1, bob: 0.6, beta: 0.57, lacetCorps: 0.03, abdomen: 0.06, cycleEntier: true },
    run: { T: 1.0, foulee: 1.2, h: 1.1, bob: 0.6, beta: 0.55, lacetCorps: 0.04, abdomen: 0.08, cycleEntier: true },
    idle: { abdomen: 0.03, cycleEntier: true },
  },
  crabe: {         // marche DE COTE
    walk: { deCote: true, T: 1.3, foulee: 0.55, h: 0.9, talon: 0, beta: 0.6, lacetCorps: 0.03, pinces: true, cycleEntier: true },
    run: { deCote: true, T: 1.1, foulee: 0.7, talon: 0, beta: 0.5, lacetCorps: 0.04, pinces: true, cycleEntier: true },
    idle: { pinces: true, cycleEntier: true },
  },
};
// A quel corps s'applique chaque profil ; « quadrupede » par defaut.
const POUR_ESPECE = { oiseau: 'bipede', humain: 'bipede', primate: 'bipede', dinosaure: 'bipede', kangourou: 'bipede', manchot: 'bipede',
  insecte: 'multi', araignee: 'multi', crabe: 'multi' };
// Types d'animation PERTINENTS par espece : le menu n'affiche que ceux-la (un cheval ne vole pas,
// un humain ne trotte pas). Espece generique : selon le nombre de pattes du squelette.
export const TYPES_ANIMATION = ['idle', 'walk', 'trot', 'run', 'jump', 'walk_back', 'turn_left', 'turn_right',
  'eat', 'lie_down', 'attack', 'hit', 'death', 'fly'];
const RETIRES_ESPECE = {
  humain: ['trot', 'eat', 'fly'], primate: ['trot', 'fly'], dinosaure: ['trot', 'jump', 'fly'], kangourou: ['trot', 'fly'],
  manchot: ['trot', 'fly'], oiseau: ['trot'], equide: ['fly'], felin: ['fly'], canide: ['fly'], bovin: ['fly'],
  bondissant: ['trot', 'fly'], ours: ['fly'], pachyderme: ['trot', 'jump', 'fly'], camelide: ['jump', 'fly'],
  reptile: ['trot', 'jump', 'fly'], dragon: ['trot'], tortue: ['trot', 'jump', 'fly'], grenouille: ['trot', 'fly'],
  insecte: ['trot'], araignee: ['trot', 'eat', 'fly'], crabe: ['trot', 'jump', 'eat', 'fly'],
};
/** Types d'animation proposes pour une espece (et, en generique, un squelette de nbPattes pattes). */
export function animationsPour(espece, nbPattes = null) {
  const sans = RETIRES_ESPECE[espece] || (nbPattes === 4 || nbPattes == null ? ['fly'] : ['trot', 'fly']);
  return TYPES_ANIMATION.filter((t) => !sans.includes(t));
}
// Instant de POSE de chaque pied, en fraction du cycle (diagrammes de Hildebrand) :
// PG/PD = arriere gauche/droit, AG/AD = avant gauche/droit.
const MOTIFS = {
  lateral:    { PG: 0, AG: 0.25, PD: 0.5, AD: 0.75 },    // marche des mammiferes
  amble:      { PG: 0, AG: 0.15, PD: 0.5, AD: 0.65 },    // marche rapide sans phase aerienne
  amble_pur:  { PG: 0, AG: 0, PD: 0.5, AD: 0.5 },        // chameau, girafe
  trot:       { PG: 0, AD: 0, AG: 0.5, PD: 0.5 },
  transverse: { PG: 0, PD: 0.1, AG: 0.32, AD: 0.44 },    // galop du cheval (suspension « rassemblee »)
  rotatif:    { PG: 0, PD: 0.1, AD: 0.45, AG: 0.55 },    // galop du felin, du chien (deux suspensions)
  demi_bond:  { PG: 0, PD: 0.04, AG: 0.45, AD: 0.55 },   // lapin : les pattes arriere ensemble
  diag_lat:   { PG: 0, AD: 0.08, PD: 0.5, AG: 0.58 },    // lezard, salamandre : couples diagonaux, l arriere en avance de 0,08 (Hildebrand 1976)
};
// ordre du menu : generique, bipedes, quadrupedes, sauteurs, 6 pattes et plus
export const ESPECES_LISTE = ['generique', 'humain', 'primate', 'oiseau', 'manchot', 'dinosaure', 'kangourou',
  'equide', 'felin', 'canide', 'bovin', 'ours', 'pachyderme', 'camelide', 'bondissant', 'grenouille',
  'reptile', 'dragon', 'tortue', 'insecte', 'araignee', 'crabe'];
const MOTS_ESPECES = {
  equide: 'horse horses pony stallion mare foal donkey mule zebra deer stag doe elk moose reindeer caribou antelope gazelle '
    + 'cheval chevaux poney etalon jument poulain ane anes mulet zebre cerf biche daim elan orignal renne antilope '
    + 'caballo burro mula cebra ciervo reno pferd esel maultier hirsch elch cavallo asino mulo cervo renna cavalo',
  felin: 'lion lions lioness tiger tigers cat cats kitten leopard panther jaguar cheetah lynx puma cougar '
    + 'lionne tigre chat chats chaton panthere guepard leon gato pantera guepardo lowe katze gepard luchs leone gatto leao onca',
  canide: 'dog dogs puppy wolf wolves fox husky coyote jackal hyena chien chiens chiot loup loups renard chacal hyene '
    + 'perro lobo zorro hund fuchs cane lupo volpe cachorro cao raposa',
  bovin: 'cow cows cattle ox oxen bull bison buffalo yak goat goats sheep ram lamb pig pigs boar hog '
    + 'vache vaches boeuf boeufs taureau buffle yack chevre mouton belier agneau cochon porc sanglier '
    + 'vaca buey toro cabra oveja cerdo jabali kuh ochse stier ziege schaf schwein wildschwein '
    + 'mucca bue capra pecora maiale cinghiale boi touro ovelha porco javali',
  bondissant: 'rabbit rabbits bunny hare squirrel rat rats mouse mice hamster lapin lapins lievre ecureuil souris '
    + 'conejo liebre ardilla raton hase kaninchen ratte maus coniglio lepre scoiattolo ratto topo coelho lebre esquilo rato',
  ours: 'bear bears panda badger wolverine raccoon ours blaireau glouton oso orso urso dachs',
  pachyderme: 'elephant elephants mammoth rhino rhinoceros hippo hippopotamus mammouth hippopotame elefante elefant nashorn nilpferd',
  camelide: 'camel camels dromedary llama alpaca giraffe chameau dromadaire lama alpaga girafe camello jirafa kamel cammello giraffa camelo girafa',
  reptile: 'lizard lizards gecko iguana crocodile alligator caiman komodo salamander newt monitor '
    + 'lezard iguane salamandre triton varan lagarto cocodrilo eidechse krokodil lucertola coccodrillo crocodilo',
  tortue: 'turtle turtles tortoise terrapin tortue tortues tortuga schildkrote tartaruga',
  oiseau: 'bird birds chicken hen rooster chick duck goose geese ostrich emu turkey pigeon crow vulture eagle hawk '
    + 'oiseau oiseaux poule coq poussin canard oie autruche emeu dinde corbeau vautour aigle '
    + 'pajaro ave gallina gallo pato ganso avestruz pavo vogel huhn hahn ente gans uccello anatra oca struzzo passaro galinha galo',
  humain: 'human humans man men woman women boy girl person people character warrior knight soldier guard orc orcs goblin troll '
    + 'elf dwarf zombie wizard mage witch ninja samurai pirate viking king queen prince princess hero villain '
    + 'humain homme femme garcon fille personnage guerrier chevalier soldat garde gobelin elfe nain sorcier sorciere '
    + 'hombre mujer guerrero caballero mensch mann frau krieger ritter uomo donna guerriero cavaliere homem mulher guerreiro',
  primate: 'monkey monkeys ape apes gorilla chimp chimpanzee orangutan baboon singe singes gorille chimpanze orang babouin '
    + 'mono gorila affe gorilla scimmia macaco',
  dinosaure: 'dinosaur dinosaurs trex rex tyrannosaurus raptor velociraptor allosaurus dinosaure dinosaures tyrannosaure dinosaurio',
  kangourou: 'kangaroo kangaroos wallaby kangourou canguro kanguru',
  manchot: 'penguin penguins manchot manchots pingouin pingouins pinguino pinguin',
  grenouille: 'frog frogs toad toads grenouille grenouilles crapaud rana sapo frosch krote',
  dragon: 'dragon dragons wyvern drake drache drago dragao',
  insecte: 'insect insects ant ants beetle bug bugs cockroach mantis wasp bee fly flies grasshopper cricket '
    + 'insecte insectes fourmi fourmis scarabee cafard mante guepe abeille sauterelle criquet hormiga escarabajo ameise kafer formica',
  araignee: 'spider spiders tarantula scorpion scorpions araignee araignees tarentule arana spinne ragno aranha',
  crabe: 'crab crabs lobster crayfish crabe crabes homard ecrevisse cangrejo krabbe granchio caranguejo',
};
const INDEX_ESPECES = new Map();
for (const [e, t] of Object.entries(MOTS_ESPECES)) for (const m of t.split(' ')) if (m) INDEX_ESPECES.set(m, e);
/** Profil d'espece d'apres les mots d'un texte (nom du projet, prompt…) ; 'generique' sinon. */
export function especeDepuisTexte(texte) {
  // \u00ab \u0153 \u00bb et \u00ab \u00e6 \u00bb sont des ligatures, que NFD ne decompose pas : \u00ab B\u0153uf \u00bb donnait \u00ab b \u00bb + \u00ab uf \u00bb
  const mots = String(texte || '').toLowerCase().replace(/\u0153/g, 'oe').replace(/\u00e6/g, 'ae')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/);
  for (const m of mots) if (INDEX_ESPECES.has(m)) return INDEX_ESPECES.get(m);
  return 'generique';
}

/** « walk__sneak » -> { allure: 'walk', variante: 'sneak' } */
export function lireClip(nom) {
  const [a, variante = 'normal'] = String(nom).split('__');
  return { allure: ALIAS_ALLURES[a] || a, variante };
}

// ------------------------------------------------------------------ MODE DE DEPLACEMENT (2026-09-28)
// User : « j'ai teste poisson mais ca m'a propose Run ». Le squelette seul ne distingue pas un thon
// (nageoires) d'un crocodile (pattes courtes) : l'interface lit d'abord les MOTS du projet
// (modeDepuisTexte), puis le squelette (modeDuSquelette), et l'utilisateur peut imposer le mode.
//   pattes    : marche / course (detection des pattes)
//   nage      : onde laterale le long de la colonne, a la hauteur du corps (poisson, cetace)
//   reptation : meme onde, au sol (serpent, ver)
// Les clips portent alors un nom qui dit ce qu'ils sont : swim, slither… (walk pour les pattes).
export const MODES = ['auto', 'pattes', 'nage', 'reptation', 'vol'];
const NOMS_PAR_MODE = {
  nage: { walk: 'swim', run: 'swim_fast', turn_left: 'swim_left', turn_right: 'swim_right' },
  reptation: { walk: 'slither', run: 'slither_fast', turn_left: 'slither_left', turn_right: 'slither_right' },
  vol: { walk: 'flight', run: 'flight_fast', turn_left: 'flight_left', turn_right: 'flight_right' },
};
/** Nom de clip -> allure du moteur (« swim » -> « walk »). */
export const ALIAS_ALLURES = Object.fromEntries(Object.values(NOMS_PAR_MODE).flatMap((t) => Object.entries(t).map(([a, n]) => [n, a])));
export function allureDeClip(nom) { const a = String(nom).split('__')[0]; return ALIAS_ALLURES[a] || a; }
// Mots (anglais, francais, espagnol, allemand, italien, portugais), sans accents, en minuscules.
const MOTS_NAGE = new Set(('fish fishes tuna shark sharks whale whales dolphin dolphins orca salmon trout carp cod eel '
  + 'ray manta stingray piranha goldfish koi marlin swordfish sardine herring mackerel pike perch catfish barracuda '
  + 'seahorse narwhal beluga porpoise bass tilapia sturgeon '
  + 'poisson poissons thon requin requins baleine baleines dauphin dauphins saumon truite carpe morue anguille raie '
  + 'espadon hareng maquereau brochet perche silure hippocampe narval marsouin esturgeon '
  + 'pez peces atun tiburon ballena delfin salmon trucha anguila '
  + 'fisch thunfisch delfin lachs forelle karpfen aal '
  + 'pesce tonno squalo balena delfino salmone trota '
  + 'peixe atum tubarao baleia golfinho').split(' '));
const MOTS_REPTATION = new Set(('snake snakes serpent serpents python cobra viper boa anaconda mamba rattlesnake adder '
  + 'worm worms earthworm larva larvae maggot caterpillar slug leech '
  + 'couleuvre vipere ver vers lombric chenille limace sangsue asticot larve '
  + 'serpiente culebra gusano oruga babosa '
  + 'schlange wurm raupe schnecke '
  + 'serpente verme bruco lumaca '
  + 'cobra minhoca lagarta lesma').split(' '));
/* FAUX AMIS ET MOTS A DOUBLE SENS (2026-10-13, audit de la langue SERVEUR-06 / MANQUE-SERV-04). Meme regle cote Modal
 * (modal_app/_prompts.py, mode_depuis_texte) : un chat qui court « vers » la maison recevait le gabarit SERPENT (corps etire, pattes
 * interdites), « a parrot on a wooden perch » le gabarit POISSON.
 *  - « hai » (it : « tu as ») et « wal » (nl : « quai ») sont retires des listes : un texte allemand (Hai, Wal) arrive traduit ;
 *  - « ver » / « vers » (fr : « vers la maison », es / pt : « ver el mar ») ne comptent pas devant un article ou un determinant ;
 *  - les mots AMBIGUS (perch, bass, pike, ray, cod, carp, boa, python, adder, slug, ver, vers) ne comptent pas quand le texte nomme une
 *    AUTRE espece (chat, cheval, lapin, chevalier... : MOTS_ESPECES ci-dessus, plus AUTRES_ANIMAUX). */
const MOTS_AMBIGUS = new Set('perch bass pike ray cod carp boa python adder slug ver vers bat bats fly flies ape'.split(' '));
const MOTS_VOL = new Set(('fly flies flying flyer flyers winged airborne soaring hovering pegasus griffin gryphon harpy fairy fairies angel angels '
  + 'eagle eagles hawk hawks falcon falcons vulture vultures '
  + 'hummingbird bat bats butterfly butterflies moth moths bee bees wasp wasps hornet hornets dragonfly dragonflies mosquito mosquitoes '
  + 'volant volante volants volantes voler vole ailee ailes aigle aigles faucon faucons vautour '
  + 'chauve papillon papillons abeille abeilles guepe frelon libellule moustique pegase griffon fee fees ange anges '
  + 'volador voladora volando alado alada aguila halcon buitre murcielago mariposa abeja avispa libelula '
  + 'pegaso grifo hada '
  + 'fliegend fliegt adler falke geier fledermaus schmetterling biene wespe libelle '
  + 'volante volanti aquila falco avvoltoio pipistrello farfalla ape vespa libellula '
  + 'aguia morcego borboleta').split(' '));
// autres animaux absents des profils de marche (servent SEULEMENT a lever l'ambiguite, sans changer l'allure choisie)
const AUTRES_ANIMAUX = new Set(('parrot parrots owl owls swan swans dove doves peacock flamingo falcon raven sparrow seagull '
  + 'perroquet hibou chouette cygne colombe paon flamant faucon moineau mouette loro buho lechuza cisne paloma halcon gaviota '
  + 'papagei schwan taube pfau falke mowe pappagallo gufo civetta cigno colomba pavone falco gabbiano papagaio coruja pomba '
  + 'pavao falcao gaivota').split(' '));
const DETERMINANTS = new Set(('le la les l un une des du au aux sa son ses ce cet cette ces mon ma mes ton ta tes notre nos votre vos '
  + 'leur leurs el los las lo una unos unas o os as um uma uns umas il gli the').split(' '));
/* SUJET SEULEMENT (2026-10-24, audit des prompts M10) : le mot d'une liste ne compte que s'il DESIGNE le sujet, c'est-a-dire s'il vient AVANT le premier mot qui ouvre
 * un complement (preposition, verbe : « chasing », « eating », « holding », « with »...) et n'est pas suivi d'un nom qui en fait un accessoire (« goldfish bowl », « snake
 * tattoo », « fish tank »). « a cat chasing a fish », « a fisherman holding a fish », « a bird eating a worm », « a cat with a snake tattoo » ne donnent plus le gabarit
 * poisson ou serpent a un chat, un pecheur ou un oiseau. Jumeau Python : modal_app/_prompts.py (listes identiques, comparees par build/bancs/noyaux/test_faux_amis_gabarit.py). */
const FIN_SUJET = new Set(('with without chasing chases chase eating eats eat holding holds hold carrying carries carry catching catches catch hunting hunts hunt wearing wears wear playing plays play watching watches watch near beside next by on in at from for and or while that which who under over behind using uses riding rides feeding feeds attacking attacks fighting fights stalking stalks biting bites pursuing pursues swallowing swallows devouring devours tossing throwing throws avec qui tient tenant mange mangeant chasse poursuit sur dans pres contre et ou con que sobre sostiene come caza mit und oder auf sopra com onde').split(' '));
const APRES_NON_SUJET = new Set(('bowl bowls tank tanks aquarium market stall tattoo tattoos pattern print prints shirt costume mask toy toys lamp sculpture statue stew soup dish curry fillet fillets bait hook hooks net nets cake sandwich skin leather shaped like themed food pond').split(' '));
function _compteMode(mots, i, liste, autreEspece, fin) {
  const m = mots[i];
  if (!liste.has(m)) return false;
  if (i >= fin || APRES_NON_SUJET.has(mots[i + 1] || '')) return false;
  if (!MOTS_AMBIGUS.has(m)) return true;
  if (autreEspece) return false;
  return !((m === 'ver' || m === 'vers') && DETERMINANTS.has(mots[i + 1] || ''));
}
/** Mode d'apres les mots d'un texte (nom du projet, prompt…) : 'nage', 'reptation', 'vol' ou null. */
export function modeDepuisTexte(texte) {
  const mots = String(texte || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const autreEspece = mots.some((m) => INDEX_ESPECES.has(m) || AUTRES_ANIMAUX.has(m));
  let fin = mots.findIndex((m) => FIN_SUJET.has(m));
  if (fin < 0) fin = mots.length;
  if (mots.some((m, i) => _compteMode(mots, i, MOTS_NAGE, autreEspece, fin))) return 'nage';
  if (mots.some((m, i) => _compteMode(mots, i, MOTS_REPTATION, autreEspece, fin))) return 'reptation';
  // vol (25/10) : « a flying pig », « un aigle », « une abeille » ; evalue APRES la nage et la reptation (un poisson volant reste un poisson)
  if (mots.some((m, i) => _compteMode(mots, i, MOTS_VOL, autreEspece, fin))) return 'vol';
  return null;
}
/** Mode d'apres le SQUELETTE : 'pattes' si des pattes sont detectees, sinon 'reptation'. */
export function modeDuSquelette(glb) {
  const sq = charger(glb);
  return detecterPattes(sq.par, sq.P0, sq.racine).pattes.length ? 'pattes' : 'reptation';
}

// ------------------------------------------------------------------ vecteurs et matrices 3x3
// vecteur = [x, y, z] ; matrice = 9 nombres, lignes d'abord
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mulS = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const I3 = () => [1, 0, 0, 0, 1, 0, 0, 0, 1];
const mm = (A, B) => {
  const C = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[3 * i + j] = A[3 * i] * B[j] + A[3 * i + 1] * B[3 + j] + A[3 * i + 2] * B[6 + j];
  return C;
};
const mv = (A, v) => [A[0] * v[0] + A[1] * v[1] + A[2] * v[2], A[3] * v[0] + A[4] * v[1] + A[5] * v[2], A[6] * v[0] + A[7] * v[1] + A[8] * v[2]];
const tr = (A) => [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]];
const Rx = (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };
const Ry = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
const Rz = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
function rotvec(axe, ang) {                                   // Rodrigues
  const n = norm(axe);
  if (n < 1e-12 || Math.abs(ang) < 1e-15) return I3();
  const [x, y, z] = mulS(axe, 1 / n), c = Math.cos(ang), s = Math.sin(ang), C = 1 - c;
  return [c + x * x * C, x * y * C - z * s, x * z * C + y * s,
    y * x * C + z * s, c + y * y * C, y * z * C - x * s,
    z * x * C - y * s, z * y * C + x * s, c + z * z * C];
}
/** Comme aligner, mais le LACET (rotation autour de la verticale) d'abord : un os qui ne fait que
 *  tourner à plat reste à plat. La rotation minimale seule faisait basculer un os incliné
 *  (nageoire caudale du poisson sous le sol en virage serré, 28/09). */
function alignerLacet(a, b) {
  const ha = Math.hypot(a[0], a[2]), hb = Math.hypot(b[0], b[2]);
  if (ha < 1e-4 * norm(a) || hb < 1e-4 * norm(b)) return aligner(a, b);
  const Y = Ry(Math.atan2(b[0], b[2]) - Math.atan2(a[0], a[2]));
  return mm(aligner(mv(Y, a), b), Y);
}
function aligner(a, b) {                                      // rotation minimale a -> b
  a = mulS(a, 1 / (norm(a) + 1e-12));
  b = mulS(b, 1 / (norm(b) + 1e-12));
  const v = cross(a, b), c = dot(a, b);
  if (c < -0.999999) {
    const axe = Math.abs(a[0]) < 0.9 ? cross(a, [1, 0, 0]) : cross(a, [0, 1, 0]);
    return rotvec(axe, Math.PI);
  }
  const K = [0, -v[2], v[1], v[2], 0, -v[0], -v[1], v[0], 0];
  const K2 = mm(K, K), f = 1 / (1 + c);
  return I3().map((e, i) => e + K[i] + K2[i] * f);
}
function orthonormer(M) {                                     // rotation la plus proche (décomposition polaire)
  let R = M.slice();
  for (let it = 0; it < 30; it++) {
    const det = R[0] * (R[4] * R[8] - R[5] * R[7]) - R[1] * (R[3] * R[8] - R[5] * R[6]) + R[2] * (R[3] * R[7] - R[4] * R[6]);
    if (Math.abs(det) < 1e-12) break;
    const inv = [(R[4] * R[8] - R[5] * R[7]) / det, (R[2] * R[7] - R[1] * R[8]) / det, (R[1] * R[5] - R[2] * R[4]) / det,
      (R[5] * R[6] - R[3] * R[8]) / det, (R[0] * R[8] - R[2] * R[6]) / det, (R[2] * R[3] - R[0] * R[5]) / det,
      (R[3] * R[7] - R[4] * R[6]) / det, (R[1] * R[6] - R[0] * R[7]) / det, (R[0] * R[4] - R[1] * R[3]) / det];
    const it_ = tr(inv), N = R.map((e, i) => 0.5 * (e + it_[i]));
    let d = 0;
    for (let i = 0; i < 9; i++) d = Math.max(d, Math.abs(N[i] - R[i]));
    R = N;
    if (d < 1e-12) break;
  }
  return R;
}
function quatDeMatrice(m) {                                   // [x, y, z, w]
  const t = m[0] + m[4] + m[8];
  let x, y, z, w;
  if (t > 0) {
    const s = Math.sqrt(t + 1) * 2;
    w = 0.25 * s; x = (m[7] - m[5]) / s; y = (m[2] - m[6]) / s; z = (m[3] - m[1]) / s;
  } else if (m[0] > m[4] && m[0] > m[8]) {
    const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2;
    w = (m[7] - m[5]) / s; x = 0.25 * s; y = (m[1] + m[3]) / s; z = (m[2] + m[6]) / s;
  } else if (m[4] > m[8]) {
    const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2;
    w = (m[2] - m[6]) / s; x = (m[1] + m[3]) / s; y = 0.25 * s; z = (m[5] + m[7]) / s;
  } else {
    const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2;
    w = (m[3] - m[1]) / s; x = (m[2] + m[6]) / s; y = (m[5] + m[7]) / s; z = 0.25 * s;
  }
  const n = Math.hypot(x, y, z, w);
  return [x / n, y / n, z / n, w / n];
}
const angleRot = (m) => Math.acos(Math.max(-1, Math.min(1, (m[0] + m[4] + m[8] - 1) / 2)));
const median = (a) => { const s = [...a].sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : 0.5 * (s[n / 2 - 1] + s[n / 2]); };
const moyenne = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const clip = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const longueurChaine = (P) => { let L = 0; for (let k = 1; k < P.length; k++) L += norm(sub(P[k], P[k - 1])); return L; };

// ------------------------------------------------------------------ lecture / écriture GLB
function lireGLB(buffer) {
  const dv = new DataView(buffer);
  if (dv.getUint32(0, true) !== 0x46546C67) throw new Error('pas un GLB');
  let off = 12, json = null, bin = new Uint8Array(0);
  while (off < buffer.byteLength) {
    const n = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
    const bloc = new Uint8Array(buffer, off + 8, n);
    if (type === 0x4E4F534A) json = JSON.parse(new TextDecoder().decode(bloc));
    else if (type === 0x004E4942) bin = bloc.slice();
    off += 8 + n;
  }
  return { json, bin };
}
// matrice 4x4 lignes d'abord ; nœud glTF : `matrix` (colonnes d'abord) ou T * R * S
function matriceLocale(n) {
  if (n.matrix) { const m = n.matrix; return [m[0], m[4], m[8], m[12], m[1], m[5], m[9], m[13], m[2], m[6], m[10], m[14], m[3], m[7], m[11], m[15]]; }
  const [x, y, z, w] = n.rotation || [0, 0, 0, 1], [sx, sy, sz] = n.scale || [1, 1, 1], [tx, ty, tz] = n.translation || [0, 0, 0];
  const R = [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
  return [R[0] * sx, R[1] * sy, R[2] * sz, tx, R[3] * sx, R[4] * sy, R[5] * sz, ty, R[6] * sx, R[7] * sy, R[8] * sz, tz, 0, 0, 0, 1];
}
const mm4 = (A, B) => {
  const C = new Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += A[4 * i + k] * B[4 * k + j]; C[4 * i + j] = s; }
  return C;
};
function matricesMonde(json) {
  const noeuds = json.nodes, parent = new Map(), W = new Map();
  noeuds.forEach((n, i) => (n.children || []).forEach((c) => parent.set(c, i)));
  const w = (i) => {
    if (!W.has(i)) { const M = matriceLocale(noeuds[i]); W.set(i, parent.has(i) ? mm4(w(parent.get(i)), M) : M); }
    return W.get(i);
  };
  noeuds.forEach((_, i) => w(i));
  return { W, parent };
}
const rot4 = (M) => [M[0], M[1], M[2], M[4], M[5], M[6], M[8], M[9], M[10]];
const pos4 = (M) => [M[3], M[7], M[11]];
function inv4(m) {                                            // inverse d'une matrice affine 4x4
  const R = rot4(m), t = pos4(m);
  const det = R[0] * (R[4] * R[8] - R[5] * R[7]) - R[1] * (R[3] * R[8] - R[5] * R[6]) + R[2] * (R[3] * R[7] - R[4] * R[6]);
  const Ri = [(R[4] * R[8] - R[5] * R[7]) / det, (R[2] * R[7] - R[1] * R[8]) / det, (R[1] * R[5] - R[2] * R[4]) / det,
    (R[5] * R[6] - R[3] * R[8]) / det, (R[0] * R[8] - R[2] * R[6]) / det, (R[2] * R[3] - R[0] * R[5]) / det,
    (R[3] * R[7] - R[4] * R[6]) / det, (R[1] * R[6] - R[0] * R[7]) / det, (R[0] * R[4] - R[1] * R[3]) / det];
  const ti = mulS(mv(Ri, t), -1);
  return [Ri[0], Ri[1], Ri[2], ti[0], Ri[3], Ri[4], Ri[5], ti[1], Ri[6], Ri[7], Ri[8], ti[2], 0, 0, 0, 1];
}

function charger(buffer) {
  const { json, bin } = lireGLB(buffer);
  if (!json.skins || !json.skins.length) throw new Error('ce modèle n\'a pas de squelette');
  const joints = json.skins[0].joints.slice();
  const { W, parent } = matricesMonde(json);
  const ens = new Set(joints), idx = new Map(joints.map((n, i) => [n, i]));
  const par = joints.map((n) => {
    let p = parent.get(n);
    while (p !== undefined && !ens.has(p)) p = parent.get(p);
    return p !== undefined ? idx.get(p) : -1;
  });
  const P0 = joints.map((n) => pos4(W.get(n)));
  // plusieurs racines possibles (corps + accessoire separes) : la principale porte le plus d'os
  const E = enfantsDe(par);
  const racines = par.map((q, i) => (q < 0 ? i : -1)).filter((i) => i >= 0);
  const taille = (r) => sousArbre(E, r).length;
  const racine = racines.reduce((m, r) => (taille(r) > taille(m) ? r : m), racines[0]);
  return { json, bin, joints, par, P0, W, parent, racines, racine };
}

// ------------------------------------------------------------------ squelette
const enfantsDe = (par) => { const E = par.map(() => []); par.forEach((p, j) => { if (p >= 0) E[p].push(j); }); return E; };
function sousArbre(E, j) { const pile = [j], out = []; while (pile.length) { const k = pile.pop(); out.push(k); pile.push(...E[k]); } return out; }
const ptpAxe = (P, a) => Math.max(...P.map((p) => p[a])) - Math.min(...P.map((p) => p[a]));
const etendue = (P) => Math.max(ptpAxe(P, 0), ptpAxe(P, 1), ptpAxe(P, 2));

function detecterPattes(par, P0, racinePrincipale = null) {
  const E = enfantsDe(par), J = par.length;
  const racine = racinePrincipale ?? par.indexOf(-1);
  const sol = Math.min(...P0.map((p) => p[1])), H = ptpAxe(P0, 1), ext = etendue(P0);
  const x0 = median(P0.map((p) => p[0]));                    // axe médian du corps
  const feuilles = [];
  for (let j = 0; j < J; j++) if (!E[j].length) feuilles.push(j);
  const prof = par.map((_, j) => { let k = j, n = 0; while (par[k] >= 0) { k = par[k]; n++; } return n; });
  const chemin = (j) => { const c = []; while (j >= 0) { c.push(j); j = par[j]; } return c.reverse(); };
  const ancetre = (a, b) => { const ca = chemin(a), cb = chemin(b); let k = 0; while (k < Math.min(ca.length, cb.length) && ca[k] === cb[k]) k++; return ca[k - 1]; };

  let bas = feuilles.filter((j) => P0[j][1] - sol < 0.2 * H);
  // patte LEVÉE au repos (pattes arrière de l'araignée à 26-28 % de la hauteur)
  const levees = new Set(feuilles.filter((j) => P0[j][1] - sol >= 0.2 * H && P0[j][1] - sol < 0.45 * H && Math.abs(P0[j][0] - x0) > 0.1 * ext));
  bas = bas.concat([...levees].sort((a, b) => a - b));
  // queue posée au sol : bout central ET derrière la hanche -> pas une patte
  bas = bas.filter((j) => !(Math.abs(P0[j][0] - x0) < 0.01 * ext && P0[j][2] < P0[racine][2] - 0.1 * ext));
  // pieds : feuilles au sol dont l'ancêtre commun est à 2 os au plus (orteils d'un même pied)
  const grappes = [];
  for (const j of [...bas].sort((a, b) => P0[a][1] - P0[b][1])) {
    // + PROCHES dans l'espace : 4 pieds courts d'une table (ancetre commun a 2 os) formaient un seul pied
    // + ORTEILS LONGS (poule du user, 28/09 : 7 a 9 os par orteil, poses a plat) : un ancetre commun
    // lui-meme AU SOL est une cheville — deux pattes differentes ne se rejoignent jamais au ras du sol
    const g = grappes.find((g_) => {
      const a = ancetre(j, g_[0]);
      if (P0[a][1] - sol < 0.2 * H && norm(sub(P0[j], P0[g_[0]])) < 0.4 * ext) return true;   // meme seuil que « au sol »
      return prof[j] - prof[a] <= 2 && prof[g_[0]] - prof[a] <= 2 && norm(sub(P0[j], P0[g_[0]])) < 0.12 * ext;
    });
    if (g) g.push(j); else grappes.push([j]);
  }
  const feuilleGrappe = new Map();
  grappes.forEach((g, gi) => g.forEach((j) => feuilleGrappe.set(j, gi)));
  const grappesSous = (j) => new Set(sousArbre(E, j).filter((k) => feuilleGrappe.has(k)).map((k) => feuilleGrappe.get(k)));

  let pattes = [];
  grappes.forEach((g, gi) => {
    let bout = g[0];
    for (const f of g.slice(1)) bout = ancetre(bout, f);    // la cheville si plusieurs orteils
    let haut = bout;
    while (par[haut] >= 0 && par[haut] !== racine) {
      const gs = grappesSous(par[haut]);
      if (gs.size !== 1 || !gs.has(gi)) break;
      haut = par[haut];
    }
    const chaine = [];
    for (let k = bout; ; k = par[k]) { chaine.push(k); if (k === haut) break; }
    chaine.reverse();
    if (chaine.length < 2) return;
    const toutesLevees = g.every((f) => levees.has(f));
    if (toutesLevees && (chaine.length < 3 || P0[bout][1] >= P0[chaine[1]][1])) return;
    // une patte levée part du CORPS (niveau du bassin), jamais des épaules : les bras d'un
    // guerrier accroupi tenant une hache basse (mains à 40 % de la hauteur) passaient pour des
    // pattes et le faisaient marcher à quatre pattes (28/09)
    if (toutesLevees && P0[chaine[0]][1] > P0[racine][1] + 0.15 * H) return;
    // une patte DESCEND vers le sol ou part sur le COTE : la tete d'un serpent posee au sol
    // (chaine centrale et horizontale) n'en est pas une
    const Lc = longueurChaine(chaine.map((k) => P0[k]));
    if (P0[chaine[0]][1] - P0[bout][1] < 0.25 * Lc && Math.abs(P0[bout][0] - x0) < 0.15 * ext) return;
    pattes.push({ chaine, bout, levee: toutesLevees, dx: (P0[bout][0] + P0[chaine[0]][0]) / 2 - x0 });
  });
  const longueur = (q) => longueurChaine(q.chaine.map((k) => P0[k]));
  const ref = pattes.filter((q) => !q.levee).map(longueur);
  if (ref.length) { const m = median(ref); pattes = pattes.filter((q) => !q.levee || longueur(q) >= 0.6 * m); }
  // une patte LEVEE sans jumelle de l'autre cote n'en est pas une (aile pendante de la poule, 28/09) :
  // les pattes levees d'une araignee vont par paires symetriques
  const leveesP = pattes.filter((q) => q.levee);
  pattes = pattes.filter((q) => !q.levee || leveesP.some((r) => r !== q && Math.sign(r.dx) !== Math.sign(q.dx)
    && Math.abs(Math.abs(r.dx) - Math.abs(q.dx)) < 0.15 * ext));
  // côté (+X = gauche) ; patte presque centrale (lion étroit) : l'opposé de sa voisine en Z
  for (const p of pattes) p.cote = Math.abs(p.dx) > 0.01 * ext ? Math.sign(p.dx) : 0;
  for (const p of pattes) {
    if (p.cote !== 0) continue;
    const autres = pattes.filter((q) => q !== p);
    if (autres.length) {
      const v = autres.reduce((m, q) => (Math.abs(P0[q.bout][2] - P0[p.bout][2]) < Math.abs(P0[m.bout][2] - P0[p.bout][2]) ? q : m));
      p.cote = v.cote ? -v.cote : (p.dx >= v.dx ? 1 : -1);
    } else p.cote = 1;
  }
  // queue et tête : chaînes centrales issues du tronc
  const dansPattes = new Set(pattes.flatMap((p) => p.chaine));
  const sousPattes = new Set(pattes.flatMap((p) => sousArbre(E, p.chaine[0])));
  const autres = [];
  for (const f of feuilles) {
    if (dansPattes.has(f) || sousPattes.has(f)) continue;
    const c = [];
    let k = f;
    while (k >= 0 && par[k] >= 0 && !dansPattes.has(k) && k !== racine && E[par[k]].length === 1) { c.push(k); k = par[k]; }
    if (k >= 0 && k !== racine && !dansPattes.has(k)) c.push(k);
    c.reverse();
    if (c.length >= 2) autres.push(c);
  }
  const queues = autres.filter((c) => P0[c[c.length - 1]][2] < P0[racine][2] && Math.abs(P0[c[c.length - 1]][0] - x0) < 0.05 * ext);
  const tetes = autres.filter((c) => P0[c[c.length - 1]][2] > P0[racine][2] && Math.abs(P0[c[c.length - 1]][0] - x0) < 0.05 * ext);
  return { racine, pattes, queues, tetes, sol };
}

function phases(pattes, P0, allure) {
  for (const cote of [1, -1]) {
    const cc = pattes.filter((p) => p.cote === cote).sort((a, b) => P0[b.bout][2] - P0[a.bout][2]);
    cc.forEach((p, k) => { p.rang = k; p.nbCote = cc.length; });
  }
  const n = pattes.length;
  for (const p of pattes) {
    const s = p.cote === 1 ? 0 : 1;
    if (n <= 2) p.phase = 0.5 * s;
    else if (n <= 4 && p.nbCote === 2 && allure !== 'run') p.phase = 0.5 * s + (p.rang === 0 ? 0.25 : 0.0);   // pas latéral
    else if (p.nbCote >= 5 && allure !== 'run') p.phase = ((0.5 * s + 0.1 * p.rang) % 1 + 1) % 1;              // mille-pattes : vague
    else {
      const onde = allure !== 'run' ? 0.06 : 0.0;             // trépied / tétrapode alterné (+ onde)
      p.phase = (((0.5 * ((p.rang + s) % 2) + onde * (p.nbCote - 1 - p.rang)) % 1) + 1) % 1;
    }
  }
}

// ------------------------------------------------------------------ cinématique inverse à forme gardée
// La patte garde la FORME de sa pose de repos (zigzag, sens de pliure) : toutes ses pliures sont
// multipliées par un même facteur k pour atteindre la cible, puis la patte entière est orientée.
// FABRIK (sans contrainte) faisait dériver la pliure : genoux de côté, pattes retournées de 138°.
function preparerForme(P, pole, droite = false) {
  const a = P[0], b = P[P.length - 1];
  const e1 = mulS(sub(b, a), 1 / (norm(sub(b, a)) + 1e-12));
  let e2 = sub(pole, mulS(e1, dot(pole, e1)));
  if (norm(e2) < 1e-6) e2 = Math.abs(e1[0]) < 0.9 ? cross(e1, [1, 0, 0]) : cross(e1, [0, 1, 0]);
  e2 = mulS(e2, 1 / norm(e2));
  const e3 = cross(e1, e2), l = [], z = [];
  let phi = [];
  for (let k = 1; k < P.length; k++) {
    const v = sub(P[k], P[k - 1]), x = dot(v, e1), y = dot(v, e2);
    l.push(Math.hypot(x, y)); phi.push(Math.atan2(y, x)); z.push(dot(v, e3));
  }
  // jambe droite au repos (ou jugee telle : bipede en T-pose, voir la geometrie des pattes) : pliure
  // conventionnelle. Sans « droite », un genou 1 cm en arriere (0,058 rad) gardait ce recul, amplifie.
  if ((droite || Math.max(...phi.map(Math.abs)) < 0.05) && phi.length >= 2) {
    const m = (phi.length - 1) / 2;                           // premiere moitie vers le pole, seconde en retour
    phi = phi.map((_, k) => (k < m ? 0.08 : k > m ? -0.08 : 0));
  }
  return { l, phi, z };
}
function chaineLocale(F, k) {
  const C = [[0, 0, 0]];
  for (let i = 0; i < F.l.length; i++) {
    const a = k * F.phi[i], p = C[C.length - 1];
    C.push([p[0] + F.l[i] * Math.cos(a), p[1] + F.l[i] * Math.sin(a), p[2] + F.z[i]]);
  }
  return C;
}
function resoudreForme(F, base, cible, poleMonde) {
  const d = norm(sub(cible, base));
  // pas d'autre plafond que 0,9 pi sur la plus forte pliure : une jambe DROITE au repos (pliure
  // conventionnelle de 0,08) plafonnait à k = 8, genou à 73° ; accroupie (« crawl ») elle ne
  // pouvait plus se replier et enfonçait le pied de 4 % sous le sol (28/09)
  let kmax = 0.9 * Math.PI / Math.max(Math.max(...F.phi.map(Math.abs)), 1e-3);
  const longueur = (k) => { const C = chaineLocale(F, k); return norm(C[C.length - 1]); };
  // au-delà d'un certain repli la patte se RALLONGE : recherche arrêtée au minimum de longueur
  let kmin = 0, lmin = Infinity;
  for (let i = 0; i <= 64; i++) { const k = kmax * i / 64, L = longueur(k); if (L < lmin) { lmin = L; kmin = k; } }
  kmax = kmin;
  let k;
  if (d >= longueur(0)) k = 0;
  else if (d <= longueur(kmax)) k = kmax;
  else {
    let lo = 0, hi = kmax;
    for (let it = 0; it < 40; it++) { const m = 0.5 * (lo + hi); if (longueur(m) > d) lo = m; else hi = m; }
    k = 0.5 * (lo + hi);
  }
  const C = chaineLocale(F, k), fin = C[C.length - 1];
  const g1 = mulS(fin, 1 / (norm(fin) + 1e-12));
  let g2 = sub([0, 1, 0], mulS(g1, g1[1]));
  g2 = mulS(g2, 1 / (norm(g2) + 1e-12));
  const g3 = cross(g1, g2);
  const f1 = mulS(sub(cible, base), 1 / (d + 1e-12));
  let f2 = sub(poleMonde, mulS(f1, dot(poleMonde, f1)));
  f2 = norm(f2) < 1e-6 ? g2 : mulS(f2, 1 / norm(f2));
  const f3 = cross(f1, f2);
  // M = [f1 f2 f3] (colonnes) · [g1; g2; g3] (lignes)
  const M = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[3 * i + j] = f1[i] * g1[j] + f2[i] * g2[j] + f3[i] * g3[j];
  return C.map((p) => add(base, mv(M, p)));
}

// ------------------------------------------------------------------ animation d'une allure
function animerAllure(sq, allure, cycles, fps, variante = 'normal', espece = 'generique', ampleurMax = 1) {
  const { joints, par, P0 } = sq;
  const det = detecterPattes(par, P0, sq.racine);
  const { racine, queues, tetes, sol } = det;
  // allures ajoutees (2026-09-28) : trot et saut se calculent comme une course, les actions
  // (manger, attaque…) comme l'attente (pieds poses) ; la mort est une chute rigide
  const genre = ALLURES[allure].rapide ? 'run' : !ALLURES[allure].pas ? 'idle' : allure;
  if (ALLURES[allure].action === 'death') return animerChute(sq, det, fps, variante);
  let pattes = det.pattes.map((p) => ({ ...p }));
  if (!pattes.length) return animerSansPattes(sq, allure, cycles, fps, variante, det);
  // Bipede dont une jambe a ete detectee SOUS une hanche qui se ramifie (os de pagne, de jupe : orc du
  // 28/09) : elle commencait au GENOU, la cuisse n'etait pas animee et le « genou » pliait a l'envers.
  // Chaque jambe part de sa hanche : on remonte jusqu'au bassin commun aux deux jambes.
  if (pattes.length === 2) {
    const ancetres = (j) => { const s_ = new Set(); for (let k = par[j]; k >= 0; k = par[k]) s_.add(k); return s_; };
    for (const [p, q] of [[pattes[0], pattes[1]], [pattes[1], pattes[0]]]) {
      const bassin = ancetres(q.chaine[0]), ajout = [];
      for (let r = p.chaine[0]; par[r] >= 0 && !bassin.has(par[r]) && par[r] !== racine; r = par[r]) ajout.unshift(par[r]);
      if (ajout.length) p.chaine = [...ajout, ...p.chaine];
    }
  }
  let palpes = [];
  if (pattes.length >= 6) {                                   // pédipalpes : « pattes » bien plus courtes
    const lg = pattes.map((q) => longueurChaine(q.chaine.map((k) => P0[k]))), med = median(lg);
    palpes = pattes.filter((_, i) => lg[i] < 0.65 * med);
    pattes = pattes.filter((_, i) => lg[i] >= 0.65 * med);
  }
  phases(pattes, P0, genre);
  // profil d'espece : un quadrupede (2 pattes de chaque cote) ou, pour l'oiseau, un bipede
  const quadrupede = pattes.length === 4 && pattes.every((p) => p.nbCote === 2);
  const famille = ESPECES[espece] ? espece : 'generique';
  const corps = POUR_ESPECE[famille] || 'quadrupede';
  const pourQui = corps === 'bipede' ? pattes.length === 2 : corps === 'multi' ? pattes.length >= 6 : quadrupede;
  const Pr = pourQui ? ((ESPECES[famille] || {})[allure === 'turn_left' || allure === 'turn_right' || allure === 'walk_back' ? 'walk' : allure] || {}) : {};
  const motifNom = Pr.motif || ALLURES[allure].motif;
  if (motifNom && quadrupede && ALLURES[allure].pas) {
    const pose = MOTIFS[motifNom];
    for (const p of pattes) {
      const cle = (p.rang === 0 ? 'A' : 'P') + (p.cote === 1 ? 'G' : 'D');
      p.phase = ((1 - pose[cle]) % 1 + 1) % 1;              // pose a l'instant t : phase = -t
    }
  }
  // saut : allure « jump », ou espece qui avance par bonds (kangourou, grenouille)
  const SAUT = !!(ALLURES[allure].saut || (Pr.saut && ALLURES[allure].pas));
  // crabe : marche DE COTE (le corps avance vers +X) ; les virages restent normaux
  const DECOTE = !!(Pr.deCote && ALLURES[allure].pas && allure !== 'turn_left' && allure !== 'turn_right');
  // saut : toutes les pattes ensemble ; profil quadrupede avec « decalage » : les pattes AVANT quittent le sol et le reprennent un peu
  // AVANT les pattes arriere (cheval qui franchit un obstacle : l'avant-main se leve, l'arriere pousse puis suit)
  if (SAUT) pattes.forEach((p) => { p.phase = quadrupede && Pr.decalage && p.rang === 0 ? Pr.decalage : 0; });
  // Tete qui se RAMIFIE (oreilles, machoire : rig de la Mule, 28/09) : aucune chaine « tete » n'est
  // reconnue, donc pas de balancier du cou. Avec un profil : encolure = chemin de la ceinture avant
  // vers la feuille la plus en avant (hors pattes et queues).
  let tetesA = tetes;
  if (!tetes.length && quadrupede && (Object.keys(Pr).length || ALLURES[allure].action)) {
    const cou = encolure(par, P0, pattes, queues);
    if (cou) tetesA = [cou];
  }
  const B = ALLURES[allure], V = (VARIANTES[allure] || {})[variante] || {};
  const tourne = allure === 'turn_left' || allure === 'turn_right';
  const A = {
    ...B, T: B.T.map((x) => x * (Pr.T || 1) * (V.T || 1)), foulee: B.foulee * (tourne ? 1 : Pr.foulee || 1) * (V.foulee || 1),
    h: B.h * (Pr.h || 1) * (V.h || 1), bob: B.bob * (Pr.bob || 1) * (V.bob || 1), lacet: B.lacet * (V.lacet || 1),
    beta: Pr.beta ?? B.beta, tendu: V.tendu ?? Pr.tendu ?? B.tendu,
    tete: V.tete ?? Pr.tete ?? 0, regard: V.regard ?? Pr.regard ?? B.regard ?? 1, queue: V.queue ?? Pr.queue ?? B.queue ?? 1, bras: V.bras ?? Pr.bras ?? 1,
    talon: Pr.talon ?? B.talon, attaque: B.recul ? 0 : Pr.attaque ?? B.attaque ?? 0, lateral: Pr.lateral ?? 0.035, tronc: Pr.tronc ?? null, levee: Pr.levee ?? 0,
    motif: B.pas && quadrupede ? motifNom || null : null, flexion: tourne ? 0 : Pr.flexion || 0, ondulation: Pr.ondulation || 0,
    tangage: Pr.tangage || 0, hoche: Pr.hoche ?? null, roulis: Pr.roulis || 0, leve: Pr.leve || 0,
    teteContre: Pr.teteContre || 0, queueOnde: Pr.queueOnde || 0, abdomen: Pr.abdomen || 0,
  };
  const nombreux = pattes.length >= 6, bipede = pattes.length <= 2;
  let T = A.T[nombreux ? 1 : 0];
  // periode = nombre ENTIER d'images (la derniere image enchaine sur la premiere) : bipedes, et profils marques « cycleEntier »
  if (bipede || Pr.cycleEntier) T = Math.max(2, Math.round(T * fps)) / fps;
  // quadrupede a profil d'espece : periode ARRONDIE a un nombre entier d'images, sinon la boucle (derniere -> premiere
  // image) tombe a mi-pas (T x fps non entier : couture mesuree 5,7 fois le pas local sur la Mule au galop)
  if (quadrupede && A.pas && Object.keys(Pr).length) T = Math.max(Math.round(T * fps), 4) / fps;
  let beta = nombreux && genre !== 'run' && A.pas ? 0.55 : A.beta;
  if (pattes.length >= 10 && genre !== 'run' && A.pas) beta = 0.7;      // mille-pattes : plus de pieds au sol
  if (bipede && A.pas && genre !== 'run') beta = 0.6;
  if (Pr.beta != null && A.pas) beta = Pr.beta;             // profil d'espece
  const H = ptpAxe(P0, 1), E = enfantsDe(par);
  // bipede DROIT (humain, primate : colonne verticale) ou penche (poule, dinosaure : corps horizontal, cou en avant) :
  // le premier juge les courbes d'action a mains et a torse, le second celles du corps a gueule
  let droit = false;
  if (bipede) {
    let sommet = racine;
    for (let j = 0; j < par.length; j++) if (!E[j].length && P0[j][1] > P0[sommet][1]) sommet = j;
    const voie = [];
    for (let k = sommet; k >= 0; k = par[k]) { voie.push(k); if (k === racine) break; }
    voie.reverse();
    const mid = voie[Math.floor(voie.length / 2)], v_ = sub(P0[mid], P0[racine]);
    droit = voie.length >= 3 && v_[1] > 2.0 * Math.hypot(v_[0], v_[2]);
  }

  // --- géométrie de chaque patte : chaîne IK, pied rigide, point neutre, sens de pliure
  for (const p of pattes) {
    const ch = p.chaine;
    const seg = [];
    for (let k = 1; k < ch.length; k++) seg.push(norm(sub(P0[ch[k]], P0[ch[k - 1]])));
    const d0 = sub(P0[p.bout], P0[ch[0]]);
    const debout = Math.abs(d0[1]) > 1.5 * Math.hypot(d0[0], d0[2]);
    let piedCourt = ch.length >= 4 && seg[seg.length - 1] < 0.5 * moyenne(seg.slice(0, -1));
    // Pied PLAT d'un animal a membres etales (profil « piedPlat », lezard) : le dernier os, horizontal et pose, reste
    // un pied rigide. Sinon la pliure proportionnelle de l'IK le faisait pivoter et la cheville passait sous le sol.
    if (Pr.piedPlat && !piedCourt && ch.length >= 4 && Math.abs(P0[ch[ch.length - 1]][1] - P0[ch[ch.length - 2]][1]) < 0.5 * seg[seg.length - 1]) piedCourt = true;
    p.ik = piedCourt ? ch.slice(0, -1) : ch;
    // Jambe DEBOUT : la chaine qui plie s'arrete a la CHEVILLE, premiere articulation suivie d'un
    // segment plutot horizontal (le pied). Sans ca, un rig avec un os d'orteil de plus d'un cote
    // (guerrier du 28/09 : 4 os a gauche, 5 a droite) pliait le pied droit comme une articulation
    // de plus, le gauche restant rigide. BIPEDES seulement : sur les quadrupedes (phacochere, tortue)
    // le banc montrait plus d'a-coups (12 -> 28°).
    if (debout && bipede) {
      const k = p.ik.findIndex((j, a) => {
        if (a < 2 || a >= p.ik.length - 1) return false;
        const s_ = sub(P0[p.ik[a + 1]], P0[j]);
        return Math.abs(s_[1]) < Math.hypot(s_[0], s_[2]);
      });
      if (k >= 2) { p.ik = p.ik.slice(0, k + 1); piedCourt = true; }
    }
    // Patte ÉTALÉE (araignée, insecte) : son premier os part du CENTRE du corps jusqu'à la base
    // de la patte (la coxa, dans le corps). Le faire pivoter faisait glisser la base de la patte
    // le long du corps et déchirait la peau autour (plaques étirées, 28/09) : il reste rigide.
    if (!debout && ch.length >= 4) {
      p.ik = p.ik.slice(1);
      if (p.ik.length < 3) { p.ik = ch.slice(1); piedCourt = false; }   // garder 2 os qui plient
    }
    p.piedOff = sub(P0[p.bout], P0[p.ik[p.ik.length - 1]]);
    const sous = sousArbre(E, p.bout).filter((k) => !E[k].length && k !== p.bout);
    p.pivotOff = null;
    if (piedCourt) p.pivotOff = [0, 0, 0];                    // la patte pivote sur son bout
    else if (sous.length) {
      const orteil = sous.reduce((m, k) => (P0[k][2] > P0[m][2] ? k : m));
      const off = sub(P0[orteil], P0[p.bout]);
      if (off[2] > 0.05 * longueurChaine(ch.map((k) => P0[k]))) p.pivotOff = off;
    }
    // talon (pivot de l'attaque du talon), RELATIF A p.bout : sous la cheville (hauteur cheville-semelle), un peu en arriere
    // (25 % de la longueur cheville-orteil). p.bout peut etre l'orteil (jambe coupee a la cheville), pas la cheville.
    if (p.pivotOff) {
      const che = P0[p.ik[p.ik.length - 1]], pied_ = sousArbre(E, p.ik[p.ik.length - 1]);
      const semelle = Math.min(...pied_.map((k) => P0[k][1])), longPied = Math.max(...pied_.map((k) => P0[k][2])) - che[2];
      p.talonOff = [0, che[1] - P0[p.bout][1] - Math.max(che[1] - semelle, 0), che[2] - P0[p.bout][2] - 0.25 * Math.max(longPied, 0)];
    }
    const haut = P0[ch[0]];
    const N = P0[p.bout].slice();
    if (debout) N[2] = haut[2] + p.piedOff[2];               // cheville à l'aplomb de la hanche
    const contact = Math.min(...sousArbre(E, p.bout).map((k) => P0[k][1]));
    if (contact - sol > 0.02 * H) N[1] -= contact - sol;     // le point le plus BAS du pied touche le sol
    // Patte étalée presque tendue au repos (araignée : 96 % depuis sa base) : on ramène le pied
    // vers le corps plutôt que d'abaisser le corps (qui écrasait l'araignée au sol, 28/09).
    p.debout = debout;
    if (!debout) {
      const base = P0[p.ik[0]], Lc = longueurChaine(p.ik.map((k) => P0[k]));
      const v = sub(sub(N, p.piedOff), base), hz = Math.hypot(v[0], v[2]), lim = Math.min(A.tendu, 0.85) * Lc;
      if (norm(v) > lim && hz > 1e-9) {
        const k = Math.sqrt(Math.max(lim * lim - v[1] * v[1], 0)) / hz;
        N[0] = base[0] + k * v[0] + p.piedOff[0];
        N[2] = base[2] + k * v[2] + p.piedOff[2];
      }
    }
    p.neutre = N;
    const a_ = P0[p.ik[0]], b_ = P0[p.ik[p.ik.length - 1]];
    const u_ = mulS(sub(b_, a_), 1 / (norm(sub(b_, a_)) + 1e-12));
    let pole = [0, 0, 0], ecartMax = 0;
    for (const k of p.ik.slice(1, -1)) {
      const o = sub(P0[k], a_), perp = sub(o, mulS(u_, dot(o, u_)));
      pole = add(pole, perp);
      ecartMax = Math.max(ecartMax, norm(perp));
    }
    if (debout) pole[0] = 0;
    // Bipede dont la jambe est presque DROITE au repos (T-pose) : l'ecart du genou n'est que du bruit
    // du rig (guerrier du 28/09 : genou 1 cm en ARRIERE -> genoux plies a l'envers dans 100 % des
    // images de marche). Un genou se plie vers l'avant, du cote des orteils. Jugee sur le PLUS GRAND
    // ecart, pas sur leur somme : la patte d'une poule, en zigzag (genou en avant, cheville en
    // arriere), a une somme presque nulle et doit garder sa forme.
    const Lik = longueurChaine(p.ik.map((k) => P0[k]));
    let droite = false;
    if (debout && bipede && ecartMax < 0.06 * Lik) {
      droite = true;
      const orteils = [0, 0, P0[p.bout][2] - P0[p.ik[p.ik.length - 1]][2]];
      pole = Math.abs(orteils[2]) > 0.02 * Lik ? orteils : [0, 0, 1];
    }
    if (norm(pole) < 1e-4) pole = debout ? [0, 0, 1] : [0, 1, 0];
    p.pole = mulS(pole, 1 / norm(pole));
    p.forme = preparerForme(p.ik.map((k) => P0[k]), p.pole, droite);
    // Patte étalée dont le genou est SOUS la corde (tentacule de pieuvre qui s'affaisse) : en se
    // repliant elle enfonçait le genou dans le sol (8 % sous le sol, 28/09). Elle se replie en
    // MIROIR, genou vers le haut, comme une vraie patte qui se lève.
    p.poleIK = !debout && p.pole[1] < 0 ? mulS(p.pole, -1) : p.pole;
  }
  const portee = moyenne(pattes.map((p) => norm(sub(p.neutre, P0[p.chaine[0]]))));
  const hanche = moyenne(pattes.map((p) => P0[p.chaine[0]][1] - sol));
  let S = A.foulee * (0.6 * portee + 0.8 * hanche);
  const h = A.h * (0.5 * portee + 0.5 * hanche);
  // patte jamais trop tendue : bassin abaissé (A.tendu au neutre), demi-pas borné à 98 %
  // bipede : une jambe de marche humaine se tend presque completement (genou ~5 deg en milieu d'appui, Perry 1992) ; 0,97 plafonnait
  // le genou a 28 deg en permanence (marche « jambes pliees », pied qui flotte de 4 cm en milieu d'appui)
  const JAMBE_TENDUE = bipede && A.pas && !SAUT;                // marche, course (pas les bonds : jambes tendues a l'envol et a la reception = a-coups)
  const TENDU_MAX = JAMBE_TENDUE ? 0.992 : 0.98, PORTEE_MAX = JAMBE_TENDUE ? 0.99 : 0.97;
  const geo = pattes.map((p) => {
    const Lc = longueurChaine(p.ik.map((k) => P0[k]));
    const d = sub(sub(p.neutre, p.piedOff), P0[p.ik[0]]);
    return [Lc, Math.abs(d[0]), -d[1], Math.abs(d[2]), p.debout && p.ik.length >= 3];   // patte d'un seul os : ne plie pas
  });
  let abaisse = 0;
  for (const [Lc, dx, dy, dz, deb] of geo) { if (!deb) continue; const r2 = (A.tendu * Lc) ** 2 - dx * dx - dz * dz; if (r2 > 0) abaisse = Math.max(abaisse, dy - Math.sqrt(r2)); }
  // bipede : l'instant critique est la POSE / LEVEE du pied (debut / fin d'appui), ou le bassin vaut
  // bob = +/- A.bob * cos(2 pi beta) (marche : plus bas, course : un peu plus haut). L'ancien repere « 2 x bob » (le pire cas de
  // toute la foulee) etait 4 fois trop large et ecrasait la foulee de course a 0,2 hauteur de hanche (marche : 1,0).
  const margeBob = A.bob * hanche * (bipede && A.pas ? (genre === 'run' ? -1 : 1) * Math.cos(2 * Math.PI * beta) : genre === 'run' ? 2 : -1);
  // profil d'espece : le corps suit les appuis ; sa hauteur quand CE pied se pose ou se leve (et non le
  // pire cas, la suspension) borne la foulee. La marge du pire cas ecrasait le galop (Mule : foulee 0,1).
  let marges = null;
  if (A.motif && genre === 'run') {                      // marche : pas de suspension, marge d'origine
    const sNom = (x) => moyenne(pattes.map((q) => { const f = ((x + q.phase) % 1 + 1) % 1; return f < beta ? Math.sin(Math.PI * f / beta) : 0; }));
    let mNom = 0;
    for (let k = 0; k < 200; k++) mNom += sNom(k / 200) / 200;
    marges = pattes.map((p) => Math.max(...[-p.phase, beta - p.phase].map((x) => A.bob * hanche * 2 * (mNom - sNom(x)))));
  }
  if (SAUT) marges = pattes.map(() => 0);               // saut : corps a sa hauteur de repos au decollage
  let demis = null;
  if (A.pas) {
    // portee dans le sens de la marche : vers l'avant (dz), ou de cote pour le crabe (dx)
    demis = geo.map(([Lc, dx, dy, dz], i) => Math.max(Math.sqrt(Math.max((TENDU_MAX * Lc) ** 2 - (DECOTE ? dz * dz : dx * dx)
      - (dy - abaisse + (marges ? marges[i] : margeBob)) ** 2, 0)) - (DECOTE ? dx : dz), 0.03 * portee));
    S = Math.min(S, median(demis.map((d_) => 2 * d_ / beta)));
    pattes.forEach((p, i) => { p.beta = clip(2 * demis[i] / S, Math.min(0.25, beta), beta); });
    if (SAUT) { const bm = Math.min(...pattes.map((p) => p.beta)); pattes.forEach((p) => { p.beta = bm; }); }
  } else pattes.forEach((p) => { p.beta = beta; });
  // pivot du corps : le CENTRE des attaches de pattes (et non l'os racine, qui peut etre la tete :
  // un mille-pattes tournait autour de sa tete et balayait ses pattes arriere)
  const hautsPattes = pattes.map((p) => P0[p.chaine[0]]);
  const moy = hautsPattes.reduce((a, b) => add(a, b), [0, 0, 0]).map((x) => x / hautsPattes.length);
  const centre = [moy[0], P0[racine][1], moy[2]];
  let v = (B.recul ? -1 : 1) * S / T, w = A.lacet;          // marche arriere : le corps recule
  // VIRAGE : une patte loin du pivot balaie de côté (w × r) en plus de la foulée. Les pattes
  // arrière d'un mille-pattes sortaient de leur portée et claquaient (à-coup de 30°, 28/09) :
  // l'allure ralentit (même arc) jusqu'à ce que chaque patte tienne dans sa portée.
  if (demis && Math.abs(w) > 1e-9) {
    // pied posé au neutre à mi-appui (t = 0) ; où est-il, vu du corps, en début et fin d'appui ?
    const horsPortee = (vv, ww) => pattes.some((p) => {
      const Lik = longueurChaine(p.ik.map((k) => P0[k])), hanche_ = sub(P0[p.ik[0]], [0, abaisse, 0]);
      return [-1, 1].some((sg) => {
        const dt = sg * p.beta * T / 2, cap = ww * dt;
        const c = [(vv / ww) * (1 - Math.cos(cap)), 0, (vv / ww) * Math.sin(cap)];
        const q = add(centre, mv(tr(Ry(cap)), sub(sub(p.neutre, centre), c)));
        return norm(sub(sub(q, p.piedOff), hanche_)) > 0.95 * Lik;
      });
    });
    for (let n = 0; n < 30 && horsPortee(v, w); n++) { v *= 0.9; w *= 0.9; }
  }
  const nT = Math.round(cycles * T * fps), J = joints.length;
  const t = Array.from({ length: nT }, (_, i) => i / fps);

  const cheminCorps = (tt) => {
    const cap = w * tt;
    const c = Math.abs(w) < 1e-9 ? (DECOTE ? [v * tt, 0, 0] : [0, 0, v * tt]) : [(v / w) * (1 - Math.cos(cap)), 0, (v / w) * Math.sin(cap)];
    return { c, cap };
  };
  const Rcap = [], cc = [];
  for (const tt of t) { const r = cheminCorps(tt); cc.push(r.c); Rcap.push(Ry(r.cap)); }
  // --- balancement du corps
  const p0 = pattes[0].phase;
  const bob = [], tangage = [], roulis = [], lateral = [], lacetBassin = new Array(nT).fill(0), sG = new Array(nT).fill(0);
  for (let i = 0; i < nT; i++) {
    const x = t[i] / T, onde2 = Math.cos(4 * Math.PI * (x - (beta / 2 - p0)));
    if (!A.pas && bipede && !B.action) {
      // ATTENTE d'un bipede : le poids passe d'une jambe a l'autre (1 transfert par periode : bassin qui glisse de ~2 cm
      // et s'incline de ~2 deg du cote de la jambe libre, cf. Winter 1995 « Human balance and posture control » : oscillation
      // lente du centre de pression de 1-2 cm), la poitrine respire (2 cycles par periode, ~0,3 Hz au repos, 12-20 / min).
      const kv = Math.min(A.bob / 0.008, 1.6);
      bob.push(0.003 * hanche * kv * Math.sin(4 * Math.PI * x + 0.4));
      tangage.push(0.008 * Math.sin(4 * Math.PI * x + 0.9));
      roulis.push(0.034 * kv * Math.sin(2 * Math.PI * x));
      lateral.push(0.02 * hanche * kv * Math.sin(2 * Math.PI * x));
    } else if (!A.pas) {
      bob.push(A.bob * hanche * Math.sin(4 * Math.PI * x)); tangage.push(0.01 * Math.sin(2 * Math.PI * x));
      roulis.push(0.012 * Math.sin(2 * Math.PI * x + 1.0)); lateral.push(0.015 * hanche * Math.sin(2 * Math.PI * x + 1.0));
    } else {
      bob.push(A.bob * hanche * (genre !== 'run' ? onde2 : -onde2));
      // course bipede : buste penche vers l'avant (~8 degres ; 3 avant, user 29/09 « pas realiste »)
      tangage.push((bipede ? A.tronc ?? (genre === 'run' ? 0.14 : 0.0) : 0.0) + 0.02 * Math.sin(4 * Math.PI * x));
      roulis.push((bipede ? 0.035 : 0.012) * Math.sin(2 * Math.PI * (x + p0 - beta / 2)));
      lateral.push((bipede ? 0.04 * hanche : 0.0) * Math.sin(2 * Math.PI * (x + p0 - beta / 2)));
    }
  }
  // bipède : bassin qui tourne et bascule (calé sur la jambe gauche), épaules en contre-rotation
  if (bipede) {
    const gauche = pattes.find((q) => q.cote === 1) || pattes[0];
    const amp = genre === 'run' ? [0.12, 0.05] : [0.08, 0.06];
    if (Pr.roulis) amp[1] = Pr.roulis;                      // manchot qui se dandine, primate
    for (let i = 0; i < nT; i++) {
      const x = t[i] / T;
      sG[i] = Math.cos(2 * Math.PI * (x + gauche.phase));
      if (!A.pas && !B.action) lacetBassin[i] = 0.025 * Math.min(A.bob / 0.008, 1.6) * Math.sin(2 * Math.PI * x + 0.8);   // attente : le bassin pivote un peu avec le transfert
      if (A.pas && !SAUT) {                                 // saut : les deux jambes poussent ENSEMBLE, bassin droit
        lacetBassin[i] = -amp[0] * sG[i];
        roulis[i] = amp[1] * Math.cos(2 * Math.PI * (x + gauche.phase - beta / 2));
        lateral[i] = A.lateral * hanche * Math.cos(2 * Math.PI * (x + gauche.phase - beta / 2));
      }
    }
  }
  // hexapodes / araignees / crabes : le corps tourne un peu autour de la verticale a chaque demi-cycle, du cote du
  // trepied (ou tetrapode) en appui (« lacet » du corps ; Full & Tu 1991, Blaberus : le corps oscille a chaque pas).
  if (Pr.lacetCorps && A.pas && !SAUT) for (let i = 0; i < nT; i++) lacetBassin[i] += Pr.lacetCorps * Math.sin(2 * Math.PI * (t[i] / T + p0));
  // --- profil d'espece : le corps suit les APPUIS reels (poids de chaque pied au sol, 0 -> 1 -> 0).
  // Galop : le corps monte pendant les suspensions et bascule (avant porte = nez bas) ; le dos se
  // plie quand les pattes avant portent (felin) ; le lezard ondule de cote ; l'amble roule.
  const appuiDe = (p, x) => { const f = ((x + p.phase) % 1 + 1) % 1; return f < p.beta ? Math.sin(Math.PI * f / p.beta) : 0; };
  const avantP = pattes.filter((p) => p.rang === 0), arriereP = pattes.filter((p) => p.rang === p.nbCote - 1);
  const flex = new Array(nT).fill(0), ondu = new Array(nT).fill(0), nodP = new Array(nT).fill(0);
  if (A.motif || A.hoche != null) {
    const sA = [], sP = [], sT = [], sG_ = [], sD_ = [];
    for (let i = 0; i < nT; i++) {
      const x = t[i] / T;
      sT.push(moyenne(pattes.map((p) => appuiDe(p, x))));
      sA.push(quadrupede ? moyenne(avantP.map((p) => appuiDe(p, x))) : sT[i]);
      sP.push(quadrupede ? moyenne(arriereP.map((p) => appuiDe(p, x))) : sT[i]);
      sG_.push(moyenne(pattes.filter((p) => p.cote === 1).map((p) => appuiDe(p, x))));
      sD_.push(moyenne(pattes.filter((p) => p.cote !== 1).map((p) => appuiDe(p, x))));
    }
    const mT = moyenne(sT), lo = Math.min(...sA), hi = Math.max(...sA), mid = (lo + hi) / 2, dem = Math.max((hi - lo) / 2, 1e-6);
    for (let i = 0; i < nT; i++) {
      nodP[i] = (sA[i] - mid) / dem;                         // -1..1 : tete basse quand l'avant porte
      if (!A.motif) continue;
      if (genre === 'run') bob[i] = A.bob * hanche * 2 * (mT - sT[i]);   // moins de pieds au sol = corps plus haut
      tangage[i] = A.tangage * (sA[i] - sP[i]);
      flex[i] = A.flexion * (sA[i] - sP[i]);
      if (quadrupede) {
        const diag = (q) => q.rang === 0 ? (q.cote === 1 ? 1 : -1) : (q.cote === 1 ? -1 : 1);
        ondu[i] = A.ondulation * moyenne(pattes.map((q) => diag(q) * appuiDe(q, t[i] / T)));
      }
      if (A.roulis) roulis[i] = A.roulis * (sG_[i] - sD_[i]);
    }
  }
  if (pattes.every((p) => p.ik.length < 3)) for (let i = 0; i < nT; i++) bob[i] = 0;   // pieds rigides : pas de bob
  // --- saut : accroupi pendant l'appui, parabole en l'air (toutes les pattes ensemble)
  // Saut (action « jump », 25/10) : l'appui n'est plus une seule creche. Reception : absorption (genoux
  // ~100 ms apres le toucher : Devita et Skelly 1992, Med Sci Sports Exerc 24:108), remontee, puis
  // CONTRE-MOUVEMENT (creche plus profonde juste avant la poussee : Bobbert et al. 1996, Med Sci Sports
  // Exerc 28:1402), detente explosive, vol PARABOLIQUE (gravite) ; le tronc se penche dans la creche.
  // Les cles « virtuelles » hors de [0, 1] imposent la vitesse verticale d'envol et de reception : la
  // vitesse du corps est continue entre l'appui et le vol (pas d'a-coup au decollage).
  const COURBES_SAUT = {
    bob: [[-0.2, 0.154], [0, 0], [0.2, -0.11], [0.38, -0.05], [0.6, -0.18], [1, 0], [1.2, 0.154]],
    tangage: [[0, 0.03], [0.2, 0.06], [0.4, 0.0], [0.6, 0.09], [1, -0.03]],
    bras: [[0, 0.5], [0.15, 0.2], [0.4, -0.5], [1, 0.7]],               // bras : en arriere dans la creche, projetes vers l'avant et le haut a la poussee
    brasVol: [[0, 0.7], [0.5, 0.9], [1, 0.5]],
  };
  let brasSaut = null;
  if (SAUT && Pr.bond) {
    // grenouille (25/10) : accroupie, poussee (le corps se releve, le museau monte), vol (museau haut au decollage,
    // puis bas a la reception : Nauwelaerts & Aerts 2003 ; Zug 1972 ; l'angle du corps au decollage ~30-40 deg),
    // reception amortie. Le tangage est continu d'un saut a l'autre (fin de vol = debut d'appui).
    const { creux, pitch } = Pr.bond, lis = (x) => x * x * (3 - 2 * x);
    for (let i = 0; i < nT; i++) {
      const b0 = pattes[0].beta, f = ((t[i] / T + pattes[0].phase) % 1 + 1) % 1;
      if (f < b0) {
        const u = f / b0;
        bob[i] = -creux * hanche * Math.sin(Math.PI * Math.min(1, u * 1.15));
        tangage[i] = 0.55 * pitch + (-pitch - 0.55 * pitch) * lis(u);
      } else {
        const v = (f - b0) / (1 - b0);
        bob[i] = 0.3 * hanche * (V.h || 1) * (Pr.h || 1) * Math.sin(Math.PI * v);
        tangage[i] = -pitch + 1.55 * pitch * lis(v);
      }
    }
  } else if (SAUT) {
    const jumpAction = !!ALLURES[allure].saut && droit;   // quadrupedes : calcul d'origine (le contre-mouvement y faisait monter les a-coups des jambes)
    if (jumpAction) brasSaut = new Array(nT).fill(0);
    for (let i = 0; i < nT; i++) {
      const b0 = pattes[0].beta, f = ((t[i] / T + moyenne(pattes.map((q) => q.phase))) % 1 + 1) % 1;
      if (jumpAction) {
        const g = f / b0, x = (f - b0) / (1 - b0);
        bob[i] = f < b0 ? cles(g, COURBES_SAUT.bob) * hanche : (Pr.sautH ?? 0.3) * hanche * (V.h || 1) * Math.sin(Math.PI * x);
        tangage[i] = (f < b0 ? cles(g, COURBES_SAUT.tangage) : -0.05 * Math.cos(Math.PI * x));
        brasSaut[i] = f < b0 ? cles(g, COURBES_SAUT.bras) : cles(x, COURBES_SAUT.brasVol);
        continue;
      }
      bob[i] = f < b0 ? -0.12 * hanche * Math.sin(Math.PI * f / b0) : (Pr.sautH ?? 0.3) * hanche * (V.h || 1) * Math.sin(Math.PI * (f - b0) / (1 - b0));
      tangage[i] = f < b0 ? -0.06 * Math.sin(Math.PI * f / b0) : 0.04 * Math.sin(2 * Math.PI * (f - b0) / (1 - b0));
    }
  }
  // --- actions (pieds plantes) : corps, tete et bras suivent les courbes ; V.ampleur les amplifie
  const avance = new Array(nT).fill(0), teteT = new Array(nT).fill(0), brasT = new Array(nT).fill(0);
  const torseL = new Array(nT).fill(0), torseP = new Array(nT).fill(0);       // torse (bipedes) : lacet et penche, en plus du bassin
  const C = B.action ? (droit && COURBES_ACTIONS[B.action + '_bipede']) || COURBES_ACTIONS[B.action] : null;
  if (C) {
    const k = (V.ampleur || 1) * ampleurMax;
    for (let i = 0; i < nT; i++) {
      const u = t[i] / T;
      if (C.bob) bob[i] = cles(u, C.bob) * hanche * k + 0.3 * bob[i];
      if (C.avance) avance[i] = cles(u, C.avance) * hanche * k;
      if (C.tangage) tangage[i] = cles(u, C.tangage) * k;
      if (C.roulis) roulis[i] = cles(u, C.roulis) * k;
      if (C.tete) teteT[i] = cles(u, C.tete) * k;
      if (C.bras) brasT[i] = cles(u, C.bras) * k;
      if (C.torse && bipede) torseL[i] = cles(u, C.torse) * k;
      if (C.torseT && bipede) torseP[i] = cles(u, C.torseT) * k;
      if (C.lacet && bipede) lacetBassin[i] = cles(u, C.lacet) * k;
      // mastication : fenetres [debut, fin, cycles par cycle d'action, amplitude rad], enveloppe en sinus (pas de saut)
      if (C.machoire) for (const [u0, u1, fq, am] of (Array.isArray(C.machoire[0]) ? C.machoire : [C.machoire])) {
        if (u > u0 && u < u1) teteT[i] += am * Math.sin(Math.PI * (u - u0) / (u1 - u0)) ** 0.5 * Math.sin(2 * Math.PI * fq * (u - u0));
      }
      lateral[i] *= 0.3;
      if (C.lateral && bipede) lateral[i] = cles(u, C.lateral) * hanche * k;
    }
  }
  // --- colonne souple : les os entre la ceinture ARRIERE et la ceinture AVANT se plient ensemble.
  // Cote avant : +angle/n (le devant plonge = dos voute) ; cote arriere : -angle/n (l'arriere aussi).
  // Le bassin compense la moitie du desequilibre pour que la voute reste symetrique.
  let colonne = null;
  if (quadrupede && (A.flexion || A.ondulation)) {
    const ancetres = (j) => { const c = []; for (; j >= 0; j = par[j]) c.push(j); return c; };
    const commun = (a, b) => { const sa = new Set(ancetres(a)); return ancetres(b).find((k) => sa.has(k)) ?? -1; };
    const ceinture = (l) => commun(par[l[0].chaine[0]], par[l[1].chaine[0]]);
    const cA = ceinture(avantP), cP = ceinture(arriereP);
    if (cA >= 0 && cP >= 0 && cA !== cP) {
      const L = commun(cA, cP);
      const cote = (c) => { const a = ancetres(c); return a.slice(0, a.indexOf(L)).reverse(); };   // de L (exclu) vers c
      const avantC = cote(cA), arriereC = cote(cP), n = avantC.length + arriereC.length;
      const libre = (j) => !pattes.some((p) => p.chaine.includes(j));
      if (n && L >= 0 && [...avantC, ...arriereC].every(libre)) {
        colonne = { L, avantC, arriereC, n };
        for (let i = 0; i < nT; i++) {
          tangage[i] -= flex[i] * (avantC.length - arriereC.length) / (2 * n);
          lacetBassin[i] -= ondu[i] * (avantC.length - arriereC.length) / (2 * n);
        }
      }
    }
  }
  const Rb = [], decal = [];
  for (let i = 0; i < nT; i++) {
    Rb.push(mm(mm(mm(Rcap[i], Ry(lacetBassin[i])), Rx(tangage[i])), Rz(roulis[i])));
    decal.push(add(add(cc[i], [0, bob[i] - abaisse, 0]), mv(Rcap[i], [lateral[i], 0, avance[i]])));
  }
  const monde = (i, p) => add(add(centre, decal[i]), mv(Rb[i], sub(p, centre)));
  // colonne pliee : rotation locale de chaque os, puis position/rotation MONDE de chacun (pour que
  // les pattes partent de leurs vraies hanches, sinon les pieds glissent)
  const colM = new Map(), colPos = [], colRot = [];
  if (colonne) {
    const { L, avantC, arriereC, n } = colonne;
    const locale = (i, sg) => mm(Rx(sg * flex[i] / n), Ry(sg * ondu[i] / n));
    for (const j of avantC) colM.set(j, t.map((_, i) => locale(i, 1)));
    for (const j of arriereC) colM.set(j, t.map((_, i) => locale(i, -1)));
    for (let i = 0; i < nT; i++) {
      const pos = new Map([[L, monde(i, P0[L])]]), rot = new Map([[L, Rb[i]]]);
      for (const c of [avantC, arriereC]) {
        let prec = L;
        for (const j of c) {
          pos.set(j, add(pos.get(prec), mv(rot.get(prec), sub(P0[j], P0[prec]))));
          rot.set(j, mm(rot.get(prec), colM.get(j)[i]));
          prec = j;
        }
      }
      colPos.push(pos); colRot.push(rot);
    }
  }
  const porteur = (j) => { if (!colonne) return -1; for (let k = par[j]; k >= 0; k = par[k]) if (colPos[0].has(k)) return k; return -1; };
  const appui = (p, k) => {                                   // pied neutre sous le corps au MILIEU de l'appui
    const tm = (k - p.phase) * T + p.beta * T / 2;
    const { c, cap } = cheminCorps(tm);
    const X = add(add(centre, c), mv(Ry(cap), sub(p.neutre, centre)));
    X[1] = p.neutre[1];
    return X;
  };

  // D[i][j] : rotation monde (delta sur le repos) de l'os j à l'image i
  const D = Array.from({ length: nT }, () => new Array(J));
  const fixes = new Map();
  for (const p of pattes) {
    const ch = p.ik;
    const Fpied = new Array(nT), Dch = ch.slice(0, -1).map(() => new Array(nT));
    const porte = porteur(ch[0]);                           // os de la colonne qui porte cette patte
    const Lik = longueurChaine(ch.map((k) => P0[k]));
    let u = 0;
    for (let i = 0; i < nT; i++) {
      let cible, phi = 0, b_ = p.beta;
      if (!A.pas) cible = p.neutre.slice();
      else {
        const x = t[i] / T + p.phase, k = Math.floor(x);
        phi = x - k;
        if (phi < b_) cible = appui(p, k);
        else {
          u = (phi - b_) / (1 - b_);
          const X0 = appui(p, k), X1 = appui(p, k + 1), e = (1 - Math.cos(Math.PI * u)) / 2;
          cible = add(X0, mulS(sub(X1, X0), e));
          // profil de hauteur du pied. Marche humaine (levee) : la semelle monte vite en debut de balancier (pic ~30 % : le genou plie
          // a 60 deg, Perry 1992) puis redescend a ~1,5 cm au passage sous le corps (garde au sol minimale de mi-balancier : 1,3 a 1,6 cm,
          // Winter 1991 ; Barrett, Mills & Begg 2010) avant l'attaque du talon. Le sin2 d'origine (pic a 50 %) levait le pied de 21 cm
          // EN MILIEU de balancier : marche « genoux hauts ».
          cible[1] += A.levee ? h / 1.06 * (Math.sin(Math.PI * Math.min(u / 0.62, 1)) ** 2 + 0.06 * Math.sin(Math.PI * u) ** 2) : h * Math.sin(Math.PI * (A.leve ? Math.pow(u, A.leve) : u)) ** 2;   // leve < 1 : le pied monte tot (quadrupedes, galop)
        }
      }
      let theta = 0;                                          // déroulé : talon qui se lève en fin d'appui
      if (A.pas && p.pivotOff) {
        const s_ = phi < b_ ? clip((phi / b_ - 0.55) / 0.45, 0, 1) : 1 - clip(u / 0.45, 0, 1);
        theta = A.talon * s_ * s_ * (3 - 2 * s_);
        // ATTAQUE DU TALON (bipede) : en fin de balancier la pointe du pied est relevee (dorsiflexion), le talon touche
        // le sol en premier puis le pied se pose a plat pendant la reponse a la charge (~15 % de l'appui). Le pied pivote
        // alors autour du TALON, qui ne bouge pas.
        if (bipede && A.attaque) {
          const m_ = phi < b_ ? 1 - clip(phi / (b_ * 0.16), 0, 1) : clip((u - 0.5) / 0.5, 0, 1);
          theta -= A.attaque * m_ * m_ * (3 - 2 * m_);
        }
      }
      const F = mm(Rcap[i], Rx(theta));
      Fpied[i] = F;
      if (p.pivotOff && theta > 0) {
        const orteil = add(cible, mv(Rcap[i], p.pivotOff));
        cible = sub(orteil, mv(F, p.pivotOff));
      } else if (p.pivotOff && theta < 0) {
        const talon_ = add(cible, mv(Rcap[i], p.talonOff));
        cible = sub(talon_, mv(F, p.talonOff));
      }
      const hanche_i = porte >= 0
        ? add(colPos[i].get(porte), mv(colRot[i].get(porte), sub(P0[ch[0]], P0[porte])))
        : monde(i, P0[ch[0]]);
      let cib = sub(cible, mv(F, p.piedOff));                // cible de la cheville
      const dd = sub(cib, hanche_i);
      if (norm(dd) > PORTEE_MAX * Lik) cib = add(hanche_i, mulS(dd, PORTEE_MAX * Lik / norm(dd)));   // portée bornée
      const Q = resoudreForme(p.forme, hanche_i, cib, mv(porte >= 0 ? colRot[i].get(porte) : Rb[i], p.poleIK));
      for (let a = 0; a < ch.length - 1; a++) {
        const repos = mv(Rb[i], sub(P0[ch[a + 1]], P0[ch[a]]));
        Dch[a][i] = mm(aligner(repos, sub(Q[a + 1], Q[a])), Rb[i]);
      }
    }
    ch.slice(0, -1).forEach((k, a) => fixes.set(k, Dch[a]));
    fixes.set(ch[ch.length - 1], Fpied);                    // pied rigide (cap + déroulé)
    fixes.set(p.bout, Fpied);
  }
  // --- queue, pédipalpes, colonne, bras, tête : rotations locales « balance »
  const balance = new Map(colM);
  const ampQ = (genre === 'run' ? 0.16 : genre === 'idle' ? 0.08 : 0.10) * A.queue;
  for (const cq of queues) {
    cq.slice(0, -1).forEach((j, a) => {
      // lezard : la queue prolonge l'onde stationnaire du tronc (signe oppose a la ceinture pelvienne, retard
      // croissant vers le bout), au lieu d'un balancement sans rapport avec les pas
      if (A.abdomen) {                                      // abdomen d'insecte / d'araignee : il suit le corps avec retard
        const n_ = Math.max(cq.length - 1, 1);
        balance.set(j, t.map((tt, i) => mm(Rx(A.abdomen * Math.sin(4 * Math.PI * tt / T + 0.6 - 0.4 * a) / n_), Ry(-0.5 * lacetBassin[i] / n_))));
        return;
      }
      if (A.queueOnde && colonne) {
        const dec = Math.round(0.05 * T * 30 * (a + 1));
        balance.set(j, t.map((_, i) => Ry(A.queueOnde * ondu[((i - dec) % nT + nT) % nT] / Math.max(cq.length - 1, 1))));
        return;
      }
      // bipede qui marche (dinosaure, kangourou) : la queue sert de CONTREPOIDS, elle se balance a l'inverse du bassin (le bassin
      // tourne de +q, la queue de -k q en local : en repere monde elle part du cote oppose, comme la queue d'un theropode
      // marchant, Hutchinson 2011 ; Gatesy 1990)
      if (bipede && A.pas && !SAUT) balance.set(j, t.map((_, i) => Ry(-1.8 * A.queue * lacetBassin[i] * (a + 1) / cq.length)));
      else balance.set(j, t.map((tt) => Ry(ampQ * (a + 1) / cq.length * Math.sin(2 * Math.PI * tt / T * (A.pas ? 1 : 2) - 0.7 * a))));
    });
  }
  palpes.forEach((cp, q) => {
    const c = cp.chaine, vit = A.pas ? 1 : 0.5;
    // le premier os part du centre du corps (dans le corps) : on anime les suivants
    const o = c.length >= 4 ? 1 : 0;
    balance.set(c[o], t.map((tt) => Rx(-0.07 * (0.5 + 0.5 * Math.sin(2 * Math.PI * vit * tt / T + 1.7 * q)))));
    if (c.length > o + 2) balance.set(c[o + 1], t.map((tt) => Rx(-0.05 * Math.sin(2 * Math.PI * vit * tt / T + 1.7 * q + 0.8))));
  });
  let nbBras = 0;
  if (bipede) {
    const xMid = median(P0.map((p) => p[0])), ext = etendue(P0);
    const pris = new Set([...pattes.flatMap((q) => sousArbre(E, q.chaine[0])), ...tetes.flat()]);
    // MAIN a plusieurs doigts : os lateral dont tous les enfants partent du meme cote. On la traverse
    // pour remonter jusqu'a l'epaule. Sans ca (guerrier du 28/09), chaque DOIGT etait pris pour un
    // bras (10 « bras ») et les vrais bras restaient figes en T.
    const cote_ = (j) => Math.sign(P0[j][0] - xMid);
    const estMain = (j) => E[j].length >= 2 && !pris.has(j) && Math.abs(P0[j][0] - xMid) >= 0.15 * ext
      && E[j].every((e) => cote_(e) === cote_(j));
    const parEpaule = new Map();
    for (let f = 0; f < J; f++) {
      if (E[f].length || pris.has(f) || Math.abs(P0[f][0] - xMid) < 0.1 * ext) continue;
      const c = [f];
      let k = f, main = false;
      for (;;) {
        while (par[k] >= 0 && E[par[k]].length === 1) { k = par[k]; c.push(k); }
        if (par[k] >= 0 && estMain(par[k])) { k = par[k]; c.push(k); main = true; continue; }
        break;
      }
      c.reverse();
      if (c.length < 3 || par[c[0]] < 0) continue;
      let ep = -1;                                            // épaule = premier os qui descend
      for (let a = 0; a < c.length - 1; a++) {
        const b = sub(P0[c[a + 1]], P0[c[a]]);
        if (b[1] < -0.5 * norm(b)) { ep = a; break; }
      }
      // bras en T : aucun os ne descend ; la clavicule (1er os, plus court que le suivant) ne pivote pas
      if (ep < 0) ep = c.length >= 4 && norm(sub(P0[c[1]], P0[c[0]])) < 0.7 * norm(sub(P0[c[2]], P0[c[1]])) ? 1 : 0;
      const portee = Math.abs(P0[f][0] - xMid), deja = parEpaule.get(c[0]);
      if (deja && deja.portee >= portee) continue;           // un bras par epaule : le doigt le plus long
      parEpaule.set(c[0], { epaule: c[ep], coude: c[Math.min(ep + 1, c.length - 2)], cote: P0[f][0] > xMid ? 1 : -1, moyeu: par[c[0]], main, portee });
    }
    const bras = [...parEpaule.values()];
    nbBras = bras.length;
    const colonne = [];
    if (bras.length) { for (let k = bras[0].moyeu; k >= 0 && k !== racine; k = par[k]) colonne.push(k); colonne.reverse(); }
    const nC = Math.max(colonne.length, 1);
    // respiration de l'attente : la cage thoracique se releve / s'abaisse (~1 deg, 2 cycles par periode)
    const respire = (i) => (!A.pas && !B.action ? 0.02 * Math.min(A.bob / 0.008, 1.6) * Math.sin(4 * Math.PI * t[i] / T) : 0);
    for (const j of colonne) balance.set(j, t.map((_, i) => mm(mm(Ry((C ? torseL[i] : -1.6 * lacetBassin[i]) / nC), Rz(-roulis[i] / nC)), Rx(((C ? torseP[i] : 0) + respire(i)) / nC))));
    // coude : marche 12 -> 35 deg selon la position du bras (plus plie bras en avant, Murray 1967 ; Pontzer 2009), course ~85 -> 105 deg
    // (Hinrichs 1987), attente : mains detendues, coude ~14 deg
    const [ampB0, flex] = genre === 'run' ? [0.5, 1.45] : genre === 'idle' ? [0.05, 0.25] : [0.3, 0.22];
    const ampB = ampB0 * A.bras;
    for (const b of bras) {
      const d_ = sub(P0[b.coude], P0[b.epaule]);
      let axe = cross(mulS(d_, 1 / (norm(d_) + 1e-12)), [0, 0, 1]);
      if (norm(axe) < 1e-6) continue;
      axe = mulS(axe, 1 / norm(axe));
      const enT = Math.abs(d_[1]) < 0.5 * norm(d_);
      // Bras en T d'un humain, d'un primate ou d'un bipede a mains : ABAISSES de ~70° a l'epaule, puis
      // balances d'avant en arriere (marcher bras tendus a l'horizontale « faisait casse », 28/09).
      // Une aile (oiseau) reste etendue.
      const baisse = enT && (famille === 'humain' || famille === 'primate' || (famille === 'generique' && b.main)) ? 1.2 : 0;
      const Rbaisse = baisse ? rotvec([0, 0, 1], -b.cote * baisse) : null;
      const ampL = enT && !baisse ? 0.35 * ampB : ampB;   // bras en T / aile : balancement reduit
      const avant = t.map((tt, i) => (C && C.bras ? brasT[i] * (b.cote === -1 ? 1 : 0.25)   // action : bras droit qui frappe
        : brasSaut ? brasSaut[i] * A.bras * (enT && !baisse ? 0.35 : 1)   // saut (action) : elan des bras en trois temps
        : SAUT && B.saut && !Pr.saut ? cles(((tt / T + pattes[0].phase) % 1 + 1) % 1, BRAS_SAUT) * A.bras   // saut : balancier des bras (voir BRAS_SAUT)
        : SAUT ? -ampL * Math.cos(2 * Math.PI * tt / T)           // saut : les deux bras ensemble (elan)
        : A.pas ? -b.cote * ampL * sG[i] : ampL * Math.sin(2 * Math.PI * tt / T + (b.cote === 1 ? 0 : 1.3))));
      // bras abaisse : balancement d'avant en arriere (autour de l'axe lateral) APRES l'abaissement. Fait
      // avant, en course le balancier + le coude remontaient la main a hauteur d'epaule (« bras de zombie »).
      balance.set(b.epaule, avant.map((a) => (Rbaisse ? mm(rotvec([1, 0, 0], -a), Rbaisse) : rotvec(axe, a))));
      balance.set(b.coude, avant.map((a) => rotvec(axe, flex + (genre !== 'run' ? 0.38 : 0.3) * clip(a / Math.max(ampB, 1e-6), 0, 1))));
    }
  }
  // antennes (insecte) et pinces (crabe) : chaines terminales a l'avant, hors pattes. Les antennes balayent en
  // lacet et en tangage, une de chaque cote en opposition (fourmi : antennation, Hangartner 1967) ; un nombre
  // ENTIER de balayages par cycle garde la boucle fermee. Les pinces oscillent doucement avec le pas.
  if (Pr.antennes || Pr.pinces) {
    const ext_ = etendue(P0), xM = median(P0.map((q) => q[0]));
    const pris_ = new Set([...pattes, ...palpes].flatMap((q) => sousArbre(E, q.chaine[0])));
    queues.forEach((c) => c.forEach((k) => pris_.add(k)));
    const nC = Math.max(1, Math.round(T / 0.5));
    for (let f = 0; f < J; f++) {
      if (E[f].length || pris_.has(f) || P0[f][2] <= P0[racine][2] + 0.05 * ext_) continue;
      const pince = Math.abs(P0[f][0] - xM) >= 0.1 * ext_;
      if (pince ? !Pr.pinces : !Pr.antennes) continue;
      const c = [f];
      for (let k = f; par[k] >= 0 && E[par[k]].length === 1 && !pris_.has(par[k]);) { k = par[k]; c.push(k); }
      c.reverse();
      if (c.length < 2 || par[c[0]] < 0 || balance.has(c[0]) || fixes.has(c[0])) continue;
      const cote = P0[f][0] >= xM ? 1 : -1, n_ = c.length - 1;
      c.slice(0, -1).forEach((j, a) => {
        balance.set(j, t.map((tt) => {
          const ph = 2 * Math.PI * nC * tt / T + (cote === 1 ? 0 : Math.PI) + 0.5 * a;
          return pince ? mm(Ry(cote * 0.12 * Math.sin(2 * Math.PI * tt / T) / n_), Rx(0.08 * Math.sin(2 * Math.PI * tt / T + 1) / n_))
            : mm(Ry(0.55 * Math.sin(ph) / n_), Rx(0.25 * Math.sin(ph + 1.3) / n_));
        }));
      });
    }
  }
  let nbAiles = 0;
  // araignee, crabe : pas d'ailes — des chaines laterales y battaient (vitrine, 2026-09-29)
  if (!bipede && famille !== 'araignee' && famille !== 'crabe') {
    // ailes et autres appendices lateraux (dragon, oiseau a 4 pattes…) : leger battement symetrique
    const xMid = median(P0.map((p) => p[0])), ext = etendue(P0);
    const pris = new Set([...pattes, ...palpes].flatMap((q) => sousArbre(E, q.chaine[0])));
    [...tetes, ...queues].forEach((c) => c.forEach((k) => pris.add(k)));
    for (let f = 0; f < J; f++) {
      if (E[f].length || pris.has(f) || Math.abs(P0[f][0] - xMid) < 0.12 * ext) continue;
      const c = [f];
      let k = f;
      while (par[k] >= 0 && E[par[k]].length === 1 && !pris.has(par[k])) { k = par[k]; c.push(k); }
      c.reverse();
      if (c.length < 2 || par[c[0]] < 0 || balance.has(c[0]) || fixes.has(c[0])) continue;
      const cote = P0[f][0] > xMid ? 1 : -1, amp = genre === 'run' ? 0.12 : genre === 'idle' ? 0.04 : 0.07;
      balance.set(c[0], t.map((tt) => Rz(cote * amp * Math.sin(2 * Math.PI * tt / T))));
      nbAiles++;
    }
  }
  // OISEAU : la tete ne suit pas le corps, elle « tient » (immobile dans le MONDE ~65 % du pas, le corps avance sous elle) puis
  // part d'un coup vers l'avant (~35 %) : hochement de tete des marcheurs (poule, pigeon, autruche ; Frost 1978 « The optokinetic
  // basis of head-bobbing », Dagg 1977 : phase de tenue 60-70 % du pas, la poussee coincide avec le debut du balancier d'une patte).
  // Dans le repere du corps : un dent de scie (recul regulier, avance vive). Le cou plie en S : le premier os part vers l'avant,
  // le dernier le compense, la tete garde son assiette.
  const tetePique = famille === 'oiseau' && bipede && A.pas && !SAUT;
  const dentScie = t.map((_, i) => {
    const y = (((2 * (t[i] / T + p0) - 0.2) % 1) + 1) % 1;
    return y < 0.35 ? -1 + 2 * (y / 0.35) ** 2 * (3 - 2 * y / 0.35) : 1 - 2 * (y - 0.35) / 0.65;
  });
  for (const ct of tetesA) {
    const nb = ct.length - 1;
    const bobTete = tetePique && nb >= 2;
    const dir = P0[ct[nb]][1] - P0[ct[0]][1] >= 0 ? 1 : -1;      // os qui montent : +rotation = vers l'avant ; qui descendent : l'inverse
    const phiTete = bobTete ? clip(0.5 * (S / 2) / Math.max(norm(sub(P0[ct[nb]], P0[ct[0]])), 1e-6), 0.05, 0.35) : 0;
    ct.slice(0, -1).forEach((j, a) => {
      balance.set(j, t.map((tt, i) => {
        const hoche = bobTete ? dir * phiTete * dentScie[i] * (a === 0 ? 1 : a === nb - 1 ? -1 : 0)
          : A.hoche != null && A.pas
          ? A.hoche * nodP[i] / Math.max(ct.length - 1, 1)     // profil : tete basse quand l'avant porte
          : (A.pas ? 0.03 : 0.04) * Math.sin(4 * Math.PI * tt / T + 0.5 + 0.3 * a);
        let m = Rx(hoche + teteT[i] / Math.max(ct.length - 1, 1) - (a === 0 ? tangage[i] + (C ? 0.7 * torseP[i] : 0) - A.tete : 0));
        if (!A.pas && a === 0) m = mm(Ry(0.22 * A.regard * Math.sin(2 * Math.PI * tt / T)), m);
        // tete stabilisee : elle contre-tourne contre la ceinture scapulaire (qui tourne de ondu / 2)
        if (A.teteContre && colonne && a === 0) m = mm(Ry(-A.teteContre * ondu[i] / 2), m);
        if (bipede && a === 0) m = mm(Ry(C && (C.lacet || C.torse) ? -0.7 * (lacetBassin[i] + torseL[i]) : 0.6 * lacetBassin[i]), m);   // action : le regard reste sur la cible
        return m;
      }));
    });
  }
  // --- assemblage, parents d'abord : un os non piloté suit son parent
  const ordre = [], file = [racine, ...sq.racines.filter((r) => r !== racine)];
  while (file.length) { const j = file.shift(); ordre.push(j); file.push(...E[j]); }
  for (let i = 0; i < nT; i++) {
    for (const j of ordre) {
      if (par[j] < 0) D[i][j] = Rb[i];
      else if (fixes.has(j)) D[i][j] = fixes.get(j)[i];
      else if (balance.has(j)) D[i][j] = mm(D[i][par[j]], balance.get(j)[i]);
      else D[i][j] = D[i][par[j]];
    }
  }
  // rotations locales (repos aligné sur le monde) : R_j = D_parent^T · D_j
  const R = D.map((Di) => Di.map((Dj, j) => (par[j] < 0 ? Dj : mm(tr(Di[par[j]]), Dj))));
  const racineMonde = t.map((_, i) => monde(i, P0[racine]));
  const racinesSec = sq.racines.filter((r) => r !== racine).map((r) => ({ j: r, pos: t.map((_, i) => monde(i, P0[r])) }));
  // --- contrôles : positions reconstruites, os sous le sol, glissement des pieds en appui
  let sousSol = 0, glisse = 0, acoups = 0, pireAcoup = [-1, -1];
  const Pw = D.map(() => new Array(J));
  for (let i = 0; i < nT; i++) for (const j of ordre) {
    Pw[i][j] = j === racine ? racineMonde[i] : par[j] < 0 ? racinesSec.find((x) => x.j === j).pos[i]
      : add(Pw[i][par[j]], mv(D[i][par[j]], sub(P0[j], P0[par[j]])));
  }
  let pireOs = -1;
  for (let i = 0; i < nT; i++) for (let j = 0; j < J; j++) if (sol - Pw[i][j][1] > sousSol) { sousSol = sol - Pw[i][j][1]; pireOs = j; }
  for (const p of pattes) {
    if (!A.pas) continue;
    let s = 0, n = 0;
    for (let i = 1; i < nT; i++) {
      const a = ((t[i - 1] / T + p.phase) % 1 + 1) % 1, b = ((t[i] / T + p.phase) % 1 + 1) % 1;
      if (b < p.beta && a < b) { s += norm(sub(Pw[i][p.bout], Pw[i - 1][p.bout])); n++; }
    }
    if (n) glisse = Math.max(glisse, s / n);
    for (const j of p.chaine.slice(0, -1)) {
      let prec = null;
      for (let i = 1; i < nT; i++) {
        const w_ = angleRot(mm(tr(D[i - 1][j]), D[i][j]));
        if (prec !== null && Math.abs(w_ - prec) > acoups) { acoups = Math.abs(w_ - prec); pireAcoup = [j, i]; }
        prec = w_;
      }
    }
  }
  const infos = {
    mode: 'pattes', ailes: nbAiles, espece: Object.keys(Pr).length ? famille : 'generique', motif: A.motif || null,
    colonne: colonne ? colonne.n : 0,
    pattes: pattes.length, pedipalpes: palpes.length, queues: queues.length, tetes: tetesA.length, bras: nbBras,
    periode: T, foulee: +S.toFixed(3), images: nT,
    sous_sol_pct: +(100 * sousSol / H).toFixed(1), pire_os: pireOs, glissement_appui_pct: +(100 * glisse / H).toFixed(2), acoups_max_deg: +(acoups * 180 / Math.PI).toFixed(1),
    acoup_os: pireAcoup[0], acoup_image: pireAcoup[1],
  };
  return { nom: variante === 'normal' ? allure : `${allure}__${variante}`, R, racineMonde, racinesSec, infos };
}

/** Encolure d'un quadrupede dont la tete se RAMIFIE (oreilles, machoire : aucune chaine « tete ») :
 *  chemin de la ceinture avant vers la feuille la plus en avant, hors pattes et queues ; null sinon. */
function encolure(par, P0, pattes, queues) {
  if (pattes.length !== 4) return null;
  const anc = (j) => { const c = []; for (; j >= 0; j = par[j]) c.push(j); return c; };
  const av = [...pattes].sort((a, b) => P0[b.chaine[0]][2] - P0[a.chaine[0]][2]).slice(0, 2).map((p) => par[p.chaine[0]]);
  if (av.some((k) => k < 0)) return null;
  const sa = new Set(anc(av[0]));
  const hubA = anc(av[1]).find((k) => sa.has(k)) ?? -1;
  if (hubA < 0) return null;
  const exclus = new Set([...pattes.flatMap((p) => p.chaine), ...queues.flat()]);
  const En = enfantsDe(par);
  let bout = -1;
  for (let j = 0; j < par.length; j++) {
    if (En[j].length || exclus.has(j) || j === hubA || !anc(j).includes(hubA)) continue;
    if (bout < 0 || P0[j][2] > P0[bout][2]) bout = j;
  }
  if (bout < 0) return null;
  const a_ = anc(bout), cou = a_.slice(0, a_.indexOf(hubA)).reverse();   // de l'enfant de la ceinture au bout
  return cou.length >= 3 && cou.every((k) => !exclus.has(k)) ? cou : null;
}

// ------------------------------------------------------------------ mort : chute RIGIDE sur le flanc
// Le corps bascule d'un bloc autour de la ligne des pieds du cote de la chute (flanc droit par
// defaut, « left » : gauche) jusqu'a ce que son flanc touche le sol : affaissement, chute qui
// accelere, petit rebond, immobile. Marche pour tout squelette (quadrupede, bipede, insecte).
// MORT (25/10, retour du proprietaire : « rotation rigide ») : la chute n'est plus un solide qui bascule.
//  - 0 -> 0.2 : sursaut (la tete part en arriere) ;
//  - 0.07 -> 0.5 : les jambes CEDENT (genou plie, hanche et cheville en sens inverse : le pied reste
//    sous la hanche, le corps s'abaisse parce que le sol le retient), l'avant avant l'arriere ;
//  - 0.12 -> 0.6 : bascule sur le flanc en chute LIBRE (angle en t^2, comme un corps qui tombe) ;
//  - 0.6 : impact, rebond amorti (~7 % de l'angle, hop de 2,5 % de la hauteur, 2 rebonds), puis les
//    jambes du haut se relachent encore ;
//  - 0.97 -> 1 : immobilite totale.
// Les membres libres (queue, bras, oreilles) SUIVENT AVEC RETARD : chaque os retarde son orientation
// de TAU = 0.07 du cycle sur celle du corps (inertie) et oscille apres l'impact. Le sol est tenu par
// la cinematique directe de TOUT le squelette (le plus bas des os touche le sol), pas par la seule
// rotation rigide.
// Refs : Winter, Biomechanics and Motor Control of Human Movement (2009), chute libre d'un segment
// (theta ~ t^2) ; Alexander, Principles of Animal Locomotion (2003), jambes en « colonnes » qui
// flechissent sous la charge ; rebond amorti : coefficient de restitution d'un corps mou ~0.1
// (Hunt et Crossley, 1975).
function animerChute(sq, det, fps, variante) {
  const { par, P0 } = sq, J = par.length, racine = det.racine, sol = det.sol, H = ptpAxe(P0, 1);
  const V = (VARIANTES.death || {})[variante] || {};
  const T = ALLURES.death.T[0] * (V.T || 1), nT = Math.max(2, Math.round(T * fps) + 1);
  const t = Array.from({ length: nT }, (_, i) => i / fps);
  const cote = V.cote || -1;
  const xs = P0.map((p) => p[0]);
  const pieds = det.pattes.filter((p) => p.cote === cote).map((p) => P0[p.bout][0]);
  const xp = pieds.length ? moyenne(pieds) : (cote < 0 ? Math.min(...xs) : Math.max(...xs));
  const pivot = [xp, sol, 0], signe = cote < 0 ? 1 : -1;     // Rz(+) couche le haut vers -X
  const tourne = (th, p) => add(pivot, mv(Rz(signe * th), sub(p, pivot)));
  const E = enfantsDe(par);
  const dessous = new Set(det.pattes.filter((p) => p.cote === cote).flatMap((p) => sousArbre(E, p.chaine[0])));
  let thF = Math.PI / 2;                                     // arrivee : le flanc touche le sol
  for (let th = 0.05; th <= Math.PI / 2; th += 0.01) {
    let bas = Infinity;
    // os deja au sol au depart (pieds de l'autre cote, bout de queue) : ils se levent, ils ne comptent pas
    for (let j = 0; j < J; j++) if (!dessous.has(j) && P0[j][1] - sol > 0.05 * H) bas = Math.min(bas, tourne(th, P0[j])[1]);
    if (bas <= sol + 0.02 * H) { thF = th; break; }
  }
  const sm01 = (x) => { const c = clip(x, 0, 1); return c * c * (3 - 2 * c); };
  const U_IMPACT = 0.6;
  // angle du corps (chute libre en t^2, puis rebond amorti) ; angleBrut = sans rebond (retard des membres)
  const angleBrut = (u) => (u < 0.12 ? 0.0 : u < U_IMPACT ? thF * ((u - 0.12) / (U_IMPACT - 0.12)) ** 2 : thF);
  const rebond = (u) => { const s = u - U_IMPACT; return s <= 0 ? 0 : Math.exp(-s / 0.06) * Math.abs(Math.sin(2 * Math.PI * s / 0.16)); };
  const angle = (u) => (u >= 0.97 ? thF : angleBrut(u) - (u > U_IMPACT ? 0.07 * thF * rebond(u) : 0));
  // Apres l'impact, le COU retombe vers le sol (une Mule couchee gardait la tete dressee, 28/09) :
  // chaque os de l'encolure tourne vers le flanc au sol, jusqu'a ce que le bout de la tete le touche.
  const cous = det.tetes.length ? det.tetes : [encolure(par, P0, det.pattes, det.queues)].filter(Boolean);
  const final = (p) => tourne(thF, p);
  const plis = cous.map((c) => {
    const n = c.length - 1;
    let best = 0;
    for (let phi = 0.05; phi <= 1.3; phi += 0.05) {
      let pos = final(P0[c[0]]), D = Rz(signe * thF), dessousSol = false;
      for (let k = 0; k < n; k++) {
        D = mm(D, Rz(signe * phi / n));
        pos = add(pos, mv(D, sub(P0[c[k + 1]], P0[c[k]])));
        if (pos[1] < sol + 0.01 * H) dessousSol = true;
      }
      if (dessousSol) break;
      best = phi;
    }
    return { c, n, phi: best };
  });
  const retombe = (u) => sm01((u - 0.62) / 0.25);
  // sursaut : la tete part en arriere (extension) entre 0.02 et 0.2, pic a 0.11
  const sursaut = (u) => (u > 0.02 && u < 0.2 ? Math.sin(Math.PI * (u - 0.02) / 0.18) ** 2 : 0);
  // --- jambes qui cedent : un axe de pliage et des poids par patte (genou +1, voisins -0.5 : pied sous la hanche)
  const jambes = det.pattes.filter((p) => p.chaine.length >= 3).map((p) => {
    const C = p.chaine, Lc = longueurChaine(C.map((k) => P0[k]));
    let m = 1, best = -1, axe = [1, 0, 0];
    const a0 = P0[C[0]], b0 = P0[C[C.length - 1]], u_ = mulS(sub(b0, a0), 1 / (norm(sub(b0, a0)) + 1e-12));
    let ecart = 0;
    for (let k = 1; k < C.length - 1; k++) {
      const o = sub(P0[C[k]], a0); ecart = Math.max(ecart, norm(sub(o, mulS(u_, dot(o, u_)))));
      const v1 = sub(P0[C[k]], P0[C[k - 1]]), v2 = sub(P0[C[k + 1]], P0[C[k]]), c_ = cross(v1, v2);
      if (norm(c_) > best) { best = norm(c_); m = k; axe = c_; }
    }
    if (ecart < 0.06 * Lc || norm(axe) < 1e-9) { axe = [1, 0, 0]; m = 1; }   // jambe droite : genou vers l'avant, pied en arriere
    axe = mulS(axe, 1 / norm(axe));
    const poids = new Map([[C[m], 1]]);
    if (m - 1 >= 0) poids.set(C[m - 1], -0.5);
    if (m + 1 <= C.length - 1) poids.set(C[m + 1], -0.5);
    const sous = dessous.has(C[0]);
    const arriere = p.rang === 0 ? 0 : 1;                     // l'avant cede en premier (poids du corps porte devant)
    return { p, axe, poids, sous, u0: 0.07 + 0.035 * arriere + 0.01 * (p.cote === cote ? 0 : 1) };
  });
  const dansJambes = new Set(det.pattes.flatMap((p) => sousArbre(E, p.chaine[0])));
  const phiJambe = (L, u) => {
    const F1 = 0.75, Fend = L.sous ? 0.6 : 1.25;               // dessous : comprimee ; dessus : relachee
    if (u < U_IMPACT) return F1 * sm01((u - L.u0) / 0.32);
    const s = u - U_IMPACT;
    return F1 + (Fend - F1) * sm01(s / 0.25) + (L.sous || u >= 0.97 ? 0 : 0.18 * Math.exp(-s / 0.07) * Math.sin(2 * Math.PI * s / 0.13));
  };
  // --- membres libres (queue, bras, oreilles, machoire) : hors tronc, hors jambes, hors cou
  const tronc = new Set();
  const remonter = (j) => { for (let k = j; k >= 0 && !tronc.has(k); k = par[k]) tronc.add(k); };
  for (const p of det.pattes) if (par[p.chaine[0]] >= 0) remonter(par[p.chaine[0]]);
  remonter(racine);
  let haut = racine;
  for (let j = 0; j < J; j++) if (!E[j].length && P0[j][1] > P0[haut][1]) haut = j;
  remonter(haut);
  const duCou = new Set(cous.flatMap((c) => c));
  const hauteurSous = new Array(J).fill(1);
  const fixerHauteur = (j) => { let h = 1; for (const e of E[j]) h = Math.max(h, 1 + fixerHauteur(e)); hauteurSous[j] = h; return h; };
  for (const r of sq.racines) fixerHauteur(r);
  const kappa = new Array(J).fill(0);
  for (let j = 0; j < J; j++) {
    if (par[j] < 0 || tronc.has(j) || dansJambes.has(j) || duCou.has(j)) continue;
    let r = j;
    while (par[r] >= 0 && !tronc.has(par[r]) && !duCou.has(par[r])) r = par[r];   // base du membre libre
    kappa[j] = 1 / Math.max(hauteurSous[r], 1);
  }
  const TAU = 0.07;
  const retard = (u) => angleBrut(u) - angleBrut(Math.max(0, u - TAU));
  const oscil = (u) => (u > U_IMPACT && u < 0.97 ? 0.22 * Math.exp(-(u - U_IMPACT) / 0.08) * Math.sin(2 * Math.PI * (u - U_IMPACT) / 0.12) : 0);
  const ordre = [], file = [racine, ...sq.racines.filter((r) => r !== racine)];
  while (file.length) { const j = file.shift(); ordre.push(j); file.push(...E[j]); }
  const R = [], racineMonde = [], sec = sq.racines.filter((r) => r !== racine), posSec = sec.map(() => []);
  for (let i = 0; i < nT; i++) {
    const u = i === nT - 1 ? 1 : t[i] / T, th = angle(u);
    const Rr = Rz(signe * th);
    const Ri = P0.map((_, j) => (par[j] < 0 ? Rr : I3()));
    for (const { c, n, phi } of plis) for (let k = 0; k < n; k++) {
      const fall = Rz(signe * phi * retombe(u) / n);
      Ri[c[k]] = k === 0 ? mm(fall, Rx(-0.5 * sursaut(u))) : fall;           // tete rejetee en arriere au sursaut
    }
    for (const L of jambes) { const ph = phiJambe(L, u); for (const [j, w] of L.poids) Ri[j] = rotvec(L.axe, w * ph); }
    const lag = u >= 0.97 ? 0 : retard(u) + oscil(u);
    if (Math.abs(lag) > 1e-9) for (let j = 0; j < J; j++) if (kappa[j]) Ri[j] = Rz(-signe * lag * kappa[j]);
    // cinematique directe pour tenir le sol
    const D = new Array(J), P = new Array(J);
    const r0 = tourne(th, P0[racine]);
    for (const j of ordre) {
      if (par[j] < 0) { D[j] = Ri[j]; P[j] = j === racine ? r0 : tourne(th, P0[j]); continue; }
      D[j] = mm(D[par[j]], Ri[j]);
      P[j] = add(P[par[j]], mv(D[par[j]], sub(P0[j], P0[par[j]])));
    }
    let bas = Infinity;
    for (let j = 0; j < J; j++) bas = Math.min(bas, P[j][1]);
    const hop = u > U_IMPACT && u < 0.97 ? 0.025 * H * rebond(u) : 0;
    const monte = sol - bas + hop;
    R.push(Ri);
    racineMonde.push(add(r0, [0, monte, 0]));
    sec.forEach((r, k) => posSec[k].push(add(tourne(th, P0[r]), [0, monte, 0])));
  }
  const infos = {
    mode: 'pattes', action: 'death', angle_deg: +(thF * 180 / Math.PI).toFixed(0), pattes: det.pattes.length, pedipalpes: 0,
    queues: det.queues.length, tetes: det.tetes.length, bras: 0, periode: T, foulee: 0, images: nT,
    sous_sol_pct: 0, pire_os: -1, glissement_appui_pct: 0, acoups_max_deg: 0,
  };
  return { nom: variante === 'normal' ? 'death' : `death__${variante}`, R, racineMonde, racinesSec: sec.map((j, k) => ({ j, pos: posSec[k] })), infos };
}

// ------------------------------------------------------------------ créatures SANS pattes, objets
// Serpent, ver, poisson… : REPTATION — une onde parcourt la colonne (le plus long chemin du
// squelette) de la tête vers la queue et fait avancer le corps. Variante « crawl » : onde
// VERTICALE (ver, chenille). À l'arrêt : seule la tête ondule. Sans colonne (objet d'un ou deux
// os) : mouvement RIGIDE minimal (léger balancement, glissement), jamais une erreur.
function cheminLePlusLong(par, P0, racine) {
  const voisins = par.map(() => []);
  par.forEach((p, j) => { if (p >= 0) { const L = norm(sub(P0[j], P0[p])); voisins[p].push([j, L]); voisins[j].push([p, L]); } });
  const loin = (src) => {
    const dist = new Map([[src, 0]]), prec = new Map([[src, -1]]), pile = [src];
    while (pile.length) {
      const u = pile.pop();
      for (const [v, L] of voisins[u]) if (!dist.has(v)) { dist.set(v, dist.get(u) + L); prec.set(v, u); pile.push(v); }
    }
    let best = src;
    for (const [k, d] of dist) if (d > dist.get(best)) best = k;
    return { best, prec };
  };
  const a = loin(racine).best;
  const { best: b, prec } = loin(a);
  const chemin = [];
  for (let k = b; k >= 0; k = prec.get(k)) chemin.push(k);
  return chemin;
}

/** Chemin entre deux joints d'un même arbre (par les ancêtres). */
function cheminEntre(par, a, b) {
  const anc = (j) => { const c = []; for (; j >= 0; j = par[j]) c.push(j); return c; };
  const ca = anc(a), cb = anc(b), sb = new Set(cb);
  const i = ca.findIndex((k) => sb.has(k));
  if (i < 0) return null;
  return [...ca.slice(0, i + 1), ...cb.slice(0, cb.indexOf(ca[i])).reverse()];
}

/** Colonne d'une créature sans pattes : le plus long chemin, dont chaque bout est ensuite remplacé
 *  par le bout le plus AVANCÉ dans l'axe du corps. Le plus long chemin d'un poisson passait par une
 *  nageoire pectorale (plus longue que l'os de la tête) : la tête réelle n'ondulait pas (28/09). */
function colonneAxiale(par, P0, racine) {
  let chemin = cheminLePlusLong(par, P0, racine);
  if (P0[chemin[0]][2] < P0[chemin[chemin.length - 1]][2]) chemin.reverse();   // tête = bout le plus en avant (+Z)
  if (chemin.length < 3) return chemin;
  const deg = par.map(() => 0);
  par.forEach((p, j) => { if (p >= 0) { deg[p]++; deg[j]++; } });
  for (const bout of [0, 1]) {
    const a = chemin[bout ? chemin.length - 1 : 0], b = chemin[bout ? 0 : chemin.length - 1];
    const axe = sub(P0[a], P0[b]), L = norm(axe);
    if (L < 1e-9) continue;
    const u = mulS(axe, 1 / L), proj = (k) => dot(sub(P0[k], P0[b]), u);
    let best = a;
    for (let k = 0; k < par.length; k++) if (deg[k] <= 1 && k !== b && proj(k) > proj(best) + 0.02 * L) best = k;
    if (best === a) continue;
    const c = cheminEntre(par, b, best);
    if (c && c.length >= 3) chemin = bout ? c : c.reverse();   // c va de b vers le nouveau bout
    if (P0[chemin[0]][2] < P0[chemin[chemin.length - 1]][2]) chemin.reverse();
  }
  return chemin;
}

/** Queue a nageoire HORIZONTALE (cetace : dauphin, baleine, orque) ? Les os hors colonne qui partent du
 *  dernier quart de la colonne s'ecartent de cote (X) bien plus qu'en hauteur (Y) ; chez un poisson,
 *  la caudale est verticale. Sert a choisir l'onde verticale (battement haut / bas). */
function queueHorizontale(par, P0, chemin) {
  if (chemin.length < 4) return false;
  const E = enfantsDe(par), surChemin = new Set(chemin), Ltot = longueurChaine(chemin.map((k) => P0[k]));
  const debut = Math.floor(0.75 * (chemin.length - 1));
  let sx = 0, sy = 0;
  for (let a = debut; a < chemin.length; a++) {
    const c0 = P0[chemin[a]];
    for (const e of E[chemin[a]]) {
      if (surChemin.has(e)) continue;
      for (const k of sousArbre(E, e)) { sx = Math.max(sx, Math.abs(P0[k][0] - c0[0])); sy = Math.max(sy, Math.abs(P0[k][1] - c0[1])); }
    }
  }
  return sx > 0.04 * Ltot && sx > 1.5 * sy;
}

function animerSansPattes(sq, allure, cycles, fps, variante, det, raison = 'reptation', nage = false) {
  const { par, P0 } = sq, J = par.length, E = enfantsDe(par);
  const racine = det.racine, sol = det.sol, H = Math.max(ptpAxe(P0, 1), 1e-6), ext = Math.max(etendue(P0), 1e-6);
  const B = ALLURES[allure], V = (VARIANTES[allure] || {})[variante] || {};
  const pas = B.pas;
  const chemin = colonneAxiale(par, P0, racine);
  const Ltot = longueurChaine(chemin.map((k) => P0[k]));
  const mode = raison === 'reptation' && chemin.length >= 4 && Ltot > 0.05 * ext ? 'reptation' : 'rigide';
  // Onde de la colonne, par type de corps (valeurs de la litterature, voir le detail en commentaire) :
  //  - nage carangiforme (poisson) : amplitude quasi nulle a la tete, croissant en parabole vers la queue
  //    (Videler & Hess 1984, thon / maquereau : A(x) quadratique ; Bainbridge 1958 : amplitude du bout de
  //    queue ~0,1 L), longueur d'onde ~1,0 L (Videler & Hess 1984 ; Di Santo et al. 2021 PNAS : la longueur
  //    d'onde propulsive va de ~0,6 L (anguilliformes) a >1 L (thunniformes)) ;
  //  - nage anguilliforme (colonne de 18 os ou plus) : lambda ~0,65 L, amplitude de la tete ~30 % de celle de la queue
  //    (Gillis 1998 ; Tytell & Lauder 2004, anguille : onde sur 1/3 a presque tout le corps selon la vitesse) ;
  //  - cetace : meme onde mais VERTICALE (nageoire horizontale), lambda ~1,1 L (Fish 1993 / 1998, grand dauphin) ;
  //  - reptation de serpent : chaque point du corps SUIT la trace de la tete (pas de derapage : Gray 1946 ;
  //    Jayne 1986), donc l'onde est immobile dans le repere du sol : vitesse d'avance = vitesse de l'onde,
  //    amplitude uniforme (Jayne 1986) ;
  //  - chenille : bosses verticales qui vont de la queue vers la tete (onde DIRECTE, Trimmer & Issberner 2007,
  //    Manduca sexta), avance de ~0,2 L par cycle.
  const chenille = !nage && variante === 'crawl';
  const cetace = nage && (variante === 'crawl' || queueHorizontale(par, P0, chemin));
  const anguille = nage && !cetace && chemin.length >= 18;
  const vertical = chenille || cetace;
  // poisson a l'arret : battement de queue lent (sur place), pas la tete seule
  // periode arrondie a un nombre ENTIER d'images : la derniere image enchaine sur la premiere sans saut
  const T = Math.max(2, Math.round((allure === 'idle' ? (nage ? 1.8 : 4.0) : allure === 'run' ? 0.8 : 1.3) * (V.T || 1) * fps)) / fps;
  const nT = Math.max(2, Math.round((allure === 'idle' ? 1 : cycles) * T * fps));
  const t = Array.from({ length: nT }, (_, i) => i / fps);
  const L = mode === 'reptation' ? Ltot : ext;
  const lambda = (chenille ? 0.8 : cetace ? 1.1 : anguille ? 0.65 : nage ? 1.0 : 0.7) * L;
  const amp = (allure === 'idle' ? 0.03 : allure === 'run' ? 0.12 : nage ? 0.09 : 0.09) * L * (V.h || 1)
    * (chenille ? 0.4 : cetace ? 1.1 : 1);
  // vitesse d'avance : fraction de la vitesse de l'onde (nage : glissement ~0,3) ; serpent : sans glissement
  // (la trace est alors periodique en un cycle, la boucle se ferme) ; chenille : 0,2 L par cycle
  const vOnde = lambda / T;
  const v = pas ? (mode !== 'reptation' ? 0.35 * L / T : chenille ? 0.2 * L / T : nage ? 0.7 * vOnde : vOnde) * (V.foulee || 1) : 0;
  const w = pas ? (B.lacet || 0) * (V.lacet || 1) : 0;
  const cheminCorps = (tt) => {
    const cap = w * tt;
    const c = Math.abs(w) < 1e-9 ? [0, 0, v * tt] : [(v / w) * (1 - Math.cos(cap)), 0, (v / w) * Math.sin(cap)];
    return { c, cap };
  };
  const D = Array.from({ length: nT }, () => new Array(J));
  const positions = new Map();                                // joint -> positions imposées (colonne)
  const rotImposees = new Map();                              // joint -> rotations monde imposées
  if (mode === 'reptation') {
    const s = [0];
    for (let k = 1; k < chemin.length; k++) s.push(s[k - 1] + norm(sub(P0[chemin[k]], P0[chemin[k - 1]])));
    const kappa = v > 1e-9 ? w / v : 0;
    const X = chemin.map(() => new Array(nT));
    // SERPENT AU SOL : suivi de trace. Chaque point du corps passe exactement par la trace de la tete (pas de
    // derapage, Gray 1946 ; Jayne 1986) : la sinusoide est FIXE dans le repere du sol, le corps coule a travers,
    // la tete oscille avec le reste. Avant (28/09), la tete restait sur une droite et l'onde glissait sur le
    // corps comme chez un nageur : le serpent « nageait » sur le sol (derapage mesure 0,26).
    const suivi = !nage && !vertical && pas && v > 1e-9;
    if (suivi) {
      const ds = Ltot / 300, sMax = Ltot + v * t[nT - 1] + 2 * ds, nS = Math.ceil(sMax / ds) + 2, kO = 2 * Math.PI / lambda;
      const tx = new Float64Array(nS), tz = new Float64Array(nS);
      for (let n = 1; n < nS; n++) {
        const sg = (n - 0.5) * ds, th = kappa * sg + Math.atan(amp * kO * Math.cos(kO * sg));
        tx[n] = tx[n - 1] + ds * Math.sin(th); tz[n] = tz[n - 1] + ds * Math.cos(th);
      }
      const en = (sg) => { const f = Math.max(0, sg) / ds, n0 = Math.min(Math.floor(f), nS - 2), r_ = f - n0; return [tx[n0] + r_ * (tx[n0 + 1] - tx[n0]), tz[n0] + r_ * (tz[n0 + 1] - tz[n0])]; };
      const g0 = en(Ltot);
      for (let i = 0; i < nT; i++) for (let k = 0; k < chemin.length; k++) {
        const q = en(Ltot + v * t[i] - s[k]);
        X[k][i] = [P0[chemin[0]][0] + q[0] - g0[0], P0[chemin[k]][1], P0[chemin[0]][2] + q[1] - g0[1]];
      }
    }
    for (let i = 0; i < nT && !suivi; i++) {
      const { c, cap } = cheminCorps(t[i]);
      const Rc = Ry(cap);
      let p = [0, 0, 0];
      const pts = [p];
      for (let k = 0; k < chemin.length - 1; k++) {
        const repos = sub(P0[chemin[k + 1]], P0[chemin[k]]);
        const sm = 0.5 * (s[k] + s[k + 1]), phi = 2 * Math.PI * (sm / lambda + (chenille ? 1 : -1) * t[i] / T);
        const u_ = sm / Ltot;
        const env = allure === 'idle' && !nage ? Math.max(0, 1 - sm / (0.35 * Ltot))
          : chenille ? 1 : anguille ? 0.3 + 0.7 * u_ : nage ? 0.1 + 0.9 * u_ * u_ : 0.55 + 0.45 * u_;
        let R_;
        if (vertical) {
          const pente = Math.atan(amp * env * 2 * Math.PI / lambda * Math.cos(phi));
          let axe = cross(repos, [0, 1, 0]);
          R_ = norm(axe) < 1e-9 ? I3() : rotvec(axe, pente);
        } else {
          R_ = Ry(Math.atan(amp * env * 2 * Math.PI / lambda * Math.cos(phi)) - kappa * sm);
        }
        p = add(p, mv(mm(Rc, R_), repos));
        pts.push(p);
      }
      // la tête mène le chemin ; la colonne garde sa hauteur de repos (bosses au-dessus du sol)
      const tete = add(P0[chemin[0]], c);
      const Xi = pts.map((q) => add(tete, q));
      // chenille : les bosses se posent sur le sol (rien dessous). Cetace : en pleine eau, pas de sol : on releve
      // le corps d'une constante (jamais sous sa hauteur de repos) au lieu de le faire rebondir.
      const creux = cetace ? -1.1 * amp * (1 + 0) : Math.min(...Xi.map((q, k) => q[1] - P0[chemin[k]][1]));
      Xi.forEach((q, k) => { q[1] -= creux; X[k][i] = q; });
    }
    chemin.forEach((j, k) => positions.set(j, X[k]));
    // rotation de chaque joint de la colonne : aligne ses os de colonne (1 ou 2 enfants sur le chemin)
    const surChemin = new Set(chemin);
    for (const j of chemin) {
      const enfantsC = E[j].filter((c) => surChemin.has(c));
      if (!enfantsC.length) continue;
      const Pj = positions.get(j);
      rotImposees.set(j, t.map((_, i) => {
        if (enfantsC.length === 1) {
          const c = enfantsC[0];
          return alignerLacet(sub(P0[c], P0[j]), sub(positions.get(c)[i], Pj[i]));
        }
        const [a, b] = enfantsC;
        return alignerLacet(sub(P0[b], P0[a]), sub(positions.get(b)[i], positions.get(a)[i]));
      }));
    }
  }
  // rigide (ou tout os hors colonne) : le corps entier suit le chemin avec un léger balancement
  const bob = t.map((tt) => (pas ? 0.02 : 0.01) * H * Math.sin(2 * Math.PI * 2 * tt / T));
  const Rb = t.map((tt, i) => mm(Ry(cheminCorps(tt).cap), mode === 'rigide' ? mm(Rz(0.03 * Math.sin(2 * Math.PI * tt / T)), Rx(0.02 * Math.sin(4 * Math.PI * tt / T))) : I3()));
  const ordre = [], file = [...sq.racines];
  while (file.length) { const j = file.shift(); ordre.push(j); file.push(...E[j]); }
  const racineMonde = t.map((tt, i) => {
    if (positions.has(racine)) return positions.get(racine)[i];
    return add(add(P0[racine], cheminCorps(tt).c), [0, mode === 'rigide' ? bob[i] : 0, 0]);
  });
  for (let i = 0; i < nT; i++) {
    for (const j of ordre) {
      if (rotImposees.has(j)) D[i][j] = rotImposees.get(j)[i];
      else if (par[j] < 0) D[i][j] = mode === 'reptation' && positions.size ? (rotImposees.get(chemin[0])?.[i] || Rb[i]) : Rb[i];
      else D[i][j] = D[i][par[j]];
    }
  }
  // racine hors colonne : elle suit rigidement le premier joint de colonne qu'elle porte
  if (mode === 'reptation' && !positions.has(racine)) {
    const proche = chemin.reduce((m, k) => (norm(sub(P0[k], P0[racine])) < norm(sub(P0[m], P0[racine])) ? k : m), chemin[0]);
    for (let i = 0; i < nT; i++) {
      const Dp = D[i][proche];
      racineMonde[i] = add(positions.get(proche)[i], mv(Dp, sub(P0[racine], P0[proche])));
      for (let k = racine; k >= 0 && k !== proche;) { D[i][k] = Dp; break; }
    }
    for (let i = 0; i < nT; i++) for (const j of ordre) if (!rotImposees.has(j) && par[j] >= 0) D[i][j] = D[i][par[j]];
  }
  const R = D.map((Di) => Di.map((Dj, j) => (par[j] < 0 ? Dj : mm(tr(Di[par[j]]), Dj))));
  const racinesSec = sq.racines.filter((r) => r !== racine).map((r) => ({ j: r, pos: t.map((tt, i) => add(add(P0[r], cheminCorps(tt).c), [0, bob[i], 0])) }));
  // contrôles
  const Pw = D.map(() => new Array(J));
  for (let i = 0; i < nT; i++) for (const j of ordre) {
    if (j === racine) Pw[i][j] = racineMonde[i];
    else if (par[j] < 0) Pw[i][j] = racinesSec.find((x) => x.j === j).pos[i];
    else Pw[i][j] = add(Pw[i][par[j]], mv(D[i][par[j]], sub(P0[j], P0[par[j]])));
  }
  let sousSol = 0, pireOs = -1, acoups = 0;
  for (let i = 0; i < nT; i++) for (let j = 0; j < J; j++) if (sol - Pw[i][j][1] > sousSol) { sousSol = sol - Pw[i][j][1]; pireOs = j; }
  for (const j of chemin) {
    let prec = null;
    for (let i = 1; i < nT; i++) {
      const w_ = angleRot(mm(tr(D[i - 1][j]), D[i][j]));
      if (prec !== null) acoups = Math.max(acoups, Math.abs(w_ - prec));
      prec = w_;
    }
  }
  const infos = {
    mode, pattes: 0, pedipalpes: 0, queues: 0, tetes: 0, bras: 0, colonne: chemin.length,
    periode: T, foulee: +(v * T).toFixed(3), images: nT,
    sous_sol_pct: +(100 * sousSol / H).toFixed(1), pire_os: pireOs, glissement_appui_pct: 0, acoups_max_deg: +(acoups * 180 / Math.PI).toFixed(1),
  };
  return { nom: variante === 'normal' ? allure : `${allure}__${variante}`, R, racineMonde, racinesSec, infos };
}

// ------------------------------------------------------------------ MODE « VOL » (2026-10-25, demande du user : « il manque les animations pour les volants »)
// Oiseau, chauve-souris, abeille, dragon, cochon volant : le corps flotte au-dessus du sol, les AILES battent, les pattes se replient.
// Repere : +z devant, +y en haut, +x a gauche (lacet positif = vers la gauche : voir ALLURES.turn_left).
//  - ailes : chaines laterales qui ne sont ni des pattes, ni des queues, ni des tetes ; la racine de l'aile bat autour de l'axe avant (Rz),
//    chaque os suivant bat avec un RETARD de phase et une amplitude decroissante (l'extremite fouette, comme une vraie aile) ;
//  - corps : monte pendant la descente de l'aile (la portance), tangage vers l'avant en vol rapide, roulis dans les virages (le virage se prend
//    en penchant du cote ou l'on tourne) ;
//  - sans aile (cochon volant) : le corps flotte et tangue au meme rythme, sans battement ;
//  - pattes : repliees vers l'arriere (oiseau, insecte) avec un leger balancement ; queue : ondulation ; tete : stabilisee contre le tangage.
// Frequences de battement reelles : petits oiseaux 8-20 Hz, rapaces 2-4 Hz, gros oiseaux 1-2 Hz (Tobalske 2007, Physiol Biochem Zool) ;
// ici on vise le LISIBLE a 30 images/s : 1,4 a 2,2 Hz (un battement rapide sous-echantillonne donnerait un tremblement).
const PROFILS_VOL = {
  idle: { T: 0.8, amp: 0.45, lift: 0.10, avance: 0, tangage: 0.0, roulis: 0.03 },          // vol stationnaire : battement plus court
  walk: { T: 0.7, amp: 0.65, lift: 0.14, avance: 1.2, tangage: 0.10, roulis: 0.04 },       // vol de croisiere
  run: { T: 0.55, amp: 0.8, lift: 0.16, avance: 2.6, tangage: 0.24, roulis: 0.05 },        // vol rapide : battement ample, corps incline vers l'avant
  turn_left: { T: 0.7, amp: 0.65, lift: 0.14, avance: 1.0, tangage: 0.10, roulis: 0.04 },
  turn_right: { T: 0.7, amp: 0.65, lift: 0.14, avance: 1.0, tangage: 0.10, roulis: 0.04 },
};
function animerVol(sq, allure, cycles, fps, variante, det) {
  const { par, P0 } = sq, J = par.length, E = enfantsDe(par);
  const { racine, queues, tetes, pattes } = det;
  const H = Math.max(ptpAxe(P0, 1), 1e-6), ext = Math.max(etendue(P0), 1e-6);
  const B = ALLURES[allure], V = (VARIANTES[allure] || {})[variante] || {};
  const PV = PROFILS_VOL[allure] || PROFILS_VOL.walk;
  const T0 = PV.T * (V.T || 1);
  const nCycles = allure === 'idle' ? Math.max(3, Math.round(cycles)) : Math.max(1, Math.round(cycles));
  const nT = Math.max(2, Math.round(nCycles * T0 * fps));
  const T = nT / (nCycles * fps);                              // periode : nombre ENTIER d'images par cycle (la boucle se referme)
  const t = Array.from({ length: nT }, (_, i) => i / fps);
  const w = B.lacet || 0;                                      // rad/s, + = vers la gauche
  const v = PV.avance * (V.foulee || 1) * ext * 0.9;           // vitesse d'avance (unites / s)
  const cheminCorps = (tt) => {
    const cap = w * tt;
    const c = Math.abs(w) < 1e-9 ? [0, 0, v * tt] : [(v / w) * (1 - Math.cos(cap)), 0, (v / w) * Math.sin(cap)];
    return { c, cap };
  };
  const phi = (tt) => 2 * Math.PI * tt / T;                    // phase de battement : sin > 0 = aile en HAUT
  // --- ailes : feuilles laterales hors pattes / queues / tetes (meme critere que le leger battement des quadrupedes a ailes)
  const xMid = median(P0.map((p) => p[0]));
  const pris = new Set([...pattes].flatMap((q) => sousArbre(E, q.chaine[0])));
  [...tetes, ...queues].forEach((c) => c.forEach((k) => pris.add(k)));
  const ailes = [];
  for (let f = 0; f < J; f++) {
    if (E[f].length || pris.has(f) || Math.abs(P0[f][0] - xMid) < 0.12 * ext) continue;
    const c = [f];
    let k = f;
    while (par[k] >= 0 && E[par[k]].length === 1 && !pris.has(par[k])) { k = par[k]; c.push(k); }
    c.reverse();
    if (c.length < 2 || par[c[0]] < 0) continue;
    ailes.push({ chaine: c, cote: P0[f][0] > xMid ? 1 : -1 });
  }
  const balance = new Map();                                   // joint -> rotations locales (par rapport au parent), une par image
  const ampAile = PV.amp * (V.h || 1);
  for (const a of ailes) {
    a.chaine.slice(0, -1).forEach((j, k) => {
      const amp = ampAile * Math.pow(0.72, k), retard = 0.55 * k;     // l'extremite suit avec retard et moins d'amplitude
      balance.set(j, t.map((tt) => Rz(a.cote * amp * Math.sin(phi(tt) - retard) + (k === 0 ? a.cote * 0.12 * ampAile : 0))));
    });
  }
  // --- queue : ondulation douce, en retard sur le battement ; tete : contre-tangage
  const tangage = t.map((tt) => PV.tangage + 0.035 * Math.sin(phi(tt) + 0.6));
  for (const cq of queues) {
    cq.slice(0, -1).forEach((j, a) => {
      balance.set(j, t.map((tt) => mm(Ry(0.14 * (a + 1) / cq.length * Math.sin(phi(tt) * 0.5 - 0.5 * a)), Rx(-0.10 * Math.sin(phi(tt) - 0.8 - 0.4 * a)))));
    });
  }
  for (const ct of tetes) {
    ct.slice(0, -1).forEach((j, a) => {
      balance.set(j, t.map((tt, i) => Rx((a === 0 ? -tangage[i] * 0.8 : 0) + 0.03 * Math.sin(phi(tt) + 0.9))));
    });
  }
  // --- pattes : repliees vers l'arriere (hanche, puis chaque articulation) avec un leger balancement
  for (const p of pattes) {
    p.chaine.slice(0, -1).forEach((j, k) => {
      const repli = (k === 0 ? 0.55 : 0.75) * (V.repli ?? 1);
      balance.set(j, t.map((tt) => Rx(repli + 0.07 * Math.sin(phi(tt) - 0.4 * k))));
    });
  }
  // --- le corps : portance (monte a la descente de l'aile), tangage, roulis (penche dans les virages)
  const roulisVirage = Math.abs(w) > 1e-9 ? -Math.sign(w) * 0.35 : 0;
  const Rb = t.map((tt, i) => mm(Ry(cheminCorps(tt).cap), mm(Rz(roulisVirage + PV.roulis * Math.sin(phi(tt) + 1.2)), Rx(tangage[i]))));
  const lift = (tt) => (PV.lift + 0.045 * PV.amp * Math.sin(phi(tt) - Math.PI / 2)) * H;
  const racineMonde = t.map((tt) => add(add(P0[racine], cheminCorps(tt).c), [0, lift(tt), 0]));
  const racinesSec = sq.racines.filter((r) => r !== racine).map((r) => ({ j: r, pos: t.map((tt) => add(add(P0[r], cheminCorps(tt).c), [0, lift(tt), 0])) }));
  const ordre = [], file = [racine, ...sq.racines.filter((r) => r !== racine)];
  while (file.length) { const j = file.shift(); ordre.push(j); file.push(...E[j]); }
  const D = Array.from({ length: nT }, () => new Array(J));
  for (let i = 0; i < nT; i++) {
    for (const j of ordre) {
      if (par[j] < 0) D[i][j] = Rb[i];
      else if (balance.has(j)) D[i][j] = mm(D[i][par[j]], balance.get(j)[i]);
      else D[i][j] = D[i][par[j]];
    }
  }
  const R = D.map((Di) => Di.map((Dj, j) => (par[j] < 0 ? Dj : mm(tr(Di[par[j]]), Dj))));
  // --- controles : positions reconstruites, os sous le sol, a-coups des articulations d'aile
  const sol = det.sol, Pw = D.map(() => new Array(J));
  for (let i = 0; i < nT; i++) for (const j of ordre) {
    Pw[i][j] = j === racine ? racineMonde[i] : par[j] < 0 ? racinesSec.find((x) => x.j === j).pos[i]
      : add(Pw[i][par[j]], mv(D[i][par[j]], sub(P0[j], P0[par[j]])));
  }
  let sousSol = 0, pireOs = -1, acoups = 0;
  for (let i = 0; i < nT; i++) for (let j = 0; j < J; j++) if (sol - Pw[i][j][1] > sousSol) { sousSol = sol - Pw[i][j][1]; pireOs = j; }
  for (const a of ailes) for (const j of a.chaine) {
    let prec = null;
    for (let i = 1; i < nT; i++) {
      const w_ = angleRot(mm(tr(D[i - 1][j]), D[i][j]));
      if (prec !== null) acoups = Math.max(acoups, Math.abs(w_ - prec));
      prec = w_;
    }
  }
  const infos = {
    mode: 'vol', ailes: ailes.length, pattes: pattes.length, queues: queues.length, tetes: tetes.length, colonne: 0,
    periode: T, foulee: +(v * T).toFixed(3), images: nT,
    sous_sol_pct: +(100 * sousSol / H).toFixed(1), pire_os: pireOs, glissement_appui_pct: 0, acoups_max_deg: +(acoups * 180 / Math.PI).toFixed(1),
    battements_par_s: +(1 / T).toFixed(2),
  };
  return { nom: variante === 'normal' ? allure : `${allure}__${variante}`, R, racineMonde, racinesSec, infos };
}

/** Calcul protégé : une allure qui échoue ou rend une valeur invalide donne un mouvement minimal. */
function animerAllureSure(sq, allure, cycles, fps, variante, mode = 'auto', espece = 'generique') {
  const fini = (c) => c.R.every((Ri) => Ri.every((m) => m.every(Number.isFinite))) && c.racineMonde.every((p) => p.every(Number.isFinite));
  // nom du clip selon ce qu'il est vraiment : « swim » pour un poisson, « slither » pour un serpent
  const nommer = (c) => {
    const table = NOMS_PAR_MODE[mode === 'nage' ? 'nage' : mode === 'vol' ? 'vol' : c.infos.mode === 'reptation' ? 'reptation' : ''];
    if (table && table[allure]) c.nom = table[allure] + (variante === 'normal' ? '' : '__' + variante);
    c.infos.deplacement = mode === 'nage' ? 'nage' : mode === 'vol' ? 'vol' : c.infos.mode === 'reptation' ? 'reptation' : 'pattes';
    return c;
  };
  try {
    // vol : seulement les 5 allures de base (attente = vol stationnaire) ; les actions (attaque, mort, manger...) gardent le calcul a pattes
    const volPossible = mode === 'vol' && !!PROFILS_VOL[allure];
    let c = volPossible
      ? animerVol(sq, allure, cycles, fps, variante, detecterPattes(sq.par, sq.P0, sq.racine))
      : mode === 'nage' || mode === 'reptation'
      ? animerSansPattes(sq, allure, cycles, fps, variante, detecterPattes(sq.par, sq.P0, sq.racine), 'reptation', mode === 'nage')
      : animerAllure(sq, allure, cycles, fps, variante, espece);
    // action trop ample pour CETTE creature (corps bas, tete au ras du sol : tortue, araignee) :
    // elle passait sous le sol (jusqu'a 30 %) ; on l'attenue par paliers jusqu'a ce qu'elle tienne
    if (ALLURES[allure].action && ALLURES[allure].action !== 'death' && fini(c)) {
      let k = 1;
      while (c.infos.sous_sol_pct > 1 && k > 0.2) {
        k *= 0.7;
        const c2 = animerAllure(sq, allure, cycles, fps, variante, espece, k);
        if (!fini(c2)) break;
        c = c2; c.infos.ampleur = +k.toFixed(2);
      }
    }
    if (fini(c)) return nommer(c);
    throw new Error('valeur invalide dans le calcul');
  } catch (e) {
    const det = detecterPattes(sq.par, sq.P0, sq.racine);
    const c = animerSansPattes(sq, allure, cycles, fps, variante, det, 'rigide');
    c.infos.mode = 'secours';
    c.infos.erreur = String(e?.message || e);
    return c;
  }
}

// ------------------------------------------------------------------ pistes locales d'un clip
// Rotations LOCALES de chaque nœud (quaternions x, y, z, w) et translation de la racine dans le
// repère de son parent : ce qu'écrit le GLB, et ce que joue directement le mini-lecteur.
function pistesLocales(sq, { nom, R, racineMonde, racinesSec = [] }, fps) {
  const nT = R.length;
  const temps = Float32Array.from({ length: nT }, (_, i) => i / fps);
  const rotations = sq.joints.map((n, u) => {
    const pn = sq.parent.get(n);
    const Cp = pn !== undefined ? orthonormer(rot4(sq.W.get(pn))) : I3(), C = orthonormer(rot4(sq.W.get(n)));
    const q = new Float32Array(4 * nT);
    let prec = null;
    for (let i = 0; i < nT; i++) {
      let qq = quatDeMatrice(mm(mm(tr(Cp), R[i][u]), C));
      if (prec && qq[0] * prec[0] + qq[1] * prec[1] + qq[2] * prec[2] + qq[3] * prec[3] < 0) qq = qq.map((x) => -x);
      q.set(qq, 4 * i);
      prec = qq;
    }
    return { noeud: n, q };
  });
  const racineNoeud = sq.joints[sq.racine];
  const pn = sq.parent.get(racineNoeud);
  const inv = pn !== undefined ? inv4(sq.W.get(pn)) : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const v = new Float32Array(3 * nT);
  racineMonde.forEach((p, i) => v.set(add(mv(rot4(inv), p), pos4(inv)), 3 * i));
  const translationsSec = racinesSec.map(({ j, pos }) => {
    const n = sq.joints[j], pn2 = sq.parent.get(n);
    const inv2 = pn2 !== undefined ? inv4(sq.W.get(pn2)) : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const v2 = new Float32Array(3 * nT);
    pos.forEach((p, i) => v2.set(add(mv(rot4(inv2), p), pos4(inv2)), 3 * i));
    return { noeud: n, v: v2 };
  });
  return { nom, duree: (nT - 1) / fps, temps, rotations, translation: { noeud: sq.joints[sq.racine], v: v }, translationsSec };
}

// ------------------------------------------------------------------ écriture du GLB (une animation par allure)
function ecrireGLB(sq, clips, fps) {
  const json = JSON.parse(JSON.stringify(sq.json));
  const morceaux = [sq.bin];
  let taille = sq.bin.byteLength;
  const ajouter = (f32, type, minmax) => {
    const bourrage = (4 - (taille % 4)) % 4;
    if (bourrage) { morceaux.push(new Uint8Array(bourrage)); taille += bourrage; }
    const off = taille;
    morceaux.push(new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength));
    taille += f32.byteLength;
    (json.bufferViews = json.bufferViews || []).push({ buffer: 0, byteOffset: off, byteLength: f32.byteLength });
    const n = { SCALAR: 1, VEC3: 3, VEC4: 4 }[type];
    const acc = { bufferView: json.bufferViews.length - 1, componentType: 5126, count: f32.length / n, type };
    if (minmax) { acc.min = [Math.min(...f32)]; acc.max = [Math.max(...f32)]; }
    (json.accessors = json.accessors || []).push(acc);
    return json.accessors.length - 1;
  };
  json.animations = [];
  for (const clip of clips) {
    const P = pistesLocales(sq, clip, fps);
    const temps = ajouter(P.temps, 'SCALAR', true);
    const samplers = [], channels = [];
    for (const { noeud, q } of P.rotations) {
      samplers.push({ input: temps, output: ajouter(q, 'VEC4'), interpolation: 'LINEAR' });
      channels.push({ sampler: samplers.length - 1, target: { node: noeud, path: 'rotation' } });
    }
    for (const tr_ of [P.translation, ...P.translationsSec]) {
      samplers.push({ input: temps, output: ajouter(tr_.v, 'VEC3'), interpolation: 'LINEAR' });
      channels.push({ sampler: samplers.length - 1, target: { node: tr_.noeud, path: 'translation' } });
    }
    json.animations.push({ name: P.nom, samplers, channels });
  }
  const bourrage = (4 - (taille % 4)) % 4;
  if (bourrage) { morceaux.push(new Uint8Array(bourrage)); taille += bourrage; }
  json.buffers[0].byteLength = taille;
  let jb = new TextEncoder().encode(JSON.stringify(json));
  const pj = (4 - (jb.length % 4)) % 4;
  if (pj) { const t_ = new Uint8Array(jb.length + pj); t_.set(jb); t_.fill(0x20, jb.length); jb = t_; }
  const total = 12 + 8 + jb.length + 8 + taille;
  const out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jb.length, true); dv.setUint32(16, 0x4E4F534A, true); out.set(jb, 20);
  let off = 20 + jb.length;
  dv.setUint32(off, taille, true); dv.setUint32(off + 4, 0x004E4942, true); off += 8;
  for (const m of morceaux) { out.set(m, off); off += m.byteLength; }
  return out.buffer;
}

// ------------------------------------------------------------------ reparation de la PEAU
// Rig dont la peau lie des points a un membre LOINTAIN (28/09 : pieds du gladiateur lies a 50 % a la
// MAIN, poule, phacochere…) : la jambe bouge, la moitie de sa peau reste accrochee au membre
// immobile -> longues lanieres. L'os « maison » d'un point = l'os lie le plus PROCHE de lui ; un
// poids vers un os LOINTAIN a la fois dans le squelette (>= 5 os d'ecart : la main et le pied du
// gladiateur en ont 12) et dans l'espace (> 2,5 x la maison et > 5 % de la taille) lui est rendu.
// Le melange naturel (colonne contre cuisse, base de la queue, 2 a 3 os d'ecart) n'est pas touche.
const ECART_OS_PEAU = 5;
function preparerPeau(sq) {
  const { par, P0 } = sq, J = par.length;
  if (!detecterPattes(par, P0, sq.racine).pattes.length) return null;
  const prof = par.map((_, j) => { let n = 0; for (let k = j; par[k] >= 0; k = par[k]) n++; return n; });
  const ecart = (a, b) => {                                  // nombre d'os entre a et b dans l'arbre
    let x = a, y = b, n = 0;
    while (x !== y) { if (prof[x] >= prof[y]) x = par[x]; else y = par[y]; n++; if (x < 0 || y < 0) return 99; }
    return n;
  };
  return { E: enfantsDe(par), ecart, ext: etendue(P0) };
}
// SEULEMENT si le rig porte la signature du defaut : plus de 8 % du poids total a deplacer (rigs casses
// mesures : 11,5 a 25 % ; rigs sains : 0 a 3,6 %). Sur un rig sain, la regle pourrait se tromper (une
// main qui pend contre la cuisse serait rattachee a la cuisse) : on n'y touche pas.
const SEUIL_PEAU_ABIMEE = 0.08;
/** Corrige en place les poids (joints / weights : 4 par point, dans l'ordre de skin.joints) si la peau est
 *  abimee (signature ci-dessus). Rend le nombre de points corriges (0 = peau saine, rien n'est modifie). */
export function corrigerPoidsPeau(sq, pos, jts, wts, prep = preparerPeau(sq)) {
  if (!prep) return 0;
  const essai = Float64Array.from(wts);
  const n = corrigerPoidsBrut(sq, pos, jts, essai, prep);
  let total = 0, deplace = 0;
  for (let i = 0; i < wts.length; i++) { total += wts[i]; deplace += Math.max(0, wts[i] - essai[i]); }
  let r = 0;
  if (n && deplace >= SEUIL_PEAU_ABIMEE * total) {
    for (let i = 0; i < wts.length; i++) wts[i] = essai[i];
    r = n;
  }
  return r + reaffecterPeauLointaine(sq, pos, jts, wts, prep);
}
/* SOMMETS LIES UNIQUEMENT A DES OS LOINTAINS (2026-09-29, araignee de la vitrine : des morceaux du corps
 * suivaient les pattes). La regle ci-dessus ne corrige qu'un sommet lie a la fois a un os proche et a un os
 * lointain ; ici TOUS ses os sont loin (18,4 % des sommets de l'araignee : distance ponderee > 12 % de
 * l'etendue ET > 4 x l'os le plus proche). Ces sommets sont relies aux os les plus proches (1/d^2, os a moins
 * de 1,5 x le plus proche). Seulement si au moins 2 % des sommets sont touches : un rig sain n'est pas modifie. */
const SEUIL_PEAU_LOINTAINE = 0.02;
function reaffecterPeauLointaine(sq, pos, jts, wts, prep) {
  const { E, ext } = prep, P0 = sq.P0, J = P0.length;
  const dOs = (x, y, z, a) => {
    const A = P0[a];
    let d = Math.hypot(x - A[0], y - A[1], z - A[2]);
    for (const c of E[a]) {
      const B = P0[c], b0 = B[0] - A[0], b1 = B[1] - A[1], b2 = B[2] - A[2], l2 = b0 * b0 + b1 * b1 + b2 * b2 || 1e-12;
      const t = Math.max(0, Math.min(1, ((x - A[0]) * b0 + (y - A[1]) * b1 + (z - A[2]) * b2) / l2));
      d = Math.min(d, Math.hypot(x - A[0] - t * b0, y - A[1] - t * b1, z - A[2] - t * b2));
    }
    return d;
  };
  const nV = Math.min(pos.length / 3, jts.length / 4, wts.length / 4), dd = new Float64Array(J);
  const a_corriger = [];
  for (let v = 0; v < nV; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    let dPond = 0, s = 0;
    for (let c = 0; c < 4; c++) { const w = wts[v * 4 + c], j = jts[v * 4 + c]; if (w > 0 && j < J) { dPond += w * dOs(x, y, z, j); s += w; } }
    if (!s) continue;
    dPond /= s;
    if (dPond <= 0.12 * ext) continue;
    let dmin = Infinity;
    for (let a = 0; a < J; a++) { dd[a] = dOs(x, y, z, a); if (dd[a] < dmin) dmin = dd[a]; }
    if (dPond <= 4 * dmin) continue;
    const proches = [];
    for (let a = 0; a < J; a++) if (dd[a] <= 1.5 * dmin + 1e-9) proches.push([a, 1 / Math.max(dd[a], 1e-4 * ext) ** 2]);
    proches.sort((u, q) => q[1] - u[1]);
    a_corriger.push([v, proches.slice(0, 4)]);
  }
  if (a_corriger.length < SEUIL_PEAU_LOINTAINE * nV) return 0;
  for (const [v, proches] of a_corriger) {
    const somme = proches.reduce((t, q) => t + q[1], 0);
    for (let c = 0; c < 4; c++) {
      jts[v * 4 + c] = c < proches.length ? proches[c][0] : 0;
      wts[v * 4 + c] = c < proches.length ? proches[c][1] / somme : 0;
    }
  }
  return a_corriger.length;
}
function corrigerPoidsBrut(sq, pos, jts, wts, prep) {
  const { E, ecart, ext } = prep, P0 = sq.P0, J = P0.length;
  const dOs = (x, y, z, j) => {
    const a = P0[j];
    let d = Math.hypot(x - a[0], y - a[1], z - a[2]);
    for (const c of E[j]) {
      const b = P0[c], ab0 = b[0] - a[0], ab1 = b[1] - a[1], ab2 = b[2] - a[2], l2 = ab0 * ab0 + ab1 * ab1 + ab2 * ab2 || 1e-12;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * ab0 + (y - a[1]) * ab1 + (z - a[2]) * ab2) / l2));
      d = Math.min(d, Math.hypot(x - a[0] - t * ab0, y - a[1] - t * ab1, z - a[2] - t * ab2));
    }
    return d;
  };
  const nV = Math.min(pos.length / 3, jts.length / 4, wts.length / 4), dist = [0, 0, 0, 0];
  let n = 0;
  for (let v = 0; v < nV; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    let maison = -1, dm = Infinity;
    for (let c = 0; c < 4; c++) {
      const j = jts[v * 4 + c], w = wts[v * 4 + c];
      if (w <= 0.05 || j >= J) { dist[c] = Infinity; continue; }
      dist[c] = dOs(x, y, z, j);
      if (dist[c] < dm) { dm = dist[c]; maison = c; }
    }
    if (maison < 0) continue;
    const jm = jts[v * 4 + maison];
    let modif = false;
    for (let c = 0; c < 4; c++) {
      const j = jts[v * 4 + c], w = wts[v * 4 + c];
      if (c === maison || w <= 0 || j >= J || j === jm) continue;
      if (dist[c] === Infinity) dist[c] = dOs(x, y, z, j);
      if (dist[c] < 0.05 * ext || dist[c] < 2.5 * dm || ecart(j, jm) < ECART_OS_PEAU) continue;
      wts[v * 4 + maison] += w; wts[v * 4 + c] = 0; modif = true;
    }
    if (modif) n++;
  }
  return n;
}
/** Repare la peau DANS le binaire du GLB (poids flottants), avant l'ecriture des animations. */
function reparerPeauGLB(sq) {
  const { json, bin } = sq, prep = preparerPeau(sq);
  if (!prep || !json.meshes) return 0;
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const lire = (i, nc) => {
    const a = json.accessors[i], bv = json.bufferViews[a.bufferView], sz = { 5126: 4, 5121: 1, 5123: 2 }[a.componentType];
    const off = (bv.byteOffset || 0) + (a.byteOffset || 0), st = bv.byteStride || nc * sz, out = new Float64Array(a.count * nc);
    const r = { 5126: (o) => dv.getFloat32(o, true), 5121: (o) => dv.getUint8(o), 5123: (o) => dv.getUint16(o, true) }[a.componentType];
    for (let k = 0; k < a.count; k++) for (let c = 0; c < nc; c++) out[k * nc + c] = r(off + k * st + c * sz);
    return { out, off, st, a };
  };
  let n = 0;
  for (const m of json.meshes) for (const pr of m.primitives || []) {
    const at = pr.attributes || {};
    if (at.JOINTS_0 == null || at.WEIGHTS_0 == null || at.POSITION == null) continue;
    const W = json.accessors[at.WEIGHTS_0], Pa = json.accessors[at.POSITION];
    if (W.componentType !== 5126 || Pa.componentType !== 5126 || W.sparse || Pa.sparse) continue;   // poids quantifies : on n'y touche pas
    const p = lire(at.POSITION, 3), j = lire(at.JOINTS_0, 4), w = lire(at.WEIGHTS_0, 4);
    const k = corrigerPoidsPeau(sq, p.out, j.out, w.out, prep);
    if (!k) continue;
    n += k;
    for (let v = 0; v < w.a.count; v++) for (let c = 0; c < 4; c++) dv.setFloat32(w.off + v * w.st + c * 4, w.out[v * 4 + c], true);
    // os aussi : la reaffectation des sommets lointains change les os, pas seulement les poids
    const tj = j.a.componentType, szj = tj === 5121 ? 1 : 2;
    for (let v = 0; v < j.a.count; v++) for (let c = 0; c < 4; c++) {
      const val = j.out[v * 4 + c], o = j.off + v * j.st + c * szj;
      if (tj === 5121) dv.setUint8(o, val); else dv.setUint16(o, val, true);
    }
  }
  return n;
}
/** Squelette d'un GLB, pour reparer la peau d'un modele deja charge (apercu three.js). */
export function squeletteDe(glb) { return charger(glb); }

// ------------------------------------------------------------------ point d'entrée
/**
 * @param {ArrayBuffer} glb  GLB riggé (un skin)
 * @param {{allures?: string[], cycles?: number, fps?: number}} options  allures : « walk » ou « walk__sneak » (variante)
 * @returns {{glb: ArrayBuffer, infos: Object<string, object>}}  GLB d'origine + une animation par allure
 */
export function animerGLB(glb, { allures = Object.keys(ALLURES), cycles = 3, fps = 30, mode = 'auto', espece = 'generique' } = {}) {
  const sq = charger(glb);
  const clips = [], infos = {};
  let peau = 0;
  try { peau = reparerPeauGLB(sq); } catch (_) { peau = 0; }   // peau abimee par le rig : lanieres (voir plus haut)
  for (const nom of allures) {
    const { allure: a, variante } = lireClip(nom);
    if (!ALLURES[a]) throw new Error('allure inconnue : ' + a);
    if (!(VARIANTES[a] || {})[variante]) throw new Error('variante inconnue : ' + nom);
    const clip_ = animerAllureSure(sq, a, ALLURES[a].pas ? cycles : 1, fps, variante, mode, espece);   // attente, actions : un cycle
    clips.push(clip_);
    infos[clip_.nom] = clip_.infos;
  }
  for (const k of Object.keys(infos)) infos[k].peau_corrigee = peau;
  return { glb: ecrireGLB(sq, clips, fps), infos };
}

const _cacheSquelettes = new WeakMap();
/**
 * Pistes d'animation SEULES (sans réécrire le GLB), pour un aperçu : même calcul qu'animerGLB.
 * @returns {{clips: Array<{nom, duree, temps, rotations: Array<{noeud, q}>, translation: {noeud, v}}>, infos}}
 */
export function animerPistes(glb, { allures = ['walk'], cycles = 2, fps = 30, mode = 'auto', espece = 'generique' } = {}) {
  let sq = _cacheSquelettes.get(glb);
  if (!sq) { sq = charger(glb); _cacheSquelettes.set(glb, sq); }
  const clips = [], infos = {};
  for (const nom of allures) {
    const { allure: a, variante } = lireClip(nom);
    if (!ALLURES[a] || !(VARIANTES[a] || {})[variante]) throw new Error('allure inconnue : ' + nom);
    const c = animerAllureSure(sq, a, ALLURES[a].pas ? cycles : 1, fps, variante, mode, espece);
    clips.push(pistesLocales(sq, c, fps));
    infos[c.nom] = c.infos;
  }
  return { clips, infos };
}

/** Nombre de pattes detectees (0 = sans pattes) : filtre des animations d'une espece generique. */
export function pattesDuSquelette(glb) {
  const sq = charger(glb);
  return detecterPattes(sq.par, sq.P0, sq.racine).pattes.length;
}

// diagnostic (tests hors appli)
export const __interne = { charger, detecterPattes };
