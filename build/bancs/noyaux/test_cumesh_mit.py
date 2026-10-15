"""CuMesh recompile avec le BVH MIT de cubvh + correctif de fill_holes (PR #41) dans l'image Modal du maillage (2026-10-14).

DEFAUTS (verifies a la source le 14/10, voir AGENT_LOG et modal_app/construction_cumesh.py) :
  - licence : le cubvh compile par CuMesh (JeffreyXiang/cubvh ce92267) contient le BVH d'instant-ngp (NVIDIA Source Code
    License, « research or evaluation purposes only ») ; ashawkey/cubvh l'a reecrit sous MIT (c7379c0, 26/08/2026) ;
  - fill_holes : valeur initiale de la somme des sommets de bouchage construite cote hote par un constructeur __device__
    seulement (PR #41 de CuMesh, non fusionnee).

CE QUE VERIFIE CE TEST (CPU seulement : aucun GPU, aucun reseau, aucune installation) :
  1. modal_app/app.py : _CUMESH_MIT epingle CuMesh 12289e1 et ashawkey/cubvh de1badf (les memes constantes que
     construction_cumesh.py), lance la garde des sources (avec le correctif) AVANT pip install, la garde du paquet
     installe APRES, puis efface toutes les sources de CuMesh ; mesh_image copie construction_cumesh.py (copy=True) puis
     execute _CUMESH_MIT APRES les telechargements de poids et juste avant add_local_python_source ; la couche
     d'origine qui clonait CuMesh est inchangee (rien de lourd n'est reconstruit) ;
  2. le correctif de fill_holes rend EXACTEMENT le texte de la PR #41 (6 lignes, QEM intact), garde les fins de ligne a
     l'octet, est idempotent, et refuse un texte inattendu SANS toucher au fichier ;
  3. la garde des sources refuse LICENSE_NVIDIA, le texte de la licence NVIDIA, le code d'instant-ngp
     (TriangleBvhWithBranchingFactor, DistAndIdx) et une licence non MIT ; ignore third_party/ (Eigen) ; exige un
     depot git hors --sans-git ; la commande `sources` ne corrige PAS dtypes.cuh quand la garde refuse ;
  4. la garde des binaires refuse l'ancien BVH (nom RTTI, ancien noyau mangle) et un binaire sans le marqueur de la
     reecriture ; `installation` (sous-processus, faux paquet) verifie le binaire AVANT tout import, puis l'origine
     (direct_url.json) et un BVH construit sur le CPU (boite racine exacte) ;
  5. fonctions de calcul du banc GPU (modal_app/test_cumesh_fill_holes.py) : sphere fermee, trous connus, oracle du
     bouchage (juste sur un bouchage exact, detecte (G + somme) / n et les sommets non finis), verdict ;
  6. donnees REELLES quand elles sont presentes (sinon tests sautes) : CUMESH_ROUE_BUREAU (roue livree au bureau) et
     CUMESH_SITE_BUREAU (site-packages du Python de l'appli) -> REFUSES ; CUMESH_DTYPES (src/dtypes.cuh de CuMesh
     12289e1) -> 6 lignes corrigees ; CUBVH_ANCIEN (clone a ce92267) -> refuse, CUBVH_NOUVEAU (clone a de1badf) -> accepte.

Lancer :  python build/bancs/noyaux/test_cumesh_mit.py -v
Preuve d'echec sur l'ancien code : NOYAU_APP=<copie de l'ancien modal_app/app.py> (git show 0dc18f33:modal_app/app.py) ;
NOYAU_CONSTRUCTION=<copie modifiee de construction_cumesh.py> pour rejouer une mutation.
"""
import ast
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile

RACINE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
APP = os.environ.get('NOYAU_APP') or os.path.join(RACINE, 'modal_app', 'app.py')
CONSTRUCTION = os.environ.get('NOYAU_CONSTRUCTION') or os.path.join(RACINE, 'modal_app', 'construction_cumesh.py')
BANC = os.path.join(RACINE, 'modal_app', 'test_cumesh_fill_holes.py')


def charger(nom, chemin):
    spec = importlib.util.spec_from_file_location(nom, chemin)
    m = importlib.util.module_from_spec(spec)
    sys.modules[nom] = m
    spec.loader.exec_module(m)
    return m


C = charger('construction_cumesh_sous_test', CONSTRUCTION)
os.environ['FABMESH_BANC_SANS_MODAL'] = '1'
try:
    import numpy as np
    B = charger('banc_fill_holes_sous_test', BANC)
except ImportError:          # numpy absent : tests du banc sautes
    np = B = None
PAS_DE_TORCH = importlib.util.find_spec('torch') is None

# Extrait de CuMesh src/dtypes.cuh (MIT, Jianfeng Xiang) au commit 12289e1 : les lignes que touche la PR #41 et leur
# contexte (QEM compris, que la PR laisse en __device__).
DTYPES_EXTRAIT = '\n'.join([
    '#pragma once',
    '',
    '#include <cuda.h>',
    '#include <cuda_runtime.h>',
    '',
    '',
    'namespace cumesh {',
    '',
    'struct __align__(16) Vec3f {',
    '    float x, y, z;',
    '',
    '    __device__ __forceinline__ Vec3f();',
    '    __device__ __forceinline__ Vec3f(float x, float y, float z);',
    '    __device__ __forceinline__ Vec3f(float3 v);',
    '    __device__ __forceinline__ Vec3f operator+(const Vec3f& o) const;',
    '    __device__ __forceinline__ Vec3f& operator+=(const Vec3f& o);',
    '};',
    '',
    'struct __align__(16) QEM',
    '{',
    '    float e[10];',
    '',
    '    __device__ __forceinline__ QEM();',
    '    __device__ __forceinline__ QEM operator+(const QEM& o) const;',
    '};',
    '',
    '',
    '__device__ __forceinline__ Vec3f::Vec3f() {',
    '    x = 0.0f;',
    '    y = 0.0f;',
    '    z = 0.0f;',
    '}',
    '',
    '__device__ __forceinline__ Vec3f::Vec3f(float x, float y, float z) {',
    '    this->x = x;',
    '    this->y = y;',
    '    this->z = z;',
    '}',
    '',
    '__device__ __forceinline__ Vec3f::Vec3f(float3 v) {',
    '    x = v.x;',
    '    y = v.y;',
    '    z = v.z;',
    '}',
    '',
    '__device__ __forceinline__ QEM::QEM() {',
    '}',
    '',
    '} // namespace cumesh',
    '',
])
# Le meme extrait apres le diff de la PR #41 (gh api repos/JeffreyXiang/CuMesh/pulls/41/files, 14/10/2026).
DTYPES_ATTENDU = (DTYPES_EXTRAIT
                  .replace('    __device__ __forceinline__ Vec3f();', '    __host__ __device__ __forceinline__ Vec3f();')
                  .replace('    __device__ __forceinline__ Vec3f(float x, float y, float z);',
                           '    __host__ __device__ __forceinline__ Vec3f(float x, float y, float z);')
                  .replace('    __device__ __forceinline__ Vec3f(float3 v);',
                           '    __host__ __device__ __forceinline__ Vec3f(float3 v);')
                  .replace('\n__device__ __forceinline__ Vec3f::Vec3f() {', '\n__host__ __device__ __forceinline__ Vec3f::Vec3f() {')
                  .replace('\n__device__ __forceinline__ Vec3f::Vec3f(float x, float y, float z) {',
                           '\n__host__ __device__ __forceinline__ Vec3f::Vec3f(float x, float y, float z) {')
                  .replace('\n__device__ __forceinline__ Vec3f::Vec3f(float3 v) {',
                           '\n__host__ __device__ __forceinline__ Vec3f::Vec3f(float3 v) {'))

