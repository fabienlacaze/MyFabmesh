"""Lucida dans les images Modal (2026-10-14) : modal_app/app.py cuit les poids de Lucida avec revision et SHA-256 epingles.

POURQUOI. modal_app/_detourage.py fait de Lucida un detoureur FACULTATIF (masque = UNION avec u2net) : sans poids dans l'image, il se
replie sur u2net seul et RIEN n'est gagne. Le diff d'app.py qui les cuit n'avait jamais ete ecrit (revue 2 de la sous-piste union :
« livrable absent »). Ce test prouve, SANS reseau, SANS GPU, SANS poids charges en memoire, SANS aucune installation :

  1. app.py definit _LUCIDA_DIR et _LUCIDA_DANS_L_IMAGE (2 commandes) : le depot, UNE revision de 40 chiffres hexadecimaux, le dossier
     local, les quatre fichiers demandes (config, code distant x2, poids), et une empreinte SHA-256 (64 chiffres) PAR fichier ;
     la commande Python est transmissible telle quelle par /bin/sh (ni $, ni accent grave, ni barre oblique inverse, ni guillemet double) ;
  2. l'image du conteneur IMAGE (`image_backview`) = l'image d'avant + ces commandes + FABMESH_LUCIDA_DIR, derivee AVANT les sources locales
     (add_local_* en dernier) ; MyFabmeshBackview l'utilise ; `image` et `predictor_image` (text2image, qui ne detoure pas) ne portent PAS
     les 844 Mo ; l'image du maillage les cuit AVANT les poids d'edition et son dernier appel reste add_local_python_source ;
  3. les commandes, EXECUTEES telles quelles (huggingface_hub remplace par une doublure qui range les fichiers du cache local de la machine
     dans le dossier demande ; /opt/lucida remplace par un dossier temporaire, seule substitution), produisent un dossier que le chargeur du
     bureau ET celui de Modal reconnaissent, et `sha256sum -c` passe ; elles ECHOUENT (code non nul : la construction de l'image s'arrete)
     si un fichier change, manque ou si une empreinte est fausse ;
  4. les empreintes et la revision epinglees sont celles des fichiers du cache local (saute si la machine n'a pas les poids).

Aucun poids n'est charge en memoire (les fichiers sont lus par sha256sum et par hashlib, jamais par torch ni safetensors).

Lancer :  <python de l'appli> build/bancs/noyaux/test_lucida_image_modal.py -v
Preuve d'echec sur l'ancien app.py : NOYAU_APP=<copie de l'ancien modal_app/app.py> (git show <rev>:modal_app/app.py).
Dossier source des quatre fichiers : LUCIDA_CACHE_LOCAL=<snapshots/<revision>> ; par defaut le cache Hugging Face de l'utilisateur.
"""
import ast
import hashlib
import importlib.util
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

RACINE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
APP = os.environ.get('NOYAU_APP') or os.path.join(RACINE, 'modal_app', 'app.py')
MATTE = os.path.join(RACINE, 'scripts', 'lucida_matte.py')
DETOURAGE = os.path.join(RACINE, 'modal_app', '_detourage.py')

DEPOT = 'egeorcun/lucida'
FICHIERS = ('config.json', 'birefnet.py', 'BiRefNet_config.py', 'model.safetensors')
CONSTANTE = '_LUCIDA_DANS_L_IMAGE'
# RUN de l'image = /bin/sh -c '<commande>'. Entre guillemets doubles, sh n'interprete que $, ` et \ (et le guillemet double qui ferme) :
# un code qui n'en contient aucun arrive tel quel dans sys.argv de Python.
COMMANDE_SH = re.compile(r'python -c "([^"$`\\]*)"')
HEX40 = re.compile(r'^[0-9a-f]{40}$')
HEX64 = re.compile(r'^[0-9a-f]{64}$')


def lire_app():
    with open(APP, encoding='utf-8') as f:
        return f.read()


ARBRE = ast.parse(lire_app(), APP)


