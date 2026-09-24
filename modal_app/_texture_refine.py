"""Affinage de l'atlas par tuiles — portage Modal de scripts/texture_refine.py.

POURQUOI MAINTENANT. L'option « Detail refine » existait cote web, envoyait
son drapeau, etait FACTUREE 2 credits, et aucun code serveur ne la lisait
(audit du 2026-08-02). Elle exigeait un ControlNet-Tile que Modal n'avait
pas — jusqu'au 2026-09-24, ou il a ete ajoute pour l'outil « Age ». La
brique manquante etant la, l'option devient portable.

CE QUE FAIT L'AFFINAGE. L'atlas est decoupe en tuiles de 1024 px avec 128 px
de recouvrement ; chaque tuile repasse par SDXL a faible denoise, guidee par
ControlNet-Tile qui tient la structure ; les tuiles sont recombinees par un
masque en degrade pour qu'aucune couture n'apparaisse. SDXL invente alors du
micro-detail plausible — pores, tissage, ecailles — sans deplacer les UV ni
changer les couleurs.

PARITE DES REGLAGES. TILE, OVERLAP et la construction de la grille sont
recopies un a un du bureau. Les changer d'un seul cote ferait diverger le
rendu sans que rien ne le signale.

LIMITE CONNUE, heritee du bureau : l'affinage AIDE sur l'organique (peau,
poil, fourrure) et INVENTE de l'usure sur les surfaces lisses (carrosserie,
chrome, verre). C'est la raison d'etre de « Texture smooth », qui fait
l'inverse. Le tableau par type d'asset decide lequel est coche.
"""
import numpy as np
from PIL import Image

#: Recopies de scripts/texture_refine.py (TILE = 1024, OVERLAP = 128).
TILE = 1024
OVERLAP = 128

#: Prompt par defaut : on decrit une TEXTURE, pas une scene, sans quoi SDXL
#: essaie de composer une image et deforme l'atlas.
PROMPT_DEFAUT = ('highly detailed surface texture, fine micro-detail, sharp '
                 'material definition, consistent lighting, no seams')
NEGATIF_DEFAUT = ('blurry, smudged, washed out, different colors, text, '
                  'watermark, seams, tiling artifacts')


def _masque_degrade(largeur, hauteur, recouvrement,
                    bord_gauche, bord_haut, bord_droit, bord_bas):
    """Alpha qui s'eteint sur chaque bord RECOUVRANT et vaut 1 au centre.

    Les tuiles de bordure gardent leur cote exterieur opaque — sinon
    l'atlas s'assombrirait sur son pourtour. Recopie du bureau.
    """
    m = np.ones((hauteur, largeur), dtype=np.float32)
    if recouvrement <= 0:
        return m
    rampe = np.linspace(0, 1, recouvrement, dtype=np.float32)
    if not bord_gauche:
        m[:, :recouvrement] *= rampe[None, :]
    if not bord_droit:
        m[:, -recouvrement:] *= rampe[::-1][None, :]
    if not bord_haut:
        m[:recouvrement, :] *= rampe[:, None]
    if not bord_bas:
        m[-recouvrement:, :] *= rampe[::-1][:, None]
    return m


def _grille(taille):
    """Depart de chaque tuile, sans jamais deborder. Recopie du bureau."""
    pas = TILE - OVERLAP
    xs, x = [], 0
    while True:
        xs.append(min(x, taille - TILE))
        if x + TILE >= taille:
            break
        x += pas
    return xs


def affiner_atlas(pipe, atlas, prompt=None, strength=0.25,
                  cn_scale=0.7, seed=42, negatif=None):
    """Retourne un atlas affine, de la meme taille que l'entree.

    `pipe` est le StableDiffusionXLControlNetImg2ImgPipeline deja charge
    (MyFabmeshBackview._get_tile_pipe). Une tuile qui echoue est laissee
    TELLE QUELLE : un defaut local vaut mieux qu'un atlas perdu.
    """
    import torch

    taille_origine = atlas.size
    atlas = atlas.convert('RGB')
    cote = max(atlas.size[0], atlas.size[1], TILE)
    if atlas.size != (cote, cote):
        atlas = atlas.resize((cote, cote), Image.LANCZOS)

    source = np.asarray(atlas, dtype=np.float32)
    cumul = np.zeros_like(source)
    poids = np.zeros((cote, cote, 1), dtype=np.float32)

    xs = _grille(cote)
    ys = _grille(cote)
    p = (prompt or '').strip() or PROMPT_DEFAUT
    total = len(xs) * len(ys)
    print(f'[refine] atlas {cote}x{cote} -> {len(xs)}x{len(ys)} = {total} tuiles',
          flush=True)

    n = 0
    for iy, y in enumerate(ys):
        for ix, x in enumerate(xs):
            n += 1
            tuile = atlas.crop((x, y, x + TILE, y + TILE))
            try:
                with torch.inference_mode():
                    affinee = pipe(
                        prompt=p,
                        negative_prompt=negatif or NEGATIF_DEFAUT,
                        image=tuile,
                        control_image=tuile,
                        strength=float(max(0.05, min(0.6, strength))),
                        num_inference_steps=20,
                        guidance_scale=5.5,
                        controlnet_conditioning_scale=float(max(0.1, min(0.95, cn_scale))),
                        generator=torch.Generator('cuda').manual_seed(int(seed) + n),
                    ).images[0]
                if affinee.size != (TILE, TILE):
                    affinee = affinee.resize((TILE, TILE), Image.LANCZOS)
            except Exception as e:
                print(f'[refine] tuile {n}/{total} ECHOUE ({e}) — gardee telle quelle',
                      flush=True)
                affinee = tuile

            masque = _masque_degrade(
                TILE, TILE, OVERLAP,
                bord_gauche=(ix == 0), bord_haut=(iy == 0),
                bord_droit=(ix == len(xs) - 1), bord_bas=(iy == len(ys) - 1),
            )[..., None]
            cumul[y:y + TILE, x:x + TILE] += np.asarray(affinee, dtype=np.float32) * masque
            poids[y:y + TILE, x:x + TILE] += masque

    poids_sur = np.where(poids < 1e-6, 1.0, poids)
    sortie = np.where(poids < 1e-6, source, cumul / poids_sur)
    out = Image.fromarray(np.clip(sortie, 0, 255).astype(np.uint8))
    if out.size != taille_origine:
        out = out.resize(taille_origine, Image.LANCZOS)
    return out