LICENCE_MIT = ('MIT License\n\nCopyright (c) 2022 kiui\n\nPermission is hereby granted, free of charge, to any person '
               'obtaining a copy\nof this software ...\n')


def ecrire(chemin, contenu):
    os.makedirs(os.path.dirname(chemin), exist_ok=True)
    with open(chemin, 'wb') as f:
        f.write(contenu.encode('utf-8') if isinstance(contenu, str) else contenu)


def lire(chemin):
    with open(chemin, 'rb') as f:
        return f.read()


def faux_cubvh(racine, ancien=False):
    """Arbre cubvh minimal : reecriture MIT, ou (ancien=True) BVH d'instant-ngp + LICENSE_NVIDIA."""
    ecrire(os.path.join(racine, 'LICENSE'), LICENCE_MIT)
    ecrire(os.path.join(racine, 'readme.md'), "Credits to Thomas Muller's tiny-cuda-nn and instant-ngp!\n")
    if ancien:
        ecrire(os.path.join(racine, 'LICENSE_NVIDIA'), 'NVIDIA Source Code License for instant neural graphics primitives\n')
        ecrire(os.path.join(racine, 'src', 'bvh.cu'),
               'struct DistAndIdx {};\ntemplate <uint32_t B> class TriangleBvhWithBranchingFactor : public TriangleBvh {};\n')
    else:
        ecrire(os.path.join(racine, 'src', 'bvh.cu'),
               'namespace cubvh {\nclass TriangleBvhImpl : public TriangleBvh {};\n'
               '__global__ void bvh_signed_distance_watertight_kernel();\n}\n')
    ecrire(os.path.join(racine, 'src', 'api_gpu.cu'), '#include <gpu/api_gpu.h>\n')
    ecrire(os.path.join(racine, 'src', 'bindings.cpp'), '#include <torch/extension.h>\n')
    ecrire(os.path.join(racine, 'include', 'gpu', 'gpu_memory.h'),
           ' * Copyright (c) 2020-2022, NVIDIA CORPORATION.  All rights reserved.\n * BSD-3-Clause\n')
    ecrire(os.path.join(racine, 'third_party', 'eigen', 'Eigen', 'Dense'), '// MPL-2.0\n')


def faux_cumesh(racine, ancien=False, fin_de_ligne='\n'):
    faux_cubvh(os.path.join(racine, 'third_party', 'cubvh'), ancien=ancien)
    ecrire(os.path.join(racine, 'src', 'dtypes.cuh'), DTYPES_EXTRAIT.replace('\n', fin_de_ligne))


# Lanceur du CLI avec un dossier `site` PLACE EN TETE de sys.path. PYTHONPATH ne suffit pas : le Python embarque de
# l'appli (fichier python311._pth) ignore PYTHONPATH, et le vrai cumesh installe dans ses site-packages masquait alors le
# faux paquet des tests (4 echecs constates le 15/10 avec ce Python, l'interpreteur voulu pour les bancs des noyaux).
LANCEUR = ('import runpy, sys; sys.path.insert(0, sys.argv[1]); sys.argv = sys.argv[2:]; '
           'runpy.run_path(sys.argv[0], run_name="__main__")')


def executer_cli(args, site=None, cwd=None):
    env = dict(os.environ, PYTHONIOENCODING='utf-8', PYTHONDONTWRITEBYTECODE='1')
    env.pop('PYTHONPATH', None)
    cmd = [sys.executable, CONSTRUCTION, *args] if site is None else \
        [sys.executable, '-c', LANCEUR, site, CONSTRUCTION, *args]
    return subprocess.run(cmd, capture_output=True, encoding='utf-8', errors='replace', env=env,
                          cwd=cwd or tempfile.gettempdir(), timeout=300)


# ---------------------------------------------------------------------------------------------------------
# 1. modal_app/app.py
# ---------------------------------------------------------------------------------------------------------
def arbre_app():
    with open(APP, encoding='utf-8') as f:
        return ast.parse(f.read())


def constante(arbre, nom):
    for noeud in arbre.body:
        if isinstance(noeud, ast.Assign) and any(isinstance(c, ast.Name) and c.id == nom for c in noeud.targets):
            return ast.literal_eval(noeud.value)
    return None


def chaine_mesh_image(arbre):
    """Appels de methode de `mesh_image = (...)` dans l'ordre d'execution : [(nom, ast.Call), ...]."""
    for noeud in arbre.body:
        if isinstance(noeud, ast.Assign) and any(isinstance(c, ast.Name) and c.id == 'mesh_image' for c in noeud.targets):
            appels, n = [], noeud.value
            while isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute):
                appels.append((n.func.attr, n))
                n = n.func.value
            return list(reversed(appels))
    return None


def chaines_de(appel):
    """Chaines des ARGUMENTS d'un appel (pas de appel.func : il contient les appels precedents de la chaine)."""
    return [n.value for arg in list(appel.args) + [k.value for k in appel.keywords] for n in ast.walk(arg)
            if isinstance(n, ast.Constant) and isinstance(n.value, str)]


