"""Negations de l'utilisateur dans les OUTILS d'image (24/10, audit des prompts M7), sans GPU ni torch (doublures).

  « make the sword blue, no helmet »          : la cible CLIPSeg ne doit plus contenir « no helmet » (le masque glissait vers la tete) ;
  « a red leather cape, no hood, no feathers » : les termes vont au NEGATIF de l'outil, jamais laisses dans le positif ;
  Recolorier (HSV et re-rendu), Draw mask, Auto inpaint (cible ET remplacement), Variant / Age.
Memes regles sur le bureau (scripts/) et sur Modal (modal_app/) : le noyau recolor est partage (check-noyaux-partages).

Lancer :  python build/bancs/noyaux/test_negations_outils.py -v
"""
import contextlib
import io
import os
import sys
import types
import unittest

RACINE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
sys.path.insert(0, RACINE)
sys.path.insert(0, os.path.join(RACINE, 'scripts'))

# torch factice : seuls inference_mode / no_grad / Generator servent aux fonctions testees
_torch = types.ModuleType('torch')
_torch.inference_mode = lambda: contextlib.nullcontext()
_torch.no_grad = lambda: contextlib.nullcontext()


class _Gen:
    def __init__(self, *a, **k):
        pass

    def manual_seed(self, s):
        return self


_torch.Generator = _Gen
sys.modules.setdefault('torch', _torch)

from PIL import Image  # noqa: E402

import recolor_core as RC  # noqa: E402  (bureau)
from modal_app import _recolor as MR  # noqa: E402
from modal_app import _mask_inpaint as MI  # noqa: E402
from modal_app import _auto_inpaint as AI  # noqa: E402
from modal_app import _tex_variant as TV  # noqa: E402
from modal_app import composeur_intention as CI  # noqa: E402


class _Sortie:
    def __init__(self, img):
        self.images = [img]


class _PipeEspion:
    def __init__(self):
        self.appels = []

    def __call__(self, **kw):
        self.appels.append(kw)
        return _Sortie(Image.new('RGB', (64, 64), 'white'))


class Recolorier(unittest.TestCase):
    def test_cible_sans_locution_negative_bureau_et_modal(self):
        for mod in (RC, MR):
            noun, spec = mod.parse_recolor_prompt('a red leather cape, no hood, without feathers')
            self.assertEqual(noun, 'a leather cape')
            self.assertEqual(spec['word'], 'red')
            noun, spec = mod.parse_recolor_prompt('make the sword blue, no helmet')
            self.assertNotIn('helmet', noun)
            self.assertNotIn('no', noun.split())
            noun, spec = mod.parse_recolor_prompt('recolor the dress to blue without sleeves')
            self.assertNotIn('sleeves', noun)
            self.assertNotIn('without', noun.split())

    def test_sans_negation_rien_ne_change(self):
        for mod in (RC, MR):
            self.assertEqual(mod.parse_recolor_prompt('cape rouge')[0], 'cape')
            self.assertEqual(mod.recolor_tile_params('sword', 'rusty metal')['negative'],
                             'deformed, distorted, blurry, low quality, changed shape, extra parts')

    def test_termes_au_negatif_du_rerendu(self):
        for mod in (RC, MR):
            for tout in (False, True):
                neg = mod.recolor_tile_params('cape', 'worn leather', tout, 1.0, negatifs=['hood', 'feathers'])['negative']
                self.assertTrue(neg.endswith('hood, feathers'), neg)
            # un terme deja present n'est pas repete
            neg = mod.recolor_tile_params('cape', 'worn leather', False, 1.0, negatifs=['blurry', 'hood'])['negative']
            self.assertEqual(neg.count('blurry'), 1)

    def test_route_et_mots_descriptifs_ignorent_la_negation(self):
        for mod in (RC, MR):
            self.assertEqual(mod.recolor_mots_descriptifs('military green camo, no stripes'), ['military', 'camo'])

    def test_generate_tile_modal_envoie_le_terme_au_negatif(self):
        pipe = _PipeEspion()
        coupe = {}

        def faux_masque(proc, model, travail, w, h, texte, dilate, rel):
            coupe['cible'] = texte
            return Image.new('L', (w, h), 255)

        ancien = MR._masque_clipseg
        MR._masque_clipseg = faux_masque
        try:
            MR.generate_tile(None, None, pipe, Image.new('RGB', (64, 64), 'gray'), 'worn leather cape, no hood')
        finally:
            MR._masque_clipseg = ancien
        self.assertNotIn('hood', coupe['cible'])
        self.assertIn('hood', pipe.appels[0]['negative_prompt'])
        self.assertNotIn('hood', pipe.appels[0]['prompt'])


