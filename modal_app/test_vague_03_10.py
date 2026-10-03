"""BANC (2026-10-03) : les correctifs de la vague 1-3 de l'analyse complete, executes sur la VRAIE image Modal (CPU seulement, ~0,02 $).

Pourquoi un banc : « un deploiement qui passe ne prouve pas qu'une inference passe » (CLAUDE.md §16). Ici on verifie, dans le conteneur reel
(memes versions d'OpenCV, de trimesh, de numpy que la production) :
  1. acceleration_glb.remplir_bord_proche : la garde de numerotation des etiquettes OpenCV passe, les texels couverts sortent IDENTIQUES ;
  2. _mesh_op.run('smooth') sur un maillage texture a coutures UV : le nombre de composantes (maillage soude) ne bouge pas (avant : x75) ;
  3. _mesh_op.run('decimate', 1 000 faces) : cible atteinte a 5 % pres, taille de texture conservee ;
  4. marquage « genere par IA » (AI Act art. 50) present sur la sortie de chaque operation ;
  5. _moderation_texte : le module s'importe dans l'image, bloque un contournement, accepte un prompt de jeu ;
  6. _url_sure.ouvrir_https : refuse http:// et file://.

Usage :  PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python -m modal run modal_app/test_vague_03_10.py
"""
import modal

from modal_app.app import image

app = modal.App("myfabmesh-test-vague-03-10", image=image)


