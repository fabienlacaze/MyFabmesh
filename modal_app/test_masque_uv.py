"""BANC (2026-09-29) : masque de couverture UV, trace complet contre echantillon d'1 M de triangles,
sur un VRAI GLB de 10 M de faces. Mesure la duree et l'ecart des statistiques de couleur qui s'en
servent (mediane de luminance, saturation moyenne). Conteneur CPU ephemere, quelques centimes.

    PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python -m modal_app.test_masque_uv <cle R2 du GLB>
"""
import io
import sys

import modal

app = modal.App("myfabmesh-banc-masque-uv")
image = (modal.Image.debian_slim(python_version="3.11")
         .pip_install("numpy", "trimesh", "opencv-python-headless", "pillow")
         .add_local_python_source("modal_app"))


@app.function(image=image, cpu=4.0, memory=16384, timeout=900)
def banc(url: str) -> dict:
    import time
    import urllib.request
    import numpy as np
    import trimesh
    import modal_app._mesh as M

    t = time.time()
    data = urllib.request.urlopen(url, timeout=300).read()
    scene = trimesh.load(io.BytesIO(data), file_type="glb")
    geom = list(scene.geometry.values())[0]
    tex = geom.visual.material.baseColorTexture.convert("RGB")
    res = {"faces": len(geom.faces), "atlas": tex.size, "chargement_s": round(time.time() - t, 1)}

    def stats(masque):
        arr = np.asarray(tex).astype(np.float32) / 255.0
        px = arr[masque]
        px = px[px.max(axis=1) > 0.04]
        return M._stats_couleur(px), int(masque.sum())

    for nom, plafond in (("complet", 10 ** 9), ("echantillon", 1_000_000)):
        M.MAX_TRIANGLES_MASQUE = plafond
        t = time.time()
        m = M._masque_couverture_uv(geom, tex.width, tex.height)
        dt = time.time() - t
        (lum, sat), n = stats(m)
        res[nom] = {"duree_s": round(dt, 2), "pixels": n, "lum_mediane": round(lum, 4), "sat_moy": round(sat, 4)}
    return res


if __name__ == "__main__":
    cle = sys.argv[1]
    cfg = {}
    for l in io.open('cloud/.env.local', encoding='utf-8'):
        l = l.strip()
        if l and not l.startswith('#') and '=' in l:
            k, v = l.split('=', 1)
            cfg[k.strip()] = v.strip().strip('"').strip("'")
    import boto3
    s3 = boto3.client('s3', endpoint_url='https://%s.r2.cloudflarestorage.com' % cfg['R2_ACCOUNT_ID'],
                      aws_access_key_id=cfg['R2_ACCESS_KEY_ID'], aws_secret_access_key=cfg['R2_SECRET_ACCESS_KEY'],
                      region_name='auto')
    url = s3.generate_presigned_url('get_object', Params={'Bucket': 'myfabmesh-meshes', 'Key': cle}, ExpiresIn=3600)
    with modal.enable_output():
        with app.run():
            print(banc.remote(url))
