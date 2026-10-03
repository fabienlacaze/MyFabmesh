"""Filtre de prompt cote Modal : PORTAGE A L'IDENTIQUE de cloud/src/nsfw_filter.ts (2026-10-03).

POURQUOI (constats IA-02 et IA-03 de l'analyse du 03/10/2026). La copie du plancher « mineurs / contenus
illicites » qui vivait dans modal_app/app.py (`_prompt_hard_floor`) etait restee a l'ancienne version :
  * contournable : « n u d e », « nud3 », cyrillique, chiffres pleine largeur, lettres repetees, age ecrit
    en lettres (« twelve year old »), autres langues ;
  * trop stricte pour le vocabulaire de jeu : « hot », « bed », « bath », « young », « hit », « knife »
    suffisaient a refuser un prompt legitime (« young hero with a toy gun »).
Ce module reprend la logique CORRIGEE du Worker. C'est la derniere ligne de defense, au niveau du
generateur : elle ne se contourne pas avec le drapeau `unrestricted`.

CONTRAT. `prompt_hard_floor(prompt)` rend `None` si le texte passe, sinon une CHAINE (la raison du refus),
exactement comme l'ancienne `_prompt_hard_floor` d'app.py. `check_hard_floor` et `check_prompt_safety`
rendent le meme dictionnaire que le Worker : { safe, blocked?, reason?, categorie?, hardFloor? }.

PARITE. Les listes ci-dessous sont GENEREES depuis nsfw_filter.ts (build/moderation_modal/gen_module.py) ; les
fonctions suivent le TypeScript ligne a ligne. Differences voulues entre JS et Python, toutes neutralisees :
`\\s` (JS et Python n'ont pas la meme definition : _WS ci-dessous est celle de JS), `$` (Python l'accepte
avant un saut de ligne final : on emploie `\\Z`). Le test build/bancs/noyaux/test_moderation_modal.py rejoue
les memes jeux de cas que cloud/tests/moderation.test.mjs ET compare ce module au TypeScript sur un corpus
(si node est present).

REGLE « kind » (2026-10-03). Le mot allemand « Kind » (singulier) etait absent : « kind » est ambigu avec
l'adjectif anglais (« a kind knight »). Il est donc un mineur AMBIGU, comme girl / boy : il ne bloque qu'avec
une nudite explicite ou une tenue minimale, jamais avec le simple vocabulaire de scene (bath, shower) ni
avec une violence. Dans une serie de lettres isolees (« k i n d n a c k t »), « kind » compte comme mineur.

Dependances : bibliotheque standard seulement (re, unicodedata). Rien a ajouter a l'image Modal.
"""
import re
import unicodedata

# ═══════════════════════════════════════════════════════════════════════════
# NORMALISATION (constat IA-02)
# ═══════════════════════════════════════════════════════════════════════════

# Definition de `\s` en JavaScript (celle de Python differe : ex. U+FEFF, U+001C..U+001F).
_WS = "\t\n\x0b\x0c\r \xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
_RE_WS = re.compile("[" + _WS + "]+")

_MARQUES = re.compile("[\u0300-\u036f]")
_INVISIBLES = re.compile("[\u00ad\u200b-\u200f\u202a-\u202e\u2060\ufeff]")

# Lettres latines sans decomposition Unicode.
_LATIN_SPECIAUX = {
    "\u00df": "ss", "\u00f8": "o", "\u00e6": "ae", "\u0153": "oe", "\u0111": "d",
    "\u0142": "l", "\u0131": "i", "\u0251": "a", "\u0261": "g",
}

# Lettres cyrilliques / grecques qui ressemblent a une lettre latine.
_HOMOGLYPHES = {
    # cyrillique
    "\u0430": "a", "\u0432": "b", "\u0435": "e", "\u043a": "k", "\u043c": "m",
    "\u043d": "h", "\u043e": "o", "\u0440": "p", "\u0441": "c", "\u0442": "t",
    "\u0443": "y", "\u0445": "x", "\u0455": "s", "\u0456": "i", "\u0458": "j",
    "\u0501": "d", "\u04bb": "h", "\u051b": "q", "\u051d": "w", "\u04cf": "l",
    "\u043f": "n", "\u0433": "r",
    # grec
    "\u03b1": "a", "\u03b2": "b", "\u03b3": "y", "\u03b5": "e", "\u03b7": "n",
    "\u03b9": "i", "\u03ba": "k", "\u03bc": "u", "\u03bd": "v", "\u03bf": "o",
    "\u03c1": "p", "\u03c2": "s", "\u03c4": "t", "\u03c5": "u", "\u03c7": "x",
    "\u03c9": "w",
}

