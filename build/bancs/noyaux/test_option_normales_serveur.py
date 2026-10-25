"""Option « relief pour moteur de jeu » (case « Game-engine relief (normal map) ») cote SERVEUR MODAL, 2026-10-15.

Decision du proprietaire (15/10) : la carte de normales n'est plus cuite d'office, c'est une OPTION PAR GENERATION desactivee par defaut.
Ce banc verifie, par ANALYSE DU CODE (aucun GPU, aucun modele, aucun reseau, le SDK Modal n'est pas importe), les invariants que seul un
defaut de branchement peut casser :
  - generate(normal_map=...) vaut FAUX par defaut : tous les autres appelants de generate() (reshape, retexture, lots, bancs) rendent le
    GLB d'avant la carte ;
  - la cuisson (ajouter_carte_normales) n'est atteinte que sous `if normal_map is True` ;
  - aucun autre appel a ajouter_carte_normales hors des chemins connus (generate, pipeline du bureau, banc d'essai) : une cuisson
    « par defaut » ne peut pas se rouvrir par un nouvel appelant ;
  - modal_app/app.py lit le champ `normal_map` de la requete en booleen STRICT (`is True`) : "false", "true", 1, [] ne comptent pas ;
  - le worker n'envoie qu'un booleen (cloud/tests/option-normales.test.mjs) ; le bureau a sa propre variable (test_carte_normales_bureau.py).
Lancer :  python build/bancs/noyaux/test_option_normales_serveur.py -v
RACINE_MODAL : dossier contenant le paquet modal_app a tester (defaut : la racine du depot). Preuve d'echec : extraire modal_app/ d'un
commit d'AVANT l'option (git archive 3886f61a modal_app) dans un dossier et lancer avec RACINE_MODAL=<ce dossier>.
"""
import ast
import os
import unittest
import warnings

RACINE =os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
RACINE_MODAL = os.environ.get('RACINE_MODAL') or RACINE
MODAL = os.path.join(RACINE_MODAL, 'modal_app')

#: fichiers autorises a appeler ajouter_carte_normales (hors sa definition) : le chemin de production de Modal, le pipeline du bureau, et le
#: banc d'essai GPU (--carte), qui choisit lui-meme sa taille et n'est jamais un chemin de production
APPELANTS_AUTORISES = {
    os.path.join('modal_app', '_mesh.py'),
    os.path.join('modal_app', 'exp_trellis_haute_res.py'),
    os.path.join('scripts', 'trellis2_native_full_pipeline.py'),
}


def analyser(chemin):
    with open(chemin, encoding='utf-8') as f:
        src = f.read()
    with warnings.catch_warnings():
        warnings.simplefilter('ignore')          # certains scripts du depot contiennent des « \F » non echappes : sans importance ici
        return src, ast.parse(src)


def appels_de(arbre, nom):
    """Tous les noeuds Call dont la fonction s'appelle `nom` (nom simple ou attribut)."""
    sortie = []
    for n in ast.walk(arbre):
        if isinstance(n, ast.Call):
            f = n.func
            if (isinstance(f, ast.Name) and f.id == nom) or (isinstance(f, ast.Attribute) and f.attr == nom):
                sortie.append(n)
    return sortie


def parents(arbre):
    table = {}
    for p in ast.walk(arbre):
        for enfant in ast.iter_child_nodes(p):
            table[enfant] = p
    return table


def mentionne(noeud, nom):
    return any(isinstance(n, ast.Name) and n.id == nom for n in ast.walk(noeud))


