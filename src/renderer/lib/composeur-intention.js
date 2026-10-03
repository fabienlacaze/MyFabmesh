// COMPOSEUR D'INTENTION (2026-10-03) — jumeau JavaScript de scripts/composeur_intention.py (= modal_app/composeur_intention.py).
// FICHIER COMMUN bureau / web (src/renderer/lib = cloud/public/app/lib, build/check-noyaux-partages.mjs).
//
// POURQUOI. Un personnage « orc tenant une massue » sortait avec une arme dans chaque main : le gabarit du type Character se contredit
// (« empty open hands », « symmetric », T-pose bras tendus) et le negatif interdit « club ». Mesure sur l'orc, graine fixe, 4 images :
// 0 sur 4 n'avait qu'une arme ; avec une consigne qui dit l'intention et sans les consignes contradictoires, 3 sur 4.
//
// CE QUE FAIT LE MODULE : analyser le texte de l'utilisateur de facon DETERMINISTE (regex seulement) et adapter le gabarit positif.
// Un texte qui ne dit rien d'un objet tenu donne EXACTEMENT le gabarit d'origine (cas temoin « An orc » : identique a l'octet).
// Les negatifs sont composes cote Python (pont du bureau, Modal) : ce fichier n'en compose pas. Il SEPARE seulement les negations de l'utilisateur
// (« no helmet », « without a beard ») du positif : extraireNegations() en fin de fichier ; les termes partent au serveur (champ `negativeExtra`).
//
// MEMES NOMS DE CLES que le module Python (snake_case) : build/intention_cas.json + build/intention_attendus.json verifient que les deux
// langages donnent les memes sorties (build/check-intention.mjs, build/check_intention.py). Les regex restent dans le sous-ensemble
// commun Python / JavaScript. Interrupteur d'urgence cote page : window.__composeurIntention = false.

export const VERSION = 1;
export const TYPES_UNITE = ['character', 'other_living'];
export const TOUTES_REGLES = ['objets', 'socle', 'asymetrie', 'pose', 'vue', 'buste', 'non_humain', 'parties', 'quantite', 'negations'];
// Regles ACTIVES en production : seules celles dont l'effet est mesure ou sans risque. Les autres sont codees, testees, eteintes
// (voir le module Python pour le detail) : les activer = ajouter leur nom ici ET dans scripts/composeur_intention.py.
export const REGLES_ACTIVES = ['objets', 'negations'];

const CLASSES_ARME = {
  club: 'club mace cudgel bat maul flail morning star truncheon',
  hammer: 'hammer warhammer sledgehammer mallet',
  sword: 'sword blade saber sabre katana scimitar rapier claymore greatsword cutlass machete',
  dagger: 'dagger knife dirk kunai stiletto',
  axe: 'axe hatchet battleaxe tomahawk cleaver',
  spear: 'spear lance halberd pike trident javelin glaive polearm',
  bow: 'bow longbow crossbow',
  gun: 'gun rifle pistol musket blaster shotgun revolver cannon',
  staff: 'staff wand scepter sceptre cane crook',
  shield: 'shield buckler',
};
const OBJETS_TENUS = ('torch lantern lamp book tome scroll bag sack satchel cup mug goblet bottle flask potion '
  + 'flag banner flower bouquet basket umbrella orb skull fish chicken baby phone guitar '
  + 'lute harp trumpet sign map key chalice candle pitchfork shovel pickaxe broom '
  + 'hammer wrench tool camera sphere crystal egg apple cane').split(' ');

const NONHUMAIN = /\b(robot|android|cyborg|mech|golem|skeleton|skeletal|statue|ghost|spirit|elemental|slime|automaton|animated armor|empty armor|living armor|wraith|specter)\b/i;
const POSE_LIBRE = new RegExp(
  '\\b(sitting|seated|sits|crouching|crouched|kneeling|squatting|lying|reclining|riding|on horseback|'
  + 'mounted on|running|sprinting|jumping|leaping|dancing|flying|floating|swimming|climbing|crawling|'
  + 'combat stance|battle stance|fighting stance|arms crossed|crossed arms|hands on (?:his |her )?hips|'
  + 'hand on (?:his |her )?hip|waving|pointing|praying|saluting|meditating|bowing|punching|kicking|aiming|'
  + 'shooting|casting a spell|mid-air|leaning)\\b', 'i');
const VUE = new RegExp(
  '\\b(back view|rear view|from behind|seen from behind|from the side|from the back|from above|from below|side view|side profile|in profile|profile view|'
  + 'three-quarter view|three quarter view|3/4 view|top-down view|top view|aerial view|overhead view|'
  + "bird'?s-eye view|isometric view|low-angle|low angle|high-angle|high angle)\\b", 'i');
const BUSTE = /\b(bust|portrait|head only|headshot|close-up|closeup|face only|half-length|waist up|upper body only)\b/i;
const NOMBRE = { one: 1, single: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twin: 2, dual: 2, double: 2, triple: 3 };
const PARTIES = ['head', 'arm', 'leg', 'eye', 'wing', 'tail', 'horn', 'hand', 'face'];
const ADJ_PARTIE = { headed: 'head', armed: 'arm', legged: 'leg', eyed: 'eye', winged: 'wing', tailed: 'tail', horned: 'horn', faced: 'face' };
const PAR_DEFAUT = { head: 1, arm: 2, leg: 2, eye: 2, wing: 2, tail: 1, horn: 2, hand: 2, face: 1 };
// « holding his breath », « holding a pose » : un verbe de prise suivi d'un mot qui n'est pas un objet
const STOP_TENU = new Set('hand hands breath grudge position pose ground gaze back place'.split(' '));
const PARTICULES_REFUS = new Set('onto on to back off in at'.split(' '));
const PARTICULES_ELISION = new Set('up out aloft high forth down aside'.split(' '));
const DESACCORD_SOCLE = /\b(pedestal|plinth|statue|diorama|on a rock|on a base|bust|trophy|figurine)\b/i;
const ROCHE_VOULUE = /\b(rock|rocks|rocky|stone|golem|boulder|cave|mountain|cliff|crystal)\b/i;
const COULEURS = ('red blue green yellow orange purple violet pink black white grey gray brown golden gold silver cyan teal turquoise crimson scarlet').split(' ');
const STYLES_NON_PHOTO = new Set(['cartoon', 'anime', 'pixelart', 'painterly', 'voxel', 'hand-painted', 'ghibli', 'pixar',
  'comic', 'minecraft', 'watercolor', 'sketch', 'claymation', 'stained-glass', 'lowpoly', 'low-poly', 'pixel-art', 'concept-art',
  'graffiti', 'figurine', 'stylized']);

const _MOTS = "[a-z][a-z'-]*";
const _DET = '(?:an?|the|one|his|her|its|their|two|three|a pair of|a couple of|dual|twin)';
const _VERBE = '(?:holding|wielding|carrying|gripping|grasping|brandishing|clutching|swinging|raising|lifting|'
  + 'hefting|bearing|armed with|equipped with|dual[- ]wielding|dual wields?|wields?|holds?|carries)';
const SRC_TENU = '\\b' + _VERBE + '\\s+(?:(' + _DET + ')\\s+)?((?:' + _MOTS + '\\s+){0,4}?' + _MOTS + ')'
  + '(?=\\s*(?:,|\\.|;| and | in | on | with | at | over | while | that | which | across |$))';
