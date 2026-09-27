"""Captures Microsoft Store (1920 x 1080 PNG) composees a partir des images du
site vitrine (docs/screenshots/v2). Les images du site sont petites (<= 1280 px) :
on les pose en cadre, agrandies de 1,5x au plus, sur un fond aux couleurs du
site, au lieu de les etirer plein ecran (flou)."""
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

RACINE = 'C:/Users/Utilisateur/Desktop/FabWare/MeshyMyself'
SRC = RACINE + '/docs/screenshots/v2/'
OUT = RACINE + '/build/marketing/store-screenshots/2026-09-27-site/'
os.makedirs(OUT, exist_ok=True)

W, H = 1920, 1080
FOND = (11, 11, 20)
CARTE = (19, 19, 29)
BORD = (42, 42, 64)
TEXTE = (245, 245, 250)
POLICE = 'C:/Windows/Fonts/segoeuib.ttf'


def fond():
    im = Image.new('RGB', (W, H), FOND)
    halo = Image.new('RGB', (W, H), FOND)
    d = ImageDraw.Draw(halo)
    d.ellipse((W * 0.15, -H * 0.35, W * 0.85, H * 0.55), fill=(56, 22, 70))
    return Image.blend(im, halo.filter(ImageFilter.GaussianBlur(220)), 0.55)


def arrondi(im, r):
    m = Image.new('L', im.size, 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, im.size[0] - 1, im.size[1] - 1), r, fill=255)
    return m


def poser(canvas, im, cx, cy, r=16, bord=True):
    """Pose `im` centree en (cx, cy) avec ombre, coins arrondis et filet."""
    x, y = int(cx - im.size[0] / 2), int(cy - im.size[1] / 2)
    ombre = Image.new('L', (im.size[0] + 120, im.size[1] + 120), 0)
    ImageDraw.Draw(ombre).rounded_rectangle((60, 70, im.size[0] + 60, im.size[1] + 70), r, fill=150)
    ombre = ombre.filter(ImageFilter.GaussianBlur(28))
    canvas.paste((0, 0, 0), (x - 60, y - 60), ombre)
    canvas.paste(im, (x, y), arrondi(im, r))
    if bord:
        ImageDraw.Draw(canvas).rounded_rectangle((x, y, x + im.size[0] - 1, y + im.size[1] - 1), r, outline=BORD, width=2)


def ajuster(im, max_w, max_h, max_up=1.5):
    k = min(max_w / im.size[0], max_h / im.size[1], max_up)
    return im.resize((round(im.size[0] * k), round(im.size[1] * k)), Image.LANCZOS)


def simple(nom_src, sortie, max_w=1700, max_h=940):
    c = fond()
    im = ajuster(Image.open(SRC + nom_src).convert('RGB'), max_w, max_h)
    poser(c, im, W / 2, H / 2)
    c.save(OUT + sortie, optimize=True)
    return sortie, im.size


def etapes(sources, sortie):
    """Rangee de cartes comme la section « How it works » du site."""
    COULEURS = [(74, 144, 226), (195, 92, 224), (240, 138, 36), (34, 197, 94)]
    NOMS = ['Image', '3D Mesh', 'Rig', 'Animation']
    police = ImageFont.truetype(POLICE, 34)
    petite = ImageFont.truetype(POLICE, 22)
    c = fond()
    n = len(sources)
    gap = 36
    cw = min(420, (W - 160 - gap * (n - 1)) // n)
    ih = int(cw * 0.95)
    ch = ih + 110
    x0 = (W - (n * cw + (n - 1) * gap)) // 2
    y0 = (H - ch) // 2
    for i, src in enumerate(sources):
        x = x0 + i * (cw + gap)
        carte = Image.new('RGB', (cw, ch), CARTE)
        d = ImageDraw.Draw(carte)
        d.rectangle((0, 0, cw, 6), fill=COULEURS[i])
        zone = Image.new('RGB', (cw, ih), (28, 28, 40))
        im = Image.open(SRC + src).convert('RGB')
        k = min(cw / im.size[0], ih / im.size[1])
        im = im.resize((round(im.size[0] * k), round(im.size[1] * k)), Image.LANCZOS)
        zone.paste(im, ((cw - im.size[0]) // 2, (ih - im.size[1]) // 2))
        carte.paste(zone, (0, 6))
        cx, cy = 44, ih + 6 + 52
        d.ellipse((cx - 22, cy - 22, cx + 22, cy + 22), outline=COULEURS[i], width=4)
        d.text((cx, cy + 1), str(i + 1), font=petite, fill=COULEURS[i], anchor='mm')
        d.text((cx + 40, cy), NOMS[i], font=police, fill=TEXTE, anchor='lm')
        ombre = Image.new('L', (cw + 100, ch + 100), 0)
        ImageDraw.Draw(ombre).rounded_rectangle((50, 60, cw + 50, ch + 60), 16, fill=140)
        c.paste((0, 0, 0), (x - 50, y0 - 50), ombre.filter(ImageFilter.GaussianBlur(24)))
        c.paste(carte, (x, y0), arrondi(carte, 16))
        ImageDraw.Draw(c).rounded_rectangle((x, y0, x + cw - 1, y0 + ch - 1), 16, outline=BORD, width=2)
    c.save(OUT + sortie, optimize=True)
    return sortie, (cw, ch)


def empile(sources, sortie, max_w=1500, max_h=940):
    """Deux images l'une sous l'autre (creation puis lecture d'une animation)."""
    ims = [Image.open(SRC + s).convert('RGB') for s in sources]
    largeur = max(i.size[0] for i in ims)
    hauteur = sum(i.size[1] for i in ims) + 24 * (len(ims) - 1)
    bloc = Image.new('RGB', (largeur, hauteur), FOND)
    y = 0
    for i in ims:
        bloc.paste(i, ((largeur - i.size[0]) // 2, y)); y += i.size[1] + 24
    c = fond()
    poser(c, ajuster(bloc, max_w, max_h), W / 2, H / 2, bord=False)
    c.save(OUT + sortie, optimize=True)
    return sortie, bloc.size


faits = [
    simple('hero.jpg', '01_accueil.png'),
    etapes(['etape1-image.jpg', 'etape2-3d.jpg', 'etape3-rig.jpg', 'etape4-animation.jpg'], '02_etapes_araignee.png'),
    etapes(['guerrier-image.jpg', 'etape-3d.jpg', 'etape-rig.jpg'], '03_etapes_guerrier.png'),
    simple('outils-image.jpg', '04_outils_image.png'),
    simple('outils-3d.jpg', '05_outils_3d.png'),
    simple('reglages-3d.jpg', '06_reglages_3d.png'),
    simple('rig-araignee.jpg', '07_rig_araignee.png'),
    simple('projets.jpg', '08_projets.png'),
    empile(['anim-creer.jpg', 'anim-lecture.jpg'], '09_animation.png'),
]
for f, t in faits:
    s = os.path.getsize(OUT + f)
    print(f, t, round(s / 1e6, 2), 'Mo')
