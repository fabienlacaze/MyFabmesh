"""Composeur d'intention (2026-10-03) : adapte le gabarit de prompt a ce que l'utilisateur DEMANDE.

POURQUOI. Un personnage « orc tenant une massue » sortait avec une arme dans chaque main. Cause mesuree (audit de fidelite du 2026-10-03,
essais sur l'orc, graine fixe, 4 images) : le gabarit du type Character se CONTREDIT et contredit la demande (« empty open hands », « symmetric »,
T-pose bras tendus) et le negatif interdit « club », « weapon ». 0 image sur 4 n'avait qu'une arme ; avec une consigne qui dit l'intention
(une massue dans la main droite, l'autre main ouverte et vide) et sans les consignes contradictoires, 3 sur 4.

CE QUE FAIT LE MODULE. Il analyse le texte de l'utilisateur de facon DETERMINISTE (regex seulement, aucune dependance, aucun reseau) et
 - dit ce qui est tenu (objets, classe d'arme, nombre, main), les poses libres, la vue, le buste, les sujets non humains, les nombres
   anatomiques, les quantites, le socle voulu ;
 - adapte le gabarit positif (composer_gabarit, clause_objet_tenu) ;
 - dit quels jetons retirer / ajouter au negatif (negatifs_pont, composer_negatif_armes).
Un texte qui ne dit rien de tel donne EXACTEMENT le gabarit d'origine (cas temoin « An orc » : identique a l'octet).

QUELLES REGLES SONT ACTIVES. REGLES_ACTIVES (ci-dessous) : seules celles dont l'effet est MESURE ou sans risque. Les autres sont codees, testees,
mais eteintes : socle (negatif « pedestal, base, rocks » pour les unites : l'orc sortait sur un socle rocheux, 66 % de son maillage etait une dalle),
asymetrie, pose libre (abandonner la T-pose pose un compromis avec le rig : decision du proprietaire), vue, buste, non-humain, nombres anatomiques,
quantites. Les activer = ajouter leur nom a REGLES_ACTIVES, apres mesure A/B sur graines fixes.
Interrupteur d'urgence : variable d'environnement FABMESH_COMPOSEUR=0 (bureau) -> aucune adaptation.

UNE SEULE LOGIQUE, DEUX LANGAGES. Ce fichier est copie tel quel dans modal_app/ (build/check-noyaux-partages.mjs, --sync) ; son jumeau JavaScript est
src/renderer/lib/composeur-intention.js (= cloud/public/app/lib/composeur-intention.js). build/intention_cas.json + build/intention_attendus.json
font verifier que les deux donnent les memes sorties (build/check_intention.py, build/check-intention.mjs). Les regex ne sortent donc pas du
sous-ensemble commun Python / JavaScript : \\b, (?:...), classes, alternances, quantificateurs, (?=...), drapeau i.
"""
import os
import re

VERSION = 1

TYPES_UNITE = ('character', 'other_living')

TOUTES_REGLES = ('objets', 'socle', 'asymetrie', 'pose', 'vue', 'buste', 'non_humain', 'parties', 'quantite')
REGLES_ACTIVES = ('objets',)

# ---------------------------------------------------------------- lexiques
CLASSES_ARME = {
    'club':   'club mace cudgel bat maul flail morning star truncheon',
    'hammer': 'hammer warhammer sledgehammer mallet',
    'sword':  'sword blade saber sabre katana scimitar rapier claymore greatsword cutlass machete',
    'dagger': 'dagger knife dirk kunai stiletto',
    'axe':    'axe hatchet battleaxe tomahawk cleaver',
    'spear':  'spear lance halberd pike trident javelin glaive polearm',
    'bow':    'bow longbow crossbow',
    'gun':    'gun rifle pistol musket blaster shotgun revolver cannon',
    'staff':  'staff wand scepter sceptre cane crook',
    'shield': 'shield buckler',
}
# jetons du negatif des armes (cloud : modal_app/_realvis.py _ARMES_NEG ; bureau : local_juggernaut_bridge.py _armes_neg) a retirer quand la classe est DEMANDEE
NEG_PAR_CLASSE = {
    'club': ['club'], 'hammer': [], 'sword': ['sword', 'blade'], 'dagger': ['knife', 'blade'],
    'axe': ['axe'], 'spear': ['spear'], 'bow': ['bow'], 'gun': ['gun'], 'staff': ['staff'],
    'shield': ['shield'],
}
ARMES_UNITE_NEG = ['weapon', 'holding weapon', 'sword', 'blade', 'knife', 'spear', 'axe', 'club',
                   'shield', 'bow', 'gun', 'staff']