def etoile_de(appel, nom):
    return any(isinstance(a, ast.Starred) and isinstance(a.value, ast.Name) and a.value.id == nom for a in appel.args)


class TestImageModal(unittest.TestCase):
    """_CUMESH_MIT existe, epingle les bons commits, et sa couche est au bon endroit de mesh_image."""

    @classmethod
    def setUpClass(cls):
        cls.arbre = arbre_app()
        cls.commandes = constante(cls.arbre, '_CUMESH_MIT')
        cls.chaine = chaine_mesh_image(cls.arbre)

    def test_constante_definie(self):
        self.assertIsInstance(self.commandes, tuple, '_CUMESH_MIT absente de modal_app/app.py')
        self.assertGreaterEqual(len(self.commandes), 5)

    def test_sources_epinglees_comme_construction_cumesh(self):
        self.assertIsNotNone(self.commandes)
        clone = self.commandes[0]
        self.assertIn(f'git clone --quiet {C.CUMESH_DEPOT} /tmp/cumesh_mit', clone)
        self.assertIn(f'git -C /tmp/cumesh_mit checkout --quiet {C.CUMESH_COMMIT}', clone)
        self.assertIn('rm -rf /tmp/cumesh_mit/third_party/cubvh', clone)
        self.assertIn(f'git clone --quiet {C.CUBVH_DEPOT} /tmp/cumesh_mit/third_party/cubvh', clone)
        self.assertIn(f'git -C /tmp/cumesh_mit/third_party/cubvh checkout --quiet {C.CUBVH_COMMIT}', clone)
        self.assertIn('submodule update --init --recursive', clone)
        self.assertNotIn('--recursive https://github.com/JeffreyXiang/CuMesh', clone,
                         'le sous-module cubvh de JeffreyXiang (BVH d instant-ngp) ne doit pas etre recupere')
        self.assertLess(clone.index(C.CUBVH_DEPOT), clone.index('submodule update'))

    def test_ordre_garde_installation_garde_nettoyage(self):
        self.assertIsNotNone(self.commandes)
        texte = list(self.commandes)

        def rang(motif):
            r = [i for i, c in enumerate(texte) if motif in c]
            self.assertEqual(len(r), 1, f'{motif!r} attendu dans une seule commande : {r}')
            return r[0]
        sources = rang('python /opt/construction_cumesh.py sources /tmp/cumesh_mit')
        pip = rang('pip install --force-reinstall --no-deps --no-build-isolation /tmp/cumesh_mit')
        installation = rang('python /opt/construction_cumesh.py installation --source /tmp/cumesh_mit')
        menage = rang('rm -rf /tmp/cumesh /tmp/cumesh_mit')
        self.assertLess(0, sources)
        self.assertLess(sources, pip)
        self.assertLess(pip, installation)
        self.assertLess(installation, menage)
        self.assertEqual(menage, len(texte) - 1, 'les sources doivent etre effacees en dernier')

    def test_commandes_transmises_telles_quelles_par_sh(self):
        self.assertIsNotNone(self.commandes)
        for c in self.commandes:
            for car in ('$', '`', '\\', '"', "'", ';', '|'):
                self.assertNotIn(car, c, f'caractere {car!r} interprete par /bin/sh dans {c[:80]!r}')

    def test_couche_ajoutee_en_dernier(self):
        self.assertIsNotNone(self.chaine, 'mesh_image introuvable')
        noms = [n for n, _ in self.chaine]
        self.assertEqual(noms[-1], 'add_local_python_source')
        i_cumesh = [i for i, (n, a) in enumerate(self.chaine) if n == 'run_commands' and etoile_de(a, '_CUMESH_MIT')]
        self.assertEqual(len(i_cumesh), 1, 'mesh_image doit executer run_commands(*_CUMESH_MIT) une fois')
        i = i_cumesh[0]
        precedent_nom, precedent = self.chaine[i - 1]
        self.assertEqual(precedent_nom, 'add_local_file')
        self.assertEqual(chaines_de(precedent)[:2], ['modal_app/construction_cumesh.py', '/opt/construction_cumesh.py'])
        copie = [k for k in precedent.keywords if k.arg == 'copy']
        self.assertTrue(copie and isinstance(copie[0].value, ast.Constant) and copie[0].value.value is True,
                        'add_local_file(..., copy=True) obligatoire avant un run_commands')
        poids = [j for j, (n, a) in enumerate(self.chaine) if any('snapshot_download' in s for s in chaines_de(a))]
        self.assertTrue(poids, 'telechargements de poids introuvables')
        self.assertLess(max(poids), i - 1, 'la couche CuMesh doit suivre les poids (sinon ~25 Go retelecharges)')
        apres = [n for n, _ in self.chaine[i + 1:]]
        self.assertNotIn('pip_install', apres)
        self.assertTrue(all(n in ('run_commands', 'add_local_python_source') for n in apres), apres)

    def test_couche_d_origine_inchangee(self):
        self.assertIsNotNone(self.chaine)
        origine = ('git clone --recursive https://github.com/JeffreyXiang/CuMesh.git /tmp/cumesh '
                   '&& pip install /tmp/cumesh --no-build-isolation --no-deps')
        i_cumesh = [i for i, (n, a) in enumerate(self.chaine) if n == 'run_commands' and etoile_de(a, '_CUMESH_MIT')]
        avant = [j for j, (n, a) in enumerate(self.chaine) if origine in chaines_de(a)]
        self.assertEqual(len(avant), 1, 'commande d origine modifiee : sa couche et les suivantes seraient reconstruites')
        self.assertTrue(i_cumesh and avant[0] < i_cumesh[0])


