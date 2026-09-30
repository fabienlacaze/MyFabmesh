# -*- coding: utf-8 -*-
"""Tests du cloisonnement memoire des generations locales (2026-09-30).

    python build/test_cloisonnement_memoire.py

CPU SEULEMENT, petites allocations (le PC de l'exploitant tourne pendant les
tests ; aucune carte graphique n'est sollicitee) :
  1. calculs purs : budgets, plafond d'engagement, fraction VRAM, arrondis,
     reconnaissance des erreurs de memoire ;
  2. un processus plafonne a 1 Go qui demande 2 Go leve MemoryError et le
     SIGNALE proprement (marqueur + phrase), sans pousser le PC dans le fichier
     d'echange — lance directement, puis depuis Node (le Job Object s'imbrique
     dans celui de libuv, comme sous Electron) ;
  3. meme chose avec l'allocateur CPU de PyTorch (si torch est installe) ;
  4. le mandataire paresseux de TRELLIS-2 sur un petit modele CPU et la pose
     du correctif sur un faux paquet trellis2 (si torch et safetensors sont la).
"""
import gc
import json
import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest
import weakref

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(RACINE, 'scripts')
sys.path.insert(0, SCRIPTS)

import cloisonnement_memoire as cm  # noqa: E402

try:
    import torch  # noqa: F401
    import safetensors  # noqa: F401
    AVEC_TORCH = True
except Exception:
    AVEC_TORCH = False

WINDOWS = sys.platform == 'win32'


def _marqueur(sortie, nom):
    for ligne in sortie.splitlines():
        if ligne.startswith(nom + ' '):
            return json.loads(ligne[len(nom) + 1:])
    return None


class CalculsPurs(unittest.TestCase):
    def test_limites(self):
        self.assertIsNone(cm.limite_ram_mo({}, 32000))
        self.assertIsNone(cm.limite_ram_mo({'FABMESH_RAM_LIMIT_MB': 'abc'}, 32000))
        self.assertEqual(cm.limite_ram_mo({'FABMESH_RAM_LIMIT_MB': '27645'}, 32600), 27645)
        self.assertEqual(cm.limite_ram_mo({'FABMESH_RAM_LIMIT_MB': '99999'}, 32600), 32600)
        self.assertAlmostEqual(cm.limite_vram_mo({}, 16000), 15200)
        self.assertAlmostEqual(cm.limite_vram_mo({'FABMESH_VRAM_FRACTION': '0.90'}, 16000), 14400)
        self.assertAlmostEqual(cm.limite_vram_mo({'FABMESH_VRAM_FRACTION': '7'}, 16000), 15200)

    def test_budget_ram_incident_du_30_09(self):
        # Chiffres du journal de l'incident : limite 27 645 Mo, 14,2 Go utilises avant le travail.
        b = cm.budget_ram_mo(27645, 14.2 * 1024, 0)
        self.assertAlmostEqual(b, 27645 - 14540.8, places=1)
        # La part residente du processus lui-meme n'est pas comptee dans « les autres ».
        self.assertAlmostEqual(cm.budget_ram_mo(27645, 20000, 5000), 27645 - 15000)
        self.assertEqual(cm.budget_ram_mo(10000, 20000, 0), 0.0)

    def test_plafond_engagement(self):
        self.assertEqual(cm.plafond_engagement_mo(8000, 1500, 3000), 9500)
        # jamais sous l'engagement + marge : l'erreur doit pouvoir s'ecrire
        self.assertEqual(cm.plafond_engagement_mo(1000, 0, 3000), 3000 + cm.MARGE_MIN_MO)
        self.assertEqual(cm.plafond_engagement_mo(1000, -50, 0), 1000)

    def test_vram(self):
        self.assertEqual(cm.budget_vram_mo(14672, 5000), 9672)
        self.assertEqual(cm.budget_vram_mo(14672, 16000), 0.0)
        self.assertAlmostEqual(cm.fraction_vram(9672, 472, 16303), 9200 / 16303)
        self.assertEqual(cm.fraction_vram(400, 600, 16303), 0.0)      # contexte > budget : rien pour PyTorch
        self.assertIsNone(cm.fraction_vram(1000, 0, 0))
        self.assertEqual(cm.fraction_vram(20000, 0, 16000), 1.0)

    def test_arrondis_et_phrase(self):
        self.assertEqual(cm.en_go(1024), 1.0)
        self.assertEqual(cm.en_go(1025), 1.1)          # besoin : arrondi vers le haut
        self.assertEqual(cm.en_go_bas(2047), 1.9)      # disponible : arrondi vers le bas
        p = cm.phrase_manque('ram', 12.4, 8.1)
        self.assertTrue(p.startswith('This generation needs about 12.4 GB of RAM but only 8.1 GB are available under your limit'))
        self.assertIn('VRAM', cm.phrase_manque('vram', 3.0, 2.0))
        p.encode('ascii')   # sortie d'un sous-processus Windows : ASCII obligatoire

    def test_reconnaissance_des_erreurs(self):
        self.assertEqual(cm.type_manque(MemoryError()), 'ram')
        cpu = RuntimeError('[enforce fail at alloc_cpu.cpp:116] data. DefaultCPUAllocator: not enough memory: '
                           'you tried to allocate 2147483648 bytes.')
        self.assertEqual(cm.type_manque(cpu), 'ram')
        self.assertEqual(cm.demande_mo(str(cpu)), 2048)
        np_err = MemoryError('Unable to allocate 2.00 GiB for an array with shape (2147483648,) and data type uint8')
        self.assertEqual(cm.demande_mo(str(np_err)), 2048)

        class OutOfMemoryError(RuntimeError):
            pass
        gpu = OutOfMemoryError('CUDA out of memory. Tried to allocate 1.50 GiB. GPU 0 has a total capacity of 15.92 GiB')
        self.assertEqual(cm.type_manque(gpu), 'vram')
        self.assertEqual(cm.demande_mo(str(gpu)), 1536)
        self.assertEqual(cm.type_manque(RuntimeError('CUDA error: out of memory')), 'vram')
        self.assertIsNone(cm.type_manque(ValueError('shape mismatch')))
        self.assertIsNone(cm.type_manque(None))
        # diagnostic complet : la phrase annonce au moins la demande refusee, et plus que le disponible
        d = cm.diagnostiquer(gpu)
        self.assertEqual(d['type'], 'vram')
        self.assertGreaterEqual(d['besoin_mo'], 1536)
        self.assertGreater(d['besoin_mo'], d['dispo_mo'])
        self.assertIn('GB of VRAM', d['phrase'])
        self.assertIsNone(cm.diagnostiquer(ValueError('shape mismatch')))
        self.assertEqual(cm.texte_erreur(ValueError('shape mismatch')), 'shape mismatch')