POIDS_ARME = {'weapon': 1.6, 'holding weapon': 1.6, 'sword': 1.5, 'blade': 1.5, 'knife': 1.5,
              'spear': 1.5, 'axe': 1.5, 'club': 1.4, 'shield': 1.5, 'bow': 1.4, 'gun': 1.4,
              'staff': 1.3}
NEG_UNE_SEULE_ARME = ['second weapon', 'dual wielding', 'duplicate weapon']

OBJETS_TENUS = ('torch lantern lamp book tome scroll bag sack satchel cup mug goblet bottle flask potion '
                'flag banner flower bouquet basket umbrella orb skull fish chicken baby phone guitar '
                'lute harp trumpet sign map key chalice candle pitchfork shovel pickaxe broom '
                'hammer wrench tool camera sphere crystal egg apple cane').split()

NONHUMAIN = re.compile(r"\b(robot|android|cyborg|mech|golem|skeleton|skeletal|statue|ghost|spirit|elemental|"
                       r"slime|automaton|animated armor|empty armor|living armor|wraith|specter)\b", re.I)
POSE_LIBRE = re.compile(
    r"\b(sitting|seated|sits|crouching|crouched|kneeling|squatting|lying|reclining|riding|on horseback|"
    r"mounted on|running|sprinting|jumping|leaping|dancing|flying|floating|swimming|climbing|crawling|"
    r"combat stance|battle stance|fighting stance|arms crossed|crossed arms|hands on (?:his |her )?hips|"
    r"hand on (?:his |her )?hip|waving|pointing|praying|saluting|meditating|bowing|punching|kicking|aiming|"
    r"shooting|casting a spell|mid-air|leaning)\b", re.I)
VUE = re.compile(
    r"\b(back view|rear view|from behind|seen from behind|from the side|from the back|from above|from below|side view|side profile|in profile|profile view|"
    r"three-quarter view|three quarter view|3/4 view|top-down view|top view|aerial view|overhead view|"
    r"bird'?s-eye view|isometric view|low-angle|low angle|high-angle|high angle)\b", re.I)
BUSTE = re.compile(r"\b(bust|portrait|head only|headshot|close-up|closeup|face only|half-length|waist up|"
                   r"upper body only)\b", re.I)
NOMBRE = {'one': 1, 'single': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7,
          'eight': 8, 'nine': 9, 'ten': 10, 'twin': 2, 'dual': 2, 'double': 2, 'triple': 3}
PARTIES = {'head': 'heads', 'arm': 'arms', 'leg': 'legs', 'eye': 'eyes', 'wing': 'wings',
           'tail': 'tails', 'horn': 'horns', 'hand': 'hands', 'face': 'faces'}
ADJ_PARTIE = {'headed': 'head', 'armed': 'arm', 'legged': 'leg', 'eyed': 'eye', 'winged': 'wing',
              'tailed': 'tail', 'horned': 'horn', 'faced': 'face'}
PAR_DEFAUT = {'head': 1, 'arm': 2, 'leg': 2, 'eye': 2, 'wing': 2, 'tail': 1, 'horn': 2, 'hand': 2, 'face': 1}
# negatifs anatomiques (modal_app/_realvis.py _ANATOMY_NEG) a retirer quand le nombre demande les contredit
NEG_ANATOMIE = {
    'head': ['two heads'], 'arm': ['three arms', 'extra arms'],
    'leg': ['five legs', 'six legs', 'three legs', 'extra leg', 'polydactyly', 'deformed legs'],
    'wing': ['extra wings', 'missing wing', 'single wing', 'fused wings'],
}
# « holding his breath », « holding a pose » : un verbe de prise suivi d'un mot qui n'est pas un objet
STOP_TENU = set('hand hands breath grudge position pose ground gaze back place'.split())
# « holding onto a rope », « holding on tight » : une particule, pas un objet
PARTICULES_REFUS = set('onto on to back off in at'.split())
# « holding up a sign » : on garde « a sign »
PARTICULES_ELISION = set('up out aloft high forth down aside'.split())
DESACCORD_SOCLE = re.compile(r"\b(pedestal|plinth|statue|diorama|on a rock|on a base|bust|trophy|figurine)\b", re.I)
ROCHE_VOULUE = re.compile(r"\b(rock|rocks|rocky|stone|golem|boulder|cave|mountain|cliff|crystal)\b", re.I)
COULEURS = ('red blue green yellow orange purple violet pink black white grey gray brown golden gold silver '
            'cyan teal turquoise crimson scarlet').split()
