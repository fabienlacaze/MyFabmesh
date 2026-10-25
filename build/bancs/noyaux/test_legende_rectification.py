"""Legende de la vue de dos / rectification (24/10, audit des prompts m9), sans GPU ni torch (doublures) :

  « He is holding a sword in his right hand. » perdait la phrase ENTIERE (regle « (he|she|they) (is|are) (standing|posing|holding|...)[^.]*. »), arme comprise :
  la vue de dos redessinait le personnage sans son arme. Maintenant l'objet tenu reste ; les poses pures (standing, posing, sitting, walking) sont toujours retirees.

Lancer :  python build/bancs/noyaux/test_legende_rectification.py -v
"""
import os
import sys
import types
import unittest

RACINE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
sys.path.insert(0, RACINE)

_torch = types.ModuleType('torch')
_torch.float16 = 'float16'


class _NoGrad:
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


_torch.no_grad = lambda: _NoGrad()
sys.modules.setdefault('torch', _torch)

from modal_app import _backview as B  # noqa: E402


class _Tenseur:
    def to(self, *a, **k):
        return self


class _Image:
    width = 64
    height = 64


class _Proc:
    def __init__(self, legende):
        self.legende = legende

    def __call__(self, text=None, images=None, return_tensors=None):
        return {'input_ids': _Tenseur(), 'pixel_values': _Tenseur()}

    def batch_decode(self, out, skip_special_tokens=False):
        return ['x']

    def post_process_generation(self, generated, task=None, image_size=None):
        return {task: self.legende}


class _Modele:
    def generate(self, **kw):
        return None


def legende(texte):
    return B.caption_outfit(_Proc(texte), _Modele(), _Image())


class Legende(unittest.TestCase):
    def test_objet_tenu_conserve(self):
        d = legende('An orc in a leather vest. He is holding a sword in his right hand.')
        self.assertIn('holding a sword', d)
        self.assertIn('leather vest', d)

    def test_tenu_a_deux_mains_et_pluriel(self):
        self.assertIn('holding a shield', legende('A knight in plate mail. She is holding a shield and a spear.'))
        self.assertIn('holding two axes', legende('A dwarf in a red tunic. They are holding two axes.'))

    def test_poses_pures_toujours_retirees(self):
        d = legende('A knight in a blue tunic. He is standing with his arms at his sides. She is sitting on a chair.')
        self.assertIn('blue tunic', d)
        self.assertNotIn('standing', d)
        self.assertNotIn('sitting', d)

    def test_bruit_de_visage_toujours_retire(self):
        d = legende('A woman in a green dress. She is looking at the camera. The background is white.')
        self.assertIn('green dress', d)
        self.assertNotIn('camera', d)
        self.assertNotIn('background', d)

    def test_pieces_de_devant_reecrites(self):
        d = legende('A knight wearing a breastplate. He is holding a sword.')
        self.assertIn('back plate', d)
        self.assertIn('holding a sword', d)


if __name__ == '__main__':
    unittest.main()
