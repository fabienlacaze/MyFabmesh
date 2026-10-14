"""Correctif de la table de hachage d'o_voxel dans l'image Modal du maillage (2026-10-13).

DEFAUT (prouve les 03-04/10, voir AGENT_LOG ; applique jusqu'ici a l'execution par modal_app/exp_trellis_deux_tuiles.py
et exp_trellis_haute_res.py) : o_voxel/convert/flexible_dual_grid.py::_init_hashmap calcule
VOL = (grid_size[0] * grid_size[1] * grid_size[2]).item() sur des TENSEURS int32. Le produit deborde (1792 ->
1 459 617 792 au lieu de 5 754 585 088 ; 2048 -> 0) et le type de cle retombe sur uint32 alors que les cles x*H*D
depassent 2^32 des la grille 1626 : collisions (a 2048, x et x + 1024 donnent la meme cle). La production plafonne
a 1536 (non touchee) ; la grille 1792 recommandee l'exige.

CE QUE VERIFIE CE TEST (CPU seulement : aucun GPU, aucun reseau, aucune installation) :
  1. modal_app/app.py definit _CORRECTIF_HACHAGE_OVOXEL (correctif + garde) et mesh_image l'execute APRES
     l'installation d'o-voxel et AVANT add_local_python_source ; chaque commande est un `python -c "..."` que
     /bin/sh transmet tel quel (ni $, ni accent grave, ni barre oblique inverse, ni guillemet double dans le code) ;
  2. le correctif, EXECUTE tel quel (meme code, sous-processus) sur une COPIE du fichier du fork local, ne change
     QUE la ligne du volume et garde les fins de ligne CRLF ; il ECHOUE (code non nul, fichier intact) si le calcul
     attendu manque, est deja corrige ou apparait deux fois ;
  3. la fonction corrigee choisit uint32 jusqu'a la grille 1625 et uint64 au-dela (1536, 1626, 1792, 2048, 3072,
     4096) ; la fonction d'origine se trompe des 1626 (constat du defaut sur le meme fichier) ; les cles calculees
     comme le noyau CUDA (static_cast<K>(x*H*D + y*D + z), src/hash/hash.cu) ne se replient plus ;
  4. la garde passe sur le fichier corrige et ECHOUE sur celui d'origine, sans executer o_voxel/__init__.py
     (paquet piege qui leve s'il est execute) ;
  5. le bureau ne demande aucune grille > 1625 (modes de scripts/trellis2_native_full_pipeline.py et de
     src/main/main.js) : s'il en demande une un jour, ce test le signale (il faudra alors corriger aussi le bureau,
     a l'execution, comme les essais Modal).

Lancer :  python build/bancs/noyaux/test_hachage_ovoxel.py -v        (Python du PATH, torch CPU)
Preuve d'echec sur l'ancien code : NOYAU_APP=<copie de l'ancien modal_app/app.py> (git show <rev>:modal_app/app.py).
Fichier d'o_voxel : NOYAU_FDG=<chemin> ; par defaut le fork local (gitignore) ; absent -> tests concernes sautes.
"""
import ast
import importlib.util
import os
import re
import subprocess
import sys
import tempfile
import types
import unittest

RACINE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
APP = os.environ.get('NOYAU_APP') or os.path.join(RACINE, 'modal_app', 'app.py')
FDG = os.environ.get('NOYAU_FDG') or os.path.join(
    RACINE, 'external', 'TRELLIS2_win', 'src', 'o-voxel', 'o_voxel', 'convert', 'flexible_dual_grid.py')
PIPELINE_BUREAU = os.path.join(RACINE, 'scripts', 'trellis2_native_full_pipeline.py')
MAIN_JS = os.path.join(RACINE, 'src', 'main', 'main.js')