def affectation(nom):
    """Le noeud ast de `nom = ...` au premier niveau de app.py (le DERNIER si plusieurs), ou None."""
    trouve = None
    for n in ARBRE.body:
        if isinstance(n, ast.Assign) and any(isinstance(c, ast.Name) and c.id == nom for c in n.targets):
            trouve = n
    return trouve


def valeur_litterale(nom):
    n = affectation(nom)
    return None if n is None else ast.literal_eval(n.value)


def chaine_d_appels(noeud):
    """Appels de methode d'une chaine `a.b(...).c(...)` dans l'ordre d'execution : [(nom, ast.Call), ...] et la base (ast)."""
    appels = []
    n = noeud
    while isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute):
        appels.append((n.func.attr, n))
        n = n.func.value
    return list(reversed(appels)), n


def chaine_de(nom):
    n = affectation(nom)
    if n is None:
        return None, None
    return chaine_d_appels(n.value)


def noms_utilises(noeud):
    return {x.id for x in ast.walk(noeud) if isinstance(x, ast.Name)}


def commandes():
    return valeur_litterale(CONSTANTE)


def code_python(commande):
    m = COMMANDE_SH.fullmatch(commande)
    return m.group(1) if m else None


def dossier_cache_local():
    """Dossier snapshots/<revision> du cache de la machine qui contient les quatre fichiers, ou None."""
    explicite = os.environ.get('LUCIDA_CACHE_LOCAL')
    candidats = [explicite] if explicite else []
    bases = [os.path.join(os.path.expanduser('~'), '.cache', 'huggingface', 'hub')]
    for var in ('HF_HUB_CACHE', 'HUGGINGFACE_HUB_CACHE'):
        if os.environ.get(var):
            bases.insert(0, os.environ[var])
    if os.environ.get('HF_HOME'):
        bases.insert(0, os.path.join(os.environ['HF_HOME'], 'hub'))
    for hub in bases:
        snaps = os.path.join(hub, 'models--egeorcun--lucida', 'snapshots')
        try:
            candidats += [os.path.join(snaps, s) for s in sorted(os.listdir(snaps))]
        except OSError:
            pass
    for d in candidats:
        if d and all(os.path.isfile(os.path.join(d, f)) and os.path.getsize(os.path.join(d, f)) > 0 for f in FICHIERS):
            return d
    return None


CACHE = dossier_cache_local()
SH = shutil.which('sh')
SANS_CACHE = 'poids de Lucida absents du cache local (LUCIDA_CACHE_LOCAL ou ~/.cache/huggingface/hub) : test saute'


def empreintes_epinglees():
    """{fichier: sha256} lu dans la deuxieme commande (printf '%s  %s\\n' '<sha>' <fichier> ...)."""
    cmd = commandes()[1]
    m = re.search(r"printf '%s  %s\\n' (.*?) \| sha256sum -c -", cmd)
    assert m, 'format inattendu de la commande de verification : %r' % cmd
    mots = re.findall(r"'([0-9a-f]+)' (\S+)", m.group(1))
    return {nom: sha for sha, nom in mots}


def revision_epinglee():
    m = re.search(r"revision='([^']*)'", commandes()[0])
    return m.group(1) if m else None


def sha256(chemin):
    h = hashlib.sha256()
    with open(chemin, 'rb') as f:
        for bloc in iter(lambda: f.read(1 << 22), b''):
            h.update(bloc)
    return h.hexdigest()


