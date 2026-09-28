"""Serpent ETIRE : silhouette de depart pour l'image-vers-image (2026-09-28).

Pourquoi : un serpent genere a partir du texte seul sort ENROULE sur lui-meme, et un
maillage enroule ne s'anime pas (la colonne se touche). Mesure sur la vraie image Modal
(modal_app/test_prompts_unites.py puis test_serpent_layout.py) : aucune formulation du prompt
n'y change rien — 0 serpent etire sur 36 images, toutes avec une boucle (meme « earthworm »).
En partant de cette silhouette deja etiree (tete ovale a gauche, cou fin, corps epais au milieu,
queue effilee a droite, le long d'un S tres ouvert) et en ne debruitant qu'a 70 % : 24 sur 24
etires, tete a gauche, sans patte, sans deuxieme tete, sans boucle, rien de coupe.

MEME FICHIER dans scripts/ (bureau) et modal_app/ (cloud), surveille par
build/check-noyaux-partages.mjs. Aucune dependance autre que Pillow.
"""
import math
import random

# part du bruit ajoute a la silhouette (image-vers-image) : 0,65 et 0,70 donnent 24/24 au banc ;
# 0,80 et plus laissent revenir deux tetes ou des pattes de lezard.
FORCE_SERPENT = 0.7

# phrase propre au gabarit « sans_pattes » (index2.js / _prompts.py) : c'est elle qui declenche
# ce chemin, sur le prompt ENRICHI
MARQUE_SANS_PATTES = 'body stretched out straight'


def est_serpent(prompt, asset_type):
    """Vrai si le prompt enrichi porte le gabarit « sans pattes » d'un animal ou d'une creature."""
    return asset_type in ('animal', 'creature') and MARQUE_SANS_PATTES in str(prompt or '').lower()


def silhouette(taille=1024, teinte=(95, 105, 120), graine=0):
    """Serpent synthetique de gauche a droite le long d'un S tres ouvert (image PIL RGB, fond blanc)."""
    from PIL import Image, ImageDraw, ImageFilter
    rnd = random.Random(int(graine))
    img = Image.new('RGB', (taille, taille), (255, 255, 255))
    d = ImageDraw.Draw(img)
    x0, x1 = 0.08 * taille, 0.92 * taille
    amp, phase = 0.06 * taille * (1 + 0.3 * rnd.random()), rnd.random() * math.pi
    E = 0.034 * taille                                          # demi-epaisseur maximale du corps

    def rayon(u):
        if u < 0.035:                                           # tete : ovale
            return E * (0.95 + 0.25 * math.sin(math.pi * u / 0.035))
        if u < 0.07:                                            # cou, plus fin que la tete
            return E * 0.75
        return E * (0.75 + 0.25 * math.sin(math.pi * min(1, (u - 0.07) / 0.5))) * (1 - u) ** 0.8 + 0.004 * taille
    n = 500
    for i in range(n):
        u = i / (n - 1)
        x = x0 + (x1 - x0) * u
        y = taille * 0.5 + amp * math.sin(2 * math.pi * 1.1 * u + phase)
        r = rayon(u)
        ry = r * (0.8 if u < 0.035 else 1)
        c = tuple(int(v * (0.85 + 0.15 * math.sin(9 * u))) for v in teinte)
        d.ellipse([x - r, y - ry, x + r, y + ry], fill=c)
    return img.filter(ImageFilter.GaussianBlur(2))
