"""EXPERIENCE (03/10/2026) : « ameliorer TRELLIS via le cloud, je veux voir le resultat » (demande du proprietaire).

Tout le calcul est sur Modal (rien sur le PC : Unreal reste libre). On rejoue le VRAI chemin de production (classe deployee `MyFabmeshMesh.generate_to_volume`) avec des
ENTREES ameliorees et on compare des variantes sur le cas de reference (l'orc `verif_t80_orc`) et un second personnage (le cochon) :

  A0  actuel                : image d'origine, detourage u2net de la production, mode 1024, graine 42
  A1  masque propre         : meme image, masque = UNION (Lucida, u2net la ou il est sur) : les bras et les armes ne sont plus perdus avant la 3D
  A2  sans socle            : A1 + socle de roche coupe sous les pieds (l'image n'est plus censee avoir de dalle : regle du proprietaire)
  A3  ultra                 : A2 en grille 1536 (cascade), atlas 4096, 32 pas de texture
  S*  graines               : A2 avec 6 autres graines : combien la FORME varie d'un tirage a l'autre (valeur d'un « meilleur de N »)

Etapes (chacune reprenable ; l'etat est dans C:/tmp/trellis_cloud/etat.json) :
    PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python -m modal run modal_app/exp_trellis_cloud.py --etape entrees   # Lucida + masque union + coupe du socle (GPU L40S, ~0,05 $)
    ... --etape gener      # televerse les entrees en R2 (_bench/), lance les 13 generations (~0,1 $ chacune), telecharge les GLB
    ... --etape apercus    # rendus Blender (Cycles CPU) : face, trois quarts, dos, zoom haut, argile ; telecharge les PNG (~0,3 $)
    ... --etape nettoyer   # efface les fichiers du volume et les cles R2 de l'essai

Rien n'est ecrit dans Supabase ni dans les projets de l'utilisateur ; les identifiants `exp_*` ne declenchent aucune livraison du worker.
"""
import io
import json
import os
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import modal

from modal_app.app import blender_image, mesh_image

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SORTIE = "C:/tmp/trellis_cloud"
APP_DEPLOYE, CLASSE, VOLUME = "myfabmesh-cloud", "MyFabmeshMesh", "myfabmesh-mesh-output"
PREFIXE_R2 = "_bench/trellis_cloud/"

app = modal.App("myfabmesh-exp-trellis", image=mesh_image)
vol = modal.Volume.from_name(VOLUME)

# image d'origine -> (chemin local, ligne de coupe du socle sur l'image 1024x1024 ou None)
SOURCES = {
    "orc": (os.path.join(RACINE, "images", "verif_t80_orc", "ref_0.png"), 936),      # toes finissent vers y=925-935, le socle de roche est dessous
    "cochon": ("C:/tmp/fidelite/paires_r2/00_cochon_V3/ref.png", None),
}
BASE = dict(mode="1024", seed=42, decimation_target=500_000, texture_size=2048, tex_steps=24, tris_exact=False)
VARIANTES = {
    "orc_A0_actuel": dict(entree="orc_original"),
    "orc_A1_masque": dict(entree="orc_union"),
    "orc_A2_sans_socle": dict(entree="orc_union_sans_socle"),
    "orc_A3_ultra": dict(entree="orc_union_sans_socle", mode="1536_cascade", texture_size=4096, tex_steps=32),
    "orc_S1": dict(entree="orc_union_sans_socle", seed=1),
    "orc_S7": dict(entree="orc_union_sans_socle", seed=7),
    "orc_S99": dict(entree="orc_union_sans_socle", seed=99),
    "orc_S123": dict(entree="orc_union_sans_socle", seed=123),
    "orc_S314": dict(entree="orc_union_sans_socle", seed=314),
    "orc_S2024": dict(entree="orc_union_sans_socle", seed=2024),
    # meilleur cas : entree propre + les deux meilleures graines de la serie, en grille 1536 / atlas 4096 (ajoute apres la lecture des resultats)
    "orc_B7_ultra": dict(entree="orc_union_sans_socle", seed=7, mode="1536_cascade", texture_size=4096, tex_steps=32),
    "orc_B123_ultra": dict(entree="orc_union_sans_socle", seed=123, mode="1536_cascade", texture_size=4096, tex_steps=32),
    "cochon_A0_actuel": dict(entree="cochon_original"),
    "cochon_A1_masque": dict(entree="cochon_union"),
    "cochon_A3_ultra": dict(entree="cochon_union", mode="1536_cascade", texture_size=4096, tex_steps=32),
}


