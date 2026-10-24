# -*- coding: utf-8 -*-
"""Substituts PUR TORCH de `timm` et `kornia` pour le code distant de Lucida (2026-10-03).

POURQUOI. Lucida (egeorcun/lucida, MIT, fine-tune de BiRefNet) se charge par du code distant
(`trust_remote_code`). Ce code commence par deux imports qui n'ont rien a faire a l'inference :

    from timm.layers import DropPath, to_2tuple, trunc_normal_    (backbone Swin : profondeur
                                                                   stochastique, initialisation, tuples)
    from kornia.filters import laplacian                          (UN seul appel, en ENTRAINEMENT :
                                                                   `if self.training and self.config.out_ref`)

`transformers` verifie ces imports AVANT d'executer quoi que ce soit (`check_imports`) et refuse tout le
chargement : « This modeling file requires the following packages that were not found in your
environment: kornia, timm ». Dans le Python de l'appli kornia est absent et sa DLL (kornia_rs) est bloquee
par Smart App Control, qu'il ne faut JAMAIS contourner (meme symptome que scripts/trellis2_sans_detourage.py
pour le detoureur de TRELLIS-2). Resultat : Lucida, qui recupere 99,99 % des armes de l'orc la ou u2net n'en
garde que 10 % (audit de fidelite du 2026-10-03), etait inaccessible.

CE QUE FAIT CE MODULE. Il ecrit en PUR TORCH (aucune DLL, rien que Smart App Control puisse bloquer) les
quatre objets que le code de Lucida emprunte, et `installer()` les enregistre dans `sys.modules` sous les
noms `timm`, `timm.layers`, `kornia`, `kornia.filters` UNIQUEMENT quand le vrai paquet ne s'importe pas.
Le vrai paquet gagne TOUJOURS : s'il s'importe (et fournit ces objets), `installer()` n'y touche pas.

  * DropPath / drop_path : profondeur stochastique, meme semantique que timm 1.0 (identite hors
    entrainement ou si drop_prob vaut 0 ; sinon un masque de Bernoulli PAR ECHANTILLON, les survivants
    etant mis a l'echelle par 1 / keep_prob) ;
  * to_2tuple : un scalaire devient (x, x), un iterable devient un tuple (une chaine reste un scalaire) ;
  * trunc_normal_ : loi normale tronquee a [a, b] (bornes ABSOLUES, pas en ecarts-types), sur place ;
  * laplacian : reproduction de kornia 0.8 (`kornia.filters.laplacian`) : noyau k x k rempli de 1 dont le
    centre vaut 1 - k*k, divise par la somme de ses valeurs absolues si `normalized`, remplissage de
    k // 2 pixels (reflect par defaut), convolution PAR CANAL. Reference lue dans kornia/filters/laplacian.py,
    kernels.py (get_laplacian_kernel2d, normalize_kernel2d) et filter.py (filter2d, _compute_padding).

Les substituts portent la marque MARQUE (attribut de module) : on sait toujours lequel est en place.
Ils ont un vrai `__spec__`, pour que `importlib.util.find_spec('timm')` (que `transformers` appelle) ne
leve pas.

Diagnostic :  <python de l'appli> scripts/lucida_shims.py   (affiche ce que installer() a choisi)
"""
import collections.abc
import importlib
import importlib.machinery
import sys
import types

import torch
import torch.nn as nn
import torch.nn.functional as F

MARQUE = '__fabmesh_substitut_pur_torch__'

_BORDURES = ('constant', 'reflect', 'replicate', 'circular')


# ---------------------------------------------------------------------------
# timm.layers
# ---------------------------------------------------------------------------
def to_2tuple(x):
    """Iterable -> tuple ; scalaire (chaine comprise) -> (x, x). Comme timm.layers.to_2tuple."""
    if isinstance(x, collections.abc.Iterable) and not isinstance(x, str):
        return tuple(x)
    return (x, x)


