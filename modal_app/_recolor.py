"""Recolorier — portage Modal de `scripts/recolor_core.py`.

Le noyau ci-dessous est une COPIE OCTET POUR OCTET du bloc « NOYAU PARTAGE »
de ce fichier (lui-meme extrait de scripts/sdxl_server.py). Il n'est pas
importe : l'image Modal ne monte que `modal_app`, l'appli packagee n'embarque
que `scripts`. build/check-outfit-parity.mjs refuse une divergence.

Ne jamais editer ce bloc ici : editer la source, puis
`node build/check-outfit-parity.mjs --sync`.

CLIPSeg est celui deja charge par _get_auto_inpaint_models() — aucun modele
supplementaire.
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

# ---------------------------------------------------------------------------
# Glu MODAL.
# ---------------------------------------------------------------------------
from PIL import ImageFilter


def _masque_clipseg(seg_processor, seg_model, img_work, w, h, texte, dilate, rel=0.5):
    """CLIPSeg -> masque doux. Meme recette que sdxl_server._clipseg_mask :
    seuil RELATIF au pic de reponse, plancher 50, dilatation puis flou."""
    import torch
    entrees = seg_processor(text=[texte.strip()], images=[img_work],
                            padding=True, return_tensors='pt')
    entrees = {k: v.to('cuda') for k, v in entrees.items()}
    with torch.no_grad():
        sortie = seg_model(**entrees)
    logits = sortie.logits.squeeze().detach().cpu().numpy()
    proba = 1.0 / (1.0 + np.exp(-logits))
    arr = np.asarray(Image.fromarray((proba * 255).astype(np.uint8))
                     .resize((w, h), Image.LANCZOS)).astype(np.float32)
    seuil = max(50.0, float(arr.max()) * float(rel))
    m = Image.fromarray((arr > seuil).astype(np.uint8) * 255, mode='L')
    d = max(0, int(dilate))
    if d > 0:
        m = m.filter(ImageFilter.MaxFilter(d * 2 + 1))
    return m.filter(ImageFilter.GaussianBlur(3))


def generate(seg_processor, seg_model, source_img, prompt,
             strength=1.0, dilate=15, rel=0.5, recolor_all=False,
             max_dim=1024):
    """Recolorie la partie nommee. Retourne (image, couverture_pourcent).

    Leve ValueError si le prompt ne nomme aucune couleur connue : ce cas
    demandait cote bureau un rendu ControlNet-Tile, que Modal n'a pas.
    L'appelant se rabat alors sur l'img2img (op `modify`) et le DIT, au lieu
    de rendre une image inchangee en ayant facture.
    """
    noun, color_spec = parse_recolor_prompt(prompt)
    if color_spec is None:
        raise ValueError(
            "« %s » ne nomme pas une couleur connue : ce cas passe par la "
            "re-generation guidee, pas par le virage de teinte." % prompt)

    img = source_img.convert('RGB')
    ow, oh = img.size
    if max(ow, oh) > max_dim:
        if ow > oh:
            w, h = max_dim, int(oh * max_dim / ow)
        else:
            h, w = max_dim, int(ow * max_dim / oh)
    else:
        w, h = ow, oh
    w = max(8, (w // 8) * 8); h = max(8, (h // 8) * 8)
    travail = img.resize((w, h), Image.LANCZOS)

    if recolor_all:
        masque = Image.new('L', (w, h), 255)
        couverture = 100.0
    else:
        masque = _masque_clipseg(seg_processor, seg_model, travail, w, h,
                                 noun or prompt, dilate, rel)
        a = np.asarray(masque)
        couverture = 100.0 * float((a > 127).sum()) / float(max(1, a.size))
        if couverture < 0.2:
            raise ValueError("« %s » introuvable sur l'image." % (noun or prompt))

    out = recolor_hsv_masked(travail, masque, color_spec, strength)
    return out.resize((ow, oh), Image.LANCZOS), couverture
