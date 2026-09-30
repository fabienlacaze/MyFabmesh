"""
FabMesh — Recolorier : noyau partage (recolor_core.py)
======================================================

Detecte la partie nommee puis la recolore par un virage HSV qui PRESERVE la
luminance : les plis, les ombres et la matiere restent intacts, seule la
teinte change. C'est ce qui distingue l'outil d'un img2img qui, lui,
redessine.

POURQUOI CE FICHIER. L'outil n'existait QUE sur le bureau — le panneau web
n'avait ni le bouton ni la modale, faute de service correspondant. Le cœur
est pourtant du pur numpy une fois le masque obtenu, et CLIPSeg tourne deja
sur Modal pour l'Auto Inpaint : il n'y avait aucun modele a ajouter, juste du
code a ne pas dupliquer de travers.

DEUX CHEMINS. Un mot de couleur simple (« cape rouge ») prend la voie HSV
ci-dessous. Une MATIERE (« rusty metal », « cuir vieilli ») ou un style
(« sunset gradient ») passe par un re-rendu ControlNet-Tile masque par
CLIPSeg : depuis le 2026-09-30 aussi sur Modal (modal_app/_recolor.py,
generate_tile) ; la route et les reglages sont dans le noyau partage.

PARITE. Le bloc entre les marqueurs NOYAU PARTAGE est EXTRAIT de
scripts/sdxl_server.py et recopie a l'identique dans modal_app/_recolor.py.
build/check-outfit-parity.mjs surveille les deux copies.
"""

# --- NOYAU PARTAGE : DEBUT (copie identique dans modal_app/_recolor.py) ---
# Extrait de scripts/sdxl_server.py — ne rien y ajouter qui depende du bureau
# ou de Modal : numpy + PIL seulement.
import numpy as np
from PIL import Image

_COLOR_LEXICON = {
    'rouge': (0, 1.4, 'chroma'), 'red': (0, 1.4, 'chroma'),
    'orange': (18, 1.4, 'chroma'),
    'jaune': (35, 1.4, 'chroma'), 'yellow': (35, 1.4, 'chroma'),
    'vert': (85, 1.3, 'chroma'), 'verte': (85, 1.3, 'chroma'), 'green': (85, 1.3, 'chroma'),
    'cyan': (128, 1.3, 'chroma'), 'turquoise': (128, 1.3, 'chroma'),
    'bleu': (156, 1.3, 'chroma'), 'bleue': (156, 1.3, 'chroma'), 'blue': (156, 1.3, 'chroma'),
    'violet': (195, 1.3, 'chroma'), 'violette': (195, 1.3, 'chroma'),
    'purple': (195, 1.3, 'chroma'), 'mauve': (200, 1.2, 'chroma'),
    'rose': (227, 1.2, 'chroma'), 'pink': (227, 1.2, 'chroma'),
    'marron': (14, 0.7, 'chroma'), 'brun': (14, 0.7, 'chroma'), 'brune': (14, 0.7, 'chroma'), 'brown': (14, 0.7, 'chroma'),
    'dore': (32, 1.5, 'chroma'), 'dores': (32, 1.5, 'chroma'),
    'doree': (32, 1.5, 'chroma'), 'gold': (32, 1.5, 'chroma'), 'golden': (32, 1.5, 'chroma'),
    'argent': (0, 0.0, 'grey'), 'argente': (0, 0.0, 'grey'), 'argentee': (0, 0.0, 'grey'),
    'silver': (0, 0.0, 'grey'), 'gris': (0, 0.0, 'grey'), 'grise': (0, 0.0, 'grey'),
    'grey': (0, 0.0, 'grey'), 'gray': (0, 0.0, 'grey'),
    'noir': (0, 0.0, 'black'), 'noire': (0, 0.0, 'black'), 'black': (0, 0.0, 'black'),
    'blanc': (0, 0.0, 'white'), 'blanche': (0, 0.0, 'white'), 'white': (0, 0.0, 'white'),
}


def _strip_accents(s):
    import unicodedata
    return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')


def parse_recolor_prompt(prompt):
    """'cape rouge' -> ('cape', color_spec) ; color_spec is None when no known
    colour word is present (-> ControlNet-Tile material fallback)."""
    text = (prompt or '').strip()
    color_spec = None
    noun_words = []
    for raw in text.split():
        w = _strip_accents(raw.strip(".,;:!?\"'()").lower())
        if w in _COLOR_LEXICON:
            if color_spec is None:
                hue, sat, mode = _COLOR_LEXICON[w]
                color_spec = {'hue': hue, 'sat': sat, 'mode': mode, 'word': w}
            # colour words are dropped from the CLIPSeg target either way
        else:
            noun_words.append(raw)
    noun = ' '.join(noun_words).strip() or text
    return noun, color_spec