STYLES_NON_PHOTO = {'cartoon', 'anime', 'pixelart', 'painterly', 'voxel', 'hand-painted', 'ghibli', 'pixar',
                    'comic', 'minecraft', 'watercolor', 'sketch', 'claymation', 'stained-glass', 'lowpoly',
                    'low-poly', 'pixel-art', 'concept-art', 'graffiti', 'figurine', 'stylized'}

_MOTS = r"[a-z][a-z'-]*"
_DET = r"(?:an?|the|one|his|her|its|their|two|three|a pair of|a couple of|dual|twin)"
_VERBE = (r"(?:holding|wielding|carrying|gripping|grasping|brandishing|clutching|swinging|raising|lifting|"
          r"hefting|bearing|armed with|equipped with|dual[- ]wielding|dual wields?|wields?|holds?|carries)")
RE_TENU = re.compile(r"\b" + _VERBE + r"\s+(?:(" + _DET + r")\s+)?((?:" + _MOTS + r"\s+){0,4}?" + _MOTS + r")"
                     r"(?=\s*(?:,|\.|;| and | in | on | with | at | over | while | that | which | across |$))", re.I)
RE_AVEC_DANS_MAIN = re.compile(r"\bwith\s+(?:an?|the|his|her)\s+((?:" + _MOTS + r"\s+){0,3}?" + _MOTS + r")\s+in\s+"
                               r"(?:his|her|its|their|each|both|the)\s*(right|left)?\s*hands?\b", re.I)
RE_SANS_ARME = re.compile(r"\b(unarmed|empty[- ]handed|without (?:a |any )?(?:weapon|sword|shield)s?|no weapons?|"
                          r"not holding|holding nothing|bare[- ]handed)\b", re.I)
RE_CHAQUE_MAIN = re.compile(r"\b(?:in each hand|in both hands|one in each hand|dual[- ]wield\w*|two[- ]handed)\b", re.I)
RE_MAIN = re.compile(r"\bin\s+(?:his|her|its|their|the)\s+(right|left)\s+hand\b", re.I)

CADRAGE_TENU = "entire figure and held item fully visible, generous empty margins"
NEG_SOCLE = ['pedestal', 'base', 'rocks']
POIDS_SOCLE = {'pedestal': 1.5, 'base': 1.4, 'rocks': 1.3}
QUEUE_PHOTO = 'sharp focus, 8k, professional product photography'
QUEUE_NEUTRE = 'sharp focus, clean render'


def actif():
    """Interrupteur d'urgence : FABMESH_COMPOSEUR=0 coupe toute adaptation (bureau). Sans variable, actif."""
    return os.environ.get('FABMESH_COMPOSEUR', '1').strip() != '0'


# ---------------------------------------------------------------- analyse
def _classe(mot):
    mot = mot.lower()
    formes = {mot, mot[:-1] if mot.endswith('s') else mot, mot[:-2] if mot.endswith('es') else mot}
    for cl, mots in CLASSES_ARME.items():
        if formes & set(mots.split()):
            return cl
    return None


def _nombre_det(det, texte_np):
    d = (det or '').lower()
    if d in ('two', 'a pair of', 'a couple of', 'dual', 'twin'):
        return 2
    if d == 'three':
        return 3
    if texte_np.lower().rstrip().endswith('s') and not texte_np.lower().endswith(('ss', 'staffs')):
        return 2        # pluriel sans determinant : « holding swords »
    return 1


def _fusionner(trouves):
    """« holding a club, holding exactly one club in the right hand » (le gabarit compose relu par le pont) = UN objet, pas deux."""
    sortie = []
    for o in trouves:
        tete = o['item'].split()[-1].lower()
        for p in sortie:
            if p['item'].split()[-1].lower() == tete and p['cls'] == o['cls']:
                p['count'] = max(p['count'], o['count'])
                if p['hand'] is None:
                    p['hand'] = o['hand']
                break
        else:
            sortie.append(o)
    return sortie


