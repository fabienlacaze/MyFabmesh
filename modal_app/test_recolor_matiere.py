"""Banc « Recolor » (couleur, matiere, style) sur la VRAIE image Modal — hors production, jamais deploye.

POURQUOI. La voie matiere / style de l'op `recolor` (re-rendu ControlNet-Tile masque par CLIPSeg, commit 784ce6f3,
decision du user « meme capacite que le PC ») n'avait jamais tourne sur l'image Modal. Le banc refait A L'IDENTIQUE
l'aiguillage de l'op `recolor` de app.py (parse_recolor_prompt -> recolor_tile_route -> generate ou generate_tile, memes
arguments), avec CLIPSeg charge comme MyFabmeshBackview._charger_auto_inpaint (entree 512 px) et le pipe Tile de
_charger_pipe_tile (celui de _get_tile_pipe).

CE QU'IL VERIFIE, cas par cas (prompts tels que les envoie la fenetre Recolor : « One part » = partie + couleur,
« Whole image » = couleur seule, « Style » = texte libre, toujours sur toute l'image) :
  - la route prise (teinte = virage HSV ; matiere = re-rendu) ;
  - le reste est garde : une PARTIE -> hors du masque, pixels IDENTIQUES a la source ; TOUTE l'image -> silhouette et
    contours gardes ;
  - la couleur ou la matiere change vraiment dans la zone visee (teinte, saturation, ecart moyen).

Execution EPHEMERE (app a part : rien n'est deploye, les instantanes de myfabmesh-cloud ne bougent pas) :
    PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python -m modal run modal_app/test_recolor_matiere.py \
        --fichier docs/screenshots/v2/guerrier-image.jpg --sortie C:/tmp/recolor_matiere
Cout : un L40S quelques minutes (~0,10 $) ; ~6 min de bout en bout le 2026-09-30 (CLIPSeg 1,4 s, pipe Tile 10,7 s,
teinte 0,7 s, re-rendu 3-3,6 s par cas).

Mesure du 2026-09-30 (fond sombre) : 6 cas sur 6 sans erreur ; teinte OK (hors masque identique au pixel, luminosite
gardee) ; Style = vraie nouvelle matiere mais la forme bouge (IoU silhouette 0,69-0,71) ; matiere sur une PARTIE
(API seule) : presque rien ne change (denoise 0,18). Le halo de la marge sur un fond de STUDIO blanc (bloc rose de
110 niveaux) est corrige depuis (recolor_garder_fond) : un fond blanc se verifie avec une image a fond blanc (--fichier).

Relire les mesures SANS GPU (images deja rendues dans le dossier de sortie) :
    PYTHONUTF8=1 python -m modal_app.test_recolor_matiere C:/tmp/recolor_matiere
"""
import modal

from modal_app.app import image

app = modal.App("myfabmesh-test-recolor-matiere", image=image)

# route attendue : « teinte » (virage HSV) ou « matiere » (re-rendu) ; zone : ou mesurer le changement sur toute l'image
# (« premier_plan » = tout ce qui n'est pas le fond, sinon une region CLIPSeg de REGIONS) ; cible : teinte visee, en degres.
CAS = [
    {"nom": "1_partie_couleur", "prompt": "helmet red", "recolor_all": False, "route_attendue": "teinte", "cible": 0},
    {"nom": "2_image_couleur", "prompt": "blue", "recolor_all": True, "route_attendue": "teinte",
     "zone": "premier_plan", "cible": 220},
    {"nom": "3_partie_or", "prompt": "armor gold", "recolor_all": False, "route_attendue": "teinte", "cible": 45},
    {"nom": "4_style_gold_armor", "prompt": "gold armor", "recolor_all": True, "route_attendue": "matiere",
     "zone": "armor"},
    {"nom": "5_style_rusty_metal", "prompt": "rusty metal", "recolor_all": True, "route_attendue": "matiere",
     "zone": "metal"},
    # une matiere sur une PARTIE : la fenetre ne l'envoie pas (« One part » exige une couleur), l'API l'accepte
    {"nom": "6_partie_matiere", "prompt": "rusty metal helmet", "recolor_all": False, "route_attendue": "matiere"},
]
REGIONS = ["helmet", "armor", "metal"]   # masques CLIPSeg de MESURE (sans dilatation), calcules sur la source


def _png(img) -> bytes:
    import io
    b = io.BytesIO()
    img.save(b, "PNG")
    return b.getvalue()