# ---------------------------------------------------------------------------------------------------------
# 2. correctif de fill_holes (PR #41)
# ---------------------------------------------------------------------------------------------------------
class TestCorrectifFillHoles(unittest.TestCase):

    def setUp(self):
        self.dossier = tempfile.mkdtemp(prefix='cumesh_dtypes_')
        self.chemin = os.path.join(self.dossier, 'dtypes.cuh')

    def tearDown(self):
        shutil.rmtree(self.dossier, ignore_errors=True)

    def test_texte_exact_de_la_pr41(self):
        ecrire(self.chemin, DTYPES_EXTRAIT)
        self.assertEqual(C.corriger_vec3f(self.chemin), 'applique')
        self.assertEqual(lire(self.chemin).decode('utf-8'), DTYPES_ATTENDU)
        avant, apres = DTYPES_EXTRAIT.splitlines(), DTYPES_ATTENDU.splitlines()
        changees = [(a, b) for a, b in zip(avant, apres) if a != b]
        self.assertEqual(len(changees), 6)
        self.assertTrue(all(b == a.replace('__device__', '__host__ __device__', 1) for a, b in changees))

    def test_qem_reste_device(self):
        ecrire(self.chemin, DTYPES_EXTRAIT)
        C.corriger_vec3f(self.chemin)
        texte = lire(self.chemin).decode('utf-8')
        self.assertIn('\n    __device__ __forceinline__ QEM();', texte)
        self.assertIn('\n__device__ __forceinline__ QEM::QEM() {', texte)
        self.assertNotIn('__host__ __device__ __forceinline__ QEM', texte)

    def test_crlf_conserve_a_l_octet(self):
        ecrire(self.chemin, DTYPES_EXTRAIT.replace('\n', '\r\n'))
        self.assertEqual(C.corriger_vec3f(self.chemin), 'applique')
        brut = lire(self.chemin)
        self.assertEqual(brut, DTYPES_ATTENDU.replace('\n', '\r\n').encode('utf-8'))
        self.assertEqual(brut.count(b'\r\n'), DTYPES_EXTRAIT.count('\n'))

    def test_idempotent(self):
        ecrire(self.chemin, DTYPES_EXTRAIT)
        C.corriger_vec3f(self.chemin)
        une_fois = lire(self.chemin)
        self.assertEqual(C.corriger_vec3f(self.chemin), 'deja')
        self.assertEqual(lire(self.chemin), une_fois)

    def test_texte_inattendu_refuse_sans_ecrire(self):
        cas = {
            'constructeur absent': DTYPES_EXTRAIT.replace('    __device__ __forceinline__ Vec3f(float3 v);\n', ''),
            'ligne en double': DTYPES_EXTRAIT.replace('    __device__ __forceinline__ Vec3f();',
                                                      '    __device__ __forceinline__ Vec3f();\n'
                                                      '    __device__ __forceinline__ Vec3f();'),
            'deja a moitie corrige': DTYPES_EXTRAIT.replace('    __device__ __forceinline__ Vec3f();',
                                                            '    __host__ __device__ __forceinline__ Vec3f();'),
            'signature changee': DTYPES_EXTRAIT.replace('Vec3f(float x, float y, float z) {',
                                                        'Vec3f(float x_, float y_, float z_) {'),
        }
        for nom, texte in cas.items():
            with self.subTest(nom):
                ecrire(self.chemin, texte)
                with self.assertRaises(C.RefusConstruction):
                    C.corriger_vec3f(self.chemin)
                self.assertEqual(lire(self.chemin), texte.encode('utf-8'), 'fichier modifie malgre le refus')

    @unittest.skipUnless(os.environ.get('CUMESH_DTYPES') and os.path.isfile(os.environ.get('CUMESH_DTYPES', '')),
                         'CUMESH_DTYPES (src/dtypes.cuh de CuMesh 12289e1) non fourni')
    def test_dtypes_reel_de_cumesh(self):
        shutil.copyfile(os.environ['CUMESH_DTYPES'], self.chemin)
        avant = lire(self.chemin).decode('utf-8').splitlines()
        self.assertEqual(C.corriger_vec3f(self.chemin), 'applique')
        apres = lire(self.chemin).decode('utf-8').splitlines()
        changees = [(a, b) for a, b in zip(avant, apres) if a != b]
        self.assertEqual(len(avant), len(apres))
        self.assertEqual(len(changees), 6)
        self.assertTrue(all(b == a.replace('__device__', '__host__ __device__', 1) for a, b in changees))


