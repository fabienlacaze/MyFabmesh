"""Test du telechargement https-seulement cote Modal (constat E-5b / CLOUD-05, 2026-10-03).

Exige :
  - modal_app/_url_sure.py : tout schema autre que https refuse (file, ftp, http, data, vide, sans hote), au
    depart ET a chaque redirection ; le texte rendu au client ne contient jamais l'exception ;
  - modal_app/app.py::_fetch_image (extrait par ast, execute avec io/PIL reels) refuse file:// et http:// SANS
    ouvrir de connexion ;
  - plus aucun `detail=f"... download: {e}"` dans app.py (l'exception ne revient plus au client) ;
  - modal_app/_mesh_op.py ne fait plus de urlopen direct sur les URL d'image.
Aucun appel reseau.

Lancer :  <python de l'appli> build/bancs/noyaux/test_url_sure.py -v
"""
import ast
import io
import os
import re
import sys
import unittest
import urllib.request

RACINE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
sys.path.insert(0, RACINE)


def lire(rel):
    # NOYAU_APP / NOYAU_MESH_OP : autre copie du fichier (preuve d'echec sur l'ancien code : git show HEAD:...)
    autre = os.environ.get({'modal_app/app.py': 'NOYAU_APP', 'modal_app/_mesh_op.py': 'NOYAU_MESH_OP'}.get(rel, 'NOYAU_AUCUN'))
    with open(autre or os.path.join(RACINE, rel), encoding='utf-8') as f:
        return f.read()


class TestUrlSure(unittest.TestCase):
    def setUp(self):
        from modal_app import _url_sure
        self.u = _url_sure

    def test_schemas_refuses(self):
        for url in ('file:///C:/Windows/win.ini', 'file:///etc/passwd', 'ftp://exemple.test/a.png', 'http://exemple.test/a.png',
                    'data:image/png;base64,AAAA', '', '   ', '//exemple.test/a.png', 'https://', 'gopher://x/1', 'HTTP://x/y'):
            with self.assertRaises(self.u.SchemaRefuse, msg=url):
                self.u.exiger_https(url)

    def test_https_accepte(self):
        self.u.exiger_https('https://exemple.test/a.png')
        self.u.exiger_https('HTTPS://Exemple.test/a.png?x=1')
        self.u.exiger_https('  https://exemple.test/a.png  ')

    def test_ouvrir_refuse_avant_toute_connexion(self):
        for url in ('http://127.0.0.1:9/x', 'file:///C:/Windows/win.ini'):
            with self.assertRaises(self.u.SchemaRefuse):
                self.u.ouvrir_https(url, timeout=1)
            with self.assertRaises(self.u.SchemaRefuse):
                self.u.ouvrir_https(urllib.request.Request(url), timeout=1)

    def test_redirection_hors_https_refusee(self):
        gestionnaire = self.u._RedirectionHttps()
        req = urllib.request.Request('https://exemple.test/a')
        for cible in ('file:///etc/passwd', 'http://169.254.169.254/latest', 'ftp://x/y'):
            with self.assertRaises(self.u.SchemaRefuse):
                gestionnaire.redirect_request(req, io.BytesIO(), 302, 'Found', {}, cible)
        suite = gestionnaire.redirect_request(req, io.BytesIO(), 302, 'Found', {}, 'https://autre.test/b')
        self.assertIsNotNone(suite)

    def test_erreur_sans_detail(self):
        texte = self.u.erreur_telechargement('ref', OSError('[Errno 111] connexion refusee 10.0.0.5:8080'))
        self.assertEqual(texte, 'ref download failed')
        self.assertNotIn('10.0.0.5', texte)


class TestSourcesModal(unittest.TestCase):
    def test_fetch_image_de_app_refuse_file_et_http(self):
        arbre = ast.parse(lire('modal_app/app.py'))
        fonction = next(n for n in arbre.body if isinstance(n, ast.FunctionDef) and n.name == '_fetch_image')
        espace = {'io': io}
        exec(compile(ast.Module(body=[fonction], type_ignores=[]), 'app.py', 'exec'), espace)
        from modal_app._url_sure import SchemaRefuse
        for url in ('file:///C:/Windows/win.ini', 'http://127.0.0.1:9/x.png', 'ftp://exemple.test/x.png'):
            with self.assertRaises(SchemaRefuse, msg=url):
                espace['_fetch_image'](url)

    def test_plus_d_exception_dans_les_reponses_de_telechargement(self):
        src = lire('modal_app/app.py')
        restes = re.findall(r'detail=f"[a-z ]*download: \{e\}"', src)
        self.assertEqual(restes, [], 'le texte de l\'exception d\'un telechargement revient encore au client')
        self.assertGreaterEqual(src.count('_erreur_telechargement('), 14)

    def test_mesh_op_sans_urlopen_direct_sur_les_images(self):
        src = lire('modal_app/_mesh_op.py')
        self.assertEqual(len(re.findall(r'urllib\.request\.urlopen\(', src)), 0)
        self.assertGreaterEqual(src.count('ouvrir_https('), 2)


if __name__ == '__main__':
    unittest.main()
