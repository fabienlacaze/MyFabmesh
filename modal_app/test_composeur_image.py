"""BANC (2026-10-03) : le composeur d'intention et la case « T-pose » executes sur la VRAIE image Modal (CPU seulement, ~0,02 $).

Pourquoi : « un deploiement qui passe ne prouve pas qu'une inference passe » (CLAUDE.md §16). Ici on verifie, dans le conteneur reel (memes versions de Python
et de torch que la production) que modal_app/composeur_intention.py est bien dans l'image et que les trois points d'entree donnent les chaines attendues :
  1. _prompts.build_enriched_prompt : l'orc recoit la clause et le gabarit adapte (MEME chaine que le client) ; sans objet tenu, rien ne change ;
     pose_libre=True retire les consignes de T-pose ;
  2. _realvis.build_prompts : la massue n'est plus interdite en negatif, une seule arme est protegee ; sans arme nommee, negatif d'origine.

Usage :  PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python -m modal run modal_app/test_composeur_image.py
"""
import modal

from modal_app.app import image

app = modal.App("myfabmesh-test-composeur-image", image=image)

ORC = "An orc warrior covered in blood, holding a massive spiked club"
ORC_ATTENDU = (
    "An orc warrior covered in blood, holding a massive spiked club, "
    "holding exactly one massive spiked club in the right hand, left hand open and empty, "
    "dark fantasy, gothic grimdark, dramatic chiaroscuro lighting, weathered ornate detail, brooding, "
    "isolated 3D character, full body, fully clothed, T-pose, arms extended horizontally, legs apart, strict front view, facing camera, "
    "plain white background, entire figure and held item fully visible, generous empty margins")
CONSIGNES_TPOSE = ("T-pose", "arms extended horizontally", "legs apart", "symmetric", "empty open hands")


@app.function(cpu=2.0, memory=4096, timeout=600)
def banc():
    import os
    import sys

    from modal_app import composeur_intention as ci
    from modal_app import _prompts as P
    from modal_app import _realvis as R

    verdicts = {}

    def verifier(nom, ok, detail=""):
        verdicts[nom] = bool(ok)
        print(("OK    " if ok else "ECHEC ") + nom + (" : " + str(detail)[:300] if (detail and not ok) else ""), flush=True)

    rapport = {"python": sys.version.split()[0], "regles_actives": list(ci.REGLES_ACTIVES)}

    # 1. prompt de l'orc : meme chaine que le client (tests/bureau-interface/composeur-prompt.test.mjs::ORC_ATTENDU)
    os.environ.pop("FABMESH_COMPOSEUR", None)
    p = P.build_enriched_prompt(ORC, "character", "dark-fantasy")
    verifier("orc : chaine exacte", p == ORC_ATTENDU, p)

    # 2. sans objet tenu : identique au composeur coupe, pour tous les types
    identiques = True
    for typ in sorted(P.ASSET_TYPE_PROMPTS):
        avec = P.build_enriched_prompt("A simple " + typ, typ, "realistic")
        os.environ["FABMESH_COMPOSEUR"] = "0"
        sans = P.build_enriched_prompt("A simple " + typ, typ, "realistic")
        os.environ.pop("FABMESH_COMPOSEUR", None)
        identiques = identiques and (avec == sans)
    verifier("sans objet tenu : identique au composeur coupe (tous les types)", identiques)

    # 3. case « T-pose » decochee
    libre = P.build_enriched_prompt("An orc warrior", "character", "realistic", pose_libre=True)
    verifier("pose libre : aucune consigne de T-pose", not any(c in libre for c in CONSIGNES_TPOSE), libre)
    verifier("pose libre : le reste du gabarit est la", all(m in libre for m in ("isolated 3D character", "strict front view", "plain white background")), libre)
    verifier("defaut : T-pose", "T-pose" in P.build_enriched_prompt("An orc warrior", "character", "realistic"))

    # 4. negatif : la massue n'est plus interdite, une seule arme est protegee ; sans arme nommee, d'origine
    _, neg = R.build_prompts(p, "character")
    verifier("negatif orc : weapon / club retires", "(weapon:1.6)" not in neg and "(club:1.4)" not in neg, neg)
    verifier("negatif orc : une seule arme protegee", "(second weapon:1.5)" in neg and "(duplicate weapon:1.5)" in neg, neg)
    verifier("negatif orc : le budget ne bouge pas, extra characters n'est pas ecarte en plus", "extra characters, bystanders" in neg, neg)
    verifier("negatif orc : la securite reste la premiere consigne", neg.startswith("nude, naked, nsfw, undressed"), neg)
    sans_arme = P.build_enriched_prompt("An orc", "character", "realistic")
    _, neg2 = R.build_prompts(sans_arme, "character")
    verifier("negatif sans arme nommee : liste d'origine", "(weapon:1.6)" in neg2 and "(club:1.4)" in neg2 and "second weapon" not in neg2, neg2)

    rapport["verdicts"] = verdicts
    rapport["VERDICT"] = "OK" if all(verdicts.values()) else "ECHEC"
    return rapport


@app.local_entrypoint()
def main():
    r = banc.remote()
    print("=== VERDICT :", r["VERDICT"], "| Python", r["python"], "| regles actives", r["regles_actives"])
    if r["VERDICT"] != "OK":
        raise SystemExit(1)
