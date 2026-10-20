// RETRAIT D'UN ELEMENT DANS « MODIFY IMAGE » (2026-10-20) — module PUR, sans DOM, sans reseau, sans horloge.
// FICHIER COMMUN bureau / web (src/renderer/lib = cloud/public/app/lib, build/check-noyaux-partages.mjs).
//
// POURQUOI. Retour du proprietaire (19/10) : « remove the wings » sur un cochon aile, curseur sur « Subtle » : les ailes restent, le cochon est
// redessine autour. « Modify image » est une img2img SDXL : a force <= 0,6 le prompt devient « same subject, same shape, same proportions, same
// composition ... only change: remove the wings », avec le negatif « different subject, changed shape ... ». Le mot « wings » est lu comme
// quelque chose a DESSINER, et la consigne « meme forme, meme composition » interdit de le retirer. Un modele img2img ne sait pas retirer.
// L'outil qui sait le faire est Auto Inpaint (detection par texte + remplissage) : ce module reconnait une consigne de RETRAIT ou de
// REMPLACEMENT EXPLICITE et en extrait la cible (et le remplacement) pour qu'elle soit confiee a ce moteur.
//
// ENTREE : le texte DEJA TRADUIT en anglais (translateUserPrompt d'abord, analyse ensuite). SORTIE :
//   { mode, raison, cible, remplacement, restant }
//   mode 'retrait'      : retirer `cible` (« remove the wings », « without the wings », « get rid of the tail and the horns »)
//   mode 'remplacement' : remplacer `cible` par `remplacement` (« replace the wings with a hat »)
//   mode 'mixte'        : un retrait ET autre chose (« remove the wings and make it blue ») : NON route, `restant` = l'autre partie
//   mode 'aucun'        : pas un retrait (negation, « keep the wings », cible vide, enorme, ambigue, syntaxe etrangere...) : NON route,
//                         la consigne part EXACTEMENT comme avant dans Modify. `raison` dit pourquoi (code court, voir RAISONS).
// Une consigne qui n'est pas un retrait garde donc le comportement d'origine, a l'octet : ce module ne decide jamais que de router, il ne
// reecrit jamais le texte de l'utilisateur pour Modify.
//
// CHAINE DE SECURITE. `cible` et `remplacement` sont des sous-chaines du texte traduit, passees par un jeu de caracteres strict (lettres,
// chiffres, espace, apostrophe, tiret) : aucune syntaxe de prompt (parentheses ponderees, crochets, jetons speciaux) ne passe. Ce sont ces
// chaines EXACTES que le bureau (main.js) et le worker verifient puis envoient au moteur.
//
// Les regex restent simples (pas de retour arriere explosif) ; toutes les listes sont des constantes en tete de fichier.

export const VERSION = 1;

export const MAX_CAR_TEXTE = 200;            // une consigne de Modify est courte ; au-dela ce n'est pas une consigne de retrait
export const MAX_MOTS_CIBLE = 5;             // « the little pink wings on its back » -> 3 mots utiles ; une phrase entiere n'est pas une cible
export const MAX_CAR_CIBLE = 50;
export const MAX_CIBLES = 3;                 // « wings, tail and horns » ; au-dela, on ne route pas
export const MAX_MOTS_TOTAL = 8;             // cibles jointes par « and »
export const MAX_CAR_TOTAL = 70;
export const MAX_MOTS_REMPLACEMENT = 8;
export const MAX_CAR_REMPLACEMENT = 80;

/** Codes de `raison` d'un mode 'aucun' ou 'mixte' (pour les tests, les journaux et l'infobulle). */
export const RAISONS = ['vide', 'trop_long', 'syntaxe', 'injection', 'negation', 'garder', 'pas_un_retrait', 'cible_vide', 'cible_trop_longue',
  'trop_de_cibles', 'cible_invalide', 'cible_non_objet', 'sans_ambigu', 'remplacement_vague', 'remplacement_invalide', 'remplacement_trop_long', 'mixte'];

