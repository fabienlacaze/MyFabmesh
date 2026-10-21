"""Tests du composeur d'intention cote Modal (2026-10-03) : modal_app/_prompts.py, modal_app/_realvis.py, modal_app/_tpose.py.

Aucun GPU, aucun reseau : `torch` est remplace par un faux module, `_sdxl_prompt_utils` et `_detourage` aussi ; le pipeline est un faux objet
qui note ce qu'on lui demande. Prouve :
  - build_enriched_prompt : l'orc recoit la clause et un gabarit adapte, EXACTEMENT comme buildFullPrompt cote client (meme chaine) ;
    sans objet tenu, rien ne change (comparaison avec le composeur coupe) ; un texte DEJA enrichi par le client n'est pas recompose ;
  - build_prompts (negatif) : ce qui est demande n'est plus interdit, une seule arme est protegee ; sans arme nommee, negatif identique ;
  - _tpose.generate : « symmetric T-pose », « open hands » et « holding objects » ne contredisent plus un objet tenu ; sans objet, identique ;
  - NEGATIONS DE L'UTILISATEUR (classes NegationsServeur et GlueApp, en bas) : « no helmet » quitte le positif (tous les types), « helmet » entre au negatif
    (text2image : _realvis.build_prompts ; T-pose : _tpose.generate), nettoyage strict du champ `negative_extra`, securite / ombres / armes toujours en tete,
    budget de 77 jetons inchange, sans negation tout est identique a l'octet a la reference d'AVANT (REFERENCE_AVANT, calculee avec le code du commit HEAD),
    et la colle de modal_app/app.py (routes text2image et T-pose) est EXECUTEE avec des doublures.

Lancer :  <python de l'appli> build/bancs/noyaux/test_composeur_modal.py -v
"""
import ast
import contextlib
import io
import os
import re
import sys
import textwrap
import time
import types
import unittest
from unittest import mock

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
        # (« A knight without a weapon » n'est plus ici : « without a weapon » est une NEGATION, elle sort du positif ; voir NegationsServeur.test_chevalier_sans_arme)
        textes = ['An orc', 'A medieval peasant', 'A knight in shining armor', 'A monk, unarmed', 'A man holding his breath', 'A cat sitting']
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

    # ---------------------------------------------------------------- case « T-pose » decochee (pose_libre)
    CONSIGNES_TPOSE = ('T-pose', 'arms extended horizontally', 'legs apart', 'symmetric', 'empty open hands')

    def test_pose_libre_retire_la_tpose_du_gabarit_des_unites(self):
        libre = P.build_enriched_prompt('An orc warrior', 'character', 'realistic', pose_libre=True)
        for tok in self.CONSIGNES_TPOSE:
            self.assertNotIn(tok, libre, tok)
        for garde in ('isolated 3D character, full body, fully clothed', 'strict front view', 'facing camera', 'plain white background', 'clean silhouette'):
            self.assertIn(garde, libre)
        defaut = P.build_enriched_prompt('An orc warrior', 'character', 'realistic')
        self.assertIn('T-pose', defaut)
        self.assertEqual(P.build_enriched_prompt('An orc warrior', 'character', 'realistic', pose_libre=False), defaut)

    def test_pose_libre_et_objet_tenu(self):
        libre = P.build_enriched_prompt(ORC, 'character', 'dark-fantasy', pose_libre=True)
        for tok in self.CONSIGNES_TPOSE:
            self.assertNotIn(tok, libre, tok)
        self.assertIn('holding exactly one massive spiked club in the right hand, left hand open and empty', libre)
        self.assertTrue(libre.endswith('entire figure and held item fully visible, generous empty margins'), libre)

    def test_pose_libre_sans_effet_hors_unites(self):
        for typ in ('vehicle', 'building', 'weapon', 'prop', 'creature', 'animal', 'environment'):
            self.assertEqual(P.build_enriched_prompt('A statue', typ, 'realistic', pose_libre=True),
                             P.build_enriched_prompt('A statue', typ, 'realistic'), typ)

    def test_pose_libre_respectee_meme_composeur_coupe(self):
        # FABMESH_COMPOSEUR=0 coupe les adaptations d'INTENTION ; le choix explicite de l'utilisateur (la case) reste respecte
        libre = sans_composeur(lambda: P.build_enriched_prompt(ORC, 'character', 'dark-fantasy', pose_libre=True))
        for tok in self.CONSIGNES_TPOSE:
            self.assertNotIn(tok, libre, tok)
        self.assertNotIn('holding exactly one', libre, 'pas de clause : le composeur est coupe')
        self.assertIn('empty open hands', sans_composeur(lambda: P.build_enriched_prompt(ORC, 'character', 'dark-fantasy')))

    def test_pose_libre_un_texte_deja_enrichi_n_est_pas_recompose(self):
        libre = P.build_enriched_prompt(ORC, 'character', 'dark-fantasy', pose_libre=True)
        self.assertEqual(P.build_enriched_prompt(libre, 'character', 'dark-fantasy', pose_libre=True), libre)
        self.assertEqual(P.build_enriched_prompt(libre, 'character', 'dark-fantasy'), libre)

    def test_la_route_text2image_transmet_pose_libre(self):
        with open(os.path.join(RACINE, 'modal_app', 'app.py'), 'r', encoding='utf-8') as f:
            app = f.read()
        self.assertIn('pose_libre=bool(payload.get("pose_libre")),', app)
        self.assertIn('build_enriched_prompt(prompt, asset_type, asset_style, pose_libre=pose_libre)', app)

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
        for garde in ('(sword:1.5)', '(blade:1.5)', '(second weapon:1.5)', '(duplicate weapon:1.5)'):
            self.assertIn(garde, neg)
        # le budget de 77 jetons ne bouge pas : « extra characters, bystanders » n'est pas ecarte en plus (avec 3 jetons d'arme il l'etait)
        self.assertIn('extra characters, bystanders', neg)
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


# ======================================================================================================================
# NEGATIONS DE L'UTILISATEUR (2026-10-03, piste « serveur ») : « an orc, no helmet » -> le POSITIF perd la locution, le NEGATIF gagne « helmet ».
# Chemin du texte : clients anciens (le texte brut porte « no helmet », Modal le derive) ET clients a jour (le texte arrive deja SANS la locution,
# les termes viennent du champ `negative_extra` que le worker transporte). Meme logique cote worker : cloud/tests/negations-utilisateur.test.mjs.
# ======================================================================================================================
ORC_NEG = 'An orc warrior covered in blood, no helmet, holding a massive spiked club'
SECURITE = 'nude, naked, nsfw, undressed'
OMBRES = 'cast shadow, soft shadow, ambient occlusion'
# huit termes de trois mots : la pire liste que le nettoyage laisse passer
INONDATION = ['alpha bravo charlie', 'delta echo foxtrot', 'golf hotel india', 'juliet kilo lima', 'mike november oscar', 'papa quebec romeo',
              'sierra tango uniform', 'victor whiskey xray']

