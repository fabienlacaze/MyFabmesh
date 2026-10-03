"""Tests du detourage Lucida sans kornia ni timm (2026-10-03) : scripts/lucida_shims.py, scripts/lucida_matte.py et
la fonction _prep_image de scripts/trellis2_native_full_pipeline.py.

POURQUOI. Lucida (detoureur de la 3D, bien meilleur que u2net sur les bras et les armes) est un modele a code distant qui
importe `timm` et `kornia` ; kornia est absent du Python de l'appli (DLL bloquee par Smart App Control, JAMAIS contourne).
Ces tests prouvent, SANS aucun poids, SANS GPU, SANS reseau :
  (a) le laplacien pur torch egale une reference a boucles ecrite d'apres la definition de kornia (noyaux, bords) ;
  (b) DropPath / to_2tuple / trunc_normal_ se comportent comme ceux de timm (et lui sont identiques bit a bit s'il est la) ;
  (c) le VRAI code distant de Lucida (cache HF, test saute s'il est absent) passe le controle d'imports de transformers
      avec les substituts (et le refuse sans eux), s'importe et son modele se CONSTRUIT sur le peripherique `meta`, en
      evaluation comme en entrainement (la branche d'entrainement est la seule qui appelle `laplacian`) ;
  (e) la recherche des poids (variable, cache de l'appli, cache de l'utilisateur) et le contrat de lucida_matte ;
  (d) _prep_image, extraite par `ast` et executee avec des doublures : succes Lucida, echec du sous-processus -> repli
      u2net, alpha aberrant -> repli, image deja detouree -> aucun detourage, FABMESH_DETOURAGE=u2net.

  (f) le contrat de remove_bg.py (PNG RGBA ecrit en place, « OK: <chemin> », repli u2net) et le lancement REEL de
      scripts/lucida_matte.py par l'interpreteur de l'appli (fichier ._pth : le dossier du script n'est pas sur sys.path),
      sans poids nulle part -> code retour 2, que _prep_image traduit en repli u2net.

Lancer (importe torch : passer par l'executeur commun) :
    bash /c/tmp/lourd.sh <python de l'appli> build/bancs/noyaux/test_lucida_shims.py -v
Autres copies des fichiers (preuve d'echec sur l'ancien code ou sur un mutant) : variables NOYAU_LUCIDA_SHIMS,
NOYAU_LUCIDA_MATTE, NOYAU_PIPELINE3D, NOYAU_REMOVE_BG ; LUCIDA_CODE_DISTANT = dossier du code distant (config + birefnet.py).
Aucun test ne lit de poids, n'utilise la carte graphique ni le reseau (les sous-processus lances posent HF_HUB_OFFLINE=1).
"""
import ast
import contextlib
import glob
import importlib
import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile
import types
import unittest
from unittest import mock

import numpy as np
import torch
from PIL import Image

RACINE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
SHIMS = os.environ.get('NOYAU_LUCIDA_SHIMS') or os.path.join(RACINE, 'scripts', 'lucida_shims.py')
MATTE = os.environ.get('NOYAU_LUCIDA_MATTE') or os.path.join(RACINE, 'scripts', 'lucida_matte.py')
PIPELINE = os.environ.get('NOYAU_PIPELINE3D') or os.path.join(RACINE, 'scripts', 'trellis2_native_full_pipeline.py')
REMOVE_BG = os.environ.get('NOYAU_REMOVE_BG') or os.path.join(RACINE, 'scripts', 'remove_bg.py')


def charger(nom, chemin):
    spec = importlib.util.spec_from_file_location(nom, chemin)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


shims = charger('lucida_shims_sous_test', SHIMS)


class _Absents:
    """Finder d'imports : les paquets `noms` sont introuvables (« No module named ... », comme sur une machine sans eux)."""

    def __init__(self, noms):
        self.noms = noms

    def find_spec(self, nom, chemin=None, cible=None):
        if nom.split('.')[0] in self.noms:
            raise ModuleNotFoundError(f'No module named {nom!r}', name=nom)
        return None


@contextlib.contextmanager
def paquets_absents(*noms):
    """Simule l'ABSENCE des paquets (leur import leve ModuleNotFoundError) ; sys.modules est restaure tel qu'il etait."""
    avant = {k: v for k, v in sys.modules.items() if k.split('.')[0] in noms}
    for k in avant:
        del sys.modules[k]
    finder = _Absents(noms)
    sys.meta_path.insert(0, finder)
    try:
        yield
    finally:
        sys.meta_path.remove(finder)
        for k in [k for k in sys.modules if k.split('.')[0] in noms]:
            del sys.modules[k]
        sys.modules.update(avant)