# ------------------------------------------------------------------ etape 1 : entrees (GPU)
@app.function(gpu="L40S", timeout=900)
def preparer_entrees(images: dict, coupes: dict) -> dict:
    import numpy as np
    import torch
    from huggingface_hub import snapshot_download
    from PIL import Image, ImageDraw, ImageOps
    from torchvision import transforms
    from transformers import AutoModelForImageSegmentation

    from modal_app._detourage import masque as masque_u2net

    snapshot_download("egeorcun/lucida")
    modele = AutoModelForImageSegmentation.from_pretrained("egeorcun/lucida", trust_remote_code=True)
    modele.to("cuda").eval()
    prep = transforms.Compose([transforms.Resize((1024, 1024)), transforms.ToTensor(),
                               transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])])

    def alpha_lucida(img):
        with torch.no_grad():
            p = modele(prep(img).unsqueeze(0).to("cuda"))[-1].sigmoid().cpu()
        a = transforms.functional.resize(p[0], img.size[::-1]).squeeze(0)
        return (a.numpy().clip(0, 1) * 255).astype("uint8")

    def png(a, mode=None):
        b = io.BytesIO()
        (a if isinstance(a, Image.Image) else Image.fromarray(a, mode=mode)).save(b, format="PNG")
        return b.getvalue()

    sortie = {}
    for nom, octets in images.items():
        img = ImageOps.exif_transpose(Image.open(io.BytesIO(octets))).convert("RGB")
        lu = alpha_lucida(img)
        u2 = np.asarray(masque_u2net(img))
        union = np.maximum(lu, np.where(u2 >= 127, u2, 0)).astype("uint8")
        rgba = img.convert("RGBA")
        rgba.putalpha(Image.fromarray(union, mode="L"))
        res = {"rgba_union": png(rgba), "masque_union": png(union, "L"),
               "aires": {"u2net": float((u2 >= 127).mean()), "lucida": float((lu >= 127).mean()), "union": float((union >= 127).mean())}}
        y_cut = coupes.get(nom)
        if y_cut:
            a2 = union.copy()
            a2[int(y_cut):, :] = 0
            r2 = img.convert("RGBA")
            r2.putalpha(Image.fromarray(a2, mode="L"))
            res["rgba_union_sans_socle"] = png(r2)
            res["masque_union_sans_socle"] = png(a2, "L")
            res["aires"]["sans_socle"] = float((a2 >= 127).mean())
        # controle visuel : rouge = ajoute par Lucida, bleu = u2net seul, trait jaune = coupe
        deb = np.asarray(img).copy()
        deb[(lu >= 127) & (u2 < 127)] = (230, 40, 40)
        deb[(u2 >= 127) & (lu < 127)] = (40, 90, 230)
        dimg = Image.fromarray(deb)
        if y_cut:
            ImageDraw.Draw(dimg).line([(0, int(y_cut)), (img.size[0], int(y_cut))], fill=(255, 230, 0), width=2)
        res["debug"] = png(dimg)
        sortie[nom] = res
    return sortie