# ---------------------------------------------------------------------------
# 1. Ce que app.py definit
# ---------------------------------------------------------------------------
class TestDefinition(unittest.TestCase):
    def test_les_constantes_existent(self):
        self.assertEqual(valeur_litterale('_LUCIDA_DIR'), '/opt/lucida')
        cmds = commandes()
        self.assertIsInstance(cmds, tuple)
        self.assertEqual(len(cmds), 2, 'telechargement puis verification des empreintes')
        for c in cmds:
            self.assertIsInstance(c, str)

    def test_telechargement_du_bon_depot_a_la_revision_epinglee_dans_le_dossier_local(self):
        cmd = commandes()[0]
        self.assertIn("snapshot_download('%s'" % DEPOT, cmd)
        self.assertRegex(revision_epinglee() or '', HEX40, 'UNE revision de 40 chiffres hexadecimaux (pas main, pas une branche)')
        self.assertIn("local_dir='%s'" % valeur_litterale('_LUCIDA_DIR'), cmd, 'dossier local = _LUCIDA_DIR (pas le cache HF)')

    def test_les_quatre_fichiers_sont_demandes(self):
        cmd = commandes()[0]
        m = re.search(r'allow_patterns=\[([^\]]*)\]', cmd)
        self.assertTrue(m, 'allow_patterns attendu')
        demandes = set(re.findall(r"'([^']+)'", m.group(1)))
        self.assertEqual(demandes, set(FICHIERS))

    def test_une_empreinte_sha256_par_fichier_toutes_differentes(self):
        e = empreintes_epinglees()
        self.assertEqual(set(e), set(FICHIERS))
        for nom, sha in e.items():
            self.assertRegex(sha, HEX64, nom)
        self.assertEqual(len(set(e.values())), len(FICHIERS), 'deux fichiers ne partagent pas une empreinte')

    def test_verification_dans_le_dossier_local_et_qui_echoue_si_une_empreinte_differe(self):
        cmd = commandes()[1]
        self.assertTrue(cmd.startswith('cd %s && ' % valeur_litterale('_LUCIDA_DIR')))
        self.assertTrue(cmd.endswith('| sha256sum -c -'), 'sha256sum -c rend un code non nul : la construction de l\'image s\'arrete')

    def test_la_commande_python_est_transmissible_telle_quelle_par_sh(self):
        code = code_python(commandes()[0])
        self.assertIsNotNone(code, 'ni $, ni accent grave, ni barre oblique inverse, ni guillemet double dans le code Python')
        compile(code, '<RUN>', 'exec')

    def test_aucun_secret_ni_chemin_personnel(self):
        texte = ' '.join(commandes())
        for interdit in ('hf_', 'HF_TOKEN', 'Users', 'Utilisateur', 'C:\\'):
            self.assertNotIn(interdit, texte)


