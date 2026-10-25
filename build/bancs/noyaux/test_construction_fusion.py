"""Etapes de construction (25/10) : les pieces a couleurs de face d'une etape sont fusionnees en un seul maillage (plus de ~1 500 noeuds)."""
import os, sys
import numpy as np
import trimesh
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
from modal_app import _construction3d as c


def _parties(n=50):
    parts = []
    for i in range(n):
        b = trimesh.creation.box(extents=[.1, .1, .1]); b.apply_translation([i * .2, 0, 0])
        b.visual = trimesh.visual.ColorVisuals(b, face_colors=[200, 150, 100, 255]); parts.append(b)
    s = trimesh.creation.icosphere(); s.visual = trimesh.visual.TextureVisuals(uv=np.zeros((len(s.vertices), 2)))
    parts.insert(0, s)
    return parts


def test_fusion_reduit_les_noeuds_et_garde_la_texture_et_les_couleurs():
    r = c._fusionner_parties_couleur(_parties())
    assert len(r) == 2
    assert sum(1 for g in r if g.visual.kind == 'texture') == 1
    m = [g for g in r if g.visual.kind != 'texture'][0]
    assert len(m.faces) == 50 * 12
    assert np.unique(m.visual.face_colors, axis=0).tolist() == [[200, 150, 100, 255]]


def test_une_seule_piece_couleur_est_laissee_telle_quelle():
    p = _parties(1)
    assert c._fusionner_parties_couleur(p) == p


if __name__ == '__main__':
    for n, f in list(globals().items()):
        if n.startswith('test_'):
            f(); print('ok', n)
