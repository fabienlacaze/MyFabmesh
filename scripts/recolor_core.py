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

DEUX CHEMINS, et un seul est ici. Un mot de couleur simple (« cape rouge »)
prend la voie HSV ci-dessous. Une MATIERE (« rusty metal », « sunset
gradient ») demandait cote bureau un rendu ControlNet-Tile, que Modal n'a
pas : l'appelant cloud se rabat alors sur l'img2img existant, et le dit.

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
# --- NOYAU PARTAGE : FIN ---