# ---------------------------------------------------------------------------
# 2. Quelles images portent les poids
# ---------------------------------------------------------------------------
class TestImages(unittest.TestCase):
    def test_image_backview_est_l_image_d_avant_plus_lucida_et_la_variable(self):
        appels, base = chaine_de('image_backview')
        self.assertIsNotNone(appels, 'image_backview doit exister (le banc modal_app/test_lucida_union.py la cherche par ce nom)')
        # image_backview = _avec_sources(image.run_commands(*_LUCIDA_DANS_L_IMAGE).env({...}))
        n = affectation('image_backview').value
        self.assertIsInstance(n, ast.Call)
        self.assertEqual(n.func.id, '_avec_sources', 'les sources locales viennent EN DERNIER (regle de Modal)')
        interne, base = chaine_d_appels(n.args[0])
        self.assertIsInstance(base, ast.Name)
        self.assertEqual(base.id, 'image', 'derivee de l\'image du conteneur image : rien d\'autre n\'est reconstruit')
        self.assertEqual([nom for nom, _ in interne], ['run_commands', 'env'], 'poids PUIS variable, en fin de chaine')
        run = interne[0][1]
        self.assertEqual(len(run.args), 1)
        self.assertIsInstance(run.args[0], ast.Starred)
        self.assertEqual(run.args[0].value.id, CONSTANTE)
        env = interne[1][1].args[0]
        self.assertIsInstance(env, ast.Dict)
        self.assertEqual([k.value for k in env.keys], ['FABMESH_LUCIDA_DIR'])
        self.assertEqual(env.values[0].id, '_LUCIDA_DIR', 'la variable pointe le dossier ou les commandes ont depose les fichiers')

    def test_image_backview_est_definie_avant_l_image_finale_et_apres_celle_du_generateur_d_images(self):
        ligne = {n: affectation(n).lineno for n in ('predictor_image', 'image_backview')}
        finale = [x.lineno for x in ARBRE.body if isinstance(x, ast.Assign)
                  and any(isinstance(c, ast.Name) and c.id == 'image' for c in x.targets)]
        self.assertGreater(ligne['image_backview'], ligne['predictor_image'])
        self.assertLess(ligne['image_backview'], max(finale), 'derivee de `image` AVANT sa derniere affectation (avec les sources)')

    def test_l_image_commune_et_celle_du_generateur_d_images_ne_portent_pas_lucida(self):
        # predictor_image (text2image) et `image` (fonctions CPU du routeur : app = modal.App(image=image)) ne detourent pas
        for nom in ('predictor_image',):
            self.assertNotIn(CONSTANTE, noms_utilises(affectation(nom).value), nom)
        for n in ARBRE.body:
            if isinstance(n, ast.Assign) and any(isinstance(c, ast.Name) and c.id == 'image' for c in n.targets):
                self.assertNotIn(CONSTANTE, noms_utilises(n.value))
                self.assertNotIn('_LUCIDA_DIR', noms_utilises(n.value))

    def _classe(self, nom):
        for n in ARBRE.body:
            if isinstance(n, ast.ClassDef) and n.name == nom:
                return n
        self.fail('classe %s absente' % nom)

    def _argument_image(self, classe):
        for d in classe.decorator_list:
            if isinstance(d, ast.Call):
                for k in d.keywords:
                    if k.arg == 'image':
                        return k.value
        return None

    def test_le_conteneur_image_utilise_l_image_avec_lucida(self):
        a = self._argument_image(self._classe('MyFabmeshBackview'))
        self.assertIsNotNone(a, 'MyFabmeshBackview doit nommer son image : sans cela elle prend celle de l\'application')
        self.assertEqual(a.id, 'image_backview')

    def test_les_autres_classes_gardent_leur_image(self):
        self.assertEqual(self._argument_image(self._classe('MyFabmeshPredictor')).id, 'predictor_image')
        self.assertEqual(self._argument_image(self._classe('MyFabmeshMesh')).id, 'mesh_image')

    def test_l_image_du_maillage_cuit_lucida_avant_les_poids_d_edition_et_finit_par_les_sources(self):
        appels, base = chaine_de('mesh_image')
        noms = [nom for nom, _ in appels]
        self.assertEqual(noms[-1], 'add_local_python_source', 'les sources locales restent EN DERNIER (regle de Modal)')
        indices = [i for i, (nom, c) in enumerate(appels) if nom == 'run_commands'
                   and any(isinstance(a, ast.Starred) and getattr(a.value, 'id', '') == CONSTANTE for a in c.args)]
        self.assertEqual(len(indices), 1, 'les poids de Lucida sont cuits UNE fois dans l\'image du maillage')
        i = indices[0]
        self.assertEqual(noms[i + 1], 'env', 'la variable suit immediatement les poids')
        env = appels[i + 1][1].args[0]
        self.assertEqual([k.value for k in env.keys], ['FABMESH_LUCIDA_DIR'])
        self.assertEqual(env.values[0].id, '_LUCIDA_DIR')

        def chaines(c):
            # chaines des ARGUMENTS seulement : `c.func` contient tous les appels precedents de la chaine
            return [x.value for a in list(c.args) + [k.value for k in c.keywords] for x in ast.walk(a)
                    if isinstance(x, ast.Constant) and isinstance(x.value, str)]
        trellis = [k for k, (nom, c) in enumerate(appels) if any('microsoft/TRELLIS.2-4B' in s for s in chaines(c))]
        edition = [k for k, (nom, c) in enumerate(appels) if any('SG161222/RealVisXL_V4.0' in s for s in chaines(c))]
        self.assertTrue(trellis and edition)
        self.assertGreater(i, max(trellis), 'apres les 17 Go du maillage : ils ne sont pas reconstruits')
        self.assertLess(i, min(edition), 'avant les poids d\'edition : seuls ceux-la sont reconstruits')

    def test_le_nom_de_la_variable_est_celui_que_lit_le_detoureur_modal(self):
        with open(DETOURAGE, encoding='utf-8') as f:
            self.assertIn('FABMESH_LUCIDA_DIR', f.read())