@app.function(gpu="L40S", timeout=1200)
def essai(source: bytes, cas: list) -> dict:
    import hashlib
    import io
    import os
    import time
    import traceback

    import diffusers
    import torch
    import transformers
    from PIL import Image
    from transformers import CLIPSegForImageSegmentation, CLIPSegProcessor

    import modal_app
    from modal_app._recolor import (_image_de_travail, _masque_clipseg, generate as recolor_generate,
                                    generate_tile as recolor_generate_tile, parse_recolor_prompt,
                                    recolor_masque_a_taille, recolor_meilleur_masque, recolor_tile_route)
    from modal_app.app import _charger_pipe_tile

    # str() : torch.__version__ est un TorchVersion, qui ferait importer torch au poste local en relisant le resultat
    meta = {"gpu": str(torch.cuda.get_device_name(0)), "torch": str(torch.__version__),
            "diffusers": str(diffusers.__version__), "transformers": str(transformers.__version__)}
    chemin = os.path.join(os.path.dirname(modal_app.__file__), "_recolor.py")
    meta["recolor_py_sha256"] = hashlib.sha256(open(chemin, "rb").read()).hexdigest()

    # CLIPSeg exactement comme MyFabmeshBackview._charger_auto_inpaint (entree relevee a 512 px)
    t = time.time()
    seg_proc = CLIPSegProcessor.from_pretrained("CIDAS/clipseg-rd64-refined")
    try:
        seg_proc.image_processor.size = {"height": 512, "width": 512}
    except Exception:
        pass
    seg_model = CLIPSegForImageSegmentation.from_pretrained("CIDAS/clipseg-rd64-refined").to("cuda").eval()
    meta["clipseg_chargement_s"] = round(time.time() - t, 1)

    tuile = {}

    def pipe_tile():   # paresseux, comme _get_tile_pipe
        if "pipe" not in tuile:
            t0 = time.time()
            tuile["pipe"] = _charger_pipe_tile(decharger_cpu=False)
            meta["tile_chargement_s"] = round(time.time() - t0, 1)
        return tuile["pipe"]

    src = Image.open(io.BytesIO(source)).convert("RGB")   # comme _fetch_image
    travail, w, h = _image_de_travail(src)
    regions = {r: _png(recolor_masque_a_taille(
        _masque_clipseg(seg_proc, seg_model, travail, w, h, r, 0, 0.5), src.size)) for r in REGIONS}

    sorties = []
    for c in cas:
        r = {k: c[k] for k in c}
        prompt = c["prompt"].strip()
        strength, dilate, tout = float(c.get("strength") or 1.0), int(c.get("dilate") or 15), bool(c["recolor_all"])
        # --- aiguillage de l'op `recolor` de app.py, a l'identique ---
        noun, spec = parse_recolor_prompt(prompt)
        matiere = recolor_tile_route(spec, prompt, tout)
        r["route"] = "matiere" if matiere else "teinte"
        r["cible_clipseg"] = noun
        try:
            pipe = pipe_tile() if matiere else None
            t = time.time()
            if matiere:
                img, couverture = recolor_generate_tile(seg_proc, seg_model, pipe, src, prompt,
                                                        strength=strength, dilate=dilate, recolor_all=tout)
            else:
                img, couverture = recolor_generate(seg_proc, seg_model, src, prompt,
                                                   strength=strength, dilate=dilate, recolor_all=tout)
            r["duree_s"] = round(time.time() - t, 2)
            r["couverture"] = round(float(couverture), 2)
            r["png"] = _png(img)
            if not tout:
                # le MEME masque que celui de la fonction appelee (memes appels, memes arguments), pour mesurer
                def masquer(texte):
                    return _masque_clipseg(seg_proc, seg_model, travail, w, h, texte, dilate, 0.5)
                m = masquer(noun or prompt) if matiere else recolor_meilleur_masque(noun or prompt, masquer)[0]
                r["masque_png"] = _png(recolor_masque_a_taille(m, src.size))
        except ValueError as e:          # partie introuvable : 422 rembourse en production
            r["erreur_422"] = str(e)
        except Exception as e:
            r["erreur"] = f"{type(e).__name__}: {e}"
            r["trace"] = traceback.format_exc()[-3000:]
        print(f"[banc] {c['nom']} route={r['route']} couverture={r.get('couverture')} duree={r.get('duree_s')} "
              f"{r.get('erreur') or r.get('erreur_422') or ''}", flush=True)
        sorties.append(r)
    return {"meta": meta, "source_png": _png(src), "regions": regions, "cas": sorties}


# ---------------------------------------------------------------------------
# Mesures (poste local, numpy + PIL, aucun modele) : relisibles sans GPU.
# ---------------------------------------------------------------------------
def _lire(chemin, mode="RGB"):
    import numpy as np
    from PIL import Image
    return np.asarray(Image.open(chemin).convert(mode))


