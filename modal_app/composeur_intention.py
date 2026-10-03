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
Les NEGATIONS de l'utilisateur (« no helmet », « without a beard ») sont separees du positif par extraire_negations() (fin du fichier) : elles vont au NEGATIF.

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

TOUTES_REGLES = ('objets', 'socle', 'asymetrie', 'pose', 'vue', 'buste', 'non_humain', 'parties', 'quantite', 'negations')
REGLES_ACTIVES = ('objets', 'negations')

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
# Version SERREE (Modal, text2image : le negatif y est borne a 77 jetons estimes) : meme nombre de mots que les 3 jetons d'arme retires, donc le budget ne bouge pas
# et « extra characters, bystanders » n'est pas ecarte en plus (constate sur la vraie image Modal le 2026-10-03 avec les 3 jetons).
NEG_UNE_SEULE_ARME_SERRE = ['second weapon', 'duplicate weapon']

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


# Consignes de T-pose du gabarit des unites, retirees quand l'utilisateur DECOCHE la case « T-pose » (pose libre).
CONSIGNES_TPOSE = ('T-pose', 'arms extended horizontally', 'legs apart', 'symmetric', 'empty open hands')


def composer_gabarit(gabarit, type_actif, intent, regles=None, tpose=True):
    """Retourne (gabarit adapte, notes). La clause d'objet tenu n'est PAS dedans : voir clause_objet_tenu().
    `tpose=False` (case « T-pose » decochee) : pose libre, les consignes de T-pose quittent le gabarit des unites. Defaut : T-pose, rien ne change."""
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
        if not tpose and retirer(*CONSIGNES_TPOSE):
            notes.append('pose libre : T-pose non imposee (case decochee)')
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
def composer_negatif_armes(type_actif, intent, avec_poids=True, regles=None, serre=False):
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
            ajoutes = list(NEG_UNE_SEULE_ARME_SERRE if serre else NEG_UNE_SEULE_ARME)
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


# ---------------------------------------------------------------- negations de l'utilisateur (2026-10-03)
# « an orc, no helmet, holding a club » : le modele d'image ne comprend pas la negation (il voit « helmet » et le dessine : CLAUDE.md §14). La
# negation doit donc QUITTER le positif et rejoindre le NEGATIF. extraire_negations() les separe de facon DETERMINISTE : un balayage de mots, AUCUNE
# regex a retour arriere (un texte de 100 000 caracteres est tronque a 2 000 puis traite en temps lineaire). Meme logique dans le jumeau JavaScript.
# PRINCIPE DE PRUDENCE : ce qui n'est pas compris (« no one », « not only X but also Y », « no longer »...) RESTE dans le positif, tel quel ; rien n'est
# supprime en silence. Les negations de garde-robe (« without clothes », « no shirt »...) y restent aussi : le filtre de moderation doit continuer a les VOIR.
MAX_TEXTE_NEGATIONS = 2000     # le texte analyse est tronque a 2 000 caracteres
MAX_TERMES_NEGATIFS = 8        # termes de negatif envoyes au serveur (champ `negativeExtra`)
MAX_CARS_TERME = 40
MAX_MOTS_TERME = 3             # un terme = un groupe nominal de 1 a 3 mots (les 3 DERNIERS si la phrase en compte plus : la tete d'un groupe est a droite)

_NEG_BLANCS = ' \t\r\n\u00a0'
_NEG_ARTICLES = frozenset('a an the any some his her its their my your our'.split())
_NEG_LEGERS = frozenset('wearing holding carrying having using showing including being with'.split())
_NEG_SAUT_AUTRES = _NEG_ARTICLES | _NEG_LEGERS          # apres not / never / without : « not wearing a helmet », « without having a beard »
_NEG_LEGERS_NOT = frozenset('wearing holding carrying having using showing wielding'.split())   # « not » au MILIEU d'une phrase : seulement devant ces verbes
_NEG_CONJ = frozenset('and or nor but'.split())
# mots qui terminent un groupe nominal : prepositions, conjonctions, relatifs, auxiliaires, autres negations
_NEG_FIN_GN = frozenset(('and or nor but with without in on at to for from by as while that which who whose whom where when if than then so because '
                         'is are was were be been being has have had near over under behind above below next around inside outside into onto '
                         'through across between among against along during before after like via per plus not no never of up down off out').split())
