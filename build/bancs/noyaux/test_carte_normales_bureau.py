"""Branchement de la carte de normales dans le chemin d'export du BUREAU (scripts/trellis2_native_full_pipeline.py, 2026-10-14).

Le pipeline exige TRELLIS-2 et le GPU : on verifie sa STRUCTURE (analyse du texte), comme garde de non-regression :
  - ajouter_carte_normales est appele sur le maillage FIN (mesh.vertices, mesh.faces), APRES le retrait d'alpha et AVANT glb.export ;
  - l'appel est protege par carte_normales_active() et par un try/except (repli sans carte) ;
  - preencoder_normales (WebP sans perte) est appele avant l'export WebP.
Lancer : python build/bancs/noyaux/test_carte_normales_bureau.py -v   (PIPELINE_BUREAU=<autre copie> pour la preuve d'echec)
"""
import os
import unittest

RACINE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
CHEMIN = os.environ.get('PIPELINE_BUREAU') or os.path.join(RACINE, 'scripts', 'trellis2_native_full_pipeline.py')


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

    def test_interrupteur_et_repli(self):
        cuisson = self.pos('ajouter_carte_normales(glb, mesh.vertices, mesh.faces')
        bloc = self.src[self.src.rfind('try:', 0, cuisson):cuisson]
        self.assertIn('carte_normales_active()', bloc)
        self.assertIn('except Exception', self.src[cuisson:cuisson + 400])

    def test_sans_perte(self):
        self.assertLess(self.pos('preencoder_normales(glb'), self.pos('glb.export(out_glb, extension_webp=True)'))


if __name__ == '__main__':
    unittest.main()
