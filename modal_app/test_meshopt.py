"""Banc meshoptimizer (2026-09-29) : la reduction de production (_reduire_meshopt) sur la VRAIE image 3D, a
partir d'un GLB lourd. Verifie la compilation du paquet et mesure temps / faces / morceaux.
    PYTHONUTF8=1 python -m modal run modal_app/test_meshopt.py --glb C:/tmp/meshopt/ane_500k.glb"""
import modal

from modal_app.app import mesh_image

app = modal.App("myfabmesh-test-meshopt", image=mesh_image)


@app.function(cpu=4.0, timeout=600)
def essai(glb: bytes) -> list:
    import io, time
    import numpy as np
    import trimesh
    from modal_app.acceleration_glb import _reduire_meshopt
    m = trimesh.load(io.BytesIO(glb), file_type='glb', force='mesh', process=False)
    vn, inv = np.unique(np.asarray(m.vertices, np.float32), axis=0, return_inverse=True)
    fn = inv.reshape(-1)[m.faces]
    res = []
    for cible in (50_000, 5_000, 1_000):
        t0 = time.time()
        v2, f2 = _reduire_meshopt(vn, fn, cible)
        r = trimesh.Trimesh(v2, f2, process=False)
        c = r.split(only_watertight=False); t = np.array([len(x.faces) for x in c])
        res.append((cible, len(f2), len(c), int(t[t < 10].sum()), round(time.time() - t0, 2)))
    return res


@app.local_entrypoint()
def main(glb: str):
    for r in essai.remote(open(glb, 'rb').read()):
        print('cible %d -> %d faces | %d morceaux | %d faces en miettes | %.2f s' % r)
