"""Cloud-side prompt construction.

Copy of the asset-type + asset-style suffixes from
`src/renderer/index2.js:buildFullPrompt()` and `cog/predict.py`. Kept
verbatim so cloud-generated images match what the desktop / Cog
produce for the same (prompt, type, style) tuple.

This module is intentionally dependency-free (no torch, no diffusers)
so Modal's @modal.enter(snap=True) can import it without paying any
CUDA cost.
"""

# 2026-06-09 (workflow wb66mnlri): trimmed to fit SDXL CLIP-L 77-token
# cap. Removed "ONE X only / single instance / isolated / no duplicate"
# anti-patterns — empirically these POSITIVE tokens make SDXL fill
# empty space with a second subject (canonical doubling bug, seed
# 1004/1009 bear+cub). Anti-headshot/anti-portrait moved to NEGATIVE
# in modal_app/_realvis.py:build_prompts() where they belong. What
# remains here: pure semantic guidance (pose, framing, background).
ASSET_TYPE_PROMPTS = {
    # GENERE PAR build/sync_prompt_tables.py — NE PAS EDITER A LA MAIN.
    # Source de verite : src/renderer/index2.js (ce que voit
    # l'utilisateur dans les menus). Toute modification faite ici
    # sera ecrasee, et `--verify` fera echouer le build.
    'character'         : 'isolated 3D character, full body, fully clothed, T-pose, arms extended horizontally, empty open hands, legs apart, strict front view, facing camera, symmetric, plain white background, centered, clean silhouette',
    'building'          : 'architectural building exterior, wide establishing shot, whole structure inside frame, clear margin on all sides, plain white background, centered, strict front view, clean silhouette',
    'vehicle'           : 'isolated, complete vehicle, plain white background, even studio lighting, centered, strict front view, facing camera, clean silhouette',
    'weapon'            : 'isolated, full weapon, plain white background, even studio lighting, centered, side profile, clean silhouette',
    'prop'              : 'isolated, full item, plain white background, even studio lighting, centered, strict front view, clean silhouette',
    'creature'          : 'full body creature, wide establishing shot, whole creature head to tail, body stretched out, fills 60 percent of frame, neutral stance, front view, plain white background, centered, clean silhouette',
    'environment'       : 'isolated, full structure, plain white background, even studio lighting, centered, strict front view, clean silhouette',
    'icon'              : 'flat app icon, isolated subject centered in square frame, pure white background, soft rim light, vibrant colors, slight isometric 3/4 angle, glossy material, clean silhouette',
    'avion'             : 'complete passenger aircraft, 3/4 isometric view, full body visible from nose to tail, both wings and tail fin visible, plain white background, centered, clean silhouette',
    'bateau'            : 'complete boat, 3/4 isometric view, full body visible from bow to stern, hull and superstructure visible, plain white background, centered, clean silhouette',
    'animal'            : 'full body animal, lateral profile, whole animal nose to tail, body stretched out, all four feet on ground, fills 60 percent of frame, plain white background, centered',
    'en_vol'            : 'full body animal, airborne, lateral profile, whole animal nose to tail, fills 60 percent of frame, plain white background, centered',
    'insect'            : 'full body insect, exactly six legs, segmented head thorax abdomen, antennae, 3/4 isometric view from above, all six legs visible, fills 60 percent of frame, plain white background, centered',
    'sans_pattes'       : 'full body, head to tail tip, body stretched out straight, gentle S-curve, seen from above at an angle, fills 60 percent of frame, plain white background, centered',
    'poisson'           : 'full body fish, lateral profile, body straight from head to tail fin, fins spread, fills 60 percent of frame, plain white background, centered',
    'other_living'      : 'full body, isolated, plain white background, even studio lighting, centered, strict front view, facing camera, clean silhouette',
    'other_vehicle'     : 'complete vehicle, isolated, plain white background, even studio lighting, centered, strict front view, facing camera, clean silhouette',
    'other_built'       : 'full structure, isolated, plain white background, even studio lighting, centered, strict front view, clean silhouette',
    'other_item'        : 'full item, plain white background, centered, strict front view, clean silhouette',
    'custom'            : '',
}

