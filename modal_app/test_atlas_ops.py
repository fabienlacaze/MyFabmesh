"""Banc de bout en bout des operations d'atlas GPU (« Sharpen texture »,
« Texture variants ») sur la VRAIE image Modal, hors de l'app de production.

Pourquoi un banc : le chargeur ControlNet-Tile n'avait jamais tourne en
production au 2026-09-26 — l'outil Age qui l'utilise plantait cote client
(translateUserPrompt absente), et « Detail refine » l'appelait sur la
mauvaise classe. Un deploiement qui passe ne prouve pas qu'une inference
passe (lecon deja tiree du snapshot GPU, voir test_gpusnap.py).

Usage (cout ~0,15 $ : un L40S quelques minutes) :
    PYTHONUTF8=1 python -m modal run modal_app/test_atlas_ops.py --glb-url "<url signee>"
"""
import modal

from modal_app.app import image

app = modal.App("myfabmesh-test-atlas-ops", image=image)


@app.function(gpu="L40S", timeout=1200)
def essai(glb_url: str):
    import io
    import time
    import urllib.request

    import trimesh
    from modal_app._esrgan import affuter_atlas
    from modal_app._texture_refine import affiner_atlas
    from modal_app.app import _charger_pipe_tile

    rapport = {}
    src = urllib.request.urlopen(glb_url, timeout=120).read()
    rapport["glb_entree_octets"] = len(src)

    def atlas(scene):
        for g in (scene.geometry.values() if hasattr(scene, "geometry") else [scene]):
            mat = getattr(getattr(g, "visual", None), "material", None)
            tex = getattr(mat, "baseColorTexture", None) if mat is not None else None
            if tex is not None:
                return mat, tex
        return None, None

    # --- Sharpen texture ---------------------------------------------------
    scene = trimesh.load(io.BytesIO(src), file_type="glb")
    mat, tex = atlas(scene)
    rapport["atlas_entree"] = list(tex.size)
    t = time.time()
    mat.baseColorTexture = affuter_atlas(tex, echelle_sortie=2)
    rapport["enhance_s"] = round(time.time() - t, 1)
    buf = io.BytesIO()
    scene.export(buf, file_type="glb", extension_webp=True)
    relu = trimesh.load(io.BytesIO(buf.getvalue()), file_type="glb")
    rapport["enhance_atlas_relu"] = list(atlas(relu)[1].size)
    rapport["enhance_glb_octets"] = buf.tell()

    # --- Texture variants (pipe Tile charge comme sur MyFabmeshBackview) ----
    t = time.time()
    pipe = _charger_pipe_tile(decharger_cpu=False)
    rapport["tile_chargement_s"] = round(time.time() - t, 1)
    scene = trimesh.load(io.BytesIO(src), file_type="glb")
    mat, tex = atlas(scene)
    import numpy as np
    avant = np.asarray(tex.convert("RGB"), dtype=np.float32)
    t = time.time()
    mat.baseColorTexture = affiner_atlas(
        pipe, tex, prompt="rusty, photorealistic detailed surface texture, "
        "natural materials, sharp focus, 8k", strength=0.4, cn_scale=0.75,
        seed=1234, pas=25)
    rapport["texvar_s"] = round(time.time() - t, 1)
    apres = np.asarray(mat.baseColorTexture.convert("RGB"), dtype=np.float32)
    rapport["texvar_taille_conservee"] = list(mat.baseColorTexture.size) == list(tex.size)
    rapport["texvar_ecart_moyen"] = round(float(np.abs(apres - avant).mean()), 2)
    buf = io.BytesIO()
    scene.export(buf, file_type="glb", extension_webp=True)
    relu = trimesh.load(io.BytesIO(buf.getvalue()), file_type="glb")
    rapport["texvar_atlas_relu"] = list(atlas(relu)[1].size)
    # Geometrie INTACTE : c'est la promesse de l'outil.
    g0 = list(trimesh.load(io.BytesIO(src), file_type="glb").geometry.values())[0]
    g1 = list(relu.geometry.values())[0]
    rapport["texvar_geometrie_identique"] = bool(
        g0.vertices.shape == g1.vertices.shape and np.allclose(g0.vertices, g1.vertices))
    return rapport


@app.function(gpu="L40S", timeout=900)
def essai_nommage(glb_url: str, asset_type: str = "character"):
    """Meme appel que la route /mesh_name_parts : le routeur en sous-processus,
    CLIP-L hors ligne. Prouve que les fichiers copies sont montes, que CLIP-L
    est bien dans l'image, et que le fichier annexe sort."""
    import json
    import os
    import subprocess
    import sys
    import tempfile
    import time
    import urllib.request

    import modal_app
    d = tempfile.mkdtemp()
    glb = os.path.join(d, "segmented.glb")
    out = glb + ".parts.json"
    with urllib.request.urlopen(glb_url, timeout=120) as r, open(glb, "wb") as f:
        f.write(r.read())
    routeur = os.path.join(os.path.dirname(modal_app.__file__), "part_namer", "name_parts.py")
    env = dict(os.environ, PYTHONUTF8="1", PYTHONIOENCODING="utf-8",
               HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1")
    t0 = time.time()
    p = subprocess.run([sys.executable, routeur, glb, out, "--asset-type", asset_type],
                       capture_output=True, text=True, encoding="utf-8", timeout=600, env=env)
    data = json.load(open(out, encoding="utf-8")) if os.path.exists(out) else None
    return {"rc": p.returncode, "duree_s": round(time.time() - t0, 1),
            "source": (data or {}).get("source"),
            "parts": [(x.get("part_id"), x.get("label"), round(float(x.get("confidence") or 0), 2))
                      for x in (data or {}).get("parts", [])][:30],
            "stderr_fin": (p.stderr or "")[-800:] if p.returncode else ""}


@app.local_entrypoint()
def main(glb_url: str = "", seg_url: str = ""):
    import json
    if glb_url:
        print(json.dumps(essai.remote(glb_url), indent=2))
    if seg_url:
        print(json.dumps(essai_nommage.remote(seg_url), indent=2))