CONSTANTE = '_CORRECTIF_HACHAGE_OVOXEL'
CALCUL_ORIGINAL = b'VOL = (grid_size[0] * grid_size[1] * grid_size[2]).item()'
GRILLES = (1536, 1625, 1626, 1792, 2048, 3072, 4096)
GRILLE_MAX_UINT32 = 1625          # 1625^3 = 4 291 015 625 < 2^32 <= 1626^3
# RUN de l'image = /bin/sh -c '<commande>'. Entre guillemets doubles, sh n'interprete que $, ` et \ (et le
# guillemet double qui ferme) : un code qui n'en contient aucun arrive tel quel dans sys.argv de Python.
COMMANDE_SH = re.compile(r'python -c "([^"$`\\]*)"')
# o_voxel/__init__.py importe postprocess (flex_gemm, cumesh, rasteriseur) : la garde ne doit JAMAIS l'executer.
INIT_PIEGE = b"raise ImportError('o_voxel/__init__.py execute : la garde doit charger le module seul')\r\n"

PAS_DE_FDG = not os.path.isfile(FDG)
RAISON_FDG = 'fichier d o_voxel absent (%s) : fork local non installe, ou NOYAU_FDG' % FDG
PAS_DE_TORCH = importlib.util.find_spec('torch') is None


def lire_app():
    with open(APP, encoding='utf-8') as f:
        return f.read()


def commandes_de_l_app(arbre):
    """Les commandes de _CORRECTIF_HACHAGE_OVOXEL (tuple de chaines), ou None si app.py ne la definit pas."""
    for noeud in arbre.body:
        if isinstance(noeud, ast.Assign) and any(isinstance(c, ast.Name) and c.id == CONSTANTE for c in noeud.targets):
            return ast.literal_eval(noeud.value)
    return None


def chaine_mesh_image(arbre):
    """Appels de methode de `mesh_image = (...)` dans l'ordre d'execution : [(nom, ast.Call), ...]."""
    for noeud in arbre.body:
        if isinstance(noeud, ast.Assign) and any(isinstance(c, ast.Name) and c.id == 'mesh_image' for c in noeud.targets):
            appels = []
            n = noeud.value
            while isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute):
                appels.append((n.func.attr, n))
                n = n.func.value
            return list(reversed(appels))
    return None


def chaines_de(appel):
    """Chaines des ARGUMENTS d'un appel (pas de appel.func : il contient tous les appels precedents de la chaine)."""
    return [n.value for arg in list(appel.args) + [k.value for k in appel.keywords] for n in ast.walk(arg)
            if isinstance(n, ast.Constant) and isinstance(n.value, str)]


def code_python(commande):
    m = COMMANDE_SH.fullmatch(commande)
    return m.group(1) if m else None


def paquet_installe(dossier, contenu_fdg):
    """Copie minimale d'un o_voxel INSTALLE : __init__ pieges, convert/flexible_dual_grid.py = contenu_fdg."""
    conv = os.path.join(dossier, 'o_voxel', 'convert')
    os.makedirs(conv)
    for rel in (('o_voxel', '__init__.py'), ('o_voxel', 'convert', '__init__.py')):
        with open(os.path.join(dossier, *rel), 'wb') as f:
            f.write(INIT_PIEGE)
    chemin = os.path.join(conv, 'flexible_dual_grid.py')
    with open(chemin, 'wb') as f:
        f.write(contenu_fdg)
    return chemin


def executer(commande, dossier):
    """Execute la commande de l'image comme /bin/sh le ferait (argv = python -c <code>), o_voxel = la copie de `dossier`."""
    code = code_python(commande)
    if code is None:
        raise AssertionError('commande non transmissible telle quelle par /bin/sh : %r' % commande[:120])
    env = dict(os.environ, PYTHONPATH=dossier, PYTHONIOENCODING='utf-8', PYTHONDONTWRITEBYTECODE='1')
    return subprocess.run([sys.executable, '-c', code], cwd=dossier, env=env, capture_output=True,
                          encoding='utf-8', errors='replace', timeout=600)


def lire(chemin):
    with open(chemin, 'rb') as f:
        return f.read()


def charger_fdg(chemin, racine):
    """Charge flexible_dual_grid.py SEUL, sous un nom unique (paquets parents factices, _C absent)."""
    pk = types.ModuleType(racine)
    pk.__path__ = []
    pk._C = None
    cv = types.ModuleType(racine + '.convert')
    cv.__path__ = []
    sys.modules[racine] = pk
    sys.modules[racine + '.convert'] = cv
    spec = importlib.util.spec_from_file_location(racine + '.convert.flexible_dual_grid', chemin)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def voxel_qui_replie_sur_l_origine(g):
    """(x, y, z) de la grille g dont la cle x*g*g + y*g + z vaut exactement 2^32 (donc 0 en uint32), ou None."""
    x, reste = divmod(2 ** 32, g * g)
    y, z = divmod(reste, g)
    return (x, y, z) if x < g else None


