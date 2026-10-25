"""Tests du composeur d'intention dans le pont du bureau (2026-10-03, scripts/composeur_intention.py + scripts/local_juggernaut_bridge.py).

Le pont charge des modeles sur GPU : on ne peut pas le lancer ici. On teste donc (1) les fonctions du composeur qu'il appelle, (2) le VRAI texte
du negatif T-pose du pont, extrait de sa source par `ast` et evalue avec les memes variables, (3) que le branchement est bien en place.

Prouve : sans objet tenu, le negatif des armes est IDENTIQUE a l'ancien litteral ; avec « holding a massive spiked club », la massue n'est plus
interdite, « une seule arme » est protegee, et le negatif T-pose ne contient plus « asymmetric ».

NEGATIONS DE L'UTILISATEUR (2026-10-03) : le VRAI code du pont qui calcule les termes (bloc `_neg_utilisateur`) et celui qui les ajoute au negatif sont extraits par `ast` et
executes ; les quatre negatifs ecrits dans le pont (T-pose, animal / creature, batiment / environnement, autres) sont evalues tels quels.

Lancer :  <python de l'appli> build/bancs/noyaux/test_composeur_pont.py -v
"""
import ast
import importlib.util
import json
import os
import sys
import unittest
from unittest import mock

RACINE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
# PONT_PY / COMPOSEUR_PY : rejouer ces tests contre un ANCIEN pont ou un ancien module (preuve qu'ils echouent sans le changement ; meme usage que MAIN_JS / WORKER_SRC)
PONT = os.environ.get('PONT_PY') or os.path.join(RACINE, 'scripts', 'local_juggernaut_bridge.py')
CHEMIN = os.environ.get('COMPOSEUR_PY') or os.path.join(RACINE, 'scripts', 'composeur_intention.py')

ANCIEN_NEGATIF_ARMES = "weapon, holding weapon, sword, blade, knife, spear, axe, club, shield, bow, gun, staff, "


def lire(chemin):
    with open(chemin, 'r', encoding='utf-8') as f:
        return f.read()


def charger():
    spec = importlib.util.spec_from_file_location('composeur_intention_sous_test', CHEMIN)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def negatif_tpose_du_pont(armes_neg):
    """Evalue le litteral `negative_prompt = (...)` de la branche T-pose du pont, tel qu'il est ecrit dans la source."""
    arbre = ast.parse(lire(PONT))
    trouves = []

    class V(ast.NodeVisitor):
        def visit_If(self, n):
            if isinstance(n.test, ast.Name) and n.test.id == '_is_tpose':
                for c in n.body:
                    if isinstance(c, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'negative_prompt' for t in c.targets):
                        trouves.append(c.value)
            self.generic_visit(n)

    V().visit(arbre)
    assert len(trouves) == 1, 'negatif T-pose introuvable dans le pont (%d)' % len(trouves)
    return eval(compile(ast.Expression(trouves[0]), PONT, 'eval'), {'_armes_neg': armes_neg})


