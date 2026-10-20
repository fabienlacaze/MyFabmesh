"""Reconstruction de la roue cumesh du bureau (build/reconstruire_roue_cumesh.py) et avertissement de
build/fetch_trellis2_wheels.py — CPU seulement (2026-10-15).

Rien n'est compile ici : la compilation CUDA locale est interdite et le script ne la lance que sous --construire. Ce
test verifie tout ce qui l'entoure :
  1. --verifier : une roue avec le BVH d'instant-ngp est REFUSEE (code 1), une roue MIT acceptee, aucune roue = code 0 ;
  2. prerequis : chaque manque (plateforme, Python, Python.h, git, torch, CUDA, nvcc, cl, setuptools/wheel) est signale ;
  3. version de la roue : une seule occurrence de `version = "1.0"` remplacee, fins de ligne conservees ;
  4. preparation des sources sur de VRAIS depots git locaux : third_party/cubvh remplace, commit epingle, LICENSE_NVIDIA
     disparue, garde des sources, dossier neuf exige, cubvh avec du code d'instant-ngp REFUSE ;
  5. plan --a-blanc : rien n'est cree ; la commande de construction est sans isolation et sans dependances ;
  6. donnees REELLES quand elles sont fournies : ROUE_PUBLIQUE (pre-release trellis2-wheels-v1) -> REFUSEE ;
  7. fetch_trellis2_wheels.avertir_cumesh : avertit sans echouer.

Lancer :  python build/bancs/noyaux/test_roue_cumesh.py -v
"""
import contextlib
import importlib.util
import io
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile

RACINE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))


def charger(nom, chemin):
    spec = importlib.util.spec_from_file_location(nom, chemin)
    m = importlib.util.module_from_spec(spec)
    sys.modules[nom] = m
    spec.loader.exec_module(m)
    return m


# NOYAU_ROUE / NOYAU_FETCH : copie MODIFIEE des deux scripts, pour rejouer une mutation (elle doit rester dans build/).
R = charger('reconstruire_roue_cumesh_sous_test',
            os.environ.get('NOYAU_ROUE') or os.path.join(RACINE, 'build', 'reconstruire_roue_cumesh.py'))
F = charger('fetch_trellis2_wheels_sous_test',
            os.environ.get('NOYAU_FETCH') or os.path.join(RACINE, 'build', 'fetch_trellis2_wheels.py'))
CC = R.cc

ANCIEN_PYD = b'MZ...' + b'.?AV?$TriangleBvhWithBranchingFactor@$03@cubvh@@' + b'..._ZN5cubvh33signed_distance_watertight_kernelEj'
NOUVEAU_PYD = b'MZ...' + b'_ZN5cubvh37bvh_signed_distance_watertight_kernelEjPKN5Eigen' + b'...'
LICENCE_MIT = 'MIT License\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\n'
ENV_GIT = dict(os.environ, GIT_AUTHOR_NAME='t', GIT_AUTHOR_EMAIL='t@t', GIT_COMMITTER_NAME='t', GIT_COMMITTER_EMAIL='t@t',
               GIT_CONFIG_NOSYSTEM='1')


def ecrire(chemin, contenu):
    os.makedirs(os.path.dirname(chemin), exist_ok=True)
    with open(chemin, 'wb') as f:
        f.write(contenu.encode('utf-8') if isinstance(contenu, str) else contenu)