def recolor_hsv_masked(img_rgb, mask_soft, color_spec, strength=1.0):
    """Shift HSV inside the masked region, preserving luminance (V) so folds and
    shadows stay intact. Blends through the feathered mask * strength."""
    hsv = np.array(img_rgb.convert('HSV')).astype(np.float32)  # H,S,V each 0-255
    H, S, V = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    newH, newS, newV = H.copy(), S.copy(), V.copy()
    mode = color_spec['mode']
    if mode == 'chroma':
        newH[:] = color_spec['hue']
        # Saturation floor 110 so a GREY source (S~0) still takes a clearly visible
        # tint (not a washed-out pastel); already-saturated pixels keep their level.
        newS = np.clip(np.maximum(S * color_spec['sat'], 110.0), 0, 255)
    elif mode == 'grey':
        newS = S * 0.10
    elif mode == 'black':
        newS = S * 0.20
        newV = V * 0.35
    elif mode == 'white':
        newS = S * 0.10
        newV = np.clip(V * 1.15 + 60, 0, 255)
    out_hsv = np.stack([np.clip(newH, 0, 255), np.clip(newS, 0, 255), np.clip(newV, 0, 255)], axis=-1).astype(np.uint8)
    recolored = Image.fromarray(out_hsv, mode='HSV').convert('RGB')
    m = (np.array(mask_soft).astype(np.float32) / 255.0) * float(max(0.0, min(1.0, strength)))
    m = m[..., None]
    base = np.array(img_rgb).astype(np.float32)
    blended = base * (1 - m) + np.array(recolored).astype(np.float32) * m
    return Image.fromarray(blended.clip(0, 255).astype(np.uint8), 'RGB')
# ROUTE ET REGLAGES DU RE-RENDU « MATIERE / STYLE » (2026-09-30, decision du user : « B — meme capacite que le PC » : le cloud repeint aussi
# les matieres). Une demande sans mot de couleur (« cuir vieilli », « rusty metal ») ou un style sur toute l'image (« military green camo »)
# passe par un re-rendu ControlNet-Tile masque par CLIPSeg ; une couleur simple (« cape rouge ») garde le virage HSV ci-dessus.
# UNE SEULE definition pour le bureau (scripts/sdxl_server.py) et Modal : les reglages ne peuvent plus diverger.
def recolor_mots_descriptifs(prompt):
    """Mots du prompt qui ne sont PAS des mots de couleur : « military green camo » -> ['military', 'camo'] ; « green » -> []."""
    mots = []
    for raw in (prompt or '').split():
        if _strip_accents(raw.strip(".,;:!?\"'()").lower()) not in _COLOR_LEXICON:
            mots.append(raw)
    return mots


def recolor_tile_route(color_spec, prompt, recolor_all):
    """True quand la demande passe par le re-rendu ControlNet-Tile plutot que par le virage HSV : aucune couleur connue (matiere),
    OU toute l'image avec des mots descriptifs en plus d'une couleur (« military green camo »). Une couleur SEULE (« vert »)
    garde le virage rapide. (Correctif du 2026-09-30 : l'ancienne condition testait le « nom » de parse_recolor_prompt, qui retombe sur
    le texte entier quand il ne reste aucun autre mot — « green » partait donc en re-rendu, contre l'intention du commit 45a1e2e7.)"""
    return color_spec is None or bool(recolor_all and recolor_mots_descriptifs(prompt))


def recolor_tile_params(noun, full_prompt, recolor_all=False, strength=1.0):
    """Reglages du re-rendu : { denoise, cn, steps, guidance, prompt, negative }.

    Toute l'image (style) : vrai re-rendu img2img (denoise 0,57 a 0,85 selon le curseur Strength, ControlNet a 0,45 pour que les
    couleurs changent tout en tenant la forme, prompt oriente COHERENCE). Une partie : reglage prudent (denoise 0,18) pour
    preserver la zone detectee."""
    s = max(0.2, min(1.0, float(strength)))
    if recolor_all:
        return {
            'denoise': 0.5 + s * 0.35, 'cn': 0.45, 'steps': 30, 'guidance': 6.5,
            'prompt': (f"the whole subject repainted in a {full_prompt} colour scheme, "
                       f"cohesive realistic {full_prompt} palette applied consistently to every surface, "
                       f"natural studio lighting and soft shadows preserved, each material keeps its own "
                       f"surface qualities (metal stays metallic, glass stays glass), same exact shape and "
                       f"structure, photorealistic, highly detailed"),
            'negative': ("flat uniform tint, single flat colour smear, washed out, monochrome, posterised, "
                         "unrealistic colours, oversaturated, deformed, distorted, blurry, low quality, "
                         "changed shape, extra parts"),
        }
    return {
        'denoise': 0.18, 'cn': 0.65, 'steps': 20, 'guidance': 5.5,
        'prompt': f"{full_prompt}, same shape, preserve folds and details, photorealistic",
        'negative': "deformed, distorted, blurry, low quality, changed shape, extra parts",
    }
# --- NOYAU PARTAGE : FIN ---
