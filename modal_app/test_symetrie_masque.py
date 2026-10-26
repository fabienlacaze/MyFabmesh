"""Banc de la symetrie de maillage (mode Masque : couture soudee) sur la VRAIE image Modal, hors de l'app de production.
Usage (quelques centimes, CPU) : PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python -m modal run modal_app/test_symetrie_masque.py
Tampons : [x, y, z, rayon, s] (s=1 peindre, s=0 gommer), en coordonnees du modele, POSES SUR LE COTE CONSERVE (keep)."""
import modal

from modal_app.app import image

app = modal.App("myfabmesh-test-symetrie-masque", image=image)


@app.function(cpu=4, timeout=900)
def essai():
    import io
    import time

    import numpy as np
    import trimesh
    from modal_app._symetrie import symetriser

    def sphere(sub):
        m = trimesh.creation.icosphere(subdivisions=sub, radius=1.0)
        v = m.vertices.copy()
        v[:, 0] += 0.25 * np.exp(-((v[:, 0] - 0.8) ** 2 + v[:, 1] ** 2 + v[:, 2] ** 2) * 6)   # bosse a droite
        v[v[:, 0] < -0.3, 1] *= 1.3                                                              # etirement a gauche
        m.vertices = v
        uv = np.stack([0.5 + np.arctan2(v[:, 2], v[:, 0]) / (2 * np.pi), 0.5 + np.arcsin(np.clip(v[:, 1] / np.linalg.norm(v, axis=1), -1, 1)) / np.pi], axis=1)
        tex = np.zeros((64, 64, 3), np.uint8); tex[:, :32] = (220, 30, 30); tex[:, 32:] = (30, 30, 220)
        from PIL import Image
        m.visual = trimesh.visual.TextureVisuals(uv=uv, image=Image.fromarray(tex))
        return m

    def mesurer(glb):
        sc = trimesh.load(io.BytesIO(glb), file_type='glb', force='scene')
        g = next(iter(sc.geometry.values()))
        g = trimesh.Trimesh(g.vertices, g.faces, process=True)
        g.merge_vertices()
        from collections import Counter
        c = Counter()
        for tri in g.faces:
            for a, b in ((tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])):
                c[(min(a, b), max(a, b))] += 1
        return {'faces': len(g.faces), 'bord': sum(1 for v in c.values() if v == 1), 'non_manifold': sum(1 for v in c.values() if v > 2),
                'etanche': bool(g.is_watertight), 'volume': float(g.volume) if g.is_watertight else None}

    rapport = {}
    for nom, sub, stamps, keep in [
        ('bosse_face', 5, [[0.9, 0.0, 0.0, 0.45, 1]], 'pos'),
        ('grande_zone', 5, [[0.5, 0.2, 0.0, 0.9, 1]], 'pos'),
        ('cote_negatif', 5, [[-0.8, 0.0, 0.2, 0.5, 1]], 'neg'),
    ]:
        glb = sphere(sub).export(file_type='glb')
        t0 = time.time()
        sortie, st = symetriser(glb, {'mode': 'mask', 'keep': keep, 'point': [0, 0, 0], 'normal': [1, 0, 0], 'stamps': stamps})
        rapport[nom] = {'duree_s': round(time.time() - t0, 2), 'stats': st, **mesurer(sortie)}
    glb = sphere(5).export(file_type='glb')
    sortie, st = symetriser(glb, {'mode': 'full', 'keep': 'pos', 'point': [0, 0, 0], 'normal': [1, 0, 0]})
    rapport['full'] = {'stats': st, **mesurer(sortie)}
    return rapport


@app.local_entrypoint()
def main():
    import json
    print(json.dumps(essai.remote(), indent=1, default=str))