ASSET_TYPE_PREFIXES = {
    # GENERE PAR build/sync_prompt_tables.py — NE PAS EDITER A LA MAIN.
    # Source de verite : src/renderer/index2.js (ce que voit
    # l'utilisateur dans les menus). Toute modification faite ici
    # sera ecrasee, et `--verify` fera echouer le build.
    'building'          : 'an architectural building, a complete standalone structure',
    'environment'       : 'a single isolated environment prop',
}

ASSET_STYLE_PROMPTS = {
    # GENERE PAR build/sync_prompt_tables.py — NE PAS EDITER A LA MAIN.
    # Source de verite : src/renderer/index2.js (ce que voit
    # l'utilisateur dans les menus). Toute modification faite ici
    # sera ecrasee, et `--verify` fera echouer le build.
    'realistic'         : 'realistic style, photorealistic, sharp details, detailed materials',
    'stylized'          : 'stylized art, mid-poly game asset, hand-painted textures, fantasy game style',
    'lowpoly'           : 'low-poly 3D art, flat-shaded, faceted geometry, minimalist, geometric shapes, vibrant colors',
    'cartoon'           : 'cartoon style, bold outlines, cel-shading, vibrant flat colors, expressive shapes',
    'anime'             : 'anime style, soft cel-shading, expressive features, japanese animation aesthetic',
    'pixelart'          : 'pixel art style, 16-bit retro game aesthetic, limited palette, sharp pixel edges',
    'painterly'         : 'painterly style, brushstroke textures, hand-painted concept art look',
    'pbr'               : 'PBR materials, ultra detailed, 8k textures, high-poly cinematic quality, film-grade lighting',
    'voxel'             : 'voxel art, minecraft-inspired blocky 3D style, cubic geometry, clean voxels',
    'stylized-pbr'      : 'stylized PBR, Overwatch and Fortnite style, hand-painted shading on PBR maps, clean game asset',
    'hand-painted'      : 'hand-painted texture, WoW-style stylized, painterly diffuse, no realistic PBR maps, vibrant',
    'ghibli'            : 'Studio Ghibli style, soft anime, gentle warm palette, hand-drawn animation, expressive nature',
    'pixar'             : 'Pixar 3D animated movie, clean stylized 3D, family-friendly polish, expressive characters',
    'comic'             : 'comic book style, ink outlines, halftone shading, bold saturated colors, dynamic poses',
    'dark-fantasy'      : 'dark fantasy, gothic grimdark, dramatic chiaroscuro lighting, weathered ornate detail, brooding',
    'cyberpunk'         : 'cyberpunk sci-fi, neon accents, futuristic mechanical detail, gritty urban',
    'steampunk'         : 'steampunk, brass copper rivets, victorian mechanical, leather and gears, ornate clockwork',
    'minecraft'         : 'Minecraft blocky low-fi, cubic geometry, pixelated 16x16 texture, voxel inspired',
    'watercolor'        : 'watercolor painting, soft pigment washes, paper texture, gentle bleeding edges',
    'concept'           : 'concept art, rough painterly, dramatic lighting, production design, key art quality',
    'sketch'            : 'pencil sketch, line art, graphite shading, minimal color, hand-drawn',
    'claymation'        : 'claymation, plasticine model, soft stop-motion surface, Aardman style, handmade charm',
    'synthwave'         : 'synthwave vaporwave, retro 80s neon, purple and cyan gradients, chrome grid glow',
    'horror'            : 'horror creepy, dark unsettling atmosphere, eerie grim, weathered decay',
    'chrome'            : 'polished chrome metal, mirror reflections, liquid metal surface, glossy',
    'marble'            : 'marble statue, carved stone sculpture, veined polished white marble',
    'carved-wood'       : 'carved wood, natural wood grain, hand-carved artisan woodwork',
    'stained-glass'     : 'stained glass, colored glass panels, dark lead outlines, luminous backlit',
    'holographic'       : 'holographic iridescent, rainbow sheen, pearlescent shimmer, prismatic',
    'figurine'          : 'toy figurine, glossy molded plastic, collectible model, smooth vinyl',
    'graffiti'          : 'graffiti street art, spray paint, vibrant urban colors, bold outlines',
    'art-deco'          : 'art deco, geometric gold ornament, elegant symmetrical 1920s luxury',
    'custom'            : '',
    # Alias de compatibilite : orthographes utilisees
    # historiquement cote cloud, gardees pour les clients en cache.
    'low-poly'          : 'low-poly 3D art, flat-shaded, faceted geometry, minimalist, geometric shapes, vibrant colors',
    'pixel-art'         : 'pixel art style, 16-bit retro game aesthetic, limited palette, sharp pixel edges',
    'concept-art'       : 'painterly style, brushstroke textures, hand-painted concept art look',
    'none'              : '',
}