class TestImageModal(unittest.TestCase):
    """modal_app/app.py : les commandes existent, sont transmises telles quelles et sont au bon endroit de mesh_image."""

    @classmethod
    def setUpClass(cls):
        cls.arbre = ast.parse(lire_app())
        cls.cmds = commandes_de_l_app(cls.arbre)

    def test_commandes_definies(self):
        self.assertIsNotNone(self.cmds, 'modal_app/app.py ne definit pas %s : la table de hachage d o_voxel n est pas '
                                        'corrigee dans l image du maillage' % CONSTANTE)
        self.assertEqual(len(self.cmds), 2, 'attendu : (correctif, garde)')

    def test_commandes_transmises_telles_quelles_par_sh(self):
        self.assertIsNotNone(self.cmds, CONSTANTE + ' absent')
        for c in self.cmds:
            code = code_python(c)
            self.assertIsNotNone(code, 'commande hors du gabarit python -c "..." ou contenant $ ` \\ " : %r' % c[:120])
            compile(code, '<commande de construction>', 'exec')

    def test_branchees_apres_o_voxel_et_avant_les_sources(self):
        self.assertIsNotNone(self.cmds, CONSTANTE + ' absent')
        chaine = chaine_mesh_image(self.arbre)
        self.assertTrue(chaine, 'mesh_image introuvable dans modal_app/app.py')

        def indices(pred):
            return [i for i, (nom, appel) in enumerate(chaine) if pred(nom, appel)]
        i_corr = indices(lambda nom, a: nom == 'run_commands' and any(
            isinstance(x, ast.Starred) and isinstance(x.value, ast.Name) and x.value.id == CONSTANTE for x in a.args))
        self.assertEqual(len(i_corr), 1, 'mesh_image doit executer .run_commands(*%s) une fois' % CONSTANTE)
        i_ovoxel = indices(lambda nom, a: nom == 'run_commands' and any(
            'pip install /opt/trellis2_local/o-voxel' in s for s in chaines_de(a)))
        self.assertEqual(len(i_ovoxel), 1, 'installation d o-voxel introuvable dans mesh_image')
        i_sources = indices(lambda nom, a: nom.startswith('add_local_python_source'))
        self.assertTrue(i_sources, 'add_local_python_source introuvable dans mesh_image')
        self.assertGreater(i_corr[0], i_ovoxel[0], 'le correctif doit suivre l installation d o-voxel')
        self.assertLess(i_corr[0], min(i_sources), 'Modal refuse run_commands apres add_local_*')
        # aucune couche n'installe a nouveau o-voxel apres le correctif (il serait efface)
        apres = [s for i, (nom, a) in enumerate(chaine) if i > i_corr[0] for s in chaines_de(a)]
        self.assertFalse([s for s in apres if 'o-voxel' in s or 'o_voxel' in s], 'o-voxel retouche apres le correctif')


