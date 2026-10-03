"""Tests de modal_app/_detourage.py : detourage u2net + Lucida, masque = UNION (2026-10-03).

Aucun GPU, aucun poids, aucun reseau, AUCUN import de torch (sauf la classe optionnelle de la fin) : la session onnx, le modele Lucida,
`torch` et `transformers` sont des DOUBLURES. Chaque test repart d'un exemplaire neuf du module (etat Lucida vierge).

Ce que les tests prouvent :
  - mode u2net (FABMESH_DETOURAGE=u2net) ET Lucida indisponible : resultat IDENTIQUE, pixel pour pixel, a l'ancienne detourer
    (recopiee dans ce fichier) sur des images RGB / RGBA / L / P / LA, avec EXIF, de 1x1 a 200x120 ; masque() et _session() inchanges ;
  - mode union : alpha = max(Lucida, u2net la ou il est sur) sur les trois cas de la mesure du 03/10 (orc : Lucida ajoute l'arme ;
    ane : u2net garde le corps quand Lucida echoue ; mille-pattes : u2net garde le bout du corps) et sur des masques aleatoires ;
    les traces fantomes de u2net (alpha faible) ne s'ajoutent pas ; journal d'une ligne par appel (+ « en defaut ») ;
  - repli : Lucida indisponible / exception / masque de mauvaise taille ou de mauvais type / fusion qui leve -> resultat d'avant ;
    detourer ne leve JAMAIS a cause de Lucida ;
  - chargement : un seul chargement sous 8 fils, echec MEMORISE (une tentative, un message), pas de CUDA = pas de chargement (et
    non memorise : une carte peut arriver), options de from_pretrained (code distant, local seulement, telechargement et revision
    sur demande), substituts kornia, precharger, cache de la carte rendu apres chaque inference ;
  - inferences serialisees ; variable d'environnement relue A CHAQUE APPEL ; images minuscules (1x1, 3x7) et grandes (2048 x 2048) ;
  - le module reste LEGER : l'importer (processus neuf) ne charge ni torch, ni transformers, ni cv2, ni onnxruntime ; le mode u2net et
    precharger() en mode u2net ne demandent jamais torch (espion d'imports avec controle positif : l'union, elle, le demande) ;
  - chemin « poids u2net absents -> rembg.remove » inchange.

Lancer :  <python de l'appli> build/bancs/noyaux/test_detourage_modal.py -v
Numpy 1.26 (celui de Modal) : <python-rig de l'appli> build/bancs/noyaux/test_detourage_modal.py -v
Autre copie du module (preuve d'echec sur l'ancien code ou sur un mutant) : variable NOYAU_DETOURAGE_MODAL.
Classe optionnelle (torch REEL, processeur, un tout petit modele) : DETOURAGE_TEST_TORCH=1 puis
    bash /c/tmp/lourd.sh <python de l'appli> build/bancs/noyaux/test_detourage_modal.py -v
"""
import contextlib
import importlib.util
import inspect
import io
import itertools
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
import types
import unittest
from unittest import mock

import numpy as np
from PIL import Image, ImageOps

for _flux in (sys.stdout, sys.stderr):
    try:
        _flux.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

RACINE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
sys.path.insert(0, RACINE)
CHEMIN = os.environ.get('NOYAU_DETOURAGE_MODAL') or os.path.join(RACINE, 'modal_app', '_detourage.py')
_COMPTEUR = itertools.count()

RE_UNION = re.compile(r'^\[detourage\] union : u2net (\d+\.\d) %, lucida (\d+\.\d) %, union (\d+\.\d) % en (\d+) ms')


@contextlib.contextmanager
def remplacer_modules(remplacements):
    """Pose des modules factices dans sys.modules (None = « absent ») et ne restaure QUE ces cles.

    mock.patch.dict(sys.modules, ...) viderait puis reremplirait tout sys.modules : les modules importes pendant le test (extensions C
    de numpy ou de PIL) seraient oublies, puis reimportes une seconde fois, ce qu'une extension C refuse parfois."""
    absent = object()
    avant = {cle: sys.modules.get(cle, absent) for cle in remplacements}
    sys.modules.update(remplacements)
    try:
        yield
    finally:
        for cle, valeur in avant.items():
            if valeur is absent:
                sys.modules.pop(cle, None)
            else:
                sys.modules[cle] = valeur


def charger_module():
    """Un exemplaire NEUF de modal_app/_detourage.py (ou de la copie NOYAU_DETOURAGE_MODAL) : etat Lucida vierge."""
    nom = 'detourage_sous_test_%d' % next(_COMPTEUR)
    spec = importlib.util.spec_from_file_location(nom, CHEMIN)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ---------------------------------------------------------------------------------------------------------------------
# L'ANCIEN CODE, recopie tel quel de modal_app/_detourage.py (HEAD au 2026-10-03) : la reference du mode u2net
# ---------------------------------------------------------------------------------------------------------------------
def masque_ancien(img, session):
    s = session
    im = np.array(img.convert("RGB").resize((320, 320), Image.Resampling.LANCZOS))
    im = im / max(np.max(im), 1e-6)
    t = np.zeros((im.shape[0], im.shape[1], 3))
    for c, (m, e) in enumerate(zip((0.485, 0.456, 0.406), (0.229, 0.224, 0.225))):
        t[:, :, c] = (im[:, :, c] - m) / e
    entree = {s.get_inputs()[0].name: np.expand_dims(t.transpose((2, 0, 1)), 0).astype(np.float32)}
    pred = s.run(None, entree)[0][:, 0, :, :]
    ma, mi = np.max(pred), np.min(pred)
    pred = np.squeeze((pred - mi) / (ma - mi))
    m = Image.fromarray((pred.clip(0, 1) * 255).astype("uint8"), mode="L")
    return m.resize(img.size, Image.Resampling.LANCZOS)


def detourer_ancien(img, session):
    img = ImageOps.exif_transpose(img)
    return Image.composite(img, Image.new("RGBA", img.size, 0), masque_ancien(img, session))


def alpha_attendu(a_u2, a_lucida, seuil=127):
    """Le contrat de l'union, ecrit ICI independamment du module : max(Lucida, u2net la ou u2net >= seuil, sinon 0)."""
    sur = np.where(a_u2 >= seuil, a_u2, 0).astype(np.uint8)
    return np.maximum(sur, a_lucida)


def decouper(img, alpha):
    return Image.composite(img, Image.new("RGBA", img.size, 0), Image.fromarray(alpha))


# ---------------------------------------------------------------------------------------------------------------------
# DOUBLURES
# ---------------------------------------------------------------------------------------------------------------------
class FausseSession(object):
    """Fausse session onnxruntime : meme interface (get_inputs / run), rend une carte (1, 1, 320, 320) CONNUE."""

    def __init__(self, carte):
        self.carte = np.asarray(carte, dtype=np.float32).reshape(1, 1, 320, 320)
        self.appels = 0

    def get_inputs(self):
        return [types.SimpleNamespace(name='input.1')]

    def run(self, sorties, entree):
        assert sorties is None
        x = entree['input.1']
        assert x.shape == (1, 3, 320, 320) and x.dtype == np.float32, (x.shape, x.dtype)
        self.appels += 1
        return [self.carte.copy()]


def carte_u2net(rects, fantomes=()):
    """Carte 320 x 320 : 1,0 dans les rectangles (fractions de l'image), 0,3 dans les fantomes (trace faible), 0 ailleurs."""
    n = 320
    a = np.zeros((n, n), np.float32)
    for x0, y0, x1, y1 in fantomes:
        a[int(y0 * n):int(y1 * n), int(x0 * n):int(x1 * n)] = 0.3
    for x0, y0, x1, y1 in rects:
        a[int(y0 * n):int(y1 * n), int(x0 * n):int(x1 * n)] = 1.0
    return a