# Animal SANS PATTES (serpent, ver) ou POISSON (28/09/2026) : le gabarit « animal » (« all four feet on
# ground ») faisait dessiner un serpent ENROULE sur lui-meme, inanimable. Mots = copie EXACTE de
# MOTS_NAGE / MOTS_REPTATION du moteur de marche (src/renderer/lib/locomotion-procedurale.js).
_MOTS_NAGE = set('fish fishes tuna shark sharks whale whales dolphin dolphins orca salmon trout carp cod eel ray manta stingray piranha goldfish koi marlin swordfish sardine herring mackerel pike perch catfish barracuda seahorse narwhal beluga porpoise bass tilapia sturgeon poisson poissons thon requin requins baleine baleines dauphin dauphins saumon truite carpe morue anguille raie espadon hareng maquereau brochet perche silure hippocampe narval marsouin esturgeon pez peces atun tiburon ballena delfin salmon trucha anguila fisch thunfisch hai wal delfin lachs forelle karpfen aal pesce tonno squalo balena delfino salmone trota peixe atum tubarao baleia golfinho'.split())
_MOTS_REPTATION = set('snake snakes serpent serpents python cobra viper boa anaconda mamba rattlesnake adder worm worms earthworm larva larvae maggot caterpillar slug leech couleuvre vipere ver vers lombric chenille limace sangsue asticot larve serpiente culebra gusano oruga babosa schlange wurm raupe schnecke serpente verme bruco lumaca cobra minhoca lagarta lesma'.split())


def mode_depuis_texte(texte: str):
    """'nage', 'reptation' ou None, d'apres les mots d'un texte (sans accents, minuscules)."""
    import re as _re
    import unicodedata as _ud
    t = _ud.normalize('NFD', str(texte or '').lower().replace('œ', 'oe').replace('æ', 'ae'))
    t = ''.join(c for c in t if _ud.category(c) != 'Mn')
    m = set(_re.split(r'[^a-z0-9]+', t))
    if m & _MOTS_NAGE:
        return 'nage'
    if m & _MOTS_REPTATION:
        return 'reptation'
    return None


# Chaine du prompt (2026-10-01) : copie de _epurerDemande / _parleDeVol de src/renderer/index2.js.
# « I want to make a flying pink pig » : la phrase d'intention ne decrit rien, et « flying » etait contredit par le
# gabarit animal (« all four feet on ground »).
_MOTS_VOL = set('fly flying flies flight winged wings wing airborne hovering soaring gliding volant volante volants volantes voler aile ailes ailee ailees volador voladora voladores volando alas fliegend fliegende fliegt flugel voador voadora asas'.split())
_DEMANDE_EN = None
_DEMANDE_FR = None


def _parle_de_vol(texte: str) -> bool:
    import re as _re
    import unicodedata as _ud
    t = _ud.normalize('NFD', str(texte or '').lower().replace('œ', 'oe'))
    t = ''.join(c for c in t if _ud.category(c) != 'Mn')
    return any(m in _MOTS_VOL for m in _re.split(r'[^a-z0-9]+', t))