@unittest.skipIf(PAS_DE_FDG, RAISON_FDG)
@unittest.skipIf(PAS_DE_TORCH, 'torch absent de ce Python : lancer avec le Python du PATH (torch CPU)')
class TestCorrectifSurCopie(unittest.TestCase):
    """Les deux commandes de l'image, executees telles quelles sur une copie du fichier du fork local."""

    @classmethod
    def setUpClass(cls):
        cmds = commandes_de_l_app(ast.parse(lire_app()))
        if cmds is None:
            raise AssertionError('modal_app/app.py ne definit pas %s : rien a executer' % CONSTANTE)
        cls.correctif, cls.garde = cmds
        cls.origine = lire(FDG)
        if cls.origine.count(CALCUL_ORIGINAL) != 1:
            raise AssertionError('le fichier d o_voxel n a plus le calcul d origine (%s) : revoir le correctif' % FDG)
        cls.tmp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.tmp.cleanup)
        cls.dossier_origine = os.path.join(cls.tmp.name, 'origine')
        cls.fdg_origine = paquet_installe(cls.dossier_origine, cls.origine)
        cls.dossier_corrige = os.path.join(cls.tmp.name, 'corrige')
        cls.fdg_corrige = paquet_installe(cls.dossier_corrige, cls.origine)
        cls.r_correctif = executer(cls.correctif, cls.dossier_corrige)
        cls.corrige = lire(cls.fdg_corrige)

    def test_correctif_reussit_et_ne_change_que_la_ligne_du_volume(self):
        self.assertEqual(self.r_correctif.returncode, 0, self.r_correctif.stderr)
        self.assertIn('CORRECTIF HACHAGE O_VOXEL', self.r_correctif.stdout)
        avant = self.origine.splitlines(keepends=True)
        apres = self.corrige.splitlines(keepends=True)
        self.assertEqual(len(avant), len(apres))
        diff = [i for i, (a, b) in enumerate(zip(avant, apres)) if a != b]
        self.assertEqual(len(diff), 1, 'une seule ligne doit changer')
        ancienne, nouvelle = avant[diff[0]], apres[diff[0]]
        self.assertIn(CALCUL_ORIGINAL, ancienne)
        self.assertNotIn(b'.item()', nouvelle)
        self.assertTrue(nouvelle.startswith(ancienne[:len(ancienne) - len(ancienne.lstrip())] + b'VOL = int('), nouvelle)
        self.assertEqual(ancienne.endswith(b'\r\n'), nouvelle.endswith(b'\r\n'), 'fin de ligne changee')
        self.assertEqual(self.origine.count(b'\r\n'), self.corrige.count(b'\r\n'), 'fins de ligne CRLF non conservees')
        compile(self.corrige, self.fdg_corrige, 'exec')

    def test_echec_bruyant_si_calcul_absent_ou_double(self):
        variantes = {
            'deja_corrige': self.corrige,
            'corrige_autrement_en_amont': self.origine.replace(
                CALCUL_ORIGINAL, b'VOL = int((grid_size[0].long() * grid_size[1] * grid_size[2]).item())'),
            'calcul_en_double': self.origine.replace(CALCUL_ORIGINAL, CALCUL_ORIGINAL + b'; ' + CALCUL_ORIGINAL),
        }
        for nom, contenu in variantes.items():
            with self.subTest(nom):
                dossier = os.path.join(self.tmp.name, 'echec_' + nom)
                chemin = paquet_installe(dossier, contenu)
                r = executer(self.correctif, dossier)
                self.assertNotEqual(r.returncode, 0, 'le correctif doit ARRETER la construction (%s)' % nom)
                self.assertIn('CORRECTIF HACHAGE O_VOXEL', r.stderr)
                self.assertEqual(lire(chemin), contenu, 'fichier modifie malgre l echec (%s)' % nom)

    def test_types_de_cle(self):
        import torch
        origine = charger_fdg(self.fdg_origine, '_ovx_origine')
        corrige = charger_fdg(self.fdg_corrige, '_ovx_corrige')
        for g in GRILLES:
            with self.subTest(grille=g):
                taille = torch.tensor([g, g, g], dtype=torch.int32)
                attendu = torch.uint32 if g <= GRILLE_MAX_UINT32 else torch.uint64
                cles, vals = corrige._init_hashmap(taille, 8, 'cpu')
                self.assertEqual(cles.dtype, attendu)
                self.assertEqual(vals.dtype, torch.uint32)
                # toutes les cles 0 .. g^3 - 1 tiennent sous la sentinelle « vide » (valeur max du type)
                self.assertLess(g ** 3 - 1, torch.iinfo(cles.dtype).max)
                # constat du defaut sur le meme fichier, non corrige : uint32 des 1626
                self.assertEqual(origine._init_hashmap(taille, 8, 'cpu')[0].dtype, torch.uint32,
                                 'le fichier d origine ne montre plus le defaut : o_voxel a change, revoir le correctif')

    def test_cles_du_noyau_cuda_ne_se_replient_plus(self):
        """hash.cu : flat_idx = (size_t)x*H*D + (size_t)y*D + z puis static_cast<K> : modulo 2^bits du type choisi."""
        import torch
        origine = charger_fdg(self.fdg_origine, '_ovx_origine_cles')
        corrige = charger_fdg(self.fdg_corrige, '_ovx_corrige_cles')
        self.assertEqual(voxel_qui_replie_sur_l_origine(2048), (1024, 0, 0))   # « x et x + 1024 » (AGENT_LOG 03/10)
        for g in GRILLES:
            v = voxel_qui_replie_sur_l_origine(g)
            if v is None:
                continue                                                       # g^3 <= 2^32 : rien ne replie
            with self.subTest(grille=g, voxel=v):
                cle = v[0] * g * g + v[1] * g + v[2]
                taille = torch.tensor([g, g, g], dtype=torch.int32)
                bits_origine = torch.iinfo(origine._init_hashmap(taille, 1, 'cpu')[0].dtype).bits
                bits_corrige = torch.iinfo(corrige._init_hashmap(taille, 1, 'cpu')[0].dtype).bits
                self.assertEqual(cle % 2 ** bits_origine, 0, 'avant : ce voxel prend la cle du voxel (0, 0, 0)')
                self.assertNotEqual(cle % 2 ** bits_corrige, 0, 'apres : cles distinctes')

    def test_garde_passe_sur_le_corrige_et_echoue_sur_l_origine(self):
        ok = executer(self.garde, self.dossier_corrige)
        self.assertEqual(ok.returncode, 0, ok.stderr[-2000:])
        self.assertIn('GARDE HACHAGE O_VOXEL OK', ok.stdout)
        for g in (1626, 1792, 2048, 3072, 4096):
            self.assertIn('%d: \'torch.uint64\'' % g, ok.stdout)
        ko = executer(self.garde, self.dossier_origine)
        self.assertNotEqual(ko.returncode, 0, 'la garde doit ARRETER la construction sur le fichier d origine')
        self.assertIn('GARDE HACHAGE O_VOXEL', ko.stderr)
        self.assertIn('2048', ko.stderr)
        self.assertNotIn('o_voxel/__init__.py execute', ok.stderr + ko.stderr)