# ---------------------------------------------------------------------------
# (a) laplacian
# ---------------------------------------------------------------------------
def laplacian_naif(x, k, bordure='reflect', normalise=True):
    """Reference a BOUCLES (numpy float64) d'apres la definition de kornia : noyau de 1 dont le centre vaut 1 - k*k,
    divise par la somme de ses valeurs absolues si `normalise`, bords completes par `bordure`, correlation par canal."""
    ky, kx = k if isinstance(k, tuple) else (k, k)
    noyau = np.ones((ky, kx), dtype=np.float64)
    noyau[ky // 2, kx // 2] = 1 - ky * kx
    if normalise:
        noyau = noyau / np.abs(noyau).sum()
    B, C, H, W = x.shape

    def source(i, n):
        if 0 <= i < n:
            return i
        if bordure == 'reflect':
            return -i if i < 0 else 2 * (n - 1) - i
        if bordure == 'replicate':
            return min(max(i, 0), n - 1)
        if bordure == 'circular':
            return i % n
        return None                                      # constant : zeros

    sortie = np.zeros((B, C, H, W), dtype=np.float64)
    for b in range(B):
        for c in range(C):
            for i in range(H):
                for j in range(W):
                    s = 0.0
                    for a in range(ky):
                        for d in range(kx):
                            yy, xx = source(i + a - ky // 2, H), source(j + d - kx // 2, W)
                            if yy is None or xx is None:
                                continue
                            s += noyau[a, d] * x[b, c, yy, xx]
                    sortie[b, c, i, j] = s
    return sortie


class TestLaplacian(unittest.TestCase):
    def setUp(self):
        g = torch.Generator().manual_seed(1234)
        self.x = torch.randn(2, 3, 7, 9, generator=g, dtype=torch.float64)

    def test_contre_la_reference_a_boucles_tous_noyaux_et_tous_bords(self):
        for k in (3, 5, 7, (3, 5)):
            for bordure in ('reflect', 'replicate', 'circular', 'constant'):
                for normalise in (True, False):
                    with self.subTest(noyau=k, bordure=bordure, normalise=normalise):
                        attendu = laplacian_naif(self.x.numpy(), k, bordure, normalise)
                        obtenu = shims.laplacian(self.x, k, border_type=bordure, normalized=normalise)
                        np.testing.assert_allclose(obtenu.numpy(), attendu, rtol=0, atol=1e-12)

    def test_float32_meme_forme_meme_dtype(self):
        x = self.x.float()
        y = shims.laplacian(x, 5)
        self.assertEqual(y.shape, x.shape)
        self.assertEqual(y.dtype, torch.float32)
        np.testing.assert_allclose(y.numpy(), laplacian_naif(self.x.numpy(), 5), atol=1e-5)

    def test_reponse_impulsionnelle_donne_le_noyau_documente_par_kornia(self):
        # docstring de kornia : get_laplacian_kernel2d(3) = [[1,1,1],[1,-8,1],[1,1,1]], (5) : centre -24
        impulsion = torch.zeros(1, 1, 9, 9)
        impulsion[0, 0, 4, 4] = 1.0
        y3 = shims.laplacian(impulsion, 3, normalized=False)[0, 0, 3:6, 3:6]
        self.assertTrue(torch.equal(y3, torch.tensor([[1., 1., 1.], [1., -8., 1.], [1., 1., 1.]])))
        y5 = shims.laplacian(impulsion, 5, normalized=False)[0, 0, 2:7, 2:7]
        self.assertEqual(float(y5[2, 2]), -24.0)
        self.assertEqual(float(y5.sum()), 0.0)
        # normalise : norme L1 du noyau = 1 (somme des valeurs absolues = 8 + 8 = 16 pour k = 3)
        yn = shims.laplacian(impulsion, 3)[0, 0, 3:6, 3:6]
        self.assertAlmostEqual(float(yn[1, 1]), -0.5, places=6)
        self.assertAlmostEqual(float(yn[0, 0]), 1 / 16, places=6)
        self.assertAlmostEqual(float(yn.abs().sum()), 1.0, places=6)

    def test_valeurs_d_or_relevees_sur_kornia_0_8_3(self):
        # Sorties RELEVEES en executant kornia.filters.laplacian de kornia 0.8.3 (fonctions extraites de ses sources par ast :
        # laplacian, filter2d, get_laplacian_kernel2d, normalize_kernel2d ; le paquet n'est pas importable ici, sa DLL est
        # bloquee). Elles ancrent le substitut sur kornia lui-meme, sans que kornia soit present au moment du test.
        x = (torch.arange(20, dtype=torch.float64).reshape(1, 1, 4, 5) * 0.7).sin() * 3.0
        d_or = {
            (3, 'reflect', True): [
                [-0.543643907, -1.608359061, -2.127517656, -1.646071454, -0.645923478],
                [0.934663635, 1.831648406, 2.064660146, 1.326629959, 0.175515],
                [-1.539664184, -2.076671733, -1.795970904, -0.670596895, 0.57396117],
                [1.939848141, 2.125330583, 1.56061373, 0.261915854, -0.889851902]],
            (5, 'constant', False): [
                [5.773828636, -40.889374634, -66.525809076, -58.276391939, -20.942231148],
                [24.651538908, 65.464972178, 75.745413244, 51.126942305, 3.176004669],
                [-50.931198072, -74.015828294, -62.033450809, -20.150432712, 31.922981899],
                [59.430976578, 66.056488581, 39.938155913, -7.22337888, -52.3316267]],
            ((3, 5), 'circular', True): [
                [-0.189130415, -1.22448027, -1.77288891, -1.576431183, -0.727504228],
                [0.827434497, 1.664422515, 1.842617437, 1.278211406, 0.236653398],
                [-1.285233016, -1.817489215, -1.602824227, -0.74219835, 0.359622618],
                [1.789484627, 1.949366363, 1.369122514, 0.321650829, -0.700406391]],
            (3, 'replicate', False): [
                [-0.85412056, -14.23030789, -19.105767075, -14.995485469, -1.638482563],
                [13.59079782, 29.306374491, 33.034562337, 21.226079336, 1.111085489],
                [-23.767348302, -33.226747735, -28.735534457, -10.729550318, 10.978728005],
                [14.226794319, 19.074996301, 13.793147778, 2.024166332, -11.083387838]],
        }
        for (k, bordure, normalise), attendu in d_or.items():
            with self.subTest(noyau=k, bordure=bordure, normalise=normalise):
                y = shims.laplacian(x, k, border_type=bordure, normalized=normalise)
                np.testing.assert_allclose(y[0, 0].numpy(), np.array(attendu), rtol=0, atol=2e-9)

    def test_image_constante_donne_zero_hors_bords_constants(self):
        y = shims.laplacian(torch.full((1, 2, 8, 8), 3.5), 5)
        self.assertLess(float(y.abs().max()), 1e-5)

    def test_chaque_canal_est_filtre_seul(self):
        ensemble = shims.laplacian(self.x, 3)
        for c in range(3):
            seul = shims.laplacian(self.x[:, c:c + 1], 3)
            self.assertTrue(torch.equal(ensemble[:, c:c + 1], seul))

    def test_argument_invalide_est_refuse(self):
        x = self.x
        for k in (4, 0, -3, (3, 4)):
            with self.subTest(noyau=k), self.assertRaises(ValueError):
                shims.laplacian(x, k)
        with self.assertRaises(ValueError):
            shims.laplacian(x, 3, border_type='miroir')
        with self.assertRaises(TypeError):
            shims.laplacian(x[0], 3)                        # 3 dimensions
        with self.assertRaises(TypeError):
            shims.laplacian(x.numpy(), 3)


# ---------------------------------------------------------------------------
# (b) timm.layers
# ---------------------------------------------------------------------------
class TestTimmLayers(unittest.TestCase):
    def test_to_2tuple(self):
        self.assertEqual(shims.to_2tuple(5), (5, 5))
        self.assertEqual(shims.to_2tuple(2.5), (2.5, 2.5))
        self.assertEqual(shims.to_2tuple((3, 4)), (3, 4))
        self.assertEqual(shims.to_2tuple([1, 2]), (1, 2))
        self.assertEqual(shims.to_2tuple('ab'), ('ab', 'ab'))        # une chaine est un scalaire, pas un iterable de lettres
        self.assertEqual(shims.to_2tuple(range(2)), (0, 1))

    def test_droppath_identite_hors_entrainement_ou_proba_nulle(self):
        x = torch.randn(8, 3, 5)
        self.assertIs(shims.DropPath(0.5).eval()(x), x)
        self.assertIs(shims.DropPath(0.0).train()(x), x)
        self.assertIs(shims.drop_path(x, 0.3, training=False), x)

    def test_droppath_entrainement_masque_par_echantillon_et_mise_a_l_echelle(self):
        torch.manual_seed(0)
        x = torch.ones(4096, 3, 2, 2)
        y = shims.DropPath(0.5).train()(x)
        par_echantillon = y.reshape(4096, -1)
        self.assertTrue(torch.all(par_echantillon == par_echantillon[:, :1]), 'un masque par echantillon, pas par element')
        self.assertEqual(set(y[:, 0, 0, 0].unique().tolist()), {0.0, 2.0})           # survivants x 1 / keep_prob
        self.assertAlmostEqual(float(y.mean()), 1.0, delta=0.06)                      # esperance conservee
        torch.manual_seed(0)
        sans_echelle = shims.DropPath(0.5, scale_by_keep=False).train()(x)
        self.assertEqual(set(sans_echelle[:, 0, 0, 0].unique().tolist()), {0.0, 1.0})

    def test_droppath_toutes_les_dimensions_et_proba_un(self):
        for forme in ((6,), (6, 4), (6, 4, 3), (6, 4, 3, 2), (6, 2, 2, 2, 2)):
            with self.subTest(forme=forme):
                y = shims.DropPath(0.4).train()(torch.ones(forme))
                self.assertEqual(y.shape, forme)
        y = shims.DropPath(1.0).train()(torch.ones(5, 3))
        self.assertTrue(torch.equal(y, torch.zeros(5, 3)), 'proba 1 : tout est coupe, sans NaN ni division par zero')

    def test_droppath_repr_et_module(self):
        self.assertIn('drop_prob=0.100', repr(shims.DropPath(0.1)))
        self.assertIsInstance(shims.DropPath(0.1), torch.nn.Module)

    def test_trunc_normal_bornes_moments_et_sur_place(self):
        torch.manual_seed(0)
        t = torch.empty(20000)
        r = shims.trunc_normal_(t)
        self.assertIs(r, t)
        self.assertGreaterEqual(float(t.min()), -2.0)
        self.assertLessEqual(float(t.max()), 2.0)
        self.assertAlmostEqual(float(t.mean()), 0.0, delta=0.03)
        self.assertAlmostEqual(float(t.std()), 0.8796, delta=0.02)                    # ecart-type d'une N(0,1) tronquee a +-2
        t2 = shims.trunc_normal_(torch.empty(50000), std=.02)                        # l'appel du code de Lucida
        self.assertAlmostEqual(float(t2.std()), 0.02, delta=0.001)
        t3 = shims.trunc_normal_(torch.empty(5000), mean=0., std=1., a=-0.5, b=0.5)   # bornes ABSOLUES
        self.assertGreaterEqual(float(t3.min()), -0.5)
        self.assertLessEqual(float(t3.max()), 0.5)
        t4 = shims.trunc_normal_(torch.empty(5000), mean=3., std=0.1, a=2.9, b=3.1)
        self.assertTrue(bool(((t4 >= 2.9) & (t4 <= 3.1)).all()))

    def test_trunc_normal_sur_parametre_et_sur_meta(self):
        p = torch.nn.Parameter(torch.empty(10, 10))
        shims.trunc_normal_(p, std=.02)                                              # pas d'erreur d'autograd
        self.assertTrue(p.requires_grad)
        shims.trunc_normal_(torch.empty(4, 4, device='meta'), std=.02)               # construction sous torch.device('meta')

    def test_trunc_normal_rend_le_tenseur_quand_transformers_saute_l_initialisation(self):
        # from_pretrained remplace torch.nn.init.trunc_normal_ par une fonction VIDE (no_init_weights) : elle rend None. Comme
        # timm, le substitut rend quand meme le tenseur (et ne le modifie pas : les poids sont lus apres la construction).
        try:
            from transformers.modeling_utils import no_init_weights
        except Exception as e:
            self.skipTest(f'transformers inutilisable ici ({type(e).__name__})')
        original = torch.nn.init.trunc_normal_
        t = torch.zeros(8, 8)
        with no_init_weights():
            self.assertIsNot(torch.nn.init.trunc_normal_, original, 'precondition : l\'initialisation de torch est remplacee')
            self.assertIsNone(torch.nn.init.trunc_normal_(torch.zeros(2)), 'precondition : la version vide rend None')
            r = shims.trunc_normal_(t, std=.02)
        self.assertIs(torch.nn.init.trunc_normal_, original, 'le contexte restaure torch.nn.init')
        self.assertIs(r, t)
        self.assertTrue(torch.equal(t, torch.zeros(8, 8)), 'sous no_init_weights le tirage est saute')
        r = shims.trunc_normal_(t, std=.02)                                          # contexte quitte : tirage normal
        self.assertIs(r, t)
        self.assertGreater(float(t.abs().max()), 0.0)

    def test_equivalence_avec_le_vrai_timm_quand_il_est_la(self):
        try:
            reel = importlib.import_module('timm.layers')
        except Exception as e:
            self.skipTest(f'timm absent ou inutilisable ici ({type(e).__name__})')
        if getattr(reel, shims.MARQUE, False):
            self.skipTest('timm.layers est deja un substitut')
        for x in (5, (3, 4), [1, 2], 'ab', 2.5, range(2)):
            self.assertEqual(shims.to_2tuple(x), reel.to_2tuple(x), repr(x))
        entree = torch.randn(64, 3, 5, 5)
        for p, echelle in ((0.3, True), (0.5, False), (0.9, True)):
            torch.manual_seed(7)
            a = shims.DropPath(p, scale_by_keep=echelle).train()(entree)
            torch.manual_seed(7)
            b = reel.DropPath(p, scale_by_keep=echelle).train()(entree)
            self.assertTrue(torch.equal(a, b), f'DropPath({p}, scale_by_keep={echelle}) differe de timm')
        torch.manual_seed(7)
        a = shims.trunc_normal_(torch.empty(1000), std=.02)
        torch.manual_seed(7)
        b = reel.trunc_normal_(torch.empty(1000), std=.02)
        self.assertTrue(torch.equal(a, b), 'trunc_normal_ differe de timm sous la meme graine')


# ---------------------------------------------------------------------------
# installer() : le vrai paquet gagne toujours
# ---------------------------------------------------------------------------
def faux_paquet(nom, sous_module, **attributs):
    """Faux « vrai » paquet : un module `nom` et son sous-module `nom.sous_module` portant `attributs`."""
    racine = types.ModuleType(nom)
    racine.__path__ = []
    sous = types.ModuleType(f'{nom}.{sous_module}')
    for k, v in attributs.items():
        setattr(sous, k, v)
    setattr(racine, sous_module, sous)
    return racine, sous


class TestInstaller(unittest.TestCase):
    def test_paquets_absents_substituts_installes(self):
        with paquets_absents('timm', 'kornia'):
            journal = []
            etat = shims.installer(log=journal.append)
            self.assertEqual(etat, {'timm': 'substitut', 'kornia': 'substitut'})
            self.assertEqual(len(journal), 2)
            from timm.layers import DropPath, to_2tuple, trunc_normal_
            from kornia.filters import laplacian
            self.assertIs(DropPath, shims.DropPath)
            self.assertIs(to_2tuple, shims.to_2tuple)
            self.assertIs(trunc_normal_, shims.trunc_normal_)
            self.assertIs(laplacian, shims.laplacian)
            for nom in ('timm', 'timm.layers', 'kornia', 'kornia.filters'):
                self.assertTrue(getattr(sys.modules[nom], shims.MARQUE), nom)
                self.assertIsNotNone(sys.modules[nom].__spec__, f'{nom} sans __spec__ : find_spec leverait ValueError')
                self.assertIsNotNone(importlib.util.find_spec(nom))

    def test_le_vrai_paquet_gagne_toujours(self):
        with paquets_absents('timm', 'kornia'):
            timm, layers = faux_paquet('timm', 'layers', DropPath=object, to_2tuple=object, trunc_normal_=object)
            kornia, filters = faux_paquet('kornia', 'filters', laplacian=object)
            sys.modules.update({'timm': timm, 'timm.layers': layers, 'kornia': kornia, 'kornia.filters': filters})
            journal = []
            etat = shims.installer(log=journal.append)
            self.assertEqual(etat, {'timm': 'reel', 'kornia': 'reel'})
            self.assertEqual(journal, [])
            self.assertIs(sys.modules['timm'], timm)
            self.assertIs(sys.modules['kornia.filters'], filters)
            self.assertFalse(hasattr(sys.modules['timm.layers'], shims.MARQUE))

    def test_un_seul_paquet_manque(self):
        with paquets_absents('timm', 'kornia'):
            timm, layers = faux_paquet('timm', 'layers', DropPath=object, to_2tuple=object, trunc_normal_=object)
            sys.modules.update({'timm': timm, 'timm.layers': layers})
            etat = shims.installer()
            self.assertEqual(etat, {'timm': 'reel', 'kornia': 'substitut'})
            self.assertIs(sys.modules['timm'], timm)

    def test_un_vrai_paquet_incomplet_est_remplace(self):
        # le vrai timm existe mais sans trunc_normal_ : le code de Lucida echouerait ; le substitut complet prend la place
        with paquets_absents('timm', 'kornia'):
            timm, layers = faux_paquet('timm', 'layers', DropPath=object, to_2tuple=object)
            sys.modules.update({'timm': timm, 'timm.layers': layers})
            self.assertEqual(shims.installer()['timm'], 'substitut')
            self.assertIs(sys.modules['timm.layers'].trunc_normal_, shims.trunc_normal_)

    def test_dll_bloquee_compte_comme_absent(self):
        # Smart App Control : l'import d'un .pyd bloque leve ImportError « DLL load failed », celui d'une DLL chargee par
        # ctypes leve OSError (WinError 4551) ; un paquet trop ancien leve AttributeError. Aucun ne doit faire echouer installer().
        message = 'DLL load failed while importing kornia_rs : une strategie de controle d\'application a bloque ce fichier'
        for exception in (ImportError(message), OSError(4551, message), AttributeError('module has no attribute laplacian')):
            with self.subTest(exception=type(exception).__name__), paquets_absents('timm', 'kornia'):
                vrai = importlib.import_module

                def import_bloque(nom, *a, **k):
                    if nom.split('.')[0] == 'kornia':
                        raise exception
                    return vrai(nom, *a, **k)
                timm, layers = faux_paquet('timm', 'layers', DropPath=object, to_2tuple=object, trunc_normal_=object)
                sys.modules.update({'timm': timm, 'timm.layers': layers})
                journal = []
                with mock.patch.object(shims.importlib, 'import_module', side_effect=import_bloque):
                    etat = shims.installer(log=journal.append)
                self.assertEqual(etat, {'timm': 'reel', 'kornia': 'substitut'})
                self.assertIs(sys.modules['kornia.filters'].laplacian, shims.laplacian)
                self.assertIn(type(exception).__name__, journal[0], 'la raison (type de l\'exception) est journalisee')

    def test_idempotent(self):
        with paquets_absents('timm', 'kornia'):
            shims.installer()
            avant = {n: sys.modules[n] for n in ('timm', 'timm.layers', 'kornia', 'kornia.filters')}
            self.assertEqual(shims.installer(), {'timm': 'substitut', 'kornia': 'substitut'})
            for n, m in avant.items():
                self.assertIs(sys.modules[n], m, f'{n} a ete remplace une 2e fois')

    def test_des_restes_d_un_import_rate_sont_purges(self):
        with paquets_absents('timm', 'kornia'):
            sys.modules['kornia.core'] = types.ModuleType('kornia.core')           # reste d'un import a moitie reussi
            etat = shims.installer()
            self.assertEqual(etat['kornia'], 'substitut')
            self.assertNotIn('kornia.core', sys.modules)

    def test_le_diagnostic_en_ligne_de_commande_affiche_l_etat_en_json(self):
        # python scripts/lucida_shims.py : ce que le support lit pour savoir quel paquet est reel et lequel est un substitut
        etat = {'timm': 'reel', 'kornia': 'substitut'}
        with mock.patch.object(shims, 'installer', return_value=etat), contextlib.redirect_stdout(io.StringIO()) as sortie:
            shims.main()
        self.assertEqual(json.loads(sortie.getvalue().strip().splitlines()[-1]), etat)


# ---------------------------------------------------------------------------
# (c) le VRAI code distant de Lucida
# ---------------------------------------------------------------------------
def dossier_code_distant():
    """Dossier d'un instantane du code distant de Lucida (birefnet.py + BiRefNet_config.py), ou None. Les poids ne sont
    PAS necessaires et ne sont jamais lus."""
    if os.environ.get('LUCIDA_CODE_DISTANT'):
        return os.environ['LUCIDA_CODE_DISTANT']
    hubs = []
    for var in ('HF_HUB_CACHE', 'HUGGINGFACE_HUB_CACHE'):
        if os.environ.get(var):
            hubs.append(os.environ[var])
    if os.environ.get('HF_HOME'):
        hubs.append(os.path.join(os.environ['HF_HOME'], 'hub'))
    hubs.append(os.path.join(os.path.expanduser('~'), '.cache', 'huggingface', 'hub'))
    for hub in hubs:
        for f in sorted(glob.glob(os.path.join(hub, 'models--egeorcun--lucida', 'snapshots', '*', 'birefnet.py'))):
            d = os.path.dirname(f)
            if os.path.isfile(os.path.join(d, 'BiRefNet_config.py')):
                return d
    return None


@contextlib.contextmanager
def code_distant_importe(dossier):
    """Importe birefnet.py (avec son import relatif .BiRefNet_config) depuis `dossier` sous un nom de paquet temporaire,
    sans rien ecrire dans le cache HF (pas de __pycache__)."""
    nom = 'lucida_distant_sous_test'
    paquet = types.ModuleType(nom)
    paquet.__path__ = [dossier]
    ancien_bytecode = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    sys.modules[nom] = paquet
    try:
        yield importlib.import_module(nom + '.birefnet')
    finally:
        sys.dont_write_bytecode = ancien_bytecode
        for k in [k for k in sys.modules if k == nom or k.startswith(nom + '.')]:
            del sys.modules[k]


class TestCodeDistantLucida(unittest.TestCase):
    def setUp(self):
        self.dossier = dossier_code_distant()
        if not self.dossier:
            self.skipTest('code distant de Lucida absent du cache HF : rien a tester ici')

    def test_sans_substituts_transformers_refuse_le_code_distant_avec_substituts_il_l_accepte(self):
        from transformers.dynamic_module_utils import check_imports, get_imports
        fichier = os.path.join(self.dossier, 'birefnet.py')
        imports = get_imports(fichier)
        self.assertIn('timm', imports, 'le code distant n\'importe plus timm : les substituts ne servent plus a rien')
        self.assertIn('kornia', imports)
        with paquets_absents('timm', 'kornia'):
            with self.assertRaises(ImportError) as ctx:                  # le symptome d'origine
                check_imports(fichier)
            self.assertIn('kornia', str(ctx.exception))
            self.assertIn('timm', str(ctx.exception))
            shims.installer()
            self.assertEqual(check_imports(fichier), ['BiRefNet_config'])

    def test_le_code_distant_s_importe_et_le_modele_se_construit_sur_meta(self):
        with paquets_absents('timm', 'kornia'):
            shims.installer()
            with code_distant_importe(self.dossier) as mod:
                # chaque nom emprunte a timm / kornia est bien le substitut
                self.assertIs(mod.DropPath, shims.DropPath)
                self.assertIs(mod.to_2tuple, shims.to_2tuple)
                self.assertIs(mod.trunc_normal_, shims.trunc_normal_)
                self.assertIs(mod.laplacian, shims.laplacian)
                # bb_pretrained=False : aucun poids du backbone, aucun reseau ; `meta` : aucune memoire
                with torch.device('meta'):
                    modele = mod.BiRefNet(config=mod.BiRefNetConfig(bb_pretrained=False))
                params = list(modele.parameters())
                self.assertGreater(sum(p.numel() for p in params), 100_000_000)
                self.assertTrue(all(p.device.type == 'meta' for p in params))
                self.assertGreater(sum(isinstance(m, shims.DropPath) for m in modele.modules()), 0)

    def test_le_chargeur_de_transformers_resout_la_classe_depuis_un_dossier_local(self):
        # ce que from_pretrained(<dossier local>, trust_remote_code=True) fait AVANT de lire les poids : controle des imports,
        # copie du code dans le cache de modules (ici un dossier temporaire), import de la classe de configuration puis du
        # modele. `from_config` sur `meta` : aucun poids, aucune memoire.
        from transformers import AutoConfig, AutoModelForImageSegmentation
        from transformers import dynamic_module_utils as dmu
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        chemin_avant = list(sys.path)
        self.addCleanup(lambda: sys.path.__setitem__(slice(None), chemin_avant))
        modules_avant = set(sys.modules)
        self.addCleanup(lambda: [sys.modules.pop(k) for k in set(sys.modules) - modules_avant
                                 if k.startswith('transformers_modules')])
        with paquets_absents('timm', 'kornia'):
            shims.installer()
            with mock.patch.object(dmu, 'HF_MODULES_CACHE', tmp.name), \
                    mock.patch.dict(os.environ, {'HF_HUB_OFFLINE': '1', 'TRANSFORMERS_OFFLINE': '1'}):
                config = AutoConfig.from_pretrained(self.dossier, trust_remote_code=True, local_files_only=True)
                with torch.device('meta'):
                    modele = AutoModelForImageSegmentation.from_config(config, trust_remote_code=True)
        self.assertEqual(type(modele).__name__, 'BiRefNet')
        self.assertGreater(sum(p.numel() for p in modele.parameters()), 100_000_000)
        copies = glob.glob(os.path.join(tmp.name, 'transformers_modules', '*', 'birefnet.py'))
        self.assertEqual(len(copies), 1, 'le code distant doit avoir ete copie dans le cache de modules temporaire')

    def test_passe_avant_sur_meta_en_evaluation_et_en_entrainement(self):
        with paquets_absents('timm', 'kornia'):
            shims.installer()
            with code_distant_importe(self.dossier) as mod:
                with torch.device('meta'):
                    modele = mod.BiRefNet(config=mod.BiRefNetConfig(bb_pretrained=False))
                # evaluation : le chemin de l'inference
                modele.eval()
                sortie = modele(torch.empty(1, 3, 1024, 1024, device='meta'))
                self.assertEqual(tuple(sortie[-1].shape), (1, 1, 1024, 1024))
                # entrainement : DropPath actif ET l'unique appel a laplacian du code de Lucida
                appels = []
                reel = mod.laplacian
                with mock.patch.object(mod, 'laplacian', side_effect=lambda *a, **k: (appels.append(a[1:] or k), reel(*a, **k))[1]):
                    modele.train()
                    modele(torch.empty(2, 3, 1024, 1024, device='meta'))      # lot de 2 : BatchNorm l'exige
                self.assertEqual(len(appels), 1, 'laplacian doit etre appele une fois par la branche d\'entrainement')


# ---------------------------------------------------------------------------
# (e) recherche des poids et contrat de lucida_matte
# ---------------------------------------------------------------------------
def ecrire(chemin, contenu=b'x'):
    os.makedirs(os.path.dirname(chemin), exist_ok=True)
    with open(chemin, 'wb') as f:
        f.write(contenu)


def instantane(hub, revision='r1', code=True, poids=True, principal=False):
    """Instantane du depot egeorcun/lucida dans le cache hub `hub` ; rend son dossier."""
    base = os.path.join(hub, 'models--egeorcun--lucida')
    d = os.path.join(base, 'snapshots', revision)
    os.makedirs(d, exist_ok=True)
    if code:
        for f in ('config.json', 'birefnet.py', 'BiRefNet_config.py'):
            ecrire(os.path.join(d, f))
    if poids:
        ecrire(os.path.join(d, 'model.safetensors'), b'poids')
    if principal:
        ecrire(os.path.join(base, 'refs', 'main'), revision.encode())
    return d


def env_sans_poids(dossier):
    """Environnement d'un processus qui ne trouve les poids NULLE PART : dossier personnel vide, aucun cache Hugging Face
    configure, aucun reglage FABMESH_*. HF_HUB_OFFLINE=1 : meme si un ANCIEN lucida_matte.py etait lance par erreur (preuve
    d'echec sur l'ancien code), aucun acces reseau n'est possible. FABMESH_CLOISONNEMENT=0 : aucun plafond de memoire ni
    requete nvidia-smi pendant le test."""
    env = {k: v for k, v in os.environ.items()
           if not k.startswith(('HF_', 'HUGGINGFACE', 'TRANSFORMERS', 'FABMESH_', 'XDG_'))}
    home = os.path.join(dossier, 'home')
    os.makedirs(home, exist_ok=True)
    for k in ('HOMEDRIVE', 'HOMEPATH'):
        env.pop(k, None)
    env.update({'USERPROFILE': home, 'HOME': home, 'HF_HUB_OFFLINE': '1', 'TRANSFORMERS_OFFLINE': '1',
                'FABMESH_CLOISONNEMENT': '0', 'PYTHONUNBUFFERED': '1'})
    return env


class TestRechercheDesPoids(unittest.TestCase):
    def setUp(self):
        self.matte = charger('lucida_matte_sous_test', MATTE)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = os.path.join(self.tmp.name, 'home')
        self.hub_utilisateur = os.path.join(self.home, '.cache', 'huggingface', 'hub')
        self.hub_appli = os.path.join(self.tmp.name, 'appli', 'hf_cache', 'hub')
        os.makedirs(self.home)

    def trouver(self, env=None):
        return self.matte.trouver_poids(env=env or {}, home=self.home)

    def test_cache_utilisateur_quand_l_appli_n_a_que_le_code(self):
        # la situation reelle : le cache de l'appli a le code distant SANS les poids ; l'utilisateur a tout
        instantane(self.hub_appli, 'a', poids=False)
        d = instantane(self.hub_utilisateur, 'u')
        dossier, origine = self.trouver({'HF_HUB_CACHE': self.hub_appli})
        self.assertEqual((dossier, origine), (d, 'cache utilisateur'))

    def test_le_cache_de_l_appli_passe_avant_celui_de_l_utilisateur(self):
        a = instantane(self.hub_appli, 'a')
        instantane(self.hub_utilisateur, 'u')
        for env in ({'HF_HUB_CACHE': self.hub_appli}, {'HUGGINGFACE_HUB_CACHE': self.hub_appli},
                    {'HF_HOME': os.path.dirname(self.hub_appli)}):
            with self.subTest(env=sorted(env)):
                self.assertEqual(self.trouver(env), (a, "cache de l'appli"))

    def test_la_variable_passe_avant_tout(self):
        instantane(self.hub_appli, 'a')
        instantane(self.hub_utilisateur, 'u')
        direct = os.path.join(self.tmp.name, 'modele')
        instantane(direct, 'x')                                          # un hub : le dossier contient models--...
        dossier_modele = os.path.join(self.tmp.name, 'plat')
        for f in ('config.json', 'birefnet.py', 'BiRefNet_config.py', 'model.safetensors'):
            ecrire(os.path.join(dossier_modele, f))
        r = self.trouver({'FABMESH_LUCIDA_DIR': dossier_modele, 'HF_HUB_CACHE': self.hub_appli})
        self.assertEqual(r, (dossier_modele, 'FABMESH_LUCIDA_DIR'))
        r = self.trouver({'FABMESH_LUCIDA_DIR': direct, 'HF_HUB_CACHE': self.hub_appli})
        self.assertEqual(r[1], 'FABMESH_LUCIDA_DIR')
        self.assertTrue(r[0].startswith(direct))
        sous_hub = os.path.join(self.tmp.name, 'parent')
        d = instantane(os.path.join(sous_hub, 'hub'), 'y')
        self.assertEqual(self.trouver({'FABMESH_LUCIDA_DIR': sous_hub}), (d, 'FABMESH_LUCIDA_DIR'))

    def test_une_variable_invalide_ne_bloque_pas_les_autres_sources(self):
        d = instantane(self.hub_utilisateur, 'u')
        vide = os.path.join(self.tmp.name, 'vide')
        os.makedirs(vide)
        self.assertEqual(self.trouver({'FABMESH_LUCIDA_DIR': vide}), (d, 'cache utilisateur'))
        self.assertEqual(self.trouver({'FABMESH_LUCIDA_DIR': os.path.join(self.tmp.name, 'inexistant')}),
                         (d, 'cache utilisateur'))

    def test_un_instantane_incomplet_est_ignore(self):
        instantane(self.hub_appli, 'sans_poids', poids=False)
        instantane(self.hub_appli, 'sans_code', code=False)
        vide = instantane(self.hub_appli, 'poids_vides')
        ecrire(os.path.join(vide, 'model.safetensors'), b'')              # fichier vide : pas des poids
        bon = instantane(self.hub_utilisateur, 'u')
        self.assertEqual(self.trouver({'HF_HUB_CACHE': self.hub_appli}), (bon, 'cache utilisateur'))

    def test_la_revision_main_est_preferee(self):
        instantane(self.hub_utilisateur, 'aaa')
        voulu = instantane(self.hub_utilisateur, 'zzz', principal=True)
        self.assertEqual(self.trouver()[0], voulu)

    def test_poids_absents_message_clair(self):
        instantane(self.hub_appli, 'a', poids=False)
        with self.assertRaises(self.matte.LucidaAbsent) as ctx:
            self.trouver({'HF_HUB_CACHE': self.hub_appli, 'FABMESH_LUCIDA_DIR': os.path.join(self.tmp.name, 'x')})
        msg = str(ctx.exception)
        self.assertTrue(msg.startswith('poids Lucida absents'), msg)
        for morceau in ('FABMESH_LUCIDA_DIR', "cache de l'appli", 'cache utilisateur'):
            self.assertIn(morceau, msg)
        self.assertIsInstance(ctx.exception, RuntimeError)

    def test_un_meme_dossier_n_est_pas_liste_deux_fois(self):
        with self.assertRaises(self.matte.LucidaAbsent) as ctx:
            self.trouver({'HF_HUB_CACHE': self.hub_utilisateur, 'HF_HOME': os.path.join(self.home, '.cache', 'huggingface')})
        self.assertEqual(str(ctx.exception).count(self.hub_utilisateur), 1)

    def test_aucun_telechargement_sans_demande_explicite(self):
        with self.assertRaises(self.matte.LucidaAbsent):
            self.matte._source_modele({}, self.home)
        with self.assertRaises(self.matte.LucidaAbsent):
            self.matte._source_modele({'HF_HUB_OFFLINE': '0'}, self.home)
        with self.assertRaises(self.matte.LucidaAbsent):                  # demande + hors ligne : refuse (local_files_only)
            self.matte._source_modele({'FABMESH_LUCIDA_TELECHARGER': '1', 'HF_HUB_OFFLINE': '1'}, self.home)
        self.assertEqual(self.matte._source_modele({'FABMESH_LUCIDA_TELECHARGER': '1'}, self.home),
                         ('egeorcun/lucida', False, 'telechargement'))

    def test_poids_locaux_chargement_strictement_local(self):
        d = instantane(self.hub_utilisateur, 'u')
        self.assertEqual(self.matte._source_modele({}, self.home), (d, True, 'cache utilisateur'))


class TestContratLucidaMatte(unittest.TestCase):
    def setUp(self):
        self.matte = charger('lucida_matte_contrat', MATTE)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def modele_factice(self, logits, demi=False, vus=None):
        """Remplace le chargement : un « modele » qui rend des logits connus, sans aucun poids."""
        def modele(x):
            if vus is not None:
                vus.append((tuple(x.shape), x.dtype))
            return [torch.zeros(1, 1, 8, 8), logits]
        self.matte._MODELE = (modele, 'cpu', demi)
        self.addCleanup(setattr, self.matte, '_MODELE', None)

    def test_matte_image_alpha_L_a_la_taille_de_l_entree(self):
        logits = torch.zeros(1, 1, 1024, 1024)
        logits[..., :, 512:] = 20.0                                       # moitie droite = sujet
        logits[..., :, :512] = -20.0
        vus = []
        self.modele_factice(logits, vus=vus)
        for taille in ((300, 200), (200, 300), (1024, 1024), (37, 53)):
            with self.subTest(taille=taille):
                alpha = self.matte.matte_image(Image.new('RGB', taille, (10, 20, 30)))
                self.assertEqual(alpha.mode, 'L')
                self.assertEqual(alpha.size, taille)
                a = np.asarray(alpha)
                self.assertLessEqual(int(a[:, : taille[0] // 4].max()), 1)
                self.assertGreaterEqual(int(a[:, -(taille[0] // 4):].min()), 254)       # troncature : 255 * 0,99999994 -> 254
        self.assertEqual(vus[0], ((1, 3, 1024, 1024), torch.float32))     # entree normalisee en 1024 x 1024
        # une image RGBA, en niveaux de gris ou palettisee est acceptee (convertie en RGB)
        for img in (Image.new('RGBA', (40, 30), (1, 2, 3, 4)), Image.new('L', (40, 30), 7), Image.new('P', (40, 30))):
            self.assertEqual(self.matte.matte_image(img).size, (40, 30))

    def test_matte_image_demi_precision(self):
        vus = []
        self.modele_factice(torch.zeros(1, 1, 1024, 1024), demi=True, vus=vus)
        alpha = self.matte.matte_image(Image.new('RGB', (64, 48)))
        self.assertEqual(vus[0][1], torch.float16)
        self.assertEqual(alpha.size, (64, 48))
        self.assertEqual(set(np.asarray(alpha).ravel().tolist()), {127})   # sigmoid(0) * 255 = 127,5 -> 127 (troncature comme avant)

    def test_matte_ecrit_le_png_rgba_comme_avant(self):
        logits = torch.full((1, 1, 1024, 1024), 20.0)
        self.modele_factice(logits)
        entree = os.path.join(self.tmp.name, 'in.png')
        sortie = os.path.join(self.tmp.name, 'out.png')
        Image.new('RGB', (50, 40), (200, 100, 50)).save(entree)
        self.assertEqual(self.matte.matte(entree, sortie), sortie)
        with Image.open(sortie) as f:
            rgba = f.convert('RGBA')
        self.assertEqual(rgba.mode, 'RGBA')
        self.assertEqual(rgba.getpixel((5, 5))[:3], (200, 100, 50))
        self.assertGreaterEqual(rgba.getpixel((5, 5))[3], 254)

    def test_liberer_supprime_le_modele_et_vide_le_cache_cuda(self):
        self.matte._MODELE = (object(), 'cpu', False)
        appels = []
        with mock.patch.object(torch.cuda, 'is_available', return_value=True), \
                mock.patch.object(torch.cuda, 'empty_cache', side_effect=lambda: appels.append('vide')):
            self.matte.liberer()
        self.assertIsNone(self.matte._MODELE)
        self.assertEqual(appels, ['vide'])
        with mock.patch.object(torch.cuda, 'is_available', return_value=False), \
                mock.patch.object(torch.cuda, 'empty_cache', side_effect=lambda: appels.append('vide2')):
            self.matte.liberer()                                           # sans carte : pas d'appel CUDA
        self.assertEqual(appels, ['vide'])

    def test_main_poids_absents_code_retour_2_et_message_sur_stderr(self):
        entree = os.path.join(self.tmp.name, 'in.png')
        Image.new('RGB', (8, 8)).save(entree)
        erreur = self.matte.LucidaAbsent('poids Lucida absents : cherches ici')
        faux_flux = mock.MagicMock()
        with mock.patch.object(sys, 'argv', ['lucida_matte.py', entree, os.path.join(self.tmp.name, 'o.png')]), \
                mock.patch.object(self.matte, '_cloisonner', return_value=None), \
                mock.patch.object(self.matte, 'matte', side_effect=erreur), \
                mock.patch.object(sys, 'stderr', faux_flux):
            with self.assertRaises(SystemExit) as ctx:
                self.matte.main()
        self.assertEqual(ctx.exception.code, 2)
        self.assertIn('LUCIDA_ERROR: poids Lucida absents', ''.join(c.args[0] for c in faux_flux.write.call_args_list))

    def test_main_pose_le_cloisonnement_avant_le_calcul_et_le_termine(self):
        entree = os.path.join(self.tmp.name, 'in.png')
        Image.new('RGB', (8, 8)).save(entree)
        ordre = []
        faux_cm = mock.MagicMock()
        faux_cm.mesurer.side_effect = lambda *a: ordre.append('mesurer')
        faux_cm.terminer.side_effect = lambda *a: ordre.append('terminer')
        with mock.patch.object(sys, 'argv', ['lucida_matte.py', entree, os.path.join(self.tmp.name, 'o.png')]), \
                mock.patch.object(self.matte, '_cloisonner', side_effect=lambda: (ordre.append('cloisonner'), faux_cm)[1]), \
                mock.patch.object(self.matte, 'matte', side_effect=lambda *a: ordre.append('matte')), \
                mock.patch('builtins.print'):
            self.matte.main()
        self.assertEqual(ordre, ['cloisonner', 'matte', 'mesurer', 'terminer'])      # la mesure de VRAM precede la fin
        self.assertIs(self.matte._CM, faux_cm)
        self.addCleanup(setattr, self.matte, '_CM', None)

    def test_main_usage_et_image_absente_gardent_leurs_codes(self):
        with mock.patch.object(sys, 'argv', ['lucida_matte.py']), mock.patch('builtins.print'):
            with self.assertRaises(SystemExit) as ctx:
                self.matte.main()
        self.assertEqual(ctx.exception.code, 1)
        with mock.patch.object(sys, 'argv', ['lucida_matte.py', os.path.join(self.tmp.name, 'absente.png')]), \
                mock.patch('builtins.print') as p:
            with self.assertRaises(SystemExit) as ctx:
                self.matte.main()
        self.assertEqual(ctx.exception.code, 1)
        self.assertTrue(str(p.call_args_list[0].args[0]).startswith('LUCIDA_ERROR: image not found'))

    def test_la_cle_du_journal_est_neutre_et_un_echec_du_cloisonnement_ne_bloque_pas(self):
        # logs/memoire_pics.jsonl : la cle d'un type de calcul peut etre affichee par l'interface, jamais un nom de moteur
        faux_cm = mock.MagicMock()
        with mock.patch.dict(sys.modules, {'cloisonnement_memoire': faux_cm}), mock.patch('builtins.print'):
            self.assertIs(self.matte._cloisonner(), faux_cm)
        _, kw = faux_cm.appliquer.call_args
        self.assertEqual(kw['cle'], 'background_removal')
        for nom in ('lucida', 'birefnet', 'u2net', 'rembg', 'trellis', 'unirig', 'puppeteer', 'realvis', 'clipseg'):
            self.assertNotIn(nom, kw['cle'].lower())
        faux_cm.appliquer.side_effect = OSError('plafond impossible')
        with mock.patch.dict(sys.modules, {'cloisonnement_memoire': faux_cm}), mock.patch('builtins.print') as p:
            self.assertIsNone(self.matte._cloisonner(),
                              'le cloisonnement est un filet : son echec ne doit jamais empecher le detourage')
        self.assertIn('cloisonnement memoire indisponible', str(p.call_args_list[-1].args[0]))

    def test_lancement_en_script_sans_poids_code_2_et_message_clair(self):
        # le VRAI lancement du pipeline : l'interpreteur de l'appli, le script par son chemin (fichier ._pth : le dossier du
        # script n'est pas sur sys.path, d'ou le sys.path.insert de lucida_matte). Sans poids : aucun import lourd, code 2.
        entree = os.path.join(self.tmp.name, 'in.png')
        sortie = os.path.join(self.tmp.name, 'out.png')
        Image.new('RGB', (16, 16), (1, 2, 3)).save(entree)
        r = subprocess.run([sys.executable, MATTE, entree, sortie], env=env_sans_poids(self.tmp.name),
                           stdin=subprocess.DEVNULL, capture_output=True, text=True, errors='replace', timeout=120)
        self.assertEqual(r.returncode, 2, r.stdout + r.stderr)
        self.assertIn('LUCIDA_ERROR: poids Lucida absents', r.stderr)
        self.assertNotIn('Traceback', r.stderr)
        self.assertFalse(os.path.exists(sortie), 'aucun fichier de sortie sans poids')

    def test_importer_le_module_n_importe_aucune_bibliotheque_lourde(self):
        # lucida_matte est importe par remove_bg.py et mesh_inpaint.py : un echec d'import lourd doit survenir DANS matte(),
        # la ou leur try / except le rattrape, et le module doit mettre son dossier sur sys.path (Python embarque)
        with open(MATTE, encoding='utf-8') as f:
            source = f.read()
        tete = source.split('\nclass LucidaAbsent', 1)[0]
        for lourd in ('import torch', 'from torchvision', 'from transformers', 'import transformers'):
            self.assertNotIn(lourd, tete)
        self.assertIn('sys.path.insert(0, _ICI)', tete)


class FauxModele:
    """Modele factice : note les appels de placement et de mode. Aucun poids, aucune memoire."""

    def __init__(self):
        self.appels = []

    def to(self, peripherique):
        self.appels.append(('to', peripherique))
        return self

    def eval(self):
        self.appels.append(('eval',))
        return self

    def half(self):
        self.appels.append(('half',))
        return self


class TestChargement(unittest.TestCase):
    """_charger : l'enchainement poids -> (plafond de VRAM) -> substituts -> from_pretrained -> peripherique -> precision,
    avec des doublures (transformers, lucida_shims, modele) : aucun poids, aucune carte, aucun reseau."""

    def setUp(self):
        self.matte = charger('lucida_matte_chargement', MATTE)
        self.evenements = []
        self.modele = FauxModele()
        evenements, modele = self.evenements, self.modele

        class FauxAuto:
            @staticmethod
            def from_pretrained(source, **kw):
                evenements.append(('from_pretrained', source, kw))
                return modele

        faux_transformers = types.ModuleType('transformers')
        faux_transformers.AutoModelForImageSegmentation = FauxAuto
        faux_shims = types.ModuleType('lucida_shims')
        faux_shims.installer = lambda log=None: evenements.append(('installer',))
        patcher = mock.patch.dict(sys.modules, {'transformers': faux_transformers, 'lucida_shims': faux_shims})
        patcher.start()
        self.addCleanup(patcher.stop)
        env = {k: v for k, v in os.environ.items() if k != 'FABMESH_LUCIDA_FP16'}
        patcher = mock.patch.dict(os.environ, env, clear=True)
        patcher.start()
        self.addCleanup(patcher.stop)

    def charger_modele(self, cuda=False, source=('SNAP', True, 'cache utilisateur')):
        with mock.patch.object(self.matte, '_source_modele', return_value=source), \
                mock.patch.object(torch.cuda, 'is_available', return_value=cuda), \
                contextlib.redirect_stdout(io.StringIO()) as sortie:
            res = self.matte._charger()
        return res, sortie.getvalue()

    def reinitialiser(self):
        self.matte.liberer()
        self.evenements.clear()
        self.modele.appels.clear()

    def test_substituts_avant_from_pretrained_puis_placement_sur_le_processeur(self):
        res, sortie = self.charger_modele(cuda=False)
        self.assertEqual([e[0] for e in self.evenements], ['installer', 'from_pretrained'],
                         'les substituts de timm / kornia doivent etre en place AVANT que transformers lise le code distant')
        _, source, kw = self.evenements[1]
        self.assertEqual(source, 'SNAP')
        self.assertEqual(kw, {'trust_remote_code': True, 'dtype': torch.float32, 'local_files_only': True})
        self.assertEqual(self.modele.appels, [('to', 'cpu'), ('eval',)])
        self.assertEqual(res, (self.modele, 'cpu', False))
        self.assertIn('LUCIDA: model loaded on cpu (cache utilisateur)', sortie)

    def test_carte_graphique_en_float32_par_defaut_demi_precision_sur_demande(self):
        res, _ = self.charger_modele(cuda=True)
        self.assertEqual(self.modele.appels, [('to', 'cuda'), ('eval',)])
        self.assertEqual(res, (self.modele, 'cuda', False))
        self.reinitialiser()
        with mock.patch.dict(os.environ, {'FABMESH_LUCIDA_FP16': '1'}):
            res, sortie = self.charger_modele(cuda=True)
        self.assertEqual(self.modele.appels, [('to', 'cuda'), ('eval',), ('half',)])
        self.assertEqual(res, (self.modele, 'cuda', True))
        self.assertIn('LUCIDA: model loaded on cuda (cache utilisateur, fp16)', sortie)

    def test_la_demi_precision_est_ignoree_sans_carte(self):
        with mock.patch.dict(os.environ, {'FABMESH_LUCIDA_FP16': '1'}):
            res, _ = self.charger_modele(cuda=False)
        self.assertEqual(self.modele.appels, [('to', 'cpu'), ('eval',)])
        self.assertEqual(res, (self.modele, 'cpu', False))

    def test_le_chargement_n_a_lieu_qu_une_fois_et_liberer_permet_de_recommencer(self):
        self.charger_modele()
        premier = self.matte._MODELE
        self.charger_modele()
        self.assertEqual([e[0] for e in self.evenements], ['installer', 'from_pretrained'])
        self.assertIs(self.matte._MODELE, premier)
        self.matte.liberer()
        self.charger_modele()
        self.assertEqual([e[0] for e in self.evenements].count('from_pretrained'), 2)

    def test_sans_poids_l_echec_precede_tout_import_lourd_et_toute_substitution(self):
        erreur = self.matte.LucidaAbsent('poids Lucida absents : x')
        with mock.patch.object(self.matte, '_source_modele', side_effect=erreur):
            with self.assertRaises(self.matte.LucidaAbsent):
                self.matte._charger()
        self.assertEqual(self.evenements, [], 'ni substituts ni from_pretrained sans poids')
        self.assertIsNone(self.matte._MODELE)

    def test_le_plafond_de_vram_est_pose_avant_les_substituts_quand_le_cloisonnement_existe(self):
        faux_cm = mock.MagicMock()
        faux_cm.plafonner_vram.side_effect = lambda t: self.evenements.append(('plafond', t is torch))
        self.matte._CM = faux_cm
        self.charger_modele()
        self.assertEqual([e[0] for e in self.evenements], ['plafond', 'installer', 'from_pretrained'])
        self.assertEqual(self.evenements[0], ('plafond', True))

    def test_le_telechargement_explicite_autorise_le_reseau(self):
        self.charger_modele(source=('egeorcun/lucida', False, 'telechargement'))
        _, source, kw = self.evenements[1]
        self.assertEqual(source, 'egeorcun/lucida')
        self.assertFalse(kw['local_files_only'])


# ---------------------------------------------------------------------------
# (f) remove_bg.py : contrat vis-a-vis de l'appelant (main.js lit « OK: <chemin> » et attend un PNG RGBA)
# ---------------------------------------------------------------------------
class TestRemoveBg(unittest.TestCase):
    def setUp(self):
        self.mod = charger('remove_bg_sous_test', REMOVE_BG)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        chemin_avant = list(sys.path)
        self.addCleanup(lambda: sys.path.__setitem__(slice(None), chemin_avant))
        self.rembg = FauxRembg()

    def lancer(self, nom, lucida):
        """main() de remove_bg sur une image RVB de 40 x 30 ; `lucida(entree, sortie)` remplace lucida_matte.matte."""
        chemin = os.path.join(self.tmp.name, nom)
        Image.new('RGB', (40, 30), (200, 100, 50)).save(chemin)
        faux_matte = types.ModuleType('lucida_matte')
        faux_matte.matte = lucida
        sortie = io.StringIO()
        with mock.patch.dict(sys.modules, {'lucida_matte': faux_matte, 'rembg': self.rembg}), \
                mock.patch.object(sys, 'argv', ['remove_bg.py', chemin]), contextlib.redirect_stdout(sortie):
            self.mod.main()
        return chemin, sortie.getvalue()

    @staticmethod
    def lucida_qui_reussit(entree, sortie):
        rgba = Image.open(entree).convert('RGBA')
        rgba.putalpha(ellipse(rgba.size, 0.4))
        rgba.save(sortie, 'PNG')

    @staticmethod
    def lucida_absent(entree, sortie):
        raise RuntimeError('poids Lucida absents : cherches dans cache utilisateur (...)')

    def test_lucida_disponible_ecrit_le_png_rgba_en_place(self):
        chemin, sortie = self.lancer('a.png', self.lucida_qui_reussit)
        self.assertEqual(sortie.strip().splitlines()[-1], f'OK: {chemin}')
        self.assertEqual(self.rembg.appels, [])
        with Image.open(chemin) as f:
            self.assertEqual(f.mode, 'RGBA')
            self.assertEqual(f.size, (40, 30))

    def test_poids_absents_repli_u2net_meme_sortie(self):
        chemin, sortie = self.lancer('b.png', self.lucida_absent)
        self.assertEqual(len(self.rembg.appels), 1)
        self.assertEqual(self.rembg.appels[0][2], ('session', 'u2net'))
        self.assertIn('[remove_bg] primary matting engine unavailable (RuntimeError: poids Lucida absents', sortie)
        self.assertEqual(sortie.strip().splitlines()[-1], f'OK: {chemin}')
        with Image.open(chemin) as f:
            self.assertEqual(f.mode, 'RGBA')

    def test_une_image_jpeg_est_ecrite_en_png_a_cote(self):
        chemin, sortie = self.lancer('c.jpg', self.lucida_qui_reussit)
        attendu = os.path.splitext(chemin)[0] + '.png'
        self.assertEqual(sortie.strip().splitlines()[-1], f'OK: {attendu}')
        self.assertTrue(os.path.isfile(attendu))
        with Image.open(chemin) as f:
            self.assertEqual(f.format, 'JPEG', 'le JPEG d\'origine n\'est pas touche')

    def test_image_absente_code_1(self):
        sortie = io.StringIO()
        with mock.patch.object(sys, 'argv', ['remove_bg.py', os.path.join(self.tmp.name, 'absente.png')]), \
                contextlib.redirect_stdout(sortie):
            with self.assertRaises(SystemExit) as ctx:
                self.mod.main()
        self.assertEqual(ctx.exception.code, 1)
        self.assertIn('REMOVEBG_ERROR: image not found', sortie.getvalue())


# ---------------------------------------------------------------------------
# (d) _prep_image avec doublures
# ---------------------------------------------------------------------------
def extraire_fonctions(chemin, noms):
    """Les fonctions de premier niveau `noms` du fichier, compilees telles quelles (ast) ; absentes : ignorees."""
    with open(chemin, 'r', encoding='utf-8') as f:
        arbre = ast.parse(f.read(), chemin)
    noeuds = [n for n in arbre.body if isinstance(n, ast.FunctionDef) and n.name in noms]
    return ast.Module(body=noeuds, type_ignores=[])


def ellipse(taille, part, centre=None):
    """Alpha « L » : une ellipse qui couvre ~`part` de l'image."""
    l, h = taille
    yy, xx = np.mgrid[0:h, 0:l]
    cx, cy = centre or (l / 2.0, h / 2.0)
    ra = np.sqrt(part * l * h / np.pi)
    ry = ra * (h / float(l)) ** 0.5
    rx = ra * (l / float(h)) ** 0.5
    masque = ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2 <= 1.0
    return Image.fromarray(masque.astype('uint8') * 255)


def bande_haute(taille, part):
    """Alpha « L » : les lignes du haut (une fraction `part` de la hauteur) valent 255, le reste 0."""
    l, h = taille
    a = np.zeros((h, l), dtype='uint8')
    a[: int(part * h), :] = 255
    return Image.fromarray(a)


class FauxRembg(types.ModuleType):
    def __init__(self):
        super().__init__('rembg')
        self.appels = []

    def new_session(self, nom):
        return ('session', nom)

    def remove(self, image, session=None):
        self.appels.append((image.size, image.mode, session))
        sortie = image.convert('RGBA')
        sortie.putalpha(ellipse(image.size, 0.2))
        return sortie


class TestPrepImage(unittest.TestCase):
    TAILLE = (240, 320)

    @classmethod
    def setUpClass(cls):
        cls.code = compile(extraire_fonctions(PIPELINE, {'_prep_image', '_detourer_sujet', '_crop_to_subject',
                                                        '_composite_on_black'}), PIPELINE, 'exec')

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.journal = []
        self.ns = {'os': os, 'sys': sys, 'time': __import__('time'), 'SCRIPTS': os.path.join(RACINE, 'scripts'),
                   'log': self.journal.append}
        exec(self.code, self.ns)
        env = {k: v for k, v in os.environ.items()
               if k not in ('FABMESH_DETOURAGE', 'FABMESH_LUCIDA_PYTHON', 'FABMESH_TEX_SKIP_CROP', 'FABMESH_TEX_CROP_PAD')}
        patcher = mock.patch.dict(os.environ, env, clear=True)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.rembg = FauxRembg()
        patcher = mock.patch.dict(sys.modules, {'rembg': self.rembg})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.image = os.path.join(self.tmp.name, 'orc.png')
        fond = Image.new('RGB', self.TAILLE, (190, 190, 190))
        fond.paste(Image.new('RGB', (100, 140), (30, 160, 40)), (70, 90))
        fond.save(self.image)

    def prep(self, run=None, chemin=None):
        """_prep_image avec subprocess.run remplace ; rend (image, appels de run)."""
        appels = []
        ouvertes = []
        vrai_open = Image.open

        def run_trace(cmd, **kw):
            appels.append((cmd, kw))
            return run(cmd, **kw)

        def open_trace(*a, **k):
            im = vrai_open(*a, **k)
            ouvertes.append((a[0], im))
            return im
        with mock.patch.object(subprocess, 'run', run_trace if run else self.run_interdit(appels)), \
                mock.patch.object(Image, 'open', open_trace):
            res = self.ns['_prep_image'](chemin or self.image)
        for ouvert, im in ouvertes:
            self.assertIsNone(getattr(im, 'fp', None), f'{ouvert} est reste ouvert : la poignee du fichier doit etre rendue')
        return res, appels

    def run_interdit(self, appels):
        def run(cmd, **kw):
            appels.append((cmd, kw))
            raise AssertionError('le sous-processus Lucida ne devait pas etre lance')
        return run

    @staticmethod
    def lucida_qui_reussit(alpha_de):
        """Double du sous-processus : lit l'image d'entree (cmd[2]) et ecrit le PNG RGBA de sortie (cmd[3])."""
        def run(cmd, **kw):
            entree = Image.open(cmd[2]).convert('RGB')
            rgba = entree.copy()
            rgba.putalpha(alpha_de(entree.size))
            rgba.save(cmd[3], 'PNG')
            return subprocess.CompletedProcess(cmd, 0, 'LUCIDA: model loaded on cuda (cache utilisateur)\nOK: x\n', '')
        return run

    @staticmethod
    def lucida_qui_echoue(code=1, stderr='', stdout=''):
        return lambda cmd, **kw: subprocess.CompletedProcess(cmd, code, stdout, stderr)

    def ligne(self, debut):
        trouvees = [l for l in self.journal if l.startswith(debut)]
        self.assertEqual(len(trouvees), 1, f'{debut!r} attendu une fois dans {self.journal}')
        return trouvees[0]

    def assert_repli_u2net(self, res, appels, motif):
        self.assertEqual(len(appels), 1)
        self.assertEqual(len(self.rembg.appels), 1, 'rembg doit etre appele une fois (repli)')
        self.assertEqual(self.rembg.appels[0][2], ('session', 'u2net'))
        self.assertEqual(self.rembg.appels[0][:2], (self.TAILLE, 'RGBA'))
        self.assertIn(motif, self.ligne('detourage: u2net ('))
        self.assertNotIn('detourage: lucida', ' '.join(self.journal))
        self.assertEqual(res.mode, 'RGBA')

    def assert_dossier_temporaire_nettoye(self, appels):
        sortie = appels[0][0][3]
        self.assertFalse(os.path.exists(os.path.dirname(sortie)), 'le dossier temporaire du sous-processus doit etre supprime')

    # --- la fonction auxiliaire existe ---
    def test_la_fonction_auxiliaire_existe_et_prep_image_l_appelle(self):
        self.assertIn('_detourer_sujet', self.ns)
        with open(PIPELINE, encoding='utf-8') as f:
            self.assertIn('_detourer_sujet(', f.read())

    # --- succes ---
    def test_succes_lucida_aucun_u2net_et_le_reste_de_la_chaine_inchange(self):
        res, appels = self.prep(self.lucida_qui_reussit(lambda t: ellipse(t, 0.3)))
        self.assertEqual(len(appels), 1)
        self.assertEqual(self.rembg.appels, [])
        cmd, kw = appels[0]
        self.assertEqual(cmd[0], sys.executable)
        self.assertEqual(os.path.basename(cmd[1]), 'lucida_matte.py')
        self.assertTrue(os.path.isfile(cmd[1]), 'le script du sous-processus doit exister')
        self.assertEqual(cmd[2], self.image)
        self.assertEqual(kw['timeout'], 240)
        self.assertTrue(kw['capture_output'])
        self.assertIs(kw['stdin'], subprocess.DEVNULL, 'le sous-processus n\'herite pas de l\'entree du pipeline')
        self.assertEqual(kw['errors'], 'replace', 'une sortie non decodable ne doit pas faire echouer un detourage reussi')
        self.assertTrue(kw['text'])
        self.assertEqual(kw['creationflags'], getattr(subprocess, 'CREATE_NO_WINDOW', 0), 'pas de console qui clignote')
        self.assertNotIn('env', kw, 'memes variables d\'environnement : heritees, pas reconstruites')
        self.assertRegex(self.ligne('detourage: lucida ('), r'^detourage: lucida \(\d+\.\d s\)$')
        self.assertNotIn('detourage: u2net', ' '.join(self.journal))
        self.assert_dossier_temporaire_nettoye(appels)
        # suite inchangee : recadrage carre sur le sujet, fond noir sous la transparence, couleurs d'origine gardees
        self.assertEqual(res.mode, 'RGBA')
        self.assertEqual(res.size[0], res.size[1], 'recadrage carre (crop-to-subject)')
        self.assertEqual(res.getpixel((0, 0)), (0, 0, 0, 0))
        self.assertEqual(res.getpixel((res.size[0] // 2, res.size[1] // 2))[:3], (30, 160, 40))

    def test_le_journal_rapporte_le_modele_charge_et_le_pic_de_vram_du_sous_processus(self):
        def run(cmd, **kw):
            self.lucida_qui_reussit(lambda t: ellipse(t, 0.3))(cmd)
            sortie = ('[lucida] plafond RAM ...\nFABMESH_MEM_PLAFOND {}\nLUCIDA: model loaded on cuda (cache utilisateur)\n'
                      'FABMESH_MEM_ETAPE etape=lucida engage=3000Mo vram_torch=900Mo pic_vram_torch=4100Mo '
                      'pic_vram_reserve=4321Mo vram_carte=6000/16303Mo\nOK: x\n')
            return subprocess.CompletedProcess(cmd, 0, sortie, '')
        self.prep(run)
        self.assertIn('detourage: model loaded on cuda (cache utilisateur)', self.journal)
        self.assertIn('detourage: pic de VRAM PyTorch du sous-processus 4321 Mo (hors contexte CUDA)', self.journal)
        self.assertEqual(len([l for l in self.journal if l.startswith('detourage: lucida (')]), 1)

    def test_python_du_sous_processus_surchargeable(self):
        os.environ['FABMESH_LUCIDA_PYTHON'] = r'C:\autre\python.exe'
        _, appels = self.prep(self.lucida_qui_reussit(lambda t: ellipse(t, 0.3)))
        self.assertEqual(appels[0][0][0], r'C:\autre\python.exe')

    def test_sujet_en_plusieurs_morceaux_est_accepte(self):
        def deux_morceaux(t):
            a = np.asarray(ellipse(t, 0.25, centre=(t[0] * 0.3, t[1] * 0.5))).copy()
            b = np.asarray(ellipse(t, 0.03, centre=(t[0] * 0.85, t[1] * 0.2)))
            return Image.fromarray(np.maximum(a, b))
        _, appels = self.prep(self.lucida_qui_reussit(deux_morceaux))
        self.assertEqual(self.rembg.appels, [])
        self.ligne('detourage: lucida (')

    # --- echecs du sous-processus -> repli u2net ---
    def test_echec_code_retour_repli_u2net_avec_la_raison(self):
        run = self.lucida_qui_echoue(1, stderr='Traceback (most recent call last):\n  File "x"\nImportError: No module named einops\n')
        res, appels = self.prep(run)
        self.assert_repli_u2net(res, appels, 'code retour 1 : ImportError: No module named einops')
        self.assert_dossier_temporaire_nettoye(appels)

    def test_poids_absents_code_2_repli_u2net(self):
        run = self.lucida_qui_echoue(2, stderr='LUCIDA_ERROR: poids Lucida absents : cherches dans ...\n')
        res, appels = self.prep(run)
        self.assert_repli_u2net(res, appels, 'code retour 2 : LUCIDA_ERROR: poids Lucida absents')

    def test_delai_depasse_repli_u2net(self):
        def run(cmd, **kw):
            raise subprocess.TimeoutExpired(cmd, 240)
        res, appels = self.prep(run)
        self.assert_repli_u2net(res, appels, 'delai de 240 s depasse')
        self.assert_dossier_temporaire_nettoye(appels)

    def test_fichier_absent_repli_u2net(self):
        res, appels = self.prep(lambda cmd, **kw: subprocess.CompletedProcess(cmd, 0, 'OK: x', ''))
        self.assert_repli_u2net(res, appels, 'aucun fichier produit')

    def test_interpreteur_introuvable_repli_u2net(self):
        def run(cmd, **kw):
            raise FileNotFoundError(2, 'introuvable')
        res, appels = self.prep(run)
        self.assert_repli_u2net(res, appels, 'lancement impossible (FileNotFoundError')

    def test_taille_inattendue_repli_u2net(self):
        def run(cmd, **kw):
            Image.new('RGBA', (100, 100), (0, 0, 0, 255)).save(cmd[3])
            return subprocess.CompletedProcess(cmd, 0, '', '')
        res, appels = self.prep(run)
        self.assert_repli_u2net(res, appels, 'taille inattendue')

    def test_png_illisible_repli_u2net(self):
        def run(cmd, **kw):
            with open(cmd[3], 'wb') as f:
                f.write(b'pas un png')
            return subprocess.CompletedProcess(cmd, 0, '', '')
        res, appels = self.prep(run)
        self.assert_repli_u2net(res, appels, 'UnidentifiedImageError')
        self.assert_dossier_temporaire_nettoye(appels)

    # --- alpha aberrant -> repli u2net ---
    def test_alpha_vide_repli_u2net(self):
        res, appels = self.prep(self.lucida_qui_reussit(lambda t: Image.new('L', t, 0)))
        self.assert_repli_u2net(res, appels, 'alpha vide (aucune composante)')

    def test_alpha_presque_vide_repli_u2net(self):
        res, appels = self.prep(self.lucida_qui_reussit(lambda t: ellipse(t, 0.005)))
        self.assert_repli_u2net(res, appels, 'alpha aberrant : sujet trop petit')

    def test_alpha_couvrant_tout_repli_u2net(self):
        res, appels = self.prep(self.lucida_qui_reussit(lambda t: Image.new('L', t, 255)))
        self.assert_repli_u2net(res, appels, "sujet = 100.0% de l'image (rien n'a ete retire)")

    def test_alpha_a_96_pour_cent_repli_u2net(self):
        res, appels = self.prep(self.lucida_qui_reussit(lambda t: bande_haute(t, 0.96)))
        self.assert_repli_u2net(res, appels, "% de l'image (rien n'a ete retire)")

    def test_alpha_a_94_pour_cent_est_accepte(self):
        self.prep(self.lucida_qui_reussit(lambda t: bande_haute(t, 0.94)))
        self.assertEqual(self.rembg.appels, [])
        self.ligne('detourage: lucida (')

    def test_alpha_a_1_pour_cent_est_accepte(self):
        self.prep(self.lucida_qui_reussit(lambda t: ellipse(t, 0.0125)))
        self.assertEqual(self.rembg.appels, [])

    def test_alpha_en_confettis_repli_u2net(self):
        def confettis(t):
            # des carres de 3 x 3 pixels tous les 8 pixels : ~14 % de la surface, mais aucune composante de taille notable
            a = np.zeros((t[1], t[0]), dtype='uint8')
            for y in range(0, t[1] - 3, 8):
                for x in range(0, t[0] - 3, 8):
                    a[y:y + 3, x:x + 3] = 255
            return Image.fromarray(a)
        res, appels = self.prep(self.lucida_qui_reussit(confettis))
        self.assert_repli_u2net(res, appels, 'aucune composante significative')

    def test_une_composante_juste_assez_grande_suffit(self):
        # le seuil est 0,5 % de l'image pour la plus grande composante : une ellipse de 2 % passe, des confettis non
        self.prep(self.lucida_qui_reussit(lambda t: ellipse(t, 0.02)))
        self.assertEqual(self.rembg.appels, [])

    # --- pas de detourage / mode u2net ---
    def test_image_deja_detouree_aucun_detourage(self):
        rgba = Image.new('RGBA', self.TAILLE, (0, 0, 0, 0))
        rgba.paste(Image.new('RGBA', (100, 140), (30, 160, 40, 255)), (70, 90))
        chemin = os.path.join(self.tmp.name, 'deja.png')
        rgba.save(chemin)
        res, appels = self.prep(chemin=chemin)
        self.assertEqual(appels, [], 'aucun sous-processus')
        self.assertEqual(self.rembg.appels, [], 'aucun rembg')
        self.assertIn('detourage: aucun', ' '.join(self.journal))
        self.assertEqual(res.getpixel((res.size[0] // 2, res.size[1] // 2))[:3], (30, 160, 40))

    def test_rgba_entierement_opaque_est_detouree(self):
        chemin = os.path.join(self.tmp.name, 'opaque.png')
        Image.open(self.image).convert('RGBA').save(chemin)
        res, appels = self.prep(self.lucida_qui_reussit(lambda t: ellipse(t, 0.3)), chemin=chemin)
        self.assertEqual(len(appels), 1)
        self.ligne('detourage: lucida (')

    def test_variable_u2net_saute_lucida(self):
        os.environ['FABMESH_DETOURAGE'] = 'u2net'
        res, appels = self.prep()
        self.assertEqual(appels, [])
        self.assertEqual(len(self.rembg.appels), 1)
        self.assertEqual(self.rembg.appels[0][2], ('session', 'u2net'))
        self.assertEqual(self.ligne('detourage: u2net ('), 'detourage: u2net (FABMESH_DETOURAGE=u2net)')

    def test_variable_u2net_insensible_a_la_casse_et_aux_espaces(self):
        os.environ['FABMESH_DETOURAGE'] = '  U2Net '
        _, appels = self.prep()
        self.assertEqual(appels, [])

    def test_variable_auto_ou_vide_ou_inconnue_essaie_lucida(self):
        for valeur, inconnue in (('auto', False), ('', False), ('lucida', True)):
            with self.subTest(valeur=valeur):
                self.journal.clear()
                self.rembg.appels.clear()
                os.environ['FABMESH_DETOURAGE'] = valeur
                _, appels = self.prep(self.lucida_qui_reussit(lambda t: ellipse(t, 0.3)))
                self.assertEqual(len(appels), 1)
                self.assertEqual(self.rembg.appels, [])
                self.assertEqual(any('inconnu' in l for l in self.journal), inconnue)

    def test_le_repli_u2net_est_celui_d_avant(self):
        # repli : rembg.remove(image.convert('RGBA'), session=new_session('u2net')), puis la meme suite
        res, appels = self.prep(self.lucida_qui_echoue(1))
        self.assertEqual(res.size[0], res.size[1])
        self.assertEqual(res.getpixel((0, 0)), (0, 0, 0, 0))

    def test_le_vrai_script_sans_poids_son_code_retour_2_declenche_le_repli_u2net(self):
        # AUCUNE doublure du sous-processus : le vrai scripts/lucida_matte.py, lance par l'interpreteur de l'appli, sans poids
        # nulle part (dossier personnel vide, aucun cache Hugging Face). C'est le contrat entre les deux fichiers : code
        # retour 2 + « LUCIDA_ERROR: poids Lucida absents » sur la sortie d'erreur -> raison lisible dans le journal -> u2net.
        env = env_sans_poids(self.tmp.name)               # AVANT clear() : il part de l'environnement courant (SYSTEMROOT...)
        os.environ.clear()
        os.environ.update(env)
        res = self.ns['_prep_image'](self.image)
        self.assertEqual(len(self.rembg.appels), 1, 'repli u2net')
        self.assertIn('detourage: u2net (code retour 2 : LUCIDA_ERROR: poids Lucida absents', ' '.join(self.journal))
        self.assertNotIn('detourage: lucida', ' '.join(self.journal))
        self.assertEqual(res.mode, 'RGBA')


if __name__ == '__main__':
    unittest.main()