def _epurer_demande(texte: str) -> str:
    """Retire la phrase d'intention du debut (« I want to make a », « je veux faire un ») et la politesse de fin. Jamais vide."""
    import re as _re
    global _DEMANDE_EN, _DEMANDE_FR
    if _DEMANDE_EN is None:
        _DEMANDE_EN = _re.compile(
            r"^\s*(?:(?:please|pls|hey|hello|hi)\b[ ,!.]*)?(?:(?:can|could|would)\s+you\s+(?:please\s+)?(?:make|create|generate|draw|build)(?:\s+me)?"
            r"|(?:i|we)\s+(?:really\s+|just\s+)?(?:want|need|wish|would\s+like)(?:\s+you)?(?:\s+to)?(?:\s+(?:make|create|generate|draw|build|have|get))?"
            r"|(?:i|we)['’]d\s+like(?:\s+to)?(?:\s+(?:make|create|generate|draw|build|have|get))?"
            r"|(?:please\s+)?(?:make|create|generate|draw|build)(?:\s+me)?)\s+(?:an?\s+|the\s+|some\s+|one\s+)?", _re.I)
        _DEMANDE_FR = _re.compile(
            r"^\s*(?:s['’]il\s+(?:vous|te)\s+pla[iî]t[ ,]*)?(?:je\s+(?:veux|voudrais|souhaite|aimerais|voudrai)|on\s+veut|j['’]aimerais"
            r"|(?:fais|cr[eé]e|g[eé]n[èe]re|dessine|fabrique)(?:-moi)?)\s+"
            r"(?:(?:faire|cr[eé]er|g[eé]n[eé]rer|avoir|dessiner|fabriquer|obtenir)\s+)?(?:(?:un|une|des|le|la|les)\s+|l['’]\s*)?", _re.I)
    brut = str(texte if texte is not None else '')
    t = _DEMANDE_FR.sub('', _DEMANDE_EN.sub('', brut, count=1), count=1)
    t = _re.sub(r"[\s,;.!]*\b(?:please|thanks|thank you|merci)\b[\s.!]*$", '', t, flags=_re.I).strip()
    return t if len(t) >= 3 else brut.strip()


# NEGATIONS DE L'UTILISATEUR (2026-10-03, exigence « l'image doit correspondre EXACTEMENT au prompt »).
# SDXL ne comprend pas la negation : dans « an orc, no helmet » il voit « helmet » et le dessine (CLAUDE.md §14). La locution quitte donc le POSITIF
# (separer_negations) et le terme part au NEGATIF (_realvis.build_prompts pour text2image, _tpose.generate pour la T-pose). Le tri est fait par
# extraire_negations() de composeur_intention (= scripts/composeur_intention.py, jumeau JavaScript lib/composeur-intention.js) : les negations de
# garde-robe / nudite (« without clothes ») n'y sont JAMAIS extraites, elles restent dans le positif sous les yeux du filtre de moderation.
# DEUX SOURCES de termes, reunies par negatifs_utilisateur() : le TEXTE brut (anciens clients, qui envoient « no helmet » tel quel) et le champ
# `negative_extra` de la requete (clients a jour : le texte arrive DEJA sans ses negations, les termes viennent a part, via le worker).
# Interrupteur d'urgence FABMESH_COMPOSEUR=0 : rien n'est extrait, rien n'est ajoute (ancien comportement).


def separer_negations(texte):
    """-> (positif, termes) : le texte SANS ses locutions negatives (« an orc, no helmet, holding a club » -> « an orc, holding a club ») et les termes de
    negatif trouves. Meme resultat que negationsEtPositif du client (lib/composeur-intention.js) : un texte de plus de 2 000 caracteres n'est PAS analyse
    (on ne coupe jamais le texte de l'utilisateur), un texte ENTIEREMENT negatif (« no helmet ») garde son positif tel quel (un prompt vide ne vaut rien)
    mais ses termes partent quand meme au negatif. Sans negation : le texte, a l'octet, et []. Jamais d'exception."""
    t = str(texte if texte is not None else '')
    try:
        from modal_app import composeur_intention as _ci
        if not _ci.actif() or len(t) > _ci.MAX_TEXTE_NEGATIONS:
            return t, []
        r = _ci.extraire_negations(t)
    except Exception as _e:   # le tri des negations ne doit jamais empecher une generation
        print(f"[prompt] negations ignorees ({type(_e).__name__}: {_e})", flush=True)
        return t, []
    if not r['negatifs']:
        return t, []
    if not r['positif'].strip():
        return t, list(r['negatifs'])
    return r['positif'], list(r['negatifs'])