def _hsv(rgb):
    import numpy as np
    from PIL import Image
    return np.asarray(Image.fromarray(rgb, "RGB").convert("HSV")).astype(np.float32)


def _teinte(hsv, sel):
    """Teinte moyenne CIRCULAIRE (degres), ponderee par la saturation ; None si la zone n'a aucune couleur."""
    import numpy as np
    h = hsv[..., 0][sel] * (2 * np.pi / 255.0)
    s = hsv[..., 1][sel] / 255.0
    if s.size == 0 or s.sum() < 1e-3:
        return None
    return round(float(np.degrees(np.arctan2((np.sin(h) * s).sum(), (np.cos(h) * s).sum())) % 360), 1)


def _ecart_teinte(a, b):
    if a is None or b is None:
        return None
    d = abs(a - b) % 360
    return round(min(d, 360 - d), 1)


def _premier_plan(rgb):
    """Tout ce qui s'ecarte de la couleur du fond (mediane du bord de l'image)."""
    import numpy as np
    bord = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]]).astype(np.float32)
    fond = np.median(bord, axis=0)
    return np.sqrt(((rgb.astype(np.float32) - fond) ** 2).sum(-1)) > 40


def _contours(rgb):
    import numpy as np
    g = rgb.astype(np.float32) @ np.array([0.299, 0.587, 0.114], np.float32)
    gy, gx = np.gradient(g)
    return np.hypot(gx, gy)


def _correlation(a, b, sel):
    import numpy as np
    a, b = a[sel].ravel(), b[sel].ravel()
    if a.size < 100 or a.std() < 1e-6 or b.std() < 1e-6:
        return None
    return round(float(np.corrcoef(a, b)[0, 1]), 3)


def _stats_zone(src, out, sel):
    import numpy as np
    hs, ho = _hsv(src), _hsv(out)
    d = np.abs(out.astype(np.float32) - src.astype(np.float32)).mean(-1)
    return {"pixels": int(sel.sum()),
            "ecart_moyen": round(float(d[sel].mean()), 2) if sel.any() else None,
            "teinte_avant": _teinte(hs, sel), "teinte_apres": _teinte(ho, sel),
            "saturation_avant": round(float(hs[..., 1][sel].mean() / 255), 3) if sel.any() else None,
            "saturation_apres": round(float(ho[..., 1][sel].mean() / 255), 3) if sel.any() else None,
            "valeur_ecart_moyen": round(float(np.abs(ho[..., 2] - hs[..., 2])[sel].mean()), 2) if sel.any() else None,
            "contours_correlation": _correlation(_contours(src), _contours(out), sel)}


def evaluer(c, src, out, masque, regions):
    """Verdict d'un cas. `masque` : masque de la partie (taille d'origine) ou None ; `regions` : {nom: masque}."""
    import numpy as np
    from PIL import Image, ImageFilter
    r = {"route_ok": c["route"] == c["route_attendue"]}
    diff = np.abs(out.astype(np.int16) - src.astype(np.int16)).max(-1)
    if not c["recolor_all"]:
        # hors masque = masque elargi de 5 px nul (marge contre un bord recalcule different d'un pixel)
        dehors = np.asarray(Image.fromarray(masque, "L").filter(ImageFilter.MaxFilter(11))) == 0
        r["hors_masque_pixels"] = int(dehors.sum())
        r["hors_masque_ecart_max"] = int(diff[dehors].max()) if dehors.any() else None
        r["hors_masque_pixels_changes"] = int((diff[dehors] > 0).sum())
        r["reste_garde"] = r["hors_masque_ecart_max"] == 0
        zone = masque >= 250
    else:
        pp_s, pp_o = _premier_plan(src), _premier_plan(out)
        r["silhouette_iou"] = round(float((pp_s & pp_o).sum() / max(1, (pp_s | pp_o).sum())), 3)
        r["contours_correlation_image"] = _correlation(_contours(src), _contours(out), np.ones(pp_s.shape, bool))
        r["fond_ecart_moyen"] = round(float(np.abs(out.astype(np.float32) - src.astype(np.float32))[~pp_s].mean()), 2)
        # seuils larges : les zones sombres proches du fond basculent d'un cote ou de l'autre (IoU 0,86 pour un simple
        # virage de teinte, luminosite pourtant gardee au niveau pres) ; la planche reste le juge final
        r["reste_garde"] = bool(r["silhouette_iou"] >= 0.8 and (r["contours_correlation_image"] or 0) >= 0.4)
        zone = pp_s if c.get("zone") == "premier_plan" else (regions[c["zone"]] >= 128)
    r["zone"] = _stats_zone(src, out, zone)
    if c["route_attendue"] == "teinte":
        r["ecart_a_la_teinte_cible"] = _ecart_teinte(r["zone"]["teinte_apres"], c["cible"])
        r["change"] = bool(r["ecart_a_la_teinte_cible"] is not None and r["ecart_a_la_teinte_cible"] <= 25
                           and (r["zone"]["valeur_ecart_moyen"] or 0) <= 2)
    else:
        r["change"] = bool((r["zone"]["ecart_moyen"] or 0) >= 10)
    r["verdict"] = "OK" if (r["route_ok"] and r["reste_garde"] and r["change"]) else "A VOIR"
    return r


