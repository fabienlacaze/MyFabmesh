"""Bornes du texte envoye au generateur cote Modal (audit langue / moderation du 11/10/2026 : MODERATION-07, SERVEUR-09,
SERVEUR-18, MANQUE-SERV-06). Aucun GPU, aucun modele, aucun reseau : les fonctions sont chargees depuis leurs fichiers
(app.py par son arbre syntaxique, sans importer modal ni fastapi).

Exige :
  - modal_app/_prompts.py::_epurer_demande : meme resultat que l'ancienne expression de fin de demande, mais LINEAIRE
    (32 000 blancs coutaient 12,6 s, sous le verrou GPU) ;
  - _sdxl_prompt_utils (copie du bureau scripts/ ET copie Modal) : poids bornes dans [0,5 ; 2], poids mal forme sans
    ValueError, profondeur de parentheses bornee (32 000 « (a » coutaient 19 s), jetons speciaux « <|endoftext|> » casses
    avant la tokenisation ;
  - modal_app/app.py::_read_json : champs de texte libre bornes (400 au-dela de la borne) et neutralises, une fois pour toutes
    les routes ; repli sur le texte tel quel si le module de moderation manque.

Lancer :  <python> build/bancs/noyaux/test_prompt_bornes.py -v
Ancien code (preuve d'echec) : PROMPTS_PY=<ancien _prompts.py> SDXL_UTILS=<ancien _sdxl_prompt_utils.py> NOYAU_APP=<ancien app.py>
"""
import ast
import asyncio
import importlib.util
import os
import random
import re
import sys
import time
import types
import unittest

RACINE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
CHEMIN_PROMPTS = os.environ.get('PROMPTS_PY') or os.path.join(RACINE, 'modal_app', '_prompts.py')
CHEMINS_SDXL = [os.environ['SDXL_UTILS']] if os.environ.get('SDXL_UTILS') else [
    os.path.join(RACINE, 'modal_app', '_sdxl_prompt_utils.py'), os.path.join(RACINE, 'scripts', '_sdxl_prompt_utils.py')]
CHEMIN_APP = os.environ.get('NOYAU_APP') or os.path.join(RACINE, 'modal_app', 'app.py')
CHEMIN_MODERATION = os.path.join(RACINE, 'modal_app', '_moderation_texte.py')


def charger(chemin, nom):
    spec = importlib.util.spec_from_file_location(nom, chemin)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


P = charger(CHEMIN_PROMPTS, 'prompts_sous_test')
ANCIENNE_FIN = re.compile(r"[\s,;.!]*\b(?:please|thanks|thank you|merci)\b[\s.!]*$", re.I)


class TestEpurerDemande(unittest.TestCase):
    def test_meme_resultat_que_l_ancienne_expression(self):
        textes = ['a red dragon, please', 'a red dragon please!!', 'a dragon. Thanks.', 'thanks please', 'a dragon, thank you !',
                  'un dragon merci', 'un dragon, merci beaucoup', 'pleased knight', 'a dragonplease', 'please', 'Please make a cat',
                  'a cat , , please . !', 'a cat\t\nplease', 'a cat, PLEASE', 'thank you', 'a cat thanks you', '', '   ',
                  'I want to make a flying pink pig, please', 'je veux faire un dragon rouge merci']
        rnd = random.Random(1013)
        morceaux = ['a', 'cat', 'please', 'thanks', 'thank you', 'merci', ',', '.', '!', ';', ' ', '  ', '\t', 'dragon', 'pleased']
        for _ in range(3000):
            textes.append(''.join(rnd.choice(morceaux) + rnd.choice(['', ' ']) for _ in range(rnd.randint(1, 8))))
        for t in textes:
            attendu = ANCIENNE_FIN.sub('', t).strip()
            self.assertEqual(P._retirer_politesse_fin(t).strip(), attendu, repr(t))

    def test_lineaire_sur_une_longue_suite_de_blancs(self):
        for texte in ('orc' + ' ' * 32000 + 'x', 'orc' + ', ' * 16000 + 'x', 'orc' + '.' * 32000 + ' please'):
            t0 = time.time()
            P._epurer_demande(texte)
            self.assertLess(time.time() - t0, 1.0, 'quadratique sur %d caracteres' % len(texte))


def _poids(sdxl, texte):
    return dict((c, w) for c, w in sdxl._parse_prompt_attention(texte))