# verbes qui OUVRENT une autre proposition (jamais le premier mot d'un groupe : « not standing » est un terme valable)
_NEG_VERBES = frozenset(('holding wearing carrying standing sitting walking running looking riding having using showing wielding gripping covered '
                         'dressed clad posing facing lying kneeling crouching leaning resting hanging jumping fighting holds wears carries stands sits').split())
# mots seuls qui ne decrivent rien : « no more », « not anything »
_NEG_VIDES = frozenset(('anything something everything nothing none anyone someone everyone anybody somebody everybody nobody neither either both all each every '
                        'else other others more less much many same such one ones thing things way longer matter doubt idea need sense kind sort type part parts '
                        'element elements extra additional further').split())
# garde-robe et nudite : ces negations RESTENT dans le positif (le filtre de moderation de chaque plateforme les lit tel quel : « without clothes »,
# « no shirt »... sont dans ses listes). Les envoyer dans le negatif ferait disparaitre la phrase du texte que le filtre examine.
_NEG_SENSIBLES = frozenset(('clothes clothing clothe clothed shirt shirts top tops pants trousers underwear underpants undergarments lingerie bra bras '
                            'panties dress dresses skirt skirts swimsuit bikini outfit outfits garment garments attire apparel nude naked nudity topless '
                            'bare nsfw').split())
# faux amis : le mot qui SUIT le declencheur montre que ce n'est pas une negation d'objet
_NEG_FAUX = {
    'no': frozenset('one longer more matter doubt idea need way sense less sooner such problem kidding'.split()),
    'not': frozenset(('only just too very quite even at really exactly necessarily yet so as much many always sure to enough particularly entirely '
                      'completely fully simply merely rather less more once since until unless all that this what how if because').split()),
    'never': frozenset('before again ever ending ended more quite been seen mind too'.split()),
    'without': frozenset('further fail doubt question warning ever limit end exception delay'.split()),
}
_NEG_AVANT_NO = frozenset('with and but or plus having has holding wearing carrying using showing including'.split())   # « with no X », « and no X », « wearing no X »
_NEG_DEBUT = frozenset('and but or with plus also yet'.split())      # mots de liaison qui peuvent ouvrir un segment negatif : « and no beard »


def _neg_mots(segment):
    """Jetons separes par des blancs (espace, tabulation, retours, espace insecable)."""
    jetons, cur = [], []
    for ch in segment:
        if ch in _NEG_BLANCS:
            if cur:
                jetons.append(''.join(cur))
                cur = []
        else:
            cur.append(ch)
    if cur:
        jetons.append(''.join(cur))
    return jetons


def _neg_bords(s):
    """-> (blancs du debut, blancs de la fin)."""
    a, b = 0, len(s)
    while a < b and s[a] in _NEG_BLANCS:
        a += 1
    while b > a and s[b - 1] in _NEG_BLANCS:
        b -= 1
    return s[:a], s[b:]


def _neg_strip(s):
    avant, apres = _neg_bords(s)
    return s[len(avant):len(s) - len(apres)]


def _neg_coeur(jeton):
    """-> (mot en minuscules, ferme). Mot = lettres ASCII, tirets et apostrophes, sans la ponctuation de bord ; (None, False) si ce n'est pas un mot
    (chiffre, symbole, lettre accentuee). `ferme` : une ponctuation de fin (. ! ? : ) ] } guillemet) termine le groupe nominal."""
    a, b = 0, len(jeton)
    while a < b and jeton[a] in '"\'([{':
        a += 1
    b0 = b
    while b > a and jeton[b - 1] in '"\')]}.!?:':
        b -= 1
    mot = jeton[a:b]
    if not mot:
        return None, False
    for ch in mot:
        if not (('a' <= ch <= 'z') or ('A' <= ch <= 'Z') or ch == '-' or ch == "'"):
            return None, False
    return mot.lower(), b < b0