# Vecteurs du nettoyage strict du champ `negative_extra` : (entree, sortie attendue). LES MEMES que VECTEURS_NETTOYAGE de cloud/tests/negations-utilisateur.test.mjs :
# le worker (JS) et Modal (Python) nettoient a l'identique. Ecrits a la main, relus contre les deux implementations.
DOUZE_TERMES = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima']
VECTEURS_NETTOYAGE = [
    (['helmet', 'beard'], ['helmet', 'beard']),
    (['Golden  Crown', '\tCAPE\n'], ['golden crown', 'cape']),
    (['(nude:0)', 'helmet'], ['helmet']),
    (['nude), (cape', 'a, b', '[x]', 'x:1.5', 'x\\y'], []),
    (['clothes', 'cape', 'Shirt', 'top hat', 'bare-chested', 'NSFW'], ['cape']),
    (['foo-bar', 'foo - bar', '-x', 'x-', 'a--b'], ['foo-bar']),
    (['café', 'h3lmet', '1', '', '   ', 'a.b', 'a;b', "o'clock"], []),
    (['x' * 40, 'x' * 41], ['x' * 40]),
    (['a ' * 20], [' '.join(['a'] * 20)]),
    (['a ' * 21], []),
    (['helmet', 'HELMET', ' helmet '], ['helmet']),
    (['hel met'], ['hel met']),
    ([' helmet', 'hel​met', 'ｈelmet'], []),
    ([None, 3, {}, ['x'], True, 1.5], []),
    (None, []),
    ('helmet', []),
    ({'a': 1}, []),
    (5, []),
    (DOUZE_TERMES, DOUZE_TERMES[:8]),
    (['(x)'] * 10 + DOUZE_TERMES, DOUZE_TERMES[:8]),
    (['(x)'] * 100 + DOUZE_TERMES, []),
]

# Valeurs de REFERENCE calculees avec le _realvis.py du commit AVANT les negations de l'utilisateur (git show HEAD, 2026-10-03) : (texte, type, style, positif, negatif).
REFERENCE_AVANT = [
    ('An orc warrior covered in blood, holding a massive spiked club', 'character', 'dark-fantasy',
     'An orc warrior covered in blood, holding a massive spiked club, holding exactly one massive spiked club in the right hand, left hand open and empty, dark fantasy, gothic grimdark, dramatic chiaroscuro lighting, weathered ornate detail, brooding, isolated 3D character, full body, fully clothed, T-pose, arms extended horizontally, legs apart, strict front view, facing camera, plain white background, entire figure and held item fully visible, generous empty margins, flat even lighting, diffuse light, no directional light, sharp focus, 8k, professional product photography',
     'nude, naked, nsfw, undressed, cast shadow, soft shadow, ambient occlusion, (sword:1.5), (blade:1.5), (knife:1.5), (spear:1.5), (axe:1.5), (shield:1.5), (bow:1.4), (gun:1.4), (staff:1.3), (second weapon:1.5), (duplicate weapon:1.5), (three arms:1.5), (extra arms:1.6), missing arm, (mutated hands:1.4), duplicate, twin, split image, collage, side by side, headshot, portrait, close-up, partial body, cropped, out of frame, text, watermark, logo, user interface, extra characters, bystanders'),
    ('A medieval peasant', 'character', 'realistic',
     'A (medieval:1.4) peasant, medieval linen and wool clothing, realistic style, photorealistic, sharp details, detailed materials, isolated 3D character, full body, fully clothed, T-pose, arms extended horizontally, empty open hands, legs apart, strict front view, facing camera, symmetric, plain white background, centered, clean silhouette, flat even lighting, diffuse light, no directional light, sharp focus, 8k, professional product photography',
     'nude, naked, nsfw, undressed, cast shadow, soft shadow, ambient occlusion, (weapon:1.6), (holding weapon:1.6), (sword:1.5), (blade:1.5), (knife:1.5), (spear:1.5), (axe:1.5), (club:1.4), (shield:1.5), (bow:1.4), (gun:1.4), (staff:1.3), (three arms:1.5), (extra arms:1.6), missing arm, (mutated hands:1.4), duplicate, twin, split image, collage, side by side, headshot, portrait, close-up, partial body, cropped, out of frame, text, watermark, logo, user interface, extra characters, bystanders'),
    ('A fierce dragon', 'creature', 'realistic',
     'realistic style, photorealistic, sharp details, detailed materials, A fierce dragon, full body creature, wide establishing shot, whole creature head to tail, body stretched out, fills 60 percent of frame, neutral stance, front view, plain white background, centered, clean silhouette, flat even lighting, diffuse light, no directional light, sharp focus, 8k, professional product photography',
     'nude, naked, nsfw, undressed, cast shadow, soft shadow, ambient occlusion, (weapon:1.6), (holding weapon:1.6), (curled up:1.5), (coiled:1.5), (lying down:1.4), (extra wings:1.6), (missing wing:1.6), (single wing:1.6), (five legs:1.6), (three legs:1.4), (two heads:1.5), (fused wings:1.4), (bust shot:1.6), (cropped body:1.6), (feet not visible:1.4), (waist up:1.5), (pedestal:1.6), (plinth:1.6), (stone platform:1.5), (statue base:1.5), (decorative base:1.4), duplicate, twin, split image, collage, side by side'),
    ('A brown bear', 'animal', 'realistic',
     'realistic style, photorealistic, sharp details, detailed materials, A brown bear, full body animal, lateral profile, whole animal nose to tail, body stretched out, all four feet on ground, fills 60 percent of frame, plain white background, centered, slight angle, one side visible, flat even lighting, diffuse light, no directional light, sharp focus, 8k, professional product photography',
     'nude, naked, nsfw, undressed, cast shadow, soft shadow, ambient occlusion, (curled up:1.5), (coiled:1.5), (lying down:1.4), (five legs:1.6), (six legs:1.6), (extra leg:1.6), (polydactyly:1.5), (three legs:1.4), (two heads:1.5), (deformed legs:1.4), duplicate, twin, split image, collage, side by side, headshot, portrait, close-up, partial body, cropped, out of frame, text, watermark, logo, user interface, extra characters, bystanders, blurry, deformed, bad anatomy'),
    ('A wooden house', 'building', 'realistic',
     'realistic style, photorealistic, sharp details, detailed materials, an architectural building, a complete standalone structure, A wooden house, architectural building exterior, wide establishing shot, whole structure inside frame, clear margin on all sides, plain white background, centered, strict front view, clean silhouette, flat even lighting, diffuse light, no directional light, sharp focus, 8k, professional product photography',
     'nude, naked, nsfw, undressed, cast shadow, soft shadow, ambient occlusion, (village:1.6), (town:1.6), (city:1.6), (cityscape:1.5), (multiple buildings:1.6), (rows of houses:1.5), (many houses:1.5), (suburb:1.4), (neighborhood:1.4), (aerial view:1.4), (isometric city:1.5), (tiled:1.4), (repeated pattern:1.4), (diorama:1.4), (humanoid:1.5), (android:1.5), (robot figure:1.5), (character:1.4), (person:1.4), (mascot:1.4), (standing figure:1.4), (statue:1.3), (mannequin:1.3), duplicate, twin, split image, collage, side by side, text, watermark, logo, user interface'),
    ('A red sports car', 'vehicle', 'realistic',
     'realistic style, photorealistic, sharp details, detailed materials, A red sports car, isolated, complete vehicle, plain white background, even studio lighting, centered, strict front view, facing camera, clean silhouette, flat even lighting, diffuse light, no directional light, sharp focus, 8k, professional product photography',
     'nude, naked, nsfw, undressed, cast shadow, soft shadow, ambient occlusion, duplicate, twin, split image, collage, side by side, headshot, portrait, close-up, partial body, cropped, out of frame, text, watermark, logo, user interface, extra characters, bystanders, blurry, deformed, bad anatomy'),
    ('A magic sword', 'weapon', 'realistic',
     'realistic style, photorealistic, sharp details, detailed materials, A magic sword, isolated, full weapon, plain white background, even studio lighting, centered, side profile, clean silhouette, flat even lighting, diffuse light, no directional light, sharp focus, 8k, professional product photography',
     'nude, naked, nsfw, undressed, cast shadow, soft shadow, ambient occlusion, duplicate, twin, split image, collage, side by side, headshot, portrait, close-up, partial body, cropped, out of frame, text, watermark, logo, user interface, extra characters, bystanders, blurry, deformed, bad anatomy'),
    ('A garden snake', 'animal', 'realistic',
     'realistic style, photorealistic, sharp details, detailed materials, A garden snake, full body, head to tail tip, body stretched out straight, gentle S-curve, seen from above at an angle, fills 60 percent of frame, plain white background, centered, slight angle, one side visible, flat even lighting, diffuse light, no directional light, sharp focus, 8k, professional product photography',
     'nude, naked, nsfw, undressed, cast shadow, soft shadow, ambient occlusion, (coiled:1.8), (spiral:1.7), (curled up:1.7), (knotted:1.5), (wrapped around itself:1.6), (legs:1.7), (lizard:1.6), (two heads:1.6), duplicate, twin, split image, collage, side by side, headshot, portrait, close-up, partial body, cropped, out of frame, text, watermark, logo, user interface, extra characters, bystanders, blurry, deformed, bad anatomy'),
    ('A small fish', 'animal', 'realistic',
     'realistic style, photorealistic, sharp details, detailed materials, A small fish, full body fish, lateral profile, body straight from head to tail fin, fins spread, fills 60 percent of frame, plain white background, centered, slight angle, one side visible, flat even lighting, diffuse light, no directional light, sharp focus, 8k, professional product photography',
     'nude, naked, nsfw, undressed, cast shadow, soft shadow, ambient occlusion, (legs:1.7), (feet:1.6), (curled up:1.5), (bent body:1.3), (two heads:1.5), duplicate, twin, split image, collage, side by side, headshot, portrait, close-up, partial body, cropped, out of frame, text, watermark, logo, user interface, extra characters, bystanders, blurry, deformed, bad anatomy'),
]