class TestBureau(unittest.TestCase):
    """Le bureau garde ses grilles <= 1625 : la table de hachage d'origine (cles uint32) y est juste."""

    @staticmethod
    def grille(mode):
        m = re.match(r'(\d+)', mode)
        if not m:
            raise AssertionError('mode inattendu : %r' % mode)
        return int(m.group(1))

    def modes_du_pipeline(self):
        with open(PIPELINE_BUREAU, encoding='utf-8') as f:
            arbre = ast.parse(f.read())
        modes = set()
        for n in ast.walk(arbre):
            if isinstance(n, ast.Assign) and any(isinstance(c, ast.Name) and c.id == '_modes_repli' for c in n.targets):
                repli = ast.literal_eval(n.value)
                modes.update(repli)
                for suite in repli.values():
                    modes.update(suite)
            if (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == 'get' and len(n.args) == 2
                    and isinstance(n.args[0], ast.Constant) and n.args[0].value == 'FABMESH_TRELLIS2_NATIVE_MODE'):
                modes.add(ast.literal_eval(n.args[1]))
        return modes

    def test_aucune_grille_au_dela_de_1625(self):
        modes = self.modes_du_pipeline()
        self.assertIn('1536_cascade', modes, 'modes du bureau introuvables dans %s : revoir ce test' % PIPELINE_BUREAU)
        with open(MAIN_JS, encoding='utf-8') as f:
            demandes = re.findall(r"FABMESH_TRELLIS2_NATIVE_MODE:\s*'([^']*)'", f.read())
        self.assertTrue(demandes, 'modes demandes par src/main/main.js introuvables : revoir ce test')
        for mode in sorted(modes | set(demandes)):
            with self.subTest(mode=mode):
                self.assertLessEqual(
                    self.grille(mode), GRILLE_MAX_UINT32,
                    'le bureau demande la grille %s : la table de hachage d o_voxel (roue du bureau) y replie ses cles. '
                    'Appliquer le correctif a l execution cote bureau (voir modal_app/app.py::%s)' % (mode, CONSTANTE))


if __name__ == '__main__':
    unittest.main()