def _neg_majuscule(jeton):
    """Le premier mot du jeton commence-t-il par une majuscule ? (« Without Remorse » : un titre, pas une negation)."""
    a = 0
    while a < len(jeton) and jeton[a] in '"\'([{':
        a += 1
    return a < len(jeton) and 'A' <= jeton[a] <= 'Z'


def _neg_mot_propre(m):
    if not m or m[0] == '-' or m[-1] == '-' or '--' in m:
        return False
    for ch in m:
        if not (('a' <= ch <= 'z') or ch == '-'):
            return False
    return True


def _neg_terme(mots):
    """Groupe nominal -> terme de negatif propre, ou None (refus : le texte reste dans le positif)."""
    mots = mots[-MAX_MOTS_TERME:]
    if not mots:
        return None
    for m in mots:
        if not _neg_mot_propre(m) or m in _NEG_SENSIBLES:
            return None
    if all(m in _NEG_VIDES for m in mots):
        return None
    terme = ' '.join(mots)
    if len(terme) > MAX_CARS_TERME:
        return None
    return terme


def _neg_suite(jetons, i, decl, ferme):
    """La liste nommee continue-t-elle apres le groupe qui finit en i ? -> indice ou reprendre, ou None.
    « or » / « nor » prolongent toujours ; « and » prolonge apres « without » (« without a helmet and a cape » = ni l'un ni l'autre) ou quand le
    declencheur est REPETE (« no helmet and no beard »). Apres un simple « no helmet and a cape », la cape reste voulue."""
    n = len(jetons)
    if ferme or i >= n:
        return None
    w, _ = _neg_coeur(jetons[i])
    if w not in ('and', 'or', 'nor'):
        return None
    k = i + 1
    repete = False
    if k < n and _neg_coeur(jetons[k])[0] in ('no', 'without', 'not', 'never'):
        repete = True
        k += 1
    if not repete and w == 'and' and decl != 'without':
        return None
    saut = _NEG_SAUT_AUTRES if repete else _NEG_ARTICLES
    m = k
    while m < n:
        w3, _ = _neg_coeur(jetons[m])
        if w3 is not None and w3 in saut:
            m += 1
        else:
            break
    if m >= n:
        return None
    w3, _ = _neg_coeur(jetons[m])
    if w3 is None or w3 in _NEG_FIN_GN or w3 in _NEG_VERBES:
        return None
    if not repete and len(w3) >= 5 and w3.endswith('ed'):
        return None
    return k


def _neg_liste(jetons, i, decl):
    """Lit les groupes nominaux nies apres le declencheur `decl` (no / not / never / without), a partir du jeton i.
    -> (termes, fin) ou None si ce n'est pas une negation exploitable. `fin` : premier jeton APRES la liste."""
    n = len(jetons)
    saut = _NEG_ARTICLES if decl == 'no' else _NEG_SAUT_AUTRES
    faux = _NEG_FAUX[decl]
    if i < n and _neg_coeur(jetons[i])[0] in faux:
        return None
    termes = []
    fin = None
    while True:
        while i < n:
            w, _ = _neg_coeur(jetons[i])
            if w is not None and w in saut:
                i += 1
            else:
                break
        mots = []
        ferme = False
        j = i
        while j < n:
            w, f = _neg_coeur(jetons[j])
            if w is None or w in _NEG_FIN_GN or (mots and w in _NEG_VERBES):
                break
            mots.append(w)
            ferme = f
            j += 1
            if f:
                break
        terme = None
        if mots and mots[0] not in faux:
            terme = _neg_terme(mots)
        if terme is None:
            if termes:
                break                      # un groupe suivant illisible : on garde ce qui a ete compris
            return None
        termes.append(terme)
        fin = j
        k = _neg_suite(jetons, j, decl, ferme)
        if k is None:
            break
        i = k
    return termes, fin