class DrawMask(unittest.TestCase):
    def test_enrich_prompt_modal(self):
        pos, neg = MI._enrich_prompt('a pirate hat, no feather')
        self.assertNotIn('feather', pos)
        self.assertTrue(neg.endswith('feather'), neg)
        pos0, neg0 = MI._enrich_prompt('a pirate hat')
        self.assertEqual((pos0, neg0), MI._enrich_prompt_base('a pirate hat'))
        self.assertEqual(neg0, 'blurry, distorted, low quality, deformed, watermark, text')

    def test_texte_entierement_negatif_garde_son_positif(self):
        pos, neg = MI._enrich_prompt('no helmet')
        self.assertIn('helmet', neg)
        self.assertTrue(pos)

    def test_enrich_prompt_bureau(self):
        # sdxl_server charge torch et les modeles : on lit seulement la fonction, evaluee avec les deux aides
        import ast
        with io.open(os.path.join(RACINE, 'scripts', 'sdxl_server.py'), encoding='utf-8') as f:
            src = f.read()
        arbre = ast.parse(src)
        noms = {'_tri_negations', '_neg_avec', '_enrich_prompt', '_enrich_prompt_base', '_boost'}
        morceaux = [ast.get_source_segment(src, n) for n in arbre.body if isinstance(n, ast.FunctionDef) and n.name in noms]
        self.assertEqual(len(morceaux), 5)
        ns = {'re': __import__('re'), 'CONCEPT_BOOSTERS': {}, '_CONCEPT_BOOSTERS': {}}
        exec('\n\n'.join(morceaux), ns)
        pos, neg = ns['_enrich_prompt']('a pirate hat, no feather')
        self.assertNotIn('feather', pos)
        self.assertIn('feather', neg)


class AutoInpaint(unittest.TestCase):
    def _generer(self, cible, prompt):
        vus = []
        ancien = AI._segment

        def faux(proc, model, img, texte, w, h, dilate):
            vus.append(texte)
            return Image.new('L', (w, h), 255)

        AI._segment = faux
        pipe = _PipeEspion()
        try:
            AI.generate(None, None, pipe, Image.new('RGB', (64, 64), 'gray'), cible, prompt)
        finally:
            AI._segment = ancien
        return vus, pipe.appels[0]

    def test_cible_et_remplacement(self):
        vus, kw = self._generer('sword, no helmet', 'a golden axe, no gems')
        for t in vus:
            self.assertNotIn('helmet', t)
            self.assertNotIn('no ', t)
        self.assertNotIn('gems', kw['prompt'])
        self.assertIn('helmet', kw['negative_prompt'])
        self.assertIn('gems', kw['negative_prompt'])

    def test_sans_negation_inchange(self):
        vus, kw = self._generer('sword', 'a golden axe')
        self.assertEqual(kw['prompt'], 'a golden axe')
        self.assertEqual(kw['negative_prompt'], 'blurry, distorted, duplicate, sword')


class Variant(unittest.TestCase):
    def test_negation_du_prompt_au_negatif(self):
        pipe = _PipeEspion()
        TV.generate(pipe, Image.new('RGB', (64, 64), 'gray'), 'weathered stone, no moss')
        kw = pipe.appels[0]
        self.assertNotIn('moss', kw['prompt'])
        self.assertTrue(kw['negative_prompt'].endswith('moss'), kw['negative_prompt'])

    def test_sans_negation_negatif_inchange(self):
        pipe = _PipeEspion()
        TV.generate(pipe, Image.new('RGB', (64, 64), 'gray'), 'weathered stone')
        self.assertEqual(pipe.appels[0]['negative_prompt'], TV.NEGATIF_DEFAUT)

    def test_negatif_du_client_garde_ses_termes(self):
        pipe = _PipeEspion()
        TV.generate(pipe, Image.new('RGB', (64, 64), 'gray'), 'weathered stone, no moss', neg_prompt='blurry')
        self.assertEqual(pipe.appels[0]['negative_prompt'], 'blurry, moss')


class Aides(unittest.TestCase):
    def test_interrupteur(self):
        os.environ['FABMESH_COMPOSEUR'] = '0'
        try:
            self.assertEqual(CI.separer_negations_outil('a cape, no hood'), ('a cape, no hood', []))
        finally:
            del os.environ['FABMESH_COMPOSEUR']

    def test_negatif_avec_termes(self):
        self.assertEqual(CI.negatif_avec_termes('blurry', ['hood']), 'blurry, hood')
        self.assertEqual(CI.negatif_avec_termes('blurry, hood', ['hood']), 'blurry, hood')
        self.assertEqual(CI.negatif_avec_termes('', ['hood']), 'hood')
        self.assertEqual(CI.negatif_avec_termes('blurry', []), 'blurry')


if __name__ == '__main__':
    unittest.main()
