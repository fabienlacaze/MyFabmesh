"""Maillages de test partages (2026-10-03) : sphere texturee a COUTURES UV, mesures de topologie.

Un maillage TRELLIS exporte en GLB duplique ses sommets le long des coutures d'UV : c'est ce qui fait
que `merge_vertices` ne les soude pas et que le lissage les dechirait (constat E-3).
"""
import numpy as np


def sphere_texturee(subdivisions=4, taille_texture=256, graine=0, ilots=4):
    """Icosphere dont les faces sont repartie en `ilots` ilots UV (sommets dupliques aux coutures)."""
    import trimesh
    from PIL import Image
    s = trimesh.creation.icosphere(subdivisions=subdivisions)
    V = np.asarray(s.vertices, np.float64)
    F = np.asarray(s.faces)
    centres = V[F].mean(1)
    ilot = (centres[:, 0] > 0).astype(int) + 2 * (centres[:, 1] > 0).astype(int)
    ilot = ilot % ilots
    # un sommet par (sommet d'origine, ilot) : les coutures sont dupliquees
    cle = F * ilots + ilot[:, None]
    uniques, inv = np.unique(cle.reshape(-1), return_inverse=True)
    sommet_origine = uniques // ilots
    ilot_sommet = uniques % ilots
    V2 = V[sommet_origine]
    F2 = inv.reshape(-1, 3)
    cases = 2
    ox = (ilot_sommet % cases) / cases
    oy = (ilot_sommet // cases) / cases
    u = ox + (V2[:, 0] * 0.5 + 0.5) / cases * 0.9 + 0.02
    v = oy + (V2[:, 2] * 0.5 + 0.5) / cases * 0.9 + 0.02
    uv = np.stack([u, v], 1)
    rng = np.random.default_rng(graine)
    h = taille_texture
    degrade = np.linspace(0, 255, h, dtype=np.uint8)
    img = np.stack([np.tile(degrade, (h, 1)), np.tile(degrade[:, None], (1, h)),
                    rng.integers(0, 255, (h, h), dtype=np.uint8)], -1)
    mat = trimesh.visual.material.PBRMaterial(baseColorTexture=Image.fromarray(img))
    m = trimesh.Trimesh(V2, F2, visual=trimesh.visual.TextureVisuals(uv=uv, material=mat), process=False)
    return m


def souder(g):
    """(sommets soudes par position, faces soudees, indice de soudure de chaque sommet d'origine)."""
    V = np.asarray(g.vertices, np.float64)
    F = np.asarray(g.faces)
    etendue = float(np.linalg.norm(V.max(0) - V.min(0))) or 1.0
    q = np.round(V / (etendue * 1e-6)).astype(np.int64)
    _, premier, inv = np.unique(q, axis=0, return_index=True, return_inverse=True)
    inv = inv.reshape(-1)
    return V[premier], inv[F], inv


def topologie(g):
    """(composantes, aretes de bord) du maillage SOUDE par position."""
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components
    Vw, Fw, _ = souder(g)
    Fw = Fw[(Fw[:, 0] != Fw[:, 1]) & (Fw[:, 1] != Fw[:, 2]) & (Fw[:, 0] != Fw[:, 2])]
    n = len(Vw)
    a = np.concatenate([Fw[:, 0], Fw[:, 1], Fw[:, 2]])
    b = np.concatenate([Fw[:, 1], Fw[:, 2], Fw[:, 0]])
    graphe = coo_matrix((np.ones(len(a)), (a, b)), shape=(n, n))
    utilises = np.unique(Fw)
    nb, etiq = connected_components(graphe, directed=False)
    composantes = len(np.unique(etiq[utilises]))
    aretes = np.sort(np.stack([a, b], 1), axis=1)
    _, cnt = np.unique(aretes, axis=0, return_counts=True)
    return composantes, int((cnt == 1).sum())