ENFANT_RAM = textwrap.dedent(r'''
    import sys
    sys.path.insert(0, sys.argv[1])
    import cloisonnement_memoire as cm
    cm.appliquer('test', cle='test_ram', budget_ram_fixe_mo=1024)
    cm.regime()
    garde = bytearray(256 * cm.MO)        # tient sous le plafond
    print('ALLOC_256_OK', flush=True)
    trop = bytearray(2048 * cm.MO)        # doit etre REFUSEE par Windows
    print('INATTENDU : 2 Go alloues', flush=True)
''')

ENFANT_TORCH = textwrap.dedent(r'''
    import sys
    sys.path.insert(0, sys.argv[1])
    import cloisonnement_memoire as cm
    cm.appliquer('test_torch', cle='test_torch', budget_ram_fixe_mo=1024)
    import torch
    cm.regime()
    a = torch.empty(256 * cm.MO, dtype=torch.uint8)
    a.fill_(1)
    print('ALLOC_256_OK', flush=True)
    b = torch.empty(3 * 1024 * cm.MO, dtype=torch.uint8)
    print('INATTENDU : 3 Go alloues', flush=True)
''')


@unittest.skipUnless(WINDOWS, 'Job Object : Windows seulement')
class PlafondReel(unittest.TestCase):
    def setUp(self):
        self.dossier = tempfile.mkdtemp(prefix='cloisonnement_')
        self.journal = os.path.join(self.dossier, 'journal.jsonl')

    def tearDown(self):
        shutil.rmtree(self.dossier, ignore_errors=True)

    def _lancer(self, source, via_node=False, timeout=180):
        script = os.path.join(self.dossier, 'enfant.py')
        with open(script, 'w', encoding='utf-8') as f:
            f.write(source)
        env = dict(os.environ, FABMESH_MEMOIRE_JOURNAL=self.journal, PYTHONIOENCODING='utf-8')
        env.pop('FABMESH_CLOISONNEMENT', None)
        cmd = [sys.executable, script, SCRIPTS]
        if via_node:
            lanceur = os.path.join(self.dossier, 'lanceur.js')
            with open(lanceur, 'w', encoding='utf-8') as f:
                f.write("const { execFile } = require('child_process');\n"
                        "const [py, ...args] = process.argv.slice(2);\n"
                        "execFile(py, args, { windowsHide: true }, (e, out, err) => {\n"
                        "  process.stdout.write(out); process.stderr.write(err);\n"
                        "  process.exit(e ? (e.code || 1) : 0);\n"
                        "});\n")
            cmd = ['node', lanceur] + cmd
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, env=env)

    def _verifier_refus(self, r, type_attendu='ram'):
        self.assertIn('ALLOC_256_OK', r.stdout, r.stdout + r.stderr)
        self.assertNotIn('INATTENDU', r.stdout)
        self.assertNotEqual(r.returncode, 0)
        for flux in (r.stdout, r.stderr):
            info = _marqueur(flux, cm.MARQUEUR_MANQUE)
            self.assertIsNotNone(info, flux)
            self.assertEqual(info['type'], type_attendu)
            self.assertIn('This generation needs about', flux)
            self.assertIn('are available under your limit', flux)
        plafond = [json.loads(l.split(' ', 1)[1]) for l in r.stdout.splitlines()
                   if l.startswith(cm.MARQUEUR_PLAFOND + ' ')]
        self.assertTrue(any(p['moment'] == 'regime' and p['ram_actif'] for p in plafond), r.stdout)
        return info, [p for p in plafond if p['moment'] == 'regime'][0]

    def test_1_go_demande_2_go_python(self):
        r = self._lancer(ENFANT_RAM)
        info, regime = self._verifier_refus(r)
        self.assertIn('MemoryError', r.stderr)                 # la pile reste dans les journaux
        self.assertEqual(info['dispo_go'], 1.0)
        # MemoryError sans taille : le pic d'engagement de Windows compte les 2 Go refuses
        self.assertGreaterEqual(info['besoin_go'], 2.2)        # 256 Mo gardes + 2 Go demandes
        self.assertLess(regime['ram_plafond_mo'], 1024 + 512)  # plafond ~ budget (+ decalage d'un Python nu)
        with open(self.journal, encoding='utf-8') as f:
            lignes = [json.loads(l) for l in f if l.strip()]
        self.assertEqual(lignes[-1]['cle'], 'test_ram')
        self.assertEqual(lignes[-1]['issue'], 'memoire')

    def test_1_go_demande_2_go_depuis_node(self):
        if shutil.which('node') is None:
            self.skipTest('node absent')
        r = self._lancer(ENFANT_RAM, via_node=True)
        self._verifier_refus(r)

    @unittest.skipUnless(AVEC_TORCH, 'torch absent')
    def test_allocateur_cpu_de_pytorch(self):
        r = self._lancer(ENFANT_TORCH, timeout=300)
        info, regime = self._verifier_refus(r)
        self.assertIn('DefaultCPUAllocator', r.stderr)
        # `import torch` engage ~1,5 Go sans les occuper : le decalage mesure les rend au budget.
        self.assertGreater(regime['decalage_mo'], 300)