def fabrique_alpha(rects):
    """Rend f((largeur, hauteur)) -> masque Lucida uint8 (hauteur, largeur) : 255 dans les rectangles (fractions de l'image)."""
    def f(taille):
        w, h = taille
        a = np.zeros((h, w), np.uint8)
        for x0, y0, x1, y1 in rects:
            a[int(y0 * h):int(y1 * h), int(x0 * w):int(x1 * w)] = 255
        return a
    return f


class FauxLucida(object):
    """Enveloppe de Lucida factice : alpha(image PIL RGB) -> ndarray, avec compteurs d'appels et de simultaneite."""
    peripherique = 'cuda'

    def __init__(self, fabrique, delai=0.0):
        self.fabrique = fabrique
        self.delai = delai
        self.appels = []
        self.en_cours = 0
        self.max_en_cours = 0
        self._v = threading.Lock()

    def alpha(self, img_rgb):
        with self._v:
            self.en_cours += 1
            self.max_en_cours = max(self.max_en_cours, self.en_cours)
        try:
            self.appels.append((img_rgb.mode, img_rgb.size))
            if self.delai:
                time.sleep(self.delai)
            return self.fabrique(img_rgb.size)
        finally:
            with self._v:
                self.en_cours -= 1


class FauxModele(object):
    """Faux modele transformers : note ce qu'on lui fait (to / float / eval)."""

    def __init__(self):
        self.journal = []

    def to(self, peripherique):
        self.journal.append(('to', peripherique))
        return self

    def float(self):
        self.journal.append(('float',))
        return self

    def eval(self):
        self.journal.append(('eval',))
        return self


def faux_torch(cuda):
    t = types.ModuleType('torch')
    t.cuda = types.SimpleNamespace(is_available=lambda: cuda, empty_cache=lambda: None)
    t.no_grad = contextlib.nullcontext
    return t


def faux_transformers(modele=None, erreur=None):
    """Faux module transformers : AutoModelForImageSegmentation.from_pretrained note ses appels dans `appels`."""
    t = types.ModuleType('transformers')
    t.appels = []

    class AutoModelForImageSegmentation(object):
        @staticmethod
        def from_pretrained(depot, **options):
            t.appels.append((depot, dict(options)))
            if erreur is not None:
                raise erreur
            return modele if modele is not None else FauxModele()

    t.AutoModelForImageSegmentation = AutoModelForImageSegmentation
    return t


def images_variees():
    rng = np.random.default_rng(11)
    sortie = []
    for (w, h) in ((64, 48), (1, 1), (3, 7), (200, 120), (48, 64)):
        rgb = rng.integers(0, 256, (h, w, 3), dtype=np.uint8)
        alpha = rng.integers(0, 256, (h, w, 1), dtype=np.uint8)
        sortie.append(('RGB %dx%d' % (w, h), Image.fromarray(rgb)))
        sortie.append(('RGBA alpha partiel %dx%d' % (w, h), Image.fromarray(np.concatenate([rgb, alpha], axis=2))))
        sortie.append(('RGBA opaque %dx%d' % (w, h), Image.fromarray(np.concatenate([rgb, np.full((h, w, 1), 255, np.uint8)], axis=2))))
        sortie.append(('L %dx%d' % (w, h), Image.fromarray(rgb).convert('L')))
        sortie.append(('P %dx%d' % (w, h), Image.fromarray(rgb).convert('P')))
        sortie.append(('LA %dx%d' % (w, h), Image.fromarray(rgb).convert('LA')))
    for orientation in (3, 6, 8):
        exif = Image.Exif()
        exif[0x0112] = orientation
        tampon = io.BytesIO()
        Image.fromarray(rng.integers(0, 256, (40, 24, 3), dtype=np.uint8)).save(tampon, 'JPEG', exif=exif)
        tampon.seek(0)
        sortie.append(('JPEG EXIF orientation %d' % orientation, Image.open(tampon)))
    return sortie


# ---------------------------------------------------------------------------------------------------------------------
# BASE : module neuf, poids u2net factices, session fausse, environnement propre, AUCUN import lourd possible
# ---------------------------------------------------------------------------------------------------------------------
class Base(unittest.TestCase):
    TAILLE = (160, 200)          # (largeur, hauteur), NON carre : toute confusion (h, w) casse un test

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.poids = os.path.join(self.tmp.name, 'u2net.onnx')
        with open(self.poids, 'wb') as f:
            f.write(b'poids factices')
        self.mod = charger_module()
        self.mod.POIDS_U2NET = self.poids
        self.session = FausseSession(carte_u2net([(0.35, 0.10, 0.65, 0.95)]))
        self.mod._session = lambda: self.session
        env = mock.patch.dict(os.environ)
        env.start()
        self.addCleanup(env.stop)
        for cle in [c for c in os.environ if c.startswith('FABMESH_')]:
            del os.environ[cle]
        # torch / transformers / kornia / substituts : des doublures, jamais les vrais paquets (heavy, et GPU interdit ici)
        self.transformers = faux_transformers()
        modules = remplacer_modules({'torch': faux_torch(False), 'transformers': self.transformers,
                                     'kornia': None, 'modal_app.lucida_shims': None})
        modules.__enter__()
        self.addCleanup(modules.__exit__, None, None, None)
        self.journal = ''

    # -- aides --------------------------------------------------------------------------------------------------------
    def image(self, taille=None, graine=5):
        w, h = taille or self.TAILLE
        rng = np.random.default_rng(graine)
        return Image.fromarray(rng.integers(0, 256, (h, w, 3), dtype=np.uint8))

    def detourer(self, img):
        """detourer du module, journal capture dans self.journal."""
        sortie = io.StringIO()
        with contextlib.redirect_stdout(sortie):
            res = self.mod.detourer(img)
        self.journal = sortie.getvalue()
        return res

    def poser_lucida(self, fabrique, delai=0.0):
        """Installe un faux Lucida (a la place du chargement) et le rend."""
        faux = FauxLucida(fabrique, delai)
        self.mod._charger_lucida = lambda: faux
        return faux

    def interdire_lucida(self):
        def interdit():
            raise AssertionError("Lucida ne doit pas etre sollicite ici")
        self.mod._charger_lucida = interdit
        self.mod._construire_lucida = interdit

    def avec_cuda(self, modele=None, erreur=None):
        """torch annonce une carte CUDA ; transformers rend `modele` (ou leve `erreur`)."""
        sys.modules['torch'] = faux_torch(True)
        self.transformers = faux_transformers(modele, erreur)
        sys.modules['transformers'] = self.transformers

    def memes_pixels(self, a, b, message=''):
        self.assertEqual((a.mode, a.size), (b.mode, b.size), message)
        self.assertEqual(a.tobytes(), b.tobytes(), message)

    @staticmethod
    def alpha_en(res, fx, fy):
        w, h = res.size
        return int(np.asarray(res)[int(fy * h), int(fx * w), 3])


