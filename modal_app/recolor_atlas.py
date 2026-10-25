"""Recolorier la TEXTURE d'un maillage 3D (25/10, demande du user : « les memes boutons que Recolorier pour le 3D »).

Noyau PARTAGE : scripts/recolor_atlas.py = modal_app/recolor_atlas.py (octet pour octet, surveille par build/check-noyaux-partages.mjs).
Pur numpy / PIL, aucun GPU, deterministe.

Principe (comme « Recolorier » de l'image : « toute l'image est teintee, eclairage conserve ») : la LUMINANCE de chaque texel est gardee, la
couleur est remplacee par la couleur choisie ; l'intensite melange le resultat avec l'original. Un masque (atlas UV, blanc = zone) limite
l'effet a une partie, avec un bord adouci pour ne pas laisser de couture.
"""
import numpy as np
from PIL import Image, ImageFilter


def couleur_depuis_hex(hexa):
    """'#rrggbb' (ou 'rrggbb') -> (r, g, b) entiers 0-255 ; texte invalide -> ValueError."""
    h = str(hexa or '').strip().lstrip('#')
    if len(h) == 3:
        h = ''.join(c * 2 for c in h)
    if len(h) != 6:
        raise ValueError('couleur invalide : attendu #rrggbb')
    try:
        return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        raise ValueError('couleur invalide : attendu #rrggbb')


def recolorer_image(img, couleur, intensite=1.0, masque=None, adoucir=3):
    """img : PIL.Image (RGB / RGBA) ; couleur : '#rrggbb' ou (r, g, b) ; intensite : 0..1 ; masque : PIL.Image « L » / ndarray (H, W) de meme
    taille (255 = recolorier) ou None (tout). Rend une PIL.Image de meme mode et de meme taille (l'alpha est conserve)."""
    if not isinstance(couleur, str) and not (isinstance(couleur, (tuple, list)) and len(couleur) == 3):
        raise ValueError('couleur invalide : attendu #rrggbb')
    r, g, b = couleur_depuis_hex(couleur) if isinstance(couleur, str) else tuple(int(c) for c in couleur)
    k = float(np.clip(intensite, 0.0, 1.0))
    base = img.convert('RGBA')
    a = np.asarray(base).astype(np.float32)
    rgb = a[..., :3] / 255.0
    lum = (0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2])[..., None]
    cible = np.array([r, g, b], dtype=np.float32) / 255.0
    lum_c = float(0.2126 * cible[0] + 0.7152 * cible[1] + 0.0722 * cible[2])
    # la teinte garde la lumiere d'origine : texel sombre = teinte sombre. Plancher pour une cible tres sombre (division).
    teinte = np.clip(lum * (cible / max(lum_c, 0.08)), 0.0, 1.0)
    poids = np.full(lum.shape, k, dtype=np.float32)
    if masque is not None:
        if isinstance(masque, np.ndarray):
            m = Image.fromarray((masque > 0).astype(np.uint8) * 255, 'L') if masque.dtype != np.uint8 else Image.fromarray(masque, 'L')
        else:
            m = masque.convert('L')
        if m.size != base.size:
            m = m.resize(base.size, Image.NEAREST)
        if adoucir and adoucir > 0:
            m = m.filter(ImageFilter.GaussianBlur(float(adoucir)))
        poids = poids * (np.asarray(m).astype(np.float32) / 255.0)[..., None]
    sortie = rgb * (1.0 - poids) + teinte * poids
    a[..., :3] = np.clip(sortie * 255.0 + 0.5, 0, 255)
    res = Image.fromarray(a.astype(np.uint8), 'RGBA')
    return res if img.mode == 'RGBA' else res.convert(img.mode if img.mode in ('RGB', 'L') else 'RGB')
