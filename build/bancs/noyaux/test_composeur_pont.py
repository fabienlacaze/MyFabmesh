"""Tests du composeur d'intention dans le pont du bureau (2026-10-03, scripts/composeur_intention.py + scripts/local_juggernaut_bridge.py).

Le pont charge des modeles sur GPU : on ne peut pas le lancer ici. On teste donc (1) les fonctions du composeur qu'il appelle, (2) le VRAI texte
du negatif T-pose du pont, extrait de sa source par `ast` et evalue avec les memes variables, (3) que le branchement est bien en place.

Prouve : sans objet tenu, le negatif des armes est IDENTIQUE a l'ancien litteral ; avec « holding a massive spiked club », la massue n'est plus
interdite, « une seule arme » est protegee, et le negatif T-pose ne contient plus « asymmetric ».

Lancer :  <python de l'appli> build/bancs/noyaux/test_composeur_pont.py -v
"""
import ast
import importlib.util
import os
import unittest

RACINE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
PONT = os.path.join(RACINE, 'scripts', 'local_juggernaut_bridge.py')
CHEMIN = os.path.join(RACINE, 'scripts', 'composeur_intention.py')

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
                       "model=_modele_manifeste", "FABMESH_SEED"):
            self.assertIn(marque, pont, 'pont : ' + marque)
        main = lire(os.path.join(RACINE, 'src', 'main', 'main.js'))
        self.assertIn("FABMESH_USER_PROMPT: String(rawPrompt || '').slice(0, 2000)", main)
        ast.parse(pont)    # le pont reste du Python valide


if __name__ == '__main__':
    unittest.main()