const SRC_AVEC_DANS_MAIN = '\\bwith\\s+(?:an?|the|his|her)\\s+((?:' + _MOTS + '\\s+){0,3}?' + _MOTS + ')\\s+in\\s+'
  + '(?:his|her|its|their|each|both|the)\\s*(right|left)?\\s*hands?\\b';
const SRC_ET_ARME = '\\band\\s+(?:an?|the)\\s+((?:' + _MOTS + '\\s+){0,2}?' + _MOTS + ')\\b';
const RE_SANS_ARME = /\b(unarmed|empty[- ]handed|without (?:a |any )?(?:weapon|sword|shield)s?|no weapons?|not holding|holding nothing|bare[- ]handed)\b/i;
const RE_CHAQUE_MAIN = /\b(?:in each hand|in both hands|one in each hand|dual[- ]wield\w*|two[- ]handed)\b/i;
const RE_DEUX_MAINS = /\b(?:with|in) both hands\b|\btwo[- ]handed\b/i;
const RE_MAIN = /\bin\s+(?:his|her|its|their|the)\s+(right|left)\s+hand\b/i;
const RE_ASYM = /\b(asymmetric\w*|one[- ]eyed|one[- ]armed|missing (?:an? )?(?:arm|eye|leg)|scar\w*)\b/i;
const RE_MULTIPLE = /\b(twin|twins|dual|double|pair|couple)\b/i;
const RE_ARTICLE = /^(?:an?|the)$/i;

export const CADRAGE_TENU = 'entire figure and held item fully visible, generous empty margins';

/** Vrai tant que la page n'a pas pose window.__composeurIntention = false (interrupteur d'urgence, a poser dans la console). */
export function actif() {
  try { return !(typeof window !== 'undefined' && window.__composeurIntention === false); } catch (_) { return true; }
}

function _classe(mot) {
  mot = mot.toLowerCase();
  const formes = new Set([mot, mot.endsWith('s') ? mot.slice(0, -1) : mot, mot.endsWith('es') ? mot.slice(0, -2) : mot]);
  for (const cl of Object.keys(CLASSES_ARME)) {
    for (const m of CLASSES_ARME[cl].split(' ')) if (formes.has(m)) return cl;
  }
  return null;
}

function _nombreDet(det, texteNp) {
  const d = (det || '').toLowerCase();
  if (d === 'two' || d === 'a pair of' || d === 'a couple of' || d === 'dual' || d === 'twin') return 2;
  if (d === 'three') return 3;
  const low = texteNp.toLowerCase();
  const rs = low.replace(/\s+$/, '');
  if (rs.endsWith('s') && !low.endsWith('ss') && !low.endsWith('staffs')) return 2;   // pluriel sans determinant : « holding swords »
  return 1;
}

function _fusionner(trouves) {
  const sortie = [];
  for (const o of trouves) {
    const tete = o.item.split(/\s+/).pop().toLowerCase();
    let fusionne = false;
    for (const p of sortie) {
      if (p.item.split(/\s+/).pop().toLowerCase() === tete && p.cls === o.cls) {
        p.count = Math.max(p.count, o.count);
        if (p.hand === null) p.hand = o.hand;
        fusionne = true;
        break;
      }
    }
    if (!fusionne) sortie.push(o);
  }
  return sortie;
}

function _finit(s, fin) { return s.endsWith(fin); }

export function extraireObjetsTenus(texte) {
  const t = texte || '';
  if (RE_SANS_ARME.test(t)) return [];
  let trouves = [];
  for (const m of t.matchAll(new RegExp(SRC_TENU, 'gi'))) {
    const det = m[1];
    const np = m[2].trim();
    let mots = np.split(/\s+/);
    if (mots.length && PARTICULES_REFUS.has(mots[0].toLowerCase())) continue;
    while (mots.length > 1 && PARTICULES_ELISION.has(mots[0].toLowerCase())) mots = mots.slice(1);
    if (mots.length > 1 && RE_ARTICLE.test(mots[0])) mots = mots.slice(1);
    const tete = mots[mots.length - 1].toLowerCase();
    const cl = _classe(tete);
    if (STOP_TENU.has(tete) || STOP_TENU.has(tete.replace(/s+$/, ''))) continue;
    if (PARTICULES_ELISION.has(tete) || PARTICULES_REFUS.has(tete)) continue;
    const item = mots.join(' ');
    trouves.push({ item, cls: cl, count: _nombreDet(det, item), hand: null, arme: cl !== null });
  }
  for (const m of t.matchAll(new RegExp(SRC_AVEC_DANS_MAIN, 'gi'))) {
    const mots = m[1].split(/\s+/);
    const cl = _classe(mots[mots.length - 1]);
    if (cl === null && !OBJETS_TENUS.includes(mots[mots.length - 1].toLowerCase())) continue;
    if (!trouves.some((o) => _finit(o.item, mots[mots.length - 1]))) {
      trouves.push({ item: mots.join(' '), cls: cl, count: 1, hand: m[2] === undefined ? null : m[2], arme: cl !== null });
    }
  }
  // « a sword and a shield » apres « holding a sword » : on cherche aussi « and (a|the) <arme> »
  for (const m of t.matchAll(new RegExp(SRC_ET_ARME, 'gi'))) {
    const mots = m[1].split(/\s+/);
    const cl = _classe(mots[mots.length - 1]);
    if (cl && trouves.length && !trouves.some((o) => _finit(o.item, mots[mots.length - 1]))) {
      trouves.push({ item: mots.join(' '), cls: cl, count: 1, hand: null, arme: true });
    }
  }
  trouves = _fusionner(trouves);
  const mh = RE_MAIN.exec(t);
  if (mh && trouves.length && trouves[0].hand === null) trouves[0].hand = mh[1].toLowerCase();
  if (RE_DEUX_MAINS.test(t) && trouves.length) trouves[0].hand = 'both';
  else if (RE_CHAQUE_MAIN.test(t) && trouves.length) trouves[0].count = Math.max(trouves[0].count, 2);
  return trouves;
}

function _nombreDe(g) { return Object.prototype.hasOwnProperty.call(NOMBRE, g) ? NOMBRE[g] : parseInt(g, 10); }