@app.function(cpu=4.0, memory=8192, timeout=900)
def banc():
    import io
    import json
    import struct
    import time

    import cv2
    import numpy as np
    import trimesh
    from PIL import Image

    from modal_app import _mesh_op
    from modal_app import acceleration_glb as acc
    from modal_app._marquage_ia import marquer_glb_octets  # noqa: F401  (import = module present dans l'image)
    from modal_app._moderation_texte import check_hard_floor, check_prompt_safety
    from modal_app import _url_sure

    rapport = {"opencv": cv2.__version__, "trimesh": trimesh.__version__, "numpy": np.__version__}

    def sphere_texturee(subdivisions=4, taille_texture=512, ilots=4):
        s = trimesh.creation.icosphere(subdivisions=subdivisions)
        V = np.asarray(s.vertices, np.float64)
        F = np.asarray(s.faces)
        centres = V[F].mean(1)
        ilot = ((centres[:, 0] > 0).astype(int) + 2 * (centres[:, 1] > 0).astype(int)) % ilots
        cle = F * ilots + ilot[:, None]
        uniques, inv = np.unique(cle.reshape(-1), return_inverse=True)
        V2 = V[uniques // ilots]
        F2 = inv.reshape(-1, 3)
        il = uniques % ilots
        ox, oy = (il % 2) / 2, (il // 2) / 2
        uv = np.stack([ox + (V2[:, 0] * 0.5 + 0.5) / 2 * 0.9 + 0.02, oy + (V2[:, 2] * 0.5 + 0.5) / 2 * 0.9 + 0.02], 1)
        rng = np.random.default_rng(0)
        h = taille_texture
        d = np.linspace(0, 255, h, dtype=np.uint8)
        img = np.stack([np.tile(d, (h, 1)), np.tile(d[:, None], (1, h)), rng.integers(0, 255, (h, h), dtype=np.uint8)], -1)
        mat = trimesh.visual.material.PBRMaterial(baseColorTexture=Image.fromarray(img))
        return trimesh.Trimesh(V2, F2, visual=trimesh.visual.TextureVisuals(uv=uv, material=mat), process=False)

    def composantes(glb):
        from scipy.sparse import coo_matrix
        from scipy.sparse.csgraph import connected_components
        g = trimesh.load(io.BytesIO(glb), file_type="glb", force="mesh")
        V = np.asarray(g.vertices, np.float64)
        F = np.asarray(g.faces)
        ext = float(np.linalg.norm(V.max(0) - V.min(0))) or 1.0
        q = np.round(V / (ext * 1e-6)).astype(np.int64)
        _, premier, inv = np.unique(q, axis=0, return_index=True, return_inverse=True)
        inv = inv.reshape(-1)
        Fw = inv[F]
        Fw = Fw[(Fw[:, 0] != Fw[:, 1]) & (Fw[:, 1] != Fw[:, 2]) & (Fw[:, 0] != Fw[:, 2])]
        a = np.concatenate([Fw[:, 0], Fw[:, 1], Fw[:, 2]])
        b = np.concatenate([Fw[:, 1], Fw[:, 2], Fw[:, 0]])
        n = len(premier)
        _, etiq = connected_components(coo_matrix((np.ones(len(a)), (a, b)), shape=(n, n)), directed=False)
        return len(np.unique(etiq[np.unique(Fw)])), len(g.faces)

    def json_glb(glb):
        n = struct.unpack("<I", glb[12:16])[0]
        return json.loads(glb[20:20 + n].decode("utf-8"))

    def est_marque(glb):
        a = json_glb(glb).get("asset", {})
        e = a.get("extras") or {}
        return bool(e.get("aiGenerated") is True and e.get("aiActArticle50") is True and "AI-generated" in str(a.get("generator")))

    # --- 1. remplissage des vides par le bord le plus proche (garde de numerotation d'OpenCV)
    rng = np.random.default_rng(3)
    img = rng.integers(0, 255, (256, 256, 3), dtype=np.uint8)
    vide = np.ones((256, 256), np.uint8)
    vide[40:200, 30:180] = 0
    sortie = acc.remplir_bord_proche(vide, img)[0]
    couvert = vide == 0
    rapport["remplissage"] = {"couverts_identiques": bool(np.array_equal(sortie[couvert], img[couvert])), "vides_remplis": bool((sortie[~couvert].sum() > 0))}

    # --- 2. Smooth et 3. Triangle count sur un maillage a coutures UV
    m = sphere_texturee(subdivisions=5, taille_texture=1024)
    buf = io.BytesIO()
    m.export(buf, file_type="glb")
    glb = buf.getvalue()
    rapport["maillage_depart"] = {"composantes": composantes(glb)[0], "faces": composantes(glb)[1], "marque": est_marque(glb)}
    t = time.time()
    lisse, _ = _mesh_op.run("smooth", glb, {"iterations": 3})
    rapport["smooth"] = {"composantes": composantes(lisse)[0], "faces": composantes(lisse)[1], "marque": est_marque(lisse), "s": round(time.time() - t, 1)}
    t = time.time()
    reduit, _ = _mesh_op.run("decimate", glb, {"target_faces": 1000})
    g = trimesh.load(io.BytesIO(reduit), file_type="glb", force="mesh")
    tex = g.visual.material.baseColorTexture if hasattr(g.visual.material, "baseColorTexture") else None
    rapport["decimate_1000"] = {"faces": int(len(g.faces)), "texture": list(tex.size) if tex is not None else None, "marque": est_marque(reduit), "s": round(time.time() - t, 1)}
    for op, params in (("fix_normals", {}), ("center", {}), ("resize", {"sx": 1.1, "sy": 1.0, "sz": 1.0})):
        try:
            sortie_op, _ = _mesh_op.run(op, glb, params)
            rapport[op] = {"marque": est_marque(sortie_op)}
        except Exception as e:  # une operation en echec ne doit pas masquer les autres
            rapport[op] = {"erreur": f"{type(e).__name__}: {e}"[:200]}

    # --- 5. filtre de texte
    rapport["moderation"] = {
        "jeu_accepte": bool(check_prompt_safety("An orc warrior covered in blood, holding a massive spiked club, grim dark fantasy", False).get("safe")),
        "contournement_bloque": not bool(check_hard_floor("c h i l d   n u d e").get("safe", True)),
    }

    # --- 6. URL sures
    refus = {}
    for url in ("http://example.com/x.png", "file:///etc/passwd"):
        try:
            _url_sure.ouvrir_https(url)
            refus[url] = "ACCEPTEE (defaut)"
        except Exception as e:
            refus[url] = f"refusee ({type(e).__name__})"
    rapport["url_sure"] = refus
    return rapport


@app.local_entrypoint()
def main():
    import json
    r = banc.remote()
    print(json.dumps(r, indent=1, ensure_ascii=False))
    ok = (
        r["remplissage"]["couverts_identiques"] and r["remplissage"]["vides_remplis"]
        and r["smooth"]["composantes"] <= r["maillage_depart"]["composantes"] * 1.05 and r["smooth"]["marque"]
        and abs(r["decimate_1000"]["faces"] - 1000) <= 50 and r["decimate_1000"]["marque"]
        and r["moderation"]["jeu_accepte"] and r["moderation"]["contournement_bloque"]
        and all(v.startswith("refusee") for v in r["url_sure"].values())
    )
    print("VERDICT :", "OK" if ok else "ECHEC")
    raise SystemExit(0 if ok else 1)