# ---------------------------------------------------------------------------------------------------------
# 3. garde des sources de cubvh
# ---------------------------------------------------------------------------------------------------------
class TestGardeSources(unittest.TestCase):

    def setUp(self):
        self.dossier = tempfile.mkdtemp(prefix='cumesh_sources_')

    def tearDown(self):
        shutil.rmtree(self.dossier, ignore_errors=True)

    def arbre(self, ancien=False):
        racine = os.path.join(self.dossier, 'cubvh')
        faux_cubvh(racine, ancien=ancien)
        return racine

    def test_reecriture_acceptee(self):
        resume = C.verifier_sources_cubvh(self.arbre(), exiger_git=False)
        self.assertGreaterEqual(resume['fichiers_lus'], 5)

    def test_ancien_cubvh_refuse(self):
        with self.assertRaises(C.RefusConstruction) as e:
            C.verifier_sources_cubvh(self.arbre(ancien=True), exiger_git=False)
        for motif in ('LICENSE_NVIDIA', 'TriangleBvhWithBranchingFactor', 'DistAndIdx'):
            self.assertIn(motif, str(e.exception))

    def test_chaque_signature_suffit(self):
        cas = {
            'LICENSE_NVIDIA seul': ('LICENSE_NVIDIA', 'texte quelconque\n'),
            'texte de la licence': ('include/gpu/common.h', '// NVIDIA Source Code License for instant neural graphics\n'),
            'classe instant-ngp': ('include/gpu/bvh.cuh', 'class TriangleBvhWithBranchingFactor {};\n'),
            'structure instant-ngp': ('src/api_gpu.cu', 'struct DistAndIdx { float d; int i; };\n'),
        }
        for nom, (rel, contenu) in cas.items():
            with self.subTest(nom):
                racine = os.path.join(self.dossier, nom.replace(' ', '_'))
                faux_cubvh(racine)
                ecrire(os.path.join(racine, *rel.split('/')), contenu)
                with self.assertRaises(C.RefusConstruction):
                    C.verifier_sources_cubvh(racine, exiger_git=False)

    def test_licence_mit_exigee(self):
        racine = self.arbre()
        ecrire(os.path.join(racine, 'LICENSE'), 'Apache License Version 2.0\n')
        with self.assertRaises(C.RefusConstruction):
            C.verifier_sources_cubvh(racine, exiger_git=False)
        os.remove(os.path.join(racine, 'LICENSE'))
        with self.assertRaises(C.RefusConstruction):
            C.verifier_sources_cubvh(racine, exiger_git=False)

    def test_fichiers_compiles_exiges(self):
        racine = self.arbre()
        os.remove(os.path.join(racine, 'src', 'api_gpu.cu'))
        with self.assertRaises(C.RefusConstruction):
            C.verifier_sources_cubvh(racine, exiger_git=False)

    def test_third_party_ignore(self):
        racine = self.arbre()
        ecrire(os.path.join(racine, 'third_party', 'eigen', 'note.txt'), 'NVIDIA Source Code License (exemple)\n')
        C.verifier_sources_cubvh(racine, exiger_git=False)

    def test_git_exige_par_defaut(self):
        with self.assertRaises(C.RefusConstruction) as e:
            C.verifier_sources_cubvh(self.arbre())
        self.assertIn('git', str(e.exception))

    def test_cli_sources_refuse_sans_corriger(self):
        racine = os.path.join(self.dossier, 'CuMesh')
        faux_cumesh(racine, ancien=True)
        dtypes = os.path.join(racine, 'src', 'dtypes.cuh')
        avant = lire(dtypes)
        r = executer_cli(['sources', racine, '--sans-git'])
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn('CONSTRUCTION CUMESH', r.stderr)
        self.assertIn('TriangleBvhWithBranchingFactor', r.stderr)
        self.assertEqual(lire(dtypes), avant, 'dtypes.cuh corrige alors que la garde a refuse')

    def test_cli_sources_accepte_et_corrige(self):
        racine = os.path.join(self.dossier, 'CuMesh')
        faux_cumesh(racine, fin_de_ligne='\r\n')
        r = executer_cli(['sources', racine, '--sans-git'])
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn('correctif de fill_holes : applique', r.stdout)
        self.assertEqual(lire(os.path.join(racine, 'src', 'dtypes.cuh')),
                         DTYPES_ATTENDU.replace('\n', '\r\n').encode('utf-8'))
        r2 = executer_cli(['sources', racine, '--sans-git'])
        self.assertEqual(r2.returncode, 0, r2.stdout + r2.stderr)
        self.assertIn('correctif de fill_holes : deja', r2.stdout)

    def test_cli_sources_exige_git(self):
        racine = os.path.join(self.dossier, 'CuMesh')
        faux_cumesh(racine)
        r = executer_cli(['sources', racine])
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn('pas un depot git', r.stderr)

    @unittest.skipUnless(os.environ.get('CUBVH_ANCIEN') and os.path.isdir(os.environ.get('CUBVH_ANCIEN', '')),
                         'CUBVH_ANCIEN (clone de JeffreyXiang/cubvh a ce92267) non fourni')
    def test_cubvh_reel_epingle_par_cumesh_refuse(self):
        with self.assertRaises(C.RefusConstruction) as e:
            C.verifier_sources_cubvh(os.environ['CUBVH_ANCIEN'], exiger_git=False)
        self.assertIn('TriangleBvhWithBranchingFactor', str(e.exception))
        self.assertIn('LICENSE_NVIDIA', str(e.exception))
        with self.assertRaises(C.RefusConstruction) as e2:
            C.verifier_git_cubvh(os.environ['CUBVH_ANCIEN'])
        self.assertIn('ne descend pas', str(e2.exception))

    @unittest.skipUnless(os.environ.get('CUBVH_NOUVEAU') and os.path.isdir(os.environ.get('CUBVH_NOUVEAU', '')),
                         'CUBVH_NOUVEAU (clone de ashawkey/cubvh a de1badf) non fourni')
    def test_cubvh_reel_mit_accepte(self):
        resume = C.verifier_sources_cubvh(os.environ['CUBVH_NOUVEAU'], exiger_git=True)
        self.assertEqual(resume['commit'], C.CUBVH_COMMIT)


# ---------------------------------------------------------------------------------------------------------
# 4. garde des binaires
# ---------------------------------------------------------------------------------------------------------
ANCIEN_PYD = b'MZ...' + b'.?AV?$TriangleBvhWithBranchingFactor@$03@cubvh@@' + b'..._ZN5cubvh33signed_distance_watertight_kernelEj'
NOUVEAU_SO = b'\x7fELF...' + b'_ZN5cubvh37bvh_signed_distance_watertight_kernelEjPKN5Eigen' + b'...'


def ecrire_roue(chemin, membres):
    with zipfile.ZipFile(chemin, 'w') as z:
        for nom, octets in membres.items():
            z.writestr(nom, octets)