def trunc_normal_(tensor, mean=0., std=1., a=-2., b=2.):
    """Remplit `tensor` (sur place) d'une loi normale(mean, std) tronquee a [a, b] ; rend `tensor`.

    a et b sont des bornes ABSOLUES, comme dans timm. Le tirage est celui de torch.nn.init.trunc_normal_ (le
    meme que timm : uniforme -> erfinv -> mise a l'echelle -> clamp), valable sur un Parameter et sur le
    peripherique `meta`.

    `transformers` remplace torch.nn.init.* par des fonctions VIDES pendant `from_pretrained` (les poids sont lus
    ensuite) : le tirage est alors saute et cette fonction vide rend None. On rend donc toujours `tensor`
    nous-memes, comme timm, sans dependre de la valeur de retour de torch."""
    nn.init.trunc_normal_(tensor, mean=mean, std=std, a=a, b=b)
    return tensor


def drop_path(x, drop_prob=0., training=False, scale_by_keep=True):
    """Profondeur stochastique PAR ECHANTILLON (axe 0), comme timm.layers.drop_path."""
    if drop_prob == 0. or not training:
        return x
    keep_prob = 1 - drop_prob
    forme = (x.shape[0],) + (1,) * (x.ndim - 1)          # tout nombre de dimensions, pas seulement 4
    masque = x.new_empty(forme).bernoulli_(keep_prob)
    if keep_prob > 0.0 and scale_by_keep:
        masque.div_(keep_prob)
    return x * masque


class DropPath(nn.Module):
    """Module de profondeur stochastique : identite en evaluation (c'est le seul cas de l'inference)."""

    def __init__(self, drop_prob=0., scale_by_keep=True):
        super().__init__()
        self.drop_prob = drop_prob
        self.scale_by_keep = scale_by_keep

    def forward(self, x):
        return drop_path(x, self.drop_prob, self.training, self.scale_by_keep)

    def extra_repr(self):
        return f'drop_prob={round(self.drop_prob, 3):0.3f}'


# ---------------------------------------------------------------------------
# kornia.filters
# ---------------------------------------------------------------------------
def _taille_noyau(kernel_size):
    """(ky, kx) : un entier vaut pour les deux axes (kornia._unpack_2d_ks) ; chaque taille doit etre impaire
    et strictement positive (kornia._check_kernel_size)."""
    if isinstance(kernel_size, int):
        ky = kx = kernel_size
    else:
        if len(kernel_size) != 2:
            raise ValueError(f'la taille du noyau 2D doit avoir 2 valeurs, recu {kernel_size!r}')
        ky, kx = kernel_size
    ky, kx = int(ky), int(kx)
    for k in (ky, kx):
        if k <= 0 or k % 2 == 0:
            raise ValueError(f'la taille du noyau doit etre un entier impair strictement positif, recu {kernel_size!r}')
    return ky, kx


