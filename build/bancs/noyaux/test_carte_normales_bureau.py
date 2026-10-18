"""Branchement de la carte de normales dans le chemin d'export du BUREAU (scripts/trellis2_native_full_pipeline.py, 2026-10-14 ;
OPTION PAR GENERATION et plafond, 2026-10-15, decision du proprietaire : « Game-engine relief (normal map) », desactivee par defaut).

Le pipeline exige TRELLIS-2 et le GPU : on ne le lance pas. On verifie
  (1) sa STRUCTURE (analyse du texte), comme garde de non-regression :
      - ajouter_carte_normales est appele sur le maillage FIN (mesh.vertices, mesh.faces), APRES le retrait d'alpha et AVANT glb.export ;
      - l'appel est protege par carte_normales_voulue(option_carte_normales()) (option par generation ET interrupteur d'urgence)
        et par un try/except (repli sans carte) ;
      - preencoder_normales (WebP sans perte) est appele avant l'export WebP ;
  (2) son COMPORTEMENT : le bloc « carte de normales » est extrait par l'AST puis EXECUTE avec une doublure de ajouter_carte_normales
      (option_carte_normales et carte_normales_voulue sont les VRAIES fonctions de scripts/normal_bake.py) :
      - SANS l'option (variable FABMESH_NORMAL_MAP_OPTION absente, "0", "true", "yes", "11"...) la cuisson n'est JAMAIS appelee : le GLB est
        celui d'avant la carte, a l'octet ;
      - AVEC l'option ("1") elle est appelee UNE fois, sur le maillage fin, sans taille explicite (le plafond de 2048 px est celui du noyau) ;
      - l'interrupteur d'urgence FABMESH_NORMAL_MAP=0 l'emporte sur l'option ;
      - une panne de la cuisson : une ligne de journal, aucune exception, pas de carte.
Lancer : python build/bancs/noyaux/test_carte_normales_bureau.py -v   (PIPELINE_BUREAU=<autre copie> pour la preuve d'echec)
"""
import ast
import contextlib
import importlib.util
import os
import sys
import textwrap
import types
import unittest

RACINE =os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
CHEMIN = os.environ.get('PIPELINE_BUREAU') or os.path.join(RACINE, 'scripts', 'trellis2_native_full_pipeline.py')
NOYAU = os.environ.get('NOYAU_NORMAL_BAKE') or os.path.join(RACINE, 'scripts', 'normal_bake.py')


@contextlib.contextmanager
def environnement(**valeurs):
    """Pose (ou retire, si None) des variables d'environnement le temps du bloc."""
    avant = {k: os.environ.get(k) for k in valeurs}
    try:
        for k, v in valeurs.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        yield
    finally:
        for k, v in avant.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


