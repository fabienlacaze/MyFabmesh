# -*- coding: utf-8 -*-
"""Chargement PARESSEUX des modeles de TRELLIS-2 (2026-09-30).

POURQUOI. `Pipeline.from_pretrained` (external/TRELLIS2_win/src/trellis2/
pipelines/base.py) construit TOUS les modeles du pipeline dans la RAM et les y
GARDE : en mode low_vram, chaque etape monte son modele sur la carte
(`model.to(device)`) puis le RENVOIE dans la RAM (`model.cpu()`). Poids mesures
sur le disque le 2026-09-30 (cache Hugging Face) : 5 transformeurs de 2,58 Go,
2 decodeurs de 0,95 Go et 0,15 Go de decodeur de structure = 14,97 Go, plus
DINOv3 (1,21 Go). C'est le « plancher ~15 Go » de l'audit du 2026-06-14, et
l'incident du 2026-09-30 : 14,2 Go deja occupes + ce plancher = 32 Go pendant
l'etape « loading_pipeline », fichier d'echange, PC au bord du gel.

CE QUE FAIT CE MODULE, sans toucher a l'arbre vendu (livre en lecture seule
dans resources/TRELLIS2_win/src). Avant `from_pretrained`, `appliquer()`
remplace la fabrique `trellis2.models.from_pretrained` par une fabrique qui ne
charge RIEN : elle resout les fichiers (meme logique que l'originale, donc le
meme repli d'un depot a l'autre) et rend un mandataire, ModeleParesseux. Le
code amont encadre deja chaque usage d'un modele par `.to(device)` ...
`.cpu()` (mode low_vram, force par les scripts) :
  - `.to(cuda)` construit le modele DIRECTEMENT SUR LA CARTE (usine par defaut
    `torch.device('cuda')`) et y lit les poids safetensors (device='cuda') ;
    la RAM ne voit passer qu'un tenseur a la fois ;
  - `.cpu()` LIBERE le modele au lieu de le recopier dans la RAM.
L'extracteur DINOv3 est traite pareil, mais rendu seulement quand le modele
suivant monte : les deux appels get_cond successifs (512 puis 1024) ne le
relisent pas.
Resultat attendu : plus aucun modele ne dort dans la RAM ; la RAM du travail =
Python + torch + CUDA + les donnees de l'etape en cours. La VRAM de pointe
d'une etape ne change pas (un modele a la fois sur la carte, comme avant) ;
la construction sur la carte passe brievement par les poids en float32 avant
leur conversion (celle de l'amont, faite ici sur la carte).
A MESURER au prochain essai reel (lignes FABMESH_MEM_ETAPE « monte ... » et
« libere ... ») : rien n'a pu tourner sur GPU le jour de l'ecriture.

MEMES CALCULS que l'amont : meme constructeur, meme conversion de type, meme
load_state_dict(strict=False) ; l'initialisation aleatoire (ensuite ecrasee
par les poids) tire dans une copie des generateurs (torch.random.fork_rng) :
le bruit des echantillonneurs est celui qu'on aurait sans ce module. VERIFIE le
2026-09-30 sur CPU (build/test_cloisonnement_memoire.py, vrai code + vrais
fichiers du cache) : from_pretrained n'engage plus rien (+0 Mo au lieu de ~16 Go)
et chaque parametre des 8 modeles est dans son fichier de poids ; seul manque
« rope_phases » du modele de structure, un tampon CALCULE par le constructeur.
Repli : si la construction sur la carte echoue (manque de VRAM transitoire,
code de modele inattendu), le modele est construit comme l'amont (en RAM),
monte sur la carte, et sa copie en RAM est rendue.

Desactivation : FABMESH_T2_PARESSEUX=0 (comportement amont : tout en RAM).
"""
import gc
import json
import os
import time

import torch
import torch.nn as nn

_log = print
_mesurer = None
# None -> la carte courante. Les tests CPU le fixent a 'cpu'.
DEVICE_CIBLE = None
# Objets a rendre quand le modele suivant monte (l'extracteur DINOv3).
_residents = []
_fabrique_amont = None
DEPOT_PAR_DEFAUT = 'microsoft/TRELLIS.2-4B'