class ComposeurPont(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.C = charger()

    def test_sans_objet_tenu_le_negatif_des_armes_est_celui_d_avant(self):
        for texte in ('An orc', 'A medieval peasant', 'A knight without a weapon', 'A monk, unarmed', 'A man holding his breath'):
            it = self.C.analyser(texte, 'character', '')
            np_ = self.C.negatifs_pont('character', it)
            self.assertEqual(np_['armes'], ANCIEN_NEGATIF_ARMES, texte)
            self.assertEqual(np_['retirer'], [], texte)
            self.assertEqual(np_['ajouter'], [], texte)

    def test_orc_massue_la_massue_n_est_plus_interdite_et_une_seule_arme_est_protegee(self):
        it = self.C.analyser('An orc warrior covered in blood, holding a massive spiked club', 'character', '')
        armes = self.C.negatifs_pont('character', it)['armes']
        morceaux = [s.strip() for s in armes.split(',') if s.strip()]
        for interdit_a_tort in ('weapon', 'holding weapon', 'club'):
            self.assertNotIn(interdit_a_tort, morceaux)
        for garde in ('sword', 'blade', 'knife', 'spear', 'axe', 'shield', 'bow', 'gun', 'staff', 'second weapon', 'dual wielding', 'duplicate weapon'):
            self.assertIn(garde, morceaux)
        self.assertTrue(armes.endswith(', '), 'le pont concatene cette chaine telle quelle : virgule finale obligatoire')

    def test_negatif_tpose_reel_du_pont(self):
        orc = self.C.analyser('An orc warrior covered in blood, holding a massive spiked club', 'character', '')
        np_ = self.C.negatifs_pont('character', orc)
        avant = negatif_tpose_du_pont(ANCIEN_NEGATIF_ARMES)
        self.assertIn('asymmetric', [s.strip() for s in avant.split(',')], 'le negatif du pont a change : revoir le test')
        apres = negatif_tpose_du_pont(np_['armes'])
        apres = self.C.retirer_jetons(apres, np_['retirer'])
        apres = self.C.ajouter_jetons(apres, np_['ajouter'], en_tete=False)
        segs = [s.strip() for s in apres.split(',') if s.strip()]
        self.assertNotIn('asymmetric', segs)
        self.assertNotIn('club', segs)
        self.assertNotIn('weapon', segs)
        self.assertIn('second weapon', segs)
        self.assertIn('duplicate objects', segs)
        # tout le reste est conserve, dans l'ordre : surete (nude... nsfw) en tete, ombres, anatomie
        self.assertEqual(segs[:7], ['nude', 'naked', 'topless', 'undressed', 'bare skin', 'exposed', 'nsfw'])
        for reste in ('cast shadow', 'soft shadow', 'ambient occlusion', 'dynamic pose', 'blurry', 'deformed', 'bad anatomy', 'worst quality'):
            self.assertIn(reste, segs)
        self.assertEqual(segs[-1], 'duplicate objects')
        # sans objet tenu : le negatif T-pose est identique a l'octet a celui d'avant
        sans = self.C.analyser('An orc', 'character', '')
        n2 = self.C.negatifs_pont('character', sans)
        t = negatif_tpose_du_pont(n2['armes'])
        t = self.C.retirer_jetons(t, n2['retirer'])
        t = self.C.ajouter_jetons(t, n2['ajouter'], en_tete=False)
        self.assertEqual(t, avant)

    def test_retirer_jetons_ne_retire_que_les_segments_exacts(self):
        c = self.C
        self.assertEqual(c.retirer_jetons('a, b, c, ', ['b']), 'a, c, ')
        self.assertEqual(c.retirer_jetons('a, B, c', ['b']), 'a, c')
        self.assertEqual(c.retirer_jetons('arms at sides, arm, bent arms', ['arm']), 'arms at sides, bent arms')
        self.assertEqual(c.retirer_jetons('a, b', []), 'a, b')
        self.assertEqual(c.retirer_jetons('a, b', ['zzz']), 'a, b')

    def test_ajouter_jetons(self):
        c = self.C
        self.assertEqual(c.ajouter_jetons('a, b, ', ['c'], en_tete=False), 'a, b, c')
        self.assertEqual(c.ajouter_jetons('a, b', ['c', 'a']), 'c, a, b')       # 'a' deja present : jamais en double
        self.assertEqual(c.ajouter_jetons('a, b', ['c', 'd'], en_tete=False), 'a, b, c, d')
        self.assertEqual(c.ajouter_jetons('a, b', []), 'a, b')
        self.assertEqual(c.ajouter_jetons('a, b', ['A'], en_tete=False), 'a, b')

    def test_interrupteur_d_urgence(self):
        os.environ.pop('FABMESH_COMPOSEUR', None)
        self.assertTrue(self.C.actif())
        os.environ['FABMESH_COMPOSEUR'] = '0'
        try:
            self.assertFalse(self.C.actif())
        finally:
            os.environ.pop('FABMESH_COMPOSEUR', None)

    def test_le_branchement_est_en_place(self):
        pont = lire(PONT)
        for marque in ("import composeur_intention as _ci_mod", "os.environ.get('FABMESH_USER_PROMPT') or prompt", "_ci.negatifs_pont(",
                       "_armes_neg = _ci_neg['armes']", "{_sym_pose}", "_ci.retirer_jetons(negative_prompt", "_ci.ajouter_jetons(negative_prompt",
                       "model=_modele_manifeste", "FABMESH_SEED",
                       "import composeur_intention as _cn", "_cn.extraire_negations(_texte_utilisateur)", "os.environ.get('FABMESH_NEGATIVE_EXTRA')",
                       "_cn.ajouter_jetons(negative_prompt, _neg_utilisateur, en_tete=False)", "_ci.analyser(_texte_composeur"):
            self.assertIn(marque, pont, 'pont : ' + marque)
        main = lire(os.path.join(RACINE, 'src', 'main', 'main.js'))
        self.assertIn("FABMESH_USER_PROMPT: String(rawPrompt || '').slice(0, 2000)", main)
        self.assertIn('FABMESH_NEGATIVE_EXTRA: JSON.stringify(_negatifs)', main)
        ast.parse(pont)    # le pont reste du Python valide


def generate_images():
    """Le noeud AST de generate_images (le pont charge torch : on ne l'importe pas, on lit sa source)."""
    for n in ast.walk(ast.parse(lire(PONT))):
        if isinstance(n, ast.FunctionDef) and n.name == 'generate_images':
            return n
    raise AssertionError('generate_images introuvable dans le pont')


def litteraux_negatifs():
    """Les quatre expressions `negative_prompt = ...` ecrites dans le pont (T-pose, animal / creature, batiment / environnement, autres), evaluees telles quelles."""
    sortie = []
    for n in ast.walk(generate_images()):
        if (isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'negative_prompt' for t in n.targets)
                and not isinstance(n.value, ast.Call)):
            sortie.append(eval(compile(ast.Expression(n.value), PONT, 'eval'), {'_armes_neg': 'weapon, holding weapon, ', '_anatomy': 'curled up, coiled, '}))
    return sortie


