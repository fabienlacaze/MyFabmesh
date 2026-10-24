"""Route T-pose du site (24/10, audit des prompts m3), sans GPU ni torch (doublures) :

  - le negatif contient « nude, naked, nsfw » (ceux de la generation d'image y sont) ;
  - aucune consigne du gabarit du client n'est repetee par la queue de T-pose (157 a 416 jetons, chaque proposition deux fois) ;
  - « studio lighting » (retire de la generation d'image le 25/09 : ombres cuites dans l'atlas) n'est plus reintroduit ;
  - le texte de l'utilisateur et ses negations (negative_extra) sont intacts ; un texte sans gabarit recoit toute la queue (moins studio lighting).
L'EFFET SUR L'IMAGE n'est pas mesurable ici : protocole A/B graines fixes dans AGENT_LOG.md.

Lancer :  python build/bancs/noyaux/test_tpose_prompt.py -v
"""
import os
import re
import sys
import types
import unittest

RACINE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
sys.path.insert(0, RACINE)

_torch = types.ModuleType('torch')


class _Gen:
    def __init__(self, *a, **k):
        pass

    def manual_seed(self, s):
        return self


_torch.Generator = _Gen
sys.modules.setdefault('torch', _torch)

from PIL import Image  # noqa: E402

from modal_app import _tpose as T  # noqa: E402
from modal_app import _prompts as P  # noqa: E402


class _Cfg:
    encoder_hid_dim_type = None


class _Unet:
    config = _Cfg()


class _Sortie:
    def __init__(self):
        self.images = [Image.new('RGB', (8, 8), 'white')]


class _PipeEspion:
    unet = _Unet()

    def __init__(self):
        self.appels = []

    def set_ip_adapter_scale(self, s):
        pass

    def __call__(self, **kw):
        self.appels.append(kw)
        return _Sortie()


def generer(prompt, **kw):
    pipe = _PipeEspion()
    ancien = T.remove_bg_and_center
    T.remove_bg_and_center = lambda img, size=1024, **k: img
    try:
        T.generate(pipe, Image.new('RGB', (8, 8)), prompt, **kw)
    finally:
        T.remove_bg_and_center = ancien
    return pipe.appels[0]


def clauses(texte):
    return [c.strip().lower() for c in texte.split(',') if c.strip()]


GAB = P.ASSET_TYPE_PROMPTS['character']
ENRICHI = 'An orc warrior, dark fantasy, ' + GAB


class PromptTPose(unittest.TestCase):
    def test_negatif_porte_nude_naked_nsfw(self):
        kw = generer(ENRICHI)
        for mot in ('nude', 'naked', 'nsfw'):
            self.assertIn(mot, clauses(kw['negative_prompt']), mot)
        self.assertIn('nsfw', T.NEG)

    def test_aucune_consigne_repetee(self):
        kw = generer(ENRICHI)
        p = kw['prompt'].lower()
        for cle in ('full body', 'strict front view', 'plain white background', 'arms extended horizontally', 'facing camera', 'legs apart'):
            self.assertEqual(len(re.findall(r'(?<![a-z0-9-])' + re.escape(cle) + r'(?![a-z0-9-])', p)), 1, cle + ' : ' + kw['prompt'])
        self.assertEqual(len(re.findall(r'(?<![a-z0-9-])t-pose(?![a-z0-9-])', p)), 1, kw['prompt'])
        cl = clauses(kw['prompt'])
        self.assertEqual(len(cl), len(set(cl)), 'clause en double : ' + kw['prompt'])

    def test_pas_de_studio_lighting(self):
        for prompt in (ENRICHI, 'an orc', 'An orc warrior holding a club'):
            self.assertNotIn('studio lighting', generer(prompt)['prompt'].lower(), prompt)

    def test_texte_de_l_utilisateur_et_negations_intacts(self):
        kw = generer(ENRICHI, negatif_extra=['helmet', 'beard'])
        self.assertTrue(kw['prompt'].startswith('An orc warrior, dark fantasy, isolated 3D character'))
        self.assertTrue(kw['negative_prompt'].rstrip().endswith('helmet, beard'), kw['negative_prompt'])
        self.assertIn('nsfw', kw['negative_prompt'])

    def test_texte_sans_gabarit_recoit_toute_la_queue(self):
        kw = generer('an orc')
        for cle in ('full body', 'strict front view', 'plain white background', 'arms extended horizontally sideways in a T-pose', 'standing upright'):
            self.assertIn(cle, kw['prompt'])
        self.assertEqual(T.queue_sans_doublons('an orc').count('studio'), 0)

    def test_variante_objet_tenu(self):
        kw = generer('An orc holding a massive spiked club, ' + GAB)
        self.assertNotIn('studio lighting', kw['prompt'])
        self.assertIn('duplicate objects', kw['negative_prompt'])
        cl = clauses(kw['prompt'])
        self.assertEqual(len(cl), len(set(cl)), kw['prompt'])

    def test_tout_est_deja_dit(self):
        tout = 'x' + T.FRONT_PROMPT_TAIL.replace(', studio lighting', '').replace('studio lighting, ', '')
        self.assertEqual(T.queue_sans_doublons(tout).count('full body'), 0)


if __name__ == '__main__':
    unittest.main()
