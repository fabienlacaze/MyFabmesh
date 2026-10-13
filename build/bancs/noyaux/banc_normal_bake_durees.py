"""Banc de DUREE et de MEMOIRE de la cuisson de la carte de normales (scripts/normal_bake.py = modal_app/normal_bake.py), CPU seul.

Donnees SYNTHETIQUES a l'echelle de la production (aucun GPU, aucun reseau) :
  - maillage FIN : tore bossele dans le repere de la grille TRELLIS (Z haut, cube [-0,5 ; 0,5]), N sommets (2 a 12 M), 2 N faces ;
  - maillage FINAL : tore lisse de ~500 000 faces, repere du GLB (Y haut, la conversion de to_glb), atlas de 16 x 8 ilots qui couvrent
    ~56 % de l'image (part mesuree sur les atlas reels de to_glb), sommets dupliques aux coutures, normales de sommet analytiques ;
  - atlas 4096 (8192 en option).
Mesure : duree de chaque phase, pic de memoire du processus (Windows : peak_wset ; ailleurs : ru_maxrss), texels couverts, ecart moyen.

Lancer (machine du proprietaire : TOUJOURS par lourd.sh, une taille a la fois) :
    bash /c/tmp/lourd.sh --max-sec 600 python build/bancs/noyaux/banc_normal_bake_durees.py --sommets 2000000 --atlas 4096 --fils -1
Options : --sommets N, --faces-finales N (500000), --atlas T (4096), --fils F (-1 = tous les coeurs, plafond 16), --torch (sommets et faces
fins passes en tenseurs torch CPU, comme les tenseurs du GPU sur Modal), --sortie fichier.jsonl (une ligne JSON ajoutee par essai).
"""
import argparse
import importlib.util
import json
import os
import sys
import time

import numpy as np

RACINE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
SOURCE = os.environ.get('NOYAU_NORMAL_BAKE') or os.path.join(RACINE, 'scripts', 'normal_bake.py')


def charger():
    spec = importlib.util.spec_from_file_location('normal_bake_banc', SOURCE)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def pic_memoire_mo():
    try:
        import psutil
        info = psutil.Process().memory_info()
        pic = getattr(info, 'peak_wset', None)
        if pic:
            return pic / 2 ** 20
    except Exception:
        pass
    try:
        import resource
        return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0
    except Exception:
        return float('nan')


R_GRAND, R_PETIT = 0.30, 0.12


def tore_fin(n_sommets, amp=0.004, freq=90):
    """Tore bossele (Z haut), n_u x n_v sommets ~ n_sommets, faces en float32 / int32 comme la sortie d'o_voxel."""
    n_v = int(round((n_sommets / 2.0) ** 0.5))
    n_u = max(3, int(round(n_sommets / n_v)))
    u = np.linspace(0.0, 2 * np.pi, n_u, endpoint=False, dtype=np.float32)
    v = np.linspace(0.0, 2 * np.pi, n_v, endpoint=False, dtype=np.float32)
    U, W = np.meshgrid(u, v, indexing='ij')
    rr = R_PETIT + amp * np.sin(freq * U) * np.sin(0.5 * freq * W)
    V = np.empty((n_u * n_v, 3), np.float32)
    anneau = (R_GRAND + rr * np.cos(W))
    V[:, 0] = (anneau * np.cos(U)).ravel()
    V[:, 1] = (anneau * np.sin(U)).ravel()
    V[:, 2] = (rr * np.sin(W)).ravel()
    del U, W, rr, anneau
    i = np.arange(n_u, dtype=np.int64)[:, None]
    j = np.arange(n_v, dtype=np.int64)[None, :]
    a = (i * n_v + j).ravel()
    b = (((i + 1) % n_u) * n_v + j).ravel()
    c = (((i + 1) % n_u) * n_v + (j + 1) % n_v).ravel()
    d = (i * n_v + (j + 1) % n_v).ravel()
    F = np.empty((2 * a.size, 3), np.int32)
    F[0::2, 0], F[0::2, 1], F[0::2, 2] = a, b, c
    F[1::2, 0], F[1::2, 1], F[1::2, 2] = a, c, d
    return V, F


