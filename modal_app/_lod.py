"""VERSION LEGERE DES GROS MAILLAGES (2026-09-30, user : « quand on genere le mesh on pourrait generer une version 500 K pour le
rig, sans perdre les details »).

Application Modal SEPAREE, sans GPU : un maillage de plus de 1,5 M de triangles est reduit a ~500 K par meshoptimizer (WASM,
UV dans le calcul), les sommets non references sont retires et tous les attributs (positions, normales, UV, os, poids) sont
gardes ; textures, materiaux, squelette et animations sont recopies tels quels. C'est le script build/gen_light_glb.mjs
(teste sur le rig du centipede : 10 346 880 -> 499 982 triangles, 466 -> 40,5 Mo, 29 s), execute par Node dans le conteneur.

Meme contrat que le routeur de rig : /healthz, /lod-start, /lod-status, /lod-fetch (cle partagee, resultat sur un volume).
Deploiement : python -m modal deploy modal_app/_lod.py   (URL deduite par le worker de celle du rig)
"""
import json
import os
import struct
import subprocess
import tempfile
import time

import modal

APP_NAME = "myfabmesh-lod"
app = modal.App(APP_NAME)
volume = modal.Volume.from_name("myfabmesh-lod-output", create_if_missing=True)

SEUIL_FACES = 1_500_000        # en dessous : pas de version legere (le fichier est deja utilisable)
CIBLE_FACES = 500_000

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("nodejs")
    .pip_install("fastapi[standard]", "requests")
    .run_commands("mkdir -p /opt/lod/build /opt/lod/src/renderer/lib && echo '{\"type\":\"module\"}' > /opt/lod/package.json")
    .add_local_file("build/gen_light_glb.mjs", remote_path="/opt/lod/build/gen_light_glb.mjs", copy=True)
    .add_local_file("src/renderer/lib/meshopt-simplifier.js", remote_path="/opt/lod/src/renderer/lib/meshopt-simplifier.js", copy=True)
)


def _faces_glb(entete: bytes) -> int:
    """Nombre de triangles d'un GLB, lu dans l'en-tete JSON ; -1 si illisible."""
    try:
        if entete[:4] != b"glTF":
            return -1
        n = struct.unpack("<I", entete[12:16])[0]
        g = json.loads(entete[20:20 + n])
        total = 0
        for m in g.get("meshes", []):
            for pr in m.get("primitives", []):
                if pr.get("mode", 4) != 4:
                    continue
                a = pr.get("indices")
                a = g["accessors"][a]["count"] if a is not None else g["accessors"][pr["attributes"]["POSITION"]]["count"]
                total += a // 3
        return total
    except Exception:
        return -1


@app.function(
    image=image,
    cpu=4.0,
    memory=16384,
    timeout=600,
    volumes={"/lod_data": volume},
)
def faire_leger(job_id: str, mesh_url: str, cible: int = CIBLE_FACES):
    """Telecharge le maillage, le reduit si besoin, ecrit /lod_data/<job>.glb (ou .skip / .err)."""
    import urllib.request

    def _fin(nom: str, contenu: bytes | str):
        mode = "wb" if isinstance(contenu, bytes) else "w"
        with open(f"/lod_data/{job_id}.{nom}", mode) as f:
            f.write(contenu)
        volume.commit()

    t0 = time.time()
    tmp = tempfile.mkdtemp(prefix="lod_")
    src, dst = os.path.join(tmp, "in.glb"), os.path.join(tmp, "out.glb")
    try:
        req = urllib.request.Request(mesh_url, headers={"User-Agent": "myfabmesh"})
        with urllib.request.urlopen(req, timeout=300) as r, open(src, "wb") as f:
            while True:
                bloc = r.read(1 << 22)
                if not bloc:
                    break
                f.write(bloc)
        with open(src, "rb") as f:
            entete = f.read(1 << 20)
        # l'en-tete JSON peut depasser 1 Mo : on relit ce qu'il faut
        if entete[:4] == b"glTF":
            n_json = struct.unpack("<I", entete[12:16])[0]
            if 20 + n_json > len(entete):
                with open(src, "rb") as f:
                    entete = f.read(20 + n_json)
        n = _faces_glb(entete)
        print(f"[lod] maillage : {n} triangles, {os.path.getsize(src) / 1e6:.0f} Mo", flush=True)
        if 0 <= n <= SEUIL_FACES:
            _fin("skip", json.dumps({"faces": n}))
            return
        p = subprocess.run(["node", "--max-old-space-size=8192", "/opt/lod/build/gen_light_glb.mjs", src, dst, str(int(cible))],
                           capture_output=True, text=True, timeout=540)
        print(p.stdout[-800:], flush=True)
        if p.returncode != 0 or not os.path.isfile(dst):
            raise RuntimeError((p.stderr or p.stdout)[-300:] or f"node code {p.returncode}")
        with open(dst, "rb") as f:
            _fin("glb", f.read())
        print(f"[lod] version legere en {time.time() - t0:.0f} s", flush=True)
    except Exception as e:
        print(f"[lod] ECHEC : {e}", flush=True)
        _fin("err", json.dumps({"error": str(e)[:400]}))


