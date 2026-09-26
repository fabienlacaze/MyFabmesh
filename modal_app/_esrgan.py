"""Nettete de l'atlas par Real-ESRGAN — portage Modal de scripts/texture_upscale.py.

POURQUOI UN MODULE AUTONOME ET PAS `pip install realesrgan`. Le bureau passe
par les paquets `realesrgan` + `basicsr`. Or `basicsr` 1.4.2 importe
`torchvision.transforms.functional_tensor`, supprime depuis torchvision 0.17 ;
l'image Modal est en 0.19.1. L'import planterait a CHAQUE appel — le meme
genre d'accident que scikit-image et rembg, une dependance qui rend un outil
facture inoperant sans que rien ne le signale au deploiement.

On reprend donc les deux seules pieces utiles, a l'identique :
  * l'architecture RRDBNet de BasicSR (Apache-2.0, (c) Xintao Wang et al.,
    https://github.com/XPixelGroup/BasicSR) ;
  * la decoupe en tuiles de `RealESRGANer.tile_process` (Real-ESRGAN,
    BSD-3-Clause, https://github.com/xinntao/Real-ESRGAN).
Les poids RealESRGAN_x4plus (BSD-3) sont telecharges A LA CONSTRUCTION de
l'image et verifies par SHA-256 — la meme empreinte que le bureau.

PARITE AVEC LE BUREAU (texture_upscale.py) :
  * modele x4plus, sortie ramenee a x2 (`outscale=2`) par LANCZOS4 ;
  * tuiles de 512, marge 10, pas de pre-remplissage, demi-precision ;
  * le reseau travaille en RGB ; le bureau convertit en BGR puis
    RealESRGANer reconvertit en RGB avant le reseau — aller-retour neutre.

Pas d'hallucination : ESRGAN a appris a inverser une reduction bicubique, il
rend du piqué sans inventer de contenu. C'est la difference avec l'affinage
SDXL (« Detail refine »), qui invente de l'usure sur les surfaces lisses.
"""
import hashlib
import math
import os

import numpy as np
from PIL import Image

CHEMIN_POIDS = '/opt/esrgan/RealESRGAN_x4plus.pth'
#: Empreinte de la version officielle — identique a WEIGHTS_SHA256 du bureau.
SHA256_POIDS = '4fa0d38905f75ac06eb49a7951b426670021be3018265fd191d2125df9d682f1'
URL_POIDS = ('https://github.com/xinntao/Real-ESRGAN/releases/'
             'download/v0.1.0/RealESRGAN_x4plus.pth')

TUILE = 512
MARGE = 10
ECHELLE_RESEAU = 4

_modele = None


def _reseau():
    """RRDBNet (BasicSR), recopie sans modification de comportement."""
    import torch
    from torch import nn
    from torch.nn import functional as F

    class ResidualDenseBlock(nn.Module):
        def __init__(self, num_feat=64, num_grow_ch=32):
            super().__init__()
            self.conv1 = nn.Conv2d(num_feat, num_grow_ch, 3, 1, 1)
            self.conv2 = nn.Conv2d(num_feat + num_grow_ch, num_grow_ch, 3, 1, 1)
            self.conv3 = nn.Conv2d(num_feat + 2 * num_grow_ch, num_grow_ch, 3, 1, 1)
            self.conv4 = nn.Conv2d(num_feat + 3 * num_grow_ch, num_grow_ch, 3, 1, 1)
            self.conv5 = nn.Conv2d(num_feat + 4 * num_grow_ch, num_feat, 3, 1, 1)
            self.lrelu = nn.LeakyReLU(negative_slope=0.2, inplace=True)

        def forward(self, x):
            x1 = self.lrelu(self.conv1(x))
            x2 = self.lrelu(self.conv2(torch.cat((x, x1), 1)))
            x3 = self.lrelu(self.conv3(torch.cat((x, x1, x2), 1)))
            x4 = self.lrelu(self.conv4(torch.cat((x, x1, x2, x3), 1)))
            x5 = self.conv5(torch.cat((x, x1, x2, x3, x4), 1))
            return x5 * 0.2 + x

    class RRDB(nn.Module):
        def __init__(self, num_feat, num_grow_ch=32):
            super().__init__()
            self.rdb1 = ResidualDenseBlock(num_feat, num_grow_ch)
            self.rdb2 = ResidualDenseBlock(num_feat, num_grow_ch)
            self.rdb3 = ResidualDenseBlock(num_feat, num_grow_ch)

        def forward(self, x):
            out = self.rdb1(x)
            out = self.rdb2(out)
            out = self.rdb3(out)
            return out * 0.2 + x

    class RRDBNet(nn.Module):
        """Variante x4 uniquement : c'est le seul modele que le bureau charge."""
        def __init__(self, num_in_ch=3, num_out_ch=3, num_feat=64,
                     num_block=23, num_grow_ch=32):
            super().__init__()
            self.conv_first = nn.Conv2d(num_in_ch, num_feat, 3, 1, 1)
            self.body = nn.Sequential(*[RRDB(num_feat, num_grow_ch) for _ in range(num_block)])
            self.conv_body = nn.Conv2d(num_feat, num_feat, 3, 1, 1)
            self.conv_up1 = nn.Conv2d(num_feat, num_feat, 3, 1, 1)
            self.conv_up2 = nn.Conv2d(num_feat, num_feat, 3, 1, 1)
            self.conv_hr = nn.Conv2d(num_feat, num_feat, 3, 1, 1)
            self.conv_last = nn.Conv2d(num_feat, num_out_ch, 3, 1, 1)
            self.lrelu = nn.LeakyReLU(negative_slope=0.2, inplace=True)

        def forward(self, x):
            feat = self.conv_first(x)
            feat = feat + self.conv_body(self.body(feat))
            feat = self.lrelu(self.conv_up1(F.interpolate(feat, scale_factor=2, mode='nearest')))
            feat = self.lrelu(self.conv_up2(F.interpolate(feat, scale_factor=2, mode='nearest')))
            return self.conv_last(self.lrelu(self.conv_hr(feat)))

    return RRDBNet()


