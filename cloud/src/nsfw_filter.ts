/**
 * Filtre de prompt (NSFW / contenus illicites) — cote Worker.
 * Portage de `src/main/main.js:checkPromptSafety`, MAIS refondu le 2026-10-03
 * (constats IA-02, IA-03, IA-04 de l'analyse du 03/10/2026) :
 *
 *  1. PLANCHER illicite (`checkHardFloor`, jamais contournable, evalue AVANT
 *     le drapeau `unrestricted`) : le texte est NORMALISE avant le test
 *     (NFKC, accents, caracteres invisibles, alphabets cyrillique / grec
 *     ressemblants, leet 0->o 1->i/l 3->e 4->a 5->s 7->t @->a $->s, lettres
 *     espacees ou ponctuees "n.u.d.e", lettres repetees) et couvre l'age
 *     ecrit en chiffres ou en lettres ("12 ans", "twelve year old", "12yo")
 *     et le vocabulaire de six langues (fr, en, es, de, pt, it).
 *  2. Filtre GENERAL (`checkPromptSafety`) : correspondance par MOTS ENTIERS
 *     (ou debut de mot pour les racines marquees `*`) au lieu de la simple
 *     sous-chaine, et les mots ambigus du jeu video (blood, hanging, crack,
 *     flesh, slash, strip, breast...) ne bloquent plus qu'en CONTEXTE
 *     (terme sexuel explicite, terme du plancher, ou enfant pour la violence).
 *     Mesure : voir cloud/tests/moderation.test.mjs.
 *
 * 2026-10-13 — AUDIT LANGUE / MODERATION DU 11/10 (constats MODERATION-01, 03, 05, 07, 09, M1, M2, M3 ; SERVEUR-09) :
 *  - NORMALISATION : NFKC, puis EFFACEMENT de tout caractere de categorie C (controle, format, usage prive, non assigne,
 *    demi-substitut), de U+FFFD et des « ignorables » (remplisseurs hangul, braille vide...), de TOUTES les marques
 *    combinantes ; chiffres Unicode (arabes-indiens, devanagari, persans...) ramenes en ASCII ; homoglyphes completes
 *    (petites capitales, lettres barrees, armenien, lettres-emoji). Le tokenizer CLIP efface ces caracteres :
 *    « na<U+0001>ked » est lu « naked » par le modele, il doit l'etre aussi par le filtre.
 *  - PLANCHER : actes sexuels et anatomie explicites en anglais clair, mots COLLES « mineur+nudite » dans un meme mot
 *    (« childnaked » : CLIP le lit comme deux mots), synonymes de mineur et formulations d'age (« 8 years of age »,
 *    « born in 2018 », « 3rd grader »), composes allemands (« halbnackt »), tournures courantes des six langues, et un
 *    lexique pour zh, hi, ar, ru, ja, ko, tr (+ nl, pl, id, vi, uk partiels) lu sur une VUE UNICODE (sans translitteration).
 *  - FAUX POSITIFS : « heroine », age lu dans « aged elf » / « ten thousand years » / « dix ans de guerre », « stable »,
 *    « baby dragon », mots courts d'autres langues (vietnamien « nữ » / « nuôi », « Nudeln », « Nacktschnecke », « Pornic »,
 *    « spogliatoio »), expressions de jeu (« hit points », « scream mask », « toy gun »).
 *  - LONGUEUR et SYNTAXE : `controlerLongueurPrompt` (borne ponderee : hors alphabet latin un caractere compte 3) et
 *    `neutraliserSyntaxePrompt` (jetons speciaux CLIP, poids A1111 hors [0,5 ; 2], caracteres effaces). Le worker les
 *    applique avant d'envoyer un texte a Modal ; Modal refait les memes controles (modal_app/_moderation_texte.py).
 *  CE QUI RESTE (voir AGENT_LOG.md, 2026-10-13) : langues hors de la liste ci-dessus, argot et euphemismes, mots coupes par
 *  un espace (« na ked » : le modele ne lit pas non plus le mot), fautes volontaires, texte inverse, emoji (7 seulement),
 *  caracteres attribues apres Unicode 14 (le moteur JavaScript et le Python de Modal n'ont pas la meme table).
 *
 * Le contrat de retour ne change pas : { safe, blocked?, reason? }. Deux
 * champs OPTIONNELS s'y ajoutent (IA-04) pour que l'appelant puisse compter
 * les blocages par compte : `categorie` et `hardFloor`.
 *
 * Le classifieur de texte IA (Falconsai) n'est PAS porte ; le filtrage de
 * l'image produite tourne cote Modal (`modal_app/_nsfw.py`).
 *
 * Bascule : variable `NSFW_FILTER_OFF` = "1" (developpement uniquement).
 *
 * MIROIR BUREAU : la logique est dupliquee dans src/main/main.js (bloc GENERE). Apres toute
 * modification ici : node build/miroir-moderation.mjs --sync ; la meme commande, sans argument,
 * est une garde de construction qui refuse la divergence.
 * MIROIR MODAL : les LISTES (tout `const X: string[] = [...]`) sont extraites par build/moderation_modal/gen_module.py vers
 * modal_app/_moderation_texte.py ; les fonctions y sont portees a la main dans le gabarit (meme ordre, memes regles) et
 * build/bancs/noyaux/test_moderation_modal.py compare les deux implementations sur des milliers de textes.
 */

// ── Categories de blocage (IA-04) ─────────────────────────────────────────
export type CategorieBlocage =
  | 'plancher'            // contenu illicite (mineurs) : jamais contournable
  | 'sexuel'              // nudite / sexe explicite
  | 'violence'            // gore explicite
  | 'drogue'
  | 'extremisme'          // terrorisme, haine organisee
  | 'haine'               // injures racistes
  | 'autoblessure'
  | 'armes'
  | 'mineur_violence'     // enfant + violence (filtre general)
  | 'combinaison'         // personne + nudite (filtre general)
  | 'contexte'            // terme ambigu declenche par son contexte
  | 'longueur';           // texte trop long pour etre envoye au generateur (MODERATION-07)

