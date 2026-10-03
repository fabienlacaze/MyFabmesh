# -*- coding: utf-8 -*-
"""Garde des petits serveurs HTTP locaux du bureau (2026-10-03, constat D-04).

Serveurs concernes : sdxl_server.py (5555), translate_server.py (5557), nsfw_server.py (5558). Ils ecoutent
sur 127.0.0.1, sans jeton. Deux attaques restaient ouvertes depuis une page web ouverte dans le navigateur :
  * POST « simple » (Content-Type text/plain, corps JSON) vers http://127.0.0.1:5555 : aucun controle
    prealable du navigateur ; /shutdown arretait le serveur, /img2img ecrivait un fichier ;
  * DNS REBINDING : un nom de domaine du pirate qui se met a resoudre vers 127.0.0.1 ; le navigateur envoie
    alors « Host: pirate.example:5555 » et accepte de lire la reponse.

Parades (bibliotheque standard seule) :
  1. Host : seuls 127.0.0.1:<port> et localhost:<port> sont admis (absent = refuse).
  2. Origin : refuse s'il est present. Verifie le 2026-10-03 : AUCUN navigateur ni renderer n'appelle ces
     serveurs (main.js et les scripts Python les appellent avec node http / urllib, qui n'envoient jamais
     Origin ; grep de src/renderer : aucune requete vers 5555/5557/5558). Un en-tete Origin vient donc
     forcement d'une page web.
  3. Chemins (sdxl_server seulement) : refus des chemins reseau (UNC, prefixe double barre oblique inverse
     ou double barre oblique : lire un fichier distant enverrait le hachage NTLM de l'utilisateur), des
     octets nuls et, en ECRITURE, des dossiers systeme (Windows, Program Files) et du dossier Demarrage.
     Les chemins relatifs restent admis (aucun appelant connu n'en envoie ; les refuser ne protegerait de rien).

Un jeton aleatoire (variable d'environnement posee par main.js) serait un cran de plus, mais demande de
modifier src/main/main.js : voir le rapport.
"""
import os


def _hotes_autorises(port):
    return {'127.0.0.1:%d' % int(port), 'localhost:%d' % int(port)}


def requete_autorisee(headers, port):
    """(True, '') si la requete peut etre traitee, sinon (False, raison). `headers` : objet a .get (http.server)."""
    if headers.get('Origin') is not None:
        return False, 'origin'
    hote = headers.get('Host')
    if hote is None or hote.strip().lower() not in _hotes_autorises(port):
        return False, 'host'
    return True, ''


def _dossiers_interdits_en_ecriture():
    dossiers = []
    for var in ('WINDIR', 'SystemRoot', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432'):
        v = os.environ.get(var)
        if v:
            dossiers.append(v)
    appdata = os.environ.get('APPDATA')
    if appdata:
        dossiers.append(os.path.join(appdata, 'Microsoft', 'Windows', 'Start Menu'))
    programdata = os.environ.get('ProgramData')
    if programdata:
        dossiers.append(os.path.join(programdata, 'Microsoft', 'Windows', 'Start Menu'))
    return dossiers


def _sous(chemin, dossier):
    a = os.path.normcase(os.path.abspath(chemin))
    b = os.path.normcase(os.path.abspath(dossier))
    return a == b or a.startswith(b.rstrip('\\/') + os.sep)


def chemin_acceptable(chemin, ecriture=False):
    """(True, '') ou (False, raison). Ne touche pas au disque (pas d'existence exigee)."""
    if not isinstance(chemin, str) or not chemin.strip():
        return False, 'chemin vide ou non textuel'
    if '\x00' in chemin:
        return False, 'octet nul'
    if chemin.startswith('\\\\') or chemin.startswith('//'):
        return False, 'chemin reseau ou peripherique'
    if ecriture:
        for dossier in _dossiers_interdits_en_ecriture():
            if _sous(chemin, dossier):
                return False, 'ecriture interdite dans un dossier systeme'
    return True, ''


CLES_LECTURE = ('input', 'control', 'ref', 'mask')
CLES_ECRITURE = ('output', 'output_dir')


def verifier_chemins(data):
    """Controle les chemins d'une requete JSON du serveur d'images. Rend '' si tout va bien, sinon la raison.
    Une cle absente ou None est ignoree (ex. `ref` optionnel)."""
    if not isinstance(data, dict):
        return ''
    for cles, ecriture in ((CLES_LECTURE, False), (CLES_ECRITURE, True)):
        for cle in cles:
            v = data.get(cle)
            if v is None or v == '':      # `ref` optionnel : absent, None ou chaine vide
                continue
            ok, raison = chemin_acceptable(v, ecriture)
            if not ok:
                return '%s : %s' % (cle, raison)
    return ''