def extraire_objets_tenus(texte):
    """-> liste de {item, cls, count, hand, arme}. Un objet = un groupe nominal apres un verbe de prise."""
    t = texte or ''
    if RE_SANS_ARME.search(t):
        return []
    trouves = []
    for m in RE_TENU.finditer(t):
        det, np_ = m.group(1), m.group(2).strip()
        mots = np_.split()
        if mots and mots[0].lower() in PARTICULES_REFUS:
            continue                       # « holding onto a rope », « holding on tight »
        while len(mots) > 1 and mots[0].lower() in PARTICULES_ELISION:
            mots = mots[1:]                # « holding up a sign » -> « a sign »
        if mots and re.match(r"^(?:an?|the)$", mots[0], re.I) and len(mots) > 1:
            mots = mots[1:]
        tete = mots[-1].lower()
        cl = _classe(tete)
        if tete in STOP_TENU or tete.rstrip('s') in STOP_TENU:
            continue                       # « holding his breath », « holding a pose » : pas un objet
        if tete in PARTICULES_ELISION or tete in PARTICULES_REFUS:
            continue
        item = ' '.join(mots)
        trouves.append({'item': item, 'cls': cl,
                        'count': _nombre_det(det, item), 'hand': None, 'arme': cl is not None})
    for m in RE_AVEC_DANS_MAIN.finditer(t):
        mots = m.group(1).split()
        cl = _classe(mots[-1])
        if cl is None and mots[-1].lower() not in OBJETS_TENUS:
            continue
        if not any(o['item'].endswith(mots[-1]) for o in trouves):
            trouves.append({'item': ' '.join(mots), 'cls': cl, 'count': 1, 'hand': m.group(2), 'arme': cl is not None})
    # « a sword and a shield » apres « holding a sword » : on cherche aussi « and (a|the) <arme> »
    for m in re.finditer(r"\band\s+(?:an?|the)\s+((?:" + _MOTS + r"\s+){0,2}?" + _MOTS + r")\b", t, re.I):
        mots = m.group(1).split()
        cl = _classe(mots[-1])
        if cl and trouves and not any(o['item'].endswith(mots[-1]) for o in trouves):
            trouves.append({'item': ' '.join(mots), 'cls': cl, 'count': 1, 'hand': None, 'arme': True})
    trouves = _fusionner(trouves)
    mh = RE_MAIN.search(t)
    if mh and trouves and trouves[0]['hand'] is None:
        trouves[0]['hand'] = mh.group(1).lower()
    if re.search(r"\b(?:with|in) both hands\b|\btwo[- ]handed\b", t, re.I) and trouves:
        trouves[0]['hand'] = 'both'
    elif RE_CHAQUE_MAIN.search(t) and trouves:
        trouves[0]['count'] = max(trouves[0]['count'], 2)
    return trouves


def extraire_parties(texte):
    """Nombres anatomiques demandes : « three-headed », « four arms ». -> {partie: n} (n different du defaut)."""
    t = (texte or '').lower()
    out = {}
    for m in re.finditer(r"\b(one|single|two|three|four|five|six|seven|eight|nine|ten|\d+)[- ](headed|armed|legged|eyed|winged|tailed|horned|faced)\b", t):
        g = m.group(1)
        n = NOMBRE[g] if g in NOMBRE else int(g)
        out[ADJ_PARTIE[m.group(2)]] = n
    for m in re.finditer(r"\b(one|single|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(heads?|arms?|legs?|eyes?|wings?|tails?|horns?|hands?|faces?)\b", t):
        g = m.group(1)
        n = NOMBRE[g] if g in NOMBRE else int(g)
        out[m.group(2).rstrip('s')] = n
    return {p: n for p, n in out.items() if n != PAR_DEFAUT.get(p)}