@app.function(
    image=image,
    timeout=120,
    volumes={"/lod_data": volume},
    secrets=[modal.Secret.from_name("myfabmesh-shared", required_keys=["SHARED_SECRET"])],
)
@modal.asgi_app()
def lod_router():
    from fastapi import FastAPI, HTTPException, Request
    from fastapi.responses import JSONResponse, Response

    api = FastAPI(title="myfabmesh-lod")

    async def _json(request: Request) -> dict:
        try:
            return await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="invalid JSON body")

    def _auth(payload: dict) -> None:
        attendu = os.environ.get("SHARED_SECRET", "")
        if not attendu or (payload or {}).get("_auth") != attendu:
            raise HTTPException(status_code=401, detail="unauthorized")

    def _job(payload: dict) -> str:
        j = (payload.get("job_id") or "").strip()
        if not j or not all(c.isalnum() or c in "-_" for c in j):
            raise HTTPException(status_code=400, detail="job_id required")
        return j

    @api.get("/healthz")
    async def healthz():
        return {"ok": True, "fn": "lod_router"}

    @api.post("/lod-start")
    async def lod_start(request: Request):
        p = await _json(request)
        _auth(p)
        url = (p.get("mesh_url") or "").strip()
        if not url.startswith("https://"):
            raise HTTPException(status_code=400, detail="mesh_url required")
        job = _job(p)
        cible = int(p.get("cible") or CIBLE_FACES)
        faire_leger.spawn(job, url, max(50_000, min(cible, 1_000_000)))
        return JSONResponse({"job_id": job, "status": "queued"})

    @api.post("/lod-status")
    async def lod_status(request: Request):
        p = await _json(request)
        _auth(p)
        job = _job(p)
        volume.reload()
        base = f"/lod_data/{job}"
        if os.path.isfile(base + ".err"):
            try:
                msg = json.loads(open(base + ".err").read()).get("error", "failed")
            except Exception:
                msg = "failed"
            return JSONResponse({"ready": False, "error": msg})
        if os.path.isfile(base + ".skip"):
            return JSONResponse({"ready": False, "skipped": True})
        if os.path.isfile(base + ".glb"):
            return JSONResponse({"ready": True, "bytes": os.path.getsize(base + ".glb")})
        return JSONResponse({"ready": False})

    @api.post("/lod-fetch")
    async def lod_fetch(request: Request):
        p = await _json(request)
        _auth(p)
        job = _job(p)
        volume.reload()
        chemin = f"/lod_data/{job}.glb"
        if not os.path.isfile(chemin):
            raise HTTPException(status_code=404, detail="not ready")
        return Response(content=open(chemin, "rb").read(), media_type="model/gltf-binary")

    return api
