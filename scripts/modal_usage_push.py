#!/usr/bin/env python3
"""Releve horaire de la facture Modal -> carte « Cout GPU (Modal) » de l'admin.

Le worker Cloudflare ne peut pas lancer la CLI Modal : ce script lance
`modal billing report`, additionne la facture du mois (et son detail par jour
et par application) et l'envoie a <WORKER>/api/admin/modal-usage. L'admin en
tire la prevision de coupure, et l'arret automatique a 100 % de la limite.

SECRET partage avec le worker (secret Cloudflare MODAL_USAGE_SECRET), cherche
dans cet ordre :
  1. variable d'environnement MODAL_USAGE_SECRET (GitHub Action) ;
  2. registre Windows HKCU\\Software\\FabWare\\Exploitation, valeur
     ReleveModalSecret (ecrite par scripts/reinitialiser_releve_modal.ps1) ;
  3. ancien fichier %USERPROFILE%\\.fabmesh\\modal_usage_secret.txt (compatibilite).
POURQUOI LE REGISTRE (2026-09-30) : le nettoyage du disque du 30/09
(« installation de zero ») a supprime %USERPROFILE%\\.fabmesh. Le releve a
echoue chaque heure SANS LA MOINDRE TRACE (son journal etait dans le meme
dossier) et la carte a affiche 13 h durant des chiffres figes comme frais.
Aucun nettoyage de dossiers ne touche le registre ; et si le secret manque
quand meme, l'echec est maintenant ecrit, en clair, avec la reparation.

JOURNAL : --journal <fichier> (la tache planifiee passe
%LOCALAPPDATA%\\FabWare\\Exploitation\\releve_modal.log), dossier cree au besoin,
borne a 1 Mo. Chaque echec y dit la cause et comment reparer.

CODES DE SORTIE (visibles dans le Planificateur de taches, « Dernier resultat ») :
  0 ok ; 1 erreur inattendue ; 2 secret introuvable ; 3 cle refusee par le site ;
  4 facture Modal illisible (CLI, jeton) ; 5 site injoignable ou en erreur.
Sur un code 4, le secret est valide : l'erreur est aussi ENVOYEE au site, et
la carte l'affiche.

Autres variables : FABMESH_WORKER_URL, MODAL_BILLING_FOR (defaut « this month »).
"""
import argparse
import datetime
import json
import os
import subprocess
import sys
import traceback
import urllib.error
import urllib.request

WORKER = os.environ.get("FABMESH_WORKER_URL", "https://myfabmesh-cloud.fabien65400.workers.dev").rstrip("/")
PERIOD = os.environ.get("MODAL_BILLING_FOR", "this month")
CLE_REGISTRE = r"Software\FabWare\Exploitation"
VALEUR_REGISTRE = "ReleveModalSecret"
ANCIEN_FICHIER = os.path.join(os.path.expanduser("~"), ".fabmesh", "modal_usage_secret.txt")
REPARER = r"powershell -ExecutionPolicy Bypass -File scripts\reinitialiser_releve_modal.ps1"
AGENT = "MyFabmesh-ModalPoller/1.1"   # le worker reconnait ce prefixe pour noter un envoi refuse


class Echec(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


_journal = None


def log(msg):
    ligne = "[%s] %s" % (datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"), msg)
    print(ligne)
    if not _journal:
        return
    try:
        dossier = os.path.dirname(_journal)
        if dossier:
            os.makedirs(dossier, exist_ok=True)
        if os.path.exists(_journal) and os.path.getsize(_journal) > 1_000_000:
            os.replace(_journal, _journal + ".old")
        with open(_journal, "a", encoding="utf-8") as f:
            f.write(ligne + "\n")
    except OSError as e:
        print("(journal inaccessible : %s)" % e, file=sys.stderr)


def lire_secret():
    """(secret, source) ; (None, [endroits cherches]) si introuvable."""
    cherche = []
    v = os.environ.get("MODAL_USAGE_SECRET", "").strip()
    if v:
        return v, "variable MODAL_USAGE_SECRET"
    cherche.append("variable MODAL_USAGE_SECRET")
    if sys.platform == "win32":
        try:
            import winreg
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, CLE_REGISTRE) as k:
                val, _type = winreg.QueryValueEx(k, VALEUR_REGISTRE)
            val = str(val).strip()
            if val:
                return val, "registre"
        except OSError:
            pass
        cherche.append("registre HKCU\\%s (%s)" % (CLE_REGISTRE, VALEUR_REGISTRE))
    try:
        # utf-8-sig : ignore le BOM que Set-Content de PowerShell 5.1 ajoute
        # (il partait dans l'en-tete et valait un 401 incomprehensible).
        with open(ANCIEN_FICHIER, encoding="utf-8-sig") as f:
            val = f.read().strip()
        if val:
            return val, "ancien fichier " + ANCIEN_FICHIER
    except OSError:
        pass
    cherche.append("fichier " + ANCIEN_FICHIER)
    return None, cherche


def _rapport(args):
    """Lignes JSON de `modal billing report <args> --json` ; Echec(4) sinon."""
    cmd = [sys.executable, "-m", "modal", "billing", "report", *args, "--json"]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                              errors="replace", timeout=180)
    except FileNotFoundError as e:
        raise Echec(4, "CLI Modal introuvable (%s). Installer : pip install modal" % e)
    except subprocess.TimeoutExpired:
        raise Echec(4, "`modal billing report` n'a pas répondu en 3 min (réseau ?)")
    if proc.returncode != 0:
        lignes = (proc.stderr or proc.stdout or "").strip().splitlines()
        dernier = lignes[-1].strip() if lignes else "code %d" % proc.returncode
        raise Echec(4, "`modal billing report` a échoué : %s. Vérifier le jeton : "
                       "python -m modal token info (reconnecter : python -m modal token new)" % dernier[:300])
    try:
        return json.loads(proc.stdout)
    except ValueError:
        raise Echec(4, "réponse illisible de `modal billing report` : %s" % proc.stdout[:200])


