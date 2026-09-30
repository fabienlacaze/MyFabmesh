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


def build_enriched_prompt(user_prompt: str, asset_type: str, asset_style: str) -> str:
    """Ajoute style + gabarit autour du texte de l'utilisateur, SANS doublon.

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
        parts = [p for p in (prefixe, texte, tenue, style, gabarit) if p]
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