# ------------------------------------------------------------------ etape 3 : apercus (Blender, CPU)
@app.function(image=blender_image, cpu=8.0, memory=16384, timeout=1800, volumes={"/data": vol})
def apercus(job_id: str, largeur: int = 900, hauteur: int = 1200, echantillons: int = 24) -> dict:
    import math
    import tempfile

    import bpy
    import numpy as np
    from mathutils import Vector

    vol.reload()
    src = "/data/%s.glb" % job_id
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    pts = []
    nfaces = 0
    for o in meshes:
        n = len(o.data.vertices)
        a = np.empty(n * 3, dtype=np.float32)
        o.data.vertices.foreach_get("co", a)
        m = np.array(o.matrix_world, dtype=np.float64)
        v = a.reshape(-1, 3).astype(np.float64)
        pts.append(v @ m[:3, :3].T + m[:3, 3])
        nfaces += len(o.data.polygons)
    P = np.concatenate(pts)
    zmin, zmax = float(P[:, 2].min()), float(P[:, 2].max())
    H = zmax - zmin
    corps = P[P[:, 2] > zmin + 0.04 * H]                     # sans la dalle de sol (plan mince au niveau des pieds)
    cx, cy = float(np.median(corps[:, 0])), float(np.median(corps[:, 1]))
    W = float(max(corps[:, 0].max() - corps[:, 0].min(), corps[:, 1].max() - corps[:, 1].min()))
    centre = Vector((cx, cy, zmin + H / 2))

    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = echantillons
    sc.cycles.use_denoising = True
    try:
        sc.cycles.denoiser = "OPENIMAGEDENOISE"
    except Exception:
        pass
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = largeur, hauteur, 100
    sc.view_settings.view_transform = "Standard"
    sc.render.image_settings.file_format = "PNG"
    mon = bpy.data.worlds.new("monde")
    mon.use_nodes = True
    fond = mon.node_tree.nodes["Background"]
    fond.inputs[0].default_value = (0.86, 0.86, 0.88, 1.0)
    fond.inputs[1].default_value = 1.0
    sc.world = mon

    soleil_d = bpy.data.lights.new("soleil", "SUN")
    soleil_d.energy = 2.5
    soleil_d.angle = math.radians(18)
    soleil = bpy.data.objects.new("soleil", soleil_d)
    sc.collection.objects.link(soleil)
    cam_d = bpy.data.cameras.new("cam")
    cam_d.lens = 70.0
    cam_d.sensor_fit = "HORIZONTAL"                                  # capteur de 36 mm = largeur de l'image (portrait 900 x 1200)
    cam = bpy.data.objects.new("cam", cam_d)
    sc.collection.objects.link(cam)
    sc.camera = cam
    aspect = largeur / hauteur
    tan_h = (cam_d.sensor_width / 2.0) / cam_d.lens                  # tangente du demi-angle horizontal
    tan_v = tan_h / aspect                                           # idem vertical (image plus haute que large : plus grand)

    def vue(az_deg, zoom=None, argile=False):
        az = math.radians(az_deg)
        if zoom:                                                     # haut du corps
            cible = Vector((cx, cy, zmax - 0.22 * H))
            d = max((0.22 * H * 1.1) / tan_v, (0.30 * H * 1.1) / tan_h)
        else:
            cible = centre
            d = max((H / 2 * 1.10) / tan_v, (W / 2 * 1.10) / tan_h)
        cam.location = cible + Vector((math.sin(az) * d, -math.cos(az) * d, 0))
        cam.rotation_euler = (math.radians(90), 0, az)
        soleil.rotation_euler = (math.radians(55), 0, az - math.radians(25))
        bpy.context.view_layer.material_override = None
        if argile:
            mat = bpy.data.materials.new("argile")
            mat.use_nodes = True
            pb = mat.node_tree.nodes["Principled BSDF"]
            pb.inputs["Base Color"].default_value = (0.72, 0.72, 0.72, 1.0)
            pb.inputs["Roughness"].default_value = 0.85
            bpy.context.view_layer.material_override = mat
        tmp = os.path.join(tempfile.gettempdir(), "v_%s.png" % uuid.uuid4().hex[:8])
        sc.render.filepath = tmp
        bpy.ops.render.render(write_still=True)
        with open(tmp, "rb") as f:
            return f.read()

    t0 = time.time()
    sortie = {"face": vue(0), "trois_quarts": vue(-35), "dos": vue(180), "zoom_haut": vue(0, zoom=True), "argile_face": vue(0, argile=True),
              "argile_cote": vue(90, argile=True)}
    return {"png": sortie, "faces": nfaces, "hauteur": H, "largeur_corps": W, "z": [zmin, zmax], "temps_s": round(time.time() - t0, 1)}


# ------------------------------------------------------------------ outils locaux
def _charger_env():
    cfg = {}
    for ligne in io.open(os.path.join(RACINE, "cloud", ".env.local"), encoding="utf-8"):
        ligne = ligne.strip()
        if ligne and not ligne.startswith("#") and "=" in ligne:
            k, v = ligne.split("=", 1)
            cfg[k.strip()] = v.strip().strip('"').strip("'")
    return cfg


def _s3():
    import boto3
    cfg = _charger_env()
    s3 = boto3.client("s3", endpoint_url="https://%s.r2.cloudflarestorage.com" % cfg["R2_ACCOUNT_ID"],
                      aws_access_key_id=cfg["R2_ACCESS_KEY_ID"], aws_secret_access_key=cfg["R2_SECRET_ACCESS_KEY"], region_name="auto")
    return s3, (cfg.get("R2_BUCKET_NAME") or cfg.get("R2_BUCKET") or "myfabmesh-meshes")


def _etat():
    p = os.path.join(SORTIE, "etat.json")
    return json.load(io.open(p, encoding="utf-8")) if os.path.exists(p) else {"variantes": {}, "entrees": {}}


def _sauver(etat):
    os.makedirs(SORTIE, exist_ok=True)
    io.open(os.path.join(SORTIE, "etat.json"), "w", encoding="utf-8").write(json.dumps(etat, indent=1, ensure_ascii=False))