def extraire_quantite_objet(texte):
    """« three potions », « a pair of boots », « set of 4 chess pieces » -> (n, nom) ou None.
    Seulement hors parties du corps (traitees a part)."""
    t = (texte or '').lower()
    m = re.search(r"\b(?:a )?(pair of|set of|couple of)\s+(?:(two|three|four|five|six|seven|eight|nine|ten|\d+)\s+)?((?:[a-z-]+\s+){0,2}[a-z-]+)", t)
    if m and m.start() <= 12:
        g2 = m.group(2)
        if not g2:
            n = None
        elif g2.isdigit():
            n = int(g2)
        else:
            n = NOMBRE.get(g2)
        return (n or (2 if m.group(1) != 'set of' else 3), m.group(3).strip())
    m = re.search(r"\b(two|three|four|five|six|seven|eight|nine|ten)\s+((?:[a-z-]+\s+){0,2}[a-z-]+s)\b", t)
    if m and m.start() <= 12:
        nom = m.group(2).strip()
        tete = nom.split()[-1].rstrip('s')
        if tete in PARTIES or tete in ('head', 'arm', 'leg', 'eye', 'wing', 'tail', 'horn', 'hand', 'face'):
            return None
        return (NOMBRE[m.group(1)], nom)
    return None


def analyser(texte, type_actif='character', style=''):
    t = texte or ''
    objets = extraire_objets_tenus(t)
    vue = VUE.search(t)
    intent = {
        'objets': objets,
        'arme_nommee': any(o['arme'] for o in objets),
        'sans_arme': bool(RE_SANS_ARME.search(t)),
        'pose_libre': bool(POSE_LIBRE.search(t)),
        'vue': (vue.group(1).lower() if vue else None),
        'buste': bool(BUSTE.search(t)),
        'non_humain': bool(NONHUMAIN.search(t)),
        'parties': extraire_parties(t),
        'quantite': extraire_quantite_objet(t),
        'socle_voulu': bool(DESACCORD_SOCLE.search(t)),
        'roche_voulue': bool(ROCHE_VOULUE.search(t)),
        'mot_multiple': bool(re.search(r"\b(twin|twins|dual|double|pair|couple)\b", t, re.I)),
        'couleurs': sorted({c for c in COULEURS if re.search(r"\b" + c + r"\b", t, re.I)}),
        'style_non_photo': style in STYLES_NON_PHOTO,
    }
    # asymetrie demandee -> on retire « symmetric »
    intent['asymetrique'] = bool(objets) or bool(re.search(r"\b(asymmetric\w*|one[- ]eyed|one[- ]armed|"
                                                          r"missing (?:an? )?(?:arm|eye|leg)|scar\w*)\b", t, re.I))
    return intent


# ---------------------------------------------------------------- composition du positif
def _regles(regles):
    return TOUTES_REGLES if regles == 'toutes' else (REGLES_ACTIVES if regles is None else tuple(regles))


def clause_objet_tenu(intent, regles=None):
    """Formulation precise de la main, a poser JUSTE APRES le texte de l'utilisateur (dans le bloc 0 de l'encodeur).
    Un objet -> « holding exactly one X in the right hand, left hand open and empty ». Rien si aucun objet tenu."""
    if 'objets' not in _regles(regles):
        return None
    objets = intent.get('objets') or []
    if not objets:
        return None
    if len(objets) >= 2:
        a, b = objets[0], objets[1]
        return "holding %s in the right hand and %s in the left hand" % (a['item'], b['item'])
    o = objets[0]
    if o['count'] >= 2:
        return "holding exactly two %ss, one in each hand" % o['item'].rstrip('s')
    main = (o['hand'] or 'right')
    if main == 'both':
        return "holding exactly one %s with both hands" % o['item']
    autre = 'left' if main == 'right' else 'right'
    return "holding exactly one %s in the %s hand, %s hand open and empty" % (o['item'], main, autre)