def mois_utc():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m")


def modal_usage():
    """(total_usd, by_app, mois 'AAAA-MM') du cycle en cours.

    « this month » de la CLI Modal = mois UTC (sans --tz : bornes a minuit UTC,
    verifie dans modal 1.4.3, _utils/time_utils.parse_date_range). Le mois est
    envoye au site : un releve lance a 23:59:50 UTC et recu a 00:00:10 porte la
    facture du mois qui se termine, pas celle du nouveau."""
    for _essai in range(2):
        mois = mois_utc()
        rows = _rapport(["--for", PERIOD])
        if mois_utc() == mois:
            break
        log("relevé à cheval sur minuit UTC (changement de mois) : nouvel essai")
    total = 0.0
    by_app = {}
    for r in rows:
        c = float(r.get("Cost", 0) or 0)
        total += c
        app = str(r.get("Description") or r.get("Object ID") or "unknown")
        by_app[app] = round(by_app.get(app, 0.0) + c, 6)
    return round(total, 6), by_app, mois


def modal_usage_by_day(days=30):
    """Facture REELLE jour par jour ({'AAAA-MM-JJ': usd}) sur `days` jours.

    Le graphique « Revenue vs Cost » de l'admin tracait l'ESTIMATION du
    worker : 9 EUR le 24/09 pour 25 EUR factures. La carte « Cout GPU » en
    tire aussi le rythme des 7 derniers jours complets. Un echec ici ne doit
    pas empecher de pousser le total : on rend None.

    30 jours = ceux du graphique ; Modal refuse un rapport journalier de
    plus de 31 jours (« Daily reports cannot span more than 31 days »)."""
    fin = datetime.date.today() + datetime.timedelta(days=1)
    debut = fin - datetime.timedelta(days=days)
    try:
        rows = _rapport(["--start", debut.isoformat(), "--end", fin.isoformat(), "--resolution", "d"])
    except Echec as e:
        log("détail par jour indisponible (le total part quand même) : " + e.message)
        return None
    by_day, by_day_app = {}, {}
    for r in rows:
        jour = str(r.get("Interval Start") or "")[:10]
        if len(jour) == 10:
            c = float(r.get("Cost", 0) or 0)
            by_day[jour] = round(by_day.get(jour, 0.0) + c, 6)
            # Par application aussi : le tableau « Par type » attribue ainsi
            # la facture du rig au rig, et non aux maillages du meme jour.
            app = str(r.get("Description") or r.get("Object ID") or "unknown")
            jour_app = by_day_app.setdefault(jour, {})
            jour_app[app] = round(jour_app.get(app, 0.0) + c, 6)
    return by_day, by_day_app


def _poster(secret, corps):
    req = urllib.request.Request(
        WORKER + "/api/admin/modal-usage", data=json.dumps(corps).encode("utf-8"), method="POST",
        headers={"content-type": "application/json", "x-ingest-secret": secret.strip(), "user-agent": AGENT},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            raise Echec(3, "le site refuse la clé (HTTP %d) : la clé de ce PC ne correspond plus à celle "
                           "du site (secret MODAL_USAGE_SECRET changé ?). Réparer : %s" % (e.code, REPARER))
        corps_err = ""
        try:
            corps_err = e.read(200).decode("utf-8", "replace")
        except Exception:
            pass
        raise Echec(5, "le site répond HTTP %d : %s" % (e.code, corps_err))
    except (urllib.error.URLError, OSError) as e:
        raise Echec(5, "site injoignable (%s) : réseau coupé ?" % getattr(e, "reason", e))


def signaler_erreur(secret, message):
    """La facture n'a pas pu etre lue mais la cle est bonne : le dire au site,
    pour que la carte affiche la cause au lieu d'un simple « en retard »."""
    try:
        _poster(secret, {"erreur": message[:300]})
    except Echec as e:
        log("signalement de l'erreur au site impossible : " + e.message)


def main(argv=None):
    global _journal
    ap = argparse.ArgumentParser(description="Relevé de la facture Modal vers l'admin MyFabmesh.")
    ap.add_argument("--journal", help="fichier journal (créé au besoin)")
    args = ap.parse_args(argv)
    _journal = args.journal
    try:
        secret, source = lire_secret()
        if not secret:
            raise Echec(2, "secret du relevé introuvable (cherché : %s). Réparer : %s" % (" ; ".join(source), REPARER))
        try:
            usage, by_app, mois = modal_usage()
        except Echec as e:
            if e.code == 4:
                signaler_erreur(secret, e.message)
            raise
        corps = {"usage": usage, "by_app": by_app, "cycle": PERIOD, "mois": mois}
        detail = modal_usage_by_day()
        if detail is not None:
            corps["by_day"], corps["by_day_app"] = detail
        statut = _poster(secret, corps)
        log("OK : facture Modal %s = %.2f $ (%d applications) envoyée au site, HTTP %s (secret : %s)"
            % (mois, usage, len(by_app), statut, source))
        return 0
    except Echec as e:
        log("ECHEC (code %d) : %s" % (e.code, e.message))
        return e.code
    except Exception as e:  # jamais d'echec muet
        log("ECHEC (code 1) inattendu : %r\n%s" % (e, traceback.format_exc()))
        return 1


if __name__ == "__main__":
    sys.exit(main())
