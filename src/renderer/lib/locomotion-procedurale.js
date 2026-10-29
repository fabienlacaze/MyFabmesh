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
  // boire (26/10) : meme posture que manger pour une creature a pattes (tete a terre) ; sans pattes : courbes dediees (actionSansPattes)
  drink: { beta: 1.0, T: [4.5, 4.5], h: 0.0, bob: 0.006, foulee: 0.0, lacet: 0.0, tendu: 0.93, talon: 0.0, pas: false, action: 'eat', regard: 0.25 },
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
  lie_down_bipede: {   // s'accroupit, s'assoit par terre (pieds plantes, bassin recule jusqu'au sol), puis se couche sur le dos
    // (le tronc bascule en arriere autour du bassin, la tete suit). Avant : un accroupi fige sans sol sous le bassin (planche du 25/10).
    // Schenkman et al. 1990 (Phys Ther 70:638) : tronc penche de 30-40 deg pendant la descente ; le coucher se fait en deux temps (assis, puis dos).
    bob: [[0, 0], [0.2, -0.24], [0.4, -0.46], [0.6, -0.66], [0.78, -0.8], [1, -0.8]],
    avance: [[0, 0], [0.2, -0.2], [0.4, -0.4], [0.58, -0.62], [0.8, -0.7], [1, -0.7]],
    tangage: [[0, 0], [0.2, 0.28], [0.45, 0.2], [0.62, 0.05], [0.82, -0.8], [1, -1.45]],
    torseT: [[0, 0], [0.2, 0.15], [0.5, 0.1], [1, 0]],
    tete: [[0, 0], [0.62, 0], [0.82, -0.8], [1, -1.45]],   // la tete reste droite pendant la descente puis suit le tronc (compense la contre-rotation de la tete)
    bras: [[0, 0], [0.2, 0.8], [0.45, 1.0], [0.7, 0.6], [1, 0.3]], brasSym: true,   // les deux bras en avant pour l'equilibre puis ecartes
  },
  attack: {            // se ramasse (arriere bas, tete en arriere), detente du corps puis de la tete, tient, revient
    avance: [[0, 0], [0.28, -0.10], [0.40, 0.26], [0.50, 0.26], [0.62, 0.15], [1, 0]],
    bob: [[0, 0], [0.2, -0.10], [0.28, -0.12], [0.38, -0.02], [0.46, 0.0], [1, 0]],
    tangage: [[0, 0], [0.28, -0.12], [0.40, 0.18], [0.52, 0.14], [1, 0]],
    tete: [[0, 0], [0.28, -0.55], [0.40, 0.75], [0.52, 0.60], [0.70, 0.20], [1, 0]],
    roulis: [[0, 0], [0.28, 0.04], [0.40, -0.05], [1, 0]],
    // les pattes avant suivent la detente (les arriere poussent, plantees) : sans pas, le corps glissait sur des pieds figes
  },
  attack_felin: {      // coup de patte : arriere ramasse, patte avant droite levee puis lancee en avant et vers le bas, griffes qui ratissent
    avance: [[0, 0], [0.26, -0.08], [0.40, 0.22], [0.56, 0.20], [0.82, 0.04], [1, 0]],
    bob: [[0, 0], [0.22, -0.13], [0.30, -0.15], [0.40, -0.04], [0.56, -0.02], [1, 0]],
    tangage: [[0, 0], [0.26, -0.14], [0.40, 0.18], [0.56, 0.14], [1, 0]],
    roulis: [[0, 0], [0.26, 0.12], [0.40, -0.10], [0.6, -0.04], [1, 0]],
    // 28/10 (defaut Q14) : le tronc se tord (lacet) vers l'epaule qui arme puis vers la cible, l'arriere s'abaisse davantage (poids sur les postérieurs), la tete suit avec ~2 images de retard
    lacetQ: [[0, 0], [0.26, -0.15], [0.40, 0.17], [0.56, 0.10], [0.82, 0.01], [1, 0]],
    tete: [[0, 0], [0.28, -0.34], [0.43, 0.36], [0.62, 0.22], [0.82, 0.05], [1, 0]],
    pieds: {
      AD: { av: [[0, 0], [0.14, 0], [0.26, -0.18], [0.40, 0.45], [0.56, 0.42], [0.84, 0], [1, 0]], lev: [[0, 0], [0.14, 0], [0.26, 0.38], [0.34, 0.52], [0.42, 0.06], [0.56, 0.04], [0.70, 0.2], [0.86, 0], [1, 0]] },
      AG: { av: [[0, 0], [0.3, 0], [0.5, 0.1], [0.9, 0], [1, 0]] },
    },
  },
  attack_ours: {       // se dresse sur l'arriere (tangage cabre), les deux pattes avant frappent vers le bas l'une apres l'autre
    avance: [[0, 0], [0.25, -0.08], [0.45, 0.10], [0.7, 0.08], [1, 0]],
    bob: [[0, 0], [0.25, 0.05], [0.42, 0.08], [0.7, 0.04], [1, 0]],
    tangage: [[0, 0], [0.25, -0.40], [0.42, -0.34], [0.58, -0.30], [0.8, -0.1], [1, 0]],
    tete: [[0, 0], [0.25, -0.2], [0.45, 0.25], [0.7, 0.1], [1, 0]],
    pieds: {
      AD: { av: [[0, 0], [0.2, 0.05], [0.36, 0.25], [0.5, 0.3], [0.8, 0], [1, 0]], lev: [[0, 0], [0.1, 0.1], [0.25, 0.75], [0.34, 0.85], [0.44, 0.3], [0.7, 0.4], [0.86, 0], [1, 0]] },
      AG: { av: [[0, 0], [0.3, 0.05], [0.48, 0.25], [0.6, 0.3], [0.88, 0], [1, 0]], lev: [[0, 0], [0.2, 0.1], [0.38, 0.75], [0.48, 0.85], [0.58, 0.3], [0.78, 0.4], [0.92, 0], [1, 0]] },
    },
  },
  attack_equide: {     // ruade des deux postérieurs : l'avant s'abaisse et la tete se releve, les pieds arriere partent en arriere et en haut
    avance: [[0, 0], [0.3, 0.04], [0.42, 0.06], [0.7, 0.02], [1, 0]],
    bob: [[0, 0], [0.3, 0.02], [0.42, 0.02], [1, 0]],
    tangage: [[0, 0], [0.25, 0.10], [0.40, 0.26], [0.56, 0.24], [0.8, 0.06], [1, 0]],
    tete: [[0, 0], [0.3, -0.25], [0.42, -0.45], [0.6, -0.3], [0.85, -0.05], [1, 0]],
    pieds: { P: { av: [[0, 0], [0.22, 0.04], [0.38, -0.78], [0.5, -0.8], [0.66, -0.3], [0.86, 0], [1, 0]], lev: [[0, 0], [0.22, 0.05], [0.34, 0.2], [0.42, 0.6], [0.52, 0.55], [0.7, 0.2], [0.88, 0], [1, 0]] } },
  },
  attack_bipede: {     // armement (bassin, torse, bras en arriere), frappe en chaine bassin -> torse -> bras
    avance: [[0, 0], [0.28, -0.05], [0.42, 0.14], [0.58, 0.14], [1, 0]],
    bob: [[0, 0], [0.28, -0.05], [0.40, -0.07], [0.5, 0.02], [0.64, -0.01], [1, 0]],   // poussee de la jambe arriere pendant la frappe
    tangage: [[0, 0], [0.28, -0.05], [0.42, 0.10], [0.6, 0.08], [1, 0]],
    lacet: [[0, 0], [0.26, -0.22], [0.38, 0.24], [0.56, 0.20], [1, 0]],
    torse: [[0, 0], [0.30, -0.35], [0.50, 0.46], [0.66, 0.38], [1, 0]],   // suit le bras de ~3 images
    torseT: [[0, 0], [0.28, -0.12], [0.44, 0.28], [0.58, 0.22], [1, 0]],
    lateral: [[0, 0], [0.28, -0.04], [0.42, 0.05], [0.6, 0.04], [1, 0]],
    tete: [[0, 0], [0.3, -0.05], [0.56, 0.14], [0.68, 0.1], [1, 0]],   // ~5 images apres le bras
    bras: [[0, 0], [0.28, -1.25], [0.40, -1.35], [0.58, 1.0], [0.66, 1.12], [0.78, 0.9], [0.9, 0.35], [1, 0]],   // depassement puis retour en ease-out
    // fente : le pied avant (gauche, oppose au bras qui frappe) est leve pendant l'armement et pose devant a la frappe, le pied arriere
    // reste plante (le corps passe dessus) ; tout revient apres la frappe (Marshall et Elliott 2000 : le pas avant precede la rotation du torse)
    pieds: {
      G: { av: [[0, 0], [0.18, 0], [0.38, 0.30], [0.62, 0.30], [0.88, 0.0], [1, 0]], lev: [[0, 0], [0.18, 0], [0.28, 0.16], [0.38, 0.0], [0.62, 0.0], [0.74, 0.12], [0.88, 0.0], [1, 0]] },
      D: { av: [[0, 0], [0.28, -0.04], [0.5, -0.04], [0.88, 0], [1, 0]] },
    },
  },
  hit: {               // recul brusque, tete rejetee, puis oscillations amorties jusqu'au retour
    avance: [[0, 0], [0.07, -0.14], [0.2, -0.02], [0.32, -0.05], [0.5, 0.0], [0.7, -0.01], [1, 0]],
    bob: [[0, 0], [0.08, -0.05], [0.22, 0.01], [0.4, -0.015], [1, 0]],
    tangage: [[0, 0], [0.07, -0.15], [0.2, 0.05], [0.34, -0.04], [0.5, 0.015], [0.7, -0.01], [1, 0]],
    roulis: [[0, 0], [0.07, 0.09], [0.22, -0.05], [0.38, 0.025], [0.6, -0.01], [1, 0]],
    tete: [[0, 0], [0.07, -0.5], [0.2, 0.15], [0.35, -0.1], [0.52, 0.04], [0.75, -0.01], [1, 0]],
  },
  hit_bipede: {        // chaine : bassin (5 %), torse (9 %), tete (15 %), bras en retard ; recul du bassin + genoux qui flechissent, pas de rattrapage, oscillations amorties
    avance: [[0, 0], [0.07, -0.16], [0.18, -0.07], [0.32, -0.09], [0.5, -0.02], [0.75, -0.01], [1, 0]],
    bob: [[0, 0], [0.05, -0.02], [0.12, -0.07], [0.24, -0.03], [0.36, -0.05], [0.55, -0.01], [1, 0]],
    tangage: [[0, 0], [0.05, -0.12], [0.16, 0.08], [0.32, -0.05], [0.5, 0.02], [0.75, -0.01], [1, 0]],
    torseT: [[0, 0], [0.09, -0.40], [0.2, 0.38], [0.34, -0.12], [0.5, 0.05], [0.7, -0.02], [1, 0]],
    torse: [[0, 0], [0.09, 0.40], [0.26, -0.15], [0.45, 0.06], [1, 0]],
    lacet: [[0, 0], [0.06, 0.20], [0.22, -0.08], [1, 0]],
    roulis: [[0, 0], [0.06, 0.10], [0.22, -0.06], [0.4, 0.03], [1, 0]],
    tete: [[0, 0], [0.09, -0.3], [0.15, -0.7], [0.28, 0.35], [0.42, -0.15], [0.6, 0.05], [0.8, -0.01], [1, 0]],
    bras: [[0, 0], [0.1, -0.5], [0.18, -1.0], [0.34, 0.45], [0.5, -0.2], [0.68, 0.06], [1, 0]],
    pieds: { D: { av: [[0, 0], [0.06, 0], [0.24, -0.30], [0.6, -0.30], [0.84, 0], [1, 0]], lev: [[0, 0], [0.06, 0], [0.15, 0.14], [0.24, 0.0], [0.6, 0.0], [0.72, 0.1], [0.84, 0], [1, 0]] } },
  },
};
// Variantes QUADRUPEDES (pieds qui bougent) : choisies par animerAllure (« _<famille> » puis « _quad »). Gardees a part pour que les
// creatures a pattes courtes ou nombreuses (tortue, araignee, crabe) gardent le calcul d'origine (pieds plantes, corps abaisse).
COURBES_ACTIONS.lie_down_quad = {
  ...COURBES_ACTIONS.lie_down,
  // avant : les pieds glissent sous la poitrine (carpes au sol) ; arriere : les jarrets se replient, pieds vers l'avant (Lidfors 1989)
  pieds: { A: { av: [[0, 0], [0.12, 0], [0.5, -0.5], [1, -0.5]] }, P: { av: [[0, 0], [0.35, 0], [0.8, 0.38], [1, 0.4]], pit: [[0, 0], [0.35, 0], [0.8, 1.4], [1, 1.45]] } },
  queue: [[0, 0], [0.4, 0.4], [0.8, 1.5], [1, 1.7]],
};
// Manger, quadrupedes : le museau doit ATTEINDRE le sol (la tete de la Mule s'arretait a 0,45 de la hauteur : « broute en l'air »). Cou plus plie
// (tete x 1,7), avant plus bas (tangage x 1,6), un antérieur avance et l'autre recule (pose de brouteur : la jambe avant porte le cou qui
// descend, Rubenson et al. 2004 ne decrivent pas le cas ; reglage a l'oeil). L'attenuation d'amplitude automatique bute sur le sol : le museau
// s'arrete donc au contact au lieu d'entrer dedans.
const _mult = (c, m) => c.map(([u, v, ...r]) => [u, v * m, ...r]);
COURBES_ACTIONS.eat_quad = {
  ...COURBES_ACTIONS.eat,
  tangage: _mult(COURBES_ACTIONS.eat.tangage, 1.6), bob: _mult(COURBES_ACTIONS.eat.bob, 1.3), tete: _mult(COURBES_ACTIONS.eat.tete, 1.7),
  pieds: {
    AG: { av: [[0, 0], [0.04, 0], [0.24, 0.2], [0.84, 0.2], [1, 0]], lev: [[0, 0], [0.04, 0], [0.12, 0.1], [0.24, 0], [0.76, 0], [0.86, 0.08], [1, 0]] },
    AD: { av: [[0, 0], [0.04, 0], [0.24, -0.1], [0.84, -0.1], [1, 0]] },
  },
};
COURBES_ACTIONS.attack_quad = {
  ...COURBES_ACTIONS.attack,
  pieds: { A: { av: [[0, 0], [0.30, 0], [0.44, 0.2], [0.64, 0.2], [0.92, 0], [1, 0]], lev: [[0, 0], [0.30, 0], [0.37, 0.12], [0.44, 0], [0.64, 0], [0.74, 0.1], [0.92, 0], [1, 0]] } },
};
// Bras d'un bipede qui SAUTE (rad, + = bras vers l'avant / le haut), sur le cycle accroupi -> poussee -> vol -> reception : les bras partent
// derriere pendant l'elan (extension de l'epaule ~30 deg), puis montent vivement a la poussee (~75-80 deg au decollage, plus de 100 deg en
// vol), et redescendent pour la reception. Un saut sans bras qui poussent perd 10 a 20 % de hauteur (Lees, Vanrenterghem & De Clercq 2004,
// J Biomech 37 : le balancier des bras augmente la hauteur d'environ 10 %).
const BRAS_SAUT = [[0, 0.2], [0.2, -0.55], [0.4, 0.75], [0.58, 1.55], [0.8, 0.7], [1, 0.2]];
/** Membre replie sur le sol (se coucher) : le calcul par forme unique enfonce les articulations du milieu sous le sol quand la
 *  hanche est tres basse. Passes FABRIK (base et bout fixes, longueurs des os conservees) qui releve toute articulation interieure
 *  descendue sous ymin ; rend Q tel quel si rien ne passe sous le sol (aucune regression pour les autres cas). */