# ---------------------------------------------------------------------------
# 3. Les commandes, executees telles quelles
# ---------------------------------------------------------------------------
DOUBLURE_HF = '''
import fnmatch, os, shutil, sys


def snapshot_download(repo_id, revision=None, local_dir=None, allow_patterns=None, **kw):
    """Doublure de huggingface_hub : controle les arguments EPINGLES, puis range les fichiers du cache local dans local_dir."""
    if repo_id != os.environ["STUB_DEPOT"]:
        sys.exit("DOUBLURE : depot inattendu %r" % (repo_id,))
    if revision != os.environ["STUB_REVISION"]:
        sys.exit("DOUBLURE : revision inattendue %r" % (revision,))
    if not local_dir:
        sys.exit("DOUBLURE : local_dir manquant")
    src = os.environ["STUB_SOURCE"]
    os.makedirs(local_dir, exist_ok=True)
    for nom in sorted(os.listdir(src)):
        if allow_patterns is not None and not any(fnmatch.fnmatch(nom, p) for p in allow_patterns):
            continue
        reel = os.path.realpath(os.path.join(src, nom))
        cible = os.path.join(local_dir, nom)
        try:
            os.link(reel, cible)           # meme volume : instantane, aucune lecture
        except OSError:
            shutil.copyfile(reel, cible)
    return local_dir
'''