@unittest.skipUnless(AVEC_TORCH, 'torch / safetensors absents')
class ChargementParesseux(unittest.TestCase):
    def setUp(self):
        import torch
        import torch.nn as nn
        from safetensors.torch import save_file
        import trellis2_chargement_paresseux as tp
        self.torch, self.nn, self.tp = torch, nn, tp
        self.dossier = tempfile.mkdtemp(prefix='paresseux_')

        class Petit(nn.Module):
            constructions = 0

            def __init__(self, in_channels=4, model_channels=8, resolution=3):
                super().__init__()
                Petit.constructions += 1
                self.in_channels, self.resolution, self.low_vram = in_channels, resolution, False
                self.lin = nn.Linear(in_channels, model_channels)
                self.freqs = torch.arange(4, dtype=torch.float32)   # tenseur cree dans __init__
                nn.init.normal_(self.lin.weight)                    # consomme le generateur

            def set_resolution(self, r):
                self.resolution = r

            def forward(self, x):
                return self.lin(x)

        self.Petit = Petit
        self.ref = Petit()
        self.prefixe = os.path.join(self.dossier, 'ckpts', 'petit_modele')
        os.makedirs(os.path.dirname(self.prefixe))
        save_file(self.ref.state_dict(), self.prefixe + '.safetensors')
        with open(self.prefixe + '.json', 'w', encoding='utf-8') as f:
            json.dump({'name': 'Petit', 'args': {'in_channels': 4, 'model_channels': 8, 'resolution': 3}}, f)
        self._classe, self._device = tp._classe, tp.DEVICE_CIBLE
        tp._classe = lambda nom: Petit
        tp.DEVICE_CIBLE = 'cpu'
        tp._residents.clear()

    def tearDown(self):
        self.tp._classe, self.tp.DEVICE_CIBLE = self._classe, self._device
        self.tp._residents.clear()
        shutil.rmtree(self.dossier, ignore_errors=True)

    def test_mandataire(self):
        torch, nn, tp = self.torch, self.nn, self.tp
        self.assertEqual(tp.resoudre_fichiers(self.prefixe), (self.prefixe + '.json', self.prefixe + '.safetensors'))
        p = tp.fabrique(self.prefixe)
        self.assertIsInstance(p, nn.Module)                    # sample_tex_slat : isinstance(flow_model, nn.Module)
        self.assertFalse(p.est_monte)
        avant = self.Petit.constructions
        self.assertEqual((p.in_channels, p.resolution), (4, 3))  # lus sans charger
        self.assertEqual(self.Petit.constructions, avant)
        p.low_vram = True                                      # ecrit pendant qu'il dort : garde
        self.assertTrue(p.low_vram)
        self.assertFalse(p.est_monte)
        p.eval()
        rng = torch.get_rng_state()
        p.cuda()                                               # monte (sur « la carte » = cpu ici)
        self.assertTrue(p.est_monte)
        self.assertTrue(torch.equal(torch.get_rng_state(), rng), 'la construction a consomme le generateur')
        self.assertTrue(p._p_reel.low_vram)
        self.assertFalse(p._p_reel.training)
        self.assertFalse(any(q.requires_grad for q in p.parameters()))
        x = torch.randn(2, 4)
        self.assertTrue(torch.equal(p(x), self.ref(x)), 'poids differents de ceux du fichier')
        reel = weakref.ref(p._p_reel)
        p.cpu()                                                # rendu, pas recopie en RAM
        gc.collect()
        self.assertIsNone(reel())
        self.assertFalse(p.est_monte)
        p.set_resolution(5)                                    # methode : charge le modele
        self.assertTrue(p.est_monte)
        self.assertEqual(p.resolution, 5)
        p.to('cpu')
        self.assertEqual(p.resolution, 3)                      # rendu : valeur de configuration
        self.assertTrue(torch.equal(p(x), self.ref(x)))        # un appel recharge

    def test_repli_sur_le_chargement_classique(self):
        torch, tp = self.torch, self.tp

        class Casse(self.nn.Module):
            def __init__(self, **k):
                raise RuntimeError('CUDA out of memory. Tried to allocate 5.00 GiB')

        amont = []
        tp._classe = lambda nom: Casse
        tp._fabrique_amont = lambda chemin: amont.append(chemin) or self.Petit()
        try:
            p = tp.fabrique(self.prefixe)
            p.cuda()
            self.assertTrue(p.est_monte)
            self.assertEqual(amont, [self.prefixe])            # le chargement d'origine a pris le relais
            self.assertFalse(any(q.requires_grad for q in p.parameters()))
        finally:
            tp._fabrique_amont = None

    def test_extracteur_rendu_au_modele_suivant(self):
        torch, nn, tp = self.torch, self.nn, self.tp

        class FauxExtracteur:
            lectures = 0

            def __init__(self, model_name, image_size=512):
                FauxExtracteur.lectures += 1
                self.model_name, self.image_size = model_name, image_size
                self.model = nn.Linear(2, 2)

            def to(self, device):
                self.model.to(device)

            def cpu(self):
                self.model.cpu()

            def __call__(self, image):
                return self.model(image)

        E = tp.envelopper_extracteur(FauxExtracteur)
        e = E('dino', image_size=512)
        self.assertEqual(FauxExtracteur.lectures, 0)
        e.image_size = 1024
        e.cuda()
        self.assertEqual((FauxExtracteur.lectures, e.image_size), (1, 1024))
        e.cpu()                                                # garde pour le 2e get_cond
        e.image_size = 512
        e.cuda()
        self.assertEqual(FauxExtracteur.lectures, 1)
        e.cpu()
        p = tp.fabrique(self.prefixe)
        p.cuda()                                               # le modele suivant monte : l'extracteur est rendu
        self.assertIsNone(e.model)
        e(torch.randn(1, 2))
        self.assertEqual((FauxExtracteur.lectures, e.image_size), (2, 512))

    def test_pose_sur_un_faux_paquet_trellis2(self):
        tp = self.tp
        faux = os.path.join(self.dossier, 'faux')
        for d in ('trellis2', os.path.join('trellis2', 'models'), os.path.join('trellis2', 'modules')):
            os.makedirs(os.path.join(faux, d), exist_ok=True)
        with open(os.path.join(faux, 'trellis2', '__init__.py'), 'w') as f:
            f.write('')
        with open(os.path.join(faux, 'trellis2', 'models', '__init__.py'), 'w') as f:
            f.write('def from_pretrained(path, **kwargs):\n    return ("amont", path)\n')
        with open(os.path.join(faux, 'trellis2', 'modules', 'image_feature_extractor.py'), 'w') as f:
            f.write('class DinoV3FeatureExtractor:\n    def __init__(self, model_name, image_size=512):\n'
                    '        self.model = "lu"\n')
        sys.path.insert(0, faux)
        garde = {k: v for k, v in sys.modules.items() if k == 'trellis2' or k.startswith('trellis2.')}
        for k in garde:
            del sys.modules[k]
        try:
            os.environ.pop('FABMESH_T2_PARESSEUX', None)
            self.assertTrue(tp.appliquer(log=lambda m: None))
            import trellis2.models as tm
            import trellis2.modules.image_feature_extractor as ife
            self.assertIs(tm.from_pretrained, tp.fabrique)
            self.assertTrue(ife.DinoV3FeatureExtractor._fabmesh_paresseux)
            self.assertIsNone(ife.DinoV3FeatureExtractor('dino').model)   # rien de lu a la construction
            self.assertEqual(tp._fabrique_amont('x'), ('amont', 'x'))
            self.assertTrue(tp.appliquer(log=lambda m: None))             # idempotent
        finally:
            sys.path.remove(faux)
            for k in [k for k in sys.modules if k == 'trellis2' or k.startswith('trellis2.')]:
                del sys.modules[k]
            sys.modules.update(garde)
            tp._fabrique_amont = None