def composer_gabarit(gabarit, type_actif, intent, regles=None):
    """Retourne (gabarit adapte, notes). La clause d'objet tenu n'est PAS dedans : voir clause_objet_tenu()."""
    rg = _regles(regles)
    segs = [s.strip() for s in gabarit.split(',') if s.strip()]
    notes = []

    def retirer(*noms):
        nonlocal segs
        bas = set(n.lower() for n in noms)
        avant = len(segs)
        segs = [s for s in segs if s.lower() not in bas]
        return len(segs) != avant

    def remplacer(ancien, nouveau):
        for i, s in enumerate(segs):
            if s.lower() == ancien.lower():
                segs[i] = nouveau
                return True
        return False

    est_unite = type_actif in TYPES_UNITE
    if est_unite:
        if 'non_humain' in rg and intent['non_humain'] and retirer('fully clothed'):
            notes.append('fully clothed retire (sujet non humain)')
        if 'pose' in rg and intent['pose_libre']:
            retirer('T-pose', 'arms extended horizontally', 'legs apart', 'symmetric', 'empty open hands')
            notes.append('pose demandee : T-pose non imposee')
        if 'buste' in rg and intent['buste']:
            retirer('full body', 'legs apart')
            notes.append('buste demande : full body retire')
        if 'objets' in rg and intent['objets']:
            if retirer('empty open hands'):
                notes.append('mains vides retire (objet tenu)')
            if retirer('symmetric'):
                notes.append('symmetric retire (objet tenu)')
            if not (('buste' in rg) and intent['buste']):
                if retirer('centered', 'clean silhouette'):
                    segs.append(CADRAGE_TENU)
                    notes.append('cadrage : objet tenu entierement visible')
        elif 'asymetrie' in rg and intent['asymetrique'] and retirer('symmetric'):
            notes.append('symmetric retire (asymetrie demandee)')
    if 'vue' in rg and intent['vue']:
        v = intent['vue']
        vue_txt = ('back view, seen from behind' if ('back' in v or 'rear' in v or 'behind' in v)
                   else 'side view, in profile' if ('side' in v or 'profile' in v)
                   else v)
        for ancien in ('strict front view', 'front view', 'side profile', 'lateral profile'):
            if remplacer(ancien, vue_txt):
                break
        retirer('facing camera')
        notes.append('vue demandee : ' + vue_txt)
    if 'quantite' in rg and intent['quantite'] and not est_unite:
        n, nom = intent['quantite']
        for ancien in ('isolated', 'full item', 'full weapon', 'complete vehicle', 'full structure'):
            retirer(ancien)
        segs.insert(0, "exactly %d %s, all fully visible, evenly spaced" % (n, nom))
        notes.append('quantite demandee')
    if 'parties' in rg:
        for partie, n in intent['parties'].items():
            segs.append("exactly %d %s%s" % (n, partie, 's' if n > 1 else ''))
        if intent['parties']:
            notes.append('nombres anatomiques ajoutes')
    return ', '.join(segs), notes


# ---------------------------------------------------------------- composition du negatif
def composer_negatif_armes(type_actif, intent, avec_poids=True, regles=None):
    """Remplace la liste des armes interdites aux unites : meme liste, moins ce que l'utilisateur DEMANDE, plus la parade
    « une seule arme » quand une seule arme est nommee. -> (morceau_negatif, retires, ajoutes) ou None (autres types).
    Sans arme nommee, ou « unarmed » : la liste d'origine, inchangee (la regle du 26/09 reste vraie)."""
    if type_actif not in TYPES_UNITE:
        return None
    toks = list(ARMES_UNITE_NEG)
    retires, ajoutes = [], []
    if 'objets' in _regles(regles) and intent['arme_nommee'] and not intent['sans_arme']:
        classes = set(o['cls'] for o in intent['objets'] if o['cls'])
        enlever = set(['weapon', 'holding weapon'])
        for c in classes:
            enlever.update(NEG_PAR_CLASSE.get(c, []))
        retires = [x for x in toks if x in enlever]
        toks = [x for x in toks if x not in enlever]
        if len(intent['objets']) == 1 and intent['objets'][0]['count'] == 1:
            ajoutes = list(NEG_UNE_SEULE_ARME)
    if avec_poids:
        morceau = ', '.join("(%s:%s)" % (x, POIDS_ARME[x]) for x in toks)
        if ajoutes:
            morceau += ', ' + ', '.join("(%s:1.5)" % x for x in ajoutes)
    else:
        morceau = ', '.join(toks + ajoutes)
    return morceau, retires, ajoutes


