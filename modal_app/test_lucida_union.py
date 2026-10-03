"""BANC (2026-10-03) : le VRAI `modal_app._detourage.detourer` en mode UNION (u2net + Lucida) contre u2net seul, sur les 36 images du banc
`test_lucida_vs_u2net.py`, dans l'image Modal du maillage (L40S, ~0,1 a 0,2 $) et/ou dans celle du conteneur image (Backview).

A LANCER PAR L'AGENT PRINCIPAL (aucun calcul sur le PC du proprietaire), apres l'integration de modal_app/_detourage.py :

    PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python -m modal run modal_app/test_lucida_union.py
    PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python -m modal run modal_app/test_lucida_union.py --cuites --conteneur les-deux

  --conteneur  mesh (defaut) | backview | les-deux. Le conteneur image (Backview) a transformers 4.45 et SANS kornia : tant que app.py
               n'a pas defini `image_backview` (image + kornia + poids de Lucida, voir le diff propose), le banc teste l'image par
               defaut de l'application et y verifie le REPLI (union == u2net, a l'octet) ; des que `image_backview` existe, c'est
               elle qui est testee (premiere validation de Lucida sous transformers 4.45).
  --cuites     les poids de Lucida sont DEJA dans l'image (app.py : snapshot_download) : on les charge depuis le cache LOCAL, comme en
               production (local_files_only=True). Sans ce drapeau, FABMESH_LUCIDA_TELECHARGER=1 : le banc telecharge les 844 Mo (~8 s).

Ce que le banc verifie (PASS / FAIL, code de sortie 1 au moindre FAIL) :
  1. mode u2net = ancien comportement A L'IDENTIQUE : l'ancienne fonction (recopiee ici, session onnx reelle) rend les memes octets RGBA que
     detourer(...) avec FABMESH_DETOURAGE=u2net, sur toutes les images ;
  2. union >= chaque masque : au seuil 127, le masque de l'union contient celui de u2net ET celui de Lucida (inclusion pixel a pixel), donc
     son aire est superieure ou egale a celle de chacun ;
  3. l'union est EXACTEMENT fusionner_alphas(u2net, Lucida) (le masque Lucida compare est celui que detourer a reellement utilise, releve par
     un espion : une seconde inference GPU ne serait pas identique a l'octet) ;
  4. images de produit a fond blanc (paire_*) : l'union ne depasse u2net que de moins de 3 % de l'aire de u2net ;
  5. l'ane (paire_04_ne, ou Lucida echoue) est COMPLET : l'union garde au moins 95 % de l'aire de u2net et plus de 3 fois celle de Lucida ;
  6. un seul chargement du modele : par precharger(), puis sous 4 fils concurrents apres reinitialisation, from_pretrained n'est appele
     qu'UNE fois (compte direct sur from_pretrained) ;
  7. avec --cuites, from_pretrained a recu local_files_only=True (le chemin de production) ; sinon False.
  Si Lucida ne peut pas se charger dans l'image (kornia absent, code distant refuse...), les controles 2 a 6 sont remplaces par : l'union
  rend EXACTEMENT les octets de u2net seul (repli), et le message d'indisponibilite est releve.

Il mesure aussi : temps par appel (u2net seul / union), chargement de Lucida, VRAM (apres chargement, pic, reservee a la fin), nombre de
morceaux (une union ne doit pas fragmenter), non-determinisme de Lucida, et releve en [ALERTE] (information, sans echec) un masque Lucida ou
une union couvrant 90 % de l'image (arriere-plan garde : l'union n'y verrait aucun defaut) ; et rend des planches [original | u2net sur blanc | union sur
blanc | ce que l'union ajoute (rouge)] a REGARDER (les bords : l'union reprend l'alpha doux de u2net la ou il est sur, verifier l'absence de
lisere ou de halo sur les fonds blancs).

Sortie : C:/tmp/fidelite/lucida_union/{metriques_<conteneur>.json, planche_<conteneur>_<n>.png}
"""
import modal

