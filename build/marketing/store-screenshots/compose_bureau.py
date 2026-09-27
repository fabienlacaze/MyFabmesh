"""Captures Microsoft Store de l'APPLI WINDOWS (1920 x 1080 PNG), 28/09/2026.

Le jeu 2026-09-27-site reprenait les images du site, prises dans l'appli WEB :
pastilles de credits partout, alors que l'appli Windows en mode local n'en
affiche aucune (remarque du user). Les vues avec outils (04, 05, 06, 07, 09)
sont refaites depuis l'appli de bureau (projet « red_killing_spider »,
captures dans bureau_sources/, prises via le port de debogage d'Electron) ;
01, 02, 03 et 08 n'ont pas de credits et sont reprises du jeu precedent.

Usage : python build/marketing/store-screenshots/compose_bureau.py
"""
import os
import shutil
from PIL import Image, ImageDraw, ImageFilter

ICI = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ICI, 'bureau_sources') + os.sep
AVANT = os.path.join(ICI, '2026-09-27-site') + os.sep
OUT = os.path.join(ICI, '2026-09-28-bureau') + os.sep
os.makedirs(OUT, exist_ok=True)

W, H = 1920, 1080
FOND = (11, 11, 20)
BORD = (42, 42, 64)


def fond():
    im = Image.new('RGB', (W, H), FOND)
    halo = Image.new('RGB', (W, H), FOND)
    ImageDraw.Draw(halo).ellipse((W * 0.15, -H * 0.35, W * 0.85, H * 0.55), fill=(56, 22, 70))
    return Image.blend(im, halo.filter(ImageFilter.GaussianBlur(220)), 0.55)


def arrondi(im, r):
    m = Image.new('L', im.size, 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, im.size[0] - 1, im.size[1] - 1), r, fill=255)
    return m


def poser(canvas, im, cx, cy, r=16):
    x, y = int(cx - im.size[0] / 2), int(cy - im.size[1] / 2)
    ombre = Image.new('L', (im.size[0] + 120, im.size[1] + 120), 0)
    ImageDraw.Draw(ombre).rounded_rectangle((60, 70, im.size[0] + 60, im.size[1] + 70), r, fill=150)
    canvas.paste((0, 0, 0), (x - 60, y - 60), ombre.filter(ImageFilter.GaussianBlur(28)))
    canvas.paste(im, (x, y), arrondi(im, r))
    ImageDraw.Draw(canvas).rounded_rectangle((x, y, x + im.size[0] - 1, y + im.size[1] - 1), r, outline=BORD, width=2)


def ajuster(im, max_w, max_h, max_up=1.6):
    k = min(max_w / im.size[0], max_h / im.size[1], max_up)
    return im.resize((round(im.size[0] * k), round(im.size[1] * k)), Image.LANCZOS)


def simple(im, sortie, max_w=1700, max_h=940):
    c = fond()
    im = ajuster(im.convert('RGB'), max_w, max_h)
    poser(c, im, W / 2, H / 2)
    c.save(OUT + sortie, optimize=True)
    return sortie, im.size


faits = []
for f in ('01_accueil.png', '02_etapes_araignee.png', '03_etapes_guerrier.png', '08_projets.png'):
    shutil.copyfile(AVANT + f, OUT + f)
    faits.append((f, 'repris'))
faits.append(simple(Image.open(SRC + 'outils-image.png'), '04_outils_image.png'))
faits.append(simple(Image.open(SRC + 'outils-3d.png'), '05_outils_3d.png'))
faits.append(simple(Image.open(SRC + 'reglages-3d.png'), '06_reglages_3d.png'))
# editeur des points : vue de droite + panneau (la fenetre entiere rendait le texte illisible)
rig = Image.open(SRC + '_rig_plein_ecran.png').crop((1090, 0, 2560, 1000))
faits.append(simple(rig, '07_rig_araignee.png'))
faits.append(simple(Image.open(SRC + 'anim-lecture.png'), '09_animation.png'))
for f, t in faits:
    print(f, t, round(os.path.getsize(OUT + f) / 1e6, 2), 'Mo')