def _sha256(chemin):
    h = hashlib.sha256()
    with open(chemin, 'rb') as f:
        for bloc in iter(lambda: f.read(1 << 20), b''):
            h.update(bloc)
    return h.hexdigest()


def charger():
    """Charge le modele une fois par conteneur. Verifie l'empreinte a chaque
    chargement : un .pth est un pickle, donc du code executable."""
    global _modele
    if _modele is not None:
        return _modele
    import torch
    if not os.path.isfile(CHEMIN_POIDS):
        raise RuntimeError('poids Real-ESRGAN absents de l image (%s)' % CHEMIN_POIDS)
    obtenu = _sha256(CHEMIN_POIDS)
    if obtenu != SHA256_POIDS:
        raise RuntimeError('empreinte des poids Real-ESRGAN incorrecte : %s' % obtenu)
    # weights_only=True : le point de controle n'est qu'un dictionnaire de
    # tenseurs, on refuse tout autre objet serialise.
    etat = torch.load(CHEMIN_POIDS, map_location='cpu', weights_only=True)
    etat = etat.get('params_ema', etat.get('params', etat))
    reseau = _reseau()
    # strict=True : une architecture recopiee de travers echoue ICI, au lieu
    # de produire une image fausse.
    reseau.load_state_dict(etat, strict=True)
    reseau.eval().half().to('cuda')
    _modele = reseau
    return _modele


def affuter_atlas(img, echelle_sortie=2):
    """Atlas RGB -> atlas RGB x`echelle_sortie`. Meme calcul que
    RealESRGANer.enhance(outscale=2) du bureau."""
    import cv2
    import torch

    reseau = charger()
    rgb = np.asarray(img.convert('RGB'), dtype=np.float32) / 255.0
    h, w = rgb.shape[:2]
    entree = torch.from_numpy(np.transpose(rgb, (2, 0, 1))).unsqueeze(0).to('cuda').half()
    sortie = entree.new_zeros((1, 3, h * ECHELLE_RESEAU, w * ECHELLE_RESEAU))

    # RealESRGANer.tile_process, a l'identique.
    tuiles_x = math.ceil(w / TUILE)
    tuiles_y = math.ceil(h / TUILE)
    with torch.inference_mode():
        for ty in range(tuiles_y):
            for tx in range(tuiles_x):
                x0, y0 = tx * TUILE, ty * TUILE
                x1, y1 = min(x0 + TUILE, w), min(y0 + TUILE, h)
                x0p, x1p = max(x0 - MARGE, 0), min(x1 + MARGE, w)
                y0p, y1p = max(y0 - MARGE, 0), min(y1 + MARGE, h)
                tuile = reseau(entree[:, :, y0p:y1p, x0p:x1p])
                ox = (x0 - x0p) * ECHELLE_RESEAU
                oy = (y0 - y0p) * ECHELLE_RESEAU
                sortie[:, :, y0 * ECHELLE_RESEAU:y1 * ECHELLE_RESEAU,
                       x0 * ECHELLE_RESEAU:x1 * ECHELLE_RESEAU] = \
                    tuile[:, :, oy:oy + (y1 - y0) * ECHELLE_RESEAU,
                          ox:ox + (x1 - x0) * ECHELLE_RESEAU]

    out = sortie.squeeze(0).float().cpu().clamp_(0, 1).numpy()
    out = (np.transpose(out, (1, 2, 0)) * 255.0).round().astype(np.uint8)
    if echelle_sortie != ECHELLE_RESEAU:
        out = cv2.resize(out, (int(w * echelle_sortie), int(h * echelle_sortie)),
                         interpolation=cv2.INTER_LANCZOS4)
    try:
        del entree, sortie
        torch.cuda.empty_cache()
    except Exception:
        pass
    return Image.fromarray(out)