# ---------------------------------------------------------------------------------------------------------------------
# 1. LE MODE u2net ET LE REPLI = L'ANCIEN COMPORTEMENT, A L'OCTET
# ---------------------------------------------------------------------------------------------------------------------
class ModeU2netIdentiqueALAncien(Base):

    def test_masque_et_signature_inchanges(self):
        self.assertEqual(list(inspect.signature(self.mod.detourer).parameters), ['img'])
        self.assertEqual(list(inspect.signature(self.mod.masque).parameters), ['img'])
        self.assertEqual(list(inspect.signature(self.mod.masque_lucida).parameters), ['img'])
        for nom, img in images_variees():
            with self.subTest(image=nom):
                self.memes_pixels(self.mod.masque(ImageOps.exif_transpose(img)),
                                  masque_ancien(ImageOps.exif_transpose(img), self.session))

    def _comparer(self, preparer):
        """Compare detourer (apres `preparer`) a l'ancienne sur toutes les images ; une exception doit etre la meme."""
        for nom, img in images_variees():
            with self.subTest(image=nom):
                try:
                    attendu = detourer_ancien(img, self.session)
                    erreur_attendue = None
                except Exception as e:                     # un mode d'image que l'ancienne code refuse : le nouveau aussi
                    attendu, erreur_attendue = None, type(e)
                preparer()
                if erreur_attendue is not None:
                    with self.assertRaises(erreur_attendue):
                        self.detourer(img)
                    continue
                res = self.detourer(img)
                self.assertEqual(res.mode, 'RGBA')
                self.memes_pixels(res, attendu, nom)

    def test_mode_u2net_pixel_pour_pixel(self):
        os.environ['FABMESH_DETOURAGE'] = 'u2net'
        self.interdire_lucida()
        self._comparer(lambda: None)
        self.assertEqual(self.journal, '')           # comportement d'avant : pas une ligne de journal

    def test_mode_u2net_ecrit_autrement(self):
        self.interdire_lucida()
        for valeur in ('U2NET', '  u2net ', 'U2net\n'):
            with self.subTest(valeur=valeur):
                os.environ['FABMESH_DETOURAGE'] = valeur
                self.memes_pixels(self.detourer(self.image()), detourer_ancien(self.image(), self.session))

    def test_lucida_indisponible_pixel_pour_pixel(self):
        # pas de variable : union par defaut, mais pas de carte CUDA (le faux torch du setUp) -> u2net seul
        self._comparer(lambda: None)
        self.assertEqual(self.transformers.appels, [])            # rien charge

    def test_lucida_qui_leve_pixel_pour_pixel(self):
        faux = self.poser_lucida(lambda taille: (_ for _ in ()).throw(RuntimeError("OOM factice")))
        self._comparer(lambda: None)
        self.assertGreater(len(faux.appels), 0)

    def test_chemin_poids_absents_rembg_inchange(self):
        rembg = types.ModuleType('rembg')
        rembg.remove = lambda im: ('rembg.remove', im)
        self.interdire_lucida()
        with remplacer_modules({'rembg': rembg}):
            self.mod.POIDS_U2NET = os.path.join(self.tmp.name, 'absent.onnx')
            img = self.image()
            for mode in (None, 'u2net', 'union', 'lucida', 'auto', 'n_importe_quoi'):
                with self.subTest(mode=mode):
                    if mode is None:
                        os.environ.pop('FABMESH_DETOURAGE', None)
                    else:
                        os.environ['FABMESH_DETOURAGE'] = mode
                    r = self.mod.detourer(img)
                    self.assertEqual(r[0], 'rembg.remove')
                    self.assertIs(r[1], img)                 # l'image d'origine, sans exif_transpose, comme avant
        self.assertEqual(self.session.appels, 0)

    def test_session_inchangee(self):
        # _session() : onnxruntime sur le PROCESSEUR, memes options que rembg.new_session, une seule creation
        creations = []

        class FausseInferenceSession(object):
            def __init__(self, chemin, sess_options=None, providers=None):
                creations.append((chemin, sess_options, providers))

        class FausseOptions(object):
            inter_op_num_threads = None
            intra_op_num_threads = None

        ort = types.ModuleType('onnxruntime')
        ort.InferenceSession = FausseInferenceSession
        ort.SessionOptions = FausseOptions
        mod = charger_module()
        mod.POIDS_U2NET = self.poids
        os.environ['OMP_NUM_THREADS'] = '3'
        with remplacer_modules({'onnxruntime': ort}):
            s1, s2 = mod._session(), mod._session()
        self.assertIs(s1, s2)
        self.assertEqual(len(creations), 1)
        chemin, options, fournisseurs = creations[0]
        self.assertEqual((chemin, fournisseurs), (self.poids, ['CPUExecutionProvider']))
        self.assertEqual((options.inter_op_num_threads, options.intra_op_num_threads), (3, 3))


