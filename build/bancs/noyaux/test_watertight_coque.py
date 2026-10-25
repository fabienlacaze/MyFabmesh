"""Etanche (25/10) : la coque ajoutee est FERMEE, STRICTEMENT interieure, et l'original reste intact (sommets, faces, UV)."""
import os, sys, tempfile
import numpy as np
import trimesh

RACINE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..')
sys.path.insert(0, os.path.join(RACINE, 'scripts'))
import watertight_seal as ws


def _sphere_ouverte(r=1.0):
    s = trimesh.creation.icosphere(subdivisions=4, radius=r)
    garde = np.where(s.triangles_center[:, 2] > -0.6 * r)[0]      # calotte basse retiree : maillage OUVERT
    s = trimesh.Trimesh(vertices=s.vertices, faces=s.faces[garde], process=False)
    s.visual = trimesh.visual.TextureVisuals(uv=np.column_stack([(s.vertices[:, 0] + 1) / 2, (s.vertices[:, 1] + 1) / 2]))
    return s


def test_coque_interieure_fermee_et_originale_intacte():
    s = _sphere_ouverte()
    assert not s.is_watertight
    scene = trimesh.Scene(); scene.add_geometry(s, geom_name='corps')
    v0 = np.asarray(scene.geometry['corps'].vertices).copy(); f0 = np.asarray(scene.geometry['corps'].faces).copy()
    uv0 = np.asarray(scene.geometry['corps'].visual.uv).copy()
    coque = ws.ajouter_coque(scene, resolution=96)
    assert coque is not None and len(coque.faces) > 100
    assert coque.is_watertight, 'la coque doit etre fermee'
    assert np.array_equal(v0, np.asarray(scene.geometry['corps'].vertices)), 'sommets de l\'original modifies'
    assert np.array_equal(f0, np.asarray(scene.geometry['corps'].faces)), 'faces de l\'original modifiees'
    assert np.array_equal(uv0, np.asarray(scene.geometry['corps'].visual.uv)), 'UV modifiees'
    r = np.linalg.norm(np.asarray(coque.vertices), axis=1)
    assert r.max() < 0.97, f'la coque depasse ou frole la surface (rayon max {r.max():.3f})'
    assert r.min() > 0.0


def test_export_glb_contient_les_deux_corps():
    s = _sphere_ouverte()
    with tempfile.TemporaryDirectory() as d:
        a = os.path.join(d, 'a.glb'); b = os.path.join(d, 'b.glb')
        trimesh.Scene(s).export(a)
        ws.seal(a, b, 96)
        out = trimesh.load(b)
        assert len(out.geometry) == 2
        noms = sorted(out.geometry)
        assert any('coque' in n for n in noms)


def test_partie_trop_fine_sans_coque():
    plaque = trimesh.creation.box(extents=(1.0, 1.0, 0.01))
    scene = trimesh.Scene(); scene.add_geometry(plaque)
    assert ws.ajouter_coque(scene, resolution=64) is None


if __name__ == '__main__':
    for n, f in list(globals().items()):
        if n.startswith('test_'):
            f(); print('ok', n)
