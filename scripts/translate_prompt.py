#!/usr/bin/env python
"""Translate a user prompt to English with Argos Translate (offline, MIT, CPU).

FabMesh's image models (RealVisXL / HiDream) need English prompts, but the UI
supports 6 languages (en/zh/hi/es/fr/ar). This helper translates the user's
raw text from their interface language to English BEFORE the English asset-type
templates are concatenated.

Usage:
    translate_prompt.py --text "fourmi géante" --from fr   -> "giant ant"
    translate_prompt.py --text "..."           --from en   -> passthrough

Fails OPEN: if Argos or the language package isn't available, it prints the
input unchanged (so generation never breaks because of translation).

    translate_prompt.py --installer fr,es     -> installe les modeles fr->en et
                                                 es->en (assistant d'installation)
"""
import argparse
import json
import os
import sys

# Python EMBARQUE (fichier ._pth) : le dossier du script n'est pas dans sys.path. Il y faut `minisbd` (remplacant neutre du
# paquet AGPL, scripts/minisbd), qu'argostranslate importe au chargement (reprise du travail de l'audit du 2026-09-30).
_ICI = os.path.dirname(os.path.abspath(__file__))
if _ICI not in sys.path:
    sys.path.insert(0, _ICI)

# Windows console is cp1252; Arabic/Hindi/Chinese output needs UTF-8.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


def translate_to_english(text, src):
    """Return (text, ok). ok=False means Argos was unavailable or produced no
    translation, so the caller may retry with another interpreter."""
    src = (src or "en").lower()
    if src == "en" or not text.strip():
        return text, True
    try:
        from argostranslate import translate as _t
        # Modern convenience API.
        try:
            out = _t.translate(text, src, "en")
            if out:
                return out, True
        except Exception:
            pass
        # Fallback to the language-objects API (older Argos).
        langs = _t.get_installed_languages()
        from_lang = next((l for l in langs if l.code == src), None)
        to_lang = next((l for l in langs if l.code == "en"), None)
        if from_lang and to_lang:
            out = from_lang.get_translation(to_lang).translate(text)
            if out:
                return out, True
    except Exception as e:
        sys.stderr.write(f"[translate] fallback (no translation for '{src}'): {e}\n")
    return text, False


# MODELES DE LANGUE (2026-09-30, audit de l'installation de zero). Sur un PC neuf aucun modele Argos n'est installe : ils
# vivent dans le dossier de l'utilisateur (~/.local/share/argos-translate/packages), on ne peut pas les livrer avec l'appli.
# L'assistant pose ceux des langues du systeme (--installer) ; translate_server.py telecharge les autres a la premiere demande.
# Reseau : index et modele par urllib (magasin de certificats de Windows + SSL_CERT_FILE de main.js), fichiers de decoupage
# en phrases (stanza, ~1 Mo) par requests (REQUESTS_CA_BUNDLE de main.js) : fonctionne derriere un antivirus qui inspecte HTTPS.
LANGUES_MODELES = ('fr', 'es', 'zh', 'hi', 'ar', 'en')     # langues d'interface (bureau + web) ; toujours avec l'anglais
# Une phrase courte par langue : la premiere traduction charge le modele et telecharge les fichiers stanza manquants.
_ESSAI = {'fr': 'une table en bois', 'es': 'una mesa de madera', 'zh': '一张木桌',
          'hi': 'लकड़ी की मेज़', 'ar': 'طاولة خشبية', 'en': 'a wooden table'}


def paquet_installe(src, dst="en"):
    from argostranslate import package
    return any(p.from_code == src and p.to_code == dst for p in package.get_installed_packages())


def installer_paquet(src, dst="en"):
    """Telecharge et installe le modele src -> dst depuis l'index Argos. Rend True s'il est installe a la fin."""
    if src == dst or src not in LANGUES_MODELES or dst not in LANGUES_MODELES:
        return False
    if paquet_installe(src, dst):
        return True
    import socket
    from argostranslate import package, settings
    # Argos telecharge par urllib SANS delai : une connexion bloquee (pare-feu, raw.githubusercontent.com filtre) figeait
    # l'etape de l'assistant jusqu'a son delai de 15 min. 60 s sans aucun octet = echec, la traduction reste facultative.
    if socket.getdefaulttimeout() is None:
        socket.setdefaulttimeout(60)
    package.update_package_index()
    # Index injoignable : update_package_index() avale l'erreur sans rien ecrire, et get_available_packages() se rappelle
    # alors elle-meme (nouvel essai reseau a chaque niveau) jusqu'a la RecursionError (argostranslate 1.11.0, verifie). Stop.
    if not os.path.isfile(str(settings.local_package_index)):
        return False
    dispo = [p for p in package.get_available_packages() if p.from_code == src and p.to_code == dst]
    if not dispo:
        return False
    dispo.sort(key=lambda p: [int(x) for x in str(p.package_version).split('.') if x.isdigit()])
    dispo[-1].install()      # telechargement + installation + vidage du cache des langues d'Argos
    return paquet_installe(src, dst)


def installer(langues):
    """--installer : modeles langue -> anglais + une traduction d'essai chacun. Code 0 si tout est pret, 4 sinon."""
    tout_ok = True
    for src in [l.strip().lower() for l in langues.split(',') if l.strip()]:
        try:
            ok = installer_paquet(src, "en")
            essai, trad = _ESSAI.get(src, 'test'), None
            if ok:
                trad, ok = translate_to_english(essai, src)
            print(json.dumps({"langue": src, "ok": bool(ok), "essai": trad}, ensure_ascii=True), flush=True)
            tout_ok = tout_ok and bool(ok)
        except Exception as e:
            print(json.dumps({"langue": src, "ok": False, "erreur": f"{type(e).__name__}: {e}"[:300]}, ensure_ascii=True), flush=True)
            tout_ok = False
    return 0 if tout_ok else 4


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--text")
    ap.add_argument("--from", dest="src", default="en")
    ap.add_argument("--strict", action="store_true",
                    help="exit 3 if Argos is unavailable so the caller can fall back")
    ap.add_argument("--installer", help="fr,es,... : installe les modeles langue -> anglais")
    args = ap.parse_args()
    if args.installer:
        sys.exit(installer(args.installer))
    if args.text is None:
        ap.error("--text is required")
    out, ok = translate_to_english(args.text, args.src)
    if args.strict and not ok:
        sys.exit(3)  # signal 'translation unavailable' to the caller
    sys.stdout.write(out)


if __name__ == "__main__":
    main()
