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
longueur d'une chaine (JS compte en unites UTF-16). Reste une difference de TABLES : le Python de Modal (3.11) connait
Unicode 14, le moteur JavaScript une version plus recente ; un caractere attribue apres Unicode 14 est efface ici (et par
CLIP, qui tourne dans ce meme Python) mais pas forcement par le worker. Le test build/bancs/noyaux/test_moderation_modal.py
rejoue les memes jeux de cas que cloud/tests/moderation.test.mjs ET compare ce module au TypeScript sur un corpus
(si node est present).

REGLE « kind » (2026-10-03). Le mot allemand « Kind » (singulier) etait absent : « kind » est ambigu avec
l'adjectif anglais (« a kind knight »). Il est donc un mineur AMBIGU, comme girl / boy : il ne bloque qu'avec
une nudite explicite ou une tenue minimale, jamais avec le simple vocabulaire de scene (bath, shower) ni
avec une violence. Dans une serie de lettres isolees (« k i n d n a c k t »), « kind » compte comme mineur.

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

# Caracteres EFFACES en plus de la categorie C : U+FFFD et les « ignorables » qui ne sont pas de categorie C.
_EFFACES_HORS_C = frozenset("\ufffd\u115f\u1160\u17b4\u17b5\u2800\u3164\uffa0")
# Marques gardees par la vue Unicode (voyelles et viramas indiens, thai, lao, tibetain, birman, khmer ; voisement des kana).
_PLAGES_MARQUES_GARDEES = ((0x0900, 0x0DFF), (0x0E00, 0x0FFF), (0x1000, 0x109F), (0x1780, 0x17FF), (0x3099, 0x309A))
# Vue exacte : crochet, tilde, corne, point souscrit (vietnamien, espagnol « ñ »).
_MARQUES_DISTINCTIVES = frozenset("\u0303\u0309\u031b\u0323")


def _efface(c):
    return unicodedata.category(c)[0] == "C" or c in _EFFACES_HORS_C


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
    "child", "children", "childlike", "child like", "kid", "kids", "kiddo", "kiddie", "kiddy", "infant*", "baby",
    "babies", "toddler*", "preteen*", "pre teen*", "tween*", "teen", "teens", "teenage*", "teenager*", "minor",
    "minors", "underage", "under age", "juvenile*", "prepubescent", "pubescent", "schoolgirl*", "schoolboy*",
    "school girl*", "school boy*", "schoolchild*", "little girl*", "little boy*", "small girl*", "small boy*",
    "young girl*", "young boy*", "young lad*", "young teen*", "young looking", "looks young", "looking young",
    "kindergarten*", "preschool*", "elementary school", "primary school", "middle school", "junior high",
    "high school", "highschool", "under 18", "below 18", "less than 18", "younger than 18", "under eighteen",
    "under 16", "under 14", "newborn*", "new born*", "neonat*", "youngster*", "tots", "schoolkid*", "school kid*",
    "little one", "little ones", "youngling*", "bairn*", "tyke*", "moppet*", "rugrat*", "street urchin*", "underaged",
    "under aged", "little sister*", "little brother*", "baby sister*", "baby brother*", "sweet sixteen",
    "middle schooler*", "high schooler*", "grade school*", "sprog", "sprogs", "nipper", "nippers",
    "elementary schooler*", "kindergartner*", "nursery school*", "cub scout*", "girl scout*", "boy scout*",
    "first grade*", "second grade*", "third grade*", "fourth grade*", "fifth grade*", "sixth grade*",
    "seventh grade*", "eighth grade*", "ninth grade*", "tenth grade*", "eleventh grade*", "twelfth grade*",
    "1st grade*", "2nd grade*", "3rd grade*", "4th grade*", "5th grade*", "6th grade*", "7th grade*", "8th grade*",
    "9th grade*", "10th grade*", "11th grade*", "12th grade*", "below the age of 18", "under the age of 18",
    "not yet 18", "not yet eighteen", "enfant*", "bebe*", "gamin", "gamine", "gamins", "gamines", "gosse*",
    "fillette*", "garconnet*", "mineur*", "adolescent*", "ado", "ados", "ecolier*", "ecoliere*", "collegien*",
    "lyceen*", "nourrisson*", "petite fille*", "petit garcon*", "jeune fille*", "jeune garcon*", "moins de 18",
    "marmot", "marmots", "mome", "momes", "petiot*", "pitchoun*", "nouveau ne*", "nouveaux nes", "preado*",
    "pre ado*", "nino*", "nina*", "nene", "nena", "menor", "menores", "adolescente*", "chiquill*", "preadolescente*",
    "colegial*", "menos de 18", "recien nacid*", "escolar", "escolares", "kinder*", "kleinkind*", "madchen*",
    "maedchen*", "minderjahrig*", "jugendlich*", "schulmadchen*", "unter 18", "saugling*", "teenie*", "crianca*",
    "menino*", "menina*", "garotinho*", "garotinha*", "menininh*", "nenem*", "menor de idade", "bambin*", "ragazzin*",
    "minorenn*", "neonat*", "fanciull*", "sotto i 18", "bimba", "bimbe", "bimbi", "scolar*", "infantil*", "infante*",
    "cocuk*", "cocug*", "bebek*", "kucuk kiz*", "kucuk oglan*", "resit olmayan", "ergen*", "ilkokul*", "peuter*",
    "kleuter*", "minderjarig*", "jongetje*", "dziecko", "dzieci*", "dziecka", "dziecku", "dzieckiem", "dziewczynk*",
    "chlopczyk*", "niemowl*", "nieletni*", "anak", "anak anak", "balita", "bayi", "di bawah umur", "tre em", "be gai",
    "be trai", "em be", "thieu nhi", "vi thanh nien", "dua tre", "tre con", "con nit", "cau be", "co be", "ein kind",
    "das kind", "dem kind", "einem kind", "kleines kind", "kleinen kind", "kindes", "een kind", "het kind",
)

