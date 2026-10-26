# Non regression de scripts/detect_vues.py : saute si les GLB de reference sont absents.
import os, sys
import numpy as np
RACINE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
sys.path.insert(0, os.path.join(RACINE, 'scripts'))
BATEAU = 'C:/tmp/benchy/e6dc04bd64284e7aaeda9876331cbee8.glb'
SAIN = 'C:/tmp/moissonneuse.glb'


def main():
    if not (os.path.exists(BATEAU) and os.path.exists(SAIN)):
        print('SKIP : GLB absents'); return 0
    import trimesh
    import detect_vues
    def ch(p):
        m = trimesh.load(p, force='mesh', process=False); return np.asarray(m.vertices), np.asarray(m.faces)
    V, F = ch(BATEAU)
    r = detect_vues.detect(V, F, nb_vues=48)
    assert len(r) >= 20, len(r)
    assert all({'centre', 'rayon', 'contour'} <= set(h) for h in r)
    print('OK bateau', len(r), 'trous')
    return 0


if __name__ == '__main__':
    sys.exit(main())
