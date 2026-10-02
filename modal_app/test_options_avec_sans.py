"""BANC (2026-10-02) : cout GPU MARGINAL de chaque option de la generation 3D, mesure « avec - sans » sur le VRAI conteneur deploye.

Pourquoi : la table `jobs` ne permet pas de lire l'ecart de duree d'une option (119 generations en 30 j, ecart-type 244 s : demarrages a froid ; les cases sont cochees
ENSEMBLE par les profils d'asset). Ici : MEME image, MEME graine, conteneur chaud, paires « base / base + option » INTERCALEES (la derive du conteneur touche les deux).
Aucune ecriture dans R2 ni dans Supabase : l'identifiant `bench_*` ne declenche pas la livraison du worker (`_prevenir_worker` ignore ce qui ne commence pas par `modal_`) ;
le GLB va sur le volume, efface aussitot.

    PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python -m modal_app.test_options_avec_sans --dry-run
    PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python -m modal_app.test_options_avec_sans --budget-min 85 --repeats 2

COUT : ~100 s de L40S par generation (0,000542 USD/s) : ~40 generations = ~2,5 USD, plafonne par --budget-min. Le redressement (appel a part, cote worker) n'est PAS mesure ici.
Resultats : C:/tmp/bench_options.json (ecrit apres chaque generation : un arret en cours de route garde ce qui est fait).
"""
import argparse
import io
import json
import os
import statistics
import sys
import time
import uuid

import modal

APP = "myfabmesh-cloud"
CLASSE = "MyFabmeshMesh"
VOLUME = "myfabmesh-mesh-output"
EUR_PAR_SECONDE = 0.000542 * 0.93      # L40S, en euros (taux utilise par le tableau de bord)
SORTIE = "C:/tmp/bench_options.json"
RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLE_IMAGE = "dda6546a-562b-4a8d-b533-eb9aa535f9b6/front/1790873441895_71262759.png"      # compte proprietaire, personnage de face, fond uni

# Palier « balanced » du site (PALIERS du worker) : 24 pas, atlas 2048, grille 1024, 500 K triangles.
BASE = dict(mode="1024", seed=42, decimation_target=500_000, texture_size=2048, tex_steps=24, tris_exact=False)
OPTIONS = {   # ce que le worker envoie a Modal quand la case est cochee (voir handleGenerate)
    "ultra_hd": dict(ultra_hd=True, texture_size=4096),                       # le worker passe l'atlas a 4096 pour l'agrandissement x2
    "ultra_q": dict(mode="1536_cascade", ultra_q=True),
    "quality_plus": dict(mode="1024_cascade", quality_plus=True),
    "smooth": dict(smooth=True),
    "face_fix": dict(face_fix=True),
    "refine": dict(refine=True),
    "tris_2M": dict(decimation_target=2_000_000, tris_exact=True),
}
PALIERS = {
    "fast": dict(texture_size=1024),
    "quality": dict(texture_size=4096, tex_steps=32),
    "ultra_8k": dict(texture_size=4096, tex_steps=32, ultra_hd=True),
}


def charger_env():
    cfg = {}
    for ligne in io.open(os.path.join(RACINE, "cloud", ".env.local"), encoding="utf-8"):
        ligne = ligne.strip()
        if ligne and not ligne.startswith("#") and "=" in ligne:
            k, v = ligne.split("=", 1)
            cfg[k.strip()] = v.strip().strip('"').strip("'")
    return cfg


def url_image():
    import boto3
    cfg = charger_env()
    s3 = boto3.client("s3", endpoint_url="https://%s.r2.cloudflarestorage.com" % cfg["R2_ACCOUNT_ID"],
                      aws_access_key_id=cfg["R2_ACCESS_KEY_ID"], aws_secret_access_key=cfg["R2_SECRET_ACCESS_KEY"], region_name="auto")
    bucket = cfg.get("R2_BUCKET_NAME") or cfg.get("R2_BUCKET") or "myfabmesh-meshes"
    return s3.generate_presigned_url("get_object", Params={"Bucket": bucket, "Key": CLE_IMAGE}, ExpiresIn=6 * 3600)


def plan(repeats, seulement=None):
    """Liste ordonnee des generations : (etiquette, groupe, extra, mesuree?). `seulement` = liste de noms de PALIERS : on ne mesure alors que ceux-la (2e passage)."""
    if seulement:
        etapes = []
        for nom in seulement:
            extra = PALIERS[nom]
            etapes.append((nom, "palier|" + nom + "|chauffe", extra, False))
            for i in range(repeats):
                etapes.append((nom, "palier|" + nom, extra, True))
        return etapes
    etapes = [("base", "chauffe", {}, False)]
    for nom, extra in OPTIONS.items():
        etapes.append((nom, nom + "|chauffe", extra, False))                 # 1re generation d'une configuration : compile les noyaux GPU de sa taille, ecartee
        for i in range(repeats):
            etapes.append(("base", nom + "|sans", {}, True))
            etapes.append((nom, nom + "|avec", extra, True))
    for nom, extra in PALIERS.items():
        etapes.append((nom, "palier|" + nom + "|chauffe", extra, False))
        for i in range(repeats):
            etapes.append((nom, "palier|" + nom, extra, True))
    return etapes