_LEET = {"0": "o", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s"}

# Expressions courantes qui contiennent un mot du filtre sans en etre un.
_IDIOMES = re.compile(
    r"(?:^| )(?:baby shower|bridal shower|meteor shower|shower of|chinks? in|bath toys?|suicide squad"
    r"|snuff box(?:es)?|snuff bottles?|bikini atoll|bikini bottom|nu metal|anal retentive)(?= |\Z)")

_RE_NON_ALNUM = re.compile("[^a-z0-9]+")
_RE_NON_LETTRE = re.compile("[^a-z]")
_RE_REPETE3 = re.compile(r"([a-z])\1{2,}")
_RE_REPETE2 = re.compile(r"([a-z])\1+")
_RE_PONCTUE = re.compile(
    "(?<![a-z0-9])[a-z0-9](?:[^a-z0-9" + _WS + "]+[a-z0-9]){2,}(?![a-z0-9])")
_RE_LEET = re.compile(r"[0134578@$]")
_RE_LETTRE = re.compile("[a-z]")


def _en_texte(x):
    if isinstance(x, str):
        return x
    return "" if x is None else str(x)


def _base(texte):
    """NFKC + retrait des accents et caracteres invisibles + minuscules (SANS translitteration)."""
    s = unicodedata.normalize("NFKC", _en_texte(texte))
    s = unicodedata.normalize("NFD", s)
    s = _INVISIBLES.sub("", _MARQUES.sub("", s))
    return s.lower()


def _translit(s):
    """Remplace les lettres cyrilliques / grecques ressemblantes et les lettres latines speciales."""
    return re.sub(
        r"[^\x00-\x7f]",
        lambda m: _LATIN_SPECIAUX.get(m.group(0)) or _HOMOGLYPHES.get(m.group(0)) or m.group(0),
        s)


def _simple(s):
    """Tout ce qui n'est pas [a-z0-9] devient un espace ; espaces compactes ; idiomes retires."""
    s = " " + _RE_NON_ALNUM.sub(" ", s).strip(" ") + " "
    return _RE_WS.sub(" ", _IDIOMES.sub(" ", s)).strip(" ")


def _joindre(s):
    """"n u d e" -> "nude" : au moins 3 jetons d'un seul caractere de suite sont recolles."""
    t = s.split(" ")
    sortie = []
    i = 0
    while i < len(t):
        if len(t[i]) == 1:
            j = i
            while j < len(t) and len(t[j]) == 1:
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


def _vues_plancher(prompt):
    s = unicodedata.normalize("NFKC", _en_texte(prompt))
    nfkc = _RE_WS.sub(" ", _INVISIBLES.sub("", s.lower()))
    t = _translit(_base(prompt))

    def fabriquer(x):
        return _ecraser(_joindre(_simple(_joindre_ponctue(x))))

    def coller(v):
        return _RE_REPETE2.sub(r"\1", _RE_NON_LETTRE.sub("", v))

    t_i = _leet(t, "i")
    t_l = _leet(t, "l")
    return {
        "chiffres": fabriquer(t),
        "leetI": fabriquer(t_i),
        "leetL": fabriquer(t_l),
        "collees": [coller(_simple(t_i)), coller(_simple(t_l))],
        "series": (_series(_simple(_joindre_ponctue(t))) + _series(_simple(_joindre_ponctue(t_i)))
                   + _series(_simple(_joindre_ponctue(t_l)))),
        "unicode": nfkc,
    }


# ═══════════════════════════════════════════════════════════════════════════
# TERMES (le `*` final = debut de mot ; sinon mot entier). Les termes sont
# normalises comme le texte avant compilation : accents et ponctuation sans effet.
# ═══════════════════════════════════════════════════════════════════════════

class _Terme:
    __slots__ = ("src", "re", "cat")

    def __init__(self, src, regex, cat):
        self.src = src
        self.re = regex
        self.cat = cat


def _forme_terme(src):
    return _simple(_translit(_base(src[:-1] if src.endswith("*") else src)))


def _compiler(liste, cat):
    sortie = []
    for src in liste:
        prefixe = src.endswith("*")
        noyau = re.escape(_forme_terme(src))
        sortie.append(_Terme(src, re.compile("(?:^| )" + noyau + ("" if prefixe else r"(?= |\Z)")), cat))
    return sortie


def _chercher(vues, termes):
    for t in termes:
        for v in vues:
            if t.re.search(v):
                return t
    return None


def _nom(t):
    return t.src[:-1] if t.src.endswith("*") else t.src


# ═══════════════════════════════════════════════════════════════════════════
# LISTES (generees depuis cloud/src/nsfw_filter.ts)
# ═══════════════════════════════════════════════════════════════════════════

#@@LISTES@@

# ── Ages (plancher) ────────────────────────────────────────────────────────
_NB_LETTRES = "(?<![a-z])(?:" + "|".join(
    re.escape(x) for x in sorted(dict.fromkeys(NOMBRES_LETTRES), key=lambda x: -len(x))) + ")(?![a-z])"
_NB_CHIFFRES = "(?<![0-9])(?:1[0-7]|0?[0-9])(?![0-9])"
_NB = "(?:" + _NB_CHIFFRES + "|" + _NB_LETTRES + ")"
_UNITES_AGE = ("(?:yo|y o|yr old|yrs old|yr o|years? old|year olds?|yearold|yrold|ans|anos|anni|jahre alt"
               "|jahrig[a-z]*|j alt)(?![a-z])")
_PREFIXES_AGE = "(?:aged?|age of|ages|age de|agee de|agee|edad de|edad|alter von|alter|eta di|idade de|idade)"
_RE_AGE = re.compile(
    "(?:^| )" + _NB + " ?" + _UNITES_AGE + "|(?:^| )" + _PREFIXES_AGE + " ?" + _NB + "(?![a-z0-9])")

# ── Compilation (une fois par processus) ───────────────────────────────────
T_MINEURS_FORT = _compiler(MINEURS_FORT, "plancher")
T_MINEURS_AMBIGUS = _compiler(MINEURS_AMBIGUS, "plancher")
T_MINEURS_VIOLENCE = _compiler(MINEURS_VIOLENCE, "mineur_violence")
T_NU_FORT = _compiler(NU_FORT, "plancher")
T_NU_MOYEN = _compiler(NU_MOYEN, "plancher")
T_NU_FAIBLE_PLANCHER = _compiler(NU_FAIBLE_PLANCHER, "plancher")
T_NU_FAIBLE_GENERAL = _compiler(NU_FAIBLE_GENERAL, "mineur_violence")
T_VIOLENCE_ENFANT_PLANCHER = _compiler(VIOLENCE_ENFANT_PLANCHER, "plancher")
T_PLANCHER_MOTS = _compiler(PLANCHER_MOTS, "plancher")
T_SEXUEL_DUR = _compiler(GENERAL_SEXUEL_DUR, "sexuel")
T_CTX_SEXUEL = _compiler(GENERAL_CTX_SEXUEL, "contexte")
T_CTX_SEXUEL_FAIBLE = _compiler(CONTEXTE_SEXUEL_FAIBLE, "contexte")
T_CTX_VIOLENCE = _compiler(GENERAL_CTX_VIOLENCE, "contexte")
T_DURS_AUTRES = (
    _compiler(GENERAL_VIOLENCE_DUR, "violence") + _compiler(GENERAL_DROGUE_DUR, "drogue")
    + _compiler(GENERAL_EXTREMISME_DUR, "extremisme") + _compiler(GENERAL_AUTOBLESSURE_DUR, "autoblessure")
    + _compiler(GENERAL_HAINE_DUR, "haine") + _compiler(GENERAL_ARMES_DUR, "armes")
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
    Plus strict que le filtre general sur les formes (normalisation, ages, six langues), mais sans
    vocabulaire de jeu video (« kid friendly », « young hero », « teen titans style » passent)."""
    v = _vues_plancher(prompt)
    vues = [v["chiffres"], v["leetI"], v["leetL"]]

    def bloquer(blocked, reason):
        return {"safe": False, "blocked": blocked, "reason": reason, "categorie": "plancher", "hardFloor": True}

    # 1. Termes illicites en soi.
    for u in PLANCHER_UNICODE:
        if u in v["unicode"]:
            return bloquer(u, _MSG_PLANCHER)
    mot = _chercher(vues, T_PLANCHER_MOTS)
    if mot:
        return bloquer(_nom(mot), _MSG_PLANCHER)
    for i, colle in enumerate(PLANCHER_COLLES):
        if any(_PLANCHER_COLLES_ECRASES[i] in c for c in v["collees"]):
            return bloquer(colle, _MSG_PLANCHER)

    for serie in v["series"]:
        if any(x in serie for x in SERIE_MINEURS) and any(x in serie for x in SERIE_NUDITE):
            return bloquer("minor-safety", _MSG_PLANCHER_MINEUR)

    # 2. Mineur x nudite / sexe, mineur x violence exercee sur lui.
    mineur_fort = _chercher(vues, T_MINEURS_FORT)
    age = any(_RE_AGE.search(x) for x in vues)
    mineur_ambigu = _chercher(vues, T_MINEURS_AMBIGUS)
    if mineur_fort or age or mineur_ambigu:
        fort = _chercher(vues, T_NU_FORT) or _chercher(vues, T_NU_MOYEN)
        if fort:
            return bloquer("minor-safety", _MSG_PLANCHER_MINEUR)
        if mineur_fort or age:
            if _chercher(vues, T_NU_FAIBLE_PLANCHER):
                return bloquer("minor-safety", _MSG_PLANCHER_MINEUR)
            if _chercher(vues, T_VIOLENCE_ENFANT_PLANCHER):
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
    souple = _simple(base)                 # texte tel quel (sans translitteration)
    v = _vues_plancher(prompt)
    toutes = [souple, v["chiffres"], v["leetI"], v["leetL"]]   # l'explicite est teste sur les formes deguisees aussi

    def refus(t):
        return {"safe": False, "blocked": _nom(t), "categorie": t.cat,
                "reason": 'Content filter: "%s" is blocked. %s' % (_nom(t), _CONSEIL_REFUS)}

    def combinaison(a, b, cat):
        return {"safe": False, "blocked": "%s + %s" % (_nom(a), _nom(b)), "categorie": cat,
                "reason": 'Content filter: combination "%s" + "%s" is blocked. This type of content is not allowed.'
                          % (_nom(a), _nom(b))}

    # 1. Termes explicites (sexe, nudite) : mots entiers, y compris deguises.
    sexuel = _chercher(toutes, T_SEXUEL_DUR)
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
