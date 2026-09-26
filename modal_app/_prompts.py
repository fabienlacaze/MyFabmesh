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
    'creature'          : 'full body creature, wide establishing shot, entire creature visible from head to tail, body fills 60 percent of frame, neutral stance, front view, plain white background, centered, clean silhouette',
    'environment'       : 'isolated, full structure, plain white background, even studio lighting, centered, strict front view, clean silhouette',
    'icon'              : 'flat app icon, isolated subject centered in square frame, pure white background, soft rim light, vibrant colors, slight isometric 3/4 angle, glossy material, clean silhouette',
    'avion'             : 'complete passenger aircraft, 3/4 isometric view, full body visible from nose to tail, both wings and tail fin visible, plain white background, centered, clean silhouette',
    'bateau'            : 'complete boat, 3/4 isometric view, full body visible from bow to stern, hull and superstructure visible, plain white background, centered, clean silhouette',
    'animal'            : 'full body animal, lateral profile, entire animal visible from nose to tail, all four feet on the ground, fills 60 percent of frame, plain white background, centered',
    'insect'            : 'full body insect, exactly six legs, segmented head thorax abdomen, antennae, 3/4 isometric view from above, all six legs visible, fills 60 percent of frame, plain white background, centered',
    'other_living'      : 'full body, isolated, plain white background, even studio lighting, centered, strict front view, facing camera, clean silhouette',
    'other_vehicle'     : 'complete vehicle, isolated, plain white background, even studio lighting, centered, strict front view, facing camera, clean silhouette',
    'other_built'       : 'full structure, isolated, plain white background, even studio lighting, centered, strict front view, clean silhouette',
    'other_item'        : 'full item, plain white background, centered, strict front view, clean silhouette',
    'custom'            : '',
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
    ne peut plus produire de doublon.
    """
    style_prefix = ASSET_STYLE_PROMPTS.get(asset_style, '')
    type_suffix = ASSET_TYPE_PROMPTS.get(asset_type, '')
    deja = (user_prompt or '').lower()

    def _absent(bloc: str) -> bool:
        if not bloc:
            return False
        tete = bloc.split(',')[0].strip().lower()
        return not (tete and len(tete) > 12 and tete in deja)

    style = style_prefix if _absent(style_prefix) else ''
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
        texte, tenue = _epoque_unite(user_prompt)
        parts = [p for p in (texte, tenue, style, gabarit) if p]
    else:
        parts = [p for p in (style, user_prompt, gabarit) if p]
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