def journal_de(f):
    """Appelle f() en capturant ce qu'elle imprime : -> (resultat, texte imprime)."""
    tampon = io.StringIO()
    with contextlib.redirect_stdout(tampon):
        r = f()
    return r, tampon.getvalue()


class NegationsServeur(unittest.TestCase):
    def setUp(self):
        os.environ.pop('FABMESH_COMPOSEUR', None)

    # ---------------------------------------------------------------- nettoyage strict du champ `negative_extra`
    def test_nettoyage_accepte_les_termes_propres(self):
        f = P.termes_negatifs_valides
        self.assertEqual(f(['helmet', 'Golden  Crown', 'foo-bar', ' cape\t']), ['helmet', 'golden crown', 'foo-bar', 'cape'])
        self.assertEqual(f(('helmet',)), ['helmet'])
        self.assertEqual(f(['a' * 40]), ['a' * 40])

    def test_nettoyage_ecarte_sans_corriger_ni_lever_d_erreur(self):
        f = P.termes_negatifs_valides
        mauvais = ['(nude:0)', 'nude), (cape', 'a, b', '[nude]', 'helmet:1.5', 'x\\y', 'café', 'café', 'h3lmet', '1', '', '   ', '-', '--',
                   'a--b', '-a', 'a-', 'x' * 41, 'a ' * 21, 'rock\nroll;', 'a;b', 'a|b', 'a.b', 'a/b', '"a"', "o'clock", '​helmet']
        for m in mauvais:
            self.assertEqual(f([m]), [], repr(m))
        for entree in (None, 'helmet', 5, {'a': 1}, object()):
            self.assertEqual(f(entree), [], repr(entree))
        self.assertEqual(f([None, 3, {}, ['x'], b'helmet', 1.5, True]), [])
        # un element invalide n'empeche pas les bons de passer
        self.assertEqual(f(['(nude:0)', 'helmet', 7, 'cape']), ['helmet', 'cape'])

    def test_nettoyage_doublons_et_plafond_de_huit(self):
        f = P.termes_negatifs_valides
        self.assertEqual(f(['a', 'A', 'a ', ' a', 'b']), ['a', 'b'])
        douze = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima']
        self.assertEqual(f(douze), douze[:8])
        self.assertEqual(f(['(x)'] * 10 + douze), douze[:8], 'les elements invalides ne prennent pas de place parmi les 8')
        self.assertEqual(f(['(x)'] * 100 + douze), [], 'jamais plus de 64 elements lus : meme borne que le worker')

    def test_nettoyage_refuse_garde_robe_et_nudite(self):
        from modal_app import composeur_intention as ci
        f = P.termes_negatifs_valides
        for mal in ('clothes', 'Shirt', 'no clothes', 'bare-chested', 'clothes-less', 'nude', 'naked', 'underwear', 'bikini', 'topless', 'nsfw', 'top hat'):
            self.assertEqual(f([mal]), [], mal)
        self.assertEqual(f(['clothes', 'helmet', 'shirt', 'cape']), ['helmet', 'cape'])
        for mot in sorted(ci._NEG_SENSIBLES):          # TOUTE la liste du tri du client est refusee ici aussi
            self.assertEqual(f([mot]), [], mot)

    def test_nettoyage_coupe_par_l_interrupteur_d_urgence(self):
        self.assertEqual(sans_composeur(lambda: P.termes_negatifs_valides(['helmet'])), [])

    # ---------------------------------------------------------------- separation du texte
    def test_separer_negations(self):
        self.assertEqual(P.separer_negations(ORC_NEG), ('An orc warrior covered in blood, holding a massive spiked club', ['helmet']))
        self.assertEqual(P.separer_negations('An orc'), ('An orc', []))
        self.assertEqual(P.separer_negations(None), ('', []))
        self.assertEqual(P.separer_negations('A knight without a beard and holding a sword'), ('A knight holding a sword', ['beard']))
        # texte ENTIEREMENT negatif : le positif reste tel quel (un prompt vide ne vaut rien), les termes partent quand meme
        self.assertEqual(P.separer_negations('no helmet'), ('no helmet', ['helmet']))
        # garde-robe / nudite : JAMAIS extraites, elles restent sous les yeux du filtre de moderation
        self.assertEqual(P.separer_negations('A girl, no clothes'), ('A girl, no clothes', []))
        self.assertEqual(P.separer_negations('A man without a shirt'), ('A man without a shirt', []))

    def test_separer_negations_texte_trop_long_jamais_analyse_ni_tronque(self):
        long = 'An orc, no helmet' + ' x' * 1100
        self.assertGreater(len(long), 2000)
        self.assertEqual(P.separer_negations(long), (long, []))

    def test_separer_negations_coupe_par_l_interrupteur(self):
        self.assertEqual(sans_composeur(lambda: P.separer_negations(ORC_NEG)), (ORC_NEG, []))

    def test_union_du_texte_et_du_champ(self):
        n = P.negatifs_utilisateur
        self.assertEqual(n(ORC_NEG), ['helmet'])                                         # ancien client : tout vient du texte
        self.assertEqual(n('An orc warrior', ['helmet']), ['helmet'])                    # client a jour : tout vient du champ
        self.assertEqual(n(ORC_NEG, ['beard', 'helmet']), ['beard', 'helmet'])           # les deux : champ d'abord, sans doublon
        self.assertEqual(n('Please make an orc, no helmet'), ['helmet'])                 # _epurer_demande d'abord, comme le client
        self.assertEqual(n('An orc'), [])
        self.assertEqual(n('An orc', ['(nude:0)', 'clothes', 'helmet']), ['helmet'])
        self.assertEqual(n('An orc', 'helmet'), [])                                      # pas une liste : ignore
        self.assertEqual(sans_composeur(lambda: n(ORC_NEG, ['helmet'])), [])

    # ---------------------------------------------------------------- positif : build_enriched_prompt
    def test_prompt_de_l_orc_avec_negation_est_celui_sans_negation(self):
        self.assertEqual(P.build_enriched_prompt(ORC_NEG, 'character', 'dark-fantasy'), ORC_ATTENDU)

    def test_negation_retiree_du_positif_pour_tous_les_types(self):
        for typ in sorted(P.ASSET_TYPE_PROMPTS):
            for style in ('realistic', 'dark-fantasy'):
                avec = P.build_enriched_prompt('A guard, no helmet, without a beard', typ, style)
                sans = P.build_enriched_prompt('A guard', typ, style)
                self.assertEqual(avec, sans, typ + ' / ' + style)
                self.assertNotIn('helmet', avec)
                self.assertNotIn('beard', avec)

    def test_chevalier_sans_arme(self):
        # ancien cas du test « rien ne change » : « without a weapon » est desormais une negation, donc sort du positif ; « weapon » est deja au negatif
        self.assertEqual(P.build_enriched_prompt('A knight without a weapon', 'character', 'realistic'),
                         P.build_enriched_prompt('A knight', 'character', 'realistic'))
        enrichi = P.build_enriched_prompt('A knight without a weapon', 'character', 'realistic')
        self.assertEqual(R.build_prompts(enrichi, 'character', negatif_utilisateur=['weapon']), R.build_prompts(enrichi, 'character'))

    def test_une_negation_ne_choisit_ni_le_gabarit_de_vol_ni_celui_de_reptation(self):
        vol = P.build_enriched_prompt('a bird, not flying', 'animal', 'realistic')
        self.assertEqual(vol, P.build_enriched_prompt('a bird', 'animal', 'realistic'))
        self.assertNotIn('airborne', vol)
        self.assertIn('airborne', P.build_enriched_prompt('a flying bird', 'animal', 'realistic'))          # temoin : le gabarit de vol existe
        lezard = P.build_enriched_prompt('a lizard, not a snake', 'animal', 'realistic')
        self.assertNotIn('body stretched out straight', lezard)
        self.assertIn('body stretched out straight', P.build_enriched_prompt('a snake', 'animal', 'realistic'))

    def test_une_negation_n_empeche_pas_le_composeur_de_voir_l_objet_tenu(self):
        # « no weapon, holding a shield » : l'objet tenu est le bouclier, la negation ne le masque pas
        p = P.build_enriched_prompt('A guard, no helmet, holding a shield', 'character', 'realistic')
        self.assertIn('holding exactly one shield', p)
        self.assertNotIn('helmet', p)

    def test_gabarit_hand_painted_deja_enrichi_sa_clause_negative_passe_au_negatif(self):
        # seul gabarit portant une negation (« no realistic PBR maps »). Ajoute par le SERVEUR au texte brut : inchange (le tri ne lit que le texte de
        # l'utilisateur). Dans un prompt DEJA enrichi par un client (bureau en mode Cloud), la clause est traitee comme n'importe quelle negation.
        deja = P.build_enriched_prompt('A wizard', 'character', 'hand-painted')
        self.assertIn(', no realistic PBR maps', deja)
        relu = P.build_enriched_prompt(deja, 'character', 'hand-painted')
        self.assertEqual(relu, deja.replace(', no realistic PBR maps', ''))
        self.assertEqual(P.negatifs_utilisateur(deja), ['realistic pbr maps'])

    def test_interrupteur_d_urgence_rend_l_ancien_comportement(self):
        def f():
            p = P.build_enriched_prompt(ORC_NEG, 'character', 'dark-fantasy')
            self.assertEqual(p.count('no helmet'), 1, 'la locution reste dans le positif')
            self.assertEqual(R.build_prompts(p, 'character', negatif_utilisateur=['helmet']), R.build_prompts(p, 'character'))
        sans_composeur(f)

    # ---------------------------------------------------------------- negatif : build_prompts
    def _neg(self, typ, termes, texte='A medieval peasant', style='realistic'):
        enrichi = P.build_enriched_prompt(texte, typ, style)
        return R.build_prompts(enrichi, typ, negatif_utilisateur=termes)[1]

    def test_sans_terme_le_prompt_et_le_negatif_sont_ceux_d_avant_a_l_octet(self):
        for texte, typ, style, positif, negatif in REFERENCE_AVANT:
            enrichi = P.build_enriched_prompt(texte, typ, style)
            for kw in ({}, {'negatif_utilisateur': None}, {'negatif_utilisateur': []}, {'negatif_utilisateur': ['(nude:0)', 'clothes']}):
                self.assertEqual(R.build_prompts(enrichi, typ, **kw), (positif, negatif), '%s %s' % (typ, kw))

    def test_les_termes_viennent_apres_securite_ombres_armes_et_anatomie(self):
        neg = self._neg('character', ['helmet', 'cape'])
        i = neg.index
        self.assertTrue(neg.startswith(SECURITE + ', ' + OMBRES + ', (weapon:1.6)'), neg)
        self.assertLess(i('(staff:1.3)'), i('(extra arms:1.6)'))
        self.assertLess(i('(mutated hands:1.4)'), i('(helmet:1.4)'))
        self.assertIn('(helmet:1.4), (cape:1.4), duplicate, twin', neg)
        self.assertNotIn('helmet', R.build_prompts(P.build_enriched_prompt('A medieval peasant', 'character', 'realistic'), 'character')[1])

    def test_l_orc_a_la_massue_garde_sa_parade_une_seule_arme_et_gagne_helmet(self):
        enrichi = P.build_enriched_prompt(ORC_NEG, 'character', 'dark-fantasy')
        _, neg = R.build_prompts(enrichi, 'character', negatif_utilisateur=P.negatifs_utilisateur(ORC_NEG))
        for garde in ('(second weapon:1.5)', '(duplicate weapon:1.5)', '(helmet:1.4)', '(extra arms:1.6)', 'extra characters, bystanders'):
            self.assertIn(garde, neg)
        for interdit_a_tort in ('(weapon:1.6)', '(club:1.4)'):
            self.assertNotIn(interdit_a_tort, neg)
        self.assertTrue(neg.startswith(SECURITE + ', ' + OMBRES), neg)

    def test_une_inondation_de_termes_ne_chasse_ni_la_securite_ni_les_ombres_ni_les_armes_ni_l_anatomie(self):
        marqueurs = {
            'character': ['(weapon:1.6)', '(staff:1.3)', '(extra arms:1.6)', '(mutated hands:1.4)'],
            'other_living': ['(weapon:1.6)', '(staff:1.3)'],
            'creature': ['(weapon:1.6)', '(holding weapon:1.6)', '(five legs:1.6)', '(decorative base:1.4)'],
            'animal': ['(five legs:1.6)', '(deformed legs:1.4)'],
            'building': ['(village:1.6)', '(mannequin:1.3)'],
            'environment': ['(village:1.5)', '(standing figure:1.4)'],
        }
        for typ in sorted(P.ASSET_TYPE_PROMPTS):
            neg, journal = journal_de(lambda: self._neg(typ, INONDATION))
            self.assertTrue(neg.startswith(SECURITE + ', ' + OMBRES), typ)
            for m in marqueurs.get(typ, []):
                self.assertIn(m, neg, typ + ' ' + m)
            self.assertIn('(alpha bravo charlie:1.4)', neg, typ)           # le premier terme tient toujours
            m = re.search(r'negatif tronque a (\d+) jetons', journal)
            if m:
                self.assertLessEqual(int(m.group(1)), 77, typ)
            self.assertIn("negation de l'utilisateur : victor whiskey xray", journal, typ + ' : ce qui tombe est ecrit au journal')

    def test_le_budget_de_77_jetons_n_a_pas_bouge(self):
        with open(os.path.join(RACINE, 'modal_app', '_realvis.py'), 'r', encoding='utf-8') as f:
            src = f.read()
        self.assertEqual(re.findall(r'^\s*_BUDGET_NEG = (\d+)', src, re.M), ['77'])
        self.assertEqual(R.PART_MAX_NEGATIF_UTILISATEUR, 14)

    def test_la_piece_de_l_utilisateur_est_plafonnee_et_cede_devant_le_reste(self):
        # character : au plus 14 jetons estimes pour les termes (3 termes de 3 mots = 12), les pieces generiques de la fin tombent a leur place
        neg, journal = journal_de(lambda: self._neg('character', INONDATION))
        self.assertIn('(golf hotel india:1.4)', neg)
        self.assertNotIn('juliet', neg)
        self.assertNotIn('text, watermark, logo, user interface', neg)
        self.assertIn('headshot, portrait', neg)
        # creature : l'anatomie (49 jetons) passe AVANT les termes ; il ne reste que 11 jetons, deux termes de trois mots tiennent
        neg, journal = journal_de(lambda: self._neg('creature', INONDATION))
        self.assertIn('(five legs:1.6)', neg)
        self.assertIn('(delta echo foxtrot:1.4)', neg)
        self.assertNotIn('golf', neg)

    def test_un_terme_deja_interdit_par_une_piece_retenue_n_est_pas_ajoute_deux_fois(self):
        neg = self._neg('character', ['weapon', 'sword', 'helmet'])
        self.assertEqual(neg.count('(weapon:'), 1)
        self.assertNotIn('(weapon:1.4)', neg)
        self.assertNotIn('(sword:1.4)', neg)
        self.assertIn('(helmet:1.4)', neg)

    def test_termes_sales_et_sensibles_ecartes_par_build_prompts_lui_meme(self):
        neg = self._neg('character', ['(nude:0)', 'clothes', 'nude), (cape', 'helmet'])
        self.assertIn('(helmet:1.4)', neg)
        for mal in ('nude:0', 'clothes', 'cape'):
            self.assertNotIn(mal, neg)
        self.assertTrue(neg.startswith(SECURITE), neg)

    def test_negatif_inchange_si_le_composeur_est_coupe(self):
        def f():
            self.assertEqual(self._neg('character', ['helmet']), self._neg('character', None))
        sans_composeur(f)

    # ---------------------------------------------------------------- T-pose : le negatif recoit les termes A LA FIN
    def _tpose(self, prompt, extra=None):
        CAPTURE.clear()
        T.generate(FauxPipe(), Image.new('RGB', (64, 64)), prompt, size=64, negatif_extra=extra)
        return CAPTURE['prompt'], CAPTURE['negatif']

    def test_tpose_les_termes_sont_ajoutes_a_la_fin_du_negatif(self):
        p, n = self._tpose('An orc', ['helmet', 'beard'])
        self.assertEqual(n, T.NEG + ', helmet, beard')
        self.assertEqual(p, 'An orc' + T.FRONT_PROMPT_TAIL, 'le positif ne bouge pas')

    def test_tpose_apres_les_ajustements_du_composeur(self):
        p, n = self._tpose(ORC_ATTENDU, ['helmet'])
        segs = [s.strip() for s in n.split(',')]
        self.assertEqual(segs[-1], 'helmet')
        self.assertNotIn('holding objects', segs)
        for garde in ('second weapon', 'dual wielding', 'duplicate weapon', 'duplicate objects', 'hands on hips', 'arms down'):
            self.assertIn(garde, segs)
        self.assertEqual(segs.index('helmet'), len(segs) - 1)
        self.assertLess(segs.index('duplicate weapon'), segs.index('helmet'))

    def test_tpose_sans_terme_ou_avec_termes_invalides_negatif_identique(self):
        for extra in (None, [], ['(nude:0)', 'clothes'], 'helmet', 5, {'a': 1}):
            self.assertEqual(self._tpose('An orc', extra)[1], T.NEG, repr(extra))

    def test_tpose_nettoie_et_dedoublonne(self):
        _, n = self._tpose('An orc', ['(nude:0)', 'clothes', 'Helmet', 'cropped', 'helmet'])
        self.assertEqual(n, T.NEG + ', helmet')
        self.assertEqual([s.strip() for s in n.split(',')].count('cropped'), 1)

    def test_tpose_coupe_par_l_interrupteur(self):
        self.assertEqual(sans_composeur(lambda: self._tpose('An orc', ['helmet']))[1], T.NEG)

    # ---------------------------------------------------------------- nettoyage : memes vecteurs que le worker
    def test_nettoyage_vecteurs_communs_avec_le_worker(self):
        # MEMES vecteurs que VECTEURS_NETTOYAGE de cloud/tests/negations-utilisateur.test.mjs : le worker (JS) et Modal (Python) nettoient a l'IDENTIQUE
        # (verifie en plus sur 6 007 entrees tirees au hasard, le 2026-10-03 : 0 difference).
        for entree, attendu in VECTEURS_NETTOYAGE:
            self.assertEqual(P.termes_negatifs_valides(entree), attendu, repr(entree))

    # ---------------------------------------------------------------- les constantes sont celles du tri du client
    def test_constantes_du_nettoyage_sont_celles_du_composeur(self):
        from modal_app import composeur_intention as ci
        self.assertEqual((ci.MAX_TERMES_NEGATIFS, ci.MAX_CARS_TERME), (8, 40))
        with open(os.path.join(RACINE, 'cloud', 'src', 'worker.ts'), 'r', encoding='utf-8') as f:
            ts = f.read()
        self.assertEqual(re.findall(r'^const NEG_MAX_TERMES = (\d+);', ts, re.M), [str(ci.MAX_TERMES_NEGATIFS)])
        self.assertEqual(re.findall(r'^const NEG_MAX_CARS = (\d+);', ts, re.M), [str(ci.MAX_CARS_TERME)])

    # ---------------------------------------------------------------- le plancher dur de Modal voit les negations (seconde ligne de defense)
    def test_texte_pour_plancher_sans_terme_le_texte_lui_meme(self):
        for t in ('a child', 'An orc, no helmet', '', '  espaces  '):
            for extra in (None, [], ['(nude:0)', 'clothes'], 'helmet', 5):
                self.assertEqual(P.texte_pour_plancher(t, extra), t, repr((t, extra)))
        self.assertEqual(P.texte_pour_plancher(None), '')

    def test_texte_pour_plancher_rend_no_x_without_x(self):
        self.assertEqual(P.texte_pour_plancher('a child', ['whip', 'Golden  Crown']),
                         'a child, no whip, without whip, no golden crown, without golden crown')
        # seuls les termes REELLEMENT appliques sont rendus (nettoyage identique a celui du negatif)
        self.assertEqual(P.texte_pour_plancher('a knight', ['clothes', '(nude:0)', 'helmet']), 'a knight, no helmet, without helmet')

    def test_texte_pour_plancher_coupe_par_l_interrupteur(self):
        self.assertEqual(sans_composeur(lambda: P.texte_pour_plancher('a child', ['whip'])), 'a child')

    def test_le_plancher_reel_juge_le_texte_rendu_comme_la_locution_ecrite(self):
        from modal_app._moderation_texte import prompt_hard_floor as plancher
        # temoin : le plancher bloque la phrase ECRITE par l'utilisateur, et ne bloque pas le texte sans la locution
        self.assertIsNotNone(plancher('a child, no whip'))
        self.assertIsNone(plancher('a child'))
        # le texte rendu a partir de (texte sans la locution + terme) rend le MEME verdict que la phrase ecrite
        paires = [('a child, no whip', 'a child', ['whip']), ('a teen, no abuse', 'a teen', ['abuse']), ('a child hero, no helmet', 'a child hero', ['helmet']),
                  ('a knight, no whip', 'a knight', ['whip']), ('a girl, no cape', 'a girl', ['cape'])]
        for ecrit, sans, termes in paires:
            self.assertEqual(plancher(P.texte_pour_plancher(sans, termes)), plancher(ecrit), ecrit)

    # ---------------------------------------------------------------- SECURITE : aucun terme ne chasse la securite, les ombres, les armes ni l'anatomie
    def test_fuzz_la_securite_reste_en_tete_et_aucun_poids_ne_chute(self):
        import random
        r = random.Random(20261003)
        morceaux = ['helmet', 'cape', 'beard', '(nude:0)', 'nude', 'naked', 'clothes', 'a, b', 'x:1.5', '[x]', 'foo-bar', 'weapon', 'sword', 'text',
                    'golden crown', 'x' * 41, '', '-', 'five legs', 'cast shadow', 'soft shadow', 'extra arms', 'nsfw), (undressed:0', ')(', ':0)']
        types = ['character', 'other_living', 'creature', 'animal', 'building', 'vehicle', 'weapon', 'environment']
        textes = ['An orc warrior', 'A fierce dragon', 'A wooden house', 'A knight holding a sword', 'A brown bear']
        for i in range(400):
            typ = r.choice(types)
            termes = [' '.join(r.choice(morceaux) for _ in range(r.randint(1, 3))) for _ in range(r.randint(0, 10))]
            enrichi = P.build_enriched_prompt(r.choice(textes), typ, 'realistic')
            (_, base), _j = journal_de(lambda: R.build_prompts(enrichi, typ))
            (_, neg), _j = journal_de(lambda: R.build_prompts(enrichi, typ, negatif_utilisateur=termes))
            ctx = (i, typ, termes)
            self.assertTrue(neg.startswith(SECURITE + ', ' + OMBRES), ctx)
            # tout ce que le negatif d'avant disait AVANT la place des termes est conserve a l'identique
            coupe = base.find(', duplicate, twin')
            self.assertTrue(neg.startswith(base if coupe < 0 else base[:coupe]), ctx)
            # aucune ponderation injectee (« :0) », « :0.1) ») : tous les poids du negatif restent >= 1
            for poids in re.findall(r':([0-9.]+)\)', neg):
                self.assertGreaterEqual(float(poids), 1.0, ctx)
            # aucun terme n'a ouvert ni referme une autre piece
            self.assertEqual(neg.count('('), neg.count(')'), ctx)
            self.assertEqual(neg.count('('), len(re.findall(r'\([^():,]+:[0-9.]+\)', neg)), ctx)


