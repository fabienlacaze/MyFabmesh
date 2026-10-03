"""Correctif PROPOSE (non installe) de scripts/mesh_tools.py::smooth : lissage laplacien sur la topologie SOUDEE par position, puis report sur tous les sommets dupliques (coutures UV).
Usage : python smooth_corrige.py in.glb out.glb [iterations=3] [lambda=0.5]"""
import sys, numpy as np, trimesh
from trimesh import smoothing
inp, out = sys.argv[1], sys.argv[2]
it = int(sys.argv[3]) if len(sys.argv) > 3 else 3
lam = float(sys.argv[4]) if len(sys.argv) > 4 else 0.5
sc = trimesh.load(inp)
geoms = list(sc.geometry.values())
for g in geoms:
    V = np.asarray(g.vertices, dtype=np.float64); F = np.asarray(g.faces)
    size = float(np.linalg.norm(V.max(0) - V.min(0)))
    q = np.round(V / (size * 1e-7)).astype(np.int64)
    _, first, inv = np.unique(q, axis=0, return_index=True, return_inverse=True)
    inv = inv.reshape(-1)
    Vw = V[first]; Fw = inv[F]
    m = trimesh.Trimesh(Vw, Fw, process=False)
    smoothing.filter_laplacian(m, iterations=it, lamb=lam, volume_constraint=False)
    g.vertices = np.asarray(m.vertices)[inv]          # tous les doubles de couture recoivent la meme position lissee
sc.export(out)
print('ecrit', out)