# Attributs lus AVANT `.to(device)` par le code amont (sample_sparse_structure :
# resolution, in_channels ; sample_*_slat : in_channels). Le constructeur les
# range tels quels : on les sert depuis la configuration sans charger le modele.
ATTRIBUTS_CONFIG = ('resolution', 'in_channels', 'out_channels', 'model_channels',
                    'cond_channels', 'latent_channels')


def _classe(nom):
    """Classe de modele de trellis2.models (remplacable par les tests)."""
    import trellis2.models as tm
    return getattr(tm, nom)


def _device_cible():
    if DEVICE_CIBLE is not None:
        return torch.device(DEVICE_CIBLE)
    return torch.device('cuda', torch.cuda.current_device())


def _vider_cache(dev):
    gc.collect()
    if dev.type == 'cuda' and torch.cuda.is_available():
        torch.cuda.empty_cache()


def _noter(etape):
    if _mesurer is not None:
        try:
            _mesurer(etape)
        except Exception:
            pass


def liberer_residents(sauf=None):
    """Rend les modeles gardes « pour le prochain appel » (DINOv3)."""
    for obj in list(_residents):
        if obj is not sauf:
            _residents.remove(obj)
            obj._rendre()


def resoudre_fichiers(chemin):
    """(config .json, poids .safetensors) — meme resolution que
    trellis2.models.from_pretrained : fichiers locaux, sinon depot HF
    « a/b/nom » ou chemin relatif au depot TRELLIS.2-4B. Leve si introuvable
    (Pipeline.from_pretrained essaie alors l'autre forme du chemin)."""
    if os.path.exists(f'{chemin}.json') and os.path.exists(f'{chemin}.safetensors'):
        return f'{chemin}.json', f'{chemin}.safetensors'
    from huggingface_hub import hf_hub_download
    parts = chemin.split('/')
    if len(parts) >= 3:
        depot, nom = f'{parts[0]}/{parts[1]}', '/'.join(parts[2:])
    else:
        depot, nom = DEPOT_PAR_DEFAUT, chemin
    return hf_hub_download(depot, f'{nom}.json'), hf_hub_download(depot, f'{nom}.safetensors')


def construire(nom_classe, args, fichier_poids, chemin, dev):
    """Construit le modele sur `dev` et y lit ses poids. Rend (modele, mode)."""
    t0 = time.time()
    modele = etat = None
    erreur = None
    try:
        cls = _classe(nom_classe)
        rng = [dev.index if dev.index is not None else torch.cuda.current_device()] if dev.type == 'cuda' else []
        with torch.random.fork_rng(devices=rng):
            with dev:                         # usine par defaut (torch >= 2.0) : parametres crees sur dev
                modele = cls(**args)
        from safetensors.torch import load_file
        etat = load_file(fichier_poids, device=str(dev))
        absentes, _inattendues = modele.load_state_dict(etat, strict=False)
        del etat
        # Les blocs float32 de la construction (convertis ensuite) restent dans le cache
        # de l'allocateur : on les rend, l'etape a besoin d'une carte non fragmentee.
        _vider_cache(dev)
        mode = 'sur la carte' if dev.type == 'cuda' else f'sur {dev}'
        if absentes:
            # MESURE du 2026-09-30 (cles des 8 modeles contre leurs fichiers) : seul
            # « rope_phases » du modele de structure manque — un tampon CALCULE par le
            # constructeur (positions), pas tire au hasard : meme valeur qu'en amont.
            _log(f'[paresseux] {nom_classe} : cle(s) absente(s) du fichier, gardees telles que '
                 f'calculees par le constructeur (comme en amont) : {list(absentes)[:4]}')
    except Exception as e:
        if _fabrique_amont is None:
            raise
        erreur = f'{type(e).__name__}: {str(e)[:200]}'
    if erreur is not None:
        # Repli HORS du bloc except : l'exception (et sa pile, qui retient les tenseurs
        # a moitie construits sur la carte) est deja relachee.
        modele = etat = None
        _vider_cache(dev)
        _log(f'[paresseux] {nom_classe} : construction directe impossible ({erreur}) '
             f'-> chargement classique (RAM puis carte)')
        modele = _fabrique_amont(chemin)
        modele.to(dev)
        mode = 'RAM puis carte'
    modele.eval()
    modele.requires_grad_(False)
    _log(f'[paresseux] {nom_classe} monte {mode} en {time.time() - t0:.1f}s')
    return modele, mode


