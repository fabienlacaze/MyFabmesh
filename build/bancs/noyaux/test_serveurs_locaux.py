"""Test de la garde des serveurs HTTP locaux du bureau (constat E-4 / D-04, 2026-10-03).

Les trois serveurs (sdxl_server 5555, translate_server 5557, nsfw_server 5558) doivent refuser :
  - une requete dont l'en-tete Host n'est pas 127.0.0.1:<port> ou localhost:<port> (DNS rebinding) ;
  - une requete portant un en-tete Origin (page web) ;
et le serveur d'images doit refuser les chemins reseau (UNC), a octet nul, et l'ecriture en dossier systeme.

Methode : le vrai code des gestionnaires est utilise, sur un port ephemere et sans modele :
  - nsfw_server / translate_server : importes tels quels (imports lourds paresseux), _Handler servi par un
    ThreadingHTTPServer local ;
  - sdxl_server (torch, plafonds memoire a l'import : on ne l'importe pas) : la classe `Handler` est extraite
    par ast du fichier source puis executee avec des doublures pour les fonctions de calcul.
Aucun appel reseau hors 127.0.0.1.

Lancer :  <python de l'appli> build/bancs/noyaux/test_serveurs_locaux.py -v
Variable NOYAU_SCRIPTS : autre dossier de scripts (preuve d'echec sur l'ancien code).
"""
import ast
import http.client
import importlib.util
import json
import os
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

RACINE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
SCRIPTS = os.environ.get('NOYAU_SCRIPTS') or os.path.join(RACINE, 'scripts')
sys.path.insert(0, SCRIPTS)