def tore_final(n_faces, ilots_u=16, ilots_v=8, remplissage=0.75):
    """Tore LISSE (repere Y haut, la conversion de to_glb), atlas de ilots_u x ilots_v ilots ; rend un trimesh.Trimesh texture."""
    import trimesh
    from PIL import Image
    n_v = int(round((n_faces / 4.0) ** 0.5))
    n_u = max(ilots_u, int(round(n_faces / (2.0 * n_v))))
    n_u -= n_u % ilots_u
    n_v -= n_v % ilots_v
    pu, pv = n_u // ilots_u, n_v // ilots_v                    # quads par ilot
    Vs, Ns, UVs, Fs = [], [], [], []
    base = 0
    cellu, cellv = 1.0 / ilots_u, 1.0 / ilots_v
    for iu in range(ilots_u):
        for iv in range(ilots_v):
            uu = (iu * pu + np.arange(pu + 1)) * (2 * np.pi / n_u)
            vv = (iv * pv + np.arange(pv + 1)) * (2 * np.pi / n_v)
            U, W = np.meshgrid(uu, vv, indexing='ij')
            x = (R_GRAND + R_PETIT * np.cos(W)) * np.cos(U)
            y = (R_GRAND + R_PETIT * np.cos(W)) * np.sin(U)
            z = R_PETIT * np.sin(W)
            nx, ny, nz = np.cos(W) * np.cos(U), np.cos(W) * np.sin(U), np.sin(W)
            P = np.stack([x, z, -y], -1).reshape(-1, 3)              # Z haut -> Y haut (to_glb)
            N = np.stack([nx, nz, -ny], -1).reshape(-1, 3)
            su = (np.arange(pu + 1) / pu)[:, None] * np.ones((1, pv + 1))
            sv = np.ones((pu + 1, 1)) * (np.arange(pv + 1) / pv)[None, :]
            uv = np.stack([(iu + 0.5 + remplissage * (su - 0.5)) * cellu, (iv + 0.5 + remplissage * (sv - 0.5)) * cellv], -1).reshape(-1, 2)
            k = np.arange((pu + 1) * (pv + 1)).reshape(pu + 1, pv + 1)
            a, b, c, d = k[:-1, :-1].ravel(), k[1:, :-1].ravel(), k[1:, 1:].ravel(), k[:-1, 1:].ravel()
            Fl = np.concatenate([np.stack([a, b, c], 1), np.stack([a, c, d], 1)]) + base
            Vs.append(P), Ns.append(N), UVs.append(uv), Fs.append(Fl)
            base += len(P)
    mat = trimesh.visual.material.PBRMaterial(baseColorTexture=Image.new('RGB', (8, 8), (200, 180, 160)), metallicFactor=0.0)
    m = trimesh.Trimesh(np.concatenate(Vs), np.concatenate(Fs), vertex_normals=np.concatenate(Ns), process=False,
                        visual=trimesh.visual.TextureVisuals(uv=np.concatenate(UVs), material=mat))
    return m


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--sommets', type=int, default=2_000_000)
    ap.add_argument('--faces-finales', type=int, default=500_000)
    ap.add_argument('--atlas', type=int, default=4096)
    ap.add_argument('--fils', type=int, default=-1)
    ap.add_argument('--torch', action='store_true')
    ap.add_argument('--sortie', default='')
    a = ap.parse_args()
    NB = charger()
    t = time.perf_counter()
    Vh, Fh = tore_fin(a.sommets)
    t_fin = time.perf_counter() - t
    t = time.perf_counter()
    m = tore_final(a.faces_finales)
    t_final = time.perf_counter() - t
    if a.torch:
        import torch
        Vh, Fh = torch.from_numpy(Vh), torch.from_numpy(Fh)
    pic_avant = pic_memoire_mo()
    stats = {}
    journal = []
    t = time.perf_counter()
    carte = NB.bake_normal_map(m, Vh, Fh, a.atlas, workers=a.fils, stats=stats, log=journal.append)
    duree = time.perf_counter() - t
    res = {
        'sommets_fins': int(Vh.shape[0]), 'faces_fines': int(Fh.shape[0]), 'faces_finales': int(len(m.faces)), 'atlas': a.atlas,
        'fils_demandes': a.fils, 'fils': stats.get('fils'), 'torch': bool(a.torch), 'duree_s': round(duree, 2),
        'phases_s': {k: round(v, 2) for k, v in stats.get('phases', {}).items()},
        'texels_couverts': stats.get('texels_couverts'), 'part_atlas': round(stats.get('part_atlas', 0.0), 3),
        'ecart_moyen_deg': round(stats.get('ecart_moyen_deg', float('nan')), 2), 'replis': stats.get('repli'),
        'pic_memoire_mo_avant_cuisson': round(pic_avant), 'pic_memoire_mo': round(pic_memoire_mo()),
        'preparation_donnees_s': round(t_fin + t_final, 1), 'carte': None if carte is None else list(carte.shape),
        'coeurs_visibles': os.cpu_count(),
    }
    for l in journal:
        print(l)
    print(json.dumps(res, ensure_ascii=False))
    if a.sortie:
        with open(a.sortie, 'a', encoding='utf-8') as f:
            f.write(json.dumps(res, ensure_ascii=False) + '\n')
    return 0 if carte is not None else 1


if __name__ == '__main__':
    sys.exit(main())
