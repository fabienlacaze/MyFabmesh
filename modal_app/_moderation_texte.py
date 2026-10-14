"""Filtre de prompt cote Modal : PORTAGE A L'IDENTIQUE de cloud/src/nsfw_filter.ts (2026-10-03, etendu le 2026-10-13).

POURQUOI (constats IA-02 et IA-03 de l'analyse du 03/10/2026). La copie du plancher « mineurs / contenus
illicites » qui vivait dans modal_app/app.py (`_prompt_hard_floor`) etait restee a l'ancienne version :
  * contournable : « n u d e », « nud3 », cyrillique, chiffres pleine largeur, lettres repetees, age ecrit
    en lettres (« twelve year old »), autres langues ;
  * trop stricte pour le vocabulaire de jeu : « hot », « bed », « bath », « young », « hit », « knife »
    suffisaient a refuser un prompt legitime (« young hero with a toy gun »).
Ce module reprend la logique CORRIGEE du Worker. C'est la derniere ligne de defense, au niveau du
generateur : elle ne se contourne pas avec le drapeau `unrestricted`.

2026-10-13 (audit langue / moderation du 11/10 : MODERATION-01, 03, 05, 07, 09, M1, M2, M3, SERVEUR-09) : memes
ajouts que le TypeScript — effacement des caracteres de categorie C et des ignorables (le tokenizer CLIP les efface,
« na<U+0001>ked » est lu « naked »), toutes les marques combinantes, chiffres Unicode, homoglyphes completes, actes
explicites, mots colles, ages, lexique zh / hi / ar / ru / ja / ko / tr (vue Unicode), faux positifs corriges ; et les
bornes du texte envoye au generateur : `controler_longueur_prompt`, `neutraliser_syntaxe_prompt` (jetons speciaux CLIP,
poids A1111 hors [0,5 ; 2]).

CONTRAT. `prompt_hard_floor(prompt)` rend `None` si le texte passe, sinon une CHAINE (la raison du refus),
exactement comme l'ancienne `_prompt_hard_floor` d'app.py. `check_hard_floor` et `check_prompt_safety`
rendent le meme dictionnaire que le Worker : { safe, blocked?, reason?, categorie?, hardFloor? }.

PARITE. Les listes ci-dessous sont GENEREES depuis nsfw_filter.ts (build/moderation_modal/gen_module.py) ; les
fonctions suivent le TypeScript ligne a ligne. Differences voulues entre JS et Python, toutes neutralisees :
`\\s` (JS et Python n'ont pas la meme definition : _WS ci-dessous est celle de JS), `$` (Python l'accepte
avant un saut de ligne final : on emploie `\\Z`), `\\p{..}` (absent du module re : categories lues par unicodedata),
longueur d'une chaine (JS compte en unites UTF-16). Les TABLES Unicode different (le Python de Modal, 3.11, connait
Unicode 14, le moteur JavaScript une version plus recente) : depuis le 2026-10-14 (revue du lot, B3), les points de code non
assignes en Unicode 14 sont effaces des deux cotes par une table FIGEE (NON_ASSIGNES_U14, generee par
build/moderation_modal/gen_non_assignes_u14.py), quelle que soit la version du moteur. Le test build/bancs/noyaux/test_moderation_modal.py
rejoue les memes jeux de cas que cloud/tests/moderation.test.mjs ET compare ce module au TypeScript sur un corpus
(si node est present).

REGLE « kind » (2026-10-03). Le mot allemand « Kind » (singulier) etait absent : « kind » est ambigu avec
l'adjectif anglais (« a kind knight »). Il est donc un mineur AMBIGU, comme girl / boy : il ne bloque qu'avec
une nudite explicite ou une tenue minimale, jamais avec le simple vocabulaire de scene (bath, shower) ni
avec une violence. Dans une serie de lettres isolees (« k i n d n a c k t »), « kind » compte comme mineur.

SECONDE RELECTURE (2026-10-14) : age (liste fermee DUREES_NON_AGE), chiffres colles (vues coupees entre lettres et chiffres),
double sens « cock » / « erection » seulement dans une tournure ecrite telle quelle, « una escolar », « a first grade girl »,
maillots au pluriel, references HTML / mojibake / U+FFFC lus comme ftfy les repare, viol d'une personne au filtre general.

TROISIEME RELECTURE (2026-10-14) : LECTURES du texte (`_lire`) — la principale, et celles ou les caracteres effaces ou changes
separent les mots (« separee », « clip », « ftfy », « production ») ; les vues de toutes les lectures sont reunies, comme dans le
TypeScript. Garde des tournures de ferme et de chantier lue sur les mots (`_garde_expression`). Durees ajoutees, « escolar » apres
un determinant ou un adjectif, « grade one girl », « a girl from first grade » (`_RE_MINEURS_CONSTRUITS`).

Dependances : bibliotheque standard seulement (re, time, unicodedata). Rien a ajouter a l'image Modal.
"""
import re
import time
import unicodedata

# ═══════════════════════════════════════════════════════════════════════════
# NORMALISATION (constats IA-02, MODERATION-03, MODERATION-09)
# ═══════════════════════════════════════════════════════════════════════════

# Definition de `\s` en JavaScript (celle de Python differe : ex. U+FEFF, U+001C..U+001F).
_WS = "\t\n\x0b\x0c\r \xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
_RE_WS = re.compile("[" + _WS + "]+")
_RE_BLANCS_CONTROLE = re.compile("[\t\n\r]")

# Caracteres EFFACES en plus de la categorie C : U+FFFD, U+FFFC (ftfy le retire avant le tokenizer CLIP : 2026-10-14) et les
# « ignorables » qui ne sont pas de categorie C.
_EFFACES_HORS_C = frozenset("\ufffc\ufffd\u115f\u1160\u17b4\u17b5\u2800\u3164\uffa0")
# Marques gardees par la vue Unicode (voyelles et viramas indiens, thai, lao, tibetain, birman, khmer ; voisement des kana).
_PLAGES_MARQUES_GARDEES = ((0x0900, 0x0DFF), (0x0E00, 0x0FFF), (0x1000, 0x109F), (0x1780, 0x17FF), (0x3099, 0x309A))
# Vue exacte : crochet, tilde, corne, point souscrit (vietnamien, espagnol « ñ »).
_MARQUES_DISTINCTIVES = frozenset("\u0303\u0309\u031b\u0323")


def _efface(c):
    if unicodedata.category(c)[0] == "C" or c in _EFFACES_HORS_C:
        return True
    cp = ord(c)
    return cp >= 0x378 and _non_assigne_u14(cp)


def _non_assigne_u14(cp):
    """Point de code NON ASSIGNE en Unicode 14 (table NON_ASSIGNES_U14, partagee avec le TypeScript : revue du 14/10, B3).
    Avec le Python 3.11 de Modal, c'est exactement la categorie Cn ; avec un Python plus recent, la table garde la meme regle.
    Recherche par dichotomie (la plage dont le debut est le dernier <= cp)."""
    bas, haut = 0, len(_DEBUTS_U14)
    while bas < haut:
        milieu = (bas + haut) // 2
        if _DEBUTS_U14[milieu] <= cp:
            bas = milieu + 1
        else:
            haut = milieu
    return bas > 0 and cp <= _FINS_U14[bas - 1]


def _sans_non_assignes(s):
    """Retire les points de code non assignes en Unicode 14 (AVANT NFKC, comme le TypeScript)."""
    if s.isascii():
        return s
    return "".join(c for c in s if ord(c) < 0x378 or not _non_assigne_u14(ord(c)))


def _sans_effaces(s):
    return "".join(c for c in s if not _efface(c))


def _est_marque(c):
    return unicodedata.category(c)[0] == "M"


def _marque_gardee(c):
    cp = ord(c)
    return any(a <= cp <= b for a, b in _PLAGES_MARQUES_GARDEES)


# Lettres latines sans decomposition Unicode (et, 2026-10-13, lettres barrees et petites capitales : MODERATION-09).
_LATIN_SPECIAUX = {
    "\u00df": "ss", "\u00f8": "o", "\u00e6": "ae", "\u0153": "oe", "\u0111": "d",
    "\u0142": "l", "\u0131": "i", "\u0251": "a", "\u0261": "g",
    # lettres barrees
    "\u0127": "h", "\u0167": "t", "\u0138": "k", "\u0180": "b", "\u0268": "i", "\u0289": "u", "\u024d": "r", "\u024f": "y",
    "\u01b6": "z", "\u01e5": "g", "\u0249": "j", "\u0237": "j",
    # petites capitales
    "\u1d00": "a", "\u0299": "b", "\u1d04": "c", "\u1d05": "d", "\u1d07": "e", "\ua730": "f", "\u0262": "g", "\u029c": "h",
    "\u026a": "i", "\u1d0a": "j", "\u1d0b": "k", "\u029f": "l", "\u1d0d": "m", "\u0274": "n", "\u1d0f": "o", "\u1d18": "p",
    "\u0280": "r", "\ua731": "s", "\u1d1b": "t", "\u1d1c": "u", "\u1d20": "v", "\u1d21": "w", "\u028f": "y", "\u1d22": "z",
}

# Lettres cyrilliques / grecques / armeniennes qui ressemblent a une lettre latine.
_HOMOGLYPHES = {
    # cyrillique
    "\u0430": "a", "\u0432": "b", "\u0435": "e", "\u043a": "k", "\u043c": "m",
    "\u043d": "h", "\u043e": "o", "\u0440": "p", "\u0441": "c", "\u0442": "t",
    "\u0443": "y", "\u0445": "x", "\u0455": "s", "\u0456": "i", "\u0458": "j",
    "\u0501": "d", "\u04bb": "h", "\u051b": "q", "\u051d": "w", "\u04cf": "l",
    "\u043f": "n", "\u0433": "r", "\u04af": "y",
    # grec
    "\u03b1": "a", "\u03b2": "b", "\u03b3": "y", "\u03b5": "e", "\u03b7": "n",
    "\u03b9": "i", "\u03ba": "k", "\u03bc": "u", "\u03bd": "v", "\u03bf": "o",
    "\u03c1": "p", "\u03c2": "s", "\u03c4": "t", "\u03c5": "u", "\u03c7": "x",
    "\u03c9": "w",
    # armenien (2026-10-13)
    "\u0585": "o", "\u057d": "u", "\u0578": "n", "\u0570": "h", "\u0581": "g", "\u0566": "q", "\u0561": "w",
}


def _lettre_symbole(cp):
    """Lettres-emoji : indicateurs regionaux, lettres carrees et cerclees NEGATIVES (sans decomposition NFKC)."""
    if 0x1F1E6 <= cp <= 0x1F1FF:
        return chr(97 + cp - 0x1F1E6)
    if 0x1F170 <= cp <= 0x1F189:
        return chr(97 + cp - 0x1F170)
    if 0x1F150 <= cp <= 0x1F169:
        return chr(97 + cp - 0x1F150)
    return None