export function extraireParties(texte) {
  const t = (texte || '').toLowerCase();
  const out = {};
  for (const m of t.matchAll(/\b(one|single|two|three|four|five|six|seven|eight|nine|ten|\d+)[- ](headed|armed|legged|eyed|winged|tailed|horned|faced)\b/g)) {
    out[ADJ_PARTIE[m[2]]] = _nombreDe(m[1]);
  }
  for (const m of t.matchAll(/\b(one|single|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(heads?|arms?|legs?|eyes?|wings?|tails?|horns?|hands?|faces?)\b/g)) {
    out[m[2].replace(/s+$/, '')] = _nombreDe(m[1]);
  }
  const res = {};
  for (const p of Object.keys(out)) if (out[p] !== PAR_DEFAUT[p]) res[p] = out[p];
  return res;
}

export function extraireQuantiteObjet(texte) {
  const t = (texte || '').toLowerCase();
  let m = /\b(?:a )?(pair of|set of|couple of)\s+(?:(two|three|four|five|six|seven|eight|nine|ten|\d+)\s+)?((?:[a-z-]+\s+){0,2}[a-z-]+)/.exec(t);
  if (m && m.index <= 12) {
    const g2 = m[2];
    let n = null;
    if (g2) n = /^\d+$/.test(g2) ? parseInt(g2, 10) : (Object.prototype.hasOwnProperty.call(NOMBRE, g2) ? NOMBRE[g2] : null);
    return [n || (m[1] !== 'set of' ? 2 : 3), m[3].trim()];
  }
  m = /\b(two|three|four|five|six|seven|eight|nine|ten)\s+((?:[a-z-]+\s+){0,2}[a-z-]+s)\b/.exec(t);
  if (m && m.index <= 12) {
    const nom = m[2].trim();
    const tete = nom.split(/\s+/).pop().replace(/s+$/, '');
    if (PARTIES.includes(tete)) return null;
    return [NOMBRE[m[1]], nom];
  }
  return null;
}

export function analyser(texte, typeActif, style) {
  const t = texte || '';
  const objets = extraireObjetsTenus(t);
  const vue = VUE.exec(t);
  const couleurs = [];
  for (const c of COULEURS) if (new RegExp('\\b' + c + '\\b', 'i').test(t)) couleurs.push(c);
  const intent = {
    objets,
    arme_nommee: objets.some((o) => o.arme),
    sans_arme: RE_SANS_ARME.test(t),
    pose_libre: POSE_LIBRE.test(t),
    vue: vue ? vue[1].toLowerCase() : null,
    buste: BUSTE.test(t),
    non_humain: NONHUMAIN.test(t),
    parties: extraireParties(t),
    quantite: extraireQuantiteObjet(t),
    socle_voulu: DESACCORD_SOCLE.test(t),
    roche_voulue: ROCHE_VOULUE.test(t),
    mot_multiple: RE_MULTIPLE.test(t),
    couleurs: Array.from(new Set(couleurs)).sort(),
    style_non_photo: STYLES_NON_PHOTO.has(style || ''),
  };
  intent.asymetrique = objets.length > 0 || RE_ASYM.test(t);
  return intent;
}

function _regles(regles) {
  if (regles === 'toutes') return TOUTES_REGLES;
  return regles == null ? REGLES_ACTIVES : regles;
}

/** « holding exactly one X in the right hand, left hand open and empty » : a poser JUSTE APRES le texte de l'utilisateur. Null si rien n'est tenu. */
export function clauseObjetTenu(intent, regles) {
  if (!_regles(regles).includes('objets')) return null;
  const objets = intent.objets || [];
  if (!objets.length) return null;
  if (objets.length >= 2) return 'holding ' + objets[0].item + ' in the right hand and ' + objets[1].item + ' in the left hand';
  const o = objets[0];
  if (o.count >= 2) return 'holding exactly two ' + o.item.replace(/s+$/, '') + 's, one in each hand';
  const main = o.hand || 'right';
  if (main === 'both') return 'holding exactly one ' + o.item + ' with both hands';
  const autre = main === 'right' ? 'left' : 'right';
  return 'holding exactly one ' + o.item + ' in the ' + main + ' hand, ' + autre + ' hand open and empty';
}

// Consignes de T-pose du gabarit des unites, retirees quand l'utilisateur DECOCHE la case « T-pose » (pose libre).
export const CONSIGNES_TPOSE = ['T-pose', 'arms extended horizontally', 'legs apart', 'symmetric', 'empty open hands'];

/** Rend [gabarit adapte, notes]. La clause d'objet tenu n'est PAS dedans : voir clauseObjetTenu().
 *  options.tpose === false (case « T-pose » decochee) : pose libre, les consignes de T-pose quittent le gabarit des unites. Defaut : T-pose, rien ne change. */
export function composerGabarit(gabarit, typeActif, intent, regles, options) {
  const rg = _regles(regles);
  const tpose = !(options && options.tpose === false);
  let segs = gabarit.split(',').map((s) => s.trim()).filter((s) => s);
  const notes = [];
  const retirer = (...noms) => {
    const bas = new Set(noms.map((n) => n.toLowerCase()));
    const avant = segs.length;
    segs = segs.filter((s) => !bas.has(s.toLowerCase()));
    return segs.length !== avant;
  };
  const remplacer = (ancien, nouveau) => {
    for (let i = 0; i < segs.length; i++) {
      if (segs[i].toLowerCase() === ancien.toLowerCase()) { segs[i] = nouveau; return true; }
    }
    return false;
  };
  const estUnite = TYPES_UNITE.includes(typeActif);
  if (estUnite) {
    if (!tpose && retirer(...CONSIGNES_TPOSE)) notes.push('pose libre : T-pose non imposee (case decochee)');
    if (rg.includes('non_humain') && intent.non_humain && retirer('fully clothed')) notes.push('fully clothed retire (sujet non humain)');
    if (rg.includes('pose') && intent.pose_libre) {
      retirer('T-pose', 'arms extended horizontally', 'legs apart', 'symmetric', 'empty open hands');
      notes.push('pose demandee : T-pose non imposee');
    }
    if (rg.includes('buste') && intent.buste) {
      retirer('full body', 'legs apart');
      notes.push('buste demande : full body retire');
    }
    if (rg.includes('objets') && intent.objets.length) {
      if (retirer('empty open hands')) notes.push('mains vides retire (objet tenu)');
      if (retirer('symmetric')) notes.push('symmetric retire (objet tenu)');
      if (!(rg.includes('buste') && intent.buste)) {
        if (retirer('centered', 'clean silhouette')) {
          segs.push(CADRAGE_TENU);
          notes.push('cadrage : objet tenu entierement visible');
        }
      }
    } else if (rg.includes('asymetrie') && intent.asymetrique && retirer('symmetric')) {
      notes.push('symmetric retire (asymetrie demandee)');
    }
  }
  if (rg.includes('vue') && intent.vue) {
    const v = intent.vue;
    const vueTxt = (v.includes('back') || v.includes('rear') || v.includes('behind')) ? 'back view, seen from behind'
      : (v.includes('side') || v.includes('profile')) ? 'side view, in profile' : v;
    for (const ancien of ['strict front view', 'front view', 'side profile', 'lateral profile']) {
      if (remplacer(ancien, vueTxt)) break;
    }
    retirer('facing camera');
    notes.push('vue demandee : ' + vueTxt);
  }
  if (rg.includes('quantite') && intent.quantite && !estUnite) {
    const [n, nom] = intent.quantite;
    for (const ancien of ['isolated', 'full item', 'full weapon', 'complete vehicle', 'full structure']) retirer(ancien);
    segs.unshift('exactly ' + n + ' ' + nom + ', all fully visible, evenly spaced');
    notes.push('quantite demandee');
  }
  if (rg.includes('parties')) {
    for (const partie of Object.keys(intent.parties)) {
      const n = intent.parties[partie];
      segs.push('exactly ' + n + ' ' + partie + (n > 1 ? 's' : ''));
    }
    if (Object.keys(intent.parties).length) notes.push('nombres anatomiques ajoutes');
  }
  return [segs.join(', '), notes];
}

// ── relecture d'un prompt deja enrichi ───────────────────────────────────────────────────────────────────────────
// Le bouton « Enhance » affiche dans la zone de saisie : texte, [tenue d'epoque], CLAUSE, style, gabarit. Au clic « Generate »,
// stripKnownPromptSuffixes retire style et gabarit ; la clause reste en queue du texte. Sans ce retrait, chaque regeneration en
// ajouterait une de plus. Garde-fou : la clause n'est retiree que si le TEXTE RESTANT la regenere a l'identique (sinon c'etait
// l'ecriture de l'utilisateur, « knight holding exactly one sword in the right hand... », et on n'y touche pas).
const RE_CLAUSES_FIN = [
  /,?\s*holding exactly one .+? in the (?:right|left) hand, (?:right|left) hand open and empty\s*$/i,
  /,?\s*holding exactly one .+? with both hands\s*$/i,
  /,?\s*holding exactly two .+?s, one in each hand\s*$/i,
  /,?\s*holding [a-z'-]+(?: [a-z'-]+){0,3} in the right hand and [a-z'-]+(?: [a-z'-]+){0,3} in the left hand\s*$/i,
];
// Rognage par BOUCLES : un `/[\s,]+$/` est quadratique sur une longue suite de blancs (12 s pour 100 000 espaces, mesure du 2026-10-03).
const _BLANC = /\s/;               // un seul caractere a la fois : aucun motif quantifie ne parcourt le texte entier
function rognerFin(s) {            // retire les blancs et les virgules de la fin
  let b = s.length;
  while (b > 0 && (s[b - 1] === ',' || _BLANC.test(s[b - 1]))) b--;
  return s.slice(0, b);
}
function rognerDebut(s) {          // retire les blancs et les virgules du debut
  let a = 0;
  while (a < s.length && (s[a] === ',' || _BLANC.test(s[a]))) a++;
  return s.slice(a);
}
const FENETRE_CLAUSE = 600;        // une clause generee tient en moins de 300 caracteres et se trouve en QUEUE du texte : on ne regarde que la fin
export function retirerClauseFinale(texte) {
  const t = String(texte == null ? '' : texte);
  const nu = rognerFin(t);         // la coupe du gabarit laisse une virgule en queue
  const debutFenetre = Math.max(0, nu.length - FENETRE_CLAUSE);
  const fenetre = nu.slice(debutFenetre);
  for (const re of RE_CLAUSES_FIN) {
    const m = re.exec(fenetre);
    if (!m) continue;
    const reste = rognerFin(nu.slice(0, debutFenetre + m.index));
    const clause = rognerFin(rognerDebut(m[0]));
    // la clause a ete composee sur le texte SANS ses negations (« no weapon, holding a shield » ne contient plus « no weapon » pour l'analyse)
    const regen = clauseObjetTenu(analyser(positifSansNegations(reste), 'character', ''), undefined);
    if (regen && regen.toLowerCase() === clause.toLowerCase()) return reste;
  }
  return t;
}