ENFANT_TRELLIS2_REEL = textwrap.dedent(r'''
    import os, sys, types
    sys.dont_write_bytecode = True            # rien d'ecrit dans l'arbre TRELLIS-2 vendu
    os.environ.setdefault('HF_HUB_OFFLINE', '1')
    os.environ['SPARSE_ATTN_BACKEND'] = 'sdpa'
    os.environ['ATTN_BACKEND'] = 'sdpa'
    sys.path.insert(0, sys.argv[2])           # .../TRELLIS2_win/src
    sys.path.insert(0, sys.argv[1])           # scripts/
    # Extensions CUDA absentes d'un Python de test : des coquilles suffisent pour IMPORTER
    # les modules (rien ne s'execute sur la carte).
    def coquille(nom):
        m = types.ModuleType(nom); m.__path__ = []; m.__file__ = '<coquille>'
        def attr(a):
            if a.startswith('__'):
                raise AttributeError(a)
            return type(a, (), {'__init__': lambda s, *x, **k: None, '__call__': lambda s, *x, **k: None})
        m.__getattr__ = attr
        return m
    for nom in ('flex_gemm', 'flex_gemm.ops', 'flex_gemm.ops.spconv', 'flex_gemm.ops.grid_sample',
                'flex_gemm.ops.serialize', 'o_voxel', 'o_voxel.convert', 'o_voxel.postprocess',
                'o_voxel.io', 'cumesh', 'kaolin', 'nvdiffrast', 'nvdiffrast.torch', 'utils3d', 'utils3d.torch'):
        try:
            __import__(nom)
        except Exception:
            sys.modules[nom] = coquille(nom)
    import torch
    import cloisonnement_memoire as cm
    import trellis2_chargement_paresseux as tp
    try:
        from trellis2.pipelines import Trellis2ImageTo3DPipeline
        import trellis2_sans_detourage; trellis2_sans_detourage.appliquer()
        tp.appliquer(log=lambda m: None)
        avant = cm.memoire_processus()['engage_mo']
        pipe = Trellis2ImageTo3DPipeline.from_pretrained('microsoft/TRELLIS.2-4B')
    except Exception as e:
        print('PREREQUIS_ABSENTS', type(e).__name__, str(e)[:300]); sys.exit(3)
    print('ENGAGE_FROM_PRETRAINED', round(cm.memoire_processus()['engage_mo'] - avant))
    assert all(isinstance(m, tp.ModeleParesseux) and not m.est_monte for m in pipe.models.values())
    assert pipe.image_cond_model.model is None
    from safetensors import safe_open
    for k, m in pipe.models.items():
        with torch.device('meta'):
            modele = tp._classe(m._p_classe)(**m._p_args)
        attendues = set(modele.state_dict().keys())
        with safe_open(m._p_poids, framework='pt') as f:
            fichier = set(f.keys())
        print('CLES', k, sorted(attendues - fichier), sorted(fichier - attendues))
    tp.DEVICE_CIBLE = 'cpu'
    d = pipe.models['sparse_structure_decoder']
    rng = torch.get_rng_state()
    d.to(torch.device('cuda'))
    assert d.est_monte and torch.equal(rng, torch.get_rng_state())
    assert not any(p.requires_grad for p in d.parameters())
    d.cpu()
    assert not d.est_monte
    print('OK_REEL')
''')