def _neg_verbal(jeton):
    w, _ = _neg_coeur(jeton)
    return w is not None and (w in _NEG_VERBES or (len(w) >= 5 and (w.endswith('ing') or w.endswith('ed'))))


def _neg_traiter_segment(jetons, etat):
    """Un segment (entre deux virgules). -> (action, jetons) avec action 'garder' | 'modifier' | 'retirer'. Les termes trouves sont ajoutes a `etat`."""
    n = len(jetons)
    sortie = []
    i = 0
    modifie = False
    while i < n:
        jeton = jetons[i]
        w, _ = _neg_coeur(jeton)
        debut = all(_neg_coeur(s)[0] in _NEG_DEBUT for s in sortie)
        decl = None
        precedent = 0
        if w in ('no', 'not', 'never', 'without'):
            if debut:
                if jeton[0] not in '"\u201c':          # « "No entry" » : une citation, pas une negation
                    decl = w
            elif jeton[0] in '([{':
                decl = w                               # « an orc (no helmet) holding a club » : une parenthese qui nie
            elif _neg_majuscule(jeton):
                decl = None                            # « Without Remorse » au milieu d'une phrase : un titre
            elif w == 'without':
                decl = w
            elif w == 'no' and _neg_coeur(sortie[-1])[0] in _NEG_AVANT_NO:
                decl = w
                precedent = 1
            elif w == 'not' and i + 1 < n and _neg_coeur(jetons[i + 1])[0] in _NEG_LEGERS_NOT:
                decl = w
        if decl is not None:
            res = _neg_liste(jetons, i + 1, decl)
            if res is not None:
                termes, fin = res
                nouveaux = []
                for t in termes:
                    if t not in etat and t not in nouveaux:
                        nouveaux.append(t)
                if len(etat) + len(nouveaux) <= MAX_TERMES_NEGATIFS:
                    etat.extend(nouveaux)
                    modifie = True
                    if debut:
                        # tout le segment est une negation : « no helmet » ; « no helmet and holding a sword » garde la proposition qui suit
                        sortie = []
                        i = fin + 1 if (fin < n and _neg_coeur(jetons[fin])[0] in _NEG_CONJ) else n
                    else:
                        if precedent:
                            sortie.pop()
                        i = fin
                        if i + 1 < n and _neg_coeur(jetons[i])[0] in ('and', 'or') and _neg_verbal(jetons[i + 1]):
                            i += 1                     # « without a helmet and holding a sword » -> « ... holding a sword »
                    continue
        sortie.append(jeton)
        i += 1
    if not modifie:
        return 'garder', jetons
    if not sortie:
        return 'retirer', []
    return 'modifier', sortie


def _neg_segments(t):
    """Decoupe sur , ; | retour a la ligne, point suivi d'un blanc et tiret isole (« a cat - no tail - sitting »).
    -> liste de (segment, separateur) ; le separateur garde les blancs qui le suivent."""
    segs, cur = [], []
    i, n = 0, len(t)
    while i < n:
        c = t[i]
        if (c in ',;|\r\n' or (c == '.' and (i + 1 >= n or t[i + 1] in _NEG_BLANCS))
                or (c in '-\u2013\u2014' and (i == 0 or t[i - 1] in _NEG_BLANCS) and (i + 1 >= n or t[i + 1] in _NEG_BLANCS))):
            j = i + 1
            while j < n and t[j] in ' \t\u00a0':
                j += 1
            segs.append((''.join(cur), t[i:j]))
            cur = []
            i = j
        else:
            cur.append(c)
            i += 1
    segs.append((''.join(cur), ''))
    return segs


