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


#@@LISTES@@

# ── Points de code non assignes en Unicode 14 (table fixe partagee avec le TypeScript) ──────────────
_BORNES_U14 = tuple((int(p.split("-")[0], 16), int(p.split("-")[-1], 16)) for p in NON_ASSIGNES_U14)
_DEBUTS_U14 = tuple(a for a, _ in _BORNES_U14)
_FINS_U14 = tuple(b for _, b in _BORNES_U14)

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
    """Etape commune a toutes les vues : points de code non assignes en Unicode 14 effaces (AVANT NFKC), NFKC, blancs de
    controle -> espace, effacement, chiffres en ASCII, minuscules."""
    s = unicodedata.normalize("NFKC", _sans_non_assignes(_en_texte(texte)))
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
_RE_AGE = re.compile("(?:^| )" + _NB + " ?" + _UNITE + "|(?:^| )" + _alt(PREPOSITIONS_AGE) + " " + _NB + " ?"
                     + _alt(UNITES_AGE_ROMANES) + "(?![a-z])|(?:^| )" + _alt(PREFIXES_AGE) + " ?" + _NB_APRES_PREFIXE
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
T_DOUBLE_SENS_COQ = _compiler(DOUBLE_SENS_COQ, "plancher")
T_CONTEXTE_BASSE_COUR = _compiler(CONTEXTE_BASSE_COUR, "plancher")
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
    net = _nettoyer(prompt)
    r = _plancher(_vues_plancher(net))
    if not r["safe"]:
        return r
    # Seconde lecture sans la syntaxe de poids collee dans un mot (« na()ked » : revue du 14/10, B1).
    colle = _sans_syntaxe_collee(net)
    return r if colle == net else _plancher(_vues_plancher(colle))


def _plancher(v):
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
            # « cock » lu « coq » quand un mot de basse-cour est la (« a farm kid feeding a cock and two hens »)
            if _chercher(vues, T_DOUBLE_SENS_COQ) and not _chercher(vues, T_CONTEXTE_BASSE_COUR):
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

    net = _nettoyer(prompt)
    souple = _simple(_sans_expressions_sures(_sans_marques(net)))   # texte tel quel (sans translitteration)
    v = _vues_plancher(net)
    toutes = [souple, v["chiffres"], v["leetI"], v["leetL"]]   # l'explicite est teste sur les formes deguisees aussi
    # ... et sur la vue sans syntaxe de poids collee dans un mot (revue du 14/10, B1)
    colle = _sans_syntaxe_collee(net)
    vc = None if colle == net else _vues_plancher(colle)
    explicites = toutes + [vc["chiffres"], vc["leetI"], vc["leetL"]] if vc else toutes

    def refus(t):
        return {"safe": False, "blocked": _nom(t), "categorie": t.cat,
                "reason": 'Content filter: "%s" is blocked. %s' % (_nom(t), _CONSEIL_REFUS)}

    def combinaison(a, b, cat):
        return {"safe": False, "blocked": "%s + %s" % (_nom(a), _nom(b)), "categorie": cat,
                "reason": 'Content filter: combination "%s" + "%s" is blocked. This type of content is not allowed.'
                          % (_nom(a), _nom(b))}

    # 1. Termes explicites (sexe, nudite) : mots entiers, y compris deguises ; mots courts sur la vue exacte ; autres
    #    ecritures sur la vue Unicode.
    sexuel = (_chercher(explicites, T_SEXUEL_DUR)
              or _chercher([v["exacte"], vc["exacte"]] if vc else [v["exacte"]], T_SEXUEL_EXACTS)
              or _chercher([v["unicode"], vc["unicode"]] if vc else [v["unicode"]], T_SEXUEL_UNICODE))
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
_RE_ENTITE_HTML = re.compile("&(?=[#A-Za-z])")


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
    ftfy, le tokenizer CLIP les decode), poids A1111 « (mot:x) » ramenes dans [POIDS_PROMPT_MIN, POIDS_PROMPT_MAX] (un poids
    mal forme est retire). Un poids deja dans les bornes est laisse tel quel."""
    s = _sans_effaces(_RE_BLANCS_CONTROLE.sub(" ", _en_texte(texte)))
    s = _RE_ENTITE_HTML.sub("& ", _RE_JETON_FERMANT.sub(" ", _RE_JETON_OUVRANT.sub(" ", s)))

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