class ModeleParesseux(nn.Module):
    """Mandataire d'un modele TRELLIS-2 : charge a `.to(cuda)`, rendu a `.cpu()`.

    Sous-classe de nn.Module pour `isinstance(flow_model, nn.Module)`
    (Trellis2*Pipeline.sample_tex_slat). Tout attribut public est delegue au
    vrai modele ; ceux ecrits pendant qu'il est rendu (low_vram = False apres
    `.cpu()`) sont gardes et reappliques au prochain chargement."""

    def __init__(self, chemin, fichier_config, fichier_poids, config):
        super().__init__()
        d = self.__dict__
        d['_p_chemin'] = chemin
        d['_p_config'] = fichier_config
        d['_p_poids'] = fichier_poids
        d['_p_classe'] = config['name']
        d['_p_args'] = dict(config.get('args') or {})
        d['_p_nom'] = os.path.basename(str(chemin))
        d['_p_reel'] = None
        d['_p_attente'] = {}

    # --- chargement / liberation ---
    def _p_monter(self):
        reel = self.__dict__.get('_p_reel')
        if reel is not None:
            return reel
        liberer_residents()
        reel, _mode = construire(self._p_classe, self._p_args, self._p_poids, self._p_chemin, _device_cible())
        for k, v in self._p_attente.items():
            setattr(reel, k, v)
        self._p_attente.clear()
        self.__dict__['_p_reel'] = reel
        _noter(f'monte {self._p_nom}')
        return reel

    def _p_liberer(self):
        reel = self.__dict__.get('_p_reel')
        if reel is None:
            return
        dev = next((p.device for p in reel.parameters()), torch.device('cpu'))
        self.__dict__['_p_reel'] = None
        del reel
        _vider_cache(dev)
        _noter(f'libere {self._p_nom}')

    @property
    def est_monte(self):
        return self.__dict__.get('_p_reel') is not None

    # --- delegation ---
    def __getattr__(self, nom):
        d = self.__dict__
        reel = d.get('_p_reel')
        if reel is not None:
            return getattr(reel, nom)
        if nom.startswith('_'):
            raise AttributeError(nom)
        attente = d.get('_p_attente') or {}
        if nom in attente:
            return attente[nom]
        args = d.get('_p_args') or {}
        if nom in ATTRIBUTS_CONFIG and nom in args:
            return args[nom]
        return getattr(self._p_monter(), nom)

    def __setattr__(self, nom, valeur):
        if nom.startswith('_') or nom == 'training':
            object.__setattr__(self, nom, valeur)
            return
        reel = self.__dict__.get('_p_reel')
        if reel is not None:
            setattr(reel, nom, valeur)
        else:
            self.__dict__['_p_attente'][nom] = valeur

    def __call__(self, *args, **kwargs):
        return self._p_monter()(*args, **kwargs)

    def forward(self, *args, **kwargs):
        return self._p_monter()(*args, **kwargs)

    def to(self, *args, **kwargs):
        dev = None
        try:
            dev = torch._C._nn._parse_to(*args, **kwargs)[0]
        except Exception:
            a = args[0] if args else kwargs.get('device')
            if isinstance(a, (str, torch.device)):
                dev = torch.device(a)
        if dev is not None and dev.type == 'cpu':
            self._p_liberer()
            return self
        reel = self._p_monter()
        if dev is None:
            reel.to(*args, **kwargs)            # changement de type seul : delegue
        return self

    def cuda(self, device=None):
        self._p_monter()
        return self

    def cpu(self):
        self._p_liberer()
        return self

    def train(self, mode=True):
        object.__setattr__(self, 'training', mode)
        reel = self.__dict__.get('_p_reel')
        if reel is not None:
            reel.train(mode)
        return self

    def eval(self):
        return self.train(False)

    def parameters(self, *a, **k):
        return self._p_monter().parameters(*a, **k)

    def named_parameters(self, *a, **k):
        return self._p_monter().named_parameters(*a, **k)

    def buffers(self, *a, **k):
        return self._p_monter().buffers(*a, **k)

    def named_buffers(self, *a, **k):
        return self._p_monter().named_buffers(*a, **k)

    def children(self):
        return self._p_monter().children()

    def modules(self):
        return self._p_monter().modules()

    def state_dict(self, *a, **k):
        return self._p_monter().state_dict(*a, **k)

    def apply(self, fn):
        self._p_monter().apply(fn)
        return self

    def __repr__(self):
        return f'ModeleParesseux({self._p_classe}, {self._p_nom}, {"monte" if self.est_monte else "sur le disque"})'