def negatifs_extra(type_actif, intent, regles=None):
    """Negatifs cibles a AJOUTER (jamais par defaut) et jetons a RETIRER du negatif de base. -> (ajout, retire)."""
    rg = _regles(regles)
    ajout, retire = [], []
    unite = type_actif in TYPES_UNITE
    if unite and 'socle' in rg and not intent['socle_voulu']:
        ajout += [x for x in NEG_SOCLE if not (x == 'rocks' and intent['roche_voulue'])]
    if 'objets' in rg and intent['objets'] and unite:
        ajout.append('duplicate objects')
        retire += ['holding objects']          # negatif de modal_app/_tpose.py
    if 'objets' in rg and intent['asymetrique'] and intent['objets']:
        retire += ['asymmetric']               # negatif du pont bureau (branche T-pose)
    if 'parties' in rg:
        for partie in intent['parties']:
            retire += NEG_ANATOMIE.get(partie, [])
    if 'quantite' in rg and (intent['quantite'] or intent['mot_multiple']):
        retire += ['two', 'pair', 'twin', 'set of two', 'multiple instances', 'two subjects', 'second instance', 'duplicate']
    if 'vue' in rg and intent['vue']:
        retire += ['side view', 'three-quarter view', 'profile view', 'back view', 'aerial view']
    if 'pose' in rg and intent['pose_libre']:
        retire += ['dynamic pose', 'action pose', 'combat stance', 'fighting', 'running', 'jumping',
                   'crouching', 'bent arms', 'bent legs', 'asymmetric', 'hands on hips', 'arms at sides',
                   'hands touching body']
    if 'buste' in rg and intent['buste']:
        retire += ['headshot', 'portrait', 'close-up', 'partial body', 'cropped']
    return ajout, retire


def composer_queue(intent):
    """Queue de qualite : ne force plus la photo quand le style choisi n'est pas photographique (NON active : voir REGLES_ACTIVES)."""
    return QUEUE_NEUTRE if intent['style_non_photo'] else QUEUE_PHOTO


def couleurs_style(segment_style, intent):
    """Retire d'un style les segments dont une couleur CONTREDIT une couleur citee par l'utilisateur (NON active)."""
    if not intent['couleurs']:
        return segment_style
    gardes = []
    for s in [x.strip() for x in segment_style.split(',')]:
        cs = [c for c in COULEURS if re.search(r"\b" + c + r"\b", s, re.I)]
        if cs and not set(cs) & set(intent['couleurs']):
            continue
        gardes.append(s)
    return ', '.join(gardes)


# ---------------------------------------------------------------- aides pour les chaines de negatifs du pont (sans ponderation)
def _norm(s):
    return s.strip().lower()


def retirer_jetons(chaine, jetons):
    """Retire d'une chaine « a, b, c » les segments EXACTEMENT egaux (casse ignoree) a l'un des jetons. Garde l'ordre et la ponctuation finale."""
    if not jetons:
        return chaine
    bas = set(_norm(j) for j in jetons)
    fin = ', ' if chaine.rstrip().endswith(',') else ''
    segs = [s for s in chaine.split(',') if s.strip()]
    gardes = [s.strip() for s in segs if _norm(s) not in bas]
    return ', '.join(gardes) + (fin if gardes else '')


def ajouter_jetons(chaine, jetons, en_tete=True):
    """Ajoute les jetons absents de la chaine : en TETE par defaut (la fin d'un prompt est celle qui se perd), en queue si en_tete=False
    (negatif du pont : les jetons de securite du debut restent les premiers)."""
    if not jetons:
        return chaine
    presents = set(_norm(s) for s in chaine.split(',') if s.strip())
    nouveaux = []
    for j in jetons:
        if _norm(j) not in presents and j not in nouveaux:
            nouveaux.append(j)
    if not nouveaux:
        return chaine
    if en_tete:
        return ', '.join(nouveaux) + ', ' + chaine
    base = chaine.rstrip()
    if base.endswith(','):
        base = base[:-1]
    return base + ', ' + ', '.join(nouveaux)


def negatifs_pont(type_actif, intent, regles=None):
    """Tout ce dont le pont bureau a besoin pour son negatif : {armes: chaine ou None, retirer: [...], ajouter: [...]}.
    `armes` remplace _armes_neg tel quel (virgule finale incluse) ; `retirer` / `ajouter` s'appliquent au negatif entier."""
    ajout, retire = negatifs_extra(type_actif, intent, regles)
    armes = composer_negatif_armes(type_actif, intent, avec_poids=False, regles=regles)
    return {
        'armes': (armes[0] + ', ') if armes and armes[0] else None,
        'retirer': retire,
        'ajouter': ajout,
    }