def git(cwd, *args):
    r = subprocess.run(['git', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', *args], cwd=cwd, env=ENV_GIT,
                       capture_output=True, text=True)
    assert r.returncode == 0, f'git {args} : {r.stderr}'
    return r.stdout.strip()


def ecrire_roue(chemin, pyd):
    with zipfile.ZipFile(chemin, 'w') as z:
        z.writestr('cumesh/_cubvh.cp311-win_amd64.pyd', pyd)
        z.writestr('cumesh/bvh.py', b'')


def executer(args):
    sortie, erreur = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(sortie), contextlib.redirect_stderr(erreur):
        code = R.main(args)
    return code, sortie.getvalue(), erreur.getvalue()


class Base(unittest.TestCase):
    def setUp(self):
        self.dossier = tempfile.mkdtemp(prefix='roue_cumesh_')

    def tearDown(self):
        shutil.rmtree(self.dossier, ignore_errors=True)


class TestVerifier(Base):

    def test_ancienne_roue_refusee_nouvelle_acceptee(self):
        mauvaise, bonne = os.path.join(self.dossier, 'm.whl'), os.path.join(self.dossier, 'b.whl')
        ecrire_roue(mauvaise, ANCIEN_PYD)
        ecrire_roue(bonne, NOUVEAU_PYD)
        code, sortie, _ = executer(['--verifier', mauvaise])
        self.assertEqual(code, 1, sortie)
        self.assertIn('REFUSEE', sortie)
        self.assertIn('TriangleBvhWithBranchingFactor', sortie)
        code, sortie, _ = executer(['--verifier', bonne])
        self.assertEqual(code, 0, sortie)
        self.assertIn('conforme', sortie)
        code, _, _ = executer(['--verifier', bonne, mauvaise])
        self.assertEqual(code, 1, 'une seule roue refusee suffit')

    def test_sans_argument_lit_build_wheels(self):
        ancien = R.SORTIE_PAR_DEFAUT
        try:
            R.SORTIE_PAR_DEFAUT = os.path.join(self.dossier, 'wheels')
            code, sortie, _ = executer(['--verifier'])
            self.assertEqual(code, 0, 'aucune roue = arbre de dev, pas un refus')
            self.assertIn('aucune roue', sortie)
            os.makedirs(R.SORTIE_PAR_DEFAUT)
            ecrire_roue(os.path.join(R.SORTIE_PAR_DEFAUT, 'cumesh-1.0-cp311-cp311-win_amd64.whl'), ANCIEN_PYD)
            code, sortie, _ = executer(['--verifier'])
            self.assertEqual(code, 1, sortie)
        finally:
            R.SORTIE_PAR_DEFAUT = ancien

    def test_roue_sans_binaire_refusee(self):
        vide = os.path.join(self.dossier, 'v.whl')
        with zipfile.ZipFile(vide, 'w') as z:
            z.writestr('cumesh/bvh.py', b'')
        code, sortie, _ = executer(['--verifier', vide])
        self.assertEqual(code, 1, sortie)

    ROUE_PUBLIQUE = os.environ.get('ROUE_PUBLIQUE', '')

    @unittest.skipUnless(os.path.isfile(ROUE_PUBLIQUE), 'ROUE_PUBLIQUE (roue de la pre-release trellis2-wheels-v1) non fournie')
    def test_roue_publique_reelle_refusee(self):
        code, sortie, _ = executer(['--verifier', self.ROUE_PUBLIQUE])
        self.assertEqual(code, 1, sortie)
        self.assertIn('TriangleBvhWithBranchingFactor', sortie)


class TestPrerequis(unittest.TestCase):
    BONNE = {'plateforme': 'win32', 'python': (3, 11), 'git': 'git', 'nvcc': 'nvcc', 'cl': 'cl', 'python_h': 'Python.h',
             'torch': '2.8.0+cu128', 'cuda_torch': '12.8', 'setuptools': True, 'wheel': True,
             'nvcc_version': 'Cuda compilation tools, release 12.8, V12.8.61'}

    def test_machine_prete(self):
        self.assertEqual(R.problemes_prerequis(self.BONNE), [])

    def test_chaque_manque_est_signale(self):
        cas = {
            'plateforme': ({'plateforme': 'linux'}, 'Windows'),
            'python': ({'python': (3, 12)}, 'Python 3.11'),
            'embarque': ({'python_h': None}, 'Python.h'),
            'git': ({'git': None}, 'git'),
            'torch absent': ({'torch': None}, 'torch'),
            'torch 2.4': ({'torch': '2.4.1+cu124', 'cuda_torch': '12.4'}, '2.8.0'),
            'cuda de torch': ({'cuda_torch': '12.6'}, 'CUDA 12.8'),
            'nvcc absent': ({'nvcc': None}, 'nvcc'),
            'nvcc 12.4': ({'nvcc_version': 'release 12.4, V12.4.131'}, '12.8'),
            'cl': ({'cl': None}, 'cl.exe'),
            'setuptools': ({'setuptools': False}, 'setuptools'),
            'wheel': ({'wheel': False}, 'wheel'),
        }
        for nom, (modif, motif) in cas.items():
            with self.subTest(nom):
                p = R.problemes_prerequis(dict(self.BONNE, **modif))
                self.assertEqual(len(p), 1, p)
                self.assertIn(motif, p[0])

    def test_machine_vide(self):
        self.assertGreaterEqual(len(R.problemes_prerequis({})), 8)


class TestVersion(Base):

    def test_remplacement_exact_et_fins_de_ligne(self):
        chemin = os.path.join(self.dossier, 'pyproject.toml')
        ecrire(chemin, '[project]\r\nname = "cumesh"\r\nversion = "1.0"\r\ndescription = "x"\r\n')
        R.remplacer_version(chemin, '1.0.1')
        with open(chemin, 'rb') as f:
            self.assertEqual(f.read(), b'[project]\r\nname = "cumesh"\r\nversion = "1.0.1"\r\ndescription = "x"\r\n')

    def test_texte_inattendu_refuse(self):
        chemin = os.path.join(self.dossier, 'pyproject.toml')
        for nom, texte in {'absente': 'version = "2.0"\n', 'en double': 'version = "1.0"\nversion = "1.0"\n'}.items():
            with self.subTest(nom):
                ecrire(chemin, texte)
                with self.assertRaises(R.Echec):
                    R.remplacer_version(chemin, '1.0.1')
                with open(chemin, 'rb') as f:
                    self.assertEqual(f.read(), texte.encode('utf-8'))


@unittest.skipIf(shutil.which('git') is None, 'git absent')
class TestPreparer(Base):
    """Vrais depots git locaux : un faux fork visualbruno (avec cubvh d'instant-ngp DANS l'arbre) et un faux ashawkey/cubvh."""

    def setUp(self):
        super().setUp()
        self.cubvh = os.path.join(self.dossier, 'depot_cubvh')
        self.fork = os.path.join(self.dossier, 'depot_fork')
        os.makedirs(self.cubvh)
        os.makedirs(self.fork)
        git(self.cubvh, 'init', '--quiet')
        ecrire(os.path.join(self.cubvh, 'LICENSE'), 'x\n')
        git(self.cubvh, 'add', '-A')
        git(self.cubvh, 'commit', '--quiet', '-m', 'ancien')
        self.reecriture = git(self.cubvh, 'rev-parse', 'HEAD')
        for rel, contenu in {'LICENSE': LICENCE_MIT, 'src/bvh.cu': 'namespace cubvh { class TriangleBvhImpl {}; }\n',
                             'src/api_gpu.cu': '// api\n', 'src/bindings.cpp': '// py\n',
                             'third_party/eigen/Eigen/Dense': '// MPL-2.0\n'}.items():
            ecrire(os.path.join(self.cubvh, *rel.split('/')), contenu)
        git(self.cubvh, 'add', '-A')
        git(self.cubvh, 'commit', '--quiet', '-m', 'mit')
        self.commit_cubvh = git(self.cubvh, 'rev-parse', 'HEAD')
        git(self.fork, 'init', '--quiet')
        for rel, contenu in {'pyproject.toml': '[project]\nversion = "1.0"\n', 'setup.py': '# setup\n',
                             'third_party/cubvh/LICENSE_NVIDIA': 'NVIDIA Source Code License for instant neural graphics primitives\n',
                             'third_party/cubvh/src/bvh.cu': 'class TriangleBvhWithBranchingFactor {};\n'}.items():
            ecrire(os.path.join(self.fork, *rel.split('/')), contenu)
        git(self.fork, 'add', '-A')
        git(self.fork, 'commit', '--quiet', '-m', 'fork')
        self.commit_fork = git(self.fork, 'rev-parse', 'HEAD')
        self.sauvegarde = (CC.CUMESH_BUREAU_COMMIT, CC.CUBVH_COMMIT, CC.CUBVH_REECRITURE_MIT)
        CC.CUMESH_BUREAU_COMMIT, CC.CUBVH_COMMIT, CC.CUBVH_REECRITURE_MIT = self.commit_fork, self.commit_cubvh, self.reecriture
        self.travail = os.path.join(self.dossier, 'travail')

    def tearDown(self):
        CC.CUMESH_BUREAU_COMMIT, CC.CUBVH_COMMIT, CC.CUBVH_REECRITURE_MIT = self.sauvegarde
        super().tearDown()

    def preparer(self, **kw):
        return R.preparer(self.travail, depot_cumesh=self.fork, depot_cubvh=self.cubvh, log=lambda m: None, **kw)

    def test_cubvh_remplace_par_la_reecriture_mit(self):
        src = self.preparer()
        cub = os.path.join(src, 'third_party', 'cubvh')
        self.assertFalse(os.path.exists(os.path.join(cub, 'LICENSE_NVIDIA')))
        with open(os.path.join(cub, 'src', 'bvh.cu')) as f:
            self.assertNotIn('TriangleBvhWithBranchingFactor', f.read())
        self.assertEqual(git(cub, 'rev-parse', 'HEAD'), self.commit_cubvh)
        self.assertTrue(os.path.isfile(os.path.join(cub, 'third_party', 'eigen', 'Eigen', 'Dense')))

    def test_version_fixee_dans_les_sources(self):
        src = self.preparer()
        with open(os.path.join(src, 'pyproject.toml')) as f:
            self.assertIn('version = "1.0.1"', f.read())

    def test_cubvh_avec_code_d_instant_ngp_refuse(self):
        ecrire(os.path.join(self.cubvh, 'LICENSE_NVIDIA'), 'NVIDIA Source Code License for instant neural graphics primitives\n')
        git(self.cubvh, 'add', '-A')
        git(self.cubvh, 'commit', '--quiet', '-m', 'retour de la licence NVIDIA')
        CC.CUBVH_COMMIT = git(self.cubvh, 'rev-parse', 'HEAD')
        with self.assertRaises(CC.RefusConstruction) as e:
            self.preparer()
        self.assertIn('LICENSE_NVIDIA', str(e.exception))

    def test_cubvh_hors_lignee_de_la_reecriture_refuse(self):
        CC.CUBVH_REECRITURE_MIT = self.commit_fork      # pas un ancetre du commit epingle de cubvh
        with self.assertRaises(CC.RefusConstruction) as e:
            self.preparer()
        self.assertIn('ne descend pas', str(e.exception))

    def test_dossier_non_neuf_refuse(self):
        os.makedirs(self.travail)
        ecrire(os.path.join(self.travail, 'quelque_chose'), 'x')
        with self.assertRaises(R.Echec):
            self.preparer()

    def test_eigen_absent_refuse(self):
        git(self.cubvh, 'rm', '--quiet', '-r', 'third_party')
        git(self.cubvh, 'commit', '--quiet', '-m', 'sans eigen')
        CC.CUBVH_COMMIT = git(self.cubvh, 'rev-parse', 'HEAD')
        with self.assertRaises(R.Echec) as e:
            self.preparer()
        self.assertIn('Eigen', str(e.exception))


class TestConstruire(Base):

    def test_a_blanc_ne_cree_rien(self):
        travail = os.path.join(self.dossier, 'travail')
        sortie = io.StringIO()
        with contextlib.redirect_stdout(sortie):
            self.assertIsNone(R.construire(travail, os.path.join(self.dossier, 'wheels'), a_blanc=True,
                                           log=lambda m: print(m)))
        texte = sortie.getvalue()
        self.assertFalse(os.path.exists(travail))
        self.assertFalse(os.path.exists(os.path.join(self.dossier, 'wheels')))
        for motif in (CC.CUMESH_BUREAU_COMMIT, CC.CUBVH_COMMIT, 'TORCH_CUDA_ARCH_LIST=' + R.ARCHS_PAR_DEFAUT,
                      '--no-build-isolation', f'version = "{R.VERSION_ROUE}"'):
            self.assertIn(motif, texte)

    def test_commande_sans_isolation_ni_dependances(self):
        cmd = R.commande_construction('src', 'tmp')
        self.assertEqual(cmd[1:4], ['-m', 'pip', 'wheel'])
        for drapeau in ('--no-deps', '--no-build-isolation'):
            self.assertIn(drapeau, cmd)
        self.assertNotIn('install', cmd)

    def test_version_superieure_a_la_roue_livree(self):
        def cle(v):
            return tuple(int(x) for x in v.split('.'))
        self.assertGreater(cle(R.VERSION_ROUE), cle('1.0'))
        self.assertGreater(cle(R.VERSION_ROUE), cle('1.0.0'), 'pip ne remplace pas une version egale')

    def test_machine_non_prete_arrete_avant_tout_clone(self):
        original = R.sonder
        R.sonder = lambda: {'plateforme': 'linux'}
        try:
            with self.assertRaises(R.Echec) as e:
                R.construire(os.path.join(self.dossier, 'travail'), self.dossier)
            self.assertIn('machine non prete', str(e.exception))
            self.assertFalse(os.path.exists(os.path.join(self.dossier, 'travail')))
        finally:
            R.sonder = original


def section_40():
    # NOYAU_LICENCES : copie de l'ancien THIRD_PARTY_LICENSES.txt (git show 0dc18f33:THIRD_PARTY_LICENSES.txt)
    with open(os.environ.get('NOYAU_LICENCES') or os.path.join(RACINE, 'THIRD_PARTY_LICENSES.txt'), encoding='utf-8') as f:
        texte = f.read().replace('\r\n', '\n')
    debut = texte.index(' 40. CuMesh')
    return ' '.join(texte[debut:texte.index(' Bundled rig templates', debut)].split())     # retours a la ligne neutralises


class TestLicences(unittest.TestCase):
    """Section 40 de THIRD_PARTY_LICENSES.txt : exacte, et alignee sur le code (commits, empreinte de la roue)."""

    def test_pas_de_fausse_promesse(self):
        t = section_40()
        self.assertNotIn('not redistributed inside the app package', t, 'la roue est livree (extraResources build/wheels)')
        self.assertIn('bundled in the installer', t)

    def test_les_deux_licences_et_les_fichiers_sous_licence_propre(self):
        t = section_40()
        for motif in ('cubvh', 'MIT', 'BSD-3-Clause', 'tiny-cuda-nn', 'Apache-2.0', 'pcg32', 'MPL-2.0', 'Eigen',
                      'Jianfeng XIANG', 'kiui', 'NVIDIA Source Code License', 'instant-ngp', 'LICENSE_NVIDIA'):
            self.assertIn(motif, t, motif)

    def test_commits_cites_ceux_du_code(self):
        t = section_40()
        for nom in ('CUBVH_REECRITURE_MIT', 'CUBVH_COMMIT', 'CUMESH_COMMIT', 'CUMESH_BUREAU_COMMIT'):
            self.assertIn(getattr(CC, nom)[:7], t, f'{nom} ({getattr(CC, nom)[:7]}) absent de la section 40')

    def test_empreinte_de_la_roue_livree(self):
        t = section_40()
        sha = F.WHEELS['cumesh-1.0-cp311-cp311-win_amd64.whl']
        self.assertIn(sha[:8], t)
        self.assertIn(sha[-4:], t)

    def test_ancien_code_signale_tant_que_la_roue_est_livree(self):
        t = section_40()
        self.assertIn('CONTAINS the instant-ngp BVH', t)
        self.assertIn('NOT cleared for', t)

    def test_pins_de_la_roue_coherents_entre_wizard_et_fetch(self):
        import re
        with open(os.path.join(RACINE, 'scripts', 'wizard_install_deps.py'), encoding='utf-8') as f:
            wizard = f.read()
        version = re.search(r"'cumesh==([0-9.]+)'", wizard).group(1)
        fichier = re.search(r"'(cumesh-[0-9.]+-cp311-cp311-win_amd64\.whl)'", wizard).group(1)
        self.assertEqual(fichier, f'cumesh-{version}-cp311-cp311-win_amd64.whl')
        self.assertIn(fichier, F.WHEELS, 'le wizard installe une roue que fetch_trellis2_wheels ne telecharge pas')


class TestAvertissementFetch(Base):

    def test_avertit_sans_echouer(self):
        ecrire_roue(os.path.join(self.dossier, 'cumesh-1.0-cp311-cp311-win_amd64.whl'), ANCIEN_PYD)
        messages = []
        self.assertEqual(F.avertir_cumesh(self.dossier, out=messages.append), 1)
        self.assertIn('WARNING', messages[0])
        self.assertIn('reconstruire_roue_cumesh.py', messages[0])

    def test_roue_conforme_silencieuse(self):
        ecrire_roue(os.path.join(self.dossier, 'cumesh-1.0.1-cp311-cp311-win_amd64.whl'), NOUVEAU_PYD)
        messages = []
        self.assertEqual(F.avertir_cumesh(self.dossier, out=messages.append), 0)
        self.assertEqual(messages, [])

    def test_aucune_roue(self):
        self.assertEqual(F.avertir_cumesh(self.dossier, out=lambda m: None), 0)


if __name__ == '__main__':
    unittest.main()