def fabrique(chemin, **kwargs):
    """Remplacante de trellis2.models.from_pretrained : ne charge rien."""
    if kwargs and _fabrique_amont is not None:     # arguments de constructeur en plus : cas non prevu, amont
        return _fabrique_amont(chemin, **kwargs)
    fichier_config, fichier_poids = resoudre_fichiers(chemin)
    with open(fichier_config, 'r', encoding='utf-8') as f:
        config = json.load(f)
    return ModeleParesseux(chemin, fichier_config, fichier_poids, config)


fabrique._fabmesh_paresseux = True


def envelopper_extracteur(Original):
    """Sous-classe paresseuse de DinoV3FeatureExtractor (lu au premier usage, sur
    la carte ; rendu quand le modele suivant monte)."""

    class ExtracteurParesseux(Original):
        _fabmesh_paresseux = True

        def __init__(self, model_name, image_size=512):
            self._p_args = (model_name, image_size)
            self.model_name = model_name
            self.image_size = image_size
            self.model = None

        def _monter(self):
            if self in _residents:
                _residents.remove(self)
            if self.model is None:
                liberer_residents()
                t0 = time.time()
                taille = self.image_size                 # fixee par get_cond AVANT .to()
                Original.__init__(self, *self._p_args)   # lit DINOv3 (RAM), comme l'amont
                self.image_size = taille
                self.model.requires_grad_(False)
                self.model.to(_device_cible())           # la copie en RAM est rendue
                _log(f'[paresseux] extracteur d\'image monte en {time.time() - t0:.1f}s')
                _noter('monte extracteur_image')
            return self.model

        def _rendre(self):
            if self.model is not None:
                self.model = None
                _vider_cache(_device_cible())
                _noter('libere extracteur_image')

        def _differer(self):
            if self.model is not None and self not in _residents:
                _residents.append(self)

        def to(self, device):
            dev = device if isinstance(device, torch.device) else torch.device(device)
            if dev.type == 'cpu':
                self._differer()
            else:
                self._monter()

        def cuda(self):
            self._monter()

        def cpu(self):
            self._differer()

        def __call__(self, image):
            self._monter()
            return Original.__call__(self, image)

    ExtracteurParesseux.__name__ = Original.__name__
    ExtracteurParesseux.__qualname__ = Original.__qualname__
    return ExtracteurParesseux


def appliquer(log=print, mesurer=None):
    """A appeler apres l'ajout de TRELLIS2_win/src au chemin et AVANT
    `Trellis2*Pipeline.from_pretrained`. Rend True si le mode paresseux est actif."""
    global _log, _mesurer, _fabrique_amont
    _log, _mesurer = log, mesurer
    if os.environ.get('FABMESH_T2_PARESSEUX') == '0':
        _log('[paresseux] DESACTIVE (FABMESH_T2_PARESSEUX=0) : tous les modeles restent en RAM')
        return False
    import trellis2.models as tm
    if getattr(tm.from_pretrained, '_fabmesh_paresseux', False):
        return True
    _fabrique_amont = tm.from_pretrained
    tm.from_pretrained = fabrique
    try:
        import trellis2.modules.image_feature_extractor as ife
        if not getattr(ife.DinoV3FeatureExtractor, '_fabmesh_paresseux', False):
            ife.DinoV3FeatureExtractor = envelopper_extracteur(ife.DinoV3FeatureExtractor)
    except Exception as e:
        _log(f'[paresseux] extracteur d\'image charge a l\'avance ({type(e).__name__}: {e})')
    _log('[paresseux] modeles lus a la demande, directement sur la carte, rendus apres leur etape')
    return True
