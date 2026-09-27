"""Genere TOUTES les declinaisons du logo a partir de l'image choisie par le user
(logo_gemini_source.png, 964 x 1024, generee par Gemini le 27/09/2026).

Regle : en petit, on n'utilise que le SYMBOLE (le maillage de noeuds et le
monogramme), jamais le texte « myfabmesh.Ai » de l'image, illisible et mal
casse (la marque s'ecrit « MyFabmesh.AI »). Le nom est ecrit a cote en texte.

Usage : python build/marketing/logo/generer_logos.py   (depuis la racine du depot)
"""
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

RACINE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
ICI = os.path.dirname(os.path.abspath(__file__))
SRC = Image.open(os.path.join(ICI, 'logo_gemini_source.png')).convert('RGB')
SYMBOLE = SRC.crop((150, 105, 830, 785))            # 680 x 680, symbole seul sur le bois sombre
FOND = (11, 11, 20)
ROSE, VIOLET = (233, 69, 96), (168, 85, 247)


def chemin(*p):
    c = os.path.join(RACINE, *p)
    os.makedirs(os.path.dirname(c), exist_ok=True)
    return c


def carre(t):
    return SYMBOLE.resize((t, t), Image.LANCZOS).convert('RGBA')


def arrondi(t, rayon=0.2):
    """Symbole a coins arrondis sur fond transparent (icones, favicons)."""
    S = t * 4
    im = SYMBOLE.resize((S, S), Image.LANCZOS).convert('RGBA')
    m = Image.new('L', (S, S), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, S - 1, S - 1), int(S * rayon), fill=255)
    im.putalpha(m)
    return im.resize((t, t), Image.LANCZOS)


def large(w, h, taille_symbole):
    """Symbole centre sur la couleur du bois sombre de la plaque (un fond flou
    etirait les noeuds colores en taches sur les cotes)."""
    zone = SRC.crop((95, 300, 195, 600)).resize((1, 1), Image.BOX).getpixel((0, 0))
    fond = Image.new('RGBA', (w, h), tuple(zone) + (255,))
    s = carre(taille_symbole)
    fond.alpha_composite(s, ((w - taille_symbole) // 2, (h - taille_symbole) // 2))
    return fond


faits = []


def ecrire(im, *p):
    c = chemin(*p)
    im.save(c, optimize=True)
    faits.append((os.path.relpath(c, RACINE), im.size))


# --- Appli Windows : fenetre, barre des taches, installeur ------------------
ecrire(arrondi(256), 'icon.png')
ico = arrondi(256)
ico.save(chemin('icon.ico'), sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
faits.append(('icon.ico', '16..256'))

# --- Paquet Store (tuiles Windows, carrees pleines) --------------------------
for dossier in ('build', os.path.join('build', 'appx')):
    for nom, t in (('Square44x44Logo', 44), ('Square71x71Logo', 71), ('Square150x150Logo', 150),
                   ('Square310x310Logo', 310), ('StoreLogo', 50)):
        ecrire(carre(t), dossier, nom + '.png')
    ecrire(large(310, 150, 150), dossier, 'Wide310x150Logo.png')
    splash = Image.new('RGBA', (620, 300), (0, 0, 0, 0))
    s = arrondi(250, 0.16)
    splash.alpha_composite(s, ((620 - 250) // 2, (300 - 250) // 2))
    ecrire(splash, dossier, 'SplashScreen.png')

# --- Symbole des en-tetes (a cote du nom, affiche ~1,3 em, net en retina) ----
for p in (('docs', 'logo-symbole.png'), ('cloud', 'public', 'logo-symbole.png'),
          ('src', 'renderer', 'logo-symbole.png')):
    ecrire(arrondi(96), *p)

# --- Favicons ------------------------------------------------------------------
ecrire(arrondi(64), 'docs', 'favicon.png')
ecrire(arrondi(64), 'cloud', 'public', 'favicon.png')
arrondi(48).save(chemin('cloud', 'public', 'favicon.ico'), sizes=[(16, 16), (32, 32), (48, 48)])
faits.append(('cloud/public/favicon.ico', '16..48'))
ecrire(arrondi(256), 'cloud', 'src', 'app', 'icon.png')         # pages Next.js (icone automatique)

# --- Apercu des liens partages (site) : 1200 x 630 ------------------------------
police = os.path.join(ICI, 'Sora.ttf')
og = Image.new('RGBA', (1200, 630), FOND + (255,))
halo = Image.new('RGBA', (1200, 630), (0, 0, 0, 0))
ImageDraw.Draw(halo).ellipse((-120, 20, 620, 700), fill=(110, 40, 140, 160))
og.alpha_composite(halo.filter(ImageFilter.GaussianBlur(120)))
og.alpha_composite(arrondi(400, 0.12), (90, 115))
d = ImageDraw.Draw(og)
f = ImageFont.truetype(police, 76); f.set_variation_by_name('ExtraBold')
x, y = 560, 215
d.text((x, y), 'MyFabmesh', font=f, fill=(245, 245, 250))
w = int(f.getlength('MyFabmesh'))
wa = int(f.getlength('.AI'))
m = Image.new('L', (wa + 4, 110), 0)
ImageDraw.Draw(m).text((0, 0), '.AI', font=f, fill=255)
grad = Image.linear_gradient('L').rotate(90).resize((wa + 4, 110))   # rose -> violet sur les 3 lettres
coul = Image.composite(Image.new('RGBA', (wa + 4, 110), VIOLET + (255,)), Image.new('RGBA', (wa + 4, 110), ROSE + (255,)), grad)
og.paste(coul, (x + w, y), m)
f2 = ImageFont.truetype(police, 34); f2.set_variation_by_name('Regular')
d.text((x + 4, y + 110), 'From an idea to a', font=f2, fill=(194, 194, 212))
d.text((x + 4, y + 156), 'game-ready 3D model', font=f2, fill=(194, 194, 212))
ecrire(og.convert('RGB'), 'docs', 'og-image.png')

for c, t in faits:
    print(c, t)
