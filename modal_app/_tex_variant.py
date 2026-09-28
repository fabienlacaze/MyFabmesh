"""Variante de texture a structure verrouillee — portage Modal.

Portage de `do_tex_variant` (scripts/sdxl_server.py). ControlNet-Tile tient la
GEOMETRIE : l'image d'origine sert d'image de controle, donc la silhouette ne
bouge pas, seule la surface est reengendree.

C'est la brique qui manquait cote cloud. Elle debloque a elle seule :
  - « Age » (l'outil appelait /tex_variant avec un prompt d'age et un
    conditionnement bas, pour laisser les PROPORTIONS glisser) ;
  - le chemin MATIERE de Recolorier (« rusty metal »), qui tombait jusqu'ici
    en 422 faute de Tile ;
  - les variantes de texture des outils mesh.

PARITE DES REGLAGES. Les nombres ci-dessous sont recopies un a un de la
fonction bureau : 28 pas, guidance 7.5, force bornee a [0.35, 0.9],
conditionnement borne a [0.1, 0.95], et le meme prompt negatif. Les changer
d'un seul cote ferait diverger le rendu entre bureau et web sans que rien ne
le signale — c'est exactement le defaut u2net/Lucida.
"""
from PIL import Image

#: Recopie mot pour mot de scripts/sdxl_server.py (do_tex_variant).
PROMPT_DEFAUT = ('high quality, detailed, sharp focus, intricate textures, '
                 'game asset')
NEGATIF_DEFAUT = ('deformed, distorted, changed shape, different pose, '
                  'extra parts, missing parts, blurry, low quality')
PAS = 28
GUIDANCE = 7.5
FORCE_MIN, FORCE_MAX = 0.35, 0.9
COND_MIN, COND_MAX = 0.1, 0.95


def _taille_travail(w, h, maxi=1024):
    """Meme reduction que resize_for_sdxl cote bureau : grand cote a `maxi`,
    dimensions alignees sur 8."""
    if max(w, h) > maxi:
        if w > h:
            w, h = maxi, int(h * maxi / w)
        else:
            h, w = maxi, int(w * maxi / h)
    return max(8, (w // 8) * 8), max(8, (h // 8) * 8)


def _masque_fond(img):
    """Fond d'un asset : zone CLAIRE et NEUTRE reliee aux bords de l'image (blanc ou gris de studio,
    degrade compris). None si l'image n'a pas un tel fond (scene, paysage)."""
    import numpy as np
    try:
        from scipy import ndimage
    except Exception:
        return None
    a = np.asarray(img.convert('RGB'), dtype=np.float32)
    neutre = (a.mean(axis=2) > 150) & ((a.max(axis=2) - a.min(axis=2)) < 15)
    lab, n = ndimage.label(neutre)
    if not n:
        return None
    bords = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    fond = np.isin(lab, bords[bords > 0])
    if fond.mean() < 0.15:                      # pas un fond d'asset
        return None
    fond = ndimage.binary_erosion(fond, iterations=2)
    return ndimage.gaussian_filter(fond.astype(np.float32), 1.5)[..., None]


def _garder_fond(source, sortie):
    """Recolle le fond de la source sur la variante (meme taille) : la teinte demandee ne colore
    plus le fond (beige pour « golden brown », taches semees autour du modele — mesure au banc)."""
    import numpy as np
    m = _masque_fond(source)
    if m is None:
        return sortie
    a = np.asarray(source.convert('RGB'), dtype=np.float32)
    o = np.asarray(sortie.convert('RGB'), dtype=np.float32)
    return Image.fromarray(np.clip(o * (1 - m) + a * m, 0, 255).astype(np.uint8))


def _desaturer(img, gris):
    """Melange l'image avec sa version en niveaux de gris (gris = 0 : intacte, 1 : grise)."""
    if gris <= 0:
        return img
    return Image.blend(img, img.convert('L').convert('RGB'), float(min(1.0, gris)))


def generate(pipe, source_img, prompt='', strength=0.45, seed=0,
             cn_scale=0.45, neg_prompt=None, max_dim=1024, gris=0.0):
    """Retourne une image PIL a la taille de la source.

    `cn_scale` est le levier important : HAUT tient la silhouette (variante de
    texture, vieillissement leger), BAS laisse les proportions bouger (un lion
    adulte vers un lionceau, grosse tete et pattes courtes).
    """
    import torch

    img = source_img.convert('RGB')
    taille_origine = img.size
    w, h = _taille_travail(*taille_origine, maxi=max_dim)
    travail = img.resize((w, h), Image.LANCZOS)
    # GRIS (2026-09-28, user : « variant ne change pas assez la texture a fond ») : ControlNet-Tile
    # recopie aussi les COULEURS de son image de controle ; a forte variation, controle et depart
    # sont desatures — forme et details tenus, couleurs liberees. 0 = comportement d'origine
    # (Age, Recolorier ne le passent pas).
    source_travail = travail
    travail = _desaturer(travail, float(gris or 0))

    p = (prompt or '').strip() or PROMPT_DEFAUT
    with torch.inference_mode():
        out = pipe(
            prompt=p,
            negative_prompt=neg_prompt or NEGATIF_DEFAUT,
            image=travail,
            control_image=travail,
            strength=float(max(FORCE_MIN, min(FORCE_MAX, strength))),
            num_inference_steps=PAS,
            guidance_scale=GUIDANCE,
            controlnet_conditioning_scale=float(max(COND_MIN, min(COND_MAX, cn_scale))),
            generator=torch.Generator('cuda').manual_seed(int(seed)),
        ).images[0]

    if gris:
        out = _garder_fond(source_travail, out)          # forme verrouillee : le fond de la source
    if out.size != taille_origine:
        out = out.resize(taille_origine, Image.LANCZOS)
    return out
