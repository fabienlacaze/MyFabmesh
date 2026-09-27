"""Filigrane des apercus payants de la Marketplace (2026-09-27, user : « le logo
+ le nom, il est blanc et rose, ca ne pourra pas se rater »).

Symbole arrondi + « MyFabmesh » en blanc + « .AI » en degrade rose -> violet,
contour sombre pour rester lisible sur une texture claire. Fond transparent.

Sorties :
  build/marketing/logo/filigrane.png   (controle visuel)
  modal_app/_filigrane.py              (PNG en base64 : l'image Modal n'embarque
                                        que les sources Python de modal_app)

Usage : python build/marketing/logo/generer_filigrane.py   (depuis la racine)
"""
import base64
import io
import os

from PIL import Image, ImageDraw, ImageFont

ICI = os.path.dirname(os.path.abspath(__file__))
RACINE = os.path.abspath(os.path.join(ICI, '..', '..', '..'))
SRC = Image.open(os.path.join(ICI, 'logo_gemini_source.png')).convert('RGB')
SYMBOLE = SRC.crop((150, 105, 830, 785))
ROSE, VIOLET = (233, 69, 96), (168, 85, 247)
CONTOUR = (11, 11, 20)
H = 120                                   # hauteur du symbole


def arrondi(t, rayon=0.22):
    S = t * 4
    im = SYMBOLE.resize((S, S), Image.LANCZOS).convert('RGBA')
    m = Image.new('L', (S, S), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, S - 1, S - 1), int(S * rayon), fill=255)
    im.putalpha(m)
    return im.resize((t, t), Image.LANCZOS)


f = ImageFont.truetype(os.path.join(ICI, 'Sora.ttf'), 78)
f.set_variation_by_name('ExtraBold')
EP = 3                                    # contour fin : reduit a la taille d'une texture, un contour epais noyait les lettres blanches
w1 = int(f.getlength('MyFabmesh'))
w2 = int(f.getlength('.AI'))
marge = 28
W = H + marge + w1 + w2 + 2 * EP + 8
fil = Image.new('RGBA', (W, H + 8), (0, 0, 0, 0))
fil.alpha_composite(arrondi(H), (0, 4))

x0, y0 = H + marge, (H + 8 - 100) // 2 - 6
d = ImageDraw.Draw(fil)
# contour de tout le mot, puis « MyFabmesh » en blanc
d.text((x0, y0), 'MyFabmesh.AI', font=f, fill=CONTOUR, stroke_width=EP, stroke_fill=CONTOUR)
d.text((x0, y0), 'MyFabmesh', font=f, fill=(250, 250, 255))
# « .AI » en degrade rose -> violet
m = Image.new('L', (w2 + 4, H + 8), 0)
ImageDraw.Draw(m).text((0, y0), '.AI', font=f, fill=255)
grad = Image.linear_gradient('L').rotate(90).resize((w2 + 4, H + 8))
coul = Image.composite(Image.new('RGBA', (w2 + 4, H + 8), VIOLET + (255,)),
                       Image.new('RGBA', (w2 + 4, H + 8), ROSE + (255,)), grad)
fil.paste(coul, (x0 + w1, 0), m)

fil = fil.crop(fil.getbbox())
fil.save(os.path.join(ICI, 'filigrane.png'), optimize=True)

buf = io.BytesIO()
fil.save(buf, 'PNG', optimize=True)
b64 = base64.b64encode(buf.getvalue()).decode('ascii')
lignes = [b64[i:i + 100] for i in range(0, len(b64), 100)]
with io.open(os.path.join(RACINE, 'modal_app', '_filigrane.py'), 'w', encoding='utf-8', newline='\n') as out:
    out.write('"""Filigrane (logo + nom MyFabmesh.AI) des apercus payants de la Marketplace.\n\n'
              'GENERE par build/marketing/logo/generer_filigrane.py — ne pas modifier a la main.\n'
              'PNG en base64 : l\'image Modal n\'embarque que les sources Python de modal_app."""\n\n'
              'FILIGRANE_PNG_B64 = (\n')
    for l in lignes:
        out.write("    '%s'\n" % l)
    out.write(')\n')
print('filigrane', fil.size, len(buf.getvalue()), 'octets')
