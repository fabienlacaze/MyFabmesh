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
    'character'         : 'isolated 3D character, full body, fully clothed, T-pose, arms extended horizontally, legs apart, strict front view, facing camera, symmetric, plain white background, centered, clean silhouette',
    'building'          : 'architectural building exterior, wide establishing shot, whole structure inside frame, clear margin on all sides, plain white background, centered, strict front view, clean silhouette',
    'vehicle'           : 'isolated, complete vehicle, plain white background, even studio lighting, no shadows, no characters, centered, strict front view, facing camera, clean silhouette, no text, no UI, no rear view inset',
    'weapon'            : 'isolated, full weapon, plain white background, even studio lighting, no shadows, centered, side profile, clean silhouette, no text, no UI',
    'prop'              : 'isolated, full item, plain white background, even studio lighting, no shadows, no characters, centered, strict front view, clean silhouette, no text, no UI',
    'creature'          : 'full body creature, wide establishing shot, entire creature visible from head to tail, body fills 60 percent of frame, neutral stance, front view, plain white background, centered, clean silhouette',
    'environment'       : 'isolated, full structure, plain white background, even studio lighting, no shadows, no characters, centered, strict front view, clean silhouette, no text, no UI',
    'icon'              : 'flat app icon, isolated subject centered in square frame, pure white background, soft rim light, vibrant colors, slight isometric 3/4 angle, glossy material, clean silhouette',
    'avion'             : 'complete passenger aircraft, 3/4 isometric view, full body visible from nose to tail, both wings and tail fin visible, plain white background, centered, clean silhouette',
    'bateau'            : 'complete boat, 3/4 isometric view, full body visible from bow to stern, hull and superstructure visible, plain white background, centered, clean silhouette',
    'animal'            : 'full body animal, lateral profile, entire animal visible from nose to tail, all four feet on the ground, fills 60 percent of frame, plain white background, centered',
    'insect'            : 'full body insect, exactly six legs, segmented head thorax abdomen, antennae, 3/4 isometric view from above, all six legs visible, fills 60 percent of frame, plain white background, centered',
    'other_living'      : 'full body, isolated, plain white background, even studio lighting, no shadows, centered, strict front view, facing camera, clean silhouette, no text, no UI',
    'other_vehicle'     : 'complete vehicle, isolated, plain white background, even studio lighting, no shadows, no characters, centered, strict front view, facing camera, clean silhouette, no text, no UI',
    'other_built'       : 'full structure, isolated, plain white background, even studio lighting, no shadows, no characters, centered, strict front view, clean silhouette, no text, no UI',
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
    style_prefix = ASSET_STYLE_PROMPTS.get(asset_style, '')
    type_suffix = ASSET_TYPE_PROMPTS.get(asset_type, '')
    parts = [p for p in (style_prefix, user_prompt, type_suffix) if p]
    return ', '.join(parts)


def is_tpose_prompt(prompt: str) -> bool:
    p = prompt.lower()
    return any(kw in p for kw in (
        't-pose', 't pose', 'tpose',
        'arms extended horizontally',
        'rts unit',
        'neutral stance',
    ))
