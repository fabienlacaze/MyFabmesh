"""Helper `_rendre_glb` de modal_app/app.py : televersement direct du GLB vers une URL PUT pre-signee, repli base64 (25/10)."""
import ast
import base64
import http.server
import os
import threading
import unittest

RACINE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))


def _charger():
    src = open(os.path.join(RACINE, 'modal_app', 'app.py'), encoding='utf-8').read()
    arbre = ast.parse(src)
    for n in arbre.body:
        if isinstance(n, ast.FunctionDef) and n.name == '_rendre_glb':
            ns = {}
            exec(compile(ast.Module([n], []), 'app.py', 'exec'), ns)
            return ns['_rendre_glb']
    raise AssertionError('_rendre_glb introuvable')


class _Serveur:
    def __init__(self, code=200):
        self.recu = None
        self.code = code
        outer = self

        class H(http.server.BaseHTTPRequestHandler):
            def do_PUT(self):
                n = int(self.headers.get('Content-Length', 0))
                outer.recu = (self.path, self.rfile.read(n), self.headers.get('Content-Type'))
                self.send_response(outer.code); self.end_headers()

            def log_message(self, *a):
                pass
        self.srv = http.server.HTTPServer(('127.0.0.1', 0), H)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.url = f'http://127.0.0.1:{self.srv.server_port}/cle.glb?sig=x'

    def fin(self):
        self.srv.shutdown(); self.srv.server_close()


class Test(unittest.TestCase):
    def test_televerse_et_ne_rend_pas_le_base64(self):
        f = _charger(); s = _Serveur()
        try:
            r = f(b'GLB' * 1000, {'r2_put_url': s.url}, op_type='region_retex')
        finally:
            s.fin()
        self.assertTrue(r['uploaded']); self.assertEqual(r['bytes'], 3000); self.assertEqual(r['op_type'], 'region_retex')
        self.assertNotIn('glb_base64', r)
        self.assertEqual(s.recu[1], b'GLB' * 1000); self.assertEqual(s.recu[2], 'model/gltf-binary')

    def test_sans_url_base64_comme_avant(self):
        r = _charger()(b'abc', {}, op_type='x')
        self.assertEqual(base64.b64decode(r['glb_base64']), b'abc'); self.assertNotIn('uploaded', r)

    def test_televersement_refuse_repli_base64(self):
        f = _charger(); s = _Serveur(code=403)
        try:
            r = f(b'abc', {'r2_put_url': s.url})
        finally:
            s.fin()
        self.assertEqual(base64.b64decode(r['glb_base64']), b'abc')

    def test_serveur_injoignable_repli_base64(self):
        r = _charger()(b'abc', {'r2_put_url': 'http://127.0.0.1:9/x'})
        self.assertEqual(base64.b64decode(r['glb_base64']), b'abc')


if __name__ == '__main__':
    unittest.main()
