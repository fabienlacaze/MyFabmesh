"""Securite du rig local (2026-10-13) : le serveur Blender du rigger ne doit ecouter QUE cette machine.

Defaut verifie a la source (commit 273b691 installe par le bureau) : src/server/bpy_server.py faisait
`bottle.run(app, host='0.0.0.0', ...)` alors que le corps des requetes est relu par
torch.load(weights_only=False) : pendant un rig, une autre machine du reseau local pouvait faire
executer du code. Correctif : patch_skintokens_transfert.ecoute_locale (noyau partage scripts/ =
modal_app/), appele par appliquer_tout, et skintokens_bridge.py qui REFUSE le rig s'il n'a pas pris.

Lancer :  python build/bancs/noyaux/test_ecoute_bpy_locale.py -v
Autre exemplaire (preuve d'echec sur l'ancien code) : NOYAU_PATCH=<patch_skintokens_transfert.py> PONT=<skintokens_bridge.py>
"""
import ast
import importlib.util
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest

RACINE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
SCRIPTS = os.path.join(RACINE, 'scripts')
PATCH = os.environ.get('NOYAU_PATCH') or os.path.join(SCRIPTS, 'patch_skintokens_transfert.py')
PONT = os.environ.get('PONT') or os.path.join(SCRIPTS, 'skintokens_bridge.py')

# Lignes exactes de l'amont (src/server/bpy_server.py, commit 273b691d35989d71cd17ff2895fdc735097b92d1)
AMONT = ("    def run_server(): bottle.run(app, host='0.0.0.0', port=BPY_PORT, server='tornado')\n"
         "    t = threading.Thread(target=run_server, daemon=True)\n")


def module():
    spec = importlib.util.spec_from_file_location('patch_skintokens_transfert_teste', PATCH)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


class Arbre:
    """Faux depot SkinTokens dans un dossier temporaire."""

    def __init__(self, serveur=None, newline='\n'):
        self.racine = tempfile.mkdtemp(prefix='faux_skintokens_')
        self.serveur = os.path.join(self.racine, 'src', 'server', 'bpy_server.py')
        if serveur is not None:
            os.makedirs(os.path.dirname(self.serveur))
            with open(self.serveur, 'w', encoding='utf-8', newline=newline) as fh:
                fh.write(serveur)

    def lire(self):
        with open(self.serveur, 'rb') as fh:
            return fh.read()

    def fermer(self):
        if os.path.exists(self.serveur):
            os.chmod(self.serveur, stat.S_IWRITE | stat.S_IREAD)
        shutil.rmtree(self.racine, ignore_errors=True)


