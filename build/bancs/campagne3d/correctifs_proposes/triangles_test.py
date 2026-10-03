"""Test hors appli : la reduction du chantier (acceleration_glb.reduire_et_recuire) descend-t-elle sous 1 % des faces ? (le plancher vu vient-il du ratio max(0.01, ...) de mesh_tools.py:147 ?)"""
import sys, os, time, numpy as np, trimesh
sys.path.insert(0, os.path.join(os.environ['LOCALAPPDATA'], 'Programs', 'myfabmesh-ai', 'resources', 'scripts'))   # scripts de l'appli installee (lecture seule)
from acceleration_glb import reduire_et_recuire
sc = trimesh.load(sys.argv[1]); g = list(sc.geometry.values())[0]
print('base', len(g.faces))
for n in (int(x) for x in sys.argv[2:]):
    t = time.time(); g2 = reduire_et_recuire(g, n, 2048, log=lambda *a: None)
    print('cible', n, '->', len(g2.faces), 'faces', round(time.time() - t, 1), 's')