def charger(nom_fichier):
    spec = importlib.util.spec_from_file_location('srv_' + nom_fichier[:-3], os.path.join(SCRIPTS, nom_fichier))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def servir(classe_handler):
    srv = ThreadingHTTPServer(('127.0.0.1', 0), classe_handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, srv.server_address[1]


def requete(port, methode, chemin, corps=None, host=None, origin=None):
    c = http.client.HTTPConnection('127.0.0.1', port, timeout=5)
    c.putrequest(methode, chemin, skip_host=True)
    c.putheader('Host', host if host is not None else '127.0.0.1:%d' % port)
    if origin is not None:
        c.putheader('Origin', origin)
    donnees = json.dumps(corps).encode() if corps is not None else b'{}'
    c.putheader('Content-Type', 'text/plain')
    c.putheader('Content-Length', str(len(donnees)))
    c.endheaders(donnees if methode == 'POST' else None)
    r = c.getresponse()
    r.read()
    c.close()
    return r.status


class MixinGarde:
    """Verifications communes : /ping legitime passe, Host etranger et Origin sont refuses."""

    def _verifier_garde(self, port, chemin='/ping', methode='GET', corps=None):
        self.assertEqual(requete(port, methode, chemin, corps), 200, 'requete legitime refusee')
        self.assertEqual(requete(port, methode, chemin, corps, host='localhost:%d' % port), 200, 'localhost refuse')
        for host in ('pirate.example:%d' % port, 'pirate.example', '127.0.0.1', '127.0.0.1:1', '127.0.0.1.pirate.example:%d' % port):
            self.assertEqual(requete(port, methode, chemin, corps, host=host), 403, 'Host etranger accepte : ' + host)
        self.assertEqual(requete(port, methode, chemin, corps, origin='http://pirate.example'), 403, 'Origin accepte')
        self.assertEqual(requete(port, methode, chemin, corps, origin='null'), 403, 'Origin null accepte')


class TestNsfw(unittest.TestCase, MixinGarde):
    def test_garde(self):
        m = charger('nsfw_server.py')
        srv, port = servir(m._Handler)
        m.PORT = port
        try:
            self._verifier_garde(port)
            # /shutdown depuis un Host etranger ne doit PAS arreter le serveur (sinon os._exit tuerait ce test)
            self.assertEqual(requete(port, 'POST', '/shutdown', {}, host='pirate.example:%d' % port), 403)
            self.assertEqual(requete(port, 'POST', '/shutdown', {}, origin='http://pirate.example'), 403)
            self.assertEqual(requete(port, 'GET', '/ping'), 200)
        finally:
            srv.shutdown()


class TestTranslate(unittest.TestCase, MixinGarde):
    def test_garde(self):
        m = charger('translate_server.py')
        srv, port = servir(m._Handler)
        m.PORT = port
        try:
            self._verifier_garde(port)
            self.assertEqual(requete(port, 'POST', '/shutdown', {}, host='pirate.example:%d' % port), 403)
            self.assertEqual(requete(port, 'GET', '/ping'), 200)
        finally:
            srv.shutdown()


def classe_handler_sdxl(port):
    """Extrait `class Handler` de sdxl_server.py par ast et l'execute avec des doublures de calcul."""
    chemin = os.path.join(SCRIPTS, 'sdxl_server.py')
    with open(chemin, encoding='utf-8') as f:
        arbre = ast.parse(f.read())
    classe = next(n for n in arbre.body if isinstance(n, ast.ClassDef) and n.name == 'Handler')
    appels = []

    def doublure(nom):
        def f(*a, **k):
            appels.append((nom, a))
            return {'ok': True}
        return f

    class Etat:
        img2img_pipe = inpaint_pipe = controlnet_tile_pipe = controlnet_geo_pipe = clipseg_model = None
        last_use = 0

    espace = {
        'BaseHTTPRequestHandler': BaseHTTPRequestHandler, 'json': json, 'os': os, 'time': __import__('time'),
        'threading': threading, 'traceback': __import__('traceback'), 'PORT': port, 'state': Etat,
        'log': lambda *a, **k: None, '_progression': {'t': 0},
        'vram_used_gb': lambda: 0.0, 'vram_total_gb': lambda: 0.0, 'unload_model': lambda n: None,
        '_cm': type('CM', (), {'texte_erreur': staticmethod(str)}),
    }
    for nom in ('do_img2img', 'do_img2img_tile', 'do_refine_geo', 'do_outfit_cutout', 'do_inpaint', 'do_segment',
                'do_recolor', 'do_tex_variant', 'do_face_fix_image', 'do_mask_inpaint'):
        espace[nom] = doublure(nom)
    # la garde vit dans securite_locale (ancien code : absent -> NameError sur _sl, l'ancien Handler n'en a pas besoin)
    try:
        import securite_locale
        espace['_sl'] = securite_locale
    except ImportError:
        pass
    module = ast.Module(body=[classe], type_ignores=[])
    exec(compile(module, chemin, 'exec'), espace)
    return espace['Handler'], appels


class TestSdxl(unittest.TestCase, MixinGarde):
    def test_garde_hote_et_origine(self):
        # port connu avant la creation du handler : on lie d'abord un serveur provisoire pour reserver le numero
        provisoire = ThreadingHTTPServer(('127.0.0.1', 0), BaseHTTPRequestHandler)
        port = provisoire.server_address[1]
        provisoire.server_close()
        classe, appels = classe_handler_sdxl(port)
        srv = ThreadingHTTPServer(('127.0.0.1', port), classe)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            self._verifier_garde(port)
            corps = {'input': os.path.join(RACINE, 'a.png'), 'output': os.path.join(RACINE, 'b.png')}
            self._verifier_garde(port, '/img2img', 'POST', corps)
            self.assertEqual(requete(port, 'POST', '/shutdown', {}, host='pirate.example:%d' % port), 403)
        finally:
            srv.shutdown()

    def test_chemins(self):
        provisoire = ThreadingHTTPServer(('127.0.0.1', 0), BaseHTTPRequestHandler)
        port = provisoire.server_address[1]
        provisoire.server_close()
        classe, appels = classe_handler_sdxl(port)
        srv = ThreadingHTTPServer(('127.0.0.1', port), classe)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        sortie = os.path.join(RACINE, 'b.png')
        entree = os.path.join(RACINE, 'a.png')
        windir = os.environ.get('WINDIR', 'C:\\Windows')
        try:
            # chemin reseau en lecture : fuite du hachage NTLM
            self.assertEqual(requete(port, 'POST', '/img2img', {'input': '\\\\pirate.example\\partage\\x.png', 'output': sortie}), 403)
            self.assertEqual(requete(port, 'POST', '/img2img', {'input': '//pirate.example/partage/x.png', 'output': sortie}), 403)
            self.assertEqual(requete(port, 'POST', '/img2img', {'input': entree + '\x00.png', 'output': sortie}), 403)
            # ecriture en dossier systeme
            self.assertEqual(requete(port, 'POST', '/img2img', {'input': entree, 'output': os.path.join(windir, 'x.png')}), 403)
            self.assertEqual(requete(port, 'POST', '/outfit_cutout', {'input': entree, 'output_dir': os.path.join(windir, 'System32')}), 403)
            self.assertEqual(appels, [], 'un calcul a ete lance malgre un chemin refuse')
            # chemins legitimes, y compris `ref` vide ou absent
            self.assertEqual(requete(port, 'POST', '/img2img', {'input': entree, 'output': sortie}), 200)
            self.assertEqual(requete(port, 'POST', '/refine_geo',
                                     {'input': entree, 'control': entree, 'ref': '', 'output': sortie}), 200)
            self.assertEqual(requete(port, 'POST', '/refine_geo',
                                     {'input': entree, 'control': entree, 'ref': None, 'output': sortie}), 200)
            self.assertEqual(len(appels), 3)
        finally:
            srv.shutdown()


class TestSecuriteLocale(unittest.TestCase):
    def setUp(self):
        import securite_locale
        self.sl = securite_locale

    def test_chemins(self):
        ok = self.sl.chemin_acceptable
        self.assertTrue(ok('C:\\Users\\moi\\Documents\\projet\\a.png')[0])
        self.assertTrue(ok('D:\\donnees\\a.png', ecriture=True)[0])
        self.assertFalse(ok('\\\\serveur\\partage\\a.png')[0])
        self.assertFalse(ok('\\\\?\\C:\\a.png')[0])
        self.assertFalse(ok('a\x00b')[0])
        self.assertFalse(ok('')[0])
        self.assertFalse(ok(None)[0])
        self.assertFalse(ok(123)[0])
        if os.name == 'nt':
            self.assertFalse(ok(os.path.join(os.environ.get('WINDIR', 'C:\\Windows'), 'a.png'), ecriture=True)[0])
            self.assertTrue(ok(os.path.join(os.environ.get('WINDIR', 'C:\\Windows'), 'a.png'), ecriture=False)[0])


if __name__ == '__main__':
    unittest.main()