_LEET = {"0": "o", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s"}

_RE_NON_ALNUM = re.compile("[^a-z0-9]+")
_RE_NON_LETTRE = re.compile("[^a-z]")
_RE_REPETE3 = re.compile(r"([a-z])\1{2,}")
_RE_REPETE2 = re.compile(r"([a-z])\1+")
_RE_PONCTUE = re.compile(
    "(?<![a-z0-9])[a-z0-9](?:[^a-z0-9" + _WS + "]+[a-z0-9]){2,}(?![a-z0-9])")
_RE_LEET = re.compile(r"[0134578@$]")
_RE_LETTRE = re.compile("[a-z]")
_RE_ESPACES = re.compile(" +")


def _en_texte(x):
    if isinstance(x, str):
        return x
    return "" if x is None else str(x)


def _longueur_js(s):
    """Longueur d'une chaine comptee comme JavaScript (unites UTF-16)."""
    return len(s.encode("utf-16-le", "surrogatepass")) // 2


MINEURS_FORT = (
    "child", "children", "childlike", "child like", "kid", "kids", "kiddo", "kiddie", "kiddy", "infant", "infants",
    "baby", "babies", "toddler*", "preteen*", "pre teen*", "tween*", "teen", "teens", "teenage*", "teenager*",
    "minor", "minors", "underage", "under age", "juvenile*", "prepubescent", "pubescent", "schoolgirl*", "schoolboy*",
    "school girl*", "school boy*", "schoolchild*", "little girl*", "little boy*", "small girl*", "small boy*",
    "young girl*", "young boy*", "young lad*", "young teen*", "young looking", "looks young", "looking young",
    "kindergarten*", "preschool*", "elementary school", "primary school", "middle school", "junior high",
    "high school", "highschool", "under 18", "below 18", "less than 18", "younger than 18", "under eighteen",
    "under 16", "under 14", "newborn*", "new born*", "neonat*", "youngster*", "tots", "schoolkid*", "school kid*",
    "little one", "little ones", "youngling*", "bairn*", "tyke*", "moppet*", "rugrat*", "street urchin*", "underaged",
    "under aged", "little sister*", "little brother*", "baby sister*", "baby brother*", "sweet sixteen",
    "middle schooler*", "high schooler*", "grade school*", "sprog", "sprogs", "elementary schooler*",
    "kindergartner*", "nursery school*", "cub scout*", "girl scout*", "boy scout*", "first grader*", "second grader*",
    "third grader*", "fourth grader*", "fifth grader*", "sixth grader*", "seventh grader*", "eighth grader*",
    "ninth grader*", "tenth grader*", "eleventh grader*", "twelfth grader*", "1st grader*", "2nd grader*",
    "3rd grader*", "4th grader*", "5th grader*", "6th grader*", "7th grader*", "8th grader*", "9th grader*",
    "10th grader*", "11th grader*", "12th grader*", "below the age of 18", "under the age of 18", "not yet 18",
    "not yet eighteen", "childs", "kidz", "kiddos", "babys", "lil girl*", "lil boy*", "enfant*", "bebe*", "gamin",
    "gamine", "gamins", "gamines", "gosse*", "fillette*", "garconnet*", "mineur*", "adolescent*", "ado", "ados",
    "ecolier*", "ecoliere*", "collegien*", "lyceen*", "nourrisson*", "petite fille*", "petit garcon*", "jeune fille*",
    "jeune garcon*", "moins de 18", "marmot", "marmots", "mome", "momes", "petiot*", "pitchoun*", "nouveau ne*",
    "nouveaux nes", "preado*", "pre ado*", "nino*", "nina*", "nene", "nena", "menor", "menores", "adolescente*",
    "chiquill*", "preadolescente*", "colegial*", "menos de 18", "recien nacid*", "una escolar", "un escolar",
    "la escolar", "el escolar", "las escolares", "los escolares", "unas escolares", "unos escolares", "kinder*",
    "kleinkind*", "madchen*", "maedchen*", "minderjahrig*", "jugendlich*", "schulmadchen*", "unter 18", "saugling*",
    "teenie*", "crianca*", "menino*", "menina*", "garotinho*", "garotinha*", "menininh*", "nenem*", "menor de idade",
    "bambin*", "ragazzin*", "minorenn*", "neonat*", "fanciull*", "sotto i 18", "bimba", "bimbe", "bimbi", "scolar*",
    "infantil*", "infante", "infantes", "cocuk*", "cocug*", "bebek*", "kucuk kiz*", "kucuk oglan*", "resit olmayan",
    "ergen*", "ilkokul*", "peuter*", "kleuter*", "minderjarig*", "jongetje*", "dziecko", "dzieci*", "dziecka",
    "dziecku", "dzieckiem", "dziewczynk*", "chlopczyk*", "niemowl*", "nieletni*", "anak", "anak anak", "balita",
    "bayi", "di bawah umur", "tre em", "be gai", "be trai", "em be", "thieu nhi", "vi thanh nien", "dua tre",
    "tre con", "con nit", "cau be", "co be", "ein kind", "das kind", "dem kind", "einem kind", "kleines kind",
    "kleinen kind", "kindes", "een kind", "het kind",
)

MINEURS_AMBIGUS = (
    "boy", "boys", "girl", "girls", "young", "youth", "youthful", "lass", "jeune", "jeunes", "fille", "filles",
    "garcon", "garcons", "junge", "junges", "jungen", "chico", "chica", "chicos", "chicas", "muchacho", "muchacha",
    "joven", "jovenes", "ragazzo", "ragazza", "ragazzi", "ragazze", "garoto", "garota", "rapaz", "rapariga", "kind",
    "chaval*", "cria", "crias", "escolar", "escolares", "schuler*", "kiz", "kizlar*", "oglan*", "meisje*", "jongen*",
    "dziewczyn*", "chlopiec", "chlopc*", "gadis", "remaja",
)

MINEURS_INDICES = (
    "daughter*", "niece*", "nephew*", "little miss", "lolita*", "pupil", "pupils", "stepdaughter*", "stepson*",
    "nipper", "nippers", "first grade", "second grade", "third grade", "fourth grade", "fifth grade", "sixth grade",
    "seventh grade", "eighth grade", "ninth grade", "tenth grade", "eleventh grade", "twelfth grade", "1st grade",
    "2nd grade", "3rd grade", "4th grade", "5th grade", "6th grade", "7th grade", "8th grade", "9th grade",
    "10th grade", "11th grade", "12th grade",
)

MINEURS_VIOLENCE = (
    "child", "children", "kid", "kids", "baby", "babies", "infant", "infants", "toddler*", "enfant*", "bebe*",
    "nino*", "nina*", "kinder*", "crianca*", "bambin*",
)

NU_FORT = (
    "*nude*", "nudity", "*naked*", "*nsfw*", "porn*", "xxx", "erotic*", "*topless*", "bottomless", "undress*",
    "unclothed", "disrobe*", "unclad", "wearing nothing", "wears nothing", "wear nothing", "without clothes",
    "without clothing", "without any clothes", "without any clothing", "no clothes", "no clothing",
    "wearing no clothes", "in the nude", "birthday suit", "full frontal", "fully exposed", "bare chest*",
    "bare breast*", "bare skin", "bare butt", "bare bottom", "bare torso", "barely clothed", "barely dressed",
    "scantily clad", "scantily dressed", "sex", "sexy", "sexual*", "sexually", "sexualized", "sexualised", "sensual*",
    "seductive", "provocative", "suggestive", "lingerie", "underwear", "panties", "thong", "fetish", "bdsm",
    "bondage", "nipple*", "breasts", "boobs", "tits", "genital*", "vagina", "penis", "pussy", "crotch", "upskirt",
    "cleavage", "lewd", "*hentai*", "ecchi", "orgasm*", "masturb*", "cum", "ahegao", "blowjob*", "blow job*",
    "handjob*", "hand job*", "footjob*", "foot job*", "titjob*", "titfuck*", "rimjob*", "fellat*", "cunniling*",
    "anilingus", "intercourse", "coitus", "copulat*", "sodomy", "sodomiz*", "sodomis*", "semen", "sperm", "ejaculat*",
    "cumshot*", "cum shot*", "creampie*", "bukkake", "gangbang*", "gang bang*", "orgy", "orgies", "threesome*",
    "bestiality", "zoophil*", "incest*", "fisting", "dildo*", "butt plug*", "buttplug*", "vulva*", "labia", "clitor*",
    "clit", "clits", "areola*", "scrotum*", "testicle*", "phallus*", "pubic hair", "pubes", "private parts",
    "intimate parts", "molest*", "raped", "raping", "rapist*", "prostitut*", "stripper*", "striptease*",
    "strip tease*", "lap dance*", "making love", "make love", "touching himself", "touching herself",
    "touching themselves", "lifting her skirt", "lifts her skirt", "lifted her skirt", "skirt lift*", "camel toe",
    "nip slip", "skinny dipping", "in the buff", "nudis*", "naturist*", "milf", "milfs", "slut*", "whore*",
    "futanari", "shemale*", "dominatrix", "ball gag*", "ballgag*", "anal", "anus", "nudite", "denud*", "deshabill*",
    "sans vetement*", "sans habit*", "a poil", "seins nus", "sein nu", "sexe", "sexuel*", "erotique*", "*pornograph*",
    "*pornograf*", "sensuel*", "seducteur", "provocant*", "soutien gorge", "seins", "tout nu", "toute nue",
    "sous vetement*", "en culotte", "en string", "en slip", "en calecon", "en petite tenue", "devetu*", "tenue d eve",
    "tenue d adam", "plus simple appareil", "sans rien sur le dos", "nuisette*", "sodomie", "fellation", "violee",
    "violees", "attouchement*", "partouze*", "*desnud*", "sin ropa", "en cueros", "sexo", "lenceria", "ropa interior",
    "bragas", "tanga", "provocativ*", "senos", "tetas", "calzon", "calzoncillo*", "calzoncito*", "en pelotas",
    "sin nada puesto", "ropa intima", "follar", "follando", "abuso sexual", "*nackt*", "ausgezogen", "entkleidet",
    "unbekleidet", "oben ohne", "ohne kleidung", "ohne kleider", "erotisch*", "sexuell*", "unterwasche", "sinnlich*",
    "verfuhrerisch*", "busen", "titten", "unterhose*", "schlupfer*", "reizwasche", "entblosst*", "barbusig*",
    "nackig*", "fkk", "geschlechtsverkehr", "vergewaltig*", "ficken", "fickt", "gefickt", "seminu", "seminus",
    "seminua", "seminuas", "seminude*", "seminudo*", "seminuda*", "seminudi", "sem roupa*", "calcinha*",
    "roupa intima", "peitos", "seios", "pelad*", "de cueca", "de cuecas", "em cueca", "em cuecas", "despido",
    "despida", "despidos", "despidas", "nuazinh*", "trajes intimos", "estupr*", "nudo", "nudi", "nudita", "spogliat",
    "spogliata", "spogliato", "spogliati", "spogliate", "spogliarsi", "spogliarell*", "svestit*", "senza vestiti",
    "senza vestito", "senza abiti", "seno nudo", "seni nudi", "nuda", "sessuale", "sesso", "mutande", "mutandin*",
    "mutandon*", "provocante", "seni", "tette", "biancheria intima", "perizoma", "seno scoperto",
    "senza niente addosso", "nudin*", "in slip", "*ciplak*", "soyunmus", "soyunuk", "seks", "seksi", "seksuel*",
    "erotik*", "ic camasir*", "kulot*", "tecavuz*", "taciz*", "cinsel*", "mustehcen*", "naakt*", "ontkleed*",
    "ondergoed*", "seksueel*", "nagie", "nago", "nagich", "nagosc*", "rozebran*", "bielizn*", "seksualn*",
    "telanjang", "bugil", "cabul*", "pakaian dalam", "pemerkosa*", "mesum", "khoa than", "khieu dam", "do lot",
    "hiep dam",
)

NU_EXACTS = (
    "nu", "nue", "nus", "nues", "nua", "nuas",
)

NU_MOYEN = (
    "bikini*", "swimsuit", "swim suit", "bra", "brassiere", "shirtless", "without a shirt", "without shirt",
    "no shirt", "no top", "without top", "without a top", "without pants", "no pants", "without underwear",
    "no underwear", "diaper only", "sin camisa", "sin camiseta", "sin blusa", "sans haut", "sans t shirt",
    "sans tee shirt", "maillot de bain", "ohne hemd", "ohne oberteil", "badeanzug", "sem camisa", "sem blusa",
    "biquini", "senza maglia", "senza maglietta", "costume da bagno", "without a skirt", "without skirt", "no skirt",
    "see through dress", "see through shirt", "see through top", "see through clothes", "see through clothing",
    "see through outfit", "transparent clothes", "transparent clothing", "transparent dress", "wet t shirt",
    "wet tshirt", "wet shirt", "exposed chest", "exposed torso", "exposed body", "boxer shorts", "boxer briefs",
    "in boxers", "tighty whities", "couche culotte*", "tenue legere", "tenue transparente", "poca ropa",
    "traje de bano", "sujetador*", "sosten", "torse nu", "torses nus", "badehose*", "ohne hose", "sutia",
    "roupa transparente", "sem camiseta", "reggiseno", "pigiama trasparente", "calzones", "underpants", "undies",
    "swimwear", "swim trunks", "swimming trunks", "speedo", "speedos", "in briefs", "in his briefs", "in her briefs",
    "in their briefs", "swimsuits", "swim suits", "bathing suit", "bathing suits", "swimming costume*",
)

NU_FAIBLE_PLANCHER = (
    "bath", "bathing", "shower", "showering", "intimate", "revealing", "bain", "banho", "bano", "badewanne", "bagno",
    "douche", "ducha", "dusche", "doccia", "chuveiro", "changing clothes", "getting changed", "only a towel",
    "only in a towel", "just a towel", "solo con una toalla", "solo una toalla", "nothing but a towel", "towel only",
    "knickers",
)

NU_FAIBLE_GENERAL = (
    "bed", "bedroom",
)

SEXE_MINEUR_FORT = (
    "dick", "dicks", "erection*", "boner*", "hardon*", "penetrating her", "penetrating him", "being penetrated",
    "spread legs", "spreading her legs", "spread her legs", "legs spread", "viol", "brothel*", "foursome*", "cock",
    "cocks",
)

VIOLENCE_ENFANT_PLANCHER = (
    "abuse*", "abusing", "hurt", "hurting", "beaten", "beating", "beat up", "punch*", "slap*", "whip*", "torture*",
    "tortur*", "rape", "rapes", "raped", "raping", "molest*", "strangl*", "suffocat*", "mutilat*", "dismember*",
    "murder*", "frapp*", "battu*", "maltrait*", "viole", "violee", "violer", "agress*", "abus", "abuso*",
    "misshandl*", "missbrauch*", "spank*", "gagged", "istismar*",
)

PLANCHER_MOTS = (
    "pedophil*", "paedophil*", "pedofil*", "pedoporn*", "pedocrim*", "pedopornograf*", "padophil*", "lolicon*",
    "loli", "lolis", "shota", "shotas", "shotacon*", "child abuse", "child porn*", "childporn*", "child sex*",
    "child rape", "child exploitation", "kid porn*", "kiddie porn*", "kiddy porn*", "baby porn*", "underage porn*",
    "underage sex*", "underage nude*", "csam", "jailbait", "toddler abuse", "infant abuse", "toddlercon", "babycon",
    "kinderporno*", "kindesmissbrauch", "kinderschander", "pornografia infantil", "porno infantil", "pornoinfantil",
    "abuso infantil", "abuso sexual infantil", "pornographie enfantine", "pornografia minorile", "cocuk porno*",
    "cocuk istismari", "pornografia dziecieca", "pornografi anak", "khieu dam tre em", "kindermisbruik", "pedofiel*",
    "nymphet*", "barnporr*", "barnporn*", "borneporno*", "lapsiporno*", "gyermekporno*", "detska pornografie",
    "detske porno*", "dziecieca pornografia",
)

PLANCHER_COLLES = (
    "pedophil", "paedophil", "pedofil", "lolicon", "shotacon", "childporn", "childabuse", "childsexualabuse",
    "toddlerabuse", "infantabuse", "kidporn", "kiddieporn", "kiddyporn", "childsex", "kinderporno",
    "kindesmissbrauch", "kinderschander", "pornoinfantil", "pornografiainfantil", "pedopornograph", "pedopornograf",
    "pedocriminel", "jailbait", "underageporn", "underagesex",
)

PLANCHER_UNICODE = (
    "*\u043f\u0435\u0434\u043e\u0444\u0438\u043b*",
    "*\u0434\u0435\u0442\u0441\u043a\u043e\u0435 \u043f\u043e\u0440\u043d\u043e*",
    "*\u0434\u0435\u0442\u0441\u043a\u0430\u044f \u043f\u043e\u0440\u043d\u043e*",
    "*\u0434\u0435\u0442\u0441\u043a\u043e\u0433\u043e \u043f\u043e\u0440\u043d\u043e*", "*\u30ed\u30ea\u30b3\u30f3*",
    "*\u30b7\u30e7\u30bf\u30b3\u30f3*", "*\u5150\u7ae5\u30dd\u30eb\u30ce*", "*\u5152\u7ae5\u8272\u60c5*",
    "*\u513f\u7ae5\u8272\u60c5*", "*\u604b\u7ae5*", "*\u6200\u7ae5*", "*\uc544\ub3d9 \ud3ec\ub974\ub178*",
    "*\uc544\ub3d9\ud3ec\ub974\ub178*", "*\uc544\ub3d9 \uc74c\ub780\ubb3c*", "*\uc544\ub3d9\uc74c\ub780\ubb3c*",
    "*\u0627\u0628\u0627\u062d\u064a\u0629 \u0627\u0644\u0627\u0637\u0641\u0627\u0644*",
    "*\u0627\u0628\u0627\u062d\u064a\u0629 \u0627\u0637\u0641\u0627\u0644*",
    "*\u092c\u093e\u0932 \u092a\u094b\u0930\u094d\u0928*",
    "*\u092c\u093e\u0932 \u0905\u0936\u094d\u0932\u0940\u0932*",
    "*\u092c\u093e\u0932 \u092f\u094c\u0928 \u0936\u094b\u0937\u0923*",
)

MINEURS_FORT_UNICODE = (
    "*\u513f\u7ae5*", "*\u5152\u7ae5*", "*\u5b69\u5b50*", "*\u5c0f\u5b69*", "*\u5e7c\u5973*", "*\u5e7c\u7ae5*",
    "*\u5e7c\u513f*", "*\u5e7c\u5152*", "*\u5a74\u513f*", "*\u5b30\u5152*", "*\u5b9d\u5b9d*", "*\u5bf6\u5bf6*",
    "*\u672a\u6210\u5e74*", "*\u5c0f\u5b66\u751f*", "*\u5c0f\u5b78\u751f*", "*\u4e2d\u5b66\u751f*",
    "*\u4e2d\u5b78\u751f*", "*\u521d\u4e2d\u751f*", "*\u5c0f\u5973\u5b69*", "*\u5c0f\u7537\u5b69*", "*\u841d\u8389*",
    "*\u863f\u8389*", "*\u6b63\u592a*", "*\u5b50\u4f9b*", "*\u5b50\u3069\u3082*", "*\u3053\u3069\u3082*",
    "*\u5150\u7ae5*", "*\u5e7c\u5150*", "*\u4e73\u5150*", "*\u8d64\u3061\u3083\u3093*", "*\u8d64\u3093\u574a*",
    "\u30ed\u30ea", "*\u30ed\u30ea\u3063\u5b50*", "*\u30b7\u30e7\u30bf*", "*\u5341\u4ee3*", "*\u5712\u5150*",
    "*\uc5b4\ub9b0\uc774*", "*\uc544\ub3d9*", "*\uc5b4\ub9b0\uc544\uc774*", "*\uc5ec\uc790\uc544\uc774*",
    "*\ub0a8\uc790\uc544\uc774*", "*\uc544\uae30*", "*\uc720\uc544*", "*\ubbf8\uc131\ub144*",
    "*\ucd08\ub4f1\ud559\uc0dd*", "*\uc911\ud559\uc0dd*", "\ub85c\ub9ac", "\uc1fc\ud0c0", "\uc544\uc774",
    "\uc544\uc774\uac00", "\uc544\uc774\ub294", "\uc544\uc774\ub97c", "\uc544\uc774\uc758", "\uc544\uc774\uc640",
    "\uc544\uc774\ub4e4*", "*\u0637\u0641\u0644*", "*\u0623\u0637\u0641\u0627\u0644*", "*\u0631\u0636\u064a\u0639*",
    "*\u0642\u0627\u0635\u0631*", "*\u0645\u0631\u0627\u0647\u0642*", "\u0635\u0628\u064a",
    "\u0627\u0644\u0635\u0628\u064a", "\u0635\u0628\u064a\u0629", "\u092c\u091a\u094d\u091a*",
    "\u092c\u093e\u0932\u0915", "\u092c\u093e\u0932\u0915\u094b\u0902", "\u092c\u093e\u0932\u093f\u0915\u093e",
    "\u092c\u093e\u0932\u093f\u0915\u093e\u090f\u0902", "\u092c\u093e\u0932\u093f\u0915\u093e\u090f\u0901",
    "\u092c\u093e\u0932\u093f\u0915\u093e\u0913\u0902", "\u0936\u093f\u0936\u0941*",
    "\u0928\u093e\u092c\u093e\u0932\u093f\u0917*", "\u0440\u0435\u0431\u0451\u043d\u043e\u043a",
    "\u0440\u0435\u0431\u0451\u043d\u043a*", "\u0440\u0435\u0431\u0435\u043d\u043e\u043a",
    "\u0440\u0435\u0431\u0435\u043d\u043a*", "\u0434\u0435\u0442\u0438", "\u0434\u0435\u0442\u0435\u0439",
    "\u0434\u0435\u0442\u044f\u043c", "\u0434\u0435\u0442\u044c\u043c\u0438", "\u0434\u0435\u0442\u044f\u0445",
    "\u0434\u0435\u0442\u0441\u043a*", "\u0434\u0435\u0442\u0438\u0448\u043a*", "\u043c\u0430\u043b\u044b\u0448*",
    "\u043c\u043b\u0430\u0434\u0435\u043d*", "\u0434\u0435\u0432\u043e\u0447\u043a*",
    "\u043c\u0430\u043b\u044c\u0447\u0438\u043a*", "\u0448\u043a\u043e\u043b\u044c\u043d\u0438\u0446*",
    "\u0448\u043a\u043e\u043b\u044c\u043d\u0438\u043a*", "\u043f\u043e\u0434\u0440\u043e\u0441\u0442*",
    "\u043d\u0435\u0441\u043e\u0432\u0435\u0440\u0448\u0435\u043d\u043d\u043e\u043b\u0435\u0442\u043d*",
    "\u043c\u0430\u043b\u043e\u043b\u0435\u0442\u043d*", "\u0434\u0438\u0442\u044f",
    "\u0434\u0438\u0442\u0438\u043d*", "\u0434\u0438\u0442\u044f\u0447*", "\u0434\u0456\u0442\u0438",
    "\u0434\u0456\u0442\u0435\u0439", "\u0434\u0456\u0432\u0447\u0438\u043d\u043a*",
    "\u0445\u043b\u043e\u043f\u0447\u0438\u043a*", "*\U0001f476*", "*\U0001f9d2*",
)

MINEURS_AMBIGUS_UNICODE = (
    "*\u5973\u5b69*", "*\u7537\u5b69*", "*\u5c11\u5973*", "*\u5c11\u5e74*", "*\u5973\u306e\u5b50*",
    "*\u7537\u306e\u5b50*", "*\uc18c\ub140*", "*\uc18c\ub144*", "\u0641\u062a\u0627\u0629",
    "\u0627\u0644\u0641\u062a\u0627\u0629", "\u0628\u0646\u062a", "\u0627\u0644\u0628\u0646\u062a",
    "\u0628\u0646\u0627\u062a", "\u0648\u0644\u062f", "\u0627\u0644\u0648\u0644\u062f",
    "\u0623\u0648\u0644\u0627\u062f", "\u0627\u0644\u0623\u0648\u0644\u0627\u062f",
    "\u0627\u0644\u0628\u0646\u0627\u062a", "\u0932\u0921\u093c\u0915*", "\u0932\u0921\u0915*",
    "\u0915\u093f\u0936\u094b\u0930*", "*\U0001f467*", "*\U0001f466*",
)

NU_FORT_UNICODE = (
    "*\u88f8\u4f53*", "*\u88f8\u9ad4*", "*\u5168\u88f8*", "*\u534a\u88f8*", "*\u88f8\u9732*", "*\u88f8\u7167*",
    "*\u88f8\u5973*", "*\u88f8\u7537*", "*\u88f8\u8eab*", "*\u8d64\u88f8*", "*\u4e00\u4e1d\u4e0d\u6302*",
    "*\u4e00\u7d72\u4e0d\u639b*", "*\u6ca1\u7a7f\u8863\u670d*", "*\u6c92\u7a7f\u8863\u670d*",
    "*\u4e0d\u7a7f\u8863\u670d*", "*\u8131\u5149*", "*\u812b\u5149*", "*\u8272\u60c5*", "*\u60c5\u8272*",
    "*\u5185\u8863*", "*\u5167\u8863*", "*\u5185\u88e4*", "*\u5167\u8932*", "*\u6027\u4ea4*", "*\u505a\u7231*",
    "*\u505a\u611b*", "*\u53e3\u4ea4*", "*\u5f3a\u5978*", "*\u5f37\u59e6*", "*\u5f37\u66b4*", "*\u7325\u4eb5*",
    "*\u7325\u893b*", "*\u81ea\u6170*", "*\u9634\u9053*", "*\u9670\u9053*", "*\u9634\u830e*", "*\u9670\u8396*",
    "*\u4e73\u5934*", "*\u4e73\u982d*", "*\u6deb*", "*\u88f8*", "*\u88f8\u306e*", "*\u88f8\u3067*", "*\u88f8\u306b*",
    "*\u306f\u3060\u304b*", "*\u30cc\u30fc\u30c9*", "*\u30bb\u30c3\u30af\u30b9*", "*\u30dd\u30eb\u30ce*",
    "*\u30a8\u30ed\u3044*", "*\u30a8\u30ed\u753b*", "*\u30a8\u30ed\u6f2b*", "*\u30a8\u30ed\u540c\u4eba*",
    "*\u30a8\u30c3\u30c1\u306a*", "*\u4e0b\u7740*", "*\u30d1\u30f3\u30c6\u30a3*", "*\u6027\u7684\u306a*",
    "*\u6027\u7684\u306b*", "*\u304a\u3063\u3071\u3044*", "*\u4e73\u9996*", "*\u30ec\u30a4\u30d7*", "*\u75f4\u6f22*",
    "*\u63f4\u4ea4*", "*\u63f4\u52a9\u4ea4\u969b*", "*\u8131\u8863*", "*\u670d\u3092\u7740\u3066\u3044\u306a\u3044*",
    "*\ubc8c\uac70\ubc97*", "*\uc54c\ubab8*", "*\ub098\uccb4*", "*\ub204\ub4dc*", "*\uc139\uc2a4*",
    "*\uc131\uad00\uacc4*", "*\uc131\ud589\uc704*", "*\uc74c\ub780*", "*\ud3ec\ub974\ub178*", "*\uc57c\ub3d9*",
    "*\uc18d\uc637*", "*\ud32c\ud2f0*", "*\uac15\uac04*", "*\uc131\ud3ed\ud589*", "*\uc131\ucd94\ud589*",
    "*\uc790\uc704\ud558*", "*\uc790\uc704\ud589\uc704*", "*\uc816\uaf2d\uc9c0*", "*\uc0dd\uc2dd\uae30*",
    "*\u0639\u0627\u0631\u064a*", "\u0639\u0627\u0631", "*\u0639\u0631\u064a\u0627\u0646*",
    "*\u0639\u0631\u0627\u0629*", "*\u0645\u062a\u0639\u0631\u064a*", "\u0627\u0644\u062a\u0639\u0631\u064a",
    "\u0639\u0631\u064a", "*\u0628\u062f\u0648\u0646 \u0645\u0644\u0627\u0628\u0633*",
    "*\u0628\u0644\u0627 \u0645\u0644\u0627\u0628\u0633*",
    "*\u0645\u0644\u0627\u0628\u0633 \u062f\u0627\u062e\u0644\u064a\u0629*",
    "*\u0645\u0645\u0627\u0631\u0633\u0629 \u0627\u0644\u062c\u0646\u0633*",
    "*\u0627\u0639\u062a\u062f\u0627\u0621 \u062c\u0646\u0633\u064a*", "*\u062c\u0646\u0633\u064a\u0627*",
    "*\u0625\u0628\u0627\u062d\u064a*", "*\u0628\u0648\u0631\u0646\u0648*", "\u0628\u0648\u0631\u0646",
    "*\u0627\u063a\u062a\u0635\u0627\u0628*", "*\u062a\u062d\u0631\u0634*", "*\u0639\u0648\u0631\u0629*",
    "*\u0645\u0647\u0628\u0644*", "*\u0627\u0633\u062a\u0645\u0646\u0627\u0621*", "\u0633\u0643\u0633",
    "\u0928\u0917\u094d\u0928*", "\u0928\u0902\u0917\u093e", "\u0928\u0902\u0917\u0940", "\u0928\u0902\u0917\u0947",
    "\u0928\u093f\u0930\u094d\u0935\u0938\u094d\u0924\u094d\u0930*", "\u092c\u093f\u0928\u093e \u0915\u092a\u0921*",
    "\u0915\u092a\u0921\u093c\u0947 \u0928\u0939\u0940\u0902", "\u0915\u092a\u0921\u0947 \u0928\u0939\u0940\u0902",
    "*\u0905\u0936\u094d\u0932\u0940\u0932*", "*\u092a\u094b\u0930\u094d\u0928*", "\u0938\u0947\u0915\u094d\u0938*",
    "\u092f\u094c\u0928*", "*\u092c\u0932\u093e\u0924\u094d\u0915\u093e\u0930*",
    "*\u0905\u0902\u0924\u0930\u094d\u0935\u0938\u094d\u0924\u094d\u0930*", "\u0915\u093e\u092e\u0941\u0915*",
    "*\u0939\u0938\u094d\u0924\u092e\u0948\u0925\u0941\u0928*", "\u0433\u043e\u043b\u044b\u0439",
    "\u0433\u043e\u043b\u0430\u044f", "\u0433\u043e\u043b\u043e\u0435", "\u0433\u043e\u043b\u044b\u0435",
    "\u0433\u043e\u043b\u043e\u0433\u043e", "\u0433\u043e\u043b\u043e\u0439", "\u0433\u043e\u043b\u044b\u043c",
    "\u0433\u043e\u043b\u0443\u044e", "\u0433\u043e\u043b\u044b\u0445", "\u0433\u043e\u043b\u044b\u043c\u0438",
    "\u0433\u043e\u043b\u0435\u043d\u044c\u043a*", "\u0433\u043e\u043b\u044b\u0448\u043e\u043c",
    "\u043e\u0431\u043d\u0430\u0436\u0451\u043d\u043d*", "\u043d\u0430\u0433\u043e\u0439",
    "\u043d\u0430\u0433\u0430\u044f", "\u043d\u0430\u0433\u043e\u0435", "\u043d\u0430\u0433\u0438\u0435",
    "\u043d\u0430\u0433\u0443\u044e", "\u043d\u0430\u0433\u0438\u0448\u043e\u043c",
    "\u0440\u0430\u0437\u0434\u0435\u0442*", "\u0440\u0430\u0437\u0434\u0435\u0432\u0430\u0435\u0442\u0441\u044f",
    "\u0440\u0430\u0437\u0434\u0435\u0432\u0430\u0442\u044c\u0441\u044f",
    "\u0440\u0430\u0437\u0434\u0435\u0432\u0430\u044e\u0449*",
    "\u0431\u0435\u0437 \u043e\u0434\u0435\u0436\u0434\u044b", "\u0441\u0435\u043a\u0441",
    "\u0441\u0435\u043a\u0441\u0430", "\u0441\u0435\u043a\u0441\u043e\u043c", "\u0441\u0435\u043a\u0441\u0443",
    "\u0441\u0435\u043a\u0441\u0443\u0430\u043b\u044c\u043d*", "\u043f\u043e\u0440\u043d*",
    "\u044d\u0440\u043e\u0442*", "\u043d\u0438\u0436\u043d\u0435\u0435 \u0431\u0435\u043b\u044c\u0451",
    "\u043d\u0438\u0436\u043d\u0435\u043c \u0431\u0435\u043b\u044c\u0435",
    "\u043d\u0438\u0436\u043d\u0435\u0433\u043e \u0431\u0435\u043b\u044c\u044f",
    "\u0442\u0440\u0443\u0441\u0438\u043a*", "\u0432 \u0442\u0440\u0443\u0441\u0430\u0445",
    "\u043c\u0438\u043d\u0435\u0442*", "\u0438\u0437\u043d\u0430\u0441\u0438\u043b*",
    "\u043c\u0430\u0441\u0442\u0443\u0440\u0431*", "\u043f\u043e\u043b\u043e\u0432\u043e\u0439 \u0430\u043a\u0442",
    "\u043f\u043e\u043b\u043e\u0432\u044b\u0435 \u043e\u0440\u0433\u0430\u043d\u044b",
    "\u043f\u043e\u043b\u043e\u0432\u044b\u0445 \u043e\u0440\u0433\u0430\u043d\u043e\u0432",
    "\u0433\u0435\u043d\u0438\u0442\u0430\u043b\u0438\u0438", "\u043f\u0435\u043d\u0438\u0441*",
    "\u0432\u0430\u0433\u0438\u043d*", "\u0441\u043e\u0432\u043e\u043a\u0443\u043f\u043b\u0435*",
    "\u0441\u043e\u0432\u043e\u043a\u0443\u043f\u043b\u044f*", "\u0440\u0430\u0441\u0442\u043b\u0435\u043d*",
    "\u0433\u043e\u043b\u0438\u0439", "\u0433\u043e\u043b\u0435", "\u0433\u043e\u043b\u0456",
    "\u043e\u0433\u043e\u043b\u0435\u043d*", "*\U0001f51e*",
)

NU_SUGGESTIF_UNICODE = (
    "*\u6027\u611f*", "*\u30bb\u30af\u30b7\u30fc*", "*\uc139\uc2dc*", "\uc57c\ud55c",
    "\u0441\u0435\u043a\u0441\u0438", "\u0441\u0435\u043a\u0441\u0430\u043f\u0438\u043b\u044c\u043d*",
    "*\u0645\u062b\u064a\u0631\u0629 \u062c\u0646\u0633\u064a\u0627*",
)

NU_MOYEN_UNICODE = (
    "*\u6bd4\u57fa\u5c3c*", "*\u6cf3\u88c5*", "*\u6cf3\u88dd*", "*\u6cf3\u8863*", "*\u30d3\u30ad\u30cb*",
    "*\u6c34\u7740*", "*\u30b9\u30af\u6c34*", "*\ube44\ud0a4\ub2c8*", "*\uc218\uc601\ubcf5*",
    "*\u0628\u0643\u064a\u0646\u064a*", "*\u0645\u0627\u064a\u0648\u0647*",
    "*\u0645\u0644\u0627\u0628\u0633 \u0627\u0644\u0633\u0628\u0627\u062d\u0629*",
    "\u092c\u093f\u0915\u093f\u0928\u0940*", "\u0938\u094d\u0935\u093f\u092e\u0938\u0942\u091f*",
    "\u091a\u0921\u094d\u0921\u0940*", "\u0431\u0438\u043a\u0438\u043d\u0438",
    "\u043a\u0443\u043f\u0430\u043b\u044c\u043d\u0438\u043a*", "*\U0001f459*", "*\U0001fa72*", "*\U0001fa71*",
)

NU_FAIBLE_UNICODE = (
    "*\u6d17\u6fa1*", "*\u6dcb\u6d74*", "*\u304a\u98a8\u5442*", "*\u5165\u6d74*", "*\u30b7\u30e3\u30ef\u30fc*",
    "*\ubaa9\uc695*", "*\uc0e4\uc6cc*", "*\u0627\u0633\u062a\u062d\u0645\u0627\u0645*", "\u0928\u0939\u093e*",
    "\u0434\u0443\u0448", "\u0434\u0443\u0448\u0435", "\u0432 \u0432\u0430\u043d\u043d\u0435",
    "\u043a\u0443\u043f\u0430*",
)

VIOLENCE_UNICODE = (
    "*\u8650\u5f85*", "*\u6bb4\u6253*", "*\u6bc6\u6253*", "*\ud559\ub300*", "*\ud3ed\ud589*",
    "*\u062a\u0639\u0630\u064a\u0628*", "\u0936\u094b\u0937\u0923*", "\u092e\u093e\u0930\u092a\u0940\u091f*",
    "\u0438\u0437\u0431\u0438\u0435\u043d\u0438*", "\u043d\u0430\u0441\u0438\u043b\u0438*",
    "\u0438\u0441\u0442\u044f\u0437\u0430\u043d*",
)

SERIE_MINEURS = (
    "kind", "child", "kid", "girl", "boy", "teen", "baby", "infant", "toddler", "schoolgirl", "young", "preteen",
    "minor", "enfant", "fille", "garcon", "nino", "nina", "kinder", "madchen", "bambin", "crianca", "menina",
    "menino",
)

SERIE_NUDITE = (
    "nude", "naked", "topless", "undress", "sexy", "porn", "bikini", "lingerie", "panties", "underwear", "nsfw",
    "erotic", "sensual", "seductive", "shirtless", "desnud", "nackt", "nuda", "nudo", "nua", "sexual",
    "withoutclothes", "noclothes", "wearingnothing",
)

COLLE_MINEURS = (
    "child", "children", "childs", "kid", "kids", "kiddie", "kiddy", "baby", "babies", "toddler", "toddlers",
    "infant", "infants", "preteen", "preteens", "teen", "teens", "teenage", "teenager", "schoolgirl", "schoolgirls",
    "schoolboy", "schoolboys", "girl", "girls", "boy", "boys", "littlegirl", "littleboy", "younggirl", "youngboy",
    "loli", "shota", "underage", "minor", "minors", "enfant", "enfants", "fillette", "fillettes", "gamin", "gamine",
    "bebe", "bebes", "nino", "nina", "ninos", "ninas", "nene", "nena", "kinder", "kind", "madchen", "maedchen",
    "bambino", "bambina", "bambini", "bambine", "bimba", "garcon", "garcons", "garconnet", "fille", "filles",
    "crianca", "criancas", "menina", "menino", "meninas", "meninos", "ragazzina", "ragazzino", "cocuk", "dziecko",
)

COLLE_NUDITE = (
    "naked", "nude", "nudes", "nudity", "nackt", "nackte", "nackter", "nacktes", "nackten", "desnudo", "desnuda",
    "desnudos", "desnudas", "topless", "bottomless", "undressed", "undressing", "undress", "lingerie", "panties",
    "bikini", "porn", "porno", "sexy", "sexual", "erotic", "erotica", "hentai", "nsfw", "nipple", "nipples",
    "genitals", "vagina", "penis", "pussy", "blowjob", "handjob", "footjob", "fellatio", "cunnilingus", "semen",
    "sperm", "orgasm", "masturbating", "masturbation", "molested", "raped", "ciplak", "naakt", "pelada", "pelado",
    "pelados", "seminua", "seminude", "nudo", "nuda", "nudi",
)

COLLE_NUDITE_BORD = (
    "nu", "nue", "nus", "nues", "nua", "nuas", "sex",
)

NOMBRES_LETTRES = (
    "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen",
    "fourteen", "fifteen", "sixteen", "seventeen", "un", "une", "deux", "trois", "quatre", "cinq", "sept", "huit",
    "neuf", "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize", "dix sept", "uno", "una", "dos", "tres",
    "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce", "trece", "catorce", "quince",
    "dieciseis", "diecisiete", "diez y seis", "diez y siete", "ein", "eine", "eins", "zwei", "drei", "vier", "funf",
    "sechs", "sieben", "acht", "neun", "zehn", "elf", "zwolf", "dreizehn", "vierzehn", "funfzehn", "sechzehn",
    "siebzehn", "fuenf", "zwoelf", "fuenfzehn", "um", "uma", "dois", "duas", "sete", "oito", "dez", "doze", "treze",
    "catorze", "dezesseis", "dezasseis", "dezessete", "dezassete", "due", "tre", "quattro", "cinque", "sei", "sette",
    "otto", "dieci", "undici", "dodici", "tredici", "quattordici", "quindici", "sedici", "diciassette",
)

NOMBRES_AMBIGUS = (
    "elf", "um", "uma", "un", "une", "uno", "una", "ein", "eine", "eins", "one", "tre", "tres", "sei", "due", "dos",
    "once", "neuf", "sept", "otto",
)

GRANDS_NOMBRES = (
    "[0-9]", "thousands?", "hundreds?", "millions?", "billions?", "dozens?", "mille", "milles", "cents?", "milliers?",
    "milliards?", "mil", "miles", "millones", "millon", "tausend", "hundert", "millionen", "milliarden", "mila",
    "cento", "centinaia", "milioni", "centenas?", "centenares", "milhares", "milhoes", "milhao",
)

UNITES_AGE = (
    "yo", "y o", "yr old", "yrs old", "yr o", "years? old", "year olds?", "yearold", "yrold", "years? of age",
    "yrs? of age", "years? young", "yrs? young", "months? old", "jahre alt", "jahrig[a-z]*", "j alt", "monate alt",
    "yasinda[a-z]*", "jaar oud", "jarig[a-z]*", "letni[a-z]*", "lat", "tahun", "tuoi",
)

UNITES_AGE_ROMANES = (
    "ans", "anos", "anni", "mois", "meses", "mesi",
)

COMPLEMENTS_DE = (
    "de", "d", "du", "des", "del", "di", "da", "do", "della", "dei", "dos", "das",
)

PREFIXES_AGE = (
    "aged?", "age of", "ages", "age de", "agee de", "agee", "edad de", "edad", "alter von", "alter", "eta di",
    "idade de", "idade", "just turned",
)

NOMBRES_COMPOSES_DE = (
    "ein", "zwei", "drei", "vier", "funf", "fuenf", "sechs", "sieben", "acht", "neun", "zehn", "elf", "zwolf",
    "zwoelf", "dreizehn", "vierzehn", "funfzehn", "fuenfzehn", "sechzehn", "siebzehn",
)

PREFIXES_NAISSANCE = (
    "born", "born in", "ne en", "nee en", "nacido en", "nacida en", "geboren", "geboren im jahr", "nato nel",
    "nata nel", "nascido em", "nascida em",
)

UNITES_AGE_UNICODE = (
    "\u5c81", "\u6b72", "\u6b73", "\u624d", "\uc0b4(?:\uc758|\uc9dc\ub9ac)?(?![\uac00-\ud7a3])",
    "\uc138(?:\uc758|\uc9dc\ub9ac)?(?![\uac00-\ud7a3])", "\u043b\u0435\u0442", "\u0433\u043e\u0434\u0430",
    "\u0433\u043e\u0434\u0438\u043a", "\u043b\u0435\u0442\u043d", "\u0433\u043e\u0434\u043e\u0432\u0430\u043b",
    "\u0440\u043e\u043a\u0456\u0432", "\u0440\u043e\u043a\u0438", "\u0440\u0456\u0447\u043d",
    "\u0633\u0646\u0648\u0627\u062a", "\u0633\u0646\u0647", "\u0633\u0646\u064a\u0646", "\u0639\u0627\u0645",
    "\u0627\u0639\u0648\u0627\u0645", "\u0938\u093e\u0932", "\u0935\u0930\u094d\u0937",
)

PREFIXES_AGE_UNICODE = (
    "\u0639\u0645\u0631\u0647", "\u0639\u0645\u0631\u0647\u0627", "\u0628\u0639\u0645\u0631",
    "\u0909\u092e\u094d\u0930",
)

IDIOMES = (
    "snaked", "pornic", "nacktkatzen?",
)

EXPRESSIONS_SURES = (
    "baby !shower", "bridal !shower", "meteor !shower",
    "!showers? of (?:arrows?|sparks?|rain|meteors?|stars?|petals?|flowers?|coins?|gold|confetti|bullets?|debris|rocks?|stones?|fire|embers?|light|glass|leaves|snow|ice|ash|ashes|hail|gifts?)",
    "!chinks? in", "!chinks? of light", "!bath toys?", "!suicide squad", "!snuff box(?:es)?", "!snuff bottles?",
    "!bikini atoll", "!bikini bottom", "!nu metal", "!anal retentive", "!hit points?", "!hit box(?:es)?",
    "critical !hits?", "!scream masks?", "!attack (?:pose|poses|animation|animations|stance|move|moves)",
    "toy !(?:guns?|swords?|knife|knives|weapons?|bows?)", "water !guns?", "nerf !guns?", "squirt !guns?",
    "cap !guns?", "!bedroom (?:furniture|set|sets|decor|decoration|lamp|wallpaper|interior|design)",
    "!suicide doors?", "!opium popp(?:y|ies)", "!gore tex", "counter !terrorists?", "counter !terrorism",
    "anti !terrorists?", "!(?:knife|knives) and forks?", "bunk !beds?", "hospital !beds?", "!spanking new",
    "!sperm whales?", "bottle !nipples?", "!pussy cats?", "!pussy willows?", "moby !dick", "!dick whittington",
    "!anal fins?", "!cum laude", "wild !ass(?:es)?", "!senos? paranasal[a-z]*", "pieds? !nu(?:e|s|es)?",
    "!nus? pieds?", "mains? !nues?", "tetes? !nues?", "oeil !nu", "bras !nus?", "jambes? !nues?", "arbres? !nus?",
    "branches? !nues?", "murs? !nus?", "sols? !nus?", "lames? !nues?", "epees? !nues?", "fils? !nus?",
    "cables? !nus?", "!culottes? courtes?", "ciels? !nus?", "pieces? !nues?", "paredes? !nuas?", "stanz[ae] !nud[ae]",
    "mur[io] !nud[oi]", "paret[ei] !nud[ae]", "(?:paint|varnish|wire|floor|wallpaper) !strippers?",
    "(?:blank|dilated|slit|vertical|glowing|red|golden|gold|green|blue|empty|cat|catlike|feline|reptilian|snake|goat|pinpoint|eye|eyes) !pupils?",
    "!pupils? of (?:the|his|her|its|their|an|a) eyes?", "!pupils? of eyes?", "!pupils? dilat(?:ed|ing|ion|es|e)",
    "!pupil dilation",
    "(?:asia|osa|ursa|dragon|dragones|dragao|dragoes|demonio|demonios|dios|dioses|deus|deuses|deidad|deidades|golem|golems|elemental|elementales|espiritu|espiritus|espirito|espiritos|pocion|pociones|pocao|pocoes|hechizo|hechizos|feitico|feiticos|reliquia|reliquias|artefacto|artefactos|artefato|artefatos|bestia|bestias|monstruo|monstruos|monstro|monstros|jefe|jefes|chefe|chefes|enemigo|enemigos|inimigo|inimigos|arcano|arcanos|nivel|niveles|rango|rangos|grado|grados|clase|clases|calidad|nobleza|orden|liga|ligas|escala|tono|acorde|tercera|septima|sexta) !menor(?:es)?(?![^a-z0-9]+de[^a-z0-9]+(?:edad|idade|18))",
    "(?:mochila|mochilas|bolsa|bolsas|material|materiales|materiais|util|utiles|libro|libros|livro|livros|autobus|autobuses|bus|buses|onibus|transporte|transportes|edificio|edificios|predio|predios|patio|patios|comedor|comedores|refeitorio|refeitorios|bano|banos|banheiro|banheiros|aula|aulas|sala|salas|ano|anos|curso|cursos|calendario|calendarios|mesa|mesas|pupitre|pupitres|cuaderno|cuadernos|caderno|cadernos|biblioteca|bibliotecas|gimnasio|gimnasios|quadra|quadras|estuche|estuches|estojo|estojos|excursion|excursiones|sistema|sistemas|centro|centros|mapa|mapas|globo|globos) !escolar(?:es)?",
    "(?:play|plays|playing|played) (?:a|the|his|her|their|its) !viols?",
    "(?:bass|treble|tenor|alto|renaissance|baroque|antique|wooden) !viols?", "!viols? (?:da|de) gambas?",
    "!viols? (?:player|players|bow|bows|consort|consorts|strings|case|cases|music|instrument|instruments|maker|makers)",
    "!cria (?:um|uma|uns|umas|o|os|as|me|nos|isto|isso|outro|outra)",
    "(?:golf|golfing|golfers?|mixed|bridge|tennis) !foursomes?",
    "!foursomes? of (?:golfers|players|knights|heroes|adventurers|friends)",
    "<chantier> the !erections? of (?:the|a|an|this|that|these|those|its|their|our|new|great|huge|giant|stone|steel|wooden|iron) (?:tower|towers|wall|walls|castle|castles|monument|monuments|statue|statues|structure|structures|temple|temples|bridge|bridges|church|churches|cathedral|cathedrals|pyramid|pyramids|obelisk|obelisks|scaffold|scaffolds|scaffolding|tent|tents|fort|forts|fortress|barricade|barricades|palisade|palisades|fence|fences|mast|masts|pillar|pillars|column|columns|gate|gates|house|houses|building|buildings|steel|steelwork|frame|frames|framework|totem|totems|maypole|maypoles|memorial|memorials|shrine|shrines|altar|altars|arch|arches|dam|dams|dome|domes|spire|spires|stone|stones|menhir|menhirs|statuary)",
    "<chantier> the !erections? of (?:tower|towers|wall|walls|castle|castles|monument|monuments|statue|statues|structure|structures|temple|temples|bridge|bridges|church|churches|cathedral|cathedrals|pyramid|pyramids|obelisk|obelisks|scaffold|scaffolds|scaffolding|tent|tents|fort|forts|fortress|barricade|barricades|palisade|palisades|fence|fences|mast|masts|pillar|pillars|column|columns|gate|gates|house|houses|building|buildings|frame|frames|framework|totem|totems|maypole|maypoles|memorial|memorials|shrine|shrines|altar|altars|arch|arches|dam|dams|dome|domes|spire|spires|menhir|menhirs)",
    "<chantier> the !erections? (?:crew|crews|site|sites|works|team|teams|crane|cranes|phase|phases|plan|plans|stage|stages|drawing|drawings)",
    "!semen (?:gudang|bangunan|putih|abu|cor|dinding|lantai|tembok|pabrik|karung|truk|sak|beton|portland|instan|mortar)",
    "(?:pabrik|karung|sak|dinding|lantai|tembok|campuran|adukan|truk|toko|harga|gudang) !semen",
    "<coq> !cocks? (?:and|or|with|among|beside|near) (?:hens?|chickens?|chicks?|pullets?|poultry|roosters?|ducks?|geese|turkeys?|goats?|pigs?|cows?|sheep)",
    "<coq> !cocks? (?:and|or|with|among|beside|near) (?:a|an|the|two|three|four|five|six|some|many|several|its|their|[0-9]+) (?:hens?|chickens?|chicks?|pullets?|poultry|roosters?|ducks?|geese|turkeys?|goats?|pigs?|cows?|sheep)",
    "<coq> (?:hens?|chickens?|chicks?|pullets?|poultry|ducks?|geese|turkeys?) (?:and|or|with) !cocks?",
    "<coq> (?:hens?|chickens?|chicks?|pullets?|poultry|ducks?|geese|turkeys?) (?:and|or|with) (?:a|an|the|one|two|its|their) !cocks?",
    "<coq> !cocks? (?:crowing|crows|crowed|crow)", "<coq> (?:crowing|crowed) !cocks?", "<coq> weather !cocks?",
    "<coq> !cock a doodle doo", "oilseed !rapes?",
    "!rape (?:field|fields|flower|flowers|plant|plants|crop|crops|seed|seeds|oil|blossom|blossoms)",
    "fields? of !rape", "yellow !rape", "!peladas? de (?:futebol|futsal|bola|rua|praia|varzea|domingo)",
    "(?:jogo|jogos) de !peladas?", "(?:jogar|jogando|jogamos|joga) !peladas?",
)

IDIOMES_EXACTS = (
    "torses? nus?",
)

IDIOMES_UNICODE = (
    "\u88f8\u8db3", "\u88f8\u773c", "\u88f8\u8272", "\u88f8\u8f9e", "\u88f8\u5a5a", "\u88f8\u9ea6",
    "\u88f8\u5b50\u690d\u7269", "\u88f8\u7ebf", "\u88f8\u6a5f", "\u88f8\u673a", "\u88f8\u96fb\u7403",
    "\u88f8\u4e00\u8cab", "\u8131\u8863\u6240", "\u8131\u8863\u5834", "\u8131\u8863\u5ba4", "\u8131\u8863\u95f4",
    "\u8131\u8863\u9593",
)

VETEMENTS_ANIMAL = (
    "costume", "onesie", "outfit", "suit", "pajama", "pyjama", "romper", "sleeper", "jumpsuit", "hoodie", "hat",
    "mask", "dress", "clothes", "clothing", "slipper",
)

ANIMAUX_BEBE = (
    "dragon", "dino", "dinosaur", "dinosaure", "dinosaurio", "drache", "drago", "animal", "animaux", "beast",
    "creature", "monster", "monstre", "bird", "oiseau", "chick", "duck", "goose", "owl", "eagle", "hawk", "penguin",
    "parrot", "cat", "chat", "gato", "dog", "chien", "perro", "wolf", "loup", "lobo", "fox", "renard", "zorro",
    "bear", "ours", "oso", "panda", "koala", "lion", "leon", "tiger", "tigre", "leopard", "cheetah", "elephant",
    "elefante", "giraffe", "girafe", "zebra", "hippo", "rhino", "horse", "cheval", "caballo", "pony", "poney",
    "unicorn", "licorne", "unicornio", "donkey", "cow", "pig", "sheep", "goat", "deer", "rabbit", "lapin", "conejo",
    "bunny", "squirrel", "mouse", "rat", "hamster", "monkey", "singe", "gorilla", "sloth", "otter", "seal", "phoque",
    "walrus", "whale", "baleine", "ballena", "dolphin", "dauphin", "delfin", "shark", "requin", "tiburon", "fish",
    "poisson", "pez", "octopus", "turtle", "tortue", "tortuga", "tortoise", "frog", "toad", "lizard", "snake",
    "serpent", "serpiente", "crocodile", "alligator", "spider", "bat", "griffin", "gryphon", "griffon", "phoenix",
    "hydra", "wyvern", "yeti", "slime", "alien", "robot", "golem", "kraken", "chimera", "mammoth", "raptor", "insect",
    "butterfly", "bee", "ant", "crab", "lobster", "kangaroo", "camel", "llama", "alpaca", "moose", "elk", "buffalo",
    "bison", "boar", "hedgehog", "raccoon", "beaver", "badger", "weasel", "ferret",
)

ZEROS_CHIFFRES = (
    "0660", "06F0", "07C0", "0966", "09E6", "0A66", "0AE6", "0B66", "0BE6", "0C66", "0CE6", "0D66", "0DE6", "0E50",
    "0ED0", "0F20", "1040", "1090", "17E0", "1810", "1946", "19D0", "1A80", "1A90", "1B50", "1BB0", "1C40", "1C50",
    "A620", "A8D0", "A900", "A9D0", "A9F0", "AA50", "ABF0", "FF10", "104A0", "10D30", "11066", "110F0", "11136",
    "111D0", "112F0", "11450", "114D0", "11650", "116C0", "11730", "118E0", "11950", "11C50", "11D50", "11DA0",
    "16A60", "16AC0", "16B50", "1D7CE", "1D7D8", "1D7E2", "1D7EC", "1D7F6", "1E140", "1E2F0", "1E950", "1FBF0",
)

GENERAL_SEXUEL_DUR = (
    "*nude*", "nudity", "*naked*", "*nsfw*", "porn*", "xxx", "sex", "sexual*", "sexually", "sexe", "sexuel*", "sexo",
    "sesso", "sessuale", "erotic*", "erotique*", "*hentai*", "lewd", "*topless*", "bottomless", "lingerie", "bikini*",
    "underwear", "undress*", "stripper*", "striptease", "orgasm*", "fetish", "bdsm", "bondage", "prostitut*",
    "brothel*", "genital*", "penis", "vagina", "nipple*", "buttock*", "anus", "anal", "oral sex", "fellat*",
    "cunniling*", "masturb*", "ejaculat*", "cum shot", "creampie", "gangbang", "threesome", "orgy", "sextoy", "dildo",
    "vibrator", "furry nsfw", "rule34", "rule 34", "ahegao", "ecchi", "yaoi", "seins", "couille*", "chatte",
    "nichon*", "enculer", "foutre", "salope", "pute", "putain", "sodomie", "fellation", "cunnilingus", "orgasme",
    "underage", "dick", "cock", "pussy", "ass", "tits", "boobs", "cum", "slut", "whore", "breasts", "wearing nothing",
    "wears nothing", "full frontal", "birthday suit", "in the nude", "unclad", "bare chest*", "bare breast*",
    "only body paint", "scantily clad", "barely clothed", "*desnud*", "*nackt*", "nudo", "nuda", "nudi", "nudita",
    "seminu", "seminus", "seminua", "seminuas", "seminude*", "seminudo*", "seminuda*", "seminudi", "denud*",
    "deshabill*", "*pornograf*", "*pornograph*", "erotisch*", "sinnlich*", "senos", "titten", "tetas", "tette",
    "spogliat", "spogliata", "spogliato", "spogliati", "spogliate", "spogliarsi", "spogliarell*", "svestit*",
    "blowjob*", "blow job*", "handjob*", "hand job*", "footjob*", "foot job*", "titjob*", "titfuck*", "rimjob*",
    "anilingus", "intercourse", "coitus", "copulat*", "sodomy", "sodomiz*", "sodomis*", "semen", "sperm", "cumshot*",
    "bukkake", "gang bang*", "bestiality", "zoophil*", "necrophil*", "incest*", "fisting", "butt plug*", "buttplug*",
    "vulva*", "labia", "clitor*", "clit", "clits", "areola*", "scrotum*", "testicle*", "phallus*", "pubic hair",
    "pubes", "private parts", "intimate parts", "molest*", "raped", "raping", "rapist*", "rape scene*", "striptease*",
    "strip tease*", "strip club*", "lap dance*", "making love", "make love", "kama sutra", "doggy style",
    "doggystyle", "missionary position", "camel toe", "nip slip", "skinny dipping", "in the buff", "nudis*", "milf",
    "milfs", "futanari", "shemale*", "dominatrix", "ball gag*", "ballgag*", "panties", "touching himself",
    "touching herself", "lifting her skirt", "upskirt", "sous vetement*", "en petite tenue", "devetu*", "tenue d eve",
    "plus simple appareil", "sans rien sur le dos", "partouze*", "calzon", "calzoncillo*", "calzoncito*",
    "en pelotas", "sin nada puesto", "follar", "follando", "unterhose*", "schlupfer*", "reizwasche", "entblosst*",
    "barbusig*", "nackig*", "fkk", "geschlechtsverkehr", "vergewaltig*", "ficken", "gefickt", "pelad*", "despida",
    "despidas", "estupr*", "mutande", "mutandin*", "mutandon*", "perizoma", "senza niente addosso", "nudin*",
    "*ciplak*", "soyunmus", "tecavuz*", "mustehcen*", "naakt*", "ontkleed*", "nagie", "rozebran*", "telanjang",
    "bugil", "pemerkosa*", "khoa than", "khieu dam", "hiep dam", "the rape", "a rape", "rape of", "rapes of",
    "gang rape*", "rape victim*", "le viol", "un viol", "du viol", "au viol", "les viols", "des viols",
    "viol collectif", "viols collectifs", "violeur*", "femme violee", "femmes violees", "fille violee",
    "filles violees", "stupr*",
)

GENERAL_CTX_SEXUEL = (
    "strip", "breast", "poitrine", "bite", "queue", "baiser", "jouir", "dominat*", "submissi*", "sadis*", "masoch*",
    "escort", "yuri", "tied up", "chained", "whipped", "on knees", "bent over", "erection*", "erect", "boner*",
    "penetrat*", "spread legs", "foursome*",
)

CONTEXTE_SEXUEL_FAIBLE = (
    "sexy", "sensual*", "seductive", "provocative", "suggestive", "busty", "kinky", "big breast*", "large breast*",
    "huge breast*", "her breast*",
)

GENERAL_CTX_VIOLENCE = (
    "blood", "bloody", "bleed*", "murder*", "kill*", "torture*", "torturer", "cannibal*", "flesh", "corpse*",
    "cadaver*", "dead body", "death scene", "execution", "hanging", "strangul*", "suffocate", "drown*", "stab",
    "stabs", "stabbed", "stabbing", "stabber*", "slash*", "wound*", "injury", "brutal*", "savage*", "slaughter*",
    "meurtre*", "tuer", "mort", "cadavre*", "sang", "sanglant*", "violence", "violent*", "cruaut*", "drug", "drugs",
    "crack", "snort", "overdose", "drogue*", "stupefi*", "bomb", "bombing", "isis", "jump off",
)

GENERAL_VIOLENCE_DUR = (
    "gore", "gory", "dismember*", "decapitat*", "mutilat*", "eviscerat*", "disembowel*", "snuff", "graphic violence",
    "massacre*", "bloodbath", "carnage",
)

GENERAL_DROGUE_DUR = (
    "cocaine", "heroin", "fentanyl", "methamphet*", "meth", "opium", "inject drug*", "crack cocaine",
)

GENERAL_EXTREMISME_DUR = (
    "terrorist*", "terrorism", "terroris*", "mass shooting", "genocide", "ethnic cleansing", "hate crime",
    "white supremac*", "nazi", "nazis", "swastika", "al qaeda", "jihad", "radicali*", "extremis*", "attentat*",
    "daesh", "isis flag", "isis fighter", "isis militant", "isis terrorist",
)

GENERAL_AUTOBLESSURE_DUR = (
    "suicide", "self harm", "cut myself", "slit wrist*", "hang myself",
)

GENERAL_HAINE_DUR = (
    "racial slur", "nigger*", "faggot*", "retard", "retards", "retarded", "kike", "kikes", "spic", "spics", "chink",
    "chinks", "wetback*", "hate speech",
)

GENERAL_ARMES_DUR = (
    "how to make bomb", "how to make gun", "weapon tutorial", "build explosive", "poison recipe",
)

PERSONNES = (
    "woman", "man", "person", "girl", "boy", "female", "male", "lady", "femme", "homme", "mujer", "hombre", "persona",
    "frau", "mann", "donna", "uomo", "mulher", "homem",
)

NUDITE_EXTREME = (
    "without clothes", "no clothes", "without clothing", "no clothing", "unclothed", "fully exposed", "spread legs",
    "spanked", "sans vetement*", "sans habit*", "sin ropa", "ohne kleidung", "ohne kleider", "senza vestiti",
    "sem roupa*",
)

VIOLENCE_ENFANT_GENERAL = (
    "hurt", "hit", "beat", "punch", "slap", "abuse", "attack", "weapon", "knife", "gun", "shoot", "bleed", "cry",
    "scream", "pain", "suffer", "frapper", "battre", "blesser",
)

NON_ASSIGNES_U14 = (
    "0378-0379", "0380-0383", "038B", "038D", "03A2", "0530", "0557-0558", "058B-058C", "0590", "05C8-05CF",
    "05EB-05EE", "05F5-05FF", "070E", "074B-074C", "07B2-07BF", "07FB-07FC", "082E-082F", "083F", "085C-085D", "085F",
    "086B-086F", "088F", "0892-0897", "0984", "098D-098E", "0991-0992", "09A9", "09B1", "09B3-09B5", "09BA-09BB",
    "09C5-09C6", "09C9-09CA", "09CF-09D6", "09D8-09DB", "09DE", "09E4-09E5", "09FF-0A00", "0A04", "0A0B-0A0E",
    "0A11-0A12", "0A29", "0A31", "0A34", "0A37", "0A3A-0A3B", "0A3D", "0A43-0A46", "0A49-0A4A", "0A4E-0A50",
    "0A52-0A58", "0A5D", "0A5F-0A65", "0A77-0A80", "0A84", "0A8E", "0A92", "0AA9", "0AB1", "0AB4", "0ABA-0ABB",
    "0AC6", "0ACA", "0ACE-0ACF", "0AD1-0ADF", "0AE4-0AE5", "0AF2-0AF8", "0B00", "0B04", "0B0D-0B0E", "0B11-0B12",
    "0B29", "0B31", "0B34", "0B3A-0B3B", "0B45-0B46", "0B49-0B4A", "0B4E-0B54", "0B58-0B5B", "0B5E", "0B64-0B65",
    "0B78-0B81", "0B84", "0B8B-0B8D", "0B91", "0B96-0B98", "0B9B", "0B9D", "0BA0-0BA2", "0BA5-0BA7", "0BAB-0BAD",
    "0BBA-0BBD", "0BC3-0BC5", "0BC9", "0BCE-0BCF", "0BD1-0BD6", "0BD8-0BE5", "0BFB-0BFF", "0C0D", "0C11", "0C29",
    "0C3A-0C3B", "0C45", "0C49", "0C4E-0C54", "0C57", "0C5B-0C5C", "0C5E-0C5F", "0C64-0C65", "0C70-0C76", "0C8D",
    "0C91", "0CA9", "0CB4", "0CBA-0CBB", "0CC5", "0CC9", "0CCE-0CD4", "0CD7-0CDC", "0CDF", "0CE4-0CE5", "0CF0",
    "0CF3-0CFF", "0D0D", "0D11", "0D45", "0D49", "0D50-0D53", "0D64-0D65", "0D80", "0D84", "0D97-0D99", "0DB2",
    "0DBC", "0DBE-0DBF", "0DC7-0DC9", "0DCB-0DCE", "0DD5", "0DD7", "0DE0-0DE5", "0DF0-0DF1", "0DF5-0E00", "0E3B-0E3E",
    "0E5C-0E80", "0E83", "0E85", "0E8B", "0EA4", "0EA6", "0EBE-0EBF", "0EC5", "0EC7", "0ECE-0ECF", "0EDA-0EDB",
    "0EE0-0EFF", "0F48", "0F6D-0F70", "0F98", "0FBD", "0FCD", "0FDB-0FFF", "10C6", "10C8-10CC", "10CE-10CF", "1249",
    "124E-124F", "1257", "1259", "125E-125F", "1289", "128E-128F", "12B1", "12B6-12B7", "12BF", "12C1", "12C6-12C7",
    "12D7", "1311", "1316-1317", "135B-135C", "137D-137F", "139A-139F", "13F6-13F7", "13FE-13FF", "169D-169F",
    "16F9-16FF", "1716-171E", "1737-173F", "1754-175F", "176D", "1771", "1774-177F", "17DE-17DF", "17EA-17EF",
    "17FA-17FF", "181A-181F", "1879-187F", "18AB-18AF", "18F6-18FF", "191F", "192C-192F", "193C-193F", "1941-1943",
    "196E-196F", "1975-197F", "19AC-19AF", "19CA-19CF", "19DB-19DD", "1A1C-1A1D", "1A5F", "1A7D-1A7E", "1A8A-1A8F",
    "1A9A-1A9F", "1AAE-1AAF", "1ACF-1AFF", "1B4D-1B4F", "1B7F", "1BF4-1BFB", "1C38-1C3A", "1C4A-1C4C", "1C89-1C8F",
    "1CBB-1CBC", "1CC8-1CCF", "1CFB-1CFF", "1F16-1F17", "1F1E-1F1F", "1F46-1F47", "1F4E-1F4F", "1F58", "1F5A", "1F5C",
    "1F5E", "1F7E-1F7F", "1FB5", "1FC5", "1FD4-1FD5", "1FDC", "1FF0-1FF1", "1FF5", "1FFF", "2065", "2072-2073",
    "208F", "209D-209F", "20C1-20CF", "20F1-20FF", "218C-218F", "2427-243F", "244B-245F", "2B74-2B75", "2B96",
    "2CF4-2CF8", "2D26", "2D28-2D2C", "2D2E-2D2F", "2D68-2D6E", "2D71-2D7E", "2D97-2D9F", "2DA7", "2DAF", "2DB7",
    "2DBF", "2DC7", "2DCF", "2DD7", "2DDF", "2E5E-2E7F", "2E9A", "2EF4-2EFF", "2FD6-2FEF", "2FFC-2FFF", "3040",
    "3097-3098", "3100-3104", "3130", "318F", "31E4-31EF", "321F", "A48D-A48F", "A4C7-A4CF", "A62C-A63F", "A6F8-A6FF",
    "A7CB-A7CF", "A7D2", "A7D4", "A7DA-A7F1", "A82D-A82F", "A83A-A83F", "A878-A87F", "A8C6-A8CD", "A8DA-A8DF",
    "A954-A95E", "A97D-A97F", "A9CE", "A9DA-A9DD", "A9FF", "AA37-AA3F", "AA4E-AA4F", "AA5A-AA5B", "AAC3-AADA",
    "AAF7-AB00", "AB07-AB08", "AB0F-AB10", "AB17-AB1F", "AB27", "AB2F", "AB6C-AB6F", "ABEE-ABEF", "ABFA-ABFF",
    "D7A4-D7AF", "D7C7-D7CA", "D7FC-D7FF", "FA6E-FA6F", "FADA-FAFF", "FB07-FB12", "FB18-FB1C", "FB37", "FB3D", "FB3F",
    "FB42", "FB45", "FBC3-FBD2", "FD90-FD91", "FDC8-FDCE", "FDD0-FDEF", "FE1A-FE1F", "FE53", "FE67", "FE6C-FE6F",
    "FE75", "FEFD-FEFE", "FF00", "FFBF-FFC1", "FFC8-FFC9", "FFD0-FFD1", "FFD8-FFD9", "FFDD-FFDF", "FFE7", "FFEF-FFF8",
    "FFFE-FFFF", "1000C", "10027", "1003B", "1003E", "1004E-1004F", "1005E-1007F", "100FB-100FF", "10103-10106",
    "10134-10136", "1018F", "1019D-1019F", "101A1-101CF", "101FE-1027F", "1029D-1029F", "102D1-102DF", "102FC-102FF",
    "10324-1032C", "1034B-1034F", "1037B-1037F", "1039E", "103C4-103C7", "103D6-103FF", "1049E-1049F", "104AA-104AF",
    "104D4-104D7", "104FC-104FF", "10528-1052F", "10564-1056E", "1057B", "1058B", "10593", "10596", "105A2", "105B2",
    "105BA", "105BD-105FF", "10737-1073F", "10756-1075F", "10768-1077F", "10786", "107B1", "107BB-107FF",
    "10806-10807", "10809", "10836", "10839-1083B", "1083D-1083E", "10856", "1089F-108A6", "108B0-108DF", "108F3",
    "108F6-108FA", "1091C-1091E", "1093A-1093E", "10940-1097F", "109B8-109BB", "109D0-109D1", "10A04", "10A07-10A0B",
    "10A14", "10A18", "10A36-10A37", "10A3B-10A3E", "10A49-10A4F", "10A59-10A5F", "10AA0-10ABF", "10AE7-10AEA",
    "10AF7-10AFF", "10B36-10B38", "10B56-10B57", "10B73-10B77", "10B92-10B98", "10B9D-10BA8", "10BB0-10BFF",
    "10C49-10C7F", "10CB3-10CBF", "10CF3-10CF9", "10D28-10D2F", "10D3A-10E5F", "10E7F", "10EAA", "10EAE-10EAF",
    "10EB2-10EFF", "10F28-10F2F", "10F5A-10F6F", "10F8A-10FAF", "10FCC-10FDF", "10FF7-10FFF", "1104E-11051",
    "11076-1107E", "110C3-110CC", "110CE-110CF", "110E9-110EF", "110FA-110FF", "11135", "11148-1114F", "11177-1117F",
    "111E0", "111F5-111FF", "11212", "1123F-1127F", "11287", "11289", "1128E", "1129E", "112AA-112AF", "112EB-112EF",
    "112FA-112FF", "11304", "1130D-1130E", "11311-11312", "11329", "11331", "11334", "1133A", "11345-11346",
    "11349-1134A", "1134E-1134F", "11351-11356", "11358-1135C", "11364-11365", "1136D-1136F", "11375-113FF", "1145C",
    "11462-1147F", "114C8-114CF", "114DA-1157F", "115B6-115B7", "115DE-115FF", "11645-1164F", "1165A-1165F",
    "1166D-1167F", "116BA-116BF", "116CA-116FF", "1171B-1171C", "1172C-1172F", "11747-117FF", "1183C-1189F",
    "118F3-118FE", "11907-11908", "1190A-1190B", "11914", "11917", "11936", "11939-1193A", "11947-1194F",
    "1195A-1199F", "119A8-119A9", "119D8-119D9", "119E5-119FF", "11A48-11A4F", "11AA3-11AAF", "11AF9-11BFF", "11C09",
    "11C37", "11C46-11C4F", "11C6D-11C6F", "11C90-11C91", "11CA8", "11CB7-11CFF", "11D07", "11D0A", "11D37-11D39",
    "11D3B", "11D3E", "11D48-11D4F", "11D5A-11D5F", "11D66", "11D69", "11D8F", "11D92", "11D99-11D9F", "11DAA-11EDF",
    "11EF9-11FAF", "11FB1-11FBF", "11FF2-11FFE", "1239A-123FF", "1246F", "12475-1247F", "12544-12F8F", "12FF3-12FFF",
    "1342F", "13439-143FF", "14647-167FF", "16A39-16A3F", "16A5F", "16A6A-16A6D", "16ABF", "16ACA-16ACF",
    "16AEE-16AEF", "16AF6-16AFF", "16B46-16B4F", "16B5A", "16B62", "16B78-16B7C", "16B90-16E3F", "16E9B-16EFF",
    "16F4B-16F4E", "16F88-16F8E", "16FA0-16FDF", "16FE5-16FEF", "16FF2-16FFF", "187F8-187FF", "18CD6-18CFF",
    "18D09-1AFEF", "1AFF4", "1AFFC", "1AFFF", "1B123-1B14F", "1B153-1B163", "1B168-1B16F", "1B2FC-1BBFF",
    "1BC6B-1BC6F", "1BC7D-1BC7F", "1BC89-1BC8F", "1BC9A-1BC9B", "1BCA4-1CEFF", "1CF2E-1CF2F", "1CF47-1CF4F",
    "1CFC4-1CFFF", "1D0F6-1D0FF", "1D127-1D128", "1D1EB-1D1FF", "1D246-1D2DF", "1D2F4-1D2FF", "1D357-1D35F",
    "1D379-1D3FF", "1D455", "1D49D", "1D4A0-1D4A1", "1D4A3-1D4A4", "1D4A7-1D4A8", "1D4AD", "1D4BA", "1D4BC", "1D4C4",
    "1D506", "1D50B-1D50C", "1D515", "1D51D", "1D53A", "1D53F", "1D545", "1D547-1D549", "1D551", "1D6A6-1D6A7",
    "1D7CC-1D7CD", "1DA8C-1DA9A", "1DAA0", "1DAB0-1DEFF", "1DF1F-1DFFF", "1E007", "1E019-1E01A", "1E022", "1E025",
    "1E02B-1E0FF", "1E12D-1E12F", "1E13E-1E13F", "1E14A-1E14D", "1E150-1E28F", "1E2AF-1E2BF", "1E2FA-1E2FE",
    "1E300-1E7DF", "1E7E7", "1E7EC", "1E7EF", "1E7FF", "1E8C5-1E8C6", "1E8D7-1E8FF", "1E94C-1E94F", "1E95A-1E95D",
    "1E960-1EC70", "1ECB5-1ED00", "1ED3E-1EDFF", "1EE04", "1EE20", "1EE23", "1EE25-1EE26", "1EE28", "1EE33", "1EE38",
    "1EE3A", "1EE3C-1EE41", "1EE43-1EE46", "1EE48", "1EE4A", "1EE4C", "1EE50", "1EE53", "1EE55-1EE56", "1EE58",
    "1EE5A", "1EE5C", "1EE5E", "1EE60", "1EE63", "1EE65-1EE66", "1EE6B", "1EE73", "1EE78", "1EE7D", "1EE7F", "1EE8A",
    "1EE9C-1EEA0", "1EEA4", "1EEAA", "1EEBC-1EEEF", "1EEF2-1EFFF", "1F02C-1F02F", "1F094-1F09F", "1F0AF-1F0B0",
    "1F0C0", "1F0D0", "1F0F6-1F0FF", "1F1AE-1F1E5", "1F203-1F20F", "1F23C-1F23F", "1F249-1F24F", "1F252-1F25F",
    "1F266-1F2FF", "1F6D8-1F6DC", "1F6ED-1F6EF", "1F6FD-1F6FF", "1F774-1F77F", "1F7D9-1F7DF", "1F7EC-1F7EF",
    "1F7F1-1F7FF", "1F80C-1F80F", "1F848-1F84F", "1F85A-1F85F", "1F888-1F88F", "1F8AE-1F8AF", "1F8B2-1F8FF",
    "1FA54-1FA5F", "1FA6E-1FA6F", "1FA75-1FA77", "1FA7D-1FA7F", "1FA87-1FA8F", "1FAAD-1FAAF", "1FABB-1FABF",
    "1FAC6-1FACF", "1FADA-1FADF", "1FAE8-1FAEF", "1FAF7-1FAFF", "1FB93", "1FBCB-1FBEF", "1FBFA-1FFFF", "2A6E0-2A6FF",
    "2B739-2B73F", "2B81E-2B81F", "2CEA2-2CEAF", "2EBE1-2F7FF", "2FA1E-2FFFF", "3134B-E0000", "E0002-E001F",
    "E0080-E00FF", "E01F0-EFFFF", "FFFFE-FFFFF", "10FFFE-10FFFF",
)

IDIOMES_RACINES = (
   
    "nudel(?=(?:n|holz|holzer|suppe|suppen|salat|salate|teig|auflauf|gericht|gerichte|maschine|walker|sieb|topf|topfe|toepfe|nest|nester|pfanne|pfannen|brett|platte|sorte|sorten|wasser|form|formen|bar|laden|rezept|rezepte|chen)?(?![a-z]))",
    "nacktschneck", "nacktmull", "nacktsamer", "nackthund", "naaktslak", "spogliatoi",
)

DUREES_NON_AGE = (
    "guerres?", "services?", "travail", "travaux", "experiences?", "carrieres?", "mariage", "prison", "captivite",
    "exil", "paix", "regne", "combats?", "batailles?", "conflits?", "luttes?", "siege", "entrainement", "pratique",
    "metier", "apprentissage", "formation", "etudes?", "recherches?", "voyages?", "errance", "retard", "absence",
    "silence", "sommeil", "garantie", "anciennete", "activite", "chantier", "construction", "restauration",
    "occupation", "dictature", "crise", "attente", "amitie", "labeur", "solitude", "emprisonnement", "detention",
    "isolement", "campagnes?", "missions?", "quete", "navigation", "patrouilles?", "commandement", "pouvoir",
    "tyrannie", "esclavage", "servitude", "resistance", "souffrance", "misere", "famine", "secheresse", "hiver",
    "nuit", "tenebres", "malediction", "hibernation", "exploitation", "vieillissement", "loyaux", "bons", "guerras?",
    "servicio", "trabajo", "experiencia", "carrera", "matrimonio", "prision", "carcel", "cautiverio", "exilio", "paz",
    "reinado", "combates?", "batallas?", "conflictos?", "luchas?", "asedio", "entrenamiento", "practica", "oficio",
    "aprendizaje", "estudios?", "investigacion", "viajes?", "retraso", "ausencia", "silencio", "garantia",
    "antiguedad", "dictadura", "crisis", "espera", "amistad", "soledad", "esclavitud", "campanas?", "mision",
    "busqueda", "mando", "tirania", "sufrimiento", "invierno", "oscuridad", "maldicion", "construccion", "obras?",
    "servico", "trabalho", "carreira", "casamento", "prisao", "cadeia", "cativeiro", "cerco", "treino", "treinamento",
    "pratica", "aprendizado", "estudos?", "pesquisa", "viagens?", "atraso", "solidao", "escravidao", "campanhas?",
    "missao", "busca", "comando", "sofrimento", "inverno", "escuridao", "maldicao", "construcao", "servizio",
    "lavoro", "esperienza", "carriera", "prigione", "prigionia", "carcere", "esilio", "pace", "regno",
    "combattimenti?", "battaglie?", "battaglia", "conflitti?", "conflitto", "lotta", "lotte", "assedio",
    "allenamento", "mestiere", "apprendistato", "studi", "studio", "ricerche?", "ricerca", "viaggi", "viaggio",
    "ritardo", "assenza", "silenzio", "garanzia", "anzianita", "dittatura", "crisi", "attesa", "amicizia",
    "solitudine", "schiavitu", "campagna", "missione", "potere", "tirannia", "sofferenza", "costruzione", "lavori",
    "mers?", "croisades?", "retraites?", "legions?", "aventures?", "gladiature", "forets?", "piraterie", "brigandage",
    "chasses?", "expeditions?", "explorations?", "bagne", "galeres?", "pelerinages?", "meditation", "prieres?",
    "monastere", "couvent", "cachot", "forge", "magie", "sorcellerie", "alchimie", "marine", "mercenariat",
    "vagabondage", "contrebande", "routes?", "mar", "mares", "cruzadas?", "retiro", "legion", "legiones",
    "aventuras?", "bosques?", "selvas?", "pirateria", "caza", "expedicion", "expediciones", "exploracion",
    "peregrinacion", "meditacion", "oracion", "monasterio", "convento", "calabozo", "mazmorras?", "fragua", "magia",
    "hechiceria", "alquimia", "navegacion", "marina", "contrabando", "legiao", "florestas?", "pirataria", "expedicao",
    "exploracao", "peregrinacao", "meditacao", "oracao", "mosteiro", "masmorras?", "forja", "feiticaria", "navegacao",
    "marinha", "mare", "mari", "crociate", "crociata", "ritiro", "legione", "avventure", "avventura", "foreste",
    "foresta", "boschi", "bosco", "caccia", "spedizioni", "spedizione", "esplorazione", "pellegrinaggio",
    "meditazione", "preghiera", "monastero", "segrete", "fucina", "stregoneria", "alchimia", "navigazione",
    "contrabbando",
)

ADJECTIFS_JEUNESSE = (
    "young", "youth", "youthful", "jeune", "jeunes", "joven", "jovenes", "kind",
)

CLASSES_ORDINAUX = (
    "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh",
    "twelfth", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th", "11th", "12th",
)

ELEVES_CLASSE = (
    "girl*", "boy*", "student*", "pupil*",
)

MOJIBAKE_EFFACES = (
    "\xef\xbb\xbf", "\xef\xbf\xb9", "\xef\xbf\xba", "\xef\xbf\xbb", "\xef\xbf\xbc", "\xef\xbf\xbd", "\xe2\x81\xaa",
    "\xe2\x81\xab", "\xe2\x81\xac", "\xe2\x81\xad", "\xe2\x81\xae", "\xe2\x81\xaf",
)

TRANSLIT_HORS_PRODUCTION = (
    "\u04af", "\u0585", "\u057d", "\u0578", "\u0570", "\u0581", "\u0566", "\u0561", "\u0127", "\u0167", "\u0138",
    "\u0180", "\u0268", "\u0289", "\u024d", "\u024f", "\u01b6", "\u01e5", "\u0249", "\u0237", "\u1d00", "\u0299",
    "\u1d04", "\u1d05", "\u1d07", "\ua730", "\u0262", "\u029c", "\u026a", "\u1d0a", "\u1d0b", "\u029f", "\u1d0d",
    "\u0274", "\u1d0f", "\u1d18", "\u0280", "\ua731", "\u1d1b", "\u1d1c", "\u1d20", "\u1d21", "\u028f", "\u1d22",
)

GARDE_POSSESSIFS = (
    "his", "her", "my", "your", "their", "our", "its", "whose", "thy", "s",
)

GARDE_ARRETS = (
    "a", "an", "the", "this", "that", "these", "those", "and", "or", "with", "near", "beside", "among", "by", "of",
    "in", "on", "at", "from", "to", "for", "behind", "under", "over", "between", "around", "next",
)

GARDE_CHANTIER = (
    "with", "has", "had", "having", "got", "gets", "get", "showing", "shows", "show", "his", "her",
)

AVANT_ESCOLAR = (
    "un", "una", "unos", "unas", "el", "la", "los", "las", "mi", "mis", "tu", "tus", "su", "sus", "nuestra",
    "nuestro", "nuestras", "nuestros", "vuestra", "vuestro", "vuestras", "vuestros", "esta", "este", "estas", "estos",
    "esa", "ese", "esas", "esos", "aquella", "aquel", "aquellas", "aquellos", "otra", "otro", "otras", "otros",
    "cada", "alguna", "algun", "algunas", "algunos", "varias", "varios", "muchas", "muchos", "pocas", "pocos", "dos",
    "tres", "cuatro", "cinco", "joven", "jovenes", "pequena", "pequeno", "pequenas", "pequenos", "pequenita",
    "pequenito", "jovencita", "jovencito", "nueva", "nuevo", "nuevas", "nuevos", "linda", "lindo", "lindas", "lindos",
    "guapa", "guapo", "guapas", "guapos", "bonita", "bonito", "bonitas", "bonitos", "hermosa", "hermoso", "hermosas",
    "hermosos", "tierna", "tierno", "timida", "timido", "dulce", "dulces", "inocente", "inocentes", "traviesa",
    "travieso", "adorable", "adorables", "pobre", "pobres", "buena", "buen", "buenas", "buenos", "primera", "primer",
    "mejor", "mejores", "sola", "solo", "triste", "feliz", "curiosa", "curioso", "aplicada", "aplicado", "sexy",
)

NOMBRES_CLASSE = (
    "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "1", "2", "3",
    "4", "5", "6", "7", "8", "9", "10", "11", "12",
)


# ── Points de code non assignes en Unicode 14 (table fixe partagee avec le TypeScript) ──────────────
_BORNES_U14 = tuple((int(p.split("-")[0], 16), int(p.split("-")[-1], 16)) for p in NON_ASSIGNES_U14)
_DEBUTS_U14 = tuple(a for a, _ in _BORNES_U14)
_FINS_U14 = tuple(b for _, b in _BORNES_U14)

# ── Chiffres Unicode (table fixe partagee avec le TypeScript) ──────────────
_ZEROS = tuple(int(h, 16) for h in ZEROS_CHIFFRES)

# ── Ce que ftfy repare avant le tokenizer CLIP (seconde relecture du 14/10) : mojibake d'un caractere efface, references HTML ──
_RE_MOJIBAKE = re.compile("|".join(MOJIBAKE_EFFACES))
_RE_INDICE_MOJIBAKE = re.compile("[\u00e2\u00ef\u0302\u0308]")
_RE_REF_HTML = re.compile(r"&(?:#(?:x([0-9a-f]+)|([0-9]+));?|(amp|num);?)", re.I)


def _chiffres_ascii(s):
    """« age of ١٠ » -> « age of 10 » : tout chiffre decimal de la table devient le chiffre ASCII de meme valeur."""
    if s.isascii():
        return s
    sortie = []
    for c in s:
        cp = ord(c)
        rendu = c
        if cp >= 0x80:
            for z in _ZEROS:
                if z <= cp <= z + 9:
                    rendu = str(cp - z)
                    break
        sortie.append(rendu)
    return "".join(sortie)


def _effacer(s):
    """\\t \\n \\r -> espace, puis effacement (categorie C, ignorables, non assignes en Unicode 14)."""
    return _sans_effaces(_RE_BLANCS_CONTROLE.sub(" ", s))


def _decoder_reference(m):
    hexa, dec, nom = m.group(1), m.group(2), m.group(3)
    if nom:
        return "&" if nom.lower() == "amp" else ("#" if nom.lower() == "num" else m.group(0))
    chiffres = (hexa if hexa is not None else dec).lstrip("0")
    n = -1 if len(chiffres) > 7 else (0 if chiffres == "" else int(chiffres, 16 if hexa is not None else 10))
    return "\ufffd" if n <= 0 or n > 0x10FFFF or 0xD800 <= n <= 0xDFFF else chr(n)


def _sans_references_html(s):
    """« &#110; » -> « n », « &#x6e; » -> « n », « &amp; » -> « & », « &num; » -> « # » ; un numero hors d'Unicode -> U+FFFD."""
    r = s
    for _ in range(3):
        if "&" not in r:
            break
        suivant = _RE_REF_HTML.sub(_decoder_reference, r)
        if suivant == r:
            break
        r = suivant
    return r


def _sans_mojibake(s):
    """Mojibake d'un caractere efface retire, sur la forme NFC (meme regle que le TypeScript)."""
    if not _RE_INDICE_MOJIBAKE.search(s):
        return s
    return _RE_MOJIBAKE.sub("", unicodedata.normalize("NFC", s))


def _nettoyer(texte):
    """Etape commune a toutes les vues (meme ordre que le TypeScript) : non assignes en Unicode 14 et autres caracteres effaces
    AVANT NFKC ; mojibake d'un caractere efface retire (forme NFC, avant ET apres l'effacement) ; NFKC ; references HTML decodees
    (puis NFKC) ; chiffres en ASCII ; minuscules. L'effacement est refait apres chaque reparation (ftfy repete les siennes jusqu'a
    un texte stable) ; pas apres NFKC, qui ne produit aucun caractere efface."""
    s = _effacer(_sans_mojibake(_sans_non_assignes(_en_texte(texte))))
    s = _effacer(_sans_mojibake(s))
    s = unicodedata.normalize("NFKC", s)
    if "&" in s:
        s = _effacer(unicodedata.normalize("NFKC", _sans_non_assignes(_sans_references_html(s))))
    return _chiffres_ascii(s).lower()


def _sans_marques(net):
    """NFD puis retrait de TOUTES les marques combinantes."""
    return "".join(c for c in unicodedata.normalize("NFD", net) if not _est_marque(c))


def _base(texte):
    """NFKC + effacement + marques retirees + minuscules (SANS translitteration)."""
    return _sans_marques(_nettoyer(texte))


def _translit(s):
    """Remplace les lettres cyrilliques / grecques / armeniennes ressemblantes, les lettres latines speciales et les lettres-emoji."""
    if s.isascii():
        return s
    sortie = []
    for c in s:
        if ord(c) < 0x80:
            sortie.append(c)
            continue
        r = _LATIN_SPECIAUX.get(c) or _HOMOGLYPHES.get(c) or _lettre_symbole(ord(c))
        sortie.append(r if r is not None else c)
    return "".join(sortie)


# Mots isoles qui contiennent un terme du filtre sans en etre un (liste IDIOMES generee), retires du texte simplifie.
_IDIOMES = re.compile(r"(?:^| )(?:" + "|".join(IDIOMES) + r")(?= |\Z)")
# Racines d'idiomes (liste IDIOMES_RACINES generee) : seule la racine est retiree, la fin du mot reste lue (revue du 14/10, B2).
_IDIOMES_RACINES = re.compile(r"(?:^| )(?:" + "|".join(IDIOMES_RACINES) + r")(?=[a-z]*(?: |\Z))")
# Expressions sures (liste EXPRESSIONS_SURES generee) : le mot marque « ! » est le SEUL retire, les autres restent lus ; une
# expression n'est reconnue qu'ecrite telle quelle (espaces, tirets ou soulignes entre les mots), avant la simplification.
_SEPARATEUR_EXPRESSION = "[ _-]+"


def _cle_expression(e):
    """Cle LITTERALE : la plus longue suite de lettres en tete d'un des mots, que toute correspondance contient."""
    cle = ""
    for mot in e.split(" "):
        m = re.match(r"!?([a-z]*)(.?)", mot)
        lettres = m.group(1)[:-1] if m.group(2) in ("?", "*") else m.group(1)
        if len(lettres) > len(cle):
            cle = lettres
    return cle


# Gardes des tournures de ferme et de chantier (troisieme relecture du 14/10, B3) : lues sur les MOTS qui precedent la tournure
# (listes GARDE_* generees ; meme regle que `_gardeExpression` du TypeScript). Une expression marquee « <coq> » ou « <chantier> »
# n'est pas retiree si sa garde trouve un de ces mots.
_RE_GARDE_EXPRESSION = re.compile("<([a-z]+)> ")


def _garde_expression(garde, avant):
    """Vrai si la garde `garde` refuse l'expression : `avant` est le texte qui la precede (avec son separateur)."""
    mots = [m for m in re.split("[^a-z0-9]+", avant) if m]
    if not mots:
        return False
    if garde == "chantier":
        return any(m in GARDE_CHANTIER for m in mots[-2:])
    if mots[-1].endswith("s"):
        return True
    i, n = len(mots) - 1, 0
    while i >= 0 and n < 6:
        if mots[i] in GARDE_POSSESSIFS:
            return True
        if mots[i] in GARDE_ARRETS:
            return False
        i -= 1
        n += 1
    return False


def _compiler_expression_sure(e):
    g = _RE_GARDE_EXPRESSION.match(e)
    corps = e[g.end():] if g else e
    regex = _SEPARATEUR_EXPRESSION.join(("(?:" + m[1:] + ")") if m.startswith("!") else ("(" + m + ")") for m in corps.split(" "))
    return _cle_expression(corps), (g.group(1) if g else ""), re.compile("(^|[^a-z0-9])" + regex + "(?![a-z0-9])")


_RE_EXPRESSIONS_SURES = [_compiler_expression_sure(e) for e in EXPRESSIONS_SURES]
# « baby dragon » se lit « young dragon » (mineur AMBIGU) ; pas avec un vetement apres l'animal (« baby bunny costume »).
_RE_BEBE_ANIMAL = re.compile(
    "(^|[^a-z0-9])(?:baby|bebe)" + _SEPARATEUR_EXPRESSION + "(?=(?:" + "|".join(ANIMAUX_BEBE) + ")(?:s|es)?(?![a-z0-9])(?!"
    + _SEPARATEUR_EXPRESSION + "(?:" + "|".join(VETEMENTS_ANIMAL) + ")(?:s|es)?(?![a-z0-9])))")
_RE_IDIOMES_EXACTS = re.compile(r"(?:^| )(?:" + "|".join(IDIOMES_EXACTS) + r")(?= |\Z)")
_RE_IDIOMES_UNICODE = re.compile("|".join(IDIOMES_UNICODE))


def _garder_mots(m):
    return m.group(1) + " ".join(m.groups()[1:]) + " "


def _garder_mots_garde(m, garde):
    """Comme `_garder_mots`, mais une expression gardee (`_garde_expression`) est laissee telle quelle."""
    if _garde_expression(garde, m.string[:m.start() + len(m.group(1))]):
        return m.group(0)
    return _garder_mots(m)


def _sans_expressions_sures(s):
    """Expressions sures (mot marque retire, les autres gardes) et « baby <animal> » -> « young <animal> ». Sur le texte AVANT
    simplification : la ponctuation y separe encore les mots."""
    r = _RE_BEBE_ANIMAL.sub(r"\1young ", s) if ("baby" in s or "bebe" in s) else s
    for cle, garde, expression in _RE_EXPRESSIONS_SURES:
        if cle in r:
            r = expression.sub(_garder_mots if not garde else (lambda m, g=garde: _garder_mots_garde(m, g)), r)
    return r


def _simple(s):
    """Tout ce qui n'est pas [a-z0-9] devient un espace ; espaces compactes ; idiomes retires (racines : la fin du mot reste)."""
    s = " " + _RE_NON_ALNUM.sub(" ", s).strip(" ") + " "
    return _RE_WS.sub(" ", _IDIOMES_RACINES.sub(" ", _IDIOMES.sub(" ", s))).strip(" ")


def _joindre(s):
    """"n u d e" -> "nude" : au moins 3 LETTRES isolees de suite sont recollees (un chiffre isole ne se recolle plus)."""
    def lettre(x):
        return len(x) == 1 and "a" <= x <= "z"

    t = s.split(" ")
    sortie = []
    i = 0
    while i < len(t):
        if lettre(t[i]):
            j = i
            while j < len(t) and lettre(t[j]):
                j += 1
            if j - i >= 3:
                sortie.append("".join(t[i:j]))
            else:
                sortie.extend(t[i:j])
            i = j
        else:
            sortie.append(t[i])
            i += 1
    return " ".join(sortie)


def _joindre_ponctue(s):
    """"n.u.d.e" / "n-u-d-e" -> "nude" : au moins 3 caracteres isoles separes par de la ponctuation."""
    return _RE_PONCTUE.sub(lambda m: _RE_NON_ALNUM.sub("", m.group(0)), s)


def _ecraser(s):
    """"nuuuude" -> "nude" : une lettre repetee 3 fois ou plus est ramenee a une seule."""
    return _RE_REPETE3.sub(r"\1", s)


def _series(simple):
    """Series de lettres isolees recollees (>= 6 lettres) : "c h i l d n u d e" -> "childnude"."""
    sortie = []
    t = simple.split(" ")
    i = 0
    while i < len(t):
        if len(t[i]) == 1:
            j = i
            while j < len(t) and len(t[j]) == 1:
                j += 1
            if j - i >= 6:
                sortie.append(_ecraser("".join(t[i:j])))
            i = j
        else:
            i += 1
    return sortie


def _leet(translit, un_vers):
    """Leet : seulement dans les jetons qui contiennent deja une lettre (un nombre seul reste un nombre)."""
    def remplacer(m):
        c = m.group(0)
        return un_vers if c == "1" else _LEET.get(c, c)

    def jeton_leet(jeton):
        if not _RE_LETTRE.search(jeton):
            return jeton
        return _RE_LEET.sub(remplacer, jeton)

    return " ".join(jeton_leet(j) for j in _RE_WS.split(translit))


def _hors_ascii_en_x(s):
    """Une lettre hors ASCII devient « x », tout autre caractere hors ASCII un espace."""
    return "".join(c if ord(c) < 0x80 else ("x" if unicodedata.category(c)[0] == "L" else " ") for c in s)


def _vue_exacte(net):
    """VUE EXACTE pour les mots COURTS « nu », « nue », « nua »... : une lettre a marque distinctive (crochet, tilde, corne,
    point souscrit) ou d'une autre ecriture devient « x » ; les accents francais sont retires."""
    s = unicodedata.normalize("NFD", net)
    sortie = []
    i = 0
    n = len(s)
    while i < n:
        c = s[i]
        j = i + 1
        if not _est_marque(c):
            while j < n and _est_marque(s[j]):
                j += 1
            marques = s[i + 1:j]
            if marques and any(m in _MARQUES_DISTINCTIVES for m in marques):
                sortie.append("x")
            else:
                sortie.append(c)
        else:
            sortie.append(c)
        i = j
    s = _sans_expressions_sures(_hors_ascii_en_x(_translit("".join(sortie))))
    return _RE_ESPACES.sub(" ", _RE_IDIOMES_EXACTS.sub(" ", _simple(s))).strip(" ")


def _vue_unicode(net):
    """VUE UNICODE pour les lexiques des ecritures non latines (meme fonction pour le texte et pour les termes)."""
    s = unicodedata.normalize("NFD", net)
    s = "".join(c for c in s if not _est_marque(c) or _marque_gardee(c))
    s = unicodedata.normalize("NFC", s)
    s = (s.replace("\u0640", "").replace("\u06cc", "\u064a").replace("\u0649", "\u064a").replace("\u06a9", "\u0643")
         .replace("\u0629", "\u0647").replace("\u0671", "\u0627"))
    s = "".join(chr(ord(c) - 0x60) if 0x30A1 <= ord(c) <= 0x30F6 else c for c in s)
    sortie = []
    for c in s:
        if 0x1F3FB <= ord(c) <= 0x1F3FF:
            continue
        cat = unicodedata.category(c)
        sortie.append(c if (cat[0] in "LNM" or cat == "So") else " ")
    return _RE_ESPACES.sub(" ", "".join(sortie)).strip(" ")


# Chiffres colles a un mot (seconde relecture du 14/10) : CLIP coupe entre lettres et chiffres (« 2child » -> 2 | child). Vues
# SUPPLEMENTAIRES coupees (« 2 child », « little 1 girl ») puis sans les chiffres colles a une lettre (« little girl »).
_RE_FRONTIERE_CHIFFRE = re.compile("(?<=[a-z])(?=[0-9])|(?<=[0-9])(?=[a-z])")
_RE_CHIFFRES_COLLES = re.compile("(?<=[a-z])[0-9]+|[0-9]+(?=[a-z])")
_RE_FRONTIERE_CHIFFRE_UNICODE = re.compile("(?<=[^ 0-9])(?=[0-9])|(?<=[0-9])(?=[^ 0-9])")
# Ideogrammes han, comme BasicTokenizer._is_chinese_char (tokenizer CLIP sans ftfy) : un espace entre deux d'entre eux est retire
# dans une seconde vue Unicode (« 儿 童 » donne a CLIP les memes jetons que « 儿童 » : troisieme relecture du 14/10).
_HAN = "".join("%s-%s" % (chr(a), chr(b)) for a, b in ((0x3400, 0x4DBF), (0x4E00, 0x9FFF), (0xF900, 0xFAFF), (0x20000, 0x2A6DF),
                                                         (0x2A700, 0x2CEAF), (0x2F800, 0x2FA1F)))
_RE_ESPACE_HAN = re.compile("(?<=[" + _HAN + "]) (?=[" + _HAN + "])")


def _separees(vues):
    """Vues coupees entre lettres et chiffres, puis sans chiffre colle a une lettre ; sans doublon, seulement si elles different."""
    sortie = []
    for v in vues:
        for s in (_RE_FRONTIERE_CHIFFRE.sub(" ", v), _RE_ESPACES.sub(" ", _RE_CHIFFRES_COLLES.sub(" ", v)).strip(" ")):
            if s != v and s not in sortie:
                sortie.append(s)
    return sortie


def _vues_plancher(net):
    """Vues du plancher a partir du texte NETTOYE (`_nettoyer`)."""
    t = _sans_expressions_sures(_translit(_sans_marques(net)))

    def assembler(x):
        return _joindre(_simple(_joindre_ponctue(x)))

    def coller(v):
        return _RE_REPETE2.sub(r"\1", _RE_NON_LETTRE.sub("", v))

    t_i = _leet(t, "i")
    t_l = _leet(t, "l")
    non_ecrasees = [assembler(t), assembler(t_i), assembler(t_l)]
    chiffres, leet_i, leet_l = _ecraser(non_ecrasees[0]), _ecraser(non_ecrasees[1]), _ecraser(non_ecrasees[2])
    exacte = _vue_exacte(net)
    uni = _vue_unicode(net)
    # vue Unicode, puis la meme sans les espaces entre deux ideogrammes han (troisieme relecture du 14/10)
    unicode = [uni] + [x for x in (_RE_ESPACE_HAN.sub("", uni),) if x != uni]
    return {
        "chiffres": chiffres,
        "leetI": leet_i,
        "leetL": leet_l,
        "collees": [coller(_simple(t_i)), coller(_simple(t_l))],
        "series": (_series(_simple(_joindre_ponctue(t))) + _series(_simple(_joindre_ponctue(t_i)))
                   + _series(_simple(_joindre_ponctue(t_l)))),
        "nonEcrasees": non_ecrasees,
        "separees": _separees([chiffres, leet_i, leet_l]),
        "exactes": [exacte] + _separees([exacte]),
        "unicode": [_RE_IDIOMES_UNICODE.sub(" ", _RE_FRONTIERE_CHIFFRE_UNICODE.sub(" ", x)) for x in unicode],
    }


# Syntaxe de poids COLLEE dans un mot (revue du 14/10, B1) : « na()ked », « (na)(ked) », « (na:1)(ked:1) ». Seconde vue ou cette
# syntaxe, prise entre deux caracteres de mot (lettre, chiffre, marque), est retiree SANS espace ; le texte tel quel reste lu.
_RE_SYNTAXE_POIDS = re.compile(r"(?:[()\[\]]|:[+-]?[0-9.]*\))+")


def _car_mot(c):
    return bool(c) and unicodedata.category(c)[0] in "LNM"


def _sans_syntaxe_collee(net):
    """Texte nettoye sans la syntaxe de poids prise entre deux caracteres de mot (meme texte s'il n'y en a pas)."""
    if not any(c in net for c in "()[]"):
        return net

    def remplacer(m):
        avant = net[m.start() - 1] if m.start() > 0 else ""
        apres = net[m.end()] if m.end() < len(net) else ""
        return "" if _car_mot(avant) and _car_mot(apres) else m.group(0)

    return _RE_SYNTAXE_POIDS.sub(remplacer, net)


# LECTURES DU TEXTE (troisieme relecture du 14/10 : B1, B2 ; meme regle que le TypeScript, voir nsfw_filter.ts). La lecture
# principale (`_nettoyer`) efface les invisibles et les marques, change en lettres les lettres-emoji et les symboles NFKC et decode
# les references HTML : elle lit les mots deguises. Les lectures ci-dessous traitent ces caracteres comme des SEPARATEURS, comme le
# tokenizer CLIP (« a child<U+0489>in<U+0489>the<U+0489>bath », « a child&#8203;in&#8203;the&#8203;bath ») ; les vues de toutes
# les lectures sont reunies.
#   separee : tout caractere efface ou change est un separateur ; clip : tokenizer CLIP sans ftfy (categorie C, U+FFFD et non
#   assignes effaces ; lettres hangul vides collees ; references non decodees) ; ftfy : tokenizer CLIP avec ftfy (mojibake repare,
#   references decodees, seuls les controles retires par ftfy effaces) ; production : normalisation de f86208c0.
_MODES_LECTURE = ("separee", "clip", "ftfy", "production")
_COLLES_CLIP_HORS_C = frozenset(chr(x) for x in (0xFFFD, 0x115F, 0x1160, 0x3164, 0xFFA0))
_COLLES_FTFY = frozenset([chr(x) for x in range(0x00, 0x09)] + [chr(0x0B)] + [chr(x) for x in range(0x0E, 0x20)] + [chr(0x7F)]
                         + [chr(x) for x in range(0x206A, 0x2070)] + [chr(0xFEFF)] + [chr(x) for x in range(0xFFF9, 0xFFFD)]
                         + [chr(x) for x in (0x115F, 0x1160, 0x3164, 0xFFA0)])
_COLLES_PRODUCTION = frozenset([chr(0xAD)] + [chr(x) for x in range(0x200B, 0x2010)] + [chr(x) for x in range(0x202A, 0x202F)]
                               + [chr(0x2060), chr(0xFEFF)])
_RE_ASCII_SIMPLE = re.compile("[\t\n\r\x20-\x25\x27-\x7e]*")
_TRANSLIT_HORS_PRODUCTION = frozenset(TRANSLIT_HORS_PRODUCTION)


def _colle_lecture(c, mode):
    """Caractere de `_efface` que la lecture `mode` COLLE (efface) ; les autres y separent les mots."""
    if mode == "clip":
        return unicodedata.category(c)[0] == "C" or c in _COLLES_CLIP_HORS_C or (ord(c) >= 0x378 and _non_assigne_u14(ord(c)))
    if mode == "ftfy":
        return c in _COLLES_FTFY
    if mode == "production":
        return c in _COLLES_PRODUCTION
    return False


def _effacer_lecture(s, mode):
    """\\t \\n \\r -> espace ; caracteres effaces par la lecture principale : effaces si la lecture les colle, sinon un espace."""
    return "".join((("" if _colle_lecture(c, mode) else " ") if _efface(c) else c) for c in _RE_BLANCS_CONTROLE.sub(" ", s))


_CACHE_SYMBOLES = {}


def _symbole_lettre(c):
    """Caractere qui n'est pas une lettre mais que NFKC change en lettre (™, ℡, Ⓧ, Ⅹ...), ou lettre-emoji : le tokenizer CLIP,
    qui n'applique pas NFKC, coupe le mot sur ce caractere."""
    r = _CACHE_SYMBOLES.get(c)
    if r is None:
        r = (unicodedata.category(c)[0] != "L"
             and (_lettre_symbole(ord(c)) is not None
                  or any(unicodedata.category(x)[0] == "L" for x in unicodedata.normalize("NFKC", c))))
        if len(_CACHE_SYMBOLES) >= 4096:
            _CACHE_SYMBOLES.clear()
        _CACHE_SYMBOLES[c] = r
    return r


def _symboles_separes(s, mode):
    """Lettres-emoji et symboles NFKC -> espace (la production ne changeait en espace que les lettres-emoji)."""
    if s.isascii():
        return s
    return "".join(" " if (ord(c) >= 0x80 and _symbole_lettre(c)
                           and (mode != "production" or _lettre_symbole(ord(c)) is not None)) else c for c in s)


def _nettoyer_lecture(brut, mode):
    """Texte nettoye d'une lecture ou les caracteres effaces ou changes par la lecture principale separent les mots."""
    s = _sans_mojibake(brut) if mode == "ftfy" else brut
    s = _effacer_lecture(s, mode)
    if mode == "ftfy":
        s = _effacer_lecture(_sans_mojibake(s), mode)
    s = unicodedata.normalize("NFKC", _symboles_separes(s, mode))
    if mode == "ftfy" and "&" in s:
        s = unicodedata.normalize("NFKC", _symboles_separes(_effacer_lecture(_sans_references_html(s), mode), mode))
    # marques restees seules apres la composition : separateurs (la production effacait celles de U+0300-036F)
    s = "".join(((" " if not (mode == "production" and 0x300 <= ord(c) <= 0x36F) else "") if _est_marque(c) else c) for c in s)
    s = _chiffres_ascii(s).lower()
    # apres les minuscules : « Ħ » et « Ա » deviennent « ħ » et « ա », absents des tables de la production
    return "".join(" " if c in _TRANSLIT_HORS_PRODUCTION else c for c in s) if mode == "production" else s


def _lire(prompt):
    """Toutes les lectures du texte, chacune aussi sans la syntaxe de poids collee dans un mot ; sans doublon. Rend (nets, vues).
    Un texte ASCII imprimable sans « & » n'a qu'une lecture."""
    brut = _en_texte(prompt)
    lectures = [_nettoyer(brut)]
    if not _RE_ASCII_SIMPLE.fullmatch(brut):
        for mode in _MODES_LECTURE:
            n = _nettoyer_lecture(brut, mode)
            if n not in lectures:
                lectures.append(n)
    nets = []
    for n in lectures:
        for x in (n, _sans_syntaxe_collee(n)):
            if x not in nets:
                nets.append(x)
    return nets, [_vues_plancher(n) for n in nets]


# ═══════════════════════════════════════════════════════════════════════════
# TERMES. Syntaxe : « mot » = mot entier ; « mot* » = debut de mot ; « *mot* » = n'importe ou dans un mot.
# Les termes sont normalises comme le texte avant compilation : accents et ponctuation sans effet.
# ═══════════════════════════════════════════════════════════════════════════

class _Terme:
    __slots__ = ("src", "re", "cat")

    def __init__(self, src, regex, cat):
        self.src = src
        self.re = regex
        self.cat = cat


def _noyau_source(src):
    if src.startswith("*"):
        src = src[1:]
    if src.endswith("*"):
        src = src[:-1]
    return src


def _forme_terme(src):
    return _simple(_translit(_base(_noyau_source(src))))


def _forme_unicode(src):
    return _vue_unicode(_nettoyer(_noyau_source(src)))


class _Liste:
    """Liste compilee. `rapide` : UNE expression qui accepte tout texte ou un terme de la liste peut se trouver ; quand elle
    ne trouve rien, la liste est ecartee sans essayer ses termes un par un (meme resultat, bien plus rapide)."""
    __slots__ = ("termes", "bornes", "infixes", "rapide")

    def __init__(self, termes, bornes, infixes):
        self.termes = termes
        self.bornes = bornes
        self.infixes = infixes
        parties = []
        if bornes:
            parties.append("(?:^| )(?:" + "|".join(bornes) + ")")
        if infixes:
            parties.append("(?:" + "|".join(infixes) + ")")
        self.rapide = re.compile("|".join(parties)) if parties else None


def _fusionner(*listes):
    return _Liste([t for l in listes for t in l.termes], [b for l in listes for b in l.bornes],
                  [i for l in listes for i in l.infixes])


def _compiler_avec(liste, cat, forme):
    termes = []
    bornes = []
    infixes = []
    for src in liste:
        infixe = src.startswith("*")
        prefixe = src.endswith("*")
        noyau = re.escape(forme(src))
        if not noyau:
            continue   # terme vide apres normalisation (idiome) : jamais compile en expression qui accepte tout
        termes.append(_Terme(src, re.compile(("" if infixe else "(?:^| )") + noyau + ("" if prefixe else r"(?= |\Z)")), cat))
        (infixes if infixe else bornes).append(noyau)
    return _Liste(termes, bornes, infixes)


def _compiler(liste, cat):
    return _compiler_avec(liste, cat, _forme_terme)


def _compiler_unicode(liste, cat):
    return _compiler_avec(liste, cat, _forme_unicode)


def _chercher(vues, liste):
    if liste.rapide is None or not any(liste.rapide.search(v) for v in vues):
        return None
    for t in liste.termes:
        for v in vues:
            if t.re.search(v):
                return t
    return None


def _nom(t):
    return _noyau_source(t.src)


# ── Mots colles (M2) ───────────────────────────────────────────────────────
_ALT_M = "(?:" + "|".join(COLLE_MINEURS) + ")"
_ALT_N = "(?:" + "|".join(COLLE_NUDITE) + ")"
_ALT_B = "(?:" + "|".join(COLLE_NUDITE_BORD) + ")"
_RE_COLLE = re.compile(_ALT_M + _ALT_N + "|" + _ALT_N + _ALT_M + "|" + _ALT_M + _ALT_B + r"\Z|^" + _ALT_B + _ALT_M)


def _colle(vue):
    for jeton in vue.split(" "):
        if len(jeton) >= 5 and _RE_COLLE.search(jeton):
            return True
    return False


# ── Ages (plancher) ────────────────────────────────────────────────────────
def _alt(liste):
    return "(?:" + "|".join(liste) + ")"


def _par_longueur(liste):
    return sorted(dict.fromkeys(liste), key=lambda x: -len(x))


_NB_LETTRES = "(?<![a-z])" + _alt(re.escape(x) for x in _par_longueur(NOMBRES_LETTRES)) + "(?![a-z])"
_NB_LETTRES_SURS = ("(?<![a-z])" + _alt(re.escape(x) for x in _par_longueur([x for x in NOMBRES_LETTRES if x not in NOMBRES_AMBIGUS]))
                    + "(?![a-z])")
_NB_CHIFFRES = "(?<![0-9])(?:1[0-7]|0?[0-9])(?![0-9])"
_PAS_GRAND = "(?! ?" + _alt(GRANDS_NOMBRES) + "(?![a-z]))"
_NB = "(?:" + _NB_CHIFFRES + "|" + _NB_LETTRES + ")" + _PAS_GRAND
_NB_APRES_PREFIXE = "(?:" + _NB_CHIFFRES + "|" + _NB_LETTRES_SURS + ")" + _PAS_GRAND
_UNITE_ROMANE = (_alt(UNITES_AGE_ROMANES) + "(?![a-z])(?! " + _alt(COMPLEMENTS_DE) + " " + _alt(DUREES_NON_AGE)
                 + "(?![a-z]))")
_UNITE = "(?:" + _alt(UNITES_AGE) + "(?![a-z])|" + _UNITE_ROMANE + ")"
_RE_AGE = re.compile("(?:^| )" + _NB + " ?" + _UNITE + "|(?:^| )" + _alt(PREFIXES_AGE) + " ?" + _NB_APRES_PREFIXE
                     + "(?![a-z0-9])" + "|(?:^| )" + _alt(NOMBRES_COMPOSES_DE) + "jahrig")
# « N ans de <duree> » lu comme un age avec un mineur ambigu NOMME ou un indice (seconde relecture du 14/10).
_RE_AGE_ROMAN_LARGE = re.compile("(?:^| )" + _NB + " ?" + _alt(UNITES_AGE_ROMANES) + "(?![a-z])")
_RE_NAISSANCE = re.compile("(?:^| )" + _alt(_par_longueur(PREFIXES_NAISSANCE)) + " ((?:19|20)[0-9][0-9])(?![0-9])")
_NB_CHIFFRES_U = "(?<![0-9])(?:1[0-7]|0?[0-9])(?! ?[0-9])"
_NB_HAN = "(?<![一二三四五六七八九十百千两兩])(?:十[一二三四五六七]?|[一二三四五六七八九两兩])"
_RE_AGE_UNICODE = re.compile(_NB_CHIFFRES_U + " ?" + _alt(UNITES_AGE_UNICODE) + "|" + _NB_HAN + "(?:岁|歲|歳|才)|"
                             + _alt(PREFIXES_AGE_UNICODE) + " ?" + _NB_CHIFFRES_U)
# Mineurs CONSTRUITS (troisieme relecture du 14/10) : « escolar » nom apres un determinant ou un adjectif (« una joven escolar »,
# « mi escolar »), « a grade one girl », « a girl from first grade » (listes AVANT_ESCOLAR, NOMBRES_CLASSE generees).
_RE_MINEURS_CONSTRUITS = re.compile(
    "(?:^| )" + _alt(AVANT_ESCOLAR) + r" escolar(?:es)?(?= |\Z)"
    + "|(?:^| )grade " + _alt(NOMBRES_CLASSE) + " (?:girl|boy|student|pupil)"
    + "|(?:^| )(?:girl|boy|student|pupil)s? (?:from|in|of) (?:the )?" + _alt(CLASSES_ORDINAUX) + r" grade(?= |\Z)")


def _age_par_naissance(vue):
    """« born in 2018 » : vrai si l'annee de naissance est a moins de 18 ans de l'annee en cours (horloge UTC)."""
    an = time.gmtime().tm_year
    for m in _RE_NAISSANCE.finditer(vue):
        y = int(m.group(1))
        if an - 18 < y <= an:
            return True
    return False


# ── Compilation (une fois par processus) ───────────────────────────────────
T_MINEURS_FORT = _fusionner(_compiler(MINEURS_FORT, "plancher"),
                            _compiler([o + " grade " + e for o in CLASSES_ORDINAUX for e in ELEVES_CLASSE], "plancher"))
T_MINEURS_AMBIGUS = _compiler(MINEURS_AMBIGUS, "plancher")
T_MINEURS_AMBIGUS_NOMS = _compiler([x for x in MINEURS_AMBIGUS if x not in ADJECTIFS_JEUNESSE], "plancher")
T_MINEURS_INDICES = _compiler(MINEURS_INDICES, "plancher")
T_MINEURS_VIOLENCE = _compiler(MINEURS_VIOLENCE, "mineur_violence")
T_NU_FORT = _compiler(NU_FORT, "plancher")
T_NU_EXACTS = _compiler(NU_EXACTS, "plancher")
T_NU_MOYEN = _compiler(NU_MOYEN, "plancher")
T_NU_FAIBLE_PLANCHER = _compiler(NU_FAIBLE_PLANCHER, "plancher")
T_NU_FAIBLE_GENERAL = _compiler(NU_FAIBLE_GENERAL, "mineur_violence")
T_SEXE_MINEUR_FORT = _compiler(SEXE_MINEUR_FORT, "plancher")
T_VIOLENCE_ENFANT_PLANCHER = _compiler(VIOLENCE_ENFANT_PLANCHER, "plancher")
T_PLANCHER_MOTS = _compiler(PLANCHER_MOTS, "plancher")
T_PLANCHER_UNICODE = _compiler_unicode(PLANCHER_UNICODE, "plancher")
T_MINEURS_FORT_UNICODE = _compiler_unicode(MINEURS_FORT_UNICODE, "plancher")
T_MINEURS_AMBIGUS_UNICODE = _compiler_unicode(MINEURS_AMBIGUS_UNICODE, "plancher")
T_NU_FORT_UNICODE = _compiler_unicode(NU_FORT_UNICODE, "plancher")
T_NU_SUGGESTIF_UNICODE = _compiler_unicode(NU_SUGGESTIF_UNICODE, "plancher")
T_NU_MOYEN_UNICODE = _compiler_unicode(NU_MOYEN_UNICODE, "plancher")
T_NU_FAIBLE_UNICODE = _compiler_unicode(NU_FAIBLE_UNICODE, "plancher")
T_VIOLENCE_UNICODE = _compiler_unicode(VIOLENCE_UNICODE, "plancher")
T_SEXUEL_DUR = _compiler(GENERAL_SEXUEL_DUR, "sexuel")
T_SEXUEL_EXACTS = _compiler(NU_EXACTS, "sexuel")
T_SEXUEL_UNICODE = _compiler_unicode(NU_FORT_UNICODE, "sexuel")
T_CTX_SEXUEL = _compiler(GENERAL_CTX_SEXUEL, "contexte")
T_CTX_SEXUEL_FAIBLE = _compiler(CONTEXTE_SEXUEL_FAIBLE, "contexte")
T_CTX_VIOLENCE = _compiler(GENERAL_CTX_VIOLENCE, "contexte")
T_DURS_AUTRES = _fusionner(
    _compiler(GENERAL_VIOLENCE_DUR, "violence"), _compiler(GENERAL_DROGUE_DUR, "drogue"),
    _compiler(GENERAL_EXTREMISME_DUR, "extremisme"), _compiler(GENERAL_AUTOBLESSURE_DUR, "autoblessure"),
    _compiler(GENERAL_HAINE_DUR, "haine"), _compiler(GENERAL_ARMES_DUR, "armes"),
)
T_PERSONNES = _compiler(PERSONNES, "combinaison")
T_NUDITE_EXTREME = _compiler(NUDITE_EXTREME, "combinaison")
T_VIOLENCE_ENFANT_GENERAL = _compiler(VIOLENCE_ENFANT_GENERAL, "mineur_violence")
_PLANCHER_COLLES_ECRASES = tuple(_RE_REPETE2.sub(r"\1", s) for s in PLANCHER_COLLES)

# ═══════════════════════════════════════════════════════════════════════════
# PLANCHER ILLICITE
# ═══════════════════════════════════════════════════════════════════════════

_MSG_PLANCHER = "Blocked: this content is illegal and cannot be generated under any setting."
_MSG_PLANCHER_MINEUR = ("Blocked: depicting minors in this context is illegal and cannot be generated "
                        "under any setting.")
_CONSEIL_REFUS = "Modify your prompt or contact support to request unrestricted access."


def check_hard_floor(prompt):
    """Contenu illicite (mineurs) qu'AUCUN reglage, `unrestricted` compris, ne peut lever.
    Plus strict que le filtre general sur les formes (normalisation, ages, langues), mais sans
    vocabulaire de jeu video (« kid friendly », « young hero », « teen titans style » passent)."""
    # Toutes les lectures du texte, sans la syntaxe de poids collee dans un mot comprise (« na()ked » : revue du 14/10, B1).
    return _plancher(_lire(prompt)[1])


def _plancher(vs):
    """Plancher sur les vues REUNIES de toutes les lectures (troisieme relecture du 14/10)."""
    vues = [x for v in vs for x in [v["chiffres"], v["leetI"], v["leetL"]] + v["separees"]]
    uni = [x for v in vs for x in v["unicode"]]
    exactes = [x for v in vs for x in v["exactes"]]

    def bloquer(blocked, reason):
        return {"safe": False, "blocked": blocked, "reason": reason, "categorie": "plancher", "hardFloor": True}

    # 1. Termes illicites en soi.
    u = _chercher(uni, T_PLANCHER_UNICODE)
    if u:
        return bloquer(_nom(u), _MSG_PLANCHER)
    mot = _chercher(vues, T_PLANCHER_MOTS)
    if mot:
        return bloquer(_nom(mot), _MSG_PLANCHER)
    collees = [c for v in vs for c in v["collees"]]
    for i, colle in enumerate(PLANCHER_COLLES):
        if any(_PLANCHER_COLLES_ECRASES[i] in c for c in collees):
            return bloquer(colle, _MSG_PLANCHER)

    for serie in [s for v in vs for s in v["series"]]:
        if any(x in serie for x in SERIE_MINEURS) and any(x in serie for x in SERIE_NUDITE):
            return bloquer("minor-safety", _MSG_PLANCHER_MINEUR)
    # 1b. Mineur et nudite COLLES dans un meme mot (« childnaked ») : CLIP les lit comme deux mots (M2).
    if any(_colle(x) for x in vues) or any(_colle(x) for v in vs for x in v["nonEcrasees"]):
        return bloquer("minor-safety", _MSG_PLANCHER_MINEUR)

    # 2. Mineur x nudite / sexe, mineur x violence exercee sur lui.
    mineur_fort = (_chercher(vues, T_MINEURS_FORT) or _chercher(uni, T_MINEURS_FORT_UNICODE)
                   or any(_RE_MINEURS_CONSTRUITS.search(x) for x in vues))
    mineur_ambigu = _chercher(vues, T_MINEURS_AMBIGUS) or _chercher(uni, T_MINEURS_AMBIGUS_UNICODE)
    indice = _chercher(vues, T_MINEURS_INDICES)
    # « une fille, 10 ans de guerre, au bain » : avec un mineur ambigu NOMME ou un indice, « N ans de <duree> » compte aussi
    age_large = (any(_RE_AGE_ROMAN_LARGE.search(x) for x in vues)
                 if (indice or _chercher(vues, T_MINEURS_AMBIGUS_NOMS)) else False)
    age = (age_large or any(_RE_AGE.search(x) or _age_par_naissance(x) for x in vues)
           or any(_RE_AGE_UNICODE.search(x) for x in uni))
    if mineur_fort or age or mineur_ambigu or indice:
        explicite = (_chercher(vues, T_NU_FORT) or _chercher(exactes, T_NU_EXACTS) or _chercher(uni, T_NU_FORT_UNICODE)
                     or _chercher(uni, T_NU_SUGGESTIF_UNICODE))
        if explicite:
            return bloquer("minor-safety", _MSG_PLANCHER_MINEUR)
        if mineur_fort or age or mineur_ambigu:
            if _chercher(vues, T_NU_MOYEN) or _chercher(uni, T_NU_MOYEN_UNICODE):
                return bloquer("minor-safety", _MSG_PLANCHER_MINEUR)
        if mineur_fort or age:
            if _chercher(vues, T_SEXE_MINEUR_FORT):
                return bloquer("minor-safety", _MSG_PLANCHER_MINEUR)
            if _chercher(vues, T_NU_FAIBLE_PLANCHER) or _chercher(uni, T_NU_FAIBLE_UNICODE):
                return bloquer("minor-safety", _MSG_PLANCHER_MINEUR)
            if _chercher(vues, T_VIOLENCE_ENFANT_PLANCHER) or _chercher(uni, T_VIOLENCE_UNICODE):
                return bloquer("minor-safety", _MSG_PLANCHER_MINEUR)
    return {"safe": True}


# ═══════════════════════════════════════════════════════════════════════════
# FILTRE GENERAL
# ═══════════════════════════════════════════════════════════════════════════

def check_prompt_safety(prompt, unrestricted=False):
    nets, vs = _lire(prompt)
    floor = _plancher(vs)
    if not floor["safe"]:
        return floor                       # plancher illicite : jamais contournable
    if unrestricted:
        return {"safe": True}              # `unrestricted` ne leve que les filtres SOUPLES

    # Toutes les lectures du texte (troisieme relecture du 14/10), chacune aussi sans la syntaxe de poids collee (revue, B1).
    # textes tels quels (sans translitteration), et coupes entre lettres et chiffres (un chiffre arabe-indien que la production
    # lisait comme un separateur devient un chiffre ASCII, que CLIP lit seul)
    bruts = [_simple(_sans_expressions_sures(_sans_marques(n))) for n in nets]
    souples = bruts + [x for x in _separees(bruts) if x not in bruts]
    # l'explicite est teste sur les formes deguisees aussi
    toutes = souples + [x for v in vs for x in [v["chiffres"], v["leetI"], v["leetL"]] + v["separees"]]

    def refus(t):
        return {"safe": False, "blocked": _nom(t), "categorie": t.cat,
                "reason": 'Content filter: "%s" is blocked. %s' % (_nom(t), _CONSEIL_REFUS)}

    def combinaison(a, b, cat):
        return {"safe": False, "blocked": "%s + %s" % (_nom(a), _nom(b)), "categorie": cat,
                "reason": 'Content filter: combination "%s" + "%s" is blocked. This type of content is not allowed.'
                          % (_nom(a), _nom(b))}

    # 1. Termes explicites (sexe, nudite) : mots entiers, y compris deguises ; mots courts sur la vue exacte ; autres
    #    ecritures sur la vue Unicode.
    sexuel = (_chercher(toutes, T_SEXUEL_DUR)
              or _chercher([x for v in vs for x in v["exactes"]], T_SEXUEL_EXACTS)
              or _chercher([x for v in vs for x in v["unicode"]], T_SEXUEL_UNICODE))
    if sexuel:
        return refus(sexuel)
    # 2. Autres familles bloquees seules (gore explicite, drogues dures, terrorisme, haine, auto-agression, armes).
    autre = _chercher(souples, T_DURS_AUTRES)
    if autre:
        return refus(autre)

    # 3. Termes AMBIGUS (vocabulaire de jeu) : seulement en contexte.
    ctx_sexuel = _chercher(souples, T_CTX_SEXUEL)
    if ctx_sexuel and _chercher(toutes, T_CTX_SEXUEL_FAIBLE):
        return refus(ctx_sexuel)
    ctx_violence = _chercher(souples, T_CTX_VIOLENCE)
    if ctx_violence and _chercher(souples, T_MINEURS_VIOLENCE):
        return refus(ctx_violence)

    # 4. Combinaisons.
    # 4a. mineur sans ambiguite x vocabulaire de chambre (le plancher a deja traite le reste)
    mineur = _chercher(toutes, T_MINEURS_FORT)
    if mineur:
        b = _chercher(souples, T_NU_FAIBLE_GENERAL)
        if b:
            return combinaison(mineur, b, "combinaison")
    # 4b. personne x nudite explicite par periphrase
    a2 = _chercher(souples, T_PERSONNES)
    b2 = _chercher(souples, T_NUDITE_EXTREME) if a2 else None
    if a2 and b2:
        return combinaison(a2, b2, "combinaison")
    # 4c. enfant x violence
    a3 = _chercher(souples, T_MINEURS_VIOLENCE)
    b3 = _chercher(souples, T_VIOLENCE_ENFANT_GENERAL) if a3 else None
    if a3 and b3:
        return combinaison(a3, b3, "mineur_violence")

    return {"safe": True}


def prompt_hard_floor(prompt):
    """Contrat de l'ancienne `_prompt_hard_floor` d'app.py : `None` si le texte passe, sinon la raison
    du refus (chaine), renvoyee telle quelle en 403 par les routes. JAMAIS contournee par `unrestricted`."""
    r = check_hard_floor(prompt)
    return None if r["safe"] else r["reason"]


# ═══════════════════════════════════════════════════════════════════════════
# LONGUEUR ET SYNTAXE DU TEXTE ENVOYE AU GENERATEUR (2026-10-13 : MODERATION-07, SERVEUR-09)
# ═══════════════════════════════════════════════════════════════════════════

PROMPT_MAX_CARACTERES = 2000      # description de l'utilisateur
PROMPT_MAX_ENRICHI = 4000         # prompt complet (gabarits compris) et textes d'outils
POIDS_PROMPT_MIN = 0.5            # bornes des poids « (mot:1.4) » : les gabarits du produit vont de 1,2 a 1,8
POIDS_PROMPT_MAX = 2

_RE_POIDS = re.compile(":[" + _WS + "]*([+-]?[0-9.]*)[" + _WS + "]*\\)")
_RE_NOMBRE = re.compile(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)")
_RE_JETON_OUVRANT = re.compile("<[" + _WS + "]*\\|")
_RE_JETON_FERMANT = re.compile("\\|[" + _WS + "]*>")
# « & » et « # » sous leurs formes de compatibilite aussi (pleine chasse, petites) : ftfy les ramene en ASCII avant de decoder
_RE_ENTITE_HTML = re.compile("[&\uff06\ufe60](?=[#\uff03\ufe5fA-Za-z\uff21-\uff3a\uff41-\uff5a])")


def longueur_ponderee(texte):
    """Un caractere de l'alphabet latin (jusqu'a U+024F) compte 1, tout autre 3 ; les caracteres effaces ne comptent pas."""
    return sum(1 if ord(c) <= 0x24F else 3 for c in _sans_effaces(_en_texte(texte)))


def controler_longueur_prompt(texte, max_=PROMPT_MAX_CARACTERES):
    """Refuse un texte plus long que `max_` (longueur ponderee) : meme contrat que check_prompt_safety, categorie « longueur »."""
    brut = _en_texte(texte)
    n = _longueur_js(brut) if _longueur_js(brut) > max_ * 8 else longueur_ponderee(brut)
    if n <= max_:
        return {"safe": True}
    return {"safe": False, "blocked": "length", "categorie": "longueur",
            "reason": "Prompt too long (%d / %d): please shorten your description. Characters outside the Latin "
                      "alphabet count as 3." % (n, max_)}


def neutraliser_syntaxe_prompt(texte):
    """Texte tel qu'il part au generateur : caracteres effaces retires (\\t \\n \\r -> espace), jetons speciaux du tokenizer
    (« <|endoftext|> », « <|startoftext|> ») casses, references de caractere HTML cassees (« &#110; » -> « & #110; » : avec
    ftfy, le tokenizer CLIP les decode ; « & » et « # » en pleine chasse ou en petite forme aussi), poids A1111 « (mot:x) » ramenes dans [POIDS_PROMPT_MIN, POIDS_PROMPT_MAX] (un poids
    mal forme est retire). Un poids deja dans les bornes est laisse tel quel."""
    s = _sans_effaces(_RE_BLANCS_CONTROLE.sub(" ", _en_texte(texte)))
    s = _RE_ENTITE_HTML.sub(lambda m: m.group(0) + " ", _RE_JETON_FERMANT.sub(" ", _RE_JETON_OUVRANT.sub(" ", s)))

    def poids(m):
        nb = m.group(1)
        v = float(nb) if _RE_NOMBRE.fullmatch(nb) else float("nan")
        if v != v or v in (float("inf"), float("-inf")):
            return ")"
        if v < POIDS_PROMPT_MIN:
            return ":" + str(POIDS_PROMPT_MIN) + ")"
        if v > POIDS_PROMPT_MAX:
            return ":" + str(POIDS_PROMPT_MAX) + ")"
        return m.group(0)

    return _RE_POIDS.sub(poids, s)