@unittest.skipIf(CACHE is None, SANS_CACHE)
@unittest.skipIf(SH is None, 'sh introuvable : les commandes de l\'image ne peuvent pas etre executees')
class TestExecutionDesCommandes(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='lucida_image_')
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.dossier = os.path.join(self.tmp, 'opt_lucida').replace('\\', '/')
        self.doublure = os.path.join(self.tmp, 'doublure')
        os.makedirs(os.path.join(self.doublure, 'huggingface_hub'))
        with open(os.path.join(self.doublure, 'huggingface_hub', '__init__.py'), 'w', encoding='utf-8') as f:
            f.write(DOUBLURE_HF)
        if ' ' in self.dossier:
            self.skipTest('chemin temporaire avec une espace : la substitution de /opt/lucida ne serait plus fidele')

    def local(self, commande):
        """La commande de l'image avec /opt/lucida remplace par le dossier temporaire : SEULE substitution."""
        dossier = valeur_litterale('_LUCIDA_DIR')
        self.assertIn(dossier, commande)
        return commande.replace(dossier, self.dossier)

    def telecharger(self, revision=None):
        code = code_python(self.local(commandes()[0]))
        self.assertIsNotNone(code)
        code = 'import sys; sys.path.insert(0, %r); %s' % (self.doublure, code)      # le Python de l'appli ignore PYTHONPATH (._pth)
        env = dict(os.environ, STUB_DEPOT=DEPOT, STUB_REVISION=revision or revision_epinglee(), STUB_SOURCE=CACHE,
                   PYTHONIOENCODING='utf-8', PYTHONDONTWRITEBYTECODE='1')
        return subprocess.run([sys.executable, '-c', code], env=env, capture_output=True, encoding='utf-8', errors='replace',
                              timeout=300)

    def verifier(self, commande=None):
        return subprocess.run([SH, '-c', self.local(commande or commandes()[1])], capture_output=True, encoding='utf-8',
                              errors='replace', timeout=600)

    def test_telechargement_puis_verification_reussissent_et_donnent_un_dossier_complet(self):
        r = self.telecharger()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(sorted(os.listdir(self.dossier)), sorted(FICHIERS), 'exactement les quatre fichiers (allow_patterns)')
        r = self.verifier()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        for nom in FICHIERS:
            self.assertIn('%s: OK' % nom, r.stdout)

    def test_le_dossier_produit_est_reconnu_par_le_chargeur_du_bureau_et_par_celui_de_modal(self):
        self.assertEqual(self.telecharger().returncode, 0)
        spec = importlib.util.spec_from_file_location('lucida_matte_image_sous_test', MATTE)
        matte = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(matte)
        self.assertTrue(matte._dossier_complet(self.dossier), 'noms de fichiers attendus par scripts/lucida_matte.py')
        dossier, origine = matte.trouver_poids(env={'FABMESH_LUCIDA_DIR': self.dossier}, home=self.tmp)
        self.assertEqual((os.path.normcase(dossier), origine), (os.path.normcase(self.dossier), 'FABMESH_LUCIDA_DIR'))
        # Modal : _source_lucida charge le dossier PAR SON CHEMIN, hors ligne, sans revision
        spec = importlib.util.spec_from_file_location('detourage_image_sous_test', DETOURAGE)
        det = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(det)
        os.environ['FABMESH_LUCIDA_DIR'] = self.dossier
        try:
            source, options = det._source_lucida()
        finally:
            os.environ.pop('FABMESH_LUCIDA_DIR', None)
        self.assertEqual(source, self.dossier)
        self.assertTrue(options['local_files_only'])
        self.assertNotIn('revision', options)

    def test_une_mauvaise_revision_arrete_la_construction(self):
        r = self.telecharger(revision='0' * 40)
        self.assertNotEqual(r.returncode, 0, 'la doublure refuse toute revision autre que celle de app.py : preuve que app.py la transmet')
        self.assertIn('revision inattendue', r.stdout + r.stderr)

    def test_un_fichier_modifie_arrete_la_construction(self):
        self.assertEqual(self.telecharger().returncode, 0)
        cible = os.path.join(self.dossier, 'birefnet.py')
        os.remove(cible)                                     # sans toucher au fichier du cache (lien physique)
        shutil.copyfile(os.path.join(CACHE, 'birefnet.py'), cible)
        with open(cible, 'ab') as f:
            f.write(b'\n# code distant modifie\n')
        r = self.verifier()
        self.assertNotEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn('birefnet.py: FAILED', r.stdout)

    def test_des_poids_remplaces_arretent_la_construction(self):
        self.assertEqual(self.telecharger().returncode, 0)
        cible = os.path.join(self.dossier, 'model.safetensors')
        os.remove(cible)
        with open(cible, 'wb') as f:
            f.write(b'pas les poids')
        r = self.verifier()
        self.assertNotEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn('model.safetensors: FAILED', r.stdout)

    def test_un_fichier_manquant_arrete_la_construction(self):
        self.assertEqual(self.telecharger().returncode, 0)
        os.remove(os.path.join(self.dossier, 'BiRefNet_config.py'))
        r = self.verifier()
        self.assertNotEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_une_empreinte_fausse_arrete_la_construction(self):
        self.assertEqual(self.telecharger().returncode, 0)
        cmd = commandes()[1]
        premiere = next(iter(empreintes_epinglees().values()))
        faux = ('1' if premiere[0] != '1' else '2') + premiere[1:]
        r = self.verifier(cmd.replace(premiere, faux))
        self.assertNotEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn('FAILED', r.stdout)


# ---------------------------------------------------------------------------
# 4. Les valeurs epinglees sont celles des fichiers de la machine
# ---------------------------------------------------------------------------
@unittest.skipIf(CACHE is None, SANS_CACHE)
class TestEmpreintesCorrespondentAuCache(unittest.TestCase):
    def test_chaque_empreinte_epinglee_est_celle_du_fichier_du_cache(self):
        for nom, attendu in empreintes_epinglees().items():
            with self.subTest(fichier=nom):
                self.assertEqual(sha256(os.path.realpath(os.path.join(CACHE, nom))), attendu)

    def test_la_revision_epinglee_est_celle_d_un_instantane_du_cache(self):
        hub = os.path.dirname(CACHE)
        self.assertIn(revision_epinglee(), os.listdir(hub), 'la revision epinglee n\'est pas un instantane de cette machine')


if __name__ == '__main__':
    unittest.main()
