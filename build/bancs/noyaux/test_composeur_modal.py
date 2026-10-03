"""Tests du composeur d'intention cote Modal (2026-10-03) : modal_app/_prompts.py, modal_app/_realvis.py, modal_app/_tpose.py.

Aucun GPU, aucun reseau : `torch` est remplace par un faux module, `_sdxl_prompt_utils` et `_detourage` aussi ; le pipeline est un faux objet
qui note ce qu'on lui demande. Prouve :
  - build_enriched_prompt : l'orc recoit la clause et un gabarit adapte, EXACTEMENT comme buildFullPrompt cote client (meme chaine) ;
    sans objet tenu, rien ne change (comparaison avec le composeur coupe) ; un texte DEJA enrichi par le client n'est pas recompose ;
  - build_prompts (negatif) : ce qui est demande n'est plus interdit, une seule arme est protegee ; sans arme nommee, negatif identique ;
  - _tpose.generate : « symmetric T-pose », « open hands » et « holding objects » ne contredisent plus un objet tenu ; sans objet, identique.

Lancer :  <python de l'appli> build/bancs/noyaux/test_composeur_modal.py -v
"""
import os
import sys
import types
import unittest

RACINE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
sys.path.insert(0, RACINE)

# --- faux modules lourds, poses AVANT l'import des modules testes ---
_torch = types.ModuleType('torch')
_torch.Generator = lambda dev=None: types.SimpleNamespace(manual_seed=lambda s: ('graine', s))
sys.modules.setdefault('torch', _torch)

CAPTURE = {}
_utils = types.ModuleType('modal_app._sdxl_prompt_utils')


def _encode(pipe, prompt, negatif):
    CAPTURE['prompt'], CAPTURE['negatif'] = prompt, negatif
    return {'prompt_embeds': 'x'}


_utils.encode_sdxl_long_prompt = _encode
sys.modules['modal_app._sdxl_prompt_utils'] = _utils

from PIL import Image  # noqa: E402

_det = types.ModuleType('modal_app._detourage')
_det.detourer = lambda im: im.convert('RGBA')
sys.modules['modal_app._detourage'] = _det

from modal_app import _prompts as P  # noqa: E402
from modal_app import _realvis as R  # noqa: E402
from modal_app import _tpose as T  # noqa: E402

ORC = 'An orc warrior covered in blood, holding a massive spiked club'
ORC_ATTENDU = (
    'An orc warrior covered in blood, holding a massive spiked club, '
    'holding exactly one massive spiked club in the right hand, left hand open and empty, '
    'dark fantasy, gothic grimdark, dramatic chiaroscuro lighting, weathered ornate detail, brooding, '
    'isolated 3D character, full body, fully clothed, T-pose, arms extended horizontally, legs apart, strict front view, facing camera, '
    'plain white background, entire figure and held item fully visible, generous empty margins')


class FauxPipe:
    class _Cfg:
        encoder_hid_dim_type = None

    class _Unet:
        config = None

    def __init__(self):
        self.unet = self._Unet()
        self.unet.config = self._Cfg()

    def set_ip_adapter_scale(self, x):
        pass

    def __call__(self, **kw):
        return types.SimpleNamespace(images=[Image.new('RGB', (64, 64), (200, 100, 50))])


def sans_composeur(f):
    """Appelle f() avec le composeur coupe (FABMESH_COMPOSEUR=0), puis le rallume."""
    avant = os.environ.get('FABMESH_COMPOSEUR')
    os.environ['FABMESH_COMPOSEUR'] = '0'
    try:
        return f()
    finally:
        if avant is None:
            os.environ.pop('FABMESH_COMPOSEUR', None)
        else:
            os.environ['FABMESH_COMPOSEUR'] = avant