/** Remplace les suites de virgules separees par des blancs (« a, , b » ; « a,, b ») par UNE virgule, retire la virgule de tete et de queue, puis les blancs de bord.
 *  Meme resultat que la chaine de quatre remplacements d'origine de stripKnownPromptSuffixes (virgules doubles, virgule de tete, virgule de queue, trim) pour
 *  tout texte qui n'a pas trois virgules d'affilee, mais en temps lineaire (la chaine d'origine est quadratique sur de longues suites de blancs). */
export function nettoyerVirgules(texte) {
  let s = String(texte == null ? '' : texte);
  const n = s.length;
  let out = '';
  let i = 0;
  while (i < n) {
    let j = i;
    while (j < n && _BLANC.test(s[j])) j++;
    if (j < n && s[j] === ',') {
      let fin = j + 1;
      let nb = 1;
      for (;;) {
        let m = fin;
        while (m < n && _BLANC.test(s[m])) m++;
        if (m < n && s[m] === ',') { nb++; fin = m + 1; } else break;
      }
      let e = fin;
      while (e < n && _BLANC.test(s[e])) e++;
      if (nb >= 2) { out += ', '; i = e; continue; }
      out += s.slice(i, j + 1);       // une seule virgule : les blancs d'avant et la virgule, tels quels
      i = j + 1;
      continue;
    }
    if (j > i) { out += s.slice(i, j); i = j; } else { out += s[i]; i++; }
  }
  s = out;
  let a = 0;
  while (a < s.length && _BLANC.test(s[a])) a++;
  if (a < s.length && s[a] === ',') {
    a++;
    while (a < s.length && _BLANC.test(s[a])) a++;
    s = s.slice(a);
  }
  let b = s.length;
  while (b > 0 && _BLANC.test(s[b - 1])) b--;
  if (b > 0 && s[b - 1] === ',') {
    b--;
    while (b > 0 && _BLANC.test(s[b - 1])) b--;
    s = s.slice(0, b);
  }
  return s.trim();
}

// ── negations de l'utilisateur (2026-10-03) ──────────────────────────────────────────────────────────────────────────
// Jumeau de extraire_negations() de scripts/composeur_intention.py : MEMES mots, MEMES regles, MEMES sorties (build/check-intention.mjs). « an orc,
// no helmet, holding a club » : le modele d'image ne comprend pas la negation (il voit « helmet » et le dessine) ; elle doit QUITTER le positif et
// rejoindre le NEGATIF (champ `negativeExtra`). Un balayage de mots, AUCUNE regex a retour arriere (texte tronque a 2 000 caracteres, temps lineaire).
// PRUDENCE : ce qui n'est pas compris RESTE dans le positif, tel quel ; un terme VOULU n'est jamais envoye au negatif. Refuses (le texte ne bouge pas) : les faux
// amis (« no one », « not only X but also Y », « no smoking »...), les EXCEPTIONS (« no armor except a helmet », « no weapon other than a club » : l'objet VOULU
// suit le mot d'exception), un second groupe nominal sans liaison (« no beard a mustache »), un nom SUJET d'un verbe conjugue (« no soldier wears a helmet »), les
// titres, une liste dont un element est illisible (« without a hat and shirt ») et la garde-robe (« without clothes » : le filtre de moderation doit la VOIR).
// « of » prolonge un groupe (« no signs of rust »). Une negation en TETE de segment retire son complement mais GARDE la proposition verbale qui la suit
// (« no helmet holding axe » -> « holding axe ») ; au MILIEU d'une phrase seule la locution part. Au-dela de 8 termes, les negations suivantes quittent aussi le positif.
export const MAX_TEXTE_NEGATIONS = 2000;
export const MAX_TERMES_NEGATIFS = 8;
export const MAX_CARS_TERME = 40;
export const MAX_MOTS_TERME = 3;

const NEG_BLANCS = ' \t\r\n ';
const _mots = (s) => new Set(s.split(' '));
const NEG_ARTICLES = _mots('a an the any some his her its their my your our');
const NEG_LEGERS = _mots('wearing holding carrying having using showing including being with');
const NEG_SAUT_AUTRES = new Set([...NEG_ARTICLES, ...NEG_LEGERS]);
const NEG_LEGERS_NOT = _mots('wearing holding carrying having using showing wielding');
const NEG_CONJ = _mots('and or nor but');
const NEG_FIN_GN = _mots('and or nor but with without in on at to for from by as while that which who whose whom where when if than then so because '
  + 'is are was were be been being has have had does do did could would should shall might must '
  + 'near over under behind above below next around inside outside into onto through across between among against along during before after '
  + 'like via per plus not no never of up down off out about beside beneath beyond despite toward towards throughout within upon atop amid '
  + 'alongside underneath till until unlike');
// marqueurs d'EXCEPTION ou de contraste : le groupe s'arrete devant eux ET la negation entiere est REFUSEE (« no armor except a helmet »)
const NEG_EXCEPT = _mots('except excepting excluding besides apart aside save unless instead rather just only than');
// verbes en -ing / participes qui ouvrent une AUTRE proposition quand quelque chose les suit (« no helmet holding axe ») ; seuls, en fin de segment
// (« no birds flying »), ils font partie du groupe nie. Liste FERMEE : un nom en -ing (« clothing », « building ») n'en est pas un.
const NEG_VERBES = _mots('holding wearing carrying standing sitting walking running looking riding having using showing wielding gripping covered '
  + 'dressed clad posing facing lying kneeling crouching leaning resting hanging jumping fighting floating hovering');