class TestGardeBinaires(unittest.TestCase):

    def setUp(self):
        self.dossier = tempfile.mkdtemp(prefix='cumesh_binaires_')

    def tearDown(self):
        shutil.rmtree(self.dossier, ignore_errors=True)

    def test_ancien_bvh_refuse(self):
        for nom, octets in {'RTTI MSVC': b'.?AV?$TriangleBvhWithBranchingFactor@$03@cubvh@@ ' + NOUVEAU_SO,
                            'symbole Itanium': b'_ZN5cubvh30TriangleBvhWithBranchingFactorILj4EE5buildE ' + NOUVEAU_SO,
                            'ancien noyau': b'_ZN5cubvh33signed_distance_watertight_kernelEj ' + NOUVEAU_SO}.items():
            with self.subTest(nom), self.assertRaises(C.RefusConstruction):
                C.verifier_binaire_cubvh(octets, nom)

    def test_reecriture_acceptee(self):
        self.assertTrue(C.verifier_binaire_cubvh(NOUVEAU_SO, 'nouveau'))
        self.assertNotIn(b'33signed_distance_watertight_kernel', NOUVEAU_SO)

    def test_binaire_sans_marqueur_refuse(self):
        with self.assertRaises(C.RefusConstruction) as e:
            C.verifier_binaire_cubvh(b'\x7fELF rien de reconnaissable', 'inconnu')
        self.assertIn('marqueur', str(e.exception))

    def test_roue(self):
        bonne, mauvaise, vide = (os.path.join(self.dossier, n) for n in ('b.whl', 'm.whl', 'v.whl'))
        ecrire_roue(bonne, {'cumesh/_cubvh.cp311-win_amd64.pyd': NOUVEAU_SO, 'cumesh/bvh.py': b''})
        ecrire_roue(mauvaise, {'cumesh/_cubvh.cp311-win_amd64.pyd': ANCIEN_PYD, 'cumesh/bvh.py': b''})
        ecrire_roue(vide, {'cumesh/bvh.py': b''})
        self.assertEqual(C.verifier_roue(bonne), ['cumesh/_cubvh.cp311-win_amd64.pyd'])
        for chemin in (mauvaise, vide):
            with self.subTest(chemin), self.assertRaises(C.RefusConstruction):
                C.verifier_roue(chemin)
        self.assertEqual(executer_cli(['roue', bonne]).returncode, 0)
        r = executer_cli(['roue', mauvaise])
        self.assertEqual(r.returncode, 1)
        self.assertIn('non commercial', r.stderr)

    def test_site_sans_import(self):
        site = os.path.join(self.dossier, 'site-packages')
        ecrire(os.path.join(site, 'cumesh', '__init__.py'), 'raise ImportError("cumesh ne doit pas etre importe")\n')
        ecrire(os.path.join(site, 'cumesh', '_cubvh.cp311-win_amd64.pyd'), ANCIEN_PYD)
        r = executer_cli(['site', site])
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn('TriangleBvhWithBranchingFactor', r.stderr)
        ecrire(os.path.join(site, 'cumesh', '_cubvh.cp311-win_amd64.pyd'), NOUVEAU_SO)
        r = executer_cli(['site', site])
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    @unittest.skipUnless(os.environ.get('CUMESH_ROUE_BUREAU') and os.path.isfile(os.environ.get('CUMESH_ROUE_BUREAU', '')),
                         'CUMESH_ROUE_BUREAU (build/wheels/cumesh-1.0-cp311-cp311-win_amd64.whl) non fourni')
    def test_roue_reelle_du_bureau_refusee(self):
        with self.assertRaises(C.RefusConstruction) as e:
            C.verifier_roue(os.environ['CUMESH_ROUE_BUREAU'])
        self.assertIn('TriangleBvhWithBranchingFactor', str(e.exception))

    @unittest.skipUnless(os.environ.get('CUMESH_SITE_BUREAU')
                         and os.path.isdir(os.path.join(os.environ.get('CUMESH_SITE_BUREAU', ''), 'cumesh')),
                         'CUMESH_SITE_BUREAU (site-packages du Python de l appli) non fourni')
    def test_cumesh_installe_du_bureau_refuse(self):
        r = executer_cli(['site', os.environ['CUMESH_SITE_BUREAU']])
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn('TriangleBvhWithBranchingFactor', r.stderr)


FAUX_CUBVH_PY = '''import numpy as np
import torch


class _BVH:
    def __init__(self, v, f, boite):
        self.v, self.f, self.boite = v, f, boite

    def state_dict(self):
        n = torch.zeros((5, 9), dtype=torch.int32)
        boite = torch.tensor(self.boite, dtype=torch.float32)
        n[0, :6] = boite.view(torch.int32)
        return {'nodes': n, 'triangles': torch.zeros((len(self.f), 10), dtype=torch.int32)}


def create_cuBVH(v, f):
    v = np.asarray(v)
    boite = np.concatenate([v.min(axis=0), v.max(axis=0)]) + DECALAGE
    return _BVH(v, f, boite.tolist())
'''


@unittest.skipIf(PAS_DE_TORCH or np is None, 'torch ou numpy absent')
class TestInstallation(unittest.TestCase):
    """Commande `installation` de bout en bout, dans un sous-processus, sur un faux paquet cumesh installe."""

    def setUp(self):
        self.dossier = tempfile.mkdtemp(prefix='cumesh_installation_')
        self.site = os.path.join(self.dossier, 'site-packages')
        self.source = os.path.join(self.dossier, 'cumesh_mit')
        os.makedirs(self.source)

    def tearDown(self):
        shutil.rmtree(self.dossier, ignore_errors=True)

    def paquet(self, binaire, decalage='0.0', init='from . import _cubvh  # noqa\n', url=None):
        p = os.path.join(self.site, 'cumesh')
        ecrire(os.path.join(p, '__init__.py'), init)
        # suffixe Linux : jamais importable sous Windows, toujours vu par la garde (glob _cubvh*.so)
        ecrire(os.path.join(p, '_cubvh.cpython-311-x86_64-linux-gnu.so'), binaire)
        ecrire(os.path.join(p, '_cubvh.py'), FAUX_CUBVH_PY.replace('DECALAGE', decalage))
        info = os.path.join(self.site, 'cumesh-0.0.1.dist-info')
        url = url or 'file://' + os.path.abspath(self.source).replace(os.sep, '/')
        ecrire(os.path.join(info, 'direct_url.json'), json.dumps({'dir_info': {}, 'url': url}))

    def lancer(self):
        return executer_cli(['installation', '--source', self.source], site=self.site, cwd=self.dossier)

    @unittest.skipIf(sys.platform != 'win32', 'faux binaire .so non importable seulement sous Windows')
    def test_paquet_conforme(self):
        self.paquet(NOUVEAU_SO)
        r = self.lancer()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn('BVH CPU 5 noeuds', r.stdout)

    def test_ancien_binaire_refuse_avant_tout_import(self):
        self.paquet(ANCIEN_PYD, init='raise SystemExit("IMPORTE : la garde du binaire doit passer avant")\n')
        r = self.lancer()
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn('TriangleBvhWithBranchingFactor', r.stderr)
        self.assertNotIn('IMPORTE', r.stdout + r.stderr)

    @unittest.skipIf(sys.platform != 'win32', 'faux binaire .so non importable seulement sous Windows')
    def test_origine_verifiee(self):
        self.paquet(NOUVEAU_SO, url='file:///tmp/cumesh')
        r = self.lancer()
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn('installe depuis file:///tmp/cumesh', r.stderr)

    @unittest.skipIf(sys.platform != 'win32', 'faux binaire .so non importable seulement sous Windows')
    def test_boite_racine_fausse_refusee(self):
        self.paquet(NOUVEAU_SO, decalage='0.5')
        r = self.lancer()
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn('boite racine', r.stderr)

    @unittest.skipIf(sys.platform != 'win32', 'faux binaire .so non importable seulement sous Windows')
    def test_cubvh_sans_state_dict_refuse(self):
        self.paquet(NOUVEAU_SO)
        chemin = os.path.join(self.site, 'cumesh', '_cubvh.py')
        ecrire(chemin, lire(chemin).decode('utf-8').replace('def state_dict(self):', 'def autre(self):'))
        r = self.lancer()
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn('sans state_dict', r.stderr)


