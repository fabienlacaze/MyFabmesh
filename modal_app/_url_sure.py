"""Telechargement d'une URL fournie par une requete : https SEULEMENT (2026-10-03, constat CLOUD-05).

POURQUOI. `urllib.request.urlopen` accepte http, https, file et ftp, et suit les redirections vers ces
schemas. Une URL choisie par un utilisateur (ex. refImageUrl de /api/rectify-image) pouvait donc faire
ouvrir au conteneur Modal une adresse du reseau interne du fournisseur ou un fichier local, et le texte de
l'exception (« ref download: ... ») revenait au client : un oracle d'existence. Ici :
  * ouvrir_https refuse tout schema autre que https, au depart ET a chaque redirection ;
  * erreur_telechargement journalise le detail COTE SERVEUR et ne rend qu'un texte fixe pour le client.
Bibliotheque standard seule (importable partout dans modal_app).
"""
import urllib.parse
import urllib.request


class SchemaRefuse(ValueError):
    """URL qui n'est pas en https (ou sans nom d'hote)."""


def exiger_https(url) -> None:
    morceaux = urllib.parse.urlsplit(str(url).strip())
    if morceaux.scheme.lower() != 'https' or not morceaux.hostname:
        raise SchemaRefuse('schema non autorise')


class _RedirectionHttps(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        exiger_https(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_OUVREUR = urllib.request.build_opener(_RedirectionHttps)


def ouvrir_https(requete, timeout=30):
    """Equivalent de urllib.request.urlopen(requete, timeout=...) limite a https (redirections comprises).
    `requete` : une urllib.request.Request ou une chaine d'URL."""
    url = requete.full_url if isinstance(requete, urllib.request.Request) else requete
    exiger_https(url)
    return _OUVREUR.open(requete, timeout=timeout)


def erreur_telechargement(quoi, exc) -> str:
    """Journalise le detail de l'echec cote serveur ; rend le texte SANS detail pour le client."""
    try:
        print(f'[telechargement] {quoi} : {type(exc).__name__}: {exc}', flush=True)
    except Exception:
        pass
    return f'{quoi} download failed'