def termes_negatifs_valides(liste):
    """Nettoyage STRICT des termes de negatif d'une requete (champ `negative_extra`) : 8 au plus, 40 caracteres au plus, lettres ASCII / espaces / tirets,
    minuscules, sans doublon ; un element invalide est ECARTE, jamais corrige ; n'importe quelle entree (jamais d'exception). Les termes de garde-robe
    et de nudite (« clothes », « shirt »...) sont ecartes aussi, morceaux a tiret compris : meme liste que l'extraction (composeur_intention._NEG_SENSIBLES) ;
    en NEGATIF ils pousseraient le modele vers la nudite sans que le texte, donc le filtre de moderation, en garde la trace. [] si le composeur est coupe.

    POURQUOI CE CHAMP NE PEUT RIEN CASSER. Il n'AJOUTE qu'au negatif, derriere les pieces de securite, d'ombres et d'armes (voir _realvis.build_prompts) ; les
    caracteres admis ne contiennent ni virgule, ni parenthese, ni deux-points, ni crochet, ni chiffre : un terme ne peut ni ouvrir une autre piece du
    prompt ni fabriquer une ponderation « (nude:0) » qui annulerait une piece de securite. Meme nettoyage cote worker (_nettoyerNegativeExtra)."""
    if not isinstance(liste, (list, tuple)):
        return []
    try:
        from modal_app import composeur_intention as _ci
        if not _ci.actif():
            return []
        sensibles = _ci._NEG_SENSIBLES
        sortie = []
        for x in liste[:64]:                       # jamais plus de 64 elements lus, quelle que soit la taille de la liste recue
            for t in _ci.assainir_negatifs([x]):
                if t in sortie or any(m in sensibles for m in t.replace('-', ' ').split()):
                    continue
                sortie.append(t)
            if len(sortie) >= _ci.MAX_TERMES_NEGATIFS:
                break
        return sortie
    except Exception as _e:   # un nettoyage qui plante vaut « aucun terme », jamais une generation perdue
        print(f"[prompt] termes de negatif ignores ({type(_e).__name__}: {_e})", flush=True)
        return []


def negatifs_utilisateur(texte_brut, extra=None):
    """Tous les termes de negatif d'UNE demande, nettoyes, sans doublon, 8 au plus : d'abord ceux du champ `negative_extra` (clients a jour), puis ceux que
    l'extraction trouve dans le TEXTE brut (anciens clients ; apres _epurer_demande, comme le client). [] si le composeur est coupe."""
    brut = list(extra) if isinstance(extra, (list, tuple)) else []
    brut += separer_negations(_epurer_demande(texte_brut))[1]
    return termes_negatifs_valides(brut)


def texte_pour_plancher(texte, extra=None):
    """Le texte que le PLANCHER DUR de moderation (app.py, _prompt_hard_floor) doit examiner : le texte recu, plus les negations que le client en a SORTIES
    (champ `negative_extra`), rendues sous les deux formes que les listes du filtre connaissent (« no X », « without X »). Meme regle que
    _texteDeModerationNegations du worker et _texteDeModeration du bureau : « a child, no whip » arrive ici comme « a child » + le terme « whip », et le
    plancher doit la juger comme avant. Le worker, premiere ligne, l'a deja fait ; cette seconde ligne ne doit pas se relacher en silence. Les termes sont
    nettoyes comme pour le negatif (seuls les termes REELLEMENT appliques sont examines) ; sans terme, ou composeur coupe : le texte lui-meme, a l'octet."""
    base = str(texte if texte is not None else '')
    termes = termes_negatifs_valides(extra)
    if not termes:
        return base
    return base + ', ' + ', '.join('no %s, without %s' % (t, t) for t in termes)