# ---------------------------------------------------------------------------------------------------------
# 5. fonctions de calcul du banc GPU
# ---------------------------------------------------------------------------------------------------------
def boucher_comme_cumesh(v, f, trous, corruption=0.0, nan=False):
    """Bouchage de reference : un sommet au centroide du bord de chaque trou + eventail de faces (comme CuMesh) ;
    `corruption` = G de la PR #41 ajoute a la somme avant la division par n."""
    v2, f2 = [np.asarray(v, dtype=np.float32)], [np.asarray(f, dtype=np.int32)]
    n0 = len(v)
    for k, bord in enumerate(trous):
        somme = np.asarray(v, dtype=np.float64)[bord].sum(axis=0)
        somme[2] += corruption
        p = somme / len(bord)
        if nan and k == 0:
            p[0] = np.nan
        v2.append(p[None].astype(np.float32))
        f2.append(np.array([[bord[i], bord[(i + 1) % len(bord)], n0 + k] for i in range(len(bord))], dtype=np.int32))
    return np.concatenate(v2), np.concatenate(f2)


@unittest.skipIf(B is None, 'numpy absent')
class TestBancFillHoles(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.v, cls.f = B.icosphere(niveaux=4)
        cls.fp, cls.trous = B.percer(cls.v, cls.f, n_triangles=20, n_quadrilateres=0, perimetre_max=1.0)

    def test_sphere_fermee_orientee(self):
        v, f = B.icosphere(niveaux=3)
        aretes = np.concatenate([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]]).tolist()
        orientees = set(map(tuple, aretes))
        self.assertEqual(len(orientees), len(aretes), 'arete orientee en double')
        self.assertTrue(all((b, a) in orientees for a, b in orientees), 'sphere ouverte ou mal orientee')
        self.assertTrue(np.allclose(np.linalg.norm(v, axis=1), B.RAYON_SPHERE, atol=1e-6))

    def test_trous_disjoints_sous_le_seuil(self):
        v, f = B.icosphere()
        fp, trous = B.percer(v, f)
        self.assertEqual(len(trous), B.TROUS_TRIANGLES + B.TROUS_QUADRILATERES)
        self.assertEqual(len(f) - len(fp), B.TROUS_TRIANGLES + 2 * B.TROUS_QUADRILATERES)
        tous = [s for t in trous for s in t]
        self.assertEqual(len(tous), len(set(tous)), 'deux trous partagent un sommet')
        aretes = np.concatenate([fp[:, [0, 1]], fp[:, [1, 2]], fp[:, [2, 0]]])
        cles, n = np.unique(np.sort(aretes, axis=1), axis=0, return_counts=True)
        bords = cles[n == 1]
        self.assertEqual(len(bords), 3 * B.TROUS_TRIANGLES + 4 * B.TROUS_QUADRILATERES)
        longueur = np.linalg.norm(v[bords[:, 0]].astype(np.float64) - v[bords[:, 1]], axis=1)
        par_trou = {}
        for (a, b), l in zip(bords.tolist(), longueur.tolist()):
            k = next(i for i, t in enumerate(trous) if a in t)
            par_trou[k] = par_trou.get(k, 0.0) + l
        self.assertLess(max(par_trou.values()), 0.9 * B.PERIMETRE_MAX)

    def test_oracle_juste_sur_un_bouchage_exact(self):
        va, fa = boucher_comme_cumesh(self.v, self.fp, self.trous)
        m = B.ecarts_bouchage(self.v, self.fp, va, fa)
        self.assertEqual(m['sommets_ajoutes'], len(self.trous))
        self.assertEqual(m['non_finis'], 0)
        self.assertEqual(m['sans_bord'], 0)
        self.assertLess(m['ecart_max'], B.SEUIL_ORACLE)

    def test_oracle_detecte_la_pr41(self):
        for g in (9.5e9, 1e-2):
            with self.subTest(G=g):
                va, fa = boucher_comme_cumesh(self.v, self.fp, self.trous, corruption=g)
                m = B.ecarts_bouchage(self.v, self.fp, va, fa)
                self.assertGreater(m['ecart_max'], B.SEUIL_DEFAUT)
                self.assertEqual(m['ecarts_au_dessus_1e-3'], len(self.trous))
        va, fa = boucher_comme_cumesh(self.v, self.fp, self.trous, nan=True)
        self.assertEqual(B.ecarts_bouchage(self.v, self.fp, va, fa)['non_finis'], 1)

    def test_mesures_globales(self):
        va, fa = boucher_comme_cumesh(self.v, self.fp, self.trous)
        juste = B.mesures_globales(va, fa, self.v, self.fp)
        self.assertLess(juste['arete_max_rel'], 3)
        self.assertLess(juste['coordonnee_max_rel'], 1.01)
        va, fa = boucher_comme_cumesh(self.v, self.fp, self.trous, corruption=9.5e9)
        faux = B.mesures_globales(va, fa, self.v, self.fp)
        self.assertGreater(faux['arete_max_rel'], B.SEUIL_ARETE_REL)

    def test_verdict(self):
        juste = {'sommets_ajoutes': 10, 'non_finis': 0, 'sans_bord': 0, 'ecart_max': 1e-7}
        faux = dict(juste, ecart_max=3.2e9)
        seq_juste = {'non_finis': 0, 'arete_max_rel': 4.0, 'coordonnee_max_rel': 1.0}

        def r(variante, direct, seq=(seq_juste,)):
            return {'variante': variante, 'direct': list(direct), 'sequences': list(seq)}
        v = B.verdict({'avec_correctif': r('avec_correctif', [juste] * 4),
                       'sans_correctif': r('sans_correctif', [juste, faux, faux, faux])}, 10)
        self.assertTrue(v['banc_valide'])
        self.assertTrue(v['defaut_confirme_sans_correctif'])
        self.assertEqual(v['appels_corrompus_sans_correctif'], [1, 2, 3])
        v = B.verdict({'avec_correctif': r('avec_correctif', [juste] * 4),
                       'sans_correctif': r('sans_correctif', [juste] * 4)}, 10)
        self.assertTrue(v['banc_valide'])
        self.assertFalse(v['defaut_confirme_sans_correctif'])
        v = B.verdict({'avec_correctif': r('avec_correctif', [juste, faux]),
                       'sans_correctif': r('sans_correctif', [juste])}, 10)
        self.assertFalse(v['banc_valide'], 'un appel faux AVEC correctif invalide le banc')


