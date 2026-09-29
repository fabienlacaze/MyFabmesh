"""BANC (2026-09-29) : reduction sans plis a petite cible, plusieurs reglages, MEME generation (image,
graine) sur une application EPHEMERE. Ecrit les GLB a cote pour un rendu.

    PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python -m modal_app.test_reduction <dossier_sortie> [faces]
"""
import io
import sys
import time

import boto3
import modal

from modal_app import app as A

if __name__ == "__main__":
    sortie = sys.argv[1]
    faces = int(sys.argv[2]) if len(sys.argv) > 2 else 5000
    cfg = {}
    for l in io.open('cloud/.env.local', encoding='utf-8'):
        l = l.strip()
        if l and not l.startswith('#') and '=' in l:
            k, v = l.split('=', 1)
            cfg[k.strip()] = v.strip().strip('"').strip("'")
    s3 = boto3.client('s3', endpoint_url='https://%s.r2.cloudflarestorage.com' % cfg['R2_ACCOUNT_ID'],
                      aws_access_key_id=cfg['R2_ACCESS_KEY_ID'], aws_secret_access_key=cfg['R2_SECRET_ACCESS_KEY'],
                      region_name='auto')
    url = s3.generate_presigned_url('get_object', Params={'Bucket': 'myfabmesh-meshes',
        'Key': 'dda6546a-562b-4a8d-b533-eb9aa535f9b6/rectify/1790621955180_rectified.png'}, ExpiresIn=3600)
    variantes = [{"nettoyage": False, "agg": 7}, {"nettoyage": True, "agg": 7}, {"nettoyage": True, "agg": 4}]
    with modal.enable_output():
        with A.app.run():
            t = time.time()
            res = A.MyFabmeshMesh().reduction_banc.remote(url, faces, variantes)
            print(f"banc termine en {time.time() - t:.0f} s")
    for k, r in enumerate(res):
        open(f"{sortie}/reduction_{k}.glb", "wb").write(r.pop("glb"))
        print(f"variante {k} : {r}")