# ---------------------------------------------------------------------------------------------------------------------
# 2. L'UNION
# ---------------------------------------------------------------------------------------------------------------------
class Union(Base):
    CORPS = (0.35, 0.10, 0.65, 0.95)
    ARMES = [(0.02, 0.10, 0.33, 0.30), (0.67, 0.10, 0.98, 0.30)]
    FANTOME = (0.05, 0.60, 0.25, 0.70)

    def u2_alpha(self, img):
        return np.asarray(masque_ancien(ImageOps.exif_transpose(img), self.session))

    def test_orc_lucida_ajoute_les_armes_u2net_garde_le_corps(self):
        # u2net : le corps + une trace fantome (alpha ~ 0,3) ; Lucida : le corps ET les deux armes (planche_1.png)
        self.session = FausseSession(carte_u2net([self.CORPS], fantomes=[self.FANTOME]))
        self.poser_lucida(fabrique_alpha([self.CORPS] + self.ARMES))
        img = self.image()
        seul = detourer_ancien(img, self.session)
        res = self.detourer(img)
        self.assertEqual((res.mode, res.size), ('RGBA', self.TAILLE))
        self.assertEqual(self.alpha_en(seul, 0.175, 0.20), 0)          # u2net seul : l'arme gauche est perdue
        self.assertEqual(self.alpha_en(seul, 0.825, 0.20), 0)
        for fx, fy in ((0.175, 0.20), (0.825, 0.20)):                  # l'union : les deux armes
            self.assertEqual(self.alpha_en(res, fx, fy), 255, (fx, fy))
        self.assertEqual(self.alpha_en(res, 0.50, 0.50), 255)          # le corps
        self.assertEqual(self.alpha_en(res, 0.10, 0.90), 0)            # le fond
        # la trace fantome de u2net (alpha ~ 76 < 127) n'est PAS ajoutee
        self.assertTrue(70 <= self.alpha_en(seul, 0.15, 0.65) <= 80, self.alpha_en(seul, 0.15, 0.65))
        self.assertEqual(self.alpha_en(res, 0.15, 0.65), 0)

    def test_ane_u2net_garde_le_corps_quand_lucida_echoue(self):
        self.session = FausseSession(carte_u2net([(0.10, 0.20, 0.90, 0.80)]))
        self.poser_lucida(fabrique_alpha([(0.40, 0.45, 0.55, 0.55)]))      # Lucida ne garde qu'une tache
        img = self.image()
        res = self.detourer(img)
        for fx, fy in ((0.20, 0.50), (0.50, 0.30), (0.80, 0.70), (0.475, 0.50)):
            self.assertEqual(self.alpha_en(res, fx, fy), 255, (fx, fy))     # le corps est COMPLET
        self.assertEqual(self.alpha_en(res, 0.05, 0.05), 0)
        self.assertIn('lucida en defaut', self.journal)
        self.assertNotIn('u2net en defaut', self.journal)

    def test_mille_pattes_u2net_garde_le_bout_du_corps(self):
        self.session = FausseSession(carte_u2net([(0.05, 0.40, 0.95, 0.60)]))
        self.poser_lucida(fabrique_alpha([(0.05, 0.40, 0.80, 0.60)]))      # Lucida perd le dernier quart
        res = self.detourer(self.image())
        self.assertEqual(self.alpha_en(res, 0.90, 0.50), 255)               # le bout, venu de u2net
        self.assertEqual(self.alpha_en(res, 0.30, 0.50), 255)
        self.assertIsNotNone(RE_UNION.match(self.journal), self.journal)
        self.assertNotIn('en defaut', self.journal)                          # 0,83 de l'aire de u2net : pas « defaillant »

    def test_journal_une_ligne_par_appel_et_marqueurs(self):
        self.session = FausseSession(carte_u2net([self.CORPS]))
        self.poser_lucida(fabrique_alpha([self.CORPS] + self.ARMES))
        img = self.image()
        sortie = io.StringIO()
        with contextlib.redirect_stdout(sortie):
            for _ in range(3):
                self.mod.detourer(img)
        lignes = sortie.getvalue().splitlines()
        self.assertEqual(len(lignes), 3, lignes)
        for ligne in lignes:
            m = RE_UNION.match(ligne)
            self.assertIsNotNone(m, ligne)
        # pourcentages = les vraies aires (seuil 127) ; l'orc : u2net 25,5 %, Lucida plus grand -> « u2net en defaut »
        a_u2 = self.u2_alpha(img)
        a_lu = fabrique_alpha([self.CORPS] + self.ARMES)(img.size)
        m = RE_UNION.match(lignes[0])
        self.assertEqual(m.group(1), '%.1f' % (100.0 * np.count_nonzero(a_u2 >= 127) / a_u2.size))
        self.assertEqual(m.group(2), '%.1f' % (100.0 * np.count_nonzero(a_lu >= 127) / a_lu.size))
        self.assertEqual(m.group(3), '%.1f' % (100.0 * np.count_nonzero((a_u2 >= 127) | (a_lu >= 127)) / a_lu.size))
        self.assertTrue(lignes[0].endswith('u2net en defaut'), lignes[0])
        self.assertNotIn('lucida en defaut', lignes[0])

    def test_pas_de_marqueur_quand_les_masques_s_accordent(self):
        self.session = FausseSession(carte_u2net([self.CORPS]))
        self.poser_lucida(fabrique_alpha([self.CORPS]))
        self.detourer(self.image())
        self.assertIsNotNone(RE_UNION.match(self.journal))
        self.assertNotIn('en defaut', self.journal)

    def test_union_egale_l_oracle_sur_des_masques_aleatoires(self):
        for graine, taille in ((1, (37, 53)), (2, (64, 48)), (3, (5, 9)), (4, (200, 120))):
            with self.subTest(graine=graine):
                rng = np.random.default_rng(graine)
                carte = rng.random((320, 320)).astype(np.float32)
                carte[rng.random((320, 320)) < 0.4] = 0.0
                self.session = FausseSession(carte)
                w, h = taille
                a_lu = rng.integers(0, 256, (h, w), dtype=np.uint8)
                a_lu[rng.random((h, w)) < 0.5] = 0
                faux = self.poser_lucida(lambda t, a=a_lu: a)
                img = self.image(taille, graine)
                a_u2 = np.asarray(masque_ancien(img, self.session))
                attendu = decouper(img, alpha_attendu(a_u2, a_lu))
                res = self.detourer(img)
                self.memes_pixels(res, attendu)
                self.assertEqual(faux.appels, [('RGB', taille)])

    def test_couleurs_et_alpha_comme_rembg(self):
        # le geste de decoupe est celui de rembg.remove : alpha = masque, couleurs ponderees par le masque
        self.poser_lucida(fabrique_alpha([self.CORPS] + self.ARMES))
        img = self.image()
        a = np.asarray(self.detourer(img))
        alpha = a[..., 3]
        self.assertTrue((alpha == 0).any() and (alpha == 255).any())
        self.assertTrue((a[alpha == 0][:, :3] == 0).all())               # fond transparent NOIR, comme l'ancienne decoupe
        pleins = alpha == 255
        self.assertTrue(np.array_equal(a[pleins][:, :3], np.asarray(img)[pleins]))   # la ou le sujet est sur : couleurs d'origine

    def test_rgba_d_entree_garde_son_alpha_multiplie(self):
        # l'alpha d'une image deja decoupee est multiplie par le masque, comme avant (Image.composite)
        self.poser_lucida(fabrique_alpha([self.CORPS] + self.ARMES))
        w, h = self.TAILLE
        rng = np.random.default_rng(8)
        rgba = np.concatenate([rng.integers(0, 256, (h, w, 3), dtype=np.uint8), np.full((h, w, 1), 128, np.uint8)], axis=2)
        img = Image.fromarray(rgba)
        a_u2 = np.asarray(masque_ancien(img, self.session))
        a_lu = fabrique_alpha([self.CORPS] + self.ARMES)(img.size)
        attendu = Image.composite(img, Image.new("RGBA", img.size, 0), Image.fromarray(alpha_attendu(a_u2, a_lu)))
        self.memes_pixels(self.detourer(img), attendu)

    def test_exif_applique_avant_les_deux_masques(self):
        # orientation 6 : l'image est tournee ; les masques et le resultat sont a la taille TOURNEE
        faux = self.poser_lucida(fabrique_alpha([self.CORPS]))
        rng = np.random.default_rng(2)
        exif = Image.Exif()
        exif[0x0112] = 6
        tampon = io.BytesIO()
        Image.fromarray(rng.integers(0, 256, (40, 24, 3), dtype=np.uint8)).save(tampon, 'JPEG', exif=exif)    # 24 x 40 stocke
        tampon.seek(0)
        img = Image.open(tampon)
        self.assertEqual(img.size, (24, 40))
        res = self.detourer(img)
        self.assertEqual(res.size, (40, 24))                  # tourne de 90 degres
        self.assertEqual(faux.appels, [('RGB', (40, 24))])    # Lucida a vu l'image TOURNEE
        a_u2 = np.asarray(masque_ancien(ImageOps.exif_transpose(img), self.session))
        a_lu = fabrique_alpha([self.CORPS])((40, 24))
        self.memes_pixels(res, decouper(ImageOps.exif_transpose(img), alpha_attendu(a_u2, a_lu)))

    def test_mode_lucida_seul(self):
        os.environ['FABMESH_DETOURAGE'] = 'lucida'
        self.session = FausseSession(carte_u2net([self.CORPS]))
        faux = self.poser_lucida(fabrique_alpha([(0.10, 0.10, 0.30, 0.30)]))      # tache a part, hors du corps de u2net
        img = self.image()
        res = self.detourer(img)
        self.assertEqual(self.session.appels, 0)                                   # u2net n'est meme pas calcule
        self.assertEqual(self.alpha_en(res, 0.20, 0.20), 255)
        self.assertEqual(self.alpha_en(res, 0.50, 0.50), 0)                        # le corps de u2net n'est PAS ajoute
        self.assertEqual(len(faux.appels), 1)
        self.assertIn('lucida seul', self.journal)
        self.memes_pixels(res, decouper(img, fabrique_alpha([(0.10, 0.10, 0.30, 0.30)])(img.size)))

    def test_mode_lucida_repli_u2net(self):
        os.environ['FABMESH_DETOURAGE'] = 'lucida'
        img = self.image()
        res = self.detourer(img)                                  # pas de CUDA : Lucida indisponible
        self.memes_pixels(res, detourer_ancien(img, self.session))
        self.assertIn('lucida indisponible', self.journal)

    def test_env_relue_a_chaque_appel(self):
        faux = self.poser_lucida(fabrique_alpha([self.CORPS] + self.ARMES))
        img = self.image()
        arme = (0.175, 0.20)
        suite = [(None, 255), ('u2net', 0), ('union', 255), (' U2NET ', 0), ('lucida', 255), ('auto', 255), ('bizarre', 255),
                 ('u2net', 0), ('', 255)]
        for valeur, alpha_arme in suite:
            with self.subTest(FABMESH_DETOURAGE=valeur):
                if valeur is None:
                    os.environ.pop('FABMESH_DETOURAGE', None)
                else:
                    os.environ['FABMESH_DETOURAGE'] = valeur
                avant = len(faux.appels)
                res = self.detourer(img)
                self.assertEqual(self.alpha_en(res, *arme), alpha_arme)
                voulait_lucida = alpha_arme == 255
                self.assertEqual(len(faux.appels) - avant, 1 if voulait_lucida else 0)

    def test_precharge_ne_change_pas_l_union(self):
        # une fois le modele charge (precharger), les appels suivants ne le rechargent pas et donnent le meme resultat
        construit = []

        def construire():
            construit.append(1)
            return FauxLucida(fabrique_alpha([self.CORPS] + self.ARMES))

        self.mod._construire_lucida = construire
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertTrue(self.mod.precharger())
        a = self.detourer(self.image())
        b = self.detourer(self.image())
        self.memes_pixels(a, b)
        self.assertEqual(len(construit), 1)