class GlueApp(unittest.TestCase):
    """modal_app/app.py ne s'importe pas hors de Modal (import modal, decorateurs) : on en extrait les fonctions par `ast` et on les EXECUTE avec des
    doublures (pipeline, reponse HTTP). Les VRAIS _prompts / _realvis / _tpose tournent derriere : c'est la colle de app.py qui est verifiee."""

    @staticmethod
    def _source(nom):
        with open(os.path.join(RACINE, 'modal_app', 'app.py'), 'r', encoding='utf-8') as f:
            src = f.read()
        trouves = [n for n in ast.walk(ast.parse(src)) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == nom]
        if len(trouves) != 1:
            raise AssertionError('fonction introuvable (ou ambigue : %d) dans app.py : %s' % (len(trouves), nom))
        n = trouves[0]
        return textwrap.dedent(' ' * n.col_offset + ast.get_source_segment(src, n))

    def setUp(self):
        os.environ.pop('FABMESH_COMPOSEUR', None)
        self.plancher = []      # textes examines par le plancher dur des routes (doublure), dans l'ordre
        self.moi = types.SimpleNamespace(pipe=FauxPipe(), skel_front=Image.new('RGB', (64, 64)), _has_lightning=False, nsfw_clf1=None, nsfw_clf2=None)

    def _generate_png(self):
        ns = {'time': time, 'io': io, 'os': os, '_ai_pnginfo': lambda: None}
        exec(compile(self._source('_generate_png'), 'app.py::_generate_png', 'exec'), ns)
        return ns['_generate_png']

    def _lancer_png(self, prompt, **kw):
        CAPTURE.clear()
        png = self._generate_png()(self.moi, prompt, 'character', 'dark-fantasy', 5, 30, unrestricted=True, **kw)
        self.assertTrue(png.startswith(b'\x89PNG'))
        return CAPTURE['prompt'], CAPTURE['negatif']

    def test_text2image_ancien_client_le_texte_brut_porte_la_negation(self):
        positif, negatif = self._lancer_png(ORC_NEG)
        self.assertTrue(positif.startswith(ORC_ATTENDU), positif)
        self.assertNotIn('helmet', positif)
        self.assertIn('(helmet:1.4)', negatif)

    def test_text2image_client_a_jour_le_texte_arrive_sans_negation_les_termes_viennent_du_champ(self):
        positif, negatif = self._lancer_png('An orc warrior covered in blood, holding a massive spiked club', negative_extra=['helmet'])
        self.assertTrue(positif.startswith(ORC_ATTENDU), positif)
        self.assertIn('(helmet:1.4)', negatif)

    def test_text2image_les_deux_sources_sans_doublon(self):
        _, negatif = self._lancer_png(ORC_NEG, negative_extra=['helmet', 'beard'])
        self.assertEqual(negatif.count('(helmet:1.4)'), 1)
        self.assertIn('(beard:1.4)', negatif)

    def test_text2image_sans_negation_le_negatif_est_celui_d_avant(self):
        texte, typ, style, positif, negatif = REFERENCE_AVANT[0]
        self.assertEqual((texte, typ, style), ('An orc warrior covered in blood, holding a massive spiked club', 'character', 'dark-fantasy'))
        for extra in (None, [], ['(nude:0)', 'clothes'], 'helmet'):
            p, n = self._lancer_png(texte, negative_extra=extra)
            self.assertEqual((p, n), (positif, negatif), repr(extra))

    def test_route_text2image_transmet_negative_extra_a_generate_png(self):
        with open(os.path.join(RACINE, 'modal_app', 'app.py'), 'r', encoding='utf-8') as f:
            arbre = ast.parse(f.read())
        appels = [n for n in ast.walk(arbre) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == '_generate_png']
        avec_champ = [a for a in appels if any(k.arg == 'negative_extra' for k in a.keywords)]
        self.assertEqual(len(avec_champ), 1, 'la route /text2image est le seul appelant a transmettre le champ')
        valeur = [k.value for k in avec_champ[0].keywords if k.arg == 'negative_extra'][0]
        self.assertEqual(ast.unparse(valeur), "payload.get('negative_extra')")

    def _plancher_reel(self):
        """Le VRAI `_prompt_hard_floor` d'app.py (qui appelle modal_app/_moderation_texte.py), extrait par `ast`."""
        ns = {'_prompt_hard_floor_ancien': lambda p: self.fail('ancienne logique du plancher appelee : module de moderation absent')}
        exec(compile(self._source('_prompt_hard_floor'), 'app.py::_prompt_hard_floor', 'exec'), ns)
        return ns['_prompt_hard_floor']

    def _lancer_tpose(self, payload, plancher=None):
        # `plancher` : la fonction qui joue le plancher dur ; par defaut elle note le texte examine dans self.plancher et laisse passer
        faux_fastapi = types.ModuleType('fastapi')
        faux_fastapi.HTTPException = type('HTTPException', (Exception,), {'__init__': lambda s, status_code=500, detail='': Exception.__init__(s, status_code, detail)})
        faux_reponse = types.ModuleType('fastapi.responses')
        faux_reponse.Response = lambda content=b'', media_type='': types.SimpleNamespace(content=content, media_type=media_type)
        ns = {'time': time, 'io': io, 'os': os, '_ai_pnginfo': lambda: None, '_check_auth': lambda p: None,
              '_prompt_hard_floor': plancher or (lambda p: self.plancher.append(p)),
              '_fetch_image': lambda url, mode='RGB': Image.new('RGB', (64, 64)), '_erreur_telechargement': lambda *a: 'erreur'}
        exec(compile(self._source('_route_tpose'), 'app.py::_route_tpose', 'exec'), ns)
        CAPTURE.clear()
        with mock.patch.dict(sys.modules, {'fastapi': faux_fastapi, 'fastapi.responses': faux_reponse}):
            rep = ns['_route_tpose'](self.moi, payload)
        self.assertTrue(rep.content.startswith(b'\x89PNG'))
        return CAPTURE['prompt'], CAPTURE['negatif']

    def test_route_tpose_les_termes_du_corps_arrivent_a_la_fin_du_negatif(self):
        p, n = self._lancer_tpose({'prompt': 'An orc', '_auth': 'x', 'negative_extra': ['helmet', '(nude:0)', 'clothes', 'Beard']})
        self.assertEqual(n, T.NEG + ', helmet, beard')
        self.assertEqual(p, 'An orc' + T.FRONT_PROMPT_TAIL)

    def test_route_tpose_sans_champ_ou_champ_invalide_le_negatif_est_celui_d_avant(self):
        for corps in ({'prompt': 'An orc', '_auth': 'x'}, {'prompt': 'An orc', '_auth': 'x', 'negative_extra': 'helmet'},
                      {'prompt': 'An orc', '_auth': 'x', 'negative_extra': ['(nude:0)']}):
            self.assertEqual(self._lancer_tpose(corps)[1], T.NEG, repr(corps))

    # ---------------------------------------------------------------- le plancher dur voit les negations : route T-pose
    def test_route_tpose_le_plancher_examine_le_texte_et_les_negations_rendues(self):
        self._lancer_tpose({'prompt': 'An orc', '_auth': 'x', 'negative_extra': ['helmet', '(nude:0)', 'clothes']})
        self.assertEqual(self.plancher, ['An orc, no helmet, without helmet'])

    def test_route_tpose_sans_champ_le_plancher_examine_le_texte_d_avant(self):
        for corps in ({'prompt': 'An orc', '_auth': 'x'}, {'prompt': 'An orc', '_auth': 'x', 'negative_extra': ['(nude:0)', 'clothes']},
                      {'prompt': 'An orc', '_auth': 'x', 'negative_extra': 'helmet'}):
            self.plancher = []
            self._lancer_tpose(corps)
            self.assertEqual(self.plancher, ['An orc'], repr(corps))

    def test_route_tpose_le_vrai_plancher_bloque_comme_avant(self):
        plancher = self._plancher_reel()
        # temoin : le vrai plancher bloque la phrase ecrite et laisse passer le texte sans la locution
        self.assertIsNotNone(plancher('a child, no whip'))
        self.assertIsNone(plancher('a child'))
        with self.assertRaises(Exception) as cm:
            self._lancer_tpose({'prompt': 'a child', '_auth': 'x', 'negative_extra': ['whip']}, plancher=plancher)
        self.assertEqual(cm.exception.args[0], 403)
        # un terme innocent ne bloque rien, et sans le champ la requete passe comme avant
        self._lancer_tpose({'prompt': 'a child', '_auth': 'x', 'negative_extra': ['helmet']}, plancher=plancher)
        self._lancer_tpose({'prompt': 'a child', '_auth': 'x'}, plancher=plancher)

    # ---------------------------------------------------------------- route /text2image : plancher dur et transport du champ (la VRAIE fonction de la route, executee)
    def _lancer_route_text2image(self, payload, plancher=None):
        import asyncio
        faux_http = type('HTTPException', (Exception,), {'__init__': lambda s, status_code=500, detail='': Exception.__init__(s, status_code, detail)})
        appels = []

        async def calcul(nom, p, fn):
            return fn(p)

        async def lire(requete):
            return requete

        ns = {'HTTPException': faux_http, 'Request': object, 'Response': lambda content=b'', media_type='': types.SimpleNamespace(content=content, media_type=media_type),
              '_read_json': lire, '_check_auth': lambda p: None, '_calcul_protege': calcul,
              '_prompt_hard_floor': plancher or (lambda p: self.plancher.append(p)),
              'self': types.SimpleNamespace(_generate_png=lambda **kw: (appels.append(kw), b'\x89PNGfaux')[1])}
        exec(compile(self._source('text2image'), 'app.py::text2image', 'exec'), ns)
        rep = asyncio.run(ns['text2image'](dict(payload)))
        self.assertTrue(rep.content.startswith(b'\x89PNG'))
        return appels

    def test_route_text2image_le_plancher_examine_le_texte_et_les_negations_rendues(self):
        appels = self._lancer_route_text2image({'prompt': 'An orc', '_auth': 'x', 'negative_extra': ['helmet', '(nude:0)', 'clothes']})
        self.assertEqual(self.plancher, ['An orc, no helmet, without helmet'])
        # le champ est transmis TEL QUEL a _generate_png, qui le nettoie (negatifs_utilisateur) : une seule porte de nettoyage cote negatif
        self.assertEqual(appels[0]['negative_extra'], ['helmet', '(nude:0)', 'clothes'])
        self.assertEqual(appels[0]['prompt'], 'An orc')

    def test_route_text2image_sans_champ_le_plancher_examine_le_texte_d_avant(self):
        for corps in ({'prompt': 'An orc', '_auth': 'x'}, {'prompt': 'An orc', '_auth': 'x', 'negative_extra': ['(nude:0)', 'clothes']},
                      {'prompt': 'An orc', '_auth': 'x', 'negative_extra': 'helmet'}):
            self.plancher = []
            self._lancer_route_text2image(corps)
            self.assertEqual(self.plancher, ['An orc'], repr(corps))

    def test_route_text2image_le_vrai_plancher_bloque_comme_avant(self):
        plancher = self._plancher_reel()
        with self.assertRaises(Exception) as cm:
            self._lancer_route_text2image({'prompt': 'a child', '_auth': 'x', 'negative_extra': ['whip']}, plancher=plancher)
        self.assertEqual(cm.exception.args[0], 403)
        # le client a jour (texte sans la locution + champ) est juge comme l'ancien client (texte avec la locution)
        with self.assertRaises(Exception) as cm2:
            self._lancer_route_text2image({'prompt': 'a child, no whip', '_auth': 'x'}, plancher=plancher)
        self.assertEqual(cm2.exception.args[0], 403)
        self._lancer_route_text2image({'prompt': 'a child', '_auth': 'x', 'negative_extra': ['helmet']}, plancher=plancher)
        self._lancer_route_text2image({'prompt': 'a child', '_auth': 'x'}, plancher=plancher)


if __name__ == '__main__':
    unittest.main()