class GenerateDeModal(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.src, cls.arbre = analyser(os.path.join(MODAL, '_mesh.py'))
        cls.generate = next(n for n in cls.arbre.body if isinstance(n, ast.FunctionDef) and n.name == 'generate')

    def test_normal_map_vaut_faux_par_defaut(self):
        args = self.generate.args
        noms = [a.arg for a in args.args + args.kwonlyargs]
        self.assertIn('normal_map', noms, 'generate() n a pas de parametre normal_map : la carte ne peut pas etre une option')
        defauts = dict(zip([a.arg for a in args.args][len(args.args) - len(args.defaults):], args.defaults))
        defauts.update({a.arg: d for a, d in zip(args.kwonlyargs, args.kw_defaults) if d is not None})
        d = defauts.get('normal_map')
        self.assertIsInstance(d, ast.Constant, 'normal_map doit avoir un defaut')
        self.assertIs(d.value, False, 'normal_map doit valoir FAUX par defaut (decision du proprietaire)')

    def test_la_cuisson_n_est_atteinte_que_sous_l_option(self):
        appels = appels_de(self.generate, 'ajouter_carte_normales')
        self.assertEqual(len(appels), 1, 'generate() doit cuire la carte a UN seul endroit')
        table = parents(self.generate)
        n, gardes = appels[0], []
        while n is not self.generate:
            n = table[n]
            if isinstance(n, ast.If):
                gardes.append(n.test)
        self.assertTrue(any(mentionne(g, 'normal_map') for g in gardes),
                        'l appel a ajouter_carte_normales n est pas garde par `normal_map` (carte cuite par defaut)')

    def test_la_garde_est_stricte(self):
        """`if normal_map is True` : un objet quelconque (chaine, entier, liste) n'active pas la cuisson."""
        appels = appels_de(self.generate, 'ajouter_carte_normales')
        table = parents(self.generate)
        n, gardes = appels[0], []
        while n is not self.generate:
            n = table[n]
            if isinstance(n, ast.If):
                gardes.append(n.test)
        stricte = [g for g in gardes if isinstance(g, ast.Compare) and isinstance(g.left, ast.Name) and g.left.id == 'normal_map'
                   and len(g.ops) == 1 and isinstance(g.ops[0], ast.Is) and isinstance(g.comparators[0], ast.Constant)
                   and g.comparators[0].value is True]
        self.assertTrue(stricte, 'aucune garde `normal_map is True` autour de la cuisson')


class AppelantsDeLaCuisson(unittest.TestCase):
    def test_aucun_appel_hors_des_chemins_connus(self):
        trouves = set()
        for dossier in ('modal_app', 'scripts'):
            base = os.path.join(RACINE_MODAL if dossier == 'modal_app' else RACINE, dossier)
            for racine, _, fichiers in os.walk(base):
                for nom in fichiers:
                    if not nom.endswith('.py') or nom.startswith('test_'):
                        continue
                    chemin = os.path.join(racine, nom)
                    rel = os.path.relpath(chemin, RACINE_MODAL if dossier == 'modal_app' else RACINE)
                    if nom == 'normal_bake.py':
                        continue
                    try:
                        _, arbre = analyser(chemin)
                    except (SyntaxError, UnicodeDecodeError):
                        continue
                    if appels_de(arbre, 'ajouter_carte_normales'):
                        trouves.add(rel)
        inconnus = trouves - APPELANTS_AUTORISES
        self.assertFalse(inconnus, 'cuisson de la carte de normales appelee hors des chemins gardes par l option : %s' % sorted(inconnus))
        self.assertIn(os.path.join('modal_app', '_mesh.py'), trouves, 'le chemin de production n appelle plus la cuisson ?')


class LectureDeLOptionParApp(unittest.TestCase):
    """modal_app/app.py : la requete /mesh_start (JSON du worker) est lue en booleen STRICT avant d'atteindre generate()."""

    @classmethod
    def setUpClass(cls):
        cls.src, cls.arbre = analyser(os.path.join(MODAL, 'app.py'))

    def expression_normal_map(self):
        """Expression passee a `normal_map=` dans l'appel a generate(...) de MyFabmeshMesh.generate_to_volume."""
        for classe in [n for n in ast.walk(self.arbre) if isinstance(n, ast.ClassDef) and n.name == 'MyFabmeshMesh']:
            for m in [n for n in classe.body if isinstance(n, ast.FunctionDef) and n.name == 'generate_to_volume']:
                for appel in appels_de(m, 'generate'):
                    for kw in appel.keywords:
                        if kw.arg == 'normal_map':
                            return kw.value
        return None

    def test_generate_to_volume_transmet_l_option(self):
        self.assertIsNotNone(self.expression_normal_map(),
                             'generate_to_volume n envoie pas normal_map a generate() : la case du site serait une option morte')

    def test_lecture_stricte_du_champ(self):
        expr = self.expression_normal_map()
        self.assertIsNotNone(expr)
        code = compile(ast.Expression(body=expr), 'normal_map', 'eval')
        faux = [None, False, 0, 1, 1.0, '', 'true', 'True', '1', 'false', 'False', 'yes', [], [True], {}, {'a': 1}, b'true']
        for valeur in faux:
            self.assertIs(eval(code, {'payload': {'normal_map': valeur}}), False, 'valeur ambigue acceptee : %r' % (valeur,))
        self.assertIs(eval(code, {'payload': {}}), False, 'option absente : doit valoir faux')
        self.assertIs(eval(code, {'payload': {'normal_map': True}}), True)

    def test_les_autres_appels_ne_changent_pas_le_defaut(self):
        """Tout appel a generate() qui passe normal_map doit le faire en lecture stricte ; les autres l'omettent (defaut faux)."""
        for appel in appels_de(self.arbre, 'generate'):
            for kw in appel.keywords:
                if kw.arg == 'normal_map':
                    self.assertIn('is True', ast.unparse(kw.value), ast.unparse(kw.value))


if __name__ == '__main__':
    unittest.main()