# ---------------------------------------------------------------------------------------------------------------------
# 3. LUCIDA EN DEFAUT : LE RESULTAT D'AVANT, JAMAIS UNE EXCEPTION
# ---------------------------------------------------------------------------------------------------------------------
class ReplisEtRobustesse(Base):

    def _repli_identique(self, fabrique, attendu_dans_journal):
        faux = self.poser_lucida(fabrique)
        img = self.image()
        res = self.detourer(img)
        self.memes_pixels(res, detourer_ancien(img, self.session))
        self.assertIn(attendu_dans_journal, self.journal)
        self.assertEqual(len(faux.appels), 1)

    def test_masque_de_mauvaise_taille(self):
        w, h = self.TAILLE
        self._repli_identique(lambda t: np.zeros((h + 1, w), np.uint8), 'masque inattendu')
        self._repli_identique(lambda t: np.zeros((h, w - 3), np.uint8), 'masque inattendu')

    def test_masque_transpose(self):
        # (largeur, hauteur) au lieu de (hauteur, largeur) : l'erreur classique, sur une image non carree
        w, h = self.TAILLE
        self._repli_identique(lambda t: np.zeros((w, h), np.uint8), 'masque inattendu')

    def test_masque_de_mauvais_type(self):
        w, h = self.TAILLE
        for nom, fabrique in (('float32', lambda t: np.zeros((h, w), np.float32)), ('bool', lambda t: np.zeros((h, w), bool)),
                              ('3D', lambda t: np.zeros((h, w, 1), np.uint8)), ('None', lambda t: None),
                              ('liste', lambda t: [[0] * w] * h), ('image PIL', lambda t: Image.new('L', (w, h)))):
            with self.subTest(type=nom):
                self._repli_identique(fabrique, 'masque inattendu')

    def test_exceptions_de_toutes_sortes(self):
        def leve(erreur):
            def f(taille):
                raise erreur
            return f
        for erreur in (RuntimeError("CUDA out of memory"), MemoryError(), ValueError("x"), KeyError("k"), OSError("disque"),
                       AttributeError("a"), ZeroDivisionError("z"), AssertionError("a")):
            with self.subTest(erreur=type(erreur).__name__):
                self._repli_identique(leve(erreur), 'inference impossible')

    def test_charger_lucida_qui_leve_n_importe_quoi(self):
        def casse():
            raise TypeError("bug inattendu dans le chargeur")
        self.mod._charger_lucida = casse
        img = self.image()
        with contextlib.redirect_stdout(io.StringIO()) as sortie:
            self.assertIsNone(self.mod.masque_lucida(img))
        self.assertIn("bug inattendu dans le chargeur", sortie.getvalue())
        self.memes_pixels(self.detourer(img), detourer_ancien(img, self.session))

    def test_fusion_qui_leve_repli_u2net(self):
        self.poser_lucida(fabrique_alpha([(0.1, 0.1, 0.3, 0.3)]))
        img = self.image()
        for nom in ('fusionner_alphas', 'diagnostic_masques'):
            with self.subTest(fonction=nom):
                with mock.patch.object(self.mod, nom, side_effect=ValueError("fusion cassee")):
                    res = self.detourer(img)
                self.memes_pixels(res, detourer_ancien(img, self.session))
                self.assertIn('union impossible', self.journal)

    def test_u2net_qui_leve_remonte_comme_avant(self):
        # seul Lucida est protege : une erreur de u2net (inchangee) remonte, comme avant
        def casse():
            raise RuntimeError("session onnx cassee")
        self.mod._session = casse
        self.poser_lucida(fabrique_alpha([(0.1, 0.1, 0.3, 0.3)]))
        with self.assertRaises(RuntimeError):
            self.mod.detourer(self.image())

    def test_masque_lucida_rend_un_masque_L_de_la_taille_de_l_image(self):
        faux = self.poser_lucida(fabrique_alpha([(0.2, 0.2, 0.8, 0.8)]))
        for taille in ((160, 200), (1, 1), (3, 7), (7, 3), (33, 2)):
            with self.subTest(taille=taille):
                for mode in ('RGB', 'RGBA', 'L', 'P'):
                    img = Image.new(mode, taille)
                    m = self.mod.masque_lucida(img)
                    self.assertEqual((m.mode, m.size), ('L', taille))
        self.assertTrue(all(mode == 'RGB' for mode, _ in faux.appels))      # Lucida recoit toujours du RGB

    def test_entree_non_modifiee(self):
        fixe = fabrique_alpha([(0.2, 0.2, 0.8, 0.8)])(self.TAILLE)
        copie = fixe.copy()
        self.poser_lucida(lambda t: fixe)
        img = self.image()
        avant = img.tobytes()
        self.detourer(img)
        self.assertEqual(img.tobytes(), avant)
        self.assertTrue(np.array_equal(fixe, copie))


