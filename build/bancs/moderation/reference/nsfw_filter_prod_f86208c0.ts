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
  | 'contexte';           // terme ambigu declenche par son contexte

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
// NORMALISATION (constat IA-02)
// ═══════════════════════════════════════════════════════════════════════════

const _MARQUES = /[\u0300-\u036f]/g;
const _INVISIBLES = /[\u00ad\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g;

// Lettres latines sans decomposition Unicode.
const _LATIN_SPECIAUX: Record<string, string> = {
  '\u00df': 'ss', '\u00f8': 'o', '\u00e6': 'ae', '\u0153': 'oe', '\u0111': 'd',
  '\u0142': 'l', '\u0131': 'i', '\u0251': 'a', '\u0261': 'g',
};

// Lettres cyrilliques / grecques qui ressemblent a une lettre latine.
const _HOMOGLYPHES: Record<string, string> = {
  // cyrillique
  '\u0430': 'a', '\u0432': 'b', '\u0435': 'e', '\u043a': 'k', '\u043c': 'm',
  '\u043d': 'h', '\u043e': 'o', '\u0440': 'p', '\u0441': 'c', '\u0442': 't',
  '\u0443': 'y', '\u0445': 'x', '\u0455': 's', '\u0456': 'i', '\u0458': 'j',
  '\u0501': 'd', '\u04bb': 'h', '\u051b': 'q', '\u051d': 'w', '\u04cf': 'l',
  '\u043f': 'n', '\u0433': 'r',
  // grec
  '\u03b1': 'a', '\u03b2': 'b', '\u03b3': 'y', '\u03b5': 'e', '\u03b7': 'n',
  '\u03b9': 'i', '\u03ba': 'k', '\u03bc': 'u', '\u03bd': 'v', '\u03bf': 'o',
  '\u03c1': 'p', '\u03c2': 's', '\u03c4': 't', '\u03c5': 'u', '\u03c7': 'x',
  '\u03c9': 'w',
};

const _LEET: Record<string, string> = { '0': 'o', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's' };

// Expressions courantes qui contiennent un mot du filtre sans en etre un.
const _IDIOMES = /(?:^| )(?:baby shower|bridal shower|meteor shower|shower of|chinks? in|bath toys?|suicide squad|snuff box(?:es)?|snuff bottles?|bikini atoll|bikini bottom|nu metal|anal retentive)(?= |$)/g;

/** NFKC + retrait des accents et caracteres invisibles + minuscules (SANS translitteration). */
function _base(texte: unknown): string {
  let s = typeof texte === 'string' ? texte : String(texte == null ? '' : texte);
  try { s = s.normalize('NFKC'); } catch { /* chaine exotique : on garde telle quelle */ }
  try { s = s.normalize('NFD'); } catch { /* idem */ }
  return s.replace(_MARQUES, '').replace(_INVISIBLES, '').toLowerCase();
}

/** Remplace les lettres cyrilliques / grecques ressemblantes et les lettres latines speciales. */
function _translit(s: string): string {
  return s.replace(/[^\x00-\x7f]/g, (c) => _LATIN_SPECIAUX[c] ?? _HOMOGLYPHES[c] ?? c);
}

/** Tout ce qui n'est pas [a-z0-9] devient un espace ; espaces compactes ; idiomes retires. */
function _simple(s: string): string {
  return (' ' + s.replace(/[^a-z0-9]+/g, ' ').trim() + ' ').replace(_IDIOMES, ' ').replace(/\s+/g, ' ').trim();
}

/** "n u d e" -> "nude" : au moins 3 jetons d'un seul caractere de suite sont recolles. */
function _joindre(s: string): string {
  const t = s.split(' ');
  const sortie: string[] = [];
  let i = 0;
  while (i < t.length) {
    if (t[i].length === 1) {
      let j = i;
      while (j < t.length && t[j].length === 1) j++;
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
  /** texte Unicode brut (NFKC, minuscules) pour les termes non latins */
  unicode: string;
}

function _vuesPlancher(prompt: unknown): VuesPlancher {
  const nfkc = (() => {
    let s = typeof prompt === 'string' ? prompt : String(prompt == null ? '' : prompt);
    try { s = s.normalize('NFKC'); } catch { /* garde */ }
    return s.toLowerCase().replace(_INVISIBLES, '').replace(/\s+/g, ' ');
  })();
  const t = _translit(_base(prompt));
  const fabriquer = (x: string) => _ecraser(_joindre(_simple(_joindrePonctue(x))));
  const chiffres = fabriquer(t);
  const leetI = fabriquer(_leet(t, 'i'));
  const leetL = fabriquer(_leet(t, 'l'));
  const coller = (v: string) => v.replace(/[^a-z]/g, '').replace(/([a-z])\1+/g, '$1');
  // La vue collee part du texte sans jonction (les jonctions sont deja des lettres collees).
  const collees = [coller(_simple(_leet(t, 'i'))), coller(_simple(_leet(t, 'l')))];
  const series = [
    ..._series(_simple(_joindrePonctue(t))), ..._series(_simple(_joindrePonctue(_leet(t, 'i')))),
    ..._series(_simple(_joindrePonctue(_leet(t, 'l')))),
  ];
  return { chiffres, leetI, leetL, collees, series, unicode: nfkc };
}

// ═══════════════════════════════════════════════════════════════════════════
// TERMES (le `*` final = debut de mot ; sinon mot entier). Les termes sont
// normalises comme le texte avant compilation : accents et ponctuation sans effet.
// ═══════════════════════════════════════════════════════════════════════════

interface Terme { src: string; re: RegExp; cat: CategorieBlocage }

function _echapper(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function _formeTerme(src: string): string { return _simple(_translit(_base(src.replace(/\*$/, '')))); }

function _compiler(liste: string[], cat: CategorieBlocage): Terme[] {
  return liste.map((src) => {
    const prefixe = src.endsWith('*');
    const noyau = _echapper(_formeTerme(src));
    return { src, cat, re: new RegExp('(?:^| )' + noyau + (prefixe ? '' : '(?= |$)')) };
  });
}

function _chercher(vues: string[], termes: Terme[]): Terme | null {
  for (const t of termes) for (const v of vues) if (t.re.test(v)) return t;
  return null;
}

function _nom(t: Terme): string { return t.src.replace(/\*$/, ''); }

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
  // francais
  'enfant*', 'bebe*', 'gamin', 'gamine', 'gamins', 'gamines', 'gosse*', 'fillette*', 'garconnet*', 'mineur*', 'adolescent*', 'ado', 'ados', 'ecolier*',
  'ecoliere*', 'collegien*', 'lyceen*', 'nourrisson*', 'petite fille*', 'petit garcon*', 'jeune fille*', 'jeune garcon*',
  'moins de 18',
  // espagnol
  'nino*', 'nina*', 'nene', 'nena', 'menor', 'menores', 'adolescente*', 'chiquill*', 'preadolescente*', 'colegiala*',
  'menos de 18',
  // allemand
  'kinder*', 'kleinkind*', 'madchen*', 'minderjahrig*', 'jugendlich*', 'schulmadchen*', 'unter 18',
  // portugais
  'crianca*', 'menino*', 'menina*', 'garotinho*', 'garotinha*',
  // italien
  'bambin*', 'ragazzin*', 'minorenn*', 'neonato*', 'fanciull*', 'sotto i 18',
  // commun
  'infantil*', 'infante*',
];
// Ambigus : peuvent designer un adulte (ex. "young woman", "girl in a bikini").
const MINEURS_AMBIGUS: string[] = [
  'boy', 'boys', 'girl', 'girls', 'young', 'youth', 'youthful', 'lass', 'jeune', 'jeunes', 'fille', 'filles', 'garcon', 'garcons',
  'junge', 'junges', 'jungen', 'chico', 'chica', 'chicos', 'chicas', 'muchacho', 'muchacha', 'joven', 'jovenes',
  'ragazzo', 'ragazza', 'ragazzi', 'ragazze', 'garoto', 'garota', 'rapaz', 'rapariga',
  // Relecture 2026-10-03 : « Kind » (allemand, singulier) + nudite passait le plancher alors que « Kinder » / « Maedchen » / « Junge » le declenchaient. Ambigu avec l'adjectif anglais
  // « kind » : comme girl / boy il ne declenche donc le plancher qu'AVEC une nudite explicite.
  'kind',
];
// Mineurs pour les combinaisons de VIOLENCE du filtre general ("minor character" est un terme de jeu).
const MINEURS_VIOLENCE: string[] = [
  'child', 'children', 'kid', 'kids', 'baby', 'babies', 'infant*', 'toddler*', 'enfant*', 'bebe*', 'nino*', 'nina*', 'kinder*',
  'crianca*', 'bambin*',
];

// ── Nudite / sexe (B) ─────────────────────────────────────────────────────
// FORT : explicite. Avec n'importe quel mineur (ou age < 18), meme ambigu : plancher.
const NU_FORT: string[] = [
  // anglais
  'nude*', 'nudity', 'naked*', 'nsfw', 'porn*', 'xxx', 'erotic*', 'topless', 'bottomless', 'undress*', 'unclothed', 'disrobe*',
  'unclad', 'wearing nothing', 'wears nothing', 'wear nothing', 'without clothes', 'without clothing', 'without any clothes',
  'without any clothing', 'no clothes', 'no clothing', 'wearing no clothes', 'in the nude', 'birthday suit', 'full frontal',
  'fully exposed', 'bare chest*', 'bare breast*', 'bare skin', 'bare butt', 'bare bottom', 'bare torso', 'barely clothed',
  'barely dressed', 'scantily clad', 'scantily dressed', 'sex', 'sexy', 'sexual*', 'sexually', 'sexualized', 'sexualised',
  'sensual*', 'seductive', 'provocative', 'suggestive', 'lingerie', 'underwear', 'panties', 'thong', 'fetish', 'bdsm', 'bondage',
  'nipple*', 'breasts', 'boobs', 'tits', 'genital*', 'vagina', 'penis', 'pussy', 'crotch', 'upskirt', 'cleavage', 'lewd', 'hentai',
  'ecchi', 'orgasm*', 'masturbat*', 'cum', 'ahegao',
  // francais
  'nu', 'nue', 'nus', 'nues', 'nudite', 'denud*', 'deshabill*', 'sans vetement*', 'sans habit*', 'a poil', 'torse nu', 'seins nus',
  'sein nu', 'sexe', 'sexuel*', 'erotique*', 'pornograph*', 'sensuel*', 'seducteur', 'provocant*', 'soutien gorge',
  'seins', 'tout nu', 'toute nue',
  // espagnol
  'desnud*', 'semidesnud*', 'sin ropa', 'en cueros', 'sexo', 'lenceria', 'ropa interior', 'bragas', 'tanga', 'provocativ*',
  'senos', 'tetas',
  // allemand
  'nackt*', 'ausgezogen', 'entkleidet', 'unbekleidet', 'oben ohne', 'ohne kleidung', 'ohne kleider', 'erotisch*', 'sexuell*',
  'unterwasche', 'sinnlich*', 'verfuhrerisch*', 'busen', 'titten',
  // portugais
  'nua', 'nuas', 'seminu*', 'sem roupa*', 'calcinha*', 'roupa intima', 'peitos', 'seios', 'pelado', 'pelada',
  // italien
  'nudo', 'nudi', 'nudita', 'spogliat*', 'svestit*', 'senza vestiti', 'senza vestito', 'senza abiti', 'seno nudo', 'seni nudi',
  'nuda', 'sessuale', 'sesso', 'mutandine', 'provocante', 'seni', 'tette',
];
// MOYEN : tenue minimale. Avec un mineur ou un age (et un mineur ambigu aussi).
const NU_MOYEN: string[] = [
  'bikini*', 'swimsuit', 'swim suit', 'bra', 'brassiere', 'shirtless', 'without a shirt', 'without shirt', 'no shirt', 'no top',
  'without top', 'without a top', 'without pants', 'no pants', 'without underwear', 'no underwear', 'diaper only',
  'sin camisa', 'sin camiseta', 'sin blusa', 'sans haut', 'sans t shirt', 'sans tee shirt', 'maillot de bain', 'ohne hemd',
  'ohne oberteil', 'badeanzug', 'sem camisa', 'sem blusa', 'biquini', 'senza maglia', 'senza maglietta', 'costume da bagno',
];
// FAIBLE : vocabulaire de scene, seulement avec un mineur SANS ambiguite (plancher).
const NU_FAIBLE_PLANCHER: string[] = ['bath', 'bathing', 'shower', 'showering', 'intimate', 'revealing', 'bain', 'banho', 'bano',
  'badewanne', 'bagno'];
// FAIBLE, filtre general seulement.
const NU_FAIBLE_GENERAL: string[] = ['bed', 'bedroom'];

// Violence EXERCEE sur un enfant (plancher). Volontairement etroit : "kid with a knife"
// ou "child hero hit by a rock" ne sont pas des contenus illicites.
const VIOLENCE_ENFANT_PLANCHER: string[] = [
  'abuse*', 'abusing', 'hurt', 'hurting', 'beaten', 'beating', 'beat up', 'punch*', 'slap*', 'whip*', 'torture*', 'tortur*', 'rape*',
  'raped', 'raping', 'molest*', 'strangl*', 'suffocat*', 'mutilat*', 'dismember*', 'murder*',
  'frapp*', 'battu*', 'maltrait*', 'viole', 'violee', 'violer', 'agress*', 'abus', 'abuso*', 'misshandl*', 'missbrauch*',
];

// ── Termes illicites en soi (plancher) ────────────────────────────────────
const PLANCHER_MOTS: string[] = [
  'pedophil*', 'paedophil*', 'pedofil*', 'pedoporn*', 'pedocrim*', 'pedopornograf*', 'padophil*', 'lolicon*', 'loli', 'lolis',
  'shota', 'shotas', 'shotacon*', 'child abuse', 'child porn*', 'childporn*', 'child sex*', 'child rape', 'child exploitation',
  'kid porn*', 'kiddie porn*', 'kiddy porn*', 'baby porn*', 'underage porn*', 'underage sex*', 'underage nude*', 'csam',
  'jailbait', 'toddler abuse', 'infant abuse', 'toddlercon', 'babycon',
  'kinderporno*', 'kindesmissbrauch', 'kinderschander', 'pornografia infantil', 'porno infantil', 'pornoinfantil',
  'abuso infantil', 'abuso sexual infantil', 'pornographie enfantine', 'pornografia minorile',
];
// Versions "collees" (lettres seules) pour les separateurs exotiques : substring, donc seulement des termes longs.
const PLANCHER_COLLES: string[] = [
  'pedophil', 'paedophil', 'pedofil', 'lolicon', 'shotacon', 'childporn', 'childabuse', 'childsexualabuse', 'toddlerabuse',
  'infantabuse', 'kidporn', 'kiddieporn', 'kiddyporn', 'childsex', 'kinderporno', 'kindesmissbrauch', 'kinderschander',
  'pornoinfantil', 'pornografiainfantil', 'pedopornograph', 'pedopornograf', 'pedocriminel', 'jailbait', 'underageporn',
  'underagesex',
];
// Termes non latins, testes sur le texte Unicode brut.
const PLANCHER_UNICODE: string[] = [
  '\u043f\u0435\u0434\u043e\u0444\u0438\u043b',                                   // pedofil (russe)
  '\u0434\u0435\u0442\u0441\u043a\u043e\u0435 \u043f\u043e\u0440\u043d\u043e',     // detskoe porno
  '\u0434\u0435\u0442\u0441\u043a\u0430\u044f \u043f\u043e\u0440\u043d\u043e',     // detskaya porno
  '\u0434\u0435\u0442\u0441\u043a\u043e\u0433\u043e \u043f\u043e\u0440\u043d\u043e', // detskogo porno
  '\u30ed\u30ea\u30b3\u30f3', '\u30b7\u30e7\u30bf\u30b3\u30f3',                   // lolicon, shotacon (japonais)
  '\u5150\u7ae5\u30dd\u30eb\u30ce', '\u5152\u7ae5\u8272\u60c5', '\u513f\u7ae5\u8272\u60c5', // pornographie enfantine
];

// Dans une serie de lettres isolees ("c h i l d n u d e") on ne sait pas ou finissent les mots : on cherche
// un mineur ET une nudite comme sous-chaines de la serie (une serie de 6 lettres isolees est tres rare).
const SERIE_MINEURS: string[] = ['kind', 'child', 'kid', 'girl', 'boy', 'teen', 'baby', 'infant', 'toddler', 'schoolgirl', 'young', 'preteen',
  'minor', 'enfant', 'fille', 'garcon', 'nino', 'nina', 'kinder', 'madchen', 'bambin', 'crianca', 'menina', 'menino'];
const SERIE_NUDITE: string[] = ['nude', 'naked', 'topless', 'undress', 'sexy', 'porn', 'bikini', 'lingerie', 'panties', 'underwear',
  'nsfw', 'erotic', 'sensual', 'seductive', 'shirtless', 'desnud', 'nackt', 'nuda', 'nudo', 'nua', 'sexual', 'withoutclothes', 'noclothes',
  'wearingnothing'];

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
const _NB_LETTRES = '(?<![a-z])(?:' + Array.from(new Set(_NOMBRES_LETTRES)).sort((a, b) => b.length - a.length)
  .map(_echapper).join('|') + ')(?![a-z])';
const _NB_CHIFFRES = '(?<![0-9])(?:1[0-7]|0?[0-9])(?![0-9])';
const _NB = '(?:' + _NB_CHIFFRES + '|' + _NB_LETTRES + ')';
const _UNITES_AGE = '(?:yo|y o|yr old|yrs old|yr o|years? old|year olds?|yearold|yrold|ans|anos|anni|jahre alt|jahrig[a-z]*|j alt)(?![a-z])';
const _PREFIXES_AGE = '(?:aged?|age of|ages|age de|agee de|agee|edad de|edad|alter von|alter|eta di|idade de|idade)';
const _RE_AGE = new RegExp('(?:^| )' + _NB + ' ?' + _UNITES_AGE + '|(?:^| )' + _PREFIXES_AGE + ' ?' + _NB + '(?![a-z0-9])');

// ═══════════════════════════════════════════════════════════════════════════
// FILTRE GENERAL — listes
// ═══════════════════════════════════════════════════════════════════════════

// Explicite : bloque seul (toujours teste sur la version normalisee aussi).
const GENERAL_SEXUEL_DUR: string[] = [
  'nude*', 'nudity', 'naked*', 'nsfw', 'porn*', 'xxx', 'sex', 'sexual*', 'sexually', 'sexe', 'sexuel*', 'sexo', 'sesso', 'sessuale',
  'erotic*', 'erotique*', 'hentai', 'lewd', 'topless', 'bottomless', 'lingerie', 'bikini*', 'underwear', 'undress*', 'stripper*',
  'striptease', 'orgasm*', 'fetish', 'bdsm', 'bondage', 'prostitut*', 'brothel*', 'genital*', 'penis', 'vagina', 'nipple*',
  'buttock*', 'anus', 'anal', 'oral sex', 'fellat*', 'cunniling*', 'masturbat*', 'ejaculat*', 'cum shot', 'creampie', 'gangbang',
  'threesome', 'orgy', 'sextoy', 'dildo', 'vibrator', 'furry nsfw', 'rule34', 'rule 34', 'ahegao', 'ecchi', 'yaoi',
  'nu', 'nue', 'nus', 'nues', 'poitrine', 'seins', 'couille*', 'chatte', 'nichon*', 'enculer', 'foutre', 'salope', 'pute', 'putain',
  'sodomie', 'fellation', 'cunnilingus', 'orgasme', 'underage',
  'dick', 'cock', 'pussy', 'ass', 'tits', 'boobs', 'cum', 'slut', 'whore', 'breasts',
  // phrases de nudite et autres langues (IA-02)
  'wearing nothing', 'wears nothing', 'full frontal', 'birthday suit', 'in the nude', 'unclad', 'bare chest*', 'bare breast*',
  'only body paint', 'scantily clad', 'barely clothed',
  'desnud*', 'semidesnud*', 'nackt*', 'nudo', 'nuda', 'nudi', 'nudita', 'nua', 'nuas', 'seminu*', 'denud*', 'deshabill*',
  'pornograf*', 'erotisch*', 'sinnlich*', 'senos', 'titten', 'tetas', 'tette', 'spogliat*', 'svestit*',
];
// Ambigu, SEXUEL : bloque seulement avec un terme sexuel explicite ou un contexte sexuel faible.
const GENERAL_CTX_SEXUEL: string[] = [
  'strip', 'breast', 'bite', 'queue', 'baiser', 'jouir', 'dominat*', 'submissi*', 'sadis*', 'masoch*', 'escort', 'yuri',
  'tied up', 'chained', 'whipped', 'on knees', 'bent over',
];
const CONTEXTE_SEXUEL_FAIBLE: string[] = ['sexy', 'sensual*', 'seductive', 'provocative', 'suggestive', 'busty', 'kinky', 'big breast*',
  'large breast*', 'huge breast*', 'her breast*'];
// Ambigu, VIOLENCE / drogue / jeu : bloque seulement avec un enfant, un terme sexuel explicite ou un terme du plancher.
const GENERAL_CTX_VIOLENCE: string[] = [
  'blood', 'bloody', 'bleed*', 'murder*', 'kill*', 'torture*', 'torturer', 'cannibal*', 'flesh', 'corpse*', 'cadaver*', 'dead body',
  'death scene', 'execution', 'hanging', 'strangul*', 'suffocate', 'drown*', 'stab*', 'slash*', 'wound*', 'injury', 'brutal*',
  'savage*', 'slaughter*', 'meurtre*', 'tuer', 'mort', 'cadavre*', 'sang', 'sanglant*', 'violence', 'violent*', 'cruaut*',
  'drug', 'drugs', 'crack', 'snort', 'overdose', 'drogue*', 'stupefi*', 'bomb', 'bombing', 'isis', 'jump off',
];
// Bloques seuls, par famille.
const GENERAL_VIOLENCE_DUR: string[] = [
  'gore', 'gory', 'dismember*', 'decapitat*', 'mutilat*', 'eviscerat*', 'disembowel*', 'snuff', 'graphic violence', 'massacre*',
  'bloodbath', 'carnage',
];
const GENERAL_DROGUE_DUR: string[] = [
  'cocaine', 'heroin', 'heroine', 'fentanyl', 'methamphet*', 'meth', 'opium', 'inject drug*', 'crack cocaine',
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
const T_MINEURS_VIOLENCE = _compiler(MINEURS_VIOLENCE, 'mineur_violence');
const T_NU_FORT = _compiler(NU_FORT, 'plancher');
const T_NU_MOYEN = _compiler(NU_MOYEN, 'plancher');
const T_NU_FAIBLE_PLANCHER = _compiler(NU_FAIBLE_PLANCHER, 'plancher');
const T_NU_FAIBLE_GENERAL = _compiler(NU_FAIBLE_GENERAL, 'mineur_violence');
const T_VIOLENCE_ENFANT_PLANCHER = _compiler(VIOLENCE_ENFANT_PLANCHER, 'plancher');
const T_PLANCHER_MOTS = _compiler(PLANCHER_MOTS, 'plancher');
const T_SEXUEL_DUR = _compiler(GENERAL_SEXUEL_DUR, 'sexuel');
const T_CTX_SEXUEL = _compiler(GENERAL_CTX_SEXUEL, 'contexte');
const T_CTX_SEXUEL_FAIBLE = _compiler(CONTEXTE_SEXUEL_FAIBLE, 'contexte');
const T_CTX_VIOLENCE = _compiler(GENERAL_CTX_VIOLENCE, 'contexte');
const T_DURS_AUTRES: Terme[] = [
  ..._compiler(GENERAL_VIOLENCE_DUR, 'violence'), ..._compiler(GENERAL_DROGUE_DUR, 'drogue'),
  ..._compiler(GENERAL_EXTREMISME_DUR, 'extremisme'), ..._compiler(GENERAL_AUTOBLESSURE_DUR, 'autoblessure'),
  ..._compiler(GENERAL_HAINE_DUR, 'haine'), ..._compiler(GENERAL_ARMES_DUR, 'armes'),
];
const T_PERSONNES = _compiler(PERSONNES, 'combinaison');
const T_NUDITE_EXTREME = _compiler(NUDITE_EXTREME, 'combinaison');
const T_VIOLENCE_ENFANT_GENERAL = _compiler(VIOLENCE_ENFANT_GENERAL, 'mineur_violence');
const _PLANCHER_COLLES_ECRASES = PLANCHER_COLLES.map((s) => s.replace(/([a-z])\1+/g, '$1'));

/** Liste a plat des termes DURS du filtre (pour l'affichage cote bureau, `get-nsfw-keywords` : fenetre « New project », grille des projets).
 *  Essais reels du 2026-10-03 : les termes de CONTEXTE (GENERAL_CTX_SEXUEL / GENERAL_CTX_VIOLENCE : blood, kill, wound, strip...) y figuraient aussi
 *  et le bureau les testait en mots entiers SANS contexte : « An orc warrior covered in blood » etait refuse a la creation du projet alors que la
 *  generation (checkPromptSafety) l'accepte. Ces termes ne bloquent qu'en contexte : ils ne font pas partie de la liste a plat. */
export const NSFW_KEYWORDS: string[] = Array.from(new Set([
  ...GENERAL_SEXUEL_DUR, ...GENERAL_VIOLENCE_DUR, ...GENERAL_DROGUE_DUR, ...GENERAL_EXTREMISME_DUR,
  ...GENERAL_AUTOBLESSURE_DUR, ...GENERAL_HAINE_DUR, ...GENERAL_ARMES_DUR,
].map((s) => s.replace(/\*$/, ''))));

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
  const bloquer = (blocked: string, reason: string): PromptSafetyResult =>
    ({ safe: false, blocked, reason, categorie: 'plancher', hardFloor: true });

  // 1. Termes illicites en soi.
  for (const u of PLANCHER_UNICODE) if (v.unicode.includes(u)) return bloquer(u, _MSG_PLANCHER);
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

  // 2. Mineur x nudite / sexe, mineur x violence exercee sur lui.
  const mineurFort = _chercher(vues, T_MINEURS_FORT);
  const age = vues.some((x) => _RE_AGE.test(x));
  const mineurAmbigu = _chercher(vues, T_MINEURS_AMBIGUS);
  if (mineurFort || age || mineurAmbigu) {
    const fort = _chercher(vues, T_NU_FORT) || _chercher(vues, T_NU_MOYEN);
    if (fort) return bloquer('minor-safety', _MSG_PLANCHER_MINEUR);
    if (mineurFort || age) {
      if (_chercher(vues, T_NU_FAIBLE_PLANCHER)) return bloquer('minor-safety', _MSG_PLANCHER_MINEUR);
      if (_chercher(vues, T_VIOLENCE_ENFANT_PLANCHER)) return bloquer('minor-safety', _MSG_PLANCHER_MINEUR);
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
  const souple = _simple(base);                          // texte tel quel (sans translitteration)
  const v = _vuesPlancher(prompt);
  const toutes = [souple, v.chiffres, v.leetI, v.leetL]; // l'explicite est teste sur les formes deguisees aussi
  const refus = (t: Terme): PromptSafetyResult => ({
    safe: false, blocked: _nom(t), categorie: t.cat,
    reason: `Content filter: "${_nom(t)}" is blocked. ${_CONSEIL_REFUS}`,
  });

  // 1. Termes explicites (sexe, nudite) : mots entiers, y compris deguises ("n u d e", "nud3", cyrillique).
  const sexuel = _chercher(toutes, T_SEXUEL_DUR);
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