def build_enriched_prompt(user_prompt: str, asset_type: str, asset_style: str, pose_libre: bool = False) -> str:
    """Ajoute style + gabarit autour du texte de l'utilisateur, SANS doublon.

    `pose_libre` (2026-10-03, case « T-pose » DECOCHEE) : le gabarit des unites perd ses consignes de T-pose (pose libre selon le texte).

    NEGATIONS (2026-10-03) : les locutions negatives du texte (« no helmet », « without a beard ») quittent le positif, pour TOUS les types d'asset ;
    leurs termes partent au negatif (negatifs_utilisateur, _realvis.build_prompts). Sans negation, rien ne change.

    2026-09-23 : ce concatenait sans rien verifier. Or le client enrichit
    deja de son cote, et envoie le resultat : le gabarit arrivait donc DEUX
    FOIS. Mesure sur un projet reel : 193 jetons CLIP pour une limite de 77,
    soit ~60 % du prompt jete en silence, en plein milieu des consignes de
    cadrage -- d'ou des batiments coupes malgre « nothing cropped ».

    On teste donc la presence avant d'ajouter. Le test porte sur le PREMIER
    segment du gabarit (« architectural building exterior »), stable d'une
    version a l'autre : un client plus ancien ou plus recent que le serveur
    ne peut plus produire de doublon. Quand ce premier segment est trop court
    pour etre sur (« isolated », gabarits prop / vehicle / weapon /
    environment), ce sont ses DEUX premiers segments qui servent de reperes,
    comme le nettoyeur du client (MARQUEURS_GABARIT) : l'appli de bureau en
    mode Cloud envoie son prompt DEJA enrichi, et ces gabarits arrivaient en
    double.

    2026-09-30 — PREFIXE de categorie (table generee ASSET_TYPE_PREFIXES,
    « a single isolated environment prop »), place comme buildFullPrompt du
    bureau : [style, prefixe, texte, gabarit], ou [prefixe, texte, tenue,
    style, gabarit] pour une unite. Le site ne l'avait jamais : le worker
    transmet le texte BRUT de l'utilisateur.
    """
    user_prompt = _epurer_demande(user_prompt)
    # NEGATIONS DE L'UTILISATEUR : « an orc, no helmet » -> « an orc » (le terme part au negatif). La detection du vol / de la reptation et le composeur
    # d'intention lisent donc le texte SANS ses negations (« a bird, not flying » ne choisit pas le gabarit « en vol »), comme buildFullPrompt du client.
    user_prompt = separer_negations(user_prompt)[0]
    style_prefix = ASSET_STYLE_PROMPTS.get(asset_style, '')
    type_prefix = ASSET_TYPE_PREFIXES.get(asset_type, '')
    type_suffix = ASSET_TYPE_PROMPTS.get(asset_type, '')
    # Animal SANS PATTES ou POISSON : gabarit dedie (meme regle que buildFullPrompt du client)
    if asset_type in ('animal', 'creature'):
        m = mode_depuis_texte(user_prompt)
        if m == 'reptation':
            type_suffix = ASSET_TYPE_PROMPTS.get('sans_pattes', type_suffix)
        elif m == 'nage':
            type_suffix = ASSET_TYPE_PROMPTS.get('poisson', type_suffix)
        elif asset_type == 'animal' and _parle_de_vol(user_prompt):
            type_suffix = ASSET_TYPE_PROMPTS.get('en_vol', type_suffix)
    deja = (user_prompt or '').lower()

    def _absent(bloc: str) -> bool:
        if not bloc:
            return False
        segments = [s.strip().lower() for s in bloc.split(',')]
        reperes = (segments[0], ', '.join(segments[:2]))
        return not any(len(r) > 12 and r in deja for r in reperes)

    style = style_prefix if _absent(style_prefix) else ''
    prefixe = type_prefix if _absent(type_prefix) else ''
    gabarit = type_suffix if _absent(type_suffix) else ''
    # COMPOSEUR D'INTENTION (2026-10-03, modal_app/composeur_intention.py = scripts/composeur_intention.py ; jumeau JS lib/composeur-intention.js,
    # meme ordre que buildFullPrompt). Une unite qui TIENT quelque chose recevait un gabarit qui disait l'inverse (« empty open hands »,
    # « symmetric ») : 0 image sur 4 n'avait qu'une arme sur l'orc. On adapte le gabarit et on pose une clause precise apres le texte, SEULEMENT
    # quand c'est nous qui ajoutons le gabarit : un client qui l'a deja ajoute l'a deja compose. Sans objet tenu : rien ne change.
    clause = ''
    if asset_type in _TYPES_UNITE and gabarit:
        try:
            from modal_app import composeur_intention as _ci
            # Interrupteur d'urgence FABMESH_COMPOSEUR=0 : aucune adaptation d'INTENTION (regles vides) ; la case « T-pose » de l'utilisateur reste respectee.
            _regles = None if _ci.actif() else ()
            _intention = _ci.analyser(user_prompt, asset_type, asset_style)
            gabarit = _ci.composer_gabarit(gabarit, asset_type, _intention, _regles, tpose=not pose_libre)[0]
            clause = _ci.clause_objet_tenu(_intention, _regles) or ''
        except Exception as _e:   # le composeur ne doit jamais empecher une generation
            print(f"[prompt] composeur d'intention ignore ({type(_e).__name__}: {_e})", flush=True)
    if asset_type in _TYPES_UNITE:
        # UNITES : le SUJET EN TETE, et son EPOQUE rendue visible (2026-09-26).
        # Mesures (banc modal_app/test_prompts_unites.py, graines fixes) :
        # - derriere le prefixe de style, la description pesait moins que les
        #   poncifs du modele (armes tenues, pose approximative) ; en tete,
        #   avec le negatif anti-armes : 1 image armee sur 24 au lieu de 17 ;
        # - « prehistoric worker » donnait un ouvrier de chantier casque sur
        #   4 graines sur 4, MEME avec « (prehistoric:1.4) » : le nom ecrase le
        #   qualificatif. Decrire la TENUE de l'epoque juste apres le sujet
        #   donne 4 sur 4 en fourrures et peaux ; « medieval worker » passe de
        #   3 a 4 sur 4. Interdire les anachronismes dans le negatif (casque,
        #   gilet, jean) ne marchait pas : 3 casques sur 4.
        # Texte DEJA enrichi (gabarit present : appli de bureau en mode Cloud) : l'epoque y est deja rendue ; la refaire
        # ponderait le mot dans la tenue (« (medieval:1.4) linen... ») et recollait la tenue en fin de prompt.
        texte, tenue = (user_prompt, '') if (type_suffix and not gabarit) else _epoque_unite(user_prompt)
        parts = [p for p in (prefixe, texte, tenue, clause, style, gabarit) if p]
    else:
        parts = [p for p in (style, prefixe, user_prompt, gabarit) if p]
    return ', '.join(parts)