function relever(Q, ymin) {
  const n = Q.length;
  if (n < 3 || !Q.slice(1, -1).some((q) => q[1] < ymin)) return Q;
  const L = [];
  for (let k = 0; k < n - 1; k++) L.push(norm(sub(Q[k + 1], Q[k])));
  const base = Q[0], fin = Q[n - 1];
  const P = Q.map((q) => q.slice());
  const cale = (a, b, l) => { const d = sub(a, b); return add(b, mulS(d, l / (norm(d) + 1e-12))); };
  for (let it = 0; it < 30; it++) {
    P[n - 1] = fin.slice();
    for (let k = n - 2; k >= 1; k--) { P[k] = cale(P[k], P[k + 1], L[k]); if (P[k][1] < ymin) P[k][1] = ymin; }
    P[0] = base.slice();
    for (let k = 1; k < n - 1; k++) { P[k] = cale(P[k], P[k - 1], L[k - 1]); if (P[k][1] < ymin) P[k][1] = ymin; }
  }
  P[0] = base.slice();
  for (let k = 1; k < n; k++) P[k] = cale(k === n - 1 ? fin : P[k], P[k - 1], L[k - 1]);   // dernier passage : longueurs exactes
  return P;
}
/** Courbes de pied d'une action pour une patte (voir C.pieds) : « AG » > « A » > « G », sinon aucune. */
function pasPied(C, p) {
  const T_ = C && C.pieds;
  if (!T_) return null;
  const AP = p.rang === 0 ? 'A' : 'P', GD = p.cote === 1 ? 'G' : 'D';
  return T_[AP + GD] || T_[AP] || T_[GD] || null;
}
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
  drink: { normal: {} },
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
// BIPEDES, 2e tour (26/10, regard sur planches de rendu, pas seulement des chiffres) :
//  - marche humaine : foulee 0,58 -> 0,82 hauteur du corps (1,02 -> 1,44 m pour 1,75 m), v/H 0,56 -> 0,75 (~1,3 m/s), cadence 116 -> 109 pas/min
//    (Perry & Burnfield 2010 : ~110 pas/min, ~1,3-1,4 m/s ; valeur de memoire). Leviers : tendu 0,965 -> 0,92 et bob x1,4 (le bassin plonge plus
//    a la pose du pied, ce qui autorise un pas plus long sans tendre la jambe au-dela de sa longueur) ;
//  - course du primate (189 -> 164 pas/min) et du dinosaure (189 -> 157) : cadence trop haute pour la taille (les grands animaux ont une frequence de
//    pas plus basse, Heglund & Taylor 1988 JEB 138 pour la tendance generale ; valeurs choisies a l'oeil, a verifier) ; manchot : course 360 -> 212 pas/min ;
//  - manchot : le buste n'annule plus le roulis du bassin (contre-roulis 15 % au lieu de 100 %) : le corps entier se dandine, comme sur les
//    films de manchots (Griffin & Kram 2000 : roulis du corps entier) ; foulee 0,45 -> 0,6 ;
//  - oiseau : les ailes bougent ensemble, deux fois par cycle, a demi-amplitude (elles balancaient en opposition comme des bras humains) ;
//  - kangourou rapide : buste penche de 0,3 rad. Frequence de bonds laissee a ~1,6/s : le reel est ~2/s quasi constant (Dawson & Taylor 1973,
//    Nature 246, constat qualitatif retrouve en ligne ; le chiffre 2,1 de Alexander & Vernon 1975 n'a PAS pu etre reverifie) mais raccourcir la
//    periode a 30 images/s fait monter les a-coups mesures (12,7 -> 16 deg).
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
    walk: { motif: 'lateral', T: 1.0, h: 0.9, hoche: 0.1, ondulation: 0.07 },
    // repos (26/10) : respiration lente ~0,2 Hz (cheval au repos 8-16 cycles/min, Hoyt/Taylor 1981 ; ici T 5,4 s -> bob 2 fois par T = 0,37 Hz, plus lisible a l'ecran), queue qui chasse les mouches
    idle: { T: 2.2, bob: 2.2, queue: 1.7, regard: 0.7 },
    jump: { decalage: 0.07, h: 1.25, T: 1.1 },
    // trot (26/10) : deux temps diagonaux, suspension ; genou haut (action du genou), tete et dos quasi immobiles (Hildebrand 1965 ; Heglund & Taylor 1988 : 1,2-2,2 foulees/s)
    trot: { motif: 'trot', T: 1.1, h: 1.25, bob: 0.85, hoche: 0.03, tangage: 0.02, tendu: 0.93, talon: 0.4, leve: 0.8 },
    // galop (25/10, « on dirait la demarche d'un chien ») : jambes presque tendues (tendu 0.9 -> 0.97), corps plus haut et plus plat (bob 1.2 -> 0.8), cadence plus lente,
    // grand balancement de tete et d'encolure (hoche 0.22 -> 0.32 -> 0.85 le 25/10 apres rendu de la planche : la tete restait figee ; tangage 0.12, bob 0.9)
    run: { motif: 'transverse', beta: 0.3, T: 0.9, foulee: 1.6, h: 1.1, bob: 0.9, tangage: 0.12, hoche: 0.3, flexion: 0.03, tendu: 0.9, leve: 0.65 },
  },
  felin: {         // lion, tigre, chat : marche basse et souple, galop bondissant (dos plie/deplie)
    walk: { motif: 'lateral', T: 1.1, h: 0.75, bob: 0.6, tendu: 0.93, tete: 0.1, hoche: 0.015, flexion: 0.03, ondulation: 0.08 },
    // galop rotatif (26/10 ; tendu 0.82 -> 0.9 le 25/10 apres relecture : 5 % d'os sous le sol sur Mule / Phacochere) : foulee ~3,5 hauteurs de garrot, 2 suspensions (rassemblee + etendue), colonne qui se plie et se deplie
    // (Hildebrand 1959 ; Hudson, Corr & Wilson 2012, JEB 215:2425 : guepard 2,4 -> 3,2 foulees/s), pattes bien repliees au decollage
    run: { motif: 'rotatif', beta: 0.27, T: 0.9, foulee: 1.5, h: 1.1, bob: 1.4, tangage: 0.06, hoche: 0.02, tete: 0.06, flexion: 0.34, teteStab: 0.7, tendu: 0.9, leve: 0.65 },
    idle: { T: 2.0, bob: 1.8, queue: 2.0, regard: 1.2 },
    jump: { decalage: 0.08, h: 1.3 },
  },
  canide: {        // chien, loup, renard
    walk: { motif: 'lateral', hoche: 0.03, ondulation: 0.07 },
    // galop du chien (26/10) : ~2,5-3 foulees/s (greyhound ~3,5 : Hudson 2012), foulee 3-4 hauteurs, dos bien plie
    run: { motif: 'rotatif', beta: 0.28, T: 0.88, foulee: 1.4, h: 1.1, bob: 1.3, tangage: 0.07, hoche: 0.05, flexion: 0.3, teteStab: 0.7, tendu: 0.9, leve: 0.65 },
    trot: { motif: 'trot', T: 1.0, h: 1.1, bob: 0.9, hoche: 0.03, tendu: 0.86, leve: 0.8 },
    idle: { T: 2.0, bob: 2.0, queue: 2.2, regard: 1.4 },
    jump: { decalage: 0.08, h: 1.2 },
  },
  bovin: {         // vache, boeuf, chevre, cochon : pas lourd, tete basse, galop pataud
    walk: { motif: 'lateral', T: 1.2, h: 0.75, bob: 1.3, hoche: 0.05, tete: 0.08, ondulation: 0.06 },
    run: { motif: 'transverse', beta: 0.36, T: 1.1, foulee: 0.85, bob: 1.8, tangage: 0.07, hoche: 0.07, flexion: 0.05, tete: 0.1 },
    trot: { motif: 'trot', T: 1.05, h: 1.0, bob: 1.0, hoche: 0.04, tete: 0.08, leve: 0.8 },
    idle: { T: 2.4, bob: 2.4, queue: 1.6, regard: 0.5, tete: 0.08 },
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
    walk: { motif: 'lateral', beta: 0.8, T: 1.9, foulee: 0.5, h: 0.6, bob: 0.4, hoche: 0.06, roulis: 0.02 },
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
    walk: { T: 1.0, bras: 1.0, attaque: 0.28, bob: 1.0, lateral: 0.026, levee: 1, h: 0.7, tendu: 0.92 },
    // course (25/10, « la course ressemble a une marche sur place ») : foulee 6 fois plus courte que la marche -> 2,1 hauteurs de hanche ;
    // cadence ~156 pas/min (T 0,77 s), jambe plus pliee au milieu de l'appui (tendu), phase aerienne, attaque du talon
    run: { T: 1.25, bras: 1.15, h: 1.3, bob: 1.2, beta: 0.33, attaque: 0.17, tendu: 0.9, lateral: 0.02 },
  },
  primate: {       // singe, gorille : genoux plies, gros balancement des bras, roule des epaules
    idle: { T: 1.5 },
    // marche bipede du chimpanze : « hanches et genoux flechis » (Elftman & Manter 1935 ; Pontzer 2009) -> genou ~35 deg en milieu d'appui
    // (tendu 0,9), tronc penche d'environ 17 deg, bassin qui roule beaucoup, pas courts et frequents
    walk: { T: 0.85, h: 0.9, tendu: 0.9, bras: 1.6, tete: 0.1, roulis: 0.08, tronc: 0.3, lateral: 0.05, attaque: 0.12, bob: 0.9 },
    run: { T: 1.2, tendu: 0.85, bras: 1.4, tronc: 0.35, h: 1.2, lateral: 0.04, attaque: 0.08 },
  },
  dinosaure: {     // T-rex, raptor : pas lourd, tete qui balance, queue en balancier, petits bras immobiles
    idle: { T: 1.5 },
    walk: { T: 1.25, h: 0.9, bob: 1.3, hoche: 0.06, bras: 0.2, queue: 1.8, tendu: 0.93 },
    run: { T: 1.25, bras: 0.15, queue: 1.5, hoche: 0.08, h: 1.2, bob: 1.2 },
  },
  kangourou: {     // bipede qui avance par BONDS, les deux pattes ensemble
    idle: { T: 1.5 },
    // rebond du kangourou roux : ~2,1 bonds / s a 3 m/s (Alexander & Vernon 1975, J Zool 177) -> periode 0,5-0,7 s, et une hauteur de vol
    // petite devant la longueur du pas (le centre de masse monte de ~10-15 cm seulement) : sautH 0,3 -> 0,14 de la hauteur de hanche
    walk: { saut: true, T: 0.7, h: 0.8, foulee: 0.7, sautH: 0.14 },
    run: { saut: true, T: 1.0, h: 1.2, foulee: 1.2, sautH: 0.18, tronc: 0.3 },
  },
  manchot: {       // se dandine : petits pas, gros roulis, ailerons presque immobiles
    idle: { T: 1.5 },
    // dandinement : le centre de masse passe d'un pied a l'autre (translation laterale ~ 1/10 de la hauteur de hanche) avec un roulis de
    // +/- 8 a 10 deg (Griffin & Kram 2000, Nature 408 « Penguin waddling is not wasteful »)
    walk: { T: 0.6, foulee: 0.6, h: 0.45, roulis: 0.14, bras: 0.35, tete: -0.05, lateral: 0.055 },
    run: { T: 0.9, foulee: 0.6, roulis: 0.12, bras: 0.4 },
  },
  grenouille: {    // quadrupede qui avance par BONDS
    // 25/10 : bond a 3 temps (accroupie / poussee / vol, voir « bond » dans animerAllure), museau qui monte au
    // decollage (Nauwelaerts & Aerts 2003 ; Zug 1972 : ~30-40 deg), temps de contact ~35 % du cycle (poussee
    // des pattes arriere ~0,1-0,15 s pour un vol de 0,2-0,3 s, Nauwelaerts & Aerts 2006)
    walk: { saut: true, releveGenou: true, cuisseMobile: true, decalage: 0.04, bond: { creux: 0.3, pitch: 0.4 }, beta: 0.38, T: 0.9, foulee: 1.4, h: 1.0, piedPlat: true, cycleEntier: true },
    run: { saut: true, releveGenou: true, cuisseMobile: true, decalage: 0.04, bond: { creux: 0.35, pitch: 0.55 }, beta: 0.3, T: 0.95, foulee: 1.6, h: 1.4, piedPlat: true, cycleEntier: true },
    jump: { saut: true, releveGenou: true, cuisseMobile: true, decalage: 0.04, bond: { creux: 0.4, pitch: 0.6 }, beta: 0.32, T: 0.9, foulee: 2.0, h: 1.4, piedPlat: true, cycleEntier: true },
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
  // -1 : les deux joints sont dans des arbres SEPARES (squelette a plusieurs racines : jambes, queue, oreilles non reliees au tronc, rig du Pikachu du 25/10)
  const ancetre = (a, b) => { const ca = chemin(a), cb = chemin(b); let k = 0; while (k < Math.min(ca.length, cb.length) && ca[k] === cb[k]) k++; return k === 0 ? -1 : ca[k - 1]; };

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
      if (a < 0) return false;                                  // racines separees : deux pieds de pattes differentes, jamais le meme pied
      // (le bassin / la racine n'est JAMAIS une cheville : un personnage au bassin tres bas, le Pikachu a 18 % de sa hauteur, fusionnait ses deux pieds et ses mains en un seul « pied »)
      if (a !== racine && P0[a][1] - sol < 0.2 * H && norm(sub(P0[j], P0[g_[0]])) < 0.4 * ext) return true;   // meme seuil que « au sol »
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
function resoudreForme(F, base, cible, poleMonde, plieMax = 0.9) {
  const d = norm(sub(cible, base));
  // pas d'autre plafond que 0,9 pi sur la plus forte pliure : une jambe DROITE au repos (pliure
  // conventionnelle de 0,08) plafonnait à k = 8, genou à 73° ; accroupie (« crawl ») elle ne
  // pouvait plus se replier et enfonçait le pied de 4 % sous le sol (28/09)
  // 28/10 (defaut cheval-jump-torsion) : en locomotion (A.pas, hors patte etalee) l'appelant passe plieMax = 0,6 (108 deg) au lieu de 0,9 pi (162 deg) ; accroupi / couche : 0,9. Une jambe presque droite au repos (mule) a un phi
  // minuscule : k montait si haut que la pliure d'une seule articulation atteignait 146 deg (chevilles repliees sur elles-memes) quand le pied remonte vers la hanche
  // au saut ; la torsion mesuree montait a 173 deg et les a-coups a 147 deg. Une articulation d'animal ne se plie guere au-dela de ~110 deg.
  let kmax = plieMax * Math.PI / Math.max(Math.max(...F.phi.map(Math.abs)), 1e-3);
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
/** Fait tourner (en place) les articulations INTERMEDIAIRES de la chaine Q autour de l'axe Q[0] -> Q[fin], du plus petit angle qui les
 *  met toutes a une hauteur >= ymin. Les deux extremites ne bougent pas. Sans effet si rien n'est sous ymin. */
function relevePlan(Q, ymin) {
  const bas = (q) => Math.min(...q.slice(1, -1).map((p) => p[1]));
  if (bas(Q) >= ymin) return;
  const a = Q[0], axe = sub(Q[Q.length - 1], a);
  if (norm(axe) < 1e-9) return;
  const tourne = (ang) => { const R = rotvec(axe, ang); return Q.map((p, k) => (k === 0 || k === Q.length - 1 ? p : add(a, mv(R, sub(p, a))))); };
  let meilleur = null, bestAng = 0;
  for (let n = 1; n <= 40 && !meilleur; n++) for (const sg of [1, -1]) {
    const q = tourne(sg * n * 0.05 * Math.PI);
    if (bas(q) >= ymin) { meilleur = q; bestAng = sg * n; break; }
  }
  if (!meilleur) {                                                // aucun angle ne suffit : prendre le plus haut
    let best = -1e9;
    for (let n = -40; n <= 40; n++) { const q = tourne(n * 0.05 * Math.PI); const b = bas(q); if (b > best) { best = b; meilleur = q; } }
  }
  for (let k = 1; k < Q.length - 1; k++) Q[k] = meilleur[k];
}
// fin de balancier (bipede, 28/10) : le pied approchait du sol bien avant d'arriver (la levee retombe a 62 % du balancier alors que 32 % de la foulee reste a parcourir) et RASAIT le sol sur ~un tiers de pas.
// Un terme proportionnel a la distance restante (1 - e) garde le pied decolle jusqu'a ce qu'il soit presque pose ; il s'etablit entre 45 % et 65 % du balancier.
const lisseFin = (u) => { const x = Math.min(Math.max((u - 0.45) / 0.2, 0), 1); return x * x * (3 - 2 * x); };
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
    teteStab: Pr.teteStab || 0,
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
    if (!debout && ch.length >= 4 && !Pr.cuisseMobile) {   // cuisseMobile (grenouille) : la cuisse plie aussi (patte en Z, 3 os qui travaillent)
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
    p.axeDeroule = null;
    if (!debout && !bipede && globalThis.__deroulePiedLibre !== false) {
      const ho = [p.piedOff[0], 0, p.piedOff[2]], hl = norm(ho);
      if (hl > 0.2 * norm(p.piedOff) && hl > 1e-9) { const ax = cross([0, 1, 0], mulS(ho, 1 / hl)); p.axeDeroule = mulS(ax, 1 / (norm(ax) + 1e-12)); }
    }
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
  const h = A.h * (B.recul && droit ? 1.2 : 1) * (0.5 * portee + 0.5 * hanche);   // marche arriere de bipede : pied leve plus haut (le pied rasait le sol et patinait)
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
  // REPOS VIVANT du quadrupede (28/10, defaut Q5 : « quasi fige puis boucle parfaitement periodique, respiration = translation de tout le corps »). Le clip
  // dure plus longtemps (8-10 s), la respiration passe par le tronc (tangage ~0,6 deg) avec un bob reduit, le poids se transfere lentement d'un cote
  // a l'autre (roulis ~2 deg + decalage lateral ~1,5 % H + lacet du bassin), la tete tourne puis revient (evenement), un coup de queue evenementiel.
  // Evenements a instants fixes (deterministes), harmoniques ENTIERES de la periode : la boucle reste fermee.
  const famMammifere = ['equide', 'felin', 'canide', 'bovin', 'pachyderme', 'ours', 'camelide', 'bondissant'].includes(famille);   // reptile, tortue, grenouille : calcul d'origine
  const vivant = quadrupede && famMammifere && !A.pas && !B.action && Object.keys(Pr).length > 0 && globalThis.__reposVivant !== false;
  const evt = (x, c, w) => { const d = (((x - c + 0.5) % 1) + 1) % 1 - 0.5; return Math.exp(-((d / w) ** 2)); };
  for (let i = 0; i < nT; i++) {
    const x = t[i] / T, onde2 = Math.cos(4 * Math.PI * (x - (beta / 2 - p0)));
    if (!A.pas && bipede && !B.action) {
      // ATTENTE d'un bipede : le poids passe d'une jambe a l'autre (1 transfert par periode : bassin qui glisse de ~2 cm
      // et s'incline de ~2 deg du cote de la jambe libre, cf. Winter 1995 « Human balance and posture control » : oscillation
      // lente du centre de pression de 1-2 cm), la poitrine respire (2 cycles par periode, ~0,3 Hz au repos, 12-20 / min).
      const kv = Math.min(A.bob / 0.008, 1.6);
      // 2e tour (27/10) : trois composantes a 1, 2 et 3 cycles par periode (periodes entieres : la boucle se ferme), phases distinctes,
      // pour que le repos ne soit plus une seule sinusoide qui boucle a l'identique
      bob.push(0.003 * hanche * kv * Math.sin(4 * Math.PI * x + 0.4) + 0.0015 * hanche * kv * Math.sin(6 * Math.PI * x + 2.1));
      tangage.push(0.008 * Math.sin(4 * Math.PI * x + 0.9) + 0.006 * Math.sin(6 * Math.PI * x + 2.2));
      roulis.push(0.034 * kv * Math.sin(2 * Math.PI * x) + 0.014 * kv * Math.sin(6 * Math.PI * x + 1.7));
      lateral.push(0.02 * hanche * kv * Math.sin(2 * Math.PI * x) + 0.007 * hanche * kv * Math.sin(6 * Math.PI * x + 0.3));
    } else if (vivant) {
      const transfert = Math.sin(2 * Math.PI * x + 1.0) + 0.35 * Math.sin(2 * Math.PI * 3 * x + 0.4);
      bob.push(0.4 * A.bob * hanche * Math.sin(4 * Math.PI * x));
      tangage.push(0.011 * Math.sin(4 * Math.PI * x + 0.9) + 0.006 * Math.sin(2 * Math.PI * x + 2.0));
      roulis.push(0.026 * transfert); lateral.push(0.012 * hanche * transfert);
      lacetBassin[i] = 0.018 * Math.sin(2 * Math.PI * x + 2.2) + 0.012 * evt(x, 0.3, 0.05) - 0.01 * evt(x, 0.64, 0.05);
    } else if (!A.pas) {
      bob.push(A.bob * hanche * (allure === 'idle' ? 0.35 : 1) * Math.sin(4 * Math.PI * x)); tangage.push(0.01 * Math.sin(2 * Math.PI * x));   // repos : le souffle est au thorax (ajouterFinesse), la racine ne pompe plus
      roulis.push(0.012 * Math.sin(2 * Math.PI * x + 1.0)); lateral.push(0.015 * hanche * Math.sin(2 * Math.PI * x + 1.0));
    } else {
      bob.push(A.bob * hanche * (genre !== 'run' ? onde2 : -onde2));
      // course bipede : buste penche vers l'avant (~8 degres ; 3 avant, user 29/09 « pas realiste »)
      tangage.push((bipede ? A.tronc ?? (genre === 'run' ? 0.14 : B.recul && droit ? 0.05 : 0.0) : 0.0) + 0.02 * Math.sin(4 * Math.PI * x));
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
      if (!A.pas && !B.action) lacetBassin[i] = Math.min(A.bob / 0.008, 1.6) * (0.025 * Math.sin(2 * Math.PI * x + 0.8) + 0.012 * Math.sin(6 * Math.PI * x + 2.0));   // attente : le bassin pivote un peu avec le transfert
      if (A.pas && !SAUT) {                                 // saut : les deux jambes poussent ENSEMBLE, bassin droit
        lacetBassin[i] = -amp[0] * sG[i];
        roulis[i] = amp[1] * Math.cos(2 * Math.PI * (x + gauche.phase - beta / 2));
        lateral[i] = A.lateral * hanche * Math.cos(2 * Math.PI * (x + gauche.phase - beta / 2));
      }
    }
  }
  if (bipede && droit && tourne) for (let i = 0; i < nT; i++) roulis[i] -= 0.12 * A.lacet;   // virage : le tronc penche vers l'interieur (0,12 x lacet)
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
      else if (quadrupede && famMammifere && !SAUT && A.pas && !B.recul && globalThis.__corpsQuadrupede !== false) {
        // 28/10 (defaut Q4 : « un bloc rigide qui monte et descend ») : le tronc se penche vers les appuis (roulis cale sur la charge des pattes gauche /
        // droite, au lieu d'une sinusoide fixe de 0,7 deg), le centre de masse se decale vers le cote porteur (~1-2 % H) et le poids passe de
        // l'avant a l'arriere (tangage ~1,5 deg) ; amplitudes reduites aux allures rapides (la suspension domine).
        if (allure === 'walk') {
          roulis[i] = 0.05 * (sG_[i] - sD_[i]);
          lateral[i] = 0.022 * hanche * (sG_[i] - sD_[i]);
          if (!A.tangage) tangage[i] = 0.035 * (sA[i] - sP[i]);
        }
      }
    }
  }
  // Fort hochement de tete (galop : hoche > 0,2) : nodP vient des APPUIS des pattes avant, donc en impulsions (zero hors appui, pic a l'appui) ; multiplie par
  // hoche il donnait un COUP de tete a chaque foulee (retour du user, 25/10). La tete et l'encolure ont une inertie : on lisse le signal (3 passes de moyenne
  // glissante circulaire, ecart ~0,09 cycle), on le RETARDE de 0,06 cycle (la tete suit l'epaule, elle ne la precede pas), puis on le remet a -1..1.
  if (A.hoche != null && A.hoche > 0.2 && A.pas) {
    const Lc = Math.max(8, Math.round(T * fps)), n = nodP.length;
    const larg = Math.max(3, (Math.round(0.16 * Lc) | 1));
    let sig = nodP.slice();
    for (let pass = 0; pass < 3; pass++) {
      const out = new Array(n).fill(0), demi = (larg - 1) / 2;
      for (let i = 0; i < n; i++) { let s_ = 0; for (let k = -demi; k <= demi; k++) s_ += sig[(((i + k) % n) + n) % n]; out[i] = s_ / larg; }
      sig = out;
    }
    const retard = Math.round(0.06 * Lc), dec = new Array(n);
    for (let i = 0; i < n; i++) dec[i] = sig[(((i - retard) % n) + n) % n];
    const amp = Math.max(...dec.map(Math.abs), 1e-6);
    for (let i = 0; i < n; i++) nodP[i] = dec[i] / amp;
  }
  if (pattes.every((p) => p.ik.length < 3)) for (let i = 0; i < nT; i++) bob[i] = 0;   // pieds rigides : pas de bob
  // --- saut : accroupi pendant l'appui, parabole en l'air (toutes les pattes ensemble)
  // Saut (action « jump », 25/10) : l'appui n'est plus une seule creche. Reception : absorption (genoux
  // ~100 ms apres le toucher : Devita et Skelly 1992, Med Sci Sports Exerc 24:108), remontee, puis
  // CONTRE-MOUVEMENT (creche plus profonde juste avant la poussee : Bobbert et al. 1996, Med Sci Sports
  // Exerc 28:1402), detente explosive, vol PARABOLIQUE (gravite) ; le tronc se penche dans la creche.
  // Les cles « virtuelles » hors de [0, 1] imposent la vitesse verticale d'envol et de reception : la
  // vitesse du corps est continue entre l'appui et le vol (pas d'a-coup au decollage).
  const SAUT_Q = globalThis.__sautQ ?? 0.5;
  const COURBES_SAUT = {
    bob: [[-0.2, 0.154], [0, 0], [0.2, -0.11], [0.38, -0.05], [0.6, -0.18], [1, 0], [1.2, 0.154]],
    tangage: [[0, 0.03], [0.2, 0.06], [0.4, 0.0], [0.6, 0.09], [1, -0.03]],
    bras: [[0, 0.5], [0.15, 0.2], [0.4, -0.5], [1, 0.7]],               // bras : en arriere dans la creche, projetes vers l'avant et le haut a la poussee
    brasVol: [[0, 0.7], [0.3, 1.5], [0.7, 1.2], [1, 0.5]],     // bras montes en vol, retombent a la reception
  };
  let brasSaut = null, sautQ = null;
  if (SAUT && Pr.bond) {
    // grenouille (25/10) : accroupie, poussee (le corps se releve, le museau monte), vol (museau haut au decollage,
    // puis bas a la reception : Nauwelaerts & Aerts 2003 ; Zug 1972 ; l'angle du corps au decollage ~30-40 deg),
    // reception amortie. Le tangage est continu d'un saut a l'autre (fin de vol = debut d'appui).
    const { creux, pitch } = Pr.bond, lis = (x) => x * x * (3 - 2 * x);
    const phArr = (pattes.find((q) => q.rang !== 0) || pattes[0]).phase;
    for (let i = 0; i < nT; i++) {
      const b0 = pattes[0].beta, f = ((t[i] / T + phArr) % 1 + 1) % 1;       // le corps suit les pattes ARRIERE (celles qui poussent)
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
      // montee du centre de masse au-dessus de la hanche : 0,3 -> SAUT_Q (26/10, 2e passe : le saut de la mule ne montait que de 0,07 pour une hauteur totale de 0,30, soit 25 % ;
      // un saut sur place de mammifere quadrupede eleve le centre de masse d'environ la moitie de la hauteur de hanche : chien / chat 0,4-0,6 (Alexander 2003, Principles of Animal Locomotion, ch. 3)
      const sautH_ = Pr.sautH ?? (quadrupede && famMammifere && globalThis.__sautQuadrupede !== false ? SAUT_Q : 0.3);
      bob[i] = f < b0 ? -0.12 * hanche * Math.sin(Math.PI * f / b0) : sautH_ * hanche * (V.h || 1) * Math.sin(Math.PI * (f - b0) / (1 - b0));
      if (quadrupede && famMammifere && Object.keys(Pr).length && globalThis.__corpsQuadrupede !== false) {
        // 28/10 (defaut Q6 : « translation verticale d'un corps horizontal ») : creche (arriere qui s'enfonce), CABRAGE au decollage (nez haut ~18 deg),
        // corps a plat au sommet, NEZ BAS a la reception (~16 deg) puis absorption ; le tangage est continu d'un saut a l'autre (fin de vol = debut d'appui)
        const g_ = f / b0, x_ = (f - b0) / (1 - b0);
        const up_ = 0.36, dn_ = 0.10;                    // cabrage 0,36 rad au decollage, nez bas 0,10 rad a la reception (plus : l'avant-main ne peut plus se replier, chevilles sous le sol)
        const base_ = f < b0 ? cles(g_, [[0, dn_], [0.45, -0.05], [1, -up_]]) : cles(x_, [[0, -up_], [0.5, 0], [1, dn_]]);
        tangage[i] = base_;
        if (!sautQ) sautQ = new Array(nT).fill(0);
        sautQ[i] = base_;
        continue;
      }
      tangage[i] = (A.tronc ?? 0) + (f < b0 ? -0.06 * Math.sin(Math.PI * f / b0) : 0.04 * Math.sin(2 * Math.PI * (f - b0) / (1 - b0)));   // tronc : buste penche (kangourou rapide)
    }
  }
  if (sautQ) {                                                // adoucit le sommet en V du tangage (a-coups) : moyenne glissante circulaire, 2 passes (la boucle est periodique)
    const Lc_ = Math.max(8, Math.round(T * fps)), larg_ = Math.max(3, (Math.round(0.25 * Lc_) | 1)), dm_ = (larg_ - 1) / 2;
    for (let pass = 0; pass < 2; pass++) {
      const out_ = new Array(nT).fill(0);
      for (let i = 0; i < nT; i++) { let sm_ = 0; for (let k = -dm_; k <= dm_; k++) sm_ += sautQ[(((i + k) % nT) + nT) % nT]; out_[i] = sm_ / larg_; }
      sautQ = out_;
    }
    for (let i = 0; i < nT; i++) tangage[i] = sautQ[i];
    // la montee du corps change de vitesse d'un coup au decollage (sinusoide de creche -> sinusoide de vol, 2,3 fois plus rapide avec SAUT_Q = 0,5) : la queue, entrainee par
    // l'acceleration du pivot, claquait (a-coup de 19,6 -> 33,5 deg). Moyenne glissante circulaire de 12 % du cycle, 2 passes : la vitesse monte en rampe sur ~0,1 s.
    if (globalThis.__sautQuadrupede !== false) {
      const lb_ = Math.max(3, (Math.round(0.12 * Lc_) | 1)), db_ = (lb_ - 1) / 2;
      for (let pass = 0; pass < 2; pass++) {
        const src_ = bob.slice();
        for (let i = 0; i < nT; i++) { let sm_ = 0; for (let k = -db_; k <= db_; k++) sm_ += src_[(((i + k) % nT) + nT) % nT]; bob[i] = sm_ / lb_; }
      }
    }
  }
  // --- actions (pieds plantes) : corps, tete et bras suivent les courbes ; V.ampleur les amplifie
  const avance = new Array(nT).fill(0), teteT = new Array(nT).fill(0), brasT = new Array(nT).fill(0);
  const torseL = new Array(nT).fill(0), torseP = new Array(nT).fill(0);       // torse (bipedes) : lacet et penche, en plus du bassin
  const C = B.action ? (droit && COURBES_ACTIONS[B.action + '_bipede']) || (quadrupede && famille !== 'tortue' && (COURBES_ACTIONS[B.action + '_' + famille] || COURBES_ACTIONS[B.action + '_quad'])) || COURBES_ACTIONS[B.action] : null;
  const kAct = (V.ampleur || 1) * ampleurMax;
  if (sautQ) {                                                // saut de quadrupede : la tete suit le tangage du corps avec ~0,08 cycle de retard (overlap) au lieu de rester figee
    const Lc_ = Math.max(4, Math.round(T * fps)), d_ = Math.round(0.08 * Lc_);
    for (let i = 0; i < nT; i++) teteT[i] = 0.95 * sautQ[(((i - d_) % nT) + nT) % nT];
  }
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
      if (C.lacetQ && quadrupede && globalThis.__corpsQuadrupede !== false) lacetBassin[i] = cles(u, C.lacetQ) * k;
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
    // portee en DOUCEUR (26/10, 2e passe) : voir plus bas. Passe 0 = mesure de la distance hanche-cible de chaque image, passe 1 = le calcul.
    const doux = A.pas && !bipede && globalThis.__porteeDouce !== false;
    const nds = doux ? new Array(nT).fill(0) : null;
    let dc = null;
    for (let pass = 0; pass < (doux ? 2 : 1); pass++) {
    u = 0;
    for (let i = 0; i < nT; i++) {
      let cible, phi = 0, b_ = p.beta;
      if (!A.pas) {
        cible = p.neutre.slice();
        // pieds qui BOUGENT pendant une action (pas d'attaque, patte levee, membres replies pour se coucher) : courbes C.pieds
        // par patte, cle « AG » (avant gauche) > « A » (rang) > « G » (cote) ; avance dans le sens du corps, lat de cote, lev vers le haut
        const sp = pasPied(C, p);
        if (sp) {
          const uu = t[i] / T;
          const dv = [sp.lat ? cles(uu, sp.lat) * hanche * kAct : 0, 0, sp.av ? cles(uu, sp.av) * hanche * kAct : 0];
          cible = add(cible, mv(Rcap[i], dv));
          if (sp.lev) cible[1] += cles(uu, sp.lev) * hanche * kAct;
        }
      }
      else {
        const x = t[i] / T + p.phase, k = Math.floor(x);
        phi = x - k;
        if (phi < b_) cible = appui(p, k);
        else {
          u = (phi - b_) / (1 - b_);
          // grenouille (25/10, 2e tour) : en vol les pattes arriere restent ETENDUES derriere le corps, puis ne se replient qu'a la fin (Nauwelaerts & Aerts
          // 2003 : extension complete au decollage, flexion avant la reception) : l'avance du pied est retardee (u ^ 1,6)
          const X0 = appui(p, k), X1 = appui(p, k + 1), e = (1 - Math.cos(Math.PI * (Pr.releveGenou && p.rang !== 0 ? Math.pow(u, 1.6) : u))) / 2;
          cible = add(X0, mulS(sub(X1, X0), e));
          // profil de hauteur du pied. Marche humaine (levee) : la semelle monte vite en debut de balancier (pic ~30 % : le genou plie
          // a 60 deg, Perry 1992) puis redescend a ~1,5 cm au passage sous le corps (garde au sol minimale de mi-balancier : 1,3 a 1,6 cm,
          // Winter 1991 ; Barrett, Mills & Begg 2010) avant l'attaque du talon. Le sin2 d'origine (pic a 50 %) levait le pied de 21 cm
          // EN MILIEU de balancier : marche « genoux hauts ».
          if (SAUT && droit && ALLURES[allure].saut) cible[1] += 0.26 * hanche * Math.sin(Math.PI * Math.min(u / 0.85, 1)) ** 2;   // saut de bipede : jambes REPLIEES en vol, tendues 15 % avant la reception
          // quadrupede qui saute : les pieds suivent la MONTEE du corps (sinon ils ne s'elevent que de h pendant que le tronc monte de SAUT_Q * hanche : jambes tendues en echasses,
          // aucune phase aerienne lisible) puis se replient de h par-dessus (planche avant / apres : C:/tmp/anim_realisme2)
          if (SAUT && quadrupede && famMammifere && Object.keys(Pr).length && ALLURES[allure].saut && globalThis.__sautQuadrupede !== false) cible[1] += SAUT_Q * hanche * (V.h || 1) * Math.sin(Math.PI * u);
          cible[1] += A.levee && !(B.recul && droit) ? h / 1.06 * (Math.sin(Math.PI * Math.min(u / 0.62, 1)) ** 2 + 0.06 * Math.sin(Math.PI * u) ** 2 + (globalThis.__finBalancierLeve === false ? 0 : 1.2 * (1 - e) * lisseFin(u))) : h * Math.sin(Math.PI * (A.leve ? Math.pow(u, A.leve) : u)) ** 2;   // leve < 1 : le pied monte tot (quadrupedes, galop)
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
      if (!A.pas) { const sp_ = pasPied(C, p); if (sp_ && sp_.pit) theta += cles(t[i] / T, sp_.pit) * kAct; }   // pied tourne autour du bout (pied replie, patte levee)
      // axe de deroule du pied : Rx tourne le pied « vers l'avant (+z) ». Une patte etalee dont le pied pointe vers l'ARRIERE ou de COTE (araignee, insecte, lezard) etait roulee a
      // l'envers : la cheville s'enfoncait de 2 cm sous le sol (12 % de H sur une araignee). L'axe est donc perpendiculaire a la direction horizontale du pied.
      const F = mm(Rcap[i], p.axeDeroule && theta ? rotvec(p.axeDeroule, theta) : Rx(theta));
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
      // Portee bornee EN DOUCEUR (26/10, 2e passe ; a-coups du galop de la mule). En fin de balancier la cible du pied etait a 1,08 fois la longueur de la jambe (le pied devance
      // le tronc puis rentre avant de se poser) : la cheville collait a la sphere de portee (jambe gelee, tendue, ~6 images a 60 i/s) et la quittait d'un coup, d'ou une rotation
      // de la jambe de 15 -> 34 -> 2 deg par image (planche C:/tmp/anim_realisme2). Seulement pour une patte dont la cible depasse REELLEMENT la portee : la distance plafonnee est
      // lissee dans le temps (2 passes de [1 2 1]/4) et rendue a la distance exacte sur la fin du balancier, si bien que le pied se pose ou le calcul de foulee l'a prevu (aucun
      // glissement en appui) ; une patte qui reste dans sa portee n'est pas touchee.
      if (doux) {
        if (pass === 0) { nds[i] = norm(dd); continue; }
        if (dc === null) {
          dc = false;
          if (Math.max(...nds) > PORTEE_MAX * Lik) {
            dc = nds.map((x) => Math.min(x, PORTEE_MAX * Lik));
            for (let rep_ = 0; rep_ < 2; rep_++) dc = dc.map((_, k) => 0.25 * dc[(k + nT - 1) % nT] + 0.5 * dc[k] + 0.25 * dc[(k + 1) % nT]);
          }
        }
        if (dc && phi >= b_ && norm(dd) > 1e-9) {
          const x_ = clip((u - 0.8) / 0.2, 0, 1), lam = 1 - x_ * x_ * (3 - 2 * x_), n0 = norm(dd);
          const cible_d = Math.min(n0, PORTEE_MAX * Lik), voulu = cible_d + lam * (dc[i] - cible_d);
          cib = add(hanche_i, mulS(dd, voulu / n0));
        }
      }
      if (norm(sub(cib, hanche_i)) > PORTEE_MAX * Lik) cib = add(hanche_i, mulS(sub(cib, hanche_i), PORTEE_MAX * Lik / norm(sub(cib, hanche_i))));   // portée bornée
      let Q = resoudreForme(p.forme, hanche_i, cib, mv(porte >= 0 ? colRot[i].get(porte) : Rb[i], p.poleIK), A.pas && !Pr.releveGenou ? (globalThis.__plieMarche ?? 0.6) : 0.9);
      // 25/10 (2e tour) : patte en Z (grenouille : cuisse en avant, jambe en arriere, tarse a plat) qui se replie sous le corps : la
      // cheville passait 9 cm SOUS le sol a chaque poussee (44 % de la hauteur). On fait tourner le plan de la patte autour de l'axe
      // hanche-pied (les deux extremites ne bougent pas) jusqu'a ce que tous les os intermediaires soient hors du sol.
      if (Pr.releveGenou && !p.debout && Q.length >= 3) relevePlan(Q, sol + 0.004 * H);   // patte ETALEE seulement (grenouille) : sur une patte droite (mule, lion) la rotation du plan retournait les genoux
      if (!A.pas && C && (C.pieds || C.relever)) Q = relever(Q, sol + 0.012 * H);   // membre replie (coucher) : aucune articulation sous le sol
      for (let a = 0; a < ch.length - 1; a++) {
        const repos = mv(Rb[i], sub(P0[ch[a + 1]], P0[ch[a]]));
        Dch[a][i] = mm(aligner(repos, sub(Q[a + 1], Q[a])), Rb[i]);
      }
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
      else if (quadrupede && famMammifere && Object.keys(Pr).length && globalThis.__corpsQuadrupede !== false) {
        // 28/10 (defaut Q12) : la queue suit le tronc avec retard et flotte (composante verticale Rx : elle monte quand le corps descend), au galop elle se releve ;
        // au repos un coup de queue evenementiel (chasse-mouches, ~4 Hz pendant 0,4 s) au lieu d'une simple sinusoide
        const nq = cq.length, kx = (genre === 'run' ? 0.26 : A.pas ? 0.12 : 0.06) * A.queue;
        balance.set(j, t.map((tt) => {
          const x_ = tt / T, f = (A.pas ? 2 : 1) * 2 * Math.PI * x_;
          const flick = vivant ? 0.45 * evt(x_, 0.45, 0.035) * Math.sin(2 * Math.PI * 40 * (x_ - 0.45) - 0.8 * a) : 0;
          return mm(Rx((a + 1) / nq * (kx * Math.sin(f - 0.7 * a + 1.1) + 0.5 * flick)), Ry((ampQ * Math.sin((A.pas ? 1 : 2) * 2 * Math.PI * x_ - 0.7 * a) + flick) * (a + 1) / nq));
        }));
      }
      else balance.set(j, t.map((tt) => Ry(ampQ * (a + 1) / cq.length * Math.sin(2 * Math.PI * tt / T * (A.pas ? 1 : 2) - 0.7 * a))));
      // action : la queue se releve / s'etale (C.queue, rad, + = vers l'arriere) : coucher, attaque (fouet)
      if (C && C.queue && !A.abdomen) { const b0 = balance.get(j); balance.set(j, b0.map((m, i) => mm(Rx(cles(t[i] / T, C.queue) * kAct / Math.max(cq.length - 1, 1)), m))); }
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
    // 28/10 (couverture, poule : les pieds glissaient de 4 % H par cycle de COTE en appui, contre 0,1 chez les humains). Une patte attachee AU-DESSUS de la colonne du buste
    // (hanche descendante d'un os de la colonne : la poule porte ses cuisses sur le dos) suivait la contre-rotation du torse alors que la cible du pied, calculee sur le corps
    // rigide, l'ignorait : le pied balayait ~1,3 cm de chaque cote. On retire de cette colonne les os qui portent une hanche ; sans effet pour un humain (jambes au bassin).
    if (globalThis.__colonneSansJambes !== false) for (let q = colonne.length - 1; q >= 0; q--) { const k_ = colonne[q]; if (pattes.some((p_) => { for (let m = par[p_.chaine[0]]; m >= 0; m = par[m]) if (m === k_) return true; return false; })) colonne.splice(q, 1); }
    const nC = Math.max(colonne.length, 1);
    // respiration de l'attente : la cage thoracique se releve / s'abaisse (~1 deg, 2 cycles par periode)
    const respire = (i) => (!A.pas && !B.action ? Math.min(A.bob / 0.008, 1.6) * (droit ? 0.045 * Math.sin(4 * Math.PI * t[i] / T) + 0.012 * Math.sin(6 * Math.PI * t[i] / T + 1.1) : 0.02 * Math.sin(4 * Math.PI * t[i] / T)) : 0);   // droit : la poitrine respire visiblement (~2,5 deg)
    for (const j of colonne) balance.set(j, t.map((_, i) => mm(mm(Ry((C ? torseL[i] : -1.6 * lacetBassin[i]) / nC), Rz(-(famille === 'manchot' && A.pas ? 0.15 : 1) * roulis[i] / nC)), Rx(((C ? torseP[i] : 0) + respire(i)) / nC))));
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
      const avant = t.map((tt, i) => (C && C.bras ? brasT[i] * (C.brasSym || b.cote === -1 ? 1 : 0.25)   // action : bras droit qui frappe
        : brasSaut ? brasSaut[i] * A.bras * (enT && !baisse ? 0.35 : 1)   // saut (action) : elan des bras en trois temps
        : SAUT && B.saut && !Pr.saut ? cles(((tt / T + pattes[0].phase) % 1 + 1) % 1, BRAS_SAUT) * A.bras   // saut : balancier des bras (voir BRAS_SAUT)
        : SAUT ? -ampL * Math.cos(2 * Math.PI * tt / T)           // saut : les deux bras ensemble (elan)
        // oiseau (26/10) : les deux ailes bougent ENSEMBLE, deux fois par cycle (une petite poussee a chaque pas), au lieu de balancer en
        // opposition comme des bras humains ; amplitude reduite de moitie (choix de realisme visuel : un oiseau qui court garde les ailes quasi repliees ; amplitude non mesuree sur un oiseau reel)
        : A.pas && famille === 'oiseau' ? -0.5 * ampL * (2 * sG[i] * sG[i] - 1)
        : A.pas ? -b.cote * ampL * sG[i] : ampL * Math.sin(2 * Math.PI * tt / T + (b.cote === 1 ? 0 : 1.3))));
      // bras abaisse : balancement d'avant en arriere (autour de l'axe lateral) APRES l'abaissement. Fait
      // avant, en course le balancier + le coude remontaient la main a hauteur d'epaule (« bras de zombie »).
      // 2e tour (27/10) : (1) coude d'un bipede droit aux bras pendants : on retire la flexion de REPOS du rig (plan du coude), sinon elle s'ajoutait a celle
      // du cycle (coude droit a 166-172 deg en course sur fix_humain) ; le coude suit alors la meme courbe des deux cotes ; (2) l'avant-bras retarde
      // l'epaule de 7 % du cycle (chevauchement), seulement en marche / course periodiques
      let restCorr = 0;
      if (droit && !enT) {
        let fk_ = -1;
        for (const k of E[b.coude]) if (fk_ < 0 || sousArbre(E, k).length > sousArbre(E, fk_).length) fk_ = k;
        if (fk_ >= 0) {
          const u_ = mulS(d_, 1 / (norm(d_) + 1e-12)), f_ = sub(P0[fk_], P0[b.coude]);
          restCorr = clip(Math.atan2(dot(cross(u_, f_), axe), dot(u_, f_)), 0, 2.0);
        }
      }
      // 28/10 (humain-course, 3D) : bras PORTEUR = bras dont la pose de repos garde l'avant-bras deja bien plie vers l'avant (coude > ~57 deg : il tient un objet,
      // baton, torche, bouclier). Le balancier + la flexion de course le ramenaient vers le bassin et faisaient pivoter l'objet de ~40 deg (le baton traversait le
      // bassin). Le bras porteur garde sa pose de repos (forearm non redresse, pas de flexion de course) et ne balance qu'a 25 % ; DESACTIVE PAR DEFAUT (28/10, decision du user : l'humain de reference tient un baton que les autres humains n'auront pas) ; activer : globalThis.__brasPorteur = true.
      let porte = false;
      porte = globalThis.__brasPorteur === true && droit && !enT && !C && !SAUT && A.pas && restCorr > 1.0;
      const avantE = porte ? avant.map((x) => 0.25 * x) : avant;
      balance.set(b.epaule, avantE.map((a) => (Rbaisse ? mm(rotvec([1, 0, 0], -a), Rbaisse) : rotvec(axe, a))));
      const dec = A.pas && droit && !SAUT && !C ? Math.round(0.07 * T * fps) : 0;
      const avantC = dec ? avant.map((_, i) => avant[((i - dec) % nT + nT) % nT]) : avant;
      if (porte) balance.set(b.coude, avantC.map((a) => rotvec(axe, 0.12 * clip(a / Math.max(ampB, 1e-6), -1, 1))));
      else balance.set(b.coude, avantC.map((a) => rotvec(axe, flex + (genre !== 'run' ? 0.38 : 0.3) * clip(a / Math.max(ampB, 1e-6), 0, 1) - restCorr)));
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
      if (quadrupede && famMammifere && Object.keys(Pr).length && norm(sub(P0[f], P0[c[0]])) < 0.3 * H && globalThis.__corpsQuadrupede !== false) continue;   // cornes, oreilles : le ressort « leger » s'en charge, elles ne battent plus comme des ailes (defaut Q13)
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
  // galop (28/10, defaut Q3) : nutation de la tete 10-20 deg crete a crete (Heglund / Hildebrand) ; le signal est retarde le long de l'encolure
  // (0,035 cycle par os : le museau suit la base du cou, c'est l'overlap), au lieu d'une meme phase sur tous les os
  const nodPRetard = (i, a, nOs) => {
    const n = nodP.length, d = Math.round(0.035 * a * Math.max(8, Math.round(T * fps)));
    return nodP[(((i - d) % n) + n) % n];
  };
  for (const ct of tetesA) {
    const nb = ct.length - 1;
    const bobTete = tetePique && nb >= 2;
    const dir = P0[ct[nb]][1] - P0[ct[0]][1] >= 0 ? 1 : -1;      // os qui montent : +rotation = vers l'avant ; qui descendent : l'inverse
    const phiTete = bobTete ? clip(0.5 * (S / 2) / Math.max(norm(sub(P0[ct[nb]], P0[ct[0]])), 1e-6), 0.05, 0.35) : 0;
    ct.slice(0, -1).forEach((j, a) => {
      balance.set(j, t.map((tt, i) => {
        const hoche = bobTete ? dir * phiTete * dentScie[i] * (a === 0 ? 1 : a === nb - 1 ? -1 : 0)
          : A.hoche != null && A.pas
          ? A.hoche * (A.hoche > 0.2 ? nodPRetard(i, a, ct.length) : nodP[i]) / Math.max(ct.length - 1, 1)     // profil : tete basse quand l'avant porte (galop : chaque os suit le precedent avec retard)
          : (A.pas ? 0.03 * (droit ? 0.2 : 1) : 0.04) * Math.sin(4 * Math.PI * tt / T + 0.5 + 0.3 * a);   // bipede droit : la tete se stabilise (2 a 4 deg)
        let m = Rx(hoche + teteT[i] / Math.max(ct.length - 1, 1) - (a === 0 ? tangage[i] + (C ? 0.7 * torseP[i] : 0) - A.tete + A.teteStab * flex[i] : 0));
        if (!A.pas && a === 0 && vivant) {
          const x_ = tt / T;
          // repos vivant : regard = deux harmoniques + un tour de tete (le museau part, tient, revient) + un coup de nez
          const reg = 0.2 * A.regard * (Math.sin(2 * Math.PI * x_) + 0.5 * Math.sin(2 * Math.PI * 3 * x_ + 1.3)) + 0.5 * evt(x_, 0.3, 0.07) - 0.4 * evt(x_, 0.64, 0.06);
          m = mm(Ry(reg), mm(Rx(0.07 * evt(x_, 0.8, 0.03) - 0.05 * evt(x_, 0.3, 0.07)), m));
        } else if (!A.pas && a === 0) m = mm(Ry(droit && !B.action ? 0.26 * A.regard * (Math.tanh(2.2 * Math.sin(2 * Math.PI * tt / T)) / Math.tanh(2.2) * 0.8 + 0.2 * Math.sin(6 * Math.PI * tt / T + 0.7)) : 0.22 * A.regard * (allure === 'idle' ? 0.3 : 1) * Math.sin(2 * Math.PI * tt / T)), m);   // bipede droit : regard par paliers (saccades)
        // tete stabilisee : elle contre-tourne contre la ceinture scapulaire (qui tourne de ondu / 2)
        if (A.teteContre && colonne && a === 0) m = mm(Ry(-A.teteContre * ondu[i] / 2), m);
        if (droit && !A.pas && !B.action && a === 0) m = mm(Rx(-0.8 * Math.min(A.bob / 0.008, 1.6) * (0.045 * Math.sin(4 * Math.PI * tt / T) + 0.012 * Math.sin(6 * Math.PI * tt / T + 1.1))), m);   // la tete ne suit pas la respiration de la poitrine
        if (droit && tourne && a === 0) m = mm(Ry(0.45 * A.lacet), m);   // virage : le regard precede le bassin (~16 deg)
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
  let hubC = hubA;
  if (bout < 0 && globalThis.__corpsQuadrupede !== false && par[hubA] >= 0) {
    // 28/10 (defaut Q8) : tortue, certains rigs : les pattes avant partent d'un moyeu SOUS la base du cou (le cou est un enfant du parent du moyeu).
    // On remonte d'un cran : encolure = chemin de ce parent vers la feuille la plus en avant, hors pattes et queues.
    hubC = par[hubA];
    for (let j = 0; j < par.length; j++) {
      if (En[j].length || exclus.has(j) || j === hubC || !anc(j).includes(hubC)) continue;
      if (bout < 0 || P0[j][2] > P0[bout][2]) bout = j;
    }
  }
  if (bout < 0) return null;
  const a_ = anc(bout), cou = a_.slice(0, a_.indexOf(hubC)).reverse();   // de l'enfant de la ceinture au bout
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
// ------------------------------------------------------------------ mort du BIPEDE : chute dans le plan sagittal (28/10, 2e retour du proprietaire : « la mort n'est pas credible »)
// Avant : le corps entier basculait d'un bloc AUTOUR DES PIEDS, de COTE (genoux 72 deg au plus, baton et os sous le sol). Maintenant, en 4 temps (u = temps normalise 0..1) :
//  1. 0 -> 0.15 coup recu : le torse recule en arc, la tete part en arriere, les bras s'ecartent, les genoux commencent a ceder ;
//  2. 0.1 -> 0.45 les GENOUX PLIENT (accroupi puis assis : cuisse a l'horizontale, genou 80-100 deg) et le bassin descend, pieds poses, torse penche en arriere ;
//  3. 0.44 -> 0.64 chute vers l'ARRIERE (variante « left » : vers l'AVANT, a genoux puis a plat ventre), dans le plan avant-arriere : angle du tronc en t^2 (chute libre), bras qui s'ecartent ;
//  4. 0.64 -> 0.9 impact, corps ALLONGE A PLAT (tronc a ~90 deg), jambes qui s'allongent (un genou reste leve, l'autre jambe tendue), bras retombes, puis immobilite (pas de rebond du corps).
// Les jambes sont pilotees par ANGLES MONDE (cuisse, tibia, pied) : elles ne suivent pas la rotation du bassin. L'avant-arriere est deduit de la geometrie (genou et orteils devant la hanche).
// Le sol est tenu par la cinematique directe de TOUS les os, avec une demi-epaisseur de corps (5 % de H pour le tronc, la tete et le bassin ; 2,5 % pour les membres) : rien ne passe sous le sol.
// Interrupteur : globalThis.__mortSagittal = false rend l'ancienne chute (de cote).
// Refs : Winter 2009 (segments, chute libre theta ~ t^2) ; Robinovitch et al. 2013 (chutes reelles : genoux et hanches cedent avant le torse).
function chuteBipedeSagittale(c) {
  const { det, fps, T, nT, t, E, J, par, P0, racine, sol, H, V, tronc, duCou, cous, kappa, ordre, sec } = c;
  const sm01 = (x) => { const q = clip(x, 0, 1); return q * q * (3 - 2 * q); };
  // chaines de jambes : chaque jambe part du bassin commun (comme animerAllure)
  const pattes = det.pattes.map((p) => ({ ...p, chaine: [...p.chaine] }));
  const anc = (j) => { const s_ = new Set(); for (let k = par[j]; k >= 0; k = par[k]) s_.add(k); return s_; };
  for (const [p, q] of [[pattes[0], pattes[1]], [pattes[1], pattes[0]]]) {
    const bassin = anc(q.chaine[0]), ajout = [];
    for (let r = p.chaine[0]; par[r] >= 0 && !bassin.has(par[r]) && par[r] !== racine; r = par[r]) ajout.unshift(par[r]);
    if (ajout.length) p.chaine = [...ajout, ...p.chaine];
  }
  // hanche / genou / cheville = les deux segments adjacents les plus longs (cuisse + jambe) ; au-dela : pied, orteils
  const jam = [];
  for (const p of pattes) {
    const C = p.chaine; if (C.length < 3) return null;
    let bi = 0, bl = -1;
    for (let i = 0; i + 2 < C.length; i++) { const l = norm(sub(P0[C[i + 1]], P0[C[i]])) + norm(sub(P0[C[i + 2]], P0[C[i + 1]])); if (l > bl) { bl = l; bi = i; } }
    jam.push({ p, hip: C[bi], gen: C[bi + 1], che: C[bi + 2], cote: p.cote, bout: p.bout });
  }
  const estCheville = new Set(jam.map((o) => o.che));
  // avant = du cote du genou et des orteils
  let score = 0;
  for (const L of jam) {
    score += 2 * (P0[L.bout][2] - P0[L.che][2]) + (P0[L.gen][2] - 0.5 * (P0[L.hip][2] + P0[L.che][2]));
    const fi = E[L.che].filter((k) => !estCheville.has(k));
    if (fi.length) score += 2 * (P0[fi[0]][2] - P0[L.che][2]);
  }
  const fz = score < 0 ? -1 : 1;
  const rf = (d) => Rx(-fz * d);                               // fait pivoter vers l'AVANT de d (le haut du corps part vers l'arriere)
  const ang = (v) => Math.atan2(fz * v[2], -v[1]);              // angle d'un os depuis la verticale descendante, + = vers l'avant
  const arriere = (V.cote || -1) < 0;                           // defaut : on tombe en arriere ; « left » : en avant
  const dir = arriere ? 1 : -1;
  // inclinaison de repos du tronc (hanche -> sommet) : le tronc couche doit etre horizontal quelle que soit la posture de repos du rig
  let sommet = racine;
  for (let j = 0; j < J; j++) if (P0[j][1] > P0[sommet][1]) sommet = j;
  const hm = [0, 1, 2].map((k) => (P0[jam[0].hip][k] + P0[jam[1].hip][k]) / 2);
  const tilt = Math.atan2(fz * (P0[sommet][2] - hm[2]), P0[sommet][1] - hm[1]);
  const THF = Math.PI / 2 * 0.985 + (arriere ? 1 : -1) * 0.985 * clip(tilt, -0.3, 0.3);
  for (const L of jam) {
    L.t0 = ang(sub(P0[L.gen], P0[L.hip])); L.s0 = ang(sub(P0[L.che], P0[L.gen]));
    const fi = E[L.che].filter((k) => !estCheville.has(k));
    L.f0 = fi.length ? ang(sub(P0[fi[0]], P0[L.che])) : Math.PI / 2;
    L.rest = L.t0 - L.s0;
    L.asym = L.cote === 1 ? 1 : 0;                              // une jambe reste genou leve, l'autre s'allonge
  }
  const dansJ = new Set(pattes.flatMap((p) => p.chaine.flatMap((k) => sousArbre(E, k))));
  const colonne = [...tronc].filter((j) => j !== racine && !duCou.has(j) && !dansJ.has(j) && par[j] >= 0);
  const brasBase = [];
  for (let j = 0; j < J; j++) {
    if (!kappa[j] || !tronc.has(par[j])) continue;
    const sub_ = sousArbre(E, j); let loin = j;
    for (const k of sub_) if (Math.abs(P0[k][0] - P0[j][0]) > Math.abs(P0[loin][0] - P0[j][0])) loin = k;
    const dx = P0[loin][0] - P0[j][0];
    if (Math.abs(dx) > 0.1 * H) brasBase.push({ j, sg: Math.sign(dx), ret: 0.02 * (brasBase.length % 2) });
  }
  // ---- courbes
  const U_IMP = 0.64, U_A = 0.44, U_C = 0.62;
  const thetaF = arriere ? THF : -THF;
  const thetaP = (u) => {                                       // inclinaison du bassin / tronc (+ = vers l'arriere) : preparation, chute libre en t^2, puis amorti (la vitesse retombe en ~2 images)
    const pre = cles(Math.min(u, U_A), arriere ? [[0, 0], [0.07, 0.10], [0.16, 0.16], [0.34, 0.14], [U_A, 0.30]] : [[0, 0], [0.08, -0.06], [0.2, -0.14], [0.34, -0.22], [U_A, -0.30]]);
    if (u < U_A) return pre;
    const Rr = thetaF - pre, f = 0.8, x = (u - U_A) / (U_C - U_A);
    if (u <= U_C) return pre + f * Rr * x * x;
    const tau = (1 - f) * (U_C - U_A) / (2 * f);
    return pre + f * Rr + (1 - f) * Rr * (1 - Math.exp(-(u - U_C) / tau));
  };
  const spine = (u) => cles(u, arriere ? [[0, 0], [0.06, 0.30], [0.16, 0.20], [0.3, -0.22], [0.46, -0.08], [0.64, 0], [1, 0]] : [[0, 0], [0.08, -0.18], [0.3, -0.30], [0.5, 0.05], [0.64, 0], [1, 0]]);
  const agite = (u, ret) => cles(u - ret, [[0, 0], [0.1, 0.5], [0.3, 0.85], [0.5, 0.8], [0.64, 0.5], [0.82, 0.0], [1, 0]]);
  const sursaut = (u) => (u > 0.02 && u < 0.2 ? Math.sin(Math.PI * (u - 0.02) / 0.18) ** 2 : 0);
  const TAUL = 0.06;
  const R = [], racineMonde = [], posSec = sec.map(() => []);
  const plantZ0 = moyenne(jam.map((L) => P0[arriere ? L.che : L.gen][2]));
  let M0 = null;
  const frames = [];
  for (let i = 0; i < nT; i++) {
    const u = i === nT - 1 ? 1 : t[i] / T;
    const th = thetaP(u);
    const Ri = P0.map((_, j) => (j === racine ? rf(th) : I3()));
    const lag = u >= 0.97 ? 0 : thetaP(u) - thetaP(Math.max(0, u - TAUL));
    const osc = u > U_IMP && u < 0.97 ? 0.08 * Math.exp(-(u - U_IMP) / 0.05) * Math.sin(2 * Math.PI * (u - U_IMP) / 0.12) : 0;
    for (const j of colonne) Ri[j] = rf(spine(u) / Math.max(colonne.length, 1));
    for (const cc of cous) { const n = cc.length; for (let k = 0; k < n; k++) Ri[cc[k]] = rf((dir * 0.5 * sursaut(u) - 0.9 * lag + osc * dir) / n); }
    for (let j = 0; j < J; j++) if (kappa[j]) Ri[j] = rf(-0.6 * lag * kappa[j]);
    for (const { j, sg, ret } of brasBase) Ri[j] = mm(Rz(sg * agite(u, ret)), Ri[j]);
    // jambes : angles monde
    const cible = new Map();
    for (const L of jam) {
      const d = clip(1.55 - L.rest, 0.35, 1.4);                  // flexion ajoutee en position accroupie / a genoux
      let at, as, af;
      if (arriere) {
        const et = L.asym ? 0.36 : 0.04, kend = L.asym ? 1.0 : 0.3;
        at = cles(u, [[0, L.t0], [0.08, L.t0 + 0.10 * d], [0.16, L.t0 + 0.28 * d], [0.3, L.t0 + 0.6 * d], [U_A, Math.PI / 2 - 0.1], [U_IMP, Math.PI / 2 + et], [0.86, Math.PI / 2 + et], [1, Math.PI / 2 + et]]);
        as = cles(u, [[0, L.s0], [0.08, L.s0 - 0.07 * d], [0.16, L.s0 - 0.18 * d], [0.3, L.s0 - 0.4 * d], [U_A, 0.0], [U_IMP, Math.PI / 2 + et - kend * 0.9], [0.86, Math.PI / 2 + et - kend], [1, Math.PI / 2 + et - kend]]);
        af = L.f0 + (as + (L.f0 - L.s0) - 0.3 - L.f0) * sm01((u - 0.40) / 0.25);
      } else {
        const et = L.asym ? 0.04 : 0.1, kend = L.asym ? 0.2 : 0.7;
        at = cles(u, [[0, L.t0], [0.1, L.t0 + 0.05], [0.3, L.t0 + 0.2], [U_A, 0.05], [U_IMP, -Math.PI / 2 + et], [0.86, -Math.PI / 2 + et], [1, -Math.PI / 2 + et]]);
        as = cles(u, [[0, L.s0], [0.1, L.s0 - 0.25 * d], [0.3, L.s0 - 0.8 * d], [U_A, -Math.PI / 2 + 0.2], [U_IMP, -Math.PI / 2 + et - kend * 0.8], [0.86, -Math.PI / 2 + et - kend], [1, -Math.PI / 2 + et - kend]]);
        af = L.f0 + (as - 0.1 - L.f0) * sm01((u - 0.2) / 0.3);
      }
      cible.set(L.hip, at - L.t0); cible.set(L.gen, as - L.s0); cible.set(L.che, af - L.f0);
    }
    const D = new Array(J), P = new Array(J);
    for (const j of ordre) {
      if (par[j] < 0) { D[j] = Ri[j]; P[j] = P0[j]; continue; }
      if (cible.has(j)) { D[j] = rf(cible.get(j)); Ri[j] = mm(tr(D[par[j]]), D[j]); }
      else D[j] = mm(D[par[j]], Ri[j]);
      P[j] = add(P[par[j]], mv(D[par[j]], sub(P0[j], P0[par[j]])));
    }
    // pieds (ou genoux, a genoux) plantes : decalage avant-arriere
    const dz = plantZ0 - moyenne(jam.map((L) => P[arriere ? L.che : L.gen][2]));
    // sol : chaque os garde sa demi-epaisseur au-dessus du sol (5 % de H tronc / tete / bassin, 2,5 % membres) sans jamais exiger plus haut que sa position au repos
    let Mx = -Infinity;
    for (let j = 0; j < J; j++) {
      const c_ = (tronc.has(j) || duCou.has(j)) ? 0.05 * H : 0.025 * H;
      const req = sol + Math.min(P0[j][1] - sol, c_);
      Mx = Math.max(Mx, req - P[j][1]);
    }
    if (M0 === null) M0 = Mx;
    frames.push({ Ri, dz, monte: Mx - M0 });
  }
  for (let i = 0; i < nT; i++) {
    const { Ri, dz, monte } = frames[i];
    R.push(Ri);
    racineMonde.push(add(P0[racine], [0, monte, dz]));
    sec.forEach((r, k) => posSec[k].push(add(P0[r], [0, monte, dz])));
  }
  const infos = {
    mode: 'pattes', action: 'death', angle_deg: +(THF * 180 / Math.PI).toFixed(0), pattes: det.pattes.length, pedipalpes: 0,
    queues: det.queues.length, tetes: det.tetes.length, bras: 0, periode: T, foulee: 0, images: nT,
    sous_sol_pct: 0, pire_os: -1, glissement_appui_pct: 0, acoups_max_deg: 0,
  };
  return { nom: c.variante === 'normal' ? 'death' : `death__${c.variante}`, R, racineMonde, racinesSec: sec.map((j, k) => ({ j, pos: posSec[k] })), infos };
}

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
  // bipede DROIT (humain, orc, elfe, robot) : chute en plusieurs temps (genoux, colonne qui s'enroule, bras, tete en retard)
  let bip = false;
  if (det.pattes.length === 2) {
    let sommet = racine;
    for (let j = 0; j < J; j++) if (!E[j].length && P0[j][1] > P0[sommet][1]) sommet = j;
    const dv = sub(P0[sommet], P0[racine]);
    bip = dv[1] > 2.0 * Math.hypot(dv[0], dv[2]);
  }
  const dessous = new Set(det.pattes.filter((p) => p.cote === cote).flatMap((p) => sousArbre(E, p.chaine[0])));
  let thF = Math.PI / 2;                                     // arrivee : le flanc touche le sol
  for (let th = 0.05; th <= Math.PI / 2; th += 0.01) {
    let bas = Infinity;
    // os deja au sol au depart (pieds de l'autre cote, bout de queue) : ils se levent, ils ne comptent pas
    for (let j = 0; j < J; j++) if (!dessous.has(j) && P0[j][1] - sol > 0.05 * H) bas = Math.min(bas, tourne(th, P0[j])[1]);
    if (bas <= sol + 0.02 * H) { thF = th; break; }
  }
  // 28/10 (mort 3D araignee : couchee sur le flanc, ses 8 pattes ecartees formaient une tour verticale de 295 % de H) : un arthropode a 6 pattes ou plus meurt sur le DOS, pattes repliees
  const arthro = det.pattes.length >= 6 && globalThis.__mortArthropode !== false;
  if (arthro) thF = Math.PI;
  const sm01 = (x) => { const c = clip(x, 0, 1); return c * c * (3 - 2 * c); };
  const U_IMPACT = 0.6;
  // angle du corps (chute libre en t^2, puis rebond amorti) ; angleBrut = sans rebond (retard des membres)
  const U_DEB = bip ? 0.05 : 0.12;                           // bipede : le basculement commence tot (plus de 0,6 s debout)
  const angleBrut = (u) => (u < U_DEB ? 0.0 : u < U_IMPACT ? thF * ((u - U_DEB) / (U_IMPACT - U_DEB)) ** 2 : thF);
  const rebond = (u) => { const s = u - U_IMPACT; return s <= 0 ? 0 : Math.exp(-s / 0.06) * Math.abs(Math.sin(2 * Math.PI * s / 0.16)); };
  const angle = (u) => (u >= 0.97 ? thF : angleBrut(u) - (u > U_IMPACT ? 0.07 * thF * rebond(u) : 0));
  // Apres l'impact, le COU retombe vers le sol (une Mule couchee gardait la tete dressee, 28/09) :
  // chaque os de l'encolure tourne vers le flanc au sol, jusqu'a ce que le bout de la tete le touche.
  const cous = det.tetes.length ? det.tetes : [encolure(par, P0, det.pattes, det.queues)].filter(Boolean);
  const final = (p) => tourne(thF, p);
  const plis = cous.map((c) => {
    const n = c.length - 1;
    // 28/10 (defaut Q10 : « la tete reste dressee, cou raide ») : le sens du pli etait suppose ; si le cou ne touche JAMAIS le sol de ce cote (phi va jusqu'a 1,3 et le cou
    // se redresse), on essaie l'autre sens ; le sens d'origine est garde des qu'il atteint le sol
    const essai = (sg) => {
      let best = 0, touche = false;
      for (let phi = 0.05; phi <= 1.3; phi += 0.05) {
        let pos = final(P0[c[0]]), D = Rz(signe * thF), dessousSol = false;
        for (let k = 0; k < n; k++) {
          D = mm(D, Rz(signe * sg * phi / n));
          pos = add(pos, mv(D, sub(P0[c[k + 1]], P0[c[k]])));
          if (pos[1] < sol + 0.01 * H) dessousSol = true;
        }
        if (dessousSol) { touche = true; break; }
        best = phi;
      }
      return { best, touche };
    };
    let r = essai(1), sg = 1;
    if (!r.touche && det.pattes.length === 4 && globalThis.__corpsQuadrupede !== false) { const r2 = essai(-1); if (r2.touche) { r = r2; sg = -1; } }
    // 28/10 (mort 3D quadrupedes : tete dressee, mule 42 % de H, vache 62 %) : le premier angle qui touche le sol ne regarde que la chaine ; le crane (enfant d'un maillon, os orienté vers le bas au repos)
    // finissait pointe vers le ciel. Pour un quadrupede on balaie sens et angle et on garde la pose dont le point le plus haut du cou ET de la tete est le plus bas, sans rien enfoncer dans le sol.
    if (det.pattes.length === 4 && globalThis.__mortTeteQuad !== false) {
      const En_ = enfantsDe(par), dj = new Set(det.pattes.flatMap((q) => sousArbre(En_, q.chaine[0])));
      const evalue = (sg_, phi, psi) => {
        let hMax = -Infinity, hMin = Infinity;
        const pas = (j, pos, D) => {                          // sous-arbre d'un os hors chaine : ses descendants suivent l'orientation de l'os
          for (const e of En_[j]) { if (dj.has(e)) continue; const q = add(pos, mv(D, sub(P0[e], P0[j]))); hMax = Math.max(hMax, q[1]); hMin = Math.min(hMin, q[1]); pas(e, q, D); }
        };
        let pos = final(P0[c[0]]), D = Rz(signe * thF);
        for (let k = 0; k < n; k++) {
          D = mm(D, mm(Ry(psi / n), Rz(signe * sg_ * phi / n)));
          for (const e of En_[c[k]]) {
            if (e === c[k + 1] || dj.has(e)) continue;
            const q = add(pos, mv(D, sub(P0[e], P0[c[k]]))), De = mm(D, mm(Ry(psi / n), Rz(signe * sg_ * phi / n)));
            hMax = Math.max(hMax, q[1]); hMin = Math.min(hMin, q[1]); pas(e, q, De);
          }
          pos = add(pos, mv(D, sub(P0[c[k + 1]], P0[c[k]])));
          hMax = Math.max(hMax, pos[1]); hMin = Math.min(hMin, pos[1]);
        }
        return { hMax, hMin };
      };
      let meilleur = null;
      for (const sg_ of [1, -1]) for (let phi = 0; phi <= 1.6; phi += 0.1) for (let psi = -1.4; psi <= 1.401; psi += 0.1) {
        const e = evalue(sg_, phi, psi);
        if (e.hMin < sol - 0.005 * H) continue;
        if (!meilleur || e.hMax < meilleur.hMax - 0.01 * H) meilleur = { hMax: e.hMax, phi, sg: sg_, psi };
      }
      if (meilleur) return { c, n, phi: meilleur.phi * meilleur.sg, psi: meilleur.psi };
    }
    return { c, n, phi: r.best * sg, psi: 0 };
  });
  const retombe = (u) => sm01((u - 0.62) / 0.25);
  // 28/10 (defaut Q10 : « chute d'un bloc autour de la ligne des pieds, l'animal ne se pose pas ») : sur un QUADRUPEDE l'avant-main cede en premier (le corps pique du nez : tangage
  // jusqu'a ~10 deg), l'arriere suit et releve le nez en s'affaissant ; a l'impact la tete rebondit sur le sol et les membres du dessus retombent sous leur poids
  const quad4 = det.pattes.length === 4 && globalThis.__corpsQuadrupede !== false;
  const piqueNez = (u) => (quad4 ? cles(u, [[0, 0], [0.1, 0], [0.3, 0.17], [0.5, 0.2], [U_IMPACT, 0.02], [0.78, -0.05], [0.9, 0.0], [1, 0]]) : 0);
  const rebTete = (u) => (quad4 && u > U_IMPACT + 0.22 && u < 0.97 ? 0.14 * Math.exp(-(u - U_IMPACT - 0.22) / 0.05) * Math.abs(Math.sin(2 * Math.PI * (u - U_IMPACT - 0.22) / 0.1)) : 0);
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
    return { p, axe, poids, sous, u0: bip ? 0.015 + 0.01 * (p.cote === cote ? 0 : 1) : 0.07 + 0.035 * arriere + 0.01 * (p.cote === cote ? 0 : 1) };
  });
  const dansJambes = new Set(det.pattes.flatMap((p) => sousArbre(E, p.chaine[0])));
  const phiJambe = (L, u) => {
    const F1 = bip ? (L.sous ? 1.0 : 0.85) : 0.75, Fend = arthro ? 1.8 : (L.sous ? 0.6 : (quad4 ? 1.6 : 1.25));   // dessous : comprimee ; dessus : relachee (quadrupede : elle retombe sous son poids)
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
  // colonne (hors cou, hors jambes, hors racine) : s'enroule vers le cote de la chute ; bras : partent vers le haut puis retombent
  const colonne = bip ? [...tronc].filter((j) => j !== racine && !duCou.has(j) && !dansJambes.has(j) && par[j] >= 0) : [];
  // 28/10 (mort 3D quadrupedes : la tete reste dressee au bout du cou, mule 42 % de H) : la chaine du cou s'arrete au bout le plus en avant (parfois une oreille) ; le crane et la machoire,
  // enfants d'un os de la chaine hors de la chaine, ne suivaient donc que 3 maillons sur 4 et gardaient l'orientation du cou. Ils retombent d'un maillon de plus (interrupteur __mortTeteQuad).
  const annexesCou = quad4 && globalThis.__mortTeteQuad !== false ? plis.map(({ c, n, phi, psi }) => ({ n, phi, psi, ann: c.flatMap((k) => E[k].filter((j) => !c.includes(j) && !dansJambes.has(j))) })) : [];
  const brasBase = [];
  if (bip) for (let j = 0; j < J; j++) {
    if (!kappa[j] || !tronc.has(par[j])) continue;
    const sub_ = sousArbre(E, j); let loin = j;
    for (const k of sub_) if (Math.abs(P0[k][0] - P0[j][0]) > Math.abs(P0[loin][0] - P0[j][0])) loin = k;
    const dx = P0[loin][0] - P0[j][0];
    if (Math.abs(dx) > 0.1 * H) brasBase.push({ j, sg: Math.sign(dx), ret: 0.02 * (brasBase.length % 2) });
  }
  const enroule = (u) => 0.42 * Math.sin(Math.PI * clip((u - 0.04) / 0.62, 0, 1)) ** 1.5;
  const agite = (u, ret) => 1.0 * Math.sin(Math.PI * clip((u - 0.05 - ret) / 0.5, 0, 1)) ** 2;
  const TAU = 0.07;
  const retard = (u) => angleBrut(u) - angleBrut(Math.max(0, u - TAU));
  const oscil = (u) => (u > U_IMPACT && u < 0.97 ? 0.22 * Math.exp(-(u - U_IMPACT) / 0.08) * Math.sin(2 * Math.PI * (u - U_IMPACT) / 0.12) : 0);
  const ordre = [], file = [racine, ...sq.racines.filter((r) => r !== racine)];
  while (file.length) { const j = file.shift(); ordre.push(j); file.push(...E[j]); }
  if (bip && globalThis.__mortSagittal !== false && globalThis.__mortAPlat !== false && det.pattes.length === 2) {
    try {
      const sec0 = sq.racines.filter((r) => r !== racine);
      const rs = chuteBipedeSagittale({ det, fps, T, nT, t, E, J, par, P0, racine, sol, H, V, tronc, duCou, cous, kappa, ordre, sec: sec0, variante });
      if (rs && rs.R.every((Ri) => Ri.every((m) => m.every(Number.isFinite)))) return rs;
    } catch (e) { if (globalThis.__mortDebug) console.log('chute sagittale :', e); }
  }
  const R = [], racineMonde = [], sec = sq.racines.filter((r) => r !== racine), posSec = sec.map(() => []);
  for (let i = 0; i < nT; i++) {
    const u = i === nT - 1 ? 1 : t[i] / T, th = angle(u);
    const Rr = quad4 ? mm(Rz(signe * th), Rx(piqueNez(u))) : Rz(signe * th);
    const Ri = P0.map((_, j) => (par[j] < 0 ? Rr : I3()));
    const lagU = u >= 0.97 ? 0 : retard(u) + oscil(u);
    for (const { c, n, phi, psi } of plis) for (let k = 0; k < n; k++) {
      const fall = mm(Ry(psi * retombe(u) / n), Rz(signe * (phi * (retombe(u) - rebTete(u)) - (bip ? 0.9 * lagU : 0)) / n));       // bipede : la tete retarde sur le tronc
      Ri[c[k]] = k === 0 ? mm(fall, Rx(-0.5 * sursaut(u))) : fall;           // tete rejetee en arriere au sursaut
    }
    for (const j of colonne) Ri[j] = Rz(signe * enroule(u) / colonne.length);
    for (const L of jambes) { const ph = phiJambe(L, u); for (const [j, w] of L.poids) Ri[j] = rotvec(L.axe, w * ph); }
    const lag = lagU;
    if (Math.abs(lag) > 1e-9) for (let j = 0; j < J; j++) if (kappa[j]) Ri[j] = Rz(-signe * lag * kappa[j]);
    for (const { n, phi, psi, ann } of annexesCou) { const f_ = mm(Ry(psi * retombe(u) / n), Rz(signe * phi * (retombe(u) - rebTete(u)) / n)); for (const j of ann) Ri[j] = mm(f_, Ri[j]); }
    for (const { j, sg, ret } of brasBase) Ri[j] = mm(Rz(sg * agite(u, ret)), Ri[j]);
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
    let monte = sol - bas + hop;
    // 26/10 (banc de rendu visuel, defaut « corps flottant ») : un bipede couche gardait le tronc a 0,22 m du sol (31 % de sa hauteur) parce que le plus bas des os,
    // un bras ou un pied pointant droit vers le bas, le tenait comme un pilier. Une fois couche, c'est le TRONC (colonne, tete, bassin) qui se pose au sol, a une
    // demi-epaisseur de corps (~5 % de H, Winter 2009 : profondeur du thorax ~ 0,13 H) ; les membres qui passeraient alors sous le sol se replient a plat dessus.
    let gg = 0;
    if (bip && globalThis.__mortAPlat !== false) {
      gg = sm01((th / thF - 0.6) / 0.4);
      if (gg > 0) {
        let basT = Infinity;
        for (const j of tronc) basT = Math.min(basT, P[j][1]);
        for (const j of duCou) basT = Math.min(basT, P[j][1]);
        const monteT = sol + 0.05 * H - basT + hop;
        if (monteT < monte) monte += gg * (monteT - monte);
        const gl = sol - monte + 0.004 * H;                  // le sol, dans le repere du calcul
        for (const j of ordre) {
          const q = par[j];
          if (q < 0) { D[j] = Ri[j]; P[j] = j === racine ? r0 : tourne(th, P0[j]); continue; }
          P[j] = add(P[q], mv(D[q], sub(P0[j], P0[q])));
          // membre libre (chaine a un seul enfant, hors tronc et cou) dont l'articulation passerait sous le sol : il pivote autour de son parent jusqu'a poser le bout a plat
          // 28/10 (mort 3D, bras du dessus qui reste a 26 % de H en l'air a cote du corps couche) : un membre libre (bras) dont l'articulation reste plus haut que le dessus du tronc couche
          // (~0,15 H) retombe sous son poids : il pivote autour de son parent jusqu'a se poser sur le corps, au prorata de gg (retombee progressive)
          const retombeMembre = globalThis.__mortBrasRetombent !== false && kappa[j] > 0 && !tronc.has(j) && !duCou.has(j) && E[q].length === 1 && P[j][1] > gl + 0.15 * H;
          const yc = retombeMembre ? P[j][1] + gg * (gl + 0.15 * H - P[j][1]) : gl;
          if (retombeMembre || (!tronc.has(j) && !duCou.has(j) && E[q].length === 1 && P[j][1] < gl && P[q][1] >= gl - 0.5 * H)) {
            const v = sub(P[j], P[q]), L = norm(v), dy = Math.max(-0.999 * L, Math.min(yc - P[q][1], 0.999 * L)), hx = Math.hypot(v[0], v[2]);
            const hz = Math.sqrt(L * L - dy * dy), vN = hx > 1e-9 ? [v[0] * hz / hx, dy, v[2] * hz / hx] : [hz, dy, 0];
            const ax = cross(v, vN), ang = Math.atan2(norm(ax), dot(v, vN));
            if (ang > 1e-6) {
              D[q] = mm(rotvec(ax, retombeMembre ? Math.min(ang, 0.9) : ang), D[q]);
              Ri[q] = par[q] < 0 ? D[q] : mm(tr(D[par[q]]), D[q]);
              P[j] = add(P[q], mv(D[q], sub(P0[j], P0[q])));
            }
          }
          D[j] = mm(D[q], Ri[j]);
        }
        let bas2 = Infinity;                                 // os restant sous le sol (parent a plusieurs enfants : non repliable) : le corps remonte de ce retard, au plus 6 % de H
        for (let j = 0; j < J; j++) bas2 = Math.min(bas2, P[j][1]);
        monte += (globalThis.__mortSansPenetration === false ? gg : 1) * Math.min(Math.max(0, sol - monte - bas2), 0.06 * H);   // 28/10 : la correction n'etait ponderee par gg que pour la mort a plat ; en debut de chute (gg petit) un pied passait 2 % de H sous le sol
      }
    }
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

// ------------------------------------------------------------------ ACTIONS DES CREATURES SANS PATTES (28/10, defaut Q1 : « un serpent qui attaque, est touche ou meurt
// continuait d'onduler comme s'il rampait ; un poisson mort nageait »). Chaque action rend des courbes par image i et par position le long de la colonne
// k (0 = tete, 1 = queue) : onde (multiplicateur de l'onde de reptation / nage), lacet (courbure ajoutee, rad, ABSOLU comme l'onde), pitch (> 0 = tete
// LEVEE), roulis (rad, autour de l'axe du corps), lift (hauteur, unites), avance (translation avant, en longueurs de corps). La colonne est ANCREE
// vers l'arriere (le corps se replie sur lui-meme : la tete recule puis part en avant, longueurs d'os conservees).
//   attaque serpent : se dresse en S (anticipation ~0,3 s), detente de la tete en ~0,1 s, retour (la frappe d'un serpent dure 50-150 ms, precedee
//     d'un ramassement en S : Young 1991 / Moon 2000, valeurs de memoire) ; attaque poisson : C de recul puis detente avec coup de queue et avance
//     de la gueule (depart rapide « C-start », Domenici & Blake 1997 J Exp Biol 200, de memoire) ;
//   coup recu : onde de choc qui part de la tete le long de la colonne, recul decroissant ; mort : l'onde s'eteint, la tete tombe, retournement
//     ventre en l'air (poisson : derive vers le haut) ; manger : coup de gueule, onde de deglutition ; saut : ramassement, detente, arc dans
//     l'air ; se coucher : le corps se relache, spires lentes (serpent) / immobilite (poisson).
function actionSansPattes(allure, nage, T0, fps, Ltot, V) {
  if (!['attack', 'hit', 'death', 'eat', 'drink', 'jump', 'lie_down'].includes(allure)) return null;
  const fin = allure === 'death' || allure === 'lie_down';
  const nBase = Math.max(8, Math.round(T0 * fps));
  const nT = nBase + (fin ? 1 : 0), Tn = nBase / fps;
  const U = (i) => (fin ? i / (nT - 1) : i / nT);
  const amplitude = V.ampleur || 1;
  const env = (u, a, b) => (u <= a || u >= b ? 0 : Math.sin(Math.PI * (u - a) / (b - a)) ** 2);   // fenetre en cloche
  const lisse = (u, a, b) => { const x = Math.min(1, Math.max(0, (u - a) / (b - a))); return x * x * (3 - 2 * x); };
  const zero = () => 0;
  const AC = { nT, T: Tn, fin, onde: () => 1, lacet: zero, pitch: zero, roulis: zero, lift: zero, avance: zero, ancre: 0.7 };
  const S = (k, n) => Math.sin(2 * Math.PI * n * k);
  const decroit = (k, a) => Math.max(0, 1 - k / a);
  if (allure === 'attack' && !nage) {
    // 0-0,22 ramassement en S + tete levee, 0,22-0,34 detente, tenue puis retour progressif
    const ram = (u) => cles(u, [[0, 0], [0.22, 1], [0.27, 1], [0.38, 0], [0.5, 0], [1, 0]]);
    const dresse = (u) => cles(u, [[0, 0], [0.2, 1], [0.28, 0.75], [0.38, -0.1], [0.5, -0.08], [0.75, 0.05], [1, 0]]);   // la frappe finit tete a hauteur du sol (une tete pointee vers le bas souleverait tout l'arriere du corps)
    AC.onde = (i) => 1 - cles(U(i), [[0, 0], [0.1, 0.8], [0.3, 0.9], [0.8, 0.4], [1, 0]]);
    AC.lacet = (i, k) => amplitude * ram(U(i)) * 1.25 * S(k * 0.9, 1) * decroit(k, 0.95);
    AC.pitch = (i, k) => amplitude * dresse(U(i)) * 0.95 * decroit(k, 0.5);
    // frappe d'un serpent (Young 1991 ; Penning et al. 2016 : la frappe dure 50-150 ms, la tete parcourt ~0,3-0,5 L, precedee d'un ramassement du cou en S) :
    // ramassement plus net (-0,10 L) puis coup en 0,10 s (0,22 -> 0,29 de 1,4 s) jusqu'a +0,22 L, tenue, retour lent
    AC.avance = (i) => amplitude * (globalThis.__frappeSerpent !== false
      ? cles(U(i), [[0, 0], [0.22, -0.1], [0.32, 0.22], [0.44, 0.18], [0.8, 0.03], [1, 0]])
      : cles(U(i), [[0, 0], [0.22, -0.06], [0.3, 0.16], [0.42, 0.14], [0.8, 0.03], [1, 0]]));
    AC.roulis = (i) => 0.12 * amplitude * env(U(i), 0.2, 0.55);
    AC.ancre = 0.75;
  } else if (allure === 'attack') {
    const C = (u) => cles(u, [[0, 0], [0.3, 1], [0.36, 0.1], [0.5, -0.25], [0.8, 0], [1, 0]]);   // C de recul puis contre-courbure (coup de queue)
    AC.onde = (i) => 0.25 + 0.75 * lisse(U(i), 0.5, 0.9);
    AC.lacet = (i, k) => amplitude * C(U(i)) * 0.95 * Math.sin(Math.PI * (0.15 + 0.85 * k));
    AC.pitch = (i, k) => -amplitude * 0.35 * env(U(i), 0.28, 0.6) * decroit(k, 0.4);   // gueule qui plonge sur la cible
    AC.avance = (i) => amplitude * cles(U(i), [[0, 0], [0.3, -0.05], [0.4, 0.3], [0.55, 0.22], [1, 0]]);
    AC.roulis = (i) => 0.15 * amplitude * env(U(i), 0.3, 0.7);
    AC.ancre = 0.5;
  } else if (allure === 'hit') {
    // onde de choc : courbure qui part de la tete (k = 0) et descend la colonne ; recul du corps puis retour amorti
    AC.onde = (i) => 0.35 + 0.65 * lisse(U(i), 0.55, 1);
    AC.lacet = (i, k) => amplitude * 1.1 * Math.sin(2 * Math.PI * (2.4 * k - 3.2 * U(i))) * Math.exp(-3.2 * U(i)) * (0.4 + 0.6 * (1 - k)) * lisse(U(i), 0, 0.06) * (1 - lisse(U(i), 0.55, 0.9));
    AC.pitch = (i, k) => amplitude * (nage ? 0 : 0.5) * Math.exp(-4 * U(i)) * decroit(k, 0.5) * Math.sin(Math.PI * Math.min(1, U(i) * 6)) * (1 - lisse(U(i), 0.6, 1));
    AC.avance = (i) => -amplitude * 0.14 * cles(U(i), [[0, 0], [0.12, 1], [0.35, 0.55], [0.7, 0.1], [1, 0]]);
    AC.roulis = (i) => (nage ? 0.35 : 0.15) * amplitude * Math.sin(2 * Math.PI * 1.5 * U(i)) * Math.exp(-3 * U(i)) * (1 - lisse(U(i), 0.6, 1));
    AC.ancre = 0.8;
  } else if (allure === 'death' && !nage) {
    // 0-0,3 l'onde s'eteint, la tete se dresse une derniere fois puis retombe ; 0,28-0,85 retournement ventre en l'air ; spasme final
    AC.onde = (i) => 1 - lisse(U(i), 0, 0.35);
    AC.lacet = (i, k) => amplitude * (lisse(U(i), 0.1, 0.6) * 0.55 * S(k * 0.8, 1) + 0.35 * env(U(i), 0.82, 1) * S(k, 2) * Math.sin(2 * Math.PI * 4 * U(i))) * decroit(k, 1.05);
    AC.pitch = (i, k) => amplitude * cles(U(i), [[0, 0], [0.12, 0.7], [0.3, 0.55], [0.5, -0.05], [1, -0.05]]) * decroit(k, 0.45);
    AC.roulis = (i, k) => Math.PI * lisse(U(i), 0.28, 0.85) * (0.75 + 0.25 * Math.cos(Math.PI * k)) + 0.2 * env(U(i), 0.85, 1) * Math.sin(2 * Math.PI * 3 * U(i));
    AC.ancre = 0.7;
  } else if (allure === 'death') {
    AC.onde = (i) => 1 - lisse(U(i), 0, 0.5);
    AC.lacet = (i, k) => amplitude * 0.22 * lisse(U(i), 0.2, 0.8) * S(k, 0.75) * decroit(k, 1.1);
    AC.pitch = (i, k) => -amplitude * 0.3 * lisse(U(i), 0.1, 0.8) * decroit(k, 0.5);   // la tete s'incline vers le bas
    AC.roulis = (i) => Math.PI * lisse(U(i), 0.15, 0.8) + 0.12 * env(U(i), 0.5, 1) * Math.sin(2 * Math.PI * 2 * U(i));
    AC.lift = (i) => 0.06 * Ltot * lisse(U(i), 0.3, 1);                    // ventre en l'air, le poisson mort remonte lentement
    AC.avance = (i) => 0.06 * lisse(U(i), 0.2, 1);
    AC.ancre = 0.5;
  } else if (allure === 'eat') {
    // deux prises (coup de gueule) puis onde de deglutition qui descend de la tete vers le tiers du corps
    const bouchee = (u) => env(u, 0.1, 0.32) + 0.8 * env(u, 0.45, 0.62);
    AC.onde = (i) => 0.35 + 0.65 * (1 - Math.min(1, bouchee(U(i))));
    AC.pitch = (i, k) => amplitude * (nage ? -0.4 : -0.55) * bouchee(U(i)) * decroit(k, 0.35) + (nage ? 0 : 0.45) * env(U(i), 0.0, 0.1) * decroit(k, 0.4);
    AC.avance = (i) => (nage ? 0.12 : 0.07) * amplitude * bouchee(U(i));
    AC.lacet = (i, k) => (nage ? 0.0 : 0.4) * env(U(i), 0.6, 1) * Math.sin(2 * Math.PI * (2 * k - 3 * (U(i) - 0.6))) * decroit(k, 0.8);
    AC.ancre = 0.7;
  } else if (allure === 'drink') {
    // la tete descend au contact de l'eau (0-0,18), reste en bas en lapant par petits coups (6 en 4,5 s), le corps presque immobile, puis remonte (0,82-1)
    const bas = (u) => cles(u, [[0, 0], [0.18, 1], [0.82, 1], [1, 0]]);
    AC.onde = (i) => 0.2 + 0.8 * (1 - bas(U(i)));
    AC.pitch = (i, k) => amplitude * (-(nage ? 0.3 : 0.5) * bas(U(i)) + 0.07 * bas(U(i)) * Math.sin(2 * Math.PI * 6 * U(i))) * decroit(k, 0.35);
    AC.avance = (i) => 0.03 * amplitude * bas(U(i));
    AC.lacet = (i, k) => 0.12 * bas(U(i)) * Math.sin(2 * Math.PI * (1.5 * k - 0.5 * U(i))) * decroit(k, 0.9);
    AC.ancre = 0.7;
  } else if (allure === 'jump') {
    const arc = (u) => 4 * u * (1 - u);
    AC.onde = (i) => (nage ? 0.5 + 0.5 * env(U(i), 0.2, 0.8) : 0.15);
    AC.lacet = (i, k) => (nage ? 0.1 : amplitude * 1.1 * cles(U(i), globalThis.__bondSerpent === false ? [[0, 0], [0.25, 1], [0.32, 0], [1, 0]] : [[0, 0], [0.25, 1], [0.42, 0], [1, 0]]) * S(k * 0.9, 1) * decroit(k, 0.95));
    AC.pitch = (i, k) => amplitude * (nage || globalThis.__bondSerpent === false ? 1 : 0.45) * cles(U(i), [[0, 0], [0.25, 0.4], [0.35, 0.9], [0.55, 0.1], [0.8, -0.9], [0.9, -0.2], [1, 0]]) * decroit(k, 0.7);
    AC.lift = (i) => (nage ? 0.38 : globalThis.__bondSerpent !== false ? 0.1 : 0.3) * Ltot * amplitude * (U(i) > 0.3 && U(i) < 0.88 ? arc((U(i) - 0.3) / 0.58) ** 2 : 0);   // serpent : bond BAS (28/10, le corps ne se dressait pas : lift 0,3 L et tangage 0,9 rad = piquet vertical)
    AC.avance = (i) => amplitude * (nage ? 0.8 : 0.55) * lisse(U(i), 0.3, 0.88) + (nage ? 0 : -0.05 * env(U(i), 0.05, 0.3));
    AC.ancre = 0.9;
  } else {
    // lie_down : serpent = spires lentes ; poisson = onde qui s'eteint, tete qui s'incline
    AC.onde = (i) => 1 - 0.85 * lisse(U(i), 0, 0.6);
    AC.lacet = (i, k) => (nage ? 0.12 : 0.9) * lisse(U(i), 0.1, 0.9) * S(k * 0.9, 1.5) * decroit(k, 1.0);
    AC.pitch = (i, k) => amplitude * (nage ? -0.15 * lisse(U(i), 0, 1) : 0.5 * env(U(i), 0, 0.5)) * decroit(k, 0.4);
    AC.ancre = 0.7;
  }
  return AC;
}

/* TETE / QUEUE D'UN SERPENT PAR L'EPAISSEUR DU MAILLAGE (25/10, user : « le serpent a la tete et la queue inversees »). colonneAxiale devine la tete par la
 * direction +Z, ce qui ne dit rien d'un corps couche le long de X (serpent, ver) : le rig du user avait sa racine a la QUEUE, le serpent rampait a reculons. Un serpent
 * s'amincit vers la queue : on mesure le rayon moyen du maillage (distance au squelette) sur le premier et le dernier ~15 % de la colonne ; le bout le plus EPAIS
 * est la tete (rapport >= 1,3 : sinon on ne change rien). Mesure sur le serpent du user : 0,012 (racine) contre 0,039 (bout) = 3,3 x. */
function choisirTeteParRayons(rayonDebut, rayonFin) {
  if (!(rayonDebut > 0) || !(rayonFin > 0)) return 0;
  if (rayonFin >= 1.3 * rayonDebut) return 1;        // le DERNIER os de la colonne est la tete : il faut retourner la colonne
  if (rayonDebut >= 1.3 * rayonFin) return -1;       // le premier os est deja la tete
  return 0;                                          // indecis : comportement d'origine
}
function rayonsAuxBouts(sq, chemin) {
  const { json, bin, P0 } = sq;
  if (!json.meshes || chemin.length < 4) return null;
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const lire = (i) => {
    const a = json.accessors[i], bv = json.bufferViews[a.bufferView];
    if (a.componentType !== 5126 || a.sparse) return null;
    const off = (bv.byteOffset || 0) + (a.byteOffset || 0), st = bv.byteStride || 12, out = new Float64Array(a.count * 3);
    for (let k = 0; k < a.count; k++) for (let c = 0; c < 3; c++) out[k * 3 + c] = dv.getFloat32(off + k * st + c * 4, true);
    return out;
  };
  const cum = [0];
  for (let i = 1; i < chemin.length; i++) cum.push(cum[i - 1] + norm(sub(P0[chemin[i]], P0[chemin[i - 1]])));
  const L = cum[cum.length - 1];
  if (!(L > 1e-9)) return null;
  const bords = [0, 0, 0, 0];                       // somme et nombre de sommets : [debut s, debut n, fin s, fin n]
  for (const m of json.meshes) for (const pr of m.primitives || []) {
    if (!pr.attributes || pr.attributes.POSITION == null) continue;
    const P = lire(pr.attributes.POSITION);
    if (!P) continue;
    const nV = P.length / 3, pas = Math.max(1, Math.floor(nV / 12000));
    for (let v = 0; v < nV; v += pas) {
      const x = P[3 * v], y = P[3 * v + 1], z = P[3 * v + 2];
      let meilleur = Infinity, pos = 0;
      for (let i = 1; i < chemin.length; i++) {
        const a = P0[chemin[i - 1]], b = P0[chemin[i]];
        const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ap = [x - a[0], y - a[1], z - a[2]];
        const l2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2] || 1e-12;
        const t = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / l2));
        const d = Math.hypot(ap[0] - t * ab[0], ap[1] - t * ab[1], ap[2] - t * ab[2]);
        if (d < meilleur) { meilleur = d; pos = cum[i - 1] + t * (cum[i] - cum[i - 1]); }
      }
      if (pos <= 0.15 * L) { bords[0] += meilleur; bords[1]++; } else if (pos >= 0.85 * L) { bords[2] += meilleur; bords[3]++; }
    }
  }
  if (bords[1] < 20 || bords[3] < 20) return null;
  return { debut: bords[0] / bords[1], fin: bords[2] / bords[3] };
}
function animerSansPattes(sq, allure, cycles, fps, variante, det, raison = 'reptation', nage = false) {
  const { par, P0 } = sq, J = par.length, E = enfantsDe(par);
  const racine = det.racine, sol = det.sol, H = Math.max(ptpAxe(P0, 1), 1e-6), ext = Math.max(etendue(P0), 1e-6);
  const B = ALLURES[allure], V = (VARIANTES[allure] || {})[variante] || {};
  let pas = B.pas;
  const chemin = colonneAxiale(par, P0, racine);
  if (raison === 'reptation' && !nage && globalThis.__teteParEpaisseur !== false) {   // serpent / ver : la tete est le bout le plus EPAIS du maillage (25/10)
    try { const r = rayonsAuxBouts(sq, chemin); if (r && choisirTeteParRayons(r.debut, r.fin) === 1) chemin.reverse(); } catch (_) { /* sans maillage lisible : comportement d'origine */ }
  }
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
  // actions (attaque, coup recu, mort, manger, saut, coucher) : clips dedies, joues une fois (voir actionSansPattes)
  const AC = !vertical && mode === 'reptation' && (globalThis.__actionsSansPattes !== false)
    ? actionSansPattes(allure, nage, (B.T ? B.T[0] : 1.3) * (V.T || 1), fps, Ltot, V) : null;
  if (AC) pas = false;
  const T = AC ? AC.T : Math.max(2, Math.round((allure === 'idle' ? (nage ? 1.8 : 4.0) : allure === 'run' ? 0.8 : 1.3) * (V.T || 1) * fps)) / fps;
  const nT = AC ? AC.nT : Math.max(2, Math.round((allure === 'idle' ? 1 : cycles) * T * fps));
  const t = Array.from({ length: nT }, (_, i) => i / fps);
  const L = mode === 'reptation' ? Ltot : ext;
  const lambda = (chenille ? 0.8 : cetace ? 1.1 : anguille ? 0.65 : nage ? 1.0 : 0.7) * L;
  const amp = (allure === 'idle' ? 0.03 : allure === 'run' ? 0.12 : nage ? 0.09 : 0.09) * L * (V.h || 1)
    * (chenille ? 0.4 : cetace ? 1.1 : 1);
  // vitesse d'avance : fraction de la vitesse de l'onde (nage : glissement ~0,3) ; serpent : sans glissement
  // (la trace est alors periodique en un cycle, la boucle se ferme) ; chenille : 0,2 L par cycle
  const vOnde = lambda / T;
  const v = pas ? (mode !== 'reptation' ? 0.35 * L / T : chenille ? 0.2 * L / T : nage ? 0.7 * vOnde : vOnde) * (V.foulee || 1) : 0;
  let w = pas ? (B.lacet || 0) * (V.lacet || 1) : 0;
  // COURBURE DE VIRAGE BORNEE (28/10) : un serpent tourne en arc large (rayon >= ~2 L). Avec un lacet impose en rad/s, la courbure w/v = 1/L : le corps entier s'enroulait sur un
  // cercle (axe du corps a 30 deg de la direction d'avance, racine retournee de plus de 150 deg, derive laterale x3). On borne la courbure a kappaMax = 0,5 / L (sans effet sur les autres modes).
  if (pas && mode === 'reptation' && !nage && !vertical && v > 1e-9 && globalThis.__virageBorne !== false) {
    const wMax = (globalThis.__kappaVirage || 0.3) / L * v; if (Math.abs(w) > wMax) w = Math.sign(w) * wMax;
  }
  // CAP DU CORPS AU REPOS (27/10, user : « le serpent marche en travers ») : la marche partait toujours vers +z ; un serpent couche le long de X (queue -> tete) avancait donc a 90 degres de son corps
  // (meme defaut que la frappe, corrige le 26/10). On tourne la trajectoire pour que « devant » = la direction queue -> tete (au tiers de la colonne). Interrupteur : __marcheAxeCorps = false.
  let fx = 0, fz = 1;
  if (globalThis.__marcheAxeCorps !== false && !AC && chemin.length >= 3) {
    const m = Math.min(chemin.length - 1, Math.max(1, Math.round(0.3 * (chemin.length - 1))));
    const hx = P0[chemin[0]][0] - P0[chemin[m]][0], hz = P0[chemin[0]][2] - P0[chemin[m]][2], hn = Math.hypot(hx, hz);
    if (hn > 1e-6) { fx = hx / hn; fz = hz / hn; }
  }
  const versCap = (x, z) => [x * fz + z * fx, -x * fx + z * fz];   // (x, z) dans le repere « devant = +z » -> repere du corps (devant = (fx, fz))
  const cheminCorps = (tt) => {
    const cap = w * tt;
    const c0 = Math.abs(w) < 1e-9 ? [0, 0, v * tt] : [(v / w) * (1 - Math.cos(cap)), 0, (v / w) * Math.sin(cap)];
    const [cx, cz] = versCap(c0[0], c0[2]);
    return { c: [cx, c0[1], cz], cap };
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
        const sg = (n - 0.5) * ds, th = kappa * (sg - 0.5 * Ltot) + Math.atan(amp * kO * Math.cos(kO * sg));
        tx[n] = tx[n - 1] + ds * Math.sin(th); tz[n] = tz[n - 1] + ds * Math.cos(th);
      }
      const en = (sg) => { const f = Math.max(0, sg) / ds, n0 = Math.min(Math.floor(f), nS - 2), r_ = f - n0; return [tx[n0] + r_ * (tx[n0 + 1] - tx[n0]), tz[n0] + r_ * (tz[n0 + 1] - tz[n0])]; };
      const g0 = en(Ltot);
      for (let i = 0; i < nT; i++) for (let k = 0; k < chemin.length; k++) {
        const q = en(Ltot + v * t[i] - s[k]);
        const [qx, qz] = versCap(q[0] - g0[0], q[1] - g0[1]);
        X[k][i] = [P0[chemin[0]][0] + qx, P0[chemin[k]][1], P0[chemin[0]][2] + qz];
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
          R_ = Ry(Math.atan(amp * (AC ? AC.onde(i) : 1) * env * 2 * Math.PI / lambda * Math.cos(phi)) - kappa * sm + (AC ? AC.lacet(i, u_) : 0));
          if (AC) {
            const pit = AC.pitch(i, u_);
            if (pit) R_ = mm(rotvec(cross(mv(R_, repos), [0, 1, 0]), -pit), R_);     // pitch > 0 = tete LEVEE : les os partant de la tete descendent
          }
        }
        p = add(p, mv(mm(Rc, R_), repos));
        pts.push(p);
      }
      // la tête mène le chemin ; la colonne garde sa hauteur de repos (bosses au-dessus du sol)
      const tete = add(P0[chemin[0]], c);
      const Xi = pts.map((q) => add(tete, q));
      if (AC) {                                                  // la colonne est ancree vers l'arriere : le corps se replie, la tete recule / bondit
        const ka = Math.min(chemin.length - 1, Math.round(AC.ancre * (chemin.length - 1)));
        // cap du corps AU REPOS (queue -> tete, a plat) : l'avance part DANS l'axe du corps. Avant (26/10) elle partait toujours vers +z : sur un rig couche le long de X
        // (le serpent du user) la « frappe » glissait de COTE (derive laterale 0,12 L) et la tete ne gagnait que ~0,05 L vers l'avant.
        let fx = 0, fz = 1;
        if (globalThis.__avanceAxeCorps !== false) {
          const hx = P0[chemin[0]][0] - P0[chemin[ka]][0], hz = P0[chemin[0]][2] - P0[chemin[ka]][2], hn = Math.hypot(hx, hz);
          if (hn > 1e-6) { fx = hx / hn; fz = hz / hn; }
        }
        const av = AC.avance(i) * Ltot;
        const dx = P0[chemin[ka]][0] - Xi[ka][0] + av * (globalThis.__avanceAxeCorps !== false ? fx : 0), dz = P0[chemin[ka]][2] - Xi[ka][2] + av * fz;
        for (const q of Xi) { q[0] += dx; q[2] += dz; }
      }
      // chenille : les bosses se posent sur le sol (rien dessous). Cetace : en pleine eau, pas de sol : on releve
      // le corps d'une constante (jamais sous sa hauteur de repos) au lieu de le faire rebondir.
      const creux = cetace ? -1.1 * amp * (1 + 0) : Math.min(...Xi.map((q, k) => q[1] - P0[chemin[k]][1]));
      Xi.forEach((q, k) => { q[1] -= creux; if (AC) q[1] += AC.lift(i); X[k][i] = q; });
    }
    chemin.forEach((j, k) => positions.set(j, X[k]));
    // rotation de chaque joint de la colonne : aligne ses os de colonne (1 ou 2 enfants sur le chemin)
    const surChemin = new Set(chemin);
    for (const j of chemin) {
      const enfantsC = E[j].filter((c) => surChemin.has(c));
      if (!enfantsC.length) continue;
      const Pj = positions.get(j);
      const kj = s[chemin.indexOf(j)] / Ltot;
      rotImposees.set(j, t.map((_, i) => {
        let Dr, dirN;
        if (enfantsC.length === 1) {
          const c = enfantsC[0];
          dirN = sub(positions.get(c)[i], Pj[i]);
          Dr = alignerLacet(sub(P0[c], P0[j]), dirN);
        } else {
          const [a, b] = enfantsC;
          dirN = sub(positions.get(b)[i], positions.get(a)[i]);
          Dr = alignerLacet(sub(P0[b], P0[a]), dirN);
        }
        return AC ? mm(rotvec(dirN, AC.roulis(i, kj)), Dr) : Dr;       // roulis autour de l'axe du corps (retournement ventre en l'air)
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
  // NAGEOIRES (28/10, defaut Q11 : « les pectorales restaient immobiles, seule la colonne ondulait ») : chaque chaine hors colonne rattachee a la colonne bat
  // lentement, dephasee de l'onde au point d'attache (pectorales / pelviennes : +-20 deg, nageoire dorsale : balancement lateral +-7 deg), l'extremite
  // suit avec retard et moins d'amplitude (follow-through).
  const nageoires = new Map();
  if (nage && mode === 'reptation' && globalThis.__nageoires !== false) {
    const surC = new Set(chemin), xMid_ = median(chemin.map((k) => P0[k][0]));
    for (const j of ordre) {
      if (surC.has(j) || par[j] < 0 || !surC.has(par[j])) continue;
      const lat = P0[j][0] - xMid_, lateral_ = Math.abs(lat) > 0.03 * ext;
      const ks = chemin.indexOf(par[j]);
      let sm_ = 0;
      for (let k = 0; k < ks; k++) sm_ += norm(sub(P0[chemin[k + 1]], P0[chemin[k]]));
      const pile_ = [[j, 0]];
      while (pile_.length) {
        const [u_, d_] = pile_.pop();
        nageoires.set(u_, { side: lateral_ ? Math.sign(lat) : 1, amp: (lateral_ ? 0.36 : 0.12) * (cetace ? 0.5 : 1) * Math.pow(0.75, d_), d: d_, sm: sm_, lat: lateral_ });
        for (const e_ of E[u_]) pile_.push([e_, d_ + 1]);
      }
    }
  }
  for (let i = 0; i < nT; i++) {
    for (const j of ordre) {
      if (rotImposees.has(j)) D[i][j] = rotImposees.get(j)[i];
      else if (par[j] < 0) D[i][j] = mode === 'reptation' && positions.size ? (rotImposees.get(chemin[0])?.[i] || Rb[i]) : Rb[i];
      else if (nageoires.has(j)) {
        const f_ = nageoires.get(j), ph_ = 2 * Math.PI * (f_.sm / lambda - t[i] / T) - 1.1 - 0.6 * f_.d;
        D[i][j] = mm(D[i][par[j]], Rz(f_.side * f_.amp * (AC ? 0.3 + 0.7 * AC.onde(i) : (allure === 'idle' ? 0.6 : 1)) * Math.sin(ph_)));
      }
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
// ici on vise le LISIBLE a 30 images/s : 1,1 a 1,7 Hz (2e tour) (un battement rapide sous-echantillonne donnerait un tremblement).
// 25/10 (2e tour, « realisme a l'oeil ») : le battement n'est plus une sinusoide symetrique.
//  - abattement (descente de l'aile, la propulsion) plus LONG que la remontee : ~57-60 % du cycle en vol de croisiere
//    (Tobalske 2007 ; Hedrick, Tobalske & Biewener 2002, J Exp Biol 205 : rapport abattement / cycle 0,5-0,6 selon la vitesse),
//    ~52 % en vol stationnaire (battement quasi symetrique des colibris et des insectes : Ellington 1984) ;
//  - a la remontee, l'aile se REPLIE (coude et poignet flechis, le bout de l'aile balaie vers l'arriere : Tobalske & Dial 1996,
//    pigeon, J Exp Biol 199 ; Hedrick et al. 2002) : « fold » en rad, applique aux articulations distales ;
//  - vol stationnaire : corps CABRE, tete en haut (angle du corps 30-50 deg chez les insectes qui font du sur-place, Ellington
//    1984 ; ~20-30 deg chez les oiseaux), plan de battement horizontal : forte amplitude.
const PROFILS_VOL = {
  idle: { T: 1.0, amp: 0.55, total: 1.0, lift: 0.10, avance: 0, tangage: -0.45, roulis: 0.03, descente: 0.5, fold: 0.15 },    // vol stationnaire : corps cabre
  walk: { T: 0.78, amp: 0.65, total: 0.9, lift: 0.14, avance: 1.2, tangage: 0.10, roulis: 0.04, descente: 0.55, fold: 0.3, plane: 3 }, // vol de croisiere (plane : 3 battements puis 1 temps de plane ailes etendues)
  run: { T: 0.6, amp: 0.8, total: 1.1, lift: 0.16, avance: 2.6, tangage: 0.24, roulis: 0.05, descente: 0.58, fold: 0.3 },    // vol rapide : battement ample, corps incline vers l'avant
  turn_left: { T: 0.78, amp: 0.65, total: 0.9, lift: 0.14, avance: 1.0, tangage: 0.10, roulis: 0.04, descente: 0.55, fold: 0.3 },
  turn_right: { T: 0.78, amp: 0.65, total: 0.9, lift: 0.14, avance: 1.0, tangage: 0.10, roulis: 0.04, descente: 0.55, fold: 0.3 },
};
for (const a_ of ['attack', 'hit', 'death', 'eat', 'jump', 'lie_down']) PROFILS_VOL[a_] = { ...PROFILS_VOL.idle, tangage: -0.2, avance: 0 };   // actions : base = vol stationnaire (voir actionVol)
// ------------------------------------------------------------------ ACTIONS EN VOL (28/10, defaut Q2 : « en mode vol, les actions retombaient sur le calcul terrestre : le dragon attaquait debout,
// ailes figees en T, et mourait comme un quadrupede »). Courbes de l'instant normalise u (0..1) : amp (multiplicateur de l'amplitude de battement), haut (ailes
// relevees, rad), fold (ailes repliees contre le corps, 0..1), tang (tangage ajoute, + = nez bas), roul (roulis, rad), lift (hauteur, en H), avance (en
// etendues), pattes (1 = repliees, 0 = tendues pour se poser), teteStab (part du tangage compensee par le cou ; 0,8 = tete stabilisee).
//   attaque : ramassement (ailes hautes, corps cabre) puis piquee corps incline, battement ample, retour ; coup recu : a-coup de tangage + roulis
//   amortis, battement desordonne ; mort : ailes qui se replient, chute en vrille puis pose sur le flanc (accelerations de la chute libre) ;
//   saut : battement fort + montee ; manger : vol stationnaire, tete qui plonge deux fois ; se coucher : atterrissage (ailes freinent, pattes tendues, ailes repliees).
function actionVol(allure) {
  const K = (u, c) => cles(Math.min(1, Math.max(0, u)), c);
  const zero = () => 0;
  const un = () => 1;
  const AV = { fin: false, amp: un, haut: zero, fold: zero, tang: zero, roul: zero, lift: zero, avance: zero, pattes: un, teteStab: 0.8 };
  const env = (u, a, b) => (u <= a || u >= b ? 0 : Math.sin(Math.PI * (u - a) / (b - a)) ** 2);
  if (allure === 'attack') {
    AV.amp = (u) => K(u, [[0, 1], [0.22, 0.35], [0.34, 1.5], [0.6, 1.2], [0.85, 1], [1, 1]]);
    AV.haut = (u) => K(u, [[0, 0], [0.22, 0.9], [0.34, -0.2], [0.6, 0], [1, 0]]);
    AV.tang = (u) => K(u, [[0, 0], [0.22, -0.45], [0.36, 0.95], [0.55, 0.7], [0.8, 0.15], [1, 0]]);
    AV.lift = (u) => K(u, [[0, 0], [0.22, 0.2], [0.42, -0.12], [0.62, -0.05], [1, 0]]);
    AV.avance = (u) => K(u, [[0, 0], [0.22, -0.05], [0.42, 0.5], [0.7, 0.3], [1, 0]]);
    AV.roul = (u) => 0.14 * env(u, 0.3, 0.8);
    AV.teteStab = 0.3;
  } else if (allure === 'hit') {
    const rp = (u) => Math.min(1, Math.max(0, u / 0.07)) ** 2 * (3 - 2 * Math.min(1, Math.max(0, u / 0.07)));   // entree douce : le clip part de la pose de repos
    AV.amp = (u) => 1 + 0.7 * Math.sin(2 * Math.PI * 3.2 * u) * Math.exp(-3 * u) * rp(u);
    AV.fold = (u) => 0.45 * env(u, 0, 0.35);
    AV.tang = (u) => -0.6 * Math.exp(-4.5 * u) * Math.cos(2 * Math.PI * 1.8 * u) * (1 - u * u) * rp(u);
    AV.roul = (u) => 0.5 * Math.exp(-3 * u) * Math.sin(2 * Math.PI * 2.3 * u) * (1 - u * u) * rp(u);
    AV.lift = (u) => -0.14 * Math.exp(-5 * u) * Math.sin(Math.PI * Math.min(1, u * 3));
    AV.avance = (u) => -0.25 * K(u, [[0, 0], [0.12, 1], [0.5, 0.35], [1, 0]]);
    AV.teteStab = 0.5;
  } else if (allure === 'death') {
    AV.fin = true;
    AV.amp = (u) => K(u, [[0, 1], [0.12, 1.3], [0.38, 0.3], [0.55, 0], [1, 0]]);
    AV.fold = (u) => K(u, [[0, 0], [0.2, 0.05], [0.5, 0.9], [1, 1]]);
    AV.tang = (u) => K(u, [[0, 0], [0.3, 0.3], [0.6, 0.8], [0.84, 0.45], [1, 0.15]]);
    AV.roul = (u) => K(u, [[0, 0], [0.5, 2.8], [0.84, 7.2], [1, 7.854]]);                // 1 tour 1/4 de vrille : se pose sur le flanc
    AV.lift = (u) => K(u, [[0, 0], [0.15, 0.1], [0.4, -0.25], [0.7, -0.95], [0.86, -1.6], [0.9, -1.5], [0.95, -1.6], [1, -1.6]]);   // chute libre puis rebond amorti
    AV.avance = (u) => K(u, [[0, 0], [0.86, 0.5], [1, 0.55]]);
    AV.pattes = (u) => K(u, [[0, 1], [0.4, 0.6], [1, 0.3]]);
    AV.teteStab = 0.2;
  } else if (allure === 'jump') {
    AV.amp = (u) => K(u, [[0, 1], [0.2, 0.4], [0.35, 1.6], [0.7, 1.2], [1, 1]]);
    AV.haut = (u) => K(u, [[0, 0], [0.2, 0.8], [0.35, -0.2], [1, 0]]);
    AV.lift = (u) => K(u, [[0, 0], [0.2, -0.04], [0.5, 0.5], [0.85, 0.1], [1, 0]]);
    AV.tang = (u) => K(u, [[0, 0], [0.2, -0.3], [0.5, -0.2], [1, 0]]);
    AV.avance = (u) => K(u, [[0, 0], [0.5, 0.15], [1, 0]]);
  } else if (allure === 'eat') {
    const bouchee = (u) => env(u, 0.12, 0.38) + 0.8 * env(u, 0.52, 0.78);
    AV.amp = (u) => 0.75 - 0.2 * Math.min(1, bouchee(u));
    AV.tang = (u) => 0.4 * bouchee(u);
    AV.lift = (u) => -0.08 * bouchee(u);
    AV.avance = (u) => 0.08 * bouchee(u);
    AV.teteStab = -0.2;                                                                  // le cou accompagne et amplifie le plongeon
  } else if (allure === 'lie_down') {
    AV.fin = true;
    AV.amp = (u) => K(u, [[0, 1], [0.6, 0.55], [0.85, 0.15], [1, 0]]);
    AV.fold = (u) => K(u, [[0, 0], [0.6, 0], [0.92, 1], [1, 1]]);
    AV.lift = (u) => K(u, [[0, 0], [0.3, -0.1], [0.75, -0.95], [1, -1.2]]);
    AV.tang = (u) => K(u, [[0, 0], [0.5, -0.4], [0.82, -0.5], [0.92, -0.2], [1, 0]]);
    AV.avance = (u) => K(u, [[0, 0], [0.75, 0.45], [1, 0.45]]);
    AV.pattes = (u) => K(u, [[0, 1], [0.6, 1], [0.85, 0], [1, 0]]);
  } else return null;
  return AV;
}
function animerVol(sq, allure, cycles, fps, variante, det) {
  const { par, P0 } = sq, J = par.length, E = enfantsDe(par);
  const { racine, queues, tetes, pattes } = det;
  const H = Math.max(ptpAxe(P0, 1), 1e-6), ext = Math.max(etendue(P0), 1e-6);
  const B = ALLURES[allure], V = (VARIANTES[allure] || {})[variante] || {};
  const PV = PROFILS_VOL[allure] || PROFILS_VOL.walk;
  const T0 = PV.T * (V.T || 1);
  const AV = globalThis.__actionsVol === false ? null : actionVol(allure);
  // PLANE (28/10, defaut Q9 : « battement continu sans plane ») : en croisiere, n battements puis 1 temps ailes etendues, immobiles, le corps perd un peu de hauteur
  // (oiseaux de proie, grands oiseaux : vol « battu-plane » intermittent, Rayner 1985 ; Tobalske 2007 : cycles de battements puis de plane) ; la boucle contient un nombre entier de motifs
  const planeur = !AV && !!PV.plane && globalThis.__planeVol !== false;
  const nCycles = planeur ? Math.max(1, Math.round(cycles / 2)) * (PV.plane + 1)
    : allure === 'idle' ? Math.max(3, Math.round(cycles)) : Math.max(1, Math.round(cycles));
  const dureeAct = Math.max(8, Math.round(((B.T ? B.T[0] : 1.4) * (V.T || 1)) * fps));       // action : jouee UNE fois
  const nT = AV ? dureeAct + (AV.fin ? 1 : 0) : Math.max(2, Math.round(nCycles * T0 * fps));
  const nFlaps = AV ? Math.max(1, Math.round(dureeAct / (T0 * fps))) : nCycles;
  const T = AV ? dureeAct / (nFlaps * fps) : nT / (nCycles * fps);   // periode : nombre ENTIER d'images par cycle (la boucle se referme)
  const uu = (tt) => (AV && AV.fin ? tt * fps / (nT - 1) : tt * fps / nT);               // instant normalise de l'action
  const ss01 = (x) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };
  const gl = (tt) => {                                                                  // 1 = battement, 0 = plane
    if (!planeur) return 1;
    const b = ((tt / T) % (PV.plane + 1) + (PV.plane + 1)) % (PV.plane + 1), n = PV.plane;
    return b < n - 0.6 ? 1 : b < n ? 1 - ss01((b - (n - 0.6)) / 0.6) : b < n + 0.4 ? 0 : ss01((b - n - 0.4) / 0.6);
  };
  const t = Array.from({ length: nT }, (_, i) => i / fps);
  const w = B.lacet || 0;                                      // rad/s, + = vers la gauche
  const v = PV.avance * (V.foulee || 1) * ext * 0.9;           // vitesse d'avance (unites / s)
  const cheminCorps = (tt) => {
    const cap = w * tt;
    const c = Math.abs(w) < 1e-9 ? [0, 0, v * tt] : [(v / w) * (1 - Math.cos(cap)), 0, (v / w) * Math.sin(cap)];
    if (AV) c[2] += AV.avance(uu(tt)) * ext;
    return { c, cap };
  };
  const phi = (tt) => 2 * Math.PI * tt / T;                    // phase de battement : sin > 0 = aile en HAUT
  // forme du battement : tau = 0 aile tout en haut, abattement jusqu'a tau = Dn (aile tout en bas), puis remontee. Onde en cosinus par
  // morceaux, derivee nulle aux deux extremes (continue : aucun a-coup). onde = +1 en haut, -1 en bas.
  const Dn = PV.descente ?? 0.5;
  const tauDe = (ph) => ((((ph - Math.PI / 2) / (2 * Math.PI)) % 1) + 1) % 1;
  const onde = (ph) => { const u = tauDe(ph); return u < Dn ? Math.cos(Math.PI * u / Dn) : -Math.cos(Math.PI * (u - Dn) / (1 - Dn)); };
  const remontee = (ph) => { const u = tauDe(ph); return u < Dn ? 0 : Math.sin(Math.PI * (u - Dn) / (1 - Dn)); };   // cloche pendant la remontee
  const abattement = (ph) => { const u = tauDe(ph); return u < Dn ? Math.sin(Math.PI * u / Dn) : 0; };
  // --- ailes : feuilles laterales hors pattes / queues / tetes (meme critere que le leger battement des quadrupedes a ailes)
  const xMid = median(P0.map((p) => p[0]));
  const pris = new Set([...pattes].flatMap((q) => sousArbre(E, q.chaine[0])));
  [...tetes, ...queues].forEach((c) => c.forEach((k) => pris.add(k)));
  const ailes = [];
  // 28/10 (defaut vol-lowpoly-ailes-asymetriques) : une aile dont le bout est FOURCHU (deux phalanges au bout d'un meme os) etait coupee a la fourche :
  // seule la phalange la plus profonde battait (2 os sur 6), l'autre aile battait sur toute sa chaine -> amplitude du simple au triple. On remonte maintenant a travers
  // un os dont les AUTRES enfants ne sont que des fragments (sous-arbre <= 2 os, sans lateralite propre), et on part des feuilles les plus profondes pour que
  // la chaine principale soit prise en premier ; les feuilles deja couvertes sont ignorees.
  const profondeur = new Array(J).fill(0);
  for (let j = 0; j < J; j++) { let k = j, d = 0; while (par[k] >= 0) { k = par[k]; d++; } profondeur[j] = d; }
  const taille = (j) => 1 + E[j].reduce((s_, e_) => s_ + taille(e_), 0);
  const feuilles = [];
  for (let f = 0; f < J; f++) if (!E[f].length && !pris.has(f) && Math.abs(P0[f][0] - xMid) >= 0.12 * ext) feuilles.push(f);
  feuilles.sort((a, b) => profondeur[b] - profondeur[a] || a - b);
  const couverts = new Set();
  for (const f of feuilles) {
    if (couverts.has(f)) continue;
    const c = [f];
    let k = f;
    while (par[k] >= 0 && !pris.has(par[k]) && (E[par[k]].length === 1 || E[par[k]].filter((e_) => e_ !== k).every((e_) => taille(e_) <= 2 && !c.includes(e_)))) { k = par[k]; c.push(k); }
    c.reverse();
    if (c.length < 2 || par[c[0]] < 0 || c.some((x_) => couverts.has(x_))) continue;
    c.forEach((x_) => couverts.add(x_));
    for (const x_ of c) for (const e_ of E[x_]) if (taille(e_) <= 2) couverts.add(e_);
    ailes.push({ chaine: c, cote: P0[f][0] > xMid ? 1 : -1 });
  }
  // 28/10 (defaut vol-lowpoly-pattes-ailes-confondues) : une patte avant attachee au thorax, a l'ecart du plan median, passait pour une AILE (4 ailes pour un dragon a 2 ailes
  // + 2 pattes avant non detectees) et battait avec elles. Sur un meme cote, une chaine nettement plus COURTE (< 60 % de la plus longue : une paire d'ailes d'insecte,
  // elle, a des longueurs voisines) n'est pas une aile : elle est traitee comme une patte (repliee).
  const longueurChaine = (c) => { let L_ = 0; for (let q = 1; q < c.length; q++) L_ += Math.hypot(...sub(P0[c[q]], P0[c[q - 1]])); return L_; };
  const pattesExtra = [];
  for (const cote_ of [-1, 1]) {
    const cand = ailes.filter((a) => a.cote === cote_);
    if (cand.length < 2) continue;
    const Lmax = Math.max(...cand.map((a) => longueurChaine(a.chaine)));
    for (const a of cand) if (longueurChaine(a.chaine) < 0.6 * Lmax) { pattesExtra.push({ chaine: a.chaine }); ailes.splice(ailes.indexOf(a), 1); }
  }
  const balance = new Map();                                   // joint -> rotations locales (par rapport au parent), une par image
  const ampAile = PV.amp * (V.h || 1);
  // 26/10 (banc de rendu visuel) : l'elevation du bout d'aile ne couvrait que 52 deg crete a crete en croisiere (62 en vol rapide) sur un rig reel, loin des 80-120 deg
  // cites ci-dessus : le retard de phase le long de la chaine (0,55 rad par os) fait perdre ~40 % de l'amplitude sommee. Facteur de compensation 1,6 (mesure : 52 -> ~85 deg).
  const FACTEUR_AILE = globalThis.__ailesAmples === false ? 1 : 1.6;
  for (const a of ailes) {
    // amplitude TOTALE du bout de l'aile (somme des rotations de la chaine) fixee, quelle que soit la longueur de la chaine : avant, une aile a
    // 4 articulations balayait ~170 deg crete a crete (bout d'aile du sol au-dessus de la verticale). Course des oiseaux : 80-120 deg crete a crete
    // (Tobalske & Dial 1996 ; Hedrick et al. 2002), vol stationnaire un peu plus.
    // 28/10 (defaut vol-3, ailes qui se croisent au-dessus du corps) : le battement est centre sur l'ELEVATION DE REPOS de l'aile. Un rig dont les ailes sont dressees au repos
    // (dragon : ~55 deg au-dessus de l'horizontale) battait de ~10 a ~77 deg : l'aile passait la verticale et croisait sa jumelle. On abaisse le centre du battement vers
    // l'horizontale (facteur 0,8 de l'elevation de repos, bornee a +-70 deg) : le battement se fait de part et d'autre du plan des epaules.
    const elRepos = Math.atan2(P0[a.chaine[a.chaine.length - 1]][1] - P0[a.chaine[0]][1], Math.abs(P0[a.chaine[a.chaine.length - 1]][0] - P0[a.chaine[0]][0]) + 1e-9);
    const centrage = globalThis.__ailesCentrees === false ? 0 : (globalThis.__centrageVol ?? 0.8) * Math.max(-1.22, Math.min(1.22, elRepos));
    const nArt = a.chaine.length - 1, somme = Array.from({ length: nArt }, (_, k) => Math.pow(0.72, k)).reduce((x, y) => x + y, 0);
    a.chaine.slice(0, -1).forEach((j, k) => {
      const amp = (PV.total ? PV.total * (V.h || 1) / somme : ampAile) * FACTEUR_AILE * Math.pow(0.72, k), retard = 0.55 * k;     // l'extremite suit avec retard et moins d'amplitude
      const repli = k >= 1 ? (PV.fold ?? 0) * (V.repli_aile ?? 1) * (k === 1 ? 1 : 0.6) : 0;     // coude / poignet flechis a la remontee, aile qui balaie vers l'arriere
      balance.set(j, t.map((tt) => {
        const u_ = uu(tt), ka = (AV ? AV.amp(u_) : 1) * gl(tt), fo = AV ? AV.fold(u_) : 0, ha = AV ? AV.haut(u_) * Math.pow(0.5, k) : 0;
        return mm(Ry(a.cote * (repli * remontee(phi(tt) - retard) * ka + (k >= 1 ? 1.4 * fo : 0))), Rz(a.cote * (amp * ka * onde(phi(tt) - retard) + (k === 0 ? 0.12 * ampAile - 1.3 * fo - centrage * (1 - Math.min(1, fo)) : 0) + ha)));
      }));
    });
  }
  // --- queue : ondulation douce, en retard sur le battement ; tete : contre-tangage
  const tangage = t.map((tt) => PV.tangage + 0.035 * Math.sin(phi(tt) + 0.6) + (AV ? AV.tang(uu(tt)) : 0));
  // 28/10 (defaut vol-1, dragon cabre : queue qui traine, cou dresse) : le repos d'un rig est souvent une posture DEBOUT (queue qui pend vers le sol, cou vertical). En vol le corps
  // est horizontal : chaque segment de queue / de cou est ramene vers l'horizontale (sa composante verticale est reduite d'un facteur), par la rotation MINIMALE qui amene le segment
  // sur la direction aplatie, cumulee le long de la chaine. Queue : tres aplatie (elle suit le corps) ; cou : a moitie (la tete garde son port naturel).
  const FLAT_QUEUE = globalThis.__aplatirVol === false ? 0 : 0.85, FLAT_COU = globalThis.__aplatirVol === false ? 0 : 0.5;
  const rotEntre = (a, b) => { const ax = cross(a, b), s_ = norm(ax), c_ = dot(a, b); return s_ < 1e-9 ? I3() : rotvec(ax, Math.atan2(s_, c_)); };
  const aplatir = (chaine, alpha) => {                         // rotation locale (par os) qui aplatit chaque segment ; rotation identite si alpha = 0
    const out = [];
    let C = I3();
    for (let k = 0; k < chaine.length - 1; k++) {
      const s_ = sub(P0[chaine[k + 1]], P0[chaine[k]]), n_ = norm(s_);
      if (alpha <= 0 || n_ < 1e-9) { out.push(I3()); continue; }
      const tg = [s_[0], s_[1] * (1 - alpha), s_[2]], tn = norm(tg);
      if (tn < 1e-9) { out.push(I3()); continue; }
      const u_ = mv(tr(C), mulS(tg, n_ / tn));
      const B = rotEntre(s_, u_);
      out.push(B); C = mm(C, B);
    }
    return out;
  };
  for (const cq of queues) {
    const fl = aplatir(cq, FLAT_QUEUE);
    cq.slice(0, -1).forEach((j, a) => {
      balance.set(j, t.map((tt) => mm(mm(Ry(0.14 * (a + 1) / cq.length * Math.sin(phi(tt) * 0.5 - 0.5 * a)), Rx(-0.10 * Math.sin(phi(tt) - 0.8 - 0.4 * a))), fl[a])));
    });
  }
  for (const ct of tetes) {
    const fl = aplatir(ct, FLAT_COU);
    ct.slice(0, -1).forEach((j, a) => {
      balance.set(j, t.map((tt, i) => mm(Rx((a === 0 ? -tangage[i] * (AV ? AV.teteStab : 0.8) : 0) + 0.03 * Math.sin(phi(tt) + 0.9)), fl[a])));
    });
  }
  // --- pattes : repliees vers l'arriere (hanche, puis chaque articulation) avec un leger balancement
  for (const p of [...pattes, ...pattesExtra]) {
    p.chaine.slice(0, -1).forEach((j, k) => {
      const repli = (k === 0 ? 0.55 : 0.75) * (V.repli ?? 1);
      balance.set(j, t.map((tt) => Rx(repli * (AV ? AV.pattes(uu(tt)) : 1) + 0.07 * Math.sin(phi(tt) - 0.4 * k))));
    });
  }
  // --- le corps : portance (monte a la descente de l'aile), tangage, roulis (penche dans les virages)
  const roulisVirage = Math.abs(w) > 1e-9 ? -Math.sign(w) * 0.35 : 0;
  const Rb = t.map((tt, i) => mm(Ry(cheminCorps(tt).cap), mm(Rz(roulisVirage + PV.roulis * Math.sin(phi(tt) + 1.2) + (AV ? AV.roul(uu(tt)) : 0)), Rx(tangage[i]))));
  // le corps MONTE a l'abattement (portance), redescend un peu a la remontee (Tobalske 2007 : oscillation verticale du corps en phase avec les ailes)
  const lift = (tt) => (PV.lift - 0.04 * (1 - gl(tt)) + 0.045 * PV.amp * gl(tt) * (AV ? AV.amp(uu(tt)) : 1) * (abattement(phi(tt) - 0.4) - 0.6 * remontee(phi(tt) - 0.4) - 0.2) + (AV ? AV.lift(uu(tt)) : 0)) * H;
  let altitude = 0;                                            // hauteur de vol AJOUTEE (calculee plus bas : les ailes ne doivent jamais toucher le sol)
  let racineMonde = t.map((tt) => add(add(P0[racine], cheminCorps(tt).c), [0, lift(tt), 0]));
  let racinesSec = sq.racines.filter((r) => r !== racine).map((r) => ({ j: r, pos: t.map((tt) => add(add(P0[r], cheminCorps(tt).c), [0, lift(tt), 0])) }));
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
  // --- altitude : un oiseau, une chauve-souris, un dragon en vol sont EN L'AIR. L'abattement de l'aile ne doit pas traverser le sol (chauve-souris :
  // bout d'aile a 185 % de sa hauteur sous le sol, le corps ne montait que de 0,14 H). On releve le tout d'une constante (la boucle reste fermee) pour que
  // le point le plus bas de tout le cycle reste a 3 % de la hauteur au-dessus du sol.
  {
    let basRel = Infinity;
    const Pr_ = new Array(J);
    for (let i = 0; i < nT; i++) {
      for (const j of ordre) Pr_[j] = par[j] < 0 ? P0[j] : add(Pr_[par[j]], mv(D[i][par[j]], sub(P0[j], P0[par[j]])));
      for (let j = 0; j < J; j++) basRel = Math.min(basRel, Pr_[j][1] + lift(t[i]));
    }
    altitude = Math.max(0, det.sol + 0.03 * H - basRel);
    // action qui finit POSEE (mort, atterrissage) : apres l'impact, le point le plus bas de chaque image est ramene sur le sol (la derniere image repose a 3 % du sol, pas
    // en l'air parce qu'une aile a frole le sol plus tot dans le clip) ; jamais de remontee, donc aucune penetration
    const calage = new Array(nT).fill(0);
    if (AV && AV.fin) {
      const u0_ = allure === 'death' ? 0.8 : 0.75, u1_ = allure === 'death' ? 0.9 : 0.95;
      for (let i = 0; i < nT; i++) {
        let bas_ = Infinity;
        for (const j of ordre) Pr_[j] = par[j] < 0 ? P0[j] : add(Pr_[par[j]], mv(D[i][par[j]], sub(P0[j], P0[par[j]])));
        for (let j = 0; j < J; j++) bas_ = Math.min(bas_, Pr_[j][1] + lift(t[i]) + altitude);
        calage[i] = ss01((uu(t[i]) - u0_) / (u1_ - u0_)) * Math.min(0, det.sol + 0.03 * H - bas_);
      }
      racineMonde = racineMonde.map((q, i) => add(q, [0, calage[i], 0]));
      racinesSec = racinesSec.map((r) => ({ j: r.j, pos: r.pos.map((q, i) => add(q, [0, calage[i], 0])) }));
    }
    if (altitude > 0) {
      racineMonde = racineMonde.map((q) => add(q, [0, altitude, 0]));
      racinesSec = racinesSec.map((r) => ({ j: r.j, pos: r.pos.map((q) => add(q, [0, altitude, 0])) }));
    }
  }
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
    chainesAplaties: [...queues, ...tetes].flatMap((c_) => c_.slice(0, -1)).filter(() => (FLAT_QUEUE > 0 || FLAT_COU > 0)),
    mode: 'vol', ailes: ailes.length, pattes: pattes.length, queues: queues.length, tetes: tetes.length, colonne: 0,
    periode: T, foulee: +(v * T).toFixed(3), images: nT,
    sous_sol_pct: +(100 * sousSol / H).toFixed(1), pire_os: pireOs, glissement_appui_pct: 0, acoups_max_deg: +(acoups * 180 / Math.PI).toFixed(1),
    battements_par_s: +(1 / T).toFixed(2),
    ...(AV ? { actionVol: allure } : {}),
  };
  return { nom: variante === 'normal' ? allure : `${allure}__${variante}`, R, racineMonde, racinesSec, infos };
}

// ------------------------------------------------------------------ POLISSAGE AUTOMATIQUE (2026-10-25, idee du user : « une IA qui realigne ce qui ne va pas »)
// Sans modele : un correcteur par OPTIMISATION sous GARDE. Apres le calcul d'un clip, on mesure ses defauts sur CE squelette (a-coups des articulations,
// pieds qui glissent en appui, os sous le sol), on essaie trois forces de lissage temporel des rotations locales (filtre circulaire : un clip de marche est
// periodique), et on GARDE le meilleur essai seulement s'il reduit les a-coups sans AUCUN recul sur le glissement des pieds et le sous-sol ; sinon le clip
// d'origine est rendu a l'octet. Desactivable : globalThis.__polissageAnimation = false. Rend aussi infos.poli = { applique, force, avant, apres }.
const FORCES_POLISSAGE = [0.35, 0.6, 0.85];
function _fkMonde(sq, clip) {
  const { par } = sq, J = par.length, nT = clip.R.length;
  const ordre = [], E = enfantsDe(par), file = [...sq.racines];
  while (file.length) { const j = file.shift(); ordre.push(j); file.push(...E[j]); }
  const D = Array.from({ length: nT }, () => new Array(J)), P = Array.from({ length: nT }, () => new Array(J));
  const sec = new Map((clip.racinesSec || []).map((r) => [r.j, r.pos]));
  for (let i = 0; i < nT; i++) {
    for (const j of ordre) {
      if (par[j] < 0) {
        D[i][j] = clip.R[i][j];
        P[i][j] = j === sq.racine ? clip.racineMonde[i] : (sec.get(j) ? sec.get(j)[i] : sq.P0[j]);
      } else {
        D[i][j] = mm(D[i][par[j]], clip.R[i][j]);
        P[i][j] = add(P[i][par[j]], mv(D[i][par[j]], sub(sq.P0[j], sq.P0[par[j]])));
      }
    }
  }
  return { D, P };
}
function _defautsClip(sq, clip, det) {
  const { par, P0 } = sq, J = par.length, nT = clip.R.length;
  const { D, P } = _fkMonde(sq, clip);
  const H = Math.max(ptpAxe(P0, 1), 1e-6), sol = det.sol;
  let sousSol = 0;
  for (let i = 0; i < nT; i++) for (let j = 0; j < J; j++) sousSol = Math.max(sousSol, sol - P[i][j][1]);
  // a-coups : plus grand changement de VITESSE angulaire d'une image a la suivante, sur les articulations des membres (comme animerAllure)
  const membres = new Set();
  for (const p of det.pattes) for (const j of p.chaine.slice(0, -1)) membres.add(j);
  for (const c of [...det.queues, ...det.tetes]) for (const j of c.slice(0, -1)) membres.add(j);
  let acoups = 0;
  for (const j of membres) {
    if (par[j] < 0) continue;
    let prec = null;
    for (let i = 1; i < nT; i++) {
      const w = angleRot(mm(tr(D[i - 1][j]), D[i][j]));
      if (prec !== null) acoups = Math.max(acoups, Math.abs(w - prec));
      prec = w;
    }
  }
  // glissement : vitesse horizontale moyenne du bout de chaque patte pendant l'appui (pied pres du sol), en fraction de la hauteur du corps
  let gl = 0, ng = 0;
  for (const p of det.pattes) {
    for (let i = 1; i < nT; i++) {
      const a = P[i - 1][p.bout], b = P[i][p.bout];
      if (Math.min(a[1], b[1]) - sol < 0.04 * H) { gl += Math.hypot(b[0] - a[0], b[2] - a[2]); ng++; }
    }
  }
  return { acoups: acoups * 180 / Math.PI, sousSol: 100 * sousSol / H, glissement: ng ? 100 * (gl / ng) / H : 0 };
}
function _lisserClip(sq, clip, force) {
  const nT = clip.R.length, J = sq.par.length;
  const R = clip.R.map((Ri) => Ri.map((m) => m.slice()));
  for (let j = 0; j < J; j++) {
    if (sq.par[j] < 0) continue;
    // articulation IMMOBILE sur tout le clip (pieds plantes d'une attente) : on n'y touche pas, sinon le bruit numerique du filtre ajoute des a-coups la ou il n'y en a aucun
    let mobile = false;
    for (let i = 1; i < nT && !mobile; i++) for (let k = 0; k < 9; k++) if (Math.abs(clip.R[i][j][k] - clip.R[0][j][k]) > 1e-6) { mobile = true; break; }
    if (!mobile) continue;
    for (let i = 0; i < nT; i++) {
      const a = clip.R[(i - 1 + nT) % nT][j], b = clip.R[i][j], c = clip.R[(i + 1) % nT][j];
      const m = new Array(9);
      for (let k = 0; k < 9; k++) m[k] = (1 - force) * b[k] + force * (0.25 * a[k] + 0.5 * b[k] + 0.25 * c[k]);
      R[i][j] = orthonormer(m);
    }
  }
  return { ...clip, R, infos: { ...clip.infos } };
}
function polirClip(sq, clip) {
  if (globalThis.__polissageAnimation === false || !clip || !clip.R || clip.R.length < 8) return clip;
  const nom = String(clip.nom || '');
  if (/^(death|lie_down|idle|eat|drink|attack|hit)/.test(nom)) return clip;   // actions et attente : mouvements uniques ou sans a-coups a corriger (le bruit du filtre y ajouterait 0,2 degre)
  try {
    const det = detecterPattes(sq.par, sq.P0, sq.racine);
    if (!det.pattes.length) return clip;
    const avant = _defautsClip(sq, clip, det);
    let meilleur = null;
    for (const f of FORCES_POLISSAGE) {
      const essai = _lisserClip(sq, clip, f);
      if (!essai.R.every((Ri) => Ri.every((m) => m.every(Number.isFinite)))) continue;
      const apres = _defautsClip(sq, essai, det);
      // GARDE : aucun recul sur le glissement ni sur le sous-sol ; gain d'a-coups d'au moins 5 %
      if (apres.glissement > avant.glissement + 0.05 || apres.sousSol > avant.sousSol + 0.1) continue;
      if (apres.acoups > avant.acoups * 0.95) continue;
      if (!meilleur || apres.acoups < meilleur.apres.acoups) meilleur = { essai, apres, f };
    }
    if (!meilleur) { if (clip.infos) clip.infos.poli = { applique: false, avant: _arr(avant) }; return clip; }
    meilleur.essai.infos.poli = { applique: true, force: meilleur.f, avant: _arr(avant), apres: _arr(meilleur.apres) };
    meilleur.essai.infos.acoups_max_deg = +meilleur.apres.acoups.toFixed(1);
    return meilleur.essai;
  } catch (e) { return clip; }
}
const _arr = (d) => ({ acoups: +d.acoups.toFixed(1), sous_sol_pct: +d.sousSol.toFixed(2), glissement_pct: +d.glissement.toFixed(2) });

/** Calcul protégé : une allure qui échoue ou rend une valeur invalide donne un mouvement minimal. */
// ------------------------------------------------------------------ mouvement SECONDAIRE (25/10, transversal)
// Queue, oreilles, cheveux, capes, ailes pendantes, encolure : une chaine libre n'est pas rigide, elle SUIT avec
// retard et rebondit. Chaque os candidat est un ressort du second ordre sur son orientation (repere du parent),
// pilote par l'acceleration de son pivot (inertie : force -a, couple d x (-a) / L) et par l'acceleration angulaire
// du parent (le corps tourne plus vite que l'os libre). Les os plus loin dans la chaine ont un pivot qui bouge
// DEJA a cause du ressort du parent : le « fouet » (follow-through) s'en deduit sans phase codee.
// Reperes : Thomas et Johnston 1981 (« The Illusion of Life », follow-through et overlapping action) ;
// reponse d'un pendule a une acceleration de son pivot (mecanique classique) ; frequences propres de la queue
// 1,5-3 Hz, des oreilles 4-6 Hz : reglages a l'oeil sur planches, pas de mesure publiee retenue.
// amplitude 0 = clip rendu tel quel (meme objet, a l'octet) ; 1 = reglage normal ; la boucle reste fermee.
export const SECONDAIRE = { amplitude: 1 };
export function reglerSecondaire(amplitude) { SECONDAIRE.amplitude = Math.max(0, Math.min(2, Number(amplitude) || 0)); return SECONDAIRE.amplitude; }
const CLASSES_SEC = {
  //          f : Hz propre (au bout), z : amortissement, g : gain, lim : angle max (rad), micro : derive lente (rad)
  queue: { f: 1.6, z: 0.50, g: 0.75, lim: 0.50, micro: 0.030 },
  leger: { f: 4.0, z: 0.40, g: 1.0, lim: 0.60, micro: 0.040 },     // oreilles, cheveux, pendentifs
  membre: { f: 3.0, z: 0.55, g: 0.35, lim: 0.20, micro: 0.008 },   // bras, ailes, capes : deja pilotes par la famille
  tete: { f: 3.2, z: 0.60, g: 0.40, lim: 0.12, micro: 0.006 },     // encolure, tete
  extremite: { f: 4.5, z: 0.50, g: 0.50, lim: 0.35, micro: 0.015 }, // oreilles, machoire, doigts : petites branches d'un membre ou d'une tete
};
function rodrigues(s) {
  const a = Math.hypot(s[0], s[1], s[2]);
  if (a < 1e-9) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const x = s[0] / a, y = s[1] / a, z = s[2] / a, c = Math.cos(a), sn = Math.sin(a), k = 1 - c;
  return [c + x * x * k, x * y * k - z * sn, x * z * k + y * sn, y * x * k + z * sn, c + y * y * k, y * z * k - x * sn, z * x * k - y * sn, z * y * k + x * sn, c + z * z * k];
}
function vecRot(m) {                                      // vecteur rotation (axe x angle) d'une matrice
  const c = Math.max(-1, Math.min(1, (m[0] + m[4] + m[8] - 1) / 2)), a = Math.acos(c);
  if (a < 1e-7) return [0, 0, 0];
  const sn = Math.sin(a);
  if (sn < 1e-4) return [0, 0, 0];                        // proche de pi : jamais d'une image a l'autre
  const k = a / (2 * sn);
  return [(m[7] - m[5]) * k, (m[2] - m[6]) * k, (m[3] - m[1]) * k];
}
function classerSecondaire(sq, det, H, descendre = false) {
  const { par, P0 } = sq, J = par.length, E = enfantsDe(par);
  const cls = new Array(J).fill(null);                    // os -> { type, pos, L }
  const exclus = new Set();
  for (const p of det.pattes) { p.chaine.forEach((k) => exclus.add(k)); sousArbre(E, p.chaine[0]).forEach((k) => exclus.add(k)); }
  for (const p of det.pattes) for (let k = par[p.chaine[0]]; k >= 0; k = par[k]) exclus.add(k);     // ancetres des pattes : colonne
  exclus.add(det.racine);
  const chaine = (c, type) => {
    const n = c.length;
    c.forEach((j, k) => {
      if (exclus.has(j) || cls[j] || par[j] < 0) return;
      let L = 0;                                          // longueur restante jusqu'au bout de la chaine
      for (let q = k; q < n - 1; q++) L += norm(sub(P0[c[q + 1]], P0[c[q]]));
      if (k === n - 1) L = Math.max(norm(sub(P0[j], P0[par[j]])) * 0.8, 0.02 * H);
      cls[j] = { type, pos: n > 1 ? k / (n - 1) : 0, L: Math.max(L, 0.08 * H) };
    });
  };
  det.queues.forEach((c) => chaine(c, 'queue'));
  det.tetes.forEach((c) => chaine(c, 'tete'));
  // appendices : sous-arbres hors colonne / pattes / queue / tete (oreilles, cheveux, bras, ailes, capes)
  // descendre (course anatomique) : une chaine deja classee DANS le sous-arbre d'un os du tronc (pagne, cheveux) ne doit pas condamner tout le torse (bras, clavicules) ; on
  // essaie alors les enfants de cet os comme racines d'appendice (les cas hors course gardent le comportement d'origine)
  for (let j = 0; j < J; j++) {
    if (cls[j] || exclus.has(j) || par[j] < 0) continue;
    if (!(exclus.has(par[j]) || cls[par[j]])) continue;                       // racine d'appendice : son parent est dans le tronc
    const sub_ = sousArbre(E, j);
    if (sub_.some((k) => exclus.has(k) || cls[k])) { if (descendre) exclus.add(j); continue; }
    const reach = Math.max(...sub_.map((k) => norm(sub(P0[k], P0[par[j]]))));
    const type = reach < 0.15 * H ? 'leger' : 'membre';
    const prof = (k) => { let n = 0; for (let q = k; q !== par[j]; q = par[q]) n++; return n; };
    const pmax = Math.max(...sub_.map(prof));
    for (const k of sub_) {
      let L = 0;
      for (const f of sub_) L = Math.max(L, norm(sub(P0[f], P0[k])));
      cls[k] = { type, pos: pmax > 1 ? (prof(k) - 1) / (pmax - 1) : 0, L: Math.max(L, 0.08 * H) };
    }
    if (type === 'membre') {                                                 // petites branches d'un membre / d'une tete : oreilles, machoire, doigts
      for (const b of sub_) {
        if (E[b].length < 2) continue;
        for (const ch of E[b]) {
          const st = sousArbre(E, ch);
          if (Math.max(...st.map((k) => norm(sub(P0[k], P0[b])))) >= 0.12 * H) continue;
          const pr = (k) => { let n = 0; for (let q = k; q !== b; q = par[q]) n++; return n; }, pm = Math.max(...st.map(pr));
          for (const k of st) { let L = 0; for (const f of st) L = Math.max(L, norm(sub(P0[f], P0[k]))); cls[k] = { type: 'extremite', pos: pm > 1 ? (pr(k) - 1) / (pm - 1) : 0, L: Math.max(L, 0.08 * H) }; }
        }
      }
    }
  }
  return cls;
}
/** Applique le mouvement secondaire a un clip calcule (periodique : la derniere image reboucle sur la premiere).
 *  Rend un NOUVEAU clip (le clip d'origine n'est jamais modifie), ou le clip lui-meme si rien a faire. */
function appliquerSecondaire(sq, c, allure, fps, amplitude = SECONDAIRE.amplitude, opts = {}) {
  if (!(amplitude > 0) || allure === 'death' || !c || !c.R || c.R.length < 8) return c;
  if (['reptation', 'secours', 'rigide', 'nage'].includes(c.infos && c.infos.mode) || (c.infos && c.infos.actionVol)) return c;
  const { par, P0 } = sq, J = par.length, N = c.R.length, E = enfantsDe(par);
  const det = detecterPattes(par, P0, sq.racine);
  const sol = det.sol, H = Math.max(ptpAxe(P0, 1), 1e-6);
  const cls = classerSecondaire(sq, det, H, !!opts.descendre);
  // vol (28/10) : queue et cou y sont deja ramenes vers l'horizontale par animerVol (position de repos du ressort = posture debout du rig, pendante) : le ressort les tirait
  // vers cette posture de repos et doublait les a-coups ; ils ne recoivent donc pas de mouvement secondaire de ressort (leur ondulation propre reste)
  if (c.infos && c.infos.chainesAplaties) for (const j of c.infos.chainesAplaties) cls[j] = null;
  if (opts.exclure) for (const j of opts.exclure) cls[j] = null;          // course anatomique : jambes, colonne, bassin, cou, tete gardent leur stabilite
  if (!cls.some(Boolean)) return c;
  const ordre = [], file = [sq.racine, ...sq.racines.filter((r) => r !== sq.racine)];
  while (file.length) { const j = file.shift(); ordre.push(j); file.push(...E[j]); }
  const dt = 1 / fps, W = (i) => ((i % N) + N) % N;
  // direction de repos de chaque os candidat (vers ses enfants, sinon prolongement de celle du parent)
  const dir0 = (j) => {
    let d = [0, 0, 0];
    for (const k of E[j]) d = add(d, sub(P0[k], P0[j]));
    if (norm(d) < 1e-9) d = sub(P0[j], P0[par[j]]);
    return norm(d) < 1e-9 ? [0, -1, 0] : mulS(d, 1 / norm(d));
  };
  const posSec = new Map((c.racinesSec || []).map((x) => [x.j, x.pos]));
  const calcul = (k) => {
    const R = c.R.map((Ri) => Ri.slice());
    const D = Array.from({ length: N }, () => new Array(J)), Pw = Array.from({ length: N }, () => new Array(J));
    let nOs = 0;
    for (const j of ordre) {
      const cj = cls[j];
      let Ej = null;
      if (cj && par[j] >= 0 && k > 0) {
        const K0 = CLASSES_SEC[cj.type], K = opts.amort && opts.amort !== 1 ? { ...K0, z: Math.min(0.95, K0.z * opts.amort) } : K0;
        // acceleration du pivot (monde) et acceleration angulaire du parent, lissees
        const pj = D.map((_, i) => add(Pw[i][par[j]], mv(D[i][par[j]], sub(P0[j], P0[par[j]]))));
        const lis = (V) => V.map((_, i) => { const a = V[W(i - 1)], b = V[i], d = V[W(i + 1)]; return [0.25 * a[0] + 0.5 * b[0] + 0.25 * d[0], 0.25 * a[1] + 0.5 * b[1] + 0.25 * d[1], 0.25 * a[2] + 0.5 * b[2] + 0.25 * d[2]]; });
        // le personnage AVANCE pendant le clip : la couture de la boucle n'est pas une acceleration. Le trajet est prolonge
        // par sa translation d'une boucle (nulle pour un clip sur place) ; pour un virage, la couture est remplacee par la moyenne des voisines.
        const dep = mulS(sub(pj[N - 1], pj[0]), N / (N - 1));
        const pe = (i) => (i < 0 ? sub(pj[i + N], dep) : i >= N ? add(pj[i - N], dep) : pj[i]);
        const acc0 = pj.map((_, i) => mulS(add(sub(pe(i + 1), mulS(pj[i], 2)), pe(i - 1)), fps * fps));
        if (c.infos && /^turn/.test(allure)) acc0[0] = acc0[N - 1] = mulS(add(acc0[1], acc0[N - 2]), 0.5);
        const acc = lis(lis(acc0));
        const pasMed = median(D.slice(0, N - 1).map((_, i) => angleRot(mm(D[i + 1][par[j]], tr(D[i][par[j]])))));
        const ferme = angleRot(mm(D[0][par[j]], tr(D[N - 1][par[j]]))) < 3 * pasMed + 0.02;      // orientation du parent revenue au depart ?
        const om = D.map((_, i) => (i === N - 1 && !ferme ? [0, 0, 0] : mulS(vecRot(mm(D[W(i + 1)][par[j]], tr(D[i][par[j]]))), fps)));       // vitesse angulaire (monde)
        if (!ferme) om[N - 1] = mulS(add(om[0], om[N - 2]), 0.5);
        const alp = lis(lis(om.map((_, i) => mulS(sub(om[i], om[W(i - 1)]), fps))));
        const d0 = dir0(j);
        const f0 = K.f * (1 + 0.5 * (1 - cj.pos)), w0 = 2 * Math.PI * f0;      // la base est plus raide que le bout
        const gain = K.g * (0.6 + 0.4 * cj.pos) * (cj.type !== 'queue' ? 1 : /^(attack|hit)/.test(allure) ? 1.8 : /^(walk|trot|turn)/.test(allure) ? 1.5 : 1);   // finesse : la queue fouette sur une action, balance davantage au pas
        const u = D.map((_, i) => {
          const Dt = tr(D[i][par[j]]);
          const aL = mv(Dt, acc[i]), alL = mv(Dt, alp[i]);
          const dl = mv(R[i][j], d0);
          const lin = mulS(cross(dl, mulS(aL, -1)), 0.9 / cj.L);
          let dr = add(mulS(lin, gain), mulS(alL, -gain));
          dr = sub(dr, mulS(dl, dot(dr, dl)));                    // pas de vrille autour de l'axe de l'os : seule la FLEXION se voit
          const m = norm(dr), cap = 1.5 * w0 * w0 * K.lim;         // pilote sature : jamais plus que la butee
          return m > 1e-12 ? mulS(dr, cap * Math.tanh(m / cap) / m) : dr;
        });
        // derive lente de periode « clip entier » (casse la boucle mecanique, reste periodique) : harmoniques 1 a 3
        const h = (j * 2654435761) >>> 0, ph = (q) => ((h >>> (3 * q)) & 255) / 255 * 2 * Math.PI;
        const micro = (i) => {
          const o = [0, 0, 0];
          for (let q = 1; q <= 3; q++) for (let ax = 0; ax < 3; ax++) o[ax] += Math.sin(2 * Math.PI * q * i / N + ph(q * 3 + ax - 3) + ax) / (q * 1.3);
          return mulS(o, K.micro * gain * w0 * w0 * 0.5);
        };
        const s = [0, 0, 0], v = [0, 0, 0], trace = [];
        const sousPas = 4, h_ = dt / sousPas, zw = 2 * K.z * w0;
        for (let tour = 0; tour < 5; tour++) {
          for (let i = 0; i < N; i++) {
            const ui = add(u[i], micro(i));
            for (let q = 0; q < sousPas; q++) for (let ax = 0; ax < 3; ax++) {
              v[ax] += (ui[ax] - zw * v[ax] - w0 * w0 * s[ax]) * h_;
              s[ax] += v[ax] * h_;
            }
            if (tour === 4) trace.push(s.slice());
          }
        }
        for (let q = 0; q < sousPas; q++) for (let ax = 0; ax < 3; ax++) {     // une image de plus : etat « image N », qui doit valoir l'image 0
          v[ax] += (u[0][ax] + micro(0)[ax] - zw * v[ax] - w0 * w0 * s[ax]) * h_;
          s[ax] += v[ax] * h_;
        }
        const e = sub(s, trace[0]);                          // ecart de bouclage, retire en rampe lineaire
        for (let i = 0; i < N; i++) trace[i] = sub(trace[i], mulS(e, i / N));
        Ej = trace.map((si) => {
          const a = norm(si);
          if (a < 1e-12) return I3();
          const a2 = K.lim * Math.tanh(a / K.lim) * amplitude * k;        // butee douce : jamais d'angle absurde
          return rodrigues(mulS(si, a2 / a));
        });
        nOs++;
      }
      for (let i = 0; i < N; i++) {
        if (Ej) R[i][j] = mm(Ej[i], R[i][j]);
        if (par[j] < 0) {
          D[i][j] = R[i][j];
          Pw[i][j] = j === sq.racine ? c.racineMonde[i] : (posSec.get(j) ? posSec.get(j)[i] : P0[j]);
        } else {
          D[i][j] = mm(D[i][par[j]], R[i][j]);
          Pw[i][j] = add(Pw[i][par[j]], mv(D[i][par[j]], sub(P0[j], P0[par[j]])));
        }
      }
    }
    let pire = 0;
    for (let i = 0; i < N; i++) for (let j = 0; j < J; j++) pire = Math.max(pire, sol - Pw[i][j][1]);
    return { R, pire: 100 * pire / H, n: nOs };
  };
  const ref = calcul(0);                                    // meme calcul sans ressort : reference des os sous le sol
  let k = 1, res = null;
  for (let essai = 0; essai < 5; essai++, k *= 0.6) {
    const r = calcul(k);
    if (r.pire <= ref.pire + 0.05) { res = r; break; }
  }
  if (!res || !res.n) return c;
  const infos = { ...c.infos, secondaire: { os: res.n, amplitude: +(amplitude * k).toFixed(2) } };
  infos.sous_sol_pct = Math.max(c.infos.sous_sol_pct ?? 0, +res.pire.toFixed(1));
  return { ...c, R: res.R, infos };
}

// ------------------------------------------------------------------ FINESSE TRANSVERSALE (26/10)
// Ce qui rend un cycle VIVANT au-dela de la cinematique de base : respiration asymetrique du thorax, evenements du repos
// (coup d'oeil, transfert de poids, coup de queue, battement d'oreille), anticipation de la tete en virage, derive lente
// du tronc d'un pas a l'autre, secousse des appendices a chaque appui, suite du mouvement (follow-through) des actions.
// Deux etapes : 1 = CORPS (colonne, tete, epaules ; AVANT le mouvement secondaire, qui reagit a ce que fait le tronc),
// 2 = APPENDICES (queue, oreilles ; APRES). Tout est additif sur les rotations locales, periodique ou nul aux bords
// (la boucle reste fermee), et les pattes dont un ancetre a bouge sont REPLANTEES (le pied garde sa position monde).
// Garde : un essai qui fait glisser les pieds ou passer un os sous le sol est repris a amplitude reduite (x0,6), puis abandonne.
// Interrupteurs : globalThis.__finesseAnimation = false, ou reglerFinesse(0).
export const FINESSE = { amplitude: 1 };
export function reglerFinesse(amplitude) { FINESSE.amplitude = Math.max(0, Math.min(2, Number(amplitude) || 0)); return FINESSE.amplitude; }
const _finH = (n) => { let h = (Math.imul(n | 0, 2654435761) >>> 0); h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13; return (h >>> 0) / 4294967296; };
function _finRng(graine) {
  let s = graine >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const _finLisse = (x) => { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * x * (x * (6 * x - 15) + 10); };        // smootherstep : vitesse et acceleration nulles aux bords
// bosse : 0 avant t0, monte (mont), tient (tenue), redescend (desc), 0 apres
const _finBosse = (t, t0, mont, tenue, desc) => {
  const s = t - t0;
  if (s <= 0) return 0;
  if (s < mont) return _finLisse(s / mont);
  if (s < mont + tenue) return 1;
  const d = (s - mont - tenue) / desc;
  return d >= 1 ? 0 : 1 - _finLisse(d);
};
// souffle : inspiration ~40 % du cycle, expiration ~60 %, chacune en ease-in/out (0 = expire)
const _finSouffle = (f) => { f -= Math.floor(f); return f < 0.4 ? 0.5 * (1 - Math.cos(Math.PI * f / 0.4)) : 0.5 * (1 + Math.cos(Math.PI * (f - 0.4) / 0.6)); };
const _finUnit = (v, repli = [0, 1, 0]) => { const n = norm(v); return n < 1e-9 ? repli : mulS(v, 1 / n); };

function _finContexte(sq, c, allure, fps) {
  const { par, P0 } = sq, J = par.length, E = enfantsDe(par);
  const det = detecterPattes(par, P0, sq.racine);
  if (!det.pattes.length) return null;
  const H = Math.max(ptpAxe(P0, 1), 1e-6);
  const cls = classerSecondaire(sq, det, H);
  let tetes = det.tetes;
  if (!tetes.length && det.pattes.length === 4) { const cou = encolure(par, P0, det.pattes, det.queues); if (cou) tetes = [cou]; }
  const tete = tetes.length ? tetes[0] : null;
  const racine = det.racine;
  const spine = [];
  if (tete) for (let k = par[tete[0]]; k >= 0 && k !== racine; k = par[k]) spine.unshift(k);
  const poids = spine.map((_, k) => (k + 1) / ((spine.length * (spine.length + 1)) / 2));      // le thorax / la nuque portent plus que le bassin
  const bip = det.pattes.length === 2, quad = det.pattes.length === 4;
  let droit = false;
  if (bip) {
    let sommet = racine;
    for (let j = 0; j < J; j++) if (!E[j].length && P0[j][1] > P0[sommet][1]) sommet = j;
    const voie = [];
    for (let k = sommet; k >= 0; k = par[k]) { voie.push(k); if (k === racine) break; }
    voie.reverse();
    const mid = voie[Math.floor(voie.length / 2)], v_ = sub(P0[mid], P0[racine]);
    droit = voie.length >= 3 && v_[1] > 2.0 * Math.hypot(v_[0], v_[2]);
  }
  const dir0 = (j) => {
    let d = [0, 0, 0];
    for (const k of E[j]) d = add(d, sub(P0[k], P0[j]));
    if (norm(d) < 1e-9 && par[j] >= 0) d = sub(P0[j], P0[par[j]]);
    return _finUnit(d, [0, -1, 0]);
  };
  const x0 = median(P0.map((p) => p[0])), ext = Math.max(...P0.map((p) => Math.abs(p[0] - x0)), 1e-6);
  // racines d'appendices
  const armRoots = [], oreilles = [], queueOs = [];
  for (let j = 0; j < J; j++) {
    const cj = cls[j];
    if (!cj || par[j] < 0) continue;
    if (cj.type === 'membre' && cj.pos === 0 && (spine.includes(par[j]) || par[j] === racine)) armRoots.push(j);
  }
  for (const q of det.queues) q.forEach((j) => { if (cls[j]) queueOs.push(j); });
  if (!droit) {
    const cand = (j) => cls[j] && (cls[j].type === 'leger' || cls[j].type === 'extremite');
    for (let j = 0; j < J; j++) {
      if (!cand(j) || (par[j] >= 0 && cand(par[j]))) continue;                 // racines de groupes
      const d = dir0(j);
      if (d[1] < 0.35 || Math.abs(P0[j][0] - x0) < 0.01 * ext) continue;       // une oreille monte, hors de l'axe (ni machoire ni hanche)
      const grp = [], pile = [j];
      while (pile.length) { const k = pile.pop(); grp.push(k); for (const f of E[k]) if (cand(f)) pile.push(f); }
      oreilles.push({ racine: j, os: grp, cote: P0[j][0] > x0 ? 1 : -1 });
    }
  }
  const graine = (J * 131 + racine * 7 + 17) + [...allure].reduce((s, ch) => s + ch.charCodeAt(0) * 31, 0);
  return { sq, det, cls, E, J, H, spine, poids, tete, racine, bip, quad, droit, dir0, armRoots, oreilles, queueOs, graine, x0 };
}

/** Rend les rotations modifiees d'un clip (copie), ou null. etape 1 = corps, 2 = appendices ; k = echelle d'amplitude. */
function _finCalcule(ctx, c, allure, fps, etape, k) {
  const { sq, det, cls, E, spine, poids, tete, bip, quad, droit, dir0, armRoots, oreilles, queueOs, H } = ctx;
  const par = sq.par, N = c.R.length, L = N / fps, B = ALLURES[allure];
  const idle = allure === 'idle', pasA = !!B.pas && !B.saut, tourne = allure === 'turn_left' || allure === 'turn_right';
  const nCycles = Math.max(1, Math.round(N / Math.max(1e-6, (c.infos.periode || 1) * fps)));
  const rng = _finRng(ctx.graine + 1000 * etape);
  const acc = new Map();
  const pousse = (j, i, v) => {
    if (j < 0 || par[j] < 0) return;
    let a = acc.get(j);
    if (!a) { a = new Float64Array(3 * N); acc.set(j, a); }
    a[3 * i] += v[0]; a[3 * i + 1] += v[1]; a[3 * i + 2] += v[2];
  };
  const Rn = c.R.map((Ri) => Ri.slice());
  // place un evenement de duree <= dureeMax dans la tranche q / n du clip (jamais dans les 0,4 s des bords : boucle fermee)
  const place = (q, n, dureeMax) => { const libre = L - 0.8 - dureeMax; if (libre <= 0) return -1; return 0.4 + ((q + 0.12 + 0.76 * rng()) / n) * libre; };
  const hoch = tete ? tete.slice(0, -1) : [];
  const teteOs = hoch.length ? hoch : (tete ? tete : []);
  const nTete = Math.max(teteOs.length, 1);

  if (etape === 1) {
    // ---- respiration (F2, F10) : le thorax, pas la racine
    if (spine.length && (idle || pasA)) {
      const nb = idle ? Math.max(2, Math.round(L * (quad ? 0.27 : 0.24))) : nCycles;       // repos ~15 / min ; en marche et en course : 1 souffle par foulee
      const amp0 = idle ? (droit ? 0.034 : quad ? 0.042 : 0.03) : (/^(run|trot)/.test(allure) ? 0.026 : 0.013);
      for (let i = 0; i < N; i++) {
        const u = i / N;
        const phi = idle ? nb * (u + 0.25 * Math.sin(4 * Math.PI * u) / (4 * Math.PI)) : nb * u;          // rythme irregulier mais ferme
        const mod = 1 + 0.4 * (_finH(Math.floor(phi) * 31 + ctx.J) - 0.5);
        const s = _finSouffle(phi) * mod * amp0 * k;
        spine.forEach((j, q) => pousse(j, i, [-s * poids[q], 0, 0]));                               // inspiration = poitrine qui s'ouvre, nez qui se releve
        if (droit && idle) for (const a of armRoots) pousse(a, i, [0, 0, (sq.P0[a][0] > ctx.x0 ? 1 : -1) * 0.03 * _finSouffle(phi) * mod * k]);
      }
    }
    if (idle && spine.length) {
      // ---- transfert de poids (F1, F8) : roulis lent du tronc, tete qui reste a l'horizontale
      const nS = Math.max(1, Math.round(L / 8));
      for (let q = 0; q < nS; q++) {
        const dMax = 1.4 + 3.2 + 1.8, t0 = place(q, nS, dMax);
        if (t0 < 0) continue;
        const sens = rng() < 0.5 ? -1 : 1, tenue = 1.4 + 1.8 * rng(), amp = (droit ? 0.034 : 0.03) * (0.7 + 0.6 * rng()) * sens * k;
        for (let i = 0; i < N; i++) {
          const p = _finBosse(i / fps, t0, 1.4, tenue, 1.8);
          if (p === 0) continue;
          spine.forEach((j, qq) => pousse(j, i, [0, 0.25 * amp * p * poids[qq], amp * p * poids[qq]]));
          teteOs.forEach((j) => pousse(j, i, [0, 0, -0.6 * amp * p / nTete]));
        }
      }
    }
    if (idle && tete) {
      // ---- coups d'oeil (F1, F3) : saccade, arret, retour ; la nuque suit un peu apres
      const nG = Math.max(2, Math.round(L / 6));
      for (let q = 0; q < nG; q++) {
        const tenue = 0.5 + 1.2 * rng(), t0 = place(q, nG, 0.16 + tenue + 0.45);
        if (t0 < 0) continue;
        const A = (0.32 + 0.32 * rng()) * (rng() < 0.5 ? -1 : 1) * (droit ? 0.8 : 1) * k, tang = (rng() - 0.5) * 0.14 * k;
        for (let i = 0; i < N; i++) {
          const t = i / fps, p = _finBosse(t, t0, 0.16, tenue, 0.45), ps = _finBosse(t, t0 + 0.12, 0.3, tenue, 0.55);
          if (p === 0 && ps === 0) continue;
          teteOs.forEach((j) => pousse(j, i, [tang * p / nTete, A * p / nTete, 0]));
          spine.forEach((j, qq) => pousse(j, i, [0, 0.14 * A * ps * poids[qq], 0]));
        }
      }
    }
    if (idle && droit && armRoots.length) {
      // ---- bras : derive lente decorrelee (periodes differentes gauche / droite)
      armRoots.forEach((a, n) => {
        const d = dir0(a), e1 = _finUnit(cross(d, [0, 1, 0]), [1, 0, 0]), e2 = _finUnit(cross(d, e1));
        const k1 = Math.max(1, Math.round(L / (4.6 + 1.9 * n))), k2 = k1 + 1 + (n % 2), p1 = rng() * 6.283, p2 = rng() * 6.283;
        for (let i = 0; i < N; i++) {
          const u = i / N, s1 = 0.03 * Math.sin(2 * Math.PI * k1 * u + p1) * k, s2 = 0.04 * Math.sin(2 * Math.PI * k2 * u + p2) * k;
          pousse(a, i, add(mulS(e1, s1), mulS(e2, s2)));
        }
      });
    }
    // ---- variation d'un cycle a l'autre (F5) : derive lente du tronc et de la tete, harmoniques ENTIERES du clip
    if (pasA && spine.length) {
      const ph = Array.from({ length: 8 }, () => rng() * 6.283);
      for (let i = 0; i < N; i++) {
        const u = i / N, w = (a, b) => 0.6 * Math.sin(2 * Math.PI * u + ph[a]) + 0.4 * Math.sin(4 * Math.PI * u + ph[b]);
        const lac = 0.019 * w(0, 1) * k, tan = 0.010 * w(2, 3) * k, rou = 0.013 * w(4, 5) * k;
        spine.forEach((j, q) => pousse(j, i, [tan * poids[q], lac * poids[q], rou * poids[q]]));
        teteOs.forEach((j) => pousse(j, i, [0.014 * w(6, 7) * k / nTete, 0.02 * w(1, 4) * k / nTete, 0]));
      }
    }
    // ---- la tete precede le corps en virage (F3) : lacet de la tete = avance du lacet du corps 0,3 s plus tard
    if (tourne && tete) {
      const yaw = [];
      let prec = 0;
      for (let i = 0; i < N; i++) {
        const m = c.R[i][det.racine];
        let y = Math.atan2(m[2], m[0]);
        if (i > 0) while (y - prec > Math.PI) y -= 2 * Math.PI, 0;
        if (i > 0) { while (y - prec > Math.PI) y -= 2 * Math.PI; while (y - prec < -Math.PI) y += 2 * Math.PI; }
        yaw.push(y); prec = y;
      }
      const tau = Math.round(0.3 * fps);
      for (let i = 0; i < N; i++) {
        const lead = 0.9 * (yaw[Math.min(N - 1, i + tau)] - yaw[i]) * _finLisse(i / (0.35 * fps)) * _finLisse((N - 1 - i) / (0.35 * fps)) * k;
        teteOs.forEach((j, q) => pousse(j, i, [0, lead * (q + 1) / (nTete * (nTete + 1) / 2), 0]));
        spine.forEach((j, q) => pousse(j, i, [0, 0.3 * lead * poids[q], 0]));
      }
    }
    // ---- suite du mouvement des actions (F4) : le tronc et la tete suivent avec retard et depassent un peu
    if (B.action && (B.action === 'attack' || B.action === 'hit') && (spine.length || teteOs.length)) {
      const f0 = 4.5, w0 = 2 * Math.PI * f0, z = 0.45, sous = 4, h = 1 / fps / sous;
      for (const j of [...spine, ...teteOs]) {
        const x = c.R.map((Ri) => vecRot(Ri[j]));
        const s = [0, 0, 0], v = [0, 0, 0], sortie = [];
        for (let tour = 0; tour < 4; tour++) for (let i = 0; i < N; i++) {
          for (let q = 0; q < sous; q++) for (let ax = 0; ax < 3; ax++) { v[ax] += (w0 * w0 * (x[i][ax] - s[ax]) - 2 * z * w0 * v[ax]) * h; s[ax] += v[ax] * h; }
          if (tour === 3) sortie.push(s.slice());
        }
        const e0 = sub(sortie[0], x[0]), e1 = sub(sortie[N - 1], x[N - 1]);                     // ecart de bouclage retire en rampe
        for (let i = 0; i < N; i++) {
          const corr = add(mulS(e0, 1 - i / (N - 1)), mulS(e1, i / (N - 1)));
          const y = sub(sortie[i], corr), m = 0.55 * k;
          Rn[i][j] = rodrigues(add(x[i], mulS(sub(y, x[i]), m)));
        }
      }
    }
  } else {
    // ---- evenements des appendices au repos (F1)
    if (idle) {
      const nQ = queueOs.length ? Math.max(1, Math.round(L / 7)) : 0;
      const lagMax = Math.min(queueOs.length, 12) * 0.07;
      for (let q = 0; q < nQ; q++) {
        const t0 = place(q, nQ, 2.0 + lagMax);
        if (t0 < 0) continue;
        const A = 0.5 * (0.7 + 0.6 * rng()) * (rng() < 0.5 ? -1 : 1) * k, n = queueOs.length;
        queueOs.forEach((j, r) => {
          const a = A / n * (0.6 + 0.8 * (n > 1 ? r / (n - 1) : 0)), lag = Math.min(r, 12) * 0.07;
          for (let i = 0; i < N; i++) {
            const s = i / fps - t0 - lag;
            if (s <= 0 || s > 2.0) continue;
            pousse(j, i, [0, a * Math.exp(-s / 0.45) * Math.sin(2 * Math.PI * 1.8 * s) * _finLisse(s / 0.08), 0]);
          }
        });
      }
      const nE = oreilles.length ? Math.max(2, Math.round(L / 5)) : 0;
      for (let q = 0; q < nE; q++) {
        const t0 = place(q, nE, 1.2);
        if (t0 < 0) continue;
        const g = oreilles[Math.floor(rng() * oreilles.length) % oreilles.length], cible = _finUnit([0, -0.4, -1]), A = 0.4 * (0.7 + 0.6 * rng()) * k;
        for (const j of g.os) {
          const d = dir0(j), ax = _finUnit(cross(d, cible), [1, 0, 0]), pos = cls[j] ? cls[j].pos : 0, a = A * (1 - 0.5 * pos);
          for (let i = 0; i < N; i++) {
            const s = i / fps - t0;
            if (s <= 0 || s > 1.2) continue;
            const env = s < 0.08 ? _finLisse(s / 0.08) : Math.exp(-(s - 0.08) / 0.18) * Math.cos(2 * Math.PI * 6 * (s - 0.08));
            pousse(j, i, mulS(ax, a * env));
          }
        }
      }
    }
    // ---- secousse des appendices a chaque appui du pied (F7)
    if (pasA && (queueOs.length || oreilles.length)) {
      const { D: Dm, P: Pm } = _fkMonde(sq, c);
      const seuil = 0.03 * H, sol = det.sol, plants = [];
      for (const p of det.pattes) for (let i = 0; i < N; i++) {
        const a = Pm[(i - 1 + N) % N][p.bout][1] - sol, b = Pm[i][p.bout][1] - sol;
        if (b < seuil && a >= seuil) plants.push(i);
      }
      if (plants.length) {
        const vite = /^run/.test(allure) ? 1.0 : /^trot/.test(allure) ? 0.8 : 0.55;
        const poidsPlant = 2 / det.pattes.length;
        const repondre = (j, amp, f, tau, bas) => {
          const d = dir0(j);
          let ax = cross(d, bas);
          if (norm(ax) < 0.3) ax = [1, 0, 0]; else ax = _finUnit(ax);
          for (const i0 of plants) for (let s = 0; s < 4 * tau * fps; s++) {
            const t = s / fps, i = (i0 + s) % N;
            pousse(j, i, mulS(ax, amp * poidsPlant * Math.exp(-t / tau) * Math.sin(2 * Math.PI * f * t)));
          }
        };
        const nq = queueOs.length;
        queueOs.forEach((j, r) => repondre(j, 0.2 * vite * k / Math.max(nq, 1) * (0.6 + 0.8 * (nq > 1 ? r / (nq - 1) : 0)) * 2, 2.2, 0.3, [0, -1, 0]));
        for (const g of oreilles) for (const j of g.os) repondre(j, 0.25 * vite * k * (1 - 0.5 * (cls[j] ? cls[j].pos : 0)), 6, 0.12, [0, -1, 0]);
      }
    }
  }
  if (!acc.size && etape === 2) return null;
  for (const [j, a] of acc) for (let i = 0; i < N; i++) {
    const v = [a[3 * i], a[3 * i + 1], a[3 * i + 2]];
    if (Math.abs(v[0]) + Math.abs(v[1]) + Math.abs(v[2]) < 1e-9) continue;
    Rn[i][j] = mm(rodrigues(v), Rn[i][j]);
  }
  return Rn;
}

/** Les pattes dont un ancetre a bouge gardent leur orientation ET leur pied : la rotation de la hanche absorbe le deplacement du pivot. */
function _finEpingler(sq, det, c, Rn) {
  const par = sq.par, N = Rn.length;
  const A = _fkMonde(sq, c), Bf = _fkMonde(sq, { ...c, R: Rn });
  for (const p of det.pattes) {
    const c0 = p.chaine[0], pp = par[c0], b = p.bout;
    if (pp < 0) continue;
    for (let i = 0; i < N; i++) {
      const dPos = sub(Bf.P[i][c0], A.P[i][c0]);
      if (norm(dPos) < 1e-8 && angleRot(mm(tr(A.D[i][pp]), Bf.D[i][pp])) < 1e-7) continue;
      const f = sub(A.P[i][b], A.P[i][c0]), f2 = dot(f, f);
      if (f2 < 1e-12) continue;
      const r = mulS(cross(f, mulS(dPos, -1)), 1 / f2);
      Rn[i][c0] = mm(tr(Bf.D[i][pp]), mm(rodrigues(r), A.D[i][c0]));
    }
  }
}

function ajouterFinesse(sq, c, allure, fps, etape) {
  if (globalThis.__finesseAnimation === false || !(FINESSE.amplitude > 0)) return c;
  if (!c || !c.R || c.R.length < 8 || allure === 'death' || !c.infos || c.infos.mode !== 'pattes') return c;
  const ctx = _finContexte(sq, c, allure, fps);
  if (!ctx) return c;
  const avant = _defautsClip(sq, c, ctx.det);
  let k = FINESSE.amplitude;
  for (let essai = 0; essai < 4; essai++, k *= 0.6) {
    const Rn = _finCalcule(ctx, c, allure, fps, etape, k);
    if (!Rn) return c;
    if (etape === 1) _finEpingler(sq, ctx.det, c, Rn);
    if (!Rn.every((Ri) => Ri.every((m) => m.every(Number.isFinite)))) return c;
    const c2 = { ...c, R: Rn, infos: { ...c.infos } };
    const ap = _defautsClip(sq, c2, ctx.det);
    if (ap.glissement <= avant.glissement + 0.05 && ap.sousSol <= avant.sousSol + 0.1) {
      c2.infos.finesse = { ...(c.infos.finesse || {}), ['etape' + etape]: +k.toFixed(2) };
      return c2;
    }
  }
  return c;
}

// ------------------------------------------------------------------ orientation du corps (28/10, « le renne avance de cote »)
// Le calcul suppose un rig « face +Z ». Un rig oriente autrement (renne : tete vers -X) avancait de cote. On determine l'AXE AVANT du corps a partir du squelette :
//  - quadrupede (4 pieds au sol, etalement des pieds nettement allonge, rapport des ecarts-types >= 2) : axe = direction d'etalement des pieds (ACP en plan) ; sens = la
//    ou se trouve le haut du corps (cou, tete) par rapport au centre des pieds ; sens indecidable (< 10 % H) -> on garde le sens le plus proche de +Z ;
//  - bipede (2 pieds) : axe lateral = ligne des deux pieds, avant = sa perpendiculaire du cote le plus proche de +Z (le sens ne se lit pas sur le squelette : mesure
//    sur humain, orc, gladiateur, poule : aucun indice fiable ; un bipede tourne de 180 deg n'est donc PAS corrige) ;
//  - sinon (serpent, araignee, 3 / 6 / 8 pattes, tortue, vol, nage, reptation) : rien.
// La detection des pattes depend elle-meme de l'orientation (lion tourne de 180 deg : 3 pattes sur 4) : on essaie 0, 180, +90, -90 deg et on garde le premier repere qui
// donne une detection exploitable. Rien n'est fait si l'avant est a moins de 30 deg de +Z (les rigs orientes +Z restent identiques a l'octet).
// Desactivable : globalThis.__orientationAxe = false.
const SEUIL_ORIENTATION = 30 * Math.PI / 180;
function analyseOrientation(par, P0, racine) {                 // -> { ok, phi } dans le repere P0 ; ok = detection exploitable
  const det = detecterPattes(par, P0, racine);
  const pieds = det.pattes.filter((p) => !p.levee).map((p) => P0[p.bout]);
  if (pieds.length !== det.pattes.length || (pieds.length !== 4 && pieds.length !== 2)) return { ok: false, phi: 0 };
  const cx = pieds.reduce((s, p) => s + p[0], 0) / pieds.length, cz = pieds.reduce((s, p) => s + p[2], 0) / pieds.length;
  let sxx = 0, szz = 0, sxz = 0;
  for (const p of pieds) { const a = p[0] - cx, c = p[2] - cz; sxx += a * a; szz += c * c; sxz += a * c; }
  const th = 0.5 * Math.atan2(2 * sxz, sxx - szz), ux = Math.cos(th), uz = Math.sin(th);   // axe principal d'etalement des pieds
  let fx, fz;
  if (pieds.length === 4) {
    const m = (sxx + szz) / 2, d = Math.hypot((sxx - szz) / 2, sxz), l1 = m + d, l2 = m - d;
    if (!(l2 > 0) || Math.sqrt(l1 / l2) < 2) return { ok: true, phi: 0 };
    const y0 = Math.min(...P0.map((p) => p[1])), H = Math.max(...P0.map((p) => p[1])) - y0;
    const hauts = P0.filter((p) => p[1] > y0 + 0.7 * H);
    if (!hauts.length) return { ok: true, phi: 0 };
    const hx = hauts.reduce((s, p) => s + p[0], 0) / hauts.length - cx, hz = hauts.reduce((s, p) => s + p[2], 0) / hauts.length - cz;
    const cue = (hx * ux + hz * uz) / H;
    const sg = Math.abs(cue) >= 0.1 ? Math.sign(cue) : (uz >= 0 ? 1 : -1);
    fx = sg * ux; fz = sg * uz;
  } else {
    const px = -uz, pz = ux, sg = pz >= 0 ? 1 : -1;            // bipede : avant = perpendiculaire a la ligne des pieds
    fx = sg * px; fz = sg * pz;
  }
  if (Math.acos(Math.max(-1, Math.min(1, fz))) < SEUIL_ORIENTATION) return { ok: true, phi: 0 };
  return { ok: true, phi: Math.atan2(-fx, fz) };               // Ry(phi) envoie l'avant sur +Z
}
function angleOrientation(sq, mode = 'auto') {
  if (globalThis.__orientationAxe === false || (mode !== 'auto' && mode !== 'pattes')) return 0;
  try {
    for (const psi of [0, Math.PI, Math.PI / 2, -Math.PI / 2]) {
      const Qp = Ry(psi), P = psi ? sq.P0.map((p) => mv(Qp, p)) : sq.P0;
      const r = analyseOrientation(sq.par, P, sq.racine);
      if (!r.ok) continue;
      let phi = r.phi + psi;
      if (Math.abs(phi) < 1e-9) return 0;
      phi = Math.atan2(Math.sin(phi), Math.cos(phi));
      const k90 = Math.round(phi / (Math.PI / 2)) * (Math.PI / 2);                // rig range le long d'un axe du repere (a 15 deg pres) : angle exact, pas l'ecart de l'ACP
      if (Math.abs(phi - k90) < 15 * Math.PI / 180) phi = k90;
      return Math.abs(phi) < 1e-6 ? 0 : phi;
    }
  } catch (_) { /* rig non analysable : inchange */ }
  return 0;
}

/** Calcule dans le repere « face +Z » (rig tourne autour de Y) puis ramene le resultat dans le repere reel : R_reel = Q^T R Q, positions = Q^T p. */
// ------------------------------------------------------------------ course ANATOMIQUE (28/10, groupe « course-anatomique »)
// Le user a juge la course precedente « pas du tout realiste » : en crabe, paumes vers le haut, coudes colles au corps, tete qui bouge beaucoup, corps tout droit.
// Cause : la course historique ajoute des courbes a des angles de repos du rig (bras en A ou en T, jambes ecartees) ; rien ne garantit la posture finale.
// Ici la pose est decrite par la CIBLE (directions des segments dans le monde, pied d'appui pose au sol), puis les rotations locales en sont deduites :
//  - jambes : cinematique inverse a deux os, genou vers l'AVANT ; le pied d'appui est verrouille (talon, a plat, puis pointe) ; phase aerienne ;
//  - racine : hauteur = la jambe d'appui garde sa longueur (compression), vol balistique ; avance a vitesse constante ;
//  - colonne : buste penche (inclinaison), bassin et epaules en contre-rotation, roulis et deport lateral faibles ;
//  - tete et cou : orientation fixe dans le monde (contre-rotation complete) ;
//  - bras : direction du bras et de l'avant-bras en fonction de la phase (ecart du coude, flexion, balancement en opposition avec les jambes) ; roulis de l'avant-bras
//    calcule pour que la paume reste neutre (face a face).
// Aucune regle par maillage : tout est derive des chaines detectees (jambes, colonne, bras) et de la pose de repos. Quelques reglages, proportionnels a la hauteur,
// sont lisibles et modifiables dans globalThis.__reglagesCourse ({ run: {...}, jog: {...}, sprint: {...} }). Desactivable : globalThis.__courseAnatomique = false.
// TORSE SOUPLE (29/10, groupe « torse-souple ») : le user a juge « buste verrouille ». Leviers (valeurs en degres crete-a-crete sauf mention) :
//  torseTorsion = torsion relative epaules-bassin (partagee : torsionBassin = part du bassin) ; torseOnde = retard (part de cycle) de l'onde du bassin vers les epaules ;
//  bassinObliquite = roulis du bassin ; torseFlexionLaterale = flexion laterale RELATIVE bassin-epaules ; torseTangage = tangage du thorax (a chaque pas) ;
//  teteSuivi / teteSuiviTangage = part du lacet-roulis / du tangage du thorax que la tete reprend (1 = la tete suit tout, 0 = fixe dans le monde) ; teteRetard = retard de la tete (part de cycle) ;
//  clavicule = protraction des clavicules (deg, amplitude) avec le balancement du bras ; asymetrieBras = ecart relatif d'amplitude gauche/droite ; retardCoude = retard de l'avant-bras (part de cycle).
// MAINS ET PROLONGEMENT (29/10, groupe « mains-prolongement ») : mainDoigts = flexion (deg) de la base des doigts (les phalanges suivantes : x mainDoigtsDist ; pouce : mainPouce ; mainDoigtsEtage = ecart de fermeture
//  index -> auriculaire ; mainDoigtsVar = part de variation des doigts avec le balancement) ; mainPoignetAmp = amplitude crete-a-crete (deg) du poignet qui suit l'avant-bras ; mainPoignetRetard = retard du poignet (part de cycle) ;
//  prolongement = amplitude du mouvement secondaire (ressorts d'ordre 2) sur bras, mains, clavicules et chaines libres (cheveux, vetements, queue) ; prolongementAmort = multiplicateur d'amortissement.
//  Les jambes, la colonne, le bassin, le cou et la tete en sont exclus. Interrupteurs : globalThis.__mainsDetendues = false, globalThis.__prolongementCourse = false.
// POIDS ET RYTHME (29/10, groupe « poids-rythme ») : poidsImpact = descente du bassin a l'attaque du pied (part de H, creux de forme gamma de pic poidsImpactTau secondes ; le genou d'appui se plie d'autant) ;
//  poidsTronc = tangage (deg) du tronc qui encaisse l'impact (amorti sur ~1,6 x poidsImpactTau) ; formeBras = deformation non sinusoidale du balancement des bras (0 = sinus ; retournement plus sec aux extremes = aux appuis) ;
//  variabilite (0-1) = variation lente de +/-25 % x variabilite de l'amplitude des bras et de la torsion et de +/-0,03 x variabilite de cycle de leur phase, a la periode du clip (boucle fermee ; sans effet si cycles < 2) ;
//  respiration = bascule (deg crete-a-crete) de la cage thoracique, respirationFreq = souffles par cycle. Interrupteur : globalThis.__poidsRythme = false.
//  Interrupteur : globalThis.__torseSouple = false (retour exact a l'etat precedent ; les anciens leviers bassinLacet / epaulesLacet / bassinRoulis ne servent alors que dans ce cas).
// 29/10 soir : jambes de course et de jog = reglages d'avant l'ajustement sur les vrais coureurs (Fukuchi) : l'ajustement, fait sur un seul rig, faisait
// glisser le pied d'appui ailleurs (fix_humain : 0 -> 2,6 % H en course, 1,7 -> 3,8 en jog ; vol du jog perdu sur le gladiateur). Le sprint garde l'ajustement (meilleur partout).
const COURSE_DEFAUT = {
  //          vitesse H/s | cadence pas/s | appui (part du cycle d'un pied) | buste deg | coude flexion deg | ecart du coude deg | bras avant / arriere deg
  run: { vitesse: 1.95, cadence: 3.1, appui: 0.405, buste: 8, coude: 90, coudeVar: 15, ecartCoude: 20, mainsRentrees: 8, brasAvant: 24, brasArriere: 55,
    talon: 10, poussee: 38, rebond: 0.008, compTete: 0.0, levee: 0.30, genou: 0.10, plat: 0.4, largeurPas: 0.7, bassinLacet: 6, epaulesLacet: 9, bassinRoulis: 2, deport: 0.012, teteTangage: 14, paume: 0, jambe: 0.985,
    torseTorsion: 24, torsionBassin: 0.4, torseOnde: 0.03, bassinObliquite: 6.5, torseFlexionLaterale: 4.5, torseTangage: 4, teteSuivi: 0.45, teteSuiviTangage: 0.7, teteRetard: 0.04, clavicule: 5, asymetrieBras: 0.07, retardCoude: 0.07,
    mainDoigts: 30, mainDoigtsDist: 1.5, mainPouce: 15, mainDoigtsVar: 0.15, mainDoigtsEtage: 0.12, mainPoignetAmp: 12, mainPoignetRetard: 0.07, prolongement: 1.5, prolongementAmort: 1,
    poidsImpact: 0.0035, poidsImpactTau: 0.045, poidsTronc: 2.0, formeBras: 0.12, variabilite: 0.3, respiration: 2.0, respirationFreq: 0.67 },
  jog: { vitesse: 1.4, cadence: 2.8, appui: 0.45, buste: 6, coude: 88, coudeVar: 8, ecartCoude: 18, mainsRentrees: 8, brasAvant: 16, brasArriere: 40,
    talon: 12, poussee: 32, rebond: 0.007, compTete: 0.0, levee: 0.22, genou: 0.06, plat: 0.4, largeurPas: 0.7, bassinLacet: 5, epaulesLacet: 7, bassinRoulis: 2, deport: 0.012, teteTangage: 12, paume: 0, jambe: 0.985,
    torseTorsion: 20, torsionBassin: 0.4, torseOnde: 0.03, bassinObliquite: 5.5, torseFlexionLaterale: 4, torseTangage: 3, teteSuivi: 0.45, teteSuiviTangage: 0.8, teteRetard: 0.04, clavicule: 4, asymetrieBras: 0.07, retardCoude: 0.07,
    mainDoigts: 28, mainDoigtsDist: 1.5, mainPouce: 14, mainDoigtsVar: 0.15, mainDoigtsEtage: 0.12, mainPoignetAmp: 10, mainPoignetRetard: 0.07, prolongement: 1.5, prolongementAmort: 1,
    poidsImpact: 0.0035, poidsImpactTau: 0.05, poidsTronc: 1.5, formeBras: 0.1, variabilite: 0.3, respiration: 1.6, respirationFreq: 0.67 },
  // marche (29/10) : double appui, jamais de vol ; rebond NEGATIF = bassin haut a mi-appui (le pas « enjambe »)
  walk: { vitesse: 0.80, cadence: 2.0, appui: 0.62, buste: 2, coude: 22, coudeVar: 8, ecartCoude: 10, mainsRentrees: 4, brasAvant: 16, brasArriere: 14,
    talon: 14, poussee: 36, rebond: -0.007, compTete: 0.0, levee: 0.05, genou: 0.03, plat: 0.40, largeurPas: 0.3, bassinLacet: 4, epaulesLacet: 5, bassinRoulis: 1.5, deport: 0.008, teteTangage: 0, paume: 0, jambe: 1.008, zlin: 0.1,
    torseTorsion: 11, torsionBassin: 0.4, torseOnde: 0.03, bassinObliquite: 4, torseFlexionLaterale: 3, torseTangage: 1.5, teteSuivi: 0.6, teteSuiviTangage: 1.0, teteRetard: 0.05, clavicule: 3, asymetrieBras: 0.07, retardCoude: 0.07,
    mainDoigts: 22, mainDoigtsDist: 1.5, mainPouce: 10, mainDoigtsVar: 0.15, mainDoigtsEtage: 0.12, mainPoignetAmp: 8, mainPoignetRetard: 0.06, prolongement: 1.6, prolongementAmort: 1,
    poidsImpact: 0.001, poidsImpactTau: 0.06, poidsTronc: 0.5, formeBras: 0.08, variabilite: 0.3, respiration: 1.2, respirationFreq: 0.34 },
  sprint: { vitesse: 3.4, cadence: 4.2, appui: 0.33, buste: 15, coude: 72, coudeVar: 28, ecartCoude: 18, mainsRentrees: 8, brasAvant: 38, brasArriere: 65,
    talon: 3, poussee: 35, rebond: 0.010, compTete: 0.0, levee: 0.3, genou: 0.12, plat: 0.4, largeurPas: 0.7, bassinLacet: 7, epaulesLacet: 11, bassinRoulis: 2, deport: 0.012, teteTangage: 20, paume: 0, jambe: 1.015,
    torseTorsion: 28, torsionBassin: 0.4, torseOnde: 0.03, bassinObliquite: 7, torseFlexionLaterale: 5, torseTangage: 5, teteSuivi: 0.55, teteSuiviTangage: 0.6, teteRetard: 0.04, clavicule: 6, asymetrieBras: 0.07, retardCoude: 0.07,
    mainDoigts: 36, mainDoigtsDist: 1.5, mainPouce: 20, mainDoigtsVar: 0.15, mainDoigtsEtage: 0.12, mainPoignetAmp: 14, mainPoignetRetard: 0.08, prolongement: 1.5, prolongementAmort: 1,
    poidsImpact: 0.003, poidsImpactTau: 0.035, poidsTronc: 2.5, formeBras: 0.14, variabilite: 0.3, respiration: 2.4, respirationFreq: 0.67 },
};
if (!globalThis.__reglagesCourse) globalThis.__reglagesCourse = JSON.parse(JSON.stringify(COURSE_DEFAUT));
const _lisse3 = (x) => { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); };
const _frac = (x) => x - Math.floor(x);
const _deg = Math.PI / 180;
function _cadre(s, a) {                                    // repere orthonormal dont l'axe 1 est `a` et dont l'axe 0 est `s` projete (colonnes s', a, s' x a)
  a = mulS(a, 1 / (norm(a) + 1e-12));
  let s2 = sub(s, mulS(a, dot(s, a)));
  if (norm(s2) < 1e-6) s2 = Math.abs(a[0]) < 0.9 ? cross(a, [1, 0, 0]) : cross(a, [0, 0, 1]);
  s2 = mulS(s2, 1 / norm(s2));
  const c = cross(s2, a);
  return [s2[0], a[0], c[0], s2[1], a[1], c[1], s2[2], a[2], c[2]];
}
const _viser = (restA, restS, cibleA, cibleS) => mm(_cadre(cibleS, cibleA), tr(_cadre(restS, restA)));   // rotation qui envoie (axe, cote) de repos sur (axe, cote) cibles

/** Bras (epaule, coude, main) d'un bipede droit : meme detection que animerAllure, reprise ici pour ne pas en dependre. */
function _brasCourse(sq, det) {
  const { par, P0, racine } = sq, J = par.length, E = enfantsDe(par);
  const xMid = median(P0.map((p) => p[0])), ext = etendue(P0);
  const pris = new Set([...det.pattes.flatMap((q) => sousArbre(E, q.chaine[0])), ...det.tetes.flat()]);
  const cote_ = (j) => Math.sign(P0[j][0] - xMid);
  const estMain = (j) => E[j].length >= 2 && !pris.has(j) && Math.abs(P0[j][0] - xMid) >= 0.15 * ext && E[j].every((e) => cote_(e) === cote_(j));
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
    let ep = -1;
    for (let a = 0; a < c.length - 1; a++) { const b = sub(P0[c[a + 1]], P0[c[a]]); if (b[1] < -0.5 * norm(b)) { ep = a; break; } }
    if (ep < 0) ep = c.length >= 4 && norm(sub(P0[c[1]], P0[c[0]])) < 0.7 * norm(sub(P0[c[2]], P0[c[1]])) ? 1 : 0;
    const portee = Math.abs(P0[f][0] - xMid), deja = parEpaule.get(c[0]);
    if (deja && deja.portee >= portee) continue;
    parEpaule.set(c[0], { epaule: c[ep], coude: c[Math.min(ep + 1, c.length - 2)], cote: P0[f][0] > xMid ? 1 : -1, moyeu: par[c[0]], main, portee });
  }
  const bras = [...parEpaule.values()];
  for (const b of bras) {                                  // main = enfant du coude qui porte le plus gros sous-arbre
    let m = -1;
    for (const k of E[b.coude]) if (m < 0 || sousArbre(E, k).length > sousArbre(E, m).length) m = k;
    b.poignet = m;
  }
  return bras.filter((b) => b.poignet >= 0);
}

/** Calcule le clip de course anatomique ; rend null si le squelette n'est pas un bipede droit complet (le calcul d'origine prend alors le relais). */
function courseAnatomique(sq, cycles, fps, variante = 'normal', allure = 'run') {
  if (globalThis.__courseAnatomique === false) return null;
  const marche = allure === 'walk';
  if (marche && (globalThis.__marcheAnatomique === false || variante !== 'normal')) return null;
  const { par, P0 } = sq, J = par.length, E = enfantsDe(par), racine = sq.racine;
  const det = detecterPattes(par, P0, racine);
  if (det.pattes.length !== 2 || det.pattes[0].cote === det.pattes[1].cote) return null;
  const H = ptpAxe(P0, 1), sol = Math.min(...P0.map((p) => p[1]));
  // --- colonne : de la racine au point le plus haut ; droit = colonne verticale
  let sommet = racine;
  for (let j = 0; j < J; j++) if (!E[j].length && P0[j][1] > P0[sommet][1] && sousArbre(E, racine).includes(j)) sommet = j;
  const voie = [];
  for (let k = sommet; k >= 0; k = par[k]) { voie.push(k); if (k === racine) break; }
  voie.reverse();
  if (voie.length < 3 || voie[0] !== racine) return null;
  { const mid = voie[Math.floor(voie.length / 2)], v_ = sub(P0[mid], P0[racine]); if (!(v_[1] > 2.0 * Math.hypot(v_[0], v_[2]))) return null; }
  // --- jambes
  const jambes = [];
  for (const p of det.pattes) {
    let ch = p.chaine, bout5 = -1;
    if (ch.length === 5) { const s5 = sub(P0[ch[4]], P0[ch[3]]); if (Math.abs(s5[1]) <= Math.hypot(s5[0], s5[2])) { bout5 = ch[4]; ch = ch.slice(0, 4); } }   // orteil supplementaire (bout de pied) : il suit le pied
    if (ch.length < 3 || ch.length > 4) return null;
    let toe = -1, cheville = ch[ch.length - 1];
    if (ch.length === 4) {
      const s_ = sub(P0[ch[3]], P0[ch[2]]);
      if (Math.abs(s_[1]) <= Math.hypot(s_[0], s_[2])) { toe = ch[3]; cheville = ch[2]; } else return null;
    }
    const hanche = ch[0], genou = ch[1];
    if (cheville === genou) return null;
    const v1 = sub(P0[genou], P0[hanche]), v2 = sub(P0[cheville], P0[genou]);
    if (!(v1[1] < 0 && v2[1] < 0)) return null;
    const dpied = toe >= 0 ? sub(P0[bout5 >= 0 ? bout5 : toe], P0[cheville]) : [0, 0, 0];
    const cap = toe >= 0 ? Math.atan2(dpied[0], dpied[2]) : 0;
    const ha = Math.max(P0[cheville][1] - sol, 0), ft = toe >= 0 ? Math.max(dpied[2], 0.02 * H) : 0.05 * H, hb = toe >= 0 ? 0.4 * ft : 0.03 * H;
    // axe de charniere du genou AU REPOS, calcule comme dans la boucle des images (meme pole) : la pose de repos est rendue a l'identique
    const aR = mulS(add(v1, v2), 1 / (norm(add(v1, v2)) + 1e-12)), poleR = [p.cote * 0.04, 0, 1];
    let perpR = sub(poleR, mulS(aR, dot(poleR, aR))); perpR = mulS(perpR, 1 / (norm(perpR) + 1e-12));
    const charniere = cross(perpR, aR);
    jambes.push({ bout5, cote: p.cote, hanche, genou, cheville, toe, l1: norm(v1), l2: norm(v2), v1, v2, L: norm(v1) + norm(v2), cap, ha, ft, hb, pied: dpied, charniere });
  }
  const jc = (c) => jambes.find((q) => q.cote === c);
  // --- bras
  const bras = _brasCourse(sq, det);
  if (bras.length !== 2 || bras[0].cote === bras[1].cote) return null;
  // moyeu des epaules sur la colonne
  let m = -1;
  for (const b of bras) { for (let k = b.moyeu; k >= 0; k = par[k]) { const q = voie.indexOf(k); if (q >= 0) { m = Math.max(m, q); break; } } }
  if (m < 1) m = Math.max(1, voie.length - 3);
  // --- reglages
  const nomA = marche ? 'walk' : variante === 'sprint' ? 'sprint' : variante === 'jog' ? 'jog' : 'run';
  // marche : si un avant-bras est deja bien plie au repos (flexion > 1,0 rad), la personne tient un objet (baton) : ancienne marche
  if (marche) for (const b of bras) { const ru_ = sub(P0[b.coude], P0[b.epaule]), rf_ = sub(P0[b.poignet], P0[b.coude]); if (Math.acos(Math.max(-1, Math.min(1, dot(ru_, rf_) / (norm(ru_) * norm(rf_) + 1e-12)))) > 1.0) return null; }
  const Pm = { ...COURSE_DEFAUT[nomA], ...((globalThis.__reglagesCourse || {})[nomA] || {}) };
  const Tf = Math.max(8, Math.round((2 / Pm.cadence) * fps)), T = Tf / fps, nT = cycles * Tf + 1;
  const vit = Pm.vitesse * H;                              // unites du modele par seconde
  const df = Math.min(Pm.appui, marche ? 0.75 : 0.48);               // marche : double appui (appui > 50 % du cycle d'un pied)
  const g = 9.81 / 1.75 * H;                               // gravite en unites du modele (personnage de 1,75 m)
  const xMid = 0.5 * (P0[jambes[0].hanche][0] + P0[jambes[1].hanche][0]);
  const lat = Math.min(Pm.largeurPas * 0.5 * Math.abs(P0[jambes[0].hanche][0] - P0[jambes[1].hanche][0]), 0.058 * H);   // pieds sous la ligne du corps : ecart entre pieds <= ~12 % H
  const sig1 = 0.18, sig2 = 0.62, sigFlat = 0.5 * (sig1 + sig2);
  const Rcorps = (t, ph) => ph;
  // inclinaison : `buste` est l'angle REEL de la racine au moyeu des epaules par rapport a la verticale (la colonne de repos peut deja etre cambree) ;
  // on cherche l'angle ajoute qui donne cet angle reel (le bassin en prend 35 %, le reste est reparti sur la colonne)
  const ordre = [], file = [racine, ...sq.racines.filter((r) => r !== racine)];
  while (file.length) { const j = file.shift(); ordre.push(j); file.push(...E[j]); }
  let leanAdj = new Array(Tf).fill(0);
  const leanAdjDe = (t) => { const x = _frac(t / T) * Tf, i0 = Math.floor(x) % Tf, i1 = (i0 + 1) % Tf, f = x - Math.floor(x); return leanAdj[i0] * (1 - f) + leanAdj[i1] * f; };
  const DmLean = (L) => { const Dm = new Map(); for (let i = 0; i <= m; i++) { const f = i / m; Dm.set(voie[i], Rx(L * (0.35 + 0.65 * f))); } return Dm; };
  const vTronc = (L) => { const F = fkLean(DmLean(L)); return sub(F.P[voie[m]], F.P[racine]); };

  const fkLean = (Dm) => fk(Dm, [0, 0, 0]);
  let lean = 0;
  { let L = Pm.buste * _deg; for (let it = 0; it < 8; it++) { const v = vTronc(L), a = Math.atan2(v[2], v[1]), v2 = vTronc(L + 1e-3), a2 = Math.atan2(v2[2], v2[1]); const d = (a2 - a) / 1e-3; if (Math.abs(d) < 1e-6) break; L += (Pm.buste * _deg - a) / d; } lean = L; }
  const dyTronc = (L) => vTronc(L)[1];
  const TS = globalThis.__torseSouple !== false;
  const PR = globalThis.__poidsRythme !== false;
  const tClip = cycles * T, varK = PR && cycles >= 2 ? Math.max(0, Pm.variabilite ?? 0) : 0;
  const vmod = (t, ph) => { const w = 2 * Math.PI * t / tClip; return 0.62 * Math.sin(w + ph) + (cycles >= 3 ? 0.38 * Math.sin(2 * w + 1.7 * ph + 0.9) : 0); };   // periode du clip : boucle fermee
  const nbSouffle = PR && Pm.respiration ? Math.max(1, Math.round(cycles * (Pm.respirationFreq ?? 0.67))) : 0;
  const respi = (t) => (nbSouffle ? 0.5 * Pm.respiration * _deg * Math.sin(2 * Math.PI * nbSouffle * t / tClip) : 0);
  // impact : somme sur les appuis (fenetres) d'une impulsion de forme gamma (montee brusque en `a` secondes, retombee lente) ; periodique car les appuis le sont
  const impG = (t, a) => { let r_ = 0; for (const w of fenetres) { const s_ = t - w.d0; if (s_ > 0 && s_ < 14 * a) r_ += (s_ / a) * Math.exp(1 - s_ / a); } return r_; };
  // --- tronc a l'instant t : orientations monde de la colonne, de la tete ; decalage hanche - racine
  function tronc(t) {
    const th = 2 * Math.PI * t / T, ph = th - Math.PI * df;
    if (TS) {
      const w2 = 2 * Math.PI, aT = Pm.torseTorsion * _deg / 2 * (1 + 0.25 * varK * vmod(t, 0.7)), aP = aT * Pm.torsionBassin, aS = aT * (1 - Pm.torsionBassin);
      const thT = th + w2 * 0.03 * varK * vmod(t, 2.1);
      const pitI = PR && Pm.poidsTronc ? Pm.poidsTronc * _deg * impG(t, 1.6 * Pm.poidsImpactTau) : 0, rsp = respi(t);
      const oblA = Pm.bassinObliquite * _deg / 2, rollS = oblA - Pm.torseFlexionLaterale * _deg / 2;
      const pitA = Pm.torseTangage * _deg / 2, sgn = Pm.rebond >= 0 ? 1 : -1, onde = Pm.torseOnde || 0, ret = Pm.teteRetard || 0;
      const pit = (x) => -pitA * sgn * Math.cos(2 * x - w2 * df);      // tronc plus penche quand le bassin est haut : le tronc absorbe le rebond, la tete reste calme
      const lean0 = lean + leanAdjDe(t);
      const Dm = new Map();
      for (let i = 0; i <= m; i++) {
        const f = i / m;
        const yaw = -aP * Math.cos(thT) * (1 - f) + aS * Math.cos(thT - w2 * onde * f) * f;
        const rol = oblA * Math.cos(ph) * (1 - f) + rollS * Math.cos(ph - w2 * onde * f) * f;
        Dm.set(voie[i], mm(mm(Ry(yaw), Rx(lean0 * (0.35 + 0.65 * f) + pit(th) + pitI + rsp * f * f)), Rz(rol)));
      }
      const nTete = voie.length - 1 - m;
      for (let i = m + 1; i < voie.length; i++) {
        const w = (i - m) / nTete, lag = onde + ret * w, g = 1 - w * (1 - Pm.teteSuivi), gp = 1 - w * (1 - Pm.teteSuiviTangage);
        const yaw = aS * Math.cos(thT - w2 * lag) * g, rol = rollS * Math.cos(ph - w2 * lag) * g;
        Dm.set(voie[i], mm(mm(Ry(yaw), Rx(Pm.teteTangage * _deg * w + lean0 * 0.5 * (1 - w) + pit(th - w2 * lag) * gp + 0.35 * pitI)), Rz(rol)));
      }
      return { Dm, sway: Pm.deport * H * Math.cos(ph) };
    }
    const yawP = -Pm.bassinLacet * _deg * Math.cos(th), yawS = Pm.epaulesLacet * _deg * Math.cos(th), roulis = Pm.bassinRoulis * _deg * Math.cos(ph);
    const lean_ = lean + leanAdjDe(t) + 0.6 * _deg * Math.cos(2 * th + 0.5);
    const Dm = new Map();
    for (let i = 0; i <= m; i++) {
      const f = i / m, w0 = 0.35;
      Dm.set(voie[i], mm(mm(Ry(yawP + (yawS - yawP) * f), Rx(lean_ * (w0 + (1 - w0) * f))), Rz(roulis * (1 - f))));
    }
    const nTete = voie.length - 1 - m;
    for (let i = m + 1; i < voie.length; i++) {
      const w = (i - m) / nTete;
      Dm.set(voie[i], Rx(Pm.teteTangage * _deg * w + lean_ * 0.5 * (1 - w)));
    }
    return { Dm, sway: Pm.deport * H * Math.cos(ph) };
  }
  // positions monde sans la racine (racine a l'origine) avec orientations connues
  function fk(Dm, racinePos) {
    const D = new Array(J), P = new Array(J);
    for (const j of ordre) {
      if (j === racine) { D[j] = Dm.get(j) || I3(); P[j] = racinePos.slice(); } else if (par[j] < 0) { D[j] = D[racine]; P[j] = add(racinePos, mv(D[racine], sub(P0[j], P0[racine]))); } else {
        D[j] = Dm.has(j) ? Dm.get(j) : D[par[j]];
        P[j] = add(P[par[j]], mv(D[par[j]], sub(P0[j], P0[par[j]])));
      }
    }
    return { D, P };
  }

  // --- pied d'appui : cheville monde en fonction de l'instant de pose td, de la fraction d'appui sigma
  const decalPhase = (c) => (c > 0 ? 0 : 0.5);
  const poseTouche = (jb, td) => {
    const xf = xMid + jb.cote * lat;
    const zFlat = vit * (td + sigFlat * df * T) - 0.02 * H;
    return { xf, zFlat };
  };
  const ankleAppui = (jb, td, sigma) => {
    const { xf, zFlat } = poseTouche(jb, td);
    const Rc = Ry(-0.8 * jb.cap), oH = mv(Rc, [0, -jb.ha, -jb.hb]), oT = jb.toe >= 0 ? mv(Rc, jb.pied) : mv(Rc, [0, -jb.ha, jb.ft]);
    const kp = jb.toe >= 0 ? 1 : 0, pTD = Pm.talon * _deg * kp, pTO = Pm.poussee * _deg * kp;   // pied sans orteil : la rotation du pied ne s'appuie sur rien, on la reduit
    let p = 0, A;
    const aplat = [xf, sol + jb.ha, zFlat];
    if (sigma < sig1) { p = -pTD * (1 - _lisse3(sigma / sig1)); const Wh = [xf, sol, zFlat - jb.hb]; A = sub(Wh, mv(Rx(p), oH)); }
    else if (sigma <= sig2) { A = aplat; } else { p = pTO * _lisse3((sigma - sig2) / (1 - sig2)); const Wt = add(aplat, oT); A = sub(Wt, mv(Rx(p), oT)); }
    return { A, p };
  };
  // fenetres d'appui : [debut, fin, jambe]
  const fenetres = [];
  for (let k = -2; k <= cycles + 2; k++) for (const jb of jambes) { const d0 = (k + decalPhase(jb.cote)) * T; fenetres.push({ d0, d1: d0 + df * T, jb }); }
  fenetres.sort((a, b) => a.d0 - b.d0);
  const fenetreA = (t) => fenetres.find((w) => t >= w.d0 - 1e-9 && t < w.d1 - 1e-9) || null;
  const kCompr = () => (Pm.jambe || 0.985);
  function yRacineAppui(w, t, kFixe) {
    const sigma = (t - w.d0) / (df * T), jb = w.jb;
    const { A } = ankleAppui(jb, w.d0, Math.min(Math.max(sigma, 0), 1));
    const { Dm, sway } = tronc(t);
    const f0 = fk(Dm, [0, 0, 0]), rh = f0.P[jb.hanche];
    const rx = P0[racine][0] + sway, rz = vit * t;
    const dx = A[0] - (rx + rh[0]), dz = A[2] - (rz + rh[2]);
    const kk = (kFixe || kCompr(Math.min(Math.max(sigma, 0), 1))) * jb.L;
    const dy = Math.sqrt(Math.max(kk * kk - dx * dx - dz * dz, (0.3 * kk) ** 2));
    return A[1] + dy - rh[1];
  }
  // hauteur de la racine a chaque image
  const tt = Array.from({ length: nT }, (_, i) => i / fps);
  // hauteur du bassin : oscillation douce (haute en plein vol, basse a mi-appui, amplitude `rebond` x H) ; son niveau moyen est le plus haut que les jambes d'appui
  // permettent (jamais plus que leur longueur, 98,5 %) : la compression des jambes en decoule
  const calcYR = () => {
    const A_ = Pm.rebond * H, forme = (t) => -Math.cos(4 * Math.PI * (t / T - df / 2));
    let y0 = Infinity;
    for (const w of fenetres.filter((q) => q.d0 >= 0 && q.d0 < T)) for (let s = 0; s <= 24; s++) { const t = w.d0 + (s / 24) * df * T; y0 = Math.min(y0, yRacineAppui(w, t, Pm.jambe || 0.985) - A_ * forme(t)); }
    return tt.map((t) => y0 + A_ * forme(t));
  };
  const lis = (a) => a.map((_, i) => 0.25 * a[(i - 1 + nT - 1) % (nT - 1)] + 0.5 * a[i % (nT - 1)] + 0.25 * a[(i + 1) % (nT - 1)]);
  let yR = calcYR();
  if (yR.some((v) => !Number.isFinite(v))) return null;
  yR = lis(yR); yR[nT - 1] = yR[0];
  // tete stable (4 passes) : le buste se redresse un peu quand le bassin est haut et se penche quand il est bas, de facon que le moyeu des epaules (donc la tete) reste a hauteur constante
  if (Pm.compTete > 0) {
    for (let pass = 0; pass < 2; pass++) {
      const hm = yR.slice(0, Tf).map((y, i) => y + dyTronc(lean + leanAdj[i]));
      const moy = hm.reduce((a, b) => a + b, 0) / Tf, nouv = [];
      for (let i = 0; i < Tf; i++) {
        const cible = moy + (1 - Pm.compTete) * (hm[i] - moy) - yR[i];
        let lo = lean - 10 * _deg, hi = lean + 14 * _deg;
        for (let k = 0; k < 30; k++) { const mid = 0.5 * (lo + hi); if (dyTronc(mid) > cible) lo = mid; else hi = mid; }
        nouv.push(0.5 * (lo + hi) - lean);
      }
      const lissee = nouv.map((_, i) => 0.25 * nouv[(i - 1 + Tf) % Tf] + 0.5 * nouv[i] + 0.25 * nouv[(i + 1) % Tf]);
      leanAdj = lissee;
      yR = calcYR(); yR = lis(yR); yR[nT - 1] = yR[0];
    }
  }

  if (PR && Pm.poidsImpact) { for (let i = 0; i < nT; i++) yR[i] -= Pm.poidsImpact * H * impG(tt[i], Pm.poidsImpactTau); yR[nT - 1] = yR[0]; }
  // --- pied balance : trajectoire de la cheville entre decollage et pose suivante
  function ankleLibre(jb, w0, w1, t) {                      // w0 = appui precedent (de cette jambe), w1 = suivant
    const a = ankleAppui(jb, w0.d0, 1), b = ankleAppui(jb, w1.d0, 0);
    const s = Math.min(Math.max((t - w0.d1) / (w1.d0 - w0.d1), 0), 1);
    const e = 0.5 * (1 - Math.cos(Math.PI * s));
    const A = [a.A[0] + (b.A[0] - a.A[0]) * s, 0, a.A[2] + (b.A[2] - a.A[2]) * ((1 - (Pm.zlin ?? 0.3)) * e + (Pm.zlin ?? 0.3) * s)];
    const bump = Math.pow(Math.sin(Math.PI * Math.pow(s, 0.72)), 2);
    const bump2 = s > 0.45 ? Math.pow(Math.sin(Math.PI * (s - 0.45) / 0.55), 2) : 0;
    A[1] = a.A[1] + (b.A[1] - a.A[1]) * e + jb.L * (Pm.levee * bump + Pm.genou * bump2);
    const p = a.p * (1 - _lisse3(s / 0.3)) + b.p * _lisse3((s - 0.55) / 0.45) - 0.22 * Math.sin(Math.PI * Math.min(s / 0.7, 1));   // la pointe se releve vite apres le decollage
    return { A, p };
  }
  const appuiDe = (jb, t) => {                              // appui precedent et suivant de cette jambe autour de t
    const ws = fenetres.filter((q) => q.jb === jb);
    const prev = [...ws].reverse().find((q) => q.d1 <= t + 1e-9), next = ws.find((q) => q.d0 > t - 1e-9);
    return { prev, next };
  };

  // --- bras : directions cibles
  const brasT = (b, t) => {
    const u = _frac(t / T + decalPhase(b.cote) + 0.03 * varK * vmod(t, 3.3 + b.cote));
    const asy = (TS ? 1 + 0.5 * b.cote * Pm.asymetrieBras : 1) * (1 + 0.25 * varK * vmod(t, 1.3 + 1.1 * b.cote));
    const fb = PR ? (Pm.formeBras || 0) / (4 * Math.PI) : 0, gw = (x) => x + fb * Math.sin(4 * Math.PI * x);       // deformation periodique de la phase : retournement plus sec aux extremes
    const av = Pm.brasAvant * _deg * asy, ar = Pm.brasArriere * _deg * asy, mid = 0.5 * (av - ar), amp = 0.5 * (av + ar);
    const th = mid - amp * Math.cos(2 * Math.PI * gw(u + 0.03));
    const thF = TS ? mid - amp * Math.cos(2 * Math.PI * gw(u + 0.03 - Pm.retardCoude)) : th;     // l'avant-bras plie et se deplie avec un retard
    const phi = (Pm.coude + Pm.coudeVar * (thF - mid) / Math.max(amp, 1e-6)) * _deg;
    const alpha = Pm.ecartCoude * _deg, af = -Pm.mainsRentrees * _deg, be = th + phi;
    const du = add(mulS([0, -Math.cos(th), Math.sin(th)], Math.cos(alpha)), [b.cote * Math.sin(alpha), 0, 0]);
    const df_ = add(mulS([0, -Math.cos(be), Math.sin(be)], Math.cos(af)), [b.cote * Math.sin(af), 0, 0]);
    return { du, df: df_, th, phi, sw: -Math.cos(2 * Math.PI * gw(u + 0.03)) };
  };
  for (const b of bras) {                                  // premier os entre le moyeu et l'epaule (clavicule) s'il existe
    let k = b.epaule;
    while (par[k] >= 0 && par[k] !== b.moyeu) k = par[k];
    b.clav = par[k] === b.moyeu && k !== b.epaule ? k : -1;
  }
  const reposBras = bras.map((b) => {
    const ru = sub(P0[b.coude], P0[b.epaule]), rf = sub(P0[b.poignet], P0[b.coude]);
    const ur = mulS(ru, 1 / norm(ru)), fr = mulS(rf, 1 / norm(rf));
    const bas = [0, -1, 0], pr = sub(bas, mulS(fr, dot(bas, fr)));
    const nrest = norm(pr) > 0.3 ? mulS(pr, 1 / norm(pr)) : [-b.cote, 0, 0];     // normale de la paume au repos : vers le bas pour un bras horizontal, vers le corps pour un bras pendant
    // doigts presents (>= 3 enfants du poignet) : la paume est perpendiculaire a la rangee des doigts ; le sens se choisit du cote de l'heuristique (bas / corps)
    let nr = nrest;
    const ed = E[b.poignet];
    if (ed.length >= 3 && globalThis.__paumeDoigts !== false) {
      const w = P0[b.poignet], vs = ed.map((k) => { const v = sub(P0[k], w); return sub(v, mulS(fr, dot(v, fr))); });
      const mean = vs.reduce((a, v) => add(a, v), [0, 0, 0]).map((x) => x / vs.length), dev = vs.map((v) => sub(v, mean));
      // axe principal des ecarts (iteration de puissance)
      let s = dev.reduce((a, v) => (norm(v) > norm(a) ? v : a), [0, 0, 0]);
      if (norm(s) > 1e-9) {
        for (let it = 0; it < 20; it++) { let q = [0, 0, 0]; for (const v of dev) q = add(q, mulS(v, dot(v, s))); if (norm(q) < 1e-12) break; s = mulS(q, 1 / norm(q)); }
        let n2 = cross(fr, s); if (norm(n2) > 1e-9) { n2 = mulS(n2, 1 / norm(n2)); nr = dot(n2, nrest) >= 0 ? n2 : mulS(n2, -1); }
      }
    }
    return { ur, fr, nrest: nr };
  });

  // --- mains detendues (29/10) : doigts semi-fermes (flexion vers la paume) et poignet qui suit l'avant-bras avec retard ; tout est derive de la chaine fille du poignet
  const MD = globalThis.__mainsDetendues !== false;
  const mains = bras.map((b, q) => {
    if (!MD) return null;
    const rr = reposBras[q], w = b.poignet, doigts = [];
    const nL = (v) => mulS(v, 1 / (norm(v) + 1e-12));
    const bases = E[w].map((k) => ({ k, d: norm(sub(P0[k], P0[w])) }));
    let pouce = -1;
    const rang = new Map();
    if (bases.length >= 4) {                                      // pouce = doigt dont la base est tres pres du poignet (< 0,55 x la mediane des autres)
      const t_ = bases.slice().sort((x, y) => x.d - y.d), med = median(t_.slice(1).map((x) => x.d));
      if (t_[0].d < 0.55 * med) pouce = t_[0].k;
    }
    const autres = bases.filter((x) => x.k !== pouce);
    if (pouce >= 0 && autres.length > 1) {                        // rang : de l'index (pres du pouce, -0,5) a l'auriculaire (+0,5)
      const dp = autres.map((x) => ({ k: x.k, e: norm(sub(P0[x.k], P0[pouce])) })).sort((x, y) => x.e - y.e);
      dp.forEach((x, i) => rang.set(x.k, i / (dp.length - 1) - 0.5));
    }
    // l'auriculaire (rang +0,5) se ferme davantage que l'index (rang -0,5)
    const marche_ = (k, prof, racineDoigt) => {
      if (!E[k].length) return;                                   // dernier os : ne tourne rien
      const d = nL(sub(P0[E[k][0]], P0[k])), ax = cross(d, rr.nrest);
      if (norm(ax) > 0.15) doigts.push({ j: k, par: par[k], axe: nL(ax), prof, racineDoigt, pouce: racineDoigt === pouce, rang: rang.get(racineDoigt) ?? 0 });
      for (const e of E[k]) marche_(e, prof + 1, racineDoigt);
    };
    for (const k of E[w]) marche_(k, 0, k);
    return doigts.length ? { doigts, poignet: w } : null;
  });
  // signal du poignet : angle sagittal de l'avant-bras retarde, moins l'angle de l'avant-bras ; normalise a mainPoignetAmp (crete-a-crete)
  const angSag = (v) => Math.atan2(v[2], -v[1]);
  const poignetSerie = bras.map((b, q) => {
    if (!MD) return null;
    const ret = Pm.mainPoignetRetard || 0;
    const d = tt.map((t) => { const a = brasT(b, t - ret * T).df, c = brasT(b, t).df; let x = angSag(a) - angSag(c); x -= 2 * Math.PI * Math.round(x / (2 * Math.PI)); return x; });
    const pk = Math.max(...d) - Math.min(...d);
    const k = pk > 1e-9 ? (Pm.mainPoignetAmp || 0) * _deg / pk : 0;
    const moy = 0.5 * (Math.max(...d) + Math.min(...d));
    return d.map((x) => k * (x - moy));                           // rotation du poignet (rad) ; centree
  });
  const poignetNorm = poignetSerie.map((s_) => { if (!s_) return null; const m_ = Math.max(...s_.map(Math.abs)) || 1; return s_.map((x) => x / m_); });

  // --- assemblage image par image
  const R = [], racineMonde = [], Dtous = [];
  const secs = sq.racines.filter((r) => r !== racine);
  const racinesSec = secs.map((r) => ({ j: r, pos: [] }));
  const infoBras = [];
  for (let i = 0; i < nT; i++) {
    const t = tt[i], { Dm, sway } = tronc(t), rootPos = [xMid + sway - (P0[racine][0] - 0) * 0 + (P0[racine][0] - xMid) * 0, yR[i], vit * t];
    rootPos[0] = P0[racine][0] + sway;
    // jambes
    const f0 = fk(Dm, rootPos);
    for (const jb of jambes) {
      const w = marche ? (fenetres.find((q) => q.jb === jb && t >= q.d0 - 1e-9 && t < q.d1 - 1e-9) || null) : fenetreA(t);
      let A, p;
      if (w && w.jb === jb) { const r_ = ankleAppui(jb, w.d0, (t - w.d0) / (df * T)); A = r_.A; p = r_.p; }
      else { const { prev, next } = appuiDe(jb, t); const r_ = ankleLibre(jb, prev, next, t); A = r_.A; p = r_.p; }
      const Hh = f0.P[jb.hanche];
      let dv = sub(A, Hh), d = norm(dv);
      const dMax = (jb.l1 + jb.l2) * 0.9995, dMin = Math.abs(jb.l1 - jb.l2) * 1.05 + 1e-4;
      const dc = Math.min(Math.max(d, dMin), dMax), a = mulS(dv, 1 / (d + 1e-12));
      const cosA = (jb.l1 * jb.l1 + dc * dc - jb.l2 * jb.l2) / (2 * jb.l1 * dc), sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
      const pole = [jb.cote * 0.04, 0, 1];
      let perp = sub(pole, mulS(a, dot(pole, a))); perp = mulS(perp, 1 / (norm(perp) + 1e-12));
      const K = add(Hh, add(mulS(a, jb.l1 * cosA), mulS(perp, jb.l1 * sinA)));
      const Acible = add(Hh, mulS(a, dc));
      // 29/10 : la cuisse et le tibia sont orientes par l'AXE DE CHARNIERE du genou (perpendiculaire au plan hanche-genou-cheville), plus par l'avant :
      // quand le tibia passait a l'horizontale vers l'arriere (recuperation de course, genou plie a 110 deg), il devenait parallele a l'avant, le cote
      // de reference n'etait plus defini et le genou et la cheville tournaient de 180 deg sur eux-memes en une image (fix_humain, gladiateur).
      // Interrupteur : globalThis.__charniereGenou = false (ancien calcul).
      let Dth, Dsh;
      if (globalThis.__charniereGenou !== false) {
        const h = cross(perp, a);
        Dth = _viser(jb.v1, jb.charniere, sub(K, Hh), h); Dsh = _viser(jb.v2, jb.charniere, sub(Acible, K), h);
      } else {
        const s0 = [0, 0, 1];
        Dth = _viser(jb.v1, s0, sub(K, Hh), pole); Dsh = _viser(jb.v2, s0, sub(Acible, K), pole);
      }
      Dm.set(jb.hanche, Dth); Dm.set(jb.genou, Dsh);
      const Dpied = mm(Rx(p), Ry(-0.8 * jb.cap));
      Dm.set(jb.cheville, Dpied);
      if (jb.toe >= 0) Dm.set(jb.toe, Dpied);
      if (jb.bout5 >= 0) Dm.set(jb.bout5, Dpied);
    }
    // bras
    bras.forEach((b, q) => {
      const bt = brasT(b, t), rr = reposBras[q];
      const Du = aligner(rr.ur, bt.du);
      const fm = aligner(rr.fr, bt.df);
      // roulis de l'avant-bras : la paume neutre regarde vers l'interieur (face a face)
      const fa = mulS(bt.df, 1 / norm(bt.df)), n0 = mv(fm, rr.nrest);
      const proj = (v) => { const w = sub(v, mulS(fa, dot(v, fa))); return mulS(w, 1 / (norm(w) + 1e-12)); };
      const nA = proj(n0), nB = proj([-b.cote, 0, 0]);
      const ang = Math.atan2(dot(cross(nA, nB), fa), dot(nA, nB)) + b.cote * Pm.paume * _deg;
      if (TS && Pm.clavicule && b.clav >= 0 && Dm.has(b.moyeu)) {    // clavicule : suit le balancement du bras (protraction + legere elevation)
        const a_ = -b.cote * Pm.clavicule * _deg * bt.sw, e_ = 0.3 * b.cote * Pm.clavicule * _deg * bt.sw;
        Dm.set(b.clav, mm(Dm.get(b.moyeu), mm(Ry(a_), Rz(e_))));
      }
      Dm.set(b.epaule, Du);
      Dm.set(b.coude, mm(rotvec(fa, ang), fm));
      if (MD && poignetSerie[q]) {                                     // poignet : suit l'avant-bras avec retard (rotation autour de l'axe lateral monde) ; doigts : flexion vers la paume
        const Dc = Dm.get(b.coude);
        let Dp = mm(Rx(-poignetSerie[q][i]), Dc);
        Dm.set(b.poignet, Dp);
        const mq = mains[q];
        if (mq) {
          const nv = poignetNorm[q][i], Dd = new Map([[b.poignet, Dp]]);
          for (const f of mq.doigts) {
            const racineF = f.racineDoigt, dist = f.prof === 0 ? 1 : Pm.mainDoigtsDist || 1.5;
            const base = f.pouce ? Pm.mainPouce : Pm.mainDoigts * (1 + (Pm.mainDoigtsEtage || 0) * 2 * f.rang * 0.5);
            const flex = base * dist * (1 + (Pm.mainDoigtsVar || 0) * nv) * _deg;
            const Dn = mm(Dd.get(f.par) || Dp, rotvec(f.axe, flex));
            Dd.set(f.j, Dn); Dm.set(f.j, Dn);
          }
        }
      }
      if (i === 0 || true) infoBras[q] = { ang };
    });
    // assemblage
    const { D } = fk(Dm, rootPos);
    Dtous.push(D);
    R.push(D.map((Dj, j) => (par[j] < 0 ? Dj : mm(tr(D[par[j]]), Dj))));
    racineMonde.push(rootPos);
    secs.forEach((r, k) => racinesSec[k].pos.push(D && add(rootPos, mv(D[racine], sub(P0[r], P0[racine])))));
  }
  const exclureSec = new Set([racine, ...voie, ...det.pattes.flatMap((q) => sousArbre(E, q.chaine[0])), ...det.tetes.flat()]);
  const clip = { nom: variante === 'normal' ? allure : `${allure}__${variante}`, R, racineMonde, racinesSec, infos: { mode: 'pattes', moteur_course: 'anatomique', prolongement: { amplitude: Pm.prolongement ?? 1, amort: Pm.prolongementAmort ?? 1, exclure: [...exclureSec] }, diag: { voie, m, bras: bras.map((b) => ({ epaule: b.epaule, coude: b.coude, poignet: b.poignet, cote: b.cote, clav: b.clav })), jambes: jambes.map((q) => ({ hanche: q.hanche, genou: q.genou, cheville: q.cheville, toe: q.toe, cote: q.cote })) }, periode: T, images: nT, pattes: 2, bras: 2, vitesse_H_s: Pm.vitesse } };
  if (!R.every((Ri) => Ri.every((mt) => mt.every(Number.isFinite))) || !racineMonde.every((q) => q.every(Number.isFinite))) return null;
  const dc = _defautsClip(sq, clip, det);
  clip.infos.sous_sol_pct = +dc.sousSol.toFixed(2); clip.infos.glissement_appui_pct = +dc.glissement.toFixed(2); clip.infos.acoups_max_deg = +dc.acoups.toFixed(1);
  return clip;
}


function animerAllureSure(sq, allure, cycles, fps, variante, mode = 'auto', espece = 'generique') {
  const phi = angleOrientation(sq, mode);
  if (!phi) return animerAllureSure0(sq, allure, cycles, fps, variante, mode, espece);
  const Q = Ry(phi), Qt = tr(Q);
  const sq2 = { ...sq, P0: sq.P0.map((p) => mv(Q, p)) };
  const c = animerAllureSure0(sq2, allure, cycles, fps, variante, mode, espece);
  const R = c.R.map((Ri) => Ri.map((m) => mm(mm(Qt, m), Q)));
  const racineMonde = c.racineMonde.map((p) => mv(Qt, p));
  const racinesSec = (c.racinesSec || []).map((r) => ({ ...r, pos: r.pos.map((p) => mv(Qt, p)) }));
  return { ...c, R, racineMonde, racinesSec, infos: { ...c.infos, orientation_deg: +(phi * 180 / Math.PI).toFixed(1) } };
}

function animerAllureSure0(sq, allure, cycles, fps, variante, mode = 'auto', espece = 'generique') {
  const fini = (c) => c.R.every((Ri) => Ri.every((m) => m.every(Number.isFinite))) && c.racineMonde.every((p) => p.every(Number.isFinite));
  // nom du clip selon ce qu'il est vraiment : « swim » pour un poisson, « slither » pour un serpent
  const nommer = (c) => {
    const table = NOMS_PAR_MODE[mode === 'nage' ? 'nage' : mode === 'vol' ? 'vol' : c.infos.mode === 'reptation' ? 'reptation' : ''];
    if (table && table[allure]) c.nom = table[allure] + (variante === 'normal' ? '' : '__' + variante);
    c.infos.deplacement = mode === 'nage' ? 'nage' : mode === 'vol' ? 'vol' : c.infos.mode === 'reptation' ? 'reptation' : 'pattes';
    return c;
  };
  if (allure === 'idle') cycles = Math.max(cycles, 3);          // finesse (26/10) : un repos de 12 a 18 s ou il se passe des choses, pas une boucle de 5 s
  try {
    // vol : seulement les 5 allures de base (attente = vol stationnaire) ; les actions (attaque, mort, manger...) gardent le calcul a pattes
    const volPossible = mode === 'vol' && !!PROFILS_VOL[allure];
    // course anatomique (28/10) : bipede droit complet de la famille humain ; null -> calcul d'origine
    let c0 = null;
    if ((allure === 'run' || allure === 'walk') && espece === 'humain' && !volPossible && mode !== 'nage' && mode !== 'reptation') { try { c0 = courseAnatomique(sq, cycles, fps, variante, allure); } catch (e_) { c0 = null; if (globalThis.__debugCourse) console.error(e_); } }
    let c = c0 ? c0 : volPossible
      ? animerVol(sq, allure, cycles, fps, variante, detecterPattes(sq.par, sq.P0, sq.racine))
      : mode === 'nage' || mode === 'reptation'
      ? animerSansPattes(sq, allure, cycles, fps, variante, detecterPattes(sq.par, sq.P0, sq.racine), 'reptation', mode === 'nage')
      : animerAllure(sq, allure, cycles, fps, variante, espece);
    // action trop ample pour CETTE creature (corps bas, tete au ras du sol : tortue, araignee) :
    // elle passait sous le sol (jusqu'a 30 %) ; on l'attenue par paliers jusqu'a ce qu'elle tienne
    if (ALLURES[allure].action && ALLURES[allure].action !== 'death' && fini(c) && c.infos.mode === 'pattes') {
      let k = 1;
      while (c.infos.sous_sol_pct > 1 && k > 0.2) {
        k *= 0.7;
        const c2 = animerAllure(sq, allure, cycles, fps, variante, espece, k);
        if (!fini(c2)) break;
        c = c2; c.infos.ampleur = +k.toFixed(2);
      }
    }
    // mouvement secondaire (queue, oreilles, chaines pendantes) : s'ajoute au calcul de la famille ; echec = clip inchange
    if (!c0 && fini(c) && allure !== 'death') { try { const c1 = ajouterFinesse(sq, c, allure, fps, 1); if (c1 && fini(c1)) c = c1; } catch (_) { /* clip de la famille conserve */ } }
    if (!c0 && fini(c) && allure !== 'death') { try { const c2 = appliquerSecondaire(sq, c, allure, fps); if (c2 && fini(c2)) c = c2; } catch (_) { /* clip de la famille conserve */ } }
    if (c0 && fini(c) && globalThis.__prolongementCourse !== false && c.infos.prolongement && c.infos.prolongement.amplitude > 0) { try { const pr = c.infos.prolongement, nn = c.R.length - 1;
      // le clip course comporte une image de plus (la derniere = la premiere) : on calcule sur la boucle SANS doublon (periode exacte), puis on rajoute la premiere image a la fin (boucle fermee a l'identique)
      const cT = { ...c, R: c.R.slice(0, nn), racineMonde: c.racineMonde.slice(0, nn), racinesSec: (c.racinesSec || []).map((x) => ({ ...x, pos: x.pos.slice(0, nn) })) };
      const c2 = appliquerSecondaire(sq, cT, allure, fps, SECONDAIRE.amplitude * pr.amplitude, { exclure: pr.exclure, amort: pr.amort, descendre: true });
      if (c2 && c2 !== cT && fini(c2)) c = { ...c2, R: [...c2.R, c2.R[0].map((m) => m.slice())], racineMonde: [...c.racineMonde], racinesSec: (c.racinesSec || []) }; } catch (e_) { if (globalThis.__debugCourse) console.error(e_); } }
    if (!c0 && fini(c) && allure !== 'death') { try { const c3 = ajouterFinesse(sq, c, allure, fps, 2); if (c3 && fini(c3)) c = c3; } catch (_) { /* clip de la famille conserve */ } }
    if (fini(c)) {
      // polissage automatique (25/10) : lisse les a-coups SEULEMENT si les pieds ne glissent pas davantage et rien ne passe sous le sol
      const poli = c0 ? c : polirClip(sq, c);
      const fin = fini(poli) ? poli : c;
      if (fin.infos && fin.infos.mode === 'pattes' && allure !== 'death' && (fin.infos.sous_sol_pct || 0) > 0.5 && globalThis.__aplatirSousSol !== false) {
        try { const a = aplatirSousSol(sq, fin); if (a && fini(a)) return nommer(a); } catch (_) { /* clip non corrige conserve */ }
      }
      return nommer(fin);
    }
    throw new Error('valeur invalide dans le calcul');
  } catch (e) {
    const det = detecterPattes(sq.par, sq.P0, sq.racine);
    const c = animerSansPattes(sq, allure, cycles, fps, variante, det, 'rigide');
    c.infos.mode = 'secours';
    c.infos.erreur = String(e?.message || e);
    return c;
  }
}


// ------------------------------------------------------------------ membres sous le sol
// 26/10 (banc de rendu visuel) : le saut d'une mule enfoncait le bout de la queue de 9 % de H sous le sol a l'accroupi (mesure `sous_sol_pct`, visible sur la planche) ; aucun
// des filtres precedents ne corrige un os qui traverse le sol quand ce n'est pas une action. Cinematique directe de chaque image ; une articulation d'une chaine LIBRE (parent a un
// seul enfant : queue, oreille, pendentif) qui passe sous le sol fait pivoter son parent, dans le plan vertical de l'os, jusqu'a poser le bout a ras du sol (longueur conservee).
// Les pieds (jambes) ne sont pas touches : leurs appuis sont deja tenus par le calcul de la marche. La correction est nulle quand rien ne traverse, donc continue.
function aplatirSousSol(sq, c) {
  const { par, P0 } = sq, J = par.length, E = enfantsDe(par), racine = sq.racine;
  const H = Math.max(ptpAxe(P0, 1), 1e-6), sol = Math.min(...P0.map((p) => p[1])), tol = 0.004 * H;
  const det = detecterPattes(par, P0, racine);
  // pedipalpes (6 pattes ou plus, chaine < 0,65 x la mediane : meme regle que animerAllure) : ce ne sont pas des appuis, le calcul de marche ne les pose pas ; sur une
  // araignee leur bout (a ras du sol au repos) passait 2 a 6 cm sous le sol (9 a 25 % de H) quand le corps penchait : ils sont corriges comme une queue (26/10, 2e passe).
  let appuis = det.pattes;
  if (globalThis.__palpesSousSol !== false && appuis.length >= 6) {
    const lg = appuis.map((q) => longueurChaine(q.chaine.map((k) => P0[k]))), med = median(lg);
    appuis = appuis.filter((_, i) => lg[i] >= 0.65 * med);
  }
  // seules les os des CHAINES d'appui sont intouchables ; une branche greffee sur une patte (griffe, doigt, mandibule : modal_20 en avait 2 qui passaient a 1,5 cm sous le
  // sol, 5 % de H) n'est pas posee par le calcul de marche et se corrige comme une queue. Le pivot d'une correction n'est jamais un os d'appui (pas de pied souleve).
  const jambes = new Set(globalThis.__branchesSousSol !== false ? appuis.flatMap((p) => p.chaine) : appuis.flatMap((p) => sousArbre(E, p.chaine[0])));
  const ordre = [], vu = new Set();
  const visite = (j) => { if (vu.has(j)) return; if (par[j] >= 0) visite(par[j]); vu.add(j); ordre.push(j); };
  for (let j = 0; j < J; j++) visite(j);
  let corrige = 0, pire = 0;
  const R = c.R.map((Ri, i) => {
    const Rn = Ri.map((m) => m.slice()), D = new Array(J), P = new Array(J);
    for (const j of ordre) {
      const q = par[j];
      if (q < 0) { D[j] = Rn[j]; P[j] = j === racine ? c.racineMonde[i].slice() : null; continue; }
      if (!P[q]) { D[j] = mm(D[q], Rn[j]); P[j] = null; continue; }
      P[j] = add(P[q], mv(D[q], sub(P0[j], P0[q])));
      if (!jambes.has(j) && !jambes.has(q) && E[q].length === 1 && P[j][1] < sol - tol && P[q][1] >= sol - tol) {
        const v = sub(P[j], P[q]), L = norm(v), dy = Math.min(sol - P[q][1], 0.999 * L), hx = Math.hypot(v[0], v[2]);
        const hz = Math.sqrt(L * L - dy * dy), vN = hx > 1e-9 ? [v[0] * hz / hx, dy, v[2] * hz / hx] : [hz, dy, 0];
        const ax = cross(v, vN), ang = Math.atan2(norm(ax), dot(v, vN));
        if (ang > 1e-6) {
          D[q] = mm(rotvec(ax, ang), D[q]);
          Rn[q] = par[q] < 0 ? D[q] : mm(tr(D[par[q]]), D[q]);
          P[j] = add(P[q], mv(D[q], sub(P0[j], P0[q])));
          corrige++;
        }
      }
      D[j] = mm(D[q], Rn[j]);
      pire = Math.max(pire, sol - P[j][1]);
    }
    return Rn;
  });
  if (!corrige) return c;
  const infos = { ...c.infos, sous_sol_pct: +(100 * pire / H).toFixed(1), sous_sol_corrige: corrige };
  return { ...c, R, infos };
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
    const P = pistesLocales(sq, clip, clip.fps || fps);
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
    const fpsC = fpsClip(sq, a, fps, espece, mode);
    const clip_ = animerAllureSure(sq, a, ALLURES[a].pas ? cycles : 1, fpsC, variante, mode, espece);   // attente, actions : un cycle
    clip_.fps = fpsC;
    clips.push(clip_);
    infos[clip_.nom] = clip_.infos;
  }
  for (const k of Object.keys(infos)) infos[k].peau_corrigee = peau;
  return { glb: ecrireGLB(sq, clips, fps), infos };
}

/** Cadence d'echantillonnage d'un clip (28/10, defaut Q7 : « le galop n'a que 17 images par cycle, a-coups 30 deg, polissage inapplicable »). Les allures RAPIDES
 *  d'un quadrupede a profil d'espece (trot, galop, saut) sont calculees a 2 x fps (60 images/s pour 30) : a-coups du galop de la Mule 30 -> 16 deg, glissement
 *  avant polissage 2,15 -> 1,11 % H. Le clip porte sa cadence (clip.fps) ; temps et duree des pistes en tiennent compte. Desactivable : globalThis.__fpsRapides = false. */
function fpsClip(sq, a, fps, espece, mode = 'auto') {
  if (globalThis.__fpsRapides === false || fps > 30 || (mode !== 'auto' && mode !== 'pattes') || !ALLURES[a] || !(ALLURES[a].rapide || a === 'run') || !((ESPECES[espece] || {})[a])) return fps;
  try { return detecterPattes(sq.par, sq.P0, sq.racine).pattes.length === 4 ? 2 * fps : fps; } catch (_) { return fps; }
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
    const fpsC = fpsClip(sq, a, fps, espece, mode);
    const c = animerAllureSure(sq, a, ALLURES[a].pas ? cycles : 1, fpsC, variante, mode, espece);
    clips.push(pistesLocales(sq, c, fpsC));
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
export const __interne = { charger, detecterPattes, animerAllureSure, courseAnatomique, _fkMonde };
