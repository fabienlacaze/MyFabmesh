"""BANC (2026-10-03) : UNE vraie generation 3D sur le conteneur GPU DEPLOYE (instantane restaure), puis controle du GLB livre.

Pourquoi : « un deploiement qui passe ne prouve pas qu'une inference passe » (CLAUDE.md §16). Les composants des correctifs de l'analyse du 03/10/2026 sont verifies sur
la vraie image (modal_app/test_vague_03_10.py, CPU) ; ce banc exerce le chemin COMPLET sur GPU : inference, `to_glb` avec le remplissage des vides d'atlas, marquage
« genere par IA » (AI Act art. 50), ecriture sur le volume. Palier Fast du site : 24 pas, atlas 2048, ~500 K triangles.

Aucune ecriture dans R2 ni dans Supabase : l'identifiant `bench_*` ne declenche pas la livraison du worker ; le GLB est lu sur le volume puis efface.
Cout : ~100 s de L40S (~0,06 USD) a chaud ; ~0,6 USD si un conteneur froid doit etre cree.

    PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python -m modal_app.test_generation_unique [--seed 42]

Code de sortie : 0 = generation livree ET controles passes, 1 = defaut constate.
"""
import argparse
import io
import json
import os
import struct
import sys
import time
import uuid

import modal

APP = "myfabmesh-cloud"
CLASSE = "MyFabmeshMesh"
VOLUME = "myfabmesh-mesh-output"
RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLE_IMAGE = "dda6546a-562b-4a8d-b533-eb9aa535f9b6/front/1790873441895_71262759.png"      # compte proprietaire, personnage de face, fond uni (meme image que test_options_avec_sans)
PAYLOAD = dict(mode="1024", seed=42, decimation_target=500_000, texture_size=2048, tex_steps=24, tris_exact=False)


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
    s3.head_object(Bucket=bucket, Key=CLE_IMAGE)                        # leve si l'image de reference a disparu
    return s3.generate_presigned_url("get_object", Params={"Bucket": bucket, "Key": CLE_IMAGE}, ExpiresIn=3600)


def json_glb(glb):
    n = struct.unpack("<I", glb[12:16])[0]
    return json.loads(glb[20:20 + n].decode("utf-8"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=42)
    a = ap.parse_args()
    payload = dict(PAYLOAD, seed=a.seed, front_image_url=url_image())
    inst = modal.Cls.from_name(APP, CLASSE)()
    vol = modal.Volume.from_name(VOLUME)
    job = "bench_" + uuid.uuid4().hex[:12]
    t = time.time()
    verdicts, glb = {}, None
    try:
        inst.generate_to_volume.remote(job, payload)
        verdicts["duree_s"] = round(time.time() - t, 1)
        glb = b"".join(vol.read_file("/" + job + ".glb"))
        verdicts["octets"] = len(glb)
    except Exception as e:
        verdicts["echec_generation"] = repr(e)[:400]
    finally:
        for suff in (".glb", ".err", ".meta.json", ".r2.json", ".call_id"):
            try:
                vol.remove_file("/" + job + suff)
            except Exception:
                pass
    if glb:
        import numpy as np
        import trimesh
        j = json_glb(glb)
        asset = j.get("asset", {})
        extras = asset.get("extras") or {}
        verdicts["marque_ia"] = bool(extras.get("aiGenerated") is True and extras.get("aiActArticle50") is True and "AI-generated" in str(asset.get("generator")))
        verdicts["generator"] = asset.get("generator")
        m = trimesh.load(io.BytesIO(glb), file_type="glb", force="mesh")
        v = np.asarray(m.vertices)
        mat = getattr(m.visual, "material", None)
        tex = getattr(mat, "baseColorTexture", None)
        verdicts.update({
            "faces": int(len(m.faces)), "sommets": int(len(v)), "valeurs_non_finies": int((~np.isfinite(v)).sum()),
            "atlas_couleur": list(tex.size) if tex is not None else None,
            "atlas_non_vide": bool(tex is not None and np.asarray(tex.convert("RGB")).std() > 5),
            "boite": [round(float(x), 3) for x in (v.max(0) - v.min(0))],
        })
        verdicts["ok"] = bool(
            verdicts["marque_ia"] and verdicts["valeurs_non_finies"] == 0 and 100_000 < verdicts["faces"] < 700_000
            and verdicts["atlas_couleur"] == [2048, 2048] and verdicts["atlas_non_vide"])
    else:
        verdicts["ok"] = False
    print(json.dumps(verdicts, indent=1, ensure_ascii=False))
    print("VERDICT :", "OK" if verdicts["ok"] else "ECHEC")
    sys.exit(0 if verdicts["ok"] else 1)


if __name__ == "__main__":
    main()
