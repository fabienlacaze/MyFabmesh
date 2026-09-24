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


def generate(pipe, source_img, prompt='', strength=0.45, seed=0,
             cn_scale=0.45, neg_prompt=None, max_dim=1024):
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

    if out.size != taille_origine:
        out = out.resize(taille_origine, Image.LANCZOS)
    return out