import modal_app.app as _app_cloud
from modal_app.app import mesh_image

# Image du conteneur Backview : `image_backview` si app.py la definit (l'image + kornia + poids de Lucida), sinon l'image par defaut
# de l'application (celle qu'utilise la classe aujourd'hui : sans kornia ni poids -> le banc y verifie le REPLI).
image_backview = getattr(_app_cloud, "image_backview", _app_cloud.image)

app = modal.App("myfabmesh-test-lucida-union", image=mesh_image)

SEUIL = 127            # seuil de « sujet » des mesures (celui de modal_app/fusion_masques.py)


def _mesurer(images: list, noms: list, cuites: bool, conteneur: str) -> dict:
    import contextlib
    import io
    import os
    import statistics
    import threading
    import time

    import cv2
    import numpy as np
    import torch
    from PIL import Image, ImageDraw, ImageOps

    sortie = {"conteneur": conteneur, "cuites": cuites, "versions": {}, "images": [], "planches": [], "verifications": [],
              "journal_lucida": []}
    for m in ("torch", "torchvision", "transformers", "timm", "kornia", "einops", "onnxruntime", "numpy", "PIL"):
        try:
            mod = __import__(m)
            sortie["versions"][m] = getattr(mod, "__version__", "?")
        except Exception as e:  # noqa: BLE001
            sortie["versions"][m] = "ABSENT (%s)" % type(e).__name__
    print("versions :", sortie["versions"], flush=True)

    def verifier(nom, ok, detail=""):
        sortie["verifications"].append({"nom": nom, "ok": bool(ok), "detail": detail})
        print("[%s] %s %s" % ("PASS" if ok else "FAIL", nom, detail), flush=True)

    os.environ.pop("FABMESH_DETOURAGE", None)
    os.environ["FABMESH_LUCIDA_TELECHARGER"] = "0" if cuites else "1"
    import modal_app._detourage as D
    from modal_app.fusion_masques import diagnostic_masques, fusionner_alphas

    # --- compte direct des chargements du modele : from_pretrained enveloppe -----------------------------------------------------
    from transformers import AutoModelForImageSegmentation
    chargements = []
    original = AutoModelForImageSegmentation.from_pretrained

    def compte(*a, **k):
        chargements.append({"args": [str(x) for x in a], "options": {kk: str(vv) for kk, vv in k.items()}})
        return original(*a, **k)

    AutoModelForImageSegmentation.from_pretrained = compte

    # --- espion : le masque Lucida REELLEMENT utilise par detourer (une seconde inference ne serait pas identique a l'octet) --------
    espion = {"lucida": None, "appels": 0}
    masque_lucida_reel = D.masque_lucida

    def masque_lucida_espion(img):
        m = masque_lucida_reel(img)
        espion["lucida"], espion["appels"] = m, espion["appels"] + 1
        return m

    D.masque_lucida = masque_lucida_espion

    # --- l'ANCIEN detourer, recopie de modal_app/_detourage.py (HEAD au 2026-10-03), avec une session onnx reelle ---------------------
    import onnxruntime as ort
    opts = ort.SessionOptions()
    if "OMP_NUM_THREADS" in os.environ:
        n = int(os.environ["OMP_NUM_THREADS"])
        opts.inter_op_num_threads = n
        opts.intra_op_num_threads = n
    session_ancienne = ort.InferenceSession(D.POIDS_U2NET, sess_options=opts, providers=["CPUExecutionProvider"])

    def masque_ancien(img):
        s = session_ancienne
        im = np.array(img.convert("RGB").resize((320, 320), Image.Resampling.LANCZOS))
        im = im / max(np.max(im), 1e-6)
        t = np.zeros((im.shape[0], im.shape[1], 3))
        for c, (m, e) in enumerate(zip((0.485, 0.456, 0.406), (0.229, 0.224, 0.225))):
            t[:, :, c] = (im[:, :, c] - m) / e
        entree = {s.get_inputs()[0].name: np.expand_dims(t.transpose((2, 0, 1)), 0).astype(np.float32)}
        pred = s.run(None, entree)[0][:, 0, :, :]
        ma, mi = np.max(pred), np.min(pred)
        pred = np.squeeze((pred - mi) / (ma - mi))
        m = Image.fromarray((pred.clip(0, 1) * 255).astype("uint8"), mode="L")
        return m.resize(img.size, Image.Resampling.LANCZOS)

    def detourer_ancien(img):
        img = ImageOps.exif_transpose(img)
        return Image.composite(img, Image.new("RGBA", img.size, 0), masque_ancien(img))

    def morceaux(bin_, seuil_frac=0.0005):
        n, _, stats, _ = cv2.connectedComponentsWithStats(bin_.astype("uint8"), connectivity=8)
        return int(sum(1 for k in range(1, n) if stats[k, cv2.CC_STAT_AREA] >= seuil_frac * bin_.size))

    def sur_blanc(img, alpha):
        base = Image.new("RGB", img.size, (255, 255, 255))
        base.paste(img.convert("RGB"), (0, 0), Image.fromarray(alpha))
        return base

    def vram():
        return {"alloue_mo": int(torch.cuda.memory_allocated() // 2 ** 20), "reservee_mo": int(torch.cuda.memory_reserved() // 2 ** 20),
                "pic_mo": int(torch.cuda.max_memory_allocated() // 2 ** 20)}

    def capter(fonction, *args):
        """Rend (resultat, lignes de journal imprimees pendant l'appel, duree en ms)."""
        tampon = io.StringIO()
        t0 = time.time()
        with contextlib.redirect_stdout(tampon):
            res = fonction(*args)
        ms = int((time.time() - t0) * 1000)
        for ligne in tampon.getvalue().splitlines():
            print(ligne, flush=True)           # le journal reste visible dans les journaux Modal
        return res, [l for l in tampon.getvalue().splitlines() if l.startswith("[detourage]")], ms

    # --- images : RGB puis RGBA OPAQUE, comme les appelants de production (`detourer(img.convert('RGBA'))`) -----------------------
    sources = []
    for octets, nom in zip(images, noms):
        rgb = ImageOps.exif_transpose(Image.open(io.BytesIO(octets))).convert("RGB")
        sources.append((nom, rgb.convert("RGBA")))
    premiere = sources[0][1]

    # --- phase A : demarrage a froid du modele (precharger) -----------------------------------------------------------------------
    torch.cuda.reset_peak_memory_stats()
    chargements.clear()
    D.reinitialiser_lucida()
    avant = vram()
    t0 = time.time()
    pret, lignes, _ = capter(D.precharger)
    sortie["precharger"] = {"ok": bool(pret), "duree_s": round(time.time() - t0, 2), "vram_avant": avant, "vram_apres": vram(),
                            "chargements": len(chargements), "journal": lignes}
    lucida_ok = bool(pret)
    sortie["lucida_disponible"] = lucida_ok
    print("precharger -> %s en %.1f s ; VRAM %s ; journal %s" % (pret, time.time() - t0, vram(), lignes), flush=True)
    if lucida_ok:
        verifier("un seul chargement par precharger()", len(chargements) == 1, "from_pretrained appele %d fois" % len(chargements))
        verifier("options de chargement : local_files_only=%s, trust_remote_code=True" % ("True" if cuites else "False"),
                 chargements[0]["options"].get("local_files_only") == ("True" if cuites else "False")
                 and chargements[0]["options"].get("trust_remote_code") == "True",
                 "local_files_only=%s (attendu %s) trust_remote_code=%s" % (
                     chargements[0]["options"].get("local_files_only"), "True" if cuites else "False",
                     chargements[0]["options"].get("trust_remote_code")))
    else:
        sortie["journal_lucida"] = lignes
        print("LUCIDA INDISPONIBLE dans ce conteneur : %s" % lignes, flush=True)

    # --- phase B : un seul chargement sous 4 fils concurrents (apres reinitialisation) ---------------------------------------------
    chargements.clear()
    D.reinitialiser_lucida()
    barriere = threading.Barrier(4)
    resultats, erreurs = [], []

    def tache():
        try:
            barriere.wait(timeout=60)
            resultats.append(np.asarray(D.detourer(premiere))[..., 3])
        except BaseException as e:  # noqa: BLE001
            erreurs.append("%s: %s" % (type(e).__name__, e))

    t0 = time.time()
    fils = [threading.Thread(target=tache) for _ in range(4)]
    for f in fils:
        f.start()
    for f in fils:
        f.join(600)
    ecart_fils = max((int(np.abs(r.astype(int) - resultats[0].astype(int)).max()) for r in resultats), default=-1)
    sortie["concurrence"] = {"duree_s": round(time.time() - t0, 2), "erreurs": erreurs, "chargements": len(chargements),
                             "ecart_max_entre_fils": ecart_fils}
    verifier("detourer concurrent (4 fils) ne leve jamais", not erreurs and len(resultats) == 4, "erreurs=%s" % erreurs)
    if lucida_ok:
        verifier("un seul chargement sous 4 fils concurrents", len(chargements) == 1, "from_pretrained appele %d fois" % len(chargements))
        verifier("resultats concurrents coherents (ecart <= 3)", 0 <= ecart_fils <= 3, "ecart max %d" % ecart_fils)
    else:
        verifier("repli : jamais plus d'UNE tentative de chargement sous 4 fils", len(chargements) <= 1, "%d tentative(s)" % len(chargements))

    # --- non-determinisme de Lucida (information) -------------------------------------------------------------------------------
    if lucida_ok:
        a1, a2 = np.asarray(D.masque_lucida(premiere)), np.asarray(D.masque_lucida(premiere))
        sortie["lucida_ecart_entre_deux_passes"] = int(np.abs(a1.astype(int) - a2.astype(int)).max())

    # --- phase C : les 36 images, modes u2net puis union, avec le modele charge ---------------------------------------------------
    torch.cuda.reset_peak_memory_stats()
    D.detourer(premiere)                       # echauffement hors mesure (noyaux GPU)
    lignes_planche = []
    T = 256
    echecs_u2 = []
    echecs_inclusion = []
    echecs_fusion = []
    echecs_repli = []
    echecs_appels = []
    alertes = []                                   # information seulement (ne fait pas echouer le banc)
    for nom, img in sources:
        os.environ["FABMESH_DETOURAGE"] = "u2net"
        appels_avant = espion["appels"]
        res_u2, _, t_u2 = capter(D.detourer, img)
        if espion["appels"] != appels_avant:
            echecs_appels.append(nom + " (u2net a sollicite Lucida)")
        ancien = detourer_ancien(img)
        identique = (res_u2.mode, res_u2.size, res_u2.tobytes()) == (ancien.mode, ancien.size, ancien.tobytes())
        if not identique:
            echecs_u2.append(nom)
        os.environ["FABMESH_DETOURAGE"] = "union"
        espion["lucida"] = None
        appels_avant = espion["appels"]
        res_un, journal, t_un = capter(D.detourer, img)
        os.environ.pop("FABMESH_DETOURAGE", None)
        if espion["appels"] - appels_avant != 1:
            echecs_appels.append("%s (union : %d appels a Lucida)" % (nom, espion["appels"] - appels_avant))

        a_u2_alpha = np.asarray(res_u2)[..., 3]
        a_un_alpha = np.asarray(res_un)[..., 3]
        entree = {"nom": nom, "taille": list(img.size), "mode_u2net_identique_ancien": bool(identique),
                  "t_u2net_ms": t_u2, "t_union_ms": t_un, "journal": journal[-1] if journal else ""}
        b_u2 = a_u2_alpha >= SEUIL
        b_un = a_un_alpha >= SEUIL
        entree.update({"aire_u2net": round(float(b_u2.mean()), 4), "aire_union": round(float(b_un.mean()), 4),
                       "morceaux_u2net": morceaux(b_u2), "morceaux_union": morceaux(b_un)})
        if lucida_ok:
            a_lu = np.asarray(espion["lucida"])           # le masque que detourer(union) a reellement utilise
            b_lu = a_lu >= SEUIL
            d = diagnostic_masques(a_u2_alpha, a_lu)       # alpha du mode u2net = masque u2net (entree opaque)
            attendu = fusionner_alphas(a_u2_alpha, a_lu)
            ecart_fusion = int(np.abs(attendu.astype(int) - a_un_alpha.astype(int)).max())
            inclus = bool((b_u2 <= b_un).all() and (b_lu <= b_un).all())
            entree.update({"aire_lucida": round(float(b_lu.mean()), 4), "u2net_manque": round(d["u2net_manque"], 4),
                           "lucida_manque": round(d["lucida_manque"], 4), "lucida_defaillant": d["lucida_defaillant"],
                           "u2net_defaillant": d["u2net_defaillant"], "union_contient_les_deux": inclus,
                           "ecart_fusion_attendue": ecart_fusion, "morceaux_lucida": morceaux(b_lu),
                           "ajout_vs_u2net": round(float((b_un & ~b_u2).sum() / max(int(b_u2.sum()), 1)), 4)})
            if not inclus or float(b_un.mean()) + 1e-9 < max(float(b_u2.mean()), float(b_lu.mean())):
                echecs_inclusion.append(nom)
            if ecart_fusion != 0:
                echecs_fusion.append("%s (ecart %d)" % (nom, ecart_fusion))
            # l'union ne corrige que les defauts PAR DEFAUT de sujet : un masque Lucida presque plein (arriere-plan garde) ferait une
            # union presque pleine, donc AUCUN detourage. Jamais observe (36 images, 03/10) mais a surveiller sur les nouvelles images.
            if entree["aire_lucida"] >= 0.90 or entree["aire_union"] >= 0.90:
                alertes.append("%s : Lucida %.0f %%, union %.0f %% de l'image (arriere-plan garde ?)" % (
                    nom, 100 * entree["aire_lucida"], 100 * entree["aire_union"]))
            if entree["ajout_vs_u2net"] > 0.5 and not nom.startswith(("orc_", "ab_")):
                alertes.append("%s : l'union ajoute %.0f %% a u2net hors des cas de T-pose (a regarder sur la planche)" % (
                    nom, 100 * entree["ajout_vs_u2net"]))
            diff = np.zeros(b_un.shape + (3,), np.uint8) + 90
            diff[b_u2] = (235, 235, 235)
            diff[b_un & ~b_u2] = (230, 40, 40)          # rouge : ce que l'union AJOUTE a u2net
            etiquette = "%s | u2net %.1f %% | union %.1f %% (+%.1f %%) | %d / %d ms" % (
                nom[:30], 100 * entree["aire_u2net"], 100 * entree["aire_union"], 100 * entree["ajout_vs_u2net"], t_u2, t_un)
        else:
            if (res_un.mode, res_un.size, res_un.tobytes()) != (res_u2.mode, res_u2.size, res_u2.tobytes()):
                echecs_repli.append(nom)
            diff = np.full(b_un.shape + (3,), 90, np.uint8)
            etiquette = "%s | Lucida indisponible : repli u2net | %d / %d ms" % (nom[:30], t_u2, t_un)
        sortie["images"].append(entree)
        panneaux = [img.convert("RGB"), sur_blanc(img, a_u2_alpha), sur_blanc(img, a_un_alpha), Image.fromarray(diff)]
        ligne = Image.new("RGB", (T * 4, T + 14), (20, 20, 28))
        for k, p in enumerate(panneaux):
            ligne.paste(p.resize((T, T), Image.LANCZOS), (k * T, 14))
        ImageDraw.Draw(ligne).text((4, 1), etiquette, fill=(235, 235, 240))
        lignes_planche.append(ligne)

    sortie["alertes"] = alertes
    sortie["vram_fin"] = vram()
    sortie["vram_pic_mo"] = int(torch.cuda.max_memory_allocated() // 2 ** 20)

    # --- verdicts -----------------------------------------------------------------------------------------------------------------
    verifier("Lucida n'est jamais sollicite en mode u2net, et une fois par appel en mode union (si disponible)",
             (not echecs_appels) if lucida_ok else True, str(echecs_appels[:5]))
    verifier("mode u2net == ancien comportement (octets RGBA identiques)", not echecs_u2,
             "%d image(s) differentes : %s" % (len(echecs_u2), echecs_u2[:5]) if echecs_u2 else "%d images identiques" % len(sources))
    if lucida_ok:
        verifier("union >= chaque masque (inclusion pixel a pixel au seuil 127)", not echecs_inclusion, str(echecs_inclusion[:5]))
        verifier("union == fusionner_alphas(u2net, Lucida) exactement", not echecs_fusion, str(echecs_fusion[:5]))
        paires = [e for e in sortie["images"] if e["nom"].startswith("paire_")]
        trop = [(e["nom"], e["ajout_vs_u2net"]) for e in paires if e["ajout_vs_u2net"] >= 0.03]
        verifier("produits a fond blanc : l'union ne depasse u2net que de < 3 %% (%d images)" % len(paires), not trop, str(trop[:5]))
        ane = [e for e in sortie["images"] if e["nom"] == "paire_04_ne"]
        verifier("l'ane est complet (union >= 95 % de u2net et > 3 x Lucida)",
                 bool(ane) and ane[0]["aire_union"] >= 0.95 * ane[0]["aire_u2net"] and ane[0]["aire_union"] > 3 * ane[0]["aire_lucida"],
                 str(ane[0] if ane else "paire_04_ne absente des images"))
    else:
        verifier("repli : union == u2net seul, a l'octet, sur toutes les images", not echecs_repli, str(echecs_repli[:5]))

    def med(cle, groupe):
        v = [e[cle] for e in sortie["images"] if groupe(e["nom"]) and cle in e]
        return round(statistics.median(v), 4) if v else None

    groupes = {"T-pose fond gris (orc + A/B avant/apres)": lambda n: n.startswith(("orc_", "ab_A_", "ab_B_")),
               "pose libre (A/B C)": lambda n: n.startswith("ab_C_"), "produits (paire_*)": lambda n: n.startswith("paire_")}
    sortie["resume_groupes"] = {g: {"n": sum(1 for e in sortie["images"] if f(e["nom"])),
                                    "aire_u2net_mediane": med("aire_u2net", f), "aire_union_mediane": med("aire_union", f),
                                    "ajout_vs_u2net_median": med("ajout_vs_u2net", f), "t_u2net_ms_median": med("t_u2net_ms", f),
                                    "t_union_ms_median": med("t_union_ms", f)} for g, f in groupes.items()}

    par_planche = 8
    for d0 in range(0, len(lignes_planche), par_planche):
        bloc = lignes_planche[d0:d0 + par_planche]
        feuille = Image.new("RGB", (T * 4, (T + 14) * len(bloc)), (20, 20, 28))
        for k, lg in enumerate(bloc):
            feuille.paste(lg, (0, k * (T + 14)))
        tampon = io.BytesIO()
        feuille.save(tampon, format="PNG")
        sortie["planches"].append(tampon.getvalue())
    return sortie


@app.function(gpu="L40S", timeout=1500, image=mesh_image)
def mesurer_mesh(images: list, noms: list, cuites: bool) -> dict:
    return _mesurer(images, noms, cuites, "mesh")


@app.function(gpu="L40S", timeout=1500, image=image_backview)
def mesurer_backview(images: list, noms: list, cuites: bool) -> dict:
    return _mesurer(images, noms, cuites, "backview")


@app.local_entrypoint()
def main(cuites: bool = False, conteneur: str = "mesh"):
    import json
    import os

    from PIL import Image

    cibles = {"mesh": ["mesh"], "backview": ["backview"], "les-deux": ["mesh", "backview"]}.get(conteneur)
    if cibles is None:
        raise SystemExit("--conteneur : mesh, backview ou les-deux (recu %r)" % conteneur)

    # memes sources que modal_app/test_lucida_vs_u2net.py
    racine_p = "C:/tmp/fidelite/paires_r2"
    fichiers = [("orc_verif_t80", "images/verif_t80_orc/ref_0.png")]
    for bras in ("A_avant", "B_apres", "C_libre"):
        d = "C:/tmp/fidelite/ab/orc1/" + bras
        for f in sorted(os.listdir(d)):
            if f.startswith("ref_") and f.endswith(".png"):
                fichiers.append(("ab_%s_%s" % (bras, f[4:-4]), d + "/" + f))
    for nom in sorted(os.listdir(racine_p)):
        p = os.path.join(racine_p, nom, "ref.png")
        if os.path.exists(p) and Image.open(p).mode == "RGB":      # les RGBA sont deja detoures : la preparation d'image ne les remasque pas
            fichiers.append(("paire_" + nom, p))
    noms = [n for n, _ in fichiers]
    images = [open(p, "rb").read() for _, p in fichiers]
    print("%d images, %.1f Mo" % (len(images), sum(len(b) for b in images) / 1e6))

    dest = "C:/tmp/fidelite/lucida_union"
    os.makedirs(dest, exist_ok=True)
    echec = False
    for cible in cibles:
        r = (mesurer_mesh if cible == "mesh" else mesurer_backview).remote(images, noms, cuites)
        for k, png in enumerate(r.pop("planches")):
            open("%s/planche_%s_%d.png" % (dest, cible, k + 1), "wb").write(png)
        json.dump(r, open("%s/metriques_%s.json" % (dest, cible), "w", encoding="utf-8"), indent=1, ensure_ascii=False)

        print("\n==================== conteneur %s (poids %s) ====================" % (cible, "cuits dans l'image" if cuites else "telecharges"))
        print("versions :", r["versions"])
        print("Lucida disponible : %s | precharger : %s" % (r["lucida_disponible"], r["precharger"]))
        if not r["lucida_disponible"]:
            print("  journal :", r.get("journal_lucida"))
        print("concurrence (4 fils) :", r["concurrence"])
        print("VRAM fin :", r["vram_fin"], "| pic", r["vram_pic_mo"], "Mo")
        print("%-34s %6s %6s %6s %7s %7s %7s %4s %4s %6s %6s %s" % (
            "image", "aireU", "aireL", "aireUn", "+/U2", "u2miss", "lumiss", "cU", "cUn", "ms_u2", "ms_un", "u2==ancien"))
        for e in r["images"]:
            print("%-34s %6.3f %6s %6.3f %7s %7s %7s %4d %4d %6d %6d %s" % (
                e["nom"][:34], e["aire_u2net"], ("%.3f" % e["aire_lucida"]) if "aire_lucida" in e else "-", e["aire_union"],
                ("%.1f%%" % (100 * e["ajout_vs_u2net"])) if "ajout_vs_u2net" in e else "-",
                ("%.1f%%" % (100 * e["u2net_manque"])) if "u2net_manque" in e else "-",
                ("%.1f%%" % (100 * e["lucida_manque"])) if "lucida_manque" in e else "-",
                e["morceaux_u2net"], e["morceaux_union"], e["t_u2net_ms"], e["t_union_ms"], e["mode_u2net_identique_ancien"]))
        for g, v in r["resume_groupes"].items():
            print("== %s : %s" % (g, v))
        for a in r.get("alertes", []):
            print("[ALERTE] " + a)
        for v in r["verifications"]:
            print("[%s] %s %s" % ("PASS" if v["ok"] else "FAIL", v["nom"], v["detail"]))
            echec = echec or not v["ok"]
        print("planches et metriques dans", dest)
    if echec:
        raise SystemExit(1)