MINEURS_AMBIGUS = (
    "boy", "boys", "girl", "girls", "young", "youth", "youthful", "lass", "jeune", "jeunes", "fille", "filles",
    "garcon", "garcons", "junge", "junges", "jungen", "chico", "chica", "chicos", "chicas", "muchacho", "muchacha",
    "joven", "jovenes", "ragazzo", "ragazza", "ragazzi", "ragazze", "garoto", "garota", "rapaz", "rapariga", "kind",
    "chaval*", "cria", "crias", "schuler*", "kiz", "kizlar*", "oglan*", "meisje*", "jongen*", "dziewczyn*",
    "chlopiec", "chlopc*", "gadis", "remaja",
)

MINEURS_INDICES = (
    "daughter*", "niece*", "nephew*", "little miss", "lolita*", "pupil", "pupils", "stepdaughter*", "stepson*",
)

MINEURS_VIOLENCE = (
    "child", "children", "kid", "kids", "baby", "babies", "infant*", "toddler*", "enfant*", "bebe*", "nino*", "nina*",
    "kinder*", "crianca*", "bambin*",
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
    "foursome*", "bestiality", "zoophil*", "incest*", "fisting", "dildo*", "butt plug*", "buttplug*", "vulva*",
    "labia", "clitor*", "clit", "clits", "areola*", "scrotum*", "testicle*", "phallus*", "pubic hair", "pubes",
    "private parts", "intimate parts", "molest*", "raped", "raping", "rapist*", "prostitut*", "brothel*", "stripper*",
    "striptease*", "strip tease*", "lap dance*", "making love", "make love", "touching himself", "touching herself",
    "touching themselves", "lifting her skirt", "lifts her skirt", "lifted her skirt", "skirt lift*", "camel toe",
    "nip slip", "skinny dipping", "in the buff", "nudis*", "naturist*", "milf*", "slut*", "whore*", "futanari",
    "shemale*", "dominatrix", "ball gag*", "ballgag*", "anal", "anus", "nudite", "denud*", "deshabill*",
    "sans vetement*", "sans habit*", "a poil", "seins nus", "sein nu", "sexe", "sexuel*", "erotique*", "*pornograph*",
    "*pornograf*", "sensuel*", "seducteur", "provocant*", "soutien gorge", "seins", "tout nu", "toute nue",
    "sous vetement*", "en culotte", "en string", "en slip", "en calecon", "en petite tenue", "devetu*", "tenue d eve",
    "tenue d adam", "plus simple appareil", "sans rien sur le dos", "nuisette*", "sodomie", "fellation", "viol",
    "violee", "violees", "attouchement*", "partouze*", "*desnud*", "sin ropa", "en cueros", "sexo", "lenceria",
    "ropa interior", "bragas", "tanga", "provocativ*", "senos", "tetas", "calzon*", "en pelotas", "sin nada puesto",
    "ropa intima", "follar", "follando", "abuso sexual", "*nackt*", "ausgezogen", "entkleidet", "unbekleidet",
    "oben ohne", "ohne kleidung", "ohne kleider", "erotisch*", "sexuell*", "unterwasche", "sinnlich*",
    "verfuhrerisch*", "busen", "titten", "unterhose*", "schlupfer*", "reizwasche", "entblosst*", "barbusig*",
    "nackig*", "fkk", "geschlechtsverkehr", "vergewaltig*", "ficken", "fickt", "gefickt", "seminu", "seminus",
    "seminua", "seminuas", "seminude*", "seminudo*", "seminuda*", "seminudi", "sem roupa*", "calcinha*",
    "roupa intima", "peitos", "seios", "pelad*", "de cueca", "de cuecas", "em cueca", "em cuecas", "despid*",
    "nuazinh*", "trajes intimos", "estupr*", "nudo", "nudi", "nudita", "spogliat", "spogliata", "spogliato",
    "spogliati", "spogliate", "spogliarsi", "spogliarell*", "svestit*", "senza vestiti", "senza vestito",
    "senza abiti", "seno nudo", "seni nudi", "nuda", "sessuale", "sesso", "mutand*", "provocante", "seni", "tette",
    "biancheria intima", "perizoma", "seno scoperto", "senza niente addosso", "nudin*", "in slip", "*ciplak*",
    "soyunmus", "soyunuk", "seks", "seksi", "seksuel*", "erotik*", "ic camasir*", "kulot*", "tecavuz*", "taciz*",
    "cinsel*", "mustehcen*", "naakt*", "ontkleed*", "ondergoed*", "seksueel*", "nagie", "nago", "nagich", "nagosc*",
    "rozebran*", "bielizn*", "seksualn*", "telanjang", "bugil", "cabul*", "pakaian dalam", "pemerkosa*", "mesum",
    "khoa than", "khieu dam", "do lot", "hiep dam",
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
    "roupa transparente", "sem camiseta", "reggiseno", "pigiama trasparente",
)