def laplacian(input, kernel_size, border_type='reflect', normalized=True):
    """Filtre laplacien d'un tenseur (B, C, H, W), de meme forme en sortie ; reproduit kornia.filters.laplacian.

    Noyau k x k de 1 dont le centre vaut 1 - k*k (somme nulle) ; `normalized` le divise par la somme de ses
    valeurs absolues (norme L1 egale a 1) ; remplissage de k // 2 pixels par `border_type` ('constant',
    'reflect', 'replicate' ou 'circular') ; convolution (correlation) PAR CANAL. `kernel_size` est un entier ou
    (hauteur, largeur)."""
    if not isinstance(input, torch.Tensor):
        raise TypeError(f'laplacian attend un torch.Tensor, recu {type(input).__name__}')
    if input.ndim != 4:
        raise TypeError(f'laplacian attend un tenseur (B, C, H, W), recu une forme {tuple(input.shape)}')
    bordure = str(border_type).lower()
    if bordure not in _BORDURES:
        raise ValueError(f'bordure invalide {border_type!r}, attendu l\'une de {_BORDURES}')
    ky, kx = _taille_noyau(kernel_size)
    noyau = torch.ones((ky, kx), device=input.device, dtype=input.dtype)
    noyau[ky // 2, kx // 2] = 1 - noyau.sum()
    if normalized:
        noyau = noyau / noyau.abs().sum()
    canaux = input.shape[1]
    poids = noyau.reshape(1, 1, ky, kx).repeat(canaux, 1, 1, 1)       # (C, 1, ky, kx) : un filtre par canal
    rempli = F.pad(input, (kx // 2, kx // 2, ky // 2, ky // 2), mode=bordure)    # noyaux impairs : symetrique
    return F.conv2d(rempli, poids, groups=canaux)


# ---------------------------------------------------------------------------
# Installation
# ---------------------------------------------------------------------------
def _creer_module(nom, paquet, **attributs):
    module = types.ModuleType(nom)
    module.__spec__ = importlib.machinery.ModuleSpec(nom, None, is_package=paquet)
    if paquet:
        module.__path__ = []
    module.__version__ = '0+pur-torch'
    setattr(module, MARQUE, True)
    for cle, valeur in attributs.items():
        setattr(module, cle, valeur)
    return module


def construire_timm():
    """(timm, timm.layers) : deux modules NEUFS, non enregistres."""
    layers = _creer_module('timm.layers', True, DropPath=DropPath, drop_path=drop_path,
                           to_2tuple=to_2tuple, trunc_normal_=trunc_normal_)
    return _creer_module('timm', True, layers=layers), layers


def construire_kornia():
    """(kornia, kornia.filters) : deux modules NEUFS, non enregistres."""
    filters = _creer_module('kornia.filters', True, laplacian=laplacian)
    return _creer_module('kornia', True, filters=filters), filters


# paquet -> (sous-module que le code de Lucida importe, noms qu'il y prend, constructeur du substitut)
_PAQUETS = {
    'timm': ('timm.layers', ('DropPath', 'to_2tuple', 'trunc_normal_'), construire_timm),
    'kornia': ('kornia.filters', ('laplacian',), construire_kornia),
}


def _est_substitut(paquet):
    return bool(getattr(sys.modules.get(paquet), MARQUE, False))


def _vrai_paquet_utilisable(sous_module, noms):
    """(True, '') si le VRAI paquet s'importe ET fournit ce que le code de Lucida lui prend ; sinon
    (False, raison). Toute exception compte : ImportError (paquet absent), OSError (DLL bloquee par Smart App
    Control : « une strategie de controle d'application a bloque ce fichier »), AttributeError (version trop
    ancienne)."""
    try:
        module = importlib.import_module(sous_module)
        for nom in noms:
            getattr(module, nom)
        return True, ''
    except Exception as e:
        return False, f'{type(e).__name__}: {str(e)[:160]}'


def _purger(paquet):
    """Retire de sys.modules le paquet ET ses sous-modules : un import rate laisse parfois des sous-modules
    a moitie charges, ou une entree None (paquet declare absent)."""
    for cle in [k for k in sys.modules if k == paquet or k.startswith(paquet + '.')]:
        sys.modules.pop(cle, None)


def installer(log=None):
    """Rend importables `timm.layers` et `kornia.filters` pour le code distant de Lucida.

    Pour chacun des deux paquets : le vrai paquet gagne s'il s'importe ; sinon ses restes sont purges de
    sys.modules et un substitut pur torch est enregistre. Idempotent. Rend {'timm': ..., 'kornia': ...}, chaque
    valeur valant 'reel' ou 'substitut'. A appeler AVANT `from_pretrained(..., trust_remote_code=True)`."""
    etat = {}
    for paquet, (sous_module, noms, construire) in _PAQUETS.items():
        if _est_substitut(paquet):
            etat[paquet] = 'substitut'
            continue
        ok, raison = _vrai_paquet_utilisable(sous_module, noms)
        if ok:
            etat[paquet] = 'reel'
            continue
        _purger(paquet)
        principal, sous = construire()
        sys.modules[paquet] = principal
        sys.modules[sous.__name__] = sous
        etat[paquet] = 'substitut'
        if log:
            log(f'{paquet} inutilisable ({raison}) : substitut pur torch installe')
    return etat


def main():
    import json
    print(json.dumps(installer(log=print)))


if __name__ == '__main__':
    main()