# ---------------------------------------------------------------------------------------------------------------------
# 4. CHARGEMENT PARESSEUX, UNIQUE, ECHEC MEMORISE
# ---------------------------------------------------------------------------------------------------------------------
class Chargement(Base):

    def test_un_seul_chargement_sous_huit_fils(self):
        construit = []

        def construire():
            construit.append(threading.get_ident())
            time.sleep(0.15)                               # elargit la fenetre de course
            return FauxLucida(fabrique_alpha([(0.2, 0.2, 0.8, 0.8)]))

        self.mod._construire_lucida = construire
        barriere = threading.Barrier(8)
        resultats, erreurs = [], []

        def tache():
            try:
                barriere.wait(timeout=10)
                resultats.append(self.mod._charger_lucida())
            except BaseException as e:                      # noqa: BLE001
                erreurs.append(e)

        sortie = io.StringIO()
        with contextlib.redirect_stdout(sortie):
            fils = [threading.Thread(target=tache) for _ in range(8)]
            for f in fils:
                f.start()
            for f in fils:
                f.join(20)
        self.assertEqual(erreurs, [])
        self.assertEqual(len(construit), 1, "Lucida a ete charge %d fois" % len(construit))
        self.assertEqual(len(resultats), 8)
        self.assertTrue(all(r is resultats[0] for r in resultats))
        self.assertEqual(sortie.getvalue().count('Lucida charge'), 1)

    def test_detourer_concurrent_un_seul_chargement(self):
        construit = []

        def construire():
            construit.append(1)
            time.sleep(0.1)
            return FauxLucida(fabrique_alpha([(0.2, 0.2, 0.8, 0.8)]))

        self.mod._construire_lucida = construire
        barriere = threading.Barrier(6)
        resultats = []

        def tache():
            barriere.wait(timeout=10)
            resultats.append(self.mod.detourer(self.image()))

        sortie = io.StringIO()
        with contextlib.redirect_stdout(sortie):
            fils = [threading.Thread(target=tache) for _ in range(6)]
            for f in fils:
                f.start()
            for f in fils:
                f.join(30)
        self.assertEqual(len(construit), 1)
        self.assertEqual(len(resultats), 6)
        self.assertEqual(len({r.tobytes() for r in resultats}), 1)           # meme image, meme resultat

    def test_succes_charge_une_seule_fois(self):
        construit = []

        def construire():
            construit.append(1)
            return FauxLucida(fabrique_alpha([(0.2, 0.2, 0.8, 0.8)]))

        self.mod._construire_lucida = construire
        for _ in range(20):
            self.detourer(self.image())
        self.assertEqual(len(construit), 1)

    def test_echec_memorise_une_tentative_un_message(self):
        tentatives = []

        def construire():
            tentatives.append(1)
            raise RuntimeError("poids absents de l'image")

        self.mod._construire_lucida = construire
        img = self.image()
        sortie = io.StringIO()
        with contextlib.redirect_stdout(sortie):
            for _ in range(5):
                res = self.mod.detourer(img)
        self.memes_pixels(res, detourer_ancien(img, self.session))
        self.assertEqual(len(tentatives), 1)                            # pas de nouvel essai a chaque image
        self.assertEqual(sortie.getvalue().count('Lucida indisponible'), 1)
        self.assertIn("poids absents de l'image", sortie.getvalue())

    def test_echec_memorise_aussi_pour_precharger(self):
        tentatives = []

        def construire():
            tentatives.append(1)
            raise OSError("pas de reseau")

        self.mod._construire_lucida = construire
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertFalse(self.mod.precharger())
            self.assertFalse(self.mod.precharger())
            self.detourer(self.image())
        self.assertEqual(len(tentatives), 1)

    def test_reinitialiser_oublie_le_modele_et_l_echec(self):
        tentatives = []

        def construire():
            tentatives.append(1)
            if len(tentatives) == 1:
                raise RuntimeError("premier essai rate")
            return FauxLucida(fabrique_alpha([(0.2, 0.2, 0.8, 0.8)]))

        self.mod._construire_lucida = construire
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertFalse(self.mod.precharger())
            self.mod.reinitialiser_lucida()
            self.assertTrue(self.mod.precharger())
            self.assertTrue(self.mod.precharger())
        self.assertEqual(len(tentatives), 2)

    def test_precharger_ne_leve_jamais(self):
        for erreur in (RuntimeError("x"), OSError("y"), ImportError("z"), ValueError("v"), KeyError("k")):
            with self.subTest(erreur=type(erreur).__name__):
                mod = charger_module()

                def construire(e=erreur):
                    raise e

                mod._construire_lucida = construire
                with contextlib.redirect_stdout(io.StringIO()):
                    self.assertIs(mod.precharger(), False)
        mod = charger_module()
        mod._charger_lucida = lambda: (_ for _ in ()).throw(TypeError("chargeur casse"))
        self.assertIs(mod.precharger(), False)

    def test_precharger_vrai_quand_pret_et_sans_effet_en_mode_u2net(self):
        construit = []

        def construire():
            construit.append(1)
            return FauxLucida(fabrique_alpha([(0.2, 0.2, 0.8, 0.8)]))

        self.mod._construire_lucida = construire
        os.environ['FABMESH_DETOURAGE'] = 'u2net'
        self.assertIs(self.mod.precharger(), False)
        self.assertEqual(construit, [])                                  # u2net seul : on ne paie pas 0,85 Go de carte
        os.environ['FABMESH_DETOURAGE'] = 'union'
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertIs(self.mod.precharger(), True)
        self.assertEqual(len(construit), 1)

    def test_inferences_serialisees(self):
        faux = self.poser_lucida(fabrique_alpha([(0.2, 0.2, 0.8, 0.8)]), delai=0.05)
        barriere = threading.Barrier(6)
        masques = []

        def tache():
            barriere.wait(timeout=10)
            masques.append(self.mod.masque_lucida(self.image()))

        with contextlib.redirect_stdout(io.StringIO()):
            fils = [threading.Thread(target=tache) for _ in range(6)]
            for f in fils:
                f.start()
            for f in fils:
                f.join(30)
        self.assertEqual(len(faux.appels), 6)
        self.assertEqual(faux.max_en_cours, 1, "deux inferences Lucida ont tourne en meme temps")
        self.assertTrue(all(m is not None for m in masques))


# ---------------------------------------------------------------------------------------------------------------------
# 5. _construire_lucida : CUDA obligatoire, options de from_pretrained, substituts kornia
# ---------------------------------------------------------------------------------------------------------------------
class ConstructionDeLucida(Base):

    def test_pas_de_cuda_aucun_chargement(self):
        img = self.image()
        sortie = io.StringIO()
        with contextlib.redirect_stdout(sortie):
            self.assertIsNone(self.mod.masque_lucida(img))
            self.assertIsNone(self.mod.masque_lucida(img))
        self.assertEqual(self.transformers.appels, [])         # jamais de chargement sur le processeur
        self.assertEqual(sortie.getvalue().count('pas de carte CUDA'), 1)

    def test_absence_de_carte_n_est_pas_memorisee(self):
        # pas de carte : indisponible, UN seul message, rien charge. Puis une carte apparait (instantane GPU restaure) : on charge.
        img = self.image()
        sortie = io.StringIO()
        with contextlib.redirect_stdout(sortie):
            self.assertIsNone(self.mod.masque_lucida(img))
            self.assertIsNone(self.mod._charger_lucida())
            self.assertFalse(self.mod.precharger())
        self.assertEqual(self.transformers.appels, [])
        self.assertEqual(sortie.getvalue().count('pas de carte CUDA'), 1)
        modele = FauxModele()
        self.avec_cuda(modele)                                           # la carte est la
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertTrue(self.mod.precharger())
        self.assertEqual(len(self.transformers.appels), 1)
        self.assertEqual(modele.journal, [('to', 'cuda'), ('float',), ('eval',)])

    def test_cuda_present_charge_sur_cuda_float32_eval(self):
        modele = FauxModele()
        self.avec_cuda(modele)
        with contextlib.redirect_stdout(io.StringIO()):
            lucida = self.mod._charger_lucida()
        self.assertEqual(len(self.transformers.appels), 1)
        depot, options = self.transformers.appels[0]
        self.assertEqual(depot, 'egeorcun/lucida')
        self.assertEqual(options, {'trust_remote_code': True, 'local_files_only': True})   # poids dans l'image, pas de reseau
        self.assertEqual(modele.journal, [('to', 'cuda'), ('float',), ('eval',)])
        self.assertIs(lucida.modele, modele)
        self.assertEqual(lucida.peripherique, 'cuda')

    def test_telechargement_seulement_sur_demande_explicite(self):
        for valeur, local in (('1', False), ('0', True), ('', True), ('true', True), ('oui', True)):
            with self.subTest(FABMESH_LUCIDA_TELECHARGER=valeur):
                mod = charger_module()
                os.environ['FABMESH_LUCIDA_TELECHARGER'] = valeur
                self.avec_cuda()
                with contextlib.redirect_stdout(io.StringIO()):
                    mod._charger_lucida()
                self.assertEqual(self.transformers.appels[0][1]['local_files_only'], local)
        os.environ.pop('FABMESH_LUCIDA_TELECHARGER')
        mod = charger_module()
        self.avec_cuda()
        with contextlib.redirect_stdout(io.StringIO()):
            mod._charger_lucida()
        self.assertTrue(self.transformers.appels[0][1]['local_files_only'])          # le defaut : local

    def test_revision_epinglee_si_demandee(self):
        self.avec_cuda()
        with contextlib.redirect_stdout(io.StringIO()):
            self.mod._charger_lucida()
        self.assertNotIn('revision', self.transformers.appels[0][1])
        mod = charger_module()
        os.environ['FABMESH_LUCIDA_REVISION'] = 'abc123'
        self.avec_cuda()
        with contextlib.redirect_stdout(io.StringIO()):
            mod._charger_lucida()
        self.assertEqual(self.transformers.appels[0][1]['revision'], 'abc123')

    def test_echec_de_from_pretrained_memorise(self):
        self.avec_cuda(erreur=OSError("We couldn't connect to the Hub"))
        img = self.image()
        sortie = io.StringIO()
        with contextlib.redirect_stdout(sortie):
            for _ in range(4):
                self.assertIsNone(self.mod.masque_lucida(img))
        self.assertEqual(len(self.transformers.appels), 1)
        self.assertEqual(sortie.getvalue().count('Lucida indisponible'), 1)

    def test_echec_du_deplacement_sur_la_carte_memorise(self):
        class ModeleSansMemoire(FauxModele):
            def to(self, peripherique):
                raise RuntimeError("CUDA out of memory")
        self.avec_cuda(ModeleSansMemoire())
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertIsNone(self.mod._charger_lucida())
            self.assertIsNone(self.mod._charger_lucida())
        self.assertEqual(len(self.transformers.appels), 1)

    def test_kornia_present_les_substituts_ne_sont_pas_installes(self):
        appels = []
        shims = types.ModuleType('modal_app.lucida_shims')
        shims.installer = lambda log=None: appels.append(log)
        sys.modules['kornia'] = types.ModuleType('kornia')
        sys.modules['modal_app.lucida_shims'] = shims
        self.avec_cuda()
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertIsNotNone(self.mod._charger_lucida())
        self.assertEqual(appels, [])

    def test_kornia_absent_substituts_installes_avant_le_chargement(self):
        ordre = []
        shims = types.ModuleType('modal_app.lucida_shims')
        shims.installer = lambda log=None: ordre.append(('installer', callable(log)))
        sys.modules['modal_app.lucida_shims'] = shims                  # kornia reste bloque (absent) : voir le setUp
        self.avec_cuda()
        original = self.transformers.AutoModelForImageSegmentation.from_pretrained
        self.transformers.AutoModelForImageSegmentation.from_pretrained = staticmethod(
            lambda depot, **options: (ordre.append(('from_pretrained',)), original(depot, **options))[1])
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertIsNotNone(self.mod._charger_lucida())
        self.assertEqual(ordre, [('installer', True), ('from_pretrained',)])

    def test_kornia_et_substituts_absents_on_charge_quand_meme(self):
        # transformers refusera peut-etre (« requires kornia ») : ce n'est pas au chargeur d'inventer, il essaie et memorise
        self.avec_cuda()
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertIsNotNone(self.mod._charger_lucida())
        self.assertEqual(len(self.transformers.appels), 1)

    def test_substituts_qui_plantent_lucida_indisponible(self):
        shims = types.ModuleType('modal_app.lucida_shims')

        def installer(log=None):
            raise RuntimeError("substituts casses")
        shims.installer = installer
        sys.modules['modal_app.lucida_shims'] = shims
        self.avec_cuda()
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertIsNone(self.mod._charger_lucida())
        self.assertEqual(self.transformers.appels, [])