class NegationsUtilisateurDansLePont(unittest.TestCase):
    """Les negations de l'utilisateur (« no helmet ») vont au negatif du pont, pour TOUS les types d'asset (2026-10-03)."""

    @classmethod
    def setUpClass(cls):
        cls.C = charger()
        sys.path.insert(0, os.path.join(RACINE, 'scripts'))      # le bloc du pont fait `import composeur_intention`

    def executer_bloc(self, env, prompt='PROMPT ENRICHI'):
        """Execute le VRAI bloc du pont qui calcule _neg_utilisateur (de `_neg_utilisateur = []` au try / except), avec cet environnement."""
        corps = generate_images().body
        debut = next(i for i, n in enumerate(corps) if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == '_neg_utilisateur' for t in n.targets))
        fin = next(i for i in range(debut, len(corps)) if isinstance(corps[i], ast.Try))
        code = compile(ast.Module(body=corps[debut:fin + 1], type_ignores=[]), PONT, 'exec')
        base = {k: v for k, v in os.environ.items() if not k.startswith('FABMESH_')}
        base.update(env)
        ns = {'os': os, 'json': json, 'prompt': prompt, 'print': lambda *a, **k: None}
        with mock.patch.dict(os.environ, base, clear=True):
            exec(code, ns)
        return ns

    def test_les_quatre_negatifs_du_pont_sont_trouves(self):
        self.assertEqual(len(litteraux_negatifs()), 4, 'T-pose, animal / creature, batiment / environnement, autres')

    def test_application_en_queue_apres_toutes_les_branches(self):
        corps = generate_images().body
        idx_branches = [i for i, n in enumerate(corps) if isinstance(n, ast.If) and any(
            isinstance(m, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'negative_prompt' for t in m.targets) and not isinstance(m.value, ast.Call)
            for m in ast.walk(n))]
        self.assertEqual(len(idx_branches), 1, 'un seul if / else porte les quatre negatifs')
        idx_appli = [i for i, n in enumerate(corps) if isinstance(n, ast.If) and '_neg_utilisateur' in ast.unparse(n.test) and 'ajouter_jetons' in ast.unparse(n)]
        self.assertEqual(len(idx_appli), 1, "l'application est une instruction du CORPS de la fonction, pas d'une branche")
        self.assertGreater(idx_appli[0], idx_branches[0], "apres le if / else du negatif : elle couvre T-pose ET les autres branches")
        appel = ast.unparse(corps[idx_appli[0]])
        self.assertIn('_cn.ajouter_jetons(negative_prompt, _neg_utilisateur, en_tete=False)', appel)

    def test_le_vrai_code_du_pont_ajoute_les_termes_en_queue_de_chaque_negatif(self):
        corps = generate_images().body
        stmt = next(n for n in corps if isinstance(n, ast.If) and '_neg_utilisateur' in ast.unparse(n.test) and 'ajouter_jetons' in ast.unparse(n))
        code = compile(ast.Module(body=[stmt], type_ignores=[]), PONT, 'exec')
        for litteral in litteraux_negatifs():
            ns = {'negative_prompt': litteral, '_neg_utilisateur': ['helmet', 'white curly beard'], '_cn': self.C}
            exec(code, ns)
            segs = [s.strip() for s in ns['negative_prompt'].split(',') if s.strip()]
            self.assertEqual(segs[-2:], ['helmet', 'white curly beard'], litteral[:60])
            self.assertTrue(ns['negative_prompt'].startswith(litteral.rstrip().rstrip(',')), 'le debut du negatif (jetons de securite) ne bouge pas')
            sans = {'negative_prompt': litteral, '_neg_utilisateur': [], '_cn': self.C}
            exec(code, sans)
            self.assertEqual(sans['negative_prompt'], litteral, 'sans negation : le negatif ne change pas d un octet')
            deja = {'negative_prompt': litteral, '_neg_utilisateur': ['blurry', 'cast shadow'], '_cn': self.C}
            exec(code, deja)
            self.assertEqual((deja['negative_prompt'].count('blurry'), deja['negative_prompt'].count('cast shadow')), (litteral.count('blurry'), litteral.count('cast shadow')),
                             'un terme deja present n est jamais ajoute en double')

    def test_le_bloc_du_pont_calcule_les_termes(self):
        ns = self.executer_bloc({'FABMESH_USER_PROMPT': 'An orc, no helmet, holding a club'})
        self.assertEqual(ns['_neg_utilisateur'], ['helmet'])
        self.assertEqual(ns['_texte_composeur'], 'An orc, holding a club', "le composeur d'objets tenus lit le texte SANS ses negations")
        ns = self.executer_bloc({}, prompt='A knight, no shield')
        self.assertEqual(ns['_neg_utilisateur'], ['shield'], 'sans FABMESH_USER_PROMPT : le prompt')

    def test_union_des_termes_du_renderer_et_du_texte_brut(self):
        ns = self.executer_bloc({'FABMESH_USER_PROMPT': 'An orc, no helmet, no beard', 'FABMESH_NEGATIVE_EXTRA': json.dumps(['beard', 'hat'])})
        self.assertEqual(ns['_neg_utilisateur'], ['beard', 'hat', 'helmet'], "le renderer d'abord, puis le texte brut, sans doublon")
        # texte tape dans la langue de l'interface : seul le renderer (texte traduit) a pu extraire quelque chose
        ns = self.executer_bloc({'FABMESH_USER_PROMPT': 'un orc sans casque', 'FABMESH_NEGATIVE_EXTRA': json.dumps(['helmet'])})
        self.assertEqual(ns['_neg_utilisateur'], ['helmet'])
        self.assertEqual(ns['_texte_composeur'], 'un orc sans casque')

    def test_entrees_invalides_ecartees(self):
        ns = self.executer_bloc({'FABMESH_USER_PROMPT': 'An orc', 'FABMESH_NEGATIVE_EXTRA': 'pas du json'})
        self.assertEqual(ns['_neg_utilisateur'], [])
        ns = self.executer_bloc({'FABMESH_USER_PROMPT': 'An orc', 'FABMESH_NEGATIVE_EXTRA': json.dumps(['Bad!', 12, 'ok term', ['x'], 'x' * 41, None])})
        self.assertEqual(ns['_neg_utilisateur'], ['ok term'])
        ns = self.executer_bloc({'FABMESH_USER_PROMPT': 'An orc', 'FABMESH_NEGATIVE_EXTRA': json.dumps({'a': 'b'})})
        self.assertEqual(ns['_neg_utilisateur'], [])

    def test_huit_termes_au_plus(self):
        noms = ['hat', 'coat', 'boots', 'gloves', 'scarf', 'belt', 'cape', 'mask', 'ring', 'sock', 'vest', 'cloak']
        ns = self.executer_bloc({'FABMESH_USER_PROMPT': 'A knight, ' + ', '.join('no ' + n for n in noms),
                                 'FABMESH_NEGATIVE_EXTRA': json.dumps(['one', 'two', 'three'])})
        self.assertEqual(len(ns['_neg_utilisateur']), 8)
        self.assertEqual(ns['_neg_utilisateur'][:3], ['one', 'two', 'three'])

    def test_interrupteur_d_urgence_et_texte_sans_negation(self):
        ns = self.executer_bloc({'FABMESH_USER_PROMPT': 'An orc, no helmet', 'FABMESH_NEGATIVE_EXTRA': json.dumps(['helmet']), 'FABMESH_COMPOSEUR': '0'})
        self.assertEqual(ns['_neg_utilisateur'], [], 'FABMESH_COMPOSEUR=0 coupe aussi les negations')
        self.assertEqual(ns['_texte_composeur'], 'An orc, no helmet')
        ns = self.executer_bloc({'FABMESH_USER_PROMPT': 'An orc warrior holding a massive spiked club'})
        self.assertEqual(ns['_neg_utilisateur'], [])
        self.assertEqual(ns['_texte_composeur'], 'An orc warrior holding a massive spiked club')

    def test_texte_entierement_negatif_garde_son_texte_pour_le_composeur(self):
        ns = self.executer_bloc({'FABMESH_USER_PROMPT': 'no helmet'})
        self.assertEqual(ns['_neg_utilisateur'], ['helmet'])
        self.assertEqual(ns['_texte_composeur'], 'no helmet')

    def test_le_composeur_d_objets_tenus_lit_le_texte_sans_negation(self):
        pont = lire(PONT)
        self.assertIn('_ci.analyser(_texte_composeur, _asset_type', pont)
        ns = self.executer_bloc({'FABMESH_USER_PROMPT': 'A knight, no weapon, holding a shield'})
        it = self.C.analyser(ns['_texte_composeur'], 'character', '')
        self.assertEqual([o['cls'] for o in it['objets']], ['shield'], 'le texte brut disait « no weapon » : plus d objet tenu')
        brut = self.C.analyser('A knight, no weapon, holding a shield', 'character', '')
        self.assertEqual(brut['objets'], [], 'temoin : sur le texte BRUT l objet disparaissait')


if __name__ == '__main__':
    unittest.main()