// ── listes ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Verbes de retrait, formes de base ET gerondifs. Les plus longs d'abord (get rid of avant get).
const SUPPRESSION = ['get rid of', 'getting rid of', 'take off', 'taking off', 'take out', 'taking out', 'take away', 'taking away', 'cut off',
  'cutting off', 'cut out', 'cutting out', 'wipe out', 'wiping out', 'wipe off', 'wiping off', 'wipe away', 'wiping away', 'strip off',
  'stripping off', 'strip away', 'stripping away', 'rub out', 'rubbing out', 'rub off', 'rubbing off', 'scrub out', 'scrub off', 'leave out',
  'leaving out', 'leave off', 'leaving off', 'remove', 'removing', 'delete', 'deleting', 'erase', 'erasing', 'eliminate', 'eliminating',
  'discard', 'discarding', 'ditch', 'ditching', 'omit', 'omitting', 'exclude', 'excluding',
  // sorties usuelles d'un traducteur automatique pour « retire / supprime / enleve »
  'suppress', 'suppressing', 'withdraw', 'withdrawing', 'pull out', 'pulling out', 'pull off', 'pulling off', 'dispose of', 'disposing of'];
const RE_SUPPR = new RegExp('^(?:' + SUPPRESSION.slice().sort((a, b) => b.length - a.length).join('|') + ')\\b\\s*(.*)$');
// « take the hat off », « cut the tail off its back », « get the wings out of the picture »
const RE_POSTPOSE = /^(?:take|cut|strip|wipe|get|peel|rip|tear|pull|chop|scrape|scrub|rub|knock|kick)\s+(.+?)\s+(?:off|away|out)\b(.*)$/;
const RE_DISPARAITRE = /^(?:make|let)\s+(.+?)\s+(?:disappear|vanish|go away|be gone|gone)$/;
const RE_NE_VEUT_PLUS = /^i\s+(?:do not|don't|dont|no longer|never)\s+want\s+(.+)$/;
const RE_VEUT_AUCUN = /^i\s+(?:want|would like|need)\s+(?:no|zero)\s+(.+)$/;
const RE_VEUT_RETIRE = /^i\s+(?:want|would like|need)\s+(?:the\s+|its\s+|his\s+|her\s+|their\s+)?(.+?)\s+(?:gone|removed|deleted|erased|eliminated)$/;
const RE_PLUS_DE = /^no more\s+(.+)$/;
// forme passive, clause entiere : « the wings must be removed », « wings removed », « the tail has to go »
const RE_PASSIF = /^(.+?)\s+(?:(?:should|must|can|could|will|would|needs? to|has to|have to|is to|are to)\s+be\s+|(?:is|are|was|were|gets?|got)\s+)?(?:removed|deleted|erased|eliminated|gone|taken off|taken out|taken away|cut off|cut out)$/;
const RE_DOIT_PARTIR = /^(.+?)\s+(?:has to|have to|needs? to|must|should|can)\s+go$/;
// negation d'un retrait : « do not remove the wings », « never delete », « without removing »
const RE_NEG_SUPPR = /^(?:(?:do not|don't|dont|never|not|no longer|stop|avoid|without|should not|shouldn't|must not|mustn't|cannot|can't|cant|won't|will not|refrain from|no need to|there is no need to)\s+)+(?:to\s+)?(?:remov(?:e|ing)|delet(?:e|ing)|eras(?:e|ing)|eliminat(?:e|ing)|get(?:ting)? rid of|tak(?:e|ing) (?:off|out|away)|cut(?:ting)? (?:off|out)|wip(?:e|ing) (?:out|off|away)|strip(?:ping)? (?:off|away)|discard(?:ing)?|ditch(?:ing)?|omit(?:ting)?|exclud(?:e|ing))\b/;
const RE_NEG_AUTRE = /^(?:do not|don't|dont|never|should not|shouldn't|must not|mustn't|cannot|can't|cant|won't|will not|avoid|stop)\s+(?:to\s+)?([a-z]+)/;
const NEG_QUI_GARDE = new Set(['change', 'changing', 'touch', 'touching', 'alter', 'altering', 'modify', 'modifying', 'move', 'moving', 'edit', 'editing',
  'redraw', 'redrawing', 'repaint', 'repainting', 'resize', 'resizing', 'affect', 'affecting', 'harm', 'damage', 'ruin', 'distort', 'distorting']);
// clause de conservation : neutre, c'est ce que fait deja le moteur de retrait
const RE_GARDER = /^(?:keep|leave|preserve|maintain|retain|protect|spare|save|everything else|the rest|rest|except|apart from|aside from|other than|not|unchanged|untouched|as is|as it is|the same|same)\b/;
// remplacement explicite
const RE_REMPL_PRON = /^(?:replac(?:e|ing)|swap(?:ping)?|substitut(?:e|ing)|exchang(?:e|ing))\s+(?:it|them|that|those|this|these)\s+(?:with|by|for)\s+(.+)$/;
const RE_REMPL = /^(?:replac(?:e|ing)|swap(?:ping)?|substitut(?:e|ing)|exchang(?:e|ing))\s+(.+?)\s+(?:with|by|for)\s+(.+)$/;
// « without the wings », « same but without the wings », « make it without wings », « no wings » : retrait SEULEMENT si c'est toute la consigne
const RE_SANS = /^(?:(?:(?:make|do|redo|give me|draw|generate)\s+(?:it|this|that|the same|one)|(?:the\s+)?same(?:\s+[a-z]+)?|keep everything|everything the same|exactly the same|as before|again|like before|but)[ ,:-]*)*(?:but\s+)?(?:without|with no|with zero|minus|sans)\s+(.+)$/;
const RE_SANS_NO = /^no\s+(.+)$/;
const SANS_NO_FAUX = new Set(['thanks', 'thank', 'problem', 'need', 'way', 'idea', 'worries', 'matter', 'more', 'longer', 'one']);

// politesse et amorces, au debut de chaque clause ; « no, » (correction) mais pas « no wings » (retrait)
const AMORCES = ['ok(?:ay)?', 'so', 'hey', 'hi', 'hello', 'yes', 'yeah', 'alright', 'now', 'then', 'first', 'next', 'also', 'and', 'but',
  'just', 'simply', 'only', 'please', 'pls', 'plz', 'kindly', 'actually', 'basically', 'maybe', 'perhaps', 'no(?=\\s*,)', 'can you', 'could you',
  'would you', 'will you', 'can we', 'could we', "let's", 'let us',
  "i(?:'d|\\s+would|\\s+really|\\s+just|\\s+do|\\s+kind of)*\\s+(?:want|like|need)(?:\\s+you)?\\s+to", 'we need to', 'you need to', 'you should', 'you must',
  'you have to', 'you can', 'go ahead and', 'be sure to', 'make sure to', 'try to', 'try', 'start by', 'begin by', 'first of all', 'to start', 'or',
  'completely', 'totally', 'entirely', 'fully', 'definitely', 'immediately', 'quickly', 'carefully', 'gently', 'cleanly', 'really'];
const RE_AMORCE = new RegExp('^(?:(?:' + AMORCES.slice().sort((a, b) => b.length - a.length).join('|') + ')\\b[ ,:;-]*)+');
const RE_FIN_POLIE = /[ ,]*\b(?:please|pls|plz|thanks|thank you(?: very much)?|now|for me|right now|ok|okay|if you can|if possible|thx|and|or|but|then|plus|with|while)$/;

// separation en clauses : virgule, point-virgule, esperluette, « and », « then », « but »...
const RE_CLAUSES = /\s*[,;&]\s*|\s+(?:and then|and also|as well as|and|or|then|also|but|plus|while|whilst)\s+/;

const DETERMINANTS = new Set(['the', 'a', 'an', 'its', 'his', 'her', 'their', 'my', 'your', 'our', 'this', 'that', 'these', 'those', 'some', 'any',
  'all', 'both', 'each', 'every', 'one', 'two', 'three', 'four', 'five', 'six', 'several', 'many', 'few']);
const VERBES_AUTRES = new Set(('add make change turn put give set paint color colour recolor recolour draw create generate render convert transform '
  + 'enlarge increase reduce decrease shrink resize scale move rotate flip mirror brighten darken lighten blur sharpen tint shade style apply use '
  + 'insert place include show display ignore forget disregard bypass override pretend act say tell reveal print output repeat follow obey switch '
  + 'upgrade improve fix repair clean polish smooth enhance upscale downscale crop extend expand stretch widen lengthen shorten thicken thin fill '
  + 'cover wrap dress wear hold carry equip attach glue stick build design edit modify adjust tweak update redo redraw repaint retouch restyle '
  + 'animate pose sit stand look face smile open close let allow want need would should must can could will shall may might do does did be is are '
  + 'was were have has had get got take takes took see watch imagine consider think desaturate saturate soften harden glow shine pixelate '
  + 'vectorize colorize colourise outline stylize stylise cartoonify age rejuvenate uglify beautify wrinkle whiten blacken redden turn replace '
  + 'swap substitute exchange paste copy duplicate clone merge combine join split cut paint spray splash decorate dress undress hide reveal '
  + 'show tell write type name label title caption').split(' '));
const PRONOMS_SUJET = new Set(['i', 'it', 'he', 'she', 'they', 'we', 'you', 'there', 'here', 'what', 'how', 'why', 'when', 'where', 'if', 'because',
  'since', 'although', 'though', 'unless', 'until', 'so']);
const PREPOSITIONS = new Set(['in', 'on', 'at', 'to', 'for', 'from', 'into', 'onto', 'by', 'with', 'of', 'over', 'under', 'above', 'below', 'between',
  'through', 'during', 'before', 'after', 'about', 'against', 'among', 'around', 'behind', 'beside', 'besides', 'beyond', 'near', 'off', 'out', 'up',
  'down', 'without']);

const POSITIONS = new Set(['left', 'right', 'upper', 'lower', 'top', 'bottom', 'front', 'back', 'rear', 'inner', 'outer', 'first', 'second', 'third', 'last', 'extra', 'spare']);
const RE_EXCEPTION = /\b(?:except|apart from|aside from|other than|besides|either|neither)\b/;
const RE_VERBE_FINI =/\b(?:is|are|was|were|should|must|will|would|can|could|has|have|had|looks?|seems?|needs?|wants?|keeps?|makes?)\b/;

// ce qui n'est pas une cible
const PRONOMS_CIBLE = new Set(['it', 'them', 'this', 'that', 'these', 'those', 'everything', 'anything', 'something', 'all', 'one', 'ones', 'stuff',
  'things', 'thing', 'itself', 'him', 'her', 'rest', 'else', 'more', 'lot', 'image', 'images', 'picture', 'pictures', 'photo', 'photos', 'drawing',
  'illustration', 'scene', 'there', 'here', 'whole', 'entire', 'part', 'parts', 'area', 'region', 'zone', 'spot']);
const MOTS_VIDES = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'its', 'his', 'her', 'their', 'my', 'your', 'our', 'to', 'from', 'in', 'on', 'at',
  'with', 'too', 'also', 'just', 'only', 'any', 'some', 'all', 'both', 'each', 'every', 'very', 'really', 'quite', 'more', 'less']);
const COULEURS = new Set(['red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'brown', 'black', 'white', 'gray', 'grey', 'gold', 'golden',
  'silver', 'cyan', 'magenta', 'beige', 'violet', 'dark', 'light', 'bright', 'pale', 'big', 'small', 'large', 'little', 'tiny', 'huge', 'long', 'short']);
// ce qui est un reglage de l'image et non un objet : un retrait par detection n'a aucun sens
const NON_OBJET = new Set(['noise', 'grain', 'blur', 'blurriness', 'blurry', 'artifact', 'artifacts', 'artefact', 'artefacts', 'jpeg', 'compression',
  'pixelation', 'saturation', 'contrast', 'brightness', 'lighting', 'sharpness', 'resolution', 'quality', 'texture', 'textures', 'detail', 'details',
  'color', 'colors', 'colour', 'colours', 'tint', 'filter', 'filters', 'effect', 'effects', 'style', 'shading', 'gradient', 'vignette', 'transparency',
  'opacity', 'exposure', 'tone', 'tones', 'hue', 'sepia', 'grunge', 'dirt', 'dust', 'scratches', 'wrinkles', 'look', 'vibe', 'feel', 'feeling', 'mood',
  'atmosphere', 'appearance', 'aesthetic']);
// remplacement qui veut dire « rien » : c'est un retrait
const RE_REMPL_RIEN = /^(?:the |a |an )?(?:nothing(?: at all)?|empty(?: space)?|blank(?: space)?|void|emptiness|background|plain background|white background|plain white background|plain wall|wall)$/;
const REMPL_VAGUE = /\b(?:one|ones|it|them|something|anything|else|same|other|another|different|new|better|similar|like it|instead)\b/;

const APOSTROPHE_ISOLEE = /(?:^|[^\p{L}\p{N}])'|'(?:$|[^\p{L}\p{N}])/u;   // une apostrophe n'est admise qu'au milieu d'un mot (pig's)
const CAR_OK = /^[\p{L}\p{N}][\p{L}\p{N}' -]*$/u;                 // cible et remplacement : lettres, chiffres, espace, apostrophe, tiret
const caracteresOk = (s) => CAR_OK.test(s) && !APOSTROPHE_ISOLEE.test(s);
const CAR_TEXTE_OK = /^[\p{L}\p{N} .,;:!?'"&-]+$/u;               // tout le texte : rien d'autre ne passe (pas de parentheses, crochets, barres...)
const INJECTION = /\b(?:ignore|disregard|forget|override|bypass|circumvent|jailbreak)\b[^.]{0,60}\b(?:rules?|instructions?|prompts?|filters?|safety|polic(?:y|ies)|restrictions?|guidelines?|limits?|moderation|system)\b|\b(?:system prompt|developer mode|you are now|pretend (?:to be|you are)|act as|as an? (?:ai|assistant|admin)|unrestricted|uncensored|no filter|without (?:any )?(?:filter|restrictions?|censorship))\b/;

// ── outils ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// caracteres construits par code (jamais d'echappement unicode ecrit dans la source : certains outils les convertissent en caracteres bruts)
const U = (...codes) => codes.map((c) => String.fromCharCode(c)).join('');
const RE_INVISIBLES = new RegExp('[' + U(0x200b) + '-' + U(0x200f) + U(0x2028, 0x2029) + U(0x202a) + '-' + U(0x202e) + U(0x2060, 0xfeff) + ']', 'g');
const RE_APOSTROPHES = new RegExp('[' + U(0x2018, 0x2019, 0x02bc) + ']', 'g');
const RE_GUILLEMETS = new RegExp('[' + U(0x201c, 0x201d, 0x00ab, 0x00bb) + ']', 'g');
const RE_TIRETS = new RegExp('[' + U(0x2013, 0x2014) + ']', 'g');
function nettoyer(texte) {
  let s = String(texte == null ? '' : texte);
  try { s = s.normalize('NFKC'); } catch (_) { /* moteur sans normalize : texte tel quel */ }
  s = s.replace(RE_INVISIBLES, '').replace(RE_APOSTROPHES, "'").replace(RE_GUILLEMETS, '"').replace(RE_TIRETS, '-');
  s = s.replace(/\s+/g, ' ').trim().toLowerCase();
  s = s.replace(/^["']+/, '').replace(/["']+$/, '');
  return s.trim();
}
const mots = (s) => s.split(' ').filter(Boolean);
function resultat(mode, raison, cible, remplacement, restant) {
  return { mode, raison, cible: cible || '', remplacement: remplacement || '', restant: restant || '' };
}
const aucun = (raison) => resultat('aucun', raison);

/** Retire amorces (« please », « can you », « ok, ») au debut et politesses a la fin, jusqu'a stabilite. */
function sansPolitesse(clause) {
  let s = clause.trim();
  for (let i = 0; i < 6; i++) {
    const avant = s;
    s = s.replace(RE_AMORCE, '').trim();
    s = s.replace(RE_FIN_POLIE, '').trim();
    s = s.replace(/^[,;:.\- ]+|[,;:.\- ]+$/g, '').trim();
    if (s === avant) break;
  }
  return s;
}

/** Extrait la cible d'un morceau « the pink wings from its back » -> { cible: 'pink wings' } ou { erreur: code }. */
function extraireCible(brut) {
  let s = String(brut || '').trim().replace(/^[:\- ]+/, '');
  s = s.replace(/^(?:all of|all the|all|both|each|every|any|some|only|just|also|entirely|completely|totally|fully|whole|entire)\s+/, '');
  for (let i = 0; i < 3; i++) s = s.replace(/^(?:the|a|an|its|his|her|their|my|your|our|this|that|these|those)\s+/, '');
  s = s.replace(/^[a-z][a-z-]*'s\s+/, '');                       // « the pig's wings » -> « wings »
  // complements de lieu et de nature : « from its back », « on the shirt », « of the pig », « in the background »
  s = s.replace(/\s+(?:from|off|out of|out|on|in|at|of|behind|near|next to|above|below|under|over|around|beside|inside|outside|across|within|with|that|which|who|because|so|for|to|into|onto)\b.*$/, '');
  s = s.replace(/[.,;:!?]+$/g, '').trim();
  for (let i = 0; i < 2; i++) s = s.replace(/\s+(?:too|also|as well|entirely|completely|totally|fully|altogether|really|very|please|now|here|there)$/, '');
  const m = mots(s);
  if (!m.length) return { erreur: 'cible_vide' };
  if (m.every((w) => PRONOMS_CIBLE.has(w) || MOTS_VIDES.has(w) || COULEURS.has(w))) return { erreur: 'cible_vide' };
  if (m.some((w) => NON_OBJET.has(w))) return { erreur: 'cible_non_objet' };
  if (m.length > MAX_MOTS_CIBLE || s.length > MAX_CAR_CIBLE) return { erreur: 'cible_trop_longue' };
  if (!caracteresOk(s)) return { erreur: 'cible_invalide' };
  return { cible: m.join(' ') };
}

/** Nettoie un remplacement « a red hat » ; { remplacement: '' } = « rien » (donc retrait) ; { erreur } sinon. */
function extraireRemplacement(brut) {
  let s = String(brut || '').trim().replace(/[.,;:!?]+$/g, '').replace(/\s+instead$/, '').trim();
  if (!s) return { erreur: 'remplacement_invalide' };
  if (RE_REMPL_RIEN.test(s)) return { remplacement: '' };
  const m = mots(s);
  if (m.length > MAX_MOTS_REMPLACEMENT || s.length > MAX_CAR_REMPLACEMENT) return { erreur: 'remplacement_trop_long' };
  if (VERBES_AUTRES.has(m[0]) || PRONOMS_SUJET.has(m[0]) || PREPOSITIONS.has(m[0])) return { erreur: 'remplacement_invalide' };
  if (!caracteresOk(s)) return { erreur: 'remplacement_invalide' };
  if (REMPL_VAGUE.test(s)) return { erreur: 'remplacement_vague' };
  return { remplacement: m.join(' ') };
}

/** Classe UNE clause (deja sans amorce) : suppression, remplacement, remplace_pronom, sans, garder, negation, objet ou autre. */
function classer(c) {
  let m;
  if (RE_NEG_SUPPR.test(c)) return { type: 'negation' };
  // « remove everything except the pig », « remove the wings except the left one » : une exception ne se traduit pas en cible, on ne route pas
  if (RE_EXCEPTION.test(c) && !RE_GARDER.test(c)) return { type: 'autre' };
  if ((m = RE_SUPPR.exec(c))) return { type: 'suppression', objet: m[1] };
  if ((m = RE_REMPL_PRON.exec(c))) return { type: 'remplace_pronom', par: m[1] };
  if ((m = RE_REMPL.exec(c))) return { type: 'remplacement', cible: m[1], par: m[2] };
  if ((m = RE_POSTPOSE.exec(c))) return { type: 'suppression', objet: m[1] };
  if ((m = RE_DISPARAITRE.exec(c))) return { type: 'suppression', objet: m[1] };
  if ((m = RE_NE_VEUT_PLUS.exec(c))) return /^to\b/.test(m[1]) ? { type: 'autre' } : { type: 'suppression', objet: m[1] };
  if ((m = RE_VEUT_AUCUN.exec(c))) return { type: 'suppression', objet: m[1] };
  if ((m = RE_VEUT_RETIRE.exec(c))) return { type: 'suppression', objet: m[1] };
  if ((m = RE_PLUS_DE.exec(c))) return { type: 'suppression', objet: m[1] };
  if ((m = RE_SANS.exec(c))) return { type: 'sans', objet: m[1] };
  if ((m = RE_SANS_NO.exec(c)) && !SANS_NO_FAUX.has(mots(m[1])[0])) return { type: 'sans', objet: m[1] };
  if ((m = RE_NEG_AUTRE.exec(c))) return NEG_QUI_GARDE.has(m[1]) ? { type: 'garder' } : { type: 'autre' };
  if (RE_GARDER.test(c)) return { type: 'garder' };
  const pass = RE_PASSIF.exec(c) || RE_DOIT_PARTIR.exec(c);
  if (pass && mots(pass[1]).length <= 4 && !/\b(?:with|in|on|of|from|at|by|to)\b/.test(pass[1])) return { type: 'suppression', objet: pass[1] };
  if (RE_VERBE_FINI.test(c)) return { type: 'autre' };      // « the tail is long » : une phrase, pas un objet
  const w = mots(c)[0] || '';
  if (DETERMINANTS.has(w)) return { type: 'objet', objet: c };
  if (VERBES_AUTRES.has(w) || PRONOMS_SUJET.has(w) || PREPOSITIONS.has(w)) return { type: 'autre' };
  // un groupe nominal SANS determinant : un seul mot (« tail »), ou adjectif connu + nom (« long tail »). Deux mots quelconques (« tidy up »,
  // « break nsfw ») pourraient etre un verbe inconnu suivi de son objet : ce n'est pas une cible, c'est une autre demande.
  const n = mots(c).length;
  if (n === 1 || (n <= 3 && (COULEURS.has(w) || POSITIONS.has(w)))) return { type: 'objet', objet: c };
  return { type: 'autre' };
}

// ── analyse ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Analyse une consigne de Modify DEJA traduite en anglais.
 * @param {string} texteAnglais
 * @returns {{mode:'retrait'|'remplacement'|'mixte'|'aucun', raison:string, cible:string, remplacement:string, restant:string}}
 */
export function analyserRetrait(texteAnglais) {
  const brut = nettoyer(texteAnglais);
  if (!brut) return aucun('vide');
  if (brut.length > MAX_CAR_TEXTE) return aucun('trop_long');
  if (!CAR_TEXTE_OK.test(brut)) return aucun('syntaxe');
  if (INJECTION.test(brut)) return aucun('injection');

  const phrases = brut.split(/[.!?]+/).map((p) => p.trim()).filter(Boolean);
  if (!phrases.length) return aucun('vide');

  const e = {
    cibles: [],              // morceaux de cible (deja nettoyes)
    remplacement: null,      // texte du remplacement, ou null ; '' = « rien » (donc un retrait)
    dernier: null,           // 'cibles' | 'remplacement' | 'garder' : ce qu'un « and the tail » vient completer
    erreur: null,            // premiere erreur de cible / remplacement
    aSuppression: false, aNegation: false, aGarder: false, formeSans: false,
    restants: [],            // clauses qui demandent autre chose
  };

  const poserCible = (objet) => {
    const r = extraireCible(objet);
    if (r.erreur) { if (!e.erreur) e.erreur = r.erreur; return; }
    e.cibles.push(r.cible);
  };
  const poserRemplacement = (par) => {
    const r = extraireRemplacement(par);
    if (r.erreur) { if (!e.erreur) e.erreur = r.erreur; return; }
    e.remplacement = r.remplacement;
  };
  /** « the wings and the tail » : le premier morceau est la cible ; les suivants : objets = cibles, conservation = ignores, le reste = restant. */
  const poserListeCibles = (texte) => {
    texte.split(RE_CLAUSES).map((x) => sansPolitesse(x)).filter(Boolean).forEach((x, i) => {
      if (i === 0) { poserCible(x); return; }
      const t = classer(x);
      if (t.type === 'objet') poserCible(x);
      else if (t.type === 'garder') e.aGarder = true;
      else e.restants.push(x);
    });
  };

  for (const phrase of phrases) {
    const sp = sansPolitesse(phrase);
    if (!sp) continue;
    if (RE_NEG_SUPPR.test(sp)) { e.aNegation = true; continue; }

    // 1. remplacement explicite, au niveau de la PHRASE : « replace the wings and the tail with a red hat and glasses »
    const mr = RE_REMPL.exec(sp);
    if (mr && !RE_REMPL_PRON.test(sp)) {
      e.aSuppression = true;
      poserListeCibles(mr[1]);
      const suite = mr[2].split(RE_CLAUSES).map((x) => sansPolitesse(x)).filter(Boolean);
      let par = suite[0] || '';
      for (const reste of suite.slice(1)) {
        const t = classer(reste);
        if (t.type === 'objet') par += ' and ' + reste;
        else if (t.type === 'garder') e.aGarder = true;
        else e.restants.push(reste);
      }
      poserRemplacement(par);
      e.dernier = 'remplacement';
      continue;
    }

    // 2. « without the wings » / « same but without the wings » / « no wings » : un retrait SEULEMENT si c'est TOUTE la consigne
    if (phrases.length === 1) {
      let ms = RE_SANS.exec(sp);
      if (!ms) { ms = RE_SANS_NO.exec(sp); if (ms && SANS_NO_FAUX.has(mots(ms[1])[0])) ms = null; }
      if (ms) {
        e.aSuppression = true; e.formeSans = true; e.dernier = 'cibles';
        poserListeCibles(ms[1]);
        continue;
      }
    }

    // 3. clause par clause
    for (const brutClause of phrase.split(RE_CLAUSES)) {
      const c = sansPolitesse(brutClause);
      if (!c) continue;
      const t = classer(c);
      switch (t.type) {
        case 'negation': e.aNegation = true; break;
        case 'suppression': e.aSuppression = true; poserCible(t.objet); e.dernier = 'cibles'; break;
        case 'remplace_pronom':
          if (e.cibles.length && e.remplacement === null) { poserRemplacement(t.par); e.dernier = 'remplacement'; } else e.restants.push(c);
          break;
        case 'remplacement': e.aSuppression = true; poserCible(t.cible); poserRemplacement(t.par); e.dernier = 'remplacement'; break;
        case 'garder': e.aGarder = true; e.dernier = 'garder'; break;
        case 'objet':
          if (e.dernier === 'cibles') poserCible(t.objet);
          else if (e.dernier === 'remplacement' && e.remplacement !== null) e.remplacement += ' and ' + t.objet;
          else if (e.dernier === 'garder') { /* « keep the body and the tail » : encore une chose a garder */ }
          else e.restants.push(c);
          break;
        default: e.restants.push(c);     // 'sans' hors consigne seule, 'autre'
      }
    }
  }

  if (e.aNegation) return aucun('negation');
  if (!e.aSuppression) {
    if (/\b(?:without|with no|minus|sans)\b/.test(brut)) return aucun('sans_ambigu');
    return aucun(e.aGarder && !e.restants.length ? 'garder' : 'pas_un_retrait');
  }
  // une erreur de cible prime : pas de routage, pas de mixte (« remove it and make it blue » n'a rien a retirer)
  if (e.erreur || !e.cibles.length) return aucun(e.erreur || 'cible_vide');
  const uniques = e.cibles.filter((x, i) => e.cibles.indexOf(x) === i);
  const cible = uniques.join(' and ');
  if (e.restants.length) return resultat('mixte', 'mixte', cible, '', e.restants.join(' ; '));
  if (uniques.length > MAX_CIBLES) return aucun('trop_de_cibles');
  if (mots(cible).length > MAX_MOTS_TOTAL || cible.length > MAX_CAR_TOTAL) return aucun('cible_trop_longue');
  if (e.remplacement) {
    const rr = extraireRemplacement(e.remplacement);       // revalide la chaine complete (apres les « and glasses »)
    if (rr.erreur) return aucun(rr.erreur);
    return resultat('remplacement', 'remplacement', cible, rr.remplacement);
  }
  return resultat('retrait', e.formeSans ? 'sans' : 'retrait', cible, '');
}

/** Vrai si le mode demande de confier la consigne au moteur de retrait. */
export function estRoute(analyse) {
  return !!analyse && (analyse.mode === 'retrait' || analyse.mode === 'remplacement');
}