class ChargementParesseuxSurLeVraiTrellis2(unittest.TestCase):
    """Le vrai code TRELLIS-2 et les vrais fichiers du cache Hugging Face, sur CPU :
    from_pretrained ne lit AUCUN poids, les cles de chaque modele correspondent a son
    fichier, et un petit modele (decodeur de structure, 148 Mo) se monte puis se rend.
    Saute si l'arbre TRELLIS-2 (FABMESH_TRELLIS2_SRC ou external/TRELLIS2_win/src) ou
    le cache sont absents."""

    @unittest.skipUnless(AVEC_TORCH, 'torch / safetensors absents')
    def test_vrai_pipeline(self):
        src = os.environ.get('FABMESH_TRELLIS2_SRC') or os.path.join(RACINE, 'external', 'TRELLIS2_win', 'src')
        if not os.path.isdir(os.path.join(src, 'trellis2')):
            self.skipTest(f'arbre TRELLIS-2 absent : {src}')
        dossier = tempfile.mkdtemp(prefix='t2reel_')
        try:
            script = os.path.join(dossier, 'enfant.py')
            with open(script, 'w', encoding='utf-8') as f:
                f.write(ENFANT_TRELLIS2_REEL)
            r = subprocess.run([sys.executable, script, SCRIPTS, src], capture_output=True, text=True,
                               timeout=600, env=dict(os.environ, PYTHONIOENCODING='utf-8'))
        finally:
            shutil.rmtree(dossier, ignore_errors=True)
        if r.returncode == 3:
            self.skipTest(r.stdout.strip()[-300:])
        self.assertEqual(r.returncode, 0, r.stdout[-2000:] + r.stderr[-3000:])
        self.assertIn('OK_REEL', r.stdout)
        engage = int(r.stdout.split('ENGAGE_FROM_PRETRAINED ')[1].split()[0])
        self.assertLess(engage, 200, 'from_pretrained a lu des poids')   # ~16 Go sans le mode paresseux
        for ligne in r.stdout.splitlines():
            if ligne.startswith('CLES '):
                _, nom, reste = ligne.split(' ', 2)
                absentes, en_trop = reste.split('] [')
                # seul tampon non enregistre : rope_phases (calcule, pas tire au hasard)
                self.assertIn(absentes.strip('[]'), ('', "'rope_phases'"), ligne)
                self.assertEqual(en_trop.strip('[]'), '', ligne)


if __name__ == '__main__':
    unittest.main(verbosity=2)