class TestBancsModalCoherents(unittest.TestCase):
    """Les deux bancs GPU se chargent (syntaxe) et n'importent de modal_app.app que des noms qui existent : sans GPU on
    ne peut pas les lancer, mais on peut au moins empecher qu'un renommage les casse en silence."""

    BANCS = ('test_cumesh_fill_holes.py', 'test_cumesh_bvh.py')

    def test_syntaxe_et_imports_de_app(self):
        with open(APP, encoding='utf-8') as f:
            noms_app = {t.id for n in ast.parse(f.read()).body if isinstance(n, ast.Assign) for t in n.targets
                        if isinstance(t, ast.Name)}
        for nom in self.BANCS:
            with self.subTest(nom):
                with open(os.path.join(RACINE, 'modal_app', nom), encoding='utf-8') as f:
                    arbre = ast.parse(f.read(), nom)
                demandes = [a.name for n in ast.walk(arbre) if isinstance(n, ast.ImportFrom) and n.module == 'modal_app.app'
                            for a in n.names]
                self.assertTrue(demandes, 'le banc doit importer mesh_image')
                for d in demandes:
                    self.assertIn(d, noms_app, f'{nom} importe {d} qui n\'existe plus dans modal_app/app.py')

    def test_les_bancs_utilisent_l_image_de_production(self):
        for nom in self.BANCS:
            with open(os.path.join(RACINE, 'modal_app', nom), encoding='utf-8') as f:
                self.assertIn('image=mesh_image', f.read(), nom)


@unittest.skipIf(B is None or PAS_DE_TORCH, 'numpy ou torch absent')
class TestOrchestrationBancFillHoles(unittest.TestCase):
    """mesurer_dans_ce_processus de bout en bout SUR LE CPU, avec un faux module cumesh (device='cpu', aucune carte
    graphique touchee) : la plomberie que le GPU n'exercera qu'une fois (conversions, indices, verdict des deux variantes)."""

    @staticmethod
    def faux_cumesh(corruption=0.0, a_partir_de_l_appel=1):
        import torch
        etat = {'appels': 0}

        class FauxCuMesh:
            def init(self, v, f):
                self.v, self.f = v.numpy().astype(np.float64), f.numpy().astype(np.int64)

            def fill_holes(self, max_hole_perimeter=3e-2):
                aretes = np.concatenate([self.f[:, [0, 1]], self.f[:, [1, 2]], self.f[:, [2, 0]]])
                cles, inv, n = np.unique(np.sort(aretes, axis=1), axis=0, return_inverse=True, return_counts=True)
                bord = aretes[n[np.asarray(inv).reshape(-1)] == 1]
                # un trou = composante connexe des aretes de bord (union-find sur les sommets)
                parent = {}

                def racine(x):
                    parent.setdefault(x, x)
                    while parent[x] != x:
                        parent[x] = parent[parent[x]]
                        x = parent[x]
                    return x
                for a, b in bord.tolist():
                    parent[racine(a)] = racine(b)
                trous = {}
                for a, b in bord.tolist():
                    trous.setdefault(racine(a), []).append((a, b))
                etat['appels'] += 1
                G = corruption if etat['appels'] > a_partir_de_l_appel else 0.0
                nv = len(self.v)
                nouveaux_v, nouvelles_f = [], []
                for k, aretes_du_trou in enumerate(trous.values()):
                    sommets = sorted({s for e in aretes_du_trou for s in e})
                    somme = self.v[sommets].sum(axis=0)
                    somme[2] += G
                    nouveaux_v.append(somme / len(sommets))
                    nouvelles_f += [[b, a, nv + k] for a, b in aretes_du_trou]
                if nouveaux_v:
                    self.v = np.concatenate([self.v, np.array(nouveaux_v)])
                    self.f = np.concatenate([self.f, np.array(nouvelles_f)])

            def read(self):
                return torch.from_numpy(self.v.astype(np.float32)), torch.from_numpy(self.f.astype(np.int32))

            def simplify(self, cible, **kw):
                pass

            def remove_duplicate_faces(self):
                pass

            def repair_non_manifold_edges(self):
                pass

            def remove_small_connected_components(self, aire):
                pass

        class Module:
            __file__ = '<faux cumesh>'
            CuMesh = FauxCuMesh
        return Module

    def lancer(self, variante, **kw):
        return B.mesurer_dans_ce_processus(appels=3, sequences=1, variante=variante, device='cpu', niveaux=4,
                                           n_triangles=12, n_quadrilateres=4, perimetre_max=1.0,
                                           cumesh_module=self.faux_cumesh(**kw))

    def test_variante_juste(self):
        r = self.lancer('avec_correctif')
        self.assertEqual(r['trous'], 16)
        self.assertEqual(len(r['direct']), 3)
        self.assertEqual(len(r['sequences']), 1)
        for a in r['direct']:
            self.assertEqual(a['sommets_ajoutes'], 16)
            self.assertLess(a['ecart_max'], B.SEUIL_ORACLE)
        self.assertLess(r['sequences'][0]['arete_max_rel'], 5)

    def test_verdict_des_deux_variantes_comme_dans_modal(self):
        avec = self.lancer('avec_correctif')
        sans = self.lancer('sans_correctif', corruption=9.5e9)       # defaut a partir du 2e appel du processus
        v = B.verdict({'avec_correctif': avec, 'sans_correctif': sans}, avec['trous'])
        self.assertTrue(v['banc_valide'], v)
        self.assertTrue(v['defaut_confirme_sans_correctif'], v)
        self.assertEqual(v['appels_corrompus_sans_correctif'], [1, 2], 'le 1er appel du processus est juste (PR #41)')
        sain = B.verdict({'avec_correctif': avec, 'sans_correctif': self.lancer('sans_correctif')}, avec['trous'])
        self.assertFalse(sain['defaut_confirme_sans_correctif'], sain)

    def test_un_correctif_qui_ne_corrige_pas_invalide_le_banc(self):
        mauvais = self.lancer('avec_correctif', corruption=9.5e9)
        sans = self.lancer('sans_correctif', corruption=9.5e9)
        self.assertFalse(B.verdict({'avec_correctif': mauvais, 'sans_correctif': sans}, mauvais['trous'])['banc_valide'])


if __name__ == '__main__':
    unittest.main()