# Types dont la sortie est une UNITE jouable (menu « Character / Unit » et
# « autre etre vivant ») : sujet en tete et epoque rendue visible.
_TYPES_UNITE = ('character', 'other_living')

# Epoque -> tenue a decrire. SEULES les epoques MESUREES figurent ici (banc du
# 2026-09-26) ; une autre epoque ne recoit rien plutot qu'une regle non
# verifiee. Pour en ajouter une : la mesurer d'abord sur le banc.
_TENUE_PREHISTORIQUE = 'stone age clothing of animal fur and hides'
_TENUES_EPOQUE = {
    'prehistoric': _TENUE_PREHISTORIQUE,
    'stone age': _TENUE_PREHISTORIQUE,
    'neolithic': _TENUE_PREHISTORIQUE,
    'paleolithic': _TENUE_PREHISTORIQUE,
    'medieval': 'medieval linen and wool clothing',
}


def _epoque_unite(texte: str):
    """Rend (texte, tenue) : chaque epoque connue recoit un poids 1,4 (sauf si
    elle est deja ponderee — l'encodeur de production lit « (mot:1.4) »), et
    la tenue de la PREMIERE epoque trouvee est rendue a part, pour etre placee
    juste apres le sujet. Tenue vide si aucune epoque connue."""
    import re
    if not texte:
        return texte, ''
    tenue = ''
    for mot, habit in _TENUES_EPOQUE.items():
        motif = re.compile(r'(?<![\w(])(' + re.escape(mot) + r')(?![\w:])', re.IGNORECASE)
        if motif.search(texte) or re.search(r'\(' + re.escape(mot) + r':', texte, re.IGNORECASE):
            tenue = tenue or habit
        texte = motif.sub(lambda m: '(' + m.group(1) + ':1.4)', texte)
    if tenue and tenue.lower() in texte.lower():
        tenue = ''
    return texte, tenue


def is_tpose_prompt(prompt: str) -> bool:
    p = prompt.lower()
    return any(kw in p for kw in (
        't-pose', 't pose', 'tpose',
        'arms extended horizontally',
        'rts unit',
        'neutral stance',
    ))