class TestEcouteLocale(unittest.TestCase):
    def setUp(self):
        self.m = module()
        self.assertTrue(hasattr(self.m, 'ecoute_locale'), 'ecoute_locale absente : ancien code')
        self.arbres = []

    def tearDown(self):
        for a in self.arbres:
            a.fermer()

    def arbre(self, *args, **kw):
        a = Arbre(*args, **kw)
        self.arbres.append(a)
        return a

    def test_forme_amont_corrigee_puis_idempotente(self):
        a = self.arbre(AMONT)
        self.assertEqual(self.m.ecoute_locale(a.racine), 'applique')
        attendu = AMONT.replace("host='0.0.0.0'", "host='127.0.0.1'").encode('utf-8')
        self.assertEqual(a.lire(), attendu)            # seule l'adresse change, le reste a l'octet
        self.assertEqual(self.m.ecoute_locale(a.racine), 'deja')
        self.assertEqual(a.lire(), attendu)

    def test_fins_de_ligne_crlf_conservees(self):
        a = self.arbre(AMONT, newline='\r\n')
        avant = a.lire()
        self.assertEqual(self.m.ecoute_locale(a.racine), 'applique')
        apres = a.lire()
        self.assertEqual(apres.count(b'\r\n'), avant.count(b'\r\n'))
        self.assertEqual(apres.count(b'\n'), apres.count(b'\r\n'))
        self.assertNotIn(b'0.0.0.0', apres)

    def test_guillemets_doubles(self):
        a = self.arbre('bottle.run(app, host="0.0.0.0", port=1)\n')
        self.assertEqual(self.m.ecoute_locale(a.racine), 'applique')
        self.assertEqual(a.lire(), b'bottle.run(app, host="127.0.0.1", port=1)\n')

    def test_forme_inconnue_echec_sans_ecrire(self):
        texte = 'HOTE = "0.0.0.0"\nbottle.run(app, host=HOTE)\n'
        a = self.arbre(texte)
        self.assertEqual(self.m.ecoute_locale(a.racine), 'echec')
        self.assertEqual(a.lire(), texte.encode('utf-8'))

    def test_fichier_non_inscriptible_echec(self):
        a = self.arbre(AMONT)
        os.chmod(a.serveur, stat.S_IREAD)
        self.assertEqual(self.m.ecoute_locale(a.racine), 'echec')
        self.assertEqual(a.lire(), AMONT.encode('utf-8'))

    def test_sans_fichier_serveur(self):
        a = self.arbre(None)
        self.assertEqual(self.m.ecoute_locale(a.racine), 'absent')

    def test_appliquer_tout_ferme_l_ecoute(self):
        # appliquer_tout tourne avant CHAQUE rig du bureau et a l'installation : il doit corriger l'ecoute
        # meme si les autres correctifs n'ont rien trouve (faux arbre sans les autres fichiers).
        a = self.arbre(AMONT)
        self.m.appliquer = lambda racine: 'deja'
        self.m.correctifs_rigger = lambda racine: {}
        resume = self.m.appliquer_tout(a.racine)
        self.assertIn('ecoute locale applique', resume)
        self.assertNotIn(b'0.0.0.0', a.lire())

    def test_build_modal_exige_l_ecoute_locale(self):
        # Au BUILD de l'image Modal (bloc __main__) : un serveur encore ouvert doit faire echouer la construction.
        with open(PATCH, encoding='utf-8') as fh:
            arbre = ast.parse(fh.read())
        principal = [n for n in arbre.body if isinstance(n, ast.If) and 'main' in ast.dump(n.test)]
        self.assertTrue(principal, 'bloc __main__ introuvable')
        appels = [n for n in ast.walk(principal[0]) if isinstance(n, ast.Call)
                  and getattr(n.func, 'id', '') == 'ecoute_locale']
        self.assertTrue(appels, 'le build Modal n appelle pas ecoute_locale')
        self.assertTrue([n for n in ast.walk(principal[0]) if isinstance(n, ast.Assert)
                         and 'ecoute' in ast.dump(n)], 'le build Modal ne verifie pas le resultat')

    @unittest.skipIf(os.environ.get('NOYAU_PATCH'), 'exemplaire externe')
    def test_copie_modal_identique(self):
        with open(os.path.join(SCRIPTS, 'patch_skintokens_transfert.py'), 'rb') as a, \
                open(os.path.join(RACINE, 'modal_app', 'patch_skintokens_transfert.py'), 'rb') as b:
            self.assertEqual(a.read(), b.read())


class TestPontRefuse(unittest.TestCase):
    """skintokens_bridge.py ne lance AUCUN rig si l'ecoute n'a pas pu etre restreinte."""

    def test_rig_refuse_si_ecoute_ouverte(self):
        a = Arbre('HOTE = "0.0.0.0"\nbottle.run(app, host=HOTE)\n')
        try:
            with open(os.path.join(a.racine, 'demo.py'), 'w', encoding='utf-8') as fh:
                fh.write('raise SystemExit(7)\n')        # inerte si l'ancien pont le lancait quand meme
            maillage = os.path.join(a.racine, 'entree.glb')
            with open(maillage, 'wb') as fh:
                fh.write(b'glTF')
            env = dict(os.environ, FABMESH_SKINTOKENS_DIR=a.racine, FABMESH_SKINTOKENS_PY=sys.executable,
                       FABMESH_PARENT_WATCH='0', FABMESH_RIG_COMPLET='0', PYTHONUTF8='1',
                       PYTHONPATH=SCRIPTS + os.pathsep + os.environ.get('PYTHONPATH', ''))
            r = subprocess.run([sys.executable, PONT, maillage, os.path.join(a.racine, 'sortie', 'rig.glb')],
                               capture_output=True, text=True, encoding='utf-8', errors='replace',
                               env=env, timeout=180)
            sortie = r.stdout + r.stderr
            self.assertIn('AUTORIG_ERROR: the local rig server could not be restricted', sortie, sortie[-2000:])
            self.assertEqual(r.returncode, 1, sortie[-2000:])
            self.assertNotIn('exec:', sortie, 'un processus du rig a ete lance malgre l ecoute ouverte')
            self.assertNotIn('SkinTokens', sortie.split('AUTORIG_ERROR', 1)[1], 'nom du moteur dans le message')
        finally:
            a.fermer()


if __name__ == '__main__':
    unittest.main()