# ---------------------------------------------------------------------------------------------------------------------
# 5 bis. LE MODULE RESTE LEGER : aucun import lourd tant qu'on ne demande pas Lucida
# ---------------------------------------------------------------------------------------------------------------------
class _EspionImports(object):
    """Finder d'imports : note qui demande l'un des paquets `noms` et REFUSE (ModuleNotFoundError), sans jamais importer le vrai."""

    def __init__(self, noms):
        self.noms = noms
        self.vus = []

    def find_spec(self, nom, chemin=None, cible=None):
        if nom.split('.')[0] in self.noms:
            self.vus.append(nom)
            raise ModuleNotFoundError('No module named %r' % nom, name=nom)
        return None


@contextlib.contextmanager
def imports_espionnes(*noms):
    """Retire `noms` de sys.modules, espionne les imports qui les demandent ; tout est restaure a la sortie."""
    avant = {k: v for k, v in sys.modules.items() if k.split('.')[0] in noms}
    for k in avant:
        del sys.modules[k]
    espion = _EspionImports(noms)
    sys.meta_path.insert(0, espion)
    try:
        yield espion
    finally:
        sys.meta_path.remove(espion)
        for k in [k for k in sys.modules if k.split('.')[0] in noms]:
            del sys.modules[k]
        sys.modules.update(avant)


class ImportLeger(unittest.TestCase):

    def test_chargement_par_chemin_sans_la_racine_du_depot(self):
        # les bancs (fid_lib...) chargent _detourage.py par chemin, sans la racine du depot dans sys.path
        voisin = os.path.join(os.path.dirname(CHEMIN), 'fusion_masques.py')
        with tempfile.TemporaryDirectory() as d:
            import shutil
            copie = os.path.join(d, '_detourage.py')
            shutil.copy(CHEMIN, copie)
            shutil.copy(voisin if os.path.exists(voisin) else os.path.join(RACINE, 'modal_app', 'fusion_masques.py'),
                        os.path.join(d, 'fusion_masques.py'))
            code = ('import sys, importlib.util; sys.path[:] = [p for p in sys.path if p not in ("", %r)]; '
                    'spec = importlib.util.spec_from_file_location("detourage_banc", %r); '
                    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); '
                    'print("OK", callable(m.masque), callable(m.detourer))') % (RACINE, copie)
            r = subprocess.run([sys.executable, '-c', code], capture_output=True, text=True,
                               errors='replace', timeout=120, cwd=tempfile.gettempdir())
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('OK True True', r.stdout)

    def test_importer_le_module_ne_charge_ni_torch_ni_transformers(self):
        # processus NEUF : les conteneurs CPU et le mode u2net n'ont pas a payer l'import de torch (plusieurs secondes)
        code = ("import sys, importlib.util; sys.path.insert(0, %r); "
                "spec = importlib.util.spec_from_file_location('detourage_neuf', %r); "
                "m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); "
                "lourds = sorted(k for k in ('torch', 'torchvision', 'transformers', 'timm', 'kornia', 'onnxruntime', 'rembg', 'cv2') "
                "if k in sys.modules); print('LOURDS=' + ','.join(lourds))") % (RACINE, CHEMIN)
        r = subprocess.run([sys.executable, '-c', code], capture_output=True, text=True, errors='replace', timeout=120)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('LOURDS=', r.stdout)
        self.assertEqual(r.stdout.split('LOURDS=')[1].strip(), '', 'import lourd au chargement du module : ' + r.stdout)

    def test_controle_positif_l_union_demande_torch(self):
        # sans ce controle, l'espion pourrait ne rien voir par defaut : en mode union, detourer demande torch (y a-t-il une carte ?)
        noms = ('torch', 'torchvision', 'transformers', 'kornia')
        with tempfile.TemporaryDirectory() as dossier, mock.patch.dict(os.environ):
            for cle in [c for c in os.environ if c.startswith('FABMESH_')]:
                del os.environ[cle]
            poids = os.path.join(dossier, 'u2net.onnx')
            with open(poids, 'wb') as f:
                f.write(b'x')
            mod = charger_module()
            mod.POIDS_U2NET = poids
            mod._session = lambda: FausseSession(carte_u2net([(0.35, 0.10, 0.65, 0.95)]))
            with imports_espionnes(*noms) as espion, contextlib.redirect_stdout(io.StringIO()):
                res = mod.detourer(Image.new('RGB', (20, 30)))
            self.assertIn('torch', espion.vus)
            self.assertEqual((res.mode, res.size), ('RGBA', (20, 30)))     # torch refuse : repli u2net, aucune exception

    def test_mode_u2net_aucune_demande_de_paquet_lourd(self):
        noms = ('torch', 'torchvision', 'transformers', 'kornia')
        with tempfile.TemporaryDirectory() as dossier, mock.patch.dict(os.environ):
            for cle in [c for c in os.environ if c.startswith('FABMESH_')]:
                del os.environ[cle]
            poids = os.path.join(dossier, 'u2net.onnx')
            with open(poids, 'wb') as f:
                f.write(b'x')
            mod = charger_module()
            mod.POIDS_U2NET = poids
            mod._session = lambda: FausseSession(carte_u2net([(0.35, 0.10, 0.65, 0.95)]))
            os.environ['FABMESH_DETOURAGE'] = 'u2net'
            with imports_espionnes(*noms) as espion:
                mod.detourer(Image.new('RGB', (20, 30)))
                self.assertFalse(mod.precharger())               # mode u2net : precharger ne charge rien
            self.assertEqual(espion.vus, [])


