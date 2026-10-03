"""BANC (2026-10-03) : le composeur d'intention et la case « T-pose » executes sur la VRAIE image Modal (CPU seulement, ~0,02 $).

Pourquoi : « un deploiement qui passe ne prouve pas qu'une inference passe » (CLAUDE.md §16). Ici on verifie, dans le conteneur reel (memes versions de Python
et de torch que la production) que modal_app/composeur_intention.py est bien dans l'image et que les trois points d'entree donnent les chaines attendues :
  1. _prompts.build_enriched_prompt : l'orc recoit la clause et le gabarit adapte (MEME chaine que le client) ; sans objet tenu, rien ne change ;
     pose_libre=True retire les consignes de T-pose ;
  2. _realvis.build_prompts : la massue n'est plus interdite en negatif, une seule arme est protegee ; sans arme nommee, negatif d'origine ;
  3. NEGATIONS DE L'UTILISATEUR (2026-10-03) : « no helmet » quitte le positif (meme chaine que sans la locution), « helmet » entre au negatif
     (_prompts.negatifs_utilisateur + _realvis.build_prompts), derriere la securite / les ombres / les armes / l'anatomie ; nettoyage strict du champ
     `negative_extra` ; sans terme, negatif identique. Cela verifie aussi que le composeur DE L'IMAGE porte extraire_negations / assainir_negatifs.

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
ORC_NEG = "An orc warrior covered in blood, no helmet, holding a massive spiked club"


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

    # 5. negations de l'utilisateur (le composeur de l'image doit porter extraire_negations et assainir_negatifs)
    verifier("negations : le composeur de l'image sait extraire", hasattr(ci, "extraire_negations") and hasattr(ci, "assainir_negatifs"))
    verifier("negations : prompt de l'orc avec « no helmet » = celui sans la locution", P.build_enriched_prompt(ORC_NEG, "character", "dark-fantasy") == ORC_ATTENDU,
             P.build_enriched_prompt(ORC_NEG, "character", "dark-fantasy"))
    verifier("negations : termes d'un ancien client (texte brut)", P.negatifs_utilisateur(ORC_NEG) == ["helmet"], P.negatifs_utilisateur(ORC_NEG))
    verifier("negations : termes d'un client a jour (champ)", P.negatifs_utilisateur(ORC, ["helmet"]) == ["helmet"], P.negatifs_utilisateur(ORC, ["helmet"]))
    verifier("negations : nettoyage strict (ponderation injectee, garde-robe, majuscules, virgule)",
             P.termes_negatifs_valides(["(nude:0)", "clothes", "Helmet", "a, b", "x" * 41]) == ["helmet"],
             P.termes_negatifs_valides(["(nude:0)", "clothes", "Helmet", "a, b", "x" * 41]))
    _, neg3 = R.build_prompts(p, "character", negatif_utilisateur=["helmet"])
    verifier("negatif orc + helmet : (helmet:1.4) present, apres l'anatomie", "(helmet:1.4)" in neg3 and neg3.index("(mutated hands:1.4)") < neg3.index("(helmet:1.4)"), neg3)
    verifier("negatif orc + helmet : securite, ombres, parade une seule arme, anatomie toujours la",
             neg3.startswith("nude, naked, nsfw, undressed, cast shadow, soft shadow, ambient occlusion")
             and "(second weapon:1.5)" in neg3 and "(extra arms:1.6)" in neg3, neg3)
    verifier("negatif sans terme (None, [] ou termes invalides) : identique a celui d'avant",
             R.build_prompts(p, "character") == R.build_prompts(p, "character", negatif_utilisateur=[])
             == R.build_prompts(p, "character", negatif_utilisateur=["(nude:0)", "clothes"]))
    _, neg4 = R.build_prompts(P.build_enriched_prompt("A fierce dragon", "creature", "realistic"), "creature",
                              negatif_utilisateur=["alpha bravo charlie", "delta echo foxtrot", "golf hotel india"])
    verifier("negatif creature (le plus charge) : l'anatomie passe avant les termes, securite en tete",
             "(five legs:1.6)" in neg4 and "(alpha bravo charlie:1.4)" in neg4 and neg4.startswith("nude, naked, nsfw, undressed"), neg4)
    # une inondation de termes (huit termes de trois mots) ne chasse JAMAIS la securite ni les ombres, quel que soit le type d'asset
    inondation = ["alpha bravo charlie", "delta echo foxtrot", "golf hotel india", "juliet kilo lima", "mike november oscar", "papa quebec romeo",
                  "sierra tango uniform", "victor whiskey xray"]
    securite_ok = True
    for typ in sorted(P.ASSET_TYPE_PROMPTS):
        _, negi = R.build_prompts(P.build_enriched_prompt("A simple " + typ, typ, "realistic"), typ, negatif_utilisateur=inondation)
        securite_ok = securite_ok and negi.startswith("nude, naked, nsfw, undressed, cast shadow, soft shadow, ambient occlusion") and "(alpha bravo charlie:1.4)" in negi
    verifier("inondation de termes : securite et ombres toujours en tete, premier terme retenu (tous les types)", securite_ok)

    # 6. PLANCHER DUR (seconde ligne de defense, apres le filtre du worker) : il examine le texte ET les negations rendues, comme avant
    verifier("plancher : texte + « no X, without X » pour chaque terme applique",
             P.texte_pour_plancher("a child", ["whip", "(nude:0)", "clothes"]) == "a child, no whip, without whip", P.texte_pour_plancher("a child", ["whip"]))
    verifier("plancher : sans terme, le texte lui-meme", P.texte_pour_plancher("a child", []) == "a child" and P.texte_pour_plancher("a child") == "a child")
    from modal_app._moderation_texte import prompt_hard_floor as plancher
    verifier("plancher dur reel : « a child » + terme « whip » bloque comme « a child, no whip » ; « a child » seul passe",
             plancher("a child, no whip") is not None and plancher(P.texte_pour_plancher("a child", ["whip"])) is not None and plancher("a child") is None)

    # 7. le code DEPLOYE (app.py de l'image) porte la colle des deux routes : champ transmis, plancher dur nourri des negations
    import modal_app
    with open(os.path.join(os.path.dirname(modal_app.__file__), "app.py"), "r", encoding="utf-8") as f:
        src_app = f.read()
    verifier("app.py de l'image : route text2image (plancher dur nourri des negations, champ transmis)",
             'texte_pour_plancher(prompt, payload.get("negative_extra"))' in src_app and 'negative_extra=payload.get("negative_extra"),' in src_app)
    verifier("app.py de l'image : route T-pose (termes nettoyes, plancher dur nourri des negations, negatif)",
             'termes_negatifs_valides(payload.get("negative_extra"))' in src_app and "texte_pour_plancher(prompt, _negatifs)" in src_app
             and "negatif_extra=_negatifs," in src_app)

    rapport["verdicts"] = verdicts
    rapport["VERDICT"] = "OK" if all(verdicts.values()) else "ECHEC"
    return rapport


@app.local_entrypoint()
def main():
    r = banc.remote()
    print("=== VERDICT :", r["VERDICT"], "| Python", r["python"], "| regles actives", r["regles_actives"])
    if r["VERDICT"] != "OK":
        raise SystemExit(1)