class ComposeurModal(unittest.TestCase):
    def setUp(self):
        os.environ.pop('FABMESH_COMPOSEUR', None)

    # ---------------------------------------------------------------- build_enriched_prompt
    def test_orc_meme_chaine_que_le_client(self):
        self.assertEqual(P.build_enriched_prompt(ORC, 'character', 'dark-fantasy'), ORC_ATTENDU)

    def test_sans_objet_tenu_rien_ne_change(self):
        textes = ['An orc', 'A medieval peasant', 'A knight without a weapon', 'A monk, unarmed', 'A man holding his breath', 'A cat sitting']
        for typ in sorted(P.ASSET_TYPE_PROMPTS):
            for t in textes:
                avec = P.build_enriched_prompt(t, typ, 'realistic')
                sans = sans_composeur(lambda: P.build_enriched_prompt(t, typ, 'realistic'))
                self.assertEqual(avec, sans, typ + ' / ' + t)

    def test_un_type_qui_n_est_pas_une_unite_n_est_jamais_touche(self):
        for typ in ('vehicle', 'building', 'weapon', 'prop', 'creature', 'animal'):
            t = 'A statue holding a flag'
            self.assertEqual(P.build_enriched_prompt(t, typ, 'realistic'),
                             sans_composeur(lambda: P.build_enriched_prompt(t, typ, 'realistic')), typ)

    def test_un_texte_deja_enrichi_par_le_client_n_est_pas_recompose(self):
        deja = P.build_enriched_prompt(ORC, 'character', 'dark-fantasy')
        self.assertEqual(P.build_enriched_prompt(deja, 'character', 'dark-fantasy'), deja)

    def test_idempotent_avec_deux_objets_et_deux_mains(self):
        for t in ('A knight holding a sword and a shield', 'A samurai wielding two katanas', 'A barbarian wielding a greatsword with both hands'):
            un = P.build_enriched_prompt(t, 'character', 'realistic')
            self.assertEqual(un.count('holding exactly') + un.count('in the left hand'), 1, un)
            self.assertEqual(P.build_enriched_prompt(un, 'character', 'realistic'), un)

    # ---------------------------------------------------------------- build_prompts (negatif)
    def test_negatif_sans_arme_nommee_identique(self):
        for t in ('An orc', 'A knight without a weapon', 'A monk, unarmed', 'A man holding his breath'):
            enrichi = P.build_enriched_prompt(t, 'character', 'realistic')
            avec = R.build_prompts(enrichi, 'character')
            sans = sans_composeur(lambda: R.build_prompts(enrichi, 'character'))
            self.assertEqual(avec, sans, t)
            self.assertIn('(weapon:1.6)', avec[1])

    def test_negatif_orc_la_massue_n_est_plus_interdite(self):
        enrichi = P.build_enriched_prompt(ORC, 'character', 'dark-fantasy')
        _, neg = R.build_prompts(enrichi, 'character')
        for interdit_a_tort in ('(weapon:1.6)', '(holding weapon:1.6)', '(club:1.4)'):
            self.assertNotIn(interdit_a_tort, neg)
        for garde in ('(sword:1.5)', '(blade:1.5)', '(second weapon:1.5)', '(dual wielding:1.5)', '(duplicate weapon:1.5)'):
            self.assertIn(garde, neg)
        # la securite reste la premiere consigne
        self.assertTrue(neg.startswith('nude, naked, nsfw, undressed'), neg)

    def test_negatif_creature_et_autres_types_inchanges(self):
        for typ in ('creature', 'animal', 'building', 'vehicle'):
            enrichi = P.build_enriched_prompt('A beast holding a bone', typ, 'realistic')
            self.assertEqual(R.build_prompts(enrichi, typ), sans_composeur(lambda: R.build_prompts(enrichi, typ)), typ)

    # ---------------------------------------------------------------- _tpose.generate
    def _tpose(self, prompt):
        CAPTURE.clear()
        T.generate(FauxPipe(), Image.new('RGB', (64, 64)), prompt, size=64)
        return CAPTURE['prompt'], CAPTURE['negatif']

    def test_tpose_sans_objet_identique(self):
        for t in ('An orc', 'A medieval peasant', 'A knight without a weapon'):
            p, n = self._tpose(t)
            self.assertEqual(p, t + T.FRONT_PROMPT_TAIL)
            self.assertEqual(n, T.NEG)

    def test_tpose_orc_ne_se_contredit_plus(self):
        p, n = self._tpose(ORC_ATTENDU)
        self.assertNotIn('symmetric T-pose', p)
        self.assertNotIn('open hands', p)
        self.assertIn('hands held away from the body', p)
        self.assertIn('in a T-pose', p)
        self.assertIn('arms extended horizontally', p)
        segs = [s.strip() for s in n.split(',')]
        self.assertNotIn('holding objects', segs)
        for garde in ('second weapon', 'dual wielding', 'duplicate weapon', 'duplicate objects', 'hands on hips', 'arms down'):
            self.assertIn(garde, segs)
        self.assertEqual(segs[-1], 'duplicate weapon' if segs[-1] == 'duplicate weapon' else segs[-1])

    def test_tpose_objet_non_arme_sans_parade_une_seule_arme(self):
        p, n = self._tpose('A farmer holding a pitchfork')
        segs = [s.strip() for s in n.split(',')]
        self.assertNotIn('holding objects', segs)
        self.assertIn('duplicate objects', segs)
        self.assertNotIn('second weapon', segs)

    def test_tpose_interrupteur(self):
        p, n = sans_composeur(lambda: self._tpose(ORC_ATTENDU))
        self.assertEqual(p, ORC_ATTENDU + T.FRONT_PROMPT_TAIL)
        self.assertEqual(n, T.NEG)


if __name__ == '__main__':
    unittest.main()
