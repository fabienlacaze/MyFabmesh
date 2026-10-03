#!/usr/bin/env python
"""Persistent translation server — loads Argos Translate ONCE and serves
translations over localhost HTTP, so the desktop doesn't re-import argos
(~5 s, incl. stanza/torch CPU) on every prompt. CPU-only. Lightweight
(~150 MB RAM, no GPU). main.js spawns it and kills it on quit.

  POST /translate  {"text": "...", "from": "fr"}  -> {"text": "..."}
                   (+ "pending": true quand le modele de cette langue se
                    telecharge : texte rendu tel quel, a ne pas garder en cache)
  GET  /ping       -> {"ok": true}
  POST /shutdown   -> exits
"""
import os
import sys
import json
import threading
import time
import importlib.util

# Python EMBARQUE (fichier ._pth) : le dossier du script n'est pas dans sys.path -> `import translate_prompt`, et `minisbd`
# (remplacant neutre de scripts/minisbd, importe par argostranslate au chargement) (2026-09-30).
_ICI = os.path.dirname(os.path.abspath(__file__))
if _ICI not in sys.path:
    sys.path.insert(0, _ICI)

# No GPU -> torch (pulled in by some Argos language packages via stanza) imports
# fast instead of paying the ~20 s CUDA init.
os.environ.setdefault("CUDA_VISIBLE_DEVICES", "")
os.environ.setdefault("CT2_FORCE_CPU", "1")
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("FABMESH_TRANSLATE_PORT", "5557"))
_lock = threading.Lock()

# MODELE ABSENT -> TELECHARGEMENT EN TACHE DE FOND (2026-09-30, audit de l'installation de zero). L'assistant ne pose que les
# modeles des langues du systeme ; une autre langue choisie ensuite (ou un modele dont le telechargement a echoue) se
# telecharge ici, UNE fois, sans bloquer : pendant ce temps le texte est rendu tel quel avec pending=True. Nouvel essai
# autorise 10 min apres un echec (reseau coupe).
_installs = {}                  # (src, dst) -> 'en_cours' | heure de l'echec
_installs_lock = threading.Lock()


def _installer_en_fond(src, dst):
    with _installs_lock:
        etat = _installs.get((src, dst))
        if etat == 'en_cours' or (isinstance(etat, float) and time.time() - etat < 600):
            return
        _installs[(src, dst)] = 'en_cours'

    def _travail():
        ok = False
        try:
            import translate_prompt
            ok = translate_prompt.installer_paquet(src, dst)
        except Exception as e:
            sys.stderr.write(f"[translate-server] model {src}->{dst} download failed: {e}\n")
        with _installs_lock:
            if ok:
                _installs.pop((src, dst), None)
            else:
                _installs[(src, dst)] = time.time()
        sys.stderr.write(f"[translate-server] model {src}->{dst} {'installed' if ok else 'unavailable'}\n")

    threading.Thread(target=_travail, daemon=True).start()


def _translate(text, src, dst="en"):
    """Rend (texte, en_attente). en_attente=True : pas de modele pour cette paire, il se telecharge (texte d'origine rendu)."""
    src = (src or "en").lower()
    dst = (dst or "en").lower()
    if src == dst or not text.strip():
        return text, False
    # Serialize argos access (ctranslate2 model is not re-entrant) — the cost we
    # avoid is the IMPORT/LOAD, which happens once on the first call.
    with _lock:
        from argostranslate import translate as _t
        try:
            out = _t.translate(text, src, dst)
            if out:
                return out, False
        except Exception:
            pass
        langs = _t.get_installed_languages()
        from_lang = next((l for l in langs if l.code == src), None)
        to_lang = next((l for l in langs if l.code == dst), None)
        if from_lang and to_lang:
            tr = from_lang.get_translation(to_lang)
            if tr:
                return (tr.translate(text) or text), False
    _installer_en_fond(src, dst)
    return text, True  # no package for this pair yet -> fail open (return source)


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):  # silence per-request access logging
        pass

    def _send(self, obj, code=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _garde(self):
        # 2026-10-03 (constat D-04) : Host different de 127.0.0.1:<port> / localhost:<port> (DNS rebinding) ou
        # en-tete Origin (page web ; aucun navigateur n'appelle ce serveur) -> 403. Voir securite_locale.py.
        import securite_locale
        ok, raison = securite_locale.requete_autorisee(self.headers, PORT)
        if not ok:
            sys.stderr.write("[translate-server] requete refusee (%s)" % raison + chr(10))
            self._send({"error": "forbidden"}, 403)
        return ok

    def do_GET(self):
        if not self._garde():
            return
        if self.path == "/ping":
            self._send({"ok": True})
        else:
            self._send({"error": "not found"}, 404)

    def do_POST(self):
        if not self._garde():
            return
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b"{}"
        try:
            req = json.loads(raw or b"{}")
        except Exception:
            req = {}
        if self.path == "/shutdown":
            self._send({"ok": True})
            threading.Thread(target=lambda: (time.sleep(0.2), os._exit(0)),
                             daemon=True).start()
            return
        if self.path == "/translate":
            text = req.get("text") or ""
            try:
                out, attente = _translate(text, req.get("from") or "en", req.get("to") or "en")
                self._send({"text": out, "pending": True} if attente else {"text": out})
            except Exception as e:
                sys.stderr.write(f"[translate-server] error: {e}\n")
                self._send({"text": text, "error": str(e)})  # fail open
            return
        self._send({"error": "not found"}, 404)


def main():
    # Sans argostranslate (installation d'avant le 2026-09-30, ou echec de l'etape facultative de l'assistant) : sortir TOUT
    # DE SUITE, sans « READY » — main.js voit le processus mourir et n'attend pas 12 s avant chaque traduction.
    if importlib.util.find_spec("argostranslate") is None:
        sys.stderr.write("[translate-server] argostranslate is not installed - translation unavailable\n")
        sys.exit(3)
    # Serveur d'appoint : l'appli disparait (plantage, arret force) -> il s'arrete aussi, au lieu de garder son port et sa RAM (2026-09-30).
    import surveillance_parent
    surveillance_parent.surveiller('translate_server')
    # Argos (urllib) et stanza (requests) telechargent SANS delai : une connexion bloquee au premier usage d'une langue gardait
    # _lock (toutes les traductions en attente) ou le telechargement de fond « en cours » pour toujours. 60 s sans octet = echec.
    import socket
    socket.setdefaulttimeout(60)
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), _Handler)
    # main.js waits for this line before routing requests here.
    print("TRANSLATE READY", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