def _planche(sortie, cas):
    """Source + chaque sortie, cote a cote, pour l'oeil."""
    import os
    from PIL import Image, ImageDraw
    vignettes = [("source", os.path.join(sortie, "source.png"))]
    vignettes += [(f"{c['nom']} ({c['route']})", os.path.join(sortie, c["nom"] + ".png"))
                  for c in cas if os.path.exists(os.path.join(sortie, c["nom"] + ".png"))]
    lw, lh, cols = 400, 300, 3
    lignes = (len(vignettes) + cols - 1) // cols
    planche = Image.new("RGB", (lw * cols, (lh + 20) * lignes), (255, 255, 255))
    dessin = ImageDraw.Draw(planche)
    for i, (titre, chemin) in enumerate(vignettes):
        x, y = (i % cols) * lw, (i // cols) * (lh + 20)
        im = Image.open(chemin).convert("RGB")
        im.thumbnail((lw, lh))
        planche.paste(im, (x, y + 20))
        dessin.text((x + 4, y + 4), titre, fill=(0, 0, 0))
    planche.save(os.path.join(sortie, "planche.png"))


def mesurer(sortie):
    import json
    import os
    cas = json.load(open(os.path.join(sortie, "cas.json"), encoding="utf-8"))
    src = _lire(os.path.join(sortie, "source.png"))
    regions = {r: _lire(os.path.join(sortie, f"region_{r}.png"), "L") for r in REGIONS}
    resultats = []
    for c in cas:
        ligne = {"nom": c["nom"], "prompt": c["prompt"], "route": c["route"], "couverture": c.get("couverture"),
                 "duree_s": c.get("duree_s")}
        if c.get("erreur") or c.get("erreur_422"):
            ligne["verdict"] = "ERREUR"
            ligne["erreur"] = c.get("erreur") or c.get("erreur_422")
        else:
            out = _lire(os.path.join(sortie, c["nom"] + ".png"))
            masque = None if c["recolor_all"] else _lire(os.path.join(sortie, c["nom"] + "_masque.png"), "L")
            ligne.update(evaluer(c, src, out, masque, regions))
        resultats.append(ligne)
        print(json.dumps(ligne, ensure_ascii=False))
    json.dump(resultats, open(os.path.join(sortie, "mesures.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    try:
        _planche(sortie, cas)
    except Exception as e:   # la planche n'est qu'un confort
        print("planche impossible :", e)
    ok = sum(1 for x in resultats if x["verdict"] == "OK")
    print(f"[banc recolor] {ok}/{len(resultats)} cas OK — detail : {os.path.join(sortie, 'mesures.json')}")
    return resultats


@app.local_entrypoint()
def main(fichier: str = "docs/screenshots/v2/guerrier-image.jpg", sortie: str = "C:/tmp/recolor_matiere"):
    import json
    import os
    os.makedirs(sortie, exist_ok=True)
    res = essai.remote(open(fichier, "rb").read(), CAS)
    # tout ECRIRE avant de mesurer : une erreur de mesure ne doit pas perdre le calcul GPU
    open(os.path.join(sortie, "source.png"), "wb").write(res["source_png"])
    for nom, octets in res["regions"].items():
        open(os.path.join(sortie, f"region_{nom}.png"), "wb").write(octets)
    cas = []
    for c in res["cas"]:
        if c.get("png"):
            open(os.path.join(sortie, c["nom"] + ".png"), "wb").write(c.pop("png"))
        if c.get("masque_png"):
            open(os.path.join(sortie, c["nom"] + "_masque.png"), "wb").write(c.pop("masque_png"))
        cas.append(c)
    json.dump(cas, open(os.path.join(sortie, "cas.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    json.dump(res["meta"], open(os.path.join(sortie, "meta.json"), "w", encoding="utf-8"), indent=2)
    print(json.dumps(res["meta"], indent=2))
    for c in cas:
        if c.get("trace"):
            print(f"--- {c['nom']} ---\n{c['trace']}")
    mesurer(sortie)


if __name__ == "__main__":
    import sys
    mesurer(sys.argv[1] if len(sys.argv) > 1 else "C:/tmp/recolor_matiere")
