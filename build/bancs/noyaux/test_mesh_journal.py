"""Test du journal de grille TRELLIS (constat E-5a / T9, 2026-10-03) : modal_app/_mesh.py.

La classe _EcouteSortie relaie TOUT au flux d'origine (rien ne change dans les journaux Modal) et retient
la phrase « resolution is reduced » que TRELLIS imprime quand il rabat la grille haute. La ligne
`[mesh] TRELLIS-2 inference` doit porter `grille=`.
Lancer :  <python de l'appli> build/bancs/noyaux/test_mesh_journal.py -v    (NOYAU_MESH : autre copie)
"""
import ast
import contextlib
import io
import os
import unittest

RACINE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
CHEMIN = os.environ.get('NOYAU_MESH') or os.path.join(RACINE, 'modal_app', '_mesh.py')


def source():
    with open(CHEMIN, encoding='utf-8') as f:
        return f.read()


class TestJournalGrille(unittest.TestCase):
    def _classe(self):
        arbre = ast.parse(source())
        n = next((n for n in arbre.body if isinstance(n, ast.ClassDef) and n.name == '_EcouteSortie'), None)
        self.assertIsNotNone(n, '_EcouteSortie absente : ancien code')
        espace = {}
        exec(compile(ast.Module(body=[n], type_ignores=[]), CHEMIN, 'exec'), espace)
        return espace['_EcouteSortie']

    def test_relais_et_capture(self):
        Ecoute = self._classe()
        reel = io.StringIO()
        lignes = []
        with contextlib.redirect_stdout(reel):
            with contextlib.redirect_stdout(Ecoute('resolution is reduced', lignes)):
                print('avant')
                print('Due to the limited number of tokens, the resolution is reduced to 1408.')
                print('apres', end='')
                print(' suite')
        self.assertEqual(reel.getvalue(),
                         'avant\nDue to the limited number of tokens, the resolution is reduced to 1408.\napres suite\n')
        self.assertEqual(lignes, ['Due to the limited number of tokens, the resolution is reduced to 1408.'])

    def test_phrase_coupee_en_deux_ecritures(self):
        Ecoute = self._classe()
        lignes = []
        with contextlib.redirect_stdout(io.StringIO()):
            e = Ecoute('resolution is reduced', lignes)
            e.write('the resolution is ')
            e.write('reduced to 1280.\n')
        self.assertEqual(lignes, ['the resolution is reduced to 1280.'])

    def test_aucune_phrase(self):
        Ecoute = self._classe()
        lignes = []
        with contextlib.redirect_stdout(io.StringIO()):
            e = Ecoute('resolution is reduced', lignes)
            e.write('rien a signaler\n')
        self.assertEqual(lignes, [])

    def test_la_ligne_de_journal_porte_la_grille(self):
        s = source()
        i = s.index('TRELLIS-2 inference dt=')
        self.assertIn('grille=', s[i:i + 400])
        self.assertIn('1.0 / float(o_voxel_obj.voxel_size)', s)


if __name__ == '__main__':
    unittest.main()
