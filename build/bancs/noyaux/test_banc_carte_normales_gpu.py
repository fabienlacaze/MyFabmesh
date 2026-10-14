"""Banc GPU de la verification visuelle de la carte de normales (modal_app/exp_trellis_haute_res.py), 2026-10-14. CPU seul.

Revue de la branche carte-normales (mineur) : le banc propose pour l'essai A/B (`--etape decoder` sur un latent du volume
exp-trellis-latents, FABMESH_NORMAL_MAP=1 puis 0) n'appelait jamais normal_bake, et la variable posee sur le PC n'atteint pas le
conteneur Modal : les deux essais auraient rendu le MEME GLB, sans carte. Desormais `--carte 1` cuit la carte comme la production
(normal_bake.ajouter_carte_normales sur les sommets / faces FINS, repere de la grille) et `--carte 0` (defaut) rend le GLB d'avant,
sous un autre nom de fichier.
Le module importe modal et l'image de production : ses fonctions d'aide sont extraites par l'analyseur (ast) et executees seules ;
la signature de decoder() et l'appel de main() sont verifies sur l'arbre syntaxique.
Lancer :  python build/bancs/noyaux/test_banc_carte_normales_gpu.py -v
RACINE_MODAL : dossier contenant modal_app/ (defaut : la racine du depot) ; preuve d'echec : modal_app/ d'avant le correctif.
"""
import ast
import os
import sys
import types
import unittest

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_carte_normales_outils_cloud import COULEUR, PLAT, RACINE_MODAL, maillage_texture   # noqa: E402


class BancHauteResolution(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        chemin = os.path.join(RACINE_MODAL, 'modal_app', 'exp_trellis_haute_res.py')
        with open(chemin, encoding='utf-8') as f:
            arbre = ast.parse(f.read())
        cls.fonctions = {n.name: n for n in arbre.body if isinstance(n, ast.FunctionDef)}
        aides = [cls.fonctions[n] for n in ('_poser_carte_normales', '_nom_glb') if n in cls.fonctions]
        cls.ns = {}
        exec(compile(ast.Module(body=aides, type_ignores=[]), chemin, 'exec'), cls.ns)

    def test_parametre_carte_transmis(self):
        self.assertTrue('_poser_carte_normales' in self.ns, 'le banc ne sait pas cuire la carte de normales')
        decodeur = self.fonctions['decoder']
        self.assertIn('carte', [a.arg for a in decodeur.args.args])
        self.assertEqual(ast.literal_eval(decodeur.args.defaults[-1]), 0, 'carte doit valoir 0 par defaut (GLB d avant)')
        appels = [ast.unparse(n) for n in ast.walk(self.fonctions['main'])
                  if isinstance(n, ast.Call) and ast.unparse(n.func) == 'decoder.remote']
        self.assertTrue(appels and all('carte' in a for a in appels), appels)
        self.assertIn('_poser_carte_normales(glb, ov, carte', ast.unparse(decodeur))

    def test_carte_cuite_sur_le_maillage_fin_ou_rien(self):
        self.assertTrue('_poser_carte_normales' in self.ns, 'le banc ne sait pas cuire la carte de normales')
        # maillage FIN dans le repere de la grille (Z haut, comme o_voxel) : plan bossele qui recouvre le plan final apres conversion
        n = 81
        xs = np.linspace(-0.42, 0.42, n)
        X, Y = np.meshgrid(xs, xs)
        Vf = np.stack([X.ravel(), Y.ravel(), 0.01 * np.sin(25 * X.ravel()) * np.cos(19 * Y.ravel())], 1).astype(np.float32)
        k = np.arange(n * n).reshape(n, n)
        a, b, c, d = k[:-1, :-1].ravel(), k[:-1, 1:].ravel(), k[1:, 1:].ravel(), k[1:, :-1].ravel()
        Ff = np.concatenate([np.stack([a, b, c], 1), np.stack([a, c, d], 1)]).astype(np.int64)
        ov = types.SimpleNamespace(vertices=Vf, faces=Ff)
        sans = maillage_texture()
        self.assertEqual(self.ns['_poser_carte_normales'](sans, ov, 0, log=None), {})
        self.assertIsNone(sans.visual.material.normalTexture)
        avec = maillage_texture()
        st = self.ns['_poser_carte_normales'](avec, ov, 1, log=None)
        self.assertTrue(st.get('posee'), st)
        self.assertEqual(tuple(st['taille']), (COULEUR, COULEUR))
        carte = np.asarray(avec.visual.material.normalTexture)
        self.assertGreater(int(np.abs(carte.astype(int) - PLAT).max()), 20, 'carte sans relief')
        self.assertEqual(self.ns['_nom_glb']('G1792', 'tranches', 4096, 500000, 0), 'hr_G1792_tranches_t4096_f500000.glb')   # nom d'avant
        self.assertEqual(self.ns['_nom_glb']('G1792', 'tranches', 4096, 500000, 1), 'hr_G1792_tranches_t4096_f500000_carte.glb')


if __name__ == '__main__':
    for flux in (sys.stdout, sys.stderr):
        try:
            flux.reconfigure(encoding='utf-8', errors='replace')
        except Exception:
            pass
    unittest.main()