NU_FAIBLE_PLANCHER = (
    "bath", "bathing", "shower", "showering", "intimate", "revealing", "bain", "banho", "bano", "badewanne", "bagno",
    "douche", "ducha", "dusche", "doccia", "chuveiro", "changing clothes", "getting changed", "getting dressed",
    "only a towel", "only in a towel", "in a towel", "wrapped in a towel", "solo con una toalla", "solo una toalla",
)

NU_FAIBLE_GENERAL = (
    "bed", "bedroom",
)

SEXE_MINEUR_FORT = (
    "dick", "dicks", "cock", "cocks", "erection*", "boner*", "hardon*", "penetrating her", "penetrating him",
    "being penetrated", "spread legs", "spreading her legs", "spread her legs", "legs spread",
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

MOTS_AGE = (
    "edad", "idade", "age", "eta",
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
    "snaked", "pornic", "nudel[a-z]*", "nacktschneck[a-z]*", "nacktmull[a-z]*", "nacktkatzen?", "nacktsamer[a-z]*",
    "nackthund[a-z]*", "naaktslak[a-z]*", "spogliatoi[a-z]*",
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
    "mur[io] !nud[oi]", "paret[ei] !nud[ae]",
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
    "bukkake", "gang bang*", "foursome*", "bestiality", "zoophil*", "necrophil*", "incest*", "fisting", "butt plug*",
    "buttplug*", "vulva*", "labia", "clitor*", "clit", "clits", "areola*", "scrotum*", "testicle*", "phallus*",
    "pubic hair", "pubes", "private parts", "intimate parts", "molest*", "raped", "raping", "rapist*", "rape scene*",
    "striptease*", "strip tease*", "strip club*", "lap dance*", "making love", "make love", "kama sutra",
    "doggy style", "doggystyle", "missionary position", "camel toe", "nip slip", "skinny dipping", "in the buff",
    "nudis*", "milf*", "futanari", "shemale*", "dominatrix", "ball gag*", "ballgag*", "panties", "touching himself",
    "touching herself", "lifting her skirt", "upskirt", "sous vetement*", "en petite tenue", "devetu*", "tenue d eve",
    "plus simple appareil", "sans rien sur le dos", "partouze*", "calzon*", "en pelotas", "sin nada puesto", "follar",
    "follando", "unterhose*", "schlupfer*", "reizwasche", "entblosst*", "barbusig*", "nackig*", "fkk",
    "geschlechtsverkehr", "vergewaltig*", "ficken", "gefickt", "pelad*", "despid*", "estupr*", "mutand*", "perizoma",
    "senza niente addosso", "nudin*", "*ciplak*", "soyunmus", "tecavuz*", "mustehcen*", "naakt*", "ontkleed*",
    "nagie", "rozebran*", "telanjang", "bugil", "pemerkosa*", "khoa than", "khieu dam", "hiep dam",
)

GENERAL_CTX_SEXUEL = (
    "strip", "breast", "poitrine", "bite", "queue", "baiser", "jouir", "dominat*", "submissi*", "sadis*", "masoch*",
    "escort", "yuri", "tied up", "chained", "whipped", "on knees", "bent over", "erection*", "erect", "boner*",
    "penetrat*", "spread legs",
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


# ── Chiffres Unicode (table fixe partagee avec le TypeScript) ──────────────
_ZEROS = tuple(int(h, 16) for h in ZEROS_CHIFFRES)


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


def _nettoyer(texte):
    """Etape commune a toutes les vues : NFKC, blancs de controle -> espace, effacement, chiffres en ASCII, minuscules."""
    s = unicodedata.normalize("NFKC", _en_texte(texte))
    s = _sans_effaces(_RE_BLANCS_CONTROLE.sub(" ", s))
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


def _compiler_expression_sure(e):
    corps = _SEPARATEUR_EXPRESSION.join(("(?:" + m[1:] + ")") if m.startswith("!") else ("(" + m + ")") for m in e.split(" "))
    return _cle_expression(e), re.compile("(^|[^a-z0-9])" + corps + "(?![a-z0-9])")


_RE_EXPRESSIONS_SURES = [_compiler_expression_sure(e) for e in EXPRESSIONS_SURES]
# « baby dragon » se lit « young dragon » (mineur AMBIGU) ; pas avec un vetement apres l'animal (« baby bunny costume »).
_RE_BEBE_ANIMAL = re.compile(
    "(^|[^a-z0-9])(?:baby|bebe)" + _SEPARATEUR_EXPRESSION + "(?=(?:" + "|".join(ANIMAUX_BEBE) + ")(?:s|es)?(?![a-z0-9])(?!"
    + _SEPARATEUR_EXPRESSION + "(?:" + "|".join(VETEMENTS_ANIMAL) + ")(?:s|es)?(?![a-z0-9])))")
_RE_IDIOMES_EXACTS = re.compile(r"(?:^| )(?:" + "|".join(IDIOMES_EXACTS) + r")(?= |\Z)")
_RE_IDIOMES_UNICODE = re.compile("|".join(IDIOMES_UNICODE))


def _garder_mots(m):
    return m.group(1) + " ".join(m.groups()[1:]) + " "


def _sans_expressions_sures(s):
    """Expressions sures (mot marque retire, les autres gardes) et « baby <animal> » -> « young <animal> ». Sur le texte AVANT
    simplification : la ponctuation y separe encore les mots."""
    r = _RE_BEBE_ANIMAL.sub(r"\1young ", s) if ("baby" in s or "bebe" in s) else s
    for cle, expression in _RE_EXPRESSIONS_SURES:
        if cle in r:
            r = expression.sub(_garder_mots, r)
    return r


def _simple(s):
    """Tout ce qui n'est pas [a-z0-9] devient un espace ; espaces compactes ; idiomes retires."""
    s = " " + _RE_NON_ALNUM.sub(" ", s).strip(" ") + " "
    return _RE_WS.sub(" ", _IDIOMES.sub(" ", s)).strip(" ")


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


def _vues_plancher(prompt):
    net = _nettoyer(prompt)
    t = _sans_expressions_sures(_translit(_sans_marques(net)))

    def assembler(x):
        return _joindre(_simple(_joindre_ponctue(x)))

    def coller(v):
        return _RE_REPETE2.sub(r"\1", _RE_NON_LETTRE.sub("", v))

    t_i = _leet(t, "i")
    t_l = _leet(t, "l")
    non_ecrasees = [assembler(t), assembler(t_i), assembler(t_l)]
    return {
        "chiffres": _ecraser(non_ecrasees[0]),
        "leetI": _ecraser(non_ecrasees[1]),
        "leetL": _ecraser(non_ecrasees[2]),
        "collees": [coller(_simple(t_i)), coller(_simple(t_l))],
        "series": (_series(_simple(_joindre_ponctue(t))) + _series(_simple(_joindre_ponctue(t_i)))
                   + _series(_simple(_joindre_ponctue(t_l)))),
        "nonEcrasees": non_ecrasees,
        "exacte": _vue_exacte(net),
        "unicode": _RE_IDIOMES_UNICODE.sub(" ", _vue_unicode(net)),
    }


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
_UNITE_ROMANE = (_alt(UNITES_AGE_ROMANES) + "(?![a-z])(?! " + _alt(COMPLEMENTS_DE) + " (?!" + _alt(MOTS_AGE)
                 + "(?![a-z]))[a-z])")
_UNITE = "(?:" + _alt(UNITES_AGE) + "(?![a-z])|" + _UNITE_ROMANE + ")"
_RE_AGE = re.compile("(?:^| )" + _NB + " ?" + _UNITE + "|(?:^| )" + _alt(PREFIXES_AGE) + " ?" + _NB_APRES_PREFIXE
                     + "(?![a-z0-9])" + "|(?:^| )" + _alt(NOMBRES_COMPOSES_DE) + "jahrig")
_RE_NAISSANCE = re.compile("(?:^| )" + _alt(_par_longueur(PREFIXES_NAISSANCE)) + " ((?:19|20)[0-9][0-9])(?![0-9])")
_NB_CHIFFRES_U = "(?<![0-9])(?:1[0-7]|0?[0-9])(?! ?[0-9])"
_NB_HAN = "(?<![一二三四五六七八九十百千两兩])(?:十[一二三四五六七]?|[一二三四五六七八九两兩])"
_RE_AGE_UNICODE = re.compile(_NB_CHIFFRES_U + " ?" + _alt(UNITES_AGE_UNICODE) + "|" + _NB_HAN + "(?:岁|歲|歳|才)|"
                             + _alt(PREFIXES_AGE_UNICODE) + " ?" + _NB_CHIFFRES_U)


def _age_par_naissance(vue):
    """« born in 2018 » : vrai si l'annee de naissance est a moins de 18 ans de l'annee en cours (horloge UTC)."""
    an = time.gmtime().tm_year
    for m in _RE_NAISSANCE.finditer(vue):
        y = int(m.group(1))
        if an - 18 < y <= an:
            return True
    return False


# ── Compilation (une fois par processus) ───────────────────────────────────
T_MINEURS_FORT = _compiler(MINEURS_FORT, "plancher")
T_MINEURS_AMBIGUS = _compiler(MINEURS_AMBIGUS, "plancher")
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
    v = _vues_plancher(prompt)
    vues = [v["chiffres"], v["leetI"], v["leetL"]]
    uni = [v["unicode"]]

    def bloquer(blocked, reason):
        return {"safe": False, "blocked": blocked, "reason": reason, "categorie": "plancher", "hardFloor": True}

    # 1. Termes illicites en soi.
    u = _chercher(uni, T_PLANCHER_UNICODE)
    if u:
        return bloquer(_nom(u), _MSG_PLANCHER)
    mot = _chercher(vues, T_PLANCHER_MOTS)
    if mot:
        return bloquer(_nom(mot), _MSG_PLANCHER)
    for i, colle in enumerate(PLANCHER_COLLES):
        if any(_PLANCHER_COLLES_ECRASES[i] in c for c in v["collees"]):
            return bloquer(colle, _MSG_PLANCHER)

    for serie in v["series"]:
        if any(x in serie for x in SERIE_MINEURS) and any(x in serie for x in SERIE_NUDITE):
            return bloquer("minor-safety", _MSG_PLANCHER_MINEUR)
    # 1b. Mineur et nudite COLLES dans un meme mot (« childnaked ») : CLIP les lit comme deux mots (M2).
    if any(_colle(x) for x in vues) or any(_colle(x) for x in v["nonEcrasees"]):
        return bloquer("minor-safety", _MSG_PLANCHER_MINEUR)

    # 2. Mineur x nudite / sexe, mineur x violence exercee sur lui.
    mineur_fort = _chercher(vues, T_MINEURS_FORT) or _chercher(uni, T_MINEURS_FORT_UNICODE)
    age = any(_RE_AGE.search(x) or _age_par_naissance(x) for x in vues) or bool(_RE_AGE_UNICODE.search(v["unicode"]))
    mineur_ambigu = _chercher(vues, T_MINEURS_AMBIGUS) or _chercher(uni, T_MINEURS_AMBIGUS_UNICODE)
    indice = _chercher(vues, T_MINEURS_INDICES)
    if mineur_fort or age or mineur_ambigu or indice:
        explicite = (_chercher(vues, T_NU_FORT) or _chercher([v["exacte"]], T_NU_EXACTS) or _chercher(uni, T_NU_FORT_UNICODE)
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
    floor = check_hard_floor(prompt)
    if not floor["safe"]:
        return floor                       # plancher illicite : jamais contournable
    if unrestricted:
        return {"safe": True}              # `unrestricted` ne leve que les filtres SOUPLES

    base = _base(prompt)
    souple = _simple(_sans_expressions_sures(base))   # texte tel quel (sans translitteration)
    v = _vues_plancher(prompt)
    toutes = [souple, v["chiffres"], v["leetI"], v["leetL"]]   # l'explicite est teste sur les formes deguisees aussi

    def refus(t):
        return {"safe": False, "blocked": _nom(t), "categorie": t.cat,
                "reason": 'Content filter: "%s" is blocked. %s' % (_nom(t), _CONSEIL_REFUS)}

    def combinaison(a, b, cat):
        return {"safe": False, "blocked": "%s + %s" % (_nom(a), _nom(b)), "categorie": cat,
                "reason": 'Content filter: combination "%s" + "%s" is blocked. This type of content is not allowed.'
                          % (_nom(a), _nom(b))}

    # 1. Termes explicites (sexe, nudite) : mots entiers, y compris deguises ; mots courts sur la vue exacte ; autres
    #    ecritures sur la vue Unicode.
    sexuel = (_chercher(toutes, T_SEXUEL_DUR) or _chercher([v["exacte"]], T_SEXUEL_EXACTS)
              or _chercher([v["unicode"]], T_SEXUEL_UNICODE))
    if sexuel:
        return refus(sexuel)
    # 2. Autres familles bloquees seules (gore explicite, drogues dures, terrorisme, haine, auto-agression, armes).
    autre = _chercher([souple], T_DURS_AUTRES)
    if autre:
        return refus(autre)

    # 3. Termes AMBIGUS (vocabulaire de jeu) : seulement en contexte.
    ctx_sexuel = _chercher([souple], T_CTX_SEXUEL)
    if ctx_sexuel and _chercher(toutes, T_CTX_SEXUEL_FAIBLE):
        return refus(ctx_sexuel)
    ctx_violence = _chercher([souple], T_CTX_VIOLENCE)
    if ctx_violence and _chercher([souple], T_MINEURS_VIOLENCE):
        return refus(ctx_violence)

    # 4. Combinaisons.
    # 4a. mineur sans ambiguite x vocabulaire de chambre (le plancher a deja traite le reste)
    mineur = _chercher([souple] + toutes, T_MINEURS_FORT)
    if mineur:
        b = _chercher([souple], T_NU_FAIBLE_GENERAL)
        if b:
            return combinaison(mineur, b, "combinaison")
    # 4b. personne x nudite explicite par periphrase
    a2 = _chercher([souple], T_PERSONNES)
    b2 = _chercher([souple], T_NUDITE_EXTREME) if a2 else None
    if a2 and b2:
        return combinaison(a2, b2, "combinaison")
    # 4c. enfant x violence
    a3 = _chercher([souple], T_MINEURS_VIOLENCE)
    b3 = _chercher([souple], T_VIOLENCE_ENFANT_GENERAL) if a3 else None
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
    (« <|endoftext|> », « <|startoftext|> ») casses, poids A1111 « (mot:x) » ramenes dans [POIDS_PROMPT_MIN,
    POIDS_PROMPT_MAX] (un poids mal forme est retire). Un poids deja dans les bornes est laisse tel quel."""
    s = _sans_effaces(_RE_BLANCS_CONTROLE.sub(" ", _en_texte(texte)))
    s = _RE_JETON_FERMANT.sub(" ", _RE_JETON_OUVRANT.sub(" ", s))

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