class BranchementBureau(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(CHEMIN, encoding='utf-8') as f:
            cls.src = f.read()

    def pos(self, motif):
        i = self.src.find(motif)
        self.assertGreaterEqual(i, 0, 'absent : ' + motif)
        return i

    def test_ordre(self):
        alpha = self.pos('_strip_opaque_alpha(glb)')
        cuisson = self.pos('ajouter_carte_normales(glb, mesh.vertices, mesh.faces')
        export = self.pos('glb.export(out_glb, extension_webp=True)')
        self.assertLess(alpha, cuisson)
        self.assertLess(cuisson, export)

    def test_option_interrupteur_et_repli(self):
        cuisson = self.pos('ajouter_carte_normales(glb, mesh.vertices, mesh.faces')
        bloc = self.src[self.src.rfind('try:', 0, cuisson):cuisson]
        self.assertIn('carte_normales_voulue(option_carte_normales())', bloc)
        self.assertIn('except Exception', self.src[cuisson:cuisson + 400])

    def test_sans_perte(self):
        self.assertLess(self.pos('preencoder_normales(glb'), self.pos('glb.export(out_glb, extension_webp=True)'))


def _bloc_carte_normales(src):
    """(source de l'affectation `carte_normales = False` + du `try` qui la suit) dans main(), extraits par l'AST."""
    arbre = ast.parse(src)
    for noeud in arbre.body:
        if isinstance(noeud, ast.FunctionDef) and noeud.name == 'main':
            for i, st in enumerate(noeud.body[:-1]):
                if (isinstance(st, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'carte_normales' for t in st.targets)
                        and isinstance(noeud.body[i + 1], ast.Try)):
                    lignes = src.splitlines()
                    return textwrap.dedent('\n'.join(lignes[st.lineno - 1:noeud.body[i + 1].end_lineno]))
    raise AssertionError('bloc « carte_normales = False / try » introuvable dans main()')


class ComportementDuBlocBureau(unittest.TestCase):
    """EXECUTE le vrai bloc du pipeline avec une doublure de la cuisson ; la decision (option + interrupteur) est celle du vrai noyau."""

    @classmethod
    def setUpClass(cls):
        with open(CHEMIN, encoding='utf-8') as f:
            cls.bloc = _bloc_carte_normales(f.read())
        spec = importlib.util.spec_from_file_location('normal_bake_reel_pour_le_bureau', NOYAU)
        cls.reel = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.reel)

    def executer(self, retour=None, panne=None, **env):
        """Rend (carte_normales, appels, journal) apres execution du bloc avec les variables d'environnement `env`."""
        appels, journal = [], []

        def cuire(glb, vertices, faces, *args, **kw):
            appels.append(((glb, vertices, faces) + args, kw))
            if panne:
                raise panne
            return {'posee': True} if retour is None else retour

        faux = types.ModuleType('normal_bake')
        faux.__dict__.update({nom: getattr(self.reel, nom) for nom in dir(self.reel) if not nom.startswith('__')})
        faux.ajouter_carte_normales = cuire
        glb, mesh = object(), types.SimpleNamespace(vertices=object(), faces=object())
        ancien = sys.modules.get('normal_bake')
        sys.modules['normal_bake'] = faux
        espace = {'glb': glb, 'mesh': mesh, 'log': journal.append}
        try:
            with environnement(FABMESH_NORMAL_MAP=env.get('FABMESH_NORMAL_MAP'), FABMESH_NORMAL_MAP_OPTION=env.get('FABMESH_NORMAL_MAP_OPTION')):
                exec(compile(self.bloc, 'bloc_carte_normales', 'exec'), espace)
        finally:
            if ancien is None:
                sys.modules.pop('normal_bake', None)
            else:
                sys.modules['normal_bake'] = ancien
        self.glb, self.mesh = glb, mesh
        return espace['carte_normales'], appels, journal

    def test_sans_option_la_cuisson_n_est_jamais_appelee(self):
        """Variable absente, ou toute valeur autre que « 1 » : aucun appel, carte_normales faux -> GLB d'avant, a l'octet."""
        for valeur in (None, '', ' ', '0', 'true', 'True', 'yes', 'on', 'oui', '2', '11', '-1', 'false'):
            carte, appels, journal = self.executer(FABMESH_NORMAL_MAP_OPTION=valeur)
            self.assertFalse(carte, repr(valeur))
            self.assertEqual(appels, [], 'cuisson appelee sans option (valeur %r)' % (valeur,))
            self.assertEqual(journal, [], 'aucune ligne de journal sans option : %r' % (journal,))

    def test_sans_option_meme_interrupteur_ouvert(self):
        """FABMESH_NORMAL_MAP=1 (ou absente) ne suffit pas : c'est l'OPTION qui decide, jamais l'interrupteur."""
        for interrupteur in (None, '1', 'true'):
            carte, appels, _ = self.executer(FABMESH_NORMAL_MAP=interrupteur)
            self.assertFalse(carte)
            self.assertEqual(appels, [], repr(interrupteur))

    def test_avec_option_la_carte_est_cuite_une_fois_sur_le_maillage_fin(self):
        for valeur in ('1', ' 1 '):
            carte, appels, _ = self.executer(FABMESH_NORMAL_MAP_OPTION=valeur)
            self.assertTrue(carte, repr(valeur))
            self.assertEqual(len(appels), 1)
            args, kw = appels[0]
            self.assertIs(args[0], self.glb)
            self.assertIs(args[1], self.mesh.vertices, 'la carte doit etre cuite depuis le maillage FIN')
            self.assertIs(args[2], self.mesh.faces)
            self.assertEqual(len(args), 3, 'aucune taille explicite : le plafond (2048) est celui du noyau')
            self.assertEqual(sorted(kw), ['log'], 'ni texture_size ni plafond passes par le pipeline')

    def test_l_interrupteur_d_urgence_l_emporte_sur_l_option(self):
        for coupe in ('0', 'false', 'off', 'non', 'no', ' 0 '):
            carte, appels, _ = self.executer(FABMESH_NORMAL_MAP_OPTION='1', FABMESH_NORMAL_MAP=coupe)
            self.assertFalse(carte, coupe)
            self.assertEqual(appels, [], coupe)
        carte, appels, _ = self.executer(FABMESH_NORMAL_MAP_OPTION='1', FABMESH_NORMAL_MAP='1')
        self.assertTrue(carte)
        self.assertEqual(len(appels), 1)

    def test_carte_non_posee_ou_panne_ne_cassent_pas_l_export(self):
        carte, appels, _ = self.executer(retour={'posee': False, 'raison': 'rien a cuire'}, FABMESH_NORMAL_MAP_OPTION='1')
        self.assertFalse(carte)
        self.assertEqual(len(appels), 1)
        carte, _, _ = self.executer(retour={}, FABMESH_NORMAL_MAP_OPTION='1')       # pas de cle « posee » : pas de carte, donc pas de pre-encodage
        self.assertFalse(carte)
        carte, appels, journal = self.executer(panne=RuntimeError('panne simulee'), FABMESH_NORMAL_MAP_OPTION='1')
        self.assertFalse(carte)
        self.assertEqual(len(appels), 1)
        self.assertTrue([l for l in journal if 'carte de normales ignoree' in l and 'panne simulee' in l], journal)


if __name__ == '__main__':
    unittest.main()