class FauxTokenizer:
    """Tokenizer de test : un identifiant par mot ; « <|endoftext|> » tape tel quel donne le VRAI jeton de fin (49407),
    comme CLIPTokenizer (jetons speciaux reconnus avant le decoupage)."""

    def __call__(self, texte, truncation=False, add_special_tokens=False):
        ids = []
        for mot in re.findall(r'<\|endoftext\|>|<\|startoftext\|>|\S+', texte):
            ids.append(49407 if mot == '<|endoftext|>' else 49406 if mot == '<|startoftext|>' else 1000 + len(mot))
        return types.SimpleNamespace(input_ids=ids)


class FauxTokenizerClip:
    """Decoupage du tokenizer CLIP (suites de lettres, chiffre par chiffre, ponctuation) ; un identifiant DISTINCT par mot."""

    def __init__(self):
        self.ids = {}

    def __call__(self, texte, truncation=False, add_special_tokens=False):
        mots = re.findall(r'[^\W\d_]+|\d|[^\s\w]+|_+', texte.lower())
        return types.SimpleNamespace(input_ids=[self.ids.setdefault(m, 1000 + len(self.ids)) for m in mots])


class TestEncodeurSdxl(unittest.TestCase):
    def test_poids_bornes_et_robustes(self):
        for chemin in CHEMINS_SDXL:
            sdxl = charger(chemin, 'sdxl_sous_test_' + str(abs(hash(chemin))))
            self.assertEqual(_poids(sdxl, 'a (red cape:1.4)')['red cape'], 1.4, chemin)
            self.assertEqual(_poids(sdxl, 'a (cape:99999)')['cape'], 2.0, chemin)
            self.assertEqual(_poids(sdxl, 'a (cape:-5)')['cape'], 0.5, chemin)
            self.assertEqual(_poids(sdxl, 'a (cape:' + '9' * 400 + ')')['cape'], 2.0, chemin)
            profond = sdxl._parse_prompt_attention('(' * 20 + 'cape' + ')' * 20)
            self.assertEqual([w for c, w in profond if 'cape' in c], [2.0], chemin)
            sdxl._parse_prompt_attention('a (cape:..)')          # plus de ValueError (repli tronque a 77 jetons)
            for _, w in sdxl._parse_prompt_attention('[[[[[[[[[[[[[[cape]]]]]]]]]]]]]] ' * 10):
                self.assertTrue(0.5 <= w <= 2.0, chemin)

    def test_profondeur_bornee_et_rapide(self):
        for chemin in CHEMINS_SDXL:
            sdxl = charger(chemin, 'sdxl_rapide_' + str(abs(hash(chemin))))
            for texte in ('(a' * 32000, '[a' * 32000, '(' * 32000 + 'a' + ')' * 32000):
                t0 = time.time()
                sdxl._parse_prompt_attention(texte)
                self.assertLess(time.time() - t0, 2.0, '%s : quadratique sur %d caracteres' % (chemin, len(texte)))

    def test_syntaxe_de_poids_ne_recolle_pas_un_mot(self):
        """Revue du 14/10 (B1) : « na()ked », « (na)(ked) », « (na:9)(ked:7) »... Le lecteur recollait deux morceaux voisins de
        meme poids (apres la borne des poids, 9 et 7 valent tous deux 2) et un antislash seul s'effacait : le modele recevait
        les jetons du mot ENTIER, que le filtre de texte lit en deux mots. Un mot ecrit sans syntaxe n'est jamais coupe."""
        mot = 'na' + 'ked'
        a, b = mot[:2], mot[2:]
        coupes = ['%s()%s' % (a, b), '(%s)(%s)' % (a, b), '%s[]%s' % (a, b), '(%s:1)(%s:1)' % (a, b), '(%s:9)(%s:7)' % (a, b),
                  '(%s:1.2)(%s:1.2)' % (a, b), '((%s))((%s))' % (a, b), '%s\\%s' % (a, b), '%s(:1)%s' % (a, b), '[%s][%s]' % (a, b)]
        for chemin in CHEMINS_SDXL:
            sdxl = charger(chemin, 'sdxl_coupe_' + str(abs(hash(chemin))))
            tok = FauxTokenizerClip()
            id_mot = tok(mot).input_ids[0]
            for coupe in coupes:
                texte = 'a warrior, %s, orc' % coupe
                ids, _ = sdxl._get_prompt_tokens_and_weights(tok, texte)
                self.assertNotIn(id_mot, ids, '%s : %r donne le mot entier au modele (%r)' % (
                    chemin, texte, sdxl._parse_prompt_attention(texte)))
            # sans syntaxe entre deux caracteres de mot, rien ne change
            self.assertEqual(sdxl._parse_prompt_attention('a warrior: strong, ' + mot), [('a warrior: strong, ' + mot, 1.0)], chemin)
            self.assertEqual(sdxl._parse_prompt_attention('(red cape:1.4), (blue hat:1.4)'),
                             [('red cape', 1.4), (', ', 1.0), ('blue hat', 1.4)], chemin)
            self.assertEqual(sdxl._parse_prompt_attention('a (red)(hat)'), [('a ', 1.0), ('red hat', 1.1)], chemin)
            self.assertEqual(sdxl._parse_prompt_attention('a \\(cape\\)'), [('a (cape)', 1.0)], chemin)
            ids, _ = sdxl._get_prompt_tokens_and_weights(tok, 'a warrior, (%s:1.2), orc' % mot)
            self.assertIn(id_mot, ids, chemin)

    def test_jetons_speciaux_casses(self):
        for chemin in CHEMINS_SDXL:
            sdxl = charger(chemin, 'sdxl_jetons_' + str(abs(hash(chemin))))
            ids, _ = sdxl._get_prompt_tokens_and_weights(FauxTokenizer(), 'a knight <|endoftext|> (cape:1.2) <|startoftext|>')
            self.assertNotIn(49407, ids, chemin)
            self.assertNotIn(49406, ids, chemin)