def resume(res):
    out = {}
    for nom in OPTIONS:
        sans = [r["dt"] for r in res if r["mesuree"] and r["ok"] and r["groupe"] == nom + "|sans"]
        avec = [r["dt"] for r in res if r["mesuree"] and r["ok"] and r["groupe"] == nom + "|avec"]
        n = min(len(sans), len(avec))
        if n == 0:
            continue
        diffs = [avec[i] - sans[i] for i in range(n)]
        d = statistics.mean(diffs)
        se = statistics.stdev(diffs) / (n ** 0.5) if n > 1 else None
        out[nom] = {"paires": n, "sans_s": round(statistics.mean(sans[:n]), 1), "avec_s": round(statistics.mean(avec[:n]), 1), "delta_s": round(d, 1),
                    "erreur_type_s": round(se, 1) if se is not None else None, "cout_eur": round(max(d, 0) * EUR_PAR_SECONDE, 4),
                    "cout_eur_haut": round(max(d + 2 * (se or 0), 0) * EUR_PAR_SECONDE, 4)}
    base = [r["dt"] for r in res if r["mesuree"] and r["ok"] and r["groupe"].endswith("|sans")]
    for p in PALIERS:
        v = [r["dt"] for r in res if r["mesuree"] and r["ok"] and r["groupe"] == "palier|" + p]
        if v and base:
            out["palier_" + p] = {"n": len(v), "duree_s": round(statistics.mean(v), 1), "base_balanced_s": round(statistics.mean(base), 1),
                                  "delta_vs_balanced_s": round(statistics.mean(v) - statistics.mean(base), 1)}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repeats", type=int, default=2, help="paires avec/sans mesurees par option")
    ap.add_argument("--budget-min", type=float, default=85.0, help="plafond de duree TOTALE (minutes) : au-dela, le banc s'arrete et resume")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--seulement", default="", help="paliers a mesurer seuls, separes par des virgules (ex. fast,quality,ultra_8k)")
    ap.add_argument("--sortie", default=SORTIE, help="fichier de resultats")
    a = ap.parse_args()
    sortie = a.sortie
    seul = [x.strip() for x in a.seulement.split(",") if x.strip()]
    for x in seul:
        if x not in PALIERS:
            sys.exit("palier inconnu : " + x)
    etapes = plan(a.repeats, seul or None)
    print("generations prevues : %d (dont %d mesurees) ; ~100 s chacune = ~%.0f min, ~%.1f USD de L40S" % (
        len(etapes), sum(1 for e in etapes if e[3]), len(etapes) * 100 / 60, len(etapes) * 100 * 0.000542), flush=True)
    if a.dry_run:
        for e in etapes:
            print("  ", e[0], e[1], "mesuree" if e[3] else "chauffe", json.dumps(e[2]))
        return
    url = url_image()
    inst = modal.Cls.from_name(APP, CLASSE)()
    vol = modal.Volume.from_name(VOLUME)
    res, debut = [], time.time()

    def sauver():
        json.dump({"debut": debut, "duree_s": round(time.time() - debut), "resultats": res, "resume": resume(res)}, io.open(sortie, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    for i, (nom, groupe, extra, mesuree) in enumerate(etapes):
        if time.time() - debut > a.budget_min * 60:
            print("PLAFOND DE DUREE atteint (%.0f min) : arret apres %d generations." % (a.budget_min, i), flush=True)
            break
        job = "bench_" + uuid.uuid4().hex[:12]
        payload = dict(BASE, front_image_url=url, **extra)
        t = time.time()
        ok, err = True, None
        try:
            inst.generate_to_volume.remote(job, payload)
        except Exception as e:                      # une option qui plante (ex. modele absent) est notee, le banc continue
            ok, err = False, repr(e)[:300]
        dt = time.time() - t
        for suff in (".glb", ".err", ".meta.json", ".r2.json"):
            try:
                vol.remove_file("/" + job + suff)
            except Exception:
                pass
        res.append({"i": i, "nom": nom, "groupe": groupe, "mesuree": mesuree, "ok": ok, "dt": round(dt, 1), "err": err, "extra": extra})
        sauver()
        print("[%2d/%d] %-26s %-8s %7.1f s %s" % (i + 1, len(etapes), groupe, "mesuree" if mesuree else "chauffe", dt, "" if ok else "ECHEC " + str(err)[:120]), flush=True)
    sauver()
    print(json.dumps(resume(res), ensure_ascii=False, indent=1), flush=True)
    print("duree totale %.0f min, cout GPU estime %.1f USD" % ((time.time() - debut) / 60, (time.time() - debut) * 0.000542), flush=True)


if __name__ == "__main__":
    main()