// formes CONJUGUEES et modaux : le groupe qui les precede est leur SUJET (« no soldier wears a helmet »)
const NEG_FINIS = _mots('holds wears carries stands sits has have had does do did could would should shall might must can will may');
const NEG_COPULES = _mots('is are was were be been being');
const NEG_FINALES = _mots('visible whatsoever whatever anywhere present allowed');
const NEG_VIDES = _mots('anything something everything nothing none anyone someone everyone anybody somebody everybody nobody neither either both all each every '
  + 'else other others more less much many same such one ones thing things way longer matter doubt idea need sense kind sort type part parts '
  + 'element elements extra additional further');
const NEG_SENSIBLES = _mots('clothes clothing clothe clothed shirt shirts top tops pants trousers underwear underpants undergarments lingerie bra bras '
  + 'panties dress dresses skirt skirts swimsuit bikini outfit outfits garment garments attire apparel nude naked nudity topless bare nsfw');
const NEG_FAUX = {
  no: _mots('one longer more matter doubt idea need way sense less sooner such problem kidding thanks thank '
    + 'smoking entry parking trespassing littering loitering'),
  not: _mots('only just too very quite even at really exactly necessarily yet so as much many always sure to enough particularly entirely '
    + 'completely fully simply merely rather less more once since until unless all that this what how if because unlike'),
  never: _mots('before again ever ending ended more quite been seen mind too'),
  without: _mots('further fail doubt question warning ever limit end exception delay'),
};
const NEG_AVANT_NO = _mots('with and but or plus having has holding wearing carrying using showing including');
const NEG_DEBUT = _mots('and but or with plus also yet');
const NEG_PENDANTS = _mots('and or nor but with is are was were has have had that which who whose whom where when while as if because then so plus also yet '
  + 'being be been does do did');
const NEG_PRONOMS = _mots('he she it they this that these those who which whose');
const NEG_LIAISON_DEBUT = _mots('and but or nor plus also yet');
const NEG_NEGATIFS = _mots('no not never nobody none nothing neither nor cannot nowhere');
const NEG_DECLENCHEURS = ['no', 'not', 'never', 'without'];

function negMots(segment) {
  const jetons = [];
  let cur = '';
  for (const ch of segment) {
    if (NEG_BLANCS.includes(ch)) {
      if (cur) { jetons.push(cur); cur = ''; }
    } else {
      cur += ch;
    }
  }
  if (cur) jetons.push(cur);
  return jetons;
}

/** [blancs du debut, blancs de la fin]. */
function negBords(s) {
  let a = 0;
  let b = s.length;
  while (a < b && NEG_BLANCS.includes(s[a])) a++;
  while (b > a && NEG_BLANCS.includes(s[b - 1])) b--;
  return [s.slice(0, a), s.slice(b)];
}

function negStrip(s) {
  const [avant, apres] = negBords(s);
  return s.slice(avant.length, s.length - apres.length);
}

