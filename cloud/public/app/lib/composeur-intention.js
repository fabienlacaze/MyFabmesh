// COMPOSEUR D'INTENTION (2026-10-03) — jumeau JavaScript de scripts/composeur_intention.py (= modal_app/composeur_intention.py).
// FICHIER COMMUN bureau / web (src/renderer/lib = cloud/public/app/lib, build/check-noyaux-partages.mjs).
//
// POURQUOI. Un personnage « orc tenant une massue » sortait avec une arme dans chaque main : le gabarit du type Character se contredit
// (« empty open hands », « symmetric », T-pose bras tendus) et le negatif interdit « club ». Mesure sur l'orc, graine fixe, 4 images :
// 0 sur 4 n'avait qu'une arme ; avec une consigne qui dit l'intention et sans les consignes contradictoires, 3 sur 4.
//
// CE QUE FAIT LE MODULE : analyser le texte de l'utilisateur de facon DETERMINISTE (regex seulement) et adapter le gabarit positif.
// Un texte qui ne dit rien d'un objet tenu donne EXACTEMENT le gabarit d'origine (cas temoin « An orc » : identique a l'octet).
// Les negatifs sont composes cote Python (pont du bureau, Modal) : ce fichier n'en compose pas.
//
// MEMES NOMS DE CLES que le module Python (snake_case) : build/intention_cas.json + build/intention_attendus.json verifient que les deux
// langages donnent les memes sorties (build/check-intention.mjs, build/check_intention.py). Les regex restent dans le sous-ensemble
// commun Python / JavaScript. Interrupteur d'urgence cote page : window.__composeurIntention = false.

export const VERSION = 1;
export const TYPES_UNITE = ['character', 'other_living'];
export const TOUTES_REGLES = ['objets', 'socle', 'asymetrie', 'pose', 'vue', 'buste', 'non_humain', 'parties', 'quantite'];
// Regles ACTIVES en production : seules celles dont l'effet est mesure ou sans risque. Les autres sont codees, testees, eteintes
// (voir le module Python pour le detail) : les activer = ajouter leur nom ici ET dans scripts/composeur_intention.py.
export const REGLES_ACTIVES = ['objets'];

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
export function retirerClauseFinale(texte) {
  const t = String(texte == null ? '' : texte);
  const nu = t.replace(/[\s,]+$/, '');   // la coupe du gabarit laisse une virgule en queue
  for (const re of RE_CLAUSES_FIN) {
    const m = re.exec(nu);
    if (!m) continue;
    const reste = nu.slice(0, m.index).replace(/[\s,]+$/, '');
    const clause = m[0].replace(/^[\s,]+/, '').replace(/\s+$/, '');
    const regen = clauseObjetTenu(analyser(reste, 'character', ''), undefined);
    if (regen && regen.toLowerCase() === clause.toLowerCase()) return reste;
  }
  return t;
}