def _fonctions_app(noms):
    """Execute, sans importer modal ni fastapi, les definitions d'app.py demandees (constantes et fonctions de premier niveau)."""
    with open(CHEMIN_APP, encoding='utf-8') as f:
        arbre = ast.parse(f.read())
    garde = []
    for n in arbre.body:
        if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id in noms for t in n.targets):
            garde.append(n)
        elif isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name in noms:
            garde.append(n)
    ns = {}
    exec(compile(ast.Module(body=garde, type_ignores=[]), CHEMIN_APP, 'exec'), ns)
    return ns


class _Http(Exception):
    def __init__(self, status_code, detail=''):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class _Requete:
    def __init__(self, corps):
        self.corps = corps

    async def json(self):
        if isinstance(self.corps, Exception):
            raise self.corps
        return dict(self.corps)


class TestLectureDesRoutes(unittest.TestCase):
    def setUp(self):
        self.avant = {k: sys.modules.get(k) for k in ('fastapi', 'modal_app._moderation_texte')}
        sys.modules['fastapi'] = types.SimpleNamespace(HTTPException=_Http)
        sys.modules['modal_app._moderation_texte'] = charger(CHEMIN_MODERATION, 'moderation_pour_app')
        self.ns = _fonctions_app({'_read_json', '_texte_generateur', '_CHAMPS_TEXTE'})
        self.assertIn('_read_json', self.ns)
        self.lire = lambda corps: asyncio.run(self.ns['_read_json'](_Requete(corps)))

    def tearDown(self):
        for k, v in self.avant.items():
            if v is None:
                sys.modules.pop(k, None)
            else:
                sys.modules[k] = v

    def test_champs_de_texte_neutralises(self):
        p = self.lire({'prompt': 'a (cape:99999) <|endoftext|> warrior', 'prompt_hint': 'x' + chr(1) + 'y', 'target_text': 'shirt',
                       'neg_prompt': '(clothes:-5)', 'style': 'cartoon', 'seed': 4, '_auth': 's'})
        self.assertEqual(p['prompt'], 'a (cape:2)  endoftext  warrior')
        self.assertEqual(p['prompt_hint'], 'xy')
        self.assertEqual(p['neg_prompt'], '(clothes:0.5)')
        self.assertEqual((p['target_text'], p['style'], p['seed'], p['_auth']), ('shirt', 'cartoon', 4, 's'))

    def test_texte_trop_long_refuse_avant_le_plancher(self):
        with self.assertRaises(_Http) as ctx:
            self.lire({'prompt': 'a knight ' * 1000})
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn('too long', ctx.exception.detail)
        self.assertEqual(self.lire({'prompt': 'a knight ' * 400})['prompt'], 'a knight ' * 400)

    def test_corps_invalide_et_module_absent(self):
        with self.assertRaises(_Http) as ctx:
            self.lire(ValueError('pas du json'))
        self.assertEqual(ctx.exception.status_code, 400)
        sys.modules['modal_app._moderation_texte'] = None      # force ImportError : texte tel quel, plutot que plus rien
        self.assertEqual(self.lire({'prompt': 'a (cape:3)'})['prompt'], 'a (cape:3)')


if __name__ == '__main__':
    unittest.main()
