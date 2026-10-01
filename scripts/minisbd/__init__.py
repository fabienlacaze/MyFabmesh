"""Remplacant NEUTRE de `minisbd` pour argostranslate (2026-09-30, revue de l'audit de l'installation de zero).

Pourquoi ce module existe :
  * argostranslate 1.11 importe `minisbd` DES SON CHARGEMENT (`argostranslate/sbd.py` : `from minisbd import SBDetect, models`),
    sans protection : sans lui, `from argostranslate import translate` echoue (« No module named 'minisbd' », verifie avec
    l'interprete embarque) ;
  * le vrai paquet PyPI `minisbd` est sous licence GNU AGPL-3.0 (METADATA : « License :: OSI Approved :: GNU Affero General
    Public License v3 »). Regle de l'exploitant : aucun composant AGPL dans le produit. On ne l'installe donc PAS.

Ce qu'Argos en fait : il ne s'en SERT que pour un modele de langue sans decoupeur de phrases stanza. Les modeles que l'appli
pose (fr/es/zh/hi/ar -> en, en -> fr/es/zh/hi/ar, index Argos verifie le 2026-09-30) ont tous leur dossier `stanza` : Argos
prend alors stanza (Apache-2.0) et ce module n'est qu'importe. Si un futur modele n'avait que minisbd, `SBDetect` decoupe
ici les phrases sur la ponctuation finale (un prompt fait une ou deux phrases) au lieu de charger le modele AGPL.

Ecrit ici, sans rien reprendre du code de minisbd : seuls les deux noms importes par Argos sont reproduits. Copie dans le
site-packages de l'environnement IA par `wizard_install_deps._poser_traduction` (comme `scripts/rembg`) ; les scripts lances
depuis scripts/ (translate_server.py, translate_prompt.py, wizard_smoke_test.py) le trouvent aussi via sys.path[0].
"""
import re

__all__ = ['SBDetect', 'models']
__version__ = '0.0.0+fabmesh'

# Fin de phrase : . ! ? … et leurs formes CJK / devanagari / arabe, suivies d'un blanc (ou collees en CJK).
_FIN_DE_PHRASE = re.compile(r'(?<=[.!?…。！？।؟])\s+|(?<=[。！？])')


class _Modeles:
    """Remplace le sous-module `minisbd.models` : Argos y ecrit `cache_dir` et appelle `list_models()`."""
    cache_dir = None

    @staticmethod
    def list_models():
        # Langues dont les modeles poses par l'appli peuvent avoir besoin ; le decoupage ci-dessous ne depend pas de la langue.
        return ['en', 'fr', 'es', 'zh-hans', 'zh-hant', 'hi', 'ar']


models = _Modeles()


class SBDetect:
    """Meme interface que minisbd.SBDetect (constructeur + sentences). Aucun modele charge, aucun telechargement."""

    def __init__(self, lang=None, use_gpu=False, max_threads=None):
        self.lang = lang

    def sentences(self, text):
        text = '\n\n'.join(text) if isinstance(text, list) else (text or '')
        morceaux = [m.strip() for bloc in re.split(r'\n\s*\n', text) for m in _FIN_DE_PHRASE.split(bloc)]
        return [m for m in morceaux if m] or ([text] if text.strip() else [])