@app.local_entrypoint()
def main(etape: str = "entrees"):
    os.makedirs(SORTIE, exist_ok=True)
    etat = _etat()
    if etape == "entrees":
        images = {nom: open(chemin, "rb").read() for nom, (chemin, _) in SOURCES.items()}
        coupes = {nom: y for nom, (_, y) in SOURCES.items()}
        res = preparer_entrees.remote(images, coupes)
        os.makedirs(os.path.join(SORTIE, "entrees"), exist_ok=True)
        for nom, r in res.items():
            for cle, val in r.items():
                if isinstance(val, bytes):
                    open(os.path.join(SORTIE, "entrees", "%s_%s.png" % (nom, cle)), "wb").write(val)
            print(nom, json.dumps(r["aires"]))
        etat["entrees"] = {nom: r["aires"] for nom, r in res.items()}
        _sauver(etat)
        print("entrees dans", os.path.join(SORTIE, "entrees"))

    elif etape == "gener":
        s3, bucket = _s3()
        fichiers = {}
        for nom, (chemin, _) in SOURCES.items():
            fichiers[nom + "_original"] = chemin
            fichiers[nom + "_union"] = os.path.join(SORTIE, "entrees", "%s_rgba_union.png" % nom)
            sans = os.path.join(SORTIE, "entrees", "%s_rgba_union_sans_socle.png" % nom)
            if os.path.exists(sans):
                fichiers[nom + "_union_sans_socle"] = sans
        urls = {}
        for cle, chemin in fichiers.items():
            k = PREFIXE_R2 + cle + ".png"
            s3.put_object(Bucket=bucket, Key=k, Body=open(chemin, "rb").read(), ContentType="image/png")
            urls[cle] = s3.generate_presigned_url("get_object", Params={"Bucket": bucket, "Key": k}, ExpiresIn=7200)
        etat["cles_r2"] = [PREFIXE_R2 + c + ".png" for c in fichiers]
        inst = modal.Cls.from_name(APP_DEPLOYE, CLASSE)()
        v_ = modal.Volume.from_name(VOLUME)

        def une(nom):
            v = VARIANTES[nom]
            deja = etat["variantes"].get(nom, {})
            if deja.get("statut") == "ok" and os.path.exists(deja.get("glb", "")):
                return nom, deja
            job = "exp_" + uuid.uuid4().hex[:10]
            params = dict(BASE, **{k: x for k, x in v.items() if k != "entree"})
            payload = dict(params, front_image_url=urls[v["entree"]])
            t = time.time()
            rec = {"entree": v["entree"], "params": params, "job": job}
            try:
                inst.generate_to_volume.remote(job, payload)
                rec["duree_s"] = round(time.time() - t, 1)
                try:
                    glb = b"".join(v_.read_file("/" + job + ".glb"))
                except Exception:
                    err = b"".join(v_.read_file("/" + job + ".err")).decode("utf-8", "replace")[:600]
                    raise RuntimeError("pas de GLB ; .err : " + err)
                os.makedirs(os.path.join(SORTIE, "glb"), exist_ok=True)
                chemin = os.path.join(SORTIE, "glb", nom + ".glb")
                open(chemin, "wb").write(glb)
                rec.update(statut="ok", glb=chemin, octets=len(glb))
            except Exception as e:
                rec.update(statut="echec", erreur=repr(e)[:600], duree_s=round(time.time() - t, 1))
            print(nom, rec["statut"], rec.get("duree_s"), "s", rec.get("octets", ""), rec.get("erreur", ""), flush=True)
            return nom, rec

        a_faire = [n for n in VARIANTES]
        with ThreadPoolExecutor(max_workers=3) as ex:
            for nom, rec in ex.map(une, a_faire):
                etat["variantes"][nom] = rec
                _sauver(etat)

    elif etape == "apercus":
        jobs = [(n, r["job"]) for n, r in etat["variantes"].items() if r.get("statut") == "ok" and not r.get("apercus")]
        os.makedirs(os.path.join(SORTIE, "apercus"), exist_ok=True)
        resultats = apercus.map([j for _, j in jobs], return_exceptions=True)
        for (nom, _), res in zip(jobs, resultats):
            if isinstance(res, Exception):
                print(nom, "ECHEC apercus", repr(res)[:300])
                continue
            for vue, octets in res["png"].items():
                open(os.path.join(SORTIE, "apercus", "%s_%s.png" % (nom, vue)), "wb").write(octets)
            etat["variantes"][nom]["apercus"] = {k: v for k, v in res.items() if k != "png"}
            print(nom, "faces", res["faces"], "temps", res["temps_s"], "s")
        _sauver(etat)

    elif etape == "nettoyer":
        s3, bucket = _s3()
        for k in etat.get("cles_r2", []):
            try:
                s3.delete_object(Bucket=bucket, Key=k)
            except Exception as e:
                print("R2", k, repr(e)[:100])
        v_ = modal.Volume.from_name(VOLUME)
        for nom, r in etat["variantes"].items():
            for suff in (".glb", ".err", ".meta.json", ".r2.json", ".call_id"):
                try:
                    v_.remove_file("/%s%s" % (r.get("job"), suff))
                except Exception:
                    pass
        print("nettoye")
    else:
        print("etape inconnue :", etape)
        sys.exit(2)