/** [mot en minuscules, ferme] ; [null, false] si le jeton n'est pas un mot (chiffre, symbole, lettre accentuee). `ferme` : ponctuation de fin. */
function negCoeur(jeton) {
  let a = 0;
  let b = jeton.length;
  while (a < b && '"\'([{'.includes(jeton[a])) a++;
  const b0 = b;
  while (b > a && '"\')]}.!?:'.includes(jeton[b - 1])) b--;
  const mot = jeton.slice(a, b);
  if (!mot) return [null, false];
  for (let k = 0; k < mot.length; k++) {
    const ch = mot[k];
    if (!((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '-' || ch === "'")) return [null, false];
  }
  return [mot.toLowerCase(), b < b0];
}

/** Le jeton est-il ecrit « Capitalise » (majuscule puis au moins une minuscule) ? « NO », « WITHOUT » en capitales sont de l'emphase, pas un titre. */
function negMajuscule(jeton) {
  let a = 0;
  while (a < jeton.length && '"\'([{'.includes(jeton[a])) a++;
  if (!(a < jeton.length && jeton[a] >= 'A' && jeton[a] <= 'Z')) return false;
  for (let k = a; k < jeton.length; k++) {
    if (jeton[k] >= 'a' && jeton[k] <= 'z') return true;
  }
  return false;
}

/** La casse du texte n'apprend rien : tout en MAJUSCULES, ou Title Case (3 mots au moins, 70 % ou plus commencent par une majuscule). La garde des titres ne joue alors pas. */
function negCasseLibre(t) {
  let total = 0;
  let maj = 0;
  let minuscule = false;
  for (const jeton of negMots(t)) {
    let premiere = '';
    for (let k = 0; k < jeton.length; k++) {
      const ch = jeton[k];
      if (ch >= 'a' && ch <= 'z') {
        minuscule = true;
        if (!premiere) premiere = ch;
      } else if (ch >= 'A' && ch <= 'Z') {
        if (!premiere) premiere = ch;
      }
    }
    if (premiere) {
      total++;
      if (premiere >= 'A' && premiere <= 'Z') maj++;
    }
  }
  if (total === 0) return false;
  return !minuscule || (total >= 3 && maj * 10 >= total * 7);
}

function negMotPropre(m) {
  if (!m || m[0] === '-' || m[m.length - 1] === '-' || m.includes('--')) return false;
  for (let k = 0; k < m.length; k++) {
    const ch = m[k];
    if (!((ch >= 'a' && ch <= 'z') || ch === '-')) return false;
  }
  return true;
}

/** « knight's helmet » -> ['helmet'] : le possesseur n'est pas ce qu'on nie. Un mot en « 's » ou « s' » coupe le groupe ; rien apres lui -> []. */
function negApresPossessif(mots) {
  for (let k = mots.length - 1; k >= 0; k--) {
    const m = mots[k];
    if (m.length > 2 && (m.endsWith("'s") || m.endsWith("s'"))) return mots.slice(k + 1);
  }
  return mots;
}

function negTerme(mots) {
  mots = negApresPossessif(mots);
  mots = mots.slice(-MAX_MOTS_TERME);
  while (mots.length && mots[0] === 'of') mots = mots.slice(1);     // « suit of plate armor » : les 3 derniers mots commencent par « of »
  if (!mots.length) return null;
  for (const m of mots) {
    // un morceau a tiret sensible (« t-shirt ») est refuse comme le mot entier : le serveur applique la meme regle (termes_negatifs_valides)
    if (!negMotPropre(m) || m.split('-').some((p) => NEG_SENSIBLES.has(p))) return null;
  }
  if (mots.every((m) => NEG_VIDES.has(m))) return null;
  const terme = mots.join(' ');
  if (terme.length > MAX_CARS_TERME) return null;
  return terme;
}

/** Un mot negatif est-il deja dans ce qui precede dans le segment (« not without a helmet », « isn't without a hat ») ? Une double negation dit l'inverse. */
function negAvantNegatif(sortie) {
  for (const s of sortie) {
    const w = negCoeur(s)[0];
    if (w !== null && (NEG_NEGATIFS.has(w) || w.endsWith("n't"))) return true;
  }
  return false;
}

/** Le mot `w` (jeton j) ouvre-t-il une AUTRE proposition ? Un verbe en -ing de la liste fermee, quand quelque chose le suit dans le segment. */
function negOuvre(jetons, j, w, ferme) {
  return NEG_VERBES.has(w) && !ferme && j + 1 < jetons.length;
}

/** La liste nommee continue-t-elle apres le groupe qui finit en i ? -> [indice ou reprendre, declencheur repete] ou null. */
function negSuite(jetons, i, decl, ferme) {
  const n = jetons.length;
  if (ferme || i >= n) return null;
  const w = negCoeur(jetons[i])[0];
  if (w !== 'and' && w !== 'or' && w !== 'nor') return null;
  let k = i + 1;
  let repete = false;
  if (k < n && NEG_DECLENCHEURS.includes(negCoeur(jetons[k])[0])) {
    repete = true;
    k++;
  }
  if (!repete && w === 'and' && decl !== 'without') return null;
  const saut = repete ? NEG_SAUT_AUTRES : NEG_ARTICLES;
  let m = k;
  while (m < n) {
    const w3 = negCoeur(jetons[m])[0];
    if (w3 !== null && saut.has(w3)) m++; else break;
  }
  if (m >= n) return null;
  const w3 = negCoeur(jetons[m])[0];
  if (w3 === null || NEG_FIN_GN.has(w3) || NEG_EXCEPT.has(w3) || NEG_VERBES.has(w3) || NEG_FINIS.has(w3)) return null;
  if (!repete && w3.length >= 5 && w3.endsWith('ed')) return null;
  return [k, repete];
}

/** Groupes nominaux nies apres le declencheur `decl`, a partir du jeton i. -> [termes, fin, ferme] ou null. */
function negListe(jetons, i, decl) {
  const n = jetons.length;
  const saut = decl === 'no' ? NEG_ARTICLES : NEG_SAUT_AUTRES;
  const faux = NEG_FAUX[decl];
  if (i < n && faux.has(negCoeur(jetons[i])[0])) return null;
  const termes = [];
  let fin = null;
  let ferme = false;
  let repete = false;
  for (;;) {
    while (i < n) {
      const w = negCoeur(jetons[i])[0];
      if (w !== null && saut.has(w)) i++; else break;
    }
    const mots = [];
    let fermeGroupe = false;
    let j = i;
    while (j < n) {
      const [w, f] = negCoeur(jetons[j]);
      if (w === 'of' && mots.length && !f) {
        // « no signs of rust » : « of » prolonge le groupe quand un mot suit (les articles sont sautes)
        let k = j + 1;
        while (k < n && NEG_ARTICLES.has(negCoeur(jetons[k])[0])) k++;
        const [w2, f2] = k < n ? negCoeur(jetons[k]) : [null, false];
        if (w2 === null || NEG_FIN_GN.has(w2) || NEG_EXCEPT.has(w2) || '([{'.includes(jetons[k][0])) break;
        mots.push('of');
        mots.push(w2);
        fermeGroupe = f2;
        j = k + 1;
        if (f2) break;
        continue;
      }
      if (w === null || NEG_FIN_GN.has(w) || NEG_EXCEPT.has(w)) break;
      if (mots.length && ('([{'.includes(jetons[j][0]) || NEG_ARTICLES.has(w) || NEG_FINIS.has(w) || negOuvre(jetons, j, w, f))) break;
      mots.push(w);
      fermeGroupe = f;
      j++;
      if (f) break;
    }
    while (mots.length > 1 && NEG_FINALES.has(mots[mots.length - 1])) mots.pop();   // « no weapons visible » -> « weapons »
    let terme = null;
    if (mots.length && !faux.has(mots[0])) terme = negTerme(mots);
    if (terme === null) {
      if (termes.length && repete) break;   // un groupe illisible apres un declencheur REPETE garde sa propre negation : on garde ce qui a ete compris
      return null;                           // sinon tout est refuse : « without a hat and shirt » ne doit pas devenir « and shirt »
    }
    termes.push(terme);
    fin = j;
    ferme = fermeGroupe;
    const suite = negSuite(jetons, j, decl, fermeGroupe);
    if (suite === null) break;
    i = suite[0];
    repete = suite[1];
  }
  return [termes, fin, ferme];
}

function negVerbal(jeton) {
  const w = negCoeur(jeton)[0];
  return w !== null && (NEG_VERBES.has(w) || NEG_FINIS.has(w) || (w.length >= 5 && (w.endsWith('ing') || w.endsWith('ed'))));
}

/** Le jeton qui suit i (une copule) est-il une forme en -ing (« is wearing ») ? */
function negSuitIng(jetons, i) {
  if (i + 1 >= jetons.length) return false;
  const w = negCoeur(jetons[i + 1])[0];
  return w !== null && w.length >= 5 && w.endsWith('ing');
}

/** Que devient ce qui SUIT le groupe nie (a partir de `fin`) ? -> indice ou reprendre le balayage, ou -1 : refus, le texte reste tel quel. Voir _neg_reprise (Python). */
function negReprise(jetons, fin, ferme, debut) {
  const n = jetons.length;
  if (fin >= n) return n;
  if (ferme) return fin;
  const [w, f] = negCoeur(jetons[fin]);
  if (w !== null && (NEG_EXCEPT.has(w) || NEG_ARTICLES.has(w) || w === 'of')) return -1;
  if (debut) {
    if (NEG_CONJ.has(w)) return fin + 1;
    if (NEG_DECLENCHEURS.includes(w)) return fin;
    if (NEG_FINIS.has(w)) return -1;
    if (NEG_COPULES.has(w) && negSuitIng(jetons, fin)) return -1;
    if (w !== null && negOuvre(jetons, fin, w, f)) return fin;
    for (let k = fin; k < n; k++) {
      const wk = negCoeur(jetons[k])[0];
      if (NEG_EXCEPT.has(wk) || wk === 'but' || wk === 'exception' || wk === 'exceptions') return -1;
    }
    return n;
  }
  if ((w === 'and' || w === 'or') && fin + 1 < n && negVerbal(jetons[fin + 1])) return fin + 1;
  if (w === 'at' && fin + 1 < n && negCoeur(jetons[fin + 1])[0] === 'all') return fin + 2;
  return fin;
}

/** Un segment (entre deux virgules). -> [action, jetons], action : 'garder' | 'modifier' | 'retirer'. Les termes trouves sont ajoutes a `etat` (8 au plus). */
function negTraiterSegment(jetons, etat, casseLibre) {
  const n = jetons.length;
  let sortie = [];
  let i = 0;
  let modifie = false;
  let coupeFin = false;
  while (i < n) {
    const jeton = jetons[i];
    const w = negCoeur(jeton)[0];
    let debut = true;
    for (const s of sortie) {
      if (!NEG_DEBUT.has(negCoeur(s)[0])) { debut = false; break; }
    }
    let decl = null;
    let precedent = 0;
    if (NEG_DECLENCHEURS.includes(w)) {
      if (debut) {
        if (!'"“'.includes(jeton[0])) {
          let titre = false;
          if (!casseLibre && negMajuscule(jeton)) {
            let capitales = 0;       // « No Country for Old Men » : une locution capitalisee suivie d'au moins deux autres mots capitalises = un titre
            for (let k = i + 1; k < n; k++) {
              if (negMajuscule(jetons[k])) capitales++;
            }
            titre = capitales >= 2;
          }
          if (!titre) decl = w;
        }
      } else if (negAvantNegatif(sortie)) {
        decl = null;
      } else if ('([{'.includes(jeton[0])) {
        decl = w;
      } else if (negMajuscule(jeton) && !casseLibre) {
        decl = null;
      } else if (w === 'without') {
        decl = w;
      } else if (w === 'no' && NEG_AVANT_NO.has(negCoeur(sortie[sortie.length - 1])[0])) {
        decl = w;
        precedent = 1;
      } else if (w === 'not' && i + 1 < n && NEG_LEGERS_NOT.has(negCoeur(jetons[i + 1])[0])) {
        decl = w;
      }
    }
    if (decl !== null) {
      const res = negListe(jetons, i + 1, decl);
      let reprise = -1;
      let termes = null;
      if (res !== null) {
        termes = res[0];
        reprise = negReprise(jetons, res[1], res[2], debut);
      }
      if (reprise >= 0) {
        for (const t of termes) {
          if (!etat.includes(t) && etat.length < MAX_TERMES_NEGATIFS) etat.push(t);
        }
        modifie = true;
        if (debut) sortie = [];
        else if (precedent) sortie.pop();
        i = reprise;
        coupeFin = i >= n;
        continue;
      }
    }
    sortie.push(jeton);
    i++;
    coupeFin = false;
  }
  if (coupeFin) {
    // la locution etait a la FIN : le mot de liaison ou l'auxiliaire qui la precedait ne lie plus rien
    while (sortie.length && NEG_PENDANTS.has(negCoeur(sortie[sortie.length - 1])[0])) sortie.pop();
    if (sortie.length === 1 && NEG_PRONOMS.has(negCoeur(sortie[0])[0])) sortie = [];
  }
  if (!modifie) return ['garder', jetons];
  if (!sortie.length) return ['retirer', []];
  return ['modifier', sortie];
}

/** Retire le mot de liaison qui ouvre le segment (« but a crown » -> « a crown ») ; le segment tel quel sinon. */
function negSansLiaisonDebut(seg) {
  const [avant] = negBords(seg);
  const corps = seg.slice(avant.length);
  let k = 0;
  while (k < corps.length && !NEG_BLANCS.includes(corps[k])) k++;
  if (!NEG_LIAISON_DEBUT.has(negCoeur(corps.slice(0, k))[0])) return seg;
  const reste = corps.slice(k);
  let j = 0;
  while (j < reste.length && NEG_BLANCS.includes(reste[j])) j++;
  return avant + reste.slice(j);
}

/** Decoupe sur , ; | retour a la ligne, point suivi d'un blanc et tiret isole (« a cat - no tail - sitting »).
 *  -> [[segment, separateur], ...] ; le separateur garde les blancs qui le suivent. */
function negSegments(t) {
  const segs = [];
  let cur = '';
  let i = 0;
  const n = t.length;
  while (i < n) {
    const c = t[i];
    if (',;|\r\n'.includes(c) || (c === '.' && (i + 1 >= n || NEG_BLANCS.includes(t[i + 1])))
        || ('-–—'.includes(c) && (i === 0 || NEG_BLANCS.includes(t[i - 1])) && (i + 1 >= n || NEG_BLANCS.includes(t[i + 1])))) {
      let j = i + 1;
      while (j < n && ' \t '.includes(t[j])) j++;
      segs.push([cur, t.slice(i, j)]);
      cur = '';
      i = j;
    } else {
      cur += c;
      i++;
    }
  }
  segs.push([cur, '']);
  return segs;
}

/** Separe le texte de l'utilisateur en POSITIF (sans les locutions negatives) et NEGATIFS (termes a ajouter au negatif). -> { positif, negatifs }.
 *  Memes regles que extraire_negations() du module Python (voir son docstring). Un texte sans negation est rendu OCTET POUR OCTET.
 *  `regles` sans 'negations' (interrupteur d'urgence : []) : rien n'est extrait. */
export function extraireNegations(texte, regles) {
  let t = typeof texte === 'string' ? texte : (texte == null ? '' : String(texte));
  if (t.length > MAX_TEXTE_NEGATIONS) t = Array.from(t).slice(0, MAX_TEXTE_NEGATIONS).join('');
  if (!_regles(regles).includes('negations')) return { positif: t, negatifs: [] };
  const libre = negCasseLibre(t);
  const etat = [];
  const morceaux = [];
  for (const [seg, sep] of negSegments(t)) {
    const jetons = negMots(seg);
    if (!jetons.length) { morceaux.push([seg, sep]); continue; }
    const [action, nouveaux] = negTraiterSegment(jetons, etat, libre);
    if (action === 'garder') morceaux.push([seg, sep]);
    else if (action === 'modifier') {
      const [avant, apres] = negBords(seg);   // les blancs de bord du segment sont gardes (« a cat - no tail - sitting »)
      morceaux.push([avant + nouveaux.join(' ') + apres, sep]);
    }
    else morceaux.push([null, sep]);
  }
  if (!etat.length) return { positif: t, negatifs: [] };
  while (morceaux.length > 1 && morceaux[morceaux.length - 1][0] === '' && morceaux[morceaux.length - 1][1] === '') morceaux.pop();
  if (morceaux[0][0] === null) {
    // le texte COMMENCE par une negation retiree : le mot de liaison qui ouvrait la suite (« no helmet, but a crown ») n'a plus rien a lier
    for (let k = 1; k < morceaux.length; k++) {
      if (morceaux[k][0] !== null) {
        const neuf = negSansLiaisonDebut(morceaux[k][0]);
        if (neuf !== morceaux[k][0]) morceaux[k] = [negStrip(neuf) ? neuf : null, morceaux[k][1]];
        break;
      }
    }
  }
  const gardes = morceaux.filter((m) => m[0] !== null).map((m) => [m[0], m[1]]);
  if (gardes.length && morceaux[morceaux.length - 1][0] === null) {
    gardes[gardes.length - 1][1] = morceaux[morceaux.length - 1][1].startsWith('.') ? '.' : '';
  }
  return { positif: negStrip(gardes.map((m) => m[0] + m[1]).join('')), negatifs: etat.slice() };
}

// ── pour la fabrication du prompt (index2.js) : memes resultats que extraireNegations, avec deux garde-fous ─────────────────────────────────────────
// 1. un texte de plus de 2 000 caracteres n'est PAS analyse (extraireNegations le tronquerait : on ne coupe jamais le texte de l'utilisateur) ;
// 2. un texte ENTIEREMENT negatif (« no helmet ») garde son positif tel quel : un prompt vide ne vaut rien (les termes partent quand meme au negatif).
function negTropLong(t) {
  return t.length > MAX_TEXTE_NEGATIONS && Array.from(t).length > MAX_TEXTE_NEGATIONS;
}

/** { positif, negatifs } pour fabriquer un prompt : voir les deux garde-fous ci-dessus. */
export function negationsEtPositif(texte, regles) {
  const t = String(texte == null ? '' : texte);
  if (negTropLong(t)) return { positif: t, negatifs: [] };
  const r = extraireNegations(t, regles);
  if (!r.negatifs.length) return { positif: t, negatifs: [] };
  if (!negStrip(r.positif)) return { positif: t, negatifs: r.negatifs };
  return r;
}

/** Le texte sans ses locutions negatives (« an orc, no helmet, holding a club » -> « an orc, holding a club »), ou le texte lui-meme. */
export function positifSansNegations(texte, regles) {
  return negationsEtPositif(texte, regles).positif;
}

/** Les termes de negatif du texte (tableau de chaines, 8 au plus). */
export function negationsDe(texte, regles) {
  return negationsEtPositif(texte, regles).negatifs;
}

/** Tableau tel que le serveur l'accepte (champ `negativeExtra`) : 8 termes au plus, 40 caracteres au plus, lettres ASCII / espaces / tirets, minuscules,
 *  sans doublon. Un element invalide est ECARTE (jamais corrige). Toute entree : une valeur inattendue donne []. */
export function assainirNegatifs(liste) {
  if (!Array.isArray(liste)) return [];
  const sortie = [];
  for (const brut of liste) {
    if (typeof brut !== 'string') continue;
    let propre = true;
    for (const ch of brut) {
      if (!((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '-' || NEG_BLANCS.includes(ch))) { propre = false; break; }
    }
    if (!propre) continue;
    const mots = negMots(brut.toLowerCase());
    if (!mots.length || mots.some((m) => !negMotPropre(m))) continue;
    const terme = mots.join(' ');
    if (terme.length > MAX_CARS_TERME || sortie.includes(terme)) continue;
    sortie.push(terme);
    if (sortie.length >= MAX_TERMES_NEGATIFS) break;
  }
  return sortie;
}

// ── residus des ANCIENS gabarits (2026-10-03) ────────────────────────────────────────────────────────────────────────
// Jusqu'au 2026-09-24 les gabarits de prompt portaient eux-memes des negations (« no shadows », « NOT a portrait »...) ; les projets d'alors les ont
// gardees dans leur texte enregistre. stripKnownPromptSuffixes (index2.js) les retirait TOUTES, avec tout segment « no / not / never » : y compris
// ceux de l'UTILISATEUR (« an orc, no helmet » perdait « no helmet »). Elle ne retire plus que cette liste, et seulement si le texte porte aussi une
// SIGNATURE d'ancien gabarit : « no shadows » ou « no text » tapes par l'utilisateur dans un texte d'aujourd'hui restent donc dans son texte, puis vont au negatif.
// SOURCES (historique git, tables ASSET_TYPE_PROMPTS de src/renderer/index2.js, cloud/public/app/index2.js et modal_app/_prompts.py ; relevees par
// balayage de toutes les versions qui touchent une ligne de gabarit : `git log -G"white background|T-pose|photorealistic" -- <fichier>`) :
//   d750b055 (2026-05-31) NOT a portrait / NOT a headshot / NO close-up... ; fe1941eb et 00425bf2 (2026-05-30) NEVER bipedal / NEVER upright... ;
//   41da4867 (2026-05-30) no T-pose ; 90606d2c, d0b3853a, 53b50079 (2026-06-19) gabarit « insect » : NOT eight legs, NOT a spider, no extra legs... ;
//   81b7a39e (2026-06-21) retire « ONE X only » / « no duplicate » / « no second X » des gabarits de base ; 497a152c (2026-09-23) retire les negations des 9
//   gabarits restants (NOT a bust shot, no text, no UI, no clouds, no wake...) ; 2bb8f2eb (2026-09-24) retire celles de vehicle / weapon / prop / environment /
//   other_* (no shadows, no characters...). Le style « hand-painted » garde « no realistic PBR maps » aujourd'hui encore (ASSET_STYLE_PROMPTS).
// Forme normalisee : minuscules, blancs simples. NE JAMAIS EN RETIRER : un projet cree en 2026 doit rester nettoyable en 2030.
export const NEGATIONS_GABARIT_HISTORIQUES = [
  'never bipedal', 'never cartoon mascot stance', 'never humanoid posture', 'never standing on hind legs', 'never t-pose', 'never upright',
  'no bust shot', 'no characters', 'no clouds', 'no close-up', 'no contrail', 'no doubled legs', 'no duplicate', 'no duplicated legs',
  'no extra elements', 'no extra legs', 'no extra limbs', 'no extra tails', 'no face only', 'no formation', 'no fur', 'no head and shoulders',
  'no head only', 'no headshot', 'no horizon', 'no human stance', 'no humanoid anthropomorphism', 'no humanoid posture', 'no humans', 'no logo',
  'no mirrored extra legs', 'no multiple tails', 'no other characters', 'no other creatures', 'no overlapping duplicate limbs', 'no portrait',
  'no realistic pbr maps', 'no rear view inset', 'no second animal', 'no second boat', 'no second building', 'no second car', 'no second creature',
  'no second insect', 'no second instance', 'no second item', 'no second plane', 'no second structure', 'no second vehicle', 'no shadows', 'no t-pose',
  'no tail', 'no text', 'no twin', 'no ui', 'no upright posture', 'no wake', 'no water',
  'not a bust shot', 'not a cat', 'not a close-up', 'not a dog', 'not a face shot', 'not a front head-on view', 'not a head shot', 'not a headshot',
  'not a mammal', 'not a portrait', 'not a quadruped', 'not a spider', 'not a symmetric front view', 'not a town', 'not a village', 'not an arachnid',
  'not cropped', 'not eight legs', 'not head and shoulders', 'not touching the frame edges', 'not zoomed on face',
];
// Phrases qu'aucun gabarit d'aujourd'hui ni aucun texte courant n'ecrit, et que les gabarits d'avant le 2026-09-24 portaient (sous forme normalisee,
// en minuscules ; recherche par inclusion dans le texte brut). Validees contre l'historique : chaque ligne d'ancien gabarit qui porte une negation en contient
// une, et aucune ligne des tables actuelles n'en contient (tests/bureau-interface/composeur-prompt.test.mjs).
export const SIGNATURES_GABARITS_ANCIENS = [
  '3d game asset reference sheet', 'full body character sheet', 'full body character reference', 'body fills 60 percent of frame',
  'rts unit game asset', 't-pose neutral stance', 'single isolated 3d', 'one character only', 'one creature only',
  'one animal only', 'one insect only', 'one building only', 'one car only', 'one weapon only', 'one prop only', 'one item only', 'one subject only',
  'one vehicle only', 'one structure only', 'one environment piece only', 'one element only', 'one complete boat only',
  'one complete passenger aircraft only', 'one single building', 'one single vehicle', 'one single weapon', 'one single prop', 'one single creature',
  'one single environment piece', 'one single character', 'wearing a complete outfit', 'dressed in appropriate clothing',
  'transparent or pure white background', 'application icon style', 'complete edifice', 'studio lighting, no shadows',
  'complete passenger aircraft, isolated', 'complete boat, isolated', 'flat icon, app icon', 'isometric three-quarter view', 'angled side view',
  'wildlife photography of one animal', 'animal photography full body', 'single flat icon', 'single arthropod', 'isolated on a neutral background',
];
const RESIDUS_GABARIT = new Set(NEGATIONS_GABARIT_HISTORIQUES);

/** Le texte porte-t-il la marque d'un gabarit d'AVANT le 2026-09-24 (ceux qui contenaient des negations) ? */
export function texteDUnAncienGabarit(texte) {
  const bas = String(texte == null ? '' : texte).toLowerCase();
  return SIGNATURES_GABARITS_ANCIENS.some((s) => bas.includes(s));
}

/** Retire d'un texte (segments separes par des virgules) les segments qui sont EXACTEMENT un residu connu d'ancien gabarit. Rien d'autre. */
export function retirerNegationsGabarit(texte) {
  const segs = String(texte == null ? '' : texte).split(',');
  const gardes = segs.filter((s) => !RESIDUS_GABARIT.has(negMots(s).join(' ').toLowerCase()));
  return gardes.length === segs.length ? String(texte == null ? '' : texte) : gardes.join(',');
}