# ---------------------------------------------------------------------------------------------------------------------
# 6. TAILLES EXTREMES
# ---------------------------------------------------------------------------------------------------------------------
class Tailles(Base):

    def test_images_minuscules_dans_les_trois_modes(self):
        for taille in ((1, 1), (3, 7), (7, 3), (1, 9), (9, 1), (2, 2)):
            self.poser_lucida(fabrique_alpha([(0.0, 0.0, 1.0, 1.0)]))
            for mode in (None, 'u2net', 'lucida'):
                with self.subTest(taille=taille, mode=mode):
                    if mode is None:
                        os.environ.pop('FABMESH_DETOURAGE', None)
                    else:
                        os.environ['FABMESH_DETOURAGE'] = mode
                    img = self.image(taille)
                    res = self.detourer(img)
                    self.assertEqual((res.mode, res.size), ('RGBA', taille))

    def test_union_sur_image_minuscule_vaut_l_oracle(self):
        for taille in ((1, 1), (3, 7), (7, 3)):
            with self.subTest(taille=taille):
                w, h = taille
                a_lu = np.full((h, w), 90, np.uint8)
                self.poser_lucida(lambda t, a=a_lu: a)
                img = self.image(taille)
                a_u2 = np.asarray(masque_ancien(img, self.session))
                self.memes_pixels(self.detourer(img), decouper(img, alpha_attendu(a_u2, a_lu)))

    def test_grande_image_2048(self):
        w = h = 2048
        a_lu = np.zeros((h, w), np.uint8)
        a_lu[300:900, 200:700] = 255
        self.poser_lucida(lambda t: a_lu)
        img = Image.fromarray(np.random.default_rng(1).integers(0, 256, (h, w, 3), dtype=np.uint8))
        debut = time.time()
        res = self.detourer(img)
        self.assertLess(time.time() - debut, 120)
        self.assertEqual((res.mode, res.size), ('RGBA', (w, h)))
        alpha = np.asarray(res)[..., 3]
        self.assertEqual(int(alpha[600, 450]), 255)                        # dans le rectangle de Lucida (hors du corps de u2net)
        self.assertEqual(int(alpha[1000, 1000]), 255)                      # dans le corps de u2net (0,35..0,65 de la largeur)
        self.assertEqual(int(alpha[1000:1100, 50:150].max()), 0)           # hors des deux masques
        self.assertIsNotNone(RE_UNION.match(self.journal))


# ---------------------------------------------------------------------------------------------------------------------
# 7. OPTIONNEL : l'enveloppe _ModeleLucida avec le VRAI torch (processeur, tout petit modele, aucun poids, aucun GPU)
# ---------------------------------------------------------------------------------------------------------------------
@unittest.skipUnless(os.environ.get('DETOURAGE_TEST_TORCH') == '1',
                     "test torch reel (processeur) : DETOURAGE_TEST_TORCH=1, via bash /c/tmp/lourd.sh")
class EnveloppeAvecTorchReel(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        import torch
        import torchvision  # noqa: F401
        cls.torch = torch

    def setUp(self):
        self.mod = charger_module()
        torch = self.torch

        class Mini(torch.nn.Module):
            def forward(self, x):
                rouge = x[:, :1] * 0.229 + 0.485                 # rouge denormalise, dans [0, 1]
                logits = (rouge - 0.5) * 40.0                    # rouge -> sujet, noir -> fond
                return [torch.zeros_like(logits), logits]        # la derniere sortie est la bonne, comme Lucida

        self.enveloppe = self.mod._ModeleLucida(Mini().eval(), torch, 'cpu')

    def test_orientation_forme_et_valeurs(self):
        for (w, h) in ((40, 20), (20, 40), (64, 64), (300, 170)):
            with self.subTest(taille=(w, h)):
                a = np.zeros((h, w, 3), np.uint8)
                a[:, :w // 2, 0] = 255                           # moitie gauche rouge
                alpha = self.enveloppe.alpha(Image.fromarray(a))
                self.assertEqual((alpha.dtype, alpha.shape), (np.uint8, (h, w)))
                self.assertGreater(int(alpha[h // 2, max(2, w // 8)]), 250)
                self.assertLess(int(alpha[h // 2, w - max(3, w // 8)]), 5)

    def test_images_minuscules(self):
        for (w, h) in ((1, 1), (3, 7), (7, 3)):
            with self.subTest(taille=(w, h)):
                rouge = Image.new('RGB', (w, h), (255, 0, 0))
                alpha = self.enveloppe.alpha(rouge)
                self.assertEqual((alpha.dtype, alpha.shape), (np.uint8, (h, w)))
                self.assertTrue((alpha > 250).all())
                noir = self.enveloppe.alpha(Image.new('RGB', (w, h), (0, 0, 0)))
                self.assertTrue((noir < 5).all())

    def test_masque_lucida_de_bout_en_bout_avec_le_vrai_torch(self):
        # masque_lucida complet (verrou, validation, image L) sur l'enveloppe reelle, sans passer par from_pretrained
        self.mod._charger_lucida = lambda: self.enveloppe
        a = np.zeros((20, 40, 3), np.uint8)
        a[:, :20, 0] = 255
        m = self.mod.masque_lucida(Image.fromarray(a))
        self.assertEqual((m.mode, m.size), ('L', (40, 20)))
        self.assertGreater(m.getpixel((3, 10)), 250)
        self.assertLess(m.getpixel((36, 10)), 5)

    def test_vide_le_cache_de_la_carte_apres_chaque_inference(self):
        torch = self.torch
        appels = []
        faux_torch_ = types.SimpleNamespace(no_grad=torch.no_grad, cuda=types.SimpleNamespace(empty_cache=lambda: appels.append(1)))

        class Sortie(object):
            def sigmoid(self):
                return self

            def cpu(self):
                return torch.zeros(1, 1, 64, 64)

        class FauxX(object):
            def unsqueeze(self, n):
                return self

            def to(self, peripherique):
                return self

        def faire(peripherique, modele):
            enveloppe = self.mod._ModeleLucida(modele, faux_torch_, peripherique)
            enveloppe._pretraitement = lambda img: FauxX()
            appels.clear()
            return enveloppe.alpha(Image.new('RGB', (30, 20)))

        a = faire('cuda', lambda x: [None, Sortie()])
        self.assertEqual((a.dtype, a.shape), (np.uint8, (20, 30)))
        self.assertEqual(len(appels), 1)                          # carte : cache rendu
        faire('cpu', lambda x: [None, Sortie()])
        self.assertEqual(len(appels), 0)                          # processeur : rien a vider

        def modele_qui_leve(x):
            raise RuntimeError("CUDA out of memory")
        with self.assertRaises(RuntimeError):
            faire('cuda', modele_qui_leve)
        self.assertEqual(len(appels), 1)                          # meme en cas d'erreur d'inference

        def vidage_qui_leve():
            raise RuntimeError("driver")
        faux_torch_.cuda.empty_cache = vidage_qui_leve
        a = faire('cuda', lambda x: [None, Sortie()])             # un vidage qui echoue ne casse pas le masque
        self.assertEqual(a.shape, (20, 30))

    def test_sans_carte_le_vrai_torch_refuse_de_charger(self):
        # le vrai torch, mais is_available() force a False : la porte « pas de CUDA » se ferme avant tout chargement
        with mock.patch.object(self.torch.cuda, 'is_available', return_value=False):
            with self.assertRaises(RuntimeError) as c:
                self.mod._construire_lucida()
        self.assertIn('CUDA', str(c.exception))


if __name__ == '__main__':
    unittest.main()