def extraire_negations(texte, regles=None):
    """Separe le texte de l'utilisateur en POSITIF (sans les locutions negatives) et NEGATIFS (termes a ajouter au negatif).
    -> {'positif': str, 'negatifs': [str, ...]}.
    Reconnu : segments « no X », « not X », « never X » (+ « not wearing X »), « without X », « with no X », « and no X », « wearing no X », et les listes
    « no X and no Y », « no X or Y », « without X and Y ». Un terme = 1 a 3 mots, minuscules, articles retires, lettres / espaces / tirets, 40 caracteres au plus ;
    8 termes au plus (au-dela, les phrases restantes RESTENT dans le positif) ; texte tronque a 2 000 caracteres.
    Refuse (le texte reste tel quel) : « no one », « nobody », « none », « nothing », « not only X but also Y », « no longer », « no more », « not too », « cannot »,
    « notably », les titres (« Without Remorse »), les chiffres, et la garde-robe (« without clothes »). « unarmed » / « empty-handed » restent au composeur.
    Un texte sans negation est rendu OCTET POUR OCTET (aucune normalisation des blancs). `regles` sans 'negations' : rien n'est extrait."""
    t = texte if isinstance(texte, str) else ('' if texte is None else str(texte))
    t = t[:MAX_TEXTE_NEGATIONS]
    if 'negations' not in _regles(regles):
        return {'positif': t, 'negatifs': []}
    etat = []
    morceaux = []
    for seg, sep in _neg_segments(t):
        jetons = _neg_mots(seg)
        if not jetons:
            morceaux.append((seg, sep))
            continue
        action, nouveaux = _neg_traiter_segment(jetons, etat)
        if action == 'garder':
            morceaux.append((seg, sep))
        elif action == 'modifier':
            # les blancs de bord du segment sont gardes (« a cat - no tail - sitting » : le blanc avant le tiret)
            avant, apres = _neg_bords(seg)
            morceaux.append((avant + ' '.join(nouveaux) + apres, sep))
        else:
            morceaux.append((None, sep))
    if not etat:
        return {'positif': t, 'negatifs': []}
    while len(morceaux) > 1 and morceaux[-1][0] == '' and morceaux[-1][1] == '':
        morceaux.pop()      # le decoupage laisse un segment vide quand le texte finit par un separateur : il ne compte pas
    gardes = [[seg, sep] for seg, sep in morceaux if seg is not None]
    if gardes and morceaux[-1][0] is None:
        # le dernier segment est parti : sa virgule orpheline aussi, mais pas le point final d'une phrase
        gardes[-1][1] = '.' if morceaux[-1][1].startswith('.') else ''
    positif = _neg_strip(''.join(seg + sep for seg, sep in gardes))
    return {'positif': positif, 'negatifs': list(etat)}


def assainir_negatifs(liste):
    """Rend la liste telle que le serveur l'accepte (champ `negativeExtra`) : 8 termes au plus, 40 caracteres au plus, lettres ASCII / espaces / tirets,
    minuscules, sans doublon. Un element invalide est ECARTE (jamais corrige). N'importe quelle entree : une liste inattendue donne []."""
    if not isinstance(liste, (list, tuple)):
        return []
    sortie = []
    for brut in liste:
        if not isinstance(brut, str):
            continue
        propre = True
        for ch in brut:
            if not (('a' <= ch <= 'z') or ('A' <= ch <= 'Z') or ch == '-' or ch in _NEG_BLANCS):
                propre = False
                break
        if not propre:
            continue
        mots = _neg_mots(brut.lower())
        if not mots or any(not _neg_mot_propre(m) for m in mots):
            continue
        terme = ' '.join(mots)
        if len(terme) > MAX_CARS_TERME or terme in sortie:
            continue
        sortie.append(terme)
        if len(sortie) >= MAX_TERMES_NEGATIFS:
            break
    return sortie