export interface PromptSafetyResult {
  safe: boolean;
  blocked?: string;
  reason?: string;
  /** IA-04 : famille du blocage, pour compter les blocages par compte. */
  categorie?: CategorieBlocage;
  /** Vrai pour le plancher illicite (parite avec le bureau). */
  hardFloor?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// NORMALISATION (constats IA-02, MODERATION-03, MODERATION-09)
// ═══════════════════════════════════════════════════════════════════════════

/** Toutes les marques combinantes (les vues latines ne gardent que des lettres de base). */
const _MARQUES = /\p{M}/gu;
/** Caracteres EFFACES (pas remplaces par un espace) : le tokenizer CLIP les supprime lui aussi (categorie C : controle, format,
 *  usage prive, non assigne, demi-substitut ; et U+FFFD), plus les « ignorables » qui ne sont pas de categorie C (remplisseurs
 *  hangul, voyelles inherentes khmeres, braille vide). \t \n \r sont d'abord changes en espaces. */
const _EFFACES = /[\p{C}\ufffd\u115f\u1160\u17b4\u17b5\u2800\u3164\uffa0]/gu;
/** Marques GARDEES par la vue Unicode : elles portent le sens dans ces ecritures (voyelles et viramas indiens, thai, lao,
 *  tibetain, birman, khmer ; voisement des kana). Les autres (accents latins, harakat arabes, points hebreux, marques
 *  cyrilliques) sont retirees, des deux cotes : texte et lexique. */
const _MARQUES_GARDEES = /[\u0900-\u0dff\u0e00-\u0fff\u1000-\u109f\u1780-\u17ff\u3099\u309a]/u;

// Chiffres decimaux Unicode (categorie Nd) : premier point de code (le zero) de chaque serie de dix. Table FIXE (Unicode 14,
// celle du Python de Modal), identique cote Python : les deux implementations convertissent les memes chiffres. ASCII et
// pleine largeur / mathematiques sont deja traites par NFKC.
const ZEROS_CHIFFRES: string[] = [
  '0660', '06F0', '07C0', '0966', '09E6', '0A66', '0AE6', '0B66', '0BE6', '0C66', '0CE6', '0D66', '0DE6', '0E50', '0ED0',
  '0F20', '1040', '1090', '17E0', '1810', '1946', '19D0', '1A80', '1A90', '1B50', '1BB0', '1C40', '1C50', 'A620', 'A8D0',
  'A900', 'A9D0', 'A9F0', 'AA50', 'ABF0', 'FF10', '104A0', '10D30', '11066', '110F0', '11136', '111D0', '112F0', '11450',
  '114D0', '11650', '116C0', '11730', '118E0', '11950', '11C50', '11D50', '11DA0', '16A60', '16AC0', '16B50', '1D7CE',
  '1D7D8', '1D7E2', '1D7EC', '1D7F6', '1E140', '1E2F0', '1E950', '1FBF0',
];
const _ZEROS = ZEROS_CHIFFRES.map((h) => parseInt(h, 16));

/** « age of ١٠ » -> « age of 10 » : tout chiffre decimal de la table devient le chiffre ASCII de meme valeur. */
function _chiffresAscii(s: string): string {
  return s.replace(/[^\x00-\x7f]/gu, (c) => {
    const cp = c.codePointAt(0) as number;
    for (const z of _ZEROS) if (cp >= z && cp <= z + 9) return String(cp - z);
    return c;
  });
}

/** Etape commune a toutes les vues : NFKC, blancs de controle -> espace, effacement, chiffres en ASCII, minuscules. */
function _nettoyer(texte: unknown): string {
  let s = typeof texte === 'string' ? texte : String(texte == null ? '' : texte);
  try { s = s.normalize('NFKC'); } catch { /* chaine exotique : on garde telle quelle */ }
  return _chiffresAscii(s.replace(/[\t\n\r]/g, ' ').replace(_EFFACES, '')).toLowerCase();
}

/** NFD puis retrait de TOUTES les marques combinantes (accents latins, mais aussi U+1DC0, U+20D1, U+FE20, U+064B...). */
function _sansMarques(net: string): string {
  let s = net;
  try { s = s.normalize('NFD'); } catch { /* idem */ }
  return s.replace(_MARQUES, '');
}

/** NFKC + effacement + marques retirees + minuscules (SANS translitteration). */
function _base(texte: unknown): string {
  return _sansMarques(_nettoyer(texte));
}

// Lettres latines sans decomposition Unicode (et, 2026-10-13, lettres barrees et petites capitales : MODERATION-09).
const _LATIN_SPECIAUX: Record<string, string> = {
  '\u00df': 'ss', '\u00f8': 'o', '\u00e6': 'ae', '\u0153': 'oe', '\u0111': 'd',
  '\u0142': 'l', '\u0131': 'i', '\u0251': 'a', '\u0261': 'g',
  // lettres barrees
  '\u0127': 'h', '\u0167': 't', '\u0138': 'k', '\u0180': 'b', '\u0268': 'i', '\u0289': 'u', '\u024d': 'r', '\u024f': 'y',
  '\u01b6': 'z', '\u01e5': 'g', '\u0249': 'j', '\u0237': 'j',
  // petites capitales
  '\u1d00': 'a', '\u0299': 'b', '\u1d04': 'c', '\u1d05': 'd', '\u1d07': 'e', '\ua730': 'f', '\u0262': 'g', '\u029c': 'h',
  '\u026a': 'i', '\u1d0a': 'j', '\u1d0b': 'k', '\u029f': 'l', '\u1d0d': 'm', '\u0274': 'n', '\u1d0f': 'o', '\u1d18': 'p',
  '\u0280': 'r', '\ua731': 's', '\u1d1b': 't', '\u1d1c': 'u', '\u1d20': 'v', '\u1d21': 'w', '\u028f': 'y', '\u1d22': 'z',
};

// Lettres cyrilliques / grecques / armeniennes qui ressemblent a une lettre latine.
const _HOMOGLYPHES: Record<string, string> = {
  // cyrillique
  '\u0430': 'a', '\u0432': 'b', '\u0435': 'e', '\u043a': 'k', '\u043c': 'm',
  '\u043d': 'h', '\u043e': 'o', '\u0440': 'p', '\u0441': 'c', '\u0442': 't',
  '\u0443': 'y', '\u0445': 'x', '\u0455': 's', '\u0456': 'i', '\u0458': 'j',
  '\u0501': 'd', '\u04bb': 'h', '\u051b': 'q', '\u051d': 'w', '\u04cf': 'l',
  '\u043f': 'n', '\u0433': 'r', '\u04af': 'y',
  // grec
  '\u03b1': 'a', '\u03b2': 'b', '\u03b3': 'y', '\u03b5': 'e', '\u03b7': 'n',
  '\u03b9': 'i', '\u03ba': 'k', '\u03bc': 'u', '\u03bd': 'v', '\u03bf': 'o',
  '\u03c1': 'p', '\u03c2': 's', '\u03c4': 't', '\u03c5': 'u', '\u03c7': 'x',
  '\u03c9': 'w',
  // armenien (2026-10-13)
  '\u0585': 'o', '\u057d': 'u', '\u0578': 'n', '\u0570': 'h', '\u0581': 'g', '\u0566': 'q', '\u0561': 'w',
};

/** Lettres-emoji : indicateurs regionaux, lettres carrees et cerclees NEGATIVES (sans decomposition NFKC). */
function _lettreSymbole(cp: number): string | undefined {
  if (cp >= 0x1f1e6 && cp <= 0x1f1ff) return String.fromCharCode(97 + cp - 0x1f1e6);
  if (cp >= 0x1f170 && cp <= 0x1f189) return String.fromCharCode(97 + cp - 0x1f170);
  if (cp >= 0x1f150 && cp <= 0x1f169) return String.fromCharCode(97 + cp - 0x1f150);
  return undefined;
}

const _LEET: Record<string, string> = { '0': 'o', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's' };

// Mots isoles qui contiennent un terme du filtre sans en etre un (retires du texte simplifie). Fragments d'expression reguliere
// SANS barre oblique inverse (les listes sont extraites telles quelles pour le port Python). 2026-10-13 : chaque ajout a ete
// verifie sur le tokenizer CLIP, qui ne lit pas le terme dans le mot (« nudeln » -> nu|del|n, « snaked » -> sn|aked,
// « pornic » -> por|nic, « nacktschnecke » -> n|ack|t|sch...).
const IDIOMES: string[] = [
  'snaked', 'pornic', 'nudel[a-z]*', 'nacktschneck[a-z]*', 'nacktmull[a-z]*', 'nacktkatzen?', 'nacktsamer[a-z]*', 'nackthund[a-z]*',
  'naaktslak[a-z]*', 'spogliatoi[a-z]*',
];
const _IDIOMES = new RegExp('(?:^| )(?:' + IDIOMES.join('|') + ')(?= |$)', 'g');

// EXPRESSIONS SURES : expressions courantes qui contiennent un terme du filtre sans en etre un. 2026-10-13 : le mot marque « ! »
// est le SEUL retire, les autres restent lus (« naked baby shower » garde « baby » : avant, l'expression entiere disparaissait et
// le plancher ne voyait plus de mineur ; « a kid with a knife and fork » garde « kid ») ; et l'expression n'est reconnue
// qu'ECRITE TELLE QUELLE (mots separes par des espaces, tirets ou soulignes) : dans « a baby, shower » ou « fillette, pieds, nus »
// la ponctuation n'est plus effacee avant la recherche, chaque mot reste lu. Sans groupe capturant dans les fragments.
const EXPRESSIONS_SURES: string[] = [
  'baby !shower', 'bridal !shower', 'meteor !shower',
  '!showers? of (?:arrows?|sparks?|rain|meteors?|stars?|petals?|flowers?|coins?|gold|confetti|bullets?|debris|rocks?|stones?|fire|embers?|light|glass|leaves|snow|ice|ash|ashes|hail|gifts?)',
  '!chinks? in', '!chinks? of light', '!bath toys?', '!suicide squad', '!snuff box(?:es)?', '!snuff bottles?', '!bikini atoll',
  '!bikini bottom', '!nu metal', '!anal retentive',
  // 2026-10-13 (MODERATION-05) : vocabulaire de jeu et objets
  '!hit points?', '!hit box(?:es)?', 'critical !hits?', '!scream masks?', '!attack (?:pose|poses|animation|animations|stance|move|moves)',
  'toy !(?:guns?|swords?|knife|knives|weapons?|bows?)', 'water !guns?', 'nerf !guns?', 'squirt !guns?', 'cap !guns?',
  '!bedroom (?:furniture|set|sets|decor|decoration|lamp|wallpaper|interior|design)', '!suicide doors?', '!opium popp(?:y|ies)',
  '!gore tex', 'counter !terrorists?', 'counter !terrorism', 'anti !terrorists?', '!(?:knife|knives) and forks?', 'bunk !beds?',
  'hospital !beds?', '!spanking new', '!sperm whales?', 'bottle !nipples?', '!pussy cats?', '!pussy willows?', 'moby !dick',
  '!dick whittington', '!anal fins?', '!cum laude', 'wild !ass(?:es)?', '!senos? paranasal[a-z]*',
  // francais, portugais, italien : « nu » au sens de « a decouvert », sans personne denudee (« pieds nus », « tete nue »)
  'pieds? !nu(?:e|s|es)?', '!nus? pieds?', 'mains? !nues?', 'tetes? !nues?', 'oeil !nu', 'bras !nus?', 'jambes? !nues?',
  'arbres? !nus?', 'branches? !nues?', 'murs? !nus?', 'sols? !nus?', 'lames? !nues?', 'epees? !nues?', 'fils? !nus?', 'cables? !nus?',
  '!culottes? courtes?', 'ciels? !nus?', 'pieces? !nues?', 'paredes? !nuas?', 'stanz[ae] !nud[ae]', 'mur[io] !nud[oi]',
  'paret[ei] !nud[ae]',
];
const _SEPARATEUR_EXPRESSION = '[ _-]+';
/** Cle LITTERALE d'une expression : la plus longue suite de lettres en tete d'un de ses mots, que toute correspondance contient
 *  (« showers? » donne « shower » ; un mot comme « (?:knife|knives) » ne donne rien). Une expression dont la cle n'est pas dans
 *  le texte est ecartee sans lancer son expression reguliere (meme resultat, plus rapide sur un long texte). */
function _cleExpression(e: string): string {
  let cle = '';
  for (const mot of e.split(' ')) {
    const m = /^!?([a-z]*)(.?)/.exec(mot) as RegExpExecArray;
    const lettres = m[2] === '?' || m[2] === '*' ? m[1].slice(0, -1) : m[1];
    if (lettres.length > cle.length) cle = lettres;
  }
  return cle;
}
const _RE_EXPRESSIONS_SURES: { cle: string; re: RegExp }[] = EXPRESSIONS_SURES.map((e) => ({
  cle: _cleExpression(e),
  re: new RegExp('(^|[^a-z0-9])'
    + e.split(' ').map((m) => (m.startsWith('!') ? '(?:' + m.slice(1) + ')' : '(' + m + ')')).join(_SEPARATEUR_EXPRESSION)
    + '(?![a-z0-9])', 'g'),
}));

// « baby dragon » se lit « young dragon » (MODERATION-05 : « a baby dragon taking a bath » etait refuse comme illicite) :
// mineur AMBIGU, comme « young » ou « girl » : le plancher refuse encore avec une nudite ou une tenue minimale, plus avec le
// bain seul. Seulement quand les deux mots se suivent (« a baby, dragon » garde le mineur) et sans vetement apres l'animal
// (« baby bunny costume » est un bebe deguise).
const VETEMENTS_ANIMAL: string[] = ['costume', 'onesie', 'outfit', 'suit', 'pajama', 'pyjama', 'romper', 'sleeper', 'jumpsuit',
  'hoodie', 'hat', 'mask', 'dress', 'clothes', 'clothing', 'slipper'];
const ANIMAUX_BEBE: string[] = [
  'dragon', 'dino', 'dinosaur', 'dinosaure', 'dinosaurio', 'drache', 'drago', 'animal', 'animaux', 'beast', 'creature', 'monster',
  'monstre', 'bird', 'oiseau', 'chick', 'duck', 'goose', 'owl', 'eagle', 'hawk', 'penguin', 'parrot', 'cat', 'chat', 'gato',
  'dog', 'chien', 'perro', 'wolf', 'loup', 'lobo', 'fox', 'renard', 'zorro', 'bear', 'ours', 'oso', 'panda', 'koala', 'lion',
  'leon', 'tiger', 'tigre', 'leopard', 'cheetah', 'elephant', 'elefante', 'giraffe', 'girafe', 'zebra', 'hippo', 'rhino',
  'horse', 'cheval', 'caballo', 'pony', 'poney', 'unicorn', 'licorne', 'unicornio', 'donkey', 'cow', 'pig', 'sheep', 'goat',
  'deer', 'rabbit', 'lapin', 'conejo', 'bunny', 'squirrel', 'mouse', 'rat', 'hamster', 'monkey', 'singe', 'gorilla', 'sloth',
  'otter', 'seal', 'phoque', 'walrus', 'whale', 'baleine', 'ballena', 'dolphin', 'dauphin', 'delfin', 'shark', 'requin',
  'tiburon', 'fish', 'poisson', 'pez', 'octopus', 'turtle', 'tortue', 'tortuga', 'tortoise', 'frog', 'toad', 'lizard', 'snake',
  'serpent', 'serpiente', 'crocodile', 'alligator', 'spider', 'bat', 'griffin', 'gryphon', 'griffon', 'phoenix', 'hydra',
  'wyvern', 'yeti', 'slime', 'alien', 'robot', 'golem', 'kraken', 'chimera', 'mammoth', 'raptor', 'insect', 'butterfly', 'bee',
  'ant', 'crab', 'lobster', 'kangaroo', 'camel', 'llama', 'alpaca', 'moose', 'elk', 'buffalo', 'bison', 'boar', 'hedgehog',
  'raccoon', 'beaver', 'badger', 'weasel', 'ferret',
];
const _RE_BEBE_ANIMAL = new RegExp('(^|[^a-z0-9])(?:baby|bebe)' + _SEPARATEUR_EXPRESSION + '(?=(?:' + ANIMAUX_BEBE.join('|')
  + ')(?:s|es)?(?![a-z0-9])(?!' + _SEPARATEUR_EXPRESSION + '(?:' + VETEMENTS_ANIMAL.join('|') + ')(?:s|es)?(?![a-z0-9])))', 'g');

/** Expressions sures (mot marque retire, les autres gardes) et « baby <animal> » -> « young <animal> ». Sur le texte AVANT
 *  simplification : la ponctuation y separe encore les mots. */
function _sansExpressionsSures(s: string): string {
  let r = s.includes('baby') || s.includes('bebe') ? s.replace(_RE_BEBE_ANIMAL, '$1young ') : s;
  for (const { cle, re } of _RE_EXPRESSIONS_SURES) {
    if (!r.includes(cle)) continue;
    // a = [expression, separateur avant, mots gardes..., position, texte]
    r = r.replace(re, (...a: unknown[]) => String(a[1]) + a.slice(2, a.length - 2).join(' ') + ' ');
  }
  return r;
}

/** Remplace les lettres cyrilliques / grecques / armeniennes ressemblantes, les lettres latines speciales et les lettres-emoji. */
function _translit(s: string): string {
  return s.replace(/[^\x00-\x7f]/gu, (c) => _LATIN_SPECIAUX[c] ?? _HOMOGLYPHES[c] ?? _lettreSymbole(c.codePointAt(0) as number) ?? c);
}

/** Tout ce qui n'est pas [a-z0-9] devient un espace ; espaces compactes ; idiomes retires. */
function _simple(s: string): string {
  return (' ' + s.replace(/[^a-z0-9]+/g, ' ').trim() + ' ').replace(_IDIOMES, ' ').replace(/\s+/g, ' ').trim();
}

/** "n u d e" -> "nude" : au moins 3 LETTRES isolees de suite sont recollees (2026-10-13 : un chiffre isole ne se recolle plus,
 *  sinon « a 8 y/o » devenait « a8yo » et l'age n'etait plus lu). */
function _joindre(s: string): string {
  const t = s.split(' ');
  const sortie: string[] = [];
  const lettre = (x: string) => x.length === 1 && x >= 'a' && x <= 'z';
  let i = 0;
  while (i < t.length) {
    if (lettre(t[i])) {
      let j = i;
      while (j < t.length && lettre(t[j])) j++;
      if (j - i >= 3) sortie.push(t.slice(i, j).join(''));
      else for (let k = i; k < j; k++) sortie.push(t[k]);
      i = j;
    } else { sortie.push(t[i]); i++; }
  }
  return sortie.join(' ');
}

/** "n.u.d.e" / "n-u-d-e" -> "nude" : au moins 3 caracteres isoles separes par de la ponctuation, dans un meme mot. */
function _joindrePonctue(s: string): string {
  return s.replace(/(?<![a-z0-9])[a-z0-9](?:[^a-z0-9\s]+[a-z0-9]){2,}(?![a-z0-9])/g, (m) => m.replace(/[^a-z0-9]+/g, ''));
}

/** Series de lettres isolees recollees (>= 6 lettres) : "c h i l d n u d e" -> "childnude". */
function _series(simple: string): string[] {
  const sortie: string[] = [];
  const t = simple.split(' ');
  let i = 0;
  while (i < t.length) {
    if (t[i].length === 1) {
      let j = i;
      while (j < t.length && t[j].length === 1) j++;
      if (j - i >= 6) sortie.push(_ecraser(t.slice(i, j).join('')));
      i = j;
    } else i++;
  }
  return sortie;
}

/** "nuuuude" -> "nude" : une lettre repetee 3 fois ou plus est ramenee a une seule. */
function _ecraser(s: string): string { return s.replace(/([a-z])\1{2,}/g, '$1'); }

/** Leet : seulement dans les jetons qui contiennent deja une lettre (un nombre seul reste un nombre). */
function _leet(translit: string, unVers: 'i' | 'l'): string {
  return translit.split(/\s+/).map((jeton) => {
    if (!/[a-z]/.test(jeton)) return jeton;
    return jeton.replace(/[0134578@$]/g, (c) => (c === '1' ? unVers : (_LEET[c] ?? c)));
  }).join(' ');
}

// Vue exacte : une lettre qui porte un crochet, un point souscrit, une corne (vietnamien) ou un tilde (espagnol « ñu » = gnou)
// n'est PAS ramenee a sa lettre de base ; les accents francais, eux, sont retires (« epee nue » reste un idiome).
const _MARQUES_DISTINCTIVES = /[\u0303\u0309\u031b\u0323]/u;
// « torse nu » est une tenue (comme « shirtless », liste NU_MOYEN) : il ne compte pas comme le mot « nu » de la vue exacte.
const IDIOMES_EXACTS: string[] = ['torses? nus?'];
const _RE_IDIOMES_EXACTS = new RegExp('(?:^| )(?:' + IDIOMES_EXACTS.join('|') + ')(?= |$)', 'g');

/** VUE EXACTE (2026-10-13, MODERATION-05) pour les mots COURTS « nu », « nue », « nua »... : le vietnamien « nữ » (femme),
 *  « nụ » (bouton), « nữa », « nửa » et l'espagnol « ñu » se lisaient « nu » / « nua » une fois les accents retires. Une lettre
 *  a marque distinctive (ou d'une autre ecriture) devient « x » : « nx » n'est plus « nu ». */
function _vueExacte(net: string): string {
  let s = net;
  try { s = s.normalize('NFD'); } catch { /* garde */ }
  s = s.replace(/(\P{M})(\p{M}+)/gu, (_m, lettre: string, marques: string) => (_MARQUES_DISTINCTIVES.test(marques) ? 'x' : lettre));
  s = _sansExpressionsSures(_translit(s).replace(/[^\x00-\x7f]/gu, (c) => (/\p{L}/u.test(c) ? 'x' : ' ')));
  return _simple(s).replace(_RE_IDIOMES_EXACTS, ' ').replace(/ +/g, ' ').trim();
}

/** VUE UNICODE (2026-10-13, MODERATION-01) : pour les lexiques des ecritures non latines. Marques retirees sauf celles qui
 *  portent le sens (_MARQUES_GARDEES), arabe ramene a une forme simple (tatweel retire ; ی ى -> ي ; ک -> ك ; ة -> ه ; ٱ -> ا),
 *  katakana -> hiragana, teintes de peau des emoji retirees ; tout ce qui n'est ni lettre, ni chiffre, ni marque, ni symbole
 *  (emoji) devient un espace. Le lexique passe par la MEME fonction : texte et termes ont la meme forme. */
function _vueUnicode(net: string): string {
  let s = net;
  try { s = s.normalize('NFD'); } catch { /* garde */ }
  s = s.replace(/\p{M}/gu, (m) => (_MARQUES_GARDEES.test(m) ? m : ''));
  try { s = s.normalize('NFC'); } catch { /* garde */ }
  s = s.replace(/\u0640/g, '').replace(/[\u06cc\u0649]/g, '\u064a').replace(/\u06a9/g, '\u0643').replace(/\u0629/g, '\u0647')
    .replace(/\u0671/g, '\u0627');
  s = s.replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  s = s.replace(/[\u{1f3fb}-\u{1f3ff}]/gu, '');
  s = s.replace(/[^\p{L}\p{N}\p{M}\p{So}]+/gu, ' ');
  return s.replace(/ +/g, ' ').trim();
}

interface VuesPlancher {
  /** texte translittere, chiffres conserves (les ages passent par la) */
  chiffres: string;
  /** idem avec leet (1 -> i) */
  leetI: string;
  /** idem avec leet (1 -> l) */
  leetL: string;
  /** lettres seules, sans separateur, lettres repetees ecrasees (une vue par leet) */
  collees: string[];
  /** series de lettres isolees recollees, ex. "childnude" (mineur ET nudite ecrits lettre par lettre) */
  series: string[];
  /** les trois premieres vues SANS lettres repetees ecrasees : un mot colle « toplessschoolgirl » y garde ses trois « s » */
  nonEcrasees: string[];
  /** vue exacte (accents gardes) pour les mots courts « nu », « nue », « nua »... */
  exacte: string;
  /** vue Unicode (sans translitteration) pour les termes non latins et les emoji */
  unicode: string;
}

function _vuesPlancher(prompt: unknown): VuesPlancher {
  const net = _nettoyer(prompt);
  const t = _sansExpressionsSures(_translit(_sansMarques(net)));
  const assembler = (x: string) => _joindre(_simple(_joindrePonctue(x)));
  const nonEcrasees = [assembler(t), assembler(_leet(t, 'i')), assembler(_leet(t, 'l'))];
  const [chiffres, leetI, leetL] = nonEcrasees.map(_ecraser);
  const coller = (v: string) => v.replace(/[^a-z]/g, '').replace(/([a-z])\1+/g, '$1');
  // La vue collee part du texte sans jonction (les jonctions sont deja des lettres collees).
  const collees = [coller(_simple(_leet(t, 'i'))), coller(_simple(_leet(t, 'l')))];
  const series = [
    ..._series(_simple(_joindrePonctue(t))), ..._series(_simple(_joindrePonctue(_leet(t, 'i')))),
    ..._series(_simple(_joindrePonctue(_leet(t, 'l')))),
  ];
  return { chiffres, leetI, leetL, collees, series, nonEcrasees, exacte: _vueExacte(net),
    unicode: _vueUnicode(net).replace(_RE_IDIOMES_UNICODE, ' ') };
}

// Expressions chinoises / japonaises ou « 裸 » (nu) ne designe personne : pieds nus, oeil nu, couleur chair, seigle, plantes
// gymnospermes, fil denude, ampoule nue, « sans le sou ». Retirees du texte (vue Unicode) avant la recherche du lexique.
const IDIOMES_UNICODE: string[] = ['裸足', '裸眼', '裸色', '裸辞', '裸婚', '裸麦', '裸子植物', '裸线', '裸機', '裸机', '裸電球', '裸一貫',
  '脱衣所', '脱衣場', '脱衣室', '脱衣间', '脱衣間'];
const _RE_IDIOMES_UNICODE = new RegExp(IDIOMES_UNICODE.join('|'), 'g');

// ═══════════════════════════════════════════════════════════════════════════
// TERMES. Syntaxe : « mot » = mot entier ; « mot* » = debut de mot ; « *mot* » (2026-10-13) = n'importe ou dans un mot.
// Les termes sont normalises comme le texte avant compilation : accents et ponctuation sans effet.
// ═══════════════════════════════════════════════════════════════════════════

interface Terme { src: string; re: RegExp; cat: CategorieBlocage }
/** Liste compilee. `rapide` (2026-10-13) : UNE expression qui accepte tout texte ou au moins un terme de la liste peut se
 *  trouver (meme debut de mot, sans la borne de fin) ; quand elle ne trouve rien, la liste est ecartee sans essayer ses
 *  termes un par un. Le resultat ne change pas, seul le temps baisse (la liste compte plusieurs centaines de termes). */
interface Liste { termes: Terme[]; bornes: string[]; infixes: string[]; rapide: RegExp | null }

function _echapper(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function _noyauSource(src: string): string { return src.replace(/^\*/, '').replace(/\*$/, ''); }
function _formeTerme(src: string): string { return _simple(_translit(_base(_noyauSource(src)))); }
function _formeUnicode(src: string): string { return _vueUnicode(_nettoyer(_noyauSource(src))); }

function _liste(termes: Terme[], bornes: string[], infixes: string[]): Liste {
  const parties: string[] = [];
  if (bornes.length) parties.push('(?:^| )(?:' + bornes.join('|') + ')');
  if (infixes.length) parties.push('(?:' + infixes.join('|') + ')');
  return { termes, bornes, infixes, rapide: parties.length ? new RegExp(parties.join('|')) : null };
}
function _fusionner(...listes: Liste[]): Liste {
  return _liste(listes.flatMap((l) => l.termes), listes.flatMap((l) => l.bornes), listes.flatMap((l) => l.infixes));
}

function _compilerAvec(liste: string[], cat: CategorieBlocage, forme: (s: string) => string): Liste {
  const termes: Terme[] = [];
  const bornes: string[] = [];
  const infixes: string[] = [];
  for (const src of liste) {
    const infixe = src.startsWith('*');
    const prefixe = src.endsWith('*');
    const noyau = _echapper(forme(src));
    if (!noyau) continue;   // terme vide apres normalisation (idiome) : jamais compile en expression qui accepte tout
    termes.push({ src, cat, re: new RegExp((infixe ? '' : '(?:^| )') + noyau + (prefixe ? '' : '(?= |$)')) });
    (infixe ? infixes : bornes).push(noyau);
  }
  return _liste(termes, bornes, infixes);
}
function _compiler(liste: string[], cat: CategorieBlocage): Liste { return _compilerAvec(liste, cat, _formeTerme); }
function _compilerUnicode(liste: string[], cat: CategorieBlocage): Liste { return _compilerAvec(liste, cat, _formeUnicode); }

function _chercher(vues: string[], l: Liste): Terme | null {
  const rapide = l.rapide;
  if (!rapide || !vues.some((v) => rapide.test(v))) return null;
  for (const t of l.termes) for (const v of vues) if (t.re.test(v)) return t;
  return null;
}

function _nom(t: Terme): string { return _noyauSource(t.src); }

// ── Mineurs (A) ────────────────────────────────────────────────────────────
// Sans ambiguite : un seul de ces mots suffit a parler d'un mineur.
const MINEURS_FORT: string[] = [
  // anglais
  'child', 'children', 'childlike', 'child like', 'kid', 'kids', 'kiddo', 'kiddie', 'kiddy', 'infant*', 'baby', 'babies',
  'toddler*', 'preteen*', 'pre teen*', 'tween*', 'teen', 'teens', 'teenage*', 'teenager*', 'minor', 'minors', 'underage',
  'under age', 'juvenile*', 'prepubescent', 'pubescent', 'schoolgirl*', 'schoolboy*', 'school girl*', 'school boy*',
  'schoolchild*', 'little girl*', 'little boy*', 'small girl*', 'small boy*', 'young girl*', 'young boy*', 'young lad*', 'young teen*', 'young looking', 'looks young', 'looking young',
  'kindergarten*', 'preschool*', 'elementary school', 'primary school', 'middle school', 'junior high', 'high school',
  'highschool', 'under 18', 'below 18', 'less than 18', 'younger than 18', 'under eighteen', 'under 16', 'under 14',
  // anglais, 2026-10-13 (M3) : synonymes, classes d'ecole, formulations de l'age
  'newborn*', 'new born*', 'neonat*', 'youngster*', 'tots', 'schoolkid*', 'school kid*', 'little one', 'little ones',
  'youngling*', 'bairn*', 'tyke*', 'moppet*', 'rugrat*', 'street urchin*', 'underaged', 'under aged', 'little sister*',
  'little brother*', 'baby sister*', 'baby brother*', 'sweet sixteen', 'middle schooler*', 'high schooler*', 'grade school*',
  'sprog', 'sprogs', 'nipper', 'nippers',
  'elementary schooler*', 'kindergartner*', 'nursery school*', 'cub scout*', 'girl scout*', 'boy scout*', 'first grade*',
  'second grade*', 'third grade*', 'fourth grade*', 'fifth grade*', 'sixth grade*', 'seventh grade*', 'eighth grade*',
  'ninth grade*', 'tenth grade*', 'eleventh grade*', 'twelfth grade*', '1st grade*', '2nd grade*', '3rd grade*', '4th grade*',
  '5th grade*', '6th grade*', '7th grade*', '8th grade*', '9th grade*', '10th grade*', '11th grade*', '12th grade*',
  'below the age of 18', 'under the age of 18', 'not yet 18', 'not yet eighteen',
  // francais
  'enfant*', 'bebe*', 'gamin', 'gamine', 'gamins', 'gamines', 'gosse*', 'fillette*', 'garconnet*', 'mineur*', 'adolescent*', 'ado', 'ados', 'ecolier*',
  'ecoliere*', 'collegien*', 'lyceen*', 'nourrisson*', 'petite fille*', 'petit garcon*', 'jeune fille*', 'jeune garcon*',
  'moins de 18', 'marmot', 'marmots', 'mome', 'momes', 'petiot*', 'pitchoun*', 'nouveau ne*', 'nouveaux nes', 'preado*', 'pre ado*',
  // espagnol
  'nino*', 'nina*', 'nene', 'nena', 'menor', 'menores', 'adolescente*', 'chiquill*', 'preadolescente*', 'colegial*',
  'menos de 18', 'recien nacid*', 'escolar', 'escolares',
  // allemand
  'kinder*', 'kleinkind*', 'madchen*', 'maedchen*', 'minderjahrig*', 'jugendlich*', 'schulmadchen*', 'unter 18', 'saugling*', 'teenie*',
  // portugais
  'crianca*', 'menino*', 'menina*', 'garotinho*', 'garotinha*', 'menininh*', 'nenem*', 'menor de idade',
  // italien
  'bambin*', 'ragazzin*', 'minorenn*', 'neonat*', 'fanciull*', 'sotto i 18', 'bimba', 'bimbe', 'bimbi', 'scolar*',
  // commun
  'infantil*', 'infante*',
  // turc, neerlandais, polonais, indonesien, vietnamien (ecriture latine, 2026-10-13 : MODERATION-01)
  'cocuk*', 'cocug*', 'bebek*', 'kucuk kiz*', 'kucuk oglan*', 'resit olmayan', 'ergen*', 'ilkokul*',
  'peuter*', 'kleuter*', 'minderjarig*', 'jongetje*',
  'dziecko', 'dzieci*', 'dziecka', 'dziecku', 'dzieckiem', 'dziewczynk*', 'chlopczyk*', 'niemowl*', 'nieletni*',
  'anak', 'anak anak', 'balita', 'bayi', 'di bawah umur',
  'tre em', 'be gai', 'be trai', 'em be', 'thieu nhi', 'vi thanh nien', 'dua tre', 'tre con', 'con nit', 'cau be', 'co be',
  // allemand : « Kind » au singulier avec un determinant allemand n'est plus l'adjectif anglais « kind »
  'ein kind', 'das kind', 'dem kind', 'einem kind', 'kleines kind', 'kleinen kind', 'kindes', 'een kind', 'het kind',
];
// Ambigus : peuvent designer un adulte (ex. "young woman", "girl in a bikini").
const MINEURS_AMBIGUS: string[] = [
  'boy', 'boys', 'girl', 'girls', 'young', 'youth', 'youthful', 'lass', 'jeune', 'jeunes', 'fille', 'filles', 'garcon', 'garcons',
  'junge', 'junges', 'jungen', 'chico', 'chica', 'chicos', 'chicas', 'muchacho', 'muchacha', 'joven', 'jovenes',
  'ragazzo', 'ragazza', 'ragazzi', 'ragazze', 'garoto', 'garota', 'rapaz', 'rapariga',
  // Relecture 2026-10-03 : « Kind » (allemand, singulier) + nudite passait le plancher alors que « Kinder » / « Maedchen » / « Junge » le declenchaient. Ambigu avec l'adjectif anglais
  // « kind » : comme girl / boy il ne declenche donc le plancher qu'AVEC une nudite explicite.
  'kind',
  // 2026-10-13 : autres langues
  'chaval*', 'cria', 'crias', 'schuler*', 'kiz', 'kizlar*', 'oglan*', 'meisje*', 'jongen*', 'dziewczyn*', 'chlopiec', 'chlopc*', 'gadis',
  'remaja',
];
// INDICES (2026-10-13, M3) : le plus souvent des adultes. Declenchent le plancher seulement avec une nudite ou un acte
// EXPLICITE, jamais avec une tenue (« mother and daughter in swimsuits » reste permis).
const MINEURS_INDICES: string[] = ['daughter*', 'niece*', 'nephew*', 'little miss', 'lolita*', 'pupil', 'pupils', 'stepdaughter*', 'stepson*'];
// Mineurs pour les combinaisons de VIOLENCE du filtre general ("minor character" est un terme de jeu).
const MINEURS_VIOLENCE: string[] = [
  'child', 'children', 'kid', 'kids', 'baby', 'babies', 'infant*', 'toddler*', 'enfant*', 'bebe*', 'nino*', 'nina*', 'kinder*',
  'crianca*', 'bambin*',
];

// ── Nudite / sexe (B) ─────────────────────────────────────────────────────
// FORT : explicite. Avec n'importe quel mineur (ou age < 18), meme ambigu : plancher.
const NU_FORT: string[] = [
  // anglais
  '*nude*', 'nudity', '*naked*', '*nsfw*', 'porn*', 'xxx', 'erotic*', '*topless*', 'bottomless', 'undress*', 'unclothed', 'disrobe*',
  'unclad', 'wearing nothing', 'wears nothing', 'wear nothing', 'without clothes', 'without clothing', 'without any clothes',
  'without any clothing', 'no clothes', 'no clothing', 'wearing no clothes', 'in the nude', 'birthday suit', 'full frontal',
  'fully exposed', 'bare chest*', 'bare breast*', 'bare skin', 'bare butt', 'bare bottom', 'bare torso', 'barely clothed',
  'barely dressed', 'scantily clad', 'scantily dressed', 'sex', 'sexy', 'sexual*', 'sexually', 'sexualized', 'sexualised',
  'sensual*', 'seductive', 'provocative', 'suggestive', 'lingerie', 'underwear', 'panties', 'thong', 'fetish', 'bdsm', 'bondage',
  'nipple*', 'breasts', 'boobs', 'tits', 'genital*', 'vagina', 'penis', 'pussy', 'crotch', 'upskirt', 'cleavage', 'lewd', '*hentai*',
  'ecchi', 'orgasm*', 'masturb*', 'cum', 'ahegao',
  // anglais, 2026-10-13 (M1) : actes et anatomie explicites ; un seul de ces mots avec un mineur = plancher
  'blowjob*', 'blow job*', 'handjob*', 'hand job*', 'footjob*', 'foot job*', 'titjob*', 'titfuck*', 'rimjob*', 'fellat*',
  'cunniling*', 'anilingus', 'intercourse', 'coitus', 'copulat*', 'sodomy', 'sodomiz*', 'sodomis*', 'semen', 'sperm',
  'ejaculat*', 'cumshot*', 'cum shot*', 'creampie*', 'bukkake', 'gangbang*', 'gang bang*', 'orgy', 'orgies', 'threesome*',
  'foursome*', 'bestiality', 'zoophil*', 'incest*', 'fisting', 'dildo*', 'butt plug*', 'buttplug*', 'vulva*', 'labia', 'clitor*',
  'clit', 'clits', 'areola*', 'scrotum*', 'testicle*', 'phallus*', 'pubic hair', 'pubes', 'private parts', 'intimate parts',
  'molest*', 'raped', 'raping', 'rapist*', 'prostitut*', 'brothel*', 'stripper*', 'striptease*', 'strip tease*',
  'lap dance*', 'making love', 'make love', 'touching himself', 'touching herself', 'touching themselves', 'lifting her skirt',
  'lifts her skirt', 'lifted her skirt', 'skirt lift*', 'camel toe', 'nip slip', 'skinny dipping', 'in the buff', 'nudis*',
  'naturist*', 'milf*', 'slut*', 'whore*', 'futanari', 'shemale*', 'dominatrix', 'ball gag*', 'ballgag*', 'anal', 'anus',
  // francais (« nu », « nue », « nus », « nues » sont dans NU_EXACTS : vue exacte)
  'nudite', 'denud*', 'deshabill*', 'sans vetement*', 'sans habit*', 'a poil', 'seins nus',
  'sein nu', 'sexe', 'sexuel*', 'erotique*', '*pornograph*', '*pornograf*', 'sensuel*', 'seducteur', 'provocant*', 'soutien gorge',
  'seins', 'tout nu', 'toute nue',
  'sous vetement*', 'en culotte', 'en string', 'en slip', 'en calecon', 'en petite tenue', 'devetu*', 'tenue d eve',
  'tenue d adam', 'plus simple appareil', 'sans rien sur le dos', 'nuisette*', 'sodomie', 'fellation', 'viol', 'violee', 'violees',
  'attouchement*', 'partouze*',
  // espagnol
  '*desnud*', 'sin ropa', 'en cueros', 'sexo', 'lenceria', 'ropa interior', 'bragas', 'tanga', 'provocativ*',
  'senos', 'tetas', 'calzon*', 'en pelotas', 'sin nada puesto', 'ropa intima', 'follar', 'follando', 'abuso sexual',
  // allemand
  '*nackt*', 'ausgezogen', 'entkleidet', 'unbekleidet', 'oben ohne', 'ohne kleidung', 'ohne kleider', 'erotisch*', 'sexuell*',
  'unterwasche', 'sinnlich*', 'verfuhrerisch*', 'busen', 'titten', 'unterhose*', 'schlupfer*', 'reizwasche', 'entblosst*',
  'barbusig*', 'nackig*', 'fkk', 'geschlechtsverkehr', 'vergewaltig*', 'ficken', 'fickt', 'gefickt',
  // portugais (« nua », « nuas » : NU_EXACTS)
  'seminu', 'seminus', 'seminua', 'seminuas', 'seminude*', 'seminudo*', 'seminuda*', 'seminudi', 'sem roupa*', 'calcinha*',
  'roupa intima', 'peitos', 'seios', 'pelad*', 'de cueca', 'de cuecas', 'em cueca', 'em cuecas', 'despid*', 'nuazinh*',
  'trajes intimos', 'estupr*',
  // italien
  'nudo', 'nudi', 'nudita', 'spogliat', 'spogliata', 'spogliato', 'spogliati', 'spogliate', 'spogliarsi', 'spogliarell*', 'svestit*',
  'senza vestiti', 'senza vestito', 'senza abiti', 'seno nudo', 'seni nudi',
  'nuda', 'sessuale', 'sesso', 'mutand*', 'provocante', 'seni', 'tette', 'biancheria intima', 'perizoma', 'seno scoperto',
  'senza niente addosso', 'nudin*', 'in slip',
  // turc, neerlandais, polonais, indonesien, vietnamien (ecriture latine, 2026-10-13 : MODERATION-01)
  '*ciplak*', 'soyunmus', 'soyunuk', 'seks', 'seksi', 'seksuel*', 'erotik*', 'ic camasir*', 'kulot*', 'tecavuz*', 'taciz*',
  'cinsel*', 'mustehcen*',
  'naakt*', 'ontkleed*', 'ondergoed*', 'seksueel*',
  'nagie', 'nago', 'nagich', 'nagosc*', 'rozebran*', 'bielizn*', 'seksualn*',
  'telanjang', 'bugil', 'cabul*', 'pakaian dalam', 'pemerkosa*', 'mesum',
  'khoa than', 'khieu dam', 'do lot', 'hiep dam',
];
// Mots COURTS (« nu », « nue », « nua »...) : lus sur la VUE EXACTE (accents gardes, MODERATION-05) — le vietnamien « nữ »
// (femme) ou « nữa » se ramenait a « nu » / « nua » une fois les accents retires.
const NU_EXACTS: string[] = ['nu', 'nue', 'nus', 'nues', 'nua', 'nuas'];
// MOYEN : tenue minimale. Avec un mineur ou un age (et un mineur ambigu aussi).
const NU_MOYEN: string[] = [
  'bikini*', 'swimsuit', 'swim suit', 'bra', 'brassiere', 'shirtless', 'without a shirt', 'without shirt', 'no shirt', 'no top',
  'without top', 'without a top', 'without pants', 'no pants', 'without underwear', 'no underwear', 'diaper only',
  'sin camisa', 'sin camiseta', 'sin blusa', 'sans haut', 'sans t shirt', 'sans tee shirt', 'maillot de bain', 'ohne hemd',
  'ohne oberteil', 'badeanzug', 'sem camisa', 'sem blusa', 'biquini', 'senza maglia', 'senza maglietta', 'costume da bagno',
  // 2026-10-13 (M3)
  'without a skirt', 'without skirt', 'no skirt', 'see through dress', 'see through shirt', 'see through top', 'see through clothes',
  'see through clothing', 'see through outfit', 'transparent clothes', 'transparent clothing', 'transparent dress', 'wet t shirt',
  'wet tshirt', 'wet shirt', 'exposed chest', 'exposed torso', 'exposed body', 'boxer shorts', 'boxer briefs', 'in boxers',
  'tighty whities', 'couche culotte*', 'tenue legere', 'tenue transparente', 'poca ropa', 'traje de bano', 'sujetador*', 'sosten',
  'torse nu', 'torses nus',
  'badehose*', 'ohne hose', 'sutia', 'roupa transparente', 'sem camiseta', 'reggiseno', 'pigiama trasparente',
];
// FAIBLE : vocabulaire de scene, seulement avec un mineur SANS ambiguite (plancher).
const NU_FAIBLE_PLANCHER: string[] = ['bath', 'bathing', 'shower', 'showering', 'intimate', 'revealing', 'bain', 'banho', 'bano',
  'badewanne', 'bagno',
  // 2026-10-13
  'douche', 'ducha', 'dusche', 'doccia', 'chuveiro', 'changing clothes', 'getting changed', 'getting dressed', 'only a towel',
  'only in a towel', 'in a towel', 'wrapped in a towel', 'solo con una toalla', 'solo una toalla'];
// FAIBLE, filtre general seulement.
const NU_FAIBLE_GENERAL: string[] = ['bed', 'bedroom'];
// SEXUEL AMBIGU (2026-10-13, M1) : argot et mots a double sens (« cock » = coq, « erection » d'une tour) ; plancher seulement
// avec un mineur SANS ambiguite ou un age.
const SEXE_MINEUR_FORT: string[] = ['dick', 'dicks', 'cock', 'cocks', 'erection*', 'boner*', 'hardon*', 'penetrating her',
  'penetrating him', 'being penetrated', 'spread legs', 'spreading her legs', 'spread her legs', 'legs spread'];

// Violence EXERCEE sur un enfant (plancher). Volontairement etroit : "kid with a knife"
// ou "child hero hit by a rock" ne sont pas des contenus illicites.
const VIOLENCE_ENFANT_PLANCHER: string[] = [
  'abuse*', 'abusing', 'hurt', 'hurting', 'beaten', 'beating', 'beat up', 'punch*', 'slap*', 'whip*', 'torture*', 'tortur*', 'rape',
  'rapes', 'raped', 'raping', 'molest*', 'strangl*', 'suffocat*', 'mutilat*', 'dismember*', 'murder*',
  'frapp*', 'battu*', 'maltrait*', 'viole', 'violee', 'violer', 'agress*', 'abus', 'abuso*', 'misshandl*', 'missbrauch*',
  // 2026-10-13
  'spank*', 'gagged', 'istismar*',
];

// ── Termes illicites en soi (plancher) ────────────────────────────────────
const PLANCHER_MOTS: string[] = [
  'pedophil*', 'paedophil*', 'pedofil*', 'pedoporn*', 'pedocrim*', 'pedopornograf*', 'padophil*', 'lolicon*', 'loli', 'lolis',
  'shota', 'shotas', 'shotacon*', 'child abuse', 'child porn*', 'childporn*', 'child sex*', 'child rape', 'child exploitation',
  'kid porn*', 'kiddie porn*', 'kiddy porn*', 'baby porn*', 'underage porn*', 'underage sex*', 'underage nude*', 'csam',
  'jailbait', 'toddler abuse', 'infant abuse', 'toddlercon', 'babycon',
  'kinderporno*', 'kindesmissbrauch', 'kinderschander', 'pornografia infantil', 'porno infantil', 'pornoinfantil',
  'abuso infantil', 'abuso sexual infantil', 'pornographie enfantine', 'pornografia minorile',
  // 2026-10-13 (MODERATION-01)
  'cocuk porno*', 'cocuk istismari', 'pornografia dziecieca', 'pornografi anak', 'khieu dam tre em', 'kindermisbruik', 'pedofiel*',
  'nymphet*',
  // composes « enfant + pornographie » d'autres langues (sv, da, fi, hu, cs, pl) : le mineur est DANS le mot
  'barnporr*', 'barnporn*', 'borneporno*', 'lapsiporno*', 'gyermekporno*', 'detska pornografie', 'detske porno*', 'dziecieca pornografia',
];
// Versions "collees" (lettres seules) pour les separateurs exotiques : substring, donc seulement des termes longs.
const PLANCHER_COLLES: string[] = [
  'pedophil', 'paedophil', 'pedofil', 'lolicon', 'shotacon', 'childporn', 'childabuse', 'childsexualabuse', 'toddlerabuse',
  'infantabuse', 'kidporn', 'kiddieporn', 'kiddyporn', 'childsex', 'kinderporno', 'kindesmissbrauch', 'kinderschander',
  'pornoinfantil', 'pornografiainfantil', 'pedopornograph', 'pedopornograf', 'pedocriminel', 'jailbait', 'underageporn',
  'underagesex',
];
// Termes non latins (vue Unicode ; « *x* » = n'importe ou dans un mot). Illicites en soi.
const PLANCHER_UNICODE: string[] = [
  '*педофил*',                                   // pedofil (russe)
  '*детское порно*',     // detskoe porno
  '*детская порно*',     // detskaya porno
  '*детского порно*', // detskogo porno
  '*ロリコン*', '*ショタコン*',                   // lolicon, shotacon (japonais)
  '*児童ポルノ*', '*兒童色情*', '*儿童色情*', // pornographie enfantine
  // 2026-10-13 (MODERATION-01) : pedophilie (zh), pornographie enfantine (ko, ar, hi), abus sexuel d'enfant (hi)
  '*恋童*', '*戀童*', '*아동 포르노*', '*아동포르노*', '*아동 음란물*', '*아동음란물*', '*اباحية الاطفال*', '*اباحية اطفال*',
  '*बाल पोर्न*', '*बाल अश्लील*', '*बाल यौन शोषण*',
];

// ── Lexique des ecritures NON LATINES (vue Unicode, 2026-10-13 : MODERATION-01) ─────────────────────────────────
// Langues de l'interface (zh, hi, ar) et les plus courantes (ru, ja, ko ; tr, nl, pl, id, vi sont en ecriture latine,
// plus haut). Formes ecrites telles qu'on les tape : la normalisation (marques, katakana, alef...) s'applique au texte ET au
// terme. Sans locuteur natif : chaque terme est un mot courant et non ambigu ; les mots trop courts ou a double sens
// (coreen « 아이 » dans « 아이템 », arabe « جنس » = nationalite) sont ecrits sous leurs seules formes sures.
const MINEURS_FORT_UNICODE: string[] = [
  // chinois (simplifie et traditionnel)
  '*儿童*', '*兒童*', '*孩子*', '*小孩*', '*幼女*', '*幼童*', '*幼儿*', '*幼兒*', '*婴儿*', '*嬰兒*', '*宝宝*', '*寶寶*', '*未成年*',
  '*小学生*', '*小學生*', '*中学生*', '*中學生*', '*初中生*', '*小女孩*', '*小男孩*', '*萝莉*', '*蘿莉*', '*正太*',
  // japonais
  '*子供*', '*子ども*', '*こども*', '*児童*', '*幼児*', '*乳児*', '*赤ちゃん*', '*赤ん坊*', 'ロリ', '*ロリっ子*', '*ショタ*', '*十代*', '*園児*',
  // coreen
  '*어린이*', '*아동*', '*어린아이*', '*여자아이*', '*남자아이*', '*아기*', '*유아*', '*미성년*', '*초등학생*', '*중학생*', '로리',
  '쇼타', '아이', '아이가', '아이는', '아이를', '아이의', '아이와', '아이들*',
  // arabe
  '*طفل*', '*أطفال*', '*رضيع*', '*قاصر*', '*مراهق*', 'صبي', 'الصبي', 'صبية',
  // hindi
  'बच्च*', 'बालक', 'बालकों', 'बालिका', 'बालिकाएं', 'बालिकाएँ', 'बालिकाओं', 'शिशु*', 'नाबालिग*',
  // russe, ukrainien
  'ребёнок', 'ребёнк*', 'ребенок', 'ребенк*', 'дети', 'детей', 'детям', 'детьми', 'детях', 'детск*', 'детишк*', 'малыш*',
  'младен*', 'девочк*', 'мальчик*', 'школьниц*', 'школьник*', 'подрост*', 'несовершеннолетн*', 'малолетн*', 'дитя', 'дитин*',
  'дитяч*', 'діти',
  'дітей', 'дівчинк*', 'хлопчик*',
  // emoji (bebe, enfant)
  '*\u{1F476}*', '*\u{1F9D2}*',
];
const MINEURS_AMBIGUS_UNICODE: string[] = [
  '*女孩*', '*男孩*', '*少女*', '*少年*', '*女の子*', '*男の子*', '*소녀*', '*소년*', 'فتاة', 'الفتاة', 'بنت', 'البنت', 'بنات',
  'ولد', 'الولد', 'أولاد', 'الأولاد',
  'البنات', 'लड़क*', 'लडक*', 'किशोर*',
  // emoji (fille, garcon)
  '*\u{1F467}*', '*\u{1F466}*',
];
// Nudite / sexe EXPLICITES (plancher avec n'importe quel mineur ; filtre general : bloque seul).
const NU_FORT_UNICODE: string[] = [
  // chinois
  '*裸体*', '*裸體*', '*全裸*', '*半裸*', '*裸露*', '*裸照*', '*裸女*', '*裸男*', '*裸身*', '*赤裸*', '*一丝不挂*', '*一絲不掛*',
  '*没穿衣服*', '*沒穿衣服*', '*不穿衣服*', '*脱光*', '*脫光*', '*色情*', '*情色*', '*内衣*', '*內衣*', '*内裤*', '*內褲*', '*性交*',
  '*做爱*', '*做愛*', '*口交*', '*强奸*', '*強姦*', '*強暴*', '*猥亵*', '*猥褻*', '*自慰*', '*阴道*', '*陰道*', '*阴茎*', '*陰莖*',
  '*乳头*', '*乳頭*', '*淫*', '*裸*',
  // japonais
  '*裸の*', '*裸で*', '*裸に*', '*はだか*', '*ヌード*', '*セックス*', '*ポルノ*', '*エロい*', '*エロ画*', '*エロ漫*', '*エロ同人*',
  '*エッチな*', '*下着*', '*パンティ*', '*性的な*', '*性的に*', '*おっぱい*', '*乳首*', '*レイプ*', '*痴漢*', '*援交*', '*援助交際*', '*脱衣*',
  '*服を着ていない*',
  // coreen
  '*벌거벗*', '*알몸*', '*나체*', '*누드*', '*섹스*', '*성관계*', '*성행위*', '*음란*', '*포르노*', '*야동*', '*속옷*', '*팬티*',
  '*강간*', '*성폭행*', '*성추행*', '*자위하*', '*자위행위*', '*젖꼭지*', '*생식기*',
  // arabe
  '*عاري*', 'عار', '*عريان*', '*عراة*', '*متعري*', 'التعري', 'عري', '*بدون ملابس*', '*بلا ملابس*', '*ملابس داخلية*',
  '*ممارسة الجنس*', '*اعتداء جنسي*', '*جنسيا*', '*إباحي*', '*بورنو*', 'بورن', '*اغتصاب*', '*تحرش*', '*عورة*', '*مهبل*',
  '*استمناء*', 'سكس',
  // hindi
  'नग्न*', 'नंगा', 'नंगी', 'नंगे', 'निर्वस्त्र*', 'बिना कपड*', 'कपड़े नहीं', 'कपडे नहीं', '*अश्लील*', '*पोर्न*', 'सेक्स*', 'यौन*',
  '*बलात्कार*', '*अंतर्वस्त्र*', 'कामुक*', '*हस्तमैथुन*',
  // russe, ukrainien
  'голый', 'голая', 'голое', 'голые', 'голого', 'голой', 'голым', 'голую', 'голых', 'голыми', 'голеньк*', 'голышом', 'обнажённ*',
  'нагой', 'нагая', 'нагое', 'нагие', 'нагую', 'нагишом', 'раздет*', 'раздевается', 'раздеваться', 'раздевающ*', 'без одежды', 'секс', 'секса', 'сексом', 'сексу',
  'сексуальн*', 'порн*', 'эрот*', 'нижнее бельё', 'нижнем белье', 'нижнего белья', 'трусик*', 'в трусах', 'минет*',
  'изнасил*', 'мастурб*', 'половой акт', 'половые органы', 'половых органов', 'гениталии', 'пенис*', 'вагин*', 'совокупле*', 'совокупля*',
  'растлен*', 'голий', 'голе', 'голі', 'оголен*',
  // emoji (« reserve aux adultes »)
  '*\u{1F51E}*',
];
// SUGGESTIF (« sexy ») : plancher avec un mineur ; le filtre general ne le bloque pas seul (comme l'anglais « sexy »).
const NU_SUGGESTIF_UNICODE: string[] = ['*性感*', '*セクシー*', '*섹시*', '야한', 'секси', 'сексапильн*', '*مثيرة جنسيا*'];
// Tenue minimale (plancher avec un mineur, meme ambigu, ou un age).
const NU_MOYEN_UNICODE: string[] = [
  '*比基尼*', '*泳装*', '*泳裝*', '*泳衣*', '*ビキニ*', '*水着*', '*スク水*', '*비키니*', '*수영복*', '*بكيني*', '*مايوه*',
  '*ملابس السباحة*', 'बिकिनी*', 'स्विमसूट*', 'चड्डी*', 'бикини', 'купальник*',
  '*\u{1F459}*', '*\u{1FA72}*', '*\u{1FA71}*',     // emoji : bikini, slip, maillot une piece
];
// Scene (bain, douche) : plancher seulement avec un mineur SANS ambiguite ou un age.
const NU_FAIBLE_UNICODE: string[] = ['*洗澡*', '*淋浴*', '*お風呂*', '*入浴*', '*シャワー*', '*목욕*', '*샤워*', '*استحمام*', 'नहा*',
  'душ', 'душе', 'в ванне', 'купа*'];
// Violence exercee sur un enfant (plancher, mineur sans ambiguite ou age).
const VIOLENCE_UNICODE: string[] = ['*虐待*', '*殴打*', '*毆打*', '*학대*', '*폭행*', '*تعذيب*', 'शोषण*', 'मारपीट*', 'избиени*',
  'насили*', 'истязан*'];

// Dans une serie de lettres isolees ("c h i l d n u d e") on ne sait pas ou finissent les mots : on cherche
// un mineur ET une nudite comme sous-chaines de la serie (une serie de 6 lettres isolees est tres rare).
const SERIE_MINEURS: string[] = ['kind', 'child', 'kid', 'girl', 'boy', 'teen', 'baby', 'infant', 'toddler', 'schoolgirl', 'young', 'preteen',
  'minor', 'enfant', 'fille', 'garcon', 'nino', 'nina', 'kinder', 'madchen', 'bambin', 'crianca', 'menina', 'menino'];
const SERIE_NUDITE: string[] = ['nude', 'naked', 'topless', 'undress', 'sexy', 'porn', 'bikini', 'lingerie', 'panties', 'underwear',
  'nsfw', 'erotic', 'sensual', 'seductive', 'shirtless', 'desnud', 'nackt', 'nuda', 'nudo', 'nua', 'sexual', 'withoutclothes', 'noclothes',
  'wearingnothing'];

// Mots COLLES (2026-10-13, M2) : un mineur et une nudite dans UN SEUL mot, l'un juste apres l'autre (« childnaked »,
// « nakedchild », « kidnude », « ChildNaked »). CLIP decoupe ces mots exactement a la frontiere (child|naked) : le modele lit
// les deux. Les nudites COURTES (« nu », « sex »...) seulement au bord du mot (« enfantnu », mais pas « babynurse »).
const COLLE_MINEURS: string[] = ['child', 'children', 'childs', 'kid', 'kids', 'kiddie', 'kiddy', 'baby', 'babies', 'toddler',
  'toddlers', 'infant', 'infants', 'preteen', 'preteens', 'teen', 'teens', 'teenage', 'teenager', 'schoolgirl', 'schoolgirls',
  'schoolboy', 'schoolboys', 'girl', 'girls', 'boy', 'boys', 'littlegirl', 'littleboy', 'younggirl', 'youngboy', 'loli', 'shota',
  'underage', 'minor', 'minors', 'enfant', 'enfants', 'fillette', 'fillettes', 'gamin', 'gamine', 'bebe', 'bebes', 'nino', 'nina',
  'ninos', 'ninas', 'nene', 'nena', 'kinder', 'kind', 'madchen', 'maedchen', 'bambino', 'bambina', 'bambini', 'bambine', 'bimba',
  'garcon', 'garcons', 'garconnet', 'fille', 'filles',
  'crianca', 'criancas', 'menina', 'menino', 'meninas', 'meninos', 'ragazzina', 'ragazzino', 'cocuk', 'dziecko'];
const COLLE_NUDITE: string[] = ['naked', 'nude', 'nudes', 'nudity', 'nackt', 'nackte', 'nackter', 'nacktes', 'nackten', 'desnudo',
  'desnuda', 'desnudos', 'desnudas', 'topless', 'bottomless', 'undressed', 'undressing', 'undress', 'lingerie', 'panties', 'bikini',
  'porn', 'porno', 'sexy', 'sexual', 'erotic', 'erotica', 'hentai', 'nsfw', 'nipple', 'nipples', 'genitals', 'vagina', 'penis',
  'pussy', 'blowjob', 'handjob', 'footjob', 'fellatio', 'cunnilingus', 'semen', 'sperm', 'orgasm', 'masturbating', 'masturbation',
  'molested', 'raped', 'ciplak', 'naakt', 'pelada', 'pelado', 'pelados', 'seminua', 'seminude', 'nudo', 'nuda', 'nudi'];
const COLLE_NUDITE_BORD: string[] = ['nu', 'nue', 'nus', 'nues', 'nua', 'nuas', 'sex'];
const _ALT_M = '(?:' + COLLE_MINEURS.join('|') + ')';
const _ALT_N = '(?:' + COLLE_NUDITE.join('|') + ')';
const _ALT_B = '(?:' + COLLE_NUDITE_BORD.join('|') + ')';
const _RE_COLLE = new RegExp(_ALT_M + _ALT_N + '|' + _ALT_N + _ALT_M + '|' + _ALT_M + _ALT_B + '$|^' + _ALT_B + _ALT_M);

/** Un mot de la vue contient un mineur et une nudite colles (et n'est pas lui-meme un terme connu : ce cas passe ailleurs). */
function _colle(vue: string): boolean {
  for (const jeton of vue.split(' ')) if (jeton.length >= 5 && _RE_COLLE.test(jeton)) return true;
  return false;
}

// ── Ages (plancher) ────────────────────────────────────────────────────────
const _NOMBRES_LETTRES: string[] = [
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen',
  'fifteen', 'sixteen', 'seventeen',
  'un', 'une', 'deux', 'trois', 'quatre', 'cinq', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze',
  'seize', 'dix sept',
  'uno', 'una', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce',
  'quince', 'dieciseis', 'diecisiete', 'diez y seis', 'diez y siete',
  'ein', 'eine', 'eins', 'zwei', 'drei', 'vier', 'funf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwolf', 'dreizehn',
  'vierzehn', 'funfzehn', 'sechzehn', 'siebzehn', 'fuenf', 'zwoelf', 'fuenfzehn',
  'um', 'uma', 'dois', 'duas', 'sete', 'oito', 'dez', 'doze', 'treze', 'catorze', 'dezesseis', 'dezasseis', 'dezessete', 'dezassete',
  'due', 'tre', 'quattro', 'cinque', 'sei', 'sette', 'otto', 'dieci', 'undici', 'dodici', 'tredici', 'quattordici', 'quindici',
  'sedici', 'diciassette',
];
// Nombres en lettres qui sont AUSSI des mots courants (« aged elf », « age um bikini », « ages due ») : lus comme un age
// seulement devant une unite (« elf Jahre alt »), jamais apres un simple « aged » / « age of » (2026-10-13, MODERATION-05).
const NOMBRES_AMBIGUS: string[] = ['elf', 'um', 'uma', 'un', 'une', 'uno', 'una', 'ein', 'eine', 'eins', 'one', 'tre', 'tres', 'sei',
  'due', 'dos', 'once', 'neuf', 'sept', 'otto'];
// Ce qui suit un nombre et en fait un GRAND nombre (« aged ten thousand years », « aged 10 000 years ») : pas un age < 18.
const GRANDS_NOMBRES: string[] = ['[0-9]', 'thousands?', 'hundreds?', 'millions?', 'billions?', 'dozens?', 'mille', 'milles', 'cents?',
  'milliers?', 'milliards?', 'mil', 'miles', 'millones', 'millon', 'tausend', 'hundert', 'millionen', 'milliarden', 'mila', 'cento',
  'centinaia', 'milioni', 'centenas?', 'centenares', 'milhares', 'milhoes', 'milhao'];
const UNITES_AGE: string[] = ['yo', 'y o', 'yr old', 'yrs old', 'yr o', 'years? old', 'year olds?', 'yearold', 'yrold', 'years? of age',
  'yrs? of age', 'years? young', 'yrs? young', 'months? old', 'jahre alt', 'jahrig[a-z]*', 'j alt', 'monate alt', 'yasinda[a-z]*',
  'jaar oud', 'jarig[a-z]*', 'letni[a-z]*', 'lat', 'tahun', 'tuoi'];
// « ans », « anos », « anni », « mois » : age, SAUF suivis de « de <nom> » (« dix ans de guerre ») — « de edad », « de idade »,
// « d age », « di eta » restent un age.
const UNITES_AGE_ROMANES: string[] = ['ans', 'anos', 'anni', 'mois', 'meses', 'mesi'];
const COMPLEMENTS_DE: string[] = ['de', 'd', 'du', 'des', 'del', 'di', 'da', 'do', 'della', 'dei', 'dos', 'das'];
const MOTS_AGE: string[] = ['edad', 'idade', 'age', 'eta'];
const PREFIXES_AGE: string[] = ['aged?', 'age of', 'ages', 'age de', 'agee de', 'agee', 'edad de', 'edad', 'alter von', 'alter', 'eta di',
  'idade de', 'idade', 'just turned'];
// Allemand compose : « zehnjaehrig », « elfjaehrige » (le nombre colle a l'unite).
const NOMBRES_COMPOSES_DE: string[] = ['ein', 'zwei', 'drei', 'vier', 'funf', 'fuenf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf',
  'zwolf', 'zwoelf', 'dreizehn', 'vierzehn', 'funfzehn', 'fuenfzehn', 'sechzehn', 'siebzehn'];
// « born in 2018 », « ne en 2015 » : mineur si l'annee est a moins de 18 ans de l'annee en cours.
const PREFIXES_NAISSANCE: string[] = ['born', 'born in', 'ne en', 'nee en', 'nacido en', 'nacida en', 'geboren', 'geboren im jahr',
  'nato nel', 'nata nel', 'nascido em', 'nascida em'];
// Ecritures non latines (vue Unicode) : unites apres un nombre (ecrites sous leur forme normalisee : ة -> ه, sans ё ni й),
// et prefixes (« عمرها 10 »).
const UNITES_AGE_UNICODE: string[] = ['岁', '歲', '歳', '才', '살(?:의|짜리)?(?![가-힣])', '세(?:의|짜리)?(?![가-힣])', 'лет', 'года',
  'годик', 'летн', 'годовал', 'років', 'роки', 'річн', 'سنوات', 'سنه', 'سنين', 'عام', 'اعوام', 'साल', 'वर्ष'];
const PREFIXES_AGE_UNICODE: string[] = ['عمره', 'عمرها', 'بعمر', 'उम्र'];

const _alt = (l: string[]) => '(?:' + l.join('|') + ')';
const _parLongueur = (l: string[]) => Array.from(new Set(l)).sort((a, b) => b.length - a.length);
const _NB_LETTRES = '(?<![a-z])' + _alt(_parLongueur(_NOMBRES_LETTRES).map(_echapper)) + '(?![a-z])';
const _NB_LETTRES_SURS = '(?<![a-z])' + _alt(_parLongueur(_NOMBRES_LETTRES.filter((x) => !NOMBRES_AMBIGUS.includes(x))).map(_echapper))
  + '(?![a-z])';
const _NB_CHIFFRES = '(?<![0-9])(?:1[0-7]|0?[0-9])(?![0-9])';
const _PAS_GRAND = '(?! ?' + _alt(GRANDS_NOMBRES) + '(?![a-z]))';
const _NB = '(?:' + _NB_CHIFFRES + '|' + _NB_LETTRES + ')' + _PAS_GRAND;
const _NB_APRES_PREFIXE = '(?:' + _NB_CHIFFRES + '|' + _NB_LETTRES_SURS + ')' + _PAS_GRAND;
const _UNITE_ROMANE = _alt(UNITES_AGE_ROMANES) + '(?![a-z])(?! ' + _alt(COMPLEMENTS_DE) + ' (?!' + _alt(MOTS_AGE) + '(?![a-z]))[a-z])';
const _UNITE = '(?:' + _alt(UNITES_AGE) + '(?![a-z])|' + _UNITE_ROMANE + ')';
const _RE_AGE = new RegExp('(?:^| )' + _NB + ' ?' + _UNITE + '|(?:^| )' + _alt(PREFIXES_AGE) + ' ?' + _NB_APRES_PREFIXE + '(?![a-z0-9])'
  + '|(?:^| )' + _alt(NOMBRES_COMPOSES_DE) + 'jahrig');
const _RE_NAISSANCE = new RegExp('(?:^| )' + _alt(_parLongueur(PREFIXES_NAISSANCE)) + ' ((?:19|20)[0-9][0-9])(?![0-9])', 'g');
const _NB_CHIFFRES_U = '(?<![0-9])(?:1[0-7]|0?[0-9])(?! ?[0-9])';
const _NB_HAN = '(?<![一二三四五六七八九十百千两兩])(?:十[一二三四五六七]?|[一二三四五六七八九两兩])';
const _RE_AGE_UNICODE = new RegExp(_NB_CHIFFRES_U + ' ?' + _alt(UNITES_AGE_UNICODE) + '|' + _NB_HAN + '(?:岁|歲|歳|才)|'
  + _alt(PREFIXES_AGE_UNICODE) + ' ?' + _NB_CHIFFRES_U);

/** « born in 2018 » : vrai si l'annee de naissance est a moins de 18 ans de l'annee en cours (horloge UTC). */
function _ageParNaissance(vue: string): boolean {
  const an = new Date().getUTCFullYear();
  for (const m of vue.matchAll(_RE_NAISSANCE)) {
    const y = Number(m[1]);
    if (y > an - 18 && y <= an) return true;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// FILTRE GENERAL — listes
// ═══════════════════════════════════════════════════════════════════════════

// Explicite : bloque seul (toujours teste sur la version normalisee aussi).
const GENERAL_SEXUEL_DUR: string[] = [
  '*nude*', 'nudity', '*naked*', '*nsfw*', 'porn*', 'xxx', 'sex', 'sexual*', 'sexually', 'sexe', 'sexuel*', 'sexo', 'sesso', 'sessuale',
  'erotic*', 'erotique*', '*hentai*', 'lewd', '*topless*', 'bottomless', 'lingerie', 'bikini*', 'underwear', 'undress*', 'stripper*',
  'striptease', 'orgasm*', 'fetish', 'bdsm', 'bondage', 'prostitut*', 'brothel*', 'genital*', 'penis', 'vagina', 'nipple*',
  'buttock*', 'anus', 'anal', 'oral sex', 'fellat*', 'cunniling*', 'masturb*', 'ejaculat*', 'cum shot', 'creampie', 'gangbang',
  'threesome', 'orgy', 'sextoy', 'dildo', 'vibrator', 'furry nsfw', 'rule34', 'rule 34', 'ahegao', 'ecchi', 'yaoi',
  'seins', 'couille*', 'chatte', 'nichon*', 'enculer', 'foutre', 'salope', 'pute', 'putain',
  'sodomie', 'fellation', 'cunnilingus', 'orgasme', 'underage',
  'dick', 'cock', 'pussy', 'ass', 'tits', 'boobs', 'cum', 'slut', 'whore', 'breasts',
  // phrases de nudite et autres langues (IA-02)
  'wearing nothing', 'wears nothing', 'full frontal', 'birthday suit', 'in the nude', 'unclad', 'bare chest*', 'bare breast*',
  'only body paint', 'scantily clad', 'barely clothed',
  '*desnud*', '*nackt*', 'nudo', 'nuda', 'nudi', 'nudita', 'seminu', 'seminus', 'seminua', 'seminuas', 'seminude*', 'seminudo*',
  'seminuda*', 'seminudi', 'denud*', 'deshabill*',
  '*pornograf*', '*pornograph*', 'erotisch*', 'sinnlich*', 'senos', 'titten', 'tetas', 'tette', 'spogliat', 'spogliata', 'spogliato', 'spogliati',
  'spogliate', 'spogliarsi', 'spogliarell*', 'svestit*',
  // 2026-10-13 (M1, MODERATION-01) : actes et anatomie explicites, nudite d'autres langues
  'blowjob*', 'blow job*', 'handjob*', 'hand job*', 'footjob*', 'foot job*', 'titjob*', 'titfuck*', 'rimjob*', 'anilingus',
  'intercourse', 'coitus', 'copulat*', 'sodomy', 'sodomiz*', 'sodomis*', 'semen', 'sperm', 'cumshot*', 'bukkake', 'gang bang*',
  'foursome*', 'bestiality', 'zoophil*', 'necrophil*', 'incest*', 'fisting', 'butt plug*', 'buttplug*', 'vulva*', 'labia',
  'clitor*', 'clit', 'clits', 'areola*', 'scrotum*', 'testicle*', 'phallus*', 'pubic hair', 'pubes', 'private parts',
  'intimate parts', 'molest*', 'raped', 'raping', 'rapist*', 'rape scene*', 'striptease*', 'strip tease*', 'strip club*',
  'lap dance*', 'making love', 'make love', 'kama sutra', 'doggy style', 'doggystyle', 'missionary position', 'camel toe',
  'nip slip', 'skinny dipping', 'in the buff', 'nudis*', 'milf*', 'futanari', 'shemale*', 'dominatrix', 'ball gag*', 'ballgag*',
  'panties', 'touching himself', 'touching herself', 'lifting her skirt', 'upskirt',
  'sous vetement*', 'en petite tenue', 'devetu*', 'tenue d eve', 'plus simple appareil', 'sans rien sur le dos', 'partouze*',
  'calzon*', 'en pelotas', 'sin nada puesto', 'follar', 'follando', 'unterhose*', 'schlupfer*', 'reizwasche', 'entblosst*',
  'barbusig*', 'nackig*', 'fkk', 'geschlechtsverkehr', 'vergewaltig*', 'ficken', 'gefickt', 'pelad*', 'despid*', 'estupr*',
  'mutand*', 'perizoma', 'senza niente addosso', 'nudin*',
  '*ciplak*', 'soyunmus', 'tecavuz*', 'mustehcen*', 'naakt*', 'ontkleed*', 'nagie', 'rozebran*', 'telanjang', 'bugil',
  'pemerkosa*', 'khoa than', 'khieu dam', 'hiep dam',
];
// Ambigu, SEXUEL : bloque seulement avec un terme sexuel explicite ou un contexte sexuel faible.
const GENERAL_CTX_SEXUEL: string[] = [
  'strip', 'breast', 'poitrine', 'bite', 'queue', 'baiser', 'jouir', 'dominat*', 'submissi*', 'sadis*', 'masoch*', 'escort', 'yuri',
  'tied up', 'chained', 'whipped', 'on knees', 'bent over',
  // 2026-10-13 : double sens (« erection » d'une tour, « penetrating » une armure)
  'erection*', 'erect', 'boner*', 'penetrat*', 'spread legs',
];
const CONTEXTE_SEXUEL_FAIBLE: string[] = ['sexy', 'sensual*', 'seductive', 'provocative', 'suggestive', 'busty', 'kinky', 'big breast*',
  'large breast*', 'huge breast*', 'her breast*'];
// Ambigu, VIOLENCE / drogue / jeu : bloque seulement avec un enfant, un terme sexuel explicite ou un terme du plancher.
const GENERAL_CTX_VIOLENCE: string[] = [
  'blood', 'bloody', 'bleed*', 'murder*', 'kill*', 'torture*', 'torturer', 'cannibal*', 'flesh', 'corpse*', 'cadaver*', 'dead body',
  'death scene', 'execution', 'hanging', 'strangul*', 'suffocate', 'drown*', 'stab', 'stabs', 'stabbed', 'stabbing', 'stabber*',
  'slash*', 'wound*', 'injury', 'brutal*',
  'savage*', 'slaughter*', 'meurtre*', 'tuer', 'mort', 'cadavre*', 'sang', 'sanglant*', 'violence', 'violent*', 'cruaut*',
  'drug', 'drugs', 'crack', 'snort', 'overdose', 'drogue*', 'stupefi*', 'bomb', 'bombing', 'isis', 'jump off',
];
// Bloques seuls, par famille.
const GENERAL_VIOLENCE_DUR: string[] = [
  'gore', 'gory', 'dismember*', 'decapitat*', 'mutilat*', 'eviscerat*', 'disembowel*', 'snuff', 'graphic violence', 'massacre*',
  'bloodbath', 'carnage',
];
// 2026-10-13 (MODERATION-05) : « heroine » retire (heroine de jeu, et l'anglais issu de la traduction de « heroine »).
const GENERAL_DROGUE_DUR: string[] = [
  'cocaine', 'heroin', 'fentanyl', 'methamphet*', 'meth', 'opium', 'inject drug*', 'crack cocaine',
];
const GENERAL_EXTREMISME_DUR: string[] = [
  'terrorist*', 'terrorism', 'terroris*', 'mass shooting', 'genocide', 'ethnic cleansing', 'hate crime', 'white supremac*', 'nazi',
  'nazis', 'swastika', 'al qaeda', 'jihad', 'radicali*', 'extremis*', 'attentat*', 'daesh', 'isis flag', 'isis fighter',
  'isis militant', 'isis terrorist',
];
const GENERAL_AUTOBLESSURE_DUR: string[] = ['suicide', 'self harm', 'cut myself', 'slit wrist*', 'hang myself'];
const GENERAL_HAINE_DUR: string[] = [
  'racial slur', 'nigger*', 'faggot*', 'retard', 'retards', 'retarded', 'kike', 'kikes', 'spic', 'spics', 'chink', 'chinks', 'wetback*',
  'hate speech',
];
const GENERAL_ARMES_DUR: string[] = ['how to make bomb', 'how to make gun', 'weapon tutorial', 'build explosive', 'poison recipe'];

// Combinaisons du filtre general.
const PERSONNES: string[] = ['woman', 'man', 'person', 'girl', 'boy', 'female', 'male', 'lady', 'femme', 'homme', 'mujer', 'hombre',
  'persona', 'frau', 'mann', 'donna', 'uomo', 'mulher', 'homem'];
const NUDITE_EXTREME: string[] = ['without clothes', 'no clothes', 'without clothing', 'no clothing', 'unclothed', 'fully exposed',
  'spread legs', 'spanked', 'sans vetement*', 'sans habit*', 'sin ropa', 'ohne kleidung', 'ohne kleider', 'senza vestiti',
  'sem roupa*'];
const VIOLENCE_ENFANT_GENERAL: string[] = ['hurt', 'hit', 'beat', 'punch', 'slap', 'abuse', 'attack', 'weapon', 'knife', 'gun',
  'shoot', 'bleed', 'cry', 'scream', 'pain', 'suffer', 'frapper', 'battre', 'blesser'];

// ── Compilation (une fois par isolat) ──────────────────────────────────────
const T_MINEURS_FORT = _compiler(MINEURS_FORT, 'plancher');
const T_MINEURS_AMBIGUS = _compiler(MINEURS_AMBIGUS, 'plancher');
const T_MINEURS_INDICES = _compiler(MINEURS_INDICES, 'plancher');
const T_MINEURS_VIOLENCE = _compiler(MINEURS_VIOLENCE, 'mineur_violence');
const T_NU_FORT = _compiler(NU_FORT, 'plancher');
const T_NU_EXACTS = _compiler(NU_EXACTS, 'plancher');
const T_NU_MOYEN = _compiler(NU_MOYEN, 'plancher');
const T_NU_FAIBLE_PLANCHER = _compiler(NU_FAIBLE_PLANCHER, 'plancher');
const T_NU_FAIBLE_GENERAL = _compiler(NU_FAIBLE_GENERAL, 'mineur_violence');
const T_SEXE_MINEUR_FORT = _compiler(SEXE_MINEUR_FORT, 'plancher');
const T_VIOLENCE_ENFANT_PLANCHER = _compiler(VIOLENCE_ENFANT_PLANCHER, 'plancher');
const T_PLANCHER_MOTS = _compiler(PLANCHER_MOTS, 'plancher');
const T_PLANCHER_UNICODE = _compilerUnicode(PLANCHER_UNICODE, 'plancher');
const T_MINEURS_FORT_UNICODE = _compilerUnicode(MINEURS_FORT_UNICODE, 'plancher');
const T_MINEURS_AMBIGUS_UNICODE = _compilerUnicode(MINEURS_AMBIGUS_UNICODE, 'plancher');
const T_NU_FORT_UNICODE = _compilerUnicode(NU_FORT_UNICODE, 'plancher');
const T_NU_SUGGESTIF_UNICODE = _compilerUnicode(NU_SUGGESTIF_UNICODE, 'plancher');
const T_NU_MOYEN_UNICODE = _compilerUnicode(NU_MOYEN_UNICODE, 'plancher');
const T_NU_FAIBLE_UNICODE = _compilerUnicode(NU_FAIBLE_UNICODE, 'plancher');
const T_VIOLENCE_UNICODE = _compilerUnicode(VIOLENCE_UNICODE, 'plancher');
const T_SEXUEL_DUR = _compiler(GENERAL_SEXUEL_DUR, 'sexuel');
const T_SEXUEL_EXACTS = _compiler(NU_EXACTS, 'sexuel');
const T_SEXUEL_UNICODE = _compilerUnicode(NU_FORT_UNICODE, 'sexuel');
const T_CTX_SEXUEL = _compiler(GENERAL_CTX_SEXUEL, 'contexte');
const T_CTX_SEXUEL_FAIBLE = _compiler(CONTEXTE_SEXUEL_FAIBLE, 'contexte');
const T_CTX_VIOLENCE = _compiler(GENERAL_CTX_VIOLENCE, 'contexte');
const T_DURS_AUTRES: Liste = _fusionner(
  _compiler(GENERAL_VIOLENCE_DUR, 'violence'), _compiler(GENERAL_DROGUE_DUR, 'drogue'),
  _compiler(GENERAL_EXTREMISME_DUR, 'extremisme'), _compiler(GENERAL_AUTOBLESSURE_DUR, 'autoblessure'),
  _compiler(GENERAL_HAINE_DUR, 'haine'), _compiler(GENERAL_ARMES_DUR, 'armes'),
);
const T_PERSONNES = _compiler(PERSONNES, 'combinaison');
const T_NUDITE_EXTREME = _compiler(NUDITE_EXTREME, 'combinaison');
const T_VIOLENCE_ENFANT_GENERAL = _compiler(VIOLENCE_ENFANT_GENERAL, 'mineur_violence');
const _PLANCHER_COLLES_ECRASES = PLANCHER_COLLES.map((s) => s.replace(/([a-z])\1+/g, '$1'));

/** Liste a plat des termes DURS du filtre (pour l'affichage cote bureau, `get-nsfw-keywords` : fenetre « New project », grille des projets).
 *  Essais reels du 2026-10-03 : les termes de CONTEXTE (GENERAL_CTX_SEXUEL / GENERAL_CTX_VIOLENCE : blood, kill, wound, strip...) y figuraient aussi
 *  et le bureau les testait en mots entiers SANS contexte : « An orc warrior covered in blood » etait refuse a la creation du projet alors que la
 *  generation (checkPromptSafety) l'accepte. Ces termes ne bloquent qu'en contexte : ils ne font pas partie de la liste a plat. */
export const NSFW_KEYWORDS: string[] = Array.from(new Set([
  ...GENERAL_SEXUEL_DUR, ...NU_EXACTS, ...GENERAL_VIOLENCE_DUR, ...GENERAL_DROGUE_DUR, ...GENERAL_EXTREMISME_DUR,
  ...GENERAL_AUTOBLESSURE_DUR, ...GENERAL_HAINE_DUR, ...GENERAL_ARMES_DUR,
].map(_noyauSource)));

// ═══════════════════════════════════════════════════════════════════════════
// PLANCHER ILLICITE
// ═══════════════════════════════════════════════════════════════════════════

const _MSG_PLANCHER = 'Blocked: this content is illegal and cannot be generated under any setting.';
const _MSG_PLANCHER_MINEUR = 'Blocked: depicting minors in this context is illegal and cannot be generated under any setting.';

/** Conseil ajoute aux refus du filtre general (le bureau le remplace par son propre libelle). */
const _CONSEIL_REFUS = 'Modify your prompt or contact support to request unrestricted access.';

// HARD FLOOR — contenu illicite (mineurs) qu'AUCUN reglage, `unrestricted` compris, ne peut lever.
// Evalue AVANT le court-circuit `unrestricted`. Plus strict que le filtre general sur les formes
// (normalisation, ages, six langues), mais sans vocabulaire de jeu video ("kid friendly", "young hero",
// "teen titans style" passent).
export function checkHardFloor(prompt: string | null | undefined): PromptSafetyResult {
  const v = _vuesPlancher(prompt);
  const vues = [v.chiffres, v.leetI, v.leetL];
  const uni = [v.unicode];
  const bloquer = (blocked: string, reason: string): PromptSafetyResult =>
    ({ safe: false, blocked, reason, categorie: 'plancher', hardFloor: true });

  // 1. Termes illicites en soi.
  const u = _chercher(uni, T_PLANCHER_UNICODE);
  if (u) return bloquer(_nom(u), _MSG_PLANCHER);
  const mot = _chercher(vues, T_PLANCHER_MOTS);
  if (mot) return bloquer(_nom(mot), _MSG_PLANCHER);
  for (let i = 0; i < PLANCHER_COLLES.length; i++) {
    if (v.collees.some((c) => c.includes(_PLANCHER_COLLES_ECRASES[i]))) return bloquer(PLANCHER_COLLES[i], _MSG_PLANCHER);
  }

  for (const serie of v.series) {
    if (SERIE_MINEURS.some((x) => serie.includes(x)) && SERIE_NUDITE.some((x) => serie.includes(x))) {
      return bloquer('minor-safety', _MSG_PLANCHER_MINEUR);
    }
  }
  // 1b. Mineur et nudite COLLES dans un meme mot (« childnaked ») : CLIP les lit comme deux mots (M2).
  if (vues.some(_colle) || v.nonEcrasees.some(_colle)) return bloquer('minor-safety', _MSG_PLANCHER_MINEUR);

  // 2. Mineur x nudite / sexe, mineur x violence exercee sur lui.
  const mineurFort = _chercher(vues, T_MINEURS_FORT) || _chercher(uni, T_MINEURS_FORT_UNICODE);
  const age = vues.some((x) => _RE_AGE.test(x) || _ageParNaissance(x)) || _RE_AGE_UNICODE.test(v.unicode);
  const mineurAmbigu = _chercher(vues, T_MINEURS_AMBIGUS) || _chercher(uni, T_MINEURS_AMBIGUS_UNICODE);
  const indice = _chercher(vues, T_MINEURS_INDICES);
  if (mineurFort || age || mineurAmbigu || indice) {
    const explicite = _chercher(vues, T_NU_FORT) || _chercher([v.exacte], T_NU_EXACTS) || _chercher(uni, T_NU_FORT_UNICODE)
      || _chercher(uni, T_NU_SUGGESTIF_UNICODE);
    if (explicite) return bloquer('minor-safety', _MSG_PLANCHER_MINEUR);
    if (mineurFort || age || mineurAmbigu) {
      if (_chercher(vues, T_NU_MOYEN) || _chercher(uni, T_NU_MOYEN_UNICODE)) return bloquer('minor-safety', _MSG_PLANCHER_MINEUR);
    }
    if (mineurFort || age) {
      if (_chercher(vues, T_SEXE_MINEUR_FORT)) return bloquer('minor-safety', _MSG_PLANCHER_MINEUR);
      if (_chercher(vues, T_NU_FAIBLE_PLANCHER) || _chercher(uni, T_NU_FAIBLE_UNICODE)) return bloquer('minor-safety', _MSG_PLANCHER_MINEUR);
      if (_chercher(vues, T_VIOLENCE_ENFANT_PLANCHER) || _chercher(uni, T_VIOLENCE_UNICODE)) return bloquer('minor-safety', _MSG_PLANCHER_MINEUR);
    }
  }
  return { safe: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// FILTRE GENERAL
// ═══════════════════════════════════════════════════════════════════════════

export function checkPromptSafety(
  prompt: string | null | undefined,
  unrestricted = false,
): PromptSafetyResult {
  const floor = checkHardFloor(prompt);
  if (!floor.safe) return floor;            // plancher illicite — jamais contournable
  if (unrestricted) return { safe: true };  // `unrestricted` ne leve que les filtres SOUPLES

  const base = _base(prompt);
  const souple = _simple(_sansExpressionsSures(base));   // texte tel quel (sans translitteration)
  const v = _vuesPlancher(prompt);
  const toutes = [souple, v.chiffres, v.leetI, v.leetL]; // l'explicite est teste sur les formes deguisees aussi
  const refus = (t: Terme): PromptSafetyResult => ({
    safe: false, blocked: _nom(t), categorie: t.cat,
    reason: `Content filter: "${_nom(t)}" is blocked. ${_CONSEIL_REFUS}`,
  });

  // 1. Termes explicites (sexe, nudite) : mots entiers, y compris deguises ("n u d e", "nud3", cyrillique), mots courts sur la
  //    vue exacte, autres ecritures sur la vue Unicode.
  const sexuel = _chercher(toutes, T_SEXUEL_DUR) || _chercher([v.exacte], T_SEXUEL_EXACTS) || _chercher([v.unicode], T_SEXUEL_UNICODE);
  if (sexuel) return refus(sexuel);
  // 2. Autres familles bloquees seules (gore explicite, drogues dures, terrorisme, haine, auto-agression, armes).
  const autre = _chercher([souple], T_DURS_AUTRES);
  if (autre) return refus(autre);

  // 3. Termes AMBIGUS (vocabulaire de jeu) : seulement en contexte.
  const ctxSexuel = _chercher([souple], T_CTX_SEXUEL);
  if (ctxSexuel && _chercher(toutes, T_CTX_SEXUEL_FAIBLE)) return refus(ctxSexuel);
  const ctxViolence = _chercher([souple], T_CTX_VIOLENCE);
  if (ctxViolence && _chercher([souple], T_MINEURS_VIOLENCE)) return refus(ctxViolence);

  // 4. Combinaisons.
  // 4a. mineur sans ambiguite x vocabulaire de chambre (le plancher a deja traite le reste)
  const mineur = _chercher([souple, ...toutes], T_MINEURS_FORT);
  if (mineur) {
    const b = _chercher([souple], T_NU_FAIBLE_GENERAL);
    if (b) return { safe: false, blocked: `${_nom(mineur)} + ${_nom(b)}`, categorie: 'combinaison',
      reason: `Content filter: combination "${_nom(mineur)}" + "${_nom(b)}" is blocked. This type of content is not allowed.` };
  }
  // 4b. personne x nudite explicite par periphrase
  const a2 = _chercher([souple], T_PERSONNES);
  const b2 = a2 ? _chercher([souple], T_NUDITE_EXTREME) : null;
  if (a2 && b2) return { safe: false, blocked: `${_nom(a2)} + ${_nom(b2)}`, categorie: 'combinaison',
    reason: `Content filter: combination "${_nom(a2)}" + "${_nom(b2)}" is blocked. This type of content is not allowed.` };
  // 4c. enfant x violence
  const a3 = _chercher([souple], T_MINEURS_VIOLENCE);
  const b3 = a3 ? _chercher([souple], T_VIOLENCE_ENFANT_GENERAL) : null;
  if (a3 && b3) return { safe: false, blocked: `${_nom(a3)} + ${_nom(b3)}`, categorie: 'mineur_violence',
    reason: `Content filter: combination "${_nom(a3)}" + "${_nom(b3)}" is blocked. This type of content is not allowed.` };

  return { safe: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// LONGUEUR ET SYNTAXE DU TEXTE ENVOYE AU GENERATEUR (2026-10-13 : MODERATION-07, SERVEUR-09)
// ═══════════════════════════════════════════════════════════════════════════
//
// Mesures du 11/10 : un prompt de 1 000 000 de caracteres traversait le worker (facture 6 credits) ; cote Modal, l'epuration
// de fin de demande et le lecteur de poids sont quadratiques (32 000 blancs = 12,6 s, 32 000 « (a » = 19 s) sous le verrou GPU ;
// « <|endoftext|> » etait lu comme le VRAI jeton de fin ; « (x:99999) » donnait un poids infini, « (x:-5) » un poids negatif.

/** Description de l'utilisateur (texte brut). */
export const PROMPT_MAX_CARACTERES = 2000;
/** Prompt complet (gabarits compris) et textes d'outils. */
export const PROMPT_MAX_ENRICHI = 4000;
/** Bornes des poids « (mot:1.4) » : les gabarits du produit vont de 1,2 a 1,8. */
export const POIDS_PROMPT_MIN = 0.5;
export const POIDS_PROMPT_MAX = 2;

/** Longueur PONDEREE : un caractere de l'alphabet latin (jusqu'a U+024F) compte 1, tout autre 3 (CLIP decoupe ces ecritures
 *  en 2 a 3 jetons : 5 000 ideogrammes = 15 000 jetons). Les caracteres effaces ne comptent pas. */
export function longueurPonderee(texte: unknown): number {
  const s = (typeof texte === 'string' ? texte : String(texte == null ? '' : texte)).replace(_EFFACES, '');
  let n = 0;
  for (const c of s) n += (c.codePointAt(0) as number) <= 0x24f ? 1 : 3;
  return n;
}

/** Refuse un texte plus long que `max` (longueur ponderee). Meme contrat que checkPromptSafety ; categorie « longueur ». */
export function controlerLongueurPrompt(texte: unknown, max: number = PROMPT_MAX_CARACTERES): PromptSafetyResult {
  const brut = typeof texte === 'string' ? texte : String(texte == null ? '' : texte);
  const n = brut.length > max * 8 ? brut.length : longueurPonderee(brut);
  if (n <= max) return { safe: true };
  return {
    safe: false, blocked: 'length', categorie: 'longueur',
    reason: `Prompt too long (${n} / ${max}): please shorten your description. Characters outside the Latin alphabet count as 3.`,
  };
}

const _RE_POIDS = /:\s*([+-]?[0-9.]*)\s*\)/g;
const _RE_NOMBRE = /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/;

/** Texte tel qu'il part au generateur : caracteres effaces retires (\t \n \r -> espace), jetons speciaux du tokenizer
 *  (« <|endoftext|> », « <|startoftext|> ») casses, poids A1111 « (mot:x) » ramenes dans [POIDS_PROMPT_MIN, POIDS_PROMPT_MAX]
 *  (un poids mal forme est retire). Un poids deja dans les bornes est laisse tel quel, a l'octet pres. */
export function neutraliserSyntaxePrompt(texte: unknown): string {
  const s = (typeof texte === 'string' ? texte : String(texte == null ? '' : texte))
    .replace(/[\t\n\r]/g, ' ').replace(_EFFACES, '')
    .replace(/<\s*\|/g, ' ').replace(/\|\s*>/g, ' ');
  return s.replace(_RE_POIDS, (m: string, nb: string) => {
    const v = _RE_NOMBRE.test(nb) ? Number(nb) : NaN;
    if (!Number.isFinite(v)) return ')';
    if (v < POIDS_PROMPT_MIN) return ':' + POIDS_PROMPT_MIN + ')';
    if (v > POIDS_PROMPT_MAX) return ':' + POIDS_PROMPT_MAX + ')';
    return m;
  });
}
